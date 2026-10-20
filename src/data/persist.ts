/*
 * Debounced roster persistence.
 *
 * Every in-play mutation (an HP tick, a condition toggle, a resource pip, a coalesced stepper frame,
 * an XP keystroke) previously JSON-stringified the ENTIRE roster — including base64 portraits — and
 * wrote it to localStorage synchronously. On Android that stringify+setItem on every event caused
 * visible input lag while tracking combat.
 *
 * This scheduler coalesces those writes: `schedulePersist` remembers the latest roster and writes it
 * after a short idle gap (PERSIST_DEBOUNCE_MS). `flushPersist` forces any pending write out
 * immediately — call it before anything that reads localStorage directly (a Backup export) and on
 * app teardown (beforeunload / visibilitychange→hidden) so nothing is lost when the app closes or is
 * backgrounded. Structural roster changes (create/delete/import a character) should persist
 * immediately via `persistNow` so a crash inside the debounce window can't drop a whole character.
 *
 * The write function is injected (setup()) so this module has no import cycle with storage.ts and is
 * unit-testable with a fake writer + fake timers.
 */

/** Trailing debounce window for play mutations. Long enough to coalesce a burst of taps, short
 *  enough that a quick close (backgrounding) after the last tap still flushes recent state. */
export const PERSIST_DEBOUNCE_MS = 400;

type Roster = unknown;
/** Writes the roster to storage; returns false when storage rejected it (e.g. quota). The parameter
 *  is `any` so a concrete writer (e.g. saveRoster(SavedChar[])) is assignable — this module is
 *  roster-shape-agnostic and only stores/forwards the value opaquely. */
type Writer = (roster: any) => boolean;
/** Why a write did not land, when it is not storage's fault: `'held'` — the reconcile step held it back
 *  (HOLD_WRITE: another tab signed this browser in as a different account). Absent for a storage
 *  rejection (quota, storage unavailable). */
export type NotSavedReason = 'held';
/** Reports the latest write's success/failure so the UI can surface a "can't save" banner — and, for a
 *  write held back rather than rejected, why (the banner must not blame storage for it). */
type OnResult = (ok: boolean, reason?: NotSavedReason) => void;

let writer: Writer = () => true;
let onResult: OnResult = () => {};
/** What the reconcile step returns for a queued roster that must NOT be written at all: another tab
 *  signed this browser in as a different account, and what this tab queued belongs to the old one (S3,
 *  2026-10-20; src/data/rosterTabs.ts rosterOwnerSwitched). The queued write is dropped, unwritten. */
export const HOLD_WRITE: unique symbol = Symbol('hh.holdWrite');
/** Turns the roster about to be written into the roster to write — App folds in another tab's write
 *  here (src/data/rosterTabs.ts), so a write never lands over a change it has not seen. */
let reconcile: (roster: any) => any = (r) => r;
let afterPersist: (roster: any) => void = () => {};
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: { roster: Roster } | null = null;
/** How many recent writes the echo guard can still recognise as ours — see `recentPersists`. */
const RECENT_WRITES = 8;
let written: Roster[] = [];

/** Wire up the writer + result callback (+ the optional reconcile step). Call once at app startup. */
export function setupPersist(w: Writer, r: OnResult, rec: (roster: any) => any = (x) => x): void {
  writer = w;
  onResult = r;
  reconcile = rec;
}

/** Register a callback invoked after every local persist, with the roster just written. Cloud sync
 *  uses this to mirror local changes upward (debounced). Pass a no-op to unregister. */
export function setOnPersisted(cb: (roster: any) => void): void {
  afterPersist = cb;
}

