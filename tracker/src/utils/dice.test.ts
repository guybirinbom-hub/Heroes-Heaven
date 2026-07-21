import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  rollDie,
  parseDice,
  rollDamage,
  rollAttack,
  rollDamageExpr,
  cleanDamageExpr,
  mapPenalty,
  fmtBonus,
} from './dice'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseDice', () => {
  it('parses a full dice expression with positive flat modifier', () => {
    expect(parseDice('2d6+3')).toEqual({ count: 2, sides: 6, flat: 3 })
  })

  it('parses a dice expression with no flat modifier', () => {
    expect(parseDice('1d20')).toEqual({ count: 1, sides: 20, flat: 0 })
  })

  it('parses a dice expression with a negative flat modifier', () => {
    expect(parseDice('3d8-1')).toEqual({ count: 3, sides: 8, flat: -1 })
  })

  it('parses a bare flat number', () => {
    expect(parseDice('5')).toEqual({ count: 0, sides: 0, flat: 5 })
  })

  it('parses a negative bare flat number', () => {
    // parseInt('-7') === -7
    expect(parseDice('-7')).toEqual({ count: 0, sides: 0, flat: -7 })
  })

  it('returns all zeros for an invalid expression', () => {
    expect(parseDice('abc')).toEqual({ count: 0, sides: 0, flat: 0 })
  })

  it('returns all zeros for an empty string', () => {
    expect(parseDice('')).toEqual({ count: 0, sides: 0, flat: 0 })
  })

  it('strips whitespace and is case-insensitive', () => {
    expect(parseDice('  2 D 6 + 3 ')).toEqual({ count: 2, sides: 6, flat: 3 })
  })

  it('uses parseInt fallback when the dice form does not fully match (leading number salvaged)', () => {
    // '2d6 fire' has no whitespace after cleaning -> '2d6fire', regex fails,
    // parseInt('2d6fire') === 2 so it is treated as a flat 2.
    expect(parseDice('2d6 fire')).toEqual({ count: 0, sides: 0, flat: 2 })
  })
})

describe('cleanDamageExpr', () => {
  it('strips a {@damage ...} wrapper keeping the inner expression', () => {
    expect(cleanDamageExpr('{@damage 2d6 fire}')).toBe('2d6 fire')
  })

  it('strips a {@condition name|extra} wrapper keeping the first token only', () => {
    expect(cleanDamageExpr('{@condition Frightened|Frightened 1}')).toBe('Frightened')
  })

  it('strips a generic {@tag value} wrapper without a pipe', () => {
    expect(cleanDamageExpr('{@spell Fireball}')).toBe('Fireball')
  })

  it('trims surrounding whitespace', () => {
    expect(cleanDamageExpr('   2d6+3   ')).toBe('2d6+3')
  })

  it('leaves a plain expression untouched (aside from trimming)', () => {
    expect(cleanDamageExpr('1d8 slashing plus 1d6 fire')).toBe('1d8 slashing plus 1d6 fire')
  })

  it('handles multiple {@damage} wrappers in the same string', () => {
    expect(cleanDamageExpr('{@damage 2d6 fire} plus {@damage 1d4 acid}')).toBe(
      '2d6 fire plus 1d4 acid',
    )
  })
})

describe('mapPenalty', () => {
  it('returns 0 for the first attack', () => {
    expect(mapPenalty(1, false)).toBe(0)
    expect(mapPenalty(1, true)).toBe(0)
  })

  it('returns 0 for attack numbers at or below 1 (boundary)', () => {
    expect(mapPenalty(0, false)).toBe(0)
    expect(mapPenalty(-3, true)).toBe(0)
  })

  it('returns -5 for the second non-agile attack', () => {
    expect(mapPenalty(2, false)).toBe(-5)
  })

  it('returns -4 for the second agile attack', () => {
    expect(mapPenalty(2, true)).toBe(-4)
  })

  it('returns -10 for the third (and beyond) non-agile attack', () => {
    expect(mapPenalty(3, false)).toBe(-10)
    expect(mapPenalty(5, false)).toBe(-10)
  })

  it('returns -8 for the third (and beyond) agile attack', () => {
    expect(mapPenalty(3, true)).toBe(-8)
    expect(mapPenalty(99, true)).toBe(-8)
  })
})

describe('fmtBonus', () => {
  it('prefixes a plus for positive numbers', () => {
    expect(fmtBonus(5)).toBe('+5')
  })

  it('keeps the native minus sign for negative numbers', () => {
    expect(fmtBonus(-3)).toBe('-3')
  })

  it('prefixes a plus for zero', () => {
    expect(fmtBonus(0)).toBe('+0')
  })
})

describe('rollDie', () => {
  it('maps random ~0.5 to the middle face', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    // floor(0.5 * 6) + 1 = 4
    expect(rollDie(6)).toBe(4)
    // floor(0.5 * 20) + 1 = 11
    expect(rollDie(20)).toBe(11)
  })

  it('maps random 0 to the minimum face (1)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(rollDie(20)).toBe(1)
    expect(rollDie(6)).toBe(1)
  })

  it('maps random just under 1 to the maximum face', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    expect(rollDie(20)).toBe(20)
    expect(rollDie(6)).toBe(6)
  })

  it('stays within [1, sides] across many fractional values (invariant)', () => {
    const samples = [0, 0.05, 0.1, 0.3, 0.5, 0.7, 0.9, 0.95, 0.999999]
    for (const r of samples) {
      vi.spyOn(Math, 'random').mockReturnValue(r)
      const v = rollDie(8)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(8)
    }
  })
})

