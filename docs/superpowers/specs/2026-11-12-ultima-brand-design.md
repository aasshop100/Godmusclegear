# Adding the Ultima brand to God Muscle Gears

**Date:** 2026-11-12
**Status:** approved by Lester, implementation in progress

## Summary

Ultima Pharmaceuticals becomes the fourth brand on godmusclegears.com, alongside
Beligas, Sixpex and Xeno. Unlike the other three it ships from an international
warehouse: delivery is 20-25 days from the tracking number rather than 4-7, it
reaches a different and restricted set of countries, and its prices sit well
below the existing retail for the same compounds.

14 products. Prices are final except Tadalafil 25mg, which is pending.

Prices below are the supplier list plus Lester's $15 per-product margin, agreed
2026-11-12. Tadalafil is excluded from the uplift until its base price lands.

## Why this is not just "another brand"

Every brand so far has been a flat tag: a `data-brand` value on a card, a
shipping rate, a filter option. Ultima breaks two site-wide assumptions:

1. **Delivery time.** Every page states "Ships to the USA, 4-7 days". Ultima is
   20-25 days. A mixed cart produces two parcels with two different speeds.
2. **Destination.** `checkout.html` offers five countries with no gating logic
   at all. Ultima cannot reach two of them (Canada, Philippines) and can reach
   seven the site has never offered.

## Catalogue

| id | Title | Price | Pack | Type |
|---|---|---|---|---|
| `ultima-enan-250` | ULTIMA ENAN 250MG | $35.00 | 10mL vial | Injectable |
| `ultima-prop-100` | ULTIMA PROP 100MG | $30.00 | 10mL vial | Injectable |
| `ultima-mix-250` | ULTIMA MIX 250MG | $37.00 | 10mL vial | Injectable |
| `ultima-deca-250` | ULTIMA DECA 250MG | $63.00 | 10mL vial | Injectable |
| `ultima-npp-100` | ULTIMA NPP 100MG | $33.00 | 10mL vial | Injectable |
| `ultima-cyp-250` | ULTIMA CYP 250MG | $34.00 | 10mL vial | Injectable |
| `ultima-bold-250` | ULTIMA BOLD 250MG | $40.00 | 10mL vial | Injectable |
| `ultima-tren-a-100` | ULTIMA TREN A 100MG | $42.00 | 10mL vial | Injectable |
| `ultima-methandienone-25` | ULTIMA Methandienone 25mg | $31.00 | 100 tabs | Oral |
| `ultima-clomiphene-50` | ULTIMA Clomiphene 50mg | $26.00 | 50 tabs | Oral |
| `ultima-clenbuterol-40` | ULTIMA Clenbuterol 40mcg | $23.00 | 50 tabs | Oral |
| `ultima-oxandrolone-10` | ULTIMA Oxandrolone 10mg | $43.00 | 100 tabs | Oral |
| `ultima-sildenafil-100` | ULTIMA Sildenafil 100mg | $35.00 | 50 tabs | Oral |
| `ultima-tadalafil-25` | ULTIMA Tadalafil 25mg | pending | 50 tabs | Oral |

Titles keep Lester's exact supplier labels, including the `ULTIMA` prefix. This
differs from Sixpex (whose `BOLDEPEX 200`-style names are already unique) because
`ENAN 250` on its own is not distinguishable from the Beligas and Xeno cards for
the same compound in a cart line or an order email.

## Shipping

`BRAND_SHIPPING` gains `Ultima: 50`. Brands still never pool, but the parcel
SIZE is no longer global: `UNITS_PER_PACKAGE` became the per-brand
`BRAND_UNITS_PER_PACKAGE` = { Beligas 10, Sixpex 10, Xeno 10, **Ultima 12** },
and each brand tiers at `ceil(qty / itsOwnSize) * rate`. An Ultima order of 11
or 12 units is ONE $50 parcel; under the old flat 10 it would have been two.

