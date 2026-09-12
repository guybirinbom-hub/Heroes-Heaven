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
 * 2026-09-12: the bestiary is now built from the owner's Archives by scripts/build-bestiary.mjs (one
 * pass, flavor/family/rituals included), so the two-stage trap above is gone — but the floors had been
 * set on the OLD scrape's counts, and its "flavor" for 763 creatures was nothing but the Recall
 * Knowledge sidebar scraped as prose. The honest count is ~4,000, so the flavor floor came down.
 * Also checked since then: every index row points at a bestiary file that ships, and every bestiary
 * file is reachable from the index (a renamed source file left a 12-creature orphan behind).
 *
 *   node scripts/bestiary-fields-check.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'public/data/bestiary');
const FAMILIES = join(ROOT, 'public/data/creature-families.json');

/* Measured 2026-09-12 on the Archives build: 4,791 records carry flavor 4,008 / family 2,682 /
 * rituals 325 (the 2026-08-17 scrape read 4,754 flavor, 763 of them sidebar junk). Floors sit a
 * little under those. */
const FLOORS = { records: 4700, flavor: 3900, family: 2600, rituals: 300 };
const FAMILY_FLOOR = 400;
const INDEX = join(ROOT, 'public/data/index.json');
const HAZARDS = join(ROOT, 'public/data/hazards.json');

if (!existsSync(DIR)) { console.error(`no bestiary at ${DIR}`); process.exit(1); }

let records = 0, flavor = 0, family = 0, rituals = 0, files = 0;
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  let data;
  try { data = JSON.parse(readFileSync(join(DIR, f), 'utf8')); } catch { console.error(`unparseable: ${f}`); process.exit(1); }
  files++;
  for (const c of data.creature ?? []) {
    records++;
    if (c.flavor) flavor++;
    if (c.family) family++;
    if (c.rituals) rituals++;
  }
}

let familyCount = 0;
try { familyCount = Object.keys(JSON.parse(readFileSync(FAMILIES, 'utf8'))).length; } catch { /* reported below */ }

const rows = [
  ['records', records, FLOORS.records],
  ['flavor', flavor, FLOORS.flavor],
  ['family', family, FLOORS.family],
  ['rituals', rituals, FLOORS.rituals],
  ['creature-families.json', familyCount, FAMILY_FLOOR],
];
console.log(`bestiary: ${files} files`);
let bad = 0;
for (const [label, got, floor] of rows) {
  const ok = got >= floor;
  if (!ok) bad++;
  console.log(`  ${label.padEnd(24)} ${String(got).padStart(6)}   floor ${String(floor).padStart(6)}   ${ok ? 'ok' : 'BELOW FLOOR'}`);
}

/* `family` is the only join key into creature-families.json — if it is empty the prose is unreachable
 * even though the file ships, which is exactly how this went unnoticed for a month. */
if (family === 0 && familyCount > 0) {
  console.error('\ncreature-families.json ships but NO creature carries `family` — the prose is unreachable.');
  bad++;
}

/* The index is the tracker's only list of bestiary files (tracker/src/data/dataStore.ts fetches
 * `bestiary/${entry.file}`): a row whose file is missing is a 404 in "Add Combatants", and a file no
 * row names is dead weight shipped in every installer. */
try {
  const idx = JSON.parse(readFileSync(INDEX, 'utf8'));
  const rows = Array.isArray(idx) ? idx : (Object.values(idx).find(Array.isArray) ?? []);
  const named = new Set();
  const missing = [];
  let hazardRows = 0;
  for (const r of rows) {
    if (r.file === '../hazards.json') { hazardRows++; continue; }
    named.add(r.file);
    if (!existsSync(join(DIR, r.file))) missing.push(r.file);
  }
  const orphans = readdirSync(DIR).filter((f) => f.endsWith('.json') && !named.has(f));
  console.log(`  index: ${rows.length} rows, ${named.size} bestiary files named, ${hazardRows} hazard rows`);
  if (missing.length) { console.error(`  index names ${missing.length} file(s) that do not exist: ${missing.slice(0, 5).join(', ')}`); bad++; }
  if (orphans.length) { console.error(`  ${orphans.length} bestiary file(s) no index row names: ${orphans.slice(0, 5).join(', ')}`); bad++; }
  if (!hazardRows || !existsSync(HAZARDS)) { console.error('  no hazard rows in the index, or hazards.json is missing'); bad++; }
} catch (e) {
  console.error(`  could not read ${INDEX}: ${e.message}`); bad++;
}

if (bad) {
  console.error('\nRebuild the bestiary from the Archives export, then confirm nothing was silently dropped:');
  console.error('  node scripts/build-bestiary.mjs        # public/data/bestiary + hazards.json + index.json');
  console.error('  node scripts/check-creature-parse.mjs  # every ability header in the markdown survived');
  process.exit(1);
}
console.log('\nall fields present.');
