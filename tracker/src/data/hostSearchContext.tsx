import { createContext, useContext, type ReactNode } from 'react'

/*
 * HH → tracker bridge for the global Search (null default, like the other host contexts).
 *
 * Standalone the tracker's Search only knows its own /data/ reference set (conditions, spells, items,
 * traits, actions, creatures). Inside Heroes Heaven the host supplies a flat index of EVERY content
 * record it has — feats, ancestries, heritages, backgrounds, classes, deities, rules, … — and draws
 * the page of a record itself (`render`), so a result opens as one of the tracker's own movable
 * windows (the owner, 2026-10-01, item 7: "Search everything results open in the tracker's movable,
 * windowed stat-block popup, not a static popup"). With no provider (standalone) this is null and
 * Search falls back to its original behaviour unchanged.
 */
export interface HostSearchRecord {
  /** The host ContentDatabase bucket this record lives in (e.g. 'feats', 'spells', 'ancestries'). */
  bucket: string
  /** The record's key within that bucket. */
  id: string
  name: string
  /** Other names the record answers to — the names its page was printed under before (Searing Blade
   *  is the reprint of Flame Tongue). Searched, not shown. */
  aliases?: string[]
  /** One muted line that tells same-named rows apart: level, archetype, book. */
  detail?: string
}

export interface HostSearch {
  records: HostSearchRecord[]
  /** Open the record the host's own way. Search calls it only for a host that draws no pages
   *  (`render` absent); a host that draws them gets its results as tracker windows instead. */
  open: (bucket: string, id: string) => void
  /** The body of a host page — a `host` tab (ref "bucket:id") in a floating window or a GM-screen
   *  pane. When present, a Search result opens as a window holding it. */
  render?: (bucket: string, id: string) => ReactNode
  /** The host's controls for that page, drawn in the window's (or the pane's) header beside the close
   *  button — Heroes Heaven's favourite star (which pins to the GM screen). A pane holding two tabs or
   *  more draws no header, so there they sit in a strip above the page. Keep them icon-sized: the header
   *  is one row shared with the tabs and the close button. */
  controls?: (bucket: string, id: string) => ReactNode
}

const HostSearchContext = createContext<HostSearch | null>(null)
export const HostSearchProvider = HostSearchContext.Provider
export function useHostSearch(): HostSearch | null {
  return useContext(HostSearchContext)
}
