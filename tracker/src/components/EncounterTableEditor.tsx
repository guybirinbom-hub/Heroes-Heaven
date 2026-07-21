import { useState } from 'react'
import type { Creature } from '../types/pf2e'
import {
  useEncounterTablesStore, newEncounterTable, newEncounterEntry,
  type EncounterTable, type EncounterEntry, type EncounterKind,
} from '../store/encounterTablesStore'
import { CreaturePickerModal } from './CreaturePickerModal'
import { NumberInput } from './NumberInput'
import { XIcon, TrashIcon, PlusIcon } from './Icons'

const listKey = (k: EncounterKind) => (k === 'creature' ? 'creatures' : 'hazards') as 'creatures' | 'hazards'

const labelStyle: React.CSSProperties = { fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }
const hintStyle: React.CSSProperties = { fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }

// ── One sub-table (Monsters or Hazards) ──────────────────────────────────────
function EntrySection({ title, entries, onAdd, onUpdate, onRemove, onLink }: {
  title: string
  entries: EncounterEntry[]
  onAdd: () => void
  onUpdate: (id: string, patch: Partial<EncounterEntry>) => void
  onRemove: (id: string) => void
  onLink: (id: string) => void
}) {
  const total = entries.reduce((s, e) => s + Math.max(1, e.weight || 1), 0)
  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{title} <span style={{ color: 'var(--text-faded)', fontWeight: 400 }}>({entries.length})</span></span>
        <button className="btn btn-secondary btn-sm" onClick={onAdd}><PlusIcon size={11} /> Add row</button>
      </div>
      {entries.length === 0 && (
        <div style={{ ...hintStyle, fontStyle: 'italic', padding: '4px 2px 8px' }}>No entries yet — add a row, type a result, optionally link a stat block.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map(e => {
          const pct = total > 0 ? Math.round((Math.max(1, e.weight || 1) / total) * 100) : 0
          return (
            <div key={e.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                className="input-dark"
                style={{ flex: 1, minWidth: 0 }}
                placeholder={e.creature ? e.creature.name : 'Result (e.g. 1d4 giant scorpions)'}
                value={e.label}
                onChange={ev => onUpdate(e.id, { label: ev.target.value })}
              />
              <div title="Relative weight (higher = more likely)" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <NumberInput
                  min={1} max={999}
                  value={e.weight}
                  onChange={ev => onUpdate(e.id, { weight: Math.max(1, parseInt(ev.target.value) || 1) })}
                  onStep={n => onUpdate(e.id, { weight: Math.max(1, n) })}
                  className="input-dark input-mono"
                  style={{ width: 56, fontSize: 12.5 }}
                />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faded)', width: 30 }}>{pct}%</span>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                title={e.creature ? `Linked: ${e.creature.name} — click to change` : 'Link a bestiary stat block'}
                onClick={() => onLink(e.id)}
                style={e.creature ? { borderColor: 'var(--accent-line)', color: 'var(--accent)' } : undefined}
              >{e.creature ? '🔗' : 'Link'}</button>
              {e.creature && (
                <button className="ico-btn" title="Unlink stat block" style={{ width: 26, height: 26, color: 'var(--text-faded)' }}
                  onClick={() => onUpdate(e.id, { creature: undefined })}><XIcon size={11} /></button>
              )}
              <button className="ico-btn" title="Delete row" style={{ width: 26, height: 26, color: 'var(--danger)' }}
                onClick={() => onRemove(e.id)}><TrashIcon size={12} /></button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function EncounterTableEditor({ table, onClose }: { table?: EncounterTable; onClose: () => void }) {
  const upsert = useEncounterTablesStore(s => s.upsert)
  const [draft, setDraft] = useState<EncounterTable>(() => (table ? structuredClone(table) : newEncounterTable()))
  const [picking, setPicking] = useState<{ kind: EncounterKind; entryId: string } | null>(null)

  const addEntry = (kind: EncounterKind) => setDraft(d => ({ ...d, [listKey(kind)]: [...d[listKey(kind)], newEncounterEntry()] }))
  const updateEntry = (kind: EncounterKind, id: string, patch: Partial<EncounterEntry>) =>
    setDraft(d => ({ ...d, [listKey(kind)]: d[listKey(kind)].map(e => (e.id === id ? { ...e, ...patch } : e)) }))
  const removeEntry = (kind: EncounterKind, id: string) =>
    setDraft(d => ({ ...d, [listKey(kind)]: d[listKey(kind)].filter(e => e.id !== id) }))

  const onPick = (c: Creature) => {
    if (!picking) return
    updateEntry(picking.kind, picking.entryId, {
      creature: { name: c.name, level: c.level, isHazard: c.isHazard },
      // Default the visible label to the creature name when the row is blank.
      ...(draft[listKey(picking.kind)].find(e => e.id === picking.entryId)?.label.trim() ? {} : { label: c.name }),
    })
    setPicking(null)
  }

  const save = () => {
    upsert({ ...draft, name: draft.name.trim() || 'Encounter table' })
    onClose()
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 9000 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 680, padding: 0, overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: 'var(--app-bw) solid var(--border)',
          background: 'linear-gradient(180deg, var(--bg-header-top), var(--bg-header-bottom))',
        }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 500, margin: 0, color: 'var(--text)' }}>
            {table ? 'Edit encounter table' : 'New encounter table'}
          </h2>
          <button className="ico-btn" style={{ width: 28, height: 28 }} onClick={onClose} title="Cancel"><XIcon size={14} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...labelStyle, marginBottom: 5 }}>Name</div>
              <input className="input-dark" style={{ width: '100%' }} value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Osirion desert (levels 1–4)" />
            </div>
            <div>
              <div style={{ ...labelStyle, marginBottom: 5 }}>Flat-check DC</div>
              <NumberInput min={0} max={60} value={draft.dc}
                onChange={e => setDraft(d => ({ ...d, dc: Math.max(0, parseInt(e.target.value) || 0) }))}
                onStep={n => setDraft(d => ({ ...d, dc: Math.max(0, n) }))}
                className="input-dark input-mono" style={{ width: 84 }} />
            </div>
          </div>

          <div>
            <div style={{ ...labelStyle, marginBottom: 5 }}>Note <span style={{ color: 'var(--text-faded)', fontWeight: 400 }}>(shown under the DC when rolling)</span></div>
            <textarea className="input-dark" style={{ width: '100%', minHeight: 56, resize: 'vertical', lineHeight: 1.5 }}
              value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} />
          </div>

          <EntrySection
            title="Monsters"
            entries={draft.creatures}
            onAdd={() => addEntry('creature')}
            onUpdate={(id, patch) => updateEntry('creature', id, patch)}
            onRemove={id => removeEntry('creature', id)}
            onLink={id => setPicking({ kind: 'creature', entryId: id })}
          />
          <EntrySection
            title="Hazards"
            entries={draft.hazards}
            onAdd={() => addEntry('hazard')}
            onUpdate={(id, patch) => updateEntry('hazard', id, patch)}
            onRemove={id => removeEntry('hazard', id)}
            onLink={id => setPicking({ kind: 'hazard', entryId: id })}
          />
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px', borderTop: 'var(--app-bw) solid var(--border)' }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save}>{table ? 'Save changes' : 'Create table'}</button>
        </div>
      </div>

      {picking && (
        <CreaturePickerModal
          title={`Link ${picking.kind === 'hazard' ? 'hazard' : 'monster'} stat block`}
          onSelect={onPick}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
