/*
 * Feats/features that GRANT a fixed bonus feat — auto-extracted from Foundry GrantItem rule elements
 * (unconditional GrantItem → a specific feats-srd item). buildCharacter adds each granted feat as a
 * BONUS (no slot consumed), transitively, so the granted feat shows in Feats & Features AND its own
 * effects apply (proficiency grants, further feat grants, situational bonuses). Deduped against feats
 * the character already has. Choice-based grants (General Training → "pick a general feat") are NOT
 * here — those need a builder picker and are a separate follow-up.
 *
 * Regenerate: scratch featfeat-extract.mjs. Every listed target is verified to ship in core.json.
 *
 * FEAT_FEAT_GRANTS_LEVELED (hand-authored, above the auto table so the apply scripts preserve it) is
 * for grants that only kick in at a HIGHER level (Covet Hoard → Incredible Investiture at 11th).
 */
/* Type-only: erased at build, so this adds no runtime dependency and cannot form a cycle. */
import type { ProficiencyKey, ProficiencyRank } from './types';

export const FEAT_FEAT_GRANTS_LEVELED: Record<string, { feat: string; minLevel: number }[]> = {
  'covet-hoard': [{ feat: 'incredible-investiture', minLevel: 11 }],
  /* The animist Shaman practice hands its three feats over on a LADDER - "You gain the Spirit
   * Familiar feat. At 2nd level, you gain the Enhanced Familiar feat." (Invocation of Embodiment)
   * and "You gain the Incredible Familiar feat." (Invocation of Growth, 9th). `grantsFeats` on the
   * practice record is unconditional, so a 1st-level shaman owned all three at once. Keyed on the
   * SUBCLASS id, which reaches this queue because classFeatureIdsOwned adds `subclassId` whenever a
   * class feature of that id exists (derive.ts:3061). Spirit Familiar itself stays on the record's
   * own `grantsFeats`, because it does arrive at 1st. */
  'shaman': [{ feat: 'enhanced-familiar', minLevel: 2 }, { feat: 'incredible-familiar', minLevel: 9 }],
};

/**
 * A grant the granting feat's OWN CHOICE decides — *"you gain your choice of the Pet general feat or
 * the Train Animal skill feat"* (Beast Trainer, Player Core p.72).
 *
 * FEAT_FEAT_GRANTS is `Record<string, string[]>` with nowhere to say "it depends on the answer", and
 * `grantedFeatByChoice` is honoured for BACKGROUNDS only, so Beast Trainer handed out Train Animal
 * whichever branch the player picked — a missing grant and a spurious one in one act, with the Pet
 * branch's Tiny minion never appearing even though `FEAT_COMPANION_GRANTS['pet']` was ready to
 * receive it.
 *
 * Keys are the granting record; inner keys are the `choice` answer VALUES as the record spells them.
 *
 * ⚠ Declared ABOVE the auto table so the aon-verify regenerators preserve it: they keep everything
 * before `FEAT_FEAT_GRANTS_MARKER` (scripts/aon-verify/_ser.ts) and rewrite the rest.
 */
export const CHOICE_FEAT_GRANTS: Record<string, Record<string, string[]>> = {
  'beast-trainer': { pet: ['pet'], 'train-animal': ['train-animal'] },
  /* *"You gain a familiar. If you already have a familiar, you gain the Enhanced Familiar feat."* The
   * two are ALTERNATIVES, so an unconditional `grantsFeats: ['enhanced-familiar']` handed the feat to
   * everyone — including the character who took the dedication precisely because they had no familiar
   * — while a plain familiar grant gave the other character a redundant second one. The record now
   * asks which case applies and this answers it; an unanswered pick falls through to no grant, which
   * is the "I gain a familiar" branch. */
  'familiar-master-dedication': { yes: ['enhanced-familiar'], no: [] },
  /* *"You EITHER become trained in Deception and gain the CHARMING LIAR skill feat, OR become trained
   * in Diplomacy and gain the GROUP IMPRESSION skill feat."* Only the skill training was modelled —
   * the record's own answer values are `deception`/`diplomacy` — so whichever branch the player chose,
   * the skill feat half of the sentence was silently dropped. */
  'molten-wit': { deception: ['charming-liar'], diplomacy: ['group-impression'] },
  /* *"You gain the Hunt Prey action. … IF YOU ALREADY HAVE HUNT PREY, you gain the Monster Hunter feat
   * in addition to the other benefits of this feat."* The Monster Hunter half is the consolation for a
   * character who ALREADY had Hunt Prey, and the record's unconditional `grantsFeats` handed it to every
   * taker — including the ranger-less fighter the dedication exists for. Their side gates it on the same
   * condition (CLASS_FEATURE_NAMES INCLUDES "hunt prey"); ours reads the record's own answer. An
   * unanswered pick grants nothing, which is the "no" branch. Same shape as familiar-master-dedication. */
  'bounty-hunter-dedication': { yes: ['monster-hunter'], no: [] },
};

