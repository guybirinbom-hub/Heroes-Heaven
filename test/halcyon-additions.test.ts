import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { activeCasterArchetype, archetypeSlots, archetypeTraditionOptions } from '../src/rules/casterArchetypes';

/**
 * "You gain a halcyon cantrip and a 1st-rank halcyon spell."
 *
 * Both feats saying this were inert. Nothing added a cantrip or a KNOWN spell to an archetype
 * spellcasting entry: the generic slot applier runs long after the entry is built and only raises
 * `slots[r].max`, and a spontaneous archetype slices its repertoire out of `slots` at construction —
 * so a bonus arriving later produced a slot with nothing that could go in it.
 */
const db = content();

const cantripIds = Object.entries(db.spells)
  .filter(([, s]) => s.rank === 0 && (s.traditions ?? []).includes('arcane'))
  .slice(0, 4)
  .map(([id]) => id);
const rank1 = Object.entries(db.spells)
  .filter(([, s]) => s.rank === 1 && !s.ritual && (s.traditions ?? []).includes('arcane'))
  .slice(0, 3)
  .map(([id]) => id);

describe('Shattered Sacrament — a halcyon cantrip and a 1st-rank halcyon spell', () => {
  const halcyon = (level: number, extra: Record<string, string> = {}) =>
    build('fighter', level, {
      featPicks: {
        '6:class:0': 'halcyon-speaker-dedication',
        ...extra,
      },
      archetypeTradition: 'arcane',
      cantrips: cantripIds,
      spells: { 1: rank1 },
    });

  it('adds one cantrip and one known 1st-rank spell to the halcyon entry', () => {
    const without = halcyon(14);
    const withIt = halcyon(14, { '14:class:0': 'shattered-sacrament' });
    const e = (c: ReturnType<typeof build>) => c.spellcasting.find((s) => s.id === 'halcyon-speaker-dedication-casting');
    expect(e(without)?.cantrips).toHaveLength(2);
    expect(e(withIt)?.cantrips).toHaveLength(3);
    // The KNOWN spell is the point — and known can EXCEED slots. The dedication itself prints "two
    // common 1st-rank halcyon spells" over ONE 1st-rank slot (config extraKnown), and Shattered
    // Sacrament's "you learn shattered sacrament, a 1st-rank halcyon spell" is a third KNOWN spell,
    // not a second slot (batch-18 parity: its old byRank {1:1} slot was the mis-encoding).
    expect(e(withIt)?.repertoire?.[1]).toHaveLength(3);
    expect(e(withIt)?.slots?.[1]?.max).toBe(1);
    expect(e(without)?.repertoire?.[1]).toHaveLength(2);
    expect(e(without)?.slots?.[1]?.max).toBe(1);
  });

  it('the divine-instead clause is recorded as a note, not faked as a tradition change', () => {
    // "When you cast a halcyon spell, you can choose for it to be a divine spell instead" is a
    // per-cast decision at the table; the entry keeps its chosen list.
    expect(db.feats['shattered-sacrament'].note).toMatch(/divine/i);
    expect(db.feats['shattered-sacrament'].dataWarning).toBeUndefined();
  });
});

