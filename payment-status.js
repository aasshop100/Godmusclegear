// payment-status.js — GOD MUSCLE GEARS
// Pure status → view mapping for the order-success payment panel.
// No DOM, no network, no storage. Unit-tested in tests/payment-status.test.js.
//
// Exists because order-success.html renders the quote once and never checks
// again, so a customer who pays correctly watches the countdown run out and is
// told "expired — message us on Telegram". This module decides what the panel
// should say for each real order status.
//
// Rules that must never be relaxed:
//   1. PAID never implies shipped. Nothing auto-ships; a human releases every
//      order. "Being prepared" is true, "dispatched" is not.
//   2. REVIEW must read as neither success nor failure, and must always tell
//      the customer not to pay again. A buyer who reads it as failure and
//      re-sends creates a second unmatched payment and a refund problem.
//   3. An unknown or NOT_FOUND status degrades to exactly the page's current
//      behaviour, never to an error. A stale token or a rolled-back sheet must
//      look like a normal awaiting-payment page.
//   4. Never mention the auto-accept tolerance. A published ceiling is a
//      discount every buyer can take.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== 'undefined' ? window : null, function () {

  // A quiet awaiting-payment view: the panel behaves exactly as it does today,
  // with no status banner at all. Also the fallback for anything unrecognised.
  function pending() {
    return {
      tone: 'pending',
      headline: '',
      body: '',
      showPanel: true,
      showCountdown: true,
      stopPolling: false
    };
  }

  function expired() {
    return {
      tone: 'expired',
      headline: '',
      body: '',
      showPanel: true,
      showCountdown: false,
      stopPolling: false
    };
  }

  function statusView(status, opts) {
    const o = opts || {};
    const coin = o.coin ? String(o.coin) : '';

    switch (String(status || '')) {

      case 'PAYMENT_SEEN':
        // The watcher has already stopped the expiry clock server-side once a
        // payment is visible in the mempool. Leaving the countdown running
        // would show a customer whose money is confirmed on the network a
        // clock ticking toward "expired".
        return {
          tone: 'progress',
          headline: 'Payment detected',
          body: 'Your payment is on the network and waiting to confirm. This can take a ' +
                'while for Bitcoin. No action needed — you can close this page.',
          showPanel: false,
          showCountdown: false,
          stopPolling: false
        };

      case 'PAID':
        return {
          tone: 'success',
          headline: 'Payment confirmed',
          body: 'Thank you. Your order is confirmed and is being prepared. ' +
                'We will be in touch with shipping details.',
          showPanel: false,
          showCountdown: false,
          stopPolling: true
        };

      case 'REVIEW': {
        // The shortfall is stated only when the endpoint supplies one, and the
        // sentence is built so there is never a dangling parenthesis when it
        // does not. "Please don't send again" is the load-bearing part.
        const amount = o.shortfall ? String(o.shortfall).replace(/^[-+]/, '') : '';
        const detail = amount
          ? ' (off by ' + amount + (coin ? ' ' + coin : '') + ')'
          : '';
        return {
          tone: 'attention',
          headline: 'Payment received — being checked',
          body: 'We received your payment but the amount does not match the quote' +
                detail + '. Please don’t send again — we are checking it manually ' +
                'and will confirm shortly.',
          showPanel: false,
          showCountdown: false,
          stopPolling: true
        };
      }

      case 'EXPIRED': {
        const view = expired();
        view.stopPolling = true;
        return view;
      }

      case 'AWAITING_PAYMENT':
        return o.expired ? expired() : pending();

      default:
        // NOT_FOUND, empty, or anything unrecognised.
        return pending();
    }
  }

  return { statusView: statusView };
});
