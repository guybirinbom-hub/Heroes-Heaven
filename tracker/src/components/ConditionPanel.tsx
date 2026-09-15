import { useState, useEffect, useRef } from 'react'
import type { Combatant, AppliedCondition } from '../types/pf2e'
import { useCombatStore } from '../store/combatStore'
import { CONDITION_META, ALL_CONDITIONS } from '../utils/conditionEffects'
import type { ConditionMeta } from '../utils/conditionEffects'
import { useCustomConditionsStore, emptyCustomCondition, type CustomCondition } from '../store/customConditionsStore'
import { AdvancedConditionEditor } from './AdvancedConditionEditor'
import { Tooltip } from './Tooltip'
import { NumberInput } from './NumberInput'
import { TagRenderer } from './TagRenderer'
import { useWindowStore } from '../store/windowStore'
import { useGameData } from '../data/gameDataContext'

const STUNNED_SLIDER_MAX = 10

function sliderMax(meta: ConditionMeta | undefined): number {
  if (!meta?.hasValue) return 1
  if ((meta.maxValue ?? 0) >= 99) return STUNNED_SLIDER_MAX
  return meta.maxValue ?? 4
}

/**
 * A condition's text, framed. Owner ruling 2026-09-15: wherever a condition's text is shown, show
 * the FULL printed entry, not a summary — so the one-line `summary` from conditionEffects.ts is kept
 * as the first line and the loaded Archives entry (useGameData().conditions, already the complete
 * Player Core text) goes under it. The picker GRID stays compact; only the detail areas grew.
 */
function ConditionText({ name, summary, full }: { name: string; summary?: string; full?: string }) {
  return (
    <div style={{
      background: 'var(--bg-panel)',
      border: 'var(--app-bw) solid var(--border-strong)',
      color: 'var(--text)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-md)',
      padding: '12px 14px',
      maxWidth: 400, minWidth: 220, maxHeight: 380,
      overflowY: 'auto',
      fontFamily: 'var(--font-ui)',
    }}>
      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 600,
        fontSize: 14, color: 'var(--accent)', marginBottom: 8,
        paddingBottom: 6, borderBottom: 'var(--app-bw) solid var(--border)',
      }}>{name}</div>
      {summary && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: full ? 8 : 0 }}>
          {summary}
        </div>
      )}
      {full && (
        <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
          <TagRenderer text={full} />
        </div>
      )}
    </div>
  )
}

