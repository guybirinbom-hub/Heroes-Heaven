import { useState } from 'react';
import { useIsMobile } from './useIsMobile';
import { useBackHandler } from './useEscapeClose';
import { SettingsPage } from './SettingsPage';
import type { ModeDef } from '../rules/types';

export type PageMenuItem = { label: string; icon: string; onClick: () => void };

/**
 * Phone-only hamburger menu (top-right) for the standalone pages that aren't the character sheet —
 * the Characters roster and the Homebrew manager. Mirrors the sheet's own menu: a dropdown of nav
 * items plus an always-present Settings entry that opens the full-screen Settings page. Renders
 * nothing on desktop, so the PC chrome is untouched.
 */
export function PageMenu({
  items,
  modes,
  characters,
  onSaveMode,
  onDeleteMode,
}: {
  items: PageMenuItem[];
  modes?: Record<string, ModeDef>;
  characters?: { id: string; name: string }[];
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useBackHandler(isMobile && open, () => setOpen(false));
  if (!isMobile) return null;
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
            <button
              className="topmenu-item"
              onClick={() => {
                setOpen(false);
                setSettingsOpen(true);
              }}
            >
              <i className="ti ti-settings" aria-hidden="true" /> Settings
            </button>
          </div>
        </>
      )}
      {settingsOpen && (
        <SettingsPage
          onClose={() => setSettingsOpen(false)}
          modes={modes}
          characters={characters}
          onSaveMode={onSaveMode}
          onDeleteMode={onDeleteMode}
        />
      )}
    </div>
  );
}
