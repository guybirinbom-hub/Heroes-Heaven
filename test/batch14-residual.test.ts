import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveSkill } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';

/*
 * BATCH 14 RESIDUAL — the half the parity gates cannot see.
 *
 * The six comparison gates prove only that we agree with Wanderer's Guide's ENCODING of a record. A
 * defect both sides share survives all of them, and the only instrument that finds it is reading each
 * record against its printed text. These three each stated a grant in plain words and delivered
 * nothing; the tests assert the DELIVERY, because the overlay row is what the gates would have
 * accepted and it is exactly the thing that can be authored and inert.
 */
const db = content();

describe('batch 14 residual', () => {
  it('Jalmeri Heavenseeker: the dedication actually hands over Qi Spells', () => {
    /* *"You gain the Qi Spells monk feat, which grants you a qi spell and a focus pool of 1 Focus
     * Point."* The pool point shipped and the feat did not, so the qi spell Qi Spells asks the player
     * to choose was never offered — a focus pool with nothing to spend itself on. */
    const ch = build('fighter', 4, { featPicks: { '4:class': 'jalmeri-heavenseeker-dedication' } } as Partial<BuildState>);
    expect(ch.feats.some((f) => f.featId === 'qi-spells')).toBe(true);
    /*
     * The pool follows the SPELL, which is the house rule for every choice-gated focus feat: *"with
     * the choice unresolved there is no spell, so no pool either."* Answering the granted feat's
     * question must therefore produce exactly one point — not two.
     *
     * Two was what it produced at first. The guard that suppresses a granter's `focusPoolBonus` when
     * its choice hands over the spell read only the granter's OWN effectChoices, and here the question
     * lives on the granted feat while the pool point is written on the granter.
     */
    expect(ch.focus?.max ?? 0, 'no qi spell chosen yet, so no pool yet').toBe(0);
    const answered = build('fighter', 4, {
      featPicks: { '4:class': 'jalmeri-heavenseeker-dedication' },
      effectChoices: { 'qi-spells:qi-spell': 'inner-upheaval' },
    } as Partial<BuildState>);
    expect(answered.focus?.max, '"a qi spell AND a focus pool of 1" is one point, not two').toBe(1);
  });

  it('Clever Improviser: the granted feat brings its own mechanic with it', () => {
    /*
     * *"You gain the Untrained Improvisation general feat."* That feat is where `untrainedProficiency`
     * lives — the +level-2 on untrained skills — so without the grant, Clever Improviser was a feat
     * whose entire body was a reference to another record we never applied.
     */
    const plain = build('fighter', 5);
    const ch = build('fighter', 5, { featPicks: { '5:ancestry': 'clever-improviser' } } as Partial<BuildState>);
    expect(ch.feats.some((f) => f.featId === 'untrained-improvisation')).toBe(true);

    /* Pick a skill the plain fighter is untrained in, then compare the same skill on both. */
    const key = (['occultism', 'arcana', 'crafting'] as const).find((k) => (plain.proficiencies.skills[k] ?? 'untrained') === 'untrained');
    expect(key, 'a level-5 fighter has untrained skills to improve').toBeTruthy();
    expect(ch.proficiencies.skills[key!] ?? 'untrained', 'still untrained — this is a bonus, not a rank').toBe('untrained');
    expect(
      deriveSkill(ch, key!, db).modifier,
      'Untrained Improvisation adds level - 2 to untrained skills',
    ).toBeGreaterThan(deriveSkill(plain, key!, db).modifier);
  });

  it('Empathic Calm: either printed spell is castable, heightened to half level', () => {
    /* *"Once per day, you can cast either Calm or Sanctuary as an innate occult spell, heightened to
     * half your level rounded up."* The record carried no innate spell at all. */
    for (const pick of ['calm', 'sanctuary']) {
      const ch = build('fighter', 10, {
        featPicks: { '5:ancestry': 'empathic-calm' },
        effectChoices: { 'empathic-calm:empathic-calm-spell': pick },
      } as Partial<BuildState>);
      expect(ch.feats.some((f) => f.featId === 'empathic-calm'), 'the feat must actually be taken').toBe(true);
      const entry = ch.spellcasting?.find((e) => e.type === 'innate');
      /* The innate entry files each spell under the rank it is cast at, so the rank IS the key. */
      const at = Object.entries(entry?.repertoire ?? {}).find(([, ids]) => ids.includes(pick));
      expect(at, `${pick} should be castable`).toBeTruthy();
      expect(Number(at![0]), 'heightened to half your level rounded up (level 10 → 5th)').toBe(5);
      expect(entry!.tradition, 'an innate OCCULT spell').toBe('occult');
    }
  });
});
