const { test } = require('node:test');
const assert = require('node:assert');
const {
  MOVING,
  mapShippoStatus,
  decideRegistration,
  decideWebhook,
  decideTransitSweep,
  decideStale,
} = require('../parcel-rows.js');

// A parcels-tab row. One per parcel — which is the whole point: the per-order
// cells this replaces packed every parcel of an order into one newline list,
// so two parcels read the same cell and the second write erased the first.
const parcel = (over = {}) => ({
  trackingNumber: 'AAA',
  source: 'website',
  orderRef: 'ORDER-1',
  status: 'In Transit',
  statusAt: '2026-10-21 10:00:00',
  registered: 'yes',
  transitEmailed: '',
  deliveredEmailed: '',
  ...over,
});

// --------------------------------------------------------- mapShippoStatus

test('mapShippoStatus maps the documented enum and reports anything else', () => {
  assert.deepStrictEqual(mapShippoStatus('DELIVERED'), { status: 'Delivered' });
  assert.deepStrictEqual(mapShippoStatus('TRANSIT'), { status: 'In Transit' });
  assert.deepStrictEqual(mapShippoStatus('PRE_TRANSIT'), { status: 'Label Created' });
  assert.deepStrictEqual(mapShippoStatus('RETURNED'), { status: 'Exception' });
  assert.deepStrictEqual(mapShippoStatus('FAILURE'), { status: 'Exception' });
  assert.deepStrictEqual(mapShippoStatus('SOMETHING_NEW'), { unknown: true });
});

// A PUSHED unknown means the carrier has no scan yet, which is ordinary.
test('a pushed UNKNOWN is Label Created, not an Exception', () => {
  assert.deepStrictEqual(mapShippoStatus('UNKNOWN'), { status: 'Label Created' });
});

// ------------------------------------------------------- decideRegistration

test('decideRegistration returns numbers that have no parcel row yet', () => {
  const out = decideRegistration({
    trackingNumbers: ['AAA', 'BBB'],
    parcels: [parcel({ trackingNumber: 'AAA' })],
  });
  assert.deepStrictEqual(out.toRegister, ['BBB']);
});

test('decideRegistration returns nothing when every parcel already has a row', () => {
  const out = decideRegistration({
    trackingNumbers: ['AAA'],
    parcels: [parcel({ trackingNumber: 'AAA' })],
  });
  assert.deepStrictEqual(out.toRegister, []);
});

// ------------------------------------------------------------ decideWebhook

test('an unregistered number is refused — this is the authorisation gate', () => {
  const out = decideWebhook({ parcels: [parcel()], trackingNumber: 'ZZZ', rawStatus: 'TRANSIT' });
  assert.strictEqual(out.action, 'alert');
  assert.strictEqual(out.reason, 'unknown-number');
});

test('an unrecognised status is reported before the row is even looked up', () => {
  const out = decideWebhook({ parcels: [parcel()], trackingNumber: 'AAA', rawStatus: 'WAT' });
  assert.strictEqual(out.action, 'alert');
  assert.strictEqual(out.reason, 'unknown-status');
});

test('two rows for one number is reported, never guessed at', () => {
  const out = decideWebhook({
    parcels: [parcel(), parcel({ orderRef: 'ORDER-2' })],
    trackingNumber: 'AAA',
    rawStatus: 'TRANSIT',
  });
  assert.strictEqual(out.action, 'alert');
  assert.strictEqual(out.reason, 'ambiguous-number');
});

test('a transit event records the status and sends nothing', () => {
  const out = decideWebhook({
    parcels: [parcel({ status: 'Label Created' })],
    trackingNumber: 'AAA',
    rawStatus: 'TRANSIT',
  });
  assert.strictEqual(out.action, 'record');
  assert.strictEqual(out.status, 'In Transit');
  assert.strictEqual(out.orderRef, 'ORDER-1');
});

test('a delivered parcel counts only its OWN order siblings as outstanding', () => {
  const out = decideWebhook({
    parcels: [
      parcel({ trackingNumber: 'AAA' }),
      parcel({ trackingNumber: 'BBB' }),
      // A different order entirely — must not be counted.
      parcel({ trackingNumber: 'CCC', orderRef: 'ORDER-2' }),
    ],
    trackingNumber: 'AAA',
    rawStatus: 'DELIVERED',
  });

  assert.strictEqual(out.action, 'deliver');
  assert.strictEqual(out.outstanding, 1);
});

test('the last parcel of an order reports nothing outstanding', () => {
  const out = decideWebhook({
    parcels: [parcel({ trackingNumber: 'AAA' }), parcel({ trackingNumber: 'BBB', status: 'Delivered' })],
    trackingNumber: 'AAA',
    rawStatus: 'DELIVERED',
  });
  assert.strictEqual(out.outstanding, 0);
});

