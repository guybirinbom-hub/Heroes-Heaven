/*
 * Feats/features that GRANT a companion, familiar, or pet.
 *
 * Many feats give the character a companion the build engine never modeled — the Pet general feat
 * ("You have a pet — a Tiny animal…") and everything that keys off it. Foundry represents the Pet as
 * a familiar with 2 abilities (`ActiveEffectLike system.attributes.familiarAbilities.value = 2`), and
 * a companion granted by a feat should behave exactly like one added by hand: a configurable card in
 * the Companions tab with the familiar-ability picker.
 *
 * This table maps a granting feat's core.json id → what companion it grants. The Companions tab turns
 * each into a SYNTHETIC companion (materialized on first edit, mirroring the summoner's auto-eidolon),
 * so the grant actually affects the character. Hand-authored, like FEAT_GRANTS; extend as the
 * migration mechanizes the ~109 companion-granting feats/features.
 */
import type { AbilityId, CompanionKind, ProficiencyRank, SkillId } from './types';
import type { Maturity } from './companions';

export interface CompanionGrant {
  /** What kind of companion the feat grants (usually 'familiar' — the Pet is a familiar). */
  kind: CompanionKind;
  /** Short display label for the granted companion (shown before the player names it). */
  label: string;
  /** Familiar: how many familiar abilities the player chooses (a display hint — the picker itself is
   *  not hard-capped, matching how a class/feat can raise the count). */
  abilityBudget?: number;
  /** Familiar-ability ids that are ALWAYS present (locked), on top of the chosen ones — e.g. Friend
   *  of the Sea's pet always has Darkvision + Tough. */
  lockedAbilities?: string[];
  /** A rules note shown on the companion card (restrictions, what the player still chooses). */
  note?: string;
  /** Other grant-feat slugs this grant REPLACES, so overlapping grants surface a single companion
   *  (Friend of the Sea itself grants the Pet feat — it supersedes the plain `pet` grant). */
  supersedes?: string[];
}

