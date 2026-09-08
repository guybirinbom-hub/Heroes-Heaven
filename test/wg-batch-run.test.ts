/*
 * THE BATCH DRIVER'S GUARDS — the five apply pre-checks, the run.json entry shape, the heavy-job lock.
 *
 * WHY. docs/wg-batch-pipeline.md §A gives the `apply` stage five refusals "over the WHOLE manifest
 * before writing anything", and every one of them is a mistake that already happened while a batch was
 * applied by hand: two specs writing one key, a row quietly replacing an older one, a whole-value row
 * discarding the per-option rows beneath it (the magus case), a prose row with a path that reaches
 * nothing, a row whose justification cites no printed document. A guard nobody tests is a comment, so
 * each refusal is exercised here on a fixture — and, just as important, a clean manifest is exercised
 * too: a pre-check that refuses everything would stop the pipeline just as effectively.
 *
 * Nothing here touches the real overlay, the real data or the real work/.heavy.lock: the pre-checks are
 * pure functions and the lock test runs against its own file through HEAVY_LOCK_PATH.
 */
import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every case runs a stage of the batch runner as a real node child — fine alone, several times
 * slower under the full suite, where the 5 s default turned it into a timeout. See
 * test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clip, comparerFlags, copyTestbase, dumpBlocks, entryOf, expectRowsFor, familyOf, gapProblems, isFlagged, keyOf, missingGapsRefusal, newRunId, pendingQuestions, precheck, refusalTail, uncitedQuiet, wentQuiet } from '../scripts/wg-batch-run.mjs';

/* A row that passes every pre-check, so each fixture below differs from the clean case in ONE way. */
const row = (over: Record<string, unknown> = {}) => ({
  category: 'items', id: 'spined-shield', field: 'traits', value: ['graft', 'magical'],
  why: 'equipment-2827: print lists the graft trait', ...over,
});
const at = (file: string, finding: string, r: Record<string, unknown>) => ({ file, finding, row: r });
/* The mirror and our current prose are injected, so a description fixture never reads the AoN archive. */
const stubs = {
  mirror: () => 'The spines are +1 striking shield spikes in a 10-foot burst.',
  currentDescription: () => 'The spines are shield spikes.',
};

