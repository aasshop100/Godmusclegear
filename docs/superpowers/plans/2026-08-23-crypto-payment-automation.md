# Crypto Payment Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual crypto payment flow with automated payment detection for USDT (TRC-20) and BTC, so that an order's payment is matched, recorded and reported without human involvement.

**Architecture:** The risky part — deciding whether an incoming payment matches an order — is written as a pure, dependency-free JavaScript module in this repo and unit-tested with `node --test` before it ever runs in n8n. That module is then pasted verbatim into an n8n Code node. A Google Sheet holds order state. One n8n webhook workflow creates orders and issues payment details; one scheduled n8n workflow polls the two chains and matches payments. The storefront gains a coin choice at checkout and a payment panel on the success page.

**Tech Stack:** Vanilla ES5-compatible JavaScript (no build step), `node --test` for unit tests, n8n (self-hosted, Oracle Cloud VM) for orchestration, Google Sheets for order state, TronGrid and mempool.space as read-only chain data sources, CoinGecko for BTC/USD rate.

## Global Constraints

- Coins are exactly **USDT (TRC-20)** and **BTC**. No other coin or network.
- USDT contract address on Tron: `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`.
- Quote expiry is **30 minutes** from order creation.
- BTC confirms at **1 confirmation**. USDT confirms on on-chain arrival.
- ~~Near-match tolerance is **2%**.~~ **SUPERSEDED 2026-08-25** by a flat
  auto-accept ceiling of 3.00 USDT / 0.00005 BTC, then a 10% review band. See
  `2026-08-25-payment-fee-tolerance.md`.
- Poll interval is **2 minutes**.
- ~~**Only an exact amount match may set `PAID`.**~~ **SUPERSEDED 2026-08-25.** A
  payment within the flat auto-accept ceiling also sets `PAID`, in both
  directions, because exchanges deduct their withdrawal fee from the amount
  sent. What still holds without exception: **a payment that could belong to
  more than one open order is never matched**, and **nothing auto-ships**.
- **Nothing auto-ships.** The system reports payment; a human releases the order.
- **Receiving addresses, the Sheet ID, and API keys must never be committed to this repository.** It is public and serves GitHub Pages. They live in n8n configuration only.
- n8n holds **no private keys**. It only reads public chain data.
- **`main` must not change until Task 8.** All storefront work happens on the branch created in Task 1 and is tested against the local server. The live site keeps its current manual flow throughout.
- n8n workflows stay **unpublished** until Task 8, and are driven via n8n's Test URL during development.
- Line numbers cited below are as of the unmodified files; locate targets by the quoted code, not the number.

**Reference spec:** `docs/superpowers/specs/2026-08-23-crypto-payment-automation-design.md`

---

## PROGRESS — updated 2026-08-26

Branch: `crypto-payment-automation` (all work committed, not merged).
**`main` is untouched.** The live site still runs the old manual crypto flow.
**All THREE n8n workflows are UNPUBLISHED.**

Everything is built. One thing is left before go-live: a live USDT payment test,
parked to **2026-08-31** at Lester's direction.

### This plan

| Task | State |
|---|---|
| 1 — `payment-matching.js` | ✅ done — see the note on test counts below |
| 2 — `GMG Orders` sheet | ✅ created, id in `api-keys.md` |
| 3 — `GMG - Create Order` | ✅ `YTYSoa22Gu9L6NzC` — extended twice since (see below) |
| 4 — `GMG - Payment Watcher` | ✅ `UEIXJauCOKOhxIUh` — extended twice since |
| 5 — checkout coin selection | ✅ done |
| 6 — payment panel + FAQ | ✅ done |
| 7 — real-money test | ⏸️ **parked to 2026-08-31** — the only outstanding item |
| 8 — go live | ⏹️ follow `docs/GO-LIVE-RUNBOOK.md` |

> The "52 unit tests" this table used to cite was the whole suite, not just
> `payment-matching.js`. The suite is now **85** (`node --test tests/*.test.js`).

### Four follow-on plans, all built and verified 2026-08-25/26

| Plan | What it changed |
|---|---|
| `2026-08-25-payment-fee-tolerance.md` | Replaced the 2% near-match band with a flat auto-accept ceiling (**3.00 USDT / 0.00005 BTC**) that sets `PAID` in both directions. Supersedes this plan's "only an exact match may set PAID". |
| `2026-08-25-payment-confirmation-email.md` | The watcher now emails the customer on `PAID` and `REVIEW`. |
| `2026-08-25-payment-status-polling.md` | Third workflow **`GMG - Order Status` (`1v3236DBmMZBL88h`)** + `payment-status.js` + a `statusToken` column, so the success page shows real status instead of counting down to "expired" after payment. |
| `2026-08-26-retire-emailjs.md` | **EmailJS is gone.** All four emails come from n8n. The checkout now posts **every** order — including bank transfer, which never reached n8n before — retries three times, then degrades rather than aborting. |
| _(no plan — 2026-08-26)_ | `Respond With Quote` now returns **`usdTotal`**, and the success page prints `≈ $83.84 USD` under a **BTC** amount; the `PAID` email does the same. A bare `0.00106392 BTC` gave a customer no way to check what they were paying. Not shown for USDT, which is already dollars. |
| _(no plan — 2026-08-26)_ | **The checkout reCAPTCHA now actually blocks.** It rendered since launch but nothing read it — Google's own console showed `0` verifications and "your site is not verifying reCAPTCHA solutions". `GMG - Create Order` verifies every token with Google before writing a row; a fake or missing token gets `403 captcha_failed` and a Telegram alert. The secret lives in the `reCAPTCHA Secret` Custom Auth credential as **`{"qs":{...}}`, NOT `{"body":{...}}`** — with a form-urlencoded body n8n builds `form`, and the injected `body` never reaches Google. Google returns `invalid-input-response` for a missing secret AND a bad token alike, so that failure is invisible from the response; diagnose with the token length instead. |

### What is left before go-live

**One item, and it is Lester's:** the live USDT payment test on 2026-08-31.

`LIVE-BINANCE-TEST` has long expired — **issue a fresh order, do not revive it.**
The Tron address has still never received anything, so real TRC-20 parsing has
never run against real chain data. Bitcoin parsing was proven against real chain
data back on 2026-08-24.

Everything else that was outstanding is done: SPF edited and verified,
deliverability proven at an independent provider, and the EmailJS work retired
rather than completed.

Then work `docs/GO-LIVE-RUNBOOK.md` top to bottom. Its Step 3 is the one to
re-read first — `watchFrom` must be advanced **after** the test rows are deleted,
never before.

### Where Task 7 originally stopped, kept for context

The 2026-08-24 pause was waiting on a `3.50` USDT payment for order
`LIVE-BINANCE-TEST`. That order is expired and superseded; 3.50 was chosen under
the old assumption that Binance's 1.50 fee had to be worked around, which the
auto-accept ceiling now absorbs. A fresh test order should simply be the smallest
convenient amount.

### Deviations from this plan, already applied

- **Per-coin expiry.** BTC 3 hours, USDT 30 minutes — not 30 for both. A
  customer's exchange can sit on a BTC withdrawal for an hour before broadcast.
  Values live on the `Payment Addresses` node in each workflow.
