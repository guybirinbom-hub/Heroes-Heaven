/*
 * Monster Parts (Battlezoo Bestiary — personal Remaster conversion, © Roll for Combat) — the refine /
 * imbue subsystem. Gated per character by the `monsterParts` VARIANT RULE (Character.variantRules).
 *
 * REFINEMENT maps parts value → item level → the item-bonus / striking-die benefits a fundamental rune
 * would grant (weapon potency + striking; armor potency + resilient; shield reinforcing; Perception /
 * skill item bonus). IMBUED PROPERTIES map parts value → property level → extra & persistent Strike
 * damage plus a handful of non-strike effects (resistances, senses, apex attribute boosts, granted
 * spells). Situational riders (crit conditions, "ignores resistances", weakness-granting) and granted
 * spells are reference text — a sheet can't auto-apply effects that land on the enemy.
 *
 * All mechanical tables are transcribed from C:\wonderers guide\Monster Parts - Remaster Conversion v2.md.
 * The item math (refine cost / benefits / imbue thresholds) is IDENTICAL across the Full / Light / Hybrid
 * GM variants — the variant only changes the treasure-by-level reference guidance (see TREASURE_BY_LEVEL).
 */
import type { AbilityId, DamageType, DieSize, MpItemKind, ItemMonsterPart, MonsterPartsMode, ContentDatabase, InventoryItem, Item } from './types';
import { MONSTER_PART_CATALOG } from './monsterPartsCatalog';
import { coinsToCp } from './wealth';

export type { MpItemKind } from './types';

/** The five refinable item categories, with a label + refining part-requirement reminder. */
export const MP_ITEM_KINDS: { id: MpItemKind; label: string; requirement: string }[] = [
  {
    id: 'weapon',
    label: 'Weapon',
    requirement:
      "Parts from a monster with an unarmed attack matching the weapon's physical damage type (bludgeoning, piercing, or slashing). A versatile or modular weapon accepts any of its types.",
  },
  {
    id: 'armor',
    label: 'Armor',
    requirement:
      'Parts with suitable material — hair/fiber/silk for cloth & padded, skin for leather/hide, bone/horn/chitin for "metal" armors. Oozes and the like don\'t qualify. Refined armor gains the invested trait.',
  },
  {
    id: 'shield',
    label: 'Shield',
    requirement:
      'Parts from a monster with Hardness or resistance to physical damage (or one physical type). Uses steel-shield stats by default.',
  },
  {
    id: 'perception',
    label: 'Perception item',
    requirement: 'Parts from a monster with a special sense other than low-light vision. Worn, invested.',
  },
  {
    id: 'skill',
    label: 'Skill item',
    requirement: 'Parts from a monster that has the matching skill in its stat block. Worn, invested.',
  },
];

// ───────────────────────── Refinement / imbuing cost (Table 3 = Table 5) ─────────────────────────

/** Parts value (gp) an item HOLDS to be refined/imbued AT a given item level (Table 3).
 *  [weapons & armor (col A), shields / Perception / skill (col B)]. */
const COST_BY_LEVEL: Record<number, [number, number]> = {
  1: [20, 10], 2: [35, 20], 3: [60, 35], 4: [100, 60], 5: [160, 100], 6: [250, 160], 7: [360, 240],
  8: [500, 340], 9: [700, 470], 10: [1000, 670], 11: [1400, 950], 12: [2000, 1350], 13: [3000, 2000],
  14: [4500, 3000], 15: [6500, 4300], 16: [10000, 6500], 17: [15000, 10000], 18: [24000, 16000],
  19: [40000, 25000], 20: [70000, 45000],
};

const clampLevel = (n: number) => Math.max(1, Math.min(20, Math.round(n)));

/** Which cost column an item kind uses: weapons/armor = column A, everything else = column B. */
export function costColumn(kind: MpItemKind): 0 | 1 {
  return kind === 'weapon' || kind === 'armor' ? 0 : 1;
}

/** Total parts value (gp) to refine/imbue an item of `kind` to item `level` (Table 3/5). */
export function refinementCost(level: number, kind: MpItemKind): number {
  return COST_BY_LEVEL[clampLevel(level)][costColumn(kind)];
}

/** The highest item level whose threshold `value` gp meets, for the given item kind (0 if below L1).
 *  Used for BOTH refining (item level for a refine value) and imbuing (a property's level for its value). */
export function itemLevelForValue(value: number, kind: MpItemKind): number {
  const col = costColumn(kind);
  let level = 0;
  for (let lv = 1; lv <= 20; lv++) if (value >= COST_BY_LEVEL[lv][col]) level = lv;
  return level;
}

/** A property's current level from its assigned value + item kind. Alias of itemLevelForValue (Table 5). */
export function propertyLevelForValue(value: number, kind: MpItemKind): number {
  return itemLevelForValue(value, kind);
}

