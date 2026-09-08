/*
 * THE BATCH DRIVER — one stage, one lock, one machine-generated digest entry.
 *
 * WHY THIS EXISTS, in the plan's words (docs/wg-batch-pipeline.md §A): "Per batch Fable does three
 * things: launch ONE saved workflow with the batch number; read ONE machine-generated digest
 * (`work/.bNNN-run.json`, a per-stage table); approve the commit or send the digest's 'needs the
 * orchestrator' items back." §"Where Fable was spent" names what this replaces: "Launching scripts by
 * hand and reading their raw output (~30 tool results); the orchestrator pass … Every mistake this
 * session came from those hand steps: spec order, the created-record prose two-phase, path-blind
 * applier keys, the harness run under load, a gate parser bug, scratchpad scripts re-typed from memory."
 *
 * Every stage: takes the heavy-job lock (work/.heavy.lock, waited on, never failed on), records a fresh
 * 16-hex `runId` nonce, snapshots git (HEAD, commit count, stash depth, dirty tracked paths) at start
 * AND end, hashes the three data artefacts at the end, and appends one entry to work/.bNNN-run.json —
 * an array; THE FILE IS THE DIGEST. Raw output goes to work/.bNNN-run.log.
 *
 * The commands a stage may run are an explicit allowlist (STAGES[...].allow). `npm run data` is on no
 * list and `--skip-harness` is refused as an argument anywhere: a stage that needs a full regeneration
 * stops with "needs the orchestrator: npm run data" rather than running it.
 *
 * A REFUSAL NAMES THE OFFENDING IDS. Nothing here "best-efforts" past an ambiguity — every guard below
 * exists because the thing it refuses actually happened in this project.
 *
 *   node scripts/wg-batch-run.mjs --batch 030 --stage cut --count 40 --max-level 8
 *   node scripts/wg-batch-run.mjs --batch 030 --stage baseline
 *   node scripts/wg-batch-run.mjs --batch 030 --stage all
 *   node scripts/wg-batch-run.mjs --batch P01 --stage apply --print     # the print-read lane
 *
 * Stages: cut | baseline | read-digest | apply | apply-digest | gaps | close | experience | gate |
 *         regate | suite | verify | all   (`all` = apply onward, stopping at the first failure)
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, cpSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHeavyLock } from './lib/heavy-lock.mjs';
import { backfillTarget } from './lib/apply-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(k);

const ORDER = ['cut', 'baseline', 'read-digest', 'apply', 'apply-digest', 'gaps', 'close', 'experience', 'gate', 'regate', 'suite', 'verify'];

/* Imported (by test/wg-batch-run.test.ts) rather than launched: the guards below are pure functions and
 * are tested as such, so nothing in the test suite has to run a stage against the real data. */
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const rawBatch = arg('--batch') ?? (IS_MAIN ? null : 'TEST');
const stageArg = arg('--stage') ?? (IS_MAIN ? null : 'apply');
if (!rawBatch || !stageArg) {
  console.error('usage: node scripts/wg-batch-run.mjs --batch NNN --stage <' + [...ORDER, 'all'].join('|') + '> [--print]');
  process.exit(2);
}
/* Batch numbers are zero-padded to three digits (029); print batches use P01-style ids and the same
 * run.json (the shared contract). */
const BATCH = /^\d+$/.test(rawBatch) ? rawBatch.padStart(3, '0') : rawBatch.toUpperCase();
const PRINT = flag('--print');
const RECUT = flag('--recut');

const BATCH_FILE = `work/wg-batch-${BATCH}.json`;
const P = (s) => `work/.b${BATCH}-${s}`;
const RUN_JSON = P('run.json');
const RUN_LOG = P('run.log');

/* ---- small tools -------------------------------------------------------------------------------- */
const abs = (rel) => join(ROOT, rel);
const has = (rel) => existsSync(abs(rel));
const read = (rel) => JSON.parse(readFileSync(abs(rel), 'utf8').replace(/^\ufeff/, ''));
const readMaybe = (rel) => { try { return read(rel); } catch { return null; } };
const write = (rel, data) => { mkdirSync(dirname(abs(rel)), { recursive: true }); writeFileSync(abs(rel), typeof data === 'string' ? data : JSON.stringify(data, null, 1) + '\n'); };
const shaText = (s) => createHash('sha256').update(s).digest('hex');
const shaFile = (rel) => { try { return createHash('sha256').update(readFileSync(abs(rel))).digest('hex'); } catch { return null; } };
export const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const hashes = () => ({
  overlay: shaFile('scripts/data/effect-backfill.json'),
  core: shaFile('public/core.json'),
  descriptions: shaFile('public/core-descriptions.json'),
});

const git = (args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  return { status: r.status ?? 1, out: String(r.stdout ?? ''), err: String(r.stderr ?? '') };
};
/* Every path `git status --porcelain` names, TRACKED OR NOT, rename targets resolved — the same slice
 * wg-batch-commit.mjs takes, because the commit guard compares its own porcelain against this list.
 * WHY it includes untracked paths: a separate effort's untracked file is just as much "not this batch's"
 * as a modified tracked one (orchestrator ruling 2026-09-08: a batch is judged only against what changed
 * since its own start). */
const dirtyPaths = () => git(['status', '--porcelain']).out.split(/\r?\n/).filter(Boolean)
  .map((l) => l.slice(3).split(' -> ').pop().replace(/^"|"$/g, ''));
const gitSnap = () => {
  const porcelain = git(['status', '--porcelain']).out.split(/\r?\n/).filter(Boolean);
  return {
    head: git(['rev-parse', 'HEAD']).out.trim(),
    count: Number(git(['rev-list', '--count', 'HEAD']).out.trim()) || 0,
    stash: git(['stash', 'list']).out.split(/\r?\n/).filter(Boolean).length,
    dirtyTracked: porcelain.filter((l) => !l.startsWith('??')).map((l) => l.slice(3).split(' -> ').pop().replace(/^"|"$/g, '')),
  };
};

class Refusal extends Error {}
/** Every refusal names what it refused — the plan: "a finding becomes a guard, never a sentence in a prompt". */
const refuse = (msg) => { throw new Refusal(msg); };

let CURRENT = null;
const say = (s) => { console.log(s); try { appendFileSync(abs(RUN_LOG), s + '\n'); } catch { /* the log is a convenience */ } };

/* ---- the command allowlist ---------------------------------------------------------------------- */
const guardArgs = (args) => {
  if (args.includes('--skip-harness')) refuse('the driver never invokes --skip-harness: a sweep that did not play the builder cannot answer gate 9 (docs/wg-batch-pipeline.md §A)');
};
/** Run one allowlisted script with node. Returns { status, out }. */
const node_ = (script, args) => {
  const allow = STAGES[CURRENT]?.allow ?? [];
  if (!allow.includes(script)) refuse(`stage ${CURRENT} may not run ${script} — its allowlist is [${allow.join(', ') || 'nothing'}]`);
  guardArgs(args);
  say(`$ node ${script} ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [abs(script), ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
    env: { ...process.env, WG_BATCH_RUN: '1' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  try { appendFileSync(abs(RUN_LOG), out.endsWith('\n') ? out : out + '\n'); } catch { /* ignore */ }
  return { status: r.status ?? 1, out };
};
/** Run one allowlisted shell command (jiti / npm). `npm run data` is on no allowlist, by design. */
const sh = (cmd, args) => {
  const key = `${cmd} ${args.join(' ')}`;
  const allow = STAGES[CURRENT]?.allow ?? [];
  if (!allow.includes(key)) refuse(`stage ${CURRENT} may not run "${key}" — its allowlist is [${allow.join(', ') || 'nothing'}]`);
  guardArgs(args);
  if (/\bnpm\b.*\bdata\b/.test(key)) refuse('needs the orchestrator: npm run data');
  say(`$ ${key}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 1 << 28, env: { ...process.env, WG_BATCH_RUN: '1' } });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  try { appendFileSync(abs(RUN_LOG), out.endsWith('\n') ? out : out + '\n'); } catch { /* ignore */ }
  return { status: r.status ?? 1, out };
};
const tail = (out, n = 6) => out.split(/\r?\n/).filter(Boolean).slice(-n).join(' | ');
/** The tail of a child that REFUSED, starting AT its refusal block. A blind tail plus clip() dropped the
 *  one line that mattered: on the batch-029 dry run `--stage close` refused with "batch 029 is already
 *  committed (27d0a64 …)" and the digest showed three unrelated `note:` lines instead — the refusal is
 *  printed last and clip() truncates from the front. §D: Fable reads the digest, never the log. */
export const refusalTail = (out, n = 6) => {
  const lines = String(out ?? '').split(/\r?\n/).filter(Boolean);
  const i = lines.findIndex((l) => /^\s*REFUS(ED|ING|AL)\b/i.test(l));
  return (i >= 0 ? lines.slice(i) : lines.slice(-n)).join(' | ');
};

/* ---- the batch file is FIXED once cut ----------------------------------------------------------- */
const cutRecord = () => readMaybe(P('cut.json'));
function assertBatchFile() {
  if (!has(BATCH_FILE)) refuse(`no ${BATCH_FILE} — run --stage cut first`);
  const cut = cutRecord();
  if (!cut) return `no ${P('cut.json')} (this batch was cut before the driver existed) — the batch-file hash is not pinned`;
  if (cut.batchSha !== shaFile(BATCH_FILE)) {
    refuse(`${BATCH_FILE} has changed since it was cut (sha ${String(shaFile(BATCH_FILE)).slice(0, 12)} ≠ ${String(cut.batchSha).slice(0, 12)}) — every later stage assumes the batch names the same records`);
  }
  return null;
}
const batchIds = () => new Set(Object.values(read(BATCH_FILE)).map((r) => r.id));

/* ---- overlay helpers ---------------------------------------------------------------------------- */
const OVERLAY = 'scripts/data/effect-backfill.json';
/** The key apply-parity-fixes.mjs collides on — category/id/path/field. Path-aware: eight batch-29 rows
 *  each set `spellSlotBonus` on a DIFFERENT magus subclass option and were refused as one collision
 *  when the key ignored the path. */
export const keyOf = (row) => `${row.category}/${row.id}/${row.path?.length ? row.path.join('.') + '.' : ''}${row.field ?? '(create)'}`;
const baseKeyOf = (row) => `${row.category}/${row.id}/${row.field}`;
const hasIdStep = (row) => (row.path ?? []).some((s) => String(s).includes('id='));
/* The post-check resolves a row's path with THE APPLIER'S OWN walk (scripts/lib/apply-backfill.mjs),
 * not a copy of it: a second implementation of "array steps address by id" would drift from the real
 * one, and the post-check exists precisely to catch a row that did not land where it was meant to. */

