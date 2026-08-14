/*
 * THE OWNER SCRIPT FOR THE SENSE-LANE CORRECTIONS FOUND BY scripts/scan-sense-lane.mjs.
 *
 *   node scripts/apply-sense-lane-fixes.mjs --dry     # what it would change
 *   node scripts/apply-sense-lane-fixes.mjs           # write the overlay + the live core.json
 *
 * `npm run feat -- superior-sight` called every one of these rows an ORPHAN: "no authoring script
 * names this record". This file is that script, so the next reader can see why each value is what it
 * is instead of guessing.
 *
 * TWO SHAPES, both measured by the scan:
 *
 * 1. Six records carried a flat `senses` row AND a `conditionalSenses` row whose `ifPresent` the flat
 *    row satisfies. derive.ts gathers the flat one first, so the condition was always true and every
 *    character took the `upgraded` branch. MEASURED before this ran: a human taking Ember's Eyes,
 *    Superior Sight, Draconic Sight, Hungry Eyes or Twilight Dweller got DARKVISION — all five print
 *    low-light vision for a character who has none. A human taking You Don't Smell Right got scent at
 *    60 feet where the text gives 30. The `base` branch of `conditionalSenses` already grants the
 *    unconditional half, so the flat row is deleted, not moved.
 *
 *    ⚠ Three of them (draconic-sight, hungry-eyes, twilight-dweller) put `acuity: 'precise'` on the
 *    flat row and nothing on the conditional's `base`. Deleting the flat row alone would have dropped
 *    "(precise)" off the sheet for those three, so the acuity moves onto `base` in the same pass.
 *    A fix that quietly loses a displayed word is still a regression.
 *
 * 2. Two records modelled a printed CLAUSE as a sense, so the sheet's Senses row read
 *    "Normal vision, Ignores concealment from smoke". They grant no perception capability — the
 *    creature stays concealed, only the flat check to target it is affected — so the clause moves to
 *    the situational registry on the Strike row, the shape `firesight` and `ash-piercing-gaze` use.
 *    Those situational entries are hand-authored in src/rules/situationalBonuses.ts (additions to the
 *    pre-banner region survive apply-situational-lane.mjs, which skips ids already present).
 *
 * ⚠ smoke-sight prints a SECOND clause this does not model — "when you are concealed or hidden in
 * smoke, increase the DC of the flat check to target you to 6/12". That is a defence on the player's
 * own Concealed/Hidden condition, which wants a RECORD_MARKERS row rather than a Strike star. Left
 * for whoever builds that; deleting the wrong surface is still the right move for the first clause.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

/** id → why its flat `senses` row goes, and what (if anything) must move onto `conditionalSenses`. */
const REMOVE_FLAT_SENSES = {
  // SHAPE 1 — the flat row satisfies the record's own `ifPresent`.
  // `aquatic-eyes` is the record the audit named and the one the scan was derived FROM; its row was
  // already set by hand. Listed anyway so `npm run feat -- aquatic-eyes` names an owner for it, and
  // so all ten of the sweep live in one place. A no-op on a tree where it is already applied.
  'aquatic-eyes': {},
  'superior-sight': {},
  'embers-eyes': {},
  'draconic-sight': { moveAcuityToBase: 'precise' },
  'hungry-eyes': { moveAcuityToBase: 'precise' },
  'twilight-dweller': { moveAcuityToBase: 'precise' },
  'you-dont-smell-right': {}, // base already carries range 30 + imprecise
  // SHAPE 2 — a printed clause, not a sense. Moved to FEAT_SITUATIONAL (strikeAttack).
  'ash-piercing-gaze': {}, // the audit's own record; already applied, listed so it has an owner
  'smoke-sight': {},
  'brilliant-vision': {},
};

const rows = readBackfill(root);
const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));

/* A full parse→stringify of a 9.8 MB minified file is only safe if it round-trips byte-for-byte.
 * Asserted rather than assumed: an escaping or number-formatting difference would rewrite the whole
 * file and bury the two-record change in a diff nobody could review. */
const beforeText = readFileSync(join(root, 'public/core.json'), 'utf8');
if (JSON.stringify(core) !== beforeText) throw new Error('public/core.json does not round-trip through JSON — refusing to rewrite it');

const changes = [];
for (const [id, opt] of Object.entries(REMOVE_FLAT_SENSES)) {
  const rec = core.feats?.[id];
  if (!rec) throw new Error(`feats/${id} not found in core.json`);

  // --- the overlay (durable across `npm run data`) ---
  const sensesRows = rows.filter((r) => r.category === 'feats' && r.id === id && r.field === 'senses' && !r.path);
  if (sensesRows.length > 1) throw new Error(`feats/${id}: ${sensesRows.length} senses rows in the overlay`);
  if (sensesRows.length === 1) {
    if (sensesRows[0].value !== null) {
      // `value: null` is the overlay's REMOVE idiom (scripts/lib/apply-backfill.mjs). Idempotent, and
      // it records the decision so a later authoring pass does not re-add the flat grant.
      sensesRows[0].value = null;
      changes.push(`overlay  feats/${id}.senses -> null`);
    }
  } else if (rec.senses !== undefined) {
    rows.push({ category: 'feats', id, field: 'senses', value: null });
    changes.push(`overlay  feats/${id}.senses -> null (row added)`);
  }

  if (opt.moveAcuityToBase) {
    const csRow = rows.find((r) => r.category === 'feats' && r.id === id && r.field === 'conditionalSenses');
    if (!csRow) throw new Error(`feats/${id}: no conditionalSenses overlay row to carry the acuity onto`);
    for (const cs of csRow.value ?? []) {
      if (cs.base && cs.base.acuity === undefined) {
        cs.base.acuity = opt.moveAcuityToBase;
        changes.push(`overlay  feats/${id}.conditionalSenses[].base.acuity -> ${opt.moveAcuityToBase}`);
      }
    }
  }

  // --- the shipped core.json, so the fix is live before the next regen ---
  if (rec.senses !== undefined) {
    delete rec.senses;
    changes.push(`core     feats/${id}.senses deleted`);
  }
  if (opt.moveAcuityToBase) {
    for (const cs of rec.conditionalSenses ?? []) {
      if (cs.base && cs.base.acuity === undefined) {
        cs.base.acuity = opt.moveAcuityToBase;
        changes.push(`core     feats/${id}.conditionalSenses[].base.acuity -> ${opt.moveAcuityToBase}`);
      }
    }
  }
}

for (const c of changes) console.log(c);
console.log(`\n${changes.length} change${changes.length === 1 ? '' : 's'}${changes.length ? '' : ' — already applied'}`);
if (DRY) {
  console.log('--dry: nothing written');
} else if (changes.length) {
  writeBackfill(root, rows);
  writeFileSync(join(root, 'public/core.json'), JSON.stringify(core)); // MINIFIED — never pretty-print
  console.log('written  scripts/data/effect-backfill.json + public/core.json');
}
