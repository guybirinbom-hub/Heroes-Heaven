/*
 * The calc layer.
 *
 * Pure functions that turn a Character + ContentDatabase into the derived
 * numbers the sheet displays. Nothing here is stored on the character — these
 * are computed on demand, so they can never go stale.
 *
 * PF2e math reminder: a proficiency bonus is 0 when untrained (you do NOT add
 * your level), otherwise rank value (T2/E4/M6/L8) + level.
 */
import type {
  AbilityId,
  ArmorCategory,
  ArmorItem,
  ArmorRunes,
  Character,
  ContentDatabase,
  DefenseGrants,
  InventoryItem,
  Item,
  SenseEntry,
  ProficiencyKey,
  ProficiencyRank,
  SaveId,
  SkillId,
  Speeds,
  SpellcastingEntry,
  StanceDef,
  WeaponRunes,
} from './types';
import { PROFICIENCY_RANKS } from './types';
import { conditionPenalty, drainedHpLoss } from './conditions';
import { modeNumberBonus } from './modes';
import { abpOn, abpAttack, abpDefense, abpSave, abpPerception, abpStrikingDice, abpSkillBonus } from './abp';
import {
  mpRefinedLevel,
  mpWeaponRefine,
  mpArmorRefine,
  mpShieldRefine,
  mpSenseSkillRefine,
  mpImbuedDamageTerms,
  mpDefenseGrants,
  type MpDamage,
} from './monsterParts';

/** True when the Monster Parts variant rule is on AND this item has been switched to Monster-Parts
 *  mode (carries a `monsterPart` blob). Such an item ignores its runes/precious material entirely. */
export function mpActive(c: { variantRules?: { monsterParts?: boolean } }, inv: InventoryItem): boolean {
  return !!c.variantRules?.monsterParts && !!inv.monsterPart;
}

export const RANK_VALUE: Record<ProficiencyRank, number> = {
  untrained: 0,
  trained: 2,
  expert: 4,
  master: 6,
  legendary: 8,
};

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Proficiency bonus = rank value + level. Under the "Proficiency Without Level" variant (withoutLevel),
 * the character's level is dropped and untrained becomes a −2 penalty instead of 0
 * (untrained −2 / trained +2 / expert +4 / master +6 / legendary +8).
 */
export function profBonus(rank: ProficiencyRank, level: number, withoutLevel = false): number {
  if (withoutLevel) return rank === 'untrained' ? -2 : RANK_VALUE[rank];
  return rank === 'untrained' ? 0 : RANK_VALUE[rank] + level;
}
/** Whether the character opted into Proficiency Without Level. */
export function pwl(c: { variantRules?: { proficiencyWithoutLevel?: boolean } }): boolean {
  return !!c.variantRules?.proficiencyWithoutLevel;
}