/* ---- registry / ratchet snapshots (the flip audit's baseline) ------------------------------------ */
/** Top-level keys of `const NAME = { … }` in a source file, skipping comments and strings. The three
 *  settle registries are hand-written objects with prose comments full of braces, so a regex over the
 *  whole file would invent keys; this walks with a depth counter instead. */
export function topLevelKeys(src, constName) {
  const m = src.match(new RegExp(`const\\s+${constName}\\s*=\\s*\\{`));
  if (!m) return null;
  const keys = [];
  const KEY = /(?:(['"])((?:\\.|[^\\])*?)\1|([A-Za-z0-9_$]+))\s*:/y;
  const STR = /(['"`])(?:\\.|[^\\])*?\1/y;
  let i = m.index + m[0].length;
  let depth = 1;
  let atStart = true;
  while (i < src.length && depth > 0) {
    const two = src.slice(i, i + 2);
    if (two === '//') { const nl = src.indexOf('\n', i); if (nl < 0) break; i = nl + 1; continue; }
    if (two === '/*') { const end = src.indexOf('*/', i); if (end < 0) break; i = end + 2; continue; }
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (depth === 1 && atStart) {
      KEY.lastIndex = i;
      const k = KEY.exec(src);
      if (k) { keys.push(k[2] ?? k[3]); i = KEY.lastIndex; atStart = false; continue; }
    }
    if (c === '"' || c === "'" || c === '`') { STR.lastIndex = i; if (STR.exec(src)) { i = STR.lastIndex; atStart = false; continue; } }
    if (c === '{' || c === '[' || c === '(') { depth++; i++; atStart = false; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; i++; continue; }
    if (c === ',') { atStart = depth === 1; i++; continue; }
    atStart = false;
    i++;
  }
  return keys;
}
const constNumber = (src, name) => { const m = src.match(new RegExp(`\\bconst\\s+${name}\\s*=\\s*(\\d+)`)); return m ? Number(m[1]) : null; };

/* ================================================================================================= *
 *  STAGES
 * ================================================================================================= */

/* ---- cut ---------------------------------------------------------------------------------------- */
async function stageCut() {
  if (has(BATCH_FILE) && !RECUT) refuse(`${BATCH_FILE} already exists — pass --recut to cut it again (a silent re-cut changes which records a worked batch names)`);
  const idsArg = arg('--ids');
  const count = arg('--count');
  const maxLevel = arg('--max-level');
  const predicate = {};
  let ids;
  if (idsArg) {
    ids = idsArg.split(',').map((s) => s.trim()).filter(Boolean);
    predicate.ids = ids.length;
  } else {
    if (!count) refuse('cut needs --count N (optionally --max-level L) or --ids a,b,c');
    if (maxLevel != null) {
      /* The cap is REAL only if the id script applies it. Cutting with a cap it would ignore picks the
       * wrong records silently, which is the one thing a cut must never do — so the flag's presence is
       * still checked rather than assumed (it was absent until 2026-09-06). */
      const src = readFileSync(abs('scripts/wg-next-batch-ids.mjs'), 'utf8');
      if (!src.includes('--max-level')) refuse('CROSS-FILE GAP: scripts/wg-next-batch-ids.mjs does not accept --max-level yet (docs/wg-batch-pipeline.md §A, cut: "add --max-level; the predicate is recorded"). Refusing rather than cutting with a cap it would ignore.');
      if (!Number.isFinite(Number(maxLevel))) refuse(`--max-level must be a number (got ${JSON.stringify(maxLevel)})`);
    }
    const r = node_('scripts/wg-next-batch-ids.mjs', ['--count', String(count), ...(maxLevel != null ? ['--max-level', String(maxLevel)] : [])]);
    if (r.status !== 0) refuse(`wg-next-batch-ids.mjs exited ${r.status}: ${tail(r.out)}`);
    ids = readFileSync(abs('work/.next-batch-ids.txt'), 'utf8').trim().split(',').map((s) => s.trim()).filter(Boolean);
    predicate.count = Number(count);
    if (maxLevel != null) predicate.maxLevel = Number(maxLevel);
  }
  if (!ids.length) refuse('cut produced no ids');

  const r2 = node_('scripts/wg-batch.mjs', ['--ids', ids.join(','), '--out', BATCH_FILE]);
  if (r2.status !== 0) refuse(`wg-batch.mjs exited ${r2.status}: ${tail(r2.out)}`);
  const packets = Object.values(read(BATCH_FILE));
  const missing = ids.filter((id) => !packets.some((p) => p.id === id));
  /* The cap has to hold on the CUT, not just on the flag: the id script and wg-batch.mjs read the
   * eligible list separately, so a record can reach the packet by another route. */
  if (predicate.maxLevel != null) {
    const over = packets.filter((p) => Number.isFinite(p.level) && p.level > predicate.maxLevel).map((p) => `${p.id} (level ${p.level})`);
    if (over.length) refuse(`--max-level ${predicate.maxLevel} was asked for and ${over.length} cut record(s) are above it: ${over.slice(0, 8).join(', ')}`);
  }

  write(P('cut.json'), {
    batch: BATCH, print: PRINT, cutAt: new Date().toISOString(),
    ids, idsSha: shaText(ids.join(',')), batchSha: shaFile(BATCH_FILE),
    predicate, missing,
    startSha: gitSnap().head, // the batch-start commit, for the flip audit and the overlay-loss check
  });
  return {
    counts: { requested: ids.length, packets: packets.length, noPacket: missing.length },
    digest: `cut ${packets.length} packet(s) into ${BATCH_FILE} from ${ids.length} id(s)${missing.length ? `; no packet for ${missing.slice(0, 6).join(', ')}` : ''}. predicate ${JSON.stringify(predicate)}. batch sha ${String(shaFile(BATCH_FILE)).slice(0, 12)}, start commit ${gitSnap().head.slice(0, 8)}.`,
    next: 'node scripts/wg-batch-run.mjs --batch ' + BATCH + ' --stage baseline',
  };
}

/* ---- baseline ----------------------------------------------------------------------------------- */
/** Every `--- <id>  (<name>)` block of a wg-values / wg-identity dump, as { id: [detail lines] }. Both
 *  comparers print the same block shape, and both were being re-parsed by hand by an agent. */
export function dumpBlocks(text) {
  const out = {};
  let id = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const head = raw.match(/^---\s+(\S+)/);
    if (head) { id = head[1]; out[id] ??= []; continue; }
    if (id && /^\s{4,}\S/.test(raw)) out[id].push(raw.trim());
    else if (!raw.trim()) id = null;
  }
  return out;
}

/**
 * THE COMPARER FLAGS PER RECORD, as data rather than prose (docs/wg-batch-pipeline.md §A, baseline).
 * `{ <record id>: { kinds: [...], values: [...], identity: [...], experience: "<verdict>"|null } }`.
 *
 * This is what the readers were parsing out of six text files by hand, and it is also what the close
 * stage diffs "went quiet" against — one extractor, so a record cannot count as flagged at baseline and
 * unflagged at close because two parsers disagreed.
 */
export function comparerFlags({ diff, valuesText, identityText, experience, ids = [] }) {
  const flags = {};
  const at = (id) => (flags[id] ??= { kinds: [], values: [], identity: [], experience: null });
  for (const id of ids) at(id);
  for (const r of diff?.theyOnly ?? []) at(r.id).kinds.push(...(r.missing ?? []));
  for (const [id, l] of Object.entries(dumpBlocks(valuesText))) at(id).values.push(...l);
  for (const [id, l] of Object.entries(dumpBlocks(identityText))) at(id).identity.push(...l);
  for (const r of experience?.records ?? []) at(r.id).experience = r.verdict ?? null;
  return flags;
}
/** Flagged = a comparer has something to say about it. `OK` is the experience judge's "nothing to say". */
export const isFlagged = (f) => !!f && (f.kinds.length > 0 || f.values.length > 0 || f.identity.length > 0 || (f.experience != null && f.experience !== 'OK'));

/**
 * THE BYTE COPIES THE FLIP AUDIT DIFFS AGAINST (docs/wg-batch-pipeline.md §A, baseline). A test file that
 * is untracked at the batch start has no git blob to diff, so `work/.bNNN-testbase/<rel>` is the ONLY
 * thing that tells "this untracked test was edited during the batch" from "it was always like that"
 * (test-flip-audit.mjs: "no baseline copy to diff against"). The recursive copy of test/ should already
 * have taken every one — this CONFIRMS it, and returns the relative paths it could not copy so the caller
 * refuses naming them rather than pinning a baseline with a hole in it.
 *
 * Absolute dirs in, relative paths out, so a fixture root can drive it (test/wg-batch-run.test.ts).
 */
export function copyTestbase(rootDir, untrackedTests, tbDir) {
  const noCopy = [];
  for (const rel of untrackedTests) {
    const dest = join(tbDir, rel);
    if (!existsSync(dest)) {
      try { mkdirSync(dirname(dest), { recursive: true }); cpSync(join(rootDir, rel), dest); } catch { /* reported through the return */ }
    }
    if (!existsSync(dest)) noCopy.push(rel);
  }
  return noCopy;
}

async function stageBaseline() {
  const note = assertBatchFile();
  const dir = P('baseline');
  mkdirSync(abs(dir), { recursive: true });
  const skipped = [];
  const counts = {};

  if (PRINT) {
    /* The print-read lane has no THEIRS side: the comparers, the experience judge and the nine gates all
     * ask "what does Wanderer's Guide encode?". Running them here would produce a green report that the
     * plan explicitly forbids sharing between lanes ("the same green report must not stand for both"). */
    skipped.push('wg-parity-dump', 'wg-values', 'wg-identity', 'wg-casting', 'wg-diff', 'experience', 'gate');
    /* The print lane still gets flags.json, empty — a reader that has to branch on "does flags.json
     * exist" is a reader that will one day read a stale one from a previous batch. */
    write(`${dir}/flags.json`, comparerFlags({ ids: [...batchIds()] }));
    counts.flagged = 0;
  } else {
    const dump = node_('scripts/wg-parity-dump.mjs', ['--batch', BATCH_FILE]);
    write(`${dir}/parity-dump.txt`, dump.out);
    const values = node_('scripts/wg-values.mjs', ['--batch', BATCH_FILE, '--verbose']);
    write(`${dir}/values.txt`, values.out);
    const identity = node_('scripts/wg-identity.mjs', ['--batch', BATCH_FILE]);
    write(`${dir}/identity.txt`, identity.out);
    const casting = sh('npx', ['jiti', 'scripts/wg-casting.mjs', '--out', `${dir}/casting.json`]);
    write(`${dir}/casting.txt`, casting.out);
    /* wg-diff is CORPUS-wide and has no --batch (the gate says so too), so it is run once to a file and
     * intersected here — the asymmetry that used to make the kind check a hand step. */
    node_('scripts/wg-diff.mjs', ['--out', `${dir}/diff.json`]);
    const diff = readMaybe(`${dir}/diff.json`);
    if (diff) {
      const ids = batchIds();
      write(`${dir}/diff-batch.json`, { theyOnly: (diff.theyOnly ?? []).filter((r) => ids.has(r.id)) });
      counts.theyOnly = (diff.theyOnly ?? []).filter((r) => ids.has(r.id)).length;
    }
    const exp = node_('scripts/wg-experience.mjs', ['--batch', BATCH_FILE]);
    write(`${dir}/experience.txt`, exp.out);
    counts.experienceOk = exp.status === 0 ? 1 : 0;
    const gate = node_('scripts/wg-batch-gate.mjs', ['--batch', BATCH_FILE]);
    write(`${dir}/gate.txt`, gate.out);
    counts.gateGreenAtStart = gate.status === 0 ? 1 : 0;
    /* A red baseline is the STARTING POINT, not a failure of this stage — it is what the close stage
     * diffs "what went quiet" against. */
    if (has(`${BATCH_FILE.replace(/\.json$/, '')}-experience.json`)) cpSync(abs(`${BATCH_FILE.replace(/\.json$/, '')}-experience.json`), abs(`${dir}/experience.json`));

    /* The flags AS DATA. Written from the dumps just produced, keyed by record id, so a reader gets
     * "what every comparer says about this record" without parsing six text files — and so the close
     * stage can diff the same structure rather than re-deriving it from prose. */
    const flags = comparerFlags({
      diff: readMaybe(`${dir}/diff.json`),
      valuesText: values.out,
      identityText: identity.out,
      experience: readMaybe(`${dir}/experience.json`),
      ids: [...batchIds()],
    });
    write(`${dir}/flags.json`, flags);
    counts.flagged = Object.values(flags).filter(isFlagged).length;
  }

  /* ---- the flip-audit baseline (work/.bNNN-testbase/ + the contract's testbase.json) ---- */
  const tb = P('testbase');
  mkdirSync(abs(tb), { recursive: true });
  cpSync(abs('test'), abs(`${tb}/test`), { recursive: true });
  for (const f of ['scripts/dropped-inline-check.mjs', 'scripts/wg-diff.mjs', 'scripts/wg-values.mjs', 'scripts/wg-identity.mjs', 'work/experience-instrument-limits.json']) {
    if (has(f)) cpSync(abs(f), abs(`${tb}/${f.split('/').pop()}`));
  }
  const dropped = readFileSync(abs('scripts/dropped-inline-check.mjs'), 'utf8');
  const limits = readMaybe('work/experience-instrument-limits.json') ?? {};
  /* BOTH halves of the baseline, or the flip audit has nothing to diff: `.bNNN-testbase.json` is the
   * shared contract's metadata, and copyTestbase (above) pins the byte copies. */
  const untrackedTests = git(['ls-files', '--others', '--exclude-standard', 'test']).out.split(/\r?\n/).filter(Boolean);
  /* A test file ANOTHER effort left modified at our start has a git blob at startSha, but that blob is
   * not what the batch inherited — diffing against it reports that effort's edits as this batch's uncited
   * flips (orchestrator ruling 2026-09-08). So the dirty tracked tests are listed here and the flip audit
   * diffs them against the byte copy instead; the recursive cpSync of test/ above already took it,
   * copyTestbase only proves it landed. `--diff-filter=d` drops a deletion, which has nothing to copy. */
  const dirtyTests = git(['diff', '--name-only', '--diff-filter=d', 'HEAD', '--', 'test']).out.split(/\r?\n/).filter(Boolean);
  const noCopy = copyTestbase(ROOT, [...untrackedTests, ...dirtyTests], abs(tb));
  if (noCopy.length) refuse(`${noCopy.length} untracked-or-dirty test file(s) have no byte copy under ${tb}/ — scripts/test-flip-audit.mjs cannot audit them and would report "no baseline copy to diff against": ${noCopy.join(', ')}`);

  const testbase = {
    batch: BATCH,
    startSha: cutRecord()?.startSha ?? gitSnap().head,
    untrackedTests,
    dirtyTests,
    ratchets: {
      'scripts/dropped-inline-check.mjs': {
        HOLE_BASELINE: constNumber(dropped, 'HOLE_BASELINE'),
        SAVE_DC_BASELINE: constNumber(dropped, 'SAVE_DC_BASELINE'),
        FOOT_BASELINE: constNumber(dropped, 'FOOT_BASELINE'),
        ARTEFACT_BASELINE: constNumber(dropped, 'ARTEFACT_BASELINE'),
      },
    },
    registries: {
      'scripts/wg-diff.mjs': { VERIFIED_EQUIVALENT: topLevelKeys(readFileSync(abs('scripts/wg-diff.mjs'), 'utf8'), 'VERIFIED_EQUIVALENT') ?? [] },
      'scripts/wg-values.mjs': (() => { const s = readFileSync(abs('scripts/wg-values.mjs'), 'utf8'); return { SETTLED_VALUES: topLevelKeys(s, 'SETTLED_VALUES') ?? [], NOT_A_SCALAR: topLevelKeys(s, 'NOT_A_SCALAR') ?? [] }; })(),
      'scripts/wg-identity.mjs': { SETTLED_IDENTITIES: topLevelKeys(readFileSync(abs('scripts/wg-identity.mjs'), 'utf8'), 'SETTLED_IDENTITIES') ?? [] },
    },
    limits: Object.keys(limits.records ?? {}),
  };
  write(P('testbase.json'), testbase);
  counts.tests = testbase.untrackedTests.length;
  counts.settles = testbase.registries['scripts/wg-diff.mjs'].VERIFIED_EQUIVALENT.length
    + testbase.registries['scripts/wg-values.mjs'].SETTLED_VALUES.length
    + testbase.registries['scripts/wg-values.mjs'].NOT_A_SCALAR.length
    + testbase.registries['scripts/wg-identity.mjs'].SETTLED_IDENTITIES.length;

  /* ---- THE START STATE (orchestrator ruling 2026-09-08) ----
   * "A batch is judged ONLY against what changed since its own start." Three guards used to read the
   * WHOLE tree and stall a batch on a separate effort's uncommitted work (a data regeneration, the
   * bestiary, the tracker): the verify stage, the commit guard and the flip audit. This file is what they
   * subtract — the dirty paths at our start, and the verify checks that were ALREADY red at our start. */
  const startState = {
    batch: BATCH,
    recordedAt: new Date().toISOString(),
    startSha: testbase.startSha,
    dirtyAtStart: dirtyPaths(),
    verifyFailingAtStart: runVerifyChecks().filter((r) => !r.ok).map(({ name, line }) => ({ name, line })),
  };
  write(`${dir}/start-state.json`, startState);
  counts.dirtyAtStart = startState.dirtyAtStart.length;
  counts.verifyFailingAtStart = startState.verifyFailingAtStart.length;

  return {
    counts,
    digest: `${note ? note + '. ' : ''}baseline in ${dir} (flags.json: ${counts.flagged} record(s) flagged by a comparer); testbase pinned (${counts.settles} settle keys, 4 ratchets, ${counts.tests} untracked + ${dirtyTests.length} dirty test file(s) with byte copies under ${tb}/, start commit ${testbase.startSha.slice(0, 8)}). start-state: ${startState.dirtyAtStart.length} path(s) already dirty, verify red at start for ${startState.verifyFailingAtStart.length} check(s)${startState.verifyFailingAtStart.length ? ` (${startState.verifyFailingAtStart.map((c) => c.name).join(', ')})` : ''}.${skipped.length ? ` ${PRINT_NOTE}; skipped ${skipped.join(', ')} — THEIRS-dependent, this batch has no Wanderer's Guide side.` : ` gate at start: ${counts.gateGreenAtStart ? 'green' : 'red'}.`}`,
    next: 'the read workflow, then --stage read-digest',
  };
}

/* ---- read-digest -------------------------------------------------------------------------------- */
/**
 * FAMILY ROUTING — the rule, in ONE place, so the workflow's read-digest runner routes deterministically
 * instead of self-selecting from a flat CONFIRMED list (which is the hand-reshaping the pipeline exists
 * to remove: batch 29's summary had no family section and every builder picked its own work).
 *
 * A finding is routed by what its PROPOSAL targets, first rule that matches, exactly one family:
 *   1. `instruments`  — the proposal starts with "instrument:", or names wg-diff / wg-values /
 *                       wg-identity / wg-experience-lanes / experience-instrument-limits (or one of
 *                       their settle registries). A comparer misread is never a data defect.
 *   2. `repair`       — names scripts/repair-* or dropped-inline (the restore-deleted-tokens lane).
 *   3. `situational`  — names src/rules/situationalBonuses.ts, RECORD_MARKERS or FEAT_SITUATIONAL.
 *   4. `data-rows`    — names a backfill/overlay row, a created record, or a description/descRefs.
 *   5. `engine`       — names any other src/rules/*.ts or src/builder file. situationalBonuses.ts is
 *                       excluded here BY ORDER: rule 3 has already taken it.
 *   6. default        — `data-rows`. A proposal that targets nothing else is a row on the record.
 *
 * The family names are the workflow's canonical five (DEFAULT_FAMILIES in .claude/workflows/wg-batch.js),
 * which are also the spec/report file name parts: work/.bNNN-rows-<family>.json, -report-<family>.txt.
 */
const FAMILY_RULES = [
  ['instruments', /^\s*instrument\s*:|wg-diff|wg-values|wg-identity|wg-experience-lanes|experience-instrument-limits|VERIFIED_EQUIVALENT|SETTLED_VALUES|NOT_A_SCALAR|SETTLED_IDENTITIES/i],
  ['repair', /scripts[\\/]repair-|repair-[a-z0-9-]+\.mjs|dropped-inline/i],
  ['situational', /situationalBonuses\.ts|RECORD_MARKERS|FEAT_SITUATIONAL/i],
  ['data-rows', /\b(?:overlay|backfill)\s+row|\brow\b.*\bvalue\b|create\s*:\s*true|created record|description row|descRefs|core-descriptions/i],
  ['engine', /src[\\/]rules[\\/][A-Za-z0-9_-]+\.ts|src[\\/]builder\b/i],
];
export const familyOf = (proposal) => (FAMILY_RULES.find(([, re]) => re.test(String(proposal ?? '')))?.[0]) ?? 'data-rows';

/** The one sentence the print lane must carry into BOTH the digest and the read summary: the plan
 *  forbids one green report standing for both lanes, so the report has to say which lane it is. */
const PRINT_NOTE = 'PRINT LANE: no THEIRS step; finding kinds (a)/(e)/(f) not emitted';

async function stageReadDigest() {
  /* Ported from the batch-29 scratchpad digest script, reading the slice files the shared contract puts
   * on disk instead of a workflow result blob handed through the conversation. */
  const files = readdirSync(abs('work'))
    .map((f) => (f.match(new RegExp(`^\\.b${BATCH}-read-slice-(\\d+)\\.json$`)) ?? [])[1])
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));
  if (!files.length) refuse(`no read slices at work/.b${BATCH}-read-slice-<i>.json — the readers write them (shared contract)`);

  const out = { batch: BATCH, confirmed: [], refuted: [], askOwner: [] };
  const noVerifier = [];
  for (const i of files) {
    const findings = read(P(`read-slice-${i}.json`)).findings ?? [];
    const vf = readMaybe(P(`verify-slice-${i}.json`));
    if (!vf) noVerifier.push(i);
    const verdicts = vf?.verdicts ?? [];
    const byBoth = new Map(verdicts.map((v) => [`${v.id}|${v.claim}`, v]));
    for (const f of findings) {
      const v = byBoth.get(`${f.id}|${f.claim}`) ?? verdicts.find((x) => x.id === f.id);
      if (f.askOwner) out.askOwner.push({ ...f, verdict: v?.verdict, evidence: v?.evidence });
      else if (v?.verdict === 'REFUTED') out.refuted.push({ ...f, evidence: v?.evidence });
      else out.confirmed.push({ ...f, verdict: v?.verdict ?? 'UNVERIFIED', evidence: v?.evidence });
    }
  }
  write(P('read.json'), out);

  const lines = [];
  lines.push(`confirmed ${out.confirmed.length} | refuted ${out.refuted.length} | askOwner ${out.askOwner.length}`);
  if (PRINT) lines.push(PRINT_NOTE);
  const unverified = out.confirmed.filter((f) => f.verdict !== 'CONFIRMED');
  lines.push(`confirmed but NOT adversarially confirmed: ${unverified.length}${unverified.length ? ' -> ' + unverified.map((f) => f.id).join(', ') : ''}`);

  /* The assignment, not a suggestion: the builders take these ids as their work list. See FAMILY_RULES. */
  const byFamily = new Map();
  for (const f of out.confirmed) {
    const fam = familyOf(f.proposal);
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam).push(f.id);
  }
  lines.push('', '== FAMILIES', '(routed from each finding\'s PROPOSAL by FAMILY_RULES in scripts/wg-batch-run.mjs — first rule wins, exactly one family per finding; a family with no findings is omitted)');
  for (const [fam, ids] of byFamily) lines.push(`${fam} (${ids.length}): ${ids.join(', ')}`);

  lines.push('', '== CONFIRMED');
  for (const f of out.confirmed) lines.push(`- ${f.id}${f.playerVisible ? ' [player]' : ' [internal]'}: ${String(f.claim ?? '').slice(0, 260)}\n    PROPOSAL: ${String(f.proposal ?? '').slice(0, 420).replace(/\s+/g, ' ')}`);
  lines.push('', '== ASK OWNER');
  for (const f of out.askOwner) lines.push(`- ${f.id} (${f.verdict}): ${String(f.claim ?? '').slice(0, 300)}`);
  lines.push('', '== REFUTED');
  for (const f of out.refuted) lines.push(`- ${f.id}: ${String(f.claim ?? '').slice(0, 160)} || ${String(f.evidence ?? '').slice(0, 200).replace(/\s+/g, ' ')}`);
  write(P('read-summary.txt'), lines.join('\n') + '\n');

  return {
    counts: { slices: files.length, confirmed: out.confirmed.length, refuted: out.refuted.length, askOwner: out.askOwner.length, unverified: unverified.length, families: byFamily.size },
    digest: `${PRINT ? PRINT_NOTE + '. ' : ''}${files.length} slice(s): ${out.confirmed.length} confirmed, ${out.refuted.length} refuted, ${out.askOwner.length} for the owner; ${unverified.length} confirmed WITHOUT an adversarial verdict${noVerifier.length ? ` (no verify slice for ${noVerifier.join(', ')})` : ''}. Families: ${[...byFamily].map(([f, ids]) => `${f} ${ids.length}`).join(', ') || 'none'}. ${P('read.json')} + ${P('read-summary.txt')} written.`,
    next: 'the build workflow (builders write ' + P('specs.json') + '), then --stage apply',
  };
}

/* ---- apply -------------------------------------------------------------------------------------- */
function loadManifest() {
  const m = readMaybe(P('specs.json'));
  if (!m) refuse(`no ${P('specs.json')} — the builders write the manifest (shared contract)`);
  if (!Array.isArray(m)) refuse(`${P('specs.json')} must be an ARRAY of { file, kind, family, stage }`);
  for (const e of m) {
    if (!e?.file || !e?.kind || !e?.family) refuse(`manifest entry missing file/kind/family: ${clip(JSON.stringify(e), 140)}`);
    if (!['rows', 'created-prose'].includes(e.kind)) refuse(`manifest entry ${e.file}: kind must be "rows" or "created-prose", not ${JSON.stringify(e.kind)}`);
    if (!has(e.file)) refuse(`the manifest names ${e.file}, which does not exist`);
  }
  return m;
}
/* The SAME extraction apply-parity-fixes.mjs uses, `applicable` first — a spec carrying both keys must
 * not have one set of rows counted here and another set written there. */
const specFindings = (file) => { const raw = read(file); return Array.isArray(raw) ? raw : (raw.applicable ?? raw.findings ?? []); };
const specRows = (file) => specFindings(file).flatMap((f) => ((f.verification?.correctedBackfillRows?.length ? f.verification.correctedBackfillRows : f.backfillRows) ?? []).map((row) => ({ file, finding: f.id, row })));
const specEdits = (file) => specFindings(file).flatMap((f) => ((f.verification?.correctedCodeEdits?.length ? f.verification.correctedCodeEdits : f.codeEdits) ?? []).map((edit) => ({ file, finding: f.id, edit })));

/**
 * What the overlay must hold after ONE spec's write — rows on disk now plus the distinct keys this spec
 * adds; a row over an existing key REPLACES it (apply-parity-fixes.mjs matches on category/id/field/path,
 * the same key as keyOf). Handed to the applier as `--expect-rows`, which restores the overlay's raw
 * bytes on a mismatch. The applier never sees the manifest and cannot compute this itself.
 */
export const expectRowsFor = (overlayRows, specRows) => {
  const keys = new Set(overlayRows.map(keyOf));
  return overlayRows.length + new Set(specRows.map(keyOf).filter((k) => !keys.has(k))).size;
};

const AON_ID = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d+\b/g;
const mirrorText = (aonId) => {
  const category = aonId.replace(/-\d+$/, '');
  const p = `${MIRROR}/${category}/${aonId}.json`;
  if (!existsSync(p)) return null;
  try {
    const d = JSON.parse(readFileSync(p, 'utf8'));
    return String(d.text ?? d.markdown ?? d.search_markdown ?? '');
  } catch { return null; }
};
const words = (s) => String(s ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * THE FIVE PRE-CHECKS, over the WHOLE manifest, before anything touches disk
 * (docs/wg-batch-pipeline.md §A, `apply`). Pure, so test/wg-batch-run.test.ts can exercise each refusal
 * on a fixture instead of on the real overlay. Returns { problems[], supersedes[] }.
 *
 * `rows` is [{ file, finding, row }] across every spec in the manifest — one list, because four of the
 * five failures are only visible ACROSS specs, and the batch-29 pass looked at one spec at a time.
 */
export function precheck(rows, overlayBefore, { mirror = mirrorText, currentDescription = shippedDescription } = {}) {
  const problems = [];
  const supersedes = [];
  const overlayByKey = new Map(overlayBefore.map((r) => [keyOf(r), r]));

  /* ---- (1) one collision check across EVERY spec — hard refuse, never "later wins" ---- */
  const seen = new Map();
  for (const r of rows) {
    if (!r.row?.category || !r.row?.id) { problems.push(`${r.file} ${r.finding}: a row is missing category/id`); continue; }
    const k = keyOf(r.row);
    if (seen.has(k)) problems.push(`COLLISION ${k}: ${seen.get(k).file}#${seen.get(k).finding} and ${r.file}#${r.finding} both write it — resolve by hand, the applier will not merge`);
    else seen.set(k, r);
  }

  /* ---- (1b) a create row and a field row on the SAME record ----
   * keyOf ends a create row with '(create)' and a field row with the field name, so check (1) never
   * collides them. Batch 031 CREATED stances/wild-winds-stance in work/.b031-rows-data-rows.json and
   * set that record's `strikes` from work/.b031-rows-gap-data-rows.json; applyBackfill never overwrites
   * an existing record, so the field row alone reached the shipped artefact and the create row's own
   * post-check ("the shipped record equals the create row") refused AFTER writing, demanding a full
   * `npm run data`. Refused BEFORE writing unless the field row says exactly what the create row
   * already says and lands after it — otherwise fold the field into the create row. */
  const creates = new Map();
  rows.forEach((r, i) => { if (r.row?.category && r.row?.id && r.row.field === undefined) creates.set(`${r.row.category}/${r.row.id}`, { r, i }); });
  rows.forEach((r, i) => {
    if (!r.row?.category || !r.row?.id || r.row.field === undefined) return;
    const c = creates.get(`${r.row.category}/${r.row.id}`);
    if (!c) return;
    const harmless = !r.row.path?.length && c.i < i && eq(c.r.row.value?.[r.row.field], r.row.value);
    if (!harmless) problems.push(`${r.file}#${r.finding}: ${keyOf(r.row)} assigns a field of ${r.row.category}/${r.row.id}, which ${c.r.file}#${c.r.finding} CREATES in the same manifest — fold the field into the create row (a create row has no \`field\`, so the collision check never sees these two)`);
  });

  /* ---- (2) a row over an existing overlay key must DECLARE supersedes ---- */
  for (const r of rows) {
    if (!r.row?.category || !r.row?.id) continue;
    const k = keyOf(r.row);
    const old = overlayByKey.get(k);
    if (!old) continue;
    /* RESUME. A stage that refused AFTER writing (batch 031's apply, on the create-row post-check) leaves
     * the batch's OWN rows on disk, and re-running then read all 22 of them as undeclared supersessions —
     * a row cannot "silently overwrite a different prior value" when the value on disk is byte-identical
     * to it. `supersedes` is spec metadata the applier strips before storing, so it is off both sides. */
    const { supersedes: _wasDeclared, ...onDisk } = old;
    const { supersedes: _declares, ...proposed } = r.row;
    if (eq(onDisk, proposed)) continue;
    if (!r.row.supersedes) problems.push(`${r.file}#${r.finding}: ${k} already exists in the overlay and the row does not carry supersedes:true`);
    else supersedes.push(`${k}: ${clip(JSON.stringify(old.value), 90)} -> ${clip(JSON.stringify(r.row.value), 90)}`);
  }

  /* ---- (3) the magus case: a pathless whole-value row beside path:[…,'id=…'] rows on the same field ---- */
  const pathful = new Set();
  const pathless = new Set();
  for (const r of [...overlayBefore, ...rows.map((x) => x.row)]) {
    if (!r?.field) continue;
    (hasIdStep(r) ? pathful : pathless).add(baseKeyOf(r));
  }
  for (const r of rows) {
    if (!r.row?.field) continue;
    const b = baseKeyOf(r.row);
    if (pathful.has(b) && pathless.has(b)) {
      problems.push(`${r.file}#${r.finding}: ${b} is written BOTH as a whole value and through path:[…,'id=…'] rows — the whole-value row silently discards the per-option ones (the magus case)`);
    }
  }

  /* ---- (4) prose rows never carry a path ---- */
  for (const r of rows) {
    if (['description', 'descRefs'].includes(r.row?.field) && r.row.path?.length) {
      problems.push(`${r.file}#${r.finding}: a ${r.row.field} row carries a path (${JSON.stringify(r.row.path)}) — prose is routed to core-descriptions.json by field, and a path row reaches nothing`);
    }
  }

  /* ---- (5) every row's `why` names an AoN doc id; a prose row's restored tokens are IN that doc ---- */
  for (const r of rows) {
    if (!r.row?.category || !r.row?.id) continue;
    const ids = String(r.row.why ?? '').match(AON_ID) ?? [];
    if (!ids.length) { problems.push(`${r.file}#${r.finding}: row ${keyOf(r.row)} has a \`why\` that names no AoN doc id (e.g. equipment-2827, class-feature-431) — the printed authority must be citable`); continue; }
    if (r.row.field !== 'description' || typeof r.row.value !== 'string') continue;
    const text = ids.map(mirror).filter(Boolean).join('\n');
    if (!text) { problems.push(`${r.file}#${r.finding}: no mirror document for ${ids.join(', ')} under ${MIRROR} — the restored text cannot be checked against print`); continue; }
    const beforeSet = new Set(words(currentDescription(r.row.category, r.row.id)));
    const mirrorSet = new Set(words(text));
    const added = [...new Set(words(r.row.value))].filter((w) => !beforeSet.has(w) && !mirrorSet.has(w));
    if (added.length) problems.push(`${r.file}#${r.finding}: the description row for ${r.row.category}/${r.row.id} introduces token(s) that are in NEITHER our current text nor the mirror ${ids.join('/')}: ${added.slice(0, 8).join(', ')}`);
  }

  return { problems, supersedes };
}

async function stageApply() {
  assertBatchFile();
  const manifest = loadManifest();
  const overlayBefore = read(OVERLAY);
  const overlayByKey = new Map(overlayBefore.map((r) => [keyOf(r), r]));
  const rows = manifest.flatMap((m) => specRows(m.file).map((r) => ({ ...r, kind: m.kind, family: m.family })));
  const edits = manifest.flatMap((m) => specEdits(m.file));

  const { problems, supersedes } = precheck(rows, overlayBefore);
  if (problems.length) refuse(`${problems.length} pre-check problem(s) — NOTHING was written:\n  · ${problems.join('\n  · ')}`);

  /* ---- the batch-start overlay, for the loss check below ---- */
  const startSha = cutRecord()?.startSha ?? readMaybe(P('testbase.json'))?.startSha ?? null;
  if (!startSha) refuse(`no batch-start commit recorded (${P('cut.json')} / ${P('testbase.json')}) — the "no overlay row lost or narrowed" check cannot run; run --stage baseline first`);
  const shown = git(['show', `${startSha}:${OVERLAY}`]);
  if (shown.status !== 0) refuse(`git show ${startSha}:${OVERLAY} failed: ${clip(shown.err, 200)}`);
  const startRows = JSON.parse(shown.out);
  const startByKey = new Map(startRows.map((r) => [keyOf(r), r]));

  const newKeys = rows.filter((r) => !overlayByKey.has(keyOf(r.row)));
  const expectedRows = overlayBefore.length + new Set(newKeys.map((r) => keyOf(r.row))).size;

  /* ---- write, in manifest order; created-prose LAST; a replay after each spec and one at the end ---- */
  const ordered = [...manifest.filter((m) => m.kind !== 'created-prose'), ...manifest.filter((m) => m.kind === 'created-prose')];
  const applied = [];
  const skippedSpecs = [];
  for (const spec of ordered) {
    const mine = specRows(spec.file);
    const myEdits = specEdits(spec.file);
    const rowsDone = mine.length > 0 && mine.every(({ row }) => eq(overlayByKey.get(keyOf(row)), row));
    const editState = myEdits.map(({ edit }) => {
      let src = '';
      try { src = readFileSync(abs(edit.file), 'utf8'); } catch { return 'unreadable'; }
      if (src.includes(edit.find)) return 'pending';
      return src.includes(edit.replace) ? 'done' : 'lost';
    });
    const editsDone = editState.every((s) => s === 'done');
    if (rowsDone && (myEdits.length === 0 || editsDone)) { skippedSpecs.push(spec.file); say(`skip ${spec.file}: every row is already in the overlay byte-identical${myEdits.length ? ' and every edit is already applied' : ''}`); continue; }
    if (editState.includes('done') && editState.includes('pending')) {
      /* A half-applied spec is only safe to re-run because apply-parity-fixes.mjs treats an edit whose
       * `find` is gone and whose `replace` is present as already applied. Without that rule it refuses
       * the whole spec (find occurs 0x) and the batch stalls with the rows already written. */
      if (!readFileSync(abs('scripts/apply-parity-fixes.mjs'), 'utf8').includes('already applied')) {
        refuse(`${spec.file} is half-applied (${editState.filter((s) => s === 'done').length} edit(s) already in the tree, ${editState.filter((s) => s === 'pending').length} pending) and apply-parity-fixes.mjs has no "find gone + replace present = already applied" rule — it would refuse the whole spec. CROSS-FILE GAP.`);
      }
      say(`${spec.file}: ${editState.filter((s) => s === 'done').length} edit(s) already applied — the applier skips them`);
    }
    if (editState.includes('lost')) {
      refuse(`${spec.file}: ${editState.filter((s) => s === 'lost').length} code edit(s) match NEITHER their \`find\` nor their \`replace\` in the target file — the file moved under the spec; re-read it before applying`);
    }
    /* --expect-rows, per spec: the applier keeps the overlay's raw bytes and RESTORES them when the row
     * count after its write is not this number, so a miscounted spec is rolled back instead of leaving a
     * wrong overlay for the post-check below to find. The applier cannot compute it — it never sees the
     * manifest — so the driver hands it "rows on disk now + the keys this spec adds". */
    const expectRows = expectRowsFor(read(OVERLAY), mine.map(({ row }) => row));
    const r = node_('scripts/apply-parity-fixes.mjs', [spec.file, '--write', '--expect-rows', String(expectRows)]);
    if (r.status !== 0) refuse(`apply-parity-fixes.mjs refused ${spec.file} (exit ${r.status}): ${refusalTail(r.out, 8)}`);
    const rp = node_('scripts/apply-backfill-now.mjs', []);
    if (rp.status !== 0) refuse(`apply-backfill-now.mjs failed after ${spec.file} (exit ${rp.status}): ${tail(rp.out, 4)}`);
    applied.push(spec.file);
  }
  /* One final unconditional replay: the created-prose specs land last, and a create row's record only
   * exists in the shipped artefact after a replay that ran AFTER it was written. */
  const finalReplay = node_('scripts/apply-backfill-now.mjs', []);
  if (finalReplay.status !== 0) refuse(`the final apply-backfill-now.mjs replay failed (exit ${finalReplay.status}): ${tail(finalReplay.out, 4)}`);

  /* ---- post-checks ---- */
  const post = [];
  const core = read('public/core.json');
  const descs = read('public/core-descriptions.json');
  const overlayAfter = read(OVERLAY);
  const afterByKey = new Map(overlayAfter.map((r) => [keyOf(r), r]));

  const shippedOf = (row) => {
    if (row.field === 'description' || row.field === 'descRefs') {
      const e = descs[row.category]?.[row.id];
      const k = row.field === 'description' ? 'd' : 'r';
      if (e && e[k] !== undefined) return e[k];
      return core[row.category]?.[row.id]?.[row.field];
    }
    const rec = core[row.category]?.[row.id];
    if (!rec) return undefined;
    const target = row.path?.length ? backfillTarget(rec, row.path) : rec;
    return target ? target[row.field] : undefined;
  };

  for (const { file, finding, row } of rows) {
    if (row.delete) {
      if (core[row.category]?.[row.id]) post.push(`${file}#${finding}: ${row.category}/${row.id} carries delete:true but is still in the shipped core.json`);
      continue;
    }
    if (row.create) {
      /* A create row is the one row a replay cannot correct: applyBackfill "never overwrites" an
       * existing record, so a CORRECTED create silently keeps the old one until a full regeneration. */
      const shipped = core[row.category]?.[row.id];
      if (!shipped) { post.push(`${file}#${finding}: created record ${row.category}/${row.id} is not in the shipped core.json`); continue; }
      const stripped = { ...shipped };
      for (const k of ['description', 'descRefs']) if (!(k in (row.value ?? {}))) delete stripped[k];
      if (!eq(stripped, row.value)) post.push(`NEEDS npm run data — ${file}#${finding}: the shipped ${row.category}/${row.id} does not equal the create row (applyBackfill never overwrites an existing record, so a corrected create needs a full regeneration)`);
      continue;
    }
    const shipped = shippedOf(row);
    if (row.value === null) { if (shipped !== undefined) post.push(`${file}#${finding}: ${keyOf(row)} is a removal row (value:null) and the field is still present in the shipped artefact`); continue; }
    if (!eq(shipped, row.value)) post.push(`${file}#${finding}: ${keyOf(row)} is not readable from the SHIPPED artefact (shipped ${clip(JSON.stringify(shipped), 80)} ≠ row ${clip(JSON.stringify(row.value), 80)})`);
  }

  for (const [k, old] of startByKey) {
    const now = afterByKey.get(k);
    const removal = rows.find((r) => keyOf(r.row) === k && (r.row.value === null || r.row.delete));
    if (!now) { if (!removal) post.push(`OVERLAY LOSS: ${k} existed at the batch-start commit ${startSha.slice(0, 8)} and is gone, with no explicit value:null / delete:true row`); continue; }
    if (!eq(now.value, old.value) && !rows.some((r) => keyOf(r.row) === k && r.row.supersedes)) {
      post.push(`OVERLAY NARROWED: ${k} changed since ${startSha.slice(0, 8)} without a declared supersedes row`);
    }
  }

  if (overlayAfter.length !== expectedRows) {
    post.push(`OVERLAY COUNT: ${overlayAfter.length} rows, expected ${expectedRows} (${overlayBefore.length} before + ${expectedRows - overlayBefore.length} declared new; declared supersedes count as replacements)`);
  }

  if (post.length) refuse(`${post.length} post-check problem(s) AFTER writing:\n  · ${post.join('\n  · ')}`);

  return {
    counts: { specs: manifest.length, applied: applied.length, skipped: skippedSpecs.length, rows: rows.length, newRows: new Set(newKeys.map((r) => keyOf(r.row))).size, supersedes: supersedes.length, edits: edits.length, overlayRows: overlayAfter.length },
    digest: `${applied.length}/${manifest.length} spec(s) applied (${skippedSpecs.length} already in the overlay byte-identical), ${rows.length} row(s): ${new Set(newKeys.map((r) => keyOf(r.row))).size} new, ${supersedes.length} superseding. Overlay ${overlayBefore.length} -> ${overlayAfter.length}. Every row read back from the shipped artefacts; no overlay row lost or narrowed vs ${startSha.slice(0, 8)}.${supersedes.length ? ' Superseded: ' + clip(supersedes.join(' ; '), 200) : ''}`,
    next: 'node scripts/wg-batch-run.mjs --batch ' + BATCH + ' --stage apply-digest',
  };
}
function shippedDescription(category, id) {
  const descs = readMaybe('public/core-descriptions.json') ?? {};
  const e = descs[category]?.[id];
  if (e && typeof e === 'object' && e.d !== undefined) return e.d;
  if (typeof e === 'string') return e;
  return readMaybe('public/core.json')?.[category]?.[id]?.description ?? '';
}

/* ---- apply-digest ------------------------------------------------------------------------------- */
const GAP_HEADS = [['DATA STILL NEEDED', 'DATA STILL NEEDED'], ['CROSS-FILE GAPS', 'CROSS-FILE GAPS']];
/** Collate the two lists every builder and verifier report ends with. A list item is a bullet under the
 *  heading; the run ends at a blank line followed by a non-bullet, or at the next heading. */
export function gapLines(text, file) {
  const out = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const head = GAP_HEADS.find(([h]) => new RegExp(`\\b${h}\\b`, 'i').test(lines[i]) && lines[i].length < 120);
    if (!head) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (!l) { if (out.length && /^\s*$/.test(lines[j + 1] ?? '')) break; continue; }
      if (GAP_HEADS.some(([h]) => new RegExp(`\\b${h}\\b`, 'i').test(l))) break;
      if (!/^[-*•]|^\d+[.)]/.test(l)) break;
      if (/^[-*•]\s*\(?none\)?\.?$/i.test(l)) continue;
      out.push({ kind: head[1], line: clip(l.replace(/^[-*•]\s*|^\d+[.)]\s*/, ''), 400), ref: `${file}:${j + 1}` });
    }
  }
  return out;
}

