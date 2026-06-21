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
  WeaponCategory,
  WeaponRunes,
} from './types';
import { CHARACTER_SCHEMA_VERSION, PROFICIENCY_RANKS, SKILLS } from './types';
import { abilityMod } from './derive';
import { CLASS_ADVANCEMENT } from './advancement';
import { DOMAIN_SPELLS } from './domains';
import { initialClassResources } from './classResources';
import { activeCasterArchetype, archetypeProficiency, archetypeSlots } from './casterArchetypes';
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
  /** Per-character convenience/house options (alternate ancestry boosts, voluntary flaw, ignore bulk, dice roller). */
  options?: CharacterOptions;
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
  /** Inventor armor innovation's base statistics (gates several armor modifications). */
  inventorArmorStats?: 'power-suit' | 'subterfuge-suit' | null;
  /** Inventor chosen modification ids by tier. */
  inventorModifications?: { initial?: string | null; breakthrough?: string | null; revolutionary?: string | null };
  /** Kineticist Fork the Path picks: Gate's Threshold level (string) → newly-gained element option id. */
  gateForks?: Record<string, string>;
  /** Kineticist Expand the Portal picks: Gate's Threshold level (string) → bonus impulse feat id. */
  gateExpands?: Record<string, string>;
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
  /** Spontaneous signature spell per rank (rank -> repertoire spell id) — one per rank. */
  signatures: Record<number, string>;
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
  }[];
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
  if (sub?.keyAbility) return sub.keyAbility;
  for (const g of cls.extraChoices ?? []) {
    for (const id of build.extraChoices?.[g.id] ?? []) {
      const o = g.options.find((opt) => opt.id === id);
      if (o?.keyAbility) return o.keyAbility;
    }
  }
  return undefined;
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
      pushDistinct(build.ancestryBoosts);
    }
  }
  // Voluntary Flaw: an additional attribute flaw the player elected to take (toggle in Setup, attribute
  // chosen at level 0).
  if (build.options?.voluntaryFlaw && build.options.voluntaryFlawAbility) flaws.push(build.options.voluntaryFlawAbility);

  const background = resolveBackground(build, content);
  if (background) {
    boosts.push(...fixedBoosts(background.abilityBoosts));
    pushDistinct(build.backgroundBoosts);
  }

  const cls = build.classId ? content.classes[build.classId] : undefined;
  if (cls) {
    const key = subclassKeyAbility(build, content) ?? build.keyAbility ?? cls.keyAbility[0];
    if (key) boosts.push(key);
  }

  pushDistinct(build.levelBoosts);

  // Mid-career attribute boosts (5/10/15/20, or the Gradual schedule), applied in level order so the
  // +1-past-18 partial rule resolves the same way the rules describe it. Cap each level to the active
  // count so stale picks (e.g. after toggling Gradual on) don't over-grant.
  const boostCount = attributeBoostCount(build.variantRules);
  for (const lvl of attributeBoostLevels(build.variantRules)) {
    if (lvl > uptoLevel) continue;
    pushDistinct((build.attributeBoosts[lvl] ?? []).slice(0, boostCount));
  }

  // ABP Attribute Apex (level 17): a single boost to the chosen attribute (the +1-past-18 partial
  // rule supplies the apex cap). Applied last, as it's gained at 17th.
  if (build.variantRules?.abp && uptoLevel >= 17 && build.abpApex) boosts.push(build.abpApex);

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

const SAVE_TRACKS: readonly string[] = ['fortitude', 'reflex', 'will'];
const WEAPON_TRACKS: readonly string[] = ['unarmed', 'simple', 'martial', 'advanced'];
const ARMOR_TRACKS: readonly string[] = ['unarmored', 'light', 'medium', 'heavy'];
// Weapon-GROUP advancement tracks (alchemist bombs, gunslinger firearms) → proficiencies.weaponGroups.
const WEAPON_GROUP_TRACKS: readonly string[] = ['bomb', 'firearm', 'crossbow'];

