# Parcel emails for every order — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **No spreadsheet IDs, URLs, secrets or credential values in this file.** This
> repository is public. Env var *names* appear; values never do.

**Spec:** `docs/superpowers/specs/2026-10-21-sales-ops-parcel-emails-design.md`

**Goal:** Give the three parcel emails to orders that never went through the website, by typing an address onto the Sales Ops order — and move parcel state to one row per parcel so that is safe at volume.

**Architecture:** Sales Ops gains an optional `customerEmail`, settable by hand and extracted automatically from a pasted or Telegram'd order message. It stays **read-only to n8n**. All mutable parcel state moves out of per-order sheet cells into a parcels tab keyed by tracking number, which serves both order types, removes the delivered-email race and needs no database write path.

**Tech Stack:** Next.js / React / TypeScript (Sales Ops) · `node --test` in both repos · plain JS module shared with n8n Code nodes (GMG) · n8n Sheets + emailSend + Telegram + HTTP nodes.

---

## ⚠ THE FINDING THAT MADE THIS PLAN — read before Task 1

**An email pasted into an order message is silently swallowed into the shipping address today.**

`parseOrderText` builds the address as *"everything between the client name and the first item, shipping or total line"*. It tells item lines apart from address lines by looking for a `$`. An email line has no `$`, so it is not an item, not a total, not a shipping fee — **it lands inside the address block.**

The damage is not only a missing email. The **address itself becomes wrong**, carrying an email line into something that gets printed on a label and read by a human.

Both intake paths share this parser on purpose — the module header says a parsing fix "can never land in one and miss the other" — so the paste box and the Telegram bot have the same bug and get the same fix.

**This is why Task 1 is the parser and nothing else.**

## Global Constraints

- **Sales Ops stays READ-ONLY to n8n.** The only route that writes to the payload is `/api/tracking-import`, which carries a blind-upsert bug fixed on one branch and missed on the identical one, a CAS guard, hang timeouts and a deliberate silence discipline. **Do not add a second writer.** This plan does not touch that route.
- **⚠ EVERY NEW OPTIONAL `Order` FIELD MUST BE ADDED TO `normalizeOrder`.** It rebuilds each order from an allow-list, drops anything unlisted, and runs on every cloud load. `websiteOrderId` was missed there and the link vanished on every page load for five days. **This is the second field; there must not be a third mistake.**
- **An order with both `websiteOrderId` and `customerEmail` is a WEBSITE order only.** The website order has an address the customer typed themselves; the hand-typed field is a fallback for orders with no such source. It never competes, and nothing may send twice.
- **An order with no email stays silent** — no alert, no nag. A warning on every Beligas order would train the owner to ignore the channel that reports real send failures.
- **The address is resolved at send time, never copied into the parcels tab.** A copy goes stale when an address is corrected, and a stale address sends a stranger someone's parcel details.
- **Sheet timestamps are Philippine local with no offset.**
- Sales Ops tests: `npm test`, co-located `src/lib/<name>.test.ts`, imports carry the `.ts` extension. GMG tests: `node --test tests/*.test.js`.

### Traps already paid for, which all still apply

1. **A disabled n8n node passes its input through** — disable the stamp too, or a dry run marks work done that never happened.
2. **An emailSend node outputs the SMTP result**, not its input. Downstream reads `$('<decision node>').item.json`.
3. **A UMD wrapper cannot run in a Code node** — inline the body flat, verify behaviourally.
4. **Telegram parses as Markdown at runtime** — one `_` kills the whole alert. Set `parse_mode: 'HTML'` and strip `<>&` from interpolated errors.
5. **`sheets-manager.js write` resolves a bare cell to the FIRST sheet** — always qualify as `<Tab>!A1`.
6. **Carrier registration is not idempotent** — a duplicate costs a duplicate email and a duplicate charge.

---

## PHASE 1 — Sales Ops gains an address (ships alone, inert)

Nothing consumes `customerEmail` until Phase 3, so all of Phase 1 can go live immediately and addresses can start being collected.

### Task 1: Teach the parser to find an email

**Files:** modify `src/lib/order-parser.ts` · `src/lib/order-parser.test.ts`

**Interfaces:** `ParsedOrder` gains `customerEmail: string` (empty when none found). `shippingAddress` must **exclude** the email line.

- [x] **Step 1: Write the failing tests**

