# Withdrawal-Fee Tolerance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** COMPLETE. All tasks done. The EmailJS paste that was outstanding
became moot on 2026-08-26 when EmailJS was retired entirely and the fee
instruction moved into the n8n template (`docs/emails/build-emails.js`).

Logic is in `payment-matching.js` and ported to `GMG - Payment Watcher`, verified
on the deployed node (execution `5018`, all six bands). **The BTC ceiling was
corrected 2026-08-26** from `0.0005` to `0.00005` after testing against real
chain data — see "The BTC ceiling was wrong" below; re-verified by execution
`5042`. Suite is now **85 tests**. **Workflow remains UNPUBLISHED.**

**Depends on:** `2026-08-23-crypto-payment-automation.md` Tasks 1–6 (done).
This plan **modifies artifacts those tasks already built** — `payment-matching.js`
and the watcher's `Match Payments` Code node. Do it before that plan's Task 8.

**Decided by Lester 2026-08-25.** This closes the "Binance issue still undecided"
item in the main plan.

---

## The problem

Crypto exchanges deduct their withdrawal fee **from** the amount sent. A buyer
told to send `85.43` who types `85.43` has ~1.50 taken off, and `83.93` arrives.
Amount is the only thing identifying an order, so that payment does not match
and the order sits in `REVIEW` — a manual tap on a customer who did nothing
wrong.

### Why this is not a Binance problem

The paused test order encodes Binance's 1.50 fee, but Binance is only the
platform *Lester* has. Buyers arrive from anywhere, and there are two classes of
sender that behave in **opposite directions**:

| Sender | Fee paid | Told to send 85.43 → we receive |
|---|---|---|
| Exchange (Binance, OKX, Bybit, KuCoin, Kraken…) | deducted from the transfer | ~83–84.6, varies by platform |
| Self-custody (Trust Wallet, TronLink, Ledger) | paid separately in TRX | **85.43 exactly** |

Approximate TRC-20 USDT withdrawal fees run roughly **0.8–2.5**, clustered near
1.0–1.5. Treat those as indicative, not authoritative — they change, and they
should be spot-checked against the platforms buyers actually use.

**This is why marking the quote up was rejected.** Quoting 86.50 and watching
for 85.00 would auto-confirm exchange senders, but every self-custody buyer
would then overpay by 1.50 and land in `REVIEW` — the same problem, moved, plus
a quiet $1.50 overcharge on wallet users. No fixed markup can be right when the
fee depends on a platform we cannot see at quote time.

## The decision

**Quote the true amount. Put the fee on the buyer through instruction. Use a
shortfall ceiling as a safety net, not as the default path.**

- The payment panel tells the buyer, loudly and with a worked example, to add
  their exchange's fee on top so the full amount arrives.
- A buyer who follows it matches exactly → `PAID`, full amount received.
- A buyer who ignores it lands short → auto-accepted if within the ceiling, so
  the order still flows and no one is chased.
- A self-custody buyer matches exactly → `PAID`. Never overcharged.

**Ceilings:** `3.00` USDT, ~~`0.0005`~~ **`0.00005`** BTC (corrected 2026-08-26 —
see "The BTC ceiling was wrong" below).

**Overpayments within the ceiling also auto-confirm**, with the overage stated
in the Telegram alert so Lester can refund at his discretion.

### Flat, not percentage

The current tolerance is `NEAR_MATCH_TOLERANCE = 0.02` (2%). The fee it exists
to absorb is **flat** — roughly 1.50 whether the order is $85 or $500. A
percentage is the wrong shape in both directions:

| Order | 2% tolerance | Verdict |
|---|---|---|
| $85 | $1.70 | too tight — a ~2.5 fee still lands in REVIEW |
| $500 | $10.00 | too loose — $10 of free money on the table |

A flat ceiling is strictly better at both ends.

### Revising the earlier "overpayment is REVIEW" decision

The main plan deliberately corrected the spec so overpayment produced `REVIEW`,
reasoning that an overpayment matches no expected amount and is therefore
unattributable, and that releasing goods against unattributable money is unsafe.

That reasoning holds for **ambiguous** payments — and ambiguity is already
handled separately and independently by the unique-candidate check
(`near.length !== 1` → no match at all). Once exactly one open order sits within
the ceiling, the payment *is* attributable, and it is attributable by the same
test in both directions. Treating over and under asymmetrically was protecting
against a case the ambiguity check already covers.

Underpayment is in fact the riskier of the two, because it releases goods for
less than the asking price. Overpayment does not. So the direction that was
`REVIEW` was the safer one.

## Global constraints

