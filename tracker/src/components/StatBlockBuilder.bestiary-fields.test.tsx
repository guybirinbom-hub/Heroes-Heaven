import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { StatBlock } from './StatBlock'
import { StatBlockBuilder } from './StatBlockBuilder'
import { pickHazardPrinting, toStatBlock, statBlockProblem } from '../data/dataStore'
import { parseCreaturesFromText } from '../utils/dataTransfer'
import type { Combatant, Creature, Defenses } from '../types/pf2e'

/*
 * Owner A, fix round 1 of the verified-bestiary lane (2026-10-06): the loader, the homebrew guard and
 * the two round trips (export → import, the builder) against the fields the adapter added —
 * Ability.slot, Creature.languageAbilities, Defenses.hpPools / savesPrinted / acPrinted and the page
 * marker fromArchivesPage. Every record here is synthetic.
 */

const DEF: Defenses = { ac: 18, fort: 9, ref: 7, will: 5, hp: 90, immunities: [], resistances: [], weaknesses: [] }

function creature(over: Partial<Creature> = {}): Creature {
  return {
    id: 'synth-a', name: 'Synthetic Hydra', source: 'Test', level: 6,
    traits: ['beast'], perception: 14, senses: [], languages: ['Draconic'], skills: {},
    str: 5, dex: 2, con: 4, int: -2, wis: 2, cha: 0,
    items: [], speed: { walk: 25 }, attacks: [], spellcasting: [], abilities: [],
    defenses: { ...DEF }, isHazard: false, raw: {} as Creature['raw'],
    ...over,
  }
}

const pageCreature = (): Creature => creature({
  languageAbilities: ['telepathy 100 feet'],
  fromArchivesPage: true,
  recallKnowledge: 'DC 25 • Beast (Arcana, Nature) • Unspecific Lore DC 23 • Specific Lore DC 20',
  abilities: [
    { name: 'Top Aura', traits: ['aura'], entries: 'An aura.', slot: 'top' },
    { name: 'Mid Reaction', traits: [], entries: 'A reaction.', slot: 'mid' },
    { name: 'Bot Action', traits: [], entries: 'An action.', slot: 'bot' },
  ],
  defenses: { ...DEF, hpNote: 'body, hydra regeneration', hpPools: [{ hp: 90, name: 'body, hydra regeneration' }, { hp: 15, name: 'head, head regrowth' }] },
})

const pageHazard = (): Creature => creature({
  id: 'synth-h', name: 'Synthetic Gate', level: 4, isHazard: true, traits: ['trap'],
  languages: [], perception: 0,
  attacks: [{ range: 'Melee', name: 'blade', attack: 14, traits: [], damage: '2d8+6', types: ['slashing'], effects: [], isAgile: false }],
  defenses: { ...DEF, ac: 0, fort: 12, ref: 0, will: 0, hp: 30, hpNote: 'Gate', bt: 15, acPrinted: false, savesPrinted: ['fort'], hpPools: [{ hp: 30, name: 'Gate' }, { hp: 12, name: 'Lock' }] },
  hazardData: { stealth: '+10', description: 'A gate.', disable: 'DC 20 Thievery', complex: false },
})

function combatantOf(c: Creature): Combatant {
  return {
    id: 'cb', name: c.name, creature: c, isPC: false, isAlly: false, initiative: null,
    currentHP: c.defenses.hp, maxHP: c.defenses.hp, tempHP: 0, conditions: [],
    isElite: false, isWeak: false, notes: '', isDefeated: false,
  }
}
const html = (c: Creature) => renderToStaticMarkup(<StatBlock combatant={combatantOf(c)} />)

beforeEach(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
})
afterEach(() => cleanup())

