import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EncounterTablesModal } from './EncounterTablesModal'
import { EncounterTableEditor } from './EncounterTableEditor'
import { AdvancedConditionEditor } from './AdvancedConditionEditor'
import { GlobalSearch } from './GlobalSearch'
import { MonsterSearch } from './MonsterSearch'
import { TextConverter } from './TextConverter'
import { ConditionsSection } from './SettingsModal'
import { HostSearchProvider } from '../data/hostSearchContext'
import { useEncounterTablesStore } from '../store/encounterTablesStore'
import { useCustomConditionsStore, emptyCustomCondition } from '../store/customConditionsStore'
import { closeTopTrackerModal, topTrackerModalUnderAWindow, useTrackerModalCount } from '../utils/spendEscape'
import type { Creature, Defenses } from '../types/pf2e'

/*
 * ESCAPE CLOSES THE TRACKER MODAL ON TOP AND GOES NO FURTHER (the item-7 refuter, 2026-10-13).
 *
 * The Encounter Building tables, the encounter-table editor and its Link picker, and the advanced
 * condition editor had no Escape of their own. Inside a Heroes Heaven campaign the host now stands down
 * while one is open (the campaign-level legs: test/bug-tracker-escape-boxes.test.tsx (b), (f)), so Escape
 * did NOTHING there; in Heroes Heaven's Settings it reached the Settings page and closed the whole page.
 * Each now closes itself on Escape and SPENDS the press (tracker/src/utils/spendEscape.ts
 * useEscapeCloses): it never reaches `window`, where Heroes Heaven's dismiss stack listens.
 *
 *  (a) the Encounter Building tables close; nothing reaches the window; other keys still do;
 *  (b) the advanced condition editor (opened from Settings, no picker under it) closes — typed in the
 *      Name box it opens on, too — and saves nothing;
 *  (c) the table editor with its Link picker open over it: one press closes the PICKER only, the next
 *      the editor; nothing is saved;
 *  every leg: with nothing open, Escape is a plain press again (the listener is not left behind
 *  swallowing it).
 *
 * HELD DOWN (the G7e refuter, 2026-10-13: a held Escape from the Link picker went on to close the table
 * editor too, the half-made table with it — every keydown after the first carries `repeat`):
 *  (d) from the Link picker: the picker closes, the repeats close nothing, the editor stays; pressed
 *      afresh (the key let go where the page could not see it), the press is the editor's;
 *  (e) after the LAST modal closed: its repeats reach nothing — not the window behind, not the campaign —
 *      until the key is let go;
 *  (f) a repeat of a press a box in the modal kept for itself closes nothing.
 *
 * MUTATIONS (2026-10-13, each applied alone, run, read off that run, then restored byte-exact —
 * tracker/src/utils/spendEscape.ts unless named):
 *  - spendEscape: `e.stopPropagation()` dropped → (a), (b) red at "nothing reached the window", (c) at
 *    "nothing reached the window (picker)".
 *  - onModalKey: the top as `openModals[0]` (the FIRST opened) → (c) red at "the editor stays under it".
 *  - EncounterTablesModal: `useEscapeCloses(onClose)` dropped → (a) red at "nothing reached the window".
 *  - AdvancedConditionEditor: `useEscapeCloses(onClose)` dropped → (b) red at "nothing reached the window".
 *  - CreaturePickerModal: `useEscapeCloses(onClose)` dropped → (c) red at "the editor stays under it"
 *    (the press went to the editor, which took its picker with it).
 *  - EncounterTableEditor: `useEscapeCloses(onClose)` dropped → (c) red at "nothing reached the window
 *    (editor)".
 *  HELD-KEY MUTATIONS (G7s, 2026-10-13 — the hold now starts in onModalPress, a `window` capture
 *  listener, whichever listener then closes the modal; each applied alone, run, read off that run, then
 *  restored byte-exact — tracker/src/utils/spendEscape.ts):
 *  - onModalKey: `if (e.repeat) return` dropped → (g) red at "the search's repeat 2: nothing reached the
 *    window" (a press the search took holds nothing, so its first repeat reached the tables' listener and
 *    closed them; the second went on to `window`).
 *  - onModalPress: `holdUntilLetGo(e)` dropped → (e) red at "repeat 1 — held: the window never hears it",
 *    and the StrictMode leg (CombatantMenu.test.tsx) at "held, repeat 2: nothing reached the window".
 *    ((f) stays green: while a modal is still open its own listener spends a repeat. Re-tried in G7s round
 *    2: (d) is red too, at "the fresh press's repeat: nothing reached the window" — that press closed the
 *    last modal. The campaign's (b) HELD stays green since the host lets no repeat close a window or
 *    leave.)
 *  - useEscapeCloses: `window.addEventListener('keydown', onModalPress, true)` dropped → the same two red.
 *  - onHeldKey: `e === holdStart` dropped from its first line → (d) red at "the fresh press's repeat:
 *    nothing reached the window": a fresh press after a press the page never saw let go of ended the hold
 *    it had just taken over (onModalPress was added first, so it runs first).
 *  - onHeldKey: `e.type === 'keydown' && e.repeat` → `e.type === 'keydown'` (a fresh press swallowed too)
 *    → (a), (b), (c) red at their last line (the hold kept the next press: expected [] to deeply equal
 *    ['Escape']), with three legs of CombatantMenu.test.tsx.
 *  - holdUntilLetGo: its `keyup` listener dropped → (e) red at "let go: the hold is over".
 *  - onModalKey: `e.stopImmediatePropagation()` dropped (G7s re-run) → (h) red at "the search under it
 *    never heard the press", (g) at "the search's repeat 1".
 *
 * ONLY THE LAYER DRAWN ON TOP (the G7e refuter, round 2: Search — Ctrl+K, z 9500, its own `document`
 * listener — opened over the Encounter Building tables, z 2000; with the focus off its box one Escape
 * closed the tables UNDER the search, then the search too, the tables' listener having been added first):
 *  (g) Search over the tables: the press closes the search, the tables stay; the next closes the tables;
 *  (h) the reverse — the custom-condition editor (z 10001) drawn OVER a search opened after it (z 9500):
 *      the press closes the editor and the search's later listener never hears it;
 *  (i) every one of the four modals, covered all over by a layer drawn above it: the press is the
 *      layer's, unspent by the modal, which stays;
 *  (j) covered only in part (a tooltip, a small menu), with the hit test finding nothing at all (the box
 *      off the screen), or with a box of no size (nothing to measure): the modal is on top, as before;
 *  (q) under a layer that STAYS drawn over all of the modal, a held Escape holds nothing: its repeats go
 *      on to that layer (the G7s refuter: no leg pinned the hold's own coverage test);
 *  (r) a modal inside a floating window another window is drawn over: the press is that window's (the G7s
 *      refuter, round 2) — unless it comes from inside the modal's own window.
 * jsdom has no hit test: `hitTest` stands in for the browser's `elementFromPoint`, answering what the
 * browser draws on top (the z-indexes named in each leg), and gives every `.modal-box` a size.
 * DRAWN-ON-TOP MUTATIONS (G7e round 2, 2026-10-13, each applied alone with Edit, run, read off that run,
 * then restored byte-exact — tracker/src/utils/spendEscape.ts unless named):
 *  - onModalKey: `if (coveredAllOver(top.el())) return` dropped → (g) red at "Escape closed the search"
 *    (the tables took the press and spent it, so the search never heard it), all four (i) red at "the
 *    layer on top took the press"; the campaign's own leg (test/bug-tracker-escape-boxes.test.tsx, SEARCH)
 *    red at "Escape closed the search".
 *  - onModalKey: `e.stopImmediatePropagation()` dropped → (h) red at "the search under it never heard
 *    the press" (and, before G7s moved the hold to `window`, (f); G7s's re-run: above).
 *  - coveredAllOver: `if (modal.contains(hit)) return false` dropped → (g), (h), all four (i) and (j) red.
 *  - coveredAllOver: `let covered = false` → `true` → (j) red at "nothing reached the window (again)".
 *  - coveredAllOver: the no-size line `if (!(r.width > 0 && r.height > 0)) return false` dropped → (j) red
 *    at "nothing reached the window (third)".
 *  - `ref={escapeRef}` dropped from EncounterTablesModal → (g) and (i) tables red; from
 *    EncounterTableEditor → (i) table editor red; from CreaturePickerModal → (i) Link picker red; from
 *    AdvancedConditionEditor → (i) custom-condition editor red.
 *
 * THE LAST FOUR A GM MEETS INSIDE HEROES HEAVEN (G7s, 2026-10-13; modalEscapeCoverage.test.ts named them):
 *  (k) a party card's Link Stat Block (MonsterSearch in pick mode) — Escape-dead in a campaign (the G7e
 *      refuter's browser round): closes, once, typed in its search box too;
 *  (l) its right-click menu (a row's Delete) over it: one press closes the menu only, the next the picker;
 *  (m) the Text Converter's help box: one press closes the help ALONE, the pasted text kept (in a campaign
 *      the press reached the host's handler for the converter under it and closed both); the next the
 *      converter; its Edit copy (a stat block's Edit) closes too;
 *  (n) the custom-condition Delete confirm: Escape cancels it, nothing deleted — and with no confirm up the
 *      Conditions page holds no press (the hook lives in the confirm's own component).
 * ANDROID'S BACK, which is no key press (the host's half: test/bug-tracker-escape-boxes.test.tsx, BACK):
 *  (o) useTrackerModalCount follows every open and close; closeTopTrackerModal closes the top modal only,
 *      and nothing under a layer drawn over all of it;
 *  (p) called on the way of a press the modal's own listener left to a layer drawn over all of it (the
 *      host's handler sits on the stack the keyboard reaches too), it closes nothing: a layer that took
 *      itself away on that press is not followed by the modal under it (the G7s refuter, 2026-10-13); a
 *      press the modal's listener never saw (dispatched on `window` itself) is no layer's, and closes the
 *      top modal as before.
 * MUTATIONS (G7s, 2026-10-13, each applied alone with Edit, run, read off that run, then restored
 * byte-exact):
 *  - MonsterSearch: `useEscapeCloses(onClose)` → a no-op ref → (k) red at "nothing reached the window",
 *    (l) at "nothing reached the window (picker)"; ContextMenu's → a no-op ref → (l) red at "the picker
 *    stays under it" (the press went to the picker, which took its menu with it).
 *  - TextConverterHelpModal: `useEscapeCloses(onClose)` → a no-op ref → (m) red at "the converter stays
 *    under it"; TextConverter's → both (m) legs red at "nothing reached the window (converter)" / "nothing
 *    reached the window".
 *  - SettingsModal: ConditionDeleteConfirm's `useEscapeCloses(onCancel)` → a no-op ref → (n) red at
 *    "nothing reached the window"; `useEscapeCloses(() => setConfirmDelete(null))` added in
 *    ConditionsSection itself (where the confirm's state lives) → (n) red at "no confirm: a plain press".
 *  - closeTopTrackerModal: `coveredAllOver(top.el())` dropped → (o) red at "under a layer: closes nothing";
 *    `openModalsChanged()` dropped from the effect's open → (o) red at "the editor: expected '0' to be '1'".
 * MUTATIONS (G7s round 2, 2026-10-13, each applied alone with Edit, run, read off that run, then restored
 * byte-exact — tracker/src/utils/spendEscape.ts):
 *  - closeTopTrackerModal: `if (layersPressOnItsWay()) return false` dropped → (p) red at "during the
 *    layer's press: closes nothing" (and the campaign's leg, test/bug-tracker-escape-boxes.test.tsx (g),
 *    at both its halves — the body popup, and with that half taken out, the layer with a text box).
 *  - onModalKey: `leftToLayer = e` dropped → the same (p) line red.
 *  - layersPressOnItsWay: `&& leftToLayer.eventPhase !== Event.NONE` dropped (that press never over) → (o)
 *    red at "Back closed one", (p) at "a press the modal's listener never saw: the host closes the tables".
 *  - the first round's wider rule (closeTopTrackerModal refusing during ANY Escape on its way: every
 *    Escape recorded in onModalPress) → (p) red at "a press the modal's listener never saw: the host
 *    closes the tables", and test/gm-search-popup.test.tsx at "the first Escape closed the overlay the GM
 *    sees" (its Escape is dispatched on `window`).
 *  - onModalPress: `if (!top || coveredAllOver(top.el())) return` → `if (!top) return` → (q) red at
 *    "held, repeat 1: on to the layer on top".
 *
 * Every name here is synthetic.
 */

