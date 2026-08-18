import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { content } from './_content';

const ROOT = join(__dirname, '..');
const c = content();

/**
 * A DELETED FIELD OUTLIVED BY THE SCRIPT THAT WRITES IT.
 *
 * `scripts/apply-self-uses.mjs` owns the "N times per day" lane: it holds a map of record id → limit
 * and writes each one into the overlay. Deleting a value from the overlay therefore only lasts until
 * that script runs again — the map is the source, and nothing connected the two.
 *
 * The witch's Patron Theme is the case that exposed it. Its printed "only once per round" limits the
 * FAMILIAR'S ability, not the class feature, and Patron Theme is not a thing a character uses at all;
 * `orphan-features.mjs` caught it as an unreachable record still carrying a live mechanical field, and
 * the fix authored `limitedUses: null` to delete it. The entry stayed in the map, so the next
 * regeneration would have put it straight back — no error, no diff, just a wrong limit returning.
 *
 * This test is the connection. It fails if a deletion and its owning script ever disagree again.
 */
describe('a deleted limit is not re-authored by the script that owns the lane', () => {
  const src = readFileSync(join(ROOT, 'scripts/apply-self-uses.mjs'), 'utf8');
  type Row = { category: string; id: string; field: string; value: unknown };
  const overlay: Row[] = JSON.parse(readFileSync(join(ROOT, 'scripts/data/effect-backfill.json'), 'utf8'));

  it('patron-theme carries no limitedUses, in the data or in the writer', () => {
    expect((c.classFeatures['patron-theme'] as { limitedUses?: unknown })?.limitedUses).toBeUndefined();
    expect(src.includes("'patron-theme'"), 'apply-self-uses.mjs would re-author it at the next run').toBe(false);
  });

  it('no record deletes limitedUses while still being named by the writer', () => {
    /* The general form. A `value: null` row DELETES the field; if the owning script still lists that
     * id, the two are fighting and whichever ran last wins. */
    const deleted = overlay
      .filter((r) => r.field === 'limitedUses' && r.value === null)
      .map((r) => r.id);
    const contested = deleted.filter((id) => src.includes(`'${id}'`));
    expect(contested, 'these ids are deleted in the overlay AND written by apply-self-uses.mjs').toEqual([]);
  });
});
