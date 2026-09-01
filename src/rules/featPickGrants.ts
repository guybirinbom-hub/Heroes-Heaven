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
import { elementTraitsOf, impulseAllowedFor } from './kineticElements';
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
  /**
   * The pick is offered ONLY when the character already has this feat.
   *
   * *"You gain the Quick Repair skill feat. IF YOU ALREADY HAVE THAT FEAT, you gain a different
   * 1st-level skill feat you qualify for instead."* (Engine Bay.) The static half is a
   * `FEAT_FEAT_GRANTS` entry, and the granted-feat walk dedupes against feats already held — so a
   * character who already had Quick Repair got the grant silently dropped and nothing in its place,
   * which is the whole of the printed "instead".
   *
   * The two halves are mutually exclusive by construction: the grant is dropped precisely when this
   * condition is true, so exactly one of them ever delivers.
   */
  onlyIfHasFeat?: string;
  /**
   * How many feats this record grants from the pool. Absent ⇒ one.
   *
   * *"Choose UP TO TWO 4th-level spell trickster archetype feats… You gain those feats, ignoring their
   * level prerequisite."* (Spell Trickster Dedication.) Their side is two independent selects over one
   * filtered pool. A single answer could not say it, so the record shipped its picker explicitly marked
   * *"Recorded only — the two feats are not added to your sheet, so add their benefits yourself"*.
   *
   * Answers past the first live under `<key>#<i>` on the same `pickFeatChoices` map — index 0 keeps the
   * bare key, so a character saved before this keeps their pick. Two picks of the same feat are already
   * refused by the `maxTakes` count in buildCharacter, which is the rule that actually governs it.
   */
  picks?: number;
}

