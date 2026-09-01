/*
 * EVERY RECORD A BATCH GATE STILL CALLS "NEVER COMPARED" MUST BE ONE THE OWNER IS HOLDING.
 *
 * Gate 8 (PARITY) fails a batch while any encoded record lacks a verdict. That is right while work
 * remains — but 55 records are deliberately parked in `work/owner-questions.json` awaiting a ruling,
 * and the gate cannot tell those apart from unfinished work. So every batch reads FAILED forever, and
 * a permanently-red gate is a gate nobody looks at.
 *
 * This is the check that keeps it honest: the residual is allowed to be exactly the owner's queue and
 * nothing else. A record that quietly stops being compared — because a batch grew, a verdict file was
 * rewritten, or a fix removed a record from the data — shows up here as a name, not as one more red
 * batch among sixteen.
 *
 *   node scripts/parity-residual-check.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(ROOT, 'work');

const _oq = JSON.parse(readFileSync(join(WORK, 'owner-questions.json'), 'utf8'));
// deferred entries are parked until after batching by the owner's 2026-08-27 ruling — same standing as open.
const queued = new Set([...(_oq.open ?? []), ...(_oq.deferred ?? [])].map((q) => q.id));

/** The ids a batch file holds, whatever shape it uses. */
const idsOf = (doc) => {
  const rows = Array.isArray(doc) ? doc : (doc.records ?? doc.rows ?? doc.entries ?? []);
  return rows.map((r) => (typeof r === 'string' ? r : r.id)).filter(Boolean);
};

const batches = readdirSync(WORK)
  .filter((f) => /^wg-batch-\d+\.json$/.test(f))
  .sort();
if (!batches.length) { console.error('no batch files found — this check would pass vacuously'); process.exit(2); }

let uncompared = 0;
let total = 0;
const stray = [];
for (const f of batches) {
  const batch = f.match(/\d+/)[0];
  const all = idsOf(JSON.parse(readFileSync(join(WORK, f), 'utf8')));
  total += all.length;
  let verdicts = new Set();
  try {
    const p = JSON.parse(readFileSync(join(WORK, `wg-batch-${batch}-parity.json`), 'utf8'));
    verdicts = new Set((p.records ?? []).map((r) => r.id));
  } catch { /* no verdict file yet — every record counts as uncompared, which is the point */ }
  const missing = all.filter((id) => !verdicts.has(id));
  uncompared += missing.length;
  for (const id of missing) if (!queued.has(id)) stray.push(`batch ${batch}: ${id}`);
}

console.log(`${batches.length} batch(es), ${total} record(s); ${uncompared} without a verdict; ${queued.size} queued for the owner.`);
/* A shape change in the batch files would make `idsOf` return nothing, and "no uncompared records"
 * would then be the loudest possible pass for a check that read no records at all. */
if (total < 1000) { console.error(`parity-residual: FAILED — only ${total} record ids parsed from ${batches.length} batches; the files are not the shape this check assumes.`); process.exit(2); }
if (stray.length) {
  console.error(`\nparity-residual: FAILED — ${stray.length} record(s) have no verdict and are NOT waiting on a ruling:`);
  for (const s of stray) console.error(`   ${s}`);
  console.error('\nEither compare them, or queue the question. A record in neither state is work that has been lost, not deferred.');
  process.exit(1);
}
console.log('parity-residual: ok — every uncompared record is one the owner is holding.');
