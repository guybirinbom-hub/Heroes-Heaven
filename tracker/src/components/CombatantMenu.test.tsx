import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CombatantDetail } from './CombatantDetail'
import { InitiativeTracker } from './InitiativeTracker'
import { PartyView } from './PartyView'
import { useCombatStore, downsAsPC } from '../store/combatStore'
import { usePartyStore, addPartyMemberToOrder } from '../store/partyStore'
import type { Creature, Defenses } from '../types/pf2e'

/*
 * Owner's list 2026-10-01, item 2: "Right-click on a stat block → treat like a player when at 0 HP."
 *
 * The open stat block (CombatantDetail — a workspace pane or a floating window) had NO right-click: inside
 * Heroes Heaven the app swallows every right-click outside a text field, so it did nothing at all. It now
 * opens the combatant menu — the SAME menu as the initiative row's right-click (InitiativeTracker's
 * CombatantMenu, a BodyPortal) — and its ☰ menu opens it too, for a touch screen with no right-click.
 * The header says how a creature that goes down like a player is: DYING n, or DEAD, not DEFEATED.
 *
 * Every creature here is synthetic. Each leg names the change it guards and fails without it.
 */

const DEF: Defenses = { ac: 18, fort: 9, ref: 7, will: 5, hp: 40, immunities: [], resistances: [], weaknesses: [] }
const RAIDER: Creature = {
  id: 'synth-menu', name: 'Synthetic Brigand', source: 'Test', level: 2,
  traits: ['humanoid'], perception: 6, senses: [], languages: ['Common'], skills: {},
  str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 0,
  items: [], speed: { walk: 25 }, attacks: [], spellcasting: [], abilities: [],
  defenses: { ...DEF }, isHazard: false,
  raw: {} as Creature['raw'],
}

const st = () => useCombatStore.getState()
const row = () => st().combatants[0]
/** The stat block as a pane draws it: always the store's CURRENT combatant. */
function Live() {
  const c = useCombatStore(s => s.combatants[0])
  return c ? <CombatantDetail combatant={c} /> : null
}
/** The open combatant menu: a direct child of <body>, exactly `.tracker-root` (BodyPortal). */
const menu = () => document.querySelector<HTMLElement>('body > .tracker-root')

beforeEach(() => {
  localStorage.clear()
  // jsdom has no ResizeObserver; the stat block observes its own box to fit it.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
  useCombatStore.setState({
    combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null,
    turns: [], canUndo: false, canRedo: false, savedSignature: null,
  } as never)
  st().addCombatant(RAIDER)
})
afterEach(() => {
  cleanup()
  for (const n of [...document.body.children]) n.remove()
  localStorage.clear()
})

