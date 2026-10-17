import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
import { liveSnapshots, spentRows } from '../scripts/lib/refresh-loss-scope.mjs';

/**
 * scripts/refresh-loss-check.mjs (npm run verify): the `before` and `inPlace` qualifiers on an allow row.
 *
 * 2026-09-30, the regenerating lane's refuter: the lane's rows `classes/wizard subclass.options` … said "changed IN
 * PLACE, no option lost", but a row matched on record + field alone, so each would have excused a later
 * regeneration that really dropped a school. Now such a row names its before-snapshot (`before`: the sha256
 * prefix of the before core.json) and has its claim measured (`inPlace`: every member called lost is still there
 * under its id and lost nothing inside). Throwaway before/after corpora; the real allow-list is not read.
 */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });

const ROOT = path.join(__dirname, '..');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const LONG = 'Your school grants Chain Lightning, a spell that arcs between foes.';
const schools = (a: string, withB = true) => ({
  classes: { wizard: { id: 'wizard', name: 'Wizard', subclass: { options: [{ id: 'a', description: a }, ...(withB ? [{ id: 'b', description: 'B' }] : [])] } } },
});

function run(before: object, after: object, rows: (sha: string) => object[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'refresh-loss-'));
  dirs.push(dir);
  const b = path.join(dir, 'before-core.json');
  writeFileSync(b, JSON.stringify(before));
  writeFileSync(path.join(dir, 'before-desc.json'), '{}');
  writeFileSync(path.join(dir, 'after-core.json'), JSON.stringify(after));
  writeFileSync(path.join(dir, 'after-desc.json'), '{}');
  const sha = createHash('sha256').update(readFileSync(b)).digest('hex');
  writeFileSync(path.join(dir, 'allow.json'), JSON.stringify(rows(sha)));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/refresh-loss-check.mjs'), b, path.join(dir, 'before-desc.json')], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, CORE_JSON: path.join(dir, 'after-core.json'), CORE_DESCRIPTIONS_JSON: path.join(dir, 'after-desc.json'), REFRESH_LOSS_ALLOW: path.join(dir, 'allow.json') },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const row = (extra: object) => ({ key: 'classes/wizard', field: 'subclass.options', aon: 'class-39', why: 'fixture', ...extra });

describe('refresh-loss-check: a row scoped to one snapshot, its in-place claim measured', () => {
  it('an in-place change (a text that grew) is allowed by a scoped inPlace row', () => {
    const r = run(schools('Chain Lightning,'), schools(LONG), (sha) => [row({ before: sha.slice(0, 16), inPlace: true })]);
    expect(r.out).toContain('ALLOWED (1)');
    expect(r.code).toBe(0);
  });

  it('a dropped school is NOT excused by the same row — the case the refuter named', () => {
    const r = run(schools('Chain Lightning,'), schools(LONG, false), (sha) => [row({ before: sha.slice(0, 16), inPlace: true })]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('subclass.options[id=b] is gone');
  });

  it('a member text shorter by more than TEXT_SLACK is NOT excused by an inPlace row', () => {
    const r = run(schools(LONG), schools('Chain Lightning,'), (sha) => [row({ before: sha.slice(0, 16), inPlace: true })]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/subclass\.options\[id=a\]\.description shrank \d+ -> \d+ chars/);
  });

  it('a row scoped to ANOTHER snapshot excuses nothing and is listed as SCOPED ELSEWHERE', () => {
    const r = run(schools('Chain Lightning,'), schools(LONG), () => [row({ before: '0123456789abcdef', inPlace: true })]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('SCOPED ELSEWHERE (1)');
  });

  it('an unscoped, unqualified row behaves as before (record + field)', () => {
    const r = run(schools('Chain Lightning,'), schools(LONG, false), () => [row({})]);
    expect(r.code).toBe(0);
  });

  it('refuses a malformed qualifier', () => {
    expect(run(schools('x'), schools('x'), () => [row({ before: 'not-hex' })]).code).toBe(1);
    expect(run(schools('x'), schools('x'), () => [row({ inPlace: 'yes' })]).code).toBe(1);
  });

  /* This case used to read the real allow-list and expect the 2026-09-30 regenerating lane's rows scoped to
   * 7562a5e3058b935e. That lane was committed in 17f42d0, so those rows were spent — and nothing ever deleted
   * them (76 spent rows by 2026-10-17). Package I made a spent row fatal; the cases below pin that rule. */
});

describe('refresh-loss-check: a spent scoped row fails the run against git HEAD (package I, 2026-10-17)', () => {
  const rows = [
    { key: 'a', before: 'aaaaaaaaaaaa' }, { key: 'b', before: 'bbbbbbbbbbbb' }, { key: 'c', before: 'cccccccccccc' }, { key: 'd' },
  ];
  const sha = (c: string) => c.repeat(64);

  it('with no lane in progress, rows scoped to HEAD\'s or the previous core.json stay; others are spent; unscoped rows never are', () => {
    const live = liveSnapshots({ headSha: sha('a'), prevSha: sha('b'), workingSha: sha('a') });
    expect(spentRows(rows, live).map((r) => r.key)).toEqual(['c']);
  });

  it('inside a lane (working core.json is not HEAD\'s), only rows scoped to HEAD\'s core.json stay', () => {
    const live = liveSnapshots({ headSha: sha('a'), prevSha: sha('b'), workingSha: sha('e') });
    expect(spentRows(rows, live).map((r) => r.key)).toEqual(['b', 'c']);
  });

  it('no row in the real scripts/data/refresh-loss-allow.json is spent against today\'s HEAD', () => {
    const real = JSON.parse(readFileSync(path.join(ROOT, 'scripts/data/refresh-loss-allow.json'), 'utf8')) as { key: string; before?: string }[];
    const git = (args: string[]) => spawnSync('git', args, { cwd: ROOT, maxBuffer: 1 << 30 }).stdout as Buffer;
    const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    const [, prev] = git(['log', '-2', '--format=%H', '--', 'public/core.json']).toString().trim().split(/\s+/);
    const live = liveSnapshots({
      headSha: hash(git(['show', 'HEAD:public/core.json'])),
      prevSha: prev ? hash(git(['show', `${prev}:public/core.json`])) : null,
      workingSha: hash(readFileSync(path.join(ROOT, 'public/core.json'))),
    });
    expect(spentRows(real, live).map((r) => `${r.key} ${r.before}`)).toEqual([]);
  });
});
