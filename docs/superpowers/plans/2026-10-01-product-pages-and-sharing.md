# Per-Product Pages and Share Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a shareable, preview-correct page for each of the 133 products, and add a share control that puts those links into Telegram and WhatsApp.

**Architecture:** Three build-time Node modules — a pure parser, a pure renderer, and a thin CLI that does the file I/O — plus one runtime function in `script.js`. `products.html` stays the single source of product data; `p/<id>.html` files are regenerable artifacts. Product pages load the existing `script.js` unchanged, so they inherit stock thresholds and `HELD_PRODUCTS` for free.

**Tech Stack:** Plain Node (no build step, no dependencies), `node:test` + `node:assert/strict`, vanilla browser JS, Bootstrap 5.3 (already loaded).

Spec: `docs/superpowers/specs/2026-10-01-product-pages-and-sharing-design.md`

## Global Constraints

- **Node built-ins only.** This repo has no runtime dependencies; do not add any.
- **Test command is `node --test tests/*.test.js`** — NOT `node --test tests/`, which Node resolves as a module path and fails. Current suite: 148 passing. It must stay green.
- **Write files with the Write/Edit tools, never a bash heredoc.** Heredocs on this machine strip backslashes (`\d` becomes `d`) and backticks inside double-quoted strings execute. Every file in this plan contains regexes and template literals.
- **`products.html` and `script.js` are CRLF.** Anchors built with `\n` match zero times. Parsers must be line-ending agnostic (`\s*`, never a literal `\n`).
- **`products.html` starts with a UTF-8 BOM.** Strip it when parsing; preserve it when writing that file back.
- **This repository is PUBLIC.** No spreadsheet IDs, URLs, credentials, IPs or key filenames in any file, including comments and generated output.
- **Site base URL is `https://godmusclegears.com`** (no trailing slash).
- **Output directory is `p/`** at the repo root. Filenames are the raw `data-id`, lowercased: `p/<id>.html`.
- **Generated pages are artifacts.** Never hand-edit one. Regenerate.
- **No new medical, dosage or efficacy claims.** Product copy is exactly the text already on the card.
- **Commit message attribution:** end every commit message with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## File Structure

| File | Responsibility |
|---|---|
| `product-data.js` | **new.** Pure. Parse `products.html` into product objects; map guide links; verify price parity against `FEATURED_CATALOG`. No fs, no DOM. |
| `product-page-template.js` | **new.** Pure. Render one product object plus page chrome into an HTML string. Owns all escaping. No fs. |
| `build-product-pages.js` | **new.** CLI. Reads files, extracts chrome, rewrites relative URLs, writes `p/*.html` and `sitemap.xml`. The only module that touches disk. |
| `tests/product-data.test.js` | **new.** Parser and parity tests. |
| `tests/product-page-template.test.js` | **new.** Rendering and escaping tests. |
| `tests/build-product-pages.test.js` | **new.** URL rewriting and sitemap idempotence tests. |
| `script.js` | **modify.** Add `initShareButtons()`; call from the existing init block. |
| `products.html` | **modify.** Add a share button to each of the 133 cards (Task 6, generated edit). |
| `sitemap.xml` | **regenerated.** 13 → 146 URLs. |
| `_config.yml` | **modify.** Exclude the three build modules; confirm `p/` is published. |
| `docs/INVENTORY-SYNC.md` | **modify.** Adding a product becomes a 5-part change. |

The split exists because the parser and renderer are pure and heavily tested, while file I/O is not worth mocking. The spec named a single `build-product-pages.js`; this decomposition follows the repo's existing pure-module-plus-tests pattern (`shipping.js`, `peptide-calc.js`, `chain-parsing.js`).

---

### Task 1: Product data parser

**Files:**
- Create: `product-data.js`
- Test: `tests/product-data.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseProducts(html)` → array of `{id, title, cartName, description, image, price, brand, type}`. `price` is a Number. Order matches document order.
  - `guideFor(title)` → a path string like `'blog/anavar-guide.html'`, or `null`.
  - `checkPriceParity(html, scriptJs)` → `{ok: boolean, problems: string[]}`.
  - `GUIDE_PATTERNS` → the array used by `guideFor`, exported for tests.

- [ ] **Step 1: Write the failing tests**

Create `tests/product-data.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseProducts, guideFor, checkPriceParity, GUIDE_PATTERNS } = require('../product-data.js');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'products.html'), 'utf8');
const scriptJs = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

test('parses every product card', () => {
  const products = parseProducts(html);
  assert.equal(products.length, 133);
});

test('parses a known product completely', () => {
  const p = parseProducts(html).find(x => x.id === 'sustanon400mg');
  assert.equal(p.title, 'Testosterone Esters Blend, 400mg');
  assert.equal(p.cartName, 'Testosterone Esters Blend, 400mg (1 vial)');
  assert.equal(p.image, 'images/sustanon400mg.jpg');
  assert.equal(p.price, 86.25);
  assert.equal(p.brand, 'Beligas');
  assert.equal(p.type, 'Injectable');
  assert.match(p.description, /^Buy Testosterone Esters Blend 400mg online\./);
});

test('decodes HTML entities in the description', () => {
  const p = parseProducts(html).find(x => x.id === 'sustanon400mg');
  assert.ok(p.description.includes('&'), 'expected a decoded ampersand');
  assert.ok(!p.description.includes('&amp;'), 'entity was not decoded');
});

test('every product has the fields the template requires', () => {
  for (const p of parseProducts(html)) {
    for (const field of ['id', 'title', 'cartName', 'description', 'image', 'brand', 'type']) {
      assert.ok(p[field], `${p.id} is missing ${field}`);
    }
    assert.ok(Number.isFinite(p.price) && p.price > 0, `${p.id} has a bad price`);
  }
});

test('ids are unique', () => {
  const ids = parseProducts(html).map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('ids are already lowercase and trimmed', () => {
  for (const p of parseProducts(html)) {
    assert.equal(p.id, p.id.trim().toLowerCase(), `${p.id} is not normalised`);
  }
});

test('guideFor maps known products to guides', () => {
  assert.equal(guideFor('Anavar, 50mg'), 'blog/anavar-guide.html');
  assert.equal(guideFor('SIXPEX BPC-157 5mg'), 'blog/bpc157-complete-guide.html');
  assert.equal(guideFor('Clomiphene'), 'blog/pct-guide.html');
  assert.equal(guideFor('Testosterone Cypionate, 250mg'), 'blog/testosterone-enanthate-vs-cypionate.html');
});

test('guideFor returns null when nothing matches', () => {
  assert.equal(guideFor('Bacteriostatic Water'), null);
});

test('every guide target exists on disk', () => {
  for (const { guide } of GUIDE_PATTERNS) {
    assert.ok(fs.existsSync(path.join(ROOT, guide)), `missing guide file: ${guide}`);
  }
});

test('price parity between products.html and FEATURED_CATALOG holds', () => {
  const { ok, problems } = checkPriceParity(html, scriptJs);
  assert.deepEqual(problems, []);
  assert.equal(ok, true);
});

test('checkPriceParity reports a deliberately broken price', () => {
  const broken = html.replace('data-price="86.25"', 'data-price="1.00"');
  const { ok, problems } = checkPriceParity(broken, scriptJs);
  assert.equal(ok, false);
  assert.ok(problems.some(p => p.includes('sustanon400mg')));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/product-data.test.js`
