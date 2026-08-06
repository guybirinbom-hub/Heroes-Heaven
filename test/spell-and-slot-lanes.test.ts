import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';
import type { Character, SpellcastingEntry } from '../src/rules/types';

/**
 * Records the re-verification found fixable once `spellListAdditions` and the slot lanes existed —
 * plus one over-grant bug found while wiring them.
 */
const db = content();

const focusSpells = (c: Character): string[] =>
  c.spellcasting.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat());
const mainSlots = (c: Character): Record<string, number> => {
  const e = c.spellcasting.find((x) => x.type === 'spontaneous' || x.type === 'prepared');
  return Object.fromEntries(Object.entries(e?.slots ?? {}).map(([r, p]) => [r, p.max]));
};

describe('THE BUG: Advanced Domain granted the initial spell as well as the advanced one', () => {
  const ad = db.feats['advanced-domain'];
  const ec = ad.effectChoices![0];
  const opt = ec.options!.find((o) => o.grant)!;

  it('its initial-domain picker is gone — only the advanced picker remains', () => {
    // Answering both handed a cleric pushing-gust AND disperse-into-air.
    expect(ad.choice ?? null).toBeNull();
    expect(ec.options!.length).toBeGreaterThan(30);
  });

  it('a cleric taking it gains exactly ONE focus spell', () => {
    const c = build('cleric', 12, {
      featPicks: { '12:class': 'advanced-domain' },
      effectChoices: { [`advanced-domain:${ec.id}`]: opt.value },
    } as Partial<BuildState>);
    const granted = opt.grant!.focusSpells!;
    for (const s of granted) expect(focusSpells(c)).toContain(s);
    // …and not the initial spell of the same domain.
    expect(focusSpells(c).filter((s) => !granted.includes(s))).toEqual([]);
  });

  it('Domain Fluency got the same picker WITHOUT inheriting the bug', () => {
    expect(db.feats['domain-fluency'].choice ?? null).toBeNull();
    expect(db.feats['domain-fluency'].effectChoices?.[0]?.options?.length).toBeGreaterThan(30);
    expect(db.feats['domain-fluency'].effectChoices?.[0]?.prompt).toMatch(/advanced/i);
  });
});

describe('spell-list widening', () => {
  it('every named spell resolves — a grant pointing at nothing is worse than none', () => {
    for (const id of ['future-spell-learning', 'sacred-spells']) {
      const spells = db.feats[id].spellListAdditions as { spells: string[] };
      expect(spells.spells.length).toBeGreaterThan(3);
      for (const s of spells.spells) expect(db.spells[s], `${id} → ${s}`).toBeTruthy();
    }
  });

  it('Future Spell Learning reaches the built character', () => {
    const c = build('sorcerer', 10, { featPicks: { '8:class': 'future-spell-learning' } } as Partial<BuildState>);
    expect(c.feats.some((f) => f.featId === 'future-spell-learning')).toBe(true);
    expect(c.spellListAdditions?.['*']).toContain('haste');
    expect(c.spellListAdditions?.['*']).toContain('loose-times-arrow');
  });

  it('and nothing is added without the feat', () => {
    expect(build('sorcerer', 10).spellListAdditions).toBeUndefined();
  });

  it("Sacred Spells' benefit picker is re-authored so it survives a data rebuild", () => {
    const backfill = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as {
      category: string;
      id: string;
      field: string;
    }[];
    expect(backfill.some((e) => e.id === 'sacred-spells' && e.field === 'choice')).toBe(true);
  });
});

describe('extra spell slots', () => {
  it('Conscious Spell Specialization adds ranks 1-4 at its own level', () => {
    const base = mainSlots(build('psychic', 14));
    const withIt = mainSlots(build('psychic', 14, { featPicks: { '14:class': 'conscious-spell-specialization' } } as Partial<BuildState>));
    for (const r of ['1', '2', '3', '4']) expect(withIt[r], `rank ${r}`).toBe(base[r] + 1);
    for (const r of ['5', '6', '7']) expect(withIt[r], `rank ${r} must be untouched`).toBe(base[r]);
  });

  it('…and the 5th-rank slot ONLY from 18th level, as its text says', () => {
    const f = db.feats['conscious-spell-specialization'];
    expect(f.description).toMatch(/At 18th level/i);
    expect(f.spellSlotBonus?.byRankAt).toEqual([{ level: 18, byRank: { 5: 1 } }]);
    const at14 = mainSlots(build('psychic', 14, { featPicks: { '14:class': 'conscious-spell-specialization' } } as Partial<BuildState>));
    const at18 = mainSlots(build('psychic', 18, { featPicks: { '14:class': 'conscious-spell-specialization' } } as Partial<BuildState>));
    const base18 = mainSlots(build('psychic', 18));
    expect(at14['5'], 'not before 18').toBe(mainSlots(build('psychic', 14))['5']);
    expect(at18['5'], 'and one more at 18').toBe(base18['5'] + 1);
  });

  it('the restriction it cannot enforce is TOLD to the player, not faked', () => {
    // Writing a `restriction` field nothing reads is how a fix becomes a lie.
    expect(db.feats['conscious-spell-specialization'].dataWarning).toMatch(/conscious mind/i);
    expect((db.feats['conscious-spell-specialization'].spellSlotBonus as Record<string, unknown>).restriction).toBeUndefined();
  });

  it('Captivating Intensity is pinned to the captivator archetype entry', () => {
    expect(db.feats['captivating-intensity'].spellSlotBonus).toEqual({
      perRank: 1,
      exceptHighest: 2,
      entryId: 'captivator-dedication-casting',
    });
  });
});

describe('Draconic Paragon', () => {
  it("adds deadly d6 to the draconic unarmed strikes it names", () => {
    expect(db.feats['draconic-paragon'].unarmedTraits).toEqual({ match: ['jaw', 'claw', 'tail'], add: ['deadly-d6'] });
  });
});
