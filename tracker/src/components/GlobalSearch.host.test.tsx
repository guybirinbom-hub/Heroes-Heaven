import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { GlobalSearch } from './GlobalSearch'
import { HostSearchProvider, type HostSearch } from '../data/hostSearchContext'
import { useWindowStore, BASE_Z } from '../store/windowStore'
import { useEscapeCloses } from '../utils/spendEscape'

/*
 * Search everything, routed (item 7 of the owner's online list, 2026-10-01: "Search everything results
 * open in the tracker's movable, windowed stat-block popup, not a static popup").
 *
 *  (a) a host that draws pages (`render`): a result opens a `host` window ("bucket:id", the result's
 *      name as its tab) and the host's `open` is NOT called;
 *  (b) a host that draws none (Heroes Heaven's own pickers test mounts one): `open`, and no window;
 *  (c) picked for the GM screen (`onPick`): the pick, and no window;
 *  (d) Escape closes the picker and nothing else: the press never reaches a `window` listener (where
 *      Heroes Heaven's dismiss stack would leave the campaign), whether the focus is in the box or not,
 *      and the picker's onClose runs once;
 *  (e) opened by an opener that registers it as a tracker layer (`escapeRef`, the GM screen's picker since
 *      2026-10-14): the shared listener closes it, once — it adds no `document` listener of its own.
 *
 * MUTATIONS (each applied, run, read off that run, then restored):
 *  - choose: `else if (host?.render) openWin('host', ref, h.title)` dropped → (a) red (open called, no window).
 *  - onKeyDown: `e.stopPropagation()` dropped → (d) red at "onClose runs once" (the document listener
 *    closes it a second time).
 *  - the document listener's `e.stopPropagation()` dropped → (d) red at "with the focus on <body>"
 *    (the window listener hears the press).
 *
 * Every record here is synthetic.
 */

const RECORDS = [
  { bucket: 'feats', id: 'gleam-step', name: 'Gleam Step', detail: 'Level 2 · Synthetic Guide' },
  { bucket: 'spells', id: 'hush-of-tin', name: 'Hush of Tin' },
]

function host(over: Partial<HostSearch> = {}): HostSearch {
  return { records: RECORDS, open: vi.fn(), ...over }
}

async function search(q: string): Promise<HTMLInputElement> {
  const input = document.querySelector<HTMLInputElement>('input')!
  fireEvent.change(input, { target: { value: q } })
  // useDeferredValue: the results land on a later render.
  for (let i = 0; i < 5 && !document.querySelector('[data-row]'); i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  return input
}

beforeEach(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
})
afterEach(() => {
  cleanup()
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
})

describe('GlobalSearch — where a host result opens', () => {
  it('(a) a host that draws pages: the result opens as a host window, not the host popup', async () => {
    const h = host({ render: () => <p>page</p> })
    const onClose = vi.fn()
    render(<HostSearchProvider value={h}><GlobalSearch onClose={onClose} /></HostSearchProvider>)
    await search('Gleam')
    fireEvent.click(document.querySelector('[data-row="0"]')!)
    const wins = useWindowStore.getState().wins
    expect(wins).toHaveLength(1)
    expect(wins[0].tabs).toEqual([{ type: 'host', ref: 'feats:gleam-step', title: 'Gleam Step', castRank: undefined }])
    expect(h.open).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('(b) a host that draws no pages: its own open, and no window', async () => {
    const h = host()
    render(<HostSearchProvider value={h}><GlobalSearch onClose={() => undefined} /></HostSearchProvider>)
    await search('Hush')
    fireEvent.click(document.querySelector('[data-row="0"]')!)
    expect(h.open).toHaveBeenCalledWith('spells', 'hush-of-tin')
    expect(useWindowStore.getState().wins).toEqual([])
  })

  it('(c) picked for the GM screen: the pick, and no window', async () => {
    const onPick = vi.fn()
    render(<HostSearchProvider value={host({ render: () => null })}><GlobalSearch onClose={() => undefined} onPick={onPick} /></HostSearchProvider>)
    await search('Gleam')
    fireEvent.click(document.querySelector('[data-row="0"]')!)
    expect(onPick).toHaveBeenCalledWith({ type: 'host', ref: 'feats:gleam-step', title: 'Gleam Step' })
    expect(useWindowStore.getState().wins).toEqual([])
  })
})

describe('GlobalSearch — Escape closes the picker and nothing else', () => {
  const heard = vi.fn()
  beforeEach(() => {
    heard.mockReset()
    window.addEventListener('keydown', heard)
  })
  afterEach(() => window.removeEventListener('keydown', heard))

  it('(d) with the focus in the box: onClose runs once, and the press never reaches window', async () => {
    const onClose = vi.fn()
    render(<HostSearchProvider value={host({ render: () => null })}><GlobalSearch onClose={onClose} title="Add to GM Screen" /></HostSearchProvider>)
    const input = await search('Gleam')
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(onClose, 'onClose runs once').toHaveBeenCalledTimes(1)
    expect(heard, 'the press reached window').not.toHaveBeenCalled()
  })

  it('(e) opened by a GM screen that registers it (`escapeRef`): Escape with the focus on <body> closes it ONCE — the shared listener’s, none of its own', async () => {
    /*
     * The GM screen's "Add to GM Screen" picker is one of the tracker's registered layers since 2026-10-14
     * (GMScreen.tsx AddReferencePicker; utils/spendEscape useEscapeCloses), so Android's Back closes it.
     * Its own `document` listener would be a second closer on the same press: twice here, and in a browser
     * (React committing between listeners) it took the shared listener away mid-press.
     * MUTATION (tried 2026-10-14, GlobalSearch): `if (registered) return` dropped from its listener's effect
     *   → FAILS "closed once, by the shared listener: expected "vi.fn()" to be called 1 times, but got 2
     *   times" (its own listener closed it, then the shared one again).
     */
    const onClose = vi.fn()
    function Registered() {
      const escapeRef = useEscapeCloses(onClose)
      return <GlobalSearch onClose={onClose} title="Add to GM Screen" escapeRef={escapeRef} />
    }
    render(<HostSearchProvider value={host({ render: () => null })}><Registered /></HostSearchProvider>)
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(onClose, 'closed once, by the shared listener').toHaveBeenCalledTimes(1)
    expect(heard, 'the press reached window').not.toHaveBeenCalled()
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })) })
  })

  it('(d) with the focus on <body>: the same', async () => {
    const onClose = vi.fn()
    render(<HostSearchProvider value={host({ render: () => null })}><GlobalSearch onClose={onClose} title="Add to GM Screen" /></HostSearchProvider>)
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(heard, 'with the focus on <body>: the press reached window').not.toHaveBeenCalled()
    // Any other key still goes about its business.
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true })) })
    expect(heard).toHaveBeenCalledTimes(1)
  })
})
