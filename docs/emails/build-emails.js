// Source of truth for the "Build Emails" Code node in n8n `GMG - Create Order`.
// Kept here so the templates are version-controlled and diffable rather than
// living only in a workflow field. Paste verbatim into the node.
//
// Runs AFTER `Respond With Quote`, so the browser already has its quote and
// nothing here can slow down or break checkout.
//
// Emits one item carrying both rendered emails. The two emailSend nodes
// downstream do nothing but address and send them.
//
// Rules:
//   - The customer email must never reveal the auto-accept tolerance, and must
//     never promise that anything has shipped.
//   - Bank-transfer orders get the "we will contact you" promise; crypto orders
//     get the payment block. Never both, never neither.
//   - Everything interpolated goes through esc(). The order fields come from a
//     public webhook, so a customer name containing markup must not be able to
//     inject anything into an email sent to Lester.

const body = $('Order Webhook').first().json.body || {};
const order = $('Build Order').first().json;

const LOGO = 'https://raw.githubusercontent.com/aasshop100/Godmusclegearsample/refs/heads/main/images/logo.png';
const ORANGE = '#ff4500';
const isCrypto = order.status === 'AWAITING_PAYMENT';

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  const n = Number(value);
  return isFinite(n) ? n.toFixed(2) : '0.00';
}

// Built server-side from a structured array. The browser used to assemble this
// markup and post it, which meant trusting the client with the contents of an
// email sent to Lester.
function itemRows() {
  const detailed = Array.isArray(body.itemsDetailed) ? body.itemsDetailed : [];
  if (detailed.length) {
    return detailed.map(function (it) {
      const qty = Number(it.quantity) || 1;
      return '<tr>'
        + '<td style="padding:8px; border:1px solid #ddd;">' + esc(it.name) + '</td>'
        + '<td style="padding:8px; border:1px solid #ddd;">' + qty + '</td>'
        + '<td style="padding:8px; border:1px solid #ddd;">$' + money(it.price) + '</td>'
        + '<td style="padding:8px; border:1px solid #ddd;">$' + money(it.lineTotal !== undefined ? it.lineTotal : Number(it.price) * qty) + '</td>'
        + '</tr>';
    }).join('');
  }
  // Fallback for an order placed before the checkout sends itemsDetailed.
  // Degraded but never blank - a missing item list on an order email is worse
  // than an ugly one.
  return '<tr><td colspan="4" style="padding:8px; border:1px solid #ddd; text-align:left;">'
    + esc(body.items) + '</td></tr>';
}

function header() {
  return '<div style="background-color:#1A1A1A; text-align:center; padding:18px;">'
    + '<img src="' + LOGO + '" alt="GOD MUSCLE GEARS" style="max-width:180px; height:auto;">'
    + '</div>';
}

function itemsTable() {
  return '<h3 style="color:' + ORANGE + '; margin-top:25px;">Items Ordered</h3>'
    + '<table style="width:100%; border-collapse:collapse; text-align:center;">'
    + '<thead><tr style="background-color:#1A1A1A; color:#ffffff;">'
    + '<th style="padding:8px; border:1px solid #ddd;">Product</th>'
    + '<th style="padding:8px; border:1px solid #ddd;">Qty</th>'
    + '<th style="padding:8px; border:1px solid #ddd;">Price</th>'
    + '<th style="padding:8px; border:1px solid #ddd;">Total</th>'
    + '</tr></thead><tbody>' + itemRows() + '</tbody></table>';
}

function pricingTable() {
  return '<table style="width:100%; border-collapse:collapse; margin-top:15px;">'
    + '<tr><td style="padding:8px; border:1px solid #ddd;">Subtotal</td><td style="padding:8px; border:1px solid #ddd;">$' + money(body.subtotal) + '</td></tr>'
    + '<tr><td style="padding:8px; border:1px solid #ddd;">Shipping</td><td style="padding:8px; border:1px solid #ddd;">$' + money(body.shippingTotal) + '</td></tr>'
    + '<tr><td style="padding:8px; border:1px solid #ddd;">Discount</td><td style="padding:8px; border:1px solid #ddd;">' + esc(body.discountLine || 'None') + '</td></tr>'
    + '<tr><td style="padding:8px; border:2px solid ' + ORANGE + ';"><strong>Total</strong></td><td style="padding:8px; border:2px solid ' + ORANGE + ';"><strong>$' + money(order.usdTotal) + '</strong></td></tr>'
    + '</table>';
}

// ── customer email ───────────────────────────────────────────────────

const customerIntro = isCrypto
  ? 'Your order has been received. Complete your payment below and we will confirm it automatically.'
  : 'Your order has been received and is currently being processed.';

