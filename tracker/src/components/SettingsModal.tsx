import { useState, useMemo } from 'react'
import { useSettingsStore, SPELL_INDICATORS, SPELL_LAYOUTS, SB_ITEM_META, SB_DEFAULT_ITEMS, SB_MERGE_STYLES, SB_LINE_GAPS, SB_ATTACK_COLS, STATBLOCK_DEFAULT, sbItemIsInline, lineGapPx, type SpellIndicator, type SpellLayout, type SbItem, type SbItemId, type SbEditApi } from '../store/settingsStore'
import { useGameData } from '../data/gameDataContext'
import { cleanSource, categorizeBook, BOOK_GROUP_ORDER, type BookGroup } from '../utils/sources'
import { useSourcesStore } from '../store/sourcesStore'
import { StatBlock } from './StatBlock'
import { SAMPLE_COMBATANT } from '../data/sampleStatBlock'
import { SpellPips } from './SpellPips'
import { useCustomConditionsStore, type CustomCondition } from '../store/customConditionsStore'
import { useDmAverageStore } from '../store/dmAverageStore'
import { CONDITION_META, ALL_CONDITIONS, STAT_MOD_LABELS, type StatMods } from '../utils/conditionEffects'
import { formatTurnTime } from '../utils/turnTimer'
import { AdvancedConditionEditor } from './AdvancedConditionEditor'
import { PcDetailControls } from './PcDetailControls'
import { XIcon, TrashIcon, PencilIcon, PlusIcon, ImportIcon, SaveIcon } from './Icons'
import { HHAppearance } from './HHAppearance'
import { useEncounterTablesStore, newEncId, DEFAULT_ENCOUNTER_NOTE, type EncounterTable, type EncounterEntry } from '../store/encounterTablesStore'
import { EncounterTableEditor } from './EncounterTableEditor'
import { TurnTimeline } from './TurnTimeline'

interface Props { onClose: () => void }

// ── Section identifiers ──────────────────────────────────────────────────
// The sidebar drives which body view renders. Add a new SectionId and a
// matching case in the switch below to grow the settings.
type SectionId = 'appearance' | 'display' | 'statblock' | 'sources' | 'timer' | 'players' | 'conditions' | 'encounter-tables' | 'danger'

interface SectionDef { id: SectionId; label: string; show: () => boolean }

const SECTIONS: SectionDef[] = [
  { id: 'appearance', label: 'Appearance', show: () => true },
  { id: 'display',    label: 'Display',    show: () => true },
  { id: 'statblock',  label: 'Stat Blocks', show: () => true },
  { id: 'sources',    label: 'Sources', show: () => true },
  { id: 'timer',      label: 'Turn Timer', show: () => true },
  { id: 'players',    label: 'Player Characters', show: () => true },
  { id: 'conditions', label: 'Conditions', show: () => true },
  { id: 'encounter-tables', label: 'Encounter Tables', show: () => true },
  // Uninstall is only available in the desktop build — hide the whole
  // section in the unreachable browser preview rather than show a dead row.
  { id: 'danger',     label: 'Danger Zone', show: () => !!window.electronAPI?.appUninstall },
]

// ── Encounter Tables — CRUD for random encounter tables ──────────────────
// Sanitize an entry coming from an imported JSON file (fresh ids, clamped weight).
function normalizeImportedEntry(raw: unknown): EncounterEntry {
  const e = (raw ?? {}) as { label?: unknown; weight?: unknown; creature?: { name?: unknown; level?: unknown; isHazard?: unknown } }
  const cr = e.creature
  return {
    id: newEncId('e'),
    label: typeof e.label === 'string' ? e.label : '',
    weight: Math.max(1, Number(e.weight) || 1),
    creature: cr && typeof cr.name === 'string'
      ? { name: cr.name, level: typeof cr.level === 'number' ? cr.level : undefined, isHazard: !!cr.isHazard }
      : undefined,
  }
}

