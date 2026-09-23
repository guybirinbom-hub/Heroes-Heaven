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
  /*
   * `martyrs-shield` was here too, for the GM Core intelligent shield that prints no Price line. The
   * acceptance is retired: the record now IS the Hellbreakers shield (equipment-4193, 360 gp, which is
   * what it ships) and agrees with the mirror exactly, so the entry could never fire again. The
   * stale-acceptance test below is what said so — it is the same silent retirement that took the
   * Judgment Thurible's ladder.
   */
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

/*
 * AN ACCEPTANCE THAT STOPS FIRING IS A RULING THAT HAS BEEN SILENTLY UNDONE.
 *
 * Every entry in ACCEPTED says "the mirror is wrong here and the app is deliberately different". The
 * loop above only ever notices a DISAGREEMENT, so the day the app starts agreeing with the mirror the
 * entry simply goes quiet — the ruling is gone and this script reports a clean run. That is how
 * `judgment-thurible-greater` and `-major` had their printed ladder (14,000 / 65,000 gp ascending)
 * replaced by the mirror's transposed one without a single guard going red.
 *
 * So the acceptance is checked in BOTH directions: an id that no longer disagrees is a failure here
 * until somebody removes it from the map on purpose.
 */
const stale = Object.keys(ACCEPTED).filter((id) => db.items?.[id] && !accepted.some((a) => a.id === id));

/*
 * …and the PF2e grade ladder, which is always ascending: lesser ≤ moderate ≤ greater ≤ major ≤ true,
 * in level and in price. The family base is left out — it is often a priceless summary page.
 *
 * This is the invariant the transposition broke, and it is the one thing that can catch an Archives
 * labelling error without a second printing to compare against.
 */
const GRADES = ['lesser', 'moderate', 'greater', 'major', 'true'];
/** Families whose ladder the ARCHIVES THEMSELVES print out of order, with the evidence. */
const ACCEPTED_LADDER = {
  // equipment-2665-2454 "(Major)" repeats the BASE page's Item 4 / 100 gp; the Greater is Item 8 /
  // 475 gp. The mirror carries no higher figure anywhere, so there is nothing to correct it to.
  'spore-shepherds-staff': 'AoN sub-doc equipment-2665-2454 repeats the base level and price',
  'spore-shephards-staff': 'spelling twin of spore-shepherds-staff; same AoN defect',
  // equipment-2784-2569 "(major)" prints 210 gp against the greater's 215 gp (equipment-2784-2568) —
  // a digit, not a ladder. Both levels ascend (11 -> 17), so only the price inverts.
  steelscour: 'AoN sub-doc equipment-2784-2569 prints 210 gp against the greater\'s 215 gp',
};
const families = new Map();
for (const [id, rec] of Object.entries(db.items ?? {})) {
  const i = GRADES.findIndex((g) => id.endsWith(`-${g}`));
  if (i < 0) continue;
  const base = id.slice(0, -(GRADES[i].length + 1));
  if (!families.has(base)) families.set(base, []);
  families.get(base).push({ id, rank: i, rec });
}
const inverted = [];
for (const [base, members] of families) {
  if (members.length < 2 || ACCEPTED_LADDER[base]) continue;
  members.sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < members.length; i++) {
    const lo = members[i - 1], hi = members[i];
    if (typeof lo.rec.level === 'number' && typeof hi.rec.level === 'number' && hi.rec.level < lo.rec.level) {
      inverted.push(`${hi.id} is level ${hi.rec.level}, below ${lo.id} at ${lo.rec.level}`);
    }
    if (lo.rec.price && hi.rec.price && copper(hi.rec.price) < copper(lo.rec.price)) {
      inverted.push(`${hi.id} costs ${copper(hi.rec.price)} cp, below ${lo.id} at ${copper(lo.rec.price)} cp`);
    }
  }
}

console.log(`compared against the mirror: ${compared} items`);
console.log(`accepted disagreements: ${accepted.length}`);
for (const a of accepted) console.log(`   ${a.id.padEnd(30)} app ${a.app} cp / mirror ${a.aon} cp — ${a.why}`);
console.log(`\nUNEXPLAINED: ${bad.length}`);
for (const b of bad) {
  const ratio = b.aon ? (b.app / b.aon).toFixed(3) : 'n/a';
  console.log(`   ${b.id.padEnd(34)} app ${String(b.app).padStart(9)} cp   mirror ${String(b.aon).padStart(9)} cp   x${ratio}`);
}
console.log(`\nACCEPTANCES THAT NO LONGER FIRE: ${stale.length}`);
for (const id of stale) console.log(`   ${id.padEnd(34)} now agrees with the mirror — the ruling "${ACCEPTED[id]}" is gone`);
console.log(`\ngrade ladders checked: ${[...families.values()].filter((m) => m.length > 1).length}  (${Object.keys(ACCEPTED_LADDER).length} accepted as AoN's own defect)`);
console.log(`INVERTED LADDERS: ${inverted.length}`);
for (const line of inverted) console.log(`   ${line}`);
if (bad.length || stale.length || inverted.length) process.exitCode = 1;
