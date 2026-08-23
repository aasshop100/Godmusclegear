const { test } = require('node:test');
const assert = require('node:assert');
const { computeShipping, resolveBrand, BRAND_SHIPPING } = require('../shipping.js');

// Helper: build a cart item
const item = (id, brand, quantity) => ({ id, brand, quantity });

test('empty cart costs nothing', () => {
  const r = computeShipping([]);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.packageCount, 0);
  assert.deepStrictEqual(r.breakdown, []);
});

test('single Beligas package is $20', () => {
  const r = computeShipping([item('a', 'Beligas', 5)]);
  assert.strictEqual(r.total, 20);
  assert.strictEqual(r.packageCount, 1);
});

test('Beligas plus Sixpex is $45 across 2 packages', () => {
  const r = computeShipping([item('a', 'Beligas', 5), item('b', 'Sixpex', 5)]);
  assert.strictEqual(r.total, 45);
  assert.strictEqual(r.packageCount, 2);
});

test('12 Beligas plus 5 Sixpex is $65 across 3 packages', () => {
  const r = computeShipping([item('a', 'Beligas', 12), item('b', 'Sixpex', 5)]);
  assert.strictEqual(r.total, 65);
  assert.strictEqual(r.packageCount, 3);
  assert.deepStrictEqual(r.breakdown, [
    { brand: 'Beligas', qty: 12, packages: 2, fee: 40 },
    { brand: 'Sixpex',  qty: 5,  packages: 1, fee: 25 },
  ]);
});

test('Sixpex and Xeno do not pool - $50 across 2 packages', () => {
  const r = computeShipping([item('a', 'Sixpex', 5), item('b', 'Xeno', 5)]);
  assert.strictEqual(r.total, 50);
  assert.strictEqual(r.packageCount, 2);
});

test('one item of each brand is $70 across 3 packages', () => {
  const r = computeShipping([item('a', 'Beligas', 1), item('b', 'Sixpex', 1), item('c', 'Xeno', 1)]);
  assert.strictEqual(r.total, 70);
  assert.strictEqual(r.packageCount, 3);
});

test('tier boundary - 20 Beligas is 2 packages, 21 is 3', () => {
  assert.strictEqual(computeShipping([item('a', 'Beligas', 20)]).total, 40);
  assert.strictEqual(computeShipping([item('a', 'Beligas', 21)]).total, 60);
});

test('quantities of the same brand pool across separate line items', () => {
  const r = computeShipping([item('a', 'Beligas', 6), item('b', 'Beligas', 6)]);
  assert.strictEqual(r.packageCount, 2);
  assert.strictEqual(r.total, 40);
});

test('breakdown is always ordered Beligas, Sixpex, Xeno', () => {
  const r = computeShipping([item('a', 'Xeno', 1), item('b', 'Sixpex', 1), item('c', 'Beligas', 1)]);
  assert.deepStrictEqual(r.breakdown.map(b => b.brand), ['Beligas', 'Sixpex', 'Xeno']);
});

test('missing quantity counts as 1', () => {
  const r = computeShipping([{ id: 'a', brand: 'Beligas' }]);
  assert.strictEqual(r.breakdown[0].qty, 1);
  assert.strictEqual(r.total, 20);
});

test('legacy item without brand is resolved from the catalog', () => {
  const catalog = [{ id: 'xeno-tamox', brand: 'Xeno' }];
  const r = computeShipping([{ id: 'xeno-tamox', quantity: 1 }], { catalog });
  assert.strictEqual(r.breakdown[0].brand, 'Xeno');
  assert.strictEqual(r.total, 25);
});

test('unknown item defaults to Beligas', () => {
  const r = computeShipping([{ id: 'mystery-item', quantity: 1 }], { catalog: [] });
  assert.strictEqual(r.breakdown[0].brand, 'Beligas');
  assert.strictEqual(r.total, 20);
});

test('an unrecognised brand string falls back to the catalog then Beligas', () => {
  assert.strictEqual(resolveBrand({ id: 'x', brand: 'NotABrand' }, []), 'Beligas');
});

test('free shipping waives the most expensive single package', () => {
  const r = computeShipping(
    [item('a', 'Beligas', 12), item('b', 'Sixpex', 5)],
    { freeShipping: true }
  );
  assert.strictEqual(r.total, 40);
  assert.strictEqual(r.waived, 25);
  assert.strictEqual(r.waivedBrand, 'Sixpex');
  assert.strictEqual(r.packageCount, 3, 'package count is unchanged by the waiver');
  assert.deepStrictEqual(r.breakdown, [
    { brand: 'Beligas', qty: 12, packages: 2, fee: 40 },
    { brand: 'Sixpex',  qty: 5,  packages: 1, fee: 0 },
  ]);
});

test('free shipping on a multi-package single brand waives only one package', () => {
  const r = computeShipping([item('a', 'Beligas', 15)], { freeShipping: true });
  assert.strictEqual(r.total, 20);
  assert.strictEqual(r.waived, 20);
  assert.strictEqual(r.breakdown[0].packages, 2, 'both packages still ship');
  assert.strictEqual(r.breakdown[0].fee, 20);
});

test('free shipping on a single package makes shipping free', () => {
  const r = computeShipping([item('a', 'Beligas', 3)], { freeShipping: true });
  assert.strictEqual(r.total, 0);
});

test('free shipping on an empty cart waives nothing', () => {
  const r = computeShipping([], { freeShipping: true });
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.waived, 0);
  assert.strictEqual(r.waivedBrand, null);
});

test('every rate matches the agreed table', () => {
  assert.deepStrictEqual(BRAND_SHIPPING, { Beligas: 20, Sixpex: 25, Xeno: 25 });
});
