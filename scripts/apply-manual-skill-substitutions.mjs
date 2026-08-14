/*
 * Writes ONLY the manual skill-substitution rows (scripts/lib/manual-skill-substitutions.mjs) into
 * public/core.json and scripts/data/effect-backfill.json.
 *
 * Why this exists as its own entry point: `backfill-skill-substitutions.mjs` re-derives EVERY row
 * from record descriptions, and those descriptions now live in public/core-descriptions.json — so a
 * run of it today reparses a near-empty corpus and rewrites rows it can no longer see. Repointing its
 * parser is a measured corpus-wide pass of its own. Until then this applier lands the hand-written
 * rows without touching the parsed ones, and `test/authoring-guards.test.ts` fails if the table and
 * the data ever disagree.
 *
 * Idempotent: the overlay row is replaced in place, exactly the way apply-degree-shifts.mjs does it.
 *
 * Run: node scripts/apply-manual-skill-substitutions.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';
import { MANUAL_SKILL_SUBSTITUTIONS } from './lib/manual-skill-substitutions.mjs';

const ROOT = process.cwd();
const CORE = 'public/core.json';
const DRY = process.argv.includes('--dry');

const raw = readFileSync(CORE, 'utf8');
const core = JSON.parse(raw);
/* public/core.json must stay MINIFIED, and a JSON round-trip is the only thing standing between this
 * script and a 9.8 MB reformat. Assert it byte-for-byte before writing anything. */
if (JSON.stringify(core) !== raw) {
  console.error('public/core.json does not round-trip through JSON.stringify — refusing to rewrite it.');
  process.exit(1);
}

const writes = [];
for (const [key, subs] of Object.entries(MANUAL_SKILL_SUBSTITUTIONS)) {
  const at = key.indexOf('/');
  const category = key.slice(0, at);
  const id = key.slice(at + 1);
  if (!core[category]?.[id]) { console.error(`${key}: names no record — refusing to write.`); process.exit(1); }
  for (const s of subs) {
    if (!s.when) { console.error(`${key}: a row with no \`when\` MOVES the skill's number; refusing.`); process.exit(1); }
  }
  writes.push({ category, id, field: 'skillSubstitutions', value: subs });
}

for (const w of writes) console.log(`${w.category}/${w.id}: ${w.value.map((s) => `${s.use}→${s.forSkill} (${s.when})`).join('; ')}`);
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

for (const w of writes) core[w.category][w.id][w.field] = w.value;
writeFileSync(CORE, JSON.stringify(core));

const overlay = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const w of writes) {
  const at = overlay.findIndex((x) => x.category === w.category && x.id === w.id && x.field === w.field && !x.path);
  if (at >= 0) { overlay[at].value = w.value; updated++; }
  else { overlay.push({ category: w.category, id: w.id, field: w.field, value: w.value }); added++; }
}
writeBackfill(ROOT, overlay);
console.log(`\noverlay: ${added} added, ${updated} refreshed (now ${overlay.length} rows)`);
console.log('written: public/core.json, scripts/data/effect-backfill.json');
