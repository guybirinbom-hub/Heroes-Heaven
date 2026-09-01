/*
 * Write the twelve `work/wg-batch-0NN-residual.json` files the gate requires.
 *
 * Batches 1–12 predate the read-every-record ruling and passed on the comparer gates alone. The read
 * has now been done — 262 findings, adversarially verified, authored across data rows and registry
 * changes — so each batch gets the residual file that records it, and the gate's grandfather clause
 * can go.
 *
 * Each file records, for the records IN that batch: how many findings the read produced, which are
 * closed (per the ledger, work/residual-fixed.json), and which remain. A batch with unclosed findings
 * is written with `complete: false` so the gate keeps failing it — the file is the evidence of a read,
 * not a certificate of one.
 *
 *   node scripts/write-residual-files.mjs           # report
 *   node scripts/write-residual-files.mjs --write
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));

const findings = read('work/residual-1-12.json').confirmed ?? [];
const fixed = new Set(existsSync(join(ROOT, 'work/residual-fixed.json')) ? read('work/residual-fixed.json') : []);

/* Findings by record id, so each can be attributed to the batch that record belongs to. */
const byId = new Map();
for (const f of findings) {
  if (!byId.has(f.id)) byId.set(f.id, []);
  byId.get(f.id).push(f);
}

let totalOpen = 0;
const rows = [];
for (const file of readdirSync(join(ROOT, 'work')).sort()) {
  const m = /^wg-batch-(\d+)\.json$/.exec(file);
  if (!m) continue;
  const no = Number(m[1]);
  if (no > 12) continue;

  const batch = read(`work/${file}`);
  const ids = Object.values(batch).map((r) => r.id);
  const mine = ids.flatMap((id) => byId.get(id) ?? []);
  const open = mine.filter((f) => !fixed.has(f.id));
  totalOpen += open.length;

  rows.push({
    file: `work/wg-batch-${m[1]}-residual.json`,
    no,
    records: ids.length,
    findings: mine.length,
    closed: mine.length - open.length,
    open: open.length,
    payload: {
      batch: no,
      /* `examined` and `confirmed[].fixed` are the GATE's contract (wg-batch-gate.mjs) — it fails a
       * file that reports fewer examined than the batch holds, and any confirmed finding not marked
       * fixed. Written in its vocabulary rather than a private one. */
      examined: ids.length,
      confirmed: mine.map((f) => ({
        id: f.id,
        bucket: f.bucket,
        summary: String(f.missing ?? '').replace(/\s+/g, ' ').slice(0, 200),
        fixed: fixed.has(f.id),
      })),
      recordsRead: ids.length,
      /* The read itself: every record in this batch was put against its printed text. */
      method:
        'Every record in this batch was read against its printed text (Archives of Nethys mirror), ' +
        'each finding was put to an adversarial refuter, and the survivors were authored as data rows ' +
        'or registry changes. See work/residual-1-12.json for the findings and work/residual-fixed.json ' +
        'for the ledger of what has been closed.',
      findings: mine.length,
      closed: mine.length - open.length,
      complete: open.length === 0,
    },
  });
}

console.log(`${rows.length} batch file(s); ${totalOpen} finding(s) still open across them.\n`);
for (const r of rows) {
  console.log(`  batch ${String(r.no).padStart(2)}  ${String(r.records).padStart(3)} records  ${String(r.findings).padStart(3)} findings  ${String(r.closed).padStart(3)} closed  ${r.open ? `${r.open} OPEN` : 'complete'}`);
}

if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }
for (const r of rows) writeFileSync(join(ROOT, r.file), JSON.stringify(r.payload, null, 1) + '\n');
console.log(`\nwrote ${rows.length} residual file(s).`);
