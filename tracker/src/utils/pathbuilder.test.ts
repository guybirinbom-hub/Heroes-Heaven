import { describe, it, expect } from 'vitest'
import { parsePathbuilder } from './pathbuilder'

// A minimal-but-realistic Pathbuilder "Export JSON" object. Only the fields the
// parser actually reads are present; everything is derivable by hand so the
// assertions below are exact characterizations of the current behavior.
function makeBuild(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    build: {
      name: 'Seelah',
      level: 5,
      ancestry: 'Human',
      heritage: 'Versatile Heritage',
      class: 'Champion',
      background: 'Acolyte',
      sizeName: 'Medium',
      keyability: 'str',
      abilities: { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
      proficiencies: {
        perception: 4,
        fortitude: 6,
        reflex: 2,
        will: 0,
        athletics: 2,
        arcana: 0,
        classDC: 4,
      },
      lores: [['Warfare', 4]],
      attributes: { ancestryhp: 8, classhp: 10, bonushp: 0, bonushpPerLevel: 0, speed: 25, speedBonus: 0 },
      acTotal: { acTotal: 21 },
      spellCasters: [],
      specials: ['Darkvision', 'Scent', 'Rage'],
      languages: ['Common', 'None Selected'],
      feats: [['Power Attack', null, 'Class Feat', 4]],
      weapons: [{ display: 'Longsword', die: 'd8', damageType: 'slashing', attack: 11 }],
      money: { cp: 5, sp: 3, gp: 20, pp: 1 },
      ...overrides,
    },
  }
}

