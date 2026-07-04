import { describe, it, expect } from 'vitest';
import { normalizeCharacter } from '../src/rules/normalize';

describe('normalizeCharacter', () => {
  it('fills every required array/object on an almost-empty character so the sheet cannot crash', () => {
    const c = normalizeCharacter({ name: 'Legacy' });
    expect(c.name).toBe('Legacy');
    // Arrays the derive/play pipeline maps over unguarded.
    expect(c.conditions).toEqual([]);
    expect(c.inventory).toEqual([]);
    expect(c.spellcasting).toEqual([]);
    expect(c.notes).toEqual([]);
    expect(c.feats).toEqual([]);
    expect(c.languages).toEqual([]);
    // Objects dereferenced unguarded (e.g. details.deityId, currency, abilities, proficiencies).
    expect(c.details).toEqual({});
    expect(c.currency).toEqual({});
    expect(c.abilities).toEqual({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    expect(c.proficiencies.saves.fortitude).toBe('untrained');
    expect(c.proficiencies.defenses.unarmored).toBe('untrained');
    expect(c.hitPoints).toMatchObject({ current: 0, temp: 0 });
  });

  it('preserves provided fields and only backfills the missing ones', () => {
    const c = normalizeCharacter({
      name: 'Real',
      level: 5,
      abilities: { str: 18, dex: 14, con: 12, int: 10, wis: 10, cha: 8 },
      conditions: [{ id: 'frightened', value: 1 }],
      details: { deityId: 'iomedae' },
    });
    expect(c.level).toBe(5);
    expect(c.abilities.str).toBe(18);
    expect(c.conditions).toHaveLength(1);
    expect(c.details.deityId).toBe('iomedae');
    // Still backfills what wasn't supplied.
    expect(c.inventory).toEqual([]);
    expect(c.spellcasting).toEqual([]);
  });

  it('tolerates wrong-typed fields (not arrays/objects) without throwing', () => {
    const c = normalizeCharacter({ name: 'Broken', conditions: 'nope', abilities: 42, details: null, currency: 7 });
    expect(c.conditions).toEqual([]);
    expect(c.abilities.str).toBe(10);
    expect(c.details).toEqual({});
    expect(c.currency).toEqual({});
  });

  it('clamps an out-of-range level into [1,20] (bad import / legacy roster entry)', () => {
    expect(normalizeCharacter({ level: 0 }).level).toBe(1);
    expect(normalizeCharacter({ level: -3 }).level).toBe(1);
    expect(normalizeCharacter({ level: 25 }).level).toBe(20);
    expect(normalizeCharacter({ level: 21 }).level).toBe(20);
    // A legal level is left alone (and a fractional one floored into range).
    expect(normalizeCharacter({ level: 7 }).level).toBe(7);
    expect(normalizeCharacter({ level: 12.9 }).level).toBe(12);
    // A non-number falls back to 1.
    expect(normalizeCharacter({ level: 'nope' as unknown as number }).level).toBe(1);
  });
});
