import { describe, it, expect } from 'vitest'
import { parseCreature, parseHazard } from './parseCreature'
import type { RawCreature, RawHazard } from '../types/pf2e'

// Minimal raw-creature factory: only the fields a test cares about are passed
// in; everything else is left undefined so we exercise the parser's defaults.
const makeRaw = (over: Partial<RawCreature> = {}): RawCreature =>
  ({ name: 'Goblin', source: 'Bestiary', level: 1, ...over }) as RawCreature

describe('parseCreature - basic mapped fields', () => {
  it('maps name, level and traits straight through', () => {
    const c = parseCreature(makeRaw({
      name: 'Ancient Red Dragon',
      level: 19,
      traits: ['Dragon', 'Fire'],
    }))
    expect(c.name).toBe('Ancient Red Dragon')
    expect(c.level).toBe(19)
    expect(c.traits).toEqual(['Dragon', 'Fire'])
  })

  it('defaults level to 0 and traits to [] when absent', () => {
    const c = parseCreature(makeRaw({ level: undefined as unknown as number, traits: undefined }))
    expect(c.level).toBe(0)
    expect(c.traits).toEqual([])
  })

  it('builds a slugified id prefixed from the lowercased name', () => {
    const c = parseCreature(makeRaw({ name: 'Giant Rat' }))
    // name lowercased with spaces -> hyphens, then "-<counter>"
    expect(c.id).toMatch(/^giant-rat-\d+$/)
  })

  it('marks the creature as not a hazard', () => {
    expect(parseCreature(makeRaw()).isHazard).toBe(false)
  })

  it('keeps the original raw object on .raw', () => {
    const raw = makeRaw({ name: 'Kobold' })
    const c = parseCreature(raw)
    expect(c.raw).toBe(raw)
  })
})

describe('parseCreature - source / page string', () => {
  it('appends " p.N" when a page is present', () => {
    const c = parseCreature({ ...makeRaw(), source: 'Bestiary', page: 187 } as RawCreature)
    expect(c.source).toBe('Bestiary p.187')
  })

  it('omits the page suffix when page is undefined', () => {
    const c = parseCreature(makeRaw({ source: 'Bestiary' }))
    expect(c.source).toBe('Bestiary')
  })

  it('omits the page suffix when page is an empty string', () => {
    const c = parseCreature({ ...makeRaw(), source: 'Bestiary', page: '' } as unknown as RawCreature)
    expect(c.source).toBe('Bestiary')
  })

  it('trims to empty string when source is missing', () => {
    const c = parseCreature({ ...makeRaw(), source: undefined } as unknown as RawCreature)
    expect(c.source).toBe('')
  })
})

describe('parseCreature - ability modifiers', () => {
  it('maps every ability modifier from abilityMods', () => {
    const c = parseCreature(makeRaw({
      abilityMods: { str: 4, dex: 2, con: 3, int: -1, wis: 1, cha: 0 },
    }))
    expect(c.str).toBe(4)
    expect(c.dex).toBe(2)
    expect(c.con).toBe(3)
    expect(c.int).toBe(-1)
    expect(c.wis).toBe(1)
    expect(c.cha).toBe(0)
  })

  it('defaults all ability modifiers to 0 when abilityMods is absent', () => {
    const c = parseCreature(makeRaw({ abilityMods: undefined }))
    expect([c.str, c.dex, c.con, c.int, c.wis, c.cha]).toEqual([0, 0, 0, 0, 0, 0])
  })
})

describe('parseCreature - perception, senses, languages, skills', () => {
  it('reads perception from perception.std and defaults to 0', () => {
    expect(parseCreature(makeRaw({ perception: { std: 12 } })).perception).toBe(12)
    expect(parseCreature(makeRaw({ perception: undefined })).perception).toBe(0)
  })

  it('formats senses, appending "ft" only when a range is given', () => {
    const c = parseCreature(makeRaw({
      senses: [{ name: 'darkvision', range: 60 }, { name: 'scent' }],
    }))
    expect(c.senses).toEqual(['darkvision 60ft', 'scent'])
  })

  it('returns [] senses when none provided', () => {
    expect(parseCreature(makeRaw({ senses: undefined })).senses).toEqual([])
  })

  it('cleans AoN template markers and HTML out of languages', () => {
    const c = parseCreature(makeRaw({
      languages: { languages: ['Common', '<%TRAITS%358%%>munavris<%END>', '<i>telepathy</i> 100 feet'] },
    }))
    expect(c.languages).toEqual(['Common', 'munavris', 'telepathy 100 feet'])
  })

  it('returns [] languages when the language block is absent', () => {
    expect(parseCreature(makeRaw({ languages: undefined })).languages).toEqual([])
  })

  it('reads skills from object .std and from plain numbers', () => {
    const c = parseCreature(makeRaw({
      skills: {
        athletics: { std: 9 },
        stealth: 7 as unknown as { std?: number },
        acrobatics: {} as { std?: number },
      },
    }))
    expect(c.skills.athletics).toBe(9)
    expect(c.skills.stealth).toBe(7)
    // object with no std falls back to 0
    expect(c.skills.acrobatics).toBe(0)
  })

  it('returns an empty skills map when skills is absent', () => {
    expect(parseCreature(makeRaw({ skills: undefined })).skills).toEqual({})
  })
})