- **`PAYMENT_SEEN` status added.** A payment seen in the mempool stops the
  expiry clock so slow Bitcoin confirmations still auto-complete. Dedupe keys
  are staged (`txid:seen` then `txid`).
- **`watchFrom` cutoff added** on the watcher's `Payment Addresses` node. These
  are live exchange deposit addresses with real history; without it the first
  run would have alerted on ~50 historical transactions.
- ~~**Overpayment is `REVIEW`, not `PAID`** (spec corrected).~~ **REVERSED 2026-08-25** — an overpayment inside the auto-accept ceiling now sets `PAID` too, with the overage stated in the Telegram alert. Attribution is handled independently by the single-candidate check, so treating over and under differently was guarding a case already covered.
- Task 7 Step 1's spec correction is DONE.

### MUST be undone before go-live (Task 8)

**Updated 2026-08-25.** Three workflows now, not two.

**Remove `http://localhost:8899` from `allowedOrigins` on BOTH webhooks:**
- `GMG - Create Order` → `Order Webhook`
- `GMG - Order Status` → `Status Webhook`

**Publish all three workflows.** `GMG - Create Order`, `GMG - Payment Watcher`,
`GMG - Order Status`. A published create-order that hands out a `statusToken`
while the status workflow is unpublished means every customer page polls a dead
endpoint — harmless, because it degrades silently, but the fix is then not
actually live.

**Delete test rows by exact id:**
- `Orders`: TEST-001..008, LIVE-USDT-TEST, LIVE-BINANCE-TEST,
  `ORDER-1787584663956`, and **`TOKEN-TEST-001`** (added 2026-08-25 while
  verifying the statusToken change — it carries a real token and a real quote).
- `processed_tx`: 8 rows.

**Manual dashboard work, none of it in this repo:**
- ~~**EmailJS**~~ — **RETIRED 2026-08-26.** Both order emails are now sent by
  `GMG - Create Order` as `admin@godmusclegears.com`, so the sender mismatch and
  the template paste are both moot. See
  `2026-08-26-retire-emailjs.md`. Nothing in the EmailJS dashboard needs touching
  before go-live.
- ~~**SPF record**~~ — **DONE 2026-08-26**, verified live as
  `v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all`.
- ~~**Deliverability test**~~ — **DONE 2026-08-26**, inbox at an independent
  provider with the alias intact.

**The single remaining pre-go-live item is the live USDT payment test**, parked
to 2026-08-31.

### Withdrawal-fee handling — DECIDED 2026-08-25

Was: "Binance deducts 1.50 from the amount sent, so those orders land in REVIEW
instead of auto-confirming — Lester's call, not yet decided."

**Decided.** Buyers are not Binance-only; fees vary by platform (~0.8–2.5 on
TRC-20) and self-custody wallets deduct nothing at all, so no fixed markup can
be correct. Quote the true amount, instruct the buyer to add their fee on top,
and auto-accept shortfalls up to a flat ceiling (3.00 USDT / 0.00005 BTC).
Overpayments inside the ceiling auto-confirm too.

Full reasoning and implementation:
`docs/superpowers/plans/2026-08-25-payment-fee-tolerance.md`.

> That plan **modifies `payment-matching.js` and the `Match Payments` node**,
> which Tasks 1 and 4 already built. The 2% `NEAR_MATCH_TOLERANCE` described
> elsewhere in this document is superseded by it.

### Also outstanding before go-live

`order-success.html` never polls, so a customer who pays correctly still watches
the countdown run out to "expired — message us on Telegram". Spec:
`docs/superpowers/plans/2026-08-25-payment-status-polling.md`. Adds a third
workflow (`GMG - Order Status`) and a `statusToken` column, both of which extend
the go-live checklist above.

---

## Spec correction adopted by this plan

The spec's failure-handling table says an overpayment results in `PAID` plus an
alert. That is wrong and this plan does not implement it.

Amount matching is the *only* way an order is identified. An overpayment by
definition does not match any expected amount, so the system cannot know with
confidence which order it belongs to — the same reasoning that makes an
underpayment a `REVIEW` case applies identically to an overpayment. Auto-setting
`PAID` on an unattributable payment risks releasing goods against someone else's
money.

Overpayments are therefore treated symmetrically with underpayments: if exactly
one open order sits within 2% below the amount received, it is flagged `REVIEW`
with the overage stated. Otherwise it is an unmatched payment.

Task 7 updates the spec to match.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `payment-matching.js` | Create | Pure matching logic. `makeUniqueAmount`, `findMatch`. No DOM, no network, no storage. Pasted into n8n Code nodes. |
| `tests/payment-matching.test.js` | Create | `node --test` unit tests for the above. |
| `checkout.html` | Modify | Split the Crypto radio into USDT / BTC. |
| `script.js` | Modify | Checkout submit posts to the `create-order` webhook and carries payment details to the success page. |
| `order-success.html` | Modify | Payment panel: address, exact amount, QR, countdown. |
| `faq.html` | Modify | Correct the accepted-coins answer. |
| Google Sheet `GMG Orders` | Create | Tabs `Orders` and `processed_tx`. |
| n8n `GMG - Create Order` | Create | Webhook. Locks rate, assigns unique amount, writes row, returns payment details. |
| n8n `GMG - Payment Watcher` | Create | Every 2 min. Polls both chains, matches, confirms or alerts. |

`payment-matching.js` is deliberately pure so the money logic can be proven with
fast offline tests, exactly as `shipping.js` was.

---

### Task 1: Pure payment-matching module

**Files:**
- Create: `payment-matching.js`
- Test: `tests/payment-matching.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `USDT_CONTRACT` — `'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'`
  - `NEAR_MATCH_TOLERANCE` — `0.02`
  - `EXPIRY_MINUTES` — `30`
  - `makeUniqueAmount(baseAmount, coin, takenAmounts, randomFn)` → `Number`
    - `coin` is `'USDT'` or `'BTC'`
    - `takenAmounts` is an array of numbers already in use by open orders
    - `randomFn` is an optional `() => Number` in `[0,1)`, injected for deterministic tests; defaults to `Math.random`
    - throws `Error` if no unique amount can be found
  - `findMatch(receivedAmount, coin, orders, nowMs)` → `{ type, order, difference }`
    - `orders` is an array of `{ orderId, coin, expectedAmount, expiresAt, status }` where `expiresAt` is epoch ms
    - `type` is one of `'EXACT'`, `'EXPIRED_MATCH'`, `'NEAR_UNDER'`, `'NEAR_OVER'`, `'NONE'`
    - `order` is the matched order or `null`
    - `difference` is the signed amount received minus expected, `0` for `EXACT`, `null` for `'NONE'`

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b crypto-payment-automation
```

- [ ] **Step 2: Write the failing test**

