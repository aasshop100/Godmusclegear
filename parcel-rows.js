// parcel-rows.js — GOD MUSCLE GEARS
// Decides what a parcel status change owes the customer, over ONE ROW PER
// PARCEL. No DOM, no network, no storage, no clock — the cutoff is passed in.
//
// Replaces parcel-status.js, which held every parcel of an order in one
// newline-separated cell. That shape created a race: the receiver read the
// cell, computed a new value and wrote it back across a ~2.5–3 second window,
// so two parcels of one order delivered inside that window lost a stamp and
// sent the customer a duplicate. With one row per parcel the two writes touch
// DIFFERENT ROWS and cannot collide — not "rarely", *cannot*.
//
// It also serves orders that never went through the website. A `source`
// column says which kind a parcel came from and `orderRef` points back at it.
//
// Unit-tested here, then the BODY is inlined flat into the n8n Code nodes.
// The UMD wrapper below CANNOT run there: `module` and `window` are both
// undefined, so it would build the API and discard it. Strip the wrapper when
// pasting and verify behaviourally — never by hash.
//
// Rules that must never be relaxed:
//   1. A number with no parcel row is REFUSED. Shippo does not sign its
//      callbacks, so that check is the authorisation gate, not a validation.
//   2. A status outside Shippo's documented enum is REPORTED, never mapped
//      to a default. Guessing emails a customer about something nobody
//      understood.
//   3. A number matching two rows is reported, never picked between.
//   4. Exceptions go to the owner. A seizure or a loss is a conversation.
//   5. `Delivered` is terminal everywhere — it is what stops the
//      reconciliation sweep growing without bound.
//
// See docs/superpowers/specs/2026-10-21-sales-ops-parcel-emails-design.md.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== 'undefined' ? window : null, function () {

  // "Accepted" counts: the carrier has the parcel, which is what the customer
  // is being told.
  const MOVING = ['In Transit', 'Accepted'];

  const SHIPPO_STATUS = {
    DELIVERED: 'Delivered',
    TRANSIT: 'In Transit',
    PRE_TRANSIT: 'Label Created',
    RETURNED: 'Exception',
    FAILURE: 'Exception',
    // A PUSHED unknown means the carrier has no scan yet, which is ordinary.
    // Sales Ops maps UNKNOWN to Exception because there it means a LOOKUP
    // failed; that reasoning does not carry over, and paging the owner every
    // time a fresh label has not been scanned would be pure noise.
    UNKNOWN: 'Label Created'
  };

  function text(value) {
    return String(value === undefined || value === null ? '' : value).trim();
  }

  // The yes/no columns are PLAIN TEXT, never checkboxes. A checkbox column
  // carries data validation, and a FALSE fill has previously pushed appended
  // rows past the end of the data on this spreadsheet.
  function isYes(value) {
    return text(value).toLowerCase() === 'yes';
  }

  function mapShippoStatus(raw) {
    const key = text(raw).toUpperCase();
    const mapped = Object.prototype.hasOwnProperty.call(SHIPPO_STATUS, key)
      ? SHIPPO_STATUS[key]
      : null;
    return mapped ? { status: mapped } : { unknown: true };
  }

  function rowsOf(input) {
    return Array.isArray(input && input.parcels) ? input.parcels : [];
  }

  function decideRegistration(input) {
    const known = {};
    rowsOf(input).forEach(function (row) {
      known[text(row && row.trackingNumber)] = true;
    });

    const seen = {};
    const out = [];
    (Array.isArray(input && input.trackingNumbers) ? input.trackingNumbers : []).forEach(
      function (raw) {
        const number = text(raw);
        if (!number || known[number] || seen[number]) return;
        seen[number] = true;
        out.push(number);
      },
    );

    return { toRegister: out };
  }

  function decideWebhook(input) {
    const trackingNumber = text(input && input.trackingNumber);
    const rawStatus = (input && input.rawStatus) !== undefined ? input.rawStatus : '';

    // Status first. An unrecognised status is wrong whichever parcel it is
    // about, so resolving the row would only add noise to the alert.
    const mapped = mapShippoStatus(rawStatus);
    if (mapped.unknown) {
      return {
        action: 'alert',
        reason: 'unknown-status',
        trackingNumber: trackingNumber,
        rawStatus: String(rawStatus)
      };
    }
    const status = mapped.status;

    const parcels = rowsOf(input);
    const matches = parcels.filter(function (row) {
      return text(row && row.trackingNumber) === trackingNumber;
    });

    // THE AUTHORISATION GATE — see rule 1.
    if (matches.length === 0) {
      return { action: 'alert', reason: 'unknown-number', trackingNumber: trackingNumber };
    }
    if (matches.length > 1) {
      return { action: 'alert', reason: 'ambiguous-number', trackingNumber: trackingNumber };
    }

    const row = matches[0];
    const base = {
      trackingNumber: trackingNumber,
      orderRef: text(row.orderRef),
      source: text(row.source),
      status: status
    };

    if (status === 'Exception') {
      return Object.assign({ action: 'exception' }, base);
    }

    if (status === 'Delivered') {
      if (isYes(row.deliveredEmailed)) {
        // Already told them about this parcel. Record it, say nothing.
        return Object.assign({ action: 'record' }, base);
      }

      // Siblings of THIS order only, counted as they will stand once this
      // parcel is marked delivered.
      const outstanding = parcels.filter(function (other) {
        if (text(other.orderRef) !== base.orderRef) return false;
        if (text(other.trackingNumber) === trackingNumber) return false;
        return text(other.status) !== 'Delivered';
      }).length;

      return Object.assign({ action: 'deliver' }, base, { outstanding: outstanding });
    }

    return Object.assign({ action: 'record' }, base);
  }

  // One item per ORDER, not per parcel: two parcels that start moving between
  // sweeps are announced in a single email, while a parcel that moves a week
  // later gets its own.
  function decideTransitSweep(input) {
    const byOrder = {};
    const order = [];

    rowsOf(input).forEach(function (row) {
      if (MOVING.indexOf(text(row.status)) === -1) return;
      if (isYes(row.transitEmailed)) return;
      // Telling someone a parcel is on its way after it has already landed is
      // worse than saying nothing at all.
      if (isYes(row.deliveredEmailed)) return;

      const ref = text(row.orderRef);
      if (!byOrder[ref]) {
        byOrder[ref] = { orderRef: ref, source: text(row.source), newNumbers: [] };
        order.push(ref);
      }
      byOrder[ref].newNumbers.push(text(row.trackingNumber));
    });

    return order.map(function (ref) { return byOrder[ref]; });
  }

  // The net under the webhook: a callback that never arrives looks exactly
  // like a parcel that never moved. `cutoff` is a Manila timestamp string in
  // the sheet's own format, which sorts lexically — do not change that format
  // without changing this comparison.
  function decideStale(input) {
    const cutoff = text(input && input.cutoff);

    return rowsOf(input).filter(function (row) {
      if (!isYes(row.registered)) return false;
      if (text(row.status) === 'Delivered') return false;
      const stampedAt = text(row.statusAt);
      return !stampedAt || stampedAt < cutoff;
    }).map(function (row) {
      return {
        trackingNumber: text(row.trackingNumber),
        orderRef: text(row.orderRef),
        source: text(row.source),
        lastStatus: text(row.status) || 'none recorded',
        lastStampedAt: text(row.statusAt) || 'never'
      };
    });
  }

  return {
    MOVING: MOVING,
    isYes: isYes,
    mapShippoStatus: mapShippoStatus,
    decideRegistration: decideRegistration,
    decideWebhook: decideWebhook,
    decideTransitSweep: decideTransitSweep,
    decideStale: decideStale
  };
});
