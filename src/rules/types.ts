/*
 * The data contract.
 *
 * This file is the single interface that the whole app speaks. Three ideas:
 *
 *  1. CONTENT entities (Ancestry, Class, Feat, Spell, Item, ...) are the rules
 *     *definitions*. They are immutable reference data, looked up by id from a
 *     ContentDatabase. Each carries a `source` so provenance + license travel
 *     with the data.
 *
 *  2. A CHARACTER stores the player's *choices* and references content by id
 *     (ancestryId, feats[].featId, inventory[].itemId, ...). It never stores
 *     numbers that can be computed.
 *
 *  3. DERIVED values (ability modifiers, AC, save/skill totals, spell DC, ...)
 *     are produced by the calc layer (rules/derive.ts) from Character + content.
 *     They are intentionally absent here.
 *
 * Get this right and the data pipeline (importer) and the UI (sheet/builder)
 * can be built independently against it.
 */

/* =========================================================================
 * 1. Canonical vocabularies + primitive types
 * ========================================================================= */

/** The six attributes (a.k.a. ability scores). */
export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type AbilityId = (typeof ABILITIES)[number];

export const SAVES = ['fortitude', 'reflex', 'will'] as const;
export type SaveId = (typeof SAVES)[number];

/** The 16 core skills. Lore subjects are tracked separately as `lore:<subject>`. */
export const SKILLS = [
  'acrobatics',
  'arcana',
  'athletics',
  'crafting',
  'deception',
  'diplomacy',
  'intimidation',
  'medicine',
  'nature',
  'occultism',
  'performance',
  'religion',
  'society',
  'stealth',
  'survival',
  'thievery',
] as const;
export type SkillId = (typeof SKILLS)[number];

/** A proficiency slot key: a core skill, or a lore like `lore:warfare`. */
export type ProficiencyKey = SkillId | `lore:${string}`;

export const PROFICIENCY_RANKS = ['untrained', 'trained', 'expert', 'master', 'legendary'] as const;
export type ProficiencyRank = (typeof PROFICIENCY_RANKS)[number];

export const TRADITIONS = ['arcane', 'divine', 'occult', 'primal'] as const;
export type Tradition = (typeof TRADITIONS)[number];

export type Size = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'unique';

export type WeaponCategory = 'unarmed' | 'simple' | 'martial' | 'advanced';
export type ArmorCategory = 'unarmored' | 'light' | 'medium' | 'heavy';

/** A proficiency track that a class advances as you level (used by class advancement tables). */
export type AdvancementTrack =
  | 'perception'
  | SaveId
  | 'classDc'
  | 'spellcasting'
  | WeaponCategory
  | ArmorCategory
  /** Weapon-group proficiency (alchemist bombs, gunslinger firearms). */
  | 'bomb'
  | 'firearm'
  | 'crossbow';

/** One step of a class's automatic proficiency progression. */
export interface AdvancementEntry {
  level: number;
  track: AdvancementTrack;
  rank: ProficiencyRank;
  /** The class feature slug (or note) this increase comes from. */
  source?: string;
}

export type Vision = 'normal' | 'low-light' | 'darkvision';

export type DieSize = 'd4' | 'd6' | 'd8' | 'd10' | 'd12';

/** Open union: keeps autocomplete for the common types but allows any string. */
export type DamageType =
  | 'bludgeoning'
  | 'piercing'
  | 'slashing'
  | 'acid'
  | 'cold'
  | 'electricity'
  | 'fire'
  | 'sonic'
  | 'vitality'
  | 'void'
  | 'mental'
  | 'poison'
  | 'bleed'
  | 'force'
  | 'spirit'
  | 'untyped'
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

/** Traits are an open vocabulary (referenced by id into the trait registry). */
export type Trait = string;

/** Activation cost of an action, activity, spell, or feat. */
export type ActionCost =
  | { type: 'actions'; value: 1 | 2 | 3 }
  | { type: 'reaction' }
  | { type: 'free' }
  /** e.g. Heal "1 to 3 actions". */
  | { type: 'variable'; min: 1 | 2 | 3; max: 1 | 2 | 3 }
  /** Static / no activation. */
  | { type: 'passive' }
  /** Time-based, e.g. "10 minutes". */
  | { type: 'duration'; text: string };

/**
 * Bulk encoded numerically so it sums cleanly for encumbrance:
 *   0   = negligible (displayed "—")
 *   0.1 = Light       (displayed "L")
 *   n   = n Bulk
 */
export type Bulk = number;

/** A price / coin amount. All fields optional; absent = 0. */
export interface Coins {
  pp?: number;
  gp?: number;
  sp?: number;
  cp?: number;
}
export type Price = Coins;

/** Provenance for a content entry — keeps attribution + license with the data. */
export interface SourceInfo {
  book?: string;
  page?: number;
  /** ORC = Open RPG Creative, OGL = Open Game License, CUP = Community Use, homebrew = user-made. */
  license?: 'ORC' | 'OGL' | 'CUP' | 'homebrew';
}

/** Movement speeds in feet. */
export interface Speeds {
  land?: number;
  fly?: number;
  swim?: number;
  climb?: number;
  burrow?: number;
}

/* =========================================================================
 * 2. Ability boosts/flaws (used by content; resolved by the builder)
 * ========================================================================= */

/**
 * An ability boost granted by a source. Ancestry/background/class declare these
 * so the builder can compute final scores and validate selections.
 */
export type AbilityBoost =
  | { kind: 'fixed'; ability: AbilityId }
  | { kind: 'free' }
  | { kind: 'choice'; options: AbilityId[] };

export type AbilityScores = Record<AbilityId, number>;

/* =========================================================================
 * 3. Content entities (immutable rules definitions, looked up by id)
 * ========================================================================= */

/** A cross-reference inside a description: the linked term + which content map it points to.
 *  Drives the in-description "tap a word to read its description" navigation. */
export interface DescRef {
  /** The linked text as it appears in the description (e.g. "Frightened 2", "Strike"). */
  label: string;
  /** The ContentDatabase key the term resolves against (e.g. "spells", "conditions"). */
  key: string;
}

/** A favorited description popup: enough to re-render the description (and its cross-links)
 *  without a content lookup. Structurally a superset-compatible match for the sheet's DescNode. */
export interface PinnedDesc {
  title: string;
  description: string;
  descRefs?: DescRef[];
  /** The content-map name this entry came from ('feats'/'spells'/'actions'/…). Part of the pin
   *  identity, so two same-named entries from different maps (a feat + a spell) don't collide.
   *  Absent on entries pinned before this discriminator existed (they fall back to title-only). */
  key?: string;
}

interface ContentBase {
  id: string;
  name: string;
  traits: Trait[];
  rarity: Rarity;
  /** Rich rules text (Markdown/HTML). Open Game / ORC content. */
  description: string;
  /** Cross-references found in `description` (from Foundry @UUID links), for in-text linking. */
  descRefs?: DescRef[];
  source?: SourceInfo;
  /** App-level link to the user Homebrew source that authored this entry (groups it in the Homebrew
   *  manager). Absent on imported/seed content. Ignored by the rules engine. */
  homebrewSourceId?: string;
}