Create `tests/payment-matching.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  makeUniqueAmount, findMatch, USDT_CONTRACT, NEAR_MATCH_TOLERANCE, EXPIRY_MINUTES
} = require('../payment-matching.js');

const NOW = 1_700_000_000_000;
const MIN = 60 * 1000;

// Build an open order. expiresAt defaults to 10 minutes in the future.
const order = (id, coin, expectedAmount, opts) => Object.assign({
  orderId: id, coin, expectedAmount,
  expiresAt: NOW + 10 * MIN, status: 'AWAITING_PAYMENT'
}, opts || {});

test('constants match the agreed configuration', () => {
  assert.strictEqual(USDT_CONTRACT, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  assert.strictEqual(NEAR_MATCH_TOLERANCE, 0.02);
  assert.strictEqual(EXPIRY_MINUTES, 30);
});

// ── makeUniqueAmount ────────────────────────────────────────────────

test('USDT amount is never below the base amount', () => {
  const a = makeUniqueAmount(512.68, 'USDT', [], () => 0);
  assert.ok(a >= 512.68, `${a} should be >= 512.68`);
});

test('USDT amount adds at most one dollar', () => {
  const a = makeUniqueAmount(512.68, 'USDT', [], () => 0.999);
  assert.ok(a <= 513.68, `${a} should be <= 513.68`);
});

test('USDT amount is rounded to 2 decimals', () => {
  const a = makeUniqueAmount(512.68, 'USDT', [], () => 0.5);
  assert.strictEqual(a, Number(a.toFixed(2)));
});

test('USDT amount avoids amounts already taken', () => {
  // randomFn always returns 0, so the first candidate is always the same;
  // the function must walk to a free one rather than collide.
  const taken = [512.69, 512.70, 512.71];
  const a = makeUniqueAmount(512.68, 'USDT', taken, () => 0);
  assert.ok(!taken.includes(a), `${a} collided with a taken amount`);
  assert.ok(a >= 512.68);
});

test('BTC amount is rounded to 8 decimals and above base', () => {
  const a = makeUniqueAmount(0.00512345, 'BTC', [], () => 0);
  assert.strictEqual(a, Number(a.toFixed(8)));
  assert.ok(a >= 0.00512345);
});

test('BTC amount avoids taken amounts', () => {
  const taken = [0.00512346, 0.00512347];
  const a = makeUniqueAmount(0.00512345, 'BTC', taken, () => 0);
  assert.ok(!taken.includes(a));
});

test('throws when every candidate amount is taken', () => {
  // Fill the entire USDT candidate space (100 one-cent steps).
  const taken = [];
  for (let i = 0; i <= 100; i++) taken.push(Number((10 + i / 100).toFixed(2)));
  assert.throws(() => makeUniqueAmount(10, 'USDT', taken, () => 0), /unique amount/i);
});

// ── findMatch ───────────────────────────────────────────────────────

test('exact match on an open order', () => {
  const orders = [order('A', 'USDT', 512.73)];
  const r = findMatch(512.73, 'USDT', orders, NOW);
  assert.strictEqual(r.type, 'EXACT');
  assert.strictEqual(r.order.orderId, 'A');
  assert.strictEqual(r.difference, 0);
});

test('exact match ignores orders of a different coin', () => {
  const orders = [order('A', 'BTC', 512.73)];
  assert.strictEqual(findMatch(512.73, 'USDT', orders, NOW).type, 'NONE');
});

test('exact match on an order past its expiry is EXPIRED_MATCH, not EXACT', () => {
  const orders = [order('A', 'USDT', 512.73, { expiresAt: NOW - 1 })];
  const r = findMatch(512.73, 'USDT', orders, NOW);
  assert.strictEqual(r.type, 'EXPIRED_MATCH');
  assert.strictEqual(r.order.orderId, 'A');
});

test('exact match on a row already swept to EXPIRED is EXPIRED_MATCH', () => {
  const orders = [order('A', 'USDT', 512.73, { status: 'EXPIRED' })];
  assert.strictEqual(findMatch(512.73, 'USDT', orders, NOW).type, 'EXPIRED_MATCH');
});

test('already PAID orders are never matched again', () => {
  const orders = [order('A', 'USDT', 512.73, { status: 'PAID' })];
  assert.strictEqual(findMatch(512.73, 'USDT', orders, NOW).type, 'NONE');
});

test('underpayment within tolerance against exactly one order is NEAR_UNDER', () => {
  const orders = [order('A', 'USDT', 512.73)];
  const r = findMatch(511.73, 'USDT', orders, NOW);
  assert.strictEqual(r.type, 'NEAR_UNDER');
  assert.strictEqual(r.order.orderId, 'A');
  assert.ok(Math.abs(r.difference - -1.00) < 1e-9, `difference was ${r.difference}`);
});

test('overpayment within tolerance against exactly one order is NEAR_OVER', () => {
  const orders = [order('A', 'USDT', 512.73)];
  const r = findMatch(513.73, 'USDT', orders, NOW);
  assert.strictEqual(r.type, 'NEAR_OVER');
  assert.ok(Math.abs(r.difference - 1.00) < 1e-9);
});

test('underpayment beyond tolerance is NONE', () => {
  const orders = [order('A', 'USDT', 512.73)];
  assert.strictEqual(findMatch(400.00, 'USDT', orders, NOW).type, 'NONE');
});

test('ambiguous near-match against two orders is NONE', () => {
  const orders = [order('A', 'USDT', 512.73), order('B', 'USDT', 512.80)];
  assert.strictEqual(findMatch(511.90, 'USDT', orders, NOW).type, 'NONE');
});

test('exact match wins even when another order is a near-match', () => {
  const orders = [order('A', 'USDT', 511.73), order('B', 'USDT', 512.73)];
  const r = findMatch(511.73, 'USDT', orders, NOW);
  assert.strictEqual(r.type, 'EXACT');
  assert.strictEqual(r.order.orderId, 'A');
});

test('no orders at all is NONE with a null order', () => {
  const r = findMatch(100, 'USDT', [], NOW);
  assert.strictEqual(r.type, 'NONE');
  assert.strictEqual(r.order, null);
  assert.strictEqual(r.difference, null);
});

test('BTC exact match tolerates floating point representation', () => {
  const orders = [order('A', 'BTC', 0.00512345)];
  assert.strictEqual(findMatch(0.00512345, 'BTC', orders, NOW).type, 'EXACT');
});

test('near-match does not consider expired orders', () => {
  const orders = [order('A', 'USDT', 512.73, { expiresAt: NOW - 1 })];
  assert.strictEqual(findMatch(511.73, 'USDT', orders, NOW).type, 'NONE');
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
node --test tests/payment-matching.test.js
```

Expected: FAIL — `Cannot find module '../payment-matching.js'`.

- [ ] **Step 4: Write the implementation**

Create `payment-matching.js`:

```js
// payment-matching.js — GOD MUSCLE GEARS
// Pure payment/order matching. No DOM, no network, no storage.
// Unit-tested here, then pasted verbatim into the n8n Code nodes.
//
// Rule that must never be relaxed: only an EXACT amount match may mark an
// order PAID. Everything else is a human decision.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== 'undefined' ? window : null, function () {

  const USDT_CONTRACT        = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const NEAR_MATCH_TOLERANCE = 0.02;
  const EXPIRY_MINUTES       = 30;

  // Per-coin matching precision. USDT is quoted in cents; BTC in satoshis.
  const DECIMALS = { USDT: 2, BTC: 8 };
  // Candidate steps searched when making an amount unique.
  const STEPS    = { USDT: 100, BTC: 1000 };

  function round(value, coin) {
    return Number(Number(value).toFixed(DECIMALS[coin]));
  }

  // Two amounts are equal if they agree at the coin's precision. Comparing
  // floats directly would miss payments over representation error alone.
  function sameAmount(a, b, coin) {
    return round(a, coin) === round(b, coin);
  }

  // Nudge baseAmount upward by a random number of minor units until the
  // result is not already in use. Never returns less than baseAmount, so a
  // customer is never quoted below the order total.
  function makeUniqueAmount(baseAmount, coin, takenAmounts, randomFn) {
    const steps  = STEPS[coin];
    const unit   = 1 / Math.pow(10, DECIMALS[coin]);
    const random = randomFn || Math.random;
    const taken  = (takenAmounts || []).map(function (a) { return round(a, coin); });

    const start = Math.floor(random() * steps);
    for (let i = 0; i < steps; i++) {
      const candidate = round(baseAmount + ((start + i) % steps) * unit, coin);
      if (taken.indexOf(candidate) === -1) return candidate;
    }

    throw new Error(
      'could not assign a unique amount for ' + coin + ' base ' + baseAmount +
      ' — all ' + steps + ' candidates are in use by open orders'
    );
  }

  function isOpen(order, nowMs) {
    return order.status === 'AWAITING_PAYMENT' && Number(order.expiresAt) > nowMs;
  }

  // Matchable rows are those still awaiting payment and those already swept
  // to EXPIRED — late money must be surfaced, never silently dropped.
  function isMatchable(order) {
    return order.status === 'AWAITING_PAYMENT' || order.status === 'EXPIRED';
  }

  function findMatch(receivedAmount, coin, orders, nowMs) {
    const none = { type: 'NONE', order: null, difference: null };
    const all  = (orders || []).filter(function (o) {
      return o.coin === coin && isMatchable(o);
    });

    // 1. Exact match always wins.
    const exact = all.filter(function (o) {
      return sameAmount(o.expectedAmount, receivedAmount, coin);
    });
    if (exact.length > 0) {
      const live = exact.filter(function (o) { return isOpen(o, nowMs); });
      if (live.length > 0) {
        return { type: 'EXACT', order: live[0], difference: 0 };
      }
      return { type: 'EXPIRED_MATCH', order: exact[0], difference: 0 };
    }

    // 2. Otherwise look for a single still-open order within tolerance.
    //    Exchanges often deduct the withdrawal fee from the amount sent, so
    //    a short payment is common and usually legitimate.
    const near = all.filter(function (o) {
      if (!isOpen(o, nowMs)) return false;
      const expected = Number(o.expectedAmount);
      if (!expected) return false;
      return Math.abs(receivedAmount - expected) / expected <= NEAR_MATCH_TOLERANCE;
    });

    // Ambiguity is reported as unmatched. Guessing here would risk crediting
    // one customer's payment to another customer's order.
    if (near.length !== 1) return none;

    const candidate = near[0];
    const difference = round(receivedAmount - Number(candidate.expectedAmount), coin);
    return {
      type: difference < 0 ? 'NEAR_UNDER' : 'NEAR_OVER',
      order: candidate,
      difference: difference
    };
  }

  return {
    USDT_CONTRACT: USDT_CONTRACT,
    NEAR_MATCH_TOLERANCE: NEAR_MATCH_TOLERANCE,
    EXPIRY_MINUTES: EXPIRY_MINUTES,
    makeUniqueAmount: makeUniqueAmount,
    findMatch: findMatch,
    sameAmount: sameAmount,
    round: round
  };
});
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node --test tests/payment-matching.test.js
```

Expected: PASS — 21 passing tests, 0 failing.

- [ ] **Step 6: Confirm the existing shipping tests still pass**

```bash
node --test tests/shipping.test.js
```

Expected: 18 passing, 0 failing.

- [ ] **Step 7: Commit**

```bash
git add payment-matching.js tests/payment-matching.test.js && git commit -F- <<'MSG'
Add pure payment-matching module with unit tests

Amount uniqueness and payment-to-order matching for USDT and BTC, including
near-match handling for exchange withdrawal fees deducted at source. Only an
exact match is allowed to mark an order paid.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: Google Sheet order store

**Files:**
- Create: Google Sheet `GMG Orders` (external — not in this repo)

**Interfaces:**
- Consumes: nothing.
- Produces: a spreadsheet ID, and two tabs whose exact column order later tasks depend on.

- [ ] **Step 1: Create the spreadsheet**

Create a new Google Sheet named `GMG Orders` in the same Google account n8n
already uses for the T5 catalog sheets.

- [ ] **Step 2: Create the `Orders` tab**

Rename the first tab to `Orders` and set row 1 to exactly these headers, in
this order:

```
orderId | createdAt | expiresAt | status | coin | address | expectedAmount | usdTotal | btcRate | customerName | email | phone | items | shippingTotal | packageCount | paidAt | txHash | notes
```

`status` is one of `AWAITING_PAYMENT`, `PAID`, `EXPIRED`, `REVIEW`.
`createdAt`, `expiresAt` and `paidAt` are ISO 8601 strings.

- [ ] **Step 3: Create the `processed_tx` tab**

Add a second tab named `processed_tx` with row 1 set to exactly:

```
txHash | coin | amount | seenAt | matchedOrderId
```

- [ ] **Step 4: Record the spreadsheet ID**

Copy the ID from the sheet URL — the segment between `/d/` and `/edit`.

**Do not commit it to this repository.** Save it to
`C:\Users\LESTER\memory\api-keys.md` under a new `GMG Orders Sheet` entry,
alongside the other spreadsheet IDs.

- [ ] **Step 5: Verify n8n can reach the sheet**

In n8n, create a scratch workflow with a single Google Sheets node using the
existing `Google Sheets account` credential, set to read `Orders`.

Run it. Expected: succeeds and returns zero data rows.

If it fails to authenticate, the credential needs reconnecting — and per the
recorded gotcha this **must** be done via the raw IP host
`http://193.122.248.225.nip.io/`, not the custom domain.

Delete the scratch workflow once it succeeds.

---

### Task 3: n8n "GMG - Create Order" workflow

**Files:**
- Create: n8n workflow `GMG - Create Order` (external)

**Interfaces:**
- Consumes: `makeUniqueAmount` from Task 1; the `Orders` tab from Task 2.
- Produces: a webhook that accepts an order and returns
  `{ orderId, coin, address, expectedAmount, expiresAt }`.

**Request body the webhook must accept:**

```json
{
  "orderId": "ORDER-1787468545042",
  "coin": "USDT",
  "usdTotal": 512.68,
  "customerName": "Juan Dela Cruz",
  "email": "buyer@example.com",
  "phone": "09171234567",
  "items": "Testosterone Cypionate 250mg x2 | BOLDEPEX 200 x2",
  "shippingTotal": 70.00,
  "packageCount": 3
}
```

- [ ] **Step 1: Load the n8n build references**

These are mandatory before writing any workflow code, and the parameter names
must not be guessed:

