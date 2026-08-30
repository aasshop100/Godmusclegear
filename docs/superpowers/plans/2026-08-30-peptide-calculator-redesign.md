# Peptide Calculator Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two separate calculators on `peptide-calculator.html` with one live calculator — Dose / Strength / Water chip columns feeding a Results panel with an SVG syringe — backed by a unit-tested pure module.

**Architecture:** All arithmetic lives in a new pure module `peptide-calc.js` (no DOM, no network, no storage), exercised by `node --test`. The page reads chips and custom inputs, calls `calculate()`, and paints the result. This follows the pattern already used by `shipping.js`, `payment-matching.js` and `chain-parsing.js`.

**Tech Stack:** Plain HTML/CSS/JS, no build step. Bootstrap 5.3 (already on the page) for grid only. `node --test` for tests. Inline SVG for the syringe. Deploy is `git push origin main` → GitHub Pages.

## Global Constraints

- **No build step.** Plain ES5-compatible browser JS in the UMD wrapper style used by `shipping.js`. No frameworks, no bundler, no npm dependencies.
- **Test command is `node --test tests/*.test.js`** — NOT `node --test tests/`, which Node resolves as a module path and fails.
- **Branding:** `--orange #ff4500`, `--orange-light #fff2ee`, `--black #111111`, `--charcoal #2a2a2a`, `--grey #6b7280`, `--radius-lg 18px`. Headings use `'Barlow Condensed', sans-serif` uppercase; body uses `'DM Sans', sans-serif`. All already defined in `style.css`.
- **The formula never branches on unit.** `dose / strength` is dimensionless; `unit` labels output only.
- **`dosesPerVial` is floored**, never rounded, and is labelled "full doses".
- **Overflow (`units > 100`) is warned in text**, never signalled by colour alone.
- **Do not touch** `script.js`, `shipping.js`, `chain-parsing.js`, `payment-matching.js`, or any other page.
- **Preserve** the page's nav, footer, JSON-LD block, canonical URL, chat widget, Telegram float and the medical disclaimer.
- Commit after every task. Do not push until the final task.

---

## File Structure

| File | Responsibility |
|---|---|
| `peptide-calc.js` *(create)* | Pure calculation + the preset/default tables. Single source of truth for both the page and the tests. |
| `tests/peptide-calc.test.js` *(create)* | `node --test` coverage of the module. |
| `style.css` *(modify, append)* | Chip, column, results-panel and syringe styles. |
| `peptide-calculator.html` *(modify)* | Replace the calculator markup (lines 98–163) and the inline `<script>` (lines 231–261); update the "How to Use" block (lines 165–178) and SEO copy (lines 8–26). |

---

## Task 1: The `peptide-calc.js` module

