import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Batch 024's residual read happened, but the 2026-09-17 owner-names scrub (74e8a05) deleted its
 * artefact because it named the owner's character, so gate section 7 read it as "never read".
 * The artefact was restored from 74e8a05^ with the names scrubbed. This pins both halves:
 * the gate's contract (examined >= the batch's records, every confirmed finding fixed) and the
 * public-repo rule (no name from the local owner list in the file).
 */
const ROOT = join(__dirname, '..');
const path = join(ROOT, 'work/wg-batch-024-residual.json');

describe('batch 024 residual artefact (restored, names scrubbed)', () => {
  const text = readFileSync(path, 'utf8');
  const r = JSON.parse(text);
  const batch = JSON.parse(readFileSync(join(ROOT, 'work/wg-batch-024.json'), 'utf8'));

  it('satisfies the RESIDUAL gate: every batch record examined, every confirmed finding fixed', () => {
    const ids = new Set((batch as { id: string }[]).map((x) => x.id));
    expect(ids.size).toBe(5);
    expect(r.examined).toBeGreaterThanOrEqual(ids.size);
    expect(r.confirmed).toHaveLength(23);
    expect(r.confirmed.filter((f: { fixed?: boolean }) => !f.fixed)).toEqual([]);
    expect(r.closed).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.provenance).toMatch(/74e8a05\^/);
  });

  it('carries no owner character name, save path or owned-dump file name', () => {
    expect(text).not.toMatch(/[A-Za-z]:\/Inst\/|-owned\.json/);
    const list = join(ROOT, 'work/owner-names.local.txt');
    if (!existsSync(list)) return; // clean clone: the list is local-only by design
    const names = readFileSync(list, 'utf8').split(/\r?\n/)
      .map((l) => l.split(';')[0].trim()).filter((l) => l && !l.startsWith('#'));
    for (const n of names) expect(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)).toBe(false);
  });
});
