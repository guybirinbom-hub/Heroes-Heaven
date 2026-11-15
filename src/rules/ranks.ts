/*
 * Proficiency-rank steps shared by the build and the breakdowns (plan B, WP5). A LEAF: it imports
 * nothing but the rank list, so explain.ts can replay a skill's timeline with the same step the build
 * uses without importing build.ts (which imports derive.ts and much else).
 *
 * …and the readers of the per-level skill history the print pass writes (skill-order plan 1.5; WP3):
 * pure, history-only, and each returns `undefined` when the character has no `skillHistory` (one built
 * before this engine, or a stored copy), so the caller keeps today's reading.
 */
import { PROFICIENCY_RANKS, type Character, type ProficiencyKey, type ProficiencyRank, type SkillStep } from './types';

/** The highest proficiency a skill increase can reach at a given character level. */
export function skillIncreaseCap(level: number): ProficiencyRank {
  if (level >= 15) return 'legendary';
  if (level >= 7) return 'master';
  return 'expert';
}

/** Raise a rank by one step, never past the cap and never below the current rank. */
export function stepRank(current: ProficiencyRank, cap: ProficiencyRank): ProficiencyRank {
  const ci = PROFICIENCY_RANKS.indexOf(current);
  const next = PROFICIENCY_RANKS[Math.min(ci + 1, PROFICIENCY_RANKS.indexOf(cap))];
  return PROFICIENCY_RANKS.indexOf(next) > ci ? next : current;
}

/* ---------------------------------------------------------------------------------------------------- */
/* THE SKILL HISTORY READERS (skill-order plan 1.5; WP3)                                                  */
/* ---------------------------------------------------------------------------------------------------- */

/**
 * A point inside a level: `creation` = the 1st-level creation phase only (P0); `beforeIncreases` = everything
 * placed before that level's skill increases (P0-P5); `afterMain` / `afterBonus` = after the class's increase / the
 * bonus one too; `afterBackground` = after all three book increases (the background's too), before the extra places
 * a tweak adds (Tweaks phase 2, C15: an extra place's card starts here); `end` = the whole level, the feats D5 moved
 * after the increases and the final pass's steps that land at or before it. No point before `end` holds an extra
 * place's increase (`tweakIncrease:`), so the book cards start where they did before any tweak.
 */
export type SkillPoint = 'creation' | 'beforeIncreases' | 'afterMain' | 'afterBonus' | 'afterBackground' | 'end';

/** An extra place's increase (Tweaks phase 2, C15): the step's source is `tweakIncrease:<block id>`. */
export const TWEAK_INCREASE_SOURCE = 'tweakIncrease:';
const isTweakIncrease = (s: SkillStep): boolean => s.phase === 'increase' && s.source.startsWith(TWEAK_INCREASE_SOURCE);

export interface SkillHistoryReadOptions {
  /** Record ids whose steps are skipped (a feat and its granted subtree: "as if it were not taken"). An entry
   *  `<id>@from:<level>` skips only that record's steps from that level on (one copy of a repeatable feat, read
   *  off a stored history, which does not tell copies apart; WP7 round 2). */
  without?: ReadonlySet<string>;
}

/** `<id>@from:<level>`: a `without` entry for one copy of a record (`SkillHistoryReadOptions.without`). */
export const SKILL_FROM_LEVEL = '@from:';

/** A step's record id: `feat:kholo-lore` → `kholo-lore` (a replacement pick `pick:<id>` → `<id>`). */
const stepRecordId = (s: SkillStep): string => s.source.slice(s.source.indexOf(':') + 1);

/** Does a step land at or before `point` of `level`? */
function stepWithin(s: SkillStep, level: number, point: SkillPoint): boolean {
  if (s.level < level) return point !== 'creation' || (s.level === 1 && s.phase === 'create');
  if (s.level > level) return false;
  switch (point) {
    case 'creation':
      return s.phase === 'create';
    case 'beforeIncreases':
      return s.phase !== 'increase' && s.phase !== 'featAfterIncrease' && s.phase !== 'final';
    case 'afterMain':
      return s.phase !== 'featAfterIncrease' && s.phase !== 'final' && (s.phase !== 'increase' || s.source.startsWith('increase:'));
    case 'afterBonus':
      return s.phase !== 'featAfterIncrease' && s.phase !== 'final' && (s.phase !== 'increase' || (!s.source.startsWith('bgIncrease:') && !isTweakIncrease(s)));
    case 'afterBackground':
      return s.phase !== 'featAfterIncrease' && s.phase !== 'final' && !isTweakIncrease(s);
    case 'end':
      return true;
  }
}

const rankIdx = (r: ProficiencyRank): number => PROFICIENCY_RANKS.indexOf(r);
const higher = (a: ProficiencyRank, b: ProficiencyRank): ProficiencyRank => (rankIdx(b) > rankIdx(a) ? b : a);

/** Is a step a skill increase (the class's, a bonus one, a background's or an extra place's, C15)? It steps ONE rank
 *  from wherever the key stands, capped by its level (the print pass's `step` op). */
const isIncreaseStep = (s: SkillStep): boolean => s.phase === 'increase' && /^(increase|bonus|bgIncrease|tweakIncrease):/.test(s.source);

/**
 * One kept step re-applied on top of `running` (the key's rank so far in a replay that left records out): the
 * stored `to` was worked out WITH every earlier step, so a later step on a key a skipped record raised must not
 * keep it. A step that wrote nothing (a redirect, a dropped increase, one an old `=` swallowed) writes nothing; a
 * lowering, a creation write and an old `=` / "exactly" set land on their `to` exactly; an increase steps once,
 * capped by its level; every other write raises to what it asked for (`rank` when that was below `from`, else `to`).
 */
