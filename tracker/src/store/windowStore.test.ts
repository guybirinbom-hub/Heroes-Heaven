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
 */

const zoom = vi.hoisted(() => ({ value: 1 }))
vi.mock('../utils/zoomFix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/zoomFix')>()),
  pageZoom: () => zoom.value,
}))

const { useWindowStore, BASE_Z, RENORM_AT, HOST_WIN_W, WIN_W } = await import('./windowStore')

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
