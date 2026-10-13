import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { Creature, Defenses } from '../types/pf2e'

/*
 * THE RANDOM ENCOUNTER WIDGET'S "PREVIEW" SHOWS THE ROLLED CREATURE WHERE THE GM IS LOOKING — its full
 * stat block, with "Add to initiative" (the item-7 refuters, 2026-10-13).
 *
 * Preview pinned `{ type: 'creature', ref: <name> }` to the GM screen. A pane layout reads a 'creature'
 * tab as a LIVE combatant id, and the GM screen reconciles against no combatants (`combatants={[]}`), so
 * the pin was pruned the moment it landed; GMScreen's keepBestiaryPins rescues it only while that screen
 * is up. And the widget also lives in a floating window or the combat workspace, where a pin to the GM
 * screen appeared nowhere.
 *
 *  (a) the widget ON THE GM SCREEN pins a 'bestiary' tab beside it, which the layout keeps by itself — no
 *      GMScreen (and so no rescue) is mounted here, only the GM screen's pane layout; pressed again it
 *      shows that pane, never a second identical one (the G7e refuter: each Preview split the screen
 *      again; layoutStore addPopup, G7s 2026-10-13 — its own legs: tracker/src/store/layoutStore.test.ts);
 *  (b) the widget in a FLOATING WINDOW opens the creature as a window (the full stat block) and leaves
 *      the GM screen alone; so does the widget docked in the COMBAT workspace.
 *
 * MUTATIONS (2026-10-13, tracker/src/components/RandomEncounterWidget.tsx, each applied alone, run, read
 * off that run, then restored byte-exact):
 *  - `toLayoutTab(tab, …)` → `tab` (the old 'creature' pin) → (a) red at "pinned beside the widget" (the
 *    layout pruned it: one tab left).
 *  - the GM-screen test dropped (always a window) → (a) red at "pinned beside the widget".
 *  - the window branch dropped (always the GM-screen pin) → (b) red at "a creature window opened".
 *  - `[data-layout-scope="gm"]` → `[data-layout-scope]` (any layout) → (b) red at "the combat workspace:
 *    a window too".
 *  - (G7s) tracker/src/store/layoutStore.ts addPopup: the `if (held) { … }` line dropped → (a) red at
 *    "Preview twice: still one pane for it".
 *
 * Every creature here is synthetic.
 */

const DEF: Defenses = { ac: 18, fort: 9, ref: 7, will: 5, hp: 40, immunities: [], resistances: [], weaknesses: [] }
const RAIDER: Creature = {
  id: 'synth', name: 'Synthetic Raider', source: 'Test', level: 1,
  traits: ['humanoid'], perception: 6, senses: [], languages: ['Common'], skills: {},
  str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 0,
  items: [], speed: { walk: 25 }, attacks: [], spellcasting: [], abilities: [],
  defenses: { ...DEF }, isHazard: false,
  raw: {} as Creature['raw'],
}

vi.mock('../data/dataStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/dataStore')>()),
  loadCreatureByName: async (name: string) => (name.toLowerCase() === 'synthetic raider' ? RAIDER : null),
  loadCreatureNameIndex: async () => new Map([['synthetic raider', { name: 'Synthetic Raider', level: 1, traits: [], source: 'Test', file: '' }]]),
}))

const { PaneLayout } = await import('./PaneLayout')
const { FloatingWindowLayer } = await import('./FloatingWindow')
const { GameDataProvider } = await import('../data/gameDataContext')
const { newWidgetRef } = await import('./GmWidgets')
const { useWindowStore, BASE_Z } = await import('../store/windowStore')
const { useCombatStore } = await import('../store/combatStore')
const { useGmLayoutStore, useLayoutStore } = await import('../store/layoutStore')
const { useEncounterTablesStore } = await import('../store/encounterTablesStore')
type Root = ReturnType<typeof useGmLayoutStore.getState>['root']

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}
const btn = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => (b.textContent ?? '').includes(label))
const tabsOf = (r: Root): unknown[] => (!r ? [] : r.kind === 'leaf' ? r.tabs : [...tabsOf(r.a), ...tabsOf(r.b)])
const RAIDER_PIN = { type: 'bestiary', ref: 'synthetic raider', title: 'Synthetic Raider' }

