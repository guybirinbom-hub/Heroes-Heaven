import { describe, it, expect } from 'vitest'
import { applyWeakElite, scaleByLevel } from './weakElite'
import type { Creature } from '../types/pf2e'

// ─────────────────────────────────────────────────────────────────────────────
// Minimal but realistic Creature fixture. Only the fields these two functions
// read are meaningful; the rest satisfy the type. Level 5 "Goblin"-ish stats.
// ─────────────────────────────────────────────────────────────────────────────
function makeCreature(overrides: Partial<Creature> = {}): Creature {
  return {
    id: 'fix-1',
    name: 'Test Goblin',
    source: 'B1',
    level: 5,
    traits: [],
    perception: 12,
    senses: [],
    languages: [],
    skills: { Stealth: 12, Athletics: 8 },
    str: 3, dex: 2, con: 1, int: 0, wis: -1, cha: 2,
    items: [],
    speed: { walk: 25 },
    attacks: [
      {
        range: 'Melee', name: 'Sword', attack: 14, traits: [],
        damage: '2d8+5', types: ['slashing'], effects: [], isAgile: false,
      },
    ],
    spellcasting: [
      { name: 'Arcane', type: 'Spontaneous', DC: 22, attack: 14, spells: '', spellsByLevel: [] },
    ],
    abilities: [],
    defenses: {
      ac: 22, fort: 12, ref: 14, will: 9, hp: 78,
      immunities: [],
      resistances: [{ amount: 5, name: 'fire' }],
      weaknesses: [{ amount: 4, name: 'cold' }],
    },
    isHazard: false,
    raw: {} as Creature['raw'],
    ...overrides,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// applyWeakElite
// ═════════════════════════════════════════════════════════════════════════════
describe('applyWeakElite', () => {
  describe("mode 'normal'", () => {
    it('returns the exact same object reference (no-op)', () => {
      const c = makeCreature()
      const out = applyWeakElite(c, 'normal')
      expect(out).toBe(c)
    })

    it('does not change any value', () => {
      const c = makeCreature()
      const snapshot = JSON.parse(JSON.stringify(c))
      applyWeakElite(c, 'normal')
      expect(c).toEqual(snapshot)
    })
  })

  describe("mode 'elite'", () => {
    it('raises level by exactly 1', () => {
      const out = applyWeakElite(makeCreature({ level: 5 }), 'elite')
      expect(out.level).toBe(6)
    })

    it('adds +2 to AC and all three saving throws', () => {
      const out = applyWeakElite(makeCreature(), 'elite')
      expect(out.defenses.ac).toBe(24)
      expect(out.defenses.fort).toBe(14)
      expect(out.defenses.ref).toBe(16)
      expect(out.defenses.will).toBe(11)
    })

    it('adds +2 to perception and every skill', () => {
      const out = applyWeakElite(makeCreature(), 'elite')
      expect(out.perception).toBe(14)
      expect(out.skills).toEqual({ Stealth: 14, Athletics: 10 })
    })

    it('adds +2 to every attack bonus', () => {
      const out = applyWeakElite(makeCreature(), 'elite')
      expect(out.attacks[0].attack).toBe(16)
    })

    it('adds +2 to spellcasting DC and attack when present', () => {
      const out = applyWeakElite(makeCreature(), 'elite')
      expect(out.spellcasting[0].DC).toBe(24)
      expect(out.spellcasting[0].attack).toBe(16)
    })

    it('adds +2 to every ability modifier', () => {
      const out = applyWeakElite(makeCreature(), 'elite')
      expect(out.str).toBe(5)
      expect(out.dex).toBe(4)
      expect(out.con).toBe(3)
      expect(out.int).toBe(2)
      expect(out.wis).toBe(1)
      expect(out.cha).toBe(4)
    })

    it('does NOT modify resistances or weaknesses', () => {
      const out = applyWeakElite(makeCreature(), 'elite')
      expect(out.defenses.resistances).toEqual([{ amount: 5, name: 'fire' }])
      expect(out.defenses.weaknesses).toEqual([{ amount: 4, name: 'cold' }])
    })

    it('does not mutate the input creature', () => {
      const c = makeCreature()
      const before = JSON.parse(JSON.stringify(c))
      applyWeakElite(c, 'elite')
      expect(c).toEqual(before)
    })

    // HP delta is keyed off the creature's ORIGINAL level:
    //   lv <= 1 -> +10, lv <= 4 -> +15, lv <= 19 -> +20, else +30
    it.each([
      [1, 10],
      [2, 15],
      [4, 15],
      [5, 20],
      [19, 20],
      [20, 30],
      [21, 30],
    ])('elite HP bump at level %i is +%i', (lv, delta) => {
      const out = applyWeakElite(makeCreature({ level: lv, defenses: { ...makeCreature().defenses, hp: 100 } }), 'elite')
      expect(out.defenses.hp).toBe(100 + delta)
    })
  })

  describe("mode 'weak'", () => {
    it('lowers level by exactly 1', () => {
      const out = applyWeakElite(makeCreature({ level: 5 }), 'weak')
      expect(out.level).toBe(4)
    })

    it('subtracts 2 from AC and all three saving throws', () => {
      const out = applyWeakElite(makeCreature(), 'weak')
      expect(out.defenses.ac).toBe(20)
      expect(out.defenses.fort).toBe(10)
      expect(out.defenses.ref).toBe(12)
      expect(out.defenses.will).toBe(7)
    })

    it('subtracts 2 from perception and every skill', () => {
      const out = applyWeakElite(makeCreature(), 'weak')
      expect(out.perception).toBe(10)
      expect(out.skills).toEqual({ Stealth: 10, Athletics: 6 })
    })

    it('subtracts 2 from attack, spell DC, and spell attack', () => {
      const out = applyWeakElite(makeCreature(), 'weak')
      expect(out.attacks[0].attack).toBe(12)
      expect(out.spellcasting[0].DC).toBe(20)
      expect(out.spellcasting[0].attack).toBe(12)
    })

    it('subtracts 2 from every ability modifier', () => {
      const out = applyWeakElite(makeCreature(), 'weak')
      expect(out.str).toBe(1)
      expect(out.dex).toBe(0)
      expect(out.con).toBe(-1)
      expect(out.int).toBe(-2)
      expect(out.wis).toBe(-3)
      expect(out.cha).toBe(0)
    })

    it('does not mutate the input creature', () => {
      const c = makeCreature()
      const before = JSON.parse(JSON.stringify(c))
      applyWeakElite(c, 'weak')
      expect(c).toEqual(before)
    })

    // weak HP delta thresholds (off original level):
    //   lv <= 2 -> -10, lv <= 5 -> -15, lv <= 20 -> -20, else -30
    it.each([
      [1, 10],
      [2, 10],
      [4, 15],
      [5, 15],
      [19, 20],
      [20, 20],
      [21, 30],
    ])('weak HP reduction at level %i is -%i', (lv, delta) => {
      const out = applyWeakElite(makeCreature({ level: lv, defenses: { ...makeCreature().defenses, hp: 100 } }), 'weak')
      expect(out.defenses.hp).toBe(100 - delta)
    })

    it('clamps HP to a minimum of 1 when the reduction would drop it to 0 or below', () => {
      const out = applyWeakElite(
        makeCreature({ level: 1, defenses: { ...makeCreature().defenses, hp: 3 } }),
        'weak',
      )
      // lv1 weak removes 10 -> 3-10 = -7 -> clamped to 1
      expect(out.defenses.hp).toBe(1)
    })
  })

  describe('spellcasting without DC/attack', () => {
    it('leaves an undefined DC/attack as undefined (elite)', () => {
      const c = makeCreature({ spellcasting: [{ name: 'Innate', type: 'Innate', spells: '', spellsByLevel: [] }] })
      const out = applyWeakElite(c, 'elite')
      expect(out.spellcasting[0].DC).toBeUndefined()
      expect(out.spellcasting[0].attack).toBeUndefined()
    })

    it('leaves an undefined DC/attack as undefined (weak)', () => {
      const c = makeCreature({ spellcasting: [{ name: 'Innate', type: 'Innate', spells: '', spellsByLevel: [] }] })
      const out = applyWeakElite(c, 'weak')
      expect(out.spellcasting[0].DC).toBeUndefined()
      expect(out.spellcasting[0].attack).toBeUndefined()
    })
  })

  describe('empty collections', () => {
    it('handles a creature with no attacks, skills, or spellcasting', () => {
      const c = makeCreature({
        attacks: [], skills: {}, spellcasting: [],
        defenses: { ...makeCreature().defenses, resistances: [], weaknesses: [] },
      })
      const out = applyWeakElite(c, 'elite')
      expect(out.attacks).toEqual([])
      expect(out.skills).toEqual({})
      expect(out.spellcasting).toEqual([])
      expect(out.level).toBe(6)
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// scaleByLevel
// ═════════════════════════════════════════════════════════════════════════════
describe('scaleByLevel', () => {
  it('returns the same object reference when target level equals current level', () => {
    const c = makeCreature({ level: 5 })
    expect(scaleByLevel(c, 5)).toBe(c)
  })

  it('does not mutate the input creature', () => {
    const c = makeCreature()
    const before = JSON.parse(JSON.stringify(c))
    scaleByLevel(c, 10)
    expect(c).toEqual(before)
  })

  it('sets the output level to the requested target', () => {
    expect(scaleByLevel(makeCreature(), 10).level).toBe(10)
    expect(scaleByLevel(makeCreature(), 1).level).toBe(1)
    expect(scaleByLevel(makeCreature(), 20).level).toBe(20)
  })

  // ── Characterization snapshots of the PF2eTools scaling algorithm. ──────────
  // These numbers were derived by executing the code; they lock in current
  // behavior across a spread of up/down scaling targets from the lv5 fixture.
  describe('scaling the lv5 fixture down to level 1', () => {
    const out = scaleByLevel(makeCreature(), 1)
    it('scales abilities', () => {
      expect({ str: out.str, dex: out.dex, con: out.con, int: out.int, wis: out.wis, cha: out.cha })
        .toEqual({ str: 2, dex: 1, con: 0, int: -1, wis: -2, cha: 1 })
    })
    it('scales perception, skills, AC, saves', () => {
      expect(out.perception).toBe(7)
      expect(out.skills).toEqual({ Stealth: 6, Athletics: 2 })
      expect(out.defenses.ac).toBe(16)
      expect(out.defenses.fort).toBe(7)
      expect(out.defenses.ref).toBe(9)
      expect(out.defenses.will).toBe(4)
    })
    it('scales HP', () => {
      expect(out.defenses.hp).toBe(21)
    })
    it('scales attack bonus and damage', () => {
      expect(out.attacks[0].attack).toBe(8)
      expect(out.attacks[0].damage).toBe('1d8+1')
    })
    it('scales spellcasting DC and attack', () => {
      expect(out.spellcasting[0].DC).toBe(17)
      expect(out.spellcasting[0].attack).toBe(9)
    })
  })

  describe('scaling the lv5 fixture up to level 10', () => {
    const out = scaleByLevel(makeCreature(), 10)
    it('scales abilities', () => {
      expect({ str: out.str, dex: out.dex, con: out.con, int: out.int, wis: out.wis, cha: out.cha })
        .toEqual({ str: 4, dex: 3, con: 2, int: 1, wis: 0, cha: 3 })
    })
    it('scales perception, skills, AC, saves', () => {
      expect(out.perception).toBe(19)
      expect(out.skills).toEqual({ Stealth: 20, Athletics: 15 })
      expect(out.defenses.ac).toBe(30)
      expect(out.defenses.fort).toBe(19)
      expect(out.defenses.ref).toBe(21)
      expect(out.defenses.will).toBe(16)
    })
    it('scales HP', () => {
      expect(out.defenses.hp).toBe(185)
    })
    it('scales attack bonus and damage', () => {
      expect(out.attacks[0].attack).toBe(22)
      expect(out.attacks[0].damage).toBe('3d8+10')
    })
    it('scales spellcasting DC and attack', () => {
      expect(out.spellcasting[0].DC).toBe(29)
      expect(out.spellcasting[0].attack).toBe(21)
    })
  })

  describe('scaling the lv5 fixture up to level 20', () => {
    const out = scaleByLevel(makeCreature(), 20)
    it('scales abilities', () => {
      expect({ str: out.str, dex: out.dex, con: out.con, int: out.int, wis: out.wis, cha: out.cha })
        .toEqual({ str: 7, dex: 5, con: 5, int: 4, wis: 2, cha: 5 })
    })
    it('scales the headline defenses', () => {
      expect(out.perception).toBe(33)
      expect(out.defenses.ac).toBe(45)
      expect(out.defenses.hp).toBe(400)
      expect(out.attacks[0].attack).toBe(37)
      expect(out.attacks[0].damage).toBe('4d8+22')
      expect(out.spellcasting[0].DC).toBe(42)
      expect(out.spellcasting[0].attack).toBe(34)
    })
  })

  describe('intermediate targets', () => {
    it('scales to level 3', () => {
      const out = scaleByLevel(makeCreature(), 3)
      expect(out.defenses.ac).toBe(19)
      expect(out.defenses.hp).toBe(45)
      expect(out.attacks[0].attack).toBe(11)
      expect(out.attacks[0].damage).toBe('1d8+6')
    })
    it('scales to level 7', () => {
      const out = scaleByLevel(makeCreature(), 7)
      expect(out.defenses.ac).toBe(25)
      expect(out.defenses.hp).toBe(120)
      expect(out.attacks[0].attack).toBe(17)
      expect(out.attacks[0].damage).toBe('2d8+9')
    })
  })

  describe('HP > 100 rounds to nearest 5', () => {
    it('produces an HP value divisible by 5 once it exceeds 100', () => {
      const out = scaleByLevel(makeCreature(), 15)
      expect(out.defenses.hp).toBe(295)
      expect(out.defenses.hp % 5).toBe(0)
    })
  })

  describe('ability mod scaling edge cases', () => {
    it('scales a small negative mod by floor(diff/5) per the code', () => {
      // str -2, dex -5. Scaling lv5 -> lv10 (diff 5):
      //   str: -2 + floor(5/5) = -1
      //   dex < -3 ("extreme penalty") -> left untouched at -5
      const out = scaleByLevel(makeCreature({ str: -2, dex: -5 }), 10)
      expect(out.str).toBe(-1)
      expect(out.dex).toBe(-5)
    })
    it('leaves a small negative mod unchanged when |diff| < 5', () => {
      // lv5 -> lv0, diff = -5, floor(-5/5) = -1 -> -2 + (-1) = -3
      const out = scaleByLevel(makeCreature({ str: -2, dex: -5 }), 0)
      expect(out.str).toBe(-3)
      expect(out.dex).toBe(-5)
    })
  })

  describe('damage scaling shapes', () => {
    it('leaves flat (non-dice) damage untouched but still scales the attack bonus', () => {
      const c = makeCreature({
        attacks: [{ range: 'Melee', name: 'Flat', attack: 14, traits: [], damage: '5', types: [], effects: [], isAgile: false }],
      })
      const out = scaleByLevel(c, 10)
      expect(out.attacks[0].damage).toBe('5')
      expect(out.attacks[0].attack).toBe(22)
    })

    it('passes through an empty damage string and still scales the attack bonus', () => {
      const c = makeCreature({
        attacks: [{ range: 'Melee', name: 'Bite', attack: 14, traits: [], damage: '', types: [], effects: [], isAgile: false }],
      })
      const out = scaleByLevel(c, 10)
      expect(out.attacks[0].damage).toBe('')
      expect(out.attacks[0].attack).toBe(22)
    })

    it('scales a pure dice formula (no flat modifier)', () => {
      const c = makeCreature({
        attacks: [{ range: 'Ranged', name: 'Bow', attack: 14, traits: [], damage: '1d6', types: [], effects: [], isAgile: false }],
      })
      const out = scaleByLevel(c, 10)
      expect(out.attacks[0].damage).toBe('3d6')
    })
  })

  describe('resistances and weaknesses scaling', () => {
    it('scales resistance amounts up using the resistance/weakness table', () => {
      const out = scaleByLevel(makeCreature(), 10)
      expect(out.defenses.resistances).toEqual([{ amount: 9, name: 'fire' }])
    })

    it('scales weakness amounts using the SAME table (preserves name)', () => {
      const out = scaleByLevel(makeCreature(), 10)
      expect(out.defenses.weaknesses).toEqual([{ amount: 9, name: 'cold' }])
    })

    it('clamps a far-down-scaled weakness to a minimum of 1 (never negative)', () => {
      const out = scaleByLevel(makeCreature(), 1)
      // lv5 weakness 4 scaled to lv1 would round to -1; clamped to 1 instead.
      expect(out.defenses.weaknesses[0].amount).toBe(1)
    })
  })

  describe('spellcasting without DC/attack', () => {
    it('keeps undefined DC/attack undefined after scaling', () => {
      const c = makeCreature({ spellcasting: [{ name: 'Innate', type: 'Innate', spells: '', spellsByLevel: [] }] })
      const out = scaleByLevel(c, 10)
      expect(out.spellcasting[0].DC).toBeUndefined()
      expect(out.spellcasting[0].attack).toBeUndefined()
    })
  })

  describe('empty collections', () => {
    it('handles a creature with no attacks/skills/spellcasting/res/weak', () => {
      const c = makeCreature({
        attacks: [], skills: {}, spellcasting: [],
        defenses: { ...makeCreature().defenses, resistances: [], weaknesses: [] },
      })
      const out = scaleByLevel(c, 8)
      expect(out.attacks).toEqual([])
      expect(out.skills).toEqual({})
      expect(out.spellcasting).toEqual([])
      expect(out.defenses.resistances).toEqual([])
      expect(out.defenses.weaknesses).toEqual([])
      expect(out.level).toBe(8)
    })
  })

  describe('internal consistency / invariants', () => {
    it('produces sane monotonic AC across a level sweep (higher level => >= AC)', () => {
      const acs = [1, 3, 5, 7, 10, 15, 20].map(lv => scaleByLevel(makeCreature(), lv).defenses.ac)
      for (let i = 1; i < acs.length; i++) {
        expect(acs[i]).toBeGreaterThanOrEqual(acs[i - 1])
      }
    })

    it('produces sane monotonic HP across a level sweep', () => {
      const hps = [1, 3, 5, 7, 10, 15, 20].map(lv => scaleByLevel(makeCreature(), lv).defenses.hp)
      for (let i = 1; i < hps.length; i++) {
        expect(hps[i]).toBeGreaterThanOrEqual(hps[i - 1])
      }
    })

    it('keeps HP at least 1 even when scaled to the lowest level', () => {
      const out = scaleByLevel(makeCreature({ defenses: { ...makeCreature().defenses, hp: 5 } }), 1)
      expect(out.defenses.hp).toBeGreaterThanOrEqual(1)
    })
  })
})