const bestiary = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('../data/dataStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/dataStore')>()),
  // The pickers' bestiary search: whatever the leg sets (nothing by default), nothing fetched.
  searchCreatures: async () => bestiary.rows,
  loadCustomCreatures: () => [],
}))

/** Every key that reached `window` while `fn` ran — where Heroes Heaven's dismiss stack listens. */
function heardAtWindow(fn: () => void): string[] {
  const heard: string[] = []
  const onWin = (e: KeyboardEvent) => heard.push(e.key)
  window.addEventListener('keydown', onWin)
  try { fn() } finally { window.removeEventListener('keydown', onWin) }
  return heard
}
const escapeOn = (el: Element) => heardAtWindow(() => fireEvent.keyDown(el, { key: 'Escape' }))
/** The key held down: the browser's auto-repeat, a keydown with `repeat` set. */
const heldOn = (el: Element) => heardAtWindow(() => fireEvent.keyDown(el, { key: 'Escape', repeat: true }))
const letGoOf = (el: Element) => fireEvent.keyUp(el, { key: 'Escape' })

/** A modal as its opener holds it: open until its own close runs. */
function Opened({ modal }: { modal: (close: () => void) => ReactElement }) {
  const [open, setOpen] = useState(true)
  return open ? modal(() => setOpen(false)) : null
}

