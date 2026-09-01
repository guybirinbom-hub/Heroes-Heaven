/*
 * THE REPEATABLE PICKS THAT STILL SHARE ONE STORED ANSWER — with the clause that decides each one.
 *
 * `scripts/repeatable-pick-check.mjs` says WHICH records are wrong. It cannot say what the fix is,
 * because the fix turns on the record's own Special clause and those do not agree:
 *
 *   "…gaining the focus spell you didn't gain the first time"   → distinctAcrossTakes
 *   "…either choosing a different sense OR IMPROVING an imprecise sense granted by this feat"
 *                                                               → NOT distinct; repeating is legal,
 *                                                                 and the upgrade needs its own option
 *
 * Migrating them all on one rule is what went wrong the first time this was attempted: 25 records were
 * rewritten in bulk, twelve guards caught it, and the revert was itself lossy. So this prints the
 * evidence for a per-record decision instead of making one.
 *
 *   node scripts/repeatable-pick-plan.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');

const takes = (r) => (r.maxTakable === null ? 'unlimited' : `${r.maxTakable} takes`);

let n = 0;
for (const bucket of ['feats', 'classFeatures', 'heritages']) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    if (!rec || (rec.maxTakable !== null && !(rec.maxTakable > 1))) continue;
    const defs = (rec.effectChoices ?? []).filter(
      (ec) => ec.spellFilter || (ec.options ?? []).some((o) => o.grant && Object.keys(o.grant).length),
    );
    if (!defs.length) continue;

    const d = String(descs[bucket]?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const at = d.search(/\*\*Special\*\*/);
    const special = at >= 0 ? d.slice(at, at + 300) : '(no Special clause printed)';

    n++;
    console.log(`### ${bucket}/${id}  (${takes(rec)})`);
    console.log(`  picks: ${defs.map((x) => `${x.id} [${(x.options ?? []).length} opts${x.spellFilter ? ', open spell pick' : ''}]`).join(' | ')}`);
    console.log(`  own \`choice\`: ${rec.choice ? `yes — flag ${rec.choice.flag}, ${(rec.choice.options ?? []).length} opts` : 'no'}`);
    console.log(`  SPECIAL: ${special}`);
    console.log();
  }
}
console.log(`${n} repeatable record(s) whose grant-bearing pick is stored per RECORD.`);