describe('apply pre-checks (docs/wg-batch-pipeline.md §A)', () => {
  it('passes a clean manifest — the guard must not refuse honest work', () => {
    const { problems } = precheck(
      [at('work/.b030-rows-items.json', 'spined-shield#trait-graft', row())],
      [{ category: 'items', id: 'other', field: 'traits', value: [] }],
      stubs,
    );
    expect(problems).toEqual([]);
  });

  it('(1) refuses a collision ACROSS two spec files, naming both', () => {
    const { problems } = precheck(
      [at('work/.b030-rows-items.json', 'f-a', row()), at('work/.b030-rows-dc.json', 'f-b', row({ value: ['magical'] }))],
      [],
      stubs,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('COLLISION items/spined-shield/traits');
    expect(problems[0]).toContain('rows-items.json#f-a');
    expect(problems[0]).toContain('rows-dc.json#f-b');
  });

  /* keyOf ends a create row with '(create)' and a field row with its field name, so check (1) never saw
   * these two as ONE record: batch 031 created stances/wild-winds-stance in work/.b031-rows-data-rows.json
   * and set that record's `strikes` from work/.b031-rows-gap-data-rows.json, and apply refused AFTER
   * writing with "NEEDS npm run data" because a create can never correct an existing record. */
  // batch 031: wild-winds-initiate#stance
  it('(1b) refuses a create row and a field row on the same record — wild-winds-initiate#stance', () => {
    const create = { category: 'stances', id: 'wild-winds-stance', create: true, why: 'spell-2062', value: { id: 'wild-winds-stance', strikes: [{ name: 'wind crash' }] } };
    const field = { category: 'stances', id: 'wild-winds-stance', field: 'strikes', why: 'spell-2062', value: [{ name: 'wind crash', range: 30 }] };
    // batch 031: wild-winds-initiate#stance
    const { problems } = precheck([at('rows-data.json', 'wild-winds-initiate#stance', create), at('rows-gap.json', 'gap#range', field)], [], stubs);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('fold the field into the create row');
    expect(problems[0]).toContain('rows-data.json#wild-winds-initiate#stance');
    expect(problems[0]).toContain('rows-gap.json#gap#range');
  });

  // batch 031: wild-winds-initiate#stance
  it('(1b) allows the folded wild-winds-initiate#stance shape, and still refuses it in the wrong order', () => {
    const strikes = [{ name: 'wind crash', range: 30 }];
    const create = { category: 'stances', id: 'wild-winds-stance', create: true, why: 'spell-2062', value: { id: 'wild-winds-stance', strikes } };
    const field = { category: 'stances', id: 'wild-winds-stance', field: 'strikes', why: 'spell-2062', value: strikes };
    expect(precheck([at('a.json', 'c', create), at('b.json', 'f', field)], [], stubs).problems).toEqual([]);
    // batch 031: wild-winds-initiate#stance
    expect(precheck([at('b.json', 'f', field), at('a.json', 'c', create)], [], stubs).problems).toHaveLength(1);
  });

  it('(2) refuses a row over an existing overlay key unless it declares supersedes, and records old -> new', () => {
    const overlay = [{ category: 'items', id: 'spined-shield', field: 'traits', value: ['magical'] }];
    const undeclared = precheck([at('spec.json', 'f', row())], overlay, stubs);
    expect(undeclared.problems.join()).toMatch(/already exists in the overlay and the row does not carry supersedes:true/);

    const declared = precheck([at('spec.json', 'f', row({ supersedes: true }))], overlay, stubs);
    expect(declared.problems).toEqual([]);
    expect(declared.supersedes[0]).toContain('items/spined-shield/traits');
    expect(declared.supersedes[0]).toContain('->');
  });

  // batch 031: wild-winds-initiate#stance
  it('(2) exempts a row already on disk byte-identical — resuming batch 031 after wild-winds-initiate#stance refused mid-write', () => {
    const overlay = [{ ...row() }];
    // batch 031: wild-winds-initiate#stance
    expect(precheck([at('spec.json', 'f', row())], overlay, stubs).problems).toEqual([]);
    expect(precheck([at('spec.json', 'f', row({ value: ['magical'] }))], overlay, stubs).problems).toHaveLength(1);
  });

  it('(3) refuses a pathless whole-value row on a field that already has path:[…,"id=…"] rows (the magus case)', () => {
    const overlay = [{
      category: 'classes', id: 'magus', field: 'spellSlotBonus',
      path: ['subclass', 'options', 'id=starlit-span'], value: { rank: 1 },
    }];
    const { problems } = precheck(
      [at('spec.json', 'magus#slots', { category: 'classes', id: 'magus', field: 'spellSlotBonus', value: { rank: 1 }, why: 'class-feature-431' })],
      overlay,
      stubs,
    );
    expect(problems.join()).toContain('the magus case');
    expect(problems.join()).toContain('classes/magus/spellSlotBonus');
  });

  it('(4) refuses a description row that carries a path', () => {
    const { problems } = precheck(
      [at('spec.json', 'x#prose', row({ field: 'description', value: 'text', path: ['subclass', 'options', 'id=a'] }))],
      [],
      stubs,
    );
    expect(problems.join()).toMatch(/description row carries a path/);
  });

  it('(5) refuses a `why` that names no AoN doc id', () => {
    const { problems } = precheck([at('spec.json', 'x', row({ why: 'because the printed text says so' }))], [], stubs);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('names no AoN doc id');
    expect(problems[0]).toContain(keyOf(row()));
  });

  it('(5) refuses a description row whose restored tokens are in neither our text nor the mirror', () => {
    const good = precheck(
      [at('spec.json', 'x#burst', row({ field: 'description', value: 'The spines are shield spikes in a 10-foot burst.' }))],
      [], stubs,
    );
    expect(good.problems).toEqual([]);

    const invented = precheck(
      [at('spec.json', 'x#burst', row({ field: 'description', value: 'The spines are shield spikes in a 30-foot cone.' }))],
      [], stubs,
    );
    expect(invented.problems.join()).toContain('in NEITHER our current text nor the mirror');
    expect(invented.problems.join()).toContain('cone');
  });
});

describe('work/.bNNN-run.json entries', () => {
  it('carries exactly the shared contract\'s fields, with exitCode derived from ok', () => {
    const e = entryOf({
      stage: 'apply', ok: true, runId: newRunId(), startedAt: 'a', endedAt: 'b',
      counts: { rows: 3 }, digest: 'three rows', next: 'apply-digest',
      git: { head: 'abc', count: 340, stash: 0, dirtyTracked: [] },
      hashes: { overlay: 'o', core: 'c', descriptions: 'd' },
      refusals: [],
    });
    expect(Object.keys(e)).toEqual(['stage', 'ok', 'exitCode', 'runId', 'startedAt', 'endedAt', 'counts', 'digest', 'next', 'git', 'hashes', 'refusals']);
    expect(e.exitCode).toBe(0);
    expect(entryOf({ ...e, ok: false }).exitCode).toBe(1);
    expect(e.runId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('caps the digest at 600 characters — it is the only prose Fable reads per stage', () => {
    const e = entryOf({ stage: 'suite', ok: false, runId: newRunId(), startedAt: 'a', endedAt: 'b', digest: 'x'.repeat(4000), git: {}, hashes: {} });
    expect(e.digest.length).toBeLessThanOrEqual(600);
    expect(clip('short', 600)).toBe('short');
    expect(e.counts).toEqual({});
    expect(e.refusals).toEqual([]);
  });

  /* The batch-029 dry run: `--stage close` refused with "batch 029 is already committed (27d0a64 …)"
   * and the digest showed three unrelated `note:` lines, because the refusal prints LAST and clip()
   * truncates from the front. Fable reads the digest, never the log (§D), so the digest must open at
   * the refusal. */
  it('a refused child\'s digest opens AT the refusal, not at the last chatty line', () => {
    const out = ['note: kept the existing verdict — a'.padEnd(180, '.'), 'note: kept the existing verdict — b'.padEnd(180, '.'),
      'note: kept the existing verdict — c'.padEnd(180, '.'), 'REFUSED (1), nothing written:',
      '  - batch 029 is already committed (27d0a64 WG parity batch 29)'].join('\n');
    expect(clip(refusalTail(out, 8), 460)).toContain('27d0a64');
    expect(refusalTail(out, 8).startsWith('REFUSED')).toBe(true);
    // no refusal block: fall back to the plain tail rather than swallowing the output
    expect(refusalTail('one\ntwo\nthree', 2)).toBe('two | three');
  });
});

describe('--expect-rows, per spec (the applier cannot see the manifest)', () => {
  const r = (over: Record<string, unknown>) => ({ category: 'items', id: 'x', field: 'traits', ...over });
  it('counts rows on disk plus the DISTINCT keys the spec adds; a replacement adds nothing', () => {
    const overlay = [r({ id: 'a' }), r({ id: 'b' })];
    expect(expectRowsFor(overlay, [r({ id: 'c' })])).toBe(3);                       // one new
    expect(expectRowsFor(overlay, [r({ id: 'a', value: 9 })])).toBe(2);             // replaces in place
    expect(expectRowsFor(overlay, [r({ id: 'c' }), r({ id: 'c' })])).toBe(3);       // same key twice
    /* Path-aware, like the applier's own findIndex: two rows into different `id=` options of one field
     * are two rows, not one — the magus case that used to collapse to a single overlay row. */
    expect(expectRowsFor(overlay, [
      r({ id: 'a', path: ['subclass', 'options', 'id=one'] }),
      r({ id: 'a', path: ['subclass', 'options', 'id=two'] }),
    ])).toBe(4);
  });
});

/*
 * FAMILY ROUTING. Before this existed the read summary was a flat CONFIRMED list and every builder
 * self-selected its work from it — the hand-reshaping the pipeline exists to remove. The rule is
 * first-match over an ordered list, so what is pinned here is the ORDER as much as the patterns: a
 * proposal that names both a settle registry and a src/rules file is an instrument fix, not an engine one.
 */
describe('read-digest family routing', () => {
  it('routes each proposal to exactly one family, first rule wins', () => {
    expect(familyOf('instrument: wg-values misreads resonant as a scalar')).toBe('instruments');
    expect(familyOf('teach SETTLED_IDENTITIES in scripts/wg-identity.mjs; also read by src/rules/build.ts')).toBe('instruments');
    expect(familyOf('scripts/repair-stripped-save-dc.mjs restores the DC and dropped-inline-check gets a hole class')).toBe('repair');
    expect(familyOf('add an entry to src/rules/situationalBonuses.ts keyed by the record id')).toBe('situational');
    expect(familyOf('add the id to RECORD_MARKERS')).toBe('situational');
    expect(familyOf('an overlay row setting traits to ["graft"]')).toBe('data-rows');
    expect(familyOf('widen the reader in src/rules/derive.ts')).toBe('engine');
    expect(familyOf('add the control in src/builder/Builder.tsx')).toBe('engine');
    // situationalBonuses is excluded from `engine` BY ORDER — the situational rule has already taken it
    expect(familyOf('edit src/rules/situationalBonuses.ts and src/rules/build.ts')).toBe('situational');
    // the default: a proposal that targets nothing else is a row on the record
    expect(familyOf('give it the printed value')).toBe('data-rows');
    expect(familyOf(undefined)).toBe('data-rows');
  });
});

/*
 * THE BASELINE FLAGS AS DATA. The cut runner used to concatenate matching lines out of six text files by
 * hand for every record; the close stage then had to re-derive the same thing to answer "what went
 * quiet". One extractor, so the two can never disagree about whether a record was flagged.
 */
describe('comparer flags', () => {
  const VALUES = [
    'compared 12 records with at least one comparable value; 10 agree on every one',
    '',
    '--- spined-shield  (Spined Shield)',
    '      scalar    acBonus                    theirs=2            ours=1',
    '      set       traits                     theirs=graft        ours=(none)',
    '',
    '--- zealot-staff  (Zealot Staff)',
    '      scalar    hardness                   theirs=8            ours=6',
    '',
  ].join('\n');
  const IDENTITY = ['--- zealot-staff  (Zealot Staff)', '      spells   theirs-not-ours=[heal]', ''].join('\n');

  it('reads the --- <id> blocks both dumps print', () => {
    expect(Object.keys(dumpBlocks(VALUES))).toEqual(['spined-shield', 'zealot-staff']);
    expect(dumpBlocks(VALUES)['spined-shield']).toHaveLength(2);
    expect(dumpBlocks('no blocks at all')).toEqual({});
  });

  it('keys every comparer by record id, and OK is not a flag', () => {
    const flags = comparerFlags({
      diff: { theyOnly: [{ id: 'spined-shield', missing: ['grantedStrikes'] }] },
      valuesText: VALUES,
      identityText: IDENTITY,
      experience: { records: [{ id: 'quiet-one', verdict: 'OK' }, { id: 'zealot-staff', verdict: 'MISSING-CONTROL' }] },
      ids: ['quiet-one'],
    });
    expect(flags['spined-shield']).toEqual({ kinds: ['grantedStrikes'], values: expect.any(Array), identity: [], experience: null });
    expect(flags['zealot-staff'].identity).toEqual(['spells   theirs-not-ours=[heal]']);
    expect(isFlagged(flags['spined-shield'])).toBe(true);
    expect(isFlagged(flags['zealot-staff'])).toBe(true);
    // seeded from the batch id list and flagged by nobody: an experience verdict of OK says nothing
    expect(isFlagged(flags['quiet-one'])).toBe(false);
  });
});

/*
 * THE THREE DRIVER GUARDS THAT HAD NO FIXTURE. Each is a stage refusal whose only previous proof was
 * that it had been written down, and each guards a failure this project has actually had: a gaps file
 * that never landed reading as "no gaps", a testbase with a hole in it (the flip audit then reports
 * "no baseline copy to diff against" for a test nobody edited), and a settle that silenced an EARLIER
 * batch's record where a green gate — which only looks at this batch's packet — cannot see it.
 *
 * All three now take paths/data, so these run against throwaway fixture roots under the OS temp dir.
 * Nothing here reads the real work/ files.
 */
describe('driver stage guards, on fixture roots', () => {
  const roots: string[] = [];
  const fixture = () => { const r = mkdtempSync(join(tmpdir(), 'wg-driver-')); roots.push(r); return r; };
  afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

  it('(a) gaps: refuses when apply.json landed and gaps.json did not, and passes when both are there with nothing open', () => {
    const root = fixture();
    mkdirSync(join(root, 'work'), { recursive: true });
    writeFileSync(join(root, 'work/.b030-apply.json'), '{"batch":"030","families":{}}\n');
    const exists = (rel: string) => existsSync(join(root, rel));
    const check = () => missingGapsRefusal(exists('work/.b030-apply.json'), exists('work/.b030-gaps.json'), 'work/.b030-apply.json', 'work/.b030-gaps.json');

    expect(check()).toContain('is not "no gaps"');
    expect(check()).toContain('work/.b030-gaps.json');

    const gaps = [
      { family: 'items', line: 'DATA STILL NEEDED: the mirror has no armour entry', status: 'authored', ref: 'work/.b030-rows-items.json' },
      { family: 'engine', line: 'CROSS-FILE GAPS: derive.ts has no reader for the field', status: 'parked', ref: '#127' },
    ];
    writeFileSync(join(root, 'work/.b030-gaps.json'), JSON.stringify(gaps));
    writeFileSync(join(root, 'work/.b030-rows-items.json'), '{"findings":[]}\n');
    expect(check()).toBeNull();

    const args = { manifestFiles: new Set(['work/.b030-rows-items.json']), known: new Set(['#127']), fileExists: exists };
    expect(gapProblems({ gaps: JSON.parse(readFileSync(join(root, 'work/.b030-gaps.json'), 'utf8')), ...args })).toEqual([]);
    // and the line that is still open is named, with its family
    const open = gapProblems({ gaps: [{ family: 'items', line: 'DATA STILL NEEDED: no printed price', status: 'open' }], ...args });
    expect(open).toHaveLength(1);
    expect(open[0]).toContain('items: "DATA STILL NEEDED: no printed price"');
    expect(open[0]).toContain('still OPEN');
  });

  it('(e) baseline: byte-copies an untracked test into the testbase, and names one it cannot copy', () => {
    const root = fixture();
    const body = "import { expect, it } from 'vitest';\nit('new in this batch', () => { expect(1).toBe(1); });\n";
    mkdirSync(join(root, 'test'), { recursive: true });
    writeFileSync(join(root, 'test/new-thing.test.ts'), body);
    const tb = join(root, 'work/.b030-testbase');

    expect(copyTestbase(root, ['test/new-thing.test.ts'], tb)).toEqual([]);
    expect(readFileSync(join(tb, 'test/new-thing.test.ts'), 'utf8')).toBe(body);   // a BYTE copy, not a stat

    // a path with no source: the stage refuses naming it rather than pinning a baseline with a hole
    expect(copyTestbase(root, ['test/new-thing.test.ts', 'test/vanished.test.ts'], tb)).toEqual(['test/vanished.test.ts']);
  });

  it('(f) close: a record OUTSIDE the batch that fell silent is refused unless a disposed gap line cites it', () => {
    const root = fixture();
    const dir = join(root, 'work/.b030-baseline');
    mkdirSync(dir, { recursive: true });
    /* The baseline stage's own artefact, written the way the stage writes it — through comparerFlags. */
    writeFileSync(join(dir, 'flags.json'), JSON.stringify(comparerFlags({
      diff: { theyOnly: [{ id: 'spined-shield', missing: ['traits'] }, { id: 'zealot-staff', missing: ['grantedStrikes'] }] },
      ids: ['spined-shield'],
    })));
    const base = JSON.parse(readFileSync(join(dir, 'flags.json'), 'utf8'));
    const now = comparerFlags({ diff: { theyOnly: [] } });             // a fresh diff flags neither any more

    // spined-shield going quiet is the POINT of the batch; zealot-staff is somebody else's record
    const quiet = wentQuiet(base, now, new Set(['spined-shield']));
    expect(quiet).toEqual([{ id: 'zealot-staff', kinds: ['grantedStrikes'] }]);

    expect(uncitedQuiet(quiet, []).map((q: { id: string }) => q.id)).toEqual(['zealot-staff']);
    expect(uncitedQuiet(quiet, [{ family: 'instruments', status: 'open', line: 'zealot-staff looks settled' }])
      .map((q: { id: string }) => q.id)).toEqual(['zealot-staff']);    // an OPEN line cites nothing
    expect(uncitedQuiet(quiet, [{ family: 'instruments', status: 'authored', line: 'taught the comparer zealot-staff', ref: 'work/.b030-rows-instruments.json' }])).toEqual([]);
    expect(uncitedQuiet(quiet, [{ family: 'instruments', status: 'parked', line: 'their grant is prose', ref: 'flaggedResidue: zealot-staff, theirs encodes it as prose' }])).toEqual([]);
  });
});

describe('the heavy-job lock', () => {
  const lock = join(tmpdir(), `hh-heavy-lock-test-${process.pid}.json`);
  beforeEach(() => {
    process.env.HEAVY_LOCK_PATH = lock;
    delete process.env.HEAVY_LOCK; // otherwise every call is the re-entrant pass-through
    rmSync(lock, { force: true });
  });
  afterAll(() => { rmSync(lock, { force: true }); delete process.env.HEAVY_LOCK_PATH; });

  it('serialises: a second holder waits while a LIVE holder has it, and runs once it is released', async () => {
    const { withHeavyLock } = await import('../scripts/lib/heavy-lock.mjs');
    /* Our own pid stands in for the other heavy job: from the lock's side it is simply a live holder. */
    writeFileSync(lock, JSON.stringify({ pid: process.pid, label: 'fixture holder', since: new Date().toISOString() }));
    let acquired = false;
    const second = withHeavyLock('second job', async () => { acquired = true; });
    await new Promise((r) => setTimeout(r, 2600)); // longer than one 2 s poll
    expect(acquired).toBe(false);
    rmSync(lock, { force: true }); // the first job finishes
    await second;
    expect(acquired).toBe(true);
    expect(existsSync(lock)).toBe(false); // and it released what it took
  }, 20_000);

  it('takes over a lock whose holder is dead rather than wedging the machine', async () => {
    const { withHeavyLock } = await import('../scripts/lib/heavy-lock.mjs');
    const gone = spawnSync(process.execPath, ['--version']).pid ?? 0x7ffffffe; // exited before we look
    writeFileSync(lock, JSON.stringify({ pid: gone, label: 'crashed batch', since: new Date().toISOString() }));
    let ran = false;
    await withHeavyLock('after a crash', async () => { ran = true; });
    expect(ran).toBe(true);
    expect(existsSync(lock)).toBe(false);
  }, 20_000);
});
