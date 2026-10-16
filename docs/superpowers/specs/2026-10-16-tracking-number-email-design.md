# Tracking-number emails — design

> **No spreadsheet IDs, URLs, secrets or credential names in this file.** This
> repository is public. Identifiers live in local notes.

**Status:** designed 2026-10-16, not yet built.

## The problem

On 2026-10-16 the order-confirmation and payment-confirmed emails began telling
customers their tracking number arrives **within 24 hours, excluding weekends.**
Nothing sends one. Every tracking number is released by the order processor
between roughly 7pm and 9pm Manila, lands in the Sales Tracker sheet, and is
imported into Sales Ops — and the customer is never told.

So the promise is currently kept by hand, or not at all.

## Scope

**In:** website orders only. A tracking number reaching a website order emails
that customer, automatically, the same night.

**Out:** Beligas orders (the overwhelming majority of Sales Ops rows) are
untouched and must stay untouched. This feature is invisible to them.

**Not built:** no delivery notifications, no "out for delivery", no carrier
other than whatever number was typed. Shippo already tracks status in Sales Ops
for the owner's benefit; the customer gets the number, not a status feed.

## Why the work splits across two systems

Sales Ops knows **when a tracking number appears**. It has no email sender, no
customer email address, and no branded template.

The GMG side knows **who the customer is** and already sends every other
customer email — four of them — from one SMTP credential with a from-address
the SPF record is built for, a shared visual shell, and a
`continueErrorOutput → Telegram` alert on every send.

So: **Sales Ops owns the tag. n8n owns the sending.**

The alternative — teaching Sales Ops to send email — means a second
from-address outside the SPF record, a second deliverability surface, and the
branded template maintained in two places. Rejected.

## Architecture

```
cron-job.org 21:30 Manila        (after the 7/8/9pm import window closes)
        │
        ▼
n8n  "GMG - Tracking Emails"
        │  1. GET  <sales-ops>/api/website-shipments?secret=…     read-only
        │  2. read the Orders tab
        │  3. new = numbers on the order − numbers already emailed
        │  4. send the email
        │  5. append the numbers + stamp the time on the Orders row
        │  6. any failure → Telegram
```

**`/api/tracking-import` is not touched.** That route is the most
concurrency-scarred code in Sales Ops — a blind-upsert bug fixed on one branch
and missed on the identical one, CAS conflicts, hang timeouts, and a deliberate
silence discipline. The new endpoint is additive and read-only, so it cannot
disturb the nightly fill. An outbound email does not belong inside a job whose
design goal is to say nothing.

**n8n never receives the Sales Ops database key.** The endpoint is gated by a
shared secret, the same pattern as the existing cron routes, and returns no
customer data — the email address comes from the Orders sheet.

**Accepted latency:** a tracking number typed into the app by hand at 2pm is
emailed at 21:30 that night. The numbers are released 7–9pm anyway.

## Data model

### Sales Ops — one optional field

```ts
// The GMG website order this row fulfils. Set by the picker; absent on every
// Beligas order. Its presence is what makes this a website order.
websiteOrderId?: string;
```

Optional, so existing payload orders lack it and no migration runs — the same
pattern as `cancelled?` and `noTrackingNeeded?`.

**Why an id and not an email field.** "Required" guarantees a value, not a
correct one; a typo bounces silently or reaches a stranger. An id resolves to
the address the customer actually typed at checkout, and it also yields
`packageCount`, which the email needs.

### Orders tab — two columns, appended at the end

| Column | Holds |
|---|---|
| `trackingEmailed` | the numbers already emailed, one per line |
| `trackingEmailedAt` | Manila timestamp of the most recent send |

Appending is safe for the four live workflows: every Sheets node maps columns
**by header name** with explicit values, so headers they do not name are never
touched.

`trackingEmailedAt` follows the convention already in that sheet — **Philippine
local time with no offset**, like `createdAt` and `paidAt`. Any reader must
treat it as UTC+8; a bare `new Date()` resolves in the reader's own zone, eight
hours out in the n8n container.

**Why the numbers and not a boolean.** The send set is a difference:
`numbers on the order − numbers already emailed`. That is what makes a second
parcel send its own email, and it makes a corrected tracking number resend
itself with no special case.

### Endpoint contract

`GET /api/website-shipments?secret=…` — read-only.

```json
[{ "websiteOrderId": "ORDER-…",
   "orderNumber": "Lester0925",
   "trackingNumbers": ["9400…", "9400…"] }]
```

Returns Sales Ops orders where `websiteOrderId` is set **and** at least one
tracking number is present. Carries no customer data.

### Where the picker gets its list

The picker shows website orders to choose from, and that list lives in the
Orders tab, which Sales Ops has never read.

It does not need a new integration. Sales Ops already reaches Google Sheets
through a **refresh-token grant on the owner's own Google account** — the same
identity that owns the Orders spreadsheet. So a second read needs only:

- a sheet id in an env var, beside the existing Sales Tracker one
- a reader alongside the existing one, following the same shape: no parsing, no
  matching, Sheets access and nothing else