export function EncounterTablesSection() {
  const tables = useEncounterTablesStore(s => s.tables)
  const remove = useEncounterTablesStore(s => s.remove)
  const upsert = useEncounterTablesStore(s => s.upsert)
  const [editing, setEditing] = useState<{ table?: EncounterTable } | null>(null)
  const [msg, setMsg] = useState('')

  const exportTable = (t: EncounterTable) => {
    const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${t.name.replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-') || 'encounter-table'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importTables = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result))
          const list = Array.isArray(data) ? data : [data]
          let n = 0
          for (const raw of list) {
            const t = raw as { name?: unknown; dc?: unknown; note?: unknown; creatures?: unknown; hazards?: unknown }
            if (!t || typeof t.name !== 'string') continue
            upsert({
              id: newEncId('table'),
              name: t.name,
              dc: Number(t.dc) || 15,
              note: typeof t.note === 'string' ? t.note : DEFAULT_ENCOUNTER_NOTE,
              creatures: Array.isArray(t.creatures) ? t.creatures.map(normalizeImportedEntry) : [],
              hazards: Array.isArray(t.hazards) ? t.hazards.map(normalizeImportedEntry) : [],
            })
            n++
          }
          setMsg(n ? `Imported ${n} table${n === 1 ? '' : 's'}.` : 'No valid tables found in that file.')
        } catch { setMsg('That file isn’t a valid encounter-table JSON.') }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', marginBottom: 16,
        background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border)', borderRadius: 'var(--radius-sm)',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 1 }}>Random Encounter Tables</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            Build tables with a flat-check DC plus separate Monster and Hazard lists. Roll them from the GM Screen (+ → Random Encounter).
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }} onClick={importTables}><ImportIcon size={12} /> Import</button>
        <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }} onClick={() => setEditing({})}><PlusIcon size={12} /> New table</button>
      </div>
      {msg && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10 }}>{msg}</div>}

      {tables.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-sm)', color: 'var(--text-faded)', fontSize: 12, fontStyle: 'italic' }}>
          No tables yet. Click <span style={{ color: 'var(--accent)', fontWeight: 600, fontStyle: 'normal' }}>New table</span> to create one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tables.map(t => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
              background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 'var(--radius-sm)',
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  DC {t.dc} · {t.creatures.length} monster{t.creatures.length === 1 ? '' : 's'} · {t.hazards.length} hazard{t.hazards.length === 1 ? '' : 's'}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" title="Export this table to a JSON file" onClick={() => exportTable(t)}><SaveIcon size={11} /> Export</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing({ table: t })}><PencilIcon size={11} /> Edit</button>
              <button className="ico-btn" title="Delete table" style={{ width: 28, height: 28, color: 'var(--danger)' }}
                onClick={() => { if (window.confirm(`Delete "${t.name}"? This can't be undone.`)) remove(t.id) }}><TrashIcon size={13} /></button>
            </div>
          ))}
        </div>
      )}

      {editing && <EncounterTableEditor table={editing.table} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ── Theme picker — grid of swatches that previews and applies a palette ──
function UninstallConfirm({ onCancel }: { onCancel: () => void }) {
  const [typed, setTyped] = useState('')
  const ready = typed.trim().toUpperCase() === 'DELETE'

  const runUninstall = () => {
    if (!window.electronAPI?.appUninstall) {
      alert('Uninstall is only available in the desktop app.')
      return
    }
    void window.electronAPI.appUninstall()
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 10000 }}>
      <div className="modal-box" style={{
        maxWidth: 460, padding: 0, overflow: 'hidden',
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '16px 22px',
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--danger) 18%, transparent), color-mix(in srgb, var(--danger) 6%, transparent))',
          borderBottom: 'var(--app-bw) solid var(--danger)',
          flexShrink: 0,
        }}>
          <h2 style={{
            margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600,
            fontSize: 17, color: 'var(--danger)',
          }}>Uninstall PF2e Initiative Tracker?</h2>
        </div>
        <div style={{ padding: '16px 22px 18px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <p style={{
            margin: '0 0 12px', fontFamily: 'var(--font-ui)', fontSize: 13, lineHeight: 1.55, color: 'var(--text)',
          }}>This will permanently remove:</p>
          <ul style={{
            margin: '0 0 14px 18px', padding: 0,
            fontFamily: 'var(--font-ui)', fontSize: 12.5, lineHeight: 1.7,
            color: 'var(--text-muted)',
          }}>
            <li>The application files (everything in the install folder)</li>
            <li>All saved parties, encounters, and custom stat blocks</li>
            <li>The current initiative tracker state</li>
            <li>All settings</li>
          </ul>
          <p style={{
            margin: '0 0 8px', fontFamily: 'var(--font-ui)', fontSize: 12, lineHeight: 1.5, color: 'var(--text-faded)',
          }}>
            This cannot be undone. Type <strong style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>DELETE</strong> to confirm.
          </p>
          <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} placeholder="DELETE"
            className="input-dark"
            style={{ width: '100%', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
            <button
              disabled={!ready}
              onClick={runUninstall}
              style={{
                background: ready ? 'var(--danger)' : 'rgba(198,106,90,0.25)',
                color: ready ? 'var(--text-on-danger)' : 'var(--text-faded)',
                border: 'var(--app-bw) solid var(--danger)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 14px',
                fontFamily: 'var(--font-ui)',
                fontWeight: 600,
                fontSize: 12.5,
                cursor: ready ? 'pointer' : 'not-allowed',
                opacity: ready ? 1 : 0.6,
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            ><TrashIcon size={13} /> Uninstall</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ToggleRow({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void
}) {
  const toggle = () => onChange(!checked)
  return (
    <div
      role="switch" aria-checked={checked} aria-label={label} tabIndex={0}
      onClick={toggle}
      onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle() } }}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 14,
        padding: '12px 4px',
        borderBottom: 'var(--app-bw) solid var(--border)',
        cursor: 'pointer',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600,
          color: 'var(--text)', marginBottom: 3,
        }}>{label}</div>
        {hint && (
          <div style={{
            fontFamily: 'var(--font-ui)', fontSize: 11.5,
            color: 'var(--text-muted)', lineHeight: 1.5,
          }}>{hint}</div>
        )}
      </div>
      <div aria-hidden="true"
        style={{
          flexShrink: 0, marginTop: 2,
          width: 36, height: 20,
          background: checked ? 'var(--accent)' : 'var(--bg-elevated)',
          border: `var(--app-bw) solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
          borderRadius: 10,
          position: 'relative',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <span style={{
          position: 'absolute',
          top: 1, left: checked ? 17 : 1,
          width: 16, height: 16, borderRadius: '50%',
          background: checked ? 'var(--text-on-accent)' : 'var(--text-muted)',
          transition: 'left 0.15s',
        }} />
      </div>
    </div>
  )
}

// ── Section: Conditions ──────────────────────────────────────────────────
type ConditionTab = 'custom' | 'pf2e'

/** Render a one-line summary of which stats a custom condition tweaks. */
function summariseMods(mods: Partial<StatMods>): string {
  const entries = Object.entries(mods).filter(([, v]) => v && v !== 0)
  if (!entries.length) return 'no stat effects'
  return entries
    .map(([k, v]) => `${(v as number) > 0 ? '+' : ''}${v} ${STAT_MOD_LABELS[k as keyof StatMods]}`)
    .join(' · ')
}

function CustomConditionRow({ c, onEdit, onDelete }: {
  c: CustomCondition
  onEdit: () => void
  onDelete: () => void
}) {
  const bg = (c.bg ?? '#3a2f24') + '2b'
  const border = c.border ? c.border + '60' : 'color-mix(in srgb, var(--linked) 38%, transparent)'
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '10px 12px',
      background: 'var(--bg-elevated)',
      border: 'var(--app-bw) solid var(--border)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <span style={{
        flexShrink: 0,
        display: 'inline-flex', alignItems: 'center',
        padding: '2px 10px',
        background: bg, border: `var(--app-bw) solid ${border}`, color: 'var(--text)',
        borderRadius: 'var(--radius-full)',
        fontSize: 11.5, fontStyle: 'italic',
      }}>{c.name}{c.hasValue && ' X'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {c.hasValue && (
            <>max {c.maxValue}{c.scalesByValue && ' · scales by value'} · </>
          )}
          {c.isPermanent ? 'permanent' : `${c.defaultDuration} rounds`}
          {c.autoDecrement && ' · auto-decrement'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-faded)', marginTop: 3 }}>
          {summariseMods(c.mods)}
        </div>
        {c.condMods && Object.keys(c.condMods).length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>
            {Object.entries(c.condMods).map(([k, cm]) =>
              `${cm!.value > 0 ? '+' : ''}${cm!.value} ${STAT_MOD_LABELS[k as keyof StatMods]}${cm!.when ? ` ${cm!.when}` : ''}*`
            ).join(' · ')}
          </div>
        )}
        {c.description && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
            "{c.description}"
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
        <button onClick={onEdit}
          className="btn btn-secondary btn-sm"
          style={{ fontSize: 10.5, padding: '3px 10px' }}
        >Edit</button>
        <button onClick={onDelete}
          style={{
            background: 'transparent', border: 'var(--app-bw) solid var(--danger)',
            color: 'var(--danger)',
            borderRadius: 'var(--radius-sm)',
            padding: '3px 10px',
            fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 10.5,
            cursor: 'pointer',
          }}
        >Delete</button>
      </div>
    </div>
  )
}

export function ConditionsSection() {
  const customList = useCustomConditionsStore(s => s.conditions)
  const upsert = useCustomConditionsStore(s => s.upsert)
  const remove = useCustomConditionsStore(s => s.remove)
  const [tab, setTab] = useState<ConditionTab>('custom')
  const [editor, setEditor] = useState<{ editing?: CustomCondition } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CustomCondition | null>(null)

  return (
    <div>
      {/* Tab strip */}
      <div style={{
        display: 'flex', gap: 0,
        borderBottom: 'var(--app-bw) solid var(--border)',
        marginBottom: 14,
      }}>
        {(['custom', 'pf2e'] as const).map(t => (
          <button key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'transparent', border: 'none',
              padding: '8px 16px',
              fontFamily: 'var(--font-ui)', fontWeight: 600,
              fontSize: 12, letterSpacing: '0.04em',
              color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer',
              borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1,
            }}
          >{t === 'custom' ? 'Custom Conditions' : 'PF2e Conditions'}</button>
        ))}
      </div>

      {/* CUSTOM TAB */}
      {tab === 'custom' && (
        <div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {customList.length === 0
                ? 'No saved conditions yet. Create one to reuse it across encounters.'
                : `${customList.length} saved condition${customList.length === 1 ? '' : 's'}.`}
            </div>
            <button
              onClick={() => setEditor({})}
              className="btn btn-primary btn-sm"
              style={{ fontSize: 11.5, padding: '5px 12px' }}
            >+ Create Condition</button>
          </div>
          {customList.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {customList.map(c => (
                <CustomConditionRow key={c.id} c={c}
                  onEdit={() => setEditor({ editing: c })}
                  onDelete={() => setConfirmDelete(c)}
                />
              ))}
            </div>
          )}
          {customList.length === 0 && (
            <div style={{
              padding: '40px 20px', textAlign: 'center',
              border: '1px dashed var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-faded)', fontSize: 12, fontStyle: 'italic',
            }}>
              Click <span style={{ color: 'var(--accent)', fontWeight: 600, fontStyle: 'normal' }}>+ Create Condition</span> above to design your first one.
            </div>
          )}
        </div>
      )}

      {/* PF2e TAB */}
      {tab === 'pf2e' && (
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10 }}>
            Reference list — the {ALL_CONDITIONS.length} core PF2e conditions. These are always available in the Add Condition picker.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ALL_CONDITIONS.map(key => {
              const m = CONDITION_META[key]
              return (
                <div key={key} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: '8px 12px',
                  background: 'var(--bg-elevated)',
                  border: 'var(--app-bw) solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                }}>
                  <span style={{
                    flexShrink: 0, minWidth: 110,
                    display: 'inline-flex', alignItems: 'center',
                    padding: '2px 10px',
                    background: m.bg + '40', border: `var(--app-bw) solid ${m.border + '80'}`, color: 'var(--text)',
                    borderRadius: 'var(--radius-full)', fontSize: 11.5,
                  }}>{m.name}{m.hasValue && ' X'}</span>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5, flex: 1 }}>
                    {m.summary}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Editor overlay — same component the Add-Condition popup uses. */}
      {editor && (
        <AdvancedConditionEditor
          editing={editor.editing}
          title={editor.editing ? 'Edit Custom Condition' : 'New Custom Condition'}
          onClose={() => setEditor(null)}
          onSave={c => { upsert(c); setEditor(null) }}
        />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="modal-overlay" style={{ zIndex: 10002 }}>
          <div className="modal-box" style={{ maxWidth: 380, padding: 18 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--danger)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
              Delete "{confirmDelete.name}"?
            </h3>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 14px' }}>
              The template is removed from your library. Conditions already applied to combatants stay where they are.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button
                onClick={() => { remove(confirmDelete.id); setConfirmDelete(null) }}
                style={{
                  background: 'var(--danger)', color: 'var(--text-on-danger)',
                  border: 'var(--app-bw) solid var(--danger)', borderRadius: 'var(--radius-sm)',
                  padding: '6px 14px', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'var(--font-ui)',
                }}
              >Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sections: Appearance ─────────────────────────────────────────────────

// Segmented picker for a small enum setting. Buttons wrap; an optional `sample`
// renders a visual preview (e.g. a slot pip) next to each label.
function OptionPicker({ label, hint, value, options, onChange, sample }: {
  label: string
  hint?: string
  value: string
  options: { id: string; label: string }[]
  onChange: (id: string) => void
  sample?: (id: string) => React.ReactNode
}) {
  return (
    <div style={{ padding: '12px 4px', borderBottom: 'var(--app-bw) solid var(--border)' }}>
      <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{label}</div>
      {hint && <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 9 }}>{hint}</div>}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {options.map(o => {
          const on = o.id === value
          return (
            <button key={o.id} onClick={() => onChange(o.id)}
              style={{
                fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 12,
                color: on ? 'var(--text)' : 'var(--text-muted)',
                background: on ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                border: `var(--app-bw) solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
                borderRadius: 'var(--radius)', padding: '7px 12px', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 8, transition: 'all .14s',
              }}>
              {sample?.(o.id)}
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * `campaignDriven` — the host app decides some of these from campaign state, so the manual control
 * would be a second, contradictory source of truth. Heroes Heaven passes it; the standalone tracker
 * doesn't, and keeps every switch (it has no campaign to read).
 */
export function DisplaySection({ campaignDriven = false }: { campaignDriven?: boolean } = {}) {
  const showMonsterParts = useSettingsStore(s => s.showMonsterParts)
  const showInitAC = useSettingsStore(s => s.showInitAC)
  const showInitSaves = useSettingsStore(s => s.showInitSaves)
  const showInitLevel = useSettingsStore(s => s.showInitLevel)
  const showInitPcDefenses = useSettingsStore(s => s.showInitPcDefenses)
  const hideInitPcHp = useSettingsStore(s => s.hideInitPcHp)
  const persistentDamageAutoRoll = useSettingsStore(s => s.persistentDamageAutoRoll)
  const persistentDamageWarn = useSettingsStore(s => s.persistentDamageWarn)
  const showSource = useSettingsStore(s => s.showSource)
  const dockablePopups = useSettingsStore(s => s.dockablePopups)
  const showBlockDragButton = useSettingsStore(s => s.showBlockDragButton)
  const showInitCollapseButton = useSettingsStore(s => s.showInitCollapseButton)
  const setSetting = useSettingsStore(s => s.setSetting)
  return (
    <div>
      <ToggleRow
        label="Initiative collapse button"
        hint="Show a button to collapse/expand the initiative-order sidebar. Turn off to keep the sidebar always open with no button."
        checked={showInitCollapseButton}
        onChange={v => setSetting('showInitCollapseButton', v)}
      />
      <ToggleRow
        label="Show AC in initiative order"
        hint="Show each creature's Armor Class on its card in the initiative list."
        checked={showInitAC}
        onChange={v => setSetting('showInitAC', v)}
      />
      <ToggleRow
        label="Show saves in initiative order"
        hint="Show each creature's Fortitude, Reflex, and Will saves on its card in the initiative list."
        checked={showInitSaves}
        onChange={v => setSetting('showInitSaves', v)}
      />
      <ToggleRow
        label="Show level in initiative order"
        hint="Show each creature's level (the “Lv N” tag) on its card in the initiative list."
        checked={showInitLevel}
        onChange={v => setSetting('showInitLevel', v)}
      />
      <ToggleRow
        label="Show player AC & saves in initiative order"
        hint="Show each player character's AC and Fortitude/Reflex/Will on its initiative card, pulled from their imported or entered character sheet."
        checked={showInitPcDefenses}
        onChange={v => setSetting('showInitPcDefenses', v)}
      />
      <ToggleRow
        label="Hide player HP bars in initiative order"
        hint="Hide the mini HP bar under each player character in the initiative list — players usually track their own HP. Monster and NPC HP bars are unaffected."
        checked={hideInitPcHp}
        onChange={v => setSetting('hideInitPcHp', v)}
      />
      <ToggleRow
        label="Auto-roll persistent damage"
        hint="When a creature with a Persistent Damage condition ends its turn, roll its damage and apply it automatically (shown as a dice result). Off = it never rolls on its own; you roll it yourself."
        checked={persistentDamageAutoRoll}
        onChange={v => setSetting('persistentDamageAutoRoll', v)}
      />
      <ToggleRow
        label="Persistent damage reminder"
        hint="When auto-roll is off, pop a top-right warning (like a dice result) as a creature with Persistent Damage ends its turn — a reminder to roll it and attempt the flat check to end it."
        checked={persistentDamageWarn}
        onChange={v => setSetting('persistentDamageWarn', v)}
      />
      <ToggleRow
        label="Show source in popups"
        hint="Show the book and page citation (e.g. “Player Core pg. 454”) at the bottom of trait, spell, item, and other reference popups."
        checked={showSource}
        onChange={v => setSetting('showSource', v)}
      />
      {/* Monster Parts follows the campaign's Battlezoo variant rule where there IS a campaign, so
          the switch would just be a way to disagree with it. Standalone there's nothing to ask. */}
      {!campaignDriven && (
        <ToggleRow
          label="Show Monster Parts value"
          hint="Display the gp value and bulk of monster parts next to each creature's level, based on the Battlezoo table."
          checked={showMonsterParts}
          onChange={v => setSetting('showMonsterParts', v)}
        />
      )}
      <ToggleRow
        label="Dockable popups"
        hint="Master switch for the popup ⠿ button. When on, reference popups (spells, traits, items) get a ⠿ drag button in their header to dock them into the stat-block layout. (Drag a popup's header itself to combine it as tabs.) When off, popups are plain floating windows."
        checked={dockablePopups}
        onChange={v => setSetting('dockablePopups', v)}
      />
      {dockablePopups && (
        <div style={{ marginLeft: 18, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
          <ToggleRow
            label="Block button (⠿)"
            hint="Show the ⠿ button. Drag it to dock the whole popup into the stat-block layout as its own tiled box (it never stacks as a tab)."
            checked={showBlockDragButton}
            onChange={v => setSetting('showBlockDragButton', v)}
          />
        </div>
      )}
    </div>
  )
}

// ── Interactive stat-block editor (Settings only) ──────────────────────────
// The settings page renders a real, fully-populated example stat block in edit
// mode: click any row to select it, then restyle / hide / merge it with the
// toolbar; drag rows to reorder. The chosen layout drives every real stat block
// in the app (which stay read-only in play — you can only rearrange here).

export function StatBlockSection() {
  const sb = useSettingsStore(s => s.statBlock)
  const spellIndicator = useSettingsStore(s => s.spellIndicator)
  const spellLayout = useSettingsStore(s => s.spellLayout)
  const setSetting = useSettingsStore(s => s.setSetting)
  const [selectedId, setSelectedId] = useState<SbItemId | null>(null)

  const commit = (items: SbItem[]) => setSetting('statBlock', { ...sb, items })
  const onReorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return
    const next = sb.items.slice()
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    commit(next)
  }
  const patchItem = (id: SbItemId, patch: Partial<SbItem>) =>
    commit(sb.items.map(it => (it.id === id ? { ...it, ...patch } : it)))
  // Drag-drop: place `fromId` on the same line as `targetId` ('beside'), or on
  // its own line just before ('stack') or after ('stack-after') it.
  const onDropMerge = (fromId: SbItemId, targetId: SbItemId, side: 'beside' | 'stack' | 'stack-after') => {
    if (fromId === targetId) return
    const items = sb.items.slice()
    const from = items.findIndex(i => i.id === fromId)
    if (from < 0) return
    const [moved] = items.splice(from, 1)
    const t = items.findIndex(i => i.id === targetId)
    if (t < 0) return
    if (side === 'beside') { moved.inline = true; items.splice(t + 1, 0, moved) }
    else if (side === 'stack-after') { moved.inline = false; items.splice(t + 1, 0, moved) }
    else { moved.inline = false; items.splice(t, 0, moved) }
    commit(items)
  }
  const reset = () => { setSelectedId(null); setSetting('statBlock', { ...STATBLOCK_DEFAULT, items: SB_DEFAULT_ITEMS.map(d => ({ ...d })) }) }

  const editApi: SbEditApi = { selectedId, onSelect: setSelectedId, onReorder, onPatch: patchItem, onDropMerge }

  const sel = selectedId ? sb.items.find(i => i.id === selectedId) ?? null : null
  const selIdx = sel ? sb.items.findIndex(i => i.id === sel.id) : -1
  const selMeta = sel ? SB_ITEM_META[sel.id] : null
  const selInlineCap = sel ? sbItemIsInline(sel) : false

  // The same-line GROUP the selected item belongs to — mirrors StatBlock's
  // line-grouping so we can expose a spacing slider when 2+ items share a line.
  // The gap is stored on the line's LEADER (its first item).
  const lineGroup = (() => {
    if (!sel) return null
    const lines: SbItem[][] = []
    for (const it of sb.items) {
      const prev = lines[lines.length - 1]
      const canJoin = !it.hidden && sbItemIsInline(it) && !!it.inline
        && prev && !prev[0].hidden && sbItemIsInline(prev[0])
      if (canJoin) prev.push(it); else lines.push([it])
    }
    return lines.find(g => g.some(i => i.id === sel.id)) ?? null
  })()
  const groupLeader = lineGroup && lineGroup.length > 1 ? lineGroup[0] : null
  const groupGap = groupLeader ? (groupLeader.gapPx ?? lineGapPx(sb.sameLineGap, 'merged')) : 0
  const gapPresets: [string, number][] = [['Tight', 8], ['Normal', 40], ['Wide', 72]]

  // Section-specific inline controls (cube width / strikes-per-line / spell-rank
  // order + spacing) — shown in the per-row panel when their section is picked.
  const isCubeStyle = !!sel && (
    (sel.id === 'perception' && sel.style === 'box') ||
    (sel.id === 'abilities' && sel.style === 'boxes') ||
    (sel.id === 'hp' && sel.style === 'box') ||
    (sel.id === 'defense' && sel.style !== 'inline')
  )
  const cubeWidth = sel?.cubeWidth ?? 92
  const cubePresets: [string, number][] = [['Compact', 76], ['Standard', 92], ['Wide', 120]]
  const isAttacks = sel?.id === 'attacks'
  const attackPerLine = sel?.perLine ?? sb.attacksPerLine
  const attackGap = sel?.gapPx ?? lineGapPx(sb.sameLineGap, 'attacks')
  const isSpells = sel?.id === 'spells'
  const spellGapVal = sel?.gapPx ?? lineGapPx(sb.sameLineGap, 'spells')
  // Shared styling for the section control blocks below.
  const ctrlSection: React.CSSProperties = { width: '100%', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, paddingTop: 9, borderTop: 'var(--app-bw) solid var(--accent-line)' }
  const ctrlHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }
  const ctrlVal: React.CSSProperties = { color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }
  const ctrlSlider: React.CSSProperties = { width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }

  const tbBtn = (active: boolean, disabled = false): React.CSSProperties => ({
    fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600,
    padding: '4px 9px', cursor: disabled ? 'default' : 'pointer', borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--accent-soft)' : 'transparent',
    border: 'var(--app-bw) solid', borderColor: active ? 'var(--accent)' : 'var(--border-strong)',
    color: active ? 'var(--text)' : 'var(--text-muted)', opacity: disabled ? 0.4 : 1,
  })

  return (
    <div>
      <div style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 12 }}>
        This is a live example with every section filled in. <b style={{ color: 'var(--text)' }}>Drag any row</b> to reorder it, or drop it onto the
        <b style={{ color: 'var(--text)' }}> right side</b> of another text row to share a line. <b style={{ color: 'var(--text)' }}>Click a row</b> to restyle, hide, or move it from the panel on the right. Your real stat blocks follow these choices.
      </div>

      {/* Two panes: the live editor on the left, all controls on the right so you
          see each setting act on the example as you change it. */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* LEFT — the live, editable example (sticky so it stays in view). */}
        <div style={{ flex: '1 1 0', minWidth: 0, position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
          <div style={{ border: 'var(--app-bw) solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', maxHeight: '70vh', overflowY: 'auto', background: 'var(--bg-panel)' }}>
            <StatBlock combatant={SAMPLE_COMBATANT} edit={editApi} />
          </div>
        </div>

        {/* RIGHT — selected-row actions + global controls. */}
        <div style={{ flex: '0 0 332px', width: 332, display: 'flex', flexDirection: 'column' }}>
          {/* Per-row toolbar — what's selected in the example. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
            minHeight: 34, padding: '9px 11px',
            background: sel ? 'var(--accent-soft)' : 'var(--bg-elevated)',
            border: 'var(--app-bw) solid', borderColor: sel ? 'var(--accent-line)' : 'var(--border-strong)', borderRadius: 'var(--radius)',
          }}>
            {sel ? (
              <>
                <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 700, color: 'var(--text)', width: '100%' }}>{selMeta!.label}</span>
                {selMeta!.styles && (
                  <div style={{ display: 'inline-flex', border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    {selMeta!.styles.map(s => {
                      const on = (sel.style ?? selMeta!.styles![0].id) === s.id
                      return (
                        <button key={s.id} onClick={() => patchItem(sel.id, { style: s.id })}
                          style={{ fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600, padding: '4px 9px', border: 'none', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--bg-panel)', color: on ? 'var(--on-accent, #fff)' : 'var(--text-muted)' }}>{s.label}</button>
                      )
                    })}
                  </div>
                )}
                {selInlineCap && selIdx > 0 && (
                  <button onClick={() => patchItem(sel.id, { inline: !sel.inline })} style={tbBtn(!!sel.inline)}
                    title={sel.inline ? 'Move back to its own line' : 'Merge onto the row above'}>{sel.inline ? '⤓ Own line' : '⤶ Same line'}</button>
                )}
                {selMeta!.canHide && (
                  <button onClick={() => patchItem(sel.id, { hidden: !sel.hidden })} style={tbBtn(false)}>{sel.hidden ? '🚫 Hidden' : 'Hide'}</button>
                )}
                <button onClick={() => onReorder(selIdx, selIdx - 1)} disabled={selIdx <= 0} style={tbBtn(false, selIdx <= 0)} title="Move up">↑</button>
                <button onClick={() => onReorder(selIdx, selIdx + 1)} disabled={selIdx >= sb.items.length - 1} style={tbBtn(false, selIdx >= sb.items.length - 1)} title="Move down">↓</button>
                <button onClick={() => setSelectedId(null)} style={{ ...tbBtn(false), marginLeft: 'auto' }} title="Deselect">✕</button>

                {/* Per-line spacing — shown only when the selected row shares a line
                    with others. Drag the slider to set the exact distance between
                    the items on this one line; it overrides the global setting and
                    still collapses (wraps) when a real stat block gets too narrow. */}
                {groupLeader && (
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, paddingTop: 9, borderTop: 'var(--app-bw) solid var(--accent-line)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                      <span>Distance between items on this line</span>
                      <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{groupGap}px</span>
                    </div>
                    <input type="range" min={0} max={120} step={2} value={groupGap}
                      onChange={ev => patchItem(groupLeader.id, { gapPx: Number(ev.target.value) })}
                      style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      {gapPresets.map(([lbl, val]) => (
                        <button key={lbl} onClick={() => patchItem(groupLeader.id, { gapPx: val })}
                          style={{ ...tbBtn(groupLeader.gapPx === val), padding: '3px 8px', fontSize: 10 }}>{lbl}</button>
                      ))}
                      <button onClick={() => patchItem(groupLeader.id, { gapPx: undefined })}
                        style={{ ...tbBtn(groupLeader.gapPx === undefined), padding: '3px 8px', fontSize: 10, marginLeft: 'auto' }}
                        title="Follow the global “Same-line spacing” below">Global</button>
                    </div>
                  </div>
                )}

                {/* Cube box width — for the cube/box-styled rows (Defense, Ability
                    scores, Perception cube, HP cube). Sets a fixed width per box;
                    boxes wrap to a new row when a real stat block gets too narrow. */}
                {isCubeStyle && (
                  <div style={ctrlSection}>
                    <div style={ctrlHead}>
                      <span>Cube box width</span>
                      <span style={ctrlVal}>{sel.cubeWidth != null ? `${sel.cubeWidth}px` : 'auto'}</span>
                    </div>
                    <input type="range" min={60} max={200} step={2} value={cubeWidth}
                      onChange={ev => patchItem(sel.id, { cubeWidth: Number(ev.target.value) })}
                      style={ctrlSlider} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      {cubePresets.map(([lbl, val]) => (
                        <button key={lbl} onClick={() => patchItem(sel.id, { cubeWidth: val })}
                          style={{ ...tbBtn(sel.cubeWidth === val), padding: '3px 8px', fontSize: 10 }}>{lbl}</button>
                      ))}
                      <button onClick={() => patchItem(sel.id, { cubeWidth: undefined })}
                        style={{ ...tbBtn(sel.cubeWidth === undefined), padding: '3px 8px', fontSize: 10, marginLeft: 'auto' }}
                        title="Auto-size cubes to fill the row">Auto</button>
                    </div>
                  </div>
                )}

                {/* Strikes per line — replaces the global dropdown when the
                    Attacks row is selected. Distance applies once 2+ share a row. */}
                {isAttacks && (
                  <div style={ctrlSection}>
                    <div style={{ ...ctrlHead, justifyContent: 'flex-start', gap: 8 }}>
                      <span>Strikes per line</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[1, 2, 3, 4].map(n => (
                        <button key={n} onClick={() => patchItem('attacks', { perLine: n })}
                          style={{ ...tbBtn(attackPerLine === n), padding: '3px 11px', fontSize: 11 }}>{n}</button>
                      ))}
                      <button onClick={() => patchItem('attacks', { perLine: undefined })}
                        style={{ ...tbBtn(sel.perLine === undefined), padding: '3px 8px', fontSize: 10, marginLeft: 'auto' }}
                        title="Follow the global “Attacks per line”">Global</button>
                    </div>
                    {attackPerLine > 1 && (
                      <>
                        <div style={ctrlHead}>
                          <span>Distance between strikes</span>
                          <span style={ctrlVal}>{attackGap}px</span>
                        </div>
                        <input type="range" min={0} max={80} step={2} value={attackGap}
                          onChange={ev => patchItem('attacks', { gapPx: Number(ev.target.value) })}
                          style={ctrlSlider} />
                      </>
                    )}
                  </div>
                )}

                {/* Spell ranks — order (cantrips on top vs highest first) and the
                    distance between ranks (visible in the “Packed” spell layout). */}
                {isSpells && (
                  <div style={ctrlSection}>
                    <div style={{ ...ctrlHead, justifyContent: 'flex-start' }}>
                      <span>Spell rank order</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => patchItem('spells', { spellRankOrder: 'asc' })}
                        style={{ ...tbBtn((sel.spellRankOrder ?? 'asc') === 'asc'), padding: '3px 9px', fontSize: 10 }}>Cantrips on top</button>
                      <button onClick={() => patchItem('spells', { spellRankOrder: 'desc' })}
                        style={{ ...tbBtn(sel.spellRankOrder === 'desc'), padding: '3px 9px', fontSize: 10 }}>Highest rank first</button>
                    </div>
                    <div style={ctrlHead}>
                      <span>Distance between ranks</span>
                      <span style={ctrlVal}>{spellGapVal}px</span>
                    </div>
                    <input type="range" min={0} max={80} step={2} value={spellGapVal}
                      onChange={ev => patchItem('spells', { gapPx: Number(ev.target.value) })}
                      style={ctrlSlider} />
                    <button onClick={() => patchItem('spells', { gapPx: undefined })}
                      style={{ ...tbBtn(sel.gapPx === undefined), padding: '3px 8px', fontSize: 10, alignSelf: 'flex-start' }}
                      title="Follow the global spacing">Reset spacing</button>
                  </div>
                )}
              </>
            ) : (
              <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>Click a row in the example to restyle, hide, merge, or move it.</span>
            )}
          </div>

          <ToggleRow
            label="Section dividers"
            hint="Show the gold “Defense / Attacks / Spellcasting / Abilities” header bars between sections."
            checked={sb.showSectionHeaders}
            onChange={v => setSetting('statBlock', { ...sb, showSectionHeaders: v })}
          />
          <ToggleRow
            label="Compact spacing"
            hint="Tighten the vertical spacing between rows so more fits on screen."
            checked={sb.compact}
            onChange={v => setSetting('statBlock', { ...sb, compact: v })}
          />
          <OptionPicker
            label="Same-line style"
            hint="How items sharing a line look: spaced apart, split by a divider, or each in its own box."
            value={sb.mergeStyle}
            options={SB_MERGE_STYLES}
            onChange={v => setSetting('statBlock', { ...sb, mergeStyle: v })}
          />
          <OptionPicker
            label="Same-line spacing"
            hint="The default gap between things sharing a line — merged rows, Strikes, and spell ranks all use this. Tighter packs more across; looser spreads them out. Tip: click a shared line in the example to fine-tune just that one line."
            value={sb.sameLineGap}
            options={SB_LINE_GAPS}
            onChange={v => setSetting('statBlock', { ...sb, sameLineGap: v })}
          />
          <OptionPicker
            label="Attacks per line"
            hint="The default number of Strikes per row. Pack 2–3 across to save vertical space. Tip: click the Attacks row in the example to set its count (and spacing) on its own."
            value={String(sb.attacksPerLine)}
            options={SB_ATTACK_COLS.map(c => ({ id: String(c.id), label: c.label }))}
            onChange={v => setSetting('statBlock', { ...sb, attacksPerLine: Number(v) })}
          />
          <OptionPicker
            label="Spell rank layout"
            hint="“Packed” fits as many spell ranks per line as fit; “Rows” puts each rank on its own line."
            value={spellLayout}
            options={SPELL_LAYOUTS}
            onChange={v => setSetting('spellLayout', v as SpellLayout)}
          />
          <OptionPicker
            label="Spell slot indicator"
            hint="Shape used for remaining spell slots, per-spell uses, and focus points. Click a pip to spend it; click a spent pip to refund."
            value={spellIndicator}
            options={SPELL_INDICATORS}
            onChange={v => setSetting('spellIndicator', v as SpellIndicator)}
            sample={id => <SpellPips total={2} used={1} indicator={id as SpellIndicator} lock />}
          />

          <button onClick={reset}
            style={{
              marginTop: 14, fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 600,
              padding: '7px 12px', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
              background: 'transparent', border: 'var(--app-bw) solid var(--border-strong)', color: 'var(--text-muted)',
            }}>↺ Reset to default layout</button>
        </div>
      </div>
    </div>
  )
}

