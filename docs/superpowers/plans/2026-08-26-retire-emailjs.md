# Retire EmailJS — Move All Order Email Into n8n

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Task 2 BUILT and verified 2026-08-26. `GMG - Create Order` now accepts every payment method; bank-transfer rows proven un-matchable. Tasks 3–6 not started. **Still unpublished.**

**Decided by Lester 2026-08-26:** go-live is delayed to do this first, rather than
pasting an EmailJS template that would later be thrown away.

**Depends on:** the crypto automation, fee tolerance, confirmation email and
status polling plans — all built. This plan **modifies the checkout path**, which
none of those did. It is the highest-blast-radius change in the project.

---

## Why

| | EmailJS today | n8n after |
|---|---|---|
| Volume ceiling | **200/month** = ~100 orders (2 emails each) | none |
| Templates | dashboard-only, unversioned, untestable until sent | in git, diffable |
| Sender | `aasshop100@gmail.com`, cannot be changed on a Personal Service | `admin@godmusclegears.com`, same as payment mail |
| Where it runs | the customer's browser | the server |
| Credentials | public key + template IDs shipped in client-side JS | none in the browser |

The volume ceiling is the strongest reason. Two emails per order against a
200/month cap is roughly **three orders a day** before genuine order mail stops
arriving — and the checkout reCAPTCHA is decorative (a known deferred bug), so
scripted junk orders could burn that quota without a single real sale.

Running in the browser is the second: close the tab at the wrong moment and the
email never sends. Nothing notices.

## The blocker this has to solve

**Bank-transfer orders never reach n8n today.** `script.js` calls the create-order
webhook only for USDT and BTC:

```js
if (paymentMethod === 'USDT' || paymentMethod === 'BTC') { ... }
```

Bank-transfer orders skip it entirely — no row, no trigger, nothing for n8n to
send from. So the checkout must call the webhook for **every** order, and
`GMG - Create Order` must be able to record an order without issuing a quote.

## Design

**One row per order, whatever the payment method.** The `Orders` sheet becomes
the record of all orders rather than only crypto ones — an improvement in its own
right.

**Bank-transfer rows get `status: BANK_TRANSFER`** and no `expectedAmount`,
`address` or `expiresAt`. They are excluded from payment matching by **two
independent guards**, which is deliberate:

1. `isMatchable()` only accepts `AWAITING_PAYMENT`, `PAYMENT_SEEN`, `EXPIRED`
2. the open-order filter requires a truthy `Number(o.expectedAmount)`

Either alone would do. Both means a typo in one cannot cause a bank-transfer row
to swallow a crypto payment. The expiry sweep and `makeUniqueAmount` are
similarly status-filtered and need no change.

**Item HTML is built server-side.** Today the browser assembles
`items_table_html` and posts rendered markup. The webhook should receive a
structured items array instead and build the table in n8n — version-controlled,
testable, and one less thing the browser can get wrong.

## Global constraints

- **Nothing about payment matching changes.** This plan touches order creation
  and email only. `payment-matching.js` and the watcher's `Match Payments` node
  are not modified. If a diff touches them, something has gone wrong.
- **The customer email keeps the conditional payment block.** Crypto orders show
  the address and amount; bank-transfer orders show "we will contact you". Same
  split as the EmailJS template, now expressed in n8n rather than Handlebars.
- **Never mention the auto-accept ceiling**, in any email, in any branch.
- **The Telegram Cloudflare Worker stays.** It is an independent notification
  path that does not depend on n8n, and this plan does not touch it.

## Two decisions to confirm before Task 2

**1. Keep the owner "new order received" email? — DECIDED 2026-08-26: KEEP.**

Lester wants both an email and a Telegram. Recorded here because I recommended
dropping it and was overruled for a good reason: email stays searchable years
later in a way Telegram does not.

- Goes to **aasshop100@gmail.com**, as today.
- **Includes the payment details.** EmailJS could not do this — it fired before
  the quote existed. In n8n the send happens after `Build Order`, so the owner
  notification can carry the exact amount and address the customer was quoted,
  which is what you need when matching a payment by hand.
- Source template preserved at `docs/emails/_source-emailjs-owner.html`. It
  carries `phone` and `whatsapp`, which the customer email does not, and has a
  **malformed nested `<tr>`** in the Pricing Summary that must be fixed in the
  port rather than carried across.

**2. What happens when the webhook fails? — DECIDED 2026-08-26: RETRY, then DEGRADE.**

Today, a create-order failure **aborts the crypto checkout** with an alert and no
order is placed. Bank-transfer orders are unaffected because they never call it.

After this change, that same failure would block *every* order, making n8n a
single point of failure for the whole store.

