// script.js — GOD MUSCLE GEARS
// Cleaned: merged duplicate DOMContentLoaded blocks, fixed `email` variable bug,
//          removed duplicate freeShippingCodes declaration, consolidated init.

document.addEventListener('touchstart', function () {}, { passive: true });

let cart = JSON.parse(localStorage.getItem('cart')) || [];
const BASE_SHIPPING_PER_10 = 20.00;

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

function updateCart() {
  updateCartCount();

  const cartItems  = document.getElementById('cart-items');
  const subtotalEl = document.getElementById('cart-subtotal');
  const shippingEl = document.getElementById('shipping-fee');
  const grandTotalEl = document.getElementById('cart-grand-total');
  const emptyMsg   = document.getElementById('empty-cart-message');

  if (!cartItems) return;

  let subtotal = 0;
  let totalQuantity = 0;
  cartItems.innerHTML = '';

  if (cart.length === 0) {
    if (emptyMsg)      emptyMsg.style.display = 'block';
    if (subtotalEl)    subtotalEl.textContent = '$0.00';
    if (shippingEl)    shippingEl.textContent = '$0.00';
    if (grandTotalEl)  grandTotalEl.textContent = '$0.00';
    updateCheckoutButton();
    return;
  }

  if (emptyMsg) emptyMsg.style.display = 'none';

  cart.forEach((item, index) => {
    const itemPrice = Number(item.price) || 0;
    const quantity  = item.quantity || 1;
    const lineTotal = itemPrice * quantity;
    subtotal      += lineTotal;
    totalQuantity += quantity;

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

  // Apply free shipping promo if active
  let shipping = Math.ceil(totalQuantity / 10) * BASE_SHIPPING_PER_10;
  if (localStorage.getItem('freeShipping') === 'true') {
    shipping = Math.max(0, shipping - Math.min(20, shipping));
  }

  const grandTotal = subtotal + shipping;
  if (subtotalEl)   subtotalEl.textContent   = `$${subtotal.toFixed(2)}`;
  if (shippingEl)   shippingEl.textContent   = `$${shipping.toFixed(2)}`;
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

  const existingItem = cart.find(item => item.id === id);
  if (existingItem) {
    existingItem.quantity = (existingItem.quantity || 1) + 1;
  } else {
    cart.push({ id, name, price, quantity: 1, image });
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

  let shipping = Math.ceil(totalQuantity / 10) * BASE_SHIPPING_PER_10;
  if (localStorage.getItem('freeShipping') === 'true') {
    shipping = Math.max(0, shipping - Math.min(20, shipping));
  }

  const grandTotal = subtotal + shipping;
  if (itemsCountEl)  itemsCountEl.textContent  = totalQuantity;
  if (subtotalEl)    subtotalEl.textContent    = subtotal.toFixed(2);
  if (shippingEl)    shippingEl.textContent    = shipping.toFixed(2);
  if (grandTotalEl)  grandTotalEl.textContent  = grandTotal.toFixed(2);
}

// Alias used by some callers
function updateCheckoutSummary() { renderCheckoutSummary(); }

// ─────────────────────────────────────────────
// CHECKOUT SUBMIT (EmailJS via fetch)
// ─────────────────────────────────────────────

function handleCheckoutSubmit(event) {
  event.preventDefault();

  const placeOrderBtn = document.querySelector('.place-order-btn');
  if (placeOrderBtn) {
    placeOrderBtn.disabled = true;
    placeOrderBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Processing Order...`;
  }

  const form = document.getElementById('checkout-form');
  if (!form.checkValidity()) {
    alert('⚠ Please fill all required fields!');
    if (placeOrderBtn) { placeOrderBtn.disabled = false; placeOrderBtn.textContent = 'Place Order'; }
    return;
  }

  const formData = new FormData(form);

  // ─── FIX: was using undeclared `email` variable ───
  const fullName      = (formData.get('full-name')      || '').toString().trim();
  const customerEmail = (formData.get('email')          || '').toString().trim();
  const phone         = (formData.get('phone')          || '').toString().trim();
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
  const totalQuantity = storedCart.reduce((sum, i) => sum + (i.quantity || 1), 0);
  let   shipping      = Math.ceil(totalQuantity / 10) * BASE_SHIPPING_PER_10;

  if (localStorage.getItem('freeShipping') === 'true') {
    shipping = Math.max(0, shipping - Math.min(20, shipping));
  }

  const grandTotal = subtotal + shipping;
  const orderId    = 'ORDER-' + Date.now();
  const promoCode  = localStorage.getItem('appliedPromoCode') || 'None';

  const itemsTableHTML = storedCart.map((item, i) => {
    const qty       = item.quantity || 1;
    const price     = Number(item.price).toFixed(2);
    const lineTotal = (Number(item.price) * qty).toFixed(2);
    const rowBg     = i % 2 === 0 ? '#111c2d' : '#0d1825';
    return `<tr style="background-color:${rowBg};">
      <td style="padding:10px 14px;font-size:13px;color:#ffffff;border-bottom:1px solid rgba(0,200,255,0.07);">${item.name}</td>
      <td style="padding:10px 14px;font-size:13px;color:#7a9ab0;text-align:center;border-bottom:1px solid rgba(0,200,255,0.07);">${qty}</td>
      <td style="padding:10px 14px;font-size:13px;color:#7a9ab0;text-align:right;border-bottom:1px solid rgba(0,200,255,0.07);">$${price}</td>
      <td style="padding:10px 14px;font-size:13px;color:#00c8ff;font-weight:600;text-align:right;border-bottom:1px solid rgba(0,200,255,0.07);">$${lineTotal}</td>
    </tr>`;
  }).join('');

  const serviceID = 'service_uerk41r';
  const userID    = '8tIW2RqhekSLKVqLT';
  const fullAddress = `${address}, ${city}, ${state} ${zip}, ${country}`;

  const customerPayload = {
    service_id: serviceID,
    template_id: 'template_0ry9w0v',
    user_id: userID,
    template_params: {
      order_id: orderId, customer_name: fullName, customer_email: customerEmail,
      full_address: fullAddress, items_table_html: itemsTableHTML,
      subtotal: subtotal.toFixed(2), shipping: shipping.toFixed(2),
      total: grandTotal.toFixed(2), promo_code: promoCode
    }
  };

  const ownerPayload = {
    service_id: serviceID,
    template_id: 'template_8x2z86l',
    user_id: userID,
    template_params: {
      order_id: orderId, customer_name: fullName, customer_email: customerEmail,
      phone, full_address: fullAddress, items_table_html: itemsTableHTML,
      subtotal: subtotal.toFixed(2), shipping: shipping.toFixed(2),
      total: grandTotal.toFixed(2), promo_code: promoCode,
      to_email: 'aasshop100@gmail.com'
    }
  };

  const sendEmail = (payload) => fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  // Send customer email (fire-and-forget)
  sendEmail(customerPayload)
    .then(res => res.ok ? console.log('📧 Customer email sent') : console.error('❌ Customer email failed'))
    .catch(err => console.error('❌ Customer email error', err));

  // Send owner email, then redirect
  sendEmail(ownerPayload)
    .then(res => {
      if (res.ok) {
        const firstName = fullName.split(' ')[0];
        localStorage.setItem('customerFirstName', firstName);
        localStorage.removeItem('cart');
        localStorage.removeItem('appliedPromoCode');
        localStorage.removeItem('freeShipping');
        updateCartCount();
        setTimeout(() => { window.location.href = 'order-success.html'; }, 600);
      } else {
        alert('⚠ Order email did not send correctly. Please try again.');
        if (placeOrderBtn) { placeOrderBtn.disabled = false; placeOrderBtn.textContent = 'Place Order'; }
      }
    })
    .catch(err => {
      console.error('❌ Owner email error', err);
      alert('⚠ Connection issue. Please try again.');
      if (placeOrderBtn) { placeOrderBtn.disabled = false; placeOrderBtn.textContent = 'Place Order'; }
    });
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

      // Sort product cards: by brand first (Beligas, Sixpex, Xeno), then by stock status
      if (isProductPage) {
        const brandOrder = { beligas: 1, sixpex: 2, xeno: 3 };
        const sortedCards = Array.from(productList.querySelectorAll('.card')).sort((a, b) => {
          const brandA = (a.dataset.brand || '').toLowerCase();
          const brandB = (b.dataset.brand || '').toLowerCase();
          const brandRankA = brandOrder[brandA] || 99;
          const brandRankB = brandOrder[brandB] || 99;
          if (brandRankA !== brandRankB) return brandRankA - brandRankB;

          const stockA = parseInt(a.dataset.stockLevel ?? 999);
          const stockB = parseInt(b.dataset.stockLevel ?? 999);
          const getStockRank = s => {
            if (isNaN(s) || s === 999) return 1; // unknown = treat as in stock
            if (s < 20) return 3;                // out of stock = last
            if (s <= 30) return 2;               // low stock = middle
            return 1;                            // in stock = first
          };
          return getStockRank(stockA) - getStockRank(stockB);
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

  // ─── Single declaration of code lists ───
  const freeItemCodes     = ['BELIGAS101', 'SIXPEX202', 'XENO303'];
  const freeShippingCodes = ['SHIPFREE20', 'FREESHIP2025'];

  const freeItem = {
    id: 'free-testc200mg',
    name: 'Testosterone Cypionate, 200mg (1 vial)',
    price: 0.00,
    image: 'images/testc200mg.png',
    quantity: 1
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

    if (freeShippingCodes.includes(enteredCode)) {
      localStorage.setItem('appliedPromoCode', enteredCode);
      localStorage.setItem('freeShipping', 'true');
      showMessage(`✅ Free shipping promo applied! Shipping discounted up to $20.`, 'text-success');
      promoInput.value = '';
      updateCart();
      return;
    }

    if (freeItemCodes.includes(enteredCode)) {
      let localCart = getCart();
      if (!localCart.some(i => i.id === freeItem.id)) {
        localCart.push(freeItem);
        saveCart(localCart);
        cart = localCart;
      }
      localStorage.setItem('appliedPromoCode', enteredCode);
      localStorage.removeItem('freeShipping');
      showMessage(`✅ Promo "${enteredCode}" applied! Free Testosterone Cypionate 200mg added.`, 'text-success');
      promoInput.value = '';
      updateCart();
      return;
    }

    showMessage('❌ Invalid promo code. Please try again.', 'text-danger');
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

  // Inventory sync (async — runs in background)
  initInventorySync();

  // Checkout summary update
  if (document.getElementById('checkout-grand-total')) updateCheckoutSummary();
});
