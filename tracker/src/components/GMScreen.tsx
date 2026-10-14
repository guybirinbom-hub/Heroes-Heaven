import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useGmLayoutStore, type PaneNode, type PopupRef } from '../store/layoutStore'
import { toLayoutTab } from '../store/windowStore'
import { useCombatStore } from '../store/combatStore'
import { PaneLayout } from './PaneLayout'
import { GlobalSearch } from './GlobalSearch'
import { PlusIcon, ScreenIcon } from './Icons'
import { GM_WIDGETS, newWidgetRef } from './GmWidgets'
import { useEscapeCloses } from '../utils/spendEscape'

// ── GM Screen ────────────────────────────────────────────────────────────────
// A free workspace, kept across combats. You pull in references via search,
// then arrange them with the SAME tools the popups already have — the ⠿ block
// handle to tile them, the tab button to stack them as tabs, split dividers to
// resize. It's just a second PaneLayout backed by its own persisted store.

function EmptyWorkspace({ onAdd }: { onAdd: () => void }) {
  // `data-dock-empty` + `data-layout-scope="gm"` make this blank area a valid
  // drop target, so a popup dragged by its ⠿ handle docks straight in here.
  return (
    <div
      data-dock-empty=""
      data-layout-scope="gm"
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24,
      }}
    >
      <ScreenIcon size={46} style={{ color: 'var(--text-faded)', opacity: 0.18 }} />
      <div style={{
        fontFamily: 'var(--font-ui)', fontSize: 13.5, maxWidth: 460,
        textAlign: 'center', lineHeight: 1.7, color: 'var(--text-muted)',
      }}>
        An empty workspace. <strong style={{ color: 'var(--text)' }}>Add a reference</strong>
        {' '}(spell, condition, item, action, skill), then arrange it with the same tools the
        popups use — drag the <strong style={{ color: 'var(--text)' }}>⠿</strong> handle to tile
        it, or the <strong style={{ color: 'var(--text)' }}>tab</strong> button to stack
        references as tabs.
      </div>
      <button className="btn btn-primary" onClick={onAdd}>
        <PlusIcon size={12} /> Add Reference
      </button>
    </div>
  )
}

/** The tree with `fix` applied to every tab — the same objects back wherever nothing changed. */
function mapTabs(n: PaneNode, fix: (t: PopupRef) => PopupRef): PaneNode {
  if (n.kind === 'leaf') {
    const tabs = n.tabs.map(fix)
    return tabs.every((t, i) => t === n.tabs[i]) ? n : { ...n, tabs }
  }
  const a = mapTabs(n.a, fix)
  const b = mapTabs(n.b, fix)
  return a === n.a && b === n.b ? n : { ...n, a, b }
}

/**
 * A CREATURE PINNED HERE IS A BESTIARY PIN, BY EVERY ROUTE (item 7 of the owner's online list: "if i
 * search a stat block it needs to open the full stat block (and there needs to be able to put it in the
 * initiative order)").
 *
 * This screen's layout reads a 'creature' tab as a LIVE combatant id, and it reconciles against no
 * combatants at all (`combatants={[]}` below), so every creature tab that reached it was pruned the
 * moment it landed: the Random Encounter widget's "Preview", the standalone app's Add-to-GM-screen pick
 * (App.tsx), any route still to come. (The widget's Preview now pins a 'bestiary' tab itself, and away
 * from this screen opens a window — RandomEncounterWidget; a creature tab it stored before is still
 * turned here, on mount.) A creature named here (no row on the board) is turned into the
 * 'bestiary' tab the layout keeps (windowStore toLayoutTab) — the full stat block with "Add to
 * initiative". Run on mount (a layout effect: before the layout's own reconcile, a passive effect, gets
 * to it) and on every change of this screen's tree while it is up. Exported for the test.
 */
export function keepBestiaryPins(): void {
  const { root } = useGmLayoutStore.getState()
  if (!root) return
  const ids = new Set(useCombatStore.getState().combatants.map(c => c.id))
  const next = mapTabs(root, t => toLayoutTab(t, id => ids.has(id)))
  if (next !== root) useGmLayoutStore.setState({ root: next })
}

const addItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)',
  color: 'var(--text)', fontFamily: 'var(--font-ui)', fontSize: 13,
  padding: '7px 9px', cursor: 'pointer',
}