export function TimerSection() {
  const enabled = useSettingsStore(s => s.turnTimerEnabled)
  const setSetting = useSettingsStore(s => s.setSetting)
  const dmAvg = useDmAverageStore(s => s.avgSeconds)
  const dmCount = useDmAverageStore(s => s.turnCount)
  const dmHistory = useDmAverageStore(s => s.history)
  const resetDm = useDmAverageStore(s => s.reset)
  const [confirmReset, setConfirmReset] = useState(false)
  const [showDmGraph, setShowDmGraph] = useState(false)

  return (
    <div>
      <ToggleRow
        label="Enable turn timer"
        hint="Show a timer chip in the top bar that records how long each turn takes. Starts when combat begins, splits at each turn, and lets you review per-turn times, player averages, and a universal DM average."
        checked={enabled}
        onChange={v => setSetting('turnTimerEnabled', v)}
      />

      <div className="pf-label" style={{ marginTop: 18, marginBottom: 8 }}>DM Average (all parties)</div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 14px',
        background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border)',
        borderRadius: 'var(--radius-sm)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {dmCount > 0 ? (
            <>
              <button
                onClick={() => setShowDmGraph(true)}
                title="Click for the DM turn-time timeline"
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 20, color: 'var(--linked)', fontWeight: 600,
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                ⏱ {formatTurnTime(dmAvg)}
              </button>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                averaged over {dmCount} saved turn{dmCount === 1 ? '' : 's'}, shared across every party. Click the time for the timeline.
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-faded)', fontStyle: 'italic' }}>
              No DM turns saved yet. Run combat with the timer on, then press "Save to Averages".
            </div>
          )}
        </div>
        {dmCount > 0 && (
          confirmReset ? (
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => { resetDm(); setConfirmReset(false) }}
                style={{ background: 'var(--danger)', color: 'var(--text-on-danger)', border: 'var(--app-bw) solid var(--danger)', borderRadius: 'var(--radius-sm)', padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                Reset
              </button>
              <button onClick={() => setConfirmReset(false)}
                className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '4px 10px' }}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmReset(true)}
              className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '4px 10px', flexShrink: 0 }}>
              Reset
            </button>
          )
        )}
      </div>

      {showDmGraph && (
        <TurnTimeline
          player={{ name: 'DM', turnHistory: dmHistory, turnAvgSeconds: dmAvg, turnCount: dmCount }}
          onClose={() => setShowDmGraph(false)}
        />
      )}
    </div>
  )
}

