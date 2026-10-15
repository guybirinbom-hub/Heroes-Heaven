import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';

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

  it('the lane\'s own rows are scoped to the snapshot they explain (a787fb0\'s core.json) and all but one measured in place', () => {
    const rows = JSON.parse(readFileSync(path.join(ROOT, 'scripts/data/refresh-loss-allow.json'), 'utf8')) as { key: string; why: string; before?: string; inPlace?: boolean }[];
    const lane = rows.filter((r) => r.why.startsWith('2026-09-30, the regenerating lane'));
    expect(lane.length).toBeGreaterThanOrEqual(10);
    for (const r of lane) expect(r.before, r.key).toBe('7562a5e3058b935e');
    // classes/summoner is scoped only: angel-eidolon's remastered wording is 16 characters shorter (its whyNotInPlace)
    expect(lane.filter((r) => !r.inPlace).map((r) => r.key)).toEqual(['classes/summoner']);
  });
});
