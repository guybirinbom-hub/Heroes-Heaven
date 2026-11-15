/*
 * THE SKILL LEDGER (skill-rank order, plan work/skill-rank-level-by-level/plan.md, D1; WP1, WP2).
 *
 * Every skill write and every skill judgement inside `buildCharacter` goes through one of two helpers
 * there, `skillWrite` and `skillJudge`. Each (a) does exactly what the line it replaced did, where it did
 * it — the LIVE path, today's code order, unchanged — and (b) records an event here. A later package
 * (WP3) replays the events in print order (level by level); until then the ledger only records, and
 * `replaySkillEvents` proves the record is complete: a seq-order replay of the recorded writes gives the
 * live ranks exactly (test/skill-ledger.test.ts, over every snapshot character).
 *
 * WP2: every event also carries its PRINT place (`SkillPlace`: level, phase, order path), given by the build
 * where it records the event — `place` is required, so an unplaced event does not compile. A level LADDER
 * (a Lore that becomes expert at 5th, a feat's rank upgrade at 7th and 15th) records one event per step
 * level: a plain write is split into one `max` write per step (the live result is the same, `max` being
 * monotone), and a judge's ladder is a `ladder` event per step that raises the judge's `upgrade` writes —
 * recorded only, because the judge's live writes already carry the final-level rank.
 *
 * A JUDGE is a pure closure over a view of the ranks — "already trained when the feat was taken?",
 * "which key does this increase land on?" — that RETURNS its effects instead of performing them; the
 * build applies the returned effects to the live state, and WP3 runs the same closure again on the print
 * view. Nothing else in a judge may mutate (scripts/skill-write-check.mjs keeps every write in build.ts
 * inside `skillWrite`).
 *
 * A leaf: imports types and the rank step only, never build.ts.
 */
import { PROFICIENCY_RANKS, type Character, type ProficiencyKey, type ProficiencyRank, type SkillHistory, type SkillIncrease, type SkillPhase, type SkillStep } from './types';
import { skillIncreaseCap, stepRank } from './ranks';

/** How a write changes its key — exactly the operation the replaced line performed. `step` is a skill
 *  increase: one rank up, never past `rank` (the level's cap). */
export type SkillOp = 'set' | 'max' | 'step' | 'delete';

/** The print phase of an event inside its level (plan D3): P0 creation (level 1 only) → P1 Tweaks floors → P2
 *  old `=` sets and moved "exactly" entries → P3 class features and options → P4 heritage (and the deity's and
 *  background's own picks) → P5 feats → P6 skill increases → P7 feats whose skill prerequisite needs that
 *  level's increases (the resolver moves them there, D5; nothing is recorded there) → the final pass (D9). */
export type SkillEventPhase = SkillPhase;

/** Each phase's rank inside a level (plan D3), the second term of the print sort key. */
export const SKILL_PHASE_RANK: Readonly<Record<SkillEventPhase, number>> = {
  create: 0,
  floor: 1,
  set: 2,
  feature: 3,
  heritage: 4,
  feat: 5,
  increase: 6,
  featAfterIncrease: 7,
  final: 8,
};

/**
 * Where an event sits in print order (plan 1.1, D3, D4; WP2): its print LEVEL, its PHASE inside that level, and
 * `orderPath` — its place among the records of that phase, compared element by element (a path that is a
 * prefix of a longer one comes first, so a granted feat `[...granter, n]` sorts right after its granter, depth
 * first). Inside P5: `[0, n]` a feat that fills no slot and that no feat granted (a background's, a heritage's,
 * a class feature's — their granters sit in earlier phases), `[1, slot index]` a slot feat in
 * `levelGrants(...).featSlots` draw order (the index the slot key carries), `[2, n]` a feat given through
 * Tweaks. Inside P3: `[class 0 | second class 1 | archetype-added 2 | other 3, feature index]`, an option at
 * `[class, its feature's index, 1 + n]`, after its feature. Inside P6: `[0]` the class's increase, `[1]` the
 * bonus one, `[2]` the background's, `[3, n]` the n-th extra place a tweak adds (Tweaks phase 2, C15). Elsewhere the path is empty and code order (`seq`) decides, which inside
 * P0 is today's order (D4).
 */
export interface SkillPlace {
  level: number;
  phase: SkillEventPhase;
  orderPath?: readonly number[];
}

