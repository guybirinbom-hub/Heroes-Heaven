/**
 * BATCH 037 — THE CLOSER'S ONE INSTRUMENT TEACH: the innate spell-attack / spell-DC pair at EXPERT.
 *
 * The EXPERIENCE gate ended batch 037 with exactly one red record, feats/nagaji-spell-expertise:
 *
 *   UNVERIFIED-EFFECT — differential moved 0 values and none of WG's 2 op(s) has a surface predicate
 *   yet: adjValue SPELL_DC; adjValue SPELL_ATTACK
 *
 * Both ops are their encoding of one printed sentence — feat-3996, *"You become an expert in occult
 * spell DCs and occult spell attack rolls."* Ours delivers it, but never per record: the innate entry
 * src/rules/build.ts builds takes `maxRank(…, level >= 12 ? 'expert' : 'trained')` straight off
 * rules-2232 (Player Core p.298), so a 13th-level ancestry feat's host — here a level-20 nagaji
 * fighter — is expert on that pair by construction and no carrier exists for a predicate to read.
 *
 * The existing arm of the predicate stopped at `want <= trained`, which is the FIRST half of the same
 * printed rule; the second half had no route and every `= E` pair fell through to 'unchecked'.
 *
 * A predicate is only legitimate while it still reports on a STUNTED copy — otherwise it has stopped
 * comparing and started asserting. That is what the first test below does, on both of the two things
 * the new arm reads: the record's own grant, and the host's level.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { effectDelivery, judgeDelivery } from '../scripts/lib/wg-experience-lanes.mjs';

const CLI_ROOT = join(__dirname, '..');

/** One of their two ops, in the shape scripts/wg-experience.mjs hands the lane lib. */
const eff = (variable: string, value: string) =>
  ({ type: 'adjValue', variable, valueBearing: true, gate: 'open', inOption: false, data: { variable, value: { value } } });

/* What the harness writes for this record's host: no casting entry at all, because the innate entry
 * only exists once the daily pick is answered and every host is built with its controls empty. */
const bare = {
  stars: {}, proficiencies: {}, spellcasting: [] as { proficiency: string }[],
  featNames: [], featureNames: [], spellNames: [], languages: [], traits: [],
};

describe('batch 037 closer — nagaji-spell-expertise: the innate SPELL_DC / SPELL_ATTACK pair at expert', () => {
  // batch 037 premise: rules-2232 "At 12th level, these proficiencies increase to expert."
  it('nagaji-spell-expertise: E is delivered only when the record grants an innate spell AND the host is 12th level or higher', () => {
    /*
     * mutation-proof — stunts the surface predicate for `adjValue SPELL_DC/SPELL_ATTACK = E` on two
     * axes, one at a time. Drop `grantsInnateSpell` (what every record that hands over no spell
     * produces) and the pair goes back to 'unchecked'; drop the host below 12 (a low-level record
     * asserting expert) and it goes back to 'unchecked' as well. So the arm is reading the grant and
     * the level rather than waving every `= E` through, and it is not redundant beside the trained arm
     * above it, which still answers 'unchecked' for an expert claim on its own.
     */
    const granted = { ...bare, grantsInnateSpell: true };
    for (const variable of ['SPELL_DC', 'SPELL_ATTACK']) {
      expect(effectDelivery(eff(variable, 'E'), { ...granted, hostLevel: 20 }, {})).toBe('delivered');
      // …the two stunted copies.
      expect(effectDelivery(eff(variable, 'E'), { ...bare, grantsInnateSpell: false, hostLevel: 20 }, {})).toBe('unchecked');
      expect(effectDelivery(eff(variable, 'E'), { ...granted, hostLevel: 11 }, {})).toBe('unchecked');
      // An artefact written before hostLevel existed is an absence of measurement, never a pass.
      expect(effectDelivery(eff(variable, 'E'), granted, {})).toBe('unchecked');
      // The trained half of the same rule is unchanged and needs no level.
      expect(effectDelivery(eff(variable, 'T'), granted, {})).toBe('delivered');
    }
    // …and the same through judgeDelivery, which is what scripts/wg-experience.mjs actually calls.
    const ops = [eff('SPELL_DC', 'E'), eff('SPELL_ATTACK', 'E')];
    expect(judgeDelivery(ops, { ...granted, hostLevel: 20 }, {}).delivered).toHaveLength(2);
    expect(judgeDelivery(ops, { ...granted, hostLevel: 11 }, {}).unchecked).toHaveLength(2);
  });

  // batch 037 premise: rules-2232 "At 12th level, these proficiencies increase to expert."
  it('nagaji-spell-expertise: the grant the predicate stands on is the one core.json ships', () => {
    /* The predicate is only honest while this record really hands over an innate spell — that is what
     * makes the trained/expert pair arrive at all. If a regeneration ever drops the overlay row, this
     * fails here rather than turning the EXPERIENCE gate silently green. */
    const core = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8')) as Record<
      string,
      Record<string, { choice?: { options?: { grant?: { innateSpells?: { rank?: number }[] } }[] } }>
    >;
    const options = core.feats['nagaji-spell-expertise'].choice?.options ?? [];
    expect(options).toHaveLength(3);
    for (const o of options) expect(o.grant?.innateSpells?.[0]?.rank).toBe(5);
  }, 60_000);
});