/** The parts still needed to reach the NEXT level above `value` (0 if already at level 20). */
export function valueToNextLevel(value: number, kind: MpItemKind): number {
  const level = itemLevelForValue(value, kind);
  if (level >= 20) return 0;
  return Math.max(0, refinementCost(level + 1, kind) - value);
}

/**
 * The effective level cap for an imbued property: it can't exceed the item's refined level or the
 * character's level, whichever is lower (rules: "An imbued property can't exceed the item's level or
 * your level, whichever is lower"). Refining itself is also capped at the character's level.
 */
export function imbuedLevelCap(itemLevel: number, characterLevel: number): number {
  return Math.max(0, Math.min(itemLevel, characterLevel));
}

// ───────────────────────── Salvage / transfer constants ─────────────────────────

/** Salvaging an item recovers parts worth up to this fraction of its refine + imbued value. */
export const SALVAGE_FRACTION = 0.5;
/** Transferring a value to a same-type item costs parts equal to this fraction of the value difference. */
export const TRANSFER_FRACTION = 0.1;

/** Total parts value sunk into an item (refine + all imbuements). */
export function itemPartValue(mp: ItemMonsterPart | undefined): number {
  if (!mp) return 0;
  return mp.refineValue + mp.imbuements.reduce((s, im) => s + im.value, 0);
}

/** Parts recoverable by salvaging the whole item (50% of its total value). */
export function salvageValue(mp: ItemMonsterPart | undefined): number {
  return Math.floor(itemPartValue(mp) * SALVAGE_FRACTION);
}

/** Parts cost to transfer a value to a same-type item (10% of the difference in values). */
export function transferCost(fromValue: number, toValue: number): number {
  return Math.ceil(Math.abs(fromValue - toValue) * TRANSFER_FRACTION);
}

// ───────────────────────── Refinement benefits (Tables 4A–4E) ─────────────────────────

export interface WeaponRefinement {
  /** Item bonus to attack rolls (+1/+2/+3). */
  attack: number;
  /** Extra weapon damage dice beyond the base (striking = 1, greater = 2, major = 3). */
  extraDice: number;
  /** Imbuing slots unlocked. */
  imbueSlots: number;
}
/** Table 4A (weapons + handwraps of mighty blows). */
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
/** Table 4B (armor + explorer's clothing; refined armor gains the invested trait). */
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
/** Table 4C. Imbuing unlocks at level 4. (Buckler adjustments handled by the caller.) */
export function shieldRefinement(level: number): ShieldRefinement {
  let stat = { hardness: 0, hp: 0, bt: 0 };
  for (const [lv, h, hp, bt] of SHIELD_STATS) if (level >= lv) stat = { hardness: h, hp, bt };
  return { ...stat, imbueSlots: level >= 4 ? 1 : 0 };
}

/** Perception item (Table 4D) / skill item (Table 4E): item bonus +1/+2/+3 and one imbuing slot. */
export function senseSkillRefinement(level: number): { bonus: number; imbueSlots: number } {
  return { bonus: level >= 17 ? 3 : level >= 9 ? 2 : level >= 3 ? 1 : 0, imbueSlots: level >= 3 ? 1 : 0 };
}

/** How many imbuing slots a refined item of the given kind + level provides. */
export function imbueSlots(kind: MpItemKind, level: number): number {
  switch (kind) {
    case 'weapon':
      return weaponRefinement(level).imbueSlots;
    case 'armor':
      return armorRefinement(level).imbueSlots;
    case 'shield':
      return shieldRefinement(level).imbueSlots;
    default:
      return senseSkillRefinement(level).imbueSlots;
  }
}