async function stageApplyDigest() {
  const reports = readdirSync(abs('work')).filter((f) => new RegExp(`^\\.b${BATCH}-(report|verify)-.+\\.txt$`).test(f));
  if (!reports.length) refuse(`no build reports at work/.b${BATCH}-report-<family>.txt — the builders and verifiers write them (shared contract)`);

  const apply = { batch: BATCH, families: {} };
  const owed = [];
  const gaps = [];
  for (const f of reports.sort()) {
    const rel = `work/${f}`;
    const text = readFileSync(abs(rel), 'utf8');
    const m = f.match(new RegExp(`^\\.b${BATCH}-(report|verify)-(.+)\\.txt$`));
    const family = m[2];
    const label = m[1] === 'verify' ? `verify:${family}` : family;
    apply.families[label] = { file: rel, chars: text.length };
    /* The batch-29 owed digest: the head of each report, then only the lines that admit something is
     * unfinished — those are what the orchestrator has to act on. */
    owed.push(`## ${label}  (${text.length} chars, ${rel})`);
    owed.push(text.slice(0, 4000).trim());
    const flagged = text.split(/\r?\n/).filter((l) => /NOT[- ]DONE|FIXED-BY-ME|WRONG|could not|cannot|inert|residue|Residue|⚠/.test(l));
    if (flagged.length) { owed.push('-- flagged lines:'); owed.push(...flagged.map((l) => '   ' + l.slice(0, 400))); }
    owed.push('');
    for (const g of gapLines(text, rel)) gaps.push({ family, kind: g.kind, line: g.line, status: 'open', ref: g.ref });
  }
  write(P('apply.json'), apply);
  write(P('owed.txt'), owed.join('\n') + '\n');
  /* Never clobber dispositions a gap agent already recorded: an existing line keeps its status. */
  const prior = new Map((readMaybe(P('gaps.json')) ?? []).map((g) => [`${g.family}|${g.line}`, g]));
  const merged = gaps.map((g) => ({ ...g, ...(prior.get(`${g.family}|${g.line}`) ?? {}) }));
  write(P('gaps.json'), merged);

  const open = merged.filter((g) => g.status === 'open').length;
  return {
    counts: { reports: reports.length, gaps: merged.length, open },
    digest: `${reports.length} report(s) collated into ${P('apply.json')} + ${P('owed.txt')}; ${merged.length} gap line(s) (${open} still open) in ${P('gaps.json')}.`,
    next: open ? 'the gap agents resolve or park every open line, then --stage gaps' : 'node scripts/wg-batch-run.mjs --batch ' + BATCH + ' --stage gaps',
  };
}

