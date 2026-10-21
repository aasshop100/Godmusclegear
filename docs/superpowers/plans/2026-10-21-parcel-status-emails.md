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

- [x] **Step 1: Copy the shell**

Start from `docs/emails/tracking-shipped.html` so the header, footer, typography and the `@Godmusclegear` group link match exactly. Do not hand-build a new shell.

- [x] **Step 2: Write `parcel-in-transit.html`**

Covers one or more parcels in a single email. Must contain:
- every number in `newNumbers`, **as selectable text first, the USPS link beneath** — the deep link lands on a blank Akamai block page on a plain left-click, and in an email every click is a plain click;
- a line explaining that the order ships **one package per brand**, so more than one number is expected;
- **"allow 4–7 business days"**, matching the storefront and the tracking email.

- [x] **Step 3: Write `parcel-delivered.html`**

**The copy rule is the point of this template.** It must say **"USPS reports this parcel as delivered"** — never "your package was delivered". USPS scans early and occasionally scans wrongly, and a flat assertion against a parcel still on the truck starts a dispute.

Must contain: the parcel's number; what to do if it has not arrived (check with the household and neighbours, then reply); and, when `outstanding > 0`, a line saying how many parcels are still on the way so the customer does not think the order is complete.

- [x] **Step 4: Render both with stub data**

Build each with a stub substitution and read the visible text. Check: no unreplaced placeholders, no empty `<a>`, the group handle is singular, and the delivered copy nowhere asserts delivery as fact.

---

### Task 3: Add the five columns to the Orders tab

**Files:** none in git — a data change to the live spreadsheet.

**Interfaces:**
- Produces: headers `trackingRegistered`, `parcelStatus`, `parcelStatusAt`, `transitEmailed`, `deliveredEmailed` at the end of the Orders header row.

> **⚠ EXECUTED 2026-10-21 — Step 2 as written was wrong.** There were no empty
> header cells to write into: the Orders grid was **exactly 26 columns wide**,
> so every write to `AA1`–`AE1` failed with *"Range exceeds grid limits. Max
> rows: 1023, max columns: 26"*. The grid has to be widened first with a
> `spreadsheets.batchUpdate` `appendDimension` request (`COLUMNS`, length 5).
> `appendDimension` adds at the END only — it cannot insert, reorder or touch
> existing cells, which is exactly the guarantee this task needs.
>
> **Second trap, nearly costly:** `sheets-manager.js write` passes its cell
> argument straight through as the API range, so a bare `AA1` resolves to the
> **first sheet in the file — `Sheet1`, the inventory mirror** — not to Orders.
> Always fully qualify the range as `Orders!AA1`. A bare reference here would
> have written header text into the live stock feed.

- [x] **Step 1: Read the current header row**

Using the local `gdrive` OAuth token, read the Orders header row and record the exact current list. It should end with `trackingEmailedAt` at 26 columns after the 2026-10-16 build.

- [x] **Step 2: Append the five headers**

Widen the grid by five columns with `appendDimension`, then write the headers to `Orders!AA1:AE1` — **append only**. No reorder, no rename, no insert.

- [x] **Step 3: Verify nothing moved**

Re-read the header row: the existing headers byte-identical to Step 1, the five new ones following. Re-read a known data row and confirm its values are unchanged.

- [x] **Step 4: Confirm the live workflows still run**

Wait for one `GMG - Payment Watcher` execution (every 2 minutes) and confirm `success`. It reads and writes this tab, so a green run proves the append was harmless. Then confirm `GMG - Tracking Emails` still runs clean.

---

### Task 4: Registration, on the existing nightly workflow

**Files:** none in git — n8n MCP tools.

**Interfaces:**
- Consumes: `parcel-status.js` `decideRegistration` (Task 1), `trackingRegistered` (Task 3), the shipment list the workflow already fetches.
- Produces: numbers registered with Shippo; `trackingRegistered` populated.

> **Order matters: Shippo requires the webhook to exist before any number is registered.** Do not enable this task's HTTP node until Task 6 Step 1 has created the webhook. Build it disabled.

