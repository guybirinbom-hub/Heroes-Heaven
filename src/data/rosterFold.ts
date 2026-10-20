/*
 * HOW APP FOLDS ANOTHER TAB'S ROSTER WRITE INTO ITS OWN — the two rules of App's that the pure merge
 * (src/data/rosterMerge.ts) is handed (2026-10-20, a checker's findings S1 and S2 on 6393b29) — and App's
 * undo, which carries a step back with the same merge. Kept here, out of App, so
 * test/roster-fold.test.ts can pin them without rendering the app.
 */
import { jsonEqual, mergeValue, revertRosterStep, type Yield } from './rosterMerge';
import { rebuildRoster } from './rebuild';
import type { SavedChar } from './storage';
import type { ContentDatabase } from '../rules/types';

/** A GM push this tab applied whose commit has not been consumed yet (App's gmAppliedRef record):
 *  the entry it wrote, and the entry it replaced. */
export interface UnconsumedApply {
  entry: SavedChar;
  over: SavedChar;
}

/**
 * WHO GIVES WAY when another tab's write and this tab's entry both changed one character (H1,
 * 2026-10-18). A GM push this tab applied is never the player's own change, so it never wins against one:
 *
 *  - a push NOT LANDED yet (no commit has been found to hold it and consumed it) is TAKEN OUT of this
 *    tab's entry before the merge — its own diff (the entry it replaced → the entry it wrote) undone,
 *    on the base too when the base already holds it — and the merge then runs as for any change of this
 *    tab's. What the player did after the push in this tab stays; the other tab's change is taken; the
 *    after-commit effect finds the entry replaced and the row is judged again (it waits, and is refused
 *    with a receipt once their change publishes). S1 (2026-10-20): this used to give way WHOLE — the
 *    other tab's entry as it was — and a tap the player made on top of the push in the same render batch
 *    (it carries the push's mark: object spread copies symbol keys) went with it;
 *  - a push already consumed, made after the roster the other tab built on (the mark is on this entry and
 *    not on the base's), loses every value both changed — the other tab's write cannot have seen it.
 *
 * `markOf` reads App's GM_APPLIED mark; `applied` is every apply NOT LANDED yet, by mark (App's
 * gmUnlandedRef — kept past a record the after-commit effect drops, because React can still commit that
 * apply later from the result it computed at dispatch: test/bug-two-tabs-roster.test.tsx leg 7).
 */
export function gmApplyYields(
  applied: ReadonlyMap<string, UnconsumedApply>,
  markOf: (c: SavedChar) => string | undefined,
): (local: SavedChar, base: SavedChar | undefined) => Yield<SavedChar> {
  return (local, base) => {
    const mark = markOf(local);
    if (!mark) return null;
    const rec = applied.get(mark);
    if (rec) {
      // A conflict between the push and a later tap keeps the tap (the local side of this merge).
      const takeOut = (c: SavedChar) => mergeValue(rec.entry, c, rec.over) as SavedChar;
      return { base: base && markOf(base) === mark ? takeOut(base) : base, local: takeOut(local) };
    }
    return base && markOf(base) === mark ? null : 'conflicts';
  };
}

/**
 * A MERGED ENTRY'S `character` FOLLOWS ITS MERGED `build` (S2, 2026-10-20). The stored character is a
 * copy derived from the build (src/data/rebuild.ts). Merged value by value, two tabs that each changed
 * the build of one character inside one save window — or one tab's launch rebuild meeting the other's
 * build change — get a build that is both changes and a character whose conflicting derived fields keep
 * this tab's values: a sheet that no longer matches its own build, written to storage and pushed.
 *
 * So an entry the merge MADE (`settle` of mergeRosterEdits) whose build and character are not one
 * side's own pair is re-derived from its merged build, carrying the player's own character fields as
 * every rebuild does — and registered as a DERIVED refresh (`noteDerived(next, prev)`, cloud sync's
 * noteDerivedRefresh), never as an edit: `prev` is this tab's entry, so an edit of ours inside it is
 * still stamped and pushed, and nothing else is. Without content (not loaded yet) it is left as merged:
 * the launch rebuild re-derives every character once content is in.
 */
export function settleMergedBuild(
  content: ContentDatabase | null,
  noteDerived: (next: SavedChar[], prev: SavedChar[]) => void,
): (merged: SavedChar, local: SavedChar, incoming: SavedChar) => SavedChar {
  return (merged, local, incoming) => {
    if (!content || !merged.build) return merged;
    if ([local, incoming].some((s) => jsonEqual(s.build, merged.build) && jsonEqual(s.character, merged.character))) return merged;
    const [next] = rebuildRoster([merged], content);
    if (next !== merged) noteDerived([next], [local]);
    return next;
  };
}

/**
 * APP'S UNDO: this tab's own step carried back onto the roster as it is now (rosterMerge.revertRosterStep,
 * S4), with S2's rule — an entry the revert MADE (the step took a build change back over another tab's
 * later build change) has its character re-derived from that build. A checker's finding on S4
 * (2026-10-20): undoing a level-up after the other tab changed the ancestry left a level 1 dwarf with
 * the level 2 human's hit points, written and pushed until the next launch.
 *
 * Registered as NOTHING (unlike a fold's settle): the undo is the player's own edit, and the persist
 * that follows stamps and pushes it as one.
 */
export function revertOwnStep(content: ContentDatabase | null): (present: SavedChar[], from: SavedChar[], to: SavedChar[]) => SavedChar[] {
  return (present, from, to) => revertRosterStep(present, from, to, { settle: settleMergedBuild(content, () => {}) });
}
