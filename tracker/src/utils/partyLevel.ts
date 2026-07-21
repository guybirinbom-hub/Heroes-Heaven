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
 * Party level from the individual character levels.
 *
 * Returns `null` for an empty party — callers keep their own fallback rather than being handed a
 * fabricated level (a made-up 1 is what caused the original bug).
 *
 * MIXED LEVELS: PF2e's encounter-building table assumes every PC is the SAME level, and gives no
 * rule for a split party — so the rounded average here is a deliberate choice, not a cited rule.
 * It's the common convention and it degenerates to the exact right answer in the normal case where
 * every character shares a level. A badly split party makes encounters swingy no matter what number
 * goes in, so no single value can be "correct" there.
 */
export function derivePartyLevel(levels: readonly number[]): number | null {
  // Anything that isn't a real character level is dropped, not counted as zero — a name-only PC
  // averaged in as 0 would drag a level-4 party down to 3. Since nothing below 1 survives the
  // filter, the average is always >= 1 and needs no clamping.
  const valid = levels.filter((l) => Number.isFinite(l) && l >= 1)
  if (valid.length === 0) return null
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length
  return Math.round(avg)
}
