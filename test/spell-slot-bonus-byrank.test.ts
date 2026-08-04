import { describe, it, expect } from 'vitest';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { content } from './_content';

/**
 * Rings of Wizardry grant slots at SPECIFIC ranks, not one at every rank.
 *
 * All four records already carried `byRank` ({"3":1,"4":2} for Type IV) but SpellSlotBonus had no
 * such field, so build.ts ignored it, fell through to `perRank ?? 1`, and — with no `exceptHighest`
 * — added one slot to EVERY rank the caster had. A level-20 wizard wearing a Type I ring, which
 * prints "two additional 1st-rank slots", was handed ten extra slots instead.
 *
 * Nothing failed loudly: the data looked authored, the ring looked implemented, and the sheet showed
 * a bigger number than the rules allow. These tests pin the printed values.
 */
/** Slot bonuses are collected DURING buildCharacter from `build.inventory` — attaching the ring to
 *  the built character afterwards does nothing, so the ring must go into the build. */
const wizardWearing = (itemId: string | null, level = 12) => {
  const db = content();
  const b = { ...emptyBuild() };
  b.name = 'Slot Test';
  b.ancestryId = 'human';
  b.classId = 'wizard';
  b.backgroundId = Object.keys(db.backgrounds)[0];
  b.level = level;
  if (itemId) b.inventory = [{ instanceId: 'r1', itemId, quantity: 1, invested: true, worn: true }];
  return buildCharacter(b, db);
};

/** Slots per rank for the character's slot-casting entry. */
const slotsByRank = (c: ReturnType<typeof wizardWearing>) => {
  const entry = c.spellcasting.find((e) => e.type === 'prepared' || e.type === 'spontaneous');
  const out: Record<number, number> = {};
  for (const [r, v] of Object.entries(entry?.slots ?? {})) out[Number(r)] = v.max;
  for (const [r, v] of Object.entries(entry?.prepared ?? {})) out[Number(r)] = (v as unknown[]).length;
  return out;
};

describe('Ring of Wizardry grants slots at the printed ranks only', () => {
  it('Type I adds two 1st-rank slots and nothing else', () => {
    const base = slotsByRank(wizardWearing(null));
    const ring = slotsByRank(wizardWearing('ring-of-wizardry-type-i'));
    expect(ring[1] - (base[1] ?? 0)).toBe(2);
    // every OTHER rank is untouched — this is the part that was broken
    for (const r of Object.keys(base).map(Number)) {
      if (r === 1) continue;
      expect(ring[r] - base[r]).toBe(0);
    }
  });

  it('Type IV adds two 4th-rank and one 3rd-rank slot, and nothing else', () => {
    const base = slotsByRank(wizardWearing(null));
    const ring = slotsByRank(wizardWearing('ring-of-wizardry-type-iv'));
    expect(ring[4] - (base[4] ?? 0)).toBe(2);
    expect(ring[3] - (base[3] ?? 0)).toBe(1);
    for (const r of Object.keys(base).map(Number)) {
      if (r === 3 || r === 4) continue;
      expect(ring[r] - base[r]).toBe(0);
    }
  });

  it('an un-worn ring grants nothing', () => {
    const base = slotsByRank(wizardWearing(null));
    const carried = slotsByRank(buildCharacter({ ...emptyBuild(), name: 'x', ancestryId: 'human', classId: 'wizard', backgroundId: Object.keys(content().backgrounds)[0], level: 12, inventory: [{ instanceId: 'r1', itemId: 'ring-of-wizardry-type-i', quantity: 1, invested: false }] }, content()));
    expect(carried[1]).toBe(base[1]);
  });
});
