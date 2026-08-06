/*
 * The build engine.
 *
 * The sheet renders a Character; the builder *produces* one. A Character stores
 * final abilities and resolved proficiencies — this module computes those from
 * the player's choices (BuildState), so the builder UI can stay declarative:
 * keep a BuildState, call buildCharacter() to get a live Character, render it.
 *
 * Scope: level-1 creation. Higher-level progression (per-level feats, skill
 * increases, boosts at 5/10/15/20) comes later.
 */
import type {
  AbilityBoost,
  AbilityId,
  AbilityScores,
  Action,
  AdvancementEntry,
  ArmorCategory,
  Background,
  Character,
  ChoiceGroup,
  ClassDef,
  ClassFeature,
  CommanderTactics,
  CompanionConfig,
  ContentDatabase,
  InventorBuild,
  CustomBackground,
  Feat,
  FeatCategory,
  FeatChoice,
  Proficiencies,
  ProficiencyKey,
  ProficiencyRank,
  ArmorRunes,
  SaveId,
  SkillId,
  SkillIncrease,
  SpellcastingEntry,
  SubclassOption,
  Tradition,
  VariantRules,
  CharacterOptions,
  BuildOverrides,
  NaturalAttack,
  GrantedStrike,
  WeaponCategory,
  WeaponRunes,
  PinnedDesc,
} from './types';
import type { ClassArchetype, DefenseGrants, EffectChoice, EffectGrant, FeatChoiceDef, FocusPool, InnateSpellGrant, ItemDesignation, ItemPassiveEffects, SourceInfo, SpellSlotBonus, SpellcastingGrant } from './types';
import { CHARACTER_SCHEMA_VERSION, PROFICIENCY_RANKS, SKILLS } from './types';
import { CHOOSABLE_SOURCE_MAPS } from './sources';
import { abilityMod, choiceOwnedFeatureIds, classFeatureIdsOwned, profBonus, resolveFormula } from './derive';
import { CLASS_ADVANCEMENT } from './advancement';
import { applyCounterMods } from './counterMods';
import { FEAT_GRANTS, maxTakes, upgradeRankAt } from './featGrants';
import { FEAT_FEAT_GRANTS, FEAT_FEAT_GRANTS_LEVELED } from './featFeatGrants';
import { FEAT_PICK_GRANTS, pickableFeats } from './featPickGrants';
import { FEAT_CANTRIP_GRANTS } from './featCantripGrants';
import { grantForSpellPick } from './spellChoice';
import { DOMAIN_SPELLS } from './domains';
import { initialClassResources } from './classResources';
import { activeCasterArchetype, archetypeProficiency, archetypeSlots, archetypeTraditionOptions } from './casterArchetypes';
import { resolveRestrictedSlots } from './restrictedSlots';
import { coinsToCp, cpToCoins, startingWealthGp } from './wealth';
import { apparitionSlots, cantripsKnown, casterSlots, magusStudiousSpells } from './spellcasting';

/** The player's in-progress choices. The builder UI owns one of these. */
export interface BuildState {
  name: string;
  level: number;
  ancestryId: string | null;
  heritageId: string | null;
  backgroundId: string | null;
  classId: string | null;
  /** Chosen subclass option id (doctrine/order/racket/...), if the class has one. */
  subclassId: string | null;
  /** Optional variant rules (Ancestry Paragon, ABP, Dual Class, …) toggled at setup. */
  variantRules?: VariantRules;
  /** Favorited description popups starred in the builder (e.g. from the Setup rule "i" icons).
   *  Carried onto the built Character so they appear in the sheet's Main-tab Pinned section. */
  pinnedDescs?: PinnedDesc[];
  /** Per-character convenience/house options (alternate ancestry boosts, voluntary flaw, ignore bulk, dice roller). */
  options?: CharacterOptions;
  /** Creative "Overrides" — deliberate per-case rule-breaks (allowed-ineligible feats, bonus/removed feats). */
  overrides?: BuildOverrides;
  /** Enabled source books — content from other books is hidden from the builder pickers. Absent =
   *  the four Core books only (the default for a new character). */
  enabledSources?: string[];
  /** Campaigns this character is attached to (their ids). Drives the sheet's Party button and the
   *  publish-to-party sync. Set on the builder's Setup → Campaign card. */
  campaignIds?: string[];
  /** Campaign content toggles (off by default). Mythic → enables the mythic subsystem + shows
   *  `mythic`-trait content; Kingmaker → shows its actions/conditions. */
  mythicEnabled?: boolean;
  kingmakerEnabled?: boolean;
  /** "Hide legacy data": when true, legacy + legacy-era (pre-remaster-exclusive) content is hidden from
   *  every picker, for a pure remaster/neutral experience. Superseded content is always hidden regardless. */
  hideLegacy?: boolean;
  /** The chosen Mythic Calling (a [calling]-trait classFeature id), when Mythic is enabled. */
  mythicCalling?: string | null;
  /** Dual Class variant: the second class + its subclass. */
  classId2?: string | null;
  subclassId2?: string | null;
  /** ABP skill potency: chosen skill (or `lore:<subject>`) → item-bonus rank (1–3). */
  abpSkills?: Record<string, number>;
  /** ABP attribute apex (level 17): the attribute that gets the apex boost. */
  abpApex?: AbilityId | null;
  /** Selections for extra class choice groups (subconscious mind, apparitions, ikons, …), by group id. */
  extraChoices: Record<string, string[]>;
  /** Chosen deity id (clerics and other deity-using classes). */
  deityId: string | null;
  /** Cleric divine font choice (heal/harm), constrained by the deity. */
  divineFont: 'heal' | 'harm' | null;
  /** Champion devotion (focus) spell choice: shields-of-the-spirit / lay-on-hands / touch-of-the-void. */
  devotionSpell?: string | null;
  /** Monk Path to Perfection save picks, by tier: [0]=L7 → master, [1]=L11 → master, [2]=L15 → legendary. */
  pathToPerfection?: (SaveId | null)[];
  /** Druid Voice of Nature feat choice: animal-empathy or plant-empathy. */
  voiceOfNature?: string | null;
  /** Fighter Weapon Mastery / Weapon Legend chosen weapon GROUP (e.g. 'sword'). That group's
   *  simple/martial/unarmed weapons reach master@5 → legendary@13 (advanced expert@5 → master@13). */
  fighterWeaponGroup?: string | null;
  /** Animist primary apparition (option id); only the primary grants its vessel focus spell. */
  primaryApparition?: string | null;
  /** A subclass's restricted skill-choice pick (gunslinger Pistolero way, investigator Empiricism). */
  subclassSkill?: SkillId | null;
  /** Sorcerer Draconic bloodline's chosen dragon exemplar (slug) — sets tradition + 2nd bloodline skill. */
  dragonExemplar?: string | null;
  /** Commander folio tactics — chosen Action ids (clamped to folio size + unlocked tiers at build time). */
  commanderTactics?: string[];
  /** Trait picks for option-granted choice feats (Dominion Epithet → Energized Spark), keyed `grant:<optionId>:<featId>`. */
  grantedChoiceFeatTraits?: Record<string, string>;
  /** Thaumaturge Implement Adept (level 7): which of your implements unlocks its adept benefit.
   *  Second Adept at 11 gives the OTHER of your first two automatically, so this only picks the
   *  order. Defaults to your first implement. */
  implementAdept?: string | null;
  /** Thaumaturge Implement Paragon (level 17): which adept implement unlocks its paragon benefit. */
  implementParagon?: string | null;
  /** Inventor armor innovation's base statistics (gates several armor modifications). */
  inventorArmorStats?: 'power-suit' | 'subterfuge-suit' | null;
  /** Inventor chosen modification ids by tier. */
  inventorModifications?: { initial?: string | null; breakthrough?: string | null; revolutionary?: string | null };
  /** Kineticist Fork the Path picks: Gate's Threshold level (string) → newly-gained element option id. */
  gateForks?: Record<string, string>;
  /** Kineticist Expand the Portal picks: Gate's Threshold level (string) → bonus impulse feat id. */
  gateExpands?: Record<string, string>;
  /** Elemental Blast damage type per element ("choose … a damage type listed for that element").
   *  Only the first of each element's printed types was ever shown, so half of a choice the rules
   *  offer on every blast was missing. Absent ⇒ that element's first printed type. */
  blastTypes?: Record<string, string>;
  /** Chosen key attribute (for classes that offer a choice). */
  keyAbility: AbilityId | null;
  /** Selections for the ancestry's non-fixed boosts (choice/free), in order. */
  ancestryBoosts: (AbilityId | null)[];
  /** Selections for the background's boosts, in order. */
  backgroundBoosts: (AbilityId | null)[];
  /** User-defined ("deep") background, used when backgroundId === CUSTOM_BACKGROUND_ID. */
  customBackground?: CustomBackground;
  /** The four free level-1 boosts. */
  levelBoosts: (AbilityId | null)[];
  /** Additional trained skills chosen for the class. May include `lore:<subject>` keys. */
  classSkills: ProficiencyKey[];
  /** Skilled-heritage trained skill, if applicable. */
  heritageSkill: SkillId | null;
  /** The pick for a background offering a trained-skill CHOICE (Background.trainedSkillChoice). */
  backgroundSkillChoice?: SkillId | null;
  /** The general feat granted by a feat-granting heritage (Versatile Human). */
  heritageFeatId?: string | null;
  /** The chosen damage type for a choice-resistance heritage (Deep Fetchling, Elementheart Kobold). */
  heritageResistanceChoice?: string | null;
  /** The bonus level-1 wizard class feat granted by the School of Unified Magical Theory (UMT). */
  umtFeatId?: string | null;
  /**
   * Skill-training choices offered by a feat's FEAT_GRANTS.skillChoices (Fighter Dedication:
   * Acrobatics/Athletics; Rogue Dedication: Stealth/Thievery + one free). Keyed `<featId>:<slotIdx>`
   * → chosen SkillId. An unset slot falls back to the first option (buildCharacter default).
   */
  featSkillChoices?: Record<string, SkillId>;
  /** Lore subjects chosen for a feat's "trained in a Lore of your choice" grant (FeatGrant.loreChoices),
   *  keyed `<featId>:<slot index>` → the bare subject text (e.g. "Warfare"). Granted as lore:<subject>. */
  featLoreChoices?: Record<string, string>;
  /**
   * The bonus skill feat a dedication grants via FEAT_GRANTS.bonusSkillFeat (Rogue Dedication),
   * keyed by the dedication's feat id → chosen skill-feat id. Injected as an extra skill-feat slot.
   */
  dedicationSkillFeats?: Record<string, string>;
  /**
   * The bonus feat the player picked for a pick-a-feat grant (FEAT_PICK_GRANTS: General Training,
   * Basic Maneuver, Natural Ambition, …), keyed by the granting feat's id → chosen feat id. Granted
   * (with its own effects) by buildCharacter, like a static feat grant.
   */
  pickFeatChoices?: Record<string, string>;
  /**
   * The innate spell/cantrip the player picked for a pick-a-cantrip grant (FEAT_CANTRIP_GRANTS: Dragon
   * Spit, Arcane Tattoos, Hag Magic, …), keyed by the granting feat's id → chosen spell id. Injected
   * into the character's innate-spell entry by buildCharacter.
   */
  pickCantripChoices?: Record<string, string>;
  /**
   * A GRANTED (slotless) feat's embedded sub-choice, keyed by the granted feat's id → value (Seeker of
   * Truths grants Domain Initiate → its domain lives here, picked under the granting feat in the
   * builder). Resolved by the focus loop + attached to the granted FeatChoice for display.
   */
  grantedFeatChoices?: Record<string, string>;
  /** "Choose one of N" effect picks (DefenseGrants/Item.effectChoices), keyed `<recordId>:<choiceId>`
   *  → chosen option value. Resolved by buildCharacter into the concrete effect. */
  effectChoices?: Record<string, string>;
  /** A "choose a Lore" background's typed Lore subject (free text) → lore:<subject> trained. */
  backgroundLore?: string;
  /** A "choose N Lores" HERITAGE's typed Lore subjects (free text) → lore:<subject> trained each. */
  heritageLore?: string[];
  /** Chosen bonus languages (Int-based + ancestry extra), beyond the granted ones. */
  languages: string[];
  /** Chosen feats, keyed by slot id `"level:category:idx"` -> feat id. */
  featPicks: Record<string, string>;
  /** A feat's embedded sub-choice value, keyed by the same slot id (Domain Initiate domain, …). */
  featChoices: Record<string, string>;
  /** Skill-increase choices, keyed by the character level of the increase. */
  skillIncreases: Record<number, ProficiencyKey>;
  /** Attribute-boost choices at levels 5/10/15/20, keyed by level -> 4 picks. */
  attributeBoosts: Record<number, (AbilityId | null)[]>;
  /** Chosen cantrip spell ids (casters). */
  cantrips: string[];
  /** Chosen spells per rank (1-10): repertoire for spontaneous, prepared list for prepared. */
  spells: Record<number, string[]>;
  /**
   * Spontaneous signature spells, rank -> spell ids.
   *
   * A bare string is the LEGACY shape (one per rank) and is still accepted on read, because saved
   * characters are never normalized on load — changing the type outright compiles clean and silently
   * corrupts them. Read through `signaturesAt()`, never directly.
   *
   * More than one per rank is reachable: Signature Spell Expansion grants "two additional signature
   * spells", Reanimator Dedication one "in addition to your usual", and Ultimate Polymath makes the
   * whole repertoire signature. With one slot per rank, every one of those was capped at one.
   */
  signatures: Record<number, string | string[]>;
  /** Dual Class: the SECOND caster class's own spell surface — cantrips, spells-per-rank
   *  (repertoire for spontaneous / prepared list for prepared), and signatures. Without these,
   *  the second class's caster entry would be rebuilt empty on every builder edit. */
  cantrips2?: string[];
  spells2?: Record<number, string[]>;
  signatures2?: Record<number, string | string[]>;
  /** Chosen tradition for a choice-tradition caster archetype (sorcerer/witch/eldritch-archer/beast-gunner). */
  archetypeTradition?: Tradition | null;
  /** Chosen key attribute for a choice-key caster archetype (psychic dedication = Int or Cha). */
  archetypeKeyAbility?: AbilityId | null;
  /** Chosen eidolon TYPE (a summoner subclass option id) for the Summoner Dedication archetype. */
  archetypeEidolonType?: string | null;
  /** Two-casters: a caster CLASS taking a caster archetype gets a SEPARATE spell surface here, so the
   *  archetype pool never collides with the class's own build.cantrips/build.spells. */
  archetypeSpells?: {
    cantrips: string[];
    spells: Record<number, string[]>;
    signatures?: Record<number, string>;
    tradition?: Tradition | null;
    keyAbility?: AbilityId | null;
  };
  /** Chosen gear: item ids with quantity and equipped/worn state. The runes/invested/container/
   *  charges fields are optional and only used to preserve in-play gear state when a character is
   *  reopened for editing (see deriveBuildFromCharacter); the builder UI itself sets only the basics. */
  inventory: {
    itemId: string;
    quantity: number;
    worn?: boolean;
    equipped?: boolean;
    invested?: boolean;
    containerInstanceId?: string | null;
    runes?: WeaponRunes | ArmorRunes;
    charges?: { current: number; max: number };
    /** Generic scroll/wand: the spell the player chose to store (see ItemBase.spellSlot). */
    heldSpell?: string;
    /**
     * Innovation / weapon implement / bonded item / ikon / rune source.
     *
     * This survived only in PlayState, which restores it by instanceId — and instanceIds are the
     * inventory INDEX (`inv-${i}`), so removing an earlier item slid the mark onto whatever took its
     * place. Carrying it on the build keeps it attached to the item the player marked.
     */
    designations?: ItemDesignation[];
  }[];
  /** Ancestry/feat natural unarmed attacks (Iruxi Fangs, claws, …) shown as extra Strikes. */
  naturalAttacks?: NaturalAttack[];
  /** Animal companions, familiars (eidolons are derived from the summoner subclass). */
  companions: CompanionConfig[];
}

export function emptyBuild(): BuildState {
  return {
    name: '',
    level: 1,
    ancestryId: null,
    heritageId: null,
    backgroundId: null,
    classId: null,
    subclassId: null,
    extraChoices: {},
    deityId: null,
    divineFont: null,
    devotionSpell: null,
    pathToPerfection: [],
    voiceOfNature: null,
    fighterWeaponGroup: null,
    primaryApparition: null,
    subclassSkill: null,
    dragonExemplar: null,
    commanderTactics: [],
    grantedChoiceFeatTraits: {},
    inventorArmorStats: null,
    inventorModifications: {},
    gateForks: {},
    gateExpands: {},
    keyAbility: null,
    ancestryBoosts: [],
    backgroundBoosts: [],
    levelBoosts: [null, null, null, null],
    classSkills: [],
    heritageSkill: null,
    backgroundSkillChoice: null,
    heritageFeatId: null,
    umtFeatId: null,
    featSkillChoices: {},
    dedicationSkillFeats: {},
    languages: [],
    featPicks: {},
    featChoices: {},
    skillIncreases: {},
    attributeBoosts: {},
    cantrips: [],
    spells: {},
    signatures: {},
    archetypeTradition: null,
    archetypeKeyAbility: null,
    archetypeEidolonType: null,
    archetypeSpells: { cantrips: [], spells: {}, tradition: null, keyAbility: null },
    inventory: [],
    companions: [],
  };
}

/** Sentinel backgroundId for a user-defined ("deep") background. */
export const CUSTOM_BACKGROUND_ID = '__custom__';

/** A blank custom background, for when the user first opens the form. */
export function emptyCustomBackground(): CustomBackground {
  return { name: '', description: '', boosts: [null, null], trainedSkill: null, loreSubject: '', skillFeatId: null };
}

/** The active background — either a content background or a synthesized one from the
 *  build's custom ("deep") background — so every consumer treats them identically. */
/** The feat ids a background grants, normalised. `grantedFeatId` is usually a single string, but Eagle
 *  Hunter and Returned each grant a PAIR of feats and a bare string read dropped the second one. */
/**
 * The SECOND heritage a character has been granted, if any.
 *
 * buildCharacter works this out inline; the builder needs the same answer to render that heritage's
 * own choice surfaces, and duplicating the rule is how the two drift.
 */
export function secondHeritageIdOf(build: BuildState, content: ContentDatabase): string | undefined {
  for (const [slotKey, featId] of Object.entries(build.featPicks ?? {})) {
    if (!content.feats[featId]?.secondHeritage) continue;
    const picked = build.featChoices?.[slotKey];
    if (picked && content.heritages[picked] && picked !== build.heritageId) return picked;
  }
  return undefined;
}

/** The storage key for a background's own sub-choice — the sibling of `feature:<id>`. */
export const backgroundChoiceKey = (backgroundId: string) => `background:${backgroundId}`;

/** The player's answer to a background's sub-choice, defaulting to the first option so an unanswered
 *  build is still legal — the same default every other choice in the builder takes. */
export function backgroundChoiceValue(build: BuildState, bg: Background | undefined): string | undefined {
  if (!bg?.choice) return undefined;
  const stored = build.featChoices?.[backgroundChoiceKey(bg.id)];
  return stored || bg.choice.options?.[0]?.value;
}

/**
 * What a background's sub-choice ANSWER does, decided by what it is rather than by a table of the
 * 40-odd `flag` names in the data — a table would be right today and wrong the moment one is added.
 *
 * 'other' is a real answer, not a failure: a terrain, a constellation, a deviant classification have
 * no sheet number, and recording the pick is the whole of what the record asks for.
 */
export function backgroundChoiceKind(def: FeatChoiceDef, content: ContentDatabase): 'skill' | 'lore' | 'feat' | 'other' {
  if (def.kind === 'skills') return 'skill';
  const opts = def.options ?? [];
  if (!opts.length) return 'other';
  const loreish = /lore/i.test(def.prompt ?? '') || /lore/i.test(def.flag ?? '') || opts.every((o) => /lore/i.test(o.label ?? ''));
  if (loreish) return 'lore';
  if (opts.every((o) => (SKILLS as readonly string[]).includes(o.value))) return 'skill';
  if (opts.every((o) => content.feats[o.value])) return 'feat';
  return 'other';
}

export function backgroundGrantedFeats(bg: Background | undefined, skillChoice?: SkillId | null): string[] {
  // A background whose feat depends on the skill you chose ("If you selected Performance… if you
  // chose Society…") replaces the flat grant entirely — otherwise a Society pick would still hand
  // out the Performance feat. Unpicked falls back to the first offered skill, matching how
  // `trainedSkillChoice` itself defaults.
  const byChoice = bg?.grantedFeatByChoice;
  if (byChoice) {
    const picked = skillChoice && byChoice[skillChoice] ? skillChoice : bg?.trainedSkillChoice?.[0];
    const g = picked ? byChoice[picked] : undefined;
    if (g) return (Array.isArray(g) ? g : [g]).filter(Boolean);
  }
  const g = bg?.grantedFeatId;
  if (!g) return [];
  return Array.isArray(g) ? g.filter(Boolean) : [g];
}

/**
 * The featChoices keys a choice occupies.
 *
 * A single pick keeps the bare slot key, so every character saved before multi-pick existed keeps
 * working untouched. Only `picks > 1` fans out to `<slotKey>#<i>`.
 */
export function choiceKeys(slotKey: string, def: FeatChoiceDef | undefined): string[] {
  const n = Math.max(1, Math.floor(def?.picks ?? 1));
  return n === 1 ? [slotKey] : Array.from({ length: n }, (_, i) => `${slotKey}#${i}`);
}

/** Options still selectable for pick `idx` — with `distinct`, the other picks' answers are removed. */
export function choiceOptionsFor<T extends { value: string }>(
  options: T[],
  def: FeatChoiceDef | undefined,
  answers: (string | undefined)[],
  idx: number,
): T[] {
  if (!def?.distinct) return options;
  const taken = new Set(answers.filter((a, i) => i !== idx && a));
  return options.filter((o) => !taken.has(o.value));
}

export function resolveBackground(build: BuildState, content: ContentDatabase): Background | undefined {
  if (build.backgroundId === CUSTOM_BACKGROUND_ID && build.customBackground) {
    const cb = build.customBackground;
    return {
      id: CUSTOM_BACKGROUND_ID,
      name: cb.name.trim() || 'Custom background',
      description: cb.description || '',
      traits: [],
      rarity: 'common',
      abilityBoosts: cb.boosts
        .filter((b): b is AbilityId => !!b)
        .map((ability) => ({ kind: 'fixed', ability })),
      trainedSkill: cb.trainedSkill ?? undefined,
      trainedLore: cb.loreSubject.trim() || undefined,
      grantedFeatId: cb.skillFeatId ?? undefined,
    };
  }
  return build.backgroundId ? content.backgrounds[build.backgroundId] : undefined;
}

/** The background's granted trained skill: the fixed one, or — for a "trained in your choice of
 *  X or Y" background — the player's pick, defaulting to the first offered option so the built
 *  character is always legal even before the pick is made. */
export function backgroundTrainedSkill(build: BuildState, background: Background | undefined): SkillId | undefined {
  if (!background) return undefined;
  if (background.trainedSkill) return background.trainedSkill;
  const choice = background.trainedSkillChoice;
  if (!choice?.length) return undefined;
  return build.backgroundSkillChoice && choice.includes(build.backgroundSkillChoice)
    ? build.backgroundSkillChoice
    : choice[0];
}

export const SKILL_INCREASE_LEVELS = [3, 5, 7, 9, 11, 13, 15, 17, 19];
export const ATTRIBUTE_BOOST_LEVELS = [5, 10, 15, 20];
/** Each attribute-boost level grants this many boosts (to different attributes). */
export const ATTRIBUTE_BOOST_COUNT = 4;
/** Gradual Attribute Boosts variant: the 4 boosts at 5/10/15/20 instead arrive one at a time, four
 *  per "set" (2-5, 7-10, 12-15, 17-20). Same 16 total boosts, just spread out. */
export const GRADUAL_BOOST_LEVELS = [2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15, 17, 18, 19, 20];
/** The 4-level sets used by Gradual Attribute Boosts (no two boosts in a set may target the same attr). */
export const GRADUAL_BOOST_SETS = [
  [2, 3, 4, 5],
  [7, 8, 9, 10],
  [12, 13, 14, 15],
  [17, 18, 19, 20],
];
/** Which levels grant a leveling attribute boost, given the active variant rules. */
export function attributeBoostLevels(variant?: VariantRules): number[] {
  return variant?.gradualBoosts ? GRADUAL_BOOST_LEVELS : ATTRIBUTE_BOOST_LEVELS;
}
/** How many boosts a given boost-level grants (1 under Gradual Attribute Boosts, else 4). */
export function attributeBoostCount(variant?: VariantRules): number {
  return variant?.gradualBoosts ? 1 : ATTRIBUTE_BOOST_COUNT;
}

/** A boost the player must assign (the ancestry/background's non-fixed boosts). */
export interface BoostSlot {
  kind: 'free' | 'choice';
  options?: AbilityId[];
}

export function boostSlots(boosts: AbilityBoost[]): BoostSlot[] {
  return boosts
    .filter((b) => b.kind !== 'fixed')
    .map((b) => (b.kind === 'choice' ? { kind: 'choice' as const, options: b.options } : { kind: 'free' as const }));
}

export function fixedBoosts(boosts: AbilityBoost[]): AbilityId[] {
  return boosts.filter((b): b is Extract<AbilityBoost, { kind: 'fixed' }> => b.kind === 'fixed').map((b) => b.ability);
}

/**
 * How many additional skills the class lets you train: base + Int modifier.
 * Determined at level 1, so it uses the level-1 Int (later boosts don't add
 * retroactive initial trainings).
 */
export function additionalClassSkills(build: BuildState, content: ContentDatabase): number {
  const cls = build.classId ? content.classes[build.classId] : undefined;
  if (!cls) return 0;
  const abilities = computeAbilities(build, content, 1);
  // Dual Class: use the LARGER of the two classes' base free-skill counts (not the sum).
  const cls2 = build.variantRules?.dualClass && build.classId2 ? content.classes[build.classId2] : undefined;
  const base = Math.max(cls.trainedSkills.additional, cls2?.trainedSkills.additional ?? 0);
  return Math.max(0, base + abilityMod(abilities.int));
}

/**
 * The archetype multiclass rule: you can't select a new dedication feat until every
 * archetype you've already started has at least two OTHER (non-dedication) feats from it.
 * Returns true if a new dedication may currently be taken, given the taken feat ids.
 */
export function canTakeNewDedication(takenFeatIds: string[], content: ContentDatabase): boolean {
  const started = new Set<string>(); // archetypes with a dedication taken
  const counts = new Map<string, number>(); // archetype -> non-dedication feats taken
  for (const id of takenFeatIds) {
    const f = content.feats[id];
    if (!f?.archetype) continue;
    if (f.traits.includes('dedication')) started.add(f.archetype);
    else counts.set(f.archetype, (counts.get(f.archetype) ?? 0) + 1);
  }
  for (const s of started) if ((counts.get(s) ?? 0) < 2) return false;
  return true;
}

/**
 * A key attribute set by a chosen option (rogue racket → Str/Cha/Int, psychic
 * subconscious mind → Int/Cha) rather than the class default. Mirrors the
 * grantOptions logic in buildCharacter so the key-attribute boost and the final
 * resolved key ability never disagree.
 */
export function subclassKeyAbility(build: BuildState, content: ContentDatabase): AbilityId | undefined {
  const cls = build.classId ? content.classes[build.classId] : undefined;
  if (!cls) return undefined;
  const sub = cls.subclass?.options.find((o) => o.id === build.subclassId);
  if (sub) {
    const k = resolveOptionKeyAbility(sub, build.keyAbility);
    if (k) return k;
  }
  for (const g of cls.extraChoices ?? []) {
    for (const id of build.extraChoices?.[g.id] ?? []) {
      const o = g.options.find((opt) => opt.id === id);
      const k = o ? resolveOptionKeyAbility(o, build.keyAbility) : undefined;
      if (k) return k;
    }
  }
  return undefined;
}

/** A chosen option's key attribute: a keyAbilityOptions option (rogue racket) honors the player's
 *  pick when it's one of the offered attributes, else defaults to the FIRST option (the racket's
 *  own attribute); a plain keyAbility is fixed. */
function resolveOptionKeyAbility(o: SubclassOption, picked: AbilityId | null): AbilityId | undefined {
  if (o.keyAbilityOptions?.length) {
    return picked && o.keyAbilityOptions.includes(picked) ? picked : o.keyAbilityOptions[0];
  }
  return o.keyAbility;
}

/**
 * The REQUIRED level-0/Setup choices still unmade, as short human-readable labels. Drives the
 * builder's level-0 pending marker ("N choices left") and the Create/Save confirmation list.
 * Empty array = the setup is fully chosen. Never blocks — defaults keep the build legal.
 */
export function setupMissing(build: BuildState, content: ContentDatabase): string[] {
  const out: string[] = [];
  const ancestry = build.ancestryId ? content.ancestries[build.ancestryId] : undefined;
  const background = resolveBackground(build, content);
  const cls = build.classId ? content.classes[build.classId] : undefined;
  if (!ancestry) out.push('Ancestry');
  if (!build.heritageId) out.push('Heritage');
  if (!background) out.push('Background');
  if (!cls) out.push('Class');
  if (ancestry) {
    const slots = build.options?.alternateAncestryBoosts ? 2 : boostSlots(ancestry.abilityBoosts).length;
    let n = 0;
    for (let i = 0; i < slots; i++) if (!build.ancestryBoosts[i]) n++;
    if (n) out.push(n === 1 ? 'Ancestry boost' : `Ancestry boosts (${n})`);
  }
  if (background && build.backgroundId !== CUSTOM_BACKGROUND_ID) {
    const slots = boostSlots(background.abilityBoosts).length;
    let n = 0;
    for (let i = 0; i < slots; i++) if (!build.backgroundBoosts[i]) n++;
    if (n) out.push(n === 1 ? 'Background boost' : `Background boosts (${n})`);
    if (
      background.trainedSkillChoice?.length &&
      !(build.backgroundSkillChoice && background.trainedSkillChoice.includes(build.backgroundSkillChoice))
    )
      out.push('Background trained skill');
  }
  if (cls) {
    // The key-attribute choice: a racket-style keyAbilityOptions subclass, or the class's own
    // multi-key list when no chosen option fixes the attribute.
    const sub = cls.subclass?.options.find((o) => o.id === build.subclassId);
    const opts = sub?.keyAbilityOptions?.length
      ? sub.keyAbilityOptions
      : subclassKeyAbility(build, content)
        ? []
        : cls.keyAbility;
    if (opts.length > 1 && !(build.keyAbility && opts.includes(build.keyAbility))) out.push('Key attribute');
  }
  // A deity is a level-0 choice for classes that require one (cleric, champion) or for a subclass that
  // demands it (e.g. rogue Avenger). Flag it as missing so Setup completeness reflects it.
  if (buildNeedsDeity(build, content) && !build.deityId) out.push('Deity');
  const heritage = build.heritageId ? content.heritages[build.heritageId] : undefined;
  if (heritage?.grantsGeneralFeat && !build.heritageFeatId) out.push('Heritage general feat');
  if (heritage?.choiceResistance && !build.heritageResistanceChoice) out.push('Heritage resistance');
  {
    const n = build.levelBoosts.filter((b) => !b).length;
    if (n) out.push(n === 1 ? 'Free attribute boost' : `Free attribute boosts (${n})`);
  }
  if (build.options?.voluntaryFlaw && !build.options.voluntaryFlawAbility) out.push('Voluntary flaw attribute');
  return out;
}

function collectBoosts(
  build: BuildState,
  content: ContentDatabase,
  uptoLevel: number,
): { boosts: AbilityId[]; flaws: AbilityId[] } {
  const boosts: AbilityId[] = [];
  const flaws: AbilityId[] = [];

  // A single boost "event" (the 4 free at level 1, the 4 at each of 5/10/15/20,
  // an ancestry's free boosts) must target distinct attributes — so push each
  // group de-duplicated. This guarantees a legal Character even if the UI lets a
  // duplicate slip through.
  const pushDistinct = (sels: (AbilityId | null)[]) => {
    const seen = new Set<AbilityId>();
    for (const sel of sels) if (sel && !seen.has(sel)) (seen.add(sel), boosts.push(sel));
  };

  const ancestry = build.ancestryId ? content.ancestries[build.ancestryId] : undefined;
  if (ancestry) {
    if (build.options?.alternateAncestryBoosts) {
      // Replace the ancestry's listed boosts AND flaws with two free attribute boosts.
      pushDistinct((build.ancestryBoosts ?? []).slice(0, 2));
    } else {
      boosts.push(...fixedBoosts(ancestry.abilityBoosts));
      flaws.push(...ancestry.abilityFlaws);
      // The free ancestry boost must differ from the ancestry's fixed boosts AND its flaw (all granted
      // by the same source at the same time) — filter those out so a pick can't double-boost one attribute.
      const ancTaken = new Set<AbilityId>([...fixedBoosts(ancestry.abilityBoosts), ...ancestry.abilityFlaws]);
      pushDistinct((build.ancestryBoosts ?? []).filter((a) => a == null || !ancTaken.has(a)));
    }
  }
  // Voluntary Flaw: an additional attribute flaw the player elected to take (toggle in Setup, attribute
  // chosen at level 0).
  if (build.options?.voluntaryFlaw && build.options.voluntaryFlawAbility) flaws.push(build.options.voluntaryFlawAbility);

  const background = resolveBackground(build, content);
  if (background) {
    boosts.push(...fixedBoosts(background.abilityBoosts));
    // The free background boost must differ from the background's fixed boost (same-source rule).
    const bgFixed = new Set<AbilityId>(fixedBoosts(background.abilityBoosts));
    pushDistinct((build.backgroundBoosts ?? []).filter((a) => a == null || !bgFixed.has(a)));
  }

  const cls = build.classId ? content.classes[build.classId] : undefined;
  if (cls) {
    const key = subclassKeyAbility(build, content) ?? build.keyAbility ?? cls.keyAbility[0];
    if (key) boosts.push(key);
  }
  // Dual Class: "add everything from each class" (GMG) includes the SECOND class's initial key-attribute
  // boost — a distinct source, so it can stack onto the first even on the same attribute (level-1 boosts
  // from different sources may share an attribute). Falls back to the class's default key when unset.
  const cls2b = build.variantRules?.dualClass && build.classId2 ? content.classes[build.classId2] : undefined;
  // (No separate key-attribute choice is stored for the 2nd class, so a class with a key-attribute CHOICE
  // uses its first option — the common case is a single fixed key attribute.)
  if (cls2b?.keyAbility[0]) boosts.push(cls2b.keyAbility[0]);

  pushDistinct(build.levelBoosts);

  // Mid-career attribute boosts (5/10/15/20, or the Gradual schedule), applied in level order so the
  // +1-past-18 partial rule resolves the same way the rules describe it. Cap each level to the active
  // count so stale picks (e.g. after toggling Gradual on) don't over-grant.
  const boostCount = attributeBoostCount(build.variantRules);
  for (const lvl of attributeBoostLevels(build.variantRules)) {
    if (lvl > uptoLevel) continue;
    pushDistinct((build.attributeBoosts[lvl] ?? []).slice(0, boostCount));
  }

  // ABP Attribute Apex (level 17) is NOT an ordinary boost — it works like an apex item ("raise to 18,
  // or +2 if already 18+"). It's applied separately in computeAbilitiesDetailed after all boosts.

  return { boosts, flaws };
}

