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
import type { ArmorCategory, ProficiencyKey, ProficiencyRank, SaveId, WeaponCategory } from './types';
import { FEAT_SKILL_GRANTS } from './featGrantsAuto';
import { FEAT_LANE_GRANTS } from './featGrantsLane';

/** One step of a level-gated proficiency upgrade a feat grants. */
export interface RankUpgradeStep {
  level: number;
  rank: ProficiencyRank;
}

/** The upgrade steps of a grant, normalized to a list sorted by level. */
export function upgradeSteps(g: FeatGrant): RankUpgradeStep[] {
  if (!g.rankUpgrade) return [];
  return (Array.isArray(g.rankUpgrade) ? g.rankUpgrade : [g.rankUpgrade]).slice().sort((a, b) => a.level - b.level);
}

/** The rank a grant upgrades to at `level` — the highest step reached, or undefined below the first. */
export function upgradeRankAt(g: FeatGrant, level: number): ProficiencyRank | undefined {
  const reached = upgradeSteps(g).filter((s) => level >= s.level);
  return reached.length ? reached[reached.length - 1].rank : undefined;
}

/** Upgrades that trigger EXACTLY at `level`, for the builder's "you gain automatically" list — so the
 *  player sees the step land on the level card instead of a silently-changed number. */
export function featUpgradesAtLevel(featIds: Iterable<string>, level: number): { featId: string; rank: ProficiencyRank }[] {
  const out: { featId: string; rank: ProficiencyRank }[] = [];
  for (const id of featIds) {
    const g = FEAT_GRANTS[id];
    if (!g) continue;
    for (const s of upgradeSteps(g)) if (s.level === level) out.push({ featId: id, rank: s.rank });
  }
  return out;
}

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
   * Conditional skill upgrades — "trained in X; if you were ALREADY trained, expert instead" (Lastwall
   * Sentry, Linguist, …). Grants `base`, but if the character already meets `base` from another source,
   * grants `upgraded` instead. Evaluated against the pre-feat rank; RAISES only, never lowers.
   */
  conditionalSkills?: Partial<Record<ProficiencyKey, { base: ProficiencyRank; upgraded: ProficiencyRank }>>;
  /**
   * "Trained in a Lore subject of your choice" (Gnome Obsession, Elemental Lore, …). The number of
   * such Lore-training slots. The player types each subject in the builder; the pick is stored in
   * BuildState.featLoreChoices keyed `<featId>:<slot index>` and granted as `lore:<subject>` trained.
   */
  loreChoices?: number;
  /**
   * Skill-training CHOICES the feat offers ("your choice of Acrobatics or Athletics"). Each entry is
   * one training slot; the player picks one skill from `options` (or any skill when `options: 'any'`).
   * The pick is stored in BuildState.featSkillChoices keyed `<featId>:<slot index>`; an unset slot
   * defaults to the first listed option (or Acrobatics for an 'any' slot). Grants training at `rank`
   * (RAISES only, like the static grants).
   */
  skillChoices?: {
    /** ProficiencyKey rather than SkillId because several feats offer a choice among LORE skills —
     *  Know the Beat ("Guild, Legal, Mercantile or Underworld Lore"), Ghost Hunter Dedication. The
     *  static `skills` map already accepts `lore:*`, so restricting the choice list to non-Lore
     *  skills made those feats inexpressible for no reason. */
    options: ProficiencyKey[] | 'any';
    rank: ProficiencyRank;
    /** Conditional slot rank — "trained in your choice of Deception or Stealth; expert if already
     *  trained" (Lion Blade). When set, the PICKED skill gets `upgraded` if it already met `base`
     *  before this grant, else `base`; the flat `rank` is ignored. */
    conditionalRank?: { base: ProficiencyRank; upgraded: ProficiencyRank };
  }[];
  /**
   * "If you were already trained in <the granted skill(s)>, you instead become trained in a skill of
   * your choice." When set, each STATIC non-Lore skill in `skills` that was already at (or above) its
   * granted rank BEFORE this feat converts into a replacement-skill pick: buildCharacter records the
   * triggered slot on Character.skillFallbacks (so the builder offers the picker) and applies the pick
   * from BuildState.featSkillChoices keyed `<featId>:fallback:<skill>` (trained, RAISES only).
   */
  redundantFallback?: boolean;
  /**
   * Ancestry Weapon Familiarity / Expertise — proficiency in NAMED weapons rather than a whole
   * category. `rank` is a flat grant ("you're trained in the dogslicer and horsechopper"); with
   * `mirrorBestCategory` the listed weapons instead match the best weapon-CATEGORY rank the character
   * has (the Expertise feats: "whenever a class feature grants you expert or greater proficiency in
   * certain weapons, you also gain that proficiency for …"). Applied as weaponOverrides, which
   * deriveStrike already maxes against the weapon's own category rank — so this only ever helps
   * weapons the category doesn't already cover (advanced ancestry weapons, limited-expertise classes).
   */
  weaponFamiliarity?: {
    weapons: string[];
    /**
     * …or the weapon the player CHOSE, named by the `choice.flag` that recorded it.
     *
     * Unconventional Weaponry picks a weapon; Unconventional Expertise then advances "the weapon you
     * chose for Unconventional Weaponry" — a different feat entirely. `weapons` is a static list, so
     * neither could name it, and the base feat shipped marked "Recorded only". Resolved against the
     * built feats, so the answer travels between the two.
     */
    weaponFromChoiceFlag?: string;
    /**
     * "for the purpose of proficiency, you treat it as a simple weapon" — and for the advanced-weapon
     * branch, "as a martial weapon". One category DOWN, floored at simple, decided by the chosen
     * weapon's own category rather than written out per feat.
     */
    treatAsLowerCategory?: boolean;
    rank?: ProficiencyRank;
    mirrorBestCategory?: boolean;
    /**
     * "…as if they were MARTIAL weapons" (Advanced Bow Training, Advanced Monastic Weaponry, …) —
     * mirrors that ONE category's rank rather than the best of the three. `mirrorBestCategory` is
     * wrong for these: a cleric with Archer Dedication is trained in martial but expert in simple,
     * so the best-of rule would make their advanced bows expert when the feat says martial.
     */
    mirrorCategory?: WeaponCategory;
  };
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
  /** Level-gated rank upgrade(s) on everything this feat grants. A LIST expresses a multi-step
   *  progression ("expert now, master at 7th, legendary at 15th" — Brilliant Crafter); the highest
   *  step the character has reached applies. A single object is the one-step form. */
  /** The grant does not start at the feat's own level — it begins here (Martial Experience trains
   *  you in every weapon only from 11th). Everything in the grant is withheld until this level. */
  minLevel?: number;
  rankUpgrade?: RankUpgradeStep | RankUpgradeStep[];
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
const HAND_AUTHORED_GRANTS: Record<string, FeatGrant> = {
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
  // "Trained in your choice of the battle axe or longsword" — the feat's own weapon-choice dropdown
  // drives which specific weapon is trained (the Shield Block reaction is granted via featFeatGrants).
  'viking-shieldbearer': {
    choiceGrants: {
      'battle-axe': { weaponFamiliarity: { weapons: ['battle-axe'], rank: 'trained' } },
      longsword: { weaponFamiliarity: { weapons: ['longsword'], rank: 'trained' } },
    },
  },
  // "You gain proficiency with all advanced <X> as if they were martial <X>." The feat audit flagged
  // all four; every weapon list below is enumerated from core.json (category 'advanced' + the stated
  // group or trait) rather than from the feat's prose, because the prose names no weapons at all.
  /*
   * Unconventional Weaponry: "Choose an uncommon simple or martial weapon… for the purpose of
   * proficiency, you treat it as a simple weapon. If you are trained in all martial weapons, you can
   * instead choose an uncommon advanced weapon… you treat it as a martial weapon."
   *
   * The weapon is the player's, recorded under the `unconventionalWeapon` choice flag, so no static
   * `weapons` list can name it — which is why the feat shipped marked "Recorded only".
   */
  'unconventional-weaponry': {
    weaponFamiliarity: { weapons: [], weaponFromChoiceFlag: 'unconventionalWeapon', treatAsLowerCategory: true },
  },
  // "Whenever you gain a class feature that grants you expert or greater proficiency in certain
  // weapons, you also gain that proficiency in the weapon you chose for Unconventional Weaponry."
  // The SAME chosen weapon, now tracking the best category rank instead of the lowered one.
  'unconventional-expertise': {
    weaponFamiliarity: { weapons: [], weaponFromChoiceFlag: 'unconventionalWeapon', mirrorBestCategory: true },
  },
  'advanced-bow-training': { weaponFamiliarity: { weapons: ['daikyu', 'hongali-hornbow', 'phalanx-piercer'], mirrorCategory: 'martial' } },
  'advanced-monastic-weaponry': { weaponFamiliarity: { weapons: ['butterfly-sword', 'feng-huo-lun', 'heavenly-rolling-flames', 'hook-sword'], mirrorCategory: 'martial' } },
  'advanced-firearm-familiarity': {
    weaponFamiliarity: {
      weapons: ['animate-dreamer', 'barricade-buster', 'dwarven-scattergun', 'explosive-dogslicer', 'explosive-dogslicer-ranged', 'flingflenser', 'ghosthands-comet', 'kaldemashs-lament', 'rowan-rifle'],
      mirrorCategory: 'martial',
    },
  },
  // Firearms AND crossbows — the only one of the four that spans two groups.
  'advanced-shooter': {
    weaponFamiliarity: {
      weapons: ['animate-dreamer', 'barricade-buster', 'dwarven-scattergun', 'explosive-dogslicer', 'explosive-dogslicer-ranged', 'flingflenser', 'ghosthands-comet', 'kaldemashs-lament', 'rowan-rifle', 'repeating-crossbow', 'repeating-hand-crossbow', 'taw-launcher'],
      mirrorCategory: 'martial',
    },
  },
};

/** The full feat-proficiency table: auto-extracted skill grants (featGrantsAuto.ts), then the
 *  proficiency-lane classification (featGrantsLane.ts), overlaid with the hand-authored cases (armor
 *  cascades / choiceGrants / weapon grants), which WIN on any id conflict. */
export const FEAT_GRANTS: Record<string, FeatGrant> = {
  ...FEAT_SKILL_GRANTS,
  ...FEAT_LANE_GRANTS,
  ...HAND_AUTHORED_GRANTS,
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
