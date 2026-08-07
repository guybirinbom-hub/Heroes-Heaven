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
for (const f of readdirSync(MIRROR)) {
  const j = JSON.parse(readFileSync(join(MIRROR, f), 'utf8'));
  if (!j.name || typeof j.price !== 'number') continue;
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
  const m = byName.get(norm(rec.name));
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
