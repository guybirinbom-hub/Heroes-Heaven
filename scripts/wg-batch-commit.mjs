/*
 * COMMIT a parity batch by explicit path, or refuse.
 *
 * Plan section B (`docs/wg-batch-pipeline.md`):
 *
 *   "`scripts/wg-batch-commit.mjs --batch NNN` — stages, by explicit path, the manifest's `stage: []`
 *    list ∪ the known batch set (the three data artefacts always together, parity + residual,
 *    read.json, specs, tests named in the manifest) and REFUSES while any modified tracked path is
 *    unaccounted for or any of the three data files is modified-but-unstaged; message from
 *    `work/.bNNN-commit.txt`; prints the staged list. Never `-A`, never a glob."
 *
 * `git add -A` is a standing prohibition in this repo (memory: "never `git add -A` in that repo"), and
 * the reason is the failure mode this script replaces: a batch commit assembled by hand either sweeps
 * in an unrelated working-tree edit or ships `effect-backfill.json` without the `core.json` it
 * regenerated — the overlay and the artefacts disagreeing in history is the hardest state to debug.
 * So the three data files are one indivisible unit here, and ANY modified tracked path the batch does
 * not account for is a hard refusal that names it, not a judgement call at commit time.
 *
 *   node scripts/wg-batch-commit.mjs --batch 030 --dry-run
 *   node scripts/wg-batch-commit.mjs --batch 030
 *   node scripts/wg-batch-commit.mjs --batch 030 --root <dir>   # (tests) a throwaway repo
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] ?? null : null; };

const DRY = flag('--dry-run');
const ROOT = arg('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const rawBatch = arg('--batch');
if (!rawBatch) { console.error('usage: node scripts/wg-batch-commit.mjs --batch NNN [--dry-run] [--root dir]'); process.exit(2); }
const TAG = /^\d+$/.test(rawBatch) ? String(Number(rawBatch)).padStart(3, '0') : rawBatch.toUpperCase();

const p = (rel) => join(ROOT, rel);
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const refusals = [];
const refuse = (m) => refusals.push(m);

/** The overlay and the two files it regenerates. The overlay + core.json move together unconditionally;
 *  core-descriptions.json only when the batch authored prose (ruling below, at the refusal). */
const DATA_FILES = ['scripts/data/effect-backfill.json', 'public/core.json', 'public/core-descriptions.json'];
const MSG_PATH = `work/.b${TAG}-commit.txt`;
const SPECS_PATH = `work/.b${TAG}-specs.json`;

/*
 * Per-run scratch — THE SAME SPLIT .gitignore encodes, and it must stay the same split. These are the
 * files a batch run or a gate run REWRITES every time (the digest, its raw log, the gap/queue/apply
 * intermediates, the baseline and testbase snapshots, the gate's diagnostic dumps); accounting for them
 * individually would make every commit a different shape, so they are named here once and skipped.
 *
 * The four `.gate-*` / `settle-*` dumps are here because they were TRACKED until 2026-09-06 and
 * rewritten by every `--stage gate` run, which made this script refuse every batch commit that followed
 * a gate. They are diagnostics, not history — `git rm --cached` + the .gitignore lines above.
 *
 * KEEP (below) is the other half: the artefacts a later batch, a verifier or the owner must be able to
 * re-read. Anything in neither list and not in the batch set stops the commit: an unexplained modified
 * path is exactly what `-A` used to hide.
 */
const SCRATCH = [
  /^work\/\.b[\w-]+-run\.(json|log)$/,
  /^work\/\.b[\w-]+-(gaps|queue|apply|testbase|flip-audit)\.json$/,
  /^work\/\.b[\w-]+-owed\.txt$/,
  /^work\/\.b[\w-]+-(baseline|testbase|close)\//,
  /^work\/\.gate-(prose|diff)\.json$/,
  /^work\/\.stale-diff\.json$/,
  /^work\/settle-audit\.json$/,
  /^work\/\.regate-(progress|failures)\.json$/,
  /^work\/\.heavy\.lock$/,
  /^work\/\.regate-all\.log$/,
  /* The cut stage's own scratch: wg-next-batch-ids.mjs rewrites the id list and its probe dumps on every
   * run. `.next-batch-ids.txt` was TRACKED until 2026-09-06, so a `--stage cut` left a modified tracked
   * path this script then refused to commit past — the same shape as the four gate dumps above. The
   * batch is pinned by work/wg-batch-NNN.json (and its sha in .bNNN-cut.json), never by this file. */
  /^work\/\.next-batch-ids\.txt$/,
  /^work\/\.next-batch-probe(-catalogue)?\.json$/,
];

/** The committed half, for THIS batch only — another batch's artefact changing is not this batch's to
 *  stage. Globs rather than exact paths because a batch writes several rows/created-desc specs. */
