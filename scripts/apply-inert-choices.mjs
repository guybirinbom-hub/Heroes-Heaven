/*
 * Picks that are RECORDED but grant nothing, per the owner's decisions (work/choice-lane/DECISIONS.md):
 *
 *  §2 Kingdom feats — "keep them selectable and DO prompt, storing the choice, even though nothing
 *     consumes it yet. When a Kingdom sheet arrives the answers are already there."
 *  §4 Legacy content referencing something the Remaster deleted — "still offer the choice, but tell
 *     the player plainly that it will not grant the benefit."
 *
 * These use kind 'text' rather than an option list because the app has NO Kingmaker data: no Kingdom
 * skills, no leadership roles. Typing those lists from memory would be inventing content that isn't
 * in the user's own data, so the player supplies the word instead.
 *
 * Only 5 of the 32 kingdom-trait feats actually ask the player to choose anything; the other 27 need
 * nothing. `aon-` twins are included because they are separate records players can pick.
 *
 * Usage: node scripts/apply-inert-choices.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const PATH = 'public/core.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

const KINGDOM_INERT =
  'Recorded for your kingdom. Heroes Heaven has no Kingdom sheet yet, so this pick has no effect on this character.';
const SCHOOL_INERT =
  "Recorded, but it won't grant its benefit: the Remaster removed schools of magic, and only 147 of 1,832 spells still carry one.";

const CHOICES = {
  'civil-service': { flag: 'kingdomLeadershipRole', prompt: 'Supported leadership role', kind: 'text', inert: KINGDOM_INERT },
  'aon-civil-service': { flag: 'kingdomLeadershipRole', prompt: 'Supported leadership role', kind: 'text', inert: KINGDOM_INERT },
  'kingdom-assurance': { flag: 'kingdomAssuranceSkill', prompt: 'Kingdom skill', kind: 'text', inert: KINGDOM_INERT },
  'aon-kingdom-assurance': { flag: 'kingdomAssuranceSkill', prompt: 'Kingdom skill', kind: 'text', inert: KINGDOM_INERT },
  'skill-training-kingdom': { flag: 'kingdomTrainedSkill', prompt: 'Kingdom skill to train', kind: 'text', inert: KINGDOM_INERT },
  // Legacy: "Choose a school of magic other than divination" — the taxonomy no longer exists.
  'warding-rune': { flag: 'wardingRuneSchool', prompt: 'School of magic', kind: 'text', inert: SCHOOL_INERT },
  'aon-warding-rune': { flag: 'wardingRuneSchool', prompt: 'School of magic', kind: 'text', inert: SCHOOL_INERT },
};

const applied = [];
const skipped = [];

for (const [id, choice] of Object.entries(CHOICES)) {
  const rec = db.feats?.[id];
  if (!rec) { skipped.push(`${id} (no such feat)`); continue; }
  // Never overwrite a working choice with an inert one.
  if (rec.choice && !rec.choice.inert) { skipped.push(`${id} (already has a working choice)`); continue; }
  rec.choice = choice;
  applied.push(id);
}

console.log(`applied : ${applied.length}`);
applied.forEach((a) => console.log('  ' + a));
if (skipped.length) { console.log('skipped :'); skipped.forEach((s) => console.log('  ' + s)); }
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(PATH, JSON.stringify(db)); // minified — pretty-printing this file once cost 4 MB
console.log('\nwritten:', PATH);