/** A precise/imprecise/vague sense granted by a feat, heritage, or class feature. */
export interface SenseEntry {
  /** The sense selector, e.g. "darkvision", "scent", "tremorsense". */
  name: string;
  /** Range in feet, if limited. */
  range?: number;
  acuity?: 'precise' | 'imprecise' | 'vague';
}

/** A resistance or weakness entry. `value` may be a level formula string
 *  (e.g. "max(1,floor(@actor.level/2))"), resolved per-character in derive. */
export interface IwrEntry {
  type: string;
  value: number | string;
}

/** Innate defenses (senses + IWR) a content item grants. Mixed into Heritage,
 *  Feat, and ClassFeature; parsed from Foundry rule elements at import. */
export interface DefenseGrants {
  senses?: SenseEntry[];
  resistances?: IwrEntry[];
  weaknesses?: IwrEntry[];
  immunities?: string[];
  /** Unconditional non-land speeds granted (fly/swim/climb/burrow), in feet. */
  speeds?: Partial<Speeds>;
  /** True when this feature/feat grants weapon critical specialization (a CriticalSpecialization
   *  rule element). Drives whether Strikes show their critical-specialization effect. */
  critSpec?: boolean;
  /** The level the crit-spec effect activates, when gated by `self:level >= N` (e.g. ancestry
   *  weapon-familiarity feats grant it at 5, even though the feat is taken at 1). */
  critSpecLevel?: number;
  /** Weapon restriction on the crit-spec grant — only matching weapons show the effect. */
  critSpecWeapons?: { groups?: string[]; traits?: string[]; bases?: string[]; melee?: boolean };
  /** Melee unarmed Strikes this feat/feature grants (from Foundry `Strike` rule elements). */
  grantedStrikes?: GrantedStrike[];
}

export interface Ancestry extends ContentBase {
  hp: number;
  size: Size;
  speeds: Speeds;
  abilityBoosts: AbilityBoost[];
  abilityFlaws: AbilityId[];
  vision: Vision;
  languages: {
    granted: string[]; // language ids always known
    additional: number; // extra languages = this + Int modifier
    options?: string[]; // restricted pool, if any
  };
  /** Heritage ids belonging to this ancestry. */
  heritages: string[];
  /** Melee unarmed Strikes granted unconditionally by this ancestry (e.g. conrasu). */
  grantedStrikes?: GrantedStrike[];
}

/** An innate spell a feat/heritage grants (cast at a fixed tradition; cantrips at-will, else 1/day). */
export interface InnateSpellGrant {
  spellId: string;
  tradition?: string;
  atWill?: boolean;
}

export interface Heritage extends ContentBase, DefenseGrants {
  /** The owning ancestry, or null for a versatile heritage (any ancestry). */
  ancestryId: string | null;
  versatile: boolean;
  /** Grants a level-1 general feat of the player's choice (Versatile Human). The pick lives in
   *  BuildState.heritageFeatId. */
  grantsGeneralFeat?: boolean;
  /** Innate spells this heritage grants (e.g. Seer Elf → detect magic). */
  innateSpells?: InnateSpellGrant[];
}

export interface Background extends ContentBase {
  abilityBoosts: AbilityBoost[];
  /** Skill the background trains you in. */
  trainedSkill?: SkillId;
  /** A "trained in your choice of X or Y" background: the offered skills (trainedSkill is unset).
   *  The pick lives in BuildState.backgroundSkillChoice; unpicked defaults to the first option. */
  trainedSkillChoice?: SkillId[];
  /** Lore subject granted (the `lore:` part). */
  trainedLore?: string;
  /** A skill feat granted by the background. */
  grantedFeatId?: string;
}

export type FeatCategory =
  | 'class'
  | 'ancestry'
  | 'heritage'
  | 'skill'
  | 'general'
  | 'archetype'
  | 'bonus'
  | 'mythic';

/** An embedded sub-choice a feat prompts when taken (a Foundry ChoiceSet). */
export interface FeatChoiceDef {
  flag: string;
  prompt: string;
  /** 'domains' resolves options from the deity at build time; 'array' carries fixed options. */
  kind: 'domains' | 'array';
  options?: { value: string; label: string; description?: string }[];
}

export interface Feat extends ContentBase, DefenseGrants {
  level: number;
  category: FeatCategory;
  prerequisites?: string[];
  actionCost?: ActionCost;
  frequency?: string;
  trigger?: string;
  requirements?: string;
  access?: string;
  /** A sub-choice made when taking the feat (Domain Initiate domain, etc.). */
  choice?: FeatChoiceDef;
  /** For archetype feats: the slug of the archetype it belongs to (from the import path). */
  archetype?: string;
  /** Focus spell(s) this feat grants (e.g. Blessed One Dedication → Lay on Hands). Only set when the
   *  feat also grants a focus pool point, so each entry contributes one focus point. */
  focusSpells?: string[];
  /** Focus pool points this feat adds when it grants/expands a pool but names no single focus spell
   *  (e.g. a choice-gated "increase your focus pool by 1" feat). */
  focusPoolBonus?: number;
  /** Innate spells this feat grants (cast at a fixed tradition; cantrips at-will, else 1/day). */
  innateSpells?: InnateSpellGrant[];
  /** Max-HP modifier (Toughness/Mountain's Stoutness = perLevel 1; Thick Hide Mask = flat 20;
   *  Ghostly Resistance = perLevel -1). */
  maxHpBonus?: { perLevel?: number; flat?: number };
}

export interface ClassFeature extends ContentBase, DefenseGrants {
  level: number;
  actionCost?: ActionCost;
  /** Foundry classification tags (e.g. `armor-innovation-modification`) used to filter selectable options. */
  otherTags?: string[];
}

/** A standalone action (Strike, Seek, Demoralize, …) — referenced throughout rules text. */
export interface Action extends ContentBase {
  actionCost?: ActionCost;
  /** Commander tactic tier (gates folio availability by level): basic@1, expert@7, master@15, legendary@19. */
  tacticTier?: 'basic' | 'expert' | 'master' | 'legendary';
}

/** An inventor's resolved innovation + chosen tiered modifications (initial@1, breakthrough@7, revolutionary@15). */
export interface InventorBuild {
  innovationType: 'armor' | 'weapon' | 'construct';
  /** Armor innovation's base statistics set (gates several armor modifications). */
  armorStats?: 'power-suit' | 'subterfuge-suit';
  /** Chosen modification ids by tier (construct modifications are prose-only, so unselectable). */
  modifications: { initial?: string; breakthrough?: string; revolutionary?: string };
}

/** A Commander's resolved tactics: the folio of known tactics + how many may be prepared/squadmates. */
export interface CommanderTactics {
  /** Action ids of the chosen folio tactics (clamped to `folioMax`, filtered to unlocked tiers). */
  folio: string[];
  /** Folio capacity at this level (5 at L1, +2 at L7/L15/L19). */
  folioMax: number;
  /** Tactics prepared per day (always 3). */
  preparedMax: number;
  /** The tactics prepared today (subset of `folio`, ≤ preparedMax); overlaid from play-state. */
  prepared?: string[];
  /** Squadmates you can drill (2 + Int modifier). */
  squadmates: number;
  /** Highest unlocked tactic tier (drives the picker filter). */
  maxTier: 'basic' | 'expert' | 'master' | 'legendary';
}