/** Apply one advancement entry to the proficiency block / spellcasting entries (never lowers). */
function applyAdvancement(p: Proficiencies, casting: SpellcastingEntry[], e: AdvancementEntry): void {
  const t = e.track;
  if (t === 'perception') p.perception = maxRank(p.perception, e.rank);
  else if (t === 'classDc') p.classDc = maxRank(p.classDc, e.rank);
  else if (t === 'spellcasting') for (const c of casting) c.proficiency = maxRank(c.proficiency, e.rank);
  else if (SAVE_TRACKS.includes(t)) p.saves[t as SaveId] = maxRank(p.saves[t as SaveId], e.rank);
  else if (WEAPON_TRACKS.includes(t)) p.attacks[t as WeaponCategory] = maxRank(p.attacks[t as WeaponCategory], e.rank);
  else if (ARMOR_TRACKS.includes(t)) p.defenses[t as ArmorCategory] = maxRank(p.defenses[t as ArmorCategory], e.rank);
  else if (WEAPON_GROUP_TRACKS.includes(t)) (p.weaponGroups ??= {})[t] = maxRank(p.weaponGroups?.[t], e.rank);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
}

/** Build a complete, renderable Character from the current choices. */
/** How many bonus languages the character may choose: max(0, Int mod) + ancestry's extra. */
export function bonusLanguageSlots(build: BuildState, content: ContentDatabase): number {
  const ancestry = build.ancestryId ? content.ancestries[build.ancestryId] : undefined;
  const intMod = abilityMod(computeAbilities(build, content).int);
  return Math.max(0, intMod) + (ancestry?.languages.additional ?? 0);
}

/** Does this class make the character choose a deity? Cleric uses featureId 'deity'; champion uses
 *  'deity-champion'. Both drive the deity picker, the divine-font default, and the favored-weapon override. */
