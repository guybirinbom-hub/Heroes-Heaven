/*
 * WORKTREE LANES (scripts/worktree-lane.mjs) — what a lane links, what it copies, how it compares, what
 * its merge-back patch carries, how that patch lands on main, and the refusals that protect main.
 *
 * The one that matters most is unlinkLinks: measured on git 2.53.0.windows.2, `git worktree remove
 * --force` FOLLOWS a junction and empties its target, so a lane removed by hand would wipe main's
 * node_modules / .import-src / work/wg. `rm` unlinks every link first; the test proves the target
 * survives the unlink. Everything that writes runs on temp dirs — never the real checkout. The guards on
 * this checkout only READ it: nothing the data/verify chains or the tests run may name the main checkout
 * (the agent workflow scripts aside), heavy-lock.mjs takes MAIN's lock, and the harness files are LF blobs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  applyPatch, chainClosure, chainEntries, compareFiles, DRIVES_MAIN, hazardsInChain, keepEndings, laneDiff, laneLock, linkInputs,
  machineLock, mainCheckout, mainPathHazards, newLane, proofPassed, prove, references, rmLane, scanCode, unlinkLinks,
} from '../scripts/worktree-lane.mjs';
import { formatBackfill } from '../scripts/lib/write-backfill.mjs';

const roots: string[] = [];
const temp = () => { const r = mkdtempSync(join(tmpdir(), 'hh-lane-test-')); roots.push(r); return r; };
afterAll(() => { for (const r of roots) { unlinkLinks(r); rmSync(r, { recursive: true, force: true }); } });
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe', encoding: 'utf8' });
const fwd = (p: string) => p.replace(/\\/g, '/');
const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8');
const put = (dir: string, file: string, s: string | Buffer) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), s); };
const samePath = (a: string | null, b: string) => !!a && resolve(a).toLowerCase() === resolve(b).toLowerCase();
const HERE_ROOT = join(__dirname, '..');

const fixture = () => {
  const root = temp();
  const main = join(root, 'main');
  const lane = join(root, 'lane');
  mkdirSync(join(main, 'big/sub'), { recursive: true });
  writeFileSync(join(main, 'big/sub/keep.txt'), 'shared');
  writeFileSync(join(main, 'small.json'), '{"a":1}');
  mkdirSync(join(main, 'work'), { recursive: true });
  for (const f of ['wg-batch-001.json', 'wg-batch-002.json', 'wg-batch-001-parity.json', 'notes.txt']) writeFileSync(join(main, 'work', f), f);
  mkdirSync(join(main, 'code'), { recursive: true });
  writeFileSync(join(main, 'code/tool.ts'), 'export {}');
  mkdirSync(lane, { recursive: true });
  const inputs = [
    { path: 'big', how: 'junction' },
    { path: 'small.json', how: 'copy' },
    { path: 'work', match: /^wg-batch-\d+\.json$/, how: 'copy' },
    { path: 'code', how: 'copy' },
    { path: 'missing', how: 'copy' },
  ];
  return { main, lane, inputs };
};

describe('linkInputs', () => {
  it('junctions the shared dir, copies files and code dirs, copies only the matching batch pins, skips what main lacks', () => {
    const { main, lane, inputs } = fixture();
    const rows = linkInputs(main, lane, inputs);
    expect(lstatSync(join(lane, 'big')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(lane, 'big/sub/keep.txt'), 'utf8')).toBe('shared');
    expect(lstatSync(join(lane, 'small.json')).isSymbolicLink()).toBe(false);
    writeFileSync(join(lane, 'small.json'), 'lane edit');
    expect(readFileSync(join(main, 'small.json'), 'utf8')).toBe('{"a":1}'); // a copy: the lane owns it
    expect(lstatSync(join(lane, 'code')).isSymbolicLink()).toBe(false);
    expect(existsSync(join(lane, 'code/tool.ts'))).toBe(true);
    expect(existsSync(join(lane, 'work/wg-batch-001.json'))).toBe(true);
    expect(existsSync(join(lane, 'work/wg-batch-002.json'))).toBe(true);
    expect(existsSync(join(lane, 'work/wg-batch-001-parity.json'))).toBe(false);
    expect(existsSync(join(lane, 'work/notes.txt'))).toBe(false);
    expect(rows.find((r) => r.path === 'missing')?.result).toMatch(/absent in main/);
    expect(rows.find((r) => r.path.startsWith('work/'))?.result).toBe('2 file(s)');
  });

  it('never overwrites what the lane already has', () => {
    const { main, lane, inputs } = fixture();
    linkInputs(main, lane, inputs);
    writeFileSync(join(lane, 'small.json'), 'lane edit');
    const again = linkInputs(main, lane, inputs);
    expect(readFileSync(join(lane, 'small.json'), 'utf8')).toBe('lane edit');
    expect(again.find((r) => r.path === 'small.json')?.result).toMatch(/already in the lane/);
  });
});

describe('unlinkLinks', () => {
  it('removes the junction and leaves its target in main intact', () => {
    const { main, lane, inputs } = fixture();
    linkInputs(main, lane, inputs);
    const gone = unlinkLinks(lane);
    expect(gone).toEqual([join(lane, 'big')]);
    expect(existsSync(join(lane, 'big'))).toBe(false);
    expect(readFileSync(join(main, 'big/sub/keep.txt'), 'utf8')).toBe('shared');
    expect(existsSync(join(lane, 'code/tool.ts'))).toBe(true); // copies are not links
  });
});

describe('compareFiles', () => {
  it('reports identical, differing, lane-only and ref-only files', () => {
    const b = (s: string) => Buffer.from(s);
    const rows = compareFiles(
      { 'public/core.json': b('{"x":1}'), 'public/ast/feats.json.gz': b('abc'), 'public/ast/gone.json.gz': b('z') },
      { 'public/core.json': b('{"x":1}'), 'public/ast/feats.json.gz': b('abd'), 'public/ast/new.json.gz': b('n') },
    );
    expect(rows).toEqual([
      { path: 'public/ast/feats.json.gz', ref: 3, lane: 3, same: false },
      { path: 'public/ast/gone.json.gz', ref: 1, lane: null, same: false },
      { path: 'public/ast/new.json.gz', ref: null, lane: 1, same: false },
      { path: 'public/core.json', ref: 7, lane: 7, same: true },
    ]);
  });
});

/* git writes every file `apply` touches CRLF (autocrlf=true); keepEndings gives each line its own ending
 * back. `after` below is what git wrote: the LF-written expectation turned CRLF on every line. */
