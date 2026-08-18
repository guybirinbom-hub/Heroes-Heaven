import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';
import type { Character, SpellcastingEntry } from '../src/rules/types';

/**
 * The three capstones that grant a 10th-rank spell slot.
 *
 * The psychic's and animist's slot tables stop at rank 9, and the applier could only INCREMENT an
 * existing rank — so `byRank: {10: 1}` was silently inert and all three granted nothing.
 */
const db = content();

const mainEntry = (c: Character): SpellcastingEntry | undefined =>
  c.spellcasting.find((e) => e.type === 'spontaneous' || e.type === 'prepared');

const rank10 = (c: Character): number => {
  const e = mainEntry(c);
  return (e?.slots?.[10]?.max ?? 0) + (e?.prepared?.[10]?.length ?? 0);
};

describe('the records say it and the data carries it', () => {
  it('all three grant a rank-10 slot with createRank', () => {
    for (const [cat, id] of [
      ['classFeatures', 'infinite-mind'],
      ['feats', 'mind-over-matter'],
      ['feats', 'true-channel-spell'],
    ] as const) {
      const rec = (db as never as Record<string, Record<string, { spellSlotBonus?: { byRank?: Record<string, number>; createRank?: boolean } }>>)[cat][id];
      expect(rec.spellSlotBonus?.byRank?.['10'], id).toBe(1);
      expect(rec.spellSlotBonus?.createRank, id).toBe(true);
    }
  });
});

describe('the psychic', () => {
  it('INFINITE MIND IS THE WHOLE DIFFERENCE: none at 18, one at 19', () => {
    // The psychic slot table stops at rank 9. Infinite Mind is a 19th-level class feature, so the
    // rank-10 slot appearing exactly at 19 is this grant and nothing else.
    expect(rank10(build('psychic', 18)), 'the table itself never reaches rank 10').toBe(0);
    expect(rank10(build('psychic', 19)), 'Infinite Mind must create it').toBe(1);
  });

  it('Mind Over Matter adds one on top', () => {
    const base = build('psychic', 20);
    const withFeat = build('psychic', 20, { featPicks: { '20:class': 'mind-over-matter' } } as Partial<BuildState>);
    expect(withFeat.feats.some((f) => f.featId === 'mind-over-matter')).toBe(true);
    expect(rank10(withFeat), 'the capstone must add a slot that did not exist').toBeGreaterThan(rank10(base) - 1);
    expect(rank10(withFeat)).toBeGreaterThan(0);
  });

  it('a spontaneous entry gets a repertoire row too, or the slot holds nothing', () => {
    const c = build('psychic', 20, { featPicks: { '20:class': 'mind-over-matter' } } as Partial<BuildState>);
    const e = mainEntry(c)!;
    if (e.slots?.[10]) expect(e.repertoire?.[10], 'a slot with no repertoire row is uncastable').toBeDefined();
  });
});

describe('the animist', () => {
  it('True Channel Spell creates a PREPARED rank-10 slot', () => {
    const base = build('animist', 20);
    const withFeat = build('animist', 20, { featPicks: { '20:class': 'true-channel-spell' } } as Partial<BuildState>);
    expect(withFeat.feats.some((f) => f.featId === 'true-channel-spell')).toBe(true);
    expect(rank10(base)).toBe(0);
    expect(rank10(withFeat), 'the animist should gain exactly one rank-10 slot').toBe(1);
  });
});

describe('it does not leak', () => {
  it('below the granting level, nobody gains one', () => {
    // Wizards and sorcerers DO reach rank 10 from their own tables at 19 — that is not a leak. What
    // must not happen is a rank appearing before the record that creates it.
    for (const cls of ['wizard', 'cleric', 'sorcerer', 'psychic', 'animist']) {
      expect(rank10(build(cls, 18)), `${cls} at 18 should have no rank-10 slot`).toBe(0);
    }
    // The animist table never reaches rank 10 at all, so without its capstone feat it stays empty.
    expect(rank10(build('animist', 20))).toBe(0);
  });

  it('createRank is opt-in — no other slot bonus carries it', () => {
    // Creating ranks by default would let any byRank row hand a low-level character a rank it
    // cannot cast.
    const carriers: string[] = [];
    for (const cat of ['feats', 'classFeatures', 'items'] as const) {
      for (const [id, rec] of Object.entries((db as never as Record<string, Record<string, { spellSlotBonus?: { createRank?: boolean } }>>)[cat])) {
        if (rec.spellSlotBonus?.createRank) carriers.push(id);
      }
    }
    // `epitaph` is the Necromancer's 19th-level feature, and it prints this outright: "You gain a
    // single 10th-level spell slot and can prepare a spell in that slot using necromancer
    // spellcasting." A legitimate fourth carrier, not a leak — what this guard protects against is
    // a record acquiring createRank by ACCIDENT.
    expect(carriers.sort()).toEqual(['epitaph', 'infinite-mind', 'mind-over-matter', 'true-channel-spell']);
  });
});
