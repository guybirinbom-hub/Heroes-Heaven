/*
 * WORKTREE LANES — several DATA lanes at once, each in its own checkout (docs/worktree-lanes.md).
 *
 *   node scripts/worktree-lane.mjs new <name> [--from <ref>]   C:\trying ai 2\hh-lane-<name>, detached at <ref>
 *   node scripts/worktree-lane.mjs prove <name>                npm run data + verify there; the generated files must equal the base
 *   node scripts/worktree-lane.mjs diff <name> > lane.patch    the merge-back patch against the lane's BASE commit
 *   node scripts/worktree-lane.mjs apply <name>                that patch onto main with `git apply --3way`; nothing staged
 *   node scripts/worktree-lane.mjs rm <name>                   unlink the junctions, THEN remove + prune
 *   node scripts/worktree-lane.mjs list
 *
 * A fresh `git worktree add` is not enough: the chains read inputs git does not carry. MEASURED with a
 * file-access trace of `npm run data` + `npm run verify` in a lane (69 processes, 2026-09-25): the
 * untracked files they read are exactly core.foundry-backup.json, .wg-diff-all.json,
 * owner-names.local.txt and the wg-batch-NNN.json pins. The rest of INPUTS serves the tests and the
 * lane tools. Read-only data dirs are JUNCTIONED (shared with main), everything else is COPIED.
 *
 * ⚠ NEVER `git worktree remove` a lane by hand. Measured on git 2.53.0.windows.2: `git worktree remove
 * --force` FOLLOWS a junction and empties its target — main's node_modules, .import-src and work/wg.
 * `rm` unlinks every link in the lane first. PowerShell 5.1 `Remove-Item -Recurse` follows them too.
 *
 * The lane keeps core.autocrlf=input in its own config.worktree: checkout writes every blob as-is (the
 * machine's autocrlf=true would turn all 3,015 LF text files CRLF) and `add` folds CRLF to LF exactly as
 * main's autocrlf=true does. write-backfill.mjs writes effect-backfill.json CRLF over an LF blob; with
 * autocrlf=false that was a whole-file rewrite in every lane patch, with `input` it is no change.
 *
 * `new` records the lane in <lane>/.worktree-lane.json: the BASE commit (`diff`/`prove` compare against it,
 * so commits made inside the lane stay in the patch), the lane-only edits it made, and a sha1 of every
 * file it copied (so `diff` reports a worker's edit to a copy, not main's own later changes).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, cpSync, existsSync, mkdirSync, openSync, closeSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The untracked inputs a lane needs from main. `match` copies the matching files of a directory. */
export const INPUTS = [
  { path: 'node_modules', how: 'junction', why: 'every chain (jiti, vitest, vite)' },
  { path: 'tracker/node_modules', how: 'junction', why: 'tests that render tracker components resolve its zustand/react' },
  { path: '.import-src', how: 'junction', why: 'the Foundry clone (backfill-alternate-domains, gold-* scripts)' },
  { path: 'work/wg', how: 'junction', why: 'the WG dump work/wg/wg-data.sql — wg-diff.mjs needs it to refresh .wg-diff-all.json after a regen' },
  { path: 'public/core.foundry-backup.json', how: 'copy', why: 'import-core-v2 transcription REF; absent, it transcribes from core.json and then WRITES a new backup from it' },
  { path: 'work/.wg-diff-all.json', how: 'copy', why: 'trust-ledger.mjs comparer input (trust-ledger-check §10; skipped while older than core.json, as on main after a regen)' },
  { path: 'work/owner-names.local.txt', how: 'copy', why: 'owner-names-check (verify); never tracked' },
  { path: 'work', match: /^wg-batch-\d+\.json$/, how: 'copy', why: 'the batch pins (gitignored): parity-residual-check, trust-ledger.mjs, tests' },
  { path: 'scripts/aon-verify', how: 'copy', why: 'code (test/granted-lore-lane reads it); copied, so a script run from it resolves its ROOT to the lane' },
  { path: '.env', how: 'copy', why: 'vite/vitest env' },
];

const isInput = (p) => INPUTS.some(({ path, match }) =>
  (match ? p.startsWith(`${path}/`) && match.test(p.slice(path.length + 1)) : p === path || p.startsWith(`${path}/`)));