describe('parseCreature - speed', () => {
  it('passes the speed object through unchanged', () => {
    const speed = { walk: 25, fly: 60 }
    expect(parseCreature(makeRaw({ speed })).speed).toEqual(speed)
  })

  it('defaults speed to an empty object when absent', () => {
    expect(parseCreature(makeRaw({ speed: undefined })).speed).toEqual({})
  })
})

describe('parseCreature - attacks', () => {
  it('maps attack fields and cleans the damage expression', () => {
    const c = parseCreature(makeRaw({
      attacks: [{
        range: 'Melee', name: 'jaws', attack: 9,
        traits: ['finesse'], damage: '{@damage 1d8+4} piercing',
        types: ['piercing'], effects: ['Grab'],
      }],
    }))
    expect(c.attacks).toHaveLength(1)
    const atk = c.attacks[0]
    expect(atk.range).toBe('Melee')
    expect(atk.name).toBe('jaws')
    expect(atk.attack).toBe(9)
    expect(atk.traits).toEqual(['finesse'])
    expect(atk.types).toEqual(['piercing'])
    expect(atk.effects).toEqual(['Grab'])
    // cleanDamageExpr strips the {@damage ...} wrapper
    expect(atk.damage).toBe('1d8+4 piercing')
    expect(atk.isAgile).toBe(false)
  })

  it('flags isAgile when an attack trait contains "agile"', () => {
    const c = parseCreature(makeRaw({
      attacks: [{ range: 'Melee', name: 'claw', attack: 5, traits: ['Agile', 'finesse'] }],
    }))
    expect(c.attacks[0].isAgile).toBe(true)
  })

  it('defaults missing attack fields (attack 0, empty arrays, empty damage)', () => {
    const c = parseCreature(makeRaw({
      attacks: [{ range: 'Ranged', name: 'rock' } as unknown as RawCreature['attacks'][number]],
    }))
    const atk = c.attacks[0]
    expect(atk.attack).toBe(0)
    expect(atk.traits).toEqual([])
    expect(atk.types).toEqual([])
    expect(atk.effects).toEqual([])
    expect(atk.damage).toBe('')
    expect(atk.isAgile).toBe(false)
  })

  it('returns an empty attacks array when none provided', () => {
    expect(parseCreature(makeRaw({ attacks: undefined })).attacks).toEqual([])
  })
})

describe('parseCreature - defenses', () => {
  it('reads ac/fort/ref/will via the .std accessors', () => {
    const c = parseCreature(makeRaw({
      defenses: {
        ac: { std: 18 },
        savingThrows: { fort: { std: 11 }, ref: { std: 6 }, will: { std: 9 } },
        hp: [{ hp: 45 }],
      },
    }))
    expect(c.defenses.ac).toBe(18)
    expect(c.defenses.fort).toBe(11)
    expect(c.defenses.ref).toBe(6)
    expect(c.defenses.will).toBe(9)
    expect(c.defenses.hp).toBe(45)
  })

  it('falls back to the first non-undefined value when ac/save has no std', () => {
    const c = parseCreature(makeRaw({
      defenses: {
        ac: { vsMagic: 20 } as { std?: number },
        savingThrows: { fort: { vsPoison: 14 } as { std?: number } },
      },
    }))
    expect(c.defenses.ac).toBe(20)
    expect(c.defenses.fort).toBe(14)
  })

  it('defaults ac/saves/hp to 0 when the defense block is empty', () => {
    const c = parseCreature(makeRaw({ defenses: undefined }))
    expect(c.defenses.ac).toBe(0)
    expect(c.defenses.fort).toBe(0)
    expect(c.defenses.ref).toBe(0)
    expect(c.defenses.will).toBe(0)
    expect(c.defenses.hp).toBe(0)
  })

  it('reads hp from the first hp entry', () => {
    const c = parseCreature(makeRaw({ defenses: { hp: [{ hp: 30 }, { hp: 10 }] } }))
    expect(c.defenses.hp).toBe(30)
  })

  it('maps immunities, resistances and weaknesses', () => {
    const c = parseCreature(makeRaw({
      defenses: {
        immunities: ['fire', 'poison'],
        resistances: [{ amount: 5, name: 'cold', note: 'except vs silver' }],
        weaknesses: [{ amount: 10, name: 'good' }],
      },
    }))
    expect(c.defenses.immunities).toEqual(['fire', 'poison'])
    expect(c.defenses.resistances).toEqual([{ amount: 5, name: 'cold', note: 'except vs silver' }])
    expect(c.defenses.weaknesses).toEqual([{ amount: 10, name: 'good', note: undefined }])
  })

  it('defaults immunities/resistances/weaknesses to empty arrays', () => {
    const c = parseCreature(makeRaw({ defenses: {} }))
    expect(c.defenses.immunities).toEqual([])
    expect(c.defenses.resistances).toEqual([])
    expect(c.defenses.weaknesses).toEqual([])
  })
})

