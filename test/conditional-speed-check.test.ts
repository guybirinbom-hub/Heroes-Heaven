import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CHILD_TIMEOUT } from './_timeouts';

vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });

/**
 * scripts/conditional-speed-check.mjs — a Speed is a real number only when it is ALWAYS on (ruling #126,
 * 2026-08-22: "we give an actual speed only when it's always, if it is dependent on something ist in a *").
 *
 * Its GATE pattern missed "only when": Rope Runner (feat-6380) prints "You gain a climb Speed of 15 feet, but
 * only when climbing ropes and similar objects." and carried a standing `speeds.climb 15` the check never
 * flagged — the lost-condition check found it (2026-10-17), and desk #177 ('Yes, stars on (Recommended)')
 * retired the number. The alternation now names "only when". Run for real in a child process against a
 * scratch copy of core.json with the old number planted back, and against a scratch copy of the check with
 * the new alternative taken out — never the tree.
 */
const ROOT = resolve(__dirname, '..');
const CHECK = join(ROOT, 'scripts/conditional-speed-check.mjs');
const DESCS = join(ROOT, 'public/core-descriptions.json');
const ONLY_WHEN = '|only when|';

let dir = '';
let planted = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cond-speed-'));
  const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;
  core.feats['rope-runner'].speeds = { climb: 15 };
  planted = join(dir, 'core.json');
  writeFileSync(planted, JSON.stringify(core));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const run = (script: string, core?: string) => {
  const env = { ...process.env, CORE_DESCRIPTIONS_JSON: DESCS, ...(core ? { CORE_JSON: core } : {}) };
  const r = spawnSync(process.execPath, [script], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 1 << 26 });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
};

describe('conditional-speed-check', () => {
  it('green on the tree: Rope Runner carries no standing climb Speed (desk #177)', () => {
    const r = run(CHECK);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('conditional-speed: ok');
  });

  // batch package-m premise: feat-6380 "You gain a climb Speed of 15 feet, but only when climbing ropes and similar objects."
  it('planted: the old climb 15 back on Rope Runner FAILS — "only when climbing" gates the grant', () => {
    const r = run(CHECK, planted);
    expect(r.status).toBe(1);
    expect(r.out).toContain('feats/rope-runner');
    expect(r.out).toContain('but only when climbing ropes and similar objects');
  });

  it('planted script: without the "only when" alternative the same record passes — the alternative is what catches it', () => {
    const src = readFileSync(CHECK, 'utf8');
    expect(src.split(ONLY_WHEN).length - 1, 'the alternative appears once in GATE').toBe(1);
    const mutant = join(dir, 'conditional-speed-check.mjs');
    writeFileSync(mutant, src.replace(ONLY_WHEN, '|'));
    const r = run(mutant, planted);
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toContain('feats/rope-runner');
  });
});