/* ---- gaps --------------------------------------------------------------------------------------- */
/**
 * A MISSING gaps file used to read as "zero gap lines" and pass. apply-digest is the stage that writes
 * it, so apply.json present with gaps.json absent means the file was deleted or never landed — and
 * passing there turns every DATA STILL NEEDED line in the batch into a green stage. The guard belongs
 * in the driver rather than only in the workflow prompt: a hand run does not read prompts.
 *
 * Pure (paths in, refusal text or null out) so test/wg-batch-run.test.ts drives it on a fixture instead
 * of on the real work/ files — the same reason precheck() is pure.
 */
export const missingGapsRefusal = (applyExists, gapsExists, applyPath, gapsPath) => (applyExists && !gapsExists
  ? `${applyPath} exists but ${gapsPath} does not — apply-digest writes both. A missing gaps file is not "no gaps": re-run --stage apply-digest.`
  : null);

/**
 * Every gap line must be `authored` (it names a manifest spec / an edit / a test) or `parked` (an owner
 * question on the desk, or a flaggedResidue with a reason). Returns the problems; empty = disposed of.
 * `fileExists` is injected for the same reason: the driver passes its own `has`, a fixture passes its own.
 */
export function gapProblems({ gaps = [], known = new Set(), manifestFiles = new Set(), fileExists = () => false } = {}) {
  const bad = [];
  for (const g of gaps) {
    const where = `${g.family}: "${clip(g.line, 90)}"`;
    if (g.status === 'open') { bad.push(`${where} is still OPEN — every line must be authored (a spec / edit / test) or parked (a queue entry or a flaggedResidue with a reason)`); continue; }
    if (!['authored', 'parked'].includes(g.status)) { bad.push(`${where} has status ${JSON.stringify(g.status)} — only open / authored / parked exist`); continue; }
    const ref = String(g.ref ?? '');
    if (!ref) { bad.push(`${where} is ${g.status} with no ref`); continue; }
    if (g.status === 'authored' && !(manifestFiles.has(ref) || fileExists(ref) || /:\d+$/.test(ref))) {
      bad.push(`${where} is authored but its ref ${JSON.stringify(clip(ref, 80))} names no manifest spec, no file in the tree and no file:line`);
    }
    if (g.status === 'parked') {
      const residue = /^flaggedResidue:/i.test(ref);
      if (residue && ref.replace(/^flaggedResidue:/i, '').trim().length < 20) bad.push(`${where} is parked as a flaggedResidue with no reason`);
      else if (!residue && !known.has(ref)) bad.push(`${where} is parked against ${JSON.stringify(clip(ref, 60))}, which is neither an owner-question id on the desk nor "flaggedResidue: <reason>"`);
    }
  }
  return bad;
}

