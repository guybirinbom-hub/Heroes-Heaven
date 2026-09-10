/*
 * BATCH 036, GATE-RED — the pipeline's own collation defects.
 *
 * Three defects, all of them found by the closer AFTER the batch's gaps had already been
 * hand-transcribed, which is the failure mode this file exists to end: a transcription fixes one
 * batch, a guard fixes every batch.
 *
 *   1. scripts/wg-batch-run.mjs gapLines() only knew `-` / `*` / `•` / `1.` bullets, so the LETTERED
 *      CROSS-FILE GAPS of work/.b036-verify-engine.txt ("A." / "A′" / "B." / "C." / "D." / "E.")
 *      matched nothing and the run broke on the section's first line — five real lanes reached
 *      work/.b036-gaps.json as nothing at all.
 *   2. The same function harvested an ASCII RULE as a gap: work/wg-batch-036-residual.json's
 *      flaggedResidue #3 is the divider closing CROSS-FILE GAPS in work/.b036-report-situational.txt,
 *      and the same artefact was parked twice before that in work/.b030-gaps.json (lines 56 and 63).
 *   3. scripts/wg-batch-close.mjs keyed a flaggedResidue on `g.ref ?? g.family`, and `ref` is a
 *      `<file>:<line>` pointer — so ANY edit to a report file shifted the key and the residual merge
 *      appended a duplicate instead of matching ("4 new entr(y/ies) appended, 6 kept").
 *
 * These are driver-file fixes with no record and no printed clause behind them, so they are pinned
 * here rather than in test/wg-batch-run.test.ts / test/wg-batch-close.test.ts: an added assertion in
 * an existing test file must carry a `// batch 036: <finding id>` citation naming a CONFIRMED finding
 * (scripts/test-flip-audit.mjs), and no finding in work/.b036-read.json covers the pipeline itself.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* The closer case runs a real node child — see test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gapLines } from '../scripts/wg-batch-run.mjs';

const ROOT = join(__dirname, '..');

describe('gapLines collates a lettered, hard-wrapped, rule-separated gap list (batch 036 defects 1 and 2)', () => {
  /* The exact shape of work/.b036-verify-engine.txt:167-198 — a heading, a `====` rule under it,
   * lettered items wrapped over indented continuations, and a prime-lettered widening. */
  const REPORT = [
    'CROSS-FILE GAPS  (corrected — 5 lines; A is WIDER than the builder wrote, E is mine)',
    '======================================================================================',
    'A. src/rules/situationalBonuses.ts:1411 — the "hyper-boosters" star repeats a number',
    '   that is now on the sheet and should be trimmed to the LEGENDARY branch only.',
    'A′ (WIDENING, mine). The sibling star at situationalBonuses.ts:1457 becomes WRONG for',
    '   the same character, not merely redundant.',
    'B. src/sheet/ItemDetail.tsx — no control asks the crafter\'s energy type.',
    '',
    'MANIFEST STAGE[] — PATHS I TOUCHED',
  ].join('\n');

  it('a lettered bullet is a bullet, and its indented continuations fold into it', () => {
    const g = gapLines(REPORT, 'work/.b900-verify-engine.txt');
    expect(g.map((x) => x.kind)).toEqual(['CROSS-FILE GAPS', 'CROSS-FILE GAPS', 'CROSS-FILE GAPS']);
    // the letter and its punctuation are stripped, exactly as `- ` is
    expect(g[0].line).toContain('situationalBonuses.ts:1411');
    expect(g[0].line).not.toMatch(/^A[.)]/);
    // the wrapped second line is part of the SAME gap, not a truncation and not a fourth line
    expect(g[0].line).toContain('trimmed to the LEGENDARY branch only');
    expect(g[1].line).toContain('(WIDENING, mine)');
    expect(g[1].line).toContain('not merely redundant');
    expect(g[2].line).toContain('ItemDetail.tsx');
    // the ref still points at the line the item OPENS on
    expect(g[0].ref).toBe('work/.b900-verify-engine.txt:3');
  });

  it('an ASCII rule is skipped, not harvested and not treated as the end of the run', () => {
    // the `====` rule sits between the heading and item A: before the fix it ended the run outright
    expect(gapLines(REPORT, 'f.txt')).toHaveLength(3);
    const withDivider = [
      'DATA STILL NEEDED',
      '- items / composer-staff / passiveEffects / null — the base staff prints the same clause.',
      '---------------------------------------------------------------------',
      'PER FINDING',
      '',
      '[1] cultivators-keen-eye#materials — TAUGHT',
    ].join('\n');
    const g = gapLines(withDivider, 'work/.b900-report-situational.txt');
    expect(g).toHaveLength(1);
    expect(g[0].line).toContain('composer-staff');
    expect(g.some((x) => /^[-–—=_•*\s]+$/.test(x.line))).toBe(false);
  });

  it('still reads the plain forms, still drops "(none)", still stops at prose', () => {
    const g = gapLines(['CROSS-FILE GAPS', '- (none)', '* a starred gap', '1. a numbered gap', 'a closing paragraph that is not a bullet', '- never reached'].join('\n'), 'f.txt');
    expect(g.map((x) => x.line)).toEqual(['a starred gap', 'a numbered gap']);
  });
});