/** A skills record: every skill and Lore key the build knows, by its rank. */
export type SkillRecord = Record<ProficiencyKey, ProficiencyRank>;

export type SkillFallbackEntry = NonNullable<Character['skillFallbacks']>[number];

/** Which reader a judge's live view was (plan D7): `main` = the ranks as they stand; `noMoved` = the
 *  snapshot without moved floors and old `=` sets (Molten Wit); `beforeOwn` = the queue's reader of the
 *  ranks before a carrier's own grants (the rank-gated grants and the `skillRankBefore` snapshot — WP3/WP4
 *  re-judge those on the print history). */
export type SkillViewKind = 'main' | 'noMoved' | 'beforeOwn';

/** What a judge reads (plan 1.2). `level` is the level it judges at (live: the character level, so the
 *  live result is today's); `hasFeat(id, notGrantedBy)` = a feat row the character holds, optionally not
 *  one this record granted itself. `print` is true on the print pass's view only (absent on the live view):
 *  a judge whose clause today's engine never applied (D14, WP5: a class option's "already trained → a
 *  different skill" above 1st level) applies it there alone, so the live path — the notice's "before", part
 *  B's at-slot reading, `--legacy-check` (G11) — stays today's engine. */
export interface SkillView {
  rank(key: ProficiencyKey): ProficiencyRank;
  locked(key: ProficiencyKey): boolean;
  readonly level: number;
  hasFeat(id: string, notGrantedBy?: string): boolean;
  readonly print?: true;
}

/** What a judge returns; the build applies each, in order. */
export type SkillEffect =
  /** A rank write (with the lock a level-1 training takes, `lock` = the words the builder prints). `upgrade`
   *  marks a write whose rank follows the record's level ladder (`upgradeRankAt` at the judge's level): the
   *  judge's `ladder` events at later levels raise exactly these. */
  | { kind: 'write'; key: ProficiencyKey; op: SkillOp; rank?: ProficiencyRank; lock?: string; upgrade?: true; pick?: true }
  /** A skill increase the record forbids (Bardic Lore's "can't increase by any other means", a restricted
   *  bonus lane): nothing changes; the history says why (WP3). */
  | { kind: 'drop'; key: ProficiencyKey }
  /** "Already trained → a skill of your choice": one `Character.skillFallbacks` entry. */
  | { kind: 'fallback'; entry: SkillFallbackEntry }
  /** A skill increase that lands: a `step` write capped by its level, and a `skillIncreases` row. `tweak` = an extra
   *  place's increase (Tweaks phase 2, C15: source `tweakIncrease:<block id>`, after the level's three book lanes). */
  | { kind: 'increase'; key: ProficiencyKey; level: number; lane: 'main' | 'bonus' | 'background' | 'tweak' }
  /** A "Lore instead of language" Lore the Int slots fit: kept on the list, trained and locked. */
  | { kind: 'languageLore'; key: ProficiencyKey }
  /** The `skillRankBefore` snapshot of one carrier. */
  | { kind: 'before'; carrier: string; ranks: Partial<Record<ProficiencyKey, ProficiencyRank>> }
  /** A rank-gated feat grant whose rank holds (FEAT_RANK_FEAT_GRANTS), today's order's decision: the queue keeps it
   *  in its legacy side list only (WP4; the character's rows come from `rankGatedGrants` after the resolve). */
  | { kind: 'rankGate'; carrier: string; feat: string };

export type SkillJudge = (view: SkillView) => SkillEffect[];

/** Where an event comes from: `source` = '<kind>:<id>' (plan 1.5's kinds: class | class2 | background |
 *  heritage | option | feature | feat | deity | classPick | langLore | floor | set | increase | bonus |
 *  bgIncrease | tweakIncrease | init). `place` = its print place (required: WP2). `lock` / `unlock` are the class-pick lock
 *  a level-1 training takes or a removal gives back; `moved` marks an old Overrides entry (a moved floor or a
 *  moved "exactly", part B B26). */
export interface SkillEventMeta {
  source: string;
  place: SkillPlace;
  lock?: string;
  unlock?: boolean;
  moved?: boolean;
  /** A feat ROW's own place, unshifted (`<level>|<orderPath>`; skill-order WP7 round 2): which copy of a repeatable
   *  feat (two Additional Lores) an event came from, kept when a ladder or `minLevel` moves the event to a later
   *  level. Read only by the "without this row" re-run (build.ts `passWithout`). */
  row?: string;
}