export const FEAT_PICK_GRANTS: Record<string, FeatPickSpec> = {
  'advanced-general-training': { prompt: "Choose a general feat", category: 'general', maxLevel: 7 },
  /*
   * *"You gain the Quick Repair skill feat. IF YOU ALREADY HAVE THAT FEAT, you gain a different
   * 1st-level skill feat you qualify for instead."*
   *
   * Only the first branch shipped: `FEAT_FEAT_GRANTS['engine-bay'] = ['quick-repair']` hands the feat
   * over, and the granted-feat walk dedupes against feats already held — so a character who came in
   * with Quick Repair had the grant silently dropped and received NOTHING in its place, which is the
   * entire content of the printed "instead". Their side is one conditional over the same two branches.
   *
   * `exclude` is belt-and-braces: the gate already means the character has Quick Repair, so it could
   * never be offered — but a picker that can list a feat you already hold is the shape this project
   * keeps finding, and stating it costs nothing.
   */
  'engine-bay': { prompt: 'Choose a 1st-level skill feat', category: 'skill', maxLevel: 1, onlyIfHasFeat: 'quick-repair', exclude: ['quick-repair'] },
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
    'spiritual-disruption', 'disillusionment', 'silence-heresy', 'fear-no-law-fear-no-one', 'seek-injustice']

  },
  /* ---- pick-a-feat grants found by the coverage sweep ---------------------------------------
   * Each offers exactly what its own text offers, and no more. Where the text names the options,
   * they are listed by id rather than approximated with a category+level filter — every id below
   * was checked against core.json.
   */
  // HERITAGE-keyed (kashrishi): 'a 1st-level kashrishi ancestry feat'. 8 qualify.
  nascent: { prompt: 'Choose a 1st-level kashrishi ancestry feat', category: 'ancestry', maxLevel: 1, traits: ['kashrishi'] },
  /* Runtsage grants TWO things — *"You gain the Adopted Ancestry general feat and must select goblin…
   * You ALSO gain one 1st-level goblin ancestry feat."* Only the first was modelled (featFeatGrants),
   * so half the feat reached the player. Same shape as `nascent` above, one ancestry over. */
  runtsage: { prompt: 'Choose a 1st-level goblin ancestry feat', category: 'ancestry', maxLevel: 1, traits: ['goblin'] },
  /* Cultural Adaptability is Runtsage with the ancestry left OPEN: *"You gain the Adopted Ancestry
   * general feat, and you also gain one 1st-level ancestry feat from the ancestry you chose for the
   * Adopted Ancestry feat."* featFeatGrants.ts:358 already hands over Adopted Ancestry and the second
   * half had no carrier at all, so half the feat reached the player. No trait filter, deliberately:
   * Wanderer's Guide's own select is `{abilityBlockType: feat, level max 1, isFromAncestry: true}` —
   * every 1st-level ancestry feat — and narrowing the menu to the ADOPTED ancestry would need a
   * `dynamicTrait: 'adopted'` mode that does not exist (`adoptedAncestryIds` in featSlots.ts:46 is the
   * resolver it would read). */
  'cultural-adaptability': { prompt: 'Choose a 1st-level ancestry feat (from your adopted ancestry)', category: 'ancestry', maxLevel: 1 },
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
  /*
   * *"Choose UP TO TWO 4th-level spell trickster archetype feats for which you meet the spell-casting
   * prerequisite. You gain those feats, IGNORING THEIR LEVEL PREREQUISITE."* (Grand Bazaar pg. 122.)
   *
   * The seven ids are every 4th-level feat of the archetype, listed rather than filtered because
   * `ids` is the one path that skips the level cap — which is precisely the printed waiver, and the
   * reason a 2nd-level character may hold them.
   *
   * The spell-casting half of the prerequisite ("able to cast mage hand", "…shield", …) is NOT
   * filtered: which spells a character can cast comes from repertoires, granted innates, items and
   * scrolls, and a picker that guessed would hide a legal choice. The record's own note already said
   * so, and menu filtering is the owner's one delegated call.
   *
   * ⚠ The two feats must NOT count toward the archetype's own gate — *"the two feats you gain from
   * taking the dedication don't count toward this total"*. They can't: `dedicationBlock` tallies from
   * `featPicks` (the feat-SLOT map) and a pick-grant never writes there. Guarded by a test, because
   * that is a property of a call site two files away, not of this entry.
   */
  'spell-trickster-dedication': {
    prompt: 'Choose a 4th-level spell trickster feat',
    maxLevel: 4,
    picks: 2,
    ids: ['agile-hand', 'barrier-shield', 'forceful-push', 'shining-arms', 'summon-ensemble', 'tracing-sigil', 'wild-lights'],
  },
  "captain-dedication": { "prompt": "Choose Group Impression or Group Coercion", "maxLevel": 1, "ids": ["group-impression", "group-coercion"] },
  "order-explorer": { "prompt": "Choose a 1st-level feat of the order you explored", "maxLevel": 1, "ids": ["animal-companion", "fire-lung", "leshy-familiar", "shore-step", "steadying-stone", "storm-born", "untamed-form"] },
  'ancestral-paragon': { prompt: "Choose a ancestry feat", category: 'ancestry', maxLevel: 1, dynamicTrait: 'ancestry', excludeTraits: ['lineage'] },
  // HERITAGE-keyed, not a feat: Ancient Elf grants a multiclass dedication at 1st level "even though
  // you don't meet its level prerequisite", so maxLevel 2 offers the normally-2nd-level dedications.
  // Resolved off build.heritageId in buildCharacter; the picker lives on the heritage step.
  'ancient-elf': { prompt: 'Choose a class other than your own', category: 'class', maxLevel: 2, traits: ['dedication', 'multiclass'], excludeDynamicTrait: 'class' },
  'basic-arcana': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['wizard'] },
  'basic-blood-potency': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['sorcerer'] },
  'basic-breakthrough': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['inventor'] },
  'basic-concoction': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['alchemist'] },
  'basic-death-dealing': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['necromancer'] },
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
  'basic-rune-magic': { prompt: "Choose a class feat", category: 'class', maxLevel: 2, traits: ['runesmith'] },
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
  // a 'trained in Athletics' prerequisite. Level-1 feats only, like the two sibling BACKGROUND rows
  // below: a background is taken at 1st, and WG filters the same select to level ≤ 1. (batch 23 —
  // this had `maxLevel: 'self'` plus four higher-level ids, letting a lv-7 pick Canopy Predator.)
  'kaiju-stalker': {
    prompt: 'Choose an Athletics skill feat',
    category: 'skill',
    maxLevel: 1,
    ids: ['combat-climber', 'hefty-hauler', 'quick-jump', 'titan-wrestler', 'underwater-marauder', 'armor-assist']
  },
  // BACKGROUND: "one skill feat of your choice between the Specialty Crafting or Multilingual skill feat"
  'professional-letter-writer': { prompt: 'Choose Specialty Crafting or Multilingual', maxLevel: 1, ids: ['specialty-crafting', 'multilingual'] },
  // (sponsored-by-a-stranger's row is gone deliberately — the record's own `choice` is the single
  //  carrier, exactly like hermean-heritor; a row here mounted a SECOND picker for the same feat.)
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
  /* The advanced halves of the two archetypes whose basic rows were added in parity batch 12. Both
   * feats ship in core.feats; without a row here the picker offered nothing and the feat was inert —
   * the asymmetry the `basic-*`/`advanced-*` guard in display-and-reach.test.ts exists to catch. */
  'advanced-death-dealing': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['necromancer'] },
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
  'advanced-rune-magic': { prompt: "Choose a class feat", category: 'class', maxLevel: 'half', traits: ['runesmith'] },
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
  'arodens-innovation': { prompt: 'Choose a general feat of 3rd level or lower (daily preparations)', category: 'general', maxLevel: 3 }
};

