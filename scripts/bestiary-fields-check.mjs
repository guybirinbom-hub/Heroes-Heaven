/**
 * The shipped bestiary must keep the fields its enrichment pass adds.
 *
 * `public/data/bestiary/` is produced in two stages: `scrape-aon.mjs` writes the stat blocks, then
 * `add-descriptions.mjs` and `add-rituals.mjs` add `flavor`, `family` and `rituals` on top. Only the
 * first stage is required to produce a *valid-looking* file, so skipping the second is silent.
 *
 * It happened. The 2026-08-16 refresh ran the scrape alone and shipped:
 *     flavor   4,032 -> 12        family   2,167 -> 0        rituals   222 -> 0
 * Nothing failed, no test caught it, and `creature-families.json` — 945 KB of prose whose ONLY join key
 * is `creature.family` — silently rendered nowhere for every one of 471 families. The cause was a
 * missing raw cache: `add-descriptions.mjs` needs `scripts/aon-raw/creature-family.json`, which that
 * refresh never wrote, so the script threw and the pipeline carried on without it.
 *
 * Floors, not exact counts, so adding creatures never trips it. Raise them when the corpus grows.
 *
 * 2026-09-12: the bestiary is now built from the owner's Archives in one pass, flavor/family/rituals
 * included, so the two-stage trap above is gone — but the floors had been set on the OLD scrape's
 * counts, and its "flavor" for 763 creatures was nothing but the Recall Knowledge sidebar scraped as
 * prose. The honest count is ~4,000, so the flavor floor came down.
 * Also checked since then: every index row points at a bestiary file that ships, and every bestiary
 * file is reachable from the index (a renamed source file left a 12-creature orphan behind).
 *
 * 2026-10-06: the bestiary now comes from the verified bestiary corpus
 * (https://github.com/guybirinbom-hub/hh-bestiary-corpus) through scripts/import-bestiary-corpus.mjs;
 * the in-app builder is retired. Two more checks:
 *   - scripts/data/bestiary-corpus-pin.json (written by the importer) must exist and its counts must
 *     equal the shipped files, so a stale or hand-edited data dir fails;
 *   - the family JOIN RATE — the share of creatures carrying `family` whose family the tracker can find
 *     in creature-families.json. The tracker joins lower-cased (tracker/src/data/dataStore.ts
 *     loadFamilies keys the file as written, all lower-case; CombatantDetail.tsx looks up
 *     `family.toLowerCase()`), so this joins the same way. A plain key match is 0% on every build so far,
 *     because the records carry "Demon", the file's keys "demon" — the reason to measure the real join.
 * Refute pass, same day: every index row must also be LOADABLE the way tracker/src/data/dataStore.ts
 * loadCreature loads it — `isHazard` exactly on the '../hazards.json' rows (the loader branches on the
 * flag, not the file), the row's name present in the file it names, and index.json an array.
 *
 *   node scripts/bestiary-fields-check.mjs
 *
 * `check(rootDir, { floors })` returns { bad, lines } so a test can run it on a fixture dir; each line
 * is { err, text } (err = printed to stderr by the CLI).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Measured 2026-09-12 on the Archives build: 4,791 records carry flavor 4,008 / family 2,682 /
 * rituals 325 (the 2026-08-17 scrape read 4,754 flavor, 763 of them sidebar junk). Floors sit a
 * little under those.
 * 2026-10-06, the corpus import: corpus commit f617090 has 3,830 of 4,791 records with flavor (the
 * other pages print nothing or the Archives' "no description" placeholder, and flavor is never
 * borrowed from a twin). The nine shards whose every record is superseded by a linked remaster do not
 * ship (ruling R12, newest printing wins), which takes 94 records and 60 flavors with them: the
 * shipped bestiary is 4,697 records / flavor 3,770 / family 2,677 / rituals 317. So records
 * 4700 -> 4600 and flavor 3900 -> 3700 (3800 would sit above the 3,770 that actually ships). */
export const FLOORS = { records: 4600, flavor: 3700, family: 2600, rituals: 300, families: 400 };
/* The join rate measured before the import (the 2026-09-12 Archives build) was 2,680 / 2,682 = 0.9993,
 * and after it 2,675 / 2,677 = 0.9993 (the two misses are "Thassilonian Sentinel", which has no entry in
 * creature-families.json). The floor is the LOWER of 0.95 and (measured - 0.02 = 0.9793): 0.95. */
export const FAMILY_JOIN_FLOOR = 0.95;
const HAZARD_FILE = '../hazards.json';
const PIN_REL = 'scripts/data/bestiary-corpus-pin.json';

