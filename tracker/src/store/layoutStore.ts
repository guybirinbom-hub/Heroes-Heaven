import { useMemo } from 'react'
import { create } from 'zustand'
import type { WinType } from './windowStore'

// ── Tiled panes (unified stat blocks + popups) ───────────────────────────────
// A binary tree of panes. Every Leaf is a TABBED stack whose tabs are either a
// creature stat block (type:'creature', ref:cid) or a reference popup
// (spell/trait/item…). Stat blocks and popups can share one pane as tabs.
// A Split lays out two children in a row (side by side) or col (stacked).
// Dragging onto a pane's edge splits it; onto its centre adds a tab.
// Everything is hover-driven: the pane under the cursor (or last under it) is
// "hovered" — it gets the outline and drives the single initiative eye.

export type Zone = 'center' | 'top' | 'bottom' | 'left' | 'right'

/** A docked tab — a reference popup OR a creature stat block (type:'creature',
 *  ref = combatant id). Both share one tabbed pane (LeafNode). */
export interface PopupRef { type: WinType; ref: string; title: string; castRank?: number }

/** A pane: a tabbed stack of creatures and/or popups. */
export interface LeafNode { id: string; kind: 'leaf'; pane: 'popup'; tabs: PopupRef[]; active: number }
/** Back-compat alias — leaves are all one type now. */
export type PopupLeaf = LeafNode
export interface SplitNode { id: string; kind: 'split'; dir: 'row' | 'col'; a: PaneNode; b: PaneNode; split: number }
export type PaneNode = LeafNode | SplitNode

let _id = 0
const nid = (p: string) => `${p}${++_id}`
const mkLeaf = (tabs: PopupRef[], active = 0): LeafNode =>
  ({ id: nid('leaf'), kind: 'leaf', pane: 'popup', tabs, active: Math.max(0, Math.min(active, tabs.length - 1)) })
const creatureTab = (cid: string): PopupRef => ({ type: 'creature', ref: cid, title: '' })
const creatureLeaf = (cid: string): LeafNode => mkLeaf([creatureTab(cid)])
const popupLeaf = (tabs: PopupRef[], active = 0): LeafNode => mkLeaf([...tabs], active)
const popupKey = (p: PopupRef) => `${p.type}:${p.ref}:${p.castRank ?? ''}`
const isCreature = (t: PopupRef) => t.type === 'creature'

