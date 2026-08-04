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
  /** Highest feat level offered; 'self' = the character's level. */
  maxLevel: number | 'self';
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
  const maxL = spec.maxLevel === 'self' ? build.level : spec.maxLevel;
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