Expected: FAIL — `Cannot find module '../product-data.js'`

- [ ] **Step 3: Write the implementation**

Create `product-data.js`:

```js
// Build-time only. Parses products.html into structured product data.
// Pure: no fs, no DOM, no network. Excluded from the published site.

const GUIDE_PATTERNS = [
  { re: /anavar|oxandrolone|oxapex/i,                          guide: 'blog/anavar-guide.html' },
  { re: /bpc/i,                                                guide: 'blog/bpc157-complete-guide.html' },
  { re: /clomid|clomiphene|clomipex|nolvadex|nolvapex|tamox/i,  guide: 'blog/pct-guide.html' },
  { re: /semaglutide|tirzepatide|retatrutide/i,                guide: 'blog/semaglutide-tirzepatide-weight-loss.html' },
  { re: /trenbolone|trenbopex|parabolan|\btren\b/i,             guide: 'blog/trenbolone-guide.html' },
  { re: /testosterone|testost|testopex|\btest [ce]\b/i,         guide: 'blog/testosterone-enanthate-vs-cypionate.html' },
];

// Order matters: the first pattern wins, so a "Trenbolone Testosterone Blend"
// resolves to the tren guide rather than the test guide. Deliberate.
function guideFor(title) {
  const hit = GUIDE_PATTERNS.find(g => g.re.test(String(title || '')));
  return hit ? hit.guide : null;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function collapse(s) {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

// Split on card boundaries. Line-ending agnostic: no literal newlines used.
function parseProducts(html) {
  const chunks = stripBom(html).split(/<div class="card"/).slice(1);
  const products = [];

  for (const chunk of chunks) {
    const btn = /data-id="([^"]*)"[^>]*data-image="([^"]*)"[^>]*data-name="([^"]*)"[^>]*data-price="([^"]*)"/.exec(chunk);
    const brandType = /^\s*data-brand="([^"]*)"\s*data-type="([^"]*)"/.exec(chunk);
    const title = /class="card-title">([\s\S]*?)<\/h5>/.exec(chunk);
    const desc = /class="card-text">([\s\S]*?)<\/p>/.exec(chunk);
    const img = /class="card-img-top"\s+src="([^"]*)"/.exec(chunk);

    if (!btn || !brandType || !title || !desc) continue;

    products.push({
      id: btn[1].trim().toLowerCase(),
      image: img ? img[1] : btn[2],
      cartName: collapse(btn[3]),
      price: Number(btn[4]),
      brand: collapse(brandType[1]),
      type: collapse(brandType[2]),
      title: collapse(title[1]),
      description: collapse(desc[1]),
    });
  }
  return products;
}

// products.html data-price and the FEATURED_CATALOG rows in script.js are two
// independent copies of the same number. Generating pages must not silently
// pick one. Any disagreement is a build failure.
function checkPriceParity(html, scriptJs) {
  const fromHtml = {};
  for (const p of parseProducts(html)) fromHtml[p.id] = p.price;

  const start = scriptJs.indexOf('const raw = [');
  const end = scriptJs.indexOf('];', start);
  const raw = start === -1 ? '' : scriptJs.slice(start, end);

  const fromCatalog = {};
  for (const m of raw.matchAll(/\[\s*'([^']+)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*([0-9.]+)/g)) {
    fromCatalog[m[1].trim().toLowerCase()] = Number(m[3]);
  }

  const problems = [];
  const ids = new Set([...Object.keys(fromHtml), ...Object.keys(fromCatalog)]);
  for (const id of [...ids].sort()) {
    if (!(id in fromHtml)) { problems.push(`${id}: in FEATURED_CATALOG but not products.html`); continue; }
    if (!(id in fromCatalog)) { problems.push(`${id}: in products.html but not FEATURED_CATALOG`); continue; }
    if (fromHtml[id] !== fromCatalog[id]) {
      problems.push(`${id}: products.html $${fromHtml[id]} vs FEATURED_CATALOG $${fromCatalog[id]}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

module.exports = { parseProducts, guideFor, checkPriceParity, GUIDE_PATTERNS, decodeEntities };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/product-data.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the whole suite**

Run: `node --test tests/*.test.js`
Expected: PASS, 159 tests (148 existing + 11 new).

- [ ] **Step 6: Commit**

