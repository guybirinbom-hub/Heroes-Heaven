import { describe, it, expect } from 'vitest'
import { activitySymbol } from './tags'

/*
 * Action costs, including the VARIABLE ones.
 *
 * A census of the shipped bestiary found 1,003 abilities whose AoN markdown carries an
 * `<actions string="…" />` that never reached the JSON. 171 of those are ranges — 153 of them
 * "Single Action to Three Actions" — which the old {number, unit} shape simply could not express,
 * so there was nowhere to put the value even if the parser had read it.
 */
describe('activitySymbol', () => {
  it('renders the fixed costs', () => {
    expect(activitySymbol({ number: 1, unit: 'action' })).toBe(' ◆')
    expect(activitySymbol({ number: 2, unit: 'action' })).toBe(' ◆◆')
    expect(activitySymbol({ number: 3, unit: 'action' })).toBe(' ◆◆◆')
    expect(activitySymbol({ number: 1, unit: 'reaction' })).toBe(' ↺')
    expect(activitySymbol({ number: 1, unit: 'free' })).toBe(' ◇')
  })

  it('renders a range, keeping AoN’s own conjunction', () => {
    expect(activitySymbol({ number: 1, unit: 'action', to: 3 })).toBe(' ◆ to ◆◆◆')
    expect(activitySymbol({ number: 1, unit: 'action', to: 2, sep: 'or' })).toBe(' ◆ or ◆◆')
    expect(activitySymbol({ number: 2, unit: 'action', to: 3, sep: 'to' })).toBe(' ◆◆ to ◆◆◆')
  })

  it('treats a to-bound equal to the number as a fixed cost', () => {
    expect(activitySymbol({ number: 2, unit: 'action', to: 2 })).toBe(' ◆◆')
  })

  it('never renders an ability as costing nothing', () => {
    // repeat(0) would produce an empty glyph run that reads as "no action required".
    expect(activitySymbol({ number: 0, unit: 'action' })).toBe(' ◆')
    expect(activitySymbol({ number: 9, unit: 'action' })).toBe(' ◆◆◆')
  })

  it('is absent-safe and ignores units it does not know', () => {
    expect(activitySymbol(undefined)).toBe('')
    expect(activitySymbol({ number: 1, unit: 'minute' })).toBe('')
  })
})