**Files:**
- Create: `peptide-calc.js`
- Test: `tests/peptide-calc.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `calculate({ dose, strength, water, unit }) -> { valid, reason, units, mL, concentration, dosesPerVial, overflow }`
  - `PRESETS` — `{ mg: { dose: number[], strength: number[], water: number[] }, IU: {...} }`
  - `DEFAULTS` — `{ mg: { dose, strength, water }, IU: { dose, strength, water } }`
  - `SYRINGE_UNITS` — `100`

- [ ] **Step 1: Write the failing test**

Create `tests/peptide-calc.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/peptide-calc.test.js`

Expected: FAIL — `Cannot find module '../peptide-calc.js'`.

- [ ] **Step 3: Write the module**

Create `peptide-calc.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/peptide-calc.test.js`

Expected: PASS, `fail 0`.

- [ ] **Step 5: Run the whole suite for regressions**

Run: `node --test tests/*.test.js`

Expected: `fail 0`. The pre-existing count is 109, so expect roughly 135 total.

- [ ] **Step 6: Mutation-test the guards**

A test that has never failed proves nothing. Break each guard, confirm the suite catches it, then restore. Run each mutation one at a time against `node --test tests/peptide-calc.test.js`, and confirm `fail` is greater than 0 for every one:

| # | Mutation in `peptide-calc.js` | Must fail |
|---|---|---|
| 1 | `Math.floor(...)` → `Math.round(...)` | dosesPerVial floors |
| 2 | `units > SYRINGE_UNITS` → `units >= SYRINGE_UNITS` | exactly 100 is not overflow |
| 3 | `mL * UNITS_PER_ML` → `mL * 10` | reference calculation |
| 4 | `strength / water` → `water / strength` | concentration |
| 5 | delete the `clean()` call in `units` | float error |
| 6 | `n <= 0` → `n < 0` in `positiveNumber` | zero-value validation |
| 7 | Remove `50` check by adding `50` to `PRESETS.mg.strength` | catalog preset test |

After the final mutation, restore the file and re-run `node --test tests/*.test.js` to confirm `fail 0` before committing.

- [ ] **Step 7: Commit**

```bash
git add peptide-calc.js tests/peptide-calc.test.js
git commit -m "Add the pure peptide dosing module with tests"
```

---

## Task 2: Styles and static markup

**Files:**
- Modify: `style.css` (append at end of file)
- Modify: `peptide-calculator.html` (replace lines 98–163, the two `calculator-card` columns and their wrapping `<div class="row g-4 mb-5">`)

**Interfaces:**
- Consumes: `PRESETS`, `DEFAULTS` from Task 1 (referenced by the Task 3 script; this task renders chips as static markup that Task 3 will rebuild dynamically).
- Produces: DOM contract used by Task 3 —
  - `#unitToggle` — container with two `button.unit-btn[data-unit="mg"|"IU"]`
  - `#doseChips`, `#strengthChips`, `#waterChips` — chip row containers
  - `#doseCustom`, `#strengthCustom`, `#waterCustom` — `<input type="number">`
  - `#doseLabel`, `#strengthLabel` — unit-bearing column headings
  - `#resultDose`, `#resultUnits`, `#resultDoses`, `#resultConc` — result text nodes
  - `#syringeFill` — the SVG `<rect>` whose width is driven
  - `#calcWarning` — overflow / invalid message container
  - `#resultsBody` — wrapper toggled between empty state and results

- [ ] **Step 1: Append the styles**

Add to the end of `style.css`:

```css
/* ============================================================
   PEPTIDE CALCULATOR
   ============================================================ */

.calc-panel {
  background: var(--white);
  border: 1px solid rgba(17, 17, 17, 0.08);
  border-radius: var(--radius-lg);
  padding: 2rem;
  margin-bottom: 1.75rem;
}

.calc-unit-toggle {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: 2rem;
}

.unit-btn {
  font-family: 'DM Sans', sans-serif;
  font-size: 0.85rem;
  font-weight: 700;
  padding: 9px 26px;
  border-radius: 999px;
  border: 1.5px solid var(--black);
  background: transparent;
  color: var(--black);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.unit-btn[aria-pressed="true"] {
  background: var(--black);
  color: var(--white);
}

.unit-btn:focus-visible,
.calc-chip:focus-visible {
  outline: 3px solid var(--orange);
  outline-offset: 2px;
}

.calc-col-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 1.35rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  text-align: center;
  color: var(--black);
  margin-bottom: 1.1rem;
}

.calc-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-bottom: 1rem;
}

.calc-chip {
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 7px 16px;
  border-radius: 999px;
  border: 1.5px solid rgba(17, 17, 17, 0.18);
  background: var(--white);
  color: var(--charcoal);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.calc-chip:hover { border-color: var(--orange); color: var(--orange); }

.calc-chip[aria-pressed="true"] {
  background: var(--orange);
  border-color: var(--orange);
  color: var(--white);
}

.calc-custom {
  width: 100%;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.85rem;
  padding: 11px 16px;
  border-radius: 999px;
  border: 1.5px solid rgba(17, 17, 17, 0.18);
  background: var(--white);
  color: var(--charcoal);
}

.calc-custom:focus {
  outline: none;
  border-color: var(--orange);
}

/* Results ---------------------------------------------------- */

.calc-results-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 1.9rem;
  font-weight: 900;
  text-transform: uppercase;
  text-align: center;
  color: var(--black);
  margin-bottom: 1.5rem;
}

