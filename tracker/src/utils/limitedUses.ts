import type { Creature } from '../types/pf2e'

// ── Limited-use ability + spell tracking helpers ──────────────────────────
// A creature's abilities and spells can have a finite number of uses. This
// module parses those limits out of the data and produces stable resource
// keys the combatant state (`resourceUses`) counts against.

export type UsePeriod = 'day' | 'hour' | '10min' | 'minute' | 'round' | 'turn' | 'encounter'

export interface UseLimit { max: number; period: UsePeriod }

const NUM_WORDS: Record<string, number> = {
  once: 1, twice: 2, thrice: 3,
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}

function periodOf(s: string): UsePeriod | null {
  if (/10\s*minutes?/.test(s)) return '10min'
  if (/\bday\b/.test(s)) return 'day'
  if (/\bhour\b/.test(s)) return 'hour'
  if (/\bminute\b/.test(s)) return 'minute'
  if (/\bround\b/.test(s)) return 'round'
  if (/\bturn\b/.test(s)) return 'turn'
  return null
}

function countWord(s: string): number {
  s = s.trim().toLowerCase()
  if (NUM_WORDS[s] != null) return NUM_WORDS[s]
  const numM = s.match(/(\d+)\s*times?/)
  if (numM) return parseInt(numM[1])
  const wordM = s.match(/([a-z]+)\s+times?/)
  if (wordM && NUM_WORDS[wordM[1]] != null) return NUM_WORDS[wordM[1]]
  const bare = s.match(/^(\d+)$/)
  if (bare) return parseInt(bare[1])
  return 0
}

/**
 * Detect a usage limit in an ability's text. Recognises:
 *   "Frequency once per day", "once per round", "three times per day",
 *   "twice per hour", "N/day", "once per 10 minutes".
 * Returns null when the ability is unlimited / has no frequency.
 */
export function parseAbilityFrequency(text: string): UseLimit | null {
  const t = text.toLowerCase()

  // "frequency once per day" / "once per round" / "N times per day" / "twice each hour"
  let m = t.match(/(?:frequency\s+)?(once|twice|thrice|\d+\s*times?|[a-z]+\s+times?)\s+(?:per|each|every|a|an)\s+([^;.,)]+)/)
  if (m) {
    const max = countWord(m[1])
    const period = periodOf(m[2])
    if (max > 0 && period) return { max, period }
  }
  // "3/day", "1 / round"
  m = t.match(/(\d+)\s*\/\s*(day|hour|minute|round|turn)/)
  if (m) {
    const period = periodOf(m[2])
    if (period) return { max: parseInt(m[1]), period }
  }
  return null
}

/** Stable key for an ability resource. */
export function abilityKey(abilityName: string): string {
  return `ab:${abilityName.toLowerCase()}`
}
/** Stable key for a spontaneous rank's shared slot pool. */
export function spellSlotKey(blockIdx: number, level: number): string {
  return `sc:${blockIdx}:slot:${level}`
}
/** Stable key for a single prepared / innate spell's uses. */
export function spellUseKey(blockIdx: number, level: number, spellName: string): string {
  return `sc:${blockIdx}:sp:${level}:${spellName.toLowerCase()}`
}
/** Stable key for a focus block's pool. */
export function focusKey(blockIdx: number): string {
  return `sc:${blockIdx}:focus`
}

/** Short human label for a period — used in hints / tooltips. */
export function periodLabel(p: UsePeriod): string {
  switch (p) {
    case 'day':    return '/day'
    case 'hour':   return '/hour'
    case '10min':  return '/10 min'
    case 'minute': return '/min'
    case 'round':  return '/round'
    case 'turn':   return '/turn'
    case 'encounter': return '/encounter'
  }
}

/**
 * Ability keys whose period resets each turn/round — used by the combat store
 * to auto-refill them when a creature's turn ends. (Per-round and per-turn
 * limits both become available again on the creature's next turn.)
 */
export function roundTurnAbilityKeys(creature: Creature | null): string[] {
  if (!creature) return []
  const keys: string[] = []
  for (const ab of creature.abilities) {
    const lim = parseAbilityFrequency(`${ab.name} ${ab.entries} ${ab.trigger ?? ''}`)
    if (lim && (lim.period === 'round' || lim.period === 'turn')) keys.push(abilityKey(ab.name))
  }
  return keys
}
