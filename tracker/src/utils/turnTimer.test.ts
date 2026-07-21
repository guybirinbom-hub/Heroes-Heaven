import { describe, it, expect } from 'vitest'
import { elapsedMs, formatTurnTime, type TurnTimerState } from './turnTimer'

const makeState = (over: Partial<TurnTimerState> = {}): TurnTimerState => ({
  combatantId: 'c1',
  name: 'Bob',
  isPC: true,
  startedAt: null,
  accumMs: 0,
  paused: false,
  ...over,
})

describe('elapsedMs', () => {
  it('returns 0 for a null timer', () => {
    expect(elapsedMs(null, 1000)).toBe(0)
  })

  it('returns now - startedAt + accumMs for a running timer', () => {
    const t = makeState({ startedAt: 1000, accumMs: 5000, paused: false })
    // now(8000) - startedAt(1000) = 7000, + accumMs(5000) = 12000
    expect(elapsedMs(t, 8000)).toBe(12000)
  })

  it('adds only the live window when accumMs is 0', () => {
    const t = makeState({ startedAt: 200, accumMs: 0, paused: false })
    expect(elapsedMs(t, 1200)).toBe(1000)
  })

  it('returns accumMs only for a paused timer (paused flag set)', () => {
    const t = makeState({ startedAt: 1000, accumMs: 5000, paused: true })
    // paused -> live window excluded, regardless of startedAt
    expect(elapsedMs(t, 999999)).toBe(5000)
  })

  it('returns accumMs only when startedAt is null even if not flagged paused', () => {
    const t = makeState({ startedAt: null, accumMs: 4200, paused: false })
    expect(elapsedMs(t, 999999)).toBe(4200)
  })

  it('returns 0 for a fresh running timer when now equals startedAt', () => {
    const t = makeState({ startedAt: 3000, accumMs: 0, paused: false })
    expect(elapsedMs(t, 3000)).toBe(0)
  })

  it('can produce a negative value when now is before startedAt (clock skew, no guard)', () => {
    const t = makeState({ startedAt: 5000, accumMs: 0, paused: false })
    expect(elapsedMs(t, 4000)).toBe(-1000)
  })

  it('treats startedAt === 0 as a valid start (not-null check uses != null)', () => {
    const t = makeState({ startedAt: 0, accumMs: 100, paused: false })
    // startedAt != null is true for 0, so live window is added
    expect(elapsedMs(t, 2000)).toBe(2100)
  })
})

describe('formatTurnTime', () => {
  it('formats 0 as "0:00"', () => {
    expect(formatTurnTime(0)).toBe('0:00')
  })

  it('formats a sub-minute value with zero-padded seconds', () => {
    expect(formatTurnTime(5)).toBe('0:05')
  })

  it('formats 59 seconds as "0:59"', () => {
    expect(formatTurnTime(59)).toBe('0:59')
  })

  it('formats exactly 60s as "1:00"', () => {
    expect(formatTurnTime(60)).toBe('1:00')
  })

  it('formats a multi-minute value as "M:SS"', () => {
    expect(formatTurnTime(125)).toBe('2:05')
  })

  it('formats just under an hour as minutes only', () => {
    expect(formatTurnTime(3599)).toBe('59:59')
  })

  it('formats exactly an hour as "H:MM:SS" with padded minutes', () => {
    expect(formatTurnTime(3600)).toBe('1:00:00')
  })

  it('formats a multi-hour value with padded minutes and seconds', () => {
    // 3661 = 1h 1m 1s
    expect(formatTurnTime(3661)).toBe('1:01:01')
  })

  it('rounds fractional seconds to the nearest whole second', () => {
    expect(formatTurnTime(59.4)).toBe('0:59')
    expect(formatTurnTime(59.5)).toBe('1:00')
  })

  it('clamps negative input to 0', () => {
    expect(formatTurnTime(-30)).toBe('0:00')
  })
})
