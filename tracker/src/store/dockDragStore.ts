import { create } from 'zustand'
import { useLayoutStore, useGmLayoutStore, type PopupRef, type Zone } from './layoutStore'
import { useWindowStore } from './windowStore'

// Popups can dock into more than one workspace (the combat tiling and the GM
// Screen). Each pane carries a `data-layout-scope` so a drop routes to the
// right store; default is the combat layout.
const layoutFor = (scope?: string) => (scope === 'gm' ? useGmLayoutStore : useLayoutStore)

// ── Popup dragging — two distinct modes (mouse-driven; HTML5 DnD is unreliable
//    from position:fixed windows in the frameless Electron shell) ─────────────
//
//   ⠿ handle  →  beginDockDrag  →  DOCK mode: the whole window/block goes into
//                the tiling layout. Pane blocks HIGHLIGHT as drop targets.
//
//   title / tab  →  beginBrowserDrag  →  BROWSER mode: behaves like a Chrome
//                tab — the floating window follows the cursor and can MERGE into
//                another popup. NO box/pane highlights, never docks.

export type DockHover =
  | { kind: 'pane'; leafId: string; zone: Zone; scope: string }
  | { kind: 'empty'; scope: string }

/** BROWSER-drag merge target: another floating popup window, OR a docked popup
 *  block. Dropping merges the dragged window's tabs into it. */
export type MergeTarget =
  | { kind: 'win'; id: string }
  | { kind: 'leaf'; id: string; scope: string }

/** DOCK-mode payload (⠿ / tabs / tab-chip): the tabs being dragged. Tabs may be
 *  popups and/or creature stat blocks. Creature-containing drags re-tile within
 *  the layout (creatures can't float); all-popup drags can also pop out to a
 *  floating window when released over empty space. */
export interface DockPayload {
  popup?: PopupRef         // active tab — used as the drag-ghost label
  allTabs?: PopupRef[]     // the tabs being moved (whole pane, or one chip)
  active?: number
  label?: string           // ghost label override (e.g. a creature's name)
  winId?: string           // floating-window source (moves live + click-through)
  winPos?: { x: number; y: number }
  fromLeaf?: string        // docked-pane source
  fromScope?: string       // which workspace the docked-pane source lives in
  fromTabIndex?: number    // pulling ONE tab out of fromLeaf (else the whole pane)
  /** 'box' (⠿) = split/tile into a separate window; 'tab' = combine as tabs.
   *  Drives the drop zones + the hover highlight. */
  mode?: 'box' | 'tab'
}

interface DockDragState {
  /** DOCK drag in progress (drives pane highlights + the ghost). */
  drag: DockPayload | null
  hover: DockHover | null
  /** BROWSER drag merge target under the cursor (a floating window or a docked
   *  popup block). Null = nothing to merge into; releasing just leaves it. */
  mergeHover: MergeTarget | null
  /** The window currently being dragged in BROWSER mode (so it can render
   *  see-through + click-through, letting the merge target show/be hit beneath). */
  browserWin: string | null
  x: number
  y: number
}

export const useDockDrag = create<DockDragState>(() => ({ drag: null, hover: null, mergeHover: null, browserWin: null, x: 0, y: 0 }))

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by)

// A tab only merges onto another pane when dropped within this band (px) from
// the pane's top — i.e. over its tab strip / header. Dropping lower (the body)
// pops the tab out instead, so you never have to drag it off-screen.
const TAB_MERGE_BAND = 46

