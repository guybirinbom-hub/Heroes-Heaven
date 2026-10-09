import { describe, it, expect } from 'vitest'
import {
  computeEncounter, DIFFICULTY_COLOR, partyOf, classify, sidesOf, budgetFor, describeParty, XP_BUDGET_ROWS,
  isRowOfPartyNpc, pcLevelOf, type PartyNpcRef,
} from './encounter'
import { partyLevelRule, derivePartyLevel } from './partyLevel'
import { effectiveLevel } from './weakElite'
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

// ─────────────────────────────────────────────────────────────────────────────
// Owner's list 2026-10-01, item 5: "the difficulty calculator needs to look at each party player and
// npc and calculate according to their lv. the calculation is only for the ones in the tracker not
// the ones sitting in the party dashboard." Party level per GM Core pg. 57 (Archives rules-2653);
// each member is one more character (GM Core pg. 76 rules-2719, pg. 21 rules-2521, pg. 205
// rules-3100); thresholds per GM Core pg. 75 Table 10-1 (rules-2717). Synthetic names only.
// ─────────────────────────────────────────────────────────────────────────────

const pc = (name: string, over: Partial<Combatant> = {}) =>
  makeCombatant({ name, isPC: true, creature: null, ...over })
const ally = (name: string, level: number, over: Partial<Combatant> = {}) =>
  makeCombatant({ name, isAlly: true, creature: makeCreature({ id: `cr-${name}`, name, level }), ...over })
/** A party NPC as 'pf2e-parties' holds it, linked to a stat block. */
const npcRef = (id: string, name: string, creatureName = name, creatureId = `cr-${creatureName}`): PartyNpcRef =>
  ({ id, name, memberType: 'npc', creature: { id: creatureId, name: creatureName } })
/** A row the OLD Add-combatants route left on boards: a party NPC with no ally flag and no stamp. */
const legacyNpcRow = (name: string, level: number, creatureName = name) =>
  makeCombatant({ name, creature: makeCreature({ id: `cr-${creatureName}`, name: creatureName, level }) })

describe('partyLevelRule — GM Core pg. 57 (rules-2653)', () => {
  it('a level party is its level, with nobody extra', () => {
    expect(partyLevelRule([5, 5, 5, 5])).toEqual({ level: 5, extra: 0 })
  })
  it('"Use the highest level if only one or two characters are behind"', () => {
    expect(partyLevelRule([5, 5, 5, 4])).toEqual({ level: 5, extra: 0 })
    expect(partyLevelRule([6, 6, 5, 4])).toEqual({ level: 6, extra: 0 })
  })
  it('"or an average if everyone is at a different level" (rounded)', () => {
    // 4,5,6,7: three behind the top → the average 5.5 → 6, not the highest (7).
    expect(partyLevelRule([4, 5, 6, 7])).toEqual({ level: 6, extra: 0 })
  })
  // The orchestrator's ruling for item 5: highest-if-one-or-two-behind else the rounded average,
  // THEN +1 member per 2 levels for anyone 2+ above that level — no separate "lone member ahead"
  // step first (round 1 had one, and it let a weaker member drag the level down to its own).
  it('the choice first, then +1 member per 2 levels for anyone 2+ above it', () => {
    expect(partyLevelRule([5, 5, 5, 7])).toEqual({ level: 6, extra: 0 })   // three behind → 5.5 → 6
    expect(partyLevelRule([5, 5, 5, 8])).toEqual({ level: 6, extra: 1 })   // 5.75 → 6; 8 is 2 above
    expect(partyLevelRule([3, 3, 3, 3, 7])).toEqual({ level: 4, extra: 1 }) // 3.8 → 4; 7 is 3 above
    expect(partyLevelRule([5, 5, 9])).toEqual({ level: 9, extra: 0 })       // two behind → the highest
  })
  it('a weaker member never counts for less than one, nor pulls the level down (print scales nobody down)', () => {
    expect(partyLevelRule([5, 5, 5, 5, 1])).toEqual({ level: 5, extra: 0 })
    // A level-5 PC with a level-1 hireling: one behind → 5, not the hireling's 1 with two extras.
    expect(partyLevelRule([5, 1])).toEqual({ level: 5, extra: 0 })
  })
  it('no usable level → null, so the caller keeps its own fallback', () => {
    expect(partyLevelRule([])).toBeNull()
    expect(partyLevelRule([NaN])).toBeNull()
    expect(partyLevelRule([5, NaN, 5])).toEqual({ level: 5, extra: 0 })
  })
  it('the campaign roster fallback (derivePartyLevel) follows the same page', () => {
    // One or two behind → the highest (a plain rounded average said 5 for 6, 6, 5, 4: 5.25 → 5).
    expect(derivePartyLevel([6, 6, 5, 4])).toBe(6)
    expect(derivePartyLevel([5, 5, 5, 4])).toBe(5)
    expect(derivePartyLevel([5, 5, 5, 8])).toBe(6)
  })
})

