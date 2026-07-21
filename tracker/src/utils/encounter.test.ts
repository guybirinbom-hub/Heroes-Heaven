import { describe, it, expect } from 'vitest'
import { computeEncounter, DIFFICULTY_COLOR } from './encounter'
import type { Combatant, Creature } from '../types/pf2e'

// ─────────────────────────────────────────────────────────────────────────────
// Minimal fixtures. computeEncounter only reads: c.isPC, c.isAlly, c.creature,
// c.isElite, c.isWeak, c.scaledToLevel, and from the creature: .level,
// .isHazard, .hazardData?.complex. scaleByLevel/applyWeakElite deep-clone the
// creature via JSON.parse(JSON.stringify(...)), so the stub creature must be a
// plain JSON-serialisable object with every field those helpers touch present.
// ─────────────────────────────────────────────────────────────────────────────

function makeCreature(over: Partial<Creature> = {}): Creature {
  return {
    id: 'c1',
    name: 'Stub',
    source: 'TEST',
    level: 1,
    traits: [],
    perception: 0,
    senses: [],
    languages: [],
    skills: {},
    str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
    items: [],
    speed: {},
    attacks: [],
    spellcasting: [],
    abilities: [],
    defenses: {
      ac: 0, fort: 0, ref: 0, will: 0, hp: 10,
      immunities: [], resistances: [], weaknesses: [],
    },
    isHazard: false,
    raw: {} as Creature['raw'],
    ...over,
  } as Creature
}

function makeCombatant(over: Partial<Combatant> = {}): Combatant {
  return {
    id: 'id-' + Math.random().toString(36).slice(2),
    name: 'Combatant',
    creature: makeCreature(),
    isPC: false,
    isAlly: false,
    initiative: null,
    currentHP: 10,
    maxHP: 10,
    tempHP: 0,
    conditions: [],
    isElite: false,
    isWeak: false,
    notes: '',
    isDefeated: false,
    ...over,
  } as Combatant
}

/** An enemy combatant whose creature sits at the given level. */
function enemyAtLevel(level: number, over: Partial<Combatant> = {}): Combatant {
  return makeCombatant({ creature: makeCreature({ level }), ...over })
}

describe('computeEncounter — empty lineup', () => {
  it('returns the canonical empty result for party size 4', () => {
    const r = computeEncounter([], 1, 4)
    expect(r.xp).toBe(0)
    expect(r.difficulty).toBe('Trivial')
    expect(r.enemyCount).toBe(0)
    expect(r.award).toBe(40)
  })

  it('exposes the size-4 budget thresholds (40/60/80/120/160)', () => {
    const r = computeEncounter([], 1, 4)
    expect(r.budget).toEqual({
      trivial: 40, low: 60, moderate: 80, severe: 120, extreme: 160,
    })
  })
})

describe('computeEncounter — single on-level creature', () => {
  it('an enemy at exactly party level awards 40 XP and stays Trivial', () => {
    const r = computeEncounter([enemyAtLevel(5)], 5, 4)
    expect(r.xp).toBe(40)
    // 40 XP is still below the Low threshold (60) for a party of 4.
    expect(r.difficulty).toBe('Trivial')
    expect(r.enemyCount).toBe(1)
    expect(r.award).toBe(40)
  })
})

describe('computeEncounter — XP-by-level-difference table (size 4)', () => {
  // XP_BY_DIFF: -4:10, -3:15, -2:20, -1:30, 0:40, 1:60, 2:80, 3:120, 4:160
  const partyLevel = 5
  const cases: Array<[number, number]> = [
    [-4, 10], [-3, 15], [-2, 20], [-1, 30],
    [0, 40], [1, 60], [2, 80], [3, 120], [4, 160],
  ]
  for (const [diff, xp] of cases) {
    it(`diff ${diff >= 0 ? '+' : ''}${diff} → ${xp} XP`, () => {
      const r = computeEncounter([enemyAtLevel(partyLevel + diff)], partyLevel, 4)
      expect(r.xp).toBe(xp)
    })
  }
})

describe('computeEncounter — level-difference clamping at ±4', () => {
  const partyLevel = 10
  it('an enemy 5 levels below clamps to diff -4 (10 XP)', () => {
    const r = computeEncounter([enemyAtLevel(partyLevel - 5)], partyLevel, 4)
    expect(r.xp).toBe(10)
  })
  it('an enemy 6 levels below also clamps to diff -4 (10 XP)', () => {
    const r = computeEncounter([enemyAtLevel(partyLevel - 6)], partyLevel, 4)
    expect(r.xp).toBe(10)
  })
  it('an enemy 5 levels above clamps to diff +4 (160 XP)', () => {
    const r = computeEncounter([enemyAtLevel(partyLevel + 5)], partyLevel, 4)
    expect(r.xp).toBe(160)
  })
  it('an enemy 8 levels above also clamps to diff +4 (160 XP)', () => {
    const r = computeEncounter([enemyAtLevel(partyLevel + 8)], partyLevel, 4)
    expect(r.xp).toBe(160)
  })
})

