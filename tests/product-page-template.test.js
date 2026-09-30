const test = require('node:test');
const assert = require('node:assert/strict');
const { renderProductPage, escapeHtml, metaDescription, SHIPPING_RATES } = require('../product-page-template.js');

const CHROME = { nav: '<nav>NAV</nav>', footer: '<footer>FOOT</footer>', scripts: '<script src="/script.js"></script>' };

const PRODUCT = {
  id: 'testc250mg',
  domId: 'testc250mg',
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

test('markup uses domId (case preserved) while the URL uses the lowercase id', () => {
  // addToCart does not normalise case and dedupes on exact string match, so the
  // button must carry the same casing as the products.html grid card.
  const mixed = { ...PRODUCT, id: 'dhb1testc100mg', domId: 'dhb1TestC100mg' };
  const out = renderProductPage(mixed, CHROME);
  assert.ok(out.includes('data-id="dhb1TestC100mg"'), 'button data-id lost its casing');
  assert.ok(out.includes('data-price-for="dhb1TestC100mg"'), 'price span lost its casing');
  assert.ok(!out.includes('data-id="dhb1testc100mg"'), 'lowercase id leaked into the button');
  assert.ok(!out.includes('data-price-for="dhb1testc100mg"'), 'lowercase id leaked into the price span');
  assert.ok(out.includes('content="https://godmusclegears.com/p/dhb1testc100mg.html"'));
  assert.ok(out.includes('<link rel="canonical" href="https://godmusclegears.com/p/dhb1testc100mg.html"/>'));
  assert.ok(out.includes('data-share-url="https://godmusclegears.com/p/dhb1testc100mg.html"'));
  assert.ok(!out.includes('/p/dhb1TestC100mg'), 'mixed-case id leaked into a URL');
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
  assert.ok(/<button type="button"[^>]*class="share-btn[ "]/.test(out));
  assert.ok(out.includes('data-share-url="https://godmusclegears.com/p/testc250mg.html"'));
  assert.ok(/aria-label="Share Testosterone Cypionate, 250mg"/.test(out));
  assert.ok(!/class="share-btn[ "][^>]*disabled/.test(out));
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
