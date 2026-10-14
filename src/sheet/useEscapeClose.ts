import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Shared dismiss stack for modals/overlays AND mobile "back-worthy" sub-views.
 *
 * One LIFO stack drives two dismiss sources:
 *  - the keyboard Escape key (all platforms), and
 *  - the Android hardware/gesture BACK button (phones), trapped via a single `history.pushState`
 *    entry + `popstate`, so Back closes the TOPMOST layer (a popup, or a drill-in sub-view) instead
 *    of exiting the app. The trap machinery is mobile-only (≤720px) so the desktop layout/behaviour
 *    is unchanged — on desktop only Escape is wired, exactly as before.
 *
 * One persistent trap entry is kept and re-armed while any entry is mounted (never torn down via
 * history.back() as layers come and go, which would race the React commit that opens the next layer).
 * The cost is a single extra Back press after the last layer closes manually — with ONE exception: a
 * whole SCREEN leaving (a `floor` entry going, i.e. the builder closed by Cancel, Discard or Back). Once
 * that has happened and the stack is empty a macrotask later (nothing on the screen underneath), the
 * trap is given back with history.back(). Before 2026-10-14 it never was, so after leaving the builder
 * the roster swallowed one Back for nothing and only the second one exited (phone audit, round 2). The
 * popstate of that release is ours, not a press (`releasing`). test/phone-builder-back-trap.test.tsx.
 *
 * Each mounted entry contributes one slot and reads its handler through a ref, so re-renders never
 * reorder the stack. `useEscapeClose` registers popups; `useBackHandler` registers state-driven
 * sub-views (Notes editor ↔ list, Settings section ↔ cards, a non-home tab ↔ home).
 */
type Entry = { get: () => (() => void) | undefined; cover?: boolean; under?: boolean; floor?: boolean; backOnly?: boolean };
const stack: Entry[] = [];
let keyListening = false;
let popListening = false;
let trapArmed = false;
// A screen's floor entry has gone since the trap was armed: give the trap back once the stack is empty.
let screenLeft = false;
// Our own history.back() (releaseTrapIfIdle) is on its way: the popstate it fires is not a Back press.
let releasing = false;
let releaseSeq = 0;
// history.state as it was when that back() was sent (the trap entry's own state object). The release's
// popstate is the one that has moved OFF it; a popstate that finds it unchanged moved nothing of ours.
let releaseFrom: unknown = null;

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
}

/*
 * LAYERS THE PUSH ORDER CANNOT TELL APART. The stack is LIFO, which is the order on screen as long as
 * whatever opens later is drawn on top. One surface breaks that: the campaign tracker's floating windows
 * (src/integration/CampaignTracker.tsx) float ABOVE the player's sheet it opens over the tracker
 * (`.ct-sheet-full`, a z-30 layer, so nothing drawn inside it can ever rise past a window) — and the GM
 * keeps working in that sheet while a window stays open, opening its popups and its overlays there. Each
 * of those pushes LATER than the windows' handler, so Escape went to a popup drawn under a window while
 * the window still sat on top of it.
 *
 * So an entry can be a COVER (the windows' handler) and entries can be UNDER it (everything registered
 * inside a `<DismissUnder value>` boundary, and handlers that say so): while a cover entry has a handler,
 * the under entries are passed over, whatever order they were pushed in. Every other entry keeps plain
 * LIFO against the cover — a confirm (a detached root, drawn above the windows) still takes the press
 * first. Neither flag set = exactly the stack it always was. test/tracker-windows-over-sheet.test.tsx.
 */
export const DismissUnder = createContext(false);

// Topmost entry that currently exposes a close handler (entries may pass undefined = no-op).
function topEntry(): { entry: Entry; fn: () => void } | undefined {
  const covered = stack.some((e) => e.cover && !!e.get());
  for (let i = stack.length - 1; i >= 0; i--) {
    if (covered && stack[i].under) continue;
    const fn = stack[i].get();
    if (fn) return { entry: stack[i], fn };
  }
  return undefined;
}
function topHandler(): (() => void) | undefined {
  return topEntry()?.fn;
}