No service account, no new sharing, no extra credential.

The picker lists orders whose status is `PAID` or `BANK_TRANSFER`, showing name,
date, total and items, and **greys out any id already present on another Sales
Ops order** — computed from Sales Ops's own rows, so the same website order
cannot be linked twice.

A manual id entry stays available as a fallback for when the read fails; the
feature must not become unusable because a sheet read timed out.

### One extraction, no behaviour change

`trackingNumbersFromText` (splits on newline, comma, semicolon, slash) is
currently a local function inside `page.tsx`, unreachable from an API route. It
moves to `src/lib/`, where `order-parser.ts` already lives for exactly this
reason — one parser, shared. The UI keeps importing it.

## The send rule

```
for each Sales Ops order with websiteOrderId AND a tracking number:
    find the Orders row by orderId
        not found                        → Telegram, send nothing
    status not PAID and not BANK_TRANSFER → Telegram, send nothing
    new = trackingNumbers − trackingEmailed        (exact match, trimmed)
        empty                            → silence
    send the email covering `new`
    append `new` to trackingEmailed, stamp trackingEmailedAt
        stamp failed                     → Telegram, naming order and numbers
```

**`BANK_TRANSFER` is included deliberately.** Those orders never reach `PAID` —
the watcher excludes them from matching by design — so gating on `PAID` alone
would silently skip every bank-transfer customer.

**The status gate guards a mis-tag.** A tracking number against an `EXPIRED` or
`AWAITING_PAYMENT` order means the wrong order was linked. It reports and sends
nothing rather than emailing a stranger.

**Send first, then stamp.** If the stamp fails after a successful send, the
worst case is a duplicate next run and a Telegram alert naming what to stamp by
hand. Stamping first and failing to send loses the email silently, and nothing
would ever say so. Loud over tidy, consistently with the rest of this system.

**Nothing to do says nothing**, matching the import job's silence discipline.

## The email

**The tracking number is text first, link second.** The USPS deep link often
lands on a blank Akamai block page on a plain left-click and only reliably works
on Ctrl/Cmd+click — and in an email every click is a plain click. So the number
is rendered large and selectable, which always works because it can be pasted
anywhere; the USPS link sits underneath as a convenience that may not cooperate.

Same branded shell as the other four emails.

- **First send** — "your order has shipped", the number(s), and when
  `packageCount` is greater than one, an honest line that the order ships in N
  parcels with the rest to follow. That sentence is there to prevent "where is
  the rest of my order?".
- **Later send** — "another parcel is on its way", carrying only the new number.

Which one is chosen depends on whether `trackingEmailed` was empty, so it needs
no extra state.

## Failure handling

Every failure path is a Telegram message, never a silent skip:

| Failure | Message says |
|---|---|
| Order id not found in the sheet | the id, and that the tag is probably wrong |
| Status not shippable | the id, the status, and that nothing was sent |
| Email send failed | the order, the numbers, and that the customer was NOT told |
| Stamp failed after a successful send | the order and numbers to stamp by hand, to stop a duplicate |
| Endpoint or sheet unreachable | the step that failed |

The email node uses `continueErrorOutput` into its own alert — not a shared one
— because a shared alert node that references another branch's data breaks
precisely when it is needed. That mistake was avoided in the expiry email on the
same day and is avoided here for the same reason.

## Testing

The decision layer is a **pure module in this repo with `node --test`** —
the set difference, first-versus-follow-up, the status gate, the not-found path,
multi-number parsing — then pasted into the n8n Code node and checked
byte-identical, the pattern established by `shipping.js` and
`payment-matching.js`.

Behavioural cases that must be covered:

1. one number, never emailed → one email, first-send wording
2. second number added later → one email, follow-up wording, only the new number
3. no new numbers → no email, no message
4. a corrected number → resends with the corrected value
5. `BANK_TRANSFER` order → sends
6. `EXPIRED` order carrying a number → no send, alert
7. unknown order id → no send, alert
8. multi-number field in one go → one email listing all of them
9. `packageCount > 1` on a first send → the parcel-count line appears

Live verification uses a real sample order placed through the website, which is
how the owner intends to test it.

## Accepted risks

- **A wrong tag emails the wrong customer.** The picker shows name, date, total
  and items, and greys out orders already linked, so the mistake has to survive
  a human looking at it. The status gate catches the common slip of linking an
  unpaid or expired order.
- **Duplicate on a stamp failure**, by deliberate choice over silent loss.
- **No bounce handling.** A dead address fails at SMTP and alerts; a *delivered
  but wrong* address cannot be detected.

## Rollout

1. Sales Ops: the field, the lib extraction, the Orders reader + sheet-id env
   var, the picker, the endpoint. Ships inert — no tagged orders exist, so the
   endpoint returns an empty list.
2. Orders tab: add the two columns.
3. n8n: build the workflow, test against a tagged order with the send node
   disabled, confirm the decision output.
4. Enable the send, run the owner's sample order end to end.
5. Schedule the 21:30 job only once a manual run has sent correctly.