describe('the combatant menu on an open stat block', () => {
  it('a right-click anywhere on it opens the menu on <body>, prevented so the host leaves it alone; a text field keeps its own', () => {
    // MUTATION (CombatantDetail: drop `onContextMenu={onStatBlockContextMenu}` from the root div):
    //   FAILS — "expected true to be false" (nothing handled the right-click; inside Heroes Heaven it
    //   did nothing at all).
    render(<Live />)
    const heading = screen.getByRole('heading', { name: 'Synthetic Brigand' })
    const allowed = fireEvent.contextMenu(heading, { clientX: 40, clientY: 40 })
    expect(allowed, 'the handler called preventDefault').toBe(false)
    expect(menu()).not.toBeNull()
    expect(menu()!.className).toBe('tracker-root')
    expect(menu()!.textContent).toContain('At 0 HP: dying like a player')
    expect(menu()!.textContent).toContain('Mark defeated')
    expect(menu()!.textContent, 'the stat block has no inline rename box').not.toContain('Rename')

    // Escape closes it (its own document listener — what keeps HH's Escape from leaving the campaign).
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menu()).toBeNull()

    // The damage box is a text field: the browser's own menu (copy / paste) is left to it.
    const hpBox = screen.getByPlaceholderText('50 · -30 · t15')
    expect(fireEvent.contextMenu(hpBox)).toBe(true)
    expect(menu()).toBeNull()
  })

  it('its switch sets the creature, and the header then says DYING n / DEAD instead of DEFEATED', () => {
    // MUTATION (CombatantDetail header: `downMark ? <Chip>{downMark}</Chip> : …DEFEATED` back to the
    //   DEFEATED chip alone): FAILS — "Unable to find an element with the text: DYING 1".
    render(<Live />)
    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Synthetic Brigand' }))
    const sw = screen.getByRole('menuitemcheckbox')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    expect(menu(), 'the menu closes on a choice').toBeNull()
    expect(downsAsPC(row())).toBe(true)

    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Synthetic Brigand' }))
    fireEvent.click(screen.getByText('Knock out (0 HP)'))
    expect(screen.getByText('DYING 1')).not.toBeNull()
    expect(screen.queryByText('DEFEATED')).toBeNull()

    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Synthetic Brigand' }))
    fireEvent.click(screen.getByText('Mark dead'))
    expect(screen.getByText('DEAD')).not.toBeNull()

    // A monster that is not set to go down like a player keeps its DEFEATED.
    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Synthetic Brigand' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox'))      // switch it off again
    expect(downsAsPC(row())).toBe(false)
    expect(screen.getByText('DEFEATED')).not.toBeNull()
  })

  it('the party NPC card carries the same switch, and it reaches the NPC’s row in the fight', () => {
    // "a party NPC keeps the setting until undone" — shown and switchable on its card too.
    // MUTATION (PartyView MemberCard: drop the "At 0 HP: dying like a player" checkbox): FAILS —
    //   "Unable to find a label with the text of: At 0 HP: dying like a player".
    const hireling = { id: 'pl-brigand', name: 'Hired Brigand', notes: '', memberType: 'npc' as const, creature: RAIDER }
    usePartyStore.setState({ parties: [{ id: 'party-menu', name: 'Menu Party', level: 2, isFavorite: false, players: [hireling] }], activePartyId: null })
    useCombatStore.setState({ combatants: [] } as never)
    addPartyMemberToOrder(hireling)
    const npcRow = () => st().combatants.find(c => c.partyMemberId === 'pl-brigand')!
    expect(downsAsPC(npcRow())).toBe(false)
    render(<PartyView partyId="party-menu" />)
    const box = screen.getByLabelText('At 0 HP: dying like a player') as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(usePartyStore.getState().parties[0].players[0].downsLikePC).toBe(true)
    expect(downsAsPC(npcRow()), 'the row in the fight reads the card').toBe(true)
    expect((screen.getByLabelText('At 0 HP: dying like a player') as HTMLInputElement).checked).toBe(true)
    usePartyStore.setState({ parties: [], activePartyId: null })
  })

  it('Escape in the damage box clears it and goes no further — the host’s Escape never hears it', () => {
    // Inside Heroes Heaven a bubbled Escape reached the campaign's dismiss stack and LEFT THE CAMPAIGN
    // (the seam leg: test/bug-tracker-dying-npc.test.tsx (c)).
    // MUTATION (drop `e.stopPropagation()` from spendEscape — HPTracker's own then, tracker/src/utils/
    //   spendEscape.ts since round 2 — tried 2026-10-11): FAILS — "only the plain key reached the window:
    //   expected [ 'Escape', 'x' ] to deeply equal [ 'x' ]". The damage box's onKeyDown back to Enter only:
    //   FAILS — "expected '12' to be ''".
    render(<Live />)
    const heard: string[] = []
    const onWin = (e: KeyboardEvent) => heard.push(e.key)
    window.addEventListener('keydown', onWin)
    try {
      const box = screen.getByPlaceholderText('50 · -30 · t15') as HTMLInputElement
      fireEvent.change(box, { target: { value: '12' } })
      fireEvent.keyDown(box, { key: 'Escape' })
      expect(box.value).toBe('')
      expect(row().currentHP, 'nothing applied').toBe(40)
      fireEvent.keyDown(box, { key: 'x' })
      expect(heard, 'only the plain key reached the window').toEqual(['x'])
    } finally {
      window.removeEventListener('keydown', onWin)
    }
  })

  it('the ☰ menu opens the same menu — a touch screen has no right-click', () => {
    // MUTATION (HamburgerMenu: drop the 'Combatant actions…' row): FAILS — "Unable to find an element
    //   with the text: Combatant actions…".
    render(<Live />)
    fireEvent.click(screen.getByTitle('Options'))
    fireEvent.click(screen.getByText('Combatant actions…'))
    expect(menu()).not.toBeNull()
    expect(screen.getByRole('menuitemcheckbox').textContent).toContain('At 0 HP: dying like a player')
  })
})

