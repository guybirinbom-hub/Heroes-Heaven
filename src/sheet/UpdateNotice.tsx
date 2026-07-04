import { useEffect, useState } from 'react';
import { checkForUpdate, RELEASES_PAGE } from '../data/updateCheck';
import { setPref, usePrefs } from '../data/prefs';
import { isTauri } from '../platform';

/** In the Tauri shell, WebView2 silently swallows target="_blank" (no navigation, no new window)
 *  unless a shell/opener plugin handles it — so the anchor alone is dead on desktop. Route the click
 *  through tauri-plugin-opener, which hands the URL to the OS default browser. The import is lazy so
 *  the web/dev build (where the plugin package/IPC command is absent) never loads it, and any
 *  failure falls through to letting the anchor's default behaviour run. */
async function openReleasesPage(e: React.MouseEvent): Promise<void> {
  if (!isTauri) return; // browser/dev: let the plain anchor navigate normally
  e.preventDefault();
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(RELEASES_PAGE);
  } catch {
    // Plugin missing or IPC denied — fall back to opening in a new tab ourselves so the CTA is
    // never dead (default was prevented above).
    window.open(RELEASES_PAGE, '_blank', 'noreferrer');
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
      <a href={RELEASES_PAGE} target="_blank" rel="noreferrer" onClick={openReleasesPage}>
        Get the update
      </a>
      <button className="save-warning-x" onClick={() => setPref('dismissedUpdate', tag)} aria-label="Dismiss">
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </div>
  );
}
