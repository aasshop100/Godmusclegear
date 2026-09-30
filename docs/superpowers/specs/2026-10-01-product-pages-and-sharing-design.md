# Per-product pages and share buttons — design

**Date:** 2026-10-01
**Status:** approved, not yet implemented

> No spreadsheet IDs, URLs or credentials in this file. This repository is public.

## Problem

Products cannot be shared. All 133 live on `products.html`; there is no URL that
points at one product. The only deep link is `?brand=X`, and the product modal
does not change the URL.

Lester wants to send individual products to prospects and to post them in his
Telegram group. Both uses depend on the **link preview** — the thumbnail, title
and description that appear when a link is pasted into a chat. A share button
alone does not deliver that: on static hosting, `products.html?product=anavar`
previews as the generic store page no matter which product it names, because
Open Graph tags are read from static HTML and are identical for every product.

So the share button needs something to point at.

## Goals

1. Every product has a stable, shareable URL.
2. A shared link previews as that product — correct image, title, description.
3. A share control on each product card and on each product page.
4. Product pages obey the same stock rules as cards, **including `HELD_PRODUCTS`**.
5. No change to live infrastructure.

### Secondary goal: the brand-collision SEO problem

Searches combining "god muscle gears" with a product term lose to an unrelated
established brand, because the brand name appears mostly in boilerplate rather
than in page content. 133 indexable pages, each genuinely about one product and
naming the brand in title, H1 and body, is a far stronger and more durable
signal than the blog-paragraph mentions added in August. This is a consequence
of the design, not a separate workstream.

### Non-goals

- Rewriting `products.html`. It remains the browse page and the data source.
- Server-side rendering, Cloudflare proxying, or any Worker. Explicitly rejected:
  proxying a live storefront and putting a Worker in every request path is real
  risk for a share button, and yields no SEO benefit.
- A checkout or cart change. Product pages reuse the existing cart.

## Approach

One generator, one template, 133 generated outputs.

```
products.html  ──parse──►  build-product-pages.js  ──►  p/<id>.html  × 133
(source of truth)              + template                    │
                                                             └──►  sitemap.xml
```

Generated pages are artifacts: never hand-edited, always regenerable. If a page
and `products.html` disagree, `products.html` wins and the generator is re-run.

### Why generation is cheap here

Every one of the 133 cards is fully machine-extractable — verified 2026-10-01:
title, description, `data-id`, `data-image`, `data-name`, `data-price`,
`data-brand`, `data-type` all parse, with zero incomplete cards. No manual data
entry is required.

## URL scheme

`/p/<data-id>.html` — e.g. `/p/testc250mg.html`, `/p/xeno-proviron.html`.

The raw `data-id` is used rather than a title-derived slug. Ids are already
unique and stable, and re-keying one is a rare, checklist-driven operation. A
slug derived from the product name would change whenever the name is reworded,
silently breaking every link already shared in a Telegram group — the exact use
case this feature exists for. URL keywords are a minor ranking factor next to
title, H1 and body copy.

Consequence to accept: URLs are opaque (`/p/testc250mg.html`). Decided
knowingly on 2026-10-01.

## Page template

Each page contains, in addition to the site's existing header, nav and footer:

- `<h1>` — product name and brand
- the product description copied from its card
- price and an Add to Cart button
- stock state, driven by the existing inventory sync
- brand, form (Injectable / Oral / Peptide), and that brand's real shipping rate
  from `shipping.js` (Beligas $20, Sixpex $25, Xeno $25 per 10 units, each brand
  shipping as its own package)
- payment methods and the reship guarantee
- a link to the matching blog guide where one exists, and to the peptide
  calculator for peptide products
- a link back to `products.html`

### Guide-link mapping

Explicit, not inferred. A product links to a guide only if its card title
matches one of these case-insensitive patterns; otherwise it shows no guide
link. Unmatched is the normal case and is not an error.

| Pattern in card title | Guide |
|---|---|
| `anavar`, `oxandrolone`, `oxapex` | `blog/anavar-guide.html` |
| `bpc` | `blog/bpc157-complete-guide.html` |
| `clomid`, `clomiphene`, `clomipex`, `nolvadex`, `tamox`, `nolvapex` | `blog/pct-guide.html` |
| `semaglutide`, `tirzepatide`, `retatrutide` | `blog/semaglutide-tirzepatide-weight-loss.html` |
| `trenbolone`, `tren`, `trenbopex`, `parabolan` | `blog/trenbolone-guide.html` |
| `testosterone`, `testost`, `test c`, `test e`, `testopex` | `blog/testosterone-enanthate-vs-cypionate.html` |

The peptide-calculator link is shown when `data-type` is `Peptide`.

A test asserts every pattern resolves to a file that exists, so a renamed or
deleted guide fails the build rather than shipping 133 dead links.

**No new medical, dosage or efficacy claims are written.** All product copy is
the text already on the card. Added content is factual store information
(shipping, payment, brand, form) that differs per product and per brand.

### Thin-content risk

133 near-identical pages with two lines of copy each can read to a search engine
as doorway pages, which would work against the SEO goal rather than for it. The
per-product description plus per-brand shipping, form, and guide links give each
page genuinely differing content. If Search Console later reports these pages as
excluded or low value, the response is to add real per-product copy, not to add
more boilerplate.

