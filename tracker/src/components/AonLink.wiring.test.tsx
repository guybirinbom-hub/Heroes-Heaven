import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { Combatant, Creature, Defenses } from '../types/pf2e'
import type { EquipmentInfo } from '../data/dataStore'
import { useSettingsStore } from '../store/settingsStore'

/*
 * The Archives of Nethys button where the tracker draws its popups (the owner, 2026-10-21: "a link to
 * Archives of Nethys on every pop up a user opens"). AonLink.test.tsx pins the button itself; this pins
 * the places that draw it:
 *  (a) a creature in the initiative order (CombatantDetail — its floating window and its docked pane
 *      both draw it): the button its bestiary page had, from the creature's `aonUrl`; none without one;
 *      none with the setting off;
 *  (b) an item in a docked pane holding several tabs (PopupPreview `hideHeader`, no header to hold the
 *      button): a strip of its own above the page; an item in a pane of one tab keeps it in its header;
 *      the setting off draws no strip at all.
 *
 * MUTATIONS (each applied, run, read off that run, then restored):
 *  - CombatantDetail: `<AonLinkButton url={aonUrl} />` dropped → (a) red.
 *  - PopupPreview: the `data-aon-bar` strip dropped → (b) red.
 *
 * Every record here is synthetic.
 */

const ITEM: EquipmentInfo = vi.hoisted(() => ({
  name: 'Synthetic Lantern', level: 2, traits: [], category: 'equipment',
  description: 'A synthetic lantern.', url: '/Equipment.aspx?ID=90010',
}))
vi.mock('../data/gameDataContext', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/gameDataContext')>()
  const data = {
    conditions: new Map(), traits: new Map(), spells: new Map(), rituals: new Map(),
    actions: new Map(), actionTraits: new Map(), skills: new Map(),
    equipment: new Map([['synthetic lantern', ITEM]]), families: new Map(),
    creatures: new Map(), creatureLinks: new Map(), rules: new Map(),
  }
  return { ...real, useGameData: () => data }
})

const { CombatantDetail } = await import('./CombatantDetail')
const { PopupPreview } = await import('./FloatingWindow')

const DEF: Defenses = { ac: 18, fort: 9, ref: 7, will: 5, hp: 40, immunities: [], resistances: [], weaknesses: [] }
const creature = (over: Partial<Creature> = {}): Creature => ({
  id: 'synth', name: 'Synthetic Raider', source: 'Test', level: 1,
  traits: ['humanoid'], perception: 6, senses: [], languages: ['Common'], skills: {},
  str: 3, dex: 2, con: 2, int: 0, wis: 1, cha: 0,
  items: [], speed: { walk: 25 }, attacks: [], spellcasting: [], abilities: [],
  defenses: { ...DEF }, isHazard: false, raw: {} as Creature['raw'], ...over,
})
const combatantOf = (c: Creature): Combatant => ({
  id: 'cb-1', name: c.name, creature: c, isPC: false, isAlly: false, initiative: null,
  currentHP: c.defenses.hp, maxHP: c.defenses.hp, tempHP: 0, conditions: [],
  isElite: false, isWeak: false, notes: '', isDefeated: false,
})

beforeEach(() => {
  // The stat block fits its columns with a ResizeObserver; jsdom has none.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
})
afterEach(() => {
  cleanup()
  useSettingsStore.getState().setSetting('showAonLink', true)
})

describe('(a) a creature in the initiative order keeps its Archives button', () => {
  const RAIDER_URL = 'https://2e.aonprd.com/Monsters.aspx?ID=90011'
  it('shows it from the creature\'s aonUrl, beside the pane\'s buttons', () => {
    const { container } = render(<CombatantDetail combatant={combatantOf(creature({ aonUrl: RAIDER_URL }))} onClose={() => undefined} />)
    expect(container.querySelector('a[data-aon-link]')?.getAttribute('href')).toBe(RAIDER_URL)
  })
  it('none for a creature with no page (homebrew, a custom text)', () => {
    const { container } = render(<CombatantDetail combatant={combatantOf(creature())} />)
    expect(container.querySelector('a[data-aon-link]')).toBeNull()
  })
  it('none with the setting off', () => {
    useSettingsStore.getState().setSetting('showAonLink', false)
    const { container } = render(<CombatantDetail combatant={combatantOf(creature({ aonUrl: RAIDER_URL }))} />)
    expect(container.querySelector('a[data-aon-link]')).toBeNull()
  })
})

describe('(b) an item in a docked pane of several tabs keeps its Archives button', () => {
  const HREF = 'https://2e.aonprd.com/Equipment.aspx?ID=90010'
  it('a strip above the page when the pane draws no header', () => {
    const { container } = render(<PopupPreview type="equipment" ref_="synthetic lantern" title="Synthetic Lantern" fill hideHeader />)
    expect(container.querySelector('[data-aon-bar] a[data-aon-link]')?.getAttribute('href')).toBe(HREF)
  })
  it('in the header for a pane of one tab, and no strip there', () => {
    const { container } = render(<PopupPreview type="equipment" ref_="synthetic lantern" title="Synthetic Lantern" fill />)
    expect(container.querySelector('[data-aon-bar]')).toBeNull()
    expect(container.querySelector('a[data-aon-link]')?.getAttribute('href')).toBe(HREF)
  })
  it('no strip with the setting off', () => {
    useSettingsStore.getState().setSetting('showAonLink', false)
    const { container } = render(<PopupPreview type="equipment" ref_="synthetic lantern" title="Synthetic Lantern" fill hideHeader />)
    expect(container.querySelector('[data-aon-bar]')).toBeNull()
    expect(container.querySelector('a[data-aon-link]')).toBeNull()
  })
})