/**
 * A feat grant the character's OWN PROFICIENCY decides.
 *
 * Two records print it and neither could be expressed:
 *   Stonemason's Eye — "You become trained in Crafting. If you're ALREADY trained in Crafting, you
 *                       instead gain the Specialty Crafting skill feat for stonemasonry."
 *   Gildedsoul       — "If you're trained in Society, you also gain the Courtly Graces skill feat."
 *
 * `FEAT_FEAT_GRANTS`, `CHOICE_FEAT_GRANTS` and a record's own `grantsFeats` are all UNCONDITIONAL, so
 * the only authorings available were "hand it to everyone" or "hand it to nobody". Both records
 * shipped as nobody, and featGrantsAuto.ts carries a ⚠ above stonemasons-eye saying exactly that.
 *
 * Read in buildCharacter's feat->feat expansion, where `proficiencies.skills` already holds class,
 * background, free picks and skill increases but NO feat grant. That placement is what "already
 * trained" MEANS — reading it later would let a feat's own grant open its own gate.
 *
 * ⚠ `countOwnGrant` is the printed difference between the two, and is not cosmetic.
 *   Stonemason's Eye says "ALREADY trained" — trained by something OTHER than this feat. Its own
 *   Crafting grant must NOT open the gate, or every character taking it would get Specialty Crafting.
 *   Gildedsoul says "if you're trained in Society" with no "already", and that sentence follows the
 *   feat's own choice of Diplomacy OR Society — so picking Society here DOES satisfy it.
 */
export const FEAT_RANK_FEAT_GRANTS: Record<
  string,
  { skill: ProficiencyKey; rank: ProficiencyRank; feat: string; countOwnGrant?: boolean }[]
> = {
  'stonemasons-eye': [{ skill: 'crafting', rank: 'trained', feat: 'specialty-crafting' }],
  /*
   * Intuitive Crafting — *"You are trained in Crafting. If you were ALREADY trained in Crafting, you
   * INSTEAD gain the Specialty Crafting skill feat in a specialty of your choice."* The same sentence
   * and the same gate as Stonemason's Eye above, and the same reason for no `countOwnGrant`: "already"
   * means trained by something other than this feat, so its own Crafting grant must not open its own
   * door. Left UNBOUND — print says "of your choice", unlike Stonemason's Eye, which names stonemasonry.
   */
  'intuitive-crafting': [{ skill: 'crafting', rank: 'trained', feat: 'specialty-crafting' }],
  gildedsoul: [{ skill: 'society', rank: 'trained', feat: 'courtly-graces', countOwnGrant: true }],
  /*
   * Student of Water: *"AS SOON AS YOU MEET THE PREREQUISITES for Underwater Marauder and Water
   * Sprint, you gain those feats."* Two feats, two different Athletics gates — Underwater Marauder
   * needs trained, Water Sprint needs MASTER — and the record shipped neither, along with nothing
   * else at all.
   */
  'student-of-water': [
    { skill: 'athletics', rank: 'trained', feat: 'underwater-marauder' },
    { skill: 'athletics', rank: 'master', feat: 'water-sprint' },
  ],
  /*
   * Raging Intimidation: *"AS SOON AS YOU MEET THE PREREQUISITES for the skill feats Intimidating
   * Glare and Scare to Death, YOU GAIN THESE FEATS."* Two feats, two different gates — Intimidating
   * Glare needs trained in Intimidation, Scare to Death needs LEGENDARY — and the record shipped a
   * flat `grantsFeats: ['intimidating-glare']`, so Scare to Death was never granted at all and the
   * Glare arrived even for a barbarian who somehow lacked the trained rank.
   *
   * `countOwnGrant` is irrelevant on both of these: neither feat trains a skill of its own, so there
   * is no own grant that could open a gate.
   */
  'raging-intimidation': [
    { skill: 'intimidation', rank: 'trained', feat: 'intimidating-glare' },
    { skill: 'intimidation', rank: 'legendary', feat: 'scare-to-death' },
  ],
};

/**
 * A grant that is a TAKING OF ITS OWN — it survives the dedupe that drops a feat the character
 * already holds, and it carries its own separately-answered sub-choice.
 *
 * Jotunborn Lore is the record that needed it, and it needs both rows below at once:
 *   the feat     — *"You also gain the Additional Lore general feat FOR JOTUNBORN LORE."* (bound, and
 *                  already a distinct taking through FEAT_GRANT_BOUND_CHOICE), plus
 *                  *"**Special** If you have the SAGE JOTUNBORN heritage, you gain the Additional Lore
 *                  feat A SECOND TIME for a lore of your choice."*
 *   the heritage — *"You also gain the Additional Lore general feat for a lore skill of your choice."*
 * A sage jotunborn who takes the feat is owed THREE takings, and shipped with one.
 *
 * ⚠ WHY THIS IS AN OPT-IN TABLE AND NOT A RULE. The obvious general rule — "a REPEATABLE feat granted
 * by a second granter is a second taking" — is wrong, and the probe that says so is kept:
 * `scripts/probe-repeatable-grant-double.mjs` builds a cloistered cleric and shows they own BOTH
 * `cloistered-cleric` and `first-doctrine-cloistered-cleric`, which are one printed Domain Initiate
 * recorded on two ids. The blanket rule hands that cleric a second domain the book never printed. The
 * dedupe is the only thing preventing it today, so distinctness is claimed one row at a time.
 * `scripts/scan-repeatable-grant-collisions.mjs` lists every pair the question could ever apply to.
 *
 * `heritages` gates the row (the Special clause); omit it for an unconditional taking. `variant`
 * distinguishes this taking from the same granter's other one, and is what the free Lore subject is
 * keyed by — without it the Special take would resolve through the granter's BOUND answer and both
 * takings would train Jotunborn Lore, which is precisely what the printed "of your choice" denies.
 */
export const EXTRA_FEAT_TAKINGS: Record<string, { feat: string; heritages?: string[]; variant: string }[]> = {
  'jotunborn-lore': [{ feat: 'additional-lore', heritages: ['sage-jotunborn'], variant: 'sage' }],
  'sage-jotunborn': [{ feat: 'additional-lore', variant: 'heritage' }],
};

