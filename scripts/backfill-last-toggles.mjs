/*
 * The last four toggles from the batch-2 coverage sweep.
 *
 * 108 were deferred in 2026-07 because "toggles are undeliverable as data": item toggles needed a
 * `core.modes` entry with `fromItemId`, feat toggles needed `feats: [id]` gating, and neither
 * existed. Both lanes exist now — 329 item modes and 198 toggle modes ship — and re-measuring the
 * deferred list against them leaves exactly FOUR records still with no toggle.
 *
 * Only one needed engine work: iron wine rides extra damage on the unarmed attacks you already have,
 * which `grantedStrikes` (a NEW attack) cannot express. `ModeDef.strikeDamage` now carries it.
 *
 * The other three are honest notes: a temp-HP grant the player applies, a curse whose text
 * suppresses your own fire resistance, and a dedication whose stance grants an attack.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CORE = 'public/core.json';
const ITEM_MODES = 'scripts/data/consumable-modes.json';
const TOGGLE_MODES = 'scripts/data/toggle-modes.json';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const fail = (m) => {
  console.error(`REFUSING TO WRITE — ${m}`);
  process.exit(1);
};
const text = (cat, id) => {
  const r = core[cat]?.[id];
  if (!r) fail(`${cat}/${id} does not ship`);
  return String(r.description ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
const must = (cat, id, re) => {
  const t = text(cat, id);
  if (!re.test(t)) fail(`${cat}/${id} no longer matches ${re}\n  text: ${t.slice(0, 180)}`);
  return t;
};

/* ---- iron wine ------------------------------------------------------------------------------- */
// "your unarmed attacks to deal an additional 1d4 fire damage for the duration" (10 minutes), and
// "Drinking more than one cup ... gives you weakness 5 to fire until your next daily preparations."
const wine = must('items', 'iron-wine', /additional 1d4 fire damage/i);
const wineMin = wine.match(/next (\d+) minutes/i);
if (!wineMin) fail('iron-wine no longer states its duration in minutes');
const wineWeak = wine.match(/weakness (\d+) to fire until your next daily preparations/i);
if (!wineWeak) fail('iron-wine no longer states the second-cup weakness');

const itemModes = {
  'item-iron-wine': {
    id: 'item-iron-wine',
    name: 'Iron Wine',
    fromItemId: 'iron-wine',
    duration: `${wineMin[1]} minutes`,
    modifiers: [],
    strikeDamage: [{ type: 'fire', appliesTo: 'unarmed', dice: { n: 1, die: 'd4' }, note: 'Iron wine' }],
    note: 'Your sweat ignites with the slightest friction.',
  },
  'item-iron-wine-second-cup': {
    id: 'item-iron-wine-second-cup',
    name: 'Iron Wine (second cup)',
    fromItemId: 'iron-wine',
    duration: 'until your next daily preparations',
    // Its printed duration outlasts a night, so the rest that is meant to end it must not wipe it.
    survivesRest: true,
    modifiers: [],
    weaknesses: [{ type: 'fire', value: Number(wineWeak[1]) }],
    note: 'A second cup in one day: the fire that helps you also burns you.',
  },
};

/* ---- stone brawler --------------------------------------------------------------------------- */
// "You gain the Stonestrike Stance action." The stance is a separate ACTION record, so the stance
// list — which keys on the FEAT — never found it.
must('feats', 'stone-brawler-dedication', /Stonestrike Stance/i);
const stance = must('actions', 'stonestrike-stance', /1d8 bludgeoning/i);
const traits = ['forceful', 'magical', 'unarmed'].filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(stance));
if (traits.length !== 3) fail(`stonestrike-stance no longer lists forceful/magical/unarmed: ${traits.join(', ')}`);
if (!/brawling group/i.test(stance)) fail('stonestrike-stance is no longer in the brawling group');

const toggleModes = {
  'stonestrike-stance': {
    id: 'stonestrike-stance',
    name: 'Stonestrike Stance',
    feats: ['stone-brawler-dedication'],
    exclusiveGroup: 'stance',
    modifiers: [],
    grantedStrikes: [{ name: 'Stonestrike', dice: 1, die: 'd8', damageType: 'bludgeoning', group: 'brawling', traits }],
    note: 'Requires standing on the ground.',
  },
  'inexorable-iron': {
    id: 'inexorable-iron',
    name: 'Inexorable Iron',
    // A classFeature, not a feat — gated by the feature id the same way.
    feats: ['inexorable-iron'],
    duration: 'while in Arcane Cascade',
    modifiers: [],
    note: 'Wielding a melee weapon in two hands: temporary HP equal to half your level (minimum 1) on entering Arcane Cascade and at the start of each of your turns in it.',
  },
  'curse-of-engulfing-flames': {
    id: 'curse-of-engulfing-flames',
    name: 'Engulfing Flames (cursebound)',
    feats: ['curse-of-engulfing-flames'],
    modifiers: [],
    // The suppression is the part no field can carry: it turns your OWN fire resistance off.
    note: 'While cursebound: persistent fire damage equal to your cursebound value, and your fire immunity and resistance are suppressed.',
  },
};

must('classFeatures', 'inexorable-iron', /temporary Hit Points equal to half your level/i);
must('classFeatures', 'curse-of-engulfing-flames', /persistent fire damage equal to your cursebound value/i);

/* ---- write ----------------------------------------------------------------------------------- */
const all = { ...itemModes, ...toggleModes };
for (const [id, m] of Object.entries(all)) {
  if (core.modes?.[id]) fail(`modes/${id} already exists — this script would overwrite it`);
  if (m.fromItemId && !core.items[m.fromItemId]) fail(`${id} points at a missing item ${m.fromItemId}`);
  for (const f of m.feats ?? []) {
    if (!core.feats[f] && !core.classFeatures[f]) fail(`${id} gates on ${f}, which is neither a feat nor a class feature`);
  }
}

core.modes = core.modes ?? {};
for (const [id, m] of Object.entries(all)) core.modes[id] = m;
writeFileSync(CORE, JSON.stringify(core));

// The two files ship in DIFFERENT shapes — consumable-modes.json is an ARRAY, toggle-modes.json is
// an id-keyed OBJECT. Writing the wrong shape would be dropped silently at the next merge.
const mergeInto = (file, entries) => {
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  let next;
  if (Array.isArray(prev)) {
    const byId = new Map(prev.map((m) => [m.id, m]));
    for (const [id, m] of Object.entries(entries)) byId.set(id, m);
    next = [...byId.values()];
  } else {
    next = { ...prev };
    for (const [id, m] of Object.entries(entries)) next[id] = m;
  }
  writeFileSync(file, JSON.stringify(next, null, 1) + '\n');
  console.log(`  ${file} → ${Array.isArray(next) ? next.length : Object.keys(next).length} entries`);
};
mergeInto(ITEM_MODES, itemModes);
mergeInto(TOGGLE_MODES, toggleModes);

for (const id of Object.keys(all)) console.log(`  + modes/${id}`);
console.log(`wired ${Object.keys(all).length} modes (core.modes now ${Object.keys(core.modes).length})`);
