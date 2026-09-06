/*
 * The closer is the step that turns a batch's reading into the record of what this project believes.
 * Every parity artefact downstream (the gate, the re-gate, the residue list the owner is shown) trusts
 * `work/wg-batch-NNN-parity.json` completely, and until now it was written by a scratchpad script that
 * decided FIXED-vs-MATCHES by sniffing the word "instrument" in a finding's prose.
 *
 * So the properties that make `scripts/wg-batch-close.mjs` safe are asserted here, not assumed:
 *
 *   1. A verdict is a claim about EVIDENCE ON DISK. FIXED needs a cited overlay row / staged code edit
 *      / staged test; MATCHES needs "no finding" or an instrument teach; OWNER-QUEUED needs the desk n.
 *      A finding with none of those REFUSES and names the id — the guard, not a sentence in a report.
 *   2. The merge is one-way. An existing verdict is never dropped and never overwritten, and a derived
 *      verdict that contradicts one stops the batch with both values printed.
 *   3. Re-closing the CLOSED batch 029 changes nothing. That is the plan's own rollout acceptance
 *      (docs/wg-batch-pipeline.md section E.1) pinned as a test rather than performed by hand once.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/wg-batch-close.mjs');

type Run = { code: number; out: string };
function close(root: string, ...args: string[]): Run {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** A throwaway batch 900: three records, one finding each on alpha and beta, nothing on gamma. */
function fixture(over: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'wg-close-'));
  mkdirSync(join(root, 'work'), { recursive: true });
  mkdirSync(join(root, 'test'), { recursive: true });
  const files: Record<string, unknown> = {
    'work/wg-batch-900.json': [
      { bucket: 'items', id: 'alpha', name: 'Alpha', level: 7 },
      { bucket: 'items', id: 'beta', name: 'Beta', level: 7 },
      { bucket: 'items', id: 'gamma', name: 'Gamma', level: 7 },
    ],
    'work/.b900-read.json': {
      confirmed: [
        { id: 'alpha#one', claim: 'alpha drops the printed burst size', playerVisible: true, verdict: 'CONFIRMED', proposal: 'restore the text' },
        { id: 'beta#two', claim: 'the comparer misread beta', playerVisible: false, verdict: 'CONFIRMED', proposal: 'instrument: teach the settle' },
      ],
      refuted: [],
      askOwner: [],
    },
    'work/.b900-specs.json': [{ file: 'work/.b900-rows-items.json', kind: 'rows', family: 'items', stage: ['work/.b900-rows-items.json'] }],
    'work/.b900-rows-items.json': { findings: [{ id: 'alpha#one', backfillRows: [{ category: 'items', id: 'alpha', field: 'description', value: 'restored', why: 'AoN equipment-1' }], note: '' }] },
    ...over,
  };
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue; // an explicit null in `over` means "this file is absent"
    writeFileSync(join(root, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 1));
  }
  return root;
}

