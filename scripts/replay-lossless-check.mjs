/**
 * IS REPLAYING THE OVERLAY LOSSLESS?
 *
 * scripts/apply-backfill-now.mjs replays scripts/data/effect-backfill.json onto the shipped public/core.json
 * and public/core-descriptions.json, and every parity batch runs it on the WHOLE overlay after each spec
 * (scripts/wg-batch-run.mjs). Until 2026-10-17 that replay was lossy: it dropped the class-option links the
 * data chain adds after the overlay (classes/champion Blessed Armament + Blessed Shield, classes/animist
 * Lamentation of Sinister Deals 15 -> 11), because it skipped the chain's class-option sync. Nothing failed;
 * the links were simply gone after a batch.
 *
 * This check runs the whole replay IN MEMORY over today's artefacts (scripts/lib/overlay-replay.mjs, the
 * same code the replay script runs) and fails on any record it changes although every overlay row of that
 * record is already in the shipped data — the replay undoing something the chain built. Records with a row
 * that is not in the shipped data yet are pending, not lost; scripts/regen-durability-check.mjs reports
 * those ("not baked"), so this check only counts them.
 *
 *     node scripts/replay-lossless-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBaseline as loadEmbeddedBaseline } from './lib/embedded-descriptions.mjs';
import { describeChanges, loadCreated, replayChanges, replayOverlay } from './lib/overlay-replay.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, '');

const coreText = text('public/core.json');
const descsText = text('public/core-descriptions.json');
const rows = JSON.parse(text('scripts/data/effect-backfill.json'));
const keep = new Set(loadEmbeddedBaseline(ROOT).keys());
const created = loadCreated(ROOT);

const coreAfter = JSON.parse(coreText);
const descsAfter = JSON.parse(descsText);
replayOverlay(coreAfter, descsAfter, rows, { keep, created });
const { stale, changes } = replayChanges({
  coreBefore: JSON.parse(coreText), descsBefore: JSON.parse(descsText), coreAfter, descsAfter, rows, keep, created,
});

const pendingNote = stale.length ? ` (${stale.length} row(s) pending — not in the shipped data yet; regen-durability-check reports them)` : '';
if (!changes.length) {
  console.log(`  ok    a whole replay of the ${rows.length}-row overlay changes no settled record${pendingNote}`);
  console.log('\nreplay lossless: passed');
  process.exit(0);
}
console.log(`  FAIL  a whole replay of the overlay changes ${changes.length} record(s) whose rows are ALL already in the shipped data${pendingNote}`);
for (const line of describeChanges(changes)) console.log(line);
console.log('\n  scripts/apply-backfill-now.mjs would refuse on these (and every parity batch with it). The replay is missing a');
console.log('  step `npm run data` runs after the overlay: add it to scripts/lib/overlay-replay.mjs replayOverlay.');
process.exit(1);
