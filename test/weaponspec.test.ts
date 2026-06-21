import { describe, it, expect } from 'vitest';
import { deriveStrike, weaponSpecDamage, weaponSpecialization } from '../src/rules/derive';
import { content, build } from './_content';
import type { Character } from '../src/rules/types';

const c = content();
const equip = (ch: Character, itemId: string): Character => ({
  ...ch,
  inventory: [{ instanceId: 'w1', itemId, quantity: 1, equipped: true }],
});

describe('weaponSpecDamage (tiers)', () => {
  const std = { spec: true, greater: false };
  const grt = { spec: true, greater: true };
  it('standard: +2 / +3 / +4 at expert / master / legendary', () => {
    expect(weaponSpecDamage('expert', std)).toBe(2);
    expect(weaponSpecDamage('master', std)).toBe(3);
    expect(weaponSpecDamage('legendary', std)).toBe(4);
  });
  it('greater: +4 / +6 / +8', () => {
    expect(weaponSpecDamage('expert', grt)).toBe(4);
    expect(weaponSpecDamage('master', grt)).toBe(6);
    expect(weaponSpecDamage('legendary', grt)).toBe(8);
  });
  it('nothing at untrained/trained, or without the feature', () => {
    expect(weaponSpecDamage('trained', std)).toBe(0);
    expect(weaponSpecDamage('untrained', grt)).toBe(0);
    expect(weaponSpecDamage('legendary', { spec: false, greater: false })).toBe(0);
  });
});

describe('weaponSpecialization detection by class + level', () => {
  it('fighter gains it at 7, Greater at 15', () => {
    expect(weaponSpecialization(build('fighter', 6, { keyAbility: 'str' }), c)).toEqual({ spec: false, greater: false });
    expect(weaponSpecialization(build('fighter', 7, { keyAbility: 'str' }), c)).toEqual({ spec: true, greater: false });
    expect(weaponSpecialization(build('fighter', 15, { keyAbility: 'str' }), c)).toEqual({ spec: true, greater: true });
  });
  it('a caster (wizard) gains standard spec at 13, never Greater', () => {
    expect(weaponSpecialization(build('wizard', 12, { keyAbility: 'int' }), c).spec).toBe(false);
    expect(weaponSpecialization(build('wizard', 13, { keyAbility: 'int' }), c)).toEqual({ spec: true, greater: false });
  });
  it("the summoner's eidolon-weapon-specialization @7 does NOT grant the summoner spec (own is @13)", () => {
    expect(weaponSpecialization(build('summoner', 7, { keyAbility: 'cha' }), c).spec).toBe(false);
    expect(weaponSpecialization(build('summoner', 13, { keyAbility: 'cha' }), c).spec).toBe(true);
  });
});

describe('deriveStrike folds in weapon specialization damage', () => {
  it('a level-7 fighter gets spec damage on a martial weapon (matching its rank)', () => {
    const ch = build('fighter', 7, { keyAbility: 'str' });
    const s = deriveStrike(equip(ch, 'longsword'), c, equip(ch, 'longsword').inventory[0]);
    const expected = weaponSpecDamage(ch.proficiencies.attacks.martial, weaponSpecialization(ch, c));
    expect(s?.specDamage).toBe(expected);
    expect(s?.specDamage).toBeGreaterThan(0);
  });
  it('a level-6 fighter has no spec damage yet', () => {
    const ch = build('fighter', 6, { keyAbility: 'str' });
    expect(deriveStrike(equip(ch, 'longsword'), c, equip(ch, 'longsword').inventory[0])?.specDamage).toBeUndefined();
  });
});