> **⚠ EXECUTED 2026-10-21 — Step 2 as written would have shipped a silent bug,
> and Step 5 was wrong.**
>
> **Step 2 said to extend `Decide Sends`. Do not.** That node `return`s early
> when an order has no NEW numbers to email. Every number already emailed
> before this feature existed — the entire backlog — would therefore never
> have been registered, and no status email would ever fire for those parcels.
> Nothing would have reported it. Registration is now its **own Code node,
> `Decide Registrations`, running in PARALLEL off `Read Orders`**, which also
> leaves the proven email path byte-identical instead of editing it.
>
> **Step 5 said one alert node fed by both error outputs.** That works in the
> email branch because `Send Tracking Email` and `Stamp Emailed` both descend
> linearly from `Decide Sends`, so `$('Decide Sends').item` resolves from
> either. Here `Collect Registered` **aggregates** N items into M, which
> breaks paired-item resolution — an alert reading `$('Decide Registrations')`
> from the stamp branch could not resolve. There are **two** alert nodes:
> `Alert Registration Failed` (HTTP error, reads `Decide Registrations`) and
> `Alert Registration Stamp Failed` (stamp error, reads `Collect Registered`).
>
> **A node the plan never mentioned was required: `Collect Registered`.**
> `trackingRegistered` is a whole-cell write, so two parcels of one order
> stamped separately would both read the same stale cell and the second would
> erase the first — leaving a registered number unrecorded, re-registered
> tomorrow, and billed and emailed twice. Successes are grouped per order
> before a single stamp.
>
> **Trap 1 applies to `Stamp Registered` too, so it also starts disabled.** A
> disabled `Register Tracking` passes its input straight through, so the stamp
> would mark numbers as registered while nothing was registered — and nothing
> would ever retry them.
>
> **Not published.** The draft holds all this; `activeVersionId` is still the
> 9-node version, so tonight's 21:30 run is unaffected. Task 6 Step 2 publishes.

- [x] **Step 1: Add a Shippo credential** — *Lester's step; the MCP can list credentials but not create them*

Add the **live** key as an n8n Header Auth credential (`Authorization` = `ShippoToken <live key>`). The test key cannot do live tracking. Do not paste the key into a node field. Then attach it to `Register Tracking`.

> Done 2026-10-21: credential `Shippo` (httpHeaderAuth), attached to
> `Register Tracking`, node still disabled.
>
> **⚠ The credential VALUE cannot be verified from here** — n8n never returns
> it and the UI masks it. The likely mistake is a missing `ShippoToken `
> prefix (Shippo does **not** use `Bearer`). This fails safe: a wrong value
> returns 401, `continueErrorOutput` routes it to `Alert Registration Failed`,
> the number is left out of `trackingRegistered`, and **nothing is charged**.
> Task 6 Step 3 — one real number — is where this is actually proven.
>
> The key lives only in the Sales Ops `.env.local` as `SHIPPO_API_TOKEN`; the
> Vercel copy is masked and Shippo shows a key once. Do not delete the `fe92`
> key to make a new one — Sales Ops authenticates every tracking lookup with
> it. Two live keys are allowed if a separate one is ever wanted.

- [x] **Step 2: Add `Decide Registrations`** *(not "extend Decide Sends" — see above)*

A parallel Code node off `Read Orders` holding the `parcel-status.js` body inlined flat. Emits **one item per number** that needs registering. Skips orders with no row or a non-shippable status: `Decide Sends` already alerts on both, and registering there would spend money subscribing to a parcel whose status would be emailed to the wrong customer.

- [x] **Step 3: Add `Register Tracking` (disabled)**

HTTP Request, `POST` to the Shippo tracks endpoint, one call per number, carrier `usps`, timeout 10000 ms, `onError: continueErrorOutput`. Start **disabled**.

- [x] **Step 4: Add `Collect Registered` and `Stamp Registered` (both disabled)**

`Collect Registered` groups successful numbers per order; `Stamp Registered` writes `trackingRegistered` once per row. Only successes reach it — a number left out is retried tomorrow; a number wrongly recorded is never registered and goes silent forever.

- [x] **Step 5: Add the two alert nodes**

One per branch, each reading only its own branch's data.

---

### Task 5: The webhook receiver

**Files:** none in git — n8n MCP tools.

**Interfaces:**
- Consumes: `parcel-status.js` `decideWebhook`, `docs/emails/parcel-delivered.html`, the five columns.
- Produces: workflow `GMG - Parcel Status`.