- **Ambiguity always wins.** If more than one open order sits within the band,
  there is no match — regardless of ceiling. Unchanged behaviour, and it is what
  keeps a wider window safe.
- **The ceiling is a maximum, not a target.** Panel copy must still tell buyers
  to send the full amount. It is a safety net for buyers who ignore that, not
  the intended path.
- **`payment-matching.js` and the watcher's `Match Payments` node hold the same
  logic in two places.** The module is the source of truth; the Code node is a
  paste of it. Any change here must land in both, and Task 3 verifies it.
- **Nothing auto-ships.** `PAID` still means a human releases the order.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `payment-matching.js` | Modify | Replace 2% band with the two-band ladder. |
| `tests/payment-matching.test.js` | Modify | Update affected cases, add new ones. |
| n8n `GMG - Payment Watcher` | Modify | `Match Payments` node: same logic, new alert text. |
| `order-success.html` | Modify | Louder fee instruction with a worked example. |
| ~~EmailJS `template_0ry9w0v`~~ | Superseded | EmailJS retired 2026-08-26; the fee line now lives in `docs/emails/build-emails.js`. |

---

### Task 1: Two-band matching in `payment-matching.js`

**Files:**
- Modify: `payment-matching.js`
- Modify: `tests/payment-matching.test.js`

**Interfaces:**
- Produces: new `findMatch` result types `AUTO_UNDER` / `AUTO_OVER`, consumed by
  Task 2.

- [x] **Step 1: Replace the tolerance constants**

Remove `NEAR_MATCH_TOLERANCE = 0.02`. Add:

```js
// Exchanges deduct their withdrawal fee from the amount sent, so a buyer who
// types the exact quoted amount underpays by that fee. The fee is FLAT (~0.8-2.5
// on TRC-20 regardless of order size), so the ceiling is flat too - a percentage
// would be too tight on an $85 order and far too generous on a $500 one.
const AUTO_ACCEPT_MAX = { USDT: 3.00, BTC: 0.00005 };  // BTC corrected 2026-08-26

// Beyond the auto-accept ceiling but still plausibly this order: a human decides.
const REVIEW_TOLERANCE = 0.10;
```

- [x] **Step 2: Rewrite the matching ladder**

`findMatch` becomes an ordered ladder. Order matters — each rung is only reached
when the one above finds nothing.

| # | Condition | `type` | Resulting status |
|---|---|---|---|
| 1 | exact amount, order open | `EXACT` | `PAID` |
| 2 | exact amount, order expired | `EXPIRED_MATCH` | `REVIEW` |
| 3 | within `AUTO_ACCEPT_MAX`, open, **exactly one candidate** | `AUTO_UNDER` / `AUTO_OVER` | `PAID` |
| 4 | within `REVIEW_TOLERANCE`, open, **exactly one candidate** | `NEAR_UNDER` / `NEAR_OVER` | `REVIEW` |
| 5 | anything else | `NONE` | unmatched alert |

Both rungs 3 and 4 apply the single-candidate rule independently. Two orders
inside the auto-accept band are necessarily also inside the review band, so an
ambiguous payment falls all the way through to `NONE` rather than being
auto-attributed to the wrong order at a lower confidence.

`difference` keeps its existing meaning throughout: signed, received minus
expected, so negative is short.

- [x] **Step 3: Update the existing tests that this changes**

These currently assert `REVIEW` outcomes that become `PAID`. They are correct
tests of the old rule, not bugs — update the expectations, do not delete them:

- any `NEAR_UNDER` case with a difference inside 3.00 USDT
- any `NEAR_OVER` case with a difference inside 3.00 USDT
- any case relying on 2% of a large amount being tolerated (2% of $500 was
  $10.00 and is now outside the auto-accept ceiling)

- [x] **Step 4: Add tests for the new behaviour**

Boundary cases first — they are where a flat ceiling actually bites:

- short by exactly `3.00` → `AUTO_UNDER` (inclusive)
- short by `3.01` → `NEAR_UNDER`
- over by exactly `3.00` → `AUTO_OVER`
- over by `3.01` → `NEAR_OVER`
- BTC short by `0.00005` → `AUTO_UNDER`; by `0.00006` → `NEAR_UNDER`
- the BTC ceiling stays **under 5% of a real order** (0.0012–0.0035 BTC), and
  the two coins write off comparable dollar amounts — the checks that would have
  caught the original `0.0005`
- **two open orders both within 3.00 of the received amount → `NONE`**, not an
  auto-accept of the nearer one. This is the load-bearing safety test.
- one order within 3.00 and a second within 10% but outside 3.00 → `NONE`
  (rung 3 is ambiguous only if two are in *its* band; here rung 3 has one
  candidate → `AUTO_*`). Assert whichever the ladder in Step 2 specifies and
  make the intent explicit in the test name.
