import { describe, it, expect } from 'vitest'
import { parseHazardDescription } from './parseHazardText'
import type { ParsedHazardText } from './parseHazardText'

// Characterization tests for parseHazardDescription. Expected values were
// derived by reading the parser AND running it against these exact strings, so
// they describe the code's ACTUAL current behavior (not idealized PF2e output).

// A representative AoN-scraped *simple* hazard blob covering every section the
// parser knows about: source header, Complexity, flavor (terminated by "---"),
// Stealth, Disable, AC + saves, Hardness, HP (with BT), Immunities, one ability
// block (Reaction with Trigger/Effect), and a trailing Reset.
const SIMPLE = [
  'Hidden Pit Source Core Rulebook pg. 521 Complexity Simple',
  'A wooden cover blends into the floor, ready to give way underfoot.',
  '--- Stealth DC 18 (trained)',
  'Disable Athletics DC 16 to wedge the cover shut, or Thievery DC 20 to disable the trigger',
  'AC 10, Fort +5, Ref +1 Hardness 5, HP 24 (BT 12), Immunities critical hits',
  "Pit Trapdoor Reaction Trigger A creature walks onto the pit's cover.",
  'Effect The cover opens, dropping the creature into the 20-foot pit and dealing 10 bludgeoning damage from the fall.',
  "Reset The pit's cover can be reset manually over the course of 1 minute.",
].join(' ')

// A representative *complex* hazard: Complexity Complex, an attack line nested in
// the ability prose, a Routine section, and a "--- Reset" tail.
const COMPLEX = [
  'Spinning Blade Pillar Source Core Rulebook pg. 524 Complexity Complex',
  'A stone pillar conceals whirling blades.',
  '--- Stealth DC 30 (master)',
  'Disable Thievery DC 32 to jam the blades',
  'AC 30, Fort +20, Ref +23 Hardness 18, HP 72 (BT 36), Immunities critical hits, object immunities',
  'Whirling Blades Two Actions Trigger A creature comes within reach.',
  'Effect The pillar extends blades and makes a Strike. Melee blade +25, Damage 3d8+12 slashing',
  'Routine (1 action) The pillar makes one blade Strike against the nearest creature.',
  '--- Reset The pillar retracts after 1 minute.',
].join(' ')

describe('parseHazardDescription — simple hazard (all sections)', () => {
  const p: ParsedHazardText = parseHazardDescription(SIMPLE, 'Hidden Pit')

  it('strips the "<Name> Source <book> pg. N" header and Complexity flag from flavor', () => {
    expect(p.flavor).toBe('A wooden cover blends into the floor, ready to give way underfoot.')
  })

  it('detects "Complexity Simple" as complex === false', () => {
    expect(p.complex).toBe(false)
  })

  it('extracts Stealth body without the "Stealth" keyword', () => {
    expect(p.stealth).toBe('DC 18 (trained)')
  })

  it('extracts the free-form Disable text up to the AC defense boundary', () => {
    expect(p.disable).toBe(
      'Athletics DC 16 to wedge the cover shut, or Thievery DC 20 to disable the trigger',
    )
  })

  it('pulls the Break Threshold out of the HP line', () => {
    expect(p.bt).toBe(12)
  })

  it('extracts the Reset text off the tail', () => {
    expect(p.reset).toBe("The pit's cover can be reset manually over the course of 1 minute.")
  })

  it('has no Routine for a simple (non-complex) hazard', () => {
    expect(p.routine).toBe('')
  })

  it('extracts exactly one ability with a glyph-suffixed name', () => {
    expect(p.abilities).toHaveLength(1)
    expect(p.abilities[0].name).toBe('Pit Trapdoor ↺')
  })

  it('splits the ability Trigger out of its Effect body', () => {
    const a = p.abilities[0]
    expect(a.trigger).toBe("A creature walks onto the pit's cover")
    expect(a.entries).toBe(
      'The cover opens, dropping the creature into the 20-foot pit and dealing 10 bludgeoning damage from the fall.',
    )
  })

  it('leaves ability.activity undefined and traits empty (no leading paren)', () => {
    expect(p.abilities[0].activity).toBeUndefined()
    expect(p.abilities[0].traits).toEqual([])
  })

  it('finds no attacks in a hazard whose ability has no Melee/Ranged line', () => {
    expect(p.attacks).toEqual([])
  })
})

