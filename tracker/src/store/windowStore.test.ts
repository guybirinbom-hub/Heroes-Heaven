import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The floating windows' store, for item 7 of the owner's online list (2026-10-01: "Search everything
 * results open in the tracker's movable, windowed stat-block popup, not a static popup"). Every Search
 * page is a window now, so the store's placement, width and z-order carry far more traffic than the
 * occasional creature window they were written for.
 *
 * MUTATIONS (each applied, run, read off that run, then restored):
 *  - toFront: the `if (!win || win.z >= s.topZ) return s` early return dropped → "a focus on the window
 *    already on top moves nothing" red (topZ climbs by one).
 *  - settleZ: `if (s.topZ <= RENORM_AT) return s` made `return s` always (no renumbering) → "3,000
 *    focuses" red (topZ 3502, above the tracker's modals at 2000).
 *  - open: `winWidthFor(type)` → `WIN_W` → "a host page opens at a page's width" red (420).
 *  - clampPos: `vw - w - 10` → `vw - 430` (the old hard-coded clamp) → "kept on screen by its OWN width" red.
 *  - viewport: `/ z` dropped → "centred in the zoomed page's own pixels" red.
 *  - closeTop: highest z → first window → "Escape peels the TOP window" red.
 *  - closeAll: `topZ: BASE_Z` dropped → "closeAll empties the store" red at the topZ check.
 *
 * TALL WINDOWS FIT THE SCREEN (item 7, the browser walk of 2026-10-12: at 1280 × 800 a creature opened
 * from Search at y 240 with a max-height of 680, its last ~120 px under the bottom edge). Placement guesses
 * a window 320 px tall; once drawn, FloatingWindow measures it and `fit` lifts it until its bottom is on
 * screen (FloatingWindow.fit.test.tsx pins that wiring). MUTATIONS, as above:
 *  - fit: `clampPos(win.x, win.y, win.w, h).y` → `win.y` (no lift) → "a 680 px window at 1280 × 800" red
 *    (y 240, its bottom at 920).
 *  - clampPos: `vh - h - 8` → `vh - 320` (the old guess for every height) → the same leg red.
 *  - fit: `win.moved || win.sized ? win.y :` dropped → "a window the GM dragged or resized" red.
 *  - move: `moved: true` dropped → the same leg red at "dragged" and at "dropped off a pane, then dragged";
 *    detachTab's new window's `moved: true` dropped → red at "pulled off a tab strip".
 *  - open (re-open at a click): `win.drawnH` → `undefined` → "opened again at a click near the bottom" red;
 *    its `moved: false` dropped → the same leg red at "lifted for its new height".
 *  - fit: `win.moved || win.sized` → `win.moved` → "a window the GM dragged or resized" red at "resized".
 *  - fit: `!(h > 0)` dropped → "a window not drawn yet" red (a 0 height noted, the re-open hangs off).
 *  - winMaxH: `viewport().vh` → `window.innerHeight` (not divided by the zoom) → "at zoom 1.25" red.
 *
 * A TALL PAGE DROPPED OUT OF A PANE (the owner's 2026-10-14 list, item 5: "a tall page dragged out of a pane
 * can sit off screen"). openTabs made that window `moved: true`, so `fit` never lifted it: dropped low, its
 * bottom hung under the screen edge. It is the app's placement now, at the GM's drop point, until he drags or
 * resizes it; a tab pulled off a window's strip (detachTab) stays his at once, as he drags that live.
 * MUTATIONS, as above:
 *  - openTabs: `moved: false` → `moved: true` → "a tall page dropped low" red (y 450, its bottom at 1130), and
 *    "a page dropped low is lifted when it grows" red; FloatingWindow.fit.test.tsx (f) red.
 *  - fit: `win.moved || win.sized ? win.y :` dropped → "after the GM drags or resizes a dropped page" red
 *    (both the drag and the resize), the same line the dragged-window leg pins.
 */

const zoom = vi.hoisted(() => ({ value: 1 }))
vi.mock('../utils/zoomFix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/zoomFix')>()),
  pageZoom: () => zoom.value,
}))

const { useWindowStore, BASE_Z, RENORM_AT, HOST_WIN_W, WIN_W, WIN_MAX_H, winMaxH } = await import('./windowStore')

const W = 1024
const H = 768

beforeEach(() => {
  zoom.value = 1
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: W })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: H })
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
})
afterEach(() => useWindowStore.setState({ wins: [], topZ: BASE_Z }))

