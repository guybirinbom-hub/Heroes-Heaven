/*
 * MEASURE: records that ask for a SKILL in their own `choice` block AND in a FEAT_GRANTS slot.
 *
 * The batches 5–16 parity read returned 127 confirmed mismatches, and ~30 of them describe one shape:
 * two "choose a skill" dropdowns on one feat, only one of which grants anything. captain-dedication,
 * nephilim-lore, wisdom-from-another-life, arcane-dragonblood and a long run of dedications all read
 * the same way — the player answers twice and the record's own answer moves nothing.
 *
 * duplicate-pick-check.mjs already guards "one clause, one picker" for TWO lanes: the cantrip registry
 * vs the record's `effectChoices`, and `redundantFallback` vs an `effectChoices` skill picker. What it
 * does not model is the record's bare `choice` block — a plain {flag, prompt, options} picker with no
 * `grant` on its options — sitting beside a FEAT_GRANTS `skillChoices` slot or a `redundantFallback`.
 * That is the third lane, and it is where these ~30 live.
 *
 * ⚠ A BARE `choice` IS NOT AUTOMATICALLY DEAD. `choice.flag` has at least six readers — choiceGrantFor,
 * traditionFromChoiceFlag, weaponFromChoiceFlag, the sanctification path in build.ts and derive.ts, and
 * the loose lookup at build.ts:6110 — so "no reader" is a claim about whichever query I wrote, not
 * about the code (the dead-reader audit closed at 8 real of 20 for exactly this reason). This measures
 * something narrower and checkable instead: the choice OFFERS SKILL NAMES and another lane already
 * trains a skill on the same record. Two skill questions, one clause.
 *
 *   node scripts/measure-choice-vs-slot.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');

const SKILLS = new Set([
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation',
  'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival',
  'thievery',
]);

/* The grant registries, read as source text — a jiti import drags the whole rules graph in for a key list. */
const grantSrc = ['featGrantsAuto.ts', 'featGrants.ts', 'featGrantsLane.ts']
  .map((f) => { try { return readFileSync(join(ROOT, 'src/rules', f), 'utf8'); } catch { return ''; } })
  .join('\n');

/* An entry may span lines, so each id's block is taken up to the next top-level id. */
const grantBlocks = new Map();
{
  const lines = grantSrc.split(/\r?\n/);
  let cur = null;
  let buf = [];
  for (const line of lines) {
    const m = /^\s{2}'([a-z0-9-]+)':\s*\{/.exec(line);
    if (m) { if (cur) grantBlocks.set(cur, buf.join('\n')); cur = m[1]; buf = [line]; continue; }
    if (cur) buf.push(line);
  }
  if (cur) grantBlocks.set(cur, buf.join('\n'));
}

const rows = [];
for (const bucket of ['feats', 'heritages', 'classFeatures', 'backgrounds']) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    const opts = rec?.choice?.options;
    if (!Array.isArray(opts) || !opts.length) continue;
    /* The choice must be asking for SKILLS — every option a skill name, and none of them carrying its
     * own grant (an option with a grant is the working lane, not the inert one). */
    const values = opts.map((o) => String(o?.value ?? '')).filter(Boolean);
    if (!values.length || !values.every((v) => SKILLS.has(v))) continue;
    if (opts.some((o) => o?.grant)) continue;

    const block = grantBlocks.get(id);
    if (!block) continue;
    const hasSlot = /skillChoices\s*:/.test(block);
    const hasFallback = /redundantFallback\s*:\s*true/.test(block);
    if (!hasSlot && !hasFallback) continue;

    /*
     * ⚠ `choiceGrants` MEANS THE RECORD'S OWN CHOICE IS THE WORKING LANE. Without this the measure
     * reported bloodrager-dedication, rogue-dedication and elemental-lore — which are the CORRECT
     * shape, the one the fix for the others should copy: choiceGrantFor (build.ts:4326) reads the
     * record's `choice.value` and applies that option's grant. Flagging the model answer alongside
     * the defects is how a measure gets ignored.
     */
    const readsOwnChoice = /choiceGrants\s*:/.test(block);
    rows.push({
      bucket, id, name: rec.name ?? id, flag: rec.choice.flag,
      lane: [hasSlot && 'skillChoices', hasFallback && 'redundantFallback'].filter(Boolean).join(' + '),
      options: values.length,
      readsOwnChoice,
    });
  }
}

rows.sort((a, b) => a.id.localeCompare(b.id));
const dupes = rows.filter((r) => !r.readsOwnChoice);
const ok = rows.filter((r) => r.readsOwnChoice);

console.log(`${dupes.length} record(s) ask for a skill TWICE — own \`choice\` plus a grant slot, with nothing reading the choice:\n`);
for (const r of dupes) console.log(`   ${r.bucket}/${r.id}  flag=${r.flag}  (${r.options} skills)  slot: ${r.lane}`);

console.log(`\n${ok.length} record(s) carry both but DO read their own choice (choiceGrants) — the correct shape:\n`);
for (const r of ok) console.log(`   ${r.bucket}/${r.id}  flag=${r.flag}`);
console.log(`\n${grantBlocks.size} grant registry entries scanned.`);
