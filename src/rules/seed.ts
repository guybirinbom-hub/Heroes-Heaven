/*
 * Hand-authored seed data: a tiny ContentDatabase and one fully-built
 * Character (Kyra, level 5 cleric). This is enough to develop and render the
 * whole sheet before any real data import exists. Descriptions are short
 * original paraphrases, not copied rules text.
 *
 * When the real importer lands, it produces a ContentDatabase of the same
 * shape and this file is no longer needed for content (the character stays as
 * an example / test fixture).
 */
import { CHARACTER_SCHEMA_VERSION } from './types';
import type { Character, ContentDatabase } from './types';

const ORC = { license: 'ORC' as const };

export const seedContent: ContentDatabase = {
  ancestries: {
    human: {
      id: 'human',
      name: 'Human',
      traits: ['human', 'humanoid'],
      rarity: 'common',
      description: 'Ambitious, adaptable, and numerous, humans are found everywhere across the world.',
      source: ORC,
      hp: 8,
      size: 'medium',
      speeds: { land: 25 },
      abilityBoosts: [{ kind: 'free' }, { kind: 'free' }],
      abilityFlaws: [],
      vision: 'normal',
      languages: { granted: ['common'], additional: 1 },
      heritages: ['skilled-human', 'versatile-human'],
    },
  },

  heritages: {
    'skilled-human': {
      id: 'skilled-human',
      name: 'Skilled heritage',
      ancestryId: 'human',
      versatile: false,
      traits: ['human'],
      rarity: 'common',
      description: 'You are trained in one skill of your choice; at level 5 it becomes expert.',
      source: ORC,
    },
    'versatile-human': {
      id: 'versatile-human',
      name: 'Versatile heritage',
      ancestryId: 'human',
      versatile: false,
      traits: ['human'],
      rarity: 'common',
      description: 'You gain a general feat of your choice for which you meet the prerequisites.',
      source: ORC,
    },
  },

  backgrounds: {
    acolyte: {
      id: 'acolyte',
      name: 'Acolyte',
      traits: [],
      rarity: 'common',
      description: 'You served in a temple, learning sacred rites and the history of your faith.',
      source: ORC,
      abilityBoosts: [{ kind: 'choice', options: ['int', 'wis'] }, { kind: 'free' }],
      trainedSkill: 'religion',
      trainedLore: 'scribing',
      grantedFeatId: 'student-of-the-canon',
    },
  },

  classes: {
    cleric: {
      id: 'cleric',
      name: 'Cleric',
      traits: ['cleric'],
      rarity: 'common',
      description: 'A devoted servant of a deity, channeling divine power to heal allies or smite foes.',
      source: ORC,
      keyAbility: ['wis'],
      hpPerLevel: 8,
      perception: 'trained',
      saves: { fortitude: 'trained', reflex: 'trained', will: 'expert' },
      attacks: { unarmed: 'trained', simple: 'trained', martial: 'untrained', advanced: 'untrained' },
      defenses: { unarmored: 'trained', light: 'untrained', medium: 'untrained', heavy: 'untrained' },
      classDc: 'trained',
      trainedSkills: { fixed: ['religion'], additional: 3 },
      subclass: {
        name: 'Doctrine',
        options: [
          { id: 'cloistered-cleric', name: 'Cloistered cleric', description: 'A scholarly devotee who gains domain spells and broad divine casting.' },
          { id: 'warpriest', name: 'Warpriest', description: 'A martial devotee trained in armor and martial weapons.' },
        ],
      },
      spellcasting: { type: 'prepared', tradition: 'divine', keyAbility: 'wis', repertoire: false },
      features: [
        { level: 1, featureId: 'divine-spellcasting' },
        { level: 1, featureId: 'divine-font' },
        { level: 1, featureId: 'doctrine' },
        { level: 1, featureId: 'sanctification' },
        { level: 3, featureId: 'second-doctrine' },
      ],
      featProgression: {
        class: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
        skill: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
        general: [3, 7, 11, 15, 19],
        ancestry: [1, 5, 9, 13, 17],
      },
      skillIncreaseLevels: [3, 5, 7, 9, 11, 13, 15, 17, 19],
    },
  },

  classFeatures: {
    'divine-spellcasting': { id: 'divine-spellcasting', name: 'Divine spellcasting', level: 1, traits: ['cleric'], rarity: 'common', description: 'You can cast divine spells using Wisdom as your spellcasting attribute.', source: ORC },
    'divine-font': { id: 'divine-font', name: 'Divine font', level: 1, traits: ['cleric'], rarity: 'common', description: 'Add extra Heal or Harm spells to your daily preparations, based on your deity.', source: ORC },
    doctrine: { id: 'doctrine', name: 'Doctrine', level: 1, traits: ['cleric'], rarity: 'common', description: 'Your approach to your faith, granting proficiencies and abilities as you advance.', source: ORC },
    sanctification: { id: 'sanctification', name: 'Sanctification', level: 1, traits: ['cleric'], rarity: 'common', description: 'You may take on a holy or unholy edict that aligns you with your deity.', source: ORC },
    'second-doctrine': { id: 'second-doctrine', name: 'Second doctrine', level: 3, traits: ['cleric'], rarity: 'common', description: 'You become an expert in your divine spell attacks and spell DCs.', source: ORC },
  },

  feats: {
    'natural-ambition': { id: 'natural-ambition', name: 'Natural Ambition', level: 1, category: 'ancestry', traits: ['human'], rarity: 'common', description: 'You gain a 1st-level class feat from your class.', source: ORC },
    'healing-hands': { id: 'healing-hands', name: 'Healing Hands', level: 1, category: 'class', traits: ['cleric'], rarity: 'common', description: 'Your Heal spell restores more Hit Points and is harder for foes to resist.', source: ORC },
    'communal-healing': { id: 'communal-healing', name: 'Communal Healing', level: 2, category: 'class', traits: ['cleric', 'healing', 'vitality'], rarity: 'common', description: 'When you heal another creature with Heal, you regain Hit Points equal to the spell rank.', source: ORC },
    'channel-smite': { id: 'channel-smite', name: 'Channel Smite', level: 4, category: 'class', traits: ['cleric', 'divine'], rarity: 'common', actionCost: { type: 'actions', value: 2 }, description: 'Expend a Heal or Harm spell to deal its damage with a melee Strike.', source: ORC },
    'assurance-religion': { id: 'assurance-religion', name: 'Assurance (Religion)', level: 1, category: 'skill', traits: ['fortune', 'general', 'skill'], rarity: 'common', description: 'Forgo rolling a Religion check to instead take a fixed result.', source: ORC },
    'student-of-the-canon': { id: 'student-of-the-canon', name: 'Student of the Canon', level: 1, category: 'skill', traits: ['general', 'skill'], rarity: 'common', description: 'You can more reliably recall knowledge about faiths and religious practices.', source: ORC },
    'battle-medicine': { id: 'battle-medicine', name: 'Battle Medicine', level: 1, category: 'skill', traits: ['general', 'healing', 'manipulate', 'skill'], rarity: 'common', actionCost: { type: 'actions', value: 1 }, description: "Treat a creature's wounds in the thick of combat using Medicine.", source: ORC },
    toughness: { id: 'toughness', name: 'Toughness', level: 1, category: 'general', traits: ['general'], rarity: 'common', description: 'Increase your maximum Hit Points and lower your dying threshold.', source: ORC },
    'cooperative-nature': { id: 'cooperative-nature', name: 'Cooperative Nature', level: 1, category: 'ancestry', traits: ['human'], rarity: 'common', description: 'You gain a +4 circumstance bonus to checks to Aid.', source: ORC },
    'continual-recovery': { id: 'continual-recovery', name: 'Continual Recovery', level: 2, category: 'skill', traits: ['general', 'healing', 'skill'], rarity: 'common', description: 'Treat Wounds on the same target again after a shorter wait.', source: ORC },
  },

  spells: {
    light: { id: 'light', name: 'Light', rank: 0, traditions: ['arcane', 'divine', 'occult', 'primal'], traits: ['cantrip', 'concentrate', 'light', 'manipulate'], rarity: 'common', cast: { type: 'actions', value: 2 }, description: 'Make an object glow like a torch.', source: ORC },
    guidance: { id: 'guidance', name: 'Guidance', rank: 0, traditions: ['divine', 'occult', 'primal'], traits: ['cantrip', 'concentrate'], rarity: 'common', cast: { type: 'actions', value: 1 }, description: 'Grant an ally a small bonus to one roll.', source: ORC },
    shield: { id: 'shield', name: 'Shield', rank: 0, traditions: ['arcane', 'divine', 'occult'], traits: ['cantrip', 'concentrate'], rarity: 'common', cast: { type: 'actions', value: 1 }, description: 'Raise a magical shield that can block an attack.', source: ORC },
    'divine-lance': { id: 'divine-lance', name: 'Divine Lance', rank: 0, traditions: ['divine'], traits: ['attack', 'cantrip', 'concentrate', 'manipulate'], rarity: 'common', cast: { type: 'actions', value: 2 }, defense: 'ac', description: 'Hurl a lance of divine energy at a foe.', source: ORC },
    stabilize: { id: 'stabilize', name: 'Stabilize', rank: 0, traditions: ['divine', 'primal'], traits: ['cantrip', 'concentrate', 'healing', 'manipulate', 'vitality'], rarity: 'common', cast: { type: 'actions', value: 2 }, description: 'Halt a dying creature from getting worse.', source: ORC },
    heal: { id: 'heal', name: 'Heal', rank: 1, traditions: ['divine', 'primal'], traits: ['concentrate', 'healing', 'manipulate', 'vitality'], rarity: 'common', cast: { type: 'variable', min: 1, max: 3 }, description: 'Channel vital energy to restore Hit Points or damage undead.', source: ORC },
    bless: { id: 'bless', name: 'Bless', rank: 1, traditions: ['divine', 'occult'], traits: ['concentrate', 'manipulate'], rarity: 'common', cast: { type: 'actions', value: 2 }, area: '15-foot emanation', duration: 'sustained', description: 'Allies in the area gain a bonus to attack rolls.', source: ORC },
    sanctuary: { id: 'sanctuary', name: 'Sanctuary', rank: 1, traditions: ['divine', 'occult'], traits: ['concentrate', 'manipulate'], rarity: 'common', cast: { type: 'actions', value: 2 }, save: { type: 'will' }, description: 'Ward a creature so enemies struggle to attack it.', source: ORC },
    'restore-senses': { id: 'restore-senses', name: 'Restore Senses', rank: 2, traditions: ['divine', 'occult', 'primal'], traits: ['concentrate', 'healing', 'manipulate'], rarity: 'common', cast: { type: 'actions', value: 2 }, description: 'Remove a blinding or deafening effect from a creature.', source: ORC },
    'see-the-unseen': { id: 'see-the-unseen', name: 'See the Unseen', rank: 2, traditions: ['arcane', 'occult', 'primal'], traits: ['concentrate', 'manipulate'], rarity: 'common', cast: { type: 'actions', value: 2 }, duration: '10 minutes', description: 'See invisible creatures as hazy forms.', source: ORC },
    'searing-light': { id: 'searing-light', name: 'Searing Light', rank: 3, traditions: ['divine', 'primal'], traits: ['attack', 'concentrate', 'fire', 'holy', 'light', 'manipulate'], rarity: 'common', cast: { type: 'actions', value: 2 }, defense: 'ac', description: 'Fire a blast of light that sears foes and dispels darkness.', source: ORC },
    'wall-of-light': { id: 'wall-of-light', name: 'Wall of Light', rank: 3, traditions: ['divine', 'occult', 'primal'], traits: ['concentrate', 'light', 'manipulate'], rarity: 'common', cast: { type: 'variable', min: 2, max: 3 }, duration: 'sustained', description: 'Create a glowing wall that burns creatures passing through it.', source: ORC },
    'fire-ray': { id: 'fire-ray', name: 'Fire Ray', rank: 1, traditions: ['divine'], traits: ['attack', 'concentrate', 'fire', 'focus', 'manipulate'], rarity: 'common', cast: { type: 'actions', value: 2 }, defense: 'ac', description: 'A focus spell that scorches a single target with fire.', source: ORC },
    'healers-blessing': { id: 'healers-blessing', name: "Healer's Blessing", rank: 1, traditions: ['divine'], traits: ['concentrate', 'focus', 'manipulate'], rarity: 'common', cast: { type: 'actions', value: 1 }, duration: '1 minute', description: 'A focus spell that makes your healing more effective for a time.', source: ORC },
    sunburst: { id: 'sunburst', name: 'Sunburst', rank: 3, traditions: ['divine', 'primal'], traits: ['concentrate', 'fire', 'focus', 'light', 'manipulate'], rarity: 'common', cast: { type: 'actions', value: 3 }, save: { type: 'reflex', basic: true }, description: 'A focus spell that bathes an area in searing sunlight.', source: ORC },
  },

  items: {
    scimitar: { id: 'scimitar', itemType: 'weapon', name: 'Scimitar', level: 0, price: { gp: 1 }, bulk: 1, hands: 1, traits: ['forceful', 'sweep'], rarity: 'common', category: 'martial', group: 'sword', damage: { dice: 1, die: 'd6', type: 'slashing' }, description: 'A curved slashing blade favored by Sarenrae.', source: ORC },
    crossbow: { id: 'crossbow', itemType: 'weapon', name: 'Crossbow', level: 0, price: { gp: 3 }, bulk: 1, hands: 2, traits: [], rarity: 'common', category: 'simple', group: 'crossbow', damage: { dice: 1, die: 'd8', type: 'piercing' }, range: 120, reload: 1, description: 'A mechanical bow that fires bolts.', source: ORC },
    'crossbow-bolts': { id: 'crossbow-bolts', itemType: 'consumable', name: 'Crossbow bolts', level: 0, price: { sp: 1 }, bulk: 0.1, traits: [], rarity: 'common', consumableType: 'ammunition', description: 'A quiver of bolts; one is spent per shot.', source: ORC },
    'explorers-clothing': { id: 'explorers-clothing', itemType: 'armor', name: "Explorer's clothing", level: 0, price: { sp: 1 }, bulk: 0.1, traits: ['comfort'], rarity: 'common', category: 'unarmored', group: 'cloth', acBonus: 0, dexCap: 5, checkPenalty: 0, speedPenalty: 0, strength: 0, description: 'Light traveling clothes that count as unarmored defense.', source: ORC },
    'steel-shield': { id: 'steel-shield', itemType: 'shield', name: 'Steel shield', level: 0, price: { gp: 2 }, bulk: 1, traits: [], rarity: 'common', acBonus: 2, hardness: 5, hp: 20, brokenThreshold: 10, description: 'A sturdy steel shield.', source: ORC },
    'staff-of-healing': { id: 'staff-of-healing', itemType: 'equipment', name: 'Staff of healing', level: 4, price: { gp: 80 }, bulk: 1, traits: ['magical', 'staff'], rarity: 'common', usage: 'held in 1 hand', description: 'A staff charged with healing spells each day.', source: ORC },
    'holy-symbol': { id: 'holy-symbol', itemType: 'equipment', name: 'Wooden holy symbol', level: 0, price: { sp: 5 }, bulk: 0, traits: [], rarity: 'common', usage: 'worn', description: 'A divine focus used to cast and channel spells.', source: ORC },
    'healing-potion-lesser': { id: 'healing-potion-lesser', itemType: 'consumable', name: 'Healing potion (lesser)', level: 1, price: { gp: 12 }, bulk: 0.1, traits: ['magical', 'healing', 'potion'], rarity: 'common', consumableType: 'potion', description: 'Drink to restore 1d8 Hit Points.', source: ORC },
    backpack: { id: 'backpack', itemType: 'container', name: 'Backpack', level: 0, price: { sp: 1 }, bulk: 0.1, traits: [], rarity: 'common', capacity: { bulk: 4 }, ignoredBulk: 1, description: 'Holds gear; the first Bulk of contents is ignored when worn.', source: ORC },
    rations: { id: 'rations', itemType: 'consumable', name: 'Rations', level: 0, price: { sp: 2 }, bulk: 0.1, traits: [], rarity: 'common', description: "A week's worth of preserved food.", source: ORC },
    waterskin: { id: 'waterskin', itemType: 'equipment', name: 'Waterskin', level: 0, price: { cp: 5 }, bulk: 0.1, traits: [], rarity: 'common', description: 'Holds a day or two of water.', source: ORC },
    rope: { id: 'rope', itemType: 'equipment', name: 'Rope (50 ft.)', level: 0, price: { sp: 5 }, bulk: 0.1, traits: [], rarity: 'common', description: 'Fifty feet of sturdy rope.', source: ORC },
    bedroll: { id: 'bedroll', itemType: 'equipment', name: 'Bedroll', level: 0, price: { cp: 2 }, bulk: 0.1, traits: [], rarity: 'common', description: 'A simple roll for sleeping outdoors.', source: ORC },
    torch: { id: 'torch', itemType: 'equipment', name: 'Torch', level: 0, price: { cp: 1 }, bulk: 0.1, traits: [], rarity: 'common', description: 'Burns to light the way for an hour.', source: ORC },
  },

  deities: {
    sarenrae: { id: 'sarenrae', name: 'Sarenrae', traits: [], rarity: 'common', description: 'The Dawnflower, goddess of healing, honesty, redemption, and the sun.', source: ORC, divineFont: ['heal'], domains: ['fire', 'healing', 'sun', 'truth'] },
  },

  languages: {
    common: { id: 'common', name: 'Common', rarity: 'common', source: ORC },
    celestial: { id: 'celestial', name: 'Celestial', rarity: 'common', source: ORC },
    dwarven: { id: 'dwarven', name: 'Dwarven', rarity: 'common', source: ORC },
  },
  animalCompanions: {},
  familiarAbilities: {},
  conditions: {},
  actions: {},
  modes: {},
  stances: {},
  runes: {},
};