/*
 * Escape. A `backOnly` entry (the builder's "leave", see useBackHandler) answers Android Back and NOT
 * the key: when it is the topmost handler, Escape does nothing at all — it neither leaves the screen
 * nor falls through to whatever is registered under it. Escape at phone width (a narrow desktop window,
 * a hardware keyboard) used to reach the builder's floor and leave it or ask "Discard changes?", while a
 * wide window's Escape with nothing open did nothing (phone audit round 3). Popups above it still close.
 * test/phone-builder-leave.test.tsx.
 */
function handleKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  const top = topEntry();
  if (top && !top.entry.backOnly) top.fn();
}

// Push a single "trap" history entry so the next Back fires popstate instead of exiting the app.
function arm(): void {
  // Our own history.back() is on its way (releaseTrapIfIdle): a pushState now would race it (jsdom
  // cancels the pending traversal outright). Its popstate re-arms if anything mounted meanwhile.
  if (releasing) return;
  if (!trapArmed && typeof history !== 'undefined') {
    history.pushState({ __dismissTrap: true }, '');
    trapArmed = true;
  }
}

function handlePop(): void {
  // The webview/browser just popped our trap entry (Android Back, or a desktop back gesture).
  trapArmed = false;
  if (releasing && history.state !== releaseFrom) {
    // The popstate of our own release, not a press. A layer that mounted while it was on its way (its
    // own arm() waited, see arm) is trapped now.
    releasing = false;
    if (stack.length) arm();
    return;
  }
  const fn = topHandler();
  if (fn) {
    fn(); // close the topmost layer
    // Re-arm so the next Back is caught too — once that layer has gone, and only while anything is still
    // mounted. Re-arming at once (as this did) put the trap back in when Back closed the LAST screen: the
    // builder's floor leaves with no change, the builder unmounts with every entry it had, and the roster
    // then swallowed one Back for nothing. React applies the close in the event's own microtask (popstate
    // is a discrete event), so a macrotask later the stack shows what is left. Anything mounting meanwhile
    // arms the trap itself (pushEntry). test/phone-builder-back-trap.test.tsx.
    setTimeout(() => {
      if (stack.length) arm();
    }, 0);
  }
  // else: nothing open — let Back proceed (the app exits on a subsequent Back).
}

/*
 * A screen has left and the last entry has gone: give the trap's history entry back, so the next Back
 * is not swallowed by a screen with nothing on the stack (leaving the builder by Cancel / Discard used
 * to cost the roster one dead Back). Deferred a macrotask past the commit that unmounted it, and checked
 * again then: a screen that replaces another (the sheet after the builder) mounts its own entries in that
 * same commit, and then the trap stays. Only our own entry is popped (`__dismissTrap`), only once
 * (`releasing`).
 */
function releaseTrapIfIdle(): void {
  setTimeout(() => {
    if (stack.length || !trapArmed || releasing || typeof history === 'undefined') return;
    screenLeft = false;
    if (!(history.state as { __dismissTrap?: boolean } | null)?.__dismissTrap) return;
    releasing = true;
    trapArmed = false;
    releaseFrom = history.state;
    const seq = ++releaseSeq;
    history.back();
    // A same-document traversal fires its popstate within milliseconds. Should it never come, stop
    // waiting for it, so arm() works again.
    setTimeout(() => {
      if (!releasing || seq !== releaseSeq) return;
      releasing = false;
      if (stack.length) arm();
    }, 1500);
  }, 0);
}

// Make sure Escape is listened for and, on a phone, that Back is trapped.
function listenAndArm(): void {
  if (!keyListening) {
    window.addEventListener('keydown', handleKey);
    keyListening = true;
  }
  if (isMobileViewport()) {
    if (!popListening) {
      window.addEventListener('popstate', handlePop);
      popListening = true;
    }
    arm();
  }
}

function pushEntry(entry: Entry): () => void {
  stack.push(entry);
  if (entry.floor) screenLeft = false;
  listenAndArm();
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    if (entry.floor) screenLeft = true;
    if (!stack.length && trapArmed && screenLeft) releaseTrapIfIdle();
  };
}

