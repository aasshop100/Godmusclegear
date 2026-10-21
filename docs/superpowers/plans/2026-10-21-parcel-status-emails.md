# Parcel status emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **No spreadsheet IDs, URLs, secrets or credential values in this file.** This
> repository is public. Env var *names* appear; values never do.

**Spec:** `docs/superpowers/specs/2026-10-21-parcel-status-emails-design.md`

**Goal:** Tell the customer when each parcel starts moving and when it lands — delivered per parcel on the carrier scan, in-transit combined.

**Architecture:** Numbers on website orders are registered once with Shippo by the existing nightly workflow. Shippo pushes `track_updated` to an n8n webhook, which records per-parcel status on the Orders row, emails delivered parcels immediately, and alerts the owner on exceptions. A separate scheduled sweep reads that recorded status — never Shippo — and sends one combined "on its way" email per order. A nightly reconciliation makes one Shippo lookup for stale, undelivered parcels, because a webhook that never arrives looks exactly like a parcel that never moved.

**Tech Stack:** plain JS UMD module shared with n8n Code nodes · `node --test` (GMG) · n8n Webhook + Sheets + emailSend + Telegram + HTTP Request nodes · Shippo Tracking API.

## Global Constraints

- **Website orders only.** Three independent gates: the `websiteOrderId` tag filters the shipment list, registration is scoped to that list, and the receiver rejects any number absent from `trackingRegistered`. No Beligas parcel can clear the first.
- **Shippable statuses are exactly `PAID` and `BANK_TRANSFER`.** Unchanged from the tracking-number build.
- **Sheet timestamps are Philippine local time with NO offset**, matching `createdAt`, `paidAt` and `trackingEmailedAt`. A bare `new Date()` in the n8n container is eight hours out.
- **Send first, then stamp.** A duplicate email is recoverable; a silent non-send is not.
- **Shippo tracking registration is NOT idempotent.** A duplicate `POST` means duplicate emails and a duplicate charge. Append to `trackingRegistered` only on success.
- **New Orders-tab columns are APPENDED at the end.** Never reorder; every n8n Sheets node maps by header name, and a reorder also strips validation and formatting.
- **Never assert delivery.** The delivered email reports what USPS says; it does not state it as fact. Never say "cancelled" or "do not pay" in any customer email in this system.
- **The customer Telegram handle is `@Godmusclegear`** — singular, no trailing `s`.
- GMG tests: `node --test tests/*.test.js` (NOT `node --test tests/`, which Node resolves as a module path and fails).

### ⚠ Three traps from the 2026-10-16 build — all three shipped silently then

1. **A disabled n8n node PASSES ITS INPUT THROUGH.** Dry-running with a send node disabled still runs the stamp, marking parcels emailed while nothing was sent. **Disable the stamp too, or disconnect it.**
2. **An emailSend node outputs the SMTP result**, not the data that fed it. Downstream nodes must read `$('<decision node>').item.json`, never `$json`.
3. **A UMD wrapper cannot run inside a Code node** — `module` and `window` are both undefined, so it builds the API and discards it. Inline the module BODY flat, wrapper stripped, and verify **behaviourally**, not by hash.

### ⚠ One hole this plan does not close

The receiver does a read-modify-write on multi-line cells. **Two parcels of the same order scanned delivered within the same few seconds can lose one stamp**, producing a duplicate email on the next event. Accepted for now: different parcels ride different trucks, so simultaneity is rare, and the failure is a duplicate rather than a silence. **The named remedy if it bites** is an append-only `parcel_events` tab with `deliveredEmailed` derived from it rather than stored — appends do not read first, so they cannot lose a sibling. Do not attempt that in this build.

---

## File Structure

**GMG repo (`Godmusclegear-main`)**

| File | Responsibility |
|---|---|
| `parcel-status.js` *(create)* | Pure decision layer: set/status-map parsing, Shippo status mapping, registration diff, webhook decision, sweep decision. Body inlined into three Code nodes. |
| `tests/parcel-status.test.js` *(create)* | Its tests. |
| `docs/emails/parcel-in-transit.html` *(create)* | Source of truth for the combined "on its way" body. |
| `docs/emails/parcel-delivered.html` *(create)* | Source of truth for the per-parcel delivered body. |

**Not in git:** the five Orders-tab columns, the Shippo webhook, and three n8n workflow changes.

---

