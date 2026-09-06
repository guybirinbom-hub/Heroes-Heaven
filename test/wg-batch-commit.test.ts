/*
 * `git add -A` is a standing prohibition in this repo, and this is the script that replaces it.
 *
 * The two failures it exists to stop are both silent: a batch commit that sweeps in an unrelated
 * working-tree edit nobody reviewed, and a batch commit that ships `scripts/data/effect-backfill.json`
 * without the `public/core.json` / `core-descriptions.json` it regenerates — an overlay and its
 * artefacts disagreeing in history is the hardest state this project has had to debug.
 *
 * Both are refusals, so both are tested, in a throwaway git repo under the OS temp dir — never this
 * one. What is asserted:
 *
 *   1. The staged set is exactly the manifest's `stage: []` ∪ the known batch set, by explicit path.
 *   2. A modified tracked path the batch does not account for REFUSES and names it.
 *   3. The three data artefacts move together or not at all.
 *   4. No commit message file, or one under 200 chars, REFUSES.
 *   5. The commit that lands contains exactly the printed list — nothing else in the tree comes with it.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = join(__dirname, '..', 'scripts/wg-batch-commit.mjs');
const MESSAGE =
  'WG parity batch 900 (the three fixture records): all nine gates pass, experience 3/3\n\n' +
  'alpha regains the printed burst size, beta is a taught comparer settle, gamma is on the Rulings Desk.\n' +
  'This message exists to be long enough that the commit script accepts it: a batch commit under two\n' +
  'hundred characters has never said what actually changed.\n';

type Run = { code: number; out: string };
function commit(root: string, ...args: string[]): Run {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}
const git = (root: string, ...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });

const TRACKED_AT_HEAD = [
  'public/core.json',
  'public/core-descriptions.json',
  'scripts/data/effect-backfill.json',
  'src/rules/build.ts',
  'test/alpha.test.ts',
  'work/.b900-read.json',
  'work/.b900-run.json',
  'work/unrelated-notes.json',
  /* The gate's diagnostic dump, TRACKED — which it was in this repo until 2026-09-06, and which made
   * every batch commit after a `--stage gate` run refuse. It is on the ignore list now, but a clone
   * that still has it tracked must not be able to wedge a commit, so the allowlist covers it. */
  'work/.gate-prose.json',
];

