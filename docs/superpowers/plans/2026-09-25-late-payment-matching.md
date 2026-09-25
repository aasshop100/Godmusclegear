# Late payment matching — EXECUTED 2026-09-25

> This is a record of what was done, not a to-do list.
>
> **Updated later the same day: the ambiguity hole described in the last section
> was ALSO fixed.** It is kept in full because the reasoning matters — the
> obvious fix (widen the uniqueness tail) is arithmetically impossible, and
> anyone revisiting this will reach for it first.

## What happened

ORDER-1790270782250 (Khaled Mansour, $347.72, BTC) was the **first real crypto
payment the watcher has ever seen on-chain**. The long-standing warning that "no
crypto payment has ever been DETECTED end-to-end" is now closed.

Chain parsing worked perfectly. Matching is what failed.

| | |
|---|---|
| Quoted | 0.00413711 BTC ($347.72 at $84,241) |
| Received | 0.00409839 BTC — short 0.00003872 (~$3.26) |
| Auto-accept ceiling | 0.00005 BTC (~$4.21) — the shortfall was INSIDE it |
| Quote expired | 2026-09-25 04:26:24; payment seen 08:42:12 — **4h16m late** |
| Result | `NONE` -> "UNMATCHED PAYMENT / No matching open order." |

## Why it was the worst possible gap

Every tolerance band was gated behind `isOpen()`, so an expired order could only
be matched by an EXACT amount. That is the one payment an exchange never sends:

- **Late** — the exchange batches the withdrawal before it is ever broadcast.
- **Short** — the fee comes out of the amount sent.

The two commonest properties of real money combined into the single state the
matcher refused to handle. The matcher *found* the order — 0.00409839 sits well
inside the ceiling around 0.00413711 — then discarded it and alerted as if no
order existed.

It was also **not an untested gap**. Two tests asserted `NONE` for exactly this
case. It was a deliberate design decision that was simply wrong in practice.

## What changed

**1. `EXPIRED_NEAR`.** `findMatch` now falls back to expired rows when nothing
open fits, and returns the order instead of `NONE`. Routes to `REVIEW`.

- **Never auto-accepted.** Past expiry the BTC rate may have moved; that is a
  human decision. This is the invariant the two old tests were defending, so
  they were **inverted, not deleted**.
- **Open orders outrank expired ones.** An expired row can never swallow the
  payment for an order that is still live.
- **Ambiguity still wins.** If an open order was in the running but could not be
  told apart from another, the matcher stops — it does not reach past the open
  orders to an expired one. Rule 1 outranks surfacing late money.

**2. The REVIEW alert speaks dollars.** Built from `btcRate` and `usdTotal`
already on the row, so no new API call:

```
LATE PAYMENT - REVIEW
Order ORDER-1790270782250 (expired 2026-09-25 04:26:24)
Received 0.00409839 BTC, expected 0.00413711
short by 0.00003872
At the quoted rate ($84241): worth $345.25 vs a $347.72 order (-$2.47)
Check BTC now - a late payment carries the rate move since the quote.
```

The rate move, not the satoshi delta, is what the decision turns on.

**3. BTC quote window 3h -> 12h.** `expiryMinutesBtc` 180 -> 720 on the
`Payment Addresses` Set node of `GMG - Create Order` — a **config value, not
code**. 3h was shorter than Bitcoin's own worst-case path to the mempool; the
real payment took **7h16m**, so 3h and 6h would both have missed it. USDT stays
at 30 min (Tron settles in seconds, stablecoin = no rate risk).

`EXPIRY_MINUTES` in `payment-matching.js` became `{ USDT: 30, BTC: 720 }` so the
constant cannot drift from the config node the way the BTC ceiling did in August.

## Verification

- **142/142** tests green (`node --test tests/*.test.js`), 6 new, including the
  Khaled case with real numbers.
- **14-case behavioural parity** between `payment-matching.js` and the live
  `Match Payments` Code node, covering every pre-existing outcome. The module is
  a mirror of the node; proving they agree is the only thing that makes the unit
  tests mean anything about production.
- Code node **byte-identical by sha256** after upload.
- **Zero param drift** on all untouched nodes in both workflows; connections
  unchanged; `returnAllMatches` survived on `Read Open Orders` (the documented
  trap on this workflow).
- First post-publish watcher run clean: `Match Payments` -> `[]`,
  `Check Watcher Health` -> 0 alerts, no unmatched alert, no errors.

## Khaled's order — closed by hand

Sheet row set to `PAID` with `paidAt`, `txHash` and an explanatory note;
`processed_tx.matchedOrderId` backfilled; confirmation email sent through the GMG
SMTP credential as `admin@godmusclegears.com` (SMTP envelope verified).

