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
  const EXPIRY_MINUTES = 30;

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
  // Never surface this number to customers — a published ceiling is a discount.
  const AUTO_ACCEPT_MAX = { USDT: 3.00, BTC: 0.0005 };

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

    // Ambiguity is always reported as unmatched, at every band. Guessing would
    // risk crediting one customer's payment to another customer's order.
    function only(candidates) {
      return candidates.length === 1 ? candidates[0] : null;
    }

    // 2. Inside the flat ceiling: confident enough to auto-accept as PAID.
    const ceiling = AUTO_ACCEPT_MAX[coin];
    const autoHit = only(open.filter(function (o) {
      return Math.abs(diffFor(o)) <= ceiling;
    }));
    if (autoHit) {
      const difference = diffFor(autoHit);
      return {
        type: difference < 0 ? 'AUTO_UNDER' : 'AUTO_OVER',
        order: autoHit,
        difference: difference
      };
    }

    // 3. Outside the ceiling but still close enough to name: a human decides.
    //    Two orders inside the ceiling are necessarily inside this band too, so
    //    an ambiguous payment falls through to NONE rather than being attributed
    //    at lower confidence to whichever order happened to be nearest.
    const nearHit = only(open.filter(function (o) {
      const expected = Number(o.expectedAmount);
      return Math.abs(receivedAmount - expected) / expected <= REVIEW_TOLERANCE;
    }));
    if (!nearHit) return none;

    const difference = diffFor(nearHit);
    return {
      type: difference < 0 ? 'NEAR_UNDER' : 'NEAR_OVER',
      order: nearHit,
      difference: difference
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