describe('effectiveLevel — the board level a party NPC counts at', () => {
  it('scaled wins, else elite +1 / weak −1, else printed', () => {
    const cr = makeCreature({ level: 5 })
    expect(effectiveLevel(cr, {})).toBe(5)
    expect(effectiveLevel(cr, { isElite: true })).toBe(6)
    expect(effectiveLevel(cr, { isWeak: true })).toBe(4)
    expect(effectiveLevel(cr, { scaledToLevel: 9, isElite: true })).toBe(9)
    // A hand-written save's `scaledToLevel: null` means unscaled (adjustedCreature's `!= null`).
    expect(effectiveLevel(cr, { scaledToLevel: null })).toBe(5)
  })
  it('an unchecked snapshot with no numeric level gives NaN, never a string sum', () => {
    const bad = { level: '5' } as unknown as Creature
    expect(Number.isNaN(effectiveLevel(bad, {}))).toBe(true)
    expect(Number.isNaN(effectiveLevel({} as unknown as Creature, { isElite: true }))).toBe(true)
  })
})

describe('sidesOf / classify — who is the party, who is the opposition', () => {
  it('a stat-blocked ally is one of the party and adds no XP', () => {
    expect(classify(ally('Hired Blade', 5))).toBe('ally')
    const r = computeEncounter([ally('Hired Blade', 5), enemyAtLevel(5)], 5, 4)
    expect(r.xp).toBe(40)
    expect(r.enemyCount).toBe(1)
  })
  it('a party NPC without a stat block is ignored on both sides', () => {
    const nameOnly = makeCombatant({ name: 'Lantern Boy', isAlly: true, creature: null })
    expect(classify(nameOnly)).toBe('ignored')
    expect(partyOf([nameOnly, pc('Wren Ashdown')], { fallback: 5 }).size).toBe(1)
  })
  it('a row the party add stamped is the party member, flag or no flag', () => {
    expect(classify(makeCombatant({ partyMemberId: 'p-npc', creature: makeCreature({ level: 5 }) }))).toBe('ally')
  })
  it('HEALS a board saved by the old Add-combatants route: an unflagged party NPC counts as the ally it is', () => {
    const row = legacyNpcRow('Hired Blade', 5, 'Sellsword')
    const party = [npcRef('p-npc', 'Hired Blade', 'Sellsword')]
    expect(classify(row)).toBe('enemy')          // without the party, it is what the row says
    expect(classify(row, party)).toBe('ally')    // with it, the party NPC it really is
    expect(computeEncounter([row, enemyAtLevel(7)], 5, 5, party).xp).toBe(80)
    // The heal is a reading, never a write: the row itself is untouched.
    expect(row.isAlly).toBe(false)
  })
  it('the heal matches the stat block too, not just the name', () => {
    const imposter = legacyNpcRow('Hired Blade', 5, 'Bandit Captain')
    expect(classify(imposter, [npcRef('p-npc', 'Hired Blade', 'Sellsword')])).toBe('enemy')
  })
  it('each party NPC heals at most ONE row', () => {
    // Two unflagged rows that both match the hireling: only one of them can be it.
    const sides = sidesOf([legacyNpcRow('Hired Blade', 5, 'Sellsword'), legacyNpcRow('Hired Blade', 5, 'Sellsword')], [npcRef('p-npc', 'Hired Blade', 'Sellsword')])
    expect(sides).toEqual(['ally', 'enemy'])
  })
  it('no heal at all when that party NPC is already on the board as an ally', () => {
    const stampedRow = makeCombatant({ name: 'Hired Blade', isAlly: true, partyMemberId: 'p-npc', creature: makeCreature({ id: 'cr-Sellsword', name: 'Sellsword', level: 5 }) })
    const second = legacyNpcRow('Hired Blade', 5, 'Sellsword')
    expect(sidesOf([stampedRow, second], [npcRef('p-npc', 'Hired Blade', 'Sellsword')])).toEqual(['ally', 'enemy'])
  })
  // Refuter P1 (round 1): an NPC named after its own stat block sits on the party page, NOT in the
  // fight; a hostile copy of that creature is. The heal read the hostile row as the NPC — the badge
  // vanished for a 4-PC fight (no enemies left). Fails without looksLikePartyNpc's "named after its
  // own block" refusal.
  it('an NPC named after its own stat block heals nothing: a hostile copy of that creature stays an enemy', () => {
    const party = [npcRef('p-gob', 'Goblin Warrior')]
    const fight = [pc('A1'), pc('A2'), pc('A3'), pc('A4'), legacyNpcRow('Goblin Warrior', 1)]
    expect(sidesOf(fight, party)).toEqual(['pc', 'pc', 'pc', 'pc', 'enemy'])
    const p = partyOf(fight, { fallback: 1, partyNpcs: party })
    expect(p.size).toBe(4)
    expect(computeEncounter(fight, p.level, p.size, party).enemyCount).toBe(1)
  })
  // Refuter P3 (round 1): a JSON null is no stamp. Fails if sidesOf tests `!== undefined` again.
  it('a `partyMemberId: null` row is rated by what it is, not as a party member', () => {
    const row = makeCombatant({ partyMemberId: null as unknown as string, creature: makeCreature({ level: 5 }) })
    expect(classify(row)).toBe('enemy')
  })
  it('isRowOfPartyNpc: the stamp, or an older row that is plainly that NPC — never a hostile namesake', () => {
    const hireling = npcRef('p-npc', 'Hired Blade', 'Sellsword')
    const gob = npcRef('p-gob', 'Goblin Warrior')
    expect(isRowOfPartyNpc(makeCombatant({ partyMemberId: 'p-npc', name: 'Renamed' }), hireling)).toBe(true)
    expect(isRowOfPartyNpc(makeCombatant({ partyMemberId: 'other', name: 'Hired Blade' }), hireling)).toBe(false)
    expect(isRowOfPartyNpc(legacyNpcRow('Hired Blade', 5, 'Sellsword'), hireling)).toBe(true)
    expect(isRowOfPartyNpc(makeCombatant({ name: 'Hired Blade', isAlly: true, creature: null }), hireling)).toBe(true)
    expect(isRowOfPartyNpc(legacyNpcRow('Goblin Warrior', 1), gob)).toBe(false)
    expect(isRowOfPartyNpc(makeCombatant({ name: 'Hired Blade', isPC: true, creature: null }), hireling)).toBe(false)
  })
})

