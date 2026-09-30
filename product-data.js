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
      // id is for URLs and filenames (always lowercase). domId must match the
      // data-id in products.html exactly, because addToCart dedupes cart lines
      // case-sensitively; a case mismatch would split one product into two lines.
      id: btn[1].trim().toLowerCase(),
      domId: btn[1].trim(),
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
