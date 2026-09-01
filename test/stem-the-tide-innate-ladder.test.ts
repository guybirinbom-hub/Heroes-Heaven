import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';
import { emptyBuild } from '../src/rules/build';
import type { Character } from '../src/rules/types';

/**
 * STEM THE TIDE — the spelled-out heighten ladder, end to end.
 *
 * Tian Xia Character Guide p.80 (AoN feat-6977): *"You can cast protector tree as a 1st-rank primal
 * innate spell once per day. At 7th level, the spell is heightened to 2nd rank, and every 2 levels
 * thereafter, the spell is heightened an additional spell rank."*
 *
 * Two earlier audits (scripts/audit/patches.jsonl, covered-batch2.json) filed this as a CONFIRMED
 * GAP — "InnateSpellGrant has no rank/heighten field … the level-7+ heightening never reaches the
 * sheet". It was later built, via the `heightenAt` ladder authored in scripts/data/effect-backfill.json
 * and read by castRank in build.ts. Nothing tested it, so the only evidence it still works was a
 * human re-reading build.ts. This is that evidence, mechanised:
 *
 *   · the grant is COLLECTED  — build.ts, the feat loop over `content.feats[f.featId].innateSpells`
 *   · the ladder is APPLIED   — build.ts castRank, `g.heightenAt` → the highest step reached
 *   · the result is FILED     — build.ts, `innateRep[rank]`, which SpellsTab renders for a type
 *                               'innate' entry
 *   · the feat is REACHABLE   — a yaksha is actually offered it
 *
 * A field with no reader is not built; this test fails the moment any link in that chain goes.
 */
const c = () => content();
const innate = (ch: Character) => ch.spellcasting.find((e) => e.id === 'innate-casting');
/** The rank the pooled innate entry casts a spell at (its bucket in the repertoire). */
const innateRank = (ch: Character, spellId: string) =>
  Number(Object.entries(innate(ch)?.repertoire ?? {}).find(([, ids]) => ids.includes(spellId))?.[0] ?? 0);

/** A character of `level` holding one feat. The slot key is not policed by buildCharacter. */
const withFeat = (featId: string, level: number) =>
  build('fighter', level, { featPicks: { [`${level}:general:0`]: featId } });

describe('Stem the Tide — protector tree heighten ladder', () => {
  it('the authored ladder and its spell are both present', () => {
    const g = c().feats['stem-the-tide']?.innateSpells?.[0];
    expect(g?.spellId).toBe('protector-tree');
    expect(g?.tradition).toBe('primal');
    expect(g?.usesPerDay).toBe(1);
    expect(g?.rank).toBe(1);
    expect(g?.heightenAt).toEqual([
      { level: 7, rank: 2 }, { level: 9, rank: 3 }, { level: 11, rank: 4 }, { level: 13, rank: 5 },
      { level: 15, rank: 6 }, { level: 17, rank: 7 }, { level: 19, rank: 8 },
    ]);
    expect(c().spells['protector-tree']).toBeTruthy();
  });

  it('a character casts it at the printed rank at every level', () => {
    // "1st rank; at 7th, 2nd; every 2 levels thereafter, one more rank."
    const bands: [number, number][] = [
      [5, 1], [6, 1], [7, 2], [8, 2], [9, 3], [10, 3], [11, 4], [12, 4],
      [13, 5], [14, 5], [15, 6], [16, 6], [17, 7], [18, 7], [19, 8], [20, 8],
    ];
    for (const [level, rank] of bands) {
      expect(innateRank(withFeat('stem-the-tide', level), 'protector-tree'), `level ${level}`).toBe(rank);
    }
  });

  it('once per day, primal, and the Player Core p.298 expert step at 12th', () => {
    const e5 = innate(withFeat('stem-the-tide', 5))!;
    expect(e5.spellTraditions?.['protector-tree']).toBe('primal');
    // `innateUses` records only a count that is NOT the 1/day default.
    expect(e5.innateUses?.['protector-tree']).toBeUndefined();
    expect(e5.proficiency).toBe('trained');
    expect(innate(withFeat('stem-the-tide', 11))!.proficiency).toBe('trained');
    expect(innate(withFeat('stem-the-tide', 12))!.proficiency).toBe('expert');
  });

  it('is reachable — a yaksha is offered it, and nobody else gets the spell for free', () => {
    const b = {
      ...emptyBuild(), name: 't', level: 5, classId: 'fighter', ancestryId: 'yaksha',
      backgroundId: Object.keys(c().backgrounds)[0], keyAbility: 'str' as const,
    };
    const opts = eligibleFeatsForSlot(b as never, c(), { level: 5, category: 'ancestry', index: 0 } as never);
    expect(opts.map((f) => f.id)).toContain('stem-the-tide');
    expect(innateRank(build('fighter', 20), 'protector-tree')).toBe(0);
  });
});
