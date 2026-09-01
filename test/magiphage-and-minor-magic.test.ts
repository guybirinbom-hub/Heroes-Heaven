import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { narrowSpellFilter, emptyBuild, type BuildState } from '../src/rules/build';
import { spellsMatching } from '../src/rules/spellChoice';

const db = content();

/**
 * ONE ANSWER, MANY PICKERS — two records whose printed text binds a spell list to a tradition the
 * character chose somewhere else. Both shipped as pickers over all four lists, with the constraint
 * living only in the prompt.
 */

/*
 * ⚠ Assert MEMBERSHIP, not the union of the offered spells' tradition lists. A cantrip like Daze sits
 * on all four lists, so collecting `s.traditions` returns all four even when the filter is working
 * perfectly — the first version of this test failed for that reason and the code was right.
 */
const offered = (filter: Parameters<typeof narrowSpellFilter>[0], build: BuildState) =>
  spellsMatching(narrowSpellFilter(filter, build, db), db);
/** True when every spell offered is on the named list — what "narrowed to that tradition" means. */
const allOn = (filter: Parameters<typeof narrowSpellFilter>[0], build: BuildState, tradition: string) => {
  const list = offered(filter, build);
  return list.length > 0 && list.every((s) => (s.traditions ?? []).includes(tradition as never));
};

describe('the surki magiphage tradition', () => {
  /*
   * Surki, Howl of the Wild: *"Magiphage … Choose what tradition of magic you most consumed as a larva;
   * this type of magic has become so ingrained in your body that it changes the tradition of all surki
   * spells and magical actions to that tradition."*
   *
   * The question was asked by NOTHING — the builder rendered choices for feats, class features and
   * heritages only — while four records key off the answer.
   */
  it('is a real question on the ancestry, with the four traditions', () => {
    const def = db.ancestries.surki.choice;
    expect(def?.flag).toBe('magiphageTradition');
    expect(def?.kind).toBe('array');
    expect((def?.options ?? []).map((o) => o.value)).toEqual(['arcane', 'divine', 'occult', 'primal']);
    // Not an inert note: an answer nothing can read is not a recorded answer.
    expect(def?.inert).toBeUndefined();
  });

  const surki = (answer?: string): BuildState => ({
    ...emptyBuild(),
    ancestryId: 'surki',
    ...(answer ? { featChoices: { 'ancestry:surki': answer } } : {}),
  } as BuildState);

  const seqFilter = () => db.feats['sequestered-spell'].effectChoices![0].spellFilter!;

  it("narrows Sequestered Spell's cantrip list to the answer", () => {
    // *"Choose one cantrip from the spell list of your magiphage ability."*
    expect(allOn(seqFilter(), surki('primal'), 'primal')).toBe(true);
    expect(allOn(seqFilter(), surki('occult'), 'occult')).toBe(true);
    // …and it genuinely removes options rather than reordering them.
    expect(offered(seqFilter(), surki('primal')).length).toBeLessThan(offered(seqFilter(), surki()).length);
  });

  it('offers every tradition until the question is answered', () => {
    // A half-built character sees the whole list rather than an empty picker.
    const all = offered(seqFilter(), surki());
    expect(all.some((s) => !(s.traditions ?? []).includes('primal' as never))).toBe(true);
  });

  it('does not leak to a non-surki character', () => {
    const human = { ...emptyBuild(), ancestryId: 'human', featChoices: { 'ancestry:surki': 'primal' } } as BuildState;
    expect(offered(seqFilter(), human).length).toBe(offered(seqFilter(), surki()).length);
  });
});

describe('Minor Magic binds both cantrips to one tradition', () => {
  /* *"Choose arcane, divine, occult, or primal magic, and gain two cantrips from the common cantrips
   * available to THAT tradition."* It shipped as two independent pickers over all four lists, so
   * nothing stopped an arcane cantrip sitting beside a primal one. */
  const bothFilters = () => db.feats['minor-magic'].effectChoices!.map((c) => c.spellFilter!);

  it('asks the tradition once', () => {
    const def = db.feats['minor-magic'].choice;
    expect(def?.flag).toBe('minorMagicTradition');
    expect((def?.options ?? []).map((o) => o.value)).toEqual(['arcane', 'divine', 'occult', 'primal']);
  });

  it('narrows BOTH cantrip pickers to the one answer', () => {
    // The answer is found via the flag on the record that asked, at its own storage slot…
    const withFeat = {
      ...emptyBuild(),
      featPicks: { '1:class': 'minor-magic' },
      featChoices: { '1:class': 'divine' },
    } as unknown as BuildState;
    for (const f of bothFilters()) {
      expect(allOn(f, withFeat, 'divine')).toBe(true);
      expect(offered(f, withFeat).length).toBeLessThan(offered(f, emptyBuild() as BuildState).length);
    }
    // …and an unrelated stored value is not mistaken for it.
    const stray = { ...emptyBuild(), featChoices: { x: 'divine' } } as BuildState;
    for (const f of bothFilters()) {
      expect(offered(f, stray).length).toBe(offered(f, emptyBuild() as BuildState).length);
    }
  });
});
