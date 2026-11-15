import { describe, expect, it } from 'vitest';
import { loadEngine } from '../scripts/blocks-parity-snapshot.mjs';
import { scanSkillWrites } from '../scripts/skill-write-check.mjs';
import { buildCharacter, deriveBuildFromCharacter, skillLedgerOf, skillOrderLegacyOf, type BuildState } from '../src/rules/build';
import { sheetLoreKeys } from '../src/rules/explain';
import { FEAT_GRANTS, upgradeSteps } from '../src/rules/featGrants';
import {
  applySkillOp,
  compareOrderPath,
  compareSkillEvents,
  judgeScope,
  newSkillLedger,
  replaySkillEvents,
  resolveSkillPass,
  SKILL_PHASE_RANK,
  skillReplayMismatches,
  type SkillEvent,
  type SkillEventPhase,
  type SkillPassResult,
  type SkillRecord,
  type SkillView,
} from '../src/rules/skillPass';
import { skillRankAt, skillRanksAt, skillRanksBeforeSource } from '../src/rules/ranks';
import { PROFICIENCY_RANKS, type ProficiencyRank, type SkillHistory } from '../src/rules/types';
import { content } from './_content';
import { mk, SKILL_ORDER_CASES, slot } from './fixtures/skill-order-cases';

/**
 * GUARD G3 (skill-rank order, plan work/skill-rank-level-by-level/plan.md, WP1): THE SKILL LEDGER HOLDS
 * EVERY SKILL WRITE THE BUILD MAKES.
 *
 * `buildCharacter` records each skill write and judgement (src/rules/skillPass.ts) while it does exactly
 * what it did before. A seq-order replay of the recorded writes must give the live ranks at the resolve
 * point, key for key — for every character of the parity snapshot's sweep, skill-order, Overrides and
 * Tweaks-browser groups, at both trust gates. A write that changes the sheet without being recorded (a
 * recording dropped, a write routed around `skillWrite`) shows here as the character and the key; the
 * source scan (scripts/skill-write-check.mjs, G2) catches the same thing in the code for every path.
 *
 * WP2 (NUMBER 0): every event also carries its PRINT PLACE — the level, the phase inside that level and its
 * order path (plan 1.1, D3, D4). The same sweep checks the place of every event (below), and the level
 * table checks one source per row of plan 1.1 against the print. Synthetic characters only.
 */

const GROUPS = /^(sweep-filled|skillorder|overrides|tweaks-browser):/;
const PHASES = new Set(Object.keys(SKILL_PHASE_RANK));

/** Every way an event's place can be wrong (WP2): empty = every event is placed inside the character. */
function placeProblems(events: readonly SkillEvent[], level: number): string[] {
  const out: string[] = [];
  const judges = new Map<number, SkillEvent>();
  for (const e of events) if (e.kind === 'judge') judges.set(e.seq, e);
  for (const e of events) {
    const at = `#${e.seq} ${e.source} ${e.kind}`;
    if (!Number.isInteger(e.level) || e.level < 1 || e.level > level) out.push(`${at}: level ${e.level} outside 1..${level}`);
    if (!PHASES.has(e.phase)) out.push(`${at}: unknown phase ${e.phase}`);
    if (e.phase === 'create' && e.level !== 1) out.push(`${at}: creation phase at level ${e.level}`);
    if (!Array.isArray(e.orderPath) || !e.orderPath.every((n) => Number.isFinite(n))) out.push(`${at}: order path ${JSON.stringify(e.orderPath)}`);
    if (e.kind === 'ladder') {
      const j = judges.get(e.of);
      if (!j) out.push(`${at}: ladder of #${e.of}, which is no judge`);
      else if (e.level <= j.level) out.push(`${at}: ladder step at ${e.level}, not after its judge's level ${j.level}`);
      else if (j.source !== e.source || j.phase !== e.phase) out.push(`${at}: ladder placed apart from its judge (${j.source} ${j.phase})`);
    }
    if (e.kind === 'write' && e.by !== undefined) {
      const j = judges.get(e.by);
      if (!j) out.push(`${at}: written by #${e.by}, which is no judge`);
      else if (j.level !== e.level || j.phase !== e.phase || compareOrderPath(j.orderPath, e.orderPath) !== 0)
        out.push(`${at}: an effect placed apart from its judge (judge L${j.level} ${j.phase}, write L${e.level} ${e.phase})`);
    }
  }
  return out;
}

/** The size cap of one character's skill history, as JSON (plan 1.4, G4). */
const HISTORY_MAX_BYTES = 16 * 1024;

/**
 * GUARD G4 (WP3): every way the print pass's history can disagree with its own result — replaying the steps (the
 * last `to` of each key) gives the pre-clamp print skills; every `skillFallbacks` entry has its `redirect` step
 * (same record, same key); the steps run in print order (level, then phase; the final pass last); the JSON stays
 * under the cap. Empty = the history is sound.
 */
function historyProblems(print: SkillPassResult): string[] {
  const out: string[] = [];
  const h = print.history;
  const last: Partial<Record<string, ProficiencyRank>> = {};
  for (const s of h.steps) last[s.key] = s.to;
  const keys = new Set([...Object.keys(last), ...Object.keys(print.skills)]);
  for (const k of keys) {
    const want = (print.skills as Record<string, ProficiencyRank>)[k] ?? 'untrained';
    const got = last[k] ?? 'untrained';
    if (want !== got) out.push(`replay ${k}: history ${got}, skills ${want}`);
  }
  for (const f of print.fallbacks)
    if (!h.steps.some((s) => s.note === 'redirect' && s.key === f.skill && s.source.slice(s.source.indexOf(':') + 1) === f.featId))
      out.push(`fallback ${f.featId}:${f.skill} has no redirect step`);
  let seenFinal = false;
  h.steps.forEach((s, i) => {
    if (s.phase === 'final') seenFinal = true;
    else if (seenFinal) out.push(`step ${i} (${s.source}) is a level step after the final pass`);
    const p = h.steps[i - 1];
    if (p && p.phase !== 'final' && s.phase !== 'final' && (s.level - p.level || SKILL_PHASE_RANK[s.phase] - SKILL_PHASE_RANK[p.phase]) < 0)
      out.push(`step ${i} (${s.source} L${s.level} ${s.phase}) before step ${i - 1} (${p.source} L${p.level} ${p.phase})`);
  });
  for (const [src, i] of Object.entries(h.at)) if (!Number.isInteger(i) || i < 0 || i > h.steps.length) out.push(`at[${src}] = ${i} outside the steps`);
  /* The readers' `without` replay (ranks.ts replayStep) with nothing left out must give the stored `to` of every
   * step: each kept step re-applied from the running rank lands where the pass put it (checker finding 2, WP3). */
  if (h.steps.length) {
    const top = Math.max(...h.steps.map((s) => s.level));
    const replayed = skillRanksAt({ skillHistory: h }, top, 'end', { without: new Set(['\u0000none']) }) ?? {};
    for (const k of new Set([...Object.keys(last), ...Object.keys(replayed)]))
      if ((replayed as Record<string, string>)[k] !== last[k]) out.push(`replay-without ${k}: replayed ${(replayed as Record<string, string>)[k]}, stored ${last[k]}`);
  }
  const bytes = JSON.stringify(h).length;
  if (bytes > HISTORY_MAX_BYTES) out.push(`history is ${bytes} bytes (cap ${HISTORY_MAX_BYTES})`);
  return out;
}

