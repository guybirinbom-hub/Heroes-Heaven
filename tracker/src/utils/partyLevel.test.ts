import { describe, it, expect } from 'vitest'
import { derivePartyLevel } from './partyLevel'

describe('derivePartyLevel', () => {
  it('is the shared level when the party is level — the normal case', () => {
    expect(derivePartyLevel([3, 3, 3, 3])).toBe(3)
    expect(derivePartyLevel([1])).toBe(1)
    expect(derivePartyLevel([20, 20])).toBe(20)
  })

  it('returns null for an empty party rather than inventing a level', () => {
    // The whole bug this replaced was a fabricated default of 1 that silently rated a level-3
    // party's encounters against a level-1 budget. No data must mean "no answer", so the caller
    // keeps its own fallback instead of being handed a wrong number that looks right.
    expect(derivePartyLevel([])).toBeNull()
  })

  it('ignores levels it cannot use instead of dragging the average down', () => {
    // A name-only PC has no level. Counting it as 0 would drag a level-4 party to 3.
    expect(derivePartyLevel([4, 4, NaN, 4])).toBe(4)
    expect(derivePartyLevel([4, 0, 4])).toBe(4)
    expect(derivePartyLevel([NaN])).toBeNull()
  })

  it('rounds a split party to the nearest level', () => {
    expect(derivePartyLevel([3, 4])).toBe(4) // 3.5 → 4 (ties round up)
    expect(derivePartyLevel([3, 3, 3, 4])).toBe(3) // 3.25 → 3
    expect(derivePartyLevel([3, 4, 4, 4])).toBe(4) // 3.75 → 4
  })

  it('treats a nonsense level as no level, not as a low one', () => {
    // There's no such thing as a level below 1, so it's bad data rather than a small number:
    // averaging it in would drag the real characters down and under-rate every encounter.
    expect(derivePartyLevel([-5])).toBeNull()
    expect(derivePartyLevel([5, -5, 5])).toBe(5)
  })
})