describe('D1: the hazard loader opens the printing the index row names', () => {
  // hazards.json keeps every printing, legacy copy first (a byte copy of the corpus).
  const legacy = { name: 'Hidden Pit', level: 0, source: 'Core Rulebook' }
  const remaster = { name: 'Hidden Pit', level: 0, source: 'GM Core' }
  const other = { name: 'Collapsing Bridge', level: 15, source: 'Pathfinder #184: The Ghouls Hunger' }
  const bridge = { name: 'Collapsing Bridge', level: 16, source: 'Claws of the Tyrant' }
  const file = [legacy, other, remaster, bridge]

  it('matches name, level and source, with the row\'s page suffix stripped', () => {
    expect(pickHazardPrinting(file, { name: 'Hidden Pit', level: 0, source: 'GM Core pg. 102' })).toBe(remaster)
    expect(pickHazardPrinting(file, { name: 'Collapsing Bridge', level: 16, source: 'Claws of the Tyrant pg. 30' })).toBe(bridge)
    expect(pickHazardPrinting(file, { name: 'Collapsing Bridge', level: 16, source: 'Claws of the Tyrant p.30' })).toBe(bridge)
  })

  it('level decides between two printings of the same book', () => {
    const lo = { name: 'Rune', level: 2, source: 'Book' }, hi = { name: 'Rune', level: 5, source: 'Book' }
    expect(pickHazardPrinting([lo, hi], { name: 'Rune', level: 5, source: 'Book pg. 9' })).toBe(hi)
  })

  it('falls back to the first copy with that name only when no copy matches level and source', () => {
    expect(pickHazardPrinting(file, { name: 'Hidden Pit', level: 3, source: 'Somewhere Else pg. 1' })).toBe(legacy)
    expect(pickHazardPrinting(file, { name: 'Nothing Here', level: 0, source: 'GM Core' })).toBeUndefined()
  })
})

describe('D8: the homebrew guard reads every new field, refusing a wrong shape instead of crashing', () => {
  it('a well-formed page creature and page hazard pass whole, every new field kept', () => {
    for (const c of [pageCreature(), pageHazard()]) {
      const read = toStatBlock(JSON.parse(JSON.stringify(c)))
      expect(read, statBlockProblem(c) ?? '').not.toBeNull()
      expect(read!.abilities.map(a => a.slot)).toEqual(c.abilities.map(a => a.slot))
      expect(read!.languageAbilities).toEqual(c.languageAbilities)
      expect(read!.fromArchivesPage).toEqual(c.fromArchivesPage)
      expect(read!.defenses.hpPools).toEqual(c.defenses.hpPools)
      expect(read!.defenses.savesPrinted).toEqual(c.defenses.savesPrinted)
      expect(read!.defenses.acPrinted).toEqual(c.defenses.acPrinted)
      expect(() => html(read!)).not.toThrow()
    }
  })

  const bad: Array<[string, (c: Record<string, any>) => void, RegExp]> = [
    ['an ability slot outside top/mid/bot', c => { c.abilities[0].slot = 'side' }, /abilities\[0\]\.slot/],
    ['an ability slot that is a number', c => { c.abilities[1].slot = 2 }, /abilities\[1\]\.slot/],
    ['languageAbilities as one string', c => { c.languageAbilities = 'telepathy 100 feet' }, /languageAbilities/],
    ['languageAbilities holding a number', c => { c.languageAbilities = ['telepathy', 100] }, /languageAbilities/],
    ['fromArchivesPage as text', c => { c.fromArchivesPage = 'true' }, /fromArchivesPage/],
    ['hpPools as a number', c => { c.defenses.hpPools = 90 }, /defenses\.hpPools/],
    ['an hpPools pool whose hp is text', c => { c.defenses.hpPools[1].hp = '15' }, /defenses\.hpPools\[1\]\.hp/],
    ['an hpPools pool whose name is a number', c => { c.defenses.hpPools[0].name = 3 }, /defenses\.hpPools\[0\]\.name/],
    ['an hpPools entry that is not an object', c => { c.defenses.hpPools[1] = 15 }, /defenses\.hpPools\[1\]/],
  ]
  for (const [what, spoil, why] of bad) {
    it(`refuses a creature with ${what}`, () => {
      const c = JSON.parse(JSON.stringify(pageCreature()))
      spoil(c)
      expect(toStatBlock(c)).toBeNull()
      expect(statBlockProblem(c)).toMatch(why)
    })
  }

  const badHazard: Array<[string, (c: Record<string, any>) => void, RegExp]> = [
    ['savesPrinted naming a save that does not exist', c => { c.defenses.savesPrinted = ['fortitude'] }, /defenses\.savesPrinted\[0\]/],
    ['savesPrinted as one word', c => { c.defenses.savesPrinted = 'fort' }, /defenses\.savesPrinted/],
    ['acPrinted as text', c => { c.defenses.acPrinted = 'yes' }, /defenses\.acPrinted/],
    ['a strike whose attack is text', c => { c.attacks[0].attack = '+14' }, /attacks\[0\]\.attack/],
    ['a strike that is a string', c => { c.attacks = ['Melee blade +14'] }, /attacks\[0\]/],
  ]
  for (const [what, spoil, why] of badHazard) {
    it(`refuses a hazard with ${what}`, () => {
      const c = JSON.parse(JSON.stringify(pageHazard()))
      spoil(c)
      expect(toStatBlock(c)).toBeNull()
      expect(statBlockProblem(c)).toMatch(why)
    })
  }

  it('null on any new optional field is "absent", as for every other optional field', () => {
    const c = JSON.parse(JSON.stringify(pageHazard()))
    c.languageAbilities = null; c.fromArchivesPage = null
    c.defenses.hpPools = null; c.defenses.savesPrinted = null; c.defenses.acPrinted = null
    c.abilities = [{ name: 'X', traits: [], entries: '', slot: null }]
    expect(statBlockProblem(c)).toBeNull()
  })
})

