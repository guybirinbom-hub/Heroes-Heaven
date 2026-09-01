/*
 * Write the still-open residual findings to work/residual-open.json, enriched with each record's
 * PRINTED TEXT and the fields it currently holds — so a reader has the evidence and the current state
 * side by side and does not have to go find either.
 *
 * Open = a confirmed finding whose id is not in the ledger (work/residual-fixed.json). Unclassified
 * findings are included: needing a lane decided is a reason to read them, not to skip them.
 *
 *   node scripts/residual-open-dump.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));

const findings = read('work/residual-1-12.json').confirmed ?? [];
const fixed = new Set(existsSync(join(ROOT, 'work/residual-fixed.json')) ? read('work/residual-fixed.json') : []);
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');

/* Fields that are bookkeeping rather than mechanics — listing them would drown the real signal. */
const BORING = new Set(['id', 'name', 'level', 'category', 'traits', 'rarity', 'source', 'prerequisites', 'actionCost', 'edition', 'aonId', 'archetype', 'aonUrl', 'aonCategory']);

const open = [];
for (const f of findings) {
  if (fixed.has(f.id)) continue;
  const rec = core[f.bucket]?.[f.id];
  open.push({
    bucket: f.bucket,
    id: f.id,
    missing: f.missing ?? null,
    whereToModel: f.whereToModel ?? null,
    printed: String(descs[f.bucket]?.[f.id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    currentFields: rec ? Object.keys(rec).filter((k) => !BORING.has(k)) : null,
  });
}

writeFileSync(join(ROOT, 'work/residual-open.json'), JSON.stringify(open, null, 1) + '\n');
console.log(`${open.length} open finding(s) -> work/residual-open.json`);
console.log(`  with printed text: ${open.filter((o) => o.printed).length}`);
console.log(`  record missing from core.json: ${open.filter((o) => o.currentFields === null).length}`);
