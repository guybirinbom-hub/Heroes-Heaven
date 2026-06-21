/*
 * Automatic Bonus Progression (GMG / GM Core optional variant rule).
 *
 * Replaces the numeric bonuses that fundamental runes (and stat items) normally grant — characters
 * get them automatically by level instead. All ABP bonuses are "potency" bonuses, so when ABP is on
 * the matching fundamental rune contributes nothing numeric (property runes still work).
 */

/** The highest table value whose threshold level the character has reached (0 below the first). */
function byLevel(table: Record<number, number>, level: number): number {
  let v = 0;
  for (const lvl of Object.keys(table).map(Number).sort((a, b) => a - b)) if (level >= lvl) v = table[lvl];
  return v;
}

const ATTACK_POTENCY = { 2: 1, 10: 2, 16: 3 };
const DEFENSE_POTENCY = { 5: 1, 11: 2, 18: 3 };
const SAVE_POTENCY = { 8: 1, 14: 2, 20: 3 };
const PERCEPTION_POTENCY = { 7: 1, 13: 2, 19: 3 };
/** Devastating Attacks — EXTRA weapon damage dice (striking 1 @4, greater 2 @12, major 3 @19). */
const STRIKING_DICE = { 4: 1, 12: 2, 19: 3 };

/** ABP attack-roll bonus (replaces weapon potency runes). */
export const abpAttack = (level: number): number => byLevel(ATTACK_POTENCY, level);
/** ABP AC bonus (replaces armor potency runes). */
export const abpDefense = (level: number): number => byLevel(DEFENSE_POTENCY, level);
/** ABP saving-throw bonus (replaces resilient runes). */
export const abpSave = (level: number): number => byLevel(SAVE_POTENCY, level);
/** ABP Perception bonus. */
export const abpPerception = (level: number): number => byLevel(PERCEPTION_POTENCY, level);
/** ABP extra weapon/unarmed damage dice (replaces striking runes). */
export const abpStrikingDice = (level: number): number => byLevel(STRIKING_DICE, level);

// Skill potency: by level you may give item bonuses to a growing set of skills, with caps on how many
// can reach +2 and +3. (Schedule from AoN: choose at 3/6/13/15/17/20, raise at 9/13/15/17/20 — net at
// L20 ≈ two +3, the rest +2/+1.) We expose it as a budget the picker validates, letting any legal
// distribution within the caps rather than enforcing the exact add-then-raise order.
const SKILL_SLOTS = { 3: 1, 6: 2, 9: 2, 13: 3, 15: 4, 17: 5, 20: 6 };
const SKILL_RANK2 = { 9: 1, 13: 2, 15: 3 }; // how many skills may be at +2 OR HIGHER
const SKILL_RANK3 = { 17: 1, 20: 2 }; // how many skills may be at +3

export interface AbpSkillBudget {
  /** Max number of skills that may carry any potency bonus. */
  total: number;
  /** Max number of those that may be +2 or higher. */
  rank2: number;
  /** Max number of those that may be +3. */
  rank3: number;
}
export function abpSkillBudget(level: number): AbpSkillBudget {
  return { total: byLevel(SKILL_SLOTS, level), rank2: byLevel(SKILL_RANK2, level), rank3: byLevel(SKILL_RANK3, level) };
}

/** The ABP skill-potency item bonus for one skill (0 when ABP is off or the skill isn't chosen). */
export function abpSkillBonus(c: { variantRules?: { abp?: boolean }; abpSkills?: Record<string, number> }, key: string): number {
  return c.variantRules?.abp ? c.abpSkills?.[key] ?? 0 : 0;
}

/** Whether the character opted into Automatic Bonus Progression. */
export function abpOn(c: { variantRules?: { abp?: boolean } }): boolean {
  return !!c.variantRules?.abp;
}
