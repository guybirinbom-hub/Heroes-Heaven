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

// The conditional-bonus shape is defined next to the shipped registry that uses it. Re-exported here
// so a player-authored entry is the SAME type as a shipped one — one display path, not two.
import type { SituationalBonus } from './situationalBonuses';
export type { SituationalBonus, SituationalTarget } from './situationalBonuses';

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

/** Speeds a feat/heritage/feature/item GRANTS. Each value is feet, or a formula string resolved
 *  against the character ("@actor.speed.land"). Derived Speeds themselves are always numbers. */
export type SpeedGrants = Partial<Record<keyof Speeds, number | string>>;

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
/**
 * A change to an unarmed Strike the character ALREADY has — "your unarmed attacks gain the reach
 * trait", "the base damage of your claws increases to 1d8".
 *
 * Distinct from `grantedStrikes`, which CREATES an attack. A record may carry SEVERAL riders, because
 * one printed effect often hits two attacks differently: Fearsome Fangs steps jaws twice and claws
 * once, and a single rider cannot say that.
 */
export interface UnarmedRider {
  /** Strike names this applies to, matched case-insensitively as a substring ("beak", "hair").
   *  Omitted means every unarmed Strike, which is what most of these feats say. */
  match?: string[];
  /**
   * Match the strike a specific RECORD granted, rather than one whose NAME happens to match.
   * "Claw" is Draconic Aspect's attack and also a nephilim's Bestial Manifestation, so a name match
   * hands Deadly Aspect's deadly d8 to the wrong character. Fails CLOSED: an id that resolves to
   * nothing matches nothing.
   */
  fromRecord?: string;
  /** Traits to add. A `deadly-dN` / `versatile-*` replaces a weaker one of the same family rather
   *  than sitting beside it, which is how the printed "or increase it to" clauses read. */
  add?: string[];
  /** Traits to REMOVE — "your fist attacks lose the nonlethal trait". Every field before this one
   *  could only add, so a feat whose whole content is losing a drawback did nothing. */
  remove?: string[];
  /** Step the damage die up. `true` is one step; a number is that many (Fearsome Fangs steps d8→d12). */
  stepDie?: boolean | number;
  /** The absolute die, which is how most of these are printed ("increases to 1d12"). Wins over
   *  stepDie when both are present, since it states a result rather than a change. */
  setDie?: string;
  /** Step the die only on Strikes that ALREADY had one of `add` — Diamond Fists gives forceful +
   *  deadly d10 and steps the die instead for attacks that had them. */
  stepDieIfHad?: boolean;
  /** THIS strike gets its weapon group's critical specialization, with no other source needed.
   *  critSpecWeapons filters by group, trait or base weapon — never by one particular attack. */
  critSpec?: boolean;
}

/**
 * A change to a WIELDED weapon that matches a filter — "melee weapons you wield gain versatile B".
 *
 * Every field on `match` must hold; `anyTrait` is the one OR ("agile OR finesse"). An unfiltered
 * rider applies to EVERY weapon the character wields, which is the loudest over-grant in the engine:
 * Humble Strikes without `categories: ['simple']` is a silent damage buff on the whole pack.
 */
export interface WeaponRider {
  match?: {
    /** true = melee only, false = ranged only, omitted = either. */
    melee?: boolean;
    /** Weapon groups it applies to ('axe', 'sword'). */
    groups?: string[];
    /** Applies when the weapon carries ANY of these (Deadly Grace: agile or finesse). */
    anyTrait?: string[];
    /** Specific core.json weapon ids. */
    items?: string[];
    /** Weapon categories — "simple weapons you wield" (Humble Strikes). */
    categories?: WeaponCategory[];
    /** Hands required — "any ONE-HANDED axe weapon you wield". A weapon whose `hands` is '1+' counts
     *  as one-handed, since that is how it is wielded when the rider's clause applies. */
    hands?: 1 | 2;
    /** Excluded traits — Integrated Gauntlet does not apply to two-hand or fatal-aim weapons. */
    excludeTraits?: string[];
    /** Only the character's deity's favored weapon (Deific Weapon). */
    deityFavored?: true;
    /**
     * Only the item the player DESIGNATED as this — "your innovation gains the tearing trait".
     * Matches nothing when nothing is designated, deliberately: a "first weapon" fallback would hand
     * a greatsword's modifications to a dagger. See InventoryItem.designations.
     */
    designated?: ItemDesignation;
  };
  add?: string[];
  /** Traits to remove. Names a trait the weapon never had? Then nothing happens, silently. */
  remove?: string[];
  /** Add only to weapons that do NOT already carry a trait of that family — Deadly Grace reads
   *  "an agile or finesse melee weapon that DOESN'T have the deadly trait". Without this it would
   *  quietly downgrade a deadly d10 weapon to d8. */
  onlyIfMissing?: boolean;
  /** Step the damage die up. `true` is one step; a number is that many. Steps DO NOT COMPOUND across
   *  riders — the best single step wins, or a champion with two of these turns a d6 into a d10. */
  stepDie?: boolean | number;
  /** The absolute die ("its damage die becomes d8"). Wins over stepDie. */
  setDie?: string;
  /** Set or extend the range increment in feet. There is no other range lane. */
  range?: { set?: number; add?: number };
}