export const kyra: Character = {
  id: 'kyra',
  schemaVersion: CHARACTER_SCHEMA_VERSION,
  name: 'Kyra',
  level: 5,
  xp: 1000,

  ancestryId: 'human',
  heritageId: 'skilled-human',
  backgroundId: 'acolyte',
  classId: 'cleric',
  subclassId: 'cloistered-cleric',
  keyAbility: 'wis',

  abilities: { str: 14, dex: 12, con: 14, int: 10, wis: 18, cha: 12 },

  proficiencies: {
    perception: 'trained',
    saves: { fortitude: 'trained', reflex: 'trained', will: 'expert' },
    skills: {
      acrobatics: 'untrained',
      arcana: 'untrained',
      athletics: 'untrained',
      crafting: 'untrained',
      deception: 'untrained',
      diplomacy: 'trained',
      intimidation: 'untrained',
      medicine: 'expert',
      nature: 'trained',
      occultism: 'untrained',
      performance: 'untrained',
      religion: 'expert',
      society: 'trained',
      stealth: 'untrained',
      survival: 'untrained',
      thievery: 'untrained',
      'lore:scribing': 'trained',
    },
    attacks: { unarmed: 'trained', simple: 'trained', martial: 'untrained', advanced: 'untrained' },
    defenses: { unarmored: 'trained', light: 'untrained', medium: 'untrained', heavy: 'untrained' },
    classDc: 'trained',
    weaponOverrides: { scimitar: 'trained' },
  },

  hitPoints: { current: 58, temp: 0 },
  heroPoints: 1,
  focus: { current: 2, max: 3 },
  conditions: [],

  languages: ['common', 'celestial', 'dwarven'],

  feats: [
    { featId: 'natural-ambition', level: 1, category: 'ancestry' },
    { featId: 'healing-hands', level: 1, category: 'class' },
    { featId: 'student-of-the-canon', level: 1, category: 'skill' },
    { featId: 'assurance-religion', level: 1, category: 'skill' },
    { featId: 'communal-healing', level: 2, category: 'class' },
    { featId: 'battle-medicine', level: 2, category: 'skill' },
    { featId: 'toughness', level: 3, category: 'general' },
    { featId: 'channel-smite', level: 4, category: 'class' },
    { featId: 'continual-recovery', level: 4, category: 'skill' },
    { featId: 'cooperative-nature', level: 5, category: 'ancestry' },
  ],

  inventory: [
    { instanceId: 'i1', itemId: 'scimitar', quantity: 1, equipped: true, runes: { potency: 1, striking: 'striking' } },
    { instanceId: 'i2', itemId: 'steel-shield', quantity: 1, equipped: true },
    { instanceId: 'i3', itemId: 'explorers-clothing', quantity: 1, worn: true },
    { instanceId: 'i4', itemId: 'holy-symbol', quantity: 1, worn: true },
    { instanceId: 'i5', itemId: 'staff-of-healing', quantity: 1, invested: true },
    { instanceId: 'i6', itemId: 'crossbow', quantity: 1, equipped: true },
    { instanceId: 'i7', itemId: 'crossbow-bolts', quantity: 20 },
    { instanceId: 'i8', itemId: 'healing-potion-lesser', quantity: 2 },
    { instanceId: 'i9', itemId: 'backpack', quantity: 1, worn: true },
    { instanceId: 'i10', itemId: 'rations', quantity: 2, containerInstanceId: 'i9' },
    { instanceId: 'i11', itemId: 'waterskin', quantity: 1, containerInstanceId: 'i9' },
    { instanceId: 'i12', itemId: 'rope', quantity: 1, containerInstanceId: 'i9' },
    { instanceId: 'i13', itemId: 'bedroll', quantity: 1, containerInstanceId: 'i9' },
    { instanceId: 'i14', itemId: 'torch', quantity: 5, containerInstanceId: 'i9' },
  ],
  currency: { pp: 12, gp: 48, sp: 30, cp: 75 },

  spellcasting: [
    {
      id: 'cleric-divine',
      name: 'Divine prepared spellcasting',
      type: 'prepared',
      tradition: 'divine',
      keyAbility: 'wis',
      proficiency: 'expert',
      cantrips: ['light', 'guidance', 'shield', 'divine-lance', 'stabilize'],
      prepared: {
        1: [
          { spellId: 'heal', expended: true },
          { spellId: 'heal', expended: false },
          { spellId: 'bless', expended: false },
          { spellId: 'sanctuary', expended: false },
        ],
        2: [
          { spellId: 'heal', expended: false },
          { spellId: 'restore-senses', expended: false },
          { spellId: 'see-the-unseen', expended: false },
          { spellId: 'heal', expended: false },
        ],
        3: [
          { spellId: 'heal', expended: true },
          { spellId: 'searing-light', expended: true },
          { spellId: 'heal', expended: false },
          { spellId: 'wall-of-light', expended: false },
        ],
      },
      slots: {
        1: { max: 4, used: 1 },
        2: { max: 4, used: 0 },
        3: { max: 4, used: 2 },
      },
    },
    {
      id: 'cleric-focus',
      name: 'Focus spells',
      type: 'focus',
      tradition: 'divine',
      keyAbility: 'wis',
      proficiency: 'expert',
      cantrips: [],
      repertoire: { 1: ['fire-ray', 'healers-blessing'], 3: ['sunburst'] },
    },
  ],

  details: {
    deityId: 'sarenrae',
    alignment: 'Neutral good',
    age: '31',
    height: '5 ft 9 in',
    weight: '150 lb',
    gender: 'Female',
    pronouns: 'she / her',
    ethnicity: 'Keleshite',
    nationality: 'Qadira',
    birthplace: 'Katheer',
    appearance: 'Auburn hair kept short, sun-darkened skin, warm amber eyes, and a brass sun-pendant of Sarenrae.',
    personality: 'Compassionate but quick to act against cruelty; she believes redemption is always possible — until it clearly is not.',
  },

  notes: [
    {
      id: 'session-log',
      title: 'Session log',
      icon: 'ti-book-2',
      color: '#5cb0ef',
      private: false,
      content: '<p>The party descended into the flooded temple beneath Katheer.</p>',
    },
  ],

  appearance: { accentColor: '#6366f1' },
};
