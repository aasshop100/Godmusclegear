// script.js — GOD MUSCLE GEARS
// Cleaned: merged duplicate DOMContentLoaded blocks, fixed `email` variable bug,
//          removed duplicate freeShippingCodes declaration, consolidated init.

// ─────────────────────────────────────────────
// MAINTENANCE MODE
// ─────────────────────────────────────────────
// Flip to false and push to lift it. GitHub Pages rebuilds in ~1-2 minutes.
//
// Deliberately lives in script.js, which is loaded by the 10 storefront pages
// but NOT by order-success.html. That means a customer who already placed an
// order and is looking at their payment address is never blocked, without
// needing a page-name exception.
//
// Browsing stays open and checkout is hard-blocked, rather than sealing the
// whole site: a customer who can still see products and reach Telegram is a
// sale deferred, one who hits a wall is a sale lost. It also keeps the pages
// intact for anything crawling during the window.
//
// Staff bypass: append ?staff=1 to any URL. It persists for the tab, so the
// live end-to-end test can be run while customers still see the notice.
const MAINTENANCE_MODE = true;
const MAINTENANCE_MESSAGE = 'We are upgrading our order system. Browsing is open, but checkout is paused for the next hour or two.';

(function () {
  if (!MAINTENANCE_MODE) return;

  try {
    if (new URLSearchParams(location.search).get('staff') === '1') {
      sessionStorage.setItem('gmgStaff', '1');
    }
    if (sessionStorage.getItem('gmgStaff') === '1') return;   // staff: behave normally
  } catch (e) { /* private mode — fall through and show the notice */ }

  const onCheckout = /checkout\.html$/i.test(location.pathname);

  document.addEventListener('DOMContentLoaded', function () {
    const telegram = '<a href="https://t.me/Godmusclegears" style="color:#fff; text-decoration:underline; font-weight:700;">order via Telegram</a>';

    // Banner on every page, so nobody reaches checkout surprised.
    const bar = document.createElement('div');
    bar.style.cssText = 'position:relative; z-index:99999; background:#ff4500; color:#fff; padding:12px 44px 12px 16px; font-family:Arial,Helvetica,sans-serif; font-size:0.9rem; line-height:1.5; text-align:center;';
    bar.innerHTML = MAINTENANCE_MESSAGE + ' You can still ' + telegram + '.'
      + '<button type="button" aria-label="Dismiss" style="position:absolute; right:10px; top:8px; background:transparent; border:0; color:#fff; font-size:1.2rem; cursor:pointer; line-height:1;">&times;</button>';
    bar.querySelector('button').addEventListener('click', function () { bar.remove(); });
    document.body.insertBefore(bar, document.body.firstChild);

    if (!onCheckout) return;

    // Checkout is hard-blocked. Disabling the button alone would not do it —
    // the form can still be submitted by pressing Enter in a text field.
    const form = document.querySelector('form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }, true);
    }

    const btn = document.getElementById('placeOrderBtn')
      || (form && form.querySelector('button[type="submit"], .btn-custom'));
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Checkout paused — see above';
      btn.style.opacity = '0.6';
      btn.style.cursor = 'not-allowed';
    }

    const notice = document.createElement('div');
    notice.style.cssText = 'background:#fff3cd; border-left:5px solid #ff4500; padding:16px; margin:16px 0; font-family:Arial,Helvetica,sans-serif; font-size:0.95rem; line-height:1.6; color:#333;';
    notice.innerHTML = '<strong>Checkout is temporarily paused</strong><br>'
      + 'We are upgrading our order system and expect to be back within an hour or two. '
      + 'Your cart is saved. To order right now, message us on '
      + '<a href="https://t.me/Godmusclegears" style="color:#0088cc; font-weight:700;">Telegram @Godmusclegears</a> '
      + 'and we will take care of it personally.';
    if (btn && btn.parentElement) {
      btn.parentElement.insertBefore(notice, btn);
    } else if (form) {
      form.insertBefore(notice, form.firstChild);
    }
  });
})();

document.addEventListener('touchstart', function () {}, { passive: true });

let cart = JSON.parse(localStorage.getItem('cart')) || [];

// ─────────────────────────────────────────────
// CART UTILITIES
// ─────────────────────────────────────────────

function updateCartCount() {
  const cartData = JSON.parse(localStorage.getItem('cart')) || [];
  const total = cartData.reduce((sum, item) => sum + (item.quantity || 1), 0);

  const cartCountEl       = document.getElementById('cart-count');
  const floatingCartCount = document.getElementById('floating-cart-count');

  if (cartCountEl) {
    cartCountEl.textContent = total;
    cartCountEl.classList.remove('pop');
    void cartCountEl.offsetWidth;
    cartCountEl.classList.add('pop');
  }
  if (floatingCartCount) {
    floatingCartCount.textContent = total;
    floatingCartCount.classList.remove('pop');
    void floatingCartCount.offsetWidth;
    floatingCartCount.classList.add('pop');
  }
}

function showCartNotification(message) {
  const existing = document.querySelector('.cart-notification');
  if (existing) existing.remove();

  const notification = document.createElement('div');
  notification.className = 'cart-notification';
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => notification.classList.add('show'), 50);
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 400);
  }, 3000);
}

// ─────────────────────────────────────────────
// CART RENDER
// ─────────────────────────────────────────────

// Renders the per-brand shipping lines beneath a shipping total.
// Shared by the cart page and the checkout page. Pass null to clear.
function renderShippingBreakdown(containerEl, result) {
  if (!containerEl) return;

  if (!result || result.breakdown.length === 0) {
    containerEl.innerHTML = '';
    return;
  }

  const brandCount = result.breakdown.length;
  const parts = [];

  // Per-brand costs are only shown for multi-brand orders. On a single-brand
  // order the breakdown just restates the shipping total, and listing it as a
  // separate priced line reads as an extra charge rather than a component.
  if (brandCount > 1) {
    const inc = result.breakdown
      .map(row => `${row.brand} $${row.fee.toFixed(2)}`)
      .join(' · ');
    parts.push(
      `<div style="font-size:0.75rem;color:var(--grey);margin-top:4px;padding-left:10px;">
         Includes: ${inc}
       </div>`
    );
  }

  // Explain multiple parcels whenever there are any — including a single brand
  // that exceeds one package, where the fee would otherwise look unexplained.
  if (result.packageCount > 1) {
    const note = brandCount > 1
      ? `Ships in ${result.packageCount} separate packages — each brand ships on its own.`
      : `Ships in ${result.packageCount} separate packages.`;
    parts.push(
      `<div style="font-size:0.72rem;color:var(--grey);margin-top:6px;padding-left:10px;font-style:italic;">
         ${note}
       </div>`
    );
  }

  containerEl.innerHTML = parts.join('');
}

function updateCart() {
  updateCartCount();

  const cartItems  = document.getElementById('cart-items');
  const subtotalEl = document.getElementById('cart-subtotal');
  const shippingEl = document.getElementById('shipping-fee');
  const grandTotalEl = document.getElementById('cart-grand-total');
  const emptyMsg   = document.getElementById('empty-cart-message');

  if (!cartItems) return;

  let subtotal = 0;
  cartItems.innerHTML = '';

  if (cart.length === 0) {
    if (emptyMsg)      emptyMsg.style.display = 'block';
    if (subtotalEl)    subtotalEl.textContent = '$0.00';
    if (shippingEl)    shippingEl.textContent = '$0.00';
    if (grandTotalEl)  grandTotalEl.textContent = '$0.00';
    renderShippingBreakdown(document.getElementById('shipping-breakdown'), null);
    updateCheckoutButton();
    return;
  }

  if (emptyMsg) emptyMsg.style.display = 'none';

  cart.forEach((item, index) => {
    const itemPrice = Number(item.price) || 0;
    const quantity  = item.quantity || 1;
    const lineTotal = itemPrice * quantity;
    subtotal      += lineTotal;

    const imageSrc = item.image || 'images/default-supplement.png';

    cartItems.innerHTML += `
      <div class="card mb-3">
        <div class="card-body d-flex align-items-center flex-wrap gap-3">
          <img src="${imageSrc}" alt="${item.name}" class="img-thumbnail"
               style="width:80px;height:80px;object-fit:cover;border-radius:8px;">
          <div class="flex-grow-1">
            <h6 class="mb-1">${item.name}</h6>
            <p class="mb-1 text-muted">$${itemPrice.toFixed(2)} each</p>
          </div>
          <div class="d-flex align-items-center gap-2">
            <input type="number" class="form-control" value="${quantity}" min="1"
                   style="width:70px;" onchange="updateQuantity(${index}, this.value)">
            <strong>$${lineTotal.toFixed(2)}</strong>
            <button class="btn btn-danger btn-sm" onclick="removeFromCart(${index})">Remove</button>
          </div>
        </div>
      </div>`;
  });

  // Shipping is billed per brand — each brand ships as its own package.
  const shippingResult = computeShipping(cart, {
    freeShipping: localStorage.getItem('freeShipping') === 'true'
  });
  const shipping = shippingResult.total;

  // Apply percentage discount to subtotal only (not shipping)
  let discountedSubtotal = subtotal;
  const pctDiscount = parseInt(localStorage.getItem('percentageDiscount') || '0');
  let discountAmount = 0;
  if (pctDiscount > 0) {
    discountAmount = subtotal * (pctDiscount / 100);
    discountedSubtotal = subtotal - discountAmount;
  }

  const grandTotal = discountedSubtotal + shipping;
  if (subtotalEl)   subtotalEl.textContent   = pctDiscount > 0
    ? `$${subtotal.toFixed(2)} → $${discountedSubtotal.toFixed(2)} (-${pctDiscount}%)`
    : `$${subtotal.toFixed(2)}`;
  if (shippingEl)   shippingEl.textContent   = `$${shipping.toFixed(2)}`;
  renderShippingBreakdown(document.getElementById('shipping-breakdown'), shippingResult);
  if (grandTotalEl) grandTotalEl.textContent = `$${grandTotal.toFixed(2)}`;

  localStorage.setItem('cart', JSON.stringify(cart));
  updateCheckoutButton();
}