export interface DefenseGrants {
  /**
   * "You gain the instinct ability for the instinct you chose for Barbarian Dedication." The answer
   * was recorded when the DEDICATION was taken; this record just needs to dereference it.
   *
   * A whole family of archetype feats reads this way — the implement's initiate benefit, the
   * Hellknight order's greater benefit — and each was inert, because the record naming the benefit
   * and the record holding the choice are different records and nothing connected them.
   *
   * Resolving it OWNS the resulting class feature, so its defences, effect choices and situational
   * stars all apply with no further plumbing.
   */
  derivedGrant?: {
    /** The feat whose embedded choice holds the answer. */
    fromFeat: string;
    /** How the answer becomes a record id: `initiate-benefit-` + `chalice`. */
    prefix?: string;
    suffix?: string;
  };
  /** Spells this record gives ACCESS to — see SpellAccessGrant. An array because one record can widen
   *  the list AND grant into a repertoire, and those are different promises. */
  spellListAdditions?: SpellAccessGrant | SpellAccessGrant[];
  /** Changes to unarmed Strikes the character already has. See UnarmedRider. */
  unarmedTraits?: UnarmedRider | UnarmedRider[];
  /** Changes to WIELDED weapons matching a filter. See WeaponRider. */
  weaponTraits?: WeaponRider | WeaponRider[];
  /**
   * A lower multiple attack penalty. The strike line computes MAP as 5 (4 with agile) with no way to
   * change it, so Agile Grace ("–3 and –6 rather than –4 and –8") and the ranger's Flurry moved
   * nothing at all.
   *
   * `step` is the SECOND attack's penalty; the third is always twice it, which matches every printed
   * case. `whileState` gates it on a toggle the sheet already tracks — Flurry applies only against
   * your hunted prey, and applying it unconditionally would over-grant on every other target.
   */
  mapReduction?: {
    /** Penalty for the second attack on a non-agile Strike. Omitted = leave non-agile alone. */
    step?: number;
    /** Penalty for the second attack on an agile Strike. Omitted = leave agile alone. */
    agileStep?: number;
    whileState?: 'rage' | 'panache' | 'hunt-prey' | 'unleash-psyche';
    /** Short label for the strike breakdown. */
    note?: string;
  };
  senses?: SenseEntry[];
  resistances?: IwrEntry[];
  weaknesses?: IwrEntry[];
  immunities?: string[];
  /** Unconditional non-land speeds granted (fly/swim/climb/burrow), in feet — or a FORMULA string
   *  relative to the character ("@actor.speed.land" for "a fly Speed equal to your land Speed",
   *  "max(5,floor(@actor.speed.land/2))" for "half your land Speed, minimum 5"). */
  speeds?: SpeedGrants;
  /** Speeds granted only when a condition is met: a skill proficiency threshold (Quick Climb / Quick
   *  Swim — legendary Athletics) OR a specific heritage (Swift Swimmer's wetlander lizardfolk → swim 25).
   *  All present conditions must hold. */
  speedsIf?: { skill?: ProficiencyKey; rank?: ProficiencyRank; heritage?: string; speeds: SpeedGrants }[];
  /** Arithmetic ON a Speed the character ALREADY has, which `speeds` cannot express: every non-land
   *  grant resolves as max(existing, granted), so a `speeds: { fly: 5 }` meaning "+5 feet to your fly
   *  Speed" (Winged Warrior Dedication) would be swallowed whole. Also the two penalty clauses. */
  speedAdjust?: {
    /** Which Speed(s). 'non-land' is every movement type except land. */
    key: 'land' | 'fly' | 'swim' | 'climb' | 'burrow' | 'all' | 'non-land';
    /** Feet added AFTER the grants resolve, and ONLY to a Speed that is already greater than 0 —
     *  "any fly Speed granted by … increases by 5 feet" gives a wingless character nothing. */
    add?: number;
    /** Unburdened Iron's first clause: the worn armour's Speed reduction does not apply. */
    ignoreArmorPenalty?: boolean;
    /** Unburdened Iron's second clause: deduct this many feet from ONE other Speed penalty
     *  ("If your Speed is taking multiple penalties, pick only one penalty to reduce"). */
    reduceOtherPenalty?: number;
  };
  /**
   * "You can use your proficiency rank in Crafting for anything that requires a proficiency rank in
   * Medicine" (Chirurgeon), "use Nature instead of Medicine to Treat Wounds" (Natural Medicine).
   *
   * A substitution is not a bonus — it swaps WHICH skill you roll — so it could not be expressed as
   * one, and 35 records carrying one did nothing. Chirurgeon's own record shipped a `dataWarning`
   * saying so.
   */
  skillSubstitutions?: {
    /** The skill you may roll instead. */
    use: SkillId;
    /** The skill it stands in for. */
    forSkill: SkillId;
    /**
     * WHEN it applies, in the record's own words ("to Treat Wounds", "to Gather Information").
     * ABSENT means unconditional — only Chirurgeon's "anything that requires a proficiency rank in
     * Medicine" reads that way. A conditional one must NOT silently replace the skill's number,
     * because Natural Medicine explicitly "doesn't replace Medicine for uses of the skill other than
     * Treat Wounds or for feat prerequisites".
     */
    when?: string;
  }[];
  /** Languages this feat/heritage grants outright (a half-elf lineage's or a regional feat's specific
   *  language) — the record names WHICH languages. */
  grantsLanguages?: string[];
  /** Languages the record lets the PLAYER choose ("You learn three new languages of your choice").
   *  Nothing expressed a language choice before, so Multilingual — the most-taken language feat in
   *  the game — did nothing at all. A formula string may reference `@item.level`. */
  languageChoices?: number | string;
  /** Extra choices this record grants once a skill reaches a rank. Multilingual's "an additional
   *  language if you are or become a master in Society, and again if you are or become legendary"
   *  is two of these, so the count RISES with the character rather than being fixed at selection. */
  languageChoicesAtRank?: { skill: ProficiencyKey; rank: ProficiencyRank; extra: number }[];
  /** "When you select the Multilingual feat, you learn three new languages instead of two" — this
   *  record changes ANOTHER record's choice count, once per time that other record was taken. */
  languageChoicesBonus?: { featId: string; extra: number }[];
  /**
   * "Add the astral and brilliant property runes to the list of effects you can choose from."
   *
   * A record whose entire content is widening a menu another record owns. Nothing let one record
   * reach into another's `choice.options`, so these feats were taken and the menu stayed the same
   * size — the player could see the new runes named in the feat's text and could not pick one.
   */
  /**
   * A record that changes an ITEM MODE rather than the character — an elixir's duration, or whether
   * a mutagen's drawback applies. Mutagens and elixirs ship as item-driven modes whose `duration` is
   * a printed string (the app has no clock) and whose drawback is a genuine negative modifier;
   * nothing could touch either, so both of these feats were inert.
   */
  modeAdjust?: {
    /** Which modes. All present conditions must hold. */
    match: { traits?: string[]; ids?: string[]; minDurationMinutes?: number };
    /** "that elixir's duration is doubled" — applied to the printed string. */
    doubleDuration?: boolean;
    /** "you do not suffer its drawback" — every negative modifier on the mode stops applying. */
    suppressNegativeModifiers?: boolean;
    /** Shown alongside the adjusted mode, for a restriction the app cannot check (Extend Elixir
     *  applies only to elixirs YOU created, and Quick Alchemy still caps at 10 minutes). */
    note?: string;
  }[];
  /**
   * RETUNE an existing spellcasting entry rather than granting a new one.
   *
   * An entry's tradition and key attribute come from the source that granted it, and nothing could
   * change them afterwards — so Ancestral Mind ("the spell's tradition becomes occult … and you can
   * use your psychic spellcasting attribute modifier instead of Charisma") and the Razmiran priest's
   * occult cleric spells both left the entry exactly as it was.
   */
  entryRetune?: {
    /** Which entry: an exact id, or 'innate' for the innate-spell entry. */
    scope: 'innate' | string;
    tradition?: Tradition;
    keyAbility?: AbilityId;
    /** Take the key attribute from the entry belonging to this class ("your PSYCHIC spellcasting
     *  attribute modifier"), rather than naming one — a psychic's is not fixed. */
    keyAbilityFromClass?: string;
  }[];
  /**
   * Items a record hands the character ("You gain a Razmiri mask"). Nothing put an item in the
   * inventory, so a feat whose benefit IS an item delivered nothing and the player had to know to
   * add it themselves.
   */
  grantsItems?: { itemId: string; quantity?: number; invested?: boolean }[];
  /**
   * "You gain all the mechanical benefits of the <X> heritage you selected at 1st level."
   *
   * Both feats that say this require a VERSATILE heritage, which is what the character's single
   * `heritageId` records — so the 1st-level ancestry heritage was never stored anywhere and there
   * was nothing to dereference. The feat's own `choice` (kind 'open', from a `heritage` pool) records
   * which one; this flag says to apply it.
   */
  secondHeritage?: boolean;
  /** Damage types this record adds to an Elemental Blast's printed list, per element — "add the
   *  following damage types to those you can choose for Elemental Blasts of that element" (Versatile
   *  Blasts). The printed lists were not modelled as lists, so there was nothing to add to. */
  blastTypeAdditions?: Record<string, string[]>;
  choiceOptionAdditions?: {
    /** The record id whose choice is widened. */
    target: string;
    /** Which choice, when the target record has more than one. */
    flag?: string;
    add?: { value: string; label: string; description?: string }[];
    /** Options added only to a character of that sanctification — Radiant Armament adds the holy
     *  rune if you are holy and the unholy rune if you are unholy, never both. */
    addIfSanctified?: { sanctification: 'holy' | 'unholy'; value: string; label: string }[];
  }[];
  /** Feats this heritage/feat grants outright (Cataphract Fleshwarp → Armor Proficiency,
   *  Battle-Trained Human → Diehard). Added as bonus feats with their own effects. */
  grantsFeats?: string[];
  /**
   * "You gain the Sneak Attack class feature." A record that hands over a CLASS FEATURE rather than a
   * feat — the archetype route into another class's signature ability.
   *
   * `grantsFeats` could not express it (the target is not a feat) and nothing else wrote into
   * `ownedFeatureIds`, so 14 records said this and delivered none of it: an Investigator Dedication
   * granted no On the Case, and Sneak Attacker granted no sneak attack dice.
   */
  grantsClassFeatures?: string[];
  /**
   * A record that grants Sneak Attack with its OWN, NON-SCALING damage.
   *
   * Three feats hand over the class feature and then immediately cap it — "You don't increase the
   * number of dice as you gain levels", "1d6 regardless of your level", "1d4, increasing to 1d6 at
   * 6th level". Reading only `grantsClassFeatures` gives them the ROGUE's progression, so a
   * 17th-level fighter with Butterfly's Sting rolled 4d6 for a feat that never leaves 1d6.
   *
   * Sneak attack from multiple sources is not cumulative, so the BEST applies rather than the sum —
   * a real rogue's scaling always wins over one of these.
   */
  precisionDice?: { dice: number; die: string; upgradeAt?: { level: number; die: string } };
  /** Number of free-text Lore skills a HERITAGE grants the player to choose (Half Moon Sarangay: 2;
   *  Born of Item: 1). Typed subjects live in BuildState.heritageLore and become trained Lores. */
  loreChoices?: number;
  /** Extra damage this feat/feature adds to Strikes (Spirit Striking: +2/3/4 spirit by weapon
   *  proficiency; Offensive Boost: +1d6 of a chosen type). Folded into each matching Strike's damage. */
  strikeDamage?: StrikeDamageRider[];
  /** A multiclass dedication grants a trained class DC in the BORROWED class (Fighter/Ranger/Rogue/
   *  Alchemist Dedication). The key ability comes from that class; surfaced as a secondary class DC. */
  classDcGrant?: { classId: string };
  /** Effects that apply ONLY while a signature resource STATE is active (Raging Resistance: resistance
   *  while raging; Raging Athlete: climb/swim while raging). Gated on the character's live toggle. */
  whileActive?: {
    state: 'rage' | 'panache' | 'hunt-prey' | 'unleash-psyche';
    resistances?: IwrEntry[];
    /** Ligneous Instinct's bark-like flesh: the same clause that resists piercing and slashing also
     *  grants weakness to fire. A benefit block that could only ever help would have dropped it. */
    weaknesses?: IwrEntry[];
    senses?: SenseEntry[];
    immunities?: string[];
    speeds?: SpeedGrants;
    /** Wooden Rage's −10 ft, which applies only while the state is on. */
    speedPenalty?: number;
    /** The character level this clause starts at. Raging Resistance is a 9th-level class feature
     *  whose damage types are printed on an INSTINCT chosen at 1st — so without a gate the instinct
     *  would hand a 1st-level barbarian a 9th-level defence. */
    minLevel?: number;
  }[];
  /** This feat/heritage raises the character to at least this SIZE (Jotun's Heart → Large). */
  sizeOverride?: Size;
  /** Natural reach in feet this feat/heritage grants (Jotun's Heart: 10). Highest wins. */
  reach?: number;
  /** A flat additive bonus to LAND Speed (Hyper Boosters: +10, Fleet: +5). `speeds.land` is additive
   *  too, but `speeds` SETS the non-land movement types, so a land entry there reads as a set when it
   *  isn't — this field says "increases by N" unambiguously. */
  landSpeedBonus?: number;
  /** A land-Speed FLOOR: "your land Speed increases TO 15 feet" (Strong Tail), "becomes 10 feet"
   *  (Cecaelia merfolk). Applied to the ancestry base before any additive bonus, so a merfolk who
   *  takes Strong Tail and Fleet walks at 20, not 25. Highest floor wins. */
  landSpeedMin?: number;
  /** Grants void ("negative") healing — harmed by vitality, healed by void (dhampir-style). Surfaced on
   *  the Defenses card. Some ITEMS grant it too (Emerald Fulcrum Lens) — see ItemBase. */
  negativeHealing?: boolean;
  /** "You can breathe underwater." A permanent capability with no number — it is not a sense, not
   *  a speed, and not a resistance, so it had no home and the records saying it did nothing. */
  breathesWater?: boolean;
  /**
   * "In your hands, a shield gains the minor Reinforcing rune… the reinforcing rune of your level."
   *
   * The shield block already takes the best of the shield's own Hardness/HP/BT and its etched rune's,
   * so this only has to supply a TIER — but nothing could derive one from the CHARACTER rather than
   * from an etched rune, so Blessed Shield gave a champion's shield nothing at all.
   */
  shieldReinforcingByLevel?: boolean;
  /** True when this feature/feat grants weapon critical specialization (a CriticalSpecialization
   *  rule element). Drives whether Strikes show their critical-specialization effect. */
  critSpec?: boolean;
  /**
   * "You gain the armor specialization effects of medium and heavy armor" (Armor Expertise), "for all
   * armors you are proficient with" (Armor Specialist).
   *
   * The twin of `critSpec`/`critSpecWeapons`: this says only WHICH armors the record unlocks it for.
   * The VALUE lives in src/rules/armorSpec.ts keyed by armor group, because it scales with the
   * ARMOR's potency rune, which no data formula can reach.
   */
  armorSpec?: {
    /** Categories unlocked unconditionally (Armor Expertise: medium + heavy). */
    categories?: ArmorCategory[];
    /** Categories unlocked only if the wearer is at least trained in them (Unshaken in Iron). */
    ifTrained?: ArmorCategory[];
    /** "all armors you are proficient with" — every category the wearer is not untrained in. */
    anyProficient?: boolean;
    /** Specific armor ITEM ids — Hellknight Preferment names three armors, not a category. */
    items?: string[];
    /** "your resistance from that armor specialization is 1 higher than normal". */
    bonus?: number;
    /** "While in Tenacious Stance, increase the value by your armor check penalty." */
    bonusWhileStance?: { stanceId: string; source: 'armorCheckPenalty' };
  };
  /** The level the crit-spec effect activates, when gated by `self:level >= N` (e.g. ancestry
   *  weapon-familiarity feats grant it at 5, even though the feat is taken at 1). */
  critSpecLevel?: number;
  /** Weapon restriction on the crit-spec grant — only matching weapons show the effect. */
  critSpecWeapons?: {
    groups?: string[];
    traits?: string[];
    bases?: string[];
    melee?: boolean;
    /** Only the DESIGNATED item — "your innovation gains critical specialization". Without this the
     *  grant is unnarrowed, and weaponMatches returns true for an unnarrowed entry, so it would light
     *  up crit spec on every Strike the character makes. See InventoryItem.designations. */
    designated?: ItemDesignation;
  };
  /** Melee unarmed Strikes this feat/feature grants (from Foundry `Strike` rule elements). */
  grantedStrikes?: GrantedStrike[];
  /** "You gain X — or Y instead if you already have X" sense grants (Superior Sight, Ember's Eyes,
   *  Aquatic Eyes). `ifPresent` is the sense the character must ALREADY have (from ancestry vision or
   *  any other source) for the grant to upgrade from `base` to `upgraded`. */
  conditionalSenses?: { ifPresent: string; base: SenseEntry; upgraded: SenseEntry }[];
  /** "Choose one of N" effects the player picks when they take this feat/feature/heritage/item
   *  (a dragon tattoo's resistance TYPE, an energy heart's element, one of several skills). Each
   *  choice's picked option contributes a concrete effect. Stored in BuildState.effectChoices keyed
   *  `<recordId>:<choiceId>` and resolved by buildCharacter into Character.chosenEffects (always-on
   *  sources) / resolvedItemPassives (worn items). */
  effectChoices?: EffectChoice[];
  /** A sheet-visible warning that this record's effect references content missing from the shipped data
   *  (usually a legacy spell/feat not yet reprinted). Kept so the intent is visible; buildCharacter
   *  collects owned records' warnings into Character.effectWarnings. */
  dataWarning?: string;
  /** "You become trained in <tradition> spell attack rolls and spell DCs, using <attribute>" — the
   *  casting PROFILE a feat confers (Minor Magic, Shadow Magic, the esoteric dedications). Applied to
   *  the character's innate entry (and raises an existing entry's rank rather than duplicating it). */
  spellcastingGrant?: SpellcastingGrant;
  /** Extra spell slots a feat grants ("+1 slot of each rank except your highest"). */
  spellSlotBonus?: SpellSlotBonus;
  /** A CLASS ARCHETYPE dedication (Runelord, War Magic, Vindicator…). Unlike a normal archetype these
   *  RESTRUCTURE the class: they remove class features and substitute their own. */
  classArchetype?: ClassArchetype;
}

/** A class archetype: taking its dedication suppresses class features and substitutes replacements. */
export interface ClassArchetype {
  /** The class this archetype restructures (it only applies to a character of that class). */
  classId: string;
  /** Class-feature ids the archetype REMOVES (Wizard's Arcane Bond, a Champion's armor training…). */
  suppressFeatures?: string[];
  /** Class features the archetype ADDS in their place, at the given character levels. */
  addFeatures?: { level: number; featureId: string }[];
  /** Proficiency ranks the archetype confers directly (War Magic's light/medium armor). */
  armor?: Partial<Record<ArmorCategory, ProficiencyRank>>;
  weapon?: Partial<Record<WeaponCategory, ProficiencyRank>>;
  /** Proficiency CEILINGS the archetype imposes — a class archetype can take training AWAY ("as a
   *  Warrior of Legend you aren't trained in heavy armor"). armor/weapon above only ever raise a rank,
   *  so a removal needs its own lane. Applied after all class advancement. */
  armorCap?: Partial<Record<ArmorCategory, ProficiencyRank>>;
  weaponCap?: Partial<Record<WeaponCategory, ProficiencyRank>>;
  /** A short note shown on the sheet describing what the archetype changed. */
  note?: string;
}

/** The spell attack/DC profile a feat grants. */
export interface SpellcastingGrant {
  tradition: Tradition;
  keyAbility: AbilityId;
  proficiency: ProficiencyRank;
}

/** Extra spell slots granted by a feat, applied to the character's slot-caster entry. */
export interface SpellSlotBonus {
  /** Slots added at every rank the character can cast. */
  perRank?: number;
  /** Exclude the top N ranks (PF2e's usual "except your two highest ranks"). */
  exceptHighest?: number;
  /**
   * Slots added at SPECIFIC ranks — `{ "3": 1, "4": 2 }` is Ring of Wizardry (Type IV): "two
   * additional 4th-rank and one additional 3rd-rank arcane spell slot".
   *
   * All four Ring of Wizardry records already carried this and the engine did not read it, so the
   * code fell through to `perRank ?? 1` with no `exceptHighest` — granting +1 slot at EVERY rank
   * instead of the printed handful. A level-20 wizard got ten extra slots instead of two.
   * When present, this wins: `perRank` is ignored.
   */
  byRank?: Record<string, number>;
  /** Restrict to a specific entry id (defaults to the character's main slot caster). */
  entryId?: string;
  /**
   * Extra CANTRIPS known. The slot applier filters `r > 0`, so `byRank['0']` was silently dropped and
   * nothing else could reach the cantrip cap — Cantrip Expansion, one of the most-taken feats in the
   * game, did nothing whatsoever.
   */
  cantrips?: number;
  /**
   * Slots at the character's CURRENT highest castable rank (Gifted Power: "an extra spell slot of
   * your highest rank"). The rank moves with level, so `byRank` cannot say it and `perRank` would
   * hand out one at every rank instead of one at the top.
   */
  highestOnly?: boolean;
  /** A printed limit on what the slot may hold ("only to cast spells from your mystery"). DISPLAY
   *  ONLY: the engine does not police what goes into a slot, and pretending otherwise would be worse
   *  than showing the sentence. */
  restriction?: string;
}