Consequence recorded deliberately: the free-shipping promo waives the single most
expensive package. With Ultima at $50 that is now always the Ultima parcel, so
the promo costs twice what it used to on any order containing Ultima.

## Country gating

New machinery. The checkout country dropdown is rebuilt from the brands present
in the cart, and submit is blocked on a mismatch.

- **Ultima ships to:** US, UK (incl. Northern Ireland), AU, CN, JP, MY, SG, FR,
  KH, TH.
- **Ultima cannot ship to:** anywhere not on that list. Explicitly named by the
  supplier as excluded: rest of EU, New Zealand, Austria, Denmark, Canada. The
  Philippines is not on the allow list and is therefore also excluded.
- **Other brands ship to:** the site's existing five - US, PH, CA, UK, AU.

The dropdown shows the **intersection** of every brand in the cart:

| Cart contents | Countries offered |
|---|---|
| No Ultima | US, PH, CA, UK, AU |
| Ultima only | US, UK, AU, CN, JP, MY, SG, FR, KH, TH |
| Ultima + any other brand | US, UK, AU |

Intersection rather than union is the safe default: a union would let someone put
a Beligas item in a Japan-bound order the warehouse cannot fulfil. The gate
inspects every brand in the cart, not just the first.

## Delivery-time copy

Ultima states **20-25 days from tracking number** everywhere the other brands
state 4-7 days: product cards, `p/` pages, cart, checkout and order emails. A
mixed cart states both, per parcel.

After the change, the whole site is grepped for the old blanket "4-7 days" and
"Ships to USA" claims, including `<meta name="description">` and the og/twitter
cards. A pricing-rule change leaving marketing copy behind has bitten this
codebase before on PeptideLab; nothing fails loudly when only the words are wrong.

## Stock

14 rows in `GODMUSCLEGEAR Sheet1` with `Brand Section` = `Ultima`. Stock is
seeded at 999 for 13 products and **0 for Tadalafil**, so Tadalafil renders Sold
Out and cannot be bought. No IMPORTRANGE formula - Ultima is not in the Beligas
INVENTORY master, so these are plain numbers edited by hand.

## Tadalafil 25mg

Built as a real card and `p/` page but with `data-price="0.00"`, stock 0, the
price rendered as "Coming Soon" instead of a figure, a disabled Add to Cart
button, and no `offers` block in its JSON-LD. A price of $0.00 must never be
visible or purchasable. Swap in the real price and stock when the supplier
confirms.

## Images

One placeholder, `images/ultima-coming-soon.jpg`, 600x600 to match the grid,
carrying the Ultima logo. All 14 cards point at it. Real photos replace it one
file at a time later.

## Files touched

- `shipping.js` + `tests/shipping.test.js` - the rate and its tests
- `script.js` - `FEATURED_CATALOG` rows, brand sort rank, country gate
- `products.html` - 14 cards, filter option, meta/title/JSON-LD
- `checkout.html` - country dropdown becomes cart-driven
- `index.html` - brand strip logo, meta/title
- `faq.html` - brand list, brand comparison, shipping times
- `product-page-template.js` - Ultima rate, delivery copy, zero-price handling
- `p/*.html` + `sitemap.xml` - regenerated by `node build-product-pages.js`
- the 15 top-level pages carrying the Brands nav dropdown
- `GODMUSCLEGEAR` Google Sheet, `Sheet1`

## Verification

`node --test tests/*.test.js` must stay green, with new Ultima cases in the
shipping suite and new cases for the country gate. The build's price-parity
check between `products.html` and `FEATURED_CATALOG` must pass. The site is then
served over HTTP on localhost - never `file://`, which loads as a `data:`
snapshot and breaks every relative path - and exercised against the live sheet
feed: cards render, filter works, cart arithmetic is right, the gate blocks
Canada on an Ultima cart, and Tadalafil is not buyable.
