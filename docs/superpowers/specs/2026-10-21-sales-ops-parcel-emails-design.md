# Parcel emails for every order — design

> **No spreadsheet IDs, URLs, secrets or credential names in this file.** This
> repository is public. Identifiers live in local notes.

**Status:** designed 2026-10-21, not yet built.

> Builds on `2026-10-21-parcel-status-emails-design.md`, which covers the
> three customer emails and how they are decided. This one extends them to
> orders that never went through the website, and restructures where parcel
> state lives so that is safe.

## The problem

A customer who orders **off the website** — by chat, by Telegram, by phone —
is entered straight into Sales Ops. There is no website order behind them, so
they have no `websiteOrderId`, so they are invisible to every one of the three
parcel emails. They get silence from the moment they pay until the box turns
up.

That is the overwhelming majority of orders. The emails built on 2026-10-21
reach only the small website slice.

## Scope

**In:** any Sales Ops order that has been given an email address. The same
three emails, the same sender, the same templates.

**Out:** orders with no email address — they stay exactly as they are today,
silent and untouched. Nothing about the payment emails, the daily post, the
inventory feed or `/api/tracking-import` changes.

**Decided by Lester, 2026-10-21:** one sender and one set of templates for
both kinds of order. No second brand, no second SMTP identity.

> **⚠ This means customers who did not buy through the storefront will
> receive GOD MUSCLE GEARS branded email.** That is deliberate and was put to
> Lester explicitly before this was designed. Do not "fix" it later by
> inventing a second brand without asking him again.

## Decisions taken before design

| Question | Decision |
|---|---|
| Sender and templates | **Identical** for both order types |
| Which Sales Ops orders qualify | Those with an email **and no** `websiteOrderId` |
| Where the email comes from | **Typed by hand** — there is no customer-typed source |
| Where parcel state lives | **The sheet**, one row per parcel |
| An order with no email | **Silent.** No alert, no nag |

## Why the state has to move

**n8n cannot write to Sales Ops, and it must not learn how.**

Website orders work today because their state lives in a sheet n8n already
writes to. Sales Ops orders live in the database. The only route that writes
there is the nightly importer, which carries a blind-upsert bug fixed on one
branch and missed on the identical one, a compare-and-swap guard, hang
timeouts and a deliberate silence discipline. **Adding a second writer into
that same row is the single most likely way to break this app.**

So Sales Ops stays **read-only to n8n**, exactly as it is now, and all mutable
parcel state moves into the sheet.

### One row per parcel

A new tab keyed by **tracking number**, one row each, holding the parcel's
status, whether it is registered with the carrier, and which emails it has
had. A `source` column says whether it came from a website order or a Sales
Ops one, and a reference column says which.

This is not only plumbing for the new order type. It closes a hole the
previous build left open on purpose:

- **It kills the delivered-email race.** Today `deliveredEmailed` is one cell
  holding a set, read and rewritten across a ~2.5–3 second window. Two parcels
  of the same order delivered inside that window lose a stamp and send a
  duplicate. With one row per parcel they write different rows and **cannot
  collide by construction.**
- **It fixes staleness granularity.** The reconciliation sweep currently
  judges staleness per *row* because `parcelStatusAt` is one cell for the
  whole order. Per-parcel rows make it per parcel, which is what it always
  meant.
- **It needs no database write path.**

The previous spec named an append-only event log as the remedy for the race.
**One row per parcel is better** and is chosen instead: the log still leaves a
narrower race for the same number arriving twice, and it does nothing for the
staleness problem.

### ⏰ Do this with nothing in flight

A parcel mid-journey when the state moves either loses its delivered email or
gets it twice. **Wait until no registered parcel is outstanding**, then
restructure. Migrating one parcel's state is trivial; migrating fifty is a
project. The window is early, not late.

## Data model

### Sales Ops — one optional field, read-only to everything else

```ts
// The address to send parcel emails to. Absent on orders that should stay
// silent. Typed by hand: unlike a website order there is no checkout form
// the customer filled in.
customerEmail?: string;
```

Optional, so existing orders lack it and no migration runs — the same pattern
as `cancelled?`, `noTrackingNeeded?` and `websiteOrderId?`.

> **⚠ ADD IT TO `normalizeOrder` IN THE SAME CHANGE.** That function rebuilds
> every order from an allow-list and silently drops anything unlisted, and it
> runs on every cloud load. `websiteOrderId` was missed there and the link
> vanished on every page load for five days before anyone understood why.
> This is the second time; there must not be a third.

### The parcels tab

| Column | Holds |
|---|---|
| `trackingNumber` | the key, one row per parcel |
| `source` | `website` or `salesops` |
| `orderRef` | the website order id, or the Sales Ops order id |
| `status` | the latest carrier status for this parcel |
| `statusAt` | Manila timestamp of the last status write |
| `registered` | whether the carrier is pushing updates for it |
| `transitEmailed` | whether the on-its-way email covered it |
| `deliveredEmailed` | whether the delivered email was sent |

Timestamps stay **Philippine local with no offset**, matching every other
timestamp in that spreadsheet.

**The per-order columns added on 2026-10-21 are retired by this change.**
Leave the headers in place until the new tab has run clean for a week, then
remove them in a separate change — never in the same one as the cutover.

