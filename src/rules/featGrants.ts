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
  /**
   * Grants selected by the player's pick in the feat's own `choice` dropdown ("expert in your choice
   * of Fortitude, Reflex, Will, or Perception"), keyed by the choice VALUE exactly as core.json
   * stores it. The importer leaves some of those values as raw Foundry paths
   * (`system.saves.will.rank`), so the keys here are matched verbatim rather than prettified — see
   * CANNY_ACUMEN_TRACKS below.
   *
   * The matching entry is applied like a static grant (RAISES only). Nested choiceGrants are ignored.
   */
  choiceGrants?: Record<string, FeatGrant>;
  /**
   * This feat's granted ranks improve once the character reaches `level` (Canny Acumen grants expert,
   * then master at 17). Applied to every rank this feat grants, static or choice-driven, and still
   * only ever RAISES.
   */
  rankUpgrade?: { level: number; rank: ProficiencyRank };
  /**
   * Armor Proficiency's cascade. The feat's three ChoiceSet options (light/medium/heavy) are gated by
   * mutually-exclusive predicates so that EXACTLY ONE is ever legal — it is not a real choice but a
   * deterministic function of current armor training: train the first of light→medium→heavy you are
   * still untrained in. So instead of a stored pick we DERIVE the target from the live proficiencies
   * at the moment this take is applied; because the grant loop is sequential and in-place, take 2 sees
   * take 1's result and moves to the next armor. `null` = nothing left to train (a no-op take). The
   * rank is trained, or `rankUpgrade.rank` once the character is high enough level (Remaster: expert
   * at 13). This is the ONLY cascade feat in the game — armor-proficiency's predicates are the only
   * ones that partition the state space — so it is modeled as a flag, not a general predicate engine.
   */
  armorCascade?: boolean;
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
 * - Canny Acumen: "Choose Fortitude saves, Reflex saves, Will saves, or Perception. You become an
 *   expert in your choice. At 17th level, you become a master in your choice." Modeled in full via
 *   choiceGrants + rankUpgrade. The choice VALUES below are the raw Foundry paths the importer left
 *   in core.json — they must match verbatim.
 * - Armor Proficiency (Player Core p.252): "You become trained in light armor. If you already were
 *   trained in light armor, you gain training in medium armor. If you were trained in both, you
 *   become trained in heavy armor. If you are at least 13th level, you become an expert in this armor
 *   type." Repeatable up to 3× — modeled as an armorCascade + rankUpgrade (see FeatGrant.armorCascade).
 * - Weapon Proficiency (Player Core p.265): "You become trained in all martial weapons… If you are at
 *   least 11th level, you also become an expert in these weapons." Modeled as martial trained +
 *   rankUpgrade 11/expert. The repeatable advanced-weapon branch ("trained in one advanced weapon of
 *   your choice") is NOT modeled — Foundry itself omits it, so repeat takes are inert.
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
  'canny-acumen': {
    rankUpgrade: { level: 17, rank: 'master' },
    choiceGrants: {
      'system.saves.fortitude.rank': { save: { fortitude: 'expert' } },
      'system.saves.reflex.rank': { save: { reflex: 'expert' } },
      'system.saves.will.rank': { save: { will: 'expert' } },
      'system.perception.rank': { perception: 'expert' },
    },
  },
  'armor-proficiency': { armorCascade: true, rankUpgrade: { level: 13, rank: 'expert' } },
  'weapon-proficiency': { weapon: { martial: 'trained' }, rankUpgrade: { level: 11, rank: 'expert' } },
};

/**
 * How many times a feat may be taken. Mirrors Foundry's `system.maxTakable`: absent → 1, `null` →
 * unlimited (Infinity), any number → that hard cap. Always read the field through this — a direct
 * comparison mis-handles the `null`-means-unlimited case.
 */
export function maxTakes(feat: { maxTakable?: number | null } | undefined): number {
  if (!feat) return 1;
  if (feat.maxTakable === null) return Infinity;
  return feat.maxTakable ?? 1;
}