describe('computeEncounter — difficulty boundaries (size 4)', () => {
  const pl = 5
  it('xp just below Low (59) is Trivial; award 40', () => {
    // 30 (diff -1) + 30 (diff -1) = 60 hits Low exactly, so use 40 + 15 = 55:
    // diff 0 (40) + diff -3 (15) = 55 < 60.
    const r = computeEncounter([enemyAtLevel(pl), enemyAtLevel(pl - 3)], pl, 4)
    expect(r.xp).toBe(55)
    expect(r.difficulty).toBe('Trivial')
    expect(r.award).toBe(40)
  })
  it('xp exactly at Low threshold (60) is Low; award 60', () => {
    const r = computeEncounter([enemyAtLevel(pl + 1)], pl, 4) // diff +1 = 60
    expect(r.xp).toBe(60)
    expect(r.difficulty).toBe('Low')
    expect(r.award).toBe(60)
  })
  it('xp exactly at Moderate threshold (80) is Moderate; award 80', () => {
    const r = computeEncounter([enemyAtLevel(pl + 2)], pl, 4) // diff +2 = 80
    expect(r.xp).toBe(80)
    expect(r.difficulty).toBe('Moderate')
    expect(r.award).toBe(80)
  })
  it('xp exactly at Severe threshold (120) is Severe; award 120', () => {
    const r = computeEncounter([enemyAtLevel(pl + 3)], pl, 4) // diff +3 = 120
    expect(r.xp).toBe(120)
    expect(r.difficulty).toBe('Severe')
    expect(r.award).toBe(120)
  })
  it('xp exactly at Extreme threshold (160) is Extreme; award 160', () => {
    const r = computeEncounter([enemyAtLevel(pl + 4)], pl, 4) // diff +4 = 160
    expect(r.xp).toBe(160)
    expect(r.difficulty).toBe('Extreme')
    expect(r.award).toBe(160)
  })
  it('xp one below Moderate (79) stays Low', () => {
    // diff +1 (60) + diff -1 (30) = 90 is too high; use 60 + 15 = 75? no.
    // Aim for 79 is impossible from the table; verify 60..79 stays Low with 60+ (diff -? )
    // 60 (diff+1) + 15 (diff-3) = 75 → still Low (>=60, <80).
    const r = computeEncounter([enemyAtLevel(pl + 1), enemyAtLevel(pl - 3)], pl, 4)
    expect(r.xp).toBe(75)
    expect(r.difficulty).toBe('Low')
    expect(r.award).toBe(60)
  })
})

describe('computeEncounter — party-size scaling', () => {
  it('size 3 shifts each threshold down by its own per-PC adjust (10/20/20/30/40)', () => {
    const r = computeEncounter([], 1, 3)
    expect(r.budget).toEqual({
      trivial: 30, low: 40, moderate: 60, severe: 90, extreme: 120,
    })
  })
  it('size 5 shifts each threshold up by its own per-PC adjust', () => {
    const r = computeEncounter([], 1, 5)
    expect(r.budget).toEqual({
      trivial: 50, low: 80, moderate: 100, severe: 150, extreme: 200,
    })
  })
  it('an 80-XP encounter is Moderate at size 4 but only Low at size 5', () => {
    const pl = 5
    const lineup = [enemyAtLevel(pl + 2)] // diff +2 = 80 XP
    const four = computeEncounter(lineup, pl, 4)
    const five = computeEncounter(lineup, pl, 5)
    expect(four.xp).toBe(80)
    expect(four.difficulty).toBe('Moderate')
    expect(five.xp).toBe(80)
    // size 5: low=80, moderate=100 → 80 is Low.
    expect(five.difficulty).toBe('Low')
    expect(five.award).toBe(60)
  })
  it('award reflects the unscaled (size-4) tier base, not the scaled threshold', () => {
    const pl = 5
    // size 3: extreme threshold = 120. diff +3 = 120 XP → Extreme, award = 160.
    const r = computeEncounter([enemyAtLevel(pl + 3)], pl, 3)
    expect(r.xp).toBe(120)
    expect(r.difficulty).toBe('Extreme')
    expect(r.award).toBe(160)
  })
})

describe('computeEncounter — participant filtering', () => {
  it('excludes PCs', () => {
    const r = computeEncounter(
      [enemyAtLevel(5, { isPC: true }), enemyAtLevel(5)],
      5, 4,
    )
    expect(r.enemyCount).toBe(1)
    expect(r.xp).toBe(40)
  })
  it('excludes allies', () => {
    const r = computeEncounter(
      [enemyAtLevel(5, { isAlly: true }), enemyAtLevel(5)],
      5, 4,
    )
    expect(r.enemyCount).toBe(1)
    expect(r.xp).toBe(40)
  })
  it('excludes name-only NPCs (creature === null)', () => {
    const r = computeEncounter(
      [makeCombatant({ creature: null }), enemyAtLevel(5)],
      5, 4,
    )
    expect(r.enemyCount).toBe(1)
    expect(r.xp).toBe(40)
  })
  it('a defeated enemy STILL counts toward XP and enemyCount', () => {
    const r = computeEncounter(
      [enemyAtLevel(5, { isDefeated: true, currentHP: 0 })],
      5, 4,
    )
    expect(r.enemyCount).toBe(1)
    expect(r.xp).toBe(40)
  })
  it('counts multiple enemies individually', () => {
    const r = computeEncounter(
      [enemyAtLevel(5), enemyAtLevel(5), enemyAtLevel(5)],
      5, 4,
    )
    expect(r.enemyCount).toBe(3)
    expect(r.xp).toBe(120) // 3 × 40
  })
})

