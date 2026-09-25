/*
 * A print-lane batch's parity file sits beside its packet: work/print-batch-P02-parity.json, not
 * work/wg-batch-P02-parity.json (scripts/wg-batch-run.mjs, the print cut, 2026-09-25).
 * record-parity-verdict.mjs, record-parity-batch.mjs and parse-parity-out.mjs each hard-coded the WG
 * path, so a verdict for P02 landed in a new file no gate reads. They now route through
 * scripts/lib/batch-paths.mjs, the same rule wg-batch-close.mjs follows.
 */
import { describe, expect, it, afterAll, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { batchFiles } from '../scripts/lib/batch-paths.mjs';

const REPO = join(__dirname, '..');
const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

/** A throwaway root holding record-parity-verdict.mjs + the lib, and the given work/ files. */
function fixture(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'batch-paths-'));
  roots.push(root);
  for (const d of ['scripts/lib', 'work']) mkdirSync(join(root, d), { recursive: true });
  for (const f of ['scripts/record-parity-verdict.mjs', 'scripts/lib/batch-paths.mjs']) copyFileSync(join(REPO, f), join(root, f));
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(root, rel), `${JSON.stringify(body, null, 1)}\n`);
  return root;
}

describe('batchFiles picks the lane the batch was cut in', () => {
  it('the cut record decides; with none, a print packet or print parity file on disk means print', () => {
    const root = fixture({
      'work/.b900-cut.json': { batch: '900', print: true },
      'work/print-batch-P07-parity.json': { batch: 'P07', records: [] },
    });
    expect(batchFiles(root, '900').parity).toBe('work/print-batch-900-parity.json');   // cut record
    expect(batchFiles(root, 'p07')).toMatchObject({ tag: 'P07', batch: 'P07', print: true, parity: 'work/print-batch-P07-parity.json' });
    expect(batchFiles(root, 30)).toMatchObject({ tag: '030', batch: 30, print: false, parity: 'work/wg-batch-030-parity.json' });
  });
});

describe('record-parity-verdict.mjs --bulk writes a print batch beside its packet', () => {
  it('a P09 row updates work/print-batch-P09-parity.json and creates no wg-batch-P09 file', () => {
    const root = fixture({
      'work/.bP09-cut.json': { batch: 'P09', print: true },
      'work/print-batch-P09-parity.json': { batch: 'P09', records: [{ id: 'alpha', verdict: 'OWNER-QUEUED', evidence: 'awaiting his ruling' }] },
      'work/rows.json': [{ batch: 'P09', id: 'alpha', evidence: 'owner ruled 2026-09-25 (#1): keep ours', verdict: 'OWNER-RULED' }],
    });
    const r = spawnSync(process.execPath, [join(root, 'scripts/record-parity-verdict.mjs'), '--bulk', 'work/rows.json', '--write'], { cwd: root, encoding: 'utf8' });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    const doc = JSON.parse(readFileSync(join(root, 'work/print-batch-P09-parity.json'), 'utf8'));
    expect(doc.batch).toBe('P09');
    expect(doc.records).toEqual([{ id: 'alpha', verdict: 'OWNER-RULED', evidence: 'owner ruled 2026-09-25 (#1): keep ours' }]);
    expect(existsSync(join(root, 'work/wg-batch-P09-parity.json'))).toBe(false);
  });
});