const paymentBlock = isCrypto
  ? '<h3 style="color:' + ORANGE + '; margin-top:25px;">Complete Your Payment</h3>'
    + '<div style="background:#f5f5f5; border-radius:10px; padding:20px; margin-top:12px;">'
    + '<p style="margin:0 0 4px; font-size:13px; color:#666;">Send exactly</p>'
    + '<p style="margin:0 0 18px; font-size:26px; font-weight:bold; color:' + ORANGE + '; word-break:break-all;">'
      + esc(order.expectedAmount) + ' ' + esc(order.coin) + '</p>'
    + '<p style="margin:0 0 4px; font-size:13px; color:#666;">To this address</p>'
    + '<p style="margin:0 0 18px; padding:12px; background:#ffffff; border:1px solid #ddd; border-radius:6px; font-family:monospace; font-size:13px; color:#111; word-break:break-all;">'
      + esc(order.address) + '</p>'
    + '<div style="background:#fff3cd; border-left:5px solid ' + ORANGE + '; padding:12px; margin-bottom:16px;">'
    + '<p style="margin:0; font-size:14px; line-height:1.6; color:#333;">If there is a fee when you send, add it on top so the full <strong>'
      + esc(order.expectedAmount) + ' ' + esc(order.coin) + '</strong> arrives.</p></div>'
    + '<p style="margin:0 0 10px; font-size:13px; color:#666;">This quote is valid until <strong style="color:#111;">'
      + esc(order.expiresAt) + '</strong> (Manila time). If it expires before you send, message us on Telegram and we will issue a new one.</p>'
    + '<p style="margin:0; font-size:13px; color:#666;">Your order is confirmed automatically once your payment arrives &mdash; usually within a few minutes. We will email you as soon as it does.</p>'
    + '</div>'
  : '<div style="background:#fff3cd; border-left:5px solid ' + ORANGE + '; padding:12px; margin-top:20px;">'
    + 'We will contact you soon via Email or Telegram with secure payment instructions.</div>';

const customerHtml =
  '<div style="font-family:Arial,Helvetica,sans-serif; max-width:600px; margin:auto;">'
  + header()
  + '<h2 style="color:' + ORANGE + '; text-align:center; margin-top:20px;">Order Confirmation</h2>'
  + '<p>Hi ' + esc(order.customerName) + ',</p>'
  + '<p>Thank you for shopping with <strong>GOD MUSCLE GEARS</strong>!<br>' + customerIntro + '</p>'
  + '<h3 style="color:' + ORANGE + ';">Order Details</h3>'
  + '<table style="width:100%; border-collapse:collapse;">'
  + '<tr><td style="padding:8px; border:1px solid #ddd;"><strong>Order ID</strong></td><td style="padding:8px; border:1px solid #ddd;">' + esc(order.orderId) + '</td></tr>'
  + '<tr><td style="padding:8px; border:1px solid #ddd;"><strong>Email</strong></td><td style="padding:8px; border:1px solid #ddd;">' + esc(order.email) + '</td></tr>'
  + '<tr><td style="padding:8px; border:1px solid #ddd;"><strong>Promo Code</strong></td><td style="padding:8px; border:1px solid #ddd;">' + esc(body.promoCode || 'None') + '</td></tr>'
  + '<tr><td style="padding:8px; border:1px solid #ddd;"><strong>Payment Method</strong></td><td style="padding:8px; border:1px solid #ddd;">' + esc(body.coin) + '</td></tr>'
  + '</table>'
  + itemsTable()
  + pricingTable()
  + (body.shippingNote ? '<p style="font-size:13px; color:#555; margin-top:10px;">' + esc(body.shippingNote) + '</p>' : '')
  + '<h3 style="color:' + ORANGE + '; margin-top:25px;">Shipping To:</h3><p>' + esc(order.fullAddress) + '</p>'
  + paymentBlock
  + '<p style="margin-top:25px;">If you have any questions, reply directly to this email.<br>We appreciate your trust and support!</p>'
  + '<p><strong>GOD MUSCLE GEARS</strong></p>'
  + '<p style="margin-top:20px;"><a href="https://t.me/Godmusclegears" style="background-color:#0088cc; color:#ffffff; padding:12px 18px; border-radius:8px; text-decoration:none; font-weight:bold; display:inline-block;">Chat with us on Telegram</a></p>'
  + '</div>';

// ── owner email ──────────────────────────────────────────────────────
// Carries the payment details, which the EmailJS version never could: it fired
// before the quote existed. Having the exact expected amount here is what makes
// hand-matching a payment possible without opening the sheet.