/*
 * An edit box is SETTLED once. Escape cancels it, Enter commits it, and either way the box goes away —
 * and a browser fires a blur at a focused box as it goes. jsdom never does, so these legs fire that blur
 * themselves, in the SAME act as the key: React has not drawn the box away yet, exactly as in a browser.
 * Unguarded, the blur committed what Escape had just cancelled, or committed Enter's edit a second time
 * (each commit an undo step, so one Undo looked like it did nothing).
 */
describe('an edit box settles ONCE — the blur as it closes commits nothing more', () => {
  function keyThenBlur(box: HTMLElement, key: string) {
    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
  }
  const rowEl = () => document.querySelector<HTMLElement>('.init-row')!
  function openRename(): HTMLInputElement {
    fireEvent.contextMenu(rowEl())
    fireEvent.click(screen.getByText('Rename'))
    return rowEl().querySelector('input')!
  }

  it('the row’s rename box: Escape then blur renames nothing; Enter then blur renames once (one Undo takes it back)', () => {
    // MUTATION (InitiativeTracker rename box: drop `settled.current = true;` from its Escape, tried
    //   2026-10-11): FAILS — "Escape cancelled it: expected 'Brigand Who Was Renamed' to be 'Synthetic
    //   Brigand'". Drop `settled.current = true` from commitRename: FAILS — "one rename, one undo step:
    //   expected 'Brigand Renamed Once' to be 'Synthetic Brigand'".
    render(<InitiativeTracker />)
    let box = openRename()
    fireEvent.change(box, { target: { value: 'Brigand Who Was Renamed' } })
    keyThenBlur(box, 'Escape')
    expect(row().name, 'Escape cancelled it').toBe('Synthetic Brigand')

    box = openRename()
    fireEvent.change(box, { target: { value: 'Brigand Renamed Once' } })
    keyThenBlur(box, 'Enter')
    expect(row().name).toBe('Brigand Renamed Once')
    act(() => st().undo())
    expect(row().name, 'one rename, one undo step').toBe('Synthetic Brigand')
  })

  // MUTATION (InitiativeTracker initiative box: drop `settled.current = true;` from its Escape, tried
  //   2026-10-11): FAILS — "expected 3 to be 14".
  it('the row’s initiative box: Escape then blur keeps the number', () => {
    act(() => st().setInitiative(row().id, 14))
    render(<InitiativeTracker />)
    fireEvent.click(screen.getByText('14'))
    const box = rowEl().querySelector('input')!
    fireEvent.change(box, { target: { value: '3' } })
    keyThenBlur(box, 'Escape')
    expect(row().initiative).toBe(14)
  })

  // MUTATION (HPTracker max-HP box, tried 2026-10-11): drop `maxSettled.current = true;` from its Escape —
  //   (round 2: HPTracker's own spendEscape moved to tracker/src/utils/spendEscape.ts, unchanged)
  //   FAILS "Escape cancelled it: expected 55 to be 40"; from its Enter — FAILS "one edit, one undo step:
  //   expected 45 to be 40"; drop its whole spendEscape line — FAILS "Escape cancelled it: expected 55 to be 40".
  it('the stat block’s max-HP box: Escape then blur keeps the max; Enter then blur sets it once (one Undo takes it back)', () => {
    render(<Live />)
    const openMax = () => {
      fireEvent.click(screen.getByText(`/ ${row().maxHP}`))
      return document.querySelector<HTMLInputElement>('input[type="number"]')!
    }
    let box = openMax()
    fireEvent.change(box, { target: { value: '55' } })
    keyThenBlur(box, 'Escape')
    expect(row().maxHP, 'Escape cancelled it').toBe(40)

    box = openMax()
    fireEvent.change(box, { target: { value: '45' } })
    keyThenBlur(box, 'Enter')
    expect(row().maxHP).toBe(45)
    act(() => st().undo())
    expect(row().maxHP, 'one edit, one undo step').toBe(40)
  })
})

