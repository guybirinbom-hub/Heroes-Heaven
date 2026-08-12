/*
 * Terrain choices: the tenth terrain, and the ability to write one the book never printed.
 *
 * The owner's instruction, verbatim:
 *   "terrain need to be the existing options, add this missing one but also add the ability to write
 *    free text in terrain."
 *
 * WHY THERE IS A MISSING ONE. Witchlight Follower grants "the Terrain Expertise skill feat with both
 * swamp terrain and subterranean bodies of water". Terrain Expertise prints nine terrains and only
 * `swamp` is one of them, so the background's SECOND terrain was a name the app had no value for —
 * Foundry has the same nine and solves it by preselecting swamp and dropping the rest of the sentence.
 * `subterranean-water` is added because it is neither `aquatic` (which is open water) nor `underground`
 * (which is rock): the printed terrain is the intersection, and picking either existing option would
 * be answering a different question. The label is the background's own phrase, so the player who reads
 * that sentence recognises the row.
 *
 * WHY FREE TEXT, AND ONLY HERE. Gold-set principle I — "free-text player input is a legitimate choice
 * type". A terrain list is illustrative in a way most `kind: 'array'` lists are not, and two records
 * say so in print: Underbrush Trailblazer offers "a different type of difficult terrain" without
 * naming which, and Trailblazer grants Terrain Expertise "with one terrain you've explored (such as
 * forest or underground)". A GM naming a tenth terrain is playing the game as written.
 *
 * `allowCustom` is therefore set per record, never inferred from `kind`. The three terrain-shaped
 * choices that stay CLOSED are listed at the bottom with the sentence that closes each one.
 *
 * Writes public/core.json (so the app sees it now) and scripts/data/effect-backfill.json (so it
 * survives `npm run data`), through the one sanctioned writer.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

/** The tenth terrain, inserted alphabetically by label so the list stays the tidy one it was. */
const SUBTERRANEAN_WATER = { value: 'subterranean-water', label: 'Subterranean bodies of water' };
const AFTER = 'sky'; // "Sky" < "Subterranean…" < "Swamp"

/** The wording each opted-in choice offers. Two questions, two vocabularies. */
const TERRAIN = {
  label: 'Type another terrain…',
  placeholder: 'Terrain (e.g. subterranean bodies of water)…',
};
const DIFFICULT = {
  label: 'Type another type of difficult terrain…',
  placeholder: 'Difficult terrain (e.g. deep mud)…',
};

/**
 * Every terrain choice whose printed list is illustrative, with the sentence that makes it so.
 * `[bucket, id, wording]`.
 */
const OPT_IN = [
  // "…in one of the following types of terrain: aquatic, arctic, … or underground." Closed on its own
  // page, opened by the grant in Witchlight Follower, which names a terrain that is not on it.
  ['feats', 'terrain-expertise', TERRAIN],
  // Same nine-terrain vocabulary, same sentence shape ("Select one type of terrain from the following
  // list"). Widening one and not the other would make the same word legal in one picker and not the next.
  ['feats', 'wilderness-spotter', TERRAIN],
  // "Select one type of difficult terrain from the following list: rubble, snow, or underbrush."
  ['feats', 'terrain-stalker', DIFFICULT],
  // Grants Terrain Stalker twice — the same vocabulary, asked twice.
  ['feats', 'terrain-scout', DIFFICULT],
  // "…if you already have Terrain Stalker for underbrush, you can select A DIFFERENT TYPE OF DIFFICULT
  // TERRAIN." The feat's own text declines to enumerate the alternatives. This is the printed proof.
  ['feats', 'underbrush-trailblazer', DIFFICULT],
  // "You gain the Terrain Expertise skill feat with one terrain you've explored (SUCH AS forest or
  // underground)." "Such as" is the other printed proof.
  ['backgrounds', 'trailblazer', TERRAIN],
  // Terrain Stalker's terrain, asked by the background that grants it.
  ['backgrounds', 'hired-killer', DIFFICULT],
  ['backgrounds', 'spotter', DIFFICULT],
];

/**
 * Terrain-shaped and deliberately NOT opted in — asserted here so a later sweep cannot quietly
 * reclassify one as an oversight.
 */
