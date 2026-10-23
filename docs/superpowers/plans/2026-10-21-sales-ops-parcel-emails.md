# Parcel emails for every order — Implementation Plan

> ## EXECUTED — 2026-10-21/22. Read this before the plan; several steps were WRONG.
>
> **Every order can now get the three parcel emails, whether or not it went
> through the website.** Kept as the record, not a to-do list. Each task's own
> banner has the detail; this is what to know first.
>
> ### Done after the plan closed (2026-10-22/23)
>
> Three things this plan never scoped, added once it was live:
>
> - **`customerEmail`, `customerName` and `orderNumber` on the parcels tab.**
>   Display and audit only; nothing sends from them. `orderNumber` exists
>   because `orderRef` is an unreadable UUID for a Sales Ops order.
> - **`GMG - Parcel Sync` (`PcUoEmSDMbSUB6fm`), daily 06:00 Manila.** Those
>   two customer columns are a COPY written once at append, so they drift the
>   moment an order is corrected — which happened within a day. Sync diffs
>   each row against the live source and never blanks a value.
> - **`Orders!AA:AE` retired** 2026-10-23 after reading all five workflows
>   node by node. A name-only grep could not settle it: the parcels tab has
>   its own `transitEmailed`/`deliveredEmailed` columns.
>
> **Proven unattended to real customers 2026-10-23:** the delivered email
> (Brandon, genuine USPS scan, 00:21) and the Sales Ops in-transit email
> (Doug and Ryan, 08:00 sweep). What remains unexercised needs traffic, not
> work — see `ecommerce-stores.md` → PARCEL STATUS EMAILS → Proof log.
>> ### The parser bug this plan was reordered around
>
> **An email pasted into an order message was silently swallowed into the
> shipping address.** `parseOrderText` tells an item line from an address line
> by looking for a `$`; an email has none, so it fell inside the address
> block. The email was lost **and the address came out carrying it** — on
> something that gets printed on a label. Both the paste box and the Telegram
> bot shared the parser, so both had it. That is why Task 1 is the parser and
> nothing else.
>
> ### What the plan got wrong
>
> **Task 7 said three workflows. It is four** — the reconcile sweep was built
> after this plan was written.
>
> **Task 8 Step 1 was a one-liner hiding a design fork.** The number-ready
> email's "already sent" state has no home for an order with no Orders sheet
> row, and `Decide Sends` runs in PARALLEL with registration, so the parcel
> row does not exist when it runs. Making them sequential is worse: on the
> common night when nothing needs registering, the email branch would never
> run at all. **Resolved by Lester: send it from the registration branch**,
> which is also where the carrier status is known, which the late-address
> rule needs anyway.
>
> ### Traps worth more than the code
>
> **An APPEND needs `columns.schema` with `defineBelow`; an UPDATE does not.**
> Every other stamp here is an update, so this surfaced on the one append.
> Fix: `autoMapInputData` with `value: {}`.
>
> **⚠ A FAILED APPEND LEFT A PARCEL REGISTERED WITH NO ROW**, and the guard
> against double-registration is "a parcel is registered if it has a row" —
> so the retry registered it twice. An extra 2¢ and a duplicate subscription
> Shippo offers no way to delete. Harmless only because every decision is
> idempotent. At volume, write the row before the Shippo call instead.
>
> **`updateNodeParameters` with `replace: true` replaces the WHOLE parameter
> object** — it silently dropped a node's `authentication` and `documentId`.
> The publish gate caught it; the edit did not.
>
> **`Read Parcels` must be `executeOnce`** wherever it is chained after a
> multi-item Sheets read, or it runs once per order.
>
> **A repoint should land clear of a scheduled run.** The 21:30 trigger fired
> seconds before a publish, so one real run used the old version.
>
> ### What the restructure bought
>
> One row per parcel means two parcels of an order delivered seconds apart
> touch **different rows**, so the delivered-email race is gone by
> construction rather than mitigated. It also made staleness per parcel
> instead of per order, and removed the need for any database write path.
>
> ### Still open
>
> - **Old per-order columns are still on the Orders tab**, to be retired a
>   week after the cutover in a change of their own.
> - **Unproven live:** a Sales Ops order with no address staying silent; an
>   order carrying both a website id and a typed address sending once; the
>   late-address `Delivered` branch; and recovery of a missed *delivery*.
> - **The typed address remains the weak point.** A typo does not error.

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

- [x] **Step 1: Read the current header row of the Orders tab and record it**
- [x] **Step 2: Create the tab** with `trackingNumber` · `source` · `orderRef` · `status` · `statusAt` · `registered` · `transitEmailed` · `deliveredEmailed`. Remember a Sheets grid has a fixed column count — widen with `appendDimension` before writing past the last column.
- [x] **Step 3: Migrate** whatever per-order state exists into one row per parcel, and verify each parcel's status and emailed flags survive exactly.
- [x] **Step 4: Leave the old per-order columns in place.** They are retired in Task 9, a week later, in a separate change.

### Task 6: Repoint the decision module

**Files:** modify `parcel-status.js` · `tests/parcel-status.test.js` (GMG repo)

