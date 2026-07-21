import { useState, useEffect, useRef } from 'react'
import { THEMES, useSettingsStore, applyTheme, previewThemeColors } from '../store/settingsStore'
import { useCustomThemesStore, newCustomThemeId, type CustomTheme } from '../store/customThemesStore'
import { COLOR_FIELDS, readThemeSeed, toHex, type ThemeColors } from '../utils/themeColors'
import { XIcon } from './Icons'

// Modal for building / editing a custom theme. Live-previews the whole app as
// you tweak colours; restores the real theme on cancel.
export function ThemeEditor({ editing, fromBase, onClose }: {
  editing?: CustomTheme
  fromBase?: string
  onClose: () => void
}) {
  const upsert = useCustomThemesStore(s => s.upsert)
  const setSetting = useSettingsStore(s => s.setSetting)

  const initialBase = editing?.base ?? fromBase ?? 'tavern'
  const [name, setName] = useState(editing?.name ?? 'My Theme')
  const [base, setBase] = useState<string>(initialBase)
  const [colors, setColors] = useState<ThemeColors>(() => editing?.colors ?? readThemeSeed(initialBase))

  // Preview as the user edits.
  useEffect(() => { previewThemeColors(base, colors) }, [base, colors])

  // On unmount WITHOUT save (cancel / backdrop / X / parent closing), put the
  // real persisted theme back.
  const saved = useRef(false)
  useEffect(() => () => { if (!saved.current) applyTheme(useSettingsStore.getState().theme) }, [])

  const pickBase = (b: string) => { setBase(b); setColors(readThemeSeed(b)) }
  const setColor = (k: keyof ThemeColors, v: string) => setColors(c => ({ ...c, [k]: v }))

  const save = () => {
    const id = editing?.id ?? newCustomThemeId()
    upsert({ id, name: name.trim() || 'My Theme', base, colors })
    saved.current = true
    setSetting('theme', id)   // persists + applies
    onClose()
  }

  const label: React.CSSProperties = { fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }
  const hint: React.CSSProperties = { fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }

  return (
    <div className="modal-overlay" style={{ zIndex: 9000 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 440, padding: 0, overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: 'var(--app-bw) solid var(--border)',
          background: 'linear-gradient(180deg, var(--bg-header-top), var(--bg-header-bottom))',
        }}>
          <h2 className="page-title-display" style={{ fontSize: 17, fontWeight: 500, margin: 0 }}>
            {editing ? 'Edit theme' : 'New custom theme'}
          </h2>
          <button className="ico-btn" style={{ width: 28, height: 28 }} onClick={onClose} title="Cancel"><XIcon size={14} /></button>
        </div>

        <div style={{ padding: '16px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Name */}
          <div>
            <div style={{ ...label, marginBottom: 5 }}>Name</div>
            <input className="input-dark" style={{ width: '100%' }} value={name} onChange={e => setName(e.target.value)} placeholder="My Theme" />
          </div>

          {/* Start-from base */}
          <div>
            <div style={{ ...label, marginBottom: 2 }}>Start from</div>
            <div style={{ ...hint, marginBottom: 6 }}>Picks the non-colour styling (fonts, shadows, icon) and reseeds the colours below.</div>
            <select className="input-dark" style={{ width: '100%' }} value={base} onChange={e => pickBase(e.target.value)}>
              {THEMES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {/* Colours */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {COLOR_FIELDS.map(f => (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input
                  type="color"
                  value={toHex(colors[f.key])}
                  onChange={e => setColor(f.key, e.target.value)}
                  style={{ width: 38, height: 30, padding: 0, border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={label}>{f.label}</div>
                  <div style={hint}>{f.hint}</div>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faded)', flexShrink: 0 }}>{toHex(colors[f.key])}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px', borderTop: 'var(--app-bw) solid var(--border)' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save}>{editing ? 'Save changes' : 'Create theme'}</button>
        </div>
      </div>
    </div>
  )
}
