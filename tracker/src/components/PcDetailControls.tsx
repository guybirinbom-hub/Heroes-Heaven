import {
  PC_DETAIL_SECTIONS, PC_DETAIL_PRESETS, matchPreset,
  type PcDetailConfig,
} from '../utils/pcDetail'

// ── PC detail-level editor ─────────────────────────────────────────────────
// Preset shortcuts + per-section toggles. Shared by the global Settings
// section and the per-party "Stats shown" popover.

interface Props {
  config: PcDetailConfig
  onChange: (config: PcDetailConfig) => void
  /** Compact variant for the party popover (smaller labels, no descriptions). */
  compact?: boolean
}

export function PcDetailControls({ config, onChange, compact }: Props) {
  const active = matchPreset(config)
  return (
    <div>
      {/* Presets */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: compact ? 10 : 16 }}>
        {PC_DETAIL_PRESETS.map(p => {
          const on = active === p.id
          return (
            <button key={p.id}
              onClick={() => onChange({ ...p.config })}
              style={{
                fontSize: 11.5, fontWeight: 600, padding: '5px 12px', borderRadius: 'var(--radius-full)',
                cursor: 'pointer',
                background: on ? 'var(--accent-soft)' : 'transparent',
                border: `var(--app-bw) solid ${on ? 'var(--accent-line)' : 'var(--border-strong)'}`,
                color: on ? 'var(--accent)' : 'var(--text-muted)',
                fontFamily: 'var(--font-ui)',
              }}
            >{p.label}</button>
          )
        })}
      </div>

      {/* Per-section toggles */}
      <div style={compact ? undefined : {
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '2px 22px',
      }}>
        {PC_DETAIL_SECTIONS.map(({ key, label, desc }) => {
          const on = !!config[key]
          return (
            <div key={key}
              onClick={() => onChange({ ...config, [key]: !on })}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: compact ? '6px 2px' : '8px 2px',
                borderBottom: 'var(--app-bw) solid var(--border)', cursor: 'pointer',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
                {!compact && <div style={{ fontSize: 11, color: 'var(--text-faded)' }}>{desc}</div>}
              </div>
              {/* Switch */}
              <div role="switch" aria-checked={on} style={{
                flexShrink: 0, width: 34, height: 19, borderRadius: 10, position: 'relative',
                background: on ? 'var(--accent)' : 'var(--bg-elevated)',
                border: `var(--app-bw) solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
                transition: 'background 0.15s, border-color 0.15s',
              }}>
                <span style={{
                  position: 'absolute', top: 1, left: on ? 16 : 1,
                  width: 15, height: 15, borderRadius: '50%',
                  background: on ? 'var(--text-on-accent)' : 'var(--text-muted)',
                  transition: 'left 0.15s',
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
