/*
 * Batch 13, residual pass 2.
 *
 *   walk-the-wilds
 *       `spellListAdditions` carried no `entryId`, and the reader falls back to the first FOCUS entry.
 *       An animist ALWAYS has one (built from the primary apparition's vessel spell), so Animal Form
 *       landed in the Focus-spell entry and read as a Focus-Point spell — instead of the apparition
 *       repertoire it is cast from. Pointed at `animist-apparition-casting`, the id the other
 *       archetype-targeted additions already use.
 *
 *   wormskin
 *       The record carried TWO pickers for one printed choice: `choice` {flag:'damage'} and
 *       `effectChoices[resistance]`, with the same three damage types. Only the effectChoices options
 *       carry a `grant`, and nothing anywhere reads the `choice` — no record uses `fromChoiceFlag:
 *       'damage'`. So the player was asked the same question twice and one of the answers did nothing.
 *       The inert one is removed; the granting one stays.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const edits = [
  {
    category: 'feats',
    id: 'walk-the-wilds',
    field: 'spellListAdditions',
    value: { spells: ['animal-form'], as: 'repertoire', entryId: 'animist-apparition-casting' },
  },
  /* `value: null` DELETES the field — see apply-backfill.mjs. */
  { category: 'feats', id: 'wormskin', field: 'choice', value: null },
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
