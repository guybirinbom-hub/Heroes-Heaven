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

/*
 * Fix round 2 (2026-10-07): what the builder REBUILT from its form and so lost on an untouched save of a
 * page record — heightened cantrips, constant spells, the page's spell block name, a hazard strike's
 * page place (D13), a strike's action cost and effects — and the AC box of a hazard with no flag.
 */
const caster = (): Creature => creature({
  name: 'Synthetic Redeemer', level: 5,
  spellcasting: [
    {
      name: 'Champion Devotion Spells', type: 'Focus', tradition: 'divine', DC: 21, focusPoints: 1, spells: 'Level 3: lay on hands',
      spellsByLevel: [{ label: 'Level 3', level: 3, spells: [{ name: 'lay on hands' }] }],
    },
    {
      name: 'Divine Innate Spells', type: 'Innate', tradition: 'divine', DC: 20, spells: '',
      spellsByLevel: [
        { label: 'Cantrips', level: 3, isCantrip: true, spells: [{ name: 'light' }, { name: 'stabilize' }] },
        { label: 'Level 2', level: 2, spells: [{ name: 'invisibility', note: 'self only' }, { name: 'see the unseen' }] },
        { label: 'Constant (6th)', level: 6, isConstant: true, spells: [{ name: 'truesight' }] },
      ],
    },
  ],
})
const strikeHazard = (): Creature => creature({
  id: 'synth-lock', name: 'Synthetic Lock', isHazard: true, traits: ['trap'], languages: [], perception: 0,
  abilities: [
    { name: 'Synthetic Spring', traits: [], entries: 'A spine extends.' },
    { name: 'Synthetic Venom', traits: ['poison'], entries: 'Saving Throw DC 19 Fortitude.' },
  ],
  attacks: [{ range: 'Melee', name: 'synthspine', attack: 13, activity: '◆', traits: [], damage: '1 piercing', types: ['piercing'], effects: ['synthetic venom'], isAgile: false, afterAbility: 1 }],
  defenses: { ...DEF, ac: 15, hp: 24, acPrinted: true, savesPrinted: ['fort'] },
  hazardData: { stealth: '+10', description: 'A lock.', disable: 'DC 20 Thievery', complex: false },
})
const rankLabels = (h: string) => [...h.matchAll(/<span class="spell-rank-label">(.*?)<\/span>/g)].map(m => m[1].replace(/<[^>]+>/g, ''))