/**
 * Apply flaws (-2 each) then boosts (+2, or +1 once the score is 18+).
 * `uptoLevel` bounds which attribute-boost levels are folded in (defaults to the
 * build's target level; pass 1 for the initial, level-1 scores).
 */
export function computeAbilities(
  build: BuildState,
  content: ContentDatabase,
  uptoLevel: number = build.level,
): AbilityScores {
  return computeAbilitiesDetailed(build, content, uptoLevel).scores;
}

/** Like computeAbilities, but also reports which attributes received a *partial*
 *  (+1) boost — i.e. were boosted while already at 18+ — so the UI can flag them. */
export function computeAbilitiesDetailed(
  build: BuildState,
  content: ContentDatabase,
  uptoLevel: number = build.level,
): { scores: AbilityScores; partial: AbilityId[] } {
  const { boosts, flaws } = collectBoosts(build, content, uptoLevel);
  const s: AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  for (const f of flaws) s[f] -= 2;
  const partial = new Set<AbilityId>();
  for (const b of boosts) {
    if (s[b] >= 18) partial.add(b);
    s[b] += s[b] >= 18 ? 1 : 2;
  }
  // ABP Attribute Apex (gained at 17th, applied after all ordinary boosts): works like an apex item —
  // raise the chosen attribute to 18, or by 2 if it's already 18+ (NOT a normal +2/+1 boost).
  if (build.variantRules?.abp && uptoLevel >= 17 && build.abpApex) {
    const a = build.abpApex;
    s[a] = s[a] >= 18 ? s[a] + 2 : 18;
  }
  return { scores: s, partial: [...partial] };
}

/** The highest proficiency a skill increase can reach at a given character level. */
export function skillIncreaseCap(level: number): ProficiencyRank {
  if (level >= 15) return 'legendary';
  if (level >= 7) return 'master';
  return 'expert';
}

/** Raise a rank by one step, never past the cap and never below the current rank. */
function stepRank(current: ProficiencyRank, cap: ProficiencyRank): ProficiencyRank {
  const ci = PROFICIENCY_RANKS.indexOf(current);
  const next = PROFICIENCY_RANKS[Math.min(ci + 1, PROFICIENCY_RANKS.indexOf(cap))];
  return PROFICIENCY_RANKS.indexOf(next) > ci ? next : current;
}

/** Whichever rank is higher. */
function maxRank(a: ProficiencyRank, b: ProficiencyRank): ProficiencyRank {
  return PROFICIENCY_RANKS.indexOf(b) > PROFICIENCY_RANKS.indexOf(a) ? b : a;
}

/**
 * A free-text Lore subject → the proficiency key that stores it.
 *
 * The same subject reaches us typed by a player ("Warfare Lore"), printed on a background, and
 * listed on an apparition — so all three have to normalize identically or a character ends up
 * trained in two Lores that are the same Lore.
 */
