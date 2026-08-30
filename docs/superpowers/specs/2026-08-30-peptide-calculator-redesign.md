# Peptide calculator redesign — design spec

**Date:** 2026-08-30
**Page:** `peptide-calculator.html` (same URL, no redirect)
**Reference:** https://cellgenic.com/peptide-calculator/ — layout only

---

## Why

The page currently carries **two separate calculators** — Reconstitution (peptide
mg + water mL → concentration) and Dosage (dose + total peptide + volume →
injection volume). Both use typed number inputs and a Calculate button.

A customer reconstituting a vial needs *both* answers at once, and today has to
run two tools and carry a number between them. The reference layout collapses
that into one flow: pick Dose, Strength and Water, and get units-to-draw,
doses-per-vial and concentration together, with a syringe showing the fill.

It is a functional superset of what exists, not a sidegrade.

## Decisions taken

| Question | Decision |
|---|---|
| Visual style | Reference **layout**, GMG **branding** (`--orange #ff4500`, `--black #111`, Barlow Condensed, 18px cards). Not a pixel copy — a pixel copy would read as a bolted-on third-party widget. |
| Preset values | Tailored to the GMG catalog, not the reference's. |
| Syringe overflow | Warn clearly, cap the bar, still print the true number. |
| IU products | Supported via an **mg ⇄ IU toggle**. |
| Page scope | Replace both calculators; keep nav, footer, JSON-LD, chat widget, disclaimer. |
| Interaction | Live — no Calculate button. |

## Non-goals

- No redirect, no URL change, no new page.
- No product-name shortcut chips (considered, deferred — extra UI to keep in
  sync with the catalog).
- No saving or sharing of a calculation.
- No change to `script.js`, `shipping.js`, or any other page.

---

## Architecture

Logic and presentation are separated, following the pattern already used three
times in this repo (`shipping.js`, `payment-matching.js`, `chain-parsing.js`):
a pure module, unit-tested, with thin DOM wiring in the page.

This matters more here than it did for shipping. Shipping arithmetic has 18
tests protecting **dollars**. This is arithmetic a person acts on **with a
needle**, and it must not be the one piece of maths on the site with no tests.

```
peptide-calc.js        pure. no DOM, no network, no storage. exports calculate()
peptide-calculator.html  reads chips -> calls calculate() -> paints results + SVG
tests/peptide-calc.test.js  node --test, runs with the existing suite
```

### `peptide-calc.js`

```js
calculate({ dose, strength, water, unit }) -> {
  valid,           // boolean
  reason,          // '' when valid; a human-readable cause when not
  units,           // insulin-syringe units to draw (1 unit = 0.01 mL)
  mL,              // the same volume in mL
  concentration,   // strength per mL
  dosesPerVial,    // whole doses only
  overflow         // true when units > 100
}
```

**Formulae**

```
units         = (dose / strength) * water * 100
mL            = units / 100
concentration = strength / water
dosesPerVial  = floor(strength / dose)
overflow      = units > 100
```

**The formula is unit-agnostic.** `dose / strength` is a dimensionless ratio, so
mg and IU produce identical maths. `unit` is carried through **only** so callers
can label output (`mg/mL` vs `IU/mL`); it never branches the calculation. This
is why IU support is cheap rather than a second code path.

**Validation.** `valid: false` with a `reason` — never `NaN`, `Infinity` or a
negative on screen — when any of: strength ≤ 0, water ≤ 0, dose ≤ 0, or any
input non-numeric. Missing inputs (nothing picked yet) are not an error; the
results panel simply shows its empty state.

**Rounding.** `units` and `concentration` are computed at full precision and
rounded for **display only**, to 2 dp. `dosesPerVial` is floored, never rounded
— it answers "how many full doses does this vial give", and 13.33 doses is not a
thing a customer can draw. Labelled "full doses" so nobody expects the
remainder.

### Presets

**mg mode** — strength chips cover every peptide currently sold and drop the
reference's 50mg, which no GMG product has.

| Row | Values |
|---|---|
| Dose (mg) | 0.1 · 0.25 · 0.5 · 1 · 2 · 2.5 · 5 · 7.5 · 10 · 12.5 · 15 |
| Strength (mg) | 0.1 · 2 · 5 · 10 · 15 · 20 |
| Water (mL) | 0.5 · 1.0 · 1.5 · 2.0 · 2.5 · 3.0 |

`0.1mg` covers IGF-1 LR-3; `5mg` covers BPC-157, Ipamorelin, Semaglutide,
Sermorelin and Semax; `10mg` covers BPC-157 Xeno, Epitalon and Semaglutide Xeno.

