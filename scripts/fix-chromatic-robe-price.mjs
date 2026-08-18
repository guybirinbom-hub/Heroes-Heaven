/*
 * CHROMATIC ROBE (GREATER) COSTS 6,500 GP, NOT 65,000.
 *
 * `chromatic-robe-greater` is the app's record of AoN document equipment-4053-3738. Three sources
 * agree on its price and none of them is 65,000 gp:
 *   · the local mirror's structured field — `price: 650000`, and AoN stores price in COPPER, so
 *     650000 cp = 6,500 gp (scripts/price-check.mjs is built on that same unit);
 *   · the same document's `price_raw` and its printed body text, both "6,500 gp";
 *   · the live index (POST elasticsearch.aonprd.com/aon/_search, "Chromatic Robe"), which returns
 *     exactly three documents — the family head, "Chromatic Robe" at 950 gp, and "Greater Chromatic
 *     Robe" at 650000 cp. There is no document named "Chromatic Robe (Greater)" at all: that spelling
 *     is the app's own, recorded in scripts/migration/build-map.mjs as
 *     `how: 'scraped:word-order (Greater Chromatic Robe)'`.
 * 950 gp -> 6,500 gp is also the ladder this family actually prints; 950 -> 65,000 is not a ladder.
 *
 * WHY IT SURVIVED. scripts/price-check.mjs compares every item against the mirror BY NAME, and this
 * record's name has no mirror twin under that name — so it was one of the ~2,100 records the standing
 * check silently skips rather than one of the 5,427 it compares. A wrong price that no check can see
 * is exactly the "quiet" failure that script's own header warns about.
 *
 * WHAT ELSE IT COST. The 2026-08-15 import re-imported the same document under its AoN name,
 * `greater-chromatic-robe` — same `aonId`, the only same-`aonId` collision the import introduced —
 * and `findDuplicateIds` could not collapse the pair, because its identity test requires the two
 * halves to agree on price and this one disagreed by 10x. So the shop listed the robe twice. With the
 * price corrected the existing rule hides the hollow re-import on its own, and the record that keeps
 * listing is the modelled one (resistance 10 to acid/cold/electricity/fire, the Align Energy
 * activation, the mythic trait); the re-import carries none of that.
 *
 * The overlay is the only carrier that survives `npm run data`, so the value is written there as well
 * as into public/core.json.
 *
 *   node scripts/fix-chromatic-robe-price.mjs --dry
 *   node scripts/fix-chromatic-robe-price.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => path.join(ROOT, f);

const ID = 'chromatic-robe-greater';
const PRICE = { gp: 6500 };

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const rec = core.items?.[ID];
if (!rec) {
  console.error(`items/${ID} is not in public/core.json — nothing to correct`);
  process.exit(1);
}
console.log(`items/${ID}  "${rec.name}"  level ${rec.level}`);
console.log(`   price now: ${JSON.stringify(rec.price)}`);
console.log(`   AoN says:  ${JSON.stringify(PRICE)}  (equipment-4053-3738, 650000 cp)`);

if (DRY) {
  console.log('\n--dry: nothing written');
  process.exit(0);
}

rec.price = PRICE;
writeFileSync(p('public/core.json'), JSON.stringify(core));

const overlay = readBackfill(ROOT);
const hit = overlay.find((r) => r.category === 'items' && r.id === ID && r.field === 'price' && !r.path?.length);
if (hit) hit.value = PRICE;
else overlay.push({ category: 'items', id: ID, field: 'price', value: PRICE });
writeBackfill(ROOT, overlay);

console.log(`\noverlay row ${hit ? 'updated' : 'added'}`);
console.log('written: public/core.json, scripts/data/effect-backfill.json');
