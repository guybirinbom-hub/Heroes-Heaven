/*
 * Record a parity verdict for records that have now been FIXED.
 *
 * Gate 8 refuses a batch until every record Wanderer's Guide encodes something for carries a written
 * verdict. A record that came back MISMATCH is not at parity — so it gets no verdict until the fix
 * lands, and then it gets `FIXED` with a note of what changed.
 *
 * Writing this by hand for a fixed record is the point: the verdict is a CLAIM that ours and theirs now
 * deliver the same thing, and the tests are what check it.
 *
 * ⚠ THE VERDICT MUST BE THE TRUE ONE. This hard-coded `FIXED`, which is a claim that a change landed.
 * Recording a record that ALREADY matched as FIXED is a false entry in the audit — it says work was
 * done where none was needed, and it hides the fact that the reader flagged a record the comparer only
 * misread. Pass `--verdict` for the other three outcomes gate 8 accepts.
 *
 *   node scripts/record-parity-verdict.mjs <batch> <id> "<what changed>" [--verdict MATCHES] [--write]
 *   node scripts/record-parity-verdict.mjs --bulk work/parity-fixed.json [--write]
 *
 * In `--bulk`, a row may carry its own `verdict`; rows without one default to FIXED, which is what the
 * bulk file was written for.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const argv = process.argv.slice(2);

/** The outcomes gate 8 accepts. Anything else is rejected here rather than written and found later.
 * OWNER-QUEUED additionally requires the id to be in work/owner-questions.json's open list — the gate
 * checks that claim, so record the question BEFORE recording the verdict. */
const VERDICTS = new Set(['MATCHES', 'FIXED', 'OWNER-RULED', 'OWNER-QUEUED', 'THEY-ENCODE-NOTHING-USEFUL']);
const vAt = argv.indexOf('--verdict');
const chosen = vAt >= 0 ? String(argv[vAt + 1] ?? '').toUpperCase() : null;
if (chosen && !VERDICTS.has(chosen)) {
  console.error(`--verdict must be one of: ${[...VERDICTS].join(' | ')}`);
  process.exit(2);
}
/* ⚠ Guard the `vAt < 0` case explicitly. Written as `i !== vAt + 1` it silently dropped argv[0] — the
 * BATCH — whenever --verdict was absent, because -1 + 1 is 0. */
const args = argv.filter((a, i) => a !== '--write' && a !== '--verdict' && !(vAt >= 0 && i === vAt + 1));

/** [{batch, id, evidence, verdict?}] */
let entries = [];
if (args[0] === '--bulk') {
  entries = JSON.parse(readFileSync(join(ROOT, args[1]), 'utf8'));
} else {
  const [batch, id, evidence] = args;
  if (!batch || !id || !evidence) { console.error('usage: node scripts/record-parity-verdict.mjs <batch> <id> "<what changed>" [--verdict MATCHES] [--write]'); process.exit(2); }
  entries = [{ batch, id, evidence, ...(chosen ? { verdict: chosen } : {}) }];
}

const byBatch = {};
for (const e of entries) (byBatch[String(e.batch).padStart(3, '0')] ??= []).push(e);

for (const [batch, list] of Object.entries(byBatch)) {
  const path = `work/wg-batch-${batch}-parity.json`;
  const full = join(ROOT, path);
  const doc = existsSync(full) ? JSON.parse(readFileSync(full, 'utf8')) : { batch: Number(batch), records: [] };
  doc.records ??= [];
  for (const e of list) {
    const at = doc.records.findIndex((r) => r.id === e.id);
    const verdict = e.verdict && VERDICTS.has(String(e.verdict).toUpperCase()) ? String(e.verdict).toUpperCase() : 'FIXED';
    const row = { id: e.id, verdict, evidence: e.evidence };
    if (at >= 0) doc.records[at] = row;
    else doc.records.push(row);
    console.log(`  ${path}: ${e.id} → ${verdict}`);
  }
  if (WRITE) writeFileSync(full, JSON.stringify(doc, null, 1) + '\n');
}
if (!WRITE) console.log('\n(report only — pass --write)');