describe('parseCreature - abilities', () => {
  it('maps an ability with its activity glyph and cleaned entries', () => {
    const c = parseCreature(makeRaw({
      abilities: {
        top: [{
          name: 'Attack of Opportunity',
          activity: { number: 1, unit: 'reaction' },
          traits: ['concentrate'],
          trigger: 'A creature within reach uses a manipulate action.',
          entries: ['Make a melee Strike.'],
        }],
      },
    }))
    expect(c.abilities).toHaveLength(1)
    const ab = c.abilities[0]
    expect(ab.name).toBe('Attack of Opportunity')
    // activitySymbol(reaction) -> ' ↺'
    expect(ab.activity).toBe(' ↺')
    expect(ab.traits).toEqual(['concentrate'])
    expect(ab.entries).toBe('Make a melee Strike.')
  })

  it('collects abilities across top/mid/bot slots in order', () => {
    const c = parseCreature(makeRaw({
      abilities: {
        top: [{ name: 'TopAb', entries: ['t'] }],
        mid: [{ name: 'MidAb', entries: ['m'] }],
        bot: [{ name: 'BotAb', entries: ['b'] }],
      },
    }))
    expect(c.abilities.map(a => a.name)).toEqual(['TopAb', 'MidAb', 'BotAb'])
  })

  it('returns no abilities when the abilities block is absent', () => {
    expect(parseCreature(makeRaw({ abilities: undefined })).abilities).toEqual([])
  })
})

describe('parseCreature - spellcasting', () => {
  it('builds cantrip, leveled and constant slot entries with sort order', () => {
    const c = parseCreature(makeRaw({
      spellcasting: [{
        name: 'Arcane Innate Spells',
        type: 'Innate',
        tradition: 'arcane',
        DC: 28,
        attack: 20,
        entry: {
          '0': { level: 6, spells: [{ name: 'detect magic' }] },
          '3': { level: 3, slots: 2, spells: [{ name: 'fireball', amount: 2 }] },
          '5': { spells: [{ name: 'cone of cold' }] },
          constant: { '4': { spells: [{ name: 'fly' }] } },
        },
      }],
    }))
    expect(c.spellcasting).toHaveLength(1)
    const sc = c.spellcasting[0]
    expect(sc.name).toBe('Arcane Innate Spells')
    expect(sc.type).toBe('Innate')
    expect(sc.tradition).toBe('arcane')
    expect(sc.DC).toBe(28)
    expect(sc.attack).toBe(20)

    const labels = sc.spellsByLevel.map(s => s.label)
    // Cantrips first, constants last, the rest by level ascending
    expect(labels).toEqual(['Cantrips', 'Level 3', 'Level 5', 'Constant (4th)'])

    const cantrips = sc.spellsByLevel[0]
    expect(cantrips.isCantrip).toBe(true)
    expect(cantrips.level).toBe(6) // heightened to data.level

    const lvl3 = sc.spellsByLevel[1]
    expect(lvl3.slots).toBe(2)
    expect(lvl3.spells[0]).toEqual({ name: 'fireball', amount: '2', uses: 2, atWill: undefined })

    const lvl5 = sc.spellsByLevel[2]
    // no data.level -> falls back to the slot number
    expect(lvl5.level).toBe(5)

    const constant = sc.spellsByLevel[3]
    expect(constant.isConstant).toBe(true)
    expect(constant.level).toBe(4)
  })

  it('builds the fallback spells string from the slot entries', () => {
    const c = parseCreature(makeRaw({
      spellcasting: [{
        type: 'Innate',
        entry: {
          '0': { spells: [{ name: 'light' }] },
          '1': { spells: [{ name: 'magic missile', amount: 3 }] },
        },
      }],
    }))
    expect(c.spellcasting[0].spells).toBe('Cantrips: light; Level 1: magic missile (3)')
  })

  it('derives the block name from type + tradition when name is missing', () => {
    const c = parseCreature(makeRaw({
      spellcasting: [{ type: 'Prepared', tradition: 'divine', entry: {} }],
    }))
    expect(c.spellcasting[0].name).toBe('Prepared divine')
  })

  it('returns an empty spellcasting array when absent', () => {
    expect(parseCreature(makeRaw({ spellcasting: undefined })).spellcasting).toEqual([])
  })

  it('skips slot keys whose spell list is empty', () => {
    const c = parseCreature(makeRaw({
      spellcasting: [{ type: 'Innate', entry: { '2': { spells: [] } } }],
    }))
    expect(c.spellcasting[0].spellsByLevel).toEqual([])
    expect(c.spellcasting[0].spells).toBe('')
  })
})

