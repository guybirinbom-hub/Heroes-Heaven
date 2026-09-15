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
 * Out of scope (the entry prints NO flat number): action-economy conditions (Slowed, Stunned,
 * Quickened), the detection ones (Concealed, Dazzled, Hidden, Invisible — flat checks, not modifiers),
 * and the bookkeeping ones (Doomed, Dying, Wounded, Petrified, Fleeing, Immobilized).
 *
 * A condition the GM hands a player has to WORK LIKE A MODE on the sheet — mechanical, visible,
 * removable — so every entry that DOES print a flat number belongs here even when the rest of the
 * entry is situational. tracker/src/utils/conditionEffects.ts holds the same numbers for the GM's
 * initiative tracker; test/bug-condition-table-parity.test.ts fails if the two ever drift apart.
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
  /** Applies to these specific slots regardless of attribute. Set TOGETHER with `abilities` to mean
   *  the intersection — one slot keyed to one attribute (Unconscious's "Reflex saves"). */
  slots?: ConditionSlot[];
  /** Applies to every check and DC (i.e. every slot except raw damage). */
  allChecks?: boolean;
  /** The attribute match ALSO reaches damage rolls. Only Enfeebled penalizes damage (Str damage) — Clumsy,
   *  Drained, and Stupefied penalize rolls/DCs, never the damage bonus. */
  includesDamage?: boolean;
}

const CONDITION_EFFECTS: Record<string, ConditionEffect[]> = {
  frightened: [{ type: 'status', amount: 'valued', allChecks: true }],
  sickened: [{ type: 'status', amount: 'valued', allChecks: true }],
  clumsy: [{ type: 'status', amount: 'valued', abilities: ['dex'] }],
  enfeebled: [{ type: 'status', amount: 'valued', abilities: ['str'], includesDamage: true }], // Str checks + Str damage
  drained: [{ type: 'status', amount: 'valued', abilities: ['con'] }], // HP loss handled by drainedHpLoss
  stupefied: [{ type: 'status', amount: 'valued', abilities: ['int', 'wis', 'cha'] }], // mental checks/DCs incl. Perception (Wis)
  fatigued: [{ type: 'status', amount: 1, slots: ['ac', 'save'] }],
  // Encumbered makes you Clumsy 1 (Dex penalty) and reduces Speed by 10 ft (handled in deriveSpeeds).
  encumbered: [{ type: 'status', amount: 1, abilities: ['dex'] }],
  'off-guard': [{ type: 'circumstance', amount: 2, slots: ['ac'] }],
  // Prone makes you off-guard (−2 circ AC) AND gives −2 circ to your own attacks. Restrained and
  // Grabbed also make you off-guard (−2 circ AC). (Same circumstance type, so they don't stack with
  // off-guard — conditionPenalty takes the worst.)
  prone: [{ type: 'circumstance', amount: 2, slots: ['attack', 'spell-attack', 'ac'] }],
  restrained: [{ type: 'circumstance', amount: 2, slots: ['ac'] }],
  grabbed: [{ type: 'circumstance', amount: 2, slots: ['ac'] }],

  /* ── The six the sheet used to ignore ─────────────────────────────────────────────────────────
   * Each of these prints a flat number the GM expects to see on the player's sheet. Every quote
   * below is the PLAYER CORE printing, read off the live Archives rather than a play aid — the
   * legacy Core Rulebook text says "flat-footed" where the remaster says "off-guard", and the
   * tracker lane found rows that had been built from the older wording. */

  // "You take a –4 status penalty to AC, Perception, and Reflex saves, and you have the blinded and
  //  off-guard conditions." (Player Core p. 446.) Three rows: the AC/Perception pair, REFLEX ONLY
  //  (the dex save — `abilities` + `slots` together, so it doesn't leak onto AC, ranged attacks and
  //  the Dex skills the way a bare dex row would), and the off-guard −2 circumstance AC. The granted
  //  blinded condition's own −4 status to Perception is the same type and number, so it never doubles.
  unconscious: [
    { type: 'status', amount: 4, slots: ['ac', 'perception'] },
    { type: 'status', amount: 4, slots: ['save'], abilities: ['dex'] },
    { type: 'circumstance', amount: 2, slots: ['ac'] },
  ],
  // "You take a –2 status penalty to Perception and skill checks, and you can't use concentrate
  //  actions unless they (or their intended consequences) are related to the subject of your
  //  fascination…" (Player Core p. 443.) Every skill, whatever its attribute — the `skill` slot.
  fascinated: [{ type: 'status', amount: 2, slots: ['perception', 'skill'] }],
  // "…if vision is your only precise sense, you take a –4 status penalty to Perception checks."
  //  (Player Core p. 442.) NOTE: the sheet cannot know whether this character has a second precise
  //  sense, so the penalty is applied AS PRINTED — a character with precise scent or echolocation
  //  clears it with an Override. The rest of the entry (auto-crit-fail sight checks, difficult
  //  terrain, immunity to visual effects) carries no number to show.
  blinded: [{ type: 'status', amount: 4, slots: ['perception'] }],
  // "You take a –2 status penalty to Perception checks for initiative and checks that involve sound
  //  but also rely on other senses." (Player Core p. 443.) NOTE: there is no `initiative` slot and no
  //  per-check "involves sound" flag, so the closest existing target is the whole Perception slot —
  //  WIDER than print for a purely visual Perception check.
  deafened: [{ type: 'status', amount: 2, slots: ['perception'] }],
  // "You are off-guard, you don't treat anyone as your ally…" (Player Core p. 442.) The off-guard
  //  half is the only number in the entry; the random targeting is the GM's to run.
  confused: [{ type: 'circumstance', amount: 2, slots: ['ac'] }],
  // "You have the off-guard condition and can't act except to Recall Knowledge and use actions that
  //  require only your mind…" (Player Core p. 445.)
  paralyzed: [{ type: 'circumstance', amount: 2, slots: ['ac'] }],
};