const ownerPaymentBlock = isCrypto
  ? '<h3 style="color:' + ORANGE + '; margin-top:25px;">Payment Expected</h3>'
    + '<table style="width:100%; border-collapse:collapse;">'
    + '<tr><td style="padding:8px; border:1px solid #ddd; width:40%;">Amount</td><td style="padding:8px; border:2px solid ' + ORANGE + ';"><strong style="color:' + ORANGE + '; font-size:16px;">'
      + esc(order.expectedAmount) + ' ' + esc(order.coin) + '</strong></td></tr>'
    + '<tr><td style="padding:8px; border:1px solid #ddd;">Address</td><td style="padding:8px; border:1px solid #ddd; font-family:monospace; word-break:break-all;">' + esc(order.address) + '</td></tr>'
    + '<tr><td style="padding:8px; border:1px solid #ddd;">Quote expires</td><td style="padding:8px; border:1px solid #ddd;">' + esc(order.expiresAt) + ' (Manila)</td></tr>'
    + '</table>'
  : '<h3 style="color:' + ORANGE + '; margin-top:25px;">Payment Expected</h3>'
    + '<p style="padding:12px; background:#fff3cd; border-left:5px solid ' + ORANGE + ';">Bank transfer &mdash; send payment instructions to the customer manually.</p>';

const ownerHtml =
  '<div style="font-family:Arial,Helvetica,sans-serif; max-width:600px; margin:auto;">'
  + header()
  + '<h2 style="color:' + ORANGE + '; margin-top:20px;">New Customer Order</h2>'
  + '<table style="width:100%; border-collapse:collapse;">'
  + '<tr><td style="padding:8px; border:1px solid #ddd;"><strong>Order ID</strong></td><td style="padding:8px; border:1px solid #ddd;">' + esc(order.orderId) + '</td></tr>'
  + '<tr><td style="padding:8px; border:1px solid #ddd;"><strong>Customer Name</strong></td><td style="padding:8px; border:1px solid #ddd;">' + esc(order.customerName) + '</td></tr>'
  + '<tr><td style="padding:8px; border:1px solid #ddd;"><strong>Email</strong></td><td style="padding:8px; border:1px solid #ddd;">' + esc(order.email) + '</td></tr>'
  + '<tr><td style="padding:8px; border:1px solid #ddd;"><strong>Phone</strong></td><td style="padding:8px; border:1px solid #ddd;">' + esc(order.phone) + '</td></tr>'
  + '<tr><td style="padding:8px; border:1px solid #ddd;"><strong>WhatsApp</strong></td><td style="padding:8px; border:1px solid #ddd;">' + esc(order.whatsapp || 'Not provided') + '</td></tr>'
  + '<tr><td style="padding:8px; border:1px solid #ddd;"><strong>Payment Method</strong></td><td style="padding:8px; border:1px solid #ddd;">' + esc(body.coin) + '</td></tr>'
  + '<tr><td style="padding:8px; border:1px solid #ddd;"><strong>Promo Code</strong></td><td style="padding:8px; border:1px solid #ddd;">' + esc(body.promoCode || 'None') + '</td></tr>'
  + '</table>'
  + ownerPaymentBlock
  + itemsTable()
  + '<h3 style="color:' + ORANGE + '; margin-top:25px;">Shipping &amp; Fulfilment</h3>'
  + '<table style="width:100%; border-collapse:collapse;">'
  + '<tr><td style="padding:8px; border:1px solid #ddd; width:40%;">Packages to Ship</td><td style="padding:8px; border:2px solid ' + ORANGE + ';"><strong style="color:' + ORANGE + '; font-size:16px;">' + esc(order.packageCount) + '</strong></td></tr>'
  + '<tr><td style="padding:8px; border:1px solid #ddd;">Breakdown</td><td style="padding:8px; border:1px solid #ddd;">' + esc(body.shippingBreakdown || '&mdash;') + '</td></tr>'
  + '</table>'
  + '<h3 style="color:' + ORANGE + '; margin-top:25px;">Pricing Summary</h3>'
  + pricingTable()
  + '<h3 style="color:' + ORANGE + '; margin-top:25px;">Shipping Address</h3><p>' + esc(order.fullAddress) + '</p>'
  + '</div>';

return [{ json: {
  customerEmail: order.email,
  customerSubject: 'Order Confirmation #' + order.orderId,
  customerHtml: customerHtml,
  ownerSubject: 'New Order #' + order.orderId + ' - ' + String(body.coin || ''),
  ownerHtml: ownerHtml,
  isCrypto: isCrypto
}}];