/** One line of refinement-benefit reference text for an item kind + level (Tables 4A–4E). */
export interface RefinementBenefit {
  level: number;
  text: string;
}
const REFINE_BENEFITS: Record<MpItemKind, RefinementBenefit[]> = {
  weapon: [
    { level: 2, text: 'Item bonus to attack rolls +1; imbuing (1 slot).' },
    { level: 4, text: '2 damage dice (striking).' },
    { level: 10, text: 'Item bonus to attack rolls +2; imbuing (2 slots).' },
    { level: 12, text: '3 damage dice (greater striking).' },
    { level: 16, text: 'Item bonus to attack rolls +3; imbuing (3 slots).' },
    { level: 19, text: '4 damage dice (major striking).' },
  ],
  armor: [
    { level: 5, text: 'Item bonus to AC +1; imbuing (1 slot).' },
    { level: 8, text: 'Item bonus to saves +1 (resilient).' },
    { level: 11, text: 'Item bonus to AC +2; imbuing (2 slots).' },
    { level: 14, text: 'Item bonus to saves +2 (greater resilient).' },
    { level: 18, text: 'Item bonus to AC +3; imbuing (3 slots).' },
    { level: 20, text: 'Item bonus to saves +3 (major resilient).' },
  ],
  shield: [
    { level: 3, text: 'Hardness 5, HP 30, BT 15.' },
    { level: 4, text: 'Imbuing (1 slot).' },
    { level: 5, text: 'Hardness 6, HP 36, BT 18.' },
    { level: 7, text: 'Hardness 7, HP 42, BT 21.' },
    { level: 8, text: 'Hardness 8, HP 48, BT 24.' },
    { level: 9, text: 'Hardness 9, HP 54, BT 27.' },
    { level: 10, text: 'Hardness 10, HP 60, BT 30.' },
    { level: 12, text: 'Hardness 11, HP 66, BT 33.' },
    { level: 13, text: 'Hardness 12, HP 72, BT 36.' },
    { level: 15, text: 'Hardness 13, HP 78, BT 39.' },
    { level: 16, text: 'Hardness 14, HP 84, BT 42.' },
    { level: 17, text: 'Hardness 15, HP 90, BT 45.' },
    { level: 18, text: 'Hardness 16, HP 96, BT 48.' },
    { level: 19, text: 'Hardness 17, HP 102, BT 51.' },
    { level: 20, text: 'Hardness 18, HP 108, BT 54.' },
  ],
  perception: [
    { level: 3, text: 'Item bonus to Perception +1; imbuing (1 slot).' },
    { level: 9, text: 'Item bonus to Perception +2.' },
    { level: 17, text: 'Item bonus to Perception +3.' },
  ],
  skill: [
    { level: 3, text: 'Item bonus to the skill +1; imbuing (1 slot).' },
    { level: 9, text: 'Item bonus to the skill +2.' },
    { level: 17, text: 'Item bonus to the skill +3.' },
  ],
};

/** All refinement-benefit lines up to and including `level`, for the rules-reference display. */
export function refinementBenefitsAt(level: number, kind: MpItemKind): RefinementBenefit[] {
  return REFINE_BENEFITS[kind].filter((b) => b.level <= level);
}

/** The full refinement-benefit table for an item kind (all levels), for the rules reference. */
export function refinementTable(kind: MpItemKind): RefinementBenefit[] {
  return REFINE_BENEFITS[kind];
}

// ───────────────────────── Imbued properties (catalog + resolver) ─────────────────────────

/** A unit of extra Strike damage: either dice (`dice`d`die`) or a flat `+flat`, of `type`. */
export interface MpDamage {
  dice?: number;
  die?: DieSize;
  flat?: number;
  type: DamageType;
  persistent?: boolean;
}

/** One level entry of an imbued-property path. Structured fields are CUMULATIVE: the highest entry at
 *  or below the property's current level that sets a field wins (later entries supersede earlier). */
export interface MpLevel {
  level: number;
  /** Reference prose shown to the player for every entry at or below the current level. */
  text: string;
  /** Extra Strike damage on a hit (the value AT this level — supersedes lower entries). */
  addDamage?: MpDamage;
  /** Persistent Strike damage (the value AT this level — supersedes lower entries). */
  persistentDamage?: MpDamage;
  /** From this level, the property's damage ignores resistances (a one-way latch). */
  ignoreResistance?: boolean;
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
  /** Paths to choose from (weapon properties: Magic/Might/Technique). Single-path properties use 'main'. */
  paths: MpPath[];
  /** Energy Resistant: resistance value = the property's level; the player chooses the type. */
  resistance?: { choices: DamageType[] };
  /** Sensory: passive senses gained while invested, by property level. */
  senses?: { level: number; sense: string }[];
  /** Skill/Perception apex properties: at level 17 raise this attribute (+1 or to +4) + apex trait. */
  apexAbility?: AbilityId;
  /** Level the apex boost applies (always 17 in this ruleset). */
  apexLevel?: number;
  /** A free-text choice the imbuement must record (energy type, creature type, tradition…). */
  choicePrompt?: string;
  choiceOptions?: string[];
  /** Chaotic/Lawful reuse another property's paths (Unholy/Holy respectively). */
  reusesPathsOf?: string;
}

/** Resolve a property path at a given property level into its current cumulative effects. */
export interface ResolvedImbuement {
  addDamage?: MpDamage;
  persistentDamage?: MpDamage;
  ignoreResistance: boolean;
  /** All level-entry prose at or below the current level (for the reference display). */
  riders: { level: number; text: string }[];
}

export function resolvePath(path: MpPath, level: number): ResolvedImbuement {
  let addDamage: MpDamage | undefined;
  let persistentDamage: MpDamage | undefined;
  let ignoreResistance = false;
  const riders: { level: number; text: string }[] = [];
  for (const e of [...path.levels].sort((a, b) => a.level - b.level)) {
    if (e.level > level) break;
    if (e.addDamage) addDamage = e.addDamage;
    if (e.persistentDamage) persistentDamage = e.persistentDamage;
    if (e.ignoreResistance) ignoreResistance = true;
    riders.push({ level: e.level, text: e.text });
  }
  return { addDamage, persistentDamage, ignoreResistance, riders };
}