**IU mode** — serves HGH (100IU) and NADOPEX HCG (5000IU). The two sit at very
different scales, so each row spans both and is ordered ascending.

| Row | Values |
|---|---|
| Dose (IU) | 1 · 2 · 4 · 5 · 8 · 10 · 250 · 500 · 1000 · 2500 |
| Strength (IU) | 10 · 36 · 100 · 2000 · 5000 · 10000 |
| Water (mL) | unchanged — water is always mL |

Water stays in mL in both modes; only Dose and Strength are unit-switched.

### Chip / custom-input interaction

Each column has a chip row and one custom input. They are **one control with two
entry methods**, never two competing values:

- Selecting a chip clears that column's custom input.
- Typing in a custom input deselects every chip in that column.
- Switching mg ⇄ IU resets **Dose and Strength** to that mode's defaults and
  clears their custom inputs — a 5 selected as mg must never silently persist as
  5 IU. **Water is left untouched**, since it is mL in both modes and re-picking
  it would be busywork.

### Results panel

Peptide dose · **DRAW SYRINGE TO: N units** · syringe graphic · doses per vial ·
concentration.

**Syringe — inline SVG**, not canvas or an image: scales without assets, themes
from the existing CSS variables, and the fill is a single `<rect>` whose width is
`min(units, 100) / 100`. Barrel, plunger, needle and 10-unit gradations with
labels at 10…100, matching the reference.

**Overflow.** When `units > 100` the fill caps at 100%, the syringe is styled to
read as a warning, and a message appears:

> This dose needs more than one full 100-unit syringe (N units). Check your
> vial strength and water volume, or split the injection.

The true number is still shown. The graphic must never contradict the maths —
that is the whole reason overflow is handled rather than left to max out
silently.

**Empty state.** Before enough inputs are chosen, the panel shows a neutral
prompt, not zeroes.

---

## Accessibility

- Chips are real `<button>` elements with `aria-pressed`, keyboard-reachable and
  operable with Enter/Space — not styled `<div>`s.
- The unit toggle is a labelled control announcing its current mode.
- The results region is `aria-live="polite"` so a screen-reader user hears the
  new figure when a chip changes; without it a live calculator is silent.
- The SVG carries a `<title>` describing the fill in words, because the syringe
  is decorative to a screen reader otherwise.
- Overflow warning is conveyed by **text**, never colour alone.

## Testing

`tests/peptide-calc.test.js`, picked up by the existing
`node --test tests/*.test.js`. (Note: **not** `node --test tests/` — Node
resolves that as a module path and fails.)

Cases:

1. **The reference's own numbers** — 0.5mg / 10mg / 1.0mL → 5.00 units,
   20 doses, 10.00 mg/mL. Pins against a known-good implementation.
2. Unit conversion — 1 unit = 0.01 mL, both directions.
3. `dosesPerVial` floors: 10mg ÷ 0.75mg → 13, not 13.33.
4. Overflow boundary — exactly 100 units is **not** overflow; 100.01 is.
5. Overflow still reports the true `units`, not a capped one.
6. Divide-by-zero — water 0, strength 0, dose 0 each return `valid: false` with
   a reason, never `Infinity`/`NaN`.
7. Negative and non-numeric inputs rejected.
8. **IU equivalence** — identical numbers in mg mode and IU mode produce
   identical `units`, proving the formula does not branch on unit.
9. Concentration for a realistic catalog vial: 5mg in 2mL → 2.50 mg/mL.
10. Floating-point sanity — 0.1 + 0.2 class errors do not surface in displayed
    output.

Each guard is mutation-tested before the work is called done: break the formula,
the floor, the overflow comparison and the validation in turn, and confirm the
suite fails each time. A test that has never failed proves nothing.

## Verification

Beyond unit tests, the page is checked in the browser preview: chip selection,
custom-input mutual exclusion, the mg⇄IU reset, live updating, the syringe fill
at several values, the overflow warning, and mobile width. Screenshots to Lester
on completion.

## Risks

- **Overflow is reachable from the presets themselves** (15mg dose from a 10mg
  vial in 1mL = 150 units). It is not an exotic edge case, which is why it is
  designed for rather than treated as invalid input.
- **IU presets mix HGH and HCG scales** in one row. Acceptable — the user picks
  the number on their vial — but if it proves confusing, sub-grouping the chips
  is the follow-up, not a redesign.
- **`dosesPerVial` ignores residual volume.** Flooring is correct but slightly
  optimistic against real-world waste; the "full doses" label is the mitigation.
- This tool gives dosing figures. The existing medical disclaimer stays on the
  page and is not weakened.
