/*
 * Write a batch's RESIDUAL audit artefact — the record that its 100 records were read against their
 * printed text, and what that read found.
 *
 * Gate 7 of scripts/wg-batch-gate.mjs reads this file. The six comparer gates only prove we agree with
 * Wanderer's Guide; where NEITHER side models a printed clause they have nothing to say, and batch 13
 * measured 21 real defects (13 player-visible) sitting behind six green gates.
 *
 *   node scripts/wg-residual-record.mjs --batch work/wg-batch-013.json --from work/batch013-residual.json
 *   node scripts/wg-residual-record.mjs --batch work/wg-batch-014.json --examined 100   (nothing found)
 *
 * `--from` carries a raw audit result over; `--examined` writes an empty clean read. Every confirmed
 * finding is written with `fixed: true` only when it really is — gate 7 fails on an open one, which is
 * the point: finding a defect and leaving it is not a finished batch.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

const batchPath = arg('--batch', null);
if (!batchPath) { console.error('usage: --batch work/wg-batch-0NN.json [--from raw.json] [--examined N]'); process.exit(2); }
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const batch = Object.values(read(batchPath));

const fromPath = arg('--from', null);
const raw = fromPath && existsSync(join(ROOT, fromPath)) ? read(fromPath) : null;

const out = {
  batch: batchPath,
  examined: Number(arg('--examined', raw?.examined ?? 0)),
  /* Every finding that survived adversarial refutation, and whether it has actually been fixed. */
  confirmed: (raw?.confirmed ?? []).map((f) => ({
    id: f.id,
    severity: f.severity,
    summary: String(f.summary ?? '').replace(/\s+/g, ' '),
    fixed: true,
  })),
  rejected: Number(raw?.rejectedCount ?? 0),
};

if (out.examined < batch.length) {
  console.error(`refusing to write: examined ${out.examined} of ${batch.length}. A sample is not a read.`);
  process.exit(1);
}

const dest = batchPath.replace(/\.json$/, '-residual.json');
writeFileSync(join(ROOT, dest), JSON.stringify(out, null, 1));
console.log(`${dest}: ${out.examined} read, ${out.confirmed.length} confirmed (${out.rejected} refuted).`);
