/*
 * Monster Parts — the imbued-property catalog. Transcribed FRESH from
 * C:\wonderers guide\Monster Parts - Remaster Conversion v2.md (personal Remaster conversion of
 * Battlezoo Monster Parts, © Roll for Combat). Per-level damage is CUMULATIVE — the resolver
 * (resolvePath) picks the highest entry at or below the chosen property level. Situational crit riders,
 * granted spells, and conditions are reference text only; machine-readable fields (addDamage,
 * persistentDamage, ignoreResistance) are set where the effect is a flat/scaling Strike-damage rider.
 *
 * Chaotic reuses Unholy's paths and Lawful reuses Holy's (see reusesPathsOf) — the ruleset states each
 * "functions exactly like" its counterpart, so we don't duplicate the level entries.
 */
import type { MpProperty, MpDamage } from './monsterParts';
import type { DamageType, DieSize } from './types';

// Weapon damage properties that share the standard 3-path shape are authored inline below; single-path
// skill/perception/armor/shield properties use one path with id 'main'. `f`/`d` are defined locally to
// avoid a circular import (monsterParts imports this catalog at module load).
const f = (flat: number, type: DamageType, persistent?: boolean): MpDamage => ({ flat, type, persistent });
const d = (dice: number, die: DieSize, type: DamageType, persistent?: boolean): MpDamage => ({ dice, die, type, persistent });

const ACID: MpProperty = {
  id: 'acid',
  name: 'Acid',
  appliesTo: ['weapon'],
  requirement: 'The monster has the acid trait or an attack/spell dealing acid damage.',
  effect: 'You imbue the weapon with vitriolic acid.',
  choicePrompt: 'Tradition (Magic path)',
  choiceOptions: ['arcane', 'primal'],
  paths: [
    {
      id: 'magic',
      name: 'Magic',
      note: 'arcane or primal',
      levels: [
        { level: 2, text: 'Cast Caustic Blast as a cantrip.' },
        { level: 4, text: 'Cast acidic burst once/day.' },
        { level: 6, text: 'acidic burst heightens to 2nd; cast either Acid Grip or acidic burst once/day, not both.' },
        { level: 8, text: 'acidic burst heightens to 3rd; cast Acid Grip and acidic burst each once/day.' },
        { level: 10, text: 'Strikes deal 1 additional acid damage.', addDamage: f(1, 'acid') },
        { level: 12, text: 'Acid Grip heightens to 4th; cast acid storm once/day.' },
        { level: 14, text: 'Additional acid damage → 1d4.', addDamage: d(1, 'd4', 'acid') },
        { level: 16, text: 'Acid Grip heightens to 6th, acid storm to 7th.' },
        { level: 18, text: 'Additional acid damage → 1d6.', addDamage: d(1, 'd6', 'acid') },
        { level: 20, text: 'Cast storm of vengeance once/day, choosing only the acid-rain effect (you may choose it twice in a row).' },
      ],
    },
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 4, text: '1 additional acid damage.', addDamage: f(1, 'acid') },
        { level: 6, text: 'Additional acid → 1d4.', addDamage: d(1, 'd4', 'acid') },
        { level: 8, text: 'Additional acid → 1d6; on a crit the target\'s armor takes 3d6 acid (before Hardness), or its raised shield takes it instead.', addDamage: d(1, 'd6', 'acid') },
        { level: 12, text: 'The acid damage ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'Crit armor/shield damage → 6d6.' },
        { level: 18, text: 'Additional acid → 1d8.', addDamage: d(1, 'd8', 'acid') },
        { level: 20, text: 'Before applying acid, the target gains weakness 1 to acid until the start of your next turn.' },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 4, text: '1 persistent acid damage.', persistentDamage: f(1, 'acid', true) },
        { level: 6, text: '1 additional acid damage.', addDamage: f(1, 'acid') },
        { level: 8, text: 'Persistent acid → 1d6; on a crit the armor/shield takes 3d6.', persistentDamage: d(1, 'd6', 'acid', true) },
        { level: 12, text: 'The acid damage (incl. persistent) ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'Persistent acid → 1d8.', persistentDamage: d(1, 'd8', 'acid', true) },
        { level: 16, text: 'Each time a foe (or its armor/shield) takes this persistent acid at end of turn, its resistances and Hardness drop by 1 for 1 minute (cumulative).' },
        { level: 18, text: 'Persistent acid → 1d10.', persistentDamage: d(1, 'd10', 'acid', true) },
        { level: 20, text: 'On a crit, the target is drained 1.' },
      ],
    },
  ],
};

const BANE: MpProperty = {
  id: 'bane',
  name: 'Bane',
  appliesTo: ['weapon'],
  requirement: 'The monster is of the chosen bane type (or, at GM discretion, anathematic to it — e.g. celestial parts for a fiend-bane).',
  effect: 'Choose a creature type: aberration, animal, astral, beast, celestial, construct, dragon, dream, elemental, ethereal, fey, fiend, giant, monitor, ooze, spirit, time, undead, or both fungus and plant.',
  choicePrompt: 'Bane creature type',
  choiceOptions: ['aberration', 'animal', 'astral', 'beast', 'celestial', 'construct', 'dragon', 'dream', 'elemental', 'ethereal', 'fey', 'fiend', 'giant', 'monitor', 'ooze', 'spirit', 'time', 'undead', 'fungus and plant'],
  paths: [
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 2, text: '1 additional damage of the weapon\'s base type vs the bane type.', addDamage: f(1, 'untyped') },
        { level: 4, text: 'Additional damage → 1d4.', addDamage: d(1, 'd4', 'untyped') },
        { level: 6, text: 'Additional damage → 1d6; crit enfeebles the bane creature 1 until the end of your next turn.', addDamage: d(1, 'd6', 'untyped') },
        { level: 10, text: 'Vs the bane type, the base damage ignores the first 5 points of resistance.' },
        { level: 14, text: 'Crit: the bane creature attempts a Fortitude save — crit success enfeebled 1, success enfeebled 2, failure enfeebled 3, crit failure destroyed (incapacitation).' },
        { level: 16, text: 'Additional damage → 1d8.', addDamage: d(1, 'd8', 'untyped') },
        { level: 20, text: 'Additional damage → 1d10.', addDamage: d(1, 'd10', 'untyped') },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 2, text: 'Strikes deal 1 persistent bleed vs the bane type.', persistentDamage: f(1, 'bleed', true) },
        { level: 4, text: '1 additional base-type damage vs the bane type.', addDamage: f(1, 'untyped') },
        { level: 6, text: 'Persistent bleed → 1d6; crit enfeebles 1 until the end of your next turn.', persistentDamage: d(1, 'd6', 'bleed', true) },
        { level: 10, text: 'Vs the bane type, base damage and this bleed ignore the first 5 points of resistance.' },
        { level: 12, text: 'Persistent bleed → 1d8.', persistentDamage: d(1, 'd8', 'bleed', true) },
        { level: 14, text: 'Crit: enfeebled 2; Fortitude save — failure enfeebled 3, crit failure destroyed (incapacitation).' },
        { level: 16, text: 'Persistent bleed → 1d10.', persistentDamage: d(1, 'd10', 'bleed', true) },
        { level: 20, text: 'The crit enfeebled condition lasts as long as the persistent bleed (or the end of your next turn, whichever is longer).' },
      ],
    },
  ],
};

