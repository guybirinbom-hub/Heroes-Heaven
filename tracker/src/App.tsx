import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useCombatStore } from './store/combatStore'
import { usePartyStore } from './store/partyStore'
import type { Party } from './store/partyStore'
import { loadIndex, loadCustomCreatures } from './data/dataStore'
import { InitiativeTracker } from './components/InitiativeTracker'
import { NumberInput } from './components/NumberInput'
import { PaneLayout } from './components/PaneLayout'
import { useLayoutStore, useGmLayoutStore } from './store/layoutStore'
import { useWindowStore } from './store/windowStore'
import { PartyView } from './components/PartyView'
import { MonsterSearch } from './components/MonsterSearch'
import { EncounterManager } from './components/EncounterManager'
import { TextConverter } from './components/TextConverter'
import { GlobalSearch } from './components/GlobalSearch'
import { GMScreen } from './components/GMScreen'
import { DiceOverlay } from './components/DiceOverlay'
import { FloatingWindowLayer } from './components/FloatingWindow'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PlusIcon, StarIcon, XIcon, MinimizeIcon, MaximizeIcon, WindowRestoreIcon, PencilIcon, SaveIcon, DiceIcon, SearchIcon, ScreenIcon, ChevronRightIcon } from './components/Icons'
// Heroes Heaven's REAL brand mark + nav menu, imported live from ../src — so the tracker reads as
// part of the builder rather than as a lookalike. Both are alias-safe: Logo has zero imports, and
// PageMenu pulls only useEscapeClose (react-only) plus a type-only ModeDef that erases at build.
import { HeroesHeavenLogo } from '@hh/sheet/Logo'
import { PageMenu } from '@hh/sheet/PageMenu'
import { useSettingsStore } from './store/settingsStore'
import { updateTaskbarIcon } from './utils/themeIcon'
import { SettingsModal } from './components/SettingsModal'
import { TurnTimerWidget } from './components/TurnTimerWidget'
import { UpdateNotice } from './components/UpdateNotice'

