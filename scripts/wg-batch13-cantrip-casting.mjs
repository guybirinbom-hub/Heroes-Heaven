/*
 * Cantrip Casting's two cantrips belong to the ARCHETYPE entry, not the character's class pool.
 *
 * Printed: *"You gain two additional cantrips from the tradition matching your trait."* The trait is
 * the archetype's, so the cantrips are cast with the archetype's spellcasting — and until now the row
 * carried no `entryId`, so build.ts:5391 skipped it for the archetype entry and the generic loop at
 * build.ts:5189 handed the two cantrips to the character's own CLASS pool instead. A wizard taking
 * this feat got two extra ARCANE class cantrips they never earned; a fighter got nowhere to put them.
 *
 * Pointing it at `cantrip-casting-casting` — the id the new CASTER_ARCHETYPES entry builds — lands
 * them on the archetype entry, whose tradition is the one the player answered.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const edit = {
  category: 'feats',
  id: 'cantrip-casting',
  field: 'spellSlotBonus',
  value: { cantrips: 2, entryId: 'cantrip-casting-casting' },
};

const rows = readBackfill(ROOT);
const at = rows.findIndex((r) => r.category === edit.category && r.id === edit.id && r.field === edit.field);
if (at >= 0) rows[at] = edit; else rows.push(edit);
writeBackfill(ROOT, rows);
console.log(`cantrip-casting spellSlotBonus -> archetype entry (${at >= 0 ? 'updated' : 'added'}; ${rows.length} rows).`);