describe('parseHazardDescription — complex hazard (attack + routine)', () => {
  const p = parseHazardDescription(COMPLEX, 'Spinning Blade Pillar')

  it('detects "Complexity Complex" as complex === true', () => {
    expect(p.complex).toBe(true)
  })

  it('extracts flavor, stealth, and disable', () => {
    expect(p.flavor).toBe('A stone pillar conceals whirling blades.')
    expect(p.stealth).toBe('DC 30 (master)')
    expect(p.disable).toBe('Thievery DC 32 to jam the blades')
  })

  it('reads BT 36 from the HP line', () => {
    expect(p.bt).toBe(36)
  })

  it('maps "Two Actions" to the ◆◆ glyph on the ability name', () => {
    expect(p.abilities).toHaveLength(1)
    expect(p.abilities[0].name).toBe('Whirling Blades ◆◆')
  })

  it('extracts a Melee attack nested inside the ability prose', () => {
    expect(p.attacks).toHaveLength(1)
    const atk = p.attacks[0]
    expect(atk.range).toBe('Melee')
    expect(atk.name).toBe('blade')
    expect(atk.attack).toBe(25)
    expect(atk.damage).toBe('3d8+12 slashing')
    expect(atk.isAgile).toBe(false)
    expect(atk.traits).toEqual([])
  })

  it('captures the Routine text (including the leading action cost prose)', () => {
    expect(p.routine).toBe(
      '(1 action) The pillar makes one blade Strike against the nearest creature.',
    )
  })

  it('captures the "--- Reset" tail text', () => {
    expect(p.reset).toBe('The pillar retracts after 1 minute.')
  })
})

describe('parseHazardDescription — attack trait parsing', () => {
  // No defenses block; ability prose contains an attack with a trait paren that
  // includes "agile", which must flip isAgile and populate traits.
  const desc = [
    'Stealth +12 (master)',
    'Disable DC 25 to disarm AC 20, Ref +15 HP 30 (BT 15)',
    'Burst Reaction Trigger A creature steps on the glyph.',
    'Effect It explodes. Melee fiery blast +20 (agile, fire), Damage 4d6 fire',
  ].join(' ')
  const p = parseHazardDescription(desc, 'Glyph')

  it('parses Stealth with a "+N (prof)" bonus form', () => {
    expect(p.stealth).toBe('+12 (master)')
  })

  it('splits attack traits on commas and detects agile', () => {
    expect(p.attacks).toHaveLength(1)
    const atk = p.attacks[0]
    expect(atk.name).toBe('fiery blast')
    expect(atk.attack).toBe(20)
    expect(atk.traits).toEqual(['agile', 'fire'])
    expect(atk.isAgile).toBe(true)
    expect(atk.damage).toBe('4d6 fire')
  })
})

describe('parseHazardDescription — bracketed activity is NOT recognized', () => {
  // AoN sometimes renders the action as "[Reaction]". The ability-head regex
  // only matches the bare keyword, so a bracketed activity yields no ability.
  // (Documented current behavior, not necessarily desired.)
  const desc = [
    'Stealth DC 18 Disable Thievery DC 20 AC 10, Ref +1 HP 20 (BT 10)',
    'Pit Trapdoor [Reaction] Trigger Someone steps on it.',
    'Effect They fall.',
  ].join(' ')
  const p = parseHazardDescription(desc, 'Pit')

  it('extracts no abilities when the action is bracketed', () => {
    expect(p.abilities).toEqual([])
  })
})

