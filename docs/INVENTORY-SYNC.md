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

`Sheet1` column B is **one formula per product row, never a number** (156 rows
as of 2026-10-22). Typing a value into it destroys that row's link to the master
permanently. To change stock, the master changes — not this sheet.

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
parking an empty tab at index 0 for two seconds: the feed kept serving every
inventory row. That is what makes it safe for customer order data to sit in
the same container as a web app published to "anyone" — a *positional* script
would have served the `Orders` tab, names and addresses included, to the open
internet.

Two consequences worth keeping in mind:

- **Never rename `Sheet1`**, and never add a second tab called `Sheet1`. The
  script finds its data by that name.
- **Re-check the feed after any change to the tab layout.** It should return one
  row per product, whose keys are exactly `ID`, `Stock`, `Master Product Name`,
  `Website Name`, `Brand Section`, `Master Row` — and no order fields. If an
  order field ever appears there, stop and treat it as a data leak.

The n8n workflows reach this file as a **service account**, which needs Editor
access on it. Reads and writes both fail silently-ish without that — the
workflow errors rather than corrupting anything, but nothing gets written.

### Two column layouts, both correct

The master is not uniform, and a formula has to read the right column for its
section:

| Section | Layout | What our formula reads |
|---|---|---|
| Beligas (Oral / Injectable / SARMS) | name, then four warehouse columns, then a total | `SUM(…"INVENTORY!B:E")` — **the four warehouses, summed by us** |
| Sixpex / Odin, Xeno Labs | name, SKU, stock | `INDEX(…"INVENTORY!C:C")` — raw stock, no sum |

A script that assumes one layout for all rows will report ~85 false mismatches.
Check each formula's own shape.

**The Beligas rows deliberately ignore the master's own total column.** Column F
is *derived on their side*, and on 2026-10-01 it broke twice in one day: one
product had a blank F against 154 units in the warehouses, two more had F = 0
against 216 and 387. Two products sat Out of Stock on the live site with 603
units in stock, and one went fail-open buyable. Every Beligas row now sums the
raw warehouse columns instead. The supplier has since repaired their formula —
**keep the SUM anyway.** A derived column in a sheet we cannot edit broke twice
in a single day, and the store went quietly unsellable both times.

Matching is **by display-name string** into a sheet we do not control. A rename
on their side silently breaks a row. Several master names end in a full stop
(`SIXPEX PT-141 10mg.`, `XENO Selank 5mg.`) and `MATCH` is exact — copy the name
byte for byte, trailing punctuation included.

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

Plus an image at `images/<data-id>.jpg` — **600×600, always `.jpg`.** The
filename must equal the `data-id`, so a dose with a decimal gets a hyphen, never
a dot: `femara2-5mg50tabs`, not `femara2.5mg50tabs`. A dot would land in the
filename and in the `/p/<id>.html` URL.

**Do the sheet row first, or with the deploy.** A card whose id has no sheet row
gets `undefined` stock — and fail-open makes it buyable regardless of reality.

### Two tests pin the catalog, and both have to move

`node --test tests/*.test.js` hardcodes two facts about the real catalog, so a
batch of new products turns them red. That is the test doing its job — update
them, do not loosen them:

- the **product count** in `tests/product-data.test.js`
- the **full list of peptide ids**, which guards the peptide-calculator link on
  the generated pages. Adding a peptide means adding its id here.

### Verifying a new `MATCH` name without opening the master

The `Not On Website` tab carries a **`Live Stock`** column — its own live lookup
of the same master product. After adding a row, check that the new formula's
value equals that cell. If the two agree, the name matched the row you meant; if
they differ, the `MATCH` found something else. Two numbers, no eyeballing.

Regenerate `Not On Website` after each batch, so the backlog always reflects
what is genuinely still missing.

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

## Repointing a product — not the same as re-keying

When the supplier re-lists a product under a new master name, the card should
follow it rather than be duplicated. **Keep the `data-id`.** Nothing about the
id, the image filename or the public URL changes, so no shared link breaks, and
only three things move:

1. the `MATCH` literal inside that row's formula
2. the row's `Master Product Name` and `Master Row` columns (documentation)
3. the price, if it changed — in **four** places: the card's `.fw-bold` span,
   its `data-price`, the JSON-LD `offers.price`, and `FEATURED_CATALOG`

Done on 2026-10-22 for `xeno-tamox`: it tracked `XENO Tamox` (stock 0) while the
supplier's current listing was `XENO Tamox (50 Tabs)` (stock 5). Adding a second
card would have left two Tamox listings, one permanently Out of Stock.

**What proved they were the same product was the photo, not the numbers.** The
card's own image was a *30-tab* pouch sitting under copy that claimed 50
tablets. Stock figures could not tell the two master rows apart; the label in
the artwork could. **When two master rows look like one item, read the pack size
off the product image.**

Note that repointing does not necessarily make a card buyable — this one went
0 → 5, still under the Out of Stock threshold. "Still Out of Stock" is not
evidence the repoint failed.

## Editing formulas safely

Rename only the `MATCH` string literal in the existing formula, and assert that
nothing else changed. Retyping an `IMPORTRANGE` formula by hand risks silently
altering the URL or the column.

A cheap way to assert it: pull every `"..."` out of the old and the new formula,
require exactly one pair to differ, and require it to be the pair you meant.
Then compare the whole strings with that literal masked out. Both checks are a
few lines and they catch a mangled URL immediately.

Read formulas with the Sheets API using `valueRenderOption: 'FORMULA'` — a plain
read returns values and tells you nothing about what is actually wired up.