interface SkillEventBase {
  source: string;
  lock?: string;
  unlock?: boolean;
  moved?: boolean;
  /** `SkillEventMeta.row`. */
  row?: string;
  /** Code order: the order the live path ran it in. */
  seq: number;
  /** The print level (plan 1.1). */
  level: number;
  phase: SkillEventPhase;
  /** The place among the phase's records (`SkillPlace`); empty = code order. */
  orderPath: readonly number[];
}
export interface SkillWriteEvent extends SkillEventBase {
  kind: 'write';
  key: ProficiencyKey;
  op: SkillOp;
  rank?: ProficiencyRank;
  /** The judge event whose effect this write is (absent = a plain write). */
  by?: number;
}
export interface SkillJudgeEvent extends SkillEventBase {
  kind: 'judge';
  view: SkillViewKind;
  judge: SkillJudge;
  /** What the judge returned on the live view. */
  effects: readonly SkillEffect[];
}
/**
 * One later step of a judge's level ladder (a feat's `rankUpgrade`: Operatic Adventurer taken at 12th is master,
 * legendary at 15th). Recorded only — the judge's live writes already carry the final-level rank, so the live
 * path writes nothing here and the seq replay skips it. In print order it raises each `upgrade` write the judge
 * `of` returned to at least `rank`.
 */
export interface SkillLadderEvent extends SkillEventBase {
  kind: 'ladder';
  /** The `seq` of the judge whose ladder this is. */
  of: number;
  rank: ProficiencyRank;
}
export type SkillEvent = SkillWriteEvent | SkillJudgeEvent | SkillLadderEvent;

export interface SkillLedger {
  readonly events: SkillEvent[];
  write(key: ProficiencyKey, op: SkillOp, rank: ProficiencyRank | undefined, meta: SkillEventMeta, by?: number): void;
  judge(meta: SkillEventMeta, view: SkillViewKind, judge: SkillJudge, effects: readonly SkillEffect[]): number;
  ladder(of: number, rank: ProficiencyRank, meta: SkillEventMeta): void;
}

/** The event fields a meta gives: its source and flags, and its place flattened. */
function base(meta: SkillEventMeta, seq: number): SkillEventBase {
  const { place, ...rest } = meta;
  return { ...rest, seq, level: place.level, phase: place.phase, orderPath: place.orderPath ?? [] };
}

export function newSkillLedger(): SkillLedger {
  const events: SkillEvent[] = [];
  let seq = 0;
  return {
    events,
    write(key, op, rank, meta, by) {
      events.push({ ...base(meta, seq++), kind: 'write', key, op, ...(rank !== undefined ? { rank } : {}), ...(by !== undefined ? { by } : {}) });
    },
    judge(meta, view, judge, effects) {
      const s = seq++;
      events.push({ ...base(meta, s), kind: 'judge', view, judge, effects });
      return s;
    },
    ladder(of, rank, meta) {
      events.push({ ...base(meta, seq++), kind: 'ladder', of, rank });
    },
  };
}

