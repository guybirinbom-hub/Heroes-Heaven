/*
 * Batch-001, cluster "surfaces that do not exist" — the DATA half that is not a mode.
 *
 * 1. actions/apparition-sense — "As an activity that takes 10 minutes, you can act as a link between
 *    disembodied souls and their mortal bodies." (AoN mirror feat-7120, War of Immortals pg. 22.)
 *    That is the `grantsAction` lane: docs/mechanic-lanes.md keeps "the action's EXISTENCE" as a lane
 *    even where an activity's internal steps are explicitly not one. The activity becomes its OWN
 *    action record in the shape `actions/warding-shift` already uses for an activity lifted out of a
 *    feat (`aonParentId` + `aonSection`, no aonId of its own), and the feat points at it with
 *    `grantsActions`, which MainTab's `grantedActions` reads.
 *
 *    ⚠ Its cost is `{type:'duration'}`, which had ZERO records before this. MainTab's isActionCost
 *    gate and widgets' ActionGlyph are widened in the same change — without both, this record is
 *    authored and invisible, which is the failure this project keeps re-shipping.
 *
 *    ⚠ THE PARENT'S DESCRIPTION IS TRIMMED, and that is deliberate. MEASURED over the shipped data:
 *    of 186 `grantsActions` pairs where both descriptions exist, the granter repeats the action's text
 *    in exactly 2 (`quicksoul`→`toxic-touch`, `flurry-of-blows`). The convention is the one
 *    `classFeatures/rage` shows — "You gain the Rage action, which lets you fly into a frenzy." —
 *    and `hellknight-errant` prints it verbatim from AoN. Leaving the whole 10-minute procedure on the
 *    feat AND on the action would render the same paragraph in two popups.
 *
 *    …and the standing sentence between them — "You can allow a spirit or undead otherwise incapable
 *    of speech to speak through you" — becomes `feats/apparition-sense.note`, which is the surface the
 *    audit named and which already renders (FeatsTab's `const own = …?.note` line). Every printed
 *    sentence therefore appears exactly once, in the place it belongs.
 *
 * 2. feats/animal-empathy-druid — its description opens with an unstripped bibliographic header glued
 *    to the rules prose ("Animal Empathy (Druid) Source Player Core pg. 127 Archetypes Beastmaster
 *    (Level 4), Mammoth Lord (Level 4)"), rendered to the player as if it were rules text. The prose
 *    below it is restored verbatim from the AoN mirror. (The record is also hidden from pickers as a
 *    duplicate of `animal-empathy`; a character who already holds the id still reads this.)
 *
 * 3. feats/ancestral-blood-magic.spellNotes — the SECOND half of that feat's finding (Q8 / Principle
 *    N2): the mark on each qualifying spell. `fromAncestrySpells` is the new SpellNote shape, because
 *    "a non-cantrip spell you gained from a heritage or an ancestry feat" names a SOURCE, not a spell,
 *    so no `spellId`-keyed note could enumerate it. Read by build.ts's `wantsAncestrySpellNote` pass →
 *    `pushSpellNote` → explain.ts `spellNotesFor` → SpellsTab's spell-detail popup.
 *
 * DURABILITY. `feats` and `actions` are NOT in import-core-v2's CARRY_WHOLESALE, so anything written
 * straight into public/core.json dies at the next `npm run data`. Every value here therefore goes
 * through scripts/lib/write-backfill.mjs into scripts/data/effect-backfill.json — the only overlay
 * that survives a regeneration — and is ALSO applied to public/core.json and
 * public/core-descriptions.json (where descriptions live after split-descriptions.mjs) so the change
 * is visible without one. `create: true` is the applier's own shape for a whole new record
 * (lib/apply-backfill.mjs; it never overwrites).
 *
 * ⚠ The description rows are written to BOTH public files for the reason spelled out in
 * scripts/apply-import-damaged-text.mjs: an overlay row alone sets `description` on core.json and
 * split-descriptions.mjs then refuses to write, so the repair would be invisible until a full regen.
 *
 * Idempotent: every row is an absolute assignment, and it refuses rather than guesses at every guard.
 *
 *   node scripts/apply-batch001-surfaces.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};

/** feat-7120, third sentence onward — the activity, and only the activity. */
const APPARITION_ACTIVITY =
  'As an activity that takes 10 minutes, you can act as a link between disembodied souls and their mortal bodies. ' +
  'As long as you are in contact with both a spirit and a living body that belonged to it in life during that entire ' +
  'time, the spirit can use you to return to that body; this does not allow you to bring the dead back to life, but ' +
  'can assist in restoring a disembodied soul to a still-living body. If the body is occupied by another spirit or ' +
  'soul, that entity must succeed at a Will save against your spell DC or be cast from the body when its original ' +
  'owner is returned.';

/** feat-7120, second sentence — a standing capability with no procedure and no cost. */
const APPARITION_NOTE =
  'You can allow a spirit or undead otherwise incapable of speech to speak through you as long as you are in direct ' +
  'contact with it.';

/** feat-7120, first paragraph verbatim + the pointer sentence, in `classFeatures/rage`'s shape. */
const APPARITION_FEAT_DESC =
  "You can see and interact with things others can't. You have apparition sight, an imprecise sense that allows you " +
  'to detect the presence of invisible or hidden spirits, haunts, and undead within 30 feet of you.\n\n' +
  'You also gain the Apparition Sense activity, which lets you act as a link between disembodied souls and their ' +
  'mortal bodies.';

