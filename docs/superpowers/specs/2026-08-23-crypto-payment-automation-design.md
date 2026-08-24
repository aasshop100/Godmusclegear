# Crypto Payment Automation — Design

**Date:** 2026-08-23
**Status:** Approved, not yet implemented
**Scope:** God Muscle Gears storefront + n8n on the Oracle Cloud VM

## Problem

Crypto payment is entirely manual. An order produces an email and a Telegram
message; the customer is then told "we will contact you shortly with secure
payment instructions". Lester sends an address by hand, waits for a screenshot
as proof, checks the wallet himself, and confirms the order manually.

The cost being addressed is Lester's own labour. Customer-facing friction and
payment errors are welcome side benefits, but they are not the driver.

## Goals

- Remove the manual steps: sending addresses, chasing proof of payment, and
  checking whether funds arrived.
- Cover **both** coins actually used — USDT and BTC. A solution covering only
  one leaves the majority of the manual work in place.
- Never create a path where software can release goods on its own.

## Non-goals

- Card payments. No legitimate processor will serve this catalog; see the
  session discussion. Not revisited here.
- Automatic fulfilment. The system reports payment; a human ships.
- Replacing the existing EmailJS and Telegram order notifications. Those keep
  working exactly as they do; this adds a second, later "payment confirmed"
  notification.

## Decisions

| Decision | Value | Rationale |
|---|---|---|
| Coins | USDT (TRC-20) and BTC | The two actually used |
| Order store | Google Sheet | Already the house pattern; hand-inspectable and hand-fixable, which matters when money is involved |
| Quote expiry | 30 minutes | Long enough to withdraw from an exchange; short enough to cap BTC rate exposure |
| BTC confirmation | 1 confirmation | Effectively irreversible at these order sizes without making customers wait |
| USDT confirmation | On-chain arrival | TRC-20 finality is immediate |
| Amount uniqueness | Randomised low-order digits | Enables matching without per-order wallets |
| Poll interval | 2 minutes | Well inside free API rate limits |

### BTCPay Server was considered and rejected

BTCPay is the obvious candidate and does not fit. It has no native USDT
support, so it would automate only the Bitcoin half and leave the larger USDT
half exactly as manual as today. It also needs 2 cores / 4GB RAM / 80GB SSD for
a pruned node, while the existing Oracle VM is an `E2.1.Micro` with 1 OCPU and
1GB RAM that already needs swap to keep n8n alive. Adopting BTCPay would mean
provisioning a second server **and** still building the entire USDT watcher by
hand. It can be added later for BTC without discarding any of this design.

### Accepted risks

Both were raised and consciously deferred by the owner on 2026-08-23:

1. **The receiving addresses are exchange deposit addresses.** On-chain history
   for the BTC address shows 59 transactions with every deposit immediately
   swept, which is the exchange-deposit signature. Exchanges can rotate or
   reassign such addresses. If that happens the watcher polls a dead address and
   confirms nothing, while payments still credit the exchange — a silent
   failure. Mitigation deferred; see Future enhancements.
2. **Chain-analytics exposure.** Routing this store's proceeds directly into a
   KYC'd exchange account attaches Lester's verified identity to flows that
   analytics vendors are built to flag, risking account freezes and suspicious
   activity reports. Self-custody receiving addresses would reduce this and also
   fix risk 1. Deferred by owner decision.

### Cart totals are not recomputed server-side

n8n records the total the browser sends rather than recomputing it from the
catalog. A tampered request could therefore book a large order at a small price.

This is accepted deliberately. Every order is reviewed by hand before shipping
and the sheet shows items and amount side by side, so a mismatch is visible.
Closing the hole properly would require maintaining a price-list tab mirroring
all 134 products, which is ongoing work to defend against an attack that has
never been attempted against this store. Revisit if fulfilment ever stops being
manual.

## Architecture

| Component | Location | Responsibility |
|---|---|---|
| Orders sheet | Google Sheets | The list of orders and their payment state. The only new datastore. |
| `create-order` | n8n webhook workflow | Locks a rate, assigns a unique amount, writes the order row, returns payment details |
| `payment-watcher` | n8n scheduled workflow, every 2 min | Polls Tron and Bitcoin, matches payments to open orders, confirms or alerts |
| Checkout | `checkout.html` + `script.js` | Customer selects coin; submit POSTs to `create-order` |
| Payment panel | `order-success.html` | Address, exact amount, QR, countdown |

Receiving addresses, the Sheet ID, and API keys live in n8n configuration.
**They are deliberately not committed to this repository, which is public.**

## Order flow

1. Customer selects **USDT (TRC-20)** or **Bitcoin** at checkout. The existing
   single "Crypto" radio is split into these two; "Bank Transfer" is unchanged
   and continues to be handled manually.
2. Submit POSTs the order to the n8n `create-order` webhook.
3. `create-order`:
   - fetches the BTC/USD rate from CoinGecko (BTC orders only)
   - computes the payable amount and adjusts its low-order digits until the
     value is unique among all rows currently `AWAITING_PAYMENT` for that coin
   - writes the order row with `status = AWAITING_PAYMENT` and
     `expiresAt = now + 30 minutes`
   - returns `{ orderId, coin, address, expectedAmount, expiresAt }`
