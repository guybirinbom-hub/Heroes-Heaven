import { describe, it, expect } from 'vitest'
import {
  parseAbilityFrequency,
  abilityKey,
  spellSlotKey,
  spellUseKey,
  focusKey,
  periodLabel,
  roundTurnAbilityKeys,
  type UsePeriod,
} from './limitedUses'
import type { Creature } from '../types/pf2e'

// A minimal Creature fixture builder — only `abilities` is read by
// roundTurnAbilityKeys, so everything else is cast away.
function makeCreature(abilities: Creature['abilities']): Creature {
  return { abilities } as unknown as Creature
}

describe('parseAbilityFrequency', () => {
  it('parses "once per day"', () => {
    expect(parseAbilityFrequency('once per day')).toEqual({ max: 1, period: 'day' })
  })

  it('parses "twice per day"', () => {
    expect(parseAbilityFrequency('twice per day')).toEqual({ max: 2, period: 'day' })
  })

  it('parses "thrice per day"', () => {
    expect(parseAbilityFrequency('thrice per day')).toEqual({ max: 3, period: 'day' })
  })

  it('parses "once per hour"', () => {
    expect(parseAbilityFrequency('once per hour')).toEqual({ max: 1, period: 'hour' })
  })

  it('parses "once per 10 minutes" as the 10min period (not minute)', () => {
    expect(parseAbilityFrequency('once per 10 minutes')).toEqual({ max: 1, period: '10min' })
  })

  it('parses "once per minute"', () => {
    expect(parseAbilityFrequency('once per minute')).toEqual({ max: 1, period: 'minute' })
  })

  it('parses "once per round"', () => {
    expect(parseAbilityFrequency('once per round')).toEqual({ max: 1, period: 'round' })
  })

  it('parses "once per turn"', () => {
    expect(parseAbilityFrequency('once per turn')).toEqual({ max: 1, period: 'turn' })
  })

  it('honours the optional "frequency" prefix', () => {
    expect(parseAbilityFrequency('Frequency once per day; Effect ...'))
      .toEqual({ max: 1, period: 'day' })
  })

  it('parses numeric "three times per day"', () => {
    expect(parseAbilityFrequency('three times per day')).toEqual({ max: 3, period: 'day' })
  })

  it('parses digit-based "3 times per day"', () => {
    expect(parseAbilityFrequency('3 times per day')).toEqual({ max: 3, period: 'day' })
  })

  it('parses "twice each hour" (each connector)', () => {
    expect(parseAbilityFrequency('twice each hour')).toEqual({ max: 2, period: 'hour' })
  })

  it('parses "once every round" (every connector)', () => {
    expect(parseAbilityFrequency('once every round')).toEqual({ max: 1, period: 'round' })
  })

  it('parses the "N/day" slash shorthand', () => {
    expect(parseAbilityFrequency('3/day')).toEqual({ max: 3, period: 'day' })
  })

  it('parses the slash shorthand with spaces "1 / round"', () => {
    expect(parseAbilityFrequency('1 / round')).toEqual({ max: 1, period: 'round' })
  })

  it('the slash shorthand does NOT support an hourly... it does support hour', () => {
    // periodOf supports hour, and the slash regex alternation lists hour
    expect(parseAbilityFrequency('2/hour')).toEqual({ max: 2, period: 'hour' })
  })

  it('is case-insensitive', () => {
    expect(parseAbilityFrequency('ONCE PER DAY')).toEqual({ max: 1, period: 'day' })
  })

  it('finds the frequency embedded in surrounding prose', () => {
    expect(parseAbilityFrequency('The dragon can breathe fire once per day as a powerful blast.'))
      .toEqual({ max: 1, period: 'day' })
  })

  it('returns null for text with no frequency', () => {
    expect(parseAbilityFrequency('The creature has darkvision and a keen sense of smell.'))
      .toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseAbilityFrequency('')).toBeNull()
  })

  it('returns null when a recognised count has an unrecognised period', () => {
    // "week" is not in periodOf, so even though "once per ..." matches, no period
    expect(parseAbilityFrequency('once per week')).toBeNull()
  })

  it('returns null for the slash shorthand with an unsupported period word', () => {
    // "10 minutes" is not in the slash alternation (day|hour|minute|round|turn)
    expect(parseAbilityFrequency('1/week')).toBeNull()
  })

  it('returns the FIRST matching period when multiple period words appear', () => {
    // periodOf checks day before hour; the captured tail is "[^;.,)]+" so it
    // greedily grabs "day and once per hour", and periodOf hits \bday\b first.
    expect(parseAbilityFrequency('once per day and once per hour'))
      .toEqual({ max: 1, period: 'day' })
  })

  it('parses "once a day" using the "a" connector', () => {
    expect(parseAbilityFrequency('once a day')).toEqual({ max: 1, period: 'day' })
  })

  it('parses "once an hour" using the "an" connector', () => {
    expect(parseAbilityFrequency('once an hour')).toEqual({ max: 1, period: 'hour' })
  })
})

