import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  canonical, sha, briefingSourcesFrom, briefingHashes, textHashOf, evidenceHashOf,
  requirementsHashOf, planRun, planArgs, foldResults, assembleResult, packDelta, emptyCache,
} from '../scripts/lib/audit-cache.mjs';

/**
 * THE AUDIT CACHE'S OWN TEST.
 *
 * The 500-feat audit cost 17.4M tokens because it read every feat twice. The cache exists to recover
 * most of that on a re-run — and a cache is the one optimisation that can make an audit WORSE than not
 * having it: a hash taken over anything other than what the reader actually saw serves a stale answer
 * for changed input, and a stale verdict is indistinguishable from a fresh one in the report.
 *
 * So the tests below are mostly about invalidation, not about reuse. The reuse case is one line; the
 * cases where reuse must NOT happen are the file.
 */

const pack = (over: Record<string, unknown> = {}) => ({
  featId: 'f1', name: 'F1', level: 4, category: 'class', traits: [],
  text: 'You gain a +1 circumstance bonus to Stealth.',
  placed: true, storedFields: {}, registries: [], textNumbers: [],
  sheetDiff: [] as unknown[], builder: { choiceCount: 0, presentsChoices: [] },
  crossChecks: { sheetSilent: true }, harnessLimits: [] as unknown[],
  ...over,
});

const requirement = (what = 'star Stealth') => [{ lane: 'situational', what, clause: 'x', side: 'sheet' }];
const verdict = (over: Record<string, unknown> = {}) => ({
  featId: 'f1', name: 'F1', verdict: 'correct', half: 'n/a', detail: '', question: '', severity: 'low', ...over,
});

/** A cache holding one fully-valid entry for `p`, as a run over `p` would have left it. */
const cacheFor = (packs: ReturnType<typeof pack>[], briefing: { extract: string; verify: string }) => ({
  version: 1,
  generated: '2026-08-12T00:00:00.000Z',
  entries: Object.fromEntries(packs.map((p) => [p.featId, {
    requirements: { textHash: textHashOf(p), briefingHash: briefing.extract, runAt: 'then', value: requirement() },
    verdict: {
      evidenceHash: evidenceHashOf(p), briefingHash: briefing.verify,
      requirementsHash: requirementsHashOf(requirement()), runAt: 'then', value: verdict({ featId: p.featId }),
    },
  }])),
});

const SCRIPT = readFileSync(new URL('../scripts/audit/audit-500.js', import.meta.url), 'utf8');
const DOCS = { 'docs/gold-set-answers.md': 'the rulings', 'docs/mechanic-lanes.md': 'the lanes' };
const briefing = briefingHashes({ script: SCRIPT, docs: DOCS });

