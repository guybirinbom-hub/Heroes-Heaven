import { useState, useEffect, useRef } from 'react'
import { useCombatStore } from '../store/combatStore'
import { downloadEncounters, importEncountersFromFilePicker } from '../utils/encounterTransfer'

interface Props { onClose: () => void }

type Pending =
  | { action: 'load'; name: string }
  | { action: 'delete'; name: string }
  | { action: 'overwrite'; name: string }
  | { action: 'reset' }
  | null

export function EncounterManager({ onClose }: Props) {
  const { combatants, saveEncounter, loadEncounter, getSavedEncounterNames, deleteSavedEncounter, resetCombat, isEncounterUnchanged } = useCombatStore()
  const [saveName, setSaveName] = useState('')
  const [msg, setMsg] = useState('')
  const [pending, setPending] = useState<Pending>(null)
  // Export selection mode: when true, every encounter row shows a checkbox.
  const [exportMode, setExportMode] = useState(false)
  const [exportSelected, setExportSelected] = useState<Set<string>>(new Set())
  // Re-render trigger after an import (localStorage is updated outside of React state).
  const [refreshTick, setRefreshTick] = useState(0)
  void refreshTick
  const names = getSavedEncounterNames()

  // Auto-dismiss the toast message after a few seconds.
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!msg) return
    if (msgTimer.current) clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMsg(''), 2500)
    return () => { if (msgTimer.current) clearTimeout(msgTimer.current) }
  }, [msg])

  const doSave = (name: string) => {
    saveEncounter(name)
    setMsg(`Saved "${name}"`)
    setSaveName('')
  }

  const doLoad = (name: string) => {
    loadEncounter(name, new Map())
    setMsg(`Loaded "${name}"`)
    onClose()
  }

  const handleSave = () => {
    const name = saveName.trim()
    if (!name) return
    // If a saved encounter with this name already exists, ask for overwrite confirmation.
    if (names.includes(name)) {
      setPending({ action: 'overwrite', name })
      return
    }
    doSave(name)
  }

  const handleLoad = (name: string) => {
    // Skip the confirmation if the initiative tracker is empty — there's
    // nothing to lose by replacing it.
    if (combatants.length === 0) {
      doLoad(name)
      return
    }
    setPending({ action: 'load', name })
  }
  const handleDelete = (name: string) => setPending({ action: 'delete', name })
  const handleReset = () => {
    // Nothing to lose if the board is empty, or if it still matches the last
    // saved/loaded encounter — clear straight away. Only prompt when the user
    // has actually changed something since.
    if (combatants.length === 0 || isEncounterUnchanged()) {
      resetCombat()
      onClose()
      return
    }
    setPending({ action: 'reset' })
  }

  const handleConfirm = () => {
    if (!pending) return
    if (pending.action === 'load') {
      doLoad(pending.name)
      setPending(null)
    } else if (pending.action === 'delete') {
      deleteSavedEncounter(pending.name)
      setMsg(`Deleted "${pending.name}"`)
      setPending(null)
    } else if (pending.action === 'overwrite') {
      doSave(pending.name)
      setPending(null)
    } else if (pending.action === 'reset') {
      resetCombat()
      setPending(null)
      onClose()
    }
  }

  const confirmMsg =
    pending?.action === 'load'      ? `Load "${pending.name}"? This will replace current combatants.`
    : pending?.action === 'delete'   ? `Delete "${pending.name}"?`
    : pending?.action === 'overwrite' ? `An encounter named "${pending.name}" already exists. Overwrite it?`
    : pending?.action === 'reset'    ? 'Clear all combatants and reset combat?'
    : ''

  const dangerBtn: React.CSSProperties = {
    background: 'transparent',
    borderColor: 'var(--danger)',
    color: 'var(--danger)',
  }

  // ── Export ──────────────────────────────────────────────────────────────
  const beginExport = () => {
    setExportMode(true)
    setExportSelected(new Set(names))   // default to selecting all
  }
  const cancelExport = () => {
    setExportMode(false)
    setExportSelected(new Set())
  }
  const toggleExportSel = (name: string) => {
    setExportSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }
  const doExport = () => {
    const chosen = names.filter(n => exportSelected.has(n))
    if (chosen.length === 0) return
    downloadEncounters(chosen)
    setMsg(`Exported ${chosen.length} encounter${chosen.length === 1 ? '' : 's'}`)
    cancelExport()
  }

  // ── Import ──────────────────────────────────────────────────────────────
  const doImport = async () => {
    const result = await importEncountersFromFilePicker()
    if (!result.ok) {
      if (result.error) setMsg(`Import failed: ${result.error}`)
      return
    }
    setRefreshTick(t => t + 1)
    const missing = result.missing.length
    const plural = result.added.length === 1 ? '' : 's'
    setMsg(missing > 0
      ? `Imported ${result.added.length} encounter${plural} — ${missing} creature${missing === 1 ? '' : 's'} not found (shown as name-only).`
      : `Imported ${result.added.length} encounter${plural}.`)
  }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px',
          borderBottom: 'var(--app-bw) solid var(--border)',
        }}>
          <h2 className="page-title-display" style={{
            fontSize: 20, fontWeight: 500, margin: 0,
            letterSpacing: '-0.015em',
            fontVariationSettings: '"opsz" 72',
          }}>Encounter Manager</h2>
          <button className="ico-btn" style={{ width: 30, height: 30, fontSize: 16 }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '18px 22px' }}>
          {/* Toast — clickable to dismiss, auto-dismisses after 2.5s */}
          {msg && (
            <div
              onClick={() => setMsg('')}
              title="Click to dismiss"
              style={{
                background: 'color-mix(in srgb, var(--hp-full) 14%, transparent)',
                border: 'var(--app-bw) solid color-mix(in srgb, var(--hp-full) 32%, transparent)',
                color: 'var(--hp-full)',
                fontSize: 12,
                padding: '7px 12px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                marginBottom: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                transition: 'opacity 0.2s',
              }}
            >
              <span>{msg}</span>
              <span style={{ opacity: 0.5, fontSize: 10 }}>✕</span>
            </div>
          )}

          {/* Inline confirm bar */}
          {pending && (
            <div style={{
              padding: '10px 12px',
              background: 'var(--bg-elevated)',
              border: 'var(--app-bw) solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              marginBottom: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
            }}>
              <span style={{ color: 'var(--text)', fontSize: 12.5 }}>{confirmMsg}</span>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button className="btn btn-sm" style={dangerBtn} onClick={handleConfirm}>Confirm</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setPending(null)}>Cancel</button>
              </div>
            </div>
          )}

          {/* Save current */}
          <div style={{ marginBottom: 22 }}>
            <div className="pf-label" style={{ marginBottom: 8 }}>Save Current Encounter</div>
            <div className="flex gap-2">
              <input className="input-dark flex-1" placeholder="Encounter name..."
                value={saveName} onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!saveName.trim()}>Save</button>
            </div>
          </div>

          {/* Saved encounters + Import / Export toolbar */}
          <div style={{ marginBottom: 22 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8, gap: 8,
            }}>
              <span className="pf-label" style={{ marginBottom: 0 }}>Saved Encounters</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {!exportMode ? (
                  <>
                    <button className="btn btn-sm" onClick={doImport}
                      title="Import encounters from a JSON file">
                      ⤓ Import
                    </button>
                    <button className="btn btn-sm" onClick={beginExport}
                      disabled={names.length === 0}
                      title="Choose encounters to export to a JSON file">
                      ⤒ Export
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-sm"
                      onClick={() => setExportSelected(new Set(names))}
                      disabled={exportSelected.size === names.length}>
                      All
                    </button>
                    <button className="btn btn-sm"
                      onClick={() => setExportSelected(new Set())}
                      disabled={exportSelected.size === 0}>
                      None
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={doExport}
                      disabled={exportSelected.size === 0}>
                      Export ({exportSelected.size})
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={cancelExport}>Cancel</button>
                  </>
                )}
              </div>
            </div>

            {names.length === 0 && (
              <div style={{
                color: 'var(--text-faded)', fontSize: 12, fontStyle: 'italic',
                padding: '14px 0', textAlign: 'center',
              }}>No saved encounters</div>
            )}
            {names.map(name => {
              const checked = exportSelected.has(name)
              return (
                <div key={name}
                  onClick={exportMode ? () => toggleExportSel(name) : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 0', borderBottom: 'var(--app-bw) solid var(--border)',
                    cursor: exportMode ? 'pointer' : 'default',
                    gap: 10,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {exportMode && (
                      <input type="checkbox" checked={checked} readOnly
                        style={{ accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
                    )}
                    <span style={{ color: 'var(--text)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  </div>
                  {!exportMode && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button className="btn btn-sm" onClick={() => handleLoad(name)}>Load</button>
                      <button className="btn btn-sm" style={dangerBtn} onClick={() => handleDelete(name)}>Delete</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Reset */}
          <div style={{ borderTop: 'var(--app-bw) solid var(--border)', paddingTop: 14 }}>
            <button className="btn btn-sm" style={dangerBtn} onClick={handleReset}>
              ⚠ Clear All &amp; Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
