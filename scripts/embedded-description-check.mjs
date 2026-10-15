/*
 * GUARD: A CLASS OPTION'S EMBEDDED DESCRIPTION IS ITS classFeatures RECORD'S — TEXT AND LINKS.
 *
 * For every `classes.<id>.subclass.options[]` and `classes.<id>.extraChoices[].options[]` option that has a
 * classFeatures record under its id, the option's own `description` (public/core.json — the Builder's option list,
 * and the sheet's classChoices[].description through buildCharacter) must equal that record's description
 * (public/core-descriptions.json `classFeatures.<id>.d`, or the record's inline text where it has not been split),
 * and the option's `descRefs` must hold every link the record's (`.r`, or inline `descRefs`) holds — same key and
 * label; the option may carry more. Exactly equal: the chain applies no normalisation between the two —
 * scripts/lib/embedded-descriptions.mjs `syncOptionDescriptions` copies the record's string and adds its missing
 * links, at the end of import-core-v2, import-siege-and-gaps and import-new-classes (the three writers of a class
 * option list).
 *
 * Why (2026-09-30): at a787fb0, 46 of the 250 options differed — the School of Battle Magic's 6th-rank line read
 * "Chain Lightning," (892 chars) where its record reads "Chain Lightning, Disintegrate" (905): Foundry-era option
 * texts with the @-link cleaner's deletions, carried by the importer and restated by whole-list overlay rows, never
 * derived from the records the overlay had repaired. The links half came from the lane's refuter: the animist's
 * Lamentation of Sinister Deals took its record's text with 11 of the record's 15 links. See the lib's header.
 *
 * FAILS (exit 1), naming class / group / option, the record (classFeatures/<id>) and the first differing run or
 * the missing links, when
 *   · an option's text differs from its record's, or lacks one of its record's links, and the option is not in the
 *     baseline (scripts/data/embedded-description-baseline.json: the RECORD is the damaged text there, or a batch
 *     ruling pinned the option's shorter one — each line with its reason); or
 *   · a baseline line names an option that now agrees with its record, or that no longer exists (remove the
 *     line); or
 *   · the baseline's size is not BASELINE_CEILING. The ceiling is the ratchet: a line removed must lower it, and a
 *     line ADDED must raise it — an edit to this file, which test/embedded-descriptions.test.ts pins, so no drift
 *     can be hidden by adding a line to a data file alone; or
 *   · (THE OVERLAY HALF, 2026-09-30, the lane's second refuter) an effect-backfill row that writes a class option
 *     list restates an option — record with text, not baselined — with text that is not its record's. The sync
 *     runs after the overlay, so that row's text would be overwritten on every regen with nothing failing: an
 *     overlay edit that silently did nothing. A text change belongs on the RECORD (its `description` row), with the
 *     whole-list rows superseded to the record's text beside it. Links are not counted here: the sync only ADDS a
 *     record link a row lacks, never removes or changes one a row wrote.
 * An option whose record has no description is counted and passes (nothing to copy).
 *
 *   node scripts/embedded-description-check.mjs
 *   CORE=<core.json> DESC=<core-descriptions.json> [BASELINE=<baseline.json>] [OVERLAY=<effect-backfill.json>] node scripts/embedded-description-check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_FILE, differingRun, loadBaseline, missingRefs, optionListsInRow, optionsWithRecords, recordReader } from './lib/embedded-descriptions.mjs';

/** The number of baselined options, measured 2026-09-30: 10 thaumaturge implements (batch 28) + 3 magus hybrid
 * studies (batch P02). It was 15 until the two damaged records (inventor/light-mortar-innovation,
 * necromancer/puppeteer) were repaired the same day. Lower it when a line goes; raising it is a decision, made in
 * this file. */
const BASELINE_CEILING = 13;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = JSON.parse(readFileSync(resolve(process.env.CORE || join(ROOT, 'public/core.json')), 'utf8'));
const descs = JSON.parse(readFileSync(resolve(process.env.DESC || join(ROOT, 'public/core-descriptions.json')), 'utf8'));
const baseline = loadBaseline(ROOT, process.env.BASELINE ? resolve(process.env.BASELINE) : undefined);
const ceiling = process.env.BASELINE_CEILING ? Number(process.env.BASELINE_CEILING) : BASELINE_CEILING;
const OVERLAY_FILE = 'scripts/data/effect-backfill.json';
const overlay = JSON.parse(readFileSync(resolve(process.env.OVERLAY || join(ROOT, OVERLAY_FILE)), 'utf8').replace(/^﻿/, ''));

