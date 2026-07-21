import type { Combatant } from '../types/pf2e'
import { applyWeakElite, scaleByLevel } from './weakElite'

// ─────────────────────────────────────────────────────────────────────────────
// PF2e Encounter Building rules — verified against GM Core / Archives of Nethys
// (Encounter Design → Building Encounters).
// ─────────────────────────────────────────────────────────────────────────────

/** XP award per adversary by (effective level − party level), clamped to the
 *  PF2e table's −4 / +4 bounds. Used for creatures AND complex hazards (the
 *  complex-hazard column equals the creature column). Verified against GM Core
 *  Table 10-1 / 10-2. */
const XP_BY_DIFF: Record<number, number> = {
  [-4]: 10, [-3]: 15, [-2]: 20, [-1]: 30,
  [0]:  40, [1]:  60, [2]:  80, [3]:  120, [4]:  160,
}

/** XP award for a SIMPLE hazard by (effective level − party level). Explicit
 *  rather than computed so it matches the GM Core table exactly. */
const SIMPLE_HAZARD_XP_BY_DIFF: Record<number, number> = {
  [-4]: 2, [-3]: 3, [-2]: 4, [-1]: 6,
  [0]:  8, [1]:  12, [2]:  16, [3]:  24, [4]:  32,
}

/** Encounter budget thresholds for a party of 4 PCs.
 *
 *  Per GM Core:
 *    Trivial  ≤ 40 XP   (character adjustment ±10 per PC)
 *    Low      = 60 XP   (character adjustment ±20 per PC)
 *    Moderate = 80 XP   (character adjustment ±20 per PC)
 *    Severe   = 120 XP  (character adjustment ±30 per PC)
 *    Extreme  = 160 XP  (character adjustment ±40 per PC)
 *
 *  Note: each difficulty has its OWN per-PC adjustment value — they're not
 *  all the same. The previous implementation used 20 for every tier and the
 *  threshold values were one tier too low, so encounters were classified
 *  one step harder than they actually were. */
interface Tier { base: number; adjust: number }
const BUDGET = {
  trivial:  { base: 40,  adjust: 10 } as Tier,
  low:      { base: 60,  adjust: 20 } as Tier,
  moderate: { base: 80,  adjust: 20 } as Tier,
  severe:   { base: 120, adjust: 30 } as Tier,
  extreme:  { base: 160, adjust: 40 } as Tier,
}

export type Difficulty = 'Trivial' | 'Low' | 'Moderate' | 'Severe' | 'Extreme'

export interface EncounterStats {
  /** Total adjusted XP value of all participating enemies + hazards. */
  xp: number
  difficulty: Difficulty
  /** How many enemy combatants contributed to the XP total (excludes PCs and
   *  allies; defeated enemies still count toward the fixed award). Hazards
   *  count individually. */
  enemyCount: number
  /** The per-party-size budget thresholds the XP was compared against —
   *  exposed so the InitiativeTracker can show "X / Y XP" toward the next
   *  difficulty tier. */
  budget: {
    trivial:  number
    low:      number
    moderate: number
    severe:   number
    extreme:  number
  }
  /** The XP awarded to each PC at this encounter level. Per GM Core:
   *  "XP awards for the encounter don't change — you'll always award the
   *  amount of XP listed for a group of four characters." So the per-PC
   *  award is the unscaled threshold for the achieved difficulty. */
  award: number
}

/** XP award for a single enemy or hazard, given its effective level and the
 *  party's average level. Both columns are exact lookups from GM Core:
 *    - Creatures + COMPLEX hazards → XP_BY_DIFF
 *    - SIMPLE hazards → SIMPLE_HAZARD_XP_BY_DIFF
 */
function enemyXp(effLevel: number, partyLevel: number, isSimpleHazard: boolean): number {
  const diff = Math.max(-4, Math.min(4, effLevel - partyLevel))
  return isSimpleHazard ? (SIMPLE_HAZARD_XP_BY_DIFF[diff] ?? 0) : (XP_BY_DIFF[diff] ?? 0)
}

/**
 * Calculate encounter XP and difficulty for the current initiative lineup.
 *
 * - Counts as an enemy: any combatant that is not a PC, not an ally, and has
 *   a creature stat block. Defeated enemies are still counted so the XP award
 *   stays fixed for the whole encounter.
 * - `partyLevel` — the level of the PC party (all PCs assumed at this level).
 * - `partySize` — the number of PCs (used to scale every difficulty threshold
 *   by its own per-PC adjustment; smaller parties have proportionally
 *   smaller budgets, larger parties proportionally bigger).
 */
export function computeEncounter(
  combatants: Combatant[],
  partyLevel: number,
  partySize: number,
): EncounterStats {
  // An NPC contributes to the encounter XP only when it has a stat block
  // (`c.creature != null`). A name-only NPC has no level we can plug into
  // the XP table, so we drop it from the budget entirely — same way the
  // party-size calculation drops name-only allies. The NPC's effective
  // level (for the XP table) is read straight off the stat block,
  // optionally adjusted by weak/elite/scaled-to-level.
  //
  // Defeated enemies STILL count: the XP shown is the encounter's total
  // award, which the party earns for overcoming the whole encounter. It
  // must stay fixed as creatures drop to 0 HP so the GM can read the final
  // award after the fight (and so the badge doesn't vanish once everything
  // is defeated). To exclude a creature from the award, remove it from the
  // tracker rather than defeating it.
  const enemies = combatants.filter(
    c => !c.isPC && !c.isAlly && c.creature != null,
  )

  let xp = 0
  for (const c of enemies) {
    const eff = c.scaledToLevel !== undefined
      ? scaleByLevel(c.creature!, c.scaledToLevel)
      : applyWeakElite(c.creature!, c.isElite ? 'elite' : c.isWeak ? 'weak' : 'normal')
    // Hazards have `isHazard: true`; their `hazardData.complex` flag tells
    // us whether to apply the simple-hazard XP discount.
    const isHazard = !!eff.isHazard
    const isSimpleHazard = isHazard && eff.hazardData?.complex === false
    xp += enemyXp(eff.level, partyLevel, isSimpleHazard)
  }

  // Each difficulty tier scales by its own per-PC adjustment value.
  const extra = partySize - 4
  const trivialT  = BUDGET.trivial.base  + extra * BUDGET.trivial.adjust
  const lowT      = BUDGET.low.base      + extra * BUDGET.low.adjust
  const moderateT = BUDGET.moderate.base + extra * BUDGET.moderate.adjust
  const severeT   = BUDGET.severe.base   + extra * BUDGET.severe.adjust
  const extremeT  = BUDGET.extreme.base  + extra * BUDGET.extreme.adjust

  let difficulty: Difficulty = 'Trivial'
  let award = BUDGET.trivial.base
  if (xp >= extremeT)        { difficulty = 'Extreme';  award = BUDGET.extreme.base }
  else if (xp >= severeT)    { difficulty = 'Severe';   award = BUDGET.severe.base }
  else if (xp >= moderateT)  { difficulty = 'Moderate'; award = BUDGET.moderate.base }
  else if (xp >= lowT)       { difficulty = 'Low';      award = BUDGET.low.base }

  return {
    xp,
    difficulty,
    enemyCount: enemies.length,
    budget: { trivial: trivialT, low: lowT, moderate: moderateT, severe: severeT, extreme: extremeT },
    award,
  }
}

export const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  Trivial:  '#6a7a6a',
  Low:      '#4a9a55',
  Moderate: '#a89020',
  Severe:   '#c07020',
  Extreme:  '#a03030',
}
