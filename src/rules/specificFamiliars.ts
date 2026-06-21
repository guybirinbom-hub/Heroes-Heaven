/*
 * Specific familiars — named familiar "templates" (PF2e). A specific familiar can be applied
 * to a familiar that has at least `requiredCount` familiar abilities; it locks in the listed
 * required abilities (which count against that total) and grants the unique special abilities
 * on top. Data verified against Archives of Nethys (Familiars.aspx?Specific=true).
 */
export interface SpecificFamiliarSpecial {
  name: string;
  /** Action cost shown as a glyph where applicable. */
  cost?: { type: 'actions'; value: 1 | 2 | 3 } | { type: 'reaction' } | { type: 'free' };
  desc: string;
}

export interface SpecificFamiliar {
  id: string;
  name: string;
  /** Minimum familiar abilities the familiar must have to become this specific familiar. */
  requiredCount: number;
  /** Always-on familiar abilities (consume slots from the daily total). */
  requiredAbilities: string[];
  /** Unique abilities granted in addition (don't count against the total). */
  specials: SpecificFamiliarSpecial[];
  /** Creature traits this familiar gains (construct, fiend, dragon, …). */
  traits: string[];
  /** A short note (prerequisite / access), if any. */
  note?: string;
  source: string;
}

export const SPECIFIC_FAMILIARS: SpecificFamiliar[] = [
  {
    id: 'aeon-wyrd',
    name: 'Aeon Wyrd',
    requiredCount: 3,
    requiredAbilities: ['Construct', 'Flier'],
    traits: ['construct'],
    specials: [
      { name: 'Aeon Stone Reservoir', desc: 'Houses an aeon stone as its core; you gain that aeon stone’s benefits without investing it, and you gain its resonant power.' },
      { name: "Can't Walk", desc: 'It has no land Speed (it floats; relies on its fly Speed).' },
      { name: 'Crystalline', desc: 'It has weakness to sonic damage equal to your level.' },
    ],
    source: 'Player Core 2',
  },
  {
    id: 'calligraphy-wyrm',
    name: 'Calligraphy Wyrm',
    requiredCount: 6,
    requiredAbilities: ['Darkvision', 'Flier', 'Manual Dexterity', 'Scent', 'Skilled (Arcana)', 'Skilled (Society)', 'Speech'],
    traits: ['dragon'],
    specials: [
      { name: 'Ink Spray', cost: { type: 'actions', value: 1 }, desc: 'Arcane. 10-foot cone; each creature attempts a Reflex save vs the higher of your spell DC or class DC. On a failure it’s covered in ink (invisible creatures become concealed) — concealed for 2 rounds on a success, 1 minute on a failure, 10 minutes and blinded 1 round on a critical failure (or until wiped off by an Interact).' },
      { name: 'Stylus Claws', desc: 'Its claws are styluses filled with its own ink, acting as a pen without needing to buy ink.' },
    ],
    source: 'Rival Academies',
  },
  {
    id: 'fey-dragonet',
    name: 'Fey Dragonet',
    requiredCount: 5,
    requiredAbilities: ['Darkvision', 'Flier', 'Manual Dexterity', 'Speech', 'Touch Telepathy'],
    traits: ['fey', 'dragon'],
    specials: [
      { name: 'Euphoric Breath', cost: { type: 'actions', value: 2 }, desc: 'Arcane, poison; once per hour. 10-foot cone; each creature attempts a Fortitude save vs the higher of your class DC or spell DC. On a failure it’s stupefied 2 and slowed 1 for 1d4 rounds; critical failure: the same for 1 minute.' },
    ],
    note: 'The Remaster successor to the older Faerie Dragon.',
    source: 'Player Core 2',
  },
  {
    id: 'grindle-drake',
    name: 'Grindle-Drake',
    requiredCount: 4,
    requiredAbilities: ['Darkvision', 'Skilled (Perception)', 'Skilled (Survival)', 'Touch Telepathy'],
    traits: ['dragon'],
    specials: [
      { name: 'Forage', cost: { type: 'actions', value: 2 }, desc: 'It forages, recovering Hit Points equal to half your level.' },
      { name: 'Sure and Steady', cost: { type: 'actions', value: 2 }, desc: 'Placing all six legs on the ground, it senses within a 10-foot emanation whether the ground is enchanted, hollow, treacherous, or otherwise different than it appears, reporting via touch telepathy.' },
    ],
    note: 'Access: characters from the Five Kings Mountains.',
    source: 'Shining Kingdoms',
  },
  {
    id: 'homunculus',
    name: 'Homunculus',
    requiredCount: 6,
    requiredAbilities: ['Construct', 'Darkvision', 'Manual Dexterity', 'Poison Reservoir'],
    traits: ['construct'],
    specials: [
      { name: 'Blood Link', desc: 'Telepathic bond with its creator up to 1,500 feet; if you’re unconscious or dying it acts as last commanded, and if it’s destroyed you take 2d10 mental damage.' },
      { name: 'Porter', desc: 'It gains either the item delivery or valet familiar ability as an additional ability.' },
    ],
    source: 'Player Core 2',
  },
  {
    id: 'imp',
    name: 'Imp',
    requiredCount: 7,
    requiredAbilities: ['Darkvision', 'Flier', 'Manual Dexterity', 'Resistance (poison)', 'Skilled (Deception)', 'Speech', 'Touch Telepathy'],
    traits: ['fiend'],
    specials: [
      { name: 'Imp Invisibility', desc: 'Once per hour it can cast invisibility on itself as a divine innate spell.' },
      { name: 'Fiendish Temptation', desc: 'Once per day it offers a non-fiend within 15 feet a bargain; if accepted, the target gains a 1-hour boon to reroll one attack roll or save (take the higher). If that creature dies while the boon is active, the imp decides where its soul goes.' },
    ],
    source: 'Player Core 2',
  },
  {
    id: 'pipefox',
    name: 'Pipefox',
    requiredCount: 5,
    requiredAbilities: ['Climber', 'Darkvision', 'Second Opinion', 'Skilled (one skill)', 'Speech'],
    traits: [],
    specials: [
      { name: 'Scholarly Linguist', desc: 'It speaks and understands every language you know, plus one common language you don’t know.' },
    ],
    source: 'Player Core 2',
  },
  {
    id: 'poppet',
    name: 'Poppet',
    requiredCount: 1,
    requiredAbilities: ['Construct'],
    traits: ['construct'],
    specials: [
      { name: 'Flammable', desc: 'It gains weakness to fire equal to your level; you can spend one familiar ability to reinforce its construction, removing the weakness for that day.' },
    ],
    source: 'Player Core 2',
  },
  {
    id: 'spellslime',
    name: 'Spellslime',
    requiredCount: 4,
    requiredAbilities: ['Climber', 'Darkvision', 'Tough'],
    traits: [],
    specials: [
      { name: 'Magic Scent', desc: 'Imprecise sense, range 30 feet; it smells magic of your own tradition.' },
      { name: 'Ooze Defense', desc: 'Immune to critical hits and precision damage, but its AC is 10 + your level instead of equal to yours.' },
      { name: 'Slime Rejuvenation', desc: 'When you Refocus, it recovers 2 Hit Points per level (instead of the normal 1).' },
    ],
    note: 'Prerequisite: you must be able to cast spells using spell slots.',
    source: 'Player Core 2',
  },
];

export const SPECIFIC_FAMILIARS_BY_ID: Record<string, SpecificFamiliar> = Object.fromEntries(
  SPECIFIC_FAMILIARS.map((f) => [f.id, f]),
);