/** Format a modifier with an explicit sign, e.g. 3 -> "+3", -1 -> "-1". */
export function formatMod(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

const SKILL_ABILITY: Record<SkillId, AbilityId> = {
  acrobatics: 'dex',
  arcana: 'int',
  athletics: 'str',
  crafting: 'int',
  deception: 'cha',
  diplomacy: 'cha',
  intimidation: 'cha',
  medicine: 'wis',
  nature: 'wis',
  occultism: 'int',
  performance: 'cha',
  religion: 'wis',
  society: 'int',
  stealth: 'dex',
  survival: 'wis',
  thievery: 'dex',
};

const SAVE_ABILITY: Record<SaveId, AbilityId> = {
  fortitude: 'con',
  reflex: 'dex',
  will: 'wis',
};

function skillAbility(key: ProficiencyKey): AbilityId {
  return key.startsWith('lore:') ? 'int' : SKILL_ABILITY[key as SkillId];
}

/** The Strength- and Dexterity-based skills (Acrobatics, Athletics, Stealth,
 *  Thievery) — the ones that take an armor check penalty. */
export function skillTakesArmorPenalty(key: ProficiencyKey): boolean {
  const a = skillAbility(key);
  return a === 'str' || a === 'dex';
}

/** Return whichever rank is higher. */
function betterRank(a: ProficiencyRank, b?: ProficiencyRank): ProficiencyRank {
  if (!b) return a;
  return PROFICIENCY_RANKS.indexOf(b) > PROFICIENCY_RANKS.indexOf(a) ? b : a;
}

export interface StatLine {
  rank: ProficiencyRank;
  modifier: number;
}

export function abilityModifiers(c: Character): Record<AbilityId, number> {
  return {
    str: abilityMod(c.abilities.str),
    dex: abilityMod(c.abilities.dex),
    con: abilityMod(c.abilities.con),
    int: abilityMod(c.abilities.int),
    wis: abilityMod(c.abilities.wis),
    cha: abilityMod(c.abilities.cha),
  };
}

const RESILIENT_BONUS: Record<string, number> = { resilient: 1, greater: 2, major: 3 };

/** Item bonus to saves from a worn armor's resilient rune, or a Monster-Parts refined armor's
 *  resilient-equivalent bonus (Table 4B) when the armor is in Monster-Parts mode (it ignores runes). */
export function resilientSaveBonus(c: Character, db: ContentDatabase): number {
  const worn = c.inventory.find((i) => i.worn && db.items[i.itemId]?.itemType === 'armor');
  if (!worn) return 0;
  if (mpActive(c, worn)) return mpArmorRefine(worn.monsterPart, c.level).saves;
  const r = (worn.runes as ArmorRunes | undefined)?.resilient;
  return r ? RESILIENT_BONUS[r] ?? 0 : 0;
}

export function deriveSave(c: Character, save: SaveId, db?: ContentDatabase): StatLine {
  const rank = c.proficiencies.saves[save];
  const ability = SAVE_ABILITY[save];
  const modifier =
    abilityMod(c.abilities[ability]) +
    profBonus(rank, c.level, pwl(c)) +
    // ABP save potency replaces the resilient rune's item bonus; otherwise use the worn rune.
    (abpOn(c) ? abpSave(c.level) : db ? resilientSaveBonus(c, db) : 0) +
    conditionPenalty(c.conditions, ability, 'save') +
    modeNumberBonus(c.activeModes, { kind: 'save', detail: save });
  return { rank, modifier };
}

/** The best item bonus from a Monster-Parts refined Perception item (kind 'perception', Table 4D) or
 *  skill item (kind 'skill', Table 4E) that is invested/worn/equipped. For a skill item, `skillKey`
 *  must match the item's chosen skill. An item bonus — the caller takes the higher of it and ABP. */
export function mpSenseSkillItemBonus(c: Character, kind: 'perception' | 'skill', skillKey?: ProficiencyKey): number {
  let best = 0;
  for (const inv of c.inventory) {
    const mp = inv.monsterPart;
    if (!mp || mp.kind !== kind || !mpActive(c, inv)) continue;
    if (!(inv.worn || inv.invested || inv.equipped)) continue;
    if (kind === 'skill' && mp.skillKey !== skillKey) continue;
    best = Math.max(best, mpSenseSkillRefine(mp, c.level));
  }
  return best;
}

export function derivePerception(c: Character): StatLine {
  const rank = c.proficiencies.perception;
  const modifier =
    abilityMod(c.abilities.wis) +
    profBonus(rank, c.level, pwl(c)) +
    // Item bonus: the higher of ABP perception and a Monster-Parts refined Perception item (both are
    // item bonuses to Perception, which don't stack).
    Math.max(abpOn(c) ? abpPerception(c.level) : 0, mpSenseSkillItemBonus(c, 'perception')) +
    conditionPenalty(c.conditions, 'wis', 'perception') +
    modeNumberBonus(c.activeModes, { kind: 'perception' });
  return { rank, modifier };
}

export function deriveSkill(c: Character, key: ProficiencyKey, db?: ContentDatabase): StatLine {
  const rank = c.proficiencies.skills[key] ?? 'untrained';
  const ability = skillAbility(key);
  let modifier =
    abilityMod(c.abilities[ability]) +
    profBonus(rank, c.level, pwl(c)) +
    // Item bonus: the higher of an ABP skill item and a Monster-Parts refined skill item keyed to this
    // skill (Table 4E). Both are item bonuses to the skill, which don't stack.
    Math.max(abpSkillBonus(c, key), mpSenseSkillItemBonus(c, 'skill', key)) +
    conditionPenalty(c.conditions, ability, 'skill') +
    modeNumberBonus(c.activeModes, { kind: 'skill', detail: key });
  // The worn armor's check penalty hits Strength- and Dexterity-based skills.
  if (db && (ability === 'str' || ability === 'dex')) {
    modifier += deriveArmorCheckPenalty(c, db).value;
  }
  return { rank, modifier };
}

export function deriveClassDc(c: Character): StatLine & { dc: number } {
  const rank = c.proficiencies.classDc;
  const key = c.keyAbility ?? 'str';
  const modifier =
    abilityMod(c.abilities[key]) +
    profBonus(rank, c.level, pwl(c)) +
    conditionPenalty(c.conditions, key, 'class-dc') +
    modeNumberBonus(c.activeModes, { kind: 'class-dc' });
  return { rank, modifier, dc: 10 + modifier };
}

export interface SpellStats {
  rank: ProficiencyRank;
  attack: number;
  dc: number;
}

export function deriveSpellcasting(c: Character, entry: SpellcastingEntry): SpellStats {
  const base = abilityMod(c.abilities[entry.keyAbility]) + profBonus(entry.proficiency, c.level, pwl(c));
  const attack = base + conditionPenalty(c.conditions, entry.keyAbility, 'spell-attack') + modeNumberBonus(c.activeModes, { kind: 'spell-attack' });
  const dc = 10 + base + conditionPenalty(c.conditions, entry.keyAbility, 'spell-dc') + modeNumberBonus(c.activeModes, { kind: 'spell-dc' });
  return { rank: entry.proficiency, attack, dc };
}

/** Total max-HP bonus from the character's selected feats (Toughness = +level, etc.). */
export function featHpBonus(c: Character, db: ContentDatabase): number {
  let total = 0;
  for (const f of c.feats) {
    const b = db.feats[f.featId]?.maxHpBonus;
    if (b) total += (b.perLevel ?? 0) * c.level + (b.flat ?? 0);
  }
  return total;
}

export function deriveMaxHp(c: Character, db: ContentDatabase): number {
  if (c.hitPoints.maxOverride != null) return Math.max(0, c.hitPoints.maxOverride - drainedHpLoss(c));
  const ancestry = c.ancestryId ? db.ancestries[c.ancestryId] : undefined;
  const cls = c.classId ? db.classes[c.classId] : undefined;
  // Dual Class: Hit Points use the higher per-level value of the two classes.
  const cls2 = c.variantRules?.dualClass && c.classId2 ? db.classes[c.classId2] : undefined;
  const base = ancestry?.hp ?? 0;
  const perLevel = Math.max(cls?.hpPerLevel ?? 0, cls2?.hpPerLevel ?? 0) + abilityMod(c.abilities.con);
  return Math.max(0, base + perLevel * c.level + featHpBonus(c, db) - drainedHpLoss(c));
}

/** The worn armor item and its inventory entry, if any. */
function findWornArmor(c: Character, db: ContentDatabase): { inv: InventoryItem; armor: ArmorItem } | null {
  for (const inv of c.inventory) {
    const item = db.items[inv.itemId];
    if (inv.worn && item?.itemType === 'armor') return { inv, armor: item };
  }
  return null;
}

/** PF2e (remaster) stores an armor's Strength entry as a *modifier* (e.g. full plate
 *  is +4, i.e. Str 18). The wearer meets it when their Strength modifier is at least
 *  that value; armor with no entry is always met. Meeting it removes the check penalty
 *  and reduces the speed penalty by 5 feet. */
function meetsArmorStrength(c: Character, armor: ArmorItem): boolean {
  return armor.strength == null || abilityMod(c.abilities.str) >= armor.strength;
}

export interface ArmorCheckPenalty {
  /** A non-positive number applied to Strength-/Dexterity-based skill checks. */
  value: number;
  /** Name of the armor imposing it, or null when none applies. */
  source: string | null;
}

/** The armor check penalty currently in effect: the worn armor's check penalty
 *  unless the wearer meets its Strength threshold (then 0). */
export function deriveArmorCheckPenalty(c: Character, db: ContentDatabase): ArmorCheckPenalty {
  const worn = findWornArmor(c, db);
  if (!worn || !worn.armor.checkPenalty || meetsArmorStrength(c, worn.armor)) {
    return { value: 0, source: null };
  }
  return { value: -Math.abs(worn.armor.checkPenalty), source: worn.armor.name };
}

export interface AcResult {
  value: number;
  rank: ProficiencyRank;
  dexCap: number | null;
}

/** The mechanical def of the character's currently-active stance, if any (exclusive — one at a time). */
export function activeStanceDef(c: Character, db: ContentDatabase): StanceDef | undefined {
  return c.activeStance ? db.stances?.[c.activeStance] : undefined;
}

export function deriveAc(c: Character, db: ContentDatabase): AcResult {
  const worn = findWornArmor(c, db);

  let category: ArmorCategory = 'unarmored';
  let dexCap: number | null = null;
  let itemBonus = 0;

  if (worn) {
    category = worn.armor.category;
    dexCap = worn.armor.dexCap ?? null;
    // ABP defense potency replaces the armor potency rune's numeric bonus. A Monster-Parts refined
    // armor (Table 4B) supplies an AC item bonus in place of the potency rune (which it ignores).
    const refAc = mpActive(c, worn.inv) ? mpArmorRefine(worn.inv.monsterPart, c.level).ac : 0;
    const potency = abpOn(c) ? 0 : Math.max((worn.inv.runes as ArmorRunes | undefined)?.potency ?? 0, refAc);
    // Guard against a data-incomplete armor (missing acBonus) corrupting AC into NaN.
    itemBonus = (worn.armor.acBonus ?? 0) + potency;
  }
  // ABP defense potency is an automatic AC bonus regardless of worn armor.
  if (abpOn(c)) itemBonus += abpDefense(c.level);

  // A character can wear an item whose category isn't one of the four PC defense tracks (e.g. animal
  // "light-barding"/"heavy-barding"); fall back to the unarmored rank so AC never computes to NaN.
  const rank = c.proficiencies.defenses[category] ?? c.proficiencies.defenses.unarmored;
  const dex = abilityMod(c.abilities.dex);
  // An active stance may add an AC bonus (e.g. Mountain +4) and/or cap Dex-to-AC (Mountain +0); take the
  // lower of the armor cap and the stance cap.
  const stance = activeStanceDef(c, db);
  const stanceDexCap = stance?.dexCap;
  const effDexCap = stanceDexCap != null ? (dexCap != null ? Math.min(dexCap, stanceDexCap) : stanceDexCap) : dexCap;
  const dexContribution = effDexCap != null ? Math.min(dex, effDexCap) : dex;
  const penalty = conditionPenalty(c.conditions, 'dex', 'ac');
  const modeBonus = modeNumberBonus(shieldSwappedModes(c, db), { kind: 'ac' });
  const stanceAc = stance?.acBonus?.value ?? 0;
  return { value: 10 + dexContribution + profBonus(rank, c.level, pwl(c)) + itemBonus + penalty + modeBonus + stanceAc, rank, dexCap: effDexCap };
}

/** The active modes with Raise a Shield's placeholder AC value swapped for the HELD shield's real
 *  circumstance bonus (buckler +1, most +2, fortress +3). Shared by deriveAc and its stat breakdown so
 *  the listed "Raise a Shield" line and the AC total can never disagree. */
export function shieldSwappedModes(c: Character, db: ContentDatabase) {
  const shield = deriveShield(c, db);
  const shieldAc = shield && !shield.broken ? shield.ac : 0;
  return (c.activeModes ?? []).map((mode) =>
    mode.id === 'cat-raise-shield' ? { ...mode, modifiers: mode.modifiers.map((mod) => ({ ...mod, value: shieldAc })) } : mode,
  );
}

export interface ShieldInfo {
  name: string;
  ac: number;
  hardness: number;
  hp: number;
  brokenThreshold: number;
  /** Current shield HP after in-play damage (= hp − shieldDamage, clamped). */
  current: number;
  /** Shield HP at or below its Broken Threshold (can't be used until repaired). */
  broken: boolean;
}

/** The held shield's stats, if one is wielded. Does not affect AC. Current HP reflects
 *  in-play shield damage (Character.shieldDamage, overlaid from play state). */
export function deriveShield(c: Character, db: ContentDatabase): ShieldInfo | null {
  const held = c.inventory
    .map((inv) => ({ inv, item: db.items[inv.itemId] }))
    .find((x) => (x.inv.equipped || x.inv.worn) && x.item?.itemType === 'shield');
  if (!held || held.item?.itemType !== 'shield') return null;
  const s = held.item;
  // A reinforcing rune (or a Monster-Parts refined shield, Table 4C) raises the shield's
  // Hardness/HP/Broken Threshold. A refined shield ignores runes and uses its refinement stats instead.
  const rein = mpActive(c, held.inv) ? undefined : (held.inv.runes as ArmorRunes | undefined)?.reinforcing;
  const r = rein ? REINFORCING[rein] : undefined;
  const ref = mpActive(c, held.inv) ? mpShieldRefine(held.inv.monsterPart, c.level) : null;
  // Guard every shield stat against a data-incomplete item (missing hardness/hp/BT/acBonus) so the
  // shield block — and the AC breakdown that reads it — can never compute NaN.
  const hardness = Math.max(s.hardness ?? 0, r?.hardness ?? 0, ref?.hardness ?? 0);
  const hp = Math.max(s.hp ?? 0, r?.hp ?? 0, ref?.hp ?? 0);
  const brokenThreshold = Math.max(s.brokenThreshold ?? 0, r?.bt ?? 0, ref?.bt ?? 0);
  const current = Math.max(0, hp - Math.max(0, c.shieldDamage ?? 0));
  return { name: s.name, ac: s.acBonus ?? 0, hardness, hp, brokenThreshold, current, broken: current <= brokenThreshold };
}

/** Reinforcing-rune tiers → the shield Hardness/HP/Broken-Threshold maximum each sets. */
const REINFORCING: Record<number, { hardness: number; hp: number; bt: number }> = {
  1: { hardness: 8, hp: 64, bt: 32 }, // minor
  2: { hardness: 10, hp: 80, bt: 40 }, // lesser
  3: { hardness: 13, hp: 104, bt: 52 }, // moderate
  4: { hardness: 15, hp: 120, bt: 60 }, // greater
  5: { hardness: 17, hp: 136, bt: 68 }, // major
  6: { hardness: 20, hp: 160, bt: 80 }, // supreme
};

export interface CharacterDefenses {
  /** Senses (raw selectors, e.g. "darkvision", "scent"), including ancestry vision. */
  senses: SenseEntry[];
  resistances: { type: string; value: number }[];
  weaknesses: { type: string; value: number }[];
  immunities: string[];
}

const ACUITY_ORDER: Record<string, number> = { precise: 3, imprecise: 2, vague: 1 };

/** Resolve a Resistance/Weakness value that may be a level-formula string. CSP-safe
 *  (no eval): handles plain numbers, "@actor.level", and the floor/ceil/max/min level
 *  forms used in the data; unrecognized formulas resolve to 0 (so we never show a wrong
 *  number). */
export function resolveIwrValue(value: number | string, level: number): number {
  if (typeof value === 'number') return Math.max(0, Math.round(value));
  const v = value.trim();
  if (v === '@actor.level') return level;
  const m = v.match(/^(?:(max|min)\((\d+),\s*)?(floor|ceil)\(@actor\.level\s*\/\s*(\d+)\)\)?$/);
  if (m) {
    const inner = m[3] === 'ceil' ? Math.ceil(level / Number(m[4])) : Math.floor(level / Number(m[4]));
    if (m[1] === 'max') return Math.max(Number(m[2]), inner);
    if (m[1] === 'min') return Math.min(Number(m[2]), inner);
    return Math.max(0, inner);
  }
  const n = Number(v);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

/** Aggregate the character's innate senses + IWR from ancestry vision, heritage,
 *  selected feats, and auto-granted class features (by level). Resistances/weaknesses
 *  of the same type don't stack — the highest value wins. Conditional (predicated) and
 *  choice-based grants aren't parsed at import, so they don't appear here. */
export function deriveDefenses(c: Character, db: ContentDatabase): CharacterDefenses {
  const sources: DefenseGrants[] = [];
  if (c.heritageId && db.heritages[c.heritageId]) sources.push(db.heritages[c.heritageId]);
  for (const f of c.feats) {
    const feat = db.feats[f.featId];
    if (feat) sources.push(feat);
  }
  const cls = c.classId ? db.classes[c.classId] : undefined;
  if (cls) {
    for (const cf of cls.features) {
      if (cf.level <= c.level && db.classFeatures[cf.featureId]) sources.push(db.classFeatures[cf.featureId]);
    }
  }

  const senses = new Map<string, SenseEntry>();
  const rank = (a?: string) => ACUITY_ORDER[a ?? 'precise'] ?? 3;
  const rng = (r?: number) => r ?? Infinity;
  const addSense = (s: SenseEntry) => {
    const prev = senses.get(s.name);
    if (!prev || rank(s.acuity) > rank(prev.acuity) || (rank(s.acuity) === rank(prev.acuity) && rng(s.range) > rng(prev.range))) {
      senses.set(s.name, s);
    }
  };
  // Ancestry vision is the baseline sense (e.g. 'darkvision', 'low-light-vision', 'normal').
  addSense({ name: (c.ancestryId && db.ancestries[c.ancestryId]?.vision) || 'normal' });

  const res = new Map<string, number>();
  const weak = new Map<string, number>();
  const imm = new Set<string>();
  for (const src of sources) {
    for (const s of src.senses ?? []) addSense(s);
    for (const r of src.resistances ?? []) {
      const v = resolveIwrValue(r.value, c.level);
      if (v > 0) res.set(r.type, Math.max(res.get(r.type) ?? 0, v));
    }
    for (const w of src.weaknesses ?? []) {
      const v = resolveIwrValue(w.value, c.level);
      if (v > 0) weak.set(w.type, Math.max(weak.get(w.type) ?? 0, v));
    }
    for (const t of src.immunities ?? []) imm.add(t);
  }

  // Monster Parts: worn/invested/wielded items grant resistances (Energy Resistant, value = the
  // property's level) and passive senses (Sensory). Same-type resistances don't stack — highest wins.
  for (const inv of c.inventory) {
    if (!mpActive(c, inv) || !(inv.worn || inv.invested || inv.equipped)) continue;
    const grants = mpDefenseGrants(inv.monsterPart, c.level);
    for (const g of grants.resistances) res.set(g.type, Math.max(res.get(g.type) ?? 0, g.value));
    for (const sense of grants.senses) addSense({ name: sense });
  }

  const sortByType = (a: { type: string }, b: { type: string }) => a.type.localeCompare(b.type);
  return {
    senses: [...senses.values()],
    resistances: [...res].map(([type, value]) => ({ type, value })).sort(sortByType),
    weaknesses: [...weak].map(([type, value]) => ({ type, value })).sort(sortByType),
    immunities: [...imm].sort(),
  };
}

const DAMAGE_ABBR: Record<string, string> = {
  bludgeoning: 'B',
  piercing: 'P',
  slashing: 'S',
};

const STRIKING_DICE = { striking: 1, greater: 2, major: 3 } as const;

/** Render one Monster-Parts imbued-damage term as a strike-damage fragment, e.g. "1d6 fire",
 *  "1 persistent fire", "2 acid". Physical types are abbreviated to match rune damage (B/P/S). */
function formatMpDamageTerm(t: MpDamage): string {
  const body = t.dice && t.die ? `${t.dice}${t.die}` : `${t.flat ?? 0}`;
  const type = DAMAGE_ABBR[t.type] ?? t.type;
  return `${body}${t.persistent ? ' persistent' : ''} ${type}`;
}

/** Weapon damage-die progression, smallest → largest. Used to step a die up one size. */
const DIE_LADDER = ['d4', 'd6', 'd8', 'd10', 'd12'] as const;

/** Step a damage die up one size (d4→d6→d8→d10→d12, capped at d12). Unknown dice are returned as-is. */
function stepDie(die: string): string {
  const i = DIE_LADDER.indexOf(die as (typeof DIE_LADDER)[number]);
  if (i < 0) return die;
  return DIE_LADDER[Math.min(i + 1, DIE_LADDER.length - 1)];
}

/** Deadly Simplicity (Player Core): while wielding your deity's favored weapon, increase its damage
 *  die by one step. If the favored weapon is an UNARMED attack with a die smaller than d6, instead
 *  raise the die to d6 (not a full step past d6). Returns the adjusted die given the current die,
 *  whether the strike is with the deity's favored weapon, and whether that weapon is unarmed. */
function deadlySimplicityDie(die: string, isFavored: boolean, isUnarmed: boolean): string {
  if (!isFavored) return die;
  if (isUnarmed) {
    // Only bump sub-d6 unarmed dice, and only up to d6 (a d6+ unarmed favored weapon is unchanged).
    const i = DIE_LADDER.indexOf(die as (typeof DIE_LADDER)[number]);
    const d6i = DIE_LADDER.indexOf('d6');
    return i >= 0 && i < d6i ? 'd6' : die;
  }
  return stepDie(die);
}

/** True if the character has taken the Deadly Simplicity feat. */
function hasDeadlySimplicity(c: Character): boolean {
  return c.feats.some((f) => f.featId === 'deadly-simplicity');
}

/** The set of the character's deity's favored weapon item ids that are SIMPLE weapons (real items),
 *  which is what Deadly Simplicity's die-step applies to for wielded weapons. */
function deitySimpleFavoredWeaponIds(c: Character, db: ContentDatabase): Set<string> {
  const deity = c.details.deityId ? db.deities[c.details.deityId] : undefined;
  const out = new Set<string>();
  for (const w of deity?.favoredWeapons ?? []) {
    const item = db.items[w];
    if (item && item.itemType === 'weapon' && item.category === 'simple') out.add(w);
  }
  return out;
}

/** True if the character's deity's favored weapon is an UNARMED attack (e.g. Irori's fist — a favored
 *  "weapon" id that isn't a real weapon item). Deadly Simplicity then applies to the Fist Strike. */
function deityFavorsUnarmed(c: Character, db: ContentDatabase): boolean {
  const deity = c.details.deityId ? db.deities[c.details.deityId] : undefined;
  return (deity?.favoredWeapons ?? []).some((w) => !db.items[w]);
}

export interface Strike {
  instanceId: string;
  name: string;
  /** Attack bonus across the three multiple-attack-penalty tiers. */
  attack: number[];
  damage: string;
  traits: string[];
  ranged: boolean;
  /** Range increment in feet (ranged weapons). */
  range?: number;
  /** Reload actions (ranged weapons; 0 = no reload needed). */
  reload?: number;
  /** Weapon group (sword, bow, …) — drives critical specialization. */
  group?: string;
  /** Weapon base/item id (e.g. 'battle-axe') — for crit-spec grants that narrow by base. */
  base?: string;
  /** Bonus damage from Weapon Specialization (already folded into `damage`). */
  specDamage?: number;
  // --- breakdown primitives (so the strike-detail popup can explain attack & damage; populated by
  //     every strike source, see explain.ts strikeAttack/strikeDamage) ---
  /** Attack proficiency rank used. */
  rank: ProficiencyRank;
  /** Ability governing the attack roll. */
  atkAbility: AbilityId;
  /** Ability adding to damage (null for non-propulsive projectiles and blasts). */
  dmgAbility: AbilityId | null;
  /** The ACTUAL numeric ability contribution to damage (half Str for propulsive, so not re-derivable). */
  dmgAbMod: number;
  /** Item/ABP attack potency folded into `attack`. */
  potencyBonus: number;
  /** True when this weapon's attack/striking bonus comes from a Monster-Parts refinement (so the
   *  breakdown labels it "Monster Parts refinement" rather than a potency rune). */
  mpRefined?: boolean;
  /** Flat numeric damage bonus folded into `damage` (excludes dice and rune riders). */
  dmgBonus: number;
  /** Extra damage dice beyond the base die, from striking/ABP. */
  strikingDice: number;
  /** Multiple-attack-penalty step (4 agile, 5 otherwise). */
  mapStep: number;
  /** Conditional extra-damage riders that apply only in a specific circumstance (Sneak Attack when
   *  off-guard, Ranger Precision on the first hit vs hunted prey). Rendered as an annotation on the
   *  strike row and in the damage breakdown — NOT folded into the flat `dmgBonus`/`damage` dice. */
  conditionalDamage?: { text: string; note: string }[];
}

/** Handwraps of Mighty Blows (and kin): worn-gloves UNARMED "weapons" whose runes buff every
 *  unarmed attack rather than being a weapon of their own. The category==='unarmed' guard is
 *  load-bearing — it excludes simple-category worngloves (wheelchair blades/spikes), which DO
 *  remain real Strikes. */
export function isHandwraps(item: Item | undefined): boolean {
  return !!item && item.itemType === 'weapon' && item.category === 'unarmed' && item.usage === 'worngloves';
}

/** The runes from the best worn/invested/equipped handwraps to apply to unarmed strikes. Runes do
 *  NOT stack across two pairs, so among multiple pairs pick one deterministically: highest potency,
 *  then highest striking tier, then most property runes. */
export function bestHandwrapsRunes(c: Character, db: ContentDatabase): WeaponRunes | undefined {
  const tier = (s?: WeaponRunes['striking']) => (s === 'major' ? 3 : s === 'greater' ? 2 : s === 'striking' ? 1 : 0);
  const candidates = c.inventory
    // A Monster-Parts-mode handwraps ignores its runes (either/or), so it never contributes rune buffs.
    .filter((inv) => (inv.equipped || inv.worn || inv.invested) && isHandwraps(db.items[inv.itemId]) && !mpActive(c, inv))
    .map((inv) => inv.runes as WeaponRunes | undefined)
    .filter((r): r is WeaponRunes => !!r);
  if (!candidates.length) return undefined;
  return candidates.sort(
    (a, b) =>
      (b.potency ?? 0) - (a.potency ?? 0) ||
      tier(b.striking) - tier(a.striking) ||
      (b.property?.length ?? 0) - (a.property?.length ?? 0),
  )[0];
}

/** The best Monster-Parts-mode handwraps of mighty blows (equipped/worn/invested), whose refinement +
 *  imbuements buff EVERY unarmed Strike (Table 4A applies to handwraps). Highest refined level wins. */
export function bestMpHandwraps(c: Character, db: ContentDatabase): InventoryItem['monsterPart'] | undefined {
  const candidates = c.inventory.filter(
    (inv) => (inv.equipped || inv.worn || inv.invested) && isHandwraps(db.items[inv.itemId]) && mpActive(c, inv),
  );
  if (!candidates.length) return undefined;
  return candidates
    .slice()
    .sort((a, b) => mpRefinedLevel(b.monsterPart, c.level) - mpRefinedLevel(a.monsterPart, c.level))[0].monsterPart;
}

/** Whether the character's class grants (Greater) Weapon Specialization by their level,
 *  detected from the class's auto-granted features. */
export function weaponSpecialization(c: Character, db: ContentDatabase): { spec: boolean; greater: boolean } {
  const cls = c.classId ? db.classes[c.classId] : undefined;
  if (!cls) return { spec: false, greater: false };
  const owned = cls.features.filter((f) => f.level <= c.level).map((f) => f.featureId);
  const greater = owned.some((id) => id.startsWith('greater-weapon-specialization'));
  // 'eidolon-weapon-specialization' (summoner) is the pet's, not the character's — excluded by exact match.
  const spec = greater || owned.some((id) => id === 'weapon-specialization' || id === 'psychic-weapon-specialization');
  return { spec, greater };
}

/** The class-feature ids the character owns at their current level (auto-granted class features only —
 *  not feats or subclass options). Lets strike math key off level-1 features like Powerful Fist,
 *  Sneak Attack, or Hunt Prey by exact id. */
export function ownedFeatureIds(c: Character, db: ContentDatabase): Set<string> {
  const cls = c.classId ? db.classes[c.classId] : undefined;
  const out = new Set<string>();
  if (cls) for (const f of cls.features) if (f.level <= c.level) out.add(f.featureId);
  return out;
}

/** Conditional precision-damage riders that apply to a qualifying Strike only in a specific
 *  circumstance. Two Remaster sources:
 *   • Rogue Sneak Attack — 1d6 (→2/3/4d6 at L5/11/17) precision when the target is off-guard, with an
 *     agile/finesse melee/unarmed attack or a ranged attack (thrown must be agile/finesse). (sneak-attack.json)
 *   • Ranger Precision hunter's edge — 1d8 (→2/3d8 at L11/19) precision on the FIRST hit each round vs
 *     your hunted prey. (class-features/precision.json; requires Hunt Prey.)
 *  Returned as annotations; the caller renders them like crit riders and never adds them to the flat total. */
function strikePrecisionRiders(c: Character, db: ContentDatabase, strike: { traits: string[]; ranged: boolean }): { text: string; note: string }[] {
  const owned = ownedFeatureIds(c, db);
  const out: { text: string; note: string }[] = [];
  const agileOrFinesse = strike.traits.includes('agile') || strike.traits.includes('finesse');
  const thrown = strike.traits.includes('thrown') || strike.traits.some((t) => t.startsWith('thrown-'));
  // Sneak Attack qualifies for an agile/finesse melee or unarmed attack, or a ranged attack (a thrown
  // ranged attack must itself be agile or finesse); off-guard target.
  if (owned.has('sneak-attack')) {
    const qualifies = strike.ranged ? (!thrown || agileOrFinesse) : agileOrFinesse;
    if (qualifies) {
      const dice = 1 + [5, 11, 17].filter((l) => c.level >= l).length;
      out.push({ text: `${dice}d6 precision`, note: 'sneak attack when target is off-guard' });
    }
  }
  // Ranger Precision hunter's edge applies to ANY Strike vs your hunted prey (no weapon restriction),
  // on the first hit of the round. It's the `precision` Hunter's Edge subclass option + Hunt Prey.
  if (c.subclassId === 'precision' && owned.has('hunt-prey')) {
    const dice = c.level >= 19 ? 3 : c.level >= 11 ? 2 : 1;
    out.push({ text: `${dice}d8 precision`, note: 'first hit vs hunted prey' });
  }
  return out;
}

/** A source that grants weapon critical specialization: the level it activates and the weapon
 *  restriction (if any). */
export interface CritSpecSource {
  level: number;
  weapons?: DefenseGrants['critSpecWeapons'];
}

/** Every crit-spec grant the character has, from class features (Weapon Mastery/Expertise, …),
 *  taken feats (ancestry weapon-familiarity, dedications, …), the chosen subclass option (rogue
 *  Ruffian's racket), and subclass-suffixed features (cleric/warpriest doctrines). Each carries
 *  the level it activates (a feat's `self:level` gate wins over its take level) and any weapon
 *  narrowing. Compute once, then test each Strike with `strikeShowsCritSpec`. */
export function critSpecSources(c: Character, db: ContentDatabase): CritSpecSource[] {
  const out: CritSpecSource[] = [];
  const add = (e: DefenseGrants & { critSpec?: boolean; critSpecLevel?: number } | undefined, gainLevel: number) => {
    if (!e?.critSpec) return;
    out.push({ level: Math.max(gainLevel, e.critSpecLevel ?? 0), weapons: e.critSpecWeapons });
  };
  const cls = c.classId ? db.classes[c.classId] : undefined;
  if (cls) for (const cf of cls.features) add(db.classFeatures[cf.featureId], cf.level);
  for (const f of c.feats) add(db.feats[f.featId], f.level ?? 1);
  if (c.subclassId) {
    add(db.classFeatures[c.subclassId], db.classFeatures[c.subclassId]?.level ?? 1);
    // Doctrines and other subclass-suffixed features aren't listed in cls.features.
    const suffix = '-' + c.subclassId;
    for (const cf of Object.values(db.classFeatures)) if (cf.critSpec && cf.id.endsWith(suffix)) add(cf, cf.level);
  }
  return out.filter((s) => s.level <= c.level);
}

function weaponMatches(strike: Strike, w?: DefenseGrants['critSpecWeapons']): boolean {
  if (!w) return true;
  if (w.melee && strike.ranged) return false;
  const narrowed = !!(w.groups?.length || w.traits?.length || w.bases?.length);
  if (!narrowed) return true;
  if (strike.group && w.groups?.includes(strike.group)) return true;
  if (w.traits?.some((t) => strike.traits.includes(t))) return true;
  if (strike.base && w.bases?.includes(strike.base)) return true;
  return false;
}

/** Whether a Strike should show its critical-specialization effect: the character has a source
 *  (at their level) that grants crit-spec for this weapon's group / traits / base. */
export function strikeShowsCritSpec(strike: Strike, sources: CritSpecSource[]): boolean {
  return sources.some((s) => weaponMatches(strike, s.weapons));
}

/** Weapon Specialization bonus damage at a given attack proficiency rank: +2/+3/+4 at
 *  expert/master/legendary, doubled to +4/+6/+8 with Greater; 0 when untrained or trained. */
export function weaponSpecDamage(rank: ProficiencyRank, ws: { spec: boolean; greater: boolean }): number {
  if (!ws.spec) return 0;
  const tier = rank === 'legendary' ? 3 : rank === 'master' ? 2 : rank === 'expert' ? 1 : 0;
  if (tier === 0) return 0;
  return ws.greater ? tier * 2 + 2 : tier + 1;
}

export function deriveStrike(c: Character, db: ContentDatabase, inv: InventoryItem): Strike | null {
  const item = db.items[inv.itemId];
  if (!item || item.itemType !== 'weapon') return null;
  const w = item;
  // Material/precious-metal placeholder "weapons" (cold iron, adamantine ingots, silver, …) carry no
  // damage object; guard so a stray equip can't crash the entire Strikes computation + Main tab.
  if (!w.damage) return null;

  const strMod = abilityMod(c.abilities.str);
  const dexMod = abilityMod(c.abilities.dex);
  const finesse = w.traits.includes('finesse');
  // A weapon with a range increment is "ranged" for the UI, but THROWN weapons (javelin,
  // dagger via thrown-N) still use Strength like a melee weapon. Only true PROJECTILE
  // weapons (bows/crossbows/firearms) use Dexterity and add no Strength to damage.
  const thrown = w.traits.includes('thrown') || w.traits.some((t) => t.startsWith('thrown-'));
  const propulsive = w.traits.includes('propulsive');
  const ranged = w.range != null;
  const projectile = ranged && !thrown;

  // Attack ability: projectiles use Dex; melee & thrown use Str (or Dex if finesse and higher).
  const usesDex = projectile || (finesse && dexMod > strMod);
  const atkAbility: AbilityId = usesDex ? 'dex' : 'str';
  const abMod = usesDex ? dexMod : strMod;

  // A Monster-Parts refined weapon ignores its runes entirely (either/or). Its refinement supplies the
  // attack item bonus + striking dice a potency/striking rune would (Table 4A), plus imbued riders.
  const mpMode = mpActive(c, inv);
  const mpRef = mpMode ? mpWeaponRefine(inv.monsterPart, c.level) : null;
  const runes = mpMode ? undefined : (inv.runes as WeaponRunes | undefined);
  // Best of: weapon-category rank, a per-weapon override (deity favored weapon), and a per-GROUP
  // proficiency (alchemist bombs, gunslinger firearms — these beat the bare category rank).
  const rank = betterRank(
    betterRank(c.proficiencies.attacks[w.category], c.proficiencies.weaponOverrides?.[w.id]),
    w.group ? c.proficiencies.weaponGroups?.[w.group] : undefined,
  );
  // ABP attack potency replaces the weapon's potency rune; a refined weapon supplies an item bonus of
  // the same class (take the higher — a refined weapon carries no runes, so this is refinement-vs-ABP).
  const potencyBonus = Math.max(abpOn(c) ? abpAttack(c.level) : runes?.potency ?? 0, mpRef?.attack ?? 0);
  // Clumsy penalizes EVERY ranged attack roll, including thrown weapons that use Str to hit. Status
  // penalties don't stack and both calls carry the same Frightened/Prone, so taking the worst (min) of
  // the attack-ability and Dex penalties folds in Clumsy for a thrown strike without double-counting.
  const atkCondPenalty = ranged
    ? Math.min(conditionPenalty(c.conditions, atkAbility, 'attack'), conditionPenalty(c.conditions, 'dex', 'attack'))
    : conditionPenalty(c.conditions, atkAbility, 'attack');
  const base =
    abMod + profBonus(rank, c.level, pwl(c)) + potencyBonus + atkCondPenalty + modeNumberBonus(c.activeModes, { kind: 'attack' });

  const step = w.traits.includes('agile') ? 4 : 5;
  const attack = [base, base - step, base - step * 2];

  const strikingExtra = Math.max(
    abpOn(c) ? abpStrikingDice(c.level) : runes?.striking ? STRIKING_DICE[runes.striking] : 0,
    mpRef?.extraDice ?? 0,
  );
  const dice = w.damage.dice + strikingExtra;
  // Deadly Simplicity steps the damage die of the deity's favored SIMPLE weapon up one size while
  // it's wielded (Player Core). Only real simple weapon items qualify here; unarmed favored weapons
  // (Irori's fist) are handled on the Fist Strike in deriveUnarmedStrike.
  const dsFavored = hasDeadlySimplicity(c) && deitySimpleFavoredWeaponIds(c, db).has(w.id);
  const effDie = deadlySimplicityDie(w.damage.die, dsFavored, false);
  // Weapon specialization adds flat damage to weapons you're expert+ in (melee and ranged).
  const specDamage = weaponSpecDamage(rank, weaponSpecialization(c, db));
  // Thief racket (rogue): on a MELEE Strike with a finesse weapon/unarmed attack, add Dexterity to
  // damage instead of Strength. RAW it's a choice ("you can"), so use it only when it helps (Dex>Str).
  // (class-features/thief.json: FlatModifier ability=dex, selector melee-strike-damage, item:trait:finesse.)
  const thiefDexDamage = c.subclassId === 'thief' && !projectile && finesse && dexMod > strMod;
  // Damage attribute: melee & thrown add full Str; propulsive adds half Str (rounded down,
  // or the full penalty if Str is negative); other projectiles add none. Finesse affects the
  // attack roll, not damage, so the Str (not Dex) modifier and its Enfeebled penalty apply — unless
  // the thief racket swaps in Dex (then the Dex modifier and its Clumsy/enfeeble-equivalent apply).
  const dmgAbMod = thiefDexDamage ? dexMod : projectile ? (propulsive ? (strMod > 0 ? Math.floor(strMod / 2) : strMod) : 0) : strMod;
  const usesStrDamage = !thiefDexDamage && (!projectile || propulsive);
  const dmgAbilityId: AbilityId | null = thiefDexDamage ? 'dex' : usesStrDamage ? 'str' : null;
  const dmgBonus =
    dmgAbMod +
    (thiefDexDamage ? conditionPenalty(c.conditions, 'dex', 'damage') : usesStrDamage ? conditionPenalty(c.conditions, 'str', 'damage') : 0) +
    specDamage +
    modeNumberBonus(c.activeModes, { kind: 'damage' });
  // Property-rune extra damage (Flaming → 1d6 fire, etc.). Only Greater Flaming adds persistent damage
  // on a critical hit (2d10 fire) — carried as `critPersistent` and shown as a separate crit rider.
  const runeDamage = (runes?.property ?? [])
    .map((p) => db.runes[p]?.damage)
    .filter((d): d is NonNullable<typeof d> => !!d);
  const runeDmg = runeDamage.map((d) => `${d.dice}${d.die} ${DAMAGE_ABBR[d.type] ?? d.type}`);
  const critPersistent = runeDamage
    .filter((d) => d.critPersistent)
    .map((d) => `${d.critPersistent!.dice}${d.critPersistent!.die} persistent ${DAMAGE_ABBR[d.type] ?? d.type}`);
  // Monster Parts imbued damage folds in alongside rune damage as per-hit "plus" terms (the situational
  // crit riders stay as reference prose on the item, not computed).
  const mpDmg = mpMode ? mpImbuedDamageTerms(inv.monsterPart, w.damage.type, c.level).map((t) => formatMpDamageTerm(t)) : [];
  const extraDmg = [...runeDmg, ...mpDmg];
  // Deadly dN adds bonus weapon dice on a crit (1 die; 2 with greater striking, 3 with major); Fatal dN
  // upgrades the crit dice to dN and adds one; Two-Hand dN uses a larger die when wielded two-handed.
  const traitDie = (re: RegExp) => w.traits.map((t) => re.exec(t)?.[1]).find(Boolean);
  const deadlyDie = traitDie(/^deadly-(d\d+)$/);
  const fatalDie = traitDie(/^fatal(?:-aim)?-(d\d+)$/);
  const twoHandDie = traitDie(/^two-hand-(d\d+)$/);
  const critRiders = [...(deadlyDie ? [`${Math.max(1, strikingExtra)}${deadlyDie}`] : []), ...critPersistent];
  const damage =
    `${dice}${effDie}${dmgBonus ? formatMod(dmgBonus) : ''} ${DAMAGE_ABBR[w.damage.type] ?? w.damage.type}` +
    (extraDmg.length ? ` plus ${extraDmg.join(' plus ')}` : '') +
    (critRiders.length ? ` (plus ${critRiders.join(', ')} on a crit)` : '') +
    (fatalDie ? ` (fatal ${fatalDie})` : '') +
    (twoHandDie ? ` (${dice}${twoHandDie}${dmgBonus ? formatMod(dmgBonus) : ''} two-handed)` : '');
  const conditionalDamage = strikePrecisionRiders(c, db, { traits: w.traits, ranged });

  return {
    instanceId: inv.instanceId,
    name: item.name,
    attack,
    damage: damage + conditionalRiderText(conditionalDamage),
    traits: w.traits,
    ranged,
    range: w.range,
    reload: w.reload,
    group: w.group,
    base: w.id,
    specDamage: specDamage || undefined,
    rank,
    atkAbility,
    dmgAbility: dmgAbilityId,
    dmgAbMod,
    potencyBonus,
    mpRefined: mpMode || undefined,
    dmgBonus,
    strikingDice: strikingExtra,
    mapStep: step,
    conditionalDamage: conditionalDamage.length ? conditionalDamage : undefined,
  };
}

/** Render conditional damage riders as a compact suffix on the `damage` string, e.g.
 *  " (plus 1d6 precision when target is off-guard)". */
function conditionalRiderText(riders: { text: string; note: string }[]): string {
  if (!riders.length) return '';
  return ' ' + riders.map((r) => `(plus ${r.text} ${r.note})`).join(' ');
}

/** Per-element Elemental Blast profile (die + damage types + range), from the kineticist gate data. */
const ELEMENT_BLAST: Record<string, { die: string; type: string; range: number }> = {
  air: { die: 'd6', type: 'electricity', range: 60 },
  earth: { die: 'd8', type: 'bludgeoning', range: 30 },
  fire: { die: 'd6', type: 'fire', range: 60 },
  metal: { die: 'd8', type: 'piercing', range: 30 },
  water: { die: 'd8', type: 'bludgeoning', range: 30 },
  wood: { die: 'd8', type: 'bludgeoning', range: 30 },
};

/** A kineticist's Elemental Blast as a rollable strike per attuned element. Attack uses Con + the class
 *  proficiency (class DC track); damage scales +1 die at L5/9/13/17. Shown as a ranged strike with a
 *  note that melee adds Str and a 2-action blast adds Con to damage. */
export function deriveBlastStrikes(c: Character, _db: ContentDatabase): Strike[] {
  const elements = c.kineticist?.elements ?? [];
  if (!elements.length) return [];
  const conMod = abilityMod(c.abilities.con);
  const base =
    conMod +
    profBonus(c.proficiencies.classDc, c.level, pwl(c)) +
    conditionPenalty(c.conditions, 'con', 'attack') +
    modeNumberBonus(c.activeModes, { kind: 'attack' });
  const attack = [base, base - 5, base - 10];
  const dice = 1 + [5, 9, 13, 17].filter((l) => c.level >= l).length;
  // Unconditional damage-mode bonuses (e.g. Courageous Anthem) apply to blasts too; fold them into
  // dmgBonus so the strike-damage breakdown (which sums these via modeAdjust) reconciles with the total.
  const dmgMode = modeNumberBonus(c.activeModes, { kind: 'damage' });
  // Kineticist Weapon Specialization (level 13+) adds flat damage to Elemental Blasts, keyed to the
  // blast's (class DC) proficiency rank — exactly like a weapon's specialization.
  const specDamage = weaponSpecDamage(c.proficiencies.classDc, weaponSpecialization(c, _db));
  // A 2-action Elemental Blast gains a STATUS bonus to damage equal to the Con modifier (a melee blast
  // adds Str instead of a status bonus). The app renders the common 2-action ranged blast, so include
  // Con by default and annotate the melee alternative. (actions/…/elemental-blast.json.) Con is only a
  // *bonus* — a negative Con doesn't reduce blast damage, so clamp at 0.
  const conBonus = Math.max(0, conMod);
  const flat = dmgMode + specDamage + conBonus;
  return elements
    .filter((el) => ELEMENT_BLAST[el])
    .map((el) => {
      const b = ELEMENT_BLAST[el];
      return {
        instanceId: `blast:${el}`,
        name: `Elemental Blast (${el.charAt(0).toUpperCase() + el.slice(1)})`,
        attack,
        damage: `${dice}${b.die}${flat ? formatMod(flat) : ''} ${DAMAGE_ABBR[b.type] ?? b.type} (2 actions; +Str instead in melee)`,
        traits: ['attack', 'impulse', 'kineticist', el],
        ranged: true,
        range: b.range,
        rank: c.proficiencies.classDc,
        atkAbility: 'con',
        dmgAbility: 'con',
        dmgAbMod: conBonus,
        specDamage: specDamage || undefined,
        potencyBonus: 0,
        dmgBonus: flat,
        strikingDice: dice - 1,
        mapStep: 5,
      };
    });
}

/** An unarmed-attack profile: the baseline Fist or an ancestry/feat natural attack (fangs, claws…). */
interface UnarmedProfile {
  instanceId: string;
  name: string;
  die: string;
  damageType: string;
  traits: string[];
  group: string;
}

const FIST_PROFILE: UnarmedProfile = {
  instanceId: 'fist',
  name: 'Fist',
  die: 'd4',
  damageType: 'bludgeoning',
  traits: ['agile', 'finesse', 'nonlethal', 'unarmed'],
  group: 'brawling',
};

/** A single unarmed Strike (the Fist, or a natural attack like Iruxi Fangs). Uses the unarmed
 *  proficiency; Str (or Dex when the attack is finesse and Dex is higher). Handwraps of Mighty
 *  Blows etch their runes onto ALL unarmed attacks: potency raises the attack, striking adds dice
 *  OF THIS ATTACK'S OWN DIE SIZE (striking d4 Fist = 2d4, striking d8 fangs = 2d8 — the die-size
 *  rule), and damage-property runes add their riders. ABP, when on, replaces potency/striking. */
function deriveUnarmedStrike(
  c: Character,
  db: ContentDatabase,
  p: UnarmedProfile,
  hwRunes?: WeaponRunes,
  dsUnarmed = false,
  mpHandwraps?: InventoryItem['monsterPart'],
): Strike {
  // Deadly Simplicity: if the deity's favored weapon is this unarmed attack and its die is smaller
  // than d6, raise it to d6 (Player Core). dsUnarmed is set by the caller for the qualifying attack.
  const die = deadlySimplicityDie(p.die, dsUnarmed, true);
  const strMod = abilityMod(c.abilities.str);
  const dexMod = abilityMod(c.abilities.dex);
  const usesDex = p.traits.includes('finesse') && dexMod > strMod;
  const atkAbility: AbilityId = usesDex ? 'dex' : 'str';
  const abMod = usesDex ? dexMod : strMod;
  const rank = c.proficiencies.attacks.unarmed;
  // Monster-Parts refined handwraps buff unarmed attacks like the weapon table (attack + striking).
  const mpRef = mpHandwraps ? mpWeaponRefine(mpHandwraps, c.level) : null;
  const potencyBonus = Math.max(abpOn(c) ? abpAttack(c.level) : hwRunes?.potency ?? 0, mpRef?.attack ?? 0);
  const base =
    abMod + profBonus(rank, c.level, pwl(c)) + potencyBonus + conditionPenalty(c.conditions, atkAbility, 'attack') + modeNumberBonus(c.activeModes, { kind: 'attack' });
  const step = p.traits.includes('agile') ? 4 : 5;
  const attack = [base, base - step, base - step * 2];
  const specDamage = weaponSpecDamage(rank, weaponSpecialization(c, db));
  // Thief racket also applies to a finesse UNARMED attack (thief.json selector melee-strike-damage) —
  // add Dex to damage instead of Str when it helps.
  const thiefDexDamage = c.subclassId === 'thief' && p.traits.includes('finesse') && dexMod > strMod;
  const dmgAbMod = thiefDexDamage ? dexMod : strMod;
  const dmgBonus = dmgAbMod + conditionPenalty(c.conditions, thiefDexDamage ? 'dex' : 'str', 'damage') + specDamage + modeNumberBonus(c.activeModes, { kind: 'damage' });
  // ABP devastating attacks OR a handwraps striking rune (or MP refinement) add dice to THIS attack's
  // own die.
  const strikingExtra = Math.max(
    abpOn(c) ? abpStrikingDice(c.level) : hwRunes?.striking ? STRIKING_DICE[hwRunes.striking] : 0,
    mpRef?.extraDice ?? 0,
  );
  const dice = 1 + strikingExtra;
  // Property runes on the handwraps apply to unarmed attacks (no weapon-type restriction exists in
  // the data to gate on — see the property-applicability rule; gate here if a restriction is added).
  const runeDamage = (hwRunes?.property ?? [])
    .map((pp) => db.runes[pp]?.damage)
    .filter((d): d is NonNullable<typeof d> => !!d);
  const runeDmg = runeDamage.map((d) => `${d.dice}${d.die} ${DAMAGE_ABBR[d.type] ?? d.type}`);
  // Monster-Parts imbued damage on the handwraps folds into unarmed damage as per-hit "plus" terms.
  const mpDmg = mpHandwraps ? mpImbuedDamageTerms(mpHandwraps, p.damageType, c.level).map((t) => formatMpDamageTerm(t)) : [];
  const critPersistent = runeDamage
    .filter((d) => d.critPersistent)
    .map((d) => `${d.critPersistent!.dice}${d.critPersistent!.die} persistent ${DAMAGE_ABBR[d.type] ?? d.type}`);
  // Natural attacks can carry Deadly/Fatal (e.g. a creature's jaws) — surface their crit damage too.
  const nDie = (re: RegExp) => p.traits.map((t) => re.exec(t)?.[1]).find(Boolean);
  const nDeadly = nDie(/^deadly-(d\d+)$/);
  const nFatal = nDie(/^fatal-(d\d+)$/);
  const nCritRiders = [...(nDeadly ? [`${Math.max(1, strikingExtra)}${nDeadly}`] : []), ...critPersistent];
  const extraDmg = [...runeDmg, ...mpDmg];
  const damage =
    `${dice}${die}${dmgBonus ? formatMod(dmgBonus) : ''} ${DAMAGE_ABBR[p.damageType] ?? p.damageType}` +
    (extraDmg.length ? ` plus ${extraDmg.join(' plus ')}` : '') +
    (nCritRiders.length ? ` (plus ${nCritRiders.join(', ')} on a crit)` : '') +
    (nFatal ? ` (fatal ${nFatal})` : '');
  const conditionalDamage = strikePrecisionRiders(c, db, { traits: p.traits, ranged: false });
  return {
    instanceId: p.instanceId,
    name: p.name,
    attack,
    damage: damage + conditionalRiderText(conditionalDamage),
    traits: p.traits,
    ranged: false,
    group: p.group,
    base: p.instanceId,
    specDamage: specDamage || undefined,
    rank,
    atkAbility,
    dmgAbility: thiefDexDamage ? 'dex' : 'str',
    dmgAbMod,
    potencyBonus,
    mpRefined: mpHandwraps ? true : undefined,
    dmgBonus,
    strikingDice: strikingExtra,
    mapStep: step,
    conditionalDamage: conditionalDamage.length ? conditionalDamage : undefined,
  };
}

export function deriveStrikes(c: Character, db: ContentDatabase): Strike[] {
  // Handwraps never appear as their own Strike (under any carry flag) — their runes buff every unarmed attack.
  const weapons = c.inventory
    .filter((inv) => inv.equipped && !isHandwraps(db.items[inv.itemId]))
    .map((inv) => deriveStrike(c, db, inv))
    .filter((s): s is Strike => s != null);
  const hwRunes = bestHandwrapsRunes(c, db);
  // A Monster-Parts-mode handwraps buffs every unarmed attack via its refinement + imbuements.
  const mpHw = bestMpHandwraps(c, db);
  // Ancestry/feat natural attacks (Iruxi Fangs, claws, …) are unarmed Strikes too — buffed by handwraps.
  const naturals = (c.naturalAttacks ?? []).map((na, i) =>
    deriveUnarmedStrike(
      c,
      db,
      {
        instanceId: `natural:${i}`,
        name: na.name,
        die: na.die,
        damageType: na.damageType,
        traits: na.traits?.length ? na.traits : ['unarmed'],
        group: na.group ?? 'brawling',
      },
      hwRunes,
      false,
      mpHw,
    ),
  );
  // Powerful Fist (level-1 monk class feature): the Fist's damage die increases to 1d6 and it loses
  // the nonlethal trait / lethal-attack penalty. (class-features/powerful-fist.json.)
  const fistProfile: UnarmedProfile = ownedFeatureIds(c, db).has('powerful-fist')
    ? { ...FIST_PROFILE, die: 'd6', traits: FIST_PROFILE.traits.filter((t) => t !== 'nonlethal') }
    : FIST_PROFILE;
  // Deadly Simplicity: when the deity's favored weapon is an unarmed attack (Irori's fist), the Fist
  // Strike's die is raised to d6 (its d4 → d6). Applies only to the baseline Fist, not natural attacks.
  const dsFist = hasDeadlySimplicity(c) && deityFavorsUnarmed(c, db);
  // The active stance's granted unarmed attack(s) (Tiger claw, Falling Stone, …) — buffed by handwraps
  // like any unarmed Strike. Listed first so the in-stance attack is prominent.
  const stanceStrikes = (activeStanceDef(c, db)?.strikes ?? []).map((s, i) =>
    deriveUnarmedStrike(
      c,
      db,
      {
        instanceId: `stance:${i}`,
        name: s.name,
        die: s.die,
        damageType: s.damageType,
        traits: s.traits?.length ? [...new Set([...s.traits, 'unarmed'])] : ['unarmed'],
        group: s.group ?? 'brawling',
      },
      hwRunes,
      false,
      mpHw,
    ),
  );
  // Always offer the baseline Fist (PF2e gives every character an unarmed Strike), listed after naturals.
  return [...stanceStrikes, ...weapons, ...deriveBlastStrikes(c, db), ...naturals, deriveUnarmedStrike(c, db, fistProfile, hwRunes, dsFist, mpHw)];
}

export function deriveSpeeds(c: Character, db: ContentDatabase): Speeds {
  const ancestry = c.ancestryId ? db.ancestries[c.ancestryId] : undefined;
  const speeds: Speeds = { ...(ancestry?.speeds ?? {}) };

  // Non-land speeds granted (unconditionally) by the heritage or selected feats.
  const grantSources: DefenseGrants[] = [];
  if (c.heritageId && db.heritages[c.heritageId]) grantSources.push(db.heritages[c.heritageId]);
  for (const f of c.feats) {
    const feat = db.feats[f.featId];
    if (feat) grantSources.push(feat);
  }
  for (const src of grantSources) {
    for (const [k, v] of Object.entries(src.speeds ?? {})) {
      const key = k as keyof Speeds;
      if (typeof v === 'number') speeds[key] = Math.max(speeds[key] ?? 0, v);
    }
  }

  const worn = findWornArmor(c, db);
  if (worn && worn.armor.speedPenalty) {
    // Full penalty if you don't meet the armor's Strength threshold; meeting it
    // reduces the penalty by 5 feet (to a minimum of 0). The penalty applies to EVERY movement type
    // (land, fly, swim, climb, burrow), not just land speed.
    let penalty = Math.abs(worn.armor.speedPenalty);
    if (meetsArmorStrength(c, worn.armor)) penalty = Math.max(0, penalty - 5);
    for (const k of Object.keys(speeds) as (keyof Speeds)[]) {
      if (speeds[k] != null) speeds[k] = Math.max(0, (speeds[k] as number) - penalty);
    }
  }
  // An active stance may reduce Speed (e.g. Mountain Stance −5 ft to all Speeds).
  const stanceSpeedPenalty = activeStanceDef(c, db)?.speedPenalty ?? 0;
  if (stanceSpeedPenalty > 0) {
    for (const k of Object.keys(speeds) as (keyof Speeds)[]) {
      if (speeds[k] != null) speeds[k] = Math.max(0, (speeds[k] as number) - stanceSpeedPenalty);
    }
  }
  // Encumbered reduces every Speed by 10 ft.
  if (c.conditions.some((x) => x.id === 'encumbered')) {
    for (const k of Object.keys(speeds) as (keyof Speeds)[]) {
      if (speeds[k] != null) speeds[k] = Math.max(0, (speeds[k] as number) - 10);
    }
  }
  return speeds;
}

export interface BulkResult {
  total: number;
  /** RAW-floored Bulk for the encumbered/overloaded thresholds (Light-item and coin remainders are
   *  dropped per the rules) — so e.g. 5 Bulk + 6 torches (5.6) isn't falsely flagged Encumbered. The
   *  fractional `total` is kept for display + container-nesting math. */
  encTotal: number;
  encumberedAt: number;
  max: number;
}

/** Direct contents map: each container instanceId → its directly-contained inventory items. */
function childrenByContainer(c: Character, db: ContentDatabase): { childrenOf: Record<string, InventoryItem[]>; containerIds: Set<string> } {
  const containerIds = new Set(c.inventory.filter((i) => db.items[i.itemId]?.itemType === 'container').map((i) => i.instanceId));
  const childrenOf: Record<string, InventoryItem[]> = {};
  for (const inv of c.inventory) {
    if (inv.containerInstanceId && containerIds.has(inv.containerInstanceId)) (childrenOf[inv.containerInstanceId] ??= []).push(inv);
  }
  return { childrenOf, containerIds };
}

/** Build the effective-Bulk function for a character: the Bulk an item contributes including its
 *  (reduced) nested-container contents, innermost-first, with a seen-guard against container cycles. */
function makeEffBulk(c: Character, db: ContentDatabase) {
  const { childrenOf, containerIds } = childrenByContainer(c, db);
  const effBulk = (inv: InventoryItem, seen: Set<string>): number => {
    const item = db.items[inv.itemId];
    if (!item) return 0;
    const own = item.bulk * inv.quantity;
    if (item.itemType !== 'container' || seen.has(inv.instanceId)) return own;
    seen.add(inv.instanceId);
    const contents = (childrenOf[inv.instanceId] ?? []).reduce((s, k) => s + effBulk(k, seen), 0);
    return own + Math.max(0, contents - (item.ignoredBulk ?? 0));
  };
  return { effBulk, childrenOf, containerIds };
}

/** Effective Bulk of a single inventory item including its (reduced) nested-container contents.
 *  Used to validate container drops so a loaded container can't be stuffed into a smaller one. */
export function effectiveItemBulk(c: Character, db: ContentDatabase, instanceId: string): number {
  const { effBulk } = makeEffBulk(c, db);
  const inv = c.inventory.find((i) => i.instanceId === instanceId);
  return inv ? Math.round(effBulk(inv, new Set()) * 10) / 10 : 0;
}

export function deriveBulk(c: Character, db: ContentDatabase): BulkResult {
  const strMod = abilityMod(c.abilities.str);
  const { effBulk, containerIds } = makeEffBulk(c, db);
  const topLevel = c.inventory.filter((i) => !(i.containerInstanceId && containerIds.has(i.containerInstanceId)));
  let total = topLevel.reduce((s, inv) => s + effBulk(inv, new Set()), 0);
  // 1,000 coins = 1 Bulk. NOTE: the app keeps Bulk as a precise fractional sum (informative, and the
  // container-nesting reduction relies on it) rather than RAW-flooring Light/coin remainders.
  const coins = (c.currency.pp ?? 0) + (c.currency.gp ?? 0) + (c.currency.sp ?? 0) + (c.currency.cp ?? 0);
  total += coins / 1000;
  total = Math.max(0, Math.round(total * 10) / 10);
  return { total, encTotal: Math.floor(total), encumberedAt: 5 + strMod, max: 10 + strMod };
}

/** How full each container is: the raw Bulk of its DIRECT contents vs its capacity. Used to
 *  display load and to block over-capacity drops. */
export interface ContainerLoad {
  used: number;
  capacity?: number;
}
export function containerLoads(c: Character, db: ContentDatabase): Record<string, ContainerLoad> {
  const { effBulk, childrenOf } = makeEffBulk(c, db);
  const loads: Record<string, ContainerLoad> = {};
  for (const inv of c.inventory) {
    const item = db.items[inv.itemId];
    if (item?.itemType === 'container') {
      // A direct child contributes its effective Bulk: a leaf item's raw Bulk, or a nested
      // container's own Bulk plus its (reduced) contents — so a loaded sub-container counts fully.
      const used = (childrenOf[inv.instanceId] ?? []).reduce((s, k) => s + effBulk(k, new Set([inv.instanceId])), 0);
      loads[inv.instanceId] = { used: Math.round(used * 10) / 10, capacity: item.capacity?.bulk };
    }
  }
  return loads;
}