/** Search (Ctrl+K) over whatever is open — inside Heroes Heaven, searching the host's records. */
function openSearch(): void {
  const records = [{ bucket: 'feats', id: 'gleam-step', name: 'Gleam Step' }]
  render(<HostSearchProvider value={{ records, open: () => undefined }}><Opened modal={close => <GlobalSearch onClose={close} />} /></HostSearchProvider>)
  // The focus off its box — a click on the box's padding drops it to <body> — so the press reaches
  // `document`, where the search's own listener and the modals' both wait.
  ;(document.activeElement as HTMLElement | null)?.blur()
}
/** The search's full-screen backdrop (`position: fixed`, z 9500), or null once it has closed. */
function searchLayer(): HTMLElement | null {
  let el: HTMLElement | null = screen.queryByTitle('Close (Esc)')
  while (el && el.style.position !== 'fixed') el = el.parentElement
  return el
}

/*
 * The browser's hit test, which jsdom has not got: `topAt(x, y)` answers what the browser finds drawn on
 * top at that point (document.elementFromPoint), and every `.modal-box` gets a size — 400 × 300 at
 * (100, 100) — so there are points to ask about. Undone after each leg.
 */
const BOX = { x: 100, y: 100, left: 100, top: 100, width: 400, height: 300, right: 500, bottom: 400 }
const MIDDLE = { x: 300, y: 250 }
const undo: (() => void)[] = []
function hitTest(topAt: (x: number, y: number) => Element | null, box: typeof BOX = BOX): void {
  const doc = document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null }
  doc.elementFromPoint = topAt
  const realRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.classList.contains('modal-box') ? ({ ...box, toJSON: () => box } as DOMRect) : realRect.call(this)
  }
  undo.push(() => {
    delete doc.elementFromPoint
    Element.prototype.getBoundingClientRect = realRect
  })
}
/** The box of the modal opened last (a nested one — the Link picker — comes after its parent's). */
const topBox = (): Element => [...document.querySelectorAll('.modal-box')].pop()!

/*
 * A full-screen layer drawn over everything, opened after the modal, with an Escape of its own on
 * `document` the way Search's is — a stand-in for any layer above a modal (a search, a confirm).
 */
function coverWith(): HTMLElement {
  const layer = document.createElement('div')
  layer.style.position = 'fixed'
  layer.style.zIndex = '99999'
  document.body.appendChild(layer)
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    layer.remove()
    document.removeEventListener('keydown', onKey)
  }
  document.addEventListener('keydown', onKey)
  undo.push(() => { layer.remove(); document.removeEventListener('keydown', onKey) })
  return layer
}

