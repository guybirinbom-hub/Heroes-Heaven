import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { dailyItemOptions, dailyItemSlots } from '../src/rules/dailyItems';
import { enabledBookSet } from '../src/rules/sources';

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

  /* "It must be an item whose formula you know" — a clause with nothing to filter against until the
   * formula book existed. The pool is now the intersection of the two, so a character carrying a book
   * is offered their own formulas and nobody else's. */
  const withBook = (formulas: string[]) => {
    const c = withFeats('ranger', 6, ['herbal-forager']);
    return { ...c, inventory: [...c.inventory, { instanceId: 'book-1', itemId: 'formula-book-blank', quantity: 1, formulas }] };
  };

  it('offers the formulas the book holds, and only those carrying both traits', () => {
    const opts = dailyItemOptions(slot(), withBook(['elixir-of-life-minor', 'antidote-lesser', 'merciful-balm']), db);
    // Both elixirs are alchemical + healing; Merciful Balm is a magical oil, so a known formula still
    // has to satisfy the record's own filter.
    expect(opts.map((o) => o.id).sort()).toEqual(['antidote-lesser', 'elixir-of-life-minor']);
    for (const o of opts) {
      const traits = db.items[o.id].traits ?? [];
      expect(traits, o.id).toContain('healing');
      expect(traits, o.id).toContain('alchemical');
    }
  });

  it('a character with no formula book is offered nothing, which the Rest sheet already says', () => {
    expect(dailyItemOptions(slot(), withFeats('ranger', 6, ['herbal-forager']), db)).toEqual([]);
  });
});

/*
 * package I: i6c-practical-magic-common-catalysts. Practical Magic (Hedge Mage, AoN feat-9331, Impossible Magic
 * pg. 95): "You know the formulas for all common spell catalysts of your level or lower. ... Each day during your
 * daily preparations, you can make two spell catalysts with an item level no higher than half your level. You
 * must know each spell catalyst's formula." The row once capped the level and let every rarity through (66 of the
 * 150 catalysts are uncommon or rare). The pool is now the common ones plus any whose formula the character holds
 * in a formula book; a pick the player already made today stays on the list (a player's change is never overwritten).
 */
