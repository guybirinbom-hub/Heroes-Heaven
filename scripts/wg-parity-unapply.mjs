/**
 * Remove parity rows from the overlay that turned out to have no lane behind them.
 *
 * A row pulled from a decision file is NOT thereby removed from
 * `scripts/data/effect-backfill.json` — `apply-wg-parity.mjs` merges, it does not diff, so a row it
 * wrote on an earlier run survives the row disappearing from its source. It has to be taken out.
 *
 * NOT expressed as `value: null`, which would be a DELETE of the field: `pact-of-the-herald-and-host`
 * already had `innateSpells` from the import, and deleting it would take the item's Fear away. The
 * row is dropped so the record falls back to whatever the import gives it.
 *
 *   node scripts/wg-parity-unapply.mjs --dry
 *   node scripts/wg-parity-unapply.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBackfill, BACKFILL_PATH } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

/** category | id | field — rows batch 001 wrote before the suite showed they were inert. */
const REMOVE = [
  ['items', 'pact-of-the-herald-and-host', 'choice'],
  ['items', 'pact-of-the-herald-and-host', 'innateSpells'],
  ['feats', 'greater-mercy', 'spellNotes'],
];

const overlay = JSON.parse(readFileSync(join(ROOT, BACKFILL_PATH), 'utf8'));
const key = (c, i, f) => `${c}|${i}|${f}`;
const drop = new Set(REMOVE.map(([c, i, f]) => key(c, i, f)));
const kept = overlay.filter((r) => !drop.has(key(r.category, r.id, r.field)));

console.log(`overlay ${overlay.length} -> ${kept.length}  (removing ${overlay.length - kept.length})`);
for (const [c, i, f] of REMOVE) {
  const present = overlay.some((r) => key(r.category, r.id, r.field) === key(c, i, f));
  console.log(`  ${present ? 'removed' : 'not present'}  ${c}/${i}.${f}`);
}
if (DRY) { console.log('\n--dry: nothing written.'); process.exit(0); }
writeBackfill(ROOT, kept, { allowShrink: true });
console.log('\nwritten. Re-run `npm run data`.');