describe('wg-batch-close keys a flaggedResidue on content, so re-closing does not duplicate it (batch 036 defect 3)', () => {
  it('the same gap with a shifted file:line ref merges instead of appending', () => {
    const root = mkdtempSync(join(tmpdir(), 'wg-close-residue-'));
    mkdirSync(join(root, 'work'), { recursive: true });
    const LINE = 'GrantedStrike has no proficiency carrier — residue, not fixable by data';
    const write = (rel: string, body: unknown) => writeFileSync(join(root, rel), JSON.stringify(body, null, 1));
    write('work/wg-batch-900.json', [{ bucket: 'items', id: 'alpha', name: 'Alpha', level: 7 }]);
    write('work/.b900-read.json', {
      confirmed: [{ id: 'alpha#one', claim: 'alpha drops the printed burst size', playerVisible: true, verdict: 'CONFIRMED', proposal: 'restore the text' }],
      refuted: [], askOwner: [],
    });
    write('work/.b900-specs.json', [{ file: 'work/.b900-rows-items.json', kind: 'rows', family: 'items', stage: ['work/.b900-rows-items.json'] }]);
    write('work/.b900-rows-items.json', { findings: [{ id: 'alpha#one', backfillRows: [{ category: 'items', id: 'alpha', field: 'description', value: 'restored', why: 'AoN equipment-1' }], note: '' }] });
    const gap = (ref: string) => [{ family: 'items', kind: 'CROSS-FILE GAPS', line: LINE, status: 'parked', ref }];

    const close = () => execFileSync(process.execPath, [join(ROOT, 'scripts/wg-batch-close.mjs'), '--root', root, '--batch', '900', '--write'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const residues = () => JSON.parse(readFileSync(join(root, 'work/wg-batch-900-residual.json'), 'utf8')).flaggedResidues;

    write('work/.b900-gaps.json', gap('work/.b900-report-items.txt:12'));
    close();
    expect(residues()).toHaveLength(1);

    // a builder appends a paragraph above the gap: same gap, ref three lines lower
    write('work/.b900-gaps.json', gap('work/.b900-report-items.txt:15'));
    const out = close();
    expect(residues()).toHaveLength(1);
    expect(out).not.toContain('residual.flaggedResidues: 1 new entr');

    // a genuinely different gap in the same family still appends
    write('work/.b900-gaps.json', [...gap('work/.b900-report-items.txt:15'), { family: 'items', kind: 'CROSS-FILE GAPS', line: 'a second, different lane', status: 'parked', ref: 'work/.b900-report-items.txt:20' }]);
    close();
    expect(residues()).toHaveLength(2);

    rmSync(root, { recursive: true, force: true });
  });
});
