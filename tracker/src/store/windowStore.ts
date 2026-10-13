import { create } from 'zustand'
import { pageZoom } from '../utils/zoomFix'

// 'creature' is both a DOCKED pane tab (a stat block sharing a tabbed pane with
// reference popups) AND — since auto-linked creature mentions in prose became
// clickable — a floating window / hover preview. A hover preview shows the compact
// creature card; a floating window shows the full stat block with "Add to
// initiative" (WinContent → BestiaryStatBlock).
// 'host' is a page of the HOST app (Heroes Heaven), ref "bucket:id": a Search-everything result or a
// link inside another host page opens one as a floating window, and the GM screen pins one as a pane
// tab. Its body and header controls are the host's (HostSearch.render / .controls). Standalone never
// makes one.
// 'bestiary' is a creature BY NAME (ref = its bestiary key) inside a pane layout — the GM screen or the
// combat workspace. A layout reads every 'creature' tab as a LIVE combatant id and prunes the ones the
// board has not got (layoutStore reconcile), so a bestiary creature pinned to the GM screen, or a
// creature window docked into a layout, vanished on the spot. It goes in as this kind instead (see
// toLayoutTab) and draws the full stat block with "Add to initiative", as its window does.
export type WinType = 'spell' | 'ritual' | 'condition' | 'trait' | 'action' | 'skill' | 'equipment' | 'glossary' | 'creature' | 'rule' | 'widget' | 'host' | 'bestiary'

/** A window's width when nothing says otherwise. */
export const WIN_W = 420
/** A host page reads at a page's width — HH's own description popup grows to 760 px — so it opens wider. */
export const HOST_WIN_W = 560
/** The width a new window of this type opens at. */
export const winWidthFor = (type: WinType): number => (type === 'host' ? HOST_WIN_W : WIN_W)

/*
 * Z-ORDER. Windows start just above 500 and every focus lifts the focused one to `topZ + 1`. The
 * number used to climb on every mousedown on any window — the top one included — with nothing to
 * bring it back, so after ~1,500 clicks the windows painted over the tracker's own modals
 * (`.modal-overlay`, z 2000) and after ~9,000 over the Search box (z 9500). Now a window already on
 * top stays put, and once `topZ` passes RENORM_AT the open windows are renumbered 501…500+n in the
 * order they stand. `topZ` is never below any open window's z: the host stacks its own surfaces on it
 * (Heroes Heaven: a confirm at topZ + 20), and those must stay above every window.
 */
export const BASE_Z = 500
export const RENORM_AT = BASE_Z + 1000

/** The viewport in the coordinate space a fixed window is laid out in (see utils/zoomFix). */
function viewport(): { vw: number; vh: number } {
  const z = pageZoom()
  return { vw: window.innerWidth / z, vh: window.innerHeight / z }
}
/** Left/top for a window `w` wide, kept on screen: 8 px from the top-left, `w + 10` from the right. */
function clampPos(x: number, y: number, w: number): { x: number; y: number } {
  const { vw, vh } = viewport()
  return {
    x: Math.max(8, Math.min(x, vw - w - 10)),
    y: Math.max(8, Math.min(y, vh - 320)),
  }
}
/** A width that fits the viewport (never under the 300 px a resize allows). */
function fitWidth(w: number): number {
  return Math.max(300, Math.min(w, viewport().vw - 16))
}
/** Renumber the windows BASE_Z+1… in their current stacking order once topZ has climbed past RENORM_AT. */
function settleZ(s: { wins: FloatingWin[]; topZ: number }): { wins: FloatingWin[]; topZ: number } {
  if (s.topZ <= RENORM_AT) return s
  const order = [...s.wins].sort((a, b) => a.z - b.z)
  const zOf = new Map(order.map((w, i) => [w.id, BASE_Z + 1 + i]))
  return { wins: s.wins.map(w => ({ ...w, z: zOf.get(w.id)! })), topZ: BASE_Z + s.wins.length }
}

/** One reference popup (a tab inside a floating window or a docked pane). */
export interface PopupTab {
  type: WinType
  ref: string       // lowercase lookup key
  title: string     // display title
  /** For spells: the rank the creature casts it at, so the window can show
   *  heightened values. Undefined = show the base spell. */
  castRank?: number
}

/** A tab on its way into a pane layout (the GM screen, the combat workspace). A 'creature' tab whose ref
 *  is no row on the board (`onBoard` false) is a bestiary creature — a Search result, a creature named in
 *  prose — and becomes 'bestiary', which a layout keeps; a board row's tab is left as it is. */
export function toLayoutTab<T extends { type: WinType; ref: string }>(t: T, onBoard: (id: string) => boolean): T {
  return t.type === 'creature' && !onBoard(t.ref) ? { ...t, type: 'bestiary' } : t
}

