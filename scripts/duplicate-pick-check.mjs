/*
 * GUARD: ONE CLAUSE, ONE PICKER.
 *
 * A record can ask the player to choose a spell in two independent ways:
 *   · `FEAT_CANTRIP_GRANTS` in src/rules/featCantripGrants.ts — a registry-driven picker;
 *   · the record's own `effectChoices`, whose options carry `grant.innateSpells`.
 *
 * Both are rendered by the builder and both are read by buildCharacter, which dedupes only by SPELL
 * ID. So a record in both lanes asks the same question twice, and a player who answers the two
 * prompts differently is granted BOTH spells — from a clause that grants one. The Moon Weaver's Art
 * shipped exactly that: two occult innate spells at 1/day where the printed text names a choice of one.
 *
 * FAILS when any record appears in both lanes.
 *
 *   node scripts/duplicate-pick-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');

/* Ids with a registry-driven spell picker. Read as source text: the registry is a plain object
 * literal and a jiti import would drag the whole rules graph in for one key list. */
const src = readFileSync(join(ROOT, 'src/rules/featCantripGrants.ts'), 'utf8');
const registry = new Set();
for (const line of src.split(/\r?\n/)) {
  const m = /^\s*'([a-z0-9-]+)':\s*\{/.exec(line);
  if (m) registry.add(m[1]);
}

const bad = [];
for (const id of registry) {
  const rec = core.feats?.[id] ?? core.heritages?.[id] ?? core.classFeatures?.[id];
  if (!rec) continue;
  /* The record's own choice lane, in either of its two shapes. */
  const grantsSpell =
    (rec.effectChoices ?? []).some((ec) => (ec.options ?? []).some((o) => o?.grant?.innateSpells?.length)) ||
    (rec.choice?.options ?? []).some((o) => o?.grant?.innateSpells?.length);
  if (grantsSpell) bad.push(id);
}

/*
 * …AND THE SAME SHAPE FOR SKILLS, which is where the parity read found three more.
 *
 * A record printing *"you become trained in X; IF YOU WOULD ALREADY BE TRAINED, choose another skill
 * instead"* has exactly one correct carrier: `redundantFallback` on its FeatGrant, which fires only
 * when the grant really is redundant. Some records carried that AND a standing `effectChoices` skill
 * picker that trained a second skill unconditionally — so a character who was NOT already trained got
 * the printed skill plus a free extra one. Gemsoul, Warren Navigator and Creative Prodigy all did.
 */
const grantSrc = ['featGrantsAuto.ts', 'featGrants.ts', 'featGrantsLane.ts']
  .map((f) => { try { return readFileSync(join(ROOT, 'src/rules', f), 'utf8'); } catch { return ''; } })
  .join('\n');
const withFallback = new Set();
for (const m of grantSrc.matchAll(/^\s*'([a-z0-9-]+)':\s*\{[^\n]*redundantFallback:\s*true/gm)) withFallback.add(m[1]);

/*
 * ⚠ THE TEST IS THE RANK, not merely "it grants a skill". A fallback replacement always grants
 * `trained`, because that is the rank the redundant grant would have given. Automaton Lore carries an
 * ENHANCEMENT-gated picker whose options grant the chosen skill at EXPERT — a different clause wearing
 * the same shape — and a rank-blind check flagged it, which is how a guard teaches people to ignore it.
 * A group the record's `enhancement` block points at is skipped outright.
 */
const skillBad = [];
for (const id of withFallback) {
  const rec = core.feats?.[id] ?? core.heritages?.[id] ?? core.classFeatures?.[id];
  if (!rec) continue;
  const enhanced = new Set([].concat(rec.enhancement?.choiceIds ?? []));
  const duplicates = (rec.effectChoices ?? []).some(
    (ec) =>
      !enhanced.has(ec.id) &&
      (ec.options ?? []).some((o) => o?.grant?.skills && Object.keys(o.grant.skills).length) &&
      (ec.options ?? []).every((o) => !o?.grant?.skills || Object.values(o.grant.skills).every((r) => r === 'trained')),
  );
  if (duplicates) skillBad.push(id);
}

/*
 * …AND THE THIRD LANE: THE RECORD'S BARE `choice` BLOCK.
 *
 * The two checks above compare a registry against the record's `effectChoices`. Neither models the
 * record's own `choice` — a plain {flag, prompt, options} picker whose options carry NO grant — sitting
 * beside a FEAT_GRANTS `skillChoices` slot. The batches 5–16 parity read found twelve records in that
 * state: two "choose a skill" dropdowns on one feat, the record's answer moving nothing, where their
 * side asks once. captain-dedication, nephilim-lore, past-life, wisdom-from-another-life and eight more.
 *
 * ⚠ `choiceGrants` IS THE EXEMPTION, AND IT IS THE POINT. `choiceGrantFor` (build.ts:4326) reads the
 * record's own `choice.value` and applies that option's grant, so a record carrying both lanes AND a
 * choiceGrants map is the CORRECT shape, not a defect — bloodrager-dedication is the one record that
 * does it, and flagging the model answer alongside the defects is how a guard teaches people to ignore
 * it. An option that carries its own `grant` is likewise a working lane and is skipped.
 *
 * The check is narrow on purpose: both lanes must be asking for SKILLS. `choice.flag` has at least six
 * readers, so "nothing reads this flag" is a claim about the query rather than about the code; "the
 * record asks for a skill and something else already trains one" is checkable from the data.
 */
const SKILL_KEYS = new Set([
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation',
  'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival',
  'thievery',
]);

/* An entry's block runs from its own `'id': {` line to the next top-level one — a registry entry spans
 * many lines, and a single-line regex would miss `skillChoices` two lines down. */
const grantBlocks = new Map();
{
  let cur = null;
  let buf = [];
  for (const line of grantSrc.split(/\r?\n/)) {
    const m = /^\s{2}'([a-z0-9-]+)':\s*\{/.exec(line);
    if (m) { if (cur) grantBlocks.set(cur, buf.join('\n')); cur = m[1]; buf = [line]; continue; }
    if (cur) buf.push(line);
  }
  if (cur) grantBlocks.set(cur, buf.join('\n'));
}

const choiceBad = [];
for (const [id, rec] of Object.entries(core.feats ?? {})) {
  const opts = rec?.choice?.options;
  if (!Array.isArray(opts) || !opts.length) continue;
  if (opts.some((o) => o?.grant)) continue;
  const values = opts.map((o) => String(o?.value ?? '')).filter(Boolean);
  if (!values.length || !values.every((v) => SKILL_KEYS.has(v))) continue;
  const block = grantBlocks.get(id);
  if (!block) continue;
  if (/choiceGrants\s*:/.test(block)) continue;
  if (!/skillChoices\s*:/.test(block) && !/redundantFallback\s*:\s*true/.test(block)) continue;
  choiceBad.push(id);
}

console.log(`${registry.size} record(s) carry a registry spell picker; ${withFallback.size} carry a redundant-skill fallback.`);
if (choiceBad.length) {
  console.log(`\nduplicate-pick: FAIL — ${choiceBad.length} record(s) ask for a skill in TWO lanes:\n`);
  for (const id of choiceBad) console.log(`   ${id}  — its own \`choice\` block AND a FEAT_GRANTS skill slot`);
  console.log('\nThe record\'s `choice` is the one to drop: the slot is what actually grants, and it can');
  console.log('carry `redundantFallback`, the conditional clause a bare choice cannot express. Prove the');
  console.log('choice is inert first — build the character with two different answers and compare the');
  console.log('skill block — then remove it with a `{"field":"choice","value":null}` overlay row.');
  console.log('If the record\'s own choice SHOULD be the working lane, give its grant a `choiceGrants`');
  console.log('map instead (the bloodrager-dedication shape) and drop the slot.');
  process.exit(1);
}
if (skillBad.length) {
  console.log(`\nduplicate-pick: FAIL — ${skillBad.length} record(s) model one "if already trained" clause TWICE:\n`);
  for (const id of skillBad) console.log(`   ${id}  — redundantFallback on its grant AND an effectChoices skill picker`);
  console.log('\nKeep the grant\'s `redundantFallback`: it is conditional, which is what the sentence says.');
  console.log('A standing picker trains a second skill even when the first grant was not redundant.');
  process.exit(1);
}
if (!bad.length) {
  console.log('duplicate-pick: ok — no record asks the same question in two lanes.');
  process.exit(0);
}
console.log(`\nduplicate-pick: FAIL — ${bad.length} record(s) ask twice and can grant twice:\n`);
for (const id of bad) console.log(`   ${id}  — in FEAT_CANTRIP_GRANTS and in its own effectChoices`);
console.log('\nKeep ONE. The record\'s own choice is usually the better home; remove the registry entry.');
process.exit(1);