describe('partyOf — the members IN THE ORDER, each at their own level', () => {
  it('counts nobody when nobody is in the fight (the roster is not the fight)', () => {
    const p = partyOf([enemyAtLevel(5)], { fallback: 5 })
    expect(p.size).toBe(0)
    expect(p.members).toEqual([])
  })
  it("a PC counts at the host's level for them, else at the fallback", () => {
    const lv: Record<string, number> = { 'Wren Ashdown': 5, 'Odo Fenwick': 0 }
    const p = partyOf([pc('Wren Ashdown'), pc('Odo Fenwick'), pc('Pell Marsh')], { pcLevel: c => lv[c.name], fallback: 4 })
    // 0 is no level (a sheet that never got one) → the fallback, like a PC the host doesn't know.
    expect(p.members.map(m => m.level)).toEqual([5, 4, 4])
    expect(p.level).toBe(5)  // two behind → the highest (pg. 57)
  })
  it('a party NPC counts at its stat block’s EFFECTIVE level, and every member is +1', () => {
    const p = partyOf([pc('Wren Ashdown'), ally('Hired Blade', 5, { isElite: true })], { fallback: 6 })
    expect(p.members.map(m => [m.name, m.level, m.isPC])).toEqual([['Wren Ashdown', 6, true], ['Hired Blade', 6, false]])
    expect(p.size).toBe(2)
  })
  it('a party NPC whose snapshot has no numeric level still counts as a member, but does not set the level', () => {
    const broken = makeCombatant({ name: 'Odd Snapshot', isAlly: true, creature: { name: 'Odd Snapshot' } as unknown as Creature })
    const p = partyOf([pc('Wren Ashdown'), broken], { fallback: 3 })
    expect(p.members.map(m => m.level)).toEqual([3, null])
    expect(p.size).toBe(2)
    expect(p.level).toBe(3)
  })
  it('a defeated member is left out, as the party size always left them out', () => {
    expect(partyOf([pc('Wren Ashdown', { isDefeated: true }), pc('Pell Marsh')], { fallback: 5 }).size).toBe(1)
  })
  // Refuter P6 (round 1): every party member defeated → size 0, and the badge (gated on size) went
  // away mid-fight. `inOrder` still counts them, and the badge is gated on it. Fails if partyOf
  // stops counting the defeated in inOrder.
  it('a party knocked flat is still in the fight (inOrder), though not in the size', () => {
    const p = partyOf([pc('Wren Ashdown', { isDefeated: true }), ally('Hired Blade', 5, { isDefeated: true }), enemyAtLevel(5)], { fallback: 5 })
    expect([p.inOrder, p.size]).toEqual([2, 0])
    expect(partyOf([enemyAtLevel(5)], { fallback: 5 }).inOrder).toBe(0)
  })
  // Refuter round 2, finding 1: the level was taken over the STANDING members only, so a PC going
  // down re-priced every enemy mid-fight (6/5/5/5 → level 5, 80 XP; one 5 down → 6/5/5 → level 6,
  // 60 XP). computeEncounter's rule: "the XP shown … must stay fixed as creatures drop to 0 HP".
  // Fails if partyOf takes the level over the standing members again.
  it('a member going down never moves the party level, so the XP holds still mid-fight', () => {
    const lv: Record<string, number> = { A1: 6, A2: 5, A3: 5, A4: 5 }
    const rate = (fight: Combatant[]) => {
      const p = partyOf(fight, { pcLevel: c => lv[c.name], fallback: 1 })
      return { p, r: computeEncounter(fight, p.level, Math.max(1, p.size + p.extra)) }
    }
    const before = rate([pc('A1'), pc('A2'), pc('A3'), pc('A4'), enemyAtLevel(7)])
    const after = rate([pc('A1'), pc('A2'), pc('A3', { isDefeated: true }), pc('A4'), enemyAtLevel(7)])
    expect([before.p.level, before.r.xp]).toEqual([5, 80])
    expect([after.p.level, after.r.xp]).toEqual([5, 80])
    expect([before.p.size, after.p.size]).toEqual([4, 3])
    // Everyone down: still the same level, not the fallback.
    const flat = rate([pc('A1', { isDefeated: true }), pc('A2', { isDefeated: true }), pc('A3', { isDefeated: true }), pc('A4', { isDefeated: true }), enemyAtLevel(7)])
    expect([flat.p.level, flat.r.xp]).toEqual([5, 80])
  })
  // The extras follow the size: a member who is down adds neither itself nor its extras. Fails if
  // partyOf counts the extras over every member.
  it('a defeated member 2+ above the party level adds no extra member', () => {
    const fight = [pc('A1'), pc('A2'), pc('A3'), ally('Old Knight', 9, { isDefeated: true })]
    const p = partyOf(fight, { fallback: 5 })
    expect([p.level, p.size, p.extra]).toEqual([6, 3, 0])
    const up = partyOf([pc('A1'), pc('A2'), pc('A3'), ally('Old Knight', 9)], { fallback: 5 })
    expect([up.level, up.size, up.extra]).toEqual([6, 4, 1])
  })
  it('a member 2+ levels above the party level counts as an extra member per 2 levels', () => {
    // Three level-5 PCs and a level-9 knight: three behind → the average 6; 9 is 3 above → +1.
    const p = partyOf([pc('A1'), pc('A2'), pc('A3'), ally('Old Knight', 9)], { fallback: 5 })
    expect(p.level).toBe(6)
    expect(p.extra).toBe(1)
    expect(budgetFor(p.size + p.extra).low).toBe(60 + 1 * 20)
  })
  it('the owner’s case: four level-5 PCs and a level-5 party NPC against a level-7 enemy is 80 XP, Low', () => {
    const fight = [pc('A1'), pc('A2'), pc('A3'), pc('A4'), ally('Hired Blade', 5), enemyAtLevel(7)]
    const p = partyOf(fight, { fallback: 5 })
    expect([p.size, p.level, p.extra]).toEqual([5, 5, 0])
    const r = computeEncounter(fight, p.level, p.size + p.extra)
    expect([r.xp, r.difficulty]).toEqual([80, 'Low'])
  })
  it('…and a board saved by the old route rates the same once healed (it read 120 XP, Severe)', () => {
    const party = [npcRef('p-npc', 'Hired Blade', 'Sellsword')]
    const fight = [pc('A1'), pc('A2'), pc('A3'), pc('A4'), legacyNpcRow('Hired Blade', 5, 'Sellsword'), enemyAtLevel(7)]
    const p = partyOf(fight, { fallback: 5, partyNpcs: party })
    expect(p.size).toBe(5)
    const r = computeEncounter(fight, p.level, p.size + p.extra, party)
    expect([r.xp, r.difficulty]).toEqual([80, 'Low'])
    // What the old rating made of it: the NPC's 40 XP added, the party one short.
    const old = computeEncounter(fight, 5, 4)
    expect([old.xp, old.difficulty]).toEqual([120, 'Severe'])
  })
})

