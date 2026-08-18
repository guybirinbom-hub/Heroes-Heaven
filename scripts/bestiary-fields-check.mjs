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
 *   node scripts/bestiary-fields-check.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'public/data/bestiary');
const FAMILIES = join(ROOT, 'public/data/creature-families.json');

/* Measured 2026-08-17 after restoring the enrichment pass: 4,760 records carry
 * flavor 4,754 / family 2,706 / rituals 270. Floors sit a little under those. */
const FLOORS = { records: 4500, flavor: 4500, family: 2500, rituals: 200 };
const FAMILY_FLOOR = 400;

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

if (bad) {
  console.error('\nRe-run the enrichment pass in C:/pf2e-tracker, then copy public/data/bestiary + creature-families.json across:');
  console.error('  node scripts/rebuild-family-cache.mjs   # only if scripts/aon-raw/creature-family.json is missing');
  console.error('  node scripts/add-descriptions.mjs       # flavor + family + creature-families.json');
  console.error('  node scripts/add-rituals.mjs            # rituals');
  process.exit(1);
}
console.log('\nall fields present.');
