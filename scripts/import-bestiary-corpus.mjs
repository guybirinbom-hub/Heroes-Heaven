/**
 * Bring the verified bestiary corpus into the app.
 *
 * The tracker's stat blocks (`public/data/bestiary/*.json`, `public/data/hazards.json`,
 * `public/data/index.json`) come from the bestiary corpus repository
 * (https://github.com/guybirinbom-hub/hh-bestiary-corpus), which reads every creature and hazard on the
 * Archives twice (structured fields and page text) and renders each one through the tracker's own stat
 * block. This script replaces the old in-app builder (`scripts/build-bestiary.mjs` and its markdown
 * parser, retired 2026-10-06), which folded unplaceable lines into the previous ability.
 *
 * What it does:
 *   - refuses unless the corpus has STATUS.md and report/coverage.json, and coverage.live equals
 *     coverage.corpus for creature and hazard (a corpus behind the live Archives does not ship);
 *   - deletes every public/data/bestiary/*.json, then copies byte for byte the shards data/index.json
 *     names — NEVER the shards listed in coverage.orphanShards. Those shards hold only printings whose
 *     every record is superseded by a linked remaster; ruling R12 (docs/gold-set-answers.md: the newest
 *     printing wins, legacy-only content stays) means superseded printings do not ship;
 *   - copies data/hazards.json and data/index.json byte for byte;
 *   - verifies the result (every index row's file exists; shipped creatures = corpus creatures minus the
 *     skipped shards' records; hazards / index rows / hazard index rows = the corpus coverage report);
 *   - writes scripts/data/bestiary-corpus-pin.json (repo, commit, Archives fetch stamp, counts, skipped
 *     shards). scripts/bestiary-fields-check.mjs fails when the shipped files stop matching that pin.
 *
 *   node scripts/import-bestiary-corpus.mjs <corpus-dir> [--dry-run]
 *
 * --dry-run writes nothing and prints the plan ("nothing to do" when the shipped files already equal it).
 * The only git command run is the read-only `git -C <corpus> rev-parse HEAD`.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'public/data');
const BESTIARY = join(DATA, 'bestiary');
const PIN = join(ROOT, 'scripts/data/bestiary-corpus-pin.json');
const REPO = 'https://github.com/guybirinbom-hub/hh-bestiary-corpus';
const HAZARD_FILE = '../hazards.json';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const corpusArg = args.find((a) => !a.startsWith('--'));
if (!corpusArg) {
  console.error('usage: node scripts/import-bestiary-corpus.mjs <corpus-dir> [--dry-run]');
  process.exit(2);
}
const CORPUS = resolve(corpusArg);

function refuse(msg) {
  console.error(`REFUSED: ${msg}`);
  process.exit(1);
}
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sameBytes = (a, b) => existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));

/* ---- preconditions ---- */
const STATUS = join(CORPUS, 'STATUS.md');
const COVERAGE = join(CORPUS, 'report/coverage.json');
if (!existsSync(STATUS)) refuse(`${STATUS} is missing — the corpus has no complete green build`);
if (!existsSync(COVERAGE)) refuse(`${COVERAGE} is missing`);
const coverage = readJson(COVERAGE);
for (const cat of ['creature', 'hazard']) {
  const live = coverage.live?.[cat];
  const corpus = coverage.corpus?.[cat];
  if (typeof live !== 'number' || live !== corpus) {
    refuse(`coverage.live.${cat} (${live}) != coverage.corpus.${cat} (${corpus}) — the corpus is not complete against the live Archives`);
  }
}
const fetchedAt = /Archives fetched ([^)\s]+)\)/.exec(readFileSync(STATUS, 'utf8'))?.[1];
if (!fetchedAt) refuse(`STATUS.md carries no "Archives fetched <stamp>)" line`);

const SRC_BESTIARY = join(CORPUS, 'data/bestiary');
const SRC_HAZARDS = join(CORPUS, 'data/hazards.json');
const SRC_INDEX = join(CORPUS, 'data/index.json');
for (const p of [SRC_BESTIARY, SRC_HAZARDS, SRC_INDEX]) if (!existsSync(p)) refuse(`${p} is missing`);