/**
 * One option of a class choice — a subclass (Instinct, Doctrine, Bloodline, …) or
 * an "extra choice" (psychic subconscious mind, animist apparition, exemplar ikon,
 * kineticist element). Most fields are optional grants the option confers.
 */
export interface SubclassOption {
  id: string;
  name: string;
  description: string;
  /** Cross-references in `description` (for in-text linking). */
  descRefs?: DescRef[];
  /** Overrides the class's spell tradition (e.g. a witch patron picks the tradition). */
  tradition?: Tradition;
  /** Overrides the spellcasting key ability (e.g. psychic subconscious mind = Int or Cha). */
  keyAbility?: AbilityId;
  /** The option makes the key attribute a CHOICE among these (rogue racket = the racket's attribute
   *  or Dex). First entry is the default when the player hasn't picked. */
  keyAbilityOptions?: AbilityId[];
  /** Focus spell ids this option grants (druid order spell, wizard school spell, witch hex). */
  focusSpells?: string[];
  /** Feat-gated advanced focus spell (Advanced Bloodline / Advanced Revelation grants this). */
  advancedFocusSpell?: string;
  /** Feat-gated greater focus spell (Greater Bloodline / Greater Revelation grants this). */
  greaterFocusSpell?: string;
  /** Spell ids added to the caster's repertoire/known list (psychic conscious mind, apparition ladder). */
  grantedSpells?: string[];
  /** Feat ids this option grants for free (bard muse feat, warpriest Shield Block, druid order feat). */
  grantedFeats?: string[];
  /** Feats granted WITH a restricted embedded sub-choice (Dominion Epithet → Energized Spark for 2 energy types). */
  grantedChoiceFeats?: { featId: string; restrictTo?: string[] }[];
  /** Mechanical proficiencies granted by the subclass (order/racket skill, ruffian armor, …). */
  grants?: {
    skills?: SkillId[];
    weapons?: WeaponCategory[];
    armor?: ArmorCategory[];
  };
  /** A restricted skill choice the subclass grants (gunslinger Pistolero way, investigator Empiricism). */
  skillChoice?: SkillId[];
  /** Sorcerer Draconic: the dragon exemplar options (each sets the spell tradition + 2nd bloodline skill). */
  dragonChoice?: { slug: string; label: string; tradition: Tradition; skill: SkillId; damageType: string }[];
  /** This subclass requires choosing a deity even when the class normally doesn't (rogue Avenger). */
  requiresDeity?: boolean;
  /** Overrides the class's spell-slot progression (cleric Battle Creed = the reduced two-rank table). */
  slotProgression?: SpellProgression;
  /** Class features this subclass removes (cleric Battle Creed drops Resolute Faith + Miraculous Spell). */
  suppressedFeatures?: string[];
}

/**
 * A class choice made IN ADDITION to the single subclass: a group the player picks
 * one or more options from (psychic subconscious mind ×1, animist apparitions ×2→4,
 * exemplar ikons ×3→4, kineticist elements). `pickByLevel` is the cumulative count
 * allowed by character level (e.g. {1:2,7:3,15:4}); options reuse SubclassOption.
 */
export interface ChoiceGroup {
  id: string;
  name: string;
  pickByLevel: Record<number, number>;
  options: SubclassOption[];
}

/** Spell slots available per character level, then per spell rank. */
export type SpellSlotTable = Record<number, Record<number, number>>;

/**
 * Which spell-slot table a class uses:
 * - 'full' — the universal full-caster table (3 slots/rank, new rank every 2 levels).
 * - 'two-rank' — magus/summoner: 2 slots of the top rank + 2 of the rank below.
 * - 'psychic' — full rank progression but only 2 slots/rank (1 for a new rank).
 * - 'animist' — combined per-rank total of its prepared + apparition pools.
 */
export type SpellProgression = 'full' | 'two-rank' | 'psychic' | 'animist';

export interface ClassSpellcasting {
  type: SpellcastingType;
  tradition: Tradition;
  keyAbility: AbilityId;
  /** True for spontaneous (repertoire) casters. */
  repertoire: boolean;
  /** Which spells-per-day table to use (default 'full'). */
  progression?: SpellProgression;
  /** Slot progression; absent for non-slot casters. */
  slots?: SpellSlotTable;
}

export interface ClassDef extends ContentBase {
  /** One entry = fixed key attribute; multiple = player chooses one (e.g. Str/Dex). */
  keyAbility: AbilityId[];
  hpPerLevel: number;
  perception: ProficiencyRank;
  saves: Record<SaveId, ProficiencyRank>;
  attacks: Record<WeaponCategory, ProficiencyRank>;
  /** Weapon-GROUP proficiency from the class's "other" attack entry (alchemist bombs, gunslinger firearms). */
  attackGroups?: Record<string, ProficiencyRank>;
  defenses: Record<ArmorCategory, ProficiencyRank>;
  classDc: ProficiencyRank;
  trainedSkills: {
    fixed: SkillId[];
    /** Additional trainings = this + Int modifier. */
    additional: number;
    /** A restricted "trained in one of these" class skill choice (thaumaturge esoteric skills). */
    choice?: SkillId[];
    /** A fixed Lore subject the class trains (e.g. thaumaturge Esoteric Lore). */
    lore?: string;
  };
  /** e.g. { name: 'Doctrine', options: [...] }. Absent for feat-defined classes (Fighter). */
  subclass?: { name: string; options: SubclassOption[] };
  /** Multi-pick choices beyond the subclass (subconscious mind, apparitions, ikons, elements). */
  extraChoices?: ChoiceGroup[];
  spellcasting?: ClassSpellcasting;
  /** Class features granted automatically, by level. */
  features: { level: number; featureId: string }[];
  /** Character levels at which each kind of feat is granted. */
  featProgression: {
    class: number[];
    skill: number[];
    general: number[];
    ancestry: number[];
  };
  /** Character levels at which a skill increase is granted (rogue gets extras). */
  skillIncreaseLevels: number[];
  /** Focus spells granted by the class itself, regardless of subclass (e.g. bard compositions). */
  focusSpells?: string[];
}

export type SpellRank = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type SpellComponent = 'verbal' | 'somatic' | 'material' | 'focus';

export interface FixedHeightenLevel {
  /** Absolute replacement formula at this rank (e.g. cantrip "2d6"). */
  damage?: string;
  area?: number;
  range?: string;
  target?: string;
  duration?: string;
}
export type SpellHeightening =
  | { type: 'interval'; interval: 1 | 2; damageIncr?: string; areaIncr?: number }
  | { type: 'fixed'; levels: Partial<Record<SpellRank, FixedHeightenLevel>> };

