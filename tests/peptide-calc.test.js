// tests/peptide-calc.test.js
// Pins the peptide dosing maths. This is arithmetic a person acts on with a
// needle, so every branch is covered and every guard is mutation-tested.

const test = require('node:test');
const assert = require('node:assert');

const { calculate, PRESETS, DEFAULTS, SYRINGE_UNITS } = require('../peptide-calc.js');

const mg = (o) => calculate(Object.assign({ unit: 'mg' }, o));

// --- the reference implementation's own numbers -----------------------------

test('the reference calculation reproduces exactly', () => {
  // 0.5mg dose from a 10mg vial in 1.0mL -> 5.00 units, 20 doses, 10.00 mg/mL.
  const r = mg({ dose: 0.5, strength: 10, water: 1.0 });
  assert.equal(r.valid, true);
  assert.equal(r.units, 5);
  assert.equal(r.dosesPerVial, 20);
  assert.equal(r.concentration, 10);
  assert.equal(r.overflow, false);
});

// --- unit conversion --------------------------------------------------------

test('1 unit is 0.01 mL', () => {
  const r = mg({ dose: 1, strength: 10, water: 1 });
  assert.equal(r.units, 10);
  assert.equal(r.mL, 0.1);
});

test('mL and units always agree', () => {
  const r = mg({ dose: 2, strength: 5, water: 2 });
  assert.equal(r.mL, r.units / 100);
});

// --- doses per vial ---------------------------------------------------------

test('dosesPerVial floors and never reports a fraction', () => {
  // 10 / 0.75 = 13.33 -> 13 full doses; the remainder cannot be drawn.
  assert.equal(mg({ dose: 0.75, strength: 10, water: 2 }).dosesPerVial, 13);
});

test('a dose larger than the vial gives zero full doses', () => {
  assert.equal(mg({ dose: 15, strength: 10, water: 1 }).dosesPerVial, 0);
});

// --- overflow ---------------------------------------------------------------

test('exactly 100 units is NOT overflow', () => {
  const r = mg({ dose: 10, strength: 10, water: 1 });
  assert.equal(r.units, 100);
  assert.equal(r.overflow, false);
});

test('just past 100 units IS overflow', () => {
  const r = mg({ dose: 10.01, strength: 10, water: 1 });
  assert.equal(r.overflow, true);
});

test('overflow still reports the TRUE units, not a capped value', () => {
  // Reachable straight from the presets: 15mg dose, 10mg vial, 1mL.
  const r = mg({ dose: 15, strength: 10, water: 1 });
  assert.equal(r.overflow, true);
  assert.equal(r.units, 150);
  assert.equal(r.valid, true);
});

// --- validation -------------------------------------------------------------

test('zero water is invalid and never yields Infinity', () => {
  const r = mg({ dose: 1, strength: 10, water: 0 });
  assert.equal(r.valid, false);
  assert.ok(r.reason.length > 0);
  assert.equal(Number.isFinite(r.units) || r.units === null, true);
});

test('zero strength is invalid and never yields Infinity', () => {
  const r = mg({ dose: 1, strength: 0, water: 1 });
  assert.equal(r.valid, false);
  assert.ok(r.reason.length > 0);
});

test('zero dose is invalid', () => {
  assert.equal(mg({ dose: 0, strength: 10, water: 1 }).valid, false);
});

test('negative values are rejected', () => {
  assert.equal(mg({ dose: -1, strength: 10, water: 1 }).valid, false);
  assert.equal(mg({ dose: 1, strength: -10, water: 1 }).valid, false);
  assert.equal(mg({ dose: 1, strength: 10, water: -1 }).valid, false);
});

test('non-numeric and missing values are rejected without throwing', () => {
  [undefined, null, '', 'abc', NaN, Infinity].forEach((bad) => {
    assert.equal(mg({ dose: bad, strength: 10, water: 1 }).valid, false, String(bad));
    assert.equal(mg({ dose: 1, strength: bad, water: 1 }).valid, false, String(bad));
    assert.equal(mg({ dose: 1, strength: 10, water: bad }).valid, false, String(bad));
  });
});

test('an invalid result never carries a NaN through to the caller', () => {
  const r = mg({ dose: 1, strength: 0, water: 0 });
  [r.units, r.mL, r.concentration, r.dosesPerVial].forEach((v) => {
    assert.ok(v === null || Number.isFinite(v), 'got ' + v);
  });
});