// ── ⠿ / tabs / tab-chip : dock or combine within the layout ──────────────────
// `allowCenterTab` distinguishes the two pane buttons: ⠿ (false) always docks
// as its own box (centre → split); the tabs button & tab chips (true) merge as
// tabs when dropped on a pane's centre.
export function beginDockDrag(
  payload: DockPayload, startX: number, startY: number,
  opts?: { mode?: 'box' | 'tab' },
): void {
  const mode = opts?.mode ?? 'box'
  let started = false
  const move = (e: MouseEvent) => {
    if (!started) {
      if (dist(e.clientX, e.clientY, startX, startY) < 5) return
      started = true
      useDockDrag.setState({ drag: { ...payload, mode }, x: e.clientX, y: e.clientY })
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    }
    if (payload.winId && payload.winPos) {
      useWindowStore.getState().move(payload.winId,
        Math.max(0, payload.winPos.x + e.clientX - startX),
        Math.max(0, payload.winPos.y + e.clientY - startY))
    }
    // The dragged floating window is pointer-events:none while docking (see
    // beingDocked), so elementFromPoint reaches the panes beneath it.
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const leafEl = el?.closest('[data-pane-leaf]') as HTMLElement | null
    const emptyEl = el?.closest('[data-dock-empty]') as HTMLElement | null
    if (leafEl) {
      const r = leafEl.getBoundingClientRect()
      const scope = leafEl.dataset.layoutScope || 'combat'
      if (mode === 'tab') {
        // A tab merges onto another pane ONLY over its tab-strip / header band;
        // dropping over the body pops it out instead. Keeps the highlight small
        // and means no off-screen drag is needed to detach.
        if (e.clientY - r.top <= TAB_MERGE_BAND) {
          useDockDrag.setState({ hover: { kind: 'pane', leafId: leafEl.dataset.paneLeaf!, zone: 'center', scope }, x: e.clientX, y: e.clientY })
        } else {
          useDockDrag.setState({ hover: null, x: e.clientX, y: e.clientY })
        }
      } else {
        // 'box' (⠿) splits into a separate window. The pane's two diagonals carve
        // it into four triangles (top / right / bottom / left); the cursor's
        // triangle picks the side. So the NEAREST edge always wins — no dead
        // centre, no corner bias — which reads far more naturally as you move.
        const dx = (e.clientX - r.left) / r.width - 0.5
        const dy = (e.clientY - r.top) / r.height - 0.5
        const zone: Zone = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom')
        useDockDrag.setState({ hover: { kind: 'pane', leafId: leafEl.dataset.paneLeaf!, zone, scope }, x: e.clientX, y: e.clientY })
      }
    } else if (emptyEl) {
      useDockDrag.setState({ hover: { kind: 'empty', scope: emptyEl.dataset.layoutScope || 'combat' }, x: e.clientX, y: e.clientY })
    } else {
      useDockDrag.setState({ hover: null, x: e.clientX, y: e.clientY })
    }
  }
  const up = (e: MouseEvent) => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    const { drag, hover } = useDockDrag.getState()
    useDockDrag.setState({ drag: null, hover: null })
    if (!drag || !started) return
    const ws = useWindowStore.getState()
    const srcLayout = layoutFor(drag.fromScope).getState()
    const tabs = (drag.allTabs && drag.allTabs.length ? drag.allTabs : drag.popup ? [drag.popup] : [])
    if (!tabs.length) return
    // Remove the source: a floating window closes; a pulled tab is removed from
    // its pane; otherwise the whole source pane closes.
    const closeSrc = () => {
      if (drag.winId) ws.close(drag.winId)
      else if (drag.fromLeaf != null) {
        if (drag.fromTabIndex != null) srcLayout.closeTab(drag.fromLeaf, drag.fromTabIndex)
        else srcLayout.close(drag.fromLeaf)
      }
    }
    if (hover?.kind === 'pane') {
      if (drag.fromLeaf && drag.fromLeaf === hover.leafId) return  // onto itself
      layoutFor(hover.scope).getState().dropPopups(hover.leafId, tabs, hover.zone, drag.active ?? 0)
      closeSrc()
    } else if (hover?.kind === 'empty') {
      layoutFor(hover.scope).getState().dropPopups('', tabs, 'center', drag.active ?? 0)
      closeSrc()
    } else {
      // Released NOT on a tab line/header (a pane body or empty space) → pop the
      // tab out into a floating window right where released. A floating-window
      // source already moved live, so leave it. Creature tabs carry their live
      // combatant id, so the floating window hosts the full interactive stat
      // block (see WinItem) — no state is lost.
      if (drag.winId) return
      ws.openTabs(tabs, e.clientX - 80, e.clientY - 16, drag.active ?? 0)
      if (drag.fromLeaf != null) closeSrc()
    }
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}

