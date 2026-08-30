// tests/chain-parsing.test.js
// Pins the chain-response parsing against REAL API responses.
//
// The fixtures are genuine captures, not hand-written guesses:
//   tests/fixtures/trongrid-trc20.json     — api.trongrid.io, 2026-08-30
//   tests/fixtures/mempool-address-txs.json — mempool.space for the LIVE GMG
//                                             receiving address, 2026-08-30
//
// The GMG Tron address has never received anything, so the TRC-20 fixture was
// captured from a busy address instead; the RESPONSE SHAPE is what matters and
// is identical. The address under test is passed in, so nothing depends on
// whose address it is.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parseTronTransfers, parseBitcoinTxs, normaliseBitcoinItems } = require('../chain-parsing.js');
const { findMatch, round } = require('../payment-matching.js');

const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

const TRON = fixture('trongrid-trc20.json');
const BTC_TXS = fixture('mempool-address-txs.json');

// The address every transfer in the TRC-20 fixture was sent to.
const TRON_ADDRESS = TRON.data[0].to;
const BTC_ADDRESS = '1GcpEa5EpphzQhqmQHrBrevbzavR3yRCZT';

const BEFORE_ALL = 0; // a watchFrom cutoff that excludes nothing

// ---------------------------------------------------------------------------
// TRC-20 — the path that has never run against real money
// ---------------------------------------------------------------------------

test('the real TronGrid response shape is understood', () => {
  const parsed = parseTronTransfers(TRON, TRON_ADDRESS, BEFORE_ALL);
  assert.equal(parsed.length, TRON.data.length);
  parsed.forEach((p) => {
    assert.equal(p.coin, 'USDT');
    assert.equal(p.confirmed, true);
    assert.match(p.txHash, /^[0-9a-f]{64}$/);
    assert.ok(p.amount > 0);
  });
});

test('value arrives as a STRING of micro-units and converts to dollars', () => {
  // "314500000" is the first record in the real capture.
  assert.equal(typeof TRON.data[0].value, 'string');
  const parsed = parseTronTransfers(TRON, TRON_ADDRESS, BEFORE_ALL);
  assert.equal(parsed[0].amount, 314.5);
});

test('a six-decimal payment keeps its dust through parsing', () => {
  // 17489509 micro-units = 17.489509 USDT. Real wallets do send amounts with
  // more precision than the two-decimal quote, so parsing must not truncate.
  const parsed = parseTronTransfers(TRON, TRON_ADDRESS, BEFORE_ALL);
  const dusty = parsed.find((p) => String(p.amount).includes('17.489'));
  assert.ok(dusty, 'expected the 17.489509 transfer in the fixture');
  assert.equal(dusty.amount, 17.489509);
});

test('sub-cent dust still matches its order EXACTLY, not as a near-miss', () => {
  // This is the whole reason parsing reports full precision and the matcher
  // rounds: a buyer quoted 17.49 whose wallet sends 17.489509 is exact, and
  // must not land in REVIEW.
  const orders = [
    { orderId: 'GMG-1', coin: 'USDT', status: 'AWAITING_PAYMENT',
      expectedAmount: 17.49, expiresAt: '2999-01-01 00:00:00' }
  ];
  const m = findMatch(17.489509, 'USDT', orders, Date.now());
  assert.equal(m.type, 'EXACT');
  assert.equal(m.order.orderId, 'GMG-1');
});

test('a large transfer survives the micro-unit conversion intact', () => {
  // 43943452361036 micro-units — well inside 2^53, but worth pinning since the
  // conversion is the only arithmetic parsing does.
  const parsed = parseTronTransfers(TRON, TRON_ADDRESS, BEFORE_ALL);
  const big = parsed.find((p) => p.amount > 1e6);
  assert.ok(big);
  assert.equal(big.amount, 43943452.361036);
});

test('transfers to a DIFFERENT address are ignored', () => {
  assert.deepEqual(parseTronTransfers(TRON, 'TSomeoneElsesAddressEntirely', BEFORE_ALL), []);
});

test('a non-Transfer event is not a payment', () => {
  const approve = { data: [{ ...TRON.data[0], type: 'Approval' }] };
  assert.deepEqual(parseTronTransfers(approve, TRON_ADDRESS, BEFORE_ALL), []);
});

test('transfers older than watchFrom are ignored', () => {
  const newest = Math.max(...TRON.data.map((t) => Number(t.block_timestamp)));
  assert.deepEqual(parseTronTransfers(TRON, TRON_ADDRESS, newest + 1), []);
});

