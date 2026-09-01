/*
 * GUARD: a skill slot marked `options: 'any'` whose printed text NAMES the skills.
 *
 * An unrestricted slot is not harmless. `featSkillChoiceValue` (build.ts:1324) resolves an UNANSWERED
 * slot to `opts[0]`, and for `'any'` that is SKILLS[0] — acrobatics. So a feat that prints *"trained
 * in either Diplomacy or Intimidation"* but ships `options: 'any'` silently trains every holder who
 * never opened the picker in ACROBATICS, and in neither skill the feat actually offers. Nephilim Lore
 * shipped exactly that.
 *
 * A genuinely open choice (*"a skill of your choice"*) is correct as `'any'` and is not flagged: the
 * test is whether the printed text names a CLOSED list.
 *
 *   node scripts/unrestricted-skill-slot-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEAT_GRANTS } from '../src/rules/featGrants';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const descs = read('public/core-descriptions.json');

const SKILL_WORDS = ['Acrobatics', 'Arcana', 'Athletics', 'Crafting', 'Deception', 'Diplomacy', 'Intimidation', 'Medicine', 'Nature', 'Occultism', 'Performance', 'Religion', 'Society', 'Stealth', 'Survival', 'Thievery'];

/*
 * Ids whose RESOLVED grant carries an `options: 'any'` slot.
 *
 * ⚠ Read the merged FEAT_GRANTS, never the registry source text. HAND_AUTHORED_GRANTS is spread LAST
 * (featGrants.ts:581) and REPLACES the auto entry wholesale, so a feat can carry `options: 'any'` in
 * featGrantsAuto.ts and a correct closed `choiceGrants` in the hand-authored table. Reading raw lines
 * reported exactly one such feat — battle-harbinger-dedication — as broken when it is already right.
 */
const ids = new Set();
for (const [id, g] of Object.entries(FEAT_GRANTS)) {
  if ((g?.skillChoices ?? []).some((s) => s?.options === 'any')) ids.add(id);
}

/* *"either X or Y"*, *"your choice of X or Y"*, *"choose X, Y, or Z"* — a CLOSED printed list. */
const CLOSED = /\b(?:either|your choice of|choice of|choose(?: one of)?)\b[^.]{0,90}?\b(?:or|and)\b/i;

const bad = [];
for (const id of [...ids].sort()) {
  const text = String(descs.feats?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!text) continue;
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (!/\btrained\b|\bexpert\b/i.test(sentence)) continue;
    if (!CLOSED.test(sentence)) continue;
    const named = SKILL_WORDS.filter((s) => new RegExp(`\\b${s}\\b`).test(sentence));
    if (named.length >= 2) { bad.push({ id, named, sentence: sentence.trim().slice(0, 170) }); break; }
  }
}

console.log(`${ids.size} record(s) carry an unrestricted \`options: 'any'\` skill slot.`);
if (!bad.length) {
  console.log("unrestricted-skill-slot: ok — every 'any' slot is a genuinely open printed choice.");
  process.exit(0);
}
console.log(`\nunrestricted-skill-slot: FAIL — ${bad.length} name a CLOSED list but offer every skill.`);
console.log('An unanswered slot silently grants Acrobatics (SKILLS[0]); restrict the options to what is printed:\n');
for (const b of bad) {
  console.log(`   ${b.id}  -> printed names: ${b.named.join(', ')}`);
  console.log(`      ${b.sentence}`);
}
process.exit(1);
