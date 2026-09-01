/*
 * A REPEATABLE RECORD WHOSE PICK LIVES ON `effectChoices` IS BROKEN BY CONSTRUCTION.
 *
 * `effectChoices` answers are stored once per (record, choiceId) — one key for the whole record, not
 * one per taking. A record the player may take more than once therefore reads the SAME answer for
 * every take, so takes 2..N grant whatever take 1 granted, or nothing at all.
 *
 * The record's own `choice` is the per-TAKING lane: its answer rides on the taking, keyed by slot
 * (`choiceKeys(slotKey, def)`), which is why three takes of a `choice`-based feat give three answers.
 *
 * MEASURED: Wormskin (3 takes → 1 resistance) and Blessing of the Sun Gods (takes 2+ granted no domain
 * spell and no Focus Point) were found by hand in batches 13–14, and build.ts:4322 had already
 * documented the same limitation for the record LABEL without anyone noticing the grant behind it.
 * Batch 14's read then turned up four more in a single 100-record slice, which is what made it worth a
 * guard rather than six more one-off fixes.
 *
 * Reports only records whose option actually GRANTS something — a pick that merely records an answer
 * for a later conditional is not broken by sharing one key.
 *
 *   node scripts/repeatable-pick-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

/** `maxTakable: null` means unlimited; absent means 1; a number is that cap. */
const takes = (rec) => (rec?.maxTakable === null ? Infinity : (rec?.maxTakable ?? 1));

const bad = [];
let repeatable = 0;

for (const bucket of ['feats', 'classFeatures', 'heritages']) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    if (!rec || takes(rec) <= 1) continue;
    repeatable++;
    for (const ch of rec.effectChoices ?? []) {
      /* Only a GRANTING option is broken by the shared key. */
      const grants = (ch.options ?? []).some((o) => o.grant && Object.keys(o.grant).length);
      const openPick = !!ch.spellFilter;
      if (!grants && !openPick) continue;
      bad.push({
        where: `${bucket}/${id}`,
        choiceId: ch.id,
        takes: takes(rec) === Infinity ? 'unlimited' : takes(rec),
        what: openPick ? 'an open spell pick' : `options granting ${[...new Set((ch.options ?? []).flatMap((o) => Object.keys(o.grant ?? {})))].join(', ')}`,
      });
    }
  }
}

console.log(`${repeatable} repeatable record(s) checked.`);
if (!bad.length) {
  console.log('No repeatable record stores a granting pick on `effectChoices`.');
  process.exit(0);
}
console.log(`\nFAIL — ${bad.length} repeatable pick(s) share ONE stored answer across every taking:\n`);
for (const b of bad) {
  console.log(`   ${b.where}  (${b.takes} takes)`);
  console.log(`      effectChoices[${b.choiceId}] — ${b.what}`);
}
console.log(
  `\n   Move the pick to the record's own \`choice\` (per TAKING, keyed by slot) and carry the grant on` +
    `\n   its options. Add \`distinctAcrossTakes: true\` where the text says "a different X each time".`,
);
process.exit(1);
