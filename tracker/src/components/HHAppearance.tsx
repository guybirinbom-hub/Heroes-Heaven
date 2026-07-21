import { useState } from 'react'
// RELATIVE, not the `@hh` alias. Heroes Heaven now imports this file's module (its SettingsModal
// neighbours are hosted in HH's Settings), and the `@hh` alias only exists in the TRACKER's
// vite/tsconfig — HH's build would fail to resolve it, and adding the alias there would mean
// editing HH's build, which is what keeps this integration removable. A relative path resolves in
// both projects with no configuration at all.
import { themeList } from '../../../src/theme/themes'
import { styleList } from '../../../src/theme/styles'
import { fontList } from '../../../src/theme/fonts'
import { getAppearance, setTheme, setStyle, setFont, setAccent } from '../../../src/theme/theme-manager'
import { getZoom, setZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from '../../../src/theme/zoom'

/*
 * Appearance — Heroes Heaven's four axes, driving HH's own theme engine.
 *
 * This REPLACES the tracker's original Appearance section (its 17 bespoke themes + ThemeEditor +
 * customThemesStore). There is now exactly one appearance system, and it is the builder's: whatever
 * you pick here is written to the same `pf2e-codex.appearance` state the character builder reads,
 * so the two apps can never drift apart or disagree about what "Ember" means.
 *
 * The tracker's whole variable vocabulary is re-expressed in terms of these tokens by
 * hh-compat.css, which is why changing a palette here restyles every ported component.
 *
 * NOTE: HH's own AppearanceSection is not importable — it's welded to prefs/customization/
 * useIsMobile. This mirrors its axes and look without dragging those in.
 */

const label: React.CSSProperties = {
  fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--text-faded)', margin: '0 0 8px',
}
const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }

/** A palette swatch — shows the theme's actual surface/accent so the choice is visible, not verbal. */
function ThemeSwatch({ name, tokens, active, onPick }: {
  name: string; tokens: Record<string, string>; active: boolean; onPick: () => void
}) {
  return (
    <button
      onClick={onPick}
      title={name}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', cursor: 'pointer',
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--accent-soft)' : 'var(--bg-elevated)',
        border: `var(--app-bw) solid ${active ? 'var(--accent-line)' : 'var(--border)'}`,
        color: 'var(--text)', fontFamily: 'var(--font-ui)', fontSize: 12.5,
      }}
    >
      {/* Live preview chip painted from the theme's OWN tokens, not the active ones. */}
      <span style={{
        width: 26, height: 16, borderRadius: 3, flex: 'none',
        background: tokens['--app-surface'],
        border: `1px solid ${tokens['--app-border']}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: tokens['--app-accent'] }} />
      </span>
      {name}
    </button>
  )
}

function Seg({ items, active, onPick }: {
  items: { id: string; name: string }[]; active: string; onPick: (id: string) => void
}) {
  return (
    <div style={row}>
      {items.map(i => (
        <button
          key={i.id}
          onClick={() => onPick(i.id)}
          style={{
            padding: '6px 11px', cursor: 'pointer', fontSize: 12.5,
            fontFamily: 'var(--font-ui)',
            borderRadius: 'var(--radius-sm)',
            background: active === i.id ? 'var(--accent-soft)' : 'var(--bg-elevated)',
            border: `var(--app-bw) solid ${active === i.id ? 'var(--accent-line)' : 'var(--border)'}`,
            color: active === i.id ? 'var(--accent)' : 'var(--text)',
          }}
        >
          {i.name}
        </button>
      ))}
    </div>
  )
}

/** Accent overrides the palette's own accent; null = follow the palette. */
const ACCENTS = ['#6366f1', '#8b5cf6', '#0ea5e9', '#14b8a6', '#22c55e', '#c9a227', '#e2562d', '#e11d48']

export function HHAppearance() {
  // The theme engine writes straight to <html> and doesn't notify React, so re-render manually.
  const [, force] = useState(0)
  const tick = () => force(n => n + 1)
  const app = getAppearance()
  const zoom = getZoom()

  return (
    <div>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 18px', lineHeight: 1.5 }}>
        Shared with the Heroes Heaven character builder — changing it here changes it there too.
      </p>

      <div style={label}>Palette</div>
      <div style={row}>
        {themeList.map(t => (
          <ThemeSwatch
            key={t.id}
            name={t.name}
            tokens={t.tokens}
            active={app.themeId === t.id}
            onPick={() => { setTheme(t.id); tick() }}
          />
        ))}
      </div>

      <div style={label}>Style</div>
      <Seg items={styleList} active={app.styleId} onPick={id => { setStyle(id); tick() }} />

      <div style={label}>Font</div>
      <Seg items={fontList} active={app.fontId} onPick={id => { setFont(id); tick() }} />

      <div style={label}>Accent</div>
      <div style={row}>
        <button
          onClick={() => { setAccent(null); tick() }}
          style={{
            padding: '6px 11px', cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--font-ui)',
            borderRadius: 'var(--radius-sm)',
            background: app.accent == null ? 'var(--accent-soft)' : 'var(--bg-elevated)',
            border: `var(--app-bw) solid ${app.accent == null ? 'var(--accent-line)' : 'var(--border)'}`,
            color: 'var(--text)',
          }}
        >
          Match palette
        </button>
        {ACCENTS.map(c => (
          <button
            key={c}
            onClick={() => { setAccent(c); tick() }}
            title={c}
            style={{
              width: 30, height: 30, cursor: 'pointer', borderRadius: 'var(--radius-sm)',
              background: c,
              border: `2px solid ${app.accent === c ? 'var(--text)' : 'transparent'}`,
            }}
          />
        ))}
      </div>

      <div style={label}>Zoom</div>
      <div style={{ ...row, alignItems: 'center', gap: 12 }}>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={ZOOM_STEP}
          value={zoom}
          onChange={e => { setZoom(parseFloat(e.target.value)); tick() }}
          style={{ flex: 1, maxWidth: 260, accentColor: 'var(--accent)' }}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', minWidth: 44 }}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => { setZoom(1); tick() }}
          style={{
            padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-ui)',
            borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)',
            border: 'var(--app-bw) solid var(--border)', color: 'var(--text-muted)',
          }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}
