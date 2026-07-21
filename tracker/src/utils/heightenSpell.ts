import type { SpellInfo } from '../data/dataStore'

// ── Spell heightening ────────────────────────────────────────────────────────
// Creatures cast spells at a fixed rank: slotted/innate spells at their slot
// rank, cantrips and focus spells at ⌈level ÷ 2⌉. When that rank is above the
// spell's base rank, the spell is heightened. We compute the heightened numbers
// from the structured `heightened` increments + the base numbers in the
// description / range / area, and surface them as "base (heightened)".
//
// Damage/healing dice are high-confidence (the increment is structured, e.g.
// "+1": "The damage increases by 2d6."). Range/area are best-effort from the
// prose ("the range increases by 30 feet"). Anything non-numeric (a spell that
// "also blinds" at higher ranks) isn't injected — the popup's Heightened
// section still shows that prose.

export interface SpellHeightening {
  rank: number
  /** Verbatim text replacements to apply to the description: base → "base (new)". */
  damage: Array<{ from: string; to: string }>
  /** Heightened range / area display strings, when they scale. */
  range?: string
  area?: string
}

/** ⌈level ÷ 2⌉ — the rank cantrips and focus spells are heightened to. */
export function autoHeightenRank(creatureLevel: number): number {
  return Math.max(1, Math.ceil(creatureLevel / 2))
}

export function heightenSpell(spell: SpellInfo, castRank: number): SpellHeightening | null {
  const steps = castRank - spell.level
  if (steps <= 0 || !spell.heightened) return null

  // Per-interval heightening entry ("+1" / "+2"). Fixed-rank keys ("4","6") are
  // full restatements — left to the prose Heightened section, not injected.
  let interval = 0
  let htext = ''
  for (const [k, v] of Object.entries(spell.heightened)) {
    const m = k.match(/^\+(\d+)$/)
    if (m) { interval = parseInt(m[1], 10); htext = v; break }
  }
  if (!interval || !htext) return null

  const applications = Math.floor(steps / interval)
  if (applications <= 0) return null

  const out: SpellHeightening = { rank: castRank, damage: [] }

  // ── Damage / healing dice ──
  // For each distinct die size in the increment text, bump the first matching
  // die in the description: base NdX → "NdX (N+app·incr dX)".
  const seenDie = new Set<number>()
  for (const m of htext.matchAll(/(\d+)d(\d+)/g)) {
    const incN = parseInt(m[1], 10)
    const die = parseInt(m[2], 10)
    if (seenDie.has(die)) continue
    seenDie.add(die)
    const baseMatch = spell.description.match(new RegExp(`(\\d+)d${die}\\b`))
    if (baseMatch) {
      const newN = parseInt(baseMatch[1], 10) + applications * incN
      out.damage.push({ from: baseMatch[0], to: `${baseMatch[0]} (${newN}d${die})` })
    }
  }

  // ── Range (flat "+N feet") ──
  const rangeInc = htext.match(/range\s+increases?\s+by\s+(\d+)\s*feet/i)
  if (rangeInc && spell.range) {
    const baseR = spell.range.match(/(\d+)\s*feet/i)
    if (baseR) {
      const newR = parseInt(baseR[1], 10) + applications * parseInt(rangeInc[1], 10)
      out.range = spell.range.replace(/(\d+)(\s*feet)/i, `$1 (${newR})$2`)
    }
  }

  // ── Area (burst / emanation / cone / line radius "increases by N feet") ──
  const areaInc =
    htext.match(/(?:area|burst|emanation|cone|line|radius)[^.]*?increases?\s+by\s+(\d+)\s*feet/i) ||
    htext.match(/increases?\s+by\s+(\d+)\s*feet[^.]*?(?:area|burst|emanation|cone|line|radius)/i)
  if (areaInc && spell.area) {
    const baseA = spell.area.match(/(\d+)([\s-]*foot)/i)
    if (baseA) {
      const newA = parseInt(baseA[1], 10) + applications * parseInt(areaInc[1], 10)
      out.area = spell.area.replace(/(\d+)([\s-]*foot)/i, `$1 (${newA})$2`)
    }
  }

  if (!out.damage.length && !out.range && !out.area) return null
  return out
}

/** Apply the damage text replacements to a description string. */
export function applyHeightenedDamage(description: string, h: SpellHeightening): string {
  let s = description
  for (const { from, to } of h.damage) s = s.replace(from, to)
  return s
}
