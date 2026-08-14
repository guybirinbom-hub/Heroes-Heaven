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
  'different-worlds': {"loreChoices":1},
  'know-the-beat': {"skillChoices":[{"options":["lore:guild","lore:legal","lore:mercantile","lore:underworld"],"rank":"trained"}]},
  'ghost-hunter-dedication': {"skillChoices":[{"options":["lore:spirit","lore:haunt"],"rank":"trained"}]},
  'ancestral-insight': {"skills":{"lore:alghollthu":"trained","lore:azlanti":"trained"}},
  'free-heart': {"skillChoices":[{"options":"any","rank":"trained"}],"loreChoices":1},
  'ironclad-fortitude': {"save":{"fortitude":"master"}},
  'diverse-weapon-expert': {"weapon":{"simple":"expert","martial":"expert","advanced":"trained"}},
  'master-spotter-ranger': {"perception":"master"},
  'juggernauts-fortitude': {"save":{"fortitude":"master"}},
  'evasiveness': {"save":{"reflex":"master"}},
  'gladiator-dedication': {"skills":{"lore:gladiatorial":"trained"}},
  'master-spotter': {"perception":"master"},
  'molten-wit': {"skillChoices":[{"options":["deception","diplomacy"],"rank":"trained"}]},
  'gildedsoul': {"skillChoices":[{"options":["diplomacy","society"],"rank":"trained"}]},
  'hold-mark': {"skillChoices":[{"options":["diplomacy","survival","religion","intimidation"],"rank":"trained"}]},
  'oatia-skysage-dedication': {"skillChoices":[{"options":["lore:astronomy","occultism"],"rank":"trained"}]},
  /* weaponFamiliarity MERGED in, not added as a second entry: "you have familiarity with weapons in
   * the polearm and spear weapon groups — martial as simple, advanced as martial". Two clauses because
   * a group rule carries one rank, so each step narrows the same groups by `category`. */
  'avenging-runelord-dedication': { skills: { arcana: 'trained' }, rankUpgrade: [{ level: 14, rank: 'expert' }, { level: 16, rank: 'master' }], weaponFamiliarity: [{ weapons: [], groups: ['polearm', 'spear'], category: 'martial', mirrorCategory: 'simple' }, { weapons: [], groups: ['polearm', 'spear'], category: 'advanced', mirrorCategory: 'martial' }] },
  'magical-knowledge': {"skillChoices":[{"options":["arcana","nature","occultism","religion"],"rank":"master"},{"options":["arcana","nature","occultism","religion"],"rank":"expert"}]},
  'resolute': {"save":{"will":"master"}},
  'master-spotter-investigator': {"perception":"master"},
  // Ancestry weapon familiarity: named weapons, not a whole category. All ten ids verified in core.json.
  'vanara-weapon-familiarity': { weaponFamiliarity: { weapons: ['bo-staff', 'chakram', 'katar', 'panabas', 'urumi'], rank: 'trained' } },
  'vishkanya-weapon-familiarity': { weaponFamiliarity: { weapons: ['blowgun', 'fighting-fan', 'kris', 'kukri', 'shuriken'], rank: 'trained' } },







  // ---- full feat audit (scripts/apply-feat-audit.mjs) ----
  // 10 entries. The judge said "no lane exists"; the adversary found the lane.
  'crescent-cross-training': {"weaponFamiliarity":{"weapons":["crescent-cross","crescent-cross-melee","crescent-cross-ranged"],"mirrorCategory":"simple"}},
  'eagle-eye': {"perception":"master"},
  'jotunborn-weapon-familiarity': {"weaponFamiliarity":{"weapons":["bola","greataxe","halberd","maul","war-flail"],"mirrorCategory":"simple"}},
  'knight-in-shining-armor': {"armor":{"heavy":"expert"}},
  'knight-vigilant': {"skills":{"religion":"expert"}},
  'legions-aim': {"weaponFamiliarity":{"weapons":["acid-flask-greater","acid-flask-lesser","acid-flask-major","acid-flask-moderate","alchemists-fire-greater","alchemists-fire-lesser","alchemists-fire-major","alchemists-fire-moderate","alicorn-trigger","arboreals-revenge","arquebus","atrophy-bomb-greater","atrophy-bomb-lesser","atrophy-bomb-major","atrophy-bomb-moderate","axe-musket","axe-musket-ranged","big-boom-gun","bioluminescence-bomb","black-king","black-powder-knuckle-dusters","black-powder-knuckle-dusters-ranged","blade-of-fallen-stars","blasting-stone-greater","blasting-stone-lesser","blasting-stone-major","blasting-stone-moderate","blight-bomb-greater","blight-bomb-lesser","blight-bomb-major","blight-bomb-moderate","blightburn-bomb","blightburn-bomb-greater","blood-bomb-greater","blood-bomb-lesser","blood-bomb-major","blood-bomb-moderate","blunderbuss","boastful-hunter","bottled-lightning-greater","bottled-lightning-lesser","bottled-lightning-major","bottled-lightning-moderate","bottled-sunlight-greater","bottled-sunlight-lesser","bottled-sunlight-major","bottled-sunlight-moderate","boulder-seed","boulder-seed-greater","breath-blaster","breath-blaster-greater","breath-blaster-major","cane-pistol","cane-pistol-ranged","clan-pistol","coldstar-pistols","crystal-shards-greater","crystal-shards-major","crystal-shards-moderate","dagger-pistol","dagger-pistol-ranged","dawnsilver-tree","defoliation-bomb-greater","defoliation-bomb-lesser","defoliation-bomb-major","defoliation-bomb-moderate","double-barreled-musket","double-barreled-pistol","dragon-mouth-pistol","drake-rifle-acid","drake-rifle-cold","drake-rifle-electricity","drake-rifle-fire","drake-rifle-poison","dread-ampoule-greater","dread-ampoule-lesser","dread-ampoule-major","dread-ampoule-moderate","dueling-pistol","durian-bomb-greater","durian-bomb-lesser","durian-bomb-major","durian-bomb-moderate","dwarven-daisy-lesser","dwarven-daisy-moderate","frost-vial-greater","frost-vial-lesser","frost-vial-major","frost-vial-moderate","fulmination-fang","ghost-charge-greater","ghost-charge-lesser","ghost-charge-major","ghost-charge-moderate","glue-bomb-greater","glue-bomb-lesser","glue-bomb-major","glue-bomb-moderate","gnome-amalgam-musket","gnome-amalgam-musket-ranged","goo-grenade-greater","goo-grenade-lesser","goo-grenade-major","goo-grenade-moderate","gun-sword","gun-sword-ranged","hammer-gun","hammer-gun-ranged","harmona-gun","hex-blaster","howler-pistol","immolation-clan-pistol","inflammation-flask-greater","inflammation-flask-lesser","inflammation-flask-major","inflammation-flask-moderate","iris-of-the-sky","jax","jezail","junk-bomb-greater","junk-bomb-lesser","junk-bomb-major","junk-bomb-moderate","leydroth-spellbreaker","liars-gun","lodestone-bomb","lodestone-bomb-greater","mace-multipistol","mace-multipistol-ranged","mindlance","mud-bomb-greater","mud-bomb-lesser","mud-bomb-major","mud-bomb-moderate","nail-bomb-greater","nail-bomb-lesser","nail-bomb-major","nail-bomb-moderate","necrotic-bomb-greater","necrotic-bomb-lesser","necrotic-bomb-major","necrotic-bomb-moderate","nightmares-lament","obsidian-edge","obsidian-edge-greater","obsidian-edge-major","obsidian-edge-true","pact-bound-pistol","pepperbox","pernicious-spore-bomb-greater","pernicious-spore-bomb-lesser","pernicious-spore-bomb-major","pernicious-spore-bomb-moderate","peshpine-grenade-greater","peshpine-grenade-lesser","peshpine-grenade-major","peshpine-grenade-moderate","petrification-cannon","piercing-wind","piercing-wind-ranged","pressure-bomb-greater","pressure-bomb-lesser","pressure-bomb-major","pressure-bomb-moderate","rapier-pistol","rapier-pistol-ranged","reapers-grasp","redeemers-pistol","redpitch-bomb-greater","redpitch-bomb-lesser","redpitch-bomb-major","redpitch-bomb-moderate","scarlet-queen","screech-shooter","screech-shooter-greater","screech-shooter-major","shatterstone","shatterstone-greater","shobhad-longrifle","silver-orb-greater","silver-orb-lesser","silver-orb-powder","silverscrap-bomb-greater","silverscrap-bomb-lesser","silverscrap-bomb-moderate","silversoul-bomb","silversoul-bomb-greater","silversoul-bomb-major","skunk-bomb-greater","skunk-bomb-lesser","skunk-bomb-major","skunk-bomb-moderate","slide-pistol","spark-dancer","spellsap-grenade","spellsap-grenade-greater","spider-gun","spider-gun-greater","spider-gun-major","spider-satchel-greater","spider-satchel-lesser","spider-satchel-major","spider-satchel-moderate","spike-launcher","spoon-gun","star-grenade-greater","star-grenade-lesser","star-grenade-major","star-grenade-moderate","steelscour-greater","steelscour-lesser","steelscour-major","steelscour-moderate","sticky-algae-bomb-greater","sticky-algae-bomb-lesser","sticky-algae-bomb-major","sticky-algae-bomb-moderate","sulfur-bomb-greater","sulfur-bomb-lesser","sulfur-bomb-major","sulfur-bomb-moderate","sunken-pistol","tallow-bomb-greater","tallow-bomb-lesser","tallow-bomb-major","tallow-bomb-moderate","tenderizer-grenade-greater","tenderizer-grenade-lesser","tenderizer-grenade-major","tenderizer-grenade-moderate","tentacle-cannon","tentacle-cannon-greater","tentacle-cannon-major","three-peaked-tree","three-peaked-tree-ranged","thundercrasher","tigers-claw","triggerbrand","triggerbrand-ranged","trueshape-bomb","trueshape-bomb-greater","twigjack-sack-greater","twigjack-sack-lesser","twigjack-sack-major","twigjack-sack-moderate","versatile-vial","vexing-vapor-greater","vexing-vapor-lesser","vexing-vapor-major","vexing-vapor-moderate","water-bomb-greater","water-bomb-lesser","water-bomb-major","water-bomb-moderate"],"mirrorCategory":"simple"}},
  'marine-combat-training': {"weaponFamiliarity":{"weapons":["harpoon","trident"],"mirrorCategory":"simple"}},
  'performance-weapon-expert': {"weapon":{"simple":"expert","martial":"expert"}},
  'signifer-armor-expertise': {"armor":{"medium":"expert","heavy":"expert"}},
  'tools-of-the-trade': {"weaponFamiliarity":{"weapons":["bola","sap","whip"],"mirrorCategory":"simple"}},

