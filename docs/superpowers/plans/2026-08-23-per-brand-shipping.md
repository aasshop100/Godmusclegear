# Per-Brand Shipping Fees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charge shipping per brand in the cart — Beligas $20 and Sixpex/Xeno $25, each billed per 10 units — instead of one flat $20-per-10-units rule for the whole cart.

**Architecture:** Extract the shipping calculation into a new dependency-free file `shipping.js` that exposes one pure function, `computeShipping(cart, options)`. It works in both the browser (attached to `window`) and Node (via `module.exports`), so it can be unit-tested with `node --test` even though this project has no build step. The three duplicated copies of the old formula in `script.js` are all replaced by calls to that one function. Brand reaches the calculation by being written onto each cart item at add-to-cart time, with a lookup fallback for carts already sitting in customers' `localStorage`.

**Tech Stack:** Vanilla ES5-compatible JavaScript, no framework, no bundler. Bootstrap 5 utility classes for markup. `node --test` (built into Node v24) for unit tests. Static site deployed by pushing to GitHub Pages.

## Global Constraints

- Rates are exactly: `Beligas: 20`, `Sixpex: 25`, `Xeno: 25`. `UNITS_PER_PACKAGE = 10`.
- Brand keys are the exact strings `Beligas`, `Sixpex`, `Xeno` — matching the `data-brand` attribute values already in `products.html`. Never lowercase them for comparison against `BRAND_SHIPPING`.
- Brands never pool. Sixpex and Xeno ship separately despite sharing a rate.
- Per-brand fee is `Math.ceil(brandQty / 10) * BRAND_SHIPPING[brand]`.
- Percentage promo codes apply to the subtotal only, never to shipping. This is existing behaviour and must not change.
- The free-shipping promo waives exactly one package — the most expensive single package in the order. It reduces the shipping total only; `packageCount` and the number of breakdown rows do not change.
- The free Testosterone Cypionate 200mg promo vial is brand `Beligas` and counts toward the Beligas 10-unit tier like any other item.
- Unresolvable brands default to `Beligas` and emit a `console.warn`.
- Breakdown rows are always ordered Beligas, then Sixpex, then Xeno, regardless of cart order.
- There is no build step. Any new `.js` file must be added to the pages with a plain `<script src="...">` tag, loaded **before** `script.js`.
- **Line numbers in this plan are as of the unmodified files.** Earlier tasks insert lines, so later numbers drift. Always locate the target by the quoted code block, not by the line number.
- Do not fix the duplicate `data-id="sixpex-primopex25"` in `products.html`, and do not add `bacwater30ml` to `FEATURED_CATALOG`. Both are deliberately deferred (see the spec's Out of Scope section).

**Before starting:** the repo is on `main`. Create a working branch first:

```bash
git checkout -b per-brand-shipping
```

**Reference spec:** `docs/superpowers/specs/2026-08-23-per-brand-shipping-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `shipping.js` | Create | Pure shipping math. `BRAND_SHIPPING`, `UNITS_PER_PACKAGE`, `resolveBrand`, `computeShipping`. No DOM, no `localStorage`. |
| `tests/shipping.test.js` | Create | `node --test` unit tests for `shipping.js`. |
| `script.js` | Modify | Store brand on cart items; expose `FEATURED_CATALOG`; call `computeShipping` in the three places that used the old formula; render the breakdown. |
| `cart.html` | Modify | Add breakdown container under the shipping row; load `shipping.js`. |
| `checkout.html` | Modify | Add breakdown container under the shipping row; load `shipping.js`. |
| `blog.html`, `contact.html`, `faq.html`, `index.html`, `peptide-calculator.html`, `policies.html`, `products.html`, `proofs.html` | Modify | Load `shipping.js` before `script.js` so no page can break if a shipping call is added later. |

`shipping.js` is deliberately DOM-free and storage-free: every caller reads `localStorage` itself and passes the result in. That is what makes it unit-testable without a browser.

---

### Task 1: Pure shipping calculation module

**Files:**
- Create: `shipping.js`
- Test: `tests/shipping.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `BRAND_SHIPPING` — `{ Beligas: 20, Sixpex: 25, Xeno: 25 }`
  - `UNITS_PER_PACKAGE` — `10`
  - `BRAND_ORDER` — `['Beligas', 'Sixpex', 'Xeno']`
  - `resolveBrand(item, catalog)` → `string` (one of the three brand keys)
  - `computeShipping(cart, options)` → `{ total: Number, packageCount: Number, waived: Number, waivedBrand: String|null, breakdown: Array<{ brand: String, qty: Number, packages: Number, fee: Number }> }`
    - `cart` — array of `{ id, brand?, quantity? }`
    - `options` — `{ freeShipping?: Boolean, catalog?: Array<{id, brand}> }`
    - `breakdown[].fee` is **net** — the waiver is already subtracted from the affected brand's row. `total` equals the sum of `breakdown[].fee`.

- [ ] **Step 1: Write the failing test**

Create `tests/shipping.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/shipping.test.js
```

Expected: FAIL — `Cannot find module '../shipping.js'`.

- [ ] **Step 3: Write the implementation**

Create `shipping.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/shipping.test.js
```

Expected: PASS — 18 passing tests, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add shipping.js tests/shipping.test.js && git commit -F- <<'MSG'
Add per-brand shipping calculation module with unit tests

Pure computeShipping() supporting Beligas $20 / Sixpex $25 / Xeno $25
billed per 10 units per brand, with three-tier brand resolution and
single-package free-shipping waiver.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: Thread brand onto cart items and load the module

**Files:**
- Modify: `script.js` — `addToCart` (around line 139), end of the `FEATURED_CATALOG` IIFE (around line 651), `freeItem` object (around line 855)
- Modify: the `<script src="script.js">` line in all 10 pages that load it — `blog.html`, `cart.html`, `checkout.html`, `contact.html`, `faq.html`, `index.html`, `peptide-calculator.html`, `policies.html`, `products.html`, `proofs.html`
- Test: `tests/shipping.test.js` (existing, must still pass)

**Interfaces:**
- Consumes: `computeShipping`, `resolveBrand` from Task 1.
- Produces:
  - Cart items now carry a `brand` property: `{ id, name, price, quantity, image, brand }`
  - `window.FEATURED_CATALOG` — the product catalog array, readable by `shipping.js`

- [ ] **Step 1: Add the script tag to every page that loads script.js**

There are 10 such pages. Insert `shipping.js` immediately before `script.js` in all of them:

```bash
sed -i 's|<script src="script.js"></script>|<script src="shipping.js"></script>\n<script src="script.js"></script>|' blog.html cart.html checkout.html contact.html faq.html index.html peptide-calculator.html policies.html products.html proofs.html
```

- [ ] **Step 2: Verify all 10 pages were updated and the order is correct**

```bash
grep -c 'src="shipping.js"' blog.html cart.html checkout.html contact.html faq.html index.html peptide-calculator.html policies.html products.html proofs.html
```

Expected: every file reports `1`.

```bash
grep -A1 'src="shipping.js"' cart.html
```

Expected: the `shipping.js` line is immediately followed by the `script.js` line.

- [ ] **Step 3: Expose the catalog so shipping.js can read it**

`FEATURED_CATALOG` is a top-level `const` in a classic script, so it is **not** on `window` and `shipping.js` cannot see it without this. In `script.js`, find the end of the `FEATURED_CATALOG` IIFE:

```js
  return raw.map(([id, cartName, price, image, brand, type]) => ({
    id, cartName,
    name: cartName.replace(/ \([^)]+\)$/, ''),
    price, image, brand, type
  }));
})();
```

Add this line immediately after the closing `})();`:

```js
// Exposed so shipping.js can resolve brands for carts saved before items carried a brand.
window.FEATURED_CATALOG = FEATURED_CATALOG;
```

- [ ] **Step 4: Store the brand when an item is added to the cart**

In `script.js`, replace the opening of `addToCart`:

```js
function addToCart(button) {
  const name  = button.dataset.name  || 'Unknown Item';
  const price = Number(button.dataset.price) || 0;
  const id    = button.dataset.id    || name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const image = button.dataset.image || 'images/default-supplement.png';

  const existingItem = cart.find(item => item.id === id);
  if (existingItem) {
    existingItem.quantity = (existingItem.quantity || 1) + 1;
  } else {
    cart.push({ id, name, price, quantity: 1, image });
  }
```

with:

```js
function addToCart(button) {
  const name  = button.dataset.name  || 'Unknown Item';
  const price = Number(button.dataset.price) || 0;
  const id    = button.dataset.id    || name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const image = button.dataset.image || 'images/default-supplement.png';

  // Brand lives on the product card, not the button — each brand ships separately,
  // so the cart has to remember which one this item came from.
  const card  = button.closest('[data-brand]');
  const brand = (card && card.getAttribute('data-brand')) || '';

  const existingItem = cart.find(item => item.id === id);
  if (existingItem) {
    existingItem.quantity = (existingItem.quantity || 1) + 1;
    if (!existingItem.brand && brand) existingItem.brand = brand;
  } else {
    cart.push({ id, name, price, quantity: 1, image, brand });
  }
```

- [ ] **Step 5: Tag the free promo vial as Beligas**

In `script.js`, inside `initPromoCode`, replace the `freeItem` object:

```js
  const freeItem = {
    id: 'free-testc200mg',
    name: 'Testosterone Cypionate, 200mg (1 vial)',
    price: 0.00,
    image: 'images/testc200mg.png',
    quantity: 1
  };
```

with:

```js
  const freeItem = {
    id: 'free-testc200mg',
    name: 'Testosterone Cypionate, 200mg (1 vial)',
    price: 0.00,
    image: 'images/testc200mg.png',
    quantity: 1,
    brand: 'Beligas'
  };
```

- [ ] **Step 6: Verify the unit tests still pass and nothing has a syntax error**

```bash
node --test tests/shipping.test.js && node --check script.js && node --check shipping.js
```

Expected: 18 passing tests, then no output from either `--check` (silence means valid syntax).

- [ ] **Step 7: Commit**

```bash
git add script.js blog.html cart.html checkout.html contact.html faq.html index.html peptide-calculator.html policies.html products.html proofs.html && git commit -F- <<'MSG'
Store product brand on cart items and load shipping module

Cart items now carry the brand read from the product card's data-brand,
the free promo vial is tagged Beligas, and FEATURED_CATALOG is exposed so
legacy carts without a brand can still be resolved by id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: Shared breakdown renderer and cart page display

**Files:**
- Modify: `cart.html` — the shipping row (around lines 122-125)
- Modify: `script.js` — new `renderShippingBreakdown` helper above `updateCart`, and the shipping calc inside `updateCart` (around lines 109-113)

**Interfaces:**
- Consumes: `computeShipping` from Task 1; cart items carrying `brand` from Task 2.
- Produces: `renderShippingBreakdown(containerEl, result)` — writes the per-brand lines and the multi-package note into `containerEl`. Takes `null` as `result` to clear it. Reused unchanged by Task 4.

- [ ] **Step 1: Add the breakdown container to cart.html**

In `cart.html`, replace:

```html
            <div class="d-flex justify-content-between mb-3" style="font-size:0.9rem;">
              <span style="color:var(--grey);">Shipping Fee</span>
              <span id="shipping-fee" style="font-weight:600;">$20.00</span>
            </div>
```

with:

```html
            <div class="mb-3" style="font-size:0.9rem;">
              <div class="d-flex justify-content-between">
                <span style="color:var(--grey);">Shipping Fee</span>
                <span id="shipping-fee" style="font-weight:600;">$0.00</span>
              </div>
              <div id="shipping-breakdown"></div>
            </div>
```

Note the hardcoded `$20.00` placeholder becomes `$0.00` — with per-brand rates there is no longer a single correct default to show before the cart loads.

- [ ] **Step 2: Add the shared renderer to script.js**

In `script.js`, add this function immediately above `function updateCart() {`:

```js
// Renders the per-brand shipping lines beneath a shipping total.
// Shared by the cart page and the checkout page. Pass null to clear.
function renderShippingBreakdown(containerEl, result) {
  if (!containerEl) return;

  if (!result || result.breakdown.length === 0) {
    containerEl.innerHTML = '';
    return;
  }

  const rows = result.breakdown.map(row => {
    const pkgLabel  = row.packages === 1 ? '1 package' : `${row.packages} packages`;
    const itemLabel = row.qty === 1 ? '1 item' : `${row.qty} items`;
    return `
      <div class="d-flex justify-content-between" style="font-size:0.78rem;color:var(--grey);margin-top:4px;">
        <span>${row.brand} · ${itemLabel} · ${pkgLabel}</span>
        <span>$${row.fee.toFixed(2)}</span>
      </div>`;
  }).join('');

  const note = result.packageCount > 1
    ? `<div style="font-size:0.72rem;color:var(--grey);margin-top:6px;font-style:italic;">
         Ships in ${result.packageCount} separate packages — each brand ships on its own.
       </div>`
    : '';

  containerEl.innerHTML = rows + note;
}
```

- [ ] **Step 3: Replace the old formula inside updateCart**

In `script.js`, inside `updateCart`, replace:

```js
  // Apply free shipping promo if active
  let shipping = Math.ceil(totalQuantity / 10) * BASE_SHIPPING_PER_10;
  if (localStorage.getItem('freeShipping') === 'true') {
    shipping = Math.max(0, shipping - Math.min(20, shipping));
  }
```

with:

```js
  // Shipping is billed per brand — each brand ships as its own package.
  const shippingResult = computeShipping(cart, {
    freeShipping: localStorage.getItem('freeShipping') === 'true'
  });
  const shipping = shippingResult.total;
```

`totalQuantity` is still used elsewhere in this function, so leave its accumulation alone.

- [ ] **Step 4: Render the breakdown**

Still inside `updateCart`, find:

```js
  if (shippingEl)   shippingEl.textContent   = `$${shipping.toFixed(2)}`;
```

and add the render call immediately after it:

```js
  if (shippingEl)   shippingEl.textContent   = `$${shipping.toFixed(2)}`;
  renderShippingBreakdown(document.getElementById('shipping-breakdown'), shippingResult);
```

- [ ] **Step 5: Clear the breakdown when the cart empties**

Still inside `updateCart`, the empty-cart early return would otherwise leave stale rows on screen. Replace:

```js
  if (cart.length === 0) {
    if (emptyMsg)      emptyMsg.style.display = 'block';
    if (subtotalEl)    subtotalEl.textContent = '$0.00';
    if (shippingEl)    shippingEl.textContent = '$0.00';
    if (grandTotalEl)  grandTotalEl.textContent = '$0.00';
    updateCheckoutButton();
    return;
  }
```

with:

```js
  if (cart.length === 0) {
    if (emptyMsg)      emptyMsg.style.display = 'block';
    if (subtotalEl)    subtotalEl.textContent = '$0.00';
    if (shippingEl)    shippingEl.textContent = '$0.00';
    if (grandTotalEl)  grandTotalEl.textContent = '$0.00';
    renderShippingBreakdown(document.getElementById('shipping-breakdown'), null);
    updateCheckoutButton();
    return;
  }
```

- [ ] **Step 6: Verify syntax and tests**

```bash
node --check script.js && node --test tests/shipping.test.js
```

Expected: no output from `--check`, then 18 passing tests.

- [ ] **Step 7: Verify in the browser**

Open `cart.html`. In the browser console, seed a mixed cart and reload:

```js
localStorage.setItem('cart', JSON.stringify([
  { id: 'testc250mg', name: 'Test Cyp 250mg', price: 63.84, quantity: 12, image: '', brand: 'Beligas' },
  { id: 'sixpex-test-e', name: 'Sixpex Test E', price: 60.00, quantity: 5, image: '', brand: 'Sixpex' }
]));
location.reload();
```

Expected on screen:

```
Shipping Fee                              $65.00
  Beligas · 12 items · 2 packages          $40.00
  Sixpex · 5 items · 1 package             $25.00
  Ships in 3 separate packages — each brand ships on its own.
```

- [ ] **Step 8: Commit**

```bash
git add script.js cart.html && git commit -F- <<'MSG'
Show itemized per-brand shipping on the cart page

Replaces the flat per-10-units formula in updateCart with computeShipping
and adds a shared renderShippingBreakdown helper that lists each brand's
items, package count and fee.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: Checkout page display

**Files:**
- Modify: `checkout.html` — the shipping row (around lines 205-208)
- Modify: `script.js` — the shipping calc inside `renderCheckoutSummary` (around lines 239-242)

**Interfaces:**
- Consumes: `computeShipping` from Task 1, `renderShippingBreakdown` from Task 3.
- Produces: nothing new.

- [ ] **Step 1: Add the breakdown container to checkout.html**

In `checkout.html`, replace:

```html
              <div class="d-flex justify-content-between mb-3" style="font-size:0.875rem;">
                <span style="color:var(--grey);">Shipping</span>
                <span style="font-weight:600;">$<span id="checkout-shipping">0.00</span></span>
              </div>
```

with:

```html
              <div class="mb-3" style="font-size:0.875rem;">
                <div class="d-flex justify-content-between">
                  <span style="color:var(--grey);">Shipping</span>
                  <span style="font-weight:600;">$<span id="checkout-shipping">0.00</span></span>
                </div>
                <div id="checkout-shipping-breakdown"></div>
              </div>
```

- [ ] **Step 2: Replace the old formula inside renderCheckoutSummary**

In `script.js`, inside `renderCheckoutSummary`, replace:

```js
  let shipping = Math.ceil(totalQuantity / 10) * BASE_SHIPPING_PER_10;
  if (localStorage.getItem('freeShipping') === 'true') {
    shipping = Math.max(0, shipping - Math.min(20, shipping));
  }
```

with:

```js
  const shippingResult = computeShipping(storedCart, {
    freeShipping: localStorage.getItem('freeShipping') === 'true'
  });
  const shipping = shippingResult.total;
```

`totalQuantity` is still displayed as the item count on this page, so leave its accumulation alone.

- [ ] **Step 3: Render the breakdown**

Still inside `renderCheckoutSummary`, find:

```js
  if (shippingEl)    shippingEl.textContent    = shipping.toFixed(2);
```

and add the render call immediately after it:

```js
  if (shippingEl)    shippingEl.textContent    = shipping.toFixed(2);
  renderShippingBreakdown(document.getElementById('checkout-shipping-breakdown'), shippingResult);
```

- [ ] **Step 4: Verify syntax**

```bash
node --check script.js
```

Expected: no output.

- [ ] **Step 5: Verify in the browser**

With the same mixed cart seeded from Task 3 Step 7, open `checkout.html`.

Expected: the Shipping line reads `$65.00` with the same two brand rows and the 3-package note beneath it, and the Total equals subtotal + $65.00. It must match the cart page exactly.

- [ ] **Step 6: Commit**

```bash
git add script.js checkout.html && git commit -F- <<'MSG'
Show itemized per-brand shipping on the checkout page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: Order submission and notification payloads

**Files:**
- Modify: `script.js` — order shipping calc (around lines 317-323), `sendTelegramNotification` (around lines 265-271), both EmailJS payloads (around lines 351-383), the Telegram call site (around line 390), and the `BASE_SHIPPING_PER_10` declaration (line 8)

**Interfaces:**
- Consumes: `computeShipping` from Task 1.
- Produces: two new fields on every order notification —
  - `shipping_breakdown` — a plain-text string, e.g. `Beligas: 12 items, 2 packages - $40.00 | Sixpex: 5 items, 1 package - $25.00`
  - `package_count` — a number as a string, e.g. `"3"`

- [ ] **Step 1: Replace the old formula in the order handler**

In `script.js`, replace:

```js
  const subtotal      = storedCart.reduce((sum, i) => sum + (Number(i.price) * (i.quantity || 1)), 0);
  const totalQuantity = storedCart.reduce((sum, i) => sum + (i.quantity || 1), 0);
  let   shipping      = Math.ceil(totalQuantity / 10) * BASE_SHIPPING_PER_10;

  if (localStorage.getItem('freeShipping') === 'true') {
    shipping = Math.max(0, shipping - Math.min(20, shipping));
  }
```

with:

```js
  const subtotal       = storedCart.reduce((sum, i) => sum + (Number(i.price) * (i.quantity || 1)), 0);
  const shippingResult = computeShipping(storedCart, {
    freeShipping: localStorage.getItem('freeShipping') === 'true'
  });
  const shipping = shippingResult.total;

  // Plain-text breakdown so the merchant knows how many parcels to send.
  const shippingBreakdownText = shippingResult.breakdown
    .map(r => `${r.brand}: ${r.qty} item${r.qty === 1 ? '' : 's'}, ${r.packages} package${r.packages === 1 ? '' : 's'} - $${r.fee.toFixed(2)}`)
    .join(' | ');
  const packageCount = String(shippingResult.packageCount);
```

`totalQuantity` was only used by the old formula here, so it is removed. If `node --check` or a runtime error later reports `totalQuantity is not defined` in this function, that means it is used elsewhere in the handler — restore the `const totalQuantity = ...` line rather than removing the reference.

- [ ] **Step 2: Add the fields to the customer EmailJS payload**

In `script.js`, in `customerPayload.template_params`, replace:

```js
      subtotal: discountedSubtotal.toFixed(2), shipping: shipping.toFixed(2),
      total: grandTotal.toFixed(2), promo_code: promoCode, discount: discountLine,
      payment_method: paymentMethod
```

with:

```js
      subtotal: discountedSubtotal.toFixed(2), shipping: shipping.toFixed(2),
      shipping_breakdown: shippingBreakdownText, package_count: packageCount,
      total: grandTotal.toFixed(2), promo_code: promoCode, discount: discountLine,
      payment_method: paymentMethod
```

- [ ] **Step 3: Add the fields to the owner EmailJS payload**

In `script.js`, in `ownerPayload.template_params`, replace:

```js
      subtotal: discountedSubtotal.toFixed(2), shipping: shipping.toFixed(2),
      total: grandTotal.toFixed(2), promo_code: promoCode, discount: discountLine,
      payment_method: paymentMethod,
      to_email: 'aasshop100@gmail.com'
```

with:

```js
      subtotal: discountedSubtotal.toFixed(2), shipping: shipping.toFixed(2),
      shipping_breakdown: shippingBreakdownText, package_count: packageCount,
      total: grandTotal.toFixed(2), promo_code: promoCode, discount: discountLine,
      payment_method: paymentMethod,
      to_email: 'aasshop100@gmail.com'
```

- [ ] **Step 4: Extend the Telegram notification function**

In `script.js`, replace the signature:

```js
function sendTelegramNotification(orderId, fullName, phone, whatsapp, fullAddress, items, grandTotal, promoCode, discountLine, shipping, paymentMethod) {
```

with:

```js
function sendTelegramNotification(orderId, fullName, phone, whatsapp, fullAddress, items, grandTotal, promoCode, discountLine, shipping, paymentMethod, shippingBreakdown, packageCount) {
```

and replace the request body:

```js
    body: JSON.stringify({ orderId, fullName, phone, whatsapp, fullAddress, items, grandTotal, promoCode, discountLine, shipping, paymentMethod })
```

with:

```js
    body: JSON.stringify({ orderId, fullName, phone, whatsapp, fullAddress, items, grandTotal, promoCode, discountLine, shipping, paymentMethod, shippingBreakdown, packageCount })
```

- [ ] **Step 5: Pass the new arguments at the call site**

In `script.js`, replace:

```js
  sendTelegramNotification(orderId, fullName, phone, whatsapp, fullAddress, storedCart, grandTotal.toFixed(2), promoCode, discountLine, shipping.toFixed(2), paymentMethod);
```

with:

```js
  sendTelegramNotification(orderId, fullName, phone, whatsapp, fullAddress, storedCart, grandTotal.toFixed(2), promoCode, discountLine, shipping.toFixed(2), paymentMethod, shippingBreakdownText, packageCount);
```

- [ ] **Step 6: Verify no usage of the old constant survives**

```bash
node --check script.js && grep -n "BASE_SHIPPING_PER_10" script.js
```

Expected: no output from `--check`; `grep` shows **only** the declaration on line 8. All three usages are now gone.

- [ ] **Step 7: Remove the now-unused constant**

Delete this line from the top of `script.js`:

```js
const BASE_SHIPPING_PER_10 = 20.00;
```

Then confirm it is fully gone from the working tree:

```bash
grep -rn "BASE_SHIPPING_PER_10" . --include=*.js --include=*.html | grep -v ".claude/worktrees"
```

Expected: no output.

- [ ] **Step 8: Verify syntax and tests**

```bash
node --check script.js && node --test tests/shipping.test.js
```

Expected: no output from `--check`, then 18 passing tests.

- [ ] **Step 9: Commit**

```bash
git add script.js && git commit -F- <<'MSG'
Send per-brand shipping breakdown and package count with orders

Adds shipping_breakdown and package_count to both EmailJS payloads and the
Telegram worker message so the merchant knows how many parcels to ship.
Removes the now-unused BASE_SHIPPING_PER_10 constant.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 6: Promo copy correction and full manual verification

**Files:**
- Modify: `script.js` — the free-shipping success message inside `initPromoCode` (around line 877)

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: nothing new.

- [ ] **Step 1: Correct the free-shipping promo message**

The waiver can now be worth $25, not $20, and it covers one package rather than the whole order. In `script.js`, inside `initPromoCode`, replace:

```js
      showMessage(`✅ Free shipping promo applied! Shipping discounted up to $20.`, 'text-success');
```

with:

```js
      showMessage(`✅ Free shipping promo applied! One package ships free.`, 'text-success');
```

- [ ] **Step 2: Verify syntax**

```bash
node --check script.js
```

Expected: no output.

- [ ] **Step 3: Run the full manual test matrix in the browser**

For each row, seed the cart in the console using the shape from Task 3 Step 7, reload `cart.html`, then open `checkout.html` and confirm both pages agree.

| # | Cart | Expected shipping | Expected packages |
|---|---|---|---|
| 1 | 5 Beligas | $20.00 | 1, no multi-package note |
| 2 | 5 Beligas + 5 Sixpex | $45.00 | 2 |
| 3 | 12 Beligas + 5 Sixpex | $65.00 | 3 |
| 4 | 5 Sixpex + 5 Xeno | $50.00 | 2 |
| 5 | 1 Beligas + 1 Sixpex + 1 Xeno | $70.00 | 3 |
| 6 | 20 Beligas | $40.00 | 2 |
| 7 | 21 Beligas | $60.00 | 3 |
| 8 | empty | $0.00 | breakdown area empty |

- [ ] **Step 4: Verify a real add-to-cart writes the brand**

Open `products.html`, click Add to Cart on any Sixpex product, then in the console:

```js
JSON.parse(localStorage.getItem('cart'))
```

Expected: the new item has `brand: "Sixpex"`. This confirms the `closest('[data-brand]')` lookup finds the card in the real DOM — the seeded-cart tests above bypass that path entirely.

- [ ] **Step 5: Verify the legacy-cart fallback**

Seed a cart with **no** `brand` field and reload `cart.html`:

```js
localStorage.setItem('cart', JSON.stringify([
  { id: 'xeno-tamox', name: 'Tamox', price: 50.00, quantity: 1, image: '' }
]));
location.reload();
```

Expected: the breakdown resolves to `Xeno · 1 item · 1 package  $25.00` via the `FEATURED_CATALOG` fallback, with no console warning.

Then seed an unknown id:

```js
localStorage.setItem('cart', JSON.stringify([
  { id: 'not-a-real-product', name: 'Mystery', price: 10.00, quantity: 1, image: '' }
]));
location.reload();
```

Expected: resolves to `Beligas` at $20.00, and the console shows `[shipping] could not resolve brand for item not-a-real-product - defaulting to Beligas`.

- [ ] **Step 6: Verify the promo paths**

With cart row 3 above ($65.00 across 3 packages) seeded:

1. Apply a free-shipping code. Expected: the message reads "One package ships free.", the Sixpex row drops to `$0.00`, the total drops to `$40.00`, and the note still says **3** separate packages.
2. Clear the cart, then apply `NEWCLIENT10` with 5 Beligas items. Expected: the subtotal shows the -10% strikethrough and shipping stays exactly `$20.00` — percentage codes never touch shipping.
3. Clear the cart, add exactly 10 Beligas items, then apply the free-item code. Expected: the free Test Cyp vial is added as Beligas, Beligas quantity becomes 11, and shipping rises from `$20.00` to `$40.00` across 2 packages. **This is intended behaviour, not a bug** — confirmed by the owner during design.

- [ ] **Step 7: Place a real end-to-end test order**

Submit an order from `checkout.html` with a 2-brand cart. Confirm:
- the owner email arrives and its total matches the checkout total
- the Telegram message arrives
- the order-success page total matches the checkout total

The new `shipping_breakdown` and `package_count` fields will **not** appear in the email or Telegram message yet — see Step 9.

- [ ] **Step 8: Commit**

```bash
git add script.js && git commit -F- <<'MSG'
Reword free-shipping promo message for per-package waiver

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

- [ ] **Step 9: Hand off the out-of-repo template work**

These three surfaces live in external dashboards and **cannot be changed from this repo**. Report to the owner that each needs a manual edit to display the new `shipping_breakdown` and `package_count` fields:

| Surface | Where |
|---|---|
| Customer email template `template_0ry9w0v` | EmailJS dashboard |
| Owner email template `template_8x2z86l` | EmailJS dashboard |
| `gmg-telegram` message | Cloudflare Worker Quick Edit |

Until they are edited, orders still work correctly — the extra fields are simply ignored. The owner-side email matters most, since it is what tells the merchant how many parcels to ship.

- [ ] **Step 10: Merge and deploy**

Only after the owner confirms the manual verification passed:

```bash
git checkout main && git merge per-brand-shipping && git push origin main
```

GitHub Pages rebuilds automatically in 1-2 minutes. Verify the live cart at https://godmusclegears.com/cart.html shows the breakdown.
