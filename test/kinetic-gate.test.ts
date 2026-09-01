/*
 * KINETIC GATE — "You can choose either a single gate (one element) or dual gate (two elements)."
 *
 * Both halves were wrong before this, and in opposite directions:
 *
 *   · The element count was hard-coded to 2 (`extraChoices.element.pickByLevel = {1:2}`), so SINGLE
 *     GATE COULD NOT BE BUILT AT ALL — a whole class option missing.
 *   · The earth impulse junction was keyed on OWNING the element, so a DUAL gate kineticist received
 *     "+1 circumstance AC from Earth Gate" that the printed text grants only to a single gate. A rules
 *     error in the player's favour, live on every dual-gate earth kineticist from 1st level.
 *
 * Only the Single Gate paragraph says "In addition, you gain an impulse junction"; the Dual Gate
 * paragraph grants none.
 *
 * ⚠ Unanswered must stay DUAL. Every kineticist saved before this question existed has no answer, and
 * they never pass through the reverse-derive (App.tsx prefers a stored BuildState), so a default of
 * single would silently take an element away from characters already on disk.
 */
import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { extraPickCount } from '../src/rules/build';
import { GATE_MODE_KEY, gateElementLimit } from '../src/rules/kineticElements';

const db = content();

const elementGroup = () =>
  (db.classes.kineticist?.extraChoices ?? []).find((g) => g.id === 'element');

describe('Kinetic Gate — the single/dual branch', () => {
  it('the class feature asks the question', () => {
    const ch = db.classFeatures['kinetic-gate']?.choice;
    expect(ch, 'kinetic-gate must carry the gate-mode choice').toBeTruthy();
    expect(ch?.flag).toBe('gateMode');
    expect((ch?.options ?? []).map((o) => o.value).sort()).toEqual(['dual', 'single']);
  });

  it('the stored pick count is UNCHANGED, so saved characters are unaffected', () => {
    // Deliberate: unanswered resolves to dual through gateElementLimit, not by narrowing the data.
    expect(elementGroup()?.pickByLevel).toEqual({ 1: 2 });
  });

  it('gateElementLimit: single = 1, dual = 2, unanswered = 2', () => {
    expect(gateElementLimit({ featChoices: { [GATE_MODE_KEY]: 'single' } })).toBe(1);
    expect(gateElementLimit({ featChoices: { [GATE_MODE_KEY]: 'dual' } })).toBe(2);
    expect(gateElementLimit({ featChoices: {} }), 'unanswered must stay dual').toBe(2);
    expect(gateElementLimit({}), 'no featChoices at all must stay dual').toBe(2);
  });

  it('the picker offers one element for a single gate and two for a dual gate', () => {
    const g = elementGroup()!;
    expect(extraPickCount(g, 1, { featChoices: { [GATE_MODE_KEY]: 'single' } })).toBe(1);
    expect(extraPickCount(g, 1, { featChoices: { [GATE_MODE_KEY]: 'dual' } })).toBe(2);
    expect(extraPickCount(g, 1, { featChoices: {} }), 'unanswered = dual').toBe(2);
    // A caller that passes no build at all keeps the group's printed maximum — the old behaviour,
    // which is what makes the new parameter safe for every other call site.
    expect(extraPickCount(g, 1)).toBe(2);
  });

  it('only the element group is affected — no other choice group branches', () => {
    for (const g of db.classes.kineticist?.extraChoices ?? []) {
      if (g.id === 'element') continue;
      expect(
        extraPickCount(g, 20, { featChoices: { [GATE_MODE_KEY]: 'single' } }),
        `${g.id} must not change with the gate answer`,
      ).toBe(extraPickCount(g, 20));
    }
  });
});
