# Payment Status Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** BUILT and verified 2026-08-25. Workflow `GMG - Order Status`
(`1v3236DBmMZBL88h`) is live-but-**UNPUBLISHED**; `payment-status.js` has 18
tests; the success page polls and was verified across all four states plus the
endpoint-down degradation path.

**Depends on:** `2026-08-23-crypto-payment-automation.md` Tasks 1–6 (done).
Can be built before or after that plan's Task 8 (go-live). See
"Should this block go-live?" below.

---

## The problem

`order-success.html` renders the payment quote once and then never talks to the
server again. Confirmed by inspection: the file contains zero `fetch`,
`XMLHttpRequest` or `setInterval` calls.

So a customer who pays correctly sees this:

1. Panel shows "Send exactly 84.14 USDT" with a 30-minute countdown.
2. They pay. The watcher detects it within 2 minutes, flips the sheet row to
   `PAID`, and Telegrams Lester.
3. The customer's page knows none of that. The countdown keeps running down and
   then reads **"expired — message us on Telegram"**.

The customer who did everything right is shown an expiry notice and told to go
message support — which is the exact manual work this project exists to remove.

Three separate failures fall out of the same gap:

| Case | Backend truth | What the customer is shown today |
|---|---|---|
| Paid exactly | `PAID` | countdown, then "expired — message us" |
| Paid via Binance, short 1.50 | `REVIEW` | countdown, then "expired — message us" |
| BTC seen in mempool | `PAYMENT_SEEN`, expiry clock stopped | countdown still running toward "expired" |

That last row is a real semantic drift: the watcher deliberately stops the
expiry clock once a payment is visible in the mempool, because Bitcoin can take
hours to confirm. The frontend has no idea `PAYMENT_SEEN` exists and keeps
counting down against a clock the backend has already paused.

**Goal:** the success page reflects the order's real status, so a paying
customer is never told to go chase support.

---

## Decisions needed from Lester before building

**1. Add a `statusToken`?  — recommended: yes.**

`orderId` is generated as `'ORDER-' + Date.now()` (`script.js:393`) — a raw
millisecond timestamp. That is trivially enumerable: anyone can walk timestamps
and query the status endpoint for orders that are not theirs.

The response is deliberately minimal (status only, no PII — see Task 2), so
what leaks is order *volume and outcome*, not customer data. For this business
that is still worth not handing out.

Fix costs one column and about three lines: `Create Order` generates a random
`statusToken`, writes it to the sheet, returns it in the quote; the status
endpoint requires `orderId` + matching token or returns `NOT_FOUND`. This plan
is written **with** the token. To skip it, drop Task 1 Step 2 and the token
check in Task 2 — everything else is unchanged.

**2. Does this interact with the undecided Binance fee problem? — yes, and it
helps.**

The open question from the main plan is that Binance deducts 1.50 USDT from the
amount sent, so those orders land in `REVIEW` rather than auto-confirming.
Status polling does not fix the mismatch, but it changes what the customer
experiences when it happens: instead of a page that says "expired — message us
on Telegram", they get *"we've received your payment but the amount is slightly
short — we're checking it manually, please don't send again."*

That converts the Binance case from a support ticket plus a confused customer
into a status message plus one tap from Lester. It does not remove the tap. But
it does mean the Binance decision is less urgent than it looked — worth
weighing before choosing to auto-accept shortfalls, which carries real money
risk that this does not.

**3. Should this block go-live (Task 8)?  — recommended: yes, build it first.**

It is small (one workflow, one pure module, one page). And the failure it fixes
lands on *correctly paying customers*, which is the worst group to give a broken
experience to on day one. Shipping go-live without it means every crypto order
placed in the interim ends on an expiry notice.

---

## Architecture

Same shape as the rest of this project, for the same reason: the risky part is
pure and tested offline before it runs anywhere.

- **`payment-status.js`** — a pure module mapping a status string to the copy
  and UI state the panel should show. No DOM, no network. Unit tested with
  `node --test`, exactly like `shipping.js` and `payment-matching.js`.