**Retry first.** Two retries about a second apart. Most real failures are
momentary — a container restarting, a tunnel reconnecting, a dropped packet — and
a retry turns those into a success the customer never sees. Today there is no
retry at all: one dropped packet kills the order. This is an improvement on
current behaviour, not a concession.

**Then degrade.** If the retries also fail, still complete the order, still fire
the Telegram Worker, and show the customer the pre-automation message: "we will
contact you shortly with payment instructions." That is the manual flow this
store ran on for months.

The deciding detail: `script.js` calls create-order **before**
`sendTelegramNotification`, and the abort path returns at the failure. So
aborting does not merely lose the order — Lester never finds out it happened. The
implementation must move the Telegram call **ahead of** the webhook call so it
fires regardless.

An outage should cost emails, never sales.

---

### Task 1: Confirm the two decisions

- [x] **Step 1: Owner email — KEEP**, to `aasshop100@gmail.com`, with payment details
- [x] **Step 2: Failure behaviour — RETRY twice, then DEGRADE**

---

### Task 2: Accept every order at the webhook

**Files:**
- Modify: n8n `GMG - Create Order` (`YTYSoa22Gu9L6NzC`), `Build Order` node

- [x] **Step 1: Branch on payment method instead of rejecting**

`Build Order` currently throws on anything that is not USDT or BTC:

```js
if (coin !== 'USDT' && coin !== 'BTC') throw new Error('unsupported coin: ' + body.coin);
```

Replace with a branch. For `Bank Transfer`, skip rate lookup, skip
`makeUniqueAmount`, and emit a row with `status: 'BANK_TRANSFER'` and empty
`coin`, `address`, `expectedAmount`, `expiresAt`.

Still throw on a genuinely unknown method — an unrecognised value is a bug, and
silently recording it as a bank transfer would hide it.

- [x] **Step 2: Keep issuing `statusToken` for every order**

Harmless for bank transfer and keeps one code path. The success page simply never
polls, because it has no quote to poll about.

- [x] **Step 3: Carry the fields the emails need**

The webhook body gains: `fullAddress`, `subtotal`, `discountLine`, `promoCode`,
`shippingNote`, and `itemsDetailed` — an array of
`{name, quantity, price, lineTotal}` rather than rendered HTML.

Add matching columns to the `Orders` sheet **by appending only**. Reordering
existing columns silently misaligns the watcher's update node, which maps by
header name.

> Use the throwaway-workflow method for header writes: an HTTP Request node
> against the Sheets REST API, `PUT .../values/Orders!<COL>1?valueInputOption=RAW`.
> Read `A1:Z1` first to confirm the target column is empty. n8n's Sheets node
> cannot write a header cell.

- [x] **Step 4: Re-verify the whole workflow**

This workflow has already had `returnAllMatches`, `resource` and `operation`
silently dropped from untouched nodes by one edit. After any change, re-fetch and
confirm `Read Open Orders` still has `options.returnAllMatches` — without it only
the first row is read, `makeUniqueAmount` sees one taken amount, and two open
orders can be handed the same payable amount.

---

### Task 3: The two emails in n8n

**Files:**
- Create: `docs/emails/order-received.html`
- Modify: n8n `GMG - Create Order`

- [ ] **Step 1: Write the template in the repo first**

Port `docs/emailjs-customer-template.html`, replacing Handlebars with n8n
expressions and building the items table from `itemsDetailed` in a Code node
rather than accepting HTML from the browser.

Keep both branches: crypto shows the payment block, bank transfer shows the
contact promise. Keep the fee line — *"If there's a fee when you send, add it on
top so the full X arrives."*

- [ ] **Step 2: Add the send node**

After `Append Order Row`, before `Respond With Quote`. Credential
`wbNyEh5HUE1ugRdl`, from `GOD MUSCLE GEARS <admin@godmusclegears.com>`.

**`options.appendAttribution: false`** — the `emailSend` node otherwise appends
"This email was sent automatically with n8n" to the customer's order email. This
was caught in production-shaped testing once already; pinned tests cannot catch
it, because pinned credentialed nodes never actually send.

**`onError: 'continueRegularOutput'`** — an email failure must never stop the
quote being returned. A customer who cannot pay is worse than one who did not get
an email.

Add the **owner** send node alongside it, to `aasshop100@gmail.com`, same
credential and same attribution/error settings. Port from
`docs/emails/_source-emailjs-owner.html`, fixing the malformed nested `<tr>`, and
add a payment-details block showing the quoted amount and address — the thing
EmailJS could never include, because it fired before the quote existed.

- [ ] **Step 3: Respond to the browser regardless**

`Respond With Quote` must still fire whether or not the email succeeded. Verify
by pinning the send node to an error.

