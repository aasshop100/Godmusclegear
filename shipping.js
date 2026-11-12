// shipping.js — GOD MUSCLE GEARS
// Pure shipping math. No DOM, no localStorage — callers pass everything in.
// Loaded in the browser before script.js; also require()-able for node --test.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== 'undefined' ? window : null, function () {

  // Ultima ships from an international warehouse, hence the higher rate and the
  // 20-25 day delivery window. It is still one parcel per brand like the rest.
  const BRAND_SHIPPING    = { Beligas: 20, Sixpex: 25, Xeno: 25, Ultima: 50 };

  // How many units fit in one parcel, PER BRAND. This was a single constant
  // until Ultima arrived: its international parcel holds 12, not 10. Anything
  // reading the old flat UNITS_PER_PACKAGE would overcharge an Ultima order of
  // 11 or 12 units by a whole $50 parcel.
  const BRAND_UNITS_PER_PACKAGE = { Beligas: 10, Sixpex: 10, Xeno: 10, Ultima: 12 };

  // Retained for callers that predate the per-brand split; it is the value for
  // the three US brands, never the one to assume for an arbitrary brand.
  const UNITS_PER_PACKAGE = 10;

  function unitsPerPackage(brand) {
    const n = BRAND_UNITS_PER_PACKAGE[brand];
    return n > 0 ? n : UNITS_PER_PACKAGE;
  }
  const BRAND_ORDER       = ['Beligas', 'Sixpex', 'Xeno', 'Ultima'];
  const DEFAULT_BRAND     = 'Beligas';

  // Delivery window per brand, stated wherever a customer is told when their
  // order arrives. The US brands ship domestically; Ultima does not.
  const BRAND_DELIVERY = {
    Beligas: '4-7 days',
    Sixpex:  '4-7 days',
    Xeno:    '4-7 days',
    Ultima:  '20-25 days from tracking number'
  };

  // Where each brand's warehouse can actually ship. The three US brands share
  // the site's original five destinations. Ultima's list comes from its
  // warehouse and deliberately excludes Canada and the Philippines; anything
  // absent from a brand's list is not shippable for that brand.
  const BRAND_COUNTRIES = {
    Beligas: ['US', 'PH', 'CA', 'UK', 'AU'],
    Sixpex:  ['US', 'PH', 'CA', 'UK', 'AU'],
    Xeno:    ['US', 'PH', 'CA', 'UK', 'AU'],
    Ultima:  ['US', 'UK', 'AU', 'CN', 'JP', 'MY', 'SG', 'FR', 'KH', 'TH']
  };

  const COUNTRY_NAMES = {
    US: 'United States',
    PH: 'Philippines',
    CA: 'Canada',
    UK: 'United Kingdom (incl. Northern Ireland)',
    AU: 'Australia',
    CN: 'China',
    JP: 'Japan',
    MY: 'Malaysia',
    SG: 'Singapore',
    FR: 'France',
    KH: 'Cambodia',
    TH: 'Thailand'
  };

  // Display order for the country dropdown. Codes outside this list sort last.
  const COUNTRY_ORDER = ['US', 'UK', 'AU', 'PH', 'CA', 'FR', 'JP', 'CN', 'SG', 'MY', 'TH', 'KH'];

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

  // Distinct brands present in a cart, in BRAND_ORDER. Empty cart -> [].
  function brandsInCart(cart, catalog) {
    const seen = {};
    (cart || []).forEach(function (item) {
      seen[resolveBrand(item, catalog)] = true;
    });
    return BRAND_ORDER.filter(function (b) { return seen[b]; });
  }

  // Countries every brand in the cart can reach — the INTERSECTION, not the
  // union. A union would offer a destination one of the parcels cannot be sent
  // to, which is exactly the order we must never take payment for.
  // An empty cart falls back to the site's original five destinations.
  function allowedCountries(cart, catalog) {
    const brands = brandsInCart(cart, catalog);
    if (!brands.length) return BRAND_COUNTRIES.Beligas.slice();

    let allowed = (BRAND_COUNTRIES[brands[0]] || []).slice();
    brands.slice(1).forEach(function (brand) {
      const list = BRAND_COUNTRIES[brand] || [];
      allowed = allowed.filter(function (code) { return list.indexOf(code) !== -1; });
    });

    const rank = function (code) {
      const i = COUNTRY_ORDER.indexOf(code);
      return i === -1 ? COUNTRY_ORDER.length : i;
    };
    return allowed.sort(function (a, b) { return rank(a) - rank(b); });
  }

  // Which brands in the cart block a given country. Empty array means the
  // country is shippable for every brand present.
  function blockingBrands(cart, country, catalog) {
    if (!country) return [];
    return brandsInCart(cart, catalog).filter(function (brand) {
      const list = BRAND_COUNTRIES[brand] || [];
      return list.indexOf(country) === -1;
    });
  }

  function canShipTo(cart, country, catalog) {
    return !!country && blockingBrands(cart, country, catalog).length === 0;
  }

  function countryName(code) {
    return COUNTRY_NAMES[code] || code;
  }

  // The delivery windows present in a cart, one entry per distinct window, so a
  // mixed order can state both speeds instead of averaging them into a lie.
  function deliveryWindows(cart, catalog) {
    const out = [];
    brandsInCart(cart, catalog).forEach(function (brand) {
      const window = BRAND_DELIVERY[brand] || BRAND_DELIVERY.Beligas;
      const existing = out.filter(function (row) { return row.window === window; })[0];
      if (existing) existing.brands.push(brand);
      else out.push({ window: window, brands: [brand] });
    });
    return out;
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
      const packages = Math.ceil(qty / unitsPerPackage(brand));
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
    BRAND_UNITS_PER_PACKAGE: BRAND_UNITS_PER_PACKAGE,
    unitsPerPackage: unitsPerPackage,
    BRAND_ORDER: BRAND_ORDER,
    BRAND_DELIVERY: BRAND_DELIVERY,
    BRAND_COUNTRIES: BRAND_COUNTRIES,
    COUNTRY_NAMES: COUNTRY_NAMES,
    COUNTRY_ORDER: COUNTRY_ORDER,
    resolveBrand: resolveBrand,
    brandsInCart: brandsInCart,
    allowedCountries: allowedCountries,
    blockingBrands: blockingBrands,
    canShipTo: canShipTo,
    countryName: countryName,
    deliveryWindows: deliveryWindows,
    computeShipping: computeShipping
  };
});