export function check(rootDir, { floors = FLOORS, joinFloor = FAMILY_JOIN_FLOOR } = {}) {
  const DIR = join(rootDir, 'public/data/bestiary');
  const FAMILIES = join(rootDir, 'public/data/creature-families.json');
  const INDEX = join(rootDir, 'public/data/index.json');
  const HAZARDS = join(rootDir, 'public/data/hazards.json');
  const PIN = join(rootDir, PIN_REL);
  const lines = [];
  const out = (text) => lines.push({ err: false, text });
  const err = (text) => lines.push({ err: true, text });
  let bad = 0;

  if (!existsSync(DIR)) { err(`no bestiary at ${DIR}`); return { bad: 1, lines }; }

  /* Keyed as tracker/src/data/dataStore.ts loadFamilies keys it: an entry with no `text` is never put
   * in the map, so a family that finds only such an entry joins nothing on screen (refute 2026-10-06). */
  let familyKeys = new Set();
  try {
    familyKeys = new Set(Object.entries(JSON.parse(readFileSync(FAMILIES, 'utf8'))).filter(([, v]) => v?.text).map(([k]) => k));
  } catch { /* reported below */ }

  let records = 0, flavor = 0, family = 0, rituals = 0, joined = 0;
  const shardFiles = readdirSync(DIR).filter((x) => x.endsWith('.json'));
  /** file -> the names the tracker can find in it (`data.creature.find(c => c.name === entry.name)`). */
  const namesIn = new Map();
  for (const f of shardFiles) {
    let data;
    try { data = JSON.parse(readFileSync(join(DIR, f), 'utf8')); } catch { err(`unparseable: ${f}`); return { bad: 1, lines }; }
    if (!Array.isArray(data?.creature)) { err(`  ${f} has no "creature" array — the tracker reads data.creature.find(...)`); bad++; }
    namesIn.set(f, new Set((data?.creature ?? []).map((c) => c?.name)));
    for (const c of data.creature ?? []) {
      records++;
      if (c.flavor) flavor++;
      if (c.family) {
        family++;
        if (familyKeys.has(String(c.family).toLowerCase())) joined++;
      }
      if (c.rituals) rituals++;
    }
  }

  const rows = [
    ['records', records, floors.records],
    ['flavor', flavor, floors.flavor],
    ['family', family, floors.family],
    ['rituals', rituals, floors.rituals],
    ['creature-families.json', familyKeys.size, floors.families],
  ];
  out(`bestiary: ${shardFiles.length} files`);
  for (const [label, got, floor] of rows) {
    const ok = got >= floor;
    if (!ok) bad++;
    out(`  ${label.padEnd(24)} ${String(got).padStart(6)}   floor ${String(floor).padStart(6)}   ${ok ? 'ok' : 'BELOW FLOOR'}`);
  }

  /* `family` is the only join key into creature-families.json — if it is empty the prose is unreachable
   * even though the file ships, which is exactly how this went unnoticed for a month. */
  if (family === 0 && familyKeys.size > 0) {
    err('\ncreature-families.json ships but NO creature carries `family` — the prose is unreachable.');
    bad++;
  }
  /* …and a family that is set but joins nothing is just as unreachable. */
  const joinRate = family ? joined / family : 0;
  {
    const ok = family === 0 || joinRate >= joinFloor;
    if (!ok) bad++;
    out(`  ${'family join rate'.padEnd(24)} ${joinRate.toFixed(4).padStart(6)}   floor ${joinFloor.toFixed(4).padStart(6)}   ${ok ? 'ok' : 'BELOW FLOOR'}  (${joined}/${family} join creature-families.json)`);
  }

  /* The index is the tracker's only list of bestiary files (tracker/src/data/dataStore.ts fetches
   * `bestiary/${entry.file}`): a row whose file is missing is a 404 in "Add Combatants", and a file no
   * row names is dead weight shipped in every installer. */
  let indexRows = null, indexHazardRows = null, hazards = null;
  let hazardNames = new Set();
  try { hazardNames = new Set((JSON.parse(readFileSync(HAZARDS, 'utf8')).hazard ?? []).map((h) => h?.name)); } catch { /* reported below */ }
  try {
    const idx = JSON.parse(readFileSync(INDEX, 'utf8'));
    /* The tracker reads index.json as the array itself (loadIndex -> IndexEntry[], then idx.filter):
     * an object wrapping the array would crash Add Combatants, so only an array passes. */
    if (!Array.isArray(idx)) throw new Error('index.json is not an array — the tracker reads it as IndexEntry[]');
    const rowsIdx = idx;
    const named = new Set();
    const missing = [];
    /* loadCreature (tracker/src/data/dataStore.ts) branches on `isHazard`, NOT on the file: a hazard row
     * without it fetches bestiary/../hazards.json and reads `.creature` of it (a crash), and an
     * `isHazard` row looks its name up in hazards.json whatever its file says. Then it finds the record
     * by exact name; a row whose name is not in its file is "not found" when the GM adds it. */
    const loaderMismatch = [];
    const notFound = [];
    let hazardRows = 0;
    for (const r of rowsIdx) {
      const isHazardFile = r.file === HAZARD_FILE;
      if (isHazardFile !== (r.isHazard === true)) loaderMismatch.push(`${r.name} (file ${r.file}, isHazard ${r.isHazard})`);
      if (isHazardFile) {
        hazardRows++;
        if (!hazardNames.has(r.name)) notFound.push(`hazards.json: ${r.name}`);
        continue;
      }
      named.add(r.file);
      if (!existsSync(join(DIR, r.file))) { missing.push(r.file); continue; }
      if (!namesIn.get(r.file)?.has(r.name)) notFound.push(`${r.file}: ${r.name}`);
    }
    if (loaderMismatch.length) { err(`  ${loaderMismatch.length} index row(s) whose isHazard does not match their file: ${loaderMismatch.slice(0, 5).join(', ')}`); bad++; }
    if (notFound.length) { err(`  ${notFound.length} index row(s) name a record their file does not hold: ${notFound.slice(0, 5).join(', ')}`); bad++; }
    indexRows = rowsIdx.length;
    indexHazardRows = hazardRows;
    const orphans = shardFiles.filter((f) => !named.has(f));
    out(`  index: ${rowsIdx.length} rows, ${named.size} bestiary files named, ${hazardRows} hazard rows`);
    if (missing.length) { err(`  index names ${missing.length} file(s) that do not exist: ${missing.slice(0, 5).join(', ')}`); bad++; }
    if (orphans.length) { err(`  ${orphans.length} bestiary file(s) no index row names: ${orphans.slice(0, 5).join(', ')}`); bad++; }
    if (!hazardRows || !existsSync(HAZARDS)) { err('  no hazard rows in the index, or hazards.json is missing'); bad++; }
  } catch (e) {
    err(`  could not read ${INDEX}: ${e.message}`); bad++;
  }
  try { hazards = (JSON.parse(readFileSync(HAZARDS, 'utf8')).hazard ?? []).length; } catch { /* reported above */ }

  /* The pin: what scripts/import-bestiary-corpus.mjs copied, and from which corpus commit. Shipped files
   * that stop equalling it were edited by hand or left behind by another tool. */
  if (!existsSync(PIN)) {
    err(`  ${PIN_REL} is missing — the bestiary was not imported from the corpus`);
    bad++;
  } else {
    let pin = null;
    try { pin = JSON.parse(readFileSync(PIN, 'utf8')); } catch (e) { err(`  ${PIN_REL} is unparseable: ${e.message}`); bad++; }
    if (pin) {
      const shipped = { creatures: records, hazards, shards: shardFiles.length, indexRows, indexHazardRows };
      const diffs = [];
      for (const [k, got] of Object.entries(shipped)) {
        if (pin.counts?.[k] !== got) diffs.push(`${k}: pin ${pin.counts?.[k]}, shipped ${got}`);
      }
      for (const s of pin.skippedShards ?? []) {
        if (shardFiles.includes(s.file)) diffs.push(`${s.file} ships, but the pin skipped it (${s.reason})`);
      }
      out(`  pin: corpus ${String(pin.commit ?? '?').slice(0, 7)}, Archives fetched ${pin.fetchedAt ?? '?'}`);
      if (diffs.length) {
        err(`  the shipped files do not equal ${PIN_REL}:`);
        for (const d of diffs) err(`    ${d}`);
        bad++;
      }
    }
  }

  if (bad) {
    err('\nRe-import the bestiary from the verified corpus (https://github.com/guybirinbom-hub/hh-bestiary-corpus):');
    err('  node scripts/import-bestiary-corpus.mjs <corpus-dir> --dry-run   # the plan, writes nothing');
    err('  node scripts/import-bestiary-corpus.mjs <corpus-dir>             # public/data/bestiary + hazards.json + index.json + the pin');
  } else {
    out('\nall fields present.');
  }
  return { bad, lines };
}

const isCli = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isCli) {
  const { bad, lines } = check(join(dirname(fileURLToPath(import.meta.url)), '..'));
  for (const l of lines) (l.err ? console.error : console.log)(l.text);
  if (bad) process.exit(1);
}
