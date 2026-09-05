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
 * `DROPPED_INLINE_ALL=1` drops the RECORD filter and aligns every record instead — but the per-
 * SENTENCE hole test in the lib still applies the same HOLES list, so the env var does NOT prove the
 * list sufficient: heal/harm's terminal-shape hole ("in a . This targets") passed a full sweep
 * untouched until batch 24 added its HOLES row. The full sweep raises coverage; it is not a proof.
 * Re-run it after any AoN update, not just this guard.
 *
 *   node scripts/dropped-inline-check.mjs
 *   DROPPED_INLINE_ALL=1 node scripts/repair-dropped-inline.mjs   # the periodic re-measure
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDroppedInline, MIRROR } from './lib/dropped-inline.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * THE STRIPPED-LINK HOLE — a second class of deleted value the mirror comparison above cannot see.
 *
 * The de-linkifier that builds the `d` fallback prose eats the numeric span beside a stripped auto-link,
 * so a sentence ends in "a ." — *"make its area a instead of a ."* (Directed Channel), *"attempt a ."*
 * (Hardshell Surki), *"in a instead of a ."* (Nyktera). The AST carrier renders correctly, so the app
 * usually hides it, but the fallback is what the search index, the tooltips and any AST-less bucket
 * show. Batch 27 repaired four by hand and measured 260 more across the corpus (mostly spells).
 *
 * A RATCHET, not a zero-guard: the baseline is the count on the day the detector was written, and the
 * check fails only when a regeneration or an edit makes it GROW. Lower the baseline as the sweep
 * repairs them (regenerate `d` from the AST); never raise it.
 */
const HOLE_BASELINE = 260;
const HOLE = /\ba \.(?=\s|$)/;
{
  const descs = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));
  const holes = [];
  for (const [cat, recs] of Object.entries(descs)) {
    for (const [id, e] of Object.entries(recs ?? {})) if (e && typeof e.d === 'string' && HOLE.test(e.d)) holes.push(`${cat}/${id}`);
  }
  if (holes.length > HOLE_BASELINE) {
    console.log(`dropped-inline: FAIL — ${holes.length} record(s) end a sentence at a stripped link ("… a .") — more than the ${HOLE_BASELINE} the ratchet allows. New ones:`);
    for (const h of holes.slice(0, 30)) console.log(`   ${h}`);
    console.log('\nRepair the fallback `d` from the AST (public/ast/<bucket>.json.gz) via a description overlay row; never raise HOLE_BASELINE.');
    process.exit(1);
  }
  console.log(`dropped-inline: ${holes.length} stripped-link hole(s) in core-descriptions.json (ratchet ${HOLE_BASELINE}; lower it as the sweep repairs them)`);
}

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
