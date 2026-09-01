/*
 * BATCH 14 RESIDUAL — three records whose printed text names an effect neither side modelled.
 *
 * The parity gates only prove we agree with Wanderer's Guide's ENCODING. Reading each record against
 * its printed text is the other half, and it is where the defects both sides share come out. These
 * three each state a grant in plain words and delivered nothing:
 *
 *   jalmeri-heavenseeker-dedication  *"You gain the Qi Spells monk feat, which grants you a qi spell
 *                                    and a focus pool of 1 Focus Point."* The pool point shipped; the
 *                                    FEAT did not, so the qi spell it asks the player to choose was
 *                                    never offered and the pool had nothing to spend itself on.
 *   clever-improviser                *"You gain the Untrained Improvisation general feat."* Untrained
 *                                    Improvisation is where `untrainedProficiency` lives, so without
 *                                    the grant the whole feat was inert.
 *   empathic-calm                    *"Once per day, you can cast either Calm or Sanctuary as an
 *                                    innate occult spell, heightened to half your level rounded up."*
 *                                    The record carried no innate spell at all.
 *
 *   node scripts/backfill-batch14-residual.mjs --write
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

const ROWS = [
  /* The dedication grants the feat; the feat carries the spell choice. `focusPoolBonus: 1` stays on
   * the dedication because that is where the sentence puts it and Qi Spells itself has none. */
  { category: 'feats', id: 'jalmeri-heavenseeker-dedication', field: 'grantsFeats', value: ['qi-spells'] },

  { category: 'feats', id: 'clever-improviser', field: 'grantsFeats', value: ['untrained-improvisation'] },
  /* The second sentence is a PERMISSION with no number — it lifts the trained requirement on skill
   * actions rather than changing a modifier — so it belongs on the record where the sheet prints it. */
  {
    category: 'feats',
    id: 'clever-improviser',
    field: 'note',
    value: 'You can attempt skill actions that normally require you to be trained, even if you are untrained.',
  },

  {
    category: 'feats',
    id: 'empathic-calm',
    field: 'effectChoices',
    value: [
      {
        id: 'empathic-calm-spell',
        prompt: 'Empathic Calm: choose the innate occult spell you can cast once per day',
        options: [
          { value: 'calm', label: 'Calm', grant: { innateSpells: [{ spellId: 'calm', tradition: 'occult', usesPerDay: 1, heightenHalfLevel: true }] } },
          { value: 'sanctuary', label: 'Sanctuary', grant: { innateSpells: [{ spellId: 'sanctuary', tradition: 'occult', usesPerDay: 1, heightenHalfLevel: true }] } },
        ],
      },
    ],
  },
];

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}

console.log(`${ROWS.length} row(s): ${added} new, ${replaced} replacing an existing row.`);
for (const r of ROWS) console.log(`  ${r.category}/${r.id}.${r.field}`);
if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }
writeBackfill(ROOT, rows);
console.log(`\nwrote ${rows.length} rows.`);