- **`GMG - Order Status`** — a third n8n workflow. POST webhook, one filtered
  sheet read, returns a strictly allowlisted status object.
- **`order-success.html`** — polls that endpoint and re-renders the panel
  through the pure module.

**Why POST, not GET:** the endpoint is behind the Cloudflare tunnel. A GET is
cacheable and a cached "AWAITING_PAYMENT" served to a later poll would make the
page permanently wrong. POST is never cached and matches `create-order`.

## Global constraints

- **The endpoint is read-only.** It never writes to the sheet, never changes a
  status, never triggers anything. It answers one question.
- **Response is an allowlist, never a row dump.** Only `status`, `coin`,
  `shortfall` and `expiresAt` may leave the workflow. Never `email`,
  `customerName`, `phone`, `address`, `expectedAmount`, `items`, `txHash`.
- **`PAID` never implies shipped.** Nothing auto-ships; a human still releases
  the order. Copy must say "confirmed" / "being prepared", never "dispatched",
  "shipped", or "on its way".
- **`REVIEW` must never read as success or as failure.** It means "we have your
  money and a human is looking at it". It must explicitly tell the customer not
  to pay again — a customer who re-sends because they thought it failed creates
  a second unmatched payment and a refund problem.
- **Polling degrades silently.** Any network or parse failure leaves the page
  exactly as it renders today. A customer must never see an error banner
  because a poll failed.
- **Manila-naive timestamps.** `expiresAt` and `paidAt` are Philippine local
  time with no offset. Reuse the existing `parseManila` helper. A bare
  `new Date()` is 8 hours out on the n8n container and 12 in New York.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `payment-status.js` | Create | Pure status → view mapping. `statusView(status, opts)`. |
| `tests/payment-status.test.js` | Create | `node --test` unit tests for the above. |
| `order-success.html` | Modify | Load the module, poll, re-render the panel. |
| n8n `GMG - Order Status` | Create | POST webhook. One filtered read. Allowlisted response. |
| n8n `GMG - Create Order` | Modify | Generate + return `statusToken`; new sheet column. |
| Google Sheet `GMG Orders` | Modify | Add a `statusToken` column to `Orders`. |

---

### Task 1: `statusToken` on order creation

**Files:**
- Modify: Google Sheet `GMG Orders`, tab `Orders`
- Modify: n8n `GMG - Create Order` (`YTYSoa22Gu9L6NzC`)

**Interfaces:**
- Produces: `statusToken` in the quote response and in the sheet row, consumed
  by Task 2.

- [x] **Step 1: Add the column**

Append a `statusToken` header to the `Orders` tab, after `notes`. Append only —
the `Append Order Row` node maps by header name, and reordering existing columns
will silently misalign the watcher's update node.

- [x] **Step 2: Generate the token in `Build Order`**

In the `Build Order` Code node, add above the `return`:

```js
// The status endpoint is public and orderId is a plain timestamp, so it is
// guessable. This token is what actually authorises a status lookup.
function makeToken() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 24; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
```

and add `statusToken: makeToken(),` to the returned object.

- [x] **Step 3: Return it in the quote**

In `Respond With Quote`, add `statusToken` to the `JSON.stringify({...})`
allowlist alongside the existing five fields.

- [x] **Step 4: Re-verify the whole workflow**

`update_workflow` has silently dropped parameters from untouched nodes on this
project more than once — including `returnAllMatches` on a Sheets read node in
this exact workflow. After the edits:

```
get_workflow_details YTYSoa22Gu9L6NzC
```

Confirm, on nodes you did NOT edit: `Read Open Orders` still has
`options.returnAllMatches`, `Append Order Row` still has its full schema, and
`Order Webhook` still has its `allowedOrigins` list.

- [x] **Step 5: Verify end to end**

Create a test order against the webhook and confirm the response carries a
24-character `statusToken` and that the same value appears in the new sheet
column on the new row. Note the `orderId` — Task 2 needs it. Record it for the
go-live cleanup list; it must be deleted by exact id.

---

### Task 2: `GMG - Order Status` workflow

**Files:**
- Create: n8n workflow `GMG - Order Status`

