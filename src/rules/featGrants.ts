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

/**
 * A dotted Foundry path reduced to the token a picker would emit: `system.saves.will.rank` → `will`,
 * `system.perception.rank` → `perception`. A value with no dots is returned lowercased, unchanged.
 */
function choiceKeyToken(k: string): string {
  const parts = k.toLowerCase().split('.').filter((p) => p && p !== 'system' && p !== 'rank' && p !== 'value');
  return parts.length ? parts[parts.length - 1] : k.toLowerCase();
}

/**
 * The grant the player's answer selects — the ONLY way to read `choiceGrants`.
 *
 * The table was authored against the raw Foundry paths still sitting in core.json at the time
 * (`system.saves.will.rank`); the picker emits the plain value (`will`). The two never met, so
 * Canny Acumen recorded an answer and granted nothing, and its test only passed because it fed
 * buildCharacter a value no picker can produce.
 *
 * Both spellings are accepted rather than migrated: a saved character's `featChoices` still holds
 * whichever string its builder emitted, and those stores live in localStorage, in Supabase and in
 * exported `.codex` files — a migration that missed one would silently drop that character's grant.
 * Matching is symmetric, so a legacy answer finds a plain key and a plain answer finds a legacy key.
 *
 * A normalized match is used only when exactly ONE key reduces to the token. Two keys colliding
 * means the answer is genuinely ambiguous, and granting the wrong proficiency is worse than granting
 * none.
 */
