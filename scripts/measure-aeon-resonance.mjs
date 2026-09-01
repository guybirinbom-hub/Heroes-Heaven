/*
 * MEASURE the aeon-stone resonant powers before choosing a carrier for them.
 *
 * 53 aeon stones, 40 with a printed resonant power, and NONE of it modelled. A resonant power applies
 * only *"when slotted into a special magical item called a wayfinder"* — a state the sheet does not
 * hold today. Before building anything, this asks what the 40 clauses actually DO, because the shape
 * of the carrier should follow the data rather than the first record read.
 *
 *   node scripts/measure-aeon-resonance.mjs [--list]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');
const LIST = process.argv.includes('--list');

/* The resonant clause is its own sentence, introduced by "resonant". */
const clauseOf = (text) => {
  for (const s of text.split(/(?<=[.!?])\s+/)) if (/\bresonant\b/i.test(s) && !/slotted into a special magical item/i.test(s)) return s.trim();
  return null;
};

const SHAPES = [
  ['innate spell', /as an? (?:arcane|divine|occult|primal) innate (?:spell|cantrip)/i],
  ['skill bonus', /\+\d+ (?:item|status|circumstance) bonus to [A-Z]/],
  ['resistance', /\bresistance \d+/i],
  ['other bonus', /\+\d+ (?:item|status|circumstance) bonus/i],
  ['sense', /\b(darkvision|low-light vision|see invisibility|tremorsense)\b/i],
  ['always-succeeds / degree', /\b(critical success|always succeed|success instead)\b/i],
];

const rows = [];
for (const [id, rec] of Object.entries(core.items ?? {})) {
  const text = String(descs.items?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!/^aeon-stone/.test(id) && !/aeon stone/i.test(String(rec?.name ?? ''))) continue;
  const clause = clauseOf(text);
  if (!clause) continue;
  const shapes = SHAPES.filter(([, re]) => re.test(clause)).map(([n]) => n);
  rows.push({ id, clause, shapes: shapes.length ? shapes : ['(unclassified)'] });
}

const byShape = {};
for (const r of rows) for (const s of r.shapes) byShape[s] = (byShape[s] ?? 0) + 1;

console.log(`${rows.length} aeon stone(s) with a resonant clause.\n`);
console.log('what the clause does:');
for (const [s, n] of Object.entries(byShape).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${s}`);

if (LIST) {
  console.log('\n--- every clause:');
  for (const r of rows) {
    console.log(`\n  ${r.id}  [${r.shapes.join(', ')}]`);
    console.log(`     ${r.clause.slice(0, 200)}`);
  }
}