**Interfaces:**
- Consumes: `{ orderId, statusToken }` POST body.
- Produces: `{ status, coin, shortfall, expiresAt }` JSON, consumed by Task 4.

- [x] **Step 1: Build the workflow**

Four nodes: `Status Webhook` → `Read Order` → `Build Status Response` →
`Respond With Status`.

`Status Webhook` — `n8n-nodes-base.webhook`, POST, path `gmg-order-status`,
`responseMode: responseNode`, `allowedOrigins`
`https://godmusclegears.com,https://www.godmusclegears.com,http://localhost:8899`.

> The localhost origin is for local verification only and goes on the same
> go-live removal list as the one on `Order Webhook`. Add it to that list in the
> main plan the moment you add it here.

`Read Order` — Google Sheets read on `Orders`, **filtered on `orderId`**, not a
full-sheet read. The sheet grows without bound and this endpoint is polled far
more often than any other; reading every row per poll is the one thing here that
will not scale.

- [x] **Step 2: Write `Build Status Response`**

```js
// Read-only. This node never writes, never mutates, and returns an explicit
// allowlist - the order row holds the customer's name, email, phone and the
// receiving address, none of which may ever reach the browser.
const body = $('Order Webhook' in $ ? 'Order Webhook' : 'Status Webhook').first().json.body || {};
const rows = $('Read Order').all().map(function (r) { return r.json; })
  .filter(function (r) { return r && r.orderId; });

const orderId = String(body.orderId || '');
const token = String(body.statusToken || '');
const row = rows.filter(function (r) { return String(r.orderId) === orderId; })[0];

// Same answer for "no such order" and "wrong token" - distinguishing them turns
// the endpoint into an oracle for which order ids exist.
if (!row || !token || String(row.statusToken) !== token) {
  return [{ json: { status: 'NOT_FOUND' } }];
}

// notes holds "short by 1.50" / "over by 0.30" on REVIEW rows. Surface only the
// number, never the raw note - it is an internal field.
let shortfall = '';
const notes = String(row.notes || '');
const m = notes.match(/^(short|over) by ([0-9.]+)$/);
if (m) shortfall = (m[1] === 'short' ? '-' : '+') + m[2];

return [{ json: {
  status: String(row.status || ''),
  coin: String(row.coin || ''),
  shortfall: shortfall,
  expiresAt: String(row.expiresAt || '')
}}];
```

Fix the first line to the actual node name once the webhook node is created —
it is written defensively here only because the node name is chosen in Step 1.

- [x] **Step 3: Respond**

`Respond With Status` — `respondWith: json`, body
`={{ JSON.stringify($json) }}`.

**Do NOT set `Access-Control-Allow-Origin` in the response headers.** Doing that
on the `Create Order` workflow overrode the webhook's own `allowedOrigins` and
broke every `www.` request. Let `allowedOrigins` handle CORS alone.

- [x] **Step 4: Wire the error workflow**

Settings → Error Workflow → `sXZtgBw3kX1dhgWg`, matching the other two.

- [x] **Step 5: Verify every branch**

Using the order from Task 1 Step 5, confirm all four:

| Request | Expected |
|---|---|
| correct `orderId` + correct token | `{status:"AWAITING_PAYMENT", coin:"USDT", shortfall:"", expiresAt:"..."}` |
| correct `orderId` + wrong token | `{status:"NOT_FOUND"}` |
| unknown `orderId` | `{status:"NOT_FOUND"}` |
| no body at all | `{status:"NOT_FOUND"}`, not a 500 |

Then edit the test row's `status` to `REVIEW` and `notes` to `short by 1.50` by
hand and confirm the response returns `shortfall: "-1.50"`. Set it back to
`AWAITING_PAYMENT` afterwards.

Confirm no response in any branch contains `email`, `customerName`, `phone`,
`address`, `expectedAmount`, `items` or `txHash`.

---

### Task 3: `payment-status.js` pure module

