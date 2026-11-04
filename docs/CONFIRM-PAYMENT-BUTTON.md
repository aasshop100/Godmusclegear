# Review -> PAID by one Telegram tap

**Live since 2026-11-04.** Two n8n workflows:

| Workflow | ID | What it does here |
|---|---|---|
| `GMG - Payment Watcher` | `UEIXJauCOKOhxIUh` | sends the alert that carries the button |
| `GMG - Confirm Payment` | `knwXYGN0tl2R67ct` | what the button talks to |

## Which payments get a button

Only the ones a human actually has to decide. `Is Review?` gates on
`newStatus === 'REVIEW'` **and** a non-empty `matchedOrderId`:

| Match type | Status | Button? |
|---|---|---|
| `EXACT` | PAID | no - already confirmed and emailed |
| `AUTO_UNDER` / `AUTO_OVER` (inside the flat ceiling) | PAID | no - same |
| `NEAR_UNDER` / `NEAR_OVER` (outside the ceiling, within 10%) | REVIEW | **yes** |
| `EXPIRED_MATCH` / `EXPIRED_NEAR` (money arrived after expiry) | REVIEW | **yes** |
| `PAYMENT_SEEN` (in the mempool, unconfirmed) | PAYMENT_SEEN | no - nothing to decide yet |
| `AMBIGUOUS` / unmatched | row untouched | no - there is no single order to confirm |

Putting a button on an auto-accepted payment would train the tap. The only
message that asks is the only message where the answer is not already known.

## Why it is a sibling, not an edit

`Ask To Confirm` hangs off `Log Matched Tx` **beside** `Alert Matched`, not
inside it. `Alert Matched` still carries the detail and still feeds
`Needs Customer Email?` -> the customer emails. Re-branching this way means a
change to the button can never stop the email chain running, which is what
would have happened if `Alert Matched` had been split or re-wired.

The cost is a second, shorter Telegram message per REVIEW. That was judged
cheaper than touching a chain that carries customer mail.

## The four rules `GMG - Confirm Payment` keeps

1. **Only a row still reading `REVIEW` can be confirmed**, re-read from the sheet
   at tap time rather than trusted from the message. A second tap, or a row
   already closed by hand, changes nothing and rewrites the message to say so.
   Without this guard a double tap sends the customer two confirmation emails.
2. **Only the owner chat may act.** Restricted on the trigger (`userIds`) AND
   re-checked in `Is Confirm Tap?`, because a button can end up in a group.
3. **The customer email states the EXPECTED amount, never the received one** -
   the same rule the watcher's own PAID email follows. Telling a buyer they
   underpaid and were let through teaches them the tolerance exists.
4. **Sheet updated but email failed is alerted loudly.** `Send Confirmed Email`
   is `continueErrorOutput` -> `Alert Confirm Email Failed`. The row reads PAID
   and the customer does not know it; that must never be silent.

`Ack Tap` is `continueRegularOutput` on purpose: it is only the Telegram
spinner, and a failed toast must not stop an order being marked paid.

## The email is a re-pointed copy of `payment-confirmed.html`

Same copy, but every `$("Match Payments")` is `$("Check Order")` - that node
does not exist in this workflow. Two deliberate differences:

- The BTC USD line reads `usdTotal` straight off `Check Order` instead of
  looking the row up again in `Read Orders`.
- "confirmed on the blockchain" is now just "confirmed". The money WAS on chain
  (REVIEW is about the amount or the timing, never about whether it arrived),
  but for a payment a human waved through, the plainer word is the honest one.

**If `docs/emails/payment-confirmed.html` changes, change this node too.** They
are two copies of one email and nothing enforces that.

## Proven 2026-11-04 against a real order

`ORDER-1793773311647` (first real USDT payment the store has ever taken - USDT
chain parsing had never run against real money before this). Watcher matched it
`NEAR_OVER`, over by 6.51, so REVIEW.

| Execution | Case | Result |
|---|---|---|
| 56238 | REVIEW row, owner taps | row -> PAID, `paidAt` stamped, note appended, SMTP accepted the customer address |
| 56239 | same order tapped again | `ok:false` "already PAID. Nothing changed." `Mark Paid` and `Send Confirmed Email` never ran |
| 56241 | a stranger's id taps, aimed at a different order | stopped dead at `Is Confirm Tap?` |

The two message-rewrite nodes were disabled for those runs only - the pinned
callback named a Telegram message that never existed - and re-enabled and
republished afterwards. **The Telegram leg itself (real tap -> real rewrite ->
button disappears) is still unproven; the next real REVIEW is that test.**
