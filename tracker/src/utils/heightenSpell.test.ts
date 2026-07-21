import { describe, it, expect } from 'vitest'
import type { SpellInfo } from '../data/dataStore'
import {
  autoHeightenRank,
  heightenSpell,
  applyHeightenedDamage,
  type SpellHeightening,
} from './heightenSpell'

// Minimal SpellInfo factory — only the fields heightenSpell reads
// (name/level/description/heightened/range/area) plus the required type fields.
function spell(partial: Partial<SpellInfo>): SpellInfo {
  return {
    name: 'Test Spell',
    level: 1,
    traits: [],
    description: '',
    ...partial,
  } as SpellInfo
}

describe('autoHeightenRank', () => {
  it('returns ⌈level ÷ 2⌉ for even and odd levels', () => {
    // even halves cleanly
    expect(autoHeightenRank(4)).toBe(2)
    expect(autoHeightenRank(6)).toBe(3)
    expect(autoHeightenRank(20)).toBe(10)
    // odd levels round up
    expect(autoHeightenRank(3)).toBe(2)
    expect(autoHeightenRank(5)).toBe(3)
    expect(autoHeightenRank(7)).toBe(4)
    expect(autoHeightenRank(11)).toBe(6)
    expect(autoHeightenRank(21)).toBe(11)
  })

  it('floors at 1 for very low / zero / negative levels', () => {
    expect(autoHeightenRank(1)).toBe(1)
    expect(autoHeightenRank(2)).toBe(1)
    expect(autoHeightenRank(0)).toBe(1)
    expect(autoHeightenRank(-3)).toBe(1)
  })

  it('never returns below 1 across the full 1..20 range', () => {
    for (let lvl = 1; lvl <= 20; lvl++) {
      const r = autoHeightenRank(lvl)
      expect(r).toBeGreaterThanOrEqual(1)
      expect(r).toBe(Math.max(1, Math.ceil(lvl / 2)))
    }
  })
})

describe('heightenSpell — null cases', () => {
  it('returns null when cast at or below the spell base rank (steps <= 0)', () => {
    const s = spell({
      level: 2,
      description: 'You deal 3d8 acid damage.',
      heightened: { '+2': 'The damage increases by 2d8.' },
    })
    expect(heightenSpell(s, 2)).toBeNull() // equal
    expect(heightenSpell(s, 1)).toBeNull() // below
  })

  it('returns null when the spell has no heightening at all', () => {
    const s = spell({
      level: 1,
      description: 'You deal 2d6 fire damage.',
    })
    expect(heightenSpell(s, 5)).toBeNull()
  })

  it('returns null when heightening exists but has no "+N" interval key', () => {
    // Fixed-rank restatement keys ("4","6") are left to the prose section.
    const s = spell({
      level: 1,
      description: 'You deal 2d6 fire damage.',
      heightened: { '4': 'You instead deal 9d6 fire damage.' },
    })
    expect(heightenSpell(s, 6)).toBeNull()
  })

  it('returns null when the gap is smaller than the interval (applications <= 0)', () => {
    // +2 interval, cast only 1 rank above base -> floor(1/2) = 0 applications.
    const s = spell({
      level: 2,
      description: 'You deal 3d8 acid damage.',
      heightened: { '+2': 'The initial damage increases by 2d8.' },
    })
    expect(heightenSpell(s, 3)).toBeNull()
  })

  it('returns null when nothing numeric can be injected (non-numeric heightening)', () => {
    // Heightening only adds a rider effect — no dice/range/area numbers.
    const s = spell({
      level: 1,
      description: 'The target is dazzled.',
      heightened: { '+2': 'The target is also blinded for 1 round.' },
    })
    expect(heightenSpell(s, 5)).toBeNull()
  })
})