const ACTION_RECORD = {
  id: 'apparition-sense',
  name: 'Apparition Sense',
  traits: ['animist', 'divine'],
  rarity: 'common',
  actionCost: { type: 'duration', text: '10 minutes' },
  source: { book: 'Pathfinder War of Immortals', license: 'ORC' },
  edition: 'remaster-era',
  aonParentId: 'feat-7120',
  aonSection: 'Apparition Sense',
  description: APPARITION_ACTIVITY,
};

/** feat-4709's rules prose, with the bibliographic header removed and nothing else changed. */
const ANIMAL_EMPATHY_DRUID_DESC =
  'You have a connection to the creatures of the natural world that allows you to communicate with them on a ' +
  'rudimentary level. You can ask questions of, receive answers from, and use the Diplomacy skill with animals. In ' +
  'most cases, wild animals will give you time to make your case.';

/** feat-1810, restated as the clause it puts on each qualifying spell. */
const BLOOD_MAGIC_SPELL_NOTE =
  'Casting this spell triggers your blood magic effect — you gained it from a heritage or an ancestry feat, and it ' +
  'is not a cantrip.';

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const descs = JSON.parse(readFileSync(p('public/core-descriptions.json'), 'utf8'));

// A full round-trip must be lossless before this script is allowed to rewrite a 9.8 MB minified file.
if (JSON.stringify(JSON.parse(readFileSync(p('public/core.json'), 'utf8'))) !== readFileSync(p('public/core.json'), 'utf8'))
  fail('public/core.json does not round-trip through JSON.parse/stringify — rewriting it would reformat the file');

if (!core.feats['apparition-sense']) fail('feats/apparition-sense is missing');
if (!core.feats['animal-empathy-druid']) fail('feats/animal-empathy-druid is missing');
if (!core.feats['ancestral-blood-magic']) fail('feats/ancestral-blood-magic is missing');
if (core.actions['apparition-sense'] && core.actions['apparition-sense'].aonParentId !== 'feat-7120')
  fail('actions/apparition-sense already exists and is not ours — not overwriting');
// The trim is only safe while the feat's shipped description still CONTAINS the activity it moves.
const shippedFeatDesc = descs.feats['apparition-sense']?.d ?? '';
if (!shippedFeatDesc.includes('As an activity that takes 10 minutes') && shippedFeatDesc !== APPARITION_FEAT_DESC)
  fail('feats/apparition-sense description no longer holds the 10-minute activity — re-read it before trimming');
if (!descs.feats['animal-empathy-druid']?.d) fail('feats/animal-empathy-druid has no description to repair');

const rows = readBackfill(ROOT);
const before = rows.length;
const setRow = (row) => {
  const i = rows.findIndex(
    (r) => r.category === row.category && r.id === row.id && !r.path && (row.create ? r.create : r.field === row.field),
  );
  if (i >= 0) rows[i] = row;
  else rows.push(row);
};

setRow({ category: 'actions', id: 'apparition-sense', create: true, value: ACTION_RECORD });
setRow({ category: 'feats', id: 'apparition-sense', field: 'grantsActions', value: ['apparition-sense'] });
setRow({ category: 'feats', id: 'apparition-sense', field: 'note', value: APPARITION_NOTE });
setRow({ category: 'feats', id: 'apparition-sense', field: 'description', value: APPARITION_FEAT_DESC });
setRow({ category: 'feats', id: 'animal-empathy-druid', field: 'description', value: ANIMAL_EMPATHY_DRUID_DESC });
setRow({
  category: 'feats',
  id: 'ancestral-blood-magic',
  field: 'spellNotes',
  value: [{ fromAncestrySpells: true, note: BLOOD_MAGIC_SPELL_NOTE }],
});

console.log(`effect-backfill rows: ${before} -> ${rows.length}`);
if (DRY) {
  console.log('\n--dry: nothing written');
  process.exit(0);
}
writeBackfill(ROOT, rows);

// …and the live files, so the change shows without a regeneration. `description` is set on core.json
// too — that is exactly what `node scripts/import-siege-and-gaps.mjs` would do from the overlay row,
// so doing it here keeps that script a TRUE no-op afterwards.
const { description, ...actionNoDesc } = ACTION_RECORD;
core.actions['apparition-sense'] = { ...actionNoDesc, description };
core.feats['apparition-sense'].grantsActions = ['apparition-sense'];
core.feats['apparition-sense'].note = APPARITION_NOTE;
core.feats['apparition-sense'].description = APPARITION_FEAT_DESC;
core.feats['animal-empathy-druid'].description = ANIMAL_EMPATHY_DRUID_DESC;
core.feats['ancestral-blood-magic'].spellNotes = [{ fromAncestrySpells: true, note: BLOOD_MAGIC_SPELL_NOTE }];

descs.actions ??= {};
descs.actions['apparition-sense'] = { ...(descs.actions['apparition-sense'] ?? {}), d: description };
descs.feats['apparition-sense'] = { ...(descs.feats['apparition-sense'] ?? {}), d: APPARITION_FEAT_DESC };
descs.feats['animal-empathy-druid'] = { ...(descs.feats['animal-empathy-druid'] ?? {}), d: ANIMAL_EMPATHY_DRUID_DESC };

writeFileSync(p('public/core.json'), JSON.stringify(core));
writeFileSync(p('public/core-descriptions.json'), JSON.stringify(descs));

console.log('written: scripts/data/effect-backfill.json, public/core.json, public/core-descriptions.json');
console.log('note: `feats` and `actions` are not in CARRY_WHOLESALE — the overlay is what carries these through `npm run data`.');
