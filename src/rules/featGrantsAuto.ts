/*
 * Feat-granted SKILL proficiencies — auto-generated from Foundry rule elements (Remaster pf2e packs).
 *
 * Extends FEAT_GRANTS beyond the 7 hand-authored cases. Each entry is a feat that unconditionally
 * trains (or raises) a specific skill, derived from the feat's ActiveEffectLike rule elements on
 * `system.skills.<skill>.rank` (value 1=trained, 2=expert, 3=master, 4=legendary), or a skill-training
 * CHOICE (a ChoiceSet feeding `system.skills.{item|…}.rank`) surfaced as a picker in the builder.
 *
 * Scope: ONLY unconditional skill grants. Predicated (situational) rules are excluded; weapon grants
 * (MartialProficiency — a bespoke proficiency that doesn't map cleanly to HH weapon categories) and
 * formula-valued armor cascades (Sentinel-style) are NOT auto-mapped and stay hand-authored in
 * FEAT_GRANTS. Grants RAISE only (like all FEAT_GRANTS), so a redundant train is a no-op. Restricted
 * skill choices are surfaced as `options: 'any'` (the player picks; the exact list restriction is not modeled).
 *
 * Regenerate: scripts/scratch prof-extract.mjs. To override a specific feat, add it to FEAT_GRANTS —
 * hand-authored entries win the merge.
 */
import type { FeatGrant } from './featGrants';

