/*
 * Backgrounds printing "trained in either X or Y" that stored a single fixed skill.
 *
 * Sixteen backgrounds print an either/or skill; fourteen already use `trainedSkillChoice`. Two stored
 * one of the two options as a flat `trainedSkill`, so the player was never asked and half of them got
 * the wrong skill.
 *
 * Found because a new overlay-drift test flagged aon-historical-reeanactor: the import overlay said
 * `performance` while core.json said `society` — a silent disagreement where the next regeneration
 * would have flipped the shipped value. Neither was right.
 *
 * NOT fixed here, and worth its own lane: four of these backgrounds grant a DIFFERENT feat depending
 * on the skill picked ("If you selected Performance, you gain Impressive Performance; if you chose
 * Society, Dubious Knowledge"). `grantedFeatId` is a flat value, so they all grant the first branch.
 * Conservator, Dedicated Delver, Anti-Thrune Saboteur and Historical Reenactor are affected.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** id -> the two skills the text offers, in printed order. */
const CHOICES = {
  // "You're trained in either the Arcana skill or Occult skill" — Occult names the Occultism skill.
  'spell-seeker': ['arcana', 'occultism'],
  // The typo'd AoN twin of historical-reenactor. It is hidden from pickers as a near-duplicate, but a
  // character saved before that could still reference it, so it should be right rather than merely unseen.
  'aon-historical-reeanactor': ['performance', 'society'],
};

const db = JSON.parse(readFileSync('public/core.json', 'utf8'));
const patches = [];

for (const [id, skills] of Object.entries(CHOICES)) {
  const bg = db.backgrounds?.[id];
  if (!bg) throw new Error(`background ${id} not found`);
  const text = String(bg.description ?? '').replace(/<[^>]+>/g, ' ').toLowerCase();
  // Both skills must actually appear in the record's own text, or this is guessing.
  for (const s of skills) {
    const printed = s === 'occultism' ? /occult/ : new RegExp(s);
    if (!printed.test(text)) throw new Error(`${id}: '${s}' is not named in its description`);
  }
  delete bg.trainedSkill;
  bg.trainedSkillChoice = skills;
  patches.push({ category: 'backgrounds', id, field: 'trainedSkill', value: null });
  patches.push({ category: 'backgrounds', id, field: 'trainedSkillChoice', value: skills });
}

writeFileSync('public/core.json', JSON.stringify(db)); // minified on purpose

const FILE = 'scripts/data/effect-backfill.json';
const existing = JSON.parse(readFileSync(FILE, 'utf8'));
const key = (p) => `${p.category}|${p.id}|${p.field}`;
const mine = new Set(patches.map(key));
writeFileSync(FILE, JSON.stringify([...existing.filter((p) => !mine.has(key(p))), ...patches], null, 2));

console.log(`${Object.keys(CHOICES).length} backgrounds now offer their printed skill choice.`);
