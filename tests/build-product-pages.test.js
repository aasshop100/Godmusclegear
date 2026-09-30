const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractChrome, toRootRelative, buildSitemap, validateProducts } = require('../build-product-pages.js');

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
  // Count only the non-product URLs: once pages are generated, the live sitemap
  // already holds /p/ entries, which buildSitemap replaces rather than keeps.
  const before = (existing.match(/<loc>(?!https:\/\/godmusclegears\.com\/p\/)/g) || []).length;
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

test('validateProducts accepts well-formed products, including mixed-case domId', () => {
  assert.deepEqual(validateProducts([
    { id: 'testc250mg', domId: 'testc250mg' },
    { id: 'dhb1testc100mg', domId: 'dhb1TestC100mg' },
  ]), []);
});

test('validateProducts flags missing, empty, and mismatched ids', () => {
  const bad = validateProducts([
    { id: 'nodom' },
    { id: 'emptydom', domId: '' },
    { id: '', domId: 'NoId' },
    { id: 'wrong', domId: 'Other' },
    { id: 'fine', domId: 'fine' },
  ]);
  assert.equal(bad.length, 4);
  assert.ok(!bad.includes('fine'));
  assert.ok(bad.includes('nodom'));
  assert.ok(bad.includes('wrong'));
});

test('the real catalog passes validateProducts', () => {
  const { parseProducts } = require('../product-data.js');
  assert.deepEqual(validateProducts(parseProducts(html)), []);
});
