/*
 * Batch 13, residual pass 3.
 *
 *   exorcist-dedication — a PASSIVE dedication wearing a reaction it does not have.
 *       The record carried `actionCost: {type:'reaction'}`, inherited from the Spirit's Mercy
 *       sub-block embedded in its AoN page. That sub-block already ships as its own record:
 *       `actions/spirits-mercy`, reaction, with `aonParentId: "feat-3454"` and
 *       `aonSection: "Spirit's Mercy"` naming the parent outright. So the player was offered the same
 *       reaction twice — once properly, and once under the dedication's name with no trigger and no
 *       cost line. Same defect family as the six Avenger feats, reached through a sub-block rather
 *       than an `**Activate—X**` line.
 *
 *   overwhelming-harm — *"Whenever you cast the 3-action version of harm, you can extend the area to a
 *       60-foot emanation."* The record held nothing but identity fields, so a necromancer saw nothing
 *       on their Harm spell. `spellNotes` is the built lane for exactly this shape (88 shipped).
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const edits = [
  { category: 'feats', id: 'exorcist-dedication', field: 'actionCost', value: { type: 'passive' } },
  {
    category: 'feats',
    id: 'overwhelming-harm',
    field: 'spellNotes',
    value: [
      {
        spellId: 'harm',
        note: 'Overwhelming Harm: when you cast the 3-action version, you can extend the area to a 60-foot emanation.',
      },
    ],
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
console.log(`${edits.length} edit(s): ${added} added, ${updated} updated (${rows.length} rows).`);