export function PlayersSection() {
  const pcDetail = useSettingsStore(s => s.pcDetail)
  const setSetting = useSettingsStore(s => s.setSetting)
  return (
    <div>
      <div className="pf-label" style={{ marginBottom: 8, marginTop: 4 }}>Detail kept per player character</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 14 }}>
        How much of each PC's PF2e sheet shows on the party page. This is the default for every party;
        each party can override it from its own page. Hiding a section never deletes what you've entered.
      </div>
      <PcDetailControls config={pcDetail} onChange={cfg => setSetting('pcDetail', cfg)} />
    </div>
  )
}

function DangerSection({ onUninstall }: { onUninstall: () => void }) {
  return (
    <div style={{
      border: 'var(--app-bw) solid var(--danger)',
      borderRadius: 'var(--radius-sm)',
      padding: '12px 14px',
      background: 'color-mix(in srgb, var(--danger) 4%, transparent)',
      display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600,
          color: 'var(--text)', marginBottom: 2,
        }}>Uninstall the app</div>
        <div style={{
          fontFamily: 'var(--font-ui)', fontSize: 11.5,
          color: 'var(--text-muted)', lineHeight: 1.5,
        }}>
          Removes the app files, your saved parties and encounters, the current tracker, and all settings. This cannot be undone.
        </div>
      </div>
      <button
        onClick={onUninstall}
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: 'var(--app-bw) solid var(--danger)',
          color: 'var(--danger)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 12px',
          fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 12,
          cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--danger)'
          e.currentTarget.style.color = 'var(--text-on-danger)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--danger)'
        }}
      ><TrashIcon size={12} /> Uninstall</button>
    </div>
  )
}

