/*
 * AUTHOR THE REPAIRS FOR THE INLINE VALUES THE UPSTREAM CLEANER DROPPED.
 *
 * The engine — and the five refusals that keep a wrong number from ever being authored — lives in
 * `scripts/lib/dropped-inline.mjs`, shared with the `npm run verify` guard so the two can never
 * disagree about what counts as a repairable hole.
 *
 *   node scripts/repair-dropped-inline.mjs                # report
 *   node scripts/repair-dropped-inline.mjs --all          # every site, not just the first few
 *   node scripts/repair-dropped-inline.mjs --show <id>    # one record, before and after
 *   node scripts/repair-dropped-inline.mjs --write
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';
import { findDroppedInline, plain, MIRROR } from './lib/dropped-inline.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const showAt = process.argv.indexOf('--show');
const SHOW = showAt > 0 ? process.argv[showAt + 1] : null;

const found = findDroppedInline(ROOT, SHOW ? { only: SHOW } : {});
if (!found) { console.error(`no AoN mirror at ${MIRROR}`); process.exit(2); }
const { edits, refused, examined } = found;

if (SHOW) {
  const e = edits.find((x) => x.id === SHOW);
  if (!e) {
    console.log(`${SHOW}: no confident repair.`);
    for (const r of refused.filter((x) => x.where.endsWith(`/${SHOW}`))) console.log(`  refused — ${r.why}${r.run ? ` ("${r.run}")` : ''}`);
    process.exit(0);
  }
  console.log(`${e.category}/${e.id}\n`);
  for (const s of e.sites) console.log(`  + "${s.run}"   between ${s.at}`);
  console.log(`\n--- BEFORE ---\n${plain(e.was).slice(0, 1200)}\n\n--- AFTER ---\n${plain(e.value).slice(0, 1200)}`);
  process.exit(0);
}

const siteCount = edits.reduce((n, e) => n + e.sites.length, 0);
console.log(`aligned ${examined} record(s) against the mirror${process.env.DROPPED_INLINE_ALL ? ' (FULL sweep — no phrase prefilter)' : ''}.`);
console.log(`${edits.length} record(s) repairable at ${siteCount} site(s); ${refused.length} site(s) refused.\n`);
const byBucket = new Map();
for (const e of edits) byBucket.set(e.category, (byBucket.get(e.category) ?? 0) + 1);
for (const [b, n] of [...byBucket].sort((a, b2) => b2[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${b}`);
console.log();

const listed = process.argv.includes('--all') ? edits : edits.slice(0, 14);
for (const e of listed) for (const s of e.sites) console.log(`  ${(e.category + '/' + e.id).padEnd(32)} ${s.at.replace(' ▸ ', ` [+ ${s.run}] `)}`);
if (listed.length < edits.length) console.log(`  …and ${edits.length - listed.length} more record(s) — pass --all to list every site`);

const reasons = new Map();
for (const r of refused) reasons.set(r.why.replace(/\d+×/, 'N×'), (reasons.get(r.why.replace(/\d+×/, 'N×')) ?? 0) + 1);
if (reasons.size) {
  console.log(`\nREFUSED (left alone — a wrong number is worse than a missing one):`);
  for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);
}

if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const e of edits) {
  const row = { category: e.category, id: e.id, field: 'description', value: e.value };
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === 'description');
  if (at >= 0) { rows[at] = row; updated++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`\nwrote ${added} new row(s), ${updated} replaced (${rows.length} rows total).`);
