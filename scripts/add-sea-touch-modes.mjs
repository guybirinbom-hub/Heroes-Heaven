/*
 * THE SEA TOUCH ELIXIRS GRANTED NO SWIM SPEED.
 *
 * *"…granting you a swim Speed of 20 feet for 10 minutes"* (lesser), *"for 1 hour, and you can breathe
 * underwater"* (moderate), *"for 24 hours"* (greater). None of the three had a mode, so drinking one
 * changed nothing on the sheet — their side sets a swim Speed of 20.
 *
 * ⚠ A MODE MUST LIVE IN ITS SOURCE FILE, NOT THE OVERLAY. The verified fix added the lesser elixir as a
 * `create` row in effect-backfill.json, and `test/integrity-sweeps.test.ts` caught it: `npm run data`
 * builds the modes bucket from scripts/data/consumable-modes.json and toggle-modes.json, carrying the
 * hand-authored buckets from a frozen Foundry backup that has no modes at all. A mode living anywhere
 * else is deleted by the next regen with nothing to say so — which is how all 428 modes vanished once.
 * So the row is removed and the entry authored here instead.
 *
 * All THREE grades are added. The finding named the family and only specced the lesser; each grade
 * prints its own duration outright, so completing it is reading the text rather than extending it.
 * `sea-touch-elixir` itself is the family HEAD — a listing record, not a drinkable item — and gets no
 * mode, the same way the other graded families are handled.
 *
 *   node scripts/add-sea-touch-modes.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const MODES = join(ROOT, 'scripts/data/consumable-modes.json');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

/* Duration and the extra clause are per grade, straight off each record's own printed text. */
const GRADES = [
  { item: 'sea-touch-elixir-lesser', name: 'Sea Touch (Lesser)', duration: '10 minutes', extra: '' },
  { item: 'sea-touch-elixir-moderate', name: 'Sea Touch (Moderate)', duration: '1 hour', extra: ' You can also breathe underwater.' },
  { item: 'sea-touch-elixir-greater', name: 'Sea Touch (Greater)', duration: '24 hours', extra: ' You can also breathe underwater.' },
];

const modes = JSON.parse(readFileSync(MODES, 'utf8'));
const have = new Set(modes.map((m) => m.id));
const added = [];
for (const g of GRADES) {
  const id = `item-${g.item}`;
  if (!core.items?.[g.item]) { console.log(`   ${g.item}: no such item — skipped`); continue; }
  if (have.has(id)) { console.log(`   ${id}: already authored — skipped`); continue; }
  modes.push({
    id,
    name: g.name,
    fromItemId: g.item,
    duration: g.duration,
    modifiers: [],
    speeds: { swim: 20 },
    note: `The skin of your hands and feet webs over: a swim Speed of 20 feet for ${g.duration}.${g.extra}`,
  });
  added.push(id);
}

/* …and drop the overlay `create` row the fix left behind, so the mode has exactly one home. */
const rows = readBackfill(ROOT);
const keep = rows.filter((r) => !(r.category === 'modes' && r.id === 'item-sea-touch-elixir-lesser'));
const dropped = rows.length - keep.length;

console.log(`\n${added.length} mode(s) to author: ${added.join(', ') || '(none)'}`);
console.log(`${dropped} overlay create row(s) to drop.`);
if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }
if (added.length) writeFileSync(MODES, `${JSON.stringify(modes, null, 1)}\n`);
if (dropped) writeBackfill(ROOT, keep);
console.log(`written — consumable-modes.json now holds ${modes.length} entries.`);
