/*
 * Short rules-glossary descriptions for terms that have no description in the imported
 * data (proficiency categories, senses, common creature traits, common languages). Used by
 * the click-a-term-to-read-it popovers. Ancestry/heritage/background/class/deity descriptions
 * come from the content data itself; these fill the gaps.
 */
import type { ContentDatabase } from './types';

/** Weapon/armor proficiency categories + spellcasting + class DC. Keyed by the lowercase
 *  category id (simple/martial/…); your proficiency RANK in it sets your bonus. */
export const PROFICIENCY_GLOSSARY: Record<string, string> = {
  simple: 'Simple weapons are the most basic armaments (clubs, daggers, spears, crossbows, and the like). Your proficiency sets the bonus on attack rolls you make with them.',
  martial: 'Martial weapons require more training (swords, bows, flails, war picks, and so on). Your proficiency sets the bonus on attack rolls you make with them.',
  advanced: 'Advanced weapons are unusual, complex armaments that need special training (such as the dwarven scythe or gnome flickmace). Most characters are untrained with them.',
  unarmed: 'Unarmed attacks are strikes made with your body — fists, kicks, headbutts. Your proficiency sets the bonus on those attack rolls.',
  unarmored: 'Unarmored defense is your proficiency when wearing no armor; it sets your AC (and, for some classes, factors into being hard to hit) while unarmored.',
  light: 'Light armor (such as leather or a chain shirt) gives a modest AC bonus with a low check penalty and a high Dexterity cap.',
  medium: 'Medium armor (such as hide or a breastplate) balances protection and mobility, with a moderate check penalty and Dexterity cap.',
  heavy: 'Heavy armor (such as splint or full plate) is the most protective, but has the highest check penalty and the lowest Dexterity cap.',
  spellcasting: 'Your spellcasting proficiency sets your spell attack roll and spell DC for this tradition.',
  classdc: 'Your class DC is the difficulty target for many of your class abilities: 10 + your proficiency bonus + your key attribute modifier.',
};

/** What a proficiency RANK means. */
export const RANK_GLOSSARY: Record<string, string> = {
  untrained: 'Untrained: no proficiency bonus (+0); you add only your level-independent modifiers.',
  trained: 'Trained: a +2 proficiency bonus, plus your level. The first step of training in a skill, weapon, or defense.',
  expert: 'Expert: a +4 proficiency bonus, plus your level.',
  master: 'Master: a +6 proficiency bonus, plus your level.',
  legendary: 'Legendary: a +8 proficiency bonus, plus your level — the pinnacle of training.',
};

/** Senses / vision. Keyed by sense id (both `low-light` and `low-light-vision` forms). */
export const SENSE_GLOSSARY: Record<string, string> = {
  normal: 'Normal vision: you see in bright light and dim light, but cannot see in darkness without a light source.',
  'low-light': 'Low-light vision: you see in dim light as though it were bright light, so dim light does not make creatures concealed to you.',
  'low-light-vision': 'Low-light vision: you see in dim light as though it were bright light, so dim light does not make creatures concealed to you.',
  darkvision: 'Darkvision: you see in darkness and dim light as well as in bright light, though everything appears in black and white.',
  'greater-darkvision': 'Greater darkvision: like darkvision, but even magical darkness does not impede your sight.',
  scent: 'Scent: an imprecise sense that lets you detect creatures and objects by smell within the listed range.',
  tremorsense: 'Tremorsense: an imprecise sense that detects creatures in contact with the ground through the vibrations they make.',
  lifesense: 'Lifesense: a sense that detects the vital essence of living and undead creatures within range.',
  echolocation: 'Echolocation: you use sound to precisely sense your surroundings within the listed range.',
  bloodsense: 'Bloodsense: an imprecise sense that detects the blood of living creatures within range, letting you notice them even without sight.',
  magicsense: 'Magicsense: an imprecise sense that detects active spells and magic items within range, alerting you to nearby magic.',
  wavesense: 'Wavesense: an imprecise sense that detects motion in water within range, much as tremorsense detects motion on the ground.',
};