describe('heightenSpell — damage dice scaling', () => {
  it('scales a single damage die (Burning Hands: +1 → +2d6 per step)', () => {
    // Burning Hands: base rank 1, "+1": "+2d6", description has "2d6".
    const s = spell({
      level: 1,
      area: '15-foot cone',
      description: 'You deal 2d6 fire damage to creatures in the area.',
      heightened: { '+1': 'The damage increases by 2d6.' },
    })
    // cast at rank 3 -> steps 2, interval 1, applications 2 -> 2 + 2*2 = 6
    const h = heightenSpell(s, 3)
    expect(h).not.toBeNull()
    expect(h!.rank).toBe(3)
    expect(h!.damage).toEqual([{ from: '2d6', to: '2d6 (6d6)' }])
    // no range/area scaling text -> those stay undefined
    expect(h!.range).toBeUndefined()
    expect(h!.area).toBeUndefined()
  })

  it('applies the interval-floored number of applications (Acid Arrow: +2 → +2d8/+1d6)', () => {
    // Acid Arrow: base rank 2, "+2", two dice in the increment (d8 and d6).
    const s = spell({
      level: 2,
      range: '120 feet',
      description:
        'On a hit, you deal 3d8 acid damage plus 1d6 persistent acid damage.',
      heightened: {
        '+2':
          'The initial damage increases by 2d8, and the persistent acid damage increases by 1d6.',
      },
    })
    // cast at rank 6 -> steps 4, interval 2, applications 2
    // d8: 3 + 2*2 = 7 ; d6: 1 + 2*1 = 3
    const h = heightenSpell(s, 6)
    expect(h).not.toBeNull()
    expect(h!.rank).toBe(6)
    expect(h!.damage).toEqual([
      { from: '3d8', to: '3d8 (7d8)' },
      { from: '1d6', to: '1d6 (3d6)' },
    ])
  })

  it('bumps only the FIRST matching die per die size in the description', () => {
    // Description mentions 2d6 twice; only the first is replaced.
    const s = spell({
      level: 1,
      description: 'You deal 2d6 fire damage, then later 2d6 more fire damage.',
      heightened: { '+1': 'The damage increases by 1d6.' },
    })
    // cast at rank 2 -> applications 1 -> 2 + 1 = 3
    const h = heightenSpell(s, 2)
    expect(h!.damage).toEqual([{ from: '2d6', to: '2d6 (3d6)' }])
  })

  it('dedupes repeated die sizes within the increment text (seenDie)', () => {
    // Increment text lists d6 twice; only one replacement entry is produced.
    const s = spell({
      level: 1,
      description: 'You deal 4d6 fire damage.',
      heightened: { '+1': 'The damage increases by 1d6 and another 1d6.' },
    })
    // applications 1 -> 4 + 1 = 5 ; only one d6 entry
    const h = heightenSpell(s, 2)
    expect(h!.damage).toEqual([{ from: '4d6', to: '4d6 (5d6)' }])
  })

  it('skips a die size in the increment that is absent from the description', () => {
    // Increment mentions d10, but the description has no d10 -> no damage entry,
    // and with nothing else numeric the whole result is null.
    const s = spell({
      level: 1,
      description: 'You deal 2d6 fire damage.',
      heightened: { '+1': 'The damage increases by 1d10.' },
    })
    expect(heightenSpell(s, 4)).toBeNull()
  })
})

describe('heightenSpell — range scaling', () => {
  it('scales a flat "range increases by N feet" increment', () => {
    const s = spell({
      level: 1,
      range: '30 feet',
      description: 'A bolt strikes the target.',
      heightened: { '+1': 'The range increases by 30 feet.' },
    })
    // cast at rank 3 -> applications 2 -> 30 + 2*30 = 90
    const h = heightenSpell(s, 3)
    expect(h).not.toBeNull()
    expect(h!.range).toBe('30 (90) feet')
    expect(h!.damage).toEqual([])
    expect(h!.area).toBeUndefined()
  })

  it('does not scale range when the spell range is non-numeric (e.g. "touch")', () => {
    const s = spell({
      level: 1,
      range: 'touch',
      description: 'A bolt strikes the target.',
      heightened: { '+1': 'The range increases by 30 feet.' },
    })
    expect(heightenSpell(s, 3)).toBeNull()
  })
})

