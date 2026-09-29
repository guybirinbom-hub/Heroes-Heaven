/*
 * WORKTREE LANES — several DATA lanes at once, each in its own checkout (docs/worktree-lanes.md).
 *
 *   node scripts/worktree-lane.mjs new <name> [--from <ref>]   C:\trying ai 2\hh-lane-<name>, detached at <ref>
 *   node scripts/worktree-lane.mjs prove <name>                npm run data + verify there; the generated files must equal the base
 *   node scripts/worktree-lane.mjs diff <name> > lane.patch    the merge-back patch against the lane's BASE commit
 *   node scripts/worktree-lane.mjs apply <name>                that patch onto main with `git apply --3way`; nothing staged; every line keeps its ending
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
 * autocrlf=false git saw a whole-file change there (and would in any file a tool writes CRLF), with
 * `input` it sees none.
 *
 * `new` changes NO tracked file. What a lane shares with main it gets from main's own code, which works the
 * same from any checkout: every script the data/verify chains and the tests run resolves its ROOT from its
 * own location (hazardsInChain below keeps it that way; the agent workflow scripts in DRIVES_MAIN drive main
 * by design), and scripts/lib/heavy-lock.mjs finds MAIN's lock through the git dir every checkout shares. `new` records the lane in <lane>/.worktree-lane.json: the BASE
 * commit (`diff`/`prove` compare against it, so commits made inside the lane stay in the patch) and a sha1
 * of every file it copied (so `diff` reports a worker's edit to a copy, not main's own later changes).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  {
    path: 'scripts/aon-verify', how: 'copy',
    why: 'tests import _ser.ts and read apply-*.ts as text (granted-lore-lane, innate-tradition, authoring-guards). '
      + '⚠ 9 of its scripts hardcode the MAIN checkout (5 WRITE main\'s src/rules feat-grant files): `new` lists them — never run them from a lane',
  },
  { path: '.env', how: 'copy', why: 'vite/vitest env' },
];

const isInput = (p) => INPUTS.some(({ path, match }) =>
  (match ? p.startsWith(`${path}/`) && match.test(p.slice(path.length + 1)) : p === path || p.startsWith(`${path}/`)));

/**
 * EXACTLY the tracked files `npm run data` + `npm run verify` rewrite, as git glob pathspecs. MEASURED by
 * mtime in hh-lane-proof2 (2026-09-25; `prove` there from 2ba18f5 again 2026-09-29: exactly these 85, none
 * outside): 3 in public/, all 76 public/ast/*.json.gz and these 6 of the 21
 * scripts/migration/out/*.json — the other 15 (join, located, resolved, drop-adventure-loot,
 * variant-items, reclassified, is-really-the-doc, sections … ) are INPUTS a worker may edit, never
 * regenerated. `prove` fails when the run rewrites a tracked file outside this list or leaves one in it
 * alone, so the list cannot drift silently.
 */
export const GENERATED = [
  'public/core.json', 'public/core-descriptions.json', 'public/ast-index.json', 'public/ast/*.json.gz',
  ...['map', 'used-docs', 'archive-created', 'action-cost-notes', 'player-created', 'open'].map((n) => `scripts/migration/out/${n}.json`),
];
/**
 * The overlay. apply-parity-fixes.mjs is its ONLY writer (CLAUDE.md), so the lane's rows reach main as the
 * lane's spec files re-applied there, never through `git apply`: a patch that carried them would bypass
 * its guards against main's current overlay, and re-applying the specs after it would be refused as an
 * undeclared supersedes. What the data chain itself writes into it (edition-drift-check, fix-aonid-
 * collisions, … when they find work) main's own regen writes again.
 */
