import { describe, it, expect } from 'vitest'
import type { AppliedCondition } from '../types/pf2e'
import {
  computeConditionMods,
  resolveStatMod,
  conditionalModsFor,
  ZERO_MODS,
  STAT_MOD_KEYS,
  MOD_TYPES,
  ALL_CONDITIONS,
  type StatMods,
} from './conditionEffects'

// Minimal helper to build an AppliedCondition with only the fields the
// functions under test actually read.
const cond = (c: Partial<AppliedCondition>): AppliedCondition =>
  ({ id: c.id ?? 'x', name: c.name ?? '', isPermanent: false, ...c }) as AppliedCondition

// Convenience: return only the stat keys of `m` that differ from ZERO_MODS.
const nonZero = (m: StatMods): Partial<Record<keyof StatMods, number>> => {
  const out: Partial<Record<keyof StatMods, number>> = {}
  for (const k of STAT_MOD_KEYS) if (m[k] !== 0) out[k] = m[k]
  return out
}

describe('structural invariants', () => {
  it('ZERO_MODS has every key set to 0', () => {
    for (const k of STAT_MOD_KEYS) expect(ZERO_MODS[k]).toBe(0)
  })

  it('STAT_MOD_KEYS is non-empty and matches the keys of ZERO_MODS', () => {
    expect(STAT_MOD_KEYS.length).toBeGreaterThan(0)
    expect(STAT_MOD_KEYS).toEqual(Object.keys(ZERO_MODS))
  })

  it('STAT_MOD_KEYS contains the expected core defense/offense/skill keys', () => {
    for (const k of ['ac', 'fort', 'ref', 'will', 'meleeAttack', 'allChecks', 'athletics', 'speed'] as const) {
      expect(STAT_MOD_KEYS).toContain(k)
    }
  })

  it('STAT_MOD_KEYS has no duplicate keys', () => {
    expect(new Set(STAT_MOD_KEYS).size).toBe(STAT_MOD_KEYS.length)
  })

  it('MOD_TYPES is the four PF2e mod types', () => {
    expect(MOD_TYPES).toEqual(['circumstance', 'status', 'item', 'untyped'])
    expect(MOD_TYPES.length).toBe(4)
  })

  it('ALL_CONDITIONS is non-empty and sorted ascending', () => {
    expect(ALL_CONDITIONS.length).toBeGreaterThan(0)
    const sorted = [...ALL_CONDITIONS].sort()
    expect(ALL_CONDITIONS).toEqual(sorted)
  })

  it('ALL_CONDITIONS includes representative built-in conditions and has no dupes', () => {
    for (const name of ['blinded', 'clumsy', 'frightened', 'off-guard', 'unconscious']) {
      expect(ALL_CONDITIONS).toContain(name)
    }
    expect(new Set(ALL_CONDITIONS).size).toBe(ALL_CONDITIONS.length)
  })
})

describe('computeConditionMods — empty / no-op input', () => {
  it('returns all-zero mods for an empty array', () => {
    expect(computeConditionMods([])).toEqual(ZERO_MODS)
  })

  it('returns a fresh object, not the ZERO_MODS singleton', () => {
    const result = computeConditionMods([])
    expect(result).not.toBe(ZERO_MODS)
    expect(result).toEqual(ZERO_MODS)
  })

  it('ignores an unknown built-in condition name', () => {
    expect(computeConditionMods([cond({ name: 'sparkling' })])).toEqual(ZERO_MODS)
  })

  it('allChecks pseudo-stat is never emitted as its own key', () => {
    const m = computeConditionMods([cond({ name: 'frightened', value: 2 })])
    expect(m.allChecks).toBe(0)
  })
})

