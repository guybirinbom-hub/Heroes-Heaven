/*
 * Feats that let the player PICK a bonus feat from a filtered pool (the CHOICE half of
 * grants-another-feat; the static half is featFeatGrants.ts). e.g. General Training picks a 1st-level
 * general feat, Basic Maneuver picks a 1st/2nd-level fighter feat, Natural Ambition picks a 1st-level
 * feat of your class. The builder shows a picker under the granting feat; the pick is stored in
 * build.pickFeatChoices[grantingFeatId] and granted (with its effects) by buildCharacter.
 *
 * Auto-generated from Foundry ChoiceSet + GrantItem filters (scratch pickfeat-extract / gen-pickspec),
 * with two hand-fixes (Ancestral Paragon = your ancestry; Elemental Existence = ancestry category).
 * A couple of exotic predicate clauses (kineticist gate, Natural Ambition dragon-instinct branch) are
 * approximated: the picker is at worst slightly permissive, never blocking a legal pick.
 */
import type { BuildState } from './build';
import type { ContentDatabase, Feat, FeatCategory } from './types';

export interface FeatPickSpec {
  /** Label for the picker, e.g. "Choose a class feat". */
  prompt: string;
  /** Restrict to this feat category (general also accepts skill feats). */
  category?: FeatCategory;
  /** Highest feat level offered; 'self' = the character's level; 'half' = half it, rounded down —
   *  the Advanced <archetype> feats read "your <class> level is equal to half your character level",
   *  and a feat's own level is a prerequisite, so that clause IS the cap. */
  maxLevel: number | 'self' | 'half';
  /** Feat must have ALL of these traits. */
  traits?: string[];
  /** Feat must have the character's own class / ancestry trait. */
  dynamicTrait?: 'class' | 'ancestry';
  /** Feat ids that may NOT be picked. */
  exclude?: string[];
  /** Feats with any of these traits may NOT be picked. */
  excludeTraits?: string[];
  /** The INVERSE of dynamicTrait: exclude feats carrying the character's own class/ancestry trait
   *  (Ancient Elf: "choose a class OTHER THAN your own"). */
  excludeDynamicTrait?: 'class' | 'ancestry';
  /** Explicit option list (overrides category/trait/level filters). Used when the source encodes an exact
   *  menu — e.g. Pitborn's fiendish manifestation offers exactly 6 Athletics skill feats. */
  ids?: string[];
}

