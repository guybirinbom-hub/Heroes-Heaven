/*
 * "Is anything the player did still unsaved?" — one shared answer, and the browser's leave warning.
 *
 * Guy, 2026-11-08: "existing the web virsion while doing somthing that wont be saved ( like creating a
 * character) should have a warning to the user before they leav". A new character lives only in the
 * builder's draft until Save (App `editing`), so closing the tab or reloading threw it away with no word.
 *
 * Every screen that holds work it has not saved yet (the builder, the GM's edit sheet, the homebrew and
 * item editors, the mode editor, a note still waiting for its save) registers a CHECK here while it is
 * open — a function asked at the moment of leaving, never a stored flag that can go stale. The one
 * `beforeunload` listener (installUnsavedWarning, App) asks every check and, only when one says yes,
 * calls preventDefault() and sets returnValue so the browser shows its own "Leave site?" prompt. That
 * prompt is the one native dialog the app allows: the browser alone may draw it.
 *
 * Separate from the write FLUSH in App (data/persist.ts flushPersist on beforeunload/pagehide/hidden):
 * that saves what is already kept; this only warns about what is not kept at all. Neither touches the other.
 *
 * The browser listener is web only. The Windows app asks through guardWindowClose below (its own popup on
 * Tauri's close request); Android's Back is the builder's own door — test/unsaved-work-warning.test.tsx.
 */
import { useEffect, useRef } from 'react';
import { _clearUnsavedChecks, hasUnsavedWork, registerUnsavedWork } from './unsavedChecks';

export { hasUnsavedWork, registerUnsavedWork };

type Check = () => boolean;

/** The `beforeunload` handler: prevents the unload (the browser then asks) only while work is unsaved. */
export function onBeforeUnloadWarn(e: BeforeUnloadEvent): void {
  if (!hasUnsavedWork()) return;
  e.preventDefault();
  // Older Chrome/Edge and Safari show the prompt only when returnValue is set; the text itself is ignored.
  e.returnValue = '';
}

/** Install the one leave warning on `target` (the window); returns the uninstall. */
export function installUnsavedWarning(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  target.addEventListener('beforeunload', onBeforeUnloadWarn as EventListener);
  return () => target.removeEventListener('beforeunload', onBeforeUnloadWarn as EventListener);
}

/**
 * While the calling component is mounted, `isUnsaved()` is one of the checks. The latest function is
 * always the one asked (read through a ref), so it may close over fresh state without re-registering.
 */
export function useUnsavedWork(isUnsaved: Check): void {
  const ref = useRef(isUnsaved);
  ref.current = isUnsaved;
  useEffect(() => registerUnsavedWork(() => ref.current()), []);
}

/*
 * The Windows app's close (Guy, 2026-11-08: fix the Windows side too). Its X button (WindowControls) and
 * Alt+F4 both raise Tauri's close request; App hands each one to this. Nothing unsaved → the pending
 * writes are flushed and the window closes as before. Unsaved → the close is held, the app's OWN popup
 * asks (never a native dialog), and only "Close anyway" flushes and closes. A second close request while
 * the popup is open is held and asks nothing more. test/unsaved-work-warning.test.tsx.
 */
export interface CloseRequest {
  preventDefault(): void;
}
export interface CloseDeps {
  /** The question; true = close anyway. */
  ask: () => Promise<boolean>;
  /** Run right before the window goes: flush pending writes (data/persist.ts flushPersist). */
  beforeClose: () => void;
  /** Close the window for good (Tauri `destroy`, which skips a new close request). */
  close: () => Promise<void>;
}
let askingClose = false;
export async function guardWindowClose(event: CloseRequest, deps: CloseDeps): Promise<void> {
  if (askingClose) {
    event.preventDefault();
    return;
  }
  if (!hasUnsavedWork()) {
    deps.beforeClose(); // Tauri closes the window right after this handler returns
    return;
  }
  event.preventDefault();
  askingClose = true;
  try {
    if (!(await deps.ask())) return;
  } finally {
    askingClose = false;
  }
  deps.beforeClose();
  await deps.close();
}

/*
 * The Windows app's reload keys (Guy, 2026-11-08: "i want it to ask : F5 in the Windows app reloads with
 * no question"). F5, Shift+F5, Ctrl+F5, Ctrl+R and Ctrl+Shift+R reload the page, which throws away the same
 * unsaved work as a close. The browser's beforeunload prompt is web only, so here the key itself is held
 * and the app's own popup asks. Nothing unsaved → the key is left alone and the page reloads as before.
 * The right-click menu (its Reload item) is already switched off outside text boxes (App).
 */
export function isReloadKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (e.altKey) return false;
  if (e.key === 'F5') return true;
  return (e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R');
}
export interface ReloadDeps {
  /** The question; true = reload anyway. */
  ask: () => Promise<boolean>;
  /** Run right before the reload: flush pending writes. */
  beforeReload: () => void;
  reload: () => void;
}
export async function guardReloadKey(e: KeyboardEvent, deps: ReloadDeps): Promise<void> {
  if (!isReloadKey(e)) return;
  if (askingClose) {
    e.preventDefault();
    return;
  }
  if (!hasUnsavedWork()) return; // the page reloads as before (App's beforeunload flush still runs)
  e.preventDefault();
  askingClose = true;
  try {
    if (!(await deps.ask())) return;
  } finally {
    askingClose = false;
  }
  deps.beforeReload();
  deps.reload();
}

/** Test seam: forget every check (each test starts clean). */
export function _resetUnsavedWorkForTests(): void {
  _clearUnsavedChecks();
  askingClose = false;
}