/**
 * THE `rank` FIELD (skill-order WP6L item 1, the WP3 checker's minor): the engine must write `SkillStep.rank` on
 * every step whose write ASKED for less than the rank it found (a feat that trains a skill already expert), or a
 * `without` replay (ranks.ts) that leaves out the earlier record re-applies the higher rank it found. Checked
 * against the EVENTS, not against the formula in skillPass.ts: for every step that has exactly one asking event —
 * a plain write (its op and rank), a ladder step (its rank), or a judge (re-run on the main view rebuilt from the
 * history up to its first step; a judge whose answer moves with `hasFeat`, or reads another view, is not checked) —
 * replaying that one step from untrained through the reader must give what the write asked for. Steps a replay
 * re-applies as they stand (creation, an old `=` / moved "exactly", an increase, a stored pick, the final pass, a
 * redirect / drop / swallow / cap) are not raises and are left out. `needed` counts the steps where the field is
 * what makes the replay right (asked below what the step found).
 */
function rankFieldProblems(events: readonly SkillEvent[], h: SkillHistory, locks: Readonly<Record<string, string>>): { problems: string[]; checked: number; needed: number; unchecked: number } {
  const problems: string[] = [];
  let checked = 0;
  let needed = 0;
  let unchecked = 0;
  const ri = (r: ProficiencyRank) => PROFICIENCY_RANKS.indexOf(r);
  const running: Partial<Record<string, ProficiencyRank>> = {};
  const before: Partial<Record<string, ProficiencyRank>>[] = [];
  h.steps.forEach((st, i) => {
    before[i] = { ...running };
    running[st.key] = st.to;
  });
  h.steps.forEach((st, i) => {
    if (st.note && st.note !== 'same') return;
    if (st.phase === 'create' || st.phase === 'set' || st.phase === 'final' || st.phase === 'increase' || st.source.startsWith('pick:')) return;
    const asking = events.filter((e) => e.source === st.source && e.level === st.level && !(e.kind === 'write' && e.by !== undefined));
    const asked = new Set<ProficiencyRank>();
    let sure = asking.length > 0;
    const take = (op: string, rank: ProficiencyRank | undefined) => {
      if ((op === 'max' || op === 'set') && rank) asked.add(rank);
      else sure = false;
    };
    for (const e of asking) {
      if (e.kind === 'write') {
        if (e.key === st.key) take(e.op, e.rank);
      } else if (e.kind === 'ladder') asked.add(e.rank);
      else {
        if (e.view !== 'main') {
          sure = false;
          continue;
        }
        // The judge's view: the history up to the first step of its run (its effects apply after it read).
        let first = i;
        while (first > 0 && h.steps[first - 1].source === st.source && h.steps[first - 1].level === st.level) first--;
        const view = (hasFeat: boolean): SkillView => ({ rank: (k) => before[first][k] ?? 'untrained', locked: (k) => k in locks, level: st.level, hasFeat: () => hasFeat, print: true });
        const writes = (v: SkillView) => e.judge(v).flatMap((x) => (x.kind === 'write' && x.key === st.key && !x.pick ? [x] : []));
        const [no, yes] = [writes(view(false)), writes(view(true))];
        if (JSON.stringify(no) !== JSON.stringify(yes)) {
          sure = false;
          continue;
        }
        for (const x of no) take(x.op, x.rank);
      }
    }
    if (!sure || asked.size !== 1) {
      unchecked++;
      return;
    }
    const want = [...asked][0];
    checked++;
    if (st.from === st.to && ri(want) < ri(st.to)) needed++;
    const alone = { skillHistory: { v: 1 as const, steps: [{ ...st, from: 'untrained' as const }], at: {} } };
    const got = skillRankAt(alone, st.key, st.level, 'end', { without: new Set(['\u0000none']) });
    if (got !== want) problems.push(`step ${i} ${st.source} ${st.key} L${st.level}: asked for ${want}, its replay from untrained gives ${got}${st.rank ? '' : ' (no `rank` on the step)'}`);
  });
  return { problems, checked, needed, unchecked };
}

/** Builds that throw in the G3 sweep and are allowed to: none. The baseline built every snapshot character at
 *  both gates (work/skill-rank-level-by-level/state.md, "Lane (5.L)": build/play errors off 0 / on 0), so a
 *  throw is a regression, never a character to skip (skill-order WP6L item 6, the WP1 checker's minor). */
const KNOWN_BUILD_THROWS: readonly string[] = [];

type LedgerOf = (build: BuildState, db: Parameters<typeof skillLedgerOf>[1]) => ReturnType<typeof skillLedgerOf>;