// ── Sources (book) toggles ────────────────────────────────────────────────
// Turn whole books off so their stat blocks, spells, and items vanish from
// every browse/search/filter surface. Built from the loaded data, grouped and
// searchable. Content without a source (rules, hazards, generic actions) can't
// be filtered this way — noted in the footer.
export function SourcesSection() {
  const data = useGameData()
  const disabled = useSourcesStore(s => s.disabled)
  const toggle = useSourcesStore(s => s.toggle)
  const enable = useSourcesStore(s => s.enable)
  const disable = useSourcesStore(s => s.disable)
  const enableAll = useSourcesStore(s => s.enableAll)
  const disabledSet = useMemo(() => new Set(disabled), [disabled])
  const [query, setQuery] = useState('')
  // Collapse every group except the most-used one — 170+ books is a lot to show
  // at once, but a fully-collapsed page reads as empty. Searching opens them all.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(BOOK_GROUP_ORDER.filter(g => g !== 'Core Rulebooks')))

  // book name → how many pieces of content (creatures + spells + items +
  // rituals) it contributes. Memoised on the loaded data (stable post-load).
  const books = useMemo(() => {
    const counts = new Map<string, number>()
    const bump = (src?: string) => { const b = cleanSource(src); if (b) counts.set(b, (counts.get(b) || 0) + 1) }
    for (const v of data.creatures.values()) bump(v.source)
    for (const v of data.spells.values()) bump(v.source)
    for (const v of data.equipment.values()) bump(v.source)
    for (const v of data.rituals.values()) bump(v.source)
    for (const v of data.rules.values()) bump(v.source)
    return counts
  }, [data])

  const grouped = useMemo(() => {
    const g = new Map<BookGroup, { name: string; count: number }[]>()
    for (const [name, count] of books) {
      const grp = categorizeBook(name)
      let list = g.get(grp); if (!list) { list = []; g.set(grp, list) }
      list.push({ name, count })
    }
    for (const list of g.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return g
  }, [books])

  const totalBooks = books.size
  const offCount = [...books.keys()].filter(b => disabledSet.has(b)).length
  const onCount = totalBooks - offCount
  const q = query.trim().toLowerCase()

  const toggleCollapse = (grp: string) =>
    setCollapsed(prev => { const n = new Set(prev); n.has(grp) ? n.delete(grp) : n.add(grp); return n })

  if (totalBooks === 0) {
    return <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)', padding: '20px 0' }}>Loading the source list…</div>
  }

  const chk: React.CSSProperties = {
    width: 17, height: 17, flexShrink: 0, borderRadius: 4, border: '1.5px solid',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 800, lineHeight: 1,
  }
  const miniBtn = (): React.CSSProperties => ({
    fontFamily: 'var(--font-ui)', fontSize: 10.5, fontWeight: 600, padding: '3px 8px',
    cursor: 'pointer', borderRadius: 'var(--radius-sm)', background: 'transparent',
    border: 'var(--app-bw) solid var(--border-strong)', color: 'var(--text-muted)',
  })

  return (
    <div>
      <div style={{ fontFamily: 'var(--font-ui)', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 12 }}>
        Choose which books are active. Turning a book <b style={{ color: 'var(--text)' }}>off</b> hides all of its
        creatures, spells, items, and rules from the bestiary browser, the “Add combatant” picker, the global search,
        and the source filter — everywhere. Turn any book back on at any time; nothing is deleted.
      </div>

      {/* Search + global on/off + summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search books…"
          className="themed-placeholder"
          style={{
            flex: '1 1 200px', minWidth: 0, background: 'var(--bg-elevated)',
            border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 'var(--radius-sm)',
            padding: '7px 10px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-ui)', outline: 'none',
          }}
        />
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {onCount} / {totalBooks} on
        </span>
        <button onClick={enableAll} style={miniBtn()}>All on</button>
        <button onClick={() => disable([...books.keys()])} style={miniBtn()}>All off</button>
      </div>
      <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-faded)', marginTop: -4, marginBottom: 10 }}>
        Groups are collapsed — click a group to open it, or just start typing to find any book.
      </div>

      {/* Grouped book list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {BOOK_GROUP_ORDER.map(grp => {
          const all = grouped.get(grp)
          if (!all || all.length === 0) return null
          const list = q ? all.filter(b => b.name.toLowerCase().includes(q)) : all
          if (list.length === 0) return null
          const groupOn = list.filter(b => !disabledSet.has(b.name)).length
          const open = !collapsed.has(grp) || !!q
          return (
            <div key={grp} style={{ border: 'var(--app-bw) solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px',
                background: 'var(--bg-elevated)', cursor: q ? 'default' : 'pointer',
              }} onClick={() => { if (!q) toggleCollapse(grp) }}>
                <span style={{ color: 'var(--text-faded)', fontSize: 10, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>▶</span>
                <span style={{ flex: 1, fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 700, color: groupOn === 0 ? 'var(--text-faded)' : 'var(--text)' }}>{grp}</span>
                <span style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{groupOn}/{list.length} on</span>
                <button onClick={e => { e.stopPropagation(); enable(list.map(b => b.name)) }} style={miniBtn()}>On</button>
                <button onClick={e => { e.stopPropagation(); disable(list.map(b => b.name)) }} style={miniBtn()}>Off</button>
              </div>
              {open && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {list.map(b => {
                    const on = !disabledSet.has(b.name)
                    return (
                      <button key={b.name} onClick={() => toggle(b.name)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
                          background: 'transparent', border: 'none', borderTop: 'var(--app-bw) solid var(--border)',
                          cursor: 'pointer', textAlign: 'left', width: '100%',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                        <span style={{
                          ...chk,
                          borderColor: on ? 'var(--accent)' : 'var(--border-strong)',
                          background: on ? 'var(--accent)' : 'transparent',
                          color: on ? 'var(--on-accent, #fff)' : 'transparent',
                        }}>{on ? '✓' : ''}</span>
                        <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-ui)', fontSize: 12.5, color: on ? 'var(--text)' : 'var(--text-faded)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                        <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faded)' }}>{b.count}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11.5, color: 'var(--text-faded)', lineHeight: 1.55, marginTop: 14 }}>
        Counts show how many creatures (including hazards), spells, items, and rules each book contributes. Note:
        general reference entries that aren’t tied to a single book — conditions, traits, skills, and the action/ability
        glossary — stay available regardless of these toggles.
      </div>
    </div>
  )
}

// ── Main shell — sidebar + body ──────────────────────────────────────────
export function SettingsModal({ onClose }: Props) {
  const [section, setSection] = useState<SectionId>('appearance')
  const [showUninstall, setShowUninstall] = useState(false)

  const visibleSections = SECTIONS.filter(s => s.show())
  const activeLabel = visibleSections.find(s => s.id === section)?.label ?? 'Settings'

  return (
    <div className="modal-overlay" style={{ alignItems: 'flex-start', paddingTop: '5vh' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{
        padding: 0, overflow: 'hidden',
        maxWidth: section === 'statblock' ? 1300 : 820, width: '100%',
        // Anchored to the top (overlay paddingTop), so switching to a shorter
        // section never re-centres and shifts the header up or down.
        maxHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        transition: 'max-width 0.18s ease',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px',
          borderBottom: 'var(--app-bw) solid var(--border)',
          flexShrink: 0,
          background: 'linear-gradient(180deg, var(--bg-header-top), var(--bg-header-bottom))',
        }}>
          <h2 className="page-title-display" style={{
            fontSize: 20, fontWeight: 500, margin: 0,
            letterSpacing: '-0.015em', fontVariationSettings: '"opsz" 72',
          }}>Settings <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 14, marginLeft: 6 }}>· {activeLabel}</span></h2>
          <button className="ico-btn" style={{ width: 30, height: 30, fontSize: 16 }} onClick={onClose}>
            <XIcon size={16} />
          </button>
        </div>

        {/* Sidebar + body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Sidebar */}
          <div style={{
            width: 170, flexShrink: 0,
            background: 'rgba(0,0,0,0.18)',
            borderRight: 'var(--app-bw) solid var(--border)',
            padding: '14px 8px',
            display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            {visibleSections.map(s => {
              const active = s.id === section
              const isDanger = s.id === 'danger'
              return (
                <button key={s.id}
                  onClick={() => setSection(s.id)}
                  style={{
                    textAlign: 'left',
                    padding: '8px 12px',
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    border: 'var(--app-bw) solid',
                    borderColor: active ? 'var(--accent-line)' : 'transparent',
                    borderRadius: 'var(--radius-sm)',
                    color: active
                      ? (isDanger ? 'var(--danger)' : 'var(--accent)')
                      : (isDanger ? 'var(--danger)' : 'var(--text)'),
                    fontFamily: 'var(--font-ui)',
                    fontSize: 12.5, fontWeight: active ? 700 : 500,
                    letterSpacing: '0.02em',
                    cursor: 'pointer',
                    transition: 'background 0.12s, border-color 0.12s',
                  }}
                  onMouseEnter={e => {
                    if (!active) e.currentTarget.style.background = 'var(--bg-hover)'
                  }}
                  onMouseLeave={e => {
                    if (!active) e.currentTarget.style.background = 'transparent'
                  }}
                >{s.label}</button>
              )
            })}
          </div>

          {/* Body */}
          <div style={{
            flex: 1, minWidth: 0, padding: '18px 22px 22px',
            overflowY: 'auto',
          }}>
            {section === 'appearance' && <HHAppearance />}
            {section === 'display'    && <DisplaySection />}
            {section === 'statblock'  && <StatBlockSection />}
            {section === 'sources'    && <SourcesSection />}
            {section === 'timer'      && <TimerSection />}
            {section === 'players'    && <PlayersSection />}
            {section === 'conditions' && <ConditionsSection />}
            {section === 'encounter-tables' && <EncounterTablesSection />}
            {section === 'danger'     && <DangerSection onUninstall={() => setShowUninstall(true)} />}
          </div>
        </div>
      </div>
      {showUninstall && <UninstallConfirm onCancel={() => setShowUninstall(false)} />}
    </div>
  )
}
