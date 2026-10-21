const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseSet,
  formatSet,
  parseStatusMap,
  formatStatusMap,
  mapShippoStatus,
  decideRegistration,
  decideWebhook,
  decideTransitSweep,
  MOVING,
} = require('../parcel-status.js');

// ---------------------------------------------------------------- parseSet

test('parseSet returns an empty list for empty, null and undefined', () => {
  assert.deepStrictEqual(parseSet(''), []);
  assert.deepStrictEqual(parseSet(null), []);
  assert.deepStrictEqual(parseSet(undefined), []);
});

test('parseSet reads one number', () => {
  assert.deepStrictEqual(parseSet('9400111899223197428490'), ['9400111899223197428490']);
});

test('parseSet drops a trailing newline rather than yielding a blank', () => {
  assert.deepStrictEqual(parseSet('aaa\nbbb\n'), ['aaa', 'bbb']);
});

test('parseSet trims padding', () => {
  assert.deepStrictEqual(parseSet('  aaa  \n\t bbb'), ['aaa', 'bbb']);
});

test('parseSet collapses duplicates and preserves first-seen order', () => {
  assert.deepStrictEqual(parseSet('bbb\naaa\nbbb'), ['bbb', 'aaa']);
});

test('formatSet round-trips through parseSet', () => {
  assert.deepStrictEqual(parseSet(formatSet(['aaa', 'bbb'])), ['aaa', 'bbb']);
});

// ----------------------------------------------------------- parseStatusMap

test('parseStatusMap reads number=status lines', () => {
  assert.deepStrictEqual(parseStatusMap('aaa=In Transit\nbbb=Delivered'), [
    { number: 'aaa', status: 'In Transit' },
    { number: 'bbb', status: 'Delivered' },
  ]);
});

test('parseStatusMap round-trips through formatStatusMap', () => {
  const entries = [
    { number: 'aaa', status: 'In Transit' },
    { number: 'bbb', status: 'Delivered' },
  ];
  assert.deepStrictEqual(parseStatusMap(formatStatusMap(entries)), entries);
});

test('parseStatusMap drops a malformed line instead of throwing', () => {
  assert.deepStrictEqual(parseStatusMap('aaa=Delivered\ngarbage\n=orphan\nbbb='), [
    { number: 'aaa', status: 'Delivered' },
  ]);
});

test('parseStatusMap is empty for empty input', () => {
  assert.deepStrictEqual(parseStatusMap(''), []);
  assert.deepStrictEqual(parseStatusMap(undefined), []);
});

// --------------------------------------------------------- mapShippoStatus

test('mapShippoStatus maps the documented Shippo enum', () => {
  assert.deepStrictEqual(mapShippoStatus('DELIVERED'), { status: 'Delivered' });
  assert.deepStrictEqual(mapShippoStatus('TRANSIT'), { status: 'In Transit' });
  assert.deepStrictEqual(mapShippoStatus('PRE_TRANSIT'), { status: 'Label Created' });
  assert.deepStrictEqual(mapShippoStatus('RETURNED'), { status: 'Exception' });
  assert.deepStrictEqual(mapShippoStatus('FAILURE'), { status: 'Exception' });
});

// A PUSHED unknown means the carrier has no scan yet, which is normal. Sales
// Ops maps UNKNOWN to Exception because there it means a LOOKUP failed; that
// reasoning does not carry over, and paging the owner on it would be noise.
test('mapShippoStatus treats a pushed UNKNOWN as Label Created, not Exception', () => {
  assert.deepStrictEqual(mapShippoStatus('UNKNOWN'), { status: 'Label Created' });
});

test('mapShippoStatus is case and whitespace insensitive', () => {
  assert.deepStrictEqual(mapShippoStatus('  delivered '), { status: 'Delivered' });
});

test('mapShippoStatus reports anything outside the enum rather than defaulting', () => {
  assert.deepStrictEqual(mapShippoStatus('SOMETHING_NEW'), { unknown: true });
  assert.deepStrictEqual(mapShippoStatus(''), { unknown: true });
  assert.deepStrictEqual(mapShippoStatus(undefined), { unknown: true });
});

// ------------------------------------------------------- decideRegistration