export const OVERLAY = 'scripts/data/effect-backfill.json';
/** Never in the patch: GENERATED, the overlay, and the trust ledger (only a hand run of trust-ledger.mjs writes it; main re-stamps it after its one regen). */
export const NOT_MERGED = [...GENERATED, OVERLAY, 'src/data/trust-ledger.json'];
const globRe = (g) => new RegExp(`^${g.replace(/\./g, '\\.').replace(/\*/g, '[^/]+')}$`);
const matches = (globs, p) => globs.some((g) => globRe(g).test(p));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 1 << 30 }).trim();
const HERE = dirname(fileURLToPath(import.meta.url));
/** The MAIN checkout, even when this runs from inside a lane: the parent of the shared .git dir. */
export const mainCheckout = (from = HERE) => dirname(git(from, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
export const laneDir = (main, name) => join(dirname(main), `hh-lane-${name}`);

const RECORD = '.worktree-lane.json';
const sha1 = (p) => createHash('sha1').update(readFileSync(p)).digest('hex');
const fwd = (p) => p.replace(/\\/g, '/');
const readRecord = (lane) => {
  if (!existsSync(join(lane, RECORD))) throw new Error(`no ${RECORD} in ${lane} — not made by \`new\`; make the lane again`);
  const rec = JSON.parse(readFileSync(join(lane, RECORD), 'utf8'));
  if (rec.edits?.length) { // an older `new` edited heavy-lock.mjs in the lane; nothing puts that back any more
    throw new Error(`refusing: ${lane} was made by an older \`new\` that edited ${rec.edits.map((e) => e.file).join(', ')} — its patch would carry that edit into main. rm the lane and make it again`);
  }
  return rec;
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

/** The untracked files at the COPY inputs, gitignored ones included: in a lane `new`'s copies plus whatever a worker added there (a new batch pin); in main, the originals. */
export const copiedFiles = (root) => git(root, 'ls-files', '--others', '-z', '--',
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

/* ------------------------------------------------------------------------------------------------------
 * CODE THAT NAMES THE MAIN CHECKOUT. Run from a lane, it reads and WRITES main. Two lists:
 *   mainPathHazards — every such file in a checkout, tracked or not (the untracked copies `new` makes of
 *     scripts/aon-verify included): `new` prints it, the doc says never run them from a lane.
 *   hazardsInChain — the ones the chains actually RUN: the import + spawn closure of `npm run data` and
 *     `npm run verify` (and, with tests, of `node scripts/vt.mjs` over every test file). `prove` refuses
 *     a lane where it is not empty; test/worktree-lane.test.ts keeps it empty on main.
 * ---------------------------------------------------------------------------------------------------- */

/** A regex source (POSIX ERE for `git grep -E` and JS alike) for `main` in any spelling: C:/…, C:\…, C:\\…, git-bash /c/…; case-insensitive use. */
export const mainPathSource = (main) => {
  const [first, ...rest] = fwd(main).split('/').filter(Boolean);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const drive = /^[a-z]:$/i.test(first) ? `(${esc(first)}|[/\\\\]${first[0]})` : esc(first);
  return [drive, ...rest.map(esc)].join('[/\\\\]+');
};
const CODE_RE = /\.(?:mjs|cjs|js|ts|tsx|mts|cts)$/;
const RUNNABLE_RE = /\.(?:mjs|cjs|js|ts|tsx|mts|cts|py|ps1|sh|bat|cmd)$/;
const RUNNABLE_GLOBS = ['*.mjs', '*.cjs', '*.js', '*.ts', '*.tsx', '*.mts', '*.cts', '*.py', '*.ps1', '*.sh', '*.bat', '*.cmd'];

/** Every file in `root` whose code names `main`: tracked (git grep), untracked not ignored, and the untracked COPY inputs (gitignored, e.g. scripts/aon-verify). */
export function mainPathHazards(root, main) {
  const src = mainPathSource(main);
  const names = (s) => s.split(/[\n\0]/).filter(Boolean);
  let tracked = [];
  try { tracked = names(git(root, 'grep', '-l', '-z', '-i', '-E', src, '--', ...RUNNABLE_GLOBS)); } catch { /* git grep exits 1 on no match */ }
  const rx = new RegExp(src, 'i');
  const untracked = [...names(git(root, 'ls-files', '--others', '--exclude-standard', '-z', '--', ...RUNNABLE_GLOBS)), ...copiedFiles(root)]
    .filter((p) => RUNNABLE_RE.test(p) && rx.test(readFileSync(join(root, p), 'utf8')));
  return [...new Set([...tracked, ...untracked])].sort();
}

/**
 * The string literals of JS/TS source — comments skipped, a template literal gives its static chunks — and
 * the code outside strings and comments. A regex literal is told from a division by the token before it.
 */
export function scanCode(text) {
  const strings = [];
  let code = '';
  let prev = ''; // last significant code character
  const tpl = []; // open `${` depths, innermost last
  const n = text.length;
  let i = 0;
  const quoted = (j, end) => { // reads to the closing quote (or, for a template chunk, to `${`); returns [chunk, index]
    let s = '';
    while (j < n && text[j] !== end && !(end === '`' && text[j] === '$' && text[j + 1] === '{') && (end === '`' || text[j] !== '\n')) {
      if (text[j] === '\\') { s += text[j + 1] ?? ''; j += 2; } else s += text[j++];
    }
    return [s, j];
  };
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      const [s, j] = quoted(i + 1, c);
      strings.push(s); code += ' "" '; prev = 'a'; i = j + 1; continue;
    }
    if (c === '`' || (c === '}' && tpl.length && tpl[tpl.length - 1] === 0)) {
      if (c === '}') tpl.pop();
      const [s, j] = quoted(i + 1, '`');
      strings.push(s); code += ' "" ';
      if (text[j] === '$') { tpl.push(0); prev = '('; i = j + 2; } else { prev = 'a'; i = j + 1; }
      continue;
    }
    if (c === '{' && tpl.length) tpl[tpl.length - 1]++;
    if (c === '}' && tpl.length) tpl[tpl.length - 1]--;
    if (c === '/' && (!prev || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || /\b(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)\s*$/.test(code.slice(-16)))) {
      let j = i + 1;
      let cls = false;
      while (j < n && text[j] !== '\n') {
        const d = text[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break;
        j++;
      }
      i = j + 1;
      while (i < n && /[a-z]/i.test(text[i])) i++;
      code += ' /re/ '; prev = 'a'; continue;
    }
    code += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { strings, code };
}

const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.cjs'];
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const resolveModule = (abs) => [abs, ...EXTS.map((e) => abs + e), abs.replace(/\.[cm]?js$/, '.ts'), abs.replace(/\.js$/, '.tsx'), ...EXTS.map((e) => join(abs, `index${e}`))]
  .find((p) => CODE_RE.test(p) && isFile(p));

/**
 * The repo files `rel` runs: every relative specifier (`./x`, `../x` — import, export … from, import(),
 * require, vi.mock, new URL) resolved as a module, and — only in a file that can start a process (it
 * names child_process, or starts a Worker) or load code by path (a dynamic import() or require(), or
 * jiti: `import(pathToFileURL(ROOT + 'src/rules/build.ts'))` in verify-characters.mjs) — every word of a
 * string literal that names a runnable file, from the root or from the file's own directory. Deliberately
 * over-counts (such a file's literal that it only reads counts as run); a file that can do neither only
 * reads what it names as a path. Comments never count.
 */
export function references(root, rel) {
  if (!CODE_RE.test(rel)) return [];
  const abs = join(root, rel);
  const { strings, code } = scanCode(readFileSync(abs, 'utf8'));
  const runsByPath = strings.some((s) => s === 'node:child_process' || s === 'child_process' || s === 'jiti')
    || /\bnew\s+Worker\s*\(|\bimport\s*\(|\brequire\s*\(/.test(code);
  const out = new Set();
  const add = (p) => {
    const r = p && fwd(relative(root, p));
    if (r && !r.startsWith('../') && !isAbsolute(r) && !/(^|\/)node_modules\//.test(r)) out.add(r);
  };
  for (const s of strings) {
    if (/^\.{1,2}\//.test(s)) add(resolveModule(resolve(dirname(abs), s)));
    if (!runsByPath) continue;
    for (const word of s.split(/\s+/)) {
      const w = word.replace(/^["']|["',;)]+$/g, '');
      if (!RUNNABLE_RE.test(w)) continue;
      for (const base of [root, dirname(abs)]) { const p = resolve(base, w.replace(/^\/+/, '')); if (isFile(p)) add(p); }
    }
  }
  return [...out];
}

/** The files the checkout's package.json runs for these npm scripts (default: data + verify), following `npm run <x>`. */
export const chainEntries = (root, scriptNames = ['data', 'verify']) => {
  const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const seen = new Set();
  const walk = (k) => {
    if (seen.has(k) || !scripts[k]) return [];
    seen.add(k);
    return scripts[k].split(/&&|\|\||;/).flatMap((part) => {
      const w = part.trim().split(/\s+/);
      if (w[0] === 'npm' && w[1] === 'run') return walk(w[2]);
      const file = w.find((x) => RUNNABLE_RE.test(x));
      return file && /^(?:node|jiti|npx|tsx)$/.test(w[0]) ? [file] : [];
    });
  };
  return [...new Set(scriptNames.flatMap(walk))];
};

const walkFiles = (root, dir, out = []) => {
  for (const d of existsSync(join(root, dir)) ? readdirSync(join(root, dir), { withFileTypes: true }) : []) {
    const p = `${dir}/${d.name}`;
    if (d.isDirectory() && d.name !== 'node_modules') walkFiles(root, p, out); else if (d.isFile()) out.push(p);
  }
  return out;
};

/**
 * The import + spawn closure of `npm run data` + `npm run verify`; with `tests`, also of `node scripts/vt.mjs`
 * over every test file vitest.config.ts includes (test/**\/*.test.ts(x)).
 */
export function chainClosure(root, { tests = false } = {}) {
  const start = chainEntries(root);
  if (tests) start.push('scripts/vt.mjs', 'vitest.config.ts', ...walkFiles(root, 'test').filter((p) => /\.test\.tsx?$/.test(p)));
  const seen = new Set();
  const queue = start.filter((p) => isFile(join(root, p)));
  while (queue.length) {
    const p = queue.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    for (const q of references(root, p)) if (!seen.has(q)) queue.push(q);
  }
  return [...seen].sort();
}

/**
 * Agent workflow scripts: the harness runs each as a function body, so it has no location of its own, and
 * the main path only goes into the agents' prompts ("work from this root") — they drive MAIN by design.
 * test/audit-cache.test.ts evaluates audit-500.js under stub agents, which touch no file.
 */
export const DRIVES_MAIN = ['.claude/workflows/wg-batch.js', 'scripts/audit/audit-500.js', 'scripts/audit/audit-batch.js', 'scripts/audit/bakeoff.js'];

/** The files in chainClosure(root, opts) whose code names `main` — run from a lane, the chain would read/write MAIN. */
export function hazardsInChain(root, main, opts = {}) {
  const rx = new RegExp(mainPathSource(main), 'i');
  return chainClosure(root, opts).filter((p) => rx.test(readFileSync(join(root, p), 'utf8')));
}

/** The lock the lane's own scripts/lib/heavy-lock.mjs takes with no override (null when it cannot say). */
export function laneLock(lane) {
  const env = { ...process.env };
  delete env.HEAVY_LOCK_PATH; delete env.HEAVY_LOCK;
  const url = pathToFileURL(join(lane, 'scripts/lib/heavy-lock.mjs')).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(url)}); console.log(m.lockPath());`],
    { cwd: lane, env, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}
/** Heavy-job lock of the whole machine: MAIN's, whichever checkout asks (heavy-lock.mjs: one job per machine). */
export const machineLock = (main) => join(main, 'work/.heavy.lock');
const samePath = (a, b) => !!a && !!b && resolve(a).toLowerCase() === resolve(b).toLowerCase();

/**
 * The merge-back patch: every change in the lane since its BASE commit — committed there or not — in the
 * whole tree, binary-safe, minus NOT_MERGED. `new` changed no tracked file, so the patch is exactly the
 * lane's work. `newFiles`: untracked files the patch does not carry — not-ignored ones anywhere, plus
 * anything new at a COPY input (a new batch pin, gitignored) that main does not have byte for byte.
 * `changedCopies`: copies the lane edited since `new` (their sha1 at `new` is in the record) that now differ
 * from main's file — a copy main changed on its own is not the lane's work, and one main already matches
 * has nothing to carry. Both lists go to main by hand. `overlayChanged`: the overlay's CONTENT differs from
 * the base (git's comparison, so a CRLF rewrite of the same rows is no change) — its rows go to main as
 * spec files.
 */
export function laneDiff(lane, main = mainCheckout(lane)) {
  const { base, copies } = readRecord(lane);
  const sameAsMain = (p) => existsSync(join(main, p)) && readFileSync(join(main, p)).equals(readFileSync(join(lane, p)));
  const spec = ['.', ...NOT_MERGED.map((p) => `:(exclude,glob)${p}`)];
  const patch = execFileSync('git', ['diff', '--binary', '--no-renames', base, '--', ...spec], { cwd: lane, stdio: 'pipe', maxBuffer: 1 << 30 }); // bytes: never re-encoded
  const newFiles = git(lane, 'ls-files', '--others', '--exclude-standard', '-z').split('\0')
    .filter((p) => p && p !== RECORD && !isInput(p) && !matches(GENERATED, p));
  const changedCopies = [];
  for (const p of copiedFiles(lane)) {
    if (sameAsMain(p)) continue;
    if (!(p in copies)) newFiles.push(p);
    else if (sha1(join(lane, p)) !== copies[p]) changedCopies.push(p);
  }
  const od = spawnSync('git', ['diff', '--quiet', base, '--', OVERLAY], { cwd: lane, stdio: 'ignore' });
  if (od.status !== 0 && od.status !== 1) throw new Error(`git diff of ${OVERLAY} against ${base} failed (exit ${od.status})`);
  return { patch, newFiles: newFiles.sort(), changedCopies, overlayChanged: od.status === 1 };
}

/**
 * Apply a lane patch to `target` (main) with `git apply --3way`, in a scratch copy of target's index: the
 * worktree gets the changes, the real index is untouched, so nothing is staged behind anyone's back.
 * --3way reads the preimage from the blob, so main's CRLF working tree (autocrlf=true) does not break the
 * LF context, and a file main changed since the lane's base merges instead of failing. Refuses, applying
 * nothing, when target has uncommitted CONTENT changes in a file the patch touches: staged, unstaged (git's
 * content comparison — a file rewritten with the same content after autocrlf, which `git status` still
 * lists when only its size changed, is not a change), or an untracked file where the patch creates one.
 * The touched files are re-added to the scratch index first: such a same-content file is stat-dirty, and
 * --3way refuses a stat-dirty file as "does not match index".
 *
 * LINE ENDINGS (CLAUDE.md: mixed per file — main has 2,510 LF files on disk, 516 CRLF and one mixed). git
 * writes every file it applies through autocrlf=true: CRLF on every line. A file that had a bare LF before
 * — LF-only or mixed, conflicted or not — gets its own endings back line by line (keepEndings), when git
 * really did convert it: it is now CRLF throughout and the blob(s) it came from hold no CR (a blob that
 * holds CR git writes as it is, so its endings are the lane's, and they stay). A CRLF-only file needs
 * nothing. A file the patch creates is written as any checkout here writes it. `endingsKept` names the
 * files put back; `endingsLost` the ones whose lines did not match up (left CRLF — the caller names them).
 */
export function applyPatch(target, patch) {
  if (!patch.length) return { files: [], conflicts: [], endingsKept: [], endingsLost: [] };
  const tg = (args, opt = {}) => execFileSync('git', args, { cwd: target, stdio: 'pipe', maxBuffer: 1 << 30, ...opt }).toString();
  const z = (args, opt) => tg(args, opt).split('\0').filter(Boolean);
  const files = z(['apply', '--numstat', '-z'], { input: patch }).map((r) => r.split('\t')[2]);
  const tracked = new Set(z(['ls-files', '-z']));
  const dirty = new Set([
    ...z(['--no-optional-locks', 'diff', '--cached', '--name-only', '--no-renames', '-z']),
    ...z(['--no-optional-locks', 'diff', '--name-only', '--no-renames', '-z']),
  ]);
  const busy = files.filter((f) => dirty.has(f) || (!tracked.has(f) && existsSync(join(target, f))));
  if (busy.length) throw new Error(`refusing: ${target} has uncommitted changes in ${busy.length} file(s) the patch touches — nothing applied:\n  ${busy.join('\n  ')}`);
  const before = new Map(); // the files with a bare LF on disk: their bytes, to put their endings back
  for (const f of files) {
    const b = existsSync(join(target, f)) ? readFileSync(join(target, f)) : null;
    if (b && hasBareLf(b)) before.set(f, b);
  }
  const index = resolve(target, tg(['rev-parse', '--git-path', 'worktree-lane-apply.index']).trim());
  copyFileSync(resolve(target, tg(['rev-parse', '--git-path', 'index']).trim()), index);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    const present = files.filter((f) => tracked.has(f) && existsSync(join(target, f)));
    if (present.length) tg(['--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'], { env, input: `${present.join('\0')}\0` }); // same blobs, fresh stat
    const r = spawnSync('git', ['apply', '--3way'], { cwd: target, env, input: patch, encoding: 'utf8', maxBuffer: 1 << 30 });
    const conflicts = tg(['diff', '--name-only', '--diff-filter=U', '-z'], { env }).split('\0').filter(Boolean);
    if (r.status !== 0 && !conflicts.length) throw new Error(`git apply --3way failed, nothing applied:\n${r.stderr}`);
    const endingsKept = [];
    const endingsLost = [];
    for (const [f, was] of before) {
      const p = join(target, f);
      const now = existsSync(p) ? readFileSync(p) : null;
      if (!now || !now.includes(10) || hasBareLf(now)) continue; // gone, or not written CRLF throughout: nothing autocrlf did
      const blobs = (conflicts.includes(f) ? [`:2:${f}`, `:3:${f}`] : [`:${f}`]) // a conflict: main's side and the lane's
        .map((spec) => spawnSync('git', ['cat-file', 'blob', spec], { cwd: target, env, maxBuffer: 1 << 30 }))
        .filter((b) => b.status === 0).map((b) => b.stdout);
      if (!blobs.length || blobs.some((b) => b.includes(13))) continue; // written as the blob has it: the lane's endings
      const kept = keepEndings(was.toString('latin1'), now.toString('latin1'));
      if (kept === null) { endingsLost.push(f); continue; }
      writeFileSync(p, Buffer.from(kept, 'latin1'));
      endingsKept.push(f);
    }
    return { files, conflicts, endingsKept, endingsLost };
  } finally {
    rmSync(index, { force: true });
  }
}

/** A LF not preceded by CR, anywhere in the bytes. */
const hasBareLf = (b) => {
  for (let i = b.indexOf(10); i >= 0; i = b.indexOf(10, i + 1)) if (i === 0 || b[i - 1] !== 13) return true;
  return false;
};

/**
 * `after` is a file as git wrote it (CRLF on every line), `before` the same file on disk before the patch;
 * both latin1 strings, so every byte round-trips. Returns `after` with `before`'s line endings: a line the
 * patch left alone keeps its own; the k-th line of a change takes the ending of the k-th line it replaced;
 * a line beyond those takes the ending of the line above it — at the top of the file, the ending most of
 * `before`'s lines have (LF on a tie). The lines are matched by git's own diff of the two, LF-normalised.
 * null when that match does not add up line for line.
 */
export function keepEndings(before, after) {
  const split = (s) => {
    const parts = s.split('\n');
    const last = parts.pop();
    const lines = parts.map((p) => (p.endsWith('\r') ? [p.slice(0, -1), '\r\n'] : [p, '\n']));
    if (last) lines.push([last, '']); // a last line with no newline
    return lines;
  };
  const a = split(before);
  const b = split(after);
  const crlf = a.filter(([, e]) => e === '\r\n').length;
  const common = crlf > a.filter(([, e]) => e === '\n').length ? '\r\n' : '\n';
  const dir = mkdtempSync(join(tmpdir(), 'hh-lane-eol-'));
  let hunks;
  try {
    const text = (lines) => lines.map(([t, e]) => (e ? `${t}\n` : t)).join('');
    writeFileSync(join(dir, 'a'), text(a), 'latin1');
    writeFileSync(join(dir, 'b'), text(b), 'latin1');
    const r = spawnSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '-a', '-U0', '--', 'a', 'b'],
      { cwd: dir, encoding: 'latin1', maxBuffer: 1 << 30 });
    if (r.status !== 0 && r.status !== 1) return null;
    hunks = [...r.stdout.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => ({ at: +m[1], del: +(m[2] ?? 1), add: +(m[4] ?? 1) }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const eol = [];
  let i = 0; // next line of a
  let j = 0; // next line of b
  const keep = (upTo) => {
    for (; i < upTo; i++, j++) { if (j >= b.length || a[i][0] !== b[j][0]) return false; eol[j] = a[i][1]; }
    return true;
  };
  for (const { at, del, add } of hunks) {
    if (!keep(del ? at - 1 : at)) return null; // -U0: a pure insertion's `at` is the line above it
    for (let k = 0; k < add; k++) eol[j + k] = k < del ? a[i + k][1] : (eol[j + k - 1] ?? common);
    i += del; j += add;
  }
  if (!keep(a.length) || j !== b.length) return null;
  let out = '';
  let prev = common;
  b.forEach(([t, e], k) => {
    const end = e ? (eol[k] || prev) : ''; // '' from a replaced last line that now has one below it: the line above's
    out += t + end;
    if (end) prev = end;
  });
  return out;
}

/**
 * A proof passes only when data AND verify exit 0, every generated file is byte-identical to the base,
 * the run rewrote exactly the GENERATED files, and `diff` has nothing to carry (the overlay included).
 */
export const proofPassed = ({ codes, diff, notRewritten, strays, patch, newFiles, changedCopies, overlayChanged }) =>
  codes.data === 0 && codes.verify === 0 && diff.length === 0 && notRewritten.length === 0 && strays.length === 0
  && patch.length === 0 && newFiles.length === 0 && changedCopies.length === 0 && overlayChanged === false;

/**
 * Make a lane. Changes no tracked file (`tracked` is `git status` of tracked files afterwards: empty).
 * Reports `hazards` (code naming main — never run it from the lane), `chainHazards` (those the data/verify
 * chains run: a lane cut from a commit before the root fixes; `prove` refuses it) and whether the lane's
 * heavy-lock.mjs takes MAIN's lock (`lockShared`; false in a lane cut from before heavy-lock found main itself).
 */
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
  const links = linkInputs(main, lane);
  const copies = Object.fromEntries(copiedFiles(lane).map((p) => [p, sha1(join(lane, p))]));
  writeFileSync(join(lane, RECORD), `${JSON.stringify({ base: sha, copies }, null, 1)}\n`);
  const lock = laneLock(lane);
  return {
    lane, sha, links,
    tracked: git(lane, 'status', '--porcelain', '-uno').split('\n').filter(Boolean),
    hazards: mainPathHazards(lane, main),
    chainHazards: hazardsInChain(lane, main),
    lock, lockShared: samePath(lock, machineLock(main)),
  };
}

function run(lane, script, log) {
  const env = { ...process.env };
  delete env.HH_ROOT; delete env.PARITY_ROOT; // another checkout's root must not leak into the lane's chain
  const fd = openSync(log, 'w');
  try { return spawnSync('npm', ['run', script], { cwd: lane, env, stdio: ['ignore', fd, fd], shell: true }).status ?? 1; } finally { closeSync(fd); }
}

export function prove(name, { main = mainCheckout() } = {}) {
  const lane = laneDir(main, name);
  if (!existsSync(lane)) throw new Error(`no lane at ${lane}`);
  const { base } = readRecord(lane);
  const bad = hazardsInChain(lane, main);
  if (bad.length) throw new Error(`refusing: these chain scripts hardcode ${main} and would read/write MAIN from the lane:\n  ${bad.join('\n  ')}`);
  const start = Date.now();
  const codes = {};
  for (const s of ['data', 'verify']) {
    const log = join(lane, `work/.lane-${s}.log`);
    console.log(`npm run ${s} … (log: ${log})`);
    codes[s] = run(lane, s, log);
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
  const { patch, newFiles, changedCopies, overlayChanged } = laneDiff(lane, main);
  console.log(`\n${secs} s. compared ${rows.length} generated files against the base ${base.slice(0, 7)}: ${rows.length - diff.length} byte-identical, ${diff.length} differ`);
  for (const r of diff) console.log(`  ${r.path.padEnd(48)} ref ${String(r.ref ?? '—').padStart(10)}  lane ${String(r.lane ?? '—').padStart(10)}`);
  console.log(`the run rewrote ${rewritten.size} tracked files; GENERATED left alone: ${notRewritten.length}; rewritten outside GENERATED: ${strays.length}`);
  for (const p of notRewritten) console.log(`  in GENERATED, not rewritten (diff would drop a worker's edit to it): ${p}`);
  for (const p of strays) console.log(`  rewritten outside GENERATED: ${p}`);
  console.log(`diff: ${patch.length}-byte patch, ${newFiles.length} new file(s), ${changedCopies.length} changed cop(ies), overlay ${overlayChanged ? 'CHANGED' : 'unchanged'}`);
  const ok = proofPassed({ codes, diff, notRewritten, strays, patch, newFiles, changedCopies, overlayChanged });
  console.log(ok ? 'PROOF PASSED' : 'PROOF FAILED');
  return { codes, rows, diff, rewritten, notRewritten, strays, patch, newFiles, changedCopies, overlayChanged, ok };
}

export function rmLane(name, { main = mainCheckout() } = {}) {
  const lane = laneDir(main, name);
  if (!existsSync(lane)) throw new Error(`no lane at ${lane}`);
  const unlinked = unlinkLinks(lane); // BEFORE git: `git worktree remove --force` empties junction targets
  git(main, 'worktree', 'remove', '--force', lane);
  git(main, 'worktree', 'prune');
  return unlinked;
}

const leftovers = ({ newFiles, changedCopies, overlayChanged }) => {
  if (newFiles.length) console.error(`⚠ new files NOT in the patch — copy them to main by hand:\n  ${newFiles.join('\n  ')}`);
  if (changedCopies.length) console.error(`⚠ copied inputs the lane changed since \`new\` — NOT in the patch, copy by hand if main needs them:\n  ${changedCopies.join('\n  ')}`);
  if (overlayChanged) console.error(`⚠ ${OVERLAY} differs from the base — NOT in the patch: re-apply the lane's spec files on main with apply-parity-fixes.mjs <spec> --write (its only writer)`);
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
      console.log(`lane ${r.lane} at ${r.sha.slice(0, 7)} (core.autocrlf=input in its config.worktree: tracked files are their blobs; no tracked file edited)`);
      for (const l of r.links) console.log(`  ${l.how.padEnd(8)} ${l.path.padEnd(34)} ${l.result}`);
      if (r.tracked.length) console.log(`\n⚠ tracked files differ from the base right after new — a harness bug, rm the lane:\n  ${r.tracked.join('\n  ')}`);
      console.log(r.lockShared ? `  lock     ${r.lock} (main's: vitest here queues behind every other checkout's)`
        : `\n⚠ this lane's heavy-lock.mjs takes ${r.lock ?? 'no lock it can name'}, not main's — cut from a commit before heavy-lock.mjs found main itself. Its vitest would run beside main's: set HEAVY_LOCK_PATH=${machineLock(mainCheckout())} in every shell here, or cut the lane from a later commit.`);
      if (r.hazards.length) console.log(`\n⚠ ${r.hazards.length} file(s) here name the MAIN checkout (tracked, and the untracked copies) — NEVER run them from this lane, they read/write MAIN:\n  ${r.hazards.join('\n  ')}`);
      if (r.chainHazards.length) console.log(`\n⚠⚠ ${r.chainHazards.length} of the files \`npm run data\` / \`npm run verify\` run here name MAIN: in this lane they would write/read MAIN (a lane cut from a commit before main resolved every chain ROOT itself). prove refuses; do not run them here — cut the lane from a later commit:\n  ${r.chainHazards.join('\n  ')}`);
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
      const { files, conflicts, endingsKept, endingsLost } = applyPatch(main, d.patch);
      console.log(`applied ${files.length} file(s) to ${main} (git apply --3way; nothing staged — a file the patch creates stays untracked: stage it by name)`);
      if (endingsKept.length) console.log(`  line endings put back line by line in ${endingsKept.length} LF or mixed file(s) git had written CRLF`);
      if (endingsLost.length) console.log(`⚠ ${endingsLost.length} LF or mixed file(s) came back CRLF (their lines did not match up) — put their endings back by hand:\n  ${endingsLost.join('\n  ')}`);
      if (conflicts.length) console.log(`⚠ ${conflicts.length} file(s) have conflict markers — resolve by hand:\n  ${conflicts.join('\n  ')}`);
      leftovers(d);
      console.log('next on main: apply-parity-fixes <spec> --write for the lane\'s specs -> ONE npm run data -> wg-diff --out work/.wg-diff-all.json + trust-ledger.mjs -> npm run verify (docs/worktree-lanes.md)');
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