const CHAOTIC: MpProperty = {
  id: 'chaotic',
  name: 'Chaotic',
  appliesTo: ['weapon'],
  requirement: 'The monster has the unholy trait or an attack/spell dealing spirit damage.',
  effect: 'You imbue the weapon with roiling chaos to unmake order. It functions exactly like the Unholy property (gains the unholy trait, deals spirit damage, uses Unholy\'s paths) — themed around raw chaos; every rider that triggers "vs. a holy creature" applies to your lawful, order-bound foes. A holy creature that wields it is enfeebled and can\'t gain its benefits.',
  reusesPathsOf: 'unholy',
  paths: [],
};

const CHARISMA: MpProperty = {
  id: 'charisma',
  name: 'Charisma',
  appliesTo: ['skill'],
  requirement: 'The creature has Charisma as its highest or second-highest attribute modifier.',
  effect: 'Dazzling charisma. (Charisma-based skill item.)',
  apexAbility: 'cha',
  apexLevel: 17,
  paths: [
    {
      id: 'main',
      name: '',
      levels: [
        { level: 8, text: 'Cast heroism once/day (occult).' },
        { level: 14, text: 'heroism heightens to 6th.' },
        { level: 17, text: 'On investing, increase your Charisma modifier by 1 or to +4 (whichever is higher); gains the apex trait.' },
        { level: 20, text: 'heroism heightens to 9th.' },
      ],
    },
  ],
};

const COLD: MpProperty = {
  id: 'cold',
  name: 'Cold',
  appliesTo: ['weapon'],
  requirement: 'The monster has the cold trait or an attack/spell dealing cold damage.',
  effect: 'Chilling cold.',
  choicePrompt: 'Tradition (Magic path)',
  choiceOptions: ['arcane', 'primal'],
  paths: [
    {
      id: 'magic',
      name: 'Magic',
      note: 'arcane or primal',
      levels: [
        { level: 2, text: 'Cast Frostbite as a cantrip.' },
        { level: 4, text: 'Cast chilling spray once/day.' },
        { level: 6, text: 'chilling spray heightens to 2nd.' },
        { level: 8, text: '1 additional cold damage.', addDamage: f(1, 'cold') },
        { level: 10, text: 'Cast ice storm once/day.' },
        { level: 12, text: 'chilling spray heightens to 3rd; cast cone of cold once/day.' },
        { level: 14, text: 'Additional cold → 1d4.', addDamage: d(1, 'd4', 'cold') },
        { level: 16, text: 'chilling spray, cone of cold, ice storm heighten to 6th.' },
        { level: 18, text: 'Additional cold → 1d6.', addDamage: d(1, 'd6', 'cold') },
        { level: 20, text: 'Cast 9th-rank polar ray once/day.' },
      ],
    },
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 4, text: '1 additional cold damage.', addDamage: f(1, 'cold') },
        { level: 6, text: 'Additional cold → 1d4.', addDamage: d(1, 'd4', 'cold') },
        { level: 8, text: 'Additional cold → 1d6; crit also slows 1 until the end of your next turn (Fortitude negates).', addDamage: d(1, 'd6', 'cold') },
        { level: 12, text: 'The cold damage ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'Crit also imposes a −10-foot status penalty to Speeds for 1 round.' },
        { level: 18, text: 'Additional cold → 1d8.', addDamage: d(1, 'd8', 'cold') },
        { level: 20, text: 'Before applying cold, the target gains weakness 1 to cold until the start of your next turn.' },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 4, text: '1 persistent cold damage.', persistentDamage: f(1, 'cold', true) },
        { level: 6, text: 'On a hit, the target takes a −5-foot status penalty to Speeds for 1 round.' },
        { level: 8, text: 'Crit slows 1 (Fortitude negates); the Speed penalty increases to −10.' },
        { level: 12, text: 'The persistent cold ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'The Speed penalty lasts as long as the persistent cold.' },
        { level: 16, text: 'A foe adjacent to a surface who crit-fails the slow save freezes there (immobilized until it Escapes vs. the item DC).' },
        { level: 18, text: 'Persistent cold → 1d4.', persistentDamage: d(1, 'd4', 'cold', true) },
        { level: 20, text: 'The Speed penalty increases to −15.' },
      ],
    },
  ],
};

const CONSTITUTION: MpProperty = {
  id: 'constitution',
  name: 'Constitution',
  appliesTo: ['skill'],
  requirement: 'The creature has Constitution as its highest or second-highest attribute modifier.',
  effect: 'Resilient constitution. (Skill item.)',
  apexAbility: 'con',
  apexLevel: 17,
  paths: [
    {
      id: 'main',
      name: '',
      levels: [
        { level: 8, text: 'Cast 3rd-rank heal (on you only) once/day (divine).' },
        { level: 14, text: 'heal heightens to 6th.' },
        { level: 17, text: 'On investing, increase your Constitution modifier by 1 or to +4 (whichever is higher); gains the apex trait.' },
        { level: 18, text: 'heal heightens to 7th, or instead cast regenerate on yourself once/day.' },
        { level: 20, text: 'Resting for 10 minutes recovers 100 Hit Points.' },
      ],
    },
  ],
};

const DEXTERITY: MpProperty = {
  id: 'dexterity',
  name: 'Dexterity',
  appliesTo: ['skill'],
  requirement: 'The creature has Dexterity as its highest or second-highest attribute modifier.',
  effect: 'Deft dexterity. (Dexterity-based skill item.)',
  apexAbility: 'dex',
  apexLevel: 17,
  paths: [
    {
      id: 'main',
      name: '',
      levels: [
        { level: 8, text: 'Once/day, a single-action Interact grants a +10-foot status bonus to all Speeds for 10 minutes.' },
        { level: 14, text: 'The bonus → +20 feet, and you gain water walk while active.' },
        { level: 17, text: 'On investing, increase your Dexterity modifier by 1 or to +4 (whichever is higher); gains the apex trait.' },
        { level: 20, text: 'The bonus → +30 feet, and you gain both air walk and water walk while active.' },
      ],
    },
  ],
};