**Files:**
- Create: `payment-status.js`
- Test: `tests/payment-status.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `statusView(status, opts)` → view object, consumed by Task 4.

- [x] **Step 1: Write the module**

`statusView(status, opts)` where `opts` is `{ coin, shortfall, expired }` and
the return is:

```
{ tone, headline, body, showPanel, showCountdown, stopPolling }
```

- `tone` — `'pending' | 'progress' | 'success' | 'attention' | 'expired'`
- `showPanel` — whether the address/QR/amount block stays visible
- `showCountdown` — whether the expiry countdown keeps ticking
- `stopPolling` — whether this is a terminal state

| status | tone | showPanel | showCountdown | stopPolling |
|---|---|---|---|---|
| `AWAITING_PAYMENT` (not expired) | pending | yes | yes | no |
| `AWAITING_PAYMENT` (expired) | expired | yes | no | no |
| `PAYMENT_SEEN` | progress | no | **no** | no |
| `PAID` | success | no | no | **yes** |
| `REVIEW` | attention | no | no | **yes** |
| `EXPIRED` | expired | yes | no | **yes** |
| `NOT_FOUND` / unknown / `''` | pending | yes | yes | no |

Three of those rows carry the real risk and must be exactly right:

- **`PAYMENT_SEEN` sets `showCountdown: false`.** This is the whole point of
  that status — the watcher has already stopped the expiry clock server-side.
  Leaving the countdown running would show a customer whose money is confirmed
  in the mempool a clock ticking toward "expired".
- **`REVIEW` is `stopPolling: true`** and its copy must tell the customer not to
  pay again. A human decides from here; more polling changes nothing.
- **Unknown/`NOT_FOUND` degrades to the current page behaviour**, never to an
  error state. A typo'd token or a rolled-back sheet must look like a normal
  awaiting-payment page, not a broken one.

Copy (`headline` / `body`):

- `PAYMENT_SEEN` — "Payment detected" / "Your payment is on the network and
  waiting to confirm. This can take a while for Bitcoin. No action needed — you
  can close this page."
- `PAID` — "Payment confirmed" / "Thank you. Your order is confirmed and is
  being prepared. We'll be in touch with shipping details." *(Not "shipped".
  Nothing auto-ships.)*
- `REVIEW` — "Payment received — being checked" / "We received your payment but
  the amount doesn't match the quote{shortfall clause}. **Please don't send
  again** — we're checking it manually and will confirm shortly." Where the
  shortfall clause, when present, reads " (short by 1.50 USDT)".
- `EXPIRED` — keep today's wording.

Export for both worlds, matching `shipping.js`:

```js
if (typeof module !== 'undefined' && module.exports) module.exports = { statusView };
```

- [x] **Step 2: Write the tests**

One case per row of the table above, plus:

- `REVIEW` with `shortfall: '-1.50'` names the shortfall in `body`
- `REVIEW` with `shortfall: ''` reads correctly with no dangling parenthesis
- `REVIEW` body contains "don't send again" in every variant
- `PAID` body contains none of `shipped`, `dispatched`, `on its way`
- `PAYMENT_SEEN` returns `showCountdown: false`
- unknown status string returns the same object as `AWAITING_PAYMENT` not expired
- `statusView(undefined)` and `statusView(null)` do not throw

- [x] **Step 3: Run them**

```bash
node --test tests/*.test.js
```

Note the glob: `node --test tests/` resolves as a module path and fails. All
existing suites must still pass, not just the new one.

---

### Task 4: Poll from the success page

**Files:**
- Modify: `order-success.html`

**Interfaces:**
- Consumes: `payment-status.js`, the Task 2 endpoint, `sessionStorage.gmgPayment`.

- [x] **Step 1: Load the module**

Add `<script src="payment-status.js"></script>` before the existing inline
payment-panel script.

- [x] **Step 2: Add a status region to the panel**

A single container above "Send exactly" that the poller writes headline and body
into, and a `tone` class driving its colour. Hidden until a poll returns a
non-pending status, so a customer whose first poll is still in flight sees
exactly today's page.

- [x] **Step 3: Write the poller**

Requirements, all load-bearing:

- **Guard on `orderId` and `statusToken`.** Both come from
  `sessionStorage.gmgPayment`. `Respond With Quote` returns `orderId` (verified),
  and Task 1 adds the token. If either is missing, do not poll at all — the page
  behaves exactly as it does today.
- **Backoff:** 15s for the first 5 minutes, 30s to 20 minutes, then 60s. Most
  payments land inside the first window; an abandoned tab must not hammer a
  1GB VM that is already running on swap.
- **Pause when hidden.** Use the Page Visibility API to skip polls while
  `document.hidden`, and fire one immediately on becoming visible. A customer
  who tabs away to their exchange and comes back should get a fresh answer at
  once.
- **Stop when `stopPolling`.** Terminal states are final.
- **Hard cap.** Stop after 4 hours in any case — longer than the BTC expiry
  window (180 min), so no legitimate live quote is cut short.
- **Silent failure.** Wrap every poll in try/catch. On error, leave the UI
  untouched and let the next tick try again. Give up after 5 consecutive
  failures. Never render an error to the customer.
- **Countdown interaction.** The existing `tick()` reschedules itself every
  second. It must check a flag the poller sets and stop rescheduling when
  `showCountdown` goes false, otherwise `PAYMENT_SEEN` and `PAID` will keep
  counting down underneath the new message.

- [x] **Step 4: Verify each state against the real endpoint**

Run the local server, place a test order so a real row exists, then drive each
status by editing the sheet row by hand and watching the page update within one
poll interval:

| Set `status` to | Page must show |
|---|---|
| `PAYMENT_SEEN` | "Payment detected", countdown **stopped**, QR hidden |
| `PAID` | "Payment confirmed", green, polling stopped (confirm in Network tab) |
| `REVIEW` + `notes: short by 1.50` | "being checked", names 1.50, says don't send again |
| `EXPIRED` | today's expired copy |

Then verify degradation explicitly, because it is the case most likely to be
skipped and most likely to bite: stop the n8n workflow (or block the URL) and
reload. The page must render the normal payment panel with a running countdown
and no error anywhere on screen or in a customer-visible position.

- [x] **Step 5: Check the countdown really stopped**

Not by eye. In the console after setting `PAYMENT_SEEN`:

```js
document.getElementById('pay-countdown').textContent
```

Read it twice, ten seconds apart. The value must be identical. A countdown that
merely looks hidden but is still rescheduling every second is the failure mode
here.

---

### Task 5: Fold into go-live

**Files:**
- Modify: `docs/superpowers/plans/2026-08-23-crypto-payment-automation.md`

- [x] **Step 1: Extend the go-live checklist**

The main plan's "MUST be undone before go-live" list covers two workflows. Add:

- Remove `http://localhost:8899` from `GMG - Order Status` `allowedOrigins`
  **as well as** from `Order Webhook`.
- Delete the Task 1 Step 5 and Task 4 test order rows by exact id, from both
  `Orders` and `processed_tx`.
- Publish `GMG - Order Status` alongside the other two. A published create-order
  that returns a `statusToken` while the status workflow is unpublished means
  every customer page polls a dead endpoint — harmless, because it degrades
  silently, but it also means the fix is not actually live.

- [x] **Step 2: Update the memory files**

Add `GMG - Order Status` and its id to the crypto table in
`C:\Users\LESTER\memory\n8n-workflows.md`, and note the polling behaviour in the
God Muscle Gears crypto section of
`C:\Users\LESTER\memory\ecommerce-stores.md`.

---

## What this deliberately does not do

- **No live payment status for bank-transfer orders.** They have no quote, no
  row, and nothing to poll.
- **No auto-release.** `PAID` tells the customer their payment is confirmed. A
  human still releases the order. Unchanged.
- **No push/email on confirmation.** The customer must have the tab open to see
  the update. A server-sent "payment confirmed" email from n8n would cover the
  closed-tab case and is arguably the more valuable half — but it is separate
  scope, it needs an SMTP sender decision, and it should not be smuggled into a
  plan about the success page.
- **No fix for the Binance shortfall itself.** This improves how that case reads
  to the customer. Whether to auto-accept small shortfalls remains open and
  carries money risk this does not.