beforeEach(() => {
  localStorage.clear()
  bestiary.rows = []
  useEncounterTablesStore.setState({ tables: [] })
  useCustomConditionsStore.setState({ conditions: [] })
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
  // MonsterSearch's infinite scroll watches a sentinel; jsdom has no IntersectionObserver.
  if (!('IntersectionObserver' in globalThis)) {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
})
afterEach(() => {
  cleanup()
  while (undo.length) undo.pop()!()
  // A leg that ends on a press the page never saw let go of leaves no hold behind for the next.
  fireEvent.keyUp(document.body, { key: 'Escape' })
  useEncounterTablesStore.setState({ tables: [] })
  useCustomConditionsStore.setState({ conditions: [] })
})

describe('Escape closes the tracker modal on top and goes no further', () => {
  it('(a) the Encounter Building tables close; nothing reaches the window', () => {
    render(<Opened modal={close => <EncounterTablesModal current="moderate" onClose={close} />} />)
    const tables = () => screen.queryByText('Encounter Building')
    expect(tables(), 'fixture: the tables are open').not.toBeNull()
    // Any other key is not the modal's: it goes on as before.
    expect(heardAtWindow(() => fireEvent.keyDown(document.body, { key: 'x' })), 'a plain key passes').toEqual(['x'])

    expect(escapeOn(document.body), 'nothing reached the window').toEqual([])
    expect(tables(), 'the tables closed').toBeNull()
    // Nothing open: Escape is a plain press again.
    expect(escapeOn(document.body)).toEqual(['Escape'])
  })

  it('(b) the advanced condition editor closes — typed in its Name box too — and saves nothing', () => {
    const saved = vi.fn()
    render(<Opened modal={close => <AdvancedConditionEditor title="New Custom Condition" onSave={saved} onClose={close} />} />)
    const editor = () => screen.queryByText('New Custom Condition')
    const name = screen.getByPlaceholderText('e.g. Cursed, Burning, Blessed')
    fireEvent.change(name, { target: { value: 'Synthetic Gloom' } })

    expect(escapeOn(name), 'nothing reached the window').toEqual([])
    expect(editor(), 'the editor closed').toBeNull()
    expect(saved, 'Escape cancels: nothing saved').not.toHaveBeenCalled()
    expect(escapeOn(document.body)).toEqual(['Escape'])
  })

  it('(c) the table editor with its Link picker over it: one press closes the picker, the next the editor', () => {
    render(<Opened modal={close => <EncounterTableEditor onClose={close} />} />)
    const editor = () => screen.queryByText('New encounter table')
    const picker = () => screen.queryByText('Link monster stat block')
    // Monsters → Add row → Link: the picker opens over the editor.
    fireEvent.click(screen.getAllByText('Add row')[0])
    fireEvent.click(screen.getByText('Link'))
    expect(picker(), 'fixture: the picker is open').not.toBeNull()
    expect(editor(), 'fixture: over the editor').not.toBeNull()

    // Typed in the picker's search box, where it opens.
    expect(escapeOn(screen.getByPlaceholderText('Search by name…')), 'nothing reached the window (picker)').toEqual([])
    expect(picker(), 'Escape closed the picker').toBeNull()
    expect(editor(), 'the editor stays under it').not.toBeNull()

    expect(escapeOn(document.body), 'nothing reached the window (editor)').toEqual([])
    expect(editor(), 'the next press closes the editor').toBeNull()
    expect(useEncounterTablesStore.getState().tables, 'Escape cancels: no table saved').toEqual([])
    expect(escapeOn(document.body)).toEqual(['Escape'])
  })
})

describe('a held Escape closes one layer, never the next', () => {
  it('(d) from the Link picker: the picker closes, the repeats never reach the editor', () => {
    render(<Opened modal={close => <EncounterTableEditor onClose={close} />} />)
    const editor = () => screen.queryByText('New encounter table')
    const picker = () => screen.queryByText('Link monster stat block')
    fireEvent.click(screen.getAllByText('Add row')[0])
    fireEvent.click(screen.getByText('Link'))
    expect(picker(), 'fixture: the picker is open over the editor').not.toBeNull()

    expect(escapeOn(screen.getByPlaceholderText('Search by name…')), 'nothing reached the window (picker)').toEqual([])
    expect(picker(), 'the press closed the picker').toBeNull()
    // Still held: the browser repeats the key, now on the page (the picker's box is gone).
    for (let i = 0; i < 3; i++) expect(heldOn(document.body), `repeat ${i + 1}: nothing reached the window`).toEqual([])
    expect(editor(), 'held down, the editor stays — its table with it').not.toBeNull()

    // Pressed afresh — the key let go where the page could not see it (no keyup): a press like any other.
    expect(escapeOn(document.body), 'nothing reached the window (editor)').toEqual([])
    expect(editor(), "pressed afresh, the press is the editor's").toBeNull()
    expect(useEncounterTablesStore.getState().tables, 'nothing saved').toEqual([])
    // …and that press, held down in its turn, is held like the first: it took the hold over.
    expect(heldOn(document.body), "the fresh press's repeat: nothing reached the window").toEqual([])
    letGoOf(document.body)
    expect(escapeOn(document.body)).toEqual(['Escape'])
  })

  it('(e) after the last modal closed: its repeats reach nothing until the key is let go', () => {
    render(<Opened modal={close => <EncounterTablesModal current="moderate" onClose={close} />} />)
    expect(escapeOn(document.body), 'nothing reached the window').toEqual([])
    expect(screen.queryByText('Encounter Building'), 'the tables closed').toBeNull()
    // Inside a campaign the window hidden behind the tables — or the campaign itself — is next in line.
    for (let i = 0; i < 3; i++) expect(heldOn(document.body), `repeat ${i + 1} — held: the window never hears it`).toEqual([])

    letGoOf(document.body)
    // A stray repeat after the keyup (none comes from a real key; it shows the hold is gone, not leaked).
    expect(heldOn(document.body), 'let go: the hold is over').toEqual(['Escape'])
    expect(escapeOn(document.body), 'nothing open: a plain press').toEqual(['Escape'])
  })

  it('(f) a repeat of a press that a box in the modal kept for itself closes nothing', () => {
    render(<Opened modal={close => <EncounterTablesModal current="moderate" onClose={close} />} />)
    const tables = () => screen.queryByText('Encounter Building')
    // A box that leaves on Escape and spends it (as escapeLeavesBox does), inside the modal.
    const box = document.createElement('input')
    box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); box.blur() } })
    document.querySelector('.modal-overlay')!.appendChild(box)
    box.focus()

    expect(escapeOn(box), 'the box spent it').toEqual([])
    expect(tables(), 'the box kept the press: the tables stay').not.toBeNull()
    expect(document.activeElement, 'fixture: the box left').not.toBe(box)
    // Still held: the repeats land on the page now, the box gone from focus.
    expect(heldOn(document.body), 'nothing reached the window (repeat)').toEqual([])
    expect(tables(), 'a repeat closes nothing').not.toBeNull()

    letGoOf(document.body)
    expect(escapeOn(document.body), 'nothing reached the window (press)').toEqual([])
    expect(tables(), 'a fresh press closes the tables').toBeNull()
    letGoOf(document.body)
    expect(escapeOn(document.body)).toEqual(['Escape'])
  })
})

