/*
 * THE PARITY READ — every record in a batch, their encoding beside ours, for a record-by-record check.
 *
 * WHY THIS EXISTS. The six comparer gates ask "does their encoding mention a KIND we do not have?"
 * That is necessary but not sufficient, and it has a hole big enough to drive a subsystem through:
 * a gate goes quiet either because ours delivers the same thing, OR because the reader was taught a new
 * field and stopped reporting. Batch 16's KINDS count fell 26 → 21 the moment wg-diff learned about
 * `resonant` — nothing was proven by that drop.
 *
 * Worse, a record can pass every gate and still differ. The aeon-stone resonance was built from the
 * printed text and never compared to their rows; six of sixteen records were wrong (four missing a rank
 * they store, two granting no spell at all) and no gate said a word, because the gaps were in VALUES
 * the comparer does not model for that field.
 *
 * The owner's rule is the exact same implementation as theirs. The only way to know that is to look at
 * both, per record, and write down the answer. This dumps the pairs; `work/wg-batch-0NN-parity.json`
 * holds the answers; gate 8 in wg-batch-gate.mjs refuses a batch until every encoded record has one.
 *
 *   node scripts/wg-parity-dump.mjs --batch work/wg-batch-016.json
 *   node scripts/wg-parity-dump.mjs --batch work/wg-batch-016.json --open   # only the unanswered
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const batchPath = arg('--batch', null);
const ONLY_OPEN = process.argv.includes('--open');
if (!batchPath) { console.error('usage: node scripts/wg-parity-dump.mjs --batch work/wg-batch-0NN.json'); process.exit(2); }

const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const batch = read(batchPath);
const parityPath = batchPath.replace(/\.json$/, '-parity.json');
const answered = new Map();
if (existsSync(join(ROOT, parityPath))) {
  for (const r of read(parityPath).records ?? []) answered.set(r.id, r);
}

const encoded = batch.filter((r) => (r.theirOps ?? []).length);
const open = encoded.filter((r) => !answered.has(r.id));

console.log(`${batch.length} records; ${encoded.length} where they encode something; ${answered.size} already answered; ${open.length} OPEN.\n`);

for (const r of ONLY_OPEN ? open : encoded) {
  const a = answered.get(r.id);
  console.log(`=== ${r.bucket}/${r.id}  (${r.name})${a ? `   [${a.verdict}]` : ''}`);
  console.log(`    THEIRS : ${(r.theirEncoding ?? r.theirOps ?? []).join(' | ').slice(0, 320)}`);
  console.log(`    OURS   : ${Object.keys(r.ourFields ?? {}).join(', ') || '(no mechanical field)'}`);
  if ((r.ourRegistries ?? []).length) console.log(`    REGISTRY: ${JSON.stringify(r.ourRegistries).slice(0, 200)}`);
  if (a?.evidence) console.log(`    ANSWER : ${String(a.evidence).slice(0, 220)}`);
  console.log();
}

if (open.length) {
  console.log(`${open.length} record(s) still need a parity verdict. Write them to ${parityPath} as`);
  console.log(`{ "batch": N, "records": [ { "id", "verdict": "MATCHES" | "FIXED" | "OWNER-RULED" | "THEY-ENCODE-NOTHING-USEFUL", "evidence": "..." } ] }`);
}