test('a parcel already emailed as delivered is recorded, not resent', () => {
  const out = decideWebhook({
    parcels: [parcel({ deliveredEmailed: 'yes' })],
    trackingNumber: 'AAA',
    rawStatus: 'DELIVERED',
  });
  assert.strictEqual(out.action, 'record');
});

test('a returned parcel goes to the owner, never the customer', () => {
  const out = decideWebhook({ parcels: [parcel()], trackingNumber: 'AAA', rawStatus: 'RETURNED' });
  assert.strictEqual(out.action, 'exception');
  assert.strictEqual(out.status, 'Exception');
});

test('the incoming number is trimmed before matching', () => {
  const out = decideWebhook({ parcels: [parcel()], trackingNumber: '  AAA ', rawStatus: 'TRANSIT' });
  assert.strictEqual(out.action, 'record');
});

// THE POINT OF THE WHOLE RESTRUCTURE. Two parcels of one order delivered at
// the same moment touch different rows, so neither can erase the other's
// stamp. Under the per-order cells this was a duplicate email waiting to
// happen.
test('two parcels of one order each resolve to their own row', () => {
  const parcels = [parcel({ trackingNumber: 'AAA' }), parcel({ trackingNumber: 'BBB' })];

  const a = decideWebhook({ parcels, trackingNumber: 'AAA', rawStatus: 'DELIVERED' });
  const b = decideWebhook({ parcels, trackingNumber: 'BBB', rawStatus: 'DELIVERED' });

  assert.strictEqual(a.trackingNumber, 'AAA');
  assert.strictEqual(b.trackingNumber, 'BBB');
  assert.strictEqual(a.action, 'deliver');
  assert.strictEqual(b.action, 'deliver');
});

// -------------------------------------------------------- decideTransitSweep

test('the sweep combines an order’s newly moving parcels into ONE email', () => {
  const out = decideTransitSweep({
    parcels: [
      parcel({ trackingNumber: 'AAA', status: 'In Transit' }),
      parcel({ trackingNumber: 'BBB', status: 'Accepted' }),
    ],
  });

  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].orderRef, 'ORDER-1');
  assert.deepStrictEqual(out[0].newNumbers, ['AAA', 'BBB']);
});

test('the sweep keeps separate orders separate', () => {
  const out = decideTransitSweep({
    parcels: [parcel({ trackingNumber: 'AAA' }), parcel({ trackingNumber: 'CCC', orderRef: 'ORDER-2' })],
  });
  assert.strictEqual(out.length, 2);
});

test('a parcel already announced is excluded', () => {
  const out = decideTransitSweep({
    parcels: [
      parcel({ trackingNumber: 'AAA', transitEmailed: 'yes' }),
      parcel({ trackingNumber: 'BBB' }),
    ],
  });
  assert.deepStrictEqual(out[0].newNumbers, ['BBB']);
});

test('the sweep says nothing when nothing is moving', () => {
  assert.deepStrictEqual(
    decideTransitSweep({ parcels: [parcel({ status: 'Label Created' })] }),
    [],
  );
});

// Telling someone a parcel is on its way after it has landed is worse than
// saying nothing at all.
test('a parcel already delivered is never announced as on its way', () => {
  const out = decideTransitSweep({
    parcels: [parcel({ status: 'In Transit', deliveredEmailed: 'yes' })],
  });
  assert.deepStrictEqual(out, []);
});

test('Accepted counts as moving', () => {
  assert.deepStrictEqual(MOVING, ['In Transit', 'Accepted']);
});

// --------------------------------------------------------------- decideStale

test('decideStale picks undelivered parcels whose status has gone quiet', () => {
  const out = decideStale({
    parcels: [parcel({ statusAt: '2026-10-10 00:00:00' })],
    cutoff: '2026-10-19 00:00:00',
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].trackingNumber, 'AAA');
});

test('decideStale leaves a recently updated parcel alone', () => {
  const out = decideStale({
    parcels: [parcel({ statusAt: '2026-10-21 00:00:00' })],
    cutoff: '2026-10-19 00:00:00',
  });
  assert.deepStrictEqual(out, []);
});

// Delivered is terminal. Skipping it is what keeps this sweep shrinking
// rather than re-checking every parcel ever shipped.
test('decideStale never re-checks a delivered parcel', () => {
  const out = decideStale({
    parcels: [parcel({ status: 'Delivered', statusAt: '2026-01-01 00:00:00' })],
    cutoff: '2026-10-19 00:00:00',
  });
  assert.deepStrictEqual(out, []);
});

test('decideStale treats a parcel with no timestamp as stale', () => {
  const out = decideStale({
    parcels: [parcel({ statusAt: '' })],
    cutoff: '2026-10-19 00:00:00',
  });
  assert.strictEqual(out.length, 1);
});
