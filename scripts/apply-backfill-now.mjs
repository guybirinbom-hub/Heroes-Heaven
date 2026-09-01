/*
 * Apply `scripts/data/effect-backfill.json` to the SHIPPED public/core.json, in place.
 *
 * The overlay is normally applied by `npm run data`, which rebuilds core.json from the AoN export
 * through eleven stages. That is the right thing to run before shipping — and much too slow to sit
 * inside a "author a row, re-gate, read the result" loop, which is how every parity batch is worked.
 * So this does the one stage the loop actually needs.
 *
 * It is safe precisely because of what a backfill row is: an ABSOLUTE assignment, applied by the same
 * shared `applyBackfill` the pipeline uses. Applying it twice is applying it once, and the next full
 * `npm run data` reproduces exactly this state from the same file.
 *
 * ⚠ It is NOT a substitute for `npm run data`. It cannot add records, re-stamp aonIds, or rebuild
 * prose — it only replays the overlay. Run the real chain before believing a batch is finished.
 *
 * ⚠ PROSE ROWS DO NOT GO INTO core.json, and this is the whole reason the script needs a comment. In
 * the pipeline the overlay is applied BEFORE `split-descriptions.mjs`, which then moves prose out of
 * core.json and into core-descriptions.json. Replaying every row against the finished core.json put
 * the overlay's 289 `description` rows back — the file grew 184 KB and held prose in two places at
 * once. Caught by looking at the byte count of a supposedly idempotent operation.
 *
 * They are ROUTED to core-descriptions.json instead of dropped. Skipping them entirely left a real
 * gap: a description row authored between rebuilds reached nothing at all until the next full
 * `npm run data`, so the prose was invisible in the app AND `overlay-durability.test.ts` failed it as
 * drift — the overlay said one thing and the shipped artefact another. Writing prose to the file that
 * now owns it is the same replay the pipeline performs, just after the split rather than before.
 *
 * ⚠ public/core.json is stored MINIFIED. Written back the same way, deliberately.
 *
 *   node scripts/apply-backfill-now.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyBackfill } from './lib/apply-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = join(ROOT, 'public/core.json');
const DESCS = join(ROOT, 'public/core-descriptions.json');
const OVERLAY = join(ROOT, 'scripts/data/effect-backfill.json');

const before = readFileSync(CORE, 'utf8');
const db = JSON.parse(before.replace(/^﻿/, ''));
const { applied, unresolved } = applyBackfill(db, OVERLAY, {
  skipFields: ['description', 'descRefs'],
});

const out = JSON.stringify(db);
writeFileSync(CORE, out);

console.log(`applied ${applied} row(s) to public/core.json (${before.length} -> ${out.length} bytes).`);

/*
 * Prose goes to the file the split gave it to. Rows are written only where the stored text ACTUALLY
 * DIFFERS, so the common case rewrites nothing and the byte count stays put — the same check that
 * caught the 184 KB duplication this routing replaces. Only records that already exist in core.json
 * are touched: a description for a record the overlay creates is the create row's business, and
 * inventing a descriptions entry for a record that ships no other data would hide a real gap.
 */
const descsBefore = readFileSync(DESCS, 'utf8');
const descs = JSON.parse(descsBefore.replace(/^﻿/, ''));
let prose = 0;
const proseMissing = [];
for (const fix of JSON.parse(readFileSync(OVERLAY, 'utf8'))) {
  /* Both prose fields, to the keys the split gave them: `description` → `d`, `descRefs` → `r`.
   * Only `d` was routed at first, so a descRefs row authored between rebuilds (sound-mirror's, whose
   * scraped `r` linked Silence where the page links Ventriloquism) reached nothing until the next
   * full `npm run data` — and overlay-durability.test.ts rightly failed it as drift. ⚠ A descRefs row
   * routes here only when the record already has a descriptions entry — for an UNSPLIT bucket
   * (familiarAbilities) the field lives in core.json and the plain applier above already set it. */
  const isDesc = fix.field === 'description' && typeof fix.value === 'string';
  const isRefs = fix.field === 'descRefs' && Array.isArray(fix.value) && descs[fix.category]?.[fix.id] !== undefined;
  if ((!isDesc && !isRefs) || fix.path?.length) continue;
  if (!db[fix.category]?.[fix.id]) { proseMissing.push(`${fix.category}/${fix.id}`); continue; }
  const bucket = (descs[fix.category] ??= {});
  const entry = (bucket[fix.id] ??= {});
  const key = isDesc ? 'd' : 'r';
  if (JSON.stringify(entry[key]) === JSON.stringify(fix.value)) continue;
  entry[key] = fix.value;
  prose++;
}
if (prose) {
  const descsOut = JSON.stringify(descs);
  writeFileSync(DESCS, descsOut);
  console.log(`applied ${prose} prose row(s) to public/core-descriptions.json (${descsBefore.length} -> ${descsOut.length} bytes).`);
} else {
  console.log('prose rows: already in sync with public/core-descriptions.json.');
}
if (proseMissing.length) {
  console.log(`\n⚠ ${proseMissing.length} prose row(s) name a record core.json does not have: ${proseMissing.slice(0, 10).join(', ')}`);
}
if (unresolved.length) {
  /* A row whose record does not exist is authored data reaching nothing — the exact failure this
   * project keeps finding late. Name them; do not let the count stand in for the list. */
  console.log(`\n⚠ ${unresolved.length} row(s) resolved to no record and did nothing:`);
  for (const u of unresolved.slice(0, 40)) console.log(`    ${typeof u === 'string' ? u : JSON.stringify(u)}`);
  if (unresolved.length > 40) console.log(`    …and ${unresolved.length - 40} more`);
}
