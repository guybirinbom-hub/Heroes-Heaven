/*
 * Companion stat derivation (animal companions + familiars).
 *
 * An animal companion is the same level as its handler. Its AC / HP / saves /
 * Perception / attack / skills follow a universal formula keyed off the companion's
 * MATURITY (young → mature → nimble/savage → specialized), combined with the per-type
 * data (ability modifiers, attacks, signature skills) in ContentDatabase.
 *
 * stat = level + abilityModifier + proficiencyBonus(rank)   [AC also + 10]
 *
 * The maturity ranks + HP formula are sourced from the published Animal Companion
 * rules (Archives of Nethys), authored into COMPANION_FORMULA below.
 */
import { deriveAc, deriveMaxHp, derivePerception, deriveSave, profBonus, pwl, bestHandwrapsRunes, bestMpHandwraps } from './derive';
import { mpWeaponRefine, mpImbuedDamageTerms, type MpDamage } from './monsterParts';
import { abpOn, abpAttack, abpStrikingDice } from './abp';
import { conditionPenalty } from './conditions';
import { modeNumberBonus } from './modes';
import { SPECIFIC_FAMILIARS_BY_ID } from './specificFamiliars';
import type {
  AbilityId,
  ActionCost,
  ActiveCondition,
  AnimalCompanionType,
  Character,
  CompanionConfig,
  ContentDatabase,
  DamageType,
  EidolonConfig,
  FamiliarAbility,
  ModeDef,
  ProficiencyRank,
  SkillId,
} from './types';

/** A save's defining ability → the save name a mode targets (modes match saves by name, not ability). */
const SAVE_NAME: Partial<Record<AbilityId, string>> = { con: 'fortitude', dex: 'reflex', wis: 'will' };

export type Maturity = 'young' | 'mature' | 'nimble' | 'savage' | 'specialized' | 'specialized-savage';

interface MaturityRow {
  ranks: {
    ac: ProficiencyRank;
    saves: ProficiencyRank;
    perception: ProficiencyRank;
    attack: ProficiencyRank;
    signatureSkills: ProficiencyRank;
    otherSkills: ProficiencyRank;
  };
  speedBonus: number;
  /** Cumulative ability-modifier boosts from young, applied at this maturity. */
  abilityBoosts: Partial<Record<AbilityId, number>>;
  /** Number of weapon damage dice (young 1 → mature/nimble/savage 2 → specialized 3). */
  damageDice: number;
  /** Flat additional unarmed damage (nimble +2, savage +3, specialized +4). */
  flatDamage: number;
}

/**
 * Sourced from the AoN animal-companion rules (verified via the data workflow). A
 * companion's AC and unarmed-attack proficiency stay TRAINED (only saves/Perception
 * and the signature skill advance); maturity instead boosts ability modifiers, adds
 * damage dice, and (nimble/savage) grants speed + flat damage. HP = 6 + (6 + Con)/level.
 */