describe('rollDamage', () => {
  it('rolls each die and adds the flat modifier', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    // each d6 -> floor(0.5*6)+1 = 4, two dice = [4,4], +3 => 11
    expect(rollDamage('2d6+3')).toEqual({ rolls: [4, 4], total: 11 })
  })

  it('applies a negative flat modifier', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    // each d8 -> floor(0.5*8)+1 = 5, three dice = [5,5,5]=15, -1 => 14
    expect(rollDamage('3d8-1')).toEqual({ rolls: [5, 5, 5], total: 14 })
  })

  it('rolls distinct dice using a sequence of random values', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0) // floor(0*6)+1 = 1
      .mockReturnValueOnce(0.999999) // floor(~6)+1 = 6
    expect(rollDamage('2d6')).toEqual({ rolls: [1, 6], total: 7 })
  })

  it('returns no rolls but keeps the flat total for a bare number', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(rollDamage('5')).toEqual({ rolls: [], total: 5 })
  })

  it('returns empty rolls and zero total for an invalid expression', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(rollDamage('abc')).toEqual({ rolls: [], total: 0 })
  })
})

describe('rollAttack', () => {
  it('builds a d20 attack result and reports a natural 20 crit', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.95) // floor(0.95*20)+1 = 20
    const r = rollAttack('Sword', 7, -5)
    expect(r.rolls).toEqual([20])
    expect(r.total).toBe(20 + 7 - 5) // 22
    expect(r.modifier).toBe(7 - 5) // 2
    expect(r.isCrit).toBe(true)
    expect(r.isFumble).toBe(false)
    expect(r.isAttack).toBe(true)
    expect(r.label).toBe('Sword')
  })

  it('reports a natural 1 as a fumble (not a crit)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // floor(0*20)+1 = 1
    const r = rollAttack('Claw', 3, 0)
    expect(r.rolls).toEqual([1])
    expect(r.total).toBe(1 + 3) // 4
    expect(r.modifier).toBe(3)
    expect(r.isCrit).toBe(false)
    expect(r.isFumble).toBe(true)
  })

  it('reports neither crit nor fumble for a middling roll', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // floor(0.5*20)+1 = 11
    const r = rollAttack('Bow', 10, -8)
    expect(r.rolls).toEqual([11])
    expect(r.total).toBe(11 + 10 - 8) // 13
    expect(r.modifier).toBe(2)
    expect(r.isCrit).toBe(false)
    expect(r.isFumble).toBe(false)
    expect(r.isAttack).toBe(true)
  })

  it('assigns a non-empty id and a numeric timestamp', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const r = rollAttack('Test', 0, 0)
    expect(typeof r.id).toBe('string')
    expect(r.id.length).toBeGreaterThan(0)
    expect(typeof r.timestamp).toBe('number')
  })

  it('produces strictly increasing ids on successive rolls', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const a = rollAttack('A', 0, 0)
    const b = rollAttack('B', 0, 0)
    expect(Number(b.id)).toBe(Number(a.id) + 1)
  })
})

describe('rollDamageExpr', () => {
  it('rolls a single dice group and totals it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    // 2d6+3 -> [4,4] + 3 = 11
    const r = rollDamageExpr('2d6+3')
    expect(r.rolls).toEqual([4, 4])
    expect(r.total).toBe(11)
    expect(r.label).toBe('Damage')
    expect(r.modifier).toBe(0)
    expect(r.isCrit).toBe(false)
    expect(r.isFumble).toBe(false)
    expect(r.isAttack).toBe(false)
  })

  it("splits on 'plus' and sums every dice group", () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    // '2d6 fire' -> 2d6 = [4,4] = 8 ; '1d4 acid' -> 1d4 floor(0.5*4)+1 = 3 = 3
    const r = rollDamageExpr('2d6 fire plus 1d4 acid')
    expect(r.rolls).toEqual([4, 4, 3])
    expect(r.total).toBe(11)
  })

  it("splits on 'plus' case-insensitively", () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const r = rollDamageExpr('1d6 PLUS 1d6')
    expect(r.rolls).toEqual([4, 4])
    expect(r.total).toBe(8)
  })

  it('strips {@damage} wrappers before rolling', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const r = rollDamageExpr('{@damage 2d6 fire}')
    expect(r.rolls).toEqual([4, 4])
    expect(r.total).toBe(8)
  })

  it('honors a custom label', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const r = rollDamageExpr('1d6', 'Sneak Attack')
    expect(r.label).toBe('Sneak Attack')
  })

  it('includes the dice-form flat modifier of each matched group', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    // '1d6+2' -> [4] + 2 = 6 ; '1d4-1' -> [3] - 1 = 2
    const r = rollDamageExpr('1d6+2 plus 1d4-1')
    expect(r.rolls).toEqual([4, 3])
    expect(r.total).toBe(8)
  })

  it('produces an empty result when no dice group matches', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const r = rollDamageExpr('fire')
    expect(r.rolls).toEqual([])
    expect(r.total).toBe(0)
  })

  it('ignores parts that contain no dice group while summing the rest', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    // first part 'splash' has no dice; second '1d6' -> [4]
    const r = rollDamageExpr('splash plus 1d6')
    expect(r.rolls).toEqual([4])
    expect(r.total).toBe(4)
  })
})