const KEEP = [
  new RegExp(`^work/\\.b${TAG}-read\\.json$`),
  new RegExp(`^work/\\.b${TAG}-read-summary\\.txt$`),
  new RegExp(`^work/\\.b${TAG}-specs\\.json$`),
  new RegExp(`^work/\\.b${TAG}-rows.*\\.json$`),
  new RegExp(`^work/\\.b${TAG}-created-desc.*\\.json$`),
  new RegExp(`^work/\\.b${TAG}-commit\\.txt$`),
  /* The per-family build and verify reports are BATCH EVIDENCE, not scratch (ruling 2026-09-06): the
   * apply-digest stage collates every "DATA STILL NEEDED" / "CROSS-FILE GAPS" line out of them and each
   * resulting gap line's `ref` is `<report path>:<line>` — a disposition citing a file that never
   * reached history cannot be checked afterwards. Written once per family, then read, never rewritten. */
  new RegExp(`^work/\\.b${TAG}-report-.*\\.txt$`),
  new RegExp(`^work/\\.b${TAG}-verify-.*\\.txt$`),
  new RegExp(`^work/wg-batch-${TAG}-(parity|residual)\\.json$`),
];

// ── the stage set ────────────────────────────────────────────────────────────────────────────────
if (!existsSync(p(SPECS_PATH))) { console.error(`missing ${SPECS_PATH} — the commit stages what the manifest declares; without it there is no batch to commit.`); process.exit(2); }
const manifest = JSON.parse(readFileSync(p(SPECS_PATH), 'utf8'));

/*
 * ORCHESTRATOR RULING (batch 030): "work/experience-instrument-limits.json is a batch artefact (a parked
 * EXPERIENCE verdict is batch evidence; batches 25/26 committed it inside their batch commits): add it to
 * the commit script's always-staged-when-changed set beside the three data files, parity and residual.
 * Same for work/wg-casting-parity.json (the casting comparer's dump moves when a batch's rows move slot
 * counts; it is evidence of the comparison state, as batch 28 committed it) — staged when changed, never
 * refused over."
 */
const BATCH_EVIDENCE = ['work/experience-instrument-limits.json', 'work/wg-casting-parity.json'];

const staged = new Set([
  ...DATA_FILES,
  ...BATCH_EVIDENCE,
  `work/wg-batch-${TAG}-parity.json`,
  `work/wg-batch-${TAG}-residual.json`,
  `work/.b${TAG}-read.json`,
  SPECS_PATH,
]);
for (const m of manifest) {
  if (m.file) staged.add(m.file);
  for (const s of m.stage ?? []) staged.add(s);
}

// ── what the working tree actually has ───────────────────────────────────────────────────────────
/** `git status --porcelain` → [{ xy, path }], rename targets resolved (`R  old -> new`). */
const status = git('status', '--porcelain').split('\n').filter(Boolean).map((l) => {
  const xy = l.slice(0, 2);
  let path = l.slice(3).trim().replace(/^"|"$/g, '');
  if (xy.startsWith('R') && path.includes(' -> ')) path = path.split(' -> ')[1];
  return { xy, path };
});
const changed = new Map(status.map((s) => [s.path, s.xy]));
const isTracked = (s) => s.xy !== '??' && s.xy !== '!!';

// Every KEEP path the tree actually has — the globs cannot be enumerated from the manifest (a batch
// writes as many rows-<family>.json specs as it has families), so they are matched against the tree.
for (const s of status) if (KEEP.some((re) => re.test(s.path))) staged.add(s.path);

// only stage what actually changed; a path in the set the tree has not touched is nothing to add
const toAdd = [...staged].filter((f) => changed.has(f));
for (const extra of ['work/owner-questions.json', 'work/rulings-numbering.json']) {
  if (changed.has(extra)) { staged.add(extra); toAdd.push(extra); }
}

// ── refusals ─────────────────────────────────────────────────────────────────────────────────────
const unaccounted = status.filter(isTracked).filter((s) => !staged.has(s.path) && !SCRATCH.some((re) => re.test(s.path)));
if (unaccounted.length) refuse(`${unaccounted.length} modified tracked path(s) this batch does not account for:\n      ${unaccounted.map((s) => `${s.xy} ${s.path}`).join('\n      ')}`);

/*
 * ORCHESTRATOR RULING (batch 030): "The data-triple refusal ('the three data artefacts move together') is
 * relaxed to the real invariant: refuse only when the manifest's specs carry at least one row with field
 * 'description' or 'descRefs' (or a created-prose spec) AND public/core-descriptions.json did not change;
 * a rows-only batch with no prose rows may legitimately leave core-descriptions.json untouched — say so in
 * the printed plan. Keep refusing when core.json changed but the overlay did not, or vice versa."
 *
 * Row shape is apply-parity-fixes.mjs's: findings at the top level or under `applicable` / `findings`,
 * rows under `backfillRows` unless a verifier corrected them.
 */
