/*
 * Speed INCREASES were imported as base Speeds, so none of them did anything.
 *
 * `deriveSpeeds` treats `speeds.land` as a value to raise the base TO (`grant > current` wins), which
 * is right for "your land Speed becomes 10 feet" and wrong for "your Speed increases by 5 feet": a
 * +5 stored as `speeds.land: 5` never beats a 25-foot base, so Fleet, Nimble Elf, Furious Footfalls,
 * Blessed Swiftness and eleven others were completely inert. The additive field is `landSpeedBonus`,
 * which deriveSpeeds already reads from feats, heritages and owned class features.
 *
 * Every entry below was classified against the record's own text. Deliberately NOT converted:
 *   • monk-moves      — "+10 … when you're not wearing armor" is CONDITIONAL; an unconditional bonus
 *                       would over-grant. Belongs to the deferred conditional-speeds lane.
 *   • tillers-drive   — "Your Speed bonus from Bellflower Dedication increases to +10" REPLACES that
 *                       feat's +5; adding 10 would stack to 15.
 *   • awakened-animal, merfolk — 5-foot land Speed is their real ancestry statblock value.
 *
 * Written to scripts/data/effect-backfill.json as well as public/core.json, so a re-import keeps them.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** id → the additive bonus its text describes. */
const TO_BONUS = {
  classFeatures: { 'furious-footfalls': 5, 'blessed-swiftness': 5 },
  feats: {
    'bellflower-dedication': 5,
    'call-of-elysium': 5,
    'animal-swiftness': 5,
    swift: 5,
    'nimble-elf': 5,
    'nimble-hooves': 5,
    fleet: 5,
    'scouts-speed': 10,
    'timewracked-dedication': 5,
  },
  heritages: { 'spindly-anadi': 5, 'fleetwind-centaur': 5, 'shadow-of-the-wanderer': 5 },
};

/**
 * Records that raise your land Speed TO a value rather than BY one. `speeds.land` is additive in
 * deriveSpeeds, so storing these there made a merfolk with Strong Tail walk at 5+15=20 instead of 15.
 * `landSpeedMin` is a floor applied before any bonus.
 */
const SET_LAND = {
  feats: { 'strong-tail': 15 }, // "Your land Speed increases to 15 feet" — was stored as 10
  heritages: { 'cecaelia-merfolk': 10 }, // "Your land Speed becomes 10 feet" — was stored as 5
};

const db = JSON.parse(readFileSync('public/core.json', 'utf8'));
const patches = [];
const push = (category, id, field, value) => patches.push({ category, id, field, value });

for (const [category, entries] of Object.entries(TO_BONUS)) {
  for (const [id, bonus] of Object.entries(entries)) {
    const rec = db[category]?.[id];
    if (!rec) throw new Error(`${category}/${id} not found`);
    // Keep any OTHER movement types the record grants (timewracked's fly/swim/climb/burrow formulas);
    // only the land entry was the mis-typed one.
    const { land: _land, ...rest } = rec.speeds ?? {};
    const speeds = Object.keys(rest).length ? rest : undefined;
    rec.speeds = speeds;
    rec.landSpeedBonus = bonus;
    push(category, id, 'speeds', speeds ?? null);
    push(category, id, 'landSpeedBonus', bonus);
  }
}

for (const [category, entries] of Object.entries(SET_LAND)) {
  for (const [id, land] of Object.entries(entries)) {
    const rec = db[category]?.[id];
    if (!rec) throw new Error(`${category}/${id} not found`);
    const { land: _land, ...rest } = rec.speeds ?? {};
    const speeds = Object.keys(rest).length ? rest : undefined; // keep cecaelia's climb 10
    rec.speeds = speeds;
    rec.landSpeedMin = land;
    push(category, id, 'speeds', speeds ?? null);
    push(category, id, 'landSpeedMin', land);
  }
}

// Minified — pretty-printing core.json once inflated it by 4 MB.
writeFileSync('public/core.json', JSON.stringify(db));

// Merge into the import overlay, replacing any earlier entry for the same (category,id,field).
const FILE = 'scripts/data/effect-backfill.json';
const existing = JSON.parse(readFileSync(FILE, 'utf8'));
const key = (p) => `${p.category}|${p.id}|${p.field}`;
const mine = new Set(patches.map(key));
writeFileSync(FILE, JSON.stringify([...existing.filter((p) => !mine.has(key(p))), ...patches], null, 2));

console.log(`speed fixes: ${Object.values(TO_BONUS).reduce((n, e) => n + Object.keys(e).length, 0)} increases converted to landSpeedBonus, ${Object.values(SET_LAND).reduce((n, e) => n + Object.keys(e).length, 0)} base values corrected (${patches.length} overlay entries).`);
