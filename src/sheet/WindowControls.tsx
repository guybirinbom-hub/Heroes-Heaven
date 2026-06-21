import { getCurrentWindow } from '@tauri-apps/api/window';

/** True only inside the Tauri desktop shell (Tauri 2 injects this global). */
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Minimize / maximize / close controls for the custom title bar. Rendered only in
 *  the desktop app — the browser build uses the browser's own window chrome. */
export function WindowControls() {
  if (!isTauri) return null;
  const win = getCurrentWindow();
  return (
    <div className="chrome-btns">
      <button type="button" className="chrome-btn" aria-label="Minimize" onClick={() => void win.minimize()}>
        <i className="ti ti-minus" aria-hidden="true" />
      </button>
      <button type="button" className="chrome-btn" aria-label="Maximize" onClick={() => void win.toggleMaximize()}>
        <i className="ti ti-square" aria-hidden="true" />
      </button>
      <button type="button" className="chrome-btn close" aria-label="Close" onClick={() => void win.close()}>
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </div>
  );
}