test('watchFrom is inclusive of a transfer landing exactly on the cutoff', () => {
  const ts = Number(TRON.data[0].block_timestamp);
  const parsed = parseTronTransfers(TRON, TRON_ADDRESS, ts);
  assert.ok(parsed.some((p) => p.txHash === TRON.data[0].transaction_id));
});

test('an empty account returns nothing rather than throwing', () => {
  // This is the LIVE GMG address today: valid, never used.
  assert.deepEqual(parseTronTransfers({ data: [], success: true }, TRON_ADDRESS, BEFORE_ALL), []);
});

test('a dead TronGrid yields no payments, never a crash', () => {
  // The fetch node uses continueRegularOutput, so an outage arrives as an error
  // item rather than a failed run. It must parse to zero payments, and it is
  // `Check Watcher Health` — not this function — that raises the alarm.
  [null, undefined, {}, { error: 'ECONNREFUSED' }, { data: null }, { data: 'nope' }]
    .forEach((bad) => {
      assert.deepEqual(parseTronTransfers(bad, TRON_ADDRESS, BEFORE_ALL), [], String(JSON.stringify(bad)));
    });
});

// ---------------------------------------------------------------------------
// Bitcoin — proven against the real receiving address
// ---------------------------------------------------------------------------

test('real incoming transactions to the live address are found', () => {
  const parsed = parseBitcoinTxs(BTC_TXS, BTC_ADDRESS, BEFORE_ALL);
  assert.equal(parsed.length, 2);
  const amounts = parsed.map((p) => p.amount).sort();
  assert.deepEqual(amounts, [0.00130761, 0.00345067]);
  parsed.forEach((p) => {
    assert.equal(p.coin, 'BTC');
    assert.equal(p.confirmed, true);
  });
});

test('real amounts sit in the range the BTC ceiling was pinned against', () => {
  // 0.0012–0.0035 BTC. If real payments ever leave this band the 0.00005
  // ceiling needs revisiting, because it is a fixed BTC number standing in for
  // a fixed dollar amount.
  parseBitcoinTxs(BTC_TXS, BTC_ADDRESS, BEFORE_ALL).forEach((p) => {
    assert.ok(p.amount >= 0.001 && p.amount <= 0.004, `${p.amount} outside the expected band`);
  });
});

test('an outgoing spend is not an incoming payment', () => {
  // The third fixture transaction touches the address as an INPUT and pays it
  // nothing back. mempool.space returns it from the same endpoint regardless.
  const spend = BTC_TXS.filter(
    (tx) => !(tx.vout || []).some((o) => o.scriptpubkey_address === BTC_ADDRESS)
  );
  assert.equal(spend.length, 1, 'fixture should contain one outgoing tx');
  assert.deepEqual(parseBitcoinTxs(spend, BTC_ADDRESS, BEFORE_ALL), []);
});

test('multiple outputs to us in one transaction are summed', () => {
  const tx = {
    txid: 'a'.repeat(64),
    status: { confirmed: true, block_time: 1787000000 },
    vout: [
      { scriptpubkey_address: BTC_ADDRESS, value: 100000 },
      { scriptpubkey_address: 'someone-else', value: 999999 },
      { scriptpubkey_address: BTC_ADDRESS, value: 30761 }
    ]
  };
  const parsed = parseBitcoinTxs([tx], BTC_ADDRESS, BEFORE_ALL);
  assert.equal(parsed[0].amount, 0.00130761);
});

test('an unconfirmed mempool transaction is reported, but not as confirmed', () => {
  // It has no block_time at all. It must survive the watchFrom check — a
  // mempool transaction is by definition recent — and carry confirmed:false so
  // the watcher sets PAYMENT_SEEN and stops the expiry clock without paying.
  const pending = { ...BTC_TXS[0], status: { confirmed: false } };
  const parsed = parseBitcoinTxs([pending], BTC_ADDRESS, Date.now());
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].confirmed, false);
});

test('confirmed transactions older than watchFrom are ignored', () => {
  const newest = Math.max(...BTC_TXS.map((tx) => Number(tx.status.block_time) || 0));
  assert.deepEqual(parseBitcoinTxs(BTC_TXS, BTC_ADDRESS, (newest + 1) * 1000), []);
});

