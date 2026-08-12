/**
 * AUTHORS THE LAST RECORD OF THE `mapReduction` LANE, and states the full measured set.
 *
 * Owner ruling Round 9: *"Multiple attack penalty — 4 records. Very important — build it. Flurry and
 * Agile Grace change the MAP progression itself (−3/−6 rather than −5/−10). `mapStep` is currently
 * fixed."* The engine half was already built (commit 6201fcf: `mapReduction` on the record,
 * `mapStepFor` in derive.ts). Measured, the lane is four records — the same four Foundry marks with
 * `MultipleAttackPenalty` over our live corpus, and the same four our own text yields when scanned
 * independently for a stated progression ("instead of −5 and −10", "rather than −4 and −8"):
 *
 *   classFeatures/flurry                    −3/−6, −2/−4 agile, against hunted prey   ALREADY AUTHORED
 *   classFeatures/masterful-hunter-flurry   −2/−4, −1/−2 agile, against hunted prey   ALREADY AUTHORED
 *   feats/agile-grace                       −3/−6 on agile only                       ALREADY AUTHORED
 *   feats/combination-finisher              −4/−8, −3/−6 agile, on FINISHER Strikes   ← this script
 *
 * Two class records (`classes/ranger`, `classFeatures/masterful-hunter`) restate Flurry inside the
 * hunter's-edge summary. Ruling A: an umbrella record gets no entries — the edge the character
 * actually owns is the one that carries the numbers.
 *
 * ── Why Combination Finisher is `appliesWhen` and not a number ───────────────────────────────────
 *
 * *"Your finishers' Strikes have a lower multiple attack penalty: −4 (or −3 with an agile weapon) …
 * instead of −5 and −10."* Whether a given Strike is part of a finisher is decided at the table, in
 * the moment — it is a fact about the action, not about the character, so no toggle on the sheet can
 * answer it. `whileState: 'panache'` was the tempting shape and is wrong: having panache is what lets
 * you MAKE a finisher, not proof that this Strike is one, so it would hand the player −4/−8 on every
 * ordinary Strike they take while flush. Over-granting the three numbers the strike row prints is a
 * worse error than not folding them in.
 *
 * So the reduction displays and moves nothing (`mapStepFor` skips it; `mapNotesFor` prints it in the
 * strike-attack breakdown with its condition). That is Ruling H's shape — print the trigger, star
 * nothing you cannot compute — and it matches how Q29 handled an aura whose numbers are conditional.
 *
 * ── How this does NOT compound with the agile trait ─────────────────────────────────────────────
 *
 * `mapStepFor` starts at 4-with-agile / 5-otherwise and takes the LOWEST printed candidate for that
 * agile-ness. It never subtracts. A record states its own two numbers ("−3 (or −4 with an agile
 * weapon)") and the matching one REPLACES the default, so agile can never be applied twice. Agile
 * Grace states `agileStep` only, which is why a greatsword in its owner's hands is still −5/−10.
 *
 * ── Where the values land ───────────────────────────────────────────────────────────────────────
 * public/core.json AND scripts/data/effect-backfill.json (the only overlay surviving `npm run data`),
 * written through scripts/lib/write-backfill.mjs.
 *
 * Run: node scripts/apply-map-progressions.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = process.cwd();
const p = (f) => join(ROOT, f);
const DRY = process.argv.includes('--dry');

const AUTHORED = {
  'feats/combination-finisher': {
    step: 4,
    agileStep: 3,
    note: 'Combination Finisher',
    appliesWhen: 'part of a finisher',
  },
};

/** Already carrying the field — asserted rather than rewritten, so a regression shows up here. */
const EXPECTED_EXISTING = {
  'classFeatures/flurry': { step: 3, agileStep: 2 },
  'classFeatures/masterful-hunter-flurry': { step: 2, agileStep: 1 },
  'feats/agile-grace': { agileStep: 3 },
};

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const rec = (key) => core[key.slice(0, key.indexOf('/'))]?.[key.slice(key.indexOf('/') + 1)];

for (const [key, expect] of Object.entries(EXPECTED_EXISTING)) {
  const got = rec(key)?.mapReduction;
  if (!got) throw new Error(`${key} lost its mapReduction — the lane is not what this script assumes`);
  for (const [f, v] of Object.entries(expect)) {
    if (got[f] !== v) throw new Error(`${key}.mapReduction.${f} is ${got[f]}, expected ${v}`);
  }
}

const writes = [];
for (const [key, value] of Object.entries(AUTHORED)) {
  const category = key.slice(0, key.indexOf('/'));
  const id = key.slice(key.indexOf('/') + 1);
  if (!core[category]?.[id]) { console.log(`NOT IN core.json: ${key}`); continue; }
  writes.push({ category, id, field: 'mapReduction', value });
}

console.log(`lane total: ${Object.keys(EXPECTED_EXISTING).length + writes.length} records`);
console.log(`  already authored: ${Object.keys(EXPECTED_EXISTING).join(', ')}`);
console.log(`  written now: ${writes.map((w) => `${w.category}/${w.id}`).join(', ') || '(none)'}`);
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

for (const w of writes) core[w.category][w.id][w.field] = w.value;
writeFileSync(p('public/core.json'), JSON.stringify(core));

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
