import { useEffect, useState } from 'react';
import { checkForUpdate, RELEASES_PAGE } from '../data/updateCheck';
import { setPref, usePrefs } from '../data/prefs';

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
      <a href={RELEASES_PAGE} target="_blank" rel="noreferrer">
        Get the update
      </a>
      <button className="save-warning-x" onClick={() => setPref('dismissedUpdate', tag)} aria-label="Dismiss">
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </div>
  );
}