```
mcp__n8n-mcp__get_workflow_sdk_reference   (no section — full reference)
mcp__n8n-mcp__get_workflow_best_practices  technique="data_persistence"
mcp__n8n-mcp__get_workflow_best_practices  technique="web_app"
```

- [ ] **Step 2: Discover the nodes and their exact parameters**

```
mcp__n8n-mcp__search_nodes    queries: ["webhook", "google sheets", "code", "http request", "respond to webhook"]
mcp__n8n-mcp__get_node_types  for every node id chosen, including resource/operation discriminators
mcp__n8n-mcp__list_credentials  to find the Google Sheets credential id
```

Do not proceed until `get_node_types` has returned real parameter definitions
for each node.

- [ ] **Step 3: Build the workflow**

Node chain:

1. **Webhook** — method `POST`, path `gmg-create-order`, response mode set to
   respond via a Respond node.
2. **Google Sheets — read `Orders`** — used to collect amounts already in use.
3. **HTTP Request — BTC rate** — `GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd`.
   Only meaningful for BTC orders; running it unconditionally keeps the graph
   simple and costs one cheap request.
4. **Code — build order** — contains the `payment-matching.js` source from
   Task 1 pasted verbatim at the top, followed by:

```js
// Paste the full contents of payment-matching.js above this line, minus its
// UMD wrapper — keep makeUniqueAmount, round, DECIMALS, STEPS.

const body    = $('Webhook').first().json.body;
const sheet   = $('Google Sheets').all().map(r => r.json);
const rateUsd = $('BTC rate').first().json.bitcoin.usd;

const EXPIRY_MINUTES = 30;
const ADDRESSES = {
  USDT: $env.GMG_USDT_ADDRESS,
  BTC:  $env.GMG_BTC_ADDRESS
};

const coin = body.coin;
if (coin !== 'USDT' && coin !== 'BTC') {
  throw new Error('unsupported coin: ' + coin);
}

const usdTotal = Number(body.usdTotal);
if (!(usdTotal > 0)) throw new Error('invalid usdTotal: ' + body.usdTotal);

// Amounts already promised to orders still awaiting payment for this coin.
const taken = sheet
  .filter(r => r.coin === coin && r.status === 'AWAITING_PAYMENT')
  .map(r => Number(r.expectedAmount));

const base = coin === 'BTC' ? usdTotal / rateUsd : usdTotal;
const expectedAmount = makeUniqueAmount(base, coin, taken);

const now = new Date();
const expiresAt = new Date(now.getTime() + EXPIRY_MINUTES * 60 * 1000);

return [{ json: {
  orderId:       body.orderId,
  createdAt:     now.toISOString(),
  expiresAt:     expiresAt.toISOString(),
  status:        'AWAITING_PAYMENT',
  coin:          coin,
  address:       ADDRESSES[coin],
  expectedAmount: expectedAmount,
  usdTotal:      usdTotal,
  btcRate:       coin === 'BTC' ? rateUsd : '',
  customerName:  body.customerName || '',
  email:         body.email || '',
  phone:         body.phone || '',
  items:         body.items || '',
  shippingTotal: body.shippingTotal || '',
  packageCount:  body.packageCount || '',
  paidAt:        '',
  txHash:        '',
  notes:         ''
}}];
```

5. **Google Sheets — append to `Orders`** — maps every field above to its column.
6. **Respond to Webhook** — returns only what the browser needs:

```js
{
  orderId:        $json.orderId,
  coin:           $json.coin,
  address:        $json.address,
  expectedAmount: $json.expectedAmount,
  expiresAt:      $json.expiresAt
}
```

- [ ] **Step 4: Set the address environment variables**

On the Oracle VM, add `GMG_USDT_ADDRESS` and `GMG_BTC_ADDRESS` to the n8n
container's environment and restart it. Use the addresses Lester supplied.

**These values must not appear in this repository, in the workflow JSON, or in
any commit.**

- [ ] **Step 5: Verify against the exact-match contract**

Leave the workflow **unpublished**. Click "Test workflow" to arm the Test URL,
then from a terminal:

```bash
curl -s -X POST '<TEST_WEBHOOK_URL>' \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"TEST-001","coin":"USDT","usdTotal":512.68,"customerName":"TEST","email":"test@example.com","phone":"0000","items":"test","shippingTotal":70,"packageCount":3}'
```

Expected: JSON containing `orderId`, `coin: "USDT"`, the USDT address, an
`expectedAmount` between `512.68` and `513.68`, and an `expiresAt` 30 minutes
ahead. A new `AWAITING_PAYMENT` row appears in the `Orders` tab.

- [ ] **Step 6: Verify uniqueness under collision**

Run the same curl three more times with `orderId` `TEST-002`, `TEST-003`,
`TEST-004` and identical `usdTotal`.

Expected: four rows, each with a **different** `expectedAmount`.

- [ ] **Step 7: Verify a BTC order**

```bash
curl -s -X POST '<TEST_WEBHOOK_URL>' \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"TEST-005","coin":"BTC","usdTotal":512.68,"customerName":"TEST","email":"test@example.com","phone":"0000","items":"test","shippingTotal":70,"packageCount":3}'
```

Expected: `expectedAmount` is a small 8-decimal number, `btcRate` is populated,
and `address` is the BTC address.

- [ ] **Step 8: Record the workflow**

Add the workflow ID and both webhook URLs to
`C:\Users\LESTER\memory\n8n-workflows.md`.

---

### Task 4: n8n "GMG - Payment Watcher" workflow

**Files:**
- Create: n8n workflow `GMG - Payment Watcher` (external)

**Interfaces:**
- Consumes: `findMatch` from Task 1; both tabs from Task 2.
- Produces: nothing consumed by later tasks. Terminal component.

- [ ] **Step 1: Load the n8n build references**

```
mcp__n8n-mcp__get_workflow_best_practices  technique="scheduling"
mcp__n8n-mcp__get_workflow_best_practices  technique="monitoring"
mcp__n8n-mcp__search_nodes    queries: ["schedule trigger", "http request", "google sheets", "code", "telegram"]
mcp__n8n-mcp__get_node_types  for every node id chosen
```

- [ ] **Step 2: Build the polling and matching chain**

1. **Schedule Trigger** — every 2 minutes.
2. **Google Sheets — read `Orders`**
3. **Google Sheets — read `processed_tx`**
4. **HTTP Request — Tron** —
   `GET https://api.trongrid.io/v1/accounts/{{$env.GMG_USDT_ADDRESS}}/transactions/trc20?limit=50&only_to=true&contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`
5. **HTTP Request — Bitcoin** —
   `GET https://mempool.space/api/address/{{$env.GMG_BTC_ADDRESS}}/txs`
6. **Code — match payments** — paste `payment-matching.js` verbatim at the top
   (minus its UMD wrapper), then:

```js
// Paste payment-matching.js above this line — findMatch, round, sameAmount.

const orders    = $('Read Orders').all().map(r => r.json);
const processed = new Set($('Read processed_tx').all().map(r => r.json.txHash));
const now       = Date.now();

const USDT_ADDRESS = $env.GMG_USDT_ADDRESS;
const BTC_ADDRESS  = $env.GMG_BTC_ADDRESS;

const incoming = [];

// USDT: TRC-20 transfers into our address. value is in the token's base
// units; USDT on Tron has 6 decimals.
for (const t of ($('Tron').first().json.data || [])) {
  if (t.to !== USDT_ADDRESS) continue;
  incoming.push({
    txHash: t.transaction_id,
    coin:   'USDT',
    amount: Number(t.value) / 1e6
  });
}

// Bitcoin: sum outputs paying our address. Require 1 confirmation.
for (const tx of ($('Bitcoin').first().json || [])) {
  if (!tx.status || !tx.status.confirmed) continue;
  const sats = (tx.vout || [])
    .filter(o => o.scriptpubkey_address === BTC_ADDRESS)
    .reduce((sum, o) => sum + Number(o.value), 0);
  if (sats <= 0) continue;
  incoming.push({ txHash: tx.txid, coin: 'BTC', amount: sats / 1e8 });
}

const results = [];
for (const payment of incoming) {
  if (processed.has(payment.txHash)) continue;   // never count a tx twice
  const match = findMatch(payment.amount, payment.coin, orders, now);
  results.push({ json: Object.assign({}, payment, {
    matchType:       match.type,
    matchedOrderId:  match.order ? match.order.orderId : '',
    difference:      match.difference,
    expectedAmount:  match.order ? match.order.expectedAmount : ''
  })});

  // An order may only be claimed once within a single run.
  if (match.order) {
    const claimed = orders.find(o => o.orderId === match.order.orderId);
    if (claimed) claimed.status = 'CLAIMED_THIS_RUN';
  }
}

return results;
```

7. **Switch on `matchType`** with four outputs: `EXACT`, `EXPIRED_MATCH`,
   `NEAR_UNDER` / `NEAR_OVER`, `NONE`.

- [ ] **Step 3: Wire the four outcomes**

| Output | Sheet update | Telegram message |
|---|---|---|
| `EXACT` | set `status=PAID`, `paidAt`, `txHash` on the matched row | `💰 PAYMENT CONFIRMED — Order {{orderId}} · {{amount}} {{coin}}` |
| `EXPIRED_MATCH` | set `status=REVIEW`, `txHash`, `notes="paid after expiry"` | `⚠️ LATE PAYMENT — Order {{orderId}} expired but {{amount}} {{coin}} arrived. Review.` |
| `NEAR_UNDER` / `NEAR_OVER` | set `status=REVIEW`, `txHash`, `notes` with the difference | `⚠️ AMOUNT MISMATCH — received {{amount}} {{coin}}, order {{orderId}} expects {{expectedAmount}}, difference {{difference}}. Review.` |
| `NONE` | no order row touched | `❓ UNMATCHED PAYMENT — {{amount}} {{coin}} received, no matching order. tx {{txHash}}` |

Every branch then appends the transaction to `processed_tx` with
`matchedOrderId` set where one was found.

- [ ] **Step 4: Add the expiry sweep**

A second branch off the Schedule Trigger: read `Orders`, select rows where
`status = AWAITING_PAYMENT` and `expiresAt` is in the past, set them to
`EXPIRED`. No Telegram alert — expiry is routine.

- [ ] **Step 5: Wire the error workflow**

Set this workflow's **Error Workflow** to the existing shared handler
`sXZtgBw3kX1dhgWg` ("Error Handler - Telegram Alerts"), matching the house
pattern.

- [ ] **Step 6: Verify every path with pinned data — no real money**

Use n8n's pin-data feature on the `Tron` node to replay fabricated responses,
then run the workflow manually for each case below. Create matching `Orders`
rows by hand as needed.

| Pinned amount | Orders row | Expected outcome |
|---|---|---|
| exactly the row's `expectedAmount` | `AWAITING_PAYMENT`, not expired | row → `PAID`, confirmation Telegram |
| exactly the row's `expectedAmount` | `expiresAt` in the past | row → `REVIEW`, late-payment Telegram |
| `expectedAmount` minus 1.00 | `AWAITING_PAYMENT` | row → `REVIEW`, mismatch Telegram naming the shortfall |
| `999999` | any | unmatched-payment Telegram, no row touched |
| a previously-processed txHash | any | nothing happens at all |

Do not proceed until every row behaves as stated.

- [ ] **Step 7: Verify double-processing is impossible**

Re-run the workflow with the same pinned `EXACT` payload a second time.

Expected: no second Telegram message, no second sheet update — the txHash is
already in `processed_tx`.

- [ ] **Step 8: Record the workflow**

Add the workflow ID to `C:\Users\LESTER\memory\n8n-workflows.md`.

---

### Task 5: Checkout coin selection

**Files:**
- Modify: `checkout.html` — the payment-method radios (around line 160-170)
- Modify: `script.js` — `handleCheckoutSubmit`

**Interfaces:**
- Consumes: the `create-order` webhook from Task 3.
- Produces: `sessionStorage` key `gmgPayment` holding the webhook response, read
  by Task 6.

- [ ] **Step 1: Split the Crypto radio**

In `checkout.html`, replace:

```html
                  <input class="form-check-input" type="radio" name="payment-method" id="payment-crypto" value="Crypto" required>
                  <label class="form-check-label" for="payment-crypto">Crypto</label>
```

with:

```html
                  <input class="form-check-input" type="radio" name="payment-method" id="payment-usdt" value="USDT" required>
                  <label class="form-check-label" for="payment-usdt">USDT (TRC-20)</label>
                </div>
                <div class="form-check">
                  <input class="form-check-input" type="radio" name="payment-method" id="payment-crypto" value="BTC" required>
                  <label class="form-check-label" for="payment-crypto">Bitcoin</label>
```

- [ ] **Step 2: Verify the radios render and submit correctly**

Start the local server and open checkout:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8899/checkout.html
```

In the browser console on `checkout.html`:

```js
[...document.querySelectorAll('input[name="payment-method"]')].map(r => r.value)
```

Expected: `["Bank Transfer", "USDT", "BTC"]`.

- [ ] **Step 3: Post to create-order before sending notifications**

In `script.js`, inside `handleCheckoutSubmit`, immediately after
`shippingBreakdownText` and `packageCount` are computed and before the EmailJS
payloads are built, insert:

```js
  // Crypto orders get a payment quote from n8n before anything is sent. The
  // amount is assigned server-side so it cannot be tampered with in the browser.
  const CREATE_ORDER_URL = 'https://n8n.godmusclegears.com/webhook/gmg-create-order';
  let payment = null;

  if (paymentMethod === 'USDT' || paymentMethod === 'BTC') {
    try {
      const res = await fetch(CREATE_ORDER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId, coin: paymentMethod, usdTotal: Number(grandTotal.toFixed(2)),
          customerName: fullName, email: customerEmail, phone: phone,
          items: storedCart.map(i => `${i.name} x${i.quantity || 1}`).join(' | '),
          shippingTotal: shipping, packageCount: Number(packageCount)
        })
      });
      if (!res.ok) throw new Error('create-order returned ' + res.status);
      payment = await res.json();
      sessionStorage.setItem('gmgPayment', JSON.stringify(payment));
    } catch (err) {
      console.error('❌ could not create payment quote', err);
      alert('⚠ We could not generate your payment details. Please contact us on Telegram to complete this order.');
      if (placeOrderBtn) { placeOrderBtn.disabled = false; placeOrderBtn.textContent = 'Place Order'; }
      return;
    }
  }