// ── pure tree helpers ──
function findLeaf(n: PaneNode | null, id: string): LeafNode | null {
  if (!n) return null
  if (n.kind === 'leaf') return n.id === id ? n : null
  return findLeaf(n.a, id) ?? findLeaf(n.b, id)
}
/** Locate the leaf + tab index holding a creature's stat block. */
function findCreatureTab(n: PaneNode | null, cid: string): { leaf: LeafNode; index: number } | null {
  if (!n) return null
  if (n.kind === 'leaf') {
    const index = n.tabs.findIndex(t => isCreature(t) && t.ref === cid)
    return index >= 0 ? { leaf: n, index } : null
  }
  return findCreatureTab(n.a, cid) ?? findCreatureTab(n.b, cid)
}
function firstLeaf(n: PaneNode): LeafNode {
  return n.kind === 'leaf' ? n : firstLeaf(n.a)
}
function countLeaves(n: PaneNode | null): number {
  if (!n) return 0
  return n.kind === 'leaf' ? 1 : countLeaves(n.a) + countLeaves(n.b)
}
function updateNode(n: PaneNode, id: string, fn: (node: PaneNode) => PaneNode): PaneNode {
  if (n.id === id) return fn(n)
  if (n.kind === 'split') return { ...n, a: updateNode(n.a, id, fn), b: updateNode(n.b, id, fn) }
  return n
}
function dropNode(n: PaneNode, id: string): PaneNode | null {
  if (n.kind === 'leaf') return n.id === id ? null : n
  const a = dropNode(n.a, id)
  const b = dropNode(n.b, id)
  if (a && b) return { ...n, a, b }
  return a ?? b
}
function setSplitFrac(n: PaneNode, id: string, frac: number): PaneNode {
  if (n.kind === 'leaf') return n
  if (n.id === id) return { ...n, split: Math.max(0.12, Math.min(0.88, frac)) }
  return { ...n, a: setSplitFrac(n.a, id, frac), b: setSplitFrac(n.b, id, frac) }
}
/** Replace leaf `leafId` with a split: the new leaf placed on `zone`'s side. */
function splitLeaf(root: PaneNode, leafId: string, fresh: LeafNode, zone: Exclude<Zone, 'center'>): PaneNode {
  const dir: 'row' | 'col' = (zone === 'left' || zone === 'right') ? 'row' : 'col'
  const firstNew = zone === 'left' || zone === 'top'
  return updateNode(root, leafId, l => ({
    id: nid('split'), kind: 'split', dir,
    a: firstNew ? fresh : l, b: firstNew ? l : fresh, split: 0.5,
  }))
}
function addTab(leaf: LeafNode, p: PopupRef): LeafNode {
  const i = leaf.tabs.findIndex(t => popupKey(t) === popupKey(p))
  if (i >= 0) return { ...leaf, active: i }
  return { ...leaf, tabs: [...leaf.tabs, p], active: leaf.tabs.length }
}
/** Every creature stat block's combatant id (for the initiative eye / marker). */
export function leafCids(n: PaneNode | null, out: string[] = []): string[] {
  if (!n) return out
  if (n.kind === 'leaf') { for (const t of n.tabs) if (isCreature(t)) out.push(t.ref) }
  else { leafCids(n.a, out); leafCids(n.b, out) }
  return out
}
/** Prune creature tabs whose combatant left; drop panes that end up empty. */
function pruneTree(n: PaneNode, valid: Set<string>): PaneNode | null {
  if (n.kind === 'leaf') {
    const tabs = n.tabs.filter(t => !isCreature(t) || valid.has(t.ref))
    if (!tabs.length) return null
    if (tabs.length === n.tabs.length) return n
    return { ...n, tabs, active: Math.max(0, Math.min(n.active, tabs.length - 1)) }
  }
  const a = pruneTree(n.a, valid)
  const b = pruneTree(n.b, valid)
  if (a === n.a && b === n.b) return n
  if (a && b) return { ...n, a, b }
  return a ?? b
}
const cidOf = (leaf: LeafNode | null): string | null => {
  const t = leaf?.tabs[leaf.active]
  return t && isCreature(t) ? t.ref : null
}
/** Keep the hovered leaf valid; derive the eye's creature from its active tab. */
function validHover(root: PaneNode | null, leaf: string | null): { hoveredLeaf: string | null; hoveredCid: string | null } {
  if (!root) return { hoveredLeaf: null, hoveredCid: null }
  const lf = (leaf && findLeaf(root, leaf)) || firstLeaf(root)
  return { hoveredLeaf: lf.id, hoveredCid: cidOf(lf) }
}

export interface LayoutStore {
  root: PaneNode | null
  hoveredLeaf: string | null
  hoveredCid: string | null
  /** Show a creature (initiative-order click): focus its tab, else swap the
   *  hovered pane's active stat block, else add a tab / create a pane. */
  open: (cid: string) => void
  /** A creature was dropped onto a pane zone (centre = add as a tab). */
  drop: (leafId: string, cid: string, zone: Zone) => void
  /** A popup was dragged (by its dock handle) onto a pane zone. */
  dropPopup: (leafId: string, popup: PopupRef, zone: Zone) => void
  /** A whole window/block (all its tabs — popups and/or creatures) docked. */
  dropPopups: (leafId: string, popups: PopupRef[], zone: Zone, active?: number) => void
  /** Add a popup as a new pane (used by the GM Screen's "Add Reference"). */
  addPopup: (popup: PopupRef) => void
  /** Activate a tab. */
  focusTab: (leafId: string, idx: number) => void
  /** Close a tab (removes the pane if it was the last). */
  closeTab: (leafId: string, idx: number) => void
  /** Close a whole pane. */
  close: (leafId: string) => void
  resize: (splitId: string, frac: number) => void
  setHovered: (leafId: string) => void
  reconcile: (valid: Set<string>) => void
}

