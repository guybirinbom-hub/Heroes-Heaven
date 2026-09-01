/*
 * Record parity verdicts in bulk from a workflow's findings file.
 *
 * record-parity-verdict.mjs takes one record and one hand-written sentence, which is right when a
 * verdict is the product of a hand investigation. A parity workflow returns 120 of them at once, each
 * already carrying its own evidence — retyping those by hand is both slow and a chance to write a
 * verdict that does not match what the agent actually found.
 *
 * ⚠ ONLY SETTLED VERDICTS ARE WRITTEN. Gate 8 accepts MATCHES / FIXED / OWNER-RULED /
 * THEY-ENCODE-NOTHING-USEFUL, and a batch may not close on an open question. So:
 *
 *   MATCHES-ON-REVIEW           -> MATCHES
 *   ALREADY-FIXED               -> FIXED
 *   THEY-ENCODE-NOTHING-USEFUL  -> THEY-ENCODE-NOTHING-USEFUL
 *   STILL-MISMATCH              -> NOT written. The record is not at parity until the fix lands, and
 *                                  a verdict claiming otherwise is exactly the false bookkeeping the
 *                                  gate exists to prevent.
 *   ASK-OWNER                   -> NOT written; queue it with add-owner-question.mjs instead.
 *
 * A finding whose verifier refuted it (`verification.upheld === false`) is never written either: the
 * finder's verdict did not survive review, so it is not a result.
 *
 *   node scripts/record-parity-batch.mjs <findings.json> [--write]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const src = process.argv[2];
if (!src || src.startsWith('--')) { console.error('usage: node scripts/record-parity-batch.mjs <findings.json> [--write]'); process.exit(2); }

const raw = JSON.parse(readFileSync(src, 'utf8'));
const findings = Array.isArray(raw) ? raw : (raw.all ?? raw.findings ?? []);

const MAP = {
  'MATCHES-ON-REVIEW': 'MATCHES',
  'ALREADY-FIXED': 'FIXED',
  'THEY-ENCODE-NOTHING-USEFUL': 'THEY-ENCODE-NOTHING-USEFUL',
};

const skipped = { 'STILL-MISMATCH': 0, 'ASK-OWNER': 0, refuted: 0, 'no-batch': 0 };
const byBatch = {};
for (const f of findings) {
  if (f.verification && f.verification.upheld === false) { skipped.refuted++; continue; }
  const verdict = MAP[f.verdict];
  if (!verdict) { skipped[f.verdict] = (skipped[f.verdict] ?? 0) + 1; continue; }
  const b = String(f.batch ?? '').padStart(3, '0');
  if (!/^\d{3}$/.test(b)) { skipped['no-batch']++; continue; }
  /* The agent's own evidence IS the verdict's justification — kept verbatim rather than summarised,
   * with the finder's original verdict preserved so a later reader can tell MATCHES from
   * ALREADY-FIXED, which the gate's vocabulary collapses. */
  const evidence = `[${f.verdict}, confidence ${f.confidence ?? '?'}] ${f.evidence ?? ''}`.trim();
  (byBatch[b] ??= []).push({ id: f.id, verdict, evidence });
}

let total = 0;
for (const [b, list] of Object.entries(byBatch)) {
  const path = `work/wg-batch-${b}-parity.json`;
  const full = join(ROOT, path);
  const doc = existsSync(full) ? JSON.parse(readFileSync(full, 'utf8')) : { batch: Number(b), records: [] };
  doc.records ??= [];
  let n = 0;
  for (const row of list) {
    const at = doc.records.findIndex((r) => r.id === row.id);
    if (at >= 0) doc.records[at] = row; else doc.records.push(row);
    n++;
  }
  total += n;
  console.log(`  ${path}: ${n} verdict(s)`);
  if (WRITE) writeFileSync(full, JSON.stringify(doc, null, 1) + '\n');
}

console.log(`\n${total} verdict(s) across ${Object.keys(byBatch).length} batch(es).`);
console.log(`not written: ${JSON.stringify(skipped)}`);
if (!WRITE) console.log('(report only — pass --write)');
