/*
 * Remove named rows from scripts/data/effect-backfill.json.
 *
 * Used to pull back proposals that passed the FIELD validator but failed the test suite — the
 * validator can prove a field exists in types.ts, it cannot prove the VALUE has the right shape. The
 * suite is what catches an object where an array belongs, a dangling id, or (in one case) an array of
 * backfill rows nested as a value.
 *
 *   node scripts/revert-backfill-rows.mjs                 # report what would go
 *   node scripts/revert-backfill-rows.mjs --write
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

/* Each entry says WHY, because a bare id list would let a bad revert hide as tidying. */
const DROP = [
  ['classFeatures', 'mystery', 'grantsFeats', 'the value is an ARRAY OF BACKFILL ROWS, not a feat-id list — a nesting error. The underlying claim (each mystery grants its revelation feats) may be real and needs re-proposing per mystery record.'],
  ['classFeatures', 'gunslingers-way', 'featureIds', 'an object keyed by subclass where an id array belongs; the per-way grant needs the subclass-variant lane, not this field.'],
  ['feats', 'basic-death-dealing', 'prerequisites', 'value nests {prerequisites, archetype} inside the prerequisites field — two fields collapsed into one.'],
  ['feats', 'basic-rune-magic', 'prerequisites', 'same nesting error as basic-death-dealing.'],
  ['heritages', 'ancient-scale-azarketi', 'grantsActions', 'names `arrange-phosphorescent-spots`, which does not exist in core.actions — the proposal said so itself and grants it anyway. Needs the action record authored first.'],
  ['feats', 'spellshifter-dedication', 'grantsFeats', 'a null REMOVAL that broke a referential-integrity expectation; the removal needs its own justification.'],
  ['feats', 'necromancer-dedication', 'focusSpells', 'double-pays the focus pool — the create-thrall point is already accounted for elsewhere.'],
  ['feats', 'brilliant-crafter', 'classDcRank', 'adds a `level` key the field does not carry; the existing {classId, rank} is the shape the reader and its test use.'],
  ['feats', 'eye-of-ozem', 'modifiesGrant', 'held back pending a check that the `scout` actionRider lane reads this shape.'],
  /*
   * Collides with a TESTED existing mechanic. The record already carries `focusPoolBonus: 1`, and
   * `grantsFocusByChoice` suppresses that bonus when a choice's options are focus spells — precisely to
   * stop the pool being paid twice. Adding the choice therefore SHRANK the animist pool from 3 to 2.
   * The school-spell pick may still be worth modelling, but not by re-introducing the double-count the
   * suppression exists to prevent.
   */
  ['feats', 'universal-versatility', 'choice', 'adding this choice suppresses the record\'s existing focusPoolBonus via grantsFocusByChoice, dropping the animist focus pool from 3 to 2.'],
];

/*
 * RESTORATIONS. Dropping a row is not the same as undoing a change: eleven of the authored rows
 * REPLACED pre-existing backfill rows, so deleting them left the field absent rather than back at its
 * old value. `brilliant-crafter.classDcRank` was only ever supplied by such a row, and removing it
 * made the field undefined — a worse state than either version. Anything reverted here that had a
 * previous value has to be put back explicitly.
 */
const RESTORE = [
  { category: 'feats', id: 'brilliant-crafter', field: 'classDcRank', value: { classId: 'inventor', rank: 'expert' } },
];

const rows = readBackfill(ROOT);
const before = rows.length;
const kept = [];
const gone = [];
for (const r of rows) {
  const hit = DROP.find(([c, i, f]) => r.category === c && r.id === i && r.field === f);
  if (hit) gone.push(hit);
  else kept.push(r);
}

console.log(`${gone.length} of ${DROP.length} named row(s) present; ${before} -> ${kept.length} rows.\n`);
for (const [c, i, f, why] of DROP) {
  const found = gone.some(([c2, i2, f2]) => c2 === c && i2 === i && f2 === f);
  console.log(`  ${found ? 'DROP' : ' -- '}  ${c}/${i}.${f}`);
  console.log(`        ${why}`);
}

for (const r of RESTORE) {
  const at = kept.findIndex((k) => k.category === r.category && k.id === r.id && k.field === r.field);
  if (at >= 0) kept[at] = r;
  else kept.push(r);
  console.log(`\n  RESTORE  ${r.category}/${r.id}.${r.field} = ${JSON.stringify(r.value)}`);
}

if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }
writeBackfill(ROOT, kept);
console.log(`\nwrote ${kept.length} rows.`);