// ── title / tab : Chrome-style move + merge (no boxes) ───────────────────────
// `resolve` runs once movement passes the threshold and returns the floating
// window to drag (creating/detaching one if needed). The window then follows
// the cursor; releasing over another popup merges into it.
export function beginBrowserDrag(
  resolve: () => { winId: string; startWX: number; startWY: number } | null,
  startX: number, startY: number,
  // 'pane'    → merges when dropped anywhere over another popup (used by the
  //             block-level tab button).
  // 'tabstrip'→ merges ONLY when dropped over a tab row; dropping over the body
  //             (or empty space) leaves it as a floating popup. This is the
  //             Chrome-tab feel for dragging an individual tab chip.
  targetMode: 'pane' | 'tabstrip' = 'pane',
): void {
  let d: { winId: string; startWX: number; startWY: number } | null = null
  let started = false
  const cleanup = () => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  const move = (e: MouseEvent) => {
    if (!started) {
      if (dist(e.clientX, e.clientY, startX, startY) < 5) return
      started = true
      d = resolve()
      if (!d) { cleanup(); return }
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
      // Mark the dragged window so it renders click-through + see-through; the
      // merge target beneath then both highlights and is hit-tested correctly.
      useDockDrag.setState({ browserWin: d.winId })
    }
    if (!d) return
    const ws = useWindowStore.getState()
    ws.move(d.winId, Math.max(0, d.startWX + e.clientX - startX), Math.max(0, d.startWY + e.clientY - startY))
    // Merge target = any other popup under the cursor — a floating window OR a
    // docked popup block (whole area, not just a header). The dragged window is
    // pointer-events:none so it's excluded from elementsFromPoint; the first
    // matching element beneath is the target.
    let target: MergeTarget | null = null
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const he = el as HTMLElement
      if (targetMode === 'tabstrip') {
        // Tab rows + pane header bands count — dropping over a body stays a popup.
        const tw = he.closest?.('[data-tab-win]') as HTMLElement | null
        if (tw && tw.dataset.tabWin !== d.winId) { target = { kind: 'win', id: tw.dataset.tabWin! }; break }
        const tl = he.closest?.('[data-tab-leaf]') as HTMLElement | null
        if (tl) { target = { kind: 'leaf', id: tl.dataset.tabLeaf!, scope: tl.dataset.layoutScope || 'combat' }; break }
        // A single-tab docked pane has no tab strip — accept a drop on its header
        // band so you can still stack onto it as tabs.
        const pl = he.closest?.('[data-pane-leaf]') as HTMLElement | null
        if (pl) {
          const r = pl.getBoundingClientRect()
          if (e.clientY - r.top <= TAB_MERGE_BAND) { target = { kind: 'leaf', id: pl.dataset.paneLeaf!, scope: pl.dataset.layoutScope || 'combat' }; break }
        }
      } else {
        const w = he.closest?.('[data-float-merge]') as HTMLElement | null
        if (w && w.dataset.floatMerge !== d.winId) { target = { kind: 'win', id: w.dataset.floatMerge! }; break }
        const leaf = he.closest?.('[data-pane-leaf][data-pane-kind="popup"]') as HTMLElement | null
        if (leaf) { target = { kind: 'leaf', id: leaf.dataset.paneLeaf!, scope: leaf.dataset.layoutScope || 'combat' }; break }
      }
    }
    useDockDrag.setState({ mergeHover: target, x: e.clientX, y: e.clientY })
  }
  const up = () => {
    cleanup()
    const { mergeHover } = useDockDrag.getState()
    useDockDrag.setState({ mergeHover: null, browserWin: null })
    if (!d || !mergeHover) return  // no target → the window stays where released
    const ws = useWindowStore.getState()
    if (mergeHover.kind === 'win') {
      ws.mergeWindows(mergeHover.id, d.winId)
    } else {
      // Merge into a docked popup block as new tab(s) — in whichever workspace
      // that block belongs to.
      const src = ws.wins.find(w => w.id === d!.winId)
      if (src) {
        layoutFor(mergeHover.scope).getState().dropPopups(mergeHover.id, src.tabs.map(t => ({ ...t })), 'center', src.active)
        ws.close(d.winId)
      }
    }
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}
