/*
 * Condition effects on the derived numbers.
 *
 * PF2e penalties stack by TYPE, not additively: when several penalties of the same
 * type (status / circumstance / item) apply to one roll, only the worst counts;
 * penalties of different types sum. So a Frightened 2 + Clumsy 1 character's AC takes
 * −2 (worst status), and if also Off-guard, −2 more (a circumstance penalty) = −4.
 *
 * Most valued conditions map to an attribute: Clumsy→Dex, Enfeebled→Str, Drained→Con,
 * Stupefied→Int/Wis/Cha. Frightened and Sickened hit every check and DC. A handful are
 * flat (Fatigued −1 to AC & saves; Off-guard/Prone/Restrained/Grabbed −2 circ AC; Prone also −2 circ attacks).
 *
 * Out of scope (no flat number to display): action-economy conditions (Slowed, Stunned,
 * Quickened), and situational ones (Blinded, Dazzled, Deafened, Confused, …).
 */
import type { AbilityId, ActiveCondition, Character } from './types';

/** A derived value a condition can penalize. */
export type ConditionSlot =
  | 'ac'
  | 'save'
  | 'perception'
  | 'skill'
  | 'attack'
  | 'damage'
  | 'spell-attack'
  | 'spell-dc'
  | 'class-dc';

interface ConditionEffect {
  type: 'status' | 'circumstance';
  /** 'valued' uses the condition's numeric value; a number is a fixed amount. */
  amount: 'valued' | number;
  /** Applies when the value's governing attribute is one of these. */
  abilities?: AbilityId[];
  /** Applies to these specific slots regardless of attribute. */
  slots?: ConditionSlot[];
  /** Applies to every check and DC (i.e. every slot except raw damage). */
  allChecks?: boolean;
}

const CONDITION_EFFECTS: Record<string, ConditionEffect[]> = {
  frightened: [{ type: 'status', amount: 'valued', allChecks: true }],
  sickened: [{ type: 'status', amount: 'valued', allChecks: true }],
  clumsy: [{ type: 'status', amount: 'valued', abilities: ['dex'] }],
  enfeebled: [{ type: 'status', amount: 'valued', abilities: ['str'] }],
  drained: [{ type: 'status', amount: 'valued', abilities: ['con'] }], // HP loss handled by drainedHpLoss
  stupefied: [{ type: 'status', amount: 'valued', abilities: ['int', 'wis', 'cha'] }],
  fatigued: [{ type: 'status', amount: 1, slots: ['ac', 'save'] }],
  // Encumbered makes you Clumsy 1 (Dex penalty) and reduces Speed by 10 ft (handled in deriveSpeeds).
  encumbered: [{ type: 'status', amount: 1, abilities: ['dex'] }],
  'off-guard': [{ type: 'circumstance', amount: 2, slots: ['ac'] }],
  // Prone makes you off-guard (−2 circ AC) AND gives −2 circ to your own attacks. Restrained and
  // Grabbed also make you off-guard (−2 circ AC). (Same circumstance type, so they don't stack with
  // off-guard — conditionPenalty takes the worst.)
  prone: [{ type: 'circumstance', amount: 2, slots: ['attack', 'ac'] }],
  restrained: [{ type: 'circumstance', amount: 2, slots: ['ac'] }],
  grabbed: [{ type: 'circumstance', amount: 2, slots: ['ac'] }],
};

function effectMatches(e: ConditionEffect, ability: AbilityId, slot: ConditionSlot): boolean {
  if (e.allChecks && slot !== 'damage') return true;
  // Perception is its own statistic, NOT a Wis-based check, so attribute-keyed conditions (Stupefied
  // lists 'wis') must not reach it through the ability match — only allChecks (Frightened/Sickened)
  // and explicit slots penalize Perception.
  if (e.abilities?.includes(ability) && slot !== 'perception') return true;
  if (e.slots?.includes(slot)) return true;
  return false;
}

/**
 * The total condition penalty (≤ 0) on a derived value, given its governing attribute
 * and slot. Worst status + worst circumstance, per the stacking rules.
 */
export function conditionPenalty(conditions: ActiveCondition[], ability: AbilityId, slot: ConditionSlot): number {
  let status = 0;
  let circumstance = 0;
  for (const c of conditions) {
    for (const e of CONDITION_EFFECTS[c.id] ?? []) {
      if (!effectMatches(e, ability, slot)) continue;
      const amt = e.amount === 'valued' ? c.value ?? 1 : e.amount;
      if (e.type === 'status') status = Math.max(status, amt);
      else circumstance = Math.max(circumstance, amt);
    }
  }
  return -(status + circumstance);
}

/** Max-HP reduction from Drained (value × level). */
export function drainedHpLoss(c: Character): number {
  const d = c.conditions.find((x) => x.id === 'drained');
  return d ? (d.value ?? 1) * c.level : 0;
}

/** The Dying value at which a character dies: 4 normally, reduced by their Doomed
 *  value (and never below 1). Reaching this Dying value means death. */
export function dyingDeathThreshold(doomed: number): number {
  return Math.max(1, 4 - Math.max(0, Math.round(doomed)));
}
