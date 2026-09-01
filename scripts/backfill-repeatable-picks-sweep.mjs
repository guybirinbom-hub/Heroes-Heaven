/*
 * THE REPEATABLE PICKS, MOVED FROM PER-RECORD TO PER-TAKING — the whole enumerated remainder.
 *
 * An `effectChoices` answer is stored once per (record, choiceId). On a feat the player may take more
 * than once, every taking reads the SAME answer, so takes 2..N grant whatever take 1 granted — the
 * player pays a feat and receives a duplicate. The record's own `choice` is keyed by SLOT, which is
 * what makes a second taking a second answer.
 *
 * EVERY ONE OF THESE HAD ITS SPECIAL CLAUSE READ (scripts/repeatable-pick-plan.mjs prints them), and
 * all 21 say the same thing — *"choosing a different sense each time"*, *"you must select a different
 * advanced domain spell"*, *"gaining the focus spell you didn't gain the first time"*. That is what
 * earns `distinctAcrossTakes` here, and it is NOT a rule that can be assumed: Greater Animal Senses,
 * migrated earlier, explicitly permits repeating an answer to upgrade it, and marking it distinct would
 * have forbidden half of what it prints. Bulk-migrating on one assumed rule is exactly what failed the
 * first time this was attempted.
 *
 * ⚠ FOUR RECORDS ARE DELIBERATELY NOT HERE. Qi Spells, Grandmaster Qi Spells, Esoteric Spellcasting and
 * Greater Esoteric Spellcasting hold OPEN spell picks (`spellFilter`), which only `effectChoices` can
 * express — `choice` has no such field — and the last two already use their `choice` for the tradition.
 * Those need the answer KEY to become per-taking rather than the lane to move, which is a separate
 * change; migrating them here would mean deleting a picker with nowhere to go.
 *
 *   node scripts/backfill-repeatable-picks-sweep.mjs           # report
 *   node scripts/backfill-repeatable-picks-sweep.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

/** id → the flag its per-taking choice is stored under. Every one printed "a different X each time". */
const MIGRATE = {
  'animal-senses': 'animalSense',
  'natural-senses': 'naturalSense',
  'advanced-seeker-of-truths': 'seekerAdvancedDomain',
  'greater-sun-blessing': 'sunBlessingDomain',
  'hallowed-initiate': 'hallowedInitiateSpell',
  'advanced-hallowed-spell': 'advancedHallowedSpell',
  'deathly-secrets': 'deathlySecret',
  'greater-deathly-secrets': 'greaterDeathlySecret',
  'advanced-domain': 'advancedDomain',
  'initiate-warden': 'initiateWardenSpell',
  'advanced-warden': 'advancedWardenSpell',
  'masterful-warden': 'masterfulWardenSpell',
  'peerless-warden': 'peerlessWardenSpell',
  'primal-guardian': 'primalGuardianSpell',
  'nights-glow': 'nightsGlowSpell',
  'nights-shine': 'nightsShineSpell',
  'chronomancers-secrets': 'chronomancerSpell',
  'libertys-promise': 'libertyDomain',
  'libertys-devotion': 'libertyAdvancedDomain',
  'holy-bloom': 'holyBloomDomain',
  'holy-flower': 'holyFlowerDomain',
};

const rows = [];
for (const [id, flag] of Object.entries(MIGRATE)) {
  const bucket = ['feats', 'classFeatures', 'heritages'].find((b) => core[b]?.[id]);
  if (!bucket) { console.error(`${id}: not in core.json`); process.exit(2); }
  const rec = core[bucket][id];

  /* Idempotent: once migrated, the record has the `choice` and no `effectChoices` left to lift. */
  if (rec.choice?.flag === flag && !rec.effectChoices?.length) continue;

  const defs = (rec.effectChoices ?? []).filter((ec) => (ec.options ?? []).some((o) => o.grant && Object.keys(o.grant).length));
  if (defs.length !== 1) { console.error(`${id}: expected exactly 1 grant-bearing pick, found ${defs.length}`); process.exit(2); }
  if (rec.choice) { console.error(`${id}: already has its own \`choice\` — needs the per-taking KEY, not this lane`); process.exit(2); }
  const def = defs[0];
  const options = def.options ?? [];
  if (!options.length) { console.error(`${id}: no options to carry`); process.exit(2); }

  rows.push({
    category: bucket,
    id,
    field: 'choice',
    value: { flag, prompt: def.prompt, kind: 'array', distinctAcrossTakes: true, options },
  });
  /* `value: null` REMOVES the field — leaving it would be a second picker asking the same question and
   * quietly overwriting itself, which is the two-pickers defect ruling Q9 names. */
  rows.push({ category: bucket, id, field: 'effectChoices', value: null });
}

console.log(`${rows.length / 2} record(s) to migrate.`);
for (const r of rows.filter((x) => x.field === 'choice')) console.log(`  ${r.category}/${r.id.padEnd(28)} ${r.value.options.length} options, distinct across takes`);
if (!rows.length) console.log('  (all already migrated)');

if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }

const all = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of rows) {
  const at = all.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { all[at] = row; replaced++; } else { all.push(row); added++; }
}
writeBackfill(ROOT, all);
console.log(`\nwrote ${added} new row(s), ${replaced} replaced (${all.length} rows total).`);
