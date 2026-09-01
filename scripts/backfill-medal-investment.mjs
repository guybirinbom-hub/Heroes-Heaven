/*
 * THE MAGICAL MEDALS COUNT AS ONE INVESTED ITEM, NOT FIVE.
 *
 * *"No matter how many magical medals you have, they collectively count as one invested item."* The
 * cap is enforced for real — InventoryTab disables the Invest button at ten — so each medal consumed
 * a slot and a decorated soldier lost half their investments to their own decorations.
 *
 * The set is COMPUTED from the shared printed sentence rather than typed from an id list, so a sixth
 * medal arriving in a data refresh joins the group automatically instead of quietly costing a slot.
 *
 *   node scripts/backfill-medal-investment.mjs           # report
 *   node scripts/backfill-medal-investment.mjs --write
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

const CLAUSE = /magical medals you have,? they collectively count as one invested item/i;

const ROWS = [];
for (const [id, rec] of Object.entries(core.items ?? {})) {
  if (!(rec?.traits ?? []).includes('invested')) continue;
  const text = String(descs.items?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!CLAUSE.test(text)) continue;
  ROWS.push({ category: 'items', id, field: 'investmentGroup', value: 'magical-medal' });
}

if (!ROWS.length) { console.error('no item prints the collective-investment clause — the text changed, or the read is broken'); process.exit(2); }

console.log(`${ROWS.length} item(s) share one investment slot:`);
for (const r of ROWS) console.log(`   ${r.id}`);

if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`\nwrote ${added} new, ${replaced} replaced (${rows.length} rows).`);
