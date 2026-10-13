import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { Creature, Defenses } from '../types/pf2e'

/*
 * A creature opened as a WINDOW is the full stat block, with "Add to initiative" — item 7 of the
 * owner's online list (2026-10-01): "if i search a stat block it needs to open the full stat block (and
 * there needs to be able to put it in the initiative order)". A Search result for a creature, or a
 * click on a creature named in prose, opens `{ type: 'creature', ref: <bestiary name> }`; it used to
 * draw the compact card a hover preview draws.
 *
 *  (a) the window draws <StatBlock> (`.stat-block`, the defence boxes, every pool), not the card;
 *  (b) a hover preview (PopupPreview, not docked) still draws the compact card;
 *  (c) "Add to initiative" adds exactly ONE row per press — the creature, with its stat block and HP —
 *      says so, and brings the new row into view; the board is otherwise untouched;
 *  (d) a stat block the renderer cannot draw fails inside the window (the tracker's ErrorBoundary);
 *  (e) nothing in it looks live and does nothing: it is no row on the board, so its use trackers (an
 *      ability's "1/day", spell slots, focus points, per-spell uses) are counts, not − / + / ↺ buttons
 *      and pips whose writes the store drops, and a cooldown's dice are plain dice. The same creature
 *      as a board row still draws the live controls;
 *  (f) a creature pinned to the GM screen ("Add to GM Screen") is its full stat block with "Add to
 *      initiative" — a 'bestiary' pane tab. As a 'creature' tab the layout read the name as a combatant
 *      id and pruned it the moment it landed;
 *  (g) a creature WINDOW docked into a layout (⠿ onto the GM screen, onto a pane, or its tab dropped on a
 *      pane's tab strip) lands as a 'bestiary' tab too; a board row's window stays a creature tab;
 *  (h) THE STANDALONE TRACKER TOO (no host at all): its own Search opens a creature as this full block.
 *      Deliberate — the owner's words name no surface ("if i search a stat block it needs to open the
 *      full stat block"), and the window kind is the tracker's own, not Heroes Heaven's.
 *  (i) EVERY OTHER ROUTE onto the GM screen keeps its creature too (the item-7 refuter, round 2): the
 *      Random Encounter widget's "Preview" used to pin a 'creature' tab, pruned the moment it landed; so
 *      did the standalone app's Add-to-GM-screen pick. The widget's Preview now pins a 'bestiary' tab
 *      itself (RandomEncounterWidget, toLayoutTab; RandomEncounterWidget.test.tsx). GMScreen's
 *      keepBestiaryPins still turns any creature tab in its tree that is no board row into a bestiary pin
 *      — as it lands, and on mount for one already there (the second half of this leg).
 *
 * MUTATIONS (each applied, run, read off that run, then restored):
 *  - FloatingWindow WinItem: `full` dropped from its WinContent → (a) red (the card, no `.stat-block`).
 *  - FloatingWindow WinContent: `full ? <BestiaryStatBlock/> : <CreatureCard/>` → always BestiaryStatBlock
 *    → (b) red.
 *  - BestiaryStatBlock: `addCombatant(c)` → `addCombatant(c, { count: 2 })` → (c) red ("exactly one row").
 *  - BestiaryStatBlock: `setTimeout(revealNewRow, 0)` dropped → (c) red (the new row never scrolled into view).
 *  - BestiaryStatBlock: the ErrorBoundary unwrapped → (d) red (the throw escapes the render).
 *  - BestiaryStatBlock: `notOnBoard` dropped from its <StatBlock> → (e) red (the live controls draw).
 *  - GMScreen: the layout effect's `useGmLayoutStore.subscribe(…)` dropped → (f) red (the pin is pruned;
 *    no pane) — the widget's Preview pins a 'bestiary' tab itself now, so (i)'s first half no longer
 *    leans on it; its mount-time `keepBestiaryPins()` dropped → (i) red at "kept as a bestiary pin on
 *    mount"; keepBestiaryPins' `toLayoutTab(…)` → `t` → (f) and (i) red.
 *  - WinContent: the `type === 'bestiary'` line dropped → (f) red (the pane draws no stat block).
 *  - dockDragStore: `intoLayout(tabs)` → `tabs` at the empty-workspace drop → (g) red at "onto the empty
 *    GM screen"; at the pane drop → red at "onto a pane"; at the tab-strip merge → red at "onto a tab strip".
 *
 * Every creature here is synthetic.
 */

