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
  // --- Kitsune / Nagaji innate-spell chains: each prints an explicit three-spell list. -------------
  // Every spell id below was checked against db.spells before being written here.
  'kitsune-spell-familiarity': {
    flag: 'kitsuneFamiliaritySpell', prompt: "Today's kitsune cantrip", kind: 'array', daily: true,
    options: [
      { value: 'daze', label: 'Daze' },
      { value: 'forbidding-ward', label: 'Forbidding Ward' },
      { value: 'ghost-sound', label: 'Ghost Sound' },
    ],
  },
  'kitsune-spell-mysteries': {
    flag: 'kitsuneMysteriesSpell', prompt: "Today's kitsune spell", kind: 'array', daily: true,
    options: [
      { value: 'bane', label: 'Bane' },
      { value: 'illusory-object', label: 'Illusory Object' },
      { value: 'sanctuary', label: 'Sanctuary' },
    ],
  },
  'kitsune-spell-expertise': {
    flag: 'kitsuneExpertiseSpell', prompt: "Today's kitsune spell", kind: 'array', daily: true,
    options: [
      { value: 'confusion', label: 'Confusion' },
      { value: 'death-ward', label: 'Death Ward' },
      { value: 'illusory-scene', label: 'Illusory Scene' },
    ],
  },
  'nagaji-spell-familiarity': {
    flag: 'nagajiFamiliaritySpell', prompt: "Today's nagaji cantrip", kind: 'array', daily: true,
    options: [
      { value: 'daze', label: 'Daze' },
      { value: 'detect-magic', label: 'Detect Magic' },
      { value: 'telekinetic-hand', label: 'Telekinetic Hand' },
    ],
  },
  'nagaji-spell-mysteries': {
    flag: 'nagajiMysteriesSpell', prompt: "Today's nagaji spell", kind: 'array', daily: true,
    options: [
      { value: 'charm', label: 'Charm' },
      { value: 'fleet-step', label: 'Fleet Step' },
      { value: 'heal', label: 'Heal' },
    ],
  },
  'nagaji-spell-expertise': {
    flag: 'nagajiExpertiseSpell', prompt: "Today's nagaji spell", kind: 'array', daily: true,
    options: [
      { value: 'flicker', label: 'Flicker' },
      { value: 'control-water', label: 'Control Water' },
      { value: 'subconscious-suggestion', label: 'Subconscious Suggestion' },
    ],
  },
  // --- Free text: the option set is open, so an enumerated list would be a lie. --------------------
  // "gain the trained proficiency rank in one Lore skill of your choice" — Lore subjects are open-ended.
  'quick-study': { flag: 'quickStudyLore', prompt: "Today's Lore subject", kind: 'text', daily: true },
  // "choose a single crossbow or firearm" — which one depends on what you own.
  'call-gun': { flag: 'calledGun', prompt: 'Bonded crossbow or firearm', kind: 'text', daily: true },

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
  applied.push(`${id} → ${choice.kind === 'text' ? 'free text' : `${choice.options.length} options`}`);
}

console.log('applied:');
applied.forEach((a) => console.log('  ' + a));
if (missing.length) { console.log('SKIPPED:'); missing.forEach((m) => console.log('  ' + m)); }
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
// Minified on purpose: pretty-printing this file once inflated it 21.9 MB → 25.9 MB.
writeFileSync(PATH, JSON.stringify(db));
console.log('\nwritten:', PATH);
