/*
 * Backgrounds whose granted FEAT depends on which skill you chose.
 *
 * Five print "If you selected X, you gain feat A; if you chose Y, you gain feat B". `grantedFeatId`
 * is a flat value, so every one of them handed out the FIRST branch's feat whatever the player picked
 * — a Society-picking Historical Reenactor still got Impressive Performance.
 *
 * Each mapping is read from the record's own sentence, and every feat id is checked to exist.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** id -> chosen skill -> the feat that branch grants. */
const BY_CHOICE = {
  conservator: { crafting: 'quick-repair', thievery: 'assurance' },
  'dedicated-delver': { athletics: 'combat-climber', survival: 'terrain-expertise' },
  'anti-thrune-saboteur': { deception: 'lengthy-diversion', thievery: 'dirty-trick' },
  'historical-reenactor': { performance: 'impressive-performance', society: 'dubious-knowledge' },
  // Hidden as a near-duplicate, but a character saved before that can still reference it.
  'aon-historical-reeanactor': { performance: 'impressive-performance', society: 'dubious-knowledge' },
};

const db = JSON.parse(readFileSync('public/core.json', 'utf8'));
const patches = [];

for (const [id, map] of Object.entries(BY_CHOICE)) {
  const bg = db.backgrounds?.[id];
  if (!bg) throw new Error(`background ${id} not found`);
  const offered = bg.trainedSkillChoice ?? [];
  for (const [skill, featId] of Object.entries(map)) {
    if (!offered.includes(skill)) throw new Error(`${id}: '${skill}' is not one of its offered skills (${offered.join(', ')})`);
    if (!db.feats[featId]) throw new Error(`${id}: feat '${featId}' does not exist`);
  }
  // Both branches must be covered, or one pick silently grants nothing.
  for (const s of offered) if (!map[s]) throw new Error(`${id}: no feat mapped for '${s}'`);
  bg.grantedFeatByChoice = map;
  patches.push({ category: 'backgrounds', id, field: 'grantedFeatByChoice', value: map });
}

writeFileSync('public/core.json', JSON.stringify(db)); // minified on purpose

const FILE = 'scripts/data/effect-backfill.json';
const existing = JSON.parse(readFileSync(FILE, 'utf8'));
const key = (p) => `${p.category}|${p.id}|${p.field}`;
const mine = new Set(patches.map(key));
writeFileSync(FILE, JSON.stringify([...existing.filter((p) => !mine.has(key(p))), ...patches], null, 2));

console.log(`${Object.keys(BY_CHOICE).length} backgrounds now grant the feat matching your skill pick.`);