```bash
git add product-data.js tests/product-data.test.js
git commit -m "Parse products.html into structured product data

Adds a pure parser plus a price-parity check. products.html data-price and
the FEATURED_CATALOG rows in script.js are two independent copies of the
same number; generating 133 pages from one of them without checking the
other would turn a silent duplication into a silent contradiction. Any
disagreement now fails the build.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Product page renderer

**Files:**
- Create: `product-page-template.js`
- Test: `tests/product-page-template.test.js`

**Interfaces:**
- Consumes: `guideFor` from `product-data.js`; product objects shaped by `parseProducts`.
- Produces:
  - `renderProductPage(product, chrome)` → full HTML string. `chrome` is `{nav, footer, scripts}`, all HTML strings.
  - `escapeHtml(s)` → string, escaping `& < > " '`.
  - `metaDescription(s)` → string, ≤155 chars, cut at a word boundary.
  - `SHIPPING_RATES` → `{Beligas: 20, Sixpex: 25, Xeno: 25}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/product-page-template.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderProductPage, escapeHtml, metaDescription, SHIPPING_RATES } = require('../product-page-template.js');

const CHROME = { nav: '<nav>NAV</nav>', footer: '<footer>FOOT</footer>', scripts: '<script src="/script.js"></script>' };

const PRODUCT = {
  id: 'testc250mg',
  title: 'Testosterone Cypionate, 250mg',
  cartName: 'Testosterone Cypionate, 250mg (1 vial)',
  description: 'Buy Testosterone Cypionate 250mg online. Beligas "HP" grade & ships to USA.',
  image: 'images/testc250mg.jpg',
  price: 63.84,
  brand: 'Beligas',
  type: 'Injectable',
};

test('escapeHtml escapes every dangerous character', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('escapeHtml escapes ampersands before other entities', () => {
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('metaDescription truncates at a word boundary under 155 chars', () => {
  const long = 'word '.repeat(60).trim();
  const out = metaDescription(long);
  assert.ok(out.length <= 155, `was ${out.length}`);
  assert.ok(!out.endsWith('wor'), 'cut mid-word');
});

test('metaDescription leaves a short description untouched', () => {
  assert.equal(metaDescription('Short description.'), 'Short description.');
});

test('renders the product title in h1, title tag and og:title', () => {
  const out = renderProductPage(PRODUCT, CHROME);
  assert.ok(out.includes('<h1'));
  assert.ok(out.includes('Testosterone Cypionate, 250mg'));
  assert.ok(out.includes('<title>Testosterone Cypionate, 250mg — Beligas | GOD MUSCLE GEARS</title>'));
  assert.ok(/<meta property="og:title" content="[^"]*Testosterone Cypionate/.test(out));
});

test('quotes in the description never break out of a meta attribute', () => {
  const out = renderProductPage(PRODUCT, CHROME);
  const metas = out.match(/<meta[^>]*content="[^"]*"[^>]*>/g) || [];
  // every meta tag must be well formed; an unescaped quote would split one
  assert.ok(metas.length >= 6);
  assert.ok(!out.includes('"HP" grade'), 'raw quotes leaked into the page');
  assert.ok(out.includes('&quot;HP&quot; grade'));
});

test('JSON-LD is valid JSON and carries the baked price', () => {
  const out = renderProductPage(PRODUCT, CHROME);
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(out);
  assert.ok(m, 'no JSON-LD block');
  const data = JSON.parse(m[1]);
  assert.equal(data['@type'], 'Product');
  assert.equal(data.offers.price, '63.84');
  assert.equal(data.brand.name, 'Beligas');
});

test('a closing script tag in the description cannot break out of JSON-LD', () => {
  const nasty = { ...PRODUCT, description: 'Ends here </script><script>alert(1)</script>' };
  const out = renderProductPage(nasty, CHROME);
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(out);
  assert.ok(m, 'no JSON-LD block');
  JSON.parse(m[1]); // must not throw — the block must not have been cut short
  assert.ok(!out.includes('<script>alert(1)</script>'), 'injected a live script tag');
});

test('visible price is marked for runtime refresh', () => {
  const out = renderProductPage(PRODUCT, CHROME);
  // Baked value is the no-JS / crawler fallback; script.js refreshes it from
  // FEATURED_CATALOG so a page that was not regenerated cannot show a stale price.
  assert.ok(/<span class="fw-bold" data-price-for="testc250mg">\$63\.84<\/span>/.test(out));
});

test('absolute URLs are used for og:url, og:image and canonical', () => {
  const out = renderProductPage(PRODUCT, CHROME);
  assert.ok(out.includes('content="https://godmusclegears.com/p/testc250mg.html"'));
  assert.ok(out.includes('content="https://godmusclegears.com/images/testc250mg.jpg"'));
  assert.ok(out.includes('<link rel="canonical" href="https://godmusclegears.com/p/testc250mg.html"/>'));
});

test('carries an add-to-cart button the inventory sync can find', () => {
  const out = renderProductPage(PRODUCT, CHROME);
  assert.ok(/<div class="card" data-brand="Beligas" data-type="Injectable">/.test(out));
  assert.ok(/class="add-to-cart"[^>]*data-id="testc250mg"/.test(out));
  assert.ok(/data-price="63.84"/.test(out));
  assert.ok(/data-name="Testosterone Cypionate, 250mg \(1 vial\)"/.test(out));
});

test('shows the correct per-brand shipping rate', () => {
  assert.equal(SHIPPING_RATES.Beligas, 20);
  assert.equal(SHIPPING_RATES.Sixpex, 25);
  assert.equal(SHIPPING_RATES.Xeno, 25);
  assert.ok(renderProductPage(PRODUCT, CHROME).includes('$20'));
  assert.ok(renderProductPage({ ...PRODUCT, brand: 'Xeno' }, CHROME).includes('$25'));
});

test('links to the matching guide, and omits the link when there is none', () => {
  assert.ok(renderProductPage(PRODUCT, CHROME).includes('/blog/testosterone-enanthate-vs-cypionate.html'));
  const none = renderProductPage({ ...PRODUCT, title: 'Bacteriostatic Water' }, CHROME);
  assert.ok(!none.includes('/blog/'));
});

test('shows the peptide calculator link only for peptides', () => {
  assert.ok(!renderProductPage(PRODUCT, CHROME).includes('peptide-calculator.html'));
  const pep = renderProductPage({ ...PRODUCT, type: 'Peptide' }, CHROME);
  assert.ok(pep.includes('/peptide-calculator.html'));
});

test('share button is present, enabled, and carries the absolute URL', () => {
  const out = renderProductPage(PRODUCT, CHROME);
  assert.ok(/<button type="button"[^>]*class="share-btn"/.test(out));
  assert.ok(out.includes('data-share-url="https://godmusclegears.com/p/testc250mg.html"'));
  assert.ok(/aria-label="Share Testosterone Cypionate, 250mg"/.test(out));
  assert.ok(!/class="share-btn"[^>]*disabled/.test(out));
});

test('injects the supplied chrome', () => {
  const out = renderProductPage(PRODUCT, CHROME);
  assert.ok(out.includes('<nav>NAV</nav>'));
  assert.ok(out.includes('<footer>FOOT</footer>'));
  assert.ok(out.includes('<script src="/script.js"></script>'));
});

test('output is a complete document', () => {
  const out = renderProductPage(PRODUCT, CHROME);
  assert.ok(out.startsWith('<!DOCTYPE html>'));
  assert.ok(out.trimEnd().endsWith('</html>'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/product-page-template.test.js`
