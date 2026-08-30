// peptide-calc.js — GOD MUSCLE GEARS
// Pure peptide reconstitution / dosing math. No DOM, no network, no storage.
// Loaded in the browser before the page's inline script; also require()-able
// for node --test.
//
// This is arithmetic a customer acts on WITH A NEEDLE. Every guard here is
// covered by tests/peptide-calc.test.js, and those tests are mutation-checked.
//
// Rules that must never be relaxed:
//   1. An invalid input NEVER produces NaN or Infinity on screen. It produces
//      valid:false and a reason the page can show.
//   2. dosesPerVial is FLOORED. A vial giving 13.33 doses gives 13 you can
//      actually draw; the remainder is residue.
//   3. Overflow is REPORTED, never clamped. The caller may cap a progress bar
//      at 100%, but the number it prints is the true one.

// NOTE: unlike shipping.js, this attaches under a single `PeptideCalc`
// namespace rather than spraying its exports onto window. `calculate`,
// `PRESETS` and `DEFAULTS` are names another script could plausibly want, and
// this page also loads chat-widget.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PeptideCalc = api;
})(typeof window !== 'undefined' ? window : null, function () {

  // A standard insulin syringe: 100 units = 1 mL, so 1 unit = 0.01 mL.
  const SYRINGE_UNITS = 100;
  const UNITS_PER_ML  = 100;

  // Rounding guard. (0.3 / 10) * 1 * 100 is 2.9999999999999996 in binary
  // floating point; without this the page would print "3.00" while a test
  // asserting 3 would fail, and comparisons against the overflow boundary
  // would be arbitrary. 10 significant-ish decimals is far finer than any
  // dose anyone measures and comfortably clear of the error.
  function clean(value) {
    return Number(value.toFixed(10));
  }

  // Preset chips.
  //
  // mg strengths are tailored to what GOD MUSCLE GEARS actually sells:
  //   0.1  IGF-1 LR-3
  //   5    BPC-157, Ipamorelin, Semaglutide, Sermorelin, Semax
  //   10   BPC-157 (Xeno), Epitalon, Semaglutide (Xeno)
  // The reference site's 50mg is deliberately absent — no GMG product has it,
  // and offering it invites a calculation for a vial the customer cannot buy.
  //
  // IU rows serve HGH (100IU) and NADOPEX HCG (5000IU). The two sit at very
  // different scales, so each row spans both, ascending.
  //
  // Water is mL in BOTH modes and is therefore identical in each.
  const WATER_ML = [0.5, 1, 1.5, 2, 2.5, 3];

  const PRESETS = {
    mg: {
      dose:     [0.1, 0.25, 0.5, 1, 2, 2.5, 5, 7.5, 10, 12.5, 15],
      strength: [0.1, 2, 5, 10, 15, 20],
      water:    WATER_ML
    },
    IU: {
      dose:     [1, 2, 4, 5, 8, 10, 250, 500, 1000, 2500],
      strength: [10, 36, 100, 2000, 5000, 10000],
      water:    WATER_ML
    }
  };

  // Opening state. Both must be valid and non-overflowing — a calculator that
  // loads showing a warning teaches people to ignore the warning.
  const DEFAULTS = {
    mg: { dose: 0.5, strength: 10, water: 1 },
    IU: { dose: 5,   strength: 100, water: 1 }
  };

  function positiveNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }

  function invalid(reason) {
    return {
      valid: false,
      reason: reason,
      units: null,
      mL: null,
      concentration: null,
      dosesPerVial: null,
      overflow: false
    };
  }

  // dose / strength is a DIMENSIONLESS RATIO, so mg and IU share one formula.
  // `unit` is carried through for labelling only and never branches the math.
  // This is why IU support costs a preset table rather than a second code path.
  function calculate(input) {
    const opts     = input || {};
    const dose     = positiveNumber(opts.dose);
    const strength = positiveNumber(opts.strength);
    const water    = positiveNumber(opts.water);

    if (strength === null) return invalid('Enter a vial strength greater than zero.');
    if (water === null)    return invalid('Enter a water volume greater than zero.');
    if (dose === null)     return invalid('Enter a dose greater than zero.');

    const mL    = clean((dose / strength) * water);
    const units = clean(mL * UNITS_PER_ML);

    return {
      valid: true,
      reason: '',
      units: units,
      mL: mL,
      concentration: clean(strength / water),
      // Floored: a vial yielding 13.33 doses yields 13 drawable ones.
      dosesPerVial: Math.floor(clean(strength / dose)),
      overflow: units > SYRINGE_UNITS
    };
  }

  return {
    SYRINGE_UNITS: SYRINGE_UNITS,
    UNITS_PER_ML: UNITS_PER_ML,
    PRESETS: PRESETS,
    DEFAULTS: DEFAULTS,
    calculate: calculate
  };
});
