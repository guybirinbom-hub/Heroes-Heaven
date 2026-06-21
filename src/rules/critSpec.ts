/*
 * Weapon-group critical specialization effects.
 *
 * The effect that triggers on a critical hit with a weapon of the given group,
 * IF the attacker has critical specialization with it (granted by certain class
 * features/feats). Shown as reference on each Strike — the sheet does not assert
 * the character has access. One concise sentence per group.
 *
 * Source: Archives of Nethys "Critical Specialization Effects"
 * (https://2e.aonprd.com/WeaponGroups.aspx), cross-checked against the Grievous
 * rune's per-group upgrades. Save effects use your class DC or spell DC.
 */
export const CRIT_SPEC: Record<string, string> = {
  axe: 'Deal damage to one creature adjacent to the target equal to the weapon damage dice you rolled (plus any weapon specialization damage).',
  bomb: "Increase the radius of the bomb's splash damage to 10 feet.",
  bow: 'If the target is adjacent to a surface, it is stuck to that surface and immobilized until it Escapes (or the ammunition is pulled free with an Interact action).',
  brawling: 'The target must succeed at a Fortitude save or be slowed 1 until the end of your next turn.',
  club: 'You knock the target up to 10 feet away from you (your choice of direction).',
  crossbow: 'The target takes 1d8 persistent bleed damage.',
  dart: 'The target takes 1d6 persistent bleed damage.',
  firearm: 'The target must succeed at a Fortitude save or be stunned 1.',
  flail: 'The target is knocked prone.',
  hammer: 'The target is knocked prone.',
  knife: 'The target takes 1d6 persistent bleed damage.',
  pick: 'The weapon viciously pierces the target, dealing 2 additional damage per weapon damage die.',
  polearm: 'You move the target 5 feet in a direction of your choice (forced movement).',
  shield: 'You knock the target back up to 5 feet (forced movement).',
  sling: 'The target must succeed at a Fortitude save or be stunned 1.',
  spear: 'The target is clumsy 1 until the start of your next turn.',
  sword: 'The target is off-guard until the start of your next turn.',
};

/** The critical specialization effect for a weapon group, if known. */
export function critSpec(group?: string): string | undefined {
  return group ? CRIT_SPEC[group] : undefined;
}