### Task 1: The decision module

**Files:**
- Create: `parcel-status.js`
- Test: `tests/parcel-status.test.js`

**Interfaces:**
- Consumes: nothing. No I/O, no Date.now() in decisions — timestamps are passed in.
- Produces:
  - `parseSet(text) -> string[]` — newline-separated, trimmed, blanks dropped, order preserved, duplicates collapsed.
  - `formatSet(list) -> string`
  - `parseStatusMap(text) -> Array<{number, status}>` — one `<number>=<status>` per line.
  - `formatStatusMap(entries) -> string`
  - `MOVING -> ['In Transit', 'Accepted']`
  - `mapShippoStatus(raw) -> {status} | {unknown: true}`
  - `decideRegistration({trackingNumbers, trackingRegistered}) -> {toRegister: string[]}`
  - `decideWebhook({rows, trackingNumber, rawStatus}) -> Decision`
  - `decideTransitSweep({row}) -> Decision`

`decideWebhook` returns exactly one of:
`{action:'alert', reason:'unknown-number'|'ambiguous-number'|'unknown-status', trackingNumber, rawStatus?}`,
`{action:'record', orderId, trackingNumber, status, parcelStatusAfter}`,
`{action:'deliver', orderId, trackingNumber, status, parcelStatusAfter, deliveredAfter, outstanding:number}`,
`{action:'exception', orderId, trackingNumber, status, parcelStatusAfter}`.

`decideTransitSweep` returns `{action:'skip', orderId}` or
`{action:'send', orderId, newNumbers:string[], transitAfter:string, totalParcels:number}`.

- [x] **Step 1: Write the failing tests**

Create `tests/parcel-status.test.js` covering, at minimum:

- `parseSet` on empty, single, trailing-newline, duplicate and whitespace-padded input.
- `parseStatusMap` round-trips through `formatStatusMap`; a malformed line without `=` is dropped, not crashed on.
- `mapShippoStatus`: `DELIVERED`→Delivered, `TRANSIT`→In Transit, `PRE_TRANSIT`→Label Created, `RETURNED`/`FAILURE`→Exception, `UNKNOWN`→Label Created, anything else → `{unknown:true}`.
- `decideRegistration` returns only numbers absent from `trackingRegistered`; returns `[]` when all are present.
- `decideWebhook`: unknown number → alert; a number on two rows → `ambiguous-number`; unrecognised raw status → `unknown-status`; `TRANSIT` → `record` with the map updated and **no send**; `DELIVERED` on a new parcel → `deliver` with `deliveredAfter` containing it and `outstanding` counting the order's other parcels not yet Delivered; `DELIVERED` on a parcel already in `deliveredEmailed` → `record`, not `deliver`; `RETURNED` → `exception`.
- `decideTransitSweep`: no moving parcels → skip; two parcels newly moving → **one** send naming both; a parcel already in `transitEmailed` → excluded; a parcel that moved and then delivered without a sweep in between → still in-transit-emailed? **No** — exclude any parcel already in `deliveredEmailed`; telling someone a parcel is on its way after it landed is worse than silence.

**Why `UNKNOWN` maps to Label Created and not Exception.** Sales Ops maps Shippo `UNKNOWN`→`Exception` because there a failed *lookup* is worth flagging. A *pushed* `UNKNOWN` means the carrier has no scan yet, which is normal and must not page the owner. Deliberate divergence; keep the comment in the code.

- [x] **Step 2: Implement until green**

`module.exports` at the bottom guarded for the browser, same UMD shape as `tracking-email.js` — but remember trap 3: only the BODY goes into a Code node.

- [x] **Step 3: Run the suite**

`node --test tests/*.test.js` — the new file green and every pre-existing test still green.

---

### Task 2: The two email templates

**Files:**
- Create: `docs/emails/parcel-in-transit.html`, `docs/emails/parcel-delivered.html`

**Interfaces:**
- Consumes: the shared visual shell used by the six existing templates.
- Produces: two bodies with no branching — all conditional text is built in the Code node and injected.

- [ ] **Step 1: Copy the shell**

Start from `docs/emails/tracking-shipped.html` so the header, footer, typography and the `@Godmusclegear` group link match exactly. Do not hand-build a new shell.

- [ ] **Step 2: Write `parcel-in-transit.html`**