export function choiceGrantFor(g: FeatGrant | undefined, value: string | null | undefined): FeatGrant | undefined {
  const map = g?.choiceGrants;
  if (!map || !value) return undefined;
  if (map[value]) return map[value];
  const want = choiceKeyToken(value);
  let hit: FeatGrant | undefined;
  for (const [k, v] of Object.entries(map)) {
    if (choiceKeyToken(k) !== want) continue;
    if (hit) return undefined;
    hit = v;
  }
  return hit;
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

/**
 * One "treat these weapons as if they were <category>" clause. A record may carry SEVERAL, because
 * one printed sentence often maps two sets differently: Explosive Savant treats bombs and MARTIAL
 * firearms as simple weapons and ADVANCED firearms as martial, which a single clause cannot say.
 */
export interface WeaponFamiliarity {
  /** Named weapons by item id. */
  weapons: string[];
  /**
   * …or every weapon in these GROUPS (bomb, firearm, sword…). Ancestry familiarity names a handful of
   * weapons, but a group clause covers 172 bombs and 120 firearms — a list nobody would maintain by
   * hand, and one that would go stale the moment the data gained another bomb.
   */
  groups?: string[];
  /**
   * …or every weapon carrying one of these TRAITS.
   *
   * Every ancestry weapon-familiarity feat prints two halves — "weapons with the dwarf trait PLUS the
   * battle axe, pick, and warhammer" — and only the named half could be expressed. The open half is
   * resolved against the item data at build time so it stays right as the data gains weapons, the same
   * reasoning as `groups`. These lists already existed on the records, under `critSpecWeapons.traits`,
   * where they drove critical specialisation and nothing else.
   */
  traits?: string[];
  /** Narrow `groups` to weapons of this printed category, so the two halves of "martial firearms as
   *  simple, advanced firearms as martial" are two clauses over the same group. */
  category?: WeaponCategory;
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
  weaponFamiliarity?: WeaponFamiliarity | WeaponFamiliarity[];
  /**
   * A rank this grant confers only once ANOTHER statistic has reached a rank.
   *
   * `conditionalSkills` evaluates the SAME skill's own prior rank ("trained; expert if already
   * trained"), which cannot express Bardic Lore's *"If you have legendary proficiency in Occultism,
   * you gain expert proficiency in Bardic Lore"* — a different skill entirely decides it. Read in
   * build.ts's grant loop, after class advancement and after skill increases, so the gate sees the
   * character's final rank rather than a half-built one.
   */
  crossConditionalSkills?: Record<string, { whenSkill: ProficiencyKey; whenRank: ProficiencyRank; rank: ProficiencyRank }>;
  /**
   * The feat grants a BONUS skill feat the player picks (Rogue Dedication: "You gain a skill feat").
   * Injected as an extra level-<feat's level> skill-feat slot; the pick is stored in
   * BuildState.dedicationSkillFeats keyed by featId. Mirrors the Versatile-Human bonus-feat injection.
   */
  bonusSkillFeat?: boolean;
  /**
   * Grants selected by the player's pick in the feat's own `choice` dropdown ("expert in your choice
   * of Fortitude, Reflex, Will, or Perception"), keyed by the choice VALUE the picker emits
   * (`fortitude`, `longsword`).
   *
   * ⚠ Look it up with `choiceGrantFor`, never `choiceGrants[value]` directly. These keys were once
   * authored against the raw Foundry paths the importer left in core.json (`system.saves.will.rank`)
   * and characters saved then still carry that string as their answer; `choiceGrantFor` resolves both
   * spellings. A bare index misses every one of them, which is the shape of the bug that made Canny
   * Acumen a no-op.
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
 *   choiceGrants (expert) + rankUpgrade (master at 17, applied to whichever track was chosen).
 *   ⚠ Its four options are deliberately NOT narrowed to tracks the character is still below expert
 *   in. Ruling Q9 shows only what the player may legally pick, but "already an expert" is not
 *   illegal here — the 17th-level upgrade to master is the real prize, so choosing the track you
 *   have already mastered the first half of is a sound build. An option is filtered only when the
 *   grant would be genuinely wasted; a later level-scaling step means it is not.
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
      fortitude: { save: { fortitude: 'expert' } },
      reflex: { save: { reflex: 'expert' } },
      will: { save: { will: 'expert' } },
      perception: { perception: 'expert' },
    },
  },
  /*
   * Battle Harbinger Dedication: *"You become trained in your choice of Athletics or Acrobatics."*
   *
   * Rulings Q20 + Q9. The record shipped TWO pickers for that one sentence: its own `choice` (the right
   * two options, read by nothing) and this grant's auto-extracted `skillChoices: [{ options: 'any' }]`
   * (all sixteen skills — and the one that actually trained). So the player answered the correct
   * question and got nothing for it, then answered a wrong one that let them train Occultism.
   *
   * `choiceGrants` is what makes the record's OWN answer the one that grants, which is why the echo is
   * kept rather than deleted: `battle-creed` lists this feat in its `grantedFeats`, and buildCharacter
   * skips a granted feat that HAS a choice precisely so the player picks it in a slot and answers it
   * there. Deleting the field auto-granted the dedication at level 1 — free of the 2nd-level class feat
   * slot the subclass says it must occupy, and with the Toughness it grants, +1 HP per level.
   *
   * ⚠ NOT `redundantFallback`. That clause only fires for a STATIC `skills` grant (see its guard in
   * buildCharacter), never through `choiceGrants` — so *"if you are already trained in both skills, you
   * instead become trained in another skill of your choice"* stays stated on the record's `note` rather
   * than claimed here. Offering all sixteen to everyone in order to serve that one case is the defect
   * the ruling names, not the fix for it.
   */
  'battle-harbinger-dedication': {
    choiceGrants: {
      acrobatics: { skills: { acrobatics: 'trained' } },
      athletics: { skills: { athletics: 'trained' } },
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
  /* "Your proficiency rank for light, medium, and heavy armor increases to expert for whichever of
     those you already had the trained rank in." The armor lane only ever RAISES a rank, which IS the
     "for whichever you already had" clause: a category the character is untrained in is left alone,
     because minRank semantics never promote untrained past the grant. */
  'armored-exercise': { armor: { light: 'expert', medium: 'expert', heavy: 'expert' } },
  'advanced-bow-training': { weaponFamiliarity: { weapons: ['daikyu', 'hongali-hornbow', 'phalanx-piercer'], mirrorCategory: 'martial' } },
  /* "You have familiarity with bombs and firearms; for the purposes of proficiency you treat bombs and
     martial firearms as simple weapons, and advanced firearms as martial weapons." Three clauses over
     two groups — 172 bombs and 120 firearms, which is why this reads by group rather than by name.
     The advanced clause is separate and deliberately weaker: mirroring `simple` across the whole
     firearm group would hand advanced firearms the simple rank the feat withholds. */
  'explosive-savant': {
    weaponFamiliarity: [
      { weapons: [], groups: ['bomb'], mirrorCategory: 'simple' },
      { weapons: [], groups: ['firearm'], category: 'martial', mirrorCategory: 'simple' },
      { weapons: [], groups: ['firearm'], category: 'advanced', mirrorCategory: 'martial' },
    ],
  },
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
 * Skills whose rank NO skill increase may raise, because a record's own text forbids it — keyed by
 * proficiency key, valued with the reason the player is shown.
 *
 * Bardic Lore: *"…but you can't increase your proficiency rank in Bardic Lore by any other means."*
 * Measured before this existed: three skill increases spent on it took a level-20 bard's Bardic Lore
 * to MASTER, and the picker offered it live and un-greyed with no explanation.
 *
 * Two readers, and both are needed. `build.ts` DROPS an increase filed against a locked key, so a
 * character saved before this cannot keep an illegal rank. `Builder.tsx` greys the option and prints
 * this string as the reason — Q27: an option that cannot be picked must LOOK unpickable, and one
 * rendered identically to a live option and silently inert reads as a broken app.
 *
 * Hand-authored here rather than in featGrantsAuto.ts, which five scripts rewrite whole.
 */
export const LOCKED_SKILL_KEYS: Record<string, string> = {
  'lore:bardic': "Bardic Lore can't be increased by any other means — it becomes expert only if your Occultism is legendary.",
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

/**
 * Why taking this feat would grant the character NOTHING — legal, and guaranteed to be wasted.
 *
 * Armor Proficiency prints a cascade: *"You become trained in light armor. If you already were
 * trained in light armor, you gain training in medium armor. If you were trained in both, you become
 * trained in heavy armor. If you are at least 13th level, you become an expert in THIS armor type."*
 * A fighter is already trained in all three, so `applyFeatGrant` finds no category to train and the
 * take stays bare — and no later level rescues it, because the 13th-level clause upgrades only the
 * category this feat granted.
 *
 * That is ruling Q21's "the grant would be WASTED ACROSS YOUR WHOLE CAREER" row, which is the
 * FILTERED one — not Q27's "already trained" row, which is about an option INSIDE a list. So the
 * builder feeds this to `featIneligible` (hidden by default, like a blocked dedication) AND prints
 * the sentence on the row once "Show ineligible" reveals it, which is Q27's half.
 *
 * Returns the SENTENCE. Armor Proficiency carries `prerequisites: []`, so the row's "Requires
 * (unmet): …" line never renders for it and a bare boolean would grey it with no explanation at all
 * — the same silent-inert failure from the other direction.
 */
export function exhaustedGrantReason(
  feat: { id: string } | undefined,
  character: { proficiencies: { defenses: Record<string, ProficiencyRank> } },
): string | undefined {
  if (!feat || !FEAT_GRANTS[feat.id]?.armorCascade) return undefined;
  const d = character.proficiencies.defenses;
  const open = (['light', 'medium', 'heavy'] as const).some((cat) => (d[cat] ?? 'untrained') === 'untrained');
  return open
    ? undefined
    : 'You are already trained in light, medium and heavy armor — this feat would train you in nothing.';
}