export interface Spell extends ContentBase {
  /** 0 = cantrip. */
  rank: SpellRank;
  traditions: Tradition[];
  /** A ritual (tradition-less; cast by anyone meeting the primary-check proficiency). */
  ritual?: boolean;
  /** The ritual's primary skill check (e.g. "Religion (master)"). */
  ritualPrimary?: string;
  cast: ActionCost;
  components?: SpellComponent[];
  range?: string;
  area?: string;
  targets?: string;
  duration?: string;
  /** Saving throw the target rolls, if any. */
  save?: { type: SaveId; basic?: boolean };
  /** What the spell attacks against (spell attack roll vs AC, or a save). */
  defense?: SaveId | 'ac';
  heightening?: SpellHeightening;
  /** Primary base damage/heal dice formula (for upcast scaling display). */
  baseDamage?: string;
  damageKind?: 'damage' | 'healing';
  /** Structured base area (companion to the prose `area` string), in feet. */
  baseArea?: { value: number; kind: string };
}

/* ---- Items: a discriminated union on `itemType` ---- */

interface ItemBase extends ContentBase {
  level: number;
  price?: Price;
  bulk: Bulk;
  usage?: string;
  hands?: 0 | 1 | 2 | '1+';
  /** Physical size of the item (rarely set; mostly used for oversized/creature gear). */
  size?: Size;
  /** Precious material (adamantine, cold-iron, dawnsilver, …) the item is made of, if any. */
  material?: { type: string; grade?: 'low' | 'standard' | 'high' };
  /** Limited-use activation frequency parsed from the description (e.g. {max:1, per:'day'}).
   *  Items with this get an automatic uses tracker; per:'day' (and sub-daily) reset on rest. */
  frequency?: { max: number; per: string };
  /** Action cost to Activate this item, parsed from the "Activate" line (drives the Item-actions list). */
  activationCost?: ActionCost;
  /** Spells held by a staff/wand/spellheart, by rank (0 = cantrips) — a magic-item spell source. */
  heldSpells?: Record<number, string[]>;
  /** A GENERIC scroll/wand ("Scroll of Nth-rank Spell") whose held spell the player chooses: the rank
   *  it can hold and (if the item is tradition-locked, e.g. a Cyrusian wand) the allowed traditions. */
  spellSlot?: { rank: number; traditions?: Tradition[] };
  /** Trackable use pools/abilities — each becomes its own counter chip. Staff charge pools,
   *  "X per day" activations, and multi-use stock all live here. `max:'level'` resolves to the
   *  item's level at derive time (a staff's charges = its level). An item can have several. */
  counters?: ItemCounter[];
  /** Free-text Craft requirements (formulas, special ingredients) shown when crafting the item. */
  craftRequirements?: string;
  /** Apex item (trait `apex`): the attribute it raises while invested — to 18, or +2 if already 18+.
   *  Only one apex item works at a time. */
  apexAttribute?: AbilityId;
}

/** A static descriptor of one trackable pool/ability on an item definition. */
export interface ItemCounter {
  id: string;
  label: string;
  /** A fixed maximum, or 'level' to resolve to the item's level (staff charge pools). */
  max: number | 'level';
  /** day/hour/minute/round/turn/week/month for a recurring use; absent for a raw pool. */
  per?: string;
  /** Daily preparations refill it (true for day & sub-daily; false for week/month/finite stock). */
  resetsOnRest: boolean;
  /** Starts at max (default). false = starts empty and builds up (e.g. Tactician's Helm). */
  startsFull?: boolean;
}

export interface WeaponItem extends ItemBase {
  itemType: 'weapon';
  category: WeaponCategory;
  /** Weapon group: sword, axe, bow, bomb, ... */
  group: string;
  damage: { dice: number; die: DieSize; type: DamageType };
  /** Range increment in feet (ranged/thrown). */
  range?: number;
  reload?: number;
}

export interface ArmorItem extends ItemBase {
  itemType: 'armor';
  category: ArmorCategory;
  group?: string;
  acBonus: number;
  dexCap?: number;
  checkPenalty?: number;
  speedPenalty?: number;
  /** Strength score that removes the check penalty. */
  strength?: number;
}

export interface ShieldItem extends ItemBase {
  itemType: 'shield';
  acBonus: number;
  hardness: number;
  hp: number;
  brokenThreshold: number;
  speedPenalty?: number;
}

export interface ConsumableItem extends ItemBase {
  itemType: 'consumable';
  consumableType?: 'potion' | 'scroll' | 'wand' | 'oil' | 'talisman' | 'ammunition' | 'other';
  uses?: { current: number; max: number };
  /** For scrolls/wands: the spell they cast and at what rank. */
  spell?: { spellId: string; rank: SpellRank };
}

export interface ContainerItem extends ItemBase {
  itemType: 'container';
  capacity?: { bulk: number };
  /** Bulk this container ignores (e.g. a backpack ignores the first Bulk). */
  ignoredBulk?: number;
}

export interface EquipmentItem extends ItemBase {
  itemType: 'equipment';
}

export interface TreasureItem extends ItemBase {
  itemType: 'treasure';
  value: Price;
}

export type Item =
  | WeaponItem
  | ArmorItem
  | ShieldItem
  | ConsumableItem
  | ContainerItem
  | EquipmentItem
  | TreasureItem;

export interface Deity extends ContentBase {
  edicts?: string[];
  anathema?: string[];
  divineFont?: ('heal' | 'harm')[];
  domains?: string[];
  /** Favored weapon item ids (a worshipper's class may grant proficiency in these). */
  favoredWeapons?: string[];
  /** The skill the deity grants training in. */
  skill?: string;
}

export interface Language {
  id: string;
  name: string;
  rarity: Rarity;
  source?: SourceInfo;
}

/** The full reference dataset, keyed by id. The importer produces one of these. */
/** An animal-companion TYPE (wolf, bear, …): per-type data; level/maturity scaling is a formula. */
export interface AnimalCompanionType {
  id: string;
  name: string;
  /** 'animal' (default) or 'construct' — a construct companion uses the same advancement
   *  math but is a Construct (different trait/flavor). Lets one derive path serve both. */
  category?: 'animal' | 'construct';
  size: string;
  /** Per-type base ("ancestry") Hit Points, added on top of (6 + Con) per level. Varies by
   *  species (Bird 4, Wolf 6, Bear 8, …); defaults to 6 when absent. */
  hp?: number;
  /** Young-stage ability modifiers (don't scale except via specialization). */
  abilities: Record<AbilityId, number>;
  senses: string[];
  speeds: { land?: number; fly?: number; swim?: number; climb?: number; burrow?: number };
  attacks: { name: string; die: string; damageType: string; traits: string[] }[];
  /** Signature trained skills beyond the universal Acrobatics + Athletics. */
  skills: SkillId[];
  support: string;
  maneuver: string;
}

/** A familiar / master ability (from the familiar-abilities pack). */
export interface FamiliarAbility {
  id: string;
  name: string;
  /** 'master' abilities require the master to act; 'familiar' are innate. */
  kind: 'master' | 'familiar';
  description: string;
}

/** An animal-companion specialization (Ambusher, Racer, …), chosen when a companion becomes
 *  specialized. Applies these deltas on top of the generic specialized benefits. */