/** Lexicographic order of two order paths (a prefix first). */
export function compareOrderPath(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/**
 * THE PRINT SORT KEY (plan 1.2): the final pass (D9) after every level; otherwise (level, phase rank, order
 * path, seq). `seq` breaks every remaining tie, so the order is total and the same on every run.
 */
export function compareSkillEvents(a: SkillEvent, b: SkillEvent): number {
  const fa = a.phase === 'final' ? 1 : 0;
  const fb = b.phase === 'final' ? 1 : 0;
  return (
    fa - fb ||
    a.level - b.level ||
    SKILL_PHASE_RANK[a.phase] - SKILL_PHASE_RANK[b.phase] ||
    compareOrderPath(a.orderPath, b.orderPath) ||
    a.seq - b.seq
  );
}

const rankIndex = (r: ProficiencyRank | undefined): number => (r === undefined ? -1 : PROFICIENCY_RANKS.indexOf(r));

/** THE one mutation of a skills record, shared by the build's `skillWrite` and the replay below, so the
 *  two can never apply an operation differently. `max` and `step` read an absent key as untrained. */
export function applySkillOp(target: SkillRecord, key: ProficiencyKey, op: SkillOp, rank: ProficiencyRank | undefined): void {
  if (op === 'delete') {
    delete target[key];
    return;
  }
  if (rank === undefined) throw new Error(`applySkillOp: '${op}' on ${key} needs a rank`);
  if (op === 'set') target[key] = rank;
  else if (op === 'max') {
    const cur = target[key] ?? 'untrained';
    target[key] = rankIndex(rank) > rankIndex(cur) ? rank : cur;
  } else target[key] = stepRank(target[key] ?? 'untrained', rank);
}

/**
 * Inside a judge: its own writes land on a private overlay, so a judge that reads a key it wrote a moment
 * earlier (a record's static grant, then its "trained, or expert if already trained" step) sees it, while
 * the view it was given stays untouched. Returns the effects in order; applied to the live state in that
 * order they give exactly what the overlay holds. `upgrade` marks a write whose rank follows the record's
 * level ladder (see `SkillEffect`).
 */
export function judgeScope(view: SkillView) {
  const local = {} as SkillRecord;
  const touched = new Set<ProficiencyKey>();
  const effects: SkillEffect[] = [];
  const rank = (key: ProficiencyKey): ProficiencyRank => (touched.has(key) ? local[key] ?? 'untrained' : view.rank(key));
  const write = (key: ProficiencyKey, op: SkillOp, r: ProficiencyRank | undefined, lock?: string, upgrade?: boolean, pick?: boolean): void => {
    if (!touched.has(key)) {
      const cur = view.rank(key);
      local[key] = cur;
      touched.add(key);
    }
    applySkillOp(local, key, op, r);
    effects.push({
      kind: 'write',
      key,
      op,
      ...(r !== undefined ? { rank: r } : {}),
      ...(lock ? { lock } : {}),
      ...(upgrade ? { upgrade: true as const } : {}),
      ...(pick ? { pick: true as const } : {}),
    });
  };
  return {
    effects,
    rank,
    write,
    /** The stored answer to the replacement a `fallback` effect just owed (a `max` write): the history names it
     *  as that record's pick (WP3). */
    pick(key: ProficiencyKey, r: ProficiencyRank, lock?: string, upgrade?: boolean): void {
      write(key, 'max', r, lock, upgrade, true);
    },
    push(e: SkillEffect) {
      effects.push(e);
    },
  };
}

/** A seq-order replay of the recorded writes, from an empty record. */
export function replaySkillEvents(events: readonly SkillEvent[]): SkillRecord {
  const out = {} as SkillRecord;
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) if (e.kind === 'write') applySkillOp(out, e.key, e.op, e.rank);
  return out;
}

/** Every key where the replay and the live ranks disagree, as 'key: live X, replay Y' (empty = the ledger
 *  holds every write the live path made). */
export function skillReplayMismatches(live: Readonly<SkillRecord>, events: readonly SkillEvent[]): string[] {
  const replay = replaySkillEvents(events);
  const keys = [...new Set([...Object.keys(live), ...Object.keys(replay)])].sort() as ProficiencyKey[];
  const out: string[] = [];
  for (const k of keys) if (live[k] !== replay[k]) out.push(`${k}: live ${live[k] ?? '(absent)'}, replay ${replay[k] ?? '(absent)'}`);
  return out;
}

/* ====================================================================================================== */
/* THE PRINT PASS (plan 1.2, D2-D9; WP3)                                                                   */
/* ====================================================================================================== */

/**
 * One skill-rank prerequisite line of a feat (plan D5; `skillPrereqLines` in build.ts reads it off the record
 * with the same parser `checkPrerequisites` uses): met when ANY of `keys` is at least `need` ("X or Y" = any).
 */
export interface SkillPrereqLine {
  line: string;
  need: ProficiencyRank;
  keys: readonly ProficiencyKey[];
}

/** A feat row the character holds, at its print place (D6: a judge's `hasFeat` sees only rows placed before it). */
export interface SkillPassFeatRow {
  featId: string;
  grantedBy?: string;
  place: SkillPlace;
}

export interface SkillPassContext {
  /** The character level: the pass works out every level from 1 to here. */
  level: number;
  featRows: readonly SkillPassFeatRow[];
  /** The skill-rank prerequisites of each slot (and Tweaks-given) feat that has any, by its UNIT key
   *  (`skillUnitKey`: the feat with every record it grants). */
  prereqs: ReadonlyMap<string, readonly SkillPrereqLine[]>;
}

