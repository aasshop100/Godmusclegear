# Parcel status emails — design

> **No spreadsheet IDs, URLs, secrets or credential names in this file.** This
> repository is public. Identifiers live in local notes.

**Status:** designed 2026-10-21, not yet built.

> Builds directly on `2026-10-16-tracking-number-email-design.md`. That feature
> tells the customer their number. This one tells them what the parcel did
> next.

## The problem

A customer now receives their tracking number within 24 hours, and then hears
nothing until the box turns up. The storefront promises 4–7 business days; in
between there is silence.

The status already exists. Sales Ops has mapped Shippo's USPS states since day
one — `Label Created` · `Accepted` · `In Transit` · `Delivered` · `Exception`.
It is simply never sent anywhere.

**Two gaps make it unusable as-is.**

**Nothing refreshes status on a schedule.** Shippo is queried in exactly two
places: once, when the nightly importer first fills in a number, and whenever
the owner opens the app and presses Refresh. The importer's own source comment
admits it — *"nothing else in the app auto-refreshes Shippo status."* So most
stored statuses are fossils from the night the number arrived.

**Status is one field per order, not per parcel.** `combinedTrackingStatus`
collapses every parcel into a single value, and the importer's lookup reads
only `trackingNumber.split("\n")[0]` — the first number. Since this store ships
**one package per brand**, parcels two and three have never been looked at.

## Scope

**In:** website orders only — a row carrying `websiteOrderId` and at least one
tracking number. Two new customer emails, and one owner alert.

**Out:** Beligas orders stay untouched and invisible to this feature, exactly
as with the tracking-number email. The tag remains the whole filter.

**Not built:** no "out for delivery", no carrier other than USPS, no change to
the Sales Ops Tracking queue or its Refresh button. Making the owner's
dashboard self-updating is a worthwhile follow-up and is deliberately not this.

## Decisions taken before design

| Question | Decision |
|---|---|
| Which statuses reach the customer | In transit **and** delivered |
| Granularity | **Per parcel** |
| Grouping | **Delivered per parcel; in-transit combined** |
| Exception | Owner only, never the customer |
| Transport | Shippo `track_updated` webhook, not polling |

## Why push, not polling

Billing settles it. Shippo charges **per unique tracking number created
outside Shippo** — and every number here is external, because labels are bought
elsewhere and arrive via the order processor. A real invoice confirms the
rate and the unit: one `TRACK_FEE` line, $1.04, which is exactly 52 numbers at
2¢, and 52 matches the parcel count rather than the number of times Refresh was
pressed.

Registering a number once therefore covers **every** status change for that
parcel's whole journey. Polling several parcels several times a day would, at
best, cost the same and, at worst, bill per call — a question Shippo's docs do
not answer. Push removes the question.

It also removes the dependency that makes polling wrong on its own terms: with
status driven by the Refresh button, a customer's email waits on the owner
opening a browser tab. The 24-hour promise would quietly become "whenever
someone next logs in", and a week's worth of parcels would flip status at once,
making every timestamp meaningless.

**Verified 2026-10-21:** the account's live key authenticates against the
Webhooks API and returns zero registered webhooks, so nothing is half
configured and the capability is present.

## Architecture

Two transports, each matched to the grouping rule it has to satisfy.

```
Shippo track_updated  ──▶  n8n receiver (webhook)
                              │  validate → write parcel status
                              │  DELIVERED → send immediately, per parcel
                              │  EXCEPTION → Telegram, owner only
                              ▼
                        Orders tab (per-parcel status + sent sets)
                              ▲
                              │  read only, no Shippo call
      n8n sweep (schedule) ───┘
         one combined "on its way" email per order
```

**Delivered is per parcel, so it needs no grouping — it goes out on the scan.**
**In-transit must combine, so it waits for a sweep that can see several parcels
at once.** Trying to batch inside the webhook would mean a debounce timer in
n8n, which is a moving part that exists only to undo the thing the webhook is
for.

**The sweep never calls Shippo.** It reads status the receiver has already
written. Its only cost is time.

**Registration rides on the existing nightly workflow.** That job already
computes "numbers on this order that are new", which is precisely the set that
needs registering. No second detector.

## Data model

### Orders tab — five columns, appended at the end