/** Queue entries not already on the owner's desk, in any of its four arrays — see stageGaps's RESUME note. */
export const pendingQuestions = (queue, desk) => {
  const onDesk = new Set(['open', 'deferred', 'ruled', 'authorisedExceptions'].flatMap((a) => desk?.[a] ?? []).map((q) => q.id));
  return (queue ?? []).filter((q) => !onDesk.has(q.id));
};

async function stageGaps() {
  const missing = missingGapsRefusal(has(P('apply.json')), has(P('gaps.json')), P('apply.json'), P('gaps.json'));
  if (missing) refuse(missing);

  /* The queue file is the ONLY way an agent asks an owner question, and the existing writer is the only
   * writer (the plan: "no sixth writer"). */
  const queue = readMaybe(P('queue.json'));
  let queued = 0;
  if (Array.isArray(queue) && queue.length) {
    const src = readFileSync(abs('scripts/add-owner-question.mjs'), 'utf8');
    if (!src.includes('--from')) refuse(`CROSS-FILE GAP: scripts/add-owner-question.mjs does not accept --from yet (shared contract: "scripts/add-owner-question.mjs --from that file writes work/owner-questions.json"). ${queue.length} queued question(s) cannot be filed: ${queue.map((q) => q.id).join(', ')}`);
    /* RESUME. add-owner-question.mjs refuses an id already on the desk and writes NOTHING when it does,
     * so re-running this stage after a later stage refused (batch 031: `close` demanded a desk n for the
     * three read-stage askOwner findings, which the closer then queued) would refuse on the entries this
     * stage itself filed a minute earlier. Only the entries not yet on the desk are handed over; the
     * queue file keeps every entry, so it stays the batch's record of what was asked. */
    const pending = pendingQuestions(queue, readMaybe('work/owner-questions.json') ?? {});
    if (pending.length) {
      const pendingFile = P('queue-pending.json');
      writeFileSync(abs(pendingFile), JSON.stringify(pending, null, 2));
      const r = node_('scripts/add-owner-question.mjs', ['--from', pendingFile, '--write']);
      if (r.status !== 0) refuse(`add-owner-question.mjs refused the queue (exit ${r.status}): ${tail(r.out, 6)}`);
    }
    queued = pending.length;
    if (pending.length !== queue.length) say(`${queue.length - pending.length} queued question(s) were already on the desk — filing only the ${pending.length} new one(s)`);
  }

  const gaps = readMaybe(P('gaps.json')) ?? [];
  const oq = readMaybe('work/owner-questions.json') ?? {};
  const known = new Set([...(oq.open ?? []), ...(oq.deferred ?? []), ...(oq.ruled ?? []), ...(oq.authorisedExceptions ?? []), ...(queue ?? [])].map((q) => q.id));
  const manifestFiles = new Set((readMaybe(P('specs.json')) ?? []).map((m) => m.file));
  const bad = gapProblems({ gaps, known, manifestFiles, fileExists: has });
  if (bad.length) refuse(`${bad.length} gap line(s) are not disposed of:\n  · ${bad.join('\n  · ')}`);

  return {
    counts: { gaps: gaps.length, authored: gaps.filter((g) => g.status === 'authored').length, parked: gaps.filter((g) => g.status === 'parked').length, queued },
    digest: `${gaps.length} gap line(s): ${gaps.filter((g) => g.status === 'authored').length} authored, ${gaps.filter((g) => g.status === 'parked').length} parked; ${queued} owner question(s) filed through add-owner-question.mjs.`,
    next: 'node scripts/wg-batch-run.mjs --batch ' + BATCH + ' --stage close',
  };
}

