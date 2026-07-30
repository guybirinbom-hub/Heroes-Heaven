/*
 * Undoes the first (ordinal) skill-name repair so the corrected, context-anchored one can run clean.
 *
 * The first pass matched the Nth AoN label to the Nth gap. That is wrong wherever AoN names a skill in
 * one phrase and deliberately leaves another open — it shifted a label into the open one. Rather than
 * try to unpick which of the 140 were affected, every repaired description is put back to "verb a[n]
 * check" form and the corrected pass re-derives them all from AoN.
 *
 * Usage: node scripts/revert-skill-repairs.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));
const OVERLAY = path.join(ROOT, 'scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));

// Only the phrases the repair could have produced: a verb, an article, a Capitalised label (or a DC
// and one), then "check". Anything already lowercase was never ours to touch.
const REPAIRED = /\b(Roll|roll|attempt|Attempt|make|Make)\s+an?\s+((?:DC\s+\d+\s+)?[A-Z][A-Za-z' -]{2,28}?)\s+(checks?)\b/g;

let reverted = 0;
const dropped = [];
for (let i = overlay.length - 1; i >= 0; i--) {
  const patch = overlay[i];
  if (patch.field !== 'description') continue;
  const rec = core[patch.category]?.[patch.id];
  if (!rec) continue;
  const before = String(rec.description ?? '');
  const after = before.replace(REPAIRED, (_w, verb, _label, noun) => `${verb} a ${noun}`);
  if (after === before) continue;
  rec.description = after;
  overlay.splice(i, 1); // the corrected pass re-adds its own patch
  dropped.push(`${patch.category}/${patch.id}`);
  reverted++;
}

console.log(`reverted ${reverted} descriptions and removed their overlay patches`);
if (DRY) { console.log('--dry: nothing written'); process.exit(0); }
writeFileSync(path.join(ROOT, 'public/core.json'), JSON.stringify(core));
writeFileSync(OVERLAY, JSON.stringify(overlay, null, 2) + '\n');
console.log('written: public/core.json, scripts/data/effect-backfill.json');