---

### Task 4: Checkout calls the webhook for every order

**Files:**
- Modify: `script.js` — `handleCheckoutSubmit`

- [ ] **Step 1: Remove the payment-method gate**

Call `CREATE_ORDER_URL` unconditionally, sending `coin: paymentMethod` (now
including `'Bank Transfer'`) plus the new fields from Task 2 Step 3.

- [ ] **Step 2: Retry twice, then degrade**

Wrap the fetch in a small retry helper — three attempts total, roughly a second
apart. Only a sustained outage should reach the fallback.

On final failure: log, set `payment = null`, and **continue**. Do not alert, do
not `return`. The success page already handles a missing quote by showing the
original "we will contact you shortly" message.

**Move `sendTelegramNotification` ABOVE the create-order call** so it fires
whether or not the webhook succeeded. This is the whole point of degrading: the
current ordering makes a failure completely silent to Lester.

- [ ] **Step 3: Delete the EmailJS calls**

Remove `customerPayload`, `ownerPayload`, both `fetch` calls to
`api.emailjs.com`, the `_j(...)` template-id obfuscation helper, the public key,
and the `<script>` tag loading the EmailJS SDK if nothing else uses it.

**Leave `sendTelegramNotification` alone.** It is an independent path that does
not depend on n8n.

- [ ] **Step 4: Grep for leftovers**

```bash
grep -rn "emailjs\|EMAILJS\|template_0ry9w0v\|template_8x2z86l" --include="*.html" --include="*.js" .
```

Expect zero hits outside `docs/`. A stale SDK `<script>` tag is the likely
survivor.

---

### Task 5: Verify

- [ ] **Step 1: Pinned run — both order types**

| Pinned body | Expect |
|---|---|
| `coin: 'USDT'` | quote issued, row `AWAITING_PAYMENT`, email has the payment block |
| `coin: 'Bank Transfer'` | no quote, row `BANK_TRANSFER`, email has "we will contact you" and **no** address |
| `coin: 'Ethereum'` | throws — unknown methods must not be silently recorded |

- [ ] **Step 2: Assert the branches cannot cross-contaminate**

The bank-transfer email must contain no address and no amount; the crypto email
must not contain "we will contact you". Assert it, do not read it.

- [ ] **Step 3: Prove a bank-transfer row cannot match a payment**

Feed the watcher a pinned payment equal to a bank-transfer row's `usdTotal`.
Expected: **no match**. This is the safety property the whole design rests on.

- [ ] **Step 4: Two real orders, start to finish**

One crypto, one bank transfer, placed through the local checkout against the
published create-order webhook. Confirm both emails arrive from
`admin@godmusclegears.com`, in the inbox, with no n8n footer, and that the
success page behaves correctly for each.

Delete both rows by exact id afterwards.

- [ ] **Step 5: Prove the degrade path**

Temporarily point `CREATE_ORDER_URL` at a dead URL and place an order. Expect:
the order still completes, the success page shows "we'll contact you shortly",
the Telegram Worker still fires, and **no error is shown to the customer**.

This is the step most likely to be skipped and the one that matters most — it is
the difference between an n8n outage costing you emails and costing you orders.

---

### Task 6: Update the record

- [ ] **Step 1: Rewrite the go-live runbook**

`docs/GO-LIVE-RUNBOOK.md` still has EmailJS steps in pre-flight. Replace with
"no EmailJS", and add the bank-transfer order to the Step 7 verification.

- [ ] **Step 2: Delete the superseded artifacts**

`docs/emailjs-customer-template.html` — never pasted, now replaced.

- [ ] **Step 3: Update memory**

`ecommerce-stores.md` and `n8n-workflows.md`: EmailJS is gone, all order email
runs through n8n, and the `Orders` sheet now records bank-transfer orders too.

---

## Residual risks

- **n8n becomes the only email path.** Today EmailJS and n8n fail independently.
  After this, a VM outage means no order emails at all. Mitigated by the Telegram
  Worker still firing, and by degrading rather than aborting — you lose the email,
  never the order.
- **The checkout path is being modified.** Everything so far has been additive to
  systems the customer never touches. This changes the code that runs when someone
  spends money. Task 5 Step 4 exists for that reason and should not be shortened.
- **Duplicate orders on browser retry.** Nothing deduplicates a resubmitted
  checkout — the same exposure as today with EmailJS, neither better nor worse.
  Worth an `orderId`-based guard eventually, out of scope here.
- **Deliverability shifts slightly.** EmailJS sends as `gmail.com`, perfectly
  aligned. The alias is less so, though it was proven to inbox at an independent
  provider on 2026-08-26. Watch the first few real orders.
