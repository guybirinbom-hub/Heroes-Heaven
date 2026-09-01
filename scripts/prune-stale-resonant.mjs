/*
 * Remove `resonant` rows for records that no longer qualify.
 *
 * The first authoring pass matched any sentence containing "resonant", which swept in the family prose
 * that appears on every aeon stone — *"…devices in which aeon stones can be slotted to gain additional
 * resonant powers…"* — and gave the family HEADER record a resonant entry made of boilerplate. The
 * backfill script's own (now tightened) predicate is the authority for who qualifies, so this asks it
 * rather than keeping a second list that could disagree.
 *
 *   node scripts/prune-stale-resonant.mjs           # report
 *   node scripts/prune-stale-resonant.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');

/* The SAME predicate the backfill uses — duplicated logic here would drift from it. */
const clauseOf = (text) => {
  for (const s of text.split(/(?<=[.!?])\s+/)) {
    if (!/\b(?:the|its|this)\s+(?:stone's\s+)?resonant power\b/i.test(s)) continue;
    if (/devices in which|slotted into a special magical item/i.test(s)) continue;
    return s.trim();
  }
  return null;
};

const rows = readBackfill(ROOT);
const stale = [];
const kept = rows.filter((r) => {
  if (r.field !== 'resonant') return true;
  const text = String(descs.items?.[r.id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (clauseOf(text)) return true;
  stale.push(r.id);
  return false;
});

console.log(`${stale.length} stale resonant row(s):`);
for (const id of stale) console.log(`   ${id}  — ${String(core.items?.[id]?.name ?? '')} has no clause of its own`);
if (!stale.length) process.exit(0);
if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }
writeBackfill(ROOT, kept);
console.log(`\nwrote ${kept.length} rows.`);