/** Raise the shared id counter past any ids in a persisted tree. */
function bumpIds(n: PaneNode | null): void {
  if (!n) return
  const m = /(\d+)$/.exec(n.id)
  if (m) _id = Math.max(_id, parseInt(m[1], 10))
  if (n.kind === 'split') { bumpIds(n.a); bumpIds(n.b) }
}

/** Create a layout store. `persistKey` (the GM Screen) restores its pane tree
 *  from localStorage and saves on every change; without it (combat) the layout
 *  is session-only. */
export function createLayoutStore(opts?: { persistKey?: string }) {
  const persistKey = opts?.persistKey
  let initialRoot: PaneNode | null = null
  if (persistKey) {
    try {
      const raw = localStorage.getItem(persistKey)
      if (raw) { initialRoot = JSON.parse(raw) as PaneNode; bumpIds(initialRoot) }
    } catch { initialRoot = null }
  }

  const store = create<LayoutStore>((set, get) => ({
    root: initialRoot,
    hoveredLeaf: initialRoot ? validHover(initialRoot, null).hoveredLeaf : null,
    hoveredCid: null,

    open(cid) {
      const { root, hoveredLeaf } = get()
      if (!root) { const l = creatureLeaf(cid); set({ root: l, hoveredLeaf: l.id, hoveredCid: cid }); return }
      const found = findCreatureTab(root, cid)
      if (found) {
        set({ root: updateNode(root, found.leaf.id, l => ({ ...(l as LeafNode), active: found.index })), hoveredLeaf: found.leaf.id, hoveredCid: cid })
        return
      }
      const target = (hoveredLeaf && findLeaf(root, hoveredLeaf)) || firstLeaf(root)
      set({
        root: updateNode(root, target.id, l => {
          const pl = l as LeafNode
          const act = pl.tabs[pl.active]
          if (act && isCreature(act)) {                 // swap the shown creature (click-to-view)
            const tabs = pl.tabs.slice(); tabs[pl.active] = creatureTab(cid); return { ...pl, tabs }
          }
          return addTab(pl, creatureTab(cid))            // otherwise add a tab
        }),
        hoveredLeaf: target.id, hoveredCid: cid,
      })
    },

    drop(leafId, cid, zone) {
      const { root } = get()
      if (!root) { const l = creatureLeaf(cid); set({ root: l, hoveredLeaf: l.id, hoveredCid: cid }); return }
      const target = findLeaf(root, leafId)
      if (!target) return
      if (zone === 'center') {
        set({ root: updateNode(root, leafId, l => addTab(l as LeafNode, creatureTab(cid))), hoveredLeaf: leafId, hoveredCid: cid })
        return
      }
      const cl = creatureLeaf(cid)
      set({ root: splitLeaf(root, leafId, cl, zone), hoveredLeaf: cl.id, hoveredCid: cid })
    },

    dropPopup(leafId, popup, zone) {
      get().dropPopups(leafId, [popup], zone, 0)
    },

    dropPopups(leafId, popups, zone, active = 0) {
      if (!popups.length) return
      const { root } = get()
      const activeTab = popups[Math.max(0, Math.min(active, popups.length - 1))]
      const hovCid = activeTab && isCreature(activeTab) ? activeTab.ref : null
      if (!root) { const l = popupLeaf([...popups], active); set({ root: l, hoveredLeaf: l.id, hoveredCid: hovCid }); return }
      const target = findLeaf(root, leafId)
      if (!target) return
      if (zone === 'center') {
        set({
          root: updateNode(root, leafId, l => popups.reduce((acc, p) => addTab(acc as LeafNode, p), l as LeafNode)),
          hoveredLeaf: leafId, hoveredCid: hovCid,
        })
        return
      }
      const pl = popupLeaf([...popups], active)
      set({ root: splitLeaf(root, leafId, pl, zone), hoveredLeaf: pl.id, hoveredCid: hovCid })
    },

    addPopup(popup) {
      const { root, hoveredLeaf } = get()
      if (!root) { const l = popupLeaf([popup]); set({ root: l, hoveredLeaf: l.id, hoveredCid: null }); return }
      const target = (hoveredLeaf && findLeaf(root, hoveredLeaf)) || firstLeaf(root)
      const pl = popupLeaf([popup])
      set({ root: splitLeaf(root, target.id, pl, 'right'), hoveredLeaf: pl.id, hoveredCid: null })
    },

    focusTab(leafId, idx) {
      const { root } = get()
      if (!root) return
      const next = updateNode(root, leafId, l => l.kind === 'leaf'
        ? { ...l, active: Math.max(0, Math.min(idx, l.tabs.length - 1)) } : l)
      set({ root: next, hoveredLeaf: leafId, hoveredCid: cidOf(findLeaf(next, leafId)) })
    },

    closeTab(leafId, idx) {
      const { root, hoveredLeaf } = get()
      if (!root) return
      const lf = findLeaf(root, leafId)
      if (!lf) return
      const tabs = lf.tabs.filter((_, i) => i !== idx)
      if (!tabs.length) {
        const next = dropNode(root, leafId)
        set({ root: next, ...validHover(next, hoveredLeaf) })
        return
      }
      const active = Math.min(lf.active >= idx ? lf.active - (lf.active === idx ? 0 : 1) : lf.active, tabs.length - 1)
      set({ root: updateNode(root, leafId, () => ({ ...lf, tabs, active: Math.max(0, active) })) })
    },

    close(leafId) {
      const { root, hoveredLeaf } = get()
      if (!root) return
      const next = dropNode(root, leafId)
      set({ root: next, ...validHover(next, hoveredLeaf) })
    },

    resize(splitId, frac) {
      const { root } = get()
      if (root) set({ root: setSplitFrac(root, splitId, frac) })
    },

    setHovered(leafId) {
      const { root, hoveredLeaf } = get()
      if (hoveredLeaf === leafId) return
      set({ hoveredLeaf: leafId, hoveredCid: cidOf(root ? findLeaf(root, leafId) : null) })
    },

    reconcile(valid) {
      const { root, hoveredLeaf } = get()
      if (!root) return
      const next = pruneTree(root, valid)
      if (next === root) return
      set({ root: next, ...validHover(next, hoveredLeaf) })
    },
  }))

  // Persist the pane tree (GM Screen only) when it actually changes.
  if (persistKey) {
    store.subscribe((s, p) => {
      if (s.root !== p.root) {
        try { localStorage.setItem(persistKey, JSON.stringify(s.root)) } catch { /* quota */ }
      }
    })
  }

  return store
}

/** Combat stat-block tiling — session-only (cleared with combat). */
export const useLayoutStore = createLayoutStore()
/** GM Screen workspace — its own persisted pane tree, kept across combats. */
export const useGmLayoutStore = createLayoutStore({ persistKey: 'pf2e-gm-layout' })

/** A layout-store hook (combat or GM) — used to parameterise PaneLayout. */
export type LayoutStoreHook = typeof useLayoutStore

/** How many panes (leaves) the tree holds — drives "show tools only when >1". */
export function paneCount(n: PaneNode | null): number { return countLeaves(n) }

/** MIME for a creature-id drag payload (initiative card → pane). Popup docking
 *  doesn't use HTML5 DnD — see dockDragStore. */
export const DRAG_MIME = 'text/combatant-id'

export function useOpenCombatantIds(): Set<string> {
  const root = useLayoutStore(s => s.root)
  return useMemo(() => new Set(leafCids(root)), [root])
}
export function useHoveredCid(): string | null {
  return useLayoutStore(s => s.hoveredCid)
}
export function useHoveredLeaf(): string | null {
  return useLayoutStore(s => s.hoveredLeaf)
}