/** Common creature-type traits (ancestry traits are described generically from the data). */
const CREATURE_TRAIT_GLOSSARY: Record<string, string> = {
  humanoid: 'Humanoid creatures reason and act much like humans — usually bipedal, tool-using folk such as humans, elves, dwarves, and goblins.',
  animal: 'An animal is a creature with a relatively low intelligence; it usually lacks the ability to speak or use complex tools.',
  beast: 'Beasts are non-humanoid creatures with abilities beyond those of natural animals, often magical in nature.',
  construct: 'A construct is an artificial creature given a semblance of life through magic or technology.',
  undead: 'Undead are once-living creatures animated by spiritual or necromantic energy; they are damaged by positive (vitality) effects.',
  fiend: 'Fiends are evil creatures native to the Outer Planes, such as demons, devils, and daemons.',
  celestial: 'Celestials are good creatures native to the good-aligned Outer Planes, such as angels and azatas.',
  dragon: 'Dragons are reptilian creatures, often winged and breath-weapon-wielding, with a strong tie to magic.',
  fey: 'Fey are creatures tied to the First World — whimsical, magical, and often capricious.',
  elemental: 'Elementals are creatures composed of one of the elements (air, earth, fire, water, metal, or wood).',
  giant: 'A giant is a humanoid-like creature of immense size.',
  monitor: 'Monitors are creatures of the neutral-aligned planes that uphold cosmic balance, such as psychopomps and aeons.',
};

/** Common rules traits (rarity, item category, weapon traits, spell/action traits, traditions).
 *  The import carries no trait descriptions, so these curated blurbs fill the gaps; traitDesc
 *  adds family + generic fallbacks so every trait chip stays clickable. */
const TRAIT_GLOSSARY: Record<string, string> = {
  // Rarity
  common: 'Common: available to any character without special access.',
  uncommon: 'Uncommon: requires special access — a feat, region, or GM permission — to select or buy.',
  rare: 'Rare: harder to find than uncommon; available only with specific access granted by the GM.',
  unique: 'Unique: one of a kind, tied to a specific person, place, or event.',
  // Item categories / magic
  magical: 'Magical: the item or effect is magic in nature and is affected by things that target magic (such as dispelling or counteracting).',
  alchemical: 'Alchemical: a non-magical item made through alchemy; affected by effects that target alchemical items.',
  consumable: 'Consumable: used up when activated (potions, scrolls, talismans, ammunition, and the like).',
  invested: 'Invested: you must Invest the item during daily preparations for its magic to function; you can invest at most 10 items.',
  bomb: 'Bomb: a thrown alchemical weapon that deals damage in or around the space it hits.',
  // Weapon traits
  agile: 'Agile: your multiple attack penalty with this weapon is −4 on the second attack and −8 on later ones, instead of −5/−10.',
  finesse: 'Finesse: you may use your Dexterity modifier instead of Strength on attack rolls with this melee weapon (damage still uses Strength).',
  reach: 'Reach: this weapon strikes creatures up to 10 feet away (or farther for larger wielders), extending your reach.',
  thrown: 'Thrown: you can throw this weapon as a ranged attack, adding your Strength modifier to damage; the listed number is its range increment.',
  versatile: 'Versatile: each Strike can instead deal the listed damage type (bludgeoning, piercing, or slashing) of your choice.',
  deadly: 'Deadly: on a critical hit, add a weapon damage die of the listed size (more dice at higher weapon ranks).',
  fatal: "Fatal: on a critical hit, the weapon's damage dice become the listed larger size and you add one extra die of that size.",
  forceful: 'Forceful: each time you hit with this weapon again in the same turn, it deals extra damage equal to the number of previous hits this turn.',
  sweep: 'Sweep: gain a +1 circumstance bonus to attack rolls against a target if you already attacked a different target this turn.',
  trip: 'Trip: you can use this weapon to Trip with Athletics while wielding it.',
  shove: 'Shove: you can use this weapon to Shove with Athletics while wielding it.',
  disarm: 'Disarm: you can use this weapon to Disarm with Athletics while wielding it.',
  grapple: 'Grapple: you can use this weapon to Grapple with Athletics while wielding it.',
  nonlethal: 'Nonlethal: attacks with this weapon knock a target out rather than kill, with no penalty.',
  parry: 'Parry: spend an action to raise the weapon, gaining a +1 circumstance bonus to AC until the start of your next turn.',
  twin: 'Twin: when you hit with this weapon and another of the same type in the same turn, add its damage die as bonus damage on the later hit.',
  propulsive: 'Propulsive: add half your Strength modifier to ranged damage with this weapon (all of it if your Strength is negative).',
  volley: 'Volley: ranged attacks made within the listed range take a −2 penalty — the weapon is meant for longer range.',
  'free-hand': 'Free-Hand: this weapon needs a free hand rather than being held, leaving your hands open for other actions.',
  'two-hand': 'Two-Hand: you can wield this one-handed weapon in two hands, changing its damage die to the listed larger size for that Strike.',
  unarmed: "Unarmed: a Strike made with your body rather than a held weapon; it can't be Disarmed and works with handwraps of mighty blows.",
  backstabber: 'Backstabber: deals 1 extra damage (2 with a greater striking rune) when you hit an off-guard creature.',
  modular: 'Modular: an Interact action lets you switch the weapon between its listed damage types.',
  // Action / spell traits
  concentrate: 'Concentrate: an action requiring mental focus and discipline.',
  manipulate: 'Manipulate: the action uses gestures or handling, which can trigger reactions such as Reactive Strike.',
  attack: 'Attack: this action involves an attack roll and counts toward your multiple attack penalty.',
  flourish: 'Flourish: you can use only one action with the flourish trait per turn.',
  press: "Press: a follow-up action that's stronger after you've already attacked, but it increases your multiple attack penalty.",
  open: 'Open: usable only as the first action of your turn (a combat opener).',
  stance: "Stance: enter a stance that lasts until you leave it; you can be in only one stance at a time.",
  exploration: 'Exploration: an activity performed during exploration mode, over minutes rather than in combat.',
  downtime: 'Downtime: an activity performed during downtime, over hours or days.',
  secret: 'Secret: the GM rolls this check for you, since knowing the result could change how you act.',
  fortune: 'Fortune: roll twice and take the higher result; only one fortune effect can apply to a roll.',
  misfortune: 'Misfortune: roll twice and take the lower result.',
  incapacitation: 'Incapacitation: used against a creature higher than twice the effect’s level, the target gets one better degree of success.',
  death: 'Death: an effect that can kill outright; creatures immune to death effects ignore it.',
  healing: 'Healing: an effect that restores Hit Points or mends the living.',
  mental: 'Mental: targets the mind; mindless creatures are immune.',
  emotion: 'Emotion: a mental effect rooted in feelings; creatures immune to emotion ignore it.',
  fear: 'Fear: a mental emotion effect that imposes the frightened condition.',
  visual: "Visual: relies on sight; a creature that can't see the source is unaffected.",
  auditory: "Auditory: relies on sound; a deafened creature is unaffected.",
  linguistic: "Linguistic: depends on understanding language; it has no effect on a creature that shares no language with it.",
  light: 'Light: creates or manipulates light and can counteract magical darkness.',
  darkness: 'Darkness: creates or manipulates darkness and can counteract magical light.',
  teleportation: 'Teleportation: moves a creature or object instantly without crossing the space between.',
  summon: 'Summon: calls a creature to fight alongside you for the duration.',
  polymorph: "Polymorph: transforms a creature's physical form; only one polymorph effect can apply at a time.",
  cantrip: 'Cantrip: a spell you can cast at will, automatically heightened to half your level (rounded up).',
  focus: 'Focus: a focus spell, cast by spending a Focus Point from your focus pool (refilled by Refocusing).',
  ritual: 'Ritual: a long magical ceremony cast over minutes or more, often with several participants.',
  subtle: "Subtle: has no obvious manifestations, so observers can't tell you're using magic without a check.",
  // Traditions
  arcane: 'Arcane: the magical tradition drawn from logic and the fundamental forces of the universe.',
  divine: 'Divine: the magical tradition channeled from deities and the Outer Planes.',
  occult: 'Occult: the magical tradition drawn from the mysteries of mind and spirit.',
  primal: 'Primal: the magical tradition drawn from nature and the wilds.',
};

