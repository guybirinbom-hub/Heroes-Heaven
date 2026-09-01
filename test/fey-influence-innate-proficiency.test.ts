import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';
import { FEAT_CANTRIP_GRANTS } from '../src/rules/featCantripGrants';
import { deriveSpellcasting } from '../src/rules/derive';

const db = content();

/**
 * Fey Influence (AoN mirror feat-1239): *"You become trained in primal DCs and spell attack rolls.
 * You gain the fey trait and one of the following features which grant an innate primal spell that
 * can be used once per day."*
 *
 * The Wanderer's Guide parity pass reports this record as missing both `spellcasting` and
 * `conditional`, because their side writes the training onto the RECORD (`adjValue SPELL_ATTACK = T`,
 * `adjValue SPELL_DC = T`, plus `IF LEVEL >= 12 THEN E`) while ours is the same rule written ONCE in
 * the engine — `build.ts`'s `innate-casting` entry takes `maxRank(class, profile, level >= 12 ? expert
 * : trained)`. That is a comparer blind spot, not a gap; this file is the guard that keeps it one.
 *
 * The generic engine rule already has `innate-spell-proficiency.test.ts`. What is checked HERE is the
 * part specific to this record, which that file cannot see because Pantheon Magic grants a CANTRIP at
 * the spell's own tradition:
 *   · the pick lane reaches the innate entry at all for a LEVELED (rank 1, 1/day) grant, and
 *   · the feat's tradition OVERRIDE holds — "primal" wins over the spell's own list, so a Fey
 *     Influence gremlin's Bane (divine/occult in print) is rolled as the PRIMAL statistic the feat's
 *     first sentence names. Without the override the entry's tradition vote decides the wrong one.
 */
const innateOf = (ch: ReturnType<typeof build>) => ch.spellcasting.find((s) => s.id === 'innate-casting');

/** A rogue — no spellcasting of its own, so the innate entry's rank is the feat's alone. */
function feyRogue(level: number, pick: string) {
  return build('rogue', level, {
    featPicks: { '5:ancestry': 'fey-influence' } as BuildState['featPicks'],
    pickCantripChoices: { 'fey-influence': pick },
  });
}

describe('Fey Influence — trained in primal DCs and spell attack rolls', () => {
  it('every printed feature option is a shipped spell the pick can resolve', () => {
    const spec = FEAT_CANTRIP_GRANTS['fey-influence'];
    expect(spec, 'the pick lane must exist or nothing below means anything').toBeTruthy();
    expect(spec.tradition).toBe('primal');
    // Anteater, Cat Sith, Cursed Bluebird, Dryad, Faun, Gremlin, Monarch, Unicorn.
    expect(spec.options).toHaveLength(8);
    for (const id of spec.options) expect(db.spells[id], `${id} must ship`).toBeTruthy();
  });

  it('an answered pick produces a PRIMAL innate entry, overriding the spell own tradition', () => {
    // Bane prints as divine/occult; this feat grants it as primal, and the entry must say so.
    expect(db.spells['bane'].traditions).not.toContain('primal');
    const entry = innateOf(feyRogue(5, 'bane'));
    expect(entry, 'the granted 1/day spell must reach the innate entry').toBeTruthy();
    expect(entry!.tradition).toBe('primal');
    expect(entry!.repertoire?.[1]).toContain('bane');
  });

  it('is trained below 12th level and expert from 12th — the same statistic the sheet rolls', () => {
    for (const pick of ['bane', 'heal', 'summon-plant-or-fungus']) {
      expect(innateOf(feyRogue(5, pick))?.proficiency).toBe('trained');
      expect(innateOf(feyRogue(11, pick))?.proficiency).toBe('trained');
      expect(innateOf(feyRogue(12, pick))?.proficiency).toBe('expert');
      expect(innateOf(feyRogue(20, pick))?.proficiency).toBe('expert');
    }
    // …and the rank is not decoration: it reaches the printed numbers through the sheet's reader.
    const l11 = feyRogue(11, 'bane');
    const l12 = feyRogue(12, 'bane');
    const a11 = deriveSpellcasting(l11, innateOf(l11)!);
    const a12 = deriveSpellcasting(l12, innateOf(l12)!);
    expect(a11.rank).toBe('trained');
    expect(a12.rank).toBe('expert');
    // One level up is +1 from level and +2 from the rank step: attack and DC both move by 3.
    expect(a12.attack - a11.attack).toBe(3);
    expect(a12.dc - a11.dc).toBe(3);
  });
});
