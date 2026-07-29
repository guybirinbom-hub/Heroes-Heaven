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
};
