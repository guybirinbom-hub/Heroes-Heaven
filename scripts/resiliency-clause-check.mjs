/*
 * GUARD: "3 ADDITIONAL HIT POINTS FOR EACH <CLASS> ARCHETYPE CLASS FEAT" MUST SCALE, NOT SIT FLAT.
 *
 * The three Resiliency feats print it — *"You gain 3 additional Hit Points for each monk archetype
 * class feat you have. As you continue selecting monk archetype class feats, you continue to gain
 * additional Hit Points in this way."* — and Wanderer's Guide stores a flat 3 that never grows, on the
 * wrong record. Owner ruling 2026-08-22: the book wins, and *"in the future there will be more
 * resiliency feats — make sure we don't make a mistake"*. This is that guard: it reads the CLAUSE, not
 * a list of the three current ids, so a fourth Resiliency arriving in a data refresh is caught the
 * moment it ships without the scaling field.
 *
 * FAILS when a feat prints the per-archetype-feat sentence and its `maxHpBonus.perArchetypeFeat` is
 * absent or disagrees with the printed number — or when it carries a flat bonus instead, which is the
 * exact wrong shape WG holds.
 *
 *   node scripts/resiliency-clause-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');

const CLAUSE = /gain (\d+) additional Hit Points for each [a-z' -]+ archetype class feat/i;

const bad = [];
let found = 0;
for (const bucket of ['feats', 'classFeatures']) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    const d = String(descs[bucket]?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m = CLAUSE.exec(d);
    if (!m) continue;
    found++;
    const printed = Number(m[1]);
    const per = rec?.maxHpBonus?.perArchetypeFeat;
    if (per !== printed) {
      bad.push(`${bucket}/${id} — prints "${m[0]}" but maxHpBonus.perArchetypeFeat is ${per ?? 'absent'}`);
    } else if (rec?.maxHpBonus?.flat) {
      bad.push(`${bucket}/${id} — carries BOTH the scaling field and a flat ${rec.maxHpBonus.flat}, which double-pays`);
    }
  }
}

console.log(`${found} record(s) print the per-archetype-feat Hit Point clause.`);
if (!bad.length) {
  console.log('resiliency-clause: ok — every one scales as printed.');
  process.exit(0);
}
console.log(`\nresiliency-clause: FAIL — ${bad.length} record(s):\n`);
for (const b of bad) console.log(`   ${b}`);
process.exit(1);
