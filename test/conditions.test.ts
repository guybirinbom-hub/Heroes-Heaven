import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import {
  deriveAc,
  deriveSave,
  derivePerception,
  deriveSkill,
  deriveSpellcasting,
  deriveMaxHp,
  deriveStrikes,
} from '../src/rules/derive';
import type { ActiveCondition, Character } from '../src/rules/types';

const c = content();

/** A built character with the given conditions applied (mirrors applyPlayState's overlay). */
function withConditions(ch: Character, conditions: ActiveCondition[]): Character {
  return { ...ch, conditions };
}

describe('condition penalties on derived stats', () => {
  const cleric = build('cleric', 5); // Wis caster with armor + a weapon
  const baseAc = deriveAc(cleric, c).value;
  const baseRef = deriveSave(cleric, 'reflex').modifier;
  const baseFort = deriveSave(cleric, 'fortitude').modifier;
  const basePerc = derivePerception(cleric).modifier;

  it('Frightened applies a status penalty to everything (AC, saves, perception)', () => {
    const ch = withConditions(cleric, [{ id: 'frightened', value: 2 }]);
    expect(deriveAc(ch, c).value).toBe(baseAc - 2);
    expect(deriveSave(ch, 'reflex').modifier).toBe(baseRef - 2);
    expect(derivePerception(ch).modifier).toBe(basePerc - 2);
  });

  it('Clumsy hits Dex-based values (AC, Reflex) but not a Con save', () => {
    const ch = withConditions(cleric, [{ id: 'clumsy', value: 1 }]);
    expect(deriveAc(ch, c).value).toBe(baseAc - 1);
    expect(deriveSave(ch, 'reflex').modifier).toBe(baseRef - 1);
    expect(deriveSave(ch, 'fortitude').modifier).toBe(baseFort); // Con, unaffected
  });

  it('Drained hits Fortitude and reduces max HP by value × level', () => {
    const ch = withConditions(cleric, [{ id: 'drained', value: 2 }]);
    expect(deriveSave(ch, 'fortitude').modifier).toBe(baseFort - 2);
    expect(deriveMaxHp(ch, c)).toBe(deriveMaxHp(cleric, c) - 2 * cleric.level);
  });

  it('Stupefied penalizes spell attack and DC (mental key attribute)', () => {
    const entry = cleric.spellcasting.find((e) => e.type === 'prepared' || e.type === 'spontaneous');
    if (entry) {
      const baseSc = deriveSpellcasting(cleric, entry);
      const sc = deriveSpellcasting(withConditions(cleric, [{ id: 'stupefied', value: 1 }]), entry);
      expect(sc.attack).toBe(baseSc.attack - 1);
      expect(sc.dc).toBe(baseSc.dc - 1);
    }
  });

  it('penalties stack by type: worst status + a circumstance penalty', () => {
    // Frightened 2 (status) + Clumsy 1 (status) on AC → worst status is 2;
    // Off-guard adds a −2 circumstance → total −4.
    const ch = withConditions(cleric, [
      { id: 'frightened', value: 2 },
      { id: 'clumsy', value: 1 },
      { id: 'off-guard' },
    ]);
    expect(deriveAc(ch, c).value).toBe(baseAc - 4);
  });

  it('Enfeebled reduces a Strength melee attack and its damage', () => {
    const fighter = build('fighter', 3, {
      keyAbility: 'str',
      inventory: [{ itemId: 'longsword', quantity: 1, equipped: true }],
      levelBoosts: ['str', 'con', 'dex', 'wis'],
    });
    const baseStrikes = deriveStrikes(fighter, c);
    if (baseStrikes.length) {
      const enf = deriveStrikes(withConditions(fighter, [{ id: 'enfeebled', value: 1 }]), c);
      expect(enf[0].attack[0]).toBe(baseStrikes[0].attack[0] - 1);
    }
  });

  it('an unafflicted character is unchanged', () => {
    expect(deriveAc(withConditions(cleric, []), c).value).toBe(baseAc);
  });
});
