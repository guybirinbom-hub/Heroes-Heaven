import { useState, useMemo } from 'react'
import { XIcon } from './Icons'
import { NumberInput } from './NumberInput'
import {
  STAT_MOD_GROUPS, STAT_MOD_LABELS, MOD_TYPES,
  type StatMods, type ModType,
} from '../utils/conditionEffects'
import {
  emptyCustomCondition,
  type CustomCondition,
} from '../store/customConditionsStore'

interface Props {
  /** Existing template to edit. If omitted a blank one is created. */
  editing?: CustomCondition
  /** Title shown at the top — defaults to "Advanced Custom Condition". */
  title?: string
  /** Persist the template to the user's library (always shown). */
  onSave: (c: CustomCondition) => void
  /** Optional — when present, an extra primary action saves AND applies the
   *  condition to the current combatant in one step. Hidden in editor-only
   *  contexts (e.g. opening from Settings). */
  onSaveAndApply?: (c: CustomCondition) => void
  onClose: () => void
}

// Numeric input that returns an integer (− allowed). Wraps NumberInput so the
// caller deals with `number | undefined`. Value 0 means "not set" — stored
// sparsely on the condition's mods map.
function ModStepper({ value, onChange }: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <NumberInput
      value={value}
      onChange={e => {
        const v = parseInt(e.target.value)
        onChange(isNaN(v) ? 0 : v)
      }}
      onStep={n => onChange(n)}
      className="input-dark input-mono"
      style={{ width: 64, fontSize: 12 }}
    />
  )
}

/**
 * Small live-preview of the badge the user is about to save — sits in the
 * footer so the user can see name + value + tinting react as they edit.
 */
function PreviewBadge({ c }: { c: CustomCondition }) {
  const bg = (c.bg ?? '#3a2f24') + '40'
  // Custom border colour keeps its alpha; the default tracks the theme's linked hue.
  const border = c.border ? c.border + '80' : 'color-mix(in srgb, var(--linked) 50%, transparent)'
  const label = c.name.trim() || 'Unnamed'
  const showVal = c.hasValue && c.maxValue >= 1
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '4px 10px',
      background: bg, border: `var(--app-bw) solid ${border}`, color: 'var(--text)',
      borderRadius: 'var(--radius-full)',
      fontSize: 12, fontStyle: 'italic',
      fontFamily: 'var(--font-ui)',
    }}>
      {label}{showVal && ` ${Math.min(c.maxValue, 2)}`}
      <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
        {c.isPermanent ? '∞' : `${c.defaultDuration}r`}
      </span>
    </span>
  )
}