/** Languages of Golarion (Remaster naming). The import carries no language descriptions, so
 *  these blurbs fill them in; `languageDesc` also has a generic fallback so any language not
 *  listed here still opens a description rather than rendering as plain text. */
export const LANGUAGE_GLOSSARY: Record<string, string> = {
  // Widespread / common languages
  common: 'Common (Taldane): the trade language of the Inner Sea region, spoken by most humanoids.',
  draconic: 'Draconic: the language of dragons, also used in much arcane writing and by many reptilian creatures.',
  dwarven: 'Dwarven: the language of dwarves, full of hard consonants and terms for mining and crafting.',
  elven: 'Elven: the lyrical language of elves, also used by half-elves and in many magical works.',
  fey: 'Fey: the language of the fey and the creatures of the First World (called Sylvan before the Remaster).',
  gnomish: 'Gnomish: the rapid, expressive language of gnomes, shaped by their First World heritage.',
  goblin: 'Goblin: the simple, blunt language of goblins, hobgoblins, and bugbears.',
  halfling: 'Halfling: the language of halflings, rich in idiom and seldom written down.',
  jotun: 'Jotun: the language of giants, ogres, trolls, and many other large humanoids.',
  orcish: 'Orcish: the harsh, direct language of orcs and half-orcs.',
  necril: 'Necril: the language of intelligent undead and those who study them.',
  sakvroth: 'Sakvroth: the language of the drow and other peoples of the Darklands (called Undercommon before the Remaster).',
  // Planar / elemental
  thalassic: 'Thalassic: the elemental language of water, spoken by creatures of the Plane of Water (called Aquan before the Remaster).',
  utopian: 'Utopian: the language of aeons and the lawful monitors of Axis, the plane of perfect order.',
  // Ancestry languages
  alghollthu: 'Alghollthu: the ancient language of the alghollthus, aboleths and their kin, recorded in the drowned ruins of their fallen empires.',
  amurrun: 'Amurrun: the language of the catfolk.',
  anadi: 'Anadi: the language of the anadi, the shapechanging spider-folk of the Mwangi Expanse.',
  androffan: 'Androffan: the technological language of the crashed starship Divinity, used by androids and recorded throughout the ruins of Numeria.',
  goloma: 'Goloma: the language of the goloma, the wary, many-eyed folk of the Mwangi Expanse.',
  iruxi: 'Iruxi: the language of the iruxi, the lizardfolk.',
  kholo: 'Kholo: the language of the kholo, the hyena-like folk once called gnolls.',
  mwangi: 'Mwangi: the most widespread regional language of the Mwangi Expanse, shared across many of its peoples.',
  nagaji: 'Nagaji: the language of the nagaji and the nagas they serve, common in Tian Xia.',
  rasu: 'Rasu: the ancestral language of the rasu people.',
  samsaran: 'Samsaran: the language of the samsarans, the reincarnating folk of Tian Xia.',
  shadowtongue: 'Shadowtongue: the language of Nidal and the creatures of the Shadow Plane.',
  shisk: 'Shisk: the language of the shisk, the quill-covered folk of the deep caverns.',
  shoony: 'Shoony: the language of the shoony, a gentle people of dog-like farmers.',
  strix: 'Strix: the language of the strix, a winged people.',
  surki: 'Surki: the ancestral language of the surki.',
  tanuki: 'Tanuki: the language of the tanuki, the shapeshifting folk of Tian Xia.',
  tengu: 'Tengu: the language of the tengu, the corvid folk.',
  tripkee: 'Tripkee: the language of the tripkee, the adaptable frog-folk once called grippli.',
  vanara: 'Vanara: the language of the vanara, the monkey-folk of Vudra and Tian Xia.',
  vishkanyan: 'Vishkanyan: the language of the vishkanya, a poison-blooded, serpent-touched people.',
  wayang: 'Wayang: the language of the wayang, the shadow-touched folk of Tian Xia.',
  yaksha: 'Yaksha: the language of the yaksha, nature spirits of the Vudran tradition.',
  ysoki: 'Ysoki: the chittering language of the ysoki, the ratfolk.',
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-');
const pretty = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Description for a proficiency category id (simple/martial/unarmored/spellcasting/classDc…). */
export function proficiencyDesc(id: string): string | undefined {
  return PROFICIENCY_GLOSSARY[norm(id)];
}

/** Description for a proficiency rank (trained/expert/…). */
export function rankDesc(rank: string): string | undefined {
  return RANK_GLOSSARY[norm(rank)];
}

/** Description for a sense id. Falls back to a generic blurb so every sense stays clickable. */
export function senseDesc(id: string): string {
  return (
    SENSE_GLOSSARY[norm(id)] ??
    `${pretty(id)}: a special sense your character possesses. See the ancestry, feat, or item that grants it for its full rules.`
  );
}

/** Description for a language id. Falls back to a generic blurb so every language stays clickable. */
export function languageDesc(id: string): string {
  return (
    LANGUAGE_GLOSSARY[norm(id)] ??
    `${pretty(id)}: one of the languages of Golarion. A character who knows it can understand its speakers and read its writing.`
  );
}

/** Description for a trait. Prefers the curated glossary (covering common weapon/spell/item
 *  traits), then suffixed weapon-trait families (versatile-p, deadly-d8, …), then ancestry and
 *  creature/class traits, with a generic fallback so every trait chip stays clickable. */
export function traitDesc(trait: string, content?: ContentDatabase | null): string {
  const key = norm(trait);
  if (TRAIT_GLOSSARY[key]) return TRAIT_GLOSSARY[key];
  // Suffixed weapon-trait families: versatile-p, deadly-d8, fatal-d10, two-hand-d12, thrown-20…
  for (const fam of ['versatile', 'deadly', 'fatal', 'two-hand', 'thrown', 'volley']) {
    if (key.startsWith(fam + '-') && TRAIT_GLOSSARY[fam]) return TRAIT_GLOSSARY[fam];
  }
  const anc = content?.ancestries[key];
  if (anc) return `An ancestry trait. Feats, items, and effects that require the ${anc.name} trait are available to ${anc.name}s (and creatures granted it).`;
  if (CREATURE_TRAIT_GLOSSARY[key]) return CREATURE_TRAIT_GLOSSARY[key];
  const cls = content?.classes[key];
  if (cls) return `A class trait. It marks feats and options tied to the ${cls.name} class.`;
  return `${pretty(trait)}: a trait. Feats, items, spells, and effects that reference it interact with anything that has this trait.`;
}
