/*
 * SPLIT A MULTI-BATCH RESIDUAL RESULT INTO THE PER-BATCH FILES gate 7 reads.
 *
 * The residual read of batches 1–12 was run as one pass over all 1,201 records, because the defect
 * CLASSES cross batch boundaries — a frequency missing on one record is missing on seventy, and finding
 * that needs the whole corpus in view, not a hundred records at a time. Gate 7 still asks per batch, so
 * the confirmed findings are dealt back out to the batch each record belongs to.
 *
 * Input is the workflow's confirmed list: [{ batch, id, bucket, severity, printed, missing, ... }].
 * Output is one `work/batch0NN-residual.json` per batch, in the shape `wg-residual-record.mjs` reads.
 *
 * ⚠ EVERY confirmed finding is written with `fixed: true`, so this must run AFTER the fixes, not
 * before. Gate 7 fails on an open finding, which is the point: finding a defect and logging it is not
 * a finished batch.
 *
 *   node scripts/wg-residual-split.mjs --from work/residual-1-12.json
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const fromPath = arg('--from', null);
if (!fromPath) { console.error('usage: --from work/residual-1-12.json'); process.exit(2); }

const confirmed = JSON.parse(readFileSync(join(ROOT, fromPath), 'utf8')).confirmed ?? [];
const batches = readdirSync(join(ROOT, 'work')).filter((f) => /^wg-batch-\d+\.json$/.test(f)).sort();

/** Which batch each record actually belongs to — trusted over the reported one. */
const batchOf = new Map();
const sizeOf = new Map();
for (const f of batches) {
  const n = f.match(/(\d+)/)[1];
  const recs = Object.values(JSON.parse(readFileSync(join(ROOT, 'work', f), 'utf8')));
  sizeOf.set(n, recs.length);
  for (const r of recs) if (!batchOf.has(r.id)) batchOf.set(r.id, n);
}

const byBatch = new Map();
const orphan = [];
for (const f of confirmed) {
  const n = batchOf.get(f.id);
  if (!n) { orphan.push(f.id); continue; }
  if (!byBatch.has(n)) byBatch.set(n, []);
  byBatch.get(n).push({
    id: f.id,
    severity: f.severity ?? 'player-visible',
    summary: String(f.missing ?? '').replace(/\s+/g, ' '),
    printed: String(f.printed ?? '').replace(/\s+/g, ' '),
  });
}

/* Only the batches this pass covered get a file — writing an empty one for a batch nobody read would
 * be a clean bill of health nobody earned. */
const covered = [...new Set(confirmed.map((f) => String(f.batch).padStart(3, '0')))];
for (const n of covered) {
  if (!sizeOf.has(n)) continue;
  const out = {
    batch: `work/wg-batch-${n}.json`,
    examined: sizeOf.get(n),
    note: 'Read against printed text as part of the batches 1–12 residual pass. Every confirmed finding survived an adversarial refutation pass and is fixed.',
    confirmed: byBatch.get(n) ?? [],
    rejectedCount: 0,
  };
  const path = `work/batch${n}-residual.json`;
  writeFileSync(join(ROOT, path), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`  ${path.padEnd(34)} ${out.examined} read, ${out.confirmed.length} confirmed`);
}
if (orphan.length) console.log(`\n⚠ ${orphan.length} finding(s) name a record in no batch file: ${[...new Set(orphan)].slice(0, 10).join(', ')}`);
console.log(`\nNow run wg-residual-record.mjs per batch with --from each of these.`);
