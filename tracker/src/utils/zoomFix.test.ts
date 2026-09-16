import { describe, it, expect } from 'vitest'
import { fixedPopupPos, pageZoom, localRect, localDelta } from './zoomFix'

/*
 * The right-click menu "appears far away" bug: Heroes Heaven zooms <html>, which scales a fixed
 * popup's left/top but not the click's clientX/clientY. The coordinates below are the ones measured
 * in the running embed before the fix.
 */
describe('fixedPopupPos', () => {
  const W = 184, H = 180   // the initiative row menu

  it('puts the popup on the click at zoom 1', () => {
    expect(fixedPopupPos(140, 202, W, H, 8, 1, 891, 900)).toEqual({ left: 140, top: 202 })
  })

  it('cancels a zoomed-out root (the menu used to land up and to the left)', () => {
    // Measured: a click at client (109, 159) with zoom 0.7 drew the menu at (76, 111) = 109·0.7, 159·0.7.
    const { left, top } = fixedPopupPos(109, 159, W, H, 8, 0.7, 891, 900)
    expect(left * 0.7).toBeCloseTo(109, 6)
    expect(top * 0.7).toBeCloseTo(159, 6)
  })

  it('cancels a zoomed-in root (the menu used to land down and to the right)', () => {
    // Measured: a click at client (182, 261) with zoom 1.3 drew the menu at (237, 339).
    const { left, top } = fixedPopupPos(182, 261, W, H, 8, 1.3, 891, 900)
    expect(left * 1.3).toBeCloseTo(182, 6)
    expect(top * 1.3).toBeCloseTo(261, 6)
  })

  it('clamps against the viewport in the popup’s own coordinate space', () => {
    // Zoom 0.5 doubles the room: an 891×493 viewport is 1782×986 popup pixels.
    expect(fixedPopupPos(880, 480, W, H, 8, 0.5, 891, 493)).toEqual({ left: 1782 - W - 8, top: 986 - H - 8 })
    // Zoom 2 halves it, so the same click is pulled much further back.
    expect(fixedPopupPos(880, 480, W, H, 8, 2, 891, 493)).toEqual({ left: 891 / 2 - W - 8, top: 493 / 2 - H - 8 })
  })

  it('keeps the clamped popup fully on screen once the zoom is applied back', () => {
    for (const zoom of [0.5, 0.7, 1, 1.3, 2]) {
      const { left, top } = fixedPopupPos(880, 480, W, H, 8, zoom, 891, 493)
      expect((left + W) * zoom).toBeLessThanOrEqual(891)
      expect((top + H) * zoom).toBeLessThanOrEqual(493)
    }
  })

  it('reads 1 when <html> carries no zoom', () => {
    expect(pageZoom()).toBe(1)
  })
})

/*
 * The conditions panel and every tooltip measure their trigger with getBoundingClientRect(), which
 * reports the same real viewport pixels a click does — so they drifted exactly like the row menu.
 */
describe('localRect', () => {
  const chip = (top: number) => ({
    getBoundingClientRect: () => ({ top, left: 100, bottom: top + 24, right: 220, width: 120, height: 24 }),
  }) as unknown as Element

  it('converts a trigger box into the popup’s coordinate space', () => {
    const r = localRect(chip(700), 0.7)
    // Multiplying back by the zoom has to land on the box the browser reported.
    expect(r.top * 0.7).toBeCloseTo(700, 6)
    expect(r.bottom * 0.7).toBeCloseTo(724, 6)
    expect(r.left * 0.7).toBeCloseTo(100, 6)
    expect(r.height * 0.7).toBeCloseTo(24, 6)
  })

  it('leaves the box alone at zoom 1', () => {
    expect(localRect(chip(700), 1)).toEqual({ top: 700, left: 100, bottom: 724, right: 220, width: 120, height: 24 })
  })

  it('closes the gap the conditions panel opened with — 210 px at a chip 700 px down, zoom 0.7', () => {
    const rect = chip(700).getBoundingClientRect()
    const before = rect.bottom + 6                                    // written straight into `top`
    const after = fixedPopupPos(rect.left, rect.bottom + 6, 320, 420, 8, 0.7, 1400, 2000).top
    expect(before * 0.7).toBeCloseTo(511, 6)                          // where the panel used to draw
    expect(after * 0.7).toBeCloseTo(730, 6)                           // where the chip actually is
    expect(after * 0.7 - before * 0.7).toBeCloseTo(219, 6)
  })
})

/*
 * Resizing a pinned window (FloatingWindow's grip): the drag delta is real viewport pixels, the
 * width/height it is added to are layout pixels, and a layout pixel renders as `zoom` real pixels
 * (a 300 px-wide fixed box measures 210 at zoom 0.7, 390 at 1.3). Adding one to the other made the
 * window's edge travel a different distance than the cursor that was dragging it.
 */
describe('localDelta', () => {
  const START_W = 400

  it('is the identity at zoom 1', () => {
    expect(localDelta(100, 1)).toBe(100)
  })

  it('makes the resized edge travel exactly as far as the cursor did on screen', () => {
    for (const zoom of [0.5, 0.7, 1, 1.3, 2]) {
      const cursor = 100                                        // real viewport px of grip travel
      const widthAfter = START_W + localDelta(cursor, zoom)     // layout px, written into `width`
      expect(widthAfter * zoom - START_W * zoom).toBeCloseTo(cursor, 6)
    }
  })

  it('shows the gap the old sum left — the edge lagged the cursor by 30 px per 100 at zoom 0.7', () => {
    const grewOnScreen = (START_W + 100) * 0.7 - START_W * 0.7  // old: real px added to a layout px width
    expect(grewOnScreen).toBeCloseTo(70, 6)
    expect(100 - grewOnScreen).toBeCloseTo(30, 6)
  })

  it('and ran ahead of it by 30 px per 100 at zoom 1.3', () => {
    expect((START_W + 100) * 1.3 - START_W * 1.3).toBeCloseTo(130, 6)
  })
})
