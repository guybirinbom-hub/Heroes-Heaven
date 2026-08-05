/*
 * Armor-group specialization effects.
 *
 * "Certain class features can grant you additional benefits with certain armors. This is called an
 * armor specialization effect. The exact effect depends on which armor group your armor belongs to."
 *
 * Source: Player Core pg. 272 (chain/composite/leather/plate) and Treasure Vault pg. 8-9
 * (skeletal/wood), transcribed from the AoN mirror at by-category/armor-group.
 *
 * WHY THIS IS A TS TABLE AND NOT DATA. Every value is `base + the ARMOR's potency rune`, and the
 * formula evaluator cannot express that: FormulaScope is {level, abilities, speeds}, and an @token it
 * does not recognise resolves to 0 SILENTLY rather than erroring. A data formula would have looked
 * right and quietly granted nothing. The seven armorGroup records in core.json are bare
 * {id, name, edition} stubs with no effect text, so there was nothing to read even if it could.
 *
 * ONLY MEDIUM AND HEAVY ARMOR has a specialization effect. Every group text defines a medium value
 * and a heavy value and no other, so light and unarmored yield nothing — including for a record that
 * unlocks light armor specifically (Unshaken in Iron). That is the rule as printed, not an omission.
 */
import type { ArmorCategory } from './types';

export interface ArmorSpecEffect {
  /**
   * How the effect lands.
   *   'resistance'  a true damage-type resistance, into the resistance map under `type`.
   *   'critReduction' chain: reduces damage FROM critical hits. Carried under the 'critical-hits'
   *                 IwrEntry key the data already uses elsewhere, with a floor the engine can't model.
   *   'reactive'    wood: damages the ATTACKER. Not a defence at all, so it grants no resistance.
   *   'none'        cloth: AoN states outright there is none — there is no medium or heavy cloth armor.
   */
  kind: 'resistance' | 'critReduction' | 'reactive' | 'none';
  /** The IWR key for 'resistance' and 'critReduction'. */
  type?: string;
  /** base value at medium / heavy; the armor's potency rune is added to whichever applies. */
  medium?: number;
  heavy?: number;
  /** Shown to the player for the parts the numbers can't carry. */
  note?: string;
}

export const ARMOR_SPEC: Record<string, ArmorSpecEffect> = {
  plate: { kind: 'resistance', type: 'slashing', medium: 1, heavy: 2 },
  leather: { kind: 'resistance', type: 'bludgeoning', medium: 1, heavy: 2 },
  composite: { kind: 'resistance', type: 'piercing', medium: 1, heavy: 2 },
  skeletal: { kind: 'resistance', type: 'precision', medium: 3, heavy: 5 },
  chain: {
    kind: 'critReduction',
    type: 'critical-hits',
    medium: 4,
    heavy: 6,
    note: "can't reduce a critical hit below the damage rolled before doubling",
  },
  wood: {
    kind: 'reactive',
    medium: 3,
    heavy: 5,
    note: 'a foe that critically hits you with a melee attack while adjacent takes this much piercing damage',
  },
  cloth: { kind: 'none', note: 'there is no medium or heavy cloth armor, so there is no effect' },
};

/**
 * The specialization value for a group at a category, given the armor's potency rune.
 *
 * Returns 0 for light/unarmored (no group defines a value for them), for an unknown group, and for
 * cloth. `potency` is the ARMOR's potency rune — not the character's level and not a weapon's.
 */
export function armorSpecValue(group: string | undefined, category: ArmorCategory, potency: number): number {
  const eff = group ? ARMOR_SPEC[group] : undefined;
  if (!eff || eff.kind === 'none') return 0;
  const base = category === 'heavy' ? eff.heavy : category === 'medium' ? eff.medium : undefined;
  return base == null ? 0 : base + Math.max(0, potency);
}

/** The effect for a group, or undefined when the group has none. */
export function armorSpecEffect(group: string | undefined): ArmorSpecEffect | undefined {
  const eff = group ? ARMOR_SPEC[group] : undefined;
  return eff && eff.kind !== 'none' ? eff : undefined;
}