/** A concrete effect an EffectChoice option confers when picked. A subset of the effect lanes the
 *  engine already applies; `passive` is item-only (worn item bonuses). */
export interface EffectGrant {
  resistances?: IwrEntry[];
  weaknesses?: IwrEntry[];
  immunities?: string[];
  senses?: SenseEntry[];
  /** Feet, or a formula relative to the character ("@actor.speed.land"). */
  speeds?: SpeedGrants;
  /** Skill (or `lore:<subject>`) → minimum rank trained. */
  skills?: Partial<Record<ProficiencyKey, ProficiencyRank>>;
  innateSpells?: InnateSpellGrant[];
  /** Focus spells the chosen option grants (each carries its own Focus Point, like Feat.focusSpells) —
   *  for "choose one of N focus spells" feats (Additional Shadow Magic, Greater Deathly Secrets). */
  focusSpells?: string[];
  /** Focus-pool points when the option grants a point WITHOUT a spell. */
  focusPoolBonus?: number;
  /** Item-only: worn/invested item bonuses of the chosen kind. */
  passive?: ItemPassiveEffects;
  /** The chosen benefit applies ONLY while a state is on. Giant Instinct's Raging Resistance covers
   *  "bludgeoning and your choice of cold, electricity, or fire" — resolved picks otherwise land in
   *  `chosenEffects`, which deriveDefenses applies unconditionally, so the pick would have granted a
   *  permanent resistance to a barbarian who was not raging and had not yet reached 9th level. */
  whileActive?: DefenseGrants['whileActive'];
}

/** A "choose one of N" the player resolves in the builder. Either an explicit `options` list, or a
 *  `spellFilter` describing an OPEN set ("any 1st-rank arcane spell") the builder searches. */
export interface EffectChoice {
  /** Stable key (unique within the record) so the pick round-trips. */
  id: string;
  prompt: string;
  /** `grant` is optional: some menus mix a mechanical option with play-time ones (a kineticist gate
   *  junction — only Elemental Resistance changes a stat), and the pick should still be recorded and
   *  shown. An option with no grant simply applies nothing. */
  options?: { value: string; label: string; grant?: EffectGrant; note?: string }[];
  /** Open-ended spell pick. The chosen spell id becomes the value; `grantTemplate` says how it is
   *  granted (as an innate spell at some cadence, or as a focus spell). */
  spellFilter?: SpellChoiceFilter;
}

/** Constrains an open-ended spell choice, and says what taking it grants. */
/**
 * What an OPEN build choice draws from. Deliberately a superset of SpellChoiceFilter's shape for the
 * spell case, so `openChoiceOptions` can delegate to the existing `spellsMatching` rather than grow a
 * second spell matcher that could drift from it.
 */
export interface OpenChoiceFrom {
  /**
   * Where the legal picks come from. The first four search CONTENT; the `own-` kinds search the
   * CHARACTER, because several records pick from what you already have — Library Robes takes "one
   * spell YOU KNOW of 5th rank or lower", Fuse Stance "two stances you already know". Offering the
   * whole of content for those would let the player choose something they don't have.
   */
  type: 'spell' | 'feat' | 'weapon' | 'language' | 'heritage' | 'own-spell' | 'own-feat' | 'own-item' | 'own-companion';
  /** spell: allowed traditions / rank window / required traits / cantrip filter. */
  traditions?: Tradition[];
  rank?: number;
  minRank?: number;
  maxRank?: number;
  cantripsOnly?: boolean;
  /** Required traits, ALL of which must be present — spell traits, or feat traits ('dwarf'). */
  traits?: string[];
  /** Traits of which AT LEAST ONE must be present. Several feats read "divination OR enchantment OR
   *  necromancy"; expressing that as `traits` would demand all three and offer almost nothing. */
  anyTraits?: string[];
  /** feat: restrict to a category and a level ceiling ("any 1st-level dwarf ancestry feat"). */
  featCategory?: FeatCategory;
  /** feat: level ceiling. weapon: item-level ceiling ("choose a level 0 weapon"). */
  maxLevel?: number;
  /** weapon: required rarity ("an uncommon simple or martial weapon"). */
  rarity?: Rarity;
  /** weapon: restrict to a proficiency category. */
  weaponCategory?: WeaponCategory;
  /** own-item: restrict to an item type (weapon / armor / shield / equipment …). */
  itemType?: string;
  /** own-item: only items the character has INVESTED (a worn magic item that is actually active). */
  investedOnly?: boolean;
  /** heritage: restrict to one ancestry's heritages ("the awakened animal heritage you selected at
   *  1st level"). Versatile heritages are excluded — the feat asks which ANCESTRY heritage you had,
   *  and a versatile one is what you took INSTEAD of it. */
  ancestry?: string;
}

export interface SpellChoiceFilter {
  /** Allowed traditions (any if omitted). */
  traditions?: Tradition[];
  /** Rank bounds — `rank` for exactly N, or min/max for a window. Cantrips are rank 0. */
  rank?: number;
  minRank?: number;
  maxRank?: number;
  /** Spell must carry ALL of these traits (e.g. divination/enchantment restrictions). */
  traits?: string[];
  /** Only cantrips / only non-cantrips. */
  cantripsOnly?: boolean;
  /** How the picked spell is granted. 'innate' uses the innate lane; 'focus' adds a focus spell. */
  grantAs: 'innate' | 'focus';
  /** For 'innate': the cadence/heightening applied to the chosen spell. */
  innate?: Omit<InnateSpellGrant, 'spellId'>;
  /** Level at which this pick unlocks (a scaling feat offers more picks as you level). */
  minLevel?: number;
}

/** Passive item bonuses applied while worn/invested/held (the generic magic-item lane). */
export interface ItemPassiveEffects {
  skills?: Partial<Record<ProficiencyKey, number>>;
  perception?: number;
  saves?: number;
  ac?: number;
  attack?: number;
  /** Raises BOTH Bulk thresholds — the Assisting armour rune sets them to 6 + Str and 11 + Str,
   *  which is the ordinary 5 + Str / 10 + Str plus one. */
  bulkLimitBonus?: number;
  /** "You can use Nature instead of Occultism…" from a worn/invested item (Tales in Timber). */
  skillSubstitutions?: DefenseGrants['skillSubstitutions'];
  senses?: SenseEntry[];
  /** Feet, or a formula relative to the character ("floor(@actor.speed.land/2)"). */
  speeds?: SpeedGrants;
  resistances?: IwrEntry[];
  /** A weakness the item imposes while worn — a cursed one (Demon's Knot: cold iron 10, holy 10).
   *  Rarer than resistances, and the only home for it: a top-level `weaknesses` on an item record is
   *  read by nothing at all. */
  weaknesses?: IwrEntry[];
  immunities?: string[];
  speedPenalty?: number;
  /** A flat bonus to land Speed while invested/worn (Alacritous Horseshoes: +5 ft). Additive, unlike
   *  `speeds` which SETS a movement type. Applied to a character's or companion's land Speed. */
  speedBonus?: number;
  /** An item bonus to EVERY Lore skill (Brooch of Inspiration: +1 to Recall Knowledge with Lores —
   *  modeled as a flat Lore bonus since Lores are used almost only for Recall Knowledge). */
  loreBonus?: number;
  /** Languages the item lets you speak/read while invested (Stole of Civility → Azlanti). */
  grantsLanguages?: string[];
  /**
   * While invested, this item copies one wielded weapon's runes onto another — the Doubling Rings
   * and the Blazons of Shared Power. `'fundamental'` copies potency and striking; `'all'` copies the
   * property runes too and lifts the same-weapon-group restriction, which is what the greater
   * versions print. Replaces a hardcoded two-id set, so a new such item needs no code.
   */
  copiesRunes?: 'fundamental' | 'all';
}

