/*
 * THE SIX SLINGER'S RELOADS — the signature action of every gunslinger way, granted by none of them.
 *
 * Each way prints its own reload above its Deeds: *"**Slinger's Reload** Reloading Strike"*. The way's
 * `featureIds` carries the three Deeds and stops there, so the action a gunslinger uses every single
 * round reached no sheet. All six action records already exist — only the grant was missing.
 *
 * The pairing is READ FROM THE PRINTED TEXT, not typed from a list: each way's own "Slinger's Reload"
 * line names it, and the name is resolved against core.actions by NAME (not by slugging, which mangles
 * the apostrophe in "Raconteur's Reload" and reports a real record as missing). A way whose reload
 * cannot be resolved is a hard failure rather than a silent skip.
 *
 *   node scripts/backfill-slingers-reload.mjs           # report
 *   node scripts/backfill-slingers-reload.mjs --write
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

/* Action ids by lower-cased NAME — the only join that survives an apostrophe. */
const byName = new Map(Object.entries(core.actions ?? {}).map(([id, a]) => [String(a?.name ?? '').toLowerCase(), id]));

const ways = core.classes?.gunslinger?.subclass?.options ?? [];
if (!ways.length) { console.error('no gunslinger ways in core.json'); process.exit(2); }

const ROWS = [];
const missing = [];
for (const w of ways) {
  const text = String(descs.classFeatures?.[w.id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = /\*\*Slinger's Reload\*\*\s*(.+?)\s*\*\*Deeds/.exec(text);
  if (!m) { missing.push(`${w.id}: no "Slinger's Reload" line in its printed text`); continue; }
  const name = m[1].trim();
  const actionId = byName.get(name.toLowerCase());
  if (!actionId) { missing.push(`${w.id}: names "${name}", which matches no action record`); continue; }
  ROWS.push({ category: 'classFeatures', id: w.id, field: 'grantsActions', value: [actionId] });
  console.log(`  ${w.id.padEnd(24)} ${name.padEnd(22)} -> actions/${actionId}`);
}

if (missing.length) {
  console.error(`\nREFUSING to write — ${missing.length} way(s) could not be resolved:`);
  for (const x of missing) console.error(`   ${x}`);
  process.exit(2);
}

console.log(`\n${ROWS.length} way(s) resolved.`);
if (!WRITE) { console.log('(report only — pass --write to author)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`wrote ${added} new, ${replaced} replaced (${rows.length} rows).`);