Expected: FAIL — `Cannot find module '../product-page-template.js'`

- [ ] **Step 3: Write the implementation**

Create `product-page-template.js`:

```js
// Build-time only. Renders one product page. Pure: no fs, no DOM.
// Excluded from the published site.

const { guideFor } = require('./product-data.js');

const BASE = 'https://godmusclegears.com';

// Per-brand shipping, mirroring shipping.js. Each brand ships as its own
// package; these never pool.
const SHIPPING_RATES = { Beligas: 20, Sixpex: 25, Xeno: 25 };

// Ampersand MUST be replaced first or later replacements double-escape.
function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function metaDescription(s) {
  const one = String(s || '').replace(/\s+/g, ' ').trim();
  if (one.length <= 155) return one;
  const cut = one.slice(0, 155);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

function renderProductPage(product, chrome) {
  const { id, title, cartName, description, image, price, brand, type } = product;
  const url = `${BASE}/p/${id}.html`;
  const imageUrl = `${BASE}/${String(image).replace(/^\/+/, '')}`;
  const desc = metaDescription(description);
  const rate = SHIPPING_RATES[brand] || 25;
  const guide = guideFor(title);
  const isPeptide = String(type).toLowerCase() === 'peptide';

  // An unescaped "</script>" inside any string would terminate the JSON-LD
  // block early and inject live markup. Escaping "<" makes that impossible
  // while remaining valid JSON.
  const jsonSafe = obj => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');

  const jsonLd = jsonSafe({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title,
    description: desc,
    image: imageUrl,
    brand: { '@type': 'Brand', name: brand },
    category: type,
    url,
    offers: {
      '@type': 'Offer',
      price: price.toFixed(2),
      priceCurrency: 'USD',
      url,
      availability: 'https://schema.org/InStock',
    },
  });

  const guideLink = guide
    ? `<p class="mt-3"><a href="/${guide}">Read the ${escapeHtml(title)} guide</a></p>`
    : '';
  const calcLink = isPeptide
    ? `<p class="mt-2"><a href="/peptide-calculator.html">Work out your dose with the peptide calculator</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>${escapeHtml(title)} — ${escapeHtml(brand)} | GOD MUSCLE GEARS</title>