// ─────────────────────────────────────────────
// ADD / REMOVE / QUANTITY
// ─────────────────────────────────────────────

function addToCart(button) {
  const name  = button.dataset.name  || 'Unknown Item';
  const price = Number(button.dataset.price) || 0;
  const id    = button.dataset.id    || name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const image = button.dataset.image || 'images/default-supplement.png';

  // Brand lives on the product card, not the button — each brand ships separately,
  // so the cart has to remember which one this item came from.
  const card  = button.closest('[data-brand]');
  const brand = (card && card.getAttribute('data-brand')) || '';

  const existingItem = cart.find(item => item.id === id);
  if (existingItem) {
    existingItem.quantity = (existingItem.quantity || 1) + 1;
    if (!existingItem.brand && brand) existingItem.brand = brand;
  } else {
    cart.push({ id, name, price, quantity: 1, image, brand });
  }

  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartCount();
  updateCart();
  showCartNotification(`✅ ${name} added to cart!`);
}

function updateQuantity(index, newQty) {
  const qty = parseInt(newQty) || 1;
  if (qty < 1) { removeFromCart(index); return; }
  cart[index].quantity = qty;
  updateCart();
}

function removeFromCart(index) {
  cart.splice(index, 1);
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCart();
  updateCartCount();

  if (cart.length === 0) {
    localStorage.removeItem('appliedPromoCode');
    localStorage.removeItem('freeShipping');
    localStorage.removeItem('percentageDiscount');
    const promoMsg = document.getElementById('promo-message');
    if (promoMsg) { promoMsg.textContent = ''; promoMsg.style.opacity = 0; }
  }
}

// ─────────────────────────────────────────────
// CHECKOUT BUTTON STATE
// ─────────────────────────────────────────────

function updateCheckoutButton() {
  const checkoutBtn = document.querySelector('a.btn.btn-success.w-100');
  if (!checkoutBtn) return;

  const cartData = JSON.parse(localStorage.getItem('cart')) || [];
  if (cartData.length === 0) {
    checkoutBtn.classList.add('disabled');
    checkoutBtn.style.pointerEvents = 'none';
    checkoutBtn.style.opacity = '0.6';
    checkoutBtn.textContent = 'Cart is Empty';
  } else {
    checkoutBtn.classList.remove('disabled');
    checkoutBtn.style.pointerEvents = 'auto';
    checkoutBtn.style.opacity = '1';
    checkoutBtn.textContent = 'Checkout';
  }
}

// ─────────────────────────────────────────────
// CHECKOUT SUMMARY RENDER
// ─────────────────────────────────────────────

function renderCheckoutSummary() {
  const storedCart       = JSON.parse(localStorage.getItem('cart')) || [];
  const checkoutItemsEl  = document.getElementById('checkout-items-list');
  const subtotalEl       = document.getElementById('checkout-subtotal');
  const shippingEl       = document.getElementById('checkout-shipping');
  const grandTotalEl     = document.getElementById('checkout-grand-total');
  const itemsCountEl     = document.getElementById('checkout-items');

  if (!checkoutItemsEl) return;

  let subtotal = 0;
  let totalQuantity = 0;
  checkoutItemsEl.innerHTML = '';

  storedCart.forEach(item => {
    const itemPrice = Number(item.price) || 0;
    const quantity  = item.quantity || 1;
    const lineTotal = itemPrice * quantity;
    subtotal      += lineTotal;
    totalQuantity += quantity;

    const imageSrc = item.image || 'images/default-supplement.png';
    checkoutItemsEl.innerHTML += `
      <div class="d-flex align-items-center mb-2">
        <img src="${imageSrc}" class="img-thumbnail me-2" style="width:50px;height:50px;object-fit:cover;">
        <div class="ms-2">
          <h6 class="mb-0">${item.name}</h6>
          <small class="text-muted">Qty: ${quantity} | $${itemPrice.toFixed(2)} each</small>
        </div>
        <div class="ms-auto"><strong>$${lineTotal.toFixed(2)}</strong></div>
      </div><hr class="my-1">`;
  });

  const shippingResult = computeShipping(storedCart, {
    freeShipping: localStorage.getItem('freeShipping') === 'true'
  });
  const shipping = shippingResult.total;

  // Apply percentage discount to subtotal only
  const pctDiscount = parseInt(localStorage.getItem('percentageDiscount') || '0');
  let discountedSubtotal = subtotal;
  if (pctDiscount > 0) {
    discountedSubtotal = subtotal - (subtotal * (pctDiscount / 100));
  }

  const grandTotal = discountedSubtotal + shipping;
  if (itemsCountEl)  itemsCountEl.textContent  = totalQuantity;
  if (subtotalEl)    subtotalEl.textContent    = discountedSubtotal.toFixed(2);
  if (shippingEl)    shippingEl.textContent    = shipping.toFixed(2);
  renderShippingBreakdown(document.getElementById('checkout-shipping-breakdown'), shippingResult);
  if (grandTotalEl)  grandTotalEl.textContent  = grandTotal.toFixed(2);
}

// Alias used by some callers
function updateCheckoutSummary() { renderCheckoutSummary(); }

// ─────────────────────────────────────────────
// TELEGRAM ORDER NOTIFICATION (via Cloudflare Worker proxy)
// ─────────────────────────────────────────────

function sendTelegramNotification(orderId, fullName, phone, whatsapp, fullAddress, items, grandTotal, promoCode, discountLine, shipping, paymentMethod, shippingBreakdown, packageCount) {
  const WORKER_URL = 'https://gmg-telegram.beligas-crm.workers.dev';
  fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, fullName, phone, whatsapp, fullAddress, items, grandTotal, promoCode, discountLine, shipping, paymentMethod, shippingBreakdown, packageCount })
  }).catch(() => {}); // fire-and-forget — never blocks the order
}

// ─────────────────────────────────────────────
// CHECKOUT SUBMIT (order + emails handled by n8n)
// ─────────────────────────────────────────────

