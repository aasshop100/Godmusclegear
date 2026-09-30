// Build-time only. Renders one product page. Pure: no fs, no DOM.
// Excluded from the published site.

const { guideFor, isPeptideProduct } = require('./product-data.js');

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

// The single definition of the share icon button. Used by the product page
// template and by the products.html card editing script.
function shareButtonHtml({ url, title }) {
  return `<button type="button" class="share-btn" data-share-url="${escapeHtml(url)}" data-share-title="${escapeHtml(title)}" aria-label="Share ${escapeHtml(title)}" title="Copy link"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>`;
}

function renderProductPage(product, chrome) {
  // id is lowercase and used for the URL. domId keeps the exact casing of the
  // products.html grid card and is used for markup: addToCart dedupes on an
  // exact string match, so a differing case would create a second cart line.
  const { id, domId, title, cartName, description, image, price, brand, type } = product;
  const url = `${BASE}/p/${id}.html`;
  const imageUrl = `${BASE}/${String(image).replace(/^\/+/, '')}`;
  const desc = metaDescription(description);
  const rate = SHIPPING_RATES[brand] || 25;
  const guide = guideFor(title);
  const isPeptide = isPeptideProduct(title);

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
      // availability is deliberately omitted: stock is only known at runtime
      // (fetched from the sheet), so the build cannot state it truthfully.
    },
  });

  // .product-link is what makes these read as links. Without it they inherit the
  // body colour with no underline and are indistinguishable from plain text.
  const guideLink = guide
    ? `<p class="mt-3"><a class="product-link" href="/${guide}">Read the ${escapeHtml(title)} guide &rarr;</a></p>`
    : '';
  const calcLink = isPeptide
    ? `<p class="mt-2"><a class="product-link" href="/peptide-calculator.html">Work out your dose with the peptide calculator &rarr;</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>${escapeHtml(title)} — ${escapeHtml(brand)} | GOD MUSCLE GEARS</title>
<meta name="description" content="${escapeHtml(desc)}"/>
<meta name="robots" content="index, follow"/>
<link rel="canonical" href="${escapeHtml(url)}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="GOD MUSCLE GEARS"/>
<meta property="og:title" content="${escapeHtml(title)} — ${escapeHtml(brand)}"/>
<meta property="og:description" content="${escapeHtml(desc)}"/>
<meta property="og:image" content="${escapeHtml(imageUrl)}"/>
<meta property="og:image:alt" content="${escapeHtml(title)}"/>
<meta property="og:url" content="${escapeHtml(url)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(title)} — ${escapeHtml(brand)}"/>
<meta name="twitter:description" content="${escapeHtml(desc)}"/>
<meta name="twitter:image" content="${escapeHtml(imageUrl)}"/>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"/>
<link href="/style.css" rel="stylesheet"/>
<link href="/images/logo.png" rel="icon" type="image/png"/>
<!-- Google Analytics — loads only after cookie consent -->
<script>
  if (localStorage.getItem('cookieConsent') === 'accepted') {
    var _ga = document.createElement('script');
    _ga.src = 'https://www.googletagmanager.com/gtag/js?id=G-23E1P2PH58';
    _ga.async = true;
    document.head.appendChild(_ga);
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-23E1P2PH58');
  }
</script>
<script type="application/ld+json">
${jsonLd}
</script>
</head>
<body>
${chrome.nav}
<main class="container py-4">
<nav aria-label="Breadcrumb" class="mb-3"><a class="product-link" href="/products.html">&larr; All products</a></nav>
<div class="row g-4">
<div class="col-12 col-md-6">
<div class="card" data-brand="${escapeHtml(brand)}" data-type="${escapeHtml(type)}">
<img alt="${escapeHtml(title)}" class="card-img-top" src="/${escapeHtml(String(image).replace(/^\/+/, ''))}"/>
<div class="card-body">
<h1 class="card-title h3">${escapeHtml(title)}</h1>
<p class="card-text">${escapeHtml(description)}</p>
<div class="price-row">
<span class="fw-bold" data-price-for="${escapeHtml(domId)}">$${price.toFixed(2)}</span>
${shareButtonHtml({ url, title })}
</div>
<button class="add-to-cart" data-id="${escapeHtml(domId)}" data-image="${escapeHtml(image)}" data-name="${escapeHtml(cartName)}" data-price="${price.toFixed(2)}">Add to Cart</button>
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

module.exports = { renderProductPage, shareButtonHtml, escapeHtml, metaDescription, SHIPPING_RATES, BASE };
