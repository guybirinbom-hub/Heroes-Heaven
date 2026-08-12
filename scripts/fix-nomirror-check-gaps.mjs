/*
 * The last few nameless checks: repaired from the FOUNDRY source, which keeps the skill as a macro
 * (`@Check[acrobatics]`) where both our data and the AoN mirror lost it.
 *
 * Deliberately a hand-listed set, not a sweep. Most remaining "attempt a check" sentences are CORRECT
 * — "attempt a check to Recall Knowledge", "to Coerce or Make an Impression" — because the rules name
 * the task and leave the skill to whichever applies. Foundry does carry a macro for several of those
 * too, and using it would narrow what the book leaves open, against ruling H. So each entry below is
 * one I read and judged broken, with the Foundry evidence recorded beside it.
 *
 * Usage: node scripts/fix-nomirror-check-gaps.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatBackfill } from './lib/write-backfill.mjs';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));

/** [bucket, id, the phrase to replace, the phrase to write, the Foundry macro that proves it] */
const FIXES = [
  // A dangling "an" — unambiguously a lost word, not an open rule.
  ['actions', 'boarding-assault', 'attempt an check', 'attempt an Acrobatics check', '@Check[acrobatics]'],
  // "Attempt a check." with nothing after it, then Critical Success. Not a skill at all — a FLAT check.
  ['classFeatures', 'wellspring-magic', 'Attempt a check.', 'Attempt a DC 6 flat check.', '@Check[flat|dc:6]'],
  // "against the creature's Will DC" is mid-clause: the check itself is unnamed.
  ['actions', 'pointed-question', 'Attempt a check against', 'Attempt a Diplomacy check against', '@Check[diplomacy|against:will]'],
  ['classFeatures', 'pointed-question', 'Attempt a check against', 'Attempt a Diplomacy check against', '@Check[diplomacy|against:will]'],
  ['feats', 'opportune-trickster', 'Attempt a check against', 'Attempt a Deception check against', '@Check[deception|against:perception]'],
  // "You must attempt a check, with the following results" — the results are a DC-20 ladder.
  ['items', 'seven-color-raw-fish-salad', 'attempt a check, with', 'attempt a DC 20 Cooking Lore check, with', '@Check[cooking-lore|dc:20]'],
  // Opportune Trickster's SECOND sentence: "you can attempt a check instead of a Deception check" —
  // naming Deception on one side and nothing on the other is plainly a lost word.
  ['feats', 'opportune-trickster', 'attempt a check instead of a Deception check', 'attempt a Thievery check instead of a Deception check', '@Check[thievery|against:perception]'],
  // AoN prints "you attempt a Crafting check"; the remaster rewrote the surrounding sentence, which is
  // why the context anchor could not line the two texts up.
  ['actions', 'craft', 'You attempt a check', 'You attempt a Crafting check', 'AoN: "you attempt a Crafting check"'],
];

const applied = [];
const missed = [];
for (const [bucket, id, from, to, evidence] of FIXES) {
  const rec = core[bucket]?.[id];
  if (!rec) { missed.push(`${bucket}/${id} (no such record)`); continue; }
  const before = String(rec.description ?? '');
  if (!before.includes(from)) {
    // Already fixed, or the wording moved — either way, do not guess at a replacement.
    missed.push(`${bucket}/${id} (phrase "${from}" not present)`);
    continue;
  }
  rec.description = before.replace(from, to);
  applied.push(`${bucket}/${id}: "${to}"  ← ${evidence}`);
}

console.log(`repaired from Foundry: ${applied.length}`);
for (const a of applied) console.log('   ' + a);
if (missed.length) { console.log(`\nskipped: ${missed.length}`); for (const m of missed) console.log('   ' + m); }

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(path.join(ROOT, 'public/core.json'), JSON.stringify(core));

// Overlay-synced, like every other description repair — otherwise `npm run data` reverts them.
const OVERLAY = path.join(ROOT, 'scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
let added = 0;
let updated = 0;
for (const a of applied) {
  const [bucket, id] = a.split(':')[0].split('/');
  const value = core[bucket][id].description;
  const hits = overlay.filter((x) => x.category === bucket && x.id === id && x.field === 'description');
  if (hits.length) { for (const h of hits) h.value = value; updated++; }
  else { overlay.push({ category: bucket, id, field: 'description', value }); added++; }
}
writeFileSync(OVERLAY, formatBackfill(overlay));
console.log(`\noverlay: ${added} added, ${updated} updated`);
console.log('written: public/core.json, scripts/data/effect-backfill.json');