describe('heightenSpell — area scaling', () => {
  it('scales a "<shape> increases by N feet" area increment', () => {
    const s = spell({
      level: 1,
      area: '15-foot cone',
      description: 'Flames fill the area.',
      heightened: { '+1': 'The cone increases by 5 feet.' },
    })
    // cast at rank 3 -> applications 2 -> 15 + 2*5 = 25
    const h = heightenSpell(s, 3)
    expect(h).not.toBeNull()
    expect(h!.area).toBe('15 (25)-foot cone')
    expect(h!.damage).toEqual([])
  })

  it('scales an emanation area written with a space ("20-foot emanation")', () => {
    const s = spell({
      level: 3,
      area: '20-foot emanation',
      description: 'Energy radiates outward.',
      heightened: { '+1': 'The area of the emanation increases by 5 feet.' },
    })
    // cast at rank 5 -> applications 2 -> 20 + 2*5 = 30
    const h = heightenSpell(s, 5)
    expect(h!.area).toBe('20 (30)-foot emanation')
  })

  it('matches the reversed "increases by N feet ... burst" phrasing', () => {
    const s = spell({
      level: 1,
      area: '10-foot burst',
      description: 'A blast erupts.',
      heightened: { '+1': 'The size increases by 5 feet, widening the burst.' },
    })
    // applications 1 -> 10 + 5 = 15
    const h = heightenSpell(s, 2)
    expect(h!.area).toBe('10 (15)-foot burst')
  })
})

describe('heightenSpell — combined scaling', () => {
  it('scales damage, range, and area together', () => {
    const s = spell({
      level: 1,
      range: '30 feet',
      area: '5-foot burst',
      description: 'You deal 1d4 damage in the area.',
      heightened: {
        '+1':
          'The damage increases by 1d4, the range increases by 10 feet, and the burst increases by 5 feet.',
      },
    })
    // cast at rank 3 -> applications 2
    const h = heightenSpell(s, 3)
    expect(h!.rank).toBe(3)
    expect(h!.damage).toEqual([{ from: '1d4', to: '1d4 (3d4)' }]) // 1 + 2*1 = 3
    expect(h!.range).toBe('30 (50) feet') // 30 + 2*10 = 50
    expect(h!.area).toBe('5 (15)-foot burst') // 5 + 2*5 = 15
  })
})

describe('applyHeightenedDamage', () => {
  it('applies each damage replacement to the description (first occurrence)', () => {
    const h: SpellHeightening = {
      rank: 3,
      damage: [{ from: '2d6', to: '2d6 (6d6)' }],
    }
    const out = applyHeightenedDamage('You deal 2d6 fire damage.', h)
    expect(out).toBe('You deal 2d6 (6d6) fire damage.')
  })

  it('applies multiple replacements in order', () => {
    const h: SpellHeightening = {
      rank: 6,
      damage: [
        { from: '3d8', to: '3d8 (7d8)' },
        { from: '1d6', to: '1d6 (3d6)' },
      ],
    }
    const out = applyHeightenedDamage(
      'Deal 3d8 acid damage plus 1d6 persistent acid damage.',
      h,
    )
    expect(out).toBe(
      'Deal 3d8 (7d8) acid damage plus 1d6 (3d6) persistent acid damage.',
    )
  })

  it('replaces only the first occurrence of each "from" (String.replace semantics)', () => {
    const h: SpellHeightening = {
      rank: 2,
      damage: [{ from: '2d6', to: '2d6 (3d6)' }],
    }
    const out = applyHeightenedDamage('2d6 now, 2d6 later', h)
    expect(out).toBe('2d6 (3d6) now, 2d6 later')
  })

  it('returns the description unchanged when there are no replacements', () => {
    const h: SpellHeightening = { rank: 4, damage: [] }
    const desc = 'A spell with nothing to inject.'
    expect(applyHeightenedDamage(desc, h)).toBe(desc)
  })

  it('round-trips with heightenSpell output', () => {
    const s = spell({
      level: 1,
      description: 'You deal 2d6 fire damage to creatures in the area.',
      area: '15-foot cone',
      heightened: { '+1': 'The damage increases by 2d6.' },
    })
    const h = heightenSpell(s, 3)!
    const out = applyHeightenedDamage(s.description, h)
    expect(out).toBe('You deal 2d6 (6d6) fire damage to creatures in the area.')
  })
})