export const FEAT_SKILL_GRANTS: Record<string, FeatGrant> = {
  /* *"At 7TH LEVEL, you become a MASTER in Acrobatics, and at 15th level, you become legendary."* The
   * 7th-level rung was simply absent, leaving the holder at expert for levels 7–14. `rankUpgrade`
   * already takes an array (featGrants.ts:36 sorts them by level), so both rungs ride here. */
  'acrobat-dedication': { skills: { acrobatics: 'expert' }, rankUpgrade: [{ level: 7, rank: 'master' }, { level: 15, rank: 'legendary' }] },
  // "Choose a Lore skill subcategory. You become trained in it. At 3rd, 7th, and 15th levels, you
  // gain an additional skill increase you can apply ONLY to the chosen Lore subcategory."
  // (AoN feat-5114.) The increase is spendable nowhere else, so the ladder IS the rank — and 3/7/15
  // are exactly the levels at which a skill increase may reach expert/master/legendary. Read
  // through `at()` in build.ts's Lore loop and announced on the builder's level card by
  // featUpgradesAtLevel. Measured before: a level-20 holder read "Warfare Lore, trained".
  'additional-lore': { loreChoices: 1, rankUpgrade: [{ level: 3, rank: 'expert' }, { level: 7, rank: 'master' }, { level: 15, rank: 'legendary' }] },
  'adroit-manipulation': { skills: { thievery: 'trained' }, redundantFallback: true },
  // ⚠ "You become trained in ALCHEMICAL BOMBS, the alchemist class DC, and Crafting." The class DC
  // (`classDcGrant`) and Crafting both shipped; the BOMB proficiency did not, so an archetype
  // alchemist threw their own bombs untrained.
  'alchemist-dedication': { skills: { crafting: 'trained' }, redundantFallback: true, weaponFamiliarity: { weapons: [], groups: ['bomb'], rank: 'trained' } },
  'aldori-duelist-dedication': { skills: { 'lore:dueling': 'trained' }, skillChoices: [{ options: ['acrobatics', 'athletics'], rank: 'trained' }], redundantFallback: true },
  /*
   * *"You become an expert in Deception and trained in YOUR CHOICE of Underworld Lore OR Legal Lore;
   * if you were already trained, you become an expert instead."* Two defects in one entry: the choice
   * was hard-coded to Underworld (Legal Lore was unreachable), and the "already trained → expert"
   * clause was dropped. `conditionalRank` on the slot carries the upgrade; `lion-blade-dedication`
   * uses the same shape.
   */
  'alkenstar-agent-dedication': {
    skills: { deception: 'expert' },
    skillChoices: [{ options: ['lore:underworld', 'lore:legal'], rank: 'trained', conditionalRank: { base: 'trained', upgraded: 'expert' } }],
    redundantFallback: true
  },
  'alter-ego-dedication': { skills: { deception: 'expert' } },
  'anadi-lore': { skills: { crafting: 'trained', survival: 'trained', 'lore:anadi': 'trained' }, redundantFallback: true },
  'android-lore': { skills: { crafting: 'trained', thievery: 'trained', 'lore:android': 'trained' }, redundantFallback: true },
  'angelkin': { skills: { society: 'trained' }, redundantFallback: true },
  'animal-actor': { conditionalSkills: { nature: { base: 'trained', upgraded: 'expert' } }, loreChoices: 1 },
  'aon-grippli-lore': { skills: { nature: 'trained', stealth: 'trained', 'lore:grippli': 'trained' }, redundantFallback: true },
  /* ---- ancestry weapon EXPERTISE ------------------------------------------------------------
   * "Whenever you gain a class feature that grants you expert or greater proficiency in a given
   * weapon or weapons, you also gain that proficiency in <list>."
   *
   * These MIRROR the character's own best weapon-category rank rather than granting a fixed one, so
   * a 1st-level holder gains nothing extra and a fighter's weapon mastery carries through by itself.
   * A flat `rank: 'expert'` would hand expert proficiency to a character who has not earned it, so
   * `mirrorBestCategory` is the only correct shape here. Every weapon id checked against core.json.
   */
  'gnoll-weapon-expertise': { weaponFamiliarity: { weapons: ['flail', 'khopesh', 'mambele', 'spear', 'war-flail'], mirrorBestCategory: true } },
  'gnome-weapon-expertise': { weaponFamiliarity: { weapons: ['glaive', 'kukri'], mirrorBestCategory: true } },
  'goblin-weapon-expertise': { weaponFamiliarity: { weapons: ['dogslicer', 'horsechopper'], mirrorBestCategory: true } },
  'halfling-weapon-expertise': { weaponFamiliarity: { weapons: ['sling', 'halfling-sling-staff', 'shortsword'], mirrorBestCategory: true } },
  'orc-weapon-expertise': { weaponFamiliarity: { weapons: ['falchion', 'greataxe'], mirrorBestCategory: true } },
  'vanths-weapon-expertise': { weaponFamiliarity: { weapons: ['bo-staff', 'longbow', 'composite-longbow', 'scythe', 'staff'], mirrorBestCategory: true } },
  'lions-might': { weaponFamiliarity: { weapons: ['lion-scythe', 'sun-sling'], mirrorBestCategory: true } },
  'azarketi-weapon-expertise': { weaponFamiliarity: { weapons: ['crossbow', 'hand-crossbow', 'longspear', 'spear', 'trident', 'boarding-axe', 'gill-hook'], mirrorBestCategory: true } },
  'dwarven-weapon-expertise': { weaponFamiliarity: { weapons: ['battle-axe', 'pick', 'warhammer', 'clan-dagger', 'clan-pistol', 'dwarven-scattergun', 'dwarven-dorn-dergar', 'dwarven-war-axe', 'dwarven-waraxe', 'long-hammer', 'wrecker', 'wrecker-melee', 'wrecker-ranged'], mirrorBestCategory: true } },
  'elven-weapon-expertise': { weaponFamiliarity: { weapons: ['longbow', 'composite-longbow', 'longsword', 'rapier', 'shortbow', 'composite-shortbow', 'elven-curve-blade', 'elven-branched-spear', 'dawnsilver-tree', 'three-peaked-tree', 'three-peaked-tree-melee', 'three-peaked-tree-ranged'], mirrorBestCategory: true } },
  'arcana-of-iron': { weapon: { advanced: 'trained' } },
  'arcane-dragonblood': { skills: { arcana: 'trained' }, redundantFallback: true },
  'arcane-evolution': { skillChoices: [{ options: 'any', rank: 'trained' }] },
  'archaeologist-dedication': { skills: { society: 'expert', thievery: 'expert' } },
  'armigers-protection': { armor: { light: 'trained', medium: 'trained' }, armorMirrorBest: ['light', 'medium'] },
  'artisanal-crafter': { skills: { crafting: 'trained' }, redundantFallback: true },
  'athamaru-lore': { skills: { athletics: 'trained', nature: 'trained' }, redundantFallback: true },
  'automaton-lore': { skills: { arcana: 'trained', crafting: 'trained' }, redundantFallback: true },
  'avowed-insight': { loreChoices: 1 },
  'awakened-animal-lore': { skills: { arcana: 'trained', nature: 'trained' }, redundantFallback: true },
  'axiomatic-lore': { skills: { diplomacy: 'trained', society: 'trained', 'lore:axis': 'trained' }, redundantFallback: true },
  'azarketi-lore': { skills: { athletics: 'trained', nature: 'trained', 'lore:azarketi': 'trained' }, redundantFallback: true },
  // "…access to all uncommon azarketi weapons." The two azarketi-trait weapons we ship (boarding-axe,
  // gill-hook) are listed AND the trait is named, so a data refresh that adds a third is covered without
  // this line changing. Their side names only the trait; the enumeration is kept for the explicit list.
  /*
   * TWO clauses, not one. *"You are trained with Crossbows, Hand Crossbows, Longspears, Spears and
   * Tridents. In addition… martial azarketi weapons are simple weapons and advanced azarketi weapons
   * are martial weapons."* The named five are a flat trained rank; the DEMOTION applies to the
   * trait-matched ones. Merged into a single clause with a flat `rank`, `treatAsLowerCategory` was
   * absent entirely, so every azarketi weapon sat at trained for all 20 levels instead of tracking the
   * character's simple/martial proficiency. Same two-clause shape as `vishkanya-weapon-familiarity`.
   */
  'azarketi-weapon-familiarity': {
    weaponFamiliarity: [
    { weapons: ['crossbow', 'hand-crossbow', 'longspear', 'spear', 'trident'], rank: 'trained' },
    { weapons: [], traits: ['azarketi'], treatAsLowerCategory: true }]

  },
  'barbarian-dedication': { skills: { athletics: 'trained' }, redundantFallback: true },
  'bard-dedication': { skills: { occultism: 'trained', performance: 'trained' }, redundantFallback: true },
  // "You are trained in Bardic Lore, a special Lore skill… If you have legendary proficiency in
  // OCCULTISM, you gain expert proficiency in Bardic Lore, but you can't increase your proficiency
  // rank in Bardic Lore by any other means." Two clauses, neither of which a flat `skills` grant
  // could say: the expert step is gated on a DIFFERENT skill (crossConditionalSkills, read in
  // build.ts's grant loop), and the lock lives in LOCKED_SKILL_KEYS (featGrants.ts) because it
  // has to reach the skill-increase loop and the builder, not this table.
  'bardic-lore': { skills: { 'lore:bardic': 'trained' }, crossConditionalSkills: { 'lore:bardic': { whenSkill: 'occultism', whenRank: 'legendary', rank: 'expert' } } },
  'battle-harbinger-dedication': { skillChoices: [{ options: 'any', rank: 'trained' }], redundantFallback: true },
  'battleblooded': { skills: { intimidation: 'trained' }, redundantFallback: true },
  'beast-trainer': { skills: { nature: 'trained' } },
  'beastbrood': { skills: { society: 'trained' }, redundantFallback: true },
  'blackjacket-dedication': { skills: { 'lore:warfare': 'trained' }, conditionalSkills: { intimidation: { base: 'trained', upgraded: 'expert' } }, redundantFallback: true },
  'bloodrager': { skills: { athletics: 'trained', medicine: 'trained' } },
  /* bloodrager-dedication was an OPEN skill slot here, and an unanswered `options: 'any'` resolves to
   * SKILLS[0] — so every bloodrager was silently trained in Acrobatics, a skill the feat never names.
   * The printed grant follows the bloodline the feat itself asks you to choose (Arcane -> Arcana,
   * Divine -> Religion), so it moved to a `choiceGrants` entry in featGrants.ts keyed by that answer;
   * the hand-authored table wins on an id conflict, so this line had to go rather than be overridden. */
  'bouncy-goblin': { skills: { acrobatics: 'trained' }, redundantFallback: true },
  /* *"trained in your choice of Deception or Diplomacy AND in Mzali Lore; if you were already trained,
   * you become an expert instead."* The clause was applied to the LORE only — the choice slot kept a
   * flat rank, so half the sentence was dropped. */
  'bright-lion-dedication': {
    conditionalSkills: { 'lore:mzali': { base: 'trained', upgraded: 'expert' } },
    skillChoices: [{ options: ['deception', 'diplomacy'], rank: 'trained', conditionalRank: { base: 'trained', upgraded: 'expert' } }]
  },
  'brilliant-crafter': { skills: { crafting: 'expert' }, rankUpgrade: [{ level: 7, rank: 'master' }, { level: 15, rank: 'legendary' }] },
  /* *"Whenever your proficiency rank in any weapon increases to expert or beyond, you also gain that
   * new proficiency rank with butterfly swords."* `mirrorBestCategory` is exactly that clause, and it
   * matters because the butterfly sword is an ADVANCED weapon: without it a fighter who is expert in
   * martial weapons still swung theirs at their advanced rank.
   * ⚠ Extended IN PLACE, not as a second entry: FEAT_GRANTS spreads three tables and a spread replaces
   * whole entries, so a sibling entry elsewhere would delete the conditionalSkills above. */
  'butterfly-blade-dedication': {
    conditionalSkills: { deception: { base: 'trained', upgraded: 'expert' }, stealth: { base: 'trained', upgraded: 'expert' } },
    weaponFamiliarity: { weapons: ['butterfly-sword'], mirrorBestCategory: true }
  },
  'campfire-chronicler-dedication': { skills: { religion: 'trained', survival: 'trained' }, redundantFallback: true },
  'captain-dedication': { skillChoices: [{ options: ['diplomacy', 'intimidation'], rank: 'trained' }], redundantFallback: true },
  /* *"Choose Deception or Diplomacy. You become trained in that skill, or become an expert if you were
   * already trained."* — the SINGLE-skill form of the clause, which `skill-clause-check` cannot see
   * (its regex requires the word "both"). Their side encodes it per option as
   * `IF SKILL_X >= T THEN E ELSE T`, which is exactly what `conditionalRank` means. Without it a taker
   * who already had the skill got nothing at all from the sentence. */
  'captivator-dedication': { skillChoices: [{ options: ['deception', 'diplomacy'], rank: 'trained', conditionalRank: { base: 'trained', upgraded: 'expert' } }] },
  'caretakers-intuition': { skills: { nature: 'trained' }, redundantFallback: true },
  'catch-the-details': { skills: { society: 'trained' }, redundantFallback: true },
  'catfolk-lore': { skills: { acrobatics: 'trained', survival: 'trained', 'lore:catfolk': 'trained' }, redundantFallback: true },
  'catfolk-weapon-expertise': { weaponFamiliarity: { 'weapons': ['kama', 'kukri', 'scimitar', 'sickle', 'claw-blade', 'whip-claw'], 'mirrorBestCategory': true } },
  'centaur-lore': { skills: { medicine: 'trained', nature: 'trained', 'lore:centaur': 'trained' }, redundantFallback: true },
  // "…If you already were trained in light armor and medium armor, you gain training in heavy armor
  // as well." — the same sentence Sentinel and Guardian print; see `conditionalArmor` in featGrants.ts.
  /* *"You become trained in Religion AND YOUR DEITY'S ASSOCIATED SKILL; for each of these skills in which
   * you were already trained, you instead become trained in a skill of your choice."* The deity half had
   * no carrier: build.ts:2711-2721 grants `Deity.skill` to CLERICS only, and its comment is about the
   * champion CLASS feature, not this PC2 dedication. Their side models it as a free trained skill pick
   * titled "Select your Deity's Skill" (ADJ_VALUE, filter group SKILL), which is what the slot below is;
   * the record-wide `redundantFallback` then supplies the "instead … a skill of your choice" clause for
   * both halves. Found by the batch-9 WG parity read. */
  'champion-dedication': { skills: { religion: 'trained' }, skillChoices: [{ options: 'any', rank: 'trained' }], armor: { light: 'trained', medium: 'trained' }, conditionalArmor: { ifTrainedIn: ['light', 'medium'], grant: 'heavy', rank: 'trained' }, redundantFallback: true },
  'changeling-lore': { skills: { deception: 'trained', occultism: 'trained', 'lore:hag': 'trained' }, redundantFallback: true },
  'childlike-plant': { skills: { deception: 'trained' }, redundantFallback: true },
  /*
   * *"You gain the trained proficiency rank in THE TWO SKILLS OF YOUR CLAN … You also become trained
   * in THE LISTED LORE FOR YOUR CLAN."* — a printed table of twelve clans, each naming its own pair
   * and its own Lore.
   *
   * It shipped as two unrestricted picks from a twelve-skill list plus any Lore, which asked the
   * player to supply the answer the table already gives and could not bind the Lore to the clan at
   * all — a Clan Ironfist dwarf could take Crafting, Medicine and *Sailing* Lore. Asking the clan and
   * deriving both is the printed structure.
   *
   * The thirteenth option is printed too: *"If you come from a clan not listed here, you become
   * trained in an appropriate selection of skills as determined by your GM"* — so that one answer,
   * and only that one, still asks. `choiceGrants` slots are read by build.ts and rendered by the
   * Builder through `featSkillChoiceValue`, keyed by the answer.
   *
   * Lore keys are the ordinary `lore:*` entries the static `skills` map already accepts.
   */
  'clan-lore': {
    redundantFallback: true,
    choiceGrants: {
      'clan-aringeld': { skills: { diplomacy: 'trained', society: 'trained', 'lore:mercantile': 'trained' } },
      'clan-breakiron': { skills: { crafting: 'trained', survival: 'trained', 'lore:alchemy': 'trained' } },
      'clan-firecask': { skills: { crafting: 'trained', nature: 'trained', 'lore:alcohol': 'trained' } },
      'clan-gelderon': { skills: { athletics: 'trained', nature: 'trained', 'lore:farming': 'trained' } },
      'clan-grimmark': { skills: { crafting: 'trained', society: 'trained', 'lore:architecture': 'trained' } },
      'clan-ironfist': { skills: { crafting: 'trained', medicine: 'trained', 'lore:smelting': 'trained' } },
      'clan-molgrade': { skills: { crafting: 'trained', thievery: 'trained', 'lore:smithing': 'trained' } },
      'clan-oriddus': { skills: { religion: 'trained', society: 'trained', 'lore:dwarven-pantheon': 'trained' } },
      'clan-runebinder': { skills: { arcana: 'trained', occultism: 'trained', 'lore:academia': 'trained' } },
      'clan-stonefist': { skills: { athletics: 'trained', intimidation: 'trained', 'lore:warfare': 'trained' } },
      'clan-tolorr': { skills: { diplomacy: 'trained', society: 'trained', 'lore:library': 'trained' } },
      'clan-vanderholl': { skills: { athletics: 'trained', crafting: 'trained', 'lore:labor': 'trained' } },
      'other-clan': {
        skillChoices: [{ options: 'any', rank: 'trained' }, { options: 'any', rank: 'trained' }],
        loreChoices: 1
      }
    }
  },
  'clan-pistol': { weaponFamiliarity: { 'weapons': ['clan-pistol'], 'rank': 'trained' } },
  'cleric-dedication': { skills: { religion: 'trained' }, skillChoices: [{ options: 'any', rank: 'trained' }], redundantFallback: true },
  /*
   * *"…and Warfare Lore; IF YOU WERE ALREADY TRAINED IN WARFARE LORE, you become trained in ANOTHER
   * LORE skill of your choice."* A bare `skills` grant cannot carry that: the record-wide fallback
   * reader (build.ts:4239) is guarded `!key.startsWith('lore:')`, so no flag on this shape could ever
   * fire. It has to be a SLOT, where `loreFallback` says the replacement is another Lore.
   */
  'commander-dedication': { skillChoices: [{ options: ['lore:warfare'], rank: 'trained', redundantFallback: true, loreFallback: true }] },
  'conrasu-lore': { skills: { crafting: 'trained', occultism: 'trained', 'lore:conrasu': 'trained' }, redundantFallback: true },
  'conrasu-weapon-expertise': { weaponFamiliarity: { 'weapons': ['composite-shortbow', 'glaive', 'longspear', 'longsword', 'shortbow', 'spear', 'buugeng', 'taw-launcher'], 'mirrorBestCategory': true } },
  // ⚠ The CONRASU TRAIT was missing — *"you also gain access to all uncommon conrasu weapons"* — so the
  // enumeration stops covering the feat the moment a refresh adds one. Their side names only the trait.
  /* Same two-clause split as azarketi above: the six named weapons at a flat trained rank, and the
   * conrasu-trait weapons demoted a category so they track the character's own proficiency. */
  'conrasu-weapon-familiarity': {
    weaponFamiliarity: [
    { weapons: ['composite-shortbow', 'glaive', 'longspear', 'longsword', 'shortbow', 'spear'], rank: 'trained' },
    { weapons: [], traits: ['conrasu'], treatAsLowerCategory: true }]

  },
  'corpse-tender-dedication': { skills: { diplomacy: 'trained' }, redundantFallback: true },
  'crafter-in-the-vault': { skills: { 'lore:architecture': 'trained', 'lore:engineering': 'trained' } },
  /* OVER-GRANT. Printed: *"You are trained in PERFORMANCE. If you were already trained in Performance,
   * you instead become trained in another skill of your choice."* One skill. The entry granted
   * Performance AND Deception AND Art Lore — two trainings neither the printed text nor Wanderer's
   * Guide gives. Found by the parity read. */
  'creative-prodigy': { skills: { performance: 'trained' }, redundantFallback: true },
  /* *"You have familiarity with the gauntlet bow, hand crossbow, and repeating hand crossbow, TREATING
   * THE REPEATING HAND CROSSBOW AS A MARTIAL WEAPON for the purposes of proficiency AND THE GAUNTLET BOW
   * AS A SIMPLE WEAPON for the purposes of proficiency."* That is the per-weapon one-category demotion,
   * not the ancestry-EXPERTISE shape the header at :56-64 reserves `mirrorBestCategory` for. With
   * `mirrorBestCategory` the three weapons took the character's BEST category rank, so a wizard (trained
   * simple, untrained martial) was trained in the ADVANCED repeating hand crossbow that the text hands
   * them only at their MARTIAL rank. Wanderer's Guide encodes plain WEAPON_FAMILIARITY on all three,
   * which is the same one-category demotion. Categories verified against core.json: gauntlet bow martial,
   * hand crossbow simple, repeating hand crossbow advanced. */
  'crossbow-infiltrator-dedication': { weaponFamiliarity: { weapons: ['gauntlet-bow', 'hand-crossbow', 'repeating-hand-crossbow'], treatAsLowerCategory: true } },
  'cultivator-dedication': { skills: { occultism: 'expert' } },
  'dandy-dedication': { conditionalSkills: { deception: { base: 'trained', upgraded: 'expert' }, society: { base: 'trained', upgraded: 'expert' } } },
  'demolitionist-dedication': { conditionalSkills: { 'lore:engineering': { base: 'trained', upgraded: 'expert' } } },
  /* The printed 7th/15th ladder was missing, so the Lore froze at expert. Identical wording — and now
   * identical shape — to `trick-driver-dedication` below, which already carried it. */
  'devils-eye': { skills: { 'lore:legal': 'expert' }, rankUpgrade: [{ level: 7, rank: 'master' }, { level: 15, rank: 'legendary' }] },
  'diverse-armor-expert': { armor: { light: 'expert', medium: 'expert', heavy: 'expert', unarmored: 'expert' } },
  'divine-dragonblood': { skills: { religion: 'trained' }, redundantFallback: true },
  /*
   * "Pick TWO of the following Lore skills: Engineering Lore, Explosive Lore, or Firearm Lore. At 2nd
   * level you gain EXPERT proficiency in these Lore skills; at 7th level, MASTER; and at 15th level,
   * LEGENDARY."
   *
   * The record shipped its three paired options and NO grants at all, so neither Lore was ever trained
   * and the whole ladder was dead.
   *
   * ⚠ `choiceGrants` and `rankUpgrade` are FEAT_GRANTS fields, read through `choiceGrantFor`. Authoring
   * them on the core.json record instead makes them write-only — which is where I put them first, and
   * the tests caught it.
   */
  'dongun-education': {
    choiceGrants: {
      'engineering-explosive': { skills: { 'lore:engineering': 'trained', 'lore:explosive': 'trained' } },
      'engineering-firearm': { skills: { 'lore:engineering': 'trained', 'lore:firearm': 'trained' } },
      'explosive-firearm': { skills: { 'lore:explosive': 'trained', 'lore:firearm': 'trained' } }
    },
    rankUpgrade: [{ level: 2, rank: 'expert' }, { level: 7, rank: 'master' }, { level: 15, rank: 'legendary' }]
  },
  /* Same shape as commander-dedication: *"If you were already trained in Dragon Lore, you also become
   * trained in a Lore skill of your choice."* Unreachable as a flat `skills` grant. */
  'draconic-acolyte-dedication': { skillChoices: [{ options: ['lore:dragon'], rank: 'trained', redundantFallback: true, loreFallback: true }] },
  'dragon-lore': { skills: { diplomacy: 'trained', intimidation: 'trained' }, redundantFallback: true },
  'dragonscaled-lore': { skills: { intimidation: 'trained', 'lore:dragon': 'trained' }, skillChoices: [{ options: ['arcana', 'nature', 'occultism', 'religion'], rank: 'trained' }], redundantFallback: true },
  'druid-dedication': { skills: { nature: 'trained' }, skillChoices: [{ options: 'any', rank: 'trained' }], redundantFallback: true },
  'dual-studies': { skillChoices: [{ options: 'any', rank: 'trained' }], rankUpgrade: { level: 7, rank: 'expert' } },
  'duskwalker-lore': { skills: { medicine: 'trained', religion: 'trained', 'lore:boneyard': 'trained' }, redundantFallback: true },
  'dustsoul': { skills: { survival: 'trained' }, redundantFallback: true },
  // The live record prints *"the Additional Lore general feat for DWARF Lore"* (Remaster renamed
  // Dwarven Lore → Dwarf Lore). The direct grant kept the legacy key, so binding the vehicle to the
  // printed subject would have put TWO Lore rows on the sheet. Renamed to agree with the sentence.
  'dwarven-lore': { skills: { crafting: 'trained', religion: 'trained', 'lore:dwarf': 'trained' }, redundantFallback: true },
  /* *"You gain the Additional Lore skill feat for Politics Lore. IF YOU WERE ALREADY TRAINED IN
   * POLITICS LORE, you also become trained in a Lore skill of your choice."* Same shape and same
   * reason as ulfen-guard-dedication and commander-dedication: the record-wide fallback reader is
   * guarded `!key.startsWith('lore:')` (build.ts), so the clause is unreachable on a flat `skills`
   * grant and needs a SLOT with `loreFallback`. The 3rd/7th/15th ladder is untouched - it comes from
   * the granted Additional Lore feat (FEAT_GRANT_BOUND_CHOICE in featFeatGrants.ts). */
  'eagle-knight-dedication': { skillChoices: [{ options: ['lore:politics'], rank: 'trained', redundantFallback: true, loreFallback: true }] },
  'earned-glory': { skills: { performance: 'trained' }, redundantFallback: true },
  'echo-of-lost-moments': { skills: { 'lore:fortune-telling': 'trained', 'lore:genealogy': 'trained' } },
  /*
   * *"You become trained in SOCIETY OR THIEVERY; if you are already trained in BOTH of these skills,
   * you instead become trained in a skill of your choice."* — ONE skill, picked from a pair.
   *
   * It shipped as THREE unrestricted `any` slots, which handed the character three free skill
   * trainings the feat never grants and offered every skill where the text offers two. The record-wide
   * `redundantFallback` alongside them was inert on top of that: its reader is guarded on the static
   * `skills` map (build.ts), and this record has none — the per-SLOT flag is the one that carries the
   * "already trained in both" clause, which is the whole reason that flag exists.
   *
   * Picks saved under slots `:1` and `:2` stop applying, which is the point: they were training the
   * feat never granted.
   */
  'edgewatch-detective-dedication': { skillChoices: [{ options: ['society', 'thievery'], rank: 'trained', redundantFallback: true }] },
  'eldritch-researcher-dedication': { skillChoices: [{ options: ['arcana', 'occultism'], rank: 'expert' }] },
  'elemental-embellish': { skills: { intimidation: 'trained' }, redundantFallback: true },
  'elemental-lore': { skills: { survival: 'trained' }, skillChoices: [{ options: ['arcana', 'nature'], rank: 'trained' }], loreChoices: 1, redundantFallback: true },
  'elemental-trade': { skills: { crafting: 'trained' }, redundantFallback: true },
  // *"…for ELF Lore"* — same Remaster rename as dwarven-lore above.
  'elven-lore': { skills: { arcana: 'trained', nature: 'trained', 'lore:elf': 'trained' }, redundantFallback: true },
  /* Prints the same *"if you would automatically become trained in one of those skills, you instead
   * gain the trained rank in another skill of your choice"* clause as `elven-lore` directly above, and
   * every other sibling that prints it carries the flag. This one did not, so the replacement was lost. */
  'embodied-legionary-subjectivity': { skills: { arcana: 'trained', athletics: 'trained', 'lore:warfare': 'trained' }, redundantFallback: true },
  'evasiveness-rogue': { save: { reflex: 'master' } },
  'executioner-weapon-training': { weaponFamiliarity: { 'weapons': ['battle-axe', 'falchion', 'greataxe', 'scimitar'], 'mirrorBestCategory': true } },
  'exemplar-dedication': { weapon: { martial: 'trained' } },
  'expert-overdrive': { skills: { crafting: 'expert' } },
  'extra-squishy': { skills: { acrobatics: 'trained' }, redundantFallback: true },
  'eye-for-treasure': { skills: { crafting: 'trained' }, redundantFallback: true },
  /* *"At 7th level you become a master in Performance, and at 15th level, you become legendary in
   * Performance."* The ladder stopped at master — a level-15 fan dancer stayed a step short. */
  'fan-dancer-dedication': { skills: { performance: 'expert' }, rankUpgrade: [{ level: 7, rank: 'master' }, { level: 15, rank: 'legendary' }] },
  'fascinated-by-society': { skills: { society: 'trained' }, redundantFallback: true },
  'fetchling-lore': { skills: { occultism: 'trained', stealth: 'trained', 'lore:shadow-plane': 'trained' }, redundantFallback: true },
  'field-propagandist-dedication': { conditionalSkills: { society: { base: 'trained', upgraded: 'expert' } } },
  'firework-technician-dedication': { conditionalSkills: { 'lore:fireworks': { base: 'trained', upgraded: 'expert' } } },
  'flexible-form': { skills: { acrobatics: 'trained' }, redundantFallback: true },
  'flexible-studies': { skillChoices: [{ options: 'any', rank: 'trained' }] },
  'folk-healer': { skills: { medicine: 'trained', occultism: 'trained' }, redundantFallback: true },
  /* *"If you are legendary in the Performance skill, you gain expert proficiency in Folktales Lore,
   * but you can't increase your proficiency rank in Folktales Lore by any other means."* Only the
   * trained half was authored, so the step never happened. Same shape as `bardic-lore` above. */
  'folktales-lore': {
    skills: { 'lore:folktales': 'trained' },
    crossConditionalSkills: { 'lore:folktales': { whenSkill: 'performance', whenRank: 'legendary', rank: 'expert' } }
  },
  'gemsoul': { skills: { performance: 'trained' }, redundantFallback: true },
  'genie-weapon-expertise': { weaponFamiliarity: { 'weapons': ['falchion', 'ranseur', 'scimitar', 'trident', 'wish-blade', 'wish-knife'], 'mirrorBestCategory': true } },
  /* Same two-clause split. The geniekin-trait demotion was missing entirely, and `wish-blade` /
   * `wish-knife` were pinned at trained as named weapons when they are geniekin weapons that should
   * follow the character's simple/martial proficiency. */
  'genie-weapon-familiarity': {
    weaponFamiliarity: [
    { weapons: ['falchion', 'ranseur', 'scimitar', 'trident'], rank: 'trained' },
    { weapons: [], traits: ['geniekin'], treatAsLowerCategory: true }]

  },
  'ghoran-lore': { skills: { arcana: 'trained', nature: 'trained', 'lore:ghoran': 'trained' }, redundantFallback: true },
  /* *"If you already have Hunt Prey, you become an expert in Survival."* — a rank gated on OWNING a
   * class feature (a ranger's Hunt Prey), the one conditional shape none of the others could express.
   * The rest of the record (the granted action, the +2 Stealth conditional, the off-guard Fortitude
   * rider, the animals/beasts/dragons restriction) already ships on the record itself. */
  'game-hunter-dedication': { skillsIfFeature: { featureId: 'hunt-prey', skills: { survival: 'expert' } } },
  'ghoran-weapon-expertise': { weaponFamiliarity: { 'weapons': ['glaive', 'greatclub', 'hatchet', 'scythe', 'sickle', 'thorn-whip'], 'mirrorBestCategory': true } },
  /* Two clauses, same as vanara. `thorn-whip` is the ghoran-trait weapon and was pinned at trained as
   * if it were one of the five named ones; it is martial, so it should follow the simple proficiency. */
  'ghoran-weapon-familiarity': {
    weaponFamiliarity: [
    { weapons: ['glaive', 'greatclub', 'hatchet', 'scythe', 'sickle'], rank: 'trained' },
    { weapons: [], traits: ['ghoran'], treatAsLowerCategory: true }]

  },
  /*
   * "…you become trained in your choice of Diplomacy or Society. If you would automatically become
   * trained in BOTH these skills (from your background or class, for example), you instead become
   * trained in a skill of your choice. If you're trained in Society, you also gain Courtly Graces."
   *
   * MOVED here from a core.json `effectChoices` picker (shipped v0.1.16). That picker could express
   * the two-way choice and nothing else: the both-already-trained clause had no route, and the
   * Courtly Graces grant is read in the feat→feat expansion, which runs long before effect choices
   * resolve. The saved answer is still honoured — see LEGACY_SKILL_SLOT_KEYS in build.ts.
   *
   * `redundantFallback` here is exactly WG's true-branch: their condition is DIPLOMACY >= T AND
   * SOCIETY >= T, and our per-slot flag fires when the slot's pick bought nothing. The two agree
   * because `skillSlotGrant` greys a dead option, so the only way to land on a redundant pick is for
   * BOTH options to be dead. The Courtly Graces half is FEAT_RANK_FEAT_GRANTS['gildedsoul'].
   */
  'gildedsoul': { skillChoices: [{ options: ['diplomacy', 'society'], rank: 'trained', redundantFallback: true }] },
  'gnome-obsession': { loreChoices: 1 },
  'goblin-lore': { skills: { nature: 'trained', stealth: 'trained', 'lore:goblin': 'trained' }, redundantFallback: true },
  'golden-league-xun-dedication': { skillChoices: [{ options: ['athletics', 'deception', 'intimidation', 'stealth'], rank: 'expert' }, { options: ['athletics', 'deception', 'intimidation', 'stealth'], rank: 'expert' }] },
  'golden-legionnaire-dedication': { skills: { 'lore:warfare': 'trained' } },
  'goloma-lore': { skills: { survival: 'trained', stealth: 'trained', 'lore:goloma': 'trained' }, redundantFallback: true },
  /* *"If you have legendary proficiency in Society, you gain expert proficiency in Gossip Lore, but
   * you can't increase your proficiency rank in Gossip Lore by any other means."* The twin of
   * `folktales-lore` above, gated on Society rather than Performance. */
  'gossip-lore': {
    skills: { 'lore:gossip': 'trained' },
    crossConditionalSkills: { 'lore:gossip': { whenSkill: 'society', whenRank: 'legendary', rank: 'expert' } }
  },
  'greenwatch-initiate': { skills: { survival: 'expert' } },
  'grippli-lore': { skills: { nature: 'trained', stealth: 'trained', 'lore:grippli': 'trained' }, redundantFallback: true },
  'grippli-weapon-expertise': { weaponFamiliarity: { 'weapons': ['blowgun', 'hatchet', 'scythe', 'shortbow', 'composite-shortbow'], 'mirrorBestCategory': true } },
  // Same closing sentence as Champion and Sentinel Dedication — see `conditionalArmor`.
  'guardian-dedication': { skills: { athletics: 'trained' }, redundantFallback: true, armor: { light: 'trained', medium: 'trained' }, conditionalArmor: { ifTrainedIn: ['light', 'medium'], grant: 'heavy', rank: 'trained' } },
  'guerrilla-dedication': { skillChoices: [{ options: ['deception', 'thievery'], rank: 'trained' }] },
  /* gunslinger-dedication was a FREE skill slot over all seven way-skills here, unrelated to the way
   * the feat itself asks you to choose — so a Way of the Sniper gunslinger could train Arcana, and an
   * unanswered slot silently trained Acrobatics (`opts[0]`). *"You become trained in YOUR WAY'S
   * associated skill"* is a `choiceGrants` clause, so it moved to featGrants.ts keyed by that answer,
   * together with its `weaponFamiliarity` half; the hand-authored table wins on an id conflict, so
   * this line had to go rather than be overridden. Same move as `bloodrager-dedication` above. */
  'halfling-lore': { skills: { acrobatics: 'trained', stealth: 'trained', 'lore:halfling': 'trained' }, redundantFallback: true },
  'harbingers-protection': { armor: { heavy: 'trained' }, armorMirrorBest: ['heavy'] },
  'harmless-doll': { skills: { deception: 'trained' }, redundantFallback: true },
  'harrower-dedication': { skills: { occultism: 'trained', 'lore:fortune-telling': 'trained' }, redundantFallback: true },
  /* *"You become trained in Occultism; if you were already trained in Occultism, you instead become
   * trained in a skill of your choice."* — the `redundantFallback` clause exactly. The record carried
   * no mechanical field of any kind. */
  'necromancer-dedication': { skills: { occultism: 'trained' }, redundantFallback: true },
  /*
   * *"When you take this dedication, choose Arcana, Nature, Occultism, or Religion. You become trained
   * in that skill, or you become EXPERT if you were already trained."* One restricted pick with the
   * upgrade on the slot — the lion-blade shape. The same answer also selects the archetype's TRADITION
   * (arcane for Arcana, primal for Nature, occult for Occultism, divine for Religion), which is why the
   * choice is stored under the `hedgeMageSkill` flag rather than resolved and forgotten.
   */
  'hedge-mage-dedication': {
    skillChoices: [{ options: ['arcana', 'nature', 'occultism', 'religion'], rank: 'trained', conditionalRank: { base: 'trained', upgraded: 'expert' } }]
  },
  'hellbreaker-dedication': { skills: { 'lore:devil': 'trained', 'lore:hellknight': 'trained' } },
  'hellknight-dedication': { conditionalSkills: { intimidation: { base: 'trained', upgraded: 'expert' } } },
  'hellknight-preferment': { skills: { intimidation: 'expert' } },
  'hellknight-signifer-preferment': { skills: { intimidation: 'expert' }, skillChoices: [{ options: ['arcana', 'nature', 'occultism', 'religion'], rank: 'expert' }] },
  'hellspawn': { skills: { deception: 'trained', 'lore:legal': 'trained' }, redundantFallback: true },
  'herbalist-dedication': { skills: { nature: 'expert' } },
  'hobgoblin-lore': { skills: { athletics: 'trained', crafting: 'trained', 'lore:hobgoblin': 'trained' }, redundantFallback: true },
  'hobgoblin-weapon-expertise': { weaponFamiliarity: { 'weapons': ['composite-longbow', 'composite-shortbow', 'glaive', 'longbow', 'longsword', 'shortbow', 'breaching-pike', 'phalanx-piercer', 'capturing-spetum'], 'mirrorBestCategory': true } },
  'ice-crafter': { conditionalSkills: { crafting: { base: 'trained', upgraded: 'expert' } } },
  'idyllkin': { skills: { nature: 'trained' }, redundantFallback: true },
  'impostor-in-hidden-places': { skills: { 'lore:fortune-telling': 'trained', 'lore:underworld': 'trained' } },
  'initiate-benefit-tome': { skillChoices: [{ options: 'any', rank: 'trained' }, { options: 'any', rank: 'trained' }], rankUpgrade: { level: 5, rank: 'expert' } },
  'innocuous': { skills: { deception: 'trained' }, redundantFallback: true },
  'intuitive-crafting': { skills: { crafting: 'trained' }, redundantFallback: true },
  'inventor-dedication': { skills: { crafting: 'trained' } },
  'investigator-dedication': { skills: { society: 'trained' }, skillChoices: [{ options: 'any', rank: 'trained' }], redundantFallback: true },
  /*
   * *"You are trained in heavy armor. WHENEVER YOU GAIN A BARBARIAN CLASS FEATURE THAT GRANTS YOU
   * EXPERT OR GREATER PROFICIENCY IN MEDIUM ARMOR, you also gain that proficiency in heavy armor."*
   *
   * Ours granted trained and stopped there — forever — so an invulnerable rager in heavy armour fell
   * two ranks behind their own medium armour from 13th level on. The barbarian's medium track (see
   * src/rules/advancement.ts) is expert at 13 via Medium Armor Expertise and master at 19 via Armor
   * Mastery, so those are the two levels the clause fires at. `rankUpgrade` is a floor on every rank
   * this grant gives, which is exactly the "you also gain that proficiency" shape.
   */
  'invulnerable-rager': { armor: { heavy: 'trained' }, rankUpgrade: [{ level: 13, rank: 'expert' }, { level: 19, rank: 'master' }] },
  'jalmeri-heavenseeker-dedication': { skillChoices: [{ options: ['acrobatics', 'occultism'], rank: 'trained' }] },
  'jotunborn-grappler': { skills: { athletics: 'trained' }, redundantFallback: true },
  'jotunborn-lore': { skills: { occultism: 'trained', survival: 'trained', 'lore:jotunborn': 'trained' }, redundantFallback: true },
  'juggler-dedication': { skills: { performance: 'trained' }, redundantFallback: true },
  'kholo-lore': { skills: { stealth: 'trained', survival: 'trained' }, redundantFallback: true },
  'kineticist-dedication': { skills: { nature: 'trained' }, redundantFallback: true },
  'kitharodian-actor-dedication': { conditionalSkills: { society: { base: 'trained', upgraded: 'expert' }, 'lore:theater': { base: 'trained', upgraded: 'expert' } } },
  'kitsune-lore': { skills: { diplomacy: 'trained', deception: 'trained', 'lore:kitsune': 'trained' }, redundantFallback: true },
  'knight-reclaimant-dedication': { skills: { stealth: 'expert', survival: 'expert' } },
  'knight-vigilant-dedication': { skills: { religion: 'expert' } },
  'kobold-lore': { skills: { stealth: 'trained', thievery: 'trained', 'lore:kobold': 'trained' }, redundantFallback: true },
  'kobold-weapon-expertise': { weaponFamiliarity: { 'weapons': ['crossbow', 'greatpick', 'light-pick', 'pick', 'spear', 'fangwire', 'flying-talon', 'tricky-pick'], 'mirrorBestCategory': true } },
  'lastwall-sentry-dedication': { conditionalSkills: { athletics: { base: 'trained', upgraded: 'expert' }, 'lore:undead': { base: 'trained', upgraded: 'expert' } } },
  'learn-by-watching': { skillChoices: [{ options: ['crafting', 'medicine', 'performance'], rank: 'trained' }] },
  'legendary-overdrive': { skills: { crafting: 'legendary' } },
  'legendary-tattoo-artist': { skills: { crafting: 'legendary' } },
  'lepidstadt-surgeon-dedication': { skills: { medicine: 'expert' } },
  'leshy-lore': { skills: { nature: 'trained', stealth: 'trained', 'lore:leshy': 'trained' }, redundantFallback: true },
  'linguist-dedication': { conditionalSkills: { society: { base: 'trained', upgraded: 'expert' } } },
  'lion-blade-dedication': { skills: { 'lore:espionage': 'trained' }, skillChoices: [{ options: ['deception', 'stealth'], rank: 'trained', conditionalRank: { base: 'trained', upgraded: 'expert' } }], redundantFallback: true },
  'living-monolith-dedication': { conditionalSkills: { 'lore:ancient-osirion': { base: 'trained', upgraded: 'expert' } } },
  /*
   * OVER-GRANT. Printed: *"You gain the trained proficiency rank in Survival AND EITHER Nature OR
   * Occultism."* The entry granted `nature` outright AND offered the Nature/Occultism choice, so a
   * lizardfolk got Nature free and a second skill on top of it. `lore:iruxi` is not granted here
   * either — the feat gives the Additional Lore FEAT for Astrology or Lizardfolk Lore, which is a
   * different lane and must not be a direct rank. Survival stays flat; the rest is the choice.
   */
  'lizardfolk-lore': { skills: { survival: 'trained' }, skillChoices: [{ options: ['nature', 'occultism'], rank: 'trained' }], redundantFallback: true },
  /* *"You are trained in Loremaster Lore … If you have LEGENDARY proficiency in a skill used to
   * Decipher Writing, you gain expert proficiency in Loremaster Lore, but you can't increase your
   * proficiency rank in Loremaster Lore by any other means."* The settle for this record called the
   * trained sentence "the whole grant"; it is not. Decipher Writing uses Arcana, Occultism, Religion
   * or Society, so any one of them at legendary triggers the step — `crossConditionalSkills` takes the
   * best of them because each entry only ever RAISES. */
  'loremaster-dedication': {
    skills: { 'lore:loremaster': 'trained' },
    crossConditionalSkills: {
      'lore:loremaster': { whenSkill: ['arcana', 'occultism', 'religion', 'society'], whenRank: 'legendary', rank: 'expert' }
    }
  },
  'lurker-in-devouring-dark': { skills: { 'lore:ocean': 'trained', 'lore:sailing': 'trained' } },
  /* *"…you also either become trained in Arcana or Nature, or an EXPERT in one of those skills in
   * which you were already trained."* — the lion-blade shape exactly, and the upgrade half was
   * missing: a druid taking this got nothing from the clause at all. */
  'magaambyan-attendant-dedication': { skillChoices: [{ options: ['arcana', 'nature'], rank: 'trained', conditionalRank: { base: 'trained', upgraded: 'expert' } }] },
  'magic-warrior-dedication': { conditionalSkills: { 'lore:magic-warrior': { base: 'trained', upgraded: 'expert' } }, skillChoices: [{ options: ['arcana', 'nature'], rank: 'trained' }] },
  'magus-dedication': { skills: { arcana: 'trained' }, redundantFallback: true, weapon: { simple: 'trained' } },
  /* *"You become trained in that skill OR BECOME AN EXPERT IF YOU WERE ALREADY TRAINED in it."* The
   * flat rank left an already-trained marshal at trained; `conditionalRank` is the slot-level carrier
   * documented for exactly this sentence. */
  'marshal-dedication': { skillChoices: [{ options: ['diplomacy', 'intimidation'], rank: 'trained', conditionalRank: { base: 'trained', upgraded: 'expert' } }] },
  'martial-experience': { minLevel: 11, weapon: { unarmed: 'trained', simple: 'trained', martial: 'trained', advanced: 'trained' } },
  'mastermind': { skillChoices: [{ options: ['arcana', 'nature', 'occultism', 'religion'], rank: 'trained' }] },
  'merfolk-lore': { skills: { arcana: 'trained', society: 'trained', 'lore:merfolk': 'trained' }, redundantFallback: true },
  'minotaur-lore': { skills: { society: 'trained', stealth: 'trained', 'lore:minotaur': 'trained' }, redundantFallback: true },
  'miresoul': { skills: { acrobatics: 'trained' }, redundantFallback: true },
  'monarch-of-the-fey-courts': { skills: { 'lore:art': 'trained', 'lore:fey': 'trained' } },
  'monastic-archer-stance': { weaponFamiliarity: { 'weapons': ['longbow', 'shortbow', 'gakgung', 'bow-staff', 'bow-staff-ranged', 'mikazuki', 'mikazuki-ranged'], 'mirrorBestCategory': true } },
  // ⚠ The MONK TRAIT was missing: the printed clause is *"access to uncommon weapons with the MONK
  // TRAIT and become trained in simple and martial monk weapons"*, and the list enumerates ~70 of them
  // by id. An enumeration stops covering the feat the moment a data refresh adds a monk weapon; the
  // trait does not. Their side names ONLY the trait.
  'monastic-weaponry': { weaponFamiliarity: { 'weapons': ['acrobats-staff', 'anchor-spear', 'ankhrav-duster', 'black-powder-knuckle-dusters', 'black-powder-knuckle-dusters-melee', 'black-powder-knuckle-dusters-ranged', 'bo-staff', 'boreal-staff', 'boreal-staff-greater', 'boreal-staff-major', 'bow-staff', 'bow-staff-melee', 'bow-staff-ranged', 'deepdread-claw', 'dragonscale-bo-staff', 'dragonscale-staff', 'fiendbreaker', 'fiendbreaker-heroic', 'fighting-fan', 'fulminating-spear', 'gakgung', 'gluttonous-spear', 'golden-blade-of-mzali', 'kama', 'katar', 'knuckle-duster', 'kusarigama', 'mikazuki', 'mikazuki-melee', 'mikazuki-ranged', 'monkeys-fist', 'nunchaku', 'nyctessas-staff', 'pantograph-gauntlet', 'phoenix-fighting-fan', 'piston-gauntlets', 'preordained-spear', 'purgatory-emissarys-staff', 'sai', 'sansetsukon', 'senseis-parasol', 'shadowpiercer', 'shuln-fang-katar', 'shuriken', 'skeletal-claw', 'snowcasters-staff', 'spear', 'spirit-fan', 'splintering-spear', 'splintering-spear-greater', 'splintering-spear-major', 'staff', 'staff-of-power', 'staff-of-sun-wukong', 'staff-of-the-dreamlands', 'staff-of-the-dreamlands-greater', 'staff-of-the-dreamlands-major', 'staff-of-the-magi', 'staff-of-the-ruling-beast', 'storm-herald', 'tekko-kagi', 'temple-sword', 'tonfa', 'tri-bladed-katar', 'twining-staff', 'twisting-gale', 'whipstaff'], 'traits': ['monk'], 'mirrorBestCategory': true } },
  /* *"You become trained in unarmed attacks and gain the powerful fist class feature. You become
   * trained in your choice of Acrobatics or Athletics; if you're already trained in BOTH of these
   * skills, you become trained in a skill of your choice."* The pick was unrestricted (`options:
   * 'any'`), which handed the free-choice fallback to every monk-dedicated character rather than only
   * to the one the clause describes; and the record-wide `redundantFallback` is inert on an entry with
   * no static `skills` map, so the condition belongs on the SLOT. The unarmed grant can only raise, and
   * no class starts untrained in unarmed, so it changes nothing today — authored because it is printed. */
  'monk-dedication': { weapon: { unarmed: 'trained' }, skillChoices: [{ options: ['acrobatics', 'athletics'], rank: 'trained', redundantFallback: true }] },
  'mortal-possibility': { skillChoices: [{ options: 'any', rank: 'legendary' }] },
  /* *"You become trained in medium and heavy armor. Whenever you gain a class feature that grants you
   * expert or greater proficiency in any armor (BUT NOT UNARMORED DEFENSE), you also gain that
   * proficiency rank in the armor types granted to you by this feat."* The second sentence had no
   * carrier, so both categories stayed at `trained` forever. `armorMirrorBest` is the armour twin of
   * weaponFamiliarity.mirrorBestCategory and honours the parenthesis: unarmored never feeds it. */
  'mountain-skin': { armor: { medium: 'trained', heavy: 'trained' }, armorMirrorBest: ['medium', 'heavy'] },
  'munitions-crafter': { skills: { crafting: 'trained' } },
  // ⚠ ONE Lore, chosen from two NAMED subjects — "your choice of Nagaji Lore or Naga Lore". The
  // extraction granted Naga Lore outright AND a free-typed Lore slot: two Lores where the text grants
  // one, and a picker that never offered Nagaji Lore. redundantFallback stays — it is the separate
  // "trained in a skill of your choice" clause, and its guard skips `lore:` keys anyway.
  'nagaji-lore': { skills: { occultism: 'trained', crafting: 'trained' }, skillChoices: [{ options: ['lore:nagaji', 'lore:naga'], rank: 'trained' }], redundantFallback: true },
  'nantambu-chime-ringer-dedication': { skillChoices: [{ options: ['arcana', 'occultism'], rank: 'trained', conditionalRank: { base: 'trained', upgraded: 'expert' } }] },
  'natural-performer': { skills: { performance: 'trained' } },
  'natural-skill': { skillChoices: [{ options: 'any', rank: 'trained' }, { options: 'any', rank: 'trained' }] },
  /*
   * ⚠ AN UNRESTRICTED SLOT IS NOT A HARMLESS ONE. Printed: *"trained in EITHER DIPLOMACY OR
   * INTIMIDATION, and Religion"* — this shipped `options: 'any'`, and featSkillChoiceValue
   * (build.ts:1324) resolves an UNANSWERED slot to `opts[0]`, which for 'any' is SKILLS[0] =
   * acrobatics. So every nephilim who never touched the picker was silently trained in Acrobatics —
   * a skill the feat does not offer — and neither of the two it does offer.
   */
  'nephilim-lore': { skills: { religion: 'trained' }, skillChoices: [{ options: ['diplomacy', 'intimidation'], rank: 'trained' }], redundantFallback: true },
  'nosois-mask': { skills: { intimidation: 'trained' }, redundantFallback: true },
  'occult-dragonblood': { skills: { occultism: 'trained' }, redundantFallback: true },
  'occult-evolution': { skillChoices: [{ options: 'any', rank: 'trained' }] },
  'officers-education': { skillChoices: [{ options: 'any', rank: 'trained' }, { options: 'any', rank: 'trained' }, { options: 'any', rank: 'expert' }] },
  'officers-expertise': { skills: { 'lore:warfare': 'expert' } },
  'officers-mastery': { skills: { 'lore:warfare': 'master' } },
  'officers-medical-training': { skills: { medicine: 'trained' }, redundantFallback: true },
  'old-soul': { skillChoices: [{ options: 'any', rank: 'trained' }, { options: 'any', rank: 'trained' }] },
  /* *"You become trained in Occultism AND OOZE LORE; if you were already trained, you become an
   * EXPERT instead."* One clause, two skills — Ooze Lore shipped as a flat `skills` grant, and that
   * loop only RAISES (build.ts ~4356), so a character who arrived already trained in Ooze Lore via
   * Additional Lore or a background stayed trained where the sheet reads expert. `redundantFallback`
   * went with it: this record prints no "a skill of your choice" clause at all — scan-redundant-
   * fallback.mjs lists it under `spurious` — and it had no reader either, since the static-skills
   * reader is guarded `!key.startsWith('lore:')` (build.ts:4350) and there is no `skillChoices` slot
   * for the per-slot reader (build.ts:4474) to reach. Their side (WG 25851) runs the same conditional
   * on both skills, the same `createValue`+conditional idiom Lastwall Sentry uses below. */
  'oozemorph-dedication': { conditionalSkills: { occultism: { base: 'trained', upgraded: 'expert' }, 'lore:ooze': { base: 'trained', upgraded: 'expert' } } },
  'operatic-adventurer': { skills: { performance: 'master' }, conditionalSkills: { 'lore:theater': { base: 'expert', upgraded: 'master' } }, rankUpgrade: { level: 15, rank: 'legendary' } },
  'oracle-dedication': { skills: { religion: 'trained' }, skillChoices: [{ options: 'any', rank: 'trained' }], redundantFallback: true },
  'orc-lore': { skills: { athletics: 'trained', survival: 'trained', 'lore:orc': 'trained' }, redundantFallback: true },
  // 'orc-warmask' — MOVED to the record's own `choice` (flag 'warmaskTradition'). One printed question
  // ("choose the source of your warmask's power") was being asked twice, by this slot and by the
  // record's `effectChoices`, and neither carrier could hand the ANSWER to Mask of Power's innate
  // spell. The choice's four options now carry the trained skill AND name the tradition.
  /* *"You become trained in Ostilli Lore; IF YOU WERE ALREADY TRAINED, YOU BECOME AN EXPERT."* Grants
   * only raise, so the flat `trained` made the upgrade half a no-op. Same shape as
   * `living-monolith-dedication` directly above. */
  'ostilli-host-dedication': { conditionalSkills: { 'lore:ostilli': { base: 'trained', upgraded: 'expert' } } },
  'overlooked-mastermind': { skills: { deception: 'trained' }, redundantFallback: true },
  'pactbinder-dedication': { skills: { diplomacy: 'expert' }, skillChoices: [{ options: ['arcana', 'nature', 'occultism', 'religion'], rank: 'expert' }] },
  'past-life': { skillChoices: [{ options: 'any', rank: 'trained' }], redundantFallback: true },
  'pathfinder-agent-dedication': { conditionalSkills: { 'lore:pathfinder': { base: 'trained', upgraded: 'expert' } }, skillChoices: [{ options: 'any', rank: 'trained' }] },
  'pelagic-aptitude': { skills: { survival: 'trained' } },
  'physical-training': { skills: { acrobatics: 'master', athletics: 'master' } },
  // 'pirate-dedication' — NO direct Lore grant, deliberately. *"You gain the Additional Lore general feat for Sailing Lore OR FOR A SPECIFIC COASTAL CITY you have a connection to (such as Port Peril Lore)."* The Lore is the PLAYER'S, which is why featFeatGrants.ts:574 hands Additional Lore over UNBOUND (no FEAT_GRANT_BOUND_CHOICE entry) and test/granted-lore-lane.test.ts:186-196 files this record under the three "offer a choice" granters. Additional Lore's own `loreChoices: 1` plus the 3rd/7th/15th ladder is line 31 above. A flat lore:sailing here trained Sailing Lore ON TOP of whatever the player picked — two Lores from a clause that gives one. Their remaster row (WG 31988) is the bare Additional Lore grant and nothing else.
  'pitborn': { skills: { athletics: 'trained' }, redundantFallback: true },
  'prairie-rider': { skills: { nature: 'trained' }, redundantFallback: true },
  'primal-dragonblood': { skills: { nature: 'trained' }, redundantFallback: true },
  'progenitor-lore': { skills: { deception: 'trained', occultism: 'trained' }, loreChoices: 1, redundantFallback: true },
  'prophet-of-kalistrade-dedication': { skills: { society: 'expert' } },
  'provocator-dedication': { skills: { performance: 'expert' }, skillChoices: [{ options: ['acrobatics', 'athletics'], rank: 'expert' }], weapon: { simple: 'trained', martial: 'trained' } },
  'psychic-dedication': { skills: { occultism: 'trained' }, redundantFallback: true },
  'pure-legion-enforcer-dedication': { conditionalSkills: { intimidation: { base: 'trained', upgraded: 'expert' }, religion: { base: 'trained', upgraded: 'expert' } }, redundantFallback: true },
  /*
   * "You gain the trained proficiency rank in the SKILL LISTED FOR YOUR QUAH (or another skill of your
   * choice, if you're already trained in that skill)" — then the feat lists seven quahs and their
   * skills. The primary slot is those seven, not all sixteen; the any-skill half is the parenthetical,
   * and that is what `redundantFallback` already delivers. Offering 'any' up front let a player train a
   * skill no quah grants, and skipped the fallback entirely because the slot was never redundant.
   * Their side offers the same seven. FEAT_GRANT_BOUND_CHOICE binds the granted Assurance to this slot,
   * so the assured skill and the trained skill cannot disagree.
   */
  'quah-bond': { skillChoices: [{ options: ['religion', 'athletics', 'nature', 'diplomacy', 'intimidation', 'medicine', 'acrobatics'], rank: 'trained' }], redundantFallback: true },
  'quicksoul': { skills: { acrobatics: 'trained' }, redundantFallback: true },
  'ranger-dedication': { skills: { survival: 'trained' }, redundantFallback: true },
  'ratfolk-lore': { skills: { acrobatics: 'trained', stealth: 'trained', 'lore:ratfolk': 'trained' }, redundantFallback: true },
  /* The skills half was modelled; the WEAPON half was not. *"Whenever your proficiency in any weapon
   * increases to expert or beyond, you also gain that new proficiency with sawtooth sabers."* That is
   * `mirrorBestCategory` — the sabre tracks the character's best weapon proficiency — the same shape
   * `gnoll-weapon-expertise` uses. Extended in place rather than added as a second entry. */
  'red-mantis-assassin-dedication': {
    conditionalSkills: { stealth: { base: 'trained', upgraded: 'expert' }, 'lore:assassin': { base: 'trained', upgraded: 'expert' } },
    weaponFamiliarity: { weapons: ['sawtooth-saber'], mirrorBestCategory: true }
  },
  'remnants-of-the-past': { loreChoices: 1 },
  'riftmarked': { skills: { occultism: 'trained' }, redundantFallback: true },
  'rivethun-emissary-dedication': { skills: { diplomacy: 'expert', religion: 'expert' } },
  'rivethun-invoker-dedication': { skills: { athletics: 'expert', religion: 'expert' } },
  'rivethun-involutionist-dedication': { skills: { nature: 'expert', religion: 'expert' } },
  'rose-warden-dedication': { conditionalSkills: { deception: { base: 'trained', upgraded: 'expert' } } },
  'round-ears': { skills: { deception: 'trained' }, redundantFallback: true },
  'ru-shi': { skills: { society: 'trained' }, redundantFallback: true },
  'runescarred-dedication': { skills: { arcana: 'expert' }, conditionalSkills: { 'lore:thassilon': { base: 'trained', upgraded: 'expert' } } },
  'sage-of-scattered-leaves': { skills: { religion: 'trained', nature: 'trained', 'lore:yaksha': 'trained' }, redundantFallback: true },
  'samsaran-lore': { skills: { religion: 'trained', society: 'trained', 'lore:samsaran': 'trained' }, redundantFallback: true },
  'sarangay-lore': { skills: { nature: 'trained', survival: 'trained', 'lore:sarangay': 'trained' }, redundantFallback: true },
  'scholars-inheritance': { skills: { crafting: 'trained' }, redundantFallback: true },
  'seasong': { skills: { performance: 'trained' }, redundantFallback: true },
  'shieldmarshal-dedication': { conditionalSkills: { society: { base: 'trained', upgraded: 'expert' } } },
  'shisk-lore': { skills: { 'lore:shisk': 'trained' }, loreChoices: 3 },
  'shokis-argument': { skills: { diplomacy: 'trained' }, redundantFallback: true },
  'shoony-lore': { skills: { diplomacy: 'trained', survival: 'trained', 'lore:shoony': 'trained' }, redundantFallback: true },
  'shrouded-mien': { skills: { deception: 'trained' }, redundantFallback: true },
  'silent-stone': { skills: { stealth: 'trained' }, redundantFallback: true },
  'sinister-appearance': { skills: { intimidation: 'trained' }, redundantFallback: true },
  'sister-of-the-golden-erinys-dedication': { skills: { 'lore:devil': 'trained' } },
  'sixth-pillar-dedication': { skillChoices: [{ options: 'any', rank: 'expert' }] },
  'skill-mastery': { skillChoices: [{ options: 'any', rank: 'master' }, { options: 'any', rank: 'expert' }] },
  'skill-mastery-rogue': { skillChoices: [{ options: 'any', rank: 'master' }, { options: 'any', rank: 'expert' }] },
  'skill-training': { skillChoices: [{ options: 'any', rank: 'trained' }] },
  'skull-creeper': { skills: { intimidation: 'trained' }, redundantFallback: true },
  'snare-setter': { skills: { crafting: 'trained' }, redundantFallback: true },
  'sociable': { skills: { diplomacy: 'trained' }, redundantFallback: true },
  'sorcerer-dedication': { skillChoices: [{ options: 'any', rank: 'trained' }, { options: 'any', rank: 'trained' }], redundantFallback: true },
  'spellshot-dedication': { skills: { arcana: 'trained' }, redundantFallback: true },
  'spiritual-echo': { loreChoices: 1 },
  'stalker-in-darkened-boughs': { skills: { 'lore:forest': 'trained', 'lore:hunting': 'trained' } },
  'startling-appearance-fleshwarp': { skills: { intimidation: 'trained' }, redundantFallback: true },
  'steward-of-stone-and-fire': { skills: { 'lore:mountain': 'trained', 'lore:volcano': 'trained' } },
  'stonebound-dedication': { skills: { 'lore:plane-of-earth': 'trained' }, redundantFallback: true },
  // ⚠ NO fallback: the printed clause is "If you're already trained in Crafting, you instead gain the
  // Specialty Crafting skill feat for stonemasonry" — a FEAT, never "a skill of your choice". The flag
  // surfaced a replacement-skill picker this feat does not grant. (apply-redundant-fallback.mjs will
  // not put it back: its OUTCOME regex does not match this text — verified.) The conditional FEAT half
  // lives in FEAT_RANK_FEAT_GRANTS (featFeatGrants.ts) — NOT in grantsFeats/FEAT_FEAT_GRANTS, which
  // are unconditional and would hand Specialty Crafting to every dwarf who took this.
  'stonemasons-eye': { skills: { crafting: 'trained' } },
  'story-crooner': { skills: { performance: 'trained' }, redundantFallback: true },
  'strix-lore': { skills: { acrobatics: 'trained', nature: 'trained', 'lore:strix': 'trained' }, redundantFallback: true },
  /* *"You become trained in your choice of Acrobatics or Athletics AND Warfare Lore; IF YOU WERE
   * ALREADY TRAINED, YOU BECOME AN EXPERT INSTEAD."* The upgrade reached the Lore only — the choice
   * slot kept a flat rank, so half the sentence was dropped and a monk already trained in Athletics
   * was handed a rank they had. Exactly the defect already fixed on `bright-lion-dedication` (:130)
   * and `alkenstar-agent-dedication` (:47); Wanderer's Guide carries the conditional on BOTH select
   * options, not just the Lore. */
  'student-of-perfection-dedication': {
    conditionalSkills: { 'lore:warfare': { base: 'trained', upgraded: 'expert' } },
    skillChoices: [{ options: ['acrobatics', 'athletics'], rank: 'trained', conditionalRank: { base: 'trained', upgraded: 'expert' } }],
  },
  'suli-jann': { skills: { survival: 'trained' }, redundantFallback: true },
  'surface-culture': { skills: { society: 'trained' }, loreChoices: 1, redundantFallback: true },
  /*
   * *"You become trained in Survival AND THE SKILL ASSOCIATED WITH THE MAGICAL TRADITION FROM YOUR
   * MAGIPHAGE ABILITY (Arcana for arcane, Nature for primal, Occultism for occult, or Religion for
   * divine). If you would automatically become trained in one of THOSE skills … you instead become
   * trained in a skill of your choice."*
   *
   * The second slot was `options: 'any'` — every skill in the game where the feat offers four, so a
   * surki could take Stealth off a feat that has nothing to do with it. The redundancy clause is
   * per-SLOT: it is owed only when the picked tradition skill is already trained, and the record-wide
   * flag cannot say that (its reader is guarded on the static `skills` map).
   */
  'surki-lore': {
    skills: { survival: 'trained' },
    skillChoices: [{ options: ['arcana', 'nature', 'occultism', 'religion'], rank: 'trained', redundantFallback: true }],
    redundantFallback: true
  },
  'svetocher': { skills: { diplomacy: 'trained' }, redundantFallback: true },
  /*
   * *"You become trained in Acrobatics and the skill associated with your chosen style… If you were
   * already trained in one of these skills, you become trained in a skill of your choice."*
   *
   * The clause belongs on each SLOT, not on the record: the record has no static `skills` map, so the
   * record-wide `redundantFallback` has no reader to fire on and is inert here — the same shape as
   * Gildedsoul. Per-style because the second skill IS the style's, so which grant can be redundant
   * depends on the answer.
   */
  'swashbuckler-dedication': { choiceGrants: { battledancer: { skillChoices: [{ options: ['acrobatics', 'performance'], rank: 'trained', redundantFallback: true }] }, braggart: { skillChoices: [{ options: ['acrobatics', 'intimidation'], rank: 'trained', redundantFallback: true }] }, fencer: { skillChoices: [{ options: ['acrobatics', 'deception'], rank: 'trained', redundantFallback: true }] }, gymnast: { skillChoices: [{ options: ['acrobatics', 'athletics'], rank: 'trained', redundantFallback: true }] }, rascal: { skillChoices: [{ options: ['acrobatics', 'thievery'], rank: 'trained', redundantFallback: true }] }, wit: { skillChoices: [{ options: ['acrobatics', 'diplomacy'], rank: 'trained', redundantFallback: true }] } } },
  'tangle-of-limbs': { skills: { athletics: 'trained' }, redundantFallback: true },
  'tanuki-lore': { skills: { deception: 'trained', performance: 'trained', 'lore:tanuki': 'trained' }, redundantFallback: true },
  'tattooed-historian-dedication': { skillChoices: [{ options: ['diplomacy', 'performance'], rank: 'trained' }], redundantFallback: true },
  'tengu-lore': { skills: { society: 'trained', survival: 'trained', 'lore:tengu': 'trained' }, redundantFallback: true },
  /* *"You become trained in your choice of Arcana, Nature, Occultism, or Religion; if you were already
   * trained in these, you become trained in a skill of your choice."* This was an OPEN slot, which is
   * wider than the book (it let the dedication train Athletics) and — worse — made the redundancy
   * clause unreachable, since there is always some untrained skill left, so the "already trained in
   * these" branch never fired. Narrowing it is what makes the printed conditional work. Their side
   * enumerates the same four. */
  'thaumaturge-dedication': {
    skillChoices: [{ options: ['arcana', 'nature', 'occultism', 'religion'], rank: 'trained', redundantFallback: true }],
    redundantFallback: true
  },
  'tinkering-fingers': { skills: { crafting: 'trained' }, redundantFallback: true },
  'transposable-compliance': { skills: { medicine: 'trained' }, redundantFallback: true },
  'travelers-counsel': { skills: { diplomacy: 'trained' }, redundantFallback: true },
  /* *"You become an expert in Driving Lore. At 7th level, you become a master in Driving Lore, and at
   * 15th level, you become legendary in Driving Lore."* The entry held only the expert and never
   * climbed — the dedication's own printed ladder, with no Additional Lore carrier to hide behind. */
  'trick-driver-dedication': { skills: { 'lore:driving': 'expert' }, rankUpgrade: [{ level: 7, rank: 'master' }, { level: 15, rank: 'legendary' }] },
  'tripkee-lore': { skills: { nature: 'trained', stealth: 'trained', 'lore:tripkee': 'trained' }, redundantFallback: true },
  'turpin-rowe-lumberjack-dedication': { conditionalSkills: { 'lore:milling': { base: 'trained', upgraded: 'expert' }, 'lore:forest': { base: 'trained', upgraded: 'expert' } } },
  /* *"At 7th level, you become a master in Society, and at 15th level, you become legendary in
   * Society."* Same one-step-short ladder as fan-dancer. */
  'twilight-speaker-dedication': { skills: { society: 'expert' }, rankUpgrade: [{ level: 7, rank: 'master' }, { level: 15, rank: 'legendary' }] },
  'twilight-talon-dedication': { skills: { 'lore:espionage': 'trained' } },
  /* *"You gain the Additional Lore skill feat for Warfare Lore. IF YOU WERE ALREADY TRAINED IN WARFARE
   * LORE, you also become trained in a Lore skill of your choice."* The second half cannot ride on a
   * flat `skills` grant: the record-wide fallback reader is guarded `!key.startsWith('lore:')`
   * (build.ts), so no flag on this shape could ever fire. It has to be a SLOT, where `loreFallback`
   * says the replacement is another Lore - the commander-dedication / draconic-acolyte-dedication
   * shape. The 3rd/7th/15th ladder is unaffected: it comes from the granted Additional Lore feat
   * (FEAT_GRANT_BOUND_CHOICE in featFeatGrants.ts), not from this line. */
  'ulfen-guard-dedication': { skillChoices: [{ options: ['lore:warfare'], rank: 'trained', redundantFallback: true, loreFallback: true }] },
  'undead-slayer-dedication': { loreChoices: 2 },
  'undersea-privateer-dedication': { skills: { athletics: 'expert' } },
  'underworld-investigator': { skills: { 'lore:underworld': 'trained' } },
  'vampire-lore': { skills: { society: 'trained', religion: 'trained', 'lore:vampire': 'trained' }, redundantFallback: true },
  'vanara-lore': { skills: { survival: 'trained', thievery: 'trained', 'lore:vanara': 'trained' }, redundantFallback: true },
  'vanara-weapon-expertise': { weaponFamiliarity: { 'weapons': ['bo-staff', 'chakram', 'katar', 'panabas', 'urumi', 'gada'], 'mirrorBestCategory': true } },
  'vandal': { skills: { thievery: 'trained' }, redundantFallback: true },
  'vanguard-of-roaring-waters': { skills: { 'lore:mountain': 'trained', 'lore:river': 'trained' } },
  'vehicle-mechanic-dedication': { skills: { crafting: 'expert' } },
  'verduran-shadow-dedication': { skills: { survival: 'expert' } },
  'viking-dedication': { skills: { 'lore:sailing': 'trained', 'lore:warfare': 'trained' } },
  'vishkanya-lore': { skills: { performance: 'trained', stealth: 'trained', 'lore:vishkanya': 'trained' }, redundantFallback: true },
  'vishkanya-weapon-expertise': { weaponFamiliarity: { 'weapons': ['blowgun', 'fighting-fan', 'kris', 'kukri', 'shuriken', 'visap'], 'mirrorBestCategory': true } },
  'wandering-chef-dedication': { skills: { crafting: 'trained' }, redundantFallback: true },
  'war-mage-dedication': { skills: { 'lore:warfare': 'trained' } },
  'warpriests-armor': { rankUpgrade: { level: 13, rank: 'expert' }, armor: { heavy: 'trained' } },
  'warren-navigator': { skills: { survival: 'trained' }, redundantFallback: true },
  'wayang-lore': { skills: { performance: 'trained', stealth: 'trained', 'lore:wayang': 'trained' }, redundantFallback: true },
  'weight-of-experience': { skillChoices: [{ options: 'any', rank: 'trained' }] },
  'well-met-traveler': { skills: { diplomacy: 'trained' }, redundantFallback: true },
  /* *"IF YOU HAVE LEGENDARY PROFICIENCY IN NATURE, you gain expert proficiency in Wild Mimic Lore."*
   * The expert step is gated on a DIFFERENT skill, which is exactly what crossConditionalSkills says —
   * the same shape as `bardic-lore` above. Only the flat trained rank was stored. */
  'wild-mimic-dedication': {
    skills: { 'lore:wild-mimic': 'trained' },
    crossConditionalSkills: { 'lore:wild-mimic': { whenSkill: 'nature', whenRank: 'legendary', rank: 'expert' } }
  },
  'wisdom-from-another-life': { skillChoices: [{ options: 'any', rank: 'trained' }] },
  'witch-dedication': { skillChoices: [{ options: 'any', rank: 'trained' }], redundantFallback: true },
  'wizard-dedication': { skills: { arcana: 'trained' }, redundantFallback: true },
  'woodworker': { skills: { crafting: 'trained' }, redundantFallback: true },
  'wrestler-dedication': { skills: { athletics: 'expert' } },
  'wylderheart-dedication': { skillChoices: [{ options: ['lore:demon'], rank: 'trained', redundantFallback: true, loreFallback: true }] },
  'yaoguai-historian': { skills: { occultism: 'trained', 'lore:yaoguai': 'trained' }, redundantFallback: true },
  'youre-so-cute': { skills: { performance: 'trained' } },
  'zephyr-guard-dedication': { conditionalSkills: { society: { base: 'trained', upgraded: 'expert' }, 'lore:katapesh': { base: 'trained', upgraded: 'expert' } } }
};