export const COMPANION_FORMULA: {
  hpBase: number;
  hpPerLevel: number;
  hpAddConPerLevel: boolean;
  maturities: Record<Maturity, MaturityRow>;
} = {
  hpBase: 6,
  hpPerLevel: 6,
  hpAddConPerLevel: true,
  maturities: {
    young: {
      ranks: { ac: 'trained', saves: 'trained', perception: 'trained', attack: 'trained', signatureSkills: 'trained', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: {}, damageDice: 1, flatDamage: 0,
    },
    mature: {
      ranks: { ac: 'trained', saves: 'expert', perception: 'expert', attack: 'trained', signatureSkills: 'expert', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: { str: 1, dex: 1, con: 1, wis: 1 }, damageDice: 2, flatDamage: 0,
    },
    nimble: {
      ranks: { ac: 'trained', saves: 'expert', perception: 'expert', attack: 'trained', signatureSkills: 'expert', otherSkills: 'trained' },
      // No inherent Speed bonus — a Speed increase comes only from the Racer specialization (+10 ft).
      speedBonus: 0, abilityBoosts: { str: 2, dex: 3, con: 2, wis: 2 }, damageDice: 2, flatDamage: 2,
    },
    savage: {
      ranks: { ac: 'trained', saves: 'expert', perception: 'expert', attack: 'trained', signatureSkills: 'expert', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: { str: 3, dex: 2, con: 2, wis: 2 }, damageDice: 2, flatDamage: 3,
    },
    // Specialized on the NIMBLE path (cumulative: mature +1 all, nimble Dex+2, specialized Dex+1/Int+2).
    specialized: {
      ranks: { ac: 'trained', saves: 'master', perception: 'master', attack: 'expert', signatureSkills: 'master', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: { str: 2, dex: 4, con: 2, wis: 2, int: 2 }, damageDice: 3, flatDamage: 4,
    },
    // Specialized on the SAVAGE path (savage Str+2 & +3 dmg, specialized Dex+1/Int+2 & dmg 3→6). Str is one
    // higher / Dex one lower than the nimble path, and flat unarmed damage is +6 rather than +4.
    'specialized-savage': {
      ranks: { ac: 'trained', saves: 'master', perception: 'master', attack: 'expert', signatureSkills: 'master', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: { str: 3, dex: 3, con: 2, wis: 2, int: 2 }, damageDice: 3, flatDamage: 6,
    },
  },
};

export const MATURITIES: Maturity[] = ['young', 'mature', 'nimble', 'savage', 'specialized', 'specialized-savage'];

/** Skills every animal companion is trained in, beyond its type's signature skills. */
const UNIVERSAL_SKILLS: SkillId[] = ['acrobatics', 'athletics'];
const SKILL_ABILITY: Record<string, AbilityId> = {
  acrobatics: 'dex', athletics: 'str', stealth: 'dex', survival: 'wis', intimidation: 'cha',
  arcana: 'int', crafting: 'int', deception: 'cha', diplomacy: 'cha', medicine: 'wis',
  nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis', society: 'int', thievery: 'dex',
};

export interface StatMod {
  name: string;
  modifier: number;
  rank: ProficiencyRank;
}
export interface AnimalCompanionBlock {
  name: string;
  typeName: string;
  /** 'animal' (default) or 'construct'. */
  category: 'animal' | 'construct';
  size: string;
  level: number;
  maturity: Maturity;
  /** Chosen specialization (when specialized), for display. */
  specialization?: { id: string; name: string };
  abilities: Record<AbilityId, number>;
  ac: number;
  hp: number;
  saves: { fortitude: StatMod; reflex: StatMod; will: StatMod };
  perception: StatMod;
  speeds: { land?: number; fly?: number; swim?: number; climb?: number; burrow?: number };
  senses: string[];
  attacks: { name: string; attack: number; damage: string; traits: string[] }[];
  skills: StatMod[];
  support: string;
  maneuver: string;
  /** Carried Bulk vs. capacity (only over-capacity is a problem). */
  bulk: { carried: number; encumberedAt: number; max: number };
  /** Worn/equipped gear contributing to the block (for the "what's applied" note). */
  gearNote?: string;
}

/** Carrying-capacity size multiplier (PF2e doubles per size above Medium, halves below). */
const SIZE_BULK_FACTOR: Record<string, number> = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 4, gargantuan: 8 };

interface CompanionGear {
  acBonus: number;
  dexCap: number | null;
  checkPenalty: number;
  speedPenalty: number;
  strikes: { name: string; die: string; dice: number; damageType: string; traits: string[] }[];
  carriedBulk: number;
  notes: string[];
}

/** Resolve a companion's worn/equipped gear into stat effects: barding → AC + Dex cap +
 *  check/Speed penalties; a wielded weapon → an extra Strike; plus carried Bulk. */
function companionGear(cfg: CompanionConfig, content: ContentDatabase, strMod: number): CompanionGear {
  const g: CompanionGear = { acBonus: 0, dexCap: null, checkPenalty: 0, speedPenalty: 0, strikes: [], carriedBulk: 0, notes: [] };
  for (const it of cfg.inventory ?? []) {
    const def = content.items[it.itemId];
    if (!def) continue;
    g.carriedBulk += (def.bulk || 0) * (it.quantity || 1);
    if (def.itemType === 'armor' && it.worn) {
      g.acBonus += def.acBonus;
      if (def.dexCap != null) g.dexCap = g.dexCap == null ? def.dexCap : Math.min(g.dexCap, def.dexCap);
      // armor.strength is a MODIFIER threshold (Remaster), so compare it against the Str MODIFIER —
      // not a reconstructed Strength score, which would spuriously always meet the requirement.
      const meets = def.strength == null || strMod >= def.strength;
      if (def.checkPenalty) g.checkPenalty += meets ? 0 : -Math.abs(def.checkPenalty);
      if (def.speedPenalty) g.speedPenalty += meets ? -Math.max(0, Math.abs(def.speedPenalty) - 5) : -Math.abs(def.speedPenalty);
      const bits = [`+${def.acBonus} AC`];
      if (def.checkPenalty && !meets) bits.push(`${def.checkPenalty} check`);
      if (def.speedPenalty) bits.push(`${meets ? -Math.max(0, Math.abs(def.speedPenalty) - 5) : -Math.abs(def.speedPenalty)} ft Speed`);
      g.notes.push(`${def.name} (${bits.join(', ')})`);
    } else if (def.itemType === 'weapon' && it.equipped) {
      const dieSize = (def.damage.die.match(/d(\d+)/) || [])[1] ?? '6';
      g.strikes.push({ name: def.name, die: `d${dieSize}`, dice: def.damage.dice, damageType: def.damage.type, traits: def.traits ?? [] });
    }
  }
  return g;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Derive the full stat block for an animal companion at the handler's level. */
const RANK_ORDER: ProficiencyRank[] = ['untrained', 'trained', 'expert', 'master', 'legendary'];
/** The higher of two proficiency ranks (b optional). */
function rankMax(a: ProficiencyRank, b?: ProficiencyRank): ProficiencyRank {
  return b && RANK_ORDER.indexOf(b) > RANK_ORDER.indexOf(a) ? b : a;
}

export function deriveAnimalCompanion(
  cfg: CompanionConfig,
  type: AnimalCompanionType,
  level: number,
  content: ContentDatabase,
  conditions: ActiveCondition[] = [],
  withoutLevel = false,
  modes: ModeDef[] = [],
): AnimalCompanionBlock {
  const maturity = (cfg.maturity as Maturity) || 'young';
  const m = COMPANION_FORMULA.maturities[maturity] ?? COMPANION_FORMULA.maturities.young;
  // Maturity boosts the base (young) ability modifiers.
  const ab = { ...type.abilities };
  for (const k of Object.keys(m.abilityBoosts) as AbilityId[]) ab[k] = (ab[k] ?? 0) + (m.abilityBoosts[k] ?? 0);

  // Specialization applies only once the companion is specialized: extra ability boosts,
  // skill/AC rank overrides, and a Speed bonus (Racer) layered on the generic benefits.
  const spec = maturity === 'specialized' && cfg.specialization ? content.companionSpecializations?.[cfg.specialization] : undefined;
  if (spec?.abilityBoosts) for (const k of Object.keys(spec.abilityBoosts) as AbilityId[]) ab[k] = (ab[k] ?? 0) + (spec.abilityBoosts[k] ?? 0);

  const gear = companionGear(cfg, content, ab.str ?? 0);

  const speeds = { ...type.speeds };
  if (speeds.land) speeds.land += m.speedBonus + (spec?.speedBonus ?? 0);
  // A worn armor/barding Speed penalty applies to every Speed.
  if (gear.speedPenalty) {
    for (const key of Object.keys(speeds) as (keyof typeof speeds)[]) {
      if (speeds[key] != null) speeds[key] = Math.max(0, (speeds[key] as number) + gear.speedPenalty);
    }
  }

  const acRank = rankMax(m.ranks.ac, spec?.acRank);
  const dexForAc = gear.dexCap != null ? Math.min(ab.dex ?? 0, gear.dexCap) : ab.dex ?? 0;
  const ac = 10 + dexForAc + profBonus(acRank, level, withoutLevel) + gear.acBonus + conditionPenalty(conditions, 'dex', 'ac') + modeNumberBonus(modes, { kind: 'ac' });
  // Per-type base HP (Bird 4 / Wolf 6 / Bear 8 …) + (6 + Con) per level.
  const hpBase = type.hp ?? COMPANION_FORMULA.hpBase;
  const hp = hpBase + (COMPANION_FORMULA.hpPerLevel + (COMPANION_FORMULA.hpAddConPerLevel ? (ab.con ?? 0) : 0)) * level;
  const save = (a: AbilityId): StatMod => ({
    name: '',
    modifier: (ab[a] ?? 0) + profBonus(m.ranks.saves, level, withoutLevel) + conditionPenalty(conditions, a, 'save') + modeNumberBonus(modes, { kind: 'save', detail: SAVE_NAME[a] }),
    rank: m.ranks.saves,
  });

  const buildAttack =(name: string, dice: number, dieSize: string, damageType: string, traits: string[], flatBonus: number) => {
    const finesse = traits.includes('finesse');
    const atkAbility: AbilityId = finesse && (ab.dex ?? 0) > (ab.str ?? 0) ? 'dex' : 'str';
    const flat = (ab.str ?? 0) + flatBonus + conditionPenalty(conditions, atkAbility, 'damage') + modeNumberBonus(modes, { kind: 'damage' });
    const dmgFlat = flat > 0 ? `+${flat}` : flat < 0 ? `${flat}` : '';
    return {
      name,
      attack: (ab[atkAbility] ?? 0) + profBonus(m.ranks.attack, level, withoutLevel) + conditionPenalty(conditions, atkAbility, 'attack') + modeNumberBonus(modes, { kind: 'attack' }),
      damage: `${dice}d${dieSize}${dmgFlat} ${damageType}`,
      traits,
    };
  };
  // Natural attacks scale dice with maturity; a wielded weapon uses its own dice (no maturity flat).
  const natural = type.attacks.map((atk) => buildAttack(atk.name, m.damageDice, (atk.die.match(/d(\d+)/) || [])[1] ?? '6', atk.damageType, atk.traits, m.flatDamage));
  const wielded = gear.strikes.map((w) => buildAttack(w.name, w.dice, w.die.replace(/^d/, ''), w.damageType, w.traits, 0));
  const attacks = [...natural, ...wielded];

  const sig = new Set(type.skills);
  const specSkill = new Map((spec?.skills ?? []).map((s) => [s.skill, s.rank] as const));
  const extraSpecSkills = (spec?.skills ?? []).map((s) => s.skill).filter((s) => !sig.has(s) && !UNIVERSAL_SKILLS.includes(s));
  const skillList = [...new Set<SkillId>([...UNIVERSAL_SKILLS, ...type.skills, ...extraSpecSkills])];
  const skills: StatMod[] = skillList.map((sk) => {
    // Only the companion's SIGNATURE skill advances with maturity; the universal Acrobatics/Athletics
    // (and any other non-signature skill) stay trained (otherSkills rank).
    let rank = sig.has(sk) ? m.ranks.signatureSkills : m.ranks.otherSkills;
    if (specSkill.has(sk)) rank = rankMax(rank, specSkill.get(sk));
    const ability = SKILL_ABILITY[sk];
    const checkPen = ability === 'str' || ability === 'dex' ? gear.checkPenalty : 0;
    return { name: cap(sk), modifier: (ab[ability] ?? 0) + profBonus(rank, level, withoutLevel) + checkPen + conditionPenalty(conditions, ability, 'skill') + modeNumberBonus(modes, { kind: 'skill', detail: sk }), rank };
  });

  const strMod = ab.str ?? 0;
  const factor = SIZE_BULK_FACTOR[type.size.toLowerCase()] ?? 1;
  const bulk = {
    carried: Math.round(gear.carriedBulk * 10) / 10,
    encumberedAt: Math.max(0, Math.floor((5 + strMod) * factor)),
    max: Math.max(1, Math.floor((10 + strMod) * factor)),
  };

  return {
    name: cfg.name || type.name,
    typeName: type.name,
    category: type.category ?? 'animal',
    size: type.size,
    level,
    maturity,
    specialization: spec ? { id: spec.id, name: spec.name } : undefined,
    abilities: ab,
    ac,
    hp,
    saves: { fortitude: save('con'), reflex: save('dex'), will: save('wis') },
    perception: {
      name: 'Perception',
      modifier: (ab.wis ?? 0) + profBonus(m.ranks.perception, level, withoutLevel) + conditionPenalty(conditions, 'wis', 'perception') + modeNumberBonus(modes, { kind: 'perception' }),
      rank: m.ranks.perception,
    },
    speeds,
    senses: type.senses,
    attacks,
    skills,
    support: type.support,
    maneuver: type.maneuver,
    bulk,
    gearNote: gear.notes.join('; ') || undefined,
  };
}

interface Defenses {
  ac: number;
  saves: { fortitude: number; reflex: number; will: number };
  perception: number;
}

/** A familiar / eidolon uses the master's AC, save modifiers, and Perception — then its
 * own conditions apply on top. */
function masterDefenses(character: Character, content: ContentDatabase, conditions: ActiveCondition[] = [], modes: ModeDef[] = []): Defenses {
  return {
    ac: deriveAc(character, content).value + conditionPenalty(conditions, 'dex', 'ac') + modeNumberBonus(modes, { kind: 'ac' }),
    saves: {
      // Pass content so the master's resilient-rune bonus is included (deriveSave needs it).
      fortitude: deriveSave(character, 'fortitude', content).modifier + conditionPenalty(conditions, 'con', 'save') + modeNumberBonus(modes, { kind: 'save', detail: 'fortitude' }),
      reflex: deriveSave(character, 'reflex', content).modifier + conditionPenalty(conditions, 'dex', 'save') + modeNumberBonus(modes, { kind: 'save', detail: 'reflex' }),
      will: deriveSave(character, 'will', content).modifier + conditionPenalty(conditions, 'wis', 'save') + modeNumberBonus(modes, { kind: 'save', detail: 'will' }),
    },
    perception: derivePerception(character).modifier + conditionPenalty(conditions, 'wis', 'perception') + modeNumberBonus(modes, { kind: 'perception' }),
  };
}

export interface FamiliarBlock extends Defenses {
  name: string;
  level: number;
  hp: number;
  /** Land Speed in feet (40 if Fast Movement is selected, else 25). */
  speed: number;
  /** Extra movement types granted by abilities (Flier → "fly 25 feet", etc.). */
  extraSpeeds: string[];
  abilities: { id: string; name: string; description: string; kind: string }[];
  /** When this familiar is a specific familiar (Pipefox, Imp, …). */
  specific?: {
    name: string;
    requiredCount: number;
    requiredAbilities: string[];
    specials: { name: string; cost?: ActionCost; desc: string }[];
    traits: string[];
    note?: string;
    source: string;
  };
}

/** A familiar is a Tiny minion: 5 HP per level, the master's AC/saves/Perception, plus its
 *  chosen abilities. A specific familiar adds its locked required abilities + special abilities. */
export function deriveFamiliar(
  cfg: CompanionConfig,
  character: Character,
  content: ContentDatabase,
  conditions: ActiveCondition[] = [],
  modes: ModeDef[] = [],
): FamiliarBlock {
  const abilities = (cfg.abilities ?? [])
    .map((id) => content.familiarAbilities[id])
    .filter((a): a is FamiliarAbility => !!a)
    .map((a) => ({ id: a.id, name: a.name, description: a.description, kind: a.kind }));
  const sf = cfg.specificFamiliarId ? SPECIFIC_FAMILIARS_BY_ID[cfg.specificFamiliarId] : undefined;
  const has = (id: string) => (cfg.abilities ?? []).includes(id);
  // The 'Tough' familiar ability raises max HP by 2 per level (base 5/level → 7/level). A specific
  // familiar that requires Tough (e.g. Spellslime) gets it even though its required abilities aren't
  // stored in cfg.abilities.
  const hasTough = has('tough') || (sf?.requiredAbilities ?? []).some((a) => a.toLowerCase() === 'tough');
  // Movement abilities: Fast Movement raises the land Speed 25→40; Flier/Climber/Burrower add types.
  const land = has('fast-movement') ? 40 : 25;
  const extraSpeeds: string[] = [];
  if (has('flier')) extraSpeeds.push('fly 25 feet');
  if (has('climber')) extraSpeeds.push('climb 25 feet');
  if (has('burrower')) extraSpeeds.push('burrow 5 feet');
  return {
    name: cfg.name || sf?.name || 'Familiar',
    level: character.level,
    hp: (5 + (hasTough ? 2 : 0)) * character.level,
    speed: land,
    extraSpeeds,
    ...masterDefenses(character, content, conditions, modes),
    // Spellslime's Ooze Defense: its AC is 10 + your level, NOT equal to yours (immune to crits/precision).
    ...(sf?.id === 'spellslime'
      ? { ac: 10 + character.level + conditionPenalty(conditions, 'dex', 'ac') + modeNumberBonus(modes, { kind: 'ac' }) }
      : {}),
    abilities,
    specific: sf
      ? {
          name: sf.name,
          requiredCount: sf.requiredCount,
          requiredAbilities: sf.requiredAbilities,
          specials: sf.specials.map((s) => ({ name: s.name, cost: s.cost as ActionCost | undefined, desc: s.desc })),
          traits: sf.traits,
          note: sf.note,
          source: sf.source,
        }
      : undefined,
  };
}

export interface EidolonBlock extends Defenses {
  name: string;
  tradition?: string;
  skills: string[];
  description: string;
  /** Shared with the summoner (one HP pool). */
  hp: number;
  speed: number;
  /** The eidolon's own ability modifiers (from its array + boosts). */
  abilities: Record<AbilityId, number>;
  /** Primary + secondary unarmed Strikes (the summoner's proficiency, the eidolon's Str/Dex). */
  attacks: { name: string; attack: number; damage: string; traits: string[] }[];
}

/** The eidolon's primary unarmed attack is chosen from these stat blocks (Secrets of Magic). The
 *  "1d8" choice is one trait from {disarm, nonlethal, shove, trip}, flattened here into one pick
 *  each. The secondary attack is always 1d6 with the agile + finesse traits. */
export const EIDOLON_PRIMARY_OPTIONS: { id: string; label: string; die: number; traits: string[] }[] = [
  { id: 'd8-disarm', label: '1d8 (disarm)', die: 8, traits: ['disarm'] },
  { id: 'd8-nonlethal', label: '1d8 (nonlethal)', die: 8, traits: ['nonlethal'] },
  { id: 'd8-shove', label: '1d8 (shove)', die: 8, traits: ['shove'] },
  { id: 'd8-trip', label: '1d8 (trip)', die: 8, traits: ['trip'] },
  { id: 'd6-fatal', label: '1d6 (fatal d10)', die: 6, traits: ['fatal d10'] },
  { id: 'd6-forceful', label: '1d6 (forceful, sweep)', die: 6, traits: ['forceful', 'sweep'] },
  { id: 'd6-deadly', label: '1d6 (deadly d8, finesse)', die: 6, traits: ['deadly d8', 'finesse'] },
];

/** A sensible level-1 starting spread so a freshly-added eidolon isn't broken-looking; the player
 *  overwrites these with their actual array + boost values in the Edit panel. */
const EIDOLON_DEFAULT_ABILITIES: Record<AbilityId, number> = { str: 4, dex: 2, con: 3, int: 0, wis: 1, cha: 1 };

/** The summoner's proficiency in the eidolon's unarmed attacks: trained → expert at 5 (Eidolon Unarmed
 *  Expertise) → master at 13 (Eidolon Unarmed Mastery). (class-features/eidolon-unarmed-expertise.json,
 *  eidolon-unarmed-mastery.json.) */
function eidolonAttackRank(level: number): ProficiencyRank {
  if (level >= 13) return 'master';
  if (level >= 5) return 'expert';
  return 'trained';
}

/** Eidolon Weapon Specialization: +2 damage with unarmed attacks it's expert in, +3 master, +4
 *  legendary, gained at level 7 (Eidolon Weapon Specialization) and doubled to +4/+6/+8 at level 15
 *  (Greater Eidolon Specialization). (class-features/eidolon-weapon-specialization.json,
 *  greater-eidolon-specialization.json.) */
function eidolonWeaponSpecDamage(level: number, rank: ProficiencyRank): number {
  if (level < 7) return 0;
  const tier = rank === 'legendary' ? 3 : rank === 'master' ? 2 : rank === 'expert' ? 1 : 0;
  if (tier === 0) return 0;
  return level >= 15 ? tier * 2 + 2 : tier + 1;
}

/** An eidolon shares the summoner's Hit Points and uses their AC/saves/Perception; its
 * tradition + trained skills come from the chosen eidolon (summoner subclass option). */
export function deriveEidolon(
  cfg: CompanionConfig,
  character: Character,
  content: ContentDatabase,
  conditions: ActiveCondition[] = [],
  modes: ModeDef[] = [],
): EidolonBlock {
  const opt = content.classes.summoner?.subclass?.options.find((o) => o.id === cfg.typeId);
  const ec: EidolonConfig = cfg.eidolon ?? {};
  // The eidolon has its OWN ability modifiers (from its array + boosts); the player sets them.
  // Per-key fallback (not a spread) so a cleared/undefined input falls back to the default — a
  // spread would let an explicit `undefined` overwrite the default and produce NaN math.
  const ab = Object.fromEntries(
    (Object.keys(EIDOLON_DEFAULT_ABILITIES) as AbilityId[]).map((a) => [a, ec.abilities?.[a] ?? EIDOLON_DEFAULT_ABILITIES[a]]),
  ) as Record<AbilityId, number>;
  const level = character.level;
  const withoutLevel = pwl(character);

  // An eidolon is always UNARMORED, uses ITS OWN Dexterity (capped by its array's Dex cap) and its OWN
  // unarmored-defense proficiency, which advances on the eidolon's schedule (NOT the summoner's): trained,
  // expert at 11 (Eidolon Defensive Expertise), master at 19 (Eidolon Defensive Mastery). The array's item
  // bonus to AC is added on top.
  const cappedDex = ec.dexCap != null ? Math.min(ab.dex, ec.dexCap) : ab.dex;
  const eidolonUnarmoredRank = level >= 19 ? 'master' : level >= 11 ? 'expert' : 'trained';
  const eidolonAc =
    10 +
    cappedDex +
    profBonus(eidolonUnarmoredRank, level, withoutLevel) +
    (ec.acItemBonus ?? 0) +
    conditionPenalty(conditions, 'dex', 'ac') +
    modeNumberBonus(modes, { kind: 'ac' });

  // Build an unarmed Strike: the summoner's eidolon-attack proficiency + the eidolon's Str (or Dex
  // when the attack is finesse and Dex is higher); damage is one die + Str, plus the summoner's
  // Eidolon Weapon Specialization flat. dmgType defaults to slashing (player picks B/P/S to match form).
  const attackRank = eidolonAttackRank(level);
  const specDamage = eidolonWeaponSpecDamage(level, attackRank);
  // The eidolon's Strikes benefit from the summoner's handwraps of mighty blows fundamental runes:
  // striking adds damage dice OF THE ATTACK'S OWN DIE (die-size rule); potency raises the attack roll.
  // ABP (Automatic Bonus Progression), when on, supplies these instead. (eidolon.json rune-sharing.)
  const hwRunes = bestHandwrapsRunes(character, content);
  // The summoner's Handwraps of Mighty Blows may be REFINED via the Monster Parts variant instead of
  // runes (bestHandwrapsRunes excludes MP-mode handwraps). Fold the refinement's attack/striking in the
  // same way the PC's own unarmed Strike does (deriveUnarmedStrike), else the eidolon silently loses all
  // potency, striking dice, and imbued damage from MP-refined handwraps.
  const mpHw = bestMpHandwraps(character, content);
  const mpRef = mpHw ? mpWeaponRefine(mpHw, level) : null;
  const mpTerm = (t: MpDamage): string =>
    `${t.dice && t.die ? `${t.dice}${t.die}` : `${t.flat ?? 0}`}${t.persistent ? ' persistent' : ''} ${t.type}`;
  const strikingTier = hwRunes?.striking === 'major' ? 3 : hwRunes?.striking === 'greater' ? 2 : hwRunes?.striking === 'striking' ? 1 : 0;
  const strikingDice = Math.max(abpOn(character) ? abpStrikingDice(level) : strikingTier, mpRef?.extraDice ?? 0);
  const potencyBonus = Math.max(abpOn(character) ? abpAttack(level) : hwRunes?.potency ?? 0, mpRef?.attack ?? 0);
  // Property runes on the shared Handwraps of Mighty Blows also ride on the eidolon's unarmed Strikes
  // (eidolon.json rune-sharing) — flaming → +1d6 fire, greater flaming → +2d10 persistent fire on a
  // crit, etc. Mirror the PC's own unarmed-strike rider math (deriveUnarmedStrike). ABP grants no
  // property runes, so these come only from real handwraps.
  const runeDamage = (hwRunes?.property ?? [])
    .map((pp) => content.runes[pp]?.damage)
    .filter((d): d is NonNullable<typeof d> => !!d);
  const runeDmg = runeDamage.map((d) => `${d.dice}${d.die} ${d.type}`);
  const runeCritPersistent = runeDamage
    .filter((d) => d.critPersistent)
    .map((d) => `${d.critPersistent!.dice}${d.critPersistent!.die} persistent ${d.type}`);
  const strike = (rawName: string | undefined, fallback: string, die: number, traits: string[], dmgType?: DamageType) => {
    const finesse = traits.includes('finesse');
    const atkAbility: AbilityId = finesse && ab.dex > ab.str ? 'dex' : 'str';
    const flat = ab.str + specDamage + conditionPenalty(conditions, atkAbility, 'damage') + modeNumberBonus(modes, { kind: 'damage' });
    const dmgFlat = flat > 0 ? `+${flat}` : flat < 0 ? `${flat}` : '';
    const dice = 1 + strikingDice;
    // Monster-Parts imbued damage on the shared handwraps folds into each Strike as per-hit "plus"
    // terms (like the PC's unarmed Strike), resolved against this Strike's own damage type.
    const mpDmg = mpHw ? mpImbuedDamageTerms(mpHw, dmgType ?? 'slashing', level).map(mpTerm) : [];
    const plusTerms = [...runeDmg, ...mpDmg];
    const damage =
      `${dice}d${die}${dmgFlat} ${dmgType ?? 'slashing'}` +
      (plusTerms.length ? ` plus ${plusTerms.join(' plus ')}` : '') +
      (runeCritPersistent.length ? ` (plus ${runeCritPersistent.join(', ')} on a crit)` : '');
    return {
      name: rawName?.trim() || fallback,
      attack: ab[atkAbility] + profBonus(attackRank, level, withoutLevel) + potencyBonus + conditionPenalty(conditions, atkAbility, 'attack') + modeNumberBonus(modes, { kind: 'attack' }),
      damage,
      traits: [...traits, 'unarmed'],
    };
  };
  const primaryOpt = EIDOLON_PRIMARY_OPTIONS.find((o) => o.id === ec.primary?.option) ?? EIDOLON_PRIMARY_OPTIONS[5]; // 1d6 forceful, sweep
  const attacks = [
    strike(ec.primary?.name, 'Primary', primaryOpt.die, primaryOpt.traits, ec.primary?.damageType),
    strike(ec.secondary?.name, 'Secondary', 6, ['agile', 'finesse'], ec.secondary?.damageType),
  ];

  return {
    name: cfg.name || opt?.name || 'Eidolon',
    tradition: opt?.tradition,
    skills: opt?.grants?.skills ?? [],
    description: opt?.description ?? '',
    hp: deriveMaxHp(character, content),
    speed: 25,
    abilities: ab,
    attacks,
    ...masterDefenses(character, content, conditions, modes),
    ac: eidolonAc,
  };
}
