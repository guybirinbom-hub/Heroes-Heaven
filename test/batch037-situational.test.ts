// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { characterSituationalIds, explainStat } from '../src/rules/explain';
import { featSituationalFor } from '../src/rules/situationalBonuses';
import { skillSubstitutions } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 037, SITUATIONAL lane.
 *
 * One finding, and it is a DELETION, so the discipline is the mirror of the usual one: the proof that
 * a star is gone has to come from the reader the SHEET uses (`explainStat(...).situational`, the rows
 * StatDetailModal lists), never from the registry literal — a `FEAT_SITUATIONAL` key can disappear
 * while an `extra`/substitution lane still puts the same sentence in front of the player.
 *
 * No data row: the record already carries `skillSubstitutions` and the 2025 description, so the whole
 * fix is the code deletion in src/rules/situationalBonuses.ts.
 */
const db = content();

/** An inventor who has taken the feat, the only way either clause reaches a sheet. */
const inventor = {
  ...build('inventor', 4),
  feats: [{ featId: 'reverse-engineer', level: 2, category: 'class' as const }],
} as Character;

/** `when :: bonus` for the rows ONE record contributes to a stat, as StatDetailModal reads them. */
const stars = (c: Character, ref: { kind: string; skill?: string; save?: string }, sourceId: string) =>
  featSituationalFor(characterSituationalIds(c, db), ref)
    .filter((s) => s.id === sourceId)
    .map((s) => `${s.when} :: ${s.bonus}`);

describe('reverse-engineer grants the 2025 substitution and no Crafting bonus', () => {
  /* Print (AoN feat-3053, Guns & Gears Remastered 2025) is the whole feat: "You are incredibly skilled
   * at reverse engineering items… Furthermore, you can use Crafting instead of Thievery to Disable a
   * Device or Pick a Lock." No bonus of any kind appears in it — the +2 circumstance to Crafting lives
   * only in feat-8555, the superseded 2021 printing, which is also what WG still encodes. Owner ruling
   * #15, "drop the +2 Crafting star" (scripts/data/trust-approvals.json). The description the player
   * already reads on the sheet is the new text, so the star was advertising a number that appeared
   * nowhere in the feat he had open. */

  // batch 037: reverse-engineer#crafting-star
  it('reverse-engineer: no +2 reaches the Crafting rows, and no Crafting star is listed at all', () => {
    expect(stars(inventor, { kind: 'skill', skill: 'crafting' }, 'reverse-engineer')).toEqual([]);
    const crafting = explainStat(inventor, db, { kind: 'skill', skill: 'crafting' });
    expect((crafting.situational ?? []).filter((n) => n.sourceId === 'reverse-engineer')).toEqual([]);
    // …and nothing crept into the total as a flat bonus on the way out.
    expect(crafting.parts.some((p) => p.label === 'Reverse Engineer')).toBe(false);

    // The empty list above only means something if this reader WOULD have shown a Crafting star on
    // this record: feed it one through `extra` and it appears, so the deletion is what silenced it.
    const ifItStillExisted = featSituationalFor(characterSituationalIds(inventor, db), { kind: 'skill', skill: 'crafting' }, {
      'reverse-engineer': [{ targets: [{ kind: 'skill', detail: 'crafting' } as const], when: 'to reverse engineer or disassemble an item', bonus: '+2 circumstance' }],
    });
    expect(ifItStillExisted.filter((s) => s.id === 'reverse-engineer').length).toBe(1);
  });

  // batch 037: reverse-engineer#crafting-star
  it('reverse-engineer: the printed Crafting-for-Thievery substitution survives the deletion', () => {
    const sub = skillSubstitutions(inventor, db).find((s) => s.sourceId === 'reverse-engineer');
    expect(sub, 'the one clause the 2025 entry does grant').toBeTruthy();
    expect(sub!.use).toBe('crafting');
    expect(sub!.forSkill).toBe('thievery');
    expect(sub!.when, 'conditional — it does not replace Thievery generally').toBeTruthy();

    // It is CONDITIONAL, so explain.ts states it as a note on the Thievery rows rather than moving the
    // number. Asserted by shape, not by the stored wording, which is a separate importer-artefact fix.
    const note = (explainStat(inventor, db, { kind: 'skill', skill: 'thievery' }).situational ?? []).find(
      (n) => n.sourceId === 'reverse-engineer',
    );
    expect(note, 'the substitution must still be on the sheet somewhere').toBeTruthy();
    expect(note!.text).toContain('roll crafting instead');
  });

  // batch 037: reverse-engineer#crafting-star
  it('reverse-engineer: an inventor who never took the feat reads neither clause', () => {
    const plain = build('inventor', 4);
    expect(stars(plain, { kind: 'skill', skill: 'crafting' }, 'reverse-engineer')).toEqual([]);
    expect(skillSubstitutions(plain, db).some((s) => s.sourceId === 'reverse-engineer')).toBe(false);
  });
});
