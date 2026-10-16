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

### The storefront sheet holds the whole business now (2026-10-16)

It is no longer an inventory-only file. The order and daily-post tabs were
merged into it so there is **one spreadsheet to check** instead of three:

```
Sheet1              ← the inventory mirror. MUST STAY FIRST (index 0).
Stock View
Not On Website
Sheet1 BACKUP …     ← two dated snapshots
Orders              ← moved in from the old GMG Orders file
processed_tx        ← moved in from the old GMG Orders file
GMG_Daily_Posts     ← moved in from the old daily-post file
```

**This file was chosen as the host for one reason: the Apps Script web app is
container-bound to it.** Move `Sheet1` out and the storefront's stock feed dies
until the script is repointed *and redeployed* — a new `/exec` URL, which means
editing `script.js` and deploying the site. Moving the other tabs *in* costs
nothing. If this is ever revisited, the host is whichever file the Apps Script
is bound to.

**The feed targets its tab by name, not by position.** Verified 2026-10-16 by
parking an empty tab at index 0 for two seconds: the feed kept serving all 134
inventory rows. That is what makes it safe for customer order data to sit in
the same container as a web app published to "anyone" — a *positional* script
would have served the `Orders` tab, names and addresses included, to the open
internet.

Two consequences worth keeping in mind:

- **Never rename `Sheet1`**, and never add a second tab called `Sheet1`. The
  script finds its data by that name.
- **Re-check the feed after any change to the tab layout.** It should return 134
  rows whose keys are exactly `ID`, `Stock`, `Master Product Name`,
  `Website Name`, `Brand Section`, `Master Row` — and no order fields. If an
  order field ever appears there, stop and treat it as a data leak.

The n8n workflows reach this file as a **service account**, which needs Editor
access on it. Reads and writes both fail silently-ish without that — the
workflow errors rather than corrupting anything, but nothing gets written.

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

## Adding a product to the site — five parts, not two

Miss any one and it fails quietly:

1. **`products.html`** — the card, with a unique `data-id`
2. **`FEATURED_CATALOG`** in `script.js` — a card missing here never appears in
   the homepage carousel
3. **the JSON-LD `ItemList`** in `products.html` — keep positions contiguous
4. **a row in the storefront sheet** whose `ID` matches `data-id` exactly
   (lowercased, trimmed), with a `Stock` formula reading the right column for
   that brand section
5. **regenerate the product pages** — `node build-product-pages.js` — so the
   new product gets its own shareable page and a sitemap entry

**Do the sheet row first, or with the deploy.** A card whose id has no sheet row
gets `undefined` stock — and fail-open makes it buyable regardless of reality.

## Re-keying a product — three parts

Changing a `data-id` means changing it in **three** places:

1. `products.html` `data-id`
2. the sheet's `ID` column
3. **the `MATCH` name inside that row's formula**

Re-keying also changes the product's public page URL (`/p/<id>.html`), so any
link already shared for the old id will 404. Re-run
`node build-product-pages.js` afterwards.

Part 3 was missed when `sixpex-primopex25` was re-keyed to `sixpex-primopex100`
on 2026-08-26. Both products read 0, so the card silently mirrored the wrong
product's stock for five weeks.

## Editing formulas safely

Rename only the `MATCH` string literal in the existing formula, and assert that
nothing else changed. Retyping an `IMPORTRANGE` formula by hand risks silently
altering the URL or the column.

Read formulas with the Sheets API using `valueRenderOption: 'FORMULA'` — a plain
read returns values and tells you nothing about what is actually wired up.
