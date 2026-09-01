/*
 * Five action-cost repairs, found by `scripts/actioncost-vs-aon.mjs` and by the Mercy/Cruelty pair.
 *
 * TWO SHAPES OF DEFECT, opposite symptoms:
 *
 *   A. STORED AS PASSIVE, ACTUALLY AN ACTION. The encounter action list is built from records whose
 *      own `actionCost` is 1–3 actions, a reaction or a free action, so a passive one is on the sheet
 *      and nowhere a player looks for something to do on their turn. AoN states the cost outright in
 *      its page title, and each of these three was read there and confirmed against the body text:
 *        · dazzling-block         Free Action    "Trigger You use Shield Block."
 *        · heightened-captivation Single Action  "If your next action is to cast a non-cantrip spell…"
 *        · decree-of-banishment   Single Action  "Speak your decree; a creature you designate…"
 *
 *   B. STORED AS AN ACTION, ACTUALLY PASSIVE — Cruelty, the twin of Mercy.
 *      *"You can cast Touch of the Void targeting a living creature using 2 actions instead of 1. If
 *      you do, the target is also Enfeebled 1 for 1 minute if it fails its save (Enfeebled 2 if it
 *      critically fails)."* The extra action is spent on the SPELL; the feat costs nothing. Both were
 *      single-action metamagics in their LEGACY printing, which is where the stored 1 came from.
 *      Mercy's row was corrected in an earlier pass and Cruelty's was not, so the two halves of one
 *      printing disagreed. Cruelty also gains the `spellNotes` clause Mercy already had, so the rider
 *      appears on the spell it modifies rather than only in the feat's own description.
 *
 * ⚠ NOT REPAIRED, deliberately — `rallying-charge` and `rallying-charge-knight-vigilant`. AoN's badge
 * says Two Actions for both, but that is the MARSHAL's Rallying Charge page, which both of our records
 * are paired to by slug. Both of ours are the Knight Vigilant feat, whose text modifies Lead the Way
 * and takes no action of its own. Passive is right for both. (They are also near-duplicates of each
 * other, one of them carrying unparsed prose — a separate defect, reported rather than guessed at.)
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const edits = [
  { category: 'feats', id: 'dazzling-block', field: 'actionCost', value: { type: 'free' } },
  { category: 'feats', id: 'heightened-captivation', field: 'actionCost', value: { type: 'actions', value: 1 } },
  { category: 'feats', id: 'decree-of-banishment', field: 'actionCost', value: { type: 'actions', value: 1 } },
  { category: 'feats', id: 'cruelty', field: 'actionCost', value: { type: 'passive' } },
  {
    category: 'feats',
    id: 'cruelty',
    field: 'spellNotes',
    value: [
      {
        spellId: 'touch-of-the-void',
        note: 'Cruelty: you can cast this spell targeting a living creature using 2 actions instead of 1. If you do, the target is also enfeebled 1 for 1 minute if it fails its save (enfeebled 2 if it critically fails).',
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
console.log(`effect-backfill.json: ${added} added, ${updated} updated in place (${rows.length} rows).`);