function loreKey(subject: string): ProficiencyKey {
  const s = subject
    .toLowerCase()
    .replace(/\s*lore$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `lore:${s}` as ProficiencyKey;
}

/** Whichever rank is lower — used for CEILINGS (a class archetype that removes training). */
function minRank(a: ProficiencyRank, b: ProficiencyRank): ProficiencyRank {
  return PROFICIENCY_RANKS.indexOf(b) < PROFICIENCY_RANKS.indexOf(a) ? b : a;
}

const SAVE_TRACKS: readonly string[] = ['fortitude', 'reflex', 'will'];
const WEAPON_TRACKS: readonly string[] = ['unarmed', 'simple', 'martial', 'advanced'];
const ARMOR_TRACKS: readonly string[] = ['unarmored', 'light', 'medium', 'heavy'];
// Weapon-GROUP advancement tracks (alchemist bombs, gunslinger firearms) → proficiencies.weaponGroups.
const WEAPON_GROUP_TRACKS: readonly string[] = ['bomb', 'firearm', 'crossbow'];

/** Apply one advancement entry to the proficiency block / spellcasting entries (never lowers). */
function applyAdvancement(
  p: Proficiencies,
  casting: SpellcastingEntry[],
  e: AdvancementEntry,
  ownerClassId?: string,
): void {
  const t = e.track;
  if (t === 'perception') p.perception = maxRank(p.perception, e.rank);
  else if (t === 'classDc') p.classDc = maxRank(p.classDc, e.rank);
  // Spellcasting proficiency advances on the OWNING class's chassis only — under Dual Class each class
  // caps its own entry (a magus tops at master even if paired with a legendary-caster bard). Entries are
  // keyed `${classId}-casting` / `${classId}-focus`; with no owner (legacy callers) bump every entry.
  else if (t === 'spellcasting') {
    for (const c of casting) if (!ownerClassId || c.id.startsWith(ownerClassId + '-')) c.proficiency = maxRank(c.proficiency, e.rank);
  } else if (SAVE_TRACKS.includes(t)) p.saves[t as SaveId] = maxRank(p.saves[t as SaveId], e.rank);
  else if (WEAPON_TRACKS.includes(t)) p.attacks[t as WeaponCategory] = maxRank(p.attacks[t as WeaponCategory], e.rank);
  else if (ARMOR_TRACKS.includes(t)) p.defenses[t as ArmorCategory] = maxRank(p.defenses[t as ArmorCategory], e.rank);
  else if (WEAPON_GROUP_TRACKS.includes(t)) (p.weaponGroups ??= {})[t] = maxRank(p.weaponGroups?.[t], e.rank);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Clean a feat choice-option label for display.
 *
 * The importer resolved Foundry's i18n KEYS rather than their translations for some options, leaving
 * the trailing key segment in the visible text: `PF2E.PerceptionLabel` → "Perception Label",
 * `PF2E.TraitLightShort` → "Light Short", `PF2E.SavesFortitude` → "Saves Fortitude". Canny Acumen's
 * dropdown read "Saves Fortitude / Saves Reflex / Saves Will / Perception Label".
 *
 * Only the recoverable shapes are repaired. A few dozen options came through as the bare word
 * "Label" — the actual name is simply absent from the data, so there is nothing to strip; those are
 * returned untouched rather than blanked to an empty dropdown entry. Fixing them needs real data,
 * not a regex.
 */
export function featChoiceLabel(raw: string): string {
  // A raw Foundry compendium PATH ("Compendium.pf2e.classfeatures.Item.Blessed Armament") — the
  // importer kept the reference instead of the referenced feature's name. Keep only the last
  // segment, which IS the name. Affects Devout Blessing / Second Blessing / Manifold Modifications,
  // whose dropdowns otherwise read as full dotted paths.
  const compendium = /^Compendium\.[A-Za-z0-9-]+\.[A-Za-z0-9-]+\.Item\.(.+)$/.exec(raw);
  if (compendium) return compendium[1];
  // "Ability Str" / "Ability Dex" (the dedication attribute pickers) — expand to the real name.
  const ability = /^Ability\s+(Str|Dex|Con|Int|Wis|Cha)$/i.exec(raw);
  if (ability) return ABILITY_NAMES[ability[1].toLowerCase()] ?? raw;
  const s = raw.replace(/\s+(?:Label|Short)$/, '').replace(/^Saves\s+/, '');
  return s || raw;
}

/**
 * Options for a `kind: 'skills'` feat choice — the skills this character actually qualifies with.
 *
 * Assurance ("Choose a skill you're trained in") is why this exists: which skills qualify depends on
 * the BUILD and grows as it grows, so they can never be enumerated on the record. That is exactly
 * why Assurance shipped with no choice at all and the feat did nothing.
 *
 * Lores are included — the rules let you choose one — and are keyed `lore:<subject>`, so the subject
 * becomes the label. Sorted by rank (best first) then name, so the likely pick is at the top.
 */
/**
 * The signature spells at one rank, whichever shape they are stored in.
 *
 * A saved character may hold the LEGACY bare string (one per rank). `build` is never normalized on
 * load, so widening the type without this would compile clean and silently drop those picks. Every
 * reader goes through here; every writer stores an array.
 */
export function signaturesAt(store: Record<number, string | string[]> | undefined, rank: number): string[] {
  const v = store?.[rank];
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

/** Toggle one spell's signature status at a rank, returning the new store. */
export function toggleSignature(
  store: Record<number, string | string[]> | undefined,
  rank: number,
  spellId: string,
): Record<number, string | string[]> {
  const next = { ...(store ?? {}) };
  const after = signaturesAt(next, rank).includes(spellId)
    ? signaturesAt(next, rank).filter((x) => x !== spellId)
    : [...signaturesAt(next, rank), spellId];
  if (after.length) next[rank] = after;
  else delete next[rank];
  return next;
}

export function trainedSkillOptions(
  character: { proficiencies: { skills: Record<string, ProficiencyRank> } },
  minRank: ProficiencyRank = 'trained',
): { value: string; label: string }[] {
  const RANK_ABBR: Record<ProficiencyRank, string> = { untrained: 'U', trained: 'T', expert: 'E', master: 'M', legendary: 'L' };
  const floor = PROFICIENCY_RANKS.indexOf(minRank);
  return Object.entries(character.proficiencies.skills)
    .filter(([, rank]) => PROFICIENCY_RANKS.indexOf(rank) >= floor)
    .sort(([aK, aR], [bK, bR]) => PROFICIENCY_RANKS.indexOf(bR) - PROFICIENCY_RANKS.indexOf(aR) || aK.localeCompare(bK))
    .map(([key, rank]) => {
      const name = key.startsWith('lore:') ? `${cap(key.slice(5).replace(/-/g, ' '))} Lore` : cap(key);
      return { value: key, label: `${name} (${RANK_ABBR[rank]})` };
    });
}

const ABILITY_NAMES: Record<string, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

/**
 * Heading for a feat's sub-choice card / picker.
 *
 * The importer failed to resolve Foundry's i18n key for 31 feats and stored the literal word
 * "Prompt", so the builder showed a card headed "Prompt" with a button reading "Prompt…". Four
 * dedications got a concatenated key, "Class DCAbility Score". Fall back to the same wording the
 * other 28 feats already use rather than inventing a new one.
 */
export function featChoicePrompt(prompt: string | undefined, flag?: string): string {
  if (prompt === 'Class DCAbility Score') return 'Ability score';
  if (prompt && prompt !== 'Prompt') return prompt;
  // 30 records carry the importer's placeholder prompt, so every one of those pickers read "Choose an
  // option". The FLAG usually names the thing being chosen ("terrain", "damage", "performanceType"),
  // which is a far better label than nothing — humanise it rather than throwing the information away.
  if (flag && flag !== 'choice') {
    const words = flag
      .replace(/^feat/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .trim()
      .toLowerCase();
    if (words) return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return 'Choose an option';
}

function slug(s: string): string {
  // Strip apostrophes FIRST (matches the importer's slug, so "Cat's Luck" -> "cats-luck", not
  // "cat-s-luck") — otherwise a has-feat prerequisite naming an apostrophe feat never matches its id.
  return s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
}

/** Build a complete, renderable Character from the current choices. */
/**
 * Language choices the character's RECORDS grant, on top of Int and ancestry.
 *
 * Nothing expressed a language choice before this, so "you learn three new languages of your choice"
 * had no home and Multilingual — the most-taken language feat in the game — did nothing.
 *
 * A feat taken twice grants its languages twice (Multilingual is explicitly repeatable), which is why
 * this counts feat INSTANCES rather than distinct ids. `skills` is what makes "an additional language
 * if you are or become a master in Society" rise with the character instead of freezing at selection.
 */
export function recordLanguageSlots(
  content: ContentDatabase,
  featIds: readonly string[],
  heritageId: string | null | undefined,
  investedItemIds: readonly string[],
  skills: Partial<Record<ProficiencyKey, ProficiencyRank>>,
  level: number,
): number {
  const sources: { id: string; g: DefenseGrants }[] = [];
  for (const id of featIds) {
    const f = content.feats[id];
    if (f) sources.push({ id, g: f });
  }
  if (heritageId && content.heritages[heritageId]) sources.push({ id: heritageId, g: content.heritages[heritageId] });
  for (const id of investedItemIds) {
    const pe = content.items[id]?.passiveEffects;
    if (pe) sources.push({ id, g: pe });
  }

  let n = 0;
  for (const { id, g } of sources) {
    let own =
      typeof g.languageChoices === 'string'
        ? resolveFormula(g.languageChoices, { level })
        : (g.languageChoices ?? 0);
    if (!own && !g.languageChoicesAtRank?.length) continue;
    for (const r of g.languageChoicesAtRank ?? []) {
      const have = skills[r.skill] ?? 'untrained';
      if (PROFICIENCY_RANKS.indexOf(have) >= PROFICIENCY_RANKS.indexOf(r.rank)) own += r.extra;
    }
    // "When you select the Multilingual feat, you learn three new languages instead of two" — another
    // record raising THIS one's count, once per time this one was taken.
    for (const { g: other } of sources) {
      for (const b of other.languageChoicesBonus ?? []) if (b.featId === id) own += b.extra;
    }
    n += own;
  }
  return n;
}

/** How many bonus languages the character may choose: max(0, Int mod) + ancestry's extra + records'. */
export function bonusLanguageSlots(build: BuildState, content: ContentDatabase): number {
  const ancestry = build.ancestryId ? content.ancestries[build.ancestryId] : undefined;
  const intMod = abilityMod(computeAbilities(build, content).int);
  const base = Math.max(0, intMod) + (ancestry?.languages.additional ?? 0);
  // EVERY feat the character has, not only the slot-picked ones. Multilingual reached by a
  // background, a heritage, a pick-a-feat grant or an override produced no language slots at all,
  // because only `featPicks` was read — the same "only slot picks are scanned" gap that hid the
  // granted-feat sub-choices.
  // NOT deduped: Multilingual is repeatable and taking it twice grants twice as many languages, so
  // this has to stay the multiset the built feat list already is.
  const featIds = buildCharacter(build, content).feats.map((f) => f.featId);
  const needsRanks = featIds.some((id) => content.feats[id]?.languageChoicesAtRank?.length);
  const skills = needsRanks ? buildCharacter(build, content).proficiencies.skills : {};
  return (
    base +
    recordLanguageSlots(
      content,
      featIds,
      build.heritageId,
      (build.inventory ?? []).filter((inv) => inv.invested).map((inv) => inv.itemId),
      skills,
      build.level,
    )
  );
}

/** Does this class make the character choose a deity? The class carries a deity feature whose id is
 *  namespaced per class in the Foundry data — cleric uses 'deity-cleric', champion 'deity-champion'
 *  (older/hand-authored data may use a bare 'deity'). Any of these drives the deity picker, the
 *  divine-font default, and the favored-weapon override. */
export function classChoosesDeity(features?: { featureId: string }[]): boolean {
  return (features ?? []).some((f) => f.featureId === 'deity' || /^deity-/.test(f.featureId));
}

/** Does this *build* need a deity? True when the class chooses one, or the picked subclass requires
 *  it (rogue Avenger racket must follow a deity even though the rogue class normally doesn't). */
export function buildNeedsDeity(build: BuildState, content: ContentDatabase): boolean {
  const cls = build.classId ? content.classes[build.classId] : undefined;
  const cls2 = build.variantRules?.dualClass && build.classId2 ? content.classes[build.classId2] : undefined;
  if (classChoosesDeity(cls?.features) || classChoosesDeity(cls2?.features)) return true;
  const sub = cls?.subclass?.options.find((o) => o.id === build.subclassId);
  const sub2 = cls2?.subclass?.options.find((o) => o.id === build.subclassId2);
  return !!sub?.requiresDeity || !!sub2?.requiresDeity;
}

/** Champion devotion (focus) spell options, gated by the deity's font: Shields of the Spirit is
 *  always available, Lay on Hands if the deity allows heal, Touch of the Void if it allows harm. */
export function championDevotionOptions(build: BuildState, content: ContentDatabase): string[] {
  const font = (build.deityId ? content.deities[build.deityId]?.divineFont : undefined) ?? [];
  return [
    'shields-of-the-spirit',
    ...(font.includes('heal') ? ['lay-on-hands'] : []),
    ...(font.includes('harm') ? ['touch-of-the-void'] : []),
  ];
}
/** The champion's resolved devotion spell: the explicit pick if still valid, else a font-based default. */
export function championDevotionSpell(cls: { features?: { featureId: string }[] } | undefined, build: BuildState, content: ContentDatabase): string | undefined {
  if (!(cls?.features ?? []).some((f) => f.featureId === 'devotion-spells')) return undefined;
  const opts = championDevotionOptions(build, content);
  if (build.devotionSpell && opts.includes(build.devotionSpell)) return build.devotionSpell;
  return opts.find((o) => o !== 'shields-of-the-spirit') ?? 'shields-of-the-spirit';
}

/**
 * Deadly Simplicity (cleric/warpriest) has the prerequisite "deity with a simple or unarmed attack
 * favored weapon". So a longsword-deity warpriest (Iomedae) does NOT get it, but a simple/unarmed
 * favored-weapon deity does. A favored weapon is unarmed when it's not a real weapon ITEM (e.g.
 * Irori's "fist"); otherwise it qualifies only when the item's category is `simple`.
 */
export function deityFavorsSimpleOrUnarmed(deityId: string | null | undefined, content: ContentDatabase): boolean {
  const deity = deityId ? content.deities[deityId] : undefined;
  return (deity?.favoredWeapons ?? []).some((w) => {
    const item = content.items[w];
    // A favored weapon that isn't a real weapon ITEM, or is an unarmed/simple weapon (Irori's "fist"),
    // qualifies. (The new data ships "Fist" as a real unarmed weapon item, so check the category too.)
    return !item || (item.itemType === 'weapon' && (item.category === 'simple' || item.category === 'unarmed'));
  });
}

const TACTIC_TIER_RANK = { basic: 0, expert: 1, master: 2, legendary: 3 } as const;
type TacticTier = keyof typeof TACTIC_TIER_RANK;

/** All tactic actions a commander may put in their folio at this level (tier unlocked by level). */
export function commanderTacticOptions(level: number, content: ContentDatabase): Action[] {
  const maxRank = TACTIC_TIER_RANK[commanderMaxTier(level)];
  return Object.values(content.actions)
    .filter((a) => a.traits?.includes('tactic') && TACTIC_TIER_RANK[(a.tacticTier ?? 'basic') as TacticTier] <= maxRank)
    .sort((a, b) => a.name.localeCompare(b.name));
}
/** Highest tactic tier a commander can learn at this level. */
export function commanderMaxTier(level: number): TacticTier {
  if (level >= 19) return 'legendary';
  if (level >= 15) return 'master';
  if (level >= 7) return 'expert';
  return 'basic';
}
/** Folio capacity: 5 starting tactics, +2 each at the Expert/Master/Legendary Tactician levels. */
export function commanderFolioMax(level: number): number {
  return 5 + (level >= 7 ? 2 : 0) + (level >= 15 ? 2 : 0) + (level >= 19 ? 2 : 0);
}

/**
 * The character level at which the Nth pick of a choice group becomes available.
 *
 * `pickByLevel` is CUMULATIVE ({1:1, 5:2, 15:3} = one implement at 1, two at 5, three at 15), so the
 * slot at index `i` opens at the lowest level whose cumulative count exceeds `i`. Without this every
 * pick in a group would inherit the group's entry level and a level-15 implement would count as owned
 * from level 1.
 */
export function extraPickLevel(g: ChoiceGroup, index: number): number {
  const steps = Object.entries(g.pickByLevel)
    .map(([lvl, count]) => ({ level: Number(lvl), count: Number(count) }))
    .sort((a, b) => a.level - b.level);
  for (const s of steps) if (s.count > index) return s.level;
  return steps[steps.length - 1]?.level ?? 1;
}

/** Inventor modification tiers → the class level each is gained. */
export const INVENTOR_TIER_LEVEL = { initial: 1, breakthrough: 7, revolutionary: 15 } as const;
export type InventorTier = keyof typeof INVENTOR_TIER_LEVEL;
export type InnovationType = 'armor' | 'weapon' | 'construct';

/** Kineticist Gate's Threshold levels (each lets you Expand the Portal or Fork the Path for a new element). */
export const GATE_THRESHOLD_LEVELS = [5, 9, 13, 17] as const;

/** A kineticist's effective kinetic elements: the L1 gate picks plus any gained via Fork the Path at a
 *  reached Gate's Threshold. Returns element option ids (e.g. 'fire-gate'). */
export function kineticistElements(build: BuildState, level: number): string[] {
  const base = build.extraChoices?.['element'] ?? [];
  const forks = Object.entries(build.gateForks ?? {})
    .filter(([lvl, el]) => !!el && Number(lvl) <= level)
    .map(([, el]) => el);
  return [...new Set([...base, ...forks])];
}

/** Maps an innovation subclass id to its modification type (light-mortar is archetype-only → none). */
export function innovationType(subclassId: string | null | undefined): InnovationType | undefined {
  if (subclassId === 'armor-innovation') return 'armor';
  if (subclassId === 'weapon-innovation') return 'weapon';
  if (subclassId === 'construct-innovation') return 'construct';
  return undefined;
}

/**
 * Modifications selectable for a given innovation + tier: class-features tagged
 * `<type>-innovation-modification` whose level ≤ the tier level (higher tiers may re-pick lower-tier
 * mods). Armor sub-gates (power-suit / subterfuge-suit) are enforced; weapon sub-gates depend on the
 * chosen base weapon (not modelled) so all weapon mods of the tier are offered. Construct mods are
 * prose-only in the dataset (no items) → returns [].
 */
export function inventorModificationOptions(
  content: ContentDatabase,
  type: InnovationType,
  armorStats: 'power-suit' | 'subterfuge-suit' | undefined,
  maxTierLevel: number,
): ClassFeature[] {
  const typeTag = `${type}-innovation-modification`;
  return Object.values(content.classFeatures)
    .filter((f) => f.otherTags?.includes(typeTag) && f.level <= maxTierLevel)
    .filter((f) => {
      const tags = f.otherTags ?? [];
      if (type === 'armor') {
        if (tags.includes('power-suit-modification') && armorStats !== 'power-suit') return false;
        if (tags.includes('subterfuge-suit-modification') && armorStats !== 'subterfuge-suit') return false;
      }
      return true;
    })
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

/**
 * Curated melee strikes for feat ChoiceSet picks whose grant is an ItemAlteration (not a `Strike`
 * rule element) — so they can't be extracted at import. Keyed featId → choiceValue. Iruxi's "claw"
 * upgrades the lizardfolk-claws weapon (a separate item the app doesn't model), so we supply the
 * resulting d6 versatile-p claw directly to close the headline case.
 */
const FEAT_CHOICE_STRIKES: Record<string, Record<string, NaturalAttack>> = {
  'iruxi-armaments': {
    claw: { name: 'Claw', die: 'd6', damageType: 'slashing', traits: ['agile', 'finesse', 'unarmed', 'versatile-p'], group: 'brawling' },
  },
};

/**
 * Collect the melee unarmed Strikes a character's feats / heritage / ancestry / class features grant
 * (each entry's `grantedStrikes`, resolving ChoiceSet picks), as NaturalAttacks. Pass a pre-seeded
 * `seen` set (e.g. names already present from a WG import) to dedup against it; the set is mutated.
 */
function collectGrantedNaturals(
  content: ContentDatabase,
  feats: { featId: string; choice?: { value: string } }[],
  heritageId: string | null | undefined,
  ancestryId: string | null | undefined,
  classId: string | null | undefined,
  level: number,
  seen: Set<string> = new Set(),
  investedItemIds: string[] = [],
  /** The chosen subclass. Appended rather than placed beside classId so the positional callers below
   *  keep working; a subclass that grants a Strike (Unfurling Brocade) granted none without it. */
  subclassId?: string | null,
): NaturalAttack[] {
  const out: NaturalAttack[] = [];
  const push = (gs: GrantedStrike[] | undefined, pick?: string) => {
    for (const g of gs ?? []) {
      if (g.choiceValue && g.choiceValue !== pick) continue;
      const key = g.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: g.name, die: g.die, damageType: g.damageType, traits: g.traits, group: g.group, range: g.range });
    }
  };
  for (const f of feats) {
    push(content.feats[f.featId]?.grantedStrikes, f.choice?.value);
    const curated = f.choice?.value ? FEAT_CHOICE_STRIKES[f.featId]?.[f.choice.value] : undefined;
    if (curated && !seen.has(curated.name.toLowerCase())) {
      seen.add(curated.name.toLowerCase());
      out.push({ ...curated });
    }
  }
  if (heritageId) push(content.heritages[heritageId]?.grantedStrikes);
  if (ancestryId) push(content.ancestries[ancestryId]?.grantedStrikes);
  const cls = classId ? content.classes[classId] : undefined;
  for (const cf of cls?.features ?? []) if (cf.level <= level) push(content.classFeatures[cf.featureId]?.grantedStrikes);
  // The chosen SUBCLASS's own record. `cls.features` lists the class's features, never the option the
  // player picked, so a subclass that grants a Strike (Unfurling Brocade) granted none.
  if (subclassId) push(content.classFeatures[subclassId]?.grantedStrikes);
  // Invested items that grant a Strike (Phantom Shroud → ghostly touch).
  for (const itemId of investedItemIds) push(content.items[itemId]?.grantedStrikes);
  return out;
}

/**
 * Apply Overrides CONTENT edits as a SHALLOW overlay on top of the shared content database WITHOUT
 * mutating it (the DB is an ~18 MB cached singleton shared by every character). Only ever spreads into
 * new objects, and returns the SAME base reference when there are no edits — so memo identity is
 * preserved and content-keyed memos don't thrash. Overlays feat + class-feature field edits.
 */
export function applyOverrides(base: ContentDatabase, ov?: BuildOverrides): ContentDatabase {
  const edits = ov?.contentEdits;
  const featEdits = edits?.feats && Object.keys(edits.feats).length ? edits.feats : null;
  const featureEdits = edits?.classFeatures && Object.keys(edits.classFeatures).length ? edits.classFeatures : null;
  if (!featEdits && !featureEdits) return base;
  const next: ContentDatabase = { ...base };
  if (featEdits) {
    const m = { ...base.feats };
    for (const [id, patch] of Object.entries(featEdits)) if (m[id]) m[id] = { ...m[id], ...patch };
    next.feats = m;
  }
  if (featureEdits) {
    const m = { ...base.classFeatures };
    for (const [id, patch] of Object.entries(featureEdits)) if (m[id]) m[id] = { ...m[id], ...patch };
    next.classFeatures = m;
  }
  return next;
}

/** Every content id the build already references, so a source filter never drops a chosen entry. */
export function collectChosenIds(build: BuildState, content: ContentDatabase): Set<string> {
  const ids = new Set<string>();
  const add = (id?: string | null) => {
    if (id) ids.add(id);
  };
  add(build.ancestryId);
  add(build.heritageId);
  add(build.classId);
  add(build.classId2);
  add(build.subclassId);
  add(build.subclassId2);
  add(build.deityId);
  if (build.backgroundId && build.backgroundId !== CUSTOM_BACKGROUND_ID) add(build.backgroundId);
  for (const v of Object.values(build.featPicks)) add(v);
  for (const v of Object.values(build.featChoices)) add(v);
  for (const arr of Object.values(build.extraChoices)) for (const v of arr) add(v);
  for (const id of backgroundGrantedFeats(resolveBackground(build, content), build.backgroundSkillChoice)) add(id);
  add(build.heritageFeatId);
  add(build.umtFeatId);
  for (const v of Object.values(build.dedicationSkillFeats ?? {})) add(v);
  add(build.voiceOfNature);
  add(build.primaryApparition);
  add(build.devotionSpell);
  add(build.dragonExemplar);
  for (const v of build.commanderTactics ?? []) add(v);
  for (const v of Object.values(build.gateForks ?? {})) add(v);
  for (const v of Object.values(build.gateExpands ?? {})) add(v);
  if (build.inventorModifications) {
    add(build.inventorModifications.initial);
    add(build.inventorModifications.breakthrough);
    add(build.inventorModifications.revolutionary);
  }
  for (const v of build.cantrips) add(v);
  for (const arr of Object.values(build.spells)) for (const v of arr) add(v);
  for (const r of Object.keys(build.signatures)) for (const v of signaturesAt(build.signatures, Number(r))) add(v);
  if (build.archetypeSpells) {
    for (const v of build.archetypeSpells.cantrips) add(v);
    for (const arr of Object.values(build.archetypeSpells.spells)) for (const v of arr) add(v);
  }
  for (const it of build.inventory) {
    add(it.itemId);
    add(it.heldSpell);
  }
  for (const a of build.overrides?.addedFeats ?? []) add(a.featId);
  for (const id of build.overrides?.allowedFeats ?? []) add(id);
  for (const a of build.overrides?.addedFeatures ?? []) add(a.featureId);
  for (const a of build.overrides?.addedSpells ?? []) add(a.spellId);
  return ids;
}

/** One thing the character has chosen that came from a book being switched off. */
export interface ChosenFromBook {
  id: string;
  name: string;
  /** The content map it lives in ('feats', 'spells', …) — used to group the warning. */
  kind: string;
  book: string;
}

/**
 * What this character would LOSE if `books` were switched off.
 *
 * Turning a source off hides it from every picker, but the character may already have taken things
 * from it. Silently keeping them makes the source list a lie; silently dropping them deletes a
 * player's choices without asking. So the caller warns with this list first.
 */
export function chosenFromBooks(build: BuildState, content: ContentDatabase, books: ReadonlySet<string>): ChosenFromBook[] {
  if (!books.size) return [];
  const chosen = collectChosenIds(build, content);
  const out: ChosenFromBook[] = [];
  const seen = new Set<string>();
  for (const m of CHOOSABLE_SOURCE_MAPS) {
    const map = content[m] as Record<string, { name?: string; source?: SourceInfo }> | undefined;
    if (!map) continue;
    for (const id of chosen) {
      if (seen.has(id)) continue;
      const e = map[id];
      const book = e?.source?.book?.trim();
      if (!e || !book || !books.has(book)) continue;
      seen.add(id);
      out.push({ id, name: e.name ?? id, kind: m, book });
    }
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

/**
 * Clear every reference to `ids` from the build — the inverse of collectChosenIds.
 *
 * Deliberately mirrors that function field for field: anything it can COLLECT must be removable here,
 * or switching a source off would leave a dangling reference the pickers can no longer show. Removing
 * an ancestry/class/background leaves that slot unset, which is the state a new character starts in,
 * so the builder already handles it and the player can simply pick again.
 */
export function removeChosenIds(build: BuildState, ids: ReadonlySet<string>): BuildState {
  if (!ids.size) return build;
  const gone = (v?: string | null) => !!v && ids.has(v);
  // Every id-bearing slot on BuildState is `string | null` (an unset ancestry is null, not absent), so
  // clearing one means writing null — the same value emptyBuild() uses.
  const clear = <T extends string | null | undefined>(v: T) => (gone(v) ? null : v);
  const filterRec = (r: Record<string, string> | undefined) =>
    r ? Object.fromEntries(Object.entries(r).filter(([, v]) => !gone(v))) : r;
  const filterArrRec = (r: Record<string, string[]> | undefined) =>
    r ? Object.fromEntries(Object.entries(r).map(([k, a]) => [k, a.filter((v) => !gone(v))])) : r;
  /** Signatures filter PER ID, not per rank — a rank can hold several now, and dropping the whole
   *  rank because one of them referenced removed content would silently delete the rest. Accepts
   *  either stored shape. */
  const filterSignatures = (r: Record<number, string | string[]>) => {
    const out: Record<number, string | string[]> = {};
    for (const k of Object.keys(r)) {
      const kept = signaturesAt(r, Number(k)).filter((v) => !gone(v));
      if (kept.length) out[Number(k)] = kept;
    }
    return out;
  };

  const next: BuildState = {
    ...build,
    ancestryId: clear(build.ancestryId),
    heritageId: clear(build.heritageId),
    classId: clear(build.classId),
    classId2: clear(build.classId2),
    subclassId: clear(build.subclassId),
    subclassId2: clear(build.subclassId2),
    deityId: clear(build.deityId),
    backgroundId: clear(build.backgroundId),
    heritageFeatId: clear(build.heritageFeatId),
    umtFeatId: clear(build.umtFeatId),
    voiceOfNature: clear(build.voiceOfNature),
    primaryApparition: clear(build.primaryApparition),
    devotionSpell: clear(build.devotionSpell),
    dragonExemplar: clear(build.dragonExemplar),
    featPicks: filterRec(build.featPicks) ?? build.featPicks,
    featChoices: filterRec(build.featChoices) ?? build.featChoices,
    dedicationSkillFeats: filterRec(build.dedicationSkillFeats),
    // Filtered per-rank: a rank may now hold several ids, and dropping the whole rank because one
    // of them referenced removed content would silently delete the others.
    signatures: filterSignatures(build.signatures),
    gateForks: filterRec(build.gateForks),
    gateExpands: filterRec(build.gateExpands),
    extraChoices: filterArrRec(build.extraChoices) ?? build.extraChoices,
    spells: filterArrRec(build.spells) ?? build.spells,
    cantrips: build.cantrips.filter((v) => !gone(v)),
    commanderTactics: build.commanderTactics?.filter((v) => !gone(v)),
    // An item is dropped outright; a held spell inside a kept item is just cleared.
    inventory: build.inventory.filter((it) => !gone(it.itemId)).map((it) => (gone(it.heldSpell) ? { ...it, heldSpell: undefined } : it)),
  };
  if (build.inventorModifications) {
    next.inventorModifications = {
      ...build.inventorModifications,
      initial: clear(build.inventorModifications.initial),
      breakthrough: clear(build.inventorModifications.breakthrough),
      revolutionary: clear(build.inventorModifications.revolutionary),
    };
  }
  if (build.archetypeSpells) {
    next.archetypeSpells = {
      ...build.archetypeSpells,
      cantrips: build.archetypeSpells.cantrips.filter((v) => !gone(v)),
      spells: filterArrRec(build.archetypeSpells.spells) ?? build.archetypeSpells.spells,
    };
  }
  if (build.overrides) {
    next.overrides = {
      ...build.overrides,
      addedFeats: build.overrides.addedFeats?.filter((a) => !gone(a.featId)),
      allowedFeats: build.overrides.allowedFeats?.filter((v) => !gone(v)),
      addedFeatures: build.overrides.addedFeatures?.filter((a) => !gone(a.featureId)),
      addedSpells: build.overrides.addedSpells?.filter((a) => !gone(a.spellId)),
    };
  }
  return next;
}

/** Hide content from disabled source books (the BUILDER's picker content only — never the sheet's).
 *  Keeps any entry whose book is enabled OR whose id is already chosen (`keepIds`). Returns the same
 *  ref when nothing is dropped (memo-safe, like applyOverrides). */
export function applySources(content: ContentDatabase, enabled: Set<string>, keepIds: Set<string>): ContentDatabase {
  const next: ContentDatabase = { ...content };
  let changed = false;
  for (const m of CHOOSABLE_SOURCE_MAPS) {
    const map = content[m] as Record<string, { source?: SourceInfo }> | undefined;
    if (!map) continue;
    let dropped = false;
    const filtered: Record<string, unknown> = {};
    for (const [id, e] of Object.entries(map)) {
      const book = e.source?.book?.trim(); // match sourceCatalog's whitespace-normalized book names
      if (!book || enabled.has(book) || keepIds.has(id)) filtered[id] = e;
      else dropped = true;
    }
    if (dropped) {
      (next as unknown as Record<string, unknown>)[m] = filtered;
      changed = true;
    }
  }
  return changed ? next : content;
}

/** Campaign content toggles, applied wherever the player browses/selects content. Mythic OFF hides
 *  every `mythic`-trait entry; Kingmaker OFF hides Kingmaker-sourced actions/conditions/feats/etc.
 *  Already-chosen ids (`keepIds`) are always kept so a toggle never breaks an existing character.
 *  Returns the same ref when nothing is dropped (memo-safe). */
/**
 * The per-character "Hide legacy data" filter. Superseded records (the outdated half of a remaster
 * change) are already pruned at import, so this only handles the toggle: when on, drop every record whose
 * edition is `legacy` or `legacy-era` (legacy-exclusive content), keeping a pure remaster/neutral view.
 * keepIds (the character's already-chosen ids) are never dropped, so enabling it can't invalidate a build.
 */
export function applyEditionFilter(
  content: ContentDatabase,
  opts: { hideLegacy?: boolean },
  keepIds: Set<string>,
): ContentDatabase {
  const LEGACY = new Set(['legacy', 'legacy-era']);
  let next: ContentDatabase = content;
  let changed = false;
  for (const m of Object.keys(content) as (keyof ContentDatabase)[]) {
    const map = content[m] as Record<string, { edition?: string }> | undefined;
    if (!map || typeof map !== 'object') continue;
    let dropped = false;
    const filtered: Record<string, unknown> = {};
    for (const [id, e] of Object.entries(map)) {
      const ed = e && typeof e === 'object' ? e.edition ?? '' : '';
      // 'superseded' (the renamed/outdated half of a remaster change) is ALWAYS hidden from pickers;
      // legacy/legacy-era only when the toggle is on. keepIds (already-chosen) are never dropped.
      const hide = ed === 'superseded' || (opts.hideLegacy === true && LEGACY.has(ed));
      if (keepIds.has(id) || !hide) filtered[id] = e;
      else dropped = true;
    }
    if (dropped) {
      if (!changed) { next = { ...content }; changed = true; }
      (next as unknown as Record<string, unknown>)[m] = filtered;
    }
  }
  return changed ? next : content;
}

export function applyContentToggles(
  content: ContentDatabase,
  opts: { mythicEnabled?: boolean; kingmakerEnabled?: boolean },
  keepIds: Set<string>,
): ContentDatabase {
  const dropMythic = !opts.mythicEnabled;
  const dropKM = !opts.kingmakerEnabled;
  if (!dropMythic && !dropKM) return content;
  const maps = new Set<string>();
  if (dropMythic) ['feats', 'spells', 'items', 'actions'].forEach((m) => maps.add(m));
  if (dropKM) ['actions', 'conditions', 'feats', 'backgrounds', 'items'].forEach((m) => maps.add(m));
  let next: ContentDatabase = content;
  let changed = false;
  for (const m of maps) {
    const map = content[m as keyof ContentDatabase] as Record<string, { traits?: string[]; source?: { book?: string } }> | undefined;
    if (!map) continue;
    let dropped = false;
    const filtered: Record<string, unknown> = {};
    for (const [id, e] of Object.entries(map)) {
      const hideMythic = dropMythic && (e.traits ?? []).includes('mythic');
      const hideKM = dropKM && /kingmaker/i.test(e.source?.book ?? '');
      if (keepIds.has(id) || (!hideMythic && !hideKM)) filtered[id] = e;
      else dropped = true;
    }
    if (dropped) {
      if (!changed) {
        next = { ...content };
        changed = true;
      }
      (next as unknown as Record<string, unknown>)[m] = filtered;
    }
  }
  return changed ? next : content;
}

export function buildCharacter(build: BuildState, content: ContentDatabase): Character {
  const { scores: abilities, partial: partialBoosts } = computeAbilitiesDetailed(build, content);
  // Override: force-set raw ability scores (no boost limits). Mutating this object in place flows to
  // HP (Con), spell slots (Cha/Wis), languages (Int), and — via Character.abilities — every derive.ts
  // stat (saves, skills, class/spell DC, strikes). An overridden score also clears its partial-boost flag.
  if (build.overrides?.attributes) {
    for (const [k, v] of Object.entries(build.overrides.attributes)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        abilities[k as AbilityId] = v;
        const pi = partialBoosts.indexOf(k as AbilityId);
        if (pi >= 0) partialBoosts.splice(pi, 1);
      }
    }
  }
  const cls = build.classId ? content.classes[build.classId] : undefined;
  // Dual Class variant: a second class contributes its HP/proficiencies/skills/features/feats.
  const cls2 = build.variantRules?.dualClass && build.classId2 ? content.classes[build.classId2] : undefined;
  // Dual Class: a subsystem owned by class `id` is active if EITHER class is it; resolve that class's
  // subclass id (kineticist element / inventor innovation are encoded as the subclass).
  const ownsClass = (id: string): boolean => cls?.id === id || cls2?.id === id;
  const defOf = (id: string): ClassDef | undefined => (cls?.id === id ? cls : cls2?.id === id ? cls2 : undefined);
  const subclassOf = (id: string): string | null => (cls?.id === id ? build.subclassId : cls2?.id === id ? build.subclassId2 ?? null : null);

  const subOption = cls?.subclass?.options.find((o) => o.id === build.subclassId);
  // Dual Class: the second class's chosen subclass also confers its grants (order skill, racket, etc.).
  const subOption2 = cls2?.subclass?.options.find((o) => o.id === build.subclassId2);
  // Sorcerer Draconic: the chosen dragon exemplar sets the spell tradition + the 2nd bloodline skill.
  const dragon = (subOption ?? subOption2)?.dragonChoice?.length
    ? (subOption ?? subOption2)!.dragonChoice!.find((d) => d.slug === build.dragonExemplar) ?? (subOption ?? subOption2)!.dragonChoice![0]
    : undefined;
  // Options chosen in extra choice groups (psychic subconscious mind, apparitions, …) — from EITHER
  // class (the groups are keyed by a subsystem-specific id, so the two classes never collide).
  const extraOptions: SubclassOption[] = [];
  for (const ec of [cls, cls2] as (ClassDef | undefined)[]) {
    for (const g of ec?.extraChoices ?? []) {
      for (const id of build.extraChoices?.[g.id] ?? []) {
        const o = g.options.find((opt) => opt.id === id);
        if (o) extraOptions.push(o);
      }
    }
  }
  // Kineticist Fork the Path: a reached Gate's Threshold adds a new element — fold its option in so its
  // skill grant applies and its impulses become available (impulse-feat eligibility reads this set).
  if (ownsClass('kineticist')) {
    const owned = new Set(extraOptions.map((o) => o.id));
    const elGroup = defOf('kineticist')?.extraChoices?.find((g) => g.id === 'element');
    for (const el of kineticistElements(build, build.level)) {
      if (owned.has(el)) continue;
      const o = elGroup?.options.find((opt) => opt.id === el);
      if (o) (extraOptions.push(o), owned.add(el));
    }
  }
  // Every option that confers grants (both classes' subclasses + any extra-choice picks).
  const grantOptions = [subOption, subOption2, ...extraOptions].filter(Boolean) as SubclassOption[];
  // A chosen option can set the spellcasting key ability (psychic subconscious mind = Int/Cha).
  // A keyAbilityOptions option (rogue racket) resolves through the player's pick instead.
  const keyOption = grantOptions.find((o) => o.keyAbility || o.keyAbilityOptions?.length);
  const choiceKeyAbility = keyOption ? resolveOptionKeyAbility(keyOption, build.keyAbility) : undefined;
  const ancestry = build.ancestryId ? content.ancestries[build.ancestryId] : undefined;

  // Tradition + key ability for a FOCUS pool. Slot casters reuse their spellcasting;
  // focus-only classes (champion devotion, monk ki, ranger warden/vindicator) have no
  // spellcasting block, so their focus spells use these class-defined values.
  const FOCUS_CASTING: Record<string, { tradition: Tradition; key: AbilityId }> = {
    champion: { tradition: 'divine', key: 'cha' },
    monk: { tradition: 'occult', key: 'wis' },
    ranger: { tradition: 'primal', key: 'wis' },
  };
  const background = resolveBackground(build, content);
  // A subclass/choice that sets the key ability (rogue racket, psychic subconscious
  // mind) overrides the class default — but not a deliberate multi-key pick (no class
  // has both, so this is safe). Then the player's pick, then the class's first key.
  const keyAbility = choiceKeyAbility ?? build.keyAbility ?? cls?.keyAbility[0] ?? null;
  const level = build.level;

  /**
   * Extra CANTRIPS known, needed HERE because the cantrip cap is applied while the spellcasting
   * entries are assembled — well before the spell-slot bonuses are collected, and before the resolved
   * `feats` array exists. So it reads the picks and the owned class features directly.
   *
   * The slot applier filters `r > 0`, so a `byRank['0']` was silently dropped and nothing could reach
   * this cap: Cantrip Expansion, one of the most-taken feats in the game, did nothing at all.
   */
  const cantripBonus = (() => {
    const sources = [
      ...Object.values(build.featPicks ?? {}).filter(Boolean).map((id) => content.feats[id as string]),
      ...[...classFeatureIdsOwned({ classId: build.classId, subclassId: build.subclassId, level }, content)]
        .map((id) => content.classFeatures[id]),
    ];
    let n = 0;
    for (const src of sources) n += src?.spellSlotBonus?.cantrips ?? 0;
    return n;
  })();

  const skills = {} as Record<ProficiencyKey, ProficiencyRank>;
  for (const sk of SKILLS) skills[sk] = 'untrained';
  // Trainings granted by other sources first; they "lock" a skill and don't
  // consume a class pick.
  const locked = new Set<ProficiencyKey>();
  if (cls) for (const sk of cls.trainedSkills.fixed) (skills[sk] = 'trained'), locked.add(sk);
  // Dual Class: also train the second class's fixed skills + lore (its restricted choice defaults to
  // the first option). The free-skill count is the larger of the two (see additionalClassSkills).
  if (cls2) {
    for (const sk of cls2.trainedSkills.fixed) (skills[sk] = 'trained'), locked.add(sk);
    if (cls2.trainedSkills.choice?.length) (skills[cls2.trainedSkills.choice[0]] = 'trained'), locked.add(cls2.trainedSkills.choice[0]);
    if (cls2.trainedSkills.lore) skills[`lore:${cls2.trainedSkills.lore}`] = 'trained';
  }
  // A class-level restricted skill choice (thaumaturge: one of Arcana/Nature/Occultism/Religion) +
  // its fixed Lore (Esoteric Lore). Reuses build.subclassSkill (no class has both kinds of choice).
  if (cls?.trainedSkills.choice?.length) {
    const pick =
      build.subclassSkill && cls.trainedSkills.choice.includes(build.subclassSkill) ? build.subclassSkill : cls.trainedSkills.choice[0];
    skills[pick] = 'trained';
    locked.add(pick);
  }
  if (cls?.trainedSkills.lore) skills[`lore:${cls.trainedSkills.lore}`] = 'trained';
  const bgTrainedSkill = backgroundTrainedSkill(build, background);
  if (bgTrainedSkill) (skills[bgTrainedSkill] = 'trained'), locked.add(bgTrainedSkill);
  if (background?.trainedLore) skills[`lore:${background.trainedLore}`] = 'trained';
  // The BACKGROUND's own embedded sub-choice ("an Ancestry Lore of your choice", "Guild Lore or
  // Heraldry Lore", "a skill of your choice"). 71 backgrounds carry one, the field was not even
  // declared, and nothing rendered or read it — so every one asked a question nobody was shown.
  // What the answer DOES is decided by what it IS, not by a per-flag lookup table: a skill trains
  // that skill, a Lore trains that Lore, a feat is granted below, anything else is recorded and
  // displayed. Nothing is invented for the 17 whose answer has no sheet number (a terrain, a
  // constellation, a deviant classification) — being asked and having the answer kept IS the fix.
  if (background?.choice) {
    const picked = backgroundChoiceValue(build, background);
    if (picked) {
      const kind = backgroundChoiceKind(background.choice, content);
      if (kind === 'lore') (skills[loreKey(picked)] = 'trained'), locked.add(loreKey(picked));
      else if (kind === 'skill' && (SKILLS as readonly string[]).includes(picked)) {
        (skills[picked as SkillId] = 'trained'), locked.add(picked as SkillId);
      }
    }
  }
  // "Legal Lore OR Underworld Lore": two NAMED subjects, so the answer is one of them rather than
  // free text. Unpicked defaults to the first, as every other unanswered choice in the builder does.
  const loreOptions = background?.trainedLoreOptions ?? [];
  if (loreOptions.length) {
    const picked = loreOptions.includes(build.backgroundLore ?? '') ? build.backgroundLore! : loreOptions[0];
    skills[`lore:${picked}` as ProficiencyKey] = 'trained';
  }
  // A "choose a Lore" background: the player types the subject (Lore is free-text).
  if (background?.trainedLoreChoice && !loreOptions.length && build.backgroundLore?.trim()) {
    const subj = build.backgroundLore.trim().toLowerCase().replace(/\s*lore$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (subj) skills[`lore:${subj}` as ProficiencyKey] = 'trained';
  }
  // "You gain all the mechanical benefits of the <X> heritage you selected at 1st level." Both feats
  // that say this require a VERSATILE heritage — which is what the character's single `heritageId`
  // records — so the 1st-level ancestry heritage was never stored anywhere and there was nothing to
  // dereference. The feat's own pick supplies it; with no answer, nothing is granted.
  // Through the shared helper, so the builder's pickers and the build agree on which heritage it is.
  const secondHeritageId = secondHeritageIdOf(build, content);

  // A "choose N Lores" heritage (Half Moon Sarangay: 2; Born of Item: 1) — each typed subject is trained.
  const heritageLoreN = [build.heritageId, secondHeritageId].reduce(
    (n, id) => n + (id ? content.heritages[id]?.loreChoices ?? 0 : 0),
    0,
  );
  if (heritageLoreN > 0) {
    for (const raw of (build.heritageLore ?? []).slice(0, heritageLoreN)) {
      const subj = raw?.trim().toLowerCase().replace(/\s*lore$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (subj) skills[`lore:${subj}` as ProficiencyKey] = 'trained';
    }
  }
  if (build.heritageSkill) (skills[build.heritageSkill] = 'trained'), locked.add(build.heritageSkill);
  // Skilled Heritage (human): the chosen skill becomes expert at 5th level.
  if (build.heritageSkill && build.heritageId === 'skilled-human' && level >= 5) {
    skills[build.heritageSkill] = maxRank(skills[build.heritageSkill], 'expert');
  }
  // Subclass-/choice-granted skills (druid order, rogue racket, witch patron, eidolon) — also free.
  for (const o of grantOptions) {
    for (const sk of o.grants?.skills ?? []) (skills[sk] = 'trained'), locked.add(sk);
    // Named Lores (animist apparitions grant two apiece). A Lore is not a SkillId, so these could
    // not ride in `grants.skills` and every apparition's "Apparition Skills" Lore line was inert.
    for (const subj of o.grants?.lores ?? []) {
      const key = loreKey(subj);
      (skills[key] = maxRank(skills[key] ?? 'untrained', 'trained')), locked.add(key);
    }
    // A restricted skill choice (Pistolero way, Empiricism methodology): train the picked skill,
    // defaulting to the first allowed option so the build is always legal.
    if (o.skillChoice?.length) {
      const pick =
        build.subclassSkill && o.skillChoice.includes(build.subclassSkill) ? build.subclassSkill : o.skillChoice[0];
      skills[pick] = 'trained';
      locked.add(pick);
    }
  }
  // Sorcerer Draconic: the chosen dragon trains a second bloodline skill (Arcana/Religion/Occultism/Nature).
  if (dragon?.skill) (skills[dragon.skill] = 'trained'), locked.add(dragon.skill);
  // "Your deity grants you the trained proficiency rank in one skill and with the deity's favored
  // weapon." Only the CLERIC's Deity feature says that — the champion's Deity and Cause does not —
  // so this stays scoped to the cleric even though several classes pick a deity. The weapon half was
  // already granted below; `Deity.skill` was read only by Helm of Zeal and never trained anything.
  const clericDeitySkill =
    build.classId === 'cleric' || build.classId2 === 'cleric'
      ? (build.deityId ? content.deities[build.deityId]?.skill : undefined)
      : undefined;
  if (clericDeitySkill && (SKILLS as readonly string[]).includes(clericDeitySkill)) {
    const k = clericDeitySkill as SkillId;
    (skills[k] = maxRank(skills[k] ?? 'untrained', 'trained')), locked.add(k);
  }
  // Clamp the class's free skill picks to the legal count (base + level-1 Int),
  // skipping any that duplicate a granted training, so the built character is
  // always legal even if state was reached via a since-lowered Int.
  const maxClassSkills = additionalClassSkills(build, content);
  let added = 0;
  for (const sk of build.classSkills) {
    if (locked.has(sk)) continue;
    if (added >= maxClassSkills) break;
    skills[sk] = 'trained';
    added++;
  }

  // Skill increases, applied in ascending level order so multiple increases to
  // the same skill stack correctly and each is capped by its own level.
  const siLevels = cls?.skillIncreaseLevels ?? SKILL_INCREASE_LEVELS;
  const skillIncreases: SkillIncrease[] = [];
  for (let lvl = 1; lvl <= level; lvl++) {
    if (!siLevels.includes(lvl)) continue;
    const key = build.skillIncreases[lvl];
    if (!key) continue;
    skills[key] = stepRank(skills[key] ?? 'untrained', skillIncreaseCap(lvl));
    skillIncreases.push({ level: lvl, skill: key });
  }

  // Clone the class's rank objects — advancement mutates these, and they must not
  // alias the shared ContentDatabase.
  const proficiencies: Proficiencies = {
    perception: cls?.perception ?? 'untrained',
    saves: { ...(cls?.saves ?? { fortitude: 'untrained', reflex: 'untrained', will: 'untrained' }) },
    skills,
    attacks: { ...(cls?.attacks ?? { unarmed: 'untrained', simple: 'untrained', martial: 'untrained', advanced: 'untrained' }) },
    defenses: { ...(cls?.defenses ?? { unarmored: 'untrained', light: 'untrained', medium: 'untrained', heavy: 'untrained' }) },
    classDc: cls?.classDc ?? 'untrained',
    ...(cls?.attackGroups ? { weaponGroups: { ...cls.attackGroups } } : {}),
  };

  // Dual Class: take the BETTER initial proficiency rank from the second class on every track.
  if (cls2) {
    proficiencies.perception = maxRank(proficiencies.perception, cls2.perception);
    proficiencies.classDc = maxRank(proficiencies.classDc, cls2.classDc);
    for (const s of SAVE_TRACKS as SaveId[]) proficiencies.saves[s] = maxRank(proficiencies.saves[s], cls2.saves[s]);
    for (const w of WEAPON_TRACKS as WeaponCategory[]) proficiencies.attacks[w] = maxRank(proficiencies.attacks[w], cls2.attacks[w]);
    for (const a of ARMOR_TRACKS as ArmorCategory[]) proficiencies.defenses[a] = maxRank(proficiencies.defenses[a], cls2.defenses[a]);
    if (cls2.attackGroups) for (const [g, r] of Object.entries(cls2.attackGroups)) (proficiencies.weaponGroups ??= {})[g] = maxRank(proficiencies.weaponGroups?.[g], r);
  }

  // Gunslinger "firearms & crossbows" proficiency by CATEGORY. Foundry gives the gunslinger three separate
  // MartialProficiency tracks (simple/martial/advanced firearms-crossbows) that advance independently of the
  // generic weapon categories (which stay trained): simple & martial f&c = expert@1 → master@5 (Gunslinger
  // Weapon Mastery) → legendary@13 (Gunslinging Legend); advanced f&c = trained@1 → expert@5 → master@13.
  // A single firearm weapon-GROUP rank can't express "simple firearms master but advanced firearms trained",
  // so use firearmProf and drop the coarse firearm/crossbow group ranks for a gunslinger.
  if (build.classId === 'gunslinger' || (build.variantRules?.dualClass && build.classId2 === 'gunslinger')) {
    proficiencies.firearmProf = {
      simple: level >= 13 ? 'legendary' : level >= 5 ? 'master' : 'expert',
      martial: level >= 13 ? 'legendary' : level >= 5 ? 'master' : 'expert',
      advanced: level >= 13 ? 'master' : level >= 5 ? 'expert' : 'trained',
    };
    if (proficiencies.weaponGroups) {
      delete proficiencies.weaponGroups.firearm;
      delete proficiencies.weaponGroups.crossbow;
    }
  }

  // Wizard Weapon Expertise (L11): expert in the five wizard weapons only (club/crossbow/dagger/
  // heavy-crossbow/staff) — a per-weapon override, NOT a whole-category bump (which would over-grant).
  if ((build.classId === 'wizard' || (build.variantRules?.dualClass && build.classId2 === 'wizard')) && level >= 11) {
    proficiencies.weaponOverrides = { ...(proficiencies.weaponOverrides ?? {}) };
    for (const w of ['club', 'crossbow', 'dagger', 'heavy-crossbow', 'staff']) {
      if (content.items[w]) proficiencies.weaponOverrides[w] = maxRank(proficiencies.weaponOverrides[w], 'expert');
    }
  }

  // Subclass weapon/armor keystones (ruffian medium armor, warrior-muse martial).
  for (const o of grantOptions) {
    for (const w of o.grants?.weapons ?? []) proficiencies.attacks[w] = maxRank(proficiencies.attacks[w], 'trained');
    for (const a of o.grants?.armor ?? []) proficiencies.defenses[a] = maxRank(proficiencies.defenses[a], 'trained');
  }

  // A deity-using class (cleric) is trained in its deity's favored weapon — recorded
  // as a per-weapon override that deriveStrike honors (and advancement can exceed).
  const deity = build.deityId ? content.deities[build.deityId] : undefined;
  const usesDeity = buildNeedsDeity(build, content);
  if (usesDeity && deity?.favoredWeapons?.length) {
    // Only real weapon items get an override; "fist"/unarmed favored weapons (e.g. Irori)
    // are already covered by the class's unarmed proficiency.
    // The doctrine advances the favored weapon's proficiency (independent of its weapon category):
    // Cloistered → expert@11; Warpriest → expert@7, master@19; Battle Creed → expert@5, master@13.
    // deriveStrike already takes max(category rank, this override), so a martial favored weapon that the
    // category never raises still reaches the doctrine rank.
    const doctrine = build.classId === 'cleric' ? build.subclassId : build.classId2 === 'cleric' ? build.subclassId2 : null;
    const favoredRank: ProficiencyRank =
      doctrine === 'warpriest'
        ? level >= 19 ? 'master' : level >= 7 ? 'expert' : 'trained'
        : doctrine === 'battle-creed'
          ? level >= 13 ? 'master' : level >= 5 ? 'expert' : 'trained'
          : level >= 11 ? 'expert' : 'trained'; // cloistered-cleric (default)
    // MERGE (don't replace): a character can have both a deity favored weapon and an ancestry
    // weapon-familiarity feat, and each must keep its own override.
    const overrides: Record<string, ProficiencyRank> = { ...(proficiencies.weaponOverrides ?? {}) };
    for (const w of deity.favoredWeapons) if (content.items[w]) overrides[w] = maxRank(overrides[w] ?? 'untrained', favoredRank);
    if (Object.keys(overrides).length) proficiencies.weaponOverrides = overrides;
  }

  // Dual Class: HP uses the HIGHER per-level Hit Points of the two classes (not the sum).
  const hpPerLevel = Math.max(cls?.hpPerLevel ?? 0, cls2?.hpPerLevel ?? 0);
  const hpMax = (ancestry?.hp ?? 0) + (hpPerLevel + abilityMod(abilities.con)) * level;

  // Resolve feats' embedded sub-choices (Domain Initiate domain, Additional Lore, …).
  // A domains choice grants that domain's focus spell; the resolved label is recorded
  // on the FeatChoice for display.
  const featChoiceById: Record<string, { value: string; label: string }> = {};
  const grantedChoiceById: Record<string, { value: string; label: string }> = {};
  const featFocusSpells: string[] = [];
  /** Which feat/feature granted each focus spell — the focus entry pools many sources, so the Spells
   *  page labels each spell with its origin. */
  const focusSource: Record<string, string> = {};
  let featPoolBonus = 0;
  // Advanced/Greater Bloodline (sorcerer) and Advanced/Greater Revelation (oracle) grant a focus spell
  // that depends on the chosen subclass, so the feat itself can't name it — resolved from the picked
  // bloodline/mystery. The pool point is counted via the spell (avoids double count).
  // The WIZARD's Advanced School Spell was missing here, so all 13 schools carried an
  // `advancedFocusSpell` the feat could not reach: the pool point arrived and the spell did not.
  const ADV_SPELL: Record<string, string | undefined> = {
    'advanced-bloodline': subOption?.advancedFocusSpell,
    'greater-bloodline': subOption?.greaterFocusSpell,
    'advanced-revelation': subOption?.advancedFocusSpell,
    'greater-revelation': subOption?.greaterFocusSpell,
    'advanced-school-spell': subOption?.advancedFocusSpell,
    'greater-school-spell': subOption?.greaterFocusSpell,
  };
  /** One feat's focus contribution. The domain sub-choice (Domain Initiate) grants that domain's spell,
   *  AND the feat's own fixed focusSpells / focusPoolBonus still apply — a feat with BOTH a sub-choice
   *  and a fixed grant contributes both (the old code skipped the fixed grant whenever a choice def
   *  existed, silently dropping e.g. a choice feat's focusPoolBonus). Returns the resolved choice. */
  const applyFeatFocus = (featId: string, choiceValue: string | undefined) => {
    const feat = content.feats[featId];
    if (!feat) return undefined;
    let resolved: { value: string; label: string } | undefined;
    let contributedSpell = false;
    const def = feat.choice;
    if (def && choiceValue) {
      const raw = def.options?.find((o) => o.value === choiceValue)?.label ?? choiceValue;
      resolved = { value: choiceValue, label: def.kind === 'domains' ? cap(choiceValue) : featChoiceLabel(raw) };
      if (def.kind === 'domains' && DOMAIN_SPELLS[choiceValue] && content.spells[DOMAIN_SPELLS[choiceValue]]) {
        featFocusSpells.push(DOMAIN_SPELLS[choiceValue]);
        focusSource[DOMAIN_SPELLS[choiceValue]] ??= feat.name;
        contributedSpell = true;
      }
    }
    const advSpell = ADV_SPELL[featId];
    const ffs = (feat.focusSpells ?? []).filter((id) => content.spells[id]);
    if (advSpell && content.spells[advSpell]) {
      featFocusSpells.push(advSpell);
      focusSource[advSpell] ??= feat.name;
      contributedSpell = true;
    } else if (ffs.length) {
      featFocusSpells.push(...ffs);
      for (const id of ffs) focusSource[id] ??= feat.name;
      contributedSpell = true;
    }
    // Each granted spell carries its own pool point, so focusPoolBonus only applies to POOL-ONLY
    // feats. A domains-choice feat's focusPoolBonus represents the choice spell's point — with the
    // choice unresolved there is no spell, so no pool either.
    //
    // A feat can ALSO deliver its focus spell through an effectChoices option (Shadow Magic does).
    // That path is handled by the separate effectChoices pass below, which pushes the chosen spell
    // into featFocusSpells — but it never set `contributedSpell`, so the bonus was added here as
    // well and a Shadowdancer shipped with a 2-point pool for ONE focus spell. Treat "this feat can
    // grant a focus spell via a choice" the same way as the domains case: the point belongs to the
    // spell, not the feat. (Its sibling Additional Shadow Magic models this correctly with a grant
    // and no bonus, which is what made the discrepancy provable.)
    const grantsFocusViaEffectChoice = (feat.effectChoices ?? []).some((ec) =>
      (ec.options ?? []).some((o) => (o.grant?.focusSpells?.length ?? 0) > 0),
    );
    if (!contributedSpell && !grantsFocusViaEffectChoice && def?.kind !== 'domains' && feat.focusPoolBonus) {
      featPoolBonus += feat.focusPoolBonus;
    }
    return resolved;
  };
  const focusSeen = new Set<string>();
  for (const [slotKey, featId] of Object.entries(build.featPicks)) {
    const lvl = Number(slotKey.split(':')[0]);
    if (!featId || !Number.isFinite(lvl) || lvl > level) continue;
    if (!content.feats[featId]) continue;
    focusSeen.add(featId);
    // A multi-pick choice ("choose two different terrains") stores one answer per index; resolve each
    // and show them joined, so the feat row reads "Terrain Scout (Forest, Swamp)" rather than naming
    // only the first. applyFeatFocus runs on the FIRST answer, which is the one that can carry a
    // focus-spell grant — no multi-pick choice in the data grants a spell per pick.
    const keys = choiceKeys(slotKey, content.feats[featId]?.choice);
    const values = keys.map((k) => build.featChoices?.[k]).filter(Boolean) as string[];
    const resolved = applyFeatFocus(featId, values[0]);
    if (resolved) {
      const def = content.feats[featId]?.choice;
      const labels = values.map(
        (v) => (def?.options?.find((o) => o.value === v)?.label ?? featChoiceLabel(v)),
      );
      featChoiceById[slotKey] = labels.length > 1 ? { value: values.join(','), label: labels.join(', ') } : resolved;
    }
    // A choice that hands over a CLASS FEATURE carrying focus spells — the witch's 19 lessons, each
    // of which grants a hex. Focus spells from a class feature are otherwise gathered from
    // klass.features alone, and a lesson is in no class's feature list, so the lesson was picked,
    // shown in the builder, and its hex never reached the focus pool.
    if (content.feats[featId]?.choice?.ownsFeature) {
      for (const id of choiceOwnedFeatureIds([{ featId, choice: { value: values[0] } }], content)) {
        for (const sid of content.classFeatures[id]?.focusSpells ?? []) {
          if (!content.spells[sid] || featFocusSpells.includes(sid)) continue;
          featFocusSpells.push(sid);
          focusSource[sid] ??= content.classFeatures[id]?.name ?? id;
        }
      }
    }
  }
  // A CLASS FEATURE can grant a pool point too. Only `feat.focusPoolBonus` was ever read, so
  // Clarity of Focus — the psychic's 5th-level feature, and the field's only carrier — did nothing:
  // every psychic from 5th on was one Focus Point short of what the rules give them.
  for (const cid of [build.classId, build.classId2]) {
    if (!cid) continue;
    const sub = cid === build.classId ? build.subclassId : build.subclassId2;
    for (const fid of classFeatureIdsOwned({ classId: cid, subclassId: sub, level }, content)) {
      featPoolBonus += content.classFeatures[fid]?.focusPoolBonus ?? 0;
    }
  }
  // BONUS/GRANTED feats contribute focus too — background/heritage/UMT feats, override-added feats,
  // pick-a-feat picks, dedication skill feats, and the FEAT_FEAT_GRANTS closure over everything (Seeker
  // of Truths → Domain Initiate). Slotless feats' sub-choices live in build.grantedFeatChoices (picked
  // under the granting feat in the builder).
  const focusBonusIds: string[] = [];
  const pushFocusBonus = (id?: string | null) => {
    if (id && content.feats[id] && !focusSeen.has(id)) {
      focusSeen.add(id);
      focusBonusIds.push(id);
    }
  };
  for (const id of backgroundGrantedFeats(resolveBackground(build, content), build.backgroundSkillChoice)) pushFocusBonus(id);
  pushFocusBonus(build.heritageFeatId);
  pushFocusBonus(build.umtFeatId);
  for (const f of build.overrides?.addedFeats ?? []) if ((f.level ?? 1) <= level) pushFocusBonus(f.featId);
  for (const id of Object.values(build.pickFeatChoices ?? {})) pushFocusBonus(id);
  for (const id of Object.values(build.dedicationSkillFeats ?? {})) pushFocusBonus(id);
  // Feats granted by a HERITAGE, a CLASS FEATURE or a chosen SUBCLASS / extra-choice option. These
  // three lanes push the feat with `choice: grantedChoiceById[gid]` — but nothing ever resolved the
  // answer for them, because only the six sources above fed this list. A cloistered cleric is
  // granted Domain Initiate by their doctrine, and their domain pick was read by nothing: no choice
  // on the feat, and no focus spell in the pool.
  for (const hid of [build.heritageId, secondHeritageId]) {
    for (const id of (hid ? content.heritages[hid]?.grantsFeats : undefined) ?? []) pushFocusBonus(id);
  }
  for (const cid of [build.classId, build.classId2]) {
    if (!cid) continue;
    const sub = cid === build.classId ? build.subclassId : build.subclassId2;
    for (const fid of classFeatureIdsOwned({ classId: cid, subclassId: sub, level }, content)) {
      for (const id of content.classFeatures[fid]?.grantsFeats ?? []) pushFocusBonus(id);
    }
    const opt = content.classes[cid]?.subclass?.options.find((o) => o.id === sub);
    for (const id of opt?.grantedFeats ?? []) pushFocusBonus(id);
  }
  for (const [gid, picks] of Object.entries(build.extraChoices ?? {})) {
    void gid;
    for (const oid of picks) for (const id of content.classFeatures[oid]?.grantsFeats ?? []) pushFocusBonus(id);
  }
  {
    const queue = [...focusSeen];
    let guard = 0;
    while (queue.length && guard++ < 500) {
      const src = queue.shift() as string;
      const grantIds = [
        ...(FEAT_FEAT_GRANTS[src] ?? []),
        ...(FEAT_FEAT_GRANTS_LEVELED[src] ?? []).filter((lg) => level >= lg.minLevel).map((lg) => lg.feat),
      ];
      for (const gid of grantIds) {
        if (focusSeen.has(gid)) continue;
        pushFocusBonus(gid);
        queue.push(gid);
      }
    }
  }
  for (const id of focusBonusIds) {
    const resolved = applyFeatFocus(id, build.grantedFeatChoices?.[id]);
    if (resolved) grantedChoiceById[id] = resolved;
  }
  // "Choose one of N FOCUS spells" effect-choices (Additional Shadow Magic, Greater Deathly Secrets).
  // Resolved HERE (not in the later effect-choice pass) so the pick feeds the same focus pool/entry as
  // a fixed focusSpells grant — the later pass deliberately skips focus keys to avoid double-counting.
  {
    const focusChoiceIds = new Set<string>(focusSeen);
    if (build.heritageId) focusChoiceIds.add(build.heritageId);
    for (const f of cls?.features ?? []) if (f.level <= level) focusChoiceIds.add(f.featureId);
    for (const f of cls2?.features ?? []) if (f.level <= level) focusChoiceIds.add(f.featureId);
    // A chosen subclass / extra-choice option carries picks of its own (the wizard's Runelord school
    // grants the chosen sin's initial school spell); its record ships under the same slug.
    for (const o of grantOptions) focusChoiceIds.add(o.id);
    for (const rid of focusChoiceIds) {
      const rec = content.feats[rid] ?? content.heritages[rid] ?? content.classFeatures[rid];
      for (const ch of rec?.effectChoices ?? []) {
        const opt = (ch.options ?? []).find((o) => o.value === build.effectChoices?.[`${rid}:${ch.id}`]);
        if (!opt?.grant) continue; // a play-time-only option grants nothing mechanical
        const ffs = (opt.grant.focusSpells ?? []).filter((sid) => content.spells[sid]);
        if (ffs.length) {
          featFocusSpells.push(...ffs);
          for (const sid of ffs) focusSource[sid] ??= rec?.name ?? rid;
        } else if (opt.grant.focusPoolBonus) featPoolBonus += opt.grant.focusPoolBonus;
      }
    }
  }

  const spellcasting: SpellcastingEntry[] = [];
  let focus: FocusPool | undefined;
  if (cls?.spellcasting) {
    const sp = cls.spellcasting;
    // A subclass/choice can set the tradition (witch patron, sorcerer bloodline,
    // summoner eidolon) or key ability (psychic subconscious mind); else the class's.
    // The Draconic bloodline's tradition comes from the chosen dragon exemplar.
    const tradition = dragon?.tradition ?? grantOptions.find((o) => o.tradition)?.tradition ?? sp.tradition;
    // A subclass can override the slot progression (cleric Battle Creed uses the reduced two-rank table).
    const progression = subOption?.slotProgression ?? sp.progression;
    const slotCounts = casterSlots(level, progression); // rank -> number of slots
    // Wizard School of Unified Magical Theory (Player Core): "No Curriculum" — it grants NO curriculum
    // spell slot and NO extra school cantrip (unlike every other arcane school). Instead it gives a bonus
    // L1 wizard class feat + one extra spellbook spell (feat/spellbook grants handled elsewhere). Gate the
    // school slot and the 6th cantrip off for it.
    const isUmt = subOption?.id === 'school-of-unified-magical-theory';
    // Spells the subclass grants to this pool's repertoire (psychic conscious mind
    // ladder), by rank. Apparition grants feed a separate pool (added below), not this.
    const grantedByRank: Record<number, string[]> = {};
    for (const id of subOption?.grantedSpells ?? [])
      (grantedByRank[content.spells[id]?.rank ?? 1] ??= []).push(id);
    const entry: SpellcastingEntry = {
      id: `${cls.id}-casting`,
      name: `${cap(tradition)} ${sp.type} spellcasting`,
      type: sp.type,
      tradition,
      keyAbility: choiceKeyAbility ?? sp.keyAbility,
      proficiency: 'trained',
      // Dedup so a subclass-granted cantrip (psychic conscious mind) doesn't duplicate a
      // player-picked one.
      cantrips: [...new Set([...build.cantrips.slice(0, cantripsKnown(cls.id) - (isUmt ? 1 : 0) + cantripBonus), ...(grantedByRank[0] ?? [])])],
    };
    if (sp.repertoire) {
      // Spontaneous: a repertoire of known spells per rank + a slot pool.
      entry.repertoire = {};
      entry.slots = {};
      for (const [rankStr, count] of Object.entries(slotCounts)) {
        const rank = Number(rankStr);
        entry.slots[rank] = { max: count, used: 0 };
        // Player-chosen repertoire (sliced to slot count) plus any granted spells
        // of this rank (the psychic conscious mind expands the repertoire).
        entry.repertoire[rank] = [
          ...new Set([...(build.spells[rank] ?? []).slice(0, count), ...(grantedByRank[rank] ?? [])]),
        ];
        if (grantedByRank[rank]?.length) (entry.grantedRepertoire ??= {})[rank] = [...grantedByRank[rank]];
      }
      // Signature spells (one per rank) — only once the class grants the feature
      // (e.g. bard at level 3); each must be a spell actually in the repertoire.
      const sigAvailable = (cls.features ?? []).some((f) => f.featureId === 'signature-spells' && f.level <= level);
      if (sigAvailable) {
        const sig = Object.keys(build.signatures)
          .flatMap((rankStr) => signaturesAt(build.signatures, Number(rankStr))
            .filter((id) => entry.repertoire?.[Number(rankStr)]?.includes(id)));
        if (sig.length) entry.signature = sig;
      }
      // Summoner's Unlimited Signature Spells (level 3): every spell in the repertoire is a signature
      // spell, so the summoner can heighten any known spell to any slot rank it can cast.
      const unlimitedSig = (cls.features ?? []).some(
        (f) => f.featureId === 'unlimited-signature-spells' && f.level <= level,
      );
      if (unlimitedSig) entry.signature = [...new Set(Object.values(entry.repertoire).flat())];
    } else if (cls.id === 'wizard' || cls.id === 'witch') {
      // LEARNED prepared casters — build.spells is a SPELLBOOK of known spells (the wizard's
      // physical spellbook; the witch's familiar, "the source and repository of the spells your
      // patron has bestowed"). They can prepare only spells they've learned, so the daily
      // preparation is auto-filled from the spellbook (the player can re-prepare in play).
      // The wizard's Arcane School grants ONE extra prepared slot of each rank you can cast (the
      // curriculum slot), so a wizard prepares one more per rank than the base full-caster table;
      // that extra cantrip is already counted by cantripsKnown('wizard'). UMT has no curriculum, so
      // it grants no extra curriculum slot even though it IS an arcane school. The witch has no
      // curriculum slot at all.
      const hasSchool =
        cls.id === 'wizard' &&
        !isUmt &&
        ((cls.features ?? []).some((f) => f.featureId === 'arcane-school' || f.featureId === 'arcane-thesis') || !!subOption);
      entry.spellbook = {};
      entry.prepared = {};
      for (const [rankStr, count] of Object.entries(slotCounts)) {
        const rank = Number(rankStr);
        const learned = build.spells[rank] ?? [];
        entry.spellbook[rank] = [...learned];
        const total = count + (hasSchool ? 1 : 0); // +1 curriculum slot per castable rank (wizard only)
        entry.prepared[rank] = Array.from({ length: total }, (_, i) => ({ spellId: learned[i] ?? null, expended: false }));
      }
    } else {
      // Cleric/druid: prepare from the whole tradition list each day.
      entry.prepared = {};
      for (const [rankStr, count] of Object.entries(slotCounts)) {
        const rank = Number(rankStr);
        const chosen = build.spells[rank] ?? [];
        entry.prepared[rank] = Array.from({ length: count }, (_, i) => ({
          spellId: chosen[i] ?? null,
          expended: false,
        }));
      }
    }
    // Magus Studious Spells: bonus prepared slots at the tier rank, auto-prepared
    // from the curated utility list (these are restricted, so not player-chosen).
    const studious = cls.id === 'magus' ? magusStudiousSpells(level) : null;
    if (studious && entry.prepared) {
      entry.prepared[studious.rank] = [
        ...(entry.prepared[studious.rank] ?? []),
        ...studious.spells.map((id) => ({ spellId: content.spells[id] ? id : null, expended: false })),
      ];
    }
    spellcasting.push(entry);

    // Animist: a second, spontaneous "apparition" pool whose repertoire is the spell
    // ladders of the attuned apparitions (extra-choice picks). Distinct slots (the
    // AoN table's Y column); all apparition spells are signature. The prepared pool
    // above is the X column. (Can't cross-cast between the two pools.)
    if (cls.id === 'animist') {
      const appCantrips: string[] = [];
      const byRank: Record<number, string[]> = {};
      for (const o of extraOptions)
        for (const id of o.grantedSpells ?? []) {
          const r = content.spells[id]?.rank ?? 1;
          if (r === 0) appCantrips.push(id);
          else (byRank[r] ??= []).push(id);
        }
      const appSlots = apparitionSlots(level);
      const repertoire: Record<number, string[]> = {};
      const slots: Record<number, { max: number; used: number }> = {};
      for (const rankStr of Object.keys(appSlots)) {
        const r = Number(rankStr);
        slots[r] = { max: appSlots[r], used: 0 };
        repertoire[r] = [...new Set(byRank[r] ?? [])];
      }
      spellcasting.push({
        id: 'animist-apparition-casting',
        name: 'Apparition spellcasting',
        type: 'spontaneous',
        tradition: 'divine',
        keyAbility: choiceKeyAbility ?? sp.keyAbility,
        proficiency: entry.proficiency,
        cantrips: [...new Set(appCantrips)],
        repertoire,
        slots,
        signature: [...new Set(Object.values(repertoire).flat())],
      });
    }

    // Divine Font (Player Core, cleric): 4 additional heal/harm slots at your HIGHEST rank of cleric
    // spell slots, increasing to 5 at 5th level and 6 at 15th (NOT Cha-based). The font rank must be
    // the highest NORMAL spell rank — the 10th-rank slot at L19+ is the Miraculous Spell capstone, not
    // a "highest rank of cleric spell slots" the font can fill, so ranks 10+ are excluded here.
    // Battle Creed replaces the font with a BATTLE FONT: same 4/5/6 count of Bane-or-Bless slots, cast
    // with the class DC (not the spell DC).
    const fontSlots = level >= 15 ? 6 : level >= 5 ? 5 : 4;
    const hasFont = (cls.features ?? []).some((f) => f.featureId === 'divine-font');
    const ranks = Object.keys(entry.prepared ?? {}).map(Number).filter((r) => r <= 9);
    const topRank = ranks.length ? Math.max(...ranks) : 1;
    if (subOption?.id === 'battle-creed') {
      entry.font = {
        type: 'battle',
        slots: fontSlots,
        rank: topRank,
        useClassDc: true,
        allowed: ['bane', 'bless'],
      };
    } else {
      const deityFont = build.deityId ? content.deities[build.deityId]?.divineFont : undefined;
      if (hasFont && build.divineFont && (!deityFont?.length || deityFont.includes(build.divineFont))) {
        entry.font = {
          type: build.divineFont,
          slots: fontSlots,
          rank: topRank,
        };
      }
    }
  }

  // Dual Class: a SECOND spellcasting class contributes its own entry — correct slots, tradition,
  // key attribute, and (advancing) proficiency, so the character can cast from it. Its actual spell
  // list is chosen on the character sheet via the in-play spell manager (the builder's spell picker
  // configures only the primary class). The per-class casting TAILS (divine font, magus studious,
  // wizard curriculum, animist apparition pool) are applied here too.
  if (cls2?.spellcasting && build.classId2) {
    const sp2 = cls2.spellcasting;
    const tradition2 = subOption2?.tradition ?? sp2.tradition;
    const slotCounts2 = casterSlots(level, subOption2?.slotProgression ?? sp2.progression);
    // The second class's chosen spells live on BuildState.{cantrips2,spells2,signatures2} — mirroring
    // the primary surface — so a builder edit rebuilds the second entry with its spells INTACT.
    const cantrips2 = build.cantrips2 ?? [];
    const spells2 = build.spells2 ?? {};
    const entry2: SpellcastingEntry = {
      id: `${cls2.id}-casting`,
      name: `${cap(tradition2)} ${sp2.type} spellcasting`,
      type: sp2.type,
      tradition: tradition2,
      keyAbility: sp2.keyAbility,
      proficiency: 'trained',
      cantrips: [...new Set([...cantrips2.slice(0, cantripsKnown(cls2.id) + cantripBonus)])],
    };
    const hasSchool2 = cls2.id === 'wizard'; // wizard curriculum: +1 prepared slot per castable rank
    if (sp2.repertoire) {
      entry2.repertoire = {};
      entry2.slots = {};
      for (const [rankStr, count] of Object.entries(slotCounts2)) {
        const rank = Number(rankStr);
        entry2.slots[rank] = { max: count, used: 0 };
        entry2.repertoire[rank] = [...new Set((spells2[rank] ?? []).slice(0, count))];
      }
      // Signature spells (spontaneous, once granted) — each must be in the repertoire.
      const sig2Available = (cls2.features ?? []).some((f) => f.featureId === 'signature-spells' && f.level <= level);
      if (sig2Available) {
        const sig2 = Object.keys(build.signatures2 ?? {})
          .flatMap((rankStr) => signaturesAt(build.signatures2, Number(rankStr))
            .filter((id) => entry2.repertoire?.[Number(rankStr)]?.includes(id)));
        if (sig2.length) entry2.signature = sig2;
      }
    } else if (cls2.id === 'wizard') {
      // Wizard second class: spells2 is the spellbook; auto-prepare from it (+1 curriculum slot/rank).
      entry2.spellbook = {};
      entry2.prepared = {};
      for (const [rankStr, count] of Object.entries(slotCounts2)) {
        const rank = Number(rankStr);
        const learned = spells2[rank] ?? [];
        entry2.spellbook[rank] = [...learned];
        entry2.prepared[rank] = Array.from({ length: count + 1 }, (_, i) => ({ spellId: learned[i] ?? null, expended: false }));
      }
    } else {
      entry2.prepared = {};
      for (const [rankStr, count] of Object.entries(slotCounts2)) {
        const rank = Number(rankStr);
        const chosen = spells2[rank] ?? [];
        entry2.prepared[rank] = Array.from({ length: count + (hasSchool2 ? 1 : 0) }, (_, i) => ({ spellId: chosen[i] ?? null, expended: false }));
      }
    }
    // Magus Studious Spells: bonus auto-prepared slots at the tier rank (curated, not player-chosen).
    if (cls2.id === 'magus' && entry2.prepared) {
      const studious2 = magusStudiousSpells(level);
      if (studious2) entry2.prepared[studious2.rank] = [...(entry2.prepared[studious2.rank] ?? []), ...studious2.spells.map((id) => ({ spellId: content.spells[id] ? id : null, expended: false }))];
    }
    // Cleric divine font (or Battle Creed's battle font) on the second class — 4/5/6 slots at the
    // highest NORMAL rank (rank 10 is the Miraculous Spell capstone, excluded), matching the primary.
    if (entry2.prepared) {
      const fontSlots2 = level >= 15 ? 6 : level >= 5 ? 5 : 4;
      const ranks2 = Object.keys(entry2.prepared).map(Number).filter((r) => r <= 9);
      const top2 = ranks2.length ? Math.max(...ranks2) : 1;
      if (subOption2?.id === 'battle-creed') {
        entry2.font = { type: 'battle', slots: fontSlots2, rank: top2, useClassDc: true, allowed: ['bane', 'bless'] };
      } else if ((cls2.features ?? []).some((f) => f.featureId === 'divine-font') && build.divineFont) {
        const deityFont2 = build.deityId ? content.deities[build.deityId]?.divineFont : undefined;
        if (!deityFont2?.length || deityFont2.includes(build.divineFont)) entry2.font = { type: build.divineFont, slots: fontSlots2, rank: top2 };
      }
    }
    spellcasting.push(entry2);

    // Animist (as the second class): a separate spontaneous apparition pool from the attuned apparitions.
    if (cls2.id === 'animist') {
      const appCantrips: string[] = [];
      const byRank: Record<number, string[]> = {};
      for (const o of extraOptions)
        for (const id of o.grantedSpells ?? []) {
          const r = content.spells[id]?.rank ?? 1;
          if (r === 0) appCantrips.push(id);
          else (byRank[r] ??= []).push(id);
        }
      const appSlots = apparitionSlots(level);
      const repertoire: Record<number, string[]> = {};
      const slots: Record<number, { max: number; used: number }> = {};
      for (const rankStr of Object.keys(appSlots)) {
        const r = Number(rankStr);
        slots[r] = { max: appSlots[r], used: 0 };
        repertoire[r] = [...new Set(byRank[r] ?? [])];
      }
      spellcasting.push({
        id: 'animist-apparition-casting',
        name: 'Apparition spellcasting',
        type: 'spontaneous',
        tradition: 'divine',
        keyAbility: sp2.keyAbility,
        proficiency: 'trained',
        cantrips: [...new Set(appCantrips)],
        repertoire,
        slots,
        signature: [...new Set(Object.values(repertoire).flat())],
      });
    }
  }

  // Focus spells granted by the class (bard compositions) + subclass (order/school spell,
  // witch hex, champion devotion, ranger warden) + domain-initiate feats. This runs for
  // EVERY class, not just slot casters, so focus-only classes (champion/monk/ranger) get a
  // focus pool and their focus spell on the sheet. Auto-heightened in play; grouped by rank.
  // Champion Devotion can come from EITHER class (the one that's a champion).
  const devotionSpell = championDevotionSpell(cls, build, content) ?? (cls2 ? championDevotionSpell(cls2, build, content) : undefined);
  // Animist: only the PRIMARY apparition grants its vessel spell as a focus spell (the others feed
  // the apparition repertoire, not the focus pool). Default the primary to the first attuned.
  const apparitionIds = new Set(build.extraChoices?.['apparition'] ?? []);
  const primaryApparition =
    ownsClass('animist')
      ? build.primaryApparition && apparitionIds.has(build.primaryApparition)
        ? build.primaryApparition
        : [...apparitionIds][0]
      : undefined;
  const focusSpells = [
    ...(cls?.focusSpells ?? []),
    ...(cls2?.focusSpells ?? []),
    ...grantOptions.flatMap((o) =>
      ownsClass('animist') && apparitionIds.has(o.id) && o.id !== primaryApparition ? [] : o.focusSpells ?? [],
    ),
    ...featFocusSpells,
    ...(devotionSpell ? [devotionSpell] : []),
    // Focus spells granted by a CLASS FEATURE the character has reached. This source was missing, so
    // Hero's Defiance — a 19th-level champion feature whose whole content is "you gain the Hero's
    // Defiance devotion spell" — did nothing even at 20th. Features are already level-gated, and a
    // subclass that suppresses one must not still hand out its spell.
    ...[[cls, build.subclassId], [cls2, build.subclassId2]].flatMap(([c, subId]) => {
      const klass = c as typeof cls;
      if (!klass) return [];
      const dropped = new Set(klass.subclass?.options.find((o) => o.id === subId)?.suppressedFeatures ?? []);
      return (klass.features ?? [])
        .filter((f) => f.level <= level && !dropped.has(f.featureId))
        .flatMap((f) => content.classFeatures[f.featureId]?.focusSpells ?? []);
    }),
  ];
  // The class that actually supplies the focus pool's tradition/key — the primary if it casts/has a
  // focus profile, otherwise the second class (e.g. fighter + animist → the animist's divine/Wis).
  const focusCls = cls?.spellcasting || (cls && FOCUS_CASTING[cls.id]) || cls?.focusSpells?.length ? cls : cls2 ?? cls;
  if (cls && focusSpells.length) {
    const focusTradition =
      grantOptions.find((o) => o.tradition)?.tradition ?? focusCls?.spellcasting?.tradition ?? (focusCls && FOCUS_CASTING[focusCls.id]?.tradition) ?? 'occult';
    const focusKey = choiceKeyAbility ?? focusCls?.spellcasting?.keyAbility ?? (focusCls && FOCUS_CASTING[focusCls.id]?.key) ?? focusCls?.keyAbility[0] ?? 'cha';
    const byRankOf = (ids: string[]): Record<number, string[]> => {
      const b: Record<number, string[]> = {};
      for (const id of ids) (b[content.spells[id]?.rank ?? 1] ??= []).push(id);
      return b;
    };
    // Dual Class with focus from BOTH classes → one focus entry PER class, each with its own
    // key/tradition/proficiency so their Focus DCs can differ. The focus POINT pool below stays a
    // SINGLE shared pool (RAW: one pool of points, but each spell uses its granting class's DC).
    const cls2FocusIds = cls2?.focusSpells ?? [];
    if (cls.focusSpells?.length && cls2 && cls2FocusIds.length) {
      const keyOf = (k: NonNullable<typeof cls>) => k.spellcasting?.keyAbility ?? FOCUS_CASTING[k.id]?.key ?? k.keyAbility[0] ?? 'cha';
      const tradOf = (k: NonNullable<typeof cls>) => k.spellcasting?.tradition ?? FOCUS_CASTING[k.id]?.tradition ?? 'occult';
      const primaryIds = focusSpells.filter((id) => !cls2FocusIds.includes(id));
      spellcasting.push({ id: `${cls.id}-focus`, name: `${cls.name} focus spells`, type: 'focus', tradition: tradOf(cls), keyAbility: keyOf(cls), proficiency: 'trained', cantrips: [], repertoire: byRankOf(primaryIds) });
      spellcasting.push({ id: `${cls2.id}-focus`, name: `${cls2.name} focus spells`, type: 'focus', tradition: tradOf(cls2), keyAbility: keyOf(cls2), proficiency: 'trained', cantrips: [], repertoire: byRankOf(cls2FocusIds) });
    } else {
      spellcasting.push({
        id: `${cls.id}-focus`,
        name: 'Focus spells',
        type: 'focus',
        tradition: focusTradition,
        keyAbility: focusKey,
        proficiency: 'trained',
        cantrips: [],
        repertoire: byRankOf(focusSpells),
        ...(Object.keys(focusSource).length ? { spellSources: focusSource } : {}),
      });
    }
    // Focus pool = number of focus-granting SOURCES (capped 3), not focus spells:
    // the class composition feature (1), each subclass/choice that grants focus (1),
    // and each domain-initiate-style feat (1). The animist instead scales with its
    // Third/Fourth Apparition (L7/L15).
    let poolMax: number;
    if (cls.id === 'animist') {
      poolMax = 1 + (level >= 7 ? 1 : 0) + (level >= 15 ? 1 : 0);
    } else {
      poolMax =
        (cls.focusSpells?.length ? 1 : 0) +
        // Dual Class: the second class's own composition/order/bloodline focus is a separate source.
        (cls2?.focusSpells?.length ? 1 : 0) +
        grantOptions.filter((o) => o.focusSpells?.length).length +
        featFocusSpells.length +
        (devotionSpell ? 1 : 0) +
        featPoolBonus;
    }
    poolMax = Math.min(3, poolMax);
    focus = { current: poolMax, max: poolMax };
  }

  // Psychic: the psi cantrips/amps are cantrips in the occult repertoire (granted via the
  // conscious mind's grantedSpells), NOT focus spells — so the block above never fires for a
  // psychic. But the psychic DOES have a Focus Pool (RAW: "You start with a focus pool of 2
  // Focus Points"), spent to power amps and refilled by Refocus. Seed it independently so the
  // sheet shows Focus Points + Refocus.
  //
  // It is NOT a flat 2: Clarity of Focus, the psychic's 5th-level class FEATURE, reads "Increase
  // the number of Focus Points in your focus pool by 1." Only `feat.focusPoolBonus` was ever read,
  // and this seed was hardcoded with a comment asserting nothing raised it — so every psychic from
  // 5th level on was a Focus Point short. `featPoolBonus` now also collects class features.
  if (!focus && ownsClass('psychic')) {
    // "As normal, this ability can't increase the size of your focus pool above 3 points."
    const max = Math.min(3, 2 + featPoolBonus);
    focus = { current: max, max };
  }

  // Class proficiency advancement: raise tracks to expert/master/legendary at the
  // class-defined levels (everything up to the target level). A subclass-specific
  // table (e.g. warpriest doctrine) overrides the class default when present.
  if (build.classId) {
    const adv =
      (build.subclassId ? CLASS_ADVANCEMENT[build.subclassId] : undefined) ?? CLASS_ADVANCEMENT[build.classId] ?? [];
    for (const e of adv) {
      if (e.level <= level) applyAdvancement(proficiencies, spellcasting, e, build.classId);
    }
    // Dual Class: also apply the second class's advancement (applyAdvancement only ever raises a
    // track via maxRank, so the better-rank-of-two result falls out automatically).
    if (cls2 && build.classId2) {
      const adv2 = (build.subclassId2 ? CLASS_ADVANCEMENT[build.subclassId2] : undefined) ?? CLASS_ADVANCEMENT[build.classId2] ?? [];
      for (const e of adv2) if (e.level <= level) applyAdvancement(proficiencies, spellcasting, e, build.classId2);
    }
    // Rogue Ruffian/Avenger rackets: "when you gain light armor expertise/mastery, you also gain expert/
    // master proficiency in medium armor." The rogue table only advances light, so mirror the resolved
    // light-armor rank onto medium for these rackets (trained@1, expert@13, master@19).
    if ([build.subclassId, build.subclassId2].some((s) => s === 'ruffian' || s === 'avenger')) {
      proficiencies.defenses.medium = maxRank(proficiencies.defenses.medium, proficiencies.defenses.light);
    }
    // Fighter Weapon Mastery (L5) / Weapon Legend (L13): the chosen weapon GROUP's simple/martial/
    // unarmed weapons reach master@5, then legendary@13 — routed through weaponGroups so only that
    // group is elevated above the general fighter progression. (Advanced weapons in the group lag one
    // rank per RAW; the one-rank-per-group model tracks the common simple/martial/unarmed case.)
    if ((build.classId === 'fighter' || build.classId2 === 'fighter') && build.fighterWeaponGroup && level >= 5) {
      const groupRank: ProficiencyRank = level >= 13 ? 'legendary' : 'master';
      (proficiencies.weaponGroups ??= {})[build.fighterWeaponGroup] = maxRank(
        proficiencies.weaponGroups[build.fighterWeaponGroup] ?? 'untrained',
        groupRank,
      );
    }
  }

  // Monk Path to Perfection: the player picks which save rises to master (L7), a different save to
  // master (L11), and one of those to legendary (L15). These are player choices, not in the
  // advancement table, so apply them after the standard bumps (never lowering).
  if (cls?.id === 'monk' || cls2?.id === 'monk') {
    const picks = build.pathToPerfection ?? [];
    if (level >= 7 && picks[0]) proficiencies.saves[picks[0]] = maxRank(proficiencies.saves[picks[0]], 'master');
    if (level >= 11 && picks[1]) proficiencies.saves[picks[1]] = maxRank(proficiencies.saves[picks[1]], 'master');
    if (level >= 15 && picks[2]) proficiencies.saves[picks[2]] = maxRank(proficiencies.saves[picks[2]], 'legendary');
  }

  // Override: force-set proficiency on any track to any rank (can also LOWER, unlike progression).
  // Keys route by track: perception/classDc (scalar), a save, a weapon/armor category, else a skill
  // id or `lore:<subject>` (assigning a brand-new key just adds that proficiency).
  for (const [key, rank] of Object.entries(build.overrides?.proficiencies ?? {})) {
    if (key === 'perception') proficiencies.perception = rank;
    else if (key === 'classDc') proficiencies.classDc = rank;
    else if (SAVE_TRACKS.includes(key)) proficiencies.saves[key as SaveId] = rank;
    else if (WEAPON_TRACKS.includes(key)) proficiencies.attacks[key as WeaponCategory] = rank;
    else if (ARMOR_TRACKS.includes(key)) proficiencies.defenses[key as ArmorCategory] = rank;
    else proficiencies.skills[key as ProficiencyKey] = rank;
  }

  // The background's granted skill feat, then every feat picked in a level slot
  // up to the target level (slot key = "level:category:idx"). A feat can only be
  // taken once, so dedup by id (the granted feat wins over a duplicate pick).
  const feats: FeatChoice[] = [];
  const takenFeats = new Set<string>();
  // A background whose own sub-choice IS the feat ("Multilingual or Assurance") — four of them.
  // Read through the same classifier the skill/Lore branch uses, so one place decides what a
  // background's answer means.
  const bgChoiceFeat = (() => {
    if (!background?.choice || backgroundChoiceKind(background.choice, content) !== 'feat') return undefined;
    const v = backgroundChoiceValue(build, background);
    return v && content.feats[v] ? v : undefined;
  })();
  // Eagle Hunter and Returned each grant TWO feats; iterating is what stopped the second being lost.
  for (const bgFeatId of [...backgroundGrantedFeats(background, build.backgroundSkillChoice), ...(bgChoiceFeat ? [bgChoiceFeat] : [])]) {
    if (takenFeats.has(bgFeatId)) continue;
    // The granted feat's OWN sub-choice travels with it. Without this the feat arrived and its subject
    // did not: Abadar's Avenger grants "Assurance with Religion", and the sheet could only render a
    // bare "Assurance" because nothing carried the skill. Read from grantedFeatChoices — the slot the
    // builder's picker writes, and the one applyFeatFocus already reads for slot-picked grants.
    const grantedChoice = content.feats[bgFeatId]?.choice;
    const pick = build.grantedFeatChoices?.[bgFeatId];
    // Same {value,label} shape a slot-picked grant stores, so every reader treats them alike.
    const raw = grantedChoice?.options?.find((o) => o.value === pick)?.label;
    feats.push({
      featId: bgFeatId,
      level: 1,
      category: 'skill',
      ...(grantedChoice && pick
        ? { choice: { value: pick, label: grantedChoice.kind === 'domains' ? cap(pick) : raw ? featChoiceLabel(raw) : cap(pick) } }
        : {}),
    });
    takenFeats.add(bgFeatId);
  }
  // A feat-granting heritage (Versatile Human → a level-1 general feat) — injected like the
  // background's skill feat, from the player's Heritage-card pick.
  const buildHeritage = build.heritageId ? content.heritages[build.heritageId] : undefined;
  if (
    buildHeritage?.grantsGeneralFeat &&
    build.heritageFeatId &&
    content.feats[build.heritageFeatId] &&
    !takenFeats.has(build.heritageFeatId)
  ) {
    feats.push({ featId: build.heritageFeatId, level: 1, category: 'general' });
    takenFeats.add(build.heritageFeatId);
  }
  // Wizard School of Unified Magical Theory (Player Core): "you gain an additional 1st-level wizard
  // class feat." Injected as an extra level-1 CLASS feat from the player's UMT picker — same mechanism
  // as the Versatile-Human bonus feat above.
  const isUmtSchool = cls?.id === 'wizard' && build.subclassId === 'school-of-unified-magical-theory';
  if (isUmtSchool && build.umtFeatId && content.feats[build.umtFeatId] && !takenFeats.has(build.umtFeatId)) {
    feats.push({ featId: build.umtFeatId, level: 1, category: 'class' });
    takenFeats.add(build.umtFeatId);
  }
  // Subclass/extra-choice options can grant a fixed bonus feat (bard muse feat, warpriest Shield
  // Block, druid order feat). Auto-grant those with no sub-choice; a choice-gated grant like Domain
  // Initiate is left for a manual slot so its domain pick is surfaced.
  const favorsSimpleOrUnarmed = deityFavorsSimpleOrUnarmed(build.deityId, content);
  for (const o of grantOptions) {
    for (const fid of o.grantedFeats ?? []) {
      const f = content.feats[fid];
      if (!f || f.choice || takenFeats.has(fid)) continue;
      // Deadly Simplicity (warpriest / battle-creed doctrines auto-grant it) requires the deity's
      // favored weapon be simple or unarmed — a longsword-deity (Iomedae) warpriest doesn't get it.
      if (fid === 'deadly-simplicity' && !favorsSimpleOrUnarmed) continue;
      feats.push({ featId: fid, level: 1, category: f.category });
      takenFeats.add(fid);
    }
  }
  // Feats an option grants WITH a restricted sub-choice (Dominion Epithet → Energized Spark for one of
  // 2 energy types). These have a .choice so the plain grantedFeats loop skips them; resolve the trait
  // here (default = first allowed). NOT added to takenFeats — Energized Spark is repeatable, so the
  // player may still pick it again manually for another type.
  const optionUnlockLevel = (optId: string): number => {
    for (const g of cls?.extraChoices ?? [])
      if (g.options.some((x) => x.id === optId)) return Math.min(...Object.keys(g.pickByLevel).map(Number));
    return 1;
  };
  for (const o of grantOptions) {
    for (const gcf of o.grantedChoiceFeats ?? []) {
      const f = content.feats[gcf.featId];
      if (!f?.choice) continue;
      const allowed = gcf.restrictTo?.length ? gcf.restrictTo : f.choice.options?.map((x) => x.value) ?? [];
      const picked = build.grantedChoiceFeatTraits?.[`grant:${o.id}:${gcf.featId}`];
      const value = picked && allowed.includes(picked) ? picked : allowed[0];
      if (value == null) continue;
      const raw = f.choice.options?.find((x) => x.value === value)?.label;
      const label = raw ? featChoiceLabel(raw) : cap(value);
      feats.push({ featId: gcf.featId, level: optionUnlockLevel(o.id), category: f.category, choice: { value, label } });
    }
  }
  // Druid Voice of Nature: a level-1 choice between the Animal Empathy and Plant Empathy feats.
  if ((cls?.features ?? []).some((f) => f.featureId === 'voice-of-nature')) {
    const pick = build.voiceOfNature && ['animal-empathy', 'plant-empathy'].includes(build.voiceOfNature) ? build.voiceOfNature : 'animal-empathy';
    if (content.feats[pick] && !takenFeats.has(pick)) {
      feats.push({ featId: pick, level: 1, category: content.feats[pick].category });
      takenFeats.add(pick);
    }
  }
  // Kineticist Expand the Portal: at a reached Gate's Threshold where you DIDN'T Fork the Path, you gain
  // a bonus impulse feat of your level for one of your elements.
  if (ownsClass('kineticist')) {
    for (const L of GATE_THRESHOLD_LEVELS) {
      if (level < L || build.gateForks?.[String(L)]) continue; // forked → no bonus impulse
      const impulseId = build.gateExpands?.[String(L)];
      const f = impulseId ? content.feats[impulseId] : undefined;
      if (f && !takenFeats.has(impulseId!)) {
        feats.push({ featId: impulseId!, level: L, category: f.category });
        takenFeats.add(impulseId!);
      }
    }
  }
  for (const [slotKey, featId] of Object.entries(build.featPicks)) {
    if (!featId) continue;
    // Repeatable feats (Armor Proficiency ×3, Skill Training, …) may fill several slots; every other
    // feat dedupes to one. Count prior takes of this id — including any earlier auto-grant of it —
    // against the cap, instead of the old flat "already taken?" test which silently dropped take 2+.
    const taken = feats.reduce((n, f) => (f.featId === featId ? n + 1 : n), 0);
    if (taken >= maxTakes(content.feats[featId])) continue;
    const [lvlStr, cat] = slotKey.split(':');
    const lvl = Number(lvlStr);
    if (!Number.isFinite(lvl) || lvl > level) continue;
    takenFeats.add(featId);
    // The slot key travels with the feat so a REPEATABLE feat's per-taking answers (its pick-a-feat
    // choice) can be told apart. Keyed by feat id alone, take 2 and take 3 shared one answer.
    feats.push({ featId, level: lvl, category: (cat as FeatCategory) ?? 'class', choice: featChoiceById[slotKey], slotKey });
  }
  // Dedication BONUS skill feats (Rogue Dedication: "You gain a skill feat"). Once the dedication is
  // among the taken feats, inject its chosen skill feat as an extra skill-feat slot at the dedication's
  // level — same mechanism as the Versatile-Human bonus feat. Only if the player picked one.
  for (const fc of [...feats]) {
    if (!FEAT_GRANTS[fc.featId]?.bonusSkillFeat) continue;
    const chosen = build.dedicationSkillFeats?.[fc.featId];
    if (chosen && content.feats[chosen] && !takenFeats.has(chosen)) {
      feats.push({ featId: chosen, level: fc.level, category: 'skill' });
      takenFeats.add(chosen);
    }
  }
  // Overrides — bonus feats force-granted with no slot (deduped against what's already taken), then
  // suppress any feats the user explicitly removed. buildCharacter doesn't re-validate, so this is safe.
  for (const a of build.overrides?.addedFeats ?? []) {
    if (!a.featId || takenFeats.has(a.featId) || a.level > level || !content.feats[a.featId]) continue;
    takenFeats.add(a.featId);
    feats.push({ featId: a.featId, level: a.level, category: a.category });
  }
  // Pick-a-feat grants: a feat like General Training / Basic Maneuver / Natural Ambition lets the
  // player CHOOSE a bonus feat from a filtered pool. Add the chosen feat (validated against the pool)
  // so it's granted with its own effects — then the expansion below carries any further grants.
  for (const fc of [...feats]) {
    const spec = FEAT_PICK_GRANTS[fc.featId];
    if (!spec) continue;
    // SLOT KEY FIRST, feat id as the fallback. A repeatable feat (Advanced Arcana, Animist's Power —
    // 25 of them ship with a spec already) fills several slots, and a feat-id key could hold only one
    // answer, so takes 2+ silently granted nothing. The bare-id read stays for characters saved
    // before this, exactly like the `<slotKey>#<i>` multi-pick lane.
    const chosen = (fc.slotKey ? build.pickFeatChoices?.[fc.slotKey] : undefined) ?? build.pickFeatChoices?.[fc.featId];
    if (!chosen || !content.feats[chosen]) continue;
    // Count against the pick's OWN cap rather than "is it taken at all", so two takings of a
    // repeatable grant can legitimately name the same repeatable feat.
    const already = feats.reduce((n, f) => (f.featId === chosen ? n + 1 : n), 0);
    if (already >= maxTakes(content.feats[chosen])) continue;
    if (!pickableFeats(spec, build, content).some((f) => f.id === chosen)) continue; // ignore an illegal pick
    takenFeats.add(chosen);
    feats.push({
      featId: chosen,
      level: fc.level,
      category: content.feats[chosen].category as FeatCategory,
      grantedBy: fc.featId,
      // WHICH taking granted it — so a rebuild from the character alone can pair each taking of a
      // repeatable grant with its own pick instead of collapsing them.
      ...(fc.slotKey ? { grantedBySlot: fc.slotKey } : {}),
      choice: grantedChoiceById[chosen],
    });
  }
  // A HERITAGE can carry the same kind of pick (Ancient Elf: a multiclass dedication at 1st level,
  // "even though you don't meet its level prerequisite" — the spec's maxLevel encodes that waiver).
  if (build.heritageId) {
    const spec = FEAT_PICK_GRANTS[build.heritageId];
    const chosen = spec ? build.pickFeatChoices?.[build.heritageId] : undefined;
    if (spec && chosen && !takenFeats.has(chosen) && content.feats[chosen] && pickableFeats(spec, build, content).some((f) => f.id === chosen)) {
      takenFeats.add(chosen);
      feats.push({ featId: chosen, level: 1, category: content.feats[chosen].category as FeatCategory, grantedBy: build.heritageId, choice: grantedChoiceById[chosen] });
    }
  }
  /*
   * …and so can a BACKGROUND or a CLASS FEATURE. Both were unreachable: this lane was consulted for
   * taken feat ids and `build.heritageId` and nothing else, so a background offering "one Athletics
   * skill feat of your choice" and a subclass offering "a bonus 1st-level barbarian feat" each asked
   * a question the engine never read.
   *
   * Granted at the level the source arrives — 1 for a background, the feature's own level otherwise —
   * so a feat's level prerequisite is judged against the right level.
   */
  const pickFrom = (sourceId: string, level: number) => {
    const spec = FEAT_PICK_GRANTS[sourceId];
    if (!spec) return;
    const chosen = build.pickFeatChoices?.[sourceId];
    if (!chosen || takenFeats.has(chosen) || !content.feats[chosen]) return;
    if (!pickableFeats(spec, build, content).some((f) => f.id === chosen)) return;
    takenFeats.add(chosen);
    feats.push({
      featId: chosen,
      level,
      category: content.feats[chosen].category as FeatCategory,
      grantedBy: sourceId,
      choice: grantedChoiceById[chosen],
    });
  };
  if (build.backgroundId) pickFrom(build.backgroundId, 1);
  for (const fid of classFeatureIdsOwned(build, content)) {
    pickFrom(fid, Math.max(1, Math.min(level, content.classFeatures[fid]?.level ?? 1)));
  }
  // Feats that GRANT another feat (Bastion-style dedications → a bonus feat, e.g. Lastwall Sentry →
  // Reactive Shield). Runs after ALL feats are placed (picks + class-granted + overrides) so every
  // source expands. Each granted feat is added as a BONUS (no slot) — it shows in Feats & Features and
  // its own effects apply (proficiency grants run in the loop below). Transitive with a visited guard,
  // deduped against feats already taken. Placed before the removal pass so Overrides can strip a
  // A HERITAGE (or feat/feature) can grant a specific feat outright (Cataphract Fleshwarp → Armor
  // Proficiency, Battle-Trained Human → Diehard). Add them as bonus feats before the expansion so the
  // granted feat's own effects (and any onward grants) resolve.
  {
    const grantSources: { id: string; grants?: string[] }[] = [];
    if (build.heritageId) grantSources.push({ id: build.heritageId, grants: content.heritages[build.heritageId]?.grantsFeats });
    for (const fc of [...feats]) grantSources.push({ id: fc.featId, grants: content.feats[fc.featId]?.grantsFeats });
    // An invested item can grant a bonus feat too (The Survivor → Diehard).
    for (const inv of build.inventory) if (inv.invested) grantSources.push({ id: inv.itemId, grants: content.items[inv.itemId]?.grantsFeats });
    // …and so can a CLASS FEATURE: Improved Familiar Attunement grants the Familiar feat (without it a
    // wizard with that thesis got no familiar at all), Cloistered Cleric grants Domain Initiate, the
    // Shield Block feature grants the Shield Block feat. This source was missing entirely, so those
    // grants did nothing however the record was written.
    for (const [c, subId] of [[cls, build.subclassId], [cls2, build.subclassId2]] as const) {
      if (!c) continue;
      // A subclass can REMOVE a feature (cleric Battle Creed drops Resolute Faith); a removed feature
      // must not still hand out its feat.
      const dropped = new Set(c.subclass?.options.find((o) => o.id === subId)?.suppressedFeatures ?? []);
      for (const f of c.features) {
        if (f.level > level || dropped.has(f.featureId)) continue;
        grantSources.push({ id: f.featureId, grants: content.classFeatures[f.featureId]?.grantsFeats });
      }
    }
    // …and the chosen OPTIONS, which is where several of these actually live: a wizard's thesis
    // (Improved Familiar Attunement → the Familiar feat) and a cleric's doctrine (Cloistered Cleric →
    // Domain Initiate) are picks, not entries in the class's level-by-level feature list. Their option
    // id matches the classFeatures record that carries the grant.
    for (const o of grantOptions) {
      grantSources.push({ id: o.id, grants: content.classFeatures[o.id]?.grantsFeats });
    }
    for (const src of grantSources) {
      for (const gid of src.grants ?? []) {
        if (takenFeats.has(gid) || !content.feats[gid]) continue;
        takenFeats.add(gid);
        feats.push({ featId: gid, level: 1, category: content.feats[gid].category as FeatCategory, grantedBy: src.id, choice: grantedChoiceById[gid] });
      }
    }
  }
  // granted feat too.
  {
    // Seeded with owned CLASS FEATURES as well as feats: 19 entries in featFeatGrants.ts are keyed to
    // class-feature ids (Alchemical Sciences Methodology, Aloof Firmament, Battledancer) and this
    // queue only ever held feats, so none of them had fired. The grant still has to name a real feat.
    const queue = [
      ...feats.map((f) => f.featId),
      ...classFeatureIdsOwned(
        { classId: build.classId, subclassId: build.subclassId, level, classChoices: grantOptions.map((o) => ({ id: o.id, level: 1 })) },
        content,
      ),
    ];
    let guard = 0;
    while (queue.length && guard++ < 500) {
      const srcId = queue.shift() as string;
      for (const gid of FEAT_FEAT_GRANTS[srcId] ?? []) {
        if (takenFeats.has(gid) || !content.feats[gid]) continue;
        takenFeats.add(gid);
        // A class-feature source has no entry in `feats`; fall back to the level the class grants it,
        // so a feature gained at 9th does not list its granted feat as though it arrived at 1st.
        const srcLevel =
          feats.find((f) => f.featId === srcId)?.level ??
          (content.classes[build.classId ?? '']?.features ?? []).find((f) => f.featureId === srcId)?.level ??
          1;
        feats.push({ featId: gid, level: srcLevel, category: content.feats[gid].category as FeatCategory, grantedBy: srcId, choice: grantedChoiceById[gid] });
        queue.push(gid);
      }
      // Level-gated grants (Covet Hoard → Incredible Investiture at 11th) — only once high enough.
      for (const lg of FEAT_FEAT_GRANTS_LEVELED[srcId] ?? []) {
        if (level < lg.minLevel || takenFeats.has(lg.feat) || !content.feats[lg.feat]) continue;
        takenFeats.add(lg.feat);
        feats.push({ featId: lg.feat, level: lg.minLevel, category: content.feats[lg.feat].category as FeatCategory, grantedBy: srcId, choice: grantedChoiceById[lg.feat] });
        queue.push(lg.feat);
      }
    }
  }
  if (build.overrides?.removedFeatIds?.length) {
    const removed = new Set(build.overrides.removedFeatIds);
    for (let i = feats.length - 1; i >= 0; i--) if (removed.has(feats[i].featId)) feats.splice(i, 1);
  }
  feats.sort((a, b) => a.level - b.level);

  // Feat-granted proficiencies (archetype dedications etc.). Applied AFTER class advancement so a
  // dedication can raise a proficiency the class hasn't (Sentinel → light+medium armor, Fighter
  // Dedication → martial weapons, …). Only RAISES a rank (maxRank), never lowers. See featGrants.ts.
  // Redundant-grant fallbacks ("already trained → a skill of your choice") triggered here are surfaced
  // on Character.skillFallbacks so the builder can offer the replacement picker.
  const skillFallbacks: { featId: string; skill: ProficiencyKey }[] = [];
  // CLASS FEATURES are grant sources too. This table is iterated over taken feats, and 13 entries in
  // featGrantsAuto.ts were authored against class-feature ids — `expert-overdrive` and
  // `legendary-overdrive` among them — so they had never once fired. A class feature has no embedded
  // sub-choice, hence the bare `{ featId }`.
  const grantSourcesForProficiency = [
    ...feats,
    // `grantOptions` is every chosen option — subclass plus the extra-choice picks (thaumaturge
    // implements, exemplar ikons, kineticist elements) — and each option id is also a classFeature.
    ...[...classFeatureIdsOwned(
      { classId: build.classId, subclassId: build.subclassId, level, classChoices: grantOptions.map((o) => ({ id: o.id, level: 1 })) },
      content,
    )]
      .filter((id) => FEAT_GRANTS[id])
      .map((id) => ({ featId: id, choice: undefined })),
  ];
  for (const fc of grantSourcesForProficiency) {
    const g = FEAT_GRANTS[fc.featId];
    if (!g) continue;
    // Some grants don't start when the feat is taken — Martial Experience only trains you in every
    // weapon from 11th level. Without this the sheet would over-grant for ten levels.
    if (g.minLevel && level < g.minLevel) continue;
    // A feat's grants can improve with level (Canny Acumen: expert, master at 17). The upgrade is a
    // floor on every rank THIS feat grants — it never lowers a rank the feat would already give.
    // Multi-step progressions ("expert now, master at 7th, legendary at 15th") take the highest
    // step the character has reached.
    const up = upgradeRankAt(g, level);
    const at = (r: ProficiencyRank) => (up ? maxRank(r, up) : r);
    // Static grants, then the one selected by the player's pick in the feat's own choice dropdown.
    for (const src of [g, fc.choice?.value ? g.choiceGrants?.[fc.choice.value] : undefined]) {
      if (!src) continue;
      for (const [c, r] of Object.entries(src.armor ?? {})) if (r) proficiencies.defenses[c as ArmorCategory] = maxRank(proficiencies.defenses[c as ArmorCategory], at(r));
      for (const [c, r] of Object.entries(src.weapon ?? {})) if (r) proficiencies.attacks[c as WeaponCategory] = maxRank(proficiencies.attacks[c as WeaponCategory], at(r));
      for (const [s, r] of Object.entries(src.save ?? {})) if (r) proficiencies.saves[s as SaveId] = maxRank(proficiencies.saves[s as SaveId], at(r));
      if (src.perception) proficiencies.perception = maxRank(proficiencies.perception, at(src.perception));
      for (const [k, r] of Object.entries(src.skills ?? {})) {
        if (!r) continue;
        const key = k as ProficiencyKey;
        const cur = proficiencies.skills[key] ?? 'untrained';
        // "If you were already trained, you instead become trained in a skill of your choice" — the
        // redundant static grant converts into a replacement pick (recorded for the builder; applied
        // from featSkillChoices `<featId>:fallback:<skill>`). Lore grants stay as-is (they're new).
        if (g.redundantFallback && src === g && !key.startsWith('lore:') && maxRank(cur, at(r)) === cur) {
          skillFallbacks.push({ featId: fc.featId, skill: key });
          const picked = build.featSkillChoices?.[`${fc.featId}:fallback:${key}`];
          if (picked && SKILLS.includes(picked)) proficiencies.skills[picked] = maxRank(proficiencies.skills[picked] ?? 'untrained', 'trained');
          continue;
        }
        proficiencies.skills[key] = maxRank(cur, at(r));
      }
      // Conditional "trained; expert if already trained" — grant upgraded only if the character
      // already meets `base` from another source (evaluated against the current, pre-this-grant rank).
      for (const [k, cu] of Object.entries(src.conditionalSkills ?? {})) {
        if (!cu) continue;
        const cur = proficiencies.skills[k as ProficiencyKey] ?? 'untrained';
        const grant = maxRank(cur, cu.base) === cur ? cu.upgraded : cu.base; // cur >= base → upgraded
        proficiencies.skills[k as ProficiencyKey] = maxRank(cur, at(grant));
      }
    }
    // Armor Proficiency cascade: train the first of light→medium→heavy still untrained RIGHT NOW.
    // Because this loop mutates proficiencies in place and feats are sorted by level, a 2nd/3rd take
    // sees the previous take's result and advances to the next armor — reproducing Foundry's
    // state-gated ChoiceSet without a predicate engine. `at('trained')` becomes expert at level 13+.
    // Record which armor THIS take trained onto its FeatChoice, so three identical "Armor Proficiency"
    // rows read "Light armor" / "Medium armor" / "Heavy armor" on the builder and sheet. A take that
    // finds nothing left to train (e.g. a fighter already in all armor) grants nothing and stays bare.
    if (g.armorCascade) {
      const next = (['light', 'medium', 'heavy'] as ArmorCategory[]).find((c) => proficiencies.defenses[c] === 'untrained');
      if (next) {
        proficiencies.defenses[next] = at('trained');
        fc.choice = { value: next, label: `${cap(next)} armor` };
      }
    }
    // Skill-training CHOICES ("your choice of Acrobatics or Athletics"): resolve each slot to the
    // player's pick, defaulting to the first option (or Acrobatics for an 'any' slot). Trains that
    // skill (RAISES only).
    (g.skillChoices ?? []).forEach((slot, idx) => {
      const opts = slot.options === 'any' ? SKILLS : slot.options;
      const picked = build.featSkillChoices?.[`${fc.featId}:${idx}`];
      const skill = picked && opts.includes(picked) ? picked : opts[0];
      const cur = proficiencies.skills[skill] ?? 'untrained';
      // A conditional slot ("trained; expert if already trained" on a CHOSEN skill — Lion Blade)
      // upgrades when the pick already met `base` before this grant.
      const grant = slot.conditionalRank
        ? maxRank(cur, slot.conditionalRank.base) === cur
          ? slot.conditionalRank.upgraded
          : slot.conditionalRank.base
        : slot.rank;
      proficiencies.skills[skill] = maxRank(cur, grant);
    });
    // "Trained in a Lore of your choice" — grant lore:<subject> for each filled Lore slot (RAISES only).
    for (let idx = 0; idx < (g.loreChoices ?? 0); idx++) {
      const subject = build.featLoreChoices?.[`${fc.featId}:${idx}`]?.trim();
      if (!subject) continue;
      const key = loreKey(subject);
      proficiencies.skills[key] = maxRank(proficiencies.skills[key] ?? 'untrained', 'trained');
    }
  }

  // Bloodrager Dedication: you become trained in Arcana (if you chose arcane cantrips) or Religion (if
  // divine). "If you were already trained, you become trained in a skill of your choice" — modelled via
  // a free-skill picker (featSkillChoices['bloodrager-dedication:free']) that the builder surfaces only
  // when the tradition skill is already trained.
  if (takenFeats.has('bloodrager-dedication')) {
    // Effective tradition: two-caster classes store it on archetypeSpells; a non-caster (barbarian) on archetypeTradition.
    const bloodTrad = build.archetypeSpells?.tradition ?? build.archetypeTradition;
    const traditionSkill = bloodTrad === 'divine' ? 'religion' : bloodTrad === 'arcane' ? 'arcana' : null;
    if (traditionSkill) {
      if ((proficiencies.skills[traditionSkill] ?? 'untrained') === 'untrained') {
        proficiencies.skills[traditionSkill] = 'trained';
      } else {
        const picked = build.featSkillChoices?.['bloodrager-dedication:free'];
        const skill = picked && SKILLS.includes(picked) ? picked : null;
        if (skill) proficiencies.skills[skill] = maxRank(proficiencies.skills[skill] ?? 'untrained', 'trained');
      }
    }
  }

  // "Choose one of N" effect picks (DefenseGrants/Item.effectChoices — a dragon tattoo's resistance
  // TYPE, an energy heart's element, one of several skills). Resolve each owned record's picks:
  //  - feats/heritage/class features → chosenEffects (senses/IWR/speeds, added as a derive source) +
  //    skills (applied now) + innate spells (collected for the innate entry).
  //  - items → resolvedItemPassives[itemId] (applied by derive only while the item is worn).
  const chosenEffects: DefenseGrants = {};
  const chosenInnateGrants: InnateSpellGrant[] = [];
  /** Which record's choice produced each chosen innate spell (for the Spells page's source labels). */
  const chosenInnateSource: Record<string, string> = {};
  const resolvedItemPassives: Record<string, ItemPassiveEffects> = {};
  const effectWarnings: { source: string; message: string }[] = [];
  const effectPicks: NonNullable<Character['effectPicks']> = [];
  const mergeEffect = (into: DefenseGrants, g: EffectGrant) => {
    if (g.senses) (into.senses ??= []).push(...g.senses);
    if (g.resistances) (into.resistances ??= []).push(...g.resistances);
    if (g.weaknesses) (into.weaknesses ??= []).push(...g.weaknesses);
    if (g.immunities) (into.immunities ??= []).push(...g.immunities);
    if (g.speeds) into.speeds = { ...into.speeds, ...g.speeds };
    // A pick whose benefit is STATE-GATED ("bludgeoning and your choice of cold, electricity, or
    // fire" — but only while raging, and only from 9th). Everything else here lands unconditionally,
    // so without this branch the pick would grant a permanent resistance to a barbarian standing still.
    if (g.whileActive?.length) (into.whileActive ??= []).push(...g.whileActive);
    if (g.strikeDamage?.length) (into.strikeDamage ??= []).push(...g.strikeDamage);
  };
  const resolvePick = (recordId: string, choices: EffectChoice[] | undefined, sink: (g: EffectGrant, srcName: string) => void, srcName: string) => {
    for (const ch of choices ?? []) {
      const val = build.effectChoices?.[`${recordId}:${ch.id}`];
      let g: EffectGrant | undefined;
      if (ch.spellFilter) {
        // Open-ended pick ("any 1st-rank arcane spell"): the stored value IS the chosen spell id.
        g = (val ? grantForSpellPick(ch.spellFilter, val, content, level) : null) ?? undefined;
      } else {
        const opts = ch.options ?? [];
        const opt = opts.find((o) => o.value === val) ?? (opts.length === 1 ? opts[0] : undefined);
        // Record the pick even when the option carries no grant (a kineticist gate junction: only
        // Elemental Resistance moves a stat) so the sheet still shows which one was taken.
        if (opt) effectPicks.push({ recordId, choiceId: ch.id, label: opt.label, note: opt.note });
        g = opt?.grant;
      }
      if (!g) continue;
      // Warn if a chosen innate spell isn't in the shipped data (legacy) but should reach the sheet.
      for (const s of g.innateSpells ?? []) if (!content.spells[s.spellId]) effectWarnings.push({ source: srcName, message: `references the missing spell “${s.spellId}”` });
      sink(g, srcName);
    }
  };
  // CLASS ARCHETYPES (Runelord, War Magic, …): unlike a normal archetype these RESTRUCTURE the class —
  // suppressing class features and substituting their own. Resolved before the owned-feature set so
  // every downstream consumer (effect choices, focus, derive) sees the archetype's version of the class.
  const archSuppressed = new Set<string>();
  const archAddedFeatures: { level: number; featureId: string }[] = [];
  const archNotes: string[] = [];
  /** Which class the archetype restructures — a per-class list needs it, or Dual Class shows the
   *  substituted features under both classes. */
  let archClassId: string | undefined;
  const archCaps: { armor?: ClassArchetype['armorCap']; weapon?: ClassArchetype['weaponCap'] }[] = [];
  // An archetype may be carried by the dedication FEAT or by a chosen subclass/extra-choice option
  // (the wizard's Runelord school is both the school and the archetype), so scan both.
  const archCarriers: { name: string; ca: ClassArchetype }[] = [];
  for (const fc of feats) {
    const ca = content.feats[fc.featId]?.classArchetype;
    if (ca) archCarriers.push({ name: content.feats[fc.featId].name, ca });
  }
  for (const o of grantOptions) {
    const ca = content.classFeatures[o.id]?.classArchetype;
    if (ca) archCarriers.push({ name: content.classFeatures[o.id].name, ca });
  }
  for (const { name, ca } of archCarriers) {
    // Only applies to a character OF that class (either class when dual-classed).
    if (ca.classId !== build.classId && ca.classId !== build.classId2) continue;
    archClassId = ca.classId;
    for (const id of ca.suppressFeatures ?? []) archSuppressed.add(id);
    for (const af of ca.addFeatures ?? []) if (af.level <= level && content.classFeatures[af.featureId]) archAddedFeatures.push(af);
    for (const [c, r] of Object.entries(ca.armor ?? {})) if (r) proficiencies.defenses[c as ArmorCategory] = maxRank(proficiencies.defenses[c as ArmorCategory], r);
    for (const [c, r] of Object.entries(ca.weapon ?? {})) if (r) proficiencies.attacks[c as WeaponCategory] = maxRank(proficiencies.attacks[c as WeaponCategory], r);
    if (ca.armorCap || ca.weaponCap) archCaps.push({ armor: ca.armorCap, weapon: ca.weaponCap });
    if (ca.note) archNotes.push(`${name}: ${ca.note}`);
  }

  const ownedFeatureIds = new Set([
    ...(cls?.features ?? []).filter((f) => f.level <= level).map((f) => f.featureId),
    ...(cls2?.features ?? []).filter((f) => f.level <= level).map((f) => f.featureId),
    ...archAddedFeatures.map((f) => f.featureId),
  ]);
  for (const id of archSuppressed) ownedFeatureIds.delete(id);
  const applyAlwaysOn = (g: EffectGrant, srcName?: string) => {
    mergeEffect(chosenEffects, g);
    for (const [k, r] of Object.entries(g.skills ?? {})) if (r) proficiencies.skills[k as ProficiencyKey] = maxRank(proficiencies.skills[k as ProficiencyKey] ?? 'untrained', r);
    for (const s of g.innateSpells ?? []) {
      if (!content.spells[s.spellId]) continue;
      chosenInnateGrants.push(s);
      if (srcName) chosenInnateSource[s.spellId] ??= srcName;
    }
  };
  for (const fc of feats) resolvePick(fc.featId, content.feats[fc.featId]?.effectChoices, applyAlwaysOn, content.feats[fc.featId]?.name ?? fc.featId);
  // Both heritages: four of the nine a second-heritage feat can hand over carry their whole
  // mechanical content in `effectChoices`, so resolving only the first would grant nothing.
  for (const hid of [build.heritageId, secondHeritageId]) {
    if (hid) resolvePick(hid, content.heritages[hid]?.effectChoices, applyAlwaysOn, content.heritages[hid]?.name ?? hid);
  }
  // The DEITY and the BACKGROUND can carry a pick too (Lurlup's optional Unholy sanctification;
  // Magical Experiment). Neither was resolved, so both were questions with no answer and no effect.
  if (build.deityId) resolvePick(build.deityId, content.deities[build.deityId]?.effectChoices, applyAlwaysOn, content.deities[build.deityId]?.name ?? build.deityId);
  if (build.backgroundId) resolvePick(build.backgroundId, content.backgrounds[build.backgroundId]?.effectChoices, applyAlwaysOn, content.backgrounds[build.backgroundId]?.name ?? build.backgroundId);
  for (const fid of ownedFeatureIds) resolvePick(fid, content.classFeatures[fid]?.effectChoices, applyAlwaysOn, content.classFeatures[fid]?.name ?? fid);
  // A chosen subclass / extra-choice option (a kineticist element gate, the wizard's Runelord school)
  // ships as a classFeature record under the same slug — its picks are the character's too.
  for (const o of grantOptions) {
    if (ownedFeatureIds.has(o.id)) continue; // already resolved above
    resolvePick(o.id, content.classFeatures[o.id]?.effectChoices, applyAlwaysOn, content.classFeatures[o.id]?.name ?? o.name ?? o.id);
  }
  // A class feature's PLAIN `choice` (stored under `feature:<id>`) may now carry a grant too. Those
  // pickers already rendered and their answers already round-tripped — the barbarian's instinct even
  // shipped a choice literally flagged `ragingResistanceTraditions` — but no reader ever looked at
  // the answer, so every one of them was a question with no consequence.
  // A chosen SUBCLASS counts too — the barbarian's instinct ships as a classFeature under the same
  // slug and is where all nine Raging Resistance clauses live.
  for (const fid of new Set([...ownedFeatureIds, ...grantOptions.map((o) => o.id)])) {
    const def = content.classFeatures[fid]?.choice;
    if (!def || def.daily) continue; // a daily answer is play state, resolved by dailyChoiceGrants
    const g = (def.options ?? []).find((o) => o.value === build.featChoices?.[`feature:${fid}`])?.grant;
    if (g) applyAlwaysOn(g, content.classFeatures[fid]?.name ?? fid);
  }
  // "Whenever you Refocus, you recover 3 Focus Points / completely refill your focus pool."
  // The Refocus control restored exactly 1 point with nothing able to say otherwise, so this whole
  // family of 18 feats was inert. Best offer wins: a full refill beats any number, else the largest.
  // Placed after the feat list is assembled — `feats` does not exist where the pool itself is built.
  if (focus) {
    for (const fc of feats) {
      const r = content.feats[fc.featId]?.refocusRestore;
      if (r == null) continue;
      const cur = focus.refocusRestore;
      if (r === 'all' || (cur !== 'all' && r > (typeof cur === 'number' ? cur : 1))) {
        focus.refocusRestore = r;
        focus.refocusSource = content.feats[fc.featId]?.name ?? fc.featId;
      }
    }
  }

  // Advanced Alchemy's daily item count. The panel hardcoded `4 + Int` and blocked preparing past it,
  // so Efficient Alchemy ("to 6 + your Intelligence modifier") and Advanced Efficient Alchemy
  // ("to 8 + your Int, or 10 + your Int if you're 16th level or higher") were both inert.
  let advancedAlchemy: Character['advancedAlchemy'];
  {
    const intMod = abilityMod(abilities.int);
    const base = ownsClass('alchemist') ? 4 + intMod : 0;
    let max = base;
    let source: string | undefined;
    for (const fc of feats) {
      const a = content.feats[fc.featId]?.advancedAlchemy;
      if (!a) continue;
      const tier = a.atLevel && level >= a.atLevel.level ? a.atLevel.items : a.items;
      const n = tier + (a.addInt ? intMod : 0);
      if (n > max) { max = n; source = content.feats[fc.featId]?.name ?? fc.featId; }
    }
    if (max > 0) advancedAlchemy = { max, source };
  }

  // "You regain twice as many Hit Points from resting" (Fast Recovery), and Bolstered Recovery
  // doubles the condition steps as well. rest() used a bare `level × Con mod` and stepped
  // Doomed/Drained by exactly 1, so neither feat changed anything about a night's sleep.
  let restRecovery: Character['restRecovery'];
  {
    let hp = 1;
    let steps = 1;
    for (const fc of feats) {
      const r = content.feats[fc.featId]?.restRecovery;
      if (!r) continue;
      hp = Math.max(hp, r.hpMultiplier ?? 1); // the best offer wins; two such feats do not multiply
      steps = Math.max(steps, r.conditionSteps ?? 1);
    }
    if (hp > 1 || steps > 1) restRecovery = { hpMultiplier: hp, conditionSteps: steps };
  }

  // "Increase your limit on invested items from 10 to 12" (Incredible Investiture). The inventory
  // capped investment at a bare const, so the feat raised nothing.
  const investedBonus = feats.reduce((n, fc) => n + (content.feats[fc.featId]?.investedLimitBonus ?? 0), 0);

  // "Add Illusory Disguise, Illusory Object, and Illusory Scene to your spell list." The picker
  // filtered strictly on the entry's tradition, so these feats offered nothing new to learn. They
  // widen the POOL only — the player still has to spend a repertoire slot or prepare the spell.
  //
  // Three different promises, kept apart: 'list' widens the picker (you may LEARN it), 'repertoire'
  // means you already know it, 'font' makes it a legal divine-font choice. Class features carry these
  // too now, which is why the sins and the witch lessons could not be expressed before.
  let spellListAdditions: Record<string, string[]> | undefined;
  const grantedRepertoireAdds: { entryId?: string; spells: string[] }[] = [];
  const fontAdds: { entryId?: string; spells: string[] }[] = [];
  {
    const sources: (DefenseGrants | undefined)[] = [
      ...feats.map((fc) => content.feats[fc.featId]),
      ...[...classFeatureIdsOwned(
        { classId: build.classId, subclassId: build.subclassId, level, classChoices: grantOptions.map((o) => ({ id: o.id, level: 1 })) },
        content,
      )].map((id) => content.classFeatures[id]),
    ];
    for (const src of sources) {
      const list = src?.spellListAdditions;
      for (const add of list == null ? [] : Array.isArray(list) ? list : [list]) {
        // Never offer an id the picker cannot open.
        const known = (add.spells ?? []).filter((s) => content.spells[s]);
        if (!known.length) continue;
        if (add.as === 'repertoire') grantedRepertoireAdds.push({ entryId: add.entryId, spells: known });
        else if (add.as === 'font') fontAdds.push({ entryId: add.entryId, spells: known });
        else {
          const key = add.entryId ?? '*';
          spellListAdditions = spellListAdditions ?? {};
          spellListAdditions[key] = [...new Set([...(spellListAdditions[key] ?? []), ...known])];
        }
      }
    }
  }

  // Applied as a final pass: the spellcasting entries are assembled well above this point, and a
  // record granting into a repertoire or a font has to wait until there is an entry to grant into.
  for (const { entryId, spells } of grantedRepertoireAdds) {
    const entry = entryId ? spellcasting.find((e) => e.id === entryId) : spellcasting.find((e) => e.type === 'focus') ?? spellcasting[0];
    if (!entry) continue;
    for (const sid of spells) {
      const rank = content.spells[sid]?.rank ?? 1;
      const at = ((entry.grantedRepertoire ??= {})[rank] ??= []);
      if (!at.includes(sid)) at.push(sid);
    }
  }
  for (const { entryId, spells } of fontAdds) {
    // A font addition belongs to the entry that HAS a font; naming one is only needed when two do.
    const entry = entryId ? spellcasting.find((e) => e.id === entryId) : spellcasting.find((e) => e.font);
    if (!entry?.font) continue;
    entry.font.allowed = [...new Set([...(entry.font.allowed ?? []), ...spells])];
  }

  // Diehard: "you die from the dying condition at dying 5, rather than dying 4". dyingDeathThreshold
  // took only Doomed, so the feat changed nothing — you still died at 4 with it.
  let dyingThreshold: number | undefined;
  {
    const bonus = feats.reduce((n, fc) => n + (content.feats[fc.featId]?.dyingThresholdBonus ?? 0), 0);
    if (bonus) dyingThreshold = 4 + bonus;
  }

  // Repeatable feats that SET a class resource's daily maximum ("your number of versatile vials per
  // day increases to 5", again to 6 and 7 on later takes). Indexed by how many times it was taken.
  // Both sheet call sites read the bare formula, so these were inert.
  let resourceFloors: Record<string, number> | undefined;
  {
    const takes = new Map<string, number>();
    for (const fc of feats) takes.set(fc.featId, (takes.get(fc.featId) ?? 0) + 1);
    for (const [featId, n] of takes) {
      const rm = content.feats[featId]?.resourceMaxSet;
      if (!rm?.values.length) continue;
      const v = rm.values[Math.min(n, rm.values.length) - 1];
      if (!Number.isFinite(v)) continue;
      resourceFloors = resourceFloors ?? {};
      resourceFloors[rm.resourceId] = Math.max(resourceFloors[rm.resourceId] ?? 0, v);
    }
  }

  // Ancestry Weapon Familiarity / Expertise: proficiency in NAMED weapons. Applied here (after class
  // advancement) so `mirrorBestCategory` sees the character's final weapon-category ranks — that is
  // exactly what "whenever a class feature grants you expert or greater proficiency" means.
  {
    const wo: Record<string, ProficiencyRank> = { ...(proficiencies.weaponOverrides ?? {}) };
    let touched = false;
    const bestCategory = (['simple', 'martial', 'advanced'] as WeaponCategory[])
      .map((c) => proficiencies.attacks[c])
      .reduce((a, b) => maxRank(a, b), 'untrained' as ProficiencyRank);
    for (const fc of feats) {
      const g = FEAT_GRANTS[fc.featId];
      // A feat's flat familiarity PLUS the one selected by the player's weapon choice (Viking
      // Shieldbearer: "trained in your choice of the battle axe or longsword").
      const chosen = fc.choice?.value ? g?.choiceGrants?.[fc.choice.value]?.weaponFamiliarity : undefined;
      for (const wf of [g?.weaponFamiliarity, chosen]) {
        if (!wf) continue;
        // The weapon may be one the player CHOSE on this feat or on another one (Unconventional
        // Weaponry records it; Unconventional Expertise advances "the weapon you chose" for it).
        let weapons = wf.weapons;
        let lowered: WeaponCategory | undefined;
        if (wf.weaponFromChoiceFlag) {
          const picked = feats
            .map((f) => (content.feats[f.featId]?.choice?.flag === wf.weaponFromChoiceFlag ? f.choice?.value : undefined))
            .find(Boolean);
          const item = picked ? content.items[picked] : undefined;
          if (!item || item.itemType !== 'weapon') continue; // nothing chosen yet — grant nothing
          weapons = [picked!];
          // "you treat it as a simple weapon" / advanced → "as a martial weapon": one category down.
          if (wf.treatAsLowerCategory) lowered = item.category === 'advanced' ? 'martial' : 'simple';
        }
        // mirrorCategory is the precise form ("as if they were MARTIAL weapons"); mirrorBestCategory
        // is the ancestry-Expertise form ("whenever a class feature grants you expert or greater…").
        const rank = lowered
          ? proficiencies.attacks[lowered]
          : wf.mirrorCategory
            ? proficiencies.attacks[wf.mirrorCategory]
            : wf.mirrorBestCategory
              ? bestCategory
              : wf.rank;
        if (!rank || rank === 'untrained') continue;
        for (const w of weapons) {
          if (!content.items[w]) continue;
          wo[w] = maxRank(wo[w] ?? 'untrained', rank);
          touched = true;
        }
      }
    }
    if (touched) proficiencies.weaponOverrides = wo;
  }

  // Class-archetype proficiency CEILINGS, applied last so they clamp the finished ranks (a Warrior of
  // Legend is never trained in heavy armor, however far the fighter table would otherwise take it).
  for (const cap of archCaps) {
    for (const [c, r] of Object.entries(cap.armor ?? {})) if (r) proficiencies.defenses[c as ArmorCategory] = minRank(proficiencies.defenses[c as ArmorCategory], r);
    for (const [c, r] of Object.entries(cap.weapon ?? {})) if (r) proficiencies.attacks[c as WeaponCategory] = minRank(proficiencies.attacks[c as WeaponCategory], r);
  }

  // Multiclass dedications that grant a trained class DC in the BORROWED class (Fighter/Ranger/Rogue/
  // Alchemist Dedication). Key ability = the borrowed class's KAS (the higher mod when it's flexible).
  const secondaryClassDcs: NonNullable<Character['secondaryClassDcs']> = [];
  {
    const seen = new Set<string>();
    for (const fc of feats) {
      const grant = content.feats[fc.featId]?.classDcGrant;
      if (!grant || seen.has(grant.classId) || grant.classId === build.classId || grant.classId === build.classId2) continue;
      const cls = content.classes[grant.classId];
      if (!cls) continue;
      seen.add(grant.classId);
      const kas = Array.isArray(cls.keyAbility) ? cls.keyAbility : [cls.keyAbility];
      const key = kas.reduce((best, a) => (abilityMod(abilities[a]) > abilityMod(abilities[best]) ? a : best), kas[0]) as AbilityId;
      // The dedication grants TRAINED, but a later archetype feat can raise it — "you become an
      // expert in the alchemist class DC" (Alchemical Power), Officer's Expertise/Mastery, and their
      // kin. This was pinned at trained, so all of those feats left the number exactly where it was.
      let rank: ProficiencyRank = 'trained';
      for (const other of feats) {
        const up = content.feats[other.featId]?.classDcRank;
        if (up?.classId === grant.classId) rank = maxRank(rank, up.rank);
      }
      const dc = 10 + profBonus(rank, level, !!build.variantRules?.proficiencyWithoutLevel) + abilityMod(abilities[key]);
      secondaryClassDcs.push({ classId: grant.classId, name: cls.name, keyAbility: key, dc, rank });
    }
  }

  // Feat-granted casting PROFILES ("trained in occult spell attacks/DCs using Charisma") and extra
  // spell slots. Collected here; the profile is applied to the innate entry and the slot bonus to the
  // character's slot caster, both below.
  const spellcastingGrants: SpellcastingGrant[] = [];
  const spellSlotBonuses: SpellSlotBonus[] = [];
  for (const fc of feats) {
    const f = content.feats[fc.featId];
    if (f?.spellcastingGrant) spellcastingGrants.push(f.spellcastingGrant);
    if (f?.spellSlotBonus) spellSlotBonuses.push(f.spellSlotBonus);
  }
  for (const fid of ownedFeatureIds) {
    const cf = content.classFeatures[fid];
    if (cf?.spellcastingGrant) spellcastingGrants.push(cf.spellcastingGrant);
    if (cf?.spellSlotBonus) spellSlotBonuses.push(cf.spellSlotBonus);
  }
  // A HERITAGE can grant a casting profile too (Spellhorn Kobold: trained arcane, Charisma). Only
  // feats and class features were scanned, so the one heritage carrying it granted nothing.
  for (const hid of [build.heritageId, secondHeritageId]) {
    const h = hid ? content.heritages[hid] : undefined;
    if (h?.spellcastingGrant) spellcastingGrants.push(h.spellcastingGrant);
    if (h?.spellSlotBonus) spellSlotBonuses.push(h.spellSlotBonus);
  }
  // Invested items can grant extra slots too (Endless Grimoire, Sin Reservoir).
  for (const inv of build.inventory) {
    if (!inv.invested) continue;
    const it = content.items[inv.itemId];
    if (it?.spellSlotBonus) spellSlotBonuses.push(it.spellSlotBonus);
  }
  // Best rank per tradition wins (two feats granting the same tradition don't stack).
  spellcastingGrants.sort((a, b) => PROFICIENCY_RANKS.indexOf(b.proficiency) - PROFICIENCY_RANKS.indexOf(a.proficiency));
  // Extra spell slots ("+1 slot of each rank except your highest"). Applied to the already-built slot
  // caster: a spontaneous entry gains slot capacity, a prepared one gains empty prepared slots.
  let restrictedGroup = 0;
  for (const bonus of spellSlotBonuses) {
    const entry = bonus.entryId
      ? spellcasting.find((e) => e.id === bonus.entryId)
      : spellcasting.find((e) => e.type === 'spontaneous' || e.type === 'prepared');
    if (!entry) continue;
    // RESTRICTED slots live in their own list, never in `prepared`/`slots` — see RestrictedSlotGrant.
    if (bonus.restricted) {
      (entry.restrictedSlots ??= []).push(...resolveRestrictedSlots(bonus.restricted, entry, level, String(restrictedGroup++)));
      continue;
    }
    const add = (r: number, n: number) => {
      if (entry.slots?.[r]) entry.slots[r].max += n;
      // …and, when the record says so, CREATE the rank. The psychic's and animist's slot tables stop
      // at 9, so the three capstones granting a 10th-rank slot incremented a rank that did not exist
      // and vanished. A spontaneous entry needs the repertoire row too, or the slot has nothing that
      // can be put in it.
      else if (bonus.createRank && entry.slots) {
        entry.slots[r] = { max: n, used: 0 };
        if (entry.repertoire) entry.repertoire[r] ??= [];
      }
      if (entry.prepared?.[r]) entry.prepared[r].push(...Array.from({ length: n }, () => ({ spellId: null, expended: false })));
      else if (bonus.createRank && entry.prepared) {
        entry.prepared[r] = Array.from({ length: n }, () => ({ spellId: null, expended: false }));
      }
    };
    // SPECIFIC ranks ("two 4th-rank and one 3rd-rank") win over the per-rank spread. Without this
    // branch the four Rings of Wizardry — which all carry byRank — fell through to `perRank ?? 1`
    // with no exceptHighest, granting a slot at EVERY rank instead of the printed handful.
    if (bonus.byRank || bonus.byRankAt) {
      for (const [rank, n] of Object.entries(bonus.byRank ?? {})) {
        const r = Number(rank);
        if (Number.isFinite(r) && r > 0 && n > 0) add(r, n);
      }
      // Ranks that arrive later than the feat ("At 18th level, you also gain a 5th-rank slot").
      for (const step of bonus.byRankAt ?? []) {
        if (level < step.level) continue;
        for (const [rank, n] of Object.entries(step.byRank)) {
          const r = Number(rank);
          if (Number.isFinite(r) && r > 0 && n > 0) add(r, n);
        }
      }
      continue;
    }
    // A bonus that grants ONLY cantrips grants only cantrips. `perRank ?? 1` below defaults to one
    // slot at every rank, so Cantrip Expansion — one of the most-taken feats in the game — and
    // Cantrip Casting were each quietly handing their owner a whole extra slot at every rank they
    // could cast. The cantrip count itself is read by the builder's cantrip cap, not here.
    if (bonus.cantrips && bonus.perRank === undefined && !bonus.highestOnly) continue;
    const perRank = bonus.perRank ?? 1;
    const ranks = Object.keys(entry.slots ?? entry.prepared ?? {}).map(Number).filter((r) => r > 0).sort((a, b) => a - b);
    // "An extra spell slot of your highest rank." The rank moves with level, so byRank cannot say it
    // and perRank would grant one at EVERY rank instead of one at the top.
    if (bonus.highestOnly) {
      const top = ranks[ranks.length - 1];
      if (top != null) add(top, perRank);
      continue;
    }
    const eligible = bonus.exceptHighest ? ranks.slice(0, Math.max(0, ranks.length - bonus.exceptHighest)) : ranks;
    for (const r of eligible) add(r, perRank);
  }

  // Static data-warnings: an owned feat/heritage/feature/worn item whose effect references missing
  // (legacy) content — kept visible per the user's "keep it with a warning" call.
  for (const fc of feats) if (content.feats[fc.featId]?.dataWarning) effectWarnings.push({ source: content.feats[fc.featId].name, message: content.feats[fc.featId].dataWarning! });
  if (build.heritageId && content.heritages[build.heritageId]?.dataWarning) effectWarnings.push({ source: content.heritages[build.heritageId].name, message: content.heritages[build.heritageId].dataWarning! });
  for (const fid of ownedFeatureIds) if (content.classFeatures[fid]?.dataWarning) effectWarnings.push({ source: content.classFeatures[fid].name, message: content.classFeatures[fid].dataWarning! });
  for (const inv of build.inventory) if (content.items[inv.itemId]?.dataWarning) effectWarnings.push({ source: content.items[inv.itemId].name, message: content.items[inv.itemId].dataWarning! });
  // The BACKGROUND and the SECOND heritage were the two gaps in this collector — an authored warning
  // that never reaches the player is the same as no warning at all.
  if (background?.dataWarning) effectWarnings.push({ source: background.name, message: background.dataWarning });
  if (secondHeritageId && content.heritages[secondHeritageId]?.dataWarning) {
    effectWarnings.push({ source: content.heritages[secondHeritageId].name, message: content.heritages[secondHeritageId].dataWarning! });
  }
  // Items: the picked option's `passive` (item bonuses) is applied while the item is worn.
  for (const inv of build.inventory) {
    resolvePick(inv.itemId, content.items[inv.itemId]?.effectChoices, (g) => {
      if (!g.passive) return;
      const cur = (resolvedItemPassives[inv.itemId] ??= {});
      for (const [k, v] of Object.entries(g.passive)) {
        if (k === 'skills') cur.skills = { ...cur.skills, ...(v as Record<string, number>) };
        else if (Array.isArray(v)) (cur as Record<string, unknown[]>)[k] = [...((cur as Record<string, unknown[]>)[k] ?? []), ...v];
        else (cur as Record<string, unknown>)[k] = v;
      }
    }, content.items[inv.itemId]?.name ?? inv.itemId);
  }

  // Granted melee strikes from feats/heritage/ancestry/class features (Iruxi Fangs, Razortooth jaws,
  // …). Seeded with any WG-imported natural-attack names so a feat grant doesn't duplicate one the
  // import already produced; the rest are appended so they appear in Strikes (handwraps-buffed).
  const grantedNaturals = collectGrantedNaturals(
    content,
    feats,
    build.heritageId,
    build.ancestryId,
    build.classId,
    level,
    new Set((build.naturalAttacks ?? []).map((n) => n.name.toLowerCase())),
    build.inventory.filter((inv) => inv.invested).map((inv) => inv.itemId),
    build.subclassId,
  );
  const naturalAttacks = [...(build.naturalAttacks ?? []), ...grantedNaturals];

  // Caster archetype (multiclass into spellcasting): a caster Dedication + the Basic/Expert/Master
  // Spellcasting feats grant a separate prepared pool. When the CLASS isn't a slot caster the pool
  // reuses build.cantrips/build.spells (free on a non-caster). When the class IS itself a caster
  // (two casters — e.g. Wizard + Sorcerer Dedication) the second pool lives in build.archetypeSpells
  // so it never collides with the class pool. Entry id is dedication-based, so the two never clash.
  {
    const arch = activeCasterArchetype(feats.map((f) => f.featId));
    if (arch) {
      const twoCaster = !!cls?.spellcasting; // class already has its own pool → use the separate surface
      const src = twoCaster ? build.archetypeSpells : undefined;
      const srcCantrips = src?.cantrips ?? build.cantrips;
      const srcSpells = src?.spells ?? build.spells;
      const srcTradition = twoCaster ? src?.tradition ?? null : build.archetypeTradition ?? null;
      const srcKey = twoCaster ? src?.keyAbility ?? null : build.archetypeKeyAbility ?? null;
      const slots = archetypeSlots(level, arch);
      // "You gain a halcyon cantrip and a 1st-rank halcyon spell" (Shattered Sacrament, Cascade
      // Bearer's Spellcasting) — extra spells KNOWN in the archetype entry, not extra casts.
      //
      // These have to land BEFORE the entry is built. The generic slot applier runs ~200 lines later
      // and only raises `slots[r].max`; a spontaneous archetype's repertoire is sliced from `slots` at
      // construction, so a bonus arriving afterwards gave the character a slot with nothing that could
      // go in it. Folding it in here moves the pool and the known list together.
      // It also replaces a SECOND application that used to run after the entry was built. Applying
      // the same bonuses in both places double-granted, and that later pass had the cantrips-only
      // fall-through too.
      const archEntryId = `${arch.dedicationId}-casting`;
      let archCantripBonus = 0;
      for (const fc of feats) {
        const b = content.feats[fc.featId]?.spellSlotBonus;
        if (b?.entryId !== archEntryId) continue;
        archCantripBonus += b.cantrips ?? 0;
        const at = Object.keys(slots).map(Number).filter((r) => r > 0).sort((x, y) => x - y);
        if (b.byRank) {
          for (const [rank, n] of Object.entries(b.byRank)) {
            const r = Number(rank);
            if (Number.isFinite(r) && r > 0 && n > 0) slots[r] = (slots[r] ?? 0) + n;
          }
        } else if (b.highestOnly) {
          const top = at[at.length - 1];
          if (top != null) slots[top] += b.perRank ?? 1;
        } else if (b.perRank !== undefined || !b.cantrips) {
          // …and a cantrips-only bonus stops here: defaulting it to one slot per rank is what made
          // Cantrip Expansion silently generous.
          const eligible = b.exceptHighest ? at.slice(0, Math.max(0, at.length - b.exceptHighest)) : at;
          for (const r of eligible) slots[r] += b.perRank ?? 1;
        }
      }
      // Summoner: the tradition follows the chosen eidolon TYPE, not a free pick.
      const eidolonTradition = arch.config.eidolonTradition
        ? content.classes.summoner?.subclass?.options.find((o) => o.id === build.archetypeEidolonType)?.tradition
        : undefined;
      // Cascade Bearer's Spellcasting widens the halcyon list to divine and occult, so the offered
      // set is not the dedication's fixed one.
      const archTraditions = archetypeTraditionOptions(arch);
      const archTradition: Tradition =
        eidolonTradition ??
        (arch.config.choiceTradition
          ? archTraditions?.includes(srcTradition as Tradition)
            ? (srcTradition as Tradition)
            : srcTradition && !archTraditions
              ? srcTradition
              : arch.config.tradition
          : arch.config.tradition);
      // Key attribute: Magaambyan/Halcyon follow the tradition (arcane → Int, primal → Wis); psychic
      // lets you pick Int or Cha; else the dedication's fixed attribute.
      const archKey: AbilityId = arch.config.keyByTradition
        ? archTradition === 'primal'
          ? 'wis'
          : 'int'
        : arch.config.choiceKeyAbility && srcKey && arch.config.choiceKeyAbility.includes(srcKey)
          ? srcKey
          : arch.config.keyAbility;
      const baseEntry = {
        id: `${arch.dedicationId}-casting`,
        name: `${cap(archTradition)} spellcasting (archetype)`,
        tradition: archTradition,
        keyAbility: archKey,
        proficiency: archetypeProficiency(arch),
        cantrips: srcCantrips.slice(0, arch.config.cantrips + archCantripBonus),
        ...(arch.dedicationId === 'bloodrager-dedication'
          ? { note: 'Bloodrager: pick 2 cantrips (≥1 needing a spell attack). While you rage they gain the rage trait; casting one makes you drained 1 (reduce only via Harvest Blood).' }
          : {}),
      };
      if (arch.config.innateCantrip && !Object.keys(slots).length) {
        // Magaambyan Attendant: the chosen cantrip(s) are cast as innate spells — no spell slots.
        // Once Cascade Bearer's Spellcasting grants a 1st-rank halcyon slot the Attendant is a real
        // caster, and falls through to the spontaneous branch below, cantrips and all.
        spellcasting.push({ ...baseEntry, name: `${cap(archTradition)} innate (archetype)`, type: 'innate', repertoire: {} });
      } else if (arch.config.innateRanked) {
        // Captivator: one LEARNED spell of each unlocked rank, cast as an occult innate spell 1/day —
        // no slots at all, so `slots` is read only for which ranks the character has reached.
        const repertoire: Record<number, string[]> = {};
        for (const rankStr of Object.keys(slots)) {
          const rank = Number(rankStr);
          repertoire[rank] = (srcSpells[rank] ?? []).slice(0, 1);
        }
        // Captivating Intensity: "cast each occult innate spell granted by captivator archetype feats
        // one additional time per day … other than your two highest spell ranks". Cantrips are at-will
        // already, so only the ranked spells move, and only those below the top two ranks reached.
        const innateUses: Record<string, number> = {};
        if (feats.some((f) => f.featId === 'captivating-intensity')) {
          const ranks = Object.keys(repertoire).map(Number).sort((a, b) => b - a);
          const exempt = new Set(ranks.slice(0, 2));
          for (const [rankStr, ids] of Object.entries(repertoire)) {
            if (exempt.has(Number(rankStr))) continue;
            for (const id of ids) innateUses[id] = 2;
          }
        }
        spellcasting.push({
          ...baseEntry,
          name: `${cap(archTradition)} innate (archetype)`,
          type: 'innate',
          repertoire,
          ...(Object.keys(innateUses).length ? { innateUses } : {}),
        });
      } else if (arch.config.repertoire) {
        // Spontaneous archetype (sorcerer/bard/oracle/psychic/summoner/eldritch-archer/beast-gunner):
        // a known-spell repertoire + a 1-slot-per-rank pool. No signature spells (no class feature).
        const repertoire: Record<number, string[]> = {};
        const slotPool: Record<number, { max: number; used: number }> = {};
        for (const [rankStr, count] of Object.entries(slots)) {
          const rank = Number(rankStr);
          repertoire[rank] = (srcSpells[rank] ?? []).slice(0, count);
          slotPool[rank] = { max: count, used: 0 };
        }
        spellcasting.push({ ...baseEntry, type: 'spontaneous', repertoire, slots: slotPool });
      } else {
        const prepared: Record<number, { spellId: string | null; expended: boolean }[]> = {};
        for (const [rankStr, count] of Object.entries(slots)) {
          const rank = Number(rankStr);
          const chosen = srcSpells[rank] ?? [];
          prepared[rank] = Array.from({ length: count }, (_, i) => ({ spellId: chosen[i] ?? null, expended: false }));
        }
        spellcasting.push({ ...baseEntry, type: 'prepared', prepared });
      }
      /*
       * Slot bonuses that NAME this archetype entry are applied here, because the loop that applies
       * every other one runs before this entry exists — its `find` returned undefined and the bonus
       * was dropped. Exultant Blood Magic's "increase the spell slots you gain from the bloodrager
       * archetype feats by 1 for each spell rank" is the case that exposed it.
       *
       * Only entryId-targeted bonuses: an untargeted one belongs to the character's own class caster
       * and was already applied.
       */
      const archEntry = spellcasting.find((e) => e.id === baseEntry.id);
      // Repertoire and font grants have the SAME problem, for the same reason: their "final pass"
      // runs ~300 lines above this, so anything naming an archetype entry found nothing and was
      // dropped in silence.
      if (archEntry) {
        for (const { entryId, spells } of grantedRepertoireAdds) {
          if (entryId !== baseEntry.id) continue;
          for (const sid of spells) {
            const rank = content.spells[sid]?.rank ?? 1;
            const at = ((archEntry.grantedRepertoire ??= {})[rank] ??= []);
            if (!at.includes(sid)) at.push(sid);
          }
        }
        for (const { entryId, spells } of fontAdds) {
          if (entryId !== baseEntry.id || !archEntry.font) continue;
          archEntry.font.allowed = [...new Set([...(archEntry.font.allowed ?? []), ...spells])];
        }
      }
      // Slot bonuses aimed at this entry are applied BEFORE it is built (see `archCantripBonus`
      // above), so a spontaneous archetype's repertoire is sliced from the raised counts and the
      // extra slot has something that can go in it. Re-applying them here as well double-granted.
    }
  }

  // Magic-item spell sources: each carried staff / wand exposes its held spells as a read-only
  // 'items' spellcasting entry (cast using the wielder's spell DC; charges tracked on the item).
  {
    const caster = spellcasting.find((e) => e.type === 'prepared' || e.type === 'spontaneous');
    build.inventory.forEach((it, i) => {
      const item = content.items[it.itemId];
      if (!item) return;
      // A generic scroll/wand (item.spellSlot) holds the spell the player chose for this instance.
      const held =
        item.spellSlot && it.heldSpell && content.spells[it.heldSpell]
          ? { [item.spellSlot.rank]: [it.heldSpell] }
          : item.heldSpells;
      if (!held || !Object.keys(held).length) return;
      const tradCount: Record<string, number> = {};
      for (const ids of Object.values(held))
        for (const id of ids) for (const t of content.spells[id]?.traditions ?? []) tradCount[t] = (tradCount[t] ?? 0) + 1;
      const tradition = (Object.entries(tradCount).sort((a, b) => b[1] - a[1])[0]?.[0] as Tradition) ?? caster?.tradition ?? 'arcane';
      const repertoire: Record<number, string[]> = {};
      for (const [rankStr, ids] of Object.entries(held)) if (Number(rankStr) > 0) repertoire[Number(rankStr)] = ids;
      spellcasting.push({
        // `inv-${i}` matches the instanceId assigned to character.inventory[i] further below.
        id: `item:inv-${i}`,
        name: item.name,
        type: 'items',
        tradition,
        keyAbility: caster?.keyAbility ?? 'int',
        proficiency: caster?.proficiency ?? 'trained',
        cantrips: held[0] ?? [],
        repertoire,
        itemInstanceId: `inv-${i}`,
      });
    });

    // Innate spells granted by the heritage + taken feats (Seer Elf → detect magic, etc.) — one
    // pooled 'innate' entry (cantrips at-will, leveled spells 1/day), cast at the granted tradition.
    const innateGrants: InnateSpellGrant[] = [];
    // WHICH source granted each innate spell. The innate entry pools spells from the heritage, many
    // feats, and resolved choices, so the Spells page labels each one with where it came from.
    const innateSource: Record<string, string> = {};
    const noteSrc = (spellId: string, name?: string) => {
      if (name && !innateSource[spellId]) innateSource[spellId] = name;
    };
    const heritage = build.heritageId ? content.heritages[build.heritageId] : undefined;
    for (const g of heritage?.innateSpells ?? []) {
      innateGrants.push(g);
      noteSrc(g.spellId, heritage?.name);
    }
    // A handful of BACKGROUNDS grant an innate spell outright — Blessed gives Guidance, Astrological
    // Augur gives Augury. Only heritages and feats were read here, so those simply never appeared on
    // the Spells page no matter what the record said.
    const bgForSpells = resolveBackground(build, content);
    for (const g of bgForSpells?.innateSpells ?? []) {
      innateGrants.push(g);
      noteSrc(g.spellId, bgForSpells?.name);
    }
    // INVESTED items too — a Cloak of Elvenkind lets you cast Ghost Sound, a Nosoi Charm casts Sending
    // once a day. Invested (not merely owned), matching how an item's granted FEATS are already read.
    for (const inv of build.inventory) {
      if (!inv.invested) continue;
      const item = content.items[inv.itemId];
      for (const g of item?.innateSpells ?? []) {
        innateGrants.push(g);
        noteSrc(g.spellId, item?.name);
      }
    }
    for (const f of feats)
      for (const g of content.feats[f.featId]?.innateSpells ?? []) {
        innateGrants.push(g);
        noteSrc(g.spellId, content.feats[f.featId]?.name);
      }
    // Innate spells from a resolved effect-choice (e.g. Fey Influence's chosen 1/day spell).
    for (const g of chosenInnateGrants) {
      innateGrants.push(g);
      noteSrc(g.spellId, chosenInnateSource[g.spellId]);
    }
    // Pick-a-cantrip grants (Dragon Spit, Hag Magic, …): the player chose an innate spell from a list.
    for (const f of feats) {
      const spec = FEAT_CANTRIP_GRANTS[f.featId];
      const chosen = build.pickCantripChoices?.[f.featId];
      if (spec && chosen && spec.options.includes(chosen) && content.spells[chosen]) {
        innateGrants.push({ spellId: chosen });
        noteSrc(chosen, content.feats[f.featId]?.name);
      }
    }
    const seenInnate = new Set<string>();
    const innate = innateGrants.filter((g) => content.spells[g.spellId] && !seenInnate.has(g.spellId) && seenInnate.add(g.spellId));
    if (innate.length) {
      // A leveled innate is cast at the grant's rank when it names one — a rank override (Invisible
      // Trickster: 4th-rank Invisibility) or the "heightened to half your level" ladder — never below
      // the spell's base rank. Cantrips auto-heighten and ignore these.
      const castRank = (g: InnateSpellGrant): number => {
        const base = content.spells[g.spellId]?.rank ?? 0;
        if (base === 0) return 0;
        if (g.heightenHalfLevel) return Math.max(base, Math.ceil(level / 2));
        // A custom ladder ("8th at 18th level, 9th at 20th"): the highest step reached wins.
        const step = (g.heightenAt ?? []).filter((h) => level >= h.level).sort((a, b) => b.rank - a.rank)[0];
        return Math.max(base, step?.rank ?? g.rank ?? base);
      };
      const innateCantrips = innate.filter((g) => castRank(g) === 0).map((g) => g.spellId);
      const innateRep: Record<number, string[]> = {};
      // Per-spell daily uses for the Spells page: 0 = at-will (leveled at-will grants like Persistent
      // Creation), N = N/day; absent = the default 1/day.
      const innateUses: Record<string, number> = {};
      // Non-daily cadences ("twice per week") — display text per spell.
      const innateCadence: Record<string, string> = {};
      for (const g of innate) {
        const r = castRank(g);
        if (r > 0) {
          (innateRep[r] ??= []).push(g.spellId);
          if (g.atWill) innateUses[g.spellId] = 0;
          else if ((g.usesPerDay ?? 1) !== 1) innateUses[g.spellId] = g.usesPerDay as number;
          if (g.usesPer && g.usesPer !== 'day' && !g.atWill) innateCadence[g.spellId] = `${g.usesPerDay ?? 1}/${g.usesPer}`;
        }
      }
      const tc: Record<string, number> = {};
      for (const g of innate) {
        const t = g.tradition ?? content.spells[g.spellId]?.traditions?.[0];
        if (t) tc[t] = (tc[t] ?? 0) + 1;
      }
      const tradition = (Object.entries(tc).sort((a, b) => b[1] - a[1])[0]?.[0] as Tradition) ?? caster?.tradition ?? 'arcane';
      // A feat-granted casting PROFILE (Minor Magic: "trained in spell attacks/DCs using Charisma")
      // sets the innate entry's key attribute + rank; the class caster still wins if it is better.
      const profile = spellcastingGrants.find((g) => g.tradition === tradition) ?? spellcastingGrants[0];
      spellcasting.push({
        id: 'innate-casting',
        name: 'Innate spells',
        type: 'innate',
        tradition,
        keyAbility: caster?.keyAbility ?? profile?.keyAbility ?? 'cha',
        proficiency: maxRank(caster?.proficiency ?? 'untrained', profile?.proficiency ?? 'trained'),
        cantrips: innateCantrips,
        repertoire: innateRep,
        ...(Object.keys(innateUses).length ? { innateUses } : {}),
        ...(Object.keys(innateCadence).length ? { innateCadence } : {}),
        ...(Object.keys(innateSource).length ? { spellSources: innateSource } : {}),
      });
    }

    // Overrides → "Added spells": spells force-granted via the Overrides section, listed at the
    // chosen rank (cantrips at-will). Rituals are excluded here — they show in the Rituals section.
    const addedSpells = (build.overrides?.addedSpells ?? []).filter((a) => content.spells[a.spellId] && !content.spells[a.spellId].ritual);
    if (addedSpells.length) {
      const addedCantrips: string[] = [];
      const addedRep: Record<number, string[]> = {};
      for (const a of addedSpells) {
        const r = a.rank ?? content.spells[a.spellId]?.rank ?? 0;
        if (r <= 0) addedCantrips.push(a.spellId);
        else (addedRep[r] ??= []).push(a.spellId);
      }
      const atc: Record<string, number> = {};
      for (const a of addedSpells) for (const t of content.spells[a.spellId]?.traditions ?? []) atc[t] = (atc[t] ?? 0) + 1;
      const addedTradition = (Object.entries(atc).sort((x, y) => y[1] - x[1])[0]?.[0] as Tradition) ?? caster?.tradition ?? 'arcane';
      spellcasting.push({
        id: 'added-spells',
        name: 'Added spells',
        type: 'innate',
        tradition: addedTradition,
        keyAbility: caster?.keyAbility ?? 'cha',
        proficiency: caster?.proficiency ?? 'trained',
        cantrips: addedCantrips,
        repertoire: addedRep,
      });
    }
  }

  // Items a record HANDS the character. Collected here so the inventory emission below stays a
  // single expression; the record that gave it is kept so the sheet can say where it came from.
  const grantedItems: { itemId: string; quantity?: number; invested?: boolean; source: string }[] = [];
  for (const fc of feats) {
    for (const g of content.feats[fc.featId]?.grantsItems ?? []) {
      if (!content.items[g.itemId] || grantedItems.some((x) => x.itemId === g.itemId)) continue;
      grantedItems.push({ ...g, source: content.feats[fc.featId].name });
    }
  }

  // RETUNE an entry that already exists. Its tradition and key attribute come from whatever granted
  // it, and nothing could change them afterwards — so Ancestral Mind ("the spell's tradition becomes
  // occult … and you can use your psychic spellcasting attribute modifier instead of Charisma") left
  // the innate entry exactly as it was. Applied last, over the finished list.
  for (const fc of feats) {
    for (const rt of content.feats[fc.featId]?.entryRetune ?? []) {
      const target = spellcasting.find((e) => (rt.scope === 'innate' ? e.type === 'innate' : e.id === rt.scope));
      if (!target) continue;
      if (rt.tradition) target.tradition = rt.tradition;
      if (rt.keyAbility) target.keyAbility = rt.keyAbility;
      // "your PSYCHIC spellcasting attribute" — a psychic's is not fixed, so it is read off that
      // class's own entry rather than named. No such entry ⇒ nothing changes.
      if (rt.keyAbilityFromClass) {
        // Class entries are keyed `<classId>-casting`.
        const src = spellcasting.find((e) => e.id === `${rt.keyAbilityFromClass}-casting`);
        if (src) target.keyAbility = src.keyAbility;
      }
    }
  }

  // Resolve the subclass + extra-choice picks (bloodline, ikons, apparitions, …) for
  // display on the sheet, so the choices are visible character abilities.
  // Typed off Character so the row shape cannot drift from what the sheet renders — a local literal
  // is what silently dropped `descRefs` and left 1,199 cross-reference links dead.
  const classChoices: NonNullable<Character['classChoices']> = [];
  if (cls?.subclass && subOption)
    classChoices.push({ group: cls.subclass.name, name: subOption.name, description: subOption.description, level: 1, id: subOption.id, descRefs: subOption.descRefs });
  // Dual Class: also record the second class's subclass.
  if (cls2?.subclass && subOption2)
    classChoices.push({ group: cls2.subclass.name, name: subOption2.name, description: subOption2.description, level: 1, id: subOption2.id, descRefs: subOption2.descRefs });
  // Extra-choice picks from BOTH classes (element/apparition/subconscious-mind/bloodline/…). The id
  // rides along so the sheet can treat a pick as an OWNED class feature rather than a display row —
  // that is what makes a thaumaturge's chosen implement or an exemplar's ikon actually do something.
  for (const ec of [cls, cls2] as (ClassDef | undefined)[]) {
    for (const g of ec?.extraChoices ?? []) {
      const picks = build.extraChoices?.[g.id] ?? [];
      for (let i = 0; i < picks.length; i++) {
        const o = g.options.find((opt) => opt.id === picks[i]);
        // The level of the SLOT, not of the group: a thaumaturge's second implement arrives at 5 and
        // the third at 15, so stamping every pick with the group's entry level would make them all
        // count as owned from level 1.
        if (o) classChoices.push({ group: g.name, name: o.name, description: o.description, level: extraPickLevel(g, i), id: o.id, descRefs: o.descRefs });
      }
    }
  }

  // Thaumaturge implement BENEFITS. Each implement grants its initiate benefit when you gain it;
  // Implement Adept (7) unlocks the adept benefit of one implement and Second Adept (11) the other of
  // your first two; Implement Paragon (17) unlocks a paragon benefit on one that already has adept.
  // They ride in classChoices so they are owned features (and visible abilities) with no new plumbing.
  if (ownsClass('thaumaturge')) {
    const impGroup = [cls, cls2].find((x) => x?.id === 'thaumaturge')?.extraChoices?.find((g) => g.id === 'implement');
    const imps = build.extraChoices?.['implement'] ?? [];
    const pushBenefit = (tier: 'initiate' | 'adept' | 'paragon', imp: string, level: number) => {
      const rec = content.classFeatures[`${tier}-benefit-${imp}`];
      if (rec && !classChoices.some((x) => x.id === rec.id)) {
        classChoices.push({ group: 'Implement benefit', name: rec.name, description: rec.description, level, id: rec.id, descRefs: rec.descRefs });
      }
    };
    if (impGroup) for (let i = 0; i < imps.length; i++) pushBenefit('initiate', imps[i], extraPickLevel(impGroup, i));
    // Adept: the level-7 pick (defaulting to your first implement), then the other of the first two.
    const firstTwo = imps.slice(0, 2);
    const adept7 = firstTwo.includes(build.implementAdept ?? '') ? build.implementAdept! : firstTwo[0];
    if (adept7) pushBenefit('adept', adept7, 7);
    const adept11 = firstTwo.find((x) => x !== adept7);
    if (adept11) pushBenefit('adept', adept11, 11);
    // Intense Implement is the ONE thing that changes the line below: "You have an exceptional link
    // to your third implement. You gain the adept benefit for your third implement." Without it the
    // third implement never gains adept, which is why the feat delivered nothing.
    const third = imps[2];
    if (third && takenFeats.has('intense-implement')) pushBenefit('adept', third, content.feats['intense-implement']?.level ?? 9);
    // Paragon: one that already has adept — never the third implement UNLESS Intense Implement gave
    // it one, which is exactly what that feat is for.
    const adeptSet = [adept7, adept11, ...(third && takenFeats.has('intense-implement') ? [third] : [])].filter(Boolean) as string[];
    const paragon = adeptSet.includes(build.implementParagon ?? '') ? build.implementParagon! : adeptSet[0];
    if (paragon) pushBenefit('paragon', paragon, 17);
  }

  // Commander tactics: validate the chosen folio against the unlocked tiers + folio capacity.
  let commanderTactics: CommanderTactics | undefined;
  if (ownsClass('commander')) {
    const maxTier = commanderMaxTier(level);
    const maxRank = TACTIC_TIER_RANK[maxTier];
    // Tactical Expansion adds two and is repeatable; the formula alone could not be influenced.
    const folioMax = applyCounterMods('commander-folio', commanderFolioMax(level), feats.map((f) => f.featId));
    const folio = (build.commanderTactics ?? [])
      .filter((id) => {
        const a = content.actions[id];
        return a?.traits?.includes('tactic') && TACTIC_TIER_RANK[(a.tacticTier ?? 'basic') as TacticTier] <= maxRank;
      })
      .slice(0, folioMax);
    // "Increase the number of tactics you can have prepared by 1" (Efficient Preparation) — this was
    // an unconditional 3, so the feat's entire content never arrived. It is repeatable.
    const preparedBonus = feats.reduce((n, fc) => n + (content.feats[fc.featId]?.preparedTacticsBonus ?? 0), 0);
    commanderTactics = { folio, folioMax, preparedMax: 3 + preparedBonus, squadmates: 2 + abilityMod(abilities.int), maxTier };
  }

  // Inventor: resolve the innovation type + the tiered modification picks (each validated against the
  // options legal for that tier/innovation, and gated by level so breakthrough@7 / revolutionary@15
  // only count once reached). Construct innovation has no modification items, so it resolves empty.
  let inventor: InventorBuild | undefined;
  const invType = ownsClass('inventor') ? innovationType(subclassOf('inventor')) : undefined;
  if (invType) {
    const armorStats = invType === 'armor' ? build.inventorArmorStats ?? 'power-suit' : undefined;
    const validPick = (pick: string | null | undefined, tier: InventorTier): string | undefined => {
      if (!pick || level < INVENTOR_TIER_LEVEL[tier]) return undefined;
      return inventorModificationOptions(content, invType, armorStats, INVENTOR_TIER_LEVEL[tier]).some((o) => o.id === pick)
        ? pick
        : undefined;
    };
    const modifications: InventorBuild['modifications'] = {};
    const init = validPick(build.inventorModifications?.initial, 'initial');
    if (init) modifications.initial = init;
    const brk = validPick(build.inventorModifications?.breakthrough, 'breakthrough');
    if (brk) modifications.breakthrough = brk;
    const rev = validPick(build.inventorModifications?.revolutionary, 'revolutionary');
    if (rev) modifications.revolutionary = rev;
    inventor = { innovationType: invType, ...(armorStats ? { armorStats } : {}), modifications };
  }

  // Kineticist: resolve the effective elements (gate picks + Fork the Path) for the Elemental Blast strike.
  const kineticist =
    ownsClass('kineticist')
      ? {
          elements: kineticistElements(build, level).map((id) => id.replace(/-gate$/, '')),
          // "Choose one of your kinetic elements AND A DAMAGE TYPE LISTED FOR THAT ELEMENT" — the
          // player's answer per element. Absent entries fall back to the element's first printed type.
          ...(build.blastTypes && Object.keys(build.blastTypes).length ? { blastTypes: build.blastTypes } : {}),
        }
      : undefined;

  // Override: features force-granted via Overrides — materialized for the Feats & Features list (any
  // class feature, regardless of class). buildCharacter doesn't re-validate, so any id is accepted.
  const grantedFeatures: NonNullable<Character['grantedFeatures']> = [];
  for (const g of build.overrides?.addedFeatures ?? []) {
    const f = content.classFeatures[g.featureId];
    if (!f) continue;
    grantedFeatures.push({
      featureId: g.featureId,
      name: f.name,
      level: g.level,
      description: f.description,
      ...(f.descRefs ? { descRefs: f.descRefs } : {}),
      traits: f.traits ?? [],
      ...(f.actionCost ? { actionCost: f.actionCost } : {}),
      ...(f.rarity ? { rarity: f.rarity } : {}),
    });
  }
  // Mythic Calling: grant the chosen calling's feature (a [calling]-trait classFeature) for display.
  if (build.mythicEnabled && build.mythicCalling) {
    const f = content.classFeatures[build.mythicCalling];
    if (f)
      grantedFeatures.push({
        featureId: build.mythicCalling,
        name: f.name,
        level: 1,
        description: f.description,
        ...(f.descRefs ? { descRefs: f.descRefs } : {}),
        traits: f.traits ?? [],
        ...(f.actionCost ? { actionCost: f.actionCost } : {}),
        ...(f.rarity ? { rarity: f.rarity } : {}),
      });
  }

  // Max-HP feats (Toughness = +level, Thick Hide Mask = +20, …) raise maximum HP, and a freshly built
  // character starts at full HP — so fold them into the starting `current` to match deriveMaxHp().
  // Otherwise initialPlay would record the difference as phantom damage (e.g. a new Fighter shows 58/63).
  let featHp = 0;
  for (const f of feats) {
    const b = content.feats[f.featId]?.maxHpBonus;
    if (b) featHp += (b.perLevel ?? 0) * level + (b.flat ?? 0);
  }

  return {
    id: `char-${slug(build.name)}`,
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    name: build.name.trim() || 'New character',
    level,
    xp: 0,
    ancestryId: build.ancestryId,
    heritageId: build.heritageId,
    ...(secondHeritageId ? { secondHeritageId } : {}),
    heritageResistanceChoice: build.heritageResistanceChoice ?? null,
    backgroundId: build.backgroundId,
    classId: build.classId,
    subclassId: build.subclassId,
    ...(classChoices.length ? { classChoices } : {}),
    ...(build.variantRules ? { variantRules: build.variantRules } : {}),
    ...(build.options ? { options: build.options } : {}),
    ...(build.pinnedDescs && build.pinnedDescs.length ? { pinnedDescs: build.pinnedDescs } : {}),
    ...(build.overrides ? { overrides: build.overrides } : {}),
    ...(build.enabledSources ? { enabledSources: build.enabledSources } : {}),
    ...(build.campaignIds && build.campaignIds.length ? { campaignIds: build.campaignIds } : {}),
    ...(build.mythicEnabled ? { mythicEnabled: true } : {}),
    ...(build.kingmakerEnabled ? { kingmakerEnabled: true } : {}),
    ...(build.hideLegacy ? { hideLegacy: true } : {}),
    ...(build.mythicEnabled && build.mythicCalling ? { mythicCalling: build.mythicCalling } : {}),
    ...(grantedFeatures.length ? { grantedFeatures } : {}),
    ...(naturalAttacks.length ? { naturalAttacks } : {}),
    ...(build.variantRules?.dualClass && build.classId2 ? { classId2: build.classId2, subclassId2: build.subclassId2 ?? null } : {}),
    ...(build.variantRules?.abp && build.abpSkills && Object.keys(build.abpSkills).length ? { abpSkills: build.abpSkills } : {}),
    ...(build.variantRules?.abp && build.abpApex ? { abpApex: build.abpApex } : {}),
    keyAbility,
    abilities,
    partialBoosts,
    proficiencies,
    hitPoints: { current: hpMax + featHp, temp: 0 },
    heroPoints: 1,
    ...(focus ? { focus } : {}),
    ...(advancedAlchemy ? { advancedAlchemy } : {}),
    ...(resourceFloors ? { resourceFloors } : {}),
    ...(dyingThreshold ? { dyingThreshold } : {}),
    ...(spellListAdditions ? { spellListAdditions } : {}),
    ...(investedBonus ? { investedLimit: 10 + investedBonus } : {}),
    ...(restRecovery ? { restRecovery } : {}),
    conditions: [],
    classResources: initialClassResources(
      build.classId,
      level,
      {
        str: abilityMod(abilities.str),
        dex: abilityMod(abilities.dex),
        con: abilityMod(abilities.con),
        int: abilityMod(abilities.int),
        wis: abilityMod(abilities.wis),
        cha: abilityMod(abilities.cha),
      },
      new Set(feats.map((f) => f.featId)),
    ),
    languages: (() => {
      const granted = ancestry?.languages.granted ?? [];
      const invested = (build.inventory ?? []).filter((inv) => inv.invested).map((inv) => inv.itemId);
      const slots =
        Math.max(0, abilityMod(abilities.int)) +
        (ancestry?.languages.additional ?? 0) +
        // "You learn three new languages of your choice" — a record widening the pick budget. The
        // picks themselves live in the same list the Int slots use, so the existing picker serves both.
        recordLanguageSlots(content, feats.map((fc) => fc.featId), build.heritageId, invested, proficiencies.skills, level);
      const bonus = build.languages.filter((l) => !granted.includes(l)).slice(0, slots);
      // Languages granted outright by feats/heritage (fixed grants) and invested items (Stole of
      // Civility). These are on top of the Int/ancestry slot budget, like the override-added ones.
      const featLangs = feats.flatMap((fc) => content.feats[fc.featId]?.grantsLanguages ?? []);
      const heritageLangs = [build.heritageId, secondHeritageId].flatMap((id) =>
        id ? content.heritages[id]?.grantsLanguages ?? [] : [],
      );
      const itemLangs = (build.inventory ?? [])
        .filter((inv) => inv.invested)
        .flatMap((inv) => content.items[inv.itemId]?.passiveEffects?.grantsLanguages ?? []);
      return [...new Set([...granted, ...bonus, ...featLangs, ...heritageLangs, ...itemLangs, ...(build.overrides?.addedLanguages ?? [])])];
    })(),
    feats,
    skillIncreases,
    ...(skillFallbacks.length ? { skillFallbacks } : {}),
    ...(archSuppressed.size || archAddedFeatures.length || archNotes.length
      ? { classArchetype: { ...(archClassId ? { classId: archClassId } : {}), suppressedFeatures: [...archSuppressed], addedFeatures: archAddedFeatures, notes: archNotes } }
      : {}),
    ...(Object.keys(chosenEffects).length ? { chosenEffects } : {}),
    ...(Object.keys(resolvedItemPassives).length ? { resolvedItemPassives } : {}),
    ...(effectWarnings.length ? { effectWarnings } : {}),
    ...(effectPicks.length ? { effectPicks } : {}),
    ...(secondaryClassDcs.length ? { secondaryClassDcs } : {}),
    ...(() => {
      // Body size (ancestry, raised by any feat/heritage sizeOverride — largest wins) + natural reach.
      const SIZE_ORDER = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
      const ancSize = (ancestry?.size as (typeof SIZE_ORDER)[number]) ?? 'medium';
      let size = ancSize;
      let reach = 5;
      const consider = (
        g: { sizeOverride?: (typeof SIZE_ORDER)[number]; sizeSet?: (typeof SIZE_ORDER)[number]; reach?: number } | undefined,
      ) => {
        // `sizeSet` is absolute and may LOWER — "Instead of Large, your size is Medium". Nothing else
        // could shrink a character, because sizeOverride is strictly largest-wins.
        if (g?.sizeSet) size = g.sizeSet;
        else if (g?.sizeOverride && SIZE_ORDER.indexOf(g.sizeOverride) > SIZE_ORDER.indexOf(size)) size = g.sizeOverride;
        if (g?.reach && g.reach > reach) reach = g.reach;
      };
      for (const fc of feats) consider(content.feats[fc.featId]);
      if (build.heritageId) consider(content.heritages[build.heritageId]);
      if (secondHeritageId) consider(content.heritages[secondHeritageId]);
      // Emit when the size differs from the ANCESTRY's as well as when it is not medium: a jotunborn
      // lowered to Medium must record it, or the sheet falls back to the ancestry's Large.
      return { ...(size !== 'medium' || size !== ancSize ? { size } : {}), ...(reach !== 5 ? { reach } : {}) };
    })(),
    ...(commanderTactics ? { commanderTactics } : {}),
    ...(inventor ? { inventor } : {}),
    ...(kineticist?.elements.length ? { kineticist } : {}),
    // Deterministic instanceIds (index-based) so buildCharacter stays pure across renders.
    inventory: [
      ...build.inventory.map((it, i) => ({
        instanceId: `inv-${i}`,
        itemId: it.itemId,
        quantity: Math.max(1, it.quantity),
        worn: it.worn,
        equipped: it.equipped,
        ...(it.invested !== undefined ? { invested: it.invested } : {}),
        ...(it.containerInstanceId !== undefined ? { containerInstanceId: it.containerInstanceId } : {}),
        ...(it.runes ? { runes: it.runes } : {}),
        ...(it.charges ? { charges: it.charges } : {}),
        ...(it.heldSpell ? { heldSpell: it.heldSpell } : {}),
        ...(it.designations?.length ? { designations: it.designations } : {}),
      })),
      // Items a record HANDS you ("You gain a Razmiri mask"). Nothing put an item in the inventory,
      // so a feat whose benefit IS an item delivered nothing. Skipped when the player already
      // carries one — a granted item must not duplicate a bought one — and it costs no gold, since
      // the wealth line below is computed from `build.inventory` alone.
      ...grantedItems
        .filter((g) => !build.inventory.some((it) => it.itemId === g.itemId))
        .map((g, i) => ({
          instanceId: `granted-${i}`,
          itemId: g.itemId,
          quantity: Math.max(1, g.quantity ?? 1),
          worn: false,
          equipped: false,
          ...(g.invested !== undefined ? { invested: g.invested } : {}),
          grantedBy: g.source,
        })),
    ],
    currency: cpToCoins(
      startingWealthGp(level) * 100 -
        build.inventory.reduce((cp, it) => cp + coinsToCp(content.items[it.itemId]?.price) * Math.max(1, it.quantity), 0),
    ),
    spellcasting,
    details: build.deityId ? { deityId: build.deityId } : {},
    ...(build.backgroundId === CUSTOM_BACKGROUND_ID && build.customBackground
      ? { customBackground: build.customBackground }
      : {}),
    notes: [],
    ...((() => {
      // A Summoner-Dedication archetype gains an eidolon (its type sets the spell tradition); inject it
      // as a companion so the stat block renders, mirroring the summoner class's auto-eidolon.
      const comps = [...(build.companions ?? [])];
      if (
        feats.some((f) => f.featId === 'summoner-dedication') &&
        build.archetypeEidolonType &&
        !comps.some((c) => c.kind === 'eidolon')
      ) {
        comps.push({ id: 'eidolon-archetype', kind: 'eidolon', name: '', typeId: build.archetypeEidolonType });
      }
      return comps.length ? { companions: comps } : {};
    })()),
  };
}

/**
 * Locate the PRIMARY class's spellcasting entry inside a finished character, tolerant of a
 * non-canonical entry id. buildCharacter tags the primary caster `${cls.id}-casting`, but imported
 * characters / hand-authored data / the old seed may carry a different id (e.g. `cleric-divine`).
 * Matching by exact id alone silently drops all of that character's spells on the next rebuild, so
 * we fall back to a structural match: the entry whose type equals the class's spellcasting type,
 * excluding entries that are provably NOT the primary class pool — the caster-archetype pool
 * (`-dedication-casting`), focus spells, the animist apparition pool, and (Dual Class) the second
 * class's own caster entry.
 */
function findPrimaryCasterEntry(c: Character, cls: ClassDef, cls2?: ClassDef): SpellcastingEntry | undefined {
  const exact = c.spellcasting.find((e) => e.id === `${cls.id}-casting`);
  if (exact) return exact;
  if (!cls.spellcasting) return undefined;
  const wantType = cls.spellcasting.type; // 'prepared' | 'spontaneous'
  const secondId = cls2 ? `${cls2.id}-casting` : undefined;
  const candidates = c.spellcasting.filter(
    (e) =>
      e.type === wantType &&
      e.type !== 'focus' &&
      !e.id.endsWith('-dedication-casting') &&
      e.id !== 'animist-apparition-casting' &&
      e.id !== secondId,
  );
  // Prefer a spellbook/repertoire/prepared-bearing entry over an empty stub; else the first match.
  return candidates.find((e) => e.spellbook || e.repertoire || e.prepared) ?? candidates[0];
}

/**
 * Dual Class mirror of findPrimaryCasterEntry: locate the SECOND class's spellcasting entry,
 * tolerant of a non-canonical entry id (imported / hand-authored dual-class characters). Prefers the
 * canonical id `${cls2.id}-casting`; otherwise falls back to a structural match on the second class's
 * spellcasting type, EXCLUDING the entries that belong to the primary class or an archetype so the two
 * class pools never claim each other's spells. Without this fallback, a dual-class character imported
 * with a differently-named second-caster entry would silently lose its whole second class's spells on
 * the next builder rebuild (the primary already uses findPrimaryCasterEntry for the same reason).
 */
function findSecondCasterEntry(c: Character, cls2: ClassDef, cls1?: ClassDef): SpellcastingEntry | undefined {
  const exact = c.spellcasting.find((e) => e.id === `${cls2.id}-casting`);
  if (exact) return exact;
  if (!cls2.spellcasting) return undefined;
  const wantType = cls2.spellcasting.type; // 'prepared' | 'spontaneous'
  const primaryId = cls1 ? `${cls1.id}-casting` : undefined;
  // The primary caster is resolved first (findPrimaryCasterEntry); exclude whatever entry object it
  // claimed so the second class never re-selects the same pool even when both share a type and neither
  // uses the canonical id. Also exclude archetype/apparition pools, focus, and the primary's canonical id.
  const primaryEntry = cls1 ? findPrimaryCasterEntry(c, cls1, cls2) : undefined;
  const candidates = c.spellcasting.filter(
    (e) =>
      e !== primaryEntry &&
      e.type === wantType &&
      e.type !== 'focus' &&
      !e.id.endsWith('-dedication-casting') &&
      e.id !== 'animist-apparition-casting' &&
      e.id !== primaryId,
  );
  return candidates.find((e) => e.spellbook || e.repertoire || e.prepared) ?? candidates[0];
}

/**
 * Reverse of buildCharacter — reconstruct an editable BuildState from a finished Character, so
 * ANY character (including hand-authored seeds with no stored build) can be reopened in the
 * builder and leveled up. Rebuilding from the result reproduces an EQUIVALENT character (same
 * abilities, proficiencies, feats, skills, spells, gear) — it does not necessarily recover the
 * player's exact original menu choices. In-play state (HP, conditions, …) isn't part of a build;
 * the edit flow preserves it separately (see playForRebuild).
 */
export function deriveBuildFromCharacter(c: Character, content: ContentDatabase): BuildState {
  const ABIL: AbilityId[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const b = emptyBuild();
  b.name = c.name;
  b.level = c.level;
  b.ancestryId = c.ancestryId;
  b.heritageId = c.heritageId;
  b.backgroundId = c.backgroundId;
  b.classId = c.classId;
  b.subclassId = c.subclassId ?? null;
  if (c.variantRules) b.variantRules = { ...c.variantRules };
  if (c.pinnedDescs?.length) b.pinnedDescs = c.pinnedDescs.map((d) => ({ ...d }));
  if (c.options) b.options = { ...c.options };
  if (c.overrides) b.overrides = JSON.parse(JSON.stringify(c.overrides)) as BuildOverrides;
  if (c.enabledSources) b.enabledSources = [...c.enabledSources];
  if (c.campaignIds?.length) b.campaignIds = [...c.campaignIds];
  if (c.mythicEnabled) b.mythicEnabled = true;
  if (c.mythicCalling) b.mythicCalling = c.mythicCalling;
  if (c.kingmakerEnabled) b.kingmakerEnabled = true;
  if (c.naturalAttacks?.length) {
    // Keep only user/WG-imported attacks in the build — feat/feature-granted ones are re-derived on
    // every build, so subtract them here to stay idempotent (no double-count on round-trip).
    const grantedNames = new Set(
      // Must subtract exactly what the build ADDS, subclass included, or a subclass-granted Strike
      // round-trips into a manually-added one and then appears twice.
      collectGrantedNaturals(content, c.feats ?? [], c.heritageId, c.ancestryId, c.classId, c.level, new Set(), [], c.subclassId).map((g) =>
        g.name.toLowerCase(),
      ),
    );
    const kept = c.naturalAttacks.filter((na) => !grantedNames.has(na.name.toLowerCase())).map((na) => ({ ...na }));
    if (kept.length) b.naturalAttacks = kept;
  }
  if (c.classId2 !== undefined) b.classId2 = c.classId2;
  if (c.subclassId2 !== undefined) b.subclassId2 = c.subclassId2;
  if (c.abpSkills) b.abpSkills = { ...c.abpSkills };
  if (c.abpApex !== undefined) b.abpApex = c.abpApex;
  b.keyAbility = c.keyAbility;
  b.deityId = c.details?.deityId ?? null;
  if (c.customBackground) b.customBackground = c.customBackground;
  b.companions = c.companions ? structuredClone(c.companions) : [];
  b.inventory = c.inventory.map((it) => ({
    itemId: it.itemId,
    quantity: it.quantity,
    ...(it.worn !== undefined ? { worn: it.worn } : {}),
    ...(it.equipped !== undefined ? { equipped: it.equipped } : {}),
    ...(it.invested !== undefined ? { invested: it.invested } : {}),
    ...(it.containerInstanceId !== undefined ? { containerInstanceId: it.containerInstanceId } : {}),
    ...(it.runes ? { runes: it.runes } : {}),
    ...(it.charges ? { charges: it.charges } : {}),
    ...(it.heldSpell ? { heldSpell: it.heldSpell } : {}),
    ...(it.designations?.length ? { designations: it.designations } : {}),
  }));
  // Native/lossless path: the character carries its own skillIncreases — trust them verbatim so a
  // native round-trip stays exact. When they're absent or under-count the final ranks (imported /
  // hand-authored characters that only recorded final ranks), the Skills block below SYNTHESIZES the
  // missing increases so the builder's skill-increase slots are populated and ranks survive a rebuild.
  for (const si of c.skillIncreases ?? []) b.skillIncreases[si.level] = si.skill;

  const ancestry = c.ancestryId ? content.ancestries[c.ancestryId] : undefined;
  const cls = c.classId ? content.classes[c.classId] : undefined;
  // Dual Class: a subsystem owned by class `id` may live on the second class.
  const cls2dc = c.variantRules?.dualClass && c.classId2 ? content.classes[c.classId2] : undefined;
  const dcOwns = (id: string): boolean => c.classId === id || (!!c.variantRules?.dualClass && c.classId2 === id);
  const dcDef = (id: string): ClassDef | undefined => (c.classId === id ? cls : cls2dc?.id === id ? cls2dc : undefined);
  const background = resolveBackground(b, content);

  // extraChoices: recover from classChoices. Prefer the stored `id`; fall back to matching by NAME
  // for characters saved before the id was recorded (two options in different groups can share a
  // name, hence the group check on the fallback path).
  for (const ec of [cls, cls2dc] as (ClassDef | undefined)[]) {
    if (!ec) continue;
    for (const cc of c.classChoices ?? []) {
      if (ec.subclass && cc.group === ec.subclass.name) continue;
      const g = (ec.extraChoices ?? []).find((gg) => gg.name === cc.group);
      const o = g?.options.find((opt) => (cc.id ? opt.id === cc.id : opt.name === cc.name));
      if (g && o && !(b.extraChoices[g.id] ?? []).includes(o.id)) (b.extraChoices[g.id] ??= []).push(o.id);
    }
  }

  // Grant options (both classes' subclasses + extra choices) — used to subtract granted skills/spells.
  const grantOptions: SubclassOption[] = [];
  if (cls?.subclass) {
    const sub = cls.subclass.options.find((o) => o.id === b.subclassId);
    if (sub) grantOptions.push(sub);
  }
  if (cls2dc?.subclass) {
    const sub2 = cls2dc.subclass.options.find((o) => o.id === b.subclassId2);
    if (sub2) grantOptions.push(sub2);
  }
  for (const ec of [cls, cls2dc] as (ClassDef | undefined)[]) {
    for (const g of ec?.extraChoices ?? []) {
      for (const id of b.extraChoices[g.id] ?? []) {
        const o = g.options.find((opt) => opt.id === id);
        if (o) grantOptions.push(o);
      }
    }
  }
  // Recover option-granted choice-feat traits (Dominion Epithet → Energized Spark energy type).
  for (const o of grantOptions)
    for (const gcf of o.grantedChoiceFeats ?? []) {
      const fc = c.feats.find((f) => f.featId === gcf.featId && f.choice?.value);
      if (fc?.choice) (b.grantedChoiceFeatTraits ??= {})[`grant:${o.id}:${gcf.featId}`] = fc.choice.value;
    }

  // Abilities: synthesize boost selections that reproduce the final scores + partial flags.
  // Each ability's final score depends only on its flaw count and its TOTAL boost count
  // (flaws all precede boosts; boosts are per-ability), so we solve the per-ability free-boost
  // count and place those counts legally across the boost events — any legal placement that
  // matches the counts reproduces the scores and the partial-boost flags exactly.
  {
    const flawCount: Partial<Record<AbilityId, number>> = {};
    const fixedCount: Partial<Record<AbilityId, number>> = {};
    const altBoosts = !!c.options?.alternateAncestryBoosts;
    // Alternate Ancestry Boosts replaces the ancestry's fixed boosts + flaws with two free boosts.
    if (!altBoosts) {
      for (const a of ancestry?.abilityFlaws ?? []) flawCount[a] = (flawCount[a] ?? 0) + 1;
      for (const a of ancestry ? fixedBoosts(ancestry.abilityBoosts) : []) fixedCount[a] = (fixedCount[a] ?? 0) + 1;
    }
    // Voluntary Flaw — an extra flaw the player took (the chosen attribute).
    if (c.options?.voluntaryFlaw && c.options.voluntaryFlawAbility)
      flawCount[c.options.voluntaryFlawAbility] = (flawCount[c.options.voluntaryFlawAbility] ?? 0) + 1;
    for (const a of background ? fixedBoosts(background.abilityBoosts) : []) fixedCount[a] = (fixedCount[a] ?? 0) + 1;
    const key = subclassKeyAbility(b, content) ?? b.keyAbility ?? cls?.keyAbility[0];
    if (key) fixedCount[key] = (fixedCount[key] ?? 0) + 1;
    // ABP apex (L17) is applied AFTER ordinary boosts as an apex-item effect ("raise to 18, or +2 if
    // already 18+"), so it's not a fixed +2/+1 boost — fold it into the score the ordinary boosts must
    // reach (apexOf) so the level-boost reconstruction counts only the real boosts.
    const apexAbility = c.variantRules?.abp && c.level >= 17 && c.abpApex ? c.abpApex : null;

    const need: Partial<Record<AbilityId, number>> = {};
    for (const X of ABIL) {
      const apexOf = (v: number) => (X === apexAbility ? (v >= 18 ? v + 2 : 18) : v);
      let s = 10 - 2 * (flawCount[X] ?? 0);
      let total = 0;
      while (apexOf(s) < c.abilities[X] && total < 40) {
        s += s >= 18 ? 1 : 2;
        total++;
      }
      need[X] = Math.max(0, total - (fixedCount[X] ?? 0));
    }

    type Ev = { write: (sels: (AbilityId | null)[]) => void; slots: { options?: AbilityId[] }[] };
    const slotsOf = (boosts: AbilityBoost[]): { options?: AbilityId[] }[] =>
      boostSlots(boosts).map((sl) => (sl.kind === 'choice' ? { options: sl.options } : {}));
    const events: Ev[] = [];
    if (ancestry) events.push({ write: (s) => (b.ancestryBoosts = s), slots: altBoosts ? [{}, {}] : slotsOf(ancestry.abilityBoosts) });
    if (background) events.push({ write: (s) => (b.backgroundBoosts = s), slots: slotsOf(background.abilityBoosts) });
    events.push({ write: (s) => (b.levelBoosts = s), slots: [{}, {}, {}, {}] });
    const boostCount = attributeBoostCount(c.variantRules);
    for (const lvl of attributeBoostLevels(c.variantRules))
      if (lvl <= c.level) events.push({ write: (s) => (b.attributeBoosts[lvl] = s), slots: Array.from({ length: boostCount }, () => ({})) });

    const pick = (placed: Set<AbilityId>, options?: AbilityId[]): AbilityId | null => {
      let best: AbilityId | null = null;
      for (const X of ABIL) {
        if ((need[X] ?? 0) <= 0 || placed.has(X)) continue;
        if (options && !options.includes(X)) continue;
        if (best === null || (need[X] ?? 0) > (need[best] ?? 0)) best = X;
      }
      return best;
    };
    const slotState = events.map((ev) => ({ placed: new Set<AbilityId>(), res: ev.slots.map(() => null as AbilityId | null) }));
    // Pass 1: respect choice-slot option lists.
    events.forEach((ev, ei) => {
      const st = slotState[ei];
      ev.slots.forEach((slot, si) => {
        const best = pick(st.placed, slot.options);
        if (best) {
          st.placed.add(best);
          need[best] = (need[best] ?? 0) - 1;
          st.res[si] = best;
        }
      });
    });
    // Pass 2 (relaxation): any boosts still unplaced — e.g. a hand-authored character whose scores
    // exceed a strict slot layout — fill remaining empty slots ignoring option lists, so the final
    // scores are still reproduced (buildCharacter doesn't enforce slot options anyway).
    slotState.forEach((st) => {
      st.res.forEach((cur, si) => {
        if (cur !== null) return;
        const best = pick(st.placed);
        if (best) {
          st.placed.add(best);
          need[best] = (need[best] ?? 0) - 1;
          st.res[si] = best;
        }
      });
    });
    events.forEach((ev, ei) => ev.write(slotState[ei].res));
  }

  // Divine font (cleric) — recover the heal/harm choice from the casting entry's font (the Battle
  // Creed 'battle' font isn't a divineFont pick; it's re-derived from the subclass).
  const fontType = c.spellcasting.find((e) => e.font)?.font?.type;
  b.divineFont = fontType === 'heal' || fontType === 'harm' ? fontType : null;

  // Champion devotion spell — recover from the focus entry's spell list.
  const focusEntry = c.spellcasting.find((e) => e.type === 'focus');
  const focusSpellIds = focusEntry ? Object.values(focusEntry.repertoire ?? {}).flat() : [];
  b.devotionSpell = ['shields-of-the-spirit', 'lay-on-hands', 'touch-of-the-void'].find((id) => focusSpellIds.includes(id)) ?? null;

  // Monk Path to Perfection — best-effort recovery from save ranks (a monk's master/legendary saves
  // come only from these picks). Order of the two master picks is approximate.
  if (c.classId === 'monk') {
    const sv = c.proficiencies.saves;
    const mastered = (['fortitude', 'reflex', 'will'] as SaveId[]).filter((s) => sv[s] === 'master' || sv[s] === 'legendary');
    const legendary = (['fortitude', 'reflex', 'will'] as SaveId[]).find((s) => sv[s] === 'legendary');
    b.pathToPerfection = [mastered[0] ?? null, mastered[1] ?? null, legendary ?? null];
  }

  // Druid Voice of Nature — recover the chosen feat.
  if (c.classId === 'druid') {
    b.voiceOfNature = c.feats.some((f) => f.featId === 'plant-empathy')
      ? 'plant-empathy'
      : c.feats.some((f) => f.featId === 'animal-empathy')
        ? 'animal-empathy'
        : null;
  }

  // Fighter Weapon Mastery group — recover the chosen group from the elevated weaponGroups rank
  // (fighters only elevate a group via this pick, so any weaponGroups entry ≥ master is it).
  if (dcOwns('fighter')) {
    const wg = c.proficiencies.weaponGroups ?? {};
    b.fighterWeaponGroup =
      Object.keys(wg).find((g) => wg[g] === 'legendary') ?? Object.keys(wg).find((g) => wg[g] === 'master') ?? null;
  }

  // Subclass restricted skill choice (Pistolero way, Empiricism methodology) — recover the trained pick.
  {
    const subOpt = cls?.subclass?.options.find((o) => o.id === b.subclassId);
    if (subOpt?.skillChoice?.length) {
      b.subclassSkill =
        subOpt.skillChoice.find((sk) => c.proficiencies.skills[sk] && c.proficiencies.skills[sk] !== 'untrained') ??
        subOpt.skillChoice[0];
    }
  }

  // Commander folio tactics — recover the chosen tactic ids.
  if (dcOwns('commander') && c.commanderTactics) b.commanderTactics = [...c.commanderTactics.folio];

  // Inventor — recover the armor-stats choice + the tiered modification picks.
  if (dcOwns('inventor') && c.inventor) {
    if (c.inventor.armorStats) b.inventorArmorStats = c.inventor.armorStats;
    b.inventorModifications = { ...c.inventor.modifications };
  }

  // Animist primary apparition — the attuned apparition whose vessel spell is in the focus repertoire.
  if (dcOwns('animist')) {
    const attuned = b.extraChoices['apparition'] ?? [];
    const group = (dcDef('animist')?.extraChoices ?? []).find((g) => g.id === 'apparition');
    const focusRep = new Set(
      c.spellcasting.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat()),
    );
    b.primaryApparition =
      attuned.find((id) => (group?.options.find((o) => o.id === id)?.focusSpells ?? []).some((s) => focusRep.has(s))) ??
      attuned[0] ??
      null;
  }

  // Feats: reconstruct featPicks/featChoices, dropping the background-granted feat (re-injected
  // by buildCharacter). Each feat is placed in a real levelGrants slot of its category so the
  // builder shows it in the right slot; idx is otherwise ignored by buildCharacter.
  const bgFeat = backgroundGrantedFeats(background, b.backgroundSkillChoice)[0];
  let bgFeatDropped = false;
  // A feat-granting heritage (Versatile Human): the level-1 GENERAL feat is its grant (no class has
  // a general slot at level 1), so recover it into heritageFeatId rather than a slot pick.
  const heritageGrantsFeat = !!(c.heritageId && content.heritages[c.heritageId]?.grantsGeneralFeat);
  // Override-granted bonus feats are re-injected by buildCharacter from overrides.addedFeats, so they
  // must NOT be reconstructed into a slot pick (else they'd consume a feat slot on reopen).
  const addedFeatIds = new Set((c.overrides?.addedFeats ?? []).map((a) => a.featId));
  // UMT wizard bonus feat: a wizard's first real class-feat slot is level 2, so a level-1 CLASS feat on
  // a UMT wizard is unambiguously the School of Unified Magical Theory bonus feat — recover it into
  // umtFeatId rather than a slot pick (same clean invariant as the Versatile-Human general feat).
  const isUmtWizard = c.classId === 'wizard' && b.subclassId === 'school-of-unified-magical-theory';
  // Dedication bonus skill feats: a taken dedication with FEAT_GRANTS.bonusSkillFeat contributes an
  // extra skill feat at its own level. Recover the FIRST unclaimed skill feat at that level into
  // dedicationSkillFeats so it doesn't consume a real skill-feat slot on reopen.
  const bonusSkillDedications = c.feats.filter((f) => FEAT_GRANTS[f.featId]?.bonusSkillFeat);
  const claimedBonusSkill = new Set<string>();
  // AUTO-GRANTED feats buildCharacter re-injects with NO player slot — a subclass/muse bonus feat
  // (Maestro muse → Lingering Composition), an option's choice-gated feat (Dominion Epithet →
  // Energized Spark), the druid Voice-of-Nature pick, and kineticist Expand-the-Portal impulse feats.
  // WG import matches these onto character.feats too, so they'd otherwise consume a real player feat
  // slot (pushing genuine picks into overflow chips) and look "granted-but-missing". Subtract exactly
  // what buildCharacter re-adds (mirroring its guards) so each shows on the sheet but is NOT an
  // editable builder slot NOR a chip. Background/heritage/UMT/dedication grants are handled below.
  const autoGrantedFeatIds = new Set<string>();
  {
    const favorsSimpleOrUnarmed = deityFavorsSimpleOrUnarmed(b.deityId, content);
    for (const o of grantOptions) {
      for (const fid of o.grantedFeats ?? []) {
        const f = content.feats[fid];
        // Mirror buildCharacter: a plain grantedFeat with no embedded sub-choice is auto-granted; a
        // choice-gated one is left for a manual slot there, so DON'T subtract it here.
        if (!f || f.choice) continue;
        if (fid === 'deadly-simplicity' && !favorsSimpleOrUnarmed) continue;
        autoGrantedFeatIds.add(fid);
      }
      // Choice-gated option feats (grantedChoiceFeats) are always injected by buildCharacter (default =
      // first allowed trait), and the derive already recovers their trait separately — so subtract them.
      for (const gcf of o.grantedChoiceFeats ?? []) if (content.feats[gcf.featId]?.choice) autoGrantedFeatIds.add(gcf.featId);
    }
    // Druid Voice of Nature: buildCharacter injects the animal/plant-empathy feat (recovered into
    // b.voiceOfNature separately). Subtract whichever the character actually carries.
    if ((cls?.features ?? []).some((f) => f.featureId === 'voice-of-nature')) {
      for (const fid of ['animal-empathy', 'plant-empathy']) if (c.feats.some((f) => f.featId === fid)) autoGrantedFeatIds.add(fid);
    }
    // Kineticist Expand the Portal: bonus impulse feats gained at reached Gate's Thresholds (recovered
    // into b.gateExpands via extraChoices reconstruction elsewhere). Subtract the chosen impulse ids.
    for (const fid of Object.values(b.gateExpands ?? {})) if (fid) autoGrantedFeatIds.add(fid);
  }
  const featsByLevel = new Map<number, FeatChoice[]>();
  // Pick-a-feat answers recovered from the granted feats, to be re-keyed onto whatever slot each
  // granting taking lands in below.
  const pickByGrantingSlot = new Map<string, string>();
  const pickByGrantingFeat = new Map<string, string>();
  for (const f of c.feats) {
    // A feat buildCharacter re-injects automatically (subclass/muse grant, option choice-feat, Voice of
    // Nature, Expand-the-Portal impulse): skip it entirely — no slot, no chip. It reappears on the sheet
    // via buildCharacter, so it's not lost, just not an editable builder slot.
    if (autoGrantedFeatIds.has(f.featId)) continue;
    // Feats auto-granted by another feat (FEAT_FEAT_GRANTS / FEAT_PICK_GRANTS, tagged grantedBy) are
    // re-derived by buildCharacter — never reconstruct them as an editable slot or a granted chip. Their
    // resolved sub-choice (Seeker of Truths' Domain Initiate domain) DOES round-trip, keyed by feat id.
    if (f.grantedBy) {
      if (f.choice) (b.grantedFeatChoices ??= {})[f.featId] = f.choice.value;
      // buildCharacter re-derives a pick-granted feat FROM `pickFeatChoices` — so rebuilding from the
      // character alone (an import, a campaign copy) has to put the answer back, or every bonus feat
      // a pick grant handed over silently disappears. Keyed by the granting TAKING, remapped to that
      // taking's new slot below.
      if (FEAT_PICK_GRANTS[f.grantedBy]) {
        if (f.grantedBySlot) pickByGrantingSlot.set(f.grantedBySlot, f.featId);
        else pickByGrantingFeat.set(f.grantedBy, f.featId); // saved before slots were recorded
      }
      continue;
    }
    if (!bgFeatDropped && bgFeat && f.featId === bgFeat && f.level === 1 && f.category === 'skill') {
      bgFeatDropped = true;
      continue;
    }
    if (heritageGrantsFeat && !b.heritageFeatId && f.level === 1 && f.category === 'general') {
      b.heritageFeatId = f.featId;
      continue;
    }
    if (isUmtWizard && !b.umtFeatId && f.level === 1 && f.category === 'class') {
      b.umtFeatId = f.featId;
      continue;
    }
    // Match a skill feat to a dedication's bonus grant at the same level (dedication feat itself excluded).
    if (
      f.category === 'skill' &&
      !FEAT_GRANTS[f.featId]?.bonusSkillFeat &&
      !claimedBonusSkill.has(f.featId)
    ) {
      const ded = bonusSkillDedications.find(
        (d) => d.level === f.level && !(b.dedicationSkillFeats ?? {})[d.featId],
      );
      if (ded) {
        (b.dedicationSkillFeats ??= {})[ded.featId] = f.featId;
        claimedBonusSkill.add(f.featId);
        continue;
      }
    }
    if (addedFeatIds.has(f.featId)) continue;
    const arr = featsByLevel.get(f.level) ?? [];
    arr.push(f);
    featsByLevel.set(f.level, arr);
  }

  // Robust, NEVER-INVISIBLE feat slotting. Every reconstructed feat must land in a slot the builder
  // actually RENDERS (`${lvl}:${category}:${idx}` with idx < that level's featSlots.length) — a
  // synthetic index the builder never draws would leave the feat invisible in the builder yet still in
  // featPicks (blocking re-pick) and re-added by buildCharacter (shown on the sheet). That is exactly
  // the WG-import bug. If no real slot can hold a feat, we surface it as a VISIBLE granted-feat chip
  // (overrides.addedFeats) rather than hide it.
  //
  // Enumerate every real slot across all levels up front so a feat filed under a colliding level (e.g.
  // several skill feats sharing a minimum level after a lossy import) can be redistributed into the
  // class's other same-category slots.
  type RealSlot = { level: number; idx: number; category: FeatCategory };
  const realSlots: RealSlot[] = [];
  if (c.classId) {
    for (let lvl = 1; lvl <= c.level; lvl++) {
      const cats = levelGrants(lvl, c.classId, content, c.subclassId, c.variantRules, c.classId2, c.subclassId2, c.mythicEnabled, c.feats.map((f) => f.featId)).featSlots;
      cats.forEach((category, idx) => realSlots.push({ level: lvl, idx, category }));
    }
  }
  const usedSlots = new Set<string>(); // `${level}:${idx}` of already-consumed real slots
  // Which real slot categories can hold a feat of the given category — mirrors eligibleFeatsForSlot:
  // an exact match, a 'general' slot taking a skill feat, an 'archetype' slot taking an archetype-trait
  // feat, a 'class' slot taking an archetype-trait feat (multiclass/dedication feats are class-category),
  // and a fighter 'bonus' slot taking a fighter feat. We stay conservative (only widenings the builder's
  // picker already renders) so we never place a feat in a slot the UI would reject.
  const slotAccepts = (slotCat: FeatCategory, f: FeatChoice): boolean => {
    if (slotCat === f.category) return true;
    const feat = content.feats[f.featId];
    const traits = feat?.traits ?? [];
    if (slotCat === 'general' && f.category === 'skill') return true;
    if (slotCat === 'archetype' && traits.includes('archetype')) return true;
    if (slotCat === 'class' && traits.includes('archetype')) return true;
    if (slotCat === 'mythic' && traits.includes('mythic')) return true;
    if (slotCat === 'bonus' && traits.includes('fighter')) return true;
    return false;
  };
  const featMinLevel = (f: FeatChoice): number => Math.max(1, content.feats[f.featId]?.level ?? 1);

  // Place lowest-assigned-level feats first so they claim their natural slots before higher ones
  // borrow across levels. Prefer an EXACT-category free slot at the feat's own level, then any
  // compatible free slot at its level, then compatible free slots at other levels within the feat's
  // legal window [minLevel, characterLevel] (nearest level first, exact category before widened).
  const orderedFeats = [...featsByLevel.entries()]
    .sort((a, b2) => a[0] - b2[0])
    .flatMap(([, fs]) => fs);
  const granted: { featId: string; level: number; category: FeatCategory }[] = [];
  for (const f of orderedFeats) {
    const free = realSlots.filter((s) => !usedSlots.has(`${s.level}:${s.idx}`));
    const minLvl = featMinLevel(f);
    const candidates = free
      .filter((s) => s.level >= minLvl && s.level <= c.level && slotAccepts(s.category, f))
      .sort((s1, s2) => {
        // Exact-category slots beat widened ones; then the slot nearest the feat's assigned level;
        // then lower level — a stable, deterministic ordering.
        const exact1 = s1.category === f.category ? 0 : 1;
        const exact2 = s2.category === f.category ? 0 : 1;
        if (exact1 !== exact2) return exact1 - exact2;
        const d1 = Math.abs(s1.level - f.level);
        const d2 = Math.abs(s2.level - f.level);
        if (d1 !== d2) return d1 - d2;
        return s1.level - s2.level;
      });
    const slot = candidates[0];
    if (slot) {
      usedSlots.add(`${slot.level}:${slot.idx}`);
      const key = `${slot.level}:${slot.category}:${slot.idx}`;
      b.featPicks[key] = f.featId;
      if (f.choice) b.featChoices[key] = f.choice.value;
      // Re-attach this taking's pick-a-feat answer to the slot it just landed in. `f.slotKey` is the
      // slot it had BEFORE the rebuild, which is only a lookup key here — the new one is what counts.
      const pick =
        (f.slotKey ? pickByGrantingSlot.get(f.slotKey) : undefined) ??
        (pickByGrantingSlot.size ? undefined : pickByGrantingFeat.get(f.featId));
      if (pick) (b.pickFeatChoices ??= {})[key] = pick;
    } else {
      // No real slot exists for this feat (over-cap import, unknown class, extra archetype feats a
      // lossy source dumped in). Surface it as a visible granted-feat chip instead of a hidden slot.
      granted.push({ featId: f.featId, level: Math.min(f.level, c.level), category: f.category });
    }
  }
  if (granted.length) {
    const existing = b.overrides?.addedFeats ?? [];
    const merged = [...existing];
    // Overflow feats (no real slot) become granted chips. Keep up to the feat's take-cap so a
    // repeatable feat that exceeded its slots isn't collapsed to a single chip.
    for (const g of granted) {
      if (merged.filter((a) => a.featId === g.featId).length < maxTakes(content.feats[g.featId])) merged.push(g);
    }
    b.overrides = { ...(b.overrides ?? {}), addedFeats: merged };
  }

  // Skills: classSkills (and the skilled-human heritage skill) by subtracting recomputable grants.
  {
    const trained = (Object.entries(c.proficiencies.skills) as [ProficiencyKey, ProficiencyRank][])
      .filter(([, r]) => r !== 'untrained')
      .map(([k]) => k);
    const granted = new Set<ProficiencyKey>();
    for (const sk of cls?.trainedSkills.fixed ?? []) granted.add(sk);
    if (background?.trainedSkill) granted.add(background.trainedSkill);
    // A choice-skill background: recover which offered skill is trained as the player's pick.
    if (background?.trainedSkillChoice?.length) {
      const pick = background.trainedSkillChoice.find(
        (sk) => c.proficiencies.skills[sk] && c.proficiencies.skills[sk] !== 'untrained',
      );
      b.backgroundSkillChoice = pick ?? null;
      granted.add(pick ?? background.trainedSkillChoice[0]);
    }
    if (background?.trainedLore) granted.add(`lore:${background.trainedLore}`);
    for (const o of grantOptions) for (const sk of o.grants?.skills ?? []) granted.add(sk);
    for (const o of grantOptions) for (const subj of o.grants?.lores ?? []) granted.add(loreKey(subj));
    if (c.classId === 'cleric' || c.classId2 === 'cleric') {
      const ds = c.details.deityId ? content.deities[c.details.deityId]?.skill : undefined;
      if (ds) granted.add(ds as ProficiencyKey);
    }

    let extras = trained.filter((sk) => !granted.has(sk));
    if (c.heritageId === 'skilled-human') {
      // Skilled Heritage raises its skill to expert at 5th. The skill it names may equally be one
      // the character was GRANTED — a Sarenrae cleric is trained in Medicine by their deity and can
      // still spend the heritage on it — so look for the expert among the granted skills too, or the
      // round-trip moves the heritage onto an unrelated skill and makes THAT one expert.
      const expertAt = (sk: ProficiencyKey) => c.proficiencies.skills[sk] === 'expert';
      const hSkill = (extras.find(expertAt) ?? [...granted].find(expertAt) ?? extras[0]) as SkillId | undefined;
      if (hSkill) {
        b.heritageSkill = hSkill;
        extras = extras.filter((sk) => sk !== hSkill);
      }
    }
    b.classSkills = extras;

    // Reconstruct skill INCREASES when the character didn't carry enough of them to explain its final
    // ranks (imported / hand-authored characters that recorded only final ranks). buildCharacter raises
    // a skill one step per increase (capped by skillIncreaseCap), applied ascending. To find the delta
    // each skill's increases must cover, we take the ranks the reconstructed build ALREADY produces
    // WITHOUT any skill increases — that automatically folds in every non-increase source (base class
    // training, background/heritage grants, the skilled-human expert-at-5 bump, subclass grants, dual
    // class) — and compare to the target ranks. Any positive delta is player skill increases we assign
    // to the class's real skill-increase levels (≤ character level) so the builder renders populated
    // slots and a rebuild reproduces the rank. Only levels the native increases left empty are filled,
    // so a correct native round-trip is untouched.
    {
      const rankIdx = (r: ProficiencyRank) => PROFICIENCY_RANKS.indexOf(r);
      // Baseline ranks from this build with increases stripped (b.classSkills/heritageSkill are set).
      const baseline = buildCharacter({ ...b, skillIncreases: {} }, content).proficiencies.skills as Record<string, ProficiencyRank>;
      // Steps the native increases already contribute per skill (don't re-synthesize those).
      const nativeSteps: Partial<Record<ProficiencyKey, number>> = {};
      for (const si of c.skillIncreases ?? []) nativeSteps[si.skill] = (nativeSteps[si.skill] ?? 0) + 1;
      const siLevels = (cls?.skillIncreaseLevels ?? SKILL_INCREASE_LEVELS).filter((lvl) => lvl <= c.level);
      const freeLevels = siLevels.filter((lvl) => !b.skillIncreases[lvl]).sort((a, b2) => a - b2);
      for (const [skRaw, rankRaw] of Object.entries(c.proficiencies.skills) as [ProficiencyKey, ProficiencyRank][]) {
        const baseIdx = rankIdx(baseline[skRaw] ?? 'untrained');
        const finalIdx = rankIdx(rankRaw);
        const needed = finalIdx - baseIdx - (nativeSteps[skRaw] ?? 0);
        for (let n = 0; n < needed; n++) {
          // The (already+1)-th step above the baseline targets rank index baseIdx + already + 1; place
          // it at the earliest free level whose cap (expert@3–5, master@7–13, legendary@15+) permits it.
          const already = (nativeSteps[skRaw] ?? 0) + n;
          const targetRankIdx = baseIdx + already + 1;
          const li = freeLevels.findIndex((lvl) => rankIdx(skillIncreaseCap(lvl)) >= targetRankIdx);
          if (li === -1) break; // no remaining level can legally grant this step — best-effort stops
          const lvl = freeLevels.splice(li, 1)[0];
          b.skillIncreases[lvl] = skRaw;
        }
      }
    }
  }

  // Languages: drop the ancestry-granted ones; the remainder are the player's bonus picks.
  const grantedLangs = ancestry?.languages.granted ?? [];
  b.languages = c.languages.filter((l) => !grantedLangs.includes(l));

  // Spellcasting: recover cantrips / spells-by-rank / signatures (subtracting granted spells).
  {
    const grantedSpellSet = new Set<string>();
    for (const o of grantOptions) for (const s of o.grantedSpells ?? []) grantedSpellSet.add(s);
    // Find the PRIMARY class's caster entry. Prefer the canonical id `${cls.id}-casting`, but fall
    // back to a STRUCTURAL match: any character whose entry id differs (imported characters, the old
    // seed, hand-authored data) would otherwise have its cantrips/prepared/repertoire/signatures
    // silently dropped on the next rebuild. We match the class's own caster by its declared type
    // (prepared/spontaneous), excluding the entries that are NOT the primary class pool: the caster
    // archetype pool (`-dedication-casting`), focus spells (`type === 'focus'`), the animist apparition
    // pool, and — under Dual Class — the SECOND class's entry (recovered separately below).
    const classEntry = cls ? findPrimaryCasterEntry(c, cls, cls2dc) : undefined;
    if (classEntry) {
      b.cantrips = classEntry.cantrips.filter((s) => !grantedSpellSet.has(s));
      if (classEntry.type === 'spontaneous' && classEntry.repertoire) {
        for (const [rank, ids] of Object.entries(classEntry.repertoire)) b.spells[Number(rank)] = ids.filter((s) => !grantedSpellSet.has(s));
        // ACCUMULATE. Assigning would keep only the last of a rank's signatures, which is exactly
        // the round-trip loss the array shape exists to stop — and TypeScript cannot catch it,
        // because a bare string is still assignable to `string | string[]`.
        for (const sigId of classEntry.signature ?? []) {
          const r = content.spells[sigId]?.rank;
          if (r != null) b.signatures[r] = [...signaturesAt(b.signatures, r), sigId];
        }
      } else if (classEntry.spellbook) {
        for (const [rank, ids] of Object.entries(classEntry.spellbook)) b.spells[Number(rank)] = [...ids];
      } else if (classEntry.prepared) {
        const studious = new Set(magusStudiousSpells(c.level)?.spells ?? []);
        for (const [rank, slots] of Object.entries(classEntry.prepared)) {
          b.spells[Number(rank)] = slots
            .map((s) => s.spellId)
            .filter((id): id is string => !!id && !studious.has(id) && !grantedSpellSet.has(id));
        }
      }
    }
    // Dual Class: recover the SECOND caster class's own spell surface into cantrips2/spells2/
    // signatures2, so it survives a builder rebuild (buildCharacter re-populates the entry from these).
    const classEntry2 = cls2dc ? findSecondCasterEntry(c, cls2dc, cls) : undefined;
    if (classEntry2) {
      b.cantrips2 = [...classEntry2.cantrips];
      const spells2: Record<number, string[]> = {};
      if (classEntry2.type === 'spontaneous' && classEntry2.repertoire) {
        for (const [rank, ids] of Object.entries(classEntry2.repertoire)) spells2[Number(rank)] = [...ids];
        const signatures2: Record<number, string | string[]> = {};
        for (const sigId of classEntry2.signature ?? []) {
          const r = content.spells[sigId]?.rank;
          if (r != null) signatures2[r] = [...signaturesAt(signatures2, r), sigId];
        }
        if (Object.keys(signatures2).length) b.signatures2 = signatures2;
      } else if (classEntry2.spellbook) {
        for (const [rank, ids] of Object.entries(classEntry2.spellbook)) spells2[Number(rank)] = [...ids];
      } else if (classEntry2.prepared) {
        const studious2 = new Set(magusStudiousSpells(c.level)?.spells ?? []);
        for (const [rank, slots] of Object.entries(classEntry2.prepared)) {
          spells2[Number(rank)] = slots.map((s) => s.spellId).filter((id): id is string => !!id && !studious2.has(id));
        }
      }
      b.spells2 = spells2;
    }
    // Caster archetype pool (dedication-based id). Recover it SEPARATELY from the class pool: into
    // build.archetypeSpells when the class is itself a caster (two casters), else the legacy single
    // surface (build.cantrips/build.spells) for a non-caster class.
    const archEntry = c.spellcasting.find(
      (e) => e.id.endsWith('-dedication-casting') && (e.type === 'prepared' || e.type === 'spontaneous'),
    );
    if (archEntry) {
      const spellsByRank: Record<number, string[]> = {};
      if (archEntry.prepared)
        for (const [rank, slots] of Object.entries(archEntry.prepared))
          spellsByRank[Number(rank)] = slots.map((s) => s.spellId).filter((id): id is string => !!id);
      if (archEntry.repertoire) for (const [rank, ids] of Object.entries(archEntry.repertoire)) spellsByRank[Number(rank)] = [...ids];
      if (classEntry) {
        b.archetypeSpells = {
          cantrips: [...archEntry.cantrips],
          spells: spellsByRank,
          tradition: archEntry.tradition,
          keyAbility: archEntry.keyAbility,
        };
      } else {
        b.cantrips = [...archEntry.cantrips];
        b.archetypeTradition = archEntry.tradition;
        b.archetypeKeyAbility = archEntry.keyAbility;
        b.spells = spellsByRank;
      }
    }
    // Summoner archetype: recover the chosen eidolon type from the injected eidolon companion.
    const archEidolon = c.companions?.find((comp) => comp.id === 'eidolon-archetype');
    if (archEidolon?.typeId) b.archetypeEidolonType = archEidolon.typeId;
  }

  return b;
}

/** What a given character level offers: auto features, feat slots, skill increase, boosts. */
export interface LevelGrants {
  features: { id: string; name: string }[];
  featSlots: FeatCategory[];
  skillIncrease: boolean;
  attributeBoosts: boolean;
}

export function levelGrants(
  level: number,
  classId: string | null,
  content: ContentDatabase,
  subclassId?: string | null,
  variant?: VariantRules,
  classId2?: string | null,
  subclassId2?: string | null,
  mythicEnabled?: boolean,
  /** The feats the character has TAKEN — only needed for grants a feat itself unlocks
   *  (Ultimate Flexibility adds a third combat-flexibility slot). */
  takenFeatIds?: Iterable<string>,
): LevelGrants {
  const cls = classId ? content.classes[classId] : undefined;
  // Dual Class: the second class contributes its own features and class feats at every level.
  const cls2 = variant?.dualClass && classId2 ? content.classes[classId2] : undefined;
  // A subclass can remove class features (cleric Battle Creed drops Resolute Faith + Miraculous Spell).
  const suppressed = new Set(cls?.subclass?.options.find((o) => o.id === subclassId)?.suppressedFeatures ?? []);
  const suppressed2 = new Set(cls2?.subclass?.options.find((o) => o.id === subclassId2)?.suppressedFeatures ?? []);
  const features = [
    ...(cls?.features ?? []).filter((f) => f.level === level && !suppressed.has(f.featureId)),
    ...(cls2?.features ?? []).filter((f) => f.level === level && !suppressed2.has(f.featureId)),
  ].map((f) => ({ id: f.featureId, name: content.classFeatures[f.featureId]?.name ?? f.featureId }));
  const featSlots: FeatCategory[] = [];
  if (cls) {
    // Ancestry Paragon REPLACES the standard ancestry progression: 2 feats at L1, then 1 at each odd
    // level 3–19 (11 total). Otherwise use the class's normal ancestry feat levels (1/5/9/13/17).
    if (variant?.ancestryParagon) {
      if (level === 1) featSlots.push('ancestry', 'ancestry');
      else if (level >= 3 && level <= 19 && level % 2 === 1) featSlots.push('ancestry');
    } else if (cls.featProgression.ancestry.includes(level)) {
      featSlots.push('ancestry');
    }
    if (cls.featProgression.class.includes(level)) featSlots.push('class');
    // Dual Class: a second class feat at each of the second class's class-feat levels.
    if (cls2?.featProgression.class.includes(level)) featSlots.push('class');
    if (cls.featProgression.skill.includes(level)) featSlots.push('skill');
    if (cls.featProgression.general.includes(level)) featSlots.push('general');
    // Fighter Combat Flexibility (L9) + Improved Flexibility (L15): each grants a bonus daily fighter
    // feat (≤8 at L9, ≤14 at L15). Modeled as an additive 'bonus' slot (the app has no daily-prep step).
    if ((cls.id === 'fighter' || cls2?.id === 'fighter') && (level === 9 || level === 15)) featSlots.push('bonus');
    // Ultimate Flexibility (L20) makes it THREE feats, the third "up to 18th level" — a slot the
    // level table cannot know about, because it is unlocked by a feat rather than by the class.
    if ((cls.id === 'fighter' || cls2?.id === 'fighter') && level === 20 && takenFeatIds && [...takenFeatIds].includes('ultimate-flexibility'))
      featSlots.push('bonus');
    // Free Archetype: a bonus archetype-only class feat at every even level (2–20).
    if (variant?.freeArchetype && level >= 2 && level % 2 === 0) featSlots.push('archetype');
    // Mythic (War of Immortals): a mythic-feat slot at every even level (2–20), fillable only with
    // mythic-trait feats. Gated by the campaign Mythic toggle.
    if (mythicEnabled && level >= 2 && level % 2 === 0) featSlots.push('mythic');
  }
  return {
    features,
    featSlots,
    skillIncrease: (cls?.skillIncreaseLevels ?? SKILL_INCREASE_LEVELS).includes(level),
    attributeBoosts: attributeBoostLevels(variant).includes(level),
  };
}

/**
 * Check a feat's prerequisites against a (built) character. Enforces only the
 * unambiguous, safe patterns (under-enforcing never wrongly blocks a legal pick):
 *  - PROFICIENCY RANK ("trained/expert/master in <skill|Perception|… Lore>")
 *  - ABILITY modifier ("Strength +2"); multiple are AND (comma convention), except the Fighter/Monk
 *    Dedication allow-list whose two entries are genuinely "X or Y"
 *  - HAS-FEAT (the prereq names another feat) — enforced only when the name resolves
 *    to a known content feat; "met" if the character has it as a feat OR a class
 *    feature / heritage / subclass (so feature-prereqs like a rogue's Sneak Attack
 *    aren't false-blocked). Names that aren't known feats (darkvision, "focus pool",
 *    compound "X or Y", …) are shown but not enforced.
 */
const ABILITY_BY_NAME: Record<string, AbilityId> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
};

// The ONLY feats whose two separate ability prerequisites are genuinely "X or Y" (OR). Every other
// feat with multiple ability prereqs uses the comma convention = AND (need both). The Foundry data
// stores both shapes as identical separate entries, so the OR cases must be an explicit allow-list.
const ABILITY_OR_FEATS = new Set(['fighter-dedication', 'monk-dedication']);

export function checkPrerequisites(
  feat: Feat,
  character: Character,
  content: ContentDatabase,
): { met: boolean; unmet: string[] } {
  const unmet: string[] = [];
  const abilityResults: { line: string; met: boolean }[] = [];

  // Everything the character "has" for a has-feat prereq: taken feats + granted class
  // features (up to level) + heritage / ancestry / class / subclass ids.
  const has = new Set<string>(character.feats.map((f) => f.featId));
  const cCls = character.classId ? content.classes[character.classId] : undefined;
  if (cCls) for (const f of cCls.features) if (f.level <= character.level) has.add(f.featureId);
  for (const id of [character.heritageId, character.ancestryId, character.classId, character.subclassId]) {
    if (id) has.add(id);
  }

  for (const line of feat.prerequisites ?? []) {
    const am = line.match(/^(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+\+(\d+)$/i);
    if (am) {
      abilityResults.push({
        line,
        met: abilityMod(character.abilities[ABILITY_BY_NAME[am[1].toLowerCase()]]) >= Number(am[2]),
      });
      continue;
    }
    const m = line.match(/^(trained|expert|master|legendary)\s+(?:in\s+)?(.+)$/i);
    if (m) {
      const need = m[1].toLowerCase() as ProficiencyRank;
      // Compound "X or Y" is an OR: satisfied if any alternative meets the rank.
      const targets = m[2].split(/\s+or\s+/i).map((t) => t.trim().toLowerCase());
      const rankOf = (target: string): ProficiencyRank | null => {
        if (target === 'perception') return character.proficiencies.perception;
        if ((SKILLS as readonly string[]).includes(target)) return character.proficiencies.skills[target as SkillId] ?? 'untrained';
        if (/\blore$/.test(target)) return character.proficiencies.skills[`lore:${target.replace(/\s*lore$/, '')}`] ?? 'untrained';
        return null; // unrecognized (a tradition, a feat name, …) — can't verify
      };
      const ranks = targets.map(rankOf);
      // Enforce only when EVERY alternative is a recognized skill (else an unverifiable
      // alternative might satisfy the OR — never false-block).
      if (ranks.every((r) => r != null)) {
        const anyMet = ranks.some((r) => PROFICIENCY_RANKS.indexOf(r as ProficiencyRank) >= PROFICIENCY_RANKS.indexOf(need));
        if (!anyMet) unmet.push(line);
      }
      continue; // rank-pattern lines are never feat names
    }
    // Has-feat: enforce only when the prereq resolves to a known feat.
    const fid = slug(line);
    if (content.feats[fid] && !has.has(fid)) unmet.push(line);
  }
  // Multi-ability prereqs are AND by default (comma convention); only the Fighter/Monk Dedication
  // allow-list treats its two ability entries as OR. (Single-string "X or Y" prereqs aren't matched
  // above, so they remain safely under-enforced rather than wrongly blocking.)
  if (abilityResults.length) {
    if (ABILITY_OR_FEATS.has(feat.id)) {
      if (!abilityResults.some((r) => r.met)) unmet.push(...abilityResults.map((r) => r.line));
    } else {
      for (const r of abilityResults) if (!r.met) unmet.push(r.line);
    }
  }
  return { met: unmet.length === 0, unmet };
}