describe('Practical Magic offers the common spell catalysts, and an uncommon or rare one only when its formula is known', () => {
  const FEAT = 'practical-magic-impossible-magic';
  const caster = () => withFeats('wizard', 12, [FEAT]);
  const slot = () => dailyItemSlots(caster(), db)[0];
  const withBook = (formulas: string[]) => {
    const c = caster();
    return { ...c, inventory: [...c.inventory, { instanceId: 'book-1', itemId: 'formula-book-blank', quantity: 1, formulas }] };
  };
  const ids = (c = caster(), o?: { enabled?: Set<string>; keep?: string }) => dailyItemOptions(slot(), c, db, o).map((x) => x.id);
  const catalysts = Object.values(db.items).filter((i) => (i.traits ?? []).includes('catalyst'));
  // Half of level 12 is 6. Measured 2026-10-17: 41 common, 16 uncommon and 7 rare catalysts at level 6 or lower.
  const atOrBelow6 = catalysts.filter((i) => (i.level ?? 0) <= 6);

  it('the shipped feat gives two slots that carry the rarity filter and the known-formula union', () => {
    // package I: i6c-practical-magic-common-catalysts
    expect(dailyItemSlots(caster(), db)).toHaveLength(2);
    for (const s of dailyItemSlots(caster(), db)) {
      // package I: i6c-practical-magic-common-catalysts
      expect(s.rarity).toEqual(['common']);
      expect(s.orKnownFormulas).toBe(true);
      expect(s.maxLevel).toBe(6);
      expect(s.traits).toEqual(['catalyst']);
    }
  });

  it('dailyItemSlots copies rarity and orKnownFormulas from the definition onto the slot', () => {
    const rec = db.feats[FEAT];
    const filter = { ...rec.dailyTemporaryItems![0].filter, rarity: ['rare'], orKnownFormulas: false };
    const patched = { ...db, feats: { ...db.feats, [FEAT]: { ...rec, dailyTemporaryItems: [{ ...rec.dailyTemporaryItems![0], filter }] } } };
    const s = dailyItemSlots(caster(), patched)[0];
    // package I: i6c-practical-magic-common-catalysts
    expect(s.rarity).toEqual(['rare']);
    expect(s.orKnownFormulas).toBeUndefined();
    // a definition with no rarity key yields a slot with none
    const bare = { ...rec.dailyTemporaryItems![0], filter: { traits: ['catalyst'], maxLevel: 3 } };
    const patched2 = { ...db, feats: { ...db.feats, [FEAT]: { ...rec, dailyTemporaryItems: [bare] } } };
    expect(dailyItemSlots(caster(), patched2)[0].rarity).toBeUndefined();
  });

  it('offers common catalysts at half level or lower, and no uncommon or rare one', () => {
    const offered = ids();
    const common = atOrBelow6.filter((i) => (i.rarity ?? 'common') === 'common');
    expect(common.length).toBeGreaterThan(30);
    // package I: i6c-practical-magic-common-catalysts
    expect(offered.sort()).toEqual(common.map((i) => i.id).sort());
    expect(offered).toContain('deadlock-mint');
    // package I: i6c-practical-magic-common-catalysts
    for (const id of ['unsullied-blood', 'demon-bone-tiles', 'black-ash', 'grave-token', 'steadfast-sentinel']) {
      expect(offered, id).not.toContain(id);
      expect(db.items[id].rarity, `${id} is not common`).not.toBe('common');
      expect(db.items[id].level ?? 0, `${id} is within the level cap`).toBeLessThanOrEqual(6);
    }
    for (const id of offered) expect(db.items[id].rarity ?? 'common', id).toBe('common');
  });

  it('an uncommon or rare catalyst whose formula is in a formula book is offered; the rest stay out', () => {
    const offered = ids(withBook(['unsullied-blood', 'demon-bone-tiles']));
    // package I: i6c-practical-magic-common-catalysts
    expect(offered).toContain('unsullied-blood');
    expect(offered).toContain('demon-bone-tiles');
    expect(offered).not.toContain('black-ash');
    expect(offered).toContain('deadlock-mint');
    expect(offered).toHaveLength(ids().length + 2);
  });

  it('a known formula still obeys the half-level cap, and the trait', () => {
    const tooHigh = catalysts.find((i) => (i.level ?? 0) > 6 && i.rarity !== 'common');
    expect(tooHigh, 'an uncommon or rare catalyst above level 6').toBeTruthy();
    const offered = ids(withBook([tooHigh!.id, 'elixir-of-life-minor']));
    // package I: i6c-practical-magic-common-catalysts
    expect(offered).not.toContain(tooHigh!.id);
    expect(offered).not.toContain('elixir-of-life-minor');
  });

  it('a formula held in a book counts even with the catalyst\'s own book switched off (what the character holds is never narrowed)', () => {
    const core = enabledBookSet(undefined);
    const offered = ids(withBook(['unsullied-blood']), { enabled: core });
    // package I: i6c-practical-magic-common-catalysts
    expect(offered).toContain('unsullied-blood');
    expect(ids(caster(), { enabled: core })).not.toContain('unsullied-blood');
  });

  it("the player's stored pick stays on the list whatever its rarity, and lets nothing else through", () => {
    const offered = ids(caster(), { keep: 'black-ash' });
    // package I: i6c-practical-magic-common-catalysts
    expect(offered).toContain('black-ash');
    expect(offered).not.toContain('unsullied-blood');
    expect(ids(caster(), { keep: 'black-ash' })).toHaveLength(ids().length + 1);
  });

  // mutation-proof controls: each clause of the new code is what removes the entry, and only that clause
  it('without the rarity key the slot offers every catalyst at or below the cap; without the union a book does not unlock one', () => {
    const c = caster();
    const open = dailyItemOptions({ ...slot(), rarity: undefined }, c, db).map((x) => x.id);
    // package I: i6c-practical-magic-common-catalysts
    expect(open).toHaveLength(atOrBelow6.length);
    expect(open).toContain('unsullied-blood');
    const noUnion = dailyItemOptions({ ...slot(), orKnownFormulas: false }, withBook(['unsullied-blood']), db).map((x) => x.id);
    // package I: i6c-practical-magic-common-catalysts
    expect(noUnion).not.toContain('unsullied-blood');
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
