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
export const FEAT_FEAT_GRANTS_LEVELED: Record<string, { feat: string; minLevel: number }[]> = {
  'covet-hoard': [{ feat: 'incredible-investiture', minLevel: 11 }],
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
  | { kind: 'fixed'; skill: string }
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
  'idyllkin': ['natural-medicine'],
  'intuitive-crafting': ['specialty-crafting'],
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
  'seeker-of-truths': ['domain-initiate'],
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
  'listeners-boon': ['domain-initiate'],
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
  'sage-jotunborn': ['additional-lore'],
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