// ── Add-party dialog ────────────────────────────────────────────────────────
function AddPartyDialog({ onDone, onCancel }: {
  onDone: (name: string, level: number) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [level, setLevel] = useState(1)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const submit = () => { const t = name.trim(); if (t) onDone(t, level) }
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 52, background: 'rgba(0,0,0,0.7)',
      }}
    >
      <div style={{
        background: 'var(--bg-panel)', border: 'var(--app-bw) solid var(--border-strong)',
        borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.8)',
        padding: '18px 20px', minWidth: 280,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 14, borderBottom: 'var(--app-bw) solid var(--border)', paddingBottom: 8 }}>New Party</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            ref={inputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
            placeholder="Party name"
            style={{
              background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border-strong)',
              borderRadius: 6, color: 'var(--text)', fontSize: 14,
              padding: '6px 10px', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Party Level</span>
            <NumberInput
              min={1} max={20}
              value={level}
              onChange={e => setLevel(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
              onStep={n => setLevel(Math.max(1, Math.min(20, n)))}
              onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
              className="input-dark input-mono"
              style={{ fontSize: 14, width: 84 }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="btn btn-secondary">Cancel</button>
          <button onClick={submit} disabled={!name.trim()} className="btn btn-primary">Create</button>
        </div>
      </div>
    </div>
  )
}

// ── Party chip ──────────────────────────────────────────────────────────────
function PartyChip({ party, isActive, onClick, onRightClick }: {
  party: Party; isActive: boolean
  onClick: () => void; onRightClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={e => { e.preventDefault(); onRightClick() }}
      title={`${party.name} · Level ${party.level}${party.isFavorite ? ' · ★ Favorite' : ''}\nRight-click to toggle favorite`}
      style={{
        flexShrink: 0,
        background: isActive ? 'var(--accent-soft)' : 'transparent',
        border: `var(--app-bw) solid ${isActive ? 'var(--border-strong)' : 'transparent'}`,
        borderRadius: 'var(--radius-sm)',
        color: isActive ? 'var(--text)' : 'var(--text-muted)',
        fontSize: 12.5, padding: '5px 11px', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        whiteSpace: 'nowrap', transition: 'all 0.15s ease',
        maxWidth: 160, fontWeight: 500,
        fontFamily: 'var(--font-ui)',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
      onMouseEnter={e => {
        if (!isActive) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)' }
      }}
      onMouseLeave={e => {
        if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }
      }}
    >
      {party.isFavorite && <StarIcon size={10} style={{ color: 'var(--accent)' }} filled />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>{party.name}</span>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500,
        color: isActive ? 'var(--accent)' : 'var(--text-faded)',
        flexShrink: 0,
      }}>LV {party.level}</span>
    </button>
  )
}

// ── Party overflow dropdown ───────────────────────────────────────────────────
// Shown when the party chips don't all fit in the topbar (instead of a
// scrollbar). Lists every party — favorites first, as already sorted — each row
// activates the party or toggles its favourite, with a search box pinned to the
// BOTTOM of the menu.
function PartyMenu({ parties, activePartyId, isPartyFocus, onPick, onToggleFav, onClose }: {
  parties: Party[]
  activePartyId: string | null
  isPartyFocus: boolean
  onPick: (id: string) => void
  onToggleFav: (id: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const ql = q.trim().toLowerCase()
  const shown = ql ? parties.filter(p => p.name.toLowerCase().includes(ql)) : parties
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2000 }} />
      <div style={{
        position: 'absolute', top: 'calc(100% + 5px)', right: 0, zIndex: 2001,
        width: 250, maxWidth: '70vw',
        background: 'var(--bg-panel)', border: 'var(--app-bw) solid var(--border-strong)',
        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}>
        <div style={{ maxHeight: 320, overflowY: 'auto', padding: 5 }}>
          {shown.map(p => {
            const active = p.id === activePartyId && isPartyFocus
            return (
              <div key={p.id}
                onClick={() => onPick(p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                <button
                  onClick={e => { e.stopPropagation(); onToggleFav(p.id) }}
                  title={p.isFavorite ? 'Unfavorite' : 'Favorite'}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexShrink: 0 }}
                >
                  <StarIcon size={13} filled={p.isFavorite} style={{ color: p.isFavorite ? 'var(--accent)' : 'var(--text-faded)' }} />
                </button>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, color: active ? 'var(--text)' : 'var(--text-muted)' }}>{p.name}</span>
                <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: active ? 'var(--accent)' : 'var(--text-faded)' }}>LV {p.level}</span>
              </div>
            )
          })}
          {shown.length === 0 && <div style={{ padding: '8px 9px', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No parties match.</div>}
        </div>
        <div style={{ borderTop: 'var(--app-bw) solid var(--border)', padding: 6, flexShrink: 0 }}>
          <input
            autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search parties…"
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 5, color: 'var(--text)', fontSize: 12.5, padding: '5px 8px', outline: 'none' }}
          />
        </div>
      </div>
    </>
  )
}

// ── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const { combatants, diceResults, selectCombatant } = useCombatStore()
  const clearAllCombatants = useCombatStore(s => s.clearAllCombatants)
  const isEncounterUnchanged = useCombatStore(s => s.isEncounterUnchanged)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  // Track window maximize state so the maximize button shows a restore-down
  // icon while maximized.
  const [isMaximized, setIsMaximized] = useState(true)
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onMaximizeChange) return
    void api.winIsMaximized?.().then(setIsMaximized)
    return api.onMaximizeChange(setIsMaximized)
  }, [])
  const { parties, activePartyId, addParty, toggleFavorite, setActiveParty } = usePartyStore()
  const activeTheme = useSettingsStore(s => s.theme)
  const showInitCollapse = useSettingsStore(s => s.showInitCollapseButton)

  // Repaint the window / taskbar / alt-tab icon to match the active theme.
  // Runs on first mount (so the icon flips from the build-time default to
  // the user's persisted theme before anyone sees the taskbar) and on every
  // theme change. The CSS variables on <html> are applied synchronously by
  // settingsStore so reading them here always returns the correct values.
  useEffect(() => {
    void updateTaskbarIcon()
  }, [activeTheme])

  const [showSearch, setShowSearch] = useState(false)
  const [showGlobalSearch, setShowGlobalSearch] = useState(false)
  const [showEncounters, setShowEncounters] = useState(false)
  const [showCustom, setShowCustom] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAddParty, setShowAddParty] = useState(false)
  const [mainFocus, setMainFocus] = useState<'combatant' | 'party' | 'gm'>('combatant')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('pf2e-sidebar-collapsed') === '1')
  const setSidebarCollapsedPersist = (v: boolean) => {
    setSidebarCollapsed(v)
    try { localStorage.setItem('pf2e-sidebar-collapsed', v ? '1' : '0') } catch { /* ignore */ }
  }

  const [sidebarWidth, setSidebarWidth] = useState(256)
  // Minimum width of the sidebar = the width needed to fit the 3 in-combat
  // buttons (Prev / Next / End). Reported by InitiativeTracker after measuring.
  const [sidebarMinWidth, setSidebarMinWidth] = useState(220)
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, width: 0 })

  const chipsContainerRef = useRef<HTMLDivElement>(null)
  // Party-chip overflow → offer a dropdown of ALL parties instead of a scrollbar.
  const [partyOverflow, setPartyOverflow] = useState(false)
  const [partyMenuOpen, setPartyMenuOpen] = useState(false)

  // Translate vertical mouse-wheel into horizontal scroll on the party-chip
  // strip so the user can page through parties that overflow the topbar.
  // Attached as a non-passive native listener so we can preventDefault and
  // stop the topbar's drag region / parent scrolling from swallowing it.
  useEffect(() => {
    const el = chipsContainerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
      if (!delta) return
      e.preventDefault()
      el.scrollLeft += delta
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const sortedParties = useMemo(() => {
    const favs = parties.filter(p => p.isFavorite).sort((a, b) => a.name.localeCompare(b.name))
    const rest = parties.filter(p => !p.isFavorite).sort((a, b) => a.name.localeCompare(b.name))
    return [...favs, ...rest]
  }, [parties])

  // Show the party-overflow dropdown when the chips no longer all fit.
  useEffect(() => {
    const el = chipsContainerRef.current
    if (!el) return
    const check = () => setPartyOverflow(el.scrollWidth > el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sortedParties])

  const handleCombatantClick = useCallback((id: string) => {
    selectCombatant(id)
    useLayoutStore.getState().open(id)   // open (or focus) the creature as a pane tab
    setMainFocus('combatant')
  }, [selectCombatant])

  useEffect(() => {
    if (mainFocus === 'party' && activePartyId && !parties.find(p => p.id === activePartyId)) {
      setMainFocus('combatant')
    }
  }, [parties, activePartyId, mainFocus])

  const handleAddParty = (name: string, level: number) => {
    const id = addParty(name, level)
    setActiveParty(id)
    setMainFocus('party')
    setShowAddParty(false)
  }

  const handlePartyChipClick = (partyId: string) => {
    // partyStore.setActiveParty toggles off when called with the currently-active
    // id. We always want a single click to *show* the party — only call
    // setActiveParty when the id is actually changing.
    if (activePartyId !== partyId) setActiveParty(partyId)
    setMainFocus('party')
  }

  const onDragStart = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    dragStart.current = { x: e.clientX, width: sidebarWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [sidebarWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      setSidebarWidth(Math.min(480, Math.max(sidebarMinWidth, dragStart.current.width + e.clientX - dragStart.current.x)))
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [sidebarMinWidth])

  // If the dynamically measured min width grows past the current sidebar width
  // (font load, etc.), bump the sidebar so the buttons never get clipped.
  useEffect(() => {
    if (sidebarWidth < sidebarMinWidth) setSidebarWidth(sidebarMinWidth)
  }, [sidebarMinWidth, sidebarWidth])

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      window.electronAPI?.zoomBy(e.deltaY < 0 ? 1 : -1)
    }
    document.addEventListener('wheel', onWheel, { passive: false })
    return () => document.removeEventListener('wheel', onWheel)
  }, [])

  // Pre-fetch the bestiary index and custom creatures in the background so
  // the Add Combatants modal opens instantly on first click.  index.json is
  // ~830 KB; deferring its first load until the user clicks Add adds 100-300ms
  // of perceived lag.
  useEffect(() => {
    const id = setTimeout(() => {
      void loadIndex().catch(() => {/* ignore */})
      void loadCustomCreatures()
    }, 200)  // Tiny stagger so it doesn't fight the initial paint
    return () => clearTimeout(id)
  }, [])

  // Ctrl/Cmd+K opens the global reference search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setShowGlobalSearch(true)
        return
      }
      // Undo / redo combat edits (damage, conditions, defeat…). Skip while the
      // user is typing in a field so the browser's own text undo still works.
      if (e.ctrlKey || e.metaKey) {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
        const key = e.key.toLowerCase()
        if (key === 'z' && !e.shiftKey) { e.preventDefault(); useCombatStore.getState().undo() }
        else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); useCombatStore.getState().redo() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const layoutRoot = useLayoutStore(s => s.root)
  const showParty = mainFocus === 'party' && activePartyId && parties.find(p => p.id === activePartyId)
  const showGM = mainFocus === 'gm'

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* ── Title bar ── */}
      <header
        className="flex items-center shrink-0"
        style={{
          padding: '10px 14px',
          gap: 16,
          background: 'linear-gradient(180deg, var(--bg-header-top), var(--bg-header-bottom))',
          borderBottom: 'var(--app-bw) solid var(--border)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        {/* Brand + Add Party — the title text was removed; the Party button now
            sits directly beside the logo. */}
        <div
          className="shrink-0 flex items-center"
          style={{ gap: 8, padding: '4px 2px 4px 4px', WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {/* Heroes Heaven's brand mark. It paints with currentColor, so the accent flows in from
              the theme — same logo, same colour rule as the builder's chrome. */}
          <HeroesHeavenLogo size={22} className="hh-brand" />
          <button
            onClick={() => setShowAddParty(true)}
            className="btn btn-secondary shrink-0"
            // Match the party chip's vertical metrics exactly (padding / font-size)
            // so the button reads as the leading "slot" in the chip strip.
            style={{
              WebkitAppRegion: 'no-drag',
              padding: '5px 11px',
              fontSize: 12.5,
              fontWeight: 500,
              fontFamily: 'var(--font-ui)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              lineHeight: 1.2,
            } as React.CSSProperties}
          >
            <PlusIcon size={15} /> Party
          </button>
        </div>

        <div className="flex items-center flex-1 min-w-0" style={{ gap: 4 }}>

          <div
            ref={chipsContainerRef}
            className="party-chip-strip flex items-center flex-1 min-w-0"
            style={{ gap: 4, overflowX: 'hidden', overflowY: 'hidden', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {sortedParties.map(p => (
              <PartyChip key={p.id} party={p}
                isActive={p.id === activePartyId && mainFocus === 'party'}
                onClick={() => handlePartyChipClick(p.id)}
                onRightClick={() => toggleFavorite(p.id)}
              />
            ))}
          </div>

          {/* When the chips overflow, a ▾ button opens a menu of every party
              (with a search at the bottom) — used instead of a scrollbar. */}
          {partyOverflow && (
            <div style={{ position: 'relative', flexShrink: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <button
                onClick={() => setPartyMenuOpen(o => !o)}
                title="All parties"
                className="btn btn-secondary btn-sm"
                style={{ padding: '5px 7px', display: 'inline-flex', alignItems: 'center' }}
              >
                <ChevronRightIcon size={13} style={{ transform: 'rotate(90deg)' }} />
              </button>
              {partyMenuOpen && (
                <PartyMenu
                  parties={sortedParties}
                  activePartyId={activePartyId}
                  isPartyFocus={mainFocus === 'party'}
                  onPick={id => { handlePartyChipClick(id); setPartyMenuOpen(false) }}
                  onToggleFav={toggleFavorite}
                  onClose={() => setPartyMenuOpen(false)}
                />
              )}
            </div>
          )}
        </div>

        <div className="flex items-center shrink-0" style={{ gap: 6 }}>
          {diceResults.length > 0 && (
            <span style={{
              color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
              fontSize: 11.5, marginRight: 4,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <DiceIcon size={12} />
              {diceResults[0]?.total}
            </span>
          )}
          <TurnTimerWidget />
          <button className="btn btn-secondary btn-sm"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title="Search everything — conditions, spells, items, traits, actions, skills (Ctrl+K)"
            onClick={() => setShowGlobalSearch(true)}>
            <SearchIcon size={12} /> Search
          </button>
          <button className="btn btn-secondary btn-sm"
            style={{
              WebkitAppRegion: 'no-drag',
              ...(mainFocus === 'gm' ? { borderColor: 'var(--accent-line)', color: 'var(--accent)' } : {}),
            } as React.CSSProperties}
            title="GM Screen — saved notes & references kept across every combat"
            onClick={() => setMainFocus(f => (f === 'gm' ? 'combatant' : 'gm'))}>
            <ScreenIcon size={12} /> GM Screen
          </button>
          <button className="btn btn-secondary btn-sm"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => setShowCustom(true)}>
            <PencilIcon size={12} /> Custom
          </button>
          <button className="btn btn-secondary btn-sm"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => setShowEncounters(true)}>
            <SaveIcon size={12} /> Encounters
          </button>
          {/* Heroes Heaven's nav hamburger, top-right, exactly as in the builder's chrome. It
              carries its own Settings entry, so it REPLACES the old gear button.
              `items` is empty for now: the builder's other destinations (Characters / Homebrew /
              Campaigns) only exist once the apps are connected — see DEFERRED.md §4. */}
          <span className="hh-menu-slot" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <PageMenu items={[]} onOpenSettings={() => setShowSettings(true)} />
          </span>
          {window.electronAPI && (
            // Window controls stretch the full header height and out to the
            // top-right corner (negative margins cancel the header's padding)
            // so they're flush with the screen edge when maximized — you can
            // slam the cursor into the corner to hit Close (Fitts's law).
            (() => {
              // Each button spans the FULL header height (content + the
              // header's 10px vertical padding) and the container's negative
              // right margin cancels the 14px right padding — so the buttons
              // are flush with the window's top + right edges when maximized.
              const winBtn: React.CSSProperties = {
                width: 44, height: 'calc(100% + 20px)', marginTop: -10,
                display: 'grid', placeItems: 'center',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-faded)', transition: 'background 0.15s, color 0.15s',
                WebkitAppRegion: 'no-drag',
              } as React.CSSProperties
              return (
            <div className="flex" style={{
              alignSelf: 'stretch', marginLeft: 10, marginRight: -14,
            }}>
              <button onClick={() => window.electronAPI!.winMinimize()} title="Minimize"
                style={winBtn}
                onMouseEnter={e=>{e.currentTarget.style.background='var(--bg-hover)'; e.currentTarget.style.color='var(--text)'}}
                onMouseLeave={e=>{e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--text-faded)'}}
              ><MinimizeIcon size={12} /></button>
              <button onClick={() => window.electronAPI!.winToggleMaximize()} title={isMaximized ? 'Restore down' : 'Maximize'}
                style={winBtn}
                onMouseEnter={e=>{e.currentTarget.style.background='var(--bg-hover)'; e.currentTarget.style.color='var(--text)'}}
                onMouseLeave={e=>{e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--text-faded)'}}
              >{isMaximized ? <WindowRestoreIcon size={12} /> : <MaximizeIcon size={11} />}</button>
              <button onClick={() => window.electronAPI!.winClose()} title="Close"
                style={winBtn}
                onMouseEnter={e=>{e.currentTarget.style.background='var(--danger)';e.currentTarget.style.color='#fff'}}
                onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text-faded)'}}
              ><XIcon size={15} /></button>
            </div>
              )
            })()
          )}
        </div>
      </header>

      {/* ── Main layout ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden" style={{ position: 'relative' }}>

        {showInitCollapse && sidebarCollapsed && (
          // Collapsed — a small drawer handle at the TOP-LEFT, sitting on the
          // same line as the stat-block name. The main content is nudged right
          // (paddingLeft below) so the handle never overlaps the name.
          <button
            onClick={() => setSidebarCollapsedPersist(false)}
            title="Show initiative order"
            style={{
              position: 'absolute', left: 0, top: 8, zIndex: 30,
              width: 22, height: 28, padding: 0, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '0 8px 8px 0',
              background: 'var(--bg-elevated)', color: 'var(--text-muted)',
              border: 'var(--app-bw) solid var(--border-strong)', borderLeft: 'none',
              boxShadow: 'var(--shadow-md)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-muted)' }}
          ><ChevronRightIcon size={13} /></button>
        )}

        <aside style={{
          width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth,
          background: 'var(--bg-base)', borderRight: 'var(--app-bw) solid var(--border)',
          display: (showInitCollapse && sidebarCollapsed) ? 'none' : undefined,
        }}
          className="shrink-0 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden flex flex-col">
            <InitiativeTracker
              onCombatantClick={handleCombatantClick}
              onMinWidthMeasured={setSidebarMinWidth}
              onCollapse={showInitCollapse ? () => setSidebarCollapsedPersist(true) : undefined}
            />
          </div>
          <div style={{ padding: '10px', borderTop: 'var(--app-bw) solid var(--border)', flexShrink: 0, display: 'flex', gap: 6 }}>
            <button
              onClick={() => setShowSearch(true)}
              style={{
                flex: 1, minWidth: 0,
                fontFamily: 'var(--font-ui)',
                fontSize: 12.5, padding: '9px',
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px dashed var(--border-strong)',
                borderRadius: 'var(--radius)', cursor: 'pointer', textAlign: 'center',
                transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent-line)'; e.currentTarget.style.background = 'var(--accent-soft)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.background = 'transparent' }}
            >
              <PlusIcon size={12} /> Add Combatants
            </button>
            {/* Clear initiative — disabled when the tracker is already empty
                so users don't get a confirmation prompt for a no-op. When the
                board still matches the last saved/loaded encounter, skip the
                prompt entirely (nothing is lost — it can be reloaded). */}
            <button
              onClick={() => { if (isEncounterUnchanged()) clearAllCombatants(); else setShowClearConfirm(true) }}
              disabled={combatants.length === 0}
              title={combatants.length === 0 ? 'Initiative is already empty' : 'Remove every combatant from the tracker'}
              style={{
                flexShrink: 0,
                fontFamily: 'var(--font-ui)',
                fontSize: 12.5, padding: '9px 12px',
                background: 'transparent',
                color: combatants.length === 0 ? 'var(--text-faded)' : 'var(--danger)',
                border: `1px dashed ${combatants.length === 0 ? 'var(--border)' : 'var(--danger)'}`,
                borderRadius: 'var(--radius)',
                cursor: combatants.length === 0 ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                opacity: combatants.length === 0 ? 0.5 : 1,
              }}
              onMouseEnter={e => {
                if (combatants.length === 0) return
                e.currentTarget.style.background = 'var(--danger)'
                e.currentTarget.style.color = '#fff'
                e.currentTarget.style.borderStyle = 'solid'
              }}
              onMouseLeave={e => {
                if (combatants.length === 0) return
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--danger)'
                e.currentTarget.style.borderStyle = 'dashed'
              }}
            >
              <XIcon size={12} /> Clear
            </button>
          </div>
        </aside>

        {!(showInitCollapse && sidebarCollapsed) && (
          <div onMouseDown={onDragStart} style={{
            width: 3, flexShrink: 0, cursor: 'col-resize',
            background: 'transparent', borderRight: 'var(--app-bw) solid var(--border)',
            transition: 'background 0.15s',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-line)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          />
        )}

        <main className="flex-1 overflow-hidden flex flex-col min-w-0" style={{ background: 'var(--bg-panel)', paddingLeft: (showInitCollapse && sidebarCollapsed) ? 26 : undefined }}>
          <ErrorBoundary label="this view" resetKeys={[mainFocus, activePartyId, layoutRoot]}>
          {showParty ? (
            <PartyView partyId={activePartyId!} />
          ) : showGM ? (
            <GMScreen />
          ) : layoutRoot ? (
            <PaneLayout combatants={combatants} />
          ) : (
            <div data-dock-empty="" className="flex-1 flex flex-col items-center justify-center gap-5 p-6" style={{ color: 'var(--text-faded)' }}>
              <div style={{ fontSize: 56, opacity: 0.15 }}>⚔</div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 500, fontSize: 28, letterSpacing: '-0.02em',
                color: 'var(--text)',
              }}>Pathfinder 2e Initiative Tracker</div>
              <div style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 13.5, maxWidth: 420, textAlign: 'center', lineHeight: 1.65,
                color: 'var(--text-muted)',
              }}>
                Add creatures with <strong style={{ color: 'var(--text)', fontWeight: 600 }}>+ Add Combatants</strong>,
                set their initiative (click the — to edit), then click{' '}
                <strong style={{ color: 'var(--text)', fontWeight: 600 }}>▶ Start Combat</strong>.
                <br /><br />
                Click a party chip to manage your party, or click a combatant to view their stat block.
              </div>
              {combatants.length === 0 && (
                <button className="btn btn-primary" onClick={() => setShowSearch(true)} style={{ marginTop: 4 }}>
                  <PlusIcon size={13} /> Add Combatants
                </button>
              )}
            </div>
          )}
          </ErrorBoundary>
        </main>
      </div>

      {showSearch && <MonsterSearch onClose={() => setShowSearch(false)} />}
      {showGlobalSearch && (
        <GlobalSearch
          onClose={() => setShowGlobalSearch(false)}
          title={mainFocus === 'gm' ? 'Add to GM Screen' : undefined}
          onPick={mainFocus === 'gm'
            ? (h) => {
                const gm = useGmLayoutStore.getState()
                // Empty workspace → open it full (a single pane). Already has
                // panes → float a popup so it can be docked wherever you want.
                if (!gm.root) gm.addPopup({ type: h.type, ref: h.ref, title: h.title })
                else useWindowStore.getState().open(h.type, h.ref, h.title)
              }
            : undefined}
        />
      )}
      {showEncounters && <EncounterManager onClose={() => setShowEncounters(false)} />}
      {showCustom && <TextConverter onClose={() => setShowCustom(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showAddParty && <AddPartyDialog onDone={handleAddParty} onCancel={() => setShowAddParty(false)} />}
      {showClearConfirm && (
        <div className="modal-overlay" style={{ zIndex: 2100 }}
          onClick={e => e.target === e.currentTarget && setShowClearConfirm(false)}>
          <div className="modal-box" style={{ maxWidth: 420, padding: 18 }}>
            <h3 style={{
              margin: '0 0 10px',
              fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600,
              color: 'var(--danger)',
            }}>Clear the initiative tracker?</h3>
            <p style={{
              margin: '0 0 14px',
              fontFamily: 'var(--font-ui)', fontSize: 12.5, lineHeight: 1.55,
              color: 'var(--text-muted)',
            }}>
              This removes all {combatants.length} combatant{combatants.length === 1 ? '' : 's'} from the tracker
              and ends combat if it's running. Your saved encounters and parties are not touched.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowClearConfirm(false)}>Cancel</button>
              <button
                onClick={() => { clearAllCombatants(); setShowClearConfirm(false) }}
                style={{
                  background: 'var(--danger)', color: '#fff',
                  border: 'var(--app-bw) solid var(--danger)', borderRadius: 'var(--radius-sm)',
                  padding: '6px 14px', fontSize: 12.5, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'var(--font-ui)',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              ><XIcon size={12} /> Clear all</button>
            </div>
          </div>
        </div>
      )}

      <DiceOverlay />
      <FloatingWindowLayer />
      <UpdateNotice />
    </div>
  )
}
