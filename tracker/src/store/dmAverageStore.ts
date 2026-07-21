import { create } from 'zustand'

// ── Universal DM turn-time average ─────────────────────────────────────────
// Shared across every party (unlike per-player averages, which live on each
// party member). Holds a cumulative mean of every non-player turn ever folded
// in via "Save to Averages", plus the total turn count so new turns are
// weighted correctly.

const STORAGE_KEY = 'pf2e-dm-turn-average'

/** One "Save to Averages" batch of DM turns, with the date it was saved — the
 *  data the DM turn-time graph plots (mirrors PartyPlayer.turnHistory). */
export interface DmTurnEntry { at: number; avgSeconds: number; turnCount: number }

interface DmAverage {
  avgSeconds: number
  turnCount: number
  history: DmTurnEntry[]
}

function load(): DmAverage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { avgSeconds: 0, turnCount: 0, history: [] }
    const p = JSON.parse(raw) as Partial<DmAverage>
    return { avgSeconds: p.avgSeconds ?? 0, turnCount: p.turnCount ?? 0, history: Array.isArray(p.history) ? p.history : [] }
  } catch {
    return { avgSeconds: 0, turnCount: 0, history: [] }
  }
}

function save(a: DmAverage) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(a)) } catch { /* quota */ }
}

interface DmAverageStore extends DmAverage {
  /** Fold a batch of turns into the cumulative average. */
  addTurns: (sumSeconds: number, count: number) => void
  reset: () => void
}

export const useDmAverageStore = create<DmAverageStore>((set, get) => ({
  ...load(),
  addTurns(sumSeconds, count) {
    if (count <= 0) return
    const { avgSeconds, turnCount, history } = get()
    const newCount = turnCount + count
    const newAvg = (avgSeconds * turnCount + sumSeconds) / newCount
    const next = {
      avgSeconds: newAvg,
      turnCount: newCount,
      history: [...history, { at: Date.now(), avgSeconds: sumSeconds / count, turnCount: count }],
    }
    save(next)
    set(next)
  },
  reset() {
    const next = { avgSeconds: 0, turnCount: 0, history: [] }
    save(next)
    set(next)
  },
}))