Covers one or more parcels in a single email. Must contain:
- every number in `newNumbers`, **as selectable text first, the USPS link beneath** — the deep link lands on a blank Akamai block page on a plain left-click, and in an email every click is a plain click;
- a line explaining that the order ships **one package per brand**, so more than one number is expected;
- **"allow 4–7 business days"**, matching the storefront and the tracking email.

- [ ] **Step 3: Write `parcel-delivered.html`**

**The copy rule is the point of this template.** It must say **"USPS reports this parcel as delivered"** — never "your package was delivered". USPS scans early and occasionally scans wrongly, and a flat assertion against a parcel still on the truck starts a dispute.

Must contain: the parcel's number; what to do if it has not arrived (check with the household and neighbours, then reply); and, when `outstanding > 0`, a line saying how many parcels are still on the way so the customer does not think the order is complete.

- [ ] **Step 4: Render both with stub data**

Build each with a stub substitution and read the visible text. Check: no unreplaced placeholders, no empty `<a>`, the group handle is singular, and the delivered copy nowhere asserts delivery as fact.

---

### Task 3: Add the five columns to the Orders tab

**Files:** none in git — a data change to the live spreadsheet.

**Interfaces:**
- Produces: headers `trackingRegistered`, `parcelStatus`, `parcelStatusAt`, `transitEmailed`, `deliveredEmailed` at the end of the Orders header row.

- [ ] **Step 1: Read the current header row**

Using the local `gdrive` OAuth token, read the Orders header row and record the exact current list. It should end with `trackingEmailedAt` at 26 columns after the 2026-10-16 build.

- [ ] **Step 2: Append the five headers**

Write them into the first five empty header cells after the last populated one — **append only**. No reorder, no rename, no insert.

- [ ] **Step 3: Verify nothing moved**

Re-read the header row: the existing headers byte-identical to Step 1, the five new ones following. Re-read a known data row and confirm its values are unchanged.

- [ ] **Step 4: Confirm the live workflows still run**

Wait for one `GMG - Payment Watcher` execution (every 2 minutes) and confirm `success`. It reads and writes this tab, so a green run proves the append was harmless. Then confirm `GMG - Tracking Emails` still runs clean.

---

### Task 4: Registration, on the existing nightly workflow

**Files:** none in git — n8n MCP tools.

**Interfaces:**
- Consumes: `parcel-status.js` `decideRegistration` (Task 1), `trackingRegistered` (Task 3), the shipment list the workflow already fetches.
- Produces: numbers registered with Shippo; `trackingRegistered` populated.

> **Order matters: Shippo requires the webhook to exist before any number is registered.** Do not enable this task's HTTP node until Task 6 Step 1 has created the webhook. Build it disabled.

- [ ] **Step 1: Add a Shippo credential**

Add the **live** key as an n8n credential. The test key cannot do live tracking. Do not paste the key into a node field.

- [ ] **Step 2: Extend `Decide Sends`**

The node already computes new numbers per order. Add the registration diff alongside it and emit, per order, a `toRegister` array. **Do not change the existing email decision** — re-run the Task 1 suite plus the existing `tracking-email` suite and confirm the send behaviour is untouched.

- [ ] **Step 3: Add `Register Tracking` (disabled)**

HTTP Request, `POST` to the Shippo tracks endpoint, one call per number, carrier `usps`, timeout 10000 ms, `onError: continueErrorOutput`. Start **disabled**.

- [ ] **Step 4: Add `Stamp Registered`**

Sheets update on `Orders`, matched by `orderId`, appending **only the numbers that returned success** to `trackingRegistered`. A number left out is retried tomorrow; a number wrongly added is never registered and goes silent forever — so on partial failure, stamp the successes and alert on the rest.

- [ ] **Step 5: Add `Alert Registration Failed`**

Telegram, its own node, fed by the error outputs of Steps 3 and 4. **Not a shared alert node** — `Alert Payment Email Failed` reads `$("Match Payments")`, absent from this branch, and reusing it fails exactly when a failure needs reporting.

---

### Task 5: The webhook receiver

**Files:** none in git — n8n MCP tools.

**Interfaces:**
- Consumes: `parcel-status.js` `decideWebhook`, `docs/emails/parcel-delivered.html`, the five columns.
- Produces: workflow `GMG - Parcel Status`.

- [ ] **Step 1: Confirm the real payload shape first**