/** THE G3/G4 SWEEP over the given specs at both gates; every list it returns is a failure when non-empty. */
async function ledgerSweep(
  E: Awaited<ReturnType<typeof loadEngine>>,
  specs: readonly { id: string; build: BuildState; dbPatch?: (db: unknown) => unknown }[],
  ledgerOf: LedgerOf = skillLedgerOf,
) {
  const r = { built: 0, threw: [] as string[], bad: [] as string[], misplaced: [] as string[], unsound: [] as string[], rankField: [] as string[], ladders: 0, placedAbove1: 0, largest: 0, redirects: 0, rankChecked: 0, rankNeeded: 0, rankUnchecked: 0 };
  try {
    for (const gate of ['off', 'on'] as const) {
      E.setGate(gate);
      for (const s of specs) {
        const db = s.dbPatch ? s.dbPatch(E.DB[gate]) : E.DB[gate];
        let got: ReturnType<typeof skillLedgerOf>;
        try {
          got = ledgerOf(s.build, db);
        } catch (err) {
          // A throw is a failure (never a skip) unless the snapshot knows this character throws.
          if (!KNOWN_BUILD_THROWS.includes(s.id)) r.threw.push(`${s.id}@${gate}: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
          continue;
        }
        r.built++;
        if (!got) {
          r.bad.push(`${s.id}@${gate}: the build never reached the skill ledger resolve point`);
          continue;
        }
        for (const m of skillReplayMismatches(got.live, got.events)) r.bad.push(`${s.id}@${gate}: ${m}`);
        for (const m of placeProblems(got.events, Math.max(1, s.build.level ?? 1))) r.misplaced.push(`${s.id}@${gate}: ${m}`);
        r.ladders += got.events.filter((e) => e.kind === 'ladder').length;
        r.placedAbove1 += got.events.filter((e) => e.level > 1).length;
        // G4 (WP3): the print pass's history agrees with its own result.
        for (const m of historyProblems(got.print)) r.unsound.push(`${s.id}@${gate}: ${m}`);
        r.largest = Math.max(r.largest, JSON.stringify(got.print.history).length);
        r.redirects += got.print.history.steps.filter((st) => st.note === 'redirect').length;
        // WP6L item 1: every step that asked for less than it found carries `rank`.
        const rf = rankFieldProblems(got.events, got.print.history, got.print.grantedSkills);
        for (const m of rf.problems) r.rankField.push(`${s.id}@${gate}: ${m}`);
        r.rankChecked += rf.checked;
        r.rankNeeded += rf.needed;
        r.rankUnchecked += rf.unchecked;
      }
    }
  } finally {
    E.clearTrustGate();
  }
  return r;
}

describe('the skill ledger replays to the live ranks (G3) and places every event (WP2)', () => {
  it('every snapshot character, both gates: the replay of the recorded writes is the live record, and every event has a place', async () => {
    const E = await loadEngine();
    // The engine and this test must share one build module: the probe lives in its module scope.
    expect(E.buildCharacter).toBe(buildCharacter);
    const specs = E.specs.filter((s: { id: string }) => GROUPS.test(s.id));
    // Every group the plan names is present (a renamed group would make this test vacuous).
    for (const g of ['sweep-filled', 'skillorder', 'overrides', 'tweaks-browser']) expect(specs.some((s: { id: string }) => s.id.startsWith(`${g}:`)), g).toBe(true);
    const { built, threw, bad, misplaced, unsound, rankField, ladders, placedAbove1, largest, redirects, rankChecked, rankNeeded, rankUnchecked } = await ledgerSweep(E, specs);
    // A build that throws is a failure, never a skipped character (WP6L item 6): the baseline built them all.
    expect(threw.slice(0, 40)).toEqual([]);
    expect(built).toBeGreaterThan(1000);
    expect(bad.slice(0, 40)).toEqual([]);
    expect(bad.length).toBe(0);
    expect(misplaced.slice(0, 40)).toEqual([]);
    expect(misplaced.length).toBe(0);
    expect(unsound.slice(0, 40)).toEqual([]);
    expect(unsound.length).toBe(0);
    // Not vacuous: the sweep writes histories and redirect steps; the largest stays under the cap.
    expect(largest).toBeGreaterThan(0);
    expect(largest).toBeLessThanOrEqual(HISTORY_MAX_BYTES);
    expect(redirects).toBeGreaterThan(0);
    // Not vacuous: the sweep reaches ladder steps and events placed above level 1.
    expect(ladders).toBeGreaterThan(0);
    expect(placedAbove1).toBeGreaterThan(100);
    // WP6L item 1: `rank` on every step that asked for less than it found. Measured 2026-10-22: 594 steps checked,
    // 3 where the field is what makes the replay right (AD3-type Alchemist Dedication's Crafting at 4, Kholo Lore's
    // Stealth at 1 on two characters), 22 with no single asking event (a hasFeat-dependent or noMoved judge).
    expect(rankField.slice(0, 40)).toEqual([]);
    expect(rankChecked).toBeGreaterThan(500);
    expect(rankNeeded).toBeGreaterThanOrEqual(3);
    expect(rankUnchecked).toBeLessThan(rankChecked / 10);
  }, 900_000);

  it('a build that throws fails the sweep (it is not skipped): a planted throw is named at both gates', async () => {
    const E = await loadEngine();
    const two = E.specs.filter((s: { id: string }) => GROUPS.test(s.id)).slice(0, 2);
    expect(two.length).toBe(2);
    const plant: LedgerOf = (build, db) => {
      if (build === two[1].build) throw new Error('planted');
      return skillLedgerOf(build, db);
    };
    const r = await ledgerSweep(E, two, plant);
    expect(r.threw).toEqual([`${two[1].id}@off: planted`, `${two[1].id}@on: planted`]);
    expect(r.built).toBe(2);
  });

  it('the print pass writes `rank` on a plain write, a judge write and a ladder step that ask for less than they find — and only there; the check refuses the field stripped', () => {
    const L = newSkillLedger();
    const at = (level: number, phase: SkillEventPhase, n = 0) => ({ level, phase, orderPath: phase === 'feat' ? [1, n] : [] });
    L.write('stealth', 'max', 'expert', { source: 'heritage:h', place: at(1, 'heritage') }); // expert at 1
    L.write('stealth', 'max', 'trained', { source: 'feat:plain', place: at(1, 'feat', 0) }); // asks trained: rank
    const jj = L.judge({ source: 'feat:judged', place: at(1, 'feat', 1) }, 'main', () => [{ kind: 'write', key: 'stealth', op: 'max', rank: 'trained', upgrade: true }], []);
    L.ladder(jj, 'expert', { source: 'feat:judged', place: at(3, 'feat', 1) }); // asks expert, finds expert: no rank
    L.write('arcana', 'max', 'master', { source: 'heritage:h2', place: at(5, 'heritage') });
    const jl = L.judge({ source: 'feat:ladder', place: at(1, 'feat', 2) }, 'main', () => [{ kind: 'write', key: 'arcana', op: 'max', rank: 'trained', upgrade: true }], []);
    L.ladder(jl, 'expert', { source: 'feat:ladder', place: at(7, 'feat', 2) }); // asks expert, finds master: rank
    L.write('society', 'max', 'trained', { source: 'feat:raise', place: at(2, 'feat', 0) }); // a real raise: no rank
    const p = resolveSkillPass(L.events, { level: 7, featRows: [], prereqs: new Map() });
    const of = (source: string, key: string, level: number) => p.history.steps.find((s) => s.source === source && s.key === key && s.level === level);
    expect(of('feat:plain', 'stealth', 1)).toMatchObject({ from: 'expert', to: 'expert', note: 'same', rank: 'trained' });
    expect(of('feat:judged', 'stealth', 1)).toMatchObject({ from: 'expert', to: 'expert', note: 'same', rank: 'trained' });
    expect(of('feat:judged', 'stealth', 3)?.rank).toBeUndefined();
    expect(of('feat:ladder', 'arcana', 7)).toMatchObject({ from: 'master', to: 'master', rank: 'expert' });
    expect(of('feat:raise', 'society', 2)?.rank).toBeUndefined();
    const clean = rankFieldProblems(L.events, p.history, {});
    expect(clean.problems).toEqual([]);
    expect([clean.needed, clean.unchecked]).toEqual([3, 0]);
    // Planted: the same history with every `rank` stripped — the check names exactly the three steps.
    const stripped = { ...p.history, steps: p.history.steps.map(({ rank: _rank, ...st }) => st) };
    const bad = rankFieldProblems(L.events, stripped, {}).problems;
    expect(bad.map((m) => m.replace(/^step \d+ /, '').replace(/: asked for .*/, ''))).toEqual(['feat:plain stealth L1', 'feat:judged stealth L1', 'feat:ladder arcana L7']);
    expect(bad.every((m) => /no `rank` on the step/.test(m))).toBe(true);
  });

  it('the place check refuses a planted bad place (it is not vacuous)', () => {
    const L = newSkillLedger();
    const j = L.judge({ source: 'feat:x', place: { level: 2, phase: 'feat', orderPath: [1, 0] } }, 'main', () => [], []);
    L.write('arcana', 'max', 'trained', { source: 'feat:x', place: { level: 3, phase: 'feat', orderPath: [1, 0] } }, j);
    L.ladder(j, 'expert', { source: 'feat:x', place: { level: 2, phase: 'feat', orderPath: [1, 0] } });
    L.write('stealth', 'max', 'trained', { source: 'heritage:y', place: { level: 3, phase: 'create' } });
    L.write('society', 'max', 'trained', { source: 'heritage:z', place: { level: 9, phase: 'heritage' } });
    const got = placeProblems(L.events, 5);
    expect(got.some((m) => /an effect placed apart from its judge/.test(m))).toBe(true);
    expect(got.some((m) => /ladder step at 2, not after/.test(m))).toBe(true);
    expect(got.some((m) => /creation phase at level 3/.test(m))).toBe(true);
    expect(got.some((m) => /level 9 outside 1..5/.test(m))).toBe(true);
  });

  it('the history check (G4) refuses a planted bad history: a dropped last step, a lost redirect, steps out of order, an oversize one', () => {
    const got = skillLedgerOf(caseBuild('K2'), content())!;
    expect(historyProblems(got.print)).toEqual([]);
    expect(got.print.fallbacks.length).toBeGreaterThan(0);
    const drop = { ...got.print, history: { ...got.print.history, steps: got.print.history.steps.slice(0, -1) } };
    expect(historyProblems(drop).some((m) => /^replay /.test(m))).toBe(true);
    const noRedirect = { ...got.print, history: { ...got.print.history, steps: got.print.history.steps.map((s) => (s.note === 'redirect' ? { ...s, note: undefined } : s)) } };
    expect(historyProblems(noRedirect).some((m) => /has no redirect step/.test(m))).toBe(true);
    const swapped = { ...got.print, history: { ...got.print.history, steps: [...got.print.history.steps].reverse() } };
    expect(historyProblems(swapped).some((m) => / before step /.test(m))).toBe(true);
    const big = { ...got.print, history: { ...got.print.history, at: { ...got.print.history.at, pad: 0, ['x'.repeat(HISTORY_MAX_BYTES)]: 0 } } };
    expect(historyProblems(big).some((m) => /bytes \(cap/.test(m))).toBe(true);
    // An increase's stored `to` that one step from its running rank cannot reach (its earlier training dropped):
    // the stored ranks still agree, only the `without` replay notices.
    const b2 = skillLedgerOf(caseBuild('B2'), content())!;
    expect(historyProblems(b2.print)).toEqual([]);
    const firstAth = b2.print.history.steps.findIndex((s) => s.key === 'athletics' && s.to !== s.from);
    expect(b2.print.history.steps.slice(firstAth + 1).some((s) => s.key === 'athletics' && s.phase === 'increase')).toBe(true);
    const lostTraining = { ...b2.print, history: { ...b2.print.history, steps: b2.print.history.steps.filter((_s, i) => i !== firstAth) } };
    const lost = historyProblems(lostTraining);
    expect(lost.some((m) => /^replay-without athletics/.test(m))).toBe(true);
    expect(lost.some((m) => /^replay /.test(m))).toBe(false);
  });
});

/* ---------------------------------------------------------------------------------------------------- */
/* THE HISTORY READERS' `without` (checker finding 2, WP3 round 1): a replay, not a filter of stored ranks.  */
/* ---------------------------------------------------------------------------------------------------- */

describe("the history readers' `without`: the kept steps are replayed from the running rank", () => {
  it('rogue 2, Barbarian Dedication in 2:class + an Athletics increase at 2: without the dedication, Athletics is trained (not expert)', () => {
    const db = content();
    const c = buildCharacter(
      mk({ classId: 'rogue', keyAbility: 'dex', ancestryId: 'human', heritageId: 'versatile-human', level: 2, featPicks: { [slot(2, 'rogue', 'class')]: 'barbarian-dedication' }, skillIncreases: { 2: 'athletics' } }),
      db,
    );
    // The premise: the dedication trains Athletics at 2, then the 2nd-level increase makes it expert.
    const ath = c.skillHistory!.steps.filter((s) => s.key === 'athletics' && s.to !== s.from).map((s) => `${s.source}:${s.from}>${s.to}`);
    expect(ath).toEqual(['feat:barbarian-dedication:untrained>trained', 'increase:2:trained>expert']);
    expect(skillRankAt(c, 'athletics', 2, 'end')).toBe('expert');
    expect(skillRankAt(c, 'athletics', 2, 'end', { without: new Set(['barbarian-dedication']) })).toBe('trained');
    // An empty `without` is the plain reading.
    expect(skillRankAt(c, 'athletics', 2, 'end', { without: new Set() })).toBe('expert');
  });

  const h = (steps: SkillHistory['steps']): { skillHistory: SkillHistory } => ({ skillHistory: { v: 1, steps, at: { 'feat:b': 1 } } });
  const ex = new Set(['a']);

  it('a write that changed nothing re-applies the rank it asked for (`rank`), not the higher rank it found', () => {
    // a makes Stealth expert at 1; b trains it at 2 (no change, asked for trained); without a → trained.
    const c = h([
      { level: 1, phase: 'feat', key: 'stealth', from: 'untrained', to: 'expert', source: 'feat:a' },
      { level: 2, phase: 'feat', key: 'stealth', from: 'expert', to: 'expert', source: 'feat:b', note: 'same', rank: 'trained' },
    ]);
    expect(skillRankAt(c, 'stealth', 2, 'end')).toBe('expert');
    expect(skillRankAt(c, 'stealth', 2, 'end', { without: ex })).toBe('trained');
    // A no-change write with no `rank` asked for exactly what it found.
    const same = h([
      { level: 1, phase: 'feat', key: 'stealth', from: 'untrained', to: 'trained', source: 'feat:a' },
      { level: 2, phase: 'feat', key: 'stealth', from: 'trained', to: 'trained', source: 'feat:b', note: 'same' },
    ]);
    expect(skillRankAt(same, 'stealth', 2, 'end', { without: ex })).toBe('trained');
  });

  it('a redirect, a dropped increase and a swallowed write add nothing; a capped increase steps once; a set lands on its rank', () => {
    const c = h([
      { level: 1, phase: 'feat', key: 'stealth', from: 'untrained', to: 'trained', source: 'feat:a' },
      { level: 2, phase: 'feat', key: 'stealth', from: 'trained', to: 'trained', source: 'feat:b', note: 'redirect' },
      { level: 3, phase: 'increase', key: 'arcana', from: 'untrained', to: 'untrained', source: 'increase:3', note: 'drop' },
      { level: 3, phase: 'increase', key: 'stealth', from: 'trained', to: 'expert', source: 'increase:3' },
      { level: 5, phase: 'increase', key: 'stealth', from: 'expert', to: 'expert', source: 'increase:5', note: 'cap' },
      { level: 6, phase: 'set', key: 'society', from: 'untrained', to: 'expert', source: 'set:society' },
      { level: 6, phase: 'feat', key: 'society', from: 'expert', to: 'expert', source: 'feat:c', note: 'swallow' },
    ]);
    expect(skillRanksAt(c, 6, 'end', { without: ex })).toEqual({ stealth: 'expert', arcana: 'untrained', society: 'expert' });
    // Plain: the stored `to`s.
    expect(skillRanksAt(c, 6, 'end')).toEqual({ stealth: 'expert', arcana: 'untrained', society: 'expert' });
    // Without a, the 3rd-level increase makes it trained and the 5th-level one (capped at expert) expert.
    expect(skillRankAt(c, 'stealth', 3, 'end', { without: ex })).toBe('trained');
    // skillRanksBeforeSource takes the same replay.
    expect(skillRanksBeforeSource(c, 'feat:b', { without: ex })).toEqual({});
  });
});

/* ---------------------------------------------------------------------------------------------------- */
/* CLASS-PICKED LORES KEEP THE PLAYER'S PICK ORDER (skill order WP6L item 3, the WP6 checker's minor 1).   */
/* ---------------------------------------------------------------------------------------------------- */

describe("class-picked Lores keep the player's pick order on the sheet", () => {
  // WP6 wrote the class picks in sorted key order (so a round-trip's history matched), which listed a player's
  // picked Lores alphabetically. No rule orders them: the engine's output order is the order the player picked,
  // as it was before (WP0 engine, measured with the same builds: warfare, academia / academia, warfare).
  const fighter = (classSkills: string[]) => mk({ classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human', level: 1, classSkills: classSkills as BuildState['classSkills'] });
  const picked = (c: ReturnType<typeof buildCharacter>, lores: string[]) => sheetLoreKeys(c).filter((k) => lores.includes(k));
  it('either order: the sheet lists the picked Lores as picked, and the history writes them in that order', () => {
    const db = content();
    const pickSteps = (c: ReturnType<typeof buildCharacter>) => c.skillHistory!.steps.filter((s) => s.source === 'classPick:fighter').map((s) => s.key);
    for (const order of [['lore:warfare', 'lore:academia'], ['lore:academia', 'lore:warfare']]) {
      const c = buildCharacter(fighter([order[0], 'stealth', order[1]]), db);
      expect(picked(c, order)).toEqual(order);
      expect(pickSteps(c)).toEqual(['stealth', ...order]);
    }
    // The sixteen skills keep the record's own (seeded) order, whatever order they were picked in.
    expect(pickSteps(buildCharacter(fighter(['stealth', 'lore:warfare', 'arcana']), db))).toEqual(['arcana', 'stealth', 'lore:warfare']);
  });
  it('a round-trip through the reverse build keeps the Lore order and the history', () => {
    const db = content();
    const c = buildCharacter(fighter(['lore:warfare', 'stealth', 'lore:academia']), db);
    const back = deriveBuildFromCharacter(c, db);
    expect(back.classSkills.filter((k) => k.startsWith('lore:'))).toEqual(['lore:warfare', 'lore:academia']);
    expect(buildCharacter(back, db).skillHistory).toEqual(c.skillHistory);
  });
});

/* ---------------------------------------------------------------------------------------------------- */
/* THE LANGUAGE-LORE RERUN'S LEGACY SIDE (WP3 step 6b, plan D2): the three branches.                     */
/* ---------------------------------------------------------------------------------------------------- */

describe("the language-Lore rerun's legacy side (WP3 6b): skillOrderLegacyOf is today's engine on every branch", () => {
  const db = content();
  const nonUntrained = (s: Record<string, ProficiencyRank>) => Object.fromEntries(Object.entries(s).filter(([, r]) => r !== 'untrained').sort(([a], [b]) => a.localeCompare(b)));
  const shiskL7 = (o: Partial<BuildState>) =>
    mk({
      classId: 'fighter', ancestryId: 'shisk', heritageId: 'lorekeeper-shisk', effectChoices: { 'lorekeeper-shisk:int-wis-skill': 'society' },
      level: 7, levelBoosts: ['str', 'con', 'dex', 'int'], variantRules: { loreInsteadOfLanguage: true }, languageLores: ['Sailing'],
      languages: ['common', 'celestial', 'dwarven', 'alghollthu'], skillIncreases: { 3: 'society', 7: 'society' }, ...o,
    });
  /* The literals: today's engine (the WP0 commit 3aa35e9, src/ extracted with `git archive`) built each of these
   * three characters on 2026-10-22; `proficiencies.skills`, every rank above untrained. */
  const SHISK_TODAY = { acrobatics: 'trained', 'lore:scribing': 'trained', religion: 'trained', society: 'expert' };
  const ANIMIST_TODAY = {
    'lore:architecture': 'trained', 'lore:battlegrounds': 'trained', 'lore:engineering': 'trained', 'lore:heraldry': 'trained',
    'lore:mountain': 'trained', 'lore:scribing': 'trained', 'lore:volcano': 'trained', nature: 'trained', religion: 'trained',
  };
  const langLoreEffects = (b: BuildState) =>
    (skillLedgerOf(b, db)!.events.find((e) => e.kind === 'judge' && e.source === 'langLore:int') as { effects: readonly { kind: string; key?: string }[] } | undefined)?.effects
      .filter((x) => x.kind === 'languageLore')
      .map((x) => x.key);

  it('equal: both sides rerun with the same Lores (two Int slots, four languages): the plain rerun, both sides its own', () => {
    const b = shiskL7({});
    const at = skillLedgerOf(b, db)!;
    // Both orders count the Lore, and neither has the slot for it.
    expect(at.print.languageLores).toEqual(['lore:sailing']);
    expect(langLoreEffects(b)).toEqual(['lore:sailing']);
    const c = buildCharacter(b, db);
    expect(c.proficiencies.skills['lore:sailing' as never]).toBeUndefined();
    expect(nonUntrained(skillOrderLegacyOf(c)!.skills)).toEqual(SHISK_TODAY);
  });

  it('print only: the print order counts a Lore today\'s order found trained (the third apparition at 7), and only print reruns', () => {
    const b = mk({
      classId: 'animist', keyAbility: 'wis', ancestryId: 'human', heritageId: 'versatile-human', level: 7,
      extraChoices: { apparition: ['steward-of-stone-and-fire', 'witness-to-ancient-battles', 'crafter-in-the-vault'] },
      levelBoosts: ['wis', 'con', 'dex', 'int'], variantRules: { loreInsteadOfLanguage: true }, languageLores: ['Architecture'],
      languages: ['common', 'celestial', 'dwarven'],
    });
    const at = skillLedgerOf(b, db)!;
    expect(at.print.languageLores).toEqual(['lore:architecture']);
    expect(langLoreEffects(b)).toEqual([]);
    const c = buildCharacter(b, db);
    // The print rerun drops the Lore (the picked languages win), so the three languages stay.
    expect(c.languages).toEqual(['common', 'celestial', 'dwarven']);
    expect(nonUntrained(skillOrderLegacyOf(c)!.skills)).toEqual(ANIMIST_TODAY);
  });

  it('legacy only: LL1 — print\'s master Society gives Multilingual\'s slot, today\'s expert does not: the legacy is the extra build\'s', () => {
    const b = shiskL7({ featPicks: { [slot(3, 'fighter', 'general')]: 'multilingual' } });
    const c = buildCharacter(b, db);
    expect(c.proficiencies.skills['lore:sailing' as never]).toBe('trained');
    expect(c.proficiencies.skills.society).toBe('master');
    expect(nonUntrained(skillOrderLegacyOf(c)!.skills)).toEqual(SHISK_TODAY);
  });

  it('a character the engine did not return has no legacy (a copy)', () => {
    const c = buildCharacter(shiskL7({}), db);
    expect(skillOrderLegacyOf({ ...c })).toBeUndefined();
  });
});

/* ---------------------------------------------------------------------------------------------------- */
/* THE LEVEL TABLE (WP2 step 4): one source per row of plan 1.1 → its print [level, phase, source].       */
/* ---------------------------------------------------------------------------------------------------- */

const caseBuild = (id: string): BuildState => {
  const c = SKILL_ORDER_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`no skill-order case ${id}`);
  return c.build;
};
const DC = { dualClass: true };
const human = (o: Partial<BuildState>) => mk({ classId: 'fighter', ancestryId: 'human', heritageId: 'versatile-human', ...o });
/** The level-table builds that are not guard cases (synthetic). */
const TABLE_BUILDS: Record<string, () => BuildState> = {
  // Animist 16: two apparitions at 1, a third at 7 (pickByLevel 1:2, 7:3). Apparition Lores rise at 8th and 16th
  // (option loreProgression; print checked rung by rung in test/batch033-instruments.test.ts).
  animist16: () => mk({ level: 16, classId: 'animist', keyAbility: 'wis', ancestryId: 'human', heritageId: 'versatile-human', extraChoices: { apparition: ['steward-of-stone-and-fire', 'witness-to-ancient-battles', 'crafter-in-the-vault'] } }),
  // Lorekeeper Shisk 5: print "trained in one Lore skill and one other Intelligence- or Wisdom-based skill … At 5th level, you become expert in the chosen skills."
  shisk5: () => mk({ level: 5, classId: 'fighter', ancestryId: 'shisk', heritageId: 'lorekeeper-shisk', effectChoices: { 'lorekeeper-shisk:int-wis-skill': 'society' }, heritageLore: ['scribing'] }),
  // Thaumaturge 15: Esoteric Lore, print "At 3rd level … expert …; at 7th level … master …; and at 15th level … legendary".
  thaum15: () => mk({ level: 15, classId: 'thaumaturge', keyAbility: 'cha', ancestryId: 'human', heritageId: 'versatile-human' }),
  // Dual Class fighter + thaumaturge 7: the second class's feature ladder at its own levels (D11).
  dcThaum7: () => human({ level: 7, classId2: 'thaumaturge', variantRules: DC }),
  cleric1: () => mk({ level: 1, classId: 'cleric', keyAbility: 'wis', ancestryId: 'human', heritageId: 'versatile-human', deityId: 'otolmens' }),
  // Free Heart (elf, 1st): a passion background, placed at its feat.
  freeHeart1: () => mk({ level: 1, classId: 'fighter', ancestryId: 'elf', heritageId: 'ancient-elf', featPicks: { [slot(1, 'fighter', 'ancestry')]: 'free-heart' }, featChoices: { [slot(1, 'fighter', 'ancestry')]: 'farmhand' } }),
  // Awakened Yaoguai Heritage at 5 → Born of Item (a heritage Lore): the second heritage sits at its feat's slot.
  yao5: () => mk({ level: 5, classId: 'fighter', ancestryId: 'yaoguai', heritageId: 'born-of-animal', featPicks: { [slot(5, 'fighter', 'ancestry')]: 'awakened-yaoguai-heritage' }, featChoices: { [slot(5, 'fighter', 'ancestry')]: 'born-of-item' }, heritageLore: ['heraldry'] }),
};
const buildOf = (id: string): BuildState => (TABLE_BUILDS[id] ? TABLE_BUILDS[id]() : caseBuild(id));

type Match = { kind: SkillEvent['kind']; source: string; key?: string; rank?: ProficiencyRank; effect?: string; phase?: SkillEventPhase };
const w = (source: string, key: string, rank?: ProficiencyRank): Match => ({ kind: 'write', source, key, ...(rank ? { rank } : {}) });
const j = (source: string, effect?: string): Match => ({ kind: 'judge', source, ...(effect ? { effect } : {}) });
const ld = (source: string, rank: ProficiencyRank): Match => ({ kind: 'ladder', source, rank });
function matches(e: SkillEvent, m: Match): boolean {
  if (e.kind !== m.kind || e.source !== m.source) return false;
  if (m.phase && e.phase !== m.phase) return false;
  if (e.kind === 'write') return (m.key === undefined || e.key === m.key) && (m.rank === undefined || e.rank === m.rank);
  if (e.kind === 'ladder') return m.rank === undefined || e.rank === m.rank;
  if (e.kind === 'judge' && m.effect) return e.effects.some((x) => x.kind === m.effect || (x.kind === 'write' && `${x.key}=${x.rank}` === m.effect));
  return true;
}

/** [row (plan 1.1), build, the event, the print [level, phase]]. */
const LEVEL_TABLE: [string, string, Match, [number, SkillEventPhase]][] = [
  ['class skills (P0)', 'K1', w('class:fighter', 'acrobatics'), [1, 'create']],
  ['second class skills (P0)', 'dcThaum7', w('class2:thaumaturge', 'lore:esoteric', 'trained'), [1, 'create']],
  ['background skill (P0)', 'K1', w('background:acolyte', 'religion'), [1, 'create']],
  ['class skill pick (P0)', 'OV1', j('classPick:fighter'), [1, 'create']],
  ['Lore instead of a language (P0)', 'LL1', w('langLore:int', 'lore:sailing'), [1, 'create']],
  ["cleric's deity skill (P0)", 'cleric1', w('deity:otolmens', 'crafting'), [1, 'create']],
  ['Tweaks floor at 1 (P1)', 'OV2', w('floor:stealth', 'stealth'), [1, 'floor']],
  ['old Overrides "=" (P2)', 'OV1', w('set:stealth', 'stealth'), [1, 'set']],
  ['heritage skill (P4)', 'AA7b', w('heritage:ancient-ash', 'stealth', 'trained'), [1, 'heritage']],
  ['heritage ladder step: Ancient Ash expert at 5', 'AA7b', w('heritage:ancient-ash', 'stealth', 'expert'), [5, 'heritage']],
  ["Lorekeeper Shisk's Lore trained at creation", 'shisk5', w('heritage:lorekeeper-shisk', 'lore:scribing', 'trained'), [1, 'create']],
  ["Lorekeeper Shisk's Lore EXPERT AT 5", 'shisk5', w('heritage:lorekeeper-shisk', 'lore:scribing', 'expert'), [5, 'heritage']],
  ["Lorekeeper Shisk's other skill expert at 5", 'shisk5', w('heritage:lorekeeper-shisk', 'society', 'expert'), [5, 'heritage']],
  ['skilled human expert at 5', 'OV4', w('heritage:skilled-human', 'athletics', 'expert'), [5, 'heritage']],
  ['second heritage at its feat slot (5)', 'yao5', w('heritage:born-of-item', 'lore:heraldry', 'trained'), [5, 'feat']],
  ['feat-granted background (Free Heart) at its feat', 'freeHeart1', w('background:farmhand', 'athletics'), [1, 'feat']],
  ['apparition taken at 1: Lore trained at creation', 'animist16', w('option:steward-of-stone-and-fire', 'lore:mountain', 'trained'), [1, 'create']],
  ['apparition Lore expert at 8', 'animist16', w('option:steward-of-stone-and-fire', 'lore:mountain', 'expert'), [8, 'feature']],
  ['apparition Lore master at 16', 'animist16', w('option:steward-of-stone-and-fire', 'lore:mountain', 'master'), [16, 'feature']],
  ['third apparition (opens at 7): Lore trained at 7', 'animist16', w('option:crafter-in-the-vault', 'lore:architecture', 'trained'), [7, 'feature']],
  ['third apparition: Lore expert at 8, NOT 7', 'animist16', w('option:crafter-in-the-vault', 'lore:architecture', 'expert'), [8, 'feature']],
  ['third apparition: Lore master at 16', 'animist16', w('option:crafter-in-the-vault', 'lore:architecture', 'master'), [16, 'feature']],
  ['Root Epithet option at 3 (P3)', 'A5', w('option:the-brave', 'athletics'), [3, 'feature']],
  ['class feature ladder: Esoteric Lore expert at 3', 'thaum15', w('feature:esoteric-lore', 'lore:esoteric', 'expert'), [3, 'feature']],
  ['class feature ladder: Esoteric Lore master at 7', 'thaum15', w('feature:esoteric-lore', 'lore:esoteric', 'master'), [7, 'feature']],
  ['class feature ladder: Esoteric Lore legendary at 15', 'thaum15', w('feature:esoteric-lore', 'lore:esoteric', 'legendary'), [15, 'feature']],
  ["second class's feature ladder at its own level (3)", 'dcThaum7', w('feature:esoteric-lore', 'lore:esoteric', 'expert'), [3, 'feature']],
  ["second class's feature ladder at its own level (7)", 'dcThaum7', w('feature:esoteric-lore', 'lore:esoteric', 'master'), [7, 'feature']],
  ['slot feat (P5) at its slot level', 'K1', j('feat:kholo-lore'), [1, 'feat']],
  ['granted feat (Additional Lore) trained with its granter', 'K1', w('feat:additional-lore', 'lore:kholo', 'trained'), [1, 'feat']],
  ['granted feat ladder: Additional Lore expert at 3', 'K1', w('feat:additional-lore', 'lore:kholo', 'expert'), [3, 'feat']],
  ['answered feat choice (Molten Wit)', 'MW1', w('feat:molten-wit', 'deception', 'trained'), [1, 'feat']],
  ['rank-gated grant (Stonemason\'s Eye)', 'S1', j('feat:stonemasons-eye', 'rankGate'), [1, 'feat']],
  ['Acrobat Dedication at its slot (2)', 'OA1', j('feat:acrobat-dedication'), [2, 'feat']],
  ['Acrobat Dedication ladder: master at 7', 'OA1', ld('feat:acrobat-dedication', 'master'), [7, 'feat']],
  ['Acrobat Dedication ladder: legendary at 15', 'OA1', ld('feat:acrobat-dedication', 'legendary'), [15, 'feat']],
  ['Operatic Adventurer (OA1) judged at 12', 'OA1', j('feat:operatic-adventurer', 'performance=legendary'), [12, 'feat']],
  ['Operatic Adventurer ladder: legendary at 15', 'OA1', ld('feat:operatic-adventurer', 'legendary'), [15, 'feat']],
  ['skill increase at 3 (P6)', 'OV1', j('increase:3'), [3, 'increase']],
  ['skill increase at 7 (P6)', 'OV1', j('increase:7'), [7, 'increase']],
  ['cross-conditional (Bardic Lore) in the final pass', 'BL15', { ...w('feat:bardic-lore', 'lore:bardic', 'expert'), phase: 'final' }, [1, 'final']],
];

describe('the level table (WP2): each source of plan 1.1 sits at its print level and phase', () => {
  const memo = new Map<string, readonly SkillEvent[]>();
  const eventsOf = (id: string): readonly SkillEvent[] => {
    let ev = memo.get(id);
    if (!ev) {
      const got = skillLedgerOf(buildOf(id), content());
      if (!got) throw new Error(`${id}: no ledger`);
      ev = got.events;
      memo.set(id, ev);
    }
    return ev;
  };
  for (const [row, id, m, want] of LEVEL_TABLE)
    it(`${row} — ${id}: ${m.source} → level ${want[0]}, ${want[1]}`, () => {
      const hits = eventsOf(id).filter((e) => matches(e, m));
      expect(hits.length, `${id}: no ${m.kind} ${m.source} ${m.key ?? ''} ${m.rank ?? ''}`).toBeGreaterThan(0);
      expect([hits[0].level, hits[0].phase, hits[0].source]).toEqual([want[0], want[1], m.source]);
    });

  it('the table covers every row of plan 1.1 it names (>= 20 sources) and every phase but P7', () => {
    expect(new Set(LEVEL_TABLE.map((r) => r[2].source)).size).toBeGreaterThanOrEqual(20);
    const phases = new Set(LEVEL_TABLE.map((r) => r[3][1]));
    for (const p of Object.keys(SKILL_PHASE_RANK)) if (p !== 'featAfterIncrease') expect(phases.has(p as SkillEventPhase), p).toBe(true);
  });

  it('the third apparition records NO Lore step at 7 above trained (its first step is 8th)', () => {
    const at7 = eventsOf('animist16').filter((e) => e.kind === 'write' && e.source === 'option:crafter-in-the-vault' && e.level === 7);
    expect(at7.map((e) => (e.kind === 'write' ? e.rank : '')).sort()).toEqual(['trained', 'trained']);
  });

  it('Operatic Adventurer re-judged at 12 is master in Performance, at 15 legendary (the judge reads view.level)', () => {
    const judge = eventsOf('OA1').find((e) => matches(e, j('feat:operatic-adventurer', 'performance=legendary')));
    if (judge?.kind !== 'judge') throw new Error('no Operatic Adventurer judge');
    const view = (level: number): SkillView => ({ rank: () => 'untrained', locked: () => false, level, hasFeat: () => false });
    const perf = (level: number) => judge.judge(view(level)).flatMap((x) => (x.kind === 'write' && x.key === 'performance' ? [x.rank] : []));
    expect(perf(12)).toEqual(['master']);
    expect(perf(15)).toEqual(['legendary']);
    // The live write carries the final-level rank and is marked as the ladder's.
    expect(judge.effects.some((x) => x.kind === 'write' && x.key === 'performance' && x.rank === 'legendary' && x.upgrade === true)).toBe(true);
  });

  it('order paths: a granted feat sorts right after its granter; the class slot before the Free Archetype slot; class 2 after class 1', () => {
    const k1 = eventsOf('K1');
    const granter = k1.find((e) => matches(e, j('feat:kholo-lore')))!;
    const granted = k1.find((e) => matches(e, w('feat:additional-lore', 'lore:kholo', 'trained')))!;
    expect(granted.orderPath.slice(0, granter.orderPath.length)).toEqual([...granter.orderPath]);
    expect(granted.orderPath.length).toBeGreaterThan(granter.orderPath.length);
    expect(compareSkillEvents(granter, granted)).toBeLessThan(0);

    const fa3 = eventsOf('FA3');
    const cls = fa3.find((e) => matches(e, j('feat:alchemist-dedication')))!;
    const fa = fa3.find((e) => matches(e, j('feat:barbarian-dedication')))!;
    expect([cls.level, fa.level]).toEqual([2, 2]);
    expect(cls.orderPath[0]).toBe(1);
    expect(fa.orderPath[0]).toBe(1);
    expect(compareOrderPath(cls.orderPath, fa.orderPath)).toBeLessThan(0);

    const one = eventsOf('thaum15').find((e) => matches(e, w('feature:esoteric-lore', 'lore:esoteric', 'expert')))!;
    const two = eventsOf('dcThaum7').find((e) => matches(e, w('feature:esoteric-lore', 'lore:esoteric', 'expert')))!;
    expect(one.orderPath[0]).toBe(0);
    expect(two.orderPath[0]).toBe(1);
    // An option sorts after its feature: the apparitions sit under Apparition Attunement, in pick order.
    const an = eventsOf('animist16');
    const first = an.find((e) => matches(e, w('option:steward-of-stone-and-fire', 'lore:mountain', 'expert')))!;
    const third = an.find((e) => matches(e, w('option:crafter-in-the-vault', 'lore:architecture', 'expert')))!;
    expect(first.orderPath.length).toBe(3);
    expect(compareOrderPath(first.orderPath, third.orderPath)).toBeLessThan(0);
  });
});

describe('the ladder data the split writes rely on (WP2)', () => {
  const ri = (r: ProficiencyRank) => PROFICIENCY_RANKS.indexOf(r);
  it('every FEAT_GRANTS rank ladder rises: later steps never lower the rank (the ladder events only raise)', () => {
    const bad: string[] = [];
    let n = 0;
    for (const [id, g] of Object.entries(FEAT_GRANTS)) {
      const steps = upgradeSteps(g);
      n += steps.length;
      for (let i = 1; i < steps.length; i++)
        if (steps[i].level <= steps[i - 1].level || ri(steps[i].rank) < ri(steps[i - 1].rank)) bad.push(`${id}: ${JSON.stringify(steps)}`);
    }
    expect(n).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it('every heritage and class option Lore ladder is at least trained and rises (the trained write, then one write per step)', () => {
    const db = content();
    const bad: string[] = [];
    let n = 0;
    const walk = (v: unknown, at: string): void => {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.loreProgression)) {
        const steps = o.loreProgression as { level: number; rank: ProficiencyRank }[];
        n++;
        steps.forEach((s, i) => {
          if (ri(s.rank) < ri('trained')) bad.push(`${at}: ${s.rank} below trained`);
          if (i > 0 && (s.level <= steps[i - 1].level || ri(s.rank) < ri(steps[i - 1].rank))) bad.push(`${at}: steps do not rise`);
        });
      }
      for (const [k, x] of Object.entries(o)) if (k !== 'description') walk(x, `${at}.${k}`);
    };
    walk(db.heritages, 'heritages');
    walk(db.classes, 'classes');
    expect(n).toBeGreaterThanOrEqual(10);
    expect(bad).toEqual([]);
  });
});

describe('the ledger primitives', () => {
  const P1 = { level: 1, phase: 'create' } as const;
  it('applySkillOp: set, max (never lowers), step (one rank, capped), delete; absent reads as untrained', () => {
    const r = {} as SkillRecord;
    applySkillOp(r, 'arcana', 'max', 'trained');
    expect(r.arcana).toBe('trained');
    applySkillOp(r, 'arcana', 'max', 'untrained');
    expect(r.arcana).toBe('trained');
    applySkillOp(r, 'arcana', 'step', 'expert');
    expect(r.arcana).toBe('expert');
    applySkillOp(r, 'arcana', 'step', 'expert'); // at the cap: stays
    expect(r.arcana).toBe('expert');
    applySkillOp(r, 'stealth', 'step', 'master'); // absent → trained
    expect(r.stealth).toBe('trained');
    applySkillOp(r, 'arcana', 'set', 'untrained'); // set lowers
    expect(r.arcana).toBe('untrained');
    applySkillOp(r, 'arcana', 'delete', undefined);
    expect('arcana' in r).toBe(false);
    expect(() => applySkillOp(r, 'arcana', 'max', undefined)).toThrow(/needs a rank/);
  });

  it('judgeScope: a judge sees its own earlier writes, never mutates the view, and its effects replay to its overlay', () => {
    const base = { arcana: 'trained' } as SkillRecord;
    const view: SkillView = { rank: (k) => base[k] ?? 'untrained', locked: () => false, level: 5, hasFeat: () => false };
    const js = judgeScope(view);
    js.write('stealth', 'max', 'trained');
    // "trained, or expert if already trained" — reads the write a moment earlier
    js.write('stealth', 'max', js.rank('stealth') === 'trained' ? 'expert' : 'trained', undefined, true);
    expect(js.rank('stealth')).toBe('expert');
    expect(base.stealth).toBeUndefined();
    const applied = { ...base };
    for (const e of js.effects) if (e.kind === 'write') applySkillOp(applied, e.key, e.op, e.rank);
    expect(applied.stealth).toBe('expert');
    // The ladder mark rides only on the write that asked for it.
    expect(js.effects.map((e) => (e.kind === 'write' ? e.upgrade === true : null))).toEqual([false, true]);
  });

  it('skillReplayMismatches names the key a dropped recording leaves behind; judge and ladder events are not writes', () => {
    const L = newSkillLedger();
    L.write('arcana', 'set', 'untrained', { source: 'init', place: P1 });
    L.write('arcana', 'max', 'trained', { source: 'class:wizard', place: P1 });
    expect(skillReplayMismatches({ arcana: 'trained' } as SkillRecord, L.events)).toEqual([]);
    expect(skillReplayMismatches({ arcana: 'trained', stealth: 'expert' } as SkillRecord, L.events)).toEqual(['stealth: live expert, replay (absent)']);
    expect(replaySkillEvents(L.events)).toEqual({ arcana: 'trained' });
    const s = L.judge({ source: 'feat:x', place: { level: 2, phase: 'feat', orderPath: [1, 0] } }, 'main', () => [], []);
    L.ladder(s, 'master', { source: 'feat:x', place: { level: 7, phase: 'feat', orderPath: [1, 0] } });
    expect(replaySkillEvents(L.events)).toEqual({ arcana: 'trained' });
    const lad = L.events[L.events.length - 1];
    expect(lad).toMatchObject({ kind: 'ladder', of: s, rank: 'master', level: 7, phase: 'feat', orderPath: [1, 0], source: 'feat:x' });
    // A place without an order path is the empty path.
    expect(L.events[0].orderPath).toEqual([]);
  });

  it('compareOrderPath: element by element, a prefix first', () => {
    expect(compareOrderPath([], [])).toBe(0);
    expect(compareOrderPath([1, 0], [1, 0])).toBe(0);
    expect(compareOrderPath([0, 9], [1, 0])).toBeLessThan(0);
    expect(compareOrderPath([1, 2], [1, 0])).toBeGreaterThan(0);
    expect(compareOrderPath([1, 0], [1, 0, 3])).toBeLessThan(0); // a granter before what it grants
    expect(compareOrderPath([1, 0, 3], [1, 1])).toBeLessThan(0); // depth first: the grant before the next slot
  });

  it('compareSkillEvents: the final pass last, then level, phase, order path, code order', () => {
    const L = newSkillLedger();
    const at = (level: number, phase: SkillEventPhase, orderPath?: number[]) => ({ source: `x:${level}${phase}${orderPath ?? ''}`, place: { level, phase, ...(orderPath ? { orderPath } : {}) } });
    L.write('arcana', 'max', 'trained', at(1, 'final')); // 0
    L.write('arcana', 'max', 'trained', at(3, 'increase', [0])); // 1
    L.write('arcana', 'max', 'trained', at(3, 'feat', [1, 1])); // 2
    L.write('arcana', 'max', 'trained', at(3, 'feat', [1, 0, 2])); // 3
    L.write('arcana', 'max', 'trained', at(3, 'feat', [1, 0])); // 4
    L.write('arcana', 'max', 'trained', at(1, 'create')); // 5
    L.write('arcana', 'max', 'trained', at(1, 'create')); // 6 (tie: code order)
    L.write('arcana', 'max', 'trained', at(2, 'heritage')); // 7
    L.write('arcana', 'max', 'trained', at(2, 'feature', [0, 4])); // 8
    L.write('arcana', 'max', 'trained', at(20, 'floor')); // 9
    L.write('arcana', 'max', 'trained', at(1, 'set')); // 10
    expect([...L.events].sort(compareSkillEvents).map((e) => e.seq)).toEqual([5, 6, 10, 8, 7, 4, 3, 2, 1, 9, 0]);
  });
});

describe('the source scan (G2) on planted code', () => {
  const plants: [string, string][] = [
    ['proficiencies.skills.stealth = "expert";', 'assignment'],
    ['proficiencies.skills[k] = r;', 'assignment'],
    ['skills[k] ??= "trained";', 'assignment'],
    ['skillsBeforeIncreases[k] = r;', 'assignment'],
    ['delete skills[k];', 'delete'],
    ['p.skills = {};', 'assignment'],
    ['Object.assign(proficiencies.skills, x);', 'Object.assign'],
    ['applySkillOp(skills, k, "set", r);', 'applySkillOp call'],
    // WP6L item 6 (the WP1 checker's minor): destructuring writes and whole-record replacements.
    ['({ stealth: proficiencies.skills.stealth } = x);', 'destructuring assignment'],
    ['[skills[k]] = [r];', 'destructuring assignment'],
    ['[a, ...skillsBeforeIncreases[k]] = rs;', 'destructuring assignment'],
    ['({ deep: { x: skills[k] = "trained" } } = y);', 'destructuring assignment'],
    ['({ skills } = built.proficiencies);', 'destructuring assignment'],
    ['for (skills[k] of ranks) {}', 'loop assignment'],
    ['proficiencies = { ...proficiencies, skills: next };', 'assignment (whole record)'],
    ['c.proficiencies = { skills };', 'assignment (whole record)'],
    ['Object.assign(proficiencies, { skills: next });', 'Object.assign (whole record)'],
    ['Object.assign(c.proficiencies, other);', 'Object.assign (whole record)'],
    ['Object.assign(proficiencies, { ...other });', 'Object.assign (whole record)'],
  ];
  for (const [line, what] of plants)
    it(`flags ${line}`, () => {
      const f = scanSkillWrites(`function feat() {\n  ${line}\n}\n`);
      expect(f.map((x: { line: number; what: string }) => [x.line, x.what])).toEqual([[2, what]]);
    });

  it('allows the same writes inside skillWrite and applyExactClamp, and ignores non-rank skills maps', () => {
    expect(scanSkillWrites('const skillWrite = (t, k) => { applySkillOp(t, k, "set", "trained"); };')).toEqual([]);
    expect(scanSkillWrites('function applyExactClamp(p) { p.skills[k] = "expert"; }')).toEqual([]);
    expect(scanSkillWrites('cur.skills = { ...cur.skills, stealth: 1 };')).toEqual([]);
    expect(scanSkillWrites('const skills = {};')).toEqual([]);
    // WP6L: the new shapes stay quiet where nothing rank-shaped is written.
    expect(scanSkillWrites('const { skills } = c.proficiencies;')).toEqual([]);
    expect(scanSkillWrites('[a, b] = [b, a];')).toEqual([]);
    expect(scanSkillWrites('({ x: cur.skills } = y);')).toEqual([]);
    expect(scanSkillWrites('cur = { ...cur, skills: next };')).toEqual([]);
    expect(scanSkillWrites('Object.assign(proficiencies, { saves: next });')).toEqual([]);
    expect(scanSkillWrites('Object.assign(at.byRank, s.byRank);')).toEqual([]);
    expect(scanSkillWrites('for (const k of skills) {}')).toEqual([]);
    expect(scanSkillWrites('function swapInPrintSkills(p) { Object.assign(proficiencies, { skills: p.skills }); [skills.a] = [1]; }')).toEqual([]);
  });
});
