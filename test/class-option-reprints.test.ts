import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { deriveClassOptionReprints, MIRROR_CATEGORIES } from '../scripts/lib/class-option-reprints.mjs';
import { CLASS_OPTION_REPRINTS, classOptionRecords, sourceCatalog } from '../src/rules/sources';

/*
 * desk #170 (sources-apply-to-everything), the refuter's pass, 2026-09-30. A class sub-pick is filtered by its
 * classFeatures record's book, and eleven eidolon records still name Secrets of Magic / Book of the Dead although
 * Impossible Magic prints them again; a summoner with Impossible Magic on was offered 2 of 15. The Archives link
 * none of these pairs, so scripts/reprint-check.mjs cannot see them. CLASS_OPTION_REPRINTS (src/rules/sources.ts)
 * names each later printing, and this file is its guard:
 *   - with the AoN mirror present, the table equals what scripts/lib/class-option-reprints.mjs derives from it, so
 *     a new reprint in the mirror, or a hand-added row the mirror does not back, fails here;
 *   - always, every row names a class option with a record, a Sources card key, and a book other than the record's.
 */
const MIRROR = existsSync(MIRROR_CATEGORIES);

describe('CLASS_OPTION_REPRINTS', () => {
  it('every row is a class option, and every book a Sources card key other than its record\'s own', () => {
    const c = content();
    const recs = classOptionRecords(c);
    const keys = new Set(sourceCatalog(c).allBooks);
    for (const [id, list] of Object.entries(CLASS_OPTION_REPRINTS)) {
      const r = recs.get(id);
      expect(r, `${id} is a class option with a classFeatures record`).toBeTruthy();
      expect(list.length).toBeGreaterThan(0);
      for (const p of list) {
        expect(keys.has(p.book), `${id}: ${p.book} is a Sources card key`).toBe(true);
        expect(p.book).not.toBe(r!.source?.book?.trim());
        expect(p.aonId).toMatch(/^[a-z-]+-\d+$/);
      }
      expect(r!.reprintBooks).toEqual(list.map((p) => p.book));
    }
  });

  it.skipIf(!MIRROR)('equals the later printings the AoN mirror holds (same category, same name, a later book)', () => {
    const c = content();
    const { table, unresolved, noOwnPage } = deriveClassOptionReprints(c, sourceCatalog(c).allBooks);
    expect(unresolved).toEqual([]);
    const sort = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    expect(sort(CLASS_OPTION_REPRINTS)).toEqual(sort(table));
    // measured 2026-09-30: six options have no page of their own in their list's category (four archetype-page
    // options, two "Bloodline: X" records) and none of them has a later printing anywhere in the mirror; a
    // seventh fails here so it is looked at, not silently skipped
    expect([...noOwnPage].sort()).toEqual(['bloodline-fey', 'bloodline-hag', 'palatine-detective', 'restless-as-the-tide', 'runelord', 'vindicator']);
  });

  it.skipIf(!MIRROR)('mutation: a hand-added row the mirror does not back is caught, and so is a dropped one', () => {
    const c = content();
    const { table } = deriveClassOptionReprints(c, sourceCatalog(c).allBooks);
    const sort = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    const added = { ...CLASS_OPTION_REPRINTS, 'swarm-eidolon': [{ book: 'Pathfinder Impossible Magic', aonId: 'eidolon-13' }] };
    expect(sort(added)).not.toEqual(sort(table));
    const { ['angel-eidolon']: _gone, ...dropped } = CLASS_OPTION_REPRINTS;
    void _gone;
    expect(sort(dropped)).not.toEqual(sort(table));
  });
});