/**
 * A REPLACEMENT for a flat grant the character already owns.
 *
 * *"You gain the Breath Control, Diehard, and Fast Recovery feats… FOR EACH OF THESE FEATS YOU ALREADY
 * HAVE, you can INSTEAD gain a different feat from the following list: Canny Acumen, Fleet, and
 * Toughness."* (Three Clear Breaths — the only record in 6,552 whose text has this shape.)
 *
 * Every other grant lane here is all-or-nothing, and the flat one at build.ts drops a grant the
 * character already holds (`if (takenFeats.has(gid)) continue`). So a character who arrived with
 * Breath Control silently lost a third of the feat and was offered nothing back; one who had all
 * three got a 6th-level feat worth nothing at all. The silence IS the printed "instead".
 *
 * Read in the same feat->feat expansion, gated on the feats held BEFORE this granter's flat grants
 * ran — which is what "already have" means, and the reason the gate cannot simply read `takenFeats`
 * afterwards: by then the feat is there either way and every substitution would fire.
 *
 * The answer lives in `build.pickFeatChoices` under `<granterId>:sub:<ifHave>` — one per replaceable
 * feat, so a character owed two replacements answers twice. `Character.featSubstitutions` reports the
 * ones actually owed, so the builder never re-derives "already have" a second way.
 *
 * ⚠ The engine takes only an option from this record's own list, and only one the character does not
 * already hold — *"a DIFFERENT feat"* — so two substitutions can never collapse onto one feat.
 */
export const FEAT_SUBSTITUTE_GRANTS: Record<string, { ifHave: string; options: string[] }[]> = {
  'three-clear-breaths': (['breath-control', 'diehard', 'fast-recovery'] as const).map((ifHave) => ({
    ifHave,
    options: ['canny-acumen', 'fleet', 'toughness'],
  })),
};

/**
 * The feats `granterId` hands over, honouring its own choice once the player has answered it.
 *
 * Falls back to the flat table for an unanswered pick rather than defaulting to the first option, so
 * every character saved before this existed keeps the grant it already had.
 */
export function featFeatGrantsFor(granterId: string, choiceValue?: string): string[] {
  const byChoice = CHOICE_FEAT_GRANTS[granterId];
  if (byChoice && choiceValue && byChoice[choiceValue]) return byChoice[choiceValue];
  return FEAT_FEAT_GRANTS[granterId] ?? [];
}

/**
 * How to answer a granted feat's sub-choice when the GRANTING feat has already answered it.
 *
 * The builder's default for a granted feat is to ask its own question, and for Assurance that is a
 * free list of all 16 skills. Four granters do not permit that: their own text says which skill it
 * is. Weight of Experience is the plainest — *"you gain the trained proficiency rank in one skill of
 * your choice and the Assurance skill feat IN THAT SKILL"* — so asking a second time lets a player
 * train Medicine and take Assurance in Stealth, which the feat never offered.
 *
 * `skillChoice`/`loreChoice` name an index into the granter's OWN `FEAT_GRANTS` entry, so the bound
 * answer and the proficiency the grant hands out are read from the same stored pick and cannot
 * disagree. `fixed` is for a granter that names the skill outright (Eidetic Ear: "Assurance
 * (Performance)").
 */
export type BoundGrantAnswer =
  /**
   * The granter names the answer outright. `skill` takes an ARRAY when the sentence names more than
   * one — *"You gain the Specialty Crafting skill feat FOR BOTH STONEMASONRY AND BLACKSMITHING"*
   * (Elemental Trade). Multiple answers are comma-joined, the convention `fixedLore` already uses and
   * the builder already renders.
   */
  | { kind: 'fixed'; skill: string | string[] }
  | { kind: 'skillChoice'; index: number }
  | { kind: 'loreChoice'; index: number }
  /**
   * The granter NAMES the Lore in its own sentence: *"You also gain the Additional Lore general
   * feat FOR CATFOLK LORE."* There is nothing to ask — and until this existed there was nowhere to
   * answer it either, because the builder renders Additional Lore's Lore box only for a feat PICKED
   * into a slot and a granted feat never is. So the granted feat trained NOTHING. Measured: an
   * athamaru holding Athamaru Lore owned `additional-lore` with `grantedBy: 'athamaru-lore'` and no
   * Athamaru Lore whatsoever.
   *
   * It matters even where the granter ALSO trains the Lore directly, because the vehicle is what
   * carries *"at 3rd, 7th, and 15th levels … an additional skill increase you can apply only to the
   * chosen Lore subcategory"* — without it a level-20 catfolk’s Catfolk Lore sits at trained.
   *
   * A LIST for the two records that name two: Hellbreaker Dedication’s *"for both Devil Lore and
   * Hellknight Lore"* and Viking Dedication’s *"for Sailing Lore and Warfare Lore"*.
   *
   * `npm run scan:lore` classifies all 52 granters against their printed text and fails the guard
   * test if one that names its Lore is left unbound.
   */
  | { kind: 'fixedLore'; lore: string | string[] };

