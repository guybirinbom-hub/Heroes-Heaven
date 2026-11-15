/*
 * OLD CHARACTERS — the read-time sort of the old Overrides rank entries (plan B, WP3; docs/overrides-redesign.md
 * spec items 2 and 5, open point 2; work/tweaks-part-b-notes/plan.md section 3, decisions B1, B2, B3, B26).
 *
 * The old Overrides set a rank with `=` at ONE slot of the build (after the class raises, before the feat
 * grants). Tweaks has two rank kinds instead: "at least" (a floor) and "exactly" (a hold). An old entry with
 * no `mode` stamped in its meta is sorted into one of them when it is READ — never written back on load:
 *   - B1: the rank it is compared with is the rank the old `=` REPLACED, measured AT ITS SLOT — the same
 *     build with every unsorted entry removed, just before the old loop (build.ts `legacyRankSort` and its
 *     module-private at-slot probe). Never the final rank: raises that run after the slot (FEAT_GRANTS,
 *     "expert if already trained", archetype steps) were never lowered by the old `=`.
 *   - B2 (`rankSortFor`): below the at-slot rank → "exactly" (the old `=` really lowered it); at or above →
 *     "at least". A Lore stored under a RAW key that is not its own `loreKey` form (`lore:Sailing Lore`) is
 *     always "at least": the old `=` wrote its own row, so it never lowered the real Lore row. An entry
 *     with an unreadable rank, a key that names no rank track this phase builds, or a bare `lore:Lore` is
 *     not sortable: it stays 'rank.legacySet' (today's `=`, untouched).
 *   - B3: the sort is a DERIVED field (`Character.tweakRankSort`); `overrides` stays the stored object. The
 *     readers (blocks/active.ts `rankTweaks`, `liveLegacyRanks`) lay it over the stored meta in memory
 *     (`withRankSort`), as `{ mode, of, moved: true }`: every sorted entry is a MOVED one (B26), so it
 *     keeps feeding the build's readers what the old `=` fed them until the player edits it.
 *
 * Pure: no build import (build.ts imports this). Nothing here writes a stored object.
 */
import { loreKey } from '../loreKey';
import type { BuildOverrides, Proficiencies, ProficiencyRank, TweakMeta, TweakRankSort } from '../types';
import { PROFICIENCY_RANKS } from '../types';
import { legacyEntries, proficiencyTarget } from './stored';
import { targetBuilt } from './targets';

/** The ranks the at-slot probe hands over: every track, copied (build.ts `buildCharacter`, right before the
 *  old override loop). */
export type AtSlotRanks = Pick<Proficiencies, 'perception' | 'classDc' | 'saves' | 'skills' | 'attacks' | 'defenses'>;

const RANK_SET = new Set<string>(PROFICIENCY_RANKS);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Does the entry's own meta (its `of` matches) carry a `mode` — any mode, one this version knows or not? */
function modeStamped(ov: BuildOverrides, key: string, of: string): boolean {
  const m = isObj(ov.meta) ? (ov.meta as Record<string, unknown>)[key] : undefined;
  return isObj(m) && (m.of == null || m.of === of) && m.mode != null;
}

/** A raw Lore key: a `lore:` key that is not its own `loreKey` form (`lore:Sailing Lore`, `lore:scribing-lore`). */
const isRawLore = (key: string): boolean => key.startsWith('lore:') && loreKey(key) !== key;

/**
 * B2 — the sort of ONE old entry: "exactly" when its rank is below the rank the old `=` met at its slot,
 * else "at least"; a raw Lore key is always "at least" (its `=` wrote a row of its own and never lowered
 * the real one).
 */
export function rankSortFor(rawKey: string, entryRank: ProficiencyRank, atSlotRank: ProficiencyRank): 'atLeast' | 'exactly' {
  if (isRawLore(rawKey)) return 'atLeast';
  return PROFICIENCY_RANKS.indexOf(entryRank) < PROFICIENCY_RANKS.indexOf(atSlotRank) ? 'exactly' : 'atLeast';
}

/**
 * The old `overrides.proficiencies` keys the read-time sort takes: UNSORTED (the stored reader reads them as
 * 'rank.legacySet' — no meta `mode` with a matching `of`) and SORTABLE (B2: a proficiency rank, and a key
 * that maps to a rank track this phase builds — a Lore whose `loreKey` is not null). Paused, switched-off
 * and not-yet-started entries are sorted too: the sort describes the stored entry, liveness stays the
 * reader's job. In stored order.
 */
export function unsortedRankKeys(ov: BuildOverrides | undefined): string[] {
  if (!ov || !isObj(ov.proficiencies)) return [];
  const out: string[] = [];
  for (const e of legacyEntries({ proficiencies: ov.proficiencies, meta: ov.meta })) {
    if (e.list !== 'proficiencies' || e.kind !== 'rank.legacySet' || !RANK_SET.has(e.of)) continue;
    // A matching meta with ANY mode was sorted by whoever wrote it: a mode this version does not know (a
    // newer app's) is kept as it is, never re-sorted (UNKNOWN ≠ EMPTY; plan B WP6, wp4-report).
    if (modeStamped(ov, e.key, e.of)) continue;
    const key = String(e.index);
    const target = proficiencyTarget(key, true);
    if (target && targetBuilt(target, 'rank')) out.push(key);
  }
  return out;
}

