import { create } from 'zustand'

// 'creature' is both a DOCKED pane tab (a stat block sharing a tabbed pane with
// reference popups) AND — since auto-linked creature mentions in prose became
// clickable — a floating window / hover preview showing a compact creature card
// (rendered by WinContent → CreatureCard).
export type WinType = 'spell' | 'ritual' | 'condition' | 'trait' | 'action' | 'skill' | 'equipment' | 'glossary' | 'creature' | 'rule' | 'widget'

/** One reference popup (a tab inside a floating window or a docked pane). */
export interface PopupTab {
  type: WinType
  ref: string       // lowercase lookup key
  title: string     // display title
  /** For spells: the rank the creature casts it at, so the window can show
   *  heightened values. Undefined = show the base spell. */
  castRank?: number
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
  topZ: number
  open: (type: WinType, ref: string, title: string, originX?: number, originY?: number, opts?: { noCascade?: boolean; castRank?: number }) => void
  close: (id: string) => void
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
  wins: [], topZ: 500,

  open(type, ref, title, originX, originY, opts) {
    const { wins, topZ } = get()
    // If this popup is already open as a tab anywhere, focus that tab (and
    // reposition its window if asked) instead of duplicating.
    for (const w of wins) {
      const idx = w.tabs.findIndex(t => sameTab(t, type, ref))
      if (idx >= 0) {
        set(s => ({
          wins: s.wins.map(win => {
            if (win.id !== w.id) return win
            const moved = (opts?.noCascade && originX != null && originY != null)
              ? { x: Math.max(8, originX), y: Math.max(8, originY) } : {}
            return { ...win, ...moved, active: idx, z: s.topZ + 1 }
          }),
          topZ: s.topZ + 1,
        }))
        return
      }
    }
    const cascade = opts?.noCascade ? 0 : (wins.length % 8) * 28
    const x = Math.max(8, Math.min((originX ?? window.innerWidth / 2 - 200) + cascade, window.innerWidth - 430))
    const y = Math.max(8, Math.min((originY ?? window.innerHeight / 2 - 160) + cascade, window.innerHeight - 320))
    set({
      wins: [...wins, {
        id: `w${++_uid}`,
        tabs: [{ type, ref, title, castRank: opts?.castRank }],
        active: 0,
        x, y, w: 420, h: 0, z: topZ + 1, sized: false,
      }],
      topZ: topZ + 1,
    })
  },

  close(id) { set(s => ({ wins: s.wins.filter(w => w.id !== id) })) },

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
    set(s => ({
      wins: s.wins.map(w => w.id === id
        ? { ...w, active: Math.max(0, Math.min(idx, w.tabs.length - 1)), z: s.topZ + 1 }
        : w),
      topZ: s.topZ + 1,
    }))
  },

  mergeTab(id, tab) {
    set(s => ({
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
    set(s => ({
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
    const nx = Math.max(8, Math.min(x, window.innerWidth - 430))
    const ny = Math.max(8, Math.min(y, window.innerHeight - 320))
    if (src.tabs.length <= 1) {
      // Only tab — detaching is just moving the window.
      set(s => ({
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
    set({
      wins: [
        ...wins.map(w => w.id === id ? { ...w, tabs, active } : w),
        { id: newId, tabs: [tab], active: 0, x: nx, y: ny, w: src.w, h: src.h, z: topZ + 1, sized: src.sized },
      ],
      topZ: topZ + 1,
    })
    return newId
  },

  openTabs(tabs, x, y, active = 0): string {
    const { wins, topZ } = get()
    const id = `w${++_uid}`
    if (!tabs.length) return id
    set({
      wins: [...wins, {
        id,
        tabs: [...tabs],
        active: Math.max(0, Math.min(active, tabs.length - 1)),
        x: Math.max(8, Math.min(x, window.innerWidth - 430)),
        y: Math.max(8, Math.min(y, window.innerHeight - 320)),
        w: 420, h: 0, z: topZ + 1, sized: false,
      }],
      topZ: topZ + 1,
    })
    return id
  },

  toFront(id) {
    set(s => ({
      wins: s.wins.map(w => w.id === id ? { ...w, z: s.topZ + 1 } : w),
      topZ: s.topZ + 1,
    }))
  },

  move(id, x, y) {
    set(s => ({ wins: s.wins.map(w => w.id === id ? { ...w, x, y } : w) }))
  },

  resize(id, nw, nh) {
    set(s => ({ wins: s.wins.map(w => w.id === id ? { ...w, w: nw, h: nh, sized: true } : w) }))
  },
}))