describe('key builders produce stable, distinct, prefixed strings', () => {
  it('abilityKey lowercases and prefixes with ab:', () => {
    expect(abilityKey('Breath Weapon')).toBe('ab:breath weapon')
  })

  it('abilityKey is stable for the same input', () => {
    expect(abilityKey('Frightful Presence')).toBe(abilityKey('Frightful Presence'))
  })

  it('abilityKey is case-insensitive (same key for different casing)', () => {
    expect(abilityKey('Rage')).toBe(abilityKey('RAGE'))
  })

  it('spellSlotKey embeds block index and level', () => {
    expect(spellSlotKey(0, 3)).toBe('sc:0:slot:3')
    expect(spellSlotKey(2, 5)).toBe('sc:2:slot:5')
  })

  it('spellUseKey embeds block index, level and lowercased spell name', () => {
    expect(spellUseKey(1, 4, 'Fireball')).toBe('sc:1:sp:4:fireball')
  })

  it('focusKey embeds the block index', () => {
    expect(focusKey(0)).toBe('sc:0:focus')
    expect(focusKey(3)).toBe('sc:3:focus')
  })

  it('the four builders produce mutually distinct keys', () => {
    const keys = new Set([
      abilityKey('x'),
      spellSlotKey(0, 1),
      spellUseKey(0, 1, 'x'),
      focusKey(0),
    ])
    expect(keys.size).toBe(4)
  })

  it('spellSlotKey and spellUseKey differ even for the same block/level', () => {
    expect(spellSlotKey(0, 1)).not.toBe(spellUseKey(0, 1, 'slot'))
  })
})

describe('periodLabel', () => {
  const cases: Array<[UsePeriod, string]> = [
    ['day', '/day'],
    ['hour', '/hour'],
    ['10min', '/10 min'],
    ['minute', '/min'],
    ['round', '/round'],
    ['turn', '/turn'],
    ['encounter', '/encounter'],
  ]
  it.each(cases)('labels %s as %s', (period, label) => {
    expect(periodLabel(period)).toBe(label)
  })
})

describe('roundTurnAbilityKeys', () => {
  it('returns [] for a null creature', () => {
    expect(roundTurnAbilityKeys(null)).toEqual([])
  })

  it('returns [] when the creature has no abilities', () => {
    expect(roundTurnAbilityKeys(makeCreature([]))).toEqual([])
  })

  it('includes abilities whose frequency is per-round', () => {
    const c = makeCreature([
      { name: 'Quick Block', traits: [], entries: 'once per round you can block.' },
    ])
    expect(roundTurnAbilityKeys(c)).toEqual(['ab:quick block'])
  })

  it('includes abilities whose frequency is per-turn', () => {
    const c = makeCreature([
      { name: 'Sneak Attack', traits: [], entries: 'once per turn deal extra damage.' },
    ])
    expect(roundTurnAbilityKeys(c)).toEqual(['ab:sneak attack'])
  })

  it('excludes per-day abilities', () => {
    const c = makeCreature([
      { name: 'Breath Weapon', traits: [], entries: 'once per day breathe fire.' },
    ])
    expect(roundTurnAbilityKeys(c)).toEqual([])
  })

  it('excludes abilities with no frequency', () => {
    const c = makeCreature([
      { name: 'Darkvision', traits: [], entries: 'The creature can see in the dark.' },
    ])
    expect(roundTurnAbilityKeys(c)).toEqual([])
  })

  it('reads the frequency out of the trigger field too', () => {
    const c = makeCreature([
      { name: 'Reactive Strike', traits: [], entries: 'You strike.', trigger: 'once per round when a foe acts' },
    ])
    expect(roundTurnAbilityKeys(c)).toEqual(['ab:reactive strike'])
  })

  it('tolerates an undefined trigger (the ?? \'\' fallback)', () => {
    const c = makeCreature([
      { name: 'Parry', traits: [], entries: 'once per round raise your guard.' },
    ])
    expect(roundTurnAbilityKeys(c)).toEqual(['ab:parry'])
  })

  it('collects only the round/turn abilities from a mixed list, preserving order', () => {
    const c = makeCreature([
      { name: 'Roundly', traits: [], entries: 'once per round.' },
      { name: 'Daily', traits: [], entries: 'once per day.' },
      { name: 'Turnly', traits: [], entries: 'once per turn.' },
      { name: 'Plain', traits: [], entries: 'no limit.' },
    ])
    expect(roundTurnAbilityKeys(c)).toEqual(['ab:roundly', 'ab:turnly'])
  })
})