/** Format an MpDamage as a human string fragment, e.g. "1d6 fire", "1 persistent fire". The 'untyped'
 *  placeholder (Bane/Wild deal the weapon's base type) renders readably unless a concrete base type is
 *  supplied. */
export function formatMpDamage(dmg: MpDamage, baseType?: string): string {
  const type = dmg.type === 'untyped' ? baseType ?? "the weapon's type" : dmg.type;
  const body = dmg.dice && dmg.die ? `${dmg.dice}${dmg.die}` : `${dmg.flat ?? 0}`;
  return `${body}${dmg.persistent ? ' persistent' : ''} ${type}`;
}

// ── damage-scale helpers (keep the catalog compact + accurate) ──
export const f = (flat: number, type: DamageType, persistent?: boolean): MpDamage => ({ flat, type, persistent });
export const d = (dice: number, die: DieSize, type: DamageType, persistent?: boolean): MpDamage => ({ dice, die, type, persistent });

// ───────────────────────── Catalog access ─────────────────────────

/** The full property catalog, sorted by name. Chaotic/Lawful get their paths resolved from Unholy/Holy. */
export const MONSTER_PART_PROPERTIES: MpProperty[] = (() => {
  const byId = new Map(MONSTER_PART_CATALOG.map((p) => [p.id, p]));
  const resolved = MONSTER_PART_CATALOG.map((p) => {
    if (p.reusesPathsOf) {
      const base = byId.get(p.reusesPathsOf);
      if (base) return { ...p, paths: base.paths };
    }
    return p;
  });
  return resolved.sort((a, b) => a.name.localeCompare(b.name));
})();

const PROPERTY_BY_ID: Record<string, MpProperty> = Object.fromEntries(MONSTER_PART_PROPERTIES.map((p) => [p.id, p]));

export function getMpProperty(id: string): MpProperty | undefined {
  return PROPERTY_BY_ID[id];
}

/** Properties offerable for a refined item of the given kind. */
export function propertiesForKind(kind: MpItemKind): MpProperty[] {
  return MONSTER_PART_PROPERTIES.filter((p) => p.appliesTo.includes(kind));
}

// ───────────────────────── Granted spells (reference) ─────────────────────────

export interface MpSpellGrant {
  /** Candidate spell name (validate against the spell DB before surfacing). */
  name: string;
  freq: 'cantrip' | 'day' | 'hour' | 'minute';
}

function grantFreq(text: string): MpSpellGrant['freq'] {
  if (/as a cantrip/i.test(text)) return 'cantrip';
  if (/once\/minute/i.test(text)) return 'minute';
  if (/once\/hour/i.test(text)) return 'hour';
  return 'day';
}

/** Spell names a single rider's "Cast …" clause grants (split on and/or; a leading rank/article
 *  stripped). Anchored on the verb so non-grant prose ("Strikes deal…") is ignored. */
function parseCastNames(text: string): string[] {
  const out: string[] = [];
  const re =
    /\bcasts?\s+(?:(?:either|both)\s+)?(.+?)(?=\s+(?:as a cantrip|once\/day|once\/hour|once\/minute|each once\/day|instead|on (?:you|yourself|an ally)|automatically|\(|;|\.|$))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    for (const part of m[1].split(/\s*,\s*|\s+(?:and|or)\s+/i)) {
      const n = part
        .replace(/^\d+(?:st|nd|rd|th)[-\s](?:level|rank)\s+/i, '')
        .replace(/^(?:both |either |and |or |a |an |the )/i, '')
        .trim();
      if (n) out.push(n);
    }
  }
  return out;
}

/** Spells an imbued property grants at `level` (cumulative; honors "no longer X" supersession).
 *  Returns candidate NAMES + frequency — the caller matches them to the content spell DB. */