/** A throwaway repo with one commit, then the working-tree state a finished batch 900 leaves behind. */
function repo(over: Record<string, string | null> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'wg-commit-'));
  for (const d of ['work', 'public', 'scripts/data', 'src/rules', 'test']) mkdirSync(join(root, d), { recursive: true });
  for (const f of TRACKED_AT_HEAD) writeFileSync(join(root, f), '{"at":"HEAD"}\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'core.autocrlf', 'false'); // the fixture writes LF; without this git warns on every add
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture base');

  const after: Record<string, string | null> = {
    // the batch's own changes
    'public/core.json': '{"at":"batch 900"}\n',
    'public/core-descriptions.json': '{"at":"batch 900"}\n',
    'scripts/data/effect-backfill.json': '{"at":"batch 900"}\n',
    'src/rules/build.ts': '// batch 900: alpha\n',
    'test/alpha.test.ts': "it('alpha', () => {});\n",
    'work/.b900-read.json': '{"confirmed":[]}\n',
    // driver scratch: modified every run, never part of a commit
    'work/.b900-run.json': '[{"stage":"close"}]\n',
    // new, untracked
    'work/.b900-specs.json': JSON.stringify([{ file: 'work/.b900-rows-items.json', kind: 'rows', family: 'items', stage: ['work/.b900-rows-items.json', 'src/rules/build.ts', 'test/alpha.test.ts'] }]),
    'work/.b900-rows-items.json': '{"findings":[]}\n',
    /* Batch EVIDENCE, not scratch (ruling 2026-09-06): apply-digest collates every gap line out of the
     * per-family report and verify files, and a gap line's `ref` is `<report path>:<line>` — a
     * disposition citing a file that never reached history cannot be checked afterwards. */
    'work/.b900-report-items.txt': 'DATA STILL NEEDED\n- (none)\n',
    'work/.b900-verify-items.txt': 'CROSS-FILE GAPS\n- (none)\n',
    'work/wg-batch-900-parity.json': '{"batch":900,"records":[]}\n',
    'work/wg-batch-900-residual.json': '{"complete":true}\n',
    'work/.b900-commit.txt': MESSAGE,
    ...over,
  };
  for (const [rel, body] of Object.entries(after)) {
    if (body === null) { rmSync(join(root, rel), { force: true }); continue; }
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const EXPECTED = [
  'scripts/data/effect-backfill.json',
  'public/core.json',
  'public/core-descriptions.json',
  'work/wg-batch-900-parity.json',
  'work/wg-batch-900-residual.json',
  'work/.b900-read.json',
  'work/.b900-specs.json',
  'work/.b900-rows-items.json',
  // the commit message is COMMITTED, not scratch: it is the batch's own account of what it changed, and
  // the .gitignore split of 2026-09-06 keeps .b*-commit.txt / -read*.txt / -rows*.json on the KEEP side.
  'work/.b900-commit.txt',
  // and the per-family build/verify reports, for the same reason: they are what the gap lines cite
  'work/.b900-report-items.txt',
  'work/.b900-verify-items.txt',
  'src/rules/build.ts',
  'test/alpha.test.ts',
];

// Each case spawns a dozen git processes in a fresh repo; on Windows that is seconds, not milliseconds.
describe('wg-batch-commit stages by explicit path or refuses', { timeout: 60_000 }, () => {
  it('--dry-run plans exactly the manifest set ∪ the known batch set, and stages nothing', () => {
    const root = repo();
    const r = commit(root, '--batch', '900', '--dry-run');
    expect(r.code).toBe(0);
    for (const f of EXPECTED) expect(r.out).toContain(f);
    expect(r.out).toContain('driver scratch: work/.b900-run.json');
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('');
    rmSync(root, { recursive: true, force: true });
  });

  it('REFUSES a modified tracked path the batch does not account for, naming it', () => {
    const root = repo({ 'work/unrelated-notes.json': '{"someone":"edited this"}\n' });
    const r = commit(root, '--batch', '900');
    expect(r.code).toBe(1);
    expect(r.out).toContain('does not account for');
    expect(r.out).toContain('work/unrelated-notes.json');
    expect(git(root, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
    rmSync(root, { recursive: true, force: true });
  });

  it('does NOT refuse over a gate run rewriting its own diagnostic dumps', () => {
    const root = repo({ 'work/.gate-prose.json': '["249 lines a gate run just wrote"]\n' });
    const r = commit(root, '--batch', '900', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).toContain('work/.gate-prose.json');
    expect(r.out).toMatch(/skipped as driver scratch:.*work\/\.gate-prose\.json/);
    expect(r.out).not.toContain('does not account for');
    rmSync(root, { recursive: true, force: true });
  });

  it('REFUSES when the three data artefacts do not move together', () => {
    const root = repo({ 'public/core.json': '{"at":"HEAD"}\n' });
    const r = commit(root, '--batch', '900');
    expect(r.code).toBe(1);
    expect(r.out).toContain('move together');
    expect(r.out).toContain('public/core.json');
    rmSync(root, { recursive: true, force: true });
  });

  it('REFUSES a missing or too-short commit message', () => {
    const gone = repo({ 'work/.b900-commit.txt': null });
    expect(commit(gone, '--batch', '900').out).toContain('missing work/.b900-commit.txt');
    rmSync(gone, { recursive: true, force: true });

    const short = repo({ 'work/.b900-commit.txt': 'WG parity batch 900\n' });
    const r = commit(short, '--batch', '900');
    expect(r.code).toBe(1);
    expect(r.out).toContain('under 200');
    rmSync(short, { recursive: true, force: true });
  });

  it('commits exactly the printed list and prints the sha', () => {
    const root = repo();
    const r = commit(root, '--batch', '900');
    expect(r.code).toBe(0);
    const sha = git(root, 'rev-parse', 'HEAD').trim();
    expect(r.out).toContain(sha);
    const inCommit = git(root, 'show', '--pretty=format:', '--name-only', 'HEAD').split('\n').filter(Boolean).sort();
    expect(inCommit).toEqual([...EXPECTED].sort());
    // the scratch file was left in the working tree, not swept into history
    expect(git(root, 'status', '--porcelain')).toContain('work/.b900-run.json');
    expect(git(root, 'log', '-1', '--pretty=%s').trim()).toContain('WG parity batch 900');
    rmSync(root, { recursive: true, force: true });
  });

  it('REFUSES when the batch has changed nothing at all', () => {
    const root = repo();
    commit(root, '--batch', '900');
    const again = commit(root, '--batch', '900');
    expect(again.code).toBe(1);
    expect(again.out).toContain('nothing to commit');
    rmSync(root, { recursive: true, force: true });
  });
});