const DESC_FILE = 'public/core-descriptions.json';
const OVERLAY_PAIR = DATA_FILES.filter((f) => f !== DESC_FILE);
const pairChanged = OVERLAY_PAIR.filter((f) => changed.has(f));
if (pairChanged.length === 1) {
  refuse(`the overlay and its artefact move together: ${pairChanged[0]} changed but ${OVERLAY_PAIR.find((f) => !changed.has(f))} did not. Replay the overlay (apply-backfill-now.mjs) before committing, or explain the split.`);
}

const proseSpecs = manifest.filter((m) => {
  if (m.kind === 'created-prose') return true;
  if (!m.file || !existsSync(p(m.file))) return false;
  const raw = JSON.parse(readFileSync(p(m.file), 'utf8'));
  const findings = Array.isArray(raw) ? raw : (raw.applicable ?? raw.findings ?? []);
  return findings.some((f) => ((f.verification?.correctedBackfillRows?.length ? f.verification.correctedBackfillRows : f.backfillRows) ?? [])
    .some((r) => r.field === 'description' || r.field === 'descRefs'));
});
if (proseSpecs.length && !changed.has(DESC_FILE)) {
  refuse(`${proseSpecs.length} manifest spec(s) carry prose (${proseSpecs.map((m) => m.file ?? m.family).join(', ')}) but ${DESC_FILE} did not change. Replay the overlay (apply-backfill-now.mjs) before committing, or explain the split.`);
}
for (const f of DATA_FILES) if (changed.has(f) && !toAdd.includes(f)) refuse(`${f} is modified and not in the stage set`);

for (const f of toAdd) {
  if (!existsSync(p(f)) && !changed.get(f)?.includes('D')) refuse(`stage list names ${f} and it does not exist`);
}
// one spawn, not one per path: git prints only the ignored ones and exits 1 when there are none
const ignored = toAdd.length
  ? (() => { try { return git('check-ignore', '--', ...toAdd).split('\n').filter(Boolean); } catch { return []; } })()
  : [];
if (ignored.length) refuse(`.gitignore would swallow ${ignored.join(', ')} — the parity/residual un-ignore lines are missing from .gitignore`);

const msg = existsSync(p(MSG_PATH)) ? readFileSync(p(MSG_PATH), 'utf8') : null;
if (msg === null) refuse(`missing ${MSG_PATH} — the closer writes the commit message; this script does not compose one.`);
else if (msg.trim().length < 200) refuse(`${MSG_PATH} is ${msg.trim().length} chars; a batch commit message under 200 says nothing about what changed.`);

if (!toAdd.length) refuse('nothing to commit: no path in the batch set has changed.');

// ── report ───────────────────────────────────────────────────────────────────────────────────────
console.log(`batch ${TAG}: ${manifest.length} manifest spec(s); working tree has ${status.length} changed path(s)`);
console.log('would stage:');
for (const f of toAdd) console.log(`  ${changed.get(f)} ${f}`);
// only the paths actually MATCHED by SCRATCH: labelling the unaccounted ones "driver scratch" would
// print the very paths the refusal below names as if they had been dispositioned
const skipped = status.filter(isTracked).filter((s) => !staged.has(s.path) && SCRATCH.some((re) => re.test(s.path)));
if (skipped.length) console.log(`skipped as driver scratch: ${skipped.map((s) => s.path).join(', ')}`);
// ruling (batch 030): a rows-only batch may legitimately leave core-descriptions.json alone — say so,
// so the absent third data file reads as expected rather than as something the plan failed to notice.
if (!proseSpecs.length && !changed.has(DESC_FILE)) console.log(`no prose rows in this batch; ${DESC_FILE} unchanged is expected`);
if (msg) console.log(`message (${msg.trim().length} chars): ${msg.trim().split('\n')[0]}`);

if (refusals.length) {
  console.error(`\nREFUSED (${refusals.length}), nothing staged:`);
  for (const r of refusals) console.error(`  - ${r}`);
  process.exit(1);
}
if (DRY) { console.log('\n(dry run — drop --dry-run to commit)'); process.exit(0); }

git('add', '--', ...toAdd);
const stagedNow = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
const surprise = stagedNow.filter((f) => !toAdd.includes(f));
if (surprise.length) {
  console.error(`\nREFUSED: the index holds path(s) this batch did not stage: ${surprise.join(', ')}. Reset the index and re-run.`);
  process.exit(1);
}
git('commit', '-F', p(MSG_PATH));
const sha = git('rev-parse', 'HEAD').trim();
console.log(`\nstaged ${stagedNow.length} path(s):`);
for (const f of stagedNow) console.log(`  ${f}`);
console.log(`committed ${sha}`);