**A tx already in `processed_tx` is never reconsidered**, so a missed match can
only ever be repaired manually. The confirmation email did not auto-send because
that branch hangs off the MATCHED output, which was never reached.

> When building the one-off sender, n8n **auto-assigned the wrong SMTP
> credential** (`SMTP account` = `lstrmrcd@gmail.com`, SingilinMO's) instead of
> `SMTP - God Muscle Gears`. A wrong credential here is silent: the send
> succeeds, from the wrong identity. Always confirm `credentials.smtp.id` is
> `wbNyEh5HUE1ugRdl` before executing anything that emails a GMG customer.

## FIXED (same day) — the uniqueness tail is narrower than the auto-accept ceiling

**This was the biggest remaining hole in BTC ordering, and the 12h window made it
more likely, not less.**

| Coin | Uniqueness tail | Auto-accept ceiling | |
|---|---|---|---|
| BTC | 0-999 sat (`0.00001`) | `0.00005` | **5x wider** |
| USDT | 0-0.99 | `3.00` | **3x wider** |

The tail exists so two orders can be told apart by amount. But the ceiling is
wider than the entire tail space, so two orders for the same cart sit inside each
other's tolerance, `only()` returns null, and the ambiguity guard rejects
**both**.

Reproduced:

```
order A quoted 0.00414095
order B quoted 0.00414327   (same cart, same rate)
they differ by 0.00000232 BTC — ceiling is 0.00005000

customer A pays 0.00412095  (their quote minus a 0.00002 exchange fee)
  -> NONE, unmatched alert

customer A pays 0.00414095  (exactly)
  -> EXACT, order A
```

Two concurrent same-cart BTC orders therefore worked **only if both customers paid
to the satoshi** — which an exchange withdrawal never does.

### Why widening the tail CANNOT fix it

This was the first instinct and it is wrong. A payment is ambiguous whenever two
orders are within **2x the ceiling** ($8.42), and the tail is added to the
customer's price — so buying a guaranteed gap means overcharging by that much.

| STEPS | tail span | collision rate, 2 same-cart orders |
|---|---|---|
| 1,000 (was) | $0.84 | **100%** |
| 10,000 | $8.42 | **100%** |
| 100,000 | $84.24 | 19% |
| 1,000,000 | $842.41 | 2% |

There is no value that both hides in a price and guarantees separation. Random
assignment can always place two orders adjacent, so no tail width *guarantees*
anything — it only lowers the odds.

### What was done instead

Ambiguity became a **reported outcome** rather than an impossible state, the same
principle as `EXPIRED_NEAR`: stop discarding what the matcher already knows.

`AMBIGUOUS` carries the candidate orders. The alert lists them:

```
AMBIGUOUS PAYMENT - NOT MATCHED
0.00412095 BTC received
Fits 2 orders, so none was touched:
  ORDER-A expects 0.00414095 (Jane Doe)
  ORDER-B expects 0.00414327 (John Roe)
tx abc123...
Decide which one and close it by hand.
```

**Rule 1 is unchanged** — nothing is auto-assigned and no row is touched. Four
tests asserted `NONE` for ambiguity; they were **inverted, not deleted**, each
keeping its real invariant (`order === null`, never auto-accepted).

`Matched An Order?` now routes on `matchedOrderId` rather than `matchType`, so
any result without an order is **structurally incapable** of reaching
`Update Order Row`.

**Residual risk, accepted:** a genuinely ambiguous payment still needs a human to
decide which order it belongs to. That is unavoidable when two orders are priced
within a withdrawal fee of each other — but it is now a 30-second decision with
both candidates on screen, instead of money that appears to belong to nobody.

### Smaller open items

- **`taken` does not reserve EXPIRED amounts.** `Build Order` only reserves from
  `AWAITING_PAYMENT`/`PAYMENT_SEEN`. Now that expired rows can match, their
  amounts arguably should be reserved too. Precedence (open tried first) protects
  the common case, so this is not urgent.
- **An unmatched tx is write-once.** It lands in `processed_tx` and is never
  revisited — one Telegram, then silence forever. Miss that message and the money
  is invisible. Wants a holding state that re-alerts until cleared.
- **`0.00005` BTC is a fixed BTC amount standing in for a fixed dollar amount** —
  the exact shape of the bug that made it wrong in August. It means "about $4" at
  ~$79-84k BTC. At $150k it silently becomes $7.50; at $40k it drops to $2 and
  starts rejecting genuine fee shortfalls. Re-check when BTC moves a long way, or
  resolve it against `btcRate` at match time.
