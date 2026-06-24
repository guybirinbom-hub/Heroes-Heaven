/*
 * Battlezoo Monster Parts (Remaster conversion) — the refine / imbue subsystem.
 *
 * REFINEMENT maps onto fundamental runes: a refined item's level grants the same item bonuses a
 * potency/striking (weapon), potency/resilient (armor), or reinforcing (shield) rune would, plus
 * Perception/skill item bonuses. IMBUED PROPERTIES map onto property runes (extra & persistent Strike
 * damage) plus a few non-strike effects (resistances, senses, apex ability boosts). Situational riders
 * (crit conditions, "ignores resistances", weakness-granting) and granted spells are reference text —
 * a character sheet can't auto-apply effects that land on the enemy.
 *
 * The subsystem is gated per character by a homebrew Source that `unlocks: ['monsterParts']`
 * (see sources.ts monsterPartsEnabled). Mechanical tables are transcribed from the user's personal
 * Remaster conversion of Battlezoo Monster Parts (© Roll for Combat).
 */
import type { AbilityId, DamageType, DieSize } from './types';
import { MONSTER_PART_CATALOG } from './monsterPartsCatalog';

export type MpItemKind = 'weapon' | 'armor' | 'shield' | 'perception' | 'skill';

// ───────────────────────── Refinement (Tables 3, 4A–4E) ─────────────────────────

/** Parts value (gp) an item holds to be refined/imbued AT a given item level (Table 3).
 *  [weapons & armor, shields/Perception/skill]. */
const COST_BY_LEVEL: Record<number, [number, number]> = {
  1: [20, 10], 2: [35, 20], 3: [60, 35], 4: [100, 60], 5: [160, 100], 6: [250, 160], 7: [360, 240],
  8: [500, 340], 9: [700, 470], 10: [1000, 670], 11: [1400, 950], 12: [2000, 1350], 13: [3000, 2000],
  14: [4500, 3000], 15: [6500, 4300], 16: [10000, 6500], 17: [15000, 10000], 18: [24000, 16000],
  19: [40000, 25000], 20: [70000, 45000],
};
const clampLevel = (n: number) => Math.max(1, Math.min(20, Math.round(n)));

/** Total parts value to refine/imbue an item of `kind` to item level `level`. */
export function refinementCost(level: number, kind: MpItemKind): number {
  const row = COST_BY_LEVEL[clampLevel(level)];
  return kind === 'weapon' || kind === 'armor' ? row[0] : row[1];
}

export interface WeaponRefinement {
  attack: number;
  /** Extra weapon damage dice beyond the base (striking=1, greater=2, major=3). */
  extraDice: number;
  imbueSlots: number;
}
export function weaponRefinement(level: number): WeaponRefinement {
  return {
    attack: level >= 16 ? 3 : level >= 10 ? 2 : level >= 2 ? 1 : 0,
    extraDice: level >= 19 ? 3 : level >= 12 ? 2 : level >= 4 ? 1 : 0,
    imbueSlots: level >= 16 ? 3 : level >= 10 ? 2 : level >= 2 ? 1 : 0,
  };
}

export interface ArmorRefinement {
  ac: number;
  saves: number;
  imbueSlots: number;
}
export function armorRefinement(level: number): ArmorRefinement {
  return {
    ac: level >= 18 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0,
    saves: level >= 20 ? 3 : level >= 14 ? 2 : level >= 8 ? 1 : 0,
    imbueSlots: level >= 18 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0,
  };
}

export interface ShieldRefinement {
  hardness: number;
  hp: number;
  bt: number;
  imbueSlots: number;
}
/** [level, hardness, hp, BT] floors from Table 4C (steel-shield baseline). */
const SHIELD_STATS: [number, number, number, number][] = [
  [3, 5, 30, 15], [5, 6, 36, 18], [7, 7, 42, 21], [8, 8, 48, 24], [9, 9, 54, 27], [10, 10, 60, 30],
  [12, 11, 66, 33], [13, 12, 72, 36], [15, 13, 78, 39], [16, 14, 84, 42], [17, 15, 90, 45],
  [18, 16, 96, 48], [19, 17, 102, 51], [20, 18, 108, 54],
];
export function shieldRefinement(level: number): ShieldRefinement {
  let stat = { hardness: 0, hp: 0, bt: 0 };
  for (const [lv, h, hp, bt] of SHIELD_STATS) if (level >= lv) stat = { hardness: h, hp, bt };
  return { ...stat, imbueSlots: level >= 4 ? 1 : 0 };
}

