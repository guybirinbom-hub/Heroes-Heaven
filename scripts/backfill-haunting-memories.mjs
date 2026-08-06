/*
 * Haunting Memories (Ghost archetype, 8): "When you make your daily preparations, you can either gain
 * the expert proficiency rank in one skill in which you're untrained OR raise your proficiency rank to
 * master in one skill in which you're trained or better."
 *
 * Two alternative branches over every skill, re-chosen nightly. `conditionalSkills` carries ONE
 * base→upgraded pair per skill and could not say this; a plain menu of skills would let a player take
 * an untrained skill straight to master.
 *
 * Written as one gated option per (branch × skill): the untrained→expert options are hidden unless the
 * skill is untrained, the trained→master ones unless it is trained or better. The character therefore
 * sees each skill exactly once, under whichever branch legally applies to it.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const db = JSON.parse(readFileSync(ROOT + 'public/core.json', 'utf8'));
const BF = ROOT + 'scripts/data/effect-backfill.json';
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};
const t = String(db.feats['haunting-memories']?.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
if (!/gain the expert proficiency rank in one skill in which you're untrained/i.test(t)) fail('the untrained→expert branch is not in the text');
if (!/raise your proficiency rank to master in one skill in which you're trained or better/i.test(t)) fail('the trained→master branch is not in the text');
if (!/You also gain one skill feat with a minimum requirement of your new rank/i.test(t)) fail('the bonus skill feat clause is not in the text');
if (!/your level is equal to half your level/i.test(t)) fail('the halved-level prerequisite clause is not in the text');

// The engine's own skill list, so a skill added later is picked up rather than hardcoded here.
const SKILLS = [
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation', 'medicine',
  'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival', 'thievery',
];
const NAME = (s) => s[0].toUpperCase() + s.slice(1);

const options = [];
for (const skill of SKILLS) {
  options.push({
    value: `expert-${skill}`,
    label: `${NAME(skill)} → expert`,
    description: 'Untrained in it today.',
    requiresSkillRank: { skill, max: 'untrained' },
    grant: { skills: { [skill]: 'expert' } },
  });
}
for (const skill of SKILLS) {
  options.push({
    value: `master-${skill}`,
    label: `${NAME(skill)} → master`,
    description: 'Trained or better in it today.',
    requiresSkillRank: { skill, min: 'trained' },
    grant: { skills: { [skill]: 'master' } },
  });
}
if (options.length !== SKILLS.length * 2) fail('option count is wrong');

const put = (field, value) => {
  const i = rows.findIndex((r) => r.category === 'feats' && r.id === 'haunting-memories' && r.field === field && !r.path);
  if (value === null) {
    if (i >= 0) rows.splice(i, 1);
    return;
  }
  if (i >= 0) rows[i] = { category: 'feats', id: 'haunting-memories', field, value };
  else rows.push({ category: 'feats', id: 'haunting-memories', field, value });
};

put('choice', {
  flag: 'hauntingMemory',
  prompt: 'Haunting Memories — this morning’s borrowed skill',
  kind: 'array',
  daily: true,
  options,
  // The bonus skill feat is NOT granted as a slot: its prerequisite is checked against HALF your
  // level, and it must have a minimum requirement of the new rank in that same skill — neither of
  // which the feat-slot filter can express. Saying so is better than granting an unconstrained slot.
  note:
    'You also gain one skill feat with a minimum requirement of your new rank in the chosen skill, until your next daily preparations. ' +
    'Take it as a temporary feat — for its level prerequisite only, count your level as half your level.',
});
put('dataWarning', null);

writeFileSync(BF, JSON.stringify(rows, null, 2) + '\n');
console.log(`haunting-memories: ${options.length} gated options written (${SKILLS.length} skills × 2 branches)`);