function replayStep(running: ProficiencyRank, s: SkillStep): ProficiencyRank {
  if (s.note === 'redirect' || s.note === 'drop' || s.note === 'swallow') return running;
  if (rankIdx(s.to) < rankIdx(s.from) || s.phase === 'set' || s.phase === 'create') return s.to;
  if (isIncreaseStep(s)) return stepRank(running, skillIncreaseCap(s.level));
  return higher(running, s.rank ?? s.to);
}

/**
 * The ranks every key holds after the steps `keep` admits, in print order (a key no step names is absent). With a
 * non-empty `without`, those records' steps are left out and every kept step is REPLAYED from the running rank
 * (`replayStep`), so a later step cannot keep a rank only the skipped record gave (checker finding, WP3 round 1:
 * Barbarian Dedication + an Athletics increase at 2, read without the dedication, said expert). The judges are
 * not re-run: a later record that redirected ("already trained → a skill of your choice") because of a skipped
 * one stays as recorded (it writes nothing; its stored pick still counts).
 */
function ranksOf(steps: readonly SkillStep[], keep: (s: SkillStep, i: number) => boolean, without?: ReadonlySet<string>): Partial<Record<ProficiencyKey, ProficiencyRank>> {
  const out: Partial<Record<ProficiencyKey, ProficiencyRank>> = {};
  const skip = without && without.size > 0 ? without : undefined;
  const from = new Map<string, number>();
  for (const w of skip ?? []) {
    const at = w.indexOf(SKILL_FROM_LEVEL);
    if (at >= 0) from.set(w.slice(0, at), Math.min(from.get(w.slice(0, at)) ?? Infinity, Number(w.slice(at + SKILL_FROM_LEVEL.length))));
  }
  const skipped = (s: SkillStep): boolean => {
    const id = stepRecordId(s);
    return skip!.has(id) || s.level >= (from.get(id) ?? Infinity);
  };
  steps.forEach((s, i) => {
    if (!keep(s, i) || (skip && skipped(s))) return;
    out[s.key] = skip ? replayStep(out[s.key] ?? 'untrained', s) : s.to;
  });
  return out;
}

/** The rank `key` holds at `point` of `level` (untrained when no step names it there). Undefined without a history. */
export function skillRankAt(c: Pick<Character, 'skillHistory'>, key: ProficiencyKey, level: number, point: SkillPoint, opts?: SkillHistoryReadOptions): ProficiencyRank | undefined {
  const r = skillRanksAt(c, level, point, opts);
  return r ? r[key] ?? 'untrained' : undefined;
}

/** Every key's rank at `point` of `level` (a key absent = untrained). Undefined without a history. */
export function skillRanksAt(
  c: Pick<Character, 'skillHistory'>,
  level: number,
  point: SkillPoint,
  opts?: SkillHistoryReadOptions,
): Partial<Record<ProficiencyKey, ProficiencyRank>> | undefined {
  const h = c.skillHistory;
  if (!h) return undefined;
  return ranksOf(h.steps, (s) => stepWithin(s, level, point), opts?.without);
}

/** Every key's rank just before a record's print position (`history.at[source]`, source = '<kind>:<id>'). Undefined
 *  without a history, or when the record has no position (the caller then reads `skillRanksAt(…, 'beforeIncreases')`). */
export function skillRanksBeforeSource(
  c: Pick<Character, 'skillHistory'>,
  source: string,
  opts?: SkillHistoryReadOptions,
): Partial<Record<ProficiencyKey, ProficiencyRank>> | undefined {
  const h = c.skillHistory;
  const at = h?.at[source];
  if (!h || at === undefined) return undefined;
  return ranksOf(h.steps, (_s, i) => i < at, opts?.without);
}

/** One key's rank just before a record's print position (untrained when no earlier step names it). */
export function skillRankBeforeSource(c: Pick<Character, 'skillHistory'>, source: string, key: ProficiencyKey): ProficiencyRank | undefined {
  const r = skillRanksBeforeSource(c, source);
  return r ? r[key] ?? 'untrained' : undefined;
}

/** The first level whose end holds `key` at `rank` or better; undefined without a history or when no level does. */
export function firstLevelAtRank(c: Pick<Character, 'skillHistory' | 'level'>, key: ProficiencyKey, rank: ProficiencyRank): number | undefined {
  if (!c.skillHistory) return undefined;
  const need = PROFICIENCY_RANKS.indexOf(rank);
  const top = Math.max(c.level, ...c.skillHistory.steps.map((s) => s.level));
  for (let lvl = 1; lvl <= top; lvl++) {
    const r = skillRankAt(c, key, lvl, 'end') ?? 'untrained';
    if (PROFICIENCY_RANKS.indexOf(r) >= need) return lvl;
  }
  return undefined;
}

/**
 * Does the history's answer for `key` match the sheet? Its last `to` (or `held`, the "exactly" hold the caller
 * already shows) equals `c.proficiencies.skills[key]`. A reader of a STORED character uses the history for a key
 * only when it agrees (an import can patch ranks after the build). Undefined without a history.
 */
export function historyAgrees(c: Pick<Character, 'skillHistory' | 'proficiencies'>, key: ProficiencyKey, held?: ProficiencyRank): boolean | undefined {
  const h = c.skillHistory;
  if (!h) return undefined;
  let last: ProficiencyRank = 'untrained';
  for (const s of h.steps) if (s.key === key) last = s.to;
  return (held ?? last) === (c.proficiencies.skills[key] ?? 'untrained');
}