describe('wg-batch-close derives verdicts from evidence', () => {
  it('REFUSES a finding no row, edit, test or teach cites — and names it', () => {
    const root = fixture();
    const r = close(root, '--batch', '900');
    expect(r.code).toBe(1);
    expect(r.out).toContain('uncited NEW verdict');
    expect(r.out).toContain('beta');
    expect(existsSync(join(root, 'work/wg-batch-900-parity.json'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('FIXED from a cited overlay row, MATCHES from a teach line, MATCHES from no finding', () => {
    const root = fixture({ 'work/.b900-report-items.txt': 'beta#two — settled: taught the VALUES comparer that beta is a table lift\n' });
    const r = close(root, '--batch', '900', '--write');
    expect(r.code).toBe(0);
    const parity = JSON.parse(readFileSync(join(root, 'work/wg-batch-900-parity.json'), 'utf8'));
    const by = Object.fromEntries(parity.records.map((v: { id: string; verdict: string; evidence: string }) => [v.id, v]));
    expect(by.alpha.verdict).toBe('FIXED');
    expect(by.alpha.evidence).toContain('items/alpha field:description');
    expect(by.beta.verdict).toBe('MATCHES');
    expect(by.beta.evidence).toContain('settled');
    expect(by.gamma.verdict).toBe('MATCHES');
    expect(by.gamma.evidence).toContain('no finding');
    rmSync(root, { recursive: true, force: true });
  });

  it('a staged test naming the finding id is a citation on its own', () => {
    const root = fixture({
      'work/.b900-specs.json': [{ file: 'work/.b900-rows-items.json', kind: 'rows', family: 'items', stage: ['test/beta.test.ts'] }],
      'work/.b900-rows-items.json': { findings: [] },
      'test/beta.test.ts': "it('alpha#one and beta#two both hold', () => {});\n",
    });
    const r = close(root, '--batch', '900', '--write');
    expect(r.code).toBe(0);
    const parity = JSON.parse(readFileSync(join(root, 'work/wg-batch-900-parity.json'), 'utf8'));
    expect(parity.records.filter((v: { verdict: string }) => v.verdict === 'FIXED')).toHaveLength(2);
    expect(parity.records.find((v: { id: string }) => v.id === 'beta').evidence).toContain('test test/beta.test.ts');
    rmSync(root, { recursive: true, force: true });
  });

  /*
   * The three evidence tiers, pinned. Measured against the real batch 029 (37 records, a hand-written
   * parity file): ranking any staged-file mention as FIXED got 11 of the 37 wrong; the tiers below get
   * 36 of 37 right, and the one remaining is a report line whose wording trips no teach keyword.
   */
  it('a staged file that merely MENTIONS a record it did not change is not a citation', () => {
    const root = mkdtempSync(join(tmpdir(), 'wg-close-git-'));
    mkdirSync(join(root, 'work'), { recursive: true });
    mkdirSync(join(root, 'src/rules'), { recursive: true });
    const registry = join(root, 'src/rules/situationalBonuses.ts');
    // the registry already names beta BEFORE the batch — batch 29's real shape
    writeFileSync(registry, "export const R = {\n  'beta': 1,\n  'other': 2,\n};\n");
    const g = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
    g('init', '-q');
    g('config', 'user.email', 'f@l');
    g('config', 'user.name', 'f');
    g('add', '--', 'src/rules/situationalBonuses.ts');
    g('commit', '-q', '-m', 'pre-batch');
    // the batch adds a line about a DIFFERENT record, and stages the file
    writeFileSync(registry, "export const R = {\n  'beta': 1,\n  'other': 2,\n  'alpha': 3,\n};\n");
    const files: Record<string, unknown> = {
      'work/wg-batch-900.json': [{ id: 'alpha' }, { id: 'beta' }],
      'work/.b900-read.json': { confirmed: [{ id: 'beta#two', claim: 'beta is wrong', verdict: 'CONFIRMED' }], refuted: [], askOwner: [] },
      'work/.b900-specs.json': [{ file: 'work/.b900-rows-items.json', kind: 'rows', family: 'items', stage: ['src/rules/situationalBonuses.ts'] }],
      'work/.b900-rows-items.json': { findings: [] },
    };
    for (const [rel, body] of Object.entries(files)) writeFileSync(join(root, rel), JSON.stringify(body, null, 1));

    const r = close(root, '--batch', '900');
    expect(r.code).toBe(1);
    expect(r.out).toContain('uncited NEW verdict');
    expect(r.out).toContain('beta#two');

    // now the batch really does change beta in that file: the same staged path becomes a citation
    writeFileSync(registry, "export const R = {\n  'beta': 9,\n  'other': 2,\n  'alpha': 3,\n};\n");
    const ok = close(root, '--batch', '900', '--write');
    expect(ok.code).toBe(0);
    const parity = JSON.parse(readFileSync(join(root, 'work/wg-batch-900-parity.json'), 'utf8'));
    expect(parity.records.find((v: { id: string }) => v.id === 'beta').verdict).toBe('FIXED');
    rmSync(root, { recursive: true, force: true });
    // 20 s, not the 5 s default: this case inits a temporary git repo and commits into it, and git on
    // this Windows machine takes 5-8 s for that under a full suite (same cause as test/nectar.test.ts).
  }, 20_000);

  it('an instrument teach outranks a test that only names the record, and settles only its OWN finding', () => {
    const root = fixture({
      'work/.b900-read.json': {
        confirmed: [
          { id: 'alpha#one', claim: 'the comparer misread alpha', verdict: 'CONFIRMED' },
          { id: 'beta#one', claim: 'the comparer misread beta', verdict: 'CONFIRMED' },
          { id: 'beta#two', claim: 'beta really does drop the printed value', verdict: 'CONFIRMED' },
        ],
        refuted: [],
        askOwner: [],
      },
      'work/.b900-specs.json': [{ file: 'work/.b900-rows-items.json', kind: 'rows', family: 'items', stage: ['test/lanes.test.ts'] }],
      'work/.b900-rows-items.json': { findings: [] },
      // the batch-29 shape: ONE test file pins every teach and names every record in it
      'test/lanes.test.ts': "it('alpha#one and beta#one and beta#two lanes', () => {});\n",
      'work/.b900-report-items.txt': 'alpha#one — settled: taught the VALUES comparer\nbeta#one — settled: taught the VALUES comparer\n',
    });
    const r = close(root, '--batch', '900', '--write');
    expect(r.code).toBe(0);
    const parity = JSON.parse(readFileSync(join(root, 'work/wg-batch-900-parity.json'), 'utf8'));
    const by = Object.fromEntries(parity.records.map((v: { id: string; verdict: string }) => [v.id, v.verdict]));
    expect(by.alpha).toBe('MATCHES');   // taught, though the staged test names it
    expect(by.beta).toBe('FIXED');      // #two has no teach of its own — its sibling's line is not evidence
    rmSync(root, { recursive: true, force: true });
  });

  it('OWNER-QUEUED carries the desk n, and an askOwner finding with no desk REFUSES', () => {
    const queued = fixture({
      'work/owner-questions.json': { open: [{ id: 'gamma', batch: 900, n: 77 }], deferred: [] },
      'work/.b900-report-items.txt': 'beta#two — settled: comparer taught\n',
    });
    const ok = close(queued, '--batch', '900', '--write');
    expect(ok.code).toBe(0);
    const parity = JSON.parse(readFileSync(join(queued, 'work/wg-batch-900-parity.json'), 'utf8'));
    const gamma = parity.records.find((v: { id: string }) => v.id === 'gamma');
    expect(gamma.verdict).toBe('OWNER-QUEUED');
    expect(gamma.evidence).toContain('#77');
    rmSync(queued, { recursive: true, force: true });

    const unqueued = fixture({
      'work/.b900-read.json': { confirmed: [], refuted: [], askOwner: [{ id: 'gamma#ruling', claim: 'their row contradicts print' }] },
    });
    const bad = close(unqueued, '--batch', '900');
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('gamma');
    expect(bad.out).toMatch(/owner-questions\.json has no entry|desk n/);
    rmSync(unqueued, { recursive: true, force: true });
  });

  it('falls back to the permanent rulings-numbering map and SAYS SO when an entry has no n', () => {
    const root = fixture({
      'work/owner-questions.json': { open: [{ id: 'gamma', batch: 900 }], deferred: [] },
      'work/rulings-numbering.json': { numbers: { gamma: 41 } },
      'work/.b900-report-items.txt': 'beta#two — settled: comparer taught\n',
    });
    const r = close(root, '--batch', '900', '--write');
    expect(r.code).toBe(0);
    const parity = JSON.parse(readFileSync(join(root, 'work/wg-batch-900-parity.json'), 'utf8'));
    expect(parity.records.find((v: { id: string }) => v.id === 'gamma').evidence).toContain('#41');
    expect(parity.records.find((v: { id: string }) => v.id === 'gamma').evidence).toContain('rulings-numbering.json');
    rmSync(root, { recursive: true, force: true });
  });

  it('never drops or overwrites an existing verdict, and REFUSES a changed one with both values', () => {
    const root = fixture({
      'work/.b900-report-items.txt': 'beta#two — settled: comparer taught\n',
      'work/wg-batch-900-parity.json': {
        batch: 900,
        records: [
          { id: 'alpha', verdict: 'MATCHES', evidence: 'ruled last batch' },
          { id: 'legacy-record', verdict: 'FIXED', evidence: 'from an earlier close' },
        ],
      },
    });
    const r = close(root, '--batch', '900', '--write');
    expect(r.code).toBe(1);
    expect(r.out).toContain('verdict changed');
    expect(r.out).toContain('existing "MATCHES"');
    expect(r.out).toContain('derived "FIXED"');
    // refused means untouched: the record from an earlier close is still there, alpha still MATCHES
    const parity = JSON.parse(readFileSync(join(root, 'work/wg-batch-900-parity.json'), 'utf8'));
    expect(parity.records.map((v: { id: string }) => v.id)).toContain('legacy-record');
    expect(parity.records.find((v: { id: string }) => v.id === 'alpha').verdict).toBe('MATCHES');
    rmSync(root, { recursive: true, force: true });
  });

  it('parks gap lines into flaggedResidues and REFUSES while any gap is still open', () => {
    const withOpen = fixture({
      'work/.b900-report-items.txt': 'beta#two — settled: comparer taught\n',
      'work/.b900-gaps.json': [{ family: 'items', kind: 'CROSS-FILE GAPS', line: 'build.ts reads investedItemIds only', status: 'open', ref: 'alpha#one' }],
    });
    const bad = close(withOpen, '--batch', '900');
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('open');
    rmSync(withOpen, { recursive: true, force: true });

    const parked = fixture({
      'work/.b900-report-items.txt': 'beta#two — settled: comparer taught\n',
      'work/.b900-gaps.json': [{ family: 'items', kind: 'CROSS-FILE GAPS', line: 'GrantedStrike has no proficiency carrier — residue, not fixable by data', status: 'parked', ref: 'alpha#reach' }],
    });
    const ok = close(parked, '--batch', '900', '--write');
    expect(ok.code).toBe(0);
    const residual = JSON.parse(readFileSync(join(parked, 'work/wg-batch-900-residual.json'), 'utf8'));
    expect(residual.flaggedResidues).toHaveLength(1);
    expect(residual.flaggedResidues[0]).toMatchObject({ id: 'alpha#reach', fixed: false, family: 'items' });
    expect(residual.confirmed).toHaveLength(2);
    expect(residual.examined).toBe(3);
    rmSync(parked, { recursive: true, force: true });
  });
});

describe('the plan-E acceptance: re-closing batch 029 changes nothing', () => {
  const have = ['work/.b029-read.json', 'work/wg-batch-029.json', 'work/wg-batch-029-parity.json', 'work/wg-batch-029-residual.json'].every((f) => existsSync(join(ROOT, f)));
  it.runIf(have)('derives the same two artefacts byte-for-byte and refuses to --write over a committed batch', () => {
    const r = close(ROOT, '--batch', '029');
    expect(r.code).toBe(0);
    expect(r.out).toContain('work/wg-batch-029-parity.json: byte-identical, no change');
    expect(r.out).toContain('work/wg-batch-029-residual.json: byte-identical, no change');
    expect(r.out).toContain('already committed');
    const w = close(ROOT, '--batch', '029', '--write');
    expect(w.code).toBe(1);
    expect(w.out).toContain('already committed');
  });
});
