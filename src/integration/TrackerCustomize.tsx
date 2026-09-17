import { useState } from 'react';
import { getTheme, themeList } from '../theme/themes';
import { PaletteTile } from '../theme/PaletteTile';
import { styleList } from '../theme/styles';
import { fontList } from '../theme/fonts';
import { getAppearance } from '../theme/theme-manager';
import { trackerAppearance, useTrackerAppearance } from './trackerAppearance';

/*
 * "Customize" for the campaign tracker — the GM's own look for the tracker view.
 *
 * Deliberately theme/style ONLY (palette · style · font · accent), not the character sheet's layout
 * customization (rail order, hidden tabs, density). Drives trackerAppearance, which is local and
 * never synced — see that module for why this isn't the global appearance.
 *
 * Part of the removable seam; see ./README.md.
 */

const ACCENTS = ['#6366f1', '#8b5cf6', '#0ea5e9', '#14b8a6', '#22c55e', '#c9a227', '#e2562d', '#e11d48'];

const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--app-text-dim)', margin: '0 0 8px',
};
const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 };

export function TrackerCustomize({ onClose }: { onClose: () => void }) {
  const override = useTrackerAppearance();
  // The effective look shown as selected: the tracker override, else the global appearance it inherits.
  const eff = override ?? getAppearance();
  const isCustom = override != null;
  // A hex none of the eight presets offers — the colour input wears the ring instead of a swatch.
  const accentIsCustom = eff.accent != null && !ACCENTS.includes(eff.accent);
  // Local re-render nudge isn't needed — useTrackerAppearance already re-renders on every change.
  const [, force] = useState(0);
  const tick = () => force((n) => n + 1);

  return (
    <div className="tc-overlay" onClick={onClose}>
      <div className="tc-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Customize tracker appearance">
        <div className="tc-head">
          <span className="tc-title">
            <i className="ti ti-palette" aria-hidden="true" /> Customize tracker
          </span>
          <button className="tc-close" onClick={onClose} title="Close" aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <p className="tc-note">
          The theme for <strong>this campaign tracker</strong>, on this device only. It doesn’t change
          your character sheets or anything your players see.
        </p>

        <div className="tc-body">
          <div style={label}>Palette</div>
          <div style={row}>
            {themeList.map((t) => (
              <PaletteTile
                key={t.id}
                theme={t}
                selectedId={eff.themeId}
                onPick={() => { trackerAppearance.setTheme(t.id); tick(); }}
              />
            ))}
          </div>

          <div style={label}>Style</div>
          <div style={row}>
            {styleList.map((s) => (
              <button
                key={s.id}
                className="tc-seg"
                data-active={eff.styleId === s.id || undefined}
                onClick={() => { trackerAppearance.setStyle(s.id); tick(); }}
              >
                {s.name}
              </button>
            ))}
          </div>

          <div style={label}>Font</div>
          <div style={row}>
            {fontList.map((f) => (
              <button
                key={f.id}
                className="tc-seg"
                data-active={eff.fontId === f.id || undefined}
                onClick={() => { trackerAppearance.setFont(f.id); tick(); }}
              >
                {f.name}
              </button>
            ))}
          </div>

          <div style={label}>Accent</div>
          <div style={row}>
            <button
              className="tc-seg"
              data-active={eff.accent == null || undefined}
              onClick={() => { trackerAppearance.setAccent(null); tick(); }}
            >
              Match palette
            </button>
            {ACCENTS.map((c) => (
              <button
                key={c}
                className="tc-accent"
                title={c}
                style={{ background: c, outline: eff.accent === c ? '2px solid var(--app-text)' : 'none' }}
                onClick={() => { trackerAppearance.setAccent(c); tick(); }}
              />
            ))}
            {/* Any colour, not just the eight. Writes the same `accent` field, so a custom hex is stored,
                resolved and painted exactly like a preset — the swatches just stop matching it. */}
            <input
              type="color"
              className="tc-accent"
              title="Any accent colour"
              aria-label="Custom accent colour"
              value={eff.accent ?? getTheme(eff.themeId)?.tokens['--app-accent'] ?? ACCENTS[0]}
              style={{ padding: 0, background: 'none', outline: accentIsCustom ? '2px solid var(--app-text)' : 'none' }}
              onChange={(e) => { trackerAppearance.setAccent(e.target.value); tick(); }}
            />
          </div>
        </div>

        <div className="tc-foot">
          <button
            className="tc-reset"
            disabled={!isCustom}
            onClick={() => { trackerAppearance.reset(); tick(); }}
          >
            <i className="ti ti-rotate" aria-hidden="true" /> Match the app’s theme
          </button>
        </div>
      </div>
    </div>
  );
}