/**
 * The `pickFeatChoices` keys a grant occupies — one per pick.
 *
 * Index 0 is the BARE key and the rest are `<key>#<i>`, so a record that gains a second pick does not
 * move the answer every saved character already stored. Exported so the engine and every builder site
 * derive the keys from one function: a second copy of the convention is the shape this project keeps
 * finding, where the picker writes one key and the engine reads another and the grant is silently inert.
 */
export const pickKeysFor = (key: string, picks?: number): string[] =>
  Array.from({ length: Math.max(1, picks ?? 1) }, (_, i) => (i === 0 ? key : `${key}#${i}`));

/** "Choose a feat" → "Choose a feat (2 of 2)" when a grant asks more than once. */
export const pickPrompt = (prompt: string, index: number, picks?: number): string =>
  (picks ?? 1) > 1 ? `${prompt} (${index + 1} of ${picks})` : prompt;

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
  // An impulse you have no gate for is not a legal pick (Q9 — the builder shows only what the player
  // may legally pick). This file's header called the kineticist gate "approximated… at worst slightly
  // permissive"; for the two specs that actually offer impulses — Advanced Element Control and
  // Elemental Overlap — "slightly permissive" meant every element, which made Kineticist Dedication's
  // element answer decide nothing at all. Same rule as the feat-slot picker, from the same function.
  const elements = elementTraitsOf(build, build.level);
  return Object.values(content.feats)
    .filter((f) => {
      if (f.level > maxL) return false;
      if (f.traits.includes('impulse') && !impulseAllowedFor(f.traits, elements)) return false;
      /* …and a spec asking for a CLASS feat accepts an archetype-category one, for the same reason the
       * class feat SLOT does (see featSlots.ts): RAW an archetype feat is bought with a class feat. */
      const classTakesArchetype = spec.category === 'class' && f.category === 'archetype' && f.traits.includes('archetype');
      if (spec.category && f.category !== spec.category && !classTakesArchetype && !(spec.category === 'general' && f.category === 'skill')) return false;
      const tr = new Set(f.traits);
      if (spec.traits && !spec.traits.every((t) => tr.has(t))) return false;
      if (spec.dynamicTrait === 'class' && clsTrait && !tr.has(clsTrait)) return false;
      if (spec.dynamicTrait === 'ancestry' && ancTrait) {
        // A grant of "a 1st-level ancestry feat" (Ancestral Paragon) offers whatever an ancestry
        // SLOT would offer, so this reads the same widened set as eligibleFeatsForSlot
        // (featSlots.ts): a versatile heritage's own feats, the extra ancestry lists a heritage
        // opens (Aiuvarin: elf), and universal-ancestry. Filtering on the bare ancestry trait
        // offered Bellphor halfling feats only — not even the aiuvarin feats his heritage grants.
        const her = build.heritageId ? content.heritages[build.heritageId] : undefined;
        const widened = [
          ancTrait,
          ...(her?.versatile ? [her.id, ...(her.traits ?? [])] : []),
          ...(her?.extraAncestryFeatTraits ?? []),
        ];
        if (!widened.some((t) => tr.has(t)) && !tr.has('universal-ancestry')) return false;
      }
      if (spec.excludeTraits && spec.excludeTraits.some((t) => tr.has(t))) return false;
      // A multiclass dedication carries no class TRAIT — the class it belongs to is `archetype`.
      if (spec.excludeDynamicTrait === 'class' && clsTrait && (tr.has(clsTrait) || f.archetype === clsTrait)) return false;
      if (spec.excludeDynamicTrait === 'ancestry' && ancTrait && tr.has(ancTrait)) return false;
      if (spec.exclude && spec.exclude.includes(f.id)) return false;
      return true;
    })
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}
