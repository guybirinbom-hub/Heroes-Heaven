import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { Creature, Defenses } from '../types/pf2e'
import { HostSearchProvider, type HostSearch } from '../data/hostSearchContext'

/*
 * THE WINDOW BODY'S INSET AND TEXT SELECTION — item 7 of the owner's online list (2026-10-01: "Search
 * everything results open in the tracker's movable, windowed stat-block popup").
 *
 * A window (WinItem) and a docked pane (PopupPreview `fill`) wrap their content in a body box with the
 * reference popups' 14×18 inset. Two kinds of content bring their own: a Heroes Heaven page (`host`,
 * the card has its own head and body insets) and a full bestiary stat block (a creature window, or a
 * 'bestiary' pane tab) — doubled, the page sat in a thick frame. Those bodies have NO inset. And the
 * window root is `user-select: none` (a header drag must never select text), which made a host page's
 * rules text impossible to copy; a host page's body selects text again, as Heroes Heaven's own popup
 * always did.
 *
 *  (a) a host page window: no inset, text selectable;
 *  (b) a reference window (a condition): the usual inset, the root's no-select left alone;
 *  (c) a bestiary creature window: no inset;
 *  (d) a GM-screen pane (PopupPreview fill): a host page no inset + selectable, a 'bestiary' tab no
 *      inset, a reference pane the usual inset; a hover preview of a creature (no fill) keeps the inset.
 *
 * And the host's controls (Heroes Heaven's star) beside the close button:
 *  (e) pressing one does not start the header's window drag (the header drags the window from any
 *      press that reaches it);
 *  (f) a pane holding two tabs or more draws no header (its tab strip names the tabs), so its star sits in
 *      a strip above the page — before, the star went the moment a pinned page shared a pane.
 *
 * MUTATIONS (each applied, run, read off that run, then restored):
 *  - FloatingWindow `bleeds` → `false && (…)` → (a), (c) and (d) red (padding "14px 18px").
 *  - WinItem body: the `userSelect: 'text'` spread dropped → (a) red.
 *  - PopupPreview body: the `userSelect: 'text'` spread dropped → (d) red.
 *  - `bleeds`: `type === 'bestiary' ||` dropped → (d) red at the bestiary pane.
 *  - HostControls: `onMouseDown={e => e.stopPropagation()}` dropped → (e) red ("a press on the star
 *    moved the window").
 *  - PopupPreview: `{hideHeader && type === 'host' && <HostControls … bar />}` dropped → (f) red.
 *
 * Every record here is synthetic.
 */

const bestiary = vi.hoisted(() => ({ raider: null as unknown }))
vi.mock('../data/dataStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/dataStore')>()),
  loadCreatureByName: async (name: string) => (name.toLowerCase() === 'synthetic raider' ? bestiary.raider : null),
}))

const DEF: Defenses = { ac: 18, fort: 9, ref: 7, will: 5, hp: 40, immunities: [], resistances: [], weaknesses: [] }
const RAIDER: Creature = {
  id: 'synth', name: 'Synthetic Raider', source: 'Test', level: 1,
  traits: ['humanoid'], perception: 6, senses: [], languages: ['Common'], skills: {},
  str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 0,
  items: [], speed: { walk: 25 }, attacks: [], spellcasting: [], abilities: [],
  defenses: DEF, isHazard: false, raw: {} as Creature['raw'],
}
bestiary.raider = RAIDER

const { FloatingWindowLayer, PopupPreview } = await import('./FloatingWindow')
const { useWindowStore, BASE_Z } = await import('../store/windowStore')

const HOST: HostSearch = {
  records: [],
  open: () => undefined,
  render: (bucket, id) => <p data-page="">{`${bucket}:${id} — the page`}</p>,
  controls: () => <button type="button" data-star="">★</button>,
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}
/** A window's body: the box between its header and its resize grip. */
const winBody = () => document.querySelector<HTMLElement>('[data-float-win]')!.children[1] as HTMLElement
/** A pane's (or preview's) body: the last box in its root. */
const paneBody = () => document.querySelector<HTMLElement>('[data-win-root]')!.lastElementChild as HTMLElement
const inset = (el: HTMLElement) => el.style.padding

beforeEach(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
})
afterEach(() => {
  cleanup()
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
})