async function handleCheckoutSubmit(event) {
  event.preventDefault();

  const placeOrderBtn = document.querySelector('.place-order-btn');
  // Captured before the spinner overwrites it, so every bail-out below puts
  // the real label back rather than a guess at what it said.
  const originalBtnHtml = placeOrderBtn ? placeOrderBtn.innerHTML : '';
  const releaseButton = () => {
    if (placeOrderBtn) { placeOrderBtn.disabled = false; placeOrderBtn.innerHTML = originalBtnHtml; }
  };
  if (placeOrderBtn) {
    placeOrderBtn.disabled = true;
    placeOrderBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Processing Order...`;
  }

  const form = document.getElementById('checkout-form');
  if (!form.checkValidity()) {
    alert('⚠ Please fill all required fields!');
    releaseButton();
    return;
  }

  // reCAPTCHA gate. The widget has sat on this page since launch but nothing
  // ever read it, so it blocked precisely nothing. This check sits BEFORE the
  // Telegram notification below, so an unverified submit cannot even reach
  // Lester's phone.
  //
  // Fails open only when Google's script never loaded at all — there is then
  // no token to obtain and nothing this check could tell us. That is safe
  // because n8n verifies the token server-side, and a missing token is
  // rejected there. Server-side is the check that actually counts: the
  // webhook's allowedOrigins is CORS, and CORS does not stop a bot POSTing
  // straight to the endpoint.
  let captchaToken = '';
  if (typeof grecaptcha !== 'undefined' && typeof grecaptcha.getResponse === 'function') {
    try { captchaToken = grecaptcha.getResponse() || ''; } catch (e) { captchaToken = ''; }
    if (!captchaToken) {
      showCaptchaWarning();
      releaseButton();
      return;
    }
  }

  const formData = new FormData(form);

  // ─── FIX: was using undeclared `email` variable ───
  const fullName      = (formData.get('full-name')      || '').toString().trim();
  const customerEmail = (formData.get('email')          || '').toString().trim();
  const phone         = (formData.get('phone')          || '').toString().trim();
  const whatsapp      = (formData.get('whatsapp')       || '').toString().trim();
  const paymentMethod = (formData.get('payment-method') || '').toString().trim();
  const address       = (formData.get('street-address') || '').toString().trim();
  const city          = (formData.get('city')           || '').toString().trim();
  const state         = (formData.get('state')          || '').toString().trim();
  const zip           = (formData.get('zip-code')       || '').toString().trim();
  const country       = (formData.get('country')        || '').toString().trim();

  if (!fullName || !customerEmail || !phone || !address || !city || !state || !zip || !country) {
    alert('⚠ Please complete all required fields!');
    if (placeOrderBtn) { placeOrderBtn.disabled = false; placeOrderBtn.textContent = 'Place Order'; }
    return;
  }

  const storedCart = JSON.parse(localStorage.getItem('cart')) || [];
  if (storedCart.length === 0) { alert('🛒 Your cart is empty!'); return; }

  const subtotal      = storedCart.reduce((sum, i) => sum + (Number(i.price) * (i.quantity || 1)), 0);
  const shippingResult = computeShipping(storedCart, {
    freeShipping: localStorage.getItem('freeShipping') === 'true'
  });
  const shipping = shippingResult.total;

  // Plain-text breakdown so the merchant knows how many parcels to send.
  const shippingBreakdownText = shippingResult.breakdown
    .map(r => `${r.brand}: ${r.qty} item${r.qty === 1 ? '' : 's'}, ${r.packages} package${r.packages === 1 ? '' : 's'} - $${r.fee.toFixed(2)}`)
    .join(' | ');
  const packageCount = String(shippingResult.packageCount);


  // Short customer-facing sentence. Always populated so the email never renders a blank line.
  const shippingNote = shippingResult.packageCount > 1
    ? `Your order ships in ${shippingResult.packageCount} separate packages — each brand ships separately.`
    : 'Your order ships in 1 package.';

  // Apply percentage discount to subtotal only
  const pctDiscount = parseInt(localStorage.getItem('percentageDiscount') || '0');
  let discountedSubtotal = subtotal;
  let discountAmount = 0;
  if (pctDiscount > 0) {
    discountAmount = subtotal * (pctDiscount / 100);
    discountedSubtotal = subtotal - discountAmount;
  }
  const grandTotal   = discountedSubtotal + shipping;
  const orderId      = 'ORDER-' + Date.now();
  const promoCode    = localStorage.getItem('appliedPromoCode') || 'None';
  const discountLine = pctDiscount > 0 ? `-${pctDiscount}% off items (-$${discountAmount.toFixed(2)})` : 'None';

  const fullAddress = `${address}, ${city}, ${state} ${zip}, ${country}`;

  // Telegram FIRST, deliberately. It runs through a Cloudflare Worker that does
  // not depend on n8n, so it is the one notification that survives an n8n
  // outage. It used to sit after the create-order call, which meant a failed
  // quote returned early and Lester never learned the order had been attempted.
  sendTelegramNotification(orderId, fullName, phone, whatsapp, fullAddress, storedCart, grandTotal.toFixed(2), promoCode, discountLine, shipping.toFixed(2), paymentMethod, shippingBreakdownText, packageCount);

  // EVERY order goes to n8n now, not just crypto — it is what writes the order
  // row and sends both emails. Bank-transfer orders get a row and no quote.
  // Must sit after orderId and grandTotal are declared — both are used here.
  const CREATE_ORDER_URL = 'https://n8n.godmusclegears.com/webhook/gmg-create-order';
  let payment = null;

  const orderBody = JSON.stringify({
    orderId: orderId,
    coin: paymentMethod,
    usdTotal: Number(grandTotal.toFixed(2)),
    customerName: fullName,
    email: customerEmail,
    phone: phone,
    whatsapp: whatsapp || 'Not provided',
    items: storedCart.map(i => `${i.name} x${i.quantity || 1}`).join(' | '),
    // Structured, so the email tables are built server-side. The browser used
    // to post rendered HTML, which meant trusting the client with the contents
    // of an email sent to the owner.
    itemsDetailed: storedCart.map(i => ({
      name: i.name,
      quantity: i.quantity || 1,
      price: Number(i.price),
      lineTotal: Number(i.price) * (i.quantity || 1)
    })),
    shippingTotal: Number(shipping.toFixed(2)),
    packageCount: Number(packageCount),
    fullAddress: fullAddress,
    subtotal: Number(discountedSubtotal.toFixed(2)),
    promoCode: promoCode,
    discountLine: discountLine,
    shippingNote: shippingNote,
    shippingBreakdown: shippingBreakdownText,
    // Single-use, and valid for about two minutes. The retry loop below can
    // therefore re-send a token Google has already burned; that attempt is
    // rejected and the order takes the degrade path, where the Telegram above
    // has already reached Lester and the sale is recoverable by hand.
    captchaToken: captchaToken
  });

  // Three attempts, ~1s apart. Most failures are momentary — a container
  // restarting, a tunnel reconnecting, a dropped packet — and a retry turns
  // those into a success the customer never sees.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const quoteRes = await fetch(CREATE_ORDER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: orderBody
      });
      if (!quoteRes.ok) throw new Error('create-order returned ' + quoteRes.status);
      const quote = await quoteRes.json();
      // requiresPayment distinguishes a legitimate bank-transfer order, which
      // has no address by design, from a genuinely broken crypto quote.
      if (quote && quote.requiresPayment) {
        if (!quote.address || !quote.expectedAmount) {
          throw new Error('create-order returned an incomplete quote');
        }
        payment = quote;
      }
      break;
    } catch (err) {
      console.error(`❌ create-order attempt ${attempt} failed`, err);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
    }
  }

  // DEGRADE, never abort. If n8n is unreachable the order still completes and
  // the success page falls back to "we'll contact you shortly" — the manual
  // flow this store ran on for months. Lester already has the Telegram above,
  // so the sale is recoverable by hand. An outage should cost emails, not sales.
  if (payment) {
    sessionStorage.setItem('gmgPayment', JSON.stringify(payment));
  } else {
    sessionStorage.removeItem('gmgPayment');
  }

  // Order emails are sent by n8n, from admin@godmusclegears.com. They used to
  // fire from here via EmailJS, which capped the store at 200 emails a month,
  // could not send from the store domain, and silently sent nothing if the
  // customer closed the tab mid-submit.
  //
  // The redirect is unconditional. It used to hang off the owner email
  // succeeding, which meant a mail problem stranded the customer on checkout
  // with an alert - after their order had already been recorded.
  const firstName = fullName.split(' ')[0];
  localStorage.setItem('customerFirstName', firstName);
  localStorage.removeItem('cart');
  localStorage.removeItem('appliedPromoCode');
  localStorage.removeItem('freeShipping');
  localStorage.removeItem('percentageDiscount');
  updateCartCount();
  setTimeout(() => { window.location.href = 'order-success.html'; }, 600);
}

// ─────────────────────────────────────────────
// CLIPBOARD COPY HELPER
// ─────────────────────────────────────────────

function copyToClipboard(elementId) {
  const input = document.getElementById(elementId);
  if (!input) return;
  const button = input.parentElement.querySelector('button');
  navigator.clipboard.writeText(input.value).then(() => {
    const original = button.textContent;
    button.textContent = '✅ Copied!';
    button.classList.add('copied');
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('copied');
      button.disabled = false;
    }, 2000);
  });
}

// ─────────────────────────────────────────────
// PRODUCT FILTERING
// ─────────────────────────────────────────────

function initProductFilter() {
  const searchInput  = document.getElementById('product-search');
  const brandFilter  = document.getElementById('brand-filter');
  const typeFilter   = document.getElementById('type-filter');
  const clearBtn     = document.getElementById('clear-filters');
  const productCards = document.querySelectorAll('#product-list .card');

  if (!productCards.length) return;

  function filterProducts() {
    const searchTerm  = searchInput ? searchInput.value.toLowerCase() : '';
    const brandValue  = brandFilter ? brandFilter.value : '';
    const typeValue   = typeFilter  ? typeFilter.value  : '';

    productCards.forEach(card => {
      const name    = card.querySelector('.card-title')?.textContent.toLowerCase() || '';
      const brand   = card.getAttribute('data-brand') || '';
      const type    = card.getAttribute('data-type')  || '';
      const col     = card.closest('.col-6, .col-md-4');

      const matches = name.includes(searchTerm) &&
                      (!brandValue || brand === brandValue) &&
                      (!typeValue  || type  === typeValue);

      if (col) col.classList.toggle('d-none', !matches);
    });
  }

  if (searchInput) searchInput.addEventListener('input',  filterProducts);
  if (brandFilter) brandFilter.addEventListener('change', filterProducts);
  if (typeFilter)  typeFilter.addEventListener('change',  filterProducts);

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (brandFilter) brandFilter.value = '';
      if (typeFilter)  typeFilter.value  = '';
      filterProducts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Auto-filter by brand if URL has ?brand=X
  const urlParams = new URLSearchParams(window.location.search);
  const urlBrand  = urlParams.get('brand');
  if (urlBrand && brandFilter) {
    brandFilter.value = urlBrand;
  }

  filterProducts();
}

// ─────────────────────────────────────────────
// FULL PRODUCT CATALOG (for featured carousel)
// ─────────────────────────────────────────────

const FEATURED_CATALOG = (function () {
  // [id, cartName, price, image, brand, type]
  const raw = [
    // Beligas — Injectables
    ['sustanon400mg',              'Testosterone Esters Blend, 400mg (1 vial)',  86.25, 'images/sustanon400mg.jpg',              'Beligas', 'Injectable'],
    ['testc250mg',                 'Testosterone Cypionate, 250mg (1 vial)',     63.84, 'images/testc250mg.jpg',                 'Beligas', 'Injectable'],
    ['teste450mg',                 'Testosterone Enanthate, 450mg (1 vial)',     75.90, 'images/teste450mg.jpg',                 'Beligas', 'Injectable'],
    ['trena100mg',                 'Trenbolone Acetate, 100mg (1 vial)',         86.25, 'images/trena100mg.jpg',                 'Beligas', 'Injectable'],
    ['trene200mg',                 'Trenbolone Enanthate, 200mg (1 vial)',      103.50, 'images/trene200mg.jpg',                 'Beligas', 'Injectable'],
    ['tritestpro400mg',            'TriTest Pro, 400mg (1 vial)',                89.70, 'images/tritestpro400mg.jpg',            'Beligas', 'Injectable'],
    ['quanteq300mg',               'Quant Equipoise, 300mg (1 vial)',            75.90, 'images/quanteq300mg.jpg',               'Beligas', 'Injectable'],
    ['quanteq500mg',               'Quant Equipoise, 500mg (1 vial)',           120.75, 'images/quanteq500mg.jpg',               'Beligas', 'Injectable'],
    ['helioclenyohimbine40mcg55mg','Clenbuterol 40mcg Yohimbine 5.5mg (1 vial)', 75.90,'images/helioclenyohimbine40mcg55mg.jpg','Beligas', 'Injectable'],
    ['maste200mg',                 'Masteron Enanthate, 200mg (1 vial)',         96.60, 'images/maste200mg.jpg',                 'Beligas', 'Injectable'],
    ['dhb1TestC100mg',             'Dihydroboldenone Cypionate, 100mg (1 vial)', 69.00, 'images/dhb1TestC100mg.jpg',             'Beligas', 'Injectable'],
    ['mastp100mg',                 'Masteron Propionate, 100mg (1 vial)',        82.80, 'images/mastp100mg.jpg',                 'Beligas', 'Injectable'],
    ['primoe100mg',                'Primobolan Enanthate, 100mg (1 vial)',      120.75, 'images/primoe100mg.jpg',                'Beligas', 'Injectable'],
    ['primoe200mg',                'Primobolan Enanthate, 200mg (1 vial)',      189.75, 'images/primoe200mg.jpg',                'Beligas', 'Injectable'],
    ['npp100mg',                   'Npp, 100mg (1 vial)',                        58.65, 'images/npp100mg.jpg',                   'Beligas', 'Injectable'],
    ['npp150mg',                   'Npp, 150mg (1 vial)',                        75.90, 'images/npp150mg.jpg',                   'Beligas', 'Injectable'],
    ['hexotren100mg',              'Hexo Trenbolone, 100mg',                    120.75, 'images/hexotren100mg.jpg',              'Beligas', 'Injectable'],
    ['testc200mg',                 'Testosterone Cypionate, 200mg (1 vial)',     62.10, 'images/testc200mg.png',                 'Beligas', 'Injectable'],
    ['teste300mg',                 'Testosterone Enanthate, 300mg (1 vial)',     65.55, 'images/teste300mg.png',                 'Beligas', 'Injectable'],
    ['testnpp1500mg',              'Testosterone NPP Blend, 150mg (1 vial)',     86.25, 'images/testnpp1500mg.jpg',              'Beligas', 'Injectable'],
    ['testp100mg',                 'Testosterone Propionate, 100mg (1 vial)',    48.30, 'images/testp100mg.png',                 'Beligas', 'Injectable'],
    ['testsuspension100mg',        'Testosterone Suspension, 100mg (1 vial)',    51.75, 'images/testsuspension100mg.jpg',        'Beligas', 'Injectable'],
    ['testtrenboldblend400mg',     'Test Tren Bold Blend, 400mg (1 vial)',      162.15, 'images/testtrenboldblend400mg.jpg',     'Beligas', 'Injectable'],
    ['testtrenlong300mg',          'Test Tren Long, 300mg (1 vial)',            138.00, 'images/testtrenlong300mg.jpg',          'Beligas', 'Injectable'],
    ['trentestmastlong300mg',      'Tren Test Mast Long, 300mg (1 vial)',       155.25, 'images/trentestmastlong300mg.jpg',      'Beligas', 'Injectable'],
    ['ttrentestmastshort150mg',    'Tren Test Mast Short, 150mg (1 vial)',      120.75, 'images/trentestmastshort150mg.jpg',     'Beligas', 'Injectable'],
    ['triren150mg',                'Tri Trenbolone, 150mg (1 vial)',            155.25, 'images/triren150mg.jpg',                'Beligas', 'Injectable'],
    ['tritestlite350mg',           'Tri Testosterone Lite, 350mg (1 vial)',      82.80, 'images/tritestlite350mg.jpg',           'Beligas', 'Injectable'],
    ['winstrolsuspension50mg',     'Winstrol Suspension, 50mg (1 vial)',         79.35, 'images/winstrolsuspension50mg.jpg',     'Beligas', 'Injectable'],
    // Beligas — Orals
    ['5amino1mq',                  '5-Amino 1MQ, 50mg (100 tabs)',             217.35, 'images/5amino1mq.jpg',                  'Beligas', 'Oral'],
    ['anadrol50mg100tabs',         'Anadrol, 50mg (100 tabs)',                  144.90, 'images/anadrol50mg100tabs.jpg',         'Beligas', 'Oral'],
    ['anavar10mg100tabs',          'Anavar lite, 10mg (100 tabs)',              110.40, 'images/anavar10mg100tabs.jpg',          'Beligas', 'Oral'],
    ['anavar50mg100tabs',          'Anavar, 50mg (100 tabs)',                   248.40, 'images/anavar50mg100tabs.jpg',          'Beligas', 'Oral'],
    ['arimidex1mg',                'Arimidex, 1mg (50 tabs)',                    65.55, 'images/arimidex1mg.webp',               'Beligas', 'Oral'],
    ['clen40mcg100tabs',           'Clenbuterol, 40mcg (100 tabs)',             117.30, 'images/clen40mcg100tabs.jpg',           'Beligas', 'Oral'],
    ['dianabol20mg100tabs',        'Dianabol, 20mg (100 tabs)',                 138.00, 'images/dianabol20mg100tabs.jpg',        'Beligas', 'Oral'],
    ['dianabol50mg100tabs',        'Dianabol, 50mg (100 tabs)',                 193.20, 'images/dianabol50mg100tabs.jpg',        'Beligas', 'Oral'],
    ['prodostinex1mg',             'Pro-Dostinex, 1mg (Bottle of 10 tablets)', 117.30, 'images/prodostinex1mg.jpg',             'Beligas', 'Oral'],
    ['primo25mg100tabs',           'Primobolan, 25mg (100tabs)',                317.40, 'images/primo25mg100tabs.jpg',           'Beligas', 'Oral'],
    ['superdrol10mg100tabs',       'Superdrol, 10mg (100tabs)',                  93.15, 'images/superdrol10mg100tabs.jpg',       'Beligas', 'Oral'],
    ['winstrol20mg100tabs',        'Winstrol, 20mg (100tabs)',                  120.75, 'images/winstrol20mg100tabs.jpg',        'Beligas', 'Oral'],
    ['winstrol50mg100tabs',        'Winstrol, 50mg (100tabs)',                  193.20, 'images/winstrol50mg100tabs.jpg',        'Beligas', 'Oral'],
    ['cialis25mg50tabs',           'Cialis, 25mg (50 Tabs)',                     48.00, 'images/cialis25mg50tabs.jpg',           'Beligas', 'Oral'],
    ['cialis5mg100tabs',           'Cialis, 5mg (100 Tabs)',                     59.34, 'images/cialis5mg100tabs.jpg',           'Beligas', 'Oral'],
    ['t4100mcg',                   'T4, 100mcg (100 Tabs)',                      86.25, 'images/t4100mcg.jpg',                   'Beligas', 'Oral'],
    ['turinabol10mg',              'Turinabol, 10mg (100 Tabs)',                 89.70, 'images/turinabol10mg.webp',             'Beligas', 'Oral'],
    ['viagra50mg100tabs',          'Viagra, 50mg (100 Tabs)',                    59.34, 'images/viagra50mg100tabs.jpg',          'Beligas', 'Oral'],
    // Sixpex — Injectables
    ['sixpex-bolde',               'BOLDEPEX 200',                              94.50, 'images/sixpex-bolde.jpg',               'Sixpex', 'Injectable'],
    ['sixpex-cutpex',              'CUTPEX B320',                              189.00, 'images/sixpex-cutpex.jpg',              'Sixpex', 'Injectable'],
    ['sixpex-decapex',             'DECAPEX 200',                               81.00, 'images/sixpex-decapex.jpg',             'Sixpex', 'Injectable'],
    ['sixpex-durapex',             'DURAPEX 100',                               81.00, 'images/sixpex-durapex.jpg',             'Sixpex', 'Injectable'],
    ['sixpex-mastepex-e200',       'MASTEPEX E200',                            121.50, 'images/sixpex-mastepex-e200.jpg',       'Sixpex', 'Injectable'],
    ['sixpex-mastepex-p100',       'MASTEPEX P100',                            108.00, 'images/sixpex-mastepex-p100.jpg',       'Sixpex', 'Injectable'],
    ['sixpex-parabopex',           'PARABOPEX 75',                             202.50, 'images/sixpex-parabopex.jpg',           'Sixpex', 'Injectable'],
    ['sixpex-testopex-b300',       'TESTOPEX B300',                             94.50, 'images/sixpex-testopex-b300.jpg',       'Sixpex', 'Injectable'],
    ['sixpex-testopex-b500',       'TESTOPEX B500',                            162.00, 'images/sixpex-testopex-b500.jpg',       'Sixpex', 'Injectable'],
    ['sixpex-testopex-c200',       'TESTOPEX C200',                             67.50, 'images/sixpex-testopex-c200.jpg',       'Sixpex', 'Injectable'],
    ['sixpex-testopex-e250',       'TESTOPEX E250',                             67.50, 'images/sixpex-testopex-e250.jpg',       'Sixpex', 'Injectable'],
    ['sixpex-testopex-p100',       'TESTOPEX P100',                             59.40, 'images/sixpex-testopex-p100.jpg',       'Sixpex', 'Injectable'],
    ['sixpex-trenbopex-a100',      'TRENBOPEX A100',                           108.00, 'images/sixpex-trenbopex-a100.jpg',      'Sixpex', 'Injectable'],
    ['sixpex-trenbopex-e200',      'TRENBOPEX E200',                           121.50, 'images/sixpex-trenbopex-e200.jpg',      'Sixpex', 'Injectable'],
    ['sixpex-hcg5000',             'GONADOPEX 5000 (HCG)',                      94.50, 'images/sixpex-hcg5000.jpg',             'Sixpex', 'Injectable'],
    ['sixpex-hgh100',              'SOMATROPEX 100',                           350.00, 'images/sixpex-hgh100.jpg',              'Sixpex', 'Injectable'],
    // Sixpex — Peptides
    ['sixpex-bpc157',              'BPC-157 5MG',                               48.60, 'images/sixpex-bpc157.jpg',              'Sixpex', 'Peptide'],
    ['sixpex-igf1-lr3-01',         'IGF-1 LR-3 0.1MG',                          75.60, 'images/sixpex-igf1-lr3-01.jpg',         'Sixpex', 'Peptide'],
    ['sixpex-ipamorelin',          'IPAMORELIN 5MG',                            48.60, 'images/sixpex-ipamorelin.jpg',          'Sixpex', 'Peptide'],
    ['sixpex-semaglutide',         'SEMAGLUTIDE 5MG',                          102.60, 'images/sixpex-semaglutide.jpg',         'Sixpex', 'Peptide'],
    ['sixpex-sermorelin',          'SERMORELIN 5MG',                            94.50, 'images/sixpex-sermorelin.jpg',          'Sixpex', 'Peptide'],
    ['sixpex-tb500',               'TB-500 5MG',                                67.50, 'images/sixpex-tb500.jpg',               'Sixpex', 'Peptide'],
    // Sixpex — Orals
    ['sixpex-cialipex',            'CIALIPEX 20',                               54.00, 'images/sixpex-cialipex.jpg',            'Sixpex', 'Oral'],
    ['sixpex-clen40',              'CLENPEX 40',                                94.50, 'images/sixpex-clen40.jpg',              'Sixpex', 'Oral'],
    ['sixpex-halopex',             'HALOPEX 10',                                94.50, 'images/sixpex-halopex.jpg',             'Sixpex', 'Oral'],
    ['sixpex-methapex-20',         'METHAPEX 20',                               86.40, 'images/sixpex-methapex-20.jpg',         'Sixpex', 'Oral'],
    ['sixpex-methapex50',          'METHAPEX 50',                              108.00, 'images/sixpex-methapex50.jpg',          'Sixpex', 'Oral'],
    ['sixpex-oxapex10',            'OXAPEX 10',                                121.50, 'images/sixpex-oxapex10.jpg',            'Sixpex', 'Oral'],
    ['sixpex-oxapex25',            'OXAPEX 25',                                162.00, 'images/sixpex-oxapex25.jpg',            'Sixpex', 'Oral'],
    ['sixpex-oxypex',              'OXYPEX 50',                                 67.50, 'images/sixpex-oxypex.jpg',              'Sixpex', 'Oral'],
    ['sixpex-primopex25',          'PRIMOPEX 25',                               67.50, 'images/sixpex-primopex25.jpg',          'Sixpex', 'Oral'],
    ['sixpex-provipex',            'PROVIPEX 25',                              162.00, 'images/sixpex-provipex.jpg',            'Sixpex', 'Oral'],
    ['sixpex-sildepex-100',        'SILDEPEX 100',                              48.60, 'images/sixpex-sildepex-100.jpg',        'Sixpex', 'Oral'],
    ['sixpex-stanopex10',          'STANOPEX 10',                               67.50, 'images/sixpex-stanopex10.jpg',          'Sixpex', 'Oral'],
    ['sixpex-stanopex50',          'STANOPEX 50',                              108.00, 'images/sixpex-stanopex50.jpg',          'Sixpex', 'Oral'],
    ['sixpex-turipex',             'TURIPEX 10',                               108.00, 'images/sixpex-turipex.jpg',             'Sixpex', 'Oral'],
    ['sixpex-arimipex',            'ARIMIPEX 1',                                67.50, 'images/sixpex-arimipex.jpg',            'Sixpex', 'Oral'],
    ['sixpex-aromapex',            'AROMAPEX 25',                               81.00, 'images/sixpex-aromapex.jpg',            'Sixpex', 'Oral'],
    ['sixpex-caberpex1',           'CABERPEX 1',                                94.50, 'images/sixpex-caberpex1.jpg',           'Sixpex', 'Oral'],
    ['sixpex-clomipex',            'CLOMIPEX 50',                               54.00, 'images/sixpex-clomipex.jpg',            'Sixpex', 'Oral'],
    ['sixpex-t3',                  'CYTOPEX T3',                                40.50, 'images/sixpex-t3.jpg',                  'Sixpex', 'Oral'],
    ['sixpex-finapex',             'FINAPEX 1',                                 67.50, 'images/sixpex-finapex.jpg',             'Sixpex', 'Oral'],
    ['sixpex-letropex',            'LETROPEX 2.5',                              67.50, 'images/sixpex-letropex.jpg',            'Sixpex', 'Oral'],
    ['sixpex-nolvapex',            'NOLVAPEX 20',                               54.00, 'images/sixpex-nolvapex.jpg',            'Sixpex', 'Oral'],
    ['sixpex-t4',                  'THYROPEX T4',                               40.50, 'images/sixpex-t4.jpg',                  'Sixpex', 'Oral'],
    // Xeno — Injectables
    ['xeno-testosterone-enanthate',   'Testosterone Enanthate',                 63.00, 'images/xeno-testosterone-propionate.jpg', 'Xeno', 'Injectable'],
    ['xeno-testosterone-cypionate',   'Testosterone Cypionate',                 63.00, 'images/xeno-testosterone-cypionate.jpg',  'Xeno', 'Injectable'],
    ['xeno-testosterone-propionate',  'Testosterone Propionate',                38.00, 'images/xeno-testosterone-propionate.jpg', 'Xeno', 'Injectable'],
    ['xeno-supertest',                'SuperTest',                             100.00, 'images/xeno-supertest.jpg',               'Xeno', 'Injectable'],
    ['xeno-megatest',                 'MegaTest',                              125.00, 'images/xeno-megatest.jpg',                'Xeno', 'Injectable'],
    ['xeno-nandrolone-phenylpropionate','Nandrolone Phenylpropionate',           70.00, 'images/xeno-nandrolone-phenylpropionate.jpg','Xeno','Injectable'],
    ['xeno-nandrolone-decanoate',     'Nandrolone Decanoate',                   75.00, 'images/xeno-nandrolone-decanoate.jpg',    'Xeno', 'Injectable'],
    ['xeno-equipoise300',             'Equipoise',                             105.00, 'images/xeno-equipoise300.jpg',            'Xeno', 'Injectable'],
    ['xeno-masteron-depot',           'Masteron Depot',                        113.00, 'images/xeno-masteron-depot.jpg',          'Xeno', 'Injectable'],
    ['xeno-mastp100mg',               'Masteron',                              100.00, 'images/xeno-mastp100mg.jpg',              'Xeno', 'Injectable'],
    ['xeno-parabolan',                'Parabolan',                             138.00, 'images/xeno-parabolan.jpg',               'Xeno', 'Injectable'],
    ['xeno-trenbolone-acetate',       'Trenbolone Acetate',                    100.00, 'images/xeno-trenbolone-acetate.jpg',      'Xeno', 'Injectable'],
    ['xeno-trenbolone-enanthate',     'Trenbolone Enanthate',                  113.00, 'images/xeno-trenbolone-enanthate.jpg',    'Xeno', 'Injectable'],
    ['xeno-dhb',                      'DHB',                                   125.00, 'images/xeno-dhb.jpg',                     'Xeno', 'Injectable'],
    ['xeno-primobolan',               'Primobolan',                            138.00, 'images/xeno-primobolan.jpg',              'Xeno', 'Injectable'],
    ['xeno-solaris',                  'Solaris',                               100.00, 'images/xeno-solaris.jpg',                 'Xeno', 'Injectable'],
    ['xeno-omnicut',                  'Omnicut',                               113.00, 'images/xeno-omnicut.jpg',                 'Xeno', 'Injectable'],
    ['xeno-omnimass',                 'OmniMass',                              125.00, 'images/xeno-omnimass.jpg',                'Xeno', 'Injectable'],
    ['xeno-hcg',                      'HCG',                                    88.00, 'images/xeno-hcg.jpg',                     'Xeno', 'Injectable'],
    ['xeno-hmg',                      'HMG',                                   100.00, 'images/xeno-hmg.jpg',                     'Xeno', 'Injectable'],
    // Xeno — Peptides
    ['xeno-semaglutide',              'Semaglutide',                           150.00, 'images/xeno-semaglutide.jpg',             'Xeno', 'Peptide'],
    ['xeno-epitalon',                 'Epitalon',                               38.00, 'images/xeno-epitalon.jpg',                'Xeno', 'Peptide'],
    ['xeno-bpc-15710mg',              'BPC-157',                                88.00, 'images/xeno-bpc-15710mg.jpg',             'Xeno', 'Peptide'],
    ['xeno-semax',                    'Semax',                                  63.00, 'images/xeno-semax.jpg',                   'Xeno', 'Peptide'],
    // Xeno — Orals
    ['xeno-arimidex',                 'Arimidex',                               63.00, 'images/xeno-arimidex.jpg',                'Xeno', 'Oral'],
    ['xeno-t3',                       'T3',                                     38.00, 'images/xeno-t3.jpg',                      'Xeno', 'Oral'],
    ['xeno-t4',                       'T4',                                     38.00, 'images/xeno-t4.jpg',                      'Xeno', 'Oral'],
    ['xeno-dbol-20',                  'Dbol 20',                                50.00, 'images/xeno-dbol-20.jpg',                 'Xeno', 'Oral'],
    ['xeno-winstrol-20',              'Winstrol 20',                            70.00, 'images/xeno-winstrol-20.jpg',             'Xeno', 'Oral'],
    ['xeno-anavar-20',                'Anavar 20',                             113.00, 'images/xeno-anavar-20.jpg',               'Xeno', 'Oral'],
    ['xeno-finasteride',              'Finasteride',                            88.00, 'images/xeno-finasteride.jpg',             'Xeno', 'Oral'],
    ['xeno-accutan',                  'Accutan',                                50.00, 'images/xeno-accutan.jpg',                 'Xeno', 'Oral'],
    ['xeno-proviron',                 'Proviron',                               43.00, 'images/xeno-proviron.jpg',                'Xeno', 'Oral'],
    ['xeno-femara',                   'Femara',                                 30.00, 'images/xeno-femara.jpg',                  'Xeno', 'Oral'],
    ['xeno-primo-s',                  'Primo S',                                75.00, 'images/xeno-primo-s.jpg',                 'Xeno', 'Oral'],
    ['xeno-superdrol',                'Superdrol',                              55.00, 'images/xeno-superdrol.jpg',               'Xeno', 'Oral'],
    ['xeno-turinabol',                'Turinabol',                              68.00, 'images/xeno-turinabol.jpg',               'Xeno', 'Oral'],
    ['xeno-tamox',                    'Tamox',                                  50.00, 'images/xeno-tamox.jpg',                   'Xeno', 'Oral'],
    ['xeno-clomiphene',               'Clomiphene',                             80.00, 'images/xeno-clomiphene.jpg',              'Xeno', 'Oral'],
    ['xeno-clenbuterol',              'Clenbuterol',                           138.00, 'images/xeno-clenbuterol.jpg',             'Xeno', 'Oral'],
  ];
  return raw.map(([id, cartName, price, image, brand, type]) => ({
    id, cartName,
    name: cartName.replace(/ \([^)]+\)$/, ''),
    price, image, brand, type
  }));
})();

// Exposed so shipping.js can resolve brands for carts saved before items carried a brand.
window.FEATURED_CATALOG = FEATURED_CATALOG;

// ─────────────────────────────────────────────
// FEATURED CAROUSEL — dynamic, in-stock only
// ─────────────────────────────────────────────

function buildFeaturedCarousel(inventoryMap) {
  const carouselInner = document.querySelector('#featuredCarousel .carousel-inner');
  const indicators    = document.querySelector('#featuredCarousel .featured-indicators');
  if (!carouselInner) return;

  // Keep only products that are in stock (stock >= 20). Unknown stock = include.
  const available = FEATURED_CATALOG.filter(p => {
    const stock = inventoryMap[p.id.toLowerCase()];
    return stock == null || isNaN(stock) || stock >= 20;
  });

  // Fallback: if somehow everything is out of stock, use the full catalog
  const pool = available.length >= 3 ? available : FEATURED_CATALOG;

  // Fisher-Yates shuffle for random picks every visit
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const picks = shuffled.slice(0, 3);

  carouselInner.innerHTML = picks.map((p, i) => `
    <div class="carousel-item${i === 0 ? ' active' : ''}">
      <div class="featured-slide">
        <div class="card" data-brand="${p.brand}" data-type="${p.type}">
          <img src="${p.image}" class="card-img-top" alt="${p.name}">
          <div class="card-body">
            <h5 class="card-title">${p.name}</h5>
            <p class="card-text">${p.brand} · ${p.type}</p>
            <span class="fw-bold">$${p.price.toFixed(2)}</span>
            <button class="add-to-cart" data-name="${p.cartName}" data-id="${p.id}" data-price="${p.price}" data-image="${p.image}">Add to Cart</button>
          </div>
        </div>
      </div>
    </div>`).join('');

  if (indicators) {
    indicators.innerHTML = picks.map((_, i) => `
      <button type="button" data-bs-target="#featuredCarousel" data-bs-slide-to="${i}"${i === 0 ? ' class="active" aria-current="true"' : ''} aria-label="Product ${i + 1}"></button>`).join('');
  }

  // Re-initialize Bootstrap carousel after rebuilding DOM
  const carouselEl = document.getElementById('featuredCarousel');
  if (carouselEl && window.bootstrap) {
    const existing = bootstrap.Carousel.getInstance(carouselEl);
    if (existing) existing.dispose();
    new bootstrap.Carousel(carouselEl, { interval: 3500, touch: true });
  }

  // Bind add-to-cart buttons on the new cards
  carouselInner.querySelectorAll('.add-to-cart').forEach(btn => {
    btn.addEventListener('click', function () { addToCart(this); });
  });
}

// ─────────────────────────────────────────────
// INVENTORY SYNC (Google Sheets)
// ─────────────────────────────────────────────

function initInventorySync() {
  const allButtons  = document.querySelectorAll('.add-to-cart');
  if (!allButtons.length) return;

  const productList   = document.getElementById('product-list');
  const isProductPage = !!productList;
  const sheetURL = 'https://script.google.com/macros/s/AKfycbzXhvy8kLNCGle9Pw5cWVAZyfr6RaerLizVoe_CBXkBe622tzQrXWgbu_qDXHH8BxPfQw/exec';

  async function updateInventory() {
    try {
      allButtons.forEach(btn => {
        btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Checking stock...`;
        btn.disabled = true;
      });

      const response = await fetch(sheetURL);
      const data     = await response.json();

      const inventoryMap = {};
      data.forEach(item => {
        if (item.ID) inventoryMap[item.ID.trim().toLowerCase()] = parseInt(item.Stock);
      });

      // Rebuild the homepage featured carousel with in-stock products only
      buildFeaturedCarousel(inventoryMap);

      const allCards = Array.from(document.querySelectorAll('.card'));
      allCards.forEach(card => {
        const button    = card.querySelector('.add-to-cart');
        if (!button) return;
        const productId = button.dataset.id?.trim().toLowerCase();
        const stock     = inventoryMap[productId];

        if (stock == null || isNaN(stock)) {
          button.textContent = 'Add to Cart';
          button.disabled    = false;
          button.className   = button.className.replace(/btn-warning|btn-secondary/g, '').trim();
          button.classList.add('btn-primary');
          return;
        }

        card.dataset.stockLevel = stock;

        if (stock < 20) {
          button.textContent = 'Out of Stock';
          button.disabled    = true;
          button.classList.replace('btn-primary', 'btn-secondary');
          button.classList.remove('btn-warning');
        } else if (stock <= 30) {
          button.textContent = 'Low Stock';
          button.disabled    = false;
          button.classList.replace('btn-primary', 'btn-warning');
          button.classList.remove('btn-secondary');
        } else {
          button.textContent = 'Add to Cart';
          button.disabled    = false;
          button.classList.remove('btn-warning', 'btn-secondary');
          button.classList.add('btn-primary');
        }
      });

      // Sort: stock status first (in stock > low > out), then brand (Beligas > Sixpex > Xeno)
      if (isProductPage) {
        const brandOrder = { beligas: 1, sixpex: 2, xeno: 3 };
        const getStockRank = s => {
          if (isNaN(s) || s === 999) return 1; // unknown = treat as in stock
          if (s < 20) return 3;                // out of stock = last
          if (s <= 30) return 2;               // low stock = middle
          return 1;                            // in stock = first
        };
        const sortedCards = Array.from(productList.querySelectorAll('.card')).sort((a, b) => {
          const stockA = parseInt(a.dataset.stockLevel ?? 999);
          const stockB = parseInt(b.dataset.stockLevel ?? 999);
          const stockRankA = getStockRank(stockA);
          const stockRankB = getStockRank(stockB);

          // Stock status is the primary sort
          if (stockRankA !== stockRankB) return stockRankA - stockRankB;

          // Within same stock group, sort by brand (Beligas > Sixpex > Xeno)
          const brandA = (a.dataset.brand || '').toLowerCase();
          const brandB = (b.dataset.brand || '').toLowerCase();
          const brandRankA = brandOrder[brandA] || 99;
          const brandRankB = brandOrder[brandB] || 99;
          return brandRankA - brandRankB;
        });
        sortedCards.forEach(card => {
          const col = card.closest('.col-6, .col-md-4');
          if (col) productList.appendChild(col);
        });
      }
    } catch (error) {
      console.error('❌ Error fetching inventory:', error);
      // Restore all buttons to default if fetch fails
      document.querySelectorAll('.add-to-cart').forEach(btn => {
        btn.innerHTML = 'Add to Cart';
        btn.disabled  = false;
        btn.classList.remove('btn-warning', 'btn-secondary');
        btn.classList.add('btn-primary');
      });
    }
  }

  updateInventory();
  setInterval(updateInventory, 300_000); // refresh every 5 minutes
}