describe('Escape is the layer drawn on top’s — a search over a modal, a modal over a search', () => {
  it('(g) Search opened over the Encounter Building tables: the press closes the SEARCH, the tables stay', () => {
    render(<Opened modal={close => <EncounterTablesModal current="moderate" onClose={close} />} />)
    const tables = () => screen.queryByText('Encounter Building')
    const tablesBox = topBox()
    openSearch()
    expect(searchLayer(), 'fixture: the search is open over the tables').not.toBeNull()
    expect(document.activeElement, 'fixture: the focus is on the page').toBe(document.body)
    // The browser draws the search (z 9500, the whole screen) over the tables (z 2000).
    hitTest(() => searchLayer() ?? tablesBox)

    expect(escapeOn(document.body), 'nothing reached the window').toEqual([])
    expect(searchLayer(), 'Escape closed the search').toBeNull()
    expect(tables(), 'the tables under it stay').not.toBeNull()
    // Still held. The press was the search's, so it started no hold: its repeats reach the tables' own
    // listener, which spends a repeat and closes nothing.
    for (let i = 0; i < 2; i++) expect(heldOn(document.body), `the search's repeat ${i + 1}: nothing reached the window`).toEqual([])
    expect(tables(), "the search's repeats close nothing").not.toBeNull()

    letGoOf(document.body)
    expect(escapeOn(document.body), 'nothing reached the window (tables)').toEqual([])
    expect(tables(), 'the next press closes the tables').toBeNull()
    letGoOf(document.body)
    expect(escapeOn(document.body)).toEqual(['Escape'])
  })

  it('(h) the custom-condition editor drawn OVER a search opened after it: the press closes the EDITOR only', () => {
    const saved = vi.fn()
    render(<Opened modal={close => <AdvancedConditionEditor title="New Custom Condition" onSave={saved} onClose={close} />} />)
    const editor = () => screen.queryByText('New Custom Condition')
    const editorBox = topBox()
    openSearch()
    expect(searchLayer(), 'fixture: a search opened after the editor').not.toBeNull()
    // The browser draws the editor (z 10001) over the search (z 9500).
    hitTest(() => (editorBox.isConnected ? editorBox : searchLayer()))

    expect(escapeOn(document.body), 'nothing reached the window').toEqual([])
    expect(editor(), 'Escape closed the editor').toBeNull()
    expect(searchLayer(), 'the search under it never heard the press').not.toBeNull()
    expect(saved, 'nothing saved').not.toHaveBeenCalled()

    letGoOf(document.body)
    expect(escapeOn(document.body), 'nothing reached the window (search)').toEqual([])
    expect(searchLayer(), 'the next press closes the search').toBeNull()
  })

  const FOUR: [string, () => void, () => Element | null][] = [
    ['the Encounter Building tables', () => {
      render(<Opened modal={close => <EncounterTablesModal current="moderate" onClose={close} />} />)
    }, () => screen.queryByText('Encounter Building')],
    ['the encounter-table editor', () => {
      render(<Opened modal={close => <EncounterTableEditor onClose={close} />} />)
    }, () => screen.queryByText('New encounter table')],
    ['the Link picker over the table editor', () => {
      render(<Opened modal={close => <EncounterTableEditor onClose={close} />} />)
      fireEvent.click(screen.getAllByText('Add row')[0])
      fireEvent.click(screen.getByText('Link'))
    }, () => screen.queryByText('Link monster stat block')],
    ['the custom-condition editor', () => {
      render(<Opened modal={close => <AdvancedConditionEditor title="New Custom Condition" onSave={() => undefined} onClose={close} />} />)
    }, () => screen.queryByText('New Custom Condition')],
  ]
  it.each(FOUR)('(i) %s, covered all over by a layer drawn above it: the press is the layer’s, the modal stays', (_what, open, modal) => {
    open()
    expect(modal(), 'fixture: the modal is open').not.toBeNull()
    const box = topBox()
    const layer = coverWith()
    hitTest(() => (layer.isConnected ? layer : box))

    expect(escapeOn(document.body), 'nothing reached the window').toEqual([])
    expect(layer.isConnected, 'the layer on top took the press').toBe(false)
    expect(modal(), 'the modal under it stays').not.toBeNull()

    letGoOf(document.body)
    expect(escapeOn(document.body), 'nothing reached the window (modal)').toEqual([])
    expect(modal(), 'the next press closes the modal').toBeNull()
    letGoOf(document.body)
  })

  it('(j) covered only in part, or nothing found at all: the modal is on top and the press is its own', () => {
    render(<Opened modal={close => <EncounterTablesModal current="moderate" onClose={close} />} />)
    const tables = () => screen.queryByText('Encounter Building')
    const box = topBox()
    // A small layer over the box's middle only (a tooltip, a menu): the corners still show the tables.
    const small = document.createElement('div')
    document.body.appendChild(small)
    undo.push(() => small.remove())
    hitTest((x, y) => (x === MIDDLE.x && y === MIDDLE.y ? small : box))
    expect(escapeOn(document.body), 'nothing reached the window').toEqual([])
    expect(tables(), 'covered in part: Escape closed the tables').toBeNull()
    letGoOf(document.body)
    while (undo.length) undo.pop()!()

    // The hit test finds nothing anywhere (the box off the screen): no sign of anything over it.
    render(<Opened modal={close => <EncounterTablesModal current="moderate" onClose={close} />} />)
    expect(tables(), 'fixture: open again').not.toBeNull()
    hitTest(() => null)
    expect(escapeOn(document.body), 'nothing reached the window (again)').toEqual([])
    expect(tables(), 'nothing found: Escape closed the tables').toBeNull()
    letGoOf(document.body)
    while (undo.length) undo.pop()!()

    // A box with no size on the screen (not laid out): nothing to measure, even under a layer.
    render(<Opened modal={close => <EncounterTablesModal current="moderate" onClose={close} />} />)
    expect(tables(), 'fixture: open a third time').not.toBeNull()
    const over = document.createElement('div')
    document.body.appendChild(over)
    undo.push(() => over.remove())
    hitTest(() => over, { ...BOX, width: 0, height: 0, right: BOX.left, bottom: BOX.top })
    expect(escapeOn(document.body), 'nothing reached the window (third)').toEqual([])
    expect(tables(), 'no size: Escape closed the tables').toBeNull()
    letGoOf(document.body)
    expect(escapeOn(document.body)).toEqual(['Escape'])
  })

  it('(r) a modal inside a floating window that another window is drawn over: the press is that window’s — from inside its own window, the modal’s', () => {
    /*
     * A floating window (FloatingWindow's root, `[data-float-win]`, its z-index inline) is a stacking
     * context: a modal opened inside one — a stat block's Edit converter — is painted at that window's
     * z-index, overlay and all, and a window opened or raised since is painted over it. One Escape closed
     * the converter hidden under that window (the G7s refuter, 2026-10-13; the campaign's legs:
     * test/bug-tracker-escape-boxes.test.tsx (h) and BACK). Two bare windows stand in for FloatingWindow.
     * MUTATIONS (tried 2026-10-13, tracker/src/utils/spendEscape.ts, each alone):
     *  - windowUnderAnother: `return over ? win : null` → `return null` → red at "the press goes on to the
     *    window on top, unspent" (the tables took it);
     *  - notTheModals: its last line → `return true` (a press from inside the modal's own window no longer
     *    the modal's) → red at "from inside its own window: the modal's, spent".
     */
    const win = (id: string, z: number) => {
      const w = document.createElement('div')
      w.setAttribute('data-float-win', id)
      w.style.position = 'fixed'
      w.style.zIndex = String(z)
      document.body.appendChild(w)
      undo.push(() => w.remove())
      return w
    }
    const lower = win('w-synth-lower', 501)
    win('w-synth-upper', 502)
    const tables = () => screen.queryByText('Encounter Building')
    const openInLower = () =>
      render(<Opened modal={close => <EncounterTablesModal current="moderate" onClose={close} />} />, {
        container: lower.appendChild(document.createElement('div')),
      })

    openInLower()
    expect(escapeOn(document.body), 'the press goes on to the window on top, unspent').toEqual(['Escape'])
    expect(tables(), 'the tables under that window stay').not.toBeNull()
    expect(topTrackerModalUnderAWindow(), 'the host is told: under a window').toBe(true)
    let closed = true
    act(() => { closed = closeTopTrackerModal() })
    expect(closed, 'Back: closes nothing under the window').toBe(false)
    expect(tables()).not.toBeNull()

    // A box in the modal's own window, focused by Tab (a click would have raised that window).
    const box = document.createElement('input')
    lower.appendChild(box)
    box.focus()
    expect(escapeOn(box), "from inside its own window: the modal's, spent").toEqual([])
    expect(tables(), "from inside its own window: the modal's").toBeNull()
    letGoOf(document.body)

    // Its window raised over the other one: the modal is on top again.
    lower.style.zIndex = '503'
    openInLower()
    expect(topTrackerModalUnderAWindow(), 'raised: on top').toBe(false)
    expect(escapeOn(document.body), 'nothing reached the window').toEqual([])
    expect(tables(), 'raised: the press closes the tables').toBeNull()
    letGoOf(document.body)
  })

  it('(q) under a layer that STAYS drawn over all of the modal, a held Escape holds nothing: its repeats go on to that layer', () => {
    /*
     * The hold is for a press a tracker modal took. A press left to the layer on top — a Heroes Heaven
     * popup over the modal, whose Escape is the dismiss stack's on `window`; two of them stacked, the
     * next repeat being the lower one's — must keep reaching it, held down as when no tracker modal is
     * open at all (the G7s refuter, 2026-10-13: dropping the hold's coverage test left every leg green).
     */
    render(<Opened modal={close => <EncounterTablesModal current="moderate" onClose={close} />} />)
    const tables = () => screen.queryByText('Encounter Building')
    const box = topBox()
    // Drawn over all of the tables, and no listener of its own on the page.
    const layer = document.createElement('div')
    document.body.appendChild(layer)
    undo.push(() => layer.remove())
    hitTest(() => (layer.isConnected ? layer : box))

    expect(escapeOn(document.body), 'the press is the layer’s: on to the window').toEqual(['Escape'])
    expect(tables(), 'the tables under it stay').not.toBeNull()
    for (let i = 0; i < 2; i++) expect(heldOn(document.body), `held, repeat ${i + 1}: on to the layer on top`).toEqual(['Escape'])
    expect(tables(), 'the repeats close nothing of the tracker’s').not.toBeNull()

    // The layer gone, a fresh press is the tables'.
    letGoOf(document.body)
    layer.remove()
    expect(escapeOn(document.body), 'nothing reached the window (tables)').toEqual([])
    expect(tables(), 'the next press closes the tables').toBeNull()
    letGoOf(document.body)
  })
})