Cover, at minimum:
- a message with an email on its own line → `customerEmail` set, **and the line absent from `shippingAddress`**
- the same message **without** an email → `customerEmail` is `""` and `shippingAddress` is **byte-identical to today's output**
- an email appearing *before* the address lines, and *after* them — position must not matter
- two emails → the **first** wins (and see Task 3: the owner sees it echoed, so a wrong pick is visible)
- an item line that happens to contain an `@` → **not** treated as an email line, and still parsed as an item
- uppercase input → stored lower-cased and trimmed
- a malformed near-miss (`foo@bar`, no dot) → **not** extracted, and left in the address rather than silently eaten

- [x] **Step 2: Implement until green**

Add an `isEmailLine` test alongside `isItemLine` / `isTotalLine` / `isShippingLine`, and exclude those lines when slicing `addressLines`. Keep the module free of React and Next APIs — a client component and a server route both import it.

- [x] **Step 3: Run the whole suite**

`npm test`. The pre-existing parser tests must still pass untouched; if one changed, the address slicing regressed.

---

### Task 2: The field on the order

**Files:** modify `src/app/page.tsx`

- [x] **Step 1: Add `customerEmail?` to the `Order` type**

Optional, no migration — the same pattern as `cancelled?` / `noTrackingNeeded?` / `websiteOrderId?`.

- [x] **Step 2: Add it to `normalizeOrder` IN THE SAME COMMIT**

`...(order.customerEmail ? { customerEmail: order.customerEmail } : {})`. **Not a later step. Not a follow-up.** See the constraint above.

- [x] **Step 3: Add the form input**

An email field on the order form, loaded in `orderForm` and saved trimmed and lower-cased. Empty means silent; that is a valid, common state and must not look like an error.

- [x] **Step 4: Carry the parsed email through the paste box**

Where the paste box maps a `ParsedOrder` onto a new order, map `customerEmail` too. Without this, Task 1 extracts an address nobody stores.

- [x] **Step 5: Verify the round trip** — *confirmed by full page reload 2026-10-21; the normaliser holds*

Save an order with an address, **reload the page**, confirm it is still there. That is the exact check that would have caught the `websiteOrderId` bug, and the only one that proves the normaliser.

---

### Task 3: The Telegram intake shows the address back

**Files:** modify `src/lib/telegram-order-flow.ts` · `src/lib/order-message.ts` and their tests

- [x] **Step 1: Carry `customerEmail` into the appended order**

The flow already maps `parsed.shippingAddress` and `parsed.clientName`; add the address alongside them. No new parsing — Task 1 did it.

- [x] **Step 2: Echo it in the confirmation message**

The bot's confirmation must show the address it captured, or say plainly that it found none.

**This is the only defence against a typo.** A mistyped address does not error: it bounces, or it reaches a stranger holding a tracking number and a delivery address. Showing it back once is the difference between a typo being visible and being invisible.

- [x] **Step 3: Tests**

A message with an address and one without, through the flow, asserting both the stored field and the confirmation text.

---

### Task 4: Extend the shipments endpoint

**Files:** modify `src/lib/website-shipments.ts` · `src/app/api/website-shipments/route.ts` and tests

- [x] **Step 1: Write the failing tests**

- a tagged website order → returned as today, **with no address** (it has a better source)
- an order with `customerEmail` and **no** tag → returned as a Sales Ops shipment **with** the address
- an order with **both** → returned as a **website** order only, never twice
- an order with neither → absent, exactly as today
- a cancelled order → absent, either way

- [x] **Step 2: Implement**

Keep the route read-only and secret-gated.

> **⚠ This is the one place the endpoint stops being free of customer data.** It was built to return none, deliberately, and that comment is in the file. Update the comment to say what changed and why — an address for Sales Ops parcels only, because there is no other source — so the next reader does not think the property was lost by accident.

- [x] **Step 3: Full suite, then deploy**

`npm test` and `npm run build`. Deploying is safe: nothing consumes the new field yet.

---

## PHASE 2 — one row per parcel ⏰ WAIT FOR NOTHING IN FLIGHT

> **Do Phase 2 at the QUIETEST moment available — not "once nothing is in flight".**
>
> The original wording was *"wait until no registered parcel is outstanding"*.
> That is fine at today's volume and **becomes a trap at any other**: once
> orders flow continuously there may never again be a moment with nothing in
> flight, and a gate like that defers itself forever. Do not let it.
>
> **Why quiet matters, in order of weight:**
>
> 1. **You lose the ability to tell what broke.** The delivered email has
>    never run on a real carrier scan — every test so far replayed a payload
>    we posted ourselves. Restructure before that baseline exists and a later
>    failure has two candidate causes, the restructure or the feature, with no
>    way to separate them.
> 2. **Migration ordering.** Repoint before migrating and a delivered callback
>    finds no row, is rejected as `unknown-number`, and the customer is never
>    told. Migrate before repointing and a stamp written to the old columns is
>    missed, so they are told twice. This is a window of minutes, not a reason
>    to wait days.
>
> **If a quiet moment does not arrive, proceed anyway** with
> migrate → repoint → verify, in that order, and watch the first callback
> after the cutover. The small window is an acceptable price; an indefinite
> deferral is not.
>
> Migrating one parcel's state is trivial; fifty is a project. **Do this
> early.**