describe('hashes are taken over what the READER sees, never over a convenient proxy', () => {
  it('canonical JSON ignores key order — the same evidence never looks changed', () => {
    expect(canonical({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe(canonical({ a: [2, { c: 3, d: 4 }], b: 1 }));
    // …and array ORDER is meaningful: a reordered option list is a different option list.
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });

  it('the requirements hash is the feat TEXT alone — phase 1 may read nothing else', () => {
    // The extract prompt says so in as many words ("Ignore every other field in that file"), which is
    // the whole reason requirements survive an engine change.
    expect(textHashOf(pack())).toBe(textHashOf(pack({ sheetDiff: [{ path: 'ac.total' }], registries: ['modes'] })));
    expect(textHashOf(pack())).not.toBe(textHashOf(pack({ text: 'You gain a +1 status bonus to Stealth.' })));
  });

  it('the evidence hash covers the WHOLE pack, including fields nobody thought to list', () => {
    // Phase 2 is told to read the feat's full entry. A curated subset would be a list of the fields
    // someone remembered, and the forgotten one is the one that goes stale.
    expect(evidenceHashOf(pack())).not.toBe(evidenceHashOf(pack({ sheetDiff: [{ path: 'skills.stealth.total' }] })));
    expect(evidenceHashOf(pack())).not.toBe(evidenceHashOf(pack({ harnessLimits: [{ limit: 'companion-tab' }] })));
    expect(evidenceHashOf(pack())).not.toBe(evidenceHashOf(pack({ builder: { choiceCount: 1, presentsChoices: [{}] } })));
    expect(evidenceHashOf(pack())).toBe(evidenceHashOf({ ...pack() }));
  });

  it('reads the two prompts out of the real workflow script, escaped backticks and all', () => {
    const s = briefingSourcesFrom(SCRIPT);
    expect(s.extract).toContain('extracting WHAT AN APP MUST BE ABLE TO DO');
    // The VERIFY prompt is full of `\`sheetDiff\`` escapes; a naive scan stops at the first one.
    expect(s.verify).toContain('harnessLimits');
    expect(s.verify.length).toBeGreaterThan(3000);
    expect(s.constants).toContain('const SIZE =');
  });

  it('refuses to produce a briefing hash it cannot read — silence would keep matching forever', () => {
    expect(() => briefingSourcesFrom('const EXTRACT = readPromptFromSomewhereElse()')).toThrow(/could not read/i);
  });

  it('a changed owner ruling invalidates BOTH phases — the answers doc is the authority for each', () => {
    const after = briefingHashes({ script: SCRIPT, docs: { ...DOCS, 'docs/gold-set-answers.md': 'the rulings, plus Q29' } });
    expect(after.extract).not.toBe(briefing.extract);
    expect(after.verify).not.toBe(briefing.verify);
  });

  it('a changed prompt invalidates that phase', () => {
    const edited = SCRIPT.replace('You are auditing whether', 'You are now auditing whether');
    const after = briefingHashes({ script: edited, docs: DOCS });
    expect(after.prompts.verify).not.toBe(briefing.prompts.verify);
    expect(after.prompts.extract).toBe(briefing.prompts.extract);
  });
});

describe('the plan — what gets asked again, and why', () => {
  const packs = [pack({ featId: 'a' }), pack({ featId: 'b' }), pack({ featId: 'c' })];

  it('an empty cache asks everything, and says why', () => {
    const plan = planRun({ packs, briefing, size: 2 });
    expect(plan.totals.reqRecompute).toBe(3);
    expect(plan.totals.verifyRecompute).toBe(3);
    expect(plan.totals.reasons.req['no-cache-entry']).toBe(3);
    expect(plan.batches.map((b: { i: number }) => b.i)).toEqual([0, 1]);
  });

  it('an unchanged app asks nothing at all — no batch carries work', () => {
    const plan = planRun({ packs, cache: cacheFor(packs, briefing), briefing, size: 2 });
    expect(plan.totals).toMatchObject({ reqReused: 3, reqRecompute: 0, verifyReused: 3, verifyRecompute: 0 });
    expect(plan.batches).toEqual([]);
  });

  it('⭐ building a lane re-verifies only the feats it touched, and re-derives NO requirements', () => {
    // The headline property: evidence moved for one feat of three, so one verdict is recomputed and
    // three requirement extractions are reused. This is the half of the cost the re-run recovers.
    const cache = cacheFor(packs, briefing);
    const moved = [packs[0], { ...packs[1], sheetDiff: [{ path: 'skills.stealth.total', before: 30, after: 31 }] }, packs[2]];
    const plan = planRun({ packs: moved, cache, briefing, size: 2 });
    expect(plan.totals).toMatchObject({ reqReused: 3, reqRecompute: 0, verifyReused: 2, verifyRecompute: 1 });
    expect(plan.totals.reasons.verify['evidence-changed']).toBe(1);
    expect(plan.feats.b.verify).toBe('recompute');
    // …and the cached requirements travel with it, because phase 1 will not run for that feat.
    expect(plan.feats.b.cachedRequirements).toEqual(requirement());
    expect(plan.feats.a.cachedRequirements).toBeNull();
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]).toMatchObject({ i: 0, req: [], verify: [1], carriedRequirements: 1 });
  });

  it('changed text recomputes BOTH phases — a requirement derived from text nobody read is worthless', () => {
    const cache = cacheFor(packs, briefing);
    const edited = [{ ...packs[0], text: 'You gain a +2 circumstance bonus to Stealth.' }, packs[1], packs[2]];
    const plan = planRun({ packs: edited, cache, briefing, size: 5 });
    expect(plan.feats.a).toMatchObject({ req: 'recompute', reqReason: 'text-changed', verify: 'recompute', verifyReason: 'requirements-recomputed' });
  });

  it('never reuses a verdict whose requirements are being recomputed', () => {
    // The invariant that keeps the two phases honest: phase 2 was judged from a specific set of
    // requirements, so if those are about to change, the verdict is not evidence of anything.
    const cache = cacheFor(packs, briefing);
    const edited = packs.map((p, i) => (i === 2 ? { ...p, text: 'Different.' } : p));
    const plan = planRun({ packs: edited, cache, briefing, size: 5 });
    for (const f of Object.values(plan.feats) as { req: string; verify: string }[]) {
      if (f.req === 'recompute') expect(f.verify).toBe('recompute');
    }
  });

  it('a verdict judged from requirements that have since changed is not reused', () => {
    // The cache holds a verdict stamped with the hash of the requirements it read. If a later run
    // stored different requirements for the same text, the verdict answers a question nobody asked.
    const cache = cacheFor(packs, briefing);
    cache.entries.a.requirements.value = requirement('star Stealth AND Thievery');
    const plan = planRun({ packs, cache, briefing, size: 5 });
    expect(plan.feats.a).toMatchObject({ req: 'reuse', verify: 'recompute', verifyReason: 'requirements-changed' });
  });

  it('--force ignores the cache entirely', () => {
    const plan = planRun({ packs, cache: cacheFor(packs, briefing), briefing, force: true, size: 5 });
    expect(plan.totals).toMatchObject({ reqRecompute: 3, verifyRecompute: 3 });
    expect(plan.totals.reasons.req.forced).toBe(3);
  });

  it('--briefing-ok is the only way to reuse across a changed briefing, and it is a decision', () => {
    const cache = cacheFor(packs, briefing);
    const after = briefingHashes({ script: SCRIPT, docs: { ...DOCS, 'docs/mechanic-lanes.md': 'the lanes (typo fixed)' } });
    expect(planRun({ packs, cache, briefing: after, size: 5 }).totals.verifyRecompute).toBe(3);
    expect(planRun({ packs, cache, briefing: after, briefingOk: true, size: 5 }).totals.verifyReused).toBe(3);
  });

  it('batch geometry is frozen — batch N is the same five feats however little work it carries', () => {
    const many = Array.from({ length: 10 }, (_, i) => pack({ featId: `f${i}` }));
    const cache = cacheFor(many, briefing);
    const moved = many.map((p, i) => (i === 7 ? { ...p, sheetDiff: [{ path: 'ac.total' }] } : p));
    const plan = planRun({ packs: moved, cache, briefing, size: 5 });
    expect(plan.batches).toHaveLength(1);
    // Absolute indices into the frozen sample, which is how both prompts already address feats.
    expect(plan.batches[0]).toMatchObject({ i: 1, from: 5, to: 9, verify: [7] });
    expect(planArgs(plan, 'scripts/audit/plan/').plan.batches).toEqual([{ i: 1, req: [], verify: [7], carried: 1 }]);
  });
});

describe('folding a run back into the cache', () => {
  const packs = [pack({ featId: 'a' }), pack({ featId: 'b' })];

  it('stores each answer under the hash of the input it was computed from', () => {
    const plan = planRun({ packs, briefing, size: 5 });
    const { cache, rejected } = foldResults({
      plan, packs, briefing,
      fresh: {
        requirements: [{ featId: 'a', requirements: requirement() }],
        verdicts: [verdict({ featId: 'a' })],
      },
      now: 'now',
    });
    expect(rejected).toEqual([]);
    expect(cache.entries.a.requirements).toMatchObject({ textHash: textHashOf(packs[0]), briefingHash: briefing.extract });
    expect(cache.entries.a.verdict).toMatchObject({
      evidenceHash: evidenceHashOf(packs[0]), briefingHash: briefing.verify,
      requirementsHash: requirementsHashOf(requirement()),
    });
    // A second run over the same app now asks nothing about `a`.
    expect(planRun({ packs, cache, briefing, size: 5 }).feats.a).toMatchObject({ req: 'reuse', verify: 'reuse' });
  });

  it('⚠ REFUSES a result whose evidence moved while the run was in flight', () => {
    // The run takes an hour. Regenerating evidence during it and then folding would stamp a verdict
    // with the hash of a pack the reader never saw — poisoning the cache permanently.
    const plan = planRun({ packs, briefing, size: 5 });
    const changed = [{ ...packs[0], sheetDiff: [{ path: 'ac.total' }] }, packs[1]];
    const { cache, rejected } = foldResults({
      plan, packs: changed, briefing,
      fresh: { requirements: [{ featId: 'a', requirements: requirement() }], verdicts: [verdict({ featId: 'a' })] },
    });
    expect(rejected).toEqual([{ featId: 'a', why: 'the evidence changed while the run was in flight' }]);
    expect(cache.entries.a).toBeUndefined();
  });

  it('keeps the requirements a verdict was actually judged from when phase 1 was skipped', () => {
    const cache0 = cacheFor(packs, briefing);
    const moved = [{ ...packs[0], sheetDiff: [{ path: 'ac.total' }] }, packs[1]];
    const plan = planRun({ packs: moved, cache: cache0, briefing, size: 5 });
    const { cache } = foldResults({
      cache: cache0, plan, packs: moved, briefing,
      fresh: { requirements: [], verdicts: [verdict({ featId: 'a', verdict: 'missing', half: 'sheet' })] },
    });
    expect(cache.entries.a.verdict.requirementsHash).toBe(requirementsHashOf(requirement()));
    expect(cache.entries.a.verdict.value.verdict).toBe('missing');
    expect(cache.entries.a.requirements.value).toEqual(requirement());
  });
});

describe('the complete result is the CACHE, not the run', () => {
  const packs = [pack({ featId: 'a' }), pack({ featId: 'b' }), pack({ featId: 'c' })];

  it('assembles all 500 from stored entries, so a short run cannot look like clean coverage', () => {
    const cache = cacheFor(packs, briefing);
    cache.entries.b.verdict.value = verdict({ featId: 'b', verdict: 'missing', half: 'builder', severity: 'high' });
    delete (cache.entries as Record<string, unknown>).c;
    const out = assembleResult({ cache, packs, briefing });
    expect(out.requested).toBe(3);
    expect(out.judged).toBe(2);
    expect(out.missingVerdicts).toEqual(['c']);
    expect(out.missingRequirements).toEqual(['c']);
    expect(out.counts).toMatchObject({ correct: 1, missing: 1 });
    expect(out.defectsByHalf.builder).toBe(1);
    // Every verdict is kept, not only the defects: a `correct` verdict nobody stored cannot be reused,
    // and the previous run threw all 136 of them away.
    expect(out.verdicts).toHaveLength(2);
  });

  it('names verdicts that no longer match their evidence rather than counting them', () => {
    const cache = cacheFor(packs, briefing);
    const moved = packs.map((p, i) => (i === 0 ? { ...p, sheetDiff: [{ path: 'ac.total' }] } : p));
    const out = assembleResult({ cache, packs: moved, briefing });
    expect(out.staleVerdicts).toEqual([{ featId: 'a', why: 'evidence changed' }]);
  });
});

describe('the producers say what moved before a single token is spent', () => {
  it('counts packs unchanged, changed, added and removed between two runs', () => {
    const prev = [{ featId: 'a', hash: '1' }, { featId: 'b', hash: '2' }, { featId: 'gone', hash: '3' }];
    const next = [{ featId: 'a', hash: '1' }, { featId: 'b', hash: '9' }, { featId: 'new', hash: '4' }];
    expect(packDelta(prev, next)).toMatchObject({
      unchanged: 1, changed: ['b'], added: ['new'], removed: ['gone'], comparable: true,
    });
  });

  it('says so when there is nothing to compare against, rather than reporting 0 changed', () => {
    expect(packDelta(null, [{ featId: 'a', hash: '1' }])).toMatchObject({ comparable: false, changed: [] });
    // A previous file written before hashes existed is also not comparable.
    expect(packDelta([{ featId: 'a' }], [{ featId: 'a', hash: '1' }]).comparable).toBe(false);
  });
});

/* ── The workflow itself ──────────────────────────────────────────────────────────────────────── */

type AgentCall = { label: string; prompt: string };

/**
 * The audit workflow is executed by an agent harness, not by node: it uses `agent`, `pipeline` and
 * `log` as free variables and ends in a top-level `return`. Running it here under stubs is the only
 * way to prove that the plan actually SKIPS agents — and skipping the wrong agent is a silent
 * shortfall, the exact failure that disqualified Haiku in the bake-off.
 */
async function runWorkflow(workflowArgs: unknown) {
  const calls: AgentCall[] = [];
  const src = readFileSync(new URL('../scripts/audit/audit-500.js', import.meta.url), 'utf8').replace(/^export const/gm, 'const');
  const agent = async (prompt: string, opts: { label: string }) => {
    calls.push({ label: opts.label, prompt });
    const idx = /indices ([0-9,\s–-]+) of/.exec(prompt)?.[1] ?? '';
    const ids = idx.includes('–')
      ? (() => { const [a, b] = idx.split('–').map((n) => Number(n.trim())); return Array.from({ length: b - a + 1 }, (_, i) => a + i); })()
      : idx.split(',').map((n) => Number(n.trim())).filter((n) => !Number.isNaN(n));
    return opts.label.startsWith('req')
      ? { results: ids.map((i) => ({ featId: `f${i}`, requirements: requirement() })) }
      : { results: ids.map((i) => verdict({ featId: `f${i}` })) };
  };
  const pipeline = async <T, A, B>(items: T[], s1: (t: T) => Promise<A>, s2: (a: A, t: T) => Promise<B>) =>
    Promise.all(items.map(async (it) => s2(await s1(it), it)));
  const fn = new Function('agent', 'pipeline', 'log', 'args', `return (async () => {\n${src}\n})()`);
  const out = await fn(agent, pipeline, () => {}, workflowArgs);
  return { out, calls };
}

describe('the workflow spends agents only where the plan says to', () => {
  it('with no plan it runs everything, exactly as before the cache existed', async () => {
    const { out, calls } = await runWorkflow({});
    expect(calls.filter((c) => c.label.startsWith('req:'))).toHaveLength(100);
    expect(calls.filter((c) => c.label.startsWith('verify:'))).toHaveLength(100);
    expect(out.judged).toBe(500);
    expect(out.cache).toMatchObject({ used: false, reqRecomputed: 500, verifyRecomputed: 500, reqReused: 0 });
  });

  it('with a plan it asks about the planned feats and NOTHING else', async () => {
    const plan = {
      version: 1, size: 5, dir: 'scripts/audit/plan/',
      batches: [
        { i: 3, req: [15, 17], verify: [15, 16, 17], carried: 1 },
        { i: 40, req: [], verify: [201], carried: 1 },
      ],
      totals: { feats: 500, reqRecompute: 2, verifyRecompute: 4, reqReused: 498, verifyReused: 496 },
    };
    const { out, calls } = await runWorkflow({ plan });
    expect(calls.filter((c) => c.label.startsWith('req:'))).toHaveLength(1); // batch 40 needs no extraction
    expect(calls.filter((c) => c.label.startsWith('verify:'))).toHaveLength(2);
    expect(calls.find((c) => c.label === 'req:3')!.prompt).toContain('indices 15, 17');
    expect(calls.find((c) => c.label === 'verify:3')!.prompt).toContain('indices 15, 16, 17');
    // The requirements phase 1 did not re-derive have to reach phase 2 from somewhere.
    expect(calls.find((c) => c.label === 'verify:3')!.prompt).toContain('scripts/audit/plan/batch-003.json');
    expect(calls.find((c) => c.label === 'verify:40')!.prompt).toContain('scripts/audit/plan/batch-040.json');
    expect(out.judged).toBe(4);
    expect(out.cache).toMatchObject({ used: true, reqRecomputed: 2, verifyRecomputed: 4, reqReused: 498, verifyReused: 496 });
    // The output is SHORT BY DESIGN and says so, so nobody reads 4 verdicts as a 500-feat audit.
    expect(out.partial).toBe(true);
    expect(out.requested).toBe(500);
  });

  it('args.force ignores a plan that is present', async () => {
    const plan = { version: 1, size: 5, dir: 'scripts/audit/plan/', batches: [{ i: 0, req: [0], verify: [0], carried: 0 }], totals: {} };
    const { calls } = await runWorkflow({ plan, force: true });
    expect(calls.filter((c) => c.label.startsWith('req:'))).toHaveLength(100);
  });

  it('returns every verdict, not only the defects — a cache cannot store what was thrown away', async () => {
    const { out } = await runWorkflow({});
    expect(out.verdicts).toHaveLength(500);
    expect(out.verdicts[0]).toHaveProperty('featId');
  });
});
