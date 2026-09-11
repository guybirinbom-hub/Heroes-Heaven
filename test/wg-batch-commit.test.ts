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
 *   3. The overlay and core.json move together or not at all; core-descriptions.json only has to move
 *      when the manifest actually carries prose (ruling 2026-09-06, pinned at the two prose tests).
 *   4. No commit message file, or one under 200 chars, REFUSES.
 *   5. The commit that lands contains exactly the printed list — nothing else in the tree comes with it.
 */
import { describe, it, expect, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every case runs the commit guard as a real node child against a throwaway git repo — fine alone,
 * several times slower under the full suite. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = join(__dirname, '..', 'scripts/wg-batch-commit.mjs');
const MESSAGE =
  'WG parity batch 900 (the three fixture records): all nine gates pass, experience 3/3\n\n' +
  'alpha regains the printed burst size, beta is a taught comparer settle, gamma is on the Rulings Desk.\n' +
  'This message exists to be long enough that the commit script accepts it: a batch commit under two\n' +
  'hundred characters has never said what actually changed.\n';

type Run = { code: number; out: string };
/**
 * The env is set EXPLICITLY on both sides (2026-09-11): the script only commits under
 * HH_ORCHESTRATOR=1, and the orchestrator's own shell has that set — so a test that inherited the
 * parent env would pass for her and fail for everyone else, or the reverse.
 */
function run(root: string, args: string[], orchestrator: boolean): Run {
  const env = { ...process.env };
  if (orchestrator) env.HH_ORCHESTRATOR = '1';
  else delete env.HH_ORCHESTRATOR;
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }) };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}
const commit = (root: string, ...args: string[]): Run => run(root, args, true);
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
  // the two batch-evidence dumps of the 2026-09-06 ruling; unmodified in the default fixture
  'work/experience-instrument-limits.json',
  'work/wg-casting-parity.json',
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
    mkdirSync(dirname(join(root, rel)), { recursive: true });   // the baseline start-state lives in its own dir
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
    // WHY: with no start-state the script cannot date the path, so it must NOT claim the path was
    // "dirtied since it started" — batch 031 printed that about 213 paths it had no evidence about.
    expect(r.out).not.toContain('dirtied since it started');
    expect(r.out).toContain('re-run --stage baseline');
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

  /*
   * ORCHESTRATOR RULING (2026-09-06, batch 030): "work/experience-instrument-limits.json is a batch
   * artefact (a parked EXPERIENCE verdict is batch evidence; batches 25/26 committed it inside their
   * batch commits): add it to the commit script's always-staged-when-changed set beside the three data
   * files, parity and residual. Same for work/wg-casting-parity.json (the casting comparer's dump moves
   * when a batch's rows move slot counts; it is evidence of the comparison state, as batch 28 committed
   * it) — staged when changed, never refused over."
   *
   * `resilient` is the finding that exposed it: its parked EXPERIENCE verdict moved the limits file and
   * the batch's slot rows moved the casting dump, and batch 030's commit refused over both.
   */
  // batch 030: resilient
  it('stages the experience-limits and casting dumps (resilient) as batch evidence, never refuses over them', () => {
    const root = repo({
      'work/experience-instrument-limits.json': '{"parked":["a lv8 instrument verdict this batch parked"]}\n',
      'work/wg-casting-parity.json': '{"rows":["slot counts this batch moved"]}\n',
    });
    // batch 030: resilient
    const r = commit(root, '--batch', '900', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('does not account for');
    // batch 030: resilient — both dumps land in the plan, as batch evidence rather than an unaccounted path
    expect(r.out).toContain('work/experience-instrument-limits.json');
    expect(r.out).toContain('work/wg-casting-parity.json');
    rmSync(root, { recursive: true, force: true });
  });

  /*
   * ORCHESTRATOR RULING (2026-09-06, batch 030): "The data-triple refusal ('the three data artefacts move
   * together') is relaxed to the real invariant: refuse only when the manifest's specs carry at least one
   * row with field 'description' or 'descRefs' (or a created-prose spec) AND public/core-descriptions.json
   * did not change; a rows-only batch with no prose rows may legitimately leave core-descriptions.json
   * untouched — say so in the printed plan. Keep refusing when core.json changed but the overlay did not,
   * or vice versa."
   *
   * The pair half of that invariant is the test above ('do not move together'), which now trips on the
   * overlay/core.json pair alone. These two pin the prose half in both directions. `resilient` again:
   * batch 030 is rows-only, and the old triple rule refused it for a file it had no reason to touch.
   */
  // batch 030: resilient
  it('does NOT refuse a rows-only batch (resilient) that leaves core-descriptions.json untouched', () => {
    const root = repo({ 'public/core-descriptions.json': '{"at":"HEAD"}\n' });
    // batch 030: resilient
    const r = commit(root, '--batch', '900', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).toContain('no prose rows in this batch; public/core-descriptions.json unchanged is expected');
    rmSync(root, { recursive: true, force: true });
  });

  // batch 030: resilient — the other direction: prose in the manifest still demands the overlay artefact
  it('REFUSES a description row (resilient lane) while core-descriptions.json is untouched', () => {
    const root = repo({
      'public/core-descriptions.json': '{"at":"HEAD"}\n',
      'work/.b900-rows-items.json': JSON.stringify({
        findings: [{ id: 'alpha', backfillRows: [{ category: 'feats', id: 'alpha', field: 'description', value: 'the printed text' }] }],
      }),
    });
    // batch 030: resilient
    const r = commit(root, '--batch', '900');
    expect(r.code).toBe(1);
    expect(r.out).toContain('carry prose');
    // batch 030: resilient
    expect(r.out).toContain('public/core-descriptions.json did not change');
    expect(git(root, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
    rmSync(root, { recursive: true, force: true });
  });

  /*
   * ORCHESTRATOR RULING (2026-09-08): "a batch is judged ONLY against what changed since its own start."
   * A separate effort left ~208 modified tracked paths in the real tree and this guard refused every batch
   * over work that was never the batch's. The driver's baseline stage records the porcelain list at the
   * start; a path already dirty then is LEFT ALONE and printed, a path dirtied since is still a refusal.
   */
  const startState = (...paths: string[]) => ({
    'work/.b900-baseline/start-state.json': JSON.stringify({ batch: '900', dirtyAtStart: paths, verifyFailingAtStart: [] }),
  });

  it('leaves alone a path another effort had already dirtied before the batch started', () => {
    const root = repo({
      'work/unrelated-notes.json': '{"someone else":"was mid-flight when this batch was cut"}\n',
      ...startState('work/unrelated-notes.json'),
    });
    const r = commit(root, '--batch', '900', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).toContain('left alone (dirty before this batch started): work/unrelated-notes.json');
    expect(r.out).not.toContain('does not account for');
    // left alone means LEFT ALONE: the would-stage plan lists paths as "<xy> <path>", and this is not one
    expect(r.out).not.toContain('M work/unrelated-notes.json');
    rmSync(root, { recursive: true, force: true });
  });

  it('still REFUSES a path that became dirty AFTER the batch started', () => {
    const root = repo({
      'work/unrelated-notes.json': '{"edited":"during the batch"}\n',
      ...startState('src/rules/build.ts'),          // a different path was the pre-existing one
    });
    const r = commit(root, '--batch', '900');
    expect(r.code).toBe(1);
    expect(r.out).toContain('dirtied since it started');
    expect(r.out).toContain('work/unrelated-notes.json');
    expect(git(root, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
    rmSync(root, { recursive: true, force: true });
  });

  it('stages the three data artefacts even when they were dirty at the start, and says so', () => {
    const root = repo(startState(...['scripts/data/effect-backfill.json', 'public/core.json', 'public/core-descriptions.json']));
    const r = commit(root, '--batch', '900', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).toContain('the three data artefacts always move together, dirty at start or not');
    for (const f of ['scripts/data/effect-backfill.json', 'public/core.json']) expect(r.out).toMatch(new RegExp(`would stage:[\\s\\S]*${f.replace(/[./]/g, '\\$&')}`));
    rmSync(root, { recursive: true, force: true });
  });

  /*
   * THE 2026-09-11 INCIDENT. A pipeline agent ran this script mid-batch: f1da70a landed with two gates
   * still red and without the batch's parity/residual artefacts. Every agent prompt already forbade git
   * writes and the agent had read it, so the guard had to stop being a sentence: the commit now needs
   * HH_ORCHESTRATOR=1, which only the orchestrator's own shell sets (no prompt names it, no script here
   * sets it). Reading the plan is not committing, so --dry-run stays open.
   */
  it('REFUSES to commit without HH_ORCHESTRATOR=1, staging nothing', () => {
    const root = repo();
    const r = run(root, ['--batch', '900'], false);
    expect(r.code).toBe(2);
    expect(r.out).toContain('HH_ORCHESTRATOR');
    expect(r.out).toContain('2026-09-11');
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(root, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
    rmSync(root, { recursive: true, force: true });
  });

  it('--dry-run plans without HH_ORCHESTRATOR — it is read-only', () => {
    const root = repo();
    const r = run(root, ['--batch', '900', '--dry-run'], false);
    expect(r.code).toBe(0);
    expect(r.out).toContain('would stage:');
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('');
    rmSync(root, { recursive: true, force: true });
  });

  /*
   * The same incident's second half: `git status` compares the working tree with HEAD, and the mid-batch
   * commit had already put the batch's prose INTO HEAD — so the prose rule ("specs carry prose but
   * core-descriptions.json did not change") refused the close-out commit over a file the batch HAD
   * changed. Every change-since test now measures from the batch-start commit in work/.bNNN-cut.json.
   */
  it('measures "did core-descriptions.json change" against the batch START, not HEAD', () => {
    const root = repo({
      'work/.b900-rows-items.json': JSON.stringify({
        findings: [{ id: 'alpha', backfillRows: [{ category: 'feats', id: 'alpha', field: 'description', value: 'the printed text' }] }],
      }),
    });
    const startSha = git(root, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(root, 'work/.b900-cut.json'), JSON.stringify({ batch: '900', startSha }));
    git(root, 'add', '--', 'public/core-descriptions.json');
    git(root, 'commit', '-qm', 'the mid-batch commit: HEAD now carries this batch prose');
    expect(git(root, 'status', '--porcelain')).not.toContain('public/core-descriptions.json');

    const r = commit(root, '--batch', '900', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('carry prose');
    expect(r.out).toContain(`batch-start commit ${startSha.slice(0, 8)}`);
    rmSync(root, { recursive: true, force: true });
  });

  /* The other half of that rule, and the one that fails SILENTLY if anyone loosens the catch: with an
   * unreachable start commit the script cannot answer "did this batch change core-descriptions.json"
   * at all, and falling back to the working tree would be the exact pre-2026-09-11 behaviour wearing
   * the new code's clothes. It must refuse and name the sha instead. */
  it('REFUSES when the recorded batch-start commit is not in this repo', () => {
    const root = repo({ 'work/.b900-cut.json': JSON.stringify({ batch: '900', startSha: 'dead0000beef1111dead0000beef1111dead0000' }) });
    const r = commit(root, '--batch', '900', '--dry-run');
    expect(r.code).toBe(1);
    expect(r.out).toContain('dead0000beef');
    expect(r.out).toContain('cannot be answered');
    rmSync(root, { recursive: true, force: true });
  });

  /*
   * THE OPEN MARKER — the tripwire that does not depend on anyone reading a prompt. The driver's cut
   * stage writes work/.bNNN-open; while it exists the batch is open, so the driver's baseline and close
   * stages print a loud MID-BATCH COMMIT line whenever HEAD has moved off the cut. This script is the
   * only thing that removes it, and only after the commit it guards actually landed.
   */
  it('removes the open marker only after a successful commit', () => {
    const root = repo({ 'work/.b900-open': 'batch 900 is open until it is committed\n' });
    const marker = join(root, 'work/.b900-open');
    expect(commit(root, '--batch', '900', '--dry-run').code).toBe(0);
    expect(existsSync(marker)).toBe(true);                        // a plan removes nothing
    expect(run(root, ['--batch', '900'], false).code).toBe(2);
    expect(existsSync(marker)).toBe(true);                        // a refusal removes nothing
    expect(commit(root, '--batch', '900').code).toBe(0);
    expect(existsSync(marker)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  /* The marker's other half is in the driver, which cannot cut a batch against a fixture repo (the cut
   * stage reads the real mirror and the real eligible list). Pinned across the file boundary instead:
   * delete the write and this test names the contract that broke. */
  it('the driver cut stage writes the open marker this script removes', () => {
    expect(readFileSync(join(__dirname, '..', 'scripts/wg-batch-run.mjs'), 'utf8')).toMatch(/write\(P\('open'\)/);
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