## Metadata

Per page:

- `<title>` — `<product name> — <brand> | GOD MUSCLE GEARS`
- meta description — the card description, collapsed to a single line and
  truncated at the last word boundary before 155 characters, with no ellipsis
  added if it was not truncated
- Open Graph: `og:title`, `og:description`, `og:image` (absolute URL),
  `og:url`, `og:type=product`
- `twitter:card=summary_large_image`
- JSON-LD `Product` with `offers`
- self-referencing `<link rel="canonical">`

`products.html` keeps its own canonical and is unchanged.

## Price handling

Price currently lives in **two** places already: `data-price` in `products.html`
and the `FEATURED_CATALOG` row in `script.js`. Verified 2026-10-01: both list
133 ids with zero mismatches.

Generating 133 more copies would make a third. Therefore:

- **Visible price is rendered at runtime** from `FEATURED_CATALOG`, so a page
  cannot display a stale price even if it has not been regenerated.
- **JSON-LD and meta tags carry the baked price**, because crawlers must not
  depend on JavaScript. These go stale until regeneration, which is acceptable —
  they are not what the customer is charged.
- **The generator fails loudly** if `products.html` and `FEATURED_CATALOG`
  disagree on any id or price. This converts an existing silent duplication into
  a checked one.

## Stock, and the hold

Product pages load `script.js` unchanged. `initInventorySync()` selects
`.card` / `.add-to-cart`, so a page containing one card is handled with no
modification, and inherits both the stock thresholds and `HELD_PRODUCTS`.

`buildFeaturedCarousel()` returns early when `#featuredCarousel` is absent, and
the product-list sort is skipped when `#product-list` is absent. Neither needs
changing.

**Required verification:** `/p/xeno-proviron.html` and `/p/xeno-clomiphene.html`
must render Out of Stock with the button disabled. A product page that bypassed
the hold would silently undo the 2026-09-30 fix. This is a blocking test, not a
nice-to-have.

## Share control

A button on each product card and on each product page.

- Where `navigator.share` exists (most mobile browsers), open the native share
  sheet — this is the path into WhatsApp and Telegram.
- Otherwise copy the URL to the clipboard and show a brief "Link copied"
  confirmation. Use `navigator.clipboard` with a `textarea` fallback for
  non-secure or older contexts.
- Shared payload: product name and the absolute URL
  `https://godmusclegears.com/p/<id>.html`. **No price in the share text**, so a
  forwarded message cannot become wrong.
- A real `<button type="button">` with `aria-label="Share <product name>"`.
- **Placement:** on a card, inline beside Add to Cart, icon-only, so it does not
  compete with the primary action or reflow the 133-card grid. On a product
  page, beside Add to Cart with a visible "Share" label.
- A held or out-of-stock product **remains shareable** — the share button is
  never disabled. Sharing is not buying, and a shared link to a restocked
  product is still useful.

Implemented as `initShareButtons()` in `script.js`, bound like the existing
add-to-cart handlers.

## Files

| File | Change |
|---|---|
| `build-product-pages.js` | new — generator (repo root, matching existing module placement) |
| `p/<id>.html` | new — 133 generated pages |
| `tests/product-pages.test.js` | new |
| `script.js` | add `initShareButtons()`; call it from init |
| `products.html` | add a share button to each card |
| `sitemap.xml` | regenerated, 13 → 146 URLs |
| `_config.yml` | exclude `build-product-pages.js`; confirm `p/` is NOT excluded |

`robots.txt` needs no change — it is `Allow: /`.

## Testing

Unit tests (`node --test tests/*.test.js`, current suite 148):

- all 133 cards parse; 133 pages generated; every id accounted for
- id uniqueness
- **HTML and attribute escaping** — descriptions contain `&` and quote
  characters that would otherwise corrupt meta tags and JSON-LD. Mutation-test
  this: removing the escaping must fail the suite
- price parity between `products.html` and `FEATURED_CATALOG` fails loudly
- generated sitemap preserves the 13 existing URLs and does not duplicate `/p/`
  entries on re-run (idempotence)

Browser verification on the 3 sample pages before generating all 133:

- stock state correct, held products disabled
- add-to-cart works and the cart carries the right brand
- share: clipboard copy path, and that the button is a real focusable button
- renders at 375px with no horizontal overflow
- console clean

## Sequence

1. Generator plus **3 sample pages**, named now so the review is deterministic:
   - `testc250mg` — Beligas injectable, in stock, matches a guide pattern
   - `sixpex-bpc157` — Sixpex peptide, in stock, exercises the peptide-calculator
     link and the $25 shipping rate
   - `xeno-proviron` — Xeno oral, **held**, so the hold is proven on the very
     first page rather than after 133 exist
2. Review the samples; adjust the template.
3. Generate all 133.
4. Verify, including the held-product check.
5. Commit and push.

Settling the template before multiplying it by 133 is the point of the split.

## Consequences

- Adding a product becomes a **5-part** change: card in `products.html`,
  `FEATURED_CATALOG`, JSON-LD `ItemList`, storefront sheet row, **and
  regenerate**. `docs/INVENTORY-SYNC.md` must be updated to say so.
- The generator must stay re-runnable and idempotent.
- 133 new files land in a public repo; they contain only what is already public
  on the storefront.
