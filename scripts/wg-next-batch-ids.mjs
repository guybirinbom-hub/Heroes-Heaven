/*
 * The next N records to batch, by SET DIFFERENCE against every batch already cut.
 *
 * ⚠ NOT `--skip`. The eligible list is rebuilt from the current data every run, so its ordering shifts
 * whenever records are added or their levels change — and `--skip 1500` then silently re-cuts records
 * already worked while skipping others entirely. The only safe cut is "everything eligible that is not
 * in a batch file yet", which is what this computes.
 *
 * Emits a comma-separated id list for `wg-batch.mjs --ids`.
 *
 *   node scripts/wg-next-batch-ids.mjs --count 100
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const count = Number(arg('--count', 100));

/* Every id already in a batch file — the set we are differencing against. */
const done = new Set();
for (const f of readdirSync(join(ROOT, 'work'))) {
  if (!/^wg-batch-\d+\.json$/.test(f)) continue;
  for (const r of JSON.parse(readFileSync(join(ROOT, 'work', f), 'utf8'))) done.add(r.id);
}

/*
 * The eligible list, from wg-batch.mjs itself rather than a reimplementation — a second copy of the
 * "both sides exist and they encode something" predicate would drift from the real one.
 */
const probe = join(ROOT, 'work/.next-batch-probe.json');
execFileSync(process.execPath, [join(ROOT, 'scripts/wg-batch.mjs'), '--count', '100000', '--out', 'work/.next-batch-probe.json'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 1 << 28,
});
const eligible = JSON.parse(readFileSync(probe, 'utf8'));

const remaining = eligible.filter((p) => !done.has(p.id));
const next = remaining.slice(0, count);

console.log(`${eligible.length.toLocaleString()} eligible · ${done.size.toLocaleString()} already batched · ${remaining.length.toLocaleString()} remaining`);
const byBucket = {};
for (const p of next) byBucket[p.bucket] = (byBucket[p.bucket] ?? 0) + 1;
console.log(`next ${next.length}: ` + Object.entries(byBucket).map(([k, v]) => `${k}=${v}`).join('  '));
const levels = next.map((p) => p.level ?? 0).filter((n) => Number.isFinite(n));
if (levels.length) console.log(`levels ${Math.min(...levels)}–${Math.max(...levels)}`);

writeFileSync(join(ROOT, 'work/.next-batch-ids.txt'), next.map((p) => p.id).join(',') + '\n');
console.log('\n-> work/.next-batch-ids.txt');