/*
 * ESCAPE IN THIS ITEM'S OTHER BOXES (the round-2 refuter, 2026-10-11). The stat block's three notes boxes,
 * its ☰ menu (and the Custom level box inside it), and the party card's name and notes boxes let Escape
 * bubble — and inside Heroes Heaven a bubbled Escape reaches the campaign's dismiss stack, which finds no
 * popup on <body> for anything drawn inside the tracker and LEAVES THE CAMPAIGN. Each now spends it
 * (tracker/src/utils/spendEscape.ts, or the ☰ menu's own document listener). The campaign-level legs are
 * test/bug-tracker-dying-npc.test.tsx (d).
 */
describe('Escape in the stat block’s and the party card’s other boxes goes no further', () => {
  /** Every key that reached `window` while `fn` ran — where Heroes Heaven's dismiss stack listens. */
  function heardAtWindow(fn: () => void): string[] {
    const heard: string[] = []
    const onWin = (e: KeyboardEvent) => heard.push(e.key)
    window.addEventListener('keydown', onWin)
    try { fn() } finally { window.removeEventListener('keydown', onWin) }
    return heard
  }
  /** Escape typed in a box: focused first, as a key only ever reaches the box the user is in. */
  const escapeIn = (box: HTMLElement) => heardAtWindow(() => {
    act(() => box.focus())
    fireEvent.keyDown(box, { key: 'Escape' })
  })
  function LiveRow({ id }: { id: string }) {
    const c = useCombatStore(s => s.combatants.find(x => x.id === id))
    return c ? <CombatantDetail combatant={c} /> : null
  }

  it('the notes boxes — a monster’s, a PC’s own, a party player’s — leave the box and go no further', () => {
    // MUTATION (CombatantDetail, tried 2026-10-11): drop `onKeyDown={escapeLeavesBox}` from the monster's
    //   notes box — FAILS "Notes about this combatant...: expected [ 'Escape' ] to deeply equal []"; from
    //   the PC's local notes box — FAILS "Local notes for this combatant…: …"; from the party player's —
    //   FAILS "Player notes…: …".
    const check = (placeholder: string) => {
      const box = screen.getByPlaceholderText(placeholder)
      expect(escapeIn(box), placeholder).toEqual([])
      expect(document.activeElement, `${placeholder} — Escape left the box`).not.toBe(box)
      cleanup()
    }
    render(<Live />)
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }))
    check('Notes about this combatant...')

    act(() => st().addCombatant(null, { name: 'Synthetic Scout', isPC: true }))
    const scout = st().combatants.find(c => c.isPC)!.id
    render(<LiveRow id={scout} />)
    check('Local notes for this combatant…')

    usePartyStore.setState({
      parties: [{ id: 'party-notes', name: 'Notes Party', level: 2, isFavorite: false,
        players: [{ id: 'pl-scout', name: 'Synthetic Scout', notes: '', memberType: 'pc' as const }] }],
      activePartyId: null,
    })
    try {
      render(<LiveRow id={scout} />)
      check('Player notes…')
    } finally {
      usePartyStore.setState({ parties: [], activePartyId: null })
    }
  })

  it('the ☰ menu: Escape closes it and goes no further — typed in its Custom level box too, which it clears', () => {
    // MUTATION (CombatantDetail HamburgerMenu, tried 2026-10-11): drop `document.addEventListener('keydown', k)`
    //   — FAILS "nothing reached the window: expected [ 'Escape' ] to deeply equal []"; drop
    //   `e.stopPropagation()` from `k` — FAILS the same; drop `setLevelInput('')` — FAILS "the half-typed
    //   level went with it: expected '7' to be ''".
    render(<Live />)
    const options = screen.getByTitle('Options')
    const scaleRow = () => screen.queryByText('Scale to')
    fireEvent.click(options)
    expect(scaleRow(), 'the ☰ menu is open').not.toBeNull()
    expect(escapeIn(options), 'nothing reached the window').toEqual([])
    expect(scaleRow(), 'the ☰ menu closed').toBeNull()

    fireEvent.click(options)
    const level = screen.getByPlaceholderText('Custom level…') as HTMLInputElement
    fireEvent.change(level, { target: { value: '7' } })
    expect(escapeIn(level), 'nothing reached the window (Custom level box)').toEqual([])
    expect(scaleRow(), 'the ☰ menu closed').toBeNull()
    expect(row().scaledToLevel, 'nothing was scaled').toBeUndefined()
    fireEvent.click(options)
    expect((screen.getByPlaceholderText('Custom level…') as HTMLInputElement).value, 'the half-typed level went with it').toBe('')

    // Not vacuous: with the menu closed, a plain Escape is not this menu's to spend.
    fireEvent.click(options)
    expect(scaleRow()).toBeNull()
    expect(heardAtWindow(() => fireEvent.keyDown(options, { key: 'Escape' }))).toEqual(['Escape'])
  })

  it('the condition picker — where Dying and Wounded are added — Escape closes the top layer and goes no further', () => {
    // MUTATION (ConditionPanel, tried 2026-10-11): drop `document.addEventListener('keydown', onKey)` —
    //   FAILS "nothing reached the window (search box): expected [ 'Escape' ] to deeply equal []"; drop
    //   `e.stopPropagation()` from onKey — FAILS the same; `if (advOpen) setAdvOpen(false)` dropped (always
    //   onClose) — FAILS "the picker stays under it: expected null not to be null".
    render(<Live />)
    const search = () => screen.queryByPlaceholderText('Search conditions…')
    fireEvent.click(screen.getByText('+ Condition'))
    expect(search(), 'the picker is open').not.toBeNull()
    expect(escapeIn(search()!), 'nothing reached the window (search box)').toEqual([])
    expect(search(), 'Escape closed the picker').toBeNull()

    fireEvent.click(screen.getByText('+ Condition'))
    fireEvent.click(screen.getByText('+ Custom'))
    fireEvent.click(screen.getByText('Advanced →'))
    const editor = () => screen.queryByText('Advanced Custom Condition')
    expect(editor(), 'the Advanced editor is open over it').not.toBeNull()
    expect(heardAtWindow(() => fireEvent.keyDown(editor()!, { key: 'Escape' })), 'nothing reached the window (editor)').toEqual([])
    expect(editor(), 'one Escape closed the editor').toBeNull()
    expect(search(), 'the picker stays under it').not.toBeNull()
    expect(escapeIn(search()!)).toEqual([])
    expect(search(), 'the next Escape closes the picker').toBeNull()
    expect(row().conditions, 'nothing was added').toEqual([])
  })

  it('the party card: Escape in the name box cancels the rename and goes no further; in the notes box it goes no further', () => {
    // MUTATION (PartyView MemberCard, tried 2026-10-11): drop the name box's `spendEscape(…)` line — FAILS
    //   "nothing reached the window (name box): expected [ 'Escape' ] to deeply equal []"; drop
    //   `nameCancelled.current = true;` — FAILS "Escape cancelled the rename: expected 'Brigand Who Was
    //   Renamed' to be 'Hired Brigand'"; drop the onFocus re-arm — FAILS "a later Enter still renames:
    //   expected 'Hired Brigand' to be 'Brigand Renamed At Last'"; drop the notes box's
    //   `onKeyDown={escapeLeavesBox}` — FAILS "nothing reached the window (notes box): …".
    const hireling = { id: 'pl-brigand', name: 'Hired Brigand', notes: '', memberType: 'npc' as const, creature: RAIDER }
    usePartyStore.setState({ parties: [{ id: 'party-esc', name: 'Escape Party', level: 2, isFavorite: false, players: [hireling] }], activePartyId: null })
    const member = () => usePartyStore.getState().parties[0].players[0]
    try {
      render(<PartyView partyId="party-esc" />)
      const name = screen.getByDisplayValue('Hired Brigand') as HTMLInputElement
      act(() => name.focus())
      fireEvent.change(name, { target: { value: 'Brigand Who Was Renamed' } })
      expect(escapeIn(name), 'nothing reached the window (name box)').toEqual([])
      expect(document.activeElement, 'Escape left the box').not.toBe(name)
      expect(member().name, 'Escape cancelled the rename').toBe('Hired Brigand')
      expect(name.value, 'the box shows the name again').toBe('Hired Brigand')

      act(() => name.focus())
      fireEvent.change(name, { target: { value: 'Brigand Renamed At Last' } })
      fireEvent.keyDown(name, { key: 'Enter' })
      expect(member().name, 'a later Enter still renames').toBe('Brigand Renamed At Last')

      const notes = screen.getByPlaceholderText('NPC notes…')
      expect(escapeIn(notes), 'nothing reached the window (notes box)').toEqual([])
      expect(document.activeElement, 'Escape left the notes box').not.toBe(notes)
    } finally {
      usePartyStore.setState({ parties: [], activePartyId: null })
    }
  })
})
