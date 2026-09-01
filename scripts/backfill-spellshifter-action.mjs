/*
 * THE SPELLSHIFTER'S SHIFT SPELL — the action the whole archetype exists for, which no record held.
 *
 * *"You gain the SHIFT SPELL ACTION and the Share the Burden spellshift."* Wanderer's Guide hands over
 * a named ability entry for it. Ours granted nothing structured: `feats/spellshifter-dedication`
 * carried a one-line note, so the action appeared nowhere on the sheet and the rules were readable only
 * by opening the dedication's own description.
 *
 * ⚠ THE ID MUST NOT BE `shift-spell`. That id is already taken by a LEVEL-14 WIZARD FEAT of the same
 * name and unrelated content. The record used to `grantsFeats: ['shift-spell']`, which handed an
 * archetype character a wizard feat eleven levels early and STILL left them without the action — the
 * defect that was settled as unfixable rather than fixed. The settle was wrong: `grantsActions` is a
 * live lane on 148 feats pointing into an 879-entry bucket; the record simply had never been imported.
 *
 * The text below is the printed rule, from the Archives mirror via core-descriptions — not from their
 * dump, which is GPL-3.0 and a differ only.
 *
 *   node scripts/backfill-spellshifter-action.mjs           # report
 *   node scripts/backfill-spellshifter-action.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

const ACTION_ID = 'spellshifter-shift-spell';
if (core.actions?.[ACTION_ID]) console.log(`note: actions/${ACTION_ID} already exists — this row replaces it.`);
if (!core.feats?.['spellshifter-dedication']) { console.error('spellshifter-dedication is not in core.json'); process.exit(2); }
/* The collision this id exists to avoid — assert it rather than trust the comment. */
if (!core.feats?.['shift-spell']) console.log('note: feats/shift-spell is absent; the id collision may have been resolved elsewhere.');

const ROWS = [
  {
    category: 'actions',
    /* ⚠ `create: true` AND a top-level `id` — a whole-record row without them is silently ignored by
     * applyBackfill (it falls through to the field-patch branch, finds no `field`, and continues). My
     * first attempt omitted both, so the action was never created while the `grantsActions` row below
     * WAS: the dedication pointed at a record that did not exist, which is the dangling reference this
     * whole fix exists to avoid. */
    create: true,
    id: ACTION_ID,
    value: {
      id: ACTION_ID,
      name: 'Shift Spell',
      traits: ['concentrate', 'manipulate', 'spellshifter'],
      rarity: 'common',
      source: { book: 'Pathfinder Impossible Magic', license: 'ORC' },
      actionCost: { type: 'actions', value: 1 },
      requirements:
        'You are within the affected area of an ongoing spell, or you can physically touch an object or creature under the effects of a spell, and you are holding your conduit.',
      description:
        'Choose a spellshift and attempt an Arcana check against the DC of the spell (or the spell DC of the spellcaster if the spell does not normally have a DC). The caster immediately becomes aware that you are trying to shift their spell and intuitively knows the potential effects of the shift, but not the result of your skill check. A willing caster can allow you to achieve one degree of success higher than the result of your check. The effects of the check depend on the chosen spellshift. Regardless of the result, the spell becomes immune to Shift Spell.',
      edition: 'remaster-era',
      aonOrigin: 'authored',
    },
  },
  { category: 'feats', id: 'spellshifter-dedication', field: 'grantsActions', value: [ACTION_ID] },
  /* The note stays: it names the Share the Burden spellshift, which is a separate printed thing and has
   * no record of its own. Removing it would trade one gap for another. */
];

console.log(`authoring actions/${ACTION_ID} and pointing the dedication at it.`);
if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex(
    (r) => r.category === row.category && (row.id ? r.id === row.id && r.field === row.field : r.value?.id === row.value?.id && !r.field),
  );
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`wrote ${added} new, ${replaced} replaced (${rows.length} rows).`);