4. The browser redirects to `order-success.html`, which renders the address, the
   exact amount, a QR code and a live countdown to expiry.
5. The existing customer email, owner email and Telegram message fire as they do
   today, now also carrying the payment details.
6. `payment-watcher` polls; on a match it sets `status = PAID` and sends a
   Telegram alert: `💰 PAYMENT CONFIRMED — Order #<orderId>`.

## Amount matching

Per-order wallet addresses are not used, so orders are distinguished by amount.
Each order's payable amount is nudged and checked for collisions against open
orders before being issued:

- **USDT** — randomised cents. `$512.68` becomes e.g. `$512.73`.
- **BTC** — 8-decimal amount with a randomised satoshi tail. Collisions at that
  precision are vanishingly unlikely, but the same uniqueness check is applied.

The watcher reads recent inbound transfers for both addresses:

- **USDT** — TronGrid, `GET /v1/accounts/{address}/transactions/trc20`, filtered
  to the USDT contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`
- **BTC** — mempool.space, `GET /api/address/{address}/txs`, which reports
  confirmation status

It matches an incoming amount **exactly** against open orders for that coin.

A `processed_tx` tab records every transaction hash the watcher has handled, so
a transaction is never counted twice across polls.

### Near-matches: withdrawal fees deducted at source

Exchanges commonly deduct the network fee from the amount withdrawn, so a
customer instructed to send `512.73` may have `511.73` arrive. Exact matching
alone would miss these routinely and generate constant false unmatched-payment
alerts.

The watcher therefore runs a second pass. When no exact match exists, it looks
for a single open order whose expected amount is within **2%** above the amount
received. If exactly one candidate is found the order is set to `REVIEW` and the
alert names it explicitly — "received 511.73, closest open order #1234 expects
512.73, short by 1.00" — so confirming it is a one-tap decision rather than an
investigation. If zero or more than one candidate is found it is reported as an
ordinary unmatched payment.

A near-match is **never** auto-confirmed. Only exact matches set `PAID`.

The payment panel and both order emails must also instruct the customer to
ensure the exact amount **arrives**, warning that some exchanges deduct fees
from the amount sent. This reduces near-matches at the source rather than only
handling them after the fact.

## Failure handling

Every row here represents real money, so none of these may fail silently.

| Situation | Behaviour |
|---|---|
| Amount matches an open, unexpired order | `status = PAID`, Telegram confirmation |
| Amount matches an **expired** order | `status = REVIEW` + alert. Late money is never discarded |
| Amount matches no open order | Unmatched-payment alert with tx hash and amount |
| Amount is less than expected, within 2% of exactly one open order | `status = REVIEW` + alert naming that order and the shortfall. Never auto-confirms |
| Amount is less than expected, no single candidate | Reported as an unmatched payment |
| Amount exceeds expected | `status = PAID` + alert noting the overage |
| Order reaches `expiresAt` unpaid | `status = EXPIRED` on the next sweep |
| Tron or Bitcoin API unreachable | Log and retry next poll; alert after 3 consecutive failures |

**Nothing auto-ships.** The system reports that payment arrived; releasing the
order remains a human decision. A matching bug costs a Telegram message, not a
parcel.

## Orders sheet schema

Tab `Orders`:

`orderId · createdAt · expiresAt · status · coin · address · expectedAmount ·
usdTotal · btcRate · customerName · email · phone · items · shippingTotal ·
packageCount · paidAt · txHash · notes`

`status` is one of `AWAITING_PAYMENT`, `PAID`, `EXPIRED`, `REVIEW`.

Tab `processed_tx`:

`txHash · coin · amount · seenAt · matchedOrderId`

## Site changes

- `checkout.html` — the "Crypto" payment option splits into "USDT (TRC-20)" and
  "Bitcoin".
- `script.js` — checkout submit POSTs to `create-order` and carries the returned
  payment details to the success page.
- `order-success.html` — gains the payment panel: address, exact amount, QR,
  countdown.
- Copy — `order-success.html` currently says "We'll contact you shortly with
  secure payment instructions"; payment details are now shown immediately.
- `faq.html` — currently claims "Bitcoin and other major coins". Correct this to
  the two coins actually accepted.

## Trust boundary

n8n only ever **reads** public blockchain data. It holds no private keys, no
seed phrases and no wallet credentials, and nothing in this design can move
funds. The worst outcome of a total compromise of the n8n instance is false
payment confirmations — which is precisely why fulfilment stays manual.

## Testing

- Unit-testable pure logic — amount uniqueness, collision avoidance, and the
  match/underpay/overpay decision — is extracted into plain functions and tested
  with `node --test`, following the pattern established by `shipping.js`.
- End-to-end verification uses small real payments (a few dollars of USDT) to
  confirm the watcher detects, matches and alerts correctly.
- Failure paths are verified deliberately: an unmatched payment, a deliberate
  underpayment, and a payment made after expiry.

## Future enhancements

Not built now; recorded so the reasoning survives.

- **Address health check** — alert if a configured address stops returning data,
  addressing the silent-failure half of accepted risk 1.
- **Self-custody receiving addresses** — addresses both accepted risks.
- **BTCPay Server for BTC** — if Bitcoin volume ever justifies a dedicated
  server and node. Slots in alongside the USDT watcher without rework.
- **Server-side cart recomputation** — if fulfilment ever stops being manual.
