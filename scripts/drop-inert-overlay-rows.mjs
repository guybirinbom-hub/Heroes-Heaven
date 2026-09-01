/**
 * Remove overlay rows that write a field nothing can read.
 *
 * `allowCustom` is not a record field. It lives INSIDE `FeatChoiceDef`, i.e. under a record's `choice`
 * — so a top-level `{field:'allowCustom'}` row sets a property on the record that no reader looks at.
 * Three of them reached the overlay from an earlier pass (terrain-expertise, wilderness-spotter,
 * terrain-stalker). They change nothing and, worse, they read as "this record is handled" to the next
 * person who greps the overlay for it.
 *
 * The correct encoding is inside the choice object, which `terrain-stalker` now has from batch 003.
 *
 * ⚠ This is the failure mode the field catalogue exists to catch — a field with no reader is inert, and
 * `scripts/wg-field-catalogue.mjs` reports `hasReader:false` for exactly this shape. The catalogue
 * covers fields PRESENT ON RECORDS in core.json; these rows never made it onto a record, so they were
 * invisible to it. Hence this check reads the OVERLAY, which is the other place a field name can hide.
 *
 *   node scripts/drop-inert-overlay-rows.mjs            # report only
 *   node scripts/drop-inert-overlay-rows.mjs --write
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

/**
 * Field names that are NOT record-level fields, whatever an overlay row claims. Each is a real
 * property of some nested shape, which is what makes the mistake easy: the name is right, the level
 * is wrong.
 */
const NOT_RECORD_LEVEL = {
  allowCustom: 'a property of FeatChoiceDef — belongs inside the record\'s `choice`, not beside it',
};

/* Everything src/ actually reads, so this cannot become a hand-maintained list that rots. */
const srcText = (() => {
  let all = '';
  for (const dir of ['src/rules', 'src/sheet', 'src/builder', 'src/data']) {
    const d = join(ROOT, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (/\.(ts|tsx)$/.test(f)) all += readFileSync(join(d, f), 'utf8');
  }
  return all;
})();

const rows = readBackfill(ROOT);
const doomed = [];
for (const r of rows) {
  /*
   * ⚠ THIRD EXEMPTION, and the one this script got wrong on its own first --write.
   *
   * A row may carry `path`: the steps from the record down to a NESTED object. `{path:['choice'],
   * field:'allowCustom'}` is the CORRECT encoding of the exact thing NOT_RECORD_LEVEL describes — the
   * field IS nested, and the row says so. Reading `r.field` without `r.path` cannot tell the right
   * encoding from the wrong one, so this deleted the four terrain records' free-text rows (Terrain
   * Expertise, Wilderness Spotter, Terrain Stalker, Terrain Scout) and typing your own terrain stopped
   * surviving `npm run data`. Caught by test/terrain-free-text.test.tsx.
   *
   * Same lesson as the two exemptions below, one level deeper: a predicate that knows ONE storage
   * location reads everything else as absent.
   */
  if (r.path?.length) continue;

  const why = NOT_RECORD_LEVEL[r.field];
  if (why) { doomed.push({ r, why }); continue; }

  /*
   * ⚠ TWO EXEMPTIONS, both found by this script nearly deleting live data on its first run.
   *
   * `__record` is not a field at all — it is the applier's marker for CREATING a whole record, and its
   * `value` is the entire record object. Fourteen trait records are shipped that way. Treating it as a
   * field name and looking it up in src/ would have deleted all fourteen.
   *
   * A row with `value: null` DELETES a field. Whether src/ reads the NAME is irrelevant to whether the
   * deletion is wanted — the row exists precisely to remove something, and the field is gone
   * afterwards either way.
   *
   * Both are the same mistake this codebase keeps making: a predicate that knows one storage location
   * and treats everything else as absent. The catalogue exists because of it; so does this comment.
   */
  if (r.field === '__record') continue;
  if (r.value === null) continue;

  /* A field no src/ file mentions at all cannot be read by anything. Deliberately NOT a
   * `rec.<field>` test: plenty of fields are read by destructuring or by dynamic key, and a stricter
   * test here would delete live data. Absence of the NAME anywhere in src/ is the safe signal. */
  if (!srcText.includes(r.field)) doomed.push({ r, why: 'the name appears nowhere in src/ — nothing can read it' });
}

console.log(`${rows.length} overlay rows; ${doomed.length} write a field nothing reads`);
for (const d of doomed) console.log(`  ${d.r.category}/${d.r.id}  .${d.r.field}   ${d.why}`);

if (!WRITE) { console.log(doomed.length ? '\nreport only — pass --write to remove them.' : '\nnothing inert.'); process.exit(0); }
if (!doomed.length) { console.log('nothing to remove.'); process.exit(0); }

const keep = rows.filter((r) => !doomed.some((d) => d.r === r));
writeBackfill(ROOT, keep);
console.log(`\nremoved ${rows.length - keep.length} row(s); overlay ${rows.length} -> ${keep.length}`);