function writePending(): void {
  if (!pending) return;
  const queued = pending.roster;
  pending = null;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  // What is written — and remembered, and handed to cloud sync — is the RECONCILED roster: the edit
  // that was queued, with any other tab's write folded in (App's reconcile; identity when none).
  const roster = reconcile(queued);
  // Nothing of it may be written (another account's key: rosterTabs.ts) — and the player is told it was
  // not saved (App's save-failed banner, in its account-switch wording: storage is not at fault), never
  // left to lose it in silence. The notice stays until the player dismisses it — a later landed write
  // does not take it down (App's showHeld).
  if (roster === HOLD_WRITE) {
    onResult(false, 'held');
    return;
  }
  written.push(roster);
  if (written.length > RECENT_WRITES) written.shift();
  onResult(writer(roster));
  afterPersist(roster);
}

/** The roster OBJECTS recently written to storage, oldest first (empty before the first write).
 *
 *  The cross-tab guard compares another tab's write against these to recognise an echo of our own work
 *  (src/data/rosterTabs.ts, for a write that carries no lineage — an OLDER app version; this one never
 *  echoes): such a tab adopts one of our writes and re-persists that identical value a debounce
 *  later, and by then this tab's React state — and its own last write — can already be newer. Only
 *  the LAST write was remembered at first, and that is not enough: a backgrounded tab's timers are
 *  throttled to a second or more, so its echo routinely arrives after we have written again, and
 *  adopting it rewound an edit the player had already made and saved.
 *
 *  Deliberately the objects, not strings — the caller stringifies once per storage EVENT (rare),
 *  never once per persist (every HP tick, the Android input-lag path this module exists to keep
 *  cheap). Holding a few is cheap too: consecutive rosters share almost all of their structure, so
 *  this retains a handful of arrays, not a handful of copies of the portraits.
 *
 *  Bounded at RECENT_WRITES: an echo older than the last 8 writes (~3 s of continuous editing) is
 *  still adoptable. Raise it if a real lag beats that. */
export function recentPersists(): unknown[] {
  return written;
}

/** Queue a debounced write of `roster`. The latest roster wins; the write fires after an idle gap. */
export function schedulePersist(roster: Roster): void {
  pending = { roster };
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(writePending, PERSIST_DEBOUNCE_MS);
}

/**
 * Fold a change that reaches this tab BETWEEN RENDERS into the next write, at once: the queued roster
 * is rewritten in place (its timer kept), or — nothing queued — `fn(current)` is queued.
 *
 * Another tab's write is folded into React state by an updater that runs at the next render (H1,
 * 2026-10-18; src/data/rosterTabs.ts). Two things can happen before that render: the debounce timer (or
 * a flush on close, or cloud sync's flush) writes the roster queued at the LAST commit — without the
 * other tab's change, over it, under a lineage record claiming it was built on it; or, nothing being
 * queued, the tab closes with the merge only in React's queue while the disk holds the other tab's
 * roster without this tab's change. So the fold goes into the write queue the moment it is handed to
 * React. A write equal to what the key holds is skipped (storage.ts saveRoster).
 */
export function foldIntoPersist(fn: (roster: any) => any, current: Roster): void {
  if (pending) pending = { roster: fn(pending.roster) };
  else schedulePersist(fn(current));
}

/** Persist `roster` immediately (structural changes that must not be lost on a crash). Supersedes
 *  any pending debounced write so a stale in-flight value can't clobber this one afterwards. */
export function persistNow(roster: Roster): void {
  pending = { roster };
  writePending();
}

/** Force any pending debounced write out now (before reading storage directly, or on teardown). */
export function flushPersist(): void {
  if (pending) writePending();
}

/** Drop any pending write without writing it (e.g. we're about to adopt another tab's roster, so
 *  our stale pending value must NOT be flushed over it). */
export function cancelPersist(): void {
  pending = null;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/** True when a write is queued but not yet flushed. (The cross-tab guard used to read it and ignore
 *  another tab's write while one of ours was queued — which then wrote over that tab's change. Another
 *  tab's write is merged now, queued edit or not: src/data/rosterTabs.ts, H1 2026-10-18.) */
export function hasPendingPersist(): boolean {
  return pending !== null;
}