<meta name="description" content="${escapeHtml(desc)}"/>
<meta name="robots" content="index, follow"/>
<link rel="canonical" href="${url}"/>
<meta property="og:type" content="product"/>
<meta property="og:site_name" content="GOD MUSCLE GEARS"/>
<meta property="og:title" content="${escapeHtml(title)} — ${escapeHtml(brand)}"/>
<meta property="og:description" content="${escapeHtml(desc)}"/>
<meta property="og:image" content="${imageUrl}"/>
<meta property="og:url" content="${url}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(title)} — ${escapeHtml(brand)}"/>
<meta name="twitter:description" content="${escapeHtml(desc)}"/>
<meta name="twitter:image" content="${imageUrl}"/>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"/>
<link href="/style.css" rel="stylesheet"/>
<script type="application/ld+json">
${jsonLd}
</script>
</head>
<body>
${chrome.nav}
<main class="container py-4">
<nav aria-label="Breadcrumb" class="mb-3"><a href="/products.html">&larr; All products</a></nav>
<div class="row g-4">
<div class="col-12 col-md-6">
<div class="card" data-brand="${escapeHtml(brand)}" data-type="${escapeHtml(type)}">
<img alt="${escapeHtml(title)}" class="card-img-top" src="/${String(image).replace(/^\/+/, '')}"/>
<div class="card-body">
<h1 class="card-title h3">${escapeHtml(title)}</h1>
<p class="card-text">${escapeHtml(description)}</p>
<span class="fw-bold" data-price-for="${escapeHtml(id)}">$${price.toFixed(2)}</span>
<button class="add-to-cart" data-id="${escapeHtml(id)}" data-image="${escapeHtml(image)}" data-name="${escapeHtml(cartName)}" data-price="${price.toFixed(2)}">Add to Cart</button>
<button type="button" class="share-btn btn btn-outline-secondary btn-sm ms-2" data-share-url="${url}" data-share-title="${escapeHtml(title)}" aria-label="Share ${escapeHtml(title)}">Share</button>
</div>
</div>
</div>
<div class="col-12 col-md-6">
<h2 class="h5">Product details</h2>
<ul class="list-unstyled">
<li><strong>Brand:</strong> ${escapeHtml(brand)}</li>
<li><strong>Type:</strong> ${escapeHtml(type)}</li>
</ul>
<h2 class="h5 mt-4">Shipping</h2>
<p>${escapeHtml(brand)} items ship as their own package at <strong>$${rate}</strong> per 10 units. Brands ship separately, so an order spanning brands arrives in more than one package. Discreet USA shipping, 4&ndash;7 days, with a reship guarantee.</p>
<h2 class="h5 mt-4">Payment</h2>
<p>USDT (TRC-20), Bitcoin, or bank transfer.</p>
${guideLink}
${calcLink}
</div>
</div>
</main>
${chrome.footer}
${chrome.scripts}
</body>
</html>
`;
}

module.exports = { renderProductPage, escapeHtml, metaDescription, SHIPPING_RATES, BASE };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/product-page-template.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 5: Mutation-test the escaping**

Temporarily delete the `.replace(/"/g, '&quot;')` line from `escapeHtml`.

Run: `node --test tests/product-page-template.test.js`
Expected: FAIL on "quotes in the description never break out of a meta attribute". If it PASSES, the escaping test is not actually testing anything — fix the test before continuing.

Restore the line and re-run. Expected: PASS.

- [ ] **Step 6: Run the whole suite**

Run: `node --test tests/*.test.js`
Expected: PASS, 176 tests.

- [ ] **Step 7: Commit**

```bash
git add product-page-template.js tests/product-page-template.test.js
git commit -m "Render a product page from a product object

Pure renderer, so escaping is testable in isolation. Descriptions contain
ampersands and quote characters that would otherwise break out of meta
attributes and corrupt the JSON-LD; the escaping is mutation-tested rather
than merely asserted.

The card markup deliberately matches products.html so initInventorySync
finds it with no changes, which is what gives product pages the stock
thresholds and the hold for free.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Share button behaviour and runtime price refresh

**Files:**
- Modify: `script.js` — add `initShareButtons()` and `refreshPrices()`, call both from the existing init block near the add-to-cart binding (around line 1323)
- Test: manual browser verification (this is DOM/clipboard code; the repo has no DOM test harness, and adding one is out of scope)

**Interfaces:**
- Consumes: `FEATURED_CATALOG` (already defined in `script.js`).
- Produces:
  - `initShareButtons()`, bound to any `.share-btn` carrying `data-share-url` and `data-share-title`.
  - `refreshPrices()`, which rewrites any `[data-price-for]` element from `FEATURED_CATALOG`.

- [ ] **Step 1: Add the function**

Insert into `script.js`, immediately above the `MANUAL HOLD` block:

```js
// ─────────────────────────────────────────────
// SHARE BUTTONS
// ─────────────────────────────────────────────
// navigator.share is the mobile path — it opens the OS sheet, which is how a
// product reaches WhatsApp or Telegram. Desktop browsers mostly lack it, so
// the fallback copies the link. Never disabled: sharing is not buying, so a
// held or out-of-stock product stays shareable.

function initShareButtons() {
  const buttons = document.querySelectorAll('.share-btn');
  if (!buttons.length) return;

  async function copy(text) {
    // navigator.clipboard needs a secure context; fall back for the rest.
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  function flash(btn, message) {
    const original = btn.dataset.originalLabel || btn.textContent;
    btn.dataset.originalLabel = original;
    btn.textContent = message;
    setTimeout(() => { btn.textContent = btn.dataset.originalLabel; }, 1800);
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.shareUrl;
      const title = btn.dataset.shareTitle || 'GOD MUSCLE GEARS';
      if (!url) return;

      if (navigator.share) {
        try {
          await navigator.share({ title, text: title, url });
          return;
        } catch (err) {
          // AbortError means the user dismissed the sheet — not a failure,
          // and copying afterwards would be surprising.
          if (err && err.name === 'AbortError') return;
        }
      }

      try {
        await copy(url);
        flash(btn, 'Link copied');
      } catch (err) {
        console.error('Share failed:', err);
        flash(btn, 'Copy failed');
      }
    });
  });
}
```

- [ ] **Step 2: Add the price refresh**

Insert directly below `initShareButtons()`:

```js
// A generated product page bakes the price into its HTML so crawlers and
// no-JS visitors see one. That copy goes stale the moment a price changes
// and the pages are not regenerated, so refresh it from FEATURED_CATALOG —
// the same source the cart charges from. Baked value is only a fallback.

function refreshPrices() {
  const targets = document.querySelectorAll('[data-price-for]');
  if (!targets.length) return;

  const prices = {};
  FEATURED_CATALOG.forEach(p => { prices[p.id.toLowerCase()] = p.price; });

  targets.forEach(el => {
    const price = prices[(el.dataset.priceFor || '').trim().toLowerCase()];
    if (typeof price !== 'number') return;
    el.textContent = '$' + price.toFixed(2);

    // Keep the buy button in step, or the cart would charge the baked price.
    const button = el.closest('.card')?.querySelector('.add-to-cart');
    if (button) button.dataset.price = price.toFixed(2);
  });
}
```

- [ ] **Step 3: Call both from init**

In the init block, immediately after the add-to-cart binding loop that ends with `fresh.addEventListener('click', function () { addToCart(this); });`, add:

```js
  initShareButtons();
  refreshPrices();
