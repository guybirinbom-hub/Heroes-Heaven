/*
 * SEVEN batch-13 records printed a Prerequisites line and stored none.
 *
 * `prerequisites` is not decoration: the feat-slot eligibility filter reads it, so a record with an
 * empty array is offered to characters who cannot take the feat — an archetype follow-on with no
 * dedication, a Cascade feat to someone with no Arcane Cascade.
 *
 * Found by sweeping the batch's AoN pages for a `**Prerequisites**` line and comparing: 89 of the 100
 * records print one, and these seven had nothing. The phrasing matches the house convention already
 * used by 228 peers — the printed text, lightly normalised ("expert in Crafting", "Captivator
 * Dedication").
 *
 * Writing on the Wall is the one that started it: AoN feat-9186 demands expert in ALL FOUR of Arcana,
 * Nature, Occultism and Religion, which is exactly why its tradition picker offers all four.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PREREQS = {
  'writing-on-the-wall': ['expert in Arcana', 'expert in Nature', 'expert in Occultism', 'expert in Religion'],
  'thrall-charger': ['Necromancer Dedication'],
  'basic-necromancer-spellcasting': ['Necromancer Dedication'],
  'peer-past-the-hedge': ['Hedge Mage Dedication'],
  'improved-communal-healing': ['Communal Healing'],
  'burning-cascade': ['Arcane Cascade'],
  /* Printed lowercase because it names a CLASS FEATURE rather than a feat — kept as printed, the way
   * `advanced-alchemy`'s own peers are. */
  'efficient-alchemy': ['advanced alchemy'],
};

const rows = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const [id, value] of Object.entries(PREREQS)) {
  const e = { category: 'feats', id, field: 'prerequisites', value };
  const at = rows.findIndex((r) => r.category === 'feats' && r.id === id && r.field === 'prerequisites');
  if (at >= 0) { rows[at] = e; updated++; } else { rows.push(e); added++; }
}
writeBackfill(ROOT, rows);
console.log(`${Object.keys(PREREQS).length} prerequisite row(s): ${added} added, ${updated} updated (${rows.length} rows).`);
