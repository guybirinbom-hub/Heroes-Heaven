import { getCurrentWindow } from '@tauri-apps/api/window';
import { isDesktopApp } from '../platform';

/** Minimize / maximize / close controls for the custom title bar. Rendered only in the DESKTOP app —
 *  the browser build uses the browser's own chrome, and the mobile (Android/iOS) shell has no OS window. */
export function WindowControls() {
  if (!isDesktopApp) return null;
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
