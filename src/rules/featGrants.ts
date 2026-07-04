/*
 * Feat-granted proficiencies (targeted, data-driven table — NOT a general operations engine).
 *
 * The proficiency pipeline (build.ts / advancement.ts) advances a character's saves, weapons, armor,
 * etc. from CLASS features only. But a number of feats — chiefly archetype dedications — also grant
 * proficiencies: Sentinel Dedication trains you in light + medium armor, Fighter Dedication trains
 * you in martial weapons, and so on. 0/6000+ feats carried a proficiency grant, and the pipeline
 * never read feats, so these did nothing (Sentinel's AC was wrong, Fighter Dedication's attack was
 * wrong, …).
 *
 * This table maps feat id → the proficiency ranks that feat GRANTS. buildCharacter applies each taken
 * feat's grants AFTER class advancement (so a dedication can raise a proficiency the class hasn't),
 * and only ever RAISES a rank (maxRank) — a class already expert in martial weapons keeps expert.
 *
 * Scope note: only UNCONDITIONAL grants belong here. Several dedications also carry conditional
 * clauses ("whenever you gain a class feature that grants you expert or greater proficiency in
 * armor, you also gain it here") — those depend on other features and are deliberately NOT modeled;
 * the base trained grant is. Each entry is verified against the Foundry feat text in .import-src.
 *
 * To add a feat: add an entry keyed by its core.json id with the ranks it grants. Extend FeatGrant
 * with new tracks as needed (they must be wired into applyFeatGrant in build.ts).
 */
import type { ArmorCategory, ProficiencyKey, ProficiencyRank, SaveId, SkillId, WeaponCategory } from './types';

export interface FeatGrant {
  /** Armor category → minimum rank granted (e.g. Sentinel Dedication: light+medium trained). */
  armor?: Partial<Record<ArmorCategory, ProficiencyRank>>;
  /** Weapon category → minimum rank granted (e.g. Fighter Dedication: martial trained). */
  weapon?: Partial<Record<WeaponCategory, ProficiencyRank>>;
  /** Save → minimum rank granted. */
  save?: Partial<Record<SaveId, ProficiencyRank>>;
  /** Perception minimum rank granted. */
  perception?: ProficiencyRank;
  /** Skill (or `lore:<subject>`) → minimum rank granted (e.g. Medic Dedication: Medicine expert). */
  skills?: Partial<Record<ProficiencyKey, ProficiencyRank>>;
  /**
   * Skill-training CHOICES the feat offers ("your choice of Acrobatics or Athletics"). Each entry is
   * one training slot; the player picks one skill from `options` (or any skill when `options: 'any'`).
   * The pick is stored in BuildState.featSkillChoices keyed `<featId>:<slot index>`; an unset slot
   * defaults to the first listed option (or Acrobatics for an 'any' slot). Grants training at `rank`
   * (RAISES only, like the static grants).
   */
  skillChoices?: { options: SkillId[] | 'any'; rank: ProficiencyRank }[];
  /**
   * The feat grants a BONUS skill feat the player picks (Rogue Dedication: "You gain a skill feat").
   * Injected as an extra level-<feat's level> skill-feat slot; the pick is stored in
   * BuildState.dedicationSkillFeats keyed by featId. Mirrors the Versatile-Human bonus-feat injection.
   */
  bonusSkillFeat?: boolean;
}

/**
 * Verified from .import-src Foundry feat text (Remaster).
 *
 * - Sentinel Dedication: "You become trained in light armor and medium armor." (The heavy-armor
 *   upgrade for those already trained in both, and the expert-armor follow-on tied to a class
 *   feature, are conditional and not modeled here.)
 * - Fighter Dedication (Player Core): "You become trained in martial weapons. You become trained in
 *   your choice of Acrobatics or Athletics… You become trained in fighter class DC." The martial
 *   weapons and the Acrobatics/Athletics training are modeled; class DC is per-class chassis. (The
 *   "if already trained in both, a skill of your choice" fallback is not modeled — the base choice is.)
 * - Rogue Dedication (Player Core): "You gain a skill feat and the rogue's Surprise Attack. You become
 *   trained in light armor. …you become trained in Stealth or Thievery plus one skill of your choice…
 *   You become trained in rogue class DC." Modeled: light armor + the Stealth/Thievery choice + one
 *   free-skill choice + a bonus skill feat. (Surprise Attack / rogue class DC are not proficiency grants.)
 * - Bastion Dedication: grants only the Reactive Shield feat — NO proficiency (intentionally absent).
 * - Medic Dedication: "You become an expert in Medicine."
 */
export const FEAT_GRANTS: Record<string, FeatGrant> = {
  'sentinel-dedication': { armor: { light: 'trained', medium: 'trained' } },
  'fighter-dedication': {
    weapon: { martial: 'trained' },
    skillChoices: [{ options: ['acrobatics', 'athletics'], rank: 'trained' }],
  },
  'rogue-dedication': {
    armor: { light: 'trained' },
    skillChoices: [{ options: ['stealth', 'thievery'], rank: 'trained' }, { options: 'any', rank: 'trained' }],
    bonusSkillFeat: true,
  },
  'medic-dedication': { skills: { medicine: 'expert' } },
};
