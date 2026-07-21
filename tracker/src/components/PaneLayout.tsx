import { createContext, useContext, useMemo, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Combatant } from '../types/pf2e'
import { useLayoutStore, DRAG_MIME, paneCount, type PaneNode, type SplitNode, type LeafNode, type PopupRef, type Zone, type LayoutStoreHook } from '../store/layoutStore'
import { useCombatStore } from '../store/combatStore'
import { useSettingsStore } from '../store/settingsStore'
import { useDockDrag, beginDockDrag } from '../store/dockDragStore'
import { CombatantDetail } from './CombatantDetail'
import { usePcPaneRenderer } from '../data/pcPaneContext'
import { PopupPreview } from './FloatingWindow'
import { XIcon } from './Icons'

// PaneLayout drives either the combat tiling or the GM Screen workspace. The
// active store, a `scope` tag, and the live pane count travel down via context
// so the same panes/handles operate on whichever store owns them, and the
// ⠿/tabs tools only appear when there's more than one pane to arrange.
interface LayoutScope { useStore: LayoutStoreHook; scope: string; paneCount: number }
const LayoutScopeCtx = createContext<LayoutScope>({ useStore: useLayoutStore, scope: 'combat', paneCount: 1 })
const useLayoutCtx = () => useContext(LayoutScopeCtx)

// ── Root ─────────────────────────────────────────────────────────────────────
export function PaneLayout({ combatants, store = useLayoutStore, scope = 'combat' }: {
  combatants: Combatant[]
  store?: LayoutStoreHook
  scope?: string
}) {
  const root = store(s => s.root)
  const reconcile = store(s => s.reconcile)
  const byId = useMemo(() => new Map(combatants.map(c => [c.id, c])), [combatants])

  useEffect(() => { reconcile(new Set(combatants.map(c => c.id))) }, [combatants, reconcile])

  if (!root) return null
  const leafCount = paneCount(root)
  return (
    <LayoutScopeCtx.Provider value={{ useStore: store, scope, paneCount: leafCount }}>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', padding: root.kind === 'leaf' ? 0 : 3 }}>
        <NodeView node={root} byId={byId} solo={root.kind === 'leaf'} />
      </div>
    </LayoutScopeCtx.Provider>
  )
}

function NodeView({ node, byId, solo = false }: { node: PaneNode; byId: Map<string, Combatant>; solo?: boolean }) {
  return node.kind === 'split'
    ? <SplitView node={node} byId={byId} />
    : <LeafView leaf={node} byId={byId} solo={solo} />
}

// ── Split (two panes + a draggable divider) ──────────────────────────────────
function SplitView({ node, byId }: { node: SplitNode; byId: Map<string, Combatant> }) {
  const { useStore } = useLayoutCtx()
  const resize = useStore(s => s.resize)
  const ref = useRef<HTMLDivElement>(null)
  const row = node.dir === 'row'

  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const move = (ev: MouseEvent) => {
      const r = ref.current?.getBoundingClientRect(); if (!r) return
      resize(node.id, row ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    document.body.style.cursor = row ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const pane = (n: PaneNode, grow: number) => (
    <div style={{ flexBasis: 0, flexGrow: grow, minWidth: 0, minHeight: 0, display: 'flex' }}>
      <NodeView node={n} byId={byId} />
    </div>
  )

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: row ? 'row' : 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
      {pane(node.a, node.split)}
      <div onMouseDown={onResizeDown} title="Drag to resize"
        style={{
          flex: 'none', alignSelf: 'stretch',
          width: row ? 6 : undefined, height: row ? undefined : 6,
          cursor: row ? 'col-resize' : 'row-resize',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        <div style={{ background: 'var(--border-strong)', borderRadius: 2, width: row ? 2 : 24, height: row ? 24 : 2 }} />
      </div>
      {pane(node.b, 1 - node.split)}
    </div>
  )
}

// ── Leaf (a tabbed stack of creatures and/or popups) ─────────────────────────
function LeafView({ leaf, byId, solo = false }: { leaf: LeafNode; byId: Map<string, Combatant>; solo?: boolean }) {
  const { useStore, scope } = useLayoutCtx()
  const { drop, setHovered } = useStore()
  const hoveredLeaf = useStore(s => s.hoveredLeaf)
  const selectCombatant = useCombatStore(s => s.selectCombatant)
  const [zone, setZone] = useState<Zone | null>(null)
  const isHovered = hoveredLeaf === leaf.id

  const dragMode = useDockDrag(s => s.drag?.mode)
  const dockZone = useDockDrag(s => (s.drag && s.hover?.kind === 'pane' && s.hover.leafId === leaf.id) ? s.hover.zone : null)
  const mergeHere = useDockDrag(s => s.mergeHover?.kind === 'leaf' && s.mergeHover.id === leaf.id)

  const zoneFor = (e: React.DragEvent): Zone => {
    const r = e.currentTarget.getBoundingClientRect()
    const rx = (e.clientX - r.left) / r.width
    const ry = (e.clientY - r.top) / r.height
    if (rx < 0.22) return 'left'
    if (rx > 0.78) return 'right'
    if (ry < 0.22) return 'top'
    if (ry > 0.78) return 'bottom'
    return 'center'
  }
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
    setZone(zoneFor(e))
  }
  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    const z = zoneFor(e); setZone(null)
    const cid = e.dataTransfer.getData(DRAG_MIME)
    if (cid) { drop(leaf.id, cid, z); selectCombatant(cid) }
  }

  // Box drag (⠿) or a creature dropped from the order → gold split zones.
  // Tab drag (tabs button / chip / a floating popup) → a full-pane "stack as a
  // tab" highlight, no window-split outline.
  const boxZone = zone ?? (dragMode === 'box' ? dockZone : null)
  const tabbing = (dragMode === 'tab' && dockZone != null) || mergeHere

  return (
    <div
      data-pane-leaf={leaf.id}
      data-pane-kind="popup"
      data-layout-scope={scope}
      onMouseEnter={() => setHovered(leaf.id)}
      onDragOver={onDragOver}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null) }}
      onDrop={onDrop}
      style={{
        flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column',
        position: 'relative', overflow: 'hidden',
        margin: solo ? 0 : 2,
        border: `var(--app-bw) solid ${solo ? 'transparent' : (isHovered ? 'var(--accent-line)' : 'var(--border)')}`,
        borderRadius: solo ? 0 : 6, background: 'var(--bg-panel)',
      }}
    >
      <PaneBody leaf={leaf} byId={byId} />
      {boxZone && <DropHint zone={boxZone} />}
      {tabbing && <TabHint />}
    </div>
  )
}