/** Perception item (4D) / skill item (4E): item bonus + one imbuing slot. */
export function senseSkillRefinement(level: number): { bonus: number; imbueSlots: number } {
  return { bonus: level >= 17 ? 3 : level >= 9 ? 2 : level >= 3 ? 1 : 0, imbueSlots: level >= 3 ? 1 : 0 };
}

/** Imbuing slots available on a refined item of the given kind + level. */
export function imbueSlots(kind: MpItemKind, level: number): number {
  switch (kind) {
    case 'weapon': return weaponRefinement(level).imbueSlots;
    case 'armor': return armorRefinement(level).imbueSlots;
    case 'shield': return shieldRefinement(level).imbueSlots;
    default: return senseSkillRefinement(level).imbueSlots;
  }
}

// ───────────────────────── Imbued properties (Table 5 + catalog) ─────────────────────────

/** A unit of extra Strike damage: either dice (`dice`d`die`) or a flat `+flat`, of `type`. */
export interface MpDamage {
  dice?: number;
  die?: DieSize;
  flat?: number;
  type: DamageType;
  persistent?: boolean;
}

/** One level entry of an imbued property path. Structured fields are CUMULATIVE: the highest entry
 *  at or below the property's current level that sets a field wins (later entries supersede earlier). */
export interface MpLevel {
  level: number;
  /** Reference prose shown to the player for every entry at or below the current level. */
  text: string;
  /** Extra Strike damage on a hit (the value AT this level — supersedes lower entries). */
  addDamage?: MpDamage;
  /** Persistent Strike damage (the value AT this level — supersedes lower entries). */
  persistentDamage?: MpDamage;
}

export interface MpPath {
  id: string; // 'magic' | 'might' | 'technique' | 'main'
  name: string; // 'Magic' | 'Might' | 'Technique' | ''
  note?: string; // e.g. tradition choice
  levels: MpLevel[];
}

export interface MpProperty {
  id: string;
  name: string;
  /** Which refined item kinds can take this property. */
  appliesTo: MpItemKind[];
  /** Parts requirement (the monster the parts must come from). */
  requirement: string;
  /** Flavor effect line. */
  effect: string;
  /** Paths to choose from (weapon properties: Magic/Might/Technique). Non-path properties use one 'main'. */
  paths: MpPath[];
  /** Energy Resistant: resistance value = the property's level; player chooses the type. */
  resistance?: { choices: DamageType[] };
  /** Sensory: passive senses gained while invested, by property level. */
  senses?: { level: number; sense: string }[];
  /** Skill/Perception apex properties: at level 17 raise this ability by 2 (or to 18) + apex trait. */
  apexAbility?: AbilityId;
  /** A free-text choice the imbuement must record (energy type, creature type, tradition…). */
  choicePrompt?: string;
  choiceOptions?: string[];
}

export interface ResolvedImbuement {
  addDamage?: MpDamage;
  persistentDamage?: MpDamage;
  /** All level-entry prose at or below the current level (for the reference display). */
  riders: { level: number; text: string }[];
}

/** Resolve a property path at a given property level into its current cumulative effects. */
export function resolvePath(path: MpPath, level: number): ResolvedImbuement {
  let addDamage: MpDamage | undefined;
  let persistentDamage: MpDamage | undefined;
  const riders: { level: number; text: string }[] = [];
  for (const e of [...path.levels].sort((a, b) => a.level - b.level)) {
    if (e.level > level) break;
    if (e.addDamage) addDamage = e.addDamage;
    if (e.persistentDamage) persistentDamage = e.persistentDamage;
    riders.push({ level: e.level, text: e.text });
  }
  return { addDamage, persistentDamage, riders };
}

/** Format an MpDamage as a human string fragment, e.g. "1d6 fire" or "+1 acid". */
export function formatMpDamage(d: MpDamage): string {
  const body = d.dice && d.die ? `${d.dice}${d.die}` : `+${d.flat ?? 0}`;
  return `${d.persistent ? 'persistent ' : ''}${body} ${d.type}`;
}

// ── damage-scale helpers (keep the catalog compact + accurate) ──
const f = (flat: number, type: DamageType, persistent?: boolean): MpDamage => ({ flat, type, persistent });
const d = (dice: number, die: DieSize, type: DamageType, persistent?: boolean): MpDamage => ({ dice, die, type, persistent });

// ───────────────────────── Catalog ─────────────────────────
// Exemplars proving every mechanized effect path: a 3-path weapon damage property (Fire) and a
// resistance property (Energy Resistant). The remaining properties are appended below.

