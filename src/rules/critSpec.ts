/*
 * Weapon-group critical specialization effects.
 *
 * The effect that triggers on a critical hit with a weapon of the given group,
 * IF the attacker has critical specialization with it (granted by certain class
 * features/feats). Shown on a Strike when the character has it, and in the item
 * popup only where the weapon's own page does not give the record's group effect
 * itself (card step 14, rule C2: CRIT_SPEC_PAGE_BUCKET below). One concise sentence
 * per group.
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

/**
 * Card step 14 (docs/card-design.md section 5, "Crit-spec block"): the bucket of the weapon group pages
 * a weapon's page embeds under "Critical Specialization Effects" (src/sheet/astStubs.ts). Rule C2 (the page
 * is the truth, read whole; src/sheet/ItemDetail.tsx showCrit): the item popup leaves out its own sentence
 * above where (i) the card draws the record's OWN group page (the effect shown once, in the page's words),
 * or (ii) the card draws another group's page and the page prints no "Group" line naming the record's group
 * (true record drift: alchemical-crossbow's record says crossbow, its page prints and draws Bow — the
 * `drift` list of work/card-step14-weapon-group-drift.json). Otherwise the sentence stays, marked as ours:
 * a combination weapon's melee half prints its own group ("Group Axe") but embeds only the ranged group's
 * page (the `combination` list), so the page gives the firearm effect and we give the axe one.
 */
export const CRIT_SPEC_PAGE_BUCKET = 'weaponGroup';

/** The group's own Archives page, "weaponGroup:<group>" (card step 14). */
export function critSpecPageRef(group?: string): string | undefined {
  return group ? `${CRIT_SPEC_PAGE_BUCKET}:${group}` : undefined;
}