describe('computeConditionMods — single built-in conditions', () => {
  it('frightened 2 applies a -2 status penalty to AC, saves, perception, attacks (via allChecks) and to melee/ranged', () => {
    const m = computeConditionMods([cond({ name: 'frightened', value: 2 })])
    // allChecks (-2 status) folds onto its targets:
    expect(m.ac).toBe(-2)
    expect(m.fort).toBe(-2)
    expect(m.ref).toBe(-2)
    expect(m.will).toBe(-2)
    expect(m.perception).toBe(-2)
    expect(m.attackBonus).toBe(-2)
    expect(m.spellAttack).toBe(-2)
    expect(m.spellDC).toBe(-2)
    expect(m.classDC).toBe(-2)
    // skills folded too
    expect(m.acrobatics).toBe(-2)
    expect(m.athletics).toBe(-2)
    expect(m.stealth).toBe(-2)
    // explicit melee/ranged (NOT in ALL_CHECKS_TARGETS, pushed directly)
    expect(m.meleeAttack).toBe(-2)
    expect(m.rangedAttack).toBe(-2)
    // speed unaffected
    expect(m.speed).toBe(0)
  })

  it('enfeebled 1 applies -1 status to melee attack and athletics only', () => {
    const m = computeConditionMods([cond({ name: 'enfeebled', value: 1 })])
    expect(nonZero(m)).toEqual({ meleeAttack: -1, athletics: -1 })
  })

  it('clumsy 1 applies -1 status to AC, Reflex, Acrobatics, Stealth, Thievery', () => {
    const m = computeConditionMods([cond({ name: 'clumsy', value: 1 })])
    expect(nonZero(m)).toEqual({ ac: -1, ref: -1, acrobatics: -1, stealth: -1, thievery: -1 })
  })

  it('drained 2 applies -2 status to Fortitude only', () => {
    const m = computeConditionMods([cond({ name: 'drained', value: 2 })])
    expect(nonZero(m)).toEqual({ fort: -2 })
  })

  it('stupefied 3 applies -3 status to Will, spell attack, spell DC', () => {
    const m = computeConditionMods([cond({ name: 'stupefied', value: 3 })])
    expect(nonZero(m)).toEqual({ will: -3, spellAttack: -3, spellDC: -3 })
  })

  it('sickened 1 behaves like frightened (allChecks + melee/ranged)', () => {
    const m = computeConditionMods([cond({ name: 'sickened', value: 1 })])
    expect(m.ac).toBe(-1)
    expect(m.will).toBe(-1)
    expect(m.meleeAttack).toBe(-1)
    expect(m.rangedAttack).toBe(-1)
  })

  it('off-guard and flat-footed both apply -2 circumstance to AC', () => {
    expect(nonZero(computeConditionMods([cond({ name: 'off-guard' })]))).toEqual({ ac: -2 })
    expect(nonZero(computeConditionMods([cond({ name: 'flat-footed' })]))).toEqual({ ac: -2 })
  })

  it('prone applies -2 circumstance to attackBonus', () => {
    expect(nonZero(computeConditionMods([cond({ name: 'prone' })]))).toEqual({ attackBonus: -2 })
  })

  it('fatigued applies -1 status to AC and all saves', () => {
    expect(nonZero(computeConditionMods([cond({ name: 'fatigued' })]))).toEqual({
      ac: -1, fort: -1, ref: -1, will: -1,
    })
  })

  it('grabbed/restrained apply -2 circumstance to AC and attackBonus', () => {
    expect(nonZero(computeConditionMods([cond({ name: 'grabbed' })]))).toEqual({ ac: -2, attackBonus: -2 })
    expect(nonZero(computeConditionMods([cond({ name: 'restrained' })]))).toEqual({ ac: -2, attackBonus: -2 })
  })

  it('blinded applies -4 status perception and -2 circumstance AC', () => {
    expect(nonZero(computeConditionMods([cond({ name: 'blinded' })]))).toEqual({ perception: -4, ac: -2 })
  })

  it('deafened applies -2 status perception', () => {
    expect(nonZero(computeConditionMods([cond({ name: 'deafened' })]))).toEqual({ perception: -2 })
  })

  it('unconscious stacks -4 status AC + -2 circumstance AC = -6 AC, plus perception/ref', () => {
    const m = computeConditionMods([cond({ name: 'unconscious' })])
    // AC gets a status -4 and a circumstance -2 — different types, so they stack.
    expect(m.ac).toBe(-6)
    expect(m.perception).toBe(-4)
    expect(m.ref).toBe(-4)
  })

  it('name lookup is case-insensitive (uppercased name still matches)', () => {
    const m = computeConditionMods([cond({ name: 'CLUMSY', value: 1 })])
    expect(m.ac).toBe(-1)
  })

  it('missing value defaults to 0 so a value-scaling condition contributes nothing', () => {
    expect(computeConditionMods([cond({ name: 'frightened' })])).toEqual(ZERO_MODS)
  })
})

