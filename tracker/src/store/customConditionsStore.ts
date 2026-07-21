import { create } from 'zustand'
import type { StatMods, ModType } from '../utils/conditionEffects'

/** A situational modifier on a single stat — applies only `when` a circumstance
 *  is met. Surfaced as a "*" next to the matching check in the stat block. */
export type ConditionalMods = Partial<Record<keyof StatMods, { value: number; when: string; type: ModType }>>

/** Bonus/penalty type per always-on stat mod (PF2e typed stacking). */
export type ModTypes = Partial<Record<keyof StatMods, ModType>>

const STORAGE_KEY = 'pf2e-custom-conditions'

/**
 * A user-defined condition template — saved to the library so it can be
 * reapplied later, edited, or shared between combatants. The applied form on
 * a combatant is `AppliedCondition` in types/pf2e.ts; templates here carry
 * the metadata the editor needs to recreate that applied form.
 */
export interface CustomCondition {
  id: string
  name: string
  description?: string
  /** "Cursed 3" style — when true the badge shows a value, when false it's
   *  a flat condition with no number. */
  hasValue: boolean
  maxValue: number
  /** When true, the stat mods are PER value point (Frightened-style). */
  scalesByValue: boolean
  /** Default rounds when applied (ignored if isPermanent). */
  defaultDuration: number
  isPermanent: boolean
  /** When true, the applied condition will tick down by 1 each turn end. */
  autoDecrement: boolean
  /** Sparse mod table — only non-zero keys are stored. */
  mods: Partial<StatMods>
  /** Bonus/penalty type for each always-on mod. Absent key → untyped. */
  modTypes?: ModTypes
  /** Situational mods that only apply in a typed circumstance. A stat is in
   *  either `mods` (always on) or `condMods` (conditional), never both. */
  condMods?: ConditionalMods
  /** Optional badge tinting (hex). Defaults applied at render time. */
  bg?: string
  border?: string
  createdAt: number
  updatedAt: number
}

function loadAll(): CustomCondition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as CustomCondition[]
  } catch {
    return []
  }
}

function saveAll(list: CustomCondition[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* quota errors are surfaced by the calling component as needed */
  }
}

/** Build a blank template — used when the editor opens for a new entry. */
export function emptyCustomCondition(): CustomCondition {
  const now = Date.now()
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `cc-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    description: '',
    hasValue: false,
    maxValue: 4,
    scalesByValue: true,
    defaultDuration: 3,
    isPermanent: false,
    autoDecrement: false,
    mods: {},
    modTypes: {},
    condMods: {},
    createdAt: now,
    updatedAt: now,
  }
}

interface CustomConditionsStore {
  conditions: CustomCondition[]
  /** Add a brand-new template (returns its id) or overwrite an existing one
   *  if `c.id` already exists in the library. */
  upsert: (c: CustomCondition) => void
  remove: (id: string) => void
  /** Replace the entire list — used by future import/export. */
  setAll: (list: CustomCondition[]) => void
  getById: (id: string) => CustomCondition | undefined
}

export const useCustomConditionsStore = create<CustomConditionsStore>((set, get) => ({
  conditions: loadAll(),
  upsert(c) {
    set(state => {
      const idx = state.conditions.findIndex(x => x.id === c.id)
      const next = [...state.conditions]
      const stamped = { ...c, updatedAt: Date.now() }
      if (idx >= 0) next[idx] = stamped
      else next.push(stamped)
      saveAll(next)
      return { conditions: next }
    })
  },
  remove(id) {
    set(state => {
      const next = state.conditions.filter(c => c.id !== id)
      saveAll(next)
      return { conditions: next }
    })
  },
  setAll(list) {
    saveAll(list)
    set({ conditions: list })
  },
  getById(id) {
    return get().conditions.find(c => c.id === id)
  },
}))