// ─────────────────────────────────────────────
// PROMO CODE VALIDATION
// ─────────────────────────────────────────────

function initPromoCode() {
  const promoSection = document.getElementById('promo-section');
  if (!promoSection) return;

  const applyBtn  = document.getElementById('apply-promo-btn');
  const promoInput = document.getElementById('promo-code-input');
  const promoMsg  = document.getElementById('promo-message');

  if (!applyBtn || !promoInput || !promoMsg) return;

  // ─── Promo code validation (codes stored as hashes — not recoverable from source) ───
  function _ph(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function _chk(input, list) { return list.includes(_ph(input.toUpperCase().trim())); }
  function _val(input, map)  { return map[_ph(input.toUpperCase().trim())] ?? null; }

  // Pre-computed hashes — codes are never stored as plaintext
  const freeItemHashes     = ['1r1u3ky', 'kot262', '1yn2umh'];
  const freeShippingHashes = ['ahnmnl', 'mnepfa'];
  const percentageMap      = { '1xo80td': 10 };

  const freeItem = {
    id: 'free-testc200mg',
    name: 'Testosterone Cypionate, 200mg (1 vial)',
    price: 0.00,
    image: 'images/testc200mg.png',
    quantity: 1,
    brand: 'Beligas'
  };

  const getCart  = () => JSON.parse(localStorage.getItem('cart')) || [];
  const saveCart = (c) => localStorage.setItem('cart', JSON.stringify(c));

  function showMessage(text, type) {
    promoMsg.textContent = text;
    promoMsg.className   = `d-block mt-1 small ${type}`;
    promoMsg.style.opacity = 1;
    setTimeout(() => { promoMsg.style.opacity = 0; }, 5000);
  }

  applyBtn.addEventListener('click', () => {
    const enteredCode = promoInput.value.trim().toUpperCase();
    if (!enteredCode) { showMessage('❌ Please enter a promo code.', 'text-danger'); return; }

    if (_chk(enteredCode, freeShippingHashes)) {
      localStorage.setItem('appliedPromoCode', enteredCode);
      localStorage.setItem('freeShipping', 'true');
      showMessage(`✅ Free shipping promo applied! One package ships free.`, 'text-success');
      promoInput.value = '';
      updateCart();
      return;
    }

    if (_chk(enteredCode, freeItemHashes)) {
      let localCart = getCart();
      if (!localCart.some(i => i.id === freeItem.id)) {
        localCart.push(freeItem);
        saveCart(localCart);
        cart = localCart;
      }
      localStorage.setItem('appliedPromoCode', enteredCode);
      localStorage.removeItem('freeShipping');
      showMessage(`✅ Promo applied! Free Testosterone Cypionate 200mg added.`, 'text-success');
      promoInput.value = '';
      updateCart();
      return;
    }

    const pctDiscount = _val(enteredCode, percentageMap);
    if (pctDiscount !== null) {
      localStorage.setItem('appliedPromoCode', enteredCode);
      localStorage.setItem('percentageDiscount', pctDiscount);
      localStorage.removeItem('freeShipping');
      showMessage('✅ Promo applied! ' + pctDiscount + '% off your subtotal.', 'text-success');
      promoInput.value = '';
      updateCart();
      return;
    }

    showMessage('❌ Invalid promo code. Please try again.', 'text-danger');
  });
}

// ─────────────────────────────────────────────
// COOKIE CONSENT BANNER (GDPR / CCPA)
// ─────────────────────────────────────────────

function initCookieConsent() {
  if (localStorage.getItem('cookieConsent')) return; // already decided

  const banner = document.createElement('div');
  banner.id = 'cookie-banner';
  banner.innerHTML = `
    <div class="cookie-inner">
      <div class="cookie-text">
        <strong>🍪 We use cookies</strong>
        <p>We use Google Analytics to understand how visitors use our site. No personal data is sold. <a href="policies.html" style="color:var(--orange);">Learn more</a></p>
      </div>
      <div class="cookie-actions">
        <button id="cookieDecline">Decline</button>
        <button id="cookieAccept">Accept All</button>
      </div>
    </div>
  `;
  document.body.appendChild(banner);
  setTimeout(() => banner.classList.add('show'), 400);

  document.getElementById('cookieAccept').addEventListener('click', () => {
    localStorage.setItem('cookieConsent', 'accepted');
    banner.classList.remove('show');
    setTimeout(() => banner.remove(), 400);
    // Load GA dynamically now that consent is given
    var _ga = document.createElement('script');
    _ga.src = 'https://www.googletagmanager.com/gtag/js?id=G-23E1P2PH58';
    _ga.async = true;
    document.head.appendChild(_ga);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){dataLayer.push(arguments);};
    window.gtag('js', new Date());
    window.gtag('config', 'G-23E1P2PH58');
  });

  document.getElementById('cookieDecline').addEventListener('click', () => {
    localStorage.setItem('cookieConsent', 'declined');
    banner.classList.remove('show');
    setTimeout(() => banner.remove(), 400);
  });
}