describe('computeConditionMods — typed stacking rules', () => {
  it('two status penalties to the same stat: worst (most negative) wins, not sum', () => {
    // clumsy 1 (-1 status AC) + frightened 3 (-3 status AC via allChecks) => -3 AC, not -4
    const m = computeConditionMods([
      cond({ name: 'clumsy', value: 1 }),
      cond({ name: 'frightened', value: 3 }),
    ])
    expect(m.ac).toBe(-3)
  })

  it('status + circumstance penalties to AC stack (different types)', () => {
    // off-guard (-2 circ AC) + frightened 2 (-2 status AC) => -4 AC
    const m = computeConditionMods([
      cond({ name: 'off-guard' }),
      cond({ name: 'frightened', value: 2 }),
    ])
    expect(m.ac).toBe(-4)
  })

  it('same-type circumstance penalties do not stack (worst wins)', () => {
    // off-guard (-2 circ AC) + prone (no AC) ... use grabbed (-2 circ AC) + off-guard (-2 circ AC) => -2
    const m = computeConditionMods([
      cond({ name: 'off-guard' }),
      cond({ name: 'grabbed' }),
    ])
    expect(m.ac).toBe(-2)
    // grabbed also gives -2 circ attackBonus, off-guard gives none there
    expect(m.attackBonus).toBe(-2)
  })

  it('untyped custom mods stack with each other and with typed mods', () => {
    const m = computeConditionMods([
      cond({ name: 'A', mods: { ac: -1 } }), // untyped
      cond({ name: 'B', mods: { ac: -1 } }), // untyped
      cond({ name: 'off-guard' }),           // -2 circ
    ])
    // untyped -1 + untyped -1 (stack) + circ -2 = -4
    expect(m.ac).toBe(-4)
  })

  it('highest bonus and worst penalty of one type both apply', () => {
    const m = computeConditionMods([
      cond({ name: 'A', mods: { will: 3 }, modTypes: { will: 'status' } }),
      cond({ name: 'B', mods: { will: 1 }, modTypes: { will: 'status' } }),
      cond({ name: 'C', mods: { will: -2 }, modTypes: { will: 'status' } }),
      cond({ name: 'D', mods: { will: -1 }, modTypes: { will: 'status' } }),
    ])
    // best status bonus (+3) + worst status penalty (-2) = +1
    expect(m.will).toBe(1)
  })
})

describe('computeConditionMods — custom (advanced) conditions', () => {
  it('custom mods default to untyped and stack', () => {
    const m = computeConditionMods([
      cond({ name: 'Bless', mods: { attackBonus: 1 } }),
      cond({ name: 'Heroism', mods: { attackBonus: 1 } }),
    ])
    expect(m.attackBonus).toBe(2)
  })

  it('a condition with `mods` ignores its built-in name entirely', () => {
    // name 'clumsy' would normally hit the AC/Ref/etc. switch, but `mods` present
    // routes through applyCustomFlat instead.
    const m = computeConditionMods([cond({ name: 'clumsy', value: 1, mods: { speed: -10 } })])
    expect(nonZero(m)).toEqual({ speed: -10 })
  })

  it('scalesByValue multiplies mods by max(1, value)', () => {
    const m = computeConditionMods([
      cond({ name: 'Custom Frightened', value: 3, scalesByValue: true, mods: { will: -1 }, modTypes: { will: 'status' } }),
    ])
    expect(m.will).toBe(-3)
  })

  it('scalesByValue clamps the multiplier to at least 1 when value is 0', () => {
    const m = computeConditionMods([
      cond({ name: 'Custom', value: 0, scalesByValue: true, mods: { speed: -5 } }),
    ])
    expect(m.speed).toBe(-5)
  })

  it('scalesByValue with missing value uses multiplier 1', () => {
    const m = computeConditionMods([
      cond({ name: 'Custom', scalesByValue: true, mods: { speed: -5 } }),
    ])
    expect(m.speed).toBe(-5)
  })

  it('custom allChecks mod folds onto its targets but not melee/ranged/speed', () => {
    const m = computeConditionMods([
      cond({ name: 'Custom', mods: { allChecks: -1 }, modTypes: { allChecks: 'status' } }),
    ])
    expect(m.ac).toBe(-1)
    expect(m.will).toBe(-1)
    expect(m.attackBonus).toBe(-1)
    expect(m.athletics).toBe(-1)
    // excluded targets:
    expect(m.meleeAttack).toBe(0)
    expect(m.rangedAttack).toBe(0)
    expect(m.speed).toBe(0)
    expect(m.allChecks).toBe(0)
  })

  it('a zero-valued custom mod does not push anything', () => {
    const m = computeConditionMods([cond({ name: 'Custom', mods: { ac: 0 } })])
    expect(m).toEqual(ZERO_MODS)
  })

  it('allChecks of one type and own-stat of same type combine (worst-wins per type)', () => {
    // status allChecks -1 plus a status will -3 on the same stat: combined into
    // one status bucket for will -> worst is -3.
    const m = computeConditionMods([
      cond({ name: 'A', mods: { allChecks: -1 }, modTypes: { allChecks: 'status' } }),
      cond({ name: 'B', mods: { will: -3 }, modTypes: { will: 'status' } }),
    ])
    expect(m.will).toBe(-3)
  })
})

