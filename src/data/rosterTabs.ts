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
 *
 * ANOTHER ACCOUNT (S3, 2026-10-20). Signing in as a different account in another tab wipes the roster key
 * and fills it with that account's roster (cloudSync startSync, its first adopt). That write is built on
 * nothing this tab knows (its lineage says it replaced an empty key), and merged against this tab's
 * old-account roster it read as "they deleted every character" — so a character this tab held an unsaved
 * edit on was KEPT ("they deleted it, we changed it"), written back, folded in by the switching tab and
 * pushed into the NEW account's cloud. So every value this tab knows carries the account it belonged to
 * (rosterLineage `owner`); when the sync owner has changed since, the write is the other account's roster
 * and is taken WHOLE (`replace`), and until one arrives this tab writes nothing (`rosterOwnerSwitched`,
 * App's reconcile step): what it holds belongs to the old account, which this browser no longer syncs.
 * A device no account had synced (owner null) gaining one is the first sign-in, not a switch — its local
 * roster is that account's (the same rule as startSync).
 */
import { knownRoster, lineageOf, noteRosterKnown, rosterFromHistory, rosterSig } from './rosterLineage';
import { ROSTER_KEY, loadSyncOwner, parseRoster, readRoster, type SavedChar } from './storage';
import { recentPersists } from './persist';

export type ForeignRoster =
  /** Another tab's roster, and the roster it and this tab's state both grew from. */
  | { kind: 'write'; base: SavedChar[]; incoming: SavedChar[] }
  /** Another ACCOUNT's roster (another tab signed in as someone else): this tab's roster is replaced by
   *  it, whole — nothing of the old account's is merged into it. `prior`: the roster value this tab knew
   *  on disk before (the old account's), so the caller can tell whether a write it had queued held
   *  anything that never reached the disk — dropped now, and the player must be told (App). */
  | { kind: 'replace'; incoming: SavedChar[]; prior: string | null }
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
  noteRosterKnown(raw, roster, undefined, loadSyncOwner());
  return roster;
}

/** The account this tab's roster belongs to is no longer the one this browser syncs (another tab signed
 *  in as someone else). Nothing this tab holds may be written until the new account's roster is taken. */
export function rosterOwnerSwitched(): boolean {
  const k = knownRoster();
  const owner = loadSyncOwner();
  if (k.owner === null && owner !== null) noteRosterKnown(k.raw, k.roster, k.sig, owner); // a first sign-in
  return k.owner !== null && owner !== k.owner;
}

/** What another tab wrote to the roster key that this tab has not folded in yet, or null. */
export function takeForeignRoster(): ForeignRoster | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(ROSTER_KEY);
  } catch {
    return null;
  }
  if (rosterOwnerSwitched()) {
    // Emptied by the switch and not filled yet: nothing to take (and nothing of ours may go there).
    if (raw === null) return null;
    const read = readRoster(raw);
    // Not a roster at all: no information, like the empty key (saveRoster copies it aside before a write).
    if (!read.readable) return null;
    const prior = knownRoster().raw;
    noteRosterKnown(raw, read.roster, undefined, loadSyncOwner());
    return { kind: 'replace', incoming: read.roster, prior };
  }
  const k = knownRoster();
  if (raw === null || raw === k.raw) return null;
  // UNKNOWN is not EMPTY (2026-11-17, test/bug-roster-wipe.test.ts): a value that is not a roster tells
  // this tab nothing — merged as a roster it read as "the other tab deleted every character".
  const read = readRoster(raw);
  if (!read.readable) return null;
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
  // An entry the other tab's write holds that this tab cannot read is not a deletion: where the base has
  // that character, the base's copy stands in for it, so the merge reads it as unchanged. The unread
  // entry itself stays on the key (saveRoster carries it).
  const unread = new Set(
    read.kept.map((e) => (e && typeof e === 'object' ? (e as { id?: unknown }).id : undefined)).filter((id): id is string => typeof id === 'string' && !!id),
  );
  const shown = new Set(read.roster.map((c) => c.id));
  const standIns = unread.size ? base.filter((c) => unread.has(c.id) && !shown.has(c.id)) : [];
  const incoming = standIns.length ? [...read.roster, ...standIns] : read.roster;
  noteRosterKnown(raw, incoming, sig);
  return { kind: 'write', base, incoming };
}
