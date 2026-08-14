/*
 * THE LEVEL-ORDERED WORK LIST — the audit's unit of work from 2026-08-13.
 *
 * The owner changed the priority: audit feats from the LOWEST level upward, exhaustively, rather than
 * sampling randomly across the corpus. Low-level feats are the ones nearly every character sees, so
 * defects there cost the most play; and finishing a level means that level is DONE, which a random
 * sample can never say about anything.
 *
 * This supersedes `scripts/audit/feat-500.json` as the work list. That frozen sample is kept — it is
 * still the only thing two runs can be compared across, and it is the instrument for "did the rate
 * change".
 *
 * The order is (level, then id) and it is STABLE: batch 2 begins exactly where batch 1 stopped, and a
 * feat can never appear in two batches or be skipped between them. Sorted by id rather than by name
 * because two records can share a name and ids are unique.
 *
 *   node scripts/feat-audit-order.mjs                 # the whole ordering, with level boundaries
 *   node scripts/feat-audit-order.mjs --from 0 --count 100 --out scripts/audit/batch-001.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };

const db = JSON.parse(read('public/core.json'));
const desc = JSON.parse(read('public/core-descriptions.json'));
const hidden = new Set([...(db.duplicateIds ?? []), ...(db.umbrellaIds ?? [])]);
/* Feats whose whole text is "You gain the benefits." — requirement extraction is impossible, not merely
 * hard. Queued separately in scripts/audit/feat-text-defects.json; each needs its parent archetype's
 * text resolved in first. */
const textDefects = new Set(JSON.parse(read('scripts/audit/feat-text-defects.json')).featIds ?? []);

const live = [];
for (const [id, f] of Object.entries(db.feats ?? {})) {
  if (!f?.name || hidden.has(id) || id.startsWith('aon-') || f.edition === 'superseded' || textDefects.has(id)) continue;
  if (!String(desc.feats?.[id]?.d ?? '').trim()) continue;
  live.push({ id, name: f.name, level: f.level ?? 0, category: f.category ?? null });
}
live.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));

const FROM = Number(arg('from', -1));
const COUNT = Number(arg('count', 0));
const OUT = arg('out', null);

if (FROM < 0) {
  const byLevel = new Map();
  live.forEach((f, i) => { if (!byLevel.has(f.level)) byLevel.set(f.level, i); });
  console.log(`live feats in order: ${live.length}`);
  console.log('level  starts at  count');
  for (const [lv, start] of byLevel) {
    console.log(`  ${String(lv).padStart(2)}  ${String(start).padStart(9)}  ${live.filter((f) => f.level === lv).length}`);
  }
  console.log('\nnext batch:  node scripts/feat-audit-order.mjs --from <index> --count <n> --out scripts/audit/batch-NNN.json');
  process.exit(0);
}

const slice = live.slice(FROM, FROM + COUNT);
const levels = [...new Set(slice.map((f) => f.level))];
console.log(`batch: indices ${FROM}–${FROM + slice.length - 1} (${slice.length} feats), level${levels.length > 1 ? 's' : ''} ${levels.join(', ')}`);
console.log(`  first: ${slice[0]?.id}`);
console.log(`  last : ${slice[slice.length - 1]?.id}`);
console.log(`  NEXT BATCH STARTS AT --from ${FROM + slice.length}${FROM + slice.length >= live.length ? '  (none left)' : ''}`);

if (OUT) {
  mkdirSync(join(root, 'scripts/audit'), { recursive: true });
  writeFileSync(join(root, OUT), JSON.stringify({
    order: 'level, then id — stable across batches',
    from: FROM, count: slice.length, levels,
    nextFrom: FROM + slice.length,
    totalLive: live.length,
    featIds: slice.map((f) => f.id),
  }, null, 1));
  console.log(`wrote ${OUT}`);
}
