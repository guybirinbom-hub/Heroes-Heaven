import { usePrefs } from '../data/prefs';
import { openExternal } from '../platform';
import './ast.css';

/**
 * THE Archives of Nethys button — one copy for every description popup (Guy, 2026-10-21: "a link to
 * Archives of Nethys on every pop up a user opens … as a toggleable setting").
 *
 * The address is the page's own: scripts/stamp-ast-urls.mjs copies the export document's `url`
 * (`/Equipment.aspx?ID=2829`) onto every shipped page tree's root, so a popup that has the record's
 * tree in hand (AstRenderer's head, ItemDetail's and the spell popup's own heads) hands that over. No
 * address is ever guessed from a record's id: a record with no page — homebrew, a character's carried
 * custom record, the app's own modes, a record whose page did not load — gets no button.
 *
 * Settings → Appearance → Popups switches every one of them off (prefs.showAonLink; on by default).
 */

/** The Archives' own host. */
export const AON = 'https://2e.aonprd.com';

/** A page tree's stamped address ("/Rules.aspx?ID=1503") as a full Archives link; '' for anything else
 *  (no address, or one that is not an Archives page path). */
export function aonUrlOf(path: unknown): string {
  const p = typeof path === 'string' ? path : '';
  return /^\/\w+\.aspx/.test(p) ? AON + p : '';
}

/** Whether the popups draw the button at all (the device setting). */
export function useShowAonLink(): boolean {
  return usePrefs().showAonLink !== false;
}

/** The button: an external-link icon that opens the page on the Archives (the system browser in the
 *  desktop app). Draws nothing without an address or with the setting off. */
export function AonLink({ url, className }: { url?: string; className?: string }) {
  const show = useShowAonLink();
  const href = aonUrlOf(url);
  if (!show || !href) return null;
  return (
    <a className={'ast-aon' + (className ? ' ' + className : '')} href={href} target="_blank" rel="noreferrer"
       title="Open this page on Archives of Nethys" aria-label="Open on Archives of Nethys"
       onClick={(e) => { e.stopPropagation(); void openExternal(e, href); }}>
      <i className="ti ti-external-link" aria-hidden="true" />
    </a>
  );
}
