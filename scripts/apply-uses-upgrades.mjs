/*
 * Feats that RETUNE another feat's use limit, plus a few that were missing their own.
 *
 * Thirty records read like "You can use Cat's Luck once per hour, rather than once per day". They had
 * no field at all, so they did nothing — and giving them a `limitedUses` of their own would have been
 * worse, inventing a second pool beside the one they were meant to replace. `usesUpgrade` points at
 * the target feat instead.
 *
 * Every row below was read against the record's own text in core.json and its target confirmed to
 * exist as a FEAT with a limit to retune.
 *
 * NOT included, with reasons:
 *   • mighty-dragon-shape / determined-lore-seeker — they retune an INNATE SPELL's frequency
 *     (shape-of-the-dragon grants Dragon Form 1/day), which lives on innateSpells.usesPerDay, not on
 *     a feat limit. Needs its own lane; a feat-targeted upgrade here would silently do nothing.
 *   • unbelievable-luck — its target (Accidental Shot) is an Action, not a feat.
 *   • unlimited-esoterica, school-of-unified-magical-theory, cunning-trickster-mask — these change an
 *     ACTION COST ("as a free action rather than a single action"), not a frequency.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** upgrade feat id → { featId: target, ...new limit } */
const UPGRADES = {
  'incredible-luck-halfling': { featId: 'halfling-luck', max: 1, per: 'hour' },
  'continuous-assault': { featId: 'elemental-assault', max: 1, per: 'hour' },
  'unbelievable-escape': { featId: 'lucky-escape', max: 1, per: 'hour' },
  'incredible-ferocity': { featId: 'orc-ferocity', max: 1, per: 'hour' },
  'rapid-pheromone-recovery': { featId: 'emit-defensive-odor', max: 1, per: 'hour' },
  'reliable-luck': { featId: 'cats-luck', max: 1, per: 'hour' },
  'jinx-glutton': { featId: 'eat-fortune', max: 1, per: 'hour' },
  'memory-of-mastery': { featId: 'memory-of-skill', max: 1, per: 'hour' },
  'this-too-shall-pass': { featId: 'all-this-will-happen-again', max: 1, per: 'hour' },
  'jotuns-restoration': { featId: 'caretakers-restoration', max: 1, per: 'hour' },
  // "once per 10 minutes" — a period the plain union can't say, hence LimitedUses.every.
  'stormy-heart': { featId: 'invoke-the-elements', max: 1, per: 'minute', every: 10 },
  'consistent-surge': { featId: 'nanite-surge', max: 1, per: 'minute', every: 10 },
  'greater-despair': { featId: 'mummys-despair', max: 1, per: 'minute', every: 10 },
  // "three times per day instead of once per day"
  'forever-among-humanity': { featId: 'among-humanity', max: 3, per: 'day' },
  'many-guises-kitsune': { featId: 'shifting-faces', max: 3, per: 'day' },
  // "at all times, rather than just once per day for 10 minutes" — the limit is gone, not zeroed.
  'eternal-wings': { featId: 'divine-wings', unlimited: true },
  'eternal-wings-nephilim': { featId: 'divine-wings', unlimited: true },
  'eternal-wings-sylph': { featId: 'wings-of-air', unlimited: true },
};

/**
 * Limits a record states about ITSELF that were never stored. All-This-Will-Happen-Again's own
 * "once per day" is only visible in the text of the feat that upgrades it; the rest print their
 * frequency in a sentence the prose parser skipped because it also contains "rather than".
 */
const SELF = {
  'all-this-will-happen-again': { max: 1, per: 'day' },
  'persistent-mutagen': { max: 1, per: 'day' },
  'high-speed-regeneration': { max: 1, per: 'day' },
  'hypnotic-gaze': { max: 1, per: 'day' },
  'seasoned-command': { max: 1, per: 'hour' },
};

const db = JSON.parse(readFileSync('public/core.json', 'utf8'));
const patches = [];

for (const [id, up] of Object.entries(UPGRADES)) {
  const feat = db.feats[id];
  if (!feat) throw new Error(`upgrade feat ${id} not found`);
  const target = db.feats[up.featId];
  if (!target) throw new Error(`${id} targets ${up.featId}, which is not a feat`);
  // An upgrade with nothing to upgrade is a silent no-op — exactly the failure this replaces.
  if (!target.limitedUses && !SELF[up.featId]) throw new Error(`${id} targets ${up.featId}, which has no limitedUses to retune`);
  feat.usesUpgrade = up;
  patches.push({ category: 'feats', id, field: 'usesUpgrade', value: up });
}

for (const [id, lim] of Object.entries(SELF)) {
  const feat = db.feats[id];
  if (!feat) throw new Error(`feat ${id} not found`);
  feat.limitedUses = lim;
  patches.push({ category: 'feats', id, field: 'limitedUses', value: lim });
}

writeFileSync('public/core.json', JSON.stringify(db)); // minified on purpose

const FILE = 'scripts/data/effect-backfill.json';
const existing = JSON.parse(readFileSync(FILE, 'utf8'));
const key = (p) => `${p.category}|${p.id}|${p.field}`;
const mine = new Set(patches.map(key));
writeFileSync(FILE, JSON.stringify([...existing.filter((p) => !mine.has(key(p))), ...patches], null, 2));

console.log(`${Object.keys(UPGRADES).length} feats now retune another feat's limit; ${Object.keys(SELF).length} gained their own.`);