```

Note this makes the enclosing function asynchronous. Change its declaration
from `function handleCheckoutSubmit(event) {` to
`async function handleCheckoutSubmit(event) {`.

The order is deliberate: if the quote fails, the customer is told and **no**
emails or Telegram messages are sent, so no order exists that nobody can pay.

- [ ] **Step 4: Verify the failure path first**

With the n8n workflow **not** armed (so the webhook is unreachable), submit a
checkout on `http://localhost:8899/checkout.html` with USDT selected.

Expected: the alert appears, the Place Order button re-enables, and **no**
order email or Telegram message is sent. This is the more important of the two
paths — verify it before the success path.

- [ ] **Step 5: Verify the success path**

Arm the Task 3 workflow's Test URL, temporarily set `CREATE_ORDER_URL` to that
Test URL, and submit again.

Expected: a row appears in `Orders`, and in the browser console
`JSON.parse(sessionStorage.getItem('gmgPayment'))` returns the address, amount
and expiry.

Restore `CREATE_ORDER_URL` to the production URL afterwards.

- [ ] **Step 6: Carry the payment details into the customer email**

A customer who closes the success page has no other record of the address. In
`script.js`, add four fields to `customerPayload.template_params`, replacing:

```js
      shipping_note: shippingNote,
```

with:

```js
      shipping_note: shippingNote,
      pay_coin:    payment ? payment.coin : '',
      pay_address: payment ? payment.address : '',
      pay_amount:  payment ? String(payment.expectedAmount) : '',
      pay_expires: payment ? new Date(payment.expiresAt).toUTCString() : '',
```

Bank-transfer orders send empty strings, so the template can hide the block.

- [ ] **Step 7: Verify the fields are populated**

Repeat the Task 5 Step 5 success-path submission with the browser devtools
Network tab open. Inspect the outgoing request to `api.emailjs.com`.

Expected: `template_params` contains `pay_coin`, `pay_address`, `pay_amount`
and `pay_expires` with real values. Repeat with Bank Transfer selected and
confirm all four are empty strings.

- [ ] **Step 8: Commit**

```bash
git add checkout.html script.js && git commit -F- <<'MSG'
Add coin selection and server-side payment quote to checkout

Crypto orders now request a payment quote from n8n before any notification is
sent, so the payable amount is assigned server-side. A failed quote aborts the
order rather than creating one the customer cannot pay.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 6: Payment panel on the success page

**Files:**
- Modify: `order-success.html`
- Modify: `faq.html` — the accepted-coins answer (around line 196)

**Interfaces:**
- Consumes: `sessionStorage.gmgPayment` from Task 5.
- Produces: nothing.

- [ ] **Step 1: Add the payment panel markup**

In `order-success.html`, replace:

```html
    We'll contact you shortly with secure payment instructions.
```

with:

```html
    <span id="no-payment-msg">We'll contact you shortly with secure payment instructions.</span>

    <div id="payment-panel" style="display:none; text-align:left; background:var(--light-grey); border-radius:10px; padding:18px; margin-top:16px;">
      <p style="font-weight:700; text-transform:uppercase; letter-spacing:1px; font-size:0.8rem; margin-bottom:12px;">
        Send exactly <span id="pay-amount" style="color:var(--orange);"></span> <span id="pay-coin"></span>
      </p>
      <img id="pay-qr" alt="Payment QR code" style="width:180px; height:180px; display:block; margin:0 auto 12px;">
      <p style="font-size:0.72rem; color:var(--grey); margin-bottom:4px;">Address (<span id="pay-network"></span>)</p>
      <p id="pay-address" style="font-family:monospace; font-size:0.8rem; word-break:break-all; margin-bottom:12px;"></p>
      <p style="font-size:0.75rem; color:var(--grey); margin-bottom:6px;">
        Quote expires in <strong id="pay-countdown"></strong>
      </p>
      <p style="font-size:0.72rem; color:var(--grey); font-style:italic; margin:0;">
        Send the exact amount shown. Some exchanges deduct their withdrawal fee from
        the amount sent — please make sure the full amount arrives, or your order
        will need manual review.
      </p>
    </div>
```

- [ ] **Step 2: Add the panel script**

Immediately before the closing `</body>` tag of `order-success.html`:

```html
<script>
(function () {
  var raw = sessionStorage.getItem('gmgPayment');
  if (!raw) return;                       // bank transfer, or a direct visit

  var p;
  try { p = JSON.parse(raw); } catch (e) { return; }
  if (!p || !p.address) return;

  var panel = document.getElementById('payment-panel');
  var msg   = document.getElementById('no-payment-msg');
  if (msg)   msg.style.display = 'none';
  if (panel) panel.style.display = 'block';

  document.getElementById('pay-amount').textContent  = p.expectedAmount;
  document.getElementById('pay-coin').textContent    = p.coin;
  document.getElementById('pay-address').textContent = p.address;
  document.getElementById('pay-network').textContent = p.coin === 'USDT' ? 'TRC-20 / Tron' : 'Bitcoin';

  // QR encodes a plain address; wallets handle amount entry themselves and
  // BIP-21/TRC-20 URI support is inconsistent across wallets.
  document.getElementById('pay-qr').src =
    'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(p.address);

  var countdown = document.getElementById('pay-countdown');
  var expiry    = new Date(p.expiresAt).getTime();

  function tick() {
    var left = expiry - Date.now();
    if (left <= 0) {
      countdown.textContent = 'expired — contact us on Telegram';
      return;
    }
    var m = Math.floor(left / 60000);
    var s = Math.floor((left % 60000) / 1000);
    countdown.textContent = m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    setTimeout(tick, 1000);
  }
  tick();
})();
</script>
```

- [ ] **Step 3: Correct the FAQ**

In `faq.html`, replace:

```html
            We accept cryptocurrency payments including Bitcoin and other major coins. This ensures fast, secure, and private transactions. Payment details are provided at checkout.
```

with:

```html
            We accept USDT (TRC-20 / Tron network) and Bitcoin. Your payment address and the exact amount are shown immediately after you place your order.
```

- [ ] **Step 4: Verify the panel renders**

Serve locally and seed a fake quote in the browser console, then load the page:

```js
sessionStorage.setItem('gmgPayment', JSON.stringify({
  orderId: 'TEST-001', coin: 'USDT',
  address: 'TTESTTESTTESTTESTTESTTESTTESTTEST01',
  expectedAmount: 512.73,
  expiresAt: new Date(Date.now() + 30*60*1000).toISOString()
}));
location.href = 'http://localhost:8899/order-success.html';
```

Expected: the panel shows `512.73 USDT`, the address, network `TRC-20 / Tron`,
a QR image, and a countdown ticking down from about `29m 59s`. The
"we'll contact you shortly" line is hidden.

- [ ] **Step 5: Verify the bank-transfer path is untouched**

```js
sessionStorage.removeItem('gmgPayment');
location.href = 'http://localhost:8899/order-success.html';
```

Expected: the panel stays hidden and the original
"We'll contact you shortly with secure payment instructions" line shows.

- [ ] **Step 6: Verify expiry rendering**

```js
sessionStorage.setItem('gmgPayment', JSON.stringify({
  orderId: 'TEST-002', coin: 'BTC',
  address: '1TESTTESTTESTTESTTESTTESTTESTTEST01',
  expectedAmount: 0.00512345,
  expiresAt: new Date(Date.now() - 1000).toISOString()
}));
location.href = 'http://localhost:8899/order-success.html';
```

Expected: countdown reads `expired — contact us on Telegram`.

- [ ] **Step 7: Commit**

```bash
git add order-success.html faq.html && git commit -F- <<'MSG'
Show crypto payment details on the order success page

Address, exact amount, QR and a 30-minute countdown are rendered from the quote
returned by n8n. Bank-transfer orders are unaffected. FAQ corrected to name the
two coins actually accepted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 7: End-to-end verification with real money

**Files:**
- Modify: `docs/superpowers/specs/2026-08-23-crypto-payment-automation-design.md`

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: nothing.

This task spends real money. Amounts are deliberately tiny.

- [ ] **Step 1: Correct the spec's overpayment rule**

In the spec's failure-handling table, replace:

```
| Amount exceeds expected | `status = PAID` + alert noting the overage |
```

with:

```
| Amount exceeds expected, within 2% of exactly one open order | `status = REVIEW` + alert stating the overage. Never auto-confirms |
| Amount exceeds expected, no single candidate | Reported as an unmatched payment |
```

An overpayment cannot be attributed with confidence, because the amount is the
only identifier. See the plan's "Spec correction adopted by this plan".

- [ ] **Step 2: Live USDT test — exact payment**

With the local site running and both n8n workflows armed via their Test URLs,
place an order for a single cheap item, selecting USDT.

Send **exactly** the quoted amount from a wallet you control.

Expected, within two poll cycles (≤4 minutes):
- Telegram: `💰 PAYMENT CONFIRMED — Order …`
- `Orders` row: `status = PAID`, `paidAt` and `txHash` populated
- `processed_tx`: one new row

- [ ] **Step 3: Live USDT test — deliberate underpayment**

Place a second USDT order. Send the quoted amount **minus $0.30**.

Expected: Telegram mismatch alert naming the order and the shortfall; row set
to `REVIEW`; **not** `PAID`.

This proves the most important safety property: a wrong amount never confirms.

- [ ] **Step 4: Live unmatched-payment test**

With no open orders, send ~$1 USDT to the address.

Expected: `❓ UNMATCHED PAYMENT` Telegram alert; no order row modified.

- [ ] **Step 5: Live BTC test**

Place a BTC order and pay the exact quoted amount.

Expected: confirmation within roughly 10-15 minutes, once the transaction has 1
confirmation. Before that confirmation lands, nothing should fire — verify that
the watcher stays silent while the transaction is unconfirmed.

- [ ] **Step 6: Clean up test data**

Delete every test row from `Orders` and `processed_tx` **by exact `orderId` and
`txHash`** — never by a content match, and count the rows before and after.

- [x] **Step 7: Hand off the EmailJS template change** — SUPERSEDED 2026-08-26.
      EmailJS was retired entirely rather than edited; both order emails now
      come from n8n. See `2026-08-26-retire-emailjs.md`.

The customer template `template_0ry9w0v` lives in the EmailJS dashboard, not in
this repository, and must be edited by hand — the same handoff as the shipping
work. Give Lester this block to paste after the shipping-note line, and have him
confirm it saved before go-live:

```html
  <!-- ✅ Crypto Payment Instructions -->
  <div style="background:#fff3cd; border-left:5px solid #ff4500; padding:12px; margin-top:16px;">
    <p style="margin:0 0 8px; font-weight:bold;">Send exactly {{pay_amount}} {{pay_coin}}</p>
    <p style="margin:0 0 8px; font-family:monospace; font-size:13px; word-break:break-all;">{{pay_address}}</p>
    <p style="margin:0 0 8px; font-size:12px;">This quote expires at {{pay_expires}}.</p>
    <p style="margin:0; font-size:12px; font-style:italic;">
      Some exchanges deduct their withdrawal fee from the amount sent. Please make sure
      the full amount arrives, or your order will need manual review.
    </p>
  </div>
```

Note for Lester: on a Bank Transfer order these fields arrive empty, so the box
renders with no values. If that looks wrong to him, the fix is a second template
rather than conditional logic, since EmailJS templates have no conditionals.

- [ ] **Step 8: Commit the spec correction**

```bash
git add docs/superpowers/specs/2026-08-23-crypto-payment-automation-design.md && git commit -F- <<'MSG'
Correct overpayment handling in the crypto payment spec

An overpayment cannot be attributed with confidence because the amount is the
only order identifier, so it is treated as REVIEW like an underpayment rather
than auto-confirming.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 8: Go live

**Files:**
- Modify: `script.js` — `CREATE_ORDER_URL`

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: nothing.

**Do not begin this task until Lester has confirmed every check in Task 7 passed.**

- [ ] **Step 1: Publish both workflows**

Publish `GMG - Create Order` and `GMG - Payment Watcher` in n8n. Confirm the
Payment Watcher shows a scheduled next-run time.

- [ ] **Step 2: Confirm the production webhook URL**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST 'https://n8n.godmusclegears.com/webhook/gmg-create-order' -H 'Content-Type: application/json' -d '{}'
```

Expected: any response other than `404`. A `404` means the workflow is not
published — stop and fix that before merging.

- [ ] **Step 3: Confirm script.js points at the production URL**

```bash
grep -n "CREATE_ORDER_URL" script.js
```

Expected: `https://n8n.godmusclegears.com/webhook/gmg-create-order`, not a
Test URL. A Test URL reaching production would silently break every order.

- [ ] **Step 4: Run the full test suite**

```bash
node --check script.js && node --check payment-matching.js && node --test tests/*.test.js
```

Expected: both checks silent; all tests pass.

- [ ] **Step 5: Merge and deploy**

```bash
git checkout main && git merge crypto-payment-automation --no-ff -m "Merge crypto payment automation" && git push origin main
```

- [ ] **Step 6: Verify the deploy reached GitHub Pages**

```bash
for i in $(seq 1 8); do
  n=$(curl -s https://godmusclegears.com/checkout.html | grep -c 'payment-usdt')
  echo "attempt $i: coin radio live = $n"
  [ "$n" = "1" ] && break
  sleep 20
done
```

Expected: `1` within a couple of minutes.

- [ ] **Step 7: Place one real order on the live site**

Order a cheap item with USDT and pay the exact amount.

Expected: payment panel renders, confirmation Telegram arrives, `Orders` row
reads `PAID`.

- [ ] **Step 8: Clean up and record**

Delete the live test row by exact `orderId`. Update
`C:\Users\LESTER\memory\ecommerce-stores.md` under God Muscle Gears with: both
workflow IDs, the Sheet ID reference, the coins accepted, the 30-minute expiry,
the 1-confirmation rule, the 2% near-match band, and the standing rule that only
an exact match may set `PAID`.