describe('D8: export → import keeps the page fields', () => {
  it('slot, languageAbilities, hpPools, hpNote, savesPrinted, acPrinted and the page marker survive', () => {
    const src = [pageCreature(), pageHazard()]
    const r = parseCreaturesFromText(JSON.stringify(src))
    expect(r.skipped ?? []).toEqual([])
    expect(r.creatures.length).toBe(2)
    const [c, h] = r.creatures
    expect(c.abilities.map(a => a.slot)).toEqual(['top', 'mid', 'bot'])
    expect(c.languageAbilities).toEqual(['telepathy 100 feet'])
    expect(c.fromArchivesPage).toBe(true)
    expect(c.defenses.hpPools).toEqual(src[0].defenses.hpPools)
    expect(c.defenses.hpNote).toBe('body, hydra regeneration')
    expect(h.defenses.savesPrinted).toEqual(['fort'])
    expect(h.defenses.acPrinted).toBe(false)
    expect(h.defenses.hpPools).toEqual(src[1].defenses.hpPools)
    expect(h.attacks.map(a => a.name)).toEqual(['blade'])
  })

  it('a reloaded page record (rawMarkdown slimmed away) that prints no Recall Knowledge still prints none', () => {
    const slim = creature({ fromArchivesPage: true })
    expect(html(slim)).not.toContain('Recall Knowledge')
    const [back] = parseCreaturesFromText(JSON.stringify([slim])).creatures
    expect(back.fromArchivesPage).toBe(true)
    expect(html(back)).not.toContain('Recall Knowledge')
  })

  it('an import with a malformed new field skips that creature with the reason, and keeps the others', () => {
    const bad = JSON.parse(JSON.stringify(pageHazard()))
    bad.defenses.savesPrinted = ['fortitude']
    const r = parseCreaturesFromText(JSON.stringify([pageCreature(), bad]))
    expect(r.creatures.map(c => c.name)).toEqual(['Synthetic Hydra'])
    expect((r.skipped ?? []).join('\n')).toMatch(/Synthetic Gate.*savesPrinted/)
  })
})

/** Mount the builder on `initial` and hand back the last record it emitted, live. */
function builder(initial: Creature | null) {
  let last: Creature | null = null
  const view = render(<StatBlockBuilder initial={initial} onChange={c => { last = c }} />)
  const numbers = () => Array.from(view.container.querySelectorAll('input[type="number"]')) as HTMLInputElement[]
  const set = (i: number, v: number) => fireEvent.change(numbers()[i], { target: { value: String(v) } })
  return { view, set, last: () => last!, tab: (label: string) => fireEvent.click(view.getByText(label)) }
}