```

- [ ] **Step 4: Verify syntax and the suite**

Run: `node --check script.js`
Expected: no output.

Run: `node --test tests/*.test.js`
Expected: PASS, 176 tests (unchanged — this is DOM code).

- [ ] **Step 5: Commit**

```bash
git add script.js
git commit -m "Add share buttons and refresh baked prices at runtime

navigator.share where available, clipboard copy otherwise. A dismissed
share sheet raises AbortError, which is a user choice rather than a
failure, so it must not fall through to copying.

Share is never disabled on held or out-of-stock products: sharing is not
buying, and a link to a restocked product is still useful.

Generated pages bake a price so crawlers and no-JS visitors see one, but a
baked copy goes stale as soon as a price changes and the pages are not
regenerated. refreshPrices rewrites it from FEATURED_CATALOG, and updates
the buy button too — otherwise the cart would charge the stale number.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Build CLI and three sample pages — **USER REVIEW GATE**

**Files:**
- Create: `build-product-pages.js`
- Test: `tests/build-product-pages.test.js`
- Create (generated): `p/testc250mg.html`, `p/sixpex-bpc157.html`, `p/xeno-proviron.html`

**Interfaces:**
- Consumes: `parseProducts`, `checkPriceParity` from `product-data.js`; `renderProductPage` from `product-page-template.js`.
- Produces:
  - `extractChrome(html)` → `{nav, footer, scripts}`
  - `toRootRelative(html)` → string, rewriting document-relative URLs to root-relative
  - `buildSitemap(existingXml, ids)` → string
  - CLI: `node build-product-pages.js [--only id1,id2]`

- [ ] **Step 1: Write the failing tests**

Create `tests/build-product-pages.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractChrome, toRootRelative, buildSitemap } = require('../build-product-pages.js');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'products.html'), 'utf8');

test('extracts nav, footer and script tags from products.html', () => {
  const chrome = extractChrome(html);
  assert.ok(chrome.nav.startsWith('<nav'));
  assert.ok(chrome.nav.trimEnd().endsWith('</nav>'));
  assert.ok(chrome.footer.startsWith('<footer'));
  assert.ok(chrome.footer.trimEnd().endsWith('</footer>'));
  assert.ok(chrome.scripts.includes('script.js'));
  assert.ok(chrome.scripts.includes('shipping.js'));
  assert.ok(chrome.scripts.includes('chat-widget.js'));
});

test('rewrites document-relative URLs to root-relative', () => {
  assert.equal(toRootRelative('<a href="cart.html">'), '<a href="/cart.html">');
  assert.equal(toRootRelative('<img src="images/x.jpg">'), '<img src="/images/x.jpg">');
  assert.equal(toRootRelative('<script src="script.js">'), '<script src="/script.js">');
});

test('leaves absolute, anchor, mailto and tel URLs alone', () => {
  const untouched = [
    '<a href="https://t.me/Godmusclegears">',
    '<a href="//cdn.example.com/x.js">',
    '<a href="#top">',
    '<a href="mailto:admin@example.com">',
    '<a href="tel:+10000000000">',
    '<a href="/already-root.html">',
  ];
  for (const s of untouched) assert.equal(toRootRelative(s), s);
});

test('sitemap keeps the existing URLs and adds one per product', () => {
  const existing = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const before = (existing.match(/<loc>/g) || []).length;
  const out = buildSitemap(existing, ['aaa', 'bbb']);
  assert.ok(out.includes('<loc>https://godmusclegears.com/products.html</loc>'));
  assert.ok(out.includes('<loc>https://godmusclegears.com/p/aaa.html</loc>'));
  assert.equal((out.match(/<loc>/g) || []).length, before + 2);
});

test('sitemap generation is idempotent', () => {
  const existing = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const once = buildSitemap(existing, ['aaa', 'bbb']);
  const twice = buildSitemap(once, ['aaa', 'bbb']);
  assert.equal(once, twice);
});

test('sitemap drops product entries that no longer exist', () => {
  const existing = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const withOld = buildSitemap(existing, ['gone']);
  const rebuilt = buildSitemap(withOld, ['kept']);
  assert.ok(!rebuilt.includes('/p/gone.html'));
  assert.ok(rebuilt.includes('/p/kept.html'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/build-product-pages.test.js`
Expected: FAIL — `Cannot find module '../build-product-pages.js'`

- [ ] **Step 3: Write the implementation**

Create `build-product-pages.js`:

```js
// Build-time CLI. The only module here that touches disk.
//   node build-product-pages.js                 regenerate every product page
//   node build-product-pages.js --only a,b      regenerate just those ids
// Generated pages are artifacts: never hand-edit one, regenerate it.

const fs = require('node:fs');
const path = require('node:path');
const { parseProducts, checkPriceParity } = require('./product-data.js');
const { renderProductPage, BASE } = require('./product-page-template.js');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'p');

function extractChrome(html) {
  const nav = /<nav[^>]*class="navbar[\s\S]*?<\/nav>/.exec(html);
  const footer = /<footer[\s\S]*?<\/footer>/.exec(html);
  const scripts = [...html.matchAll(/<script src="(?!http)[^"]*"><\/script>/g)].map(m => m[0]);
  const bootstrap = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap[^"]*"><\/script>/.exec(html);

  if (!nav) throw new Error('could not find <nav class="navbar"> in products.html');
  if (!footer) throw new Error('could not find <footer> in products.html');
  if (!scripts.length) throw new Error('could not find local <script src> tags in products.html');

  return {
    nav: toRootRelative(nav[0]),
    footer: toRootRelative(footer[0]),
    scripts: [bootstrap ? bootstrap[0] : '', ...scripts.map(toRootRelative)].filter(Boolean).join('\n'),
  };
}

// Pages live in /p/, so document-relative URLs inherited from products.html
// would resolve to /p/images/... and 404. Root-relative is stable wherever a
// page lives. Absolute, protocol-relative, anchor, mailto and tel are skipped.
function toRootRelative(html) {
  return html.replace(/\b(href|src)="(?!https?:|\/\/|\/|#|mailto:|tel:|data:)([^"]*)"/g, '$1="/$2"');
}

function buildSitemap(existingXml, ids) {
  const kept = [...existingXml.matchAll(/<url>[\s\S]*?<\/url>/g)]
    .map(m => m[0])
    .filter(block => !/<loc>[^<]*\/p\/[^<]*<\/loc>/.test(block));

  const today = new Date().toISOString().slice(0, 10);
  const added = ids.map(id =>
    `<url><loc>${BASE}/p/${id}.html</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...kept,
    ...added,
    '</urlset>',
    '',
  ].join('\n');
}

function main() {
  const html = fs.readFileSync(path.join(ROOT, 'products.html'), 'utf8');
  const scriptJs = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

  const parity = checkPriceParity(html, scriptJs);
  if (!parity.ok) {
    console.error('Price parity check FAILED. products.html and FEATURED_CATALOG disagree:');
    parity.problems.forEach(p => console.error('  ' + p));
    process.exit(1);
  }

  const all = parseProducts(html);
  if (!all.length) { console.error('No products parsed — aborting.'); process.exit(1); }

  const onlyArg = process.argv.indexOf('--only');
  const only = onlyArg === -1 ? null : new Set(process.argv[onlyArg + 1].split(',').map(s => s.trim()));
  const products = only ? all.filter(p => only.has(p.id)) : all;

  if (only) {
    const missing = [...only].filter(id => !all.some(p => p.id === id));
    if (missing.length) { console.error('Unknown ids: ' + missing.join(', ')); process.exit(1); }
  }

  const chrome = extractChrome(html);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const product of products) {
    fs.writeFileSync(path.join(OUT_DIR, `${product.id}.html`), renderProductPage(product, chrome), 'utf8');
  }

  // Only rewrite the sitemap on a full build; a partial run must not delete
  // the entries for pages it did not regenerate.
  if (!only) {
    const sitemapPath = path.join(ROOT, 'sitemap.xml');
    const existing = fs.readFileSync(sitemapPath, 'utf8');
    fs.writeFileSync(sitemapPath, buildSitemap(existing, all.map(p => p.id)), 'utf8');
    console.log(`sitemap.xml rewritten with ${all.length} product URLs`);
  }

  console.log(`Wrote ${products.length} page(s) to p/`);
}

if (require.main === module) main();

module.exports = { extractChrome, toRootRelative, buildSitemap };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/build-product-pages.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Generate the three sample pages**

Run: `node build-product-pages.js --only testc250mg,sixpex-bpc157,xeno-proviron`
Expected: `Wrote 3 page(s) to p/` and no sitemap line.

Confirm: `ls p/` shows exactly three files.

- [ ] **Step 6: Verify in a browser**

Start a server (do NOT rely on `.claude/launch.json` — the harness caches its config per preview, and a stale path will 404 on everything):

```bash
npx -y http-server . -p 8901 -c-1 --silent
```

Then check each of these and record the result:

1. `http://127.0.0.1:8901/p/testc250mg.html` — renders, nav and footer present, image loads, price shows $63.84, console clean
2. Stock state reflects the sheet (this product had 706 in stock)
2b. Price refresh works: in the console, confirm the visible price and the button's `data-price` agree with `FEATURED_CATALOG`. Then edit the baked `<span data-price-for=...>` in the file to `$1.00`, reload, and confirm it displays the real price again — proving the runtime refresh, not the baked value, is what the customer sees. Revert the edit afterwards.
3. `http://127.0.0.1:8901/p/xeno-proviron.html` — **button reads "Out of Stock" and is disabled.** This is the blocking check: a product page that bypassed `HELD_PRODUCTS` would undo the 2026-09-30 fix
4. Share button on that held page is **enabled** and copies the URL
5. Add to Cart on `testc250mg` adds one item, and the cart records brand `Beligas`
6. `http://127.0.0.1:8901/p/sixpex-bpc157.html` — shows the peptide calculator link and `$25` shipping
7. 375px width: no horizontal overflow
8. All nav and footer links resolve (no `/p/cart.html` style 404s in the server log)

- [ ] **Step 7: Commit**

```bash
git add build-product-pages.js tests/build-product-pages.test.js p/
git commit -m "Generate product pages, and three samples for review

The CLI refuses to build when products.html and FEATURED_CATALOG disagree
on a price, so 133 pages can never be generated from a contradiction.

Pages live in /p/, so URLs inherited from products.html are rewritten
root-relative — document-relative ones would resolve to /p/images/... and
404. A partial --only run deliberately leaves the sitemap alone, so it
cannot delete entries for pages it did not regenerate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: STOP — user review gate**

Show Lester the three pages and the browser findings. Do not generate the remaining 130 until he has approved the template. Settling the template before multiplying it by 133 is the entire point of this split.

---

### Task 5: Generate all 133 pages

**Files:**
- Create (generated): `p/*.html` × 133
- Modify: `sitemap.xml`

**Interfaces:**
- Consumes: the CLI from Task 4.
- Produces: the full page set.

- [ ] **Step 1: Apply any template changes Lester asked for**

If he requested changes, edit `product-page-template.js`, update the affected tests in `tests/product-page-template.test.js`, and re-run `node --test tests/*.test.js` before continuing. If he approved as-is, skip.

- [ ] **Step 2: Generate everything**

Run: `node build-product-pages.js`
Expected: `sitemap.xml rewritten with 133 product URLs` and `Wrote 133 page(s) to p/`.

- [ ] **Step 3: Verify the output**

Run: `ls p/*.html | wc -l`
Expected: `133`

Run: `grep -c "<loc>" sitemap.xml`
Expected: `146`

Run: `grep -L "add-to-cart" p/*.html`
Expected: no output — every page has a buy button.

Run: `grep -l "og:image" p/*.html | wc -l`
Expected: `133`

- [ ] **Step 4: Confirm generation is idempotent**

```bash
node build-product-pages.js && git status --porcelain p/ sitemap.xml
```
Expected: only `sitemap.xml` may differ, and only if the date changed. If a `p/*.html` file shows as modified after a second identical run, the generator is not deterministic — fix that before committing.

- [ ] **Step 5: Spot-check three pages not among the samples**

Open `p/sustanon400mg.html`, `p/sixpex-testopex-c200.html` and `p/xeno-clomiphene.html` in the browser. Confirm `xeno-clomiphene` is **disabled** (the second held product) and the other two render correctly.

- [ ] **Step 6: Run the whole suite**

Run: `node --test tests/*.test.js`
Expected: PASS, 182 tests.

- [ ] **Step 7: Commit**

```bash
git add p/ sitemap.xml
git commit -m "Generate all 133 product pages

Each product now has a stable URL that previews as itself when pasted into
a chat. Sitemap grows from 13 to 146 URLs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Share buttons on the cards, config and docs

**Files:**
- Modify: `products.html` — a share button in each of the 133 cards
- Modify: `_config.yml`
- Modify: `docs/INVENTORY-SYNC.md`
- Create: `add-card-share-buttons.js` (one-shot edit script; delete after use)

**Interfaces:**
- Consumes: `.share-btn` handling from Task 3; the `/p/<id>.html` URLs from Task 5.
- Produces: no new interface.

This comes last on purpose: card share buttons must not link to pages that do not exist yet.

- [ ] **Step 1: Write the one-shot edit script**

Create `add-card-share-buttons.js` with the Write tool (not a heredoc — it contains regexes and backslashes):

```js
// One-shot: adds a share button beside every Add to Cart in products.html.
// Delete this file after running it. Idempotent: re-running changes nothing.
const fs = require('node:fs');
const { parseProducts } = require('./product-data.js');
const { escapeHtml, BASE } = require('./product-page-template.js');

const FILE = 'products.html';
const html = fs.readFileSync(FILE, 'utf8');

let added = 0, skipped = 0;
let out = html;
for (const p of parseProducts(html)) {
  const btn = new RegExp(`(<button class="add-to-cart"[^>]*data-id="${p.id}"[^>]*>Add to Cart</button>)`);
  const m = btn.exec(out);
  if (!m) { console.error('no button for ' + p.id); process.exit(1); }
  if (out.slice(m.index, m.index + 400).includes(`data-share-url="${BASE}/p/${p.id}.html"`)) { skipped++; continue; }
  const share = `<button type="button" class="share-btn" data-share-url="${BASE}/p/${p.id}.html" data-share-title="${escapeHtml(p.title)}" aria-label="Share ${escapeHtml(p.title)}" title="Share">&#128279;</button>`;
  out = out.slice(0, m.index + m[0].length) + share + out.slice(m.index + m[0].length);
  added++;
}
fs.writeFileSync(FILE, out, 'utf8');
console.log(`added ${added}, already present ${skipped}`);
```

- [ ] **Step 2: Run it**

Run: `node add-card-share-buttons.js`
Expected: `added 133, already present 0`

- [ ] **Step 3: Verify idempotence, then card count**

Run: `node add-card-share-buttons.js`
Expected: `added 0, already present 133`

Run: `grep -c "share-btn" products.html`
Expected: `133`

Run: `node --test tests/*.test.js`
Expected: PASS, 182 tests — the parser must still find all 133 cards after the edit.

- [ ] **Step 4: Style the card share button**

Add to `style.css`:

```css
.share-btn {
  background: none;
  border: 1px solid var(--grey, #6b7280);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  margin-left: .4rem;
  padding: .35rem .5rem;
}
.share-btn:hover,
.share-btn:focus-visible { border-color: var(--orange, #ff4500); }
```

- [ ] **Step 5: Verify in the browser**

With the server from Task 4 running, open `http://127.0.0.1:8901/products.html`:

1. Every card shows a share icon beside Add to Cart
2. The grid still lays out correctly at 375px — no card reflow or overflow
3. Clicking a share icon copies that product's URL (check the clipboard, and that the label flashes "Link copied")
4. The share icon on **Proviron** is enabled even though Add to Cart is disabled
5. Console clean

- [ ] **Step 6: Delete the one-shot script**

```bash
rm add-card-share-buttons.js
```

- [ ] **Step 7: Update `_config.yml`**

Under the "Node modules that mirror the n8n Code nodes" exclusions, add the three build modules — they are build tooling and must not be published:

```yaml
  - product-data.js
  - product-page-template.js
  - build-product-pages.js
```

Confirm `p/` is **not** excluded anywhere in the file. If it is, the pages will 404 in production.

- [ ] **Step 8: Update `docs/INVENTORY-SYNC.md`**

In the "Adding a product to the site — four parts, not two" section, change the heading to **five parts** and add:

```markdown
5. **regenerate the product pages** — `node build-product-pages.js` — so the
   new product gets its own shareable page and a sitemap entry
```

In the re-key section, note that re-keying also changes the product's public
URL, so any link already shared for the old id will 404.

- [ ] **Step 9: Run the full suite and commit**

```bash
node --test tests/*.test.js
git add products.html style.css _config.yml docs/INVENTORY-SYNC.md
git commit -m "Add share buttons to product cards; exclude build tooling

Card buttons come last so they never link to pages that do not exist yet.

Adding a product is now a five-part change: regenerating the pages is the
fifth. Re-keying also changes a product's public URL, so previously shared
links break — noted in the doc.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Push**

```bash
git push origin main
```

Then confirm on the live site once Pages rebuilds (1–2 minutes):

1. `https://godmusclegears.com/p/testc250mg.html` loads
2. Paste that URL into a Telegram chat and confirm the preview shows the product image and name — this is the whole point of the feature, so verify it rather than assuming
3. `https://godmusclegears.com/sitemap.xml` shows 146 URLs

---

## Notes for the implementer

- **The held-product check in Task 4 Step 6.3 is blocking.** If `p/xeno-proviron.html` renders an enabled Add to Cart, stop and fix it before generating 130 more pages with the same defect.
- **Never hand-edit a file in `p/`.** Change the template and regenerate.
- **Task 4 ends at a user gate.** Do not continue to Task 5 without approval.
- If `extractChrome` throws, `products.html` markup has moved. Fix the selector; do not hardcode a copy of the nav, or it will drift.