export interface SkillPassResult {
  /** The ranks, pre-clamp: the "exactly" clamp runs after the pass, unchanged (D8). */
  skills: SkillRecord;
  fallbacks: SkillFallbackEntry[];
  increases: SkillIncrease[];
  /** The level-1 class-pick locks, with their words (`Character.grantedSkills`). */
  grantedSkills: Record<string, string>;
  languageLores: ProficiencyKey[];
  skillRankBefore: Record<string, Partial<Record<ProficiencyKey, ProficiencyRank>>>;
  history: SkillHistory;
  /** The feat units D5 moved after their level's increases (`skillUnitKey`), with or without skill events of
   *  their own (a unit with none moves no rank, but its place orders a same-level rank-gate tie, WP6L). */
  deferred: string[];
}

/** One rank operation the pass applied, kept so a judge that must not see its own record (Molten Wit, the
 *  `skillRankBefore` snapshot, plan D7) can replay the ranks without it. */
interface AppliedOp {
  key: ProficiencyKey;
  op: SkillOp;
  rank?: ProficiencyRank;
  source: string;
  /** Part of the `noMoved` view (everything but a moved floor and an old `=` / moved "exactly" set). */
  noMoved: boolean;
}

interface PassState {
  /** Every event (plan D7's `main` view). */
  main: SkillRecord;
  /** Every event but moved floors and P2 sets (D7). */
  noMoved: SkillRecord;
  locked: Set<ProficiencyKey>;
  lockedFrom: Record<string, string>;
  /** A key an old `=` (P2) set → that set's live `seq` (D3's swallow rule). */
  swallowed: Map<ProficiencyKey, number>;
  fallbacks: SkillFallbackEntry[];
  increases: SkillIncrease[];
  languageLores: ProficiencyKey[];
  before: Record<string, Partial<Record<ProficiencyKey, ProficiencyRank>>>;
  steps: SkillStep[];
  at: Record<string, number>;
  /** What each judge returned on the print view, by its `seq` (its ladder steps raise these writes). */
  effectsOf: Map<number, readonly SkillEffect[]>;
  applied: AppliedOp[];
}

const newPassState = (): PassState => ({
  main: {} as SkillRecord,
  noMoved: {} as SkillRecord,
  locked: new Set(),
  lockedFrom: {},
  swallowed: new Map(),
  fallbacks: [],
  increases: [],
  languageLores: [],
  before: {},
  steps: [],
  at: {},
  effectsOf: new Map(),
  applied: [],
});
/** A copy the D5 look-ahead can run on and throw away. */
const clonePassState = (s: PassState): PassState => ({
  main: { ...s.main },
  noMoved: { ...s.noMoved },
  locked: new Set(s.locked),
  lockedFrom: { ...s.lockedFrom },
  swallowed: new Map(s.swallowed),
  fallbacks: [...s.fallbacks],
  increases: [...s.increases],
  languageLores: [...s.languageLores],
  before: { ...s.before },
  steps: [...s.steps],
  at: { ...s.at },
  effectsOf: new Map(s.effectsOf),
  applied: [...s.applied],
});

const rankOr = (r: ProficiencyRank | undefined): ProficiencyRank => r ?? 'untrained';
const atLeast = (have: ProficiencyRank | undefined, need: ProficiencyRank): boolean => rankIndex(rankOr(have)) >= rankIndex(need);
/** '<kind>:<id>' → '<id>'. */
const idOf = (source: string): string => source.slice(source.indexOf(':') + 1);

/**
 * The D5 unit of a P5 event: a slot feat (`[1, slot index]`) or a Tweaks-given feat (`[2, n]`) together with
 * every record it brings (granted feats, a second heritage, a feat-granted background: their order path starts
 * with the feat's). `null` for every other event.
 */
export function skillUnitKey(e: { level: number; phase: SkillPhase; orderPath?: readonly number[] }): string | null {
  const p = e.orderPath ?? [];
  return e.phase === 'feat' && p.length >= 2 && (p[0] === 1 || p[0] === 2) ? `${e.level}|${p[0]},${p[1]}` : null;
}

const prereqMet = (rec: SkillRecord, lines: readonly SkillPrereqLine[]): boolean => lines.every((l) => l.keys.some((k) => atLeast(rec[k], l.need)));

/** Is a feat row placed before this event (D6)? The final pass comes after every row. */
function rowBefore(p: SkillPlace, e: SkillEvent): boolean {
  if (e.phase === 'final') return true;
  return (p.level - e.level || SKILL_PHASE_RANK[p.phase] - SKILL_PHASE_RANK[e.phase] || compareOrderPath(p.orderPath ?? [], e.orderPath)) < 0;
}