const DEF: Defenses = { ac: 18, fort: 9, ref: 7, will: 5, hp: 40, immunities: [], resistances: [], weaknesses: [] }
function creature(over: Partial<Creature> = {}): Creature {
  return {
    id: 'synth', name: 'Synthetic Raider', source: 'Test', level: 1,
    traits: ['humanoid'], perception: 6, senses: [], languages: ['Common'], skills: {},
    str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 0,
    items: [], speed: { walk: 25 }, attacks: [], spellcasting: [], abilities: [],
    defenses: { ...DEF, hpPools: [{ hp: 40, name: 'body' }, { hp: 12, name: 'synthetic tail' }] }, isHazard: false,
    raw: {} as Creature['raw'],
    ...over,
  }
}

const bestiary = vi.hoisted(() => ({ byName: new Map<string, unknown>() }))
vi.mock('../data/dataStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/dataStore')>()),
  loadCreatureByName: async (name: string) => bestiary.byName.get(name.toLowerCase()) ?? null,
  // The Search's creature rows (GameDataProvider's name index): one per synthetic creature.
  loadCreatureNameIndex: async () => new Map([...bestiary.byName].map(([k, c]) => {
    const cr = c as Creature
    return [k, { name: cr.name, level: cr.level, traits: [], source: 'Test', file: '' }]
  })),
}))

const { FloatingWindowLayer, PopupPreview } = await import('./FloatingWindow')
const { StatBlock } = await import('./StatBlock')
const { GMScreen } = await import('./GMScreen')
const { GlobalSearch } = await import('./GlobalSearch')
const { GameDataProvider } = await import('../data/gameDataContext')
const { useWindowStore, BASE_Z } = await import('../store/windowStore')
const { useCombatStore } = await import('../store/combatStore')
const { useGmLayoutStore, useLayoutStore } = await import('../store/layoutStore')
const { beginDockDrag, beginBrowserDrag } = await import('../store/dockDragStore')
const { useEncounterTablesStore } = await import('../store/encounterTablesStore')
const { newWidgetRef } = await import('./GmWidgets')

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}
const win = () => document.querySelector<HTMLElement>('[data-float-win]')
const addBtn = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => (b.textContent ?? '').trim() === 'Add to initiative')

beforeEach(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
  localStorage.clear()
  bestiary.byName.clear()
  bestiary.byName.set('synthetic raider', creature())
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
  useCombatStore.setState({ combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null } as never)
  useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null })
  useLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null })
})
afterEach(() => {
  cleanup()
  useWindowStore.setState({ wins: [], topZ: BASE_Z })
  useCombatStore.setState({ combatants: [] } as never)
  useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null })
  useLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null })
})