/*
 * ESCAPE AND BACK CLOSE THIS SCREEN'S OWN PICKERS, ONE AT A TIME (owner's list 2026-10-14, item 3). The +
 * menu had no Escape at all, and neither it nor the "Add to GM Screen" picker had a Back: inside a Heroes
 * Heaven campaign, Back on the phone with either open LEFT THE CAMPAIGN. Each registers as one of the
 * tracker's layers while it is open (utils/spendEscape useEscapeCloses): Escape closes it and goes no
 * further, and the host's Back handler closes it (CampaignTracker closeTopTrackerModal). The + menu is a
 * panel with no backdrop round it (`panel`; its tap-catcher is a sibling), drawn in the page under the
 * floating windows: a window over all of it is the layer on top, and the host closes that window first.
 * modalEscape.test.tsx (GM screen), test/bug-tracker-escape-boxes.test.tsx (GM screen, BACK).
 *
 * A PRESS OR A FOCUS ANYWHERE ELSE CLOSES THE + MENU. Its tap-catcher covers the GM screen only: the top
 * bar, the initiative rail and the windows stay within reach while it is open. The palette button there
 * opened Customize (z 60) over all of the menu, and then neither Escape nor Back did anything at all: the
 * menu, covered all over, left both to the layer on top, while the campaign's Back handler for the
 * tracker's layers — a cover — kept Customize's own handler (drawn under the layers) off the stack (the
 * escape-lane refuter, 2026-10-14). A menu is gone the moment the GM turns elsewhere, so nothing can open
 * over it: a mouse or finger press outside it, its tap-catcher and the + (which toggles it), or the focus
 * moving there (Tab to a button and Enter presses no mouse). test/bug-tracker-escape-boxes.test.tsx (k).
 */
function AddMenu({ onClose, onAdd, fab }: {
  onClose: () => void
  onAdd: (kind: string, label: string) => void
  fab: RefObject<HTMLButtonElement | null>
}) {
  const escapeRef = useEscapeCloses(onClose, { panel: true })
  const panel = useRef<HTMLDivElement | null>(null)
  const catcher = useRef<HTMLDivElement | null>(null)
  const panelRef = useCallback((el: HTMLDivElement | null) => {
    panel.current = el
    escapeRef(el)
  }, [escapeRef])
  useEffect(() => {
    const elsewhere = (e: Event) => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (panel.current?.contains(t) || catcher.current?.contains(t) || fab.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('mousedown', elsewhere)
    document.addEventListener('focusin', elsewhere)
    return () => {
      document.removeEventListener('mousedown', elsewhere)
      document.removeEventListener('focusin', elsewhere)
    }
  }, [onClose, fab])
  return (
    <>
      <div ref={catcher} onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 40 }} />
      <div ref={panelRef} style={{
        position: 'absolute', bottom: 74, right: 18, zIndex: 41, width: 232,
        background: 'var(--bg-panel)', border: 'var(--app-bw) solid var(--border-strong)',
        borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', padding: 6,
      }}>
        <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faded)', padding: '4px 9px 6px' }}>Add to GM screen</div>
        {GM_WIDGETS.map(w => (
          <button key={w.kind} style={addItemStyle}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            onClick={() => onAdd(w.kind, w.label)}>
            <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)' }}><w.Icon size={16} /></span> {w.label}
          </button>
        ))}
      </div>
    </>
  )
}

/** The "Add to GM Screen" picker, registered while it is open (see above). */
function AddReferencePicker({ onClose }: { onClose: () => void }) {
  const escapeRef = useEscapeCloses(onClose)
  return (
    <GlobalSearch
      title="Add to GM Screen"
      escapeRef={escapeRef}
      onClose={onClose}
      onPick={h => {
        // A creature picked here is a bestiary name, not a row on the board: keepBestiaryPins (above)
        // turns it into a 'bestiary' tab the moment it lands — its full stat block, with "Add to
        // initiative" — before the layout's reconcile could prune it.
        useGmLayoutStore.getState().addPopup({ type: h.type, ref: h.ref, title: h.title })
        onClose()
      }}
    />
  )
}

export function GMScreen() {
  const root = useGmLayoutStore(s => s.root)
  const [picking, setPicking] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const fabRef = useRef<HTMLButtonElement | null>(null)

  useLayoutEffect(() => {
    keepBestiaryPins()
    return useGmLayoutStore.subscribe((s, p) => { if (s.root !== p.root) keepBestiaryPins() })
  }, [])

  const addWidget = (kind: string, label: string) => {
    useGmLayoutStore.getState().addPopup({ type: 'widget', ref: newWidgetRef(kind), title: label })
    setMenuOpen(false)
  }
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const closePicker = useCallback(() => setPicking(false), [])

  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ background: 'var(--bg-panel)', position: 'relative' }}>
      {/* No header — it's a bare workspace. Add references / tools via the + FAB
          (bottom-right) or the top-bar Search; the empty state shows a hint. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {root
          ? <PaneLayout combatants={[]} store={useGmLayoutStore} scope="gm" />
          : <EmptyWorkspace onAdd={() => setPicking(true)} />}
      </div>

      {/* Add menu — opened by the + FAB; backdrop click, a press elsewhere, Escape and Back close it. */}
      {menuOpen && <AddMenu onClose={closeMenu} onAdd={addWidget} fab={fabRef} />}

      {/* + floating action button */}
      <button
        ref={fabRef}
        onClick={() => setMenuOpen(o => !o)}
        title="Add to GM screen"
        style={{
          position: 'absolute', bottom: 18, right: 18, zIndex: 42,
          width: 46, height: 46, borderRadius: '50%',
          background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none',
          display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: 'var(--shadow-lg)',
          transform: menuOpen ? 'rotate(45deg)' : 'none', transition: 'transform 0.15s',
        }}
      >
        <PlusIcon size={20} />
      </button>

      {picking && <AddReferencePicker onClose={closePicker} />}
    </div>
  )
}