/* ---- close -------------------------------------------------------------------------------------- */
/**
 * Plan §A, the SECOND half of `close`: "diffs the baseline comparer dumps against fresh ones: every
 * record that went quiet must be in this batch or individually cited in the digest."
 *
 * A record "went quiet" when a comparer flagged it at the baseline and does not flag it now. Inside the
 * batch that is the point of the batch. OUTSIDE it, it is a settle, a teach or a widened reader that
 * silenced someone else's record — the failure mode the settle registries exist to make visible, and the
 * one a green gate cannot see, because the gate only looks at this batch's packet.
 *
 * ⚠ ONLY `kinds` (scripts/wg-diff.mjs) is compared here. wg-values and wg-identity take `--batch` and
 * see nothing outside the batch packet, so every out-of-batch record would read as "quiet" under them —
 * an absence of measurement, not an absence of a flag. wg-diff is corpus-wide and is the only comparer
 * that can honestly answer this question.
 */
export function wentQuiet(baseFlags, nowFlags, batchIdSet) {
  return Object.entries(baseFlags ?? {})
    .filter(([id, f]) => (f?.kinds?.length ?? 0) > 0 && (nowFlags?.[id]?.kinds?.length ?? 0) === 0 && !batchIdSet.has(id))
    .map(([id, f]) => ({ id, kinds: f.kinds }));
}
/** "Individually cited" = a DISPOSED gap line (authored or parked) whose text or ref names the record.
 *  A record silenced by this batch and explained nowhere is the definition of an uncited flip. */
