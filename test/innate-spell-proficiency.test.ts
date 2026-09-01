import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';
import { FEAT_CANTRIP_GRANTS } from '../src/rules/featCantripGrants';

const db = content();

/**
 * Player Core p.298, Innate Spells: *"When you gain an innate spell, you become trained in the spell
 * attack modifier and spell DC statistics. **At 12th level, these proficiencies increase to expert.**"*
 *
 * The second sentence had no route. The innate entry was built with a flat `'trained'`, so every
 * character casting a feat- or ancestry-granted innate spell rolled and set DCs one rank low from 12th
 * level to 20th — a defect on every such character, not on one record.
 *
 * Found by the Wanderer's Guide parity pass: 40 of their records gate spell attack/DC on `LEVEL >= 12`,
 * which is too systematic to be a slip. The rule text above was then read from the AoN mirror
 * (rules-2232, Player Core p.298) — their data is evidence that a lane is missing, never the authority.
 */

const innateOf = (ch: ReturnType<typeof build>) => ch.spellcasting.find((s) => s.id === 'innate-casting');

/** A rogue (no spellcasting of its own) with Pantheon Magic and its cantrip pick answered. */
function withPantheonMagic(level: number, over: Partial<BuildState> = {}) {
  const spec = FEAT_CANTRIP_GRANTS['pantheon-magic'];
  const cantrip = spec.options[0];
  return build('rogue', level, {
    featPicks: { '1:ancestry': 'pantheon-magic' } as BuildState['featPicks'],
    pickCantripChoices: { 'pantheon-magic': cantrip },
    ...over,
  });
}

describe('innate spell proficiency — the 12th-level step', () => {
  it('Pantheon Magic reaches the innate entry at all', () => {
    const spec = FEAT_CANTRIP_GRANTS['pantheon-magic'];
    expect(spec, 'the cantrip pick must exist for this test to mean anything').toBeTruthy();
    expect(spec.tradition).toBe('divine');
    expect(db.spells[spec.options[0]], 'the option must be a shipped spell').toBeTruthy();
    const entry = innateOf(withPantheonMagic(1));
    expect(entry, 'a granted innate cantrip must produce an innate entry').toBeTruthy();
    expect(entry!.cantrips).toContain(spec.options[0]);
  });

  it('is trained below 12th level', () => {
    expect(innateOf(withPantheonMagic(1))?.proficiency).toBe('trained');
    expect(innateOf(withPantheonMagic(11))?.proficiency).toBe('trained');
  });

  it('becomes expert at exactly 12th level, and stays there', () => {
    expect(innateOf(withPantheonMagic(12))?.proficiency).toBe('expert');
    expect(innateOf(withPantheonMagic(20))?.proficiency).toBe('expert');
  });

  /*
   * A FLOOR, never a cap — the legacy CRB wording says so outright: *"If your proficiency in spell
   * attack rolls or spell DCs is expert or better, apply that proficiency to your innate spells, too."*
   * A 20th-level wizard is legendary, and the step must not pull that down to expert.
   */
  it('never lowers a real caster below their own rank', () => {
    const spec = FEAT_CANTRIP_GRANTS['pantheon-magic'];
    const wiz = build('wizard', 20, {
      featPicks: { '1:ancestry': 'pantheon-magic' } as BuildState['featPicks'],
      pickCantripChoices: { 'pantheon-magic': spec.options[0] },
    });
    const cls = wiz.spellcasting.find((s) => s.type === 'prepared');
    expect(cls?.proficiency).toBe('legendary');
    const entry = innateOf(wiz);
    // Either the innate entry carries the class rank, or the class entry absorbed the cantrip — both
    // are correct; what must NOT happen is an innate entry sitting at expert beside a legendary caster.
    if (entry) expect(entry.proficiency).toBe('legendary');
  });
});