const st = () => useWindowStore.getState()
const zs = () => st().wins.map(w => w.z)

describe('windowStore — z-order', () => {
  it('a focus on the window already on top moves nothing (topZ does not climb)', () => {
    st().open('spell', 'fireball', 'Fireball')
    st().open('spell', 'heal', 'Heal')
    const top = st().wins[1]
    const before = st().topZ
    for (let i = 0; i < 50; i++) st().toFront(top.id)
    expect(st().topZ).toBe(before)
    expect(st().wins[1].z).toBe(before)
  })

  it('3,000 focuses between two windows never lift topZ past the renumbering line, and the order holds', () => {
    st().open('spell', 'fireball', 'Fireball')
    st().open('spell', 'heal', 'Heal')
    st().open('condition', 'frightened', 'Frightened')
    const [a, b, c] = st().wins.map(w => w.id)
    for (let i = 0; i < 3000; i++) st().toFront(i % 2 ? a : b)
    // The tracker's own modals sit at z 2000 and the Search box at 9500: windows stay under both.
    expect(st().topZ).toBeLessThanOrEqual(RENORM_AT + 1)
    // topZ is never below a window: the host stacks a confirm at topZ + 20 above every one.
    expect(st().topZ).toBeGreaterThanOrEqual(Math.max(...zs()))
    // The last one focused is on top; the untouched one is at the bottom.
    const z = Object.fromEntries(st().wins.map(w => [w.id, w.z]))
    expect(z[a]).toBeGreaterThan(z[b])
    expect(z[b]).toBeGreaterThan(z[c])
    expect(new Set(zs()).size).toBe(3)
  })
})

describe('windowStore — width and placement', () => {
  it('a host page opens at a page\'s width; a creature at the usual width', () => {
    st().open('host', 'feats:power-attack', 'Power Attack')
    st().open('creature', 'goblin warrior', 'Goblin Warrior')
    expect(st().wins.map(w => w.w)).toEqual([HOST_WIN_W, WIN_W])
  })

  it('is kept on screen by its OWN width (a 560 window clamped as if it were 420 hung off the edge)', () => {
    st().open('host', 'feats:power-attack', 'Power Attack', 5000, 100, { noCascade: true })
    const w = st().wins[0]
    expect(w.x).toBe(W - HOST_WIN_W - 10)
    expect(w.x + w.w).toBeLessThanOrEqual(W)
  })

  it('opens centred in the zoomed page\'s own pixels (Heroes Heaven scales the app with html{zoom})', () => {
    zoom.value = 2
    st().open('host', 'feats:power-attack', 'Power Attack')
    const w = st().wins[0]
    // At zoom 2 the page is 512 layout pixels wide; centred, the window's middle is at 256.
    expect(w.x + w.w / 2).toBe(W / 2 / 2)
    expect(w.x * 2 + w.w * 2).toBeLessThanOrEqual(W)
  })

  it('a pinned host page dragged off the GM screen opens at a page\'s width too', () => {
    st().openTabs([{ type: 'host', ref: 'feats:power-attack', title: 'Power Attack' }], 100, 100)
    expect(st().wins[0].w).toBe(HOST_WIN_W)
  })
})