/** The button whose whole text is `label`, or undefined. */
const buttonNamed = (label: string) => [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === label)

describe('the last tracker modals with no Escape of their own (G7s)', () => {
  it('(k) a party card’s Link Stat Block (MonsterSearch, pick mode): Escape — typed in its search box too — closes it once and goes no further', () => {
    const closed = vi.fn()
    render(<Opened modal={close => <MonsterSearch title="Link Stat Block" onPick={() => undefined} onClose={() => { closed(); close() }} />} />)
    const picker = () => screen.queryByText('Link Stat Block')
    expect(picker(), 'fixture: the picker is open').not.toBeNull()

    expect(escapeOn(screen.getByPlaceholderText('Search by name...')), 'nothing reached the window').toEqual([])
    expect(picker(), 'Escape closed the picker').toBeNull()
    expect(closed, 'closed once').toHaveBeenCalledTimes(1)
    letGoOf(document.body)
    expect(escapeOn(document.body)).toEqual(['Escape'])
  })

  it('(l) its right-click menu over it: one press closes the MENU only, the next the picker', async () => {
    bestiary.rows = [{ name: 'Synthetic Bramblekin', level: 2, traits: ['plant'], source: 'Synthetic Bestiary', file: 'synthetic-bramblekin.json' }]
    const closed = vi.fn()
    render(<Opened modal={close => <MonsterSearch title="Link Stat Block" onPick={() => undefined} onClose={() => { closed(); close() }} />} />)
    const row = await screen.findByText('Synthetic Bramblekin')
    fireEvent.contextMenu(row, { clientX: 40, clientY: 40 })
    const menu = () => buttonNamed('Delete')
    expect(menu(), 'fixture: the row’s menu is open over the picker').toBeTruthy()

    expect(escapeOn(document.body), 'nothing reached the window (menu)').toEqual([])
    expect(menu(), 'Escape closed the menu').toBeUndefined()
    expect(screen.queryByText('Link Stat Block'), 'the picker stays under it').not.toBeNull()
    expect(closed).not.toHaveBeenCalled()

    letGoOf(document.body)
    expect(escapeOn(document.body), 'nothing reached the window (picker)').toEqual([])
    expect(screen.queryByText('Link Stat Block'), 'the next press closes the picker').toBeNull()
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('(m) the Text Converter’s help box: Escape closes the help ALONE, the pasted text stays; the next press closes the converter', () => {
    const closed = vi.fn()
    render(<Opened modal={close => <TextConverter onClose={() => { closed(); close() }} />} />)
    const converter = () => screen.queryByText('Text Converter')
    const paste = () => screen.getByPlaceholderText(/^Paste a PF2e stat block here/) as HTMLTextAreaElement
    fireEvent.change(paste(), { target: { value: 'Synthetic Mirebeast CREATURE 2' } })
    fireEvent.click(screen.getByTitle('How to use the Text Converter'))
    const help = () => screen.queryByText('Using the Text Converter')
    expect(help(), 'fixture: the help box is open over the converter').not.toBeNull()

    expect(escapeOn(document.body), 'nothing reached the window (help)').toEqual([])
    expect(help(), 'Escape closed the help box').toBeNull()
    expect(converter(), 'the converter stays under it').not.toBeNull()
    expect(paste().value, 'the pasted text with it').toBe('Synthetic Mirebeast CREATURE 2')
    expect(closed).not.toHaveBeenCalled()

    letGoOf(document.body)
    expect(escapeOn(document.body), 'nothing reached the window (converter)').toEqual([])
    expect(converter(), 'the next press closes the converter').toBeNull()
    expect(closed).toHaveBeenCalledTimes(1)
    letGoOf(document.body)
    expect(escapeOn(document.body)).toEqual(['Escape'])
  })

  it('(m) …and its Edit copy (a stat block’s Edit): Escape closes it', () => {
    const DEF: Defenses = { ac: 17, fort: 8, ref: 6, will: 4, hp: 30, immunities: [], resistances: [], weaknesses: [] }
    const mirebeast: Creature = {
      id: 'synth-mire', name: 'Synthetic Mirebeast', source: 'Test', level: 2,
      traits: ['beast'], perception: 7, senses: [], languages: [], skills: {},
      str: 3, dex: 1, con: 3, int: -4, wis: 1, cha: -2,
      items: [], speed: { walk: 20 }, attacks: [], spellcasting: [], abilities: [],
      defenses: { ...DEF }, isHazard: false, raw: {} as Creature['raw'],
    }
    render(<Opened modal={close => <TextConverter existing={mirebeast} onClose={close} />} />)
    const editor = () => screen.queryByRole('heading', { name: 'Edit Synthetic Mirebeast' })
    expect(editor(), 'fixture: the Edit converter is open').not.toBeNull()
    expect(escapeOn(document.body), 'nothing reached the window').toEqual([])
    expect(editor(), 'Escape closed it').toBeNull()
  })

  it('(n) the custom-condition Delete confirm: Escape cancels it, nothing deleted — and with no confirm up the page holds no press', () => {
    useCustomConditionsStore.setState({ conditions: [{ ...emptyCustomCondition(), id: 'cc-synth-gloom', name: 'Synthetic Gloom' }] })
    render(<ConditionsSection />)
    // No confirm open: Escape is nobody's here — in Heroes Heaven's Settings it is the page's own.
    expect(escapeOn(document.body), 'no confirm: a plain press').toEqual(['Escape'])

    fireEvent.click(buttonNamed('Delete')!)
    const confirm = () => screen.queryByText('Delete "Synthetic Gloom"?')
    expect(confirm(), 'fixture: the confirm is open').not.toBeNull()
    expect(escapeOn(document.body), 'nothing reached the window').toEqual([])
    expect(confirm(), 'Escape cancelled the confirm').toBeNull()
    expect(useCustomConditionsStore.getState().conditions.map(c => c.id), 'nothing deleted').toEqual(['cc-synth-gloom'])
    letGoOf(document.body)
    expect(escapeOn(document.body), 'closed: a plain press again').toEqual(['Escape'])
  })
})

describe('Android’s Back: the host closes the top tracker modal with no key press (G7s)', () => {
  /** What a host reads: the live count of open tracker modals. */
  function Count() {
    return <output data-testid="modal-count">{useTrackerModalCount()}</output>
  }
  /** closeTopTrackerModal, as the host's Back handler calls it (inside React's batching). */
  const back = (): boolean => {
    let closed = false
    act(() => { closed = closeTopTrackerModal() })
    return closed
  }

  it('(o) the count follows every open and close; closeTopTrackerModal closes the top one only, and nothing under a layer drawn over it', () => {
    render(<Count />)
    const count = () => screen.getByTestId('modal-count').textContent
    expect(count(), 'nothing open').toBe('0')
    expect(back(), 'nothing open: nothing closed').toBe(false)

    render(<Opened modal={close => <EncounterTableEditor onClose={close} />} />)
    const editor = () => screen.queryByText('New encounter table')
    const picker = () => screen.queryByText('Link monster stat block')
    expect(count(), 'the editor').toBe('1')
    fireEvent.click(screen.getAllByText('Add row')[0])
    fireEvent.click(screen.getByText('Link'))
    expect(count(), 'the editor and its Link picker').toBe('2')

    expect(back(), 'Back closed one').toBe(true)
    expect(picker(), 'the picker on top closed').toBeNull()
    expect(editor(), 'the editor under it stays').not.toBeNull()
    expect(count()).toBe('1')

    // A layer drawn over all of the editor (a search, a confirm): Back is that layer's.
    const box = topBox()
    const layer = coverWith()
    hitTest(() => (layer.isConnected ? layer : box))
    expect(back(), 'under a layer: closes nothing').toBe(false)
    expect(editor(), 'the editor stays').not.toBeNull()
    layer.remove()

    expect(back(), 'Back closed the editor').toBe(true)
    expect(editor()).toBeNull()
    expect(count(), 'nothing open again').toBe('0')
    expect(useEncounterTablesStore.getState().tables, 'Back cancels, as Escape does: nothing saved').toEqual([])
  })

  it('(p) on the way of a press the modal left to a layer over it, closeTopTrackerModal closes nothing — the layer that took the press goes alone', () => {
    /*
     * The host's Back handler sits on the dismiss stack the keyboard's Escape reaches too (on `window`). A
     * press gets there past an open modal only when the modal's own listener left it for a layer drawn
     * over all of the modal; a layer that closes itself on that press without spending it (the row menu's
     * way) is gone by then, and the handler closed the modal under it as well — one press, two layers (the
     * G7s refuter, 2026-10-13, in a campaign: a body popup over the Edit converter).
     * A press the modal's listener never saw — dispatched on `window` itself, as
     * test/gm-search-popup.test.tsx presses its Escape — is no layer's: the host closes the top modal with
     * it, as before (a first round that refused every Escape in flight turned that leg red).
     */
    render(<Opened modal={close => <EncounterTablesModal current="moderate" onClose={close} />} />)
    const tables = () => screen.queryByText('Encounter Building')
    const box = topBox()
    // Over all of the tables: a layer that closes itself on Escape from its own `document` listener and
    // leaves the press unspent.
    const layer = document.createElement('div')
    document.body.appendChild(layer)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') layer.remove()
    }
    document.addEventListener('keydown', onKey)
    undo.push(() => { layer.remove(); document.removeEventListener('keydown', onKey) })
    hitTest(() => (layer.isConnected ? layer : box))

    // A stand-in for the host's dismiss stack on `window`, whose top handler is the Back handler for the
    // tracker's modals.
    const answers: boolean[] = []
    const host = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answers.push(closeTopTrackerModal())
    }
    window.addEventListener('keydown', host)
    undo.push(() => window.removeEventListener('keydown', host))

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(layer.isConnected, 'fixture: the layer took the press').toBe(false)
    expect(answers, 'fixture: the press reached the host, unspent').toHaveLength(1)
    expect(answers[0], "during the layer's press: closes nothing").toBe(false)
    expect(tables(), 'the tables under the layer stay').not.toBeNull()

    // A press on `window` itself never passed the modal's own listener (on `document`): no layer's.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(answers[1], "a press the modal's listener never saw: the host closes the tables").toBe(true)
    expect(tables()).toBeNull()
    window.removeEventListener('keydown', host)

    // A dismiss with no key at all (Back), once the layer's press is over: the top modal closes. (The hit
    // test above answers for the first tables' box, gone now: undone, nothing is over the new one.)
    letGoOf(document.body)
    while (undo.length) undo.pop()!()
    render(<Opened modal={close => <EncounterTablesModal current="moderate" onClose={close} />} />)
    expect(tables(), 'fixture: open again').not.toBeNull()
    expect(back(), 'no key press: Back closes the tables').toBe(true)
    expect(tables()).toBeNull()
  })
})
