/**
 * AUTHORS THE `specialStatistic` LANE, and closes the DATA half of the secondary-class-DC lane.
 *
 * Owner ruling Round 9: *"Special statistic — 9 records. Very important — build it. A named statistic
 * with its own DC that is not a save, a skill or the class DC. Gunslinger Dedication needs a secondary
 * class DC for a class the character does not have."*
 *
 * ── What counts as a special statistic, and what turned out to be an existing stat renamed ───────
 *
 * The evidence set was Foundry's 9 `SpecialStatistic` rule elements over our live feats + class
 * features (scripts/audit/lane-gaps.json), reproduced exactly, then read against OUR OWN text — the
 * same method the aura lane used, and for the same reason: Foundry's prose is never a source, and its
 * silence carries no information either way.
 *
 * The test a record has to pass: **our own text NAMES a statistic the player rolls (or whose DC an
 * opponent beats), AND the number is not already printed on the sheet under another label.**
 *
 * IN (authored below):
 *   • the kineticist IMPULSE ATTACK ROLL. Our text states the whole formula on the Impulses class
 *     feature — "uses the same proficiency and attribute modifier as your kineticist class DC…
 *     typically 10 lower than your class DC" — 18 impulse feats say "Make an impulse attack roll",
 *     and a *gate attenuator* gives it an item bonus "(but not to your impulse DC)", which makes it
 *     provably a different number from any row the sheet had. Nothing in src/ derived it.
 *   • Kineticist Dedication, which grants the same statistic to an archetype kineticist in the same
 *     sentence as the borrowed class DC.
 *   • SCROLL THAUMATURGY — the shape the owner named second. It binds an existing statistic to a
 *     thing that has no row: "using your thaumaturge class DC for the scroll's DC". The player
 *     holding a scroll has nowhere else to read that number off.
 *
 * OUT, each for a stated reason rather than taste:
 *   • THE 16 ARCHETYPE CLASS DCs, Gunslinger Dedication included. This is the owner's clearest case
 *     and it is **an existing stat under another name** — the class DC of a class you do not have,
 *     and the app has had a lane for it all along: `classDcGrant` → `secondaryClassDcs` (build.ts) →
 *     the "Multiclass DCs" rail card. Gunslinger Dedication already carried the field. What was
 *     actually wrong is DATA: 9 dedications that print the clause carried nothing, and one rank
 *     upgrade pointed at a dedication that granted nothing. Those are written below.
 *   • EXPERT KINETIC CONTROL ("expert in kineticist class DC and impulse attack rolls") — it raises
 *     a rank, and it already carries `classDcRank`. Because the impulse attack roll is defined
 *     against the kineticist class DC rather than a track of its own, it follows automatically. A
 *     second entry here would be a second rank track for one printed rule.
 *   • KINETIC ACTIVATION, ALCHEMICAL POWER, INTENSIFY INVESTITURE — each points the player at a
 *     statistic that already has a row ("you can substitute your impulse attack roll or class DC").
 *     Printing the same number a third time under a third name is exactly the failure the owner asked
 *     to guard against.
 *   • THE 6 DEVIANT CLASSIFICATIONS, which are 6 of Foundry's 9. Foundry gives them a `deviant`
 *     statistic extending the class DC. **Our own text never names one** — not the classification
 *     records, not the deviant feats ("Make a ranged attack roll against a creature within 30 feet"),
 *     and not AoN's five Dark Archive rules pages, read from the local archive. Building a number
 *     from Foundry's rule element alone would be importing another implementation's ruling.
 *
 * ── Where the values land ───────────────────────────────────────────────────────────────────────
 * public/core.json (so the app sees them now) AND scripts/data/effect-backfill.json — the ONLY
 * overlay that survives `npm run data` — written through scripts/lib/write-backfill.mjs. Writing it
 * by hand reformats all 6,841 rows into an unreviewable diff.
 *
 * Run: node scripts/apply-special-statistics.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = process.cwd();
const p = (f) => join(ROOT, f);
const DRY = process.argv.includes('--dry');

/* ------------------------------------------------------------------ the special-statistic lane -- */

/** The impulse attack roll, shared verbatim by the class feature and the dedication so the two can
 *  never disagree — they collapse to ONE row (`deriveSpecialStats` keys by `key`). */
const IMPULSE_ATTACK = {
  key: 'impulse-attack',
  name: 'Impulse attack roll',
  kind: 'attack',
  basis: { classDc: 'kineticist' },
  note: 'Some impulses ask for an impulse attack roll rather than a save.',
};

const SPECIAL_STATS = {
  'classFeatures/impulses': IMPULSE_ATTACK,
  'feats/kineticist-dedication': IMPULSE_ATTACK,
  'feats/scroll-thaumaturgy': {
    key: 'scroll-dc',
    name: 'Scroll DC',
    kind: 'dc',
    basis: { classDc: 'thaumaturge' },
    note: 'You activate scrolls of any tradition against this DC rather than a spell DC.',
  },
};