describe('a bestiary creature in a window', () => {
  it('(a) is the full stat block, not the compact card', async () => {
    render(<FloatingWindowLayer />)
    act(() => useWindowStore.getState().open('creature', 'synthetic raider', 'Synthetic Raider'))
    await settle()
    const w = win()!
    expect(w, 'the window').not.toBeNull()
    expect(w.querySelector('.stat-block'), 'the full stat block').not.toBeNull()
    // The stat block's own defence boxes, and the second HP pool the card never listed.
    expect(w.querySelector('.def-box')).not.toBeNull()
    expect(w.textContent).toContain('synthetic tail')
    expect(addBtn(), 'the add button').toBeTruthy()
  })

  it('(b) a hover preview keeps the compact card', async () => {
    render(<PopupPreview type="creature" ref_="synthetic raider" title="Synthetic Raider" />)
    await settle()
    expect(document.querySelector('.stat-block')).toBeNull()
    expect(document.body.textContent).toContain('Creature 1')
    expect(addBtn()).toBeUndefined()
  })

  it('(c) "Add to initiative" adds exactly one row per press', async () => {
    useCombatStore.getState().addCombatant(null, { name: 'Wren Ashdown', isPC: true, maxHP: 30 })
    // Stand-ins for the initiative list's rows (the list draws the board in store order, the new row last).
    const listRows = ['Wren Ashdown', 'Synthetic Raider'].map((n) => {
      const el = document.createElement('div')
      el.className = 'init-row'
      el.textContent = n
      el.scrollIntoView = vi.fn()
      document.body.appendChild(el)
      return el
    })
    render(<FloatingWindowLayer />)
    act(() => useWindowStore.getState().open('creature', 'synthetic raider', 'Synthetic Raider'))
    await settle()
    fireEvent.click(addBtn()!)
    await settle()
    // The new row is brought into view in the initiative order.
    expect(listRows[1].scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(listRows[0].scrollIntoView).not.toHaveBeenCalled()
    listRows.forEach((el) => el.remove())
    let rows = useCombatStore.getState().combatants
    expect(rows.map(r => r.name), 'exactly one row').toEqual(['Wren Ashdown', 'Synthetic Raider'])
    expect(rows[1].creature?.name).toBe('Synthetic Raider')
    expect(rows[1].maxHP).toBe(40)
    expect(rows[1].isPC).toBe(false)
    expect(win()!.querySelector('[role="status"]')?.textContent).toContain('Synthetic Raider is in the initiative order')
    fireEvent.click(addBtn()!)
    rows = useCombatStore.getState().combatants
    expect(rows.map(r => r.name)).toEqual(['Wren Ashdown', 'Synthetic Raider', 'Synthetic Raider'])
    // The window is still open, still the stat block: adding does not close it.
    expect(win()!.querySelector('.stat-block')).not.toBeNull()
    await settle()
  })

  it('(d) a stat block that throws fails inside the window, not around it', async () => {
    // A record the renderer chokes on (a homebrew JSON can hold anything): no defenses at all.
    bestiary.byName.set('synthetic raider', { ...creature(), defenses: undefined } as unknown as Creature)
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // React (dev) re-throws a caught render error through a window 'error' event; jsdom prints it unless
    // it is handled. The boundary catching it is what this leg checks, so it is handled here.
    const swallow = (e: ErrorEvent) => e.preventDefault()
    window.addEventListener('error', swallow)
    try {
      render(<FloatingWindowLayer />)
      act(() => useWindowStore.getState().open('creature', 'synthetic raider', 'Synthetic Raider'))
      await settle()
      expect(win(), 'the window itself survived').not.toBeNull()
      expect(win()!.textContent).toContain('Something went wrong in this stat block')
    } finally {
      window.removeEventListener('error', swallow)
      quiet.mockRestore()
    }
  })

  it('(e) nothing in it looks live and does nothing: its use trackers are counts', async () => {
    // A synthetic caster with every kind of tracker the stat block draws.
    const caster = creature({
      abilities: [{ name: 'Synthetic Howl', traits: [], entries: "Frequency once per day; Effect The raider howls. It can't howl again for 1d4 rounds." }],
      spellcasting: [
        { name: 'Arcane Spontaneous Spells', type: 'Spontaneous', DC: 18, spells: '', spellsByLevel: [{ label: '1st', level: 1, slots: 3, spells: [{ name: 'synthetic spark' }] }] },
        { name: 'Occult Focus Spells', type: 'Focus', DC: 18, focusPoints: 2, spells: '', spellsByLevel: [{ label: '1st', level: 1, spells: [{ name: 'synthetic hush' }] }] },
        { name: 'Divine Innate Spells', type: 'Innate', DC: 18, spells: '', spellsByLevel: [{ label: '2nd', level: 2, spells: [{ name: 'synthetic mend', uses: 2 }] }] },
      ],
    })
    bestiary.byName.set('synthetic raider', caster)
    render(<FloatingWindowLayer />)
    act(() => useWindowStore.getState().open('creature', 'synthetic raider', 'Synthetic Raider'))
    await settle()
    const w = win()!
    expect(w.textContent, 'the ability is drawn').toContain('Synthetic Howl')
    // The limit, as text.
    expect(w.querySelector('[data-uses-limit]')?.textContent).toBe('1/day')
    expect(w.querySelectorAll('button[title="Spend one use"], button[title="Refund one use"], button[title="Reset to full"]'), 'no − / + / ↺').toHaveLength(0)
    // The slots, focus points and per-spell uses, as counts: 3 + 2 + 2 pips, none of them a control.
    expect(w.querySelectorAll('[data-count-pips] .spell-pip')).toHaveLength(7)
    expect(w.querySelectorAll('.spell-pip[role="button"], .spell-pip[title="Spend"]'), 'no pip to click').toHaveLength(0)
    expect([...w.querySelectorAll('button')].some(b => (b.textContent ?? '').includes('Reset uses')), 'no Reset uses').toBe(false)
    // The cooldown's dice roll as plain dice — no promise of a condition that could never appear.
    const dice = [...w.querySelectorAll<HTMLElement>('[title^="Click to roll 1d4"]')]
    expect(dice.length, 'the cooldown dice are drawn').toBeGreaterThan(0)
    expect(dice.some(d => d.title.includes('cooldown'))).toBe(false)

    // Not vacuous: the same creature as a ROW on the board draws every live control.
    cleanup()
    act(() => useCombatStore.getState().addCombatant(caster as Creature))
    const row = useCombatStore.getState().combatants[0]
    render(<StatBlock combatant={row} />)
    expect(document.querySelector('button[title="Spend one use"]'), 'a row: the uses chip').not.toBeNull()
    expect(document.querySelectorAll('.spell-pip[role="button"]').length, 'a row: live pips').toBe(7)
    expect(document.querySelector('[title*="will apply a cooldown condition"]'), 'a row: the cooldown dice').not.toBeNull()
  })

  it('(f) pinned to the GM screen, a creature is its full stat block with "Add to initiative"', async () => {
    render(<GameDataProvider><GMScreen /></GameDataProvider>)
    await settle()
    fireEvent.click([...document.querySelectorAll('button')].find(b => (b.textContent ?? '').includes('Add Reference'))!)
    const input = document.querySelector<HTMLInputElement>('input')!
    for (let i = 0; i < 10 && input.disabled; i++) await settle()
    fireEvent.change(input, { target: { value: 'Synthetic Raider' } })
    for (let i = 0; i < 10 && !document.querySelector('[data-row]'); i++) await settle()
    fireEvent.click(document.querySelector('[data-row="0"]')!)
    await settle()
    const root = useGmLayoutStore.getState().root
    expect(root?.kind === 'leaf' ? root.tabs : null, 'the pin survived the layout').toEqual([{ type: 'bestiary', ref: 'synthetic raider', title: 'Synthetic Raider' }])
    expect(document.querySelector('[data-pane-leaf] .stat-block'), 'the pane draws the full stat block').not.toBeNull()
    fireEvent.click(addBtn()!)
    expect(useCombatStore.getState().combatants.map(r => r.name), 'one row').toEqual(['Synthetic Raider'])
    await settle()
  })

  it('(g) a creature window docked into a layout lands as a bestiary tab; a board row stays a creature', async () => {
    const tab = { type: 'creature' as const, ref: 'synthetic raider', title: 'Synthetic Raider' }
    const realFrom = document.elementFromPoint
    const realFromAll = document.elementsFromPoint
    const target = document.createElement('div')
    document.body.appendChild(target)
    const drop = (startDrag: () => void) => {
      startDrag()
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 60 }))
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 60, clientY: 60 }))
    }
    const openWin = (t: typeof tab) => {
      act(() => useWindowStore.getState().open(t.type, t.ref, t.title))
      return useWindowStore.getState().wins.at(-1)!
    }
    const leafTabs = (r: ReturnType<typeof useGmLayoutStore.getState>['root']): unknown[] =>
      !r ? [] : r.kind === 'leaf' ? r.tabs : [...leafTabs(r.a), ...leafTabs(r.b)]
    try {
      // ⠿ onto the empty GM screen.
      target.setAttribute('data-dock-empty', '')
      target.dataset.layoutScope = 'gm'
      document.elementFromPoint = () => target
      let w = openWin(tab)
      drop(() => beginDockDrag({ popup: tab, allTabs: [tab], active: 0, winId: w.id, winPos: { x: w.x, y: w.y } }, 0, 0))
      expect(leafTabs(useGmLayoutStore.getState().root), 'onto the empty GM screen').toEqual([{ ...tab, type: 'bestiary' }])
      expect(useWindowStore.getState().wins, 'the window went into the layout').toEqual([])

      // ⠿ onto a pane of the GM screen.
      act(() => useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null }))
      act(() => useGmLayoutStore.getState().addPopup({ type: 'condition', ref: 'synthetic glare', title: 'Synthetic Glare' }))
      const leafId = useGmLayoutStore.getState().root!.id
      target.removeAttribute('data-dock-empty')
      target.setAttribute('data-pane-leaf', leafId)
      w = openWin(tab)
      drop(() => beginDockDrag({ popup: tab, allTabs: [tab], active: 0, winId: w.id, winPos: { x: w.x, y: w.y } }, 0, 0))
      expect(leafTabs(useGmLayoutStore.getState().root), 'onto a pane').toEqual([{ type: 'condition', ref: 'synthetic glare', title: 'Synthetic Glare' }, { ...tab, type: 'bestiary' }])

      // Its tab dropped on a pane's tab strip (a browser-style drag of the window).
      act(() => useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null }))
      act(() => useGmLayoutStore.getState().addPopup({ type: 'condition', ref: 'synthetic glare', title: 'Synthetic Glare' }))
      const stripLeaf = useGmLayoutStore.getState().root!.id
      const strip = document.createElement('div')
      strip.setAttribute('data-tab-leaf', stripLeaf)
      strip.dataset.layoutScope = 'gm'
      document.body.appendChild(strip)
      document.elementsFromPoint = () => [strip]
      w = openWin(tab)
      drop(() => beginBrowserDrag(() => ({ winId: w.id, startWX: w.x, startWY: w.y }), 0, 0, 'tabstrip'))
      expect(leafTabs(useGmLayoutStore.getState().root), 'onto a tab strip').toEqual([{ type: 'condition', ref: 'synthetic glare', title: 'Synthetic Glare' }, { ...tab, type: 'bestiary' }])
      strip.remove()

      // A board row's window keeps its creature tab: it IS that combatant.
      act(() => useCombatStore.getState().addCombatant(creature()))
      const id = useCombatStore.getState().combatants[0].id
      target.removeAttribute('data-pane-leaf')
      target.setAttribute('data-dock-empty', '')
      target.dataset.layoutScope = 'combat'
      const live = { type: 'creature' as const, ref: id, title: 'Synthetic Raider' }
      w = openWin(live)
      drop(() => beginDockDrag({ popup: live, allTabs: [live], active: 0, winId: w.id, winPos: { x: w.x, y: w.y } }, 0, 0))
      const combat = useLayoutStore.getState().root
      expect(combat?.kind === 'leaf' ? combat.tabs : null).toEqual([live])
    } finally {
      document.elementFromPoint = realFrom
      document.elementsFromPoint = realFromAll
      target.remove()
    }
  })

  it('(i) every other route that pins a creature to the GM screen keeps it: the Random Encounter "Preview", and a tab already in the layout', async () => {
    // A synthetic table with one creature, so the roll can only land on it.
    useEncounterTablesStore.setState({
      tables: [{ id: 'synth-road', name: 'Synthetic Road', dc: 17, note: '', hazards: [],
        creatures: [{ id: 'synth-entry', label: '', weight: 1, creature: { name: 'Synthetic Raider', level: 1 } }] }],
    })
    act(() => useGmLayoutStore.getState().addPopup({ type: 'widget', ref: newWidgetRef('encounter'), title: 'Random Encounter' }))
    const view = render(<GameDataProvider><GMScreen /></GameDataProvider>)
    await settle()
    const btn = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => (b.textContent ?? '').includes(label))!
    fireEvent.click(btn('Roll monster'))
    await settle()
    fireEvent.click(btn('Preview'))
    await settle()
    const tabs = (r: ReturnType<typeof useGmLayoutStore.getState>['root']): unknown[] =>
      !r ? [] : r.kind === 'leaf' ? r.tabs : [...tabs(r.a), ...tabs(r.b)]
    expect(tabs(useGmLayoutStore.getState().root), 'the previewed creature survived the layout').toContainEqual({ type: 'bestiary', ref: 'synthetic raider', title: 'Synthetic Raider' })
    expect(document.querySelector('[data-pane-leaf] .stat-block'), 'its pane draws the full stat block').not.toBeNull()
    expect(addBtn(), 'with "Add to initiative"').toBeTruthy()
    view.unmount()

    // A creature tab already in the GM screen's tree when the screen comes up (one the standalone app's
    // Add-to-GM-screen put there, or a widget's Preview while another view was showing) is kept too.
    act(() => useGmLayoutStore.setState({ root: null, hoveredLeaf: null, hoveredCid: null }))
    act(() => useGmLayoutStore.getState().addPopup({ type: 'creature', ref: 'synthetic raider', title: 'Synthetic Raider' }))
    render(<GameDataProvider><GMScreen /></GameDataProvider>)
    await settle()
    expect(tabs(useGmLayoutStore.getState().root), 'kept as a bestiary pin on mount').toEqual([{ type: 'bestiary', ref: 'synthetic raider', title: 'Synthetic Raider' }])
    expect(document.querySelector('[data-pane-leaf] .stat-block')).not.toBeNull()
  })

  it('(h) the standalone tracker (no host): a creature from its own Search opens the full block too', async () => {
    render(<GameDataProvider><GlobalSearch onClose={() => undefined} /><FloatingWindowLayer /></GameDataProvider>)
    await settle()
    const input = document.querySelector<HTMLInputElement>('input')!
    for (let i = 0; i < 10 && input.disabled; i++) await settle()
    fireEvent.change(input, { target: { value: 'Synthetic Raider' } })
    for (let i = 0; i < 10 && !document.querySelector('[data-row]'); i++) await settle()
    fireEvent.click(document.querySelector('[data-row="0"]')!)
    await settle()
    expect(useWindowStore.getState().wins.map(x => x.tabs[0]), 'a creature window').toEqual([{ type: 'creature', ref: 'synthetic raider', title: 'Synthetic Raider', castRank: undefined }])
    expect(win()!.querySelector('.stat-block'), 'the full stat block').not.toBeNull()
    expect(addBtn(), 'with "Add to initiative"').toBeTruthy()
  })
})
