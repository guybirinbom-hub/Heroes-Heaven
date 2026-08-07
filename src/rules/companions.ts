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
import { specificFamiliar } from './specificFamiliars';
import { COMPANION_MODS } from './companionGrants';
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
  SourceInfo,
} from './types';

/** A save's defining ability → the save name a mode targets (modes match saves by name, not ability). */
const SAVE_NAME: Partial<Record<AbilityId, string>> = { con: 'fortitude', dex: 'reflex', wis: 'will' };

/** young → mature → one of the four advancements → its specialized form. Nimble and savage are the
 *  Player Core pair; indomitable (megafauna), genie-touched and unseen (cryptid) are taken INSTEAD of
 *  them, from the same feat, and are sourced from Lost Omens World Guide / Legends / Dark Archives. */
export type Maturity =
  | 'young'
  | 'mature'
  | 'nimble'
  | 'savage'
  | 'indomitable'
  | 'genie-touched'
  | 'unseen'
  | 'specialized'
  | 'specialized-savage'
  | 'specialized-indomitable'
  | 'specialized-genie-touched'
  | 'specialized-unseen';

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
  /** Named skills this advancement raises, beyond the signature skill — nimble raises Acrobatics to
   *  expert, savage raises Athletics, unseen raises Stealth. These were previously unmodelled: every
   *  non-signature skill was pinned at `otherSkills` (trained), so a nimble companion's Acrobatics
   *  was a rank too low. Cumulative — a specialized companion keeps the one from its path. */
  skillUpgrades?: Partial<Record<SkillId, ProficiencyRank>>;
  /** Rules text the engine can't model (barding proficiency, elemental resistances, precision
   *  damage). Surfaced on the companion card so the player isn't silently short-changed. */
  note?: string;
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
    // Player Core p211: "Increase its Dexterity modifier by 2 and its Strength, Constitution, and
    // Wisdom modifiers by 1. Increase its proficiency ranks in Acrobatics to expert."
    nimble: {
      ranks: { ac: 'trained', saves: 'expert', perception: 'expert', attack: 'trained', signatureSkills: 'expert', otherSkills: 'trained' },
      // No inherent Speed bonus — a Speed increase comes only from the Racer specialization (+10 ft).
      speedBonus: 0, abilityBoosts: { str: 2, dex: 3, con: 2, wis: 2 }, damageDice: 2, flatDamage: 2,
      skillUpgrades: { acrobatics: 'expert' },
    },
    // Player Core p211: Str +2, Dex/Con/Wis +1, Athletics to expert, grows one size if Medium or smaller.
    savage: {
      ranks: { ac: 'trained', saves: 'expert', perception: 'expert', attack: 'trained', signatureSkills: 'expert', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: { str: 3, dex: 2, con: 2, wis: 2 }, damageDice: 2, flatDamage: 3,
      skillUpgrades: { athletics: 'expert' },
    },
    // --- Alternative advancements: taken INSTEAD of nimble/savage, from the same feat. Ability
    //     boosts below are cumulative from young (mature already gave +1 to Str/Dex/Con/Wis).
    // Lost Omens World Guide p117 (megafauna): Con +2, Str/Dex/Wis +1, Athletics AND barding to
    // expert, +3 damage, grows one size.
    indomitable: {
      ranks: { ac: 'trained', saves: 'expert', perception: 'expert', attack: 'trained', signatureSkills: 'expert', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: { str: 2, dex: 2, con: 3, wis: 2 }, damageDice: 2, flatDamage: 3,
      skillUpgrades: { athletics: 'expert' },
      note: 'Megafauna: barding proficiency is also expert, and the companion grows one size if Medium or smaller. The app has no barding-proficiency track, so apply that by hand.',
    },
    // Lost Omens Legends p123: Wis +2, Str/Dex/Con +1, +3 damage, resistance 5, and a skill that
    // depends on the chosen genie — Acrobatics for djinni/efreeti, Athletics for marid/shaitan.
    // Both are granted here because the element choice isn't modelled; see the note.
    'genie-touched': {
      ranks: { ac: 'trained', saves: 'expert', perception: 'expert', attack: 'trained', signatureSkills: 'expert', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: { str: 2, dex: 2, con: 2, wis: 3 }, damageDice: 2, flatDamage: 3,
      skillUpgrades: { acrobatics: 'expert', athletics: 'expert' },
      note: 'Choose a genie: djinni (air), efreeti (fire), marid (water) or shaitan (earth). It grants resistance 5 (acid for djinni, fire for efreeti/marid, electricity for shaitan) and its elemental trait. Only ONE skill actually goes to expert — Acrobatics for djinni/efreeti, Athletics for marid/shaitan — but the element isn’t tracked yet, so both are shown; ignore the one that doesn’t apply.',
    },
    // Dark Archives (Remastered) p65 (cryptid): Wis +2, Str/Dex/Con +1, Stealth to expert, +3 damage
    // and an extra 1d4 precision vs off-guard targets.
    unseen: {
      ranks: { ac: 'trained', saves: 'expert', perception: 'expert', attack: 'trained', signatureSkills: 'expert', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: { str: 2, dex: 2, con: 2, wis: 3 }, damageDice: 2, flatDamage: 3,
      skillUpgrades: { stealth: 'expert' },
      note: 'Cryptid: also deals an extra 1d4 precision damage against off-guard targets (combine with any precision damage the companion already has, e.g. a cat’s).',
    },
    // Specialized on the NIMBLE path (cumulative: mature +1 all, nimble Dex+2, specialized Dex+1/Int+2).
    // Keeps the path's skill upgrade — specializing never undoes Acrobatics/Athletics expert.
    specialized: {
      ranks: { ac: 'trained', saves: 'master', perception: 'master', attack: 'expert', signatureSkills: 'master', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: { str: 2, dex: 4, con: 2, wis: 2, int: 2 }, damageDice: 3, flatDamage: 4,
      skillUpgrades: { acrobatics: 'expert' },
    },
    // Specialized on the SAVAGE path (savage Str+2 & +3 dmg, specialized Dex+1/Int+2 & dmg 3→6). Str is one
    // higher / Dex one lower than the nimble path, and flat unarmed damage is +6 rather than +4.
    'specialized-savage': {
      ranks: { ac: 'trained', saves: 'master', perception: 'master', attack: 'expert', signatureSkills: 'master', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: { str: 3, dex: 3, con: 2, wis: 2, int: 2 }, damageDice: 3, flatDamage: 6,
      skillUpgrades: { athletics: 'expert' },
    },
    // Specialized on each ALTERNATIVE path. Same specialized delta as above (Dex+1/Int+2, attack →
    // expert, saves/Perception/signature → master, 3 damage dice) applied to that path's base, and
    // each keeps its own skill upgrade + note.
    'specialized-indomitable': {
      ranks: { ac: 'trained', saves: 'master', perception: 'master', attack: 'expert', signatureSkills: 'master', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: { str: 2, dex: 3, con: 3, wis: 2, int: 2 }, damageDice: 3, flatDamage: 6,
      skillUpgrades: { athletics: 'expert' },
      note: 'Megafauna: barding proficiency is also expert. The app has no barding-proficiency track, so apply that by hand.',
    },
    'specialized-genie-touched': {
      ranks: { ac: 'trained', saves: 'master', perception: 'master', attack: 'expert', signatureSkills: 'master', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: { str: 2, dex: 3, con: 2, wis: 3, int: 2 }, damageDice: 3, flatDamage: 6,
      skillUpgrades: { acrobatics: 'expert', athletics: 'expert' },
      note: 'Only ONE of Acrobatics / Athletics is actually expert — Acrobatics for djinni/efreeti, Athletics for marid/shaitan. The element isn’t tracked yet, so both are shown; ignore the one that doesn’t apply. Resistance 5 and the elemental trait also apply.',
    },
    'specialized-unseen': {
      ranks: { ac: 'trained', saves: 'master', perception: 'master', attack: 'expert', signatureSkills: 'master', otherSkills: 'trained' },
      speedBonus: 0, abilityBoosts: { str: 2, dex: 3, con: 2, wis: 3, int: 2 }, damageDice: 3, flatDamage: 6,
      skillUpgrades: { stealth: 'expert' },
      note: 'Cryptid: also deals an extra 1d4 precision damage against off-guard targets.',
    },
  },
};

export const MATURITIES: Maturity[] = [
  'young', 'mature',
  'nimble', 'savage', 'indomitable', 'genie-touched', 'unseen',
  'specialized', 'specialized-savage', 'specialized-indomitable', 'specialized-genie-touched', 'specialized-unseen',
];

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
  attacks: { name: string; attack: number; damage: string; traits: string[]; range?: number }[];
  skills: StatMod[];
  /** IWR display lines from companion-modifying feats ("weakness 10 unholy"). */
  iwr?: string[];
  /** Which companion-mod feats shaped this block (short labels, shown as a banner line). */
  modNotes?: string[];
  support: string;
  maneuver: string;
  /** Advanced maneuvers granted by an OWNER FEAT, beside the type's own. */
  extraManeuvers?: string[];
  /** The type's "Special" line (mount, extra poison damage, an added creature trait, …). */
  special?: string;
  /** Carried Bulk vs. capacity (only over-capacity is a problem). */
  bulk: { carried: number; encumberedAt: number; max: number };
  /** Worn/equipped gear contributing to the block (for the "what's applied" note). */
  gearNote?: string;
}

/** Carrying-capacity size multiplier (PF2e doubles per size above Medium, halves below). */
const SIZE_BULK_FACTOR: Record<string, number> = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 4, gargantuan: 8 };
/** A companion's size can be a choice ("Medium or Large") — take the largest listed size, since
 *  that's the one whose carrying capacity a player picking it would expect. */
function sizeFactor(size: string): number {
  const factors = String(size)
    .toLowerCase()
    .split(/\bor\b|[,/]/)
    .map((s) => SIZE_BULK_FACTOR[s.trim()])
    .filter((f): f is number => f != null);
  return factors.length ? Math.max(...factors) : 1;
}

interface CompanionGear {
  acBonus: number;
  dexCap: number | null;
  checkPenalty: number;
  speedPenalty: number;
  /** `range` in FEET when the weapon is a ranged one. The stat block decided melee-vs-ranged by
   *  looking at TRAITS alone, and 195 of the 199 ranged weapons carry no ranged/thrown trait at all
   *  — a shortbow is `range: 60` with traits [deadly-d10] — so a companion wielding one was labelled
   *  Melee. The range is right here on the item; it just was not carried through. */
  strikes: { name: string; die: string; dice: number; damageType: string; traits: string[]; range?: number }[];
  carriedBulk: number;
  /** Flat land-Speed bonus from the companion's invested gear (Alacritous Horseshoes: +5 ft). */
  speedBonus: number;
  notes: string[];
}

/** Resolve a companion's worn/equipped gear into stat effects: barding → AC + Dex cap +
 *  check/Speed penalties; a wielded weapon → an extra Strike; plus carried Bulk. */
function companionGear(cfg: CompanionConfig, content: ContentDatabase, strMod: number): CompanionGear {
  const g: CompanionGear = { acBonus: 0, dexCap: null, checkPenalty: 0, speedPenalty: 0, strikes: [], carriedBulk: 0, speedBonus: 0, notes: [] };
  for (const it of cfg.inventory ?? []) {
    const def = content.items[it.itemId];
    if (!def) continue;
    g.carriedBulk += (def.bulk || 0) * (it.quantity || 1);
    // Invested magic gear can buff the companion (Alacritous Horseshoes: +5 ft land Speed).
    if (it.invested && def.passiveEffects?.speedBonus) {
      g.speedBonus += def.passiveEffects.speedBonus;
      g.notes.push(`${def.name} (+${def.passiveEffects.speedBonus} ft Speed)`);
    }
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
      g.strikes.push({
        name: def.name,
        die: `d${dieSize}`,
        dice: def.damage.dice,
        damageType: def.damage.type,
        traits: def.traits ?? [],
        ...(def.range != null ? { range: def.range } : {}),
      });
    }
  }
  return g;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Derive the full stat block for an animal companion at the handler's level. */
const RANK_ORDER: ProficiencyRank[] = ['untrained', 'trained', 'expert', 'master', 'legendary'];

/** Render a CompanionMod.speeds map as display lines. A number is feet; "land" means "equal to its
 *  land Speed" and "land:N" caps that at N feet ("a swim Speed equal to its Speed, maximum 25"). */
function speedLines(speeds: Record<string, number | string> | undefined, landSpeed: number): string[] {
  const out: string[] = [];
  for (const [kind, v] of Object.entries(speeds ?? {})) {
    if (typeof v === 'number') { out.push(`${kind} ${v} feet`); continue; }
    const [base, cap] = String(v).split(':');
    if (base !== 'land') continue; // unknown formula — never guess a number
    const feet = cap ? Math.min(landSpeed, Number(cap)) : landSpeed;
    out.push(`${kind} ${feet} feet${cap ? ` (equal to its Speed, max ${cap})` : ' (equal to its Speed)'}`);
  }
  return out;
}
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
  /** The OWNER's feat ids — companion-modifying feats (COMPANION_MODS: Celestial Mount, …) key off them. */
  ownerFeatIds?: Set<string>,
): AnimalCompanionBlock {
  // Upgrade feats (Advanced/Incredible/Paragon Companion) raise the maturity FLOOR — in this engine a
  // "paragon companion" is the specialized rung of the same ladder, so the feat can only improve it.
  // All four advancements sit on the same rung (they're alternatives taken from the same feat), and
  // all their specialized forms on the next — so an upgrade feat can raise a companion to specialized
  // without ever switching which PATH the player chose.
  const MATURITY_RANK: Record<Maturity, number> = {
    young: 0,
    mature: 1,
    nimble: 2, savage: 2, indomitable: 2, 'genie-touched': 2, unseen: 2,
    specialized: 3, 'specialized-savage': 3, 'specialized-indomitable': 3, 'specialized-genie-touched': 3, 'specialized-unseen': 3,
  };
  let maturity = (cfg.maturity as Maturity) || 'young';
  if (ownerFeatIds) {
    for (const [slug, mod] of Object.entries(COMPANION_MODS)) {
      if (!ownerFeatIds.has(slug) || !mod.maturityFloor) continue;
      if (MATURITY_RANK[mod.maturityFloor] > MATURITY_RANK[maturity as Maturity]) maturity = mod.maturityFloor;
    }
  }
  const m = COMPANION_FORMULA.maturities[maturity] ?? COMPANION_FORMULA.maturities.young;
  // Maturity boosts the base (young) ability modifiers.
  const ab = { ...type.abilities };
  for (const k of Object.keys(m.abilityBoosts) as AbilityId[]) ab[k] = (ab[k] ?? 0) + (m.abilityBoosts[k] ?? 0);
  // Extra boosts from companion-modifying feats, on top of maturity.
  if (ownerFeatIds) {
    for (const [slug, mod] of Object.entries(COMPANION_MODS)) {
      if (!ownerFeatIds.has(slug) || !mod.abilityBoosts) continue;
      for (const k of Object.keys(mod.abilityBoosts) as AbilityId[]) ab[k] = (ab[k] ?? 0) + (mod.abilityBoosts[k] ?? 0);
    }
  }

  // Specialization applies only once the companion is specialized: extra ability boosts,
  // skill/AC rank overrides, and a Speed bonus (Racer) layered on the generic benefits.
  const spec = maturity === 'specialized' && cfg.specialization ? content.companionSpecializations?.[cfg.specialization] : undefined;
  if (spec?.abilityBoosts) for (const k of Object.keys(spec.abilityBoosts) as AbilityId[]) ab[k] = (ab[k] ?? 0) + (spec.abilityBoosts[k] ?? 0);

  const gear = companionGear(cfg, content, ab.str ?? 0);

  const speeds = { ...type.speeds };
  if (speeds.land) speeds.land += m.speedBonus + (spec?.speedBonus ?? 0) + gear.speedBonus;
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

  const buildAttack = (
    name: string,
    dice: number,
    dieSize: string,
    damageType: string,
    traits: string[],
    flatBonus: number,
    opts: { plus?: string; noStrengthDamage?: boolean; range?: number } = {},
  ) => {
    const finesse = traits.includes('finesse');
    const atkAbility: AbilityId = finesse && (ab.dex ?? 0) > (ab.str ?? 0) ? 'dex' : 'str';
    // A few Strikes explicitly don't add the companion's Strength (the Ghost's ghostly touch).
    const flat =
      (opts.noStrengthDamage ? 0 : ab.str ?? 0) + flatBonus + conditionPenalty(conditions, atkAbility, 'damage') + modeNumberBonus(modes, { kind: 'damage' });
    const dmgFlat = flat > 0 ? `+${flat}` : flat < 0 ? `${flat}` : '';
    return {
      name,
      attack: (ab[atkAbility] ?? 0) + profBonus(m.ranks.attack, level, withoutLevel) + conditionPenalty(conditions, atkAbility, 'attack') + modeNumberBonus(modes, { kind: 'attack' }),
      damage: `${dice}d${dieSize}${dmgFlat} ${damageType}${opts.plus ? ` plus ${opts.plus}` : ''}`,
      traits,
      // Carried so the stat block can say Ranged without having to infer it from traits, which 195 of
      // the 199 ranged weapons do not carry.
      ...(opts.range != null ? { range: opts.range } : {}),
    };
  };
  // Natural attacks scale dice with maturity; a wielded weapon uses its own dice (no maturity flat).
  const natural = type.attacks.map((atk) =>
    buildAttack(atk.name, m.damageDice, (atk.die.match(/d(\d+)/) || [])[1] ?? '6', atk.damageType, atk.traits, m.flatDamage, {
      plus: atk.plus,
      noStrengthDamage: atk.noStrengthDamage,
    }),
  );
  const wielded = gear.strikes.map((w) =>
    // A thrown weapon still adds Strength to damage; a projectile does not.
    buildAttack(w.name, w.dice, w.die.replace(/^d/, ''), w.damageType, w.traits, 0, {
      ...(w.range != null ? { range: w.range } : {}),
      noStrengthDamage: w.range != null && !w.traits.some((t) => t === 'thrown' || t.startsWith('thrown-')),
    }),
  );
  // Strikes an OWNER's feat grants (Billowing Wings' gust). The printed dice stand — the feat says
  // 1d4, not "the companion's maturity die" — so no maturity flat damage rides on them either, and a
  // ranged one adds no Strength to damage.
  const granted = ownerFeatIds
    ? Object.entries(COMPANION_MODS)
        .filter(([slug, mod]) => ownerFeatIds.has(slug) && mod.kinds.includes('animal'))
        .flatMap(([, mod]) => mod.grantedStrikes ?? [])
        .map((s) =>
          buildAttack(s.name, s.dice, s.die.replace(/^d/, ''), s.damageType, s.traits, 0, {
            plus: s.note,
            noStrengthDamage: s.range != null,
          }),
        )
    : [];
  const attacks = [...natural, ...wielded, ...granted];

  const sig = new Set(type.skills);
  const specSkill = new Map((spec?.skills ?? []).map((s) => [s.skill, s.rank] as const));
  // Skills trained on the companion by an owner feat (Chorus Companion → Performance, Fell Rider →
  // Intimidation) via COMPANION_MODS.skillGrants — raises the rank to at least the granted rank.
  const modSkill = new Map<SkillId, ProficiencyRank>();
  if (ownerFeatIds) {
    for (const [slug, mod] of Object.entries(COMPANION_MODS)) {
      if (!ownerFeatIds.has(slug) || !mod.kinds.includes('animal')) continue;
      for (const g of mod.skillGrants ?? []) modSkill.set(g.skill, rankMax(modSkill.get(g.skill) ?? 'untrained', g.rank));
    }
  }
  const extraSpecSkills = (spec?.skills ?? []).map((s) => s.skill).filter((s) => !sig.has(s) && !UNIVERSAL_SKILLS.includes(s));
  // An advancement's named skill must be LISTED, not just ranked — unseen raises Stealth to expert,
  // and a companion whose signature skill isn't Stealth wouldn't otherwise show the row at all.
  const maturitySkills = Object.keys(m.skillUpgrades ?? {}) as SkillId[];
  const skillList = [...new Set<SkillId>([...UNIVERSAL_SKILLS, ...type.skills, ...extraSpecSkills, ...modSkill.keys(), ...maturitySkills])];
  const skills: StatMod[] = skillList.map((sk) => {
    // Only the companion's SIGNATURE skill advances with maturity; the universal Acrobatics/Athletics
    // (and any other non-signature skill) stay trained (otherSkills rank).
    let rank = sig.has(sk) ? m.ranks.signatureSkills : m.ranks.otherSkills;
    // The advancement's own named skill (nimble → Acrobatics, savage → Athletics, unseen → Stealth).
    if (m.skillUpgrades?.[sk]) rank = rankMax(rank, m.skillUpgrades[sk]);
    if (specSkill.has(sk)) rank = rankMax(rank, specSkill.get(sk));
    if (modSkill.has(sk)) rank = rankMax(rank, modSkill.get(sk));
    const ability = SKILL_ABILITY[sk];
    const checkPen = ability === 'str' || ability === 'dex' ? gear.checkPenalty : 0;
    return { name: cap(sk), modifier: (ab[ability] ?? 0) + profBonus(rank, level, withoutLevel) + checkPen + conditionPenalty(conditions, ability, 'skill') + modeNumberBonus(modes, { kind: 'skill', detail: sk }), rank };
  });

  const strMod = ab.str ?? 0;
  const factor = sizeFactor(type.size);
  const bulk = {
    carried: Math.round(gear.carriedBulk * 10) / 10,
    encumberedAt: Math.max(0, Math.floor((5 + strMod) * factor)),
    max: Math.max(1, Math.floor((10 + strMod) * factor)),
  };

  // Companion-MODIFYING feats the owner has (COMPANION_MODS: Celestial/Fiendish Mount, spirit-blessed
  // strikes, …): extra senses, +max HP, fly = land Speed, IWR lines, per-Strike riders.
  const senses = [...type.senses];
  const iwr: string[] = [];
  const modNotes: string[] = [];
  // Advanced maneuvers an OWNER FEAT grants, beside the one the companion type already knows.
  const extraManeuvers: string[] = [];
  let hpBonus = 0;
  if (ownerFeatIds) {
    for (const [slug, mod] of Object.entries(COMPANION_MODS)) {
      if (!ownerFeatIds.has(slug) || !mod.kinds.includes('animal')) continue;
      for (const s of mod.senses ?? []) if (!senses.some((x) => x.toLowerCase() === s.toLowerCase())) senses.push(s);
      if (mod.maxHpBonus) hpBonus += mod.maxHpBonus;
      if (mod.flyEqualsLand && speeds.land) speeds.fly = Math.max(speeds.fly ?? 0, speeds.land);
      // Numeric/relative extra speeds (Burrowing Form: burrow 5; Airborne Form: fly = its Speed).
      for (const [kind, v] of Object.entries(mod.speeds ?? {})) {
        const key = kind as keyof typeof speeds;
        if (typeof v === 'number') { speeds[key] = Math.max(speeds[key] ?? 0, v); continue; }
        const [base, cap] = String(v).split(':');
        if (base !== 'land' || !speeds.land) continue; // unknown formula — never guess a number
        speeds[key] = Math.max(speeds[key] ?? 0, cap ? Math.min(speeds.land, Number(cap)) : speeds.land);
      }
      iwr.push(...(mod.iwr ?? []));
      if (mod.strikeRider) for (const a of attacks) if (!a.traits.includes(mod.strikeRider)) a.traits.push(mod.strikeRider);
      for (const m of mod.maneuvers ?? []) if (!extraManeuvers.includes(m)) extraManeuvers.push(m);
      if (mod.note) modNotes.push(mod.note);
    }
  }

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
    hp: hp + hpBonus,
    saves: { fortitude: save('con'), reflex: save('dex'), will: save('wis') },
    perception: {
      name: 'Perception',
      modifier: (ab.wis ?? 0) + profBonus(m.ranks.perception, level, withoutLevel) + conditionPenalty(conditions, 'wis', 'perception') + modeNumberBonus(modes, { kind: 'perception' }),
      rank: m.ranks.perception,
    },
    speeds,
    senses,
    attacks,
    skills,
    support: type.support,
    maneuver: type.maneuver,
    ...(extraManeuvers.length ? { extraManeuvers } : {}),
    ...(type.special ? { special: type.special } : {}),
    bulk,
    gearNote: gear.notes.join('; ') || undefined,
    ...(iwr.length ? { iwr } : {}),
    ...(modNotes.length ? { modNotes } : {}),
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
  /** `fromFeat` names the owner's feat that granted the ability — those are on TOP of the familiar's
   *  ability budget, so a player must be able to tell them from the ones they spent a slot on. */
  abilities: { id: string; name: string; description: string; kind: string; fromFeat?: string }[];
  /** When this familiar is a specific familiar (Pipefox, Imp, …). */
  specific?: {
    name: string;
    requiredCount: number;
    requiredAbilities: string[];
    specials: { name: string; cost?: ActionCost; desc: string }[];
    traits: string[];
    note?: string;
    source?: SourceInfo;
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
  // Abilities an OWNER's feat grants ("Your familiar gains the Lightning Needles ability"). The
  // ability records already shipped and the roster already rendered them; nothing attached one, so
  // those feats left the familiar's block exactly as it was. They do NOT cost an ability slot.
  const ownerFeats = new Set((character.feats ?? []).map((f) => f.featId));
  const grantedAbilityIds = new Map<string, string>();
  for (const [slug, mod] of Object.entries(COMPANION_MODS)) {
    if (!ownerFeats.has(slug) || !mod.kinds.includes('familiar')) continue;
    for (const id of mod.familiarAbilities ?? []) if (!grantedAbilityIds.has(id)) grantedAbilityIds.set(id, slug);
  }
  const chosen = new Set(cfg.abilities ?? []);
  const abilities = [
    ...(cfg.abilities ?? []).map((id) => ({ id, from: undefined as string | undefined })),
    ...[...grantedAbilityIds].filter(([id]) => !chosen.has(id)).map(([id, from]) => ({ id, from })),
  ]
    .map(({ id, from }) => ({ a: content.familiarAbilities[id], from }))
    .filter((x): x is { a: FamiliarAbility; from: string | undefined } => !!x.a)
    .map(({ a, from }) => ({ id: a.id, name: a.name, description: a.description, kind: a.kind, ...(from ? { fromFeat: from } : {}) }));
  const sf = specificFamiliar(content, cfg.specificFamiliarId);
  // Granted abilities count as HAD: a feat that grants Tough must raise HP, and one that grants
  // Flier must add the fly Speed, exactly as a chosen one does.
  const has = (id: string) => chosen.has(id) || grantedAbilityIds.has(id);
  // The 'Tough' familiar ability raises max HP by 2 per level (base 5/level → 7/level). A specific
  // familiar that requires Tough (e.g. Spellslime) gets it even though its required abilities aren't
  // stored in cfg.abilities.
  const hasTough = has('tough') || (sf?.requiredAbilities ?? []).some((a) => a.toLowerCase() === 'tough');
  // Movement abilities: Fast Movement raises the land Speed 25→40; Flier/Climber/Burrower add types.
  // Aquatic familiars (Elver Pet) gain the aquatic trait, breathe water, and swap land Speed for a
  // swim Speed of the same value.
  const aquatic = cfg.grantSlug === 'elver-pet';
  const baseSpeed = has('fast-movement') ? 40 : 25;
  const land = aquatic ? 0 : baseSpeed;
  const extraSpeeds: string[] = [];
  if (aquatic) extraSpeeds.push(`swim ${baseSpeed} feet (aquatic — breathes water, not air)`);
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
  /** Senses from the eidolon type + evolution feats (Expanded Senses). */
  senses?: string[];
  /** Non-land speeds from evolution feats ("swim 25 feet (amphibious)"). */
  extraSpeeds?: string[];
  /** IWR lines from the type/evolutions ("resistance 5 fire", "immune grabbed…"). */
  iwr?: string[];
  /** Evolution reminders shown under the block. */
  evoNotes?: string[];
  /** The eidolon TYPE's own abilities, filtered to the tiers the summoner's level has reached.
   *  Every type printed these in its description and nothing structured them, so Eidolon Symbiosis
   *  (7th) and Eidolon Transcendence (17th) — whose whole content is "you gain your type's ability" —
   *  arrived empty. */
  typeAbilities?: { tier: string; level: number; name: string; text: string }[];
  /** Cantrip NAMES the eidolon knows and casts as innate spells (Magical Understudy). */
  cantrips?: string[];
  /** Leveled innate spell NAMES from Magical Adept / Magical Master, each once per day. Both feats
   *  shipped marked “Recorded only” and the block had no field for them, so the answers the player
   *  gave in the builder appeared nowhere at all. */
  innateSpells?: { name: string; rank: number }[];
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
  const strikingTier = hwRunes?.striking === 'mythic' ? 4 : hwRunes?.striking === 'major' ? 3 : hwRunes?.striking === 'greater' ? 2 : hwRunes?.striking === 'striking' ? 1 : 0;
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

  // EIDOLON-TYPE senses/immunities (the subclass option's innate package) + EVOLUTION feats the
  // summoner took (Expanded Senses, Amphibious Form, Dual Energy Heart, …). The audit found the
  // eidolon block surfaced none of these.
  const evoSenses: string[] = [];
  const evoIwr: string[] = [];
  const extraSpeeds: string[] = [];
  const evoNotes: string[] = [];
  const TYPE_PACKAGE: Record<string, { senses?: string[]; iwr?: string[]; notes?: string[] }> = {
    'undead-eidolon': { senses: ['darkvision'], notes: ['Negative Essence: void healing (harmed by vitality, healed by void).'] },
    'swarm-eidolon': { senses: ['low-light vision'], iwr: ['immune grabbed, prone, restrained'] },
  };
  const pkg = cfg.typeId ? TYPE_PACKAGE[cfg.typeId] : undefined;
  if (pkg) {
    evoSenses.push(...(pkg.senses ?? []));
    evoIwr.push(...(pkg.iwr ?? []));
    evoNotes.push(...(pkg.notes ?? []));
  }
  const featIdSet = new Set(character.feats.map((f) => f.featId));
  // Eidolon-kind entries in COMPANION_MODS (Vibration Sense, …). Without this pass they'd be inert:
  // the table is otherwise only read by deriveAnimalCompanion.
  for (const [slug, mod] of Object.entries(COMPANION_MODS)) {
    if (!featIdSet.has(slug) || !mod.kinds.includes('eidolon')) continue;
    for (const s of mod.senses ?? []) if (!evoSenses.includes(s)) evoSenses.push(s);
    evoIwr.push(...(mod.iwr ?? []));
    for (const line of speedLines(mod.speeds, 25)) if (!extraSpeeds.includes(line)) extraSpeeds.push(line);
    if (mod.note) evoNotes.push(mod.note);
  }
  if (featIdSet.has('expanded-senses')) {
    for (const s of ['low-light vision', 'darkvision', 'scent (imprecise 30 ft)']) if (!evoSenses.includes(s)) evoSenses.push(s);
  }
  if (featIdSet.has('amphibious-form')) {
    // Swim Speed equal to its land Speed, max 25 ft (or the inverse for an aquatic eidolon).
    extraSpeeds.push('swim 25 feet (amphibious)');
  }
  if (featIdSet.has('dual-energy-heart')) {
    const chosen = character.feats.find((f) => f.featId === 'dual-energy-heart')?.choice?.value;
    evoIwr.push(`resistance ${Math.max(1, Math.floor(level / 2))} ${chosen ?? 'chosen energy type'}`);
    evoNotes.push('Dual Energy Heart: its energy Strike gains versatile (chosen type).');
  }

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
    ...(evoSenses.length ? { senses: evoSenses } : {}),
    ...(extraSpeeds.length ? { extraSpeeds } : {}),
    ...(evoIwr.length ? { iwr: evoIwr } : {}),
    ...(evoNotes.length ? { evoNotes } : {}),
    // Only the tiers the summoner has reached. Eidolon Symbiosis is a 7th-level class feature and
    // Transcendence a 17th — listing all three from 1st would show a 1st-level summoner two
    // abilities their eidolon does not have.
    ...(() => {
      const owned = (opt?.eidolonAbilities ?? []).filter((a) => character.level >= a.level);
      return owned.length ? { typeAbilities: owned } : {};
    })(),
    // Magical Understudy: "It gains the Cast a Spell activity and learns two cantrips of its
    // tradition, which it can cast as innate spells." Only the chosen ones are listed — an unfilled
    // slot is a prompt in the editor, not a line on the stat block.
    ...(() => {
      const known = (cfg.eidolon?.cantrips ?? []).filter((id): id is string => !!id && !!content.spells[id]);
      return known.length ? { cantrips: known.map((id) => content.spells[id].name) } : {};
    })(),
    // Magical Adept ("one 1st-rank and one 2nd-rank spell, each once per day") and Magical Master.
    // The summoner picks these in the builder; nothing displayed them, on the eidolon or anywhere.
    ...(() => {
      const known = (character.eidolonInnateSpells ?? []).filter((id) => content.spells[id]);
      return known.length
        ? { innateSpells: known.map((id) => ({ name: content.spells[id].name, rank: content.spells[id].rank ?? 1 })).sort((a, b) => a.rank - b.rank) }
        : {};
    })(),
  };
}

/**
 * How many cantrips the summoner's feats give the EIDOLON (Magical Understudy: two).
 *
 * Summed rather than maxed: two feats each granting cantrips grant that many between them. This has
 * to be its own lane because the eidolon has no spellcasting entry — putting the cantrips in the
 * feat's own `innateSpells` would have handed them to the summoner.
 */
export function eidolonCantripSlots(character: Character, content: ContentDatabase): number {
  return (character.feats ?? []).reduce((n, f) => n + (content.feats[f.featId]?.eidolonCantrips ?? 0), 0);
}