test('decideRegistration returns only numbers not already registered', () => {
  const out = decideRegistration({
    trackingNumbers: ['aaa', 'bbb', 'ccc'],
    trackingRegistered: 'bbb',
  });
  assert.deepStrictEqual(out, { toRegister: ['aaa', 'ccc'] });
});

test('decideRegistration returns nothing when all are registered', () => {
  const out = decideRegistration({
    trackingNumbers: ['aaa', 'bbb'],
    trackingRegistered: 'aaa\nbbb',
  });
  assert.deepStrictEqual(out, { toRegister: [] });
});

test('decideRegistration collapses duplicates in its input', () => {
  const out = decideRegistration({ trackingNumbers: ['aaa', 'aaa'], trackingRegistered: '' });
  assert.deepStrictEqual(out, { toRegister: ['aaa'] });
});

test('decideRegistration handles a missing tracking list', () => {
  assert.deepStrictEqual(decideRegistration({ trackingRegistered: '' }), { toRegister: [] });
});

// ------------------------------------------------------------ decideWebhook

function rows() {
  return [
    {
      orderId: 'ORDER-1',
      trackingRegistered: 'aaa\nbbb',
      parcelStatus: 'aaa=In Transit',
      transitEmailed: 'aaa',
      deliveredEmailed: '',
    },
    {
      orderId: 'ORDER-2',
      trackingRegistered: 'ccc',
      parcelStatus: '',
      transitEmailed: '',
      deliveredEmailed: '',
    },
  ];
}

test('decideWebhook alerts on a number registered against no order', () => {
  const out = decideWebhook({ rows: rows(), trackingNumber: 'zzz', rawStatus: 'TRANSIT' });
  assert.strictEqual(out.action, 'alert');
  assert.strictEqual(out.reason, 'unknown-number');
  assert.strictEqual(out.trackingNumber, 'zzz');
});

test('decideWebhook alerts when one number is registered against two orders', () => {
  const two = rows();
  two[1].trackingRegistered = 'aaa';
  const out = decideWebhook({ rows: two, trackingNumber: 'aaa', rawStatus: 'TRANSIT' });
  assert.strictEqual(out.action, 'alert');
  assert.strictEqual(out.reason, 'ambiguous-number');
});

test('decideWebhook alerts on an unrecognised status before matching a row', () => {
  const out = decideWebhook({ rows: rows(), trackingNumber: 'aaa', rawStatus: 'WAT' });
  assert.strictEqual(out.action, 'alert');
  assert.strictEqual(out.reason, 'unknown-status');
  assert.strictEqual(out.rawStatus, 'WAT');
});

test('decideWebhook records a transit event and sends nothing', () => {
  const out = decideWebhook({ rows: rows(), trackingNumber: 'bbb', rawStatus: 'TRANSIT' });
  assert.strictEqual(out.action, 'record');
  assert.strictEqual(out.orderId, 'ORDER-1');
  assert.strictEqual(out.status, 'In Transit');
  assert.deepStrictEqual(parseStatusMap(out.parcelStatusAfter), [
    { number: 'aaa', status: 'In Transit' },
    { number: 'bbb', status: 'In Transit' },
  ]);
});

test('decideWebhook updates an existing parcel in place rather than appending twice', () => {
  const out = decideWebhook({ rows: rows(), trackingNumber: 'aaa', rawStatus: 'DELIVERED' });
  assert.deepStrictEqual(parseStatusMap(out.parcelStatusAfter), [
    { number: 'aaa', status: 'Delivered' },
  ]);
});

test('decideWebhook delivers a parcel and counts the siblings still out', () => {
  const out = decideWebhook({ rows: rows(), trackingNumber: 'aaa', rawStatus: 'DELIVERED' });
  assert.strictEqual(out.action, 'deliver');
  assert.strictEqual(out.orderId, 'ORDER-1');
  assert.strictEqual(out.trackingNumber, 'aaa');
  assert.deepStrictEqual(parseSet(out.deliveredAfter), ['aaa']);
  // bbb is registered and not delivered, so one parcel is still outstanding.
  assert.strictEqual(out.outstanding, 1);
});

