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
  const taken = [512.68, 512.69, 512.70];
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
  const taken = [0.00512345, 0.00512346];
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

// ── expiresAt arriving as a date string from the Orders sheet ────────

test('an expiresAt date string in the future is treated as open, not expired', () => {
  const future = new Date(NOW + 10 * MIN).toISOString();
  const orders = [order('A', 'USDT', 512.73, { expiresAt: future })];
  assert.strictEqual(findMatch(512.73, 'USDT', orders, NOW).type, 'EXACT');
});

test('a Manila-offset expiresAt string in the future is treated as open', () => {
  const orders = [order('A', 'USDT', 512.73, { expiresAt: '2026-08-24T22:54:07+08:00' })];
  const justBefore = new Date('2026-08-24T22:24:07+08:00').getTime();
  assert.strictEqual(findMatch(512.73, 'USDT', orders, justBefore).type, 'EXACT');
});

test('a past expiresAt date string is EXPIRED_MATCH', () => {
  const past = new Date(NOW - 1).toISOString();
  const orders = [order('A', 'USDT', 512.73, { expiresAt: past })];
  assert.strictEqual(findMatch(512.73, 'USDT', orders, NOW).type, 'EXPIRED_MATCH');
});

test('an unparseable expiresAt is treated as expired rather than open', () => {
  const orders = [order('A', 'USDT', 512.73, { expiresAt: 'not a date' })];
  assert.strictEqual(findMatch(512.73, 'USDT', orders, NOW).type, 'EXPIRED_MATCH');
});
