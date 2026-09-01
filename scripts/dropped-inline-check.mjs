/*
 * GUARD: NO SHIPPED RECORD MAY BE MISSING AN INLINE VALUE THE ARCHIVES PRINT.
 *
 * The `@Damage[…]` / `@Template[…]` / `@Check[…]` cleaner upstream of our AoN export drops what it
 * cannot parse and leaves the sentence intact, so "takes 1d4 mental damage" ships as "takes damage" —
 * a rule with no number, which reads as intentional. 1,206 records were affected before the sweep.
 *
 * This fails when `scripts/repair-dropped-inline.mjs` would have a CONFIDENT repair to make, i.e. the
 * Archives state a value in the aligned sentence and we do not. It deliberately says nothing about the
 * sites the repairer refuses — those are visible in that script's report and need a human, and holding
 * the build hostage to them would only teach everyone to skip the guard.
 *
 * Skips cleanly when the AoN mirror is not present, so it does not fail on a machine without it.
 *
 * ⚠ IT RUNS BEHIND A PHRASE PREFILTER, which is exactly as complete as whoever wrote the phrase list.
 * `DROPPED_INLINE_ALL=1` drops the filter and aligns EVERY record instead — 19,460 rather than 892. It
 * was run that way after the sweep and found nothing further, so the filter is provably sufficient for
 * the current data; it is not provably sufficient for the next refresh, which may print a phrasing
 * nobody has thought of. Re-run the full sweep after any AoN update, not just this guard.
 *
 *   node scripts/dropped-inline-check.mjs
 *   DROPPED_INLINE_ALL=1 node scripts/repair-dropped-inline.mjs   # the periodic re-measure
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDroppedInline, MIRROR } from './lib/dropped-inline.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const found = findDroppedInline(ROOT);

if (!found) {
  console.log(`dropped-inline: SKIPPED — no AoN mirror at ${MIRROR}`);
  process.exit(0);
}

const { edits, refused } = found;
if (!edits.length) {
  console.log(`dropped-inline: ok — no record is missing a value the Archives print (${refused.length} site(s) refused as unsafe to repair automatically; see scripts/repair-dropped-inline.mjs)`);
  process.exit(0);
}

const siteCount = edits.reduce((n, e) => n + e.sites.length, 0);
console.log(`dropped-inline: FAIL — ${edits.length} record(s) are missing ${siteCount} value(s) the Archives print:\n`);
for (const e of edits.slice(0, 25)) for (const s of e.sites) console.log(`   ${(e.category + '/' + e.id).padEnd(34)} ${s.at.replace(' ▸ ', ` [missing: ${s.run}] `)}`);
if (edits.length > 25) console.log(`   …and ${edits.length - 25} more record(s)`);
console.log(`\nFix with:  node scripts/repair-dropped-inline.mjs --write  &&  npm run data`);
process.exit(1);
