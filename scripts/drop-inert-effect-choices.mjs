/*
 * SIXTEEN MORE RECORDS ASKED THE SAME QUESTION TWICE — this time a bare `choice` beside `effectChoices`.
 *
 * Sibling of drop-inert-skill-choices.mjs, one lane over. There the duplicate was a FEAT_GRANTS
 * `skillChoices` slot; here it is the record's OWN `effectChoices`, whose options carry the grants and
 * do the work, sitting beside a bare `choice` block that the builder also renders and nothing reads.
 * The player picks their element, damage type or tradition twice and the first answer moves nothing.
 *
 * The batches 5–16 parity read named four of these (dualborn, elemental-wrath, arcane-dragonblood,
 * occult-dragonblood). Measuring the shape corpus-wide found twenty, of which sixteen are feats.
 *
 * ⚠ THE PROBE HAD TO BE FIXED BEFORE IT COULD BE BELIEVED. Comparing the whole built Character
 * reported all sixteen as READ — because the character echoes the answer back onto the feat entry
 * (`feats[].choice.value`), so the JSON always differs. That is the answer being STORED, not USED.
 * Comparing only what a read answer would have to move — proficiencies, defences, speeds, spellcasting
 * and strikes — reported all sixteen INERT. A probe that cannot tell storage from use will call every
 * record read and quietly protect every defect.
 *
 * ⚠ AND THE PROBE STILL HAD A BLIND SPOT — molten-wit. It compared proficiencies, defences, speeds,
 * spellcasting and strikes, and reported molten-wit inert. It is not: `CHOICE_FEAT_GRANTS` reads that
 * record's `choice.value` to decide WHICH SKILL FEAT to grant (deception → Charming Liar, diplomacy →
 * Group Impression), and a granted skill feat need not move any of the five things the probe looked
 * at. Removing it broke test/builder-choice-sets.test.ts, which asserts every branch of that table
 * names an option the record actually offers. Restored, and excluded here.
 *
 * The general lesson, for the next sweep of this shape: "the answer changes nothing" is only ever a
 * statement about the projection you compared. Check the GRANT tables that key on `choice.value`
 * (CHOICE_FEAT_GRANTS, choiceGrants) by name before trusting a mechanical diff.
 *
 * molten-wit is a genuine three-lane defect — record `choice` (read, grants the skill feat),
 * `effectChoices` (grants the training) and a featGrantsLane slot — and needs a targeted fix rather
 * than this sweep. It stays on the mismatch list.
 *
 * ⚠ FOUR NON-FEAT RECORDS ARE DELIBERATELY EXCLUDED, pending their own probe: heritages/
 * forge-blessed-dwarf, classFeatures/runelord, classFeatures/warrior-of-legend and
 * backgrounds/local-savior. None is taken through a feat slot, so the probe above does not reach them,
 * and the runelord's Thassilonian sin in particular is load-bearing elsewhere (it selects the
 * curriculum). Removing those on the strength of a measurement that never tested them is exactly the
 * mistake this file's header exists to prevent.
 *
 *   node scripts/drop-inert-effect-choices.mjs [--write]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

/* Proven inert on a built character, mechanically; see the header. */
const INERT = [
  'elemental-wrath', 'spellmasters-resilience', 'dragon-disciple-dedication', 'additional-shadow-magic',
  'determined-lore-seeker', 'animal-swiftness', 'dualborn', 'magical-resistance', 'arcane-locomotion',
  'hold-mark', 'nephilim-resistance', 'war-conditioning', 'draconic-resistance',
  'sublime-mobility', 'unfettered-growth',
];

/* Reads its own choice through a grant table keyed on `choice.value`, which the mechanical probe
 * cannot see. Refused below as well as omitted above, so re-adding the id by hand cannot slip past. */
const READS_ITS_CHOICE = new Set(['molten-wit', 'beast-trainer', 'familiar-master-dedication']);

const rows = [];
const skipped = [];
for (const id of INERT) {
  const rec = core.feats?.[id];
  if (!rec) { skipped.push(`${id}: no such feat`); continue; }
  if (!rec.choice) { skipped.push(`${id}: already has no \`choice\``); continue; }
  if (READS_ITS_CHOICE.has(id)) { skipped.push(`${id}: a grant table keys on its choice.value — refusing`); continue; }
  if ((rec.choice.options ?? []).some((o) => o?.grant)) { skipped.push(`${id}: choice options carry grants — refusing`); continue; }
  /* The surviving lane must exist, or this removes the only picker the record has. */
  if (!(rec.effectChoices ?? []).length) { skipped.push(`${id}: no effectChoices to survive it — refusing`); continue; }
  console.log(`   ${id}  dropping choice{flag:${rec.choice.flag}} — effectChoices ${JSON.stringify((rec.effectChoices ?? []).map((e) => e.id))} keeps the question`);
  rows.push({ category: 'feats', id, field: 'choice', value: null });
}

if (skipped.length) { console.log('\nskipped:'); for (const s of skipped) console.log(`   ${s}`); }
console.log(`\n${rows.length} row(s).`);
if (!rows.length) process.exit(0);
if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }

const all = readBackfill(ROOT);
for (const r of rows) {
  const at = all.findIndex((x) => x.category === r.category && x.id === r.id && x.field === r.field);
  if (at >= 0) all[at] = r; else all.push(r);
}
writeBackfill(ROOT, all);
console.log(`wrote (${all.length} rows).`);
