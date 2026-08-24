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

  // expiresAt arrives as epoch milliseconds in tests but as a date string from
  // the Orders sheet. Number('2026-08-24T22:24:07+08:00') is NaN, and NaN
  // comparisons are always false — which would silently mark every order
  // expired and confirm nothing. Parse both shapes.
  function toEpochMs(value) {
    if (value === null || value === undefined || value === '') return NaN;
    if (typeof value === 'number') return value;
    const asNumber = Number(value);
    if (!isNaN(asNumber)) return asNumber;
    return new Date(value).getTime();
  }

  function isOpen(order, nowMs) {
    const expires = toEpochMs(order.expiresAt);
    if (isNaN(expires)) return false;
    return order.status === 'AWAITING_PAYMENT' && expires > nowMs;
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
    toEpochMs: toEpochMs,
    round: round
  };
});