function ConditionBadge({ cond, combatantId }: { cond: AppliedCondition; combatantId: string }) {
  const { removeCondition, updateConditionValue } = useCombatStore()
  const openWin = useWindowStore(s => s.open)
  const { conditions } = useGameData()
  const meta = CONDITION_META[cond.name.toLowerCase()]
  // A canonical PF2e condition (in the data) can open its full AoN description.
  const canOpen = conditions.has(cond.name.toLowerCase())
  // Per-condition tint at low alpha for identity, plus a border in the same
  // hue. The TEXT colour is theme-driven (`var(--text)`) so badges stay
  // readable on both dark and light themes — the previous code used the
  // condition's hardcoded light-grey `fg` which became invisible on the
  // light parchment of Verdant Grove.
  const isCustom = !meta
  const bg = (meta?.bg ?? '#3a2f24') + '40'           // ~25% alpha
  // Custom border keeps its alpha; the default tracks the theme's linked hue.
  const border = meta?.border ? meta.border + '80' : 'color-mix(in srgb, var(--linked) 50%, transparent)'
  const max = sliderMax(meta)

  // Hover content: a custom entry's own description (custom conditions and ability cooldowns), else
  // the built-in's one-line summary FOLLOWED BY its full printed entry. Hovering a built-in badge
  // used to show the summary alone, so the only way to read the rules was to click through to the
  // floating window. Both get the same framed box (React-element content otherwise inherits the
  // transparent "bare" tooltip mode).
  const printed = cond.description ?? conditions.get(cond.name.toLowerCase())
  const tooltipContent: string | React.ReactNode =
    printed || meta?.summary
      ? <ConditionText name={cond.name} summary={cond.description ? undefined : meta?.summary} full={printed} />
      : ''

  return (
    <div className="flex items-center gap-1 group" style={{ fontSize: 12 }}>
      <Tooltip content={tooltipContent}>
        <span className="condition-badge"
          onClick={canOpen ? e => { e.stopPropagation(); openWin('condition', cond.name.toLowerCase(), cond.name, e.clientX, e.clientY, { noCascade: true }) } : undefined}
          title={canOpen ? 'Click for the full description' : undefined}
          style={{
            background: bg, color: 'var(--text)', borderColor: border,
            cursor: canOpen ? 'pointer' : undefined,
            // Custom conditions get an accent dot prefix so they're easy to
            // distinguish at a glance from canonical PF2e ones.
            ...(isCustom ? { fontStyle: 'italic' } : null),
          }}>
          {cond.name}{cond.value !== undefined && ` ${cond.value}`}
          {cond.pdAmount && <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{' '}{cond.pdAmount}{cond.pdType ? ` ${cond.pdType}` : ''}</span>}
        </span>
      </Tooltip>
      {meta?.hasValue && cond.value !== undefined && (
        <div className="flex items-center gap-0.5">
          <button className="w-4 h-4 flex items-center justify-center rounded font-bold text-xs"
            style={{ background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border-strong)', color: 'var(--text)', cursor: 'pointer' }}
            onClick={() => {
              const v = Math.max(0, (cond.value ?? 1) - 1)
              if (v === 0) removeCondition(combatantId, cond.id)
              else updateConditionValue(combatantId, cond.id, v)
            }}>−</button>
          <button className="w-4 h-4 flex items-center justify-center rounded font-bold text-xs"
            style={{ background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border-strong)', color: 'var(--text)', cursor: 'pointer' }}
            onClick={() => updateConditionValue(combatantId, cond.id, Math.min(max, (cond.value ?? 1) + 1))}>+</button>
        </div>
      )}
      {/* Auto-decrementing conditions normally show no duration (the value IS the clock), but one
       * pinned "until removed" still needs the ∞ so you can tell it won't tick down. */}
      {(!meta?.autoDecrement || cond.isPermanent) && (
        <span style={{ color: 'var(--accent)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
          {cond.isPermanent ? '∞' : `${cond.duration ?? 0}r`}
        </span>
      )}
      <button className="opacity-0 group-hover:opacity-100 font-bold ml-0.5"
        style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
        onClick={() => removeCondition(combatantId, cond.id)} title="Remove">×</button>
    </div>
  )
}

interface PopupProps {
  combatant: Combatant
  anchorEl: HTMLElement
  onClose: () => void
}

// Sentinel key used for the "Custom condition" picker row. Not a real PF2e
// condition — when this is selected we show a name input instead of the value
// / slider UI.
const CUSTOM_KEY = '__custom__'

// Sentinel key for the "+ Advanced" tile — opens the AdvancedConditionEditor.
const ADVANCED_KEY = '__advanced__'
// Prefix used to mark the `selected` state as "a saved custom condition with
// this id". Lets us reuse the same string-keyed picker for built-ins +
// custom-library entries without juggling parallel state.
const SAVED_PREFIX = 'saved::'

function AddConditionPopup({ combatant, anchorEl, onClose }: PopupProps) {
  const { addCondition } = useCombatStore()
  // Who the duration's clock belongs to. Player Core p. 426: a duration in rounds "decreases by 1
  // at the start of each turn of the creature that created the effect", so the acting creature is
  // offered as the default. Empty = no source = the other printed family, "until the end of the
  // target's next turn", which ticks at the end of THIS combatant's own turn.
  const combatants = useCombatStore(s => s.combatants)
  const activeIndex = useCombatStore(s => s.activeIndex)
  const inCombat = useCombatStore(s => s.inCombat)
  const acting = inCombat ? combatants[activeIndex] : undefined
  const [source, setSource] = useState<string>(() => (acting && acting.id !== combatant.id ? acting.id : ''))
  const src = source || undefined
  const customLibrary = useCustomConditionsStore(s => s.conditions)
  const upsertCustom = useCustomConditionsStore(s => s.upsert)
  // The loaded Archives entries — read for the detail panel below, so the GM sees the whole rule
  // before applying it instead of the 12-word summary the tile's title attribute carries.
  const { conditions: conditionText } = useGameData()
  const ref = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState('')
  const [value, setValue] = useState(1)
  const [duration, setDuration] = useState(1)
  const [isPermanent, setIsPermanent] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [advOpen, setAdvOpen] = useState(false)
  // Persistent-damage extras (only shown when that condition is picked).
  const [pdAmount, setPdAmount] = useState('')
  const [pdType, setPdType] = useState('')

  const isCustom = selected === CUSTOM_KEY
  const isPd = selected === 'persistent damage'
  // Resolve a saved custom-library template if the user picked one. Lets the
  // detail form below render value/duration/permanent in the same shape as
  // built-in conditions.
  const savedId = selected.startsWith(SAVED_PREFIX) ? selected.slice(SAVED_PREFIX.length) : null
  const savedTpl: CustomCondition | undefined = savedId
    ? customLibrary.find(c => c.id === savedId)
    : undefined
  const meta = (!isCustom && selected && !savedTpl) ? CONDITION_META[selected] : null
  // Synthesise a ConditionMeta for saved templates so the existing
  // value-slider/auto-decrement logic just works.
  const effectiveMeta: ConditionMeta | undefined = savedTpl ? {
    name: savedTpl.name,
    hasValue: savedTpl.hasValue,
    maxValue: savedTpl.maxValue,
    autoDecrement: savedTpl.autoDecrement,
    bg: savedTpl.bg ?? '#3a2f24', fg: '#f0e6d6', border: savedTpl.border ?? '#82a89a',
    summary: savedTpl.description ?? '',
  } : (meta ?? undefined)
  const max = sliderMax(effectiveMeta)

  const rect = anchorEl.getBoundingClientRect()
  const top = rect.bottom + 6
  const left = rect.left

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          !anchorEl.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [anchorEl, onClose])

  const handleSelect = (name: string) => {
    if (selected === name) return
    setSelected(name); setValue(1)
    if (name === CUSTOM_KEY) { setCustomName(''); setCustomDescription('') }
    if (name === ADVANCED_KEY) { setAdvOpen(true); return }
    // When picking a saved template, prime value/duration from its defaults.
    if (name.startsWith(SAVED_PREFIX)) {
      const tpl = customLibrary.find(c => SAVED_PREFIX + c.id === name)
      if (tpl) {
        setValue(1)
        setDuration(tpl.defaultDuration)
        setIsPermanent(tpl.isPermanent)
      }
    }
  }

  // Apply a saved template to the combatant — pulls all the mod data off
  // the library entry so computeConditionMods can use it without a lookup.
  const applyFromTemplate = (tpl: CustomCondition, opts: { value?: number; duration?: number; isPermanent?: boolean }) => {
    addCondition(combatant.id, {
      name: tpl.name,
      value: tpl.hasValue ? (opts.value ?? 1) : undefined,
      duration: (opts.isPermanent ?? tpl.isPermanent) ? undefined : (opts.duration ?? tpl.defaultDuration),
      source: src,
      isPermanent: opts.isPermanent ?? tpl.isPermanent,
      description: tpl.description?.trim() || undefined,
      mods: Object.keys(tpl.mods).length ? tpl.mods : undefined,
      modTypes: tpl.modTypes && Object.keys(tpl.modTypes).length ? tpl.modTypes : undefined,
      condMods: tpl.condMods && Object.keys(tpl.condMods).length ? tpl.condMods : undefined,
      scalesByValue: tpl.scalesByValue,
      autoDecrement: tpl.autoDecrement,
      maxValue: tpl.hasValue ? tpl.maxValue : undefined,
      bg: tpl.bg, border: tpl.border,
    })
  }

  const handleApply = () => {
    if (!selected) return
    if (isCustom) {
      const name = customName.trim()
      if (!name) return
      addCondition(combatant.id, {
        name,
        duration: isPermanent ? undefined : duration,
        source: src,
        isPermanent,
        description: customDescription.trim() || undefined,
      })
    } else if (savedTpl) {
      applyFromTemplate(savedTpl, { value, duration, isPermanent })
    } else if (isPd) {
      if (!pdAmount.trim()) return
      addCondition(combatant.id, {
        name: 'persistent damage',
        pdAmount: pdAmount.trim(),
        pdType: pdType.trim() || undefined,
        duration: isPermanent ? undefined : duration,
        source: src,
        isPermanent,
      })
    } else {
      addCondition(combatant.id, {
        name: selected,
        value: meta?.hasValue ? value : undefined,
        duration: isPermanent ? undefined : duration,
        source: src,
        isPermanent,
      })
    }
    onClose()
  }

  const filtered = ALL_CONDITIONS.filter(c =>
    !search || CONDITION_META[c].name.toLowerCase().includes(search.toLowerCase())
  )
  // Saved library entries filtered by the same search box.
  const filteredSaved = customLibrary.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  )
  // The "+ Custom" tile is always offered when the search is empty or
  // matches "custom" / "advanced". (Advanced lives as a button inside the
  // Custom form below, not as a separate tile.)
  const showCustomTile = !search ||
    'custom'.includes(search.toLowerCase()) ||
    'advanced'.includes(search.toLowerCase())

  return (
    <div ref={ref} style={{
      position: 'fixed', top, left, zIndex: 9999,
      width: 320,
      background: 'var(--bg-panel)',
      border: 'var(--app-bw) solid var(--border-strong)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-lg)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 14px 10px',
        borderBottom: 'var(--app-bw) solid var(--border)',
        background: 'linear-gradient(180deg, var(--bg-header-top), var(--bg-header-bottom))',
      }}>
        <input autoFocus
          placeholder="Search conditions…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input-dark"
          style={{ width: '100%', fontSize: 12.5, padding: '5px 10px' }}
        />
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 4, padding: '10px 12px',
        maxHeight: 200, overflowY: 'auto',
      }}>
        {showCustomTile && (
          <button onClick={() => handleSelect(CUSTOM_KEY)}
            style={{
              background: isCustom ? 'var(--accent-soft)' : 'color-mix(in srgb, var(--accent) 8%, transparent)',
              border: `1px dashed ${isCustom ? 'var(--accent)' : 'var(--accent-line)'}`,
              borderRadius: 'var(--radius-sm)',
              color: 'var(--accent)',
              fontFamily: 'var(--font-ui)',
              fontSize: 11, padding: '5px 8px',
              cursor: 'pointer', textAlign: 'center',
              transition: 'all 0.12s',
              fontWeight: isCustom ? 700 : 600,
              letterSpacing: '0.04em',
            }}
            title="Add a quick custom condition (name + notes + duration)"
          >+ Custom</button>
        )}
        {/* Saved library entries — full-width section header + tiles. */}
        {filteredSaved.length > 0 && (
          <>
            <div style={{
              gridColumn: 'span 3',
              fontSize: 9.5, fontWeight: 700,
              letterSpacing: '0.10em', textTransform: 'uppercase',
              color: 'var(--accent)',
              padding: '4px 2px 2px',
              borderTop: 'var(--app-bw) solid var(--border)',
              marginTop: 2,
            }}>Your Conditions</div>
            {filteredSaved.map(c => {
              const isSelected = selected === SAVED_PREFIX + c.id
              const bg = (c.bg ?? '#3a2f24') + '2b'
              const border = c.border ? c.border + '60' : 'color-mix(in srgb, var(--linked) 38%, transparent)'
              const selBg = (c.bg ?? '#3a2f24') + '73'
              return (
                <button key={c.id} onClick={() => handleSelect(SAVED_PREFIX + c.id)}
                  style={{
                    background: isSelected ? selBg : bg,
                    border: `var(--app-bw) solid ${isSelected ? (c.border ?? 'var(--linked)') : border}`,
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text)',
                    fontFamily: 'var(--font-ui)',
                    fontSize: 11, padding: '5px 8px',
                    cursor: 'pointer', textAlign: 'center',
                    transition: 'all 0.12s',
                    fontWeight: isSelected ? 700 : 500,
                    letterSpacing: '0.04em',
                    fontStyle: 'italic',
                  }}
                  title={c.description || `Custom condition · ${c.name}`}
                >{c.name}</button>
              )
            })}
            <div style={{
              gridColumn: 'span 3',
              fontSize: 9.5, fontWeight: 700,
              letterSpacing: '0.10em', textTransform: 'uppercase',
              color: 'var(--text-faded)',
              padding: '4px 2px 2px',
              borderTop: 'var(--app-bw) solid var(--border)',
              marginTop: 2,
            }}>PF2e Conditions</div>
          </>
        )}
        {filtered.map(c => {
          const m = CONDITION_META[c]
          const isSelected = selected === c
          // Per-condition colour — toned down with hex-alpha so the warm dark
          // theme reads through. Unselected: ~17% bg tint. Selected: ~45% bg.
          const unselBg     = m.bg + '2b'   // ~17% alpha
          const unselBorder = m.border + '60'  // ~38% alpha
          const selBg       = m.bg + '73'   // ~45% alpha
          return (
            <button key={c} onClick={() => handleSelect(c)}
              style={{
                background: isSelected ? selBg : unselBg,
                border: `var(--app-bw) solid ${isSelected ? m.border : unselBorder}`,
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text)',
                fontFamily: 'var(--font-ui)',
                fontSize: 11, padding: '5px 8px',
                cursor: 'pointer', textAlign: 'center',
                transition: 'all 0.12s',
                fontWeight: isSelected ? 700 : 500,
                letterSpacing: '0.04em',
                opacity: isSelected ? 1 : 0.85,
              }}
              onMouseEnter={e => {
                if (!isSelected) e.currentTarget.style.opacity = '1'
              }}
              onMouseLeave={e => {
                if (!isSelected) e.currentTarget.style.opacity = '0.85'
              }}
              title={m?.summary ?? c}
            >
              {m.name}
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ gridColumn: 'span 3', color: 'var(--text-faded)', fontSize: 12, textAlign: 'center', padding: 10, fontStyle: 'italic' }}>
            No conditions match
          </div>
        )}
      </div>

      {selected && (
        <div style={{
          borderTop: 'var(--app-bw) solid var(--border)',
          padding: '12px 14px',
          display: 'flex', flexDirection: 'column', gap: 10,
          background: 'rgba(0,0,0,0.15)',
        }}>
          {/* What the GM is about to apply, in full. Summary first (it names the numbers), then the
              printed entry. Scrolls on its own so the Apply button never leaves the popup. */}
          {meta && (
            <div style={{ maxHeight: 148, overflowY: 'auto' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5, fontStyle: 'italic' }}>
                {meta.summary}
              </div>
              {conditionText.get(selected) && (
                <div style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginTop: 7 }}>
                  <TagRenderer text={conditionText.get(selected)!} />
                </div>
              )}
            </div>
          )}
          {isCustom && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="pf-label" style={{ width: 50, marginBottom: 0 }}>Name</span>
                <input autoFocus
                  className="input-dark"
                  placeholder="e.g. Cursed, Burning, Off-Guard"
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && customName.trim()) handleApply() }}
                  style={{ flex: 1, fontSize: 12, padding: '5px 8px' }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span className="pf-label" style={{ width: 50, marginBottom: 0, paddingTop: 4 }}>Notes</span>
                <textarea
                  className="input-dark"
                  placeholder="Optional — shown when hovering the condition"
                  value={customDescription}
                  onChange={e => setCustomDescription(e.target.value)}
                  rows={2}
                  style={{ flex: 1, fontSize: 11.5, padding: '5px 8px', resize: 'vertical', minHeight: 36, fontFamily: 'var(--font-ui)' }}
                />
              </div>
            </>
          )}
          {isPd && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="pf-label" style={{ width: 50, marginBottom: 0 }}>Damage</span>
              <input autoFocus className="input-dark" placeholder="2d6"
                value={pdAmount} onChange={e => setPdAmount(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && pdAmount.trim()) handleApply() }}
                style={{ width: 64, fontSize: 12, padding: '5px 8px' }} />
              <input className="input-dark" placeholder="type — fire, bleed, acid…"
                value={pdType} onChange={e => setPdType(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && pdAmount.trim()) handleApply() }}
                style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '5px 8px' }} />
            </div>
          )}
          {effectiveMeta?.hasValue && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="pf-label" style={{ width: 50, marginBottom: 0 }}>Value</span>
              <input type="range" min={1} max={max} value={value}
                onChange={e => setValue(parseInt(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span style={{
                color: 'var(--accent)', fontFamily: 'var(--font-mono)',
                fontSize: 13, fontWeight: 600, width: 24, textAlign: 'right',
              }}>{value}</span>
            </div>
          )}

          {effectiveMeta?.autoDecrement ? (
            /* Auto-decrementing conditions (Frightened, Stunned) can ALSO be pinned "until removed"
             * — e.g. a fear aura that keeps you Frightened 2 as long as you're near it. The store
             * skips its per-turn tick while isPermanent is set. */
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-faded)', fontSize: 11, fontStyle: 'italic' }}>
                {isPermanent
                  ? 'Held at its current value until removed'
                  : `Auto-decrements by ${effectiveMeta.decrementBy ?? 1} each turn`}
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', marginLeft: 'auto' }}>
                <input type="checkbox" checked={isPermanent} onChange={e => setIsPermanent(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }} />
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>until removed</span>
              </label>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="pf-label" style={{ width: 50, marginBottom: 0 }}>Rounds</span>
              <NumberInput min={1} value={duration}
                onChange={e => setDuration(Math.max(1, parseInt(e.target.value) || 1))}
                onStep={n => setDuration(Math.max(1, n))}
                disabled={isPermanent}
                className="input-dark input-mono"
                style={{
                  width: 70, fontSize: 12,
                  opacity: isPermanent ? 0.4 : 1,
                }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', marginLeft: 4 }}>
                <input type="checkbox" checked={isPermanent} onChange={e => setIsPermanent(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }} />
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>until removed</span>
              </label>
            </div>
          )}

          {/* Whose turn the round-clock runs on. */}
          {!effectiveMeta?.autoDecrement && !isPermanent && combatants.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="pf-label" style={{ width: 50, marginBottom: 0 }}>Source</span>
              <select
                value={source}
                onChange={e => setSource(e.target.value)}
                className="input-dark"
                style={{ flex: 1, minWidth: 0, fontSize: 11.5, padding: '5px 8px', opacity: isPermanent ? 0.4 : 1 }}
                title="Whose turn the duration counts down on. Player Core: a duration in rounds decreases by 1 at the start of each turn of the creature that CREATED the effect."
              >
                <option value="">ends at the end of {combatant.name}&rsquo;s turn</option>
                {combatants.filter(c => c.id !== combatant.id).map(c => (
                  <option key={c.id} value={c.id}>ticks on {c.name}&rsquo;s turn</option>
                ))}
              </select>
            </div>
          )}

          {/* Apply + (Custom only) Advanced editor entrypoint side by side. */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(() => { const blocked = (isCustom && !customName.trim()) || (isPd && !pdAmount.trim()); return (
            <button onClick={handleApply}
              disabled={blocked}
              className="btn btn-primary btn-sm"
              style={{
                flex: 1, justifyContent: 'center', padding: '7px 0',
                opacity: blocked ? 0.45 : 1,
                cursor: blocked ? 'not-allowed' : 'pointer',
              }}
            >Apply Condition</button>
            ) })()}
            {isCustom && (
              <button onClick={() => {
                // Pre-seed the Advanced editor with whatever the user has
                // typed into the simple form so they don't lose their work.
                setAdvOpen(true)
              }}
                className="btn btn-secondary btn-sm"
                title="Open the full editor — value scaling, duration, and stat effects on every stat / skill"
                style={{
                  flexShrink: 0, padding: '7px 12px',
                  fontSize: 11.5, fontWeight: 600,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >Advanced →</button>
            )}
          </div>
        </div>
      )}

      {/* Advanced editor — rendered into the same overlay layer so it sits
          above the picker and the underlying combat tracker. Pre-seeds the
          editor with whatever the user typed into the simple Custom form
          so opening Advanced never throws away in-progress work. */}
      {advOpen && (
        <AdvancedConditionEditor
          editing={isCustom ? {
            ...emptyCustomCondition(),
            name: customName,
            description: customDescription,
            defaultDuration: duration,
            isPermanent,
          } : undefined}
          onClose={() => setAdvOpen(false)}
          onSave={c => {
            upsertCustom(c)
            setAdvOpen(false)
            // Pre-select the freshly saved entry in the picker so the user
            // can see it landed (and tweak duration before hitting Apply).
            setSelected(SAVED_PREFIX + c.id)
            setValue(1)
            setDuration(c.defaultDuration)
            setIsPermanent(c.isPermanent)
          }}
          onSaveAndApply={c => {
            upsertCustom(c)
            applyFromTemplate(c, { value: 1, duration: c.defaultDuration, isPermanent: c.isPermanent })
            setAdvOpen(false)
            onClose()
          }}
        />
      )}
    </div>
  )
}

interface Props {
  combatant: Combatant
  anchorEl: HTMLElement | null
  onClose: () => void
}

export function ConditionPanel({ combatant, anchorEl, onClose }: Props) {
  if (!anchorEl) return null
  return <AddConditionPopup combatant={combatant} anchorEl={anchorEl} onClose={onClose} />
}

export function ConditionBadgeList({ combatant, inline }: { combatant: Combatant; inline?: boolean }) {
  if (combatant.conditions.length === 0) return null
  return (
    <div className={`flex flex-wrap gap-1${inline ? '' : ' mt-1'}`}>
      {combatant.conditions.map(cond => (
        <ConditionBadge key={cond.id} cond={cond} combatantId={combatant.id} />
      ))}
    </div>
  )
}
