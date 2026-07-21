/// <reference path="../../tracker/src/types/electron.d.ts" />
/*
 * Mounts the initiative tracker inside Heroes Heaven's party dashboard.
 *
 * This is the whole seam. See ./README.md for how to remove it.
 *
 * The reference above pulls in the tracker's OWN ambient `window.electronAPI` declaration. HH's
 * tsconfig only includes `src/`, so without it the tracker's remaining Electron call sites fail to
 * compile here. Doing it from inside this folder — rather than adding the path to HH's tsconfig —
 * keeps HH's build untouched and means the fix is deleted along with the seam. (Those Electron call
 * sites are inert on web and are being replaced anyway: tracker/DEFERRED.md §8.)
 *
 * THE WRAPPER IS LOAD-BEARING. `.tracker-root` is what confines the tracker's stylesheet —
 * which carries Tailwind's global Preflight reset — to this subtree. Without it the CSS still
 * loads and silently collapses ~32 of HH's headings to body text. Do not drop the class.
 *
 * The tracker's components are imported by RELATIVE path rather than an alias, so HH's vite/tsconfig
 * need no changes at all: `tracker/` already lives inside HH's project root, so Vite resolves and
 * bundles it with no `fs.allow` or path mapping.
 */
import { GameDataProvider } from '../../tracker/src/data/gameDataContext';
import { InitiativeTracker } from '../../tracker/src/components/InitiativeTracker';
import { PartyView } from '../../tracker/src/components/PartyView';
import { usePartyStore } from '../../tracker/src/store/partyStore';
// The pre-built, fully-scoped stylesheet (tracker/dist-css). Regenerate with `npm run build:css`
// in tracker/ after changing any tracker CSS — it is a build artifact and does not hot-reload here.
import '../../tracker/dist-css/tracker.scoped.css';
import './tracker-mount.css';

/**
 * Replaces the party dashboard's member cards with the tracker: the initiative order down the side,
 * and the tracker's own party view as the player dashboard beside it.
 *
 * Presentational only for now — the tracker still reads its OWN party store rather than HH's
 * campaign membership. Bridging that is the next step (tracker/DEFERRED.md §3).
 */
export function TrackerMount() {
  const activePartyId = usePartyStore((s) => s.activePartyId);
  const parties = usePartyStore((s) => s.parties);
  const partyId = activePartyId ?? parties[0]?.id ?? '';

  return (
    <div className="tracker-root tracker-mount">
      <GameDataProvider>
        <aside className="tracker-mount-order">
          <InitiativeTracker />
        </aside>
        <div className="tracker-mount-dash">
          {partyId ? (
            <PartyView partyId={partyId} />
          ) : (
            <p className="tracker-mount-empty">
              No party yet — create one in the tracker to see your players here.
            </p>
          )}
        </div>
      </GameDataProvider>
    </div>
  );
}
