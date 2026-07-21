import { useState, useEffect } from 'react'
import { useEncounterTablesStore, rollEncounterEntry, type EncounterEntry, type EncounterKind } from '../store/encounterTablesStore'
import { useCombatStore } from '../store/combatStore'
import { useGmLayoutStore } from '../store/layoutStore'
import { loadCreatureByName } from '../data/dataStore'
import { rollDie } from '../utils/dice'

// Per-instance persisted state (mirrors GmWidgets' usePersistentState).
function usePersisted<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => {
    try { const r = localStorage.getItem(key); return r != null ? (JSON.parse(r) as T) : initial } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* quota */ } }, [key, v])
  return [v, setV]
}

const wrap: React.CSSProperties = { height: '100%', overflowY: 'auto', padding: '12px 14px', fontFamily: 'var(--font-ui)', color: 'var(--text)', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faded)', margin: '14px 0 6px' }

interface Persisted {
  tableId: string | null; kind: EncounterKind; road: boolean; flying: boolean
  check: { roll: number; dc: number; success: boolean } | null
  result: EncounterEntry | null
}

export function RandomEncounterWidget({ id }: { id: string }) {
  const tables = useEncounterTablesStore(s => s.tables)
  const addCombatant = useCombatStore(s => s.addCombatant)
  // Roll output rides in the persisted blob too, so a rolled encounter survives
  // the pane-tree re-render that happens whenever the combat roster changes
  // (e.g. right after "Add to combat"), and survives a reload.
  const [st, setSt] = usePersisted<Persisted>(`gmw:${id}`, { tableId: null, kind: 'creature', road: false, flying: false, check: null, result: null })
  const [msg, setMsg] = useState<string>('')
  const check = st.check
  const result = st.result

  const table = tables.find(t => t.id === st.tableId) ?? tables[0]
  // Effective sub-table the GM is rolling on, and a sensible default kind.
  const kind: EncounterKind = table
    ? (st.kind === 'hazard' && table.hazards.length) || (st.kind === 'creature' && table.creatures.length)
      ? st.kind
      : (table.creatures.length ? 'creature' : table.hazards.length ? 'hazard' : st.kind)
    : st.kind
  const entries = table ? (kind === 'hazard' ? table.hazards : table.creatures) : []
  const effDc = table ? Math.max(0, table.dc - (st.road ? 2 : 0) + (st.flying ? 3 : 0)) : 0

  if (!tables.length) {
    return (
      <div style={wrap}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          No encounter tables yet.
          <br /><br />
          Create one in <strong style={{ color: 'var(--text)' }}>Settings → Encounter Tables</strong>, then come back here to roll.
        </div>
      </div>
    )
  }

  const rollCheck = () => {
    const roll = rollDie(20)
    setSt(p => ({ ...p, check: { roll, dc: effDc, success: roll >= effDc } }))
  }
  const rollResult = () => {
    setMsg('')
    setSt(p => ({ ...p, result: rollEncounterEntry(entries) }))
  }
  const preview = (name: string) => {
    useGmLayoutStore.getState().addPopup({ type: 'creature', ref: name.toLowerCase(), title: name })
  }
  const addToCombat = async (e: EncounterEntry) => {
    if (!e.creature) return
    setMsg('Loading…')
    const c = await loadCreatureByName(e.creature.name)
    if (c) { addCombatant(c); setMsg(`Added ${c.name} to the tracker.`) }
    else setMsg(`Couldn't load a stat block for "${e.creature.name}".`)
  }

  const kindBtn = (k: EncounterKind, count: number): React.CSSProperties => ({
    flex: 1, padding: '6px 0', fontSize: 12.5, fontWeight: 600,
    cursor: count ? 'pointer' : 'not-allowed', opacity: count ? 1 : 0.45,
    background: kind === k ? 'var(--accent-soft)' : 'transparent',
    color: kind === k ? 'var(--accent)' : 'var(--text-muted)',
    border: 'none', borderBottom: kind === k ? '2px solid var(--accent)' : '2px solid transparent',
  })

  return (
    <div style={wrap}>
      {/* Table picker */}
      <select
        value={table?.id ?? ''}
        onChange={e => { setSt(p => ({ ...p, tableId: e.target.value, check: null, result: null })); setMsg('') }}
        className="input-dark"
        style={{ width: '100%', fontSize: 13, fontWeight: 600 }}
      >
        {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      {table && (
        <>
          {/* DC + adjustments */}
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-faded)' }}>Encounter check</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>DC {effDc}</span>
            {effDc !== table.dc && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faded)' }}>(base {table.dc})</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setSt(p => ({ ...p, road: !p.road, check: null }))}
              style={st.road ? { borderColor: 'var(--accent-line)', color: 'var(--accent)' } : undefined}>Road / river −2</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setSt(p => ({ ...p, flying: !p.flying, check: null }))}
              style={st.flying ? { borderColor: 'var(--accent-line)', color: 'var(--accent)' } : undefined}>Flying +3</button>
            <button className="btn btn-primary btn-sm" onClick={rollCheck}>Roll check</button>
          </div>
          {table.note && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.5, marginTop: 8 }}>{table.note}</div>}
          {check && (
            <div style={{ marginTop: 8, fontSize: 13, fontFamily: 'var(--font-mono)' }}>
              <span style={{ color: 'var(--text-muted)' }}>d20 {check.roll} vs DC {check.dc} → </span>
              <span style={{ fontWeight: 700, color: check.success ? 'var(--hp-full)' : 'var(--text-faded)' }}>
                {check.success ? 'Encounter!' : 'No encounter'}
              </span>
            </div>
          )}

          {/* Type choice + roll */}
          <div style={lbl}>Roll on</div>
          <div style={{ display: 'flex', borderBottom: 'var(--app-bw) solid var(--border)' }}>
            <button style={kindBtn('creature', table.creatures.length)}
              disabled={!table.creatures.length} onClick={() => { setSt(p => ({ ...p, kind: 'creature', result: null })); setMsg('') }}>
              Monster ({table.creatures.length})
            </button>
            <button style={kindBtn('hazard', table.hazards.length)}
              disabled={!table.hazards.length} onClick={() => { setSt(p => ({ ...p, kind: 'hazard', result: null })); setMsg('') }}>
              Hazard ({table.hazards.length})
            </button>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 10 }}
            disabled={!entries.length} onClick={rollResult}>
            🎲 Roll {kind === 'hazard' ? 'hazard' : 'monster'}
          </button>

          {/* Result */}
          {result && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                {result.label || result.creature?.name || '(unnamed result)'}
                {result.creature?.level != null && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faded)', marginLeft: 8 }}>
                    {result.creature.isHazard ? 'Hazard ' : 'Lv '}{result.creature.level}
                  </span>
                )}
              </div>
              {result.creature && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => addToCombat(result)}>+ Add to combat</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => preview(result.creature!.name)}>Preview</button>
                </div>
              )}
            </div>
          )}
          {msg && <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-muted)' }}>{msg}</div>}
        </>
      )}
    </div>
  )
}
