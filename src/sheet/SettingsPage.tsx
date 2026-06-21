import { useEffect, useState } from 'react';
import { themeList } from '../theme/themes';
import { styleList } from '../theme/styles';
import { getAppearance, setAccent, setStyle, setTheme } from '../theme/theme-manager';
import { bumpZoom, getZoom, resetZoom, subscribeZoom, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../theme/zoom';

const ACCENTS = ['#6366f1', '#14b8a6', '#10b981', '#f59e0b', '#f43f5e', '#a855f7', '#0ea5e9', '#c9a227'];

type SectionId = 'appearance' | 'about';
const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'ti-palette' },
  { id: 'about', label: 'About', icon: 'ti-info-circle' },
];

/** Appearance controls — palette, style, accent — driving the theme system live. */
function AppearanceSection() {
  const [appearance, setLocal] = useState(getAppearance());
  const sync = () => setLocal(getAppearance());
  const [zoom, setZoomLocal] = useState(getZoom());
  useEffect(() => subscribeZoom(setZoomLocal), []);

  return (
    <div className="settings-section">
      <h3 className="settings-h">Appearance</h3>
      <p className="settings-desc">
        Pick a colour palette, interface style, and accent. Changes apply instantly and are saved on this device.
      </p>

      <div className="menu-label">Palette</div>
      <div className="menu-row">
        {themeList.map((t) => (
          <button
            key={t.id}
            className={'chip' + (appearance.themeId === t.id ? ' active' : '')}
            onClick={() => {
              setTheme(t.id);
              sync();
            }}
          >
            <span className="chip-swatch" style={{ background: t.tokens['--app-accent'] }} />
            {t.name}
          </button>
        ))}
      </div>

      <div className="menu-label">Style</div>
      <div className="menu-row">
        {styleList.map((s) => (
          <button
            key={s.id}
            className={'chip' + (appearance.styleId === s.id ? ' active' : '')}
            onClick={() => {
              setStyle(s.id);
              sync();
            }}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="menu-label">Accent</div>
      <div className="menu-row">
        <button
          className={'chip' + (appearance.accent === null ? ' active' : '')}
          onClick={() => {
            setAccent(null);
            sync();
          }}
        >
          Theme default
        </button>
        {ACCENTS.map((c) => (
          <button
            key={c}
            className={'accent-swatch' + (appearance.accent === c ? ' active' : '')}
            style={{ background: c }}
            aria-label={'accent ' + c}
            onClick={() => {
              setAccent(c);
              sync();
            }}
          />
        ))}
      </div>

      <div className="menu-label">Zoom</div>
      <div className="menu-row zoom-row">
        <button className="chip" aria-label="Zoom out" onClick={() => bumpZoom(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}>
          <i className="ti ti-minus" aria-hidden="true" />
        </button>
        <span className="zoom-val">{Math.round(zoom * 100)}%</span>
        <button className="chip" aria-label="Zoom in" onClick={() => bumpZoom(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}>
          <i className="ti ti-plus" aria-hidden="true" />
        </button>
        <button className="chip" onClick={() => resetZoom()} disabled={zoom === 1}>
          Reset
        </button>
      </div>
      <p className="settings-desc">Also: hold Ctrl and scroll the wheel, or press Ctrl with + / − / 0.</p>
    </div>
  );
}

function AboutSection() {
  return (
    <div className="settings-section">
      <h3 className="settings-h">Wanderer&rsquo;s Codex</h3>
      <p className="settings-desc">
        A local Pathfinder Second Edition character builder and play sheet. Your characters live on this device — nothing
        is uploaded anywhere.
      </p>
      <div className="menu-label">Game data</div>
      <p className="settings-desc">
        Rules content is imported from the community Foundry VTT Pathfinder 2e project, covering the published player
        options across the game&rsquo;s sourcebooks. Pathfinder and its rules are &copy; Paizo Inc.; this is an
        unofficial fan-made tool and is not affiliated with or endorsed by Paizo.
      </p>
    </div>
  );
}

/** Multi-section Settings page. Appearance is the first section; more can be added to SECTIONS. */
export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<SectionId>('appearance');

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker settings-modal" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          Settings
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={'settings-navitem' + (section === s.id ? ' active' : '')}
                onClick={() => setSection(s.id)}
              >
                <i className={'ti ' + s.icon} aria-hidden="true" /> {s.label}
              </button>
            ))}
          </nav>
          <div className="settings-pane">
            {section === 'appearance' && <AppearanceSection />}
            {section === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