/**
 * EXACTLY the tracked files `npm run data` + `npm run verify` rewrite, as git glob pathspecs. MEASURED by
 * mtime in hh-lane-proof2 (2026-09-25): 3 in public/, all 76 public/ast/*.json.gz and these 6 of the 21
 * scripts/migration/out/*.json — the other 15 (join, located, resolved, drop-adventure-loot,
 * variant-items, reclassified, is-really-the-doc, sections … ) are INPUTS a worker may edit, never
 * regenerated. `prove` fails when the run rewrites a tracked file outside this list or leaves one in it
 * alone, so the list cannot drift silently.
 */
export const GENERATED = [
  'public/core.json', 'public/core-descriptions.json', 'public/ast-index.json', 'public/ast/*.json.gz',
  ...['map', 'used-docs', 'archive-created', 'action-cost-notes', 'player-created', 'open'].map((n) => `scripts/migration/out/${n}.json`),
];
/** Never in the patch: GENERATED, and the trust ledger (only a hand run of trust-ledger.mjs writes it; main re-stamps it after its one regen). */
export const NOT_MERGED = [...GENERATED, 'src/data/trust-ledger.json'];
const globRe = (g) => new RegExp(`^${g.replace(/\./g, '\\.').replace(/\*/g, '[^/]+')}$`);
const matches = (globs, p) => globs.some((g) => globRe(g).test(p));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 1 << 30 }).trim();
const HERE = dirname(fileURLToPath(import.meta.url));
/** The MAIN checkout, even when this runs from inside a lane: the parent of the shared .git dir. */
export const mainCheckout = (from = HERE) => dirname(git(from, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
export const laneDir = (main, name) => join(dirname(main), `hh-lane-${name}`);

const RECORD = '.worktree-lane.json';
const sha1 = (p) => createHash('sha1').update(readFileSync(p)).digest('hex');
const readRecord = (lane) => {
  if (!existsSync(join(lane, RECORD))) throw new Error(`no ${RECORD} in ${lane} — not made by \`new\`; make the lane again`);
  return JSON.parse(readFileSync(join(lane, RECORD), 'utf8'));
};

/** Link/copy every INPUTS entry from `main` into `lane`. Never overwrites what the lane already has. */
export function linkInputs(main, lane, inputs = INPUTS) {
  return inputs.map(({ path, how, match }) => {
    const src = join(main, path);
    const dst = join(lane, path);
    const label = match ? `${path}/${match.source}` : path;
    if (!existsSync(src)) return { path: label, how, result: 'absent in main, skipped' };
    if (match) {
      mkdirSync(dst, { recursive: true });
      const files = readdirSync(src).filter((f) => match.test(f) && !existsSync(join(dst, f)));
      for (const f of files) cpSync(join(src, f), join(dst, f));
      return { path: label, how, result: `${files.length} file(s)` };
    }
    if (existsSync(dst)) return { path: label, how, result: 'already in the lane, left alone' };
    mkdirSync(dirname(dst), { recursive: true });
    if (how === 'junction') symlinkSync(src, dst, 'junction');
    else cpSync(src, dst, { recursive: true });
    return { path: label, how, result: how === 'junction' ? `-> ${src}` : `copied (${statSync(dst).isDirectory() ? 'dir' : `${statSync(dst).size} B`})` };
  });
}

/** The lane's untracked files at the COPY inputs, gitignored ones included: `new`'s copies plus whatever a worker added there (a new batch pin). */
export const copiedFiles = (lane) => git(lane, 'ls-files', '--others', '-z', '--',
  ...INPUTS.filter((i) => i.how === 'copy').map(({ path, match }) => (match ? `:(glob)${path}/*` : path)))
  .split('\0').filter((p) => p && isInput(p));

/** Unlink every symlink/junction under `dir` without descending into it. Returns what it unlinked. */
export function unlinkLinks(dir, out = []) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isSymbolicLink()) { unlinkSync(p); out.push(p); } else if (d.isDirectory() && d.name !== '.git') unlinkLinks(p, out);
  }
  return out;
}

/**
 * Compare `laneFiles` (repo-relative path -> Buffer|null) with `refFiles` (same, from the ref).
 * Returns one row per path in either, sorted; `same` is byte equality.
 */
export function compareFiles(refFiles, laneFiles) {
  return [...new Set([...Object.keys(refFiles), ...Object.keys(laneFiles)])].sort().map((path) => {
    const a = refFiles[path] ?? null;
    const b = laneFiles[path] ?? null;
    return { path, ref: a?.length ?? null, lane: b?.length ?? null, same: !!a && !!b && a.equals(b) };
  });
}