describe('keepEndings', () => {
  const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');
  it('a line left alone keeps its ending, a changed line the one it replaced, an added line the one above it', () => {
    expect(keepEndings('a\r\nb\nc\r\nd\n', crlf('a\nB\nc\nx\nd\n'))).toBe('a\r\nB\nc\r\nx\r\nd\n');
    expect(keepEndings('a\nb\r\nc\r\n', crlf('z\na\nb\nc\n'))).toBe('z\r\na\nb\r\nc\r\n'); // the top: most lines' ending
    expect(keepEndings('a\n\n\r\nb\n', crlf('a\n\n\nX\nb\n'))).toBe('a\n\n\r\nX\r\nb\n'); // blank lines are lines
    expect(keepEndings('a\nb\r\nc\n', crlf('a\nc\n'))).toBe('a\nc\n'); // a deleted line takes its ending with it
    expect(keepEndings('a\nb\n', crlf('a\nb2\nb3\n'))).toBe('a\nb2\nb3\n'); // LF-only stays LF-only
  });

  it('a file with no final newline: kept that way, or its old last line takes the ending of the line above', () => {
    expect(keepEndings('x\ny', crlf('x\nq\ny'))).toBe('x\nq\ny');
    expect(keepEndings('x\r\ny', crlf('x\ny\nz\n'))).toBe('x\r\ny\r\nz\r\n');
  });

  /* The refuter's case, in main's proportions: test/armor-traits.test.ts is 229 LF lines and 1 CRLF on disk. */
  it('a line added to an LF-dominant mixed file: every other line as it was, the new one LF', () => {
    const lines = Array.from({ length: 230 }, (_, k) => `line ${k}`);
    const before = lines.map((l, k) => `${l}${k === 4 ? '\r\n' : '\n'}`).join('');
    expect(keepEndings(before, crlf(`${lines.join('\n')}\n// probe\n`))).toBe(`${before}// probe\n`);
  });
});

describe('newLane refusals', () => {
  it('refuses when the target directory already exists, before touching git', () => {
    const root = temp();
    const main = join(root, 'not-a-repo');
    mkdirSync(main);
    mkdirSync(join(root, 'hh-lane-taken'));
    expect(() => newLane('taken', { main })).toThrow(/already exists/);
  });

  it('refuses a name that is not a plain slug', () => {
    expect(() => newLane('../escape', { main: temp() })).toThrow(/letters, digits and dashes/);
  });
});

/*
 * THE CHAIN CLOSURE. A chain is what `npm run data` / `npm run verify` (and vt.mjs over the tests) RUN:
 * package.json's entries, what they import, what they spawn, what they load by path. The refuter's case
 * (2026-09-29): a main path appended to scripts/lib/aon-facets.mjs, which import-core-v2.mjs imports —
 * a check of package.json's entries alone missed it, and prove would have run `npm run data` on MAIN.
 */
describe('scanCode', () => {
  it('keeps string literals and template chunks, skips comments, and is not fooled by a glob, a regex, a URL or a division', () => {
    const src = [
      "import x from './a.mjs'; // import './commented.mjs'",
      "/* spawnSync('node', ['scripts/in-a-comment.mjs']) */",
      "const g = 'public/ast/*.json.gz'; const r = /['\"]\\/\\//g; const u = 'http://x/y';",
      "const t = `${ROOT}/scripts/t.mjs ${`inner`} tail`;",
      'const d = a / b / c; const s = "scripts/after.mjs";',
    ].join('\n');
    const { strings, code } = scanCode(src);
    expect(strings).toEqual(['./a.mjs', 'public/ast/*.json.gz', 'http://x/y', '', '/scripts/t.mjs ', 'inner', ' tail', 'scripts/after.mjs']);
    expect(code).not.toMatch(/commented|in-a-comment/);
  });
});