export const uncitedQuiet = (quiet, gaps = []) => quiet.filter((q) => !gaps.some(
  (g) => ['authored', 'parked'].includes(g.status) && `${g.line ?? ''} ${g.ref ?? ''}`.includes(q.id),
));

function wentQuietOutsideBatch() {
  const base = readMaybe(`${P('baseline')}/flags.json`);
  if (!base) refuse(`no ${P('baseline')}/flags.json — run --stage baseline before --stage close. Without the baseline flags "what went quiet" cannot be computed, and a settle that silenced an EARLIER batch's record would ship unseen.`);
  const dir = P('close');
  mkdirSync(abs(dir), { recursive: true });
  const r = node_('scripts/wg-diff.mjs', ['--out', `${dir}/diff.json`]);
  if (r.status !== 0) refuse(`wg-diff.mjs exited ${r.status} during the close diff: ${tail(r.out, 4)}`);
  return wentQuiet(base, comparerFlags({ diff: readMaybe(`${dir}/diff.json`) }), batchIds());
}

async function stageClose() {
  if (!has('scripts/wg-batch-close.mjs')) refuse('needs scripts/wg-batch-close.mjs — the close stage derives the parity + residual artefacts through it (docs/wg-batch-pipeline.md §A) and never writes them itself');
  const r = node_('scripts/wg-batch-close.mjs', ['--batch', BATCH, '--write']);
  if (r.status !== 0) {
    const why = refusalTail(r.out, 8);
    return { ok: false, counts: { exit: r.status }, refusals: [clip(why, 4000)], digest: `wg-batch-close.mjs exited ${r.status}: ${clip(why, 460)}`, next: 'fix what the closer named, then re-run --stage close' };
  }
  /* ---- the second half: what went quiet OUTSIDE this batch ---- */
  const quiet = PRINT ? [] : wentQuietOutsideBatch();
  if (quiet.length) {
    const uncited = uncitedQuiet(quiet, readMaybe(P('gaps.json')) ?? []);
    if (uncited.length) {
      refuse(`${uncited.length} record(s) OUTSIDE batch ${BATCH} went quiet between the baseline and now — a comparer flagged them at ${P('baseline')}/flags.json and does not flag them any more, and nothing in ${P('gaps.json')} cites them (as authored or parked): ${uncited.slice(0, 12).map((q) => `${q.id} [${q.kinds.join(', ')}]`).join('; ')}`);
    }
  }

  const parity = readMaybe(`work/wg-batch-${BATCH}-parity.json`);
  const residual = readMaybe(`work/wg-batch-${BATCH}-residual.json`);
  const counts = {};
  for (const v of parity?.records ?? []) counts[v.verdict] = (counts[v.verdict] ?? 0) + 1;
  return {
    counts: { records: parity?.records?.length ?? 0, ...counts, flaggedResidues: residual?.flaggedResidues?.length ?? 0, wentQuietOutsideBatch: quiet.length },
    digest: `closed: ${parity?.records?.length ?? 0} parity verdict(s) [${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}], ${residual?.flaggedResidues?.length ?? 0} flagged residue(s). ${PRINT ? 'went-quiet diff skipped (print lane: no comparer baseline).' : `${quiet.length} record(s) outside this batch went quiet${quiet.length ? ', each cited in ' + P('gaps.json') + ': ' + clip(quiet.map((q) => q.id).join(', '), 180) : ''}.`} ${clip(tail(r.out, 3), 200)}`,
    next: 'node scripts/wg-batch-run.mjs --batch ' + BATCH + ' --stage experience',
  };
}

/* ---- experience / gate / regate / suite / verify ------------------------------------------------- */
const printSkip = (what) => ({
  counts: { skipped: 1 },
  digest: `PRINT LANE: ${what} skipped — it is THEIRS-dependent and this batch has no Wanderer's Guide side. This run's green report does NOT stand for the WG lane.`,
  next: 'node scripts/wg-batch-run.mjs --batch ' + BATCH + ' --stage suite',
});

async function stageExperience() {
  if (PRINT) return printSkip('the experience sweep');
  assertBatchFile();
  const r = node_('scripts/wg-experience.mjs', ['--batch', BATCH_FILE]);
  const art = readMaybe(BATCH_FILE.replace(/\.json$/, '-experience.json'));
  const summary = art?.summary ?? {};
  return {
    ok: r.status === 0,
    counts: { ...summary, played: art?.records?.length ?? 0 },
    digest: r.status === 0
      ? `played ${art?.records?.length ?? 0} record(s) on the real builder (observed ${art?.observed ?? '?'}): ${Object.entries(summary).map(([k, n]) => `${k} ${n}`).join(' · ')}`
      : `the experience sweep failed (exit ${r.status}) after one retry: ${clip(tail(r.out, 4), 380)}`,
    next: r.status === 0 ? `node scripts/wg-batch-run.mjs --batch ${BATCH} --stage gate` : 're-run --stage experience when the machine is idle',
  };
}

async function stageGate() {
  if (PRINT) return printSkip('the nine gates');
  assertBatchFile();
  const r = node_('scripts/wg-batch-gate.mjs', ['--batch', BATCH_FILE]);
  const fails = r.out.split(/\r?\n/).filter((l) => /^ {2}· /.test(l)).map((l) => l.slice(4));
  return {
    ok: r.status === 0,
    counts: { failedGates: fails.length },
    digest: r.status === 0 ? `all nine gates pass for ${BATCH_FILE}.` : `${fails.length} gate(s) failed: ${clip(fails.join(' ; '), 460)}`,
    next: r.status === 0 ? `node scripts/wg-batch-run.mjs --batch ${BATCH} --stage regate` : 'the closer triages each failing gate with citations',
  };
}

async function stageRegate() {
  if (PRINT) return printSkip('the earlier-batch re-gate');
  const r = node_('scripts/wg-regate-all.mjs', ['--batch', BATCH]);
  const failures = readMaybe('work/.regate-failures.json') ?? [];
  const green = Number((r.out.match(/regate: (\d+) green/) ?? [])[1] ?? 0);
  return {
    ok: r.status === 0,
    counts: { green, failed: failures.length },
    digest: r.status === 0
      ? `every earlier batch re-swept and re-gated green (${green}).`
      : `${failures.length} earlier batch(es) now fail — each needs a disposition line (fixed here / queued with a desk n / next batch): ${clip(failures.join(' ; '), 420)}`,
    next: r.status === 0 ? `node scripts/wg-batch-run.mjs --batch ${BATCH} --stage suite` : 'needs the orchestrator: a disposition for each newly failing earlier-batch record',
  };
}

/* ---- the verify chain, ONE CHECK AT A TIME -------------------------------------------------------
 * `npm run verify` is a single `&&` chain, so the first red check hides every check after it. That is
 * fatal to the tolerance the orchestrator ruled on 2026-09-08 ("a failing check that was already failing
 * at baseline … does not fail the stage"): tolerating the check that ABORTS the chain would silently
 * tolerate the thirty checks that never ran, turning the whole stage into a rubber stamp. So the chain is
 * split at its `&&` and each check is run on its own — the allowlist is still explicit, derived from
 * package.json's own `verify` script and nothing else. `jiti x` becomes `npx jiti x`: npm puts
 * node_modules/.bin on PATH, a bare spawn does not.
 */