> **⚠ EXECUTED 2026-10-21 — a live-proven bug, and three things the plan had
> wrong.**
>
> **THE BUG: Telegram parses alert text as Markdown, and ONE underscore kills
> the whole message.** Both alert branches failed live with
> `400 Bad Request: can't parse entities: Can't find end of the entity
> starting at byte offset 78`. Byte 78 was the `_` in **`track_updated`** — a
> string in every single Shippo callback. Shippo statuses do it too
> (`PRE_TRANSIT`, `SOMETHING_NEW`). An unmatched `_` opens a Markdown italic
> that never closes, Telegram rejects the message, and **the alert is lost
> precisely when something has gone wrong.** The node type definition claims
> `parse_mode` defaults to HTML; at runtime it does not. Fixed by setting
> `parse_mode: 'HTML'` explicitly, and by stripping `<>&` from interpolated
> error messages so free text cannot open an HTML entity either.
>
> **This was latent in `GMG - Tracking Emails` too** — its two registration
> alerts carry `track_updated`, and all four of its alerts interpolate error
> messages that can contain anything. All four were fixed in the same pass.
> The reason it had never fired: the existing alert text happens to contain no
> underscores. **Every Telegram alert in this instance is worth auditing.**
>
> **Step 2's "Respond 200" node is unnecessary.** The Webhook node's default
> `responseMode: 'onReceived'` already answers immediately, before the rest of
> the chain runs. A `Respond to Webhook` node would add a failure surface for
> nothing.
>
> **The SDK sandbox rejects ordinary JavaScript.** `.join()` on an array and
> `function` declarations are both refused ("not an allowed SDK method" /
> "Function declarations are not allowed"), so a long `jsCode` string cannot
> be assembled in the SDK and switch rules cannot be built by a helper. Create
> the workflow with `jsCode: 'return [];'` and set the real body afterwards
> with `setNodeParameter` — which is also the only way to be sure the stored
> text is what you meant.
>
> **Added, not in the plan: a `no-customer-email` guard.** An `emailSend` with
> an empty recipient fails at the SMTP layer with a message about the address,
> which reads like a bug rather than a missing field. It now reports as what
> it is and is never stamped as emailed.
>
> **Step 3 was done by live execution, not a local differential run.** Running
> real payloads through the stored node proves the thing a local test cannot:
> that the `/[\n,;/]+/` regexes survived JSON escaping into n8n. They did.

- [x] **Step 1: Confirm the real payload shape first**

Confirmed from Shippo's docs: the envelope is `{ event, test, data }`, with `tracking_number` and `carrier` directly on `data` and the status at `data.tracking_status.status`. The receiver also accepts a bare payload, so a hand-posted sample behaves exactly like a real callback.

Fetch a sample `track_updated` payload from Shippo's API Portal and record the exact envelope — where `tracking_number` and `tracking_status.status` actually sit. **Do not code against an assumed shape.** The fields below are the intent, not a verified contract.

- [x] **Step 2: Build the workflow with the send node DISABLED**

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

- [x] **Step 3: Verify the inlined module behaviourally**

Not by hash. Run the same table of cases from Task 1 Step 1 through the Code node and compare outputs to the tested module. A hand-retyped copy is how a tested module silently diverges from the one that runs.

- [x] **Step 4: Exercise every path with sample payloads**

With node 6 **and node 7** both disabled (trap 1 — a disabled send alone still lets the stamp run), post sample payloads directly at the webhook and confirm each decision: a `TRANSIT` for a registered number → `record`; a `DELIVERED` → `deliver` with the right `outstanding`; an unregistered number → `unknown-number`, nothing written; a nonsense status → `unknown-status`; a `RETURNED` → `exception`, Telegram only.

- [x] **Step 5: Do NOT publish yet**

---

### Task 6: Create the Shippo webhook and register one parcel

**Files:** none in git.

> **⚠ EXECUTED 2026-10-21 — Steps 1 and 2 are done but in the OPPOSITE order,
> and Steps 3 and 4 are BLOCKED on reality, not on anything in this build.**
>
> **Publish first, then create the webhook.** Creating a Shippo webhook that
> points at an unpublished n8n workflow means the URL 404s until it is
> published. The receiver was published first, the live URL probed, and only
> then was the webhook created. The plan's own reasoning supports this; its
> step order did not.
>
> **The live endpoint was measured, not assumed.** Four probes: 3.6s cold,
> then 2.4s / 1.2s / 1.1s warm. The chain itself takes longer than that, so
> `responseMode: onReceived` really is answering before the workflow finishes
> — which is what keeps Shippo from retrying and double-processing. Each probe
> produced an `unknown-number` Telegram alert, as designed.
>
> **Steps 3 and 4 CANNOT be completed yet: there is no parcel to register.**
> A dry run of the nightly workflow returned `[]` from `Fetch Shipments` — no
> website order currently carries a tracking number. So there is nothing to
> register, and no scan to watch. **The first real shipment is the live test.**
>
> **The dry run was made safe first.** `Send Tracking Email` is ENABLED in
> that workflow, so a plain manual run would have emailed a real customer
> ahead of schedule. Both it *and* `Stamp Emailed` were disabled for the run
> (disabling the send alone lets the stamp mark orders as emailed while
> nothing was sent), then both restored and **verified node-by-node as
> `disabled: false`** afterwards. The active version was never touched.
>
> **Registration is now enabled** in the draft. With zero shipments it
> registers nothing today, and it is the correct state for the first real
> order. **The credential value is still unproven** — the first registration
> either succeeds or returns 401, and a 401 now reaches Telegram properly
> because the Markdown bug above is fixed.

