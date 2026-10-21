import { createContext, useContext, useState } from 'react';
import { useBackHandler } from './useEscapeClose';
import type { ModeDef } from '../rules/types';

export type PageMenuItem = { label: string; icon: string; onClick: () => void };

/** The app's pages, in the ONE order every menu lists them (owner, 2026-10-21: "the location of the other
 *  options in the menu changes depending on what page you are on — make it that the page you are on is
 *  marked, that way the menu stays the same"). */
export type MenuPage = 'sheet' | 'roster' | 'campaigns' | 'homebrew' | 'settings';

export const MENU_PAGES: { id: MenuPage; label: string; icon: string }[] = [
  { id: 'sheet', label: 'Character sheet', icon: 'ti-user' },
  { id: 'roster', label: 'Characters', icon: 'ti-users' },
  { id: 'campaigns', label: 'Campaigns', icon: 'ti-flag' },
  { id: 'homebrew', label: 'Homebrew', icon: 'ti-flask' },
  { id: 'settings', label: 'Settings', icon: 'ti-settings' },
];

/**
 * Where the app is and how to get to each page. App provides it once around the screen it renders, so
 * every page's menu is built from the same list (a page can no longer forget an entry, or list them in
 * its own order). `current` is the page on screen (null on a screen the menu does not list, e.g. the
 * builder); `go` holds a handler per page that can be opened right now — an unreachable page (no
 * character yet, Campaigns on a signed-out phone) has none and is left out, the same on every page.
 */
export type PageNav = { current: MenuPage | null; go: Partial<Record<MenuPage, () => void>> };
export const PageNavContext = createContext<PageNav | null>(null);

/** The entries a menu shows, in the fixed order. Pure, so a test can compare two pages' menus. */
export function menuPageEntries(nav: PageNav): { id: MenuPage; label: string; icon: string; current: boolean; go?: () => void }[] {
  return MENU_PAGES.filter((p) => p.id === nav.current || nav.go[p.id]).map((p) => ({
    ...p,
    current: p.id === nav.current,
    go: nav.go[p.id],
  }));
}

/**
 * Hamburger menu (top-right) for every page of the app. The page list comes from PageNavContext: the same
 * entries in the same order on every page, the page you are on marked (accent + aria-current="page") and
 * choosing it just closes the menu. `actions` are things to DO rather than pages (the phone sheet's
 * Customize) and sit after the pages. Without a PageNavContext (the tracker app, which has no pages) the
 * menu falls back to the caller's `items` plus a Settings entry, as before.
 */
export function PageMenu({
  items,
  actions,
  onOpenSettings,
}: {
  /** Fallback list used only when there is no PageNavContext. */
  items?: PageMenuItem[];
  actions?: PageMenuItem[];
  onOpenSettings?: () => void;
  // Legacy props — Settings is now a route handled by App, but callers still pass these; accepted + ignored.
  modes?: Record<string, ModeDef>;
  characters?: { id: string; name: string }[];
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const nav = useContext(PageNavContext);
  useBackHandler(open, () => setOpen(false));
  const close = () => setOpen(false);

  const rows: (PageMenuItem & { current?: boolean })[] = nav
    ? [
        ...menuPageEntries(nav).map((e) => ({
          label: e.label,
          icon: e.icon,
          current: e.current,
          // The current page's entry only closes the menu; it never navigates (it would re-open itself).
          onClick: e.current || !e.go ? () => {} : e.go,
        })),
        ...(actions ?? []),
      ]
    : [
        ...(items ?? []),
        ...(onOpenSettings ? [{ label: 'Settings', icon: 'ti-settings', onClick: onOpenSettings }] : []),
        ...(actions ?? []),
      ];

  return (
    <div className="page-menu">
      <button className="icon-btn" title="Menu" aria-label="Menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <i className="ti ti-menu-2" aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={close} />
          <div className="topmenu" role="menu">
            {rows.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                className={'topmenu-item' + (it.current ? ' current' : '')}
                aria-current={it.current ? 'page' : undefined}
                onClick={() => {
                  close();
                  it.onClick();
                }}
              >
                <i className={'ti ' + it.icon} aria-hidden="true" /> {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