/* ── ancestry weapon familiarity: the category remap ─────────────────────────────────────── */
  /* Derived from each record's own `critSpecWeapons` by scripts/apply-weapon-familiarity.mjs, so the
   * weapons this feat covers and the weapons it crit-specialises can never disagree. The printed
   * clause is "treat any of these that are martial weapons as simple weapons and any that are
   * advanced weapons as martial weapons" — per-weapon, which is what `treatAsLowerCategory` says. */
  'dwarven-weapon-familiarity': { weaponFamiliarity: { weapons: ['battle-axe', 'pick', 'warhammer'], traits: ['dwarf'], treatAsLowerCategory: true } },
  'elven-weapon-familiarity': { weaponFamiliarity: { weapons: ['longbow', 'rapier', 'shortbow'], traits: ['elf'], treatAsLowerCategory: true } },
  'gnome-weapon-familiarity': { weaponFamiliarity: { weapons: ['glaive', 'kukri'], traits: ['gnome'], treatAsLowerCategory: true } },
  'goblin-weapon-familiarity': { weaponFamiliarity: { weapons: [], traits: ['goblin'], treatAsLowerCategory: true } },
  'halfling-weapon-familiarity': { weaponFamiliarity: { weapons: ['sling', 'shortsword'], traits: ['halfling'], treatAsLowerCategory: true } },
  'orc-weapon-familiarity': { weaponFamiliarity: { weapons: ['falchion', 'greataxe'], traits: ['orc'], treatAsLowerCategory: true } },
  'athamaru-weapon-familiarity': { weaponFamiliarity: { weapons: ['crossbow', 'heavy-crossbow', 'longspear', 'spear', 'trident'], traits: ['athamaru'], treatAsLowerCategory: true } },
  'merfolk-weapon-familiarity': { weaponFamiliarity: { weapons: ['crossbow', 'heavy-crossbow', 'longspear', 'spear', 'trident'], traits: ['merfolk'], treatAsLowerCategory: true } },
  'minotaur-weapon-familiarity': { weaponFamiliarity: { weapons: ['battle-axe', 'falchion', 'glaive', 'greataxe'], treatAsLowerCategory: true } },
  'surki-weapon-familiarity': { weaponFamiliarity: { weapons: ['{item|flags.system.rulesSelections.weapon}', 'light-hammer', 'sickle', 'scythe'], treatAsLowerCategory: true } },
  'catfolk-weapon-familiarity': { weaponFamiliarity: { weapons: ['kama', 'kukri', 'scimitar', 'sickle'], traits: ['catfolk'], treatAsLowerCategory: true } },
  'hobgoblin-weapon-familiarity': { weaponFamiliarity: { weapons: ['composite-longbow', 'longbow', 'composite-shortbow', 'shortbow', 'glaive', 'longsword'], traits: ['hobgoblin'], treatAsLowerCategory: true } },
  'kholo-weapon-familiarity': { weaponFamiliarity: { weapons: ['flail', 'khopesh', 'mambele', 'war-flail'], traits: ['kholo'], treatAsLowerCategory: true } },
  'kobold-weapon-familiarity': { weaponFamiliarity: { weapons: ['greatpick', 'light-pick', 'pick'], traits: ['kobold'], treatAsLowerCategory: true } },
  'tengu-weapon-familiarity': { weaponFamiliarity: { weapons: ['katana', 'khakkara', 'temple-sword', 'wakazashi'], traits: ['tengu'], treatAsLowerCategory: true } },
  'tripkee-weapon-familiarity': { weaponFamiliarity: { weapons: ['hatchet', 'scythe', 'shortbow', 'composite-shortbow', 'blowgun', 'dart'], traits: ['tripkee'], treatAsLowerCategory: true } },
  'duskwalker-weapon-familiarity': { weaponFamiliarity: { weapons: ['bo-staff', 'staff', 'scythe', 'longbow', 'composite-longbow'], treatAsLowerCategory: true } },
  'performative-weapons-training': { weaponFamiliarity: { weapons: ['bo-staff', 'dueling-cape', 'spiked-chain', 'sword-cane', 'trident', 'war-flail', 'whip'], treatAsLowerCategory: true } },
  'mauler-dedication': { weaponFamiliarity: { weapons: [], traits: ['two-hand-d6', 'two-hand-d8', 'two-hand-d10', 'two-hand-d12'], treatAsLowerCategory: true } },
  'pirate-combat-training': { weaponFamiliarity: { weapons: ['hatchet', 'rapier', 'scimitar', 'whip'], treatAsLowerCategory: true } },
  'viking-weapon-familiarity': { weaponFamiliarity: { weapons: ['battle-axe', 'hatchet', 'longsword', 'shield-boss', 'shield-spikes', 'shortsword'], treatAsLowerCategory: true } },
  'oni-weapon-familiarity': { weaponFamiliarity: { weapons: ['khakkhara', 'nodachi', 'ogre-hook', 'tetsubo'], treatAsLowerCategory: true } },
  'samsaran-weapon-memory': { weaponFamiliarity: { weapons: ['{item|flags.system.rulesSelections.weaponOne}', '{item|flags.system.rulesSelections.weaponTwo}'], treatAsLowerCategory: true } },
  'wayang-weapon-familiarity': { weaponFamiliarity: { weapons: ['blowgun', 'fighting-fan', 'longspear', 'machete', 'sai', 'trident'], treatAsLowerCategory: true } },
  'aristocratic-arms': { weaponFamiliarity: { weapons: [], traits: ['disarm', 'parry'], treatAsLowerCategory: true } },

/* ── archetype weapon familiarity: the category remap ──────────────────────────────────── */
  'archer-dedication': { weaponFamiliarity: [{ weapons: [], groups: ['bow', 'crossbow'], category: 'martial', mirrorCategory: 'simple' }, { weapons: [], groups: ['bow', 'crossbow'], category: 'advanced', mirrorCategory: 'martial' }] },
  'aldori-duelist-dedication': { weaponFamiliarity: { weapons: ['aldori-dueling-sword'], mirrorCategory: 'martial' } },
  'sister-of-the-golden-erinys-dedication': { weaponFamiliarity: { weapons: ['asp-coil', 'scourge'], mirrorCategory: 'simple' } },
  'centaur-weapon-familiarity': { weaponFamiliarity: { weapons: ['lance', 'longbow', 'longspear', 'shortbow', 'spear'], treatAsLowerCategory: true } },
  'aquatic-elf-warrior': { weaponFamiliarity: { weapons: ['crossbow', 'heavy-crossbow', 'dagger', 'longspear', 'spear', 'trident'], treatAsLowerCategory: true } },
};
