/**
 * GIANT'S LUNGE COMBINES WITH SIZE — the third clause of its text, which no field could say.
 *
 * Verified defect (`scripts/audit/authored-verification.json`, `feats/giants-lunge`,
 * field `strikeReach.feet`). The printed text is:
 *
 *   "Until your rage ends, all your melee weapons and unarmed attacks gain a reach of 10 feet. This
 *    doesn't increase the reach of any weapon or unarmed attack that already has the reach trait,
 *    **but it does combine with abilities that increase your reach due to increased size, such as
 *    Giant's Stature.**"
 *
 * Sentence one was authored (`feet: 10`), sentence two was authored (`match.excludeTraits: ['reach']`),
 * sentence three could not be: a stated `feet` WINS over `add` by design, so a raging giant-instinct
 * barbarian holding both feats saw two separate 10-ft rows and never the 15 ft the rule gives.
 * Reproduced before the fix, not inferred.
 *
 * ⚠ THE TEMPTING WRONG FIX is re-authoring Giant's Lunge as `add: 5`. It would combine, and it would
 * be wrong: "gain a reach of 10 feet" is a stated reach, so `add: 5` gives 15 ft to a character
 * already reaching 10 (Jotun's Heart, a minotaur), and 8 ft to one reaching 3. The value is right; the
 * FIELD could not express the clause. So the lane was built — `ReachRider.combinesWithSize` names the
 * clause, `ReachRider.fromSize` names what it combines with — and this script authors both.
 *
 * ── Which riders are `fromSize`, read one by one from our own text ───────────────────────────────
 *   giants-stature       "You become Large, increasing your reach by 5 feet"                    ✓
 *   titans-stature       "you can instead become Huge (increasing your reach by 10 feet…)"      ✓
 *   towering-presence    "Increase your size to Large… Your reach increases by 5 feet"          ✓
 *   assume-earths-mantle "You become Large if you were smaller. This increases your reach by 5" ✓
 *   instinct-crown-giant "you become Large… Increase your reach by 5 feet"                      ✓
 *
 * EXCLUDED, each for a stated reason rather than taste:
 *   • greater-transformation — "While in your oni form, your reach increases by 5 feet." Oni Form's
 *     own text says *"Your size increases to Large… This doesn't change your Speed, reach, or other
 *     statistics except as noted here"*, so the +5 is a benefit of the FEAT, not a consequence of the
 *     size. Marking it would make our data claim something our text denies.
 *   • vessels-form — "you become Large, and your reach increases TO 10 feet". Size-driven, but it
 *     states a reach rather than an increase, so there is no increment to combine and any number
 *     invented here would be ours rather than the book's.
 *   • miniaturization-module — `feet: 0` while Tiny is a size DECREASE; the clause says "increase".
 *
 * ── Which riders are `combinesWithSize` ──────────────────────────────────────────────────────────
 * ONE: giants-lunge. The other three `feet: 10` riders in the file were read for the same clause and
 * none prints it — Stretching Reach and Jotun's Battle Stance both say only "the weapon gains a reach
 * of 10 feet", and Grasping Reach "Weapons wielded in your extended grasp gain reach of 10 feet".
 *
 * Where the values land: public/core.json (so the app sees them now) AND
 * scripts/data/effect-backfill.json — the ONLY overlay that survives `npm run data` — written through
 * scripts/lib/write-backfill.mjs.
 *
 * Run: node scripts/apply-reach-size-combination.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = process.cwd();
const p = (f) => join(ROOT, f);
const DRY = process.argv.includes('--dry');

/**
 * `id → { collection, flag, quote }`. The quote is the sentence the flag was read from, normalised to
 * a fragment that must still be present in the shipped description — a flag with no quote is a guess,
 * and a guess here changes a number on the Strike row.
 */