const ELECTRICITY: MpProperty = {
  id: 'electricity',
  name: 'Electricity',
  appliesTo: ['weapon'],
  requirement: 'The monster has the electricity trait or an attack/spell dealing electricity damage.',
  effect: 'Shocking electricity.',
  choicePrompt: 'Tradition (Magic path)',
  choiceOptions: ['arcane', 'primal'],
  paths: [
    {
      id: 'magic',
      name: 'Magic',
      note: 'arcane or primal',
      levels: [
        { level: 2, text: 'Cast electric arc as a cantrip.' },
        { level: 4, text: 'Cast shocking grasp once/day.' },
        { level: 6, text: 'shocking grasp heightens to 2nd.' },
        { level: 8, text: 'Cast lightning bolt once/day.' },
        { level: 10, text: '1 additional electricity damage.', addDamage: f(1, 'electricity') },
        { level: 12, text: 'lightning bolt heightens to 4th; cast lightning storm once/day.' },
        { level: 14, text: 'Additional electricity → 1d4.', addDamage: d(1, 'd4', 'electricity') },
        { level: 16, text: 'Cast chain lightning (no longer lightning bolt); shocking grasp and lightning storm heighten to 6th.' },
        { level: 18, text: 'Additional electricity → 1d6.', addDamage: d(1, 'd6', 'electricity') },
        { level: 20, text: 'chain lightning heightens to 9th; lightning storm and shocking grasp to 7th.' },
      ],
    },
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 4, text: '1 additional electricity damage.', addDamage: f(1, 'electricity') },
        { level: 6, text: 'Additional electricity → 1d4.', addDamage: d(1, 'd4', 'electricity') },
        { level: 8, text: 'Additional electricity → 1d6; crit arcs equal electricity to up to two creatures within 10 feet.', addDamage: d(1, 'd6', 'electricity') },
        { level: 12, text: 'The electricity damage ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'The arc reaches up to 20 feet.' },
        { level: 18, text: 'Additional electricity → 1d8.', addDamage: d(1, 'd8', 'electricity') },
        { level: 20, text: 'Before applying electricity, the target gains weakness 1 to electricity until the start of your next turn.' },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 4, text: '1 persistent electricity damage.', persistentDamage: f(1, 'electricity', true) },
        { level: 6, text: '1 additional electricity damage.', addDamage: f(1, 'electricity') },
        { level: 8, text: 'Persistent electricity → 1d6; crit arcs equal damage + persistent to up to two creatures within 10 feet.', persistentDamage: d(1, 'd6', 'electricity', true) },
        { level: 12, text: 'The electricity damage (incl. persistent) ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'Persistent electricity → 1d8.', persistentDamage: d(1, 'd8', 'electricity', true) },
        { level: 16, text: 'Crit arc reaches up to four creatures within 20 feet.' },
        { level: 18, text: 'Persistent electricity → 1d10.', persistentDamage: d(1, 'd10', 'electricity', true) },
        { level: 20, text: 'Foes with this persistent electricity are magnetized: metal-weapon Strikes gain a +1 circumstance bonus to hit them while it lasts.' },
      ],
    },
  ],
};

const ENERGY_RESISTANT: MpProperty = {
  id: 'energy-resistant',
  name: 'Energy Resistant',
  appliesTo: ['armor', 'shield'],
  requirement: 'The monster has resistance or immunity to the chosen energy type.',
  effect: 'Choose acid, cold, electricity, fire, force, void, vitality, or sonic. While worn/wielded, you and the item gain resistance to that type equal to this property\'s level; a shield may Shield Block against that type in addition to its normal trigger. Armor may take this multiple times (a different type each).',
  resistance: { choices: ['acid', 'cold', 'electricity', 'fire', 'force', 'void', 'vitality', 'sonic'] },
  choicePrompt: 'Energy type',
  choiceOptions: ['acid', 'cold', 'electricity', 'fire', 'force', 'void', 'vitality', 'sonic'],
  paths: [{ id: 'main', name: '', levels: [{ level: 1, text: 'Resistance to the chosen energy type equal to this property\'s level.' }] }],
};

const FIRE: MpProperty = {
  id: 'fire',
  name: 'Fire',
  appliesTo: ['weapon'],
  requirement: 'The monster has the fire trait or an attack/spell dealing fire damage.',
  effect: 'Burning fire.',
  choicePrompt: 'Tradition (Magic path)',
  choiceOptions: ['arcane', 'primal'],
  paths: [
    {
      id: 'magic',
      name: 'Magic',
      note: 'arcane or primal',
      levels: [
        { level: 2, text: 'Cast Ignition as a cantrip.' },
        { level: 4, text: 'Cast Breathe Fire once/day.' },
        { level: 6, text: 'Breathe Fire heightens to 2nd.' },
        { level: 8, text: 'Cast Floating Flame and fireball each once/day (no longer Breathe Fire).' },
        { level: 10, text: '1 additional fire damage.', addDamage: f(1, 'fire') },
        { level: 12, text: 'fireball and Floating Flame heighten to 4th; cast wall of fire once/day.' },
        { level: 14, text: 'Additional fire → 1d4.', addDamage: d(1, 'd4', 'fire') },
        { level: 16, text: 'fireball, Floating Flame, wall of fire heighten to 6th.' },
        { level: 18, text: 'Additional fire → 1d6.', addDamage: d(1, 'd6', 'fire') },
        { level: 20, text: 'Cast Falling Stars once/day.' },
      ],
    },
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 4, text: '1 additional fire damage.', addDamage: f(1, 'fire') },
        { level: 6, text: 'Additional fire → 1d4.', addDamage: d(1, 'd4', 'fire') },
        { level: 8, text: 'Additional fire → 1d6; crit deals 1d10 persistent fire.', addDamage: d(1, 'd6', 'fire') },
        { level: 12, text: 'The fire damage (incl. persistent) ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'Crit persistent → 2d10.' },
        { level: 18, text: 'Additional fire → 1d8.', addDamage: d(1, 'd8', 'fire') },
        { level: 20, text: 'Before applying fire, the target gains weakness 1 to fire until the start of your next turn.' },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 4, text: '1 persistent fire damage.', persistentDamage: f(1, 'fire', true) },
        { level: 6, text: '1 additional fire damage.', addDamage: f(1, 'fire') },
        { level: 8, text: 'Persistent fire → 1d6; crit deals an extra 1d10 persistent fire (added after doubling).', persistentDamage: d(1, 'd6', 'fire', true) },
        { level: 12, text: 'The fire damage (incl. persistent) ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'Persistent fire → 1d8.', persistentDamage: d(1, 'd8', 'fire', true) },
        { level: 16, text: 'Foes taking this persistent fire are off-guard.' },
        { level: 18, text: 'Persistent fire → 1d10.', persistentDamage: d(1, 'd10', 'fire', true) },
        { level: 20, text: 'At the end of a burning foe\'s turn, all foes adjacent to it also catch fire, taking the same persistent fire.' },
      ],
    },
  ],
};

