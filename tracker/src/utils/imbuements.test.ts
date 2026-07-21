import { describe, it, expect } from 'vitest'
import { matchingImbuements } from './imbuements'
import type { Creature, Defenses } from '../types/pf2e'

// Minimal Creature fixture — matchingImbuements reads traits, attacks[].types,
// defenses (immunities/resistances/hardness), senses, ability mods, speed.fly,
// skills, and spellcasting. Everything else is cast away.
function makeCreature(over: Partial<Creature> & { defenses?: Partial<Defenses> } = {}): Creature {
  const base = {
    traits: [], senses: [], skills: {}, spellcasting: [], attacks: [],
    str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, speed: {},
  }
  const defenses = { immunities: [], resistances: [], ...(over.defenses ?? {}) }
  return { ...base, ...over, defenses } as unknown as Creature
}

const names = (c: Creature) => matchingImbuements(c).map(m => m.name)
const find = (c: Creature, name: string) => matchingImbuements(c).find(m => m.name === name)

describe('matchingImbuements — energy weapons', () => {
  it('matches Fire from the fire trait', () => {
    const c = makeCreature({ traits: ['dragon', 'fire'] })
    expect(names(c)).toContain('Fire')
    expect(find(c, 'Fire')!.why).toBe('fire trait')
  })

  it('matches Cold from an attack dealing cold damage (no trait)', () => {
    const c = makeCreature({ attacks: [{ types: ['slashing', 'cold'] } as never] })
    expect(names(c)).toContain('Cold')
    expect(find(c, 'Cold')!.why).toBe('deals cold damage')
  })

  it('does not match unrelated energy types', () => {
    const c = makeCreature({ traits: ['fire'] })
    expect(names(c)).not.toContain('Acid')
    expect(names(c)).not.toContain('Electricity')
  })
})

describe('matchingImbuements — spirit & sanctified', () => {
  it('matches Holy & Lawful from the holy trait', () => {
    const c = makeCreature({ traits: ['celestial', 'holy'] })
    expect(names(c)).toEqual(expect.arrayContaining(['Holy', 'Lawful']))
    expect(find(c, 'Holy')!.why).toBe('holy trait')
  })

  it('matches Unholy & Chaotic from the unholy trait', () => {
    const c = makeCreature({ traits: ['fiend', 'unholy'] })
    expect(names(c)).toEqual(expect.arrayContaining(['Unholy', 'Chaotic']))
  })

  it('matches Void from the undead trait', () => {
    const c = makeCreature({ traits: ['undead'] })
    expect(names(c)).toContain('Void')
    expect(find(c, 'Void')!.why).toBe('undead / void healing')
  })
})

describe('matchingImbuements — Bane & Wild', () => {
  it('Bane lists the creature type; Wild always fits', () => {
    const c = makeCreature({ traits: ['animal'] })
    expect(find(c, 'Bane')!.why).toContain('animal')
    expect(names(c)).toContain('Wild')
  })

  it('Bane still fits a creature with no creature-type trait', () => {
    const c = makeCreature({ traits: [] })
    expect(names(c)).toContain('Bane')
    expect(find(c, 'Bane')!.why).toBe('choose any creature type')
  })
})

describe('matchingImbuements — armor & shield', () => {
  it('Energy Resistant fits when the monster resists an energy type', () => {
    const c = makeCreature({ defenses: { resistances: [{ amount: 10, name: 'fire' }] } })
    expect(find(c, 'Energy Resistant')!.why).toContain('fire')
  })

  it('Winged fits a creature with a fly Speed', () => {
    const c = makeCreature({ speed: { walk: 25, fly: 60 } })
    expect(names(c)).toContain('Winged')
    expect(find(c, 'Winged')!.why).toBe('has a fly Speed')
  })

  it('Winged does not fit a grounded creature', () => {
    const c = makeCreature({ speed: { walk: 25 } })
    expect(names(c)).not.toContain('Winged')
  })

  it('Sturdy fits a creature with Hardness', () => {
    const c = makeCreature({ defenses: { hardness: 8 } })
    expect(names(c)).toContain('Sturdy')
  })
})

describe('matchingImbuements — Sensory', () => {
  it('fits a creature with darkvision', () => {
    const c = makeCreature({ senses: ['darkvision', 'scent (imprecise) 30 feet'] })
    expect(names(c)).toContain('Sensory')
    expect(find(c, 'Sensory')!.why).toContain('darkvision')
  })

  it('does not fit a creature with no listed special senses', () => {
    const c = makeCreature({ senses: [] })
    expect(names(c)).not.toContain('Sensory')
  })
})

describe('matchingImbuements — attribute & Spell', () => {
  it('matches only the top-two ability imbuements', () => {
    // Str +8 (highest), Dex +5 (2nd), the rest lower.
    const c = makeCreature({ str: 8, dex: 5, con: 2, int: 0, wis: 1, cha: -1 })
    const n = names(c)
    expect(n).toEqual(expect.arrayContaining(['Strength', 'Dexterity']))
    expect(n).not.toContain('Constitution')
    expect(n).not.toContain('Charisma')
    expect(find(c, 'Strength')!.why).toContain('top-2')
  })

  it('Spell fits when the creature can cast spells', () => {
    const c = makeCreature({ spellcasting: [{} as never] })
    expect(names(c)).toContain('Spell')
    expect(find(c, 'Spell')!.why).toBe('casts spells')
  })

  it('Spell fits from trained skills when there is no spellcasting', () => {
    const c = makeCreature({ skills: { Athletics: 20 } })
    expect(find(c, 'Spell')!.why).toBe('has trained skills')
  })
})

describe('matchingImbuements — realistic fire dragon', () => {
  it('surfaces a coherent, deduped set for a flying fire dragon', () => {
    const dragon = makeCreature({
      traits: ['dragon', 'fire'],
      attacks: [{ types: ['piercing', 'fire'] } as never],
      senses: ['darkvision', 'scent (imprecise) 60 feet'],
      speed: { walk: 40, fly: 120 },
      str: 9, dex: 4, con: 7, int: 3, wis: 5, cha: 6,
      skills: { Athletics: 30, Intimidation: 28 },
      defenses: { immunities: ['fire', 'paralyzed'], resistances: [] },
    })
    const n = names(dragon)
    expect(n).toEqual(expect.arrayContaining([
      'Fire', 'Bane', 'Wild', 'Energy Resistant', 'Winged', 'Sensory', 'Strength',
    ]))
    // no duplicates
    expect(new Set(n).size).toBe(n.length)
    // energy the dragon has nothing to do with should be absent
    expect(n).not.toContain('Cold')
    expect(n).not.toContain('Poison')
  })
})