const MARKS = {
  'giants-lunge': {
    collection: 'feats',
    flag: 'combinesWithSize',
    quote: 'it does combine with abilities that increase your reach due to increased size',
  },
  'giants-stature': { collection: 'feats', flag: 'fromSize', quote: 'You become Large, increasing your reach by 5 feet' },
  'titans-stature': { collection: 'feats', flag: 'fromSize', quote: 'become Huge (increasing your reach by 10 feet' },
  'towering-presence': { collection: 'feats', flag: 'fromSize', quote: 'Your reach increases by 5 feet' },
  'assume-earths-mantle': { collection: 'feats', flag: 'fromSize', quote: 'This increases your reach by 5 feet' },
  'instinct-crown-giant': { collection: 'items', flag: 'fromSize', quote: 'Increase your reach by 5 feet' },
};

/** Riders read and deliberately left unmarked, asserted so a later import cannot quietly join them. */
const NOT_FROM_SIZE = ['greater-transformation', 'vessels-form'];
const NOT_COMBINING = ['stretching-reach', 'jotuns-battle-stance', 'grasping-reach'];

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const desc = JSON.parse(readFileSync(p('public/core-descriptions.json'), 'utf8'));

const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};
const textOf = (collection, id) => String(desc[collection]?.[id]?.d ?? core[collection]?.[id]?.description ?? '').replace(/\s+/g, ' ');
const norm = (s) => s.replace(/[’']/g, "'").toLowerCase();

/* ------------------------------------------------------------------------------ verification --- */

for (const [id, { collection, quote }] of Object.entries(MARKS)) {
  const rec = core[collection]?.[id];
  if (!rec) fail(`${collection}/${id} is not in core.json`);
  if (!rec.strikeReach) fail(`${collection}/${id} carries no strikeReach — the flag would be read by nothing`);
  if (!norm(textOf(collection, id)).includes(norm(quote))) fail(`${collection}/${id}: its text no longer contains "${quote}"`);
}

// The exclusions, measured rather than asserted: each of these five carries a strikeReach rider and
// must still fail the clause test, or the reading above has gone stale.
for (const id of NOT_FROM_SIZE) {
  if (!core.feats[id]?.strikeReach) fail(`${id} has no strikeReach — the exclusion list is stale`);
  if (core.feats[id].strikeReach.fromSize) fail(`${id} is marked fromSize but was excluded by reading its text`);
}
for (const id of NOT_COMBINING) {
  const r = core.feats[id]?.strikeReach;
  if (!r) fail(`${id} has no strikeReach — the exclusion list is stale`);
  if (norm(textOf('feats', id)).includes('combine')) fail(`${id}'s text now mentions combining — re-read it`);
}

/* ----------------------------------------------------------------------------------- writes ---- */

const writes = [];
for (const [id, { collection, flag }] of Object.entries(MARKS)) {
  const current = core[collection][id].strikeReach;
  if (Array.isArray(current)) fail(`${collection}/${id} carries several riders; this script writes one`);
  writes.push({ category: collection, id, field: 'strikeReach', value: { ...current, [flag]: true } });
}

console.log(`${writes.length} reach riders flagged:`);
for (const w of writes) console.log(`  ${w.category}/${w.id} → ${JSON.stringify(w.value)}`);

if (DRY) {
  console.log('\n--dry: nothing written');
  process.exit(0);
}

for (const w of writes) core[w.category][w.id][w.field] = w.value;
writeFileSync(p('public/core.json'), JSON.stringify(core));

// Absolute assignments, replaced in place, so re-running is idempotent.
const overlay = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const w of writes) {
  const at = overlay.findIndex((x) => x.category === w.category && x.id === w.id && x.field === w.field && !x.path);
  if (at >= 0) {
    overlay[at].value = w.value;
    updated++;
  } else {
    overlay.push({ category: w.category, id: w.id, field: w.field, value: w.value });
    added++;
  }
}
writeBackfill(ROOT, overlay);
console.log(`\noverlay: ${added} added, ${updated} refreshed (now ${overlay.length} rows)`);
console.log('written: public/core.json, scripts/data/effect-backfill.json');