describe('resolveStatMod', () => {
  const fright = cond({ name: 'frightened', value: 2 })

  it('returns the same value as computeConditionMods for a flat stat (conditional excluded)', () => {
    expect(resolveStatMod([fright], 'will', false)).toBe(-2)
    expect(resolveStatMod([fright], 'ac', false)).toBe(-2)
    expect(resolveStatMod([fright], 'meleeAttack', false)).toBe(-2)
  })

  it('returns 0 for a stat no condition touches', () => {
    expect(resolveStatMod([fright], 'speed', false)).toBe(0)
  })

  it('returns 0 for empty conditions', () => {
    expect(resolveStatMod([], 'ac', false)).toBe(0)
  })

  it('excludes conditional mods when includeConditional is false', () => {
    const c = cond({ name: 'Resolve', condMods: { will: { value: 2, when: 'vs fear', type: 'status' } } })
    expect(resolveStatMod([c], 'will', false)).toBe(0)
  })

  it('includes conditional mods when includeConditional is true', () => {
    const c = cond({ name: 'Resolve', condMods: { will: { value: 2, when: 'vs fear', type: 'status' } } })
    expect(resolveStatMod([c], 'will', true)).toBe(2)
  })

  it('conditional mods participate in typed stacking with flat mods', () => {
    // status flat -2 on will (frightened 2) + status conditional +2 (worst pen + best bonus) = 0
    const c = cond({ name: 'Resolve', condMods: { will: { value: 2, when: 'vs fear', type: 'status' } } })
    expect(resolveStatMod([fright, c], 'will', true)).toBe(0)
  })

  it('conditional mods default to untyped when no type given', () => {
    const c = cond({ name: 'X', condMods: { ac: { value: 1, when: 'somehow' } } })
    // untyped conditional +1 stacks with off-guard circ -2 = -1
    expect(resolveStatMod([cond({ name: 'off-guard' }), c], 'ac', true)).toBe(-1)
  })

  it('conditional mods scale by value when scalesByValue is set', () => {
    const c = cond({
      name: 'Scaling',
      value: 3,
      scalesByValue: true,
      condMods: { will: { value: 1, when: 'vs fear', type: 'status' } },
    })
    expect(resolveStatMod([c], 'will', true)).toBe(3)
  })

  it('conditional allChecks folds onto its targets', () => {
    const c = cond({ name: 'X', condMods: { allChecks: { value: -1, when: 'while dizzy', type: 'status' } } })
    expect(resolveStatMod([c], 'will', true)).toBe(-1)
    expect(resolveStatMod([c], 'ac', true)).toBe(-1)
    expect(resolveStatMod([c], 'meleeAttack', true)).toBe(0)
  })

  it('a conditional mod with value 0 contributes nothing', () => {
    const c = cond({ name: 'X', condMods: { will: { value: 0, when: 'never', type: 'status' } } })
    expect(resolveStatMod([c], 'will', true)).toBe(0)
  })
})