const FORCE: MpProperty = {
  id: 'force',
  name: 'Force',
  appliesTo: ['weapon'],
  requirement: 'The monster has the force trait or an attack/spell dealing force damage.',
  effect: 'Pure force.',
  choicePrompt: 'Tradition (Magic path)',
  choiceOptions: ['arcane', 'divine', 'occult'],
  paths: [
    {
      id: 'magic',
      name: 'Magic',
      note: 'arcane, divine, or occult',
      levels: [
        { level: 2, text: 'Cast shield as a cantrip.' },
        { level: 4, text: 'Cast Force Barrage once/day.' },
        { level: 6, text: 'Cast either Force Barrage or Spiritual Armament once/day, not both.' },
        { level: 8, text: 'Force Barrage heightens to 3rd; cast both Force Barrage and Spiritual Armament once/day.' },
        { level: 10, text: '1 additional force damage.', addDamage: f(1, 'force') },
        { level: 12, text: 'Spiritual Armament heightens to 4th; cast spiritual guardian once/day.' },
        { level: 14, text: 'Additional force → 1d4.', addDamage: d(1, 'd4', 'force') },
        { level: 16, text: 'Force Barrage heightens to 5th, spiritual guardian to 6th; cast spirit blast once/day (no longer Spiritual Armament).' },
        { level: 18, text: 'Additional force → 1d6.', addDamage: d(1, 'd6', 'force') },
        { level: 20, text: 'Cast 9th-rank spirit song once/day.' },
      ],
    },
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 4, text: '1 additional force damage.', addDamage: f(1, 'force') },
        { level: 6, text: 'Additional force → 1d4.', addDamage: d(1, 'd4', 'force') },
        { level: 8, text: 'Additional force → 1d6.', addDamage: d(1, 'd6', 'force') },
        { level: 10, text: 'Crit: Fortitude save or the target is pushed 5 feet away from you.' },
        { level: 12, text: 'The force damage ignores resistances.', ignoreResistance: true },
        { level: 16, text: 'Crit + failed save pushes 10 feet.' },
        { level: 18, text: 'Additional force → 1d8.', addDamage: d(1, 'd8', 'force') },
        { level: 20, text: 'Before applying force, the target gains weakness 1 to force until the start of your next turn.' },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 4, text: '1 persistent force damage.', persistentDamage: f(1, 'force', true) },
        { level: 6, text: '1 additional force damage.', addDamage: f(1, 'force') },
        { level: 8, text: 'Crit: Fortitude save or the target is pushed 5 feet away from you.' },
        { level: 10, text: 'Persistent force → 1d6.', persistentDamage: d(1, 'd6', 'force', true) },
        { level: 12, text: 'The force damage (incl. persistent) ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'Crit + failed save pushes up to 10 feet.' },
        { level: 16, text: 'Foes with this persistent force are off-guard.' },
        { level: 18, text: 'Crit + failed save pushes up to 20 feet.' },
        { level: 20, text: 'At the end of a foe\'s turn, if it fails to remove the persistent force it must succeed at a Fortitude save or fall prone.' },
      ],
    },
  ],
};

const FORTIFICATION: MpProperty = {
  id: 'fortification',
  name: 'Fortification',
  appliesTo: ['armor'],
  requirement: 'The monster has resistance or immunity to precision damage or critical hits. (Medium or heavy armor only.)',
  effect: 'Thickens the armor (+1 Bulk, +2 to the Strength required to reduce its penalties). From 6th level, when you\'re critically hit, attempt a DC 20 flat check to make it a normal hit; the DC drops by 1 at 8th level and every 2 levels thereafter (minimum DC 13 at 20th).',
  paths: [
    {
      id: 'main',
      name: '',
      levels: [
        { level: 6, text: 'When critically hit, DC 20 flat check to make it a normal hit.' },
        { level: 8, text: 'Flat-check DC drops to 19.' },
        { level: 10, text: 'Flat-check DC drops to 18.' },
        { level: 12, text: 'Flat-check DC drops to 17.' },
        { level: 14, text: 'Flat-check DC drops to 16.' },
        { level: 16, text: 'Flat-check DC drops to 15.' },
        { level: 18, text: 'Flat-check DC drops to 14.' },
        { level: 20, text: 'Flat-check DC drops to 13 (minimum).' },
      ],
    },
  ],
};

const HOLY: MpProperty = {
  id: 'holy',
  name: 'Holy',
  appliesTo: ['weapon'],
  requirement: 'The monster has the holy trait or an attack/spell dealing spirit damage.',
  effect: 'Radiant, sanctified energy to defeat unholy foes. The weapon gains the holy trait. An unholy creature that wields it is enfeebled and can\'t gain its benefits.',
  paths: [
    {
      id: 'magic',
      name: 'Magic',
      note: 'always divine; castings gain the holy trait',
      levels: [
        { level: 2, text: 'Cast divine lance as a cantrip (it deals spirit damage, holy).' },
        { level: 4, text: 'Cast protection once/day, choosing the unholy trait for the increased bonus.' },
        { level: 8, text: 'Cast Holy Light once/day.' },
        { level: 10, text: 'Cast divine wrath once/day (as a holy spell).' },
        { level: 12, text: '1 additional spirit damage.', addDamage: f(1, 'spirit') },
        { level: 14, text: 'Additional spirit → 1d4.', addDamage: d(1, 'd4', 'spirit') },
        { level: 16, text: 'Cast divine decree (holy); divine wrath heightens to 5th.' },
        { level: 18, text: 'Additional spirit → 1d6.', addDamage: d(1, 'd6', 'spirit') },
        { level: 20, text: 'Cast divine aura (holy); divine decree heightens to 8th, divine wrath to 7th.' },
      ],
    },
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 6, text: '1 additional spirit damage.', addDamage: f(1, 'spirit') },
        { level: 8, text: 'Additional spirit → 1d4.', addDamage: d(1, 'd4', 'spirit') },
        { level: 10, text: 'Additional spirit → 1d6.', addDamage: d(1, 'd6', 'spirit') },
        { level: 12, text: 'Crit vs. an unholy creature: it takes a −2 status penalty to attacks against creatures other than you (until the end of your next turn).' },
        { level: 14, text: 'The spirit damage ignores resistances.', ignoreResistance: true },
        { level: 18, text: 'Additional spirit → 1d8.', addDamage: d(1, 'd8', 'spirit') },
        { level: 20, text: 'Before applying spirit, an unholy target gains weakness 1 to spirit until the start of your next turn.' },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 6, text: '1 additional spirit damage.', addDamage: f(1, 'spirit') },
        { level: 8, text: '1 persistent spirit damage.', persistentDamage: f(1, 'spirit', true) },
        { level: 10, text: 'Persistent spirit → 1d6.', persistentDamage: d(1, 'd6', 'spirit', true) },
        { level: 12, text: 'Crit vs. an unholy creature: it takes a −1 status penalty to attacks against creatures other than you.' },
        { level: 14, text: 'The spirit damage (incl. persistent) ignores resistances.', ignoreResistance: true },
        { level: 16, text: 'Crit vs. an unholy creature: if it attacks/damages another creature before the end of your next turn, it\'s off-guard to your imbued-weapon attacks until the end of your next turn.' },
        { level: 18, text: 'Persistent spirit → 1d10.', persistentDamage: d(1, 'd10', 'spirit', true) },
        { level: 20, text: 'Each time an unholy creature attacks/damages another creature, it takes the 1d10 persistent spirit and immediately attempts its end-of-turn flat check.' },
      ],
    },
  ],
};