describe('references and chainClosure', () => {
  const repo = () => {
    const root = temp();
    put(root, 'package.json', JSON.stringify({ scripts: { data: 'node scripts/run.mjs && npm run more', more: 'node scripts/loader.mjs', verify: 'jiti scripts/lib/dep.mjs' } }));
    put(root, 'scripts/run.mjs', "import { spawnSync } from 'node:child_process';\nimport './lib/dep.mjs';\nspawnSync(process.execPath, [ROOT + 'scripts/spawned.mjs']);\n// node scripts/commented.mjs\n");
    put(root, 'scripts/lib/dep.mjs', "export const NOTE = 'scripts/read-only.mjs'; // a path it only names\n");
    put(root, 'scripts/loader.mjs', "const m = await import(pathToFileURL(ROOT + 'src/loaded.ts').href);\n");
    for (const f of ['scripts/spawned.mjs', 'scripts/commented.mjs', 'scripts/read-only.mjs', 'src/loaded.ts']) put(root, f, 'export {};\n');
    put(root, 'test/x.test.ts', "import '../scripts/read-only.mjs';\n");
    return root;
  };

  it('imports and path loads always count; a named path counts only in a file that can spawn or load by path; comments never', () => {
    const root = repo();
    expect(references(root, 'scripts/run.mjs').sort()).toEqual(['scripts/lib/dep.mjs', 'scripts/spawned.mjs']);
    expect(references(root, 'scripts/lib/dep.mjs')).toEqual([]);
    expect(references(root, 'scripts/loader.mjs')).toEqual(['src/loaded.ts']);
  });

  it('follows npm run, imports, spawns and path loads from the entries; with tests, from every test file too', () => {
    const root = repo();
    expect(chainEntries(root)).toEqual(['scripts/run.mjs', 'scripts/loader.mjs', 'scripts/lib/dep.mjs']);
    expect(chainClosure(root)).toEqual(['scripts/lib/dep.mjs', 'scripts/loader.mjs', 'scripts/run.mjs', 'scripts/spawned.mjs', 'src/loaded.ts']);
    expect(chainClosure(root, { tests: true })).toContain('scripts/read-only.mjs');
    expect(chainClosure(root, { tests: true })).toContain('test/x.test.ts');
  });
});

describe('mainPathHazards', () => {
  it('finds code naming the main checkout in any spelling — tracked, untracked, and the gitignored copies new makes — and nothing else', () => {
    const repo = temp();
    g(repo, 'init', '-q');
    writeFileSync(join(repo, 'fwd.mjs'), "const ROOT = 'C:/some place/main checkout/';\n");
    writeFileSync(join(repo, 'back.ts'), "const R = 'c:\\\\some place\\\\main checkout';\n");
    writeFileSync(join(repo, 'bash.mjs'), "const R = '/c/some place/main checkout';\n");
    writeFileSync(join(repo, 'clean.mjs'), "const ROOT = new URL('..', import.meta.url);\n");
    writeFileSync(join(repo, 'notes.md'), 'C:/some place/main checkout\n');
    writeFileSync(join(repo, '.gitignore'), 'scripts/aon-verify/\nignored/\n');
    g(repo, 'add', '.');
    put(repo, 'loose.mjs', "const R = 'C:/some place/main checkout';\n"); // untracked, not ignored
    put(repo, 'scripts/aon-verify/apply-x.ts', "const R = 'C:/some place/main checkout';\n"); // gitignored COPY input: every lane gets it
    put(repo, 'ignored/y.mjs', "const R = 'C:/some place/main checkout';\n"); // gitignored, not an input: no lane has it
    expect(mainPathHazards(repo, 'C:\\some place\\main checkout')).toEqual(['back.ts', 'bash.mjs', 'fwd.mjs', 'loose.mjs', 'scripts/aon-verify/apply-x.ts']);
  }, 30_000); // several git processes: 6.8 s under a four-file run on 2026-09-29, past vitest's 5 s default

  /* The root fix on main: every file `npm run data` / `npm run verify` / vt.mjs run resolves ROOT from its
   * own location, so even a plain `git worktree add` lane writes its own data, never main's. A file in that
   * closure that names the main checkout again fails here, not in a lane. */
  it('this checkout: nothing the data/verify chains or the tests run names the main checkout, the agent workflow scripts aside', () => {
    const main = mainCheckout(HERE_ROOT);
    const chain = chainEntries(HERE_ROOT);
    expect(chain.length).toBeGreaterThan(40);
    expect(chain).toContain('scripts/split-descriptions.mjs');
    expect(chain).toContain('scripts/verify-characters.mjs');
    expect(chainClosure(HERE_ROOT, { tests: true })).toEqual(expect.arrayContaining([
      'scripts/lib/aon-facets.mjs', // imported by import-core-v2.mjs (data)
      'scripts/trust-ledger.mjs', // spawned by trust-ledger-check.mjs (verify)
      'src/rules/build.ts', // import(pathToFileURL(ROOT + 'src/rules/build.ts')) in verify-characters.mjs
      'scripts/lib/heavy-lock.mjs', // vt.mjs
      'scripts/audit/audit-500.js', // evaluated by test/audit-cache.test.ts under stub agents
    ]));
    expect(DRIVES_MAIN.filter((f: string) => !existsSync(join(HERE_ROOT, f)))).toEqual([]); // the exemption names real files (path-free: a clone elsewhere passes too)
    expect(hazardsInChain(HERE_ROOT, main, { tests: true }).filter((f: string) => !DRIVES_MAIN.includes(f))).toEqual([]);
  }, 60_000);

  it('this checkout: heavy-lock.mjs takes MAIN\'s lock', () => {
    expect(samePath(laneLock(HERE_ROOT), machineLock(mainCheckout(HERE_ROOT)))).toBe(true);
  }, 30_000);

  /* New files are LF (the working tree's endings follow whoever checked it out last: autocrlf=true writes
   * CRLF). What git stores is what every checkout gets; it must be LF, and a file must never be mixed. */
  it('the harness files are LF blobs, never mixed on disk', () => {
    const rows = g(HERE_ROOT, 'ls-files', '--eol', '--', 'scripts/worktree-lane.mjs', 'test/worktree-lane.test.ts', 'docs/worktree-lanes.md').trim().split('\n');
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r).toMatch(/^i\/lf\s/);
      expect(r).not.toMatch(/w\/mixed/);
    }
  }, 30_000);
});