/**
 * Fire the topmost dismiss handler — the same thing Escape / Android-Back does. Returns true if a
 * handler ran. Lets a VISIBLE "back" button share the one dismiss stack instead of hard-wiring a
 * single destination: a back arrow that peels one layer (close the open sheet) before the next press
 * takes the layer beneath it (leave the campaign), matching Escape exactly.
 */
export function triggerBack(): boolean {
  const fn = topHandler();
  if (fn) {
    fn();
    return true;
  }
  return false;
}

/** Escape / Android-Back to close a modal. Pass the modal's close handler (or undefined for none). */
export function useEscapeClose(onClose: (() => void) | undefined): void {
  const ref = useRef(onClose);
  ref.current = onClose; // keep the latest handler without reordering the stack on re-render
  const under = useContext(DismissUnder);
  useEffect(() => pushEntry({ get: () => ref.current, under }), []);
  // Most pickers register at MOUNT, closed (`open ? close : undefined`), and only their handler changes
  // when they open. The mount armed the trap, but a Back that found nothing open since then spent it —
  // so a picker opening later makes sure Back is trapped again, or that Back would leave the app with
  // the picker on screen. test/phone-builder-back-trap.test.tsx.
  const active = !!onClose;
  useEffect(() => {
    if (active) listenAndArm();
  }, [active]);
}

/**
 * Register a "go back one step" handler for a mobile drill-in sub-view. Active only while `active`
 * is true; Android Back / Escape then calls `onBack` (e.g. Notes editor → list, Settings section →
 * cards, a non-home tab → home) instead of exiting the app or unwinding a deeper layer.
 *
 * `layer` (optional, see DismissUnder above): `cover` = a layer drawn above every `under` one, so it
 * takes the press before them whenever they were pushed; `under` = this handler is one of those (as is
 * every entry inside a `<DismissUnder value>` boundary). Omitted: plain LIFO, as before.
 *
 * `floor` = the handler of a whole SCREEN (the builder's "leave"), which must sit UNDER every layer its
 * own children register. A plain registration cannot: React runs a parent's effects AFTER its children's,
 * so a screen that registers in its effect lands ABOVE every popup that mounted in the same commit (all
 * of a page's pickers register at mount, open or not) and its Back would leave the screen while one of
 * those popups is open. A floor entry registers in the LAYOUT phase instead, which React runs for the
 * whole commit before any passive effect, so it goes onto the stack before its children's entries and
 * stays below them. It is registered once, at mount: `active` only decides whether it answers, so a
 * change of `active` (a phone turned sideways) never lifts it above popups already on the stack.
 * It is still a plain stack entry, so layers registered BEFORE the screen opened stay below it.
 * test/phone-builder-leave.test.tsx.
 *
 * `backOnly` = Android Back (popstate) and `triggerBack` reach this handler, the Escape KEY does not:
 * while it is the topmost handler Escape does nothing (see handleKey). For a door that Back should open
 * but a key press should not (leaving the builder: Escape with nothing open does nothing, at any width).
 */
export function useBackHandler(
  active: boolean,
  onBack: () => void,
  layer?: { cover?: boolean; under?: boolean; floor?: boolean; backOnly?: boolean },
): void {
  const ref = useRef(onBack);
  ref.current = onBack;
  const activeRef = useRef(active);
  activeRef.current = active;
  const under = useContext(DismissUnder) || !!layer?.under;
  const cover = !!layer?.cover;
  const floor = !!layer?.floor;
  const backOnly = !!layer?.backOnly;
  useLayoutEffect(() => {
    if (!floor) return;
    return pushEntry({ get: () => (activeRef.current ? ref.current : undefined), cover, under, floor: true, backOnly });
  }, [floor, cover, under, backOnly]);
  useEffect(() => {
    if (floor) {
      // Became active on a phone after mounting (a resize): the trap may not be in yet.
      if (active) listenAndArm();
      return;
    }
    if (!active) return;
    return pushEntry({ get: () => ref.current, cover, under, backOnly });
  }, [active, cover, under, floor, backOnly]);
}
