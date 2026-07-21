import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Combatant } from '../types/pf2e'
import { useCombatStore } from '../store/combatStore'
import { usePartyStore } from '../store/partyStore'
import { useSettingsStore } from '../store/settingsStore'
import { DRAG_MIME, useHoveredCid } from '../store/layoutStore'
import { Chip } from './Chip'
import { CONDITION_META, computeConditionMods } from '../utils/conditionEffects'
import { applyWeakElite, scaleByLevel } from '../utils/weakElite'
import { computeEncounter, DIFFICULTY_COLOR } from '../utils/encounter'
import { useCampaignPartyLevel } from '../data/partyLevelContext'
import { useHostPcStats } from '../data/pcStatsContext'
import { PlayIcon, StopIcon, ChevronLeftIcon, ChevronRightIcon, DiceIcon } from './Icons'
import { EncounterTablesModal } from './EncounterTablesModal'

function InitRow({ c, isActive, isSelected, onSelect }: {
  c: Combatant; isActive: boolean; isSelected: boolean; onSelect: () => void
}) {
  const { setInitiative, renameCombatant } = useCombatStore()
  const [editInit, setEditInit] = useState(false)
  const [initVal, setInitVal] = useState(c.initiative?.toString() ?? '')
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(c.name)
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => { if (!editingName) setNameInput(c.name) }, [c.name, editingName])

  const finishEditInit = () => {
    const v = parseInt(initVal)
    setInitiative(c.id, isNaN(v) ? null : v)
    setEditInit(false)
  }

  const commitRename = () => {
    const t = nameInput.trim()
    renameCombatant(c.id, t || c.name)
    setEditingName(false)
  }

  const effective = c.creature
    ? c.scaledToLevel !== undefined
      ? scaleByLevel(c.creature, c.scaledToLevel)
      : applyWeakElite(c.creature, c.isElite ? 'elite' : c.isWeak ? 'weak' : 'normal')
    : null

  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn() }

  const showInitAC = useSettingsStore(s => s.showInitAC)
  const showInitSaves = useSettingsStore(s => s.showInitSaves)
  const showInitPcDefenses = useSettingsStore(s => s.showInitPcDefenses)
  const hideInitPcHp = useSettingsStore(s => s.hideInitPcHp)
  const showInitLevel = useSettingsStore(s => s.showInitLevel)
  const sv = (n: number) => (n >= 0 ? `+${n}` : `${n}`)
  // Apply active-condition modifiers so the AC/saves match the stat block.
  const cm = computeConditionMods(c.conditions)
  const modCls = (d: number) => (d < 0 ? 'stat-down' : d > 0 ? 'stat-up' : '')
  // For PCs (no creature stat block), pull AC/saves off the matching party
  // sheet so they can show in the initiative order too. Inside a Heroes Heaven
  // campaign the host supplies the real character's stats (hostPcStats); the
  // party-store sheet is the standalone fallback. Host wins because it's the
  // live character, not a hand-entered copy.
  const parties = usePartyStore(s => s.parties)
  const hostPcStats = useHostPcStats(c.name)
  const pcStats = c.isPC
    ? hostPcStats ?? parties.flatMap(p => p.players).find(pl => pl.memberType === 'pc' && pl.name.toLowerCase() === c.name.toLowerCase())?.pcStats
    : undefined

  // The mini HP bar's numbers. A PC combatant added inside a Heroes Heaven campaign has no HP of its
  // own (maxHP 0) — its real HP lives on the character, handed over via pcStats. Fall back to that so
  // the bar renders. (A standalone PC already gets maxHP from its party sheet at add-time, so the
  // combatant's own HP wins whenever it has any; this only fills the gap when it doesn't.)
  const hpMax = c.maxHP > 0 ? c.maxHP : c.isPC ? pcStats?.maxHP ?? 0 : 0
  const hpCur = c.maxHP > 0 ? c.currentHP : c.isPC ? pcStats?.hpCurrent ?? pcStats?.maxHP ?? 0 : 0
  const pct = hpMax > 0 ? hpCur / hpMax : 0
  const hpBarColor = pct > 0.5 ? 'var(--hp-full)' : pct > 0.25 ? 'var(--hp-mid)' : 'var(--hp-low)'

  return (
    <div
      className={`init-row group ${isActive ? 'active' : ''} ${isSelected ? 'viewing' : ''}`}
      style={{
        ...(c.isDefeated ? { opacity: 0.38, filter: 'grayscale(0.7)' } : {}),
      }}
      // Drag the card into a pane to open its stat block (split or new tab).
      draggable={!editingName && !editInit}
      onDragStart={e => {
        e.dataTransfer.setData(DRAG_MIME, c.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={onSelect}
      onContextMenu={e => { e.preventDefault(); setCtxPos({ x: e.clientX, y: e.clientY }) }}
    >
      {/* Initiative number — mono, gold */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 12, fontWeight: 500, color: 'var(--accent)',
        width: 22, textAlign: 'center', flexShrink: 0,
      }}
        onClick={e => e.stopPropagation()}>
        {editInit ? (
          <input autoFocus
            style={{
              width: 24, textAlign: 'center', background: 'transparent',
              border: 'none', borderBottom: 'var(--app-bw) solid var(--accent)',
              color: 'var(--text)',
              fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none',
            }}
            value={initVal}
            onChange={e => setInitVal(e.target.value)}
            onBlur={finishEditInit}
            onKeyDown={e => e.key === 'Enter' && finishEditInit()}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span style={{ cursor: 'pointer' }} onClick={stop(() => setEditInit(true))}>
            {c.initiative ?? '—'}
          </span>
        )}
      </div>

      {/* Info column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name row */}
        {editingName ? (
          <input autoFocus
            style={{
              background: 'transparent',
              border: 'none', borderBottom: 'var(--app-bw) solid var(--accent)',
              color: 'var(--text)',
              fontFamily: 'var(--font-ui)',
              fontSize: 13, fontWeight: 500,
              outline: 'none', width: '100%',
            }}
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setNameInput(c.name); setEditingName(false) }
            }}
            onBlur={commitRename}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <div style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 13, fontWeight: 500, color: 'var(--text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{c.name}</span>
            {c.isPC && <Chip tone="accent">PC</Chip>}
            {c.isAlly && !c.isPC && <Chip tone="linked">NPC</Chip>}
            {c.isElite && <span className="label-elite" style={{ fontSize: 8, flexShrink: 0 }}>E</span>}
            {c.isWeak && <span className="label-weak" style={{ fontSize: 8, flexShrink: 0 }}>W</span>}
            {c.scaledToLevel !== undefined && <Chip tone="accent" mono>L{c.scaledToLevel}</Chip>}
            {/* Right group: stat-block level + status icons (eye / NOW), pinned
                to the top-right of the name line, above the saves. The status
                slot reserves a constant width so the row never resizes when it
                becomes active/viewed. */}
            <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {showInitLevel && effective && <Chip tone="muted" mono>Lv {effective.level}</Chip>}
              {isActive && (
                <span className="now-badge" title="Current turn">NOW</span>
              )}
            </span>
          </div>
        )}

        {/* Sub-text: AC / saves + condition count, with the "viewing" eye in a
            reserved slot on the right (same line as the saves). The slot is
            always present so the row never changes size when it's viewed. */}
        {!editingName && (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10, color: 'var(--text-faded)',
            marginTop: 2, display: 'flex', gap: 6, alignItems: 'center', minHeight: 14,
          }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 6, rowGap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
              {showInitAC && effective && !effective.isHazard && (
                <span style={{ color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--text-faded)' }}>AC</span> <span className={modCls(cm.ac)}>{effective.defenses.ac + cm.ac}</span>
                </span>
              )}
              {showInitSaves && effective && !effective.isHazard && (
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex', gap: 6 }}>
                  <span><span className="sv-lbl"><span className="sv-full">Fort</span><span className="sv-short">F</span></span> <span className={modCls(cm.fort)}>{sv(effective.defenses.fort + cm.fort)}</span></span>
                  <span><span className="sv-lbl"><span className="sv-full">Ref</span><span className="sv-short">R</span></span> <span className={modCls(cm.ref)}>{sv(effective.defenses.ref + cm.ref)}</span></span>
                  <span><span className="sv-lbl"><span className="sv-full">Will</span><span className="sv-short">W</span></span> <span className={modCls(cm.will)}>{sv(effective.defenses.will + cm.will)}</span></span>
                </span>
              )}
              {/* Player AC + saves from the imported/entered sheet. */}
              {showInitPcDefenses && pcStats?.ac != null && (
                <span style={{ color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--text-faded)' }}>AC</span> <span className={modCls(cm.ac)}>{pcStats.ac + cm.ac}</span>
                </span>
              )}
              {showInitPcDefenses && pcStats && (pcStats.fortMod != null || pcStats.refMod != null || pcStats.willMod != null) && (
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex', gap: 6 }}>
                  {pcStats.fortMod != null && <span><span className="sv-lbl"><span className="sv-full">Fort</span><span className="sv-short">F</span></span> <span className={modCls(cm.fort)}>{sv(pcStats.fortMod + cm.fort)}</span></span>}
                  {pcStats.refMod != null && <span><span className="sv-lbl"><span className="sv-full">Ref</span><span className="sv-short">R</span></span> <span className={modCls(cm.ref)}>{sv(pcStats.refMod + cm.ref)}</span></span>}
                  {pcStats.willMod != null && <span><span className="sv-lbl"><span className="sv-full">Will</span><span className="sv-short">W</span></span> <span className={modCls(cm.will)}>{sv(pcStats.willMod + cm.will)}</span></span>}
                </span>
              )}
              {c.conditions.length > 0 && (
                <span style={{ display: 'inline-flex', gap: 2 }}>
                  {c.conditions.map(cond => {
                    const meta = CONDITION_META[cond.name.toLowerCase()]
                    return (
                      <span key={cond.id} style={{
                        display: 'inline-block',
                        background: meta?.bg ?? '#374151', color: meta?.fg ?? '#fff',
                        borderRadius: 2, padding: '0 4px', fontSize: 8.5, fontWeight: 700,
                        fontFamily: 'var(--font-ui)',
                      }}>
                        {cond.name.charAt(0).toUpperCase()}{cond.value !== undefined ? cond.value : ''}
                      </span>
                    )
                  })}
                </span>
              )}
            </div>
            {/* Reserved eye slot — constant width so the row size never changes. */}
            <span style={{ flexShrink: 0, width: 14, display: 'flex', justifyContent: 'center' }}>
              {isSelected && (
                <span className="eye-icon" title="Viewing in main panel">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </span>
              )}
            </span>
          </div>
        )}

        {/* Mini HP bar — shown for anyone with a max HP, PCs included (their
            max now flows in from the imported / entered character sheet), unless
            the user hides player HP bars in Settings. */}
        {hpMax > 0 && !editingName && !(c.isPC && hideInitPcHp) && (
          <div style={{
            height: 3, borderRadius: 2, marginTop: 5,
            background: 'var(--bg-elevated)', overflow: 'hidden',
          }}>
            <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct * 100))}%`, background: hpBarColor, borderRadius: 2 }} />
          </div>
        )}
      </div>

      {/* (Status icons — eye / NOW — now live in the name-line slot above the
          saves; see the right-group in the name row.) */}

      {/* Right-click anywhere on the row for actions (rename / duplicate /
          mark defeated / remove). */}
      {ctxPos && (
        <RowContextMenu
          c={c} x={ctxPos.x} y={ctxPos.y}
          onClose={() => setCtxPos(null)}
          onRename={() => { setNameInput(c.name); setEditingName(true) }}
        />
      )}
    </div>
  )
}

// ── Right-click menu for an initiative row ─────────────────────────────────
function RowContextMenu({ c, x, y, onClose, onRename }: {
  c: Combatant; x: number; y: number; onClose: () => void; onRename: () => void
}) {
  const { duplicateCombatant, removeCombatant, setDefeated } = useCombatStore()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  // Keep the menu inside the viewport.
  const W = 184, rowH = 30
  const left = Math.min(x, window.innerWidth - W - 8)
  const top = Math.min(y, window.innerHeight - rowH * 5 - 8)

  const run = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); onClose() }

  const itemStyle: React.CSSProperties = {
    width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
    cursor: 'pointer', color: 'var(--text)', fontFamily: 'var(--font-ui)',
    fontSize: 12.5, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 8,
  }
  const hov = (on: boolean) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = on ? 'var(--bg-hover)' : 'transparent'
  }
  const sep = <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

  // Portal to <body> so the menu escapes the row's container: a defeated row
  // is dimmed with opacity 0.38 (would make the menu translucent) and
  // filter: grayscale (which makes the row the containing block for our
  // position:fixed coords, mis-placing the menu off-target and unclickable).
  return createPortal(
    <div ref={ref}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', left, top, zIndex: 9999, minWidth: W,
        background: 'var(--bg-panel)', border: 'var(--app-bw) solid var(--border-strong)',
        borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)',
        padding: '4px 0', fontFamily: 'var(--font-ui)',
      }}>
      <div style={{
        padding: '5px 12px', fontSize: 11, color: 'var(--text-muted)',
        borderBottom: 'var(--app-bw) solid var(--border)', marginBottom: 3,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{c.name}</div>

      <button style={itemStyle} onMouseEnter={hov(true)} onMouseLeave={hov(false)}
        onClick={run(onRename)}>Rename</button>

      {!c.isPC && (
        <button style={itemStyle} onMouseEnter={hov(true)} onMouseLeave={hov(false)}
          onClick={run(() => duplicateCombatant(c.id))}>Duplicate</button>
      )}

      <button style={itemStyle} onMouseEnter={hov(true)} onMouseLeave={hov(false)}
        onClick={run(() => setDefeated(c.id, !c.isDefeated))}>
        {c.isDefeated ? 'Restore' : 'Mark defeated'}
      </button>

      {sep}
      <button style={{ ...itemStyle, color: 'var(--danger)' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--danger-soft)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        onClick={run(() => removeCombatant(c.id))}>Remove</button>
    </div>,
    document.body,
  )
}

interface TrackerProps {
  onCombatantClick?: (id: string) => void
  onMinWidthMeasured?: (px: number) => void
  /** When provided, a collapse button is shown on the round line. */
  onCollapse?: () => void
}

export function InitiativeTracker({ onCombatantClick, onMinWidthMeasured, onCollapse }: TrackerProps) {
  // Pick only the slices we actually use — keeps this component from
  // re-rendering when unrelated store fields (e.g. diceResults) change.
  const combatants  = useCombatStore(s => s.combatants)
  const round       = useCombatStore(s => s.round)
  const activeIndex = useCombatStore(s => s.activeIndex)
  const selectedId  = useCombatStore(s => s.selectedId)
  const inCombat    = useCombatStore(s => s.inCombat)
  const hoveredCid  = useHoveredCid()  // creature of the hovered (or last-hovered) pane
  // Action setters are stable references in zustand — fine to grab via getState
  // shortcut without subscribing.
  const startCombat          = useCombatStore(s => s.startCombat)
  const endCombat            = useCombatStore(s => s.endCombat)
  const nextTurn             = useCombatStore(s => s.nextTurn)
  const prevTurn             = useCombatStore(s => s.prevTurn)
  const rollMonsterInitiative = useCombatStore(s => s.rollMonsterInitiative)
  const selectCombatant      = useCombatStore(s => s.selectCombatant)
  const undo                 = useCombatStore(s => s.undo)
  const redo                 = useCombatStore(s => s.redo)
  const canUndo              = useCombatStore(s => s.canUndo)
  const canRedo              = useCombatStore(s => s.canRedo)

  const parties        = usePartyStore(s => s.parties)
  const activePartyId  = usePartyStore(s => s.activePartyId)

  // Party level / size — prefer active party, fall back to local override
  const [localLevel, setLocalLevel] = useState<number>(() => {
    const s = localStorage.getItem('pf2e-party-level')
    return s ? (parseInt(s) || 1) : 1
  })
  const [editingLevel, setEditingLevel] = useState(false)
  const [showXpTables, setShowXpTables] = useState(false)
  const [levelInput, setLevelInput] = useState('')

  const activeParty = parties.find(p => p.id === activePartyId)
  /*
   * Inside a campaign the real characters decide the party level, and they outrank both the party
   * store and the local override — those are hand-typed guesses at a number the characters already
   * know. Null when running standalone, where the old behaviour stands unchanged.
   */
  const campaignLevel = useCampaignPartyLevel()
  const partyLevel  = campaignLevel ?? (activeParty ? activeParty.level : localLevel)
  // Party size = PCs + allied NPCs currently in the initiative tracker
  // (excluding defeated). An allied NPC only counts if it has a stat block
  // — name-only allies don't actually contribute to the party's combat
  // strength, so we don't inflate the encounter budget for them.
  const partySize   = Math.max(1, combatants.filter(c =>
    !c.isDefeated && (c.isPC || (c.isAlly && c.creature != null))
  ).length)

  const commitLevel = () => {
    const v = parseInt(levelInput)
    if (!isNaN(v) && v >= 1 && v <= 20) {
      setLocalLevel(v)
      localStorage.setItem('pf2e-party-level', String(v))
    }
    setEditingLevel(false)
  }

  // Encounter stats — recomputed whenever combatants or party info changes
  const stats = computeEncounter(combatants, partyLevel, partySize)
  const diffColor = DIFFICULTY_COLOR[stats.difficulty]

  // Panel minimum width = the widest of two things measured off-screen:
  //   1. the 3 in-combat buttons (Prev / Next / End), and
  //   2. a creature card's AC + saves row — so the panel can't be dragged so
  //      narrow that the saves wrap onto a second line. The user wants the floor
  //      to sit right before that wrap.
  const measureRef = useRef<HTMLDivElement | null>(null)
  const savesMeasureRef = useRef<HTMLDivElement | null>(null)
  const showInitAC = useSettingsStore(s => s.showInitAC)
  const showInitSaves = useSettingsStore(s => s.showInitSaves)
  const showInitPcDefenses = useSettingsStore(s => s.showInitPcDefenses)
  const [minPanelW, setMinPanelW] = useState<number>(220)
  useLayoutEffect(() => {
    const measure = () => {
      // +24 px for the 12px horizontal padding on each side of the header.
      const btnW = measureRef.current ? measureRef.current.scrollWidth + 24 : 0
      // Saves replica mirrors the card box model. Add: 12px (the row's 6px
      // horizontal margin each side) + 8px (the combat list's vertical scrollbar
      // — once it overflows it eats card width, which is exactly when the saves
      // were wrapping) + 4px slack against sub-pixel rounding.
      const savesW = savesMeasureRef.current ? savesMeasureRef.current.offsetWidth + 24 : 0
      const w = Math.max(btnW, savesW)
      // setState with an identical value is a no-op (React bails), so no guard.
      if (w > 0) { setMinPanelW(w); onMinWidthMeasured?.(w) }
    }
    measure()
    // Web fonts (esp. the mono the saves use) change glyph widths once loaded —
    // re-measure so the floor reflects the real font, not the fallback.
    let cancelled = false
    document.fonts?.ready?.then(() => { if (!cancelled) measure() })
    return () => { cancelled = true }
    // Re-measure when the saves/AC toggles change (they change the row width)
    // or the parent hands us a new setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMinWidthMeasured, showInitAC, showInitSaves, showInitPcDefenses])

  const btnBase: React.CSSProperties = {
    fontFamily: 'var(--font-ui)',
    fontSize: 11.5, fontWeight: 500,
    padding: '5px 11px',
    borderRadius: 'var(--radius-sm)',
    border: 'var(--app-bw) solid var(--border-strong)',
    cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 5,
    transition: 'all 0.15s ease',
    flexShrink: 0,
    background: 'transparent',
    color: 'var(--text)',
  }

  // Tiny undo/redo glyph buttons under the round counter.
  const miniBtn: React.CSSProperties = {
    width: 18, height: 15, padding: 0, lineHeight: 1, fontSize: 11,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 3, background: 'transparent',
    border: 'var(--app-bw) solid var(--border-strong)', color: 'var(--text-muted)',
  }

  // XP/difficulty badge — shown in the button row, wraps below if narrow
  const encounterBadge = stats.enemyCount > 0 ? (
    <div style={{
      marginLeft: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
      gap: 1, flexShrink: 0, lineHeight: 1.1,
    }}>
      {!inCombat && (
        <span style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: diffColor,
        }}>
          {stats.difficulty}
        </span>
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faded)' }}>
          {stats.xp} XP
        </span>
        <button
          onClick={() => setShowXpTables(true)}
          title="Encounter XP budget & creature roles"
          aria-label="Encounter building reference tables"
          style={{
            width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
            border: 'var(--app-bw) solid var(--border-strong)', background: 'transparent',
            color: 'var(--text-muted)', cursor: 'pointer', padding: 0,
            fontFamily: 'var(--font-display)', fontSize: 10, fontStyle: 'italic', fontWeight: 700,
            lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-muted)' }}
        >i</button>
      </span>
    </div>
  ) : null

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-base)', minWidth: minPanelW }}>
      {showXpTables && <EncounterTablesModal current={stats.difficulty} onClose={() => setShowXpTables(false)} />}
      {/* Hidden measurement element — renders the 3 in-combat buttons off-screen
          so we can size the panel to exactly fit them. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
          display: 'flex', gap: 5, top: -9999, left: -9999,
        }}
      >
        <span style={{ ...btnBase }}><ChevronLeftIcon size={11} /> Prev</span>
        <span style={{ ...btnBase }}>Next <ChevronRightIcon size={11} /></span>
        <span style={{ ...btnBase }}><StopIcon size={10} /> End</span>
      </div>

      {/* Hidden measurement element — a creature card's AC + saves row at no-wrap
          with SHORT (F/R/W) labels and worst-case 2-digit values (PF2e AC/saves
          never exceed two digits). Mirrors the card's horizontal box model
          (init-number column + gap-2 + px-3 + 1px border + the reserved eye
          slot) WITHOUT .init-row's container-type, which would defeat content
          sizing. Feeds the panel min-width so the saves never wrap. */}
      <div aria-hidden="true" style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', top: -9999, left: -9999 }}>
        <div ref={savesMeasureRef} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', border: 'var(--app-bw) solid transparent', width: 'max-content',
        }}>
          <div style={{ width: 22, flexShrink: 0 }} />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {(showInitAC || showInitPcDefenses) && <span>AC 99</span>}
              {(showInitSaves || showInitPcDefenses) && (
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <span>F +99</span><span>R +99</span><span>W +99</span>
                </span>
              )}
            </div>
            <span style={{ width: 14, flexShrink: 0 }} />
          </div>
        </div>
      </div>

      {/* Sidebar header */}
      <div style={{
        padding: '16px 16px 12px',
        background: 'transparent',
        borderBottom: 'var(--app-bw) solid var(--border)',
        flexShrink: 0,
      }}>
        {/* Row 1: title + party level (if no active party) + round */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 6 }}>
          <span className="pf-label muted" style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 0 }}>
            Initiative Order
          </span>

          {/* Party level indicator. In a campaign it's derived from the characters and therefore
              READ-ONLY — there's nothing to type, and a typed value could only disagree with them
              (which is exactly how this read "LV 1" for a level-3 party). Editable only when the
              tracker has no better source. */}
          {campaignLevel != null ? (
            <span
              title="Party level comes from your characters — it's what encounter difficulty is rated against."
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5, color: 'var(--text-faded)', flexShrink: 0,
              }}
            >
              LV {campaignLevel}
            </span>
          ) : !activeParty && (
            editingLevel ? (
              <input
                autoFocus
                style={{
                  width: 32, textAlign: 'center', background: 'transparent',
                  border: 'none', borderBottom: 'var(--app-bw) solid var(--accent-line)',
                  color: 'var(--text)', fontSize: 10, outline: 'none',
                }}
                value={levelInput}
                onChange={e => setLevelInput(e.target.value)}
                onBlur={commitLevel}
                onKeyDown={e => { if (e.key === 'Enter') commitLevel(); if (e.key === 'Escape') setEditingLevel(false) }}
              />
            ) : (
              <span
                title="Click to set party level"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10.5, color: 'var(--text-faded)',
                  cursor: 'pointer', flexShrink: 0,
                }}
                onClick={() => { setLevelInput(String(localLevel)); setEditingLevel(true) }}
              >
                LV {localLevel}
              </span>
            )
          )}

          {inCombat && (
            <div style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap',
              }}>Round {round}</span>
              {/* Tiny undo / redo, tucked under the round counter (also Ctrl+Z / Ctrl+Shift+Z). */}
              <div style={{ display: 'flex', gap: 3 }}>
                <button title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => canUndo && undo()}
                  style={{ ...miniBtn, opacity: canUndo ? 1 : 0.35, cursor: canUndo ? 'pointer' : 'default' }}
                  onMouseEnter={e => { if (canUndo) e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >↶</button>
                <button title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => canRedo && redo()}
                  style={{ ...miniBtn, opacity: canRedo ? 1 : 0.35, cursor: canRedo ? 'pointer' : 'default' }}
                  onMouseEnter={e => { if (canRedo) e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >↷</button>
              </div>
            </div>
          )}

          {onCollapse && (
            <button
              onClick={onCollapse}
              className="ico-btn"
              title="Collapse initiative order"
              style={{ width: 22, height: 22, flexShrink: 0, marginLeft: inCombat ? 4 : 'auto' }}
            ><ChevronLeftIcon size={13} /></button>
          )}
        </div>

        {/* Row 2: combat buttons + encounter badge (wraps below if narrow) */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {!inCombat ? (
            <>
              <button style={{
                ...btnBase,
                background: 'var(--accent)', color: 'var(--text-on-accent)',
                borderColor: 'var(--accent)', fontWeight: 600,
              }}
                onClick={startCombat}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)'; e.currentTarget.style.borderColor = 'var(--accent-hover)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
              >
                <PlayIcon size={10} /> Start
              </button>
              <button style={btnBase}
                onClick={rollMonsterInitiative}
                title="Roll d20 + Perception for all non-PC creatures"
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-focus)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border-strong)' }}
              >
                <DiceIcon size={11} /> Roll
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'nowrap', flexShrink: 0 }}>
              <button style={btnBase}
                onClick={prevTurn}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-focus)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border-strong)' }}
              >
                <ChevronLeftIcon size={11} /> Prev
              </button>
              <button style={{
                ...btnBase,
                background: 'var(--accent)', color: 'var(--text-on-accent)',
                borderColor: 'var(--accent)', fontWeight: 600,
              }}
                onClick={nextTurn}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)'; e.currentTarget.style.borderColor = 'var(--accent-hover)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
              >
                Next <ChevronRightIcon size={11} />
              </button>
              <button style={{ ...btnBase, color: 'var(--text-muted)' }}
                onClick={endCombat}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-focus)'; e.currentTarget.style.color = 'var(--text)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                <StopIcon size={10} /> End
              </button>
            </div>
          )}

          {encounterBadge}
        </div>
      </div>

      {/* Combatant list */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '4px 0' }}>
        {combatants.length === 0 && (
          <div style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 12, fontStyle: 'italic',
            color: 'var(--text-faded)',
            textAlign: 'center', padding: '20px 16px',
          }}>
            No combatants yet.
          </div>
        )}
        {combatants.map((c, i) => (
          <InitRow key={c.id} c={c}
            isActive={inCombat && i === activeIndex}
            isSelected={c.id === hoveredCid}
            onSelect={() => {
              if (onCombatantClick) onCombatantClick(c.id)
              else selectCombatant(c.id === selectedId ? null : c.id)
            }}
          />
        ))}
      </div>
    </div>
  )
}
