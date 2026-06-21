import { describe, it, expect } from 'vitest';
import {
  deriveAc,
  deriveArmorCheckPenalty,
  deriveSkill,
  deriveSpeeds,
  skillTakesArmorPenalty,
} from '../src/rules/derive';
import { content, build } from './_content';
import type { Character } from '../src/rules/types';

const c = content();

// Full plate: check penalty -3, speed penalty -10 ft, Strength threshold +4 (Str 18).
const PLATE = 'full-plate';

/** Replace the character's inventory with a single worn armor. */
function wearing(ch: Character, itemId: string): Character {
  return { ...ch, inventory: [{ instanceId: 'arm1', itemId, quantity: 1, worn: true }] };
}
function withAbility(ch: Character, ability: 'str' | 'dex', score: number): Character {
  return { ...ch, abilities: { ...ch.abilities, [ability]: score } };
}

const fighter = () => build('fighter', 1, { keyAbility: 'str' });

describe('armor data sanity', () => {
  it('full plate imported with the remaster fields (Strength stored as a modifier)', () => {
    const a = c.items[PLATE];
    expect(a?.itemType).toBe('armor');
    if (a?.itemType === 'armor') {
      expect(a.checkPenalty).toBe(-3);
      expect(a.speedPenalty).toBe(-10);
      expect(a.strength).toBe(4); // a modifier (+4 → Str 18), NOT a score of 4
      expect(a.dexCap).toBe(0);
    }
  });
});

describe('armor check penalty', () => {
  it('hits Strength- and Dexterity-based skills when the Strength threshold is not met', () => {
    const ch = wearing(withAbility(fighter(), 'str', 10), PLATE); // Str mod 0 < +4
    expect(deriveArmorCheckPenalty(ch, c).value).toBe(-3);
    expect(deriveArmorCheckPenalty(ch, c).source).toBe(c.items[PLATE].name);

    for (const skill of ['athletics', 'acrobatics', 'stealth', 'thievery'] as const) {
      expect(skillTakesArmorPenalty(skill)).toBe(true);
      expect(deriveSkill(ch, skill, c).modifier).toBe(deriveSkill(ch, skill).modifier - 3);
    }
  });

  it('leaves non-physical (mental) skills untouched', () => {
    const ch = wearing(withAbility(fighter(), 'str', 10), PLATE);
    for (const skill of ['arcana', 'society', 'diplomacy', 'medicine'] as const) {
      expect(skillTakesArmorPenalty(skill)).toBe(false);
      expect(deriveSkill(ch, skill, c).modifier).toBe(deriveSkill(ch, skill).modifier);
    }
  });

  it('is removed when the wearer meets the Strength threshold (compares modifiers)', () => {
    const ch = wearing(withAbility(fighter(), 'str', 18), PLATE); // Str mod +4 == threshold
    expect(deriveArmorCheckPenalty(ch, c).value).toBe(0);
    expect(deriveSkill(ch, 'athletics', c).modifier).toBe(deriveSkill(ch, 'athletics').modifier);
  });

  it('does not apply without worn armor', () => {
    const ch = { ...withAbility(fighter(), 'str', 10), inventory: [] };
    expect(deriveArmorCheckPenalty(ch, c).value).toBe(0);
    expect(deriveSkill(ch, 'stealth', c).modifier).toBe(deriveSkill(ch, 'stealth').modifier);
  });
});

describe('armor speed penalty', () => {
  const base = deriveSpeeds(fighter(), c).land ?? 0;

  it('takes the full speed penalty below the Strength threshold', () => {
    const ch = wearing(withAbility(fighter(), 'str', 10), PLATE);
    expect(deriveSpeeds(ch, c).land).toBe(base - 10);
  });

  it('reduces the speed penalty by 5 ft (not to 0) when meeting the threshold', () => {
    const ch = wearing(withAbility(fighter(), 'str', 18), PLATE);
    expect(deriveSpeeds(ch, c).land).toBe(base - 5);
  });
});

describe('armor Dex cap on AC', () => {
  it('caps the Dex contribution: full plate (dexCap 0) makes AC independent of Dex', () => {
    const lowDex = wearing(withAbility(fighter(), 'dex', 10), PLATE);
    const highDex = wearing(withAbility(fighter(), 'dex', 18), PLATE);
    expect(deriveAc(highDex, c).dexCap).toBe(0);
    expect(deriveAc(highDex, c).value).toBe(deriveAc(lowDex, c).value);
  });

  it('unarmored AC still scales fully with Dex (no cap)', () => {
    const lowDex = { ...withAbility(fighter(), 'dex', 10), inventory: [] };
    const highDex = { ...withAbility(fighter(), 'dex', 18), inventory: [] };
    expect(deriveAc(highDex, c).dexCap).toBe(null);
    expect(deriveAc(highDex, c).value).toBe(deriveAc(lowDex, c).value + 4);
  });
});
