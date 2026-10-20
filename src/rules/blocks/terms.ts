/*
 * TERM LISTS — one list of terms per sheet number, read by the number AND by its breakdown.
 *
 * Design: docs/overrides-redesign.md, "Building blocks" items 4 and 5 (and spec items 6 and 7). Today
 * `explain.ts` rebuilt each breakdown by hand and drifted from `derive.ts`: the save breakdown had no
 * record save bonus, the max-HP one no mode term, Initiative listed none of its own bonuses. A number
 * now builds ONE `Term[]` beside its derive function; the derive function's value is
 * `resolveTerms(list).total`, and the breakdown's parts are `resolveTerms(list).parts`. The parts sum to
 * the total BY CONSTRUCTION: each part carries what its term actually added (`taken`).
 *
 * A Term is a `TypedMod` (modes.ts) plus what the breakdown needs to say about it. Pooling goes through
 * `poolTypedMods` and nothing else — the PF2e stacking rule ("best bonus and worst penalty of each type,
 * untyped sums") is never restated here.
 *
 * THE ONE "SET AND POOLING" RULE (Building blocks item 4; the open points settled in the part A plan):
 *   - Layers: 'base' (rank, attribute, the 10 of a DC) and 'book' (every record term, item bonuses
 *     included) are the PERMANENT part P. 'transient' is what is switched on in play: conditions, modes,
 *     the stance, state-gated book terms (rage, panache), an attribute's mode shift. 'tweak' is a block
 *     the player wrote (slot add / set / atLeast).
 *   - No set, and no "at least" that lifts: everything is ONE pool, exactly as before tweaks existed —
 *     typed terms pool by type across book, condition, mode, stance and typed tweak adds; untyped sums.
 *     An "at least N" that does not lift shows +0, "already N or more".
 *   - A set S (or an "at least N" that lifts, which then acts as a set to N): P is replaced. Its lines
 *     still show what P was (pooled among themselves); the set line carries S − pool(P); every untyped
 *     tweak add sums; the transient terms pool among themselves TOGETHER WITH the typed tweak adds.
 *   - Several sets on one number: the LAST one in the list counts; the others show +0 ("replaced by a
 *     later set"). A set and an "at least" together: the set first, then each "at least" lifts what is
 *     there (so the number is at least max(S, N)). A result may be negative — a modifier can be; the
 *     stat's own floor (0 for max HP and Speed) is the stat's line, not this file's.
 */
import { poolTypedMods, type TypedMod } from '../modes';
import type { BlockSource } from './registry';

export type TermLayer = 'base' | 'book' | 'tweak' | 'transient';
/** A tweak term's order slot (spec item 6): set → at least → add. Absent = an ordinary add. */
export type TermSlot = 'add' | 'set' | 'atLeast';

export interface Term extends TypedMod {
  /** The breakdown line. */
  label: string;
  note?: string;
  layer: TermLayer;
  /** A block's fixed key (registry.ts BlockInstance.key), when the term came from a block. */
  key?: string;
  source?: BlockSource;
  /** Tweak terms only. A 'set' / 'atLeast' term's `value` is the number it sets, not a difference. */
  slot?: TermSlot;
}

/** One breakdown line: the term, and what it actually added to the total. */
export interface TermPart {
  label: string;
  note?: string;
  /** What this term added — the parts sum to `total`. */
  value: number;
  term: Term;
}

export interface ResolvedTerms {
  total: number;
  parts: TermPart[];
}

/** The wording on a typed term a bigger one of its type beat (Building blocks item 5). One spelling,
 *  used by every breakdown. */
export const DOES_NOT_STACK = 'does not stack';

/**
 * What each modifier ACTUALLY added to the pooled total, aligned with `mods`.
 *
 * Measured rather than re-decided: the modifiers go into `poolTypedMods` strongest first, and each
 * one's share is how much the running total MOVED when it went in. Strongest first is what makes the
 * credited one the one PF2e keeps (a tie goes to the earlier one); the rule itself is never restated
 * here — there is exactly one implementation of "best bonus, worst penalty, untyped sums" in the app
 * and this asks it rather than agreeing with it. `takenByTerm(mods)` sums to `poolTypedMods(mods)` by
 * construction. (Moved here from initiative.ts, generic, 2026-10-20.)
 */