describe('a window body brings no second inset, and a host page reads as text', () => {
  it('(a) a host page window: no inset, text selectable', async () => {
    render(<HostSearchProvider value={HOST}><FloatingWindowLayer /></HostSearchProvider>)
    act(() => useWindowStore.getState().open('host', 'feats:gleam-step', 'Gleam Step'))
    await settle()
    const body = winBody()
    expect(body.querySelector('[data-page]'), 'the page is in this box').not.toBeNull()
    expect(inset(body), 'no inset of the window\'s own').toMatch(/^0(px)?$/)
    expect(body.style.userSelect, 'the page\'s text is selectable').toBe('text')
    // Not vacuous: the window around it still selects nothing (a header drag never selects text).
    expect((document.querySelector('[data-float-win]') as HTMLElement).style.userSelect).toBe('none')
  })

  it('(b) a reference window keeps the usual inset, and selects nothing', async () => {
    render(<HostSearchProvider value={HOST}><FloatingWindowLayer /></HostSearchProvider>)
    act(() => useWindowStore.getState().open('condition', 'synthetic glare', 'Synthetic Glare'))
    await settle()
    const body = winBody()
    expect(inset(body)).toBe('14px 18px')
    expect(body.style.userSelect).not.toBe('text')
  })

  it('(c) a bestiary creature window: the full stat block, no inset', async () => {
    render(<FloatingWindowLayer />)
    act(() => useWindowStore.getState().open('creature', 'synthetic raider', 'Synthetic Raider'))
    await settle()
    const body = winBody()
    expect(body.querySelector('.stat-block'), 'the full stat block').not.toBeNull()
    expect(inset(body)).toMatch(/^0(px)?$/)
  })

  it('(d) a docked pane bleeds the same way; a hover preview keeps its inset', async () => {
    const { unmount } = render(<HostSearchProvider value={HOST}><PopupPreview type="host" ref_="feats:gleam-step" title="Gleam Step" fill /></HostSearchProvider>)
    expect(inset(paneBody()), 'a host pane').toMatch(/^0(px)?$/)
    expect(paneBody().style.userSelect, 'a host pane selects text').toBe('text')
    unmount()

    const bestiary = render(<PopupPreview type="bestiary" ref_="synthetic raider" title="Synthetic Raider" fill />)
    await settle()
    expect(paneBody().querySelector('.stat-block'), 'a bestiary pane draws the full stat block').not.toBeNull()
    expect(inset(paneBody()), 'a bestiary pane').toMatch(/^0(px)?$/)
    bestiary.unmount()

    const ref = render(<PopupPreview type="condition" ref_="synthetic glare" title="Synthetic Glare" fill />)
    expect(inset(paneBody()), 'a reference pane').toBe('14px 18px')
    expect(paneBody().style.userSelect).not.toBe('text')
    ref.unmount()

    render(<PopupPreview type="creature" ref_="synthetic raider" title="Synthetic Raider" />)
    await settle()
    expect(document.querySelector('.stat-block'), 'a hover preview is the compact card').toBeNull()
    expect(inset(paneBody()), 'a hover preview').toBe('14px 18px')
  })
})

describe("a host page's controls (its star)", () => {
  /** Press at (x, y), drag to (x + dx, y), let go — the way a mouse moves a window by its header. */
  const drag = (el: Element, x: number, y: number, dx: number) => {
    act(() => { fireEvent.mouseDown(el, { button: 0, clientX: x, clientY: y }) })
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: x + dx, clientY: y }))
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: x + dx, clientY: y }))
    })
  }
  const pos = () => { const w = useWindowStore.getState().wins[0]; return { x: w.x, y: w.y } }

  it('(e) pressing one does not start the header\'s window drag', async () => {
    // The drag looks for a window to merge into under the cursor; jsdom has no hit testing.
    const realFromAll = document.elementsFromPoint
    document.elementsFromPoint = () => []
    try {
      render(<HostSearchProvider value={HOST}><FloatingWindowLayer /></HostSearchProvider>)
      act(() => useWindowStore.getState().open('host', 'feats:gleam-step', 'Gleam Step', 100, 100, { noCascade: true }))
      await settle()
      const star = document.querySelector('[data-float-win] [data-host-controls] [data-star]')!
      expect(star, 'the star in the window header').not.toBeNull()
      const before = pos()
      drag(star, 300, 110, 120)
      expect(pos(), 'a press on the star moved the window').toEqual(before)
      // Not vacuous: the same press on the header itself (its empty strip around the tab) drags it.
      const header = document.querySelector<HTMLElement>('[data-float-win] [data-tab-win] > div')!
      drag(header, 300, 110, 120)
      expect(pos(), 'the header drags the window').toEqual({ x: before.x + 120, y: before.y })
    } finally {
      document.elementsFromPoint = realFromAll
    }
  })

  it('(f) a pane holding two tabs or more draws no header; its star sits in a strip above the page', async () => {
    const multi = render(<HostSearchProvider value={HOST}><PopupPreview type="host" ref_="feats:gleam-step" title="Gleam Step" fill hideHeader /></HostSearchProvider>)
    const root = document.querySelector('[data-win-root]')!
    expect(root.querySelector('[data-host-controls-bar] [data-host-controls] [data-star]'), 'the star, above the page').not.toBeNull()
    expect(root.lastElementChild!.querySelector('[data-page]'), 'the page under it').not.toBeNull()
    multi.unmount()
    // A pane of one tab keeps it in its header, and draws no strip.
    const single = render(<HostSearchProvider value={HOST}><PopupPreview type="host" ref_="feats:gleam-step" title="Gleam Step" fill /></HostSearchProvider>)
    expect(document.querySelector('[data-host-controls-bar]'), 'no strip under a header').toBeNull()
    expect(document.querySelector('[data-win-root] [data-host-controls] [data-star]'), 'the star in the header').not.toBeNull()
    single.unmount()
    // A reference page has no host controls, header or not.
    render(<HostSearchProvider value={HOST}><PopupPreview type="condition" ref_="synthetic glare" title="Synthetic Glare" fill hideHeader /></HostSearchProvider>)
    expect(document.querySelector('[data-host-controls]')).toBeNull()
  })
})
