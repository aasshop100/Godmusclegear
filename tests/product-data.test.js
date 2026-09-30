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