export function AdvancedConditionEditor({
  editing, title, onSave, onSaveAndApply, onClose,
}: Props) {
  // Local working copy — committed to the store on save.
  const [draft, setDraft] = useState<CustomCondition>(() =>
    editing ? { ...editing, mods: { ...editing.mods } } : emptyCustomCondition()
  )

  // Helper to update a single field on the draft without breaking immer-ness.
  const patch = (p: Partial<CustomCondition>) =>
    setDraft(d => ({ ...d, ...p }))
  const patchMod = (key: keyof StatMods, v: number) =>
    setDraft(d => {
      const m = { ...d.mods }
      if (v === 0) delete m[key]
      else m[key] = v
      return { ...d, mods: m }
    })

  // Is this stat currently a conditional (situational) modifier?
  const isCond = (key: keyof StatMods) => !!draft.condMods?.[key]
  // The bonus/penalty type currently set for a stat (flat or conditional).
  const modTypeOf = (key: keyof StatMods): ModType =>
    draft.condMods?.[key] ? (draft.condMods[key]!.type ?? 'untyped')
      : (draft.modTypes?.[key] ?? 'untyped')
  // Flip a stat between always-on (mods) and conditional (condMods), carrying
  // its current value AND type across so the toggle never loses anything.
  const toggleCond = (key: keyof StatMods) =>
    setDraft(d => {
      const m = { ...d.mods }
      const mt = { ...(d.modTypes ?? {}) }
      const cm = { ...(d.condMods ?? {}) }
      if (cm[key]) {
        // conditional → always-on
        const { value, type } = cm[key]!
        delete cm[key]
        if (value !== 0) { m[key] = value; mt[key] = type } else { delete m[key]; delete mt[key] }
      } else {
        // always-on → conditional
        const value = m[key] ?? 0
        const type = mt[key] ?? 'untyped'
        delete m[key]; delete mt[key]
        cm[key] = { value, when: '', type }
      }
      return { ...d, mods: m, modTypes: mt, condMods: cm }
    })
  const patchCondValue = (key: keyof StatMods, v: number) =>
    setDraft(d => {
      const cm = { ...(d.condMods ?? {}) }
      cm[key] = { value: v, when: cm[key]?.when ?? '', type: cm[key]?.type ?? 'untyped' }
      return { ...d, condMods: cm }
    })
  const patchCondWhen = (key: keyof StatMods, when: string) =>
    setDraft(d => {
      const cm = { ...(d.condMods ?? {}) }
      cm[key] = { value: cm[key]?.value ?? 0, when, type: cm[key]?.type ?? 'untyped' }
      return { ...d, condMods: cm }
    })
  // Set the bonus/penalty type for a stat (routes to condMods or modTypes).
  const setModType = (key: keyof StatMods, type: ModType) =>
    setDraft(d => {
      if (d.condMods?.[key]) {
        const cm = { ...d.condMods }
        cm[key] = { ...cm[key]!, type }
        return { ...d, condMods: cm }
      }
      const mt = { ...(d.modTypes ?? {}) }
      mt[key] = type
      return { ...d, modTypes: mt }
    })

  const canSave = draft.name.trim().length > 0
  const activeModCount = useMemo(
    () => Object.values(draft.mods).filter(v => v && v !== 0).length
        + Object.keys(draft.condMods ?? {}).length,
    [draft.mods, draft.condMods],
  )

  const handleSave = () => {
    if (!canSave) return
    onSave({ ...draft, name: draft.name.trim() })
  }
  const handleSaveAndApply = () => {
    if (!canSave || !onSaveAndApply) return
    onSaveAndApply({ ...draft, name: draft.name.trim() })
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 10001 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{
        padding: 0, overflow: 'hidden',
        maxWidth: 700, width: '100%',
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 22px',
          borderBottom: 'var(--app-bw) solid var(--border)',
          flexShrink: 0,
          background: 'linear-gradient(180deg, var(--bg-header-top), var(--bg-header-bottom))',
        }}>
          <h2 className="page-title-display" style={{
            fontSize: 18, fontWeight: 500, margin: 0,
            letterSpacing: '-0.015em',
            fontVariationSettings: '"opsz" 72',
          }}>{title ?? 'Advanced Custom Condition'}</h2>
          <button className="ico-btn" style={{ width: 28, height: 28 }} onClick={onClose}>
            <XIcon size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{
          padding: '14px 18px 16px',
          overflowY: 'auto', flex: 1, minHeight: 0,
        }}>
          {/* Name + description */}
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <span className="pf-label" style={{ marginBottom: 0 }}>Name</span>
            <input
              autoFocus
              className="input-dark"
              placeholder="e.g. Cursed, Burning, Blessed"
              value={draft.name}
              onChange={e => patch({ name: e.target.value })}
              style={{ fontSize: 12.5, padding: '6px 10px' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
            <span className="pf-label" style={{ marginBottom: 0, paddingTop: 6 }}>Description</span>
            <textarea
              className="input-dark"
              placeholder="Optional — shown when hovering the badge"
              value={draft.description ?? ''}
              onChange={e => patch({ description: e.target.value })}
              rows={2}
              style={{ fontSize: 11.5, padding: '6px 10px', resize: 'vertical', minHeight: 44, fontFamily: 'var(--font-ui)' }}
            />
          </div>

          {/* Two-column area */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: 14,
            alignItems: 'flex-start',
          }}>
            {/* ── Behaviour panel ──────────────────────────────── */}
            <div style={{
              background: 'rgba(0,0,0,0.18)',
              border: 'var(--app-bw) solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div className="pf-label" style={{ marginBottom: 0 }}>Behaviour</div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox"
                  checked={draft.hasValue}
                  onChange={e => patch({ hasValue: e.target.checked })}
                  style={{ accentColor: 'var(--accent)' }} />
                Has value <span style={{ color: 'var(--text-faded)', fontSize: 10.5 }}>(e.g. "Cursed 2")</span>
              </label>
              {draft.hasValue && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 22 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)', flex: 1 }}>Max value</span>
                    <NumberInput min={1} max={99} value={draft.maxValue}
                      onChange={e => patch({ maxValue: Math.max(1, parseInt(e.target.value) || 1) })}
                      onStep={n => patch({ maxValue: Math.max(1, n) })}
                      className="input-dark input-mono"
                      style={{ width: 64, fontSize: 12 }}
                    />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', paddingLeft: 22 }}>
                    <input type="checkbox"
                      checked={draft.scalesByValue}
                      onChange={e => patch({ scalesByValue: e.target.checked })}
                      style={{ accentColor: 'var(--accent)' }} />
                    Mods scale by value
                  </label>
                </>
              )}

              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)', flex: 1 }}>Rounds</span>
                <NumberInput min={1} value={draft.defaultDuration}
                  onChange={e => patch({ defaultDuration: Math.max(1, parseInt(e.target.value) || 1) })}
                  onStep={n => patch({ defaultDuration: Math.max(1, n) })}
                  disabled={draft.isPermanent}
                  className="input-dark input-mono"
                  style={{ width: 64, fontSize: 12, opacity: draft.isPermanent ? 0.4 : 1 }}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox"
                  checked={draft.isPermanent}
                  onChange={e => patch({ isPermanent: e.target.checked })}
                  style={{ accentColor: 'var(--accent)' }} />
                Permanent (until removed)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox"
                  checked={draft.autoDecrement}
                  onChange={e => patch({ autoDecrement: e.target.checked })}
                  style={{ accentColor: 'var(--accent)' }} />
                Auto-decrement at end of turn
              </label>

              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

              {/* Optional tinting */}
              <div className="pf-label" style={{ marginBottom: 0, marginTop: 2 }}>Badge colour</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Tint
                  <input type="color"
                    value={draft.bg ?? '#3a2f24'}
                    onChange={e => patch({ bg: e.target.value })}
                    style={{ width: 28, height: 22, border: 'none', background: 'transparent', cursor: 'pointer' }}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Border
                  <input type="color"
                    value={draft.border ?? '#82a89a'}
                    onChange={e => patch({ border: e.target.value })}
                    style={{ width: 28, height: 22, border: 'none', background: 'transparent', cursor: 'pointer' }}
                  />
                </label>
                {(draft.bg || draft.border) && (
                  <button onClick={() => patch({ bg: undefined, border: undefined })}
                    className="btn btn-sm btn-secondary"
                    style={{ fontSize: 10.5, padding: '2px 8px' }}>Reset</button>
                )}
              </div>
            </div>

            {/* ── Stat effects panel (scrollable) ──────────────── */}
            <div style={{
              background: 'rgba(0,0,0,0.18)',
              border: 'var(--app-bw) solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 8,
              }}>
                <div className="pf-label" style={{ marginBottom: 0 }}>
                  Stat Effects {draft.hasValue && draft.scalesByValue && (
                    <span style={{ color: 'var(--text-faded)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                      (per value)
                    </span>
                  )}
                </div>
                {activeModCount > 0 && (
                  <button
                    onClick={() => setDraft(d => ({ ...d, mods: {}, modTypes: {}, condMods: {} }))}
                    className="btn btn-sm btn-secondary"
                    style={{ fontSize: 10, padding: '2px 8px' }}
                    title="Clear all stat effects"
                  >Clear ({activeModCount})</button>
                )}
              </div>

              {/* Scroll container */}
              <div style={{
                maxHeight: 360,
                overflowY: 'auto',
                paddingRight: 4,
                display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                {STAT_MOD_GROUPS.map(group => (
                  <div key={group.title}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                      color: 'var(--accent)', textTransform: 'uppercase',
                      paddingBottom: 4, marginBottom: 6,
                      borderBottom: 'var(--app-bw) solid var(--border)',
                    }}>{group.title}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {group.keys.map(k => {
                        const cond = isCond(k)
                        const v = cond ? (draft.condMods?.[k]?.value ?? 0) : (draft.mods[k] ?? 0)
                        const isSet = v !== 0 || cond
                        const curType = modTypeOf(k)
                        return (
                          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              gap: 8,
                            }}>
                              <label style={{
                                fontSize: 11.5,
                                color: isSet ? 'var(--text)' : 'var(--text-muted)',
                                fontWeight: isSet ? 600 : 400,
                              }}>{STAT_MOD_LABELS[k]}</label>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <ModStepper
                                  value={v}
                                  onChange={n => cond ? patchCondValue(k, n) : patchMod(k, n)}
                                />
                                {/* "*" toggle — converts this stat into a situational mod. */}
                                <button
                                  onClick={() => toggleCond(k)}
                                  title={cond
                                    ? 'Situational — applies only in the circumstance below. Click to make it always apply.'
                                    : 'Make this a situational modifier (e.g. "against fear")'}
                                  style={{
                                    width: 20, height: 20, padding: 0, cursor: 'pointer',
                                    borderRadius: 4, lineHeight: 1, fontSize: 14, fontWeight: 700,
                                    display: 'grid', placeItems: 'center',
                                    background: cond ? 'var(--accent)' : 'transparent',
                                    color: cond ? 'var(--text-on-accent)' : 'var(--text-faded)',
                                    border: `var(--app-bw) solid ${cond ? 'var(--accent)' : 'var(--border-strong)'}`,
                                  }}
                                >*</button>
                              </div>
                            </div>
                            {/* Bonus/penalty type — always available so the type can be
                                picked before (or without) entering a value. */}
                            <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
                              {MOD_TYPES.map(t => (
                                <button key={t}
                                  onClick={() => setModType(k, t)}
                                  title={`${t.charAt(0).toUpperCase() + t.slice(1)} ${v < 0 ? 'penalty' : 'bonus'}`}
                                  style={{
                                    flex: 1, padding: '2px 0', cursor: 'pointer',
                                    fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                                    textTransform: 'uppercase', borderRadius: 3,
                                    background: curType === t ? 'var(--accent-soft)' : 'transparent',
                                    color: curType === t ? 'var(--accent)' : 'var(--text-faded)',
                                    border: `var(--app-bw) solid ${curType === t ? 'var(--accent-line)' : 'var(--border)'}`,
                                  }}
                                >{t === 'untyped' ? 'Untyped' : t.slice(0, 4)}</button>
                              ))}
                            </div>
                            {cond && (
                              <input
                                value={draft.condMods?.[k]?.when ?? ''}
                                onChange={e => patchCondWhen(k, e.target.value)}
                                placeholder="when does this apply? e.g. against fear"
                                className="input-dark"
                                style={{ fontSize: 11, padding: '4px 8px', marginLeft: 4 }}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderTop: 'var(--app-bw) solid var(--border)', padding: '12px 18px',
          background: 'rgba(0,0,0,0.12)', flexShrink: 0,
        }}>
          <PreviewBadge c={draft} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-sm"
              onClick={handleSave}
              disabled={!canSave}
              style={{
                background: onSaveAndApply ? 'var(--bg-elevated)' : 'var(--accent)',
                color:      onSaveAndApply ? 'var(--text)'        : 'var(--text-on-accent)',
                border:     `var(--app-bw) solid ${onSaveAndApply ? 'var(--border-strong)' : 'var(--accent)'}`,
                opacity: canSave ? 1 : 0.45,
                cursor: canSave ? 'pointer' : 'not-allowed',
                fontSize: 12, fontWeight: 600, padding: '6px 14px',
              }}
            >{onSaveAndApply ? 'Save to Library' : 'Save Condition'}</button>
            {onSaveAndApply && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveAndApply}
                disabled={!canSave}
                style={{
                  opacity: canSave ? 1 : 0.45,
                  cursor: canSave ? 'pointer' : 'not-allowed',
                  fontSize: 12, fontWeight: 600, padding: '6px 14px',
                }}
              >Save & Apply</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