describe('parseCreature - items, flavor, family, aon', () => {
  it('passes items through and defaults to []', () => {
    expect(parseCreature(makeRaw({ items: ['longsword', 'shield'] })).items).toEqual(['longsword', 'shield'])
    expect(parseCreature(makeRaw({ items: undefined })).items).toEqual([])
  })

  it('maps flavor and family, leaving them undefined when empty', () => {
    const c = parseCreature(makeRaw({ flavor: 'A fearsome beast.', family: 'Dragons' }))
    expect(c.flavor).toBe('A fearsome beast.')
    expect(c.family).toBe('Dragons')
    const c2 = parseCreature(makeRaw({ flavor: '', family: '' }))
    expect(c2.flavor).toBeUndefined()
    expect(c2.family).toBeUndefined()
  })

  it('prefixes a relative AoN url with the AoN host and keeps absolute urls', () => {
    const rel = parseCreature({ ...makeRaw(), _aon: { url: '/Monsters.aspx?ID=1', markdown: '# md' } } as unknown as RawCreature)
    expect(rel.aonUrl).toBe('https://2e.aonprd.com/Monsters.aspx?ID=1')
    expect(rel.rawMarkdown).toBe('# md')

    const abs = parseCreature({ ...makeRaw(), _aon: { url: 'https://example.com/x' } } as unknown as RawCreature)
    expect(abs.aonUrl).toBe('https://example.com/x')
  })

  it('leaves aonUrl and rawMarkdown undefined without an _aon block', () => {
    const c = parseCreature(makeRaw())
    expect(c.aonUrl).toBeUndefined()
    expect(c.rawMarkdown).toBeUndefined()
  })
})

// ── parseHazard ──────────────────────────────────────────────────────────────

const makeHaz = (over: Partial<RawHazard> = {}): RawHazard =>
  ({ name: 'Spike Pit', source: 'Core', level: 1, ...over }) as RawHazard

describe('parseHazard - basic fields', () => {
  it('maps name, level, traits and marks it as a hazard', () => {
    const h = parseHazard(makeHaz({ name: 'Hidden Pit', level: 3, traits: ['environmental'] }))
    expect(h.name).toBe('Hidden Pit')
    expect(h.level).toBe(3)
    expect(h.traits).toEqual(['environmental'])
    expect(h.isHazard).toBe(true)
  })

  it('defaults level to 0 and traits to [] when absent', () => {
    const h = parseHazard(makeHaz({ level: undefined as unknown as number, traits: undefined }))
    expect(h.level).toBe(0)
    expect(h.traits).toEqual([])
  })

  it('builds an id with a -haz suffix segment', () => {
    const h = parseHazard(makeHaz({ name: 'Falling Block' }))
    expect(h.id).toMatch(/^falling-block-haz-\d+$/)
  })

  it('zeroes out the creature-only stat fields', () => {
    const h = parseHazard(makeHaz())
    expect([h.str, h.dex, h.con, h.int, h.wis, h.cha]).toEqual([0, 0, 0, 0, 0, 0])
    expect(h.perception).toBe(0)
    expect(h.senses).toEqual([])
    expect(h.languages).toEqual([])
    expect(h.skills).toEqual({})
    expect(h.items).toEqual([])
    expect(h.speed).toEqual({})
    expect(h.spellcasting).toEqual([])
  })

  it('builds the source string with the page suffix', () => {
    const h = parseHazard({ ...makeHaz(), source: 'GMG', page: 60 } as RawHazard)
    expect(h.source).toBe('GMG p.60')
  })

  it('keeps the raw object reference', () => {
    const raw = makeHaz()
    expect(parseHazard(raw).raw).toBe(raw)
  })
})

