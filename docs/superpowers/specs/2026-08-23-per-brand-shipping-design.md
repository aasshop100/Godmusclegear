# Per-Brand Shipping Fees — Design

**Date:** 2026-08-23
**Status:** Approved, not yet implemented
**Scope:** God Muscle Gears storefront (`Godmusclegear-main`)

## Problem

Shipping is currently a single flat rule — `$20 per 10 units` — applied to the whole
cart regardless of brand. In reality each brand ships as its own package from its own
source, at its own rate. A cart mixing brands produces multiple packages, and the
customer is currently undercharged for them.

## Shipping rule

```
BRAND_SHIPPING   = { Beligas: 20, Sixpex: 25, Xeno: 25 }
UNITS_PER_PACKAGE = 10

for each brand present in the cart:
    qty      = sum of item quantities for that brand
    packages = ceil(qty / UNITS_PER_PACKAGE)
    fee      = packages * BRAND_SHIPPING[brand]

shippingTotal = sum of every brand fee
packageCount  = sum of every brand package count
```

Each brand is always its own shipment. Sixpex and Xeno do **not** pool, despite
sharing a rate.

### Worked examples

| Cart | Math | Shipping | Packages |
|---|---|---|---|
| 5 Beligas | 1 x $20 | $20 | 1 |
| 5 Beligas + 5 Sixpex | $20 + $25 | $45 | 2 |
| 12 Beligas + 5 Sixpex | (2 x $20) + $25 | $65 | 3 |
| 5 Sixpex + 5 Xeno | $25 + $25 | $50 | 2 |
| 1 of each brand | $20 + $25 + $25 | $70 | 3 |
| 20 Beligas | 2 x $20 | $40 | 2 |
| 21 Beligas | 3 x $20 | $60 | 3 |

## Promo interactions

**Free-shipping codes** (hashes `ahnmnl`, `mnepfa`): waive the single most expensive
**package** fee, not the whole brand and not the whole cart. On the 12 Beligas +
5 Sixpex example the $25 Sixpex package is waived, leaving $40. This caps the
merchant's exposure at $25 rather than the full multi-brand total.

The existing user-facing message ("Shipping discounted up to $20") must be reworded
to match — it now waives up to $25.

The waiver reduces the shipping *total* only. The package still ships, so
`packageCount` and the itemized breakdown are unchanged; the waived package shows a
fee of $0.00 rather than disappearing. On a tie between equally-priced packages,
waive any one of them.

**Free-item code** (hashes `1r1u3ky`, `kot262`, `1yn2umh`): the free
Testosterone Cypionate 200mg vial is tagged **Beligas** and **counts toward the
Beligas 10-unit tier** like any other item. A customer at exactly 10 Beligas items
who applies this code will move to 2 packages ($40). This is accepted, deliberate
behaviour.

**Percentage codes** (e.g. `NEWCLIENT10`): unchanged. Percentage discounts apply to
the subtotal only, never to shipping.

## Brand resolution

Cart items do not currently carry a brand — `addToCart` stores
`{ id, name, price, quantity, image }`. Brand is resolved in three tiers:

1. **Primary** — `addToCart` reads `data-brand` from the product card and stores it
   on the cart item. Every one of the 134 product cards carries `data-brand`, so this
   covers all new carts.
2. **Fallback** — a cart already persisted in `localStorage` from before this change
   has no `brand` field. Resolve by looking `item.id` up in `FEATURED_CATALOG`
   (`script.js`), which carries a `brand` for each of its 132 entries.
3. **Default** — anything still unresolved defaults to `Beligas` and logs a console
   warning. Only `bacwater30ml` is known to fall through (it is a Beligas product
   absent from `FEATURED_CATALOG`), so the default is correct for the one known case.

## Implementation

### Single source of truth

The `ceil(qty / 10) * 20` calculation is currently duplicated at `script.js:110`
(cart), `script.js:239` (checkout) and `script.js:319` (order submission), and the
three copies have already drifted slightly. Replace all three with one function:

```js
computeShipping(cart) -> {
  total:        Number,   // shippingTotal
  packageCount: Number,
  breakdown: [ { brand, qty, packages, fee } ]   // ordered Beligas, Sixpex, Xeno
}
```

Free-shipping waiver is applied inside this function so all three callers agree.

### Display

Cart and checkout show an itemized shipping block:

```
Shipping                                   $65.00
  Beligas   12 items   2 packages           $40.00
  Sixpex     5 items   1 package            $25.00
  Ships in 3 separate packages.
```

Single-brand carts show one breakdown line, and the "ships in N separate packages"
note is suppressed when `packageCount` is 1.

Requires new markup in `cart.html` (around the `#shipping-fee` span, line 124) and
`checkout.html` (around `#checkout-shipping`, line 207).

### Order notifications

`computeShipping` output is threaded into the order payload as a formatted breakdown
string plus `packageCount`, so the merchant knows how many parcels to send.

Three notification surfaces consume it. **All three live outside this repo** and must
be edited by hand in their dashboards, exactly as with the August payment-method
change:

- customer EmailJS template `template_0ry9w0v`
- owner EmailJS template `template_8x2z86l`
- the `gmg-telegram` Cloudflare Worker message

Code changes here only send the new fields; the templates will ignore them until
updated manually.

## Testing

No test framework in this repo. Verify manually against the worked-examples table
above, plus:

- a cart persisted before the change (no `brand` on items) still prices correctly
- free-shipping code waives exactly one package, the most expensive one
- free-item code adds the vial as Beligas and moves a 10-item Beligas cart to 2 packages
- percentage code leaves shipping untouched
- cart, checkout and the order-success payload all report the same shipping total

## Out of scope

- **Free-shipping threshold.** One item of each brand costs $70 to ship on roughly
  $150 of product, which is a real cart-abandonment risk that the old flat rule
  concealed. A subtotal-based threshold would blunt it. Deliberately not designed
  here; revisit as its own decision.
- **Duplicate `data-id="sixpex-primopex25"`** on two product cards in `products.html`.
  Pre-existing, deferred by owner decision on 2026-08-23.
- **`bacwater30ml` missing from `FEATURED_CATALOG`.** Pre-existing, deferred by owner
  decision on 2026-08-23. Note that adding it to that array would also insert it into
  the homepage featured carousel, which reads the same array — so it is not a free fix.