describe('the budget table, one copy', () => {
  it('budgetFor matches computeEncounter’s thresholds (GM Core pg. 75)', () => {
    expect(budgetFor(5)).toEqual({ trivial: 50, low: 80, moderate: 100, severe: 150, extreme: 200 })
    expect(budgetFor(5)).toEqual(computeEncounter([], 1, 5).budget)
  })
  it('Low adjusts by 20 per character, not the legacy Core Rulebook 15', () => {
    expect(XP_BUDGET_ROWS.find(r => r[0] === 'Low')).toEqual(['Low', 60, 20])
  })
})

describe('describeParty — what the "i" table says was counted', () => {
  it('names the PCs and NPCs with their levels, the party level and the extras', () => {
    const p = partyOf([pc('A1'), pc('A2'), pc('A3'), ally('Hired Blade', 6)], {
      pcLevel: c => ({ A1: 5, A2: 5, A3: 4 } as Record<string, number>)[c.name], fallback: 1,
    })
    expect(describeParty(p)).toBe('3 PCs (5, 5, 4) + 1 NPC (6) → party level 5, +0 extra')
  })
  it('says how many are down — they still chose the level', () => {
    const p = partyOf([pc('A1', { isDefeated: true }), pc('A2')], { pcLevel: () => 5, fallback: 1 })
    expect(describeParty(p)).toBe('2 PCs (5, 5), 1 down → party level 5, +0 extra')
  })
})