/**
 * B1 — the INNER build of the at-slot probe: the same host with every unsorted sortable entry removed from
 * `overrides.proficiencies`. The sorted entries (and every other key, `meta` and `v` included) stay, so
 * their floors are in the probe's snapshot as they are in the real build. `undefined` when there is
 * nothing to sort (the fast path: every character saved by part B). A pure copy.
 */
export function withoutUnsortedRanks<T extends { overrides?: BuildOverrides }>(host: T): { inner: T; keys: string[] } | undefined {
  const ov = host.overrides;
  const keys = unsortedRankKeys(ov);
  if (!keys.length || !ov) return undefined;
  const drop = new Set(keys);
  const rest = Object.fromEntries(Object.entries(ov.proficiencies as Record<string, ProficiencyRank>).filter(([k]) => !drop.has(k)));
  return { inner: { ...host, overrides: { ...ov, proficiencies: rest } }, keys };
}

/** The rank the snapshot holds for one stored key: perception, class DC, a save, a weapon or armor
 *  category, else a skill — a Lore by its `loreKey` row (a canonical key is its own `loreKey`). */
export function atSlotRankOf(snap: AtSlotRanks, key: string): ProficiencyRank {
  const target = proficiencyTarget(key, true) ?? `skill:${key}`;
  const i = target.indexOf(':');
  const kind = i < 0 ? target : target.slice(0, i);
  const detail = i < 0 ? '' : target.slice(i + 1);
  const r =
    kind === 'perception'
      ? snap.perception
      : kind === 'class-dc'
        ? snap.classDc
        : kind === 'save'
          ? (snap.saves as Record<string, ProficiencyRank>)[detail]
          : kind === 'weapon'
            ? (snap.attacks as Record<string, ProficiencyRank>)[detail]
            : kind === 'armor'
              ? (snap.defenses as Record<string, ProficiencyRank>)[detail]
              : (snap.skills as Record<string, ProficiencyRank>)[detail];
  return r ?? 'untrained';
}

/** B1 + B2: the sort of `keys` (from `withoutUnsortedRanks` on the same host) against the probe's snapshot. */
export function rankSortFromSnapshot(host: { overrides?: BuildOverrides }, keys: string[], snap: AtSlotRanks): TweakRankSort {
  const profs = (host.overrides?.proficiencies ?? {}) as Record<string, ProficiencyRank>;
  const sort: TweakRankSort = {};
  for (const k of keys) if (RANK_SET.has(profs[k])) sort[k] = rankSortFor(k, profs[k], atSlotRankOf(snap, k));
  return sort;
}

/** Memo: stored overrides → sort → the sorted copy (both weak, so an edit's new objects get new entries). */
const SORTED = new WeakMap<object, WeakMap<object, BuildOverrides>>();

/**
 * The stored overrides with the read-time sort laid over their meta, IN MEMORY: for every sorted key still
 * read as 'rank.legacySet', `meta['proficiencies:<key>'] = { ...its matching meta, mode, of: <rank>, moved:
 * true }` (B26: a sorted entry is a moved one; an import-stamped meta is never marked moved). A stale meta
 * (its `of` names another value) is ignored by the reader today, so none of it is kept. The stored object
 * itself when nothing changes; memoised, so the readers' own caches (keyed on `meta`) stay warm. Never
 * touches `v` (B27) and never mutates `ov`.
 */
export function withRankSort(ov: BuildOverrides | undefined, sort: TweakRankSort | undefined): BuildOverrides | undefined {
  if (!ov || !sort || !isObj(ov.proficiencies)) return ov;
  let bySort = SORTED.get(ov);
  const hit = bySort?.get(sort);
  if (hit) return hit;
  const meta = isObj(ov.meta) ? (ov.meta as Record<string, TweakMeta>) : {};
  let next: Record<string, TweakMeta> | undefined;
  const entries = legacyEntries({ proficiencies: ov.proficiencies, meta: ov.meta });
  for (const e of entries) {
    const mode = sort[String(e.index)];
    if (e.list !== 'proficiencies' || e.kind !== 'rank.legacySet' || !mode || !RANK_SET.has(e.of)) continue;
    // A newer app's mode is never written over (see `unsortedRankKeys`).
    if (modeStamped(ov, e.key, e.of)) continue;
    const m = meta[e.key];
    const matching = m && (m.of == null || m.of === e.of) ? m : undefined;
    next ??= { ...meta };
    next[e.key] = { ...(matching ?? {}), mode, of: e.of, ...(matching?.source === 'import' ? {} : { moved: true as const }) };
  }
  const out = next ? { ...ov, meta: next } : ov;
  if (!bySort) SORTED.set(ov, (bySort = new WeakMap()));
  bySort.set(sort, out);
  return out;
}
