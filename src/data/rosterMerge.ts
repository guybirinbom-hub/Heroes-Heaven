/*
 * THREE-WAY MERGE OF TWO ROSTERS THAT GREW FROM ONE (package H1, 2026-10-18).
 *
 * Two tabs of one browser profile share ONE roster key in localStorage. Each tab holds its own copy in
 * React state and writes the whole roster 400 ms after an edit (src/data/persist.ts). When one tab's
 * write reaches the other, the other may be holding an edit of its own that is not written yet — the
 * player's potion, or the GM's push it has just applied. Taking either roster whole loses the other
 * one's change: that was the "last flush wins" loss (open since 2026-09-13, ruled "fix it" 2026-10-15).
 *
 * So the two are MERGED against the roster both grew from (`base`): whatever only one side changed is
 * taken from that side, at every depth; a value BOTH changed, differently, is a conflict, and the LOCAL
 * side keeps it unless `yieldTo` says otherwise. Arrays of records that carry their own key (`id`, or an
 * inventory entry's `instanceId`) merge record by record — one tab drinking a potion and the other
 * buying a rope both stay — and any other array is one value.
 *
 * Nothing here knows about tabs, storage or React: src/data/rosterTabs.ts finds the base and the other
 * tab's roster, and App decides who yields. Pure, so test/roster-merge.test.ts can pin every case.
 *
 * JSON semantics throughout (both rosters went through JSON on the way here): a key whose value is
 * `undefined` is the same as no key, and symbol-keyed marks (App's GM_APPLIED) never count as content
 * and are never copied onto a merged object — a merged entry is new content nobody's mark answers for.
 *
 * COUNTS AND COINS merge as VALUES, like everything else (2026-10-20, weighed against the checkers'
 * "merge them as changes: base + local change + incoming change"): a three-way merge cannot tell two
 * changes from ONE change seen twice — the same cloud copy adopted in both tabs, which happens on its
 * own, at once — and adding them up would charge the player twice for one purchase made elsewhere. So
 * a coin purse or a stack both tabs changed keeps this tab's value, as any value does; the cost is
 * the case that needs two clicks in two tabs inside one 400 ms debounce (two buys: both items, one
 * payment). Pinned both ways in test/record-ids.test.ts; telling them apart needs per-change ids.
 */

/** Who gives way when both sides changed one roster entry. `whole`: take the incoming entry as it is.
 *  `conflicts`: merge, but a value both sides changed takes the incoming one. Null: the local side keeps
 *  its conflicts (the default). `{ base, local }`: merge THESE as the base and this side's entry instead —
 *  this side's entry with a change taken out of it that must not count as this side's (S1, 2026-10-20:
 *  an unconfirmed GM push is taken out, a player tap made on top of it stays). */
export type Yield<T = unknown> = 'whole' | 'conflicts' | null | { base: T | undefined; local: T };

export interface RosterMergeOptions<T> {
  /** Asked only for an entry BOTH sides changed: `local` is this tab's entry, `base` the one both grew
   *  from (undefined when the entry is new on both sides). */
  yieldTo?: (local: T, base: T | undefined) => Yield<T>;
  /** Called for an entry the merge MADE — both sides changed it and the result is neither side's entry
   *  (`local` is the entry this side merged with, after any `yieldTo` rebase). What it returns is kept.
   *  App re-derives such an entry's `character` from its merged `build` here (S2, 2026-10-20). */
  settle?: (merged: T, local: T, incoming: T) => T;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep equality as JSON sees it: an `undefined` property is absent, an `undefined` array slot is null. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i] ?? null, b[i] ?? null)) return false;
    return true;
  }
  if (isRec(a) && isRec(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!(k in b) || !jsonEqual(a[k], b[k])) return false;
    return true;
  }
  // Two numbers, strings, booleans or nulls that are not ===; or an undefined against a value.
  return false;
}

/** The key an array's records merge by: `id` or `instanceId`, when EVERY record in all three versions
 *  is an object carrying it as a string and no version holds it twice. Null otherwise (one value). */
function arrayKey(...arrays: unknown[][]): 'id' | 'instanceId' | null {
  for (const key of ['id', 'instanceId'] as const) {
    let ok = true;
    for (const arr of arrays) {
      const seen = new Set<string>();
      for (const el of arr) {
        const k = isRec(el) ? el[key] : undefined;
        if (typeof k !== 'string' || seen.has(k)) {
          ok = false;
          break;
        }
        seen.add(k);
      }
      if (!ok) break;
    }
    if (ok) return key;
  }
  return null;
}

