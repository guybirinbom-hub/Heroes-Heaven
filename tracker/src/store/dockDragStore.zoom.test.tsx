import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'

/*
 * DRAGGING A WINDOW UNDER HEROES HEAVEN'S ZOOM — item 7 of the owner's online list (2026-10-01: "Search
 * everything results open in the tracker's movable, windowed stat-block popup"). A page pinned to the GM
 * screen becomes a window by being dragged out of its pane, and every window moves by being dragged.
 *
 * Heroes Heaven scales the whole app with html{zoom}. A window's x/y are layout pixels of that zoomed
 * page; a MouseEvent's clientX/clientY are real viewport pixels (utils/zoomFix). dockDragStore wrote the
 * one into the other: at zoom 2 a page popped out of a pane at the cursor (600, 400) opened at layout
 * (520, 384) — drawn at (1040, 768) on screen, far off the cursor — and a window dragged 100 px went 200.
 * The item-7 refuter, round 2, found the pop-out; the moves are the same writes.
 *
 *  (a) a tab pulled out of a pane opens under the cursor, in the page's own pixels;
 *  (b) a window dragged by its ⠿ handle (dock mode) travels as far as the cursor did on screen;
 *  (c) a window dragged by its header (browser mode) the same;
 *  (d) a tab dragged off a window's tab strip opens under the cursor and follows it.
 *
 * MUTATIONS (each applied, run, read off that run, then restored):
 *  - dockDragStore pop-out: `e.clientX / z - 80, e.clientY / z - 16` → `e.clientX - 80, e.clientY - 16`
 *    → (a) red ({520, 384}).
 *  - dockDragStore beginDockDrag move: `localDelta(e.clientX - startX, z)` → `e.clientX - startX` → (b) red.
 *  - dockDragStore beginBrowserDrag move: the same → (c) red, and (d) red at "follows the cursor".
 *  - FloatingWindow tab chip: `e.clientX / z - 80` → `e.clientX - 80` → (d) red at "opens under the cursor".
 *
 * Every record here is synthetic.
 */

const zoom = vi.hoisted(() => ({ value: 1 }))
vi.mock('../utils/zoomFix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/zoomFix')>()),
  pageZoom: () => zoom.value,
}))

const { beginDockDrag, beginBrowserDrag } = await import('./dockDragStore')
const { useWindowStore, BASE_Z } = await import('./windowStore')
const { useGmLayoutStore } = await import('./layoutStore')
const { FloatingWindowLayer } = await import('../components/FloatingWindow')

/** The real viewport: 2400 × 1600 px. At zoom 2 the page is laid out in 1200 × 800 of its own pixels. */
const VW = 2400
const VH = 1600
const realFrom = document.elementFromPoint
const realFromAll = document.elementsFromPoint

beforeEach(() => {
  zoom.value = 2
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: VW })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: VH })
  // No pane, window or tab strip under the cursor anywhere (jsdom has no hit testing).
  document.elementFromPoint = () => null
  document.elementsFromPoint = () => []
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
  useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null })
})
afterEach(() => {
  cleanup()
  document.elementFromPoint = realFrom
  document.elementsFromPoint = realFromAll
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
  useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null })
})

const move = (x: number, y: number) => document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }))
const up = (x: number, y: number) => document.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y }))
const only = () => { const ws = useWindowStore.getState().wins; expect(ws).toHaveLength(1); return ws[0] }
const PAGE = { type: 'host' as const, ref: 'feats:synthetic-stride', title: 'Synthetic Stride' }

describe('a window dragged at zoom 2 lands where the cursor is', () => {
  it('(a) a tab pulled out of a pane opens under the cursor, in the page\'s own pixels', () => {
    act(() => useGmLayoutStore.getState().addPopup(PAGE))
    const leaf = useGmLayoutStore.getState().root!
    beginDockDrag({ allTabs: [PAGE], popup: PAGE, active: 0, fromLeaf: leaf.id, fromScope: 'gm', fromTabIndex: 0 }, 590, 400, { mode: 'tab' })
    move(600, 400)
    up(600, 400)
    const w = only()
    // The cursor (600, 400) is the page's (300, 200); the window keeps the cursor 80 px into its tab.
    expect({ x: w.x, y: w.y }).toEqual({ x: 300 - 80, y: 200 - 16 })
    expect(useGmLayoutStore.getState().root, 'the tab left its pane').toBeNull()
  })

  it('(b) a window dragged by its ⠿ handle travels as far as the cursor did on screen', () => {
    useWindowStore.getState().open(PAGE.type, PAGE.ref, PAGE.title, 100, 100, { noCascade: true })
    const w0 = only()
    beginDockDrag({ popup: PAGE, allTabs: [PAGE], active: 0, winId: w0.id, winPos: { x: w0.x, y: w0.y } }, 500, 300)
    move(700, 400)
    // 200 × 100 real pixels are 100 × 50 of the page's.
    expect({ x: only().x, y: only().y }).toEqual({ x: 200, y: 150 })
    up(700, 400)
  })

  it('(c) a window dragged by its header the same', () => {
    useWindowStore.getState().open(PAGE.type, PAGE.ref, PAGE.title, 100, 100, { noCascade: true })
    const w0 = only()
    beginBrowserDrag(() => ({ winId: w0.id, startWX: w0.x, startWY: w0.y }), 500, 300, 'tabstrip')
    move(700, 400)
    expect({ x: only().x, y: only().y }).toEqual({ x: 200, y: 150 })
    up(700, 400)
  })

  it('(d) a tab dragged off a window\'s tab strip opens under the cursor and follows it', async () => {
    render(<FloatingWindowLayer />)
    act(() => {
      useWindowStore.getState().open('condition', 'synthetic glare', 'Synthetic Glare', 100, 100, { noCascade: true })
      useWindowStore.getState().mergeTab(useWindowStore.getState().wins[0].id, { type: 'condition', ref: 'synthetic haze', title: 'Synthetic Haze' })
    })
    const chips = [...document.querySelectorAll<HTMLElement>('[data-tab-win] [title="Synthetic Haze"]')]
    expect(chips, 'the second tab chip').toHaveLength(1)
    act(() => { fireEvent.mouseDown(chips[0], { button: 0, clientX: 600, clientY: 400 }) })
    act(() => { move(610, 400) })
    const detached = useWindowStore.getState().wins.find(w => w.tabs[0].ref === 'synthetic haze')!
    expect(detached, 'the tab became its own window').toBeTruthy()
    // Opened at the press, (600, 400) → the page's (300, 200), then carried 10 real px = 5 of the page's.
    expect({ x: detached.x, y: detached.y }, 'opens under the cursor and follows it').toEqual({ x: 300 - 80 + 5, y: 200 - 16 })
    act(() => { up(610, 400) })
  })
})