Fetch a sample `track_updated` payload from Shippo's API Portal and record the exact envelope — where `tracking_number` and `tracking_status.status` actually sit. **Do not code against an assumed shape.** The fields below are the intent, not a verified contract.

- [ ] **Step 2: Build the workflow with the send node DISABLED**

Nodes, in order:

1. **Webhook** — `POST`, an unguessable path. Workflow `timezone: Asia/Manila`, `errorWorkflow` set to the shared handler like the other GMG workflows.
2. **Respond 200** — acknowledge immediately, before any processing. Shippo retries on a non-2xx, and a slow Sheets read must not turn into duplicate callbacks.
3. **Read Orders** — Sheets read, tab by NAME, `returnAllMatches` on.
4. **Decide Event** — Code node holding the `parcel-status.js` **body inlined flat, wrapper stripped** (trap 3). Calls `decideWebhook` and emits `action` plus the fields for that branch, including the ready-built `numberHtml` and `outstandingLine` so the template carries no branching.
5. **Route Event** — Switch on `action`.
6. **Send Delivered Email** — emailSend, the GMG SMTP credential, from the usual address, body = `parcel-delivered.html`. `onError: continueErrorOutput`. Start **disabled**.
7. **Stamp Delivered** — Sheets update matched by `orderId`, writing `parcelStatus`, `parcelStatusAt` and `deliveredEmailed`. `onError: continueErrorOutput`. **Must read `$('Decide Event').item.json`, never `$json`** (trap 2).
8. **Record Status** — Sheets update writing `parcelStatus` and `parcelStatusAt` only. The `record` branch.
9. **Alert Exception** — Telegram to the owner, naming order and parcel. Never emails the customer.
10. **Alert Unknown Event** — Telegram, for `unknown-number`, `ambiguous-number`, `unknown-status`.
11. **Alert Send Failed** — Telegram, fed by the error outputs of 6 and 7, referencing only this branch's data.

- [ ] **Step 3: Verify the inlined module behaviourally**

Not by hash. Run the same table of cases from Task 1 Step 1 through the Code node and compare outputs to the tested module. A hand-retyped copy is how a tested module silently diverges from the one that runs.

- [ ] **Step 4: Exercise every path with sample payloads**

With node 6 **and node 7** both disabled (trap 1 — a disabled send alone still lets the stamp run), post sample payloads directly at the webhook and confirm each decision: a `TRANSIT` for a registered number → `record`; a `DELIVERED` → `deliver` with the right `outstanding`; an unregistered number → `unknown-number`, nothing written; a nonsense status → `unknown-status`; a `RETURNED` → `exception`, Telegram only.

- [ ] **Step 5: Do NOT publish yet**

---

### Task 6: Create the Shippo webhook and register one parcel

**Files:** none in git.

- [ ] **Step 1: Create the webhook**

Register a `track_updated` webhook, environment **live**, pointed at the Task 5 URL. Confirm the account lists exactly one — it listed zero on 2026-10-21, so a second entry means a duplicate and duplicate notifications.

- [ ] **Step 2: Publish the receiver, sends still disabled**

The webhook needs a live listener. Publish Task 5 with nodes 6 and 7 disabled so real callbacks are recorded and alerted on, but nothing is emailed or stamped.

- [ ] **Step 3: Enable registration for exactly one parcel**

Enable the Task 4 HTTP node and run the nightly workflow manually against **one** real website order with a real tracking number. Confirm: Shippo returns success, `trackingRegistered` holds that number, and no other order was registered.

- [ ] **Step 4: Watch one real scan arrive**

Wait for a genuine carrier scan. Confirm the webhook fires, `Decide Event` resolves the number to the right order, and nothing is sent. **This is the first proof the whole push path works end to end** — do not skip it for a sample payload.

---

### Task 7: The in-transit sweep

**Files:** none in git.

**Interfaces:**
- Consumes: `decideTransitSweep`, `docs/emails/parcel-in-transit.html`, `parcelStatus`, `transitEmailed`.
- Produces: workflow `GMG - Parcel In Transit`.

- [ ] **Step 1: Build it**

1. **Schedule** — every two hours during waking hours, Asia/Manila. The workflow carries its own trigger, so **publishing IS the schedule** — no cron-job.org entry is needed (those exist only because Vercel Hobby caps crons at two).
2. **Read Orders** — Sheets read, tab by NAME, `returnAllMatches` on.
3. **Decide Transit** — Code node, module body inlined flat.
4. **Send In Transit Email** — one email per order covering all of `newNumbers`. `onError: continueErrorOutput`. Start **disabled**.
5. **Stamp Transit** — appends `newNumbers` to `transitEmailed`. Reads `$('Decide Transit').item.json`.
6. **Alert Transit Send Failed** — its own Telegram node.