/** The GM screen's panes exactly as GMScreen draws them — re-rendered on every change of its tree, with a
 *  fresh `combatants={[]}` each time, so the layout reconciles against no combatants after every change —
 *  but WITHOUT GMScreen's keepBestiaryPins rescue. */
function GmPanes() {
  useGmLayoutStore(s => s.root)
  return <PaneLayout combatants={[]} store={useGmLayoutStore} scope="gm" />
}

/** Roll the widget's one-entry table, then press Preview. */
async function rollAndPreview(): Promise<void> {
  await settle()
  fireEvent.click(btn('Roll monster')!)
  await settle()
  fireEvent.click(btn('Preview')!)
  await settle()
}

beforeEach(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
  localStorage.clear()
  // A synthetic table with one monster, so the roll can only land on it.
  useEncounterTablesStore.setState({
    tables: [{ id: 'synth-road', name: 'Synthetic Road', dc: 17, note: '', hazards: [],
      creatures: [{ id: 'synth-entry', label: '', weight: 1, creature: { name: 'Synthetic Raider', level: 1 } }] }],
  })
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
  useCombatStore.setState({ combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null } as never)
  useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null })
  useLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null })
})
afterEach(() => {
  cleanup()
  useEncounterTablesStore.setState({ tables: [] })
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
  useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null })
  useLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null })
})

describe('the Random Encounter widget’s Preview', () => {
  it('(a) on the GM screen: pinned beside the widget as the full stat block, kept by the layout itself', async () => {
    act(() => useGmLayoutStore.getState().addPopup({ type: 'widget', ref: newWidgetRef('encounter'), title: 'Random Encounter' }))
    render(<GameDataProvider><GmPanes /></GameDataProvider>)
    await rollAndPreview()

    expect(tabsOf(useGmLayoutStore.getState().root), 'pinned beside the widget').toHaveLength(2)
    expect(tabsOf(useGmLayoutStore.getState().root), 'the pin survived the layout').toContainEqual(RAIDER_PIN)
    expect(document.querySelector('[data-pane-leaf] .stat-block'), 'its pane draws the full stat block').not.toBeNull()
    expect(btn('Add to initiative'), 'with "Add to initiative"').toBeTruthy()
    expect(useWindowStore.getState().wins, 'no window').toEqual([])

    // Preview again (and again): the creature's pane is shown, never split off a second time.
    fireEvent.click(btn('Preview')!)
    await settle()
    fireEvent.click(btn('Preview')!)
    await settle()
    expect(tabsOf(useGmLayoutStore.getState().root), 'Preview twice: still one pane for it').toEqual([
      expect.objectContaining({ type: 'widget' }), RAIDER_PIN,
    ])
    expect(document.querySelectorAll('[data-pane-leaf] .stat-block'), 'one stat block on the screen').toHaveLength(1)
  })

  it('(b) in a floating window — or docked in the combat workspace — it opens the creature as a window', async () => {
    render(<GameDataProvider><FloatingWindowLayer /></GameDataProvider>)
    act(() => useWindowStore.getState().open('widget', newWidgetRef('encounter'), 'Random Encounter'))
    await rollAndPreview()

    const creatureWins = () => useWindowStore.getState().wins.filter(w => w.tabs[0].type === 'creature')
    expect(creatureWins().map(w => w.tabs[0]), 'a creature window opened').toEqual([
      { type: 'creature', ref: 'synthetic raider', title: 'Synthetic Raider', castRank: undefined },
    ])
    const win = document.querySelector(`[data-float-win="${creatureWins()[0].id}"]`)
    expect(win?.querySelector('.stat-block'), 'the full stat block').not.toBeNull()
    expect(useGmLayoutStore.getState().root, 'the GM screen is left alone').toBeNull()
    cleanup()

    // The widget docked in the combat workspace: no GM screen on show there either.
    act(() => useWindowStore.setState({ wins: [], topZ: BASE_Z }))
    act(() => useLayoutStore.getState().addPopup({ type: 'widget', ref: newWidgetRef('encounter'), title: 'Random Encounter' }))
    render(<GameDataProvider><PaneLayout combatants={[]} /><FloatingWindowLayer /></GameDataProvider>)
    await rollAndPreview()
    expect(creatureWins().map(w => w.tabs[0].ref), 'the combat workspace: a window too').toEqual(['synthetic raider'])
    expect(useGmLayoutStore.getState().root, 'and the GM screen is left alone').toBeNull()
  })
})
