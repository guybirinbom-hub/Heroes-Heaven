import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import type { Character } from '../src/rules/types';

/**
 * OATIA SKYSAGE DEDICATION — *"You either become trained in Astronomy Lore or an expert in
 * Occultism."* (feat-8112.)
 *
 * The clause is ONE printed decision with TWO DIFFERENT RANKS on its branches, and it is carried by
 * the record's own `effectChoices` picker (`skysage-training`, authored in
 * scripts/data/effect-backfill.json, applied by build.ts's `resolvePick` → `applyAlwaysOn`). It is
 * deliberately NOT a `FEAT_GRANTS` row: batch 037 REMOVED the one that was there, because a
 * `skillChoices` slot can carry only one rank, so it offered Occultism at *trained* and asked the
 * player the same question a second time — answer the two prompts differently and you came out
 * trained in Astronomy Lore AND Occultism off a clause that gives exactly one of them. The note
 * lives at src/rules/featGrantsLane.ts:61.
 *
 * This file pins that resolution from the OUTSIDE — on a built character, through whichever lane is
 * wired — so the gap cannot be re-reported and re-fixed as a second carrier. A measurement that
 * reads only the FEAT_GRANTS table sees "Oatia grants nothing" and is wrong; the grant is in the
 * data, and the absence of the row is the fix.
 */
const db = content();

/** The level-2 archetype slot is the only place this dedication can be taken. */
const skysage = (answer?: string): Character =>
  buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level: 2,
      classId: 'fighter',
      keyAbility: 'str',
      ancestryId: 'human',
      backgroundId: 'acrobat',
      featPicks: { '2:class:0': 'oatia-skysage-dedication' },
      ...(answer ? { effectChoices: { 'oatia-skysage-dedication:skysage-training': answer } } : {}),
    } as BuildState,
    db,
  );

const skills = (c: Character) => c.proficiencies.skills as Record<string, string | undefined>;

describe('Oatia Skysage Dedication gives ONE of its two printed branches', () => {
  it('the record asks the question once, and no FEAT_GRANTS row asks it again', () => {
    const ch = db.feats['oatia-skysage-dedication']?.effectChoices?.find((c) => c.id === 'skysage-training');
    expect(ch?.options.map((o) => o.value)).toEqual(['astronomy-lore', 'occultism-expert']);
    // A second carrier keyed off a second prompt is the defect batch 037 removed — see the header.
    expect(FEAT_GRANTS['oatia-skysage-dedication']).toBeUndefined();
  });

  it('branch A trains Astronomy Lore and leaves Occultism alone', () => {
    const s = skills(skysage('astronomy-lore'));
    expect(s['lore:astronomy']).toBe('trained');
    expect(s.occultism ?? 'untrained').toBe('untrained');
  });

  /*
   * *"an EXPERT in Occultism"* on a character who is not yet trained in it. The grant is applied by
   * `maxRank`, which only ever RAISES — so it lands as expert outright, with no intermediate trained
   * step and no gate. That is the app's convention for every flat expert grant (compare
   * `cultivator-dedication`'s `skills: { occultism: 'expert' }`), and it costs nothing here: the
   * feat's own printed prerequisite is *"trained in Occultism"*, so a legal taker is already trained.
   */
  it('branch B makes Occultism expert — from untrained, in one step — and grants no Lore', () => {
    expect(skills(skysage()).occultism ?? 'untrained', 'the chassis must not pre-train Occultism').toBe('untrained');
    const s = skills(skysage('occultism-expert'));
    expect(s.occultism).toBe('expert');
    expect(s['lore:astronomy'] ?? 'untrained').toBe('untrained');
  });

  /* No answer, no grant — the standing convention for a real either/or. `defaultFirst` is passed by
   * the heritage call sites only, and both branches here are a genuine decision, not a printed skill
   * with an escape hatch. */
  it('an unanswered pick grants neither', () => {
    const s = skills(skysage());
    expect(s['lore:astronomy'] ?? 'untrained').toBe('untrained');
    expect(s.occultism ?? 'untrained').toBe('untrained');
  });
});