export interface Ancestry extends ContentBase {
  hp: number;
  size: Size;
  speeds: Speeds;
  /** IWR the ancestry itself carries — the poppet's Flammable is "weakness to fire equal to one-third
   *  your level". Read by deriveDefenses; `senses` and `speeds` above are consumed elsewhere, so only
   *  these three come through that path. */
  resistances?: IwrEntry[];
  weaknesses?: IwrEntry[];
  immunities?: string[];
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
/**
 * A trackable per-period use limit.
 *
 * `every` covers the periods the rules state as a multiple — "once per 10 minutes" is
 * `{ max: 1, per: 'minute', every: 10 }`. Without it those had to be rounded to a period the union
 * happened to name, which would have been a rules error in the player's favour or against it.
 */
export interface LimitedUses {
  max: number;
  per: 'round' | 'turn' | 'minute' | 'hour' | 'day' | 'week' | 'month';
  /** Period multiplier; absent means 1. */
  every?: number;
  /** Cumulative max by character level, when the count grows ("once per day; at 12th twice, at 18th
   *  three times" — Fulu Familiar). The highest entry the character has reached wins; `max` is the
   *  value below the first entry. Rare, but a flat `max` would be a rules error at high level. */
  maxByLevel?: Record<number, number>;
}

export interface InnateSpellGrant {
  spellId: string;
  tradition?: string;
  atWill?: boolean;
  /** Cast-at rank when it differs from the spell's base rank (Invisible Trickster: 4th-rank
   *  Invisibility). Cantrip/at-will grants ignore this (they auto-heighten). */
  rank?: number;
  /** Daily castings when not 1 (Unfettered Growth: twice per day). Ignored for atWill. */
  usesPerDay?: number;
  /** The period `usesPerDay` counts against when it isn't a day (Azaersi's Roads: twice per WEEK).
   *  Display-only — the sheet shows the cadence; tracking still uses the single cast toggle. */
  usesPer?: 'day' | 'hour' | 'week';
  /** Auto-heighten: cast at ceil(level/2), the standard innate-heighten ladder ("heightened to half
   *  your level"). Overrides `rank`. */
  heightenHalfLevel?: boolean;
  /** A CUSTOM heighten ladder — "7th rank, 8th at level 18, 9th at 20". The highest entry whose
   *  `level` the character has reached wins; below the first entry the base `rank` applies. */
  heightenAt?: { level: number; rank: number }[];
}

export interface Heritage extends ContentBase, DefenseGrants {
  /** The owning ancestry, or null for a versatile heritage (any ancestry). */
  ancestryId: string | null;
  versatile: boolean;
  /**
   * Extra traits an ANCESTRY FEAT SLOT will accept because of this heritage — "you can select elf,
   * half-elf, and human feats whenever you gain an ancestry feat".
   *
   * The slot filter already takes your own ancestry's feats and, for a versatile heritage, the
   * heritage's own; a heritage that opens a THIRD ancestry's list had nowhere to say so.
   *
   * Only traits that actually ship on feats belong here. `half-elf`, `half-orc` and `geniekin` are
   * each carried by ZERO feats in this data — writing them would widen the pool by nothing while
   * recording the gap as closed.
   */
  extraAncestryFeatTraits?: string[];
  /** Grants a level-1 general feat of the player's choice (Versatile Human). The pick lives in
   *  BuildState.heritageFeatId. */
  grantsGeneralFeat?: boolean;
  /** Innate spells this heritage grants (e.g. Seer Elf → detect magic). */
  innateSpells?: InnateSpellGrant[];
  /** Nephilim-type heritages: grant low-light vision, upgraded to darkvision if the ANCESTRY already
   *  provides low-light vision. */
  darkvisionIfAncestryLowLight?: boolean;
  /** Dhampir & co.: void (negative) healing — healed by void energy, harmed by vitality. */
  negativeHealing?: boolean;
  /** "You can breathe underwater." A permanent capability with no number — it is not a sense, not
   *  a speed, and not a resistance, so it had no home and the records saying it did nothing. */
  breathesWater?: boolean;
  /** A resistance whose damage type the player chooses at level 1, valued at half the character's level
   *  (Deep Fetchling: cold/void; Elementheart Kobold: an element's damage type). The choice is stored in
   *  BuildState.heritageResistanceChoice. */
  choiceResistance?: { options: { value: string; label: string }[]; halfLevel: boolean };
  /**
   * A pick the heritage asks for that isn't a resistance ("choose a type of animal" — Beastkin;
   * "choose a patron" — Forge-Blessed Dwarf). Undeclared until now, so six heritages shipped a choice
   * that nothing rendered. Answered on the heritage step, stored under `heritage:<id>`.
   */
  choice?: FeatChoiceDef;
}

export interface Background extends ContentBase {
  /** A "choose one of N" this record asks at build time; resolved by buildCharacter and rendered
   *  by the shared EffectChoicesPicker. */
  effectChoices?: EffectChoice[];
  /**
   * The background's own embedded sub-choice — "an Ancestry Lore of your choice", "Guild Lore or
   * Heraldry Lore", "a skill of your choice".
   *
   * 71 backgrounds carry one and the field was not declared here at all, so nothing rendered it and
   * nothing read it: every one of those backgrounds asked a question no player was shown. Stored
   * under `featChoices['background:<id>']`, the same convention as a class feature's `feature:<id>`.
   */
  choice?: FeatChoiceDef;
  /** An authored note about something in this record the app cannot model. Collected for feats,
   *  heritages, class features and items but not backgrounds, so the one background carrying one
   *  warned nobody. */
  dataWarning?: string;
  abilityBoosts: AbilityBoost[];
  /** Innate spells the background grants outright — Blessed gives Guidance, Astrological Augur gives
   *  Augury. buildCharacter reads these alongside the heritage's; before that they were inert. */
  innateSpells?: InnateSpellGrant[];
  /** Skill the background trains you in. */
  trainedSkill?: SkillId;
  /** A "trained in your choice of X or Y" background: the offered skills (trainedSkill is unset).
   *  The pick lives in BuildState.backgroundSkillChoice; unpicked defaults to the first option. */
  trainedSkillChoice?: SkillId[];
  /** Lore subject granted (the `lore:` part). */
  trainedLore?: string;
  /** A background granting "a Lore subject of your choice" (rather than a fixed one): the player types
   *  the subject in the builder (Lore is free-text). Stored in BuildState.backgroundLore →
   *  lore:<typed> trained. */
  trainedLoreChoice?: boolean;
  /**
   * "Legal Lore OR Underworld Lore" — a choice between two NAMED subjects, not free text.
   *
   * Seven backgrounds had the two subjects concatenated into `trainedLore` by the importer, so the
   * character was trained in a Lore that does not exist ("Legal-lore-or-underworld Lore") and the
   * player was never asked. Rendered where `trainedLoreChoice` is, as a picker instead of a text box.
   */
  trainedLoreOptions?: string[];
  /** Skill/general feat(s) granted by the background. Usually one, but two backgrounds grant a PAIR —
   *  Eagle Hunter ("the Pet general feat AND the Train Animal skill feat") and Returned — and a single
   *  string silently dropped the second. Read it through `backgroundGrantedFeats()`, never directly. */
  grantedFeatId?: string | string[];
  /**
   * The feat depends on which `trainedSkillChoice` you took — "If you selected Performance, you gain
   * Impressive Performance; if you chose Society, Dubious Knowledge" (Historical Reenactor). Keyed by
   * the chosen skill. Five backgrounds print this, and with a flat `grantedFeatId` they all handed
   * out the FIRST branch's feat whatever you picked.
   */
  grantedFeatByChoice?: Record<string, string | string[]>;
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
  /**
   * The chosen VALUE names a class feature the character then owns — Basic/Greater/Major Lesson pick
   * a `lesson-of-*` record whose hex and grants live on that record, not on the feat.
   *
   * OPT-IN on purpose. Matching any choice value that happens to resolve would be wrong 33 times over:
   * Dragon Disciple Dedication offers "time", which is also the oracle's Time mystery, and Martial
   * Exercise offers "shield", which is a weapon group. An accidental match would hand a dragon
   * disciple an oracle subclass.
   *
   * The value may carry the importer's `aon-` prefix (`aon-lesson-of-calamity`) while the record does
   * not; ownedFeatureIds strips it.
   */
  ownsFeature?: boolean;
  /** How the options are produced:
   *  - 'array'   — fixed options carried on the record.
   *  - 'domains' — resolved from the chosen deity at build time.
   *  - 'skills'  — resolved from the CHARACTER at build time: the skills they're trained in (Lores
   *                included). Assurance is the canonical case ("Choose a skill you're trained in");
   *                enumerating skills on the record can't work, because which ones qualify depends
   *                on the build and changes as it grows.
   *  - 'text'    — free text the player types, for picks whose vocabulary the app has no data for
   *                (Kingmaker's Kingdom skills and leadership roles). Enumerating them from memory
   *                would be inventing content, so the player supplies the word and it is recorded.
   *  - 'open'    — an OPEN set described by `from`: "any 1st-level dwarf ancestry feat", "any common
   *                language". Resolved against content at render time and shown as a searchable list;
   *                baking the list into the record would bloat core.json and go stale. */
  kind: 'domains' | 'array' | 'skills' | 'text' | 'open';
  /** For 'open': what the player is choosing from. */
  from?: OpenChoiceFrom;
  /** For 'domains': which domains are offered. Default 'deity' (the deity's own list). Splinter
   *  Faith draws from "your deity's domains, your deity's alternate domains, and up to one domain
   *  that isn't on either list" — the last clause is the player's to honour and is stated in `note`,
   *  because nothing in the data marks a domain anathematic to a deity. */
  domainPool?: 'deity' | 'deity+alternate' | 'all';
  /**
   * `grant` is what the answer DOES. Without it a daily choice was recorded and nothing more: 67
   * records collected an answer at rest and the sheet never changed, so "habituate your skin against
   * this type of injury" read as a note rather than a resistance. Build-time picks have carried a
   * grant since the start (EffectChoice.options); this is the same shape for the nightly ones.
   */
  options?: { value: string; label: string; description?: string; grant?: EffectGrant }[];
  /**
   * Why this pick is RECORDED but grants nothing mechanical. Shown to the player next to the choice.
   * Two shapes, both agreed with the owner rather than guessed:
   *   - Kingmaker kingdom feats: the answer belongs to a kingdom sheet that doesn't exist yet, so it
   *     is stored ready for one.
   *   - Legacy content keyed off something the Remaster deleted (Warding Rune wants a school of
   *     magic; only 147 of 1,832 spells still carry one), so the benefit can't resolve.
   * Never used to paper over a pick that SHOULD work — legacy content whose referent still exists
   * keeps working normally.
   */
  inert?: string;
  /**
   * A caveat shown WITH the picker, for a choice that works but whose printed restriction can't be
   * enforced. Ghost Hunter Dedication wants "a cantrip with the divination, enchantment or necromancy
   * trait" — the Remaster deleted school traits, so filtering on them yields an EMPTY list. The picker
   * offers the tradition-legal set and says which part of the restriction is on the player to honour.
   * Distinct from `inert`, which means the pick grants nothing at all.
   */
  note?: string;
  /** For 'skills': the minimum rank a skill must reach to be offered (default 'trained'). */
  minRank?: ProficiencyRank;
  /**
   * How many separate answers the record asks for. Default 1. Terrain Scout picks TWO terrains,
   * Arcane Shroud three. Answers are stored per index (`<slotKey>#<i>`); a single-pick choice keeps
   * using the bare slot key, so existing saved characters are untouched.
   */
  picks?: number;
  /** The picks must differ ("choose two DIFFERENT terrains") — each picker hides the others' answers. */
  distinct?: boolean;
  /**
   * The pick is re-made at DAILY PREPARATIONS ("During your daily preparations, choose…") rather than
   * once when the feat is taken — Environmental Adaptability's cold-or-heat, Mask of Power's spell.
   * These answers live in `PlayState.dailyChoices`, NOT in the build: they change nightly, so a
   * build-time answer would wrongly survive a rest. The Rest sheet collects them.
   */
  daily?: boolean;
}

export interface Feat extends ContentBase, DefenseGrants {
  level: number;
  category: FeatCategory;
  prerequisites?: string[];
  actionCost?: ActionCost;
  /** The printed Frequency line, free text ("once per day"). Display only — kept because the homebrew
   *  editor round-trips it. The TRACKABLE limit is `limitedUses` below. */
  frequency?: string;
  /**
   * A structured per-period limit the sheet can actually track. Items have carried one for a while
   * (item.frequency → use pips via itemUses.ts); feats had nothing, so "once per day" on a feat was
   * text the player had to remember unaided. Spent uses live in PlayState.featUses and reset at rest.
   */
  limitedUses?: LimitedUses;
  /**
   * This feat RETUNES another feat's limit instead of having one of its own — "You can use Cat's Luck
   * once per hour, rather than once per day" (Reliable Luck). Thirty feats read like that, and without
   * this they either did nothing or, if given a `limitedUses` of their own, invented a second pool
   * next to the one they were supposed to be replacing.
   *
   * `unlimited` is for the handful that remove the limit entirely ("at all times, rather than just
   * once per day" — Eternal Wings).
   */
  usesUpgrade?: { featId: string; unlimited?: true } & Partial<LimitedUses>;
  trigger?: string;
  requirements?: string;
  access?: string;
  /** A sub-choice made when taking the feat (Domain Initiate domain, etc.). */
  choice?: FeatChoiceDef;
  /**
   * How many times this feat may be taken ("Special: you can select this feat more than once").
   * Absent = once (the default). A number is a hard cap (Armor Proficiency = 3, Skill Mastery = 5).
   * `null` = unlimited. Mirrors Foundry's `system.maxTakable`; read it through `maxTakes()`, never
   * compare directly (unlimited is `null`, not a big number).
   */
  maxTakable?: number | null;
  /** For archetype feats: the slug of the archetype it belongs to (from the import path). */
  archetype?: string;
  /** Focus spell(s) this feat grants (e.g. Blessed One Dedication → Lay on Hands). Only set when the
   *  feat also grants a focus pool point, so each entry contributes one focus point. */
  focusSpells?: string[];
  /** Focus pool points this feat adds when it grants/expands a pool but names no single focus spell
   *  (e.g. a choice-gated "increase your focus pool by 1" feat). */
  focusPoolBonus?: number;
  /** "Whenever you Refocus, you recover N Focus Points / completely refill your pool" — Domain Focus,
   *  Bloodline Focus, Conflux Focus, Amp Focus, Bloodline Wellspring. `'all'` refills to max.
   *  The highest value across everything the character owns wins; see FocusPool.refocusRestore. */
  refocusRestore?: number | 'all';
  /**
   * "Increase the number of items you can create each day with advanced alchemy to 6 + your
   * Intelligence modifier." `addInt` adds the modifier to `items`; `atLevel` is the higher printed
   * figure that kicks in later (Advanced Efficient Alchemy: 8 + Int, or 10 + Int from 16th).
   * The best offer across everything owned wins, so taking both Efficient feats is not additive.
   */
  advancedAlchemy?: { items: number; addInt?: boolean; atLevel?: { level: number; items: number } };
  /**
   * "Each day during your daily preparations, you can create a single temporary scroll containing a
   * 1st-rank spell."
   *
   * `advancedAlchemy` above is the proof this shape works and the proof it was built too narrowly:
   * it is alchemist-only, feat-keyed, and hardcoded to alchemical items, so seven records that hand
   * the player a DIFFERENT temporary item every morning had nowhere to live. Each entry is one slot
   * the player fills at rest; the answer is play state, re-picked daily, and clears at the next rest.
   */
  dailyTemporaryItems?: {
    /** Stable key, so two sources cannot collide in play state. */
    id: string;
    label: string;
    /** How many slots. `countByLevel` takes the highest entry whose level is reached. */
    count?: number;
    countByLevel?: { level: number; count: number }[];
    /** Scroll Adept scales on the spell DC's rank rather than on level. */
    countByProficiency?: { key: ProficiencyKey | 'spell-dc'; ranks: Partial<Record<ProficiencyRank, number>> };
    /** WHICH item may be chosen — the piece that did not exist. */
    filter: {
      /** A temporary SCROLL/WAND of a spell: what rank, rising with level. */
      spellRank?: number;
      spellRankByLevel?: { level: number; rank: number }[];
      /** Restrict the spell pool to the character's own spellbook (Scroll Adept). */
      fromSpellbook?: boolean;
      /** An ITEM instead of a scroll: required traits and an item-level ceiling. */
      traits?: string[];
      maxLevel?: number | string;
      /** Restrict to formulas the character knows (Herbal Forager). */
      fromKnownFormulas?: boolean;
      /** A printed restriction the app cannot enforce, shown with the picker. */
      note?: string;
    };
  }[];
  /**
   * "Your number of versatile vials per day increases to 5 … a second time to increase it to 6 …
   * a third time to 7." A repeatable feat that SETS a class resource's daily maximum, so `values` is
   * indexed by how many times the character has taken it. It raises a floor rather than replacing the
   * formula — a resource that already scales higher is never pulled down.
   */
  resourceMaxSet?: { resourceId: string; values: number[] };
  /** "You die from the dying condition at dying 5, rather than dying 4" (Diehard). Raises the death
   *  threshold; Doomed still steps it back down. See Character.dyingThreshold. */
  dyingThresholdBonus?: number;
  /** "Increase your maximum and encumbered Bulk limits by 4" (Beast of Burden). Raises both
   *  thresholds; deriveBulk computes them from Strength alone without it. */
  bulkLimitBonus?: number;
  /** "Increase the number of tactics you can have prepared by 1" (Efficient Preparation). The
   *  commander's preparedMax was an unconditional 3, so the feat never arrived. */
  preparedTacticsBonus?: number;
  /**
   * "Your proficiency bonus to untrained skill checks is equal to your level –2" (Untrained
   * Improvisation) or "…equal to your level" (Eclectic Skill). `levelMinus` is what the text
   * subtracts. An untrained skill scored a flat 0 proficiency, so both feats were inert.
   */
  untrainedProficiency?: { levelMinus: number };
  /**
   * "You become an expert in the alchemist class DC" — an ARCHETYPE feat raising the BORROWED class
   * DC a dedication granted. The secondary DC was pinned at trained with no way to advance it, so
   * every one of these feats left the number where the dedication put it.
   */
  classDcRank?: { classId: string; rank: ProficiencyRank };
  /**
   * "Add Illusory Disguise, Illusory Object, and Illusory Scene to your spell list" — spells the
   * picker should OFFER that your tradition does not contain. You must still learn them or add them
   * to your repertoire as normal, so this widens the pool and grants nothing by itself.
   *
   * The prepare/repertoire picker filtered strictly on `spell.traditions.includes(entry.tradition)`,
   * so a feat whose whole content is "you may now learn these" had nowhere to put them.
   * `entryId` narrows it to one spellcasting entry (Aura Enhancement adds to the divine font only);
   * omitted, the spells join every entry's pool.
   */
  /** "Increase your limit on invested items from 10 to 12" (Incredible Investiture). The inventory
   *  capped investment at a bare const 10, so the feat could not raise anything. */
  investedLimitBonus?: number;
  /**
   * "You regain twice as many Hit Points from resting" (Fast Recovery); Bolstered Recovery doubles
   * the condition steps too. rest() computed `level × Con mod` and stepped Doomed/Drained by exactly
   * 1, both unconditionally, so neither feat changed a thing about a night's sleep.
   * The best offer across everything owned wins — these are not additive.
   */
  restRecovery?: { hpMultiplier?: number; conditionSteps?: number };
  /**
   * Traits this feat adds to WIELDED weapons that match a filter — "Melee weapons you wield gain the
   * versatile B trait" (Hilt Hammer), "an agile or finesse melee weapon that doesn't have the deadly
   * trait gains deadly d8" (Deadly Grace). The wielded-weapon sibling of `unarmedTraits`.
   *
   * Every field on `match` must hold; `anyTrait` is the one OR ("agile OR finesse").
   */
  /**
   * Weakness types this feat REMOVES ("you no longer gain silver weakness from Werecreature
   * Dedication"). Every other field adds; there was no way to take one away, so a feat whose whole
   * point is undoing an earlier drawback left the drawback on the sheet.
   */
  removesWeaknesses?: string[];
  /** "You treat heavy armor as if it were 1 Bulk lighter" (Armor Regiment Training). Reduces the Bulk
   *  counted for WORN armor of the listed categories, never below 0 (Bulk 'L' armor stays L). */
  armorBulkReduction?: { by: number; categories?: ArmorCategory[] };
  /**
   * Traits this feat adds to unarmed Strikes the character ALREADY has — "your unarmed attacks gain
   * the reach trait" (Effortless Reach), "your beak unarmed attack gains versatile S" (Dogfang Bite).
   *
   * Distinct from `grantedStrikes`, which CREATES an attack. There was no way to say "change the one
   * you already have", so a whole family of capstone feats printed a trait nobody received.
   */
  /** Innate spells this feat grants (cast at a fixed tradition; cantrips at-will, else 1/day). */
  innateSpells?: InnateSpellGrant[];
  /** Max-HP modifier (Toughness/Mountain's Stoutness = perLevel 1; Thick Hide Mask = flat 20;
   *  Ghostly Resistance = perLevel -1). The Resiliency feats grant `perArchetypeFeat` HP per feat of the
   *  named `archetype` (dedication counts) — resolved against the character's feats in featHpBonus. */
  maxHpBonus?: { perLevel?: number; flat?: number; perArchetypeFeat?: number; archetype?: string };
}

export interface ClassFeature extends ContentBase, DefenseGrants {
  level: number;
  actionCost?: ActionCost;
  /** A Focus Point the FEATURE grants without a spell (Clarity of Focus, the psychic's 5th-level
   *  feature). The importer has been writing this; only `Feat.focusPoolBonus` was ever read, so it
   *  was undeclared, unread, and every psychic from 5th on was one Focus Point short. */
  focusPoolBonus?: number;
  /** Foundry classification tags (e.g. `armor-innovation-modification`) used to filter selectable options. */
  otherTags?: string[];
  /**
   * Enhanced Resistance: "The resistance from your initial armor modification adds your full level,
   * instead of half your level."
   *
   * All four initial armor modifications that grant resistance store it as a FORMULA
   * (`max(1,floor(@actor.level/2))`, `3+floor(@actor.level/2)`), so the upgrade rewrites the
   * half-level sub-expression rather than setting a number — that way a modification's flat bonus
   * survives. `'inventor-initial'` targets whichever initial modification the character chose.
   */
  resistanceLevelUpgrade?: 'inventor-initial';
  /**
   * Heavy Construction: "Your innovation becomes heavy armor, and your proficiency in your innovation
   * armor (but no other heavy armor) advances to be equal to your proficiency in medium armor."
   *
   * `proficiencyAs` is the load-bearing half: an inventor is never trained in heavy armor, so flipping
   * `category` alone would send the AC lookup to an untrained column and collapse AC.
   */
  armorRestat?: {
    /** Only restat the item carrying this designation (the innovation, not other armor). */
    designated: ItemDesignation;
    /**
     * …and only these item ids. The designation alone is not enough: nothing stops a player marking
     * their full plate as the innovation, and `proficiencyAs` would then hand a heavy suit the medium
     * track. Heavy Construction is printed "Power Suit only" and carries the matching tag.
     */
    items?: string[];
    set?: { category?: ArmorCategory; speedPenalty?: number; bulk?: number };
    addTraits?: string[];
    /** Read proficiency from THIS armor category instead of the restatted one. */
    proficiencyAs?: ArmorCategory;
    /** At or above this Strength modifier the armor's Speed penalty is removed outright. */
    removeSpeedPenaltyAtStr?: number;
  };
  /** Rune Capacity: "Your innovation can have one more property rune than a normal item of its kind."
   *  Applies to the designated item only — a blanket +1 would give every weapon a fourth slot. */
  propertyRuneBonus?: { designated: ItemDesignation; bonus: number; max: number };
  /** Focus spells the feature grants on reaching its level — Hero's Defiance is a 19th-level champion
   *  feature whose entire content is "you gain the Hero's Defiance devotion spell". buildCharacter
   *  reads these; before it did, the feature did nothing even at 20th level. */
  focusSpells?: string[];
  /**
   * A pick the feature itself asks for ("choose a damage type", "choose a Thassilonian school").
   *
   * The field was never DECLARED here, which is why nothing rendered it: 25 class-feature choices
   * shipped in core.json, were shown in no picker and answered by nobody. The builder now renders it
   * on the level where the feature is gained, storing under `feature:<id>`; a `daily` one is left to
   * the Rest sheet instead.
   */
  choice?: FeatChoiceDef;
  /** "Choose one of N" the player resolves in the builder, each option carrying its own grant. */
  effectChoices?: EffectChoice[];
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
  /**
   * Class-feature records this subclass hands over, beyond the class's own feature list — an oracle
   * MYSTERY brings its oracular curse (Ancestors → Curse of Ancestral Meddling).
   *
   * Those curse records were reachable by nothing: they are not in `Class.features`, not subclass
   * options themselves, and ownedFeatureIds had no route to them, so every field and star on all 11
   * rendered for nobody.
   *
   * A bare string means "from the level the subclass is taken". A `{ id, level }` gates it, which is
   * what the gunslinger's ways need: each way hands over three deeds at 1st, 9th and 15th, and with
   * only the bare form a 1st-level gunslinger would own their 15th-level Greater Deed.
   */
  featureIds?: (string | { id: string; level: number })[];
  /**
   * The eidolon type's own abilities, one per tier.
   *
   * Every one of the 13 eidolon types already printed the answer in its own description — "Eidolon
   * Abilities *Initial* breath weapon; *Symbiosis* draconic frenzy; *Transcendence* wyrm's breath",
   * followed by the full text of each — and nothing structured it, so the eidolon's block listed
   * none of them and Eidolon Symbiosis (7th) and Eidolon Transcendence (17th) arrived empty.
   */
  eidolonAbilities?: { tier: 'initial' | 'symbiosis' | 'transcendence'; level: number; name: string; text: string }[];
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
    /** Lore SUBJECTS the option trains ('farming', 'herbalism'). An animist apparition grants two
     *  named Lores, and `skills` — a SkillId list — cannot express a Lore at all. Kept `lore:<subject>`. */
    lores?: string[];
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
  /**
   * Whether `baseDamage` HURTS or HEALS. 449 spells carry it, 31 of them `healing`.
   *
   * ⚠ DELIBERATELY UNREAD — a parked landmine, not an oversight. Nothing today applies a NUMERIC
   * bonus to spell damage: `spellDamage` is a situational target only, so it renders prose the
   * player reads and applies themselves, and prose cannot be wrong about healing.
   *
   * THE MOMENT a numeric spell-damage bonus exists, this field is what stops "+2 to your spell
   * damage" adding +2 to a heal. Read it there.
   *
   * It is NOT a blanket "skip healing" rule — check each record's own words. Sorcerous Potency reads
   * "a spell … that deals damage OR RESTORES HIT POINTS" and is meant to cover both; Dangerous
   * Sorcery reads "that deals damage" and is not.
   *
   * `test/parked-fields.test.ts` fails the build the moment this gains a reader, and tells whoever
   * added it to come read this comment.
   */
  damageKind?: 'damage' | 'healing';
  /** Structured base area (companion to the prose `area` string), in feet. */
  baseArea?: { value: number; kind: string };
}

/* ---- Items: a discriminated union on `itemType` ---- */

interface ItemBase extends ContentBase {
  level: number;
  /**
   * CURSED ITEMS ONLY: the id of the ordinary item this one imitates — Gaffe Glasses imitate Glasses
   * of Sociability. When a GM plants the item hidden, the player sees THIS record instead: its name,
   * its description and its bonuses, exactly as the item deceives them in the fiction. Only cursed
   * items whose own text describes a disguise carry it.
   */
  disguisedAs?: string;
  /**
   * A cursed item the wearer cannot simply take off. The app does not enforce this — the GM does —
   * but deleting one warns the player to ask first, so they do not discover later that it came back.
   */
  stuck?: boolean;
  /** Innate spells the item grants while INVESTED — a Cloak of Elvenkind lets you cast Ghost Sound,
   *  a Nosoi Charm casts Sending once a day. Distinct from `heldSpells`, which is the "Activate: Cast
   *  a Spell" charge system (staves and wands); these are simply available while the item is worn. */
  innateSpells?: InnateSpellGrant[];
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
  /** Extra Strike damage the item confers. On a WEAPON it's intrinsic (only that weapon's Strike —
   *  Hyldarf's Fang +2d6). On any other invested item it applies to the matching Strikes globally
   *  (Crimson Fulcrum Lens +2 melee). Same shape as a feat's strikeDamage. */
  strikeDamage?: StrikeDamageRider[];
  /** An invested item that grants void ("negative") healing (Emerald Fulcrum Lens). Surfaced on the
   *  Defenses card while invested. */
  negativeHealing?: boolean;
  /** "You can breathe underwater." A permanent capability with no number — it is not a sense, not
   *  a speed, and not a resistance, so it had no home and the records saying it did nothing. */
  breathesWater?: boolean;
  /** Feats an invested item grants as bonus feats (The Survivor → Diehard). */
  grantsFeats?: string[];
  /** An item bonus to the character's DYNAMIC skills — resolved from their sorcerer bloodline (Sanguine
   *  Pendant → both bloodline skills) or their deity (Helm of Zeal → the deity's skill). */
  dynamicSkillBonus?: { source: 'bloodline' | 'deity'; value: number };
  /** Unarmed Strikes an invested item grants (Phantom Shroud → ghostly touch). Same shape as a feat's
   *  grantedStrikes — surfaced as natural attacks. */
  grantedStrikes?: GrantedStrike[];
  /** Monster Parts (variant rule): marks this created item as a harvested MONSTER PART — a raw
   *  resource, not a refined/imbued gear item. Its VALUE is the item's `price` (gp) and its tags are
   *  `monsterPartTags`. `true` = it is a monster part; absent = a normal item. (Presence of the flag,
   *  not the tag array, is the discriminator, so a tagless part still reads as a monster part.) */
  isMonsterPart?: true;
  /** Vocabulary + free-text tags describing what this monster part offers (energy/damage types, traits,
   *  attributes, senses, skills, creature types, …) for the reference-only requirement-match hints.
   *  Only meaningful alongside `isMonsterPart`; may be empty. */
  monsterPartTags?: string[];
  /**
   * PASSIVE effects the item applies while worn/invested/equipped (the generic magic-item lane the
   * full player-effect audit added): flat ITEM bonuses to skills (`lore:<subject>` supported) /
   * Perception / all saves / AC / attack rolls, plus granted senses, non-land speeds, resistances,
   * immunities, and a flat speed penalty in feet (negative; Monster Suit). Item bonuses never stack —
   * derive takes the best of ABP / Monster Parts / this. Activated or conditional effects stay in the
   * description; this field is only for unconditional while-worn effects.
   */
  passiveEffects?: ItemPassiveEffects;
  /**
   * A worn item that RAISES a group's armor specialization value — Reinforced Surcoat, "you instead
   * increase the physical resistance from the chain armor specialization by 2".
   *
   * On ItemBase rather than ArmorItem because the surcoat is `equipment`, not armor: it is worn OVER
   * the armor whose specialization it improves. `group` scopes it to the printed group.
   */
  armorSpecBonus?: { group?: string; value: number };
  /**
   * CONDITIONAL effects: a `*` on each stat named, with the trigger and the bonus spelled out when
   * the player opens that stat. Nothing here changes a number — the whole point is the effects that
   * only apply sometimes, which no computed total can honestly include.
   *
   * Shipped items get these from the situational registry, keyed by item id. This field is what the
   * item editor's Advanced section writes, so a player can mark anything the data doesn't cover —
   * or anything their table rules differently — without waiting for the app to model it.
   */
  situational?: SituationalBonus[];
  /** Extra prepared/spontaneous spell slots the item grants while invested (Endless Grimoire,
   *  Sin Reservoir). Same shape + application as a feat's spellSlotBonus. */
  spellSlotBonus?: SpellSlotBonus;
  /** "Choose one of N" passive effects (Energy Robe's resistance type). Same mechanism as
   *  DefenseGrants.effectChoices, resolved into resolvedItemPassives when worn. */
  effectChoices?: EffectChoice[];
  /** Sheet-visible warning that this item's effect references missing (legacy) content. */
  dataWarning?: string;
  /** INTERNAL, never rendered: marks a synthetic Add-Items row that isn't a real inventory item but a
   *  reference/buyable entry routed elsewhere (services, and the vehicle/siege companion catalogs).
   *  This used to be smuggled in as a fake `__service`/`__vehicle`/`__siege` TRAIT, which then showed
   *  up as a literal "__siege" pill in the Traits filter. Keep synthetic markers OUT of game-data
   *  fields — anything in `traits` is user-visible somewhere. */
  catalogKind?: 'service' | 'vehicle' | 'siege';
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
  /** "If you have armor specialization with heavy armor, your resistance applies to both slashing and
   *  piercing damage" (Highhelm Stronghold Plate) — extra IWR types the specialization also covers. */
  armorSpecExtraTypes?: string[];
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
  /** A "choose one of N" this record asks at build time; resolved by buildCharacter and rendered
   *  by the shared EffectChoicesPicker. */
  effectChoices?: EffectChoice[];
  edicts?: string[];
  anathema?: string[];
  divineFont?: ('heal' | 'harm')[];
  domains?: string[];
  /** Favored weapon item ids (a worshipper's class may grant proficiency in these). */
  favoredWeapons?: string[];
  /** The skill the deity grants training in. */
  skill?: string;
  /** Domains the deity offers BESIDES its primary ones. The importer kept only the primary list, so
   *  "chosen from among your deity's domains, your deity's alternate domains…" (Splinter Faith) could
   *  not be offered — 401 deities have alternates and none of them shipped. */
  alternateDomains?: string[];
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
  attacks: CompanionAttack[];
  /** Signature trained skills beyond the universal Acrobatics + Athletics. */
  skills: SkillId[];
  support: string;
  maneuver: string;
  /** The type's "Special" line (mount, extra poison damage, an added creature trait, …). */
  special?: string;
  /** Flavour text + Special/Access notes — shown in the Add-companion picker. */
  description?: string;
  rarity?: Rarity;
  /** Creature traits (animal, minion, undead, …). */
  traits?: string[];
  source?: SourceInfo;
  edition?: string;
}

/** One of a companion's natural Strikes. */
export interface CompanionAttack {
  name: string;
  die: string;
  damageType: string;
  traits: string[];
  /** A rider printed after the damage ("plus Grab", "plus poison"). */
  plus?: string;
  /** Set for Strikes whose damage does NOT add the companion's Strength (the Ghost's ghostly touch). */
  noStrengthDamage?: boolean;
}

/** A familiar / master ability (from the familiar-abilities pack). */
export interface FamiliarAbility {
  id: string;
  name: string;
  /** 'master' abilities require the master to act; 'familiar' are innate. */
  kind: 'master' | 'familiar';
  description: string;
  /** Cross-references in `description` (for in-text linking). */
  descRefs?: DescRef[];
  source?: SourceInfo;
  edition?: string;
}

/** A unique ability a specific familiar grants on top of its required abilities. */
export interface SpecificFamiliarSpecial {
  name: string;
  /** Action cost shown as a glyph where applicable. */
  cost?: ActionCost;
  desc: string;
}

/**
 * A specific familiar — a named familiar "template" (Pipefox, Imp, …). It can be applied to a
 * familiar that has at least `requiredCount` familiar abilities; it locks in the listed required
 * abilities (which count against that total) and grants the unique specials on top.
 */
export interface SpecificFamiliar {
  id: string;
  name: string;
  /** Minimum familiar abilities the familiar must have to become this specific familiar. */
  requiredCount: number;
  /** Always-on familiar abilities (consume slots from the daily total). */
  requiredAbilities: string[];
  /** Unique abilities granted in addition (don't count against the total). */
  specials: SpecificFamiliarSpecial[];
  /** Creature traits this familiar gains (construct, fiend, dragon, …). */
  traits: string[];
  /** A short note (prerequisite / access), if any. */
  note?: string;
  description?: string;
  rarity?: Rarity;
  source?: SourceInfo;
  edition?: string;
}

/**
 * An animal-companion ADVANCED option (Nimble, Savage, Indomitable, Genie-Touched, Unseen) — the
 * rung a mature companion advances to. `maturity` links the option to the engine's maturity ladder
 * (src/rules/companions.ts) where one exists; the rest are reference text for now.
 */
export interface CompanionAdvancedOption {
  id: string;
  name: string;
  description: string;
  /** The Maturity id this option corresponds to, when the engine models it. */
  maturity?: string;
  rarity?: Rarity;
  source?: SourceInfo;
  edition?: string;
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
  source?: SourceInfo;
  edition?: string;
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
  /** Most siege weapons are uncommon or rarer — shown as a chip on the stat block. */
  rarity?: Rarity;
  source?: SourceInfo;
  edition?: string;
}

/**
 * A siege-weapon reference statblock: the vehicle defensive frame + one or more attacks.
 *
 * `size`/`ac`/`hp`/`hardness` are OPTIONAL here (unlike a vehicle) because the source genuinely
 * omits them for some siege weapons: PORTABLE ones (the rams) are carried objects rated by Bulk and
 * print no defensive block at all, the Light Mortar's defensive stats live in the Inventor
 * innovation that grants it, and the Cyclonic Cannon is printed with no size trait. They are left
 * absent rather than invented — the UI drops the row.
 */
export interface SiegeWeaponStat extends Omit<VehicleStat, 'size' | 'ac' | 'hp' | 'hardness'> {
  size?: string;
  ac?: number;
  hp?: number;
  hardness?: number;
  attacks?: {
    name: string;
    actionCost?: string;
    bonus?: number;
    damage?: string;
    range?: string;
    reload?: string;
    /** An explicit melee Strike (a Ram, or the Wolf Fang's Launch). Absent = inferred from `range`. */
    melee?: boolean;
  }[];
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