export const FEAT_PICK_GRANTS: Record<string, FeatPickSpec> = {
  'advanced-general-training': { prompt: "Choose a general feat", category: 'general', maxLevel: 7 },
  /*
   * Hellknight Order Training: "you gain an order feat". Those 14 order feats are the ONLY records in
   * the data carrying category 'bonus', and the bonus slot belongs to the fighter's Combat
   * Flexibility — it demands the fighter trait, which no Hellknight feat has. A Hellknight was told
   * they gained an order feat and offered none of the fourteen that exist.
   *
   * Listed by id rather than by a category filter for exactly that reason: 'bonus' is not a real feat
   * category here, it is where these fourteen happened to land, and a category rule would collide
   * with the fighter slot again the moment anything else landed there.
   */
  'order-training': {
    prompt: 'Choose a Hellknight order feat',
    maxLevel: 'self',
    ids: [
      'shackles-of-law', 'sturdy-bindings', 'devil-allies', 'locate-lawbreakers', 'blessing-of-the-five',
      'dedication-to-the-five', 'reveal-beasts', 'trailblazing-stride', 'righteous-resistance',
      'spiritual-disruption', 'disillusionment', 'silence-heresy', 'fear-no-law-fear-no-one', 'seek-injustice',
    ],
  },
  /* ---- pick-a-feat grants found by the coverage sweep ---------------------------------------
   * Each offers exactly what its own text offers, and no more. Where the text names the options,
   * they are listed by id rather than approximated with a category+level filter — every id below
   * was checked against core.json.
   */
  // HERITAGE-keyed (kashrishi): 'a 1st-level kashrishi ancestry feat'. 8 qualify.
  nascent: { prompt: 'Choose a 1st-level kashrishi ancestry feat', category: 'ancestry', maxLevel: 1, traits: ['kashrishi'] },
  // 'one 1st-level Performance skill feat' — the three that exist, by id, since no trait marks a
  // feat as belonging to a skill (the tie is a 'trained in Performance' prerequisite).
  'natural-performer': { prompt: 'Choose a Performance skill feat', maxLevel: 1, ids: ['fascinating-performance', 'impressive-performance', 'virtuosic-performer'] },
  // 'any one general feat that you meet the prerequisites for'
  'officers-education': { prompt: 'Choose a general feat', category: 'general', maxLevel: 'self' },
  // HERITAGE-keyed: 'your choice of the Courtly Graces or Streetwise feat'
  'old-blood-vishkanya': { prompt: 'Choose Courtly Graces or Streetwise', maxLevel: 1, ids: ['courtly-graces', 'streetwise'] },
  // 'either the Combat Climber or Underwater Marauder skill feat, even if you do not meet its prerequisites'
  'pirate-combat-training': { prompt: 'Choose Combat Climber or Underwater Marauder', maxLevel: 1, ids: ['combat-climber', 'underwater-marauder'] },
  // 'Choose one nephilim lineage feat that you do not already possess'
  'scion-of-many-planes': { prompt: 'Choose a nephilim lineage feat', category: 'ancestry', maxLevel: 'self', traits: ['lineage', 'nephilim'] },
  // 'one evolution feat from the following list' — the four named.
  'signature-synergy': { prompt: 'Choose an evolution feat', maxLevel: 'self', ids: ['airborne-form', 'burrowing-form', 'ever-vigilant-senses', 'hulking-size'] },
  // 'a skill feat associated with one of the skills you chose'. The app cannot know which skills were
  // chosen, so it offers the skill-feat pick and records the answer rather than guessing a subset.
  'skill-mastery': { prompt: 'Choose a skill feat', category: 'skill', maxLevel: 'self' },
  'skill-mastery-rogue': { prompt: 'Choose a skill feat', category: 'skill', maxLevel: 'self' },
  // HERITAGE-keyed (tanuki): 'your choice of Everyday Form or Teakettle Form as a bonus ancestry feat'
  'steadfast-tanuki': { prompt: 'Choose Everyday Form or Teakettle Form', maxLevel: 1, ids: ['everyday-form', 'teakettle-form'] },
  "captain-dedication": {"prompt":"Choose Group Impression or Group Coercion","maxLevel":1,"ids":["group-impression","group-coercion"]},
  "order-explorer": {"prompt":"Choose a 1st-level feat of the order you explored","maxLevel":1,"ids":["animal-companion","fire-lung","leshy-familiar","shore-step","steadying-stone","storm-born","untamed-form"]},
  'ancestral-paragon': { prompt: "Choose a ancestry feat", category: 'ancestry', maxLevel: 1, dynamicTrait: 'ancestry', excludeTraits: ['lineage'] },
  // HERITAGE-keyed, not a feat: Ancient Elf grants a multiclass dedication at 1st level "even though
  // you don't meet its level prerequisite", so maxLevel 2 offers the normally-2nd-level dedications.
  // Resolved off build.heritageId in buildCharacter; the picker lives on the heritage step.
  'ancient-elf': { prompt: 'Choose a class other than your own', category: 'class', maxLevel: 2, traits: ['dedication', 'multiclass'], excludeDynamicTrait: 'class' },
  'basic-arcana': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['wizard'] },
  'basic-blood-potency': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['sorcerer'] },
  'basic-breakthrough': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['inventor'] },
  'basic-concoction': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['alchemist'] },
  'basic-deduction': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['investigator'] },
  'basic-defender': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['guardian'] },
  'basic-devotion': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['champion'] },
  'basic-dogma': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['cleric'] },
  'basic-field-training': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['commander'] },
  'basic-flair': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['swashbuckler'] },
  'basic-fury': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['barbarian'] },
  'basic-glory': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['exemplar'] },
  'basic-hunters-trick': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['ranger'] },
  'basic-kata': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['monk'] },
  'basic-maneuver': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['fighter'] },
  'basic-martial-magic': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['magus'] },
  'basic-muses-whispers': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['bard'] },
  'basic-mysteries': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['oracle'] },
  'basic-shooting': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['gunslinger'] },
  'basic-synergy': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['summoner'], excludeTraits: ['tandem'] },
  'basic-thaumaturgy': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['thaumaturge'] },
  'basic-thoughtform': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['psychic'] },
  'basic-trickery': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['rogue'] },
  'basic-wilding': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['druid'] },
  'basic-witchcraft': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['witch'] },

  // ---- Advanced <archetype>: the sibling of every basic-* row above -------------------------
  // "You gain one <class> feat. For the purpose of meeting its prerequisites, your <class> level is
  // equal to half your character level. Special: You can select this feat more than once."
  // All 25 basic-* rows were registered and NONE of the 25 advanced-* ones were, so the second half
  // of every multiclass archetype asked no question and granted no feat. Each row below is the
  // basic row with the level cap changed; the class trait is verified to match the sibling.
  /* ---- BACKGROUND- and CLASS-FEATURE-keyed picks -----------------------------------------------
   * This lane was consulted for taken feat ids and `build.heritageId` only, so a background offering
   * "one Athletics skill feat of your choice" and a subclass offering "a bonus 1st-level barbarian
   * feat" each asked a question nothing read. buildCharacter now resolves both.
   */
  // BACKGROUND: "You're trained in Athletics and gain one Athletics skill feat of your choice."
  // Listed by id, like natural-performer: no trait marks a feat as belonging to a skill — the tie is
  // a 'trained in Athletics' prerequisite.
  'kaiju-stalker': {
    prompt: 'Choose an Athletics skill feat',
    category: 'skill',
    maxLevel: 'self',
    ids: ['combat-climber', 'hefty-hauler', 'quick-jump', 'titan-wrestler', 'underwater-marauder', 'armor-assist', 'rope-runner', 'canopy-predator', 'mounting-leap', 'muscle-mimicry'],
  },
  // BACKGROUND: "one skill feat of your choice between the Specialty Crafting or Multilingual skill feat"
  'professional-letter-writer': { prompt: 'Choose Specialty Crafting or Multilingual', maxLevel: 1, ids: ['specialty-crafting', 'multilingual'] },
  // BACKGROUND: "your choice of the Dubious Knowledge or Quick Identification skill feat"
  'sponsored-by-a-stranger': { prompt: 'Choose Dubious Knowledge or Quick Identification', maxLevel: 1, ids: ['dubious-knowledge', 'quick-identification'] },
  // CLASS FEATURE (barbarian Fury instinct): "You gain a bonus 1st-level barbarian feat."
  'fury-instinct': { prompt: 'Choose a 1st-level barbarian feat', category: 'class', maxLevel: 1, traits: ['barbarian'] },
  // CLASS FEATURE (summoner): "You gain an evolution feat for your eidolon at 1st level."
  'evolution-feat': { prompt: 'Choose an evolution feat', maxLevel: 'self', traits: ['evolution'] },
  // The three siblings that were missing. Same row as the rest, from each feat's own text.
  // (advanced-kata is NOT among them — it already ships above; the note calling it blocked on a
  // missing `maxLevel: 'half'` predates that mode existing.)
  // "You gain one kineticist feat… your kineticist level is equal to half your level."
  'advanced-element-control': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['kineticist'] },
  // "You gain one animist feat… You can't use this feat to gain animist feats with the wandering trait."
  'animists-power': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['animist'], excludeTraits: ['wandering'] },
  // "Gain a composite impulse feat that includes your kinetic element." Its extra clause — the feat's
  // level must be LOWER than the level you took this at — is a per-SLOT cap the spec cannot express,
  // so the picker stays slightly permissive, which is this file's stated convention.
  'elemental-overlap': { prompt: "Choose a composite impulse feat", category: 'class', maxLevel: 'self', traits: ['composite', 'impulse'] },
  'advanced-arcana': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['wizard'] },
  'advanced-blood-potency': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['sorcerer'] },
  'advanced-breakthrough': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['inventor'] },
  'advanced-concoction': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['alchemist'] },
  'advanced-deduction': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['investigator'] },
  'advanced-defender': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['guardian'] },
  'advanced-devotion': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['champion'] },
  'advanced-dogma': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['cleric'] },
  'advanced-field-training': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['commander'] },
  'advanced-flair': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['swashbuckler'] },
  'advanced-fury': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['barbarian'] },
  'advanced-glory': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['exemplar'] },
  'advanced-hunters-trick': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['ranger'] },
  'advanced-kata': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['monk'] },
  'advanced-maneuver': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['fighter'] },
  'advanced-martial-magic': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['magus'] },
  'advanced-muses-whispers': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['bard'] },
  'advanced-mysteries': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['oracle'] },
  'advanced-shooting': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['gunslinger'] },
  'advanced-synergy': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['summoner'], excludeTraits: ['tandem'] },
  'advanced-thaumaturgy': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['thaumaturge'] },
  'advanced-thoughtform': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['psychic'] },
  'advanced-trickery': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['rogue'] },
  'advanced-wilding': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['druid'] },
  'advanced-witchcraft': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['witch'] },
  'elemental-existence': { prompt: "Choose a feat", category: 'ancestry', maxLevel: 1, traits: ['oread'] },
  'general-training': { prompt: "Choose a general feat", category: 'general', maxLevel: 1 },
  'multifarious-muse': { prompt: "Choose a class feat", category: 'class', maxLevel: 1, traits: ['bard'] },
  'multitalented': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['dedication', 'multiclass'] },
  'natural-ambition': { prompt: "Choose a class feat", category: 'class', maxLevel: 1, dynamicTrait: 'class', exclude: ['animal-companion', 'animal-companion-druid', 'bardic-lore', 'fire-lung', 'lingering-composition', 'leshy-familiar', 'martial-performance', 'shore-step', 'steadying-stone', 'storm-born', 'versatile-performance', 'untamed-form'] },
  // Pitborn (nephilim lineage): "one common 1st-level skill feat with a prerequisite of trained in
  // Athletics" — the exact 6 feats the source lists as fiendish manifestations.
  'pitborn': { prompt: "Choose a skill feat (fiendish manifestation)", maxLevel: 1, ids: ['armor-assist', 'combat-climber', 'hefty-hauler', 'quick-jump', 'titan-wrestler', 'underwater-marauder'] },
  'social-purview': { prompt: "Choose a class feat", category: 'class', maxLevel: 'self', traits: ['dedication'] },
  'spiritual-awakening': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['animist'] },
  'through-the-gate': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['kineticist'] },
  'arodens-innovation': {prompt:'Choose a general feat of 3rd level or lower (daily preparations)',category:'general',maxLevel:3},
};