interface StepMeta {
  level: number;
  phase: SkillPhase;
  source: string;
  seq: number;
  moved?: boolean;
}

function pushStep(s: PassState, st: SkillStep): number {
  s.steps.push(st);
  return s.steps.length - 1;
}

/**
 * One rank write in print order. A "you become trained" write recorded as `set` outside creation (an option
 * above 1st level, a feat-granted heritage or background) RAISES only: in today's order it ran before anything
 * could pass trained, and print never lowers a rank by training it. An old `=` / moved "exactly" (P2) sets, and
 * swallows (D3) every later-placed write on its key that ran before it in today's order. Returns the step's index
 * (-1 for the `init` seed, which has no step).
 */
function applyWrite(
  s: PassState,
  w: { key: ProficiencyKey; op: SkillOp; rank?: ProficiencyRank; lock?: string; unlock?: boolean; pick?: true },
  m: StepMeta,
): number {
  const isSet = m.phase === 'set';
  const op: SkillOp = w.op === 'set' && !isSet && m.phase !== 'create' ? 'max' : w.op;
  const toNoMoved = !isSet && !(m.moved && m.source.startsWith('floor:'));
  const from = rankOr(s.main[w.key]);
  const setSeq = s.swallowed.get(w.key);
  const swallow = !isSet && setSeq !== undefined && m.seq < setSeq;
  if (!swallow) applySkillOp(s.main, w.key, op, w.rank);
  if (toNoMoved) applySkillOp(s.noMoved, w.key, op, w.rank);
  s.applied.push({ key: w.key, op, ...(w.rank ? { rank: w.rank } : {}), source: m.source, noMoved: toNoMoved });
  if (isSet && op === 'set') s.swallowed.set(w.key, m.seq);
  // The class-pick lock: only a 1st-level training takes one (a skill trained at 3rd does not stop a 1st-level pick).
  if (w.lock && m.level === 1) {
    s.locked.add(w.key);
    s.lockedFrom[w.key] ??= w.lock;
  }
  if (w.unlock) {
    s.locked.delete(w.key);
    delete s.lockedFrom[w.key];
  }
  if (m.source === 'init') return -1;
  const to = rankOr(s.main[w.key]);
  return pushStep(s, {
    level: m.level,
    phase: m.phase,
    key: w.key,
    from,
    to,
    source: w.pick ? `pick:${idOf(m.source)}` : m.source,
    ...(swallow ? { note: 'swallow' as const } : from === to ? { note: 'same' as const } : {}),
    // A raise that changed nothing: what it asked for, so a replay without an earlier record re-applies it (ranks.ts).
    ...(!swallow && op === 'max' && w.rank && from === to && rankIndex(w.rank) < rankIndex(to) ? { rank: w.rank } : {}),
  });
}

/** Replay of the applied ops in the `noMoved` view, without one record's own ops (D7). */
function noMovedWithout(s: PassState, source: string): SkillRecord {
  const out = {} as SkillRecord;
  for (const a of s.applied) if (a.noMoved && a.source !== source) applySkillOp(out, a.key, a.op, a.rank);
  return out;
}

function viewOf(s: PassState, e: SkillJudgeEvent, ctx: SkillPassContext, at?: { rec: SkillRecord; level: number }): SkillView {
  let rec: SkillRecord | undefined = at?.rec;
  const read = (): SkillRecord => (rec ??= e.view === 'main' ? s.main : noMovedWithout(s, e.source));
  return {
    rank: (k) => rankOr(read()[k]),
    locked: (k) => s.locked.has(k),
    level: at?.level ?? e.level,
    hasFeat: (id, notGrantedBy) =>
      ctx.featRows.some((r) => r.featId === id && (notGrantedBy === undefined || r.grantedBy !== notGrantedBy) && rowBefore(r.place, e)),
    print: true,
  };
}

/**
 * The level a final-pass write lands at (D9): the later of the record's level and the first level whose END
 * makes the judge give that same write ("Expert at 15th" for Bardic Lore, not "at 1st").
 */