describe('conditionalModsFor', () => {
  it('returns an empty array when no conditions have condMods', () => {
    expect(conditionalModsFor([cond({ name: 'frightened', value: 2 })], ['will'])).toEqual([])
  })

  it('returns an empty array when keys do not match any condMod', () => {
    const c = cond({ name: 'X', condMods: { will: { value: 2, when: 'vs fear', type: 'status' } } })
    expect(conditionalModsFor([c], ['ac'])).toEqual([])
  })

  it('gathers a matching conditional mod with its metadata', () => {
    const c = cond({ name: 'Resolve', condMods: { will: { value: 2, when: 'vs fear', type: 'status' } } })
    expect(conditionalModsFor([c], ['will'])).toEqual([
      { value: 2, when: 'vs fear', source: 'Resolve', type: 'status' },
    ])
  })

  it('uses the condition name as the source', () => {
    const c = cond({ name: 'Courageous Anthem', condMods: { attackBonus: { value: 1, when: 'allies', type: 'status' } } })
    const [entry] = conditionalModsFor([c], ['attackBonus'])
    expect(entry.source).toBe('Courageous Anthem')
  })

  it('defaults type to untyped when absent', () => {
    const c = cond({ name: 'X', condMods: { ac: { value: 1, when: 'somehow' } } })
    expect(conditionalModsFor([c], ['ac'])[0].type).toBe('untyped')
  })

  it('multiplies value by max(1, value) when scalesByValue is set', () => {
    const c = cond({
      name: 'Scaling',
      value: 3,
      scalesByValue: true,
      condMods: { will: { value: 1, when: 'vs fear', type: 'status' } },
    })
    expect(conditionalModsFor([c], ['will'])[0].value).toBe(3)
  })

  it('scalesByValue defaults missing value to 1 (NOT 0) for the multiplier', () => {
    // conditionalModsFor uses `c.value ?? 1`, unlike applyCustomFlat which uses `?? 0`.
    const c = cond({ name: 'Scaling', scalesByValue: true, condMods: { will: { value: 2, when: 'x', type: 'status' } } })
    expect(conditionalModsFor([c], ['will'])[0].value).toBe(2)
  })

  it('does NOT fold allChecks onto targets — it only returns keys exactly requested', () => {
    const c = cond({ name: 'X', condMods: { allChecks: { value: -1, when: 'dizzy', type: 'status' } } })
    // asking for 'will' returns nothing because the condMod key is 'allChecks'
    expect(conditionalModsFor([c], ['will'])).toEqual([])
    // asking for 'allChecks' returns it verbatim
    expect(conditionalModsFor([c], ['allChecks'])).toEqual([
      { value: -1, when: 'dizzy', source: 'X', type: 'status' },
    ])
  })

  it('collects one entry per matching key, across multiple conditions and keys', () => {
    const a = cond({ name: 'A', condMods: { will: { value: 2, when: 'fear', type: 'status' } } })
    const b = cond({ name: 'B', condMods: { ac: { value: 1, when: 'cover', type: 'circumstance' } } })
    const out = conditionalModsFor([a, b], ['will', 'ac'])
    expect(out).toHaveLength(2)
    expect(out.map(e => e.source)).toEqual(['A', 'B'])
  })

  it('skips condMod entries whose value is 0', () => {
    const c = cond({ name: 'X', condMods: { will: { value: 0, when: 'never', type: 'status' } } })
    expect(conditionalModsFor([c], ['will'])).toEqual([])
  })
})

describe('computeConditionMods — combined realistic scenario', () => {
  it('frightened 2 + enfeebled 1 + clumsy 1 produces the documented per-stat penalties', () => {
    const m = computeConditionMods([
      cond({ name: 'frightened', value: 2 }),
      cond({ name: 'enfeebled', value: 1 }),
      cond({ name: 'clumsy', value: 1 }),
    ])
    // AC: frightened status -2 (via allChecks) worst-wins vs clumsy status -1 => -2
    expect(m.ac).toBe(-2)
    // Reflex: frightened -2 vs clumsy -1 (both status) => -2
    expect(m.ref).toBe(-2)
    expect(m.fort).toBe(-2)
    expect(m.will).toBe(-2)
    expect(m.perception).toBe(-2)
    // melee attack: frightened explicit -2 (status) vs enfeebled -2... actually enfeebled is -1
    // both status on meleeAttack: frightened -2, enfeebled -1 => worst -2
    expect(m.meleeAttack).toBe(-2)
    expect(m.rangedAttack).toBe(-2)
    // Acrobatics: frightened (allChecks) -2 vs clumsy -1 (both status) => -2
    expect(m.acrobatics).toBe(-2)
    // Athletics: frightened (allChecks) -2 vs enfeebled -1 (both status) => -2
    expect(m.athletics).toBe(-2)
    // Stealth/Thievery: frightened -2 vs clumsy -1 => -2
    expect(m.stealth).toBe(-2)
    expect(m.thievery).toBe(-2)
    // Speed untouched
    expect(m.speed).toBe(0)
  })
})
