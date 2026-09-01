/*
 * HARDENED CHASSIS — a resistance nobody could reach.
 *
 * *"Choose one type of damage among bludgeoning, piercing, or slashing damage. You gain resistance 3
 * to that type of damage. This resistance does not apply if the weapon or unarmed attack is made of
 * adamantine."* The record carried no mechanical field at all: no picker, no resistance.
 *
 * Authored on the record's own `choice`, not `effectChoices` — the per-taking lane. `condition` on the
 * resistance carries the adamantine carve-out, which the IWR breakdown prints beside the number
 * (the same field the trait-gated resistances added in batch 11 use).
 *
 * ⚠ Their side ALSO enumerates `no / yesalltypes / yesincreaseresistance` — a second select asking
 * whether a later feat has upgraded this one. That is their engine threading an upgrade through a
 * question; ours is the upgrading record's business, not this one's, so those three are not offered
 * here. Recorded as a settle rather than copied.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const opt = (t) => ({
  value: t,
  label: t.charAt(0).toUpperCase() + t.slice(1),
  grant: { resistances: [{ type: t, value: 3, condition: 'except against adamantine weapons and unarmed attacks' }] },
});

const edits = [
  {
    category: 'feats',
    id: 'hardened-chassis',
    field: 'choice',
    value: {
      flag: 'hardenedChassisDamage',
      prompt: 'Damage type your chassis resists',
      kind: 'array',
      options: ['bludgeoning', 'piercing', 'slashing'].map(opt),
    },
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
