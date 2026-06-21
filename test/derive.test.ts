import { describe, it, expect } from 'vitest';
import { abilityMod, profBonus, formatMod, deriveSpellcasting, deriveSave, deriveClassDc } from '../src/rules/derive';
import { mainCasting, build } from './_content';

describe('ability + proficiency math', () => {
  it('abilityMod = floor((score - 10) / 2)', () => {
    expect(abilityMod(10)).toBe(0);
    expect(abilityMod(11)).toBe(0);
    expect(abilityMod(18)).toBe(4);
    expect(abilityMod(7)).toBe(-2);
    expect(abilityMod(20)).toBe(5);
  });
  it('profBonus = 0 when untrained, else rankValue + level', () => {
    expect(profBonus('untrained', 5)).toBe(0);
    expect(profBonus('trained', 1)).toBe(3); // 2 + level
    expect(profBonus('expert', 1)).toBe(5); // 4 + level
    expect(profBonus('master', 10)).toBe(16); // 6 + level
    expect(profBonus('legendary', 20)).toBe(28); // 8 + level
  });
  it('formatMod always shows a sign', () => {
    expect(formatMod(0)).toBe('+0');
    expect(formatMod(3)).toBe('+3');
    expect(formatMod(-2)).toBe('-2');
  });
});

describe('derived statistics', () => {
  it('spell DC = 10 + spellcasting prof + key mod', () => {
    const ch = build('cleric', 1);
    const entry = mainCasting(ch)!;
    const sc = deriveSpellcasting(ch, entry);
    const keyMod = abilityMod(ch.abilities[entry.keyAbility]);
    expect(sc.dc).toBe(10 + profBonus(entry.proficiency, ch.level) + keyMod);
    expect(sc.attack).toBe(sc.dc - 10);
  });
  it('a save line adds the proficiency bonus to the ability mod', () => {
    const ch = build('fighter', 5);
    const fort = deriveSave(ch, 'fortitude');
    const expected = abilityMod(ch.abilities.con) + profBonus(ch.proficiencies.saves.fortitude, ch.level);
    expect(fort.modifier).toBe(expected);
  });
  it('class DC = 10 + class-DC prof + key mod', () => {
    const ch = build('fighter', 3);
    const dc = deriveClassDc(ch);
    const keyMod = ch.keyAbility ? abilityMod(ch.abilities[ch.keyAbility]) : 0;
    expect(dc.dc).toBe(10 + profBonus(ch.proficiencies.classDc, ch.level) + keyMod);
  });
});
