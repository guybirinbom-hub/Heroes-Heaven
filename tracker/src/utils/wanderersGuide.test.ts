import { describe, it, expect } from 'vitest'
import { parseWanderersGuide } from './wanderersGuide'
import type { ImportResult } from './wanderersGuide'

// ── Helpers ─────────────────────────────────────────────────────────────────
// Narrow the union and fail loudly if we got the wrong variant, so the rest of
// a test can read `.character` without `?.` noise.
function ok(r: ImportResult) {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`)
  return r.character
}
function err(r: ImportResult) {
  if (r.ok) throw new Error('expected error, got ok')
  return r.error
}

// A proficiency entry as WG stores it: a printed "+N" total + a profValue base
// (0/2/4/6/8 → U/T/E/M/L).
const profEntry = (total: number | string, profValue: number) => ({
  total,
  parts: { profValue },
})

describe('parseWanderersGuide — invalid input', () => {
  it('rejects null', () => {
    const r = parseWanderersGuide(null)
    expect(r.ok).toBe(false)
    expect(err(r)).toContain('isn’t a character export')
  })

  it('rejects non-object primitives', () => {
    expect(parseWanderersGuide('hello').ok).toBe(false)
    expect(parseWanderersGuide(42).ok).toBe(false)
    expect(parseWanderersGuide(undefined).ok).toBe(false)
    expect(parseWanderersGuide(true).ok).toBe(false)
  })

  it('rejects an object with no character block', () => {
    const r = parseWanderersGuide({ content: {} })
    expect(r.ok).toBe(false)
    expect(err(r)).toContain('Wanderer’s Guide character JSON')
  })

  it('rejects a character with a non-string name', () => {
    const r = parseWanderersGuide({ character: { name: 123 } })
    expect(r.ok).toBe(false)
    expect(err(r)).toContain('no character data found')
  })

  it('rejects a character whose name is blank/whitespace', () => {
    const r = parseWanderersGuide({ character: { name: '   ' } })
    expect(r.ok).toBe(false)
    expect(err(r)).toBe('The character has no name.')
  })
})

describe('parseWanderersGuide — minimal valid character', () => {
  it('parses just a name with no content block', () => {
    const r = parseWanderersGuide({ character: { name: '  Valeros  ' } })
    const c = ok(r)
    // name is trimmed
    expect(c.name).toBe('Valeros')
    expect(c.sheet.name).toBe('Valeros')
    expect(c.sheet.source).toBe('wanderers-guide')
    expect(typeof c.sheet.importedAt).toBe('number')
    // everything optional stays undefined / empty
    expect(c.sheet.ac).toBeUndefined()
    expect(c.sheet.hpMax).toBeUndefined()
    expect(c.sheet.level).toBeUndefined()
    expect(c.sheet.abilities).toEqual({
      str: undefined, dex: undefined, con: undefined,
      int: undefined, wis: undefined, cha: undefined,
    })
    expect(c.sheet.skills).toEqual({})
    expect(c.sheet.speeds).toEqual([])
    expect(c.sheet.feats).toEqual([])
    expect(c.sheet.weapons).toEqual([])
    expect(c.sheet.spells).toEqual({ cantrips: [], spells: [], focus: [], innate: [] })
    expect(c.sheet.money).toEqual({ cp: 0, sp: 0, gp: 0, pp: 0 })
    expect(c.sheet.senses).toEqual({ precise: [], imprecise: [], vague: [] })
    expect(c.sheet.languages).toEqual([])
    // pcStats subset
    expect(c.pcStats.ancestryClass).toBeUndefined()
    expect(c.pcStats.skills).toBeUndefined() // empty skills → undefined in subset
  })
})

describe('parseWanderersGuide — full character', () => {
  const raw = {
    character: {
      name: 'Seelah',
      level: 5,
      hp_current: 60,
      hp_temp: 5,
      hero_points: 1,
      details: {
        ancestry: { name: 'Human' },
        class: { name: 'Champion' },
        background: { name: 'Acolyte' },
      },
      inventory: { coins: { cp: 3, sp: 7, gp: 120, pp: 2 } },
    },
    content: {
      size: 'Medium',
      ac: 24,
      max_hp: 72,
      proficiencies: {
        SAVE_FORT: profEntry('+13', 6),
        SAVE_REFLEX: profEntry('+9', 2),
        SAVE_WILL: profEntry('+11', 4),
        PERCEPTION: profEntry('+10', 4),
        SKILL_ATHLETICS: profEntry('+14', 6),
        SKILL_RELIGION: profEntry('+11', 4),
        SKILL_LORE_WARFARE: profEntry('+9', 2),
        SKILL_LORE____: profEntry('+0', 0), // generic empty lore → excluded
        CLASS_DC: profEntry('+8', 6),
      },
      attributes: {
        ATTRIBUTE_STR: { value: 5 },
        ATTRIBUTE_DEX: { value: 1 },
        ATTRIBUTE_CON: { value: 3 },
        ATTRIBUTE_INT: { value: 0 },
        ATTRIBUTE_WIS: { value: 2 },
        ATTRIBUTE_CHA: { value: 4 },
      },
      feats_features: {
        heritages: [{ name: 'Skilled Heritage' }],
        classFeatures: [{ name: 'Deity and Cause', level: 1 }],
        classFeats: [{ name: 'Ranged Reprisal', level: 4 }],
        ancestryFeats: [{ name: 'Natural Ambition' }],
        generalAndSkillFeats: [{ name: 'Toughness', level: 3 }],
        otherFeats: [{ name: 'Something Else' }],
      },
      speeds: [
        { name: 'SPEED', value: { value: 25, total: 25 } },
        { name: 'SPEED_FLY', value: { value: 30 } },
        { name: 'SPEED_SWIM', value: { value: 0 } }, // zero → filtered out
      ],
      senses: {
        precise: [{ sense: { name: 'Vision' } }],
        imprecise: [{ sense: { name: 'Hearing' } }],
        vague: [{ sense: { name: 'Scent' } }],
      },
      languages: ['COMMON', 'CELESTIAL'],
      resist_weaks: {
        resists: [{ name: 'fire' }, 'cold'],
        weaks: [{ name: 'good' }],
        immunes: ['disease'],
      },
      weapons: [
        {
          item: { name: 'Longsword' },
          stats: {
            attack_bonus: { total: [16, 11, 6] },
            damage: { dice: 1, die: 'd8', bonus: { total: 4 }, damageType: 'slashing' },
          },
        },
        {
          item: { name: 'Dagger' },
          stats: {
            attack_bonus: { total: 12 },
            damage: { dice: 1, die: 'd4', bonus: { total: 0 }, damageType: 'piercing' },
          },
        },
      ],
      spells: {
        cantrips: [{ name: 'Light' }, { name: 'Shield' }],
        normal: [{ name: 'Heal' }],
      },
      focus_spells: [{ name: 'Lay on Hands' }],
      innate_spells: [{ name: 'Detect Magic' }],
    },
  }

  it('reads identity / level / ancestry / class fields', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.name).toBe('Seelah')
    expect(c.sheet.level).toBe(5)
    expect(c.sheet.ancestry).toBe('Human')
    expect(c.sheet.className).toBe('Champion')
    expect(c.sheet.background).toBe('Acolyte')
    expect(c.sheet.heritage).toBe('Skilled Heritage')
    expect(c.sheet.size).toBe('Medium')
    expect(c.pcStats.ancestryClass).toBe('Human Champion')
    expect(c.pcStats.level).toBe(5)
  })

  it('reads HP / hero points / AC', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.hpCurrent).toBe(60)
    expect(c.sheet.hpMax).toBe(72)
    expect(c.sheet.hpTemp).toBe(5)
    expect(c.sheet.heroPoints).toBe(1)
    expect(c.sheet.ac).toBe(24)
    expect(c.pcStats.ac).toBe(24)
    expect(c.pcStats.maxHP).toBe(72)
  })

  it('maps saves to {mod, prof} with the right proficiency ranks', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.saves).toEqual({
      fort: { mod: 13, prof: 'M' }, // profValue 6 → Master
      ref: { mod: 9, prof: 'T' },   // profValue 2 → Trained
      will: { mod: 11, prof: 'E' }, // profValue 4 → Expert
    })
    expect(c.pcStats.fortMod).toBe(13)
    expect(c.pcStats.fortProf).toBe('M')
    expect(c.pcStats.refProf).toBe('T')
    expect(c.pcStats.willProf).toBe('E')
  })

  it('maps perception', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.perception).toEqual({ mod: 10, prof: 'E' })
    expect(c.pcStats.perceptionMod).toBe(10)
    expect(c.pcStats.perceptionProf).toBe('E')
  })

  it('maps ability modifiers', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.abilities).toEqual({
      str: 5, dex: 1, con: 3, int: 0, wis: 2, cha: 4,
    })
    expect(c.pcStats.str).toBe(5)
    expect(c.pcStats.cha).toBe(4)
  })

  it('maps core skills and named lores, excluding the generic empty lore', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.skills).toEqual({
      Athletics: { mod: 14, prof: 'M' },
      Religion: { mod: 11, prof: 'E' },
      'Warfare Lore': { mod: 9, prof: 'T' },
    })
    // generic SKILL_LORE____ must not appear
    expect(Object.keys(c.sheet.skills ?? {})).not.toContain(' Lore')
    expect(Object.keys(c.sheet.skills ?? {})).toHaveLength(3)
    // non-empty skills carried into pcStats subset
    expect(c.pcStats.skills).toEqual(c.sheet.skills)
  })

  it('computes class DC as 10 + modifier', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.classDC).toBe(18) // 10 + 8
    expect(c.pcStats.classDC).toBe(18)
  })

  it('keeps non-zero speeds, names them, and derives land speed', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.speeds).toEqual([
      { name: 'Land', value: 25 },
      { name: 'Fly', value: 30 },
      // Swim (value 0) filtered out
    ])
    // land speed prefers value.total, else value.value
    expect(c.pcStats.speed).toBe(25)
  })

  it('maps senses by precision category', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.senses).toEqual({
      precise: ['Vision'],
      imprecise: ['Hearing'],
      vague: ['Scent'],
    })
    expect(c.pcStats.senses).toBe('Vision')
  })

  it('title-cases languages', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.languages).toEqual(['Common', 'Celestial'])
    expect(c.pcStats.languages).toBe('Common, Celestial')
  })

  it('reads resistances / weaknesses / immunities (string or {name})', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.resistances).toEqual(['fire', 'cold'])
    expect(c.sheet.weaknesses).toEqual(['good'])
    expect(c.sheet.immunities).toEqual(['disease'])
  })

  it('flattens feats with readable category labels and levels', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.feats).toEqual([
      { name: 'Deity and Cause', category: 'Class Feature', level: 1 },
      { name: 'Ranged Reprisal', category: 'Class Feat', level: 4 },
      { name: 'Natural Ambition', category: 'Ancestry Feat', level: undefined },
      { name: 'Toughness', category: 'General / Skill Feat', level: 3 },
      { name: 'Something Else', category: 'Other', level: undefined },
    ])
  })

  it('parses weapons: attack (first of array or scalar) + damage string', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.weapons).toEqual([
      { name: 'Longsword', attack: 16, damage: '1d8+4 slashing' },
      { name: 'Dagger', attack: 12, damage: '1d4 piercing' },
    ])
  })

  it('collects spells by bucket', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.spells).toEqual({
      cantrips: ['Light', 'Shield'],
      spells: ['Heal'],
      focus: ['Lay on Hands'],
      innate: ['Detect Magic'],
    })
  })

  it('reads coins', () => {
    const c = ok(parseWanderersGuide(raw))
    expect(c.sheet.money).toEqual({ cp: 3, sp: 7, gp: 120, pp: 2 })
  })
})

describe('parseWanderersGuide — proficiency rank thresholds', () => {
  const make = (profValue: number) =>
    parseWanderersGuide({
      character: { name: 'X' },
      content: { proficiencies: { SAVE_FORT: profEntry('+0', profValue) } },
    })

  it('maps 0/2/4/6/8 → U/T/E/M/L', () => {
    expect(ok(make(0)).sheet.saves?.fort?.prof).toBe('U')
    expect(ok(make(2)).sheet.saves?.fort?.prof).toBe('T')
    expect(ok(make(4)).sheet.saves?.fort?.prof).toBe('E')
    expect(ok(make(6)).sheet.saves?.fort?.prof).toBe('M')
    expect(ok(make(8)).sheet.saves?.fort?.prof).toBe('L')
  })

  it('rounds odd/in-between values down to the lower rank', () => {
    expect(ok(make(1)).sheet.saves?.fort?.prof).toBe('U') // <2
    expect(ok(make(7)).sheet.saves?.fort?.prof).toBe('M') // >=6,<8
  })

  it('treats a missing profValue as Untrained', () => {
    const r = parseWanderersGuide({
      character: { name: 'X' },
      content: { proficiencies: { SAVE_FORT: { total: '+3' } } },
    })
    expect(ok(r).sheet.saves?.fort).toEqual({ mod: 3, prof: 'U' })
  })
})

describe('parseWanderersGuide — modifier coercion (toMod)', () => {
  it('parses "+N"/"-N" strings and numeric totals; bad strings → 0', () => {
    const r = parseWanderersGuide({
      character: { name: 'X' },
      content: {
        proficiencies: {
          SAVE_FORT: profEntry('+7', 2),
          SAVE_REFLEX: profEntry('-1', 2),
          SAVE_WILL: profEntry(5, 2),
          PERCEPTION: profEntry('nonsense', 2),
        },
      },
    })
    const c = ok(r)
    expect(c.sheet.saves?.fort?.mod).toBe(7)
    expect(c.sheet.saves?.ref?.mod).toBe(-1)
    expect(c.sheet.saves?.will?.mod).toBe(5)
    expect(c.sheet.perception?.mod).toBe(0)
  })
})

describe('parseWanderersGuide — spell DC / attack branching', () => {
  it('uses SPELL_DC (10 + mod) + SPELL_ATTACK when profValue > 0', () => {
    const r = parseWanderersGuide({
      character: { name: 'X' },
      content: {
        proficiencies: {
          SPELL_DC: profEntry('+18', 4),
          SPELL_ATTACK: profEntry('+10', 4),
        },
      },
    })
    const c = ok(r)
    expect(c.sheet.spellDC).toBe(28)
    expect(c.sheet.spellAttack).toBe(10)
    expect(c.pcStats.spellDC).toBe(28)
  })

  it('ignores SPELL_DC when its profValue is 0 (untrained)', () => {
    const r = parseWanderersGuide({
      character: { name: 'X' },
      content: { proficiencies: { SPELL_DC: profEntry('+0', 0) } },
    })
    expect(ok(r).sheet.spellDC).toBeUndefined()
  })

  it('falls back to INNATE_SPELL_DC; values >= 10 are treated as a full DC', () => {
    const r = parseWanderersGuide({
      character: { name: 'X' },
      content: {
        proficiencies: {
          INNATE_SPELL_DC: profEntry('+19', 4),
          INNATE_SPELL_ATTACK: profEntry('+11', 4),
        },
      },
    })
    const c = ok(r)
    expect(c.sheet.spellDC).toBe(19) // already >= 10 → used as-is
    expect(c.sheet.spellAttack).toBe(11)
  })

  it('falls back to INNATE_SPELL_DC; values < 10 get 10 added', () => {
    const r = parseWanderersGuide({
      character: { name: 'X' },
      content: { proficiencies: { INNATE_SPELL_DC: profEntry('+8', 4) } },
    })
    expect(ok(r).sheet.spellDC).toBe(18) // 10 + 8
  })

  it('leaves spellDC undefined when neither source is present', () => {
    const r = parseWanderersGuide({
      character: { name: 'X' },
      content: { proficiencies: {} },
    })
    expect(ok(r).sheet.spellDC).toBeUndefined()
    expect(ok(r).sheet.spellAttack).toBeUndefined()
  })
})

describe('parseWanderersGuide — weapon edge cases', () => {
  it('skips weapons without an item name', () => {
    const r = parseWanderersGuide({
      character: { name: 'X' },
      content: {
        weapons: [
          { item: {} }, // no name → skipped
          { stats: { attack_bonus: { total: 5 } } }, // no item → skipped
          { item: { name: 'Club' }, stats: {} },
        ],
      },
    })
    const c = ok(r)
    expect(c.sheet.weapons).toEqual([{ name: 'Club', attack: undefined, damage: undefined }])
  })

  it('produces a negative-bonus damage string and omits attack when not finite', () => {
    const r = parseWanderersGuide({
      character: { name: 'X' },
      content: {
        weapons: [
          {
            item: { name: 'Rusty Blade' },
            stats: {
              attack_bonus: { total: 'not-a-number' },
              damage: { dice: 1, die: 'd6', bonus: { total: -2 }, damageType: 'slashing' },
            },
          },
        ],
      },
    })
    const c = ok(r)
    expect(c.sheet.weapons).toEqual([
      { name: 'Rusty Blade', attack: undefined, damage: '1d6-2 slashing' },
    ])
  })
})

describe('parseWanderersGuide — partial / messy content', () => {
  it('handles a content block that is not an object', () => {
    const r = parseWanderersGuide({ character: { name: 'X' }, content: 'oops' })
    const c = ok(r)
    expect(c.sheet.ac).toBeUndefined()
    expect(c.sheet.skills).toEqual({})
  })

  it('derives ancestryClass from whichever of ancestry/class is present', () => {
    const onlyClass = ok(parseWanderersGuide({
      character: { name: 'X', details: { class: { name: 'Wizard' } } },
    }))
    expect(onlyClass.pcStats.ancestryClass).toBe('Wizard')

    const onlyAncestry = ok(parseWanderersGuide({
      character: { name: 'X', details: { ancestry: { name: 'Elf' } } },
    }))
    expect(onlyAncestry.pcStats.ancestryClass).toBe('Elf')
  })

  it('coerces missing coins to 0', () => {
    const r = parseWanderersGuide({ character: { name: 'X', inventory: { coins: { gp: 10 } } } })
    expect(ok(r).sheet.money).toEqual({ cp: 0, sp: 0, gp: 10, pp: 0 })
  })

  it('falls back to value.value for land speed when total is absent', () => {
    const r = parseWanderersGuide({
      character: { name: 'X' },
      content: { speeds: [{ name: 'SPEED', value: { value: 20 } }] },
    })
    expect(ok(r).pcStats.speed).toBe(20)
  })

  it('title-cases unknown speed names that are not in the SPEED_NAME map', () => {
    const r = parseWanderersGuide({
      character: { name: 'X' },
      content: { speeds: [{ name: 'SPEED_TELEPORT', value: { value: 60 } }] },
    })
    expect(ok(r).sheet.speeds).toEqual([{ name: 'Speed Teleport', value: 60 }])
  })
})
