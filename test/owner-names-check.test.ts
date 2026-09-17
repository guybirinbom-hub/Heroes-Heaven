/*
 * scripts/owner-names-check.mjs — the guard that keeps the owner's own characters out of this
 * PUBLIC repo. It reads a local, untracked list of forbidden names and greps every tracked file
 * for them.
 *
 * This never touches the real list (work/owner-names.local.txt) or a real character name: the
 * script takes HH_OWNER_NAMES / HH_OWNER_FILES env overrides for exactly this reason, so the test
 * can point it at two throwaway scratch files with a made-up name instead of a real one.
 */
import { describe, expect, it } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/owner-names-check.mjs');

const FORBIDDEN = 'Zorblax Quintrell'; // made up — never a real owner character

type Result = { status: number; stdout: string; stderr: string };

/**
 * Runs the guard in a scratch dir with both env overrides set, so it never touches the real local
 * list or `git ls-files`. `namesText` omitted means the names file is left absent (the "no local
 * list" case); `scanFiles` is the set of scratch files to hand it as the file list.
 */
function run(namesText: string | undefined, scanFiles: string[]): Result {
  const dir = mkdtempSync(join(tmpdir(), 'owner-names-check-'));
  const filesList = join(dir, 'files.txt');
  writeFileSync(filesList, scanFiles.join('\n') + '\n');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HH_OWNER_FILES: filesList,
    HH_OWNER_NAMES: join(dir, namesText === undefined ? 'names-that-do-not-exist.txt' : 'names.txt'),
  };
  if (namesText !== undefined) writeFileSync(env.HH_OWNER_NAMES!, namesText);
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8', env });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { status: err.status, stdout: err.stdout, stderr: err.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes `content` to a fresh scratch file and returns its path. */
function scratchFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'owner-names-check-src-'));
  const p = join(dir, 'sample.txt');
  writeFileSync(p, content);
  return p;
}

describe('owner-names-check', () => {
  it('no local list: prints the skip line and exits 0', () => {
    const r = run(undefined, []);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('owner-names-check: no local list, skipped');
  }, CHILD_TIMEOUT);

  it('a forbidden name in a scanned file: exits 1 and reports path:line', () => {
    const dirty = scratchFile(`line one\nthe character ${FORBIDDEN} wields a warhammer\nline three\n`);
    const r = run(FORBIDDEN + '\n', [dirty]);
    try {
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`${dirty}:2: ${FORBIDDEN}`);
    } finally {
      rmSync(dirty, { force: true });
    }
  }, CHILD_TIMEOUT);

  it('a clean file: exits 0 and reports clean', () => {
    const clean = scratchFile('nothing forbidden in here at all\n');
    const r = run(FORBIDDEN + '\n', [clean]);
    try {
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('checked, clean');
    } finally {
      rmSync(clean, { force: true });
    }
  }, CHILD_TIMEOUT);

  it('an allow-listed context does not count as a hit, but the bare name still does', () => {
    // "Quintrell" alone, allow-listed inside a compound term it has nothing to do with.
    const mixed = scratchFile('a totally-unrelated-quintrell-widget lives here\nQuintrell shows up bare here\n');
    const r = run('Quintrell ; allow: totally-unrelated-quintrell-widget\n', [mixed]);
    try {
      expect(r.status).toBe(1);
      expect(r.stderr).not.toContain(`${mixed}:1:`);
      expect(r.stderr).toContain(`${mixed}:2: Quintrell`);
    } finally {
      rmSync(mixed, { force: true });
    }
  }, CHILD_TIMEOUT);

  it('a name scoped to `paths: test/` is not reported under public/, but is under test/', () => {
    // Real repo-relative paths, so the prefix match is against exactly what git ls-files would hand
    // the script — a made-up name that also happens to be an ordinary word would never be clean
    // under public/ (game data), which is the whole reason `paths:` exists.
    const tag = `${process.pid}-${Math.random().toString(36).slice(2)}`;
    const inScopeRel = `test/.owner-names-check-scope-${tag}.txt`;
    const outScopeRel = `public/.owner-names-check-scope-${tag}.txt`;
    const inScopeAbs = join(ROOT, inScopeRel);
    const outScopeAbs = join(ROOT, outScopeRel);
    writeFileSync(inScopeAbs, 'Quazzlefen shows up here\n');
    writeFileSync(outScopeAbs, 'Quazzlefen shows up here too, but out of scope\n');
    try {
      const r = run('Quazzlefen ; paths: test/\n', [inScopeRel, outScopeRel]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`${inScopeRel}:1: Quazzlefen`);
      expect(r.stderr).not.toContain(outScopeRel);
    } finally {
      rmSync(inScopeAbs, { force: true });
      rmSync(outScopeAbs, { force: true });
    }
  }, CHILD_TIMEOUT);
});
