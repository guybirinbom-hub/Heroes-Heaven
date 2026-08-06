/*
 * Fourteen modes existed ONLY in core.json — written straight into the bucket by an apply script that
 * never updated the source file. `npm run data` carries hand-authored buckets from the frozen Foundry
 * backup, which has no modes at all, so every regen dropped all 428 of them; they were being restored
 * by hand-run scripts afterwards, and the fourteen orphans had nothing to restore them from.
 *
 * This puts the orphans back in the source files. The importer change alongside it is what makes the
 * whole bucket survive a regen from then on.
 *
 * Reads the modes out of a core.json given on the command line (use a `git show` of the last commit
 * that still had them) so it is re-runnable and never invents content.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/restore-orphan-modes.mjs <path-to-core.json-with-modes>');
  process.exit(1);
}
let raw = readFileSync(src, 'utf8');
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
const modes = JSON.parse(raw).modes ?? {};
if (Object.keys(modes).length < 400) {
  console.error(`REFUSED: ${src} has only ${Object.keys(modes).length} modes — that is not the full bucket`);
  process.exit(1);
}

const CM = ROOT + 'scripts/data/consumable-modes.json';
const TM = ROOT + 'scripts/data/toggle-modes.json';
const consumable = JSON.parse(readFileSync(CM, 'utf8')); // ARRAY, 1-space indent
const toggle = JSON.parse(readFileSync(TM, 'utf8')); // id-keyed OBJECT, 2-space indent

const known = new Set([...consumable.map((m) => m.id), ...Object.keys(toggle)]);
const orphans = Object.entries(modes).filter(([id]) => !known.has(id));

let toCm = 0;
let toTm = 0;
for (const [id, m] of orphans) {
  // An item mode belongs with the consumables; anything else is a toggle.
  if (m.fromItemId) {
    consumable.push({ ...m, id });
    toCm++;
  } else {
    toggle[id] = { ...m };
    delete toggle[id].id; // the object form is keyed by id; carrying it inside would double it
    toTm++;
  }
}
consumable.sort((a, b) => a.id.localeCompare(b.id));

// The two files ship in DIFFERENT shapes and indents. Matching each exactly keeps the diff to the
// rows actually added — writing consumable-modes at 2-space once turned a 16-line change into 6,505.
writeFileSync(CM, JSON.stringify(consumable, null, 1) + '\n');
writeFileSync(TM, JSON.stringify(Object.fromEntries(Object.entries(toggle).sort((a, b) => a[0].localeCompare(b[0]))), null, 2) + '\n');

console.log(`orphans restored: ${orphans.length} (${toCm} → consumable-modes, ${toTm} → toggle-modes)`);
console.log(`sources now hold ${consumable.length + Object.keys(toggle).length} modes`);