  /* ---- grants, not just numbers -------------------------------------------------------------- */
  /**
   * A mode may grant the same DEFENCES a feat or item can, not only numeric check bonuses.
   *
   * Before this, `modifiers` could express "+2 Stealth" but nothing else, so a potion that grants
   * "tremorsense 30 feet for 1 minute" or "resistance 5 to fire until the start of your next turn"
   * had nowhere to live — 92 of the 108 toggles found by the coverage sweep needed exactly these.
   * The proof it was missing: Triple Time (+10 ft Speed to allies) shipped as `modifiers: []` with a
   * note, because there was no field for it.
   *
   * Consumed by deriveDefenses alongside feats, heritages, items and stances, so the sheet's
   * resistance list is the same list whether the source is permanent or a potion — and the breakdown
   * names the mode, so a player can see which of their resistances vanishes when it wears off.
   */
  resistances?: IwrEntry[];
  weaknesses?: IwrEntry[];
  immunities?: string[];
  senses?: SenseEntry[];
  /** Speeds granted while the mode is on — "a fly Speed of 40 feet for 1 minute". Consumed by
   *  deriveSpeeds alongside the heritage/feat/item grant sources. */
  speeds?: SpeedGrants;
  /** Unarmed Strikes the mode grants for as long as it is on — Invoke Offense's 1d8 spirit brawling
   *  attack, which lasts "for the duration of your spirit trance". A stance could already do this;
   *  a mode could not, so a toggle whose whole content was "you gain an attack" had nowhere to put
   *  it. Applied exactly where the active stance's strikes are, so they scale identically. */
  grantedStrikes?: StanceStrike[];
  /**
   * Extra damage the mode adds to Strikes while it is on — iron wine's "+1d4 fire to your unarmed
   * attacks for 10 minutes".
   *
   * `grantedStrikes` was not enough: that GRANTS a new attack, whereas this RIDES on the attacks you
   * already have. The rider shape is the one feats, class features and invested items already use,
   * so a temporary source and a permanent one produce the same line in the strike breakdown.
   */
  strikeDamage?: StrikeDamageRider[];
  /** Scope of a USER-created mode: a roster character id ⇒ only that character sees it; absent ⇒
   *  universal (every character on this device). Catalog/predefined modes never set this. */
  charId?: string;

