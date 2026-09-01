/*
 * Pull a parity-read workflow's result out of its .output file, write the per-batch parity files the
 * gate requires, and report the mismatches.
 *
 * The verdicts the agents return map onto the gate's vocabulary:
 *   MATCHES        -> MATCHES
 *   NOTHING-USEFUL -> THEY-ENCODE-NOTHING-USEFUL
 *   ASK-OWNER      -> queued in work/owner-questions.json; NOT written as a verdict, because an
 *                     unanswered question is not a comparison the batch may close on.
 *   MISMATCH       -> not written either: the record is not at parity until it is fixed.
 *
 *   node scripts/parse-parity-out.mjs <path-to-.output>
 *   node scripts/parse-parity-out.mjs <file> --write     # write the batch parity files
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
const WRITE = process.argv.includes('--write');
if (!src) { console.error('usage: node scripts/parse-parity-out.mjs <file> [--write]'); process.exit(2); }

const raw = readFileSync(src, 'utf8');
const key = raw.indexOf('"results"');
if (key < 0) { console.error('no "results" key in that file'); process.exit(2); }
const start = raw.lastIndexOf('{', key);

let depth = 0;
let inStr = false;
let esc = false;
let end = -1;
for (let i = start; i < raw.length; i++) {
  const ch = raw[i];
  if (esc) { esc = false; continue; }
  if (ch === '\\') { esc = true; continue; }
  if (ch === '"') { inStr = !inStr; continue; }
  if (inStr) continue;
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (!depth) { end = i + 1; break; } }
}
if (end < 0) { console.error('the result object is truncated in that file'); process.exit(2); }
const j = JSON.parse(raw.slice(start, end));

const results = j.results ?? [];
const counts = {};
for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
console.log(`${results.length} record(s) read.  ${JSON.stringify(counts)}`);
console.log(`confirmed mismatches: ${(j.confirmed ?? []).length}   withdrawn on review: ${(j.withdrawn ?? []).length}`);

const VERDICT = { MATCHES: 'MATCHES', 'NOTHING-USEFUL': 'THEY-ENCODE-NOTHING-USEFUL' };

/* Group the settled verdicts by batch and write the files the gate reads. */
const byBatch = {};
for (const r of results) {
  const v = VERDICT[r.verdict];
  if (!v) continue; // MISMATCH and ASK-OWNER are not parity
  (byBatch[r.batch] ??= []).push({ id: r.id, verdict: v, evidence: String(r.evidence ?? '').slice(0, 600) });
}

for (const [batch, records] of Object.entries(byBatch)) {
  const path = `work/wg-batch-${batch}-parity.json`;
  console.log(`  ${path}: ${records.length} settled verdict(s)`);
  if (WRITE) writeFileSync(join(ROOT, path), JSON.stringify({ batch: Number(batch), records }, null, 1) + '\n');
}

if ((j.confirmed ?? []).length) {
  console.log('\n--- CONFIRMED MISMATCHES (fix these; they are not at parity)');
  for (const c of j.confirmed) {
    console.log(`\n  ${c.id}  [batch ${c.batch}, ${c.confidence ?? '?'}]`);
    if (c.theyDeliver) console.log(`     THEY: ${String(c.theyDeliver).replace(/\s+/g, ' ').slice(0, 180)}`);
    if (c.weDeliver) console.log(`     OURS: ${String(c.weDeliver).replace(/\s+/g, ' ').slice(0, 180)}`);
    if (c.suggestedFix) console.log(`     FIX : ${String(c.suggestedFix).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
}

const ask = (j.askOwner ?? []).concat(results.filter((r) => r.verdict === 'ASK-OWNER'));
const seen = new Set();
const asks = ask.filter((a) => !seen.has(a.id) && seen.add(a.id));
if (asks.length) {
  console.log(`\n--- FOR THE OWNER (${asks.length}) — their encoding appears to contradict the printed text`);
  for (const a of asks) console.log(`   ${a.id}: ${String(a.evidence ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);

  if (WRITE) {
    const qPath = join(ROOT, 'work/owner-questions.json');
    const q = existsSync(qPath) ? JSON.parse(readFileSync(qPath, 'utf8')) : { open: [] };
    const have = new Set((q.open ?? []).map((x) => x.id));
    for (const a of asks) {
      if (have.has(a.id)) continue;
      (q.open ??= []).push({ id: a.id, batch: a.batch ?? null, printed: '(see record)', theirs: a.theyDeliver ?? null, ours: a.weDeliver ?? null, question: String(a.evidence ?? '').slice(0, 700) });
    }
    writeFileSync(qPath, JSON.stringify(q, null, 1) + '\n');
    console.log(`\n-> queued in work/owner-questions.json`);
  }
}
if (!WRITE) console.log('\n(report only — pass --write to write the parity files and queue the questions)');
