# Inventory sync — how stock reaches the storefront

> **No spreadsheet IDs, URLs or credentials in this file.** This repository is
> public and GitHub Pages published every file in it until `_config.yml` was
> added. `docs/` is excluded from the published site, but it is still readable
> on GitHub. The actual IDs live in local notes, not here.

## The chain

```
Supplier master sheet  →  IMPORTRANGE formulas  →  Apps Script web app  →  parseInt()  →  button
  (tab: INVENTORY)        (storefront sheet, col B)      (JSON feed)        (script.js)
```

Four hops. The storefront **never reads the master.** It reads the output of a
formula, two steps removed, and by the time a value reaches the browser every
distinct failure has collapsed into the same thing: a non-number.

### What lives where

| | |
|---|---|
| **Master** | The supplier's own sheet, tab `INVENTORY`. **Read-only to us** — we cannot fix a bad row at source, only work around it. |
| **Storefront sheet** | Tab `Sheet1`. Columns `ID \| Stock \| Master Product Name \| Website Name \| Brand Section \| Master Row`. |
| **Feed** | An Apps Script web app serving `Sheet1` as JSON. URL is in `script.js` `initInventorySync()`. |
| **Consumer** | `initInventorySync()` reads **only `ID` and `Stock`**. Every other column is documentation. |

`Sheet1` column B is **134 formulas, not numbers.** Typing a value into it
destroys that row's link to the master permanently. To change stock, the master
changes — not this sheet.

### Two column layouts, both correct

The master is not uniform, and a formula has to read the right column for its
section:

| Section | Layout | Stock column |
|---|---|---|
| Beligas (Oral / Injectable / SARMS) | name, then four warehouse columns, then a total | **F** (the total) |
| Sixpex / Odin, Xeno Labs | name, SKU, stock | **C** |

A script that assumes one column for all rows will report ~85 false mismatches.
Check each formula's own column.

Matching is **by display-name string** into a sheet we do not control. A rename
on their side silently breaks a row.

## The fail-open default — read this before changing anything

`initInventorySync()` treats unknown stock as **in stock**:

```js
if (stock == null || isNaN(stock)) {
  button.disabled = false;   // unknown → sellable
}
```

So a broken row does not show an error. It shows a **buyable product.** A
failure is indistinguishable from healthy stock.

Two ways a row yields no number, both seen in production on 2026-09-30:

1. **`#N/A`** — the `MATCH` name does not exist in the master (a typo, or they
   renamed it). The lookup failed; nothing says so.
2. **blank** — the name matched, but the cell it landed on is empty (e.g. the
   supplier never filled in that row's total). Blank is not zero.

`parseInt` turns both into `NaN`, and `NaN` becomes "Add to Cart".

**Why it is still fail-open:** if the whole feed fails, fail-safe would make the
entire store unbuyable on a day when nothing is wrong with actual stock. The
intended fix is not to flip the default but to **alert** when any feed row is
non-numeric. That alert does not exist yet.

**Four places decide a button's state.** Any change must cover all four, or a
product slips through one of them:

1. the per-card loop in `initInventorySync()`
2. `buildFeaturedCarousel()` — builds its own buttons from `FEATURED_CATALOG`
3. that function's **fallback pool**, used when too few products are in stock
4. the `catch` in `initInventorySync()` — on fetch failure it **re-enables every
   button on the page**

## Manual hold — forcing a product unbuyable

Sheet stock cannot express *"do not sell this yet."* `HELD_PRODUCTS` in
`script.js` can:

```js
const HELD_PRODUCTS = new Set(['xeno-proviron', 'xeno-clomiphene']);
```

A held id stays disabled even when the feed reports plenty, **and** when the
feed fails entirely. It is enforced at all four places above, plus a guard in
`addToCart()` so a stale or hand-enabled button cannot put it in the cart.

**To put a product back on sale: delete its id from the set.** That is the only
step.

## Adding a product to the site — four parts, not two

Miss any one and it fails quietly:

1. **`products.html`** — the card, with a unique `data-id`
2. **`FEATURED_CATALOG`** in `script.js` — a card missing here never appears in
   the homepage carousel
3. **the JSON-LD `ItemList`** in `products.html` — keep positions contiguous
4. **a row in the storefront sheet** whose `ID` matches `data-id` exactly
   (lowercased, trimmed), with a `Stock` formula reading the right column for
   that brand section

**Do the sheet row first, or with the deploy.** A card whose id has no sheet row
gets `undefined` stock — and fail-open makes it buyable regardless of reality.

## Re-keying a product — three parts

Changing a `data-id` means changing it in **three** places:

1. `products.html` `data-id`
2. the sheet's `ID` column
3. **the `MATCH` name inside that row's formula**

Part 3 was missed when `sixpex-primopex25` was re-keyed to `sixpex-primopex100`
on 2026-08-26. Both products read 0, so the card silently mirrored the wrong
product's stock for five weeks.

## Editing formulas safely

Rename only the `MATCH` string literal in the existing formula, and assert that
nothing else changed. Retyping an `IMPORTRANGE` formula by hand risks silently
altering the URL or the column.

Read formulas with the Sheets API using `valueRenderOption: 'FORMULA'` — a plain
read returns values and tells you nothing about what is actually wired up.