- an **expired** order short by 1.00 → not auto-accepted; expiry is checked
  before the ceiling
- a $500 order short by `9.00` → `NEAR_UNDER`, proving the old 2% generosity is
  gone

- [x] **Step 5: Run the suite**

```bash
node --test tests/*.test.js
```

Note the glob — `node --test tests/` resolves as a module path and fails. The
`shipping.js` suite must still pass untouched.

---

### Task 2: Port the logic into the watcher

**Files:**
- Modify: n8n `GMG - Payment Watcher` (`UEIXJauCOKOhxIUh`), `Match Payments` node

- [x] **Step 1: Replace the matching block**

Paste the updated constants and `findMatch` from Task 1 over the equivalent
section of the Code node. Do not hand-edit it into a variant — divergence
between the tested module and the node that actually runs is the specific
failure this architecture exists to prevent.

- [x] **Step 2: Handle the new types in the status/alert block**

Add ahead of the existing `NEAR_UNDER`/`NEAR_OVER` branch:

```js
} else if (m.type === 'AUTO_UNDER' || m.type === 'AUTO_OVER') {
  newStatus = 'PAID';
  const word = m.difference < 0 ? 'short by' : 'over by';
  const diffText = p.coin === 'BTC' ? Math.abs(m.difference).toFixed(8) : Math.abs(m.difference).toFixed(2);
  notes = 'auto-accepted, ' + word + ' ' + diffText;
  telegramText = (m.difference < 0
      ? 'PAYMENT CONFIRMED (fee absorbed)\n'
      : 'PAYMENT CONFIRMED (overpaid)\n')
    + 'Order ' + m.order.orderId + '\n'
    + 'Received ' + amountText + ' ' + p.coin + ', expected ' + expectedText + '\n'
    + word + ' ' + diffText + '\n'
    + (m.difference < 0 ? 'Within the auto-accept limit.' : 'Refund at your discretion.') + '\n'
    + 'tx ' + p.txHash;
}
```

`paidAt` is currently stamped only when `m.type === 'EXACT'`. It must also be
stamped for `AUTO_UNDER` and `AUTO_OVER` — otherwise auto-accepted orders reach
`PAID` with an empty `paidAt`, and there is no record of when the money landed.

- [x] **Step 3: Re-verify the whole workflow**

`update_workflow` has silently dropped parameters from untouched nodes on this
project repeatedly. After the edit:

```
get_workflow_details UEIXJauCOKOhxIUh
```

Confirm on nodes you did NOT touch: both Telegram nodes still have their
`chatId` and text expression, all four Google Sheets nodes still have their
`operation` and full column schema, and the workflow still has
`errorWorkflow: sXZtgBw3kX1dhgWg` and `timezone: Asia/Manila`.

- [x] **Step 4: Prove it with pinned data, not real money**

Use `prepare_workflow_pin_data` to feed the matcher a synthetic TronGrid
response, so every branch is exercised without spending anything:

| Pinned received amount vs an open order expecting 85.43 | Expected |
|---|---|
| `85.43` | `PAID`, notes empty |
| `83.93` (short 1.50) | `PAID`, notes `auto-accepted, short by 1.50`, `paidAt` set |
| `82.43` (short 3.00) | `PAID`, auto-accepted |
| `82.42` (short 3.01) | `REVIEW`, notes `short by 3.01` |
| `86.93` (over 1.50) | `PAID`, notes `auto-accepted, over by 1.50` |
| two open orders at `85.43` and `84.50`, receive `84.00` | no match, `UNMATCHED PAYMENT` alert |

Confirm the `paidAt` cell is populated in the auto-accepted rows specifically —
that is the easiest thing here to get wrong and the hardest to notice later.

---

### Task 3: Verify the module and the node agree

**Files:**
- Read: `payment-matching.js`, the `Match Payments` node

- [x] **Step 1: Diff them**

Extract the Code node's `jsCode` and diff the shared region against
`payment-matching.js`. The constants and `findMatch` must be character-identical
apart from the node's extra n8n-specific surroundings.

This exists because the duplication is real and silent: the tests prove the
module, the node is what runs, and nothing enforces that they match. A drift
here means 52 passing tests describing code that is not in production.

---

### Task 4: Panel and email copy

**Files:**
- Modify: `order-success.html`
- Modify: EmailJS template `template_0ry9w0v`

- [x] **Step 1: Rewrite the panel's fee note**

The current italic note is accurate but soft — it warns that exchanges deduct a
fee without telling the buyer what to *do*. Replace it with an instruction and a
worked example, and give it visual weight rather than italic small print:

> **Sending from an exchange?** Binance, OKX, Bybit and others take their
> withdrawal fee out of what you send. Add it on top so the full amount arrives
> — e.g. if the fee is 1.50, send **86.93** so we receive **85.43**.
> Sending from your own wallet (Trust Wallet, TronLink, Ledger)? Send exactly
> **85.43** — your fee is paid separately in TRX.

Both amounts must be interpolated from the live quote, never hardcoded.

Say nothing about the 3.00 ceiling. Publishing the tolerance turns it into a
discount every buyer can take.

- [x] **Step 2: Same instruction in the email**

The payment block for `template_0ry9w0v` has still never been pasted in — it is
outstanding from the main plan's Task 7 Step 7. Write it with this copy included
so it only has to be done once. The code already sends `pay_coin`,
`pay_address`, `pay_amount` and `pay_expires`.

> **Reminder for Lester:** this is a manual dashboard edit. Nothing in the repo
> can do it, and until it is done the success page promises an email that does
> not contain the payment details.

- [~] **Step 3: Verify both against a real quote** — panel DONE (USDT + BTC,
  both amounts interpolated from a live quote). Email half BLOCKED: the block is
  written to `docs/emailjs-customer-payment-block.html` but cannot be verified
  until Lester pastes it into the dashboard, and a real end-to-end order also
  needs `GMG - Create Order` published. Verify at go-live, and send one BANK
  TRANSFER test order specifically — that is what proves the conditional works.

Render the panel locally and confirm the worked example uses the actual quoted
amount. Send yourself a test order and confirm the email block renders with
every variable populated — an unresolved `{{pay_amount}}` in a customer's inbox
is worse than no block at all.

---

### Task 5: Update the plans and memory

- [x] **Step 1: Close the open question in the main plan**

In `2026-08-23-crypto-payment-automation.md`, replace the "Known issue to weigh
before launch" section with the decision recorded here, and link to this plan.
Also correct the two places that describe a 2% near-match tolerance.

- [x] **Step 2: Update memory**

In `C:\Users\LESTER\memory\ecommerce-stores.md` and
`C:\Users\LESTER\memory\n8n-workflows.md`, record: the fee ceilings, that buyers
are not Binance-only, that exchange and self-custody senders behave in opposite
directions, and that overpayment inside the ceiling now auto-confirms.

---

## The BTC ceiling was wrong — corrected 2026-08-26

This plan shipped `0.0005 BTC` and flagged it as "a guess to revisit once there
are real BTC orders to look at". Lester suggested testing against historical
transactions on the actual receiving address, which finally made it judgeable.

Real inbound payments to that address run **0.0012–0.0035 BTC** — roughly
$95–$275 at ~$79k. So the ceiling was **14–38% of a typical order**. The watcher
would have auto-confirmed a payment about **$39 short** and emailed the buyer a
thank-you. Real BTC withdrawal fees are ~$1–15.

Corrected to **`0.00005 BTC`**, about $4 — economically comparable to the 3.00
USDT ceiling, still comfortably above both a real withdrawal fee and the ~$0.79
uniqueness tail.

**Why it slipped through:** every earlier test asserted the *constant* and the
*boundary either side of it*. Those all passed, because they were checking the
code did what the number said — never whether the number was sensible. Two tests
now pin it against reality instead: the ceiling must stay under 5% of the real
payment sizes seen on-chain, and the two coins must write off comparable amounts
of money at a plausible BTC price. Either would have caught the original figure.

> The lesson generalises: a constant expressed in one unit (BTC) standing in for
> a quantity that matters in another (dollars) needs a test in the *second* unit.

## Residual risks

- **The ceiling is free money if it is discovered.** A buyer who learns they can
  underpay by 2.99 will. At this volume and price point that is a small,
  acceptable exposure — but it argues for never publishing the number, and for
  glancing at the `auto-accepted, short by` notes now and then. A cluster of
  shortfalls at exactly 2.99 is not a coincidence.
- **Ambiguity rises with volume.** A wider band means more chance two open
  orders sit inside it. It degrades safely — the matcher refuses to guess and
  Lester matches by hand — but it degrades more often as orders grow. At 50
  orders/day this would need revisiting.
- **The real fix is per-order deposit addresses**, which removes amount-matching
  entirely. That means key management on the VM, which is a materially bigger
  and more dangerous project, and is the same reason BTCPay Server was rejected.
  Not now. Named so it is not rediscovered later as if it were new.
- **The BTC ceiling is a fixed BTC amount standing in for a fixed dollar one.** BTC withdrawal fees move with
  network congestion and are much larger in dollar terms than USDT's. Revisit
  once there are real BTC orders to look at.
