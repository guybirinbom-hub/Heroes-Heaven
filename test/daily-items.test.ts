import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { dailyItemOptions, dailyItemSlots } from '../src/rules/dailyItems';

/**
 * Temporary items the player makes at daily preparations.
 *
 * `Feat.advancedAlchemy` was the proof this shape works and the proof it was built too narrowly:
 * alchemist-only, feat-keyed, hardcoded to alchemical items. So seven records that hand the player a
 * temporary SCROLL — or a healing item — had nowhere to live and delivered nothing.
 */
const db = content();

const withFeats = (classId: string, level: number, featIds: string[]) => {
  const c = build(classId, level, {});
  return { ...c, feats: [...c.feats, ...featIds.map((featId, i) => ({ featId, level: 1, slot: `x:${i}` }))] } as typeof c;
};

describe('slots appear only for the records that grant them', () => {
  it('a character with none of the feats has no slots', () => {
    expect(dailyItemSlots(build('wizard', 10, {}), db)).toEqual([]);
  });

  it('Basic Scroll Cache grants one 1st-rank scroll', () => {
    const slots = dailyItemSlots(withFeats('rogue', 5, ['basic-scroll-cache']), db);
    expect(slots.length).toBe(1);
    expect(slots[0].spellRank).toBe(1);
    expect(slots[0].sourceName).toBe(db.feats['basic-scroll-cache'].name);
  });

  it('two sources give two slots, each labelled with the feat that granted it', () => {
    const slots = dailyItemSlots(withFeats('rogue', 10, ['basic-scroll-cache', 'expert-scroll-cache']), db);
    expect(slots.length).toBe(2);
    expect(new Set(slots.map((s) => s.sourceId)).size).toBe(2);
    expect(new Set(slots.map((s) => s.key)).size, 'keys must not collide').toBe(2);
  });
});

describe('a scroll whose RANK rises with level', () => {
  const rankAt = (level: number) => dailyItemSlots(withFeats('rogue', level, ['expert-scroll-cache']), db)[0]?.spellRank;

  it('3rd rank to start', () => {
    expect(rankAt(8)).toBe(3);
    expect(rankAt(13)).toBe(3);
  });

  it('4th at 14th level, 5th at 16th — one scroll, not three', () => {
    expect(rankAt(14)).toBe(4);
    expect(rankAt(16)).toBe(5);
    expect(rankAt(20)).toBe(5);
    expect(dailyItemSlots(withFeats('rogue', 20, ['expert-scroll-cache']), db).length).toBe(1);
  });

  it('Master Scroll Cache goes 6th, then 7th at 20th', () => {
    const rank = (level: number) => dailyItemSlots(withFeats('rogue', level, ['master-scroll-cache']), db)[0].spellRank;
    expect(rank(19)).toBe(6);
    expect(rank(20)).toBe(7);
  });
});

describe('Scroll Adept', () => {
  it('grants two, numbered so the player can tell them apart', () => {
    const slots = dailyItemSlots(withFeats('wizard', 12, ['scroll-adept']), db);
    expect(slots.length).toBe(2);
    expect(slots[0].label).toMatch(/1 of 2/);
    expect(slots[1].label).toMatch(/2 of 2/);
    expect(new Set(slots.map((s) => s.key)).size).toBe(2);
  });

  it('draws from YOUR spellbook, not from all of content', () => {
    const c = withFeats('wizard', 12, ['scroll-adept']);
    const slot = dailyItemSlots(c, db)[0];
    expect(slot.fromSpellbook).toBe(true);
    const mine = dailyItemOptions(slot, c, db);
    const everything = dailyItemOptions({ ...slot, fromSpellbook: false }, c, db);
    expect(everything.length, 'the unrestricted pool must be bigger, or this proves nothing').toBeGreaterThan(mine.length);
    const known = new Set(c.spellcasting.flatMap((e) => Object.values(e.repertoire ?? {}).flat()));
    for (const o of mine) expect(known.has(o.id), o.id).toBe(true);
  });

  it('it says what it cannot enforce', () => {
    expect(dailyItemSlots(withFeats('wizard', 12, ['scroll-adept']), db)[0].note).toMatch(/DIFFERENT spell rank/);
  });
});

describe('Herbal Forager makes an ITEM, not a scroll', () => {
  const slot = () => dailyItemSlots(withFeats('ranger', 6, ['herbal-forager']), db)[0];

  it('the slot is trait-filtered rather than rank-filtered', () => {
    expect(slot().spellRank).toBeUndefined();
    expect(slot().traits).toEqual(['alchemical', 'healing']);
    expect(slot().fromKnownFormulas).toBe(true);
  });

  it('every offered item actually carries both traits', () => {
    const c = withFeats('ranger', 6, ['herbal-forager']);
    const opts = dailyItemOptions(slot(), c, db);
    expect(opts.length, 'the pool must not be empty').toBeGreaterThan(10);
    for (const o of opts.slice(0, 40)) {
      const traits = db.items[o.id].traits ?? [];
      expect(traits, o.id).toContain('healing');
      expect(traits, o.id).toContain('alchemical');
    }
  });
});

describe('a scroll slot offers spells of exactly its rank', () => {
  it('and no rituals', () => {
    const c = withFeats('rogue', 10, ['basic-scroll-cache']);
    const opts = dailyItemOptions(dailyItemSlots(c, db)[0], c, db);
    expect(opts.length).toBeGreaterThan(20);
    for (const o of opts.slice(0, 50)) {
      expect(db.spells[o.id].rank, o.id).toBe(1);
      expect(db.spells[o.id].ritual ?? false, o.id).toBe(false);
    }
  });
});

describe('the shipped data', () => {
  it('all six feats carry the field, and every filter is satisfiable', () => {
    const ids = ['basic-scroll-cache', 'expert-scroll-cache', 'master-scroll-cache', 'grand-scroll-esoterica', 'scroll-adept', 'herbal-forager'];
    for (const id of ids) {
      const defs = db.feats[id]?.dailyTemporaryItems;
      expect(defs, id).toBeTruthy();
      for (const d of defs!) {
        const ranks = d.filter.spellRankByLevel?.map((e) => e.rank) ?? (d.filter.spellRank ? [d.filter.spellRank] : []);
        for (const r of ranks) {
          expect(Object.values(db.spells).some((s) => s.rank === r && !s.ritual), `${id}: no rank-${r} spells`).toBe(true);
        }
        if (d.filter.traits?.length) {
          expect(
            Object.values(db.items).some((i) => d.filter.traits!.every((t) => (i.traits ?? []).includes(t))),
            `${id}: no item carries ${d.filter.traits}`,
          ).toBe(true);
        }
      }
    }
  });
});