function finalStepLevel(e: SkillJudgeEvent, w: { key: ProficiencyKey; rank?: ProficiencyRank }, s: PassState, ctx: SkillPassContext, endOf: readonly SkillRecord[]): number {
  for (let L = e.level; L < endOf.length; L++) {
    if (!endOf[L]) continue;
    const got = e.judge(viewOf(s, e, ctx, { rec: endOf[L], level: L }));
    if (got.some((x) => x.kind === 'write' && x.key === w.key && x.rank === w.rank)) return L;
  }
  return e.level;
}

function runJudge(s: PassState, e: SkillJudgeEvent, phase: SkillPhase, ctx: SkillPassContext, endOf?: readonly SkillRecord[]): void {
  const effects = e.judge(viewOf(s, e, ctx));
  s.effectsOf.set(e.seq, effects);
  const meta: StepMeta = { level: e.level, phase, source: e.source, seq: e.seq, ...(e.moved ? { moved: true } : {}) };
  let redirect = -1;
  for (const x of effects) {
    if (x.kind === 'write') {
      const lvl = phase === 'final' && endOf ? finalStepLevel(e, x, s, ctx, endOf) : e.level;
      applyWrite(s, { key: x.key, op: x.op, ...(x.rank ? { rank: x.rank } : {}), ...(x.lock ? { lock: x.lock } : {}), ...(x.pick ? { pick: true as const } : {}) }, { ...meta, level: lvl });
      if (x.pick && redirect >= 0) s.steps[redirect] = { ...s.steps[redirect], pick: x.key };
    } else if (x.kind === 'fallback') {
      s.fallbacks.push(x.entry);
      const r = rankOr(s.main[x.entry.skill]);
      redirect = pushStep(s, { level: e.level, phase, key: x.entry.skill, from: r, to: r, source: e.source, note: 'redirect' });
    } else if (x.kind === 'increase') {
      const i = applyWrite(s, { key: x.key, op: 'step', rank: skillIncreaseCap(x.level) }, meta);
      if (i >= 0 && s.steps[i].note === 'same') s.steps[i] = { ...s.steps[i], note: 'cap' };
      s.increases.push({ level: x.level, skill: x.key, ...(x.lane !== 'main' ? { lane: x.lane } : {}) });
    } else if (x.kind === 'drop') {
      const r = rankOr(s.main[x.key]);
      pushStep(s, { level: e.level, phase, key: x.key, from: r, to: r, source: e.source, note: 'drop' });
    } else if (x.kind === 'languageLore') s.languageLores.push(x.key);
    else if (x.kind === 'before') s.before[x.carrier] = x.ranks;
    // 'rankGate': nothing here. The rank-gated grants are decided after the pass, from its history (`rankGatedGrants`
    // in build.ts, plan D10, WP4); this judge is replayed only so its carrier keeps a place (`at`) in that history.
  }
}

function applyEvent(s: PassState, e: SkillEvent, phase: SkillPhase, ctx: SkillPassContext, endOf?: readonly SkillRecord[]): void {
  // A judge's own writes are re-derived from its print run; the recorded ones are its LIVE effects.
  if (e.kind === 'write' && e.by !== undefined) return;
  if (e.source !== 'init') s.at[e.source] ??= s.steps.length;
  if (e.kind === 'write') {
    applyWrite(
      s,
      { key: e.key, op: e.op, ...(e.rank ? { rank: e.rank } : {}), ...(e.lock ? { lock: e.lock } : {}), ...(e.unlock ? { unlock: true } : {}) },
      { level: e.level, phase, source: e.source, seq: e.seq, ...(e.moved ? { moved: true } : {}) },
    );
  } else if (e.kind === 'judge') runJudge(s, e, phase, ctx, endOf);
  else {
    // A ladder step: raise each `upgrade` write its judge gave on the PRINT view to at least this step's rank.
    for (const x of s.effectsOf.get(e.of) ?? [])
      if (x.kind === 'write' && x.upgrade)
        applyWrite(s, { key: x.key, op: 'max', rank: e.rank, ...(x.pick ? { pick: true as const } : {}) }, { level: e.level, phase, source: e.source, seq: e.seq });
  }
}

/** D5's look-ahead: unit `uk` is not met where it stands; is it met at the END of its level (every other record
 *  of the level and that level's increases applied, its own records left out)? */
function metAtEndOfLevel(s: PassState, uk: string, rest: readonly SkillEvent[], increases: readonly SkillEvent[], ctx: SkillPassContext): boolean {
  const sim = clonePassState(s);
  for (const e of rest) if (skillUnitKey(e) !== uk) applyEvent(sim, e, 'feat', ctx);
  for (const e of increases) applyEvent(sim, e, 'increase', ctx);
  return prereqMet(sim.main, ctx.prereqs.get(uk) ?? []);
}