/** The feats a player may pick for a given grant, honoring category/level/trait/exclusions. */
export function pickableFeats(spec: FeatPickSpec, build: BuildState, content: ContentDatabase): Feat[] {
  // Explicit menu (Pitborn): just the listed feats that exist, sorted like the rest.
  if (spec.ids) {
    return spec.ids
      .map((id) => content.feats[id])
      .filter((f): f is Feat => !!f)
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  }
  const maxL =
    spec.maxLevel === 'self' ? build.level : spec.maxLevel === 'half' ? Math.floor(build.level / 2) : spec.maxLevel;
  const clsTrait = build.classId;
  const ancTrait = build.ancestryId;
  return Object.values(content.feats)
    .filter((f) => {
      if (f.level > maxL) return false;
      if (spec.category && f.category !== spec.category && !(spec.category === 'general' && f.category === 'skill')) return false;
      const tr = new Set(f.traits);
      if (spec.traits && !spec.traits.every((t) => tr.has(t))) return false;
      if (spec.dynamicTrait === 'class' && clsTrait && !tr.has(clsTrait)) return false;
      if (spec.dynamicTrait === 'ancestry' && ancTrait && !tr.has(ancTrait)) return false;
      if (spec.excludeTraits && spec.excludeTraits.some((t) => tr.has(t))) return false;
      // A multiclass dedication carries no class TRAIT — the class it belongs to is `archetype`.
      if (spec.excludeDynamicTrait === 'class' && clsTrait && (tr.has(clsTrait) || f.archetype === clsTrait)) return false;
      if (spec.excludeDynamicTrait === 'ancestry' && ancTrait && tr.has(ancTrait)) return false;
      if (spec.exclude && spec.exclude.includes(f.id)) return false;
      return true;
    })
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}