describe('windowStore — a tall window fits the screen', () => {
  /** The viewport the browser walk had: 1280 × 800 real pixels. */
  const laptop = () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  }
  const win = (id: string) => st().wins.find(w => w.id === id)!

  it('a 680 px window at 1280 × 800 opens fully visible', () => {
    laptop()
    // At 800 tall the cap IS 680: a stat block or an article reaches it.
    expect(winMaxH()).toBe(WIN_MAX_H)
    // Opened from Search (centred), and a second one (cascaded) — as the walk did.
    st().open('creature', 'synthetic commando', 'Synthetic Commando')
    st().open('host', 'reference:synthetic-article', 'Synthetic Article')
    const [a, b] = st().wins.map(w => w.id)
    expect(win(a).y, 'placed for the 320 px guess, as the walk saw it').toBe(240)
    // FloatingWindow draws them and reports their height (the store's `fit`).
    st().fit(a, 680)
    st().fit(b, 680)
    for (const id of [a, b]) {
      const w = win(id)
      expect(w.y, `${id}: the header on screen`).toBeGreaterThanOrEqual(8)
      expect(w.y + 680, `${id}: the bottom on screen`).toBeLessThanOrEqual(800 - 8)
    }
    // Lifted just enough, not to the top.
    expect(win(a).y).toBe(800 - 680 - 8)
    // A link clicked low on the page (the walk: (538, 686) → a window at y 472) opens whole too, at its x.
    st().open('host', 'feats:synthetic-focus', 'Synthetic Focus', 538, 472, { noCascade: true })
    const c = st().wins[2]
    st().fit(c.id, 680)
    expect(win(c.id).x, 'at the click').toBe(538)
    expect(win(c.id).y + 680).toBeLessThanOrEqual(800 - 8)
  })

  it('a short window stays where it opened (at a link\'s click)', () => {
    laptop()
    st().open('trait', 'synthetic', 'Synthetic', 300, 420, { noCascade: true })
    const { id } = st().wins[0]
    st().fit(id, 260)
    expect({ x: win(id).x, y: win(id).y }).toEqual({ x: 300, y: 420 })
  })

  it('a window taller than the screen keeps its header on it (the GM drags it from there)', () => {
    laptop()
    st().open('host', 'reference:synthetic-article', 'Synthetic Article')
    const { id } = st().wins[0]
    st().fit(id, 2000)
    expect(win(id).y).toBe(8)
  })

  it('a window the GM dragged or resized stays where he left it', () => {
    laptop()
    st().open('creature', 'synthetic commando', 'Synthetic Commando')
    st().open('host', 'reference:synthetic-article', 'Synthetic Article')
    const [dragged, resized] = st().wins.map(w => w.id)
    st().move(dragged, 100, 600)
    st().fit(dragged, 680)
    expect({ x: win(dragged).x, y: win(dragged).y }, 'dragged').toEqual({ x: 100, y: 600 })
    const y = win(resized).y
    st().resize(resized, 500, 700)
    st().fit(resized, 700)
    expect(win(resized).y, 'resized').toBe(y)
    // A tab dropped off a pane (dockDragStore) is the app's placement until he touches it (the next block of
    // legs); once he has dragged it, it is his. And one pulled off a window's tabs, which he drags live.
    const dropped = st().openTabs([{ type: 'host', ref: 'feats:synthetic-drop', title: 'Synthetic Drop' }], 300, 450)
    st().move(dropped, 300, 450)
    st().fit(dropped, 680)
    expect(win(dropped).y, 'dropped off a pane, then dragged').toBe(450)
    st().mergeTab(dropped, { type: 'condition', ref: 'synthetic glare', title: 'Synthetic Glare' })
    const pulled = st().detachTab(dropped, 1, 500, 420)!
    expect(pulled).not.toBe(dropped)
    st().fit(pulled, 680)
    expect(win(pulled).y, 'pulled off a tab strip').toBe(420)
  })

  it('opened again at a click near the bottom, a page already open is kept whole by the height it was drawn at', () => {
    laptop()
    st().open('host', 'reference:synthetic-article', 'Synthetic Article')
    const { id } = st().wins[0]
    st().fit(id, 680)
    // The GM drags it away, then a link elsewhere names the same page: it is put at that click again.
    st().move(id, 400, 40)
    st().open('host', 'reference:synthetic-article', 'Synthetic Article', 600, 500, { noCascade: true })
    expect(st().wins).toHaveLength(1)
    expect(win(id).x, 'at the click').toBe(600)
    expect(win(id).y + 680, 'its whole height on screen').toBeLessThanOrEqual(800 - 8)
    // …and it is the app's placement again: a later height change lifts it.
    st().open('host', 'reference:synthetic-article', 'Synthetic Article', 600, 100, { noCascade: true })
    st().fit(id, 760)
    expect(win(id).y, 'lifted for its new height').toBe(800 - 760 - 8)
  })

  it('a window not drawn yet (height 0) is not measured: a re-open at a click still keeps 320 px on screen', () => {
    laptop()
    st().open('host', 'reference:synthetic-article', 'Synthetic Article')
    const { id } = st().wins[0]
    st().fit(id, 0)
    expect(win(id).drawnH, 'nothing noted').toBeUndefined()
    st().open('host', 'reference:synthetic-article', 'Synthetic Article', 600, 700, { noCascade: true })
    expect(win(id).y).toBe(800 - 320)
  })

  it('at zoom 1.25 the cap and the lift are in the zoomed page\'s own pixels', () => {
    laptop()
    zoom.value = 1.25
    // 800 real pixels are 640 of the page's: the cap is 88 % of that, not of 800 (which would be 680 —
    // taller than the 640 the screen holds).
    const cap = winMaxH()
    expect(cap).toBe(Math.floor(640 * 0.88))
    st().open('creature', 'synthetic commando', 'Synthetic Commando')
    const { id } = st().wins[0]
    st().fit(id, cap)
    // On screen, in real pixels: the bottom inside the 800.
    expect((win(id).y + cap) * 1.25).toBeLessThanOrEqual(800 - 8)
    expect(win(id).y).toBeGreaterThanOrEqual(8)
  })
})

