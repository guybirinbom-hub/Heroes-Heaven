/*
 * BUG GUARD — a condition the GM hands a player has to WORK LIKE A MODE on that player's sheet.
 *
 * Owner ruling 2026-09-15: mechanical, visible, removable, and matching the printed PF2e text. The
 * seam pushes a GM-applied condition into the character's PLAY STATE (`play.conditions`), which is
 * the same field the sheet's own Conditions picker writes: ConditionsModal's `onAdd` / `onRemove`
 * call addCondition / removeCondition in src/rules/play.ts, and both return
 * `{ ...play, conditions: … }`. ONE canonical field, so nothing had to be reconciled — this file
 * asserts that it stays one, because two fields is how a GM's condition becomes invisible.
 *
 * MUTATION-PROVEN (lines as the runner printed them). Deleting the `fascinated` row from
 * src/rules/conditions.ts fails:
 *   → "GM-applied Fascinated moves the same numbers as the sheet's own toggle"
 *     AssertionError: expected 7 to be 5 // Object.is equality        (Perception)
 * Emptying the `unconscious` rows fails:
 *   → "a GM-only condition (Unconscious) is fully mechanical on the sheet"
 *     AssertionError: expected 16 to be 10 // Object.is equality      (AC)
 *
 * Synthetic fixture only — a level-3 fighter built by test/_content, no saved character.
 */
import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { deriveAc, deriveSave, derivePerception, deriveSkill } from '../src/rules/derive';
import { emptyPlay, applyPlayState, addCondition, removeCondition, stepConditionValue } from '../src/rules/play';
import type { PlayState } from '../src/rules/play';

const c = content();
const hero = build('fighter', 3);

/** Every number a player watches, off one character. */
const numbers = (ch: ReturnType<typeof build>) => ({
  ac: deriveAc(ch, c).value,
  reflex: deriveSave(ch, 'reflex', c).modifier,
  will: deriveSave(ch, 'will', c).modifier,
  perception: derivePerception(ch, c).modifier,
  athletics: deriveSkill(ch, 'athletics', c).modifier,
});
const sheetOf = (play: PlayState) => numbers(applyPlayState(hero, play, c));
const base = sheetOf(emptyPlay());

/** What the sheet's Conditions picker does: onAdd, then the +/− stepper. */
const toggledOnSheet = (id: string, value?: number): PlayState => {
  let p = addCondition(emptyPlay(), id, value === undefined ? undefined : 1);
  for (let i = 1; i < (value ?? 1); i++) p = stepConditionValue(p, id, 1);
  return p;
};
/** What the GM pushes across the seam: the condition, already in play.conditions. */
const fromGm = (id: string, value?: number): PlayState =>
  ({ ...emptyPlay(), conditions: [{ id, ...(value === undefined ? {} : { value }) }] });

describe('a GM-applied condition behaves exactly like one toggled on the sheet', () => {
  it('play.conditions is the one field both routes write', () => {
    // Not a restatement of the implementation: if the picker ever moves to its own field, the
    // arrays stop matching here and the GM's condition silently stops reaching the sheet.
    expect(toggledOnSheet('frightened', 2).conditions).toEqual([{ id: 'frightened', value: 2 }]);
    expect(fromGm('frightened', 2).conditions).toEqual([{ id: 'frightened', value: 2 }]);
  });

  it('GM-applied Frightened 2 moves the same numbers as the sheet’s own toggle', () => {
    const gm = sheetOf(fromGm('frightened', 2));
    expect(gm).toEqual(sheetOf(toggledOnSheet('frightened', 2)));
    // …and it actually moved them — a matching pair of no-ops would prove nothing.
    expect(gm.ac).toBe(base.ac - 2);
    expect(gm.reflex).toBe(base.reflex - 2);
    expect(gm.perception).toBe(base.perception - 2);
    expect(gm.athletics).toBe(base.athletics - 2);
  });

  it('GM-applied Fascinated moves the same numbers as the sheet’s own toggle', () => {
    const gm = sheetOf(fromGm('fascinated'));
    expect(gm).toEqual(sheetOf(toggledOnSheet('fascinated')));
    expect(gm.perception).toBe(base.perception - 2);
    expect(gm.athletics).toBe(base.athletics - 2);
    expect(gm.ac).toBe(base.ac); // "Perception and skill checks" — nothing else
  });

  it('a GM-only condition (Unconscious) is fully mechanical on the sheet', () => {
    const gm = sheetOf(fromGm('unconscious'));
    expect(gm.ac).toBe(base.ac - 6); // −4 status, −2 circumstance (off-guard)
    expect(gm.perception).toBe(base.perception - 4);
    expect(gm.reflex).toBe(base.reflex - 4);
    expect(gm.will).toBe(base.will); // "Reflex saves", not all three
  });

  it('it is VISIBLE: the overlaid character carries the row the conditions UI renders', () => {
    const ch = applyPlayState(hero, fromGm('unconscious'), c);
    // VitalsRail maps character.conditions into pills and ConditionsModal takes the same array as
    // its `active` prop, so this array IS the conditions UI's input.
    expect(ch.conditions).toEqual([{ id: 'unconscious' }]);
    // …and the row it draws has a name and the full printed entry to read.
    const def = c.conditions['unconscious'];
    expect(def?.name).toBe('Unconscious');
    expect(def?.description ?? '').toContain('–4 status penalty to AC, Perception, and Reflex saves');
  });

  it('it is REMOVABLE there: the picker’s onRemove clears the GM’s condition and every penalty', () => {
    const cleared = removeCondition(fromGm('unconscious'), 'unconscious');
    expect(cleared.conditions).toEqual([]);
    expect(sheetOf(cleared)).toEqual(base);
  });

  it('a valued one the GM pushed can be stepped on the sheet like any other', () => {
    const stepped = stepConditionValue(fromGm('frightened', 2), 'frightened', -1);
    expect(stepped.conditions).toEqual([{ id: 'frightened', value: 1 }]);
    expect(sheetOf(stepped).ac).toBe(base.ac - 1);
  });
});