/** Every condition id this table carries a row for. The parity guard sweeps exactly these against
 *  the tracker's table, so an id added or dropped on either side has to be accounted for there. */
export const CONDITION_EFFECT_IDS: readonly string[] = Object.keys(CONDITION_EFFECTS);

function effectMatches(e: ConditionEffect, ability: AbilityId, slot: ConditionSlot): boolean {
  if (e.allChecks && slot !== 'damage') return true;
  // Governing-attribute match. Perception IS a Wisdom-based roll (its attribute is Wis; Foundry's Perception
  // check carries the `wis-based` domain, exactly like Stealth carries `dex-based`), so a wis-keyed condition
  // like Stupefied DOES penalize Perception per RAW ("Wisdom-based rolls and DCs, including …" — non-exhaustive).
  // Only wis-keyed conditions reach it here since derivePerception passes 'wis'. The match reaches DAMAGE only
  // for conditions that penalize damage (Enfeebled → Str damage), so Clumsy/Drained/Stupefied don't touch damage.
  // Both listed means the INTERSECTION, not the union. Unconscious prints "–4 … to AC, Perception,
  // and Reflex saves"; Reflex is the Dex save, and a bare dex row would also have hit AC, ranged
  // attacks and Acrobatics/Stealth/Thievery — none of which that sentence names. No other row sets
  // both, so this branch changes nothing that was already here.
  if (e.abilities && e.slots) return e.abilities.includes(ability) && e.slots.includes(slot);
  if (e.abilities?.includes(ability)) return slot !== 'damage' || !!e.includesDamage;
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

/** Condition penalties as raw typed mods (negative), so they pool by type WITH mode/stance modifiers
 *  instead of being summed independently — a frightened status penalty and a mode's status penalty
 *  take the worst, not both. Returns only the non-zero status / circumstance penalties. */
export function conditionTypedMods(conditions: ActiveCondition[], ability: AbilityId, slot: ConditionSlot): { type: 'status' | 'circumstance'; value: number }[] {
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
  const out: { type: 'status' | 'circumstance'; value: number }[] = [];
  if (status) out.push({ type: 'status', value: -status });
  if (circumstance) out.push({ type: 'circumstance', value: -circumstance });
  return out;
}

/**
 * The Drained value this character actually suffers.
 *
 * *"When you have the drained condition, calculate the penalty to your Fortitude saves and your Hit
 * Point reduction AS THOUGH THE CONDITION VALUE WERE 1 LOWER."* (Svetocher — the only record in the
 * corpus printing this, checked rather than assumed.) It is a reduction of the CONDITION, not a bonus:
 * ours modelled it as a flat `maxHpBonus` of 1 per level, which paid out permanently, so a svetocher
 * who had never been drained walked around with extra Hit Points.
 *
 * Never below 0 — a character at drained 1 with this feat suffers nothing, which is what "one lower"
 * means at 1.
 */
export function effectiveDrainedValue(c: Character): number {
  const d = c.conditions.find((x) => x.id === 'drained');
  if (!d) return 0;
  return Math.max(0, (d.value ?? 1) - (c.drainedReduction ?? 0));
}

/** Max-HP reduction from Drained (value × level), after any reduction the character's feats grant. */
export function drainedHpLoss(c: Character): number {
  return effectiveDrainedValue(c) * c.level;
}

/**
 * The character's conditions with Drained lowered by whatever their feats reduce it by.
 *
 * The penalty functions take a CONDITIONS ARRAY rather than the character, so they cannot see the
 * reduction themselves. Callers that compute something the printed clause names — the Fortitude save —
 * pass this instead of `c.conditions`.
 *
 * ⚠ Deliberately NOT applied everywhere Drained appears. Svetocher reduces the penalty to *"your
 * FORTITUDE SAVES and your Hit Point reduction"* and nothing else, so a Constitution-based check that
 * is not a Fortitude save still suffers the full value.
 */
export function conditionsWithDrainedReduction(c: Character): ActiveCondition[] {
  const reduce = c.drainedReduction ?? 0;
  if (!reduce) return c.conditions;
  return c.conditions.map((x) => (x.id === 'drained' ? { ...x, value: Math.max(0, (x.value ?? 1) - reduce) } : x));
}

/**
 * The Dying value at which a character dies: 4 normally, reduced by their Doomed value (and never
 * below 1). Reaching this Dying value means death.
 *
 * `base` is 4 unless a feat says otherwise — Diehard's entire content is "you die from the dying
 * condition at dying 5, rather than dying 4", and this function ignoring it made the feat inert.
 * Pass `character.dyingThreshold`.
 *
 * `doomedReduction` is how much less Doomed counts for this character — Vivacious Gnome: *"The doomed
 * condition affects you as if its value were 1 lower"*, so doomed 1 does nothing and doomed 2 kills
 * at dying 3. Pass `character.doomedReduction`. It cannot push the threshold ABOVE the base: a doomed
 * value below the reduction counts as 0, not as a negative number.
 */
export function dyingDeathThreshold(doomed: number, base = 4, doomedReduction = 0): number {
  return Math.max(1, base - Math.max(0, Math.round(doomed) - Math.max(0, doomedReduction)));
}
