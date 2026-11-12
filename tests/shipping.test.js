const { test } = require('node:test');
const assert = require('node:assert');
const {
  computeShipping, resolveBrand, BRAND_SHIPPING,
  brandsInCart, allowedCountries, blockingBrands, canShipTo, deliveryWindows,
  BRAND_COUNTRIES, COUNTRY_NAMES, BRAND_UNITS_PER_PACKAGE, unitsPerPackage
} = require('../shipping.js');

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
  assert.deepStrictEqual(BRAND_SHIPPING, { Beligas: 20, Sixpex: 25, Xeno: 25, Ultima: 50 });
});

test('product-page-template UNITS_PER_PACKAGE matches shipping.js for every brand', () => {
  const tpl = require('../product-page-template.js').UNITS_PER_PACKAGE;
  assert.deepStrictEqual(Object.keys(tpl).sort(), Object.keys(BRAND_UNITS_PER_PACKAGE).sort());
  for (const brand of Object.keys(BRAND_UNITS_PER_PACKAGE)) {
    assert.strictEqual(tpl[brand], BRAND_UNITS_PER_PACKAGE[brand], `${brand} package size drifted`);
  }
});

test('product-page-template SHIPPING_RATES matches shipping.js for every brand', () => {
  const { SHIPPING_RATES } = require('../product-page-template.js');
  assert.deepStrictEqual(Object.keys(SHIPPING_RATES).sort(), Object.keys(BRAND_SHIPPING).sort());
  for (const brand of Object.keys(BRAND_SHIPPING)) {
    assert.strictEqual(SHIPPING_RATES[brand], BRAND_SHIPPING[brand], `${brand} rate drifted`);
  }
});

// ── Ultima: the international-warehouse brand ────────────────────────────────

test('Ultima ships as its own parcel at $50 per 12 units', () => {
  const r = computeShipping([item('u1', 'Ultima', 1)], { catalog: [] });
  assert.strictEqual(r.total, 50);
  assert.strictEqual(r.packageCount, 1);
});

test('Ultima tiers at 12 units, not the 10 the US brands use', () => {
  assert.strictEqual(computeShipping([item('u1', 'Ultima', 10)], { catalog: [] }).total, 50);
  assert.strictEqual(computeShipping([item('u1', 'Ultima', 12)], { catalog: [] }).total, 50);
  assert.strictEqual(computeShipping([item('u1', 'Ultima', 13)], { catalog: [] }).total, 100);
  assert.strictEqual(computeShipping([item('u1', 'Ultima', 24)], { catalog: [] }).total, 100);
  assert.strictEqual(computeShipping([item('u1', 'Ultima', 25)], { catalog: [] }).total, 150);
});

test('units 11 and 12 stay in ONE Ultima parcel — the whole point of the split', () => {
  // Under the old flat 10-per-parcel rule these cost $100. They must cost $50.
  assert.strictEqual(computeShipping([item('u1', 'Ultima', 11)], { catalog: [] }).total, 50);
  assert.strictEqual(computeShipping([item('u1', 'Ultima', 11)], { catalog: [] }).packageCount, 1);
  assert.strictEqual(computeShipping([item('u1', 'Ultima', 12)], { catalog: [] }).packageCount, 1);
});

test('the US brands still tier at 10 — Ultima did not change them', () => {
  assert.strictEqual(computeShipping([item('b1', 'Beligas', 11)], { catalog: [] }).total, 40);
  assert.strictEqual(computeShipping([item('s1', 'Sixpex', 11)], { catalog: [] }).total, 50);
  assert.strictEqual(computeShipping([item('x1', 'Xeno', 11)], { catalog: [] }).total, 50);
});

test('each brand reports its own package size', () => {
  assert.deepStrictEqual(BRAND_UNITS_PER_PACKAGE, { Beligas: 10, Sixpex: 10, Xeno: 10, Ultima: 12 });
  assert.strictEqual(unitsPerPackage('Ultima'), 12);
  assert.strictEqual(unitsPerPackage('Beligas'), 10);
  assert.strictEqual(unitsPerPackage('NoSuchBrand'), 10);
});

test('a mixed cart tiers each brand on its own package size', () => {
  // 11 Beligas = 2 parcels ($40). 11 Ultima = 1 parcel ($50).
  const r = computeShipping([item('b1', 'Beligas', 11), item('u1', 'Ultima', 11)], { catalog: [] });
  assert.strictEqual(r.total, 90);
  assert.strictEqual(r.packageCount, 3);
});

test('Ultima never pools with another brand', () => {
  const r = computeShipping([item('b1', 'Beligas', 1), item('u1', 'Ultima', 1)], { catalog: [] });
  assert.strictEqual(r.total, 70);          // 20 + 50, not a shared parcel
  assert.strictEqual(r.packageCount, 2);
  assert.deepStrictEqual(r.breakdown.map(b => b.brand), ['Beligas', 'Ultima']);
});