### Where the address is resolved

**At send time, from the order — never copied into the parcels tab.** A copy
goes stale the moment an address is corrected, and a stale address sends a
stranger someone else's parcel details.

- `source: website` → the storefront Orders row, where the customer typed it
- `source: salesops` → the shipments endpoint, which now returns it

That costs the receiver one extra lookup for Sales Ops parcels. Worth it.

## The endpoint

The existing read-only, secret-gated shipments endpoint is **extended, not
replaced**. It already returns website orders that have tracking numbers. It
now also returns Sales Ops orders that have `customerEmail` **and no**
`websiteOrderId`, carrying the address so the receiver can resolve it.

**One rule prevents a double send:** an order with both a `websiteOrderId` and
a typed `customerEmail` is treated as a **website order only**. The website
order is where the customer typed their own address; the hand-typed field is
a fallback for orders that have no such source. It never competes.

> This is the one place the endpoint stops being free of customer data. It
> was built to return none, deliberately. Returning an address for Sales Ops
> parcels is a real change to that property and is accepted because there is
> no other source — but the endpoint stays secret-gated and read-only, and it
> must never start returning addresses for website orders, which already have
> a better source.

## ⚠ An address added LATE must not send the wrong email

The address is only a flag, so nothing cares when it is set. An order given
one a week after it shipped simply becomes eligible on the next nightly run
and **starts the sequence from the beginning** — registering the parcel and
sending "your tracking number is ready", which says the label has just been
created and the parcel is on its way to the carrier. By then it may be
halfway across the country.

**And if the parcel is already delivered, that wrong email is the ONLY one
the customer ever gets.** The delivered email fires from a carrier callback,
a delivered parcel is terminal so no callback is coming, and the
reconciliation sweep deliberately skips `Delivered` — which is exactly what
stops it re-checking every parcel ever shipped. So the right email never
arrives and nothing reports it.

**The fix costs nothing, because registration already knows.** The
registration response carries the parcel's current status — the same fact
that closed the first-callback race. Branch on it:

| Status at registration | What happens |
|---|---|
| `Delivered` | **Send nothing.** Mark all three emails as already sent so none fires later, and Telegram the owner once: an address was added to a parcel that has already arrived. The customer has the box; silence is correct. |
| Moving (`In Transit` / `Accepted`) | Send the number-ready email as normal. The on-its-way email follows shortly after — slightly redundant, not wrong. |
| `Label Created` / anything else | Exactly as designed. |

This is the difference between "adds a late address" being a silent
wrong-email case and a handled one.

## ⚠ The typed address is the weak point

For a website order the address comes from where the customer typed it. Here
it is typed by hand, and the failure mode changes:

- **Before:** the wrong order is linked → the status gate catches it and
  reports, because an `EXPIRED` or unknown order is visible.
- **Now:** a mistyped address → **silent**. It bounces, or it reaches a real
  stranger holding someone's tracking number and delivery address. Nothing
  errors.

Accepted, because there is no alternative source. Mitigations that are cheap
and worth taking: trim and lower-case on save, reject anything without a
plausible shape before the first send, and show the address in the owner's
own Telegram confirmation so a typo is visible once rather than never.

**An order with no email stays silent and raises nothing.** A nag for every
Beligas order would train the owner to ignore the alert channel, which is the
same channel that reports genuine send failures. The cost is that a forgotten
address is invisible — accepted knowingly.

## What does NOT change

- The three emails, their copy and their rules — including that the delivered
  email **reports** rather than asserts, and that the tracking-number email
  announces the **number**, not a shipment, with no estimate of when the
  carrier will scan it in.
- Registration guarded by set difference, because carrier registration is not
  idempotent and a duplicate costs a duplicate email and a duplicate charge.
- The authorisation gate: a callback for a parcel that is not registered is
  discarded and reported.
- Exceptions go to the owner, never the customer.
- Sales Ops stays read-only to n8n. `/api/tracking-import` is not touched.

## Accepted risks

- **A mistyped address fails silently.** The central risk of this feature.
- **Volume.** Roughly fifty tracked orders a period times three emails is well
  inside the sending limits, but it is a large step up from a handful of
  website orders, and it all comes from one address the storefront depends on.
- **Off-brand mail.** Customers who never used the storefront receive its
  branding. Lester's explicit decision.
- **The cutover.** Moving live state is the riskiest step; doing it with no
  parcel in flight is what makes it ordinary.

## Rollout

1. **Sales Ops `customerEmail`** — field, form input, `normalizeOrder`,
   endpoint. Ship it alone: **nothing consumes it**, so it is inert and
   addresses can start being collected immediately.
2. **Wait for no parcel in flight.**
3. **Build the parcels tab** and repoint the three workflows at it, migrating
   the per-order state that exists.
4. **Prove the website path still works** end to end before anything new is
   switched on — it is the one that is already keeping a promise.
5. **Enable Sales Ops orders**, one real order first, owner's own address,
   then restored.
6. **Retire the old per-order columns** a week later, separately.

**Rollback** at any point is removing the Sales Ops branch from the endpoint:
those orders stop qualifying, nothing is emailed, and the website path is
untouched.
