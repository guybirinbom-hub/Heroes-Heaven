import { create } from 'zustand'

// ── Disabled sources (books) ────────────────────────────────────────────────
// The user can turn whole books off in Settings → Sources. We store the set of
// DISABLED (cleaned) book names — so the default of "everything on" needs no
// data, and a book discovered later (new data) is on until explicitly turned
// off. Every browse/search surface filters its content by this set, and the
// creature filter hides disabled books from its source pills.

const KEY = 'pf2e-disabled-sources'

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}
function persist(list: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* quota */ }
}

interface SourcesStore {
  /** Cleaned book names that are turned OFF. */
  disabled: string[]
  /** Flip one book on↔off. */
  toggle: (book: string) => void
  /** Force one book on (true) or off (false). */
  setEnabled: (book: string, on: boolean) => void
  /** Turn the given books on (removes them from disabled). */
  enable: (books: string[]) => void
  /** Turn the given books off (adds them to disabled). */
  disable: (books: string[]) => void
  /** Turn everything back on. */
  enableAll: () => void
}

export const useSourcesStore = create<SourcesStore>((set, get) => ({
  disabled: load(),
  toggle(book) {
    const cur = get().disabled
    const next = cur.includes(book) ? cur.filter(b => b !== book) : [...cur, book]
    persist(next); set({ disabled: next })
  },
  setEnabled(book, on) {
    const cur = get().disabled
    const next = on ? cur.filter(b => b !== book) : (cur.includes(book) ? cur : [...cur, book])
    persist(next); set({ disabled: next })
  },
  enable(books) {
    const rm = new Set(books)
    const next = get().disabled.filter(b => !rm.has(b))
    persist(next); set({ disabled: next })
  },
  disable(books) {
    const next = Array.from(new Set([...get().disabled, ...books]))
    persist(next); set({ disabled: next })
  },
  enableAll() { persist([]); set({ disabled: [] }) },
}))

/** Non-reactive snapshot of the disabled set (for use outside React). */
export function disabledSourcesSet(): Set<string> {
  return new Set(useSourcesStore.getState().disabled)
}
