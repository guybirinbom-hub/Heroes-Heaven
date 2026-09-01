/*
 * Batch 13, residual pass 4 — the two records that granted another record's ability twice over.
 *
 *   finishing-precision — *"You gain the Precise Strike class feature but you deal 1 additional damage
 *       on a hit and 1d6 damage on a finisher. THIS DAMAGE DOESN'T INCREASE AS YOU GAIN LEVELS."*
 *       Granting `precise-strike` put the swashbuckler's SCALING star on the strike row beside this
 *       feat's own frozen one, so the sheet stated a number the feat explicitly forbids. The grant is
 *       correct — the character really does have Precise Strike — so what had to go is the other
 *       record's star, which is what the new `suppressesSituational` says.
 *
 *   seeker-of-truths — *"You gain the cleric's Domain Initiate feat but must select knowledge,
 *       secrecy, or truth as your domain."* We modelled it TWICE: `featFeatGrants['seeker-of-truths']
 *       = ['domain-initiate']` renders Domain Initiate's own domain picker, AND the record carried its
 *       own `effectChoices[domain]` whose three options each grant a focus spell. So the player was
 *       asked twice and could come away with two domain spells and two Focus Points where the text
 *       grants one — and the granted feat's picker was not restricted to the three printed domains.
 *       The record's duplicate is removed; the granted Domain Initiate stays.
 *       ⚠ The three-domain restriction on the granted picker is NOT expressible today —
 *       FEAT_GRANT_BOUND_CHOICE binds a granted choice to ONE fixed answer, not to a subset. Left
 *       permissive, which is the picker-filtering side the owner's rule leaves to us, rather than
 *       keeping a duplicate grant that hands out a second focus spell.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const edits = [
  { category: 'feats', id: 'finishing-precision', field: 'suppressesSituational', value: ['precise-strike'] },
  /* `value: null` DELETES the field. */
  { category: 'feats', id: 'seeker-of-truths', field: 'effectChoices', value: null },
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
