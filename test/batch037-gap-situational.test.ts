// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { explainStat } from '../src/rules/explain';
import { skillSubstitutions } from '../src/rules/derive';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 037, GAP lane of the SITUATIONAL family.
 *
 * One gap line: feats/reverse-engineer stores its `skillSubstitutions` condition as the importer's
 * stripped-skill-link wreckage, "to disable-device skill=crafting or pick-a-lock skill=crafting",
 * and explain.ts:648 prints that string VERBATIM onto the player's Thievery rows. Print (feat-3053)
 * says "Furthermore, you can use Crafting instead of Thievery to Disable a Device or Pick a Lock."
 *
 * The repair is a data row (work/.b037-rows-gap-situational.json), which the driver applies AFTER
 * this test is written, so nothing here may assert against the SHIPPED string: the reverse-engineer
 * assertions run on an in-memory copy PATCHED to the row's value, and the stripped copy proves the
 * note's carrier. The one assertion on shipped data is the sibling feats/expert-disassembly, whose
 * `when` is already the exact wording the row emits for the exact same printed clause.
 */
const db = content();

/** A copy of the database with ONE field of ONE record replaced. Never mutates the cached db. */
const withSub = (value: unknown): ContentDatabase => ({
  ...db,
  feats: { ...db.feats, 'reverse-engineer': { ...db.feats['reverse-engineer'], skillSubstitutions: value } },
} as ContentDatabase);

/** An inventor who has taken the feat — the only way the clause reaches a sheet. */
const withFeat = (featId: string): Character =>
  ({ ...build('inventor', 4), feats: [{ featId, level: 2, category: 'class' as const }] }) as Character;

const inventor = withFeat('reverse-engineer');

/** The note text one record contributes to a skill, as StatDetailModal lists it. */
const note = (c: Character, database: ContentDatabase, skill: string, sourceId: string) =>
  (explainStat(c, database, { kind: 'skill', skill }).situational ?? []).find((n) => n.sourceId === sourceId)?.text;

describe('reverse-engineer states its Crafting-for-Thievery substitution in the printed words', () => {
  // batch 037 premise: feat-3053 "Furthermore, you can use Crafting instead of Thievery to Disable a Device or Pick a Lock."
  it('reverse-engineer: the Thievery note reads the printed condition, with no importer query-string left in it', () => {
    const patched = withSub([{ use: 'crafting', forSkill: 'thievery', when: 'to Disable a Device or Pick a Lock' }]);
    // `.text` is the whole assembled row ("<bonus> from <source> — <when> — roll <use> instead"), so
    // the condition is pinned as its tail rather than as the entire string.
    expect(note(inventor, patched, 'thievery', 'reverse-engineer')).toContain('to Disable a Device or Pick a Lock — roll crafting instead');
    // The artefact class, named so a future importer regression is caught by meaning and not by string:
    // a slug plus a `skill=` query fragment is never printed text.
    expect(note(inventor, patched, 'thievery', 'reverse-engineer')).not.toMatch(/skill=|disable-device|pick-a-lock/);
  });

  // batch 037 premise: feat-3053 "Furthermore, you can use Crafting instead of Thievery to Disable a Device or Pick a Lock."
  it('reverse-engineer: the note comes from this field — strip it and the Thievery rows lose the clause entirely', () => {
    const stripped = withSub(undefined);
    expect(skillSubstitutions(inventor, stripped).some((s) => s.sourceId === 'reverse-engineer')).toBe(false);
    expect(note(inventor, stripped, 'thievery', 'reverse-engineer')).toBeUndefined();
  });

  // batch 037 premise: feat-3053 "Furthermore, you can use Crafting instead of Thievery to Disable a Device or Pick a Lock."
  it('reverse-engineer: the wording the row emits is the shipped sibling wording, not an invention', () => {
    // feats/expert-disassembly prints the same clause and already carries the repaired `when`, so the
    // row copies house shape rather than coining one. This half runs on SHIPPED data and cannot flip.
    const sub = skillSubstitutions(withFeat('expert-disassembly'), db).find((s) => s.sourceId === 'expert-disassembly');
    expect(sub, 'the sibling that already states the clause correctly').toBeTruthy();
    expect(sub!.when).toBe('to Disable a Device or Pick a Lock');
    expect(sub!.use).toBe('crafting');
    expect(sub!.forSkill).toBe('thievery');
  });
});
