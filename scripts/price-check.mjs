/*
 * ITEM PRICES, against the AoN mirror.
 *
 * The mirror's `price` field is in COPPER — Pickled Demon Tongue 6000 = 60 gp, Lifting Belt 8000 =
 * 80 gp — and the app agreed with it on 7,538 of 7,572 items. The 34 that disagreed were real: eight
 * cost exactly 10x too much, one 10x too little, Rusting Ammunition (Greater) had inherited the
 * moderate grade's price, and five items were free.
 *
 * A wrong price is quiet. Nothing crashes, no test fails, and the player just buys the wrong thing —
 * which is why this is worth a standing check rather than a one-off pass.
 *
 *   node scripts/price-check.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/equipment';
const db = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));

/**
 * Deliberate disagreements, each with the reason. An entry here is a claim that the MIRROR is wrong,
 * so it carries its evidence.
 */
const ACCEPTED = {
  // The mirror's structured field has the two grades transposed — its "greater" costs more than its
  // "major". The printed ladder is 975 / 14,000 / 65,000 gp ascending, which is what the app has.
  'judgment-thurible-greater': 'mirror field transposes greater and major; printed ladder ascends',
  'judgment-thurible-major': 'mirror field transposes greater and major; printed ladder ascends',
  // Two different items share this name. The app's record is the GM Core intelligent shield, which
  // prints no Price line at all; the Hellbreakers one is `martyrs-shield-hellbreakers` at 360 gp.
  'martyrs-shield': 'the app record is the GM Core intelligent shield, which prints no price',
};

const copper = (p) => (p?.pp ?? 0) * 1000 + (p?.gp ?? 0) * 100 + (p?.sp ?? 0) * 10 + (p?.cp ?? 0);
const norm = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const byName = new Map();
/**
 * …and by DOCUMENT ID, which is the only identifier that cannot collide.
 *
 * A name lookup picks one document per name, and Archives of Nethys has more than one document under
 * plenty of names. Both of the "unexplained" disagreements this script reported after the 2026-08-15
 * import were that, and in both the app was right:
 *
 *   Tales in Timber  equipment-2648 (85,000 cp — ours)   vs equipment-2648-2437 (100,000 cp)
 *   Dragon Pearl     equipment-4011 (900,000 cp — ours, Draconic Codex, level 16)
 *                                                        vs equipment-3482 (18,000 cp, Tian Xia, level 10)
 *
 * The second pair is not even the same item — two unrelated treasures that share a name across two
 * books — and reporting it as a 50x price error is the checker being wrong, loudly, about correct
 * data. Our records carry `aonId`; when they do, the document they name is the one to compare
 * against, and the name index is only the fallback for records that have none.
 */
const byDocId = new Map();
for (const f of readdirSync(MIRROR)) {
  const j = JSON.parse(readFileSync(join(MIRROR, f), 'utf8'));
  if (typeof j.price !== 'number') continue;
  if (j.id) byDocId.set(String(j.id), j);
  if (!j.name) continue;
  const k = norm(j.name);
  const prev = byName.get(k);
  // A record carrying `remaster_id` is the LEGACY half of a pair; prefer the remaster one.
  if (!prev || (prev.remaster_id && !j.remaster_id)) byName.set(k, j);
}

let compared = 0;
const bad = [];
const accepted = [];
for (const [id, rec] of Object.entries(db.items ?? {})) {
  if (!rec?.name || !rec.price) continue;
  /*
   * The document this record IS, before the document that merely shares its name — but ONLY when
   * that document also carries the same name.
   *
   * A grade record's `aonId` is often the FAMILY PAGE rather than its own block, so trusting the id
   * alone compares "Thieves' Tools (Concealable)" at 80 gp against the 3 gp base toolkit's page and
   * calls it a 26x error. Requiring the name to agree keeps the whole benefit — it is what separates
   * the two Dragon Pearls, which share a name and differ in id — while never reaching a parent.
   */
  const byId = rec.aonId ? byDocId.get(String(rec.aonId)) : undefined;
  const m = byId && byId.name && norm(byId.name) === norm(rec.name) ? byId : byName.get(norm(rec.name));
  if (!m) continue;
  compared++;
  const app = copper(rec.price);
  if (app === m.price) continue;
  (ACCEPTED[id] ? accepted : bad).push({ id, app, aon: m.price, why: ACCEPTED[id] });
}

console.log(`compared against the mirror: ${compared} items`);
console.log(`accepted disagreements: ${accepted.length}`);
for (const a of accepted) console.log(`   ${a.id.padEnd(30)} app ${a.app} cp / mirror ${a.aon} cp — ${a.why}`);
console.log(`\nUNEXPLAINED: ${bad.length}`);
for (const b of bad) {
  const ratio = b.aon ? (b.app / b.aon).toFixed(3) : 'n/a';
  console.log(`   ${b.id.padEnd(34)} app ${String(b.app).padStart(9)} cp   mirror ${String(b.aon).padStart(9)} cp   x${ratio}`);
}
if (bad.length) process.exitCode = 1;
