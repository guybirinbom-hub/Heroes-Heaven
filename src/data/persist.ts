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
/** Reports the latest write's success/failure so the UI can surface a "can't save" banner. */
type OnResult = (ok: boolean) => void;

let writer: Writer = () => true;
let onResult: OnResult = () => {};
let afterPersist: (roster: any) => void = () => {};
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: { roster: Roster } | null = null;
/** How many recent writes the echo guard can still recognise as ours — see `recentPersists`. */
const RECENT_WRITES = 8;
let written: Roster[] = [];

/** Wire up the writer + result callback. Call once at app startup. */
export function setupPersist(w: Writer, r: OnResult): void {
  writer = w;
  onResult = r;
}

/** Register a callback invoked after every local persist, with the roster just written. Cloud sync
 *  uses this to mirror local changes upward (debounced). Pass a no-op to unregister. */
export function setOnPersisted(cb: (roster: any) => void): void {
  afterPersist = cb;
}

function writePending(): void {
  if (!pending) return;
  const { roster } = pending;
  pending = null;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  written.push(roster);
  if (written.length > RECENT_WRITES) written.shift();
  onResult(writer(roster));
  afterPersist(roster);
}

/** The roster OBJECTS recently written to storage, oldest first (empty before the first write).
 *
 *  The cross-tab guard compares an incoming `storage` event against these to recognise an echo of our
 *  own work: another tab that adopts one of our writes re-persists that identical value a debounce
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

/** True when a write is queued but not yet flushed. The cross-tab guard reads it: while one of our
 *  own edits is still inside the debounce, THIS tab holds the newest state and must not adopt. */
export function hasPendingPersist(): boolean {
  return pending !== null;
}