const FIRE: MpProperty = {
  id: 'fire',
  name: 'Fire',
  appliesTo: ['weapon'],
  requirement: 'parts from a monster with the fire trait or an attack/spell dealing fire damage',
  effect: 'burning fire',
  choicePrompt: 'Tradition (Magic path)',
  choiceOptions: ['arcane', 'primal'],
  paths: [
    {
      id: 'magic',
      name: 'Magic',
      note: 'arcane or primal',
      levels: [
        { level: 2, text: 'Cast Ignition as a cantrip, heightened to half the item’s level.' },
        { level: 4, text: 'Cast Breathe Fire once/day.' },
        { level: 6, text: 'Breathe Fire heightens to 2nd.' },
        { level: 8, text: 'Cast Floating Flame and fireball each once/day (no longer Breathe Fire).' },
        { level: 10, text: 'Strikes deal +1 fire damage.', addDamage: f(1, 'fire') },
        { level: 12, text: 'fireball and Floating Flame heighten to 4th; cast wall of fire once/day.' },
        { level: 14, text: 'Additional fire damage → 1d4.', addDamage: d(1, 'd4', 'fire') },
        { level: 16, text: 'fireball, Floating Flame, and wall of fire heighten to 6th.' },
        { level: 18, text: 'Additional fire damage → 1d6.', addDamage: d(1, 'd6', 'fire') },
        { level: 20, text: 'Cast Falling Stars once/day.' },
      ],
    },
    {
      id: 'might',
      name: 'Might',
      levels: [
        { level: 4, text: '+1 fire damage.', addDamage: f(1, 'fire') },
        { level: 6, text: 'Additional fire → 1d4.', addDamage: d(1, 'd4', 'fire') },
        { level: 8, text: 'Additional fire → 1d6; on a crit, 1d10 persistent fire.', addDamage: d(1, 'd6', 'fire') },
        { level: 12, text: 'Ignores fire resistance.' },
        { level: 14, text: 'Crit persistent fire → 2d10.' },
        { level: 18, text: 'Additional fire → 1d8.', addDamage: d(1, 'd8', 'fire') },
        { level: 20, text: 'Before applying fire, the target gains weakness 1 to fire until the start of your next turn.' },
      ],
    },
    {
      id: 'technique',
      name: 'Technique',
      levels: [
        { level: 4, text: '1 persistent fire damage.', persistentDamage: f(1, 'fire', true) },
        { level: 6, text: '+1 fire damage.', addDamage: f(1, 'fire') },
        { level: 8, text: 'Persistent fire → 1d6; on a crit, an extra 1d10 persistent fire (after doubling).', persistentDamage: d(1, 'd6', 'fire', true) },
        { level: 12, text: 'Ignores fire resistance (including persistent).' },
        { level: 14, text: 'Persistent fire → 1d8.', persistentDamage: d(1, 'd8', 'fire', true) },
        { level: 16, text: 'Foes taking this persistent fire are off-guard.' },
        { level: 18, text: 'Persistent fire → 1d10.', persistentDamage: d(1, 'd10', 'fire', true) },
        { level: 20, text: 'At the end of a burning foe’s turn, all adjacent foes also catch fire (same persistent fire).' },
      ],
    },
  ],
};

const ENERGY_RESISTANT: MpProperty = {
  id: 'energy-resistant',
  name: 'Energy Resistant',
  appliesTo: ['armor', 'shield'],
  requirement: 'parts from a monster with resistance or immunity to the chosen energy type',
  effect: 'While worn/wielded, you and the item gain resistance to the chosen type equal to this property’s level. A shield may Shield Block against that type in addition to its normal trigger. (Armor can take this multiple times, a different type each.)',
  resistance: { choices: ['acid', 'cold', 'electricity', 'fire', 'force', 'void', 'vitality', 'sonic'] },
  choicePrompt: 'Energy type',
  choiceOptions: ['acid', 'cold', 'electricity', 'fire', 'force', 'void', 'vitality', 'sonic'],
  paths: [{ id: 'main', name: '', levels: [{ level: 1, text: 'Resistance to the chosen energy type equal to this property’s level.' }] }],
};

/** The full property catalog: the two hand-authored exemplars + the generated catalog (sorted by name). */
export const MONSTER_PART_PROPERTIES: MpProperty[] = [FIRE, ENERGY_RESISTANT, ...MONSTER_PART_CATALOG].sort((a, b) =>
  a.name.localeCompare(b.name),
);

const PROPERTY_BY_ID: Record<string, MpProperty> = Object.fromEntries(MONSTER_PART_PROPERTIES.map((p) => [p.id, p]));

export function getMpProperty(id: string): MpProperty | undefined {
  return PROPERTY_BY_ID[id];
}

/** Properties offerable for a refined item of the given kind. */
export function propertiesForKind(kind: MpItemKind): MpProperty[] {
  return MONSTER_PART_PROPERTIES.filter((p) => p.appliesTo.includes(kind));
}