export function imbuementGrantedSpells(path: MpPath, level: number): MpSpellGrant[] {
  const granted = new Map<string, MpSpellGrant>();
  for (const e of [...path.levels].sort((a, b) => a.level - b.level)) {
    if (e.level > level) break;
    for (const rm of e.text.matchAll(/no longer ([A-Za-z][\w'’ ]+?)(?=[).,;]|$)/gi)) granted.delete(rm[1].trim().toLowerCase());
    const freq = grantFreq(e.text);
    for (const name of parseCastNames(e.text)) granted.set(name.toLowerCase(), { name, freq });
  }
  return [...granted.values()];
}

// ───────────────────────── Derived-effect resolvers (used by rules/derive + play) ─────────────────────────

/** The refined item level a Monster-Parts blob currently sits at, capped at the character's level
 *  (rules: "You can't refine above your own level"). Derived from the refine value via Table 3. */
export function mpRefinedLevel(mp: ItemMonsterPart | undefined, characterLevel: number): number {
  if (!mp) return 0;
  return Math.min(itemLevelForValue(mp.refineValue, mp.kind), Math.max(0, characterLevel));
}

/** An imbued property's EFFECTIVE level: its value-derived level, capped at the item's refined level
 *  AND the character's level, whichever is lower (rules: "An imbued property can't exceed the item's
 *  level or your level, whichever is lower"). */
export function mpEffectiveImbueLevel(mp: ItemMonsterPart | undefined, im: ItemImbuementLite, characterLevel: number): number {
  if (!mp) return 0;
  const raw = propertyLevelForValue(im.value, mp.kind);
  return Math.max(0, Math.min(raw, mpRefinedLevel(mp, characterLevel), Math.max(0, characterLevel)));
}

/** Weapon refinement (Table 4A) at the item's capped refined level. */
export function mpWeaponRefine(mp: ItemMonsterPart | undefined, characterLevel: number): WeaponRefinement {
  return weaponRefinement(mpRefinedLevel(mp, characterLevel));
}
/** Armor refinement (Table 4B) at the item's capped refined level. */
export function mpArmorRefine(mp: ItemMonsterPart | undefined, characterLevel: number): ArmorRefinement {
  return armorRefinement(mpRefinedLevel(mp, characterLevel));
}
/** Shield refinement (Table 4C) at the item's capped refined level. */
export function mpShieldRefine(mp: ItemMonsterPart | undefined, characterLevel: number): ShieldRefinement {
  return shieldRefinement(mpRefinedLevel(mp, characterLevel));
}
/** Perception/skill item refinement bonus (Tables 4D/4E) at the item's capped refined level. */
export function mpSenseSkillRefine(mp: ItemMonsterPart | undefined, characterLevel: number): number {
  return senseSkillRefinement(mpRefinedLevel(mp, characterLevel)).bonus;
}

/** A minimal imbuement shape (avoids a hard dependency on types.ts's ItemImbuement here). */
export interface ItemImbuementLite {
  propertyId: string;
  path: string;
  value: number;
  choice?: string;
}

/** Structured per-hit damage terms an item's imbuements add to each Strike. The 'untyped' placeholder
 *  (Bane/Wild deal the WEAPON's base damage type) is resolved to `baseType`. Terms are merged by
 *  {persistent, type, dice/flat} so two identical imbuements read as one combined term. Per-hit only —
 *  situational crit riders stay as reference prose on the item. */
export function mpImbuedDamageTerms(
  mp: ItemMonsterPart | undefined,
  baseType: string,
  characterLevel: number,
): MpDamage[] {
  if (!mp) return [];
  const terms: MpDamage[] = [];
  for (const im of mp.imbuements) {
    const prop = getMpProperty(im.propertyId);
    if (!prop) continue;
    const path = prop.paths.find((pa) => pa.id === im.path) ?? prop.paths[0];
    if (!path) continue;
    const level = mpEffectiveImbueLevel(mp, im, characterLevel);
    if (level <= 0) continue;
    const r = resolvePath(path, level);
    for (const dd of [r.addDamage, r.persistentDamage]) {
      if (!dd) continue;
      terms.push({ ...dd, type: dd.type === 'untyped' ? (baseType as DamageType) : dd.type });
    }
  }
  const merged = new Map<string, MpDamage>();
  for (const t of terms) {
    const key = `${t.persistent ? 'p' : ''}|${t.type}|${t.dice && t.die ? t.die : 'flat'}`;
    const prev = merged.get(key);
    if (!prev) merged.set(key, { ...t });
    else if (t.dice && t.die) prev.dice = (prev.dice ?? 0) + t.dice;
    else prev.flat = (prev.flat ?? 0) + (t.flat ?? 0);
  }
  return [...merged.values()];
}

/** Energy-Resistant / Sensory grants from an item's imbuements at their effective levels. Resistances
 *  are keyed by chosen energy type with value = the property's level; senses list the passive senses
 *  gained while invested. */
export function mpDefenseGrants(
  mp: ItemMonsterPart | undefined,
  characterLevel: number,
): { resistances: { type: string; value: number }[]; senses: string[] } {
  const resistances: { type: string; value: number }[] = [];
  const senses: string[] = [];
  if (!mp) return { resistances, senses };
  for (const im of mp.imbuements) {
    const prop = getMpProperty(im.propertyId);
    if (!prop) continue;
    const level = mpEffectiveImbueLevel(mp, im, characterLevel);
    if (level <= 0) continue;
    if (prop.resistance && im.choice) resistances.push({ type: im.choice, value: level });
    for (const s of prop.senses ?? []) if (level >= s.level) senses.push(s.sense);
  }
  return { resistances, senses };
}

// ───────────────────────── Applied-effect summary (item description) ─────────────────────────

/** One imbued property's applied effect at its effective level, for the item-description readout. */
export interface MpAppliedImbuement {
  name: string;
  pathName: string;
  level: number;
  /** Per-hit damage / resistance / sense / apex lines the property currently applies. */
  effects: string[];
}

/** The full applied Monster-Parts effect readout for an item's stored blob, at the character's level.
 *  Refinement produces one summary line per benefit (attack/dice/AC/saves/hardness/bonus + imbue slots);
 *  each imbued property lists its current per-hit damage, resistance, sense, or apex effect. Built from
 *  the same catalog + tables derive uses, so it always matches what the sheet applies. */
export interface MpApplied {
  kind: MpItemKind;
  refinedLevel: number;
  refineLines: string[];
  imbuements: MpAppliedImbuement[];
}
export function mpApplied(mp: ItemMonsterPart | undefined, baseType: string | undefined, characterLevel: number): MpApplied | null {
  if (!mp) return null;
  const kind = mp.kind;
  const level = mpRefinedLevel(mp, characterLevel);
  const refineLines: string[] = [];
  const slots = imbueSlots(kind, level);
  if (kind === 'weapon') {
    const r = weaponRefinement(level);
    if (r.attack) refineLines.push(`+${r.attack} item bonus to attack rolls`);
    if (r.extraDice) refineLines.push(`+${r.extraDice} weapon damage ${r.extraDice > 1 ? 'dice' : 'die'} (striking)`);
  } else if (kind === 'armor') {
    const r = armorRefinement(level);
    if (r.ac) refineLines.push(`+${r.ac} item bonus to AC`);
    if (r.saves) refineLines.push(`+${r.saves} item bonus to saves (resilient)`);
  } else if (kind === 'shield') {
    const r = shieldRefinement(level);
    if (r.hardness) refineLines.push(`Hardness ${r.hardness}, HP ${r.hp}, BT ${r.bt}`);
  } else {
    const b = senseSkillRefinement(level).bonus;
    if (b) refineLines.push(`+${b} item bonus to ${kind === 'perception' ? 'Perception' : 'the chosen skill'}`);
  }
  if (slots) refineLines.push(`${slots} imbuing slot${slots === 1 ? '' : 's'}`);

  const imbuements: MpAppliedImbuement[] = [];
  for (const im of mp.imbuements) {
    const prop = getMpProperty(im.propertyId);
    if (!prop) continue;
    const path = prop.paths.find((pa) => pa.id === im.path) ?? prop.paths[0];
    const effLvl = mpEffectiveImbueLevel(mp, im, characterLevel);
    if (effLvl <= 0) continue;
    const r = path ? resolvePath(path, effLvl) : null;
    const effects: string[] = [];
    if (r?.addDamage) effects.push(`+${formatMpDamage(r.addDamage, baseType)} on a hit`);
    if (r?.persistentDamage) effects.push(formatMpDamage(r.persistentDamage, baseType));
    if (prop.resistance && im.choice) effects.push(`resistance ${effLvl} to ${im.choice}`);
    for (const s of prop.senses ?? []) if (effLvl >= s.level) effects.push(s.sense);
    if (prop.apexAbility && effLvl >= (prop.apexLevel ?? 17)) effects.push(`apex: raises ${prop.apexAbility.toUpperCase()}`);
    imbuements.push({ name: prop.name, pathName: path?.name ?? '', level: effLvl, effects });
  }
  return { kind, refinedLevel: level, refineLines, imbuements };
}

// ───────────────────────── Apex attribute ─────────────────────────

interface ApexProbeItem {
  invested?: boolean;
  worn?: boolean;
  equipped?: boolean;
  monsterPart?: ItemMonsterPart;
}

/** The single Monster Parts apex attribute in effect, from an invested/worn/equipped item imbued with
 *  an apex property (Str/Dex/Con/Int/Wis/Cha) whose EFFECTIVE level is at or above its apex level (17).
 *  Only one apex item works at a time — the first qualifying item wins. Returns the ability, or null. */
export function monsterPartApex(inventory: ApexProbeItem[] | undefined, characterLevel: number): AbilityId | null {
  for (const inv of inventory ?? []) {
    if (!(inv.invested || inv.worn || inv.equipped)) continue;
    const mp = inv.monsterPart;
    if (!mp) continue;
    for (const im of mp.imbuements) {
      const prop = getMpProperty(im.propertyId);
      if (prop?.apexAbility && mpEffectiveImbueLevel(mp, im, characterLevel) >= (prop.apexLevel ?? 17)) return prop.apexAbility;
    }
  }
  return null;
}

// ───────────────────────── Monster-part items: tag vocabulary + reference helpers ─────────────────────────

/**
 * The tag VOCABULARY offered when marking a created item as a monster part. Grouped for a picker;
 * derived from the imbued-property requirements (energy/damage types, traits, attributes, senses,
 * hardness/precision, bane creature types, skills). Free-text tags outside this list are allowed —
 * the vocabulary is a convenience, never a constraint.
 */
export const MONSTER_PART_TAGS: { group: string; tags: string[] }[] = [
  {
    group: 'Energy & damage',
    tags: ['acid', 'cold', 'electricity', 'fire', 'force', 'mental', 'poison', 'sonic', 'spirit', 'vitality', 'void', 'bludgeoning', 'piercing', 'slashing'],
  },
  { group: 'Traits', tags: ['holy', 'unholy'] },
  { group: 'Attributes', tags: ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] },
  { group: 'Movement & senses', tags: ['fly', 'low-light vision', 'darkvision', 'greater darkvision', 'scent', 'truesight'] },
  { group: 'Defenses', tags: ['hardness', 'precision'] },
  {
    // (Note: 'spirit' is also a bane creature type but lives in the Energy & damage group above to keep
    // the flat vocabulary de-duplicated; a picker can surface it under either heading.)
    group: 'Creature types (bane)',
    tags: ['aberration', 'animal', 'astral', 'beast', 'celestial', 'construct', 'dragon', 'dream', 'elemental', 'ethereal', 'fey', 'fiend', 'giant', 'monitor', 'ooze', 'time', 'undead', 'fungus', 'plant'],
  },
  {
    group: 'Skills',
    tags: ['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival', 'thievery'],
  },
];

/** The flat set of all vocabulary tags (lowercased). Free text beyond this is still permitted. */
export const MONSTER_PART_TAG_SET: Set<string> = new Set(MONSTER_PART_TAGS.flatMap((g) => g.tags));

/**
 * The tag(s) that satisfy an imbued property's part REQUIREMENT — a best-effort, informational mapping
 * used only for the "you hold a matching part" hint. Energy/damage properties map to their type; apex
 * skill properties to their attribute; Bane/Spell/Wild have no fixed requirement (they accept anything
 * or a player choice) and return an empty list (⇒ always considered satisfied by the hint).
 */
export function propertyRequirementTags(propertyId: string): string[] {
  const p = getMpProperty(propertyId);
  if (!p) return [];
  switch (p.id) {
    // Energy / damage weapon properties: the matching damage type.
    case 'acid': case 'cold': case 'electricity': case 'fire': case 'force': case 'mental':
    case 'poison': case 'sonic': case 'void':
      return [p.id];
    case 'holy': case 'lawful': return ['holy', 'spirit'];
    case 'unholy': case 'chaotic': return ['unholy', 'spirit'];
    case 'vitality': return ['vitality', 'holy'];
    case 'energy-resistant': return p.choiceOptions ?? [];
    // Apex / skill items: the attribute (skill properties come from a creature with that top attribute).
    case 'strength': return ['strength'];
    case 'dexterity': return ['dexterity'];
    case 'constitution': return ['constitution'];
    case 'intelligence': return ['intelligence'];
    case 'wisdom': return ['wisdom'];
    case 'charisma': return ['charisma'];
    case 'winged': return ['fly'];
    case 'sensory': return ['low-light vision', 'darkvision', 'scent', 'greater darkvision', 'truesight'];
    case 'fortification': return ['precision'];
    case 'sturdy': return ['hardness'];
    // Bane's requirement is the chosen creature type; Spell/Wild accept anything → no fixed tag.
    default: return [];
  }
}

/** The parts a character currently holds: total gp value + the union of their tags. Computed from the
 *  inventory items flagged `isMonsterPart` (value = price × quantity; tags lowercased + de-duped).
 *  Purely a reference — nothing here blocks refining/imbuing. */
export interface AvailableParts {
  totalGp: number;
  tags: string[];
}

/** Look up an inventory item's definition (created monster-part items live in content.items). */
type ItemResolver = Pick<ContentDatabase, 'items'> | ((itemId: string) => Item | undefined);
function resolveItem(resolver: ItemResolver, itemId: string): Item | undefined {
  return typeof resolver === 'function' ? resolver(itemId) : resolver.items[itemId];
}

/** Sum the gp value + union the tags of every `isMonsterPart` inventory item the character holds. */
export function availableMonsterParts(
  inventory: InventoryItem[] | undefined,
  resolver: ItemResolver,
): AvailableParts {
  let totalCp = 0;
  const tags = new Set<string>();
  for (const inv of inventory ?? []) {
    const def = resolveItem(resolver, inv.itemId);
    if (!def?.isMonsterPart) continue;
    totalCp += coinsToCp(def.price) * Math.max(1, inv.quantity);
    for (const t of def.monsterPartTags ?? []) if (t.trim()) tags.add(t.trim().toLowerCase());
  }
  return { totalGp: Math.floor(totalCp / 100), tags: [...tags] };
}

/** Whether the character's available part tags satisfy a property's requirement (informational only).
 *  A property with no fixed requirement (Bane/Spell/Wild) is always considered a match. */
export function hasMatchingPart(propertyId: string, availableTags: string[] | Set<string>): boolean {
  const need = propertyRequirementTags(propertyId);
  if (need.length === 0) return true;
  const have = availableTags instanceof Set ? availableTags : new Set(availableTags.map((t) => t.toLowerCase()));
  return need.some((t) => have.has(t.toLowerCase()));
}

/** A stable id for a generic salvaged monster-part item (unique-ish per salvage, no bestiary source). */
let salvageSeq = 0;
export function nextSalvagedPartId(): string {
  return `mp-salvage-${Date.now().toString(36)}-${(salvageSeq++).toString(36)}`;
}

/**
 * Salvage an item's Monster-Parts blob into a GENERIC monster-part ITEM (isMonsterPart, NO tags) worth
 * 50% of the item's total refine + imbue value. Returns a ready-to-register `Item` definition (the
 * caller registers it + adds it to the inventory via addInventoryItem). Returns null if there's nothing
 * to recover. Replaces the old salvage→bank path.
 */
export function salvageToMonsterPart(mp: ItemMonsterPart | undefined, sourceName?: string): (Item & { isMonsterPart: true }) | null {
  const recover = salvageValue(mp);
  if (recover <= 0) return null;
  const id = nextSalvagedPartId();
  return {
    id,
    name: sourceName ? `Salvaged parts (${sourceName})` : 'Salvaged monster parts',
    itemType: 'treasure',
    value: { gp: recover },
    level: 0,
    price: { gp: recover },
    bulk: 0,
    traits: [],
    rarity: 'common',
    description: `Raw monster parts recovered by salvaging a refined/imbued item — worth ${recover.toLocaleString()} gp (50% of the parts sunk into it).`,
    isMonsterPart: true,
    monsterPartTags: [],
  };
}

// ───────────────────────── Treasure reference (Tables 1A–1C, 2) ─────────────────────────

/** Monster-parts budget in gp per party level, by variant (Tables 1A Light / 1B Hybrid / 1C Full). */
export const MP_TREASURE_BY_LEVEL: Record<MonsterPartsMode, Record<number, number>> = {
  light: {
    1: 40, 2: 70, 3: 120, 4: 200, 5: 320, 6: 500, 7: 720, 8: 1000, 9: 1400, 10: 2000, 11: 2800,
    12: 4000, 13: 6000, 14: 9000, 15: 13000, 16: 20000, 17: 30000, 18: 48000, 19: 80000, 20: 140000,
  },
  hybrid: {
    1: 95, 2: 165, 3: 280, 4: 460, 5: 730, 6: 1110, 7: 1580, 8: 2200, 9: 3100, 10: 4400, 11: 6200,
    12: 9000, 13: 13500, 14: 20000, 15: 29500, 16: 45000, 17: 69000, 18: 112000, 19: 190000, 20: 280000,
  },
  full: {
    1: 175, 2: 300, 3: 500, 4: 860, 5: 1350, 6: 2000, 7: 2900, 8: 4000, 9: 5700, 10: 8000, 11: 11500,
    12: 16500, 13: 25000, 14: 36500, 15: 54500, 16: 82500, 17: 128000, 18: 208000, 19: 355000, 20: 490000,
  },
};

/** Parts gained per part-granting monster, by creature level and variant (Tables 2A/2B/2C). */
export const MP_PARTS_PER_MONSTER: Record<MonsterPartsMode, Record<number, number>> = {
  light: {
    [-1]: 1.5, 0: 2.25, 1: 3.5, 2: 5, 3: 7, 4: 12, 5: 18, 6: 30, 7: 45, 8: 64, 9: 90, 10: 125, 11: 175,
    12: 250, 13: 375, 14: 560, 15: 810, 16: 1250, 17: 1875, 18: 3000, 19: 5000, 20: 8750, 21: 10000,
    22: 17500, 23: 20000, 24: 35000, 25: 40000,
  },
  hybrid: {
    [-1]: 3.5, 0: 5, 1: 7, 2: 12, 3: 18, 4: 27, 5: 45, 6: 65, 7: 100, 8: 140, 9: 200, 10: 275, 11: 390,
    12: 560, 13: 840, 14: 1250, 15: 1850, 16: 2800, 17: 4300, 18: 7000, 19: 12000, 20: 17500, 21: 24000,
    22: 35000, 23: 48000, 24: 70000, 25: 96000,
  },
  full: {
    [-1]: 6.5, 0: 9, 1: 13, 2: 22, 3: 30, 4: 50, 5: 80, 6: 125, 7: 180, 8: 250, 9: 360, 10: 500, 11: 720,
    12: 1030, 13: 1560, 14: 2300, 15: 3400, 16: 5150, 17: 8000, 18: 13000, 19: 22500, 20: 30000, 21: 45000,
    22: 60000, 23: 90000, 24: 120000, 25: 180000,
  },
};

export const MP_MODE_LABELS: Record<MonsterPartsMode, string> = { full: 'Full', light: 'Light', hybrid: 'Hybrid' };
export const MP_MODE_DESCRIPTIONS: Record<MonsterPartsMode, string> = {
  full: 'Replaces nearly all wealth with monster parts.',
  light: 'Replaces only currency; runes and other magic items still exist (the party builds only a few part-items).',
  hybrid: 'Replaces currency + about half of the permanent items; keeps the rest and all consumables.',
};