describe('fix round 2: an untouched builder save keeps what the page printed', () => {
  it('a heightened cantrip rank stays a Cantrips rank (level 3, at will), not "3rd rank"', () => {
    const out = builder(caster()).last()
    expect(out.spellcasting[1].spellsByLevel[0]).toEqual(caster().spellcasting[1].spellsByLevel[0])
    expect(rankLabels(html(out))).toContain('Cantrips 3rd')
  })

  it('a constant rank keeps isConstant and its "Constant (6th)" label', () => {
    const out = builder(caster()).last()
    const r = out.spellcasting[1].spellsByLevel.find(x => x.level === 6)!
    expect(r.isConstant).toBe(true)
    expect(r.label).toBe('Constant (6th)')
    expect(rankLabels(html(out))).toContain('Constant (6th)')
  })

  it('the page\'s spell block name stays ("Champion Devotion Spells"), focus pool included', () => {
    const out = builder(caster()).last()
    expect(out.spellcasting.map(b => b.name)).toEqual(['Champion Devotion Spells', 'Divine Innate Spells'])
    expect(out.spellcasting[0].focusPoints).toBe(1)
    expect(out.spellcasting).toEqual(caster().spellcasting)
  })

  it('an edited rank is rebuilt with its kind: a cantrip edit stays a heightened cantrip, a spell kept by name keeps its note', () => {
    const b = builder(caster())
    b.tab('Spells')
    const lists = b.view.container.querySelectorAll('input[placeholder="fireball, heal (×3), light (at will)"]') as NodeListOf<HTMLInputElement>
    fireEvent.change(lists[1], { target: { value: 'light, stabilize, detect magic' } })
    fireEvent.change(lists[2], { target: { value: 'invisibility, see the unseen, synthetic veil' } })
    const ranks = b.last().spellcasting[1].spellsByLevel
    expect(ranks[0]).toMatchObject({ label: 'Cantrips', level: 3, isCantrip: true })
    expect(ranks[0].spells.map(s => s.name)).toEqual(['light', 'stabilize', 'detect magic'])
    expect(ranks[1].spells[0]).toMatchObject({ name: 'invisibility', note: 'self only' })
    expect(ranks[2]).toMatchObject({ label: 'Constant (6th)', isConstant: true })
  })

  it('retyping a block names it from its tradition and type', () => {
    const b = builder(caster())
    b.tab('Spells')
    const selects = b.view.container.querySelectorAll('select') as NodeListOf<HTMLSelectElement>
    // [tradition, type, rank…] per block: block 2's type select follows block 1's selects.
    const typeOfSecond = [...selects].filter(s => [...s.options].some(o => o.value === 'Prepared'))[1]
    fireEvent.change(typeOfSecond, { target: { value: 'Prepared' } })
    expect(b.last().spellcasting[1].name).toBe('Divine Prepared Spells')
  })

  it('a hazard strike keeps its page place, action cost and effects; removing the ability before it moves it with the list', () => {
    const b = builder(strikeHazard())
    expect(b.last().attacks[0]).toEqual(strikeHazard().attacks[0])
    const h = html(b.last())
    expect(h.indexOf('Synthetic Spring')).toBeLessThan(h.indexOf('synthspine'))
    expect(h.indexOf('synthspine')).toBeLessThan(h.indexOf('Synthetic Venom'))
    b.tab('Abilities')
    fireEvent.click(b.view.getAllByTitle('Remove ability')[0])
    expect(b.last().abilities.map(a => a.name)).toEqual(['Synthetic Venom'])
    expect(b.last().attacks[0].afterAbility).toBe(0)
  })

  it('an untouched save never moves a hazard\'s AC box, flag or no flag', () => {
    for (const flag of [undefined, true, false]) {
      for (const ac of [20, 0]) {
        const h = creature({ isHazard: true, traits: ['trap'], languages: [], defenses: { ...DEF, ac, ...(flag !== undefined ? { acPrinted: flag } : {}) }, hazardData: { description: 'x', complex: false } })
        const before = html(h).includes('class="def-box-label">AC</div>')
        const out = builder(h).last()
        expect(html(out).includes('class="def-box-label">AC</div>'), `acPrinted ${flag}, ac ${ac}`).toBe(before)
        cleanup()
      }
    }
  })
})

describe('fix round 2: the homebrew guard (D13) and the stored-hazard read', () => {
  it('a stored hazard without acPrinted reads as acPrinted: false (the AC box the old app never drew)', () => {
    const stored = JSON.parse(JSON.stringify(strikeHazard()))
    delete stored.defenses.acPrinted
    expect(toStatBlock(stored)!.defenses.acPrinted).toBe(false)
    // A creature never gets the hazard flag, and a hazard's own flag is never overwritten.
    expect(toStatBlock(JSON.parse(JSON.stringify(creature())))!.defenses.acPrinted).toBeUndefined()
    expect(toStatBlock(JSON.parse(JSON.stringify(strikeHazard())))!.defenses.acPrinted).toBe(true)
  })

  it('afterAbility: 0 … abilities.length and null pass; anything else is refused by name', () => {
    for (const v of [0, 1, 2, null]) {
      const c = JSON.parse(JSON.stringify(strikeHazard())); c.attacks[0].afterAbility = v
      expect(statBlockProblem(c), String(v)).toBeNull()
    }
    for (const v of ['1', -1, 1.5, 3, true]) {
      const c = JSON.parse(JSON.stringify(strikeHazard())); c.attacks[0].afterAbility = v
      expect(statBlockProblem(c), String(v)).toMatch(/attacks\[0\]\.afterAbility/)
    }
  })

  it('export → import keeps a hazard strike\'s afterAbility', () => {
    const [back] = parseCreaturesFromText(JSON.stringify([strikeHazard()])).creatures
    expect(back.attacks[0].afterAbility).toBe(1)
  })
})
