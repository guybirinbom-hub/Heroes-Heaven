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
 *
 * ⚠ THE EXCLUSION BELOW WAS WRONG, AND IS CORRECTED IN PASS 2 (see the second section of this file).
 *   This pass recorded: *"THE 6 DEVIANT CLASSIFICATIONS … Our own text never names one — not the
 *   classification records, not the deviant feats, and not AoN's five Dark Archive rules pages."*
 *   Both halves are false and both were checkable in one grep:
 *     – our own `classFeatures/flicker-deviant-classification` (and its `desynchronized-motions`
 *       sub-feature) says *"You can attempt to Escape against **your deviation DC**"*;
 *     – AoN rules-3506 *Deviation Saves and Attack Rolls*, in the local archive, prints the formula:
 *       *"The DC for any saving throw called for by a deviation is the higher of your class DC or
 *       spell DC. The attack modifier of a deviation is 10 lower than that DC."*
 *   What was actually missing was a `basis` that could SAY "the higher of two statistics" — the field
 *   only spoke of one class DC — so the record could not be authored and was rationalised away
 *   instead. That is the false-gap failure in reverse: a real gap closed by writing down a reason.
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

/* ────────────────────────────────────────────── PASS 2 (2026-08-12) — the "higher of two" shape ──
 *
 * Found by scanning OUR OWN text for a named statistic rather than by re-reading Foundry's list, which
 * is what the lane test says to do — and which is why one of these two records is not in Foundry's 9
 * at all. Both are the same shape, and neither could be expressed until `basis` learned to say it:
 *
 *   • CHRONOSKIMMER DC. Chronoskimmer Dedication: "The DC for these abilities is either your class DC
 *     or spell DC, whichever is higher, and is called your chronoskimmer DC." Two feats in the same
 *     archetype roll against it BY NAME (Guide the Timeline, Steal Time). The maximum of two rows is a
 *     third number: the sheet prints a class DC and a spell DC, and never their higher.
 *   • DEVIATION DC and DEVIATION ATTACK ROLL, on all seven classifications. See the correction above
 *     for why the first pass excluded these. Two rows rather than one because the rule states them
 *     separately and they are 10 apart — four deviant feats say only "Make an attack roll", so a
 *     player with Blasting Beams has no number to roll without the attack row.
 *
 * Authored on the CLASSIFICATION, not on the 30 deviant feats: a deviant feat GRANTS its
 * classification (`grantsClassFeatures`), so the classification is the one record every deviant
 * character owns, and `deriveSpecialStats` collapses by `key` if they ever hold two.
 *
 * ⚠ THAT LAST SENTENCE WAS AN ASSUMPTION, AND IT WAS FALSE FOR TWO OF THE SEVEN (fixed 2026-08-13).
 * Only 20 of the 30 deviant feats carried `grantsClassFeatures`; the eight Pathfinder #202 feats did
 * not, so `ownedFeatureIds` had no route to Verdant Core or Blight Soul and both classifications'
 * rows were unreachable — authored, correct, and shown to nobody. A Verdant Core deviant holding Vine
 * Lash ("Make a melee attack roll against a creature within 30 feet") had no modifier printed
 * anywhere, which is the exact failure the attack row exists to prevent. `CLASSIFICATION_FEATS` below
 * closes it, and the reachability check at the end turns the assumption into something that fails.
 *
 * Membership was MEASURED, not paired by name: each classification's own archive record embeds its
 * four feats as `<document level="3" id="feat-NNNN" />` (…/by-category/deviant-ability-classification/),
 * and those ids resolve through `aonId` to exactly the 20 already authored plus these 8.
 */
const DEVIATION = [
  {
    key: 'deviation-dc',
    name: 'Deviation DC',
    kind: 'dc',
    basis: { higherOfClassDcOrSpellDc: true },
    note: 'Saves against your deviations, and checks made against them, use this DC.',
  },
  {
    key: 'deviation-attack',
    name: 'Deviation attack roll',
    kind: 'attack',
    basis: { higherOfClassDcOrSpellDc: true },
    // "unless the deviation calls for a Strike, in which case the attack modifier is the normal
    // attack modifier of the Strike" — the exception is on the STRIKE, which already has its own row.
    note: 'Deviations that say "Make an attack roll" use this. A deviation that calls for a Strike uses that Strike instead.',
  },
];

const CLASSIFICATIONS = [
  'blight-soul-deviant-classification',
  'dragon-deviant-classification',
  'flicker-deviant-classification',
  'leech-deviant-classification',
  'troll-deviant-classification',
  'verdant-core-deviant-classification',
  'wraith-deviant-classification',
];

/**
 * The route that makes a classification OWNABLE. Only the eight that had none are listed — the other
 * 22 rows already ship, and re-writing them would be a 22-row diff saying nothing.
 *
 * Both of these classifications are Pathfinder #202: Severed at the Root, which is why they were
 * missed as a pair: the Dark Archive import carried the grant and the later one did not.
 */
const CLASSIFICATION_FEATS = {
  'verdant-core-deviant-classification': ['sprout-fruit', 'vine-lash', 'defensive-growth', 'disperse-into-petals'],
  'blight-soul-deviant-classification': ['release-spores', 'rotten-slurry', 'irradiate', 'unleash-the-blight'],
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
  'feats/chronoskimmer-dedication': {
    key: 'chronoskimmer-dc',
    name: 'Chronoskimmer DC',
    kind: 'dc',
    basis: { higherOfClassDcOrSpellDc: true },
    note: 'Chronoskimmer abilities that allow a saving throw use this DC.',
  },
  ...Object.fromEntries(CLASSIFICATIONS.map((id) => [`classFeatures/${id}`, DEVIATION])),
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

// The route that makes the classification ownable. `grantsClassFeatures` is a list, so the grant is
// APPENDED rather than assigned — an id already there stays, and nothing else the record grants is
// dropped by writing this one.
for (const [classification, feats] of Object.entries(CLASSIFICATION_FEATS)) {
  for (const featId of feats) {
    const rec = core.feats?.[featId];
    if (!rec) { missing.push(`feats/${featId}`); continue; }
    if (!rec.traits?.includes('deviant')) throw new Error(`${featId} does not carry the deviant trait — check the classification mapping`);
    const now = rec.grantsClassFeatures ?? [];
    add(`feats/${featId}`, 'grantsClassFeatures', now.includes(classification) ? now : [...now, classification]);
  }
}

/*
 * ⚠ THE CHECK THAT WAS MISSING. A `specialStatistic` on a record nothing can own is invisible, and
 * reads on every measuring script as authored. Two of the seven classifications were in exactly that
 * state for a day. `ownedFeatureIds` reaches a deviant classification ONLY through a feat's
 * `grantsClassFeatures`, so that is what is counted — after the writes above are folded in.
 */
const grantsAfter = (id) =>
  Object.entries(core.feats ?? {}).filter(([fid, f]) => {
    const w = writes.find((x) => x.category === 'feats' && x.id === fid && x.field === 'grantsClassFeatures');
    return (w?.value ?? f.grantsClassFeatures ?? []).includes(id);
  }).length;
const unreachable = CLASSIFICATIONS.filter((id) => grantsAfter(id) === 0);
if (unreachable.length) {
  throw new Error(
    `no feat grants ${unreachable.join(', ')} — its deviation DC and attack roll would be authored and unreachable`,
  );
}

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