### Task 5: Create the parcels tab

- [ ] **Step 1: Read the current header row of the Orders tab and record it**
- [ ] **Step 2: Create the tab** with `trackingNumber` · `source` · `orderRef` · `status` · `statusAt` · `registered` · `transitEmailed` · `deliveredEmailed`. Remember a Sheets grid has a fixed column count — widen with `appendDimension` before writing past the last column.
- [ ] **Step 3: Migrate** whatever per-order state exists into one row per parcel, and verify each parcel's status and emailed flags survive exactly.
- [ ] **Step 4: Leave the old per-order columns in place.** They are retired in Task 9, a week later, in a separate change.

### Task 6: Repoint the decision module

**Files:** modify `parcel-status.js` · `tests/parcel-status.test.js` (GMG repo)

- [ ] **Step 1: Write the failing tests** — the same behavioural table as today, against one row per parcel instead of newline sets. The `MOVING` rule, the never-announce-a-delivered-parcel rule, the outstanding count and the unknown-status rule must all survive unchanged.
- [ ] **Step 2: Implement until green**, then run the whole suite.
- [ ] **Step 3: Delete the set-parsing helpers** only once nothing imports them — grep the repo and both Code nodes first.

### Task 7: Repoint the three workflows

- [ ] **Step 1:** registration branch, receiver, sweep and reconcile all read and write the parcels tab. Inline the module body flat, wrapper stripped; verify behaviourally.
- [ ] **Step 2: Prove the WEBSITE path still works end to end before anything new is enabled.** It is the one already keeping a promise to real customers. A regression here is worse than the feature being late.

---

## PHASE 3 — switch Sales Ops orders on

### Task 8: Go live

- [ ] **Step 1:** registration now covers Sales Ops shipments. Watch the first one register, and confirm **exactly one** parcels row appears.
- [ ] **Step 2: One real order, the owner's own address first.** Record the customer's real address before changing it, and restore it the moment the test is done — a delivery scan can land at any time, and whoever is in the field at that moment receives the email.
- [ ] **Step 3: Branch registration on the status it gets back**

An address added late must not restart the sequence. The registration response already carries the parcel's current status, so use it:

- **`Delivered`** → send nothing, mark all three emails as already sent so none fires later, and Telegram the owner once.
- **Moving** → number-ready as normal; the on-its-way email follows.
- **anything else** → unchanged.

**Why this is not optional:** a delivered parcel is terminal, so no callback is coming, and the reconcile sweep skips `Delivered` by design. Without this branch, an address added after delivery sends the customer a "your label has just been created" email **and nothing else, ever** — the wrong email, and the right one never arrives.

Test all three, including that a delivered-at-registration parcel ends with every emailed flag set and nothing sent.

- [ ] **Step 4: Prove the no-email case stays silent** — an order without an address produces no item, no email and no Telegram.
- [ ] **Step 5: Prove the both-fields case sends once** — an order carrying a website id and a typed address must be treated as a website order only.

### Task 9: Close out

- [ ] **Step 1: Retire the old per-order columns**, a week after Phase 2, in a change of their own.
- [ ] **Step 2: Update the memory cards** — `ecommerce-stores.md`, `sales-ops-webapp.md`, `n8n-workflows.md`.
- [ ] **Step 3: Add an EXECUTED banner** to the top of this plan naming every step that turned out wrong. That banner is the most valuable part of these documents.

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Email typed by hand; no customer-typed source exists | 2 |
| Captured from a pasted or Telegram'd message | 1, 3 |
| Address excluded from `shippingAddress` | 1 |
| `normalizeOrder` carries the new field | 2 |
| Sales Ops stays read-only to n8n | all — no task touches a write path |
| Endpoint returns an address for Sales Ops parcels only | 4 |
| Website order wins when both are present | 4, 8 |
| No email stays silent | 4, 8 |
| One row per parcel; race closed by construction | 5, 6, 7 |
| Address resolved at send time, never copied | 6, 7 |
| Typo made visible in the owner's confirmation | 3 |
| Cutover with nothing in flight | Phase 2 gate |
| Old columns retired separately | 5, 9 |
