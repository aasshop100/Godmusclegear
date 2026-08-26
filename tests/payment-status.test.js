const { test } = require('node:test');
const assert = require('node:assert');
const { statusView } = require('../payment-status.js');

// ── the mapping table ────────────────────────────────────────────────

test('AWAITING_PAYMENT not expired keeps the panel and the countdown', () => {
  const v = statusView('AWAITING_PAYMENT', { coin: 'USDT' });
  assert.strictEqual(v.tone, 'pending');
  assert.strictEqual(v.showPanel, true);
  assert.strictEqual(v.showCountdown, true);
  assert.strictEqual(v.stopPolling, false);
  assert.strictEqual(v.headline, '');
});

test('AWAITING_PAYMENT past expiry keeps the panel but stops the countdown', () => {
  const v = statusView('AWAITING_PAYMENT', { coin: 'USDT', expired: true });
  assert.strictEqual(v.tone, 'expired');
  assert.strictEqual(v.showPanel, true);
  assert.strictEqual(v.showCountdown, false);
  // Still polling: a late payment can still arrive and flip this to REVIEW.
  assert.strictEqual(v.stopPolling, false);
});

// The whole point of PAYMENT_SEEN. The watcher has already stopped the expiry
// clock server-side; a countdown still running here would show a customer whose
// money is on the network a clock ticking toward "expired".
test('PAYMENT_SEEN stops the countdown', () => {
  const v = statusView('PAYMENT_SEEN', { coin: 'BTC' });
  assert.strictEqual(v.tone, 'progress');
  assert.strictEqual(v.showCountdown, false);
  assert.strictEqual(v.showPanel, false);
  assert.strictEqual(v.stopPolling, false);
});

test('PAID is terminal and hides the payment panel', () => {
  const v = statusView('PAID', { coin: 'USDT' });
  assert.strictEqual(v.tone, 'success');
  assert.strictEqual(v.showPanel, false);
  assert.strictEqual(v.showCountdown, false);
  assert.strictEqual(v.stopPolling, true);
});

test('REVIEW is terminal and hides the payment panel', () => {
  const v = statusView('REVIEW', { coin: 'USDT' });
  assert.strictEqual(v.tone, 'attention');
  assert.strictEqual(v.showPanel, false);
  assert.strictEqual(v.stopPolling, true);
});

test('EXPIRED keeps the panel, stops the countdown, stops polling', () => {
  const v = statusView('EXPIRED', { coin: 'USDT' });
  assert.strictEqual(v.tone, 'expired');
  assert.strictEqual(v.showPanel, true);
  assert.strictEqual(v.showCountdown, false);
  assert.strictEqual(v.stopPolling, true);
});

// ── degradation: never show an error to a paying customer ────────────

test('NOT_FOUND degrades to the normal awaiting-payment view', () => {
  assert.deepStrictEqual(
    statusView('NOT_FOUND', { coin: 'USDT' }),
    statusView('AWAITING_PAYMENT', { coin: 'USDT' })
  );
});

test('an unrecognised status degrades to the normal awaiting-payment view', () => {
  assert.deepStrictEqual(
    statusView('SOMETHING_NEW', { coin: 'USDT' }),
    statusView('AWAITING_PAYMENT', { coin: 'USDT' })
  );
});

test('an empty status degrades to the normal awaiting-payment view', () => {
  assert.strictEqual(statusView('', {}).tone, 'pending');
});

test('statusView(undefined) and statusView(null) do not throw', () => {
  assert.strictEqual(statusView(undefined).tone, 'pending');
  assert.strictEqual(statusView(null).tone, 'pending');
  assert.strictEqual(statusView('PAID').tone, 'success');
});

// ── REVIEW copy ──────────────────────────────────────────────────────