| Column | Holds |
|---|---|
| `trackingRegistered` | numbers registered with Shippo, one per line |
| `parcelStatus` | `<number>=<status>` per line, the latest status per parcel |
| `parcelStatusAt` | Manila timestamp of the most recent status write |
| `transitEmailed` | numbers already covered by an in-transit email |
| `deliveredEmailed` | numbers already covered by a delivered email |

Appending stays safe: every Sheets node in the five live workflows maps columns
**by header name** with explicit values, so headers they do not name are never
touched. Verified for `trackingEmailed` on 2026-10-16 and unchanged since.

Timestamps follow the convention already in that sheet — **Philippine local
time with no offset**, like `createdAt`, `paidAt` and `trackingEmailedAt`. A
bare `new Date()` in the n8n container resolves eight hours out.

**Every one of these is a set, never a boolean.** The same reasoning that made
`trackingEmailed` a set: the work to do is a difference, so a second parcel, a
corrected number and a re-delivery all fall out of one rule with no special
case. A boolean would have to be unset by hand, and nothing would ever notice
it had not been.

**Why `trackingRegistered` is separate from `trackingEmailed`.** They diverge
the moment either side fails. A number can be emailed and not registered, or
registered and not emailed, and collapsing them would make one failure
permanently hide the other.

## Registration

Shippo requires the webhook to exist **before** any number is registered, and
its docs are explicit that **tracking webhooks are not idempotent** — a
duplicate registration produces duplicate notifications for the same event,
which here means duplicate customer emails and a duplicate charge.

So registration is guarded by set difference, like everything else:

```
unregistered = trackingNumbers − trackingRegistered
    empty                      → do nothing
POST each to Shippo
    success                    → append to trackingRegistered
    failure                    → leave it out, Telegram, retry next night
```

Appending only on success is the point. A number left out of the set is retried
tomorrow; a number wrongly added is never registered and goes silent forever.

## The webhook receiver

### Validation — the payload is not trusted

Shippo does not sign these callbacks, so the URL being hard to guess is not by
itself an authorisation. The real guard is cheap and strong:

**A payload whose tracking number does not already appear in some order's
`trackingRegistered` is discarded and reported.** Forging a status would mean
knowing both the endpoint and a genuine registered number.

Beyond that: the shape is checked, an unrecognised status is reported rather
than mapped to a default, and a number matching more than one order is reported
and left alone.

### What it does

```
on track_updated:
    number not in any trackingRegistered   → Telegram, stop
    write <number>=<status> into parcelStatus, stamp parcelStatusAt
    status DELIVERED  and number not in deliveredEmailed → send, then append
    status EXCEPTION                                     → Telegram, owner only
    anything else                                        → status written, silence
```

In-transit is written but not sent here. The sweep owns that email.

**Send first, then stamp** — unchanged from the tracking-number build. A stamp
that fails after a successful send costs a duplicate and an alert naming what
to fix by hand. Stamping first and then failing to send loses the email in
silence, and nothing would ever say so. Loud over tidy.

## The sweep

Runs on a schedule during waking hours in Manila, reads the Orders tab, and
sends nothing unless there is something to say.

```
for each website order:
    moving = numbers whose parcelStatus is In Transit or Accepted
    new    = moving − transitEmailed
        empty                        → silence
    send ONE email covering `new`
    append `new` to transitEmailed
```

Two parcels that start moving between runs produce **one** email naming both. A
parcel that starts moving a week later produces its own — which is correct, and
is why this is a per-run difference rather than a once-per-order flag.

`Accepted` counts as moving. It means the carrier has the parcel, which is what
the customer is being told.

## The emails

Both carry the shared visual shell, the group link, and the same SMTP
credential as the other six customer emails — one from-address, one
deliverability surface, one SPF record.

**Tracking numbers are text first, link second**, unchanged. The USPS deep link
lands on a blank Akamai block page on a plain left-click, and in an email every
click is a plain click.

### On its way

Names every parcel in `new`, states that the order ships as one package per
brand so multiple numbers are expected, and repeats **"allow 4–7 business
days"** — the same commitment the storefront and the tracking email already
make.

### Delivered

