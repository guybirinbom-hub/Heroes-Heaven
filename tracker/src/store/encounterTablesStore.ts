import { create } from 'zustand'

// ─────────────────────────────────────────────────────────────────────────────
// Random encounter tables. Each table has a flat-check DC, a free-form note
// (the road/river/flying adjustment reminder by default), and TWO sub-tables —
// monsters and hazards — that the GM chooses between when rolling. Persisted to
// localStorage; mirrors the customThemesStore pattern.
// ─────────────────────────────────────────────────────────────────────────────

/** A linked bestiary creature/hazard, resolved to a full stat block at roll
 *  time via loadCreatureByName. Stored thin so the table stays small. */
export interface EntryCreatureRef {
  name: string
  level?: number
  isHazard?: boolean
}

export interface EncounterEntry {
  id: string
  /** Display text, e.g. "1d4 giant scorpions". Falls back to the linked
   *  creature's name when blank. */
  label: string
  /** Relative odds when rolling on this sub-table (min 1). */
  weight: number
  /** Optional link to a real bestiary creature/hazard. */
  creature?: EntryCreatureRef
}

/** Which of a table's two sub-tables to roll on. */
export type EncounterKind = 'creature' | 'hazard'

export interface EncounterTable {
  id: string
  name: string
  /** Flat-check DC that determines whether a random encounter occurs. */
  dc: number
  /** Adjustment reminder shown under the DC. Editable per table. */
  note: string
  creatures: EncounterEntry[]
  hazards: EncounterEntry[]
}

/** The standard PF2e travel adjustment reminder — the default for new tables. */
export const DEFAULT_ENCOUNTER_NOTE =
  'On a road or river, decrease the DC by 2. If PCs are flying, increase the DC by 3, but choose a hazard or monster that is relevant to flying PCs.'

const KEY = 'pf2e-encounter-tables'

function load(): EncounterTable[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

function persist(tables: EncounterTable[]) {
  try { localStorage.setItem(KEY, JSON.stringify(tables)) } catch { /* quota / private mode */ }
}

let _seq = 0
/** Collision-resistant id: timestamp + monotonic counter, base36. */
export function newEncId(prefix = 'enc'): string {
  _seq += 1
  return `${prefix}-${Date.now().toString(36)}${_seq.toString(36)}`
}

export function newEncounterEntry(): EncounterEntry {
  return { id: newEncId('e'), label: '', weight: 1 }
}

export function newEncounterTable(): EncounterTable {
  return {
    id: newEncId('table'),
    name: 'New encounter table',
    dc: 15,
    note: DEFAULT_ENCOUNTER_NOTE,
    creatures: [],
    hazards: [],
  }
}

/** Weighted-random pick from a sub-table. Returns null for an empty list.
 *  Weights below 1 are floored to 1 so every listed entry can come up. */
export function rollEncounterEntry(entries: EncounterEntry[]): EncounterEntry | null {
  if (!entries.length) return null
  const total = entries.reduce((s, e) => s + Math.max(1, e.weight || 1), 0)
  let r = Math.random() * total
  for (const e of entries) {
    r -= Math.max(1, e.weight || 1)
    if (r < 0) return e
  }
  return entries[entries.length - 1]
}

interface EncounterTablesStore {
  tables: EncounterTable[]
  /** Add a new table or replace one with the same id. */
  upsert: (t: EncounterTable) => void
  remove: (id: string) => void
}

export const useEncounterTablesStore = create<EncounterTablesStore>((set, get) => ({
  tables: load(),
  upsert(t) {
    const cur = get().tables
    const next = cur.some(x => x.id === t.id)
      ? cur.map(x => (x.id === t.id ? t : x))
      : [...cur, t]
    persist(next)
    set({ tables: next })
  },
  remove(id) {
    const next = get().tables.filter(x => x.id !== id)
    persist(next)
    set({ tables: next })
  },
}))