describe('Cascade Bearer’s Spellcasting — the Attendant becomes a real caster', () => {
  const attendant = (level: number, extra: Record<string, string> = {}) =>
    build('fighter', level, {
      featPicks: { '4:class:0': 'magaambyan-attendant-dedication', ...extra },
      archetypeTradition: 'arcane',
      cantrips: cantripIds,
      spells: { 1: rank1 },
    });

  it('without it the Attendant is one innate cantrip and no slots', () => {
    const e = attendant(10).spellcasting.find((s) => s.id === 'magaambyan-attendant-dedication-casting');
    expect(e?.type).toBe('innate');
    expect(e?.cantrips).toHaveLength(1);
    expect(e?.slots ?? {}).toEqual({});
  });

  it('with it the entry becomes spontaneous: two cantrips and one known 1st-rank spell', () => {
    const e = attendant(10, { '10:class:0': 'cascade-bearers-spellcasting' }).spellcasting.find(
      (s) => s.id === 'magaambyan-attendant-dedication-casting',
    );
    expect(e?.type).toBe('spontaneous');
    expect(e?.cantrips).toHaveLength(2);
    expect(e?.repertoire?.[1]).toHaveLength(1);
    expect(e?.slots?.[1]?.max).toBe(1);
  });

  it('…and not before 10th level', () => {
    const e = attendant(9, { '8:class:0': 'cascade-bearers-spellcasting' }).spellcasting.find(
      (s) => s.id === 'magaambyan-attendant-dedication-casting',
    );
    expect(e?.type).toBe('innate');
  });

  it('it widens the halcyon list to divine and occult', () => {
    const base = activeCasterArchetype(['magaambyan-attendant-dedication'])!;
    expect(archetypeTraditionOptions(base)).toEqual(['arcane', 'primal']);
    const wide = activeCasterArchetype(['magaambyan-attendant-dedication', 'cascade-bearers-spellcasting'])!;
    expect(archetypeTraditionOptions(wide)).toEqual(['arcane', 'primal', 'divine', 'occult']);
    // The slot itself is on the archetype's own schedule, not on the standard ladder.
    expect(archetypeSlots(10, wide)).toEqual({ 1: 1 });
    expect(archetypeSlots(9, wide)).toEqual({});
  });
});

describe('Magaambyan Attendant + Halcyon Speaker — one merged caster (batch-18 parity)', () => {
  // The Attendant is the Halcyon Speaker's printed prerequisite, so before the merge the first-match
  // loop always resolved the Attendant's innate-cantrip config: a legal L6 halcyon speaker got one
  // innate cantrip, zero slots and zero halcyon spells.
  const both = (level: number, extra: Record<string, string> = {}) =>
    build('fighter', level, {
      featPicks: {
        '4:class:0': 'magaambyan-attendant-dedication',
        '6:class:0': 'halcyon-speaker-dedication',
        ...extra,
      },
      archetypeTradition: 'arcane',
      cantrips: cantripIds,
      spells: { 1: rank1 },
    });

  it('keeps the Attendant entry id and becomes a spontaneous halcyon caster at L6', () => {
    const c = both(6);
    // ONE entry, on the Attendant's id — not two casters, and not the innate one-cantrip config.
    expect(c.spellcasting.filter((s) => s.id.endsWith('-dedication-casting'))).toHaveLength(1);
    const e = c.spellcasting.find((s) => s.id === 'magaambyan-attendant-dedication-casting');
    expect(e?.type).toBe('spontaneous');
    // 3 cantrips (1 Attendant + 2 Halcyon), and "two common 1st-rank halcyon spells" over ONE slot.
    expect(e?.cantrips).toHaveLength(3);
    expect(e?.repertoire?.[1]).toHaveLength(2);
    expect(e?.slots?.[1]?.max).toBe(1);
  });

  it('rows aimed at the Halcyon entry id still fire through the alias', () => {
    const c = both(14, { '14:class:0': 'shattered-sacrament' });
    const e = c.spellcasting.find((s) => s.id === 'magaambyan-attendant-dedication-casting');
    // Shattered Sacrament: +1 cantrip and a third KNOWN 1st-rank spell, still one slot.
    expect(e?.cantrips).toHaveLength(4);
    expect(e?.repertoire?.[1]).toHaveLength(3);
    expect(e?.slots?.[1]?.max).toBe(1);
  });

  it('the halcyon schedule and proficiency feats carry over', () => {
    const arch = activeCasterArchetype(['magaambyan-attendant-dedication', 'halcyon-speaker-dedication', 'halcyon-spellcasting-initiate'])!;
    expect(archetypeSlots(10, arch)).toEqual({ 1: 1, 2: 1, 3: 1 });
    expect(arch.config.profExpertFeat).toBe('halcyon-spellcasting-adept');
  });
});
