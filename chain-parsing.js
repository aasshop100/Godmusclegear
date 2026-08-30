// chain-parsing.js — GOD MUSCLE GEARS
// Pure chain-response parsing. No DOM, no network, no storage.
// Unit-tested here, then pasted verbatim into the `Match Payments` Code node
// of `GMG - Payment Watcher` (UEIXJauCOKOhxIUh).
//
// WHY THIS FILE EXISTS (2026-08-30)
// Everything DOWNSTREAM of parsing — findMatch, the ceilings, expiry, the
// ambiguity guard — had 85 tests. The step that turns a chain API response INTO
// the `receivedAmount` those tests consume had none, and lived only inside the
// n8n Code node. The receiving Tron address has never received a transaction,
// so that parser had never met a real TRC-20 response at all.
//
// This is the same shape as the BTC-ceiling bug: the layer that was tested was
// not the layer that was wrong. The fixtures in tests/fixtures/ are REAL
// responses captured from api.trongrid.io and mempool.space, not hand-written
// approximations of what those APIs were assumed to return.
//
// Rules that must never be relaxed:
//   1. Parsing NEVER decides anything. It reports what arrived; findMatch
//      decides what it means. Keep judgement out of this file.
//   2. An amount is reported at FULL chain precision (6 dp USDT, 8 dp BTC).
//      Rounding belongs to the matcher, which rounds both sides together.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== 'undefined' ? window : null, function () {

  // USDT on TRON carries 6 decimals; `value` arrives as a STRING of micro-units
  // ("314500000" = 314.50). Number() handles the string, and a $500 order is
  // 5e8 micro-units — nowhere near the 2^53 integer limit.
  const USDT_MICRO = 1e6;
  const SATS       = 1e8;

  // TronGrid returns an OBJECT with a data array, so it arrives as ONE n8n item.
  //
  // `only_to=true` is already on the request URL, but `to` is re-checked here
  // deliberately: the guard costs nothing and a dropped query param would
  // otherwise turn every outgoing transfer into a phantom incoming payment.
  function parseTronTransfers(tronJson, usdtAddress, watchFromMs) {
    const out = [];
    if (!tronJson || !Array.isArray(tronJson.data)) return out;

    tronJson.data.forEach(function (t) {
      if (t.to !== usdtAddress) return;
      // Approve/TransferFrom events come back on this endpoint too. Anything
      // that is not a plain Transfer is not a payment.
      if (t.type && t.type !== 'Transfer') return;
      const at = Number(t.block_timestamp);
      if (!at || at < watchFromMs) return;
      out.push({
        txHash: t.transaction_id,
        coin: 'USDT',
        amount: Number(t.value) / USDT_MICRO,
        // TRC-20 transfers returned by this endpoint are already on-chain.
        confirmed: true
      });
    });

    return out;
  }

  // mempool.space returns a top-level ARRAY, which n8n splits into one item per
  // transaction — so `.first().json` is a single tx, never the array. Both
  // shapes are accepted so the function behaves the same in a test harness
  // (where it is handed the array) and inside n8n (where it is handed items).
  function normaliseBitcoinItems(items) {
    if (!Array.isArray(items)) return [];
    if (items.length === 1 && Array.isArray(items[0])) return items[0];
    return items.filter(function (t) { return t && t.txid; });
  }

  // `/address/{addr}/txs` returns every transaction TOUCHING the address —
  // outgoing spends included. Those have no output back to us, so summing only
  // our own vouts yields 0 and they are dropped.
  //
  // KNOWN EDGE, deliberately not handled: a spend that sends CHANGE back to the
  // same address would sum > 0 and be reported as an incoming payment. Checked
  // against 50 real transactions on the live address on 2026-08-30 — zero
  // occurrences, because the exchange sweeps send change elsewhere. If it ever
  // happened the worst case is one "UNMATCHED PAYMENT" Telegram, since a random
  // change amount will not sit inside any open order's tolerance.
  function parseBitcoinTxs(items, btcAddress, watchFromMs) {
    const out = [];

    normaliseBitcoinItems(items).forEach(function (tx) {
      const confirmed = !!(tx.status && tx.status.confirmed);

      // Confirmed transactions are bounded by watchFrom. Unconfirmed ones have
      // no block time at all, but a mempool transaction is by definition
      // recent, so it cannot predate the cutoff.
      if (confirmed) {
        const at = Number(tx.status.block_time) * 1000;
        if (!at || at < watchFromMs) return;
      }

      let sats = 0;
      (tx.vout || []).forEach(function (o) {
        if (o.scriptpubkey_address === btcAddress) sats += Number(o.value);
      });
      if (sats <= 0) return;

      out.push({ txHash: tx.txid, coin: 'BTC', amount: sats / SATS, confirmed: confirmed });
    });

    return out;
  }

  return {
    USDT_MICRO: USDT_MICRO,
    SATS: SATS,
    parseTronTransfers: parseTronTransfers,
    normaliseBitcoinItems: normaliseBitcoinItems,
    parseBitcoinTxs: parseBitcoinTxs
  };
});
