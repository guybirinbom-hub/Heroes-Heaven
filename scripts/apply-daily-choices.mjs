/*
 * Marks records whose pick is re-made at DAILY PREPARATIONS with `choice.daily = true`.
 *
 * Only hand-verified entries live here: each one's option list was read off the record's own text in
 * core.json, not inferred. 80 records in the data say "during your daily preparations … choose", so
 * this is the start of a lane, not the end of one — the rest need the same read-the-text treatment.
 *
 * Usage: node scripts/apply-daily-choices.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const PATH = 'public/core.json';

/** flag names are stable storage keys — renaming one orphans every character's stored answer. */
const DAILY = {
  'environmental-adaptability': {
    flag: 'environmentalAdaptation',
    prompt: 'Protected from which environment today?',
    kind: 'array',
    daily: true,
    options: [
      { value: 'cold', label: 'Severe cold', description: 'Protected from the effects of severe cold until your next daily preparations (extreme cold from 12th level).' },
      { value: 'heat', label: 'Severe heat', description: 'Protected from the effects of severe heat until your next daily preparations (extreme heat from 12th level).' },
    ],
  },
  'mask-of-power': {
    flag: 'maskOfPowerSpell',
    prompt: "Today's warmask spell",
    kind: 'array',
    daily: true,
    options: [
      { value: 'fear', label: 'Fear', description: 'Cast Fear as a 1st-rank innate spell once per day while wearing your warmask.' },
      { value: 'phantom-pain', label: 'Phantom Pain', description: 'Cast Phantom Pain as a 1st-rank innate spell once per day while wearing your warmask.' },
      { value: 'sure-strike', label: 'Sure Strike', description: 'Cast Sure Strike as a 1st-rank innate spell once per day while wearing your warmask.' },
    ],
  },
};

const db = JSON.parse(readFileSync(PATH, 'utf8'));
const applied = [];
const missing = [];

for (const [id, choice] of Object.entries(DAILY)) {
  const rec = db.feats?.[id];
  if (!rec) { missing.push(id); continue; }
  // Never clobber an existing build-time choice — that would silently move a settled pick to nightly.
  if (rec.choice && !rec.choice.daily) { missing.push(`${id} (already has a non-daily choice)`); continue; }
  rec.choice = choice;
  applied.push(`${id} → ${choice.options.length} options`);
}

console.log('applied:');
applied.forEach((a) => console.log('  ' + a));
if (missing.length) { console.log('SKIPPED:'); missing.forEach((m) => console.log('  ' + m)); }
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
// Minified on purpose: pretty-printing this file once inflated it 21.9 MB → 25.9 MB.
writeFileSync(PATH, JSON.stringify(db));
console.log('\nwritten:', PATH);
