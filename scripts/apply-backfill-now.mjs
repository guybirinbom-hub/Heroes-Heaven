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
 * ⚠ AND IT CAN UNDO A STAMP THE CHAIN PUTS ON TOP OF THE OVERLAY. Desk #158 marks the 181 records
 * whose reprint already ships with `edition: 'legacy'` + `remasteredAs`, written by stamp-aonid.mjs
 * AFTER the overlay is applied; 9 of those records also carry an older overlay `edition` row saying
 * `legacy-era`, so replaying the overlay here puts that back and the pair no longer agrees.
 * scripts/reprint-check.mjs fails on exactly that and says to re-run the chain. Nothing is lost — but
 * do not read a red reprint-check after this script as a data defect.
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
 * ⚠ A WHOLE REPLAY WAS NOT LOSSLESS until 2026-10-17 (package C). Measured on 585544e and e5bedf6: it
 * dropped the `descRefs` the chain embeds INSIDE classes/champion and classes/animist option lists — an
 * overlay row writes the whole list, and the chain then gives each option its classFeatures record's
 * links (embedded-descriptions.mjs syncOptionDescriptions). This script never ran that sync. Now the
 * replay is scripts/lib/overlay-replay.mjs `replayOverlay`, which runs it, and before writing anything
 * this script compares the artefacts before and after: a record may change only when one of its overlay
 * rows is not in the shipped data yet. Any other change is the replay undoing something `npm run data`
 * built, so the script REFUSES and writes nothing. scripts/replay-lossless-check.mjs (npm run verify)
 * proves the same on every run. `--only` still replays just the named records (prose rows too), but a
 * WHOLE replay is the one to prefer now: `--only` on a classFeatures record leaves the class option that
 * copies its links as it was until a whole replay runs the option sync with every row.
 *
 *   node scripts/apply-backfill-now.mjs
 *   node scripts/apply-backfill-now.mjs --only feats/expanded-necromancy,classFeatures/lesson-of-death
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBaseline as loadEmbeddedBaseline } from './lib/embedded-descriptions.mjs';
import { describeChanges, loadCreated, replayChanges, replayOverlay } from './lib/overlay-replay.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = join(ROOT, 'public/core.json');
const DESCS = join(ROOT, 'public/core-descriptions.json');
const OVERLAY = join(ROOT, 'scripts/data/effect-backfill.json');
const onlyAt = process.argv.indexOf('--only');
const ONLY = onlyAt > 0 ? new Set(String(process.argv[onlyAt + 1] ?? '').split(',').filter(Boolean)) : null;
if (ONLY && !ONLY.size) {
  console.error('usage: --only <category>/<id>[,<category>/<id>…]');
  process.exit(2);
}

const before = readFileSync(CORE, 'utf8').replace(/^﻿/, '');
const descsBefore = readFileSync(DESCS, 'utf8').replace(/^﻿/, '');
const rows = JSON.parse(readFileSync(OVERLAY, 'utf8'));
const db = JSON.parse(before);
const descs = JSON.parse(descsBefore);
if (ONLY) {
  // A record a `create` row adds is not in core.json yet, and is a legal target.
  const created = new Set(rows.filter((f) => f.create).map((f) => `${f.category}/${f.id}`));
  for (const key of ONLY) {
    const [category, ...rest] = key.split('/');
    if (!db[category]?.[rest.join('/')] && !created.has(key)) {
      console.error(`--only ${key}: no such record in public/core.json and no overlay row creates it — nothing written.`);
      process.exit(2);
    }
  }
}

/*
 * Prose goes to the file the split gave it to (`description` → `d`, `descRefs` → `r`), and only where the
 * stored value ACTUALLY DIFFERS, so the common case rewrites nothing — the same check that caught the
 * 184 KB duplication this routing replaced. Only records that already exist in core.json are touched: a
 * description for a record the overlay creates is the create row's business. A descRefs row authored
 * between rebuilds (sound-mirror's, whose scraped `r` linked Silence where the page links Ventriloquism)
 * once reached nothing until the next full `npm run data`, because only `d` was routed. replayOverlay
 * does all of this, then the class-option sync.
 */
const keep = new Set(loadEmbeddedBaseline(ROOT).keys());
const created = loadCreated(ROOT);
const { applied, unresolved, prose, proseMissing, appended, counters, sync } = replayOverlay(db, descs, rows, { only: ONLY, keep, created });

const { stale, changes } = replayChanges({
  coreBefore: JSON.parse(before), descsBefore: JSON.parse(descsBefore), coreAfter: db, descsAfter: descs, rows, keep, created,
});
if (changes.length) {
  console.error(`REFUSED: this replay would change ${changes.length} record(s) whose overlay rows are ALL already in the shipped data — nothing written.`);
  console.error('  That is the replay undoing something `npm run data` built after the overlay (the 2026-10-15 champion/animist');
  console.error('  link loss). Teach scripts/lib/overlay-replay.mjs replayOverlay the chain step that adds it; never write around this.');
  for (const line of describeChanges(changes)) console.error(line);
  process.exit(1);
}

const out = JSON.stringify(db);
if (out !== before) writeFileSync(CORE, out);
console.log(`applied ${applied} row(s) to public/core.json (${before.length} -> ${out.length} bytes); ${stale.length} row(s) were not in the shipped data before this replay.`);
if (appended) console.log(`class options: ${appended} created option(s) a whole-list row left out were put back (the chain's appendSubclassOptions).`);
if (counters.gained) console.log(`item uses: ${counters.filled} record(s) regained ${counters.gained} printed-Frequency counter(s) a counters row had replaced.`);
if (sync.linked.length || sync.synced.length) {
  console.log(`class options: after the overlay rows, ${sync.synced.length} took their record's text and ${sync.linked.length} its links again (the chain's own last step).`);
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
