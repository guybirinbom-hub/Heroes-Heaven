import { createContext, useContext, type ReactNode } from 'react'

/*
 * HH → tracker bridge for the global Search (null default, like the other host contexts).
 *
 * Standalone the tracker's Search only knows its own /data/ reference set (conditions, spells, items,
 * traits, actions, creatures). Inside Heroes Heaven the host supplies a flat index of EVERY content
 * record it has — feats, ancestries, heritages, backgrounds, classes, deities, rules, … — plus an
 * `open(bucket, id)` that pops the host's own description popup. With no provider (standalone) this is
 * null and Search falls back to its original behaviour unchanged.
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
  /** Open the host app's description popup for this record. */
  open: (bucket: string, id: string) => void
  /** The body of a host page pinned to the GM screen (a `host` pane tab, ref "bucket:id"), drawn by the
   *  host the way its own popup draws it. */
  render?: (bucket: string, id: string) => ReactNode
}

const HostSearchContext = createContext<HostSearch | null>(null)
export const HostSearchProvider = HostSearchContext.Provider
export function useHostSearch(): HostSearch | null {
  return useContext(HostSearchContext)
}
