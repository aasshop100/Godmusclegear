// parcel-status.js — GOD MUSCLE GEARS
// Decides what a parcel status change owes the customer: which parcels have
// landed, which are newly on their way, and which numbers still need
// registering with the carrier. No DOM, no network, no storage, no clock —
// timestamps are the caller's problem.
//
// Unit-tested here, then the BODY of this module is inlined flat into three
// n8n Code nodes. The UMD wrapper below CANNOT run in a Code node: `module`
// and `window` are both undefined there, so the wrapper would build the API
// and discard it, leaving every function unreachable. Strip the wrapper when
// pasting, and verify the paste behaviourally — never by hash.
//
// Rules that must never be relaxed:
//   1. Every piece of state is a SET, never a boolean. The work to do is a
//      difference, which is what makes a second parcel, a corrected number
//      and a re-delivery all fall out of one rule with no special case.
//   2. A status outside Shippo's documented enum is REPORTED, never mapped to
//      a default. Guessing here emails a customer about something nobody
//      understood.
//   3. A number that is not registered against exactly one order is reported.
//      The cost of guessing is a stranger receiving someone else's parcel.
//   4. Exceptions never reach the customer. A seizure or a loss is a reship
//      conversation.
//
// See docs/superpowers/specs/2026-10-21-parcel-status-emails-design.md.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== 'undefined' ? window : null, function () {

  // A parcel the carrier is actually moving. "Accepted" counts: it means the
  // carrier has the parcel, which is exactly what the customer is being told.
  const MOVING = ['In Transit', 'Accepted'];

  // Shippo's documented tracking enum. Anything absent from this table is
  // reported rather than guessed at — see rule 2.
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

  // The same separators as parseNumbers in tracking-email.js. These columns
  // are machine-written and newline-only in practice, but the same numbers
  // flow through both modules and a tracking number never contains one of
  // these characters, so one behaviour is better than two.
  function parseSet(value) {
    const list = String(value === undefined || value === null ? '' : value)
      .split(/[\n,;/]+/)
      .map(function (item) { return item.trim(); })
      .filter(Boolean);

    const seen = {};
    const out = [];
    list.forEach(function (item) {
      if (seen[item]) return;
      seen[item] = true;
      out.push(item);
    });
    return out;
  }

  function formatSet(list) {
    return (Array.isArray(list) ? list : []).join('\n');
  }

  // One `<number>=<status>` per line. A line without both halves is dropped:
  // a malformed cell must not take down a run that is otherwise fine.
  function parseStatusMap(value) {
    return String(value === undefined || value === null ? '' : value)
      .split(/\n+/)
      .map(function (line) {
        const at = line.indexOf('=');
        if (at < 1) return null;
        const number = line.slice(0, at).trim();
        const status = line.slice(at + 1).trim();
        if (!number || !status) return null;
        return { number: number, status: status };
      })
      .filter(Boolean);
  }

  function formatStatusMap(entries) {
    return (Array.isArray(entries) ? entries : [])
      .map(function (entry) { return entry.number + '=' + entry.status; })
      .join('\n');
  }

  function mapShippoStatus(raw) {
    const key = String(raw === undefined || raw === null ? '' : raw).trim().toUpperCase();
    const mapped = Object.prototype.hasOwnProperty.call(SHIPPO_STATUS, key)
      ? SHIPPO_STATUS[key]
      : null;
    return mapped ? { status: mapped } : { unknown: true };
  }

  // Update one parcel in place, or append it. In place matters: appending a
  // second line for the same number would leave two statuses for one parcel
  // and make "is it delivered" ambiguous forever.
  function upsertStatus(entries, number, status) {
    let found = false;
    const out = entries.map(function (entry) {
      if (entry.number !== number) return entry;
      found = true;
      return { number: number, status: status };
    });
    if (!found) out.push({ number: number, status: status });
    return out;
  }

  function statusOf(entries, number) {
    let status = '';
    entries.forEach(function (entry) {
      if (entry.number === number) status = entry.status;
    });
    return status;
  }

  function decideRegistration(input) {
    const registered = parseSet(input && input.trackingRegistered);
    const current = parseSet(
      (Array.isArray(input && input.trackingNumbers) ? input.trackingNumbers : []).join('\n')
    );
    return {
      toRegister: current.filter(function (n) { return registered.indexOf(n) === -1; })
    };
  }

  function decideWebhook(input) {
    const trackingNumber = String((input && input.trackingNumber) || '').trim();
    const rawStatus = (input && input.rawStatus) !== undefined ? input.rawStatus : '';

    // Status first. An unrecognised status is wrong no matter which order the
    // number belongs to, and resolving the row would only add noise.
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

    // THE AUTHORISATION GATE. Shippo does not sign these callbacks, so the
    // endpoint being hard to guess is not by itself authorisation. Requiring
    // the number to already be registered means forging a status needs both
    // the URL and a genuine number we chose to register.
    const matches = (Array.isArray(input && input.rows) ? input.rows : []).filter(function (row) {
      return parseSet(row && row.trackingRegistered).indexOf(trackingNumber) !== -1;
    });

    if (matches.length === 0) {
      return { action: 'alert', reason: 'unknown-number', trackingNumber: trackingNumber };
    }
    if (matches.length > 1) {
      return { action: 'alert', reason: 'ambiguous-number', trackingNumber: trackingNumber };
    }

    const row = matches[0];
    const orderId = String(row.orderId || '');
    const entries = upsertStatus(parseStatusMap(row.parcelStatus), trackingNumber, status);
    const parcelStatusAfter = formatStatusMap(entries);

    const base = {
      orderId: orderId,
      trackingNumber: trackingNumber,
      status: status,
      parcelStatusAfter: parcelStatusAfter
    };

    if (status === 'Exception') {
      return Object.assign({ action: 'exception' }, base);
    }

    if (status === 'Delivered') {
      const already = parseSet(row.deliveredEmailed);
      if (already.indexOf(trackingNumber) !== -1) {
        // Already told them about this parcel. Record the status, say nothing.
        return Object.assign({ action: 'record' }, base);
      }

      // Registered parcels on this order that are not yet delivered, counted
      // against the UPDATED map so this parcel is not counted as outstanding.
      const outstanding = parseSet(row.trackingRegistered).filter(function (n) {
        return statusOf(entries, n) !== 'Delivered';
      }).length;

      return Object.assign({ action: 'deliver' }, base, {
        deliveredAfter: formatSet(already.concat([trackingNumber])),
        outstanding: outstanding
      });
    }

    return Object.assign({ action: 'record' }, base);
  }

  function decideTransitSweep(input) {
    const row = (input && input.row) || {};
    const orderId = String(row.orderId || '');

    const entries = parseStatusMap(row.parcelStatus);
    const announced = parseSet(row.transitEmailed);
    const delivered = parseSet(row.deliveredEmailed);

    const newNumbers = entries
      .filter(function (entry) { return MOVING.indexOf(entry.status) !== -1; })
      .map(function (entry) { return entry.number; })
      .filter(function (number) {
        if (announced.indexOf(number) !== -1) return false;
        // Telling someone a parcel is on its way after it has already landed
        // is worse than saying nothing at all.
        if (delivered.indexOf(number) !== -1) return false;
        return true;
      });

    if (!newNumbers.length) return { action: 'skip', orderId: orderId };

    const registered = parseSet(row.trackingRegistered);
    return {
      action: 'send',
      orderId: orderId,
      newNumbers: newNumbers,
      transitAfter: formatSet(announced.concat(newNumbers)),
      totalParcels: registered.length || entries.length
    };
  }

  return {
    MOVING: MOVING,
    parseSet: parseSet,
    formatSet: formatSet,
    parseStatusMap: parseStatusMap,
    formatStatusMap: formatStatusMap,
    mapShippoStatus: mapShippoStatus,
    decideRegistration: decideRegistration,
    decideWebhook: decideWebhook,
    decideTransitSweep: decideTransitSweep
  };
});