describe('parseHazardDescription — empty / invalid input', () => {
  it('returns the all-empty shape for an empty string', () => {
    const p = parseHazardDescription('', 'Whatever')
    expect(p).toEqual({
      flavor: '',
      stealth: '',
      disable: '',
      bt: undefined,
      complex: undefined,
      abilities: [],
      attacks: [],
      routine: '',
      reset: '',
    })
  })

  it('returns the all-empty shape for undefined-ish falsy input', () => {
    // The guard is `if (!rawDesc) return empty`.
    const p = parseHazardDescription(undefined as unknown as string, 'X')
    expect(p.flavor).toBe('')
    expect(p.bt).toBeUndefined()
    expect(p.complex).toBeUndefined()
    expect(p.abilities).toEqual([])
  })
})

describe('parseHazardDescription — minimal / partial input', () => {
  it('extracts only Stealth when no flavor/defenses/abilities are present', () => {
    const p = parseHazardDescription('Stealth DC 15 Disable Thievery DC 18 to disarm', 'Snare')
    expect(p.stealth).toBe('DC 15')
    expect(p.flavor).toBe('')
    expect(p.bt).toBeUndefined()
    expect(p.complex).toBeUndefined()
    expect(p.routine).toBe('')
    expect(p.reset).toBe('')
    expect(p.abilities).toEqual([])
    expect(p.attacks).toEqual([])
  })

  it('captures Disable when it is the terminal section with no trailing keyword', () => {
    // A Disable run that ends the string is captured now that the lookahead
    // accepts end-of-string without a preceding-whitespace requirement.
    const p = parseHazardDescription('Stealth DC 15 Disable Thievery DC 18 to disarm', 'Snare')
    expect(p.disable).toBe('Thievery DC 18 to disarm')
  })

  it('DOES extract Disable when a following section keyword bounds it', () => {
    const p = parseHazardDescription(
      'Stealth DC 15 Disable Thievery DC 18 to disarm AC 12, Ref +8',
      'Snare',
    )
    expect(p.disable).toBe('Thievery DC 18 to disarm')
  })

  it('leaves flavor empty when there is no "---" and no "Stealth" header', () => {
    const p = parseHazardDescription('Just some flavor text with no sections at all.', 'Thing')
    expect(p.flavor).toBe('')
    expect(p.stealth).toBe('')
    expect(p.disable).toBe('')
  })
})

describe('parseHazardDescription — flavor boundary detection', () => {
  it('ends flavor at the first "Stealth" header when there is no "---"', () => {
    const desc = 'A creaking floorboard hides the trap. Stealth DC 22 Disable Thievery DC 25 to wedge AC 18, Ref +10'
    const p = parseHazardDescription(desc, 'Trap')
    expect(p.flavor).toBe('A creaking floorboard hides the trap.')
    expect(p.stealth).toBe('DC 22')
  })

  it('ends flavor at "---" when it precedes the Stealth header', () => {
    const desc = 'Some atmospheric flavor. --- Stealth DC 20 Disable DC 22 to disarm AC 15, Ref +9'
    const p = parseHazardDescription(desc, 'Trap')
    expect(p.flavor).toBe('Some atmospheric flavor.')
    expect(p.stealth).toBe('DC 20')
  })
})

describe('parseHazardDescription — header / source stripping', () => {
  it('strips a leading name that matches (case-insensitively)', () => {
    const desc = 'GHOSTLY WAIL Source Book of the Dead pg. 12 --- Stealth DC 30 Disable Religion DC 32 AC 25, Will +20'
    const p = parseHazardDescription(desc, 'Ghostly Wail')
    // Name + source line are stripped. The "---" then sits at the very start of
    // the trimmed string; the separator search anchors at start-of-string too,
    // so it's consumed rather than surfaced as flavor.
    expect(p.flavor).toBe('')
    expect(p.stealth).toBe('DC 30')
  })

  it('treats "Complexity" as undefined when absent', () => {
    const desc = 'Flavor here. --- Stealth DC 12 Disable DC 14 to disable AC 10, Ref +2'
    const p = parseHazardDescription(desc, 'NoComplexity')
    expect(p.complex).toBeUndefined()
  })
})