/** Tracked code in `root` that names the MAIN checkout by absolute path: run from a lane it reads and WRITES main. */
export function mainPathHazards(root, main) {
  const esc = main.split(/[\\/]+/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[/\\\\]+');
  try {
    return git(root, 'grep', '-l', '-i', '-E', esc, '--', '*.mjs', '*.js', '*.cjs', '*.ts', '*.tsx').split('\n').filter(Boolean);
  } catch { return []; } // git grep exits 1 on no match
}

/** The data/verify chain scripts named by the checkout's package.json. */
const chainEntries = (root) => {
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return ['data', 'verify'].flatMap((k) => scripts[k].split('&&').map((s) => s.trim().match(/^(?:node|jiti)\s+(\S+)/)?.[1]).filter(Boolean));
};

const MARK = 'worktree-lane:';
const fwd = (p) => p.replace(/\\/g, '/');
/** Heavy-job lock of the whole machine: MAIN's, whichever checkout asks (heavy-lock.mjs: one job per machine). */
export const machineLock = (main) => join(main, 'work/.heavy.lock');

/**
 * The lane-only edits `new` makes to tracked files. A file that does not contain `from` is left alone.
 *  - A data/verify chain script with `const ROOT = '<main>/';` gets a checkout-relative ROOT. Main's
 *    split-descriptions.mjs and verify-characters.mjs resolve ROOT themselves from 2026-09-25; a lane made
 *    from any commit before that fix (bff4817 included) still needs this, later ones match nothing.
 *  - heavy-lock.mjs defaults to MAIN's work/.heavy.lock. Its own default is the checkout it lives in, so
 *    each lane would get a lock of its own and lanes' vitest runs would overlap — the load under which
 *    vitest runs zero tests and exits 0.
 */
export function laneEdits(lane, main) {
  const edits = [...new Set(chainEntries(lane))].map((file) => ({
    file,
    from: `const ROOT = '${fwd(main)}/';`,
    to: `import { fileURLToPath as laneRoot } from 'node:url'; const ROOT = laneRoot(new URL('${'../'.repeat(file.split('/').length - 1)}', import.meta.url)).replace(/\\\\/g, '/'); // ${MARK} this checkout, never main`,
  }));
  edits.push({
    file: 'scripts/lib/heavy-lock.mjs',
    from: "join(ROOT, 'work/.heavy.lock')",
    to: `${JSON.stringify(fwd(machineLock(main)))} /* ${MARK} main's lock, one heavy job per machine */`,
  });
  return edits;
}

/** Apply laneEdits in `lane`; returns the edits it made. */
export function patchLane(lane, main) {
  return laneEdits(lane, main).filter(({ file, from, to }) => {
    const p = join(lane, file);
    const text = existsSync(p) ? readFileSync(p, 'utf8') : '';
    if (!text.includes(from)) return false;
    writeFileSync(p, text.replace(from, () => to));
    return true;
  });
}

/**
 * The merge-back patch: every change in the lane since its BASE commit — committed there or not — in the
 * whole tree, binary-safe, minus NOT_MERGED, with `new`'s edits put back to what `new` found. The put-back
 * happens in a scratch copy of the lane's index (a worker edit within git's context lines of a
 * `worktree-lane:` line shares its hunk, so filtering hunks would carry the lane's ROOT line or main's lock
 * path into main). A `worktree-lane:` line changed by hand cannot be put back: refused.
 * `newFiles`: untracked files the patch does not carry — not-ignored ones anywhere, plus anything new at a
 * COPY input (a new batch pin). `changedCopies`: copies the lane edited since `new`. Both go to main by hand.
 */
export function laneDiff(lane) {
  const { base, edits, copies } = readRecord(lane);
  const index = resolve(lane, git(lane, 'rev-parse', '--git-path', 'worktree-lane-diff.index'));
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const g = (args, input) => execFileSync('git', args, { cwd: lane, env, input, stdio: 'pipe', maxBuffer: 1 << 30 });
  const spec = ['.', ...NOT_MERGED.map((p) => `:(exclude,glob)${p}`)];
  copyFileSync(resolve(lane, git(lane, 'rev-parse', '--git-path', 'index')), index); // keeps stat data: add -u rehashes only what changed
  try {
    g(['add', '-u', '--', ...spec]);
    const putBack = edits.flatMap(({ file, from, to }) => {
      const p = join(lane, file);
      const text = existsSync(p) ? readFileSync(p, 'utf8') : '';
      if (!text.includes(to)) {
        if (text.includes(MARK)) throw new Error(`refusing: the ${MARK} line in ${file} was changed by hand — restore it, or merge ${file} by hand`);
        return [];
      }
      const sha = g(['hash-object', '-w', '--stdin', `--path=${file}`], text.replace(to, () => from)).toString().trim();
      return [`${g(['ls-files', '-s', '--', file]).toString().split(' ')[0]} ${sha}\t${file}`];
    });
    if (putBack.length) g(['update-index', '--index-info'], `${putBack.join('\n')}\n`);
    const patch = g(['diff', '--cached', '--binary', '--no-renames', base, '--', ...spec]); // bytes: never re-encoded
    const newFiles = git(lane, 'ls-files', '--others', '--exclude-standard', '-z').split('\0')
      .filter((p) => p && p !== RECORD && !isInput(p) && !matches(GENERATED, p));
    const changedCopies = [];
    for (const p of copiedFiles(lane)) {
      if (!(p in copies)) newFiles.push(p);
      else if (sha1(join(lane, p)) !== copies[p]) changedCopies.push(p);
    }
    return { patch, newFiles: newFiles.sort(), changedCopies };
  } finally {
    rmSync(index, { force: true });
  }
}

/**
 * Apply a lane patch to `target` (main) with `git apply --3way`, in a scratch copy of target's index: the
 * worktree gets the changes, the real index is untouched, so nothing is staged behind anyone's back.
 * --3way reads the preimage from the blob, so main's CRLF working tree (autocrlf=true) does not break the
 * LF context, and a file main changed since the lane's base merges instead of failing. Refuses, applying
 * nothing, when target has uncommitted changes (staged, unstaged or untracked) in a file the patch touches.
 */
export function applyPatch(target, patch) {
  if (!patch.length) return { files: [], conflicts: [] };
  const tg = (args, opt = {}) => execFileSync('git', args, { cwd: target, stdio: 'pipe', maxBuffer: 1 << 30, ...opt }).toString();
  const files = tg(['apply', '--numstat', '-z'], { input: patch }).split('\0').filter(Boolean).map((r) => r.split('\t')[2]);
  const st = tg(['--no-optional-locks', 'status', '--porcelain', '-z', '-uall']).split('\0');
  const dirty = new Set();
  for (let i = 0; i < st.length; i++) if (st[i]) { dirty.add(st[i].slice(3)); if (/^[RC]/.test(st[i])) dirty.add(st[++i]); }
  const busy = files.filter((f) => dirty.has(f));
  if (busy.length) throw new Error(`refusing: ${target} has uncommitted changes in ${busy.length} file(s) the patch touches — nothing applied:\n  ${busy.join('\n  ')}`);
  const index = resolve(target, tg(['rev-parse', '--git-path', 'worktree-lane-apply.index']).trim());
  copyFileSync(resolve(target, tg(['rev-parse', '--git-path', 'index']).trim()), index);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    const r = spawnSync('git', ['apply', '--3way'], { cwd: target, env, input: patch, encoding: 'utf8', maxBuffer: 1 << 30 });
    const conflicts = tg(['diff', '--name-only', '--diff-filter=U', '-z'], { env }).split('\0').filter(Boolean);
    if (r.status !== 0 && !conflicts.length) throw new Error(`git apply --3way failed, nothing applied:\n${r.stderr}`);
    return { files, conflicts };
  } finally {
    rmSync(index, { force: true });
  }
}

