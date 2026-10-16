const { test } = require('node:test');
const assert = require('node:assert');
const { parseNumbers, decideSend, SHIPPABLE } = require('../tracking-email.js');

const row = (over) => Object.assign({
  orderId: 'ORDER-1', status: 'PAID', trackingEmailed: '', packageCount: 1
}, over);

test('parseNumbers splits on newline, comma, semicolon and slash', () => {
  assert.deepStrictEqual(parseNumbers('A1\nB2, C3;D4/E5'), ['A1', 'B2', 'C3', 'D4', 'E5']);
});

test('parseNumbers trims and drops blanks', () => {
  assert.deepStrictEqual(parseNumbers('  A1 ,, \n B2 '), ['A1', 'B2']);
});

test('parseNumbers on empty input is an empty list', () => {
  assert.deepStrictEqual(parseNumbers(''), []);
  assert.deepStrictEqual(parseNumbers(undefined), []);
});

test('BANK_TRANSFER is shippable - those orders never reach PAID', () => {
  assert.ok(SHIPPABLE.includes('BANK_TRANSFER'));
  assert.ok(SHIPPABLE.includes('PAID'));
});

test('a missing row alerts, it does not send', () => {
  const d = decideSend({ row: null, trackingNumbers: ['A1'], orderId: 'ORDER-X' });
  assert.strictEqual(d.action, 'alert');
  assert.strictEqual(d.reason, 'order-not-found');
  assert.strictEqual(d.orderId, 'ORDER-X');
});

test('an EXPIRED order alerts - a number against it means the wrong tag', () => {
  const d = decideSend({ row: row({ status: 'EXPIRED' }), trackingNumbers: ['A1'] });
  assert.strictEqual(d.action, 'alert');
  assert.strictEqual(d.reason, 'not-shippable');
  assert.strictEqual(d.status, 'EXPIRED');
});

test('first number on a clean order sends, flagged as first', () => {
  const d = decideSend({ row: row(), trackingNumbers: ['A1'] });
  assert.strictEqual(d.action, 'send');
  assert.deepStrictEqual(d.newNumbers, ['A1']);
  assert.strictEqual(d.isFirst, true);
  assert.strictEqual(d.emailedAfter, 'A1');
});

test('nothing new means nothing happens', () => {
  const d = decideSend({ row: row({ trackingEmailed: 'A1' }), trackingNumbers: ['A1'] });
  assert.strictEqual(d.action, 'skip');
  assert.strictEqual(d.reason, 'no-new-numbers');
});

test('a second parcel sends only the new number and is not first', () => {
  const d = decideSend({ row: row({ trackingEmailed: 'A1', packageCount: 2 }), trackingNumbers: ['A1', 'B2'] });
  assert.strictEqual(d.action, 'send');
  assert.deepStrictEqual(d.newNumbers, ['B2']);
  assert.strictEqual(d.isFirst, false);
  assert.strictEqual(d.emailedAfter, 'A1\nB2');
});

test('a corrected number resends with no special case', () => {
  const d = decideSend({ row: row({ trackingEmailed: 'A1' }), trackingNumbers: ['A2'] });
  assert.strictEqual(d.action, 'send');
  assert.deepStrictEqual(d.newNumbers, ['A2']);
  assert.strictEqual(d.emailedAfter, 'A1\nA2');
});

test('two numbers at once go in one email', () => {
  const d = decideSend({ row: row({ packageCount: 2 }), trackingNumbers: ['A1', 'B2'] });
  assert.deepStrictEqual(d.newNumbers, ['A1', 'B2']);
  assert.strictEqual(d.isFirst, true);
});

test('packageCount defaults to 1 when the cell is blank or junk', () => {
  assert.strictEqual(decideSend({ row: row({ packageCount: '' }), trackingNumbers: ['A1'] }).packageCount, 1);
  assert.strictEqual(decideSend({ row: row({ packageCount: 'x' }), trackingNumbers: ['A1'] }).packageCount, 1);
  assert.strictEqual(decideSend({ row: row({ packageCount: '2' }), trackingNumbers: ['A1'] }).packageCount, 2);
});

test('no tracking numbers at all is a skip, never an alert', () => {
  assert.strictEqual(decideSend({ row: row(), trackingNumbers: [] }).action, 'skip');
});

test('duplicates within one input collapse', () => {
  const d = decideSend({ row: row(), trackingNumbers: ['A1', 'A1'] });
  assert.deepStrictEqual(d.newNumbers, ['A1']);
  assert.strictEqual(d.emailedAfter, 'A1');
});
