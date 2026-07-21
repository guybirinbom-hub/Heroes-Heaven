import { create } from 'zustand'
import type { ThemeColors } from '../utils/themeColors'

// User-made themes: a name, the built-in theme they're layered over (for the
// non-colour tokens), and the six colours they picked. Persisted to localStorage
// and surfaced in the Appearance theme picker alongside the built-ins.
export interface CustomTheme {
  id: string          // 'custom-<n>'
  name: string
  base: string        // a built-in ThemeId
  colors: ThemeColors
}

const KEY = 'pf2e-custom-themes'

function load(): CustomTheme[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}
function persist(themes: CustomTheme[]) {
  try { localStorage.setItem(KEY, JSON.stringify(themes)) } catch { /* quota */ }
}

interface CustomThemesStore {
  themes: CustomTheme[]
  /** Add a new theme or replace one with the same id. */
  upsert: (t: CustomTheme) => void
  remove: (id: string) => void
}

export const useCustomThemesStore = create<CustomThemesStore>((set, get) => ({
  themes: load(),
  upsert(t) {
    const cur = get().themes
    const next = cur.some(x => x.id === t.id) ? cur.map(x => (x.id === t.id ? t : x)) : [...cur, t]
    persist(next)
    set({ themes: next })
  },
  remove(id) {
    const next = get().themes.filter(x => x.id !== id)
    persist(next)
    set({ themes: next })
  },
}))

let _seq = 0
/** A stable-ish unique id for a new custom theme. */
export function newCustomThemeId(): string {
  _seq += 1
  return `custom-${load().length + _seq}-${Math.floor(performance.now())}`
}

/** Look up a custom theme by id (non-reactive — for applyTheme at module load). */
export function findCustomTheme(id: string): CustomTheme | undefined {
  return useCustomThemesStore.getState().themes.find(t => t.id === id)
}