export const FEAT_GRANT_BOUND_CHOICE: Record<string, Record<string, BoundGrantAnswer>> = {
  // "You gain the Assurance (Performance) feat."
  'eidetic-ear': { assurance: { kind: 'fixed', skill: 'performance' } },
  // "…trained proficiency rank in one skill of your choice and the Assurance skill feat in that skill"
  'weight-of-experience': { assurance: { kind: 'skillChoice', index: 0 } },
  // "…trained in the skill listed for your quah… You gain the Assurance skill feat in that skill"
  'quah-bond': { assurance: { kind: 'skillChoice', index: 0 } },
  /*
   * "…you instead gain the Specialty Crafting skill feat FOR STONEMASONRY."
   *
   * Not a skill — Specialty Crafting's own pick is a twelve-option `choice` (flag specialtyCrafting)
   * whose values are craft specialties. `kind: 'fixed'` carries any option value, and 'stonemasonry'
   * renders through `skillKeyLabel` as "Stonemasonry", which is the record's own label for it.
   * Without this the granted feat asks a question the feat never offered, and until a player answered
   * it the specialty was nothing at all. WG preselects it too (Foundry: preselectChoices).
   */
  'stonemasons-eye': { 'specialty-crafting': { kind: 'fixed', skill: 'stonemasonry' } },
  /*
   * The rest of the granters that NAME the answer, found by the batches 1–12 residual read. Each was
   * handing over a feat and leaving its question unanswered, so the specialty was nothing at all until
   * a player guessed it — and the +1 circumstance star hung off that empty answer.
   */
  // "You gain the Specialty Crafting skill feat FOR WOODWORKING."
  woodworker: { 'specialty-crafting': { kind: 'fixed', skill: 'woodworking' } },
  // "You gain the Specialty Crafting feat WITH A SPECIALTY IN WEAVING."
  'web-weaver': { 'specialty-crafting': { kind: 'fixed', skill: 'weaving' } },
  // "You gain the Canny Acumen skill feat as a bonus feat, BUT YOU MUST CHOOSE PERCEPTION."
  'shiny-button-eyes': { 'canny-acumen': { kind: 'fixed', skill: 'perception' } },
  // "You gain the Specialty Crafting skill feat FOR BOTH Stonemasonry AND Blacksmithing." — the two-
  // answer case the `skill` array exists for.
  'elemental-trade': { 'specialty-crafting': { kind: 'fixed', skill: ['stonemasonry', 'blacksmithing'] } },
  // "You gain the Additional Lore feat and the Assurance feat FOR THE CHOSEN LORE."
  // "You gain the Additional Lore feat and the Assurance feat FOR THE CHOSEN LORE." Both granted
  // feats follow the Lore the player typed on Gnome Obsession itself, so both are bound to it.
  'gnome-obsession': { assurance: { kind: 'loreChoice', index: 0 }, 'additional-lore': { kind: 'loreChoice', index: 0 } },
  /*
   * Every granter that NAMES the Lore it hands over, quoted from the record above each one.
   * Produced by reading all 52 printed clauses (scripts/scan-granted-lore.mjs --list), not by
   * pattern-matching alone: the six that describe a Lore the app cannot name (a plane of your
   * lineage, the settlement, your culture, your past life) and the three that offer the player a
   * choice between named Lores are deliberately NOT here — binding those would answer a question
   * the book leaves open.
   */
  // "You gain the Additional Lore feat for Dueling Lore."
  'aldori-duelist-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'dueling' } },
  // "You also gain the Additional Lore general feat for Athamaru Lore."
  'athamaru-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'athamaru' } },
  // "You also gain the Additional Lore feat for Automaton Lore."
  'automaton-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'automaton' } },
  // "You also gain the Additional Lore general feat for Awakened Animal Lore."
  'awakened-animal-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'awakened animal' } },
  // "You gain the Additional Lore skill feat for Warfare Lore."
  'blackjacket-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'warfare' } },
  // "You also gain the Additional Lore general feat for Catfolk Lore."
  'catfolk-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'catfolk' } },
  // "You also gain the Additional Lore general feat for Centaur Lore."
  'centaur-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'centaur' } },
  // "You also gain the Additional Lore general feat for Hag Lore."
  'changeling-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'hag' } },
  // "You gain the Additional Lore feat for Dragon Lore."
  'draconic-acolyte-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'dragon' } },
  // "You also gain the Additional Lore general feat for Dragon Lore."
  'dragon-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'dragon' } },
  // "You also gain the Additional Lore general feat for Dragon Lore."
  'dragonscaled-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'dragon' } },
  // "You also gain the Additional Lore general feat for Boneyard Lore."
  'duskwalker-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'boneyard' } },
  // "You also gain the Additional Lore general feat for Dwarf Lore. (Remaster name; the record’s own direct grant was still keyed lore:dwarven and is renamed to match.)"
  'dwarven-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'dwarf' } },
  // "You gain the Additional Lore skill feat for Politics Lore."
  'eagle-knight-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'politics' } },
  // "You also gain the Additional Lore general feat for Elf Lore. (Remaster name; see dwarven-lore.)"
  'elven-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'elf' } },
  // "You gain the Additional Lore general feat for Gladiatorial Lore."
  'gladiator-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'gladiatorial' } },
  // "You also gain the Additional Lore general feat for Goblin Lore."
  'goblin-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'goblin' } },
  // "You also gain the Additional Lore general feat for Warfare Lore."
  'golden-legionnaire-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'warfare' } },
  // "You also gain the Additional Lore general feat for Halfling Lore."
  'halfling-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'halfling' } },
  // "You gain the Additional Lore general feat for both Devil Lore and Hellknight Lore."
  'hellbreaker-dedication': { 'additional-lore': { kind: 'fixedLore', lore: ['devil', 'hellknight'] } },
  // "You gain the Additional Lore general feat for Hell Lore. (No lore reached the sheet at all before this.)"
  'hellknight-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'hell' } },
  // "Finally, you gain the Additional Lore feat for a special Lore skill subcategory—Incarnation Lore."
  'heroic-scion-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'incarnation' } },
  // "You gain the Additional Lore general feat for Hobgoblin Lore."
  'hobgoblin-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'hobgoblin' } },
  // "You also gain the Additional Lore general feat for Jotunborn Lore."
  'jotunborn-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'jotunborn' } },
  // "You also gain the Additional Lore general feat for Kholo Lore."
  'kholo-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'kholo' } },
  // "You also gain the Additional Lore general feat for Kobold Lore."
  'kobold-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'kobold' } },
  // "You also gain the Additional Lore general feat for Leshy Lore."
  'leshy-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'leshy' } },
  // "You gain the Additional Lore skill feat for Espionage Lore."
  'lion-blade-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'espionage' } },
  // "You also gain the Additional Lore feat for Merfolk Lore."
  'merfolk-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'merfolk' } },
  // "You also gain the Additional Lore general feat for Minotaur Lore."
  'minotaur-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'minotaur' } },
  // "You also gain the Additional Lore general feat for Orc Lore."
  'orc-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'orc' } },
  // "You also gain the Additional Lore general feat for Ratfolk Lore."
  'ratfolk-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'ratfolk' } },
  // "You also gain the Additional Lore general feat for Yaksha Lore."
  'sage-of-scattered-leaves': { 'additional-lore': { kind: 'fixedLore', lore: 'yaksha' } },
  // "You also gain the Additional Lore general feat for Samsaran Lore."
  'samsaran-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'samsaran' } },
  // "You also gain the Additional Lore general feat for Sarangay Lore."
  'sarangay-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'sarangay' } },
  // "You gain the Additional Lore general feat for Devil Lore."
  'sister-of-the-golden-erinys-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'devil' } },
  // "You also gain the Additional Lore general feat for Surki Lore."
  'surki-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'surki' } },
  // "You also gain the Additional Lore general feat for Tanuki Lore."
  'tanuki-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'tanuki' } },
  // "You also gain the Additional Lore general feat for Tengu Lore."
  'tengu-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'tengu' } },
  // "You also gain the Additional Lore general feat for Tripkee Lore."
  'tripkee-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'tripkee' } },
  // "You gain the Additional Lore general feat for Espionage Lore."
  'twilight-talon-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'espionage' } },
  // "You gain the Additional Lore skill feat for Warfare Lore."
  'ulfen-guard-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'warfare' } },
  // "You also gain the Additional Lore general feat for Vampire Lore."
  'vampire-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'vampire' } },
  // "You gain the Additional Lore general feat for Sailing Lore and Warfare Lore."
  'viking-dedication': { 'additional-lore': { kind: 'fixedLore', lore: ['sailing', 'warfare'] } },
  // "You also gain the Additional Lore general feat for Warfare Lore."
  'war-mage-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'warfare' } },
  // "You also gain the Additional Lore general feat for Wayang Lore."
  'wayang-lore': { 'additional-lore': { kind: 'fixedLore', lore: 'wayang' } },
  // "You gain the Additional Lore skill feat for Demon Lore."
  'wylderheart-dedication': { 'additional-lore': { kind: 'fixedLore', lore: 'demon' } },
  // "You also gain the Additional Lore general feat for Yaoguai Lore."
  'yaoguai-historian': { 'additional-lore': { kind: 'fixedLore', lore: 'yaoguai' } },
};