/**
 * A proof passes only when data AND verify exit 0, every generated file is byte-identical to the base,
 * the run rewrote exactly the GENERATED files, and `diff` has nothing to carry.
 */
export const proofPassed = ({ codes, diff, notRewritten, strays, patch, newFiles, changedCopies }) =>
  codes.data === 0 && codes.verify === 0 && diff.length === 0 && notRewritten.length === 0 && strays.length === 0
  && patch.length === 0 && newFiles.length === 0 && changedCopies.length === 0;

export function newLane(name, { main = mainCheckout(), from = 'HEAD' } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) throw new Error(`lane name "${name}": letters, digits and dashes only`);
  const lane = laneDir(main, name);
  if (existsSync(lane)) throw new Error(`refusing: ${lane} already exists (rm the lane, or pick another name)`);
  if (spawnSync('git', ['config', '--bool', 'extensions.worktreeConfig'], { cwd: main, encoding: 'utf8' }).stdout?.trim() !== 'true') {
    throw new Error('refusing: main needs extensions.worktreeConfig=true — without it a lane cannot keep core.autocrlf=input of its own');
  }
  const sha = git(main, 'rev-parse', '--verify', `${from}^{commit}`);
  git(main, '-c', 'core.autocrlf=input', 'worktree', 'add', '--quiet', '--detach', lane, sha);
  git(lane, 'config', '--worktree', 'core.autocrlf', 'input'); // -c covers the first checkout only; this covers every later one
  const edits = patchLane(lane, main);
  const links = linkInputs(main, lane);
  const copies = Object.fromEntries(copiedFiles(lane).map((p) => [p, sha1(join(lane, p))]));
  writeFileSync(join(lane, RECORD), `${JSON.stringify({ base: sha, edits, copies }, null, 1)}\n`);
  const patched = edits.map((e) => e.file);
  const hazards = mainPathHazards(lane, main).filter((f) => !patched.includes(f));
  const chain = chainEntries(lane);
  return { lane, sha, links, patched, hazards, chainHazards: hazards.filter((f) => chain.includes(f)) };
}

