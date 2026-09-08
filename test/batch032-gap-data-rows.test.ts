import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { content } from './_content';

/**
 * Batch-032, WG-comparison lane — the GAP agent for the DATA-ROWS family.
 *
 * The read's basic-beast-gunner-spellcasting#dropped-clause finding proved that the importer's
 * de-linkifier deletes a link TOGETHER WITH ITS LABEL, leaving a rule that ends at a bare article:
 * *"You gain the ."* where AoN feat-3230 prints *"You gain the basic spellcasting benefits."* The
 * builder repaired that one record; its CROSS-FILE GAPS line handed the systemic half on.
 *
 * The systemic half turned out to be a hole in the GUARD, not a new lane: scripts/dropped-inline-check.mjs
 * has ratcheted this exact defect since batch 27, but only in its "a ." shape, so the 12 records the
 * strip left behind "an .", "the ." and "your ." were invisible to a check that already existed to find
 * them. The ratchet now carries all four articles at the SAME baseline (162), and the 12 newly-visible
 * records are repaired in the same batch — one row in work/.b032-rows-data-rows.json, the other eleven
 * in work/.b032-rows-gap-data-rows.json.
 *
 * Nothing here compares a patched copy against the shipped one: each assertion fails today for exactly
 * one reason (the label is missing) and passes once the driver applies the rows.
 */
const db = () => content();
const rec = (bucket: string, id: string) =>
  (db() as unknown as Record<string, Record<string, Record<string, unknown>>>)[bucket]?.[id];

/** The shape the widened ratchet looks for: a sentence that ends at an article with nothing after it. */
const BARE_ARTICLE = /\b(?:a|an|the|your) \.(?=\s|$)/;

/*
 * bucket, id, the AoN document, and the clause that document prints where our sentence stopped dead.
 * Every clause below is a verbatim run from its own mirror document — the applier's fifth pre-check
 * refuses a description row whose restored tokens are in neither our text nor the cited document.
 *
 * // batch 032 premise: equipment-4016 "match those of your draconic benefactor"
 * // batch 032 premise: feat-3112 "Choose an innovation."
 * // batch 032 premise: feat-6382 "You gain the advanced alchemy benefits."
 * // batch 032 premise: feat-3232 "You gain the expert spellcasting benefits."
 * // batch 032 premise: feat-3234 "You gain the master spellcasting benefits."
 * // batch 032 premise: feat-7589 "You gain the basic spellcasting benefits."
 * // batch 032 premise: feat-7591 "You gain the expert spellcasting benefits."
 * // batch 032 premise: feat-7593 "You gain the master spellcasting benefits."
 * // batch 032 premise: feat-7681 "You gain the basic spellcasting benefits."
 * // batch 032 premise: feat-7686 "You gain the expert spellcasting benefits."
 * // batch 032 premise: feat-7688 "You gain the master spellcasting benefits."
 */
const RESTORED: readonly (readonly [string, string, string, string])[] = [
  ['items', 'pact-of-the-herald-and-host', 'equipment-4016', 'match those of your draconic benefactor'],
  ['feats', 'inventor-dedication', 'feat-3112', 'Choose an innovation.'],
  ['feats', 'poisoner-dedication', 'feat-6382', 'You gain the advanced alchemy benefits.'],
  ['feats', 'expert-beast-gunner-spellcasting', 'feat-3232', 'You gain the expert spellcasting benefits.'],
  ['feats', 'master-beast-gunner-spellcasting', 'feat-3234', 'You gain the master spellcasting benefits.'],
  ['feats', 'basic-rivethun-spellcasting', 'feat-7589', 'You gain the basic spellcasting benefits.'],
  ['feats', 'expert-rivethun-spellcasting', 'feat-7591', 'You gain the expert spellcasting benefits.'],
  ['feats', 'master-rivethun-spellcasting', 'feat-7593', 'You gain the master spellcasting benefits.'],
  ['feats', 'basic-prophet-spellcasting', 'feat-7681', 'You gain the basic spellcasting benefits.'],
  ['feats', 'expert-prophet-spellcasting', 'feat-7686', 'You gain the expert spellcasting benefits.'],
  ['feats', 'master-prophet-spellcasting', 'feat-7688', 'You gain the master spellcasting benefits.'],
];

describe('the stripped link LABEL is restored on every record it was taken from', () => {
  it.each(RESTORED)('%s/%s prints what %s says', (bucket, id, _aon, clause) => {
    const d = rec(bucket, id)?.description as string | undefined;
    // the harness half: the record and its prose reach the merged content at all, so the two
    // assertions below can only fail on the missing label
    expect(typeof d).toBe('string');
    expect(d).toContain(clause);
    expect(d).not.toMatch(BARE_ARTICLE);
  });
});

describe('basic-beast-gunner-spellcasting: the stripped-link ratchet sees all four articles', () => {
  // batch 032: basic-beast-gunner-spellcasting#dropped-clause
  it('counts "an .", "the ." and "your ." holes, not only "a ."', () => {
    // "You gain the [basic spellcasting benefits](/Rules.aspx?ID=170)." (AoN feat-3230) — a hole the
    // guard that exists to find this defect walked straight past, because its pattern was /\ba \./.
    const src = readFileSync('scripts/dropped-inline-check.mjs', 'utf8');
    const m = /const HOLE = (\/.+\/);/.exec(src);
    expect(m).not.toBeNull(); // the harness half: the constant is still named HOLE
    const hole = new RegExp(m![1].slice(1, m![1].lastIndexOf('/')));
    expect(hole.test('you must attempt a .')).toBe(true); // the shape batch 27 ratcheted, still caught
    expect(hole.test('You gain the .')).toBe(true);
    expect(hole.test('Choose an .')).toBe(true);
    expect(hole.test('match those of your .')).toBe(true);
    // and it stays a defect detector, not a grep for articles
    expect(hole.test('You gain the basic spellcasting benefits.')).toBe(false);
  });
});