/**
 * Is this grant's sub-choice the granter's to answer?
 *
 * Distinct from resolving it, because a binding can be declared and not yet answerable — Gnome
 * Obsession's Lore has no default until the player types a subject. The builder needs to withhold
 * its free picker in BOTH states, or it offers a control whose answer is discarded.
 */
export function isBoundGrant(granterId: string, grantedId: string): boolean {
  return !!FEAT_GRANT_BOUND_CHOICE[granterId]?.[grantedId];
}

/*
 * ⚠ SEVEN records print *"you gain the Additional Lore … feat for <X> Lore"* and had no entry here
 * at all — the vehicle was replaced by a direct `lore:<x>` grant in featGrantsAuto.ts (that is what
 * scripts/aon-verify/apply-reviewed.ts's SPECIFIC_LORE table does). The direct grant delivers the
 * training but NOT the 3rd/7th/15th-level increases, which live on Additional Lore, so those Lores
 * were frozen at trained forever. hellknight-dedication was worse: it has no direct grant either,
 * so its Hell Lore reached the sheet by no route at all. Measured by scripts/scan-granted-lore.mjs.
 */
export const FEAT_FEAT_GRANTS: Record<string, string[]> = {
  'aldori-duelist-dedication': ['additional-lore'],
  'golden-legionnaire-dedication': ['additional-lore'],
  'hellknight-dedication': ['additional-lore'],
  'jotunborn-lore': ['additional-lore'],
  'lion-blade-dedication': ['additional-lore'],
  'orc-lore': ['additional-lore'],
  'wylderheart-dedication': ['additional-lore'],
  'alchemist-dedication': ['alchemical-crafting'],
  'alkenstar-agent-dedication': ['lie-to-me'],
  'anchoring-roots': ['steady-balance'],
  'angelkin': ['multilingual'],
  'arcane-dragonblood': ['arcane-sense'],
  'artisanal-crafter': ['specialty-crafting'],
  'as-in-life-so-in-death': ['adopted-ancestry'],
  'athamaru-lore': ['additional-lore'],
  'automaton-lore': ['additional-lore'],
  'awakened-animal-lore': ['additional-lore'],
  'bastion-dedication': ['reactive-shield'],
  'battle-harbinger-dedication': ['toughness'],
  'battleblooded': ['intimidating-glare'],
  'beast-trainer': ['train-animal'],
  'beastbrood': ['courtly-graces'],
  'beneath-notice': ['quick-disguise', 'slippery-secrets'],
  'blackjacket-dedication': ['additional-lore'],
  'break-the-cycle': ['legendary-negotiation'],
  'callow-may': ['charming-liar'],
  'catch-the-details': ['eye-for-numbers'],
  'centaur-lore': ['additional-lore'],
  'ceremony-of-knowledge': ['untrained-improvisation'],
  'chelaxian-scion-dedication': ['additional-lore'],
  'clever-improviser': ['untrained-improvisation'],
  'climbing-tail': ['combat-climber'],
  'command-corpse': ['command-undead'],
  'contortionist': ['quick-squeeze'],
  'covet-hoard': ['hefty-hauler'],
  'cultural-adaptability': ['adopted-ancestry'],
  'cutting-rebuke': ['bon-mot'],
  'deceptive-tactics': ['lengthy-diversion'],
  'dedication-to-the-five': ['domain-initiate'],
  'defenders-grit': ['diehard'],
  'draconic-acolyte-dedication': ['additional-lore'],
  'draconic-familiar': ['pet'],
  'dragon-lore': ['additional-lore'],
  'dragonscaled-lore': ['additional-lore'],
  'dual-weapon-warrior-dedication': ['double-slice'],
  'duelist-dedication': ['quick-draw'],
  'eagle-knight-dedication': ['additional-lore'],
  'earned-glory': ['impressive-performance'],
  'edgewatch-detective-dedication': ['experienced-tracker'],
  'eidetic-ear': ['assurance'],
  'elemental-existence': ['adopted-ancestry'],
  'elemental-trade': ['specialty-crafting'],
  'elude-the-divine': ['slippery-secrets'],
  'elver-pet': ['pet'],
  'embodied-dreadnought-subjectivity': ['hefty-hauler'],
  'engine-bay': ['quick-repair'],
  'enigmas-knowledge': ['automatic-knowledge'],
  'eye-for-treasure': ['crafters-appraisal'],
  'familiar-sage-dedication': ['enhanced-familiar'],
  'firework-technician-dedication': ['alchemical-crafting'],
  'gear-up': ['prescient-planner', 'prescient-consumable'],
  'gemsoul': ['impressive-performance'],
  'gray-corsair-training': ['pirate-dedication'],
  'greenwatch-initiate': ['experienced-tracker', 'survey-wildlife'],
  'grimspawn': ['diehard'],
  'harmlessly-cute': ['shameless-request'],
  'hellbreaker-dedication': ['additional-lore'],
  'hellspawn': ['lie-to-me'],
  'heroic-scion-dedication': ['additional-lore'],
  'hidden-intentions': ['doublespeak', 'slippery-secrets'],
  'horizon-walker-dedication': ['favored-terrain'],
  'i-will-return': ['diehard'],
  'ice-crafter': ['magical-crafting'],
  /* Runic Crafter (class-feature-1316), the runesmith's 2nd-level feature: *"You gain the Magical
   * Crafting skill feat, even if you don't meet the prerequisites."* The same grant and nearly the same
   * sentence as Ice Crafter above; the record carried nothing at all. */
  'runic-crafter': ['magical-crafting'],
  'idyllkin': ['natural-medicine'],
  /* MOVED to FEAT_RANK_FEAT_GRANTS. *"If you were ALREADY trained in Crafting, you INSTEAD gain the
   * Specialty Crafting skill feat."* The grant is gated on training this feat did not itself supply;
   * here it was unconditional, so a character the feat trained in Crafting got the skill feat too —
   * both halves of one "instead". WG gates it the same way (SKILL_CRAFTING >= T). */
  'inventor-dedication': ['inventor'],
  'jotunborn-grappler': ['titan-wrestler'],
  'juggler-dedication': ['juggle'],
  'kholo-lore': ['additional-lore'],
  'lastwall-sentry-dedication': ['reactive-shield'],
  'laughing-kholo': ['battle-cry'],
  'libertys-promise': ['domain-initiate'],
  'linguist-dedication': ['multilingual'],
  'merfolk-lore': ['additional-lore'],
  'meticulous-restorer': ['quick-repair'],
  'miresoul': ['quick-squeeze'],
  'moray-eel-mount': ['bonded-animal'],
  'mummy-dedication': ['toughness'],
  'munitions-crafter': ['alchemical-crafting'],
  'nephilim-lore': ['additional-lore'],
  'nosois-mask': ['intimidating-glare'],
  'occult-dragonblood': ['oddity-identification'],
  'officers-medical-training': ['battle-medicine'],
  'orc-warmask': ['dubious-knowledge'],
  'pack-stalker': ['terrain-stalker'],
  'past-life': ['additional-lore'],
  'patch-job': ['improvised-repair'],
  'perfect-weaponry': ['monastic-weaponry'],
  'pistol-phenom-dedication': ['pistol-twirl'],
  'plummeting-roll': ['cat-fall'],
  /* *"Advanced Alchemy Benefits: You gain the Alchemical Crafting feat if you don't already have it."*
   * Seven siblings already carry this; these three print the same clause and carried nothing, so a
   * herbalist got neither the feat nor the formula book it seeds. `takenFeats` dedupes, which is the
   * engine's version of "if you don't already have it". */
  'herbalist-dedication': ['alchemical-crafting'],
  'advanced-alchemy': ['alchemical-crafting'],
  'morning-side-dishes': ['alchemical-crafting'],
  'poisoner-dedication': ['alchemical-crafting'],
  'predictive-purchase-rogue': ['prescient-planner', 'prescient-consumable'],
  'pure-legion-enforcer-dedication': ['recognize-spell'],
  'quah-bond': ['assurance'],
  'quick-fix': ['rapid-affixture'],
  'remnants-of-the-past': ['adopted-ancestry', 'additional-lore'],
  'reptile-rider': ['ride'],
  'riftmarked': ['oddity-identification'],
  'rivethun-invoker-dedication': ['diehard'],
  'rough-rider': ['ride'],
  'ru-shi': ['eye-for-numbers'],
  'runtsage': ['adopted-ancestry'],
  'sage-of-scattered-leaves': ['additional-lore'],
  'samsaran-lore': ['additional-lore'],
  'sarangay-lore': ['additional-lore'],
  'scholars-inheritance': ['alchemical-crafting'],
  'scroll-trickster-dedication': ['trick-magic-item'],
  'seasong': ['virtuosic-performer'],
  /*
   * REMOVED — Seeker of Truths was modelled TWICE and granted twice.
   *
   * *"You gain the cleric's Domain Initiate feat but must select knowledge, secrecy, or truth as your
   * domain."* This entry rendered Domain Initiate's OWN picker (offering the deity's domains, not the
   * three printed ones) while the record's `effectChoices[domain]` asked the same question restricted
   * correctly and granted the domain spell. Two live lanes: the player was asked twice and could come
   * away with two domain focus spells and two Focus Points where the text grants one.
   *
   * The record's own choice is the one kept — it is the only carrier of BOTH the three-domain
   * restriction and the granted spell. Deleting that instead (tried first) left the feat granting
   * nothing at all, which the parity gate caught on the next run.
   */
  // 'seeker-of-truths': ['domain-initiate'],
  'seneschal-witch-dedication': ['witchs-charge'],
  'settlement-scholastics': ['additional-lore'],
  'seven-changes-performance': ['quick-disguise'],
  'shackleborn': ['fast-recovery'],
  'shieldmarshal-dedication': ['streetwise', 'courtly-graces'],
  'shiny-button-eyes': ['canny-acumen'],
  'shrouded-mien': ['lengthy-diversion'],
  'silent-stone': ['terrain-stalker'],
  'sinister-appearance': ['intimidating-glare'],
  'skilled-herbalist': ['alchemical-crafting'],
  'skull-creeper': ['intimidating-glare'],
  'slip-with-the-breeze': ['quick-jump', 'powerful-leap'],
  'slither': ['quick-squeeze'],
  'snare-expert': ['snare-crafting'],
  'snare-setter': ['snare-crafting'],
  'snarecrafter-dedication': ['snare-crafting'],
  'sociable': ['hobnobber'],
  'speak-for-the-gravelands': ['geomancer-dedication'],
  'spell-acceleration': ['quickened-casting'],
  'spirit-familiar-animist': ['pet'],
  'startling-appearance-fleshwarp': ['intimidating-glare'],
  'story-crooner': ['impressive-performance'],
  'student-of-perfection-dedication': ['qi-spells'],
  'suli-jann': ['forager'],
  'surface-culture': ['additional-lore'],
  'surki-lore': ['additional-lore'],
  'surreptitious-spellcaster': ['conceal-spell'],
  'tangle-of-limbs': ['titan-wrestler'],
  'tanuki-lore': ['additional-lore'],
  'terrain-scout': ['terrain-stalker'],
  'thaumaturges-investiture': ['incredible-investiture'],
  'three-clear-breaths': ['breath-control', 'diehard', 'fast-recovery'],
  'tripkee-lore': ['additional-lore'],
  'twilight-talon-dedication': ['additional-lore'],
  'ulfen-guard-dedication': ['additional-lore'],
  'uncanny-agility': ['steady-balance'],
  'uncanny-cheeks': ['prescient-consumable', 'prescient-planner'],
  'underbrush-trailblazer': ['terrain-stalker'],
  'undersea-privateer-dedication': ['underwater-marauder'],
  'veil-may': ['lie-to-me'],
  'vestigial-wings': ['steady-balance', 'cat-fall'],
  'viking-shieldbearer': ['shield-block'],
  'viking-vindicator': ['sudden-charge'],
  'viking-weapon-familiarity': ['shield-block'],
  'wandering-chef-dedication': ['alchemical-crafting'],
  'water-nagaji': ['breath-control'],
  'wayang-lore': ['additional-lore'],
  'we-march-on': ['caravan-leader', 'pick-up-the-pace'],
  'web-weaver': ['specialty-crafting'],
  'weight-of-experience': ['assurance'],
  'well-met-traveler': ['hobnobber'],
  'werecreature-dedication': ['toughness'],
  'whitecape': ['steady-balance'],
  'wind-pillow': ['powerful-leap'],
  'wisdom-from-another-life': ['additional-lore'],
  'woodworker': ['specialty-crafting'],
  'wrestler-dedication': ['titan-wrestler'],
  'youre-so-cute': ['impressive-performance'],
  'adaptive-anadi': ['adopted-ancestry'],
  'alchemical-scholar': ['alchemical-crafting'],
  'alchemical-sciences-methodology': ['alchemical-crafting'],
  'alchemy': ['alchemical-crafting'],
  'aloof-firmament': ['cat-fall'],
  'anvil-dwarf': ['specialty-crafting'],
  'appraisers-eye': ['quick-identification'],
  'artisan-android': ['specialty-crafting'],
  'battle-ready-orc': ['intimidating-glare'],
  'battledancer': ['fascinating-performance'],
  'catfolk-lore': ['additional-lore'],
  'caveclimber-kobold': ['combat-climber'],
  'changeling-lore': ['additional-lore'],
  'cliffscale-lizardfolk': ['combat-climber'],
  'compact-skeleton': ['quick-squeeze'],
  'creative-prodigy': ['impressive-performance'],
  'deep-orc': ['terrain-expertise', 'combat-climber'],
  'duskwalker-lore': ['additional-lore'],
  'dwarven-lore': ['additional-lore'],
  'elven-lore': ['additional-lore'],
  'empiricism-methodology': ['thats-odd'],
  'empty-sky-kitsune': ['kitsune-spell-familiarity'],
  'esoteric-lore': ['dubious-knowledge'],
  'first-doctrine-cloistered-cleric': ['domain-initiate'],
  'forensic-medicine-methodology': ['forensic-acumen', 'battle-medicine'],
  'frightful-goloma': ['intimidating-glare'],
  'full-moon-sarangay': ['folk-healer'],
  'geckos-grip': ['combat-climber'],
  'gladiator-dedication': ['additional-lore'],
  'gnome-obsession': ['additional-lore', 'assurance'],
  'goblin-lore': ['additional-lore'],
  'halfling-lore': ['additional-lore'],
  'hobgoblin-lore': ['additional-lore'],
  'hold-scarred-orc': ['diehard'],
  'initiate-benefit-shield': ['shield-block'],
  'interrogation-methodology': ['no-cause-for-alarm'],
  'jalmeri-heavenseeker-dedication': ['qi-spells'],
  'keeper-jotunborn': ['survey-wildlife'],
  'kobold-lore': ['additional-lore'],
  'laborer-android': ['hefty-hauler'],
  'leshy-lore': ['additional-lore'],
  /*
   * listeners-boon — REMOVED, for the same reason `seeker-of-truths` above is commented out.
   *
   * *"You gain the Domain Initiate feat for the domain of fire, knowledge, protection, or travel."*
   * Domain Initiate's OWN picker is `kind: 'domains'` with the default 'deity' pool, so this entry
   * offered the character's DEITY's domains — disjoint from the printed four for most deities, and
   * EMPTY for a deity-less Campfire Chronicler. The record's own `choice` is now the only carrier of
   * both the four-domain restriction and the granted spell; keeping this line as well would ask the
   * player twice and hand out two focus spells, and so two pool points, where the text grants one.
   *
   * Wanderer's Guide grants no feat either: ability_block 41010 is a four-option SPELL select of bare
   * giveSpell ops (Fire Ray, Scholarly Recollection, Protector's Sacrifice, Agile Feet) hung on a
   * `CAMPFIRE_CHRONICLER:::-:::DIVINE:::ATTRIBUTE_CHA` casting source — their focus idiom, the same
   * one champion Devotion Spells uses. Their Seeker of Truths (26674) is encoded the same way.
   *
   * KNOWN COST, the same one the seeker-of-truths precedent accepted: advanced-domain,
   * shield-of-faith and expanded-domain-initiate print a "Domain Initiate" prerequisite, which
   * build.ts's HAS-FEAT check enforces, so this route no longer qualifies for them.
   */
  // 'listeners-boon': ['domain-initiate'],
  'liturgist': ['circle-of-spirits'],
  'lizardfolk-lore': ['additional-lore'],
  'marine-marauder-dedication': ['underwater-marauder'],
  'medium': ['relinquish-control'],
  'minotaur-lore': ['additional-lore'],
  'nine-lives-catfolk': ['diehard'],
  'peerless-inventor': ['inventor'],
  'pine-leshy': ['combat-climber'],
  'pirate-dedication': ['additional-lore'],
  'polychromatic-anadi': ['impressive-performance'],
  'prismatic-vishkanya': ['fascinating-performance'],
  'rascal': ['dirty-trick'],
  'ratfolk-lore': ['additional-lore'],
  'respite-of-a-thousand-roofs': ['improvise-tool'],
  'roaming-minotaur': ['terrain-expertise'],
  'runtboss-hobgoblin': ['group-coercion'],
  /* sage-jotunborn's Additional Lore lives in EXTRA_FEAT_TAKINGS, not here: it has to survive the
   * dedupe when the character ALSO took Jotunborn Lore, whose own Additional Lore is bound to a
   * different subject. A row here would be swallowed by exactly the take it is meant to sit beside. */
  'scavenger-strix': ['forager'],
  'seer': ['apparition-sense'],
  'shadow-of-the-courtier': ['impressive-performance'],
  'shield': ['shield-block'],
  'shoreline-strix': ['underwater-marauder'],
  'shortshanks-hobgoblin': ['ride'],
  'sister-of-the-golden-erinys-dedication': ['additional-lore'],
  'sparkling-targe': ['shield-block'],
  'spellbook-prodigy': ['magical-shorthand'],
  'stalker-minotaur': ['terrain-stalker'],
  'sturdy-skeleton': ['diehard'],
  'summiting-dragonblood': ['combat-climber'],
  'surgewise-fleshwarp': ['oddity-identification'],
  'tengu-lore': ['additional-lore'],
  'thalassic-azarketi': ['underwater-marauder'],
  'tough-to-kill': ['diehard'],
  'trogloshi': ['crystal-luminescence'],
  'tunnel-rat': ['quick-squeeze'],
  'vampire-lore': ['additional-lore'],
  'viking-dedication': ['additional-lore'],
  'war-mage-dedication': ['additional-lore'],
  'wisp-fetchling': ['quick-squeeze'],
  'wit': ['bon-mot'],
  'woodstalker-lizardfolk': ['terrain-stalker'],
  'yaoguai-historian': ['additional-lore'],
};