- [x] **Step 1: Write the failing tests** — the same behavioural table as today, against one row per parcel instead of newline sets. The `MOVING` rule, the never-announce-a-delivered-parcel rule, the outstanding count and the unknown-status rule must all survive unchanged.
- [x] **Step 2: Implement until green**, then run the whole suite.
- [ ] **Step 3: Delete the set-parsing helpers** only once nothing imports them — grep the repo and both Code nodes first.

### Task 7: Repoint the three workflows

> **⚠ EXECUTED 2026-10-21 — FOUR workflows, not three, and all verified live.**
>
> The reconcile sweep was built after this plan was written, so it had to be
> repointed too. All four now read the parcels tab.
>
> **Registration got simpler, not harder.** It now APPENDS one row per
> parcel instead of rewriting a per-order cell. An append does not read
> first, so the read-modify-write that caused the delivered-email race is
> gone from that branch entirely.
>
> **`Read Parcels` is `executeOnce` in all three places it was chained after
> a multi-item Sheets read**, or it would have run once per order.
>
> **⚠ `updateNodeParameters` with `replace: true` replaces the WHOLE
> parameter object.** It silently dropped `authentication: serviceAccount`
> and `documentId` from the append node, which then fell back to OAuth2.
> Publishing refused it and named both — the publish gate caught what the
> edit did not.
>
> **Verified live, on the published versions:**
> - the nightly run found both shipments, emailed nothing and registered
>   nothing — the existing parcel row was recognised
> - the sweep read the parcels tab and stayed silent
> - a backdated parcel was picked up by reconcile, looked up at Shippo,
>   replayed into the receiver, and **the receiver wrote the parcels row**:
>   statusAt moved from the backdated value to the current Manila time with
>   the emailed flags untouched
>
> **⚠ One real run slipped through on the OLD version.** The 21:30 schedule
> fired seconds before the publish landed. It did nothing either way, but it
> is why a repoint should be published before the next scheduled run, not
> during it.

- [x] **Step 1:** registration branch, receiver, sweep and reconcile all read and write the parcels tab. Inline the module body flat, wrapper stripped; verify behaviourally.
- [x] **Step 2: Prove the WEBSITE path still works end to end before anything new is enabled.** It is the one already keeping a promise to real customers. A regression here is worse than the feature being late.

---

## PHASE 3 — switch Sales Ops orders on

### Task 8: Go live

> **⚠ EXECUTED 2026-10-22 — Sales Ops orders are live, and two things bit.**
>
> **The number-ready email is sent from the REGISTRATION branch**, decided by
> Lester after the fork was put to him. Decide Sends and Decide Registrations
> run in parallel, so the parcel row does not exist when Decide Sends runs,
> and making them sequential would stop the email branch on every night that
> nothing needs registering. Registration is also where the carrier status is
> known, which the late-address rule needs anyway.
>
> **A Sales Ops parcel's number-ready state is `numberEmailed` on the parcel
> row**, because a Sales Ops order has no Orders sheet row. A website parcel's
> row is written `numberEmailed: yes` at birth so nothing ever thinks it is
> outstanding — that email still belongs to Decide Sends.
>
> **⚠ AN APPEND NEEDS `columns.schema` WITH `defineBelow`; AN UPDATE DOES
> NOT.** Every other stamp in this system is an update, which is why this
> only surfaced on the one append. The node's own error named the fix:
> `autoMapInputData` with `value: {}`, which works because Collect Registered
> already names its fields exactly after the parcels columns.
>
> **⚠ THE FAILED APPEND LEFT A PARCEL REGISTERED WITH NO ROW.** Shippo had
> taken the registration before the row was written, so the guard that
> prevents a second registration — "a parcel is registered if it has a row" —
> had nothing to see. The retry registered it a **second time**: one extra
> 2¢ and a duplicate subscription that cannot be deleted (Shippo has no
> DELETE for tracks). Harmless here only because every decision is
> idempotent: a repeated `record` rewrites the same status, and `deliver` is
> guarded by `deliveredEmailed`. **If this recurs at volume, add the row
> before the Shippo call and remove it on failure** — the opposite of the
> current order, and a trade: a crash between the two would then leave a row
> for a parcel that is not subscribed.
>
> **Verified live:** the endpoint returned both shipments; the Sales Ops one
> registered, appended exactly one row, emailed the owner's address
> (SMTP `250 OK`) and stamped `numberEmailed`. Two parcel rows, no duplicate.
>
> **Also proven, unprompted:** a genuine carrier scan arrived overnight
> (`isTest: false`), resolved against the new parcels tab, decided `record`
> because the parcel was still in transit, and wrote the row. The push path
> is now proven end to end on real carrier data.

- [x] **Step 1:** registration now covers Sales Ops shipments. Watch the first one register, and confirm **exactly one** parcels row appears.
- [x] **Step 2: One real order, the owner's own address first.** Record the customer's real address before changing it, and restore it the moment the test is done — a delivery scan can land at any time, and whoever is in the field at that moment receives the email.
- [x] **Step 3: Branch registration on the status it gets back** — *built; the Delivered branch is not yet exercised live*

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
- [x] **Step 2: Update the memory cards** — `ecommerce-stores.md`, `sales-ops-webapp.md`, `n8n-workflows.md`.
- [x] **Step 3: Add an EXECUTED banner** to the top of this plan naming every step that turned out wrong. That banner is the most valuable part of these documents.

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
