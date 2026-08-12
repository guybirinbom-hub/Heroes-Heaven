import { useEffect, useState } from 'react';
import { checkForUpdate, RELEASES_PAGE, updateDownloadUrl } from '../data/updateCheck';
import { setPref, usePrefs } from '../data/prefs';
import { isMobilePlatform, isTauri } from '../platform';

/** Where this shell should send the user — the platform's installer/APK inside the app, the releases
 *  page in a browser. See updateDownloadUrl for why the phone must not be sent to the page. */
const UPDATE_URL = updateDownloadUrl({ isTauri, isMobile: isMobilePlatform });

/** In the Tauri shell, the WebView silently swallows target="_blank" (no navigation, no new window)
 *  unless a shell/opener plugin handles it — so the anchor alone is dead. Route the click through
 *  tauri-plugin-opener, which hands the URL to the OS: the default browser on desktop, and on Android
 *  the download manager, which is the only thing there that can actually fetch an .apk. The import is
 *  lazy so the web/dev build (where the plugin package/IPC command is absent) never loads it. */
async function openUpdateUrl(e: React.MouseEvent): Promise<void> {
  if (!isTauri) return; // browser/dev: let the plain anchor navigate normally
  e.preventDefault();
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(UPDATE_URL);
  } catch {
    // Plugin missing or IPC denied — fall back to opening in a new tab ourselves so the CTA is
    // never dead (default was prevented above).
    window.open(UPDATE_URL, '_blank', 'noreferrer');
  }
}

/** Dismissible one-line banner shown when a newer GitHub release exists. The check fires after
 *  mount and never blocks boot — offline or any API failure just keeps the banner hidden.
 *  Dismissing remembers the tag in prefs, so the same version never re-nags. */
export function UpdateNotice() {
  const [tag, setTag] = useState<string | null>(null);
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
  return (
    <div className="update-banner" role="status">
      <i className="ti ti-download" aria-hidden="true" />
      <span>
        Heroes Heaven <strong>{tag}</strong> is available.
      </span>
      <a href={UPDATE_URL} target="_blank" rel="noreferrer" onClick={openUpdateUrl}>
        Get the update
      </a>
      {/* The releases page as well, for anyone who wants the notes or a different asset. */}
      {isTauri && (
        <a
          className="update-banner-alt"
          href={RELEASES_PAGE}
          target="_blank"
          rel="noreferrer"
          onClick={async (e) => {
            e.preventDefault();
            try {
              const { openUrl } = await import('@tauri-apps/plugin-opener');
              await openUrl(RELEASES_PAGE);
            } catch {
              window.open(RELEASES_PAGE, '_blank', 'noreferrer');
            }
          }}
        >
          release notes
        </a>
      )}
      <button className="save-warning-x" onClick={() => setPref('dismissedUpdate', tag)} aria-label="Dismiss">
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </div>
  );
}