export interface Specialization {
  id: string;
  name: string;
  description: string;
  /** Skills this specialization advances to a given rank (overrides the maturity rank). */
  skills?: { skill: SkillId; rank: ProficiencyRank }[];
  /** Additional ability-modifier boosts. */
  abilityBoosts?: Partial<Record<AbilityId, number>>;
  /** Raises unarmored-defense (AC) proficiency to this rank, if higher. */
  acRank?: ProficiencyRank;
  /** Bonus to land Speed (Racer +10 ft). */
  speedBonus?: number;
  /** Effects not captured numerically (shown as a note). */
  note?: string;
}

/** A lightweight companion (Follower or Pet) — informational, no full stat-block math. */
export interface SimpleCompanion {
  id: string;
  name: string;
  kind: 'follower' | 'pet';
  description: string;
  notes?: string;
  traits?: string[];
}

/** A purchasable service (hireling, spellcasting, lodging, transport) — a priced reference row. */
export interface ServiceEntry {
  id: string;
  name: string;
  level: number;
  price?: string;
  description: string;
  traits?: string[];
}

/** A vehicle reference statblock (curated, hand-authored — not character-stat-affecting). */
export interface VehicleStat {
  id: string;
  name: string;
  level: number;
  price?: string;
  size: string;
  space?: string;
  crew?: string;
  pilotingDC?: number;
  ac: number;
  fort?: number;
  hp: number;
  brokenThreshold?: number;
  hardness: number;
  immunities?: string[];
  speeds?: string;
  collision?: string;
  traits?: string[];
  description?: string;
}

/** A siege-weapon reference statblock (curated): the vehicle defensive frame + one or more attacks. */
export interface SiegeWeaponStat extends VehicleStat {
  attacks?: { name: string; actionCost?: string; bonus?: number; damage?: string; range?: string; reload?: string }[];
}

/* ---- modes: user-defined toggleable modifier sets ---- */

export type ModifierType = 'status' | 'circumstance' | 'item' | 'untyped';

/** Which stat a mode modifier targets. 'all-checks' = every check + DC (frightened-style). */
export type ModeTargetKind =
  | 'all-checks'
  | 'ac'
  | 'save'
  | 'perception'
  | 'skill'
  | 'attack'
  | 'damage'
  | 'spell-attack'
  | 'spell-dc'
  | 'class-dc';

export interface ModeModifier {
  value: number;
  type: ModifierType;
  target: ModeTargetKind;
  /** For target 'save' → save id; 'skill' → skill key (e.g. 'stealth' / 'lore:warfare'). */
  detail?: string;
  /** Free-text "applies when …". When present the modifier is CONDITIONAL: it doesn't change
   *  the number (the player applies it situationally), but underlines the stat + shows here. */
  appliesWhen?: string;
}

/** A toggleable bonus/penalty set (Raise a Shield, Inspire Courage, a homebrew effect, …). */
export interface ModeDef {
  id: string;
  name: string;
  /** Optional grouping for the template catalog / predefined list ('General', 'Bard', …). */
  category?: string;
  modifiers: ModeModifier[];
  /** App-provided modes are directly toggleable (and class/ancestry-gated), not just editor templates. */
  predefined?: boolean;
  /** Only one active mode per group at a time (e.g. bard compositions, rage states). */
  exclusiveGroup?: string;
  /** Gate to these class content-ids (absent ⇒ relevant to any class). */
  classes?: string[];
  /** Gate to these ancestry content-ids (absent ⇒ relevant to any ancestry). */
  ancestries?: string[];
  /** Gate to characters who have one of these feat ids (e.g. an archetype dedication). Used for
   *  archetype modes so they only show for characters who took the archetype. */
  feats?: string[];
  /** Short note describing effects that aren't captured as numeric modifiers (shown in the list). */
  note?: string;
  /** Scope of a USER-created mode: a roster character id ⇒ only that character sees it; absent ⇒
   *  universal (every character on this device). Catalog/predefined modes never set this. */
  charId?: string;
}

export type CompanionKind = 'animal' | 'familiar' | 'eidolon' | 'follower' | 'pet' | 'vehicle' | 'siege';

/** A companion the player has chosen, stored on the character (derived into a stat block). */
/** Summoner-eidolon configuration: the eidolon's own ability mods (from its chosen Eidolon Array
 *  plus level boosts), optional AC tweaks from the array, and its two unarmed-attack forms. */
export interface EidolonConfig {
  /** Ability MODIFIERS, derived by the player from the chosen array + ability boosts. */
  abilities?: Partial<Record<AbilityId, number>>;
  /** The array's item bonus to AC (armor, scales, deflection aura, …). */
  acItemBonus?: number;
  /** The array's Dexterity cap on AC, if any. */
  dexCap?: number;
  /** Primary unarmed attack: form name (Claw, Jaws…), damage type, and the stat-option id. */
  primary?: { name?: string; damageType?: DamageType; option?: string };
  /** Secondary unarmed attack (always 1d6, agile + finesse): form name + damage type. */
  secondary?: { name?: string; damageType?: DamageType };
}

export interface CompanionConfig {
  id: string;
  kind: CompanionKind;
  name: string;
  /** Animal-companion type id, or eidolon type id (a summoner-eidolon subclass option). */
  typeId?: string;
  /** Summoner eidolon: its own ability mods + chosen unarmed attacks. */
  eidolon?: EidolonConfig;
  /** Animal companion maturity: young | mature | nimble | savage | specialized. */
  maturity?: string;
  /** Animal companion specialization id (Ambusher, Racer, …), chosen when specialized. */
  specialization?: string;
  /** Familiar: chosen familiar-ability ids. */
  abilities?: string[];
  /** Familiar: a specific-familiar template id (Pipefox, Imp, …); absent = a generic familiar. */
  specificFamiliarId?: string;
  /** The companion's own gear (barding, packs, …), tracked separately from the character's. */
  inventory?: InventoryItem[];
  /** Companion portrait — a data URL the player imported (mirrors the character portrait). */
  portrait?: string;
}

export interface ContentDatabase {
  ancestries: Record<string, Ancestry>;
  heritages: Record<string, Heritage>;
  backgrounds: Record<string, Background>;
  classes: Record<string, ClassDef>;
  classFeatures: Record<string, ClassFeature>;
  feats: Record<string, Feat>;
  spells: Record<string, Spell>;
  items: Record<string, Item>;
  deities: Record<string, Deity>;
  languages: Record<string, Language>;
  animalCompanions: Record<string, AnimalCompanionType>;
  familiarAbilities: Record<string, FamiliarAbility>;
  /** Animal-companion specializations (Ambusher, Racer, …). */
  companionSpecializations?: Record<string, Specialization>;
  /** Follower companions (role NPCs) and Pet companions (tiny minions). */
  followers?: Record<string, SimpleCompanion>;
  pets?: Record<string, SimpleCompanion>;
  /** Curated, hand-authored reference content (not in the SRD bundle): services, vehicles, siege weapons. */
  services?: Record<string, ServiceEntry>;
  vehicles?: Record<string, VehicleStat>;
  siegeWeapons?: Record<string, SiegeWeaponStat>;
  conditions: Record<string, Condition>;
  /** Standalone actions (Strike, Seek, …) — used for in-description links. */
  actions: Record<string, Action>;
  /** Toggleable modifier sets — built-in catalog merged with the user's saved modes. */
  modes: Record<string, ModeDef>;
  /** Etchable runes (potency/striking/resilient/reinforcing + property runes), keyed by id. */
  runes: Record<string, RuneDef>;
}

