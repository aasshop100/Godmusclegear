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

// An empty data-id makes addToCart fall back to a name-derived id (wrong id at
// checkout), so refuse to render any product without a consistent id/domId.
// Returns the offending ids (empty array when everything is valid).
function validateProducts(products) {
  return products
    .filter(p => {
      const id = p && typeof p.id === 'string' ? p.id : '';
      const domId = p && typeof p.domId === 'string' ? p.domId : '';
      return !id || !domId || id !== domId.toLowerCase();
    })
    .map(p => (p && p.id) || (p && p.domId) || '(no id)');
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

  const invalid = validateProducts(products);
  if (invalid.length) {
    console.error('Refusing to render: products missing a valid id/domId (id must equal domId lowercased):');
    invalid.forEach(id => console.error('  ' + id));
    process.exit(1);
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

module.exports = { extractChrome, toRootRelative, buildSitemap, validateProducts };
