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
  'avenging-runelord-dedication': {"skills":{"arcana":"trained"},"rankUpgrade":[{"level":14,"rank":"expert"},{"level":16,"rank":"master"}]},
  'magical-knowledge': {"skillChoices":[{"options":["arcana","nature","occultism","religion"],"rank":"master"},{"options":["arcana","nature","occultism","religion"],"rank":"expert"}]},
  'resolute': {"save":{"will":"master"}},
  'master-spotter-investigator': {"perception":"master"},
  // Ancestry weapon familiarity: named weapons, not a whole category. All ten ids verified in core.json.
  'vanara-weapon-familiarity': { weaponFamiliarity: { weapons: ['bo-staff', 'chakram', 'katar', 'panabas', 'urumi'], rank: 'trained' } },
  'vishkanya-weapon-familiarity': { weaponFamiliarity: { weapons: ['blowgun', 'fighting-fan', 'kris', 'kukri', 'shuriken'], rank: 'trained' } },



  // ---- full feat audit (scripts/apply-feat-audit.mjs) ----
  // 7 entries. The judge said "no lane exists"; the adversary found the lane.
  'crescent-cross-training': {"weaponFamiliarity":{"weapons":["crescent-cross","crescent-cross-melee","crescent-cross-ranged"],"mirrorCategory":"simple"}},
  'eagle-eye': {"perception":"master"},
  'jotunborn-weapon-familiarity': {"weaponFamiliarity":{"weapons":["bola","greataxe","halberd","maul","war-flail"],"mirrorCategory":"simple"}},
  'knight-in-shining-armor': {"armor":{"heavy":"expert"}},
  'knight-vigilant': {"skills":{"religion":"expert"}},
  'legions-aim': {"weaponFamiliarity":{"weapons":["acid-flask-greater","acid-flask-lesser","acid-flask-major","acid-flask-moderate","alchemists-fire-greater","alchemists-fire-lesser","alchemists-fire-major","alchemists-fire-moderate","alicorn-trigger","arboreals-revenge","arquebus","atrophy-bomb-greater","atrophy-bomb-lesser","atrophy-bomb-major","atrophy-bomb-moderate","axe-musket","axe-musket-ranged","big-boom-gun","bioluminescence-bomb","black-king","black-powder-knuckle-dusters","black-powder-knuckle-dusters-ranged","blade-of-fallen-stars","blasting-stone-greater","blasting-stone-lesser","blasting-stone-major","blasting-stone-moderate","blight-bomb-greater","blight-bomb-lesser","blight-bomb-major","blight-bomb-moderate","blightburn-bomb","blightburn-bomb-greater","blood-bomb-greater","blood-bomb-lesser","blood-bomb-major","blood-bomb-moderate","blunderbuss","boastful-hunter","bottled-lightning-greater","bottled-lightning-lesser","bottled-lightning-major","bottled-lightning-moderate","bottled-sunlight-greater","bottled-sunlight-lesser","bottled-sunlight-major","bottled-sunlight-moderate","boulder-seed","boulder-seed-greater","breath-blaster","breath-blaster-greater","breath-blaster-major","cane-pistol","cane-pistol-ranged","clan-pistol","coldstar-pistols","crystal-shards-greater","crystal-shards-major","crystal-shards-moderate","dagger-pistol","dagger-pistol-ranged","dawnsilver-tree","defoliation-bomb-greater","defoliation-bomb-lesser","defoliation-bomb-major","defoliation-bomb-moderate","double-barreled-musket","double-barreled-pistol","dragon-mouth-pistol","drake-rifle-acid","drake-rifle-cold","drake-rifle-electricity","drake-rifle-fire","drake-rifle-poison","dread-ampoule-greater","dread-ampoule-lesser","dread-ampoule-major","dread-ampoule-moderate","dueling-pistol","durian-bomb-greater","durian-bomb-lesser","durian-bomb-major","durian-bomb-moderate","dwarven-daisy-lesser","dwarven-daisy-moderate","frost-vial-greater","frost-vial-lesser","frost-vial-major","frost-vial-moderate","fulmination-fang","ghost-charge-greater","ghost-charge-lesser","ghost-charge-major","ghost-charge-moderate","glue-bomb-greater","glue-bomb-lesser","glue-bomb-major","glue-bomb-moderate","gnome-amalgam-musket","gnome-amalgam-musket-ranged","goo-grenade-greater","goo-grenade-lesser","goo-grenade-major","goo-grenade-moderate","gun-sword","gun-sword-ranged","hammer-gun","hammer-gun-ranged","harmona-gun","hex-blaster","howler-pistol","immolation-clan-pistol","inflammation-flask-greater","inflammation-flask-lesser","inflammation-flask-major","inflammation-flask-moderate","iris-of-the-sky","jax","jezail","junk-bomb-greater","junk-bomb-lesser","junk-bomb-major","junk-bomb-moderate","leydroth-spellbreaker","liars-gun","lodestone-bomb","lodestone-bomb-greater","mace-multipistol","mace-multipistol-ranged","mindlance","mud-bomb-greater","mud-bomb-lesser","mud-bomb-major","mud-bomb-moderate","nail-bomb-greater","nail-bomb-lesser","nail-bomb-major","nail-bomb-moderate","necrotic-bomb-greater","necrotic-bomb-lesser","necrotic-bomb-major","necrotic-bomb-moderate","nightmares-lament","obsidian-edge","obsidian-edge-greater","obsidian-edge-major","obsidian-edge-true","pact-bound-pistol","pepperbox","pernicious-spore-bomb-greater","pernicious-spore-bomb-lesser","pernicious-spore-bomb-major","pernicious-spore-bomb-moderate","peshpine-grenade-greater","peshpine-grenade-lesser","peshpine-grenade-major","peshpine-grenade-moderate","petrification-cannon","piercing-wind","piercing-wind-ranged","pressure-bomb-greater","pressure-bomb-lesser","pressure-bomb-major","pressure-bomb-moderate","rapier-pistol","rapier-pistol-ranged","reapers-grasp","redeemers-pistol","redpitch-bomb-greater","redpitch-bomb-lesser","redpitch-bomb-major","redpitch-bomb-moderate","scarlet-queen","screech-shooter","screech-shooter-greater","screech-shooter-major","shatterstone","shatterstone-greater","shobhad-longrifle","silver-orb-greater","silver-orb-lesser","silver-orb-powder","silverscrap-bomb-greater","silverscrap-bomb-lesser","silverscrap-bomb-moderate","silversoul-bomb","silversoul-bomb-greater","silversoul-bomb-major","skunk-bomb-greater","skunk-bomb-lesser","skunk-bomb-major","skunk-bomb-moderate","slide-pistol","spark-dancer","spellsap-grenade","spellsap-grenade-greater","spider-gun","spider-gun-greater","spider-gun-major","spider-satchel-greater","spider-satchel-lesser","spider-satchel-major","spider-satchel-moderate","spike-launcher","spoon-gun","star-grenade-greater","star-grenade-lesser","star-grenade-major","star-grenade-moderate","steelscour-greater","steelscour-lesser","steelscour-major","steelscour-moderate","sticky-algae-bomb-greater","sticky-algae-bomb-lesser","sticky-algae-bomb-major","sticky-algae-bomb-moderate","sulfur-bomb-greater","sulfur-bomb-lesser","sulfur-bomb-major","sulfur-bomb-moderate","sunken-pistol","tallow-bomb-greater","tallow-bomb-lesser","tallow-bomb-major","tallow-bomb-moderate","tenderizer-grenade-greater","tenderizer-grenade-lesser","tenderizer-grenade-major","tenderizer-grenade-moderate","tentacle-cannon","tentacle-cannon-greater","tentacle-cannon-major","three-peaked-tree","three-peaked-tree-ranged","thundercrasher","tigers-claw","triggerbrand","triggerbrand-ranged","trueshape-bomb","trueshape-bomb-greater","twigjack-sack-greater","twigjack-sack-lesser","twigjack-sack-major","twigjack-sack-moderate","versatile-vial","vexing-vapor-greater","vexing-vapor-lesser","vexing-vapor-major","vexing-vapor-moderate","water-bomb-greater","water-bomb-lesser","water-bomb-major","water-bomb-moderate"],"mirrorCategory":"simple"}},
  'marine-combat-training': {"weaponFamiliarity":{"weapons":["harpoon","trident"],"mirrorCategory":"simple"}},
};
