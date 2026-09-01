/*
 * ONE-SHOT: remove the fifteen descriptions that came from AoN FAMILY pages.
 *
 * restore-empty-descriptions.mjs wrote 31 rows before its GUARD 5 existed. Fifteen of them were not
 * item prose at all but the shared variant PRICE TABLE that AoN files several items under — the three
 * tent sizes share one page, as do the two feed grades, the meal grades and the lodging grades — so
 * e.g. `tent-pavilion` was handed "Tent (Pup) / Source Player Core pg. 292 / Price 8 sp / …".
 *
 * The ids are listed literally rather than recomputed. A row is only removed when its stored value is
 * still the exact text that script produced: the overlay is the one file that survives `npm run data`,
 * and inferring which rows to delete from it is how authored data gets lost. Re-running is harmless.
 *
 *   node scripts/prune-family-page-descriptions.mjs [--write]
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

const FAMILY_PAGE_ROWS = [
  'feed-standard', 'feed-unique', 'tank-stationary', 'tank-traveling', 'clothing-cold-weather',
  'tent-pup', 'tent-four-person', 'tent-pavilion', 'aon-treats', 'aon-cotton', 'aon-wool',
  'aon-beverages', 'aon-lodging', 'aon-meals', 'aon-meal-poor',
];
const ids = new Set(FAMILY_PAGE_ROWS);

/* The signature of a variant table: it still carries a "Source <Book> pg. <n>" line, which an item's
 * own prose never does — that line lives in the page header, above the prose separator. */
const isFamilyTable = (v) => typeof v === 'string' && /\bSource\s+[A-Z][^\n]{0,80}?pg\.\s*\d+/.test(v);

const rows = readBackfill(ROOT);
const keep = [];
const dropped = [];
for (const r of rows) {
  if (r.category === 'items' && r.field === 'description' && ids.has(r.id) && isFamilyTable(r.value)) {
    dropped.push(r.id);
    continue;
  }
  keep.push(r);
}

console.log(`dropping ${dropped.length} of ${FAMILY_PAGE_ROWS.length} listed rows: ${dropped.join(', ') || '(none)'}`);
const missed = FAMILY_PAGE_ROWS.filter((id) => !dropped.includes(id));
if (missed.length) console.log(`already absent or no longer a family table: ${missed.join(', ')}`);

if (!dropped.length) process.exit(0);
if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }
writeBackfill(ROOT, keep);
console.log(`wrote ${keep.length} rows (was ${rows.length}).`);
