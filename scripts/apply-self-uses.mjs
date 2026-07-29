/*
 * Records whose "once per X" is a limit on THEIR OWN use, and had no field for it.
 *
 * Each was read against its own text. The lane's known false positives are excluded by hand and
 * listed below, because they are the mistakes a regex over this phrase keeps making:
 *
 *   • per-TARGET limits — "a creature attempts this save no more than once per round"
 *     (drifting-pollen), "once per day for each target" (legendary-medic). Not your resource.
 *   • an ALLY's or a COMPANION's use — kindle-inner-flames ("anyone shedding these embers … can
 *     Step as a free action once per round"), psychopomp-eidolon and demon-eidolon (the eidolon
 *     casts, not you).
 *   • a limit inside a sub-option's prose — revolutionary-innovation's "reload once per round" is
 *     one modification's text, not the feature's own frequency.
 *   • a daily RE-CHOICE rather than a use pool — fey-touched-gnome swaps its cantrip each day; that
 *     belongs to the daily-preparations lane, not to use pips.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** id → its own limit. `per` is the printed period. */
const SELF = {
  feats: {
    'ghost-strike': { max: 1, per: 'day' },
    'rampaging-form': { max: 1, per: 'day' },
    'geologic-attunement': { max: 1, per: 'round' },
    'ricocheting-leap': { max: 1, per: 'turn' },
    'greater-physical-evolution': { max: 1, per: 'day' },
    'magical-scrounger': { max: 1, per: 'day' },
    'slay-giants-unseen': { max: 1, per: 'hour' },
    'strategist-stance': { max: 1, per: 'turn' },
    'remake-the-world': { max: 1, per: 'day' },
    'profane-bargain': { max: 1, per: 'day' },
    'ascended-celestial-dedication': { max: 1, per: 'hour' },
    'guarded-domain': { max: 1, per: 'day' },
    'decree-of-banisment': { max: 1, per: 'day' },
    'automatic-writing': { max: 1, per: 'day' },
    'spray-ink': { max: 1, per: 'hour' },
    'harbingers-claw': { max: 1, per: 'day' },
    // "once per day; at 12th level twice per day, at 18th three times per day"
    'fulu-familiar': { max: 1, per: 'day', maxByLevel: { 12: 2, 18: 3 } },
  },
  classFeatures: {
    'patron-theme': { max: 1, per: 'round' },
    'cry-havoc': { max: 1, per: 'day' },
    'executioners-volley': { max: 1, per: 'day' },
    'valkyries-charge': { max: 1, per: 'day' },
    'drink-from-the-chalice': { max: 1, per: 'round' },
  },
  heritages: {
    'sharp-eared-catfolk': { max: 1, per: 'round' },
    'shadow-of-the-courtier': { max: 1, per: 'day' },
  },
};

const db = JSON.parse(readFileSync('public/core.json', 'utf8'));
const patches = [];
let n = 0;

for (const [category, entries] of Object.entries(SELF)) {
  for (const [id, lim] of Object.entries(entries)) {
    const rec = db[category]?.[id];
    if (!rec) throw new Error(`${category}/${id} not found`);
    if (rec.limitedUses) throw new Error(`${category}/${id} already has limitedUses — would overwrite`);
    rec.limitedUses = lim;
    patches.push({ category, id, field: 'limitedUses', value: lim });
    n++;
  }
}

writeFileSync('public/core.json', JSON.stringify(db)); // minified on purpose

const FILE = 'scripts/data/effect-backfill.json';
const existing = JSON.parse(readFileSync(FILE, 'utf8'));
const key = (p) => `${p.category}|${p.id}|${p.field}`;
const mine = new Set(patches.map(key));
writeFileSync(FILE, JSON.stringify([...existing.filter((p) => !mine.has(key(p))), ...patches], null, 2));

console.log(`${n} records gained their own use limit.`);
