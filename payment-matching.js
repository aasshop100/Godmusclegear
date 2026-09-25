// payment-matching.js — GOD MUSCLE GEARS
// Pure payment/order matching. No DOM, no network, no storage.
// Unit-tested here, then pasted verbatim into the n8n Code nodes.
//
// Rules that must never be relaxed:
//   1. A payment that could belong to more than one open order is NEVER matched.
//      Ambiguity is always reported as unmatched, whatever the amounts.
//   2. Nothing here releases goods. PAID means the money arrived; a human still
//      ships the order.
//
// Revised 2026-08-25: an exact match is no longer the ONLY route to PAID. A
// payment inside a flat per-coin ceiling of the expected amount now auto-accepts
// too, because exchanges deduct their withdrawal fee from the amount sent and a
// buyer who types the quoted amount exactly will therefore underpay by that fee.
// See docs/superpowers/plans/2026-08-25-payment-fee-tolerance.md.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== 'undefined' ? window : null, function () {

  const USDT_CONTRACT  = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  // How long a quote stays open, per coin. This is DOCUMENTATION of what the
  // Payment Addresses node on GMG - Create Order is set to (expiryMinutesUsdt /
  // expiryMinutesBtc); that node is what actually stamps expiresAt. Keep them
  // in step - a stale constant here is how the BTC ceiling went wrong in 2026-08.
  //
  // USDT settles in seconds on Tron and is a stablecoin, so it carries no rate
  // risk and stays tight. BTC was 180 until 2026-09-25, which is shorter than
  // Bitcoin's own worst-case path to the mempool: the customer's exchange
  // batches the withdrawal before it is ever broadcast. A real payment landed
  // 7h16m after the order, missed the window, and had to be closed by hand.
  const EXPIRY_MINUTES = { USDT: 30, BTC: 720 };

  // Exchanges deduct their withdrawal fee FROM the amount sent, so a buyer who
  // types the quoted amount exactly underpays by that fee. Self-custody wallets
  // pay it separately in TRX and deliver the full amount — the two behave in
  // opposite directions, which is why the quote is never marked up and the
  // difference is absorbed here instead.
  //
  // FLAT, not a percentage: the fee is ~0.8–2.5 on TRC-20 whether the order is
  // $85 or $500. The 2% band this replaced was simultaneously too tight on a
  // small order (missing a 2.5 fee) and far too generous on a large one ($10).
  //
  // The two coins are set to be ECONOMICALLY EQUIVALENT — roughly $3–4 each.
  // BTC was 0.0005 until 2026-08-26, which was a guess made before any real BTC
  // amounts existed to judge it against. Real payments to the receiving address
  // run 0.0012–0.0035 BTC ($95–$275 at ~$79k), so that ceiling was 14–38% of a
  // typical order — it would have auto-confirmed a payment $39 short and emailed
  // the buyer a thank-you. Actual BTC withdrawal fees are ~$1–15. 0.00005 is
  // about $4: comfortably above a real fee and above the ~$0.79 uniqueness tail,
  // nowhere near enough to matter if someone underpays deliberately.
  //
  // Revisit if BTC moves a long way from ~$79k, since this is a fixed BTC
  // amount standing in for a fixed dollar amount.
  //
  // Never surface these numbers to customers — a published ceiling is a discount.
  const AUTO_ACCEPT_MAX = { USDT: 3.00, BTC: 0.00005 };

  // Beyond the auto-accept ceiling but still plausibly this order: a human decides.
  const REVIEW_TOLERANCE = 0.10;

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

  // The Orders sheet stores timestamps as "2026-08-24 22:29:05" — readable, but
  // carrying no timezone. new Date() would interpret that in the PARSER's local
  // zone, and n8n runs UTC, so every expiry would land 8 hours late and late
  // payments would auto-confirm instead of going to review. A bare timestamp is
  // therefore explicitly read as Philippine time (UTC+8, no DST).
  //
  // Anything reading these timestamps outside this module must do the same.
  const MANILA_OFFSET = '+08:00';
  const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;

  function toEpochMs(value) {
    if (value === null || value === undefined || value === '') return NaN;
    if (typeof value === 'number') return value;

    const text = String(value).trim();

    const asNumber = Number(text);
    if (text !== '' && !isNaN(asNumber)) return asNumber;

    if (NAIVE_DATETIME.test(text)) {
      const withSeconds = text.length === 16 ? text + ':00' : text;
      return new Date(withSeconds.replace(' ', 'T') + MANILA_OFFSET).getTime();
    }

    return new Date(text).getTime();
  }

  // PAYMENT_SEEN means a payment for this order is already in the mempool but
  // not yet confirmed. Bitcoin can take hours to confirm, so once a payment is
  // visibly on its way the expiry clock stops — otherwise every slow Bitcoin
  // payment would land against an expired order and need manual review.
  function isOpen(order, nowMs) {
    if (order.status === 'PAYMENT_SEEN') return true;
    if (order.status !== 'AWAITING_PAYMENT') return false;
    const expires = toEpochMs(order.expiresAt);
    if (isNaN(expires)) return false;
    return expires > nowMs;
  }

  // Matchable rows are those still awaiting payment, those with a payment
  // already in flight, and those already swept to EXPIRED — late money must be
  // surfaced, never silently dropped.
  function isMatchable(order) {
    return order.status === 'AWAITING_PAYMENT' ||
           order.status === 'PAYMENT_SEEN' ||
           order.status === 'EXPIRED';
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

    // Only still-open orders with a usable expected amount can absorb a
    // difference. An expired order is never auto-accepted — expiry is checked
    // before the ceiling, so late money always surfaces for review.
    const open = all.filter(function (o) {
      return isOpen(o, nowMs) && Number(o.expectedAmount);
    });

    // Signed, received minus expected, at the coin's precision. Rounding before
    // comparing is what makes an exactly-at-the-ceiling difference land inside
    // it — raw float subtraction gives 3.0000000000000568 and would reject it.
    function diffFor(o) {
      return round(receivedAmount - Number(o.expectedAmount), coin);
    }

    // Ambiguity is never AUTO-ASSIGNED, at any band - guessing would risk
    // crediting one customer's payment to another customer's order. But it is
    // no longer discarded either: reporting a bare NONE threw away the one
    // thing worth knowing, which orders it might belong to.
    //
    // This is not a rare edge. The uniqueness tail spans at most 999 sat while
    // the ceiling is 5000, so ANY two orders for the same cart sit inside each
    // other's tolerance. Widening the tail cannot fix it: a payment is
    // ambiguous whenever two orders are within 2x the ceiling, and no tail
    // small enough to hide in a price can guarantee that gap. The only honest
    // answer is to hand the candidates to a human.
    function ambiguous(candidates) {
      return { type: 'AMBIGUOUS', order: null, difference: null, candidates: candidates };
    }

    // 2. Inside the flat ceiling: confident enough to auto-accept as PAID.
    const ceiling = AUTO_ACCEPT_MAX[coin];
    const autoBand = open.filter(function (o) {
      return Math.abs(diffFor(o)) <= ceiling;
    });
    if (autoBand.length > 1) return ambiguous(autoBand);
    if (autoBand.length === 1) {
      const difference = diffFor(autoBand[0]);
      return {
        type: difference < 0 ? 'AUTO_UNDER' : 'AUTO_OVER',
        order: autoBand[0],
        difference: difference
      };
    }

    // Outside the ceiling, but proportionally close enough to name.
    function inReviewBand(o) {
      const expected = Number(o.expectedAmount);
      return Math.abs(receivedAmount - expected) / expected <= REVIEW_TOLERANCE;
    }

    // 3. Outside the ceiling but still close enough to name: a human decides.
    //    Two orders inside the ceiling are necessarily inside this band too, so
    //    an ambiguous payment falls through to NONE rather than being attributed
    //    at lower confidence to whichever order happened to be nearest.
    const nearOpen = open.filter(inReviewBand);
    if (nearOpen.length > 1) return ambiguous(nearOpen);
    if (nearOpen.length === 1) {
      const difference = diffFor(nearOpen[0]);
      return {
        type: difference < 0 ? 'NEAR_UNDER' : 'NEAR_OVER',
        order: nearOpen[0],
        difference: difference
      };
    }

    // 4. Nothing open fits. An expired row may still be the right order.
    //    An exchange payment is BOTH late (withdrawals are batched, and
    //    Bitcoin confirmation is slow) and short (the fee comes out of the
    //    amount sent), so the two commonest properties of real money used to
    //    combine into an anonymous "no matching open order" alert while the
    //    matcher was holding the order all along. Name it instead.
    //
    //    NEVER auto-accepted: past expiry the rate may have moved, so this is
    //    always a human decision. Reported once, attached to the order.
    const expiredBand = all.filter(function (o) {
      return !isOpen(o, nowMs) && Number(o.expectedAmount) &&
             (Math.abs(diffFor(o)) <= ceiling || inReviewBand(o));
    });
    if (expiredBand.length > 1) return ambiguous(expiredBand);
    if (expiredBand.length === 0) return none;

    return {
      type: 'EXPIRED_NEAR',
      order: expiredBand[0],
      difference: diffFor(expiredBand[0])
    };
  }

  return {
    USDT_CONTRACT: USDT_CONTRACT,
    AUTO_ACCEPT_MAX: AUTO_ACCEPT_MAX,
    REVIEW_TOLERANCE: REVIEW_TOLERANCE,
    EXPIRY_MINUTES: EXPIRY_MINUTES,
    makeUniqueAmount: makeUniqueAmount,
    findMatch: findMatch,
    sameAmount: sameAmount,
    toEpochMs: toEpochMs,
    round: round
  };
});