export function verifyChecks(pkg) {
  return String(pkg?.scripts?.verify ?? '').split('&&').map((s) => s.trim()).filter(Boolean).map((seg) => {
    const parts = seg.split(/\s+/);
    const [cmd, ...args] = parts[0] === 'jiti' ? ['npx', 'jiti', ...parts.slice(1)] : parts;
    return { name: (seg.match(/scripts\/([\w.-]+)\.mjs/) ?? [])[1] ?? seg, cmd, args, key: [cmd, ...args].join(' ') };
  });
}
const verifyChain = () => verifyChecks(readMaybe('package.json'));
/** The first line that admits the failure, so the digest names WHAT broke, not just which script. */
const failLine = (out) => clip(out.split(/\r?\n/).find((l) => /FAIL|✗|✖|refus|Error/i.test(l)) ?? tail(out, 2), 200);
function runVerifyChecks() {
  return verifyChain().map((c) => {
    const r = sh(c.cmd, c.args);
    return { name: c.name, ok: r.status === 0, line: r.status === 0 ? null : failLine(r.out) };
  });
}
/**
 * THE TOLERANCE (orchestrator ruling 2026-09-08), pure so test/wg-batch-run.test.ts drives it on a
 * fixture. A check red at the baseline is another effort's, not this batch's: it is NAMED in the digest
 * and does not fail the stage. A check green at the baseline and red now is this batch's and fails it.
 * With no start-state (a batch cut before this existed) nothing is tolerated — the guard's default is on.
 *
 * The ruling's second half ("and none of the paths the batch changed belongs to that check's inputs") is
 * deliberately NOT built: no check declares its inputs, so any mapping would be a guess that could
 * tolerate a real regression. Simple and honest, as the ruling asks — the digest says what was tolerated.
 */
export function verifyVerdict(results, startState) {
  const known = new Set((startState?.verifyFailingAtStart ?? []).map((c) => c.name));
  const failed = results.filter((r) => !r.ok);
  const tolerated = startState ? failed.filter((r) => known.has(r.name)) : [];
  const newly = failed.filter((r) => !tolerated.includes(r));
  return {
    ok: newly.length === 0,
    checks: results.length,
    tolerated: tolerated.map((r) => r.name),
    newly: newly.map((r) => r.name),
    digest: `${results.length} verify check(s), ${results.length - failed.length} clean`
      + (tolerated.length ? `; pre-existing at start (not this batch): ${tolerated.map((r) => r.name).join(', ')}` : '')
      + (newly.length ? `; FAILED: ${newly.map((r) => `${r.name} — ${r.line}`).join(' ; ')}` : '')
      + (startState ? '' : '; no baseline start-state.json, so nothing is tolerated — run --stage baseline'),
  };
}

/* The suite tolerates NOTHING (ruling 2026-09-08): the tests are the batch's own instrument, and a red
 * test is red for this batch whoever turned it red. Only verify, the commit guard and the flip audit
 * subtract the start state. */
async function stageSuite() {
  const r = node_('scripts/vt.mjs', []);
  const line = (r.out.match(/Tests\s+.*$/m) ?? [])[0] ?? tail(r.out, 3);
  const failed = Number((r.out.match(/(\d+) failed/) ?? [])[1] ?? 0);
  return {
    ok: r.status === 0,
    counts: { failed },
    digest: r.status === 0 ? `full suite green — ${clip(line, 200)}` : `the suite failed (${failed} test(s)): ${clip(line, 400)}`,
    next: r.status === 0 ? `node scripts/wg-batch-run.mjs --batch ${BATCH} --stage verify` : 'the closer triages each failing test (flip audit before any test is changed)',
  };
}

async function stageVerify() {
  const startState = readMaybe(`${P('baseline')}/start-state.json`);
  const v = verifyVerdict(runVerifyChecks(), startState);
  return {
    ok: v.ok,
    counts: { checks: v.checks, tolerated: v.tolerated.length, failures: v.newly.length },
    digest: v.digest,
    next: v.ok ? 'node scripts/wg-batch-commit.mjs --batch ' + BATCH : 'the closer triages the failing guard',
  };
}

/* The verify chain's own commands, read out of package.json — the baseline stage runs them to record
 * which checks were ALREADY red, the verify stage runs them to compare (ruling 2026-09-08). Still an
 * explicit allowlist: nothing but package.json's `verify` script can put a command on it, and `npm run
 * data` is on no chain. */
const VERIFY_ALLOW = verifyChecks(readMaybe('package.json')).map((c) => c.key);

const STAGES = {
  cut: { allow: ['scripts/wg-next-batch-ids.mjs', 'scripts/wg-batch.mjs'], run: stageCut },
  baseline: { allow: ['scripts/wg-parity-dump.mjs', 'scripts/wg-values.mjs', 'scripts/wg-identity.mjs', 'scripts/wg-diff.mjs', 'scripts/wg-experience.mjs', 'scripts/wg-batch-gate.mjs', 'npx jiti scripts/wg-casting.mjs --out work/.b' + BATCH + '-baseline/casting.json', ...VERIFY_ALLOW], run: stageBaseline },
  'read-digest': { allow: [], run: stageReadDigest },
  apply: { allow: ['scripts/apply-parity-fixes.mjs', 'scripts/apply-backfill-now.mjs'], run: stageApply },
  'apply-digest': { allow: [], run: stageApplyDigest },
  gaps: { allow: ['scripts/add-owner-question.mjs'], run: stageGaps },
  /* wg-diff is on the close allowlist for the went-quiet diff (the second half of plan §A close) — it is
   * the only corpus-wide comparer, so it is the only one that can see an EARLIER batch's record fall
   * silent. */
  close: { allow: ['scripts/wg-batch-close.mjs', 'scripts/wg-diff.mjs'], run: stageClose },
  experience: { allow: ['scripts/wg-experience.mjs'], run: stageExperience },
  gate: { allow: ['scripts/wg-batch-gate.mjs'], run: stageGate },
  regate: { allow: ['scripts/wg-regate-all.mjs'], run: stageRegate },
  suite: { allow: ['scripts/vt.mjs'], run: stageSuite },
  verify: { allow: VERIFY_ALLOW, run: stageVerify },
};

/* ================================================================================================= *
 *  THE RUNNER
 * ================================================================================================= */
function appendEntry(entry) {
  const all = readMaybe(RUN_JSON) ?? [];
  all.push(entry);
  write(RUN_JSON, all);
}

/** A fresh 16-hex nonce per stage run — what a close-verifier must quote back out of its OWN run. */
export const newRunId = () => randomBytes(8).toString('hex');
/**
 * One work/.bNNN-run.json entry, in the shared contract's shape. The digest is clipped to 600 chars
 * HERE rather than at every call site: it is the only prose Fable reads per stage, and a stage that
 * pasted a 40 KB report into it would put the orchestrator back where §"Where Fable was spent" found it.
 */
export const entryOf = ({ stage, ok, runId, startedAt, endedAt, counts, digest, next, git, hashes, refusals }) => ({
  stage,
  ok: !!ok,
  exitCode: ok ? 0 : 1,
  runId,
  startedAt,
  endedAt,
  counts: counts ?? {},
  digest: clip(digest, 600),
  next: next ?? '',
  git,
  hashes,
  refusals: refusals ?? [],
});

async function runStage(stage) {
  CURRENT = stage;
  const runId = newRunId(); // the per-stage nonce a verifier must quote back
  const startedAt = new Date().toISOString();
  const gitStart = gitSnap();
  mkdirSync(abs('work'), { recursive: true });
  appendFileSync(abs(RUN_LOG), `\n===== ${stage} · runId ${runId} · ${startedAt}${PRINT ? ' · PRINT LANE' : ''} =====\n`);
  console.log(`\n===== ${stage} · runId ${runId}${PRINT ? ' · print lane' : ''} =====`);

  let ok = true;
  let counts = {};
  let digest = '';
  let next = '';
  const refusals = [];
  try {
    const r = await withHeavyLock(`wg-batch-run ${BATCH} ${stage}`, () => STAGES[stage].run());
    ok = r.ok !== false;
    counts = r.counts ?? {};
    digest = r.digest ?? '';
    next = r.next ?? '';
    /* A stage that returns ok:false because a CHILD refused carries that child's refusal here, so the
     * contract's refusals[] is never empty on a refused stage (batch-029 dry run: `close`). */
    refusals.push(...(r.refusals ?? []));
  } catch (e) {
    ok = false;
    const msg = e instanceof Refusal ? e.message : `${stage} threw: ${e?.stack ?? e?.message ?? e}`;
    refusals.push(clip(msg, 4000));
    /* The whole message, not its first line: the digest is what Fable reads, and a refusal that names
     * the offending ids only in the log is a refusal she cannot act on. `clip` folds the newlines. */
    digest = `REFUSED — ${msg}`;
    next = 'read the refusal in ' + RUN_LOG + ', fix it, then re-run this stage';
    say(msg);
  }

  const gitEnd = gitSnap();
  if (gitEnd.head !== gitStart.head || gitEnd.count !== gitStart.count || gitEnd.stash !== gitStart.stash) {
    /* The driver runs no git write command; if history moved during a stage, something else moved it and
     * every "unchanged since the batch started" claim below is void. */
    digest = `⚠ git moved during this stage (head ${gitStart.head.slice(0, 8)}→${gitEnd.head.slice(0, 8)}, commits ${gitStart.count}→${gitEnd.count}, stash ${gitStart.stash}→${gitEnd.stash}). ${digest}`;
  }

  const entry = entryOf({
    stage, ok, runId, startedAt, endedAt: new Date().toISOString(),
    counts, digest, next, git: gitEnd, hashes: hashes(), refusals,
  });
  appendEntry(entry);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${stage}: ${entry.digest}`);
  if (entry.next) console.log(`     next: ${entry.next}`);
  return ok;
}

if (IS_MAIN) {
  if (stageArg !== 'all' && !ORDER.includes(stageArg)) { console.error(`unknown stage ${stageArg}`); process.exit(2); }
  const stages = stageArg === 'all' ? ORDER.slice(ORDER.indexOf('apply')) : [stageArg];
  for (const s of stages) {
    const ok = await runStage(s);
    if (!ok) { console.error(`\nstopped at ${s}. The digest is ${RUN_JSON}.`); process.exit(1); }
  }
  console.log(`\n${stages.length} stage(s) ok. Digest: ${RUN_JSON}`);
  process.exit(0);
}
