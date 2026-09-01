/*
 * LOCATE LAWBREAKERS GRANTED NOTHING (feats/locate-lawbreakers).
 *
 * *"You gain Locate as an innate spell of a tradition of your choice, which you can cast once per day.
 * If you're a member of the Order of the Gate, when you reach 14th level, the spell is heightened to
 * 5th rank."*
 *
 * The record shipped `innateSpells: []` — an empty array, which is the worst version of missing,
 * because a predicate asking "does this record grant innate spells?" answers yes. The id appears in
 * FEAT_PICK_GRANTS only as one of the fourteen OPTIONS inside the `order-training` picker, never as a
 * grant of its own, so nothing anywhere handed the spell over.
 *
 * WHAT IS BUILT HERE is the part both authorities agree on: a tradition choice granting Locate once
 * per day. Their encoding is `select "Select a Tradition"` with four options, each a giveSpell INNATE
 * of Locate — so four traditions, matching *"a tradition of your choice"*, even though Locate itself
 * is arcane/divine/occult. Offering the fourth follows both the text and them.
 *
 * ⚠ WHAT IS DELIBERATELY NOT BUILT: the 14th-level heightening. Their encoding gates it on LEVEL
 * ALONE (rank 3 below 14, rank 5 at 14+, for every character); the printed text gates it on level AND
 * membership of the Order of the Gate. Encoding it either way is a divergence from one authority or
 * the other, and that is the owner's call, not mine — recorded in work/owner-questions.json. Until he
 * rules, the base grant stands without a ladder, which is the only option that contradicts neither.
 *
 *   node scripts/backfill-locate-lawbreakers.mjs [--write]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

const rec = core.feats?.['locate-lawbreakers'];
if (!rec) { console.error('feats/locate-lawbreakers is missing'); process.exit(2); }
if (!core.spells?.locate) { console.error('spells/locate is missing — refusing to grant a spell that does not exist'); process.exit(2); }
console.log(`spells/locate: rank ${core.spells.locate.rank}, traditions ${(core.spells.locate.traditions ?? []).join('/')}`);
console.log(`current innateSpells: ${JSON.stringify(rec.innateSpells ?? null)}`);

const TRADITIONS = [
  ['arcane', 'Arcane'],
  ['divine', 'Divine'],
  ['occult', 'Occult'],
  ['primal', 'Primal'],
];

const row = {
  category: 'feats',
  id: 'locate-lawbreakers',
  field: 'effectChoices',
  value: [
    {
      id: 'locate-tradition',
      prompt: 'The tradition you cast Locate as (Locate Lawbreakers)',
      options: TRADITIONS.map(([value, label]) => ({
        value,
        label,
        grant: { innateSpells: [{ spellId: 'locate', tradition: value, usesPerDay: 1 }] },
      })),
    },
  ],
};

/* The empty array is what made this invisible to every "does it grant anything?" check. Remove it
 * rather than leave it beside the real grant, so the record has exactly one answer. */
const clear = { category: 'feats', id: 'locate-lawbreakers', field: 'innateSpells', value: null };

console.log(`\nwriting ${row.value[0].options.length} tradition options granting Locate 1/day, and clearing the empty innateSpells.`);
if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }

const rows = readBackfill(ROOT);
for (const r of [row, clear]) {
  const at = rows.findIndex((x) => x.category === r.category && x.id === r.id && x.field === r.field);
  if (at >= 0) rows[at] = r; else rows.push(r);
}
writeBackfill(ROOT, rows);
console.log(`wrote (${rows.length} rows).`);