/** A floating window — holds one or more popup tabs (browser-style). */
export interface FloatingWin {
  id: string
  tabs: PopupTab[]
  active: number    // index into tabs
  x: number; y: number
  w: number; h: number
  z: number
  sized: boolean    // false = auto-height, true = user has manually resized
}

interface WindowStore {
  wins: FloatingWin[]
  /** The highest z any open window has (or BASE_Z) — never below one of them (see settleZ). */
  topZ: number
  /** Open a popup as a window, or focus the tab already showing it. (originX, originY) is the window's
   *  top-left in the fixed layout's own pixels (utils/zoomFix fixedPopupPos turns a click into that);
   *  without it the window opens centred. `w` overrides the type's width (winWidthFor). */
  open: (type: WinType, ref: string, title: string, originX?: number, originY?: number, opts?: { noCascade?: boolean; castRank?: number; w?: number }) => void
  close: (id: string) => void
  /** Close the window on top (the highest z) — Escape peels windows one at a time. False when none is open. */
  closeTop: () => boolean
  /** Close every window (leaving the campaign: a page opened in one table must not reappear in the next). */
  closeAll: () => void
  /** Close one tab; closes the window when it was the last. */
  closeTab: (id: string, idx: number) => void
  focusTab: (id: string, idx: number) => void
  /** Add a popup as a tab of an existing window (dedupes, focuses). */
  mergeTab: (id: string, tab: PopupTab) => void
  /** Chrome-style window merge: move ALL of `sourceId`'s tabs into `targetId`
   *  and close the source window. */
  mergeWindows: (targetId: string, sourceId: string) => void
  /** Pull a tab out into its own window at (x, y) — browser-style detach.
   *  A single-tab window is simply moved instead. Returns the window id that
   *  now holds the tab (a new one when detached, the same one when moved). */
  detachTab: (id: string, idx: number, x: number, y: number) => string | null
  /** Open a new window holding the given tabs at (x, y). Returns its id. */
  openTabs: (tabs: PopupTab[], x: number, y: number, active?: number) => string
  toFront: (id: string) => void
  move: (id: string, x: number, y: number) => void
  resize: (id: string, w: number, h: number) => void
}

let _uid = 0
const sameTab = (a: PopupTab, type: WinType, ref: string) => a.type === type && a.ref === ref