/* ------------------------------------------------- the data half of the secondary-class-DC lane -- */

/**
 * Dedications printing "You become trained in <class> class DC" whose record carried no
 * `classDcGrant`, so the borrowed DC never appeared. Measured against the live corpus: 16 dedications
 * print the clause, 6 carried the field, and one more (`exemplar-dedication`) was backfilled by its
 * own script. These are the rest, each verified against its printed sentence.
 *
 * ⚠ Every classId here must exist in `core.classes` — build.ts skips a grant whose class it cannot
 * resolve, which would leave the record looking authored and doing nothing. Asserted below.
 */
const CLASS_DC_GRANTS = {
  'feats/barbarian-dedication': 'barbarian',
  'feats/champion-dedication': 'champion',
  'feats/guardian-dedication': 'guardian',
  'feats/inventor-dedication': 'inventor',
  'feats/investigator-dedication': 'investigator',
  'feats/kineticist-dedication': 'kineticist',
  'feats/monk-dedication': 'monk',
  'feats/swashbuckler-dedication': 'swashbuckler',
  'feats/thaumaturge-dedication': 'thaumaturge',
};

/** "…and at 15th level, you become legendary in Crafting and you become an expert in your inventor
 *  class DC." The upgrade shape already exists (`classDcRank`); this record was missing it, and with
 *  Inventor Dedication missing its grant the pair moved nothing at all. */
const CLASS_DC_RANKS = {
  'feats/brilliant-crafter': { classId: 'inventor', rank: 'expert' },
};

/* ------------------------------------------------------------------- the item bonus that names it */

/**
 * "If you're a kineticist, the attenuator grants you a +1 item bonus to your impulse attack modifier
 * (but not to your impulse DC)." Values read from each record's own text, not extrapolated — the
 * major attenuator prints +2, the same as the greater, and its apex Constitution boost is the reason
 * it costs more.
 *
 * It goes under `passiveEffects` because that is the only bucket a worn/invested item's defences are
 * read from (an item-level field is read by nothing — see the `weakness` lane's note).
 *
 * ⚠ Written as a WHOLE `passiveEffects` object, not as a row addressed `path: ['passiveEffects']`.
 * None of the three carries one today, and a path row lands on nothing when the target object does
 * not exist — so after the next `npm run data` the bonus would silently vanish, which is the exact
 * failure mode the overlay exists to prevent. All 532 existing item rows write it wholesale too.
 */
const ITEM_BONUSES = {
  'items/gate-attenuator': { key: 'impulse-attack', value: 1 },
  'items/gate-attenuator-greater': { key: 'impulse-attack', value: 2 },
  'items/gate-attenuator-major': { key: 'impulse-attack', value: 2 },
};

/* ---------------------------------------------------------------------------------------- apply -- */
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));

const writes = [];
const missing = [];
const add = (key, field, value) => {
  const i = key.indexOf('/');
  const category = key.slice(0, i);
  const id = key.slice(i + 1);
  if (!core[category]?.[id]) { missing.push(key); return; }
  writes.push({ category, id, field, value });
};

for (const [key, stat] of Object.entries(SPECIAL_STATS)) add(key, 'specialStatistic', stat);
for (const [key, classId] of Object.entries(CLASS_DC_GRANTS)) {
  if (!core.classes?.[classId]) throw new Error(`classDcGrant ${key} names class "${classId}", which is not in core.classes`);
  add(key, 'classDcGrant', { classId });
}
for (const [key, v] of Object.entries(CLASS_DC_RANKS)) {
  if (!core.classes?.[v.classId]) throw new Error(`classDcRank ${key} names class "${v.classId}", which is not in core.classes`);
  add(key, 'classDcRank', v);
}
for (const [key, v] of Object.entries(ITEM_BONUSES)) {
  const id = key.slice(key.indexOf('/') + 1);
  // Merge rather than replace, so re-running after someone adds a real passive to one of these three
  // does not quietly delete it. Today all three are undefined, asserted by the console line below.
  add(key, 'passiveEffects', { ...(core.items?.[id]?.passiveEffects ?? {}), specialStatBonus: v });
}
const preexisting = Object.keys(ITEM_BONUSES).filter((k) => core.items?.[k.slice(k.indexOf('/') + 1)]?.passiveEffects);
if (preexisting.length) console.log(`note: merged into existing passiveEffects on ${preexisting.join(', ')}`);

const byField = {};
for (const w of writes) byField[w.field] = (byField[w.field] ?? 0) + 1;
console.log(`resolvable writes: ${writes.length}`);
for (const [f, n] of Object.entries(byField)) console.log(`  ${f}: ${n}`);
if (missing.length) console.log(`\nNOT IN core.json — nothing written:\n   ${missing.join('\n   ')}`);

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

for (const w of writes) core[w.category][w.id][w.field] = w.value;
writeFileSync(p('public/core.json'), JSON.stringify(core));

// Rows are replaced in place when they already exist, so re-running is idempotent (every row is an
// absolute assignment — applying it twice is applying it once).
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
