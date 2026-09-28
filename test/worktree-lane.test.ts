/*
 * WORKTREE LANES (scripts/worktree-lane.mjs) — what a lane links, what it copies, how it compares, what
 * its merge-back patch carries, how that patch lands on main, and the refusals that protect main.
 *
 * The one that matters most is unlinkLinks: measured on git 2.53.0.windows.2, `git worktree remove
 * --force` FOLLOWS a junction and empties its target, so a lane removed by hand would wipe main's
 * node_modules / .import-src / work/wg. `rm` unlinks every link first; the test proves the target
 * survives the unlink. Everything runs on temp dirs — never the real checkout.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  applyPatch, compareFiles, laneDiff, linkInputs, machineLock, mainPathHazards, newLane, patchLane, proofPassed, rmLane, unlinkLinks,
} from '../scripts/worktree-lane.mjs';
import { formatBackfill } from '../scripts/lib/write-backfill.mjs';

const roots: string[] = [];
const temp = () => { const r = mkdtempSync(join(tmpdir(), 'hh-lane-test-')); roots.push(r); return r; };
afterAll(() => { for (const r of roots) { unlinkLinks(r); rmSync(r, { recursive: true, force: true }); } });
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe', encoding: 'utf8' });
const fwd = (p: string) => p.replace(/\\/g, '/');
const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8');
const put = (dir: string, file: string, s: string | Buffer) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), s); };

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

describe('mainPathHazards', () => {
  it('finds tracked code naming the main checkout in either slash style, and nothing else', () => {
    const repo = temp();
    g(repo, 'init', '-q');
    writeFileSync(join(repo, 'fwd.mjs'), "const ROOT = 'C:/some place/main checkout/';\n");
    writeFileSync(join(repo, 'back.ts'), "const R = 'c:\\\\some place\\\\main checkout';\n");
    writeFileSync(join(repo, 'clean.mjs'), "const ROOT = new URL('..', import.meta.url);\n");
    writeFileSync(join(repo, 'notes.md'), 'C:/some place/main checkout\n');
    g(repo, 'add', '.');
    expect(mainPathHazards(repo, 'C:\\some place\\main checkout').sort()).toEqual(['back.ts', 'fwd.mjs']);
  });
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
  const lockBase = execFileSync('git', ['show', 'HEAD:scripts/lib/heavy-lock.mjs'], { cwd: join(__dirname, '..'), encoding: 'utf8' });

  /* Main: chain scripts that hardcode it, the REAL heavy-lock.mjs as committed (if its lockPath line
   * changes, the lock edit stops matching and the first test fails), the overlay committed LF like the
   * real one, generated files and inputs; then the untracked inputs `new` copies. */
  const mainRepo = () => {
    const main = join(temp(), 'main checkout');
    const hard = `const ROOT = '${fwd(main)}/';\nconsole.log(ROOT);\n`;
    put(main, 'package.json', JSON.stringify({ scripts: { data: 'node scripts/a.mjs && node scripts/deep/b.mjs', verify: 'jiti scripts/c.mjs && node scripts/a.mjs' } }));
    put(main, 'scripts/a.mjs', hard);
    put(main, 'scripts/deep/b.mjs', hard);
    put(main, 'scripts/c.mjs', "const ROOT = 'somewhere else/';\n");
    put(main, 'scripts/off-chain.mjs', hard);
    put(main, 'scripts/lib/heavy-lock.mjs', lockBase);
    put(main, OVERLAY, JSON.stringify(ROWS, null, 1));
    put(main, '.gitignore', 'work/wg-batch-*.json\n');
    for (const f of [...GEN, ...INS, 'src/data/trust-ledger.json']) put(main, f, 'base\n');
    g(main, 'init', '-q');
    g(main, 'add', '.');
    g(main, 'commit', '-qm', 'base');
    g(main, 'config', 'extensions.worktreeConfig', 'true');
    put(main, 'work/wg-batch-001.json', 'pin\n');
    put(main, 'work/.wg-diff-all.json', '{}\n');
    return { main, hard };
  };
  const files = (patch: Buffer) => [...patch.toString().matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]).sort();
  const env = () => { const e = { ...process.env }; delete e.HEAVY_LOCK_PATH; delete e.HEAVY_LOCK; return e; };
  const node = (cwd: string, ...a: string[]) => execFileSync(process.execPath, a, { cwd, env: env(), encoding: 'utf8' }).trim();

  it('new: keeps autocrlf=input, points the chain scripts at the lane and the lock at main, records base + edits + copies', () => {
    const { main } = mainRepo();
    g(main, 'config', 'extensions.worktreeConfig', 'false');
    expect(() => newLane('t', { main })).toThrow(/worktreeConfig/);
    g(main, 'config', 'extensions.worktreeConfig', 'true');
    const r = newLane('t', { main });
    const { lane } = r;
    expect(r.patched.sort()).toEqual(['scripts/a.mjs', 'scripts/deep/b.mjs', 'scripts/lib/heavy-lock.mjs']);
    expect(r.hazards).toEqual(['scripts/off-chain.mjs']); // not in a chain: listed, not edited
    expect(g(lane, 'config', 'core.autocrlf').trim()).toBe('input');
    rmSync(join(lane, 'scripts/c.mjs'));
    g(lane, 'checkout', '--', 'scripts/c.mjs');
    expect(read(lane, 'scripts/c.mjs')).toBe("const ROOT = 'somewhere else/';\n"); // the blob; CRLF without the lane's own setting
    expect(node(lane, 'scripts/a.mjs')).toBe(`${fwd(lane)}/`);
    expect(node(lane, 'scripts/deep/b.mjs')).toBe(`${fwd(lane)}/`);
    const lock = node(lane, '--input-type=module', '-e', `import(${JSON.stringify(pathToFileURL(join(lane, 'scripts/lib/heavy-lock.mjs')).href)}).then((m) => console.log(m.lockPath()))`);
    expect(lock).toBe(fwd(machineLock(main)));
    expect(patchLane(lane, main)).toEqual([]); // idempotent
    const rec = JSON.parse(read(lane, '.worktree-lane.json'));
    expect(rec.base).toBe(g(main, 'rev-parse', 'HEAD').trim());
    expect(rec.edits.map((e: { file: string }) => e.file).sort()).toEqual(r.patched.sort());
    expect(Object.keys(rec.copies).sort()).toEqual(['work/.wg-diff-all.json', 'work/wg-batch-001.json']);
    rmLane('t', { main });
    expect(existsSync(lane)).toBe(false);
  }, 60_000);

  /* The refuter's case: write-backfill.mjs writes the overlay CRLF over its LF blob. Under autocrlf=false
   * that was a whole-file rewrite in every lane patch; the lane's autocrlf=input folds it back. */
  it('an untouched lane gives an empty patch — also after the overlay is rewritten CRLF with the same rows', () => {
    const { main } = mainRepo();
    const { lane } = newLane('u', { main });
    expect(laneDiff(lane)).toEqual({ patch: Buffer.alloc(0), newFiles: [], changedCopies: [] });
    writeFileSync(join(lane, OVERLAY), formatBackfill(ROWS));
    expect(read(lane, OVERLAY)).toContain('\r\n');
    expect(g(lane, '-c', 'core.autocrlf=false', 'diff', '--name-only')).toContain(OVERLAY); // the fixture is the real case
    expect(laneDiff(lane)).toEqual({ patch: Buffer.alloc(0), newFiles: [], changedCopies: [] });
  }, 60_000);

  it('diff: every change since the base (lane commits too) in the whole tree, nothing of new, a regen or the ledger; apply --3way lands it on a CRLF main', () => {
    const { main, hard } = mainRepo();
    const { lane } = newLane('x', { main });
    const edit = (file: string, a: string, b: string) => put(lane, file, read(lane, file).replace(a, b));
    edit('scripts/a.mjs', 'console.log(ROOT);', "console.log('worker', ROOT);"); // inside the ROOT line's context
    edit('scripts/lib/heavy-lock.mjs', 'const POLL_MS = 2000;', 'const POLL_MS = 3000;'); // inside the lock line's context
    for (const file of INS) put(lane, file, 'worker\n');
    const rows = [ROWS[0], { id: 'b', value: 3 }];
    writeFileSync(join(lane, OVERLAY), formatBackfill(rows)); // one row changed, the whole file written CRLF
    put(lane, 'docs/committed.md', 'committed in the lane\n');
    g(lane, 'add', 'docs/committed.md');
    g(lane, 'commit', '-qm', 'lane work'); // HEAD moves; the patch still starts at the base
    for (const file of GEN) put(lane, file, 'regen\n');
    put(lane, 'public/ast/new.json.gz', 'regen\n'); // a new generated file
    put(lane, 'src/data/trust-ledger.json', 'restamped\n');
    put(lane, 'scripts/new-tool.mjs', 'export {};\n'); // new, not ignored
    put(lane, 'work/wg-batch-002.json', 'new pin\n'); // new, gitignored
    put(lane, 'work/.wg-diff-all.json', '{"x":1}\n'); // a copy the lane changed
    const { patch, newFiles, changedCopies } = laneDiff(lane);
    const text = patch.toString();
    expect(text).not.toMatch(/worktree-lane:|regen|restamped|\r/);
    expect(text).not.toContain(fwd(machineLock(main)));
    const touched = [...INS, 'docs/committed.md', 'scripts/a.mjs', OVERLAY, 'scripts/lib/heavy-lock.mjs'].sort();
    expect(files(patch)).toEqual(touched);
    const overlayHunk = text.split('diff --git ').find((s) => s.startsWith(`a/${OVERLAY}`))!;
    expect(overlayHunk.split('\n').filter((l) => /^[-+](?!--|\+\+)/.test(l))).toEqual(['-  "value": 2', '+  "value": 3']);
    expect(newFiles).toEqual(['scripts/new-tool.mjs', 'work/wg-batch-002.json']);
    expect(changedCopies).toEqual(['work/.wg-diff-all.json']);

    // main as this machine checks it out: autocrlf=true, every text file CRLF on disk
    const clone = join(dirname(main), 'clone');
    execFileSync('git', ['clone', '-q', main, clone], { stdio: 'pipe' });
    expect(read(clone, 'scripts/a.mjs')).toContain('\r\n');
    expect(applyPatch(clone, patch)).toEqual({ files: touched, conflicts: [] });
    const lf = (file: string) => read(clone, file).replace(/\r\n/g, '\n');
    expect(lf('scripts/a.mjs')).toBe(hard.replace('console.log(ROOT);', "console.log('worker', ROOT);"));
    expect(lf('scripts/lib/heavy-lock.mjs')).toBe(lockBase.replace('const POLL_MS = 2000;', 'const POLL_MS = 3000;'));
    expect(lf(OVERLAY)).toBe(JSON.stringify(rows, null, 1));
    expect(lf('docs/committed.md')).toBe('committed in the lane\n');
    expect(lf('scripts/migration/out/join.json')).toBe('worker\n');
    expect(lf('public/core.json')).toBe('base\n');
    expect(lf('src/data/trust-ledger.json')).toBe('base\n');
    expect(g(clone, 'diff', '--cached', '--name-only')).toBe(''); // nothing staged
  }, 60_000);

  it('refuses when a worktree-lane: line itself was changed by hand — it cannot be put back', () => {
    const { main } = mainRepo();
    const { lane } = newLane('h', { main });
    put(lane, 'scripts/a.mjs', read(lane, 'scripts/a.mjs').replace('this checkout', 'this lane'));
    expect(() => laneDiff(lane)).toThrow(/changed by hand.*scripts\/a\.mjs/);
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
    put(main, 'docs/gold-set-answers.md', 'base\n');
    put(main, 'public/data/a.json', 'main is mid-edit\n'); // not in the patch
    expect(applyPatch(main, patch)).toEqual({ files: ['docs/gold-set-answers.md', 'tracker/src/x.ts'], conflicts: ['tracker/src/x.ts'] });
    expect(read(main, 'docs/gold-set-answers.md').replace(/\r\n/g, '\n')).toBe('worker\n');
    expect(read(main, 'tracker/src/x.ts')).toMatch(/<<<<<<<[^]*main moved[^]*worker/);
    expect(g(main, 'diff', '--cached', '--name-only') + g(main, 'ls-files', '-u')).toBe(''); // main's own index untouched
  }, 60_000);
});

describe('proofPassed', () => {
  it('passes only on green data + verify, identical bytes, exactly GENERATED rewritten and nothing for diff to carry', () => {
    const ok = { codes: { data: 0, verify: 0 }, diff: [], notRewritten: [], strays: [], patch: Buffer.alloc(0), newFiles: [], changedCopies: [] };
    expect(proofPassed(ok)).toBe(true);
    for (const bad of [
      { codes: { data: 0, verify: 1 } }, { codes: { data: 1, verify: 0 } }, { diff: [{ path: 'public/core.json' }] },
      { notRewritten: ['scripts/migration/out/map.json'] }, { strays: ['scripts/migration/out/join.json'] },
      { patch: Buffer.from('x') }, { newFiles: ['work/wg-batch-040.json'] }, { changedCopies: ['work/.wg-diff-all.json'] },
    ]) expect(proofPassed({ ...ok, ...bad })).toBe(false);
  });
});
