import { createContext, useContext } from 'react'

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
}

export interface HostSearch {
  records: HostSearchRecord[]
  /** Open the host app's description popup for this record. */
  open: (bucket: string, id: string) => void
}

const HostSearchContext = createContext<HostSearch | null>(null)
export const HostSearchProvider = HostSearchContext.Provider
export function useHostSearch(): HostSearch | null {
  return useContext(HostSearchContext)
}