// Authored from a classify-and-adversarially-verify pass over all 363 companion-related feats/features
// (Foundry rule elements + AoN text as evidence). Only "grant-new" survived — feats that CREATE a
// companion the app doesn't otherwise auto-provide. Advancement/interaction feats (Mature/Incredible
// Companion, Enhanced Familiar, eidolon evolutions, Heal Companion…) are intentionally excluded — the
// existing Companions UI handles them. Summoner eidolons are excluded (auto-provided already). Two
// ambiguous grants were held back for a distinct model: `necrologist-dedication` (an activity-summoned
// undead HORDE, not one persistent companion) and `moray-eel-mount` (a Bonded-Animal minion, weaker
// than a companion). `abilityBudget` is a display hint (the picker isn't hard-capped).
export const FEAT_COMPANION_GRANTS: Record<string, CompanionGrant> = {
  "enhanced-psychopomp-familiar": {"kind":"familiar","label":"Enhanced Psychopomp Familiar","abilityBudget":4,"lockedAbilities":["speech"],"supersedes":["psychopomp-familiar"],"note":"Choose 4 familiar or master abilities each day. It always has Speech. Two of the four must come from the Psychopomp Familiar list (Soul Sight, Spirit Touch) or Augury (8th level or higher)."},
  'additional-companion': { kind: 'animal', label: 'Additional Companion', note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'alchemical-familiar': { kind: 'familiar', label: 'Alchemical Familiar', abilityBudget: 2, lockedAbilities: ['construct', 'tough'], note: 'Grants a familiar you configure here. Choose 2 familiar abilities. It always has Construct (a construct-trait familiar; requires and includes Tough).' },
  'animal-accomplice': { kind: 'familiar', label: 'Animal Accomplice', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'animal-companion': { kind: 'animal', label: 'Animal Companion', note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'animal-companion-ranger': { kind: 'animal', label: 'Animal Companion (Ranger)', note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'animal-order': { kind: 'animal', label: 'Animal Order', supersedes: ['animal-companion'], note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'animal-trainer-dedication': { kind: 'animal', label: 'Animal Trainer Dedication', note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'apocalypse-rider-dedication': { kind: 'animal', label: 'Apocalypse Rider Dedication', note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'beastmaster-dedication': { kind: 'animal', label: 'Beastmaster Dedication', note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'cavalier-dedication': { kind: 'animal', label: 'Cavalier Dedication', note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'clockwork-reanimator-dedication': { kind: 'animal', label: 'Clockwork Reanimator Dedication', note: 'Grants a construct companion — choose its type and advance it in the Edit tab.' },
  'commanders-companion': { kind: 'animal', label: "Commander's Companion", note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'construct-innovation': { kind: 'animal', label: 'Construct Innovation', note: 'Grants a construct companion — choose its type and advance it in the Edit tab.' },
  'corgi-mount': { kind: 'familiar', label: 'Corgi Mount', abilityBudget: 2, lockedAbilities: ['scent'], note: 'Grants a familiar you configure here. Choose 2 familiar abilities. It always has Scent.' },
  'crocodiles-twin': { kind: 'familiar', label: "Crocodile's Twin", abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'cultivation-order': { kind: 'familiar', label: 'Cultivation Order', abilityBudget: 2, supersedes: ['leshy-familiar'], note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'demon-hunting-companion': { kind: 'animal', label: 'Demon-Hunting Companion', note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'draconic-familiar': { kind: 'familiar', label: 'Draconic Familiar', abilityBudget: 4, lockedAbilities: ['dragon'], note: 'Grants a familiar you configure here. Choose 4 familiar abilities. It always has Dragon.' },
  'drake-rider-dedication': { kind: 'animal', label: 'Drake Rider Dedication', note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'elemental-familiar-kineticist': { kind: 'familiar', label: 'Elemental Familiar (Kineticist)', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'elver-pet': { kind: 'familiar', label: 'Elver Pet', lockedAbilities: ['fast-movement', 'damage-avoidance'], supersedes: ['pet'], note: 'Your pet is a young eel: aquatic (breathes water, swim Speed instead of land), with Fast Movement and Damage Avoidance in place of the usual chosen pet abilities.' },
  'emissary-familiar': { kind: 'familiar', label: 'Emissary Familiar', abilityBudget: 4, note: 'Grants a familiar you configure here. Choose 4 familiar abilities.' },
  'faithful-steed': { kind: 'animal', label: 'Faithful Steed', note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'familiar': { kind: 'familiar', label: 'Familiar', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'familiar-master-dedication': { kind: 'familiar', label: 'Familiar Master Dedication', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'familiar-witch': { kind: 'familiar', label: 'Familiar (Witch)', abilityBudget: 4, note: 'Grants a familiar you configure here. Choose 4 familiar abilities.' },
  'friend-of-the-sea': { kind: 'familiar', label: 'Friend of the Sea', abilityBudget: 2, lockedAbilities: ['darkvision', 'tough'], supersedes: ['pet'], note: 'Your pet must be an aquatic creature. It has Darkvision and Tough in addition to the two familiar abilities you choose.' },
  'hyena-familiar': { kind: 'familiar', label: 'Hyena Familiar', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'improved-familiar-attunement': { kind: 'familiar', label: 'Improved Familiar Attunement', abilityBudget: 4, supersedes: ['familiar'], note: 'Grants a familiar you configure here. Choose 4 familiar abilities.' },
  'leaf-order': { kind: 'familiar', label: 'Leaf Order', abilityBudget: 2, supersedes: ['leshy-familiar'], note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'leshy-familiar': { kind: 'familiar', label: 'Leshy Familiar', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'mammoth-lord-dedication': { kind: 'animal', label: 'Mammoth Lord Dedication', note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'marine-ally': { kind: 'familiar', label: 'Marine Ally', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'mask-familiar': { kind: 'familiar', label: 'Mask Familiar', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'minuscule-mentee': { kind: 'familiar', label: 'Minuscule Mentee', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'pet': { kind: 'familiar', label: 'Pet', abilityBudget: 2, note: 'A Tiny animal (cat, bird, rodent, and so on) with the minion trait. Choose 2 familiar abilities.' },
  'pirates-pet': { kind: 'familiar', label: "Pirate's Pet", abilityBudget: 3, supersedes: ['pet'], note: 'Grants a familiar you configure here. Choose 3 familiar abilities.' },
  'prototype-companion': { kind: 'animal', label: 'Prototype Companion', note: 'Grants a construct companion — choose its type and advance it in the Edit tab.' },
  'psychopomp-familiar': { kind: 'familiar', label: 'Psychopomp Familiar', abilityBudget: 3, lockedAbilities: ['speech'], note: 'Grants a familiar you configure here. Choose 3 familiar abilities. It always has Speech.' },
  'rat-familiar': { kind: 'familiar', label: 'Rat Familiar', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'rise-my-creature': { kind: 'animal', label: 'Rise, My Creature!', note: 'Grants a construct companion — choose its type and advance it in the Edit tab.' },
  'scion-of-domora-dedication': { kind: 'familiar', label: 'Scion of Domora Dedication', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'shaman': { kind: 'familiar', label: 'Shaman', abilityBudget: 4, supersedes: ['spirit-familiar-animist'], note: 'Grants a familiar you configure here. Choose 4 familiar abilities.' },
  'spirit-companion': { kind: 'animal', label: 'Spirit Companion', note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'spirit-familiar-animist': { kind: 'familiar', label: 'Spirit Familiar (Animist)', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'spore-order': { kind: 'familiar', label: 'Spore Order', abilityBudget: 2, lockedAbilities: ['fungus'], supersedes: ['leshy-familiar'], note: 'Grants a familiar you configure here. Choose 2 familiar abilities. It always has Fungus.' },
  'star-orb': { kind: 'familiar', label: 'Star Orb', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },
  'undead-master-dedication': { kind: 'animal', label: 'Undead Master Dedication', note: 'Grants an animal companion — choose its type and advance it in the Edit tab.' },
  'witch-dedication': { kind: 'familiar', label: 'Witch Dedication', abilityBudget: 2, note: 'Grants a familiar you configure here. Choose 2 familiar abilities.' },







  // ---- full feat audit — companion grants ----
  // 3 entries. The judge said "no lane exists"; the adversary found the lane.
  'adaptive-mask-familiar': {"kind":"familiar","label":"Adaptive Mask Familiar","abilityBudget":4,"supersedes":["mask-familiar"],"note":"Your mask familiar adapts quickly to material form: select four master and familiar abilities each day instead of two."},
  'additional-follower': {"kind":"follower","label":"Additional Follower","note":"Another novice follower with the minion trait joins you. Repeatable up to four followers in total — add the further ones by hand in the Companions tab."},
  'incredible-familiar-familiar-master': {"kind":"familiar","label":"Incredible Familiar","abilityBudget":6,"supersedes":["familiar-master-dedication"],"note":"Grants a familiar you configure here. Choose 6 familiar or master abilities each day."},
};

/** The companion grants active on a character, given its taken feat ids. Deduped via `supersedes`
 *  so a character with an overlapping pair (e.g. Friend of the Sea, which grants the Pet feat) gets
 *  one companion. Returns a synthetic id per grant for the Companions tab to render + materialize. */
export function featGrantedCompanions(featIds: Set<string>): { id: string; grantSlug: string; grant: CompanionGrant }[] {
  const active = [...featIds].filter((id) => FEAT_COMPANION_GRANTS[id]);
  const superseded = new Set<string>();
  for (const id of active) for (const s of FEAT_COMPANION_GRANTS[id].supersedes ?? []) superseded.add(s);
  return active
    .filter((id) => !superseded.has(id))
    .map((id) => ({ id: `featcmp-${id}`, grantSlug: id, grant: FEAT_COMPANION_GRANTS[id] }));
}

/**
 * Feats that MODIFY an existing companion (rather than creating one) — the audit's companion-mod lane.
 * Applied by deriveCompanion when the character has the feat and the companion's kind matches. Senses
 * are display strings (matching the animal block); IWR values may be flat or "half your level".
 */
export interface CompanionMod {
  kinds: CompanionKind[];
  senses?: string[];
  maxHpBonus?: number;
  /** Fly Speed equal to the companion's land Speed (Celestial/Fiendish Mount). */
  flyEqualsLand?: boolean;
  /**
   * Extra movement the mod grants, e.g. { burrow: 5 } or { fly: "land" }. A NUMBER is feet; the string
   * "land" means "equal to its land Speed" (Airborne Form), and "land:25" caps that at 25 feet
   * (Amphibious Form). flyEqualsLand above is the older single-purpose version of { fly: "land" }.
   */
  speeds?: Record<string, number | string>;
  /** Extra IWR display lines, e.g. "weakness 10 unholy". */
  iwr?: string[];
  /** A rider on every companion Strike (Spirit-Blessed: ghost touch). */
  strikeRider?: string;
  /**
   * The companion is AT LEAST this mature (Advanced/Incredible/Paragon Companion upgrade feats). PF2e
   * writes these as "your companion becomes an advanced/paragon companion"; in this engine that IS the
   * maturity ladder, so the feat raises the floor rather than swapping to a type that doesn't exist.
   */
  maturityFloor?: Maturity;
  /** Extra ability-modifier boosts layered on top of maturity (rare upgrade riders). */
  abilityBoosts?: Partial<Record<AbilityId, number>>;
  /** Skills the mod trains on the companion (Chorus Companion → Performance; Fell Rider → Intimidation).
   *  Raises the companion's rank in that skill to at least the given rank. */
  skillGrants?: { skill: SkillId; rank: ProficiencyRank }[];
  note?: string;
}

export const COMPANION_MODS: Record<string, CompanionMod> = {
  // Coverage sweep, registry lane. "gains one specialization of your choice. Increase its
  // proficiency rank in Performance to legendary instead of one of the specialization's skill increases."
  'specialized-companion': { kinds: ['animal'], maturityFloor: 'specialized', skillGrants: [{ skill: 'performance', rank: 'legendary' }], note: "Specialized Companion: your Animal Trainer companion becomes specialized and its Performance rank rises to legendary in place of one of the specialization's skill increases." },
  // NOTE-ONLY on purpose. The text gives master Stealth only to a SPECIALIZED AMBUSHER; the app has
  // no conditional-skill lane for companions, and an unconditional skillGrant here would hand master
  // Stealth to every companion — an over-grant is worse than the gap.
  'stealthy-companion': { kinds: ['animal'], note: "Stealthy Companion: your companion gains the benefit of the Camouflage feat. If it is a specialized ambusher, its Stealth rank increases to master (legendary if it was already master) — apply that by hand, as it depends on the specialization you chose." },
  'advanced-reanimated-companion': {"kinds":["animal"],"maturityFloor":"mature","note":"Advanced Reanimated Companion: your construct companion is at least an advanced construct companion (the mature rung here) — +1 Str/Dex/Con/Wis, unarmed Strikes go from one die to two, and Perception and all saves become expert. During an encounter, even if you don't use the Command a Minion action, it can still use 1 action on your turn that round to Stride or Strike. It also becomes trained in Intimidation, Stealth, and Survival, and you may change its Size to Small, Medium, or Large (not tracked on this block)."},
  'airborne-form': {"kinds":["eidolon"],"speeds":{"fly":"land"},"note":"Airborne Form: your eidolon can fly."},
  'angel-eidolon': {"kinds":["eidolon"],"senses":["darkvision"],"note":"Hallowed Strikes: the eidolon's unarmed Strikes deal an extra 1 spirit (good) damage."},
  'anger-phantom-eidolon': {"kinds":["eidolon"],"senses":["darkvision"]},
  'animal-trainer-dedication': {"kinds":["animal"],"note":"Animal Trainer: this companion is trained in Performance instead of the skill listed for its type."},
  'aon-celestial-mount': {"kinds":["animal"],"senses":["darkvision"],"maxHpBonus":40,"flyEqualsLand":true,"iwr":["weakness 10 unholy"],"note":"Celestial Mount"},
  'aon-fiendish-mount': {"kinds":["animal"],"senses":["darkvision"],"maxHpBonus":40,"flyEqualsLand":true,"iwr":["weakness 10 holy"],"note":"Fiendish Mount"},
  'auspicious-mount': {"kinds":["animal"],"maturityFloor":"specialized","abilityBoosts":{"int":2,"wis":1},"skillGrants":[{"skill":"religion","rank":"expert"}],"maxHpBonus":20,"speeds":{"fly":"land"},"note":"Auspice specialization (Auspicious Mount): your faithful steed becomes a specialized animal companion. If you take the AUSPICE specialization it gains ALL of the following: the celestial, fiend, or monitor trait to match your deity's servitors (plus the holy trait if celestial, or the unholy trait if fiend; a monitor gains neither); Int modifier +2 and Wis modifier +1; expert proficiency in Religion; it can speak your deity's servitor language (e.g. Empyrean for celestials, Chthonian for demons, Requian for psychopomps); its maximum HP increase by 20, rising to +25 at 18th level and +30 at 20th; and a fly Speed equal to its land Speed. A celestial steed's extra HP increase by a further 5 and it gains weakness 5 to unholy; a fiend steed's extra HP increase by a further 5 and it gains weakness 5 to holy. These are ALL auspice-only benefits: if you instead choose one of the usual companion specializations, this feat grants none of the above (no ability boosts, Religion, bonus HP, fly Speed, trait, language, or weakness) — use that specialization's normal benefits instead. The app applies the auspice grants unconditionally, so edit the companion if you took a usual specialization."},
  'beast-eidolon': {"kinds":["eidolon"],"senses":["low-light vision"]},
  'burrowing-form': {"kinds":["eidolon"],"speeds":{"burrow":15},"note":"Burrowing Form: your eidolon can burrow through loose dirt."},
  'celestial-mount': {"kinds":["animal"],"senses":["darkvision"],"maxHpBonus":40,"flyEqualsLand":true,"iwr":["weakness 10 unholy"],"note":"Celestial Mount"},
  'chorus-companion': {"kinds":["animal"],"skillGrants":[{"skill":"performance","rank":"trained"}],"note":"Chorus Companion: your animal companion is trained in Performance (expert if it was already trained)."},
  'construct-eidolon': {"kinds":["eidolon"],"senses":["darkvision"]},
  'demon-eidolon': {"kinds":["eidolon"],"senses":["darkvision"],"note":"Demonic Strikes: the eidolon's unarmed Strikes deal an extra 1 unholy (evil) damage."},
  'demon-hunting-companion': {"kinds":["animal"],"senses":["scent (fiends only, imprecise 30 ft)"],"note":"Its scent detects only fiends."},
  'devotion-phantom-eidolon': {"kinds":["eidolon"],"senses":["darkvision"]},
  'dragon-eidolon': {"kinds":["eidolon"],"senses":["darkvision"],"note":"Dragon eidolon: darkvision."},
  'elemental-eidolon': {"kinds":["eidolon"],"senses":["darkvision"],"note":"Elemental Core: resistance equal to half your level to your core's damage type (fire core = fire resistance) plus an equal weakness to the opposing element (cold and water for a fire core), and +1 damage of the core's type on its Strikes."},
  'faithful-steed': {"kinds":["animal"],"note":"Mount: if you have the holy or unholy trait, your steed gains it too, as do its Strikes. Typically an animal companion with the mount ability (e.g. a horse)."},
  'fell-rider': {"kinds":["animal"],"skillGrants":[{"skill":"intimidation","rank":"trained"}],"note":"Fell Rider: your animal companion is trained in Intimidation."},
  'fey-eidolon': {"kinds":["eidolon"],"senses":["low-light vision"]},
  'fiendish-mount': {"kinds":["animal"],"senses":["darkvision"],"maxHpBonus":40,"flyEqualsLand":true,"iwr":["weakness 10 holy"],"note":"Fiendish Mount"},
  'incredible-megafauna-companion': {"kinds":["animal"],"maturityFloor":"savage","note":"Incredible Megafauna Companion: your megafauna companion is at least an indomitable or savage companion (your choice) — 'indomitable' is the megafauna name for the nimble rung, so pick nimble in Edit if you want that side."},
  'night-terror': {"kinds":["animal"],"speeds":{"fly":"land"},"note":"Night Terror: your apocalypse mount gains a fly Speed equal to its land Speed. At night or anywhere deprived of natural sunlight it gains a +10-foot circumstance bonus to that fly Speed, and critical failures on Acrobatics checks to Maneuver in Flight become failures instead. If it already had a fly Speed it also gains a +2 circumstance bonus to Acrobatics checks to Maneuver in Flight."},
  'paragon-companion': {"kinds":["animal"],"maturityFloor":"specialized","note":"Paragon Companion: your construct companion is at least a paragon (specialized) companion."},
  'peerless-mascot-companion': {"kinds":["animal"],"abilityBoosts":{"int":2,"wis":1},"maxHpBonus":20,"speeds":{"climb":"land","swim":"land"},"note":"Peerless Mascot specialization: expert in Warfare Lore; can speak one language you also speak (chosen when you gain this feat); gains the beast trait and a 30-foot banner aura acting as a second banner. Max HP increases by 20 (the app applies this flat +20; it rises to +25 at 18th level and +30 at 20th in the rules)."},
  'plant-eidolon': {"kinds":["eidolon"],"senses":["low-light vision"],"note":"Growing Vines (7th): all its melee unarmed Strikes gain the reach trait."},
  'psychopomp-eidolon': {"kinds":["eidolon"],"senses":["darkvision"],"strikeRider":"ghost touch","note":"Spirit Touch: its unarmed Strikes deal an extra 1 void damage to living creatures and an extra 1 vitality damage to undead."},
  'specialized-companion-animal-trainer': {"kinds":["animal"],"maturityFloor":"specialized","note":"Animal Trainer companion: gains one specialization of your choice, and its Performance proficiency is legendary in place of one of the specialization's skill increases."},
  'specialized-spirit-companion': {"kinds":["animal"],"strikeRider":"ghost touch","note":"Spirit-blessed: Strikes gain ghost touch."},
  'vibration-sense': {"kinds":["eidolon"],"senses":["tremorsense (imprecise 30 ft)"],"note":"Vibration Sense: tremorsense as an imprecise sense, range 30 feet. An aquatic eidolon gains wavesense (imprecise 30 ft) instead; an amphibious eidolon gains both."},
  'wing-rider': {"kinds":["animal"],"speeds":{"fly":25},"note":"Wing Rider: your dragon companion has a fly Speed of 25 feet at all times."},







  // ---- full feat audit — companion mods ----
  // 37 entries. The judge said "no lane exists"; the adversary found the lane.
  'a-miracle-of-science': {"kinds":["animal"],"maturityFloor":"specialized","note":"A Miracle of Science!: your construct companion is at least a paragon (specialized) construct companion."},
  'advanced-construct-companion': {"kinds":["animal"],"maturityFloor":"mature","note":"Advanced Construct Companion: your construct companion is at least an advanced construct companion (the mature rung here). During an encounter, even without Command a Construct, it can still use 1 action on your turn to Stride or Strike."},
  'battle-hardened-companion': {"kinds":["animal"],"maturityFloor":"nimble","note":"Battle-Hardened Companion: the companion you gained with Commander's Companion is at least a nimble or savage animal companion — pick savage in Edit if you want that side. During an encounter, even without Command an Animal, it can use 1 action on your turn to Stride or Strike, and then gains a reaction for your tactics (that is all the actions it gets that round)."},
  'battle-tested-companion': {"kinds":["animal"],"maturityFloor":"mature","note":"Battle-Tested Companion: the companion you gained with Commander's Companion is at least a mature animal companion. While your banner is affixed to it, the banner's aura is 10 feet greater than normal."},
  'behold-a-pale-horse': {"kinds":["animal"],"maturityFloor":"specialized","note":"Behold, A Pale Horse: your apocalypse mount is at least a specialized companion, gaining one specialization of your choice — choose it in Edit. Selectable up to three times, a different specialization each time (three maximum)."},
  'behold-my-creation': {"kinds":["animal"],"maturityFloor":"nimble","note":"Behold My Creation!: your construct companion is at least an incredible construct companion — the nimble/savage rung here; pick savage in Edit if that fits your build better."},
  'gigantic-megafauna-companion': {"kinds":["animal"],"note":"Gigantic Megafauna Companion: your megafauna companion's size increases to Huge. Nothing else about its statistics changes — adjust its space, reach, and Bulk limit by hand."},
  'hulking-size': {"kinds":["eidolon"],"note":"Hulking Size: your eidolon is Large instead of its previous size and its reach increases to 10 feet. No other statistics change."},
  'imposing-destrier': {"kinds":["animal"],"maturityFloor":"nimble","note":"Imposing Destrier: the mount you gained with Faithful Steed is at least a nimble or savage animal companion — pick savage in Edit if you want that side. During an encounter, even without Command an Animal, it can use 1 action on your turn to Stride or Strike (that is all the actions it gets that round)."},
  'impressive-mount': {"kinds":["animal"],"maturityFloor":"mature","note":"Impressive Mount: the mount you gained through Cavalier Dedication is at least a mature animal companion. During an encounter, even without Command an Animal, it can use 1 action on your turn to Strike or Stride (or Burrow, Climb, Fly, or Swim if it has that Speed) — that is all the actions it gets that round."},
  'incredible-beastmaster-companion': {"kinds":["animal"],"maturityFloor":"nimble","note":"Incredible Beastmaster Companion: each of your mature Beastmaster companions is at least a nimble or savage animal companion (your choice per companion) — pick savage in Edit for any companion you want on that side. Any companion that becomes mature later also gains this."},
  'incredible-companion-druid': {"kinds":["animal"],"maturityFloor":"nimble","note":"Incredible Companion: your animal companion is at least a nimble or savage companion (your choice) — pick savage in Edit if you want that side."},
  'incredible-companion-ranger': {"kinds":["animal"],"maturityFloor":"nimble","note":"Incredible Companion: your animal companion is at least a nimble or savage companion (your choice) — pick savage in Edit if you want that side."},
  'incredible-construct-companion': {"kinds":["animal"],"maturityFloor":"nimble","note":"Incredible Construct Companion: your construct companion is at least an incredible construct companion — the nimble/savage rung here; pick savage in Edit if that fits your build better."},
  'incredible-dragon-companion': {"kinds":["animal"],"maturityFloor":"nimble","note":"Incredible Dragon Companion: your dragon companion is at least a nimble or savage animal companion (your choice) — pick savage in Edit if you want that side."},
  'incredible-mount': {"kinds":["animal"],"maturityFloor":"nimble","note":"Incredible Mount: the mount you gained from Cavalier Dedication is at least a nimble or savage animal companion (your choice) — pick savage in Edit if you want that side."},
  'incredible-reanimated-companion': {"kinds":["animal"],"maturityFloor":"nimble","note":"Incredible Reanimated Companion: your reanimated construct companion is at least an incredible construct companion — the nimble/savage rung here; pick savage in Edit if that fits your build better."},
  'let-my-creature-live': {"kinds":["animal"],"maturityFloor":"mature","note":"Let my Creature Live!: your construct companion is at least an advanced construct companion (the mature rung here). During an encounter, even without the Command a Minion action, it can still use 1 action on your turn to Stride or Strike."},
  'loyal-warhorse': {"kinds":["animal"],"maturityFloor":"mature","note":"Loyal Warhorse: the mount you gained with Faithful Steed is at least a mature animal companion. It never attacks you, even if magically compelled."},
  'mature-animal-companion-druid': {"kinds":["animal"],"maturityFloor":"mature","note":"Mature Animal Companion: your companion is at least a mature animal companion. During an encounter, even if you don't Command an Animal, it can still use 1 action on your turn to Strike or Stride (or Burrow, Climb, Fly, or Swim if it has that Speed) — if it does, that's all it gets that round."},
  'mature-animal-companion-ranger': {"kinds":["animal"],"maturityFloor":"mature","note":"Mature Animal Companion: your companion is at least a mature animal companion. During an encounter, even if you don't Command an Animal, it can still use 1 action on your turn to Strike or Stride (or Burrow, Climb, Fly, or Swim if it has that Speed) — if it does, that's all it gets that round."},
  'mature-beastmaster-companion': {"kinds":["animal"],"maturityFloor":"mature","note":"Mature Beastmaster Companion: ALL of your animal companions are at least mature animal companions. During an encounter, even without Command an Animal, a companion can use 1 action on your turn to Strike or Stride (or Burrow, Climb, Fly, or Swim if it has that Speed) — that is all the actions it gets that round."},
  'mature-dragon-companion': {"kinds":["animal"],"maturityFloor":"mature","note":"Mature Dragon Companion: your drake is at least a mature animal companion. During an encounter, even without Command an Animal, it can use 1 action on your turn to Stride or Strike — that is all the actions it gets that round."},
  'mature-megafauna-companion': {"kinds":["animal"],"maturityFloor":"mature","note":"Mature Megafauna Companion: your megafauna companion is at least a mature animal companion. During an encounter, even without Command an Animal, it can use 1 action on your turn to Stride or Strike."},
  'natures-precision': {"kinds":["animal"],"note":"Nature's Precision: when your companion Strikes an off-guard creature with an agile or finesse unarmed attack, it deals an extra 1d4 precision damage (2d4 if the companion is specialized). If it already deals precision damage, combine the two."},
  'pale-horse': {"kinds":["animal"],"iwr":["resistance 10 fire, poison, or void (the type you chose when you Mounted, and only while you ride it)"],"note":"Pale Horse: when you Mount your faithful steed, choose fire, poison, or void. While you ride it, the steed gains resistance 10 to that type, and any creature that touches it — including hitting it with an unarmed attack or with a melee weapon Strike while adjacent — takes 1d6 damage of that type (2d6 at 16th level, 3d6 at 20th)."},
  'paragon-reanimated-companion': {"kinds":["animal"],"maturityFloor":"specialized","note":"Paragon Reanimated Companion: your reanimated construct companion is at least a paragon (specialized) construct companion."},
  'reincarnated-companion': {"kinds":["animal"],"maturityFloor":"specialized","note":"Reincarnated Companion: your animal companion is at least a specialized companion, gaining one specialization of your choice — pick it in Edit. If your fated companion is a familiar instead, it gains two additional familiar abilities (add them by hand). A slain fated companion is replaced at no cost during daily preparations."},
  'resilient-shell': {"kinds":["eidolon"],"iwr":["resistance physical (equal to its Constitution modifier)"],"note":"Resilient Shell: your eidolon has resistance to physical damage equal to its Constitution modifier."},
  'specialized-beastmaster-companion': {"kinds":["animal"],"maturityFloor":"specialized","note":"Specialized Beastmaster Companion: each of your nimble or savage Beastmaster companions becomes specialized, gaining one specialization of your choice — choose it per companion in Edit. Selectable more than once, a different specialization each time (three maximum per companion). Any companion that becomes specialized later also gains the chosen specializations."},
  'specialized-companion-druid': {"kinds":["animal"],"maturityFloor":"specialized","note":"Specialized Companion: your animal companion is at least a specialized companion, gaining one specialization of your choice — choose it in Edit. Selectable up to three times, a different specialization each time."},
  'specialized-companion-ranger': {"kinds":["animal"],"maturityFloor":"specialized","note":"Specialized Companion: your animal companion is at least a specialized companion, gaining one specialization of your choice — choose it in Edit. Selectable up to three times, a different specialization each time."},
  'specialized-megafauna-companion': {"kinds":["animal"],"maturityFloor":"specialized","note":"Specialized Megafauna Companion: your megafauna companion is at least a specialized companion and gains your choice of the bully, racer, tracker, or wrecker specialization — choose it in Edit. Selectable up to three times, a different one of those four each time (three maximum)."},
  'specialized-mount': {"kinds":["animal"],"maturityFloor":"specialized","note":"Specialized Mount: your mount is at least a specialized companion, gaining one specialization of your choice — choose it in Edit. Selectable up to three times, a different specialization each time (three maximum)."},
  'towering-size': {"kinds":["eidolon"],"note":"Towering Size: your eidolon becomes Huge instead of Large, and the reach on all its attacks increases to 15 feet. No other statistics change."},
  'unbreakable-bond': {"kinds":["animal"],"note":"Unbreakable Bond: your megafauna companion automatically succeeds at the recovery check to stabilize at 0 HP on its turn, and it dies at dying 5 rather than dying 4. Once per day, the first time it would reach dying 5 and die while you're alive, its dying value drops to 0 instead."},
  'undead-companion': {"kinds":["animal","familiar"],"note":"Undead Companion: your companion has the undead trait instead of the animal trait and gains void healing (void damage heals it; vitality damage harms it). It otherwise uses the normal animal companion or familiar rules and can still be affected by conditions and effects most undead ignore."},
};
