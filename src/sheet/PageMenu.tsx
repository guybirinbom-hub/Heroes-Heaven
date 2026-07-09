import { useState } from 'react';
import { useBackHandler } from './useEscapeClose';
import type { ModeDef } from '../rules/types';

export type PageMenuItem = { label: string; icon: string; onClick: () => void };

/**
 * Hamburger menu (top-right) for the standalone pages that aren't the character sheet — the Characters
 * roster, the Homebrew manager, and Campaigns. A dropdown of nav items plus an always-present Settings
 * entry. Settings is now a full page (routed by App via onOpenSettings), not an embedded modal.
 */
export function PageMenu({
  items,
  onOpenSettings,
}: {
  items: PageMenuItem[];
  onOpenSettings?: () => void;
  // Legacy props — Settings is now a route handled by App, but callers still pass these; accepted + ignored.
  modes?: Record<string, ModeDef>;
  characters?: { id: string; name: string }[];
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useBackHandler(open, () => setOpen(false));
  return (
    <div className="page-menu">
      <button className="icon-btn" title="Menu" onClick={() => setOpen((o) => !o)}>
        <i className="ti ti-menu-2" aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="topmenu" role="menu">
            {items.map((it) => (
              <button
                key={it.label}
                className="topmenu-item"
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                <i className={'ti ' + it.icon} aria-hidden="true" /> {it.label}
              </button>
            ))}
            {onOpenSettings && (
              <button
                className="topmenu-item"
                onClick={() => {
                  setOpen(false);
                  onOpenSettings();
                }}
              >
                <i className="ti ti-settings" aria-hidden="true" /> Settings
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