// ─────────────────────────────────────────────
// SCROLL ANIMATIONS (Intersection Observer)
// ─────────────────────────────────────────────

function initScrollAnimations() {
  const observerOptions = { threshold: 0.2 };

  function createObserver(el, callback) {
    if (!el) return;
    const obs = new IntersectionObserver((entries, o) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { callback(el); o.unobserve(entry.target); }
      });
    }, observerOptions);
    obs.observe(el);
  }

  // Featured products section
  const featured = document.getElementById('featured-products');
  createObserver(featured, el => {
    el.querySelectorAll('.product-card').forEach((card, i) => {
      card.style.transitionDelay = `${0.15 * (i + 1)}s`;
    });
    el.classList.add('visible');
  });

  // Why Choose Us section
  const whyChoose = document.getElementById('why-choose');
  createObserver(whyChoose, el => {
    el.querySelectorAll('.col-md-4').forEach((col, i) => {
      col.style.transitionDelay = `${0.15 * (i + 1)}s`;
    });
    el.classList.add('visible');
  });

  // Hero content
  const heroContent = document.querySelector('.hero-content');
  if (heroContent) setTimeout(() => heroContent.classList.add('visible'), 400);

  // Scroll hint fade-out
  window.addEventListener('scroll', () => {
    const scrollHint = document.querySelector('.scroll-hint');
    if (!scrollHint) return;
    scrollHint.style.opacity       = window.scrollY > 100 ? '0' : '1';
    scrollHint.style.pointerEvents = window.scrollY > 100 ? 'none' : 'auto';
  });
}