  /* ---- item-driven modes (consumables) ------------------------------------------------------ */
  /**
   * The consumable that switches this mode on. Set ⇒ the mode belongs to the ITEM, not to the
   * player's own list: it is hidden from the Modes manager and search, and appears only by using
   * the item.
   */
  fromItemId?: string;
  /**
   * The printed duration ("5 minutes", "until your next daily preparations"), shown on the pill.
   * The app has no clock — this tells the player what they are tracking; they switch it off.
   */
  duration?: string;
  /**
   * Item modes clear at rest by default. Set true for the few whose printed duration outlasts a
   * night, so a mutagen lasting "until your next daily preparations" is not wiped by the rest that
   * is meant to end it.
   */
  survivesRest?: boolean;
}

/** An unarmed Strike a stance grants while active (e.g. Tiger Stance's claw). */
export interface StanceStrike {
  name: string;
  dice: number;
  die: string;
  damageType: string;
  group?: string;
  traits: string[];
  /** A granted attack that gains striking runes by LEVEL rather than from handwraps — "at 5th level
   *  this unarmed attack gains the benefits of a striking rune, at 12th greater, at 20th major".
   *  Highest qualifying entry wins, and it is a FLOOR: real handwraps still beat it if better. */
  strikingByLevel?: { level: number; extraDice: number }[];
}
/** The mechanical effects of a stance (extracted from its rules text; keyed by feat/action slug in
 *  ContentDatabase.stances). Only one stance is active at a time (Character.activeStance). */
export interface StanceDef {
  /** Slug (= the stance feat/action id) and display name — stamped by the importer. */
  id?: string;
  name?: string;
  strikes?: StanceStrike[];
  /** AC bonus granted while in the stance (e.g. Mountain Stance +4 item). */
  acBonus?: { value: number; type: string };
  /** Dexterity-to-AC cap the stance imposes (e.g. Mountain Stance 0); undefined = no cap. */
  dexCap?: number;
  /** Feet subtracted from all Speeds while in the stance. */
  speedPenalty?: number;
  /** Typed resistances granted while the stance is active (Rain of Embers: fire = half level).
   *  `value` may be an `@actor.level` formula string like the IwrEntry it is. */
  resistances?: IwrEntry[];
  /** Senses granted while active (an alternate FORM's low-light/scent, a stance's tremorsense).
   *  Only surface while the stance/form is the active one. */
  senses?: SenseEntry[];
  /** Senses a SEPARATE rider feat grants only while this form is active (Ursine Avenger Form's senses
   *  come from the Senses of the Bear feat). Applied only if the character owns `feat`. */
  senseIfFeat?: { feat: string; senses: SenseEntry[]; upgradeDarkvisionIfLowLight?: boolean };
  /** Speeds granted or raised while active — an absolute value, or an `@actor.speed.land`-style formula
   *  ("fly equal to your land Speed"). Applied over the base Speeds while the stance/form is active. */
  speeds?: SpeedGrants;
  /** Save proficiency-independent status bonuses while active (Cobra Stance: +1 Fortitude). */
  saves?: Partial<Record<SaveId, { value: number; type: string }>>;
  /** This entry is an alternate FORM (Ursine Avenger, Bat Form), not a footwork stance — it surfaces
   *  as a toggle even without the `stance` trait, and reads as "Form" in the UI. */
  form?: boolean;
  /** The stance's printed **Requirements** line. 47 of the 128 stances have one and none used to be
   *  enforced, so a character in full plate could toggle Rain of Embers and keep its +1 status AC.
   *  `unarmored` is the machine-checkable part; `text` is always the printed wording, shown either as
   *  the reason the stance is inert or (for requirements we can't check) as a reminder. */
  requires?: { unarmored?: boolean; armored?: boolean; text: string };
  /** Concise reminder of the stance/form's other or conditional effects. */
  note?: string;
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
  /** Set when this companion was materialized from a feat/feature grant (e.g. the Pet feat). Ties the
   *  real companion back to its granting feat so the synthetic auto-copy stops showing once persisted. */
  grantSlug?: string;
  /** The companion's own gear (barding, packs, …), tracked separately from the character's. */
  inventory?: InventoryItem[];
  /** Companion portrait — the compressed (synced) data URL the player imported. */
  portrait?: string;
  /** Key for this companion's on-device sharp portrait copy (installed app only; never synced). */
  portraitRef?: string;
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
  /** Animal-companion advanced options (Nimble, Savage, Indomitable, …). */
  companionAdvanced?: Record<string, CompanionAdvancedOption>;
  /** Specific familiars (Pipefox, Imp, …) — named familiar templates. */
  specificFamiliars?: Record<string, SpecificFamiliar>;
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
  /** Stance mechanical effects (strike/AC/dexcap/speed), keyed by the stance feat/action slug. */
  stances: Record<string, StanceDef>;
  /** Etchable runes (potency/striking/resilient/reinforcing + property runes), keyed by id. */
  runes: Record<string, RuneDef>;
  /** Ids of `aon-` scrape records that duplicate a canonical record of the same name. They stay in
   *  the database (so a saved character that already picked one still resolves) but are omitted from
   *  user-facing LISTS. Computed at load time — see findDuplicateIds in src/data/index.ts. */
  duplicateIds?: Set<string>;
  /** Item ids that are an AoN family SUMMARY, not an ownable item — hidden from every picker but
   *  still resolvable by id, so a character who added one keeps it. See findUmbrellaIds. */
  umbrellaIds?: Set<string>;
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
  /**
   * A PROPERTY rune that "functions as" a fundamental one — Adamantine Echo works as a +1 armor
   * potency rune. It cannot simply BE `kind: 'potency'`: that would make it occupy the potency slot
   * instead of a property slot, which is the whole point of the relic.
   */
  actsAs?: { kind: 'potency' | 'striking' | 'resilient' | 'reinforcing'; value: number };
  /**
   * Everything else an armour property rune does. `damage` was the ONLY payload a rune could carry
   * and it is weapon-side, so an armour property rune could never do anything mechanical at all —
   * both of the ones that ship were bare registrations. Reuses the ITEM shape rather than inventing a
   * rune-specific one, so a rune reaches every reader an invested item already reaches.
   */
  passiveEffects?: ItemPassiveEffects;
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
  /**
   * How many points one Refocus restores. 1 by RAW; a whole family of feats raises it (Domain Focus,
   * Bloodline Focus, Conflux Focus and Amp Focus refill the POOL; the Wellspring feats give 3).
   * `'all'` means refill to max. Absent = 1.
   *
   * A numeric value carries its own printed threshold — "recover 3 Focus Points when you Refocus
   * instead of 1, if you have spent at least 3" — and in every printed case the threshold equals the
   * amount, so the rule is "N if you spent at least N, else 1". No separate field is needed.
   *
   * The Refocus button used to add exactly 1 with no way to say otherwise, so every one of those
   * feats was inert — a player could own a pool-refilling feat and still have to click Refocus three
   * times.
   */
  refocusRestore?: number | 'all';
  /** The feat or feature that raised it, for the button's tooltip. */
  refocusSource?: string;
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
  /** Per-weapon-GROUP proficiency (alchemist bombs), keyed by weapon group. Wins if higher than the category rank. */
  weaponGroups?: Record<string, ProficiencyRank>;
  /** "Firearms & crossbows" proficiency by weapon CATEGORY (gunslinger). Consulted only for a weapon in the
   *  firearm or crossbow group, so a gunslinger can be e.g. master with simple firearms while advanced firearms
   *  stay trained — which a single group rank can't express. Wins if higher than the plain category rank. */
  firearmProf?: Partial<Record<WeaponCategory, ProficiencyRank>>;
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
  /** Set when this feat was auto-granted by ANOTHER feat (FEAT_FEAT_GRANTS), not chosen in a slot —
   *  the granting feat's id. Lets the sheet tag it "granted by …". */
  grantedBy?: string;
  /**
   * The slot this feat was picked into (`"13:class"`), when it came from one.
   *
   * A REPEATABLE feat fills several slots, and every per-feat answer keyed by feat id alone can
   * therefore hold only one answer — Advanced Arcana taken three times could record a single pick.
   * The slot key is what distinguishes the takings.
   */
  slotKey?: string;
  /** For a feat granted by a pick-a-feat grant: the SLOT of the taking that granted it. Lets a
   *  rebuild pair each taking of a repeatable grant with the pick it actually made. */
  grantedBySlot?: string;
}

/** Build log of skill increases (for the builder to validate progression). */
export interface SkillIncrease {
  level: number;
  skill: ProficiencyKey;
}

/** A flat/dice damage rider a feat/feature adds to Strikes (Spirit Striking, Offensive Boost). */
export interface StrikeDamageRider {
  /** Damage type of the extra damage ("spirit", "fire", …). */
  type: string;
  /** Which Strikes it applies to. Default 'all'. */
  appliesTo?: 'all' | 'unarmed' | 'melee' | 'ranged';
  /** Flat extra damage (a fixed number). */
  flat?: number;
  /** Extra damage dice (Offensive Boost: 1d6). */
  dice?: { n: number; die: string };
  /** Flat extra keyed to the STRIKE's weapon-proficiency rank (Spirit Striking: expert 2 / master 3 /
   *  legendary 4). Only applies at the listed ranks — a strike below the lowest key gets nothing. */
  byStrikeProficiency?: Partial<Record<'expert' | 'master' | 'legendary', number>>;
  /** Short label for the source, shown in the strike breakdown. */
  note?: string;
}

export interface WeaponRunes {
  potency?: 0 | 1 | 2 | 3 | 4;
  striking?: 'striking' | 'greater' | 'major' | 'mythic';
  property?: string[];
}

export interface ArmorRunes {
  potency?: 0 | 1 | 2 | 3 | 4;
  resilient?: 'resilient' | 'greater' | 'major' | 'mythic';
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
  /** Range increment (ft) for a RANGED natural attack (Spined Azarketi spine); undefined = melee. */
  range?: number;
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
  /** Range increment in feet for a RANGED natural/unarmed attack (Spined Azarketi's spine); undefined = melee. */
  range?: number;
  /** Set only when gated by a ChoiceSet pick (e.g. Iruxi 'fangs'/'tail'); undefined = unconditional. */
  choiceValue?: string;
}

/** One stack of an item in the character's inventory. */
/**
 * The role an inventory item plays for its owner's class. One mechanism, several users: the
 * inventor's innovation, the thaumaturge's weapon implement, the wizard's bonded item, an exemplar's
 * ikon, and a weapon acting as a rune source for another.
 */
export type ItemDesignation = 'innovation' | 'weapon-implement' | 'bonded' | 'ikon' | 'rune-source';

/**
 * Spells a record gives the character ACCESS to, and in what sense.
 *
 * "Access" is three different promises in the printed text and they are not interchangeable:
 *   'list'       widens the prepare/repertoire picker. You may now LEARN these — Dragon Arcana's
 *                "you must still learn them or add them to your repertoire as normal". The default.
 *   'repertoire' you actually KNOW them, free of the known-spells cap — "add Heal and Harm to your
 *                apparition's repertoire".
 *   'font'       they become legal choices for your divine font, which is a separate pool from both.
 */
export interface SpellAccessGrant {
  spells?: string[];
  /** Narrow to one spellcasting entry (a font addition belongs to the font's own entry). */
  entryId?: string;
  as?: 'list' | 'repertoire' | 'font';
}

export interface InventoryItem {
  /** Unique per inventory entry (distinct from the item definition id). */
  instanceId: string;
  /** Reference into ContentDatabase.items (or a homebrew item id). */
  itemId: string;
  quantity: number;
  /** The record that HANDED the character this item ("You gain a Razmiri mask") — displayed, and the
   *  reason it cost no gold. Absent for anything the player bought or added themselves. */
  grantedBy?: string;
  worn?: boolean;
  /** Held/wielded. */
  equipped?: boolean;
  invested?: boolean;
  /** instanceId of the container holding this item, or null if loose. */
  containerInstanceId?: string | null;
  /** instanceId of the item this is AFFIXED to (talisman/spellheart/banner → weapon/armor/shield). */
  attachedTo?: string | null;
  runes?: WeaponRunes | ArmorRunes;
  /** Doubling Rings: the instanceId of ANOTHER wielded weapon whose runes are duplicated onto THIS
   *  weapon while the rings are invested and both are wielded. Set on the lesser-ring (target) weapon. */
  copyRunesFrom?: string;
  /**
   * What this item IS to the character's class, beyond being an item.
   *
   * The app never linked a class choice to an inventory item: an inventor's build recorded an
   * innovation TYPE and three modification ids but no item, and the thaumaturge's weapon implement
   * and the wizard's bonded weapon were not recorded anywhere at all. That single absence is why 19
   * inventor modifications, both crit-spec clauses, the armour restat and the rune cap were inert —
   * every one says "your innovation…" and nothing knew which object that meant.
   *
   * A rider filtering on a designation applies to NOTHING when none is set. There is deliberately no
   * "first weapon" fallback: guessing would hand a greatsword's modifications to a dagger.
   */
  designations?: ItemDesignation[];
  /**
   * Battleforger (ruling O): an hour's work grants this weapon or armour the effects of a +1 potency
   * rune UNTIL YOUR NEXT DAILY PREPARATIONS — a real number (+1 attack, or +1 AC), not a note.
   *
   * A flag rather than a written rune, for two reasons: the feat says it "has no effect if the
   * weapon or armor already had a potency rune", so it must lose to a real one rather than stack;
   * and it expires, so it must be distinguishable from a permanent rune the player etched. Cleared
   * by rest(), and shown on the item card so a temporary bonus never looks permanent.
   */
  /**
   * Answers to THIS item instance's "choose one of N" (Item.effectChoices), keyed by choice id.
   *
   * On the instance rather than the character so two copies of the same item can differ, and because
   * equipment is bought on the sheet: buildCharacter only ever resolves item choices for gear in
   * build.inventory, so an item acquired in play had a question nobody could answer.
   */
  effectChoices?: Record<string, string>;
  battleforged?: boolean;
  /** Set by a GM who planted this cursed item WITHOUT telling the player. Its  twin
   *  is what the player sees; the GM view shows the true item and the true numbers. */
  hiddenCurse?: boolean;
  /** Player-tracked limited uses (legacy single counter — kept for back-compat). When
   *  resetsOnRest is set, daily preparations (rest) refill `current` to `max`. */
  charges?: { current: number; max: number; resetsOnRest?: boolean };
  /** Per-instance live values for the item's `counters`, keyed by counter id. */
  counters?: Record<string, { current: number; max: number; resetsOnRest?: boolean }>;
  /** For a generic scroll/wand (item.spellSlot): the spell id the player chose to store in it. */
  heldSpell?: string;
  /** Monster Parts (variant rule): when present, this item is refined/imbued with monster parts and
   *  ignores its runes/precious material. Absent = a normal runed item. */
  monsterPart?: ItemMonsterPart;
}

export type SpellcastingType = 'prepared' | 'spontaneous' | 'focus' | 'innate' | 'ritual' | 'items';

/** A single prepared slot (prepared casters). */
export interface PreparedSlot {
  /** Spell prepared into this slot, or null if empty. */
  spellId: string | null;
  expended: boolean;
  /**
   * Spell Blending: this slot was TRADED away this morning and is not a slot you have today.
   *
   * It is marked rather than removed on purpose. Prepared slots are addressed by ARRAY INDEX
   * (`preparedKey(entryId, rank, index)`) and PlayState keys its prepared spells and expended flags
   * that way, so shrinking a rank's array would silently re-point every saved key after it.
   */
  traded?: boolean;
  /** Spell Blending: a bonus slot gained by trading two slots of THIS rank. Its key is derived from
   *  the source rank rather than its position, so removing another trade cannot renumber it. */
  bonusFrom?: number;
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
  /**
   * Spell Blending: additional cantrip openings bought by trading a spell slot, `null` until filled.
   *
   * Kept apart from `cantrips` and written by the play overlay ONLY. Merging them into `cantrips`
   * would push the list past the known-cantrip cap the builder enforces, and a build round-trip would
   * bake today's temporary picks into the character permanently.
   */
  tradedCantrips?: (string | null)[];
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
  /** Innate entries: per-spell daily-uses override — 0 = at-will (a leveled at-will grant), N = N/day.
   *  Absent = the default 1/day. Display-driving; use tracking remains the single innateUsed toggle. */
  innateUses?: Record<string, number>;
  /** Innate entries: per-spell cadence text when it isn't per-day ("2/week"). Display only. */
  innateCadence?: Record<string, string>;
  /** Which feat/heritage/feature GRANTED each spell in this entry, by spell id → source name. Pooled
   *  entries (innate spells, focus spells) draw from many sources, so the sheet labels each spell with
   *  where it came from. */
  spellSources?: Record<string, string>;
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
  /** A short reminder rendered under the entry header (Bloodrager: spells gain the rage trait while you
   *  rage; casting one drains you 1). Purely informational — no automatic slot/condition effect. */
  note?: string;
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
  /** Monster Parts (Battlezoo, Remaster conversion) — harvest parts to refine/imbue items in place of
   *  runes/materials. When on, eligible items may switch to Monster-Parts mode. */
  monsterParts?: boolean;
  /** Which Monster Parts GM variant is in play. Mostly informational — the per-item refine/imbue math
   *  is identical across all three; the mode only drives the treasure-by-level reference guidance. */
  monsterPartsMode?: MonsterPartsMode;
}

/** The three GM variants for the Monster Parts subsystem (drives treasure guidance only). */
export type MonsterPartsMode = 'full' | 'light' | 'hybrid';

/** The per-item Monster-Parts blob. Present on an InventoryItem that has switched to Monster-Parts mode;
 *  such an item ignores its runes/precious material entirely (an item uses EITHER this system OR runes,
 *  never both). Values are banked-part gp assigned to refining and to each imbued property; item level
 *  and property levels are derived from those values via the Table 3/5 thresholds. */
export interface ItemMonsterPart {
  /** The refined item type — decides which refinement/imbuing tables and part requirements apply. */
  kind: MpItemKind;
  /** Total gp of parts sunk into refining (raises the item's level per Table 3A/3B). */
  refineValue: number;
  /** Imbued properties, each with its chosen path and the gp sunk into it. */
  imbuements: ItemImbuement[];
  /** For a `skill` item: which skill its refinement item-bonus (Table 4E) applies to (e.g. 'stealth',
   *  'lore:warfare'). Absent = not yet chosen (no skill bonus applies until set). */
  skillKey?: ProficiencyKey;
}

/** One imbued property on a Monster-Parts item. */
export interface ItemImbuement {
  /** Catalog property id (fire, cold, charisma, energy-resistant, …). */
  propertyId: string;
  /** Chosen path id ('magic' | 'might' | 'technique' | 'main'); properties with one path use 'main'. */
  path: string;
  /** gp of matching parts sunk into this property (raises its level per Table 5A/5B). */
  value: number;
  /** A free-text choice this property requires (energy type, creature type, spell, tradition…). */
  choice?: string;
}

/** Refined item type — decides tables + part requirements (mirrors MpItemKind in rules/monsterParts). */
export type MpItemKind = 'weapon' | 'armor' | 'shield' | 'perception' | 'skill';

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
  /** A SECOND heritage whose mechanical benefits also apply (Late Awakener, Awakened Yaoguai
   *  Heritage). Resolved from the granting feat's own pick; absent for every other character. */
  secondHeritageId?: string;
  /** Chosen damage type for a choice-resistance heritage (Deep Fetchling / Elementheart Kobold). */
  heritageResistanceChoice?: string | null;
  backgroundId: string | null;
  classId: string | null;
  /** Chosen subclass option id (instinct, doctrine, bloodline, ...). */
  subclassId?: string | null;
  /**
   * Resolved subclass + extra-choice picks (bloodline, ikons, apparitions, implements, …).
   *
   * `id` is the option id, which for every current group is ALSO a classFeature id — that is what
   * lets `ownedFeatureIds` treat a chosen option as a feature you have, so its mechanics and its
   * situational bonuses reach the sheet. It is optional only for characters saved before it existed;
   * those still round-trip through the by-name reverse map in `buildFromCharacter`.
   */
  /** `descRefs` carries the row's cross-reference links. They were dropped when these rows were
   *  built, so every link inside a bloodline / mystery / implement / apparition description rendered
   *  as plain text — 1,199 of them across the choice options. */
  classChoices?: { group: string; name: string; description: string; level: number; id?: string; descRefs?: DescRef[] }[];
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
  /** Campaigns this character is attached to (their ids) — drives the sheet Party button + publishing. */
  campaignIds?: string[];
  /** Campaign content toggles. Mythic (War of Immortals): off → all `mythic`-trait content is hidden
   *  from the player and the mythic subsystem is inactive. Kingmaker: on → its actions/conditions show. */
  mythicEnabled?: boolean;
  kingmakerEnabled?: boolean;
  /** "Hide legacy data": mirrors the build flag onto the character so the sheet's Add pickers can filter
   *  legacy/legacy-era content the same way the builder does. */
  hideLegacy?: boolean;
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
  /** Triggered "already trained → a skill of your choice" fallbacks (FeatGrant.redundantFallback): the
   *  feat whose static skill grant was redundant + which skill. The builder offers a replacement picker
   *  per entry (stored in BuildState.featSkillChoices `<featId>:fallback:<skill>`). */
  skillFallbacks?: { featId: string; skill: ProficiencyKey }[];
  /** Resolved always-on effect-choice grants (feat/heritage/feature "choose one of N"): senses / IWR /
   *  speeds the sheet applies. deriveDefenses + deriveSpeeds include these as sources. */
  chosenEffects?: DefenseGrants;
  /** Resolved item-choice passives, keyed by item id → the chosen passive effects. derive applies them
   *  (like the item's own passiveEffects) only while that item is worn/invested. */
  resolvedItemPassives?: Record<string, ItemPassiveEffects>;
  /** Effects whose referenced content (a legacy spell/feat) isn't in the shipped data. Kept so the
   *  intent is visible, with a warning surfaced on the sheet. */
  effectWarnings?: { source: string; message: string }[];
  /** Every resolved "choose one of N" pick, so the sheet can show WHICH option the character took —
   *  including options that carry only a note (a kineticist gate junction). Keyed by the owning
   *  record so a feat/feature row can label itself. */
  effectPicks?: { recordId: string; choiceId: string; label: string; note?: string }[];
  /** Secondary class DCs from multiclass dedications (Fighter/Ranger/Rogue/Alchemist Dedication) —
   *  the borrowed class's trained DC, shown alongside the primary class DC. */
  secondaryClassDcs?: { classId: string; name: string; keyAbility: AbilityId; dc: number; rank: ProficiencyRank }[];
  /** Derived body size (ancestry size, raised by a feat/heritage sizeOverride). */
  size?: Size;
  /** Natural reach in feet (5 by default; raised by a feat/heritage — Jotun's Heart → 10). */
  reach?: number;
  /** Class-feature ids a CLASS ARCHETYPE removed, plus the features it substituted and a note per
   *  archetype. derive and the builder both honor these so the class reads as the archetype rebuilt it. */
  classArchetype?: {
    /** The class it restructures. Needed by any per-class list: under Dual Class the feature loop
     *  runs twice, and without this the archetype's substituted features are listed under BOTH. */
    classId?: string;
    suppressedFeatures: string[];
    addedFeatures: { level: number; featureId: string }[];
    notes: string[];
  };

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
  /** The slug of the single active stance (exclusive — one at a time); overlaid from play-state. Its
   *  StanceDef (ContentDatabase.stances) injects a Strike + AC/dex-cap/speed changes in derive. */
  activeStance?: string;
  /** Alchemist: infused items made today (itemId → qty on hand); overlaid from play-state. */
  alchemyPrep?: Record<string, number>;
  /** How many items Advanced Alchemy makes during daily preparations, and what set it. The panel used
   *  to hardcode 4 + Int, so Efficient Alchemy and Advanced Efficient Alchemy did nothing at all. */
  advancedAlchemy?: { max: number; source?: string };
  /** Minimum daily maximum for a class resource, set by a feat (Additional Servings → 5 versatile
   *  vials). Read through resourceMaxFor(), never resourceMax() directly, or the feat is inert. */
  resourceFloors?: Record<string, number>;
  /** The Dying value at which this character dies before Doomed is applied — 4, or 5 with Diehard.
   *  Pass to dyingDeathThreshold(doomed, base); omitted means the default 4. */
  dyingThreshold?: number;
  /** Spell ids a feat added to the pool the prepare/repertoire picker offers, beyond what the entry's
   *  tradition contains. Keyed by spellcasting entry id; `'*'` applies to every entry. */
  spellListAdditions?: Record<string, string[]>;
  /** How many magic items this character may invest — 10 by RAW, 12 with Incredible Investiture. */
  investedLimit?: number;
  /** What a full night's rest gives back: the HP multiplier on `level × Con mod` and how far a
   *  night steps Doomed/Drained down. Both 1 by RAW; Fast and Bolstered Recovery raise them. */
  restRecovery?: { hpMultiplier: number; conditionSteps: number };
  /** Answers to daily-preparation choices, keyed `${recordId}:${flag}`; overlaid from play-state. */
  dailyChoices?: Record<string, string>;
  /** The temporary item each daily-preparations slot holds today (a scroll's spell id, or an item
   *  id), keyed by slot. See `dailyTemporaryItems`. */
  dailyItems?: Record<string, string>;
  /** Uses spent against each feat's `limitedUses`, by feat id; overlaid from play-state. */
  featUses?: Record<string, number>;

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
  /** `blastTypes` is the damage type chosen per element for Elemental Blast ("choose one of your
   *  kinetic elements and a damage type listed for that element"). Absent ⇒ the element's first. */
  kineticist?: { elements: string[]; blastTypes?: Record<string, string> };