export function classChoosesDeity(features?: { featureId: string }[]): boolean {
  return (features ?? []).some((f) => f.featureId === 'deity' || f.featureId === 'deity-champion');
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

export function buildCharacter(build: BuildState, content: ContentDatabase): Character {
  const { scores: abilities, partial: partialBoosts } = computeAbilitiesDetailed(build, content);
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
  const choiceKeyAbility = grantOptions.find((o) => o.keyAbility)?.keyAbility;
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
  if (background?.trainedSkill) (skills[background.trainedSkill] = 'trained'), locked.add(background.trainedSkill);
  if (background?.trainedLore) skills[`lore:${background.trainedLore}`] = 'trained';
  if (build.heritageSkill) (skills[build.heritageSkill] = 'trained'), locked.add(build.heritageSkill);
  // Skilled Heritage (human): the chosen skill becomes expert at 5th level.
  if (build.heritageSkill && build.heritageId === 'skilled-human' && level >= 5) {
    skills[build.heritageSkill] = maxRank(skills[build.heritageSkill], 'expert');
  }
  // Subclass-/choice-granted skills (druid order, rogue racket, witch patron, eidolon) — also free.
  for (const o of grantOptions) {
    for (const sk of o.grants?.skills ?? []) (skills[sk] = 'trained'), locked.add(sk);
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
    const overrides: Record<string, ProficiencyRank> = {};
    for (const w of deity.favoredWeapons) if (content.items[w]) overrides[w] = 'trained';
    if (Object.keys(overrides).length) proficiencies.weaponOverrides = overrides;
  }

  // Dual Class: HP uses the HIGHER per-level Hit Points of the two classes (not the sum).
  const hpPerLevel = Math.max(cls?.hpPerLevel ?? 0, cls2?.hpPerLevel ?? 0);
  const hpMax = (ancestry?.hp ?? 0) + (hpPerLevel + abilityMod(abilities.con)) * level;

  // Resolve feats' embedded sub-choices (Domain Initiate domain, Additional Lore, …).
  // A domains choice grants that domain's focus spell; the resolved label is recorded
  // on the FeatChoice for display.
  const featChoiceById: Record<string, { value: string; label: string }> = {};
  const featFocusSpells: string[] = [];
  let featPoolBonus = 0;
  for (const [slotKey, featId] of Object.entries(build.featPicks)) {
    const lvl = Number(slotKey.split(':')[0]);
    if (!featId || !Number.isFinite(lvl) || lvl > level) continue;
    const feat = content.feats[featId];
    if (!feat) continue;
    // Embedded sub-choice (Domain Initiate's domain → its initial focus spell). A choice feat's focus
    // is driven by the pick, so the fixed-grant path below is skipped for it (avoids double-counting).
    const def = feat.choice;
    if (def) {
      const value = build.featChoices?.[slotKey];
      if (value) {
        const label = def.kind === 'domains' ? cap(value) : def.options?.find((o) => o.value === value)?.label ?? value;
        featChoiceById[slotKey] = { value, label };
        if (def.kind === 'domains' && DOMAIN_SPELLS[value] && content.spells[DOMAIN_SPELLS[value]]) {
          featFocusSpells.push(DOMAIN_SPELLS[value]);
        }
      }
    } else {
      // Advanced/Greater Bloodline (sorcerer) and Advanced/Greater Revelation (oracle) grant a focus
      // spell that depends on the chosen subclass, so the feat itself can't name it — resolve it from
      // the picked bloodline/mystery here. The pool point is counted via the spell (avoids double count).
      const ADV_SPELL: Record<string, string | undefined> = {
        'advanced-bloodline': subOption?.advancedFocusSpell,
        'greater-bloodline': subOption?.greaterFocusSpell,
        'advanced-revelation': subOption?.advancedFocusSpell,
        'greater-revelation': subOption?.greaterFocusSpell,
      };
      const advSpell = ADV_SPELL[featId];
      // Feats that grant a fixed focus spell + a focus pool point (Blessed One → Lay on Hands, Cathartic
      // Focus Spell, …). Each granted spell maps to one pool point; pool-only feats add a bonus.
      const ffs = (feat.focusSpells ?? []).filter((id) => content.spells[id]);
      if (advSpell && content.spells[advSpell]) featFocusSpells.push(advSpell);
      else if (ffs.length) featFocusSpells.push(...ffs);
      else if (feat.focusPoolBonus) featPoolBonus += feat.focusPoolBonus;
    }
  }

  const spellcasting: SpellcastingEntry[] = [];
  let focus: { current: number; max: number } | undefined;
  if (cls?.spellcasting) {
    const sp = cls.spellcasting;
    // A subclass/choice can set the tradition (witch patron, sorcerer bloodline,
    // summoner eidolon) or key ability (psychic subconscious mind); else the class's.
    // The Draconic bloodline's tradition comes from the chosen dragon exemplar.
    const tradition = dragon?.tradition ?? grantOptions.find((o) => o.tradition)?.tradition ?? sp.tradition;
    // A subclass can override the slot progression (cleric Battle Creed uses the reduced two-rank table).
    const progression = subOption?.slotProgression ?? sp.progression;
    const slotCounts = casterSlots(level, progression); // rank -> number of slots
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
      cantrips: [...new Set([...build.cantrips.slice(0, cantripsKnown(cls.id)), ...(grantedByRank[0] ?? [])])],
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
        const sig = Object.entries(build.signatures)
          .filter(([rankStr, id]) => entry.repertoire?.[Number(rankStr)]?.includes(id))
          .map(([, id]) => id);
        if (sig.length) entry.signature = sig;
      }
    } else if (cls.id === 'wizard') {
      // Wizard: build.spells is the SPELLBOOK (learned spells per rank); the daily
      // preparation is auto-filled from it (the player can re-prepare in play).
      // The Arcane School grants ONE extra prepared slot of each rank you can cast (the
      // curriculum slot), so a wizard prepares one more per rank than the base full-caster
      // table; the extra cantrip is already counted by cantripsKnown('wizard'). (The slot
      // is meant to hold a curriculum spell; that restriction isn't enforced here.)
      const hasSchool = (cls.features ?? []).some((f) => f.featureId === 'arcane-school' || f.featureId === 'arcane-thesis') || !!subOption;
      entry.spellbook = {};
      entry.prepared = {};
      for (const [rankStr, count] of Object.entries(slotCounts)) {
        const rank = Number(rankStr);
        const learned = build.spells[rank] ?? [];
        entry.spellbook[rank] = [...learned];
        const total = count + (hasSchool ? 1 : 0); // +1 curriculum slot per castable rank
        entry.prepared[rank] = Array.from({ length: total }, (_, i) => ({ spellId: learned[i] ?? null, expended: false }));
      }
    } else {
      // Cleric/druid/witch: prepare from the whole tradition list each day.
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

    // Cleric divine font: 1 + Cha modifier extra heal/harm slots (validated against the deity's allowed
    // font). Applied to the prepared entry. Battle Creed replaces it with a BATTLE FONT: 4/5/6 Bane-or-
    // Bless slots at the highest rank, cast with the class DC (not the spell DC).
    const hasFont = (cls.features ?? []).some((f) => f.featureId === 'divine-font');
    const ranks = Object.keys(entry.prepared ?? {}).map(Number);
    const topRank = ranks.length ? Math.max(...ranks) : 1;
    if (subOption?.id === 'battle-creed') {
      entry.font = {
        type: 'battle',
        slots: level >= 15 ? 6 : level >= 5 ? 5 : 4,
        rank: topRank,
        useClassDc: true,
        allowed: ['bane', 'bless'],
      };
    } else {
      const deityFont = build.deityId ? content.deities[build.deityId]?.divineFont : undefined;
      if (hasFont && build.divineFont && (!deityFont?.length || deityFont.includes(build.divineFont))) {
        entry.font = {
          type: build.divineFont,
          slots: Math.max(0, 1 + abilityMod(abilities.cha)),
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
    const entry2: SpellcastingEntry = {
      id: `${cls2.id}-casting`,
      name: `${cap(tradition2)} ${sp2.type} spellcasting`,
      type: sp2.type,
      tradition: tradition2,
      keyAbility: sp2.keyAbility,
      proficiency: 'trained',
      cantrips: [],
    };
    const hasSchool2 = cls2.id === 'wizard'; // wizard curriculum: +1 prepared slot per castable rank
    if (sp2.repertoire) {
      entry2.repertoire = {};
      entry2.slots = {};
      for (const [rankStr, count] of Object.entries(slotCounts2)) {
        entry2.slots[Number(rankStr)] = { max: count, used: 0 };
        entry2.repertoire[Number(rankStr)] = [];
      }
    } else {
      entry2.prepared = {};
      for (const [rankStr, count] of Object.entries(slotCounts2)) {
        entry2.prepared[Number(rankStr)] = Array.from({ length: count + (hasSchool2 ? 1 : 0) }, () => ({ spellId: null, expended: false }));
      }
    }
    // Magus Studious Spells: bonus auto-prepared slots at the tier rank (curated, not player-chosen).
    if (cls2.id === 'magus' && entry2.prepared) {
      const studious2 = magusStudiousSpells(level);
      if (studious2) entry2.prepared[studious2.rank] = [...(entry2.prepared[studious2.rank] ?? []), ...studious2.spells.map((id) => ({ spellId: content.spells[id] ? id : null, expended: false }))];
    }
    // Cleric divine font (or Battle Creed's battle font) on the second class.
    if (entry2.prepared) {
      const ranks2 = Object.keys(entry2.prepared).map(Number);
      const top2 = ranks2.length ? Math.max(...ranks2) : 1;
      if (subOption2?.id === 'battle-creed') {
        entry2.font = { type: 'battle', slots: level >= 15 ? 6 : level >= 5 ? 5 : 4, rank: top2, useClassDc: true, allowed: ['bane', 'bless'] };
      } else if ((cls2.features ?? []).some((f) => f.featureId === 'divine-font') && build.divineFont) {
        const deityFont2 = build.deityId ? content.deities[build.deityId]?.divineFont : undefined;
        if (!deityFont2?.length || deityFont2.includes(build.divineFont)) entry2.font = { type: build.divineFont, slots: Math.max(0, 1 + abilityMod(abilities.cha)), rank: top2 };
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
  ];
  // The class that actually supplies the focus pool's tradition/key — the primary if it casts/has a
  // focus profile, otherwise the second class (e.g. fighter + animist → the animist's divine/Wis).
  const focusCls = cls?.spellcasting || (cls && FOCUS_CASTING[cls.id]) || cls?.focusSpells?.length ? cls : cls2 ?? cls;
  if (cls && focusSpells.length) {
    const focusTradition =
      grantOptions.find((o) => o.tradition)?.tradition ?? focusCls?.spellcasting?.tradition ?? (focusCls && FOCUS_CASTING[focusCls.id]?.tradition) ?? 'occult';
    const focusKey = choiceKeyAbility ?? focusCls?.spellcasting?.keyAbility ?? (focusCls && FOCUS_CASTING[focusCls.id]?.key) ?? focusCls?.keyAbility[0] ?? 'cha';
    const byRank: Record<number, string[]> = {};
    for (const id of focusSpells) {
      const r = content.spells[id]?.rank ?? 1;
      (byRank[r] ??= []).push(id);
    }
    spellcasting.push({
      id: `${cls.id}-focus`,
      name: 'Focus spells',
      type: 'focus',
      tradition: focusTradition,
      keyAbility: focusKey,
      proficiency: 'trained',
      cantrips: [],
      repertoire: byRank,
    });
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
        grantOptions.filter((o) => o.focusSpells?.length).length +
        featFocusSpells.length +
        (devotionSpell ? 1 : 0) +
        featPoolBonus;
    }
    poolMax = Math.min(3, poolMax);
    focus = { current: poolMax, max: poolMax };
  }

  // Class proficiency advancement: raise tracks to expert/master/legendary at the
  // class-defined levels (everything up to the target level). A subclass-specific
  // table (e.g. warpriest doctrine) overrides the class default when present.
  if (build.classId) {
    const adv =
      (build.subclassId ? CLASS_ADVANCEMENT[build.subclassId] : undefined) ?? CLASS_ADVANCEMENT[build.classId] ?? [];
    for (const e of adv) {
      if (e.level <= level) applyAdvancement(proficiencies, spellcasting, e);
    }
    // Dual Class: also apply the second class's advancement (applyAdvancement only ever raises a
    // track via maxRank, so the better-rank-of-two result falls out automatically).
    if (cls2 && build.classId2) {
      const adv2 = (build.subclassId2 ? CLASS_ADVANCEMENT[build.subclassId2] : undefined) ?? CLASS_ADVANCEMENT[build.classId2] ?? [];
      for (const e of adv2) if (e.level <= level) applyAdvancement(proficiencies, spellcasting, e);
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

  // The background's granted skill feat, then every feat picked in a level slot
  // up to the target level (slot key = "level:category:idx"). A feat can only be
  // taken once, so dedup by id (the granted feat wins over a duplicate pick).
  const feats: FeatChoice[] = [];
  const takenFeats = new Set<string>();
  if (background?.grantedFeatId) {
    feats.push({ featId: background.grantedFeatId, level: 1, category: 'skill' });
    takenFeats.add(background.grantedFeatId);
  }
  // Subclass/extra-choice options can grant a fixed bonus feat (bard muse feat, warpriest Shield
  // Block, druid order feat). Auto-grant those with no sub-choice; a choice-gated grant like Domain
  // Initiate is left for a manual slot so its domain pick is surfaced.
  for (const o of grantOptions) {
    for (const fid of o.grantedFeats ?? []) {
      const f = content.feats[fid];
      if (!f || f.choice || takenFeats.has(fid)) continue;
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
      const label = f.choice.options?.find((x) => x.value === value)?.label ?? cap(value);
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
    if (!featId || takenFeats.has(featId)) continue;
    const [lvlStr, cat] = slotKey.split(':');
    const lvl = Number(lvlStr);
    if (!Number.isFinite(lvl) || lvl > level) continue;
    takenFeats.add(featId);
    feats.push({ featId, level: lvl, category: (cat as FeatCategory) ?? 'class', choice: featChoiceById[slotKey] });
  }
  feats.sort((a, b) => a.level - b.level);

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
      const slots = archetypeSlots(level, arch.tier);
      // Summoner: the tradition follows the chosen eidolon TYPE, not a free pick.
      const eidolonTradition = arch.config.eidolonTradition
        ? content.classes.summoner?.subclass?.options.find((o) => o.id === build.archetypeEidolonType)?.tradition
        : undefined;
      const archTradition: Tradition =
        eidolonTradition ??
        (arch.config.choiceTradition
          ? arch.config.traditionOptions?.includes(srcTradition as Tradition)
            ? (srcTradition as Tradition)
            : srcTradition && !arch.config.traditionOptions
              ? srcTradition
              : arch.config.tradition
          : arch.config.tradition);
      // Psychic dedication lets you pick the key attribute (Int or Cha); else the fixed one.
      const archKey: AbilityId =
        arch.config.choiceKeyAbility && srcKey && arch.config.choiceKeyAbility.includes(srcKey)
          ? srcKey
          : arch.config.keyAbility;
      const baseEntry = {
        id: `${arch.dedicationId}-casting`,
        name: `${cap(archTradition)} spellcasting (archetype)`,
        tradition: archTradition,
        keyAbility: archKey,
        proficiency: archetypeProficiency(arch.tier),
        cantrips: srcCantrips.slice(0, arch.config.cantrips),
      };
      if (arch.config.repertoire) {
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
        id: `item:inv-${i}`,
        name: item.name,
        type: 'items',
        tradition,
        keyAbility: caster?.keyAbility ?? 'int',
        proficiency: caster?.proficiency ?? 'trained',
        cantrips: held[0] ?? [],
        repertoire,
      });
    });

    // Innate spells granted by the heritage + taken feats (Seer Elf → detect magic, etc.) — one
    // pooled 'innate' entry (cantrips at-will, leveled spells 1/day), cast at the granted tradition.
    const innateGrants: { spellId: string; tradition?: string }[] = [];
    const heritage = build.heritageId ? content.heritages[build.heritageId] : undefined;
    for (const g of heritage?.innateSpells ?? []) innateGrants.push(g);
    for (const f of feats) for (const g of content.feats[f.featId]?.innateSpells ?? []) innateGrants.push(g);
    const seenInnate = new Set<string>();
    const innate = innateGrants.filter((g) => content.spells[g.spellId] && !seenInnate.has(g.spellId) && seenInnate.add(g.spellId));
    if (innate.length) {
      const innateCantrips = innate.filter((g) => (content.spells[g.spellId]?.rank ?? 0) === 0).map((g) => g.spellId);
      const innateRep: Record<number, string[]> = {};
      for (const g of innate) {
        const r = content.spells[g.spellId]?.rank ?? 0;
        if (r > 0) (innateRep[r] ??= []).push(g.spellId);
      }
      const tc: Record<string, number> = {};
      for (const g of innate) {
        const t = g.tradition ?? content.spells[g.spellId]?.traditions?.[0];
        if (t) tc[t] = (tc[t] ?? 0) + 1;
      }
      const tradition = (Object.entries(tc).sort((a, b) => b[1] - a[1])[0]?.[0] as Tradition) ?? caster?.tradition ?? 'arcane';
      spellcasting.push({
        id: 'innate-casting',
        name: 'Innate spells',
        type: 'innate',
        tradition,
        keyAbility: caster?.keyAbility ?? 'cha',
        proficiency: caster?.proficiency ?? 'trained',
        cantrips: innateCantrips,
        repertoire: innateRep,
      });
    }
  }

  // Resolve the subclass + extra-choice picks (bloodline, ikons, apparitions, …) for
  // display on the sheet, so the choices are visible character abilities.
  const classChoices: { group: string; name: string; description: string; level: number }[] = [];
  if (cls?.subclass && subOption)
    classChoices.push({ group: cls.subclass.name, name: subOption.name, description: subOption.description, level: 1 });
  // Dual Class: also record the second class's subclass.
  if (cls2?.subclass && subOption2)
    classChoices.push({ group: cls2.subclass.name, name: subOption2.name, description: subOption2.description, level: 1 });
  // Extra-choice picks from BOTH classes (element/apparition/subconscious-mind/bloodline/…).
  for (const ec of [cls, cls2] as (ClassDef | undefined)[]) {
    for (const g of ec?.extraChoices ?? []) {
      const lvl = Math.min(...Object.keys(g.pickByLevel).map(Number));
      for (const id of build.extraChoices?.[g.id] ?? []) {
        const o = g.options.find((opt) => opt.id === id);
        if (o) classChoices.push({ group: g.name, name: o.name, description: o.description, level: lvl });
      }
    }
  }

  // Commander tactics: validate the chosen folio against the unlocked tiers + folio capacity.
  let commanderTactics: CommanderTactics | undefined;
  if (ownsClass('commander')) {
    const maxTier = commanderMaxTier(level);
    const maxRank = TACTIC_TIER_RANK[maxTier];
    const folioMax = commanderFolioMax(level);
    const folio = (build.commanderTactics ?? [])
      .filter((id) => {
        const a = content.actions[id];
        return a?.traits?.includes('tactic') && TACTIC_TIER_RANK[(a.tacticTier ?? 'basic') as TacticTier] <= maxRank;
      })
      .slice(0, folioMax);
    commanderTactics = { folio, folioMax, preparedMax: 3, squadmates: 2 + abilityMod(abilities.int), maxTier };
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
      ? { elements: kineticistElements(build, level).map((id) => id.replace(/-gate$/, '')) }
      : undefined;

  return {
    id: `char-${slug(build.name)}`,
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    name: build.name.trim() || 'New character',
    level,
    xp: 0,
    ancestryId: build.ancestryId,
    heritageId: build.heritageId,
    backgroundId: build.backgroundId,
    classId: build.classId,
    subclassId: build.subclassId,
    ...(classChoices.length ? { classChoices } : {}),
    ...(build.variantRules ? { variantRules: build.variantRules } : {}),
    ...(build.options ? { options: build.options } : {}),
    ...(build.variantRules?.dualClass && build.classId2 ? { classId2: build.classId2, subclassId2: build.subclassId2 ?? null } : {}),
    ...(build.variantRules?.abp && build.abpSkills && Object.keys(build.abpSkills).length ? { abpSkills: build.abpSkills } : {}),
    ...(build.variantRules?.abp && build.abpApex ? { abpApex: build.abpApex } : {}),
    keyAbility,
    abilities,
    partialBoosts,
    proficiencies,
    hitPoints: { current: hpMax, temp: 0 },
    heroPoints: 1,
    ...(focus ? { focus } : {}),
    conditions: [],
    classResources: initialClassResources(build.classId, level, {
      str: abilityMod(abilities.str),
      dex: abilityMod(abilities.dex),
      con: abilityMod(abilities.con),
      int: abilityMod(abilities.int),
      wis: abilityMod(abilities.wis),
      cha: abilityMod(abilities.cha),
    }),
    languages: (() => {
      const granted = ancestry?.languages.granted ?? [];
      const slots = Math.max(0, abilityMod(abilities.int)) + (ancestry?.languages.additional ?? 0);
      const bonus = build.languages.filter((l) => !granted.includes(l)).slice(0, slots);
      return [...granted, ...bonus];
    })(),
    feats,
    skillIncreases,
    ...(commanderTactics ? { commanderTactics } : {}),
    ...(inventor ? { inventor } : {}),
    ...(kineticist?.elements.length ? { kineticist } : {}),
    // Deterministic instanceIds (index-based) so buildCharacter stays pure across renders.
    inventory: build.inventory.map((it, i) => ({
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
    })),
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
  if (c.options) b.options = { ...c.options };
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
  }));
  for (const si of c.skillIncreases ?? []) b.skillIncreases[si.level] = si.skill;

  const ancestry = c.ancestryId ? content.ancestries[c.ancestryId] : undefined;
  const cls = c.classId ? content.classes[c.classId] : undefined;
  // Dual Class: a subsystem owned by class `id` may live on the second class.
  const cls2dc = c.variantRules?.dualClass && c.classId2 ? content.classes[c.classId2] : undefined;
  const dcOwns = (id: string): boolean => c.classId === id || (!!c.variantRules?.dualClass && c.classId2 === id);
  const dcDef = (id: string): ClassDef | undefined => (c.classId === id ? cls : cls2dc?.id === id ? cls2dc : undefined);
  const background = resolveBackground(b, content);

  // extraChoices: reverse-map from classChoices by name (skip the subclass entries), across both classes.
  for (const ec of [cls, cls2dc] as (ClassDef | undefined)[]) {
    if (!ec) continue;
    for (const cc of c.classChoices ?? []) {
      if (ec.subclass && cc.group === ec.subclass.name) continue;
      const g = (ec.extraChoices ?? []).find((gg) => gg.name === cc.group);
      const o = g?.options.find((opt) => opt.name === cc.name);
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
    // ABP apex (L17) is a known fixed boost — count it so the level-boost reconstruction doesn't
    // re-spend a slot to reach the apex-boosted score.
    if (c.variantRules?.abp && c.level >= 17 && c.abpApex) fixedCount[c.abpApex] = (fixedCount[c.abpApex] ?? 0) + 1;

    const need: Partial<Record<AbilityId, number>> = {};
    for (const X of ABIL) {
      let s = 10 - 2 * (flawCount[X] ?? 0);
      let total = 0;
      while (s < c.abilities[X] && total < 40) {
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
  const bgFeat = background?.grantedFeatId;
  let bgFeatDropped = false;
  const featsByLevel = new Map<number, FeatChoice[]>();
  for (const f of c.feats) {
    if (!bgFeatDropped && bgFeat && f.featId === bgFeat && f.level === 1 && f.category === 'skill') {
      bgFeatDropped = true;
      continue;
    }
    const arr = featsByLevel.get(f.level) ?? [];
    arr.push(f);
    featsByLevel.set(f.level, arr);
  }
  let synthIdx = 90;
  for (const [lvl, fs] of featsByLevel) {
    const slotCats = c.classId ? levelGrants(lvl, c.classId, content, c.subclassId, c.variantRules, c.classId2, c.subclassId2).featSlots : [];
    const usedSlot = new Set<number>();
    for (const f of fs) {
      let i = slotCats.findIndex((cat, idx) => cat === f.category && !usedSlot.has(idx));
      if (i === -1) i = synthIdx++;
      usedSlot.add(i);
      const key = `${lvl}:${f.category}:${i}`;
      b.featPicks[key] = f.featId;
      if (f.choice) b.featChoices[key] = f.choice.value;
    }
  }

  // Skills: classSkills (and the skilled-human heritage skill) by subtracting recomputable grants.
  {
    const trained = (Object.entries(c.proficiencies.skills) as [ProficiencyKey, ProficiencyRank][])
      .filter(([, r]) => r !== 'untrained')
      .map(([k]) => k);
    const granted = new Set<ProficiencyKey>();
    for (const sk of cls?.trainedSkills.fixed ?? []) granted.add(sk);
    if (background?.trainedSkill) granted.add(background.trainedSkill);
    if (background?.trainedLore) granted.add(`lore:${background.trainedLore}`);
    for (const o of grantOptions) for (const sk of o.grants?.skills ?? []) granted.add(sk);

    let extras = trained.filter((sk) => !granted.has(sk));
    if (c.heritageId === 'skilled-human' && extras.length) {
      const expertExtra = extras.find((sk) => c.proficiencies.skills[sk] === 'expert');
      const hSkill = (expertExtra ?? extras[0]) as SkillId;
      b.heritageSkill = hSkill;
      extras = extras.filter((sk) => sk !== hSkill);
    }
    b.classSkills = extras;
  }

  // Languages: drop the ancestry-granted ones; the remainder are the player's bonus picks.
  const grantedLangs = ancestry?.languages.granted ?? [];
  b.languages = c.languages.filter((l) => !grantedLangs.includes(l));

  // Spellcasting: recover cantrips / spells-by-rank / signatures (subtracting granted spells).
  {
    const grantedSpellSet = new Set<string>();
    for (const o of grantOptions) for (const s of o.grantedSpells ?? []) grantedSpellSet.add(s);
    const classEntry = cls ? c.spellcasting.find((e) => e.id === `${cls.id}-casting`) : undefined;
    if (classEntry) {
      b.cantrips = classEntry.cantrips.filter((s) => !grantedSpellSet.has(s));
      if (classEntry.type === 'spontaneous' && classEntry.repertoire) {
        for (const [rank, ids] of Object.entries(classEntry.repertoire)) b.spells[Number(rank)] = ids.filter((s) => !grantedSpellSet.has(s));
        for (const sigId of classEntry.signature ?? []) {
          const r = content.spells[sigId]?.rank;
          if (r != null) b.signatures[r] = sigId;
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
    // Free Archetype: a bonus archetype-only class feat at every even level (2–20).
    if (variant?.freeArchetype && level >= 2 && level % 2 === 0) featSlots.push('archetype');
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
 *  - ABILITY modifier ("Strength +2"); multiple are treated as an OR group (dedications)
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

export function checkPrerequisites(
  feat: Feat,
  character: Character,
  content: ContentDatabase,
): { met: boolean; unmet: string[] } {
  const unmet: string[] = [];
  const abilityLines: string[] = [];
  let abilityGroupMet = false;

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
      abilityLines.push(line);
      if (abilityMod(character.abilities[ABILITY_BY_NAME[am[1].toLowerCase()]]) >= Number(am[2])) abilityGroupMet = true;
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
  if (abilityLines.length && !abilityGroupMet) unmet.push(...abilityLines);
  return { met: unmet.length === 0, unmet };
}
