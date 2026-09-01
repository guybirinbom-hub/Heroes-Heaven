/*
 * OCCULT EVOLUTION ASKED FOR A SKILL TWICE.
 *
 * *"You become trained in a skill of your choice."* The record carried its own `choice`
 * {flag:'occultEvolutionSkill', kind:'skills'} — offering only skills the character is ALREADY trained
 * in, and granting nothing — beside the FEAT_GRANTS `skillChoices` slot that actually trains. Two
 * pickers for one clause, and the working one is the second. Their side asks once.
 *
 * ⚠ WHY A ROW AND NOT A TEXT EDIT. The overlay already holds a row SETTING this choice, so appending a
 * removal row would leave the file with two rows for one field, contradicting each other, and which
 * one won would depend on order. `writeBackfill` upserts by (category, id, field), so writing the
 * removal row REPLACES the setter in place — one row, one answer. `value: null` REMOVES a field rather
 * than setting it to null; see the note in import-core-v2.
 *
 *   node scripts/drop-occult-evolution-choice.mjs [--write]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

const rec = core.feats?.['occult-evolution'];
if (!rec) { console.error('feats/occult-evolution is missing'); process.exit(2); }
/* Refuse if the surviving lane is not there — removing the only picker would be worse than the duplicate. */
const grantSrc = readFileSync(join(ROOT, 'src/rules/featGrantsAuto.ts'), 'utf8');
if (!/'occult-evolution':[^\n]*skillChoices/.test(grantSrc)) {
  console.error('refusing: featGrantsAuto has no skillChoices slot for occult-evolution, so its `choice` is the only picker.');
  process.exit(1);
}

console.log(`current choice: ${JSON.stringify(rec.choice ?? null)}`);
const rows = readBackfill(ROOT);
const at = rows.findIndex((r) => r.category === 'feats' && r.id === 'occult-evolution' && r.field === 'choice');
console.log(at >= 0 ? `replacing the existing setter row at index ${at}` : 'no existing row — appending a removal');
if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }

const row = { category: 'feats', id: 'occult-evolution', field: 'choice', value: null };
if (at >= 0) rows[at] = row; else rows.push(row);
writeBackfill(ROOT, rows);
console.log(`wrote (${rows.length} rows).`);