test('decideWebhook reports no outstanding parcels on the last delivery', () => {
  const one = rows();
  one[0].trackingRegistered = 'aaa';
  const out = decideWebhook({ rows: one, trackingNumber: 'aaa', rawStatus: 'DELIVERED' });
  assert.strictEqual(out.outstanding, 0);
});

test('decideWebhook does not resend a parcel already in deliveredEmailed', () => {
  const sent = rows();
  sent[0].deliveredEmailed = 'aaa';
  const out = decideWebhook({ rows: sent, trackingNumber: 'aaa', rawStatus: 'DELIVERED' });
  assert.strictEqual(out.action, 'record');
});

test('decideWebhook routes a returned parcel to the owner, never the customer', () => {
  const out = decideWebhook({ rows: rows(), trackingNumber: 'ccc', rawStatus: 'RETURNED' });
  assert.strictEqual(out.action, 'exception');
  assert.strictEqual(out.orderId, 'ORDER-2');
  assert.strictEqual(out.status, 'Exception');
});

test('decideWebhook trims the incoming number before matching', () => {
  const out = decideWebhook({ rows: rows(), trackingNumber: '  bbb ', rawStatus: 'TRANSIT' });
  assert.strictEqual(out.action, 'record');
  assert.strictEqual(out.orderId, 'ORDER-1');
});

// -------------------------------------------------------- decideTransitSweep

test('decideTransitSweep skips an order with nothing moving', () => {
  const out = decideTransitSweep({
    row: { orderId: 'ORDER-1', parcelStatus: 'aaa=Label Created', trackingRegistered: 'aaa' },
  });
  assert.deepStrictEqual(out, { action: 'skip', orderId: 'ORDER-1' });
});

test('decideTransitSweep combines two newly moving parcels into one send', () => {
  const out = decideTransitSweep({
    row: {
      orderId: 'ORDER-1',
      trackingRegistered: 'aaa\nbbb',
      parcelStatus: 'aaa=In Transit\nbbb=Accepted',
      transitEmailed: '',
      deliveredEmailed: '',
    },
  });
  assert.strictEqual(out.action, 'send');
  assert.deepStrictEqual(out.newNumbers, ['aaa', 'bbb']);
  assert.strictEqual(out.totalParcels, 2);
  assert.deepStrictEqual(parseSet(out.transitAfter), ['aaa', 'bbb']);
});

test('decideTransitSweep excludes a parcel already announced', () => {
  const out = decideTransitSweep({
    row: {
      orderId: 'ORDER-1',
      trackingRegistered: 'aaa\nbbb',
      parcelStatus: 'aaa=In Transit\nbbb=In Transit',
      transitEmailed: 'aaa',
      deliveredEmailed: '',
    },
  });
  assert.strictEqual(out.action, 'send');
  assert.deepStrictEqual(out.newNumbers, ['bbb']);
  assert.deepStrictEqual(parseSet(out.transitAfter), ['aaa', 'bbb']);
});

test('decideTransitSweep skips once every moving parcel has been announced', () => {
  const out = decideTransitSweep({
    row: {
      orderId: 'ORDER-1',
      trackingRegistered: 'aaa',
      parcelStatus: 'aaa=In Transit',
      transitEmailed: 'aaa',
      deliveredEmailed: '',
    },
  });
  assert.strictEqual(out.action, 'skip');
});

// Telling someone a parcel is on its way after it has already landed is worse
// than saying nothing at all.
test('decideTransitSweep never announces a parcel that has already been delivered', () => {
  const out = decideTransitSweep({
    row: {
      orderId: 'ORDER-1',
      trackingRegistered: 'aaa',
      parcelStatus: 'aaa=In Transit',
      transitEmailed: '',
      deliveredEmailed: 'aaa',
    },
  });
  assert.strictEqual(out.action, 'skip');
});

test('decideTransitSweep treats Accepted as moving', () => {
  assert.deepStrictEqual(MOVING, ['In Transit', 'Accepted']);
});

test('decideTransitSweep handles an order with no status recorded yet', () => {
  const out = decideTransitSweep({ row: { orderId: 'ORDER-1', trackingRegistered: 'aaa' } });
  assert.strictEqual(out.action, 'skip');
});
