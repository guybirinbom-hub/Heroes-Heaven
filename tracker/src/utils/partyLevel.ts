/**
 * The party's level for encounter building — derived from the characters, never typed.
 *
 * WHY THIS EXISTS
 * ---------------
 * Party level was a hand-entered number (`Party.level`, plus a `pf2e-party-level` localStorage
 * fallback). It drives the ENTIRE encounter budget — `enemyXp()` scores every creature by
 * `effLevel - partyLevel`, so a wrong party level silently mis-rates every encounter. Inside a
 * Heroes Heaven campaign that number defaulted to 1 while the real characters were level 3, and
 * nothing connected the two: the tracker rated a level-3 party's fights against a level-1 budget.
 *
 * The characters already know their own levels, so the number is derivable and the input was just
 * a way to be wrong. This is the one place that turns "the levels in the party" into "the level to
 * build encounters against".
 */

/**
 * GM Core pg. 57, "Group Parity and Party Level" (Archives rules-2653), the one printed rule for a
 * party whose members are at different levels:
 *
 *  - "Use the highest level if only one or two characters are behind, or an average if everyone is
 *    at a different level." Read as: two or fewer below the top → the top level; more → the
 *    rounded average (print names no third case, so "more than two behind" takes the average).
 *  - "...adjust the encounters as if there were one additional PC for every 2 levels the
 *    higher-level character has beyond the rest of the party." Applied AFTER the choice above:
 *    anyone 2+ levels above the chosen level adds floor(gap / 2) members (`extra`).
 *  - Print says nothing about scaling a WEAKER member down, so nobody counts for less than one —
 *    and a weaker member never drags the level down to its own (orchestrator's ruling for item 5:
 *    the two steps above, in that order, and nothing else; [5, 1] is level 5, not 1).
 *
 * Every level counts that is a finite number (a creature can be level −1 or 0); the callers decide
 * what a usable level is for their kind of member. Null for no levels at all.
 */
export interface PartyLevelRule {
  /** The level to build encounters against. */
  level: number
  /** Additional party members for anyone 2+ levels above `level` (one per 2 levels). */
  extra: number
}

export function partyLevelRule(levels: readonly number[]): PartyLevelRule | null {
  const valid = levels.filter((l) => Number.isFinite(l))
  if (valid.length === 0) return null
  const level = pickLevel([...valid].sort((a, b) => b - a))
  return { level, extra: extraMembers(valid, level) }
}

/** pg. 57's additional members: floor(gap / 2) for each level 2+ above `level`. Split out so a
 *  caller can take the LEVEL over one set of members and the extras over another (encounter.partyOf:
 *  the level over everyone in the order, the extras over those still standing). */
export function extraMembers(levels: readonly number[], level: number): number {
  let extra = 0
  for (const l of levels) if (Number.isFinite(l) && l >= level + 2) extra += Math.floor((l - level) / 2)
  return extra
}

/** pg. 57's choice over levels sorted high → low: the top one if at most two are behind it, else the
 *  rounded average. */
function pickLevel(desc: readonly number[]): number {
  const top = desc[0]
  const behind = desc.filter((l) => l < top).length
  if (behind <= 2) return top
  return Math.round(desc.reduce((a, b) => a + b, 0) / desc.length)
}

/**
 * Party level from the individual CHARACTER levels (the campaign roster's fallback).
 *
 * Returns `null` for an empty party — callers keep their own fallback rather than being handed a
 * fabricated level (a made-up 1 is what caused the original bug).
 *
 * MIXED LEVELS: GM Core pg. 57 gives the rule (partyLevelRule above) — this used to say print had
 * none and took a plain rounded average, which disagrees with pg. 57 whenever one or two
 * characters are behind (the highest level).
 */
export function derivePartyLevel(levels: readonly number[]): number | null {
  // Anything that isn't a real character level is dropped, not counted as zero — a name-only PC
  // counted as 0 would drag a level-4 party down to 3. A character is never below level 1.
  const valid = levels.filter((l) => Number.isFinite(l) && l >= 1)
  return partyLevelRule(valid)?.level ?? null
}