const INTELLIGENCE: MpProperty = {
  id: 'intelligence',
  name: 'Intelligence',
  appliesTo: ['skill'],
  requirement: 'The creature has Intelligence as its highest or second-highest attribute modifier.',
  effect: 'Brilliant intelligence. (Intelligence-based skill item.)',
  apexAbility: 'int',
  apexLevel: 17,
  paths: [
    {
      id: 'main',
      name: '',
      levels: [
        { level: 8, text: 'Cast hypercognition once/day (occult).' },
        { level: 14, text: 'hypercognition once/hour instead.' },
        { level: 17, text: 'On investing, increase your Intelligence modifier by 1 or to +4 (whichever is higher); gains the apex trait.' },
        { level: 20, text: 'hypercognition once/minute instead.' },
      ],
    },
  ],
};

const LAWFUL: MpProperty = {
  id: 'lawful',
  name: 'Lawful',
  appliesTo: ['weapon'],
  requirement: 'The monster has the holy trait or an attack/spell dealing spirit damage.',
  effect: 'You imbue the weapon with rigid law to crush disorder. It functions exactly like the Holy property (gains the holy trait, deals spirit damage, uses Holy\'s paths) — themed around implacable order; every rider that triggers "vs. an unholy creature" applies to your chaotic foes. An unholy creature that wields it is enfeebled and can\'t gain its benefits.',
  reusesPathsOf: 'holy',
  paths: [],
};

const MENTAL: MpProperty = {
  id: 'mental',
  name: 'Mental',
  appliesTo: ['weapon'],
  requirement: 'The monster has the astral or mental trait or an attack/spell dealing mental damage.',
  effect: 'Psychic power.',
  choicePrompt: 'Tradition (Magic path)',
  choiceOptions: ['arcane', 'occult'],
  paths: [
    {
      id: 'magic',
      name: 'Magic',
      note: 'arcane or occult',
      levels: [
        { level: 2, text: 'Cast daze as a cantrip.' },
        { level: 4, text: 'Cast phantom pain once/day.' },
        { level: 6, text: 'phantom pain heightens to 2nd; cast either phantom pain or warrior\'s regret once/day, not both.' },
        { level: 8, text: 'Both heighten to 3rd; cast both once/day.' },
        { level: 10, text: '1 additional mental damage.', addDamage: f(1, 'mental') },
        { level: 12, text: 'Both heighten to 4th; cast Vision of Death once/day.' },
        { level: 14, text: 'Additional mental → 1d4.', addDamage: d(1, 'd4', 'mental') },
        { level: 16, text: 'phantom pain and Vision of Death heighten to 6th; cast phantasmal calamity once/day (no longer warrior\'s regret).' },
        { level: 18, text: 'Additional mental → 1d6.', addDamage: d(1, 'd6', 'mental') },
        { level: 20, text: 'Cast Phantasmagoria once/day.' },
      ],
    },
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 4, text: '1 additional mental damage.', addDamage: f(1, 'mental') },
        { level: 6, text: 'Additional mental → 1d4.', addDamage: d(1, 'd4', 'mental') },
        { level: 8, text: 'Additional mental → 1d6.', addDamage: d(1, 'd6', 'mental') },
        { level: 10, text: 'Crit: stupefied 1 for 1 round.' },
        { level: 12, text: 'The mental damage ignores resistances.', ignoreResistance: true },
        { level: 16, text: 'Crit: stupefied 2 for 1 round.' },
        { level: 18, text: 'Additional mental → 1d8.', addDamage: d(1, 'd8', 'mental') },
        { level: 20, text: 'Before applying mental, the target gains weakness 1 to mental until the start of your next turn.' },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 4, text: '1 persistent mental damage.', persistentDamage: f(1, 'mental', true) },
        { level: 6, text: '1 additional mental damage.', addDamage: f(1, 'mental') },
        { level: 8, text: 'Crit: stupefied 1 for 1 round.' },
        { level: 10, text: 'Persistent mental → 1d6.', persistentDamage: d(1, 'd6', 'mental', true) },
        { level: 12, text: 'The mental damage (incl. persistent) ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'Persistent mental → 1d8.', persistentDamage: d(1, 'd8', 'mental', true) },
        { level: 16, text: 'Crit: stupefied 2 for 1 round.' },
        { level: 18, text: 'Persistent mental → 1d10.', persistentDamage: d(1, 'd10', 'mental', true) },
        { level: 20, text: 'While the foe has this persistent mental, the crit stupefied lasts until the persistent damage ends or 1 round, whichever is longer.' },
      ],
    },
  ],
};

const POISON: MpProperty = {
  id: 'poison',
  name: 'Poison',
  appliesTo: ['weapon'],
  requirement: 'The monster has the poison trait or an attack/spell dealing poison damage.',
  effect: 'Toxic venom.',
  choicePrompt: 'Tradition (Magic path)',
  choiceOptions: ['arcane', 'primal'],
  paths: [
    {
      id: 'magic',
      name: 'Magic',
      note: 'arcane or primal',
      levels: [
        { level: 2, text: 'Cast puff of poison as a cantrip.' },
        { level: 4, text: 'Cast spider sting once/day.' },
        { level: 6, text: 'Cast 2nd-rank noxious vapors or spider sting once/day, not both.' },
        { level: 8, text: 'noxious vapors heightens to 3rd; cast noxious vapors, imp sting, and spider sting each once/day.' },
        { level: 10, text: '1 additional poison damage.', addDamage: f(1, 'poison') },
        { level: 12, text: 'noxious vapors heightens to 4th; cast swarming wasp stings once/day.' },
        { level: 14, text: 'Additional poison → 1d4.', addDamage: d(1, 'd4', 'poison') },
        { level: 16, text: 'noxious vapors heightens to 6th; cast purple worm sting once/day.' },
        { level: 18, text: 'Additional poison → 1d6.', addDamage: d(1, 'd6', 'poison') },
        { level: 20, text: 'Cast linnorm sting once/day.' },
      ],
    },
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 4, text: '1 additional poison damage.', addDamage: f(1, 'poison') },
        { level: 6, text: 'Additional poison → 1d4.', addDamage: d(1, 'd4', 'poison') },
        { level: 8, text: 'Additional poison → 1d6; crit deals 1d10 persistent poison.', addDamage: d(1, 'd6', 'poison') },
        { level: 12, text: 'The poison damage ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'Crit persistent → 2d10.' },
        { level: 18, text: 'Additional poison → 1d8.', addDamage: d(1, 'd8', 'poison') },
        { level: 20, text: 'Before applying poison, the target gains weakness 1 to poison until the start of your next turn.' },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 4, text: '1 persistent poison damage.', persistentDamage: f(1, 'poison', true) },
        { level: 6, text: '1 additional poison damage.', addDamage: f(1, 'poison') },
        { level: 8, text: 'Persistent poison → 1d6; crit deals an extra 1d10 persistent poison (added after doubling).', persistentDamage: d(1, 'd6', 'poison', true) },
        { level: 12, text: 'The poison damage (incl. persistent) ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'Persistent poison → 1d8.', persistentDamage: d(1, 'd8', 'poison', true) },
        { level: 16, text: 'At the end of a creature\'s turn that still has this persistent poison, choose clumsy, enfeebled, or stupefied — it gains/increases that condition by 1 (max 3); removing the poison ends it.' },
        { level: 18, text: 'Persistent poison → 1d10.', persistentDamage: d(1, 'd10', 'poison', true) },
        { level: 20, text: 'On a crit, the target is drained 1.' },
      ],
    },
  ],
};