export function takenByTerm(mods: TypedMod[]): number[] {
  const taken = new Array<number>(mods.length).fill(0);
  const order = mods.map((_, i) => i).sort((a, b) => Math.abs(mods[b].value) - Math.abs(mods[a].value));
  const pool: TypedMod[] = [];
  let running = 0;
  for (const i of order) {
    pool.push(mods[i]);
    const next = poolTypedMods(pool);
    taken[i] = next - running;
    running = next;
  }
  return taken;
}

const isSet = (t: Term) => t.slot === 'set';
const isAtLeast = (t: Term) => t.slot === 'atLeast';
const isPermanent = (t: Term) => t.layer === 'base' || t.layer === 'book';

/** The note a part shows: the term's own, plus why it added less than it says. */
function partNote(t: Term, taken: number): string | undefined {
  // Only a TYPED term can be beaten; an untyped one always adds in full (decision 15).
  if (t.type !== 'untyped' && t.value !== 0 && taken === 0) return t.note ? `${t.note} — ${DOES_NOT_STACK}` : DOES_NOT_STACK;
  return t.note;
}

/**
 * Resolve one number's term list: its total, and one part per term saying what it added.
 *
 * Parts keep the list's order. A term builder puts the terms in the order spec item 6 reads them —
 * base, book, then the tweaks, then the transient ones — so the breakdown reads the same way.
 */
export function resolveTerms(terms: Term[]): ResolvedTerms {
  const adds = terms.filter((t) => !isSet(t) && !isAtLeast(t));
  const perm = adds.filter(isPermanent);
  const permTotal = poolTypedMods(perm);

  // The sets and "at least"s, in list order: the last set counts, then each "at least" lifts.
  const sets = terms.filter(isSet);
  const winningSet = sets[sets.length - 1];
  let current = winningSet ? winningSet.value : permTotal;
  const lift = new Map<Term, number>();
  for (const t of terms.filter(isAtLeast)) {
    const l = Math.max(0, t.value - current);
    lift.set(t, l);
    current += l;
  }
  const replaced = !!winningSet || [...lift.values()].some((l) => l > 0);

  const taken = new Map<Term, number>();
  let total: number;
  if (!replaced) {
    // ONE pool, as before tweaks existed.
    const t = takenByTerm(adds);
    adds.forEach((x, i) => taken.set(x, t[i]));
    total = poolTypedMods(adds);
  } else {
    // P is replaced: its lines still show what it was, pooled among themselves.
    const tp = takenByTerm(perm);
    perm.forEach((x, i) => taken.set(x, tp[i]));
    // Untyped tweak adds always add; the transient terms pool among themselves with the typed tweak adds.
    const untypedTweaks = adds.filter((x) => x.layer === 'tweak' && x.type === 'untyped');
    const onTop = adds.filter((x) => x.layer === 'transient' || (x.layer === 'tweak' && x.type !== 'untyped'));
    for (const x of untypedTweaks) taken.set(x, x.value);
    const to = takenByTerm(onTop);
    onTop.forEach((x, i) => taken.set(x, to[i]));
    const setBase = winningSet ? winningSet.value : permTotal;
    total = setBase + [...lift.values()].reduce((s, l) => s + l, 0) + untypedTweaks.reduce((s, x) => s + x.value, 0) + poolTypedMods(onTop);
  }

  const parts: TermPart[] = terms.map((t) => {
    if (isSet(t)) {
      const wins = t === winningSet;
      return { label: t.label, ...(wins ? {} : { note: 'replaced by a later set' }), value: wins ? t.value - permTotal : 0, term: t };
    }
    if (isAtLeast(t)) {
      const l = lift.get(t) ?? 0;
      return { label: t.label, ...(l ? {} : { note: `already ${t.value} or more` }), value: l, term: t };
    }
    const v = taken.get(t) ?? 0;
    const note = partNote(t, v);
    return { label: t.label, ...(note ? { note } : {}), value: v, term: t };
  });
  return { total, parts };
}

/**
 * The total alone, for the derive functions (they run far more often than a breakdown is opened). The
 * same arithmetic as `resolveTerms(terms).total`: with no set and no "at least" in the list, that IS
 * the one pool; otherwise this simply asks resolveTerms.
 */
export function termsTotal(terms: Term[]): number {
  return terms.some((t) => isSet(t) || isAtLeast(t)) ? resolveTerms(terms).total : poolTypedMods(terms);
}

/** The parts as the breakdown popup prints them. */
export const partsOf = (r: ResolvedTerms): { label: string; note?: string; value: number }[] =>
  r.parts.map((p) => ({ label: p.label, ...(p.note ? { note: p.note } : {}), value: p.value }));