// ─────────────────────────────────────────────
// BACK TO TOP BUTTON
// ─────────────────────────────────────────────

function initBackToTop() {
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.style.display = window.scrollY > 300 ? 'flex' : 'none';
  });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// ─────────────────────────────────────────────
// PRODUCT IMAGE MODAL
// ─────────────────────────────────────────────

function initProductModal() {
  const modalElement = document.getElementById('productModal');
  if (!modalElement) return;

  const modal       = new bootstrap.Modal(modalElement);
  const modalImage  = document.getElementById('modalProductImage');
  const modalTitle  = document.getElementById('modalProductTitle');
  const modalDesc   = document.getElementById('modalProductDescription');

  document.querySelectorAll('.card-img-top').forEach(img => {
    img.style.cursor = 'pointer';
    img.addEventListener('click', () => {
      const card = img.closest('.card');
      modalImage.src        = img.getAttribute('src');
      modalTitle.textContent = card.querySelector('.card-title')?.textContent || 'Product';
      modalDesc.innerHTML    = card.querySelector('.card-text')?.innerHTML || '';
      modal.show();
    });
  });
}

// ─────────────────────────────────────────────
// TELEGRAM POPUP (once per day)
// ─────────────────────────────────────────────

function initTelegramPopup() {
  const popup = document.getElementById('telegram-popup');
  if (!popup) return;

  const closeBtn  = popup.querySelector('.close-btn');
  const lastClosed = localStorage.getItem('telegramPopupClosedAt');
  const shouldShow = !lastClosed || Date.now() - lastClosed > 86_400_000;

  if (shouldShow) setTimeout(() => popup.classList.add('show'), 3000);

  const closePopup = () => {
    popup.classList.remove('show');
    localStorage.setItem('telegramPopupClosedAt', Date.now());
  };

  if (closeBtn) closeBtn.addEventListener('click', closePopup);
  popup.addEventListener('click', e => { if (e.target === popup) closePopup(); });
}

