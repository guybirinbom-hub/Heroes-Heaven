import { describe, it, expect } from 'vitest'
import { deriveThemeVars, luminance, textOnAccent, type ThemeColors } from './themeColors'

// A custom theme is six colours the user picked, so `--text-on-accent` is DERIVED here rather than
// authored per theme — the one place in the tracker that decides the ink on an accent fill. It used
// to flip on a luminance cutoff (`> 0.55`), which paints white on every mid-bright accent: the
// cutoff can only ever name one of two colours, so measuring both can never do worse.

const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const INK = '#1a1011'
const WHITE = '#ffffff'

const seed: ThemeColors = { accent: '#38bdf8', linked: '#82a89a', danger: '#c66a5a', bg: '#161011', text: '#f0e6d6', hp: '#8fb56a' }

/** Every 6th step of each channel — 216 accents, i.e. the whole cube a colour picker can hand us. */
const ACCENTS: string[] = []
for (const r of [0, 51, 102, 153, 204, 255])
  for (const g of [0, 51, 102, 153, 204, 255])
    for (const b of [0, 51, 102, 153, 204, 255])
      ACCENTS.push(`#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`)

describe('ink on a custom theme accent', () => {
  it('keeps the better-contrasting of ink and white for any accent', () => {
    for (const accent of ACCENTS) {
      const got = textOnAccent(accent)
      expect([INK, WHITE], `${accent}: not one of the two inks`).toContain(got)
      expect(ratio(got, accent), `${accent}: worse ink chosen`).toBeCloseTo(
        Math.max(ratio(INK, accent), ratio(WHITE, accent)), 10,
      )
    }
  })

  it('never scores below the luminance cutoff it replaced', () => {
    for (const accent of ACCENTS) {
      const wasIt = luminance(accent) > 0.55 ? INK : WHITE
      expect(ratio(textOnAccent(accent), accent), `${accent}: worse than before`)
        .toBeGreaterThanOrEqual(ratio(wasIt, accent))
    }
  })

  it('applies to the token a custom theme actually paints with', () => {
    // The reported case: a sky accent used to get white at 2.14:1.
    const vars = deriveThemeVars({ ...seed, accent: '#38bdf8' })
    expect(vars['--text-on-accent']).toBe(INK)
    expect(ratio(vars['--text-on-accent'], '#38bdf8')).toBeGreaterThan(4.5)
  })
})
