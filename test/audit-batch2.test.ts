import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { psychicSlots } from '../src/rules/spellcasting';

describe('psychic is a limited caster — no 10th-rank spell slot', () => {
  it('caps at 9th rank even at levels 19-20', () => {
    expect(psychicSlots(20)[10]).toBeUndefined();
    expect(psychicSlots(19)[10]).toBeUndefined();
    expect(psychicSlots(20)[9]).toBe(2);
    expect(psychicSlots(17)[9]).toBe(1);
  });
});

describe('elemental runes: only the Flaming runes deal persistent crit damage', () => {
  const db = JSON.parse(readFileSync(new URL('../public/core.json', import.meta.url), 'utf8'));
  const runes = Object.values(db.runes as Record<string, { name: string; damage?: { dice: number; die: string; type: string; critPersistent?: { dice: number; die: string } } }>);

  it('both Flaming runes carry a persistent-fire crit rider (base 1d10, Greater 2d10) and no others do', () => {
    const withCrit = runes.filter((r) => r.damage?.critPersistent);
    // Per PF2e Remaster: base Flaming = 1d6 fire + 1d10 persistent fire on a crit; Greater = + 2d10.
    expect(withCrit.map((r) => r.name).sort()).toEqual(['Flaming', 'Flaming (Greater)']);
    expect(runes.find((r) => r.name === 'Flaming')!.damage).toMatchObject({ type: 'fire', dice: 1, die: 'd6', critPersistent: { dice: 1, die: 'd10' } });
    expect(runes.find((r) => r.name === 'Flaming (Greater)')!.damage).toMatchObject({ type: 'fire', dice: 1, die: 'd6', critPersistent: { dice: 2, die: 'd10' } });
  });

  it('the other elemental runes (cold/acid/electricity/sonic) never carry a persistent crit rider', () => {
    for (const type of ['cold', 'acid', 'electricity', 'sonic']) {
      const ofType = runes.filter((r) => r.damage?.type === type);
      expect(ofType.length).toBeGreaterThan(0);
      expect(ofType.every((r) => !r.damage!.critPersistent)).toBe(true);
    }
  });
});