const SENSORY: MpProperty = {
  id: 'sensory',
  name: 'Sensory',
  appliesTo: ['perception'],
  requirement: 'The creature has the next sense to be granted — low-light vision (lvls 1–6), darkvision (6–12), scent (12–16), greater darkvision (16–18), truesight (18–20).',
  effect: 'Extraordinary senses.',
  senses: [
    { level: 6, sense: 'low-light vision' },
    { level: 12, sense: 'darkvision' },
    { level: 16, sense: '30-foot imprecise scent' },
    { level: 18, sense: 'greater darkvision' },
    { level: 20, sense: '6th-rank truesight (constant)' },
  ],
  paths: [
    {
      id: 'main',
      name: '',
      levels: [
        { level: 4, text: 'Once/day, a two-action envision activation grants low-light vision for 1 hour.' },
        { level: 6, text: 'While invested, gain low-light vision.' },
        { level: 8, text: 'Once/day, a two-action envision grants darkvision for 1 hour.' },
        { level: 12, text: 'While invested, gain darkvision.' },
        { level: 14, text: 'Once/day, a two-action envision grants 30-foot imprecise scent for 1 hour.' },
        { level: 16, text: 'While invested, gain 30-foot imprecise scent.' },
        { level: 18, text: 'While invested, gain greater darkvision.' },
        { level: 20, text: 'While invested, constantly gain the effects of 6th-rank Truesight.' },
      ],
    },
  ],
};

const SONIC: MpProperty = {
  id: 'sonic',
  name: 'Sonic',
  appliesTo: ['weapon'],
  requirement: 'The monster has the sonic trait or an attack/spell dealing sonic damage.',
  effect: 'Reverberating sound waves.',
  paths: [
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 4, text: '1 additional sonic damage.', addDamage: f(1, 'sonic') },
        { level: 6, text: 'Additional sonic → 1d4.', addDamage: d(1, 'd4', 'sonic') },
        { level: 8, text: 'Additional sonic → 1d6; crit: Fortitude save or deafened 1 minute (1 hour on a crit failure).', addDamage: d(1, 'd6', 'sonic') },
        { level: 12, text: 'The sonic damage ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'The deafness is permanent on a failure or crit failure.' },
        { level: 18, text: 'Additional sonic → 1d8.', addDamage: d(1, 'd8', 'sonic') },
        { level: 20, text: 'Before applying sonic, the target gains weakness 1 to sonic until the start of your next turn.' },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 4, text: '1 persistent sonic damage.', persistentDamage: f(1, 'sonic', true) },
        { level: 6, text: '1 additional sonic damage.', addDamage: f(1, 'sonic') },
        { level: 8, text: 'Persistent sonic → 1d6; crit: Fortitude save or deafened 1 minute (1 hour on a crit failure).', persistentDamage: d(1, 'd6', 'sonic', true) },
        { level: 12, text: 'The sonic damage (incl. persistent) ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'Persistent sonic → 1d8.', persistentDamage: d(1, 'd8', 'sonic', true) },
        { level: 16, text: 'Deafness is permanent and the target is also stunned 1 on a failure or crit failure.' },
        { level: 18, text: 'Persistent sonic → 1d10.', persistentDamage: d(1, 'd10', 'sonic', true) },
        { level: 20, text: 'The sonic + persistent sonic create a boom hitting all creatures adjacent to the target whose AC ≤ your attack roll; on a crit they attempt the Fortitude save vs. deafened + stunned.' },
      ],
    },
  ],
};

const SPELL: MpProperty = {
  id: 'spell',
  name: 'Spell',
  appliesTo: ['skill'],
  requirement: 'The creature has the matching skill or can cast the chosen spell.',
  effect: 'Imbue the item with a spell. Use a suggested spell or work with the GM (avoid long-lasting buffs like Mystic Armor and self-only spells like Sure Strike). Pick a tradition that can cast it. At 4th level you can imbue a 1st-rank spell; every 2 levels thereafter the cap rises by one rank (a kept spell heightens to the new cap).',
  choicePrompt: 'Imbued spell',
  paths: [
    {
      id: 'main',
      name: '',
      levels: [
        { level: 4, text: 'Cast the chosen 1st-rank spell once/day.' },
        { level: 6, text: 'The spell heightens to 2nd.' },
        { level: 8, text: 'The spell heightens to 3rd.' },
        { level: 10, text: 'The spell heightens to 4th.' },
        { level: 12, text: 'The spell heightens to 5th.' },
        { level: 14, text: 'The spell heightens to 6th.' },
        { level: 16, text: 'The spell heightens to 7th.' },
        { level: 18, text: 'The spell heightens to 8th.' },
        { level: 20, text: 'The spell heightens to 9th.' },
      ],
    },
  ],
};

const STRENGTH: MpProperty = {
  id: 'strength',
  name: 'Strength',
  appliesTo: ['skill'],
  requirement: 'The creature has Strength as its highest or second-highest attribute modifier.',
  effect: 'Ferocious strength. (Athletics skill item.)',
  apexAbility: 'str',
  apexLevel: 17,
  paths: [
    {
      id: 'main',
      name: '',
      levels: [
        { level: 8, text: 'Cast earthbind once/day (primal).' },
        { level: 14, text: 'earthbind once/hour instead.' },
        { level: 17, text: 'On investing, increase your Strength modifier by 1 or to +4 (whichever is higher); gains the apex trait.' },
        { level: 20, text: 'earthbind once/minute instead.' },
      ],
    },
  ],
};

