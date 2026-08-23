// shipping.js — GOD MUSCLE GEARS
// Pure shipping math. No DOM, no localStorage — callers pass everything in.
// Loaded in the browser before script.js; also require()-able for node --test.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== 'undefined' ? window : null, function () {

  const BRAND_SHIPPING    = { Beligas: 20, Sixpex: 25, Xeno: 25 };
  const UNITS_PER_PACKAGE = 10;
  const BRAND_ORDER       = ['Beligas', 'Sixpex', 'Xeno'];
  const DEFAULT_BRAND     = 'Beligas';

  // Resolve a cart item's brand in three tiers:
  //   1. the brand stored on the item at add-to-cart time
  //   2. a lookup by id in the product catalog (for carts saved before brands existed)
  //   3. DEFAULT_BRAND, with a warning
  function resolveBrand(item, catalog) {
    if (item && item.brand && BRAND_SHIPPING[item.brand] !== undefined) {
      return item.brand;
    }

    const list = catalog || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === (item && item.id) && BRAND_SHIPPING[list[i].brand] !== undefined) {
        return list[i].brand;
      }
    }

    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[shipping] could not resolve brand for item', item && item.id,
                   '- defaulting to', DEFAULT_BRAND);
    }
    return DEFAULT_BRAND;
  }

  function computeShipping(cart, options) {
    const opts    = options || {};
    const catalog = opts.catalog !== undefined
      ? opts.catalog
      : (typeof window !== 'undefined' && window.FEATURED_CATALOG) || [];

    // Sum quantities per brand.
    const qtyByBrand = {};
    (cart || []).forEach(function (item) {
      const brand = resolveBrand(item, catalog);
      const qty   = Number(item && item.quantity) || 1;
      qtyByBrand[brand] = (qtyByBrand[brand] || 0) + qty;
    });

    // One breakdown row per brand present, in fixed display order.
    const breakdown = [];
    let packageCount = 0;
    BRAND_ORDER.forEach(function (brand) {
      const qty = qtyByBrand[brand];
      if (!qty) return;
      const packages = Math.ceil(qty / UNITS_PER_PACKAGE);
      packageCount  += packages;
      breakdown.push({
        brand: brand,
        qty: qty,
        packages: packages,
        fee: packages * BRAND_SHIPPING[brand]
      });
    });

    // The free-shipping promo waives exactly one package: the most expensive one
    // in the order. Ties resolve to the first brand in BRAND_ORDER.
    let waived      = 0;
    let waivedBrand = null;
    if (opts.freeShipping && breakdown.length > 0) {
      let target = breakdown[0];
      breakdown.forEach(function (row) {
        if (BRAND_SHIPPING[row.brand] > BRAND_SHIPPING[target.brand]) target = row;
      });
      waived      = BRAND_SHIPPING[target.brand];
      waivedBrand = target.brand;
      target.fee -= waived;
    }

    const total = breakdown.reduce(function (sum, row) { return sum + row.fee; }, 0);

    return {
      total: total,
      packageCount: packageCount,
      waived: waived,
      waivedBrand: waivedBrand,
      breakdown: breakdown
    };
  }

  return {
    BRAND_SHIPPING: BRAND_SHIPPING,
    UNITS_PER_PACKAGE: UNITS_PER_PACKAGE,
    BRAND_ORDER: BRAND_ORDER,
    resolveBrand: resolveBrand,
    computeShipping: computeShipping
  };
});
