/*
 * VIVACIOUS SPEED'S ALWAYS-ON HALF WAS A NUMBER NOBODY GOT (classFeatures/vivacious-speed).
 *
 * *"Increase the status bonus to your Speeds from stylish combatant to a +10-foot status bonus; this
 * bonus increases by 5 feet at 7th, 11th, 15th, and 19th levels. WHEN YOU DON'T HAVE PANACHE, YOU
 * STILL GET HALF THIS STATUS BONUS TO YOUR SPEED, ROUNDED DOWN TO THE NEAREST 5-FOOT INCREMENT."*
 *
 * The record carried no numeric speed at all — only a star restating the whole clause as prose. The
 * owner's rule is verbatim *"we give an actual speed only when it's always; if it is dependent on
 * something it's in a *"*, and the half IS always on: it applies whether or not you have panache. So a
 * 19th-level swashbuckler standing without panache read 25 ft on our sheet where the book gives 40.
 *
 * The two halves are now split the way the rule says:
 *   · the always-on floor  -> a real number, `landSpeedBonus` (this row);
 *   · the panache-dependent remainder -> the star, reworded so the sheet does not state the floor
 *     twice. The established wording for a starred bonus whose base is already counted is
 *     "(already in your total; …)" — see the clarity-goggles-greater / mirror-goggles stars.
 *
 * THE ARITHMETIC, checked at every tier against the printed sentence (full -> half -> rounded down to
 * a 5-foot increment):  L3-6 10->5 · L7-10 15->5 · L11-14 20->10 · L15-18 25->10 · L19+ 30->15.
 * So the floor is 5 / 10 / 15 with steps at 11th and 19th — which is exactly WG's two UNCONDITIONAL
 * ops ([L>=11 -> +10], [L>=19 -> +15]) plus the ELSE branch (+5) of their panache conditional, read
 * through status bonuses not stacking. Their sheet shows the same number ours now does.
 *
 * ⚠ A FLAT NUMBER CANNOT SAY THIS, which is why `landSpeedBonus` had to accept a formula: the field
 * was typed `number`, so the 11th- and 19th-level steps had no carrier and the whole clause stayed
 * prose. The formula vocabulary is the one every other speed value already uses (`resolveFormula`).
 *
 *   node scripts/backfill-vivacious-speed.mjs [--write]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

const rec = core.classFeatures?.['vivacious-speed'];
if (!rec) { console.error('classFeatures/vivacious-speed is missing'); process.exit(2); }
if (rec.level !== 3) { console.error(`the feature is gained at level ${rec.level}, not 3 — the formula's base tier assumes 3`); process.exit(2); }

/* 5 at 3rd-10th, 10 at 11th-18th, 15 at 19th+. Written as one expression rather than three rows so the
 * ladder cannot be half-applied. */
const FORMULA = '5+5*min(2,floor((@actor.level-3)/8))';

/** The printed full bonus at a level, and the half the record owes when you have no panache. */
const printedFull = (lvl) => 10 + 5 * [7, 11, 15, 19].filter((t) => lvl >= t).length;
const printedHalf = (lvl) => Math.floor(printedFull(lvl) / 2 / 5) * 5;
/* Evaluate the formula the way resolveFormula does, rather than trusting it by eye. */
const evalFormula = (lvl) => 5 + 5 * Math.min(2, Math.floor((lvl - 3) / 8));

const bad = [];
for (let lvl = 3; lvl <= 20; lvl++) {
  if (evalFormula(lvl) !== printedHalf(lvl)) bad.push(`L${lvl}: formula ${evalFormula(lvl)} vs printed ${printedHalf(lvl)}`);
}
if (bad.length) { console.error(`refusing — the formula does not match the printed half:\n  ${bad.join('\n  ')}`); process.exit(2); }
console.log('formula checked at every level 3-20 against the printed half:');
console.log(`  ${[3, 7, 11, 15, 19, 20].map((l) => `L${l} full ${printedFull(l)} -> half ${printedHalf(l)}`).join(' · ')}`);

const rows = [
  { category: 'classFeatures', id: 'vivacious-speed', field: 'landSpeedBonus', value: FORMULA },
];

console.log(`\nlandSpeedBonus = ${FORMULA}`);
console.log('⚠ the star in src/rules/situationalBonuses.ts must be reworded in the same change, or the sheet states the floor twice.');
if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }

const all = readBackfill(ROOT);
for (const r of rows) {
  const at = all.findIndex((x) => x.category === r.category && x.id === r.id && x.field === r.field);
  if (at >= 0) all[at] = r; else all.push(r);
}
writeBackfill(ROOT, all);
console.log(`wrote (${all.length} rows).`);