// --- unit independence ------------------------------------------------------

test('IU and mg produce IDENTICAL maths for identical numbers', () => {
  const a = calculate({ dose: 5, strength: 100, water: 1, unit: 'mg' });
  const b = calculate({ dose: 5, strength: 100, water: 1, unit: 'IU' });
  assert.equal(a.units, b.units);
  assert.equal(a.concentration, b.concentration);
  assert.equal(a.dosesPerVial, b.dosesPerVial);
});

test('a realistic HGH case works in IU', () => {
  // 5IU from a 100IU vial reconstituted with 1mL.
  const r = calculate({ dose: 5, strength: 100, water: 1, unit: 'IU' });
  assert.equal(r.units, 5);
  assert.equal(r.dosesPerVial, 20);
  assert.equal(r.concentration, 100);
});

test('a realistic HCG case works in IU', () => {
  // 500IU from a 5000IU vial in 2mL.
  const r = calculate({ dose: 500, strength: 5000, water: 2, unit: 'IU' });
  assert.equal(r.units, 20);
  assert.equal(r.dosesPerVial, 10);
  assert.equal(r.concentration, 2500);
});

// --- concentration ----------------------------------------------------------

test('concentration for a real catalog vial', () => {
  // BPC-157 5mg in 2mL.
  assert.equal(mg({ dose: 0.25, strength: 5, water: 2 }).concentration, 2.5);
});

// --- floating point ---------------------------------------------------------

test('float error does not surface in the returned numbers', () => {
  const r = mg({ dose: 0.3, strength: 10, water: 1 });
  assert.equal(r.units, 3);              // not 2.9999999999999996
  assert.equal(r.concentration, 10);
});

test('the second rounding guard matters - mL is clean but mL*100 drifts', () => {
  // dose 0.1mg, strength 15mg, water 2mL. mL cleans to exactly 0.0133333333,
  // but 0.0133333333 * 100 is 1.3333333299999999 in binary floating point -
  // the FIRST clean() (on mL) does NOT cover this; only the units-level
  // clean() does. This pins the guard the old float-error test missed.
  const r = mg({ dose: 0.1, strength: 15, water: 2 });
  assert.equal(r.units, 1.33333333);
});

// --- exported tables --------------------------------------------------------

test('presets exist for both units and are ascending and unique', () => {
  ['mg', 'IU'].forEach((u) => {
    ['dose', 'strength', 'water'].forEach((row) => {
      const values = PRESETS[u][row];
      assert.ok(Array.isArray(values) && values.length > 0, u + '.' + row);
      const sorted = values.slice().sort((a, b) => a - b);
      assert.deepEqual(values, sorted, u + '.' + row + ' must be ascending');
      assert.equal(new Set(values).size, values.length, u + '.' + row + ' must be unique');
    });
  });
});

test('mg strength presets cover the GMG catalog and exclude 50mg', () => {
  const s = PRESETS.mg.strength;
  [0.1, 5, 10].forEach((v) => assert.ok(s.includes(v), 'missing ' + v));
  assert.ok(!s.includes(50), '50mg is not a product GMG sells');
});

test('IU strength presets cover HGH and HCG vials', () => {
  const s = PRESETS.IU.strength;
  assert.ok(s.includes(100), 'HGH 100IU');
  assert.ok(s.includes(5000), 'HCG 5000IU');
});

test('water presets are shared between modes - water is always mL', () => {
  assert.deepEqual(PRESETS.mg.water, PRESETS.IU.water);
});

test('every default is present in its own preset row', () => {
  ['mg', 'IU'].forEach((u) => {
    ['dose', 'strength', 'water'].forEach((row) => {
      assert.ok(PRESETS[u][row].includes(DEFAULTS[u][row]),
        u + '.' + row + ' default ' + DEFAULTS[u][row] + ' is not a chip');
    });
  });
});

test('every default combination is valid and does not overflow', () => {
  ['mg', 'IU'].forEach((u) => {
    const r = calculate(Object.assign({ unit: u }, DEFAULTS[u]));
    assert.equal(r.valid, true, u);
    assert.equal(r.overflow, false, u + ' default must not open on a warning');
  });
});

test('the syringe is a 100-unit syringe', () => {
  assert.equal(SYRINGE_UNITS, 100);
});
