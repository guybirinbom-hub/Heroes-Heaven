import { useEffect, useRef, useState } from 'react';
import { checkForUpdate, RELEASES_PAGE, updateDownloadUrl } from '../data/updateCheck';
import { setPref, usePrefs } from '../data/prefs';
import { isDesktopApp, isMobilePlatform, isTauri, openExternal, openInOs } from '../platform';
import { downloadUpdate, installDownloaded, type DownloadableUpdate, type InstallDeps, type InstallStage } from '../data/selfUpdate';
import { hasUnsavedWork } from '../data/unsavedWork';
import { flushPersist } from '../data/persist';
import { confirmDialog, LEAVE_QUESTION } from './confirm';

/** Where this shell should send the user — the platform's installer/APK inside the app, the releases
 *  page in a browser. See updateDownloadUrl for why the phone must not be sent to the page. */
const UPDATE_URL = updateDownloadUrl({ isTauri, isMobile: isMobilePlatform });

/** How long asking GitHub for latest.json may take before the banner falls back to the browser link. */
const CHECK_TIMEOUT_MS = 30_000;

/** Installing ends the app the way a crash would (the installer starts, the app process exits), so no
 *  close event fires. Run every close-time save by hand: the sheet's write queue, and a `pagehide` for
 *  the listeners that save on close (App's flush, cloud sync, the tracker's combat store and sync). */
function flushBeforeClose() {
  flushPersist();
  window.dispatchEvent(new Event('pagehide'));
}

/** The install failed and the app keeps running. Live sync's socket (Supabase Realtime) disconnects on
 *  `pagehide` and reconnects only on `pageshow`; without this, the other device's edits stop arriving
 *  until the app restarts (checker 2026-11-08). Nothing else in the app listens for `pageshow`. */
function resumeAfterFailedInstall() {
  window.dispatchEvent(new Event('pageshow'));
}

/** The Windows app's install steps (data/selfUpdate.ts), wired to the real plugin and the app's popup.
 *  The plugin import is lazy, so the web and phone bundles never load it. */
function windowsDeps(onStage: (s: InstallStage) => void): InstallDeps {
  return {
    check: async () => {
      const { check } = await import('@tauri-apps/plugin-updater');
      return check({ timeout: CHECK_TIMEOUT_MS });
    },
    hasUnsavedWork,
    askInstallAnyway: () =>
      confirmDialog({
        title: 'Install without saving?',
        message: 'Something you changed isn’t saved yet. Installing closes the app and throws it away.',
        confirmLabel: 'Install anyway',
        cancelLabel: 'Keep editing',
        danger: true,
        ...LEAVE_QUESTION, // "Keep editing" holds the focus; above the tracker's layers
      }),
    flush: flushBeforeClose,
    resume: resumeAfterFailedInstall,
    openInBrowser: () => openInOs(UPDATE_URL),
    onStage,
  };
}

/** Dismissible one-line banner shown when a newer GitHub release exists. The check fires after
 *  mount and never blocks boot — offline or any API failure just keeps the banner hidden.
 *  Dismissing remembers the tag in prefs, so the same version never re-nags.
 *  The Windows app installs the update from the banner; the phone downloads the APK. */
export function UpdateNotice() {
  const [tag, setTag] = useState<string | null>(null);
  const [stage, setStage] = useState<InstallStage>({ kind: 'idle' });
  const downloaded = useRef<DownloadableUpdate | null>(null);
  const busy = useRef(false);
  const prefs = usePrefs();
  useEffect(() => {
    let alive = true;
    checkForUpdate().then((t) => {
      if (alive) setTag(t);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!tag || prefs.dismissedUpdate === tag) return null;

  const install = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (busy.current) return; // a second click while it works does nothing
    busy.current = true;
    try {
      const deps = windowsDeps(setStage);
      const update = downloaded.current;
      if (!update) {
        // First click: download only. The banner then offers "Install now", so the app never closes
        // under a player who started something while the download ran.
        const got = await downloadUpdate(deps);
        if (got !== 'browser') downloaded.current = got;
        return;
      }
      await installDownloaded(update, deps);
    } finally {
      busy.current = false;
    }
  };

  const working = stage.kind === 'checking' || stage.kind === 'downloading' || stage.kind === 'installing';
  let text: React.ReactNode;
  if (stage.kind === 'checking' || stage.kind === 'downloading') {
    const pct = stage.kind === 'downloading' && stage.percent != null ? ` ${stage.percent}%` : '';
    text = (
      <>
        Downloading Heroes Heaven <strong>{tag}</strong>…{pct}
      </>
    );
  } else if (stage.kind === 'installing') {
    text = (
      <>
        Installing Heroes Heaven <strong>{tag}</strong>. The app closes and opens again by itself.
      </>
    );
  } else if (stage.kind === 'downloaded') {
    text = (
      <>
        Heroes Heaven <strong>{tag}</strong> is downloaded and ready to install.
      </>
    );
  } else if (stage.kind === 'browser') {
    text = (
      <>
        The download for Heroes Heaven <strong>{tag}</strong> opened in your browser. Run the installer to update.
      </>
    );
  } else {
    text = (
      <>
        Heroes Heaven <strong>{tag}</strong> is available.
      </>
    );
  }

  return (
    <div className="update-banner" role="status">
      <i className="ti ti-download" aria-hidden="true" />
      <span>{text}</span>
      {isDesktopApp
        ? !working &&
          stage.kind !== 'browser' && (
            <a href={UPDATE_URL} target="_blank" rel="noreferrer" onClick={(e) => void install(e)}>
              {stage.kind === 'downloaded' ? 'Install now' : 'Install the update'}
            </a>
          )
        : (
            <a href={UPDATE_URL} target="_blank" rel="noreferrer" onClick={(e) => void openExternal(e, UPDATE_URL)}>
              Get the update
            </a>
          )}
      {/* The releases page as well, for anyone who wants the notes or a different asset. */}
      {isTauri && !working && (
        <a
          className="update-banner-alt"
          href={RELEASES_PAGE}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => void openExternal(e, RELEASES_PAGE)}
        >
          release notes
        </a>
      )}
      {!working && (
        <button className="save-warning-x" onClick={() => setPref('dismissedUpdate', tag)} aria-label="Dismiss">
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