export const useWindowStore = create<WindowStore>((set, get) => ({
  wins: [], topZ: BASE_Z,

  open(type, ref, title, originX, originY, opts) {
    const { wins, topZ } = get()
    // If this popup is already open as a tab anywhere, focus that tab (and
    // reposition its window if asked) instead of duplicating.
    for (const w of wins) {
      const idx = w.tabs.findIndex(t => sameTab(t, type, ref))
      if (idx >= 0) {
        set(s => settleZ({
          wins: s.wins.map(win => {
            if (win.id !== w.id) return win
            const moved = (opts?.noCascade && originX != null && originY != null)
              ? clampPos(originX, originY, win.w) : {}
            return { ...win, ...moved, active: idx, z: s.topZ + 1 }
          }),
          topZ: s.topZ + 1,
        }))
        return
      }
    }
    const w = fitWidth(opts?.w ?? winWidthFor(type))
    const cascade = opts?.noCascade ? 0 : (wins.length % 8) * 28
    // Centred in the fixed layout's own pixels: under Heroes Heaven's html{zoom} the real viewport
    // (window.innerWidth) is not the space `left`/`top` are laid out in — see utils/zoomFix.
    const { vw, vh } = viewport()
    const { x, y } = clampPos((originX ?? vw / 2 - w / 2) + cascade, (originY ?? vh / 2 - 160) + cascade, w)
    set(settleZ({
      wins: [...wins, {
        id: `w${++_uid}`,
        tabs: [{ type, ref, title, castRank: opts?.castRank }],
        active: 0,
        x, y, w, h: 0, z: topZ + 1, sized: false,
      }],
      topZ: topZ + 1,
    }))
  },

  close(id) { set(s => ({ wins: s.wins.filter(w => w.id !== id) })) },

  closeTop() {
    const { wins } = get()
    if (!wins.length) return false
    const top = wins.reduce((a, b) => (b.z > a.z ? b : a))
    get().close(top.id)
    return true
  },

  closeAll() { set({ wins: [], topZ: BASE_Z }) },

  closeTab(id, idx) {
    set(s => ({
      wins: s.wins.flatMap(w => {
        if (w.id !== id) return [w]
        const tabs = w.tabs.filter((_, i) => i !== idx)
        if (!tabs.length) return []
        const active = Math.max(0, Math.min(w.active > idx ? w.active - 1 : w.active, tabs.length - 1))
        return [{ ...w, tabs, active }]
      }),
    }))
  },

  focusTab(id, idx) {
    set(s => settleZ({
      wins: s.wins.map(w => w.id === id
        ? { ...w, active: Math.max(0, Math.min(idx, w.tabs.length - 1)), z: s.topZ + 1 }
        : w),
      topZ: s.topZ + 1,
    }))
  },

  mergeTab(id, tab) {
    set(s => settleZ({
      wins: s.wins.map(w => {
        if (w.id !== id) return w
        const existing = w.tabs.findIndex(t => sameTab(t, tab.type, tab.ref))
        if (existing >= 0) return { ...w, active: existing, z: s.topZ + 1 }
        return { ...w, tabs: [...w.tabs, tab], active: w.tabs.length, z: s.topZ + 1 }
      }),
      topZ: s.topZ + 1,
    }))
  },

  mergeWindows(targetId, sourceId) {
    if (targetId === sourceId) return
    const { wins } = get()
    const src = wins.find(w => w.id === sourceId)
    const tgt = wins.find(w => w.id === targetId)
    if (!src || !tgt) return
    const tabs = [...tgt.tabs]
    for (const t of src.tabs) {
      if (tabs.findIndex(x => sameTab(x, t.type, t.ref)) < 0) tabs.push(t)
    }
    // Keep focus on the tab the user was looking at in the dragged window.
    const srcActive = src.tabs[src.active]
    const focusIdx = srcActive ? tabs.findIndex(x => sameTab(x, srcActive.type, srcActive.ref)) : tabs.length - 1
    set(s => settleZ({
      wins: s.wins
        .filter(w => w.id !== sourceId)
        .map(w => w.id === targetId ? { ...w, tabs, active: Math.max(0, focusIdx), z: s.topZ + 1 } : w),
      topZ: s.topZ + 1,
    }))
  },

  detachTab(id, idx, x, y) {
    const { wins, topZ } = get()
    const src = wins.find(w => w.id === id)
    if (!src) return null
    // Clamped against the window's OWN width (a host page is wider than the 420 this once assumed).
    const { x: nx, y: ny } = clampPos(x, y, src.w)
    if (src.tabs.length <= 1) {
      // Only tab — detaching is just moving the window.
      set(s => settleZ({
        wins: s.wins.map(w => w.id === id ? { ...w, x: nx, y: ny, z: s.topZ + 1 } : w),
        topZ: s.topZ + 1,
      }))
      return id
    }
    const tab = src.tabs[idx]
    if (!tab) return null
    const tabs = src.tabs.filter((_, i) => i !== idx)
    const active = Math.max(0, Math.min(src.active > idx ? src.active - 1 : src.active, tabs.length - 1))
    const newId = `w${++_uid}`
    set(settleZ({
      wins: [
        ...wins.map(w => w.id === id ? { ...w, tabs, active } : w),
        { id: newId, tabs: [tab], active: 0, x: nx, y: ny, w: src.w, h: src.h, z: topZ + 1, sized: src.sized },
      ],
      topZ: topZ + 1,
    }))
    return newId
  },

  openTabs(tabs, x, y, active = 0): string {
    const { wins, topZ } = get()
    const id = `w${++_uid}`
    if (!tabs.length) return id
    const first = tabs[Math.max(0, Math.min(active, tabs.length - 1))]
    // A pinned host page dragged off the GM screen opens at a page's width, like one opened from Search.
    const w = fitWidth(winWidthFor(first.type))
    set(settleZ({
      wins: [...wins, {
        id,
        tabs: [...tabs],
        active: Math.max(0, Math.min(active, tabs.length - 1)),
        ...clampPos(x, y, w),
        w, h: 0, z: topZ + 1, sized: false,
      }],
      topZ: topZ + 1,
    }))
    return id
  },

  toFront(id) {
    set(s => {
      const win = s.wins.find(w => w.id === id)
      // Already on top (or gone): nothing moves, and topZ does not climb (see BASE_Z above).
      if (!win || win.z >= s.topZ) return s
      return settleZ({
        wins: s.wins.map(w => w.id === id ? { ...w, z: s.topZ + 1 } : w),
        topZ: s.topZ + 1,
      })
    })
  },

  move(id, x, y) {
    set(s => ({ wins: s.wins.map(w => w.id === id ? { ...w, x, y } : w) }))
  },

  resize(id, nw, nh) {
    set(s => ({ wins: s.wins.map(w => w.id === id ? { ...w, w: nw, h: nh, sized: true } : w) }))
  },
}))