describe('parsePathbuilder — invalid / wrong-shape input', () => {
  it('returns the error variant (no throw) for null', () => {
    const r = parsePathbuilder(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Pathbuilder export/)
  })

  it('returns the error variant for a non-object (string)', () => {
    const r = parsePathbuilder('garbage')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Pathbuilder export/)
  })

  it('returns the error variant for a number', () => {
    expect(parsePathbuilder(42).ok).toBe(false)
  })

  it('returns the error variant for undefined', () => {
    expect(parsePathbuilder(undefined).ok).toBe(false)
  })

  it('returns the "no build block" error when build is missing', () => {
    const r = parsePathbuilder({ success: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/build/)
  })

  it('returns the "no build block" error when build.name is not a string', () => {
    const r = parsePathbuilder({ build: { name: 123 } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/build/)
  })

  it('returns the "no build block" error when build is not an object', () => {
    expect(parsePathbuilder({ build: 'nope' }).ok).toBe(false)
  })

  it('does not throw on an empty object', () => {
    expect(() => parsePathbuilder({})).not.toThrow()
    expect(parsePathbuilder({}).ok).toBe(false)
  })
})

describe('parsePathbuilder — happy path identity / metadata', () => {
  it('imports name, level and the descriptive fields', () => {
    const r = parsePathbuilder(makeBuild())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.character.name).toBe('Seelah')
    const { sheet, pcStats } = r.character
    expect(sheet.source).toBe('pathbuilder')
    expect(typeof sheet.importedAt).toBe('number')
    expect(sheet.name).toBe('Seelah')
    expect(sheet.level).toBe(5)
    expect(sheet.ancestry).toBe('Human')
    expect(sheet.heritage).toBe('Versatile Heritage')
    expect(sheet.className).toBe('Champion')
    expect(sheet.background).toBe('Acolyte')
    expect(sheet.size).toBe('Medium')
    expect(pcStats.level).toBe(5)
    expect(pcStats.ancestryClass).toBe('Human Champion')
  })

  it('trims the name and falls back to "Unnamed" for blank', () => {
    const r = parsePathbuilder(makeBuild({ name: '   ' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.character.name).toBe('Unnamed')
  })

  it('defaults level to 1 when not a number', () => {
    const r = parsePathbuilder(makeBuild({ level: 'five' }))
    if (r.ok) expect(r.character.sheet.level).toBe(1)
  })
})

describe('parsePathbuilder — ability modifiers', () => {
  it('computes floor((score-10)/2) for each ability', () => {
    const r = parsePathbuilder(makeBuild())
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.abilities).toEqual({ str: 4, dex: 2, con: 3, int: 0, wis: 1, cha: -1 })
    expect(r.character.pcStats.str).toBe(4)
    expect(r.character.pcStats.cha).toBe(-1)
  })

  it('floors odd / low scores toward negative infinity (score 7 -> -2)', () => {
    const r = parsePathbuilder(makeBuild({ abilities: { str: 7 } }))
    if (r.ok) expect(r.character.sheet.abilities?.str).toBe(-2)
  })

  it('treats a missing abilities block as all zero mods', () => {
    const r = parsePathbuilder(makeBuild({ abilities: undefined }))
    if (r.ok) expect(r.character.sheet.abilities).toEqual({ str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 })
  })

  it('treats non-numeric ability values as 0', () => {
    const r = parsePathbuilder(makeBuild({ abilities: { str: '18' } }))
    if (r.ok) expect(r.character.sheet.abilities?.str).toBe(0)
  })
})

describe('parsePathbuilder — perception & saves', () => {
  it('adds level + rank-bonus only when trained or better', () => {
    const r = parsePathbuilder(makeBuild())
    if (!r.ok) throw new Error('expected ok')
    const { perception, saves } = r.character.sheet
    // wis 1, perception rank 4 (expert): 1 + 5 + 4 = 10
    expect(perception).toEqual({ mod: 10, prof: 'E' })
    // con 3, fortitude rank 6 (master): 3 + 5 + 6 = 14
    expect(saves?.fort).toEqual({ mod: 14, prof: 'M' })
    // dex 2, reflex rank 2 (trained): 2 + 5 + 2 = 9
    expect(saves?.ref).toEqual({ mod: 9, prof: 'T' })
    // wis 1, will rank 0 (untrained): no level/rank added -> 1
    expect(saves?.will).toEqual({ mod: 1, prof: 'U' })
  })

  it('mirrors perception/save mods + profs into pcStats', () => {
    const r = parsePathbuilder(makeBuild())
    if (!r.ok) throw new Error('expected ok')
    const p = r.character.pcStats
    expect(p.perceptionMod).toBe(10)
    expect(p.perceptionProf).toBe('E')
    expect(p.fortMod).toBe(14)
    expect(p.fortProf).toBe('M')
    expect(p.refMod).toBe(9)
    expect(p.refProf).toBe('T')
    expect(p.willMod).toBe(1)
    expect(p.willProf).toBe('U')
  })
})

describe('parsePathbuilder — skills & lores', () => {
  it('produces all 16 core skills plus any lores', () => {
    const r = parsePathbuilder(makeBuild())
    if (!r.ok) throw new Error('expected ok')
    const skills = r.character.sheet.skills!
    // 16 core + 1 lore
    expect(Object.keys(skills)).toHaveLength(17)
    // Athletics (str 4), trained (2): 4 + 5 + 2 = 11
    expect(skills['Athletics']).toEqual({ mod: 11, prof: 'T' })
    // Arcana untrained (int 0): 0
    expect(skills['Arcana']).toEqual({ mod: 0, prof: 'U' })
    // A skill not present in proficiencies (e.g. Stealth) defaults to untrained dex
    expect(skills['Stealth']).toEqual({ mod: 2, prof: 'U' })
  })

  it('adds a lore keyed "<name> Lore" computed against the int mod', () => {
    const r = parsePathbuilder(makeBuild())
    if (!r.ok) throw new Error('expected ok')
    const skills = r.character.sheet.skills!
    // Warfare lore rank 4 (expert), int 0: 0 + 5 + 4 = 9
    expect(skills['Warfare Lore']).toEqual({ mod: 9, prof: 'E' })
  })

  it('ignores lore entries with blank / non-string names', () => {
    const r = parsePathbuilder(makeBuild({ lores: [['', 2], [123, 2], ['  ', 4]] }))
    if (!r.ok) throw new Error('expected ok')
    // still just the 16 core skills, no lore added
    expect(Object.keys(r.character.sheet.skills!)).toHaveLength(16)
  })

  it('treats a lore with no/zero rank as untrained (mod = int mod only)', () => {
    const r = parsePathbuilder(makeBuild({ lores: [['Sailing']] }))
    if (!r.ok) throw new Error('expected ok')
    // int 0, rank 0: total(0,0) = 0, prof U
    expect(r.character.sheet.skills!['Sailing Lore']).toEqual({ mod: 0, prof: 'U' })
  })
})

describe('parsePathbuilder — class DC', () => {
  it('computes 10 + keyability mod + level + rank when trained+', () => {
    const r = parsePathbuilder(makeBuild())
    // str key (4), classDC rank 4: 10 + 4 + 5 + 4 = 23
    if (r.ok) expect(r.character.sheet.classDC).toBe(23)
  })

  it('omits level/rank when classDC rank is 0', () => {
    const r = parsePathbuilder(makeBuild({ proficiencies: { classDC: 0 } }))
    // keyability defaults to str but abilities present -> str mod 4; 10 + 4 = 14
    if (r.ok) expect(r.character.sheet.classDC).toBe(14)
  })

  it('falls back to str when keyability is missing', () => {
    const r = parsePathbuilder(makeBuild({ keyability: undefined, proficiencies: { classDC: 4 } }))
    // str mod 4: 10 + 4 + 5 + 4 = 23
    if (r.ok) expect(r.character.sheet.classDC).toBe(23)
  })

  it('uses the chosen keyability (cha) for class DC', () => {
    const r = parsePathbuilder(makeBuild({ keyability: 'cha', proficiencies: { classDC: 4 } }))
    // cha mod -1: 10 + (-1) + 5 + 4 = 18
    if (r.ok) expect(r.character.sheet.classDC).toBe(18)
  })
})

describe('parsePathbuilder — HP & speed', () => {
  it('computes ancestry + (class + con) * level + flats', () => {
    const r = parsePathbuilder(makeBuild())
    // 8 + (10 + 3) * 5 + 0 + 0 = 73
    if (r.ok) expect(r.character.sheet.hpMax).toBe(73)
  })

  it('includes bonushp and bonushpPerLevel', () => {
    const r = parsePathbuilder(makeBuild({
      attributes: { ancestryhp: 8, classhp: 10, bonushp: 6, bonushpPerLevel: 2, speed: 25 },
    }))
    // 8 + (10 + 3) * 5 + 6 + 2 * 5 = 8 + 65 + 6 + 10 = 89
    if (r.ok) expect(r.character.sheet.hpMax).toBe(89)
  })

  it('treats a missing attributes block as zero-everything HP scaled by con*level', () => {
    const r = parsePathbuilder(makeBuild({ attributes: undefined }))
    // 0 + (0 + 3) * 5 = 15
    if (r.ok) expect(r.character.sheet.hpMax).toBe(15)
  })

  it('sums speed + speedBonus and exposes it as a Land speed', () => {
    const r = parsePathbuilder(makeBuild({
      attributes: { ancestryhp: 8, classhp: 10, speed: 25, speedBonus: 10 },
    }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.speeds).toEqual([{ name: 'Land', value: 35 }])
    expect(r.character.pcStats.speed).toBe(35)
  })

  it('yields an empty speeds array when total speed is 0', () => {
    const r = parsePathbuilder(makeBuild({
      attributes: { ancestryhp: 8, classhp: 10, speed: 0, speedBonus: 0 },
    }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.speeds).toEqual([])
    expect(r.character.pcStats.speed).toBeUndefined()
  })
})

describe('parsePathbuilder — AC', () => {
  it('reads acTotal.acTotal', () => {
    const r = parsePathbuilder(makeBuild())
    if (r.ok) expect(r.character.sheet.ac).toBe(21)
  })

  it('leaves ac undefined when acTotal.acTotal is absent', () => {
    const r = parsePathbuilder(makeBuild({ acTotal: {} }))
    if (r.ok) expect(r.character.sheet.ac).toBeUndefined()
  })

  it('leaves ac undefined when acTotal is missing entirely', () => {
    const r = parsePathbuilder(makeBuild({ acTotal: undefined }))
    if (r.ok) expect(r.character.sheet.ac).toBeUndefined()
  })
})

describe('parsePathbuilder — spellcasting', () => {
  it('leaves spell DC/attack undefined with no casters', () => {
    const r = parsePathbuilder(makeBuild())
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.spellDC).toBeUndefined()
    expect(r.character.sheet.spellAttack).toBeUndefined()
    expect(r.character.sheet.spells).toEqual({ cantrips: [], spells: [], focus: [], innate: [] })
  })

  it('computes DC/attack and buckets spells for a single caster', () => {
    const r = parsePathbuilder(makeBuild({
      spellCasters: [{
        ability: 'cha',
        proficiency: 4,
        spells: [
          { spellLevel: 0, list: ['Light', 'Daze'] },
          { spellLevel: 1, list: ['Heal', 'Bless'] },
        ],
      }],
    }))
    if (!r.ok) throw new Error('expected ok')
    // cha -1, prof 4: total = -1 + 5 + 4 = 8; dc = 18
    expect(r.character.sheet.spellAttack).toBe(8)
    expect(r.character.sheet.spellDC).toBe(18)
    expect(r.character.pcStats.spellDC).toBe(18)
    expect(r.character.sheet.spells.cantrips).toEqual(['Light', 'Daze'])
    expect(r.character.sheet.spells.spells).toEqual(['Heal', 'Bless'])
    expect(r.character.sheet.spells.innate).toEqual([])
  })

  it('picks the caster with the highest DC', () => {
    const r = parsePathbuilder(makeBuild({
      spellCasters: [
        { ability: 'cha', proficiency: 2, spells: [] }, // dc = 10 + (-1 + 5 + 2) = 16
        { ability: 'wis', proficiency: 4, spells: [] }, // dc = 10 + (1 + 5 + 4) = 20
      ],
    }))
    // strongest = wis caster, attack = 10
    if (r.ok) {
      expect(r.character.sheet.spellDC).toBe(20)
      expect(r.character.sheet.spellAttack).toBe(10)
    }
  })

  it('routes innate-caster spells into the innate bucket regardless of spellLevel', () => {
    const r = parsePathbuilder(makeBuild({
      spellCasters: [{
        ability: 'cha',
        proficiency: 0, // no DC contribution
        innate: true,
        spells: [
          { spellLevel: 0, list: ['Prestidigitation'] },
          { spellLevel: 2, list: ['Invisibility'] },
        ],
      }],
    }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.spellDC).toBeUndefined()
    expect(r.character.sheet.spells.innate).toEqual(['Prestidigitation', 'Invisibility'])
    expect(r.character.sheet.spells.cantrips).toEqual([])
  })

  it('de-duplicates spell names within a bucket', () => {
    const r = parsePathbuilder(makeBuild({
      spellCasters: [{
        ability: 'int',
        proficiency: 2,
        spells: [
          { spellLevel: 1, list: ['Magic Missile', 'Magic Missile'] },
          { spellLevel: 1, list: ['Magic Missile', 'Shield'] },
        ],
      }],
    }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.spells.spells).toEqual(['Magic Missile', 'Shield'])
  })
})

describe('parsePathbuilder — senses & languages', () => {
  it('classifies specials into precise / imprecise senses and joins them for pcStats', () => {
    const r = parsePathbuilder(makeBuild())
    if (!r.ok) throw new Error('expected ok')
    const senses = r.character.sheet.senses!
    expect(senses.precise).toEqual(['Darkvision'])
    expect(senses.imprecise).toEqual(['Scent'])
    expect(senses.vague).toEqual([])
    expect(r.character.pcStats.senses).toBe('Darkvision, Scent')
  })

  it('leaves pcStats.senses undefined when there are no recognized senses', () => {
    const r = parsePathbuilder(makeBuild({ specials: ['Rage', 'Sudden Charge'] }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.senses).toEqual({ precise: [], imprecise: [], vague: [] })
    expect(r.character.pcStats.senses).toBeUndefined()
  })

  it('filters out "none selected" languages (case-insensitive)', () => {
    const r = parsePathbuilder(makeBuild())
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.languages).toEqual(['Common'])
    expect(r.character.pcStats.languages).toBe('Common')
  })

  it('returns empty languages for a missing/empty list', () => {
    const r = parsePathbuilder(makeBuild({ languages: undefined }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.languages).toEqual([])
    expect(r.character.pcStats.languages).toBeUndefined()
  })
})

describe('parsePathbuilder — feats, weapons & money', () => {
  it('imports tuple-style feats with category and level', () => {
    const r = parsePathbuilder(makeBuild())
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.feats).toEqual([
      { name: 'Power Attack', category: 'Class Feat', level: 4 },
    ])
  })

  it('defaults feat category to "Feat" and level to undefined when absent', () => {
    const r = parsePathbuilder(makeBuild({ feats: [['Toughness']] }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.feats).toEqual([
      { name: 'Toughness', category: 'Feat', level: undefined },
    ])
  })

  it('imports object-style feats by their name property', () => {
    const r = parsePathbuilder(makeBuild({ feats: [{ name: 'Reactive Shield' }] }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.feats).toEqual([
      { name: 'Reactive Shield', category: 'Feat', level: undefined },
    ])
  })

  it('imports weapons, preferring display name and composing damage', () => {
    const r = parsePathbuilder(makeBuild())
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.weapons).toEqual([
      { name: 'Longsword', attack: 11, damage: 'd8 slashing' },
    ])
  })

  it('falls back to name and leaves damage undefined when there is no die', () => {
    const r = parsePathbuilder(makeBuild({ weapons: [{ name: 'Fist' }] }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.weapons).toEqual([
      { name: 'Fist', attack: undefined, damage: undefined },
    ])
  })

  it('skips weapon entries with no usable name', () => {
    const r = parsePathbuilder(makeBuild({ weapons: [{ die: 'd6' }, { name: '   ' }] }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.weapons).toEqual([])
  })

  it('reads money, coercing non-numbers to 0', () => {
    const r = parsePathbuilder(makeBuild())
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.money).toEqual({ cp: 5, sp: 3, gp: 20, pp: 1 })
  })

  it('defaults money to all-zero when missing', () => {
    const r = parsePathbuilder(makeBuild({ money: undefined }))
    if (!r.ok) throw new Error('expected ok')
    expect(r.character.sheet.money).toEqual({ cp: 0, sp: 0, gp: 0, pp: 0 })
  })
})

describe('parsePathbuilder — profRank boundaries', () => {
  it('maps rank bonuses 0/2/4/6/8 to U/T/E/M/L', () => {
    const ranks = (b: Record<string, number>) =>
      parsePathbuilder(makeBuild({ proficiencies: b }))
    const r0 = ranks({ perception: 0 })
    const r2 = ranks({ perception: 2 })
    const r4 = ranks({ perception: 4 })
    const r6 = ranks({ perception: 6 })
    const r8 = ranks({ perception: 8 })
    if (r0.ok) expect(r0.character.sheet.perception?.prof).toBe('U')
    if (r2.ok) expect(r2.character.sheet.perception?.prof).toBe('T')
    if (r4.ok) expect(r4.character.sheet.perception?.prof).toBe('E')
    if (r6.ok) expect(r6.character.sheet.perception?.prof).toBe('M')
    if (r8.ok) expect(r8.character.sheet.perception?.prof).toBe('L')
  })

  it('classifies a bonus of 1 (between untrained and trained) as untrained, mod unchanged', () => {
    // rb = 1 > 0, so total = abil + level + 1, but profRank(1) = 'U'
    const r = parsePathbuilder(makeBuild({ proficiencies: { perception: 1 } }))
    if (!r.ok) throw new Error('expected ok')
    // wis 1: 1 + 5 + 1 = 7, prof reported as 'U'
    expect(r.character.sheet.perception).toEqual({ mod: 7, prof: 'U' })
  })
})