describe('computeEncounter — weak / elite shift the effective level', () => {
  const pl = 5
  it('elite raises level by 1, raising XP one column', () => {
    // on-level enemy is diff 0 (40); elite makes it level 6 → diff +1 (60).
    const r = computeEncounter([enemyAtLevel(pl, { isElite: true })], pl, 4)
    expect(r.xp).toBe(60)
  })
  it('weak lowers level by 1, lowering XP one column', () => {
    // on-level enemy is diff 0 (40); weak makes it level 4 → diff -1 (30).
    const r = computeEncounter([enemyAtLevel(pl, { isWeak: true })], pl, 4)
    expect(r.xp).toBe(30)
  })
  it('elite on a +4 enemy still clamps at diff +4 (160 XP)', () => {
    const r = computeEncounter([enemyAtLevel(pl + 4, { isElite: true })], pl, 4)
    expect(r.xp).toBe(160)
  })
  it('when both isElite and isWeak are set, isElite wins (elite branch first)', () => {
    const r = computeEncounter([enemyAtLevel(pl, { isElite: true, isWeak: true })], pl, 4)
    // applyWeakElite is called with 'elite' (isElite checked first) → level +1 → 60.
    expect(r.xp).toBe(60)
  })
})

describe('computeEncounter — scaledToLevel overrides weak/elite and base level', () => {
  const pl = 5
  it('scaledToLevel sets the effective level directly', () => {
    // base level 1 enemy scaled to level 7 → diff +2 (80 XP).
    const r = computeEncounter([enemyAtLevel(1, { scaledToLevel: 7 })], pl, 4)
    expect(r.xp).toBe(80)
  })
  it('scaledToLevel takes precedence over isElite', () => {
    // scaledToLevel:5 → diff 0 (40). Elite would otherwise make it 60.
    const r = computeEncounter(
      [enemyAtLevel(1, { scaledToLevel: 5, isElite: true })],
      pl, 4,
    )
    expect(r.xp).toBe(40)
  })
  it('scaledToLevel equal to base level returns same creature (level unchanged)', () => {
    // scaleByLevel short-circuits when lvlIn === toLvl; eff.level === 5 → diff 0.
    const r = computeEncounter([enemyAtLevel(5, { scaledToLevel: 5 })], pl, 4)
    expect(r.xp).toBe(40)
  })
})

describe('computeEncounter — hazards', () => {
  const pl = 5
  function hazard(level: number, complex: boolean, over: Partial<Combatant> = {}): Combatant {
    const creature = makeCreature({
      level,
      isHazard: true,
      hazardData: {
        description: '', disable: '', complex,
      },
    })
    return makeCombatant({ creature, ...over })
  }

  it('a SIMPLE hazard uses the discounted hazard XP table', () => {
    // SIMPLE_HAZARD_XP_BY_DIFF[0] = 8 for an on-level simple hazard.
    const r = computeEncounter([hazard(pl, false)], pl, 4)
    expect(r.xp).toBe(8)
    expect(r.enemyCount).toBe(1)
  })

  it('a simple hazard at diff +4 awards 32 (clamped, discounted)', () => {
    const r = computeEncounter([hazard(pl + 4, false)], pl, 4)
    expect(r.xp).toBe(32)
  })

  it('a COMPLEX hazard uses the full creature XP table', () => {
    // complex === true is NOT "complex === false", so isSimpleHazard is false →
    // XP_BY_DIFF[0] = 40 for an on-level complex hazard.
    const r = computeEncounter([hazard(pl, true)], pl, 4)
    expect(r.xp).toBe(40)
  })

  it('mixing a simple hazard and a creature sums both tables', () => {
    const r = computeEncounter([hazard(pl, false), enemyAtLevel(pl)], pl, 4)
    expect(r.xp).toBe(8 + 40)
    expect(r.enemyCount).toBe(2)
  })
})

describe('DIFFICULTY_COLOR', () => {
  it('maps every difficulty to a hex colour', () => {
    expect(DIFFICULTY_COLOR.Trivial).toMatch(/^#[0-9a-f]{6}$/i)
    expect(DIFFICULTY_COLOR.Low).toMatch(/^#[0-9a-f]{6}$/i)
    expect(DIFFICULTY_COLOR.Moderate).toMatch(/^#[0-9a-f]{6}$/i)
    expect(DIFFICULTY_COLOR.Severe).toMatch(/^#[0-9a-f]{6}$/i)
    expect(DIFFICULTY_COLOR.Extreme).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
