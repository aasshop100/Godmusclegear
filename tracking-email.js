// tracking-email.js — GOD MUSCLE GEARS
// Decides whether a tracking number owes the customer an email, and which
// numbers that email should carry. No DOM, no network, no storage.
// Unit-tested here, then pasted verbatim into the n8n Code node.
//
// Rules that must never be relaxed:
//   1. BANK_TRANSFER is shippable. Those orders never reach PAID — the watcher
//      excludes them from matching by design — so gating on PAID alone would
//      silently skip every bank-transfer customer.
//   2. A number against a non-shippable order means the WRONG ORDER WAS TAGGED.
//      Report it; never email on it. The cost of guessing is a stranger
//      receiving someone else's parcel details.
//   3. State is the SET of numbers already emailed, never a boolean. That is
//      what makes a second parcel send its own email and a corrected number
//      resend itself, with no special case for either. GMG bills shipping per
//      brand and each brand ships separately, so one order having several
//      numbers is the normal case, not an edge case.
//
// See docs/superpowers/specs/2026-10-16-tracking-number-email-design.md.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== 'undefined' ? window : null, function () {

  const SHIPPABLE = ['PAID', 'BANK_TRANSFER'];

  // Mirrors trackingNumbersFromText in Sales Ops: the same field is typed by
  // the same human, so the same separators have to work on both sides.
  function parseNumbers(value) {
    return String(value === undefined || value === null ? '' : value)
      .split(/[\n,;/]+/)
      .map(function (item) { return item.trim(); })
      .filter(Boolean);
  }

  function unique(list) {
    const seen = {};
    const out = [];
    list.forEach(function (item) {
      if (seen[item]) return;
      seen[item] = true;
      out.push(item);
    });
    return out;
  }

  function decideSend(input) {
    const row = input.row;
    const orderId = row ? String(row.orderId || '') : String(input.orderId || '');

    if (!row) return { action: 'alert', reason: 'order-not-found', orderId: orderId };

    const status = String(row.status || '');
    if (SHIPPABLE.indexOf(status) === -1) {
      return { action: 'alert', reason: 'not-shippable', orderId: orderId, status: status };
    }

    const already = parseNumbers(row.trackingEmailed);
    const current = unique(
      (Array.isArray(input.trackingNumbers) ? input.trackingNumbers : [])
        .reduce(function (acc, item) { return acc.concat(parseNumbers(item)); }, [])
    );
    const newNumbers = current.filter(function (n) { return already.indexOf(n) === -1; });

    if (!newNumbers.length) {
      return { action: 'skip', reason: 'no-new-numbers', orderId: orderId };
    }

    const count = parseInt(row.packageCount, 10);
    return {
      action: 'send',
      orderId: orderId,
      newNumbers: newNumbers,
      isFirst: already.length === 0,
      packageCount: isFinite(count) && count > 0 ? count : 1,
      emailedAfter: already.concat(newNumbers).join('\n')
    };
  }

  return {
    SHIPPABLE: SHIPPABLE,
    parseNumbers: parseNumbers,
    decideSend: decideSend
  };
});