/** An etchable rune (a weapon/armor/shield enhancement). */
export interface RuneDef {
  id: string;
  name: string;
  slot: 'weapon' | 'armor' | 'shield';
  /** Fundamental kinds vs a property rune. */
  kind: 'potency' | 'striking' | 'resilient' | 'reinforcing' | 'property';
  /** potency: the +N; striking/resilient/reinforcing: tier 1–3 (–6 for reinforcing). */
  value?: number;
  level: number;
  price?: Price;
  /** Property runes that add Strike damage (e.g. Flaming → 1d6 fire). */
  damage?: { dice: number; die: DieSize; type: DamageType; critPersistent?: { dice: number; die: DieSize } };
}

/* =========================================================================
 * 4. Character (the player's saved choices)
 * ========================================================================= */

export interface HitPoints {
  current: number;
  temp: number;
  /** Optional manual max override; otherwise max is derived. */
  maxOverride?: number;
}

export interface FocusPool {
  current: number;
  max: number;
}

/** A condition currently affecting the character (value for valued ones). */
export interface ActiveCondition {
  /** Condition id, e.g. 'frightened', 'clumsy'. */
  id: string;
  /** For valued conditions, e.g. Frightened 2. */
  value?: number;
}

/** A PF2e condition definition (the browsable rules entry). */
export interface Condition {
  id: string;
  name: string;
  description: string;
  /** Cross-references in `description` (for in-text linking). */
  descRefs?: DescRef[];
  /** True for conditions that carry a numeric value (Frightened 2, Clumsy 1, …). */
  valued: boolean;
  /** Foundry's condition group (senses, death, attitudes, detection, abilities), if any. */
  group?: string | null;
  /** Source book (only carried by added campaign conditions, e.g. Kingmaker — used for visibility gating). */
  source?: SourceInfo;
}

/** Resolved proficiency ranks. The calc layer turns these into modifiers. */
export interface Proficiencies {
  perception: ProficiencyRank;
  saves: Record<SaveId, ProficiencyRank>;
  /** Keyed by skill id or `lore:<subject>`. */
  skills: Record<ProficiencyKey, ProficiencyRank>;
  attacks: Record<WeaponCategory, ProficiencyRank>;
  defenses: Record<ArmorCategory, ProficiencyRank>;
  classDc: ProficiencyRank;
  /** Per-weapon overrides (e.g. a deity's favored weapon), keyed by weapon id. Wins if higher than the category rank. */
  weaponOverrides?: Record<string, ProficiencyRank>;
  /** Per-weapon-GROUP proficiency (alchemist bombs, gunslinger firearms), keyed by weapon group. Wins if higher than the category rank. */
  weaponGroups?: Record<string, ProficiencyRank>;
}

/** A feat the character has taken, and the slot it filled. */
export interface FeatChoice {
  featId: string;
  /** Character level at which it was gained. */
  level: number;
  /** Which kind of slot it filled. */
  category: FeatCategory;
  /** The resolved embedded sub-choice (e.g. Domain Initiate's domain), for display. */
  choice?: { value: string; label: string };
}

/** Build log of skill increases (for the builder to validate progression). */
export interface SkillIncrease {
  level: number;
  skill: ProficiencyKey;
}

export interface WeaponRunes {
  potency?: 0 | 1 | 2 | 3 | 4;
  striking?: 'striking' | 'greater' | 'major';
  property?: string[];
}

export interface ArmorRunes {
  potency?: 0 | 1 | 2 | 3 | 4;
  resilient?: 'resilient' | 'greater' | 'major';
  property?: string[];
  /** Shield reinforcing-rune tier 1–6 (minor…supreme); raises Hardness/HP/BT. */
  reinforcing?: 1 | 2 | 3 | 4 | 5 | 6;
}

/** A natural unarmed attack granted by ancestry/feat (Iruxi Fangs, claws, jaws, tail, …). Rendered
 *  as a Strike using the unarmed proficiency; defaults to the brawling group + unarmed trait. */
export interface NaturalAttack {
  name: string;
  /** Damage die, e.g. 'd6' / 'd8'. Base count is one die (Handwraps striking adds more). */
  die: string;
  /** 'piercing' | 'slashing' | 'bludgeoning' (or another damage type). */
  damageType: string;
  /** Weapon traits (e.g. 'agile', 'finesse', 'grapple'); defaults to ['unarmed']. */
  traits?: string[];
  /** Weapon group (drives crit specialization); defaults to 'brawling'. */
  group?: string;
}

/**
 * A melee unarmed Strike granted by a feat / heritage / ancestry / class feature (extracted from a
 * Foundry `Strike` rule element at import). Collected into `Character.naturalAttacks` by
 * `buildCharacter` so granted attacks (Iruxi Fangs, Razortooth jaws, …) show up in Strikes.
 */
export interface GrantedStrike {
  name: string;
  die: string;
  damageType: string;
  traits: string[];
  group: string;
  /** Set only when gated by a ChoiceSet pick (e.g. Iruxi 'fangs'/'tail'); undefined = unconditional. */
  choiceValue?: string;
}

/** One stack of an item in the character's inventory. */
export interface InventoryItem {
  /** Unique per inventory entry (distinct from the item definition id). */
  instanceId: string;
  /** Reference into ContentDatabase.items (or a homebrew item id). */
  itemId: string;
  quantity: number;
  worn?: boolean;
  /** Held/wielded. */
  equipped?: boolean;
  invested?: boolean;
  /** instanceId of the container holding this item, or null if loose. */
  containerInstanceId?: string | null;
  /** instanceId of the item this is AFFIXED to (talisman/spellheart/banner → weapon/armor/shield). */
  attachedTo?: string | null;
  runes?: WeaponRunes | ArmorRunes;
  /** Player-tracked limited uses (legacy single counter — kept for back-compat). When
   *  resetsOnRest is set, daily preparations (rest) refill `current` to `max`. */
  charges?: { current: number; max: number; resetsOnRest?: boolean };
  /** Per-instance live values for the item's `counters`, keyed by counter id. */
  counters?: Record<string, { current: number; max: number; resetsOnRest?: boolean }>;
  /** For a generic scroll/wand (item.spellSlot): the spell id the player chose to store in it. */
  heldSpell?: string;
  /** Battlezoo Monster Parts: this instance has been refined and/or imbued. Mutually exclusive with
   *  `runes` (an item uses either runes or monster parts, never both). `refinedLevel` is the item level
   *  the item is refined to (drives the fundamental-rune-equivalent bonuses); `imbuements` are the
   *  imbued properties on it (each with its chosen path, for weapon properties, and its property level). */
  monsterPart?: {
    refinedLevel?: number;
    imbuements?: { propertyId: string; path?: string; level: number; choice?: string }[];
    /** For items that aren't auto-classified by itemType (weapon/armor/shield), the refinement track
     *  the player chose: a Perception item or a skill item. */
    kind?: 'perception' | 'skill';
    /** For a refined skill item, which skill the item bonus applies to (a SkillId or 'lore:<subject>'). */
    skillKey?: string;
  };
}

