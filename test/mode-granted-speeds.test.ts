import { describe, it, expect } from 'vitest';
import { deriveSpeeds } from '../src/rules/derive';
import type { Character, ModeDef } from '../src/rules/types';
import { content, build } from './_content';

/**
 * A mode can grant a Speed — "a fly Speed of 40 feet for 1 minute".
 *
 * The formulas are the reason this lane sits beside the STANCE block rather than with the other
 * grant sources: "a fly Speed of 25 feet or your land Speed, whichever is slower" resolves
 * "@actor.speed.land", which is 0 until the base speeds are finished. Evaluated too early it would
 * silently produce a fly Speed of 0 — a wrong number, not an obvious failure.
 */
const mode = (over: Partial<ModeDef>): ModeDef => ({ id: 'm', name: 'M', modifiers: [], ...over });
const withModes = (modes: ModeDef[]): Character => ({ ...build('fighter', 5), activeModes: modes });

describe('a mode can grant a Speed', () => {
  const db = () => content();

  it('grants a flat fly Speed while active', () => {
    expect(deriveSpeeds(withModes([mode({ speeds: { fly: 40 } })]), db()).fly).toBe(40);
  });

  it('grants none once switched off', () => {
    expect(deriveSpeeds(withModes([]), db()).fly).toBeUndefined();
  });

  it('resolves a Speed-relative formula against the FINISHED land Speed', () => {
    const c = withModes([mode({ speeds: { fly: 'max(20,@actor.speed.land)' } })]);
    const land = deriveSpeeds(withModes([]), db()).land ?? 0;
    expect(land).toBeGreaterThan(0);
    expect(deriveSpeeds(c, db()).fly).toBe(Math.max(20, land));
  });

  it('"whichever is slower" resolves to the smaller of the two', () => {
    const c = withModes([mode({ speeds: { fly: 'min(25,@actor.speed.land)' } })]);
    const land = deriveSpeeds(withModes([]), db()).land ?? 0;
    expect(deriveSpeeds(c, db()).fly).toBe(Math.min(25, land));
  });

  it('the higher of two active Speed grants wins — they do not add', () => {
    const c = withModes([mode({ id: 'a', speeds: { fly: 20 } }), mode({ id: 'b', speeds: { fly: 40 } })]);
    expect(deriveSpeeds(c, db()).fly).toBe(40);
  });

  it('the shipped fly toggles all carry a real Speed', () => {
    const db2 = db();
    for (const id of ['item-thousand-year-dragonroot', 'item-soaring-wings-major', 'item-winged', 'item-wyrms-flight', 'klingegeist']) {
      const m = db2.modes[id];
      expect(m, `${id} missing`).toBeDefined();
      const fly = deriveSpeeds(withModes([m]), db2).fly ?? 0;
      expect(fly, `${id} produced no fly Speed`).toBeGreaterThan(0);
    }
  });
});
