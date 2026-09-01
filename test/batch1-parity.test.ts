import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';
import type { Character } from '../src/rules/types';

/*
 * BATCH 1 — the only batch cut before the level ordering, and so the only one holding classes,
 * backgrounds and a great many items.
 *
 * Most of what its gates reported were blind spots in the COMPARERS rather than defects in the data:
 * a class states its saves and skills on itself, a background states its trained skill and its
 * ability-boost choice on itself, an item states its Speed under `passiveEffects` and its spells under
 * `heldSpells` — and none of those fields were read. 24 kinds gaps became 6, 13 value gaps became 1 and
 * 17 identity gaps became 5 once the instruments could see them.
 *
 * These tests cover the remainder: the records whose printed text really did reach nothing, and the two
 * engine lanes that had to exist first. Both lanes are the same failure — a HERITAGE could carry the
 * right field and no reader would ever look at it.
 */
const db = content();

describe('batch 1 — Skilled Heritage was ALREADY modelled, on a lane the grep missed', () => {
  /*
   * *"You become trained in one skill of your choice. At 5th level, you become an expert in the chosen
   * skill."* Batch 1's kinds gate reported this as missing, and it is not: it lives in
   * `build.heritageSkill`, a first-class build field with its own builder control, and buildCharacter
   * applies the 5th-level step beside it.
   *
   * ⚠ I authored a duplicate FEAT_GRANTS entry for it first, on the strength of a grep across
   * `featGrants*.ts` — which is not where that lane lives. It granted a SECOND skill on top and broke
   * the reverse-build round-trip. The lesson is pinned here rather than written in a comment nobody
   * runs: this asserts the ONE lane delivers both clauses, so a second one would show up as a second
   * trained skill.
   */
  const human = (level: number, skill: string) =>
    build('fighter', level, { heritageId: 'skilled-human', heritageSkill: skill } as Partial<BuildState>);

  it('trains the chosen skill at 1st level, and raises THAT skill at 5th', () => {
    expect(human(1, 'occultism').proficiencies.skills.occultism).toBe('trained');
    expect(human(5, 'occultism').proficiencies.skills.occultism, 'the ladder follows the pick').toBe('expert');
    /* A fighter has no other route to Occultism, so this can only have come from the heritage. */
    expect(build('fighter', 5).proficiencies.skills.occultism ?? 'untrained').toBe('untrained');
  });

  it('…and grants exactly ONE skill, not two', () => {
    /* The shape the duplicate entry broke: a second lane would train a default skill alongside the
     * chosen one, which is invisible unless you count. */
    const plain = build('fighter', 1);
    const withIt = human(1, 'occultism');
    const trained = (c: typeof plain) => Object.entries(c.proficiencies.skills).filter(([, r]) => r !== 'untrained').length;
    expect(trained(withIt) - trained(plain), 'exactly one new trained skill').toBe(1);
  });
});

describe('batch 1 — a heritage can finally change an unarmed attack', () => {
  /*
   * *"The damage die for your fist increases to 1d6 instead of 1d4."* (Warrior Automaton.)
   *
   * Unarmed riders were read from feats and class features only, so a heritage had no route at all —
   * the field could be authored and would apply to nobody. The fist die itself is asserted by §13.7 in
   * `audit-rules-fixes.test.ts`, which predates this and now covers both warrior heritages; what is
   * left to prove HERE is the part that only the data shape can express.
   */
  const fistOf = (ancestryId: string, heritageId: string) => {
    const c = build('fighter', 1, { ancestryId, heritageId } as Partial<BuildState>) as Character;
    return deriveStrikes(c, db).find((s) => /fist/i.test(s.name));
  };

  it('a heritage with no rider leaves the fist alone', () => {
    /* The control: without this, a d6 everywhere would look like success. */
    expect(fistOf('automaton', 'mage-automaton')?.damage, 'a baseline automaton fist').toMatch(/d4/);
    expect(fistOf('automaton', 'warrior-automaton')?.damage, 'the warrior heritage steps the die').toMatch(/d6/);
  });
});
