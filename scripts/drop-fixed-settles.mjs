/*
 * REMOVE SETTLE BUCKETS THAT ARE NOW STALE, because the divergence they silenced has been FIXED.
 *
 * A settle outlives the reason it was written: it silences that difference in every future batch, so
 * a REGRESSION on a fixed record would never be reported again. Removing the stale part is therefore
 * part of the fix, not tidying.
 *
 * ⚠⚠ REMOVALS ARE BUCKET-SCOPED, NEVER WHOLE-KEY. The first version of this script keyed FIXED by
 * bare record id and deleted the entire settle line across all three registries — and settle values
 * are ARRAYS of buckets, where one id routinely settles several unrelated buckets for several
 * unrelated reasons. Removing 'animistic-practice' on a FOCUS-pool reason also destroyed its four
 * VALUE settles (save×3 + ac), which then re-opened batch 6 as a phantom regression; gates-threshold
 * and ascended-dragonet-heritage lost registry entries the same way (all three were re-read, restored
 * and re-verified in the 2026-08-26 regressed-batches pass). A reason names ONE divergence; it may
 * only remove the bucket(s) that divergence silenced.
 *
 *   node scripts/drop-fixed-settles.mjs           # report
 *   node scripts/drop-fixed-settles.mjs --write
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

/*
 * id → { file, buckets, why }. `buckets` are the ONLY array members removed; the key goes when the
 * array empties. `file` scopes the removal to the one registry the reason concerns.
 *
 * The 2026-08-19 batch (elemental-wrath, spirit-warrior-dedication, ghostly-resistance,
 * firework-technician-dedication, animistic-practice, gates-threshold, ascended-dragonet-heritage,
 * the-moon-weavers-art) has ALREADY RUN — under the old whole-key semantics — and its collateral was
 * repaired by hand afterwards. Do not re-add those ids without a NEW stale reason.
 */
const FIXED = {};

const FILES = ['scripts/wg-diff.mjs', 'scripts/wg-values.mjs', 'scripts/wg-identity.mjs'];

let removed = 0;
for (const file of FILES) {
  const path = join(ROOT, file);
  const src = readFileSync(path, 'utf8');
  const lines = src.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const m = /^(\s*)'([a-z0-9-]+)':\s*\[([^\]]*)\](,?)\s*$/.exec(line);
    const spec = m && FIXED[m[2]];
    if (spec && (!spec.file || spec.file === file)) {
      const keep = m[3]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((b) => !spec.buckets.includes(b.replace(/^'|'$/g, '')));
      console.log(`  ${file} → ${m[2]}: removing [${spec.buckets.join(', ')}], keeping [${keep.map((k) => k.replace(/'/g, '')).join(', ') || '—'}]`);
      console.log(`      ${spec.why}`);
      if (keep.length) {
        out.push(`${m[1]}/* bucket(s) ${spec.buckets.join('/')} REMOVED: ${spec.why}. Re-report if it returns. */`);
        out.push(`${m[1]}'${m[2]}': [${keep.join(', ')}]${m[4]}`);
      } else {
        /* A marker, not a silent deletion: the next reader needs to know the entry was here and why
         * it went, or a returning difference looks like a brand-new one. */
        out.push(`${m[1]}/* ${m[2]} — settle REMOVED: divergence fixed (${spec.why}). Re-report if it returns. */`);
      }
      removed++;
      continue;
    }
    out.push(line);
  }
  if (WRITE) writeFileSync(path, out.join('\n'));
}

console.log(`\n${removed} stale settle bucket-set(s)${WRITE ? ' removed' : ' would be removed'}.`);
if (!WRITE) console.log('(report only — pass --write)');
