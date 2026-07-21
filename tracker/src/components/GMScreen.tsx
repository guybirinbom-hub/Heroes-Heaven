import { useState } from 'react'
import { useGmLayoutStore } from '../store/layoutStore'
import { PaneLayout } from './PaneLayout'
import { GlobalSearch } from './GlobalSearch'
import { PlusIcon, ScreenIcon } from './Icons'
import { GM_WIDGETS, newWidgetRef } from './GmWidgets'

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

const addItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)',
  color: 'var(--text)', fontFamily: 'var(--font-ui)', fontSize: 13,
  padding: '7px 9px', cursor: 'pointer',
}

export function GMScreen() {
  const root = useGmLayoutStore(s => s.root)
  const [picking, setPicking] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const addWidget = (kind: string, label: string) => {
    useGmLayoutStore.getState().addPopup({ type: 'widget', ref: newWidgetRef(kind), title: label })
    setMenuOpen(false)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ background: 'var(--bg-panel)', position: 'relative' }}>
      {/* No header — it's a bare workspace. Add references / tools via the + FAB
          (bottom-right) or the top-bar Search; the empty state shows a hint. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {root
          ? <PaneLayout combatants={[]} store={useGmLayoutStore} scope="gm" />
          : <EmptyWorkspace onAdd={() => setPicking(true)} />}
      </div>

      {/* Add menu — opened by the + FAB; backdrop click closes it. */}
      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={{ position: 'absolute', inset: 0, zIndex: 40 }} />
          <div style={{
            position: 'absolute', bottom: 74, right: 18, zIndex: 41, width: 232,
            background: 'var(--bg-panel)', border: 'var(--app-bw) solid var(--border-strong)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: 6,
          }}>
            <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faded)', padding: '4px 9px 6px' }}>Add to GM screen</div>
            {GM_WIDGETS.map(w => (
              <button key={w.kind} style={addItemStyle}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => addWidget(w.kind, w.label)}>
                <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)' }}><w.Icon size={16} /></span> {w.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* + floating action button */}
      <button
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

      {picking && (
        <GlobalSearch
          title="Add to GM Screen"
          onClose={() => setPicking(false)}
          onPick={h => {
            useGmLayoutStore.getState().addPopup({ type: h.type, ref: h.ref, title: h.title })
            setPicking(false)
          }}
        />
      )}
    </div>
  )
}
