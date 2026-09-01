/*
 * FIVE INVENTOR ARMOUR MODIFICATIONS GRANTED THEIR RESISTANCE WITH THE SUIT OFF.
 *
 * Each prints the same gate — *"WHILE WEARING YOUR ARMOR, you gain resistance to <type> damage equal
 * to half your level"* — and the defence aggregator pushed every owned class feature unconditionally,
 * so an inventor who took the armour off kept the resistance.
 *
 * Found by generalising the owner's Speed ruling (*"we give an actual number only when it's always"*)
 * to the other numeric lanes and measuring. Worn ITEMS were already gated correctly — this was only
 * ever the class-feature path.
 *
 * The gate is EVALUATED, not starred: `defensesRequire.wearingDesignated: 'innovation'` reads the
 * character's own inventory, so the resistance is present exactly while the innovation is worn.
 *
 * The list is COMPUTED from the printed text, not typed from memory, so a sixth modification arriving
 * in a data refresh is picked up rather than missed.
 *
 *   node scripts/backfill-armor-gated-defences.mjs           # report
 *   node scripts/backfill-armor-gated-defences.mjs --write
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

const GATE = /while wearing your (?:armor|innovation)/i;

const ROWS = [];
for (const [id, rec] of Object.entries(core.classFeatures ?? {})) {
  if (!rec?.resistances?.length && !rec?.weaknesses?.length && !rec?.immunities?.length) continue;
  const text = String(descs.classFeatures?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!GATE.test(text)) continue;
  ROWS.push({ category: 'classFeatures', id, field: 'defensesRequire', value: { armored: true } });
}

if (!ROWS.length) { console.error('no armour-gated defence features found — the printed clause changed, or the read is broken'); process.exit(2); }

console.log(`${ROWS.length} class feature(s) gate a defence on wearing the innovation:`);
for (const r of ROWS) console.log(`  ${r.id}`);

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