describe('D8: the builder keeps the page fields through an edit', () => {
  it('a page creature opened and edited keeps slots, language abilities and pools; the HP edit moves the first pool', () => {
    const b = builder(pageCreature())
    expect(b.last().abilities.map(a => [a.name, a.slot])).toEqual([['Top Aura', 'top'], ['Mid Reaction', 'mid'], ['Bot Action', 'bot']])
    expect(b.last().languageAbilities).toEqual(['telepathy 100 feet'])
    expect(b.last().defenses.hpPools).toEqual(pageCreature().defenses.hpPools)
    b.tab('Defense')
    b.set(1, 120) // HP
    expect(b.last().defenses.hp).toBe(120)
    expect(b.last().defenses.hpPools).toEqual([{ hp: 120, name: 'body, hydra regeneration' }, { hp: 15, name: 'head, head regrowth' }])
    expect(b.last().defenses.hpNote).toBe('body, hydra regeneration')
    b.tab('Abilities')
    fireEvent.click(b.view.getByText('+ Add ability'))
    const names = b.view.container.querySelectorAll('input[placeholder="Frightful Presence"]')
    fireEvent.change(names[names.length - 1], { target: { value: 'New One' } })
    const added = b.last().abilities.find(a => a.name === 'New One')!
    expect(added.slot).toBeUndefined()
  })

  it('a page hazard opened and edited keeps savesPrinted and acPrinted; typing a save or the AC makes it printed', () => {
    const b = builder(pageHazard())
    expect(b.last().defenses.savesPrinted).toEqual(['fort'])
    expect(b.last().defenses.acPrinted).toBe(false)
    expect(b.last().defenses.hpPools).toEqual(pageHazard().defenses.hpPools)
    b.tab('Defense')
    // AC, HP, Hardness, Broken Threshold, Fortitude, Reflex, Will
    b.set(6, 9)
    expect(b.last().defenses.savesPrinted).toEqual(['fort', 'will'])
    expect(b.last().defenses.acPrinted).toBe(false)
    b.set(0, 22)
    expect(b.last().defenses.acPrinted).toBe(true)
  })

  it('a new hazard draws no AC until the GM types one, then draws it', () => {
    const b = builder(null)
    fireEvent.click(b.view.getByText('⚠ Hazard'))
    expect(b.last().defenses.acPrinted).toBe(false)
    expect(html(b.last())).not.toContain('class="def-box-label">AC</div>')
    b.tab('Defense')
    b.set(0, 21)
    expect(b.last().defenses.acPrinted).toBe(true)
    expect(html(b.last())).toContain('class="def-box-label">AC</div>')
  })

  it('a creature never carries the hazard-only fields, and a hazard never carries language abilities', () => {
    const c = builder(pageCreature())
    expect(c.last().defenses.acPrinted).toBeUndefined()
    expect(c.last().defenses.savesPrinted).toBeUndefined()
    fireEvent.click(c.view.getByText('⚠ Hazard'))
    expect(c.last().languageAbilities).toBeUndefined()
  })

  it('a level edit on a page record moves every printed Recall Knowledge DC by the level table; back to the printed level restores it', () => {
    const b = builder(pageCreature())
    expect(b.last().recallKnowledge).toBe(pageCreature().recallKnowledge)
    b.set(0, 8) // Level 6 → 8: the level table moves 22 → 24 (+2)
    expect(b.last().recallKnowledge).toBe('DC 27 • Beast (Arcana, Nature) • Unspecific Lore DC 25 • Specific Lore DC 22')
    b.set(0, 6)
    expect(b.last().recallKnowledge).toBe(pageCreature().recallKnowledge)
  })

  it('a pasted (page-less) record keeps its Recall Knowledge line verbatim through a level edit', () => {
    const pasted = creature({ recallKnowledge: 'DC 30 (Arcana)' })
    const b = builder(pasted)
    b.set(0, 9)
    expect(b.last().recallKnowledge).toBe('DC 30 (Arcana)')
  })
})
