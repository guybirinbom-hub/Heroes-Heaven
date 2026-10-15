/*
 * THE PRINT PACKET IS THE CUT (2026-09-25).
 *
 * The first print-lane run, `node scripts/wg-batch-run.mjs --batch P02 --stage cut --print`, ignored the
 * 60-record packet work/print-batch-P02.json (cut by scripts/print-batch.mjs --ids) and instead ran
 * wg-next-batch-ids.mjs --count 40 + wg-batch.mjs, writing 40 unrelated WG-lane ids into
 * work/wg-batch-P02.json; the baseline then covered those 40. Under --print the batch file IS the print
 * packet, and the cut selects nothing.
 *
 * The driver resolves its root from its own location, so each case copies it (and every file it
 * imports) into a throwaway root under the OS temp dir and runs the REAL stage as a node child — never
 * against this repo's work/ files.
 */
import { describe, expect, it, afterAll, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

const REPO = join(__dirname, '..');

/** `start` plus every repo file it reaches through relative `from './…'` / `from '../…'` imports. */
function relativeImportClosure(start: string): string[] {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(join(REPO, f), 'utf8');
    for (const m of src.matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g)) queue.push(posix.normalize(posix.join(posix.dirname(f), m[1])));
  }
  return [...seen];
}
const PACKET = 'work/print-batch-PT1.json';
const CORE = { feats: { alpha: { id: 'alpha', name: 'Alpha' } }, spells: { beta: { id: 'beta', name: 'Beta' } } };
const RECORDS = [
  { bucket: 'feats', id: 'alpha', name: 'Alpha', level: 1, aonId: 'feat-1', printed: 'x', ourDescription: '', ourFields: {} },
  { bucket: 'spells', id: 'beta', name: 'Beta', level: 1, aonId: 'spell-2', printed: 'y', ourDescription: '', ourFields: {} },
];

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

/** A root holding the driver, its two libs, a stub field-catalogue script and a two-record core.json. */
function fixture(packet: unknown | null): string {
  const root = mkdtempSync(join(tmpdir(), 'wg-print-cut-'));
  roots.push(root);
  for (const d of ['scripts/lib', 'public', 'work']) mkdirSync(join(root, d), { recursive: true });
  /* The driver and every file it imports, followed through relative imports. A hand list
   * (driver + heavy-lock + apply-backfill) went red when b21041c made the driver import
   * add-owner-question.mjs, which imports lib/batch-paths.mjs: the copy died on ERR_MODULE_NOT_FOUND. */
  for (const f of relativeImportClosure('scripts/wg-batch-run.mjs')) {
    mkdirSync(join(root, dirname(f)), { recursive: true });
    copyFileSync(join(REPO, f), join(root, f));
  }
  writeFileSync(join(root, 'scripts/wg-field-catalogue.mjs'),
    "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[process.argv.indexOf('--json') + 1], '{}\\n');\n");
  writeFileSync(join(root, 'public/core.json'), JSON.stringify(CORE));
  if (packet !== null) writeFileSync(join(root, PACKET), JSON.stringify(packet, null, 1));
  return root;
}

function drive(root: string, ...args: string[]) {
  const env = { ...process.env, HEAVY_LOCK_PATH: join(root, 'work/.heavy.lock'), GIT_CEILING_DIRECTORIES: tmpdir() };
  const r = spawnSync(process.execPath, [join(root, 'scripts/wg-batch-run.mjs'), '--batch', 'PT1', ...args], { cwd: root, encoding: 'utf8', env });
  const runs = existsSync(join(root, 'work/.bPT1-run.json')) ? JSON.parse(readFileSync(join(root, 'work/.bPT1-run.json'), 'utf8')) : [];
  const last = runs[runs.length - 1] ?? {};
  return { status: r.status, digest: String(last.digest ?? ''), refusals: (last.refusals ?? []).join(' ') };
}
const cutJson = (root: string) => JSON.parse(readFileSync(join(root, 'work/.bPT1-cut.json'), 'utf8'));

describe('--stage cut --print pins the print packet and selects nothing', () => {
  it('packet present: cut.json ids are the packet\'s, batchSha is the packet\'s sha, and no WG packet is cut', () => {
    const root = fixture(RECORDS);
    const r = drive(root, '--stage', 'cut', '--print');
    expect(r.status, r.digest).toBe(0);
    const cut = cutJson(root);
    expect(cut.print).toBe(true);
    expect(cut.ids).toEqual(['alpha', 'beta']);
    expect(cut.batchSha).toBe(createHash('sha256').update(readFileSync(join(root, PACKET))).digest('hex'));
    expect(cut.predicate).toEqual({ print: true, packet: PACKET });
    expect(existsSync(join(root, 'work/.bPT1-open'))).toBe(true);
    expect(existsSync(join(root, 'work/print-batch-PT1-catalogue.json'))).toBe(true);   // beside the packet
    expect(existsSync(join(root, 'work/wg-batch-PT1.json'))).toBe(false);             // the P02 incident
    expect(r.digest).toContain(`cut 2 packet(s) from ${PACKET}`);

    // the packet exists by design, so a second cut is refused on the cut RECORD unless --recut
    expect(drive(root, '--stage', 'cut', '--print').refusals).toContain('pass --recut');
    // and a stage run in the other lane refuses rather than reading work/wg-batch-PT1.json
    expect(drive(root, '--stage', 'baseline').refusals).toContain('WITH --print');
  });

  it('packet missing: refuses, naming scripts/print-batch.mjs, and pins nothing', () => {
    const root = fixture(null);
    const r = drive(root, '--stage', 'cut', '--print');
    expect(r.status).toBe(1);
    expect(r.refusals).toContain(`no ${PACKET}`);
    expect(r.refusals).toContain('node scripts/print-batch.mjs --ids');
    expect(existsSync(join(root, 'work/.bPT1-cut.json'))).toBe(false);
  });

  it('--count (or --ids / --max-level) under --print: refuses, the packet is the cut', () => {
    const root = fixture(RECORDS);
    const r = drive(root, '--stage', 'cut', '--print', '--count', '40');
    expect(r.status).toBe(1);
    expect(r.refusals).toContain('--count under --print');
    expect(r.refusals).toContain('scripts/print-batch.mjs');
    expect(existsSync(join(root, 'work/.bPT1-cut.json'))).toBe(false);
    expect(drive(root, '--stage', 'cut', '--print', '--ids', 'alpha').refusals).toContain('--ids under --print');
  });

  it('a packet record that names no core.json record: refuses, naming it', () => {
    const root = fixture([...RECORDS, { bucket: 'feats', id: 'ghost', name: 'Ghost' }]);
    const r = drive(root, '--stage', 'cut', '--print');
    expect(r.status).toBe(1);
    expect(r.refusals).toContain('name no public/core.json record: feats/ghost');
    expect(existsSync(join(root, 'work/.bPT1-cut.json'))).toBe(false);
  });

  it('one bare id in two buckets: refuses — every later stage keys a record on its bare id', () => {
    const core = { ...CORE, spells: { ...CORE.spells, alpha: { id: 'alpha', name: 'Alpha (spell)' } } };
    const root = fixture([...RECORDS, { bucket: 'spells', id: 'alpha', name: 'Alpha (spell)' }]);
    writeFileSync(join(root, 'public/core.json'), JSON.stringify(core));
    const r = drive(root, '--stage', 'cut', '--print');
    expect(r.status).toBe(1);
    expect(r.refusals).toContain('appear in more than one record');
    expect(r.refusals).toContain('alpha');
  });
});
