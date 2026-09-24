// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { explainStat } from '../src/rules/explain';
import { deriveStrikes } from '../src/rules/derive';
import { CATALOG_MODES } from '../src/rules/modes';
import type { Character, ModeDef } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 039, gap lane for the SITUATIONAL family: the second half of
 * arcane-cascade#damage. The star (FEAT_SITUATIONAL['arcane-cascade']) says the printed 1/2/3; the
 * Modes-panel cat-arcane-cascade used to sit beside it with a flat "+1 untyped" on every Strike and a
 * note inventing "+2 if expert in your tradition". Print (action-4261): "your melee Strikes ... deal
 * 1 extra force damage ... If you have the weapon specialization class feature, the damage and
 * resistance increase to 2, and if you have greater weapon specialization, they increase to 3."
 * src/rules/modes.ts:303 now retires that mode; this pins that no catalogue mode a magus can switch
 * on contradicts the star, whether the mode is retired or rewritten.
 */
const db = content();

const damageStars = (c: Character) => {
  const strike = deriveStrikes(c, db)[0];
  expect(strike, 'a magus has at least one Strike to read').toBeTruthy();
  return (explainStat(c, db, { kind: 'strikeDamage', instanceId: strike.instanceId }).situational ?? []).map((n) => n.text);
};

const magusModes = () => CATALOG_MODES.filter((m) => m.classes?.includes('magus'));

describe('arcane-cascade: no Modes-panel toggle contradicts the printed 1/2/3 star', () => {
  // batch 039: arcane-cascade#damage
  it('arcane-cascade: no magus catalogue mode prints the invented tradition rung or a flat +1 untyped', () => {
    for (const mode of magusModes()) {
      expect(mode.note ?? '', mode.id).not.toMatch(/expert in your tradition/);
      if (/arcane cascade/i.test(`${mode.name} ${mode.note ?? ''}`))
        expect(mode.modifiers.filter((x) => x.target === 'damage' && x.type === 'untyped'), mode.id).toEqual([]);
    }
  });

  // batch 039: arcane-cascade#damage
  it('arcane-cascade: a built magus with every magus mode on reads no "+1 untyped from Arcane Cascade" star', () => {
    const magus = build('magus', 7);
    const on: Character = { ...magus, activeModes: magusModes() };
    expect(damageStars(on).filter((t) => /untyped from Arcane Cascade/.test(t))).toEqual([]);
    // The registry star (FEAT_SITUATIONAL['arcane-cascade']) is still the one Arcane Cascade line.
    const strike = deriveStrikes(on, db)[0];
    const fromRecord = (explainStat(on, db, { kind: 'strikeDamage', instanceId: strike.instanceId }).situational ?? []).filter(
      (n) => n.sourceId === 'arcane-cascade',
    );
    expect(fromRecord.length).toBe(1);
  });

  // batch 039: arcane-cascade#damage
  it('arcane-cascade: the check has teeth - the old mode shape, patched in memory, does surface the contradicting star', () => {
    const old: ModeDef = {
      id: 'cat-arcane-cascade',
      name: 'Arcane Cascade',
      category: 'Magus',
      classes: ['magus'],
      predefined: true,
      modifiers: [{ value: 1, type: 'untyped', target: 'damage', appliesWhen: 'your Strikes while in Arcane Cascade stance' }],
      note: 'Stance: your Strikes deal +1 extra damage (+2 if expert in your tradition), of a type tied to your last spell.',
    };
    const magus = build('magus', 7);
    expect(damageStars({ ...magus, activeModes: [old] }).filter((t) => /untyped from Arcane Cascade/.test(t)).length).toBe(1);
  });
});