function run(lane, script, log, main) {
  const env = { ...process.env, HEAVY_LOCK_PATH: machineLock(main) };
  delete env.HH_ROOT; delete env.PARITY_ROOT; // another checkout's root must not leak into the lane's chain
  const fd = openSync(log, 'w');
  try { return spawnSync('npm', ['run', script], { cwd: lane, env, stdio: ['ignore', fd, fd], shell: true }).status ?? 1; } finally { closeSync(fd); }
}

export function prove(name, { main = mainCheckout() } = {}) {
  const lane = laneDir(main, name);
  if (!existsSync(lane)) throw new Error(`no lane at ${lane}`);
  const { base } = readRecord(lane);
  const bad = mainPathHazards(lane, main).filter((f) => chainEntries(lane).includes(f));
  if (bad.length) throw new Error(`refusing: these chain scripts hardcode ${main} and would read/write MAIN from the lane:\n  ${bad.join('\n  ')}`);
  const start = Date.now();
  const codes = {};
  for (const s of ['data', 'verify']) {
    const log = join(lane, `work/.lane-${s}.log`);
    console.log(`npm run ${s} … (log: ${log})`);
    codes[s] = run(lane, s, log, main);
    const text = readFileSync(log, 'utf8').split(/\r?\n/);
    console.log(`  exit ${codes[s]}; ${text.length} lines; last: ${text.filter(Boolean).slice(-2).join(' | ').slice(0, 300)}`);
  }
  const secs = Math.round((Date.now() - start) / 1000);
  const tracked = git(lane, 'ls-files', '-z').split('\0').filter((p) => p && existsSync(join(lane, p)));
  const rewritten = new Set(tracked.filter((p) => statSync(join(lane, p)).mtimeMs >= start));
  const notRewritten = tracked.filter((p) => matches(GENERATED, p) && !rewritten.has(p));
  const strays = [...rewritten].filter((p) => !matches(GENERATED, p));
  const refFiles = {};
  for (const p of git(lane, 'ls-tree', '-r', '-z', '--name-only', base, '--', 'public', 'scripts/migration/out').split('\0').filter((f) => f && matches(GENERATED, f))) {
    refFiles[p] = execFileSync('git', ['cat-file', 'blob', `${base}:${p}`], { cwd: lane, maxBuffer: 1 << 30 });
  }
  const laneFiles = {};
  for (const d of ['public', 'public/ast', 'scripts/migration/out']) {
    for (const f of existsSync(join(lane, d)) ? readdirSync(join(lane, d)) : []) {
      if (matches(GENERATED, `${d}/${f}`)) laneFiles[`${d}/${f}`] = readFileSync(join(lane, d, f));
    }
  }
  const rows = compareFiles(refFiles, laneFiles);
  const diff = rows.filter((r) => !r.same);
  const { patch, newFiles, changedCopies } = laneDiff(lane);
  console.log(`\n${secs} s. compared ${rows.length} generated files against the base ${base.slice(0, 7)}: ${rows.length - diff.length} byte-identical, ${diff.length} differ`);
  for (const r of diff) console.log(`  ${r.path.padEnd(48)} ref ${String(r.ref ?? '—').padStart(10)}  lane ${String(r.lane ?? '—').padStart(10)}`);
  console.log(`the run rewrote ${rewritten.size} tracked files; GENERATED left alone: ${notRewritten.length}; rewritten outside GENERATED: ${strays.length}`);
  for (const p of notRewritten) console.log(`  in GENERATED, not rewritten (diff would drop a worker's edit to it): ${p}`);
  for (const p of strays) console.log(`  rewritten outside GENERATED: ${p}`);
  console.log(`diff: ${patch.length}-byte patch, ${newFiles.length} new file(s), ${changedCopies.length} changed cop(ies)`);
  const ok = proofPassed({ codes, diff, notRewritten, strays, patch, newFiles, changedCopies });
  console.log(ok ? 'PROOF PASSED' : 'PROOF FAILED');
  return { codes, rows, diff, rewritten, notRewritten, strays, patch, newFiles, changedCopies, ok };
}