  // --- gear ---
  inventory: InventoryItem[];
  currency: Coins;
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
  /** Per-character cosmetics (portrait + accent), mirrors the theme system. `portrait` is the compressed
   *  (synced) copy; `portraitRef` keys the on-device sharp copy (installed app only; never synced). */
  appearance?: { portrait?: string; accentColor?: string; portraitRef?: string };
  /** Per-character sheet customization OVERRIDES. Only the fields the user changed for this character
   *  are present; everything absent falls back to the device-global default (see data/customization.ts,
   *  effectiveCustomization). Absent/empty = this character follows the global default entirely. */
  customization?: Customization;
}

/** Reorderable / hideable vitals-rail cards (see VitalsRail). */
export type RailCardId = 'hp' | 'saves' | 'movement' | 'defenses' | 'resources' | 'panache' | 'conditions' | 'languages';
/** Sheet spacing density — maps to a Style's spacing tokens (see data/customization densityStyleId). */
export type SheetDensity = 'comfortable' | 'compact' | 'cozy';

/**
 * The full set of character-sheet customization options. Used two ways: a device-GLOBAL default (the
 * baseline for every character) and a per-character OVERRIDE (Character.customization, a partial that
 * layers on top). Every field is optional so an override carries only what changed; the global default
 * fills the rest via effectiveCustomization (data/customization.ts).
 */