**⚠ The copy rule: report, do not assert.** USPS marks parcels delivered early,
and sometimes marks them delivered when they are not. An email flatly stating
"your package was delivered" against a parcel still on the truck creates a
dispute on a product the customer cannot complain about loudly.

So: **"USPS reports this parcel as delivered"**, naming the number, followed by
what to do if it has not arrived — check with the household and neighbours,
then reply, because USPS occasionally scans early. This mirrors the expiry
email's "never say cancelled" rule: the copy must not foreclose an outcome the
system will still honour.

Multi-parcel orders get one of these per parcel, so the email says which parcel
and how many remain outstanding.

### Exception — owner only

A seizure, a loss or a return is a reship conversation, not an automated email.
It goes to Telegram.

## Failure handling

Every send node gets `onError: continueErrorOutput` → output 1 → **its own**
alert node.

**Not a shared alert node.** `Alert Payment Email Failed` reads
`$("Match Payments")`, a node absent from other branches — reusing it would
fail precisely when a failure needed reporting. One alert per branch, each
naming its own upstream.

## Three traps to re-check — all three shipped silently last time

1. **A disabled n8n node passes its input through.** Dry-running with the send
   node disabled still runs the stamp, marking parcels as emailed while nothing
   was sent — after which the next run sees nothing new and the customer is
   never told. **Disable the stamp too, or disconnect it.**
2. **An emailSend node outputs the SMTP result**, not the data that fed it.
   Downstream nodes must read `$('<decision node>').item.json`, never `$json`.
3. **A UMD wrapper cannot run inside a Code node** — `module` and `window` are
   both undefined, so the wrapper builds the API and discards it. Shared logic
   goes in with the wrapper stripped and the body inlined flat, checked
   behaviourally rather than by hash.

## Reconciliation — the safety net push needs

A webhook that is never delivered is indistinguishable from a parcel that never
moved. Push alone means one dropped callback is silent forever, which is the
exact failure this whole chain exists to prevent.

So, nightly: for parcels registered more than a set number of days ago whose
`parcelStatus` is not `Delivered`, perform **one** Shippo lookup and reconcile.
This is the only place the new feature calls Shippo for status, it is bounded
by stale parcels only, and it is the mechanism that would have caught a missed
delivery.

## Testing

- **Receiver first, before any webhook exists.** Shippo's API Portal provides
  sample `track_updated` payloads; the receiver can be exercised end to end by
  posting them, including the unknown-number and unrecognised-status paths.
- **Bank transfer remains the way to test without paying.** That status is
  written at checkout with no money moving, and it is already in `SHIPPABLE`.
- **One real number, deliberately.** Registration and a genuine carrier scan
  cost 2¢ and are the only true test of the live path.
- **Required cases:** second parcel on an existing order · the same event
  delivered twice · a delivered parcel whose number was corrected afterwards ·
  two parcels moving between sweeps (must produce one email, not two) · an
  unknown number · a send failure.

## Accepted risks

- **USPS false or early "delivered".** Mitigated by wording, not by logic.
- **A duplicate Shippo registration doubles emails and charges.** Mitigated by
  the set guard; the failure mode is loud rather than silent.
- **Shippo may bill a `POST` separately from the `GET` the importer already
  makes.** Unconfirmed either way. The importer's lookup becomes redundant once
  the receiver is writing status, so if a second charge appears it is removed
  by deleting that call — a flag, not a redesign.
- **`TRACK_FEE` invoices are aggregated**, with carrier and tracking-number
  columns blank, so Shippo's bill cannot be audited per parcel. Registrations
  are logged on our side from the start; reconstructing them later is not
  possible.
- **Holidays.** "4–7 business days" excludes weekends but not Philippine or US
  holidays, like every other promise in this system. A human keeps it.

## Rollout

1. Append the five columns.
2. Build the receiver, unpublished; exercise it with sample payloads.
3. Create the Shippo webhook pointing at it.
4. Add registration to the existing nightly workflow; register **one** number.
5. Watch that parcel through a real scan with sends still disabled.
6. Enable delivered, then the sweep.
7. Add reconciliation last — it is the net, and a net goes up after the floor.

**Rollback** is deleting the Shippo webhook: registrations stop mattering, the
sweep finds no new statuses, and the tracking-number email is untouched
throughout.