/**
 * The order of a merged list: the side that REORDERED (its shared keys no longer in the base's order)
 * leads, else the incoming side; every kept key the leading side lacks goes in before the key that
 * follows it on its own side — at the end when nothing placed follows it there.
 */
function mergeOrder(baseKeys: string[], localKeys: string[], incomingKeys: string[], kept: Set<string>): string[] {
  const inOrder = (side: string[]) => {
    const shared = side.filter((k) => baseKeys.includes(k));
    const baseShared = baseKeys.filter((k) => side.includes(k));
    return shared.every((k, i) => k === baseShared[i]);
  };
  const [lead, other] = !inOrder(localKeys) ? [localKeys, incomingKeys] : [incomingKeys, localKeys];
  const out = lead.filter((k) => kept.has(k));
  const placed = new Set(out);
  // Last to first, so a run of new keys keeps its own order (each goes in before the one after it).
  for (let i = other.length - 1; i >= 0; i--) {
    const k = other[i];
    if (!kept.has(k) || placed.has(k)) continue;
    let at = out.length;
    for (let j = i + 1; j < other.length; j++) {
      const idx = out.indexOf(other[j]);
      if (idx >= 0) {
        at = idx;
        break;
      }
    }
    out.splice(at, 0, k);
    placed.add(k);
  }
  // Anything kept that neither list placed (cannot happen — kept ⊆ local ∪ incoming) is appended.
  for (const k of kept) if (!placed.has(k)) out.push(k);
  return out;
}

/** Merge one value three ways. `incomingWins`: a conflict takes the incoming side. */
export function mergeValue(base: unknown, local: unknown, incoming: unknown, incomingWins = false): unknown {
  if (local === incoming || jsonEqual(local, incoming)) return local;
  if (jsonEqual(local, base)) return incoming;
  if (jsonEqual(incoming, base)) return local;
  // Both sides changed it, differently.
  if (isRec(local) && isRec(incoming)) {
    const b = isRec(base) ? base : {};
    const out: Rec = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(incoming)])) {
      const v = mergeValue(b[k], local[k], incoming[k], incomingWins);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (Array.isArray(local) && Array.isArray(incoming)) {
    const b = Array.isArray(base) ? base : [];
    const key = arrayKey(b, local, incoming);
    /*
     * ONE KEY IS ONE RECORD. Merging by key is right only because a key names one record: a record a
     * player ADDS gets a key unique to that mint, and a DERIVED record's key names what was derived
     * (src/rules/recordIds.ts), so two tabs adding at once — or adding after a delete — never meet on one
     * key. A key new on BOTH sides holding the SAME item is the same derived record both tabs made from
     * the same state (a granted formula book, an automatic companion made real) and is merged into ONE,
     * field by field — never kept twice, which would duplicate it. Chosen 2026-10-20 over "keep both
     * under two keys" (that duplicates every derived record); pinned in test/roster-merge.test.ts.
     *
     * The merge itself holds NO guard for two different items under one key, and must not try to tell
     * them apart from their contents: a row whose item changed may be one record repointed (a
     * copy-on-write `custom-…` copy, an alias rewrite) or a different one, and every guess at that
     * (tried 2026-10-20, removed the same day) broke some case worse than it fixed. So the guarantee
     * lives entirely where keys are minted: no mint hands an id another record held — not a freed
     * one, not a builder row's build index (play.ts mergeRebuiltInventory), not a promoted picture's
     * (makeProfileImage). A key both sides changed is one record, merged field by field.
     */
    if (key) {
      const byKey = (arr: unknown[]) => new Map(arr.map((el) => [(el as Rec)[key] as string, el]));
      const bm = byKey(b);
      const lm = byKey(local);
      const im = byKey(incoming);
      const merged = new Map<string, unknown>();
      for (const k of new Set([...lm.keys(), ...im.keys(), ...bm.keys()])) {
        const v = mergeValue(bm.get(k), lm.get(k), im.get(k), incomingWins);
        if (v !== undefined) merged.set(k, v);
      }
      const order = mergeOrder([...bm.keys()], [...lm.keys()], [...im.keys()], new Set(merged.keys()));
      return order.map((k) => merged.get(k));
    }
  }
  return incomingWins ? incoming : local;
}