export interface Customization {
  // --- Appearance axes (mirror the device Appearance; per-character override, absent = inherit device) ---
  /** Colour palette (theme id, e.g. 'midnight'). */
  themeId?: string;
  /** Interface style (shape/spacing id, e.g. 'compact'). Supersedes the older `density`. */
  styleId?: string;
  /** Typeface id (e.g. 'system'). */
  fontId?: string;
  /** UI zoom factor (e.g. 1.1). */
  zoom?: number;
  // --- A · per-character look ---
  /** Hex accent for this sheet; absent = inherit the app's Appearance accent. */
  accentColor?: string;
  /** Portrait frame shape. */
  portraitShape?: 'circle' | 'rounded' | 'square';
  /** Show the "Level N" chip beside the name. */
  showLevelChip?: boolean;
  /** Show the ancestry · class subline under the name. */
  showSubline?: boolean;
  // --- B · rail & tabs ---
  /** Ordered rail-card ids (any omitted card falls to the end in default order). */
  railOrder?: string[];
  /** Rail-card ids hidden from the rail. */
  railHidden?: string[];
  /** Tab names hidden from the tab strip (Main is never hidden). */
  hiddenTabs?: string[];
  /** Tab the sheet opens on for this character; absent = remember the last-used tab. */
  defaultTab?: string;
  // --- C · density ---
  /** Spacing density; absent = follow the app-wide Style. */
  density?: SheetDensity;
  // --- D · content & behaviour ---
  /** Show a leading "+" on positive modifiers (default true). */
  plusOnMods?: boolean;
  /** Show the DC beside each saving throw (default false). */
  showSaveDCs?: boolean;
  /** Hide tabs that have no content for this character (default false). */
  autoHideEmpty?: boolean;
  // --- migrated device options (now per-character, with a global default) ---
  /** Replace HP Damage/Heal buttons + temp box with one quick-entry command field. */
  hpCommandEntry?: boolean;
  /** Subtract the shield's Hardness from damage entered in the rail's shield box, so you type the hit
   *  you took instead of doing the math yourself (default true). Your own HP is never touched. */
  shieldAutoHardness?: boolean;
  /** Offer one-tap resistance/weakness buttons in the HP entry pad, so you type the damage you took
   *  and tap "Resistance fire 5" instead of doing the arithmetic (default true). Only appears while
   *  entering DAMAGE, and only for a character that actually has a resistance or weakness.
   *  Immunity is deliberately absent — immune damage is 0, so there is nothing to type. */
  hpIwrButtons?: boolean;
  /**
   * How Daily preparations handles choices that are re-made each morning (Environmental Adaptability's
   * cold-or-heat, and so on):
   *   'ask'   — offer the pickers every time you rest (default);
   *   'reuse' — silently keep what you chose last time. If you have never chosen, the next rest asks
   *             once and reuses that answer from then on.
   */
  dailyPrepPrompt?: 'ask' | 'reuse';
  /** Render the Actions list as compact chips (default true). */
  compactActions?: boolean;
  /** Show an available/total slot badge on each spell rank tab, phone Spells page (default true). */
  showSlotBadges?: boolean;
  /** Colour-code consumable inventory cards (default true). */
  consumableHighlight?: boolean;
  /** Override hex for the consumable highlight; absent = the theme's recommended colour. */
  consumableColor?: string;
  /** Tint the scrollbars with the accent colour instead of neutral grey. */
  scrollbarAccent?: boolean;
}

/** Current schema version for new characters. */
export const CHARACTER_SCHEMA_VERSION = 1;