test('REVIEW names the shortfall when one is supplied', () => {
  const v = statusView('REVIEW', { coin: 'USDT', shortfall: '-1.50' });
  assert.ok(v.body.includes('1.50'), v.body);
  assert.ok(v.body.includes('USDT'), v.body);
  // The sign is an internal detail; the customer sees a magnitude.
  assert.ok(!v.body.includes('-1.50'), v.body);
});

test('REVIEW reads cleanly with no shortfall and leaves no dangling bracket', () => {
  const v = statusView('REVIEW', { coin: 'USDT', shortfall: '' });
  assert.ok(!v.body.includes('('), v.body);
  assert.ok(!v.body.includes(')'), v.body);
});

test('REVIEW handles an overpayment shortfall the same way', () => {
  const v = statusView('REVIEW', { coin: 'USDT', shortfall: '+0.30' });
  assert.ok(v.body.includes('0.30'), v.body);
  assert.ok(!v.body.includes('+0.30'), v.body);
});

// The load-bearing sentence. A buyer who reads REVIEW as failure and re-sends
// creates a second unmatched payment and turns one review tap into a refund.
test('every REVIEW variant tells the customer not to send again', () => {
  const variants = [
    statusView('REVIEW', { coin: 'USDT', shortfall: '-1.50' }),
    statusView('REVIEW', { coin: 'USDT', shortfall: '+0.30' }),
    statusView('REVIEW', { coin: 'USDT', shortfall: '' }),
    statusView('REVIEW', {})
  ];
  for (const v of variants) {
    assert.ok(/don.t send again/i.test(v.body), v.body);
  }
});

// ── PAID copy ────────────────────────────────────────────────────────

// Nothing auto-ships — a human releases every order — so the confirmation must
// not promise dispatch.
test('PAID never promises shipping has happened', () => {
  const body = statusView('PAID', { coin: 'USDT' }).body.toLowerCase();
  for (const word of ['shipped', 'dispatched', 'on its way', 'on the way', 'sent your order']) {
    assert.ok(!body.includes(word), `PAID body must not contain "${word}": ${body}`);
  }
});

// A PAID order can be an auto-accepted underpayment. The customer must never
// learn that, so a shortfall passed alongside PAID must be ignored entirely.
test('PAID ignores a shortfall and never reveals the tolerance', () => {
  const withShortfall = statusView('PAID', { coin: 'USDT', shortfall: '-1.50' });
  const without = statusView('PAID', { coin: 'USDT' });
  assert.deepStrictEqual(withShortfall, without);
  assert.ok(!withShortfall.body.includes('1.50'), withShortfall.body);
});

test('no view mentions the auto-accept tolerance', () => {
  const statuses = ['AWAITING_PAYMENT', 'PAYMENT_SEEN', 'PAID', 'REVIEW', 'EXPIRED', 'NOT_FOUND'];
  for (const s of statuses) {
    const v = statusView(s, { coin: 'USDT', shortfall: '-1.50' });
    const text = (v.headline + ' ' + v.body).toLowerCase();
    for (const word of ['tolerance', 'ceiling', 'auto-accept', 'absorbed', '3.00']) {
      assert.ok(!text.includes(word), `${s} must not mention "${word}": ${text}`);
    }
  }
});

// ── shape ────────────────────────────────────────────────────────────

test('every status returns the full view shape', () => {
  const statuses = ['AWAITING_PAYMENT', 'PAYMENT_SEEN', 'PAID', 'REVIEW', 'EXPIRED', 'NOT_FOUND', ''];
  for (const s of statuses) {
    const v = statusView(s, { coin: 'USDT' });
    for (const key of ['tone', 'headline', 'body', 'showPanel', 'showCountdown', 'stopPolling']) {
      assert.ok(Object.prototype.hasOwnProperty.call(v, key), `${s} missing ${key}`);
    }
    assert.strictEqual(typeof v.showPanel, 'boolean');
    assert.strictEqual(typeof v.showCountdown, 'boolean');
    assert.strictEqual(typeof v.stopPolling, 'boolean');
  }
});