const commit = execFileSync('git', ['-C', CORPUS, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/.test(commit)) refuse(`git rev-parse HEAD in the corpus gave "${commit}"`);

/* ---- the plan ---- */
const index = readJson(SRC_INDEX);
if (!Array.isArray(index)) refuse('data/index.json is not an array');
const named = new Set();
let indexHazardRows = 0;
for (const r of index) {
  if (r.file === HAZARD_FILE) indexHazardRows++;
  else named.add(r.file);
}
const corpusShards = readdirSync(SRC_BESTIARY).filter((f) => f.endsWith('.json')).sort();
const shardRecords = new Map(corpusShards.map((f) => [f, (readJson(join(SRC_BESTIARY, f)).creature ?? []).length]));
const corpusCreatures = [...shardRecords.values()].reduce((a, b) => a + b, 0);
if (corpusCreatures !== coverage.corpus.creature) {
  refuse(`the corpus shards hold ${corpusCreatures} creatures but coverage.corpus.creature says ${coverage.corpus.creature}`);
}

const orphans = new Map((coverage.orphanShards ?? []).map((o) => [o.file, o]));
const skipped = [];
for (const f of corpusShards) {
  if (named.has(f)) {
    if (orphans.has(f)) refuse(`${f} is listed as an orphan shard but the index names it`);
    continue;
  }
  const o = orphans.get(f);
  if (!o) refuse(`${f} is named by no index row and is not in coverage.orphanShards — unexplained`);
  if (o.records !== shardRecords.get(f)) refuse(`${f}: coverage says ${o.records} records, the shard holds ${shardRecords.get(f)}`);
  skipped.push({ file: f, records: o.records, reason: o.reason });
}
for (const f of named) if (!shardRecords.has(f)) refuse(`the index names ${f}, which the corpus does not have`);
const ship = corpusShards.filter((f) => named.has(f));

const hazards = (readJson(SRC_HAZARDS).hazard ?? []).length;
const expectedCreatures = corpusCreatures - skipped.reduce((a, s) => a + s.records, 0);
const counts = {
  creatures: expectedCreatures,
  hazards,
  shards: ship.length,
  indexRows: index.length,
  indexHazardRows,
};
const pin = { repo: REPO, commit, fetchedAt, counts, skippedShards: skipped };

for (const s of skipped) {
  console.log(`  skip ${s.file}  (${s.records} record${s.records === 1 ? '' : 's'}: ${s.reason}; ruling R12, newest printing wins)`);
}

/* What would change? */
const existing = existsSync(BESTIARY) ? readdirSync(BESTIARY).filter((f) => f.endsWith('.json')) : [];
const toDelete = existing.filter((f) => !named.has(f));
const toAdd = ship.filter((f) => !existing.includes(f));
const toReplace = ship.filter((f) => existing.includes(f) && !sameBytes(join(SRC_BESTIARY, f), join(BESTIARY, f)));
const sideFiles = [
  ['hazards.json', SRC_HAZARDS],
  ['index.json', SRC_INDEX],
].filter(([name, src]) => !sameBytes(src, join(DATA, name)));

/** Keep the newline style of a file this replaces; a new file is LF. */
function pinText(obj) {
  const body = JSON.stringify(obj, null, 2) + '\n';
  if (existsSync(PIN) && /\r\n/.test(readFileSync(PIN, 'utf8'))) return body.replace(/\n/g, '\r\n');
  return body;
}
const newPin = pinText(pin);
const pinChanged = !existsSync(PIN) || readFileSync(PIN, 'utf8') !== newPin;

console.log(`corpus ${CORPUS} @ ${commit.slice(0, 7)} (Archives fetched ${fetchedAt})`);
console.log(`  corpus: ${corpusShards.length} shards, ${corpusCreatures} creatures, ${hazards} hazards, ${index.length} index rows (${indexHazardRows} hazard rows)`);
console.log(`  ships:  ${ship.length} shards, ${expectedCreatures} creatures (skipping ${skipped.length} shards, ${corpusCreatures - expectedCreatures} records)`);
console.log(`  plan:   ${toAdd.length} shard(s) to add, ${toReplace.length} to replace, ${toDelete.length} to delete, ${ship.length - toAdd.length - toReplace.length} unchanged; side files to replace: ${sideFiles.map(([n]) => n).join(', ') || 'none'}; pin ${pinChanged ? 'to write' : 'unchanged'}`);
for (const f of toDelete) console.log(`    delete ${f}`);
for (const f of toAdd) console.log(`    add    ${f}`);

const nothing = !toDelete.length && !toAdd.length && !toReplace.length && !sideFiles.length && !pinChanged;
if (DRY) {
  console.log(nothing ? '\n--dry-run: nothing to do; the shipped files already equal the corpus.' : '\n--dry-run: nothing written.');
  process.exit(0);
}

/* ---- write ---- */
mkdirSync(BESTIARY, { recursive: true });
for (const f of existing) rmSync(join(BESTIARY, f));
for (const f of ship) copyFileSync(join(SRC_BESTIARY, f), join(BESTIARY, f));
copyFileSync(SRC_HAZARDS, join(DATA, 'hazards.json'));
copyFileSync(SRC_INDEX, join(DATA, 'index.json'));

/* ---- verify what landed ---- */
const problems = [];
const shipped = readdirSync(BESTIARY).filter((f) => f.endsWith('.json'));
let shippedCreatures = 0;
for (const f of shipped) shippedCreatures += (readJson(join(BESTIARY, f)).creature ?? []).length;
const landedIndex = readJson(join(DATA, 'index.json'));
for (const r of landedIndex) {
  const p = r.file === HAZARD_FILE ? join(DATA, 'hazards.json') : join(BESTIARY, r.file);
  if (!existsSync(p)) problems.push(`index row "${r.name}" names ${r.file}, which does not exist`);
}
const landedHazards = (readJson(join(DATA, 'hazards.json')).hazard ?? []).length;
const landedHazardRows = landedIndex.filter((r) => r.file === HAZARD_FILE).length;
const want = [
  ['shipped creatures', shippedCreatures, expectedCreatures],
  ['shipped shards', shipped.length, ship.length],
  ['hazards', landedHazards, coverage.corpus.hazard],
  ['index rows', landedIndex.length, coverage.index?.rows],
  ['index hazard rows', landedHazardRows, coverage.index?.hazards],
];
for (const [label, got, exp] of want) {
  console.log(`  ${label.padEnd(18)} ${String(got).padStart(6)}  expected ${exp}`);
  if (got !== exp) problems.push(`${label}: ${got}, expected ${exp}`);
}
for (const s of skipped) if (existsSync(join(BESTIARY, s.file))) problems.push(`skipped shard ${s.file} shipped`);
if (problems.length) {
  console.error('\nIMPORT FAILED VERIFICATION (the pin was not written):');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

mkdirSync(dirname(PIN), { recursive: true });
writeFileSync(PIN, newPin);
console.log(`\nimported; wrote ${PIN}`);