export type SpellcastingType = 'prepared' | 'spontaneous' | 'focus' | 'innate' | 'ritual' | 'items';

/** A single prepared slot (prepared casters). */
export interface PreparedSlot {
  /** Spell prepared into this slot, or null if empty. */
  spellId: string | null;
  expended: boolean;
}

/** A spellcasting source on the character (a class's casting, an innate set, ...). */
export interface SpellcastingEntry {
  id: string;
  name: string;
  type: SpellcastingType;
  tradition: Tradition;
  keyAbility: AbilityId;
  proficiency: ProficiencyRank;
  /** Always-available cantrips (spell ids, rank 0). */
  cantrips: string[];
  /** Prepared casters: slots per rank. */
  prepared?: Record<number, PreparedSlot[]>;
  /** Spontaneous casters: known spell ids per rank. */
  repertoire?: Record<number, string[]>;
  /** Spells granted into the repertoire by a subclass (bloodline/mystery/muse/conscious mind) — these
   *  do NOT count against the per-rank known-spells cap and can't be removed in play. */
  grantedRepertoire?: Record<number, string[]>;
  /** Slot pool per rank (used by spontaneous; prepared derives from `prepared`). */
  slots?: Record<number, { max: number; used: number }>;
  /** Innate entries: spell ids already cast today (1/day each), overlaid from PlayState.innateUsed. */
  innateUsed?: string[];
  /** Spontaneous: ids that can be cast from any higher slot. */
  signature?: string[];
  /** Wizard: learned spells per rank (the daily preparation is drawn from this). */
  spellbook?: Record<number, string[]>;
  /** Cleric Divine Font: a second prepared list of `slots` heal/harm-only slots (1 + Cha) at the given
   *  rank. The Battle Creed doctrine instead grants a 'battle' font: 4/5/6 Bane-or-Bless slots cast with
   *  the CLASS DC (`useClassDc`). `allowed` restricts which spells may fill the slots; `expended` (per
   *  slot) is overlaid from play-state. */
  font?: {
    type: 'heal' | 'harm' | 'battle';
    slots: number;
    rank?: number;
    expended?: boolean[];
    useClassDc?: boolean;
    allowed?: string[];
  };
  /** For `type:'items'` entries: the inventory instance this casting comes from, so the Spells page
   *  can open the item and read/spend its charge counter (kept in sync with the Inventory). */
  itemInstanceId?: string;
}

/** A user-defined ("deep") background: a name + description and its mechanical grants —
 *  two attribute boosts (to different abilities), training in a Lore, and one skill feat
 *  (which grants training in the chosen prerequisite skill). */
export interface CustomBackground {
  name: string;
  description: string;
  /** Two attribute boosts, each to a different ability. */
  boosts: [AbilityId | null, AbilityId | null];
  /** The skill the chosen skill feat trains you in (its prerequisite skill). */
  trainedSkill: SkillId | null;
  /** Custom Lore subject (the `lore:` part), e.g. "Sailing". */
  loreSubject: string;
  /** The granted skill feat id. */
  skillFeatId: string | null;
}

export interface CharacterDetails {
  alignment?: string;
  deityId?: string;
  age?: string;
  height?: string;
  weight?: string;
  gender?: string;
  pronouns?: string;
  ethnicity?: string;
  nationality?: string;
  birthplace?: string;
  appearance?: string;
  personality?: string;
}

export interface NotePage {
  id: string;
  title: string;
  icon?: string;
  color?: string;
  /** Private to the player vs shared with the party. */
  private?: boolean;
  /** Rich-text content (HTML). */
  content: string;
}

/**
 * The saved character. Everything here is a *choice* or *current state*;
 * computed numbers live in the calc layer, not here.
 */
/** Optional GMG/GM-Core variant rules a character can opt into (toggled at setup). */
export interface VariantRules {
  /** Extra ancestry feat slots (2 at L1, +1 at each odd level 3–19). */
  ancestryParagon?: boolean;
  /** A bonus archetype-only class feat at every even level (2–20). */
  freeArchetype?: boolean;
  /** The 4 boosts at 5/10/15/20 are instead one boost each at 2-5/7-10/12-15/17-20. */
  gradualBoosts?: boolean;
  /** Drop character level from proficiency math (untrained −2 / trained +2 / … / legendary +8). */
  proficiencyWithoutLevel?: boolean;
  /** Automatic Bonus Progression — item-equivalent attack/defense/save/perception/skill bonuses by level. */
  abp?: boolean;
  /** Dual Class — gain the proficiencies, HP, features and feats of a second class. */
  dualClass?: boolean;
}

/** Per-character toggles that aren't GMG variant rules — convenience/house options. */
export interface CharacterOptions {
  /** Replace the ancestry's listed attribute boosts AND flaws with two free attribute boosts. */
  alternateAncestryBoosts?: boolean;
  /** Whether the player elected to take an extra voluntary attribute flaw (toggled in Setup). */
  voluntaryFlaw?: boolean;
  /** The attribute the voluntary flaw applies to (chosen at level 0 when voluntaryFlaw is on). */
  voluntaryFlawAbility?: AbilityId | null;
  /** Disable the negative effects of carrying too much Bulk (no encumbered/over warnings). */
  ignoreBulk?: boolean;
  /** Hide the dice roller (its button and per-stat roll triggers) everywhere on the sheet. */
  diceRollerOff?: boolean;
  /** Track rations day-by-day yourself (via quantity) instead of the built-in 7-day uses counter —
   *  removes the days counter on the Rations item in the inventory + item popup. */
  rationsDayTracking?: boolean;
  /** Reveal the creative "Overrides" section in Setup (deliberate per-case rule-breaking). */
  overridesEnabled?: boolean;
  /** "Deep background" — unlock building a fully custom background (your own skills/feat/boosts). */
  deepBackground?: boolean;
}

/**
 * "Overrides" — a per-character creative/freeform editing layer that lets the user DELIBERATELY break
 * the rules in specific, explicit cases (no blanket "ignore everything" switch). buildCharacter never
 * re-validates legality, so these are mostly UI-gate relaxations + targeted grant/suppress. Authoring
 * brand-new content (homebrew feats, new picker options) is intentionally NOT here — that's a separate
 * future Homebrew section. Every field is plain JSON so it round-trips through the saved build.
 */
