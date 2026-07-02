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

describe('greater elemental runes: only Greater Flaming deals persistent crit damage', () => {
  const db = JSON.parse(readFileSync(new URL('../public/core.json', import.meta.url), 'utf8'));
  const runes = Object.values(db.runes as Record<string, { name: string; damage?: { dice: number; die: string; type: string; critPersistent?: { dice: number; die: string } } }>);

  it('exactly one damage rune has a persistent crit rider, and it is Greater Flaming (2d10 fire)', () => {
    const withCrit = runes.filter((r) => r.damage?.critPersistent);
    expect(withCrit.length).toBe(1);
    expect(withCrit[0].damage).toMatchObject({ type: 'fire', dice: 1, die: 'd6', critPersistent: { dice: 2, die: 'd10' } });
  });

  it('the other elemental runes (cold/acid/electricity/sonic) never carry a persistent crit rider', () => {
    for (const type of ['cold', 'acid', 'electricity', 'sonic']) {
      const ofType = runes.filter((r) => r.damage?.type === type);
      expect(ofType.length).toBeGreaterThan(0);
      expect(ofType.every((r) => !r.damage!.critPersistent)).toBe(true);
    }
  });
});