const CLOSED = {
  // "Choose either natural or urban terrain." A binary partition; there is no third kind.
  'feats/shooters-camouflage': 'binary: natural or urban',
  'classFeatures/vindicator': 'binary: natural or urban',
  // "Choose arctic, desert, mountain, or swamp. This choice can't be changed AND MAY ALTER THE EFFECTS
  // OF SOME OF YOUR FEATS." An answer off the list would drive nothing.
  'feats/mummy-dedication': 'the answer drives other feats',
  // Six of the nine, and three of the nine: the RECORD narrowed the list. Reopening it through a text
  // box would undo the narrowing rather than honour it.
  'heritages/mottle-coat-centaur': 'narrowed to six of the nine',
  'heritages/camouflage-tripkee': 'narrowed to three of the nine',
  // "…the Terrain Stalker skill feat in either rubble or underbrush." Two of Terrain Stalker's three.
  'backgrounds/isgeri-reclaimer': 'narrowed to two of the three',
};

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const die = (m) => {
  console.error(m);
  process.exit(1);
};

/* ---------------------------------------------------------------- the tenth terrain */

const te = core.feats?.['terrain-expertise'];
if (!te?.choice?.options) die('terrain-expertise carries no choice options — refusing to invent one.');
if (!te.choice.options.some((o) => o.value === 'swamp')) die('terrain-expertise no longer offers swamp — the list is not the one this script read.');

if (!te.choice.options.some((o) => o.value === SUBTERRANEAN_WATER.value)) {
  const at = te.choice.options.findIndex((o) => o.value === AFTER);
  if (at < 0) die(`terrain-expertise no longer offers "${AFTER}" — cannot place the new option alphabetically.`);
  te.choice.options.splice(at + 1, 0, { ...SUBTERRANEAN_WATER });
}
console.log(`[terrain] terrain-expertise now offers ${te.choice.options.length} terrains`);

/* ---------------------------------------------------------------- the opt-ins */

for (const [bucket, id, wording] of OPT_IN) {
  const rec = core[bucket]?.[id];
  if (!rec) die(`${bucket}/${id} does not exist`);
  if (!rec.choice) die(`${bucket}/${id} has no choice to open up`);
  if (rec.choice.kind !== 'array') die(`${bucket}/${id}'s choice is kind '${rec.choice.kind}', not the array shape this opens`);
  rec.choice.allowCustom = { ...wording };
}
console.log(`[terrain] ${OPT_IN.length} terrain choices now accept a typed answer`);

for (const [key, why] of Object.entries(CLOSED)) {
  const [bucket, id] = key.split('/');
  const rec = core[bucket]?.[id];
  if (!rec) die(`${key} does not exist — the closed list is stale`);
  const def = rec.choice ?? rec.effectChoices?.[0];
  if (!def) die(`${key} has no choice — the closed list is stale`);
  if (def.allowCustom) die(`${key} opted in, but it is closed (${why})`);
}
console.log(`[terrain] ${Object.keys(CLOSED).length} terrain-shaped choices verified still closed`);

/* ---------------------------------------------------------------- persist */

writeFileSync(CORE, JSON.stringify(core)); // minified on purpose

/*
 * Two row shapes, chosen so no record ends up with BOTH a whole-`choice` row and a sub-field row on
 * it: rows are applied in array order, and a whole-object row landing after a sub-field row would
 * wipe the sub-field. Records that already carry a whole-`choice` row get `allowCustom` folded into
 * that row's value; the three that do not get a surgical `path: ['choice']` row instead, which leaves
 * the importer free to keep owning the rest of their choice.
 */
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const wholeChoiceRow = (bucket, id) =>
  backfill.find((r) => r.category === bucket && r.id === id && r.field === 'choice' && !r.path);

let folded = 0;
const fresh = [];
for (const [bucket, id, wording] of OPT_IN) {
  const row = wholeChoiceRow(bucket, id);
  if (row) {
    row.value = { ...row.value, allowCustom: { ...wording } };
    folded++;
  } else {
    fresh.push({ category: bucket, id, path: ['choice'], field: 'allowCustom', value: { ...wording } });
  }
}
// The option list, on the one record that gains a member. Written whole because a backfill row is an
// absolute assignment — there is no "append" — and written as a path row for the same reason as above.
if (wholeChoiceRow('feats', 'terrain-expertise')) die('terrain-expertise now has a whole-choice row; fold the options into it instead.');
fresh.push({
  category: 'feats',
  id: 'terrain-expertise',
  path: ['choice'],
  field: 'options',
  value: te.choice.options.map((o) => ({ ...o })),
});

const key = (r) => `${r.category}/${r.id}/${(r.path ?? []).join('/')}/${r.field}`;
const mine = new Set(fresh.map(key));
const next = [...backfill.filter((r) => !mine.has(key(r))), ...fresh];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`[terrain] backfill: ${folded} rows folded, ${fresh.length} rows written (${backfill.length} → ${next.length})`);
