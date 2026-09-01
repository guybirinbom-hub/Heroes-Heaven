/*
 * WORMSKIN'S SECOND AND THIRD TAKES GRANTED NOTHING.
 *
 * *"You gain resistance equal to half your level versus one of the following types of damage, chosen
 * when you take the feat: fire, cold, or bludgeoning."* `maxTakable: 3`, and the printed Special says
 * a different type each time — but the resistance lived on `effectChoices`, whose answer is stored
 * once per (record, choiceId) and NOT per taking. So a player who spent three feats got one damage
 * type. build.ts:4322 already documents the same limitation for the record's LABEL ("three takes of
 * Wormskin printed 'Wormskin (Cold, Cold, Cold)'"); only the label half had been fixed.
 *
 * THE PER-TAKE LANE ALREADY EXISTS and is the record's own `choice`: its answer rides on the taking
 * (`feats[].choice.value`, keyed by SLOT), and the loop at build.ts:4547 applies the chosen option's
 * `grant` through `applyAlwaysOn` — which merges resistances. So the fix is to move the grant onto the
 * picker that is already per-take, and retire the per-record one.
 *
 * `distinctAcrossTakes: true` is what makes the second take offer the two types not yet chosen, which
 * is the printed Special.
 *
 * ⚠ This record previously carried BOTH pickers — the `choice` asked the same question and granted
 * nothing, which is why it was removed earlier in this batch as an inert duplicate. It comes back
 * here as the REAL one, and the inert half is now the effectChoices.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Half your level, minimum 1 — the same CSP-safe formula the effectChoices options carried. */
const HALF_LEVEL = 'max(1,floor(@actor.level/2))';
const opt = (value, label) => ({
  value,
  label,
  grant: { resistances: [{ type: value, value: HALF_LEVEL }] },
});

const edits = [
  {
    category: 'feats',
    id: 'wormskin',
    field: 'choice',
    value: {
      flag: 'damage',
      prompt: 'Damage type to resist (half your level)',
      kind: 'array',
      distinctAcrossTakes: true,
      options: [opt('fire', 'Fire'), opt('cold', 'Cold'), opt('bludgeoning', 'Bludgeoning')],
    },
  },
  /* The per-RECORD picker retires: it asked the same question and could only ever answer it once. */
  { category: 'feats', id: 'wormskin', field: 'effectChoices', value: null },
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