describe('parseHazard - defenses', () => {
  it('reads hp from the array form and ac/saves/hardness/bt from structured fields', () => {
    const h = parseHazard(makeHaz({
      defenses: {
        ac: { std: 20 },
        savingThrows: { fort: { std: 12 }, ref: { std: 8 }, will: { std: 5 } },
        hp: [{ hp: 36 }],
        hardness: { std: 7 },
        bt: { std: 18 },
        immunities: ['critical hits'],
        resistances: [{ amount: 5, name: 'physical' }],
        weaknesses: [{ amount: 5, name: 'fire' }],
      },
    }))
    expect(h.defenses.ac).toBe(20)
    expect(h.defenses.fort).toBe(12)
    expect(h.defenses.ref).toBe(8)
    expect(h.defenses.will).toBe(5)
    expect(h.defenses.hp).toBe(36)
    expect(h.defenses.hardness).toBe(7)
    expect(h.defenses.bt).toBe(18)
    expect(h.defenses.immunities).toEqual(['critical hits'])
    expect(h.defenses.resistances).toEqual([{ amount: 5, name: 'physical', note: undefined }])
    expect(h.defenses.weaknesses).toEqual([{ amount: 5, name: 'fire', note: undefined }])
  })

  it('reads hp from the std fallback when hp is not an array', () => {
    const h = parseHazard(makeHaz({
      defenses: { hp: ({ std: 24 } as unknown) as RawHazard['defenses']['hp'] },
    }))
    expect(h.defenses.hp).toBe(24)
  })

  it('defaults hp to 0 and leaves hardness/bt undefined with an empty defense block', () => {
    const h = parseHazard(makeHaz({ defenses: {} }))
    expect(h.defenses.hp).toBe(0)
    expect(h.defenses.hardness).toBeUndefined()
    expect(h.defenses.bt).toBeUndefined()
    expect(h.defenses.ac).toBe(0)
  })
})

describe('parseHazard - hazardData', () => {
  it('formats structured stealth as "DC N (prof)"', () => {
    const h = parseHazard(makeHaz({ stealth: { dc: 22, minProf: 'expert' } }))
    expect(h.hazardData?.stealth).toBe('DC 22 (expert)')
  })

  it('formats a stealth bonus when no dc is given', () => {
    const h = parseHazard(makeHaz({ stealth: { bonus: 12 } }))
    expect(h.hazardData?.stealth).toBe('+12')
  })

  it('falls back to an em dash when no stealth info exists', () => {
    expect(parseHazard(makeHaz()).hazardData?.stealth).toBe('—')
  })

  it('carries disable / routine / reset from their structured entries', () => {
    const h = parseHazard(makeHaz({
      disable: { entries: ['DC 20 Thievery to disarm'] },
      routine: ['The pit triggers and drops the target.'],
      reset: ['The pit is manually reset.'],
    }))
    expect(h.hazardData?.disable).toBe('DC 20 Thievery to disarm')
    expect(h.hazardData?.routine).toBe('The pit triggers and drops the target.')
    expect(h.hazardData?.reset).toBe('The pit is manually reset.')
  })

  it('reflects the complex flag from raw.complex', () => {
    expect(parseHazard(makeHaz({ complex: true })).hazardData?.complex).toBe(true)
    expect(parseHazard(makeHaz({ complex: false })).hazardData?.complex).toBe(false)
    expect(parseHazard(makeHaz({})).hazardData?.complex).toBe(false)
  })

  it('uses the raw description text as the hazardData description', () => {
    const h = parseHazard(makeHaz({ description: ['A camouflaged pit covered in leaves.'] }))
    expect(h.hazardData?.description).toBe('A camouflaged pit covered in leaves.')
  })
})

describe('parseHazard - abilities and attacks merging', () => {
  it('builds abilities from raw.actions including the activity glyph in the name', () => {
    const h = parseHazard(makeHaz({
      actions: [{
        name: 'Spring',
        activity: { number: 1, unit: 'reaction' },
        traits: ['attack'],
        trigger: 'A creature walks onto the pit.',
        entries: ['The spikes spring up.'],
      }],
    }))
    const spring = h.abilities.find(a => a.name.startsWith('Spring'))
    expect(spring).toBeDefined()
    // name = original + activitySymbol(reaction) => "Spring ↺"
    expect(spring?.name).toBe('Spring ↺')
    expect(spring?.traits).toEqual(['attack'])
    expect(spring?.entries).toBe('The spikes spring up.')
  })

  it('returns an empty abilities list when there are no actions and an empty description', () => {
    expect(parseHazard(makeHaz()).abilities).toEqual([])
  })
})