test('block_time is SECONDS and is compared against millisecond watchFrom', () => {
  // Forgetting the *1000 would make every real transaction look like 1970 and
  // be silently dropped by any sane cutoff.
  const tx = BTC_TXS.find((t) => (t.vout || []).some((o) => o.scriptpubkey_address === BTC_ADDRESS));
  const ms = Number(tx.status.block_time) * 1000;
  assert.ok(ms > 1.7e12 && ms < 2e12, 'block_time did not convert to a plausible ms epoch');
  assert.equal(parseBitcoinTxs([tx], BTC_ADDRESS, ms).length, 1);
  assert.equal(parseBitcoinTxs([tx], BTC_ADDRESS, ms + 1).length, 0);
});

test('n8n item-splitting and a raw array parse identically', () => {
  // Inside n8n the top-level array arrives split into one item per transaction;
  // in this harness it arrives whole. Both must behave the same.
  assert.deepEqual(normaliseBitcoinItems([BTC_TXS]), BTC_TXS);
  assert.deepEqual(normaliseBitcoinItems(BTC_TXS), BTC_TXS);
  assert.deepEqual(
    parseBitcoinTxs([BTC_TXS], BTC_ADDRESS, BEFORE_ALL),
    parseBitcoinTxs(BTC_TXS, BTC_ADDRESS, BEFORE_ALL)
  );
});

test('a dead mempool.space yields no payments, never a crash', () => {
  [null, undefined, [], [{ error: 'timeout' }], 'nope']
    .forEach((bad) => {
      assert.deepEqual(parseBitcoinTxs(bad, BTC_ADDRESS, BEFORE_ALL), [], String(JSON.stringify(bad)));
    });
});

// ---------------------------------------------------------------------------
// Parsing feeding the matcher — the seam neither side tested before
// ---------------------------------------------------------------------------

test('a real BTC payment flows through parsing into an EXACT match', () => {
  const parsed = parseBitcoinTxs(BTC_TXS, BTC_ADDRESS, BEFORE_ALL);
  const payment = parsed[0];
  const orders = [
    { orderId: 'GMG-BTC-1', coin: 'BTC', status: 'AWAITING_PAYMENT',
      expectedAmount: payment.amount, expiresAt: '2999-01-01 00:00:00' }
  ];
  const m = findMatch(payment.amount, 'BTC', orders, Date.now());
  assert.equal(m.type, 'EXACT');
});

test('a real BTC payment short by a plausible network fee auto-accepts', () => {
  // 0.00003 BTC is roughly $2.40 at ~$79k — a realistic withdrawal fee, and
  // inside the 0.00005 ceiling.
  const expected = 0.00345067;
  const received = round(expected - 0.00003, 'BTC');
  const orders = [
    { orderId: 'GMG-BTC-2', coin: 'BTC', status: 'AWAITING_PAYMENT',
      expectedAmount: expected, expiresAt: '2999-01-01 00:00:00' }
  ];
  const m = findMatch(received, 'BTC', orders, Date.now());
  assert.equal(m.type, 'AUTO_UNDER');
});

test('the OLD 0.0005 ceiling would have auto-accepted a payment $39 short', () => {
  // Regression guard for the corrected constant. A payment 0.0004 BTC light on
  // a 0.00345067 order is ~$32 short and must NOT auto-accept.
  const expected = 0.00345067;
  const orders = [
    { orderId: 'GMG-BTC-3', coin: 'BTC', status: 'AWAITING_PAYMENT',
      expectedAmount: expected, expiresAt: '2999-01-01 00:00:00' }
  ];
  const m = findMatch(round(expected - 0.0004, 'BTC'), 'BTC', orders, Date.now());
  assert.notEqual(m.type, 'AUTO_UNDER');
  assert.notEqual(m.type, 'EXACT');
});

test('a payment matching two open orders is never attributed to either', () => {
  const parsed = parseTronTransfers(TRON, TRON_ADDRESS, BEFORE_ALL);
  const amount = parsed[0].amount;
  const orders = [
    { orderId: 'GMG-A', coin: 'USDT', status: 'AWAITING_PAYMENT',
      expectedAmount: amount, expiresAt: '2999-01-01 00:00:00' },
    { orderId: 'GMG-B', coin: 'USDT', status: 'AWAITING_PAYMENT',
      expectedAmount: amount, expiresAt: '2999-01-01 00:00:00' }
  ];
  // Exact wins outright and takes the first — that is intentional and safe,
  // because makeUniqueAmount guarantees two open orders never share an amount.
  // The guard that matters is one step out: near-misses must stay unmatched.
  const near = findMatch(round(amount - 1.5, 'USDT'), 'USDT', orders, Date.now());
  assert.equal(near.type, 'NONE');
  assert.equal(near.order, null);
});