- [x] **Step 1: Create the webhook** — *done second, not first*

Created live: one `track_updated` webhook, `active: true`, `is_test: false`, pointed at the published receiver. Listing confirms **exactly one** — a duplicate would mean duplicate emails and duplicate charges.

Register a `track_updated` webhook, environment **live**, pointed at the Task 5 URL. Confirm the account lists exactly one — it listed zero on 2026-10-21, so a second entry means a duplicate and duplicate notifications.

- [x] **Step 2: Publish the receiver, sends still disabled**

The webhook needs a live listener. Publish Task 5 with nodes 6 and 7 disabled so real callbacks are recorded and alerted on, but nothing is emailed or stamped.

- [ ] **Step 3: Enable registration for exactly one parcel** — **BLOCKED: no website order has a tracking number yet**

Enable the Task 4 HTTP node and run the nightly workflow manually against **one** real website order with a real tracking number. Confirm: Shippo returns success, `trackingRegistered` holds that number, and no other order was registered.

- [ ] **Step 4: Watch one real scan arrive** — **BLOCKED: waiting on the first real shipment**

Wait for a genuine carrier scan. Confirm the webhook fires, `Decide Event` resolves the number to the right order, and nothing is sent. **This is the first proof the whole push path works end to end** — do not skip it for a sample payload.

---

### Task 7: The in-transit sweep

**Files:** none in git.

**Interfaces:**
- Consumes: `decideTransitSweep`, `docs/emails/parcel-in-transit.html`, `parcelStatus`, `transitEmailed`.
- Produces: workflow `GMG - Parcel In Transit`.

> **⚠ EXECUTED 2026-10-21 — built and dry-run green on four cases.**
>
> Schedule is `0 8-22/2 * * *` Asia/Manila (every two hours, 08:00–22:00). The
> workflow carries its own trigger, so **publishing IS the schedule** — no
> cron-job.org entry.
>
> **A `Route Transit` switch was added, which the plan did not list.** The
> `no-customer-email` guard needs somewhere to go, and routing it exactly as
> `GMG - Tracking Emails` routes its own alert keeps the three workflows the
> same shape.
>
> **Dry run, send AND stamp disabled (trap 1), all four cases green:**
> 1. nothing moving → **zero items, no Telegram.** Silence when idle.
> 2. two parcels moving (`In Transit` + `Accepted`) → **ONE** email item
>    naming both, `totalParcels: 2`, subject "Your order is on its way".
> 3. one already in `transitEmailed` → only the other parcel, worded as a
>    follow-up, and `transitAfter` correctly accumulates both.
> 4. parcels in `deliveredEmailed` while their status still reads moving →
>    **zero items.** A parcel that has landed is never announced as on its way.
>
> Sentinel data lived on an already-EXPIRED order, was written and cleared
> guarded by exact `orderId`, and the row's own fields were re-read afterwards
> and are untouched.

- [x] **Step 1: Build it**

1. **Schedule** — every two hours during waking hours, Asia/Manila. The workflow carries its own trigger, so **publishing IS the schedule** — no cron-job.org entry is needed (those exist only because Vercel Hobby caps crons at two).
2. **Read Orders** — Sheets read, tab by NAME, `returnAllMatches` on.
3. **Decide Transit** — Code node, module body inlined flat.
4. **Send In Transit Email** — one email per order covering all of `newNumbers`. `onError: continueErrorOutput`. Start **disabled**.
5. **Stamp Transit** — appends `newNumbers` to `transitEmailed`. Reads `$('Decide Transit').item.json`.
6. **Alert Transit Send Failed** — its own Telegram node.

- [x] **Step 2: Dry run with BOTH the send and the stamp disabled**

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