/**
 * THE PRINT PASS (plan 1.2): the ledger's events replayed level by level, as print orders them, from 1st level
 * to the character's. Per level: creation (1st only) → Tweaks floors → old `=` sets → class features and options
 * → heritage → feats (slot order, given feats, each granted record right after its granter) → skill increases →
 * the feats whose skill prerequisite holds only once that level's increases are in (D5); then the final pass
 * (D9). Every judge runs again on the print view at its own place and level (D6), and every write lands where
 * print puts it; the result replaces the live ranks at the resolve point (D2). Pure: it reads the events and
 * the context, and the judges it re-runs are pure closures.
 */
export function resolveSkillPass(events: readonly SkillEvent[], ctx: SkillPassContext): SkillPassResult {
  const sorted = [...events].sort(compareSkillEvents);
  const finals = sorted.filter((e) => e.phase === 'final');
  const byLevel = new Map<number, SkillEvent[]>();
  for (const e of sorted) if (e.phase !== 'final') byLevel.set(e.level, [...(byLevel.get(e.level) ?? []), e]);
  const top = Math.max(ctx.level, ...byLevel.keys(), 1);
  const s = newPassState();
  const endOf: SkillRecord[] = [];
  const deferredUnits: string[] = [];
  for (let L = 1; L <= top; L++) {
    const evs = byLevel.get(L) ?? [];
    for (const e of evs) if (SKILL_PHASE_RANK[e.phase] < SKILL_PHASE_RANK.feat) applyEvent(s, e, e.phase, ctx);
    const feats = evs.filter((e) => e.phase === 'feat');
    const increases = evs.filter((e) => e.phase === 'increase');
    const decided = new Map<string, boolean>();
    const later: SkillEvent[] = [];
    /* A unit with a skill prerequisite but NO skill event of its own (Marine Marauder Dedication: "trained in
     * Athletics", no rank write) moves nothing, but its place still decides who comes first in a same-level tie
     * (build.ts `rankGateFirst`, WP6L checker round 1): it is decided at its own slot place, as an event would be. */
    const silent = [...ctx.prereqs.keys()]
      .filter((uk) => uk.startsWith(`${L}|`) && !feats.some((e) => skillUnitKey(e) === uk))
      .map((uk) => ({ uk, path: uk.slice(uk.indexOf('|') + 1).split(',').map(Number) }))
      .sort((a, b) => compareOrderPath(a.path, b.path));
    const decideSilent = (before: readonly number[] | null, i: number) => {
      while (silent.length && (before === null || compareOrderPath(silent[0].path, before) < 0)) {
        const { uk } = silent.shift()!;
        decided.set(uk, !prereqMet(s.main, ctx.prereqs.get(uk)!) && metAtEndOfLevel(s, uk, feats.slice(i), increases, ctx));
      }
    };
    feats.forEach((e, i) => {
      decideSilent(e.orderPath, i);
      const uk = skillUnitKey(e);
      if (uk && ctx.prereqs.has(uk)) {
        if (!decided.has(uk)) decided.set(uk, !prereqMet(s.main, ctx.prereqs.get(uk)!) && metAtEndOfLevel(s, uk, feats.slice(i), increases, ctx));
        if (decided.get(uk)) {
          later.push(e);
          return;
        }
      }
      applyEvent(s, e, 'feat', ctx);
    });
    decideSilent(null, feats.length);
    for (const e of increases) applyEvent(s, e, 'increase', ctx);
    for (const e of later) applyEvent(s, e, 'featAfterIncrease', ctx);
    for (const e of evs) if (SKILL_PHASE_RANK[e.phase] > SKILL_PHASE_RANK.increase) applyEvent(s, e, e.phase, ctx);
    for (const [uk, d] of decided) if (d) deferredUnits.push(uk);
    endOf[L] = { ...s.main };
  }
  for (const e of finals) applyEvent(s, e, 'final', ctx, endOf);
  return {
    skills: s.main,
    fallbacks: s.fallbacks,
    increases: s.increases,
    grantedSkills: s.lockedFrom,
    languageLores: s.languageLores,
    skillRankBefore: s.before,
    history: { v: 1, steps: s.steps, at: s.at },
    deferred: deferredUnits,
  };
}
