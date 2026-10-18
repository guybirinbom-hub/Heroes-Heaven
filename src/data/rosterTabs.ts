/*
 * TWO TABS OF ONE BROWSER PROFILE (package H1, 2026-10-18; the owner's ruling of 2026-10-15: "fix it").
 *
 * The roster is ONE localStorage key, written whole by whichever tab persists last. The cross-tab
 * guard used to choose between the two copies: adopt the other tab's roster, or — while an edit of its
 * own was still inside the 400 ms persist debounce — ignore it and write over it. Either way one tab's
 * change was lost: a GM push applied in a background tab within 400 ms of the player's own edit in the
 * other tab took the player's edit back (test/bug-two-tabs-roster.test.tsx, legs 1–3).
 *
 * Now nothing is chosen between: another tab's write is MERGED into this tab's roster against the value
 * both grew from (src/data/rosterMerge.ts), wherever this tab meets it — the `storage` event (App), the
 * moment before each of its own writes (the persist module's reconcile hook, App), and before a GM
 * apply is consumed (App's after-commit effect). This file only finds that write and its base:
 *
 *  - the write this tab has not folded in yet is whatever the key holds that is not this tab's `known`
 *    value (src/data/rosterLineage.ts) — read from the key itself, never from an event's `newValue`, so a
 *    late or out-of-order event can never hand back a value the key has since moved past;
 *  - its base is the value its lineage record says it replaced, when this tab still has it; else this
 *    tab's `known` value (what every write was built on before lineage existed);
 *  - an empty key is no information (UNKNOWN is not EMPTY): another tab's account switch or crash
 *    recovery removes it, and "nothing stored" must never read as "every character deleted".
 *
 * Taking the write marks it known, so it is folded once.
 */
import { knownRoster, lineageOf, noteRosterKnown, rosterFromHistory, rosterSig } from './rosterLineage';
import { ROSTER_KEY, parseRoster, type SavedChar } from './storage';
import { recentPersists } from './persist';

export type ForeignRoster =
  /** Another tab's roster, and the roster it and this tab's state both grew from. */
  | { kind: 'write'; base: SavedChar[]; incoming: SavedChar[] }
  /** An OLD app version (no lineage) wrote back a roster this tab wrote earlier — the echo of what it
   *  adopted from us, arriving after we moved on. Not another tab's work: this tab's newer roster has
   *  to go back on disk over it. */
  | { kind: 'echo' };

/** Read the roster key at launch: this tab's state starts out based on exactly what it holds. */
export function loadRosterKnown(): SavedChar[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(ROSTER_KEY);
  } catch {
    /* unreadable storage: nothing known */
  }
  const roster = parseRoster(raw);
  noteRosterKnown(raw, roster);
  return roster;
}

/** What another tab wrote to the roster key that this tab has not folded in yet, or null. */
export function takeForeignRoster(): ForeignRoster | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(ROSTER_KEY);
  } catch {
    return null;
  }
  const k = knownRoster();
  if (raw === null || raw === k.raw) return null;
  const sig = rosterSig(raw);
  const lineage = lineageOf(sig);
  if (!lineage) {
    // No lineage: an older app version, or a raw write. Such a version re-persists what it adopted from
    // us a debounce later (its own echo), possibly after we have written again — adopting that rewound
    // an edit already saved (test/bug-storage-echo-revert.test.tsx (a2)). So any recent write of ours is
    // recognised as ours. (This version never echoes: saveRoster skips a value the key already holds.)
    if ([...recentPersists()].reverse().some((r) => JSON.stringify(r) === raw)) return { kind: 'echo' };
  }
  const base = ((lineage?.on && rosterFromHistory(lineage.on)) || k.roster) as SavedChar[];
  const incoming = parseRoster(raw);
  noteRosterKnown(raw, incoming, sig);
  return { kind: 'write', base, incoming };
}
