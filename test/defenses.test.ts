import { describe, it, expect } from 'vitest';
import { deriveDefenses, deriveSpeeds, resolveIwrValue } from '../src/rules/derive';
import { content, build } from './_content';
import type { Character } from '../src/rules/types';

const c = content();

describe('resolveIwrValue (level formulas, no eval)', () => {
  it('plain numbers', () => {
    expect(resolveIwrValue(5, 10)).toBe(5);
    expect(resolveIwrValue('5', 10)).toBe(5);
  });
  it('@actor.level', () => expect(resolveIwrValue('@actor.level', 7)).toBe(7));
  it('floor(@actor.level/2)', () => expect(resolveIwrValue('floor(@actor.level/2)', 9)).toBe(4));
  it('max(1,floor(@actor.level/2)) keeps a floor of 1 at low level', () => {
    expect(resolveIwrValue('max(1,floor(@actor.level/2))', 1)).toBe(1);
    expect(resolveIwrValue('max(1,floor(@actor.level/2))', 8)).toBe(4);
  });
  it('max(1,floor(@actor.level/3))', () => expect(resolveIwrValue('max(1,floor(@actor.level/3))', 12)).toBe(4));
  it('unknown formula resolves to 0 (never shows a wrong number)', () =>
    expect(resolveIwrValue('@actor.abilities.str.mod + 2', 5)).toBe(0));
});

describe('deriveDefenses aggregates innate senses + IWR', () => {
  const dwarf = (lvl: number, heritageId: string): Character => ({
    ...build('fighter', lvl, { keyAbility: 'str' }),
    ancestryId: 'dwarf',
    heritageId,
  });

  it('Forge Dwarf grants fire resistance = max(1, floor(level/2))', () => {
    expect(deriveDefenses(dwarf(4, 'forge-dwarf'), c).resistances).toContainEqual({ type: 'fire', value: 2 });
    expect(deriveDefenses(dwarf(1, 'forge-dwarf'), c).resistances).toContainEqual({ type: 'fire', value: 1 });
  });

  it('ancestry vision appears as a sense (dwarf → darkvision)', () => {
    expect(deriveDefenses(dwarf(1, 'forge-dwarf'), c).senses.map((s) => s.name)).toContain('darkvision');
  });

  it('a sense-granting heritage adds it with acuity + range (Hunting Catfolk → scent)', () => {
    const ch = { ...build('fighter', 1, { keyAbility: 'str' }), heritageId: 'hunting-catfolk' } as Character;
    expect(deriveDefenses(ch, c).senses.find((s) => s.name === 'scent')).toEqual({
      name: 'scent',
      range: 30,
      acuity: 'imprecise',
    });
  });

  it('a plain human fighter has just normal vision and no innate IWR', () => {
    const plain: Character = {
      ...build('fighter', 1, { keyAbility: 'str' }),
      ancestryId: 'human',
      heritageId: null,
      feats: [],
    };
    const d = deriveDefenses(plain, c);
    expect(d.senses.map((s) => s.name)).toEqual(['normal']);
    expect(d.resistances).toHaveLength(0);
    expect(d.weaknesses).toHaveLength(0);
    expect(d.immunities).toHaveLength(0);
  });
});

describe('deriveSpeeds includes granted non-land speeds', () => {
  it('a speed-granting heritage adds a non-land speed (Climbing Animal → climb 20)', () => {
    const ch = { ...build('fighter', 1, { keyAbility: 'str' }), heritageId: 'climbing-animal' } as Character;
    expect(deriveSpeeds(ch, c).climb).toBe(20);
  });

  it('no non-land speeds by default', () => {
    const d = deriveSpeeds(build('fighter', 1, { keyAbility: 'str' }), c);
    expect([d.fly, d.swim, d.climb, d.burrow].every((v) => v == null)).toBe(true);
  });
});