/** Slim "drop here to stack as a tab" highlight — a band across the pane's top
 *  (where the tab strip / header sits), NOT a full-pane box. Moving a tab is not
 *  making a new window, so it shouldn't look like the gold window-split zones. */
function TabHint() {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, top: 0, height: 44, zIndex: 6, pointerEvents: 'none',
      background: 'var(--accent-soft)', borderBottom: '2px solid var(--accent)', borderRadius: '6px 6px 0 0',
    }} />
  )
}

// ── Pane body — one tabbed stack rendering creatures and/or popups ───────────
function PaneBody({ leaf, byId }: { leaf: LeafNode; byId: Map<string, Combatant> }) {
  const { useStore, scope, paneCount } = useLayoutCtx()
  const { focusTab, closeTab, close } = useStore()
  const showBlockBtn = useSettingsStore(s => s.showBlockDragButton)
  // Null standalone — see data/pcPaneContext.
  const pcPane = usePcPaneRenderer()

  const multi = leaf.tabs.length > 1
  // The move/combine tools only make sense — and only appear — when there's
  // more than one pane to arrange.
  const showTools = paneCount > 1
  const active = leaf.tabs[leaf.active] ?? leaf.tabs[0]
  const labelOf = (t: PopupRef) => (t.type === 'creature' ? (byId.get(t.ref)?.name ?? 'Creature') : t.title)

  // Drag the WHOLE pane (all its tabs) to re-tile it elsewhere. Layout-internal
  // (creatures can't float); all-popup panes can still pop out to a window.
  const dockHandle = showTools && showBlockBtn ? (
    <span
      onMouseDown={e => {
        if (e.button !== 0) return
        e.preventDefault(); e.stopPropagation()
        beginDockDrag({
          allTabs: leaf.tabs.map(t => ({ ...t })), popup: { ...active }, active: leaf.active,
          label: labelOf(active), fromLeaf: leaf.id, fromScope: scope,
        }, e.clientX, e.clientY)
      }}
      className="ico-btn" title="Move this pane — drag to re-tile it"
      style={{ width: 24, height: 24, cursor: 'grab', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}
    >⠿</span>
  ) : undefined

  // Drag the pane's HEADER to combine it as tabs with another pane (this
  // replaces the dedicated tabs button). Edges still split; the header band of
  // another pane merges as tabs. Box docking stays on the ⠿ button.
  const onHeaderDrag = showTools ? (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    beginDockDrag({
      allTabs: leaf.tabs.map(t => ({ ...t })), popup: { ...active }, active: leaf.active,
      label: labelOf(active), fromLeaf: leaf.id, fromScope: scope,
    }, e.clientX, e.clientY, { mode: 'tab' })
  } : undefined

  const renderContent = (t: PopupRef, hp: { onClose?: () => void; dockHandle?: ReactNode; onHeaderDrag?: (e: React.MouseEvent) => void; hideHeader?: boolean }) => {
    if (t.type === 'creature') {
      const c = byId.get(t.ref)
      if (!c) return <div style={{ padding: 24, color: 'var(--text-faded)', fontSize: 13 }}>No combatant.</div>
      // A PC is a real character to the host app, which renders them better than we can (the whole
      // editable sheet). Declining — or having no host at all — falls back to our own stat block.
      if (c.isPC && pcPane) {
        const el = pcPane(c, { onClose: hp.onClose, dockHandle: hp.dockHandle, onHeaderDrag: hp.onHeaderDrag })
        if (el) return el
      }
      return <CombatantDetail combatant={c} onClose={hp.onClose} dockHandle={hp.dockHandle} onHeaderDrag={hp.onHeaderDrag} />
    }
    return (
      <PopupPreview type={t.type} ref_={t.ref} title={t.title} castRank={t.castRank} fill
        onClose={hp.onClose} dockHandle={hp.dockHandle} onHeaderDrag={hp.onHeaderDrag} hideHeader={hp.hideHeader} />
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Tab strip — only when 2+ tabs */}
      {multi && (
        <div
          data-tab-leaf={leaf.id}
          data-layout-scope={scope}
          style={{
            display: 'flex', alignItems: 'flex-end', gap: 3, padding: '4px 4px 0', flexShrink: 0,
            background: 'var(--bg-base)', borderBottom: 'var(--app-bw) solid var(--border)',
          }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 3, overflowX: 'auto' }}>
            {leaf.tabs.map((t, i) => {
              const on = i === leaf.active
              const label = labelOf(t)
              return (
                <div key={i}
                  onMouseDown={e => {
                    if (e.button !== 0) return
                    e.preventDefault()
                    // Pull THIS tab out: drag to re-tile (edge) or merge into
                    // another pane (centre). A plain click just focuses it.
                    beginDockDrag({
                      allTabs: [{ ...t }], popup: { ...t }, active: 0,
                      label, fromLeaf: leaf.id, fromScope: scope, fromTabIndex: i,
                    }, e.clientX, e.clientY, { mode: 'tab' })
                  }}
                  onClick={() => focusTab(leaf.id, i)} title={label}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                    padding: '5px 8px', borderRadius: '5px 5px 0 0', maxWidth: 170, flexShrink: 0,
                    fontFamily: 'var(--font-ui)', fontSize: 11.5, fontWeight: on ? 700 : 500,
                    color: on ? 'var(--text)' : 'var(--text-muted)',
                    background: on ? 'var(--bg-panel)' : 'transparent',
                    borderTop: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
                  }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                  <button
                    onClick={e => { e.stopPropagation(); closeTab(leaf.id, i) }}
                    onMouseDown={e => e.stopPropagation()} title="Close tab"
                    style={{
                      flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 15, height: 15, border: 'none', borderRadius: 3, padding: 0, cursor: 'pointer',
                      background: 'transparent', color: 'var(--text-faded)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--danger)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-faded)' }}
                  ><XIcon size={9} /></button>
                </div>
              )
            })}
          </div>
          {dockHandle && (
            <div style={{ display: 'flex', flexShrink: 0, paddingBottom: 2 }}>{dockHandle}</div>
          )}
        </div>
      )}

      {/* Active tab content — block so a stat block / popup fills the width. */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {active && renderContent(active, {
          onClose: multi ? undefined : () => close(leaf.id),
          dockHandle: multi ? undefined : dockHandle,
          onHeaderDrag: multi ? undefined : onHeaderDrag,
          hideHeader: multi,
        })}
      </div>
    </div>
  )
}

function DropHint({ zone }: { zone: Zone }) {
  const pos: React.CSSProperties =
    zone === 'left'   ? { left: 0, top: 0, bottom: 0, width: '50%' } :
    zone === 'right'  ? { right: 0, top: 0, bottom: 0, width: '50%' } :
    zone === 'top'    ? { left: 0, right: 0, top: 0, height: '50%' } :
    zone === 'bottom' ? { left: 0, right: 0, bottom: 0, height: '50%' } :
                        { inset: 0 }
  return (
    <div style={{
      position: 'absolute', ...pos, zIndex: 6, pointerEvents: 'none',
      background: 'var(--accent-soft)', border: '2px solid var(--accent)', borderRadius: 6,
      transition: 'all .08s',
    }} />
  )
}
