/*
 * Batch 13 — the records whose whole printed effect was a grant that reached nothing.
 *
 * Each of these ships with an EMPTY mechanical record: the feat's one sentence hands the player an
 * impulse, an action, a focus spell or a sense, and our record said nothing at all. Every field below
 * has a live reader, named beside it, and an existing record using the same shape.
 *
 *   base-kinesis            *"You gain the Base Kinesis impulse."*
 *                           -> grantsClassFeatures, read at src/rules/derive.ts:3088 (ownedFeatureIds).
 *                           NOT grantsActions as well: MainTab already surfaces owned class features as
 *                           actions, so both would list the impulse twice.
 *   guards-fury             *"You can use the Rage action."*
 *                           -> grantsActions, the exact shape feats/barbarian-dedication already uses;
 *                           actions/rage is the 1-action activity, classFeatures/rage the passive.
 *   bony-barrage            *"You learn the bony barrage grave spell."*  (spell carries the focus trait)
 *   thrall-charger          *"…thrall charge…"*  — same shape, already shipped for perfected-thrall.
 *                           -> focusSpells, read by applyFeatFocus at src/rules/build.ts:2833, which
 *                           filters on the spell existing, so a bad id drops rather than lingering.
 *                           The focus POOL follows automatically: the pool counts point-costing focus
 *                           spells, and both spells carry the `focus` trait.
 *   tactile-magic-feedback  *"You gain an imprecise sense known as spellsense, which has a range of 60
 *                           feet and detects only creatures capable of casting spells."*
 *                           -> senses, the same shape as draconic-scent's imprecise 30 ft.
 *   peer-past-the-hedge     *"Add the detect magic cantrip to your keepsake."*
 *                           -> spellListAdditions targeted at the hedge mage archetype entry.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const edits = [
  { category: 'feats', id: 'base-kinesis', field: 'grantsClassFeatures', value: ['base-kinesis'] },
  { category: 'feats', id: 'guards-fury', field: 'grantsActions', value: ['rage'] },
  { category: 'feats', id: 'bony-barrage', field: 'focusSpells', value: ['bony-barrage'] },
  { category: 'feats', id: 'thrall-charger', field: 'focusSpells', value: ['thrall-charge'] },
  {
    category: 'feats',
    id: 'tactile-magic-feedback',
    field: 'senses',
    value: [{ name: 'spellsense', range: 60, acuity: 'imprecise' }],
  },
  {
    category: 'feats',
    id: 'peer-past-the-hedge',
    field: 'spellListAdditions',
    value: { spells: ['detect-magic'], as: 'repertoire', entryId: 'hedge-mage-dedication-casting' },
  },
];

const rows = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const e of edits) {
  const at = rows.findIndex((r) => r.category === e.category && r.id === e.id && r.field === e.field);
  if (at >= 0) { rows[at] = e; updated++; } else { rows.push(e); added++; }
}
writeBackfill(ROOT, rows);
console.log(`${edits.length} edit(s): ${added} added, ${updated} updated in place (${rows.length} rows).`);