const recordOf = recordReader(core, descs);
const pairs = optionsWithRecords(core);
const fails = [];
const baselined = [];
const seen = new Set();
let equal = 0, noText = 0;
for (const { classId, group, option } of pairs) {
  const key = `${classId}/${option.id}`;
  seen.add(key);
  const rec = recordOf(option.id);
  if (typeof rec?.text !== 'string' || !rec.text) { noText++; continue; }
  const lacks = missingRefs(option, rec.refs);
  if (option.description === rec.text && !lacks.length) {
    equal++;
    if (baseline.has(key)) fails.push(`  STALE BASELINE ${key}: it now carries classFeatures/${option.id}'s text and links — remove the line from ${BASELINE_FILE}`);
    continue;
  }
  if (baseline.has(key)) { baselined.push(key); continue; }
  if (option.description !== rec.text) {
    const run = differingRun(option.description, rec.text);
    fails.push(`  ${classId} ${group} ${option.id} (record classFeatures/${option.id}): embedded ${String(option.description ?? '').length} chars, record ${rec.text.length}; first difference at ${run.at}:\n`
      + `      embedded: ${JSON.stringify(run.a).slice(0, 220)}\n      record:   ${JSON.stringify(run.b).slice(0, 220)}`);
  }
  if (lacks.length) {
    fails.push(`  ${classId} ${group} ${option.id} (record classFeatures/${option.id}): the option lacks ${lacks.length} of the record's ${rec.refs.length} link(s): `
      + lacks.map((r) => `${r.label} -> ${r.key}`).join(' | '));
  }
}
for (const key of baseline.keys()) {
  if (!seen.has(key)) fails.push(`  STALE BASELINE ${key}: no such class option with a classFeatures record — remove the line from ${BASELINE_FILE}`);
}

/* The overlay half: a whole-list row's option text is its record's, or the sync would silently overwrite it. */
let rowLists = 0, rowOptions = 0;
const rowFails = [];
overlay.forEach((row, index) => {
  const lists = optionListsInRow(row, row?.value);
  if (!lists.length) return;
  rowLists++;
  for (const list of lists) {
    for (const option of list ?? []) {
      if (!option?.id) continue;
      const rec = recordOf(option.id);
      if (typeof rec?.text !== 'string' || !rec.text) continue;
      if (baseline.has(`${row.id}/${option.id}`)) continue;
      rowOptions++;
      if (option.description === rec.text) continue;
      const run = differingRun(option.description, rec.text);
      rowFails.push(`  OVERLAY ROW #${index} ${row.category}/${row.id} ${JSON.stringify(row.path ?? [])}.${row.field} restates ${option.id} with text that is not classFeatures/${option.id}'s `
        + `(${String(option.description ?? '').length} vs ${rec.text.length} chars; first difference at ${run.at}) — the sync overwrites it on every regen:\n`
        + `      row:    ${JSON.stringify(run.a).slice(0, 220)}\n      record: ${JSON.stringify(run.b).slice(0, 220)}`);
    }
  }
});
fails.push(...rowFails);
if (baseline.size !== ceiling) {
  fails.push(baseline.size > ceiling
    ? `  BASELINE GREW: ${BASELINE_FILE} holds ${baseline.size} lines, the ceiling is ${ceiling} — a drift is repaired at its source, not baselined; raising BASELINE_CEILING in scripts/embedded-description-check.mjs is a decision with its reason`
    : `  CEILING STALE: ${BASELINE_FILE} holds ${baseline.size} lines, the ceiling is ${ceiling} — lower BASELINE_CEILING in scripts/embedded-description-check.mjs to ${baseline.size} (a ratchet guards only at the live count)`);
}

console.log(`embedded-description-check: ${pairs.length} class options with a classFeatures record; ${equal} carry their record's text and links, `
  + `${baselined.length} baselined (${BASELINE_FILE}, ceiling ${ceiling}), ${noText} whose record has no text`);
console.log(`embedded-description-check: ${rowLists} overlay row(s) write a class option list; ${rowOptions - rowFails.length} of their ${rowOptions} record-backed, unbaselined option(s) restate the record's text`);
if (fails.length) {
  const other = /^ {2}(STALE BASELINE|BASELINE GREW|CEILING STALE|OVERLAY ROW)/;
  const bookkeeping = fails.filter((f) => /^ {2}(STALE BASELINE|BASELINE GREW|CEILING STALE)/.test(f)).length;
  const differ = new Set(fails.filter((f) => !other.test(f)).map((f) => f.trim().split(' ').slice(0, 3).join(' '))).size;
  console.error(`\nEMBEDDED-DESCRIPTION: ${differ} class option(s) whose embedded description or links differ from its classFeatures record's`
    + `${bookkeeping ? `, ${bookkeeping} baseline problem(s)` : ''}${rowFails.length ? `, ${rowFails.length} overlay row option(s) the sync would silently overwrite` : ''}:`);
  for (const f of fails) console.error(f);
  console.error('\n  The option text and links are the record\'s: scripts/lib/embedded-descriptions.mjs syncOptionDescriptions runs at the end of'
    + ' import-core-v2, import-siege-and-gaps and import-new-classes, so a full `npm run data` writes them. Where the RECORD is the damaged text,'
    + ` repair the record; a baseline line in ${BASELINE_FILE} needs its reason and a raised BASELINE_CEILING here.`
    + ` An OVERLAY ROW line: change the text on the record, and supersede the whole-list row (scripts/apply-parity-fixes.mjs) with the record's text.`);
  process.exit(1);
}
console.log('embedded-description-check: OK — every class option with a classFeatures record carries that record\'s description and links, and every overlay row restating one carries its record\'s text (baseline aside).');