- [ ] **Step 2: Dry run with BOTH the send and the stamp disabled**

Confirm one order with two moving parcels yields **one** decision naming both, and an order whose parcels are all already in `transitEmailed` yields nothing. **Nothing to do must say nothing** — no Telegram on a quiet run.

---

### Task 8: Go live

- [ ] **Step 1: Enable delivered**

Enable nodes 6 and 7 on the receiver and republish. Confirm `activeVersionId` equals `versionId` — a draft that is not published is not what runs.

- [ ] **Step 2: Prove delivered on a real parcel**

Using a `BANK_TRANSFER` test order (written at checkout with no money moving, and already in `SHIPPABLE`) to the owner's own address. Expected, all four:
1. the email arrives when the carrier scans delivered, and says USPS *reports* it delivered;
2. `parcelStatus` holds `<number>=Delivered`;
3. `deliveredEmailed` holds the number;
4. a replayed identical callback sends nothing.

- [ ] **Step 3: Enable the sweep**

Enable nodes 4 and 5 on Task 7 and publish. Confirm a run with nothing to do sends nothing and says nothing.

- [ ] **Step 4: Prove the multi-parcel path**

A two-parcel order: both parcels moving between sweeps must produce **one** in-transit email naming both, then **two** separate delivered emails, the first carrying `outstanding: 1`.

- [ ] **Step 5: Register the backlog**

Only now, run the nightly workflow across all existing website orders so their numbers are registered. Doing this earlier would have pointed real callbacks at an untested receiver.

---

### Task 9: Reconciliation — last, because a net goes up after the floor

**Files:** none in git.

- [ ] **Step 1: Build the nightly sweep**

Schedule Trigger, Asia/Manila. For parcels in `trackingRegistered` whose `parcelStatus` is **not** `Delivered` and whose `parcelStatusAt` is older than a set number of days, make **one** Shippo `GET` per parcel and feed the result through the same `decideWebhook` logic, so a recovered delivery emails exactly as a pushed one would.

This is the only place this feature spends money on status, and it is bounded to stale parcels.

- [ ] **Step 2: Prove it recovers a dropped callback**

Set a registered parcel's `parcelStatus` back to `In Transit` by hand while USPS reports it delivered, and run. Expected: the delivered email sends and the row is corrected. **This is the test that the net actually catches.**

---

### Task 10: Close out

- [ ] **Step 1: Decide the importer's redundant lookup**

Once the receiver is writing status, the Sales Ops importer's Shippo `GET` is redundant for website orders. Check the next `TRACK_FEE` invoice: if registrations billed on top of lookups, remove that call for tagged orders. If billing deduplicated by number, leave it. **A flag, not a redesign** — do not pre-empt the invoice.

- [ ] **Step 2: Update the memory cards**

Record in `ecommerce-stores.md` and `sales-ops-webapp.md`: the two new workflows and their ids, the five new columns, the Shippo webhook and credential, the registration guard, the reconciliation schedule, and the read-modify-write hole with its named remedy.

- [ ] **Step 3: Record what was wrong**

Add an EXECUTED banner to the top of this plan naming any step that turned out wrong, as the 2026-10-16 plan does. That banner is the most valuable part of these documents.

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Website orders only, three gates | 1, 4, 5 |
| Five appended columns, header-name mapping | 3 |
| Sets not booleans; `trackingRegistered` separate | 1, 3 |
| Registration guarded against non-idempotency | 1, 4 |
| Webhook validated against `trackingRegistered` | 1, 5 |
| Delivered per parcel, immediate | 5, 8 |
| In-transit combined, per run | 1, 7 |
| Exception to owner only | 1, 5 |
| Delivered copy reports, never asserts | 2 |
| Number as text before link; 4–7 business days | 2 |
| Own alert node per branch | 4, 5, 7 |
| Send first then stamp | 5, 7 |
| Silence when nothing to do | 1, 7 |
| Reconciliation backstop | 9 |
| Rollout order, inert first | 3–9 |
| Importer lookup is a flag, not a redesign | 10 |