const STURDY: MpProperty = {
  id: 'sturdy',
  name: 'Sturdy',
  appliesTo: ['shield'],
  requirement: 'The monster has Hardness or resistance to physical damage (or one physical type).',
  effect: 'While this property\'s level equals the shield\'s item level, increase the shield\'s Hardness by 3 (−1 per level the property is below the shield\'s level, minimum 0 at 3+ levels below). If Hardness rises by at least 1, also add +2 HP and +1 BT per point of added Hardness.',
  paths: [{ id: 'main', name: '', levels: [{ level: 1, text: 'Increases the shield\'s Hardness by up to 3 (scaling with how close this property\'s level is to the shield\'s), plus +2 HP and +1 BT per point of added Hardness.' }] }],
};

const UNHOLY: MpProperty = {
  id: 'unholy',
  name: 'Unholy',
  appliesTo: ['weapon'],
  requirement: 'The monster has the unholy trait or an attack/spell dealing spirit damage.',
  effect: 'Profane, corrupt energy to defeat holy foes. The weapon gains the unholy trait. A holy creature that wields it is enfeebled and can\'t gain its benefits.',
  paths: [
    {
      id: 'magic',
      name: 'Magic',
      note: 'always divine; castings gain the unholy trait',
      levels: [
        { level: 2, text: 'Cast divine lance as a cantrip (it deals spirit damage, unholy).' },
        { level: 4, text: 'Cast protection once/day, choosing the holy trait for the increased bonus.' },
        { level: 8, text: 'Cast chilling darkness once/day.' },
        { level: 10, text: 'Cast divine wrath once/day (as an unholy spell).' },
        { level: 12, text: '1 additional spirit damage.', addDamage: f(1, 'spirit') },
        { level: 14, text: 'Additional spirit → 1d4.', addDamage: d(1, 'd4', 'spirit') },
        { level: 16, text: 'Cast divine decree (unholy); divine wrath heightens to 5th.' },
        { level: 18, text: 'Additional spirit → 1d6.', addDamage: d(1, 'd6', 'spirit') },
        { level: 20, text: 'Cast divine aura (unholy); divine decree heightens to 8th, divine wrath to 7th.' },
      ],
    },
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 6, text: '1 additional spirit damage.', addDamage: f(1, 'spirit') },
        { level: 8, text: 'Additional spirit → 1d4.', addDamage: d(1, 'd4', 'spirit') },
        { level: 10, text: 'Additional spirit → 1d6.', addDamage: d(1, 'd6', 'spirit') },
        { level: 12, text: 'Crit vs. a holy creature: deal 1d10 persistent bleed.' },
        { level: 14, text: 'The spirit damage ignores resistances.', ignoreResistance: true },
        { level: 18, text: 'Additional spirit → 1d8.', addDamage: d(1, 'd8', 'spirit') },
        { level: 20, text: 'Before applying spirit, a holy target gains weakness 1 to spirit until the start of your next turn.' },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 6, text: '1 additional spirit damage.', addDamage: f(1, 'spirit') },
        { level: 8, text: '1 persistent spirit damage.', persistentDamage: f(1, 'spirit', true) },
        { level: 10, text: 'Persistent spirit → 1d6.', persistentDamage: d(1, 'd6', 'spirit', true) },
        { level: 12, text: 'Crit vs. a holy creature: it also takes 1d10 persistent bleed.' },
        { level: 14, text: 'The spirit damage (incl. persistent bleed and spirit) ignores resistances.', ignoreResistance: true },
        { level: 16, text: 'Crit vs. a holy creature: it becomes frightened 1.' },
        { level: 18, text: 'Persistent spirit → 1d10.', persistentDamage: d(1, 'd10', 'spirit', true) },
        { level: 20, text: 'While affected by this persistent spirit, a holy creature can\'t reduce its frightened value below 1 at the end of its turn.' },
      ],
    },
  ],
};

const VITALITY: MpProperty = {
  id: 'vitality',
  name: 'Vitality',
  appliesTo: ['weapon'],
  requirement: 'The monster has the holy trait or an attack/spell dealing vitality damage.',
  effect: 'The cleansing power of vitality to damage undead. Vitality damage only harms undead and other creatures with void healing (such as dhampirs).',
  choicePrompt: 'Tradition (Magic path)',
  choiceOptions: ['divine', 'primal'],
  paths: [
    {
      id: 'magic',
      name: 'Magic',
      note: 'divine or primal',
      levels: [
        { level: 2, text: 'Cast Vitality Lash as a cantrip.' },
        { level: 4, text: 'Cast heal once/day.' },
        { level: 6, text: 'heal heightens to 2nd.' },
        { level: 8, text: 'Cast 3rd-rank Infuse Vitality once/day.' },
        { level: 10, text: '1 additional vitality damage.', addDamage: f(1, 'vitality') },
        { level: 12, text: 'heal heightens to 4th; cast breath of life once/day.' },
        { level: 14, text: 'Additional vitality → 1d4.', addDamage: d(1, 'd4', 'vitality') },
        { level: 16, text: 'Cast regenerate once/day; Infuse Vitality and heal heighten to 5th.' },
        { level: 18, text: 'Additional vitality → 1d6.', addDamage: d(1, 'd6', 'vitality') },
        { level: 20, text: 'heal and regenerate heighten to 8th.' },
      ],
    },
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 2, text: '1 additional vitality damage.', addDamage: f(1, 'vitality') },
        { level: 4, text: 'Additional vitality → 1d4.', addDamage: d(1, 'd4', 'vitality') },
        { level: 6, text: 'Additional vitality → 1d6; crit: the undead is enfeebled 1 until the end of your next turn.', addDamage: d(1, 'd6', 'vitality') },
        { level: 10, text: 'The vitality damage ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'Crit: the undead attempts a Fortitude save — crit success enfeebled 1, success enfeebled 2, failure enfeebled 3, crit failure destroyed (incapacitation).' },
        { level: 18, text: 'Additional vitality → 1d8.', addDamage: d(1, 'd8', 'vitality') },
        { level: 20, text: 'Before applying vitality, the target gains weakness 1 to vitality until the start of your next turn.' },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 2, text: '1 persistent vitality damage.', persistentDamage: f(1, 'vitality', true) },
        { level: 4, text: '1 additional vitality damage.', addDamage: f(1, 'vitality') },
        { level: 6, text: 'Persistent vitality → 1d6; crit enfeebles the undead 1 until the end of your next turn.', persistentDamage: d(1, 'd6', 'vitality', true) },
        { level: 10, text: 'The vitality damage (incl. persistent) ignores resistances.', ignoreResistance: true },
        { level: 12, text: 'Persistent vitality → 1d8.', persistentDamage: d(1, 'd8', 'vitality', true) },
        { level: 14, text: 'Crit: enfeebled 2; Fortitude save — failure enfeebled 3, crit failure destroyed (incapacitation).' },
        { level: 18, text: 'Persistent vitality → 1d10.', persistentDamage: d(1, 'd10', 'vitality', true) },
        { level: 20, text: 'Creatures with this persistent vitality struggle to heal from void energy: if a void effect would restore their HP, they must first counteract this property (level 20, DC 43); even on a success the HP recovered is reduced by 1d10 (full amount on a critical success).' },
      ],
    },
  ],
};

