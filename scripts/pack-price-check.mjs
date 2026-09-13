/*
 * AMMUNITION PACK COUNTS, against the AoN mirror.
 *
 * The Archives price and weigh ammunition BY THE PACK: Arrows read "1 sp (price for 10)" with "Bulk L",
 * and Player Core p. 277 has an ammunition entry list "only the name, quantity, Price, and Bulk" — both
 * numbers are the bundle's. Nothing in the structured fields marks that (price_cp is 10 and bulk_num is
 * 0.1, exactly as they would be if one arrow cost a silver and weighed Light), so the importer parses
 * the count out of `price_raw` and records it as `packOf`. Twenty-five mirror documents carry the
 * phrase, in two wordings: "(price for 10)" and "(price for 5 bolts)".
 *
 * A missing `packOf` is quiet in exactly the way a wrong price is: nothing crashes, no test fails, and
 * the player is charged ten times over and carries ten times the Bulk for a quiver of arrows. The field
 * is produced at the END of scripts/import-core-v2.mjs and nothing later in `npm run data` rebuilds an
 * item record, so it either survives the whole chain or this goes red.
 *
 * Both directions are checked: a pack document's record must carry the count the page prints, and no
 * record may carry a count no document prints.
 *
 *   node scripts/pack-price-check.mjs [path/to/core.json]
 *
 * The optional path is for checking a candidate core.json without replacing the shipped one — how the
 * importer's pack pass was confirmed before a regen was allowed to run.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { packOf } from './lib/aon-facets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
// Only a doc that can become an ITEM can be a pack, so only the item categories are read — the same
// seven scripts/import-core-v2.mjs maps into the `items` bucket. All 25 pack docs live in two of them.
const CATS = ['equipment', 'weapon', 'armor', 'shield', 'relic', 'set-relic', 'class-kit'];

const CORE = process.argv[2] || join(root, 'public/core.json');
const db = JSON.parse(readFileSync(CORE, 'utf8'));
const norm = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/*
 * Indexed the way scripts/price-check.mjs indexes: by DOCUMENT ID first, because a name collides and an
 * id cannot, with the name index as the fallback for records carrying no `aonId`. EVERY item document is
 * indexed, not only the packs — a record whose aonId names a real non-pack document must be able to beat
 * a same-named pack rather than inherit its count.
 */
const byDocId = new Map();
const byName = new Map();
let docs = 0;
for (const cat of CATS) {
  let files;
  try { files = readdirSync(join(MIRROR, cat)); } catch { continue; }
  for (const f of files) {
    let j;
    try { j = JSON.parse(readFileSync(join(MIRROR, cat, f), 'utf8')); } catch { continue; }
    if (!j?.name) continue;
    docs++;
    const entry = { id: j.id, name: j.name, n: packOf(j) };
    if (j.id) byDocId.set(String(j.id), entry);
    const k = norm(j.name);
    const prev = byName.get(k);
    // A record carrying `remaster_id` is the LEGACY half of a pair; prefer the remaster one.
    if (!prev || (prev.remaster_id && !j.remaster_id)) byName.set(k, entry);
  }
}
const packDocs = [...byDocId.values()].filter((d) => d.n).length;
// A guard that passes because its evidence is missing is worse than no guard. 25 documents price a
// pack today; a mirror that suddenly prices none is a broken mirror path, not a clean bill of health.
if (!packDocs) {
  console.error(`no document under ${MIRROR} prices a pack — the mirror is missing or moved, so this check proved nothing.`);
  process.exit(1);
}

let carried = 0;
const missing = [];   // the mirror prints a pack count; the record has none, or a different one
const unexpected = []; // the record claims a pack count no document prints
for (const [id, rec] of Object.entries(db.items ?? {})) {
  if (!rec?.name) continue;
  const byId = rec.aonId ? byDocId.get(String(rec.aonId)) : undefined;
  const m = byId && byId.name && norm(byId.name) === norm(rec.name) ? byId : byName.get(norm(rec.name));
  const want = m?.n ?? 0;
  const got = typeof rec.packOf === 'number' ? rec.packOf : 0;
  if (want && got === want) { carried++; continue; }
  if (want) missing.push({ id, name: rec.name, doc: m.id, want, got });
  else if (got) unexpected.push({ id, name: rec.name, doc: rec.aonId ?? '-', got });
}

console.log(`mirror item documents read: ${docs} (${packDocs} price a pack)`);
console.log(`core.json items carrying the right packOf: ${carried}`);

if (missing.length) {
  console.log(`\nMISSING or WRONG packOf: ${missing.length}`);
  for (const b of missing) {
    console.log(`   ${b.id.padEnd(36)} ${String(b.doc).padEnd(16)} page says ${String(b.want).padStart(3)}   record has ${b.got || 'nothing'}`);
  }
}
if (unexpected.length) {
  console.log(`\npackOf WITHOUT a page that prints one: ${unexpected.length}`);
  for (const b of unexpected) {
    console.log(`   ${b.id.padEnd(36)} ${String(b.doc).padEnd(16)} record has ${b.got}`);
  }
}
if (missing.length || unexpected.length) {
  console.log('\nThe price and the Bulk stay the PACK\'s values — packOf is the count they cover, not a divisor');
  console.log('applied to them. It is written at the end of scripts/import-core-v2.mjs; re-run `npm run data`.');
  process.exitCode = 1;
} else {
  console.log('\nevery ammunition pack in core.json states the count its page prices.');
}
