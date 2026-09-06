/*
 * RE-GATE EVERY EARLIER BATCH — the experience sweep and the nine gates, batch by batch, resumable.
 *
 * WHY THIS EXISTS. docs/wg-batch-pipeline.md §B lists it among "guards that make agent judgement
 * checkable": "`scripts/wg-regate-all.mjs` — the re-gate loop (ported from the scratchpad), resumable",
 * and §A's `regate` stage: "for every earlier batch: experience sweep then gate, serialised, progress
 * recorded per batch so a restart resumes; blocking — a newly failing earlier-batch record needs a
 * disposition line in the digest".
 *
 * The loop itself was a scratchpad shell script re-typed from memory every batch, which is exactly the
 * habit §D forbids ("never re-type a scratchpad script"). Three things it did not do, and this does:
 *
 *   · RESUME. The sweep is ~30 batches of jsdom renders; a machine that goes to sleep in the middle used
 *     to mean starting again. Progress is recorded per batch in work/.regate-progress.json.
 *   · REFUSE A STALE GREEN. Progress is stamped with the sha256 of the three data artefacts. A batch
 *     that went green BEFORE the overlay changed proves nothing about the tree we have now, so any hash
 *     change clears the progress rather than letting a resume inherit it.
 *   · SERIALISE. Sweep then gate, one batch at a time — the experience harness loses its forks worker
 *     under load and then reports zero tests with exit 0 (scripts/lib/heavy-lock.mjs).
 *
 *   node scripts/wg-regate-all.mjs                 # every work/wg-batch-NNN.json
 *   node scripts/wg-regate-all.mjs --batch 030     # every batch BEFORE 030 (what the driver runs)
 *   node scripts/wg-regate-all.mjs --only 017,024  # just these
 *   node scripts/wg-regate-all.mjs --restart       # forget the recorded progress
 *
 * Exit 0 only when every batch it ran is green. A failing batch is named with the gate's own lines.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const RESTART = process.argv.includes('--restart');
const PROGRESS = join(ROOT, 'work/.regate-progress.json');
const LOG = join(ROOT, 'work/.regate-all.log');

const sha = (rel) => {
  try { return createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex'); } catch { return null; }
};
const dataHashes = () => ({
  overlay: sha('scripts/data/effect-backfill.json'),
  core: sha('public/core.json'),
  descriptions: sha('public/core-descriptions.json'),
});

/* ---- which batches ------------------------------------------------------------------------------ */
const before = arg('--batch', null);
const only = String(arg('--only', '')).split(',').map((s) => s.trim()).filter(Boolean);
const all = readdirSync(join(ROOT, 'work'))
  .map((f) => (f.match(/^wg-batch-(\d+)\.json$/) ?? [])[1])
  .filter(Boolean)
  .sort();
const batches = only.length
  ? only.map((s) => s.padStart(3, '0'))
  : all.filter((nnn) => (before ? Number(nnn) < Number(before) : true));

if (!batches.length) { console.log('regate: no earlier batches to re-gate.'); process.exit(0); }

/* ---- progress ----------------------------------------------------------------------------------- */
const hashes = dataHashes();
let progress = { hashes, batches: {} };
if (!RESTART && existsSync(PROGRESS)) {
  try {
    const p = JSON.parse(readFileSync(PROGRESS, 'utf8'));
    if (JSON.stringify(p.hashes) === JSON.stringify(hashes)) progress = p;
    else console.log('regate: the data artefacts changed since the recorded progress — every earlier green is stale, starting over.');
  } catch { /* unreadable progress is no progress */ }
}
progress.batches ??= {};
const save = () => writeFileSync(PROGRESS, JSON.stringify(progress, null, 1) + '\n');

const log = (line) => { appendFileSync(LOG, line + '\n'); console.log(line); };
if (RESTART || !existsSync(LOG)) writeFileSync(LOG, '');

const run = (script, args) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
    env: { ...process.env, WG_BATCH_RUN: process.env.WG_BATCH_RUN ?? '' },
  });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/* The gate's own words, filtered the way the scratchpad loop filtered them: the verdict line and the
 * failing-record lines, nothing else — a full gate report is 40 KB and this loop runs it 30 times. */
const gateLines = (out) => out.split(/\r?\n/).filter((l) => /BATCH DONE|GATE\(S\) FAILED|^ {2}· |^ {6}[a-z0-9-]+ +[A-Z]/.test(l)).slice(0, 40);

/* ---- the loop ----------------------------------------------------------------------------------- */
let green = 0;
let failed = 0;
let skipped = 0;
const failures = [];
for (const nnn of batches) {
  const f = `work/wg-batch-${nnn}.json`;
  if (!existsSync(join(ROOT, f))) { log(`MISSING ${f}`); continue; }
  if (progress.batches[nnn]?.status === 'green') { skipped++; continue; }

  log(`=== ${f} — experience sweep ${new Date().toTimeString().slice(0, 8)}`);
  const sweep = run('wg-experience.mjs', ['--batch', f]);
  for (const l of sweep.out.split(/\r?\n/).filter((l) => /^experience: \d+ records|^written:|refusing|failed/.test(l))) log(`    ${l}`);
  if (sweep.status !== 0) {
    progress.batches[nnn] = { status: 'failed', at: new Date().toISOString(), stage: 'experience', failures: ['the experience sweep did not complete'] };
    save();
    failed++;
    failures.push(`${nnn}: experience sweep failed (exit ${sweep.status})`);
    log(`  · ${nnn}: EXPERIENCE SWEEP FAILED`);
    continue;
  }

  log(`=== ${f} — gate ${new Date().toTimeString().slice(0, 8)}`);
  const gate = run('wg-batch-gate.mjs', ['--batch', f]);
  const lines = gateLines(gate.out);
  for (const l of lines) log(l);
  if (gate.status === 0) {
    progress.batches[nnn] = { status: 'green', at: new Date().toISOString() };
    green++;
  } else {
    progress.batches[nnn] = { status: 'failed', at: new Date().toISOString(), stage: 'gate', failures: lines };
    failed++;
    failures.push(`${nnn}: ${lines.filter((l) => l.startsWith('  · ')).map((l) => l.slice(4)).join(' | ').slice(0, 300) || 'gate exited non-zero'}`);
  }
  save();
}

progress.hashes = hashes;
save();

log(`=== ALL DONE ${new Date().toTimeString().slice(0, 8)}`);
log(`regate: ${green} green · ${failed} failed · ${skipped} already green (resumed) · ${batches.length} in scope`);
if (failures.length) {
  console.log('\nEach of these needs a disposition line in the batch digest (fixed here / queued with a desk n / next batch):');
  for (const f of failures) console.log(`  · ${f}`);
  /* A machine-readable copy for the driver's regate stage, so the digest does not have to be scraped
   * out of this log. */
  writeFileSync(join(ROOT, 'work/.regate-failures.json'), JSON.stringify(failures, null, 1) + '\n');
  process.exit(1);
}
try { writeFileSync(join(ROOT, 'work/.regate-failures.json'), '[]\n'); } catch { /* report only */ }
process.exit(0);