// Refuter round 2, finding 3: a PC's own level was only ever asked of the host, so in the
// standalone tracker an imported (Wanderer's Guide) or typed `pcStats.level` was ignored and every
// PC counted at the typed party level. And a PC renamed after joining the order (the party mirror
// renames its player in place; the row keeps the old name) lost its sheet's level.
describe('pcLevelOf — a PC row’s own level', () => {
  const players = [
    { id: 'pl-1', name: 'Wren Ashdown', memberType: 'pc' as const, charId: 'ch-1', pcStats: { level: 7 } },
    { id: 'pl-2', name: 'Pell Marsh', memberType: 'pc' as const, pcStats: { level: 3 } },
    { id: 'pl-3', name: 'Odo Fenwick', memberType: 'pc' as const },
    { id: 'pl-n', name: 'Hired Blade', memberType: 'npc' as const, pcStats: { level: 9 } },
  ]
  it("the player's own stat sheet when there is no host (the standalone tracker)", () => {
    expect(pcLevelOf(pc('Pell Marsh'), players)).toBe(3)
    expect(pcLevelOf(pc('pell marsh '), players)).toBe(3)        // the tracker's name join
    expect(pcLevelOf(pc('Odo Fenwick'), players)).toBeUndefined() // no level anywhere → partyOf's fallback
    expect(pcLevelOf(pc('Hired Blade'), players)).toBeUndefined()  // an NPC player is never a PC's
    const p = partyOf([pc('Wren Ashdown'), pc('Pell Marsh'), pc('Odo Fenwick')], { pcLevel: c => pcLevelOf(c, players), fallback: 4 })
    expect(p.members.map(m => m.level)).toEqual([7, 3, 4])
  })
  it("the host's sheet outranks the stored one", () => {
    expect(pcLevelOf(pc('Wren Ashdown'), players, n => (n === 'Wren Ashdown' ? 8 : undefined))).toBe(8)
    // A host with no usable level for them (0, NaN) falls through to the stored sheet.
    expect(pcLevelOf(pc('Wren Ashdown'), players, () => NaN)).toBe(7)
  })
  it('a renamed row finds its player by the stamp, then by charId — and the host by the player’s name', () => {
    const host = (n: string) => (n === 'Wren Ashdown' ? 8 : undefined)
    expect(pcLevelOf(pc('Old Name', { partyMemberId: 'pl-1' }), players, host)).toBe(8)
    expect(pcLevelOf(pc('Old Name', { charId: 'ch-1' }), players, host)).toBe(8)
    expect(pcLevelOf(pc('Old Name'), players, host)).toBeUndefined()
  })
})
