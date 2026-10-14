import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { Creature } from '../types/pf2e'
import { HostSearchProvider, type HostSearch } from '../data/hostSearchContext'

/*
 * A TALL WINDOW FITS THE SCREEN — item 7 of the owner's online list (2026-10-01: "Search everything results
 * open in the tracker's movable, windowed stat-block popup"), the leftover its browser walk found
 * (2026-10-12, at 1280 × 800): a creature opened from Search sat at y 240 with a max-height of 680, so the
 * last ~120 px of its stat block were under the bottom of the screen until the GM dragged it up. Placement
 * guessed every window 320 px tall (windowStore, and CampaignTracker's openHostWindow).
 *
 * The store's half is windowStore.test.ts ("a 680 px window at 1280 × 800 opens fully visible"); this file
 * pins the window's half — that a drawn window is MEASURED and handed to the store:
 *  (a) a window drawn 680 px tall is lifted until its bottom is on screen, the moment it is drawn;
 *  (b) …and again when its height changes later (a stat block arriving after "Loading…"), while a short
 *      one stays where it opened;
 *  (c) a window the GM dragged stays where he left it, whatever its height does;
 *  (d) its max-height is a number of the zoomed page's own viewport, not CSS `min(88vh, 680px)` — under
 *      Heroes Heaven's html{zoom} `vh` is multiplied by the zoom, so at 1.3 that window was taller than
 *      the screen; a live combatant's window the same;
 *  (e) a viewport resize redraws that number;
 *  (f) a tall page dropped off a GM-screen pane low on the screen (the owner's 2026-10-14 list: "a tall page
 *      dragged out of a pane can sit off screen") is lifted as it is drawn, and a drag after that is his;
 *  (g) a short page dropped there stays exactly where the GM let go.
 *
 * jsdom lays nothing out: the window's height (offsetHeight) and its ResizeObserver are stood in for here.
 *
 * MUTATIONS (each applied, run, read off that run, then restored):
 *  - FloatingWindow WinItem: the layout effect's first `measure()` dropped → (a) red (y 240).
 *  - WinItem: the ResizeObserver (`new ResizeObserver(measure)` … `ro.observe(el)`) dropped → (b) red at
 *    "the window watches its own height".
 *  - WinItem style: `maxHeight: winMaxH()` → `maxHeight: 'min(88vh, 680px)'` → (d) red.
 *  - WinItem style: `height: liveWinH()` → `height: 'min(82vh, 640px)'` → (d) red at the live window.
 *  - FloatingWindowLayer: the `resize` listener dropped → (e) red ('680px' after the viewport shrank).
 *  - windowStore openTabs: `moved: false` → `moved: true` (a dropped page counted as the GM's placement) → (f) red
 *    at "its bottom on screen" (y 450).
 *
 * Every record here is synthetic.
 */

const zoom = vi.hoisted(() => ({ value: 1 }))
vi.mock('../utils/zoomFix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/zoomFix')>()),
  pageZoom: () => zoom.value,
}))

const { FloatingWindowLayer } = await import('./FloatingWindow')
const { beginDockDrag } = await import('../store/dockDragStore')
const { useWindowStore, BASE_Z, WIN_MAX_H, winMaxH, liveWinH } = await import('../store/windowStore')
const { useCombatStore } = await import('../store/combatStore')

const HOST: HostSearch = {
  records: [],
  open: () => undefined,
  render: (bucket, id) => <p data-page="">{`${bucket}:${id}`}</p>,
}
/** A board row (a live combatant), for its window's set height. */
const SYNTH_ROW: Creature = {
  id: 'synth', name: 'Synthetic Raider', source: 'Test', level: 1,
  traits: ['humanoid'], perception: 6, senses: [], languages: ['Common'], skills: {},
  str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 0,
  items: [], speed: { walk: 25 }, attacks: [], spellcasting: [], abilities: [],
  defenses: { ac: 18, fort: 9, ref: 7, will: 5, hp: 40, immunities: [], resistances: [], weaknesses: [] },
  isHazard: false, raw: {} as Creature['raw'],
}

/** The height jsdom reports for a window (it lays nothing out, so every box is 0 otherwise). */
const drawn = { h: 0 }
/** The ResizeObservers the windows set up — fired by hand, as a browser fires one when a box changes size. */
const observers: { cb: () => void; el?: Element }[] = []
class FakeResizeObserver {
  private rec: { cb: () => void; el?: Element }
  constructor(cb: () => void) {
    this.rec = { cb }
    observers.push(this.rec)
  }
  observe(el: Element) { this.rec.el = el }
  unobserve() {}
  disconnect() {
    const i = observers.indexOf(this.rec)
    if (i >= 0) observers.splice(i, 1)
  }
}
const grew = () => act(() => { for (const o of [...observers]) o.cb() })
const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
const realFromAll = document.elementsFromPoint
const realFrom = document.elementFromPoint

const st = () => useWindowStore.getState()
const only = () => { const ws = st().wins; expect(ws).toHaveLength(1); return ws[0] }
const el = () => document.querySelector<HTMLElement>('[data-float-win]')!
const mount = () => render(<HostSearchProvider value={HOST}><FloatingWindowLayer /></HostSearchProvider>)
const viewport = (w: number, h: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h })
}

beforeEach(() => {
  zoom.value = 1
  viewport(1280, 800)
  drawn.h = 0
  observers.length = 0
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.hasAttribute('data-float-win') ? drawn.h : 0 },
  })
  // The header drag looks for a window to merge into under the cursor; jsdom has no hit testing.
  document.elementsFromPoint = () => []
  // …and the pane drop (dockDragStore) asks what is under the cursor: nothing, so the tab pops out.
  document.elementFromPoint = () => null
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (realOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetHeight)
  document.elementsFromPoint = realFromAll
  document.elementFromPoint = realFrom
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
  useCombatStore.setState({ combatants: [] } as never)
})

