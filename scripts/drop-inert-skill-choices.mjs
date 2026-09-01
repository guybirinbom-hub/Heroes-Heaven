/*
 * TWELVE RECORDS ASKED THE PLAYER TO CHOOSE A SKILL TWICE, AND IGNORED THE FIRST ANSWER.
 *
 * The batches 5–16 parity read returned 127 confirmed mismatches; around thirty describe one shape,
 * and this is it. captain-dedication, nephilim-lore, wisdom-from-another-life, magic-warrior-dedication
 * and eight more each carry TWO skill pickers:
 *
 *   · the record's own `choice` block — {flag, prompt, options}, no `grant` on any option; and
 *   · a FEAT_GRANTS `skillChoices` slot (sometimes with `redundantFallback`).
 *
 * The builder renders both, so the player answers the same question twice and the record's own answer
 * moves nothing. Their side asks once. Their side is right, and so is the book.
 *
 * ⚠ MEASURED, THEN PROVEN, BEFORE REMOVING ANYTHING. `choice.flag` has at least six readers
 * (choiceGrantFor, traditionFromChoiceFlag, weaponFromChoiceFlag, the two sanctification paths, and the
 * loose lookup at build.ts:6110), so "nothing reads it" is a claim about whichever query I wrote — the
 * dead-reader audit closed at 8 real of 20 for exactly that reason, and a picker I once removed as a
 * "duplicate" turned out to grant EXPERT from an Enhancement tier. So each record here was answered two
 * different ways on a built character and its whole skill block compared: all twelve produced byte-
 * identical proficiencies, and bloodrager-dedication — which carries both lanes but reads its own
 * choice through `choiceGrants` — produced different ones. That record is deliberately NOT touched; it
 * is the shape the others should be compared against.
 *
 * The record's `choice` is what goes, not the slot: the slot is the lane that actually grants, and on
 * seven of the twelve it also carries `redundantFallback`, the conditional "if you would already be
 * trained, choose another skill instead" clause that a bare choice cannot express. The option lists
 * were compared pairwise first — ten are identical, and the two that read `options: 'any'` against a
 * list of all sixteen skills are the same set, both texts saying "a skill of your choice".
 *
 *   node scripts/drop-inert-skill-choices.mjs [--write]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

/* Proven inert by building each character twice with different answers; see the header. */
const INERT = [
  'bright-lion-dedication', 'captain-dedication', 'elemental-lore', 'hellknight-signifer-preferment',
  'learn-by-watching', 'lion-blade-dedication', 'magic-warrior-dedication', 'nephilim-lore',
  'pactbinder-dedication', 'past-life', 'rogue-dedication', 'wisdom-from-another-life',
];

const rows = [];
const skipped = [];
for (const id of INERT) {
  const rec = core.feats?.[id];
  if (!rec) { skipped.push(`${id}: no such feat`); continue; }
  if (!rec.choice) { skipped.push(`${id}: already has no \`choice\``); continue; }
  /* Refuse anything whose options carry their own grant — that is a working lane, not an inert one. */
  if ((rec.choice.options ?? []).some((o) => o?.grant)) {
    skipped.push(`${id}: its choice options carry grants — NOT inert, refusing`);
    continue;
  }
  console.log(`   ${id}  dropping choice{flag:${rec.choice.flag}, ${(rec.choice.options ?? []).length} options}`);
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
