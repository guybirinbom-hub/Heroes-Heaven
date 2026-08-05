/*
 * Records whose entire content is "that number the app already computes should be bigger".
 *
 * Each of these counters comes from a hardcoded formula no record could influence: snareAllowance's
 * 4/6/8, commanderFolioMax's 5+2+2+2, a choice group's pick count, a container's printed capacity.
 * So Plentiful Snares ("double the number of snares you can prepare") and its kin did nothing.
 *
 * A REGISTRY rather than a field per counter, so the next one of these is a row and not a refactor.
 * Order matters and is fixed: every `add` first, then every `mul`, then any `set` wins outright —
 * otherwise "double it" and "+2" would give different totals depending on which record was read
 * first, and two players with the same feats would see different numbers.
 */
import type { ProficiencyRank } from './types';

export type CounterId =
  | 'snares-prepared'
  | 'snares-known'
  | 'commander-folio'
  | 'prepared-tactics'
  | 'ikon-picks'
  | 'container-capacity';

export interface CounterMod {
  counter: CounterId;
  op: 'add' | 'mul' | 'set';
  value: number;
  /** A repeatable feat applies once per time it was taken. */
  repeatable?: boolean;
}

/** Record id (feat or class feature) → the counters it changes. */
export const COUNTER_MODS: Record<string, CounterMod[]> = {
  // "You can prepare twice as many snares."
  'plentiful-snares': [{ counter: 'snares-prepared', op: 'mul', value: 2 }],
  'ubiquitous-snares': [{ counter: 'snares-prepared', op: 'mul', value: 2 }],
  // "Increase the number of tactics in your folio by 2." Repeatable.
  'tactical-expansion': [{ counter: 'commander-folio', op: 'add', value: 2, repeatable: true }],
  // "You gain an additional ikon."
  'additional-ikon': [{ counter: 'ikon-picks', op: 'add', value: 1 }],
  'second-ikon': [{ counter: 'ikon-picks', op: 'add', value: 1 }],
};

/**
 * Apply every mod the character owns to one counter's computed base.
 *
 * `owned` is a multiset: a repeatable feat taken twice appears twice, and only a mod marked
 * `repeatable` counts more than once — otherwise a duplicate entry would silently double a one-off.
 */
export function applyCounterMods(counter: CounterId, base: number, owned: readonly string[]): number {
  const mods: CounterMod[] = [];
  const seen = new Set<string>();
  for (const id of owned) {
    for (const m of COUNTER_MODS[id] ?? []) {
      if (m.counter !== counter) continue;
      if (!m.repeatable && seen.has(id)) continue;
      mods.push(m);
    }
    seen.add(id);
  }
  if (!mods.length) return base;
  let n = base;
  for (const m of mods) if (m.op === 'add') n += m.value;
  for (const m of mods) if (m.op === 'mul') n *= m.value;
  const set = mods.filter((m) => m.op === 'set');
  if (set.length) n = Math.max(...set.map((m) => m.value));
  return Math.max(0, Math.round(n));
}

/** The snare allowance a character actually has, formula plus whatever their records change. */
export function snareAllowanceFor(
  craftingRank: ProficiencyRank,
  owned: readonly string[],
  base: (r: ProficiencyRank) => { known: number; prepared: number },
): { known: number; prepared: number } {
  const b = base(craftingRank);
  return {
    known: applyCounterMods('snares-known', b.known, owned),
    prepared: applyCounterMods('snares-prepared', b.prepared, owned),
  };
}