export interface BuildOverrides {
  /** Feat ids the user has explicitly allowed to be picked despite failing prerequisites/eligibility
   *  (recorded via the picker's "Take anyway" action). Un-gates exactly those feats — nothing else. */
  allowedFeats?: string[];
  /** Bonus feats force-granted with no slot cost (the "add a thing" case). */
  addedFeats?: { featId: string; level: number; category: FeatCategory }[];
  /** Class features force-granted with no slot cost (any feature, regardless of class). */
  addedFeatures?: { featureId: string; level: number }[];
  /** Auto-granted feat ids to suppress from the character (the "remove a thing" case). */
  removedFeatIds?: string[];
  /** Force-set raw ability scores — overwrites the computed value with no boost limits. */
  attributes?: Partial<Record<AbilityId, number>>;
  /** Force-set proficiency ranks for any track: a skill id, `lore:<subject>`, a save
   *  (fortitude/reflex/will), a weapon category, an armor category, 'perception', or 'classDc'. */
  proficiencies?: Record<string, ProficiencyRank>;
  /** Extra language ids granted, bypassing the ancestry/Int slot limit. */
  addedLanguages?: string[];
  /** Spells force-added regardless of class/tradition/access — any spell at any rank, including
   *  rituals. Non-rituals surface as a "Added spells" entry (at the chosen rank); rituals show in
   *  the Spells page's Rituals section. */
  addedSpells?: { spellId: string; rank: number }[];
  /** Edits to existing entries' fields (name/description/traits/…). Applied as a shallow content
   *  overlay so the shared database is never mutated. Display-safe fields are the intended use. */
  contentEdits?: {
    feats?: Record<string, Partial<Feat>>;
    classFeatures?: Record<string, Partial<ClassFeature>>;
  };
}

export interface Character {
  id: string;
  /** Bumped when this shape changes, so saved characters can be migrated. */
  schemaVersion: number;
  name: string;
  /** 0–20 (0 = the level-0 "initial stats" starting point). */
  level: number;
  xp: number;

  // --- build references (content ids) ---
  ancestryId: string | null;
  heritageId: string | null;
  backgroundId: string | null;
  classId: string | null;
  /** Chosen subclass option id (instinct, doctrine, bloodline, ...). */
  subclassId?: string | null;
  /** Resolved subclass + extra-choice picks (bloodline, ikons, apparitions, …) for display. */
  classChoices?: { group: string; name: string; description: string; level: number }[];
  /** Chosen key attribute (matters for classes that offer a choice, e.g. Str/Dex). */
  keyAbility: AbilityId | null;
  /** Optional variant rules this character opted into. */
  variantRules?: VariantRules;
  /** Per-character convenience/house options (alternate ancestry boosts, voluntary flaw, etc.). */
  options?: CharacterOptions;
  /** Creative "Overrides" — deliberate rule-breaks (allowed-ineligible feats, bonus/removed feats). */
  overrides?: BuildOverrides;
  /** Enabled source books (absent = the four Core books); other books are hidden from the builder. */
  enabledSources?: string[];
  /** Campaign content toggles. Mythic (War of Immortals): off → all `mythic`-trait content is hidden
   *  from the player and the mythic subsystem is inactive. Kingmaker: on → its actions/conditions show. */
  mythicEnabled?: boolean;
  kingmakerEnabled?: boolean;
  /** The chosen Mythic Calling (a [calling]-trait classFeature id). */
  mythicCalling?: string | null;
  /** Dual Class: the second class id + its subclass (variant rule). */
  classId2?: string | null;
  subclassId2?: string | null;
  /** ABP skill potency: chosen skill (or `lore:<subject>`) → item-bonus rank (1–3). */
  abpSkills?: Record<string, number>;
  /** ABP attribute apex (level 17): the attribute that gets the apex boost. */
  abpApex?: AbilityId | null;

  // --- final, built values ---
  /** Final scores, computed from boosts/flaws by the builder. */
  abilities: AbilityScores;
  /** Attributes that received a partial (+1, past-18) boost — flagged in the UI. */
  partialBoosts?: AbilityId[];
  proficiencies: Proficiencies;

  // --- current state ---
  hitPoints: HitPoints;
  /** In-play damage dealt to the wielded shield's HP; overlaid from play-state. */
  shieldDamage?: number;
  /** Temporary land-Speed override in feet (Hasted/Slowed/etc.); overlaid from play-state.
   *  When set, the sheet shows this instead of the derived Speed and highlights it. */
  speedOverride?: number;
  heroPoints: number;
  /** Mythic points currently held (0..3); only used when the character is mythic. */
  mythicPoints?: number;
  focus?: FocusPool;
  conditions: ActiveCondition[];
  /** Pinned/favorited activity keys (UI preference, persisted per character via play-state). */
  pinned?: string[];
  /** Favorited description popups (feats, spells, conditions, …) the player starred — shown in the
   *  Main-tab Pinned section and re-openable. Persisted per character via play-state. */
  pinnedDescs?: PinnedDesc[];
  /** Class signature resource values by resource id (Rage, Infused Reagents, …); overlaid from play-state. */
  classResources?: Record<string, number>;
  /** Conditions affecting each companion, keyed by companion id; overlaid from play-state. */
  companionConditions?: Record<string, ActiveCondition[]>;
  /** Tracked HP per companion (damage taken + temp HP), keyed by companion id; overlaid from play. */
  companionHp?: Record<string, { damage: number; temp: number }>;
  /** Active modes (resolved defs) per companion, keyed by companion id; overlaid from play-state. */
  companionModes?: Record<string, ModeDef[]>;
  /** Active modes (resolved defs) whose modifiers adjust stats; overlaid from play-state. */
  activeModes?: ModeDef[];

  // --- choices ---
  languages: string[];
  feats: FeatChoice[];
  /** Class features force-granted via Overrides (rendered in the Feats & Features list). */
  grantedFeatures?: { featureId: string; name: string; level: number; description: string; descRefs?: DescRef[]; traits: Trait[]; actionCost?: ActionCost; rarity?: Rarity }[];
  skillIncreases?: SkillIncrease[];
  /** Commander folio tactics (chosen Action ids), with the tactics-feature metadata for display. */
  commanderTactics?: CommanderTactics;
  /** Inventor innovation + chosen modifications (resolved for display). */
  inventor?: InventorBuild;
  /** Kineticist resolved elements (bare ids: air/earth/fire/metal/water/wood) — drives the Elemental Blast strike. */
  kineticist?: { elements: string[] };

  // --- gear ---
  inventory: InventoryItem[];
  currency: Coins;
  /** Banked monster parts (Battlezoo Monster Parts subsystem), tracked by total gp-value. */
  monsterParts?: number;
  /** Ancestry/feat-granted natural unarmed attacks (Iruxi Fangs, claws, jaws, tail, …) beyond the
   *  baseline Fist. Each becomes its own Strike that uses your unarmed proficiency and is buffed by
   *  Handwraps of Mighty Blows (the die-size rule scales the dice to this attack's own die). */
  naturalAttacks?: NaturalAttack[];

  // --- magic ---
  spellcasting: SpellcastingEntry[];

  // --- flavor / meta ---
  details: CharacterDetails;
  /** Set when the character uses a user-defined ("deep") background. */
  customBackground?: CustomBackground;
  notes: NotePage[];
  /** Animal companions, familiars, and eidolons (rendered as stat blocks). */
  companions?: CompanionConfig[];
  /** Per-character cosmetics (portrait + accent), mirrors the theme system. */
  appearance?: { portrait?: string; accentColor?: string };
}

/** Current schema version for new characters. */
export const CHARACTER_SCHEMA_VERSION = 1;
