/*
 * Batch 13, residual pass — defects the parity comparers structurally cannot see.
 *
 * The gate compares us against Wanderer's Guide. Where NEITHER side models a printed clause, it has
 * nothing to say, and this project's measured residual defect rate is ~11.5%. These came out of
 * reading all 100 records against their printed text, each finding then put to three refuters.
 *
 *   fast-movement (the BARBARIAN feat, not the familiar ability of the same name)
 *       *"While you are raging, you gain a +10-foot status bonus to your Speed."* The record carried
 *       NO mechanical field — its only registry hit is a display star, and that file's own header
 *       says it changes no computed number. So the Speed on the sheet never moved when rage came on.
 *       `whileActive[].speeds` is the lane nine records already use (raging-athlete is the neighbour),
 *       applied additively to land Speed in derive.ts.
 *
 *   worm-sense
 *       *"…tremorsense as an imprecise sense within 5 feet. The range of the tremorsense increases to
 *       10 feet at 8th level and to 15 feet at 12th level."* Authored at a flat 5, so a 12th-level
 *       character read 5 where the book says 15. `SenseEntry` had no way to say this at all — the new
 *       `rangeAt` ladder is resolved against the character in deriveDefenses.
 *
 *   basic-red-mantis-magic
 *       The character received FOUR divine cantrips instead of two. `red-mantis-assassin-dedication`
 *       already carries `cantrips: 2` in CASTER_ARCHETYPES, which the archetype entry delivers; these
 *       two `effectChoices` then handed out two MORE as at-will innate spells. Every other
 *       `basic-*-spellcasting` record leaves the cantrips to the archetype lane. Removed.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const edits = [
  {
    category: 'feats',
    id: 'fast-movement',
    field: 'whileActive',
    value: [{ state: 'rage', speeds: { land: 10 } }],
  },
  {
    category: 'feats',
    id: 'worm-sense',
    field: 'senses',
    value: [
      { name: 'darkvision' },
      {
        name: 'tremorsense',
        range: 5,
        acuity: 'imprecise',
        rangeAt: [
          { level: 8, range: 10 },
          { level: 12, range: 15 },
        ],
      },
    ],
  },
  /* `value: null` DELETES the field — the two cantrips are the archetype's, not this record's. */
  { category: 'feats', id: 'basic-red-mantis-magic', field: 'effectChoices', value: null },
];

const rows = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const e of edits) {
  const at = rows.findIndex((r) => r.category === e.category && r.id === e.id && r.field === e.field);
  if (at >= 0) { rows[at] = e; updated++; } else { rows.push(e); added++; }
}
writeBackfill(ROOT, rows);
console.log(`${edits.length} edit(s): ${added} added, ${updated} updated (${rows.length} rows).`);