/**
 * Merge `incoming` (another tab's roster) into `local` (this tab's), both grown from `base`, by roster
 * id. An entry only one side changed comes from that side, whole and as the same object. An entry one
 * side DELETED and the other changed is kept — the change is newer than what was deleted, and deleting
 * again costs a click where the change could not be got back. An entry both sides changed is merged
 * value by value (see `mergeValue`), unless `yieldTo` hands it to the incoming side.
 *
 * Returns `local` itself when nothing changed, so a no-op merge makes no undo step and no write.
 */
export function mergeRosterEdits<T extends { id: string }>(base: T[], local: T[], incoming: T[], opts: RosterMergeOptions<T> = {}): T[] {
  const bm = new Map(base.map((c) => [c.id, c]));
  const lm = new Map(local.map((c) => [c.id, c]));
  const im = new Map(incoming.map((c) => [c.id, c]));
  const out = new Map<string, T>();
  for (const id of new Set([...lm.keys(), ...im.keys()])) {
    const b = bm.get(id);
    const l = lm.get(id);
    const i = im.get(id);
    let v: T | undefined;
    if (l === i || jsonEqual(l, i)) v = l; // the same on both sides: ours, as the same object
    else if (jsonEqual(l, b)) v = i; // only the other tab changed it (or deleted it)
    else if (jsonEqual(i, b)) v = l; // only this tab changed it (or deleted it)
    else if (!l) v = i; // we deleted it, they changed it: keep their change
    else if (!i) v = l; // they deleted it, we changed it: keep ours
    else {
      const y = opts.yieldTo?.(l, b) ?? null;
      let mine = l;
      if (y === 'whole') v = i;
      else if (y && typeof y === 'object') {
        mine = y.local;
        v = mergeValue(y.base, y.local, i) as T;
      } else v = mergeValue(b, l, i, y === 'conflicts') as T;
      if (v !== l && jsonEqual(v, l)) v = l;
      else if (v !== i && jsonEqual(v, i)) v = i;
      if (v && v !== l && v !== i && opts.settle) v = opts.settle(v, mine, i);
    }
    if (v) out.set(id, v);
  }
  const order = mergeOrder(
    base.map((c) => c.id),
    local.map((c) => c.id),
    incoming.map((c) => c.id),
    new Set(out.keys()),
  );
  const next = order.map((id) => out.get(id)!);
  return next.length === local.length && next.every((c, n) => c === local[n]) ? local : next;
}

/**
 * UNDO (or redo) ONE STEP OF THIS TAB'S OWN on the roster as it is NOW (S4, 2026-10-20): carry what the
 * step changed from `from` back to `to` (undo: `from` is the step's result and `to` what it was made on;
 * redo: the other way round). Another tab's write and a cloud adopt are folded in without
 * being undo steps (App), so `present` can hold changes made after the step by someone else; taking the
 * step's snapshot back whole would take those back too (the other tab's dagger, the GM's change). So the
 * step is carried back three ways: `mergeRosterEdits(from, present, to)` — whatever only the step
 * changed goes back, whatever changed since stays, and a value both the step and a later change touched
 * keeps the later one. One rule more than a merge: a character the step left in place that is gone now
 * was deleted by someone since, and undoing the step does not bring it back.
 *
 * `present === from` (nothing came in since the step) is the plain snapshot `to`, as the same objects.
 *
 * `opts.settle` is the merge's (S2): an entry the revert MADE — the step's build change taken back over
 * another tab's later build change — gets its character re-derived from that build (App passes
 * rosterFold.settleMergedBuild; a checker's finding on S4, 2026-10-20: the undone fighter kept the HP of
 * the build it no longer had).
 */
export function revertRosterStep<T extends { id: string }>(present: T[], from: T[], to: T[], opts: RosterMergeOptions<T> = {}): T[] {
  if (present === from) return to;
  const live = new Set(present.map((c) => c.id));
  const inFrom = new Set(from.map((c) => c.id));
  return mergeRosterEdits(
    from,
    present,
    to.filter((c) => live.has(c.id) || !inFrom.has(c.id)),
    opts,
  );
}