describe('a tall window fits the screen', () => {
  it('(a) a window drawn 680 px tall at 1280 × 800 is lifted until its bottom is on screen, the moment it is drawn', () => {
    drawn.h = 680
    mount()
    // Opened as a Search result opens one: centred, no point.
    act(() => st().open('host', 'reference:synthetic-article', 'Synthetic Article'))
    const w = only()
    expect(w.y, 'its header on screen').toBeGreaterThanOrEqual(8)
    expect(w.y + 680, 'its bottom on screen').toBeLessThanOrEqual(800 - 8)
    expect(el().style.top, 'drawn there').toBe(`${w.y}px`)
  })

  it('(b) …and again when its height changes later, while a short one stays where it opened', () => {
    drawn.h = 120 // "Loading…"
    mount()
    act(() => st().open('host', 'reference:synthetic-article', 'Synthetic Article', 300, 400, { noCascade: true }))
    expect({ x: only().x, y: only().y }, 'short: where it was opened').toEqual({ x: 300, y: 400 })
    expect(observers.some(o => o.el === el()), 'the window watches its own height').toBe(true)
    drawn.h = 680 // the page arrived
    grew()
    expect(only().y + 680, 'lifted when it grew').toBeLessThanOrEqual(800 - 8)
    expect(only().x).toBe(300)
  })

  it('(c) a window the GM dragged stays where he left it, whatever its height does', () => {
    drawn.h = 200
    mount()
    act(() => st().open('host', 'reference:synthetic-article', 'Synthetic Article', 300, 300, { noCascade: true }))
    const header = document.querySelector<HTMLElement>('[data-float-win] [data-tab-win] > div')!
    act(() => { fireEvent.mouseDown(header, { button: 0, clientX: 400, clientY: 310 }) })
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 560 }))
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 400, clientY: 560 }))
    })
    expect(only().y, 'the drag').toBe(550)
    drawn.h = 680
    grew()
    expect(only().y, 'left where the GM put it').toBe(550)
  })

  it('(d) its max-height is the zoomed page\'s own number, so it fits the screen at zoom 1.3 — a live combatant\'s window too', () => {
    zoom.value = 1.3
    mount()
    act(() => st().open('host', 'reference:synthetic-article', 'Synthetic Article'))
    // 800 real pixels are 615 of the page's: 88 % of those, where `88vh` meant 88 % of 800 (704 → 680).
    expect(winMaxH()).toBe(Math.floor((800 / 1.3) * 0.88))
    expect(el().style.maxHeight).toBe(`${winMaxH()}px`)
    expect((winMaxH() + 16) * 1.3, 'with both 8 px edges, inside the 800').toBeLessThanOrEqual(800)

    // A board row opened as a window: its live stat block fills a set height, the same kind of number.
    act(() => useCombatStore.getState().addCombatant(SYNTH_ROW))
    const id = useCombatStore.getState().combatants[0].id
    act(() => st().closeAll())
    act(() => st().open('creature', id, 'Synthetic Raider'))
    expect(liveWinH()).toBe(Math.floor((800 / 1.3) * 0.82))
    expect(el().style.height).toBe(`${liveWinH()}px`)
  })

  it('(e) a viewport resize redraws that number', () => {
    mount()
    act(() => st().open('host', 'reference:synthetic-article', 'Synthetic Article'))
    expect(el().style.maxHeight).toBe(`${WIN_MAX_H}px`)
    viewport(1280, 600)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(el().style.maxHeight).toBe(`${Math.floor(600 * 0.88)}px`)
  })

  /** The GM drags a tab out of a GM-screen pane and lets go at (500, 466): dockDragStore opens it as a window
   *  whose tab sits under the cursor, at (420, 450). */
  const dropOffPane = () => {
    const page = { type: 'host' as const, ref: 'reference:synthetic-article', title: 'Synthetic Article' }
    beginDockDrag({ allTabs: [page], popup: page, active: 0 }, 490, 466, { mode: 'tab' })
    act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 466 })) })
    act(() => { document.dispatchEvent(new MouseEvent('mouseup', { clientX: 500, clientY: 466 })) })
  }

  it('(f) a tall page dropped off a pane low on the screen is lifted as it is drawn, and a drag after that is his', () => {
    drawn.h = 680
    mount()
    dropOffPane()
    const w = only()
    expect(w.x, 'sideways at the drop point').toBe(420)
    expect(w.y + 680, 'its bottom on screen').toBeLessThanOrEqual(800 - 8)
    expect(el().style.top, 'drawn there').toBe(`${w.y}px`)
    // He drags it down by its header (as (c) does): from then on it stays wherever its height goes.
    const header = document.querySelector<HTMLElement>('[data-float-win] [data-tab-win] > div')!
    act(() => { fireEvent.mouseDown(header, { button: 0, clientX: 700, clientY: w.y + 10 }) })
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 700, clientY: w.y + 10 + 250 }))
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 700, clientY: w.y + 10 + 250 }))
    })
    expect(only().y, 'the drag').toBe(w.y + 250)
    drawn.h = 700
    grew()
    expect(only().y, 'left where the GM put it').toBe(w.y + 250)
  })

  it('(g) a short page dropped off a pane stays exactly where the GM let go', () => {
    drawn.h = 200
    mount()
    dropOffPane()
    expect({ x: only().x, y: only().y }).toEqual({ x: 420, y: 450 })
    expect(el().style.top).toBe('450px')
  })
})
