import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergePack, mergeAll, crossChecksFor, harnessLimitsFor } from '../scripts/merge-evidence.mjs';

/**
 * THE MERGE'S OWN TEST.
 *
 * `scripts/merge-evidence.mjs` joins the two evidence producers into the single pack the 500-feat audit
 * reads. It measures nothing itself, which is the point — but it does decide what a reader is TOLD, and
 * two of its decisions are load-bearing:
 *
 *   1. A half that did not run is reported as absent. "The builder asks nothing" and "the builder half
 *      never ran on this feat" are opposite findings that look identical once merged, and the second
 *      quietly reads as the first.
 *   2. An empty sheet diff means something different depending on the other half. On a feat that asks
 *      nothing it is an inert record; on a feat that asks something it is an effect waiting on an
 *      answer. The audit has been reading every empty diff as the first for want of the second half.
 *
 * The fixtures below are the real shapes, cut down: `advanced-maneuver` (empty diff, a live pickFeat
 * picker) and `shooters-camouflage` (a picker whose answer only relabels the feat row) are both packs
 * this merge produced from the frozen 500.
 */

const sheetPack = (over: Record<string, unknown> = {}) => ({
  featId: 'f', name: 'F', level: 4, category: 'class', traits: ['fighter'],
  actionCost: null, text: 'Full text of the feat.', placed: true,
  host: { classId: 'fighter', ancestryId: 'human', level: 20, slot: '4:class:0' },
  storedFields: { level: 4 }, registries: [], textNumbers: [],
  sheetDiff: [], sheetDiffTruncated: 0,
  ...over,
});

const builderPack = (over: Record<string, unknown> = {}) => ({
  featId: 'f', name: 'F', level: 4, category: 'class', traits: ['fighter'],
  text: 'Full text of the fe', placed: true, slotRendered: true,
  host: { classId: 'fighter', ancestryId: 'human', level: 20, slot: '4:class:0' },
  declared: [], choiceCount: 0, presentsChoices: [], answerIsRead: [],
  unansweredState: { pickersLeftBlank: 0, silentDefaults: [] },
  eligibleHosts: ['fighter/human'], nativeHostEligible: true,
  checks: { declaredWithoutPicker: [], pickerWithZeroOptions: [], zeroOptionsHostDependent: [], answerNotRead: [], answerEchoOnly: [] },
  ...over,
});

const picker = (over: Record<string, unknown> = {}) => ({
  lane: 'choice', declaredBy: 'record.choice', control: 'select', prompt: 'Choose one',
  kind: 'array', key: '4:class:0', storage: 'featChoices', optionCount: 2, options: ['A', 'B'], optionsTruncated: 0,
  ...over,
});

const answer = (over: Record<string, unknown> = {}) => ({
  key: '4:class:0', lane: 'choice', storage: 'featChoices', prompt: 'Choose one', kind: 'array',
  optionCount: 2, answers: ['a', 'b'], moved: true, movedPaths: ['skills.stealth.rank'],
  echoed: true, silentDefault: false, verdict: 'read',
  ...over,
});

describe('merge — the sheet half keeps the names the audit prompt uses', () => {
  it('passes sheetDiff, storedFields, registries and textNumbers straight through', () => {
    const m = mergePack('f', sheetPack({ sheetDiff: [{ path: 'ac.total', before: 30, after: 31 }], registries: ['situationalBonuses'] }), builderPack());
    expect(m.sheetDiff).toHaveLength(1);
    expect(m.registries).toEqual(['situationalBonuses']);
    expect(m.storedFields).toEqual({ level: 4 });
    expect(m.textNumbers).toEqual([]);
    expect(m.halves).toEqual({ sheet: true, builder: true });
  });

  it("prefers the sheet half's full text — the builder half truncates it at 900 chars", () => {
    const m = mergePack('f', sheetPack(), builderPack());
    expect(m.text).toBe('Full text of the feat.');
    // …and falls back rather than emitting an empty string when only the truncated one exists.
    expect(mergePack('f', undefined, builderPack()).text).toBe('Full text of the fe');
  });
});

describe('merge — a half that did not run is ABSENT, never silence', () => {
  it('reports halves.builder false and does not claim the feat asks nothing', () => {
    const m = mergePack('f', sheetPack(), undefined);
    expect(m.halves).toEqual({ sheet: true, builder: false });
    expect(m.builder).toBeNull();
    // The trap: `choiceCount ?? 0` would make a missing half indistinguishable from a feat with no
    // choices, and every un-run feat would read as "asks nothing" — a defect the merge invented.
    expect(m.crossChecks.asksNothing).toBe(false);
    expect(m.crossChecks.silentOnBothHalves).toBe(false);
  });

  it('reports halves.sheet false without inventing an empty diff', () => {
    const m = mergePack('f', undefined, builderPack());
    expect(m.halves.sheet).toBe(false);
    expect(m.sheetDiff).toBeNull();
    expect(m.crossChecks.sheetSilent).toBe(false);
  });
});

