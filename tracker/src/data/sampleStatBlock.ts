import type { Combatant, Creature, RawCreature } from '../types/pf2e'

// A fully-populated example creature used ONLY by the Settings → Stat Blocks
// editor, so every reorderable item (Perception … Abilities & Actions) has real
// content and the user sees exactly how each display option looks.
const SAMPLE_CREATURE: Creature = {
  id: 'sample-statblock',
  name: 'Emberscale Wyrm',
  source: 'Example',
  level: 14,
  traits: ['Uncommon', 'CE', 'Large', 'Dragon', 'Fire'],
  perception: 27,
  senses: ['darkvision', 'scent (imprecise) 60 feet', 'smoke vision'],
  languages: ['Common', 'Draconic', 'Ignan'],
  skills: { Acrobatics: 24, Arcana: 25, Athletics: 28, Deception: 26, Intimidation: 27, Stealth: 24 },
  str: 8, dex: 5, con: 7, int: 4, wis: 5, cha: 6,
  items: ['+2 greater striking flaming greataxe', 'breastplate', 'hoarded gemstones (2,400 gp)'],
  speed: { walk: 40, fly: 120, swim: 40 },
  attacks: [
    { range: 'Melee', name: 'jaws', attack: 30, traits: ['fire', 'magical', 'reach 10 feet'], damage: '3d12+15', types: ['piercing'], effects: ['2d6 fire'], isAgile: false },
    { range: 'Melee', name: 'claw', attack: 30, traits: ['agile', 'magical'], damage: '3d10+15', types: ['slashing'], effects: ['Grab'], isAgile: true },
    { range: 'Ranged', name: 'wing buffet', attack: 28, traits: ['magical', 'range 30 feet'], damage: '3d8+12', types: ['bludgeoning'], effects: [], isAgile: false },
  ],
  spellcasting: [
    {
      name: 'Arcane Innate Spells', type: 'innate', tradition: 'arcane', DC: 35, attack: 27,
      spells: '',
      spellsByLevel: [
        { label: 'Cantrips', level: 4, isCantrip: true, spells: [{ name: 'detect magic' }, { name: 'light' }] },
        { label: '4th', level: 4, spells: [{ name: 'fireball', uses: 3 }, { name: 'wall of fire', uses: 1 }] },
        { label: '6th', level: 6, spells: [{ name: 'chain lightning', uses: 1 }] },
        { label: '7th', level: 7, spells: [{ name: 'fiery body', uses: 1 }] },
      ],
    },
  ],
  rituals: {
    dc: 35,
    casts: [
      { rank: '5th', level: 5, names: ['Planar Binding', 'Resurrect'] },
      { rank: '6th', level: 6, names: ['Commune'] },
    ],
  },
  abilities: [
    { name: 'Frightful Presence', activity: undefined, traits: ['aura', 'emotion', 'fear'], entries: 'A creature that first enters the area must attempt a DC 33 Will save. On a failure it becomes frightened 2 (frightened 1 on a critical success... a success). The creature is then temporarily immune for 1 minute.' },
    { name: 'Attack of Opportunity', activity: '↺', traits: [], trigger: 'A creature within reach uses a manipulate or move action, makes a ranged attack, or leaves a square during a move action it’s using.', entries: 'The wyrm makes a melee Strike against the triggering creature.' },
    { name: 'Breath Weapon', activity: '◆◆', traits: ['arcane', 'evocation', 'fire'], entries: 'The wyrm breathes a blast of flame in a 40-foot cone that deals 14d6 fire damage (DC 35 basic Reflex save). It can’t use Breath Weapon again for 1d4 rounds.' },
  ],
  defenses: {
    ac: 38, fort: 28, ref: 25, will: 27, hp: 300, bt: 150,
    immunities: ['fire', 'paralyzed', 'sleep'],
    resistances: [{ amount: 15, name: 'physical', note: 'except cold iron' }],
    weaknesses: [{ amount: 15, name: 'cold' }],
  },
  isHazard: false,
  recallKnowledge: 'DC 33 • Dragon (Arcana)',
  raw: { name: 'Emberscale Wyrm', source: 'Example', level: 14 } as RawCreature,
}

export const SAMPLE_COMBATANT: Combatant = {
  id: 'sample-statblock',
  name: 'Emberscale Wyrm',
  creature: SAMPLE_CREATURE,
  isPC: false,
  isAlly: false,
  initiative: null,
  currentHP: 300,
  maxHP: 300,
  tempHP: 0,
  conditions: [],
  isElite: false,
  isWeak: false,
  notes: '',
  isDefeated: false,
}