describe('windowStore — a tall page dropped out of a pane fits the screen', () => {
  const laptop = () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  }
  const win = (id: string) => st().wins.find(w => w.id === id)!
  const page = (n: string) => ({ type: 'host' as const, ref: `reference:synthetic-${n}`, title: `Synthetic ${n}` })

  it('a tall page dropped low is lifted until its bottom is on screen, and keeps the drop point\'s x', () => {
    laptop()
    const id = st().openTabs([page('article')], 300, 450)
    expect({ x: win(id).x, y: win(id).y }, 'placed at the drop point').toEqual({ x: 300, y: 450 })
    // FloatingWindow draws it and reports its height (the store's `fit`).
    st().fit(id, 680)
    expect(win(id).y + 680, 'its bottom on screen').toBeLessThanOrEqual(800 - 8)
    expect(win(id).y, 'lifted just enough, not to the top').toBe(800 - 680 - 8)
    expect(win(id).x, 'sideways it stays at the drop point').toBe(300)
  })

  it('a short page dropped low stays exactly at the drop point', () => {
    laptop()
    const id = st().openTabs([page('note')], 300, 450)
    st().fit(id, 260)
    expect({ x: win(id).x, y: win(id).y }).toEqual({ x: 300, y: 450 })
  })

  it('a page dropped low is lifted when it grows (a stat block arriving after "Loading…"), until the GM touches it', () => {
    laptop()
    const id = st().openTabs([page('article')], 300, 450)
    st().fit(id, 120)
    expect(win(id).y, 'short while it loads: where it was dropped').toBe(450)
    st().fit(id, 680)
    expect(win(id).y + 680, 'lifted when the page arrived').toBeLessThanOrEqual(800 - 8)
  })

  it('after the GM drags or resizes a dropped page, fit never lifts it again', () => {
    laptop()
    const dragged = st().openTabs([page('dragged')], 300, 450)
    st().fit(dragged, 680)
    expect(win(dragged).y, 'first drawn: lifted').toBe(800 - 680 - 8)
    // His drag, a later height report, and a page that grows after it.
    st().move(dragged, 340, 600)
    st().fit(dragged, 680)
    expect({ x: win(dragged).x, y: win(dragged).y }, 'dragged').toEqual({ x: 340, y: 600 })
    st().fit(dragged, 760)
    expect(win(dragged).y, 'dragged, then it grew').toBe(600)
    // His resize: the window is his as soon as he sizes it, wherever it was dropped.
    const resized = st().openTabs([page('resized')], 700, 450)
    st().fit(resized, 120)
    st().resize(resized, 500, 700)
    st().fit(resized, 700)
    expect(win(resized).y, 'resized').toBe(450)
  })
})

describe('windowStore — closing', () => {
  it('Escape peels the TOP window (closeTop), whatever order they were opened in', () => {
    st().open('spell', 'fireball', 'Fireball')
    st().open('spell', 'heal', 'Heal')
    st().open('condition', 'frightened', 'Frightened')
    const [first, second, third] = st().wins.map(w => w.id)
    // The middle one, brought to the front: neither the first opened nor the last.
    st().toFront(second)
    expect(st().closeTop()).toBe(true)
    expect(st().wins.map(w => w.id)).toEqual([first, third])
    // Then the highest of the rest: the last opened.
    expect(st().closeTop()).toBe(true)
    expect(st().wins.map(w => w.id)).toEqual([first])
    expect(st().closeTop()).toBe(true)
    expect(st().closeTop()).toBe(false)
  })

  it('closeAll empties the store and starts the z-order over', () => {
    st().open('spell', 'fireball', 'Fireball')
    st().open('host', 'feats:power-attack', 'Power Attack')
    st().closeAll()
    expect(st().wins).toEqual([])
    expect(st().topZ).toBe(BASE_Z)
  })
})
