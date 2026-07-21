import { useEffect, useRef } from 'react';

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
 * One persistent trap entry is kept and re-armed as layers come and go (never torn down via
 * history.back(), which would race the React commit that opens the next layer). The only cost is a
 * single harmless extra Back press after the last layer closes manually.
 *
 * Each mounted entry contributes one slot and reads its handler through a ref, so re-renders never
 * reorder the stack. `useEscapeClose` registers popups; `useBackHandler` registers state-driven
 * sub-views (Notes editor ↔ list, Settings section ↔ cards, a non-home tab ↔ home).
 */
type Entry = { get: () => (() => void) | undefined };
const stack: Entry[] = [];
let keyListening = false;
let popListening = false;
let trapArmed = false;

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
}

// Topmost entry that currently exposes a close handler (entries may pass undefined = no-op).
function topHandler(): (() => void) | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    const fn = stack[i].get();
    if (fn) return fn;
  }
  return undefined;
}

function handleKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  const fn = topHandler();
  if (fn) fn();
}

// Push a single "trap" history entry so the next Back fires popstate instead of exiting the app.
function arm(): void {
  if (!trapArmed && typeof history !== 'undefined') {
    history.pushState({ __dismissTrap: true }, '');
    trapArmed = true;
  }
}

function handlePop(): void {
  // The webview/browser just popped our trap entry (Android Back, or a desktop back gesture).
  trapArmed = false;
  const fn = topHandler();
  if (fn) {
    fn(); // close the topmost layer
    arm(); // re-arm so the next Back is caught too
  }
  // else: nothing open — let Back proceed (the app exits on a subsequent Back).
}

function pushEntry(entry: Entry): () => void {
  stack.push(entry);
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
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
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
  useEffect(() => pushEntry({ get: () => ref.current }), []);
}

/**
 * Register a "go back one step" handler for a mobile drill-in sub-view. Active only while `active`
 * is true; Android Back / Escape then calls `onBack` (e.g. Notes editor → list, Settings section →
 * cards, a non-home tab → home) instead of exiting the app or unwinding a deeper layer.
 */
export function useBackHandler(active: boolean, onBack: () => void): void {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    return pushEntry({ get: () => ref.current });
  }, [active]);
}