// ─────────────────────────────────────────────
// NAVBAR ACTIVE LINK HIGHLIGHT
// ─────────────────────────────────────────────

function highlightActiveNavLink() {
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href') || '';
    link.classList.toggle('active', href === currentPage || href.includes(currentPage));
  });
}

// ─────────────────────────────────────────────
// CAPTCHA MODAL
// ─────────────────────────────────────────────

// Shows the warning modal that has been sitting unused in checkout.html.
// Falls back to alert() so the gate still communicates on any page that has
// no modal markup.
function showCaptchaWarning() {
  const modal = document.getElementById('captchaModal');
  if (modal) { modal.style.display = 'flex'; return; }
  alert('⚠ Please verify that you are not a robot before placing your order.');
}

function initCaptchaModal() {
  const closeBtn = document.getElementById('closeCaptchaModal');
  const modal    = document.getElementById('captchaModal');
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  }
}

// ─────────────────────────────────────────────
// ── SINGLE DOMContentLoaded ENTRY POINT ──
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Cart
  updateCart();
  updateCartCount();
  updateCheckoutButton();

  // Bind Add-to-Cart buttons (clone to remove any stale listeners)
  document.querySelectorAll('.add-to-cart').forEach(btn => {
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
    fresh.addEventListener('click', function () { addToCart(this); });
  });

  // Page-specific initialisation
  if (document.getElementById('cart-items'))     updateCart();
  if (document.getElementById('checkout-items-list')) {
    renderCheckoutSummary();
    const form = document.getElementById('checkout-form');
    if (form) form.addEventListener('submit', handleCheckoutSubmit);
  }

  // Features
  initProductFilter();
  initScrollAnimations();
  initBackToTop();
  initScrollAnimations();
  // Hero entrance animation
  const heroContent = document.querySelector('.hero-content');
  if (heroContent) setTimeout(() => heroContent.classList.add('visible'), 100);
  initProductModal();
  initTelegramPopup();
  initPromoCode();
  initCaptchaModal();
  highlightActiveNavLink();

  // Cookie consent banner (GDPR/CCPA)
  initCookieConsent();

  // Show featured products immediately (no wait), then refresh after inventory loads
  buildFeaturedCarousel({});
  initInventorySync();

  // Checkout summary update
  if (document.getElementById('checkout-grand-total')) updateCheckoutSummary();

  // ── Promo Announcement Bar (homepage only) ──
  const promoBar = document.getElementById('promo-bar');
  if (promoBar) {
    // Hide if user already closed it this session
    if (sessionStorage.getItem('promoBarClosed')) {
      promoBar.style.display = 'none';
    }

    // Close button
    document.getElementById('closePromoBar').addEventListener('click', () => {
      promoBar.style.display = 'none';
      sessionStorage.setItem('promoBarClosed', '1');
    });

    // Copy promo code on click
    document.getElementById('copyPromoCode').addEventListener('click', () => {
      navigator.clipboard.writeText('NEWCLIENT10').then(() => {
        const btn = document.getElementById('copyPromoCode');
        const original = btn.innerHTML;
        btn.textContent = 'Copied! ✓';
        btn.style.background = 'rgba(255,255,255,0.4)';
        setTimeout(() => { btn.innerHTML = original; btn.style.background = ''; }, 2000);
      });
    });
  }
});