/*
 * Real lanes made by `new` from a temp "main", under a machine git config that says autocrlf=true (forced
 * for system AND global, whatever this machine has) — the setting under which a plain checkout writes CRLF.
 */
describe('a lane made by new: diff and apply', () => {
  const keys = ['GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL'] as const;
  const saved = keys.map((k) => process.env[k]);
  beforeAll(() => {
    const cfg = join(temp(), 'machine.gitconfig');
    writeFileSync(cfg, '[core]\n\tautocrlf = true\n[user]\n\temail = t@t\n\tname = t\n[init]\n\tdefaultBranch = main\n');
    for (const k of keys) process.env[k] = cfg;
  });
  afterAll(() => keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }));

  const GEN = ['public/core.json', 'public/ast/feats.json.gz', 'scripts/migration/out/map.json'];
  const INS = ['work/owner-questions.json', 'work/new-classes/x.json', 'docs/gold-set-answers.md', 'tracker/src/x.ts', 'public/data/a.json', 'scripts/migration/out/join.json'];
  const ROWS = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
  const OVERLAY = 'scripts/data/effect-backfill.json';
  /* heavy-lock.mjs as this checkout has it (finds MAIN's lock through the shared git dir), and as it was
   * before 2026-09-29 (its own checkout's lock — what a lane cut from 2ba18f5 or earlier has). */
  const lockNow = read(HERE_ROOT, 'scripts/lib/heavy-lock.mjs').replace(/\r\n/g, '\n');
  const lockOld = "import { join, dirname } from 'node:path';\nimport { fileURLToPath } from 'node:url';\n"
    + "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');\n"
    + "export const lockPath = () => process.env.HEAVY_LOCK_PATH || join(ROOT, 'work/.heavy.lock');\n";
  const C = "import { spawnSync } from 'node:child_process';\nconst ROOT = 'somewhere else/';\nexport const run = () => spawnSync(process.execPath, [ROOT + 'scripts/spawned.mjs']);\n";

  /* Main: chain scripts that resolve ROOT from their own location (as main's all do) — an entry that imports
   * a lib, one that spawns a script, one reached through `npm run` — an off-chain script that hardcodes
   * main (named by a chain script as text only), the REAL heavy-lock.mjs, the overlay committed LF like the
   * real one, generated files and inputs; then the untracked inputs `new` copies, one of them a gitignored
   * scripts/aon-verify script naming main. `hardChain` / `hardLib` / `hardSpawned` make the entry, the lib
   * it imports, or the script the chain spawns name main (a lane cut from before a root fix). */
  const mainRepo = ({ hardChain = false, hardLib = false, hardSpawned = false, lock = lockNow } = {}) => {
    const main = join(temp(), 'main checkout');
    const hard = `const ROOT = '${fwd(main)}/';\nconsole.log(ROOT);\n`;
    const own = (up: string) => `import { fileURLToPath } from 'node:url';\nconst ROOT = fileURLToPath(new URL('${up}', import.meta.url));\nconsole.log(ROOT);\n`;
    put(main, 'package.json', JSON.stringify({ scripts: { data: 'node scripts/a.mjs && node scripts/deep/b.mjs', verify: 'jiti scripts/c.mjs && node scripts/a.mjs && npm run more', more: 'node scripts/d.mjs' } }));
    put(main, 'scripts/a.mjs', `import './lib/facets.mjs';\n${hardChain ? hard : own('..')}`);
    put(main, 'scripts/lib/facets.mjs', hardLib ? `export const PROBE_ROOT = '${fwd(main)}/';\n` : 'export const F = 1;\n');
    put(main, 'scripts/deep/b.mjs', `${own('../..')}export const NOTE = 'scripts/off-chain.mjs'; // named as text: not run\n`);
    put(main, 'scripts/c.mjs', C);
    put(main, 'scripts/spawned.mjs', hardSpawned ? hard : 'export {};\n');
    put(main, 'scripts/d.mjs', 'export {};\n');
    put(main, 'scripts/off-chain.mjs', hard);
    put(main, 'scripts/lib/heavy-lock.mjs', lock);
    put(main, OVERLAY, JSON.stringify(ROWS, null, 1));
    put(main, '.gitignore', 'work/wg-batch-*.json\nscripts/aon-verify/\n');
    for (const f of [...GEN, ...INS, 'src/data/trust-ledger.json']) put(main, f, 'base\n');
    g(main, 'init', '-q');
    g(main, 'add', '.');
    g(main, 'commit', '-qm', 'base');
    g(main, 'config', 'extensions.worktreeConfig', 'true');
    put(main, 'work/wg-batch-001.json', 'pin\n');
    put(main, 'work/.wg-diff-all.json', '{}\n');
    put(main, 'scripts/aon-verify/apply-x.ts', `const R = '${fwd(main)}/src/rules/x.ts';\n`);
    return { main, a: read(main, 'scripts/a.mjs') };
  };
  const files = (patch: Buffer) => [...patch.toString().matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]).sort();
  const env = () => { const e = { ...process.env }; delete e.HEAVY_LOCK_PATH; delete e.HEAVY_LOCK; return e; };
  const node = (cwd: string, ...a: string[]) => execFileSync(process.execPath, a, { cwd, env: env(), encoding: 'utf8' }).trim();

  it('new: keeps autocrlf=input, changes no tracked file, shares main\'s lock, records base + copies, lists what names main', () => {
    const { main } = mainRepo();
    g(main, 'config', 'extensions.worktreeConfig', 'false');
    expect(() => newLane('t', { main })).toThrow(/worktreeConfig/);
    g(main, 'config', 'extensions.worktreeConfig', 'true');
    const r = newLane('t', { main });
    const { lane } = r;
    expect(r.tracked).toEqual([]);
    expect(g(lane, 'status', '--porcelain', '-uno')).toBe(''); // every tracked file is its blob: nothing to put back
    expect(r.hazards).toEqual(['scripts/aon-verify/apply-x.ts', 'scripts/off-chain.mjs']); // the untracked copy too
    expect(r.chainHazards).toEqual([]); // off-chain.mjs is only named by a chain script, never run
    expect(r.lockShared).toBe(true);
    expect(samePath(r.lock, machineLock(main))).toBe(true);
    expect(g(lane, 'config', 'core.autocrlf').trim()).toBe('input');
    rmSync(join(lane, 'scripts/c.mjs'));
    g(lane, 'checkout', '--', 'scripts/c.mjs');
    expect(read(lane, 'scripts/c.mjs')).toBe(C); // the blob; CRLF without the lane's own setting
    expect(fwd(node(lane, 'scripts/a.mjs'))).toBe(`${fwd(lane)}/`); // the root fix: the lane's own ROOT, nothing edited
    expect(fwd(node(lane, 'scripts/deep/b.mjs'))).toBe(`${fwd(lane)}/`);
    const rec = JSON.parse(read(lane, '.worktree-lane.json'));
    expect(Object.keys(rec).sort()).toEqual(['base', 'copies']);
    expect(rec.base).toBe(g(main, 'rev-parse', 'HEAD').trim());
    expect(Object.keys(rec.copies).sort()).toEqual(['scripts/aon-verify/apply-x.ts', 'work/.wg-diff-all.json', 'work/wg-batch-001.json']);
    rmLane('t', { main });
    expect(existsSync(lane)).toBe(false);
  }, 60_000);

  /* The refuter's case: a lane shared the machine lock only because `new` edited heavy-lock.mjs in it, so a
   * plain `git worktree add` lane got a lock of its own and its vitest ran beside main's. heavy-lock.mjs
   * now finds main itself. A lane cut from before that has the old file: `new` reports it, edits nothing. */
  it('a plain `git worktree add` lane takes main\'s lock too; a lane cut from before the fix does not, and new says so', () => {
    const { main } = mainRepo();
    const plain = join(dirname(main), 'plain');
    g(main, 'worktree', 'add', '-q', '--detach', plain);
    expect(samePath(laneLock(plain), machineLock(main))).toBe(true);
    expect(samePath(laneLock(main), machineLock(main))).toBe(true);
    const old = mainRepo({ lock: lockOld });
    const r = newLane('o', { main: old.main });
    expect(r.lockShared).toBe(false);
    expect(samePath(r.lock, join(r.lane, 'work/.heavy.lock'))).toBe(true);
    expect(r.tracked).toEqual([]); // reported, not patched
  }, 90_000);

  /* A lane cut from a commit before a root fix: a file its chains RUN names main — the entry itself, a lib
   * the entry imports, or a script the chain spawns. `new` edits nothing, so it must say so, and `prove`
   * must refuse before `npm run data` can write MAIN. */
  it('a chain that names main — in an entry, a module it imports or a script it spawns: new lists it, prove refuses before running anything', () => {
    for (const [opt, file] of [[{ hardChain: true }, 'scripts/a.mjs'], [{ hardLib: true }, 'scripts/lib/facets.mjs'], [{ hardSpawned: true }, 'scripts/spawned.mjs']] as const) {
      const { main } = mainRepo(opt);
      const r = newLane('k', { main });
      expect(r.tracked).toEqual([]);
      expect(r.chainHazards).toEqual([file]);
      expect(r.hazards).toContain(file);
      expect(() => prove('k', { main })).toThrow(new RegExp(`refusing: these chain scripts hardcode[^]*${file.replace(/[./]/g, '\\$&')}`));
      expect(existsSync(join(r.lane, 'work/.lane-data.log'))).toBe(false); // npm run data never started
    }
  }, 120_000);

  it('a lane made by an older new (its record lists an edit) is refused: its patch would carry that edit into main', () => {
    const { main } = mainRepo();
    const { lane } = newLane('h', { main });
    const rec = JSON.parse(read(lane, '.worktree-lane.json'));
    put(lane, '.worktree-lane.json', JSON.stringify({ ...rec, edits: [{ file: 'scripts/lib/heavy-lock.mjs', from: 'x', to: 'y' }] }));
    expect(() => laneDiff(lane)).toThrow(/older `new` that edited scripts\/lib\/heavy-lock\.mjs/);
    expect(() => prove('h', { main })).toThrow(/older `new`/);
  }, 60_000);

  /* The refuter's case: write-backfill.mjs writes the overlay CRLF over its LF blob, and under
   * autocrlf=false git saw a whole-file change. The lane's autocrlf=input folds it back — for the overlay
   * (which `diff` reports, never patches) and for a file the patch does carry. */
  it('an untouched lane gives an empty patch — also after the overlay and a doc are rewritten CRLF with the same content', () => {
    const { main } = mainRepo();
    const { lane } = newLane('u', { main });
    const none = { patch: Buffer.alloc(0), newFiles: [], changedCopies: [], overlayChanged: false };
    expect(laneDiff(lane)).toEqual(none);
    writeFileSync(join(lane, OVERLAY), formatBackfill(ROWS));
    put(lane, 'docs/gold-set-answers.md', 'base\r\n');
    expect(read(lane, OVERLAY)).toContain('\r\n');
    const naive = g(lane, '-c', 'core.autocrlf=false', 'diff', '--name-only'); // the fixture is the real case
    expect(naive).toContain(OVERLAY);
    expect(naive).toContain('docs/gold-set-answers.md');
    expect(laneDiff(lane)).toEqual(none);
  }, 60_000);

  it('diff: every change since the base (lane commits too) in the whole tree, nothing of a regen, the overlay or the ledger; apply --3way lands it on a CRLF main', () => {
    const { main, a } = mainRepo();
    const { lane } = newLane('x', { main });
    const edit = (file: string, from: string, to: string) => put(lane, file, read(lane, file).replace(from, to));
    edit('scripts/a.mjs', 'console.log(ROOT);', "console.log('worker', ROOT);");
    edit('scripts/lib/heavy-lock.mjs', 'const POLL_MS = 2000;', 'const POLL_MS = 3000;'); // a worker's edit to a tracked file
    for (const file of INS) put(lane, file, 'worker\n');
    const rows = [ROWS[0], { id: 'b', value: 3 }];
    writeFileSync(join(lane, OVERLAY), formatBackfill(rows)); // one row changed: reported, never patched
    put(lane, 'docs/committed.md', 'committed in the lane\n');
    g(lane, 'add', 'docs/committed.md');
    g(lane, 'commit', '-qm', 'lane work'); // HEAD moves; the patch still starts at the base
    for (const file of GEN) put(lane, file, 'regen\n');
    put(lane, 'public/ast/new.json.gz', 'regen\n'); // a new generated file
    put(lane, 'src/data/trust-ledger.json', 'restamped\n');
    put(lane, 'scripts/new-tool.mjs', 'export {};\n'); // new, not ignored
    put(lane, 'work/wg-batch-002.json', 'new pin\n'); // new, gitignored
    put(lane, 'work/wg-batch-003.json', 'same pin\n'); // new in the lane, but main has it byte for byte
    put(main, 'work/wg-batch-003.json', 'same pin\n');
    put(lane, 'work/.wg-diff-all.json', '{"x":1}\n'); // a copy the lane changed
    put(main, 'work/wg-batch-001.json', 'main moved its own copy\n'); // main's change, not the lane's work
    const { patch, newFiles, changedCopies, overlayChanged } = laneDiff(lane);
    const text = patch.toString();
    expect(text).not.toMatch(/worktree-lane:|regen|restamped|"value"|\r/);
    expect(text).not.toContain(fwd(machineLock(main)));
    const touched = [...INS, 'docs/committed.md', 'scripts/a.mjs', 'scripts/lib/heavy-lock.mjs'].sort();
    expect(files(patch)).toEqual(touched);
    expect(overlayChanged).toBe(true);
    expect(newFiles).toEqual(['scripts/new-tool.mjs', 'work/wg-batch-002.json']);
    expect(changedCopies).toEqual(['work/.wg-diff-all.json']);

    // main as this machine checks it out: autocrlf=true, every text file CRLF on disk — except one file
    // written LF since (main's line endings are mixed per file) with the same content: `git status` lists
    // it (its size changed), git's content comparison does not — not a change, so apply must accept it
    const clone = join(dirname(main), 'clone');
    execFileSync('git', ['clone', '-q', main, clone], { stdio: 'pipe' });
    expect(read(clone, 'scripts/a.mjs')).toContain('\r\n');
    put(clone, 'docs/gold-set-answers.md', 'base\n');
    expect(g(clone, 'status', '--porcelain')).toBe(' M docs/gold-set-answers.md\n');
    expect(g(clone, 'diff', '--name-only')).toBe('');
    expect(applyPatch(clone, patch)).toEqual({ files: touched, conflicts: [], endingsKept: ['docs/gold-set-answers.md'], endingsLost: [] });
    const lf = (file: string) => read(clone, file).replace(/\r\n/g, '\n');
    expect(read(clone, 'docs/gold-set-answers.md')).toBe('worker\n'); // it was LF: it stays LF
    expect(read(clone, 'scripts/a.mjs')).toContain('\r\n'); // it was CRLF: it stays CRLF
    expect(lf('scripts/a.mjs')).toBe(a.replace('console.log(ROOT);', "console.log('worker', ROOT);"));
    expect(lf('scripts/lib/heavy-lock.mjs')).toBe(lockNow.replace('const POLL_MS = 2000;', 'const POLL_MS = 3000;'));
    expect(lf(OVERLAY)).toBe(JSON.stringify(ROWS, null, 1)); // untouched: its rows come as spec files
    expect(lf('docs/committed.md')).toBe('committed in the lane\n');
    expect(lf('scripts/migration/out/join.json')).toBe('worker\n');
    expect(lf('public/core.json')).toBe('base\n');
    expect(lf('src/data/trust-ledger.json')).toBe('base\n');
    expect(g(clone, 'diff', '--cached', '--name-only')).toBe(''); // nothing staged
  }, 60_000);

  /* The refuter's case (2026-09-29): main has a MIXED file on disk (test/armor-traits.test.ts: 229 LF lines,
   * 1 CRLF), and apply gave it back CRLF on every line. Now every line keeps its own ending — kept, changed,
   * added, and in a file with conflict markers — an LF file stays LF and a CRLF file CRLF. */
  it('apply: every line of a mixed or LF file keeps its own ending — kept, changed, added, conflicted; a CRLF file stays CRLF', () => {
    const { main } = mainRepo();
    const body = Array.from({ length: 12 }, (_, k) => `line ${k + 1}`);
    for (const f of ['test/mixed.test.ts', 'docs/conflict.md']) put(main, f, `${body.join('\n')}\n`);
    g(main, 'add', '.');
    g(main, 'commit', '-qm', 'two more');
    const { lane } = newLane('e', { main });
    const edit = (file: string, from: string, to: string) => put(lane, file, read(lane, file).replace(from, to));
    edit('test/mixed.test.ts', 'line 2\n', 'line 2 changed\n'); // the one CRLF line, changed in place
    edit('test/mixed.test.ts', 'line 6\n', 'line 6\nadded\n'); // after an LF line
    edit('test/mixed.test.ts', 'line 12\n', 'line 12\n// tail\n'); // at the end, as the refuter's probe did
    edit('docs/conflict.md', 'line 9\n', 'lane 9\n');
    edit('docs/gold-set-answers.md', 'base\n', 'worker\nmore\n');
    edit('scripts/d.mjs', 'export {};\n', 'export {};\nexport const D = 1;\n');
    const { patch } = laneDiff(lane);

    const clone = join(dirname(main), 'clone-eol');
    execFileSync('git', ['clone', '-q', main, clone], { stdio: 'pipe' });
    expect(read(clone, 'scripts/d.mjs')).toBe('export {};\r\n'); // this machine's checkout: CRLF
    const mixed = (crlfAt: (k: number) => boolean) => body.map((l, k) => `${l}${crlfAt(k) ? '\r\n' : '\n'}`).join('');
    put(clone, 'test/mixed.test.ts', mixed((k) => k === 1)); // main's shape: one CRLF line among LF
    put(clone, 'docs/conflict.md', mixed((k) => k < 6)); // the refuter's shape: first half CRLF, second half LF
    put(clone, 'docs/gold-set-answers.md', 'base\n');
    put(clone, 'docs/conflict.md', read(clone, 'docs/conflict.md').replace('line 9\n', 'main 9\n'));
    g(clone, 'commit', '-qam', 'main moved line 9'); // the working tree stays as written: mixed
    expect(g(clone, 'diff', '--name-only')).toBe('');
    expect(read(clone, 'docs/conflict.md')).toContain('line 1\r\n');

    expect(applyPatch(clone, patch)).toEqual({
      files: ['docs/conflict.md', 'docs/gold-set-answers.md', 'scripts/d.mjs', 'test/mixed.test.ts'],
      conflicts: ['docs/conflict.md'],
      endingsKept: ['docs/conflict.md', 'docs/gold-set-answers.md', 'test/mixed.test.ts'],
      endingsLost: [],
    });
    expect(read(clone, 'test/mixed.test.ts')).toBe(['line 1\n', 'line 2 changed\r\n', 'line 3\n', 'line 4\n', 'line 5\n', 'line 6\n',
      'added\n', 'line 7\n', 'line 8\n', 'line 9\n', 'line 10\n', 'line 11\n', 'line 12\n', '// tail\n'].join(''));
    expect(read(clone, 'docs/gold-set-answers.md')).toBe('worker\nmore\n');
    expect(read(clone, 'scripts/d.mjs')).toBe('export {};\r\nexport const D = 1;\r\n');
    const conflicted = read(clone, 'docs/conflict.md');
    expect(conflicted).toMatch(/<<<<<<<[^]*main 9[^]*=======[^]*lane 9[^]*>>>>>>>/);
    for (let k = 1; k <= 12; k++) if (k !== 9) expect(conflicted).toContain(`line ${k}${k <= 6 ? '\r\n' : '\n'}`);
    expect(conflicted.replace(/\r\n/g, '')).not.toContain('\r'); // never a CR alone
  }, 60_000);

  /* Endings are put back only where autocrlf did the writing. git writes a blob that holds CR as it is: those
   * are the lane's own endings (a file a worker committed CRLF on purpose) and they stay, even where main had
   * the file LF on disk. */
  it('apply: a file the lane committed CRLF on purpose keeps the blob\'s endings, even where main had it LF', () => {
    const { main } = mainRepo();
    const { lane } = newLane('c', { main });
    put(lane, 'docs/gold-set-answers.md', 'worker\r\nmore\r\n');
    g(lane, '-c', 'core.autocrlf=false', 'add', 'docs/gold-set-answers.md');
    g(lane, 'commit', '-qm', 'CRLF on purpose');
    const { patch } = laneDiff(lane);
    expect(patch.toString()).toContain('+worker\r\n');
    const clone = join(dirname(main), 'clone-crlf');
    execFileSync('git', ['clone', '-q', main, clone], { stdio: 'pipe' });
    put(clone, 'docs/gold-set-answers.md', 'base\n'); // LF on disk, as main has 2,510 files
    expect(applyPatch(clone, patch)).toEqual({ files: ['docs/gold-set-answers.md'], conflicts: [], endingsKept: [], endingsLost: [] });
    expect(read(clone, 'docs/gold-set-answers.md')).toBe('worker\r\nmore\r\n');
  }, 60_000);

  it('apply: refuses (nothing applied) when main is dirty in a touched file; dirt elsewhere is fine; a file main moved conflicts, unstaged', () => {
    const { main } = mainRepo();
    const { lane } = newLane('d', { main });
    put(lane, 'docs/gold-set-answers.md', 'worker\n');
    put(lane, 'tracker/src/x.ts', 'worker\n');
    const { patch } = laneDiff(lane);
    put(main, 'tracker/src/x.ts', 'main moved\n');
    g(main, 'commit', '-qam', 'main moves on');
    put(main, 'docs/gold-set-answers.md', 'main is mid-edit\n');
    expect(() => applyPatch(main, patch)).toThrow(/uncommitted changes in 1 file[^]*docs\/gold-set-answers\.md/);
    expect(read(main, 'tracker/src/x.ts')).toBe('main moved\n');
    g(main, 'add', 'docs/gold-set-answers.md');
    put(main, 'docs/gold-set-answers.md', 'base\n'); // staged but not in the working tree: still a change
    expect(() => applyPatch(main, patch)).toThrow(/uncommitted changes in 1 file[^]*docs\/gold-set-answers\.md/);
    g(main, 'reset', '-q', '--', 'docs/gold-set-answers.md');
    put(lane, 'docs/brand-new.md', 'lane\n');
    g(lane, 'add', 'docs/brand-new.md'); // a file the patch creates…
    put(main, 'docs/brand-new.md', 'main has an untracked one\n'); // …where main has an untracked one
    expect(() => applyPatch(main, laneDiff(lane).patch)).toThrow(/uncommitted changes in 1 file[^]*docs\/brand-new\.md/);
    rmSync(join(main, 'docs/brand-new.md'));
    put(main, 'docs/gold-set-answers.md', 'base\n');
    put(main, 'public/data/a.json', 'main is mid-edit\n'); // not in the patch
    expect(applyPatch(main, patch)).toEqual({
      files: ['docs/gold-set-answers.md', 'tracker/src/x.ts'], conflicts: ['tracker/src/x.ts'],
      endingsKept: ['docs/gold-set-answers.md', 'tracker/src/x.ts'], endingsLost: [], // both LF on disk here
    });
    expect(read(main, 'docs/gold-set-answers.md')).toBe('worker\n'); // rewritten with its base content first: stat-dirty, refreshed, applied
    expect(read(main, 'tracker/src/x.ts')).toMatch(/<<<<<<<[^]*main moved[^]*worker/);
    expect(read(main, 'tracker/src/x.ts')).not.toContain('\r'); // conflict markers and all: LF, as the file was
    expect(g(main, 'diff', '--cached', '--name-only') + g(main, 'ls-files', '-u')).toBe(''); // main's own index untouched
  }, 60_000);
});

describe('proofPassed', () => {
  it('passes only on green data + verify, identical bytes, exactly GENERATED rewritten and nothing for diff to carry', () => {
    const ok = { codes: { data: 0, verify: 0 }, diff: [], notRewritten: [], strays: [], patch: Buffer.alloc(0), newFiles: [], changedCopies: [], overlayChanged: false };
    expect(proofPassed(ok)).toBe(true);
    for (const bad of [
      { codes: { data: 0, verify: 1 } }, { codes: { data: 1, verify: 0 } }, { diff: [{ path: 'public/core.json' }] },
      { notRewritten: ['scripts/migration/out/map.json'] }, { strays: ['scripts/migration/out/join.json'] },
      { patch: Buffer.from('x') }, { newFiles: ['work/wg-batch-040.json'] }, { changedCopies: ['work/.wg-diff-all.json'] },
      { overlayChanged: true }, { overlayChanged: undefined },
    ]) expect(proofPassed({ ...ok, ...bad })).toBe(false);
  });
});