describe('merge — the facts that need both halves', () => {
  it('empty diff + asks nothing = silent on both halves', () => {
    const c = crossChecksFor(sheetPack(), builderPack());
    expect(c.silentOnBothHalves).toBe(true);
    expect(c.sheetSilentButBuilderAsks).toBe(false);
  });

  it('empty diff + a live picker is NOT "changes nothing" — advanced-maneuver', () => {
    // The real case: a pick-a-feat grant. The sheet half diffs a character with no pick made, so it is
    // empty by construction; the builder half shows the picker and its answer moving owned feats.
    const c = crossChecksFor(
      sheetPack({ registries: ['featPickGrants'] }),
      builderPack({ choiceCount: 1, presentsChoices: [picker({ lane: 'pickFeat', optionCount: 41 })], answerIsRead: [answer({ lane: 'pickFeat' })] }),
    );
    expect(c.silentOnBothHalves).toBe(false);
    expect(c.sheetSilentButBuilderAsks).toBe(true);
    expect(c.sheetSilentAndNoAnswerRead).toBe(false);
  });

  it('empty diff + a picker no answer moves = both halves failing on one feat', () => {
    const c = crossChecksFor(
      sheetPack(),
      builderPack({ choiceCount: 1, presentsChoices: [picker()], answerIsRead: [answer({ verdict: 'echo-only', moved: false, movedPaths: [] })] }),
    );
    expect(c.sheetSilentAndNoAnswerRead).toBe(true);
    expect(c.answersNothingReads).toEqual([{ key: '4:class:0', verdict: 'echo-only', prompt: 'Choose one' }]);
  });

  it('a moving sheet + a decorative answer is the Q20 case, not the inert one — shooters-camouflage', () => {
    const c = crossChecksFor(
      sheetPack({ sheetDiff: [{ path: 'situational.stealth', before: null, after: 'x' }] }),
      builderPack({ choiceCount: 1, presentsChoices: [picker()], answerIsRead: [answer({ verdict: 'echo-only', moved: false })] }),
    );
    expect(c.answerDeadButSheetMoves).toBe(true);
    expect(c.sheetSilentAndNoAnswerRead).toBe(false);
  });

  it('the language lane\'s slot-budget counts as the answer being read', () => {
    // Writing a language into the build moves character.languages by construction, so the producer
    // measures the BUDGET instead. Treating `slot-budget` as unread would report every language feat
    // as a dead choice.
    const c = crossChecksFor(
      sheetPack(),
      builderPack({ choiceCount: 1, presentsChoices: [picker({ lane: 'language', slotsGranted: 1 })], answerIsRead: [answer({ lane: 'language', verdict: 'slot-budget', moved: false })] }),
    );
    expect(c.sheetSilentAndNoAnswerRead).toBe(false);
  });

  it('hoists the builder-only checks the sheet half is structurally blind to', () => {
    const c = crossChecksFor(sheetPack(), builderPack({
      eligibleHosts: [],
      checks: { declaredWithoutPicker: ['record.choice'], pickerWithZeroOptions: ['record.effectChoices[x]'], zeroOptionsHostDependent: [], answerNotRead: [], answerEchoOnly: [] },
    }));
    expect(c.declaredWithoutPicker).toEqual(['record.choice']);
    expect(c.pickerWithZeroOptions).toEqual(['record.effectChoices[x]']);
    expect(c.offeredToNoReferenceHost).toBe(true);
  });
});