.calc-readout {
  text-align: center;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.9rem;
  color: var(--charcoal);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.calc-readout strong { color: var(--black); font-weight: 800; }

.calc-readout-lead strong {
  color: var(--orange);
  font-size: 1.15rem;
}

.calc-syringe { display: block; width: 100%; max-width: 780px; margin: 2rem auto; height: auto; }

.calc-empty {
  text-align: center;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.9rem;
  color: var(--grey);
  padding: 2.5rem 0;
}

.calc-warning {
  border: 1.5px solid var(--orange);
  background: var(--orange-light);
  border-radius: 12px;
  padding: 14px 18px;
  margin-top: 1.25rem;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.86rem;
  line-height: 1.6;
  color: var(--charcoal);
  text-align: center;
}

.calc-warning strong { color: var(--orange); }

@media (max-width: 767px) {
  .calc-panel { padding: 1.4rem; }
  .calc-col-title { margin-top: 1.25rem; }
  .calc-chip { font-size: 0.78rem; padding: 6px 13px; }
}
```

- [ ] **Step 2: Replace the calculator markup**

In `peptide-calculator.html`, delete everything from `<div class="row g-4 mb-5">` (line 100) through its closing `</div>` immediately before the `<!-- How To Use -->` comment (line 163), and put this in its place:

```html
    <!-- Inputs -->
    <div class="calc-panel">

      <div class="calc-unit-toggle" id="unitToggle" role="group" aria-label="Measurement unit">
        <button type="button" class="unit-btn" data-unit="mg" aria-pressed="true">mg</button>
        <button type="button" class="unit-btn" data-unit="IU" aria-pressed="false">IU</button>
      </div>

      <div class="row g-4">
        <div class="col-lg-4">
          <h3 class="calc-col-title" id="doseLabel">Dose of Peptide</h3>
          <div class="calc-chips" id="doseChips" role="group" aria-labelledby="doseLabel"></div>
          <input type="number" class="calc-custom" id="doseCustom" min="0" step="any"
                 placeholder="Enter custom dose (mg)" aria-label="Custom dose">
        </div>

        <div class="col-lg-4">
          <h3 class="calc-col-title" id="strengthLabel">Strength of Peptide</h3>
          <div class="calc-chips" id="strengthChips" role="group" aria-labelledby="strengthLabel"></div>
          <input type="number" class="calc-custom" id="strengthCustom" min="0" step="any"
                 placeholder="Enter custom strength (mg)" aria-label="Custom vial strength">
        </div>

        <div class="col-lg-4">
          <h3 class="calc-col-title" id="waterLabel">Water of Peptide</h3>
          <div class="calc-chips" id="waterChips" role="group" aria-labelledby="waterLabel"></div>
          <input type="number" class="calc-custom" id="waterCustom" min="0" step="any"
                 placeholder="Enter custom water (mL)" aria-label="Custom water volume">
        </div>
      </div>
    </div>

    <!-- Results -->
    <div class="calc-panel">
      <h2 class="calc-results-title">Results</h2>

      <div id="resultsEmpty" class="calc-empty" hidden>
        Choose a dose, a vial strength and a water volume to see your draw.
      </div>

      <div id="resultsBody" aria-live="polite">
        <p class="calc-readout">Peptide dose: <strong id="resultDose">—</strong></p>
        <p class="calc-readout calc-readout-lead">Draw syringe to: <strong id="resultUnits">—</strong></p>

        <svg class="calc-syringe" viewBox="0 0 800 190" role="img" aria-labelledby="syringeTitle">
          <title id="syringeTitle">Insulin syringe showing the fill level for your dose</title>

          <!-- needle -->
          <rect x="0" y="88" width="70" height="7" fill="#5b6b7a"></rect>
          <!-- hub -->
          <rect x="70" y="72" width="26" height="40" rx="4" fill="#5b6b7a"></rect>
          <!-- barrel -->
          <rect x="96" y="62" width="580" height="60" fill="#ffffff" stroke="#5b6b7a" stroke-width="7"></rect>
          <!-- liquid fill (width driven by JS) -->
          <rect id="syringeFill" x="99" y="65" width="0" height="54" fill="#ff4500" opacity="0.35"></rect>
          <!-- gradations, drawn by JS -->
          <g id="syringeTicks" fill="none" stroke="#5b6b7a" stroke-width="2"></g>
          <g id="syringeLabels" font-family="DM Sans, sans-serif" font-size="15" font-weight="700" fill="#5b6b7a" text-anchor="middle"></g>
          <!-- plunger -->
          <rect x="676" y="52" width="44" height="80" rx="4" fill="#5b6b7a"></rect>
          <rect x="720" y="84" width="60" height="16" fill="#5b6b7a"></rect>
          <rect x="780" y="46" width="14" height="92" rx="4" fill="#5b6b7a"></rect>
        </svg>

        <p class="calc-readout">Your vial contains: <strong id="resultDoses">—</strong></p>
        <p class="calc-readout">Concentration: <strong id="resultConc">—</strong></p>
      </div>

      <div id="calcWarning" class="calc-warning" hidden></div>
    </div>
```

- [ ] **Step 3: Verify it renders**

Start the preview and load the page. Confirm: the unit toggle shows mg selected, three column headings appear, the three custom inputs render as rounded pills, the Results panel shows the syringe outline with an empty barrel, and the readouts show em-dashes. Chip rows will be empty — Task 3 fills them.

Expected: no console errors; the syringe barrel, needle and plunger are visible.

- [ ] **Step 4: Commit**

```bash
git add style.css peptide-calculator.html
git commit -m "Add the calculator layout, chips styling and syringe SVG"
```

---

## Task 3: Wiring — chips, unit toggle, live results

**Files:**
- Modify: `peptide-calculator.html` — replace the inline `<script>` block (lines 231–261, containing `calculateReconstitution` and `calculateDosage`), and add the `peptide-calc.js` script tag.

**Interfaces:**
- Consumes: `calculate`, `PRESETS`, `DEFAULTS`, `SYRINGE_UNITS` from `peptide-calc.js` (Task 1); every DOM id from Task 2.
- Produces: nothing — this is the terminal wiring layer.

- [ ] **Step 1: Load the module**

In `peptide-calculator.html`, add the module tag **immediately after the Bootstrap bundle tag and immediately before the inline `<script>` block** — that is, between these two existing lines:

```html
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script src="peptide-calc.js"></script>          <!-- ADD THIS LINE -->
<script>
  function calculateReconstitution() {           <!-- replaced in Step 2 -->
```

**Order matters and is easy to get wrong here.** The existing script order in this file is: Bootstrap → inline script → `shipping.js` → `script.js` → `chat-widget.js`. Putting the module tag next to `shipping.js` would load it *after* the inline script that consumes it. That would happen to work, because `init()` is deferred to `DOMContentLoaded`, but it would leave `window.PeptideCalc` undefined at the moment the inline script is evaluated — a trap for anyone who later moves the `init()` call. Load it before its consumer.

- [ ] **Step 2: Replace the inline script**

Delete the entire `<script>` block containing `calculateReconstitution()` and `calculateDosage()` and replace it with:

```html
<script>
(function () {
  const PRESETS_ALL  = window.PeptideCalc.PRESETS;
  const DEFAULTS_ALL = window.PeptideCalc.DEFAULTS;
  const MAX_UNITS    = window.PeptideCalc.SYRINGE_UNITS;

  // Barrel geometry, matching the SVG in the markup. The fill starts just
  // inside the left stroke and spans to just inside the plunger.
  const FILL_X = 99;
  const FILL_MAX_WIDTH = 574;

  const state = { unit: 'mg', dose: null, strength: null, water: null };

  const el = (id) => document.getElementById(id);

  const COLUMNS = [
    { key: 'dose',     chips: 'doseChips',     custom: 'doseCustom' },
    { key: 'strength', chips: 'strengthChips', custom: 'strengthCustom' },
    { key: 'water',    chips: 'waterChips',    custom: 'waterCustom' }
  ];

  // Water is mL in both modes; only dose and strength carry the unit.
  function unitFor(key) {
    return key === 'water' ? 'mL' : state.unit;
  }

  function labelFor(value, key) {
    // Water reads better as 1.0mL than 1mL, matching the reference.
    const text = key === 'water' ? Number(value).toFixed(1) : String(value);
    return text + unitFor(key);
  }

  function buildChips() {
    COLUMNS.forEach(function (col) {
      const host = el(col.chips);
      host.innerHTML = '';
      PRESETS_ALL[state.unit][col.key].forEach(function (value) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'calc-chip';
        chip.textContent = labelFor(value, col.key);
        chip.setAttribute('aria-pressed', String(state[col.key] === value));
        chip.addEventListener('click', function () {
          // A chip and a custom value must never both be live in one column.
          state[col.key] = value;
          el(col.custom).value = '';
          syncChips(col);
          render();
        });
        host.appendChild(chip);
      });
    });
  }

  function syncChips(col) {
    const host = el(col.chips);
    const values = PRESETS_ALL[state.unit][col.key];
    Array.prototype.forEach.call(host.children, function (chip, i) {
      chip.setAttribute('aria-pressed', String(state[col.key] === values[i]));
    });
  }

  function updateLabels() {
    const u = state.unit;
    el('doseLabel').textContent = 'Dose of Peptide';
    el('strengthLabel').textContent = 'Strength of Peptide';
    el('doseCustom').placeholder = 'Enter custom dose (' + u + ')';
    el('strengthCustom').placeholder = 'Enter custom strength (' + u + ')';
    el('waterCustom').placeholder = 'Enter custom water (mL)';
  }

  function drawGradations() {
    const ticks = el('syringeTicks');
    const labels = el('syringeLabels');
    ticks.innerHTML = '';
    labels.innerHTML = '';
    for (let u = 0; u <= MAX_UNITS; u += 2) {
      const x = FILL_X + (u / MAX_UNITS) * FILL_MAX_WIDTH;
      const major = u % 10 === 0;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x); line.setAttribute('x2', x);
      line.setAttribute('y1', 65); line.setAttribute('y2', major ? 93 : 82);
      ticks.appendChild(line);
      if (major && u > 0) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x); text.setAttribute('y', 145);
        text.textContent = String(u);
        labels.appendChild(text);
      }
    }
  }

  function readColumn(col) {
    const custom = el(col.custom).value;
    if (custom !== '') return Number(custom);
    return state[col.key];
  }

  function render() {
    const input = {
      unit: state.unit,
      dose: readColumn(COLUMNS[0]),
      strength: readColumn(COLUMNS[1]),
      water: readColumn(COLUMNS[2])
    };

    const nothingChosen = [input.dose, input.strength, input.water]
      .some(function (v) { return v === null || v === undefined || v === ''; });

    const body = el('resultsBody');
    const empty = el('resultsEmpty');
    const warning = el('calcWarning');

    if (nothingChosen) {
      body.hidden = true; empty.hidden = false; warning.hidden = true;
      return;
    }

    const r = window.PeptideCalc.calculate(input);
    empty.hidden = true;
    body.hidden = false;

    if (!r.valid) {
      el('resultDose').textContent = '—';
      el('resultUnits').textContent = '—';
      el('resultDoses').textContent = '—';
      el('resultConc').textContent = '—';
      el('syringeFill').setAttribute('width', 0);
      warning.hidden = false;
      warning.innerHTML = '<strong>Check your figures.</strong> ' + r.reason;
      return;
    }

    const unitWord = state.unit;
    el('resultDose').textContent = input.dose + ' ' + unitWord;
    el('resultUnits').textContent = r.units.toFixed(2) + ' units';
    el('resultDoses').textContent = r.dosesPerVial + ' full dose' + (r.dosesPerVial === 1 ? '' : 's');
    el('resultConc').textContent = r.concentration.toFixed(2) + ' ' + unitWord + '/mL';

    // The bar caps at a full syringe; the NUMBER above it stays true.
    const ratio = Math.min(r.units, MAX_UNITS) / MAX_UNITS;
    el('syringeFill').setAttribute('width', (ratio * FILL_MAX_WIDTH).toFixed(2));

    if (r.overflow) {
      warning.hidden = false;
      warning.innerHTML =
        '<strong>This dose needs more than one full syringe.</strong> ' +
        'At ' + r.units.toFixed(2) + ' units (' + r.mL.toFixed(2) + ' mL) it will not fit in a ' +
        MAX_UNITS + '-unit insulin syringe. Check your vial strength and water volume, ' +
        'or split it across more than one injection.';
    } else {
      warning.hidden = true;
    }
  }

  function setUnit(unit) {
    if (state.unit === unit) return;
    state.unit = unit;
    // Dose and strength change meaning with the unit, so they reset. Water is
    // mL either way and is deliberately left alone.
    state.dose = DEFAULTS_ALL[unit].dose;
    state.strength = DEFAULTS_ALL[unit].strength;
    el('doseCustom').value = '';
    el('strengthCustom').value = '';
    Array.prototype.forEach.call(el('unitToggle').children, function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.unit === unit));
    });
    updateLabels();
    buildChips();
    render();
  }

  function init() {
    state.dose = DEFAULTS_ALL.mg.dose;
    state.strength = DEFAULTS_ALL.mg.strength;
    state.water = DEFAULTS_ALL.mg.water;

    Array.prototype.forEach.call(el('unitToggle').children, function (btn) {
      btn.addEventListener('click', function () { setUnit(btn.dataset.unit); });
    });

    COLUMNS.forEach(function (col) {
      el(col.custom).addEventListener('input', function () {
        // Typing a custom value deselects every chip in that column.
        if (el(col.custom).value !== '') {
          state[col.key] = null;
          syncChips(col);
        }
        render();
      });
    });

    updateLabels();
    buildChips();
    drawGradations();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>
```

- [ ] **Step 3: Verify in the browser**

Load the page in the preview and check each of these:

1. It opens on **mg**, with `0.5mg`, `10mg` and `1.0mL` selected, showing `5.00 units`, `20 full doses`, `10.00 mg/mL` — the reference numbers.
2. Tapping a different dose chip updates the readout and the orange fill **instantly**, with no Calculate button.
3. Typing in a custom input **deselects** every chip in that column; tapping a chip **clears** that custom input.
4. Selecting dose `15mg` with strength `10mg`, water `1.0mL` shows `150.00 units`, the fill caps at full, and the overflow warning appears naming 150.00 units.
5. Switching to **IU** resets dose/strength to `5IU`/`100IU`, leaves water at `1.0mL`, and re-labels the custom placeholders to `(IU)`.
6. Setting a custom water of `0` shows the invalid message, not `Infinity` or `NaN`.
7. Keyboard: Tab reaches the chips, Enter and Space activate them, and the focus ring is visible.

Expected: all seven pass; console clean.

- [ ] **Step 4: Commit**

```bash
git add peptide-calculator.html
git commit -m "Wire up the calculator - chips, unit toggle, live results"
```

---

## Task 4: Copy, SEO and final verification

**Files:**
- Modify: `peptide-calculator.html` — the "How to Use" block (lines 165–178 in the original), and the SEO copy in `<head>` (title, description, OG and Twitter tags, JSON-LD description).

**Interfaces:**
- Consumes: the finished UI from Task 3.
- Produces: nothing.

- [ ] **Step 1: Rewrite the "How to Use" block**

The current block describes two calculators that no longer exist. Replace the inner `<div class="row g-4">…</div>` of the How To Use section with:

```html
      <div class="row g-4">
        <div class="col-md-4">
          <h6 style="color:var(--orange); font-family:'Barlow Condensed',sans-serif; font-size:1rem; text-transform:uppercase; letter-spacing:1px;">1. Pick your numbers</h6>
          <p style="font-size:0.875rem; line-height:1.7; margin:0;">Choose your dose, the strength printed on your vial, and how much bacteriostatic water you are adding. Tap a preset or type your own — results update as you go.</p>
        </div>
        <div class="col-md-4">
          <h6 style="color:var(--orange); font-family:'Barlow Condensed',sans-serif; font-size:1rem; text-transform:uppercase; letter-spacing:1px;">2. Read the syringe</h6>
          <p style="font-size:0.875rem; line-height:1.7; margin:0;">The shaded area shows how far to draw on a standard 100-unit insulin syringe. If your dose needs more than one full syringe, a warning tells you so.</p>
        </div>
        <div class="col-md-4">
          <h6 style="color:var(--orange); font-family:'Barlow Condensed',sans-serif; font-size:1rem; text-transform:uppercase; letter-spacing:1px;">3. Check the vial</h6>
          <p style="font-size:0.875rem; line-height:1.7; margin:0;">"Full doses" is how many complete doses your vial yields at that dose size, rounded down — a small residue is normal. Switch to IU for HGH and HCG.</p>
        </div>
      </div>
```

- [ ] **Step 2: Update the SEO copy**

The description still promises two calculators. In `<head>`, replace **every** occurrence of this exact string (it appears in `<meta name="description">`, `og:description`, `twitter:description` and the JSON-LD `description` — four places):

```
Free online peptide reconstitution and dosage calculator. Calculate how much bacteriostatic water to add and your exact injection volume in mL and IU.
```

with:

```
Free peptide reconstitution and dosage calculator. Pick your dose, vial strength and water volume to see exactly how far to draw on an insulin syringe, plus doses per vial and concentration. Supports mg and IU.
```

Leave the `<title>`, canonical URL and keywords unchanged — the title still describes the page accurately and the URL must not move.

- [ ] **Step 3: Full-page verification pass**

Per the repo's build-test rule, enumerate rather than click around. Confirm every item:

- All seven behaviours from Task 3 Step 3 still pass.
- The medical disclaimer (`⚠️ For educational purposes only…`) is still present.
- Nav, footer, Telegram float and chat widget all render; cart count in the nav still works.
- The page is checked at mobile width (375px): chips wrap, the syringe scales, nothing overflows horizontally.
- No console errors and no failed network requests.

- [ ] **Step 4: Run the full test suite**

Run: `node --test tests/*.test.js`

Expected: `fail 0`.

- [ ] **Step 5: Screenshot and commit**

Capture the calculator in its default state and in the overflow state, and send both to Lester.

```bash
git add peptide-calculator.html
git commit -m "Update calculator copy and SEO for the new single-calculator flow"
```

- [ ] **Step 6: Push**

Confirm with Lester before pushing — this one is user-visible on the live storefront, unlike the previous two commits.

```bash
git push origin main
```

GitHub Pages rebuilds in 1–2 minutes. Verify at https://godmusclegears.com/peptide-calculator.html once it is live.

---

## Self-review notes

**Spec coverage:** module + formulae (Task 1), validation (Task 1), rounding and floor rules (Task 1), mg/IU presets (Task 1), chip/custom exclusivity (Task 3), unit-toggle reset leaving water alone (Task 3), results panel and SVG syringe (Tasks 2–3), overflow warning (Tasks 1 and 3), empty state (Task 3), accessibility — `aria-pressed`, `aria-live`, SVG `<title>`, focus rings, text-not-colour warning (Tasks 2–3), all ten test cases plus mutation testing (Task 1), browser verification (Tasks 3–4), disclaimer preserved (Task 4).

**Known deviation from the spec:** the spec listed 10 test cases; Task 1 implements those plus preset-table integrity tests, since `PRESETS` became an exported contract the page depends on.
