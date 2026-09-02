/*
 * Feat-granted proficiencies found by the PROFICIENCY lane classification (2026-07-29).
 *
 * Only FEATS appear here. The lane flagged 1,062 records, but FEAT_GRANTS is iterated over the
 * character's TAKEN FEATS only (build.ts ~2129) — class features are advanced by the class pipeline
 * and backgrounds/heritages by their own models. Filing those here would be inert data that the
 * coverage report would nonetheless count as "modelled", which is worse than leaving the gap visible.
 *
 * Hand-authored entries in featGrants.ts still win the merge.
 */
import type { FeatGrant } from './featGrants';

export const FEAT_LANE_GRANTS: Record<string, FeatGrant> = {
  'different-worlds': { "loreChoices": 1 },
  /* know-the-beat REMOVED (WG parity, batch 011). Its Lore pick is carried by the record's OWN
   * `effectChoices` (public/core.json feats.know-the-beat, from the effect-backfill row of the same
   * name), which asks the identical question with labelled options and per-option grants. Both
   * carriers applied and both rendered a picker, so a character who answered the effectChoices
   * dropdown ALSO received this slot's unanswered default - featSkillChoiceValue (build.ts:1356)
   * falls back to opts[0] = Guild Lore - i.e. two Lores for one printed grant. WG (feat 26771)
   * encodes exactly one select over the four Lores. The record prints no redundancy clause, which
   * is the only thing a skillChoices slot can express that effectChoices cannot. */
  'ghost-hunter-dedication': { "skillChoices": [{ "options": ["lore:spirit", "lore:haunt"], "rank": "trained" }] },
  'ancestral-insight': { "skills": { "lore:alghollthu": "trained", "lore:azlanti": "trained" } },
  /* free-heart REMOVED (WG parity). Free Heart is NOT a free skill plus a free Lore. Its `choice` (an
   * effect-backfill row, public/core.json feats.free-heart) picks a real common BACKGROUND, and
   * `passionBackground()` (build.ts:568) grants that background's trained skill and Lores (build.ts:2644)
   * and its skill feat (build.ts:3865). This proficiency-lane stand-in survived that upgrade and stacked
   * on top of it: build.ts:4425 applies `skillChoices` unconditionally for a taken feat and
   * featSkillChoiceValue defaults an unanswered 'any' slot to SKILLS[0] = Acrobatics, so the feat handed
   * out two trainings the book never gives and the builder showed two pickers for one printed decision.
   * WG (feat 43974) asks exactly three questions - the background's skill, its Lore, its skill feat -
   * and the printed text gives the same three; the background package already carries all of them. */
  'ironclad-fortitude': { "save": { "fortitude": "master" } },
  'diverse-weapon-expert': { "weapon": { "simple": "expert", "martial": "expert", "advanced": "trained" } },
  'master-spotter-ranger': { "perception": "master" },
  'juggernauts-fortitude': { "save": { "fortitude": "master" } },
  'evasiveness': { "save": { "reflex": "master" } },
  'gladiator-dedication': { "skills": { "lore:gladiatorial": "trained" } },
  'master-spotter': { "perception": "master" },
  /* ONE answer. The record's own `choice` (flag 'skill') is what CHOICE_FEAT_GRANTS reads for the paired
   * feat, so the skill is granted off that same answer — a separate skillChoices slot asked the skill a
   * second time under its own key and silently defaulted to Deception while unanswered (experience
   * gate, 2026-09-02). The WG-vs-print question on the skill/feat pairing (owner queue, batch 6) is
   * untouched by this: whichever way it is ruled, the skill is asked once. */
  'molten-wit': { "choiceGrants": { "deception": { "skills": { "deception": "trained" } }, "diplomacy": { "skills": { "diplomacy": "trained" } } } },
  /* "…trained in your choice of Diplomacy or Society. If you would automatically become trained in
   * BOTH these skills (from your background or class, for example), you instead become trained in a
   * skill of your choice. If you're trained in Society, you also gain the Courtly Graces skill feat."
   *
   * Three clauses, three homes. The choice is this slot. The both-already-trained replacement is the
   * slot's own `redundantFallback` — the record-wide flag cannot fire here, because its reader is
   * guarded on the static `skills` map and this record has none. Courtly Graces is
   * FEAT_RANK_FEAT_GRANTS, with `countOwnGrant` so that picking Society here counts as being trained
   * in it. Compare `beastbrood`, which prints the same Courtly Graces sentence and needs no gate at
   * all because it trains Society outright. */
  'gildedsoul': { "skillChoices": [{ "options": ["diplomacy", "society"], "rank": "trained", "redundantFallback": true }] },
  'hold-mark': { "skillChoices": [{ "options": ["diplomacy", "survival", "religion", "intimidation"], "rank": "trained" }] },
  /* 'oatia-skysage-dedication' — REMOVED, not re-ranked. *"You EITHER become trained in Astronomy Lore
   * OR AN EXPERT IN Occultism."* The record's own `effectChoices` picker (`skysage-training`, authored in
   * scripts/data/effect-backfill.json) already asks that once and carries both printed RANKS — trained
   * Lore on one branch, EXPERT Occultism on the other. This slot asked it a second time and could only
   * offer Occultism at trained, so a player who answered the two prompts differently was trained in
   * Astronomy Lore AND Occultism off a clause that gives one. Their side (WG 25843) has exactly one
   * `select` with those two options. */
  /* weaponFamiliarity MERGED in, not added as a second entry: "you have familiarity with weapons in
   * the polearm and spear weapon groups — martial as simple, advanced as martial". Two clauses because
   * a group rule carries one rank, so each step narrows the same groups by `category`. */
  'avenging-runelord-dedication': { skills: { arcana: 'trained' }, rankUpgrade: [{ level: 14, rank: 'expert' }, { level: 16, rank: 'master' }], weaponFamiliarity: [{ weapons: [], groups: ['polearm', 'spear'], category: 'martial', mirrorCategory: 'simple' }, { weapons: [], groups: ['polearm', 'spear'], category: 'advanced', mirrorCategory: 'martial' }] },
  'magical-knowledge': { "skillChoices": [{ "options": ["arcana", "nature", "occultism", "religion"], "rank": "master" }, { "options": ["arcana", "nature", "occultism", "religion"], "rank": "expert" }] },
  'resolute': { "save": { "will": "master" } },
  'master-spotter-investigator': { "perception": "master" },
  // Ancestry weapon familiarity: named weapons, not a whole category. All ten ids verified in core.json.
  // ⚠ The VANARA TRAIT was missing — *"you gain access to all uncommon vanara weapons"*.
  /* TWO clauses, unlike jotunborn: *"trained with the bo staff, chakram… IN ADDITION… martial VANARA
   * weapons are simple weapons"* — the demotion reaches only the trait weapons. Merged with a flat
   * rank, `gada` (advanced) sat at trained forever instead of tracking the martial proficiency. */
  'vanara-weapon-familiarity': {
    weaponFamiliarity: [
    { weapons: ['bo-staff', 'chakram', 'katar', 'panabas', 'urumi'], rank: 'trained' },
    { weapons: [], traits: ['vanara'], treatAsLowerCategory: true }]

  },
  // ⚠ TWO clauses, deliberately not folded into one. The demotion sentence names only "vishkanyan
  // weapons", so the five named weapons keep their flat printed `trained`; folding them in would let
  // build.ts's perWeapon branch overwrite that rank with the character's SIMPLE rank (a level-13
  // wizard's kukri would read expert where the text says trained) — an over-grant, which
  // test/weapon-familiarity-mirror.test.ts rules worse than a gap. Verified: `visap` is the only
  // item carrying the vishkanya trait, and none of the five named weapons carry it.
  'vishkanya-weapon-familiarity': { weaponFamiliarity: [{ weapons: ['blowgun', 'fighting-fan', 'kris', 'kukri', 'shuriken'], rank: 'trained' }, { weapons: [], traits: ['vishkanya'], treatAsLowerCategory: true }] },







  // ---- full feat audit (scripts/apply-feat-audit.mjs) ----
  // 10 entries. The judge said "no lane exists"; the adversary found the lane.
  /*
   * "You are also granted familiarity with BAYONETS, REINFORCED STOCKS, MARTIAL FIREARMS, and MARTIAL
   * COMBINATION WEAPONS; for the purposes of proficiency … you treat [them] as simple weapons."
   * The record shipped only its stance action, so none of the four ever became simple for it.
   */
  'bullet-dancer-dedication': { weaponFamiliarity: [
    { weapons: ['bayonet', 'reinforced-stock'], mirrorCategory: 'simple' },
    { weapons: [], groups: ['firearm'], category: 'martial', mirrorCategory: 'simple' },
    /* *"…and MARTIAL COMBINATION WEAPONS as simple weapons."* The fourth item of the printed list was
     * dropped — combination is a TRAIT, not a group, so it needed the trait-shaped entry (jotunborn
     * precedent below) and instead got nothing. The category keeps advanced combination weapons out. */
    { weapons: [], traits: ['combination'], category: 'martial', mirrorCategory: 'simple' }]
  },
  'crescent-cross-training': { "weaponFamiliarity": { "weapons": ["crescent-cross", "crescent-cross-melee", "crescent-cross-ranged"], "mirrorCategory": "simple" } },
  'eagle-eye': { "perception": "master" },
  // ⚠ `longspear` and the `jotunborn` TRAIT were both missing. Printed: *"weapons with the jotunborn
  // trait PLUS the bola, greataxe, halberd, maul, LONGSPEAR, and war flail"* — so a jotunborn got no
  // familiarity with their own ancestry's weapons, nor with one of the six the feat names outright.
  /*
   * ONE clause here, unlike ghoran/vanara. Jotunborn prints *"familiarity with weapons with the
   * jotunborn trait PLUS the bola, greataxe… — you treat ANY OF THESE that are martial weapons as
   * simple weapons and any that are advanced weapons as martial"*: the demotion covers the named
   * weapons too, so they belong in the same clause. `mirrorCategory: 'simple'` was the wrong carrier —
   * it resolves to ONE rank for every weapon (build.ts:5293), which cannot demote an advanced weapon
   * to martial, and both jotunborn-trait weapons (bladesweeper, maul-spade) are advanced.
   */
  'jotunborn-weapon-familiarity': { weaponFamiliarity: { weapons: ['bola', 'greataxe', 'halberd', 'maul', 'longspear', 'war-flail'], traits: ['jotunborn'], treatAsLowerCategory: true } },
  'knight-in-shining-armor': { "armor": { "heavy": "expert" } },
  'knight-vigilant': { "skills": { "religion": "expert" } },
  'legions-aim': { "weaponFamiliarity": { "weapons": ["acid-flask-greater", "acid-flask-lesser", "acid-flask-major", "acid-flask-moderate", "alchemists-fire-greater", "alchemists-fire-lesser", "alchemists-fire-major", "alchemists-fire-moderate", "alicorn-trigger", "arboreals-revenge", "arquebus", "atrophy-bomb-greater", "atrophy-bomb-lesser", "atrophy-bomb-major", "atrophy-bomb-moderate", "axe-musket", "axe-musket-ranged", "big-boom-gun", "bioluminescence-bomb", "black-king", "black-powder-knuckle-dusters", "black-powder-knuckle-dusters-ranged", "blade-of-fallen-stars", "blasting-stone-greater", "blasting-stone-lesser", "blasting-stone-major", "blasting-stone-moderate", "blight-bomb-greater", "blight-bomb-lesser", "blight-bomb-major", "blight-bomb-moderate", "blightburn-bomb", "blightburn-bomb-greater", "blood-bomb-greater", "blood-bomb-lesser", "blood-bomb-major", "blood-bomb-moderate", "blunderbuss", "boastful-hunter", "bottled-lightning-greater", "bottled-lightning-lesser", "bottled-lightning-major", "bottled-lightning-moderate", "bottled-sunlight-greater", "bottled-sunlight-lesser", "bottled-sunlight-major", "bottled-sunlight-moderate", "boulder-seed", "boulder-seed-greater", "breath-blaster", "breath-blaster-greater", "breath-blaster-major", "cane-pistol", "cane-pistol-ranged", "clan-pistol", "coldstar-pistols", "crystal-shards-greater", "crystal-shards-major", "crystal-shards-moderate", "dagger-pistol", "dagger-pistol-ranged", "dawnsilver-tree", "defoliation-bomb-greater", "defoliation-bomb-lesser", "defoliation-bomb-major", "defoliation-bomb-moderate", "double-barreled-musket", "double-barreled-pistol", "dragon-mouth-pistol", "drake-rifle-acid", "drake-rifle-cold", "drake-rifle-electricity", "drake-rifle-fire", "drake-rifle-poison", "dread-ampoule-greater", "dread-ampoule-lesser", "dread-ampoule-major", "dread-ampoule-moderate", "dueling-pistol", "durian-bomb-greater", "durian-bomb-lesser", "durian-bomb-major", "durian-bomb-moderate", "dwarven-daisy-lesser", "dwarven-daisy-moderate", "frost-vial-greater", "frost-vial-lesser", "frost-vial-major", "frost-vial-moderate", "fulmination-fang", "ghost-charge-greater", "ghost-charge-lesser", "ghost-charge-major", "ghost-charge-moderate", "glue-bomb-greater", "glue-bomb-lesser", "glue-bomb-major", "glue-bomb-moderate", "gnome-amalgam-musket", "gnome-amalgam-musket-ranged", "goo-grenade-greater", "goo-grenade-lesser", "goo-grenade-major", "goo-grenade-moderate", "gun-sword", "gun-sword-ranged", "hammer-gun", "hammer-gun-ranged", "harmona-gun", "hex-blaster", "howler-pistol", "immolation-clan-pistol", "inflammation-flask-greater", "inflammation-flask-lesser", "inflammation-flask-major", "inflammation-flask-moderate", "iris-of-the-sky", "jax", "jezail", "junk-bomb-greater", "junk-bomb-lesser", "junk-bomb-major", "junk-bomb-moderate", "leydroth-spellbreaker", "liars-gun", "lodestone-bomb", "lodestone-bomb-greater", "mace-multipistol", "mace-multipistol-ranged", "mindlance", "mud-bomb-greater", "mud-bomb-lesser", "mud-bomb-major", "mud-bomb-moderate", "nail-bomb-greater", "nail-bomb-lesser", "nail-bomb-major", "nail-bomb-moderate", "necrotic-bomb-greater", "necrotic-bomb-lesser", "necrotic-bomb-major", "necrotic-bomb-moderate", "nightmares-lament", "obsidian-edge", "obsidian-edge-greater", "obsidian-edge-major", "obsidian-edge-true", "pact-bound-pistol", "pepperbox", "pernicious-spore-bomb-greater", "pernicious-spore-bomb-lesser", "pernicious-spore-bomb-major", "pernicious-spore-bomb-moderate", "peshpine-grenade-greater", "peshpine-grenade-lesser", "peshpine-grenade-major", "peshpine-grenade-moderate", "petrification-cannon", "piercing-wind", "piercing-wind-ranged", "pressure-bomb-greater", "pressure-bomb-lesser", "pressure-bomb-major", "pressure-bomb-moderate", "rapier-pistol", "rapier-pistol-ranged", "reapers-grasp", "redeemers-pistol", "redpitch-bomb-greater", "redpitch-bomb-lesser", "redpitch-bomb-major", "redpitch-bomb-moderate", "scarlet-queen", "screech-shooter", "screech-shooter-greater", "screech-shooter-major", "shatterstone", "shatterstone-greater", "shobhad-longrifle", "silver-orb-greater", "silver-orb-lesser", "silver-orb-powder", "silverscrap-bomb-greater", "silverscrap-bomb-lesser", "silverscrap-bomb-moderate", "silversoul-bomb", "silversoul-bomb-greater", "silversoul-bomb-major", "skunk-bomb-greater", "skunk-bomb-lesser", "skunk-bomb-major", "skunk-bomb-moderate", "slide-pistol", "spark-dancer", "spellsap-grenade", "spellsap-grenade-greater", "spider-gun", "spider-gun-greater", "spider-gun-major", "spider-satchel-greater", "spider-satchel-lesser", "spider-satchel-major", "spider-satchel-moderate", "spike-launcher", "spoon-gun", "star-grenade-greater", "star-grenade-lesser", "star-grenade-major", "star-grenade-moderate", "steelscour-greater", "steelscour-lesser", "steelscour-major", "steelscour-moderate", "sticky-algae-bomb-greater", "sticky-algae-bomb-lesser", "sticky-algae-bomb-major", "sticky-algae-bomb-moderate", "sulfur-bomb-greater", "sulfur-bomb-lesser", "sulfur-bomb-major", "sulfur-bomb-moderate", "sunken-pistol", "tallow-bomb-greater", "tallow-bomb-lesser", "tallow-bomb-major", "tallow-bomb-moderate", "tenderizer-grenade-greater", "tenderizer-grenade-lesser", "tenderizer-grenade-major", "tenderizer-grenade-moderate", "tentacle-cannon", "tentacle-cannon-greater", "tentacle-cannon-major", "three-peaked-tree", "three-peaked-tree-ranged", "thundercrasher", "tigers-claw", "triggerbrand", "triggerbrand-ranged", "trueshape-bomb", "trueshape-bomb-greater", "twigjack-sack-greater", "twigjack-sack-lesser", "twigjack-sack-major", "twigjack-sack-moderate", "versatile-vial", "vexing-vapor-greater", "vexing-vapor-lesser", "vexing-vapor-major", "vexing-vapor-moderate", "water-bomb-greater", "water-bomb-lesser", "water-bomb-major", "water-bomb-moderate"], "mirrorCategory": "simple" } },
  'marine-combat-training': { "weaponFamiliarity": { "weapons": ["harpoon", "trident"], "mirrorCategory": "simple" } },
  'performance-weapon-expert': { "weapon": { "simple": "expert", "martial": "expert" } },
  'signifer-armor-expertise': { "armor": { "medium": "expert", "heavy": "expert" } },
  'tools-of-the-trade': { "weaponFamiliarity": { "weapons": ["bola", "sap", "whip"], "mirrorCategory": "simple" } },

  /* ── ancestry weapon familiarity: the category remap ─────────────────────────────────────── */
  /* Derived from each record's own `critSpecWeapons` by scripts/apply-weapon-familiarity.mjs, so the
   * weapons this feat covers and the weapons it crit-specialises can never disagree. The printed
   * clause is "treat any of these that are martial weapons as simple weapons and any that are
   * advanced weapons as martial weapons" — per-weapon, which is what `treatAsLowerCategory` says. */
  'dwarven-weapon-familiarity': { weaponFamiliarity: { weapons: ['battle-axe', 'pick', 'warhammer'], traits: ['dwarf'], treatAsLowerCategory: true } },
  /* Printed: "…weapons with the elf trait plus Longbows, Composite Longbows, Rapiers, Shortbows, and
   * Composite Shortbows." Both composite bows were missing from BOTH halves — they are separate weapon
   * items carrying no elf trait, so neither the trait list nor the base list reached them. Added with
   * the matching fix to `critSpecWeapons.bases` on the record; test/weapon-familiarity-remap asserts
   * the two halves name the same weapons and caught it when only one half had been updated. */
  'elven-weapon-familiarity': { weaponFamiliarity: { weapons: ['longbow', 'composite-longbow', 'rapier', 'shortbow', 'composite-shortbow'], traits: ['elf'], treatAsLowerCategory: true } },
  'gnome-weapon-familiarity': { weaponFamiliarity: { weapons: ['glaive', 'kukri'], traits: ['gnome'], treatAsLowerCategory: true } },
  'goblin-weapon-familiarity': { weaponFamiliarity: { weapons: [], traits: ['goblin'], treatAsLowerCategory: true } },
  'halfling-weapon-familiarity': { weaponFamiliarity: { weapons: ['sling', 'shortsword'], traits: ['halfling'], treatAsLowerCategory: true } },
  'orc-weapon-familiarity': { weaponFamiliarity: { weapons: ['falchion', 'greataxe'], traits: ['orc'], treatAsLowerCategory: true } },
  'athamaru-weapon-familiarity': { weaponFamiliarity: { weapons: ['crossbow', 'heavy-crossbow', 'longspear', 'spear', 'trident'], traits: ['athamaru'], treatAsLowerCategory: true } },
  'merfolk-weapon-familiarity': { weaponFamiliarity: { weapons: ['crossbow', 'heavy-crossbow', 'longspear', 'spear', 'trident'], traits: ['merfolk'], treatAsLowerCategory: true } },
  'minotaur-weapon-familiarity': { weaponFamiliarity: { weapons: ['battle-axe', 'falchion', 'glaive', 'greataxe'], treatAsLowerCategory: true } },
  /*
   * ⚠ `{item|flags.system.rulesSelections.weapon}` is a PLACEHOLDER, not a typo — it stands for the
   * player's own pick, *"one additional common weapon of your choice from the axe or hammer group"*.
   * Resolved at read time by `resolveWeaponPlaceholders` in derive.ts. Do NOT strip it: removing it
   * silently drops the chosen weapon from the familiarity, and the sibling `{actor|…}` form is pinned
   * by test/gird-champion.test.ts for exactly that reason.
   */
  'surki-weapon-familiarity': { weaponFamiliarity: { weapons: ['{item|flags.system.rulesSelections.weapon}', 'light-hammer', 'sickle', 'scythe'], treatAsLowerCategory: true } },
  'catfolk-weapon-familiarity': { weaponFamiliarity: { weapons: ['kama', 'kukri', 'scimitar', 'sickle'], traits: ['catfolk'], treatAsLowerCategory: true } },
  'hobgoblin-weapon-familiarity': { weaponFamiliarity: { weapons: ['composite-longbow', 'longbow', 'composite-shortbow', 'shortbow', 'glaive', 'longsword'], traits: ['hobgoblin'], treatAsLowerCategory: true } },
  'kholo-weapon-familiarity': { weaponFamiliarity: { weapons: ['flail', 'khopesh', 'mambele', 'war-flail'], traits: ['kholo'], treatAsLowerCategory: true } },
  'kobold-weapon-familiarity': { weaponFamiliarity: { weapons: ['greatpick', 'light-pick', 'pick'], traits: ['kobold'], treatAsLowerCategory: true } },
  // ⚠ `khakkara` and `wakazashi` were both DEAD IDS — the shipped items are `khakkhara` and `wakizashi`.
  // Two of the four weapons this feat names got no familiarity and no critical specialization, silently,
  // because a weaponFamiliarity list is never checked against core.items. Found by comparing the list to
  // Wanderer's Guide's, which spells both correctly. A guard now fails on any unknown weapon id.
  'tengu-weapon-familiarity': { weaponFamiliarity: { weapons: ['katana', 'khakkhara', 'temple-sword', 'wakizashi'], traits: ['tengu'], treatAsLowerCategory: true } },
  /* PC2 p.38 prints *"the blowgun, dart, hatchet, scythe, and shortbow"* — five weapons, no composite
   * shortbow. The composite was the LEGACY (Grippli Weapon Familiarity) member; the remaster record is
   * the one we ship, so it lists exactly the remaster five plus the tripkee trait. */
  'tripkee-weapon-familiarity': { weaponFamiliarity: { weapons: ['hatchet', 'scythe', 'shortbow', 'blowgun', 'dart'], traits: ['tripkee'], treatAsLowerCategory: true } },
  'duskwalker-weapon-familiarity': { weaponFamiliarity: { weapons: ['bo-staff', 'staff', 'scythe', 'longbow', 'composite-longbow'], treatAsLowerCategory: true } },
  'performative-weapons-training': { weaponFamiliarity: { weapons: ['bo-staff', 'dueling-cape', 'spiked-chain', 'sword-cane', 'trident', 'war-flail', 'whip'], treatAsLowerCategory: true } },
  /* *"...or have the TWO-HAND trait."* All six spellings the item data uses for it, which is also the
   * record's own `critSpecWeapons.traits` list - the two halves are supposed to be derived from one
   * another (see the note above) and had drifted apart by 'two-hand' and 'two-hand-d4'. Wanderer's
   * Guide names the same six (their trait ids 2528, 2750, 2749, 1831, 1644, 1597). */
  'mauler-dedication': { weaponFamiliarity: { weapons: [], traits: ['two-hand', 'two-hand-d4', 'two-hand-d6', 'two-hand-d8', 'two-hand-d10', 'two-hand-d12'], treatAsLowerCategory: true } },
  'pirate-combat-training': { weaponFamiliarity: { weapons: ['hatchet', 'rapier', 'scimitar', 'whip'], treatAsLowerCategory: true } },
  'viking-weapon-familiarity': { weaponFamiliarity: { weapons: ['battle-axe', 'hatchet', 'longsword', 'shield-boss', 'shield-spikes', 'shortsword'], treatAsLowerCategory: true } },
  'oni-weapon-familiarity': { weaponFamiliarity: { weapons: ['khakkhara', 'nodachi', 'ogre-hook', 'tetsubo'], treatAsLowerCategory: true } },
  /*
   * ⚠ Both entries are PLACEHOLDERS for the record's own two-pick choice (`choice.flag`
   * 'samsaranWeapon', `picks: 2`), *"Choose two weapons with an ancestry trait from two different
   * common humanoid ancestries"*. Resolved at read time — do NOT strip them.
   */
  'samsaran-weapon-memory': { weaponFamiliarity: { weapons: ['{item|flags.system.rulesSelections.weaponOne}', '{item|flags.system.rulesSelections.weaponTwo}'], treatAsLowerCategory: true } },
  /* ⚠ The KRIS was missing — *"You gain access to and familiarity with the blowgun, fighting fan,
   * kris, longspear, machete, sai, and trident."* Seven weapons printed, six authored, and the one
   * dropped is the only one of the seven that is actually Wayang. */
  'wayang-weapon-familiarity': { weaponFamiliarity: { weapons: ['blowgun', 'fighting-fan', 'kris', 'longspear', 'machete', 'sai', 'trident'], treatAsLowerCategory: true } },
  'aristocratic-arms': { weaponFamiliarity: { weapons: [], traits: ['disarm', 'parry'], treatAsLowerCategory: true } },

  /* ── archetype weapon familiarity: the category remap ──────────────────────────────────── */
  'archer-dedication': { weaponFamiliarity: [{ weapons: [], groups: ['bow', 'crossbow'], category: 'martial', mirrorCategory: 'simple' }, { weapons: [], groups: ['bow', 'crossbow'], category: 'advanced', mirrorCategory: 'martial' }] },
  /* weaponFamiliarity MERGED in, not added as a second entry. FEAT_GRANTS is a shallow spread
   * (featGrants.ts:578-582), so this lane entry — carrying weaponFamiliarity ALONE — REPLACED the whole
   * skill grant featGrantsAuto.ts:37 holds for this id. Measured through buildCharacter(), not read off
   * the table: a level-2 fighter taking this dedication with the Acrobatics slot answered came out
   * UNTRAINED in both options. Same one-entry shape as avenging-runelord-dedication above.
   *
   * The Acrobatics/Athletics slot is `conditionalRank`, not `redundantFallback`: the text pays *"if you
   * were already trained in that skill, you become an EXPERT instead"* — payoff (b) in
   * scripts/skill-clause-check.mjs — and WG's REMASTER record encodes the same test,
   * `IF SKILL_x GREATER_THAN_OR_EQUALS T THEN E ELSE T`, which is what `maxRank(cur, base) === cur`
   * evaluates. (Their legacy record uses `EQUALS T`; ours is the remastered Battlecry! printing.)
   *
   * ⚠ The record-wide `redundantFallback` the auto entry carries was NOT dead — do not repeat that
   * reading. The slot reader is `slot.redundantFallback ?? g.redundantFallback` (build.ts ~4433), and
   * build.ts's own warning above it names Aldori Duelist among the records the record-wide flag
   * cascades into; only the STATIC-skills reader (build.ts:4339) carries the `lore:` exclusion. It is
   * dropped here because it pays the wrong thing, not because nothing read it.
   *
   * `skills: { 'lore:dueling': 'trained' }` duplicates what the granted Additional Lore already
   * delivers (FEAT_GRANT_BOUND_CHOICE, featFeatGrants.ts:206) and is kept only to match the five
   * sibling granters that also carry it; measured idempotent — the 3rd/7th/15th ladder still wins. */
  'aldori-duelist-dedication': { skills: { 'lore:dueling': 'trained' }, skillChoices: [{ options: ['acrobatics', 'athletics'], rank: 'trained', conditionalRank: { base: 'trained', upgraded: 'expert' } }], weaponFamiliarity: { weapons: ['aldori-dueling-sword'], mirrorCategory: 'martial' } },
  'sister-of-the-golden-erinys-dedication': { weaponFamiliarity: { weapons: ['asp-coil', 'scourge'], mirrorCategory: 'simple' } },
  'centaur-weapon-familiarity': { weaponFamiliarity: { weapons: ['lance', 'longbow', 'longspear', 'shortbow', 'spear'], treatAsLowerCategory: true } },
  'aquatic-elf-warrior': { weaponFamiliarity: { weapons: ['crossbow', 'heavy-crossbow', 'dagger', 'longspear', 'spear', 'trident'], treatAsLowerCategory: true } }

};
