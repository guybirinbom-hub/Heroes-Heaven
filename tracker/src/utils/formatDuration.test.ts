import { describe, it, expect } from 'vitest'
import { formatSpellDuration } from './formatDuration'

// Characterization tests for formatSpellDuration.
//
// The doc comment advertises that it accepts "a number, a numeric string, or an
// already-formatted phrase". In practice the implementation handles exactly
// these shapes:
//   - null / undefined / '' / whitespace-only string  -> ''
//   - a non-numeric string                              -> trimmed pass-through
//   - a numeric string                                  -> seconds conversion
//   - a finite number                                   -> seconds conversion
//   - anything else (objects, NaN, Infinity, boolean…)  -> String(d) fallback
//
// PF2e never expresses durations in seconds, so the AoN raw seconds value is
// converted at display time: 6s = 1 round, picking the largest unit that
// divides evenly.

describe('formatSpellDuration', () => {
  describe('null / undefined / empty input', () => {
    it('returns empty string for null', () => {
      expect(formatSpellDuration(null)).toBe('')
    })

    it('returns empty string for undefined', () => {
      expect(formatSpellDuration(undefined)).toBe('')
    })

    it('returns empty string for an empty string', () => {
      expect(formatSpellDuration('')).toBe('')
    })

    it('returns empty string for a whitespace-only string', () => {
      expect(formatSpellDuration('   ')).toBe('')
    })
  })

  describe('already-formatted (non-numeric) string passthrough', () => {
    it('leaves a human-readable phrase unchanged', () => {
      expect(formatSpellDuration('until the start of your next turn')).toBe(
        'until the start of your next turn'
      )
    })

    it('passes through "sustained" unchanged', () => {
      expect(formatSpellDuration('sustained')).toBe('sustained')
    })

    it('passes through "sustained up to 1 minute" unchanged', () => {
      expect(formatSpellDuration('sustained up to 1 minute')).toBe(
        'sustained up to 1 minute'
      )
    })

    it('passes through "unlimited" unchanged', () => {
      expect(formatSpellDuration('unlimited')).toBe('unlimited')
    })

    it('trims surrounding whitespace on a passthrough phrase', () => {
      expect(formatSpellDuration('  1 minute  ')).toBe('1 minute')
    })

    it('treats a string with digits plus words as a phrase (not seconds)', () => {
      // "10 minutes" is not /^\d+$/, so it is passed through verbatim, not
      // re-interpreted as 10 seconds.
      expect(formatSpellDuration('10 minutes')).toBe('10 minutes')
    })

    it('treats a value with a leading sign as a phrase, not a number', () => {
      // "-6" fails /^\d+$/ so it is returned as-is rather than converted.
      expect(formatSpellDuration('-6')).toBe('-6')
    })

    it('treats a decimal string as a phrase, not a number', () => {
      expect(formatSpellDuration('6.0')).toBe('6.0')
    })
  })

  describe('numeric string conversion (matches numeric-number behavior)', () => {
    it('converts "60" to "1 minute"', () => {
      expect(formatSpellDuration('60')).toBe('1 minute')
    })

    it('converts "28800" to "8 hours"', () => {
      expect(formatSpellDuration('28800')).toBe('8 hours')
    })

    it('converts a numeric string with surrounding whitespace', () => {
      expect(formatSpellDuration('  6  ')).toBe('1 round')
    })

    it('converts "0" to "" (non-positive)', () => {
      expect(formatSpellDuration('0')).toBe('')
    })
  })

  describe('number conversion: days', () => {
    it('86400 -> "1 day"', () => {
      expect(formatSpellDuration(86400)).toBe('1 day')
    })

    it('172800 -> "2 days"', () => {
      expect(formatSpellDuration(172800)).toBe('2 days')
    })

    it('boundary: 86399 is not a whole day, falls through to next unit', () => {
      // 86399 % 86400 !== 0; also not /3600 or /60 or /6 -> seconds fallback.
      expect(formatSpellDuration(86399)).toBe('86399 seconds')
    })
  })

  describe('number conversion: hours', () => {
    it('3600 -> "1 hour"', () => {
      expect(formatSpellDuration(3600)).toBe('1 hour')
    })

    it('7200 -> "2 hours"', () => {
      expect(formatSpellDuration(7200)).toBe('2 hours')
    })

    it('28800 -> "8 hours"', () => {
      expect(formatSpellDuration(28800)).toBe('8 hours')
    })
  })

  describe('number conversion: minutes', () => {
    it('60 -> "1 minute"', () => {
      expect(formatSpellDuration(60)).toBe('1 minute')
    })

    it('600 -> "10 minutes"', () => {
      expect(formatSpellDuration(600)).toBe('10 minutes')
    })

    it('5400 -> "90 minutes" (not a whole number of hours)', () => {
      expect(formatSpellDuration(5400)).toBe('90 minutes')
    })
  })

  describe('number conversion: rounds', () => {
    it('6 -> "1 round"', () => {
      expect(formatSpellDuration(6)).toBe('1 round')
    })

    it('18 -> "3 rounds"', () => {
      expect(formatSpellDuration(18)).toBe('3 rounds')
    })

    it('54 -> "9 rounds" (multiple of 6 but not of 60)', () => {
      expect(formatSpellDuration(54)).toBe('9 rounds')
    })
  })

  describe('number conversion: unit-selection precedence', () => {
    it('picks the largest cleanly-dividing unit (3600 -> hour, not minutes/rounds)', () => {
      expect(formatSpellDuration(3600)).toBe('1 hour')
    })

    it('falls back to rounds when only divisible by 6 (66 -> "11 rounds")', () => {
      expect(formatSpellDuration(66)).toBe('11 rounds')
    })
  })

  describe('number conversion: non-positive and sub-round values', () => {
    it('0 -> ""', () => {
      expect(formatSpellDuration(0)).toBe('')
    })

    it('negative numbers -> ""', () => {
      expect(formatSpellDuration(-6)).toBe('')
    })

    it('1 -> "1 second" (sub-round graceful degradation, singular)', () => {
      expect(formatSpellDuration(1)).toBe('1 second')
    })

    it('5 -> "5 seconds" (sub-round, plural)', () => {
      expect(formatSpellDuration(5)).toBe('5 seconds')
    })

    it('7 -> "7 seconds" (positive, not a multiple of 6)', () => {
      expect(formatSpellDuration(7)).toBe('7 seconds')
    })
  })

  describe('non-finite numbers fall through to String() fallback', () => {
    it('NaN -> "NaN" (Number.isFinite false, so String(NaN))', () => {
      expect(formatSpellDuration(NaN)).toBe('NaN')
    })

    it('Infinity -> "Infinity"', () => {
      expect(formatSpellDuration(Infinity)).toBe('Infinity')
    })

    it('-Infinity -> "-Infinity"', () => {
      expect(formatSpellDuration(-Infinity)).toBe('-Infinity')
    })
  })

  describe('structured / object shapes', () => {
    // { value|number, unit } is the canonical Foundry/PF2e duration object —
    // formatted to a readable phrase. Other objects still hit String(d).
    it('{ value, unit } object -> "1 minute"', () => {
      expect(formatSpellDuration({ value: 1, unit: 'minute' })).toBe('1 minute')
    })

    it('{ number, unit } object (plural) -> "8 hours"', () => {
      expect(formatSpellDuration({ number: 8, unit: 'hour' })).toBe('8 hours')
    })

    it('singularizes an already-plural unit for a count of 1', () => {
      expect(formatSpellDuration({ value: 1, unit: 'hours' })).toBe('1 hour')
    })

    it('passes a descriptive (non-time) unit through verbatim', () => {
      expect(formatSpellDuration({ value: -1, unit: 'unlimited' })).toBe('unlimited')
    })

    it('treats a non-positive time count as no duration', () => {
      expect(formatSpellDuration({ value: 0, unit: 'minute' })).toBe('')
    })

    it('an object with a custom toString is stringified via String()', () => {
      const obj = { toString: () => '1 minute' }
      expect(formatSpellDuration(obj)).toBe('1 minute')
    })

    it('an array is stringified via String()', () => {
      expect(formatSpellDuration([1, 'minute'])).toBe('1,minute')
    })
  })

  describe('other primitive types fall through to String() fallback', () => {
    it('boolean true -> "true"', () => {
      expect(formatSpellDuration(true)).toBe('true')
    })

    it('boolean false -> "false"', () => {
      expect(formatSpellDuration(false)).toBe('false')
    })
  })

  describe('return type invariant', () => {
    const inputs: unknown[] = [
      null,
      undefined,
      '',
      '   ',
      'sustained',
      '60',
      '0',
      0,
      6,
      60,
      3600,
      86400,
      5400,
      1,
      NaN,
      Infinity,
      true,
      { value: 1, unit: 'round' },
      [1, 2, 3]
    ]

    it('always returns a string', () => {
      for (const input of inputs) {
        expect(typeof formatSpellDuration(input)).toBe('string')
      }
    })
  })
})
