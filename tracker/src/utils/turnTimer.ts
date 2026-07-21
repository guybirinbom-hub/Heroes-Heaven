// ── Turn-timer shared types + helpers ─────────────────────────────────────

/** One completed turn recorded during combat. */
export interface TurnRecord {
  id: string
  combatantId: string
  name: string
  /** PC turns are attributed to a party member by name; non-PC turns all fold
   *  into the single universal "DM" average. */
  isPC: boolean
  /** Counted duration of the turn, in whole seconds (paused time excluded). */
  seconds: number
}

/** Live running-timer state for the turn in progress. */
export interface TurnTimerState {
  combatantId: string
  name: string
  isPC: boolean
  /** Wall-clock ms when the current counting window began; null while paused. */
  startedAt: number | null
  /** Counted ms banked from previous windows (before the latest pause). */
  accumMs: number
  paused: boolean
}

/** Total counted milliseconds for a running timer, at time `now`. */
export function elapsedMs(t: TurnTimerState | null, now: number): number {
  if (!t) return 0
  return t.accumMs + (t.startedAt != null && !t.paused ? now - t.startedAt : 0)
}

/** Format seconds as "M:SS" (or "H:MM:SS" past an hour). */
export function formatTurnTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`
}