test('Ultima sorts last in the breakdown', () => {
  const r = computeShipping([
    item('u1', 'Ultima', 1), item('x1', 'Xeno', 1), item('b1', 'Beligas', 1), item('s1', 'Sixpex', 1)
  ], { catalog: [] });
  assert.deepStrictEqual(r.breakdown.map(b => b.brand), ['Beligas', 'Sixpex', 'Xeno', 'Ultima']);
  assert.strictEqual(r.total, 120);         // 20 + 25 + 25 + 50
});

test('free shipping waives the Ultima parcel because it is the dearest', () => {
  const r = computeShipping(
    [item('b1', 'Beligas', 1), item('u1', 'Ultima', 1)],
    { catalog: [], freeShipping: true }
  );
  assert.strictEqual(r.waivedBrand, 'Ultima');
  assert.strictEqual(r.waived, 50);
  assert.strictEqual(r.total, 20);          // only the Beligas parcel remains
});

// ── Country gating ───────────────────────────────────────────────────────────

test('Ultima cannot reach Canada or the Philippines', () => {
  assert.strictEqual(BRAND_COUNTRIES.Ultima.includes('CA'), false);
  assert.strictEqual(BRAND_COUNTRIES.Ultima.includes('PH'), false);
});

test('a cart without Ultima keeps the original five destinations', () => {
  const allowed = allowedCountries([item('b1', 'Beligas', 1)], []);
  assert.deepStrictEqual(allowed.slice().sort(), ['AU', 'CA', 'PH', 'UK', 'US']);
});

test('an Ultima-only cart offers the ten Ultima destinations', () => {
  const allowed = allowedCountries([item('u1', 'Ultima', 1)], []);
  assert.deepStrictEqual(allowed.slice().sort(), ['AU', 'CN', 'FR', 'JP', 'KH', 'MY', 'SG', 'TH', 'UK', 'US']);
});

test('a mixed cart offers only the intersection, never the union', () => {
  const allowed = allowedCountries([item('b1', 'Beligas', 1), item('u1', 'Ultima', 1)], []);
  assert.deepStrictEqual(allowed.slice().sort(), ['AU', 'UK', 'US']);
  // Japan is reachable by Ultima alone but not by Beligas, so it must not appear.
  assert.strictEqual(allowed.includes('JP'), false);
  // Canada is reachable by Beligas alone but not by Ultima, so it must not appear.
  assert.strictEqual(allowed.includes('CA'), false);
});

test('an empty cart falls back to the original five destinations', () => {
  assert.deepStrictEqual(allowedCountries([], []).slice().sort(), ['AU', 'CA', 'PH', 'UK', 'US']);
});

test('canShipTo blocks a Canada order the moment Ultima is in the cart', () => {
  const cart = [item('b1', 'Beligas', 1), item('u1', 'Ultima', 1)];
  assert.strictEqual(canShipTo(cart, 'CA', []), false);
  assert.deepStrictEqual(blockingBrands(cart, 'CA', []), ['Ultima']);
  assert.strictEqual(canShipTo([item('b1', 'Beligas', 1)], 'CA', []), true);
});

test('canShipTo refuses an empty country rather than passing it', () => {
  assert.strictEqual(canShipTo([item('u1', 'Ultima', 1)], '', []), false);
  assert.strictEqual(canShipTo([item('u1', 'Ultima', 1)], null, []), false);
});

test('blockingBrands names every brand that cannot reach the country', () => {
  const cart = [item('b1', 'Beligas', 1), item('u1', 'Ultima', 1)];
  assert.deepStrictEqual(blockingBrands(cart, 'JP', []), ['Beligas']);
  assert.deepStrictEqual(blockingBrands(cart, 'US', []), []);
});

test('brandsInCart reports distinct brands in display order', () => {
  const cart = [item('u1', 'Ultima', 1), item('b1', 'Beligas', 2), item('u2', 'Ultima', 1)];
  assert.deepStrictEqual(brandsInCart(cart, []), ['Beligas', 'Ultima']);
});

test('every country code in a brand list has a display name', () => {
  for (const [brand, codes] of Object.entries(BRAND_COUNTRIES)) {
    for (const code of codes) {
      assert.ok(COUNTRY_NAMES[code], `${brand}: ${code} has no display name`);
    }
  }
});

// ── Delivery windows ─────────────────────────────────────────────────────────

test('a mixed cart reports both delivery windows, not an average', () => {
  const windows = deliveryWindows([item('b1', 'Beligas', 1), item('u1', 'Ultima', 1)], []);
  assert.strictEqual(windows.length, 2);
  assert.deepStrictEqual(windows[0], { window: '4-7 days', brands: ['Beligas'] });
  assert.deepStrictEqual(windows[1], { window: '20-25 days from tracking number', brands: ['Ultima'] });
});

test('the three US brands collapse into one delivery window', () => {
  const windows = deliveryWindows(
    [item('b1', 'Beligas', 1), item('s1', 'Sixpex', 1), item('x1', 'Xeno', 1)], []
  );
  assert.strictEqual(windows.length, 1);
  assert.deepStrictEqual(windows[0].brands, ['Beligas', 'Sixpex', 'Xeno']);
});