const VOID: MpProperty = {
  id: 'void',
  name: 'Void',
  appliesTo: ['weapon'],
  requirement: 'The monster has the undead trait or void healing, or an attack/spell dealing void damage.',
  effect: 'Void energy, cosmological destruction.',
  choicePrompt: 'Tradition (Magic path)',
  choiceOptions: ['divine', 'primal'],
  paths: [
    {
      id: 'magic',
      name: 'Magic',
      note: 'divine or primal',
      levels: [
        { level: 2, text: 'Cast Void Warp as a cantrip.' },
        { level: 4, text: 'Cast harm once/day.' },
        { level: 6, text: 'harm heightens to 2nd; cast either harm or sudden blight once/day, not both.' },
        { level: 8, text: 'Both heighten to 3rd; cast both once/day.' },
        { level: 10, text: '1 additional void damage.', addDamage: f(1, 'void') },
        { level: 12, text: 'Both heighten to 4th; cast enervation once/day.' },
        { level: 14, text: 'Additional void → 1d4.', addDamage: d(1, 'd4', 'void') },
        { level: 16, text: 'enervation and harm heighten to 6th; cast necrotize once/day (no longer sudden blight).' },
        { level: 18, text: 'Additional void → 1d6.', addDamage: d(1, 'd6', 'void') },
        { level: 20, text: 'Cast Wails of the Damned once/day.' },
      ],
    },
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 4, text: '1 additional void damage.', addDamage: f(1, 'void') },
        { level: 6, text: 'Additional void → 1d4.', addDamage: d(1, 'd4', 'void') },
        { level: 8, text: 'Additional void → 1d6.', addDamage: d(1, 'd6', 'void') },
        { level: 10, text: 'Crit: enfeebled 1 for 1 round.' },
        { level: 12, text: 'The void damage ignores resistances.', ignoreResistance: true },
        { level: 16, text: 'Crit: enfeebled 2 for 1 round.' },
        { level: 18, text: 'Additional void → 1d8.', addDamage: d(1, 'd8', 'void') },
        { level: 20, text: 'Before applying void, the target gains weakness 1 to void until the start of your next turn.' },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 4, text: '1 persistent void damage.', persistentDamage: f(1, 'void', true) },
        { level: 6, text: '1 additional void damage.', addDamage: f(1, 'void') },
        { level: 8, text: 'Crit: enfeebled 1 for 1 round.' },
        { level: 10, text: 'Persistent void → 1d6.', persistentDamage: d(1, 'd6', 'void', true) },
        { level: 12, text: 'The void damage (incl. persistent) ignores resistances.', ignoreResistance: true },
        { level: 14, text: 'Persistent void → 1d8.', persistentDamage: d(1, 'd8', 'void', true) },
        { level: 16, text: 'Crit: enfeebled 2 for 1 round.' },
        { level: 18, text: 'Persistent void → 1d10.', persistentDamage: d(1, 'd10', 'void', true) },
        { level: 20, text: 'While the foe has this persistent void, the crit enfeebled lasts until the persistent damage ends or 1 round, whichever is longer.' },
      ],
    },
  ],
};

const WILD: MpProperty = {
  id: 'wild',
  name: 'Wild',
  appliesTo: ['weapon'],
  requirement: 'None — use any parts.',
  effect: 'A chaotic mix of energies, inconsistent and slightly weaker than a focused property.',
  paths: [
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 4, text: '1 additional damage; each time you deal it, roll 1d6 — 1 acid, 2 cold, 3 electricity, 4 fire, 5 void, 6 sonic.', addDamage: f(1, 'untyped') },
        { level: 6, text: 'Additional damage → 1d4.', addDamage: d(1, 'd4', 'untyped') },
        { level: 8, text: 'Additional damage → 1d6.', addDamage: d(1, 'd6', 'untyped') },
        { level: 12, text: 'The damage ignores resistances.', ignoreResistance: true },
        { level: 18, text: 'Additional damage → 1d8.', addDamage: d(1, 'd8', 'untyped') },
        { level: 20, text: 'Before applying the damage, the target gains weakness 1 to that damage type until the start of your next turn.' },
      ],
    },
  ],
};

const WINGED: MpProperty = {
  id: 'winged',
  name: 'Winged',
  appliesTo: ['armor'],
  requirement: 'The monster has a fly Speed.',
  effect: 'Wings protrude from the armor (choose arcane or primal when first imbued).',
  choicePrompt: 'Tradition',
  choiceOptions: ['arcane', 'primal'],
  paths: [
    {
      id: 'main',
      name: '',
      levels: [
        { level: 6, text: 'The armor casts Soft Landing on you automatically when you fall (can\'t retrigger for 1 hour).' },
        { level: 8, text: 'The Soft Landing cooldown drops to 10 minutes.' },
        { level: 10, text: 'Cast fly on you once/day.' },
        { level: 14, text: 'fly once/hour instead.' },
        { level: 16, text: 'You may cast 7th-rank fly instead of 4th-rank (then it can\'t be reused for 1 day instead of 1 hour).' },
        { level: 18, text: 'You can fly constantly, with a Speed equal to your land Speed.' },
        { level: 20, text: 'Cast 4th-rank fly on an ally once/hour.' },
      ],
    },
  ],
};

const WISDOM: MpProperty = {
  id: 'wisdom',
  name: 'Wisdom',
  appliesTo: ['perception', 'skill'],
  requirement: 'The creature has Wisdom as its highest or second-highest attribute modifier.',
  effect: 'Sagacious wisdom. (Perception item or Wisdom-based skill item.)',
  apexAbility: 'wis',
  apexLevel: 17,
  paths: [
    {
      id: 'main',
      name: '',
      levels: [
        { level: 8, text: 'Cast augury once/day (divine).' },
        { level: 14, text: 'augury takes only a single action to activate.' },
        { level: 17, text: 'On investing, increase your Wisdom modifier by 1 or to +4 (whichever is higher); gains the apex trait.' },
        { level: 20, text: 'You may cast foresight once/day instead of augury.' },
      ],
    },
  ],
};

export const MONSTER_PART_CATALOG: MpProperty[] = [
  ACID,
  BANE,
  CHAOTIC,
  CHARISMA,
  COLD,
  CONSTITUTION,
  DEXTERITY,
  ELECTRICITY,
  ENERGY_RESISTANT,
  FIRE,
  FORCE,
  FORTIFICATION,
  HOLY,
  INTELLIGENCE,
  LAWFUL,
  MENTAL,
  POISON,
  SENSORY,
  SONIC,
  SPELL,
  STRENGTH,
  STURDY,
  UNHOLY,
  VITALITY,
  VOID,
  WILD,
  WINGED,
  WISDOM,
];