export function rmLane(name, { main = mainCheckout() } = {}) {
  const lane = laneDir(main, name);
  if (!existsSync(lane)) throw new Error(`no lane at ${lane}`);
  const unlinked = unlinkLinks(lane); // BEFORE git: `git worktree remove --force` empties junction targets
  git(main, 'worktree', 'remove', '--force', lane);
  git(main, 'worktree', 'prune');
  return unlinked;
}

const leftovers = ({ newFiles, changedCopies }) => {
  if (newFiles.length) console.error(`⚠ new files NOT in the patch — copy them to main by hand:\n  ${newFiles.join('\n  ')}`);
  if (changedCopies.length) console.error(`⚠ copied inputs the lane changed since \`new\` — NOT in the patch, copy by hand if main needs them:\n  ${changedCopies.join('\n  ')}`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, name, ...rest] = process.argv.slice(2);
  const fromAt = rest.indexOf('--from');
  const existing = () => {
    const lane = laneDir(mainCheckout(), name);
    if (!existsSync(lane)) throw new Error(`no lane at ${lane}`);
    return lane;
  };
  try {
    if (cmd === 'new' && name) {
      const r = newLane(name, fromAt >= 0 ? { from: rest[fromAt + 1] } : {});
      console.log(`lane ${r.lane} at ${r.sha.slice(0, 7)} (core.autocrlf=input in its config.worktree: tracked files are their blobs)`);
      for (const l of r.links) console.log(`  ${l.how.padEnd(8)} ${l.path.padEnd(34)} ${l.result}`);
      for (const f of r.patched) console.log(`  edited   ${f} (${MARK} line; \`diff\` puts it back — never change it by hand)`);
      if (r.hazards.length) console.log(`\n⚠ ${r.hazards.length} tracked file(s) still hardcode the MAIN checkout — NEVER run them from this lane, they read/write MAIN:\n  ${r.hazards.join('\n  ')}`);
      if (r.chainHazards.length) console.log(`\n⚠⚠ ${r.chainHazards.length} of them are in the data/verify chains: \`npm run data\` / \`npm run verify\` in this lane would write/read MAIN. prove refuses; do not run them here.`);
      console.log('\nremove ONLY with: node scripts/worktree-lane.mjs rm ' + name);
    } else if (cmd === 'prove' && name) {
      process.exit(prove(name).ok ? 0 : 1);
    } else if (cmd === 'diff' && name) {
      const d = laneDiff(existing());
      process.stdout.write(d.patch);
      leftovers(d);
    } else if (cmd === 'apply' && name) {
      const d = laneDiff(existing());
      const main = mainCheckout();
      const { files, conflicts } = applyPatch(main, d.patch);
      console.log(`applied ${files.length} file(s) to ${main} (git apply --3way; nothing staged)`);
      if (conflicts.length) console.log(`⚠ ${conflicts.length} file(s) have conflict markers — resolve by hand:\n  ${conflicts.join('\n  ')}`);
      leftovers(d);
      console.log('next on main: apply-parity-fixes specs -> ONE npm run data -> wg-diff --out + trust-ledger.mjs -> npm run verify (docs/worktree-lanes.md)');
    } else if (cmd === 'rm' && name) {
      const u = rmLane(name);
      console.log(`unlinked ${u.length} link(s), removed ${laneDir(mainCheckout(), name)}`);
    } else if (cmd === 'list') {
      console.log(git(mainCheckout(), 'worktree', 'list').split('\n').filter((l) => /hh-lane-/.test(l)).join('\n') || '(no lanes)');
    } else {
      console.log('usage: node scripts/worktree-lane.mjs new <name> [--from <ref>] | prove <name> | diff <name> | apply <name> | rm <name> | list');
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