describe('merge — the harness limits become facts in the pack, not caveats to remember', () => {
  it('a pick-a-feat grant explains its own empty diff, with the picker as the evidence', () => {
    const limits = harnessLimitsFor(
      sheetPack({ registries: ['featPickGrants'] }),
      builderPack({ choiceCount: 1, presentsChoices: [picker({ lane: 'pickFeat', optionCount: 41 })] }),
    );
    const l = limits.find((x: { limit: string }) => x.limit === 'pick-a-feat-grant');
    expect(l).toBeTruthy();
    expect(l.affects).toBe('sheetDiff');
    expect(l.why).toContain('41');
  });

  it('a companionGrants registry hit is stated; a text mention is only a CANDIDATE', () => {
    const fromRegistry = harnessLimitsFor(sheetPack({ registries: ['companionGrants'] }), builderPack());
    expect(fromRegistry.map((x: { limit: string }) => x.limit)).toContain('companion-tab');

    const fromText = harnessLimitsFor(sheetPack({ text: 'Your eidolon gains a +2 bonus.' }), builderPack());
    const l = fromText.find((x: { limit: string }) => x.limit === 'companion-tab?');
    expect(l).toBeTruthy();
    expect(l.why).toContain('CANDIDATE');

    // A feat naming nothing on another sheet must not be flagged — a noisy limit is a limit nobody reads.
    expect(harnessLimitsFor(sheetPack(), builderPack())).toEqual([]);
  });

  it('an empty option list caused by the reference host owning nothing is named as the host, not the app', () => {
    const limits = harnessLimitsFor(sheetPack(), builderPack({
      checks: { declaredWithoutPicker: [], pickerWithZeroOptions: [], zeroOptionsHostDependent: ['record.choice'], answerNotRead: [], answerEchoOnly: [] },
    }));
    expect(limits.map((x: { limit: string }) => x.limit)).toContain('host-owns-nothing');
  });

  it('a forced placement says so — the pickers are real, the eligibility is not evidenced', () => {
    const limits = harnessLimitsFor(sheetPack(), builderPack({ slotRendered: false }));
    expect(limits.map((x: { limit: string }) => x.limit)).toContain('forced-placement');
  });

  it('a feat no slot accepted says so — a null diff is not an empty one', () => {
    // The sheet producer emits `{featId, name, placed: false}` and no diff at all. Without this, the
    // reader sees `sheetDiff: null` next to 499 feats where null would mean "nothing moved".
    const limits = harnessLimitsFor({ featId: 'f', name: 'F', placed: false }, builderPack());
    expect(limits.map((x: { limit: string }) => x.limit)).toContain('sheet-unplaceable');
    expect(crossChecksFor({ featId: 'f', name: 'F', placed: false }, builderPack()).sheetSilent).toBe(false);
  });

  it('a daily choice is not a dead answer — Q23 puts it in Daily preparations', () => {
    const limits = harnessLimitsFor(sheetPack(), builderPack({ answerIsRead: [answer({ verdict: 'daily', moved: false })] }));
    expect(limits.map((x: { limit: string }) => x.limit)).toContain('daily-choice');
  });
});

describe('merge — completion accounting', () => {
  it('orders packs by the frozen sample, because the audit slices batches BY INDEX', () => {
    const out = mergeAll(['c', 'a', 'b'], [sheetPack({ featId: 'a' }), sheetPack({ featId: 'b' }), sheetPack({ featId: 'c' })], []);
    expect(out.packs.map((p: { featId: string }) => p.featId)).toEqual(['c', 'a', 'b']);
  });

  it('counts each half separately, so a short half cannot hide in a plausible total', () => {
    const out = mergeAll(['a', 'b'], [sheetPack({ featId: 'a' }), sheetPack({ featId: 'b' })], [builderPack({ featId: 'a' })]);
    expect(out.totals.feats).toBe(2);
    expect(out.totals.bothHalves).toBe(1);
    expect(out.totals.sheetOnly).toBe(1);
  });

  it('a feat in neither half is a pack that says so, not a gap in the array', () => {
    const out = mergeAll(['a'], [], []);
    expect(out.packs[0]).toMatchObject({ featId: 'a', missing: true, halves: { sheet: false, builder: false } });
    expect(out.totals.neither).toBe(1);
  });
});

describe('merge — the audit prompt and the pack must name the same fields', () => {
  it('every pack field the verify prompt tells the reader to read actually exists', () => {
    /*
     * The prompt is a string in a workflow script and the pack is JSON from another script; nothing
     * else connects them. This project has shipped a field written by one side and read by nobody more
     * than once, and the same shape here would send 500 Opus reads looking for a key that is not there.
     */
    const prompt = readFileSync(new URL('../scripts/audit/audit-500.js', import.meta.url), 'utf8');
    const m = mergePack('f', sheetPack(), builderPack({ choiceCount: 1, presentsChoices: [picker()], answerIsRead: [answer()] }));
    const named: [string, unknown][] = [
      ['sheetDiff', m.sheetDiff],
      ['storedFields', m.storedFields],
      ['registries', m.registries],
      ['textNumbers', m.textNumbers],
      ['builder.presentsChoices', m.builder!.presentsChoices],
      ['builder.answerIsRead', m.builder!.answerIsRead],
      ['builder.eligibleHosts', m.builder!.eligibleHosts],
      ['builder.unansweredState', m.builder!.unansweredState],
      ['builder.declared', m.builder!.declared],
      ['crossChecks', m.crossChecks],
      ['harnessLimits', m.harnessLimits],
    ];
    for (const [path, value] of named) {
      expect(prompt.includes(path), `the verify prompt never mentions \`${path}\``).toBe(true);
      expect(value, `merged pack has no ${path}`).toBeDefined();
    }
  });
});
