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
  ItemPassiveEffects,
  ArmorAdjust,
  ArmorAdjustMode,
  ArmorItem,
  ArmorRunes,
  Character,
  ClassFeature,
  ContentDatabase,
  DefenseGrants,
  AbilityScores,
  InventoryItem,
  DieSize,
  Item,
  WeaponItem,
  EffectGrant,
  FeatChoiceDef,
  Heritage,
  RuneDef,
  SenseEntry,
  StanceStrike,
  SubclassOption,
  ProficiencyKey,
  ProficiencyRank,
  SaveId,
  SkillId,
  Speeds,
  SpeedGrants,
  SpellcastingEntry,
  StanceDef,
  StrikeDamageRider,
  WeaponRunes,
} from './types';
import { PROFICIENCY_RANKS } from './types';
import { conditionPenalty, conditionTypedMods, drainedHpLoss } from './conditions';
import { DOMAIN_SPELLS } from './domains';
import { armorSpecEffect, armorSpecValue } from './armorSpec';
import { modeNumberBonus, modeTypedMods, poolTypedMods, type TypedMod } from './modes';
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

// Whether formatMod prefixes positive modifiers with "+". A DISPLAY customization (Content & behaviour
// → "Show + on modifiers"); the sheet sets it from the viewed character's effective customization. Only
// one sheet renders at a time, so a module-level flag is safe (mirrors how the theme is applied to <html>).
let PLUS_ON_MODS = true;
export function setPlusOnMods(on: boolean): void {
  PLUS_ON_MODS = on;
}

/** Format a modifier with an explicit sign, e.g. 3 -> "+3", -1 -> "-1". Positives drop the "+" when the
 *  "Show + on modifiers" option is off; negatives always keep their sign. */
export function formatMod(n: number): string {
  return n >= 0 ? (PLUS_ON_MODS ? `+${n}` : `${n}`) : `${n}`;
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
  /** Set when this number is not the skill's own — an unconditional substitution beat it. Carries
   *  the skill actually rolled and the record that allows it, so the sheet can say both. */
  substitutedFrom?: { skill: SkillId; source: string };
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

const RESILIENT_BONUS: Record<string, number> = { resilient: 1, greater: 2, major: 3, mythic: 4 };

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
  // Item bonus to saves: ABP save potency replaces the resilient rune; a passive save item
  // (mythic resilient, save-bonus wearables) competes as an item bonus — take the best.
  const itemBonus = Math.max(abpOn(c) ? abpSave(c.level) : db ? resilientSaveBonus(c, db) : 0, passiveItemBonus(c, db, 'saves'));
  // The active stance/form may grant a save bonus (Cobra Stance: +1 Fortitude), typed so it pools.
  const stanceSave = db ? activeStanceDef(c, db)?.saves?.[save] : undefined;
  const modifier =
    abilityMod(c.abilities[ability]) +
    profBonus(rank, c.level, pwl(c)) +
    // All typed modifiers (item / condition penalties / modes / stance) pool by type across sources.
    poolTypedMods([
      { type: 'item', value: itemBonus },
      ...(stanceSave ? [{ type: stanceSave.type as TypedMod['type'], value: stanceSave.value }] : []),
      ...conditionTypedMods(c.conditions, ability, 'save'),
      ...modeTypedMods(c.activeModes, { kind: 'save', detail: save }),
    ]);
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

/** The best PASSIVE item bonus of a kind from worn/invested/equipped items (the generic magic-item
 *  lane — Clarity Goggles, Cloak of Social Graces, …). Item bonuses don't stack: callers take the
 *  max of this, ABP, and Monster Parts. Requires the db to read item definitions. */
export function passiveItemBonus(
  c: Character,
  db: ContentDatabase | undefined,
  kind: 'perception' | 'skill' | 'saves' | 'ac' | 'attack',
  skillKey?: ProficiencyKey,
): number {
  if (!db) return 0;
  let best = 0;
  const read = (pe?: ItemPassiveEffects) => {
    if (!pe) return;
    let v = kind === 'skill' ? (skillKey ? pe.skills?.[skillKey] ?? 0 : 0) : pe[kind] ?? 0;
    // A blanket Lore bonus (Brooch of Inspiration) applies to every Lore skill.
    if (kind === 'skill' && skillKey?.startsWith('lore:') && pe.loreBonus) v = Math.max(v, pe.loreBonus);
    best = Math.max(best, v);
  };
  for (const inv of c.inventory) {
    if (!(inv.worn || inv.invested || inv.equipped)) continue;
    read(db.items[inv.itemId]?.passiveEffects);
    read(c.resolvedItemPassives?.[inv.itemId]); // a resolved "choose one of N" item passive
  }
  return best;
}

/**
 * The same best-of-the-worn item bonus as `passiveItemBonus`, plus WHICH item supplied it.
 *
 * The number alone was all the sheet had, so a passive magic item raised your AC or your Will save
 * and the breakdown listed nothing — the parts stopped adding up to the total, and there was no way
 * to tell what had done it. The breakdowns use this to name the source.
 */
export function passiveItemBonusDetail(
  c: Character,
  db: ContentDatabase | undefined,
  kind: 'perception' | 'skill' | 'saves' | 'ac' | 'attack',
  skillKey?: ProficiencyKey,
): { value: number; name: string } | null {
  if (!db) return null;
  let best: { value: number; name: string } | null = null;
  const read = (pe: ItemPassiveEffects | undefined, name: string) => {
    if (!pe) return;
    let v = kind === 'skill' ? (skillKey ? pe.skills?.[skillKey] ?? 0 : 0) : pe[kind] ?? 0;
    if (kind === 'skill' && skillKey?.startsWith('lore:') && pe.loreBonus) v = Math.max(v, pe.loreBonus);
    if (v && (!best || v > best.value)) best = { value: v, name };
  };
  for (const inv of c.inventory) {
    if (!(inv.worn || inv.invested || inv.equipped)) continue;
    const name = db.items[inv.itemId]?.name ?? inv.itemId;
    read(db.items[inv.itemId]?.passiveEffects, name);
    read(c.resolvedItemPassives?.[inv.itemId], name);
  }
  return best;
}

/** An item bonus to a DYNAMIC skill set — the character's sorcerer bloodline skills (Sanguine Pendant)
 *  or their deity's skill (Helm of Zeal) — from invested items. Item bonuses don't stack (highest). */
export function dynamicItemSkillBonus(c: Character, db: ContentDatabase | undefined, skillKey: ProficiencyKey): number {
  if (!db) return 0;
  let best = 0;
  const bloodline = () => {
    const cls = c.classId === 'sorcerer' ? db.classes.sorcerer : c.classId2 === 'sorcerer' ? db.classes.sorcerer : undefined;
    const sub = cls?.subclass?.options.find((o) => o.id === c.subclassId || o.id === c.subclassId2);
    return (sub?.grants?.skills ?? []) as string[];
  };
  const deitySkill = () => {
    const s = c.details.deityId ? db.deities[c.details.deityId]?.skill : undefined;
    return s ? [s] : [];
  };
  for (const inv of c.inventory) {
    if (!inv.invested) continue;
    const dsb = db.items[inv.itemId]?.dynamicSkillBonus;
    if (!dsb) continue;
    const skills = dsb.source === 'bloodline' ? bloodline() : deitySkill();
    if (skills.includes(skillKey)) best = Math.max(best, dsb.value);
  }
  return best;
}

export function derivePerception(c: Character, db?: ContentDatabase): StatLine {
  const rank = c.proficiencies.perception;
  // Item bonus: the best of ABP perception, a Monster-Parts refined Perception item, and a passive
  // Perception item (Clarity Goggles) — all item bonuses, which don't stack.
  const itemBonus = Math.max(abpOn(c) ? abpPerception(c.level) : 0, mpSenseSkillItemBonus(c, 'perception'), passiveItemBonus(c, db, 'perception'));
  const modifier =
    abilityMod(c.abilities.wis) +
    profBonus(rank, c.level, pwl(c)) +
    poolTypedMods([
      { type: 'item', value: itemBonus },
      ...conditionTypedMods(c.conditions, 'wis', 'perception'),
      ...modeTypedMods(c.activeModes, { kind: 'perception' }),
    ]);
  return { rank, modifier };
}

/**
 * The proficiency bonus an UNTRAINED skill check gets — 0 by RAW, but Untrained Improvisation makes
 * it "your level –2" and Eclectic Skill makes it your level. Returns null when nothing applies.
 *
 * Skipped under Proficiency Without Level: that variant re-bases every rank, and "equal to your
 * level" has no meaning in it. Better to leave the variant's own number alone than to invent one.
 */
export function untrainedSkillBonus(c: Character, db?: ContentDatabase): number | null {
  if (!db || pwl(c)) return null;
  let best: number | null = null;
  for (const fc of c.feats ?? []) {
    const u = db.feats[fc.featId]?.untrainedProficiency;
    if (!u) continue;
    const v = c.level - u.levelMinus;
    if (best == null || v > best) best = v;
  }
  return best;
}

/** One resolved skill substitution, with the record it came from so the sheet can name it. */
export interface ResolvedSkillSub {
  use: SkillId;
  forSkill: SkillId;
  /** Absent = unconditional. */
  when?: string;
  /** Display name of the feat / feature / heritage / item that grants it. */
  source: string;
  /** Its RECORD id. The situational map is keyed by the ids a character actually has, so an entry
   *  filed under anything else is never looked at. */
  sourceId: string;
}

/**
 * Every "you can use X instead of Y" the character has.
 *
 * A substitution swaps WHICH skill you roll, so it is not a bonus and could not be written as one —
 * 35 records carrying one did nothing at all, and Chirurgeon's record shipped a `dataWarning` saying
 * so. An ITEM only counts while it is actually worn, held or invested.
 */
export function skillSubstitutions(c: Character, db: ContentDatabase | undefined): ResolvedSkillSub[] {
  if (!db) return [];
  const out: ResolvedSkillSub[] = [];
  const take = (subs: DefenseGrants['skillSubstitutions'], sourceId: string, source: string) => {
    for (const s of subs ?? []) out.push({ ...s, sourceId, source });
  };
  for (const f of c.feats ?? []) take(db.feats[f.featId]?.skillSubstitutions, f.featId, db.feats[f.featId]?.name ?? f.featId);
  for (const fid of ownedFeatureIds(c, db)) take(db.classFeatures[fid]?.skillSubstitutions, fid, db.classFeatures[fid]?.name ?? fid);
  for (const h of heritageRecords(c, db)) take(h.skillSubstitutions, h.id, h.name);
  for (const inv of c.inventory ?? []) {
    if (!(inv.worn || inv.invested || inv.equipped)) continue;
    const item = db.items[inv.itemId];
    take(item?.passiveEffects?.skillSubstitutions, inv.itemId, item?.name ?? inv.itemId);
  }
  return out;
}

/**
 * The best UNCONDITIONAL stand-in for a skill, when it beats the skill's own number.
 *
 * Only an unconditional substitution may move the number a player reads off the sheet. Natural
 * Medicine's is conditional and its own text says it "doesn't replace Medicine for uses of the skill
 * other than Treat Wounds or for feat prerequisites" — showing its number on Medicine would be a lie.
 * Those are surfaced beside the skill instead, with their condition.
 */
export function skillSubstituteFor(
  c: Character,
  key: ProficiencyKey,
  db: ContentDatabase | undefined,
  own: StatLine,
): (ResolvedSkillSub & { modifier: number; rank: ProficiencyRank }) | undefined {
  let best: (ResolvedSkillSub & { modifier: number; rank: ProficiencyRank }) | undefined;
  for (const s of skillSubstitutions(c, db)) {
    if (s.when || s.forSkill !== key) continue;
    const alt = deriveSkill(c, s.use, db, true);
    if (alt.modifier <= own.modifier) continue;
    if (!best || alt.modifier > best.modifier) best = { ...s, modifier: alt.modifier, rank: alt.rank };
  }
  return best;
}

/** `noSubstitute` stops the substitution lookup recursing when it derives the stand-in skill. */
export function deriveSkill(c: Character, key: ProficiencyKey, db?: ContentDatabase, noSubstitute = false): StatLine {
  // A rank granted by THIS MORNING's answer (Haunting Memories' borrowed skill). Build-time skill
  // grants are already folded into `proficiencies`; a daily one is play state resolved after the
  // build, so it has to be maxed in here or the answer moves nothing on the sheet.
  const rank = dailySkillRank(c, db, key) ?? c.proficiencies.skills[key] ?? 'untrained';
  const ability = skillAbility(key);
  // Item bonus: the best of an ABP skill item, a Monster-Parts refined skill item, a passive skill item
  // (Cloak of Social Graces), and a dynamic bloodline/deity skill item (Sanguine Pendant). Don't stack.
  const itemBonus = Math.max(abpSkillBonus(c, key), mpSenseSkillItemBonus(c, 'skill', key), passiveItemBonus(c, db, 'skill', key), dynamicItemSkillBonus(c, db, key));
  // An untrained skill normally contributes 0 proficiency; Untrained Improvisation and Eclectic Skill
  // replace that with your level (minus what they print). Never LOWERS it.
  const untrained = rank === 'untrained' ? untrainedSkillBonus(c, db) : null;
  const prof = untrained != null ? Math.max(profBonus(rank, c.level, pwl(c)), untrained) : profBonus(rank, c.level, pwl(c));
  let modifier =
    abilityMod(c.abilities[ability]) +
    prof +
    poolTypedMods([
      { type: 'item', value: itemBonus },
      ...conditionTypedMods(c.conditions, ability, 'skill'),
      ...modeTypedMods(c.activeModes, { kind: 'skill', detail: key }),
    ]);
  // The worn armor's check penalty hits Strength- and Dexterity-based skills — but which skills
  // exactly is a per-skill question once armor traits are read: `flexible` exempts Acrobatics and
  // Athletics, `noisy` forces it onto Stealth even when the Strength requirement is met.
  if (db && (ability === 'str' || ability === 'dex')) {
    modifier += deriveArmorCheckPenalty(c, db, key).value;
  }
  const own: StatLine = { rank, modifier };
  // "You can use your proficiency rank in Crafting for anything that requires a proficiency rank in
  // Medicine." An UNCONDITIONAL stand-in that is better than the skill's own number IS the number
  // the player rolls, so it is what the sheet shows — carrying `substitutedFrom` so the row and its
  // breakdown can say which skill it is and which record allows it.
  if (!noSubstitute) {
    const sub = skillSubstituteFor(c, key, db, own);
    if (sub) return { rank: sub.rank, modifier: sub.modifier, substitutedFrom: { skill: sub.use, source: sub.source } };
  }
  return own;
}

export function deriveClassDc(c: Character): StatLine & { dc: number } {
  const rank = c.proficiencies.classDc;
  const key = c.keyAbility ?? 'str';
  const modifier =
    abilityMod(c.abilities[key]) +
    profBonus(rank, c.level, pwl(c)) +
    poolTypedMods([...conditionTypedMods(c.conditions, key, 'class-dc'), ...modeTypedMods(c.activeModes, { kind: 'class-dc' })]);
  return { rank, modifier, dc: 10 + modifier };
}

export interface SpellStats {
  rank: ProficiencyRank;
  attack: number;
  dc: number;
}

export function deriveSpellcasting(c: Character, entry: SpellcastingEntry): SpellStats {
  const base = abilityMod(c.abilities[entry.keyAbility]) + profBonus(entry.proficiency, c.level, pwl(c));
  const attack =
    base +
    poolTypedMods([...conditionTypedMods(c.conditions, entry.keyAbility, 'spell-attack'), ...modeTypedMods(c.activeModes, { kind: 'spell-attack' })]);
  const dc =
    10 +
    base +
    poolTypedMods([...conditionTypedMods(c.conditions, entry.keyAbility, 'spell-dc'), ...modeTypedMods(c.activeModes, { kind: 'spell-dc' })]);
  return { rank: entry.proficiency, attack, dc };
}

/** Total max-HP bonus from the character's selected feats (Toughness = +level, etc.). */
export function featHpBonus(c: Character, db: ContentDatabase): number {
  let total = 0;
  const takenFeats = c.feats.map((f) => db.feats[f.featId]).filter((f): f is NonNullable<typeof f> => !!f);
  for (const f of takenFeats) {
    const b = f.maxHpBonus;
    if (!b) continue;
    total += (b.perLevel ?? 0) * c.level + (b.flat ?? 0);
    // Resiliency feats: +N HP for each archetype feat of that class you have (dedication counts).
    if (b.perArchetypeFeat && b.archetype) {
      total += b.perArchetypeFeat * takenFeats.filter((x) => x.archetype === b.archetype).length;
    }
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

export interface WornArmor {
  inv: InventoryItem;
  armor: ArmorItem;
  /**
   * The category the PROFICIENCY lookup must use, which is not always the armor's own.
   *
   * Heavy Construction turns the innovation into heavy armor while its proficiency "advances to be
   * equal to your proficiency in medium armor" — and an inventor is never trained in heavy armor at
   * any level, with untrained being a flat +0. Reading `defenses.heavy` would cost a 10th-level
   * inventor 12 AC.
   */
  profCategory: ArmorCategory;
  /** Items worn WITH the armour that restated it (Armored Skirt, Plated Duster) — surfaced so the AC
   *  breakdown can name them and the sheet can warn when one has pushed the wearer into a category
   *  they are untrained in. */
  adjustedBy?: { itemId: string; name: string; label: string }[];
}

const CATEGORY_ORDER: ArmorCategory[] = ['unarmored', 'light', 'medium', 'heavy'];

/** Step an armour category up or down, clamped — "one step heavier (from light to medium, or medium
 *  to heavy)". Never steps into 'unarmored', which is a kind of armour rather than a lighter one. */
function stepCategory(c: ArmorCategory, by: number): ArmorCategory {
  const i = CATEGORY_ORDER.indexOf(c);
  if (i < 1) return c;
  return CATEGORY_ORDER[Math.min(CATEGORY_ORDER.length - 1, Math.max(1, i + by))];
}

/** The mode of an ArmorAdjust that applies to this host, or undefined when none does. */
function armorAdjustMode(adjust: ArmorAdjust, host: ArmorItem): ArmorAdjustMode | undefined {
  return adjust.modes.find((m) => {
    if (m.items?.length) return m.items.includes(host.id);
    if (m.hostCategories?.length && !m.hostCategories.includes(host.category)) return false;
    if (m.hostGroups?.length && !m.hostGroups.includes(host.group ?? '')) return false;
    return !!(m.hostCategories?.length || m.hostGroups?.length);
  });
}

/**
 * Apply every worn item that restates the armour (Armored Skirt, Plated Duster).
 *
 * The mode is chosen by the HOST, never by the player: each item prints which armours each of its
 * modes covers, and an armour matching none gets nothing. That is why this needs no picker and no
 * attachment — wearing both items is the whole interaction, exactly as the rules describe it.
 */
function applyArmorAdjusts(c: Character, db: ContentDatabase, worn: WornArmor): WornArmor {
  let out = worn.armor;
  let profCategory = worn.profCategory;
  const adjustedBy: { itemId: string; name: string; label: string }[] = [];
  for (const inv of c.inventory) {
    if (!inv.worn) continue;
    const item = db.items[inv.itemId];
    const adjust = item?.armorAdjust;
    if (!adjust) continue;
    // "You can't use a plated duster alongside an armored skirt or any other item that adjusts an
    // armor's statistics." One adjusting item per suit; the first worn wins.
    if (adjustedBy.length) continue;
    const mode = armorAdjustMode(adjust, out);
    if (!mode) continue;
    if (mode.acBonus) out = { ...out, acBonus: out.acBonus + mode.acBonus };
    // An absent Dex cap is UNLIMITED, and an item that "reduces the Dex cap by 1" cannot cap an
    // uncapped suit — leave it alone rather than inventing a number.
    if (mode.dexCap != null && out.dexCap != null) out = { ...out, dexCap: Math.max(0, out.dexCap + mode.dexCap) };
    if (mode.checkPenalty) out = { ...out, checkPenalty: Math.min(0, (out.checkPenalty ?? 0) + mode.checkPenalty) };
    if (mode.strength != null && out.strength != null) out = { ...out, strength: out.strength + mode.strength };
    if (mode.setGroup) out = { ...out, group: mode.setGroup };
    if (mode.addTraits?.length) out = { ...out, traits: [...new Set([...(out.traits ?? []), ...mode.addTraits])] };
    if (mode.categoryStep) {
      const stepped = stepCategory(out.category, mode.categoryStep);
      out = { ...out, category: stepped };
      // "you use the proficiency bonus appropriate to this adjusted armor type" — the proficiency
      // moves WITH the category, which is what can cost an untrained wearer their entire AC bonus.
      profCategory = stepped;
    }
    adjustedBy.push({ itemId: item.id, name: item.name, label: mode.label });
  }
  return adjustedBy.length ? { ...worn, armor: out, profCategory, adjustedBy } : worn;
}

/**
 * Restat a worn armor when an owned record modifies the DESIGNATED innovation.
 *
 * Gated twice on purpose: the item must carry the designation AND be one the record names. The
 * designation alone is player-set, so without the id check a player could mark full plate as their
 * innovation and collect the medium-armor track for it.
 */
export function applyArmorRiders(c: Character, db: ContentDatabase, inv: InventoryItem, armor: ArmorItem): WornArmor {
  // Zero cost for everyone who designated nothing — which is everyone but an inventor.
  if (!inv.designations?.length) return { inv, armor, profCategory: armor.category };
  let out = armor;
  let profCategory = armor.category;
  for (const id of ownedFeatureIds(c, db)) {
    const r = db.classFeatures[id]?.armorRestat;
    if (!r || !inv.designations.includes(r.designated)) continue;
    if (r.items && !r.items.includes(armor.id)) continue;
    out = { ...out, ...(r.set ?? {}) };
    if (r.addTraits?.length) out = { ...out, traits: [...new Set([...(out.traits ?? []), ...r.addTraits])] };
    if (r.proficiencyAs) profCategory = r.proficiencyAs;
    // "If your Strength modifier is at least +3, you remove the Speed penalty entirely instead of
    // reducing it to -5 feet." Zeroing it here lets the ordinary threshold rule below run unchanged:
    // max(0, 0 - 5) is still 0. Below the threshold the full restatted penalty stands.
    if (r.removeSpeedPenaltyAtStr != null && abilityMod(c.abilities.str) >= r.removeSpeedPenaltyAtStr) {
      out = { ...out, speedPenalty: 0 };
    }
  }
  return { inv, armor: out, profCategory };
}

/** The worn armor item and its inventory entry, if any — restatted by any owned rider. */
function findWornArmor(c: Character, db: ContentDatabase): WornArmor | null {
  for (const inv of c.inventory) {
    const item = db.items[inv.itemId];
    // Class-feature riders first (an inventor's designated innovation), then the worn items that
    // restate the suit itself. Order matters: a skirt steps the category the rider may have set.
    if (inv.worn && item?.itemType === 'armor') return applyArmorAdjusts(c, db, applyArmorRiders(c, db, inv, item));
  }
  return null;
}

/** The worn armour with everything applied — exported so the sheet can name what adjusted it. */
export function wornArmorOf(c: Character, db: ContentDatabase): WornArmor | null {
  return findWornArmor(c, db);
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
export function deriveArmorCheckPenalty(c: Character, db: ContentDatabase, skill?: ProficiencyKey): ArmorCheckPenalty {
  const worn = findWornArmor(c, db);
  if (!worn || !worn.armor.checkPenalty) return { value: 0, source: null };
  const traits = worn.armor.traits ?? [];
  // FLEXIBLE: "You don't apply its check penalty to Acrobatics or Athletics checks." Unconditional —
  // it does not care whether you meet the armor's Strength requirement.
  if (traits.includes('flexible') && (skill === 'acrobatics' || skill === 'athletics')) {
    return { value: 0, source: null };
  }
  // NOISY: "The armor's check penalty applies to Stealth checks even if you have the required
  // Strength modifier." The one case where meeting Strength does NOT clear the penalty.
  const noisyStealth = traits.includes('noisy') && skill === 'stealth';
  if (!noisyStealth && meetsArmorStrength(c, worn.armor)) return { value: 0, source: null };
  return { value: -Math.abs(worn.armor.checkPenalty), source: worn.armor.name };
}

export interface AcResult {
  value: number;
  rank: ProficiencyRank;
  dexCap: number | null;
}

/** The active stance's entry REGARDLESS of whether its requirements are met. Only the UI should use
 *  this — it needs to show the stance as selected while explaining that it isn't doing anything. */
export function activeStanceEntry(c: Character, db: ContentDatabase): StanceDef | undefined {
  return c.activeStance ? db.stances?.[c.activeStance] : undefined;
}

/** Explorer's clothing is *unarmored*-category armor, so "are you unarmored?" is a question about the
 *  category, not about whether anything is worn. */
export function isUnarmored(c: Character, db: ContentDatabase): boolean {
  const worn = findWornArmor(c, db);
  return !worn || worn.armor.category === 'unarmored';
}

/** The printed requirement the active stance currently fails, or null when it's legal.
 *  Only mechanically checkable requirements can fail here; the rest are shown as a reminder. */
export function stanceRequirementIssue(c: Character, db: ContentDatabase): string | null {
  const stance = activeStanceEntry(c, db);
  const req = stance?.requires;
  if (!req) return null;
  // Tenacious Stance requires the opposite of the monk stances — "You are wearing armor".
  if (req.unarmored && !isUnarmored(c, db)) return req.text;
  if (req.armored && isUnarmored(c, db)) return req.text;
  return null;
}

/** The mechanical def of the character's currently-active stance, if any (exclusive — one at a time).
 *
 *  Returns undefined when the stance's requirements AREN'T met: Rain of Embers requires being
 *  unarmored, and a character in plate who toggled it was being handed its +1 status AC anyway. The
 *  gate lives here, at the single source every mechanical call site already reads, rather than being
 *  repeated at each of them — one missed call site would silently reopen the bug. */
export function activeStanceDef(c: Character, db: ContentDatabase): StanceDef | undefined {
  return stanceRequirementIssue(c, db) ? undefined : activeStanceEntry(c, db);
}

/** The `whileActive` grants from owned feats/features whose resource STATE is currently toggled on
 *  (Raging Resistance while raging). Shared by deriveDefenses (IWR/senses) and deriveSpeeds (speeds). */
export function activeStateGrants(c: Character, db: ContentDatabase): NonNullable<DefenseGrants['whileActive']> {
  const out: NonNullable<DefenseGrants['whileActive']> = [];
  const on = (state: string) => (c.classResources?.[state] ?? 0) > 0;
  const scan = (g: DefenseGrants | undefined) => {
    // minLevel: an instinct is chosen at 1st but prints the damage types for Raging Resistance, a
    // 9th-level feature. Without the gate a 1st-level barbarian would rage with a 9th-level defence.
    for (const wa of g?.whileActive ?? []) if (on(wa.state) && c.level >= (wa.minLevel ?? 0)) out.push(wa);
  };
  for (const f of c.feats) scan(db.feats[f.featId]);
  for (const h of heritageRecords(c, db)) scan(h);
  for (const fid of ownedFeatureIds(c, db)) scan(db.classFeatures[fid]);
  // A resolved PICK may itself be state-gated — Giant Instinct's "your choice of cold, electricity,
  // or fire" is part of Raging Resistance, not a standing benefit.
  scan(c.chosenEffects);
  return out;
}

/**
 * The class features a chosen subclass hands over, filtered to the ones this level has reached.
 *
 * A bare id means "from the level the subclass is taken" — an oracle's curse arrives with the
 * mystery. A `{ id, level }` is gated, which the gunslinger's ways need: each hands over three deeds
 * at 1st, 9th and 15th, and without the gate a 1st-level gunslinger would own their Greater Deed.
 */
export function subclassFeatureIds(
  ids: SubclassOption['featureIds'],
  level: number,
): string[] {
  return (ids ?? []).filter((e) => typeof e === 'string' || level >= e.level).map((e) => (typeof e === 'string' ? e : e.id));
}

/** `${recordId}:${flag}` — the one place this key is spelled, so callers can't drift. */
export const dailyChoiceKey = (recordId: string, flag: string) => `${recordId}:${flag}`;

/**
 * Records that can carry a DAILY-PREPARATIONS choice, in the order the Rest sheet lists them.
 *
 * Lives here, not in dailyChoices.ts, because deriveDefenses needs the same walk to turn this
 * morning's answers into grants and derive.ts must not import back out — it is imported by nearly
 * everything, and a cycle through it has already produced phantom ReferenceErrors under HMR.
 */
export function ownedDailyChoiceRecords(
  c: Character,
  db: ContentDatabase,
): { id: string; name: string; choice?: FeatChoiceDef }[] {
  const out: { id: string; name: string; choice?: FeatChoiceDef }[] = [];
  const push = (id: string | null | undefined, bucket: Record<string, { name: string; choice?: FeatChoiceDef }> | undefined) => {
    if (!id || !bucket) return;
    const r = bucket[id];
    if (r) out.push({ id, name: r.name, choice: r.choice });
  };
  for (const f of c.feats ?? []) push(f.featId, db.feats as never);
  for (const id of ownedFeatureIds(c, db)) push(id, db.classFeatures as never);
  push(c.heritageId, db.heritages as never);
  push(c.ancestryId, db.ancestries as never);
  push(c.backgroundId, db.backgrounds as never);
  // Items only count while actually in use — a wand in your backpack prepares nothing.
  for (const inv of c.inventory ?? []) {
    if (inv.equipped || inv.worn || inv.invested) push(inv.itemId, db.items as never);
  }
  return out;
}

/**
 * The domains a `kind: 'domains'` choice may offer.
 *
 * The pool was hardcoded to the deity's own list at four separate call sites, so a record drawing
 * from a WIDER pool — Splinter Faith's "your deity's domains, your deity's alternate domains, and up
 * to one domain that isn't on either list" — could not be expressed and the feat offered the same
 * four domains as everything else. One helper now, so the four sites cannot drift.
 */
export function domainPoolFor(
  deityId: string | null | undefined,
  db: ContentDatabase,
  pool: FeatChoiceDef['domainPool'] = 'deity',
): string[] {
  const deity = deityId ? db.deities[deityId] : undefined;
  if (pool === 'all') return Object.keys(DOMAIN_SPELLS).sort();
  const own = deity?.domains ?? [];
  if (pool !== 'deity+alternate') return own;
  return [...new Set([...own, ...(deity?.alternateDomains ?? [])])];
}

/**
 * The heritage records whose benefits this character has.
 *
 * Normally one. Late Awakener and Awakened Yaoguai Heritage each say "you gain all the mechanical
 * benefits of the <X> heritage you selected at 1st level" — and both require a VERSATILE heritage,
 * which is what the single `heritageId` records, so the 1st-level ancestry heritage was never stored
 * and there was nothing to dereference. Every reader goes through here so a second one cannot be
 * honoured in some places and forgotten in others.
 */
export function heritageRecords(c: Character, db: ContentDatabase): Heritage[] {
  return [c.heritageId, c.secondHeritageId]
    .filter((id): id is string => !!id)
    .map((id) => db.heritages[id])
    .filter((h): h is Heritage => !!h);
}

/** Does the character have this heritage — either the one they picked, or a granted second? */
export function hasHeritage(c: Character, id: string | undefined): boolean {
  return !!id && (c.heritageId === id || c.secondHeritageId === id);
}

/**
 * The rune definitions of the property runes etched on one item.
 *
 * `RuneDef.damage` was the only payload a rune could carry, and it is weapon-side — so an ARMOUR
 * property rune could never do anything mechanical, and both of the ones that ship were bare
 * registrations. This is the one place that resolves them, so every reader sees the same list.
 */
export function propertyRuneDefs(inv: InventoryItem | undefined, db: ContentDatabase): RuneDef[] {
  const ids = (inv?.runes as ArmorRunes | WeaponRunes | undefined)?.property ?? [];
  return ids.map((id) => db.runes?.[id]).filter((r): r is RuneDef => !!r);
}

/** 'holy', 'unholy', or null. Recorded as the deity's `sanctification` effect choice. */
export function sanctificationOf(c: Character): 'holy' | 'unholy' | null {
  const label = (c.effectPicks ?? []).find((p) => p.choiceId === 'sanctification')?.label?.toLowerCase();
  return label === 'holy' || label === 'unholy' ? label : null;
}

/**
 * A choice's options PLUS anything another record the character owns adds to them.
 *
 * "Add the astral and brilliant property runes to the list of effects you can choose from." Nothing
 * let one record reach into another's `choice.options`, so a feat whose entire content was widening a
 * menu could be taken and the menu stayed the same size — the player read the new runes in the feat's
 * text and could not pick one.
 *
 * Deduped by value, so taking two widening feats that overlap does not list a rune twice.
 */
export function effectiveChoiceOptions(
  recordId: string,
  def: FeatChoiceDef,
  c: Character,
  db: ContentDatabase,
): NonNullable<FeatChoiceDef['options']> {
  const base = def.options ?? [];
  const sources: DefenseGrants[] = [];
  for (const f of c.feats ?? []) if (db.feats[f.featId]) sources.push(db.feats[f.featId]);
  for (const fid of ownedFeatureIds(c, db)) if (db.classFeatures[fid]) sources.push(db.classFeatures[fid]);
  sources.push(...heritageRecords(c, db));

  const extra: NonNullable<FeatChoiceDef['options']> = [];
  const sanct = sanctificationOf(c);
  for (const src of sources) {
    for (const a of src.choiceOptionAdditions ?? []) {
      if (a.target !== recordId) continue;
      if (a.flag && a.flag !== def.flag) continue;
      extra.push(...(a.add ?? []));
      for (const s of a.addIfSanctified ?? []) if (s.sanctification === sanct) extra.push({ value: s.value, label: s.label });
    }
  }
  if (!extra.length) return base;
  const seen = new Set(base.map((o) => o.value));
  return [...base, ...extra.filter((o) => !seen.has(o.value) && seen.add(o.value))];
}

/**
 * What THIS MORNING's answers grant.
 *
 * Until now a daily choice was recorded and nothing more: the Rest sheet collected the answer and no
 * sheet number moved, so "habituate your skin against this type of injury" was a note. An answer
 * grants only while it is the stored one, so tomorrow's pick replaces today's rather than stacking.
 *
 * Reads the choice DEFINITIONS rather than the raw store, so an answer left behind by a record the
 * character no longer owns grants nothing.
 */
const RANK_ORDER = ['untrained', 'trained', 'expert', 'master', 'legendary'] as const;

/** Whether a character meets an option's skill-rank gate. No gate ⇒ always offered. */
export function qualifiesForOption(
  c: Character,
  gate: { skill: ProficiencyKey; min?: ProficiencyRank; max?: ProficiencyRank } | undefined,
): boolean {
  if (!gate) return true;
  const at = RANK_ORDER.indexOf((c.proficiencies.skills[gate.skill] ?? 'untrained') as (typeof RANK_ORDER)[number]);
  if (gate.min && at < RANK_ORDER.indexOf(gate.min)) return false;
  if (gate.max && at > RANK_ORDER.indexOf(gate.max)) return false;
  return true;
}

/** The best rank this morning's answers give a skill, or undefined when they give none. Never lowers:
 *  a granted rank only counts when it beats what the character already has. */
export function dailySkillRank(c: Character, db: ContentDatabase | undefined, key: ProficiencyKey): ProficiencyRank | undefined {
  if (!db || !c.dailyChoices) return undefined;
  const own = c.proficiencies.skills[key] ?? 'untrained';
  let best: ProficiencyRank | undefined;
  for (const g of dailyChoiceGrants(c, db)) {
    const r = g.skills?.[key];
    if (r && RANK_ORDER.indexOf(r) > RANK_ORDER.indexOf(best ?? own)) best = r;
  }
  return best;
}

export function dailyChoiceGrants(c: Character, db: ContentDatabase): EffectGrant[] {
  const stored = c.dailyChoices;
  if (!stored) return [];
  const out: EffectGrant[] = [];
  for (const rec of ownedDailyChoiceRecords(c, db)) {
    const def = rec.choice;
    if (!def?.daily) continue;
    const answer = stored[dailyChoiceKey(rec.id, def.flag)];
    // An OPEN spell pick made this morning becomes a real casting. Loaner Spell borrows a spell from
    // an ally and can cast it once that day; without this the answer was recorded and nothing else,
    // because only fixed `options` carried grants.
    if (def.kind === 'open' && def.from?.type === 'spell' && def.from.grantInnate && answer && db.spells[answer]) {
      const g = def.from.grantInnate;
      out.push({ innateSpells: [{ spellId: answer, usesPerDay: g.usesPerDay ?? 1 }] });
      continue;
    }
    const opt = (def.options ?? []).find((o) => o.value === answer);
    // An answer whose gate no longer holds grants nothing. A Haunting Memories pick made while a skill
    // was untrained has to stop applying once training arrives from somewhere else, or this morning's
    // answer outlives the condition it was chosen under.
    if (opt?.grant && qualifiesForOption(c, opt.requiresSkillRank)) out.push(opt.grant);
  }
  return out;
}

/**
 * The multiple attack penalty for a Strike: 5, or 4 with agile, unless a feat lowers it.
 *
 * The two steps were hardcoded at both strike call sites, so Agile Grace ("–3 and –6 rather than –4
 * and –8") and the ranger's Flurry printed a number the sheet never showed. A state-gated reduction
 * only counts while that toggle is on — Flurry applies against your hunted prey and nothing else.
 */
export function mapStepFor(c: Character, db: ContentDatabase, traits: string[]): number {
  const agile = traits.includes('agile');
  let step = agile ? 4 : 5;
  const on = (state?: string) => !state || (c.classResources?.[state] ?? 0) > 0;
  const consider = (g: DefenseGrants | undefined) => {
    const r = g?.mapReduction;
    if (!r || !on(r.whileState)) return;
    const candidate = agile ? r.agileStep : r.step;
    if (candidate != null && candidate < step) step = candidate;
  };
  for (const f of c.feats ?? []) consider(db.feats[f.featId]);
  for (const fid of ownedFeatureIds(c, db)) consider(db.classFeatures[fid]);
  return step;
}

export function deriveAc(c: Character, db: ContentDatabase): AcResult {
  const worn = findWornArmor(c, db);

  let category: ArmorCategory = 'unarmored';
  let dexCap: number | null = null;
  let armorBase = 0; // the armor's inherent AC — untyped, always applies
  let acItem = 0; // item-type bonus (potency rune / Monster-Parts refine) — item bonuses don't stack

  if (worn) {
    // profCategory, not armor.category — Heavy Construction reads the medium track for a heavy suit.
    category = worn.profCategory;
    dexCap = worn.armor.dexCap ?? null;
    // ABP defense potency replaces the armor potency rune's numeric bonus. A Monster-Parts refined
    // armor (Table 4B) supplies an AC item bonus in place of the potency rune (which it ignores).
    const refAc = mpActive(c, worn.inv) ? mpArmorRefine(worn.inv.monsterPart, c.level).ac : 0;
    // Guard against a data-incomplete armor (missing acBonus) corrupting AC into NaN.
    armorBase = worn.armor.acBonus ?? 0;
    // Battleforger's temporary +1 potency is an ITEM bonus like any other, so it takes the highest
    // rather than adding — which is also exactly the feat's own "no effect if it already had a
    // potency rune".
    const bfAc = worn.inv.battleforged ? 1 : 0;
    // A PROPERTY rune that "functions as a +1 armor potency rune" (Adamantine Echo). It occupies a
    // property slot, not the potency slot — so it cannot be recorded as a potency rune — but it must
    // deliver the same item bonus, and like every other source here it takes the highest.
    const actsAsPotency = Math.max(
      0,
      ...propertyRuneDefs(worn.inv, db)
        .filter((r) => r.actsAs?.kind === 'potency')
        .map((r) => r.actsAs!.value),
    );
    acItem = abpOn(c) ? 0 : Math.max((worn.inv.runes as ArmorRunes | undefined)?.potency ?? 0, refAc, bfAc, actsAsPotency);
  }
  // A passive AC item (Bracers of Armor), Monster Parts, and ABP defense potency are all ITEM bonuses to
  // AC — they don't stack with each other or the armor potency rune, so take the highest.
  acItem = Math.max(acItem, passiveItemBonus(c, db, 'ac'), abpOn(c) ? abpDefense(c.level) : 0);

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
  // Everything typed pools by type across sources, so Mountain Stance's +4 ITEM bonus doesn't stack with
  // armor potency, and a shield's circumstance bonus doesn't stack with a circumstance penalty of its own.
  const pooled = poolTypedMods([
    { type: 'item', value: acItem },
    ...(stance?.acBonus ? [{ type: stance.acBonus.type as TypedMod['type'], value: stance.acBonus.value }] : []),
    ...conditionTypedMods(c.conditions, 'dex', 'ac'),
    ...modeTypedMods(shieldSwappedModes(c, db), { kind: 'ac' }),
  ]);
  return { value: 10 + dexContribution + profBonus(rank, c.level, pwl(c)) + armorBase + pooled, rank, dexCap: effDexCap };
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
  // A record can supply the tier from the CHARACTER instead of an etched rune — Blessed Shield: "In
  // your hands, a shield gains the minor Reinforcing rune… the reinforcing rune of your level." The
  // tier could only ever come from `inv.runes`, so the champion's shield gained nothing. Folded into
  // the same max() below, so an actually-etched better rune still wins.
  const byLevel = mpActive(c, held.inv) ? undefined : levelReinforcingTier(c, db);
  const r = REINFORCING[Math.max(rein ?? 0, byLevel ?? 0)];
  const ref = mpActive(c, held.inv) ? mpShieldRefine(held.inv.monsterPart, c.level) : null;
  // Guard every shield stat against a data-incomplete item (missing hardness/hp/BT/acBonus) so the
  // shield block — and the AC breakdown that reads it — can never compute NaN.
  let hardness = Math.max(s.hardness ?? 0, r?.hardness ?? 0, ref?.hardness ?? 0);
  const hp = Math.max(s.hp ?? 0, r?.hp ?? 0, ref?.hp ?? 0);
  const brokenThreshold = Math.max(s.brokenThreshold ?? 0, r?.bt ?? 0, ref?.bt ?? 0);
  // "If your shield already has the appropriate reinforcing rune for your level, or if it's a Sturdy
  // Shield of the same level, the shield's Hardness INSTEAD increases by 1." Exclusive with the tier
  // above: the +1 applies only when the shield already meets every number that tier would have set,
  // so a blessing can never both raise the floor and add the bonus.
  const lvlTier = byLevel ? REINFORCING[byLevel] : undefined;
  if (
    lvlTier &&
    (s.hardness ?? 0) >= lvlTier.hardness &&
    (s.hp ?? 0) >= lvlTier.hp &&
    (s.brokenThreshold ?? 0) >= lvlTier.bt
  ) {
    hardness += 1;
  }
  const current = Math.max(0, hp - Math.max(0, c.shieldDamage ?? 0));
  return { name: s.name, ac: s.acBonus ?? 0, hardness, hp, brokenThreshold, current, broken: current <= brokenThreshold };
}

/**
 * The reinforcing tier a RECORD gives the character's held shield, from their level.
 *
 * "the reinforcing rune of your level (lesser at 7th, moderate at 10th, greater at 13th, major at
 * 16th, and supreme at 19th)" — the printed table, and the same one for any record that says this.
 */
function levelReinforcingTier(c: Character, db: ContentDatabase): number | undefined {
  const grants =
    (c.feats ?? []).some((f) => db.feats[f.featId]?.shieldReinforcingByLevel) ||
    [...ownedFeatureIds(c, db)].some((id) => db.classFeatures[id]?.shieldReinforcingByLevel);
  if (!grants) return undefined;
  return c.level >= 19 ? 6 : c.level >= 16 ? 5 : c.level >= 13 ? 4 : c.level >= 10 ? 3 : c.level >= 7 ? 2 : 1;
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

/** One thing that contributed a resistance / weakness / immunity, and what it offered.
 *
 *  `value` is the resolved number this source alone would give. Same-type resistances DO NOT stack in
 *  Pathfinder 2e — the highest applies — so a source whose value lost to a bigger one is kept here
 *  with `applied: false`. That is the whole point of the breakdown: a player looking at "Fire 5"
 *  needs to see that their ring offers 2 and is doing nothing, so unequipping the cloak matters. */
export interface DefenseSource {
  /** Human label — the feat, item, heritage or stance that granted it. */
  from: string;
  value?: number;
  /** False when a same-type source with a higher value supersedes this one. */
  applied: boolean;
  /** Set when the grant only applies sometimes ("while raging") — rendered as a `*`. */
  condition?: string;
}

export interface CharacterDefenses {
  /** Senses (raw selectors, e.g. "darkvision", "scent"), including ancestry vision. */
  senses: SenseEntry[];
  resistances: { type: string; value: number }[];
  weaknesses: { type: string; value: number }[];
  immunities: string[];
  /** Void (negative) healing — healed by void energy, harmed by vitality (dhampir & co.). */
  negativeHealing?: boolean;
  /** "You can breathe underwater" — from a graft, a heritage, a feat or an invested item. */
  breathesWater?: boolean;
  /** Where each entry came from, keyed `"resistance:fire"` / `"weakness:cold"` / `"immunity:disease"`.
   *  Additive: absent means "not computed", never "no sources". */
  sources?: Record<string, DefenseSource[]>;
}

const ACUITY_ORDER: Record<string, number> = { precise: 3, imprecise: 2, vague: 1 };

/** The values a data formula may reference. `level` is always available; the rest come from the
 *  character when one is in hand (ability modifiers, the character's own Speeds). */
export interface FormulaScope {
  level: number;
  abilities?: AbilityScores;
  speeds?: Speeds;
}

/** Substitute the supported `@actor.…` tokens for their numbers. Unknown tokens are left alone so
 *  the caller's parse fails and the value resolves to 0 rather than to a wrong number. */
function substituteTokens(v: string, scope: FormulaScope): string {
  let out = v.replace(/@actor\.level/g, String(scope.level));
  if (scope.abilities) {
    // "@actor.abilities.cha.mod" (Foundry-style) and the shorter "@actor.cha.mod".
    out = out.replace(/@actor\.(?:abilities\.)?(str|dex|con|int|wis|cha)\.mod/g, (_m, a: keyof AbilityScores) =>
      String(abilityMod(scope.abilities![a])),
    );
  }
  if (scope.speeds) {
    out = out.replace(/@actor\.speeds?\.(land|fly|swim|climb|burrow)/g, (_m, k: keyof Speeds) => String(scope.speeds![k] ?? 0));
  }
  return out;
}

/** Resolve a data formula (resistance/weakness value, granted Speed, …) that may be a number or a
 *  formula string. CSP-safe — no eval: tokens are substituted, then a small arithmetic grammar is
 *  parsed (floor/ceil/max/min, + - * /). Anything unrecognized resolves to 0 so a wrong number is
 *  never shown. Formulas may reference @actor.level, ability mods, and the character's own Speeds. */
export function resolveFormula(value: number | string, scope: FormulaScope): number {
  if (typeof value === 'number') return Math.max(0, Math.round(value));
  const substituted = substituteTokens(String(value).trim(), scope);
  // Any @actor token we don't support survived substitution → refuse rather than guess.
  if (substituted.includes('@')) return 0;

  // Recursive-descent over: max/min/floor/ceil(...), numbers, + - * /, parentheses.
  let i = 0;
  const s = substituted.replace(/\s+/g, '');
  const fail = Symbol('fail');
  type R = number | typeof fail;
  const expr = (): R => {
    let left = term();
    if (left === fail) return fail;
    while (s[i] === '+' || s[i] === '-') {
      const op = s[i++];
      const right = term();
      if (right === fail) return fail;
      left = op === '+' ? (left as number) + right : (left as number) - right;
    }
    return left;
  };
  const term = (): R => {
    let left = factor();
    if (left === fail) return fail;
    while (s[i] === '*' || s[i] === '/') {
      const op = s[i++];
      const right = factor();
      if (right === fail) return fail;
      if (op === '/' && right === 0) return fail;
      left = op === '*' ? (left as number) * right : (left as number) / right;
    }
    return left;
  };
  const factor = (): R => {
    const fn = s.slice(i).match(/^(floor|ceil|max|min)\(/);
    if (fn) {
      i += fn[1].length + 1;
      const args: number[] = [];
      for (;;) {
        const a = expr();
        if (a === fail) return fail;
        args.push(a);
        if (s[i] === ',') { i++; continue; }
        break;
      }
      if (s[i] !== ')') return fail;
      i++;
      if (fn[1] === 'floor') return Math.floor(args[0]);
      if (fn[1] === 'ceil') return Math.ceil(args[0]);
      return fn[1] === 'max' ? Math.max(...args) : Math.min(...args);
    }
    if (s[i] === '(') {
      i++;
      const v = expr();
      if (v === fail || s[i] !== ')') return fail;
      i++;
      return v;
    }
    const num = s.slice(i).match(/^-?\d+(?:\.\d+)?/);
    if (!num) return fail;
    i += num[0].length;
    return Number(num[0]);
  };
  const result = expr();
  if (result === fail || i !== s.length || !Number.isFinite(result)) return 0;
  return Math.max(0, Math.round(result as number));
}

/** Back-compat wrapper: resolve an IWR value with only the level in scope. */
export function resolveIwrValue(value: number | string, level: number): number {
  return resolveFormula(value, { level });
}

/** The HALF-LEVEL sub-expression every scaling resistance formula is written with. Enhanced
 *  Resistance replaces exactly this, so `3+floor(@actor.level/2)` keeps its flat +3 and
 *  `max(1,floor(@actor.level/2))` keeps its floor of 1. */
const HALF_LEVEL = /floor\(\s*@actor\.level\s*\/\s*2\s*\)/g;

/** The initial armor modification whose resistance counts the FULL level, or undefined.
 *
 *  Gated on an ARMOR innovation because the feat says "your initial armor modification" — a weapon
 *  innovation has no such modification to improve. The record is found through ownedFeatureIds
 *  rather than `modifications.breakthrough` so any future path that grants it still counts. */
function fullLevelResistanceTarget(c: Character, db: ContentDatabase, owned: Iterable<string>): string | undefined {
  if (c.inventor?.innovationType !== 'armor') return undefined;
  let upgrades = false;
  for (const id of owned) {
    if (db.classFeatures[id]?.resistanceLevelUpgrade === 'inventor-initial') {
      upgrades = true;
      break;
    }
  }
  if (!upgrades) return undefined;

  const mods = c.inventor.modifications ?? {};
  // An "initial modification" is one of INITIAL TIER — INVENTOR_TIER_LEVEL.initial, i.e. level 1 —
  // not merely the one sitting in the initial slot.
  const qualifies = (id: string | undefined) => {
    const rec = id ? db.classFeatures[id] : undefined;
    return !!rec && rec.level === 1 && !!rec.resistances?.length;
  };
  if (qualifies(mods.initial)) return mods.initial;
  // "If you have more than one initial modification that gives resistance, choose which one this
  // applies to." inventorModificationOptions admits a level-1 modification into the breakthrough and
  // revolutionary slots (it filters `level <= tierLevel`), so an inventor really can hold several.
  // With no picker for that choice, the later slots are a deterministic fallback — which only ever
  // decides anything when the initial slot itself grants no resistance.
  for (const id of [mods.breakthrough, mods.revolutionary]) if (qualifies(id)) return id;
  return undefined;
}

/** Rewrite a record's half-level resistances to count the full level, keeping everything else
 *  (including the record's own name, so the breakdown still reads "Phlogistonic Regulator"). */
function withFullLevelResistance(rec: ClassFeature): ClassFeature {
  if (!rec.resistances?.length) return rec;
  return {
    ...rec,
    // .replace() only — never .test(), which is stateful on a /g regex and would alternate.
    // A formula without the half-level term is simply returned unchanged.
    resistances: rec.resistances.map((r) =>
      typeof r.value === 'string' ? { ...r, value: r.value.replace(HALF_LEVEL, '@actor.level') } : r,
    ),
  };
}

/**
 * How many property runes an item can hold.
 *
 * Normally the potency value, capped at 3. The inventor's Rune Capacity raises it by one — for the
 * DESIGNATED innovation only, which is the whole difficulty: the cap lives in a shared clamp, and
 * raising that clamp would hand a fourth slot to every weapon in the game.
 *
 * A property rune still requires a potency rune, so the bonus never conjures the first slot; that
 * base requirement is what the "needs a potency rune first" message already enforces.
 */
export function propertyRuneCapacity(
  c: Character | undefined,
  hostInv: InventoryItem | undefined,
  db: ContentDatabase,
  /** Potency to size against — pass the NEW value when planning a potency change, whose capacity is
   *  not the one the item has now. Defaults to the host's current potency rune. */
  potency: number = ((hostInv?.runes ?? {}) as WeaponRunes & ArmorRunes).potency ?? 0,
): number {
  if (potency <= 0) return 0;
  let cap = Math.min(potency, 3);
  if (!c) return cap;
  const designations = hostInv?.designations ?? [];
  for (const id of ownedFeatureIds(c, db)) {
    const b = db.classFeatures[id]?.propertyRuneBonus;
    if (b && designations.includes(b.designated)) cap = Math.min(cap + b.bonus, b.max);
  }
  return cap;
}

/** Aggregate the character's innate senses + IWR from ancestry vision, heritage,
 *  selected feats, and auto-granted class features (by level). Resistances/weaknesses
 *  of the same type don't stack — the highest value wins. Conditional (predicated) and
 *  choice-based grants aren't parsed at import, so they don't appear here. */
export function deriveDefenses(c: Character, db: ContentDatabase): CharacterDefenses {
  // Each source carries the NAME of what granted it, so the sheet can answer "where is my Fire 2
  // coming from?" — the same question every other stat's breakdown already answers.
  const sources: (DefenseGrants & { __from?: string; __cond?: string })[] = [];
  const push = (from: string, g: DefenseGrants | undefined, cond?: string) => {
    if (g) sources.push({ ...g, __from: from, __cond: cond });
  };
  for (const h of heritageRecords(c, db)) push(h.name ?? 'Heritage', h);
  // The ANCESTRY's own IWR. This source was missing entirely — the ancestry was read for `vision` and
  // nothing else — so the poppet's Flammable ("weakness to fire equal to one-third your level") had
  // nowhere to live, and Sealed Poppet had nothing to remove.
  //
  // Only the IWR fields: an ancestry also carries `senses` and `speeds`, which deriveSpeeds and the
  // vision path already consume, and pushing the whole record would count those twice.
  if (c.ancestryId && db.ancestries[c.ancestryId]) {
    const a = db.ancestries[c.ancestryId];
    push(a.name ?? 'Ancestry', { resistances: a.resistances, weaknesses: a.weaknesses, immunities: a.immunities });
  }
  for (const f of c.feats) {
    const feat = db.feats[f.featId];
    if (feat) push(feat.name ?? f.featId, feat);
  }
  const cls = c.classId ? db.classes[c.classId] : undefined;
  // A class archetype can REMOVE class features and substitute its own — honor both here so the
  // sheet's defenses match the class as the archetype rebuilt it.
  const suppressed = new Set(c.classArchetype?.suppressedFeatures ?? []);
  if (cls) {
    // Via ownedFeatureIds, not cls.features, so subclass VARIANTS come too — the toxicologist's
    // poison resistance lives on `field-discovery-toxicologist` while the class only lists the
    // generic `field-discovery`. Suppression is keyed by the generic id, so a suppressed feature
    // takes its variant with it.
    const sub = c.subclassId ? `-${c.subclassId}` : null;
    const owned = ownedFeatureIds(c, db);
    // Enhanced Resistance improves the INITIAL modification's formula, so the upgrade is applied to
    // that record as it is pushed — keeping its own name in the breakdown, where the player expects
    // to read "Phlogistonic Regulator", not "Enhanced Resistance".
    const fullLevelRes = fullLevelResistanceTarget(c, db, owned);
    for (const id of owned) {
      const base = sub && id.endsWith(sub) ? id.slice(0, -sub.length) : id;
      if (suppressed.has(id) || suppressed.has(base)) continue;
      const rec = db.classFeatures[id];
      if (rec) push(rec.name ?? id, id === fullLevelRes ? withFullLevelResistance(rec) : rec);
    }
  }
  for (const af of c.classArchetype?.addedFeatures ?? []) {
    if (af.level <= c.level && db.classFeatures[af.featureId]) push(db.classFeatures[af.featureId].name ?? af.featureId, db.classFeatures[af.featureId]);
  }
  // Worn/invested items with passive senses/resistances/immunities (Goggles of Night pattern) count as
  // grant sources too — the generic magic-item lane.
  for (const inv of c.inventory) {
    if (!(inv.worn || inv.invested || inv.equipped)) continue;
    for (const pe of [db.items[inv.itemId]?.passiveEffects, c.resolvedItemPassives?.[inv.itemId]]) {
      if (pe && (pe.senses || pe.resistances || pe.immunities || pe.weaknesses)) {
        push(db.items[inv.itemId]?.name ?? inv.itemId, {
          senses: pe.senses,
          resistances: pe.resistances,
          // A cursed item can impose one (Demon's Knot). Was not read here, so it had no home at all.
          weaknesses: pe.weaknesses,
          immunities: pe.immunities,
        });
      }
    }
  }
  // The ACTIVE stance / form: its typed resistances (Rain of Embers: fire = half level) and senses (an
  // ursine form's low-light + scent) apply only while it's the active one.
  const activeStance = activeStanceDef(c, db);
  if (activeStance?.resistances?.length) push(activeStance.name ?? 'Stance', { resistances: activeStance.resistances }, 'while this stance is active');
  if (activeStance?.senses?.length) push(activeStance.name ?? 'Stance', { senses: activeStance.senses }, 'while this stance is active');
  // "While raging / while you have panache …" conditional grants (Raging Resistance), gated on the
  // character's live resource toggle. Owned feats/features contribute only while the state is on.
  for (const wa of activeStateGrants(c, db)) {
    // `weaknesses` too: Ligneous Instinct's bark-like flesh resists piercing and slashing AND takes
    // fire weakness from the same clause. Dropping the cost would have made the instinct strictly
    // better than the text.
    push(
      (wa as { name?: string }).name ?? 'Active state',
      { resistances: wa.resistances, weaknesses: wa.weaknesses, senses: wa.senses, immunities: wa.immunities },
      'only while that state is active',
    );
  }
  // Senses a rider feat grants only in this form (Senses of the Bear → Ursine Avenger Form).
  const rider = activeStance?.senseIfFeat;
  if (rider && c.feats.some((f) => f.featId === rider.feat)) {
    const ancVision = String((c.ancestryId && db.ancestries[c.ancestryId]?.vision) || 'normal');
    const hasLowLight = /low-light|darkvision/.test(ancVision) || sources.some((s) => (s.senses ?? []).some((x) => /low-light/i.test(x.name)));
    const senses = rider.upgradeDarkvisionIfLowLight && hasLowLight
      ? rider.senses.map((s) => (/low-light/i.test(s.name) ? { ...s, name: 'darkvision' } : s))
      : rider.senses;
    push(db.feats[rider.feat]?.name ?? 'Form sense', { senses });
  }
  // ACTIVE MODES — a drunk potion, a switched-on ability. These are temporary by nature, so the
  // breakdown names the mode and marks it conditional: a player looking at "Fire 5" needs to see
  // which part of it disappears when the effect ends.
  for (const m of c.activeModes ?? []) {
    if (m.resistances?.length || m.weaknesses?.length || m.immunities?.length || m.senses?.length) {
      push(m.name ?? m.id, { resistances: m.resistances, weaknesses: m.weaknesses, immunities: m.immunities, senses: m.senses },
        m.duration ? `while active · ${m.duration}` : 'while active');
    }
  }
  // Resolved "choose one of N" effects (dragon-tattoo resistance type, energy-heart element).
  if (c.chosenEffects) push('Your chosen effect', c.chosenEffects);
  // THIS MORNING's answers. Separate from chosenEffects because they are re-made nightly, and marked
  // as such in the breakdown so a player can tell which resistance they picked today from the ones
  // they picked at character creation.
  for (const g of dailyChoiceGrants(c, db)) {
    push('Daily preparations', { resistances: g.resistances, weaknesses: g.weaknesses, immunities: g.immunities, senses: g.senses }, 'chosen this morning');
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
  // Formulas may reference the character's level and ability modifiers (Wyrmbane Aura's Cha-mod
  // resistance). Speed-relative formulas belong to deriveSpeeds, which knows the resolved Speeds.
  const scope: FormulaScope = { level: c.level, abilities: c.abilities };
  /** Every contributor, kept even when it loses — see DefenseSource. `applied` is decided at the end,
   *  once the winning value per type is known. */
  const attribution = new Map<string, DefenseSource[]>();
  const note = (key: string, from: string | undefined, value: number | undefined, condition?: string) => {
    if (!from) return;
    const list = attribution.get(key) ?? [];
    list.push({ from, value, applied: true, condition });
    attribution.set(key, list);
  };
  for (const src of sources) {
    for (const s of src.senses ?? []) addSense(s);
    for (const r of src.resistances ?? []) {
      const v = resolveFormula(r.value, scope);
      if (v > 0) {
        res.set(r.type, Math.max(res.get(r.type) ?? 0, v));
        note(`resistance:${r.type}`, src.__from, v, src.__cond);
      }
    }
    for (const w of src.weaknesses ?? []) {
      const v = resolveFormula(w.value, scope);
      if (v > 0) {
        weak.set(w.type, Math.max(weak.get(w.type) ?? 0, v));
        note(`weakness:${w.type}`, src.__from, v, src.__cond);
      }
    }
    for (const t of src.immunities ?? []) {
      imm.add(t);
      note(`immunity:${t}`, src.__from, undefined, src.__cond);
    }
  }

  // Monster Parts: worn/invested/wielded items grant resistances (Energy Resistant, value = the
  // property's level) and passive senses (Sensory). Same-type resistances don't stack — highest wins.
  for (const inv of c.inventory) {
    if (!mpActive(c, inv) || !(inv.worn || inv.invested || inv.equipped)) continue;
    const grants = mpDefenseGrants(inv.monsterPart, c.level);
    for (const g of grants.resistances) res.set(g.type, Math.max(res.get(g.type) ?? 0, g.value));
    for (const sense of grants.senses) addSense({ name: sense });
  }

  // ARMOR SPECIALIZATION (Player Core pg. 272). Computed here as a plain number rather than through a
  // record formula: the value is `base + the WORN ARMOR's potency rune`, which FormulaScope cannot
  // reach — and an unknown @token resolves to 0 silently, so a data formula would have looked correct
  // and granted nothing. Placed with the other computed resistances so it competes under the
  // no-stacking rule and shows up in the breakdown like every other source.
  {
    const worn = findWornArmor(c, db);
    const access = armorSpecAccess(c, db);
    if (worn && (access.categories.has(worn.armor.category) || access.items.has(worn.inv.itemId))) {
      const eff = armorSpecEffect(worn.armor.group);
      // ABP replaces the potency rune's numeric value, exactly as deriveAc does.
      const potency = abpOn(c) ? abpDefense(c.level) : ((worn.inv.runes as ArmorRunes | undefined)?.potency ?? 0);
      // A worn item can raise the value for its group (Reinforced Surcoat: chain +2).
      let itemBonus = 0;
      for (const inv of c.inventory) {
        if (!(inv.worn || inv.invested || inv.equipped)) continue;
        const b = db.items[inv.itemId]?.armorSpecBonus;
        if (b && (!b.group || b.group === worn.armor.group)) itemBonus += b.value;
      }
      const value = armorSpecValue(worn.armor.group, worn.armor.category, potency) + access.bonus + itemBonus;
      // 'reactive' (wood) damages the ATTACKER — it is not a defence, so it grants no resistance.
      if (value > 0 && eff && eff.kind !== 'reactive' && eff.type) {
        // Highhelm Stronghold Plate: "your resistance applies to both slashing and piercing damage".
        for (const type of [eff.type, ...(worn.armor.armorSpecExtraTypes ?? [])]) {
          res.set(type, Math.max(res.get(type) ?? 0, value));
          note(`resistance:${type}`, `${worn.armor.name} (armor specialization)`, value, eff.note);
        }
      }
    }
  }

  const heritage = c.heritageId ? db.heritages[c.heritageId] : undefined;
  // Nephilim-type heritages grant low-light vision, UPGRADED to darkvision if the ancestry already gives
  // low-light (or darkvision). The plain low-light Sense is imported normally; add darkvision when it upgrades.
  if (heritage?.darkvisionIfAncestryLowLight) {
    // The Vision type says 'low-light' but the data uses 'low-light-vision' — accept either, plus darkvision.
    const ancestryVision = String((c.ancestryId && db.ancestries[c.ancestryId]?.vision) || 'normal');
    if (/low-light|darkvision/.test(ancestryVision)) addSense({ name: 'darkvision' });
  }
  // General "you gain X — or Y if you already have X" sense grants (Superior Sight, Ember's Eyes).
  // Evaluated against senses gathered so far PLUS the ancestry's own vision, so "already have" means
  // from any source, not just the ancestry.
  {
    const ancestryVision = String((c.ancestryId && db.ancestries[c.ancestryId]?.vision) || 'normal');
    const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, '-').replace(/-vision$/, '');
    const has = (name: string) => {
      const n = norm(name);
      return norm(ancestryVision) === n || [...senses.keys()].some((k) => norm(k) === n);
    };
    for (const src of sources) {
      for (const cs of src.conditionalSenses ?? []) addSense(has(cs.ifPresent) ? cs.upgraded : cs.base);
    }
  }
  // Choice-resistance heritage (Deep Fetchling: cold/void; Elementheart Kobold: an element's type): the
  // player's chosen damage type, resistance = half level (min 1). Same-type resistances don't stack.
  if (heritage?.choiceResistance && c.heritageResistanceChoice) {
    const v = Math.max(1, Math.floor(c.level / 2));
    res.set(c.heritageResistanceChoice, Math.max(res.get(c.heritageResistanceChoice) ?? 0, v));
  }

  // Pathfinder 2e: same-type resistances (and weaknesses) DO NOT stack — the highest applies. Mark the
  // losers so the breakdown can show "Ring of Fire Resistance 2 — superseded" instead of silently
  // dropping it, which is what makes the list trustworthy when a player unequips something.
  for (const [key, list] of attribution) {
    const kind = key.slice(0, key.indexOf(':'));
    if (kind === 'immunity') continue; // immunities are boolean; nothing to supersede
    const best = Math.max(...list.map((s) => s.value ?? 0));
    for (const s of list) if ((s.value ?? 0) < best) s.applied = false;
  }

  // "You no longer gain silver weakness from Werecreature Dedication." Applied LAST, after every
  // source has contributed, because the point of the feat is to undo one an earlier choice imposed.
  // Every other field adds; nothing could take one away, so the drawback stayed on the sheet.
  for (const fc of c.feats ?? []) {
    for (const t of db.feats[fc.featId]?.removesWeaknesses ?? []) weak.delete(t);
  }

  const sortByType = (a: { type: string }, b: { type: string }) => a.type.localeCompare(b.type);
  return {
    senses: [...senses.values()],
    resistances: [...res].map(([type, value]) => ({ type, value })).sort(sortByType),
    weaknesses: [...weak].map(([type, value]) => ({ type, value })).sort(sortByType),
    immunities: [...imm].sort(),
    sources: Object.fromEntries(attribution),
    negativeHealing:
      !!heritage?.negativeHealing ||
      c.feats.some((f) => db.feats[f.featId]?.negativeHealing) ||
      c.inventory.some((inv) => inv.invested && db.items[inv.itemId]?.negativeHealing),
    // "You can breathe underwater." A permanent capability with no number attached, so it fitted no
    // existing field — not a sense, not a speed, not a resistance — and every record saying it did
    // nothing at all. Aggregated exactly like negativeHealing beside it, invested-only rule included.
    breathesWater:
      heritageRecords(c, db).some((h) => h.breathesWater) ||
      c.feats.some((f) => db.feats[f.featId]?.breathesWater) ||
      [...ownedFeatureIds(c, db)].some((id) => db.classFeatures[id]?.breathesWater) ||
      c.inventory.some((inv) => inv.invested && db.items[inv.itemId]?.breathesWater),
  };
}

const DAMAGE_ABBR: Record<string, string> = {
  bludgeoning: 'B',
  piercing: 'P',
  slashing: 'S',
};

const STRIKING_DICE = { striking: 1, greater: 2, major: 3, mythic: 4 } as const;

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
  if (!die) return die; // flat-damage weapon (no die) — nothing to step
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
  /** THIS attack has its group's critical specialization on its own, from an `unarmedTraits.critSpec`
   *  rider — critSpecWeapons filters by group, trait or base weapon, never by one attack. */
  critSpec?: boolean;
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
  const tier = (s?: WeaponRunes['striking']) => (s === 'mythic' ? 4 : s === 'major' ? 3 : s === 'greater' ? 2 : s === 'striking' ? 1 : 0);
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

/**
 * The invested rune-copying item a character is wearing, if any.
 *
 * Was a hardcoded two-id Set. `copiesRunes` on the item's own passive effects replaces it, so the
 * Blazons of Shared Power — which do exactly the same thing — work without editing this file:
 * 'fundamental' copies potency and striking only, 'all' copies the property runes too and lifts the
 * same-weapon-group restriction, which is what the greater versions print.
 */
function investedRuneCopier(c: Character, db: ContentDatabase): { greater: boolean } | undefined {
  const worn = c.inventory.find((inv) => inv.invested && db.items[inv.itemId]?.passiveEffects?.copiesRunes);
  if (!worn) return undefined;
  return { greater: db.items[worn.itemId]?.passiveEffects?.copiesRunes === 'all' };
}

/** Whether a character can use the Doubling Rings rune-copy right now: rings invested AND at least two
 *  weapons wielded (so there's a source and a target hand). Drives the inventory picker's visibility. */
export function doublingRingsAvailable(c: Character, db: ContentDatabase): boolean {
  if (!investedRuneCopier(c, db)) return false;
  const wielded = c.inventory.filter((inv) => inv.equipped && db.items[inv.itemId]?.itemType === 'weapon' && !isHandwraps(db.items[inv.itemId]));
  return wielded.length >= 2;
}

/** The runes a weapon Strike should actually use — its own, or (with Doubling Rings) the fundamental +
 *  property runes duplicated from another wielded weapon set as its `copyRunesFrom` source. The source's
 *  runes win where higher; the base rings require the two weapons to share a group (greater lifts that). */
export function effectiveWeaponRunes(c: Character, db: ContentDatabase, inv: InventoryItem): WeaponRunes | undefined {
  const own = inv.runes as WeaponRunes | undefined;
  if (!inv.copyRunesFrom) return own;
  const rings = investedRuneCopier(c, db);
  if (!rings) return own;
  const source = c.inventory.find((x) => x.instanceId === inv.copyRunesFrom);
  const srcItem = source && db.items[source.itemId];
  const tgtItem = db.items[inv.itemId];
  // Source must still be a wielded weapon; base rings also require the same weapon group.
  if (!source?.equipped || srcItem?.itemType !== 'weapon' || mpActive(c, source)) return own;
  const grp = (it: Item | undefined) => (it?.itemType === 'weapon' ? it.group : undefined);
  if (!rings.greater && grp(srcItem) && grp(tgtItem) && grp(srcItem) !== grp(tgtItem)) return own;
  const src = source.runes as WeaponRunes | undefined;
  if (!src) return own;
  const tier = (s?: WeaponRunes['striking']) => (s === 'mythic' ? 4 : s === 'major' ? 3 : s === 'greater' ? 2 : s === 'striking' ? 1 : 0);
  const strikingOf = (n: number): WeaponRunes['striking'] | undefined => (n >= 4 ? 'mythic' : n >= 3 ? 'major' : n >= 2 ? 'greater' : n >= 1 ? 'striking' : undefined);
  return {
    potency: (Math.max(own?.potency ?? 0, src.potency ?? 0) || undefined) as WeaponRunes['potency'],
    striking: strikingOf(Math.max(tier(own?.striking), tier(src.striking))),
    property: [...new Set([...(own?.property ?? []), ...(src.property ?? [])])],
  };
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
/**
 * The class features a character holds by virtue of their CLASS — auto-granted ones at or below their
 * level, the `<featureId>-<subclassId>` variants of those, the subclass option itself, and whatever
 * the subclass hands over.
 *
 * Exists as its own function because buildCharacter needs the same answer before a Character exists,
 * and because the two were already out of step: the registries in featGrantsAuto.ts and
 * featFeatGrants.ts are iterated over taken FEATS only, so 32 entries authored against class-feature
 * ids — `expert-overdrive` and `legendary-overdrive` among them — had never once fired.
 */
export function classFeatureIdsOwned(
  opts: { classId?: string | null; subclassId?: string | null; level: number; classChoices?: readonly { id?: string; level: number }[] },
  db: ContentDatabase,
): Set<string> {
  const cls = opts.classId ? db.classes[opts.classId] : undefined;
  const out = new Set<string>();
  if (cls) {
    for (const f of cls.features) {
      if (f.level > opts.level) continue;
      out.add(f.featureId);
      // A CLASS-suffixed variant of a shared feature — the swashbuckler's own Weapon Expertise
      // (which carries critSpec), each spontaneous caster's own Spell Repertoire. Only the
      // SUBCLASS suffix was tried, and a swashbuckler's subclass is a style, so six records
      // existed, carried mechanics, and were reachable by nothing.
      const byClass = `${f.featureId}-${cls.id}`;
      if (db.classFeatures[byClass]) out.add(byClass);
    }
  }
  if (cls && opts.subclassId) {
    for (const f of cls.features) {
      if (f.level > opts.level) continue;
      const variant = `${f.featureId}-${opts.subclassId}`;
      if (db.classFeatures[variant]) out.add(variant);
    }
    if (db.classFeatures[opts.subclassId]) out.add(opts.subclassId);
    const opt = cls.subclass?.options.find((o) => o.id === opts.subclassId);
    for (const id of subclassFeatureIds(opt?.featureIds, opts.level)) if (db.classFeatures[id]) out.add(id);
  }
  for (const cc of opts.classChoices ?? []) {
    if (cc.id && cc.level <= opts.level && db.classFeatures[cc.id]) out.add(cc.id);
  }
  return out;
}

export function ownedFeatureIds(c: Character, db: ContentDatabase): Set<string> {
  const cls = c.classId ? db.classes[c.classId] : undefined;
  const out = new Set<string>();
  if (cls) {
    for (const f of cls.features) {
      if (f.level > c.level) continue;
      out.add(f.featureId);
      // A CLASS-suffixed variant, the sibling of the subclass rule below: the swashbuckler's own
      // Weapon Expertise carries critSpec, each spontaneous caster has its own Spell Repertoire.
      // A swashbuckler's subclass is a style, so the subclass suffix never reached these.
      const byClass = `${f.featureId}-${cls.id}`;
      if (db.classFeatures[byClass]) out.add(byClass);
    }
  }
  // Subclass VARIANTS of a listed feature are stored as `<featureId>-<subclassId>` and are not in
  // cls.features — the class lists the generic prose record (`field-discovery`), and the variant
  // (`field-discovery-toxicologist`) carries the actual mechanics. `critSpecSources` already reached
  // them by suffix for its own purpose; doing it here makes them owned like any other feature, which
  // is what the toxicologist's poison resistance was missing. Only variants of a feature the class
  // ACTUALLY grants, at or below its level, so a subclass can't smuggle in a feature its class lacks.
  if (cls && c.subclassId) {
    const suffix = `-${c.subclassId}`;
    for (const f of cls.features) {
      if (f.level > c.level) continue;
      const variant = `${f.featureId}${suffix}`;
      if (db.classFeatures[variant]) out.add(variant);
    }
  }
  // Extra-choice PICKS (thaumaturge implements, exemplar ikons and epithets, kineticist elements,
  // wizard theses, animist apparitions, psychic subconscious minds) are class features you chose
  // rather than were handed. Every current option id is also a classFeature id, and the option shape
  // can't carry defenses/limitedUses/critSpec/effectChoices — so without this the record's mechanics
  // and its situational bonuses were stored, displayed in the picker, and then ignored.
  for (const cc of c.classChoices ?? []) {
    if (cc.id && cc.level <= c.level && db.classFeatures[cc.id]) out.add(cc.id);
  }
  // The inventor's chosen INNOVATION MODIFICATIONS are class features too — every one of the 26 weapon
  // modifications is a classFeatures record with its own mechanics. They are stored on c.inventor
  // rather than in classChoices, so without this the chosen modification was recorded, shown in the
  // builder, and then ignored by everything that reads owned features: its situational bonuses never
  // fired and a mode gated on it could never appear. Segmented Frame's +2 Stealth is the case that
  // surfaced it.
  for (const id of Object.values(c.inventor?.modifications ?? {})) {
    if (typeof id === 'string' && db.classFeatures[id]) out.add(id);
  }
  // "You gain the Sneak Attack class feature." A record handing over a CLASS FEATURE rather than a
  // feat — the archetype route into another class's signature ability. `grantsFeats` could not say it
  // (the target is not a feat) and nothing else wrote in here, so 14 records said this and delivered
  // none of it. Resolved LAST, over everything owned so far, so a granted feature can itself grant
  // one; the seen-set stops a cycle.
  for (let pass = 0; pass < 4; pass++) {
    const before = out.size;
    const sources: (DefenseGrants | undefined)[] = [
      ...(c.feats ?? []).map((f) => db.feats[f.featId]),
      ...[...out].map((id) => db.classFeatures[id]),
      ...heritageRecords(c, db),
    ];
    for (const src of sources) {
      for (const id of src?.grantsClassFeatures ?? []) if (db.classFeatures[id]) out.add(id);
    }
    if (out.size === before) break;
  }
  // The chosen MYTHIC CALLING is a classFeatures record, but build.ts only pushes it to
  // `grantedFeatures`, which is a display list nothing derives from. So the calling was picked, shown
  // in the builder, and then ignored by everything that reads owned features — its own fields, its
  // situational bonuses and any marker keyed on it all rendered for nobody. Same shape as the
  // inventor-modification case above, which is why that comment reads the way it does.
  if (c.mythicCalling && db.classFeatures[c.mythicCalling]) out.add(c.mythicCalling);
  for (const id of choiceOwnedFeatureIds(c.feats ?? [], db)) out.add(id);
  for (const [klass, subId] of [[cls, c.subclassId], [c.classId2 ? db.classes[c.classId2] : undefined, c.subclassId2]] as const) {
    // The CHOSEN SUBCLASS ITSELF. 159 of the 160 subclass options are also classFeatures records —
    // Giant Instinct, Cloistered Cleric, Bones mystery — and this set never held them, so a star, a
    // marker, a resistance or a whileActive authored on the subclass you picked reached nothing. The
    // `<featureId>-<subclassId>` rule above catches VARIANTS of a class feature, not the option.
    if (subId && db.classFeatures[subId]) out.add(subId);
    // Class features the subclass brings WITH it — an oracle mystery hands over its oracular curse.
    // A curse is in no class's feature list and is not a subclass option either, so all 11 were
    // reachable by nothing at all.
    const opt = klass?.subclass?.options.find((o) => o.id === subId);
    for (const id of subclassFeatureIds(opt?.featureIds, c.level)) if (db.classFeatures[id]) out.add(id);
  }
  return out;
}

/**
 * Class features a feat's CHOICE puts in the character's hands — Basic/Greater/Major Lesson pick a
 * `lesson-of-*` record that carries the hex, while the feat itself carries nothing.
 *
 * Exported because buildCharacter needs the same answer before a Character exists: focus spells from
 * a class feature are gathered from `klass.features` alone, and a lesson is in no class's feature
 * list, so owning it would not have been enough on its own.
 *
 * Gated on the choice's own `ownsFeature` flag rather than on the value merely resolving, because 33
 * feats offer a value that happens to be a classFeature id — Dragon Disciple Dedication offers
 * "time", which is also the oracle's Time mystery.
 */
export function choiceOwnedFeatureIds(
  feats: readonly { featId: string; choice?: { value: string } }[],
  db: ContentDatabase,
): string[] {
  const out: string[] = [];
  for (const fc of feats) {
    if (!fc.choice?.value || !db.feats[fc.featId]?.choice?.ownsFeature) continue;
    // The value may carry the importer's `aon-` prefix while the record does not.
    const id = db.classFeatures[fc.choice.value] ? fc.choice.value : fc.choice.value.replace(/^aon-/, '');
    if (db.classFeatures[id]) out.push(id);
  }
  // "You gain the instinct ability for the instinct you chose for Barbarian Dedication." The record
  // NAMING the benefit and the record HOLDING the choice are different records, and nothing connected
  // them — so a family of archetype feats withheld the benefit of a pick already in the build.
  const answerOf = (featId: string) => feats.find((f) => f.featId === featId)?.choice?.value;
  for (const fc of feats) {
    const d = db.feats[fc.featId]?.derivedGrant;
    if (!d) continue;
    const answer = answerOf(d.fromFeat);
    if (!answer) continue; // the dedication is not taken, or its choice is unanswered — grant nothing
    const id = `${d.prefix ?? ''}${answer.replace(/^aon-/, '')}${d.suffix ?? ''}`;
    if (db.classFeatures[id]) out.push(id);
  }
  return out;
}

/** Conditional precision-damage riders that apply to a qualifying Strike only in a specific
 *  circumstance. Two Remaster sources:
 *   • Rogue Sneak Attack — 1d6 (→2/3/4d6 at L5/11/17) precision when the target is off-guard, with an
 *     agile/finesse melee/unarmed attack or a ranged attack (thrown must be agile/finesse). (sneak-attack.json)
 *   • Ranger Precision hunter's edge — 1d8 (→2/3d8 at L11/19) precision on the FIRST hit each round vs
 *     your hunted prey. (class-features/precision.json; requires Hunt Prey.)
 *  Returned as annotations; the caller renders them like crit riders and never adds them to the flat total. */
function strikePrecisionRiders(
  c: Character,
  db: ContentDatabase,
  strike: { traits: string[]; ranged: boolean; category?: string; dieFaces?: number; unarmed?: boolean },
): { text: string; note: string }[] {
  const owned = ownedFeatureIds(c, db);
  const out: { text: string; note: string }[] = [];
  const agileOrFinesse = strike.traits.includes('agile') || strike.traits.includes('finesse');
  const thrown = strike.traits.includes('thrown') || strike.traits.some((t) => t.startsWith('thrown-'));
  // Sneak Attack qualifies for an agile/finesse melee weapon, ANY unarmed attack, or a ranged attack (a
  // thrown ranged attack must itself be agile/finesse); off-guard target. The Rogue RUFFIAN racket also
  // qualifies simple weapons (die ≤ d8) and martial/advanced weapons (die ≤ d6), regardless of agile/finesse.
  if (owned.has('sneak-attack')) {
    const faces = strike.dieFaces ?? 0;
    const ruffian =
      c.subclassId === 'ruffian' &&
      ((strike.category === 'simple' && faces <= 8) ||
        ((strike.category === 'martial' || strike.category === 'advanced') && faces <= 6));
    const qualifies = strike.ranged ? !thrown || agileOrFinesse : agileOrFinesse || !!strike.unarmed || ruffian;
    if (qualifies) {
      // WHERE the feature came from decides the damage. A class that grants Sneak Attack natively
      // scales it 1d6 → 4d6; the three FEATS that hand it over each cap their own dice ("You don't
      // increase the number of dice as you gain levels"), and reading only the grant gave a
      // 17th-level fighter with Butterfly's Sting the rogue's 4d6.
      const nativeCls = c.classId ? db.classes[c.classId] : undefined;
      const nativeCls2 = c.classId2 ? db.classes[c.classId2] : undefined;
      const native = [nativeCls, nativeCls2].some((k) =>
        (k?.features ?? []).some((f) => f.featureId === 'sneak-attack' && f.level <= c.level),
      );
      let dice = 0;
      let die = 'd6';
      if (native) {
        dice = 1 + [5, 11, 17].filter((l) => c.level >= l).length;
      } else {
        // Not cumulative across sources — the best one applies, never the sum.
        for (const f of c.feats) {
          const p = db.feats[f.featId]?.precisionDice;
          if (!p) continue;
          const d = p.upgradeAt && c.level >= p.upgradeAt.level ? p.upgradeAt.die : p.die;
          if (p.dice > dice || (p.dice === dice && Number(d.slice(1)) > Number(die.slice(1)))) {
            dice = p.dice;
            die = d;
          }
        }
        // A grant with no stated dice falls back to the base 1d6 rather than vanishing.
        if (!dice) dice = 1;
      }
      out.push({ text: `${dice}${die} precision`, note: 'sneak attack when target is off-guard' });
    }
  }
  // Ranger Precision hunter's edge applies to ANY Strike vs your hunted prey (no weapon restriction),
  // on the first hit of the round. It's the `precision` Hunter's Edge subclass option + Hunt Prey, and
  // only while Hunt Prey is toggled on (you've declared a prey).
  if (c.subclassId === 'precision' && owned.has('hunt-prey') && c.classResources?.['hunt-prey']) {
    const dice = c.level >= 19 ? 3 : c.level >= 11 ? 2 : 1;
    out.push({ text: `${dice}d8 precision`, note: '* first hit vs hunted prey' });
  }
  return out;
}

// Barbarian "additional damage from Rage" by instinct. Applies to melee & unarmed Strikes only while
// raging (never ranged). Values step up at the levels a barbarian gains Weapon Specialization (7) and
// Greater Weapon Specialization (15). An ARCHETYPE barbarian (Barbarian Dedication) rages for a flat +2:
// it picks an instinct "but doesn't gain the other abilities it grants", so no instinct/spec increase.
const RAGE_DAMAGE: Record<string, { tiers: [number, number, number]; type?: string; unarmedOnly?: boolean; largerWeapon?: boolean }> = {
  'fury-instinct': { tiers: [3, 7, 13] },
  'spirit-instinct': { tiers: [3, 7, 13], type: 'spirit' },
  'superstition-instinct': { tiers: [3, 7, 13] },
  'dragon-instinct': { tiers: [4, 8, 16], type: 'energy' },
  'giant-instinct': { tiers: [6, 10, 18], largerWeapon: true },
  'animal-instinct': { tiers: [2, 5, 12], unarmedOnly: true },
  // War of Immortals / Rage of Elements / Severed at the Root instincts (were falling through to flat +2):
  'elemental-instinct': { tiers: [4, 6, 12], type: 'energy' }, // chosen element's damage type
  'decay-instinct': { tiers: [6, 10, 18], type: 'poison' },
  'ligneous-instinct': { tiers: [6, 10, 18] },
  'bloodrager': { tiers: [2, 4, 8] },
};

/** The Rage bonus-damage rider for a Strike, present ONLY while the character is currently raging (the
 *  Rage class-resource is on). Melee & unarmed only; the leading `*` in the note flags the condition. */
function rageStrikeRider(c: Character, opts: { ranged: boolean; unarmed: boolean; weaponType: string }): { text: string; note: string } | null {
  if (!c.classResources?.rage) return null; // not currently raging → no bonus
  const isBarb = c.classId === 'barbarian';
  const isArchetype = !isBarb && c.feats.some((f) => f.featId === 'barbarian-dedication');
  if (!isBarb && !isArchetype) return null;
  if (opts.ranged) return null; // Rage never applies to ranged Strikes
  let value = 2;
  let type = opts.weaponType;
  let note = '* while raging (melee & unarmed)';
  if (isBarb) {
    const inst = RAGE_DAMAGE[c.subclassId ?? ''];
    if (inst) {
      if (inst.unarmedOnly && !opts.unarmed) return null; // Animal Instinct: only its animal unarmed attack
      value = inst.tiers[c.level >= 15 ? 2 : c.level >= 7 ? 1 : 0];
      if (inst.type) type = inst.type; // spirit / energy / poison override the weapon's own type
      if (inst.largerWeapon) note = '* while raging with a larger weapon (Clumsy 1)';
    }
  }
  return { text: `${value} ${type}`, note };
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
  // A base of the form "{actor|flags.system.<flag>}" is an UNSUBSTITUTED Foundry template that ships
  // in the source data — Gird Champion's favored weapon is stored exactly that way, so its crit
  // specialization could never match any weapon. The placeholder names the choice flag, so the
  // player's own answer is what belongs there.
  for (const src of out) {
    const bases = src.weapons?.bases;
    if (!bases?.some((b) => b.startsWith('{actor|flags.'))) continue;
    src.weapons = {
      ...src.weapons,
      bases: bases.flatMap((b) => {
        // Braces, the pipe and the dots ALL need escaping: unescaped, the pipe reads as an
        // alternation that matches "^{actor" with no capture group, so every lookup silently missed.
        const m = /^\{actor\|flags\.[^.]+\.([^}]+)\}$/.exec(b);
        if (!m) return [b];
        const answer = c.feats.find((f) => db.feats[f.featId]?.choice?.flag === m[1])?.choice?.value;
        return answer ? [answer] : [];
      }),
    };
  }
  if (c.subclassId) {
    add(db.classFeatures[c.subclassId], db.classFeatures[c.subclassId]?.level ?? 1);
    // Doctrines and other subclass-suffixed features aren't listed in cls.features.
    const suffix = '-' + c.subclassId;
    for (const cf of Object.values(db.classFeatures)) if (cf.critSpec && cf.id.endsWith(suffix)) add(cf, cf.level);
  }
  return out.filter((s) => s.level <= c.level);
}

/** Which armors the character has the armor specialization effect for, and any increase to its value.
 *  The twin of `critSpecSources` — see armorSpec.ts for the effects themselves. */
export interface ArmorSpecAccess {
  categories: Set<ArmorCategory>;
  items: Set<string>;
  bonus: number;
  /** What granted it, for the breakdown. */
  from: string[];
}

export function armorSpecAccess(c: Character, db: ContentDatabase): ArmorSpecAccess {
  const out: ArmorSpecAccess = { categories: new Set(), items: new Set(), bonus: 0, from: [] };
  const trained = (cat: ArmorCategory) => (c.proficiencies.defenses[cat] ?? 'untrained') !== 'untrained';
  const add = (name: string, g: DefenseGrants | undefined) => {
    const a = g?.armorSpec;
    if (!a) return;
    out.from.push(name);
    for (const cat of a.categories ?? []) out.categories.add(cat);
    for (const cat of a.ifTrained ?? []) if (trained(cat)) out.categories.add(cat);
    // "for all armors you are proficient with" — unarmored is a defense track too, but no group
    // defines a value for it, so including it changes nothing and excluding it would be a guess.
    if (a.anyProficient) {
      for (const cat of ['light', 'medium', 'heavy', 'unarmored'] as ArmorCategory[]) if (trained(cat)) out.categories.add(cat);
    }
    for (const id of a.items ?? []) out.items.add(id);
    if (a.bonus) out.bonus += a.bonus;
    // "While in Tenacious Stance, increase the value of your armor specialization effects by an amount
    // equal to the value of your armor check penalty."
    if (a.bonusWhileStance?.stanceId && c.activeStance === a.bonusWhileStance.stanceId) {
      out.bonus += Math.abs(deriveArmorCheckPenalty(c, db).value);
    }
  };
  for (const id of ownedFeatureIds(c, db)) add(db.classFeatures[id]?.name ?? id, db.classFeatures[id]);
  for (const f of c.feats) add(db.feats[f.featId]?.name ?? f.featId, db.feats[f.featId]);
  return out;
}

function weaponMatches(strike: Strike, w?: DefenseGrants['critSpecWeapons'], c?: Character): boolean {
  if (!w) return true;
  if (w.melee && strike.ranged) return false;
  // "Your innovation gains critical specialization." Narrows to the ONE designated item, and matches
  // nothing when nothing is designated — an unnarrowed entry returns true below, which would light up
  // crit spec on every Strike the character makes.
  if (w.designated) {
    const inv = c?.inventory?.find((i) => i.instanceId === strike.instanceId);
    return (inv?.designations ?? []).includes(w.designated);
  }
  const narrowed = !!(w.groups?.length || w.traits?.length || w.bases?.length);
  if (!narrowed) return true;
  if (strike.group && w.groups?.includes(strike.group)) return true;
  if (w.traits?.some((t) => strike.traits.includes(t))) return true;
  if (strike.base && w.bases?.includes(strike.base)) return true;
  return false;
}

/** Whether a Strike should show its critical-specialization effect: the character has a source
 *  (at their level) that grants crit-spec for this weapon's group / traits / base. */
export function strikeShowsCritSpec(strike: Strike, sources: CritSpecSource[], c?: Character): boolean {
  // A per-strike `unarmedTraits.critSpec` rider grants it to that one attack with no other source —
  // critSpecWeapons filters by group, trait or base weapon, never by one particular attack.
  if (strike.critSpec) return true;
  return sources.some((s) => weaponMatches(strike, s.weapons, c));
}

/** Weapon Specialization bonus damage at a given attack proficiency rank: +2/+3/+4 at
 *  expert/master/legendary, doubled to +4/+6/+8 with Greater; 0 when untrained or trained. */
export function weaponSpecDamage(rank: ProficiencyRank, ws: { spec: boolean; greater: boolean }): number {
  if (!ws.spec) return 0;
  const tier = rank === 'legendary' ? 3 : rank === 'master' ? 2 : rank === 'expert' ? 1 : 0;
  if (tier === 0) return 0;
  return ws.greater ? tier * 2 + 2 : tier + 1;
}

/** Extra-damage riders a feat/feature adds to a Strike (Spirit Striking, Offensive Boost). Returns
 *  display terms ("2 spirit", "1d6 fire") to fold into the Strike's "plus …" damage. Same-type flat
 *  riders don't stack — highest wins (Greater Spirit Striking replaces Spirit Striking). */
export function strikeDamageRiders(
  c: Character,
  db: ContentDatabase,
  ctx: { rank: ProficiencyRank; ranged: boolean; unarmed: boolean; name?: string; baseId?: string },
  extra: StrikeDamageRider[] = [],
): string[] {
  const RANK_I = ['untrained', 'trained', 'expert', 'master', 'legendary'];
  const sources: { strikeDamage?: StrikeDamageRider[] }[] = [];
  for (const f of c.feats) if (db.feats[f.featId]?.strikeDamage) sources.push(db.feats[f.featId]);
  for (const fid of ownedFeatureIds(c, db)) if (db.classFeatures[fid]?.strikeDamage) sources.push(db.classFeatures[fid]);
  // Invested NON-weapon items with a global strike-damage rider (Crimson Fulcrum Lens: +2 melee).
  for (const inv of c.inventory) {
    const it = db.items[inv.itemId];
    if (inv.invested && it?.strikeDamage && it.itemType !== 'weapon') sources.push(it);
  }
  // ACTIVE MODES — a drink, a potion, a switched-on ability. A temporary rider has to reach the same
  // place a permanent one does, or a 10-minute "+1d4 fire to your unarmed attacks" has nowhere to go
  // but a note: `grantedStrikes` grants a NEW attack, which is not what those effects say.
  for (const m of c.activeModes ?? []) if (m.strikeDamage) sources.push(m);
  // A resolved effect PICK — Potent Nectar's permanent one-of-two choice lands here.
  if (c.chosenEffects?.strikeDamage) sources.push({ strikeDamage: c.chosenEffects.strikeDamage });
  // The specific weapon's own intrinsic riders (Hyldarf's Fang +2d6) — only this Strike.
  if (extra.length) sources.push({ strikeDamage: extra });
  const flatByType = new Map<string, number>();
  const diceTerms: string[] = [];
  for (const src of sources) {
    for (const r of src.strikeDamage ?? []) {
      const scope = r.appliesTo ?? 'all';
      if (scope === 'unarmed' && !ctx.unarmed) continue;
      if (scope === 'melee' && ctx.ranged) continue;
      if (scope === 'ranged' && !ctx.ranged) continue;
      // A rider naming ONE Strike rides only on that Strike. Potent Nectar adds its acid to the
      // nectar attack, not to every unarmed attack its owner happens to have.
      if (r.strikeName && r.strikeName.toLowerCase() !== (ctx.name ?? '').toLowerCase()) continue;
      // …and a rider aimed at "your favored weapon", whose identity is the player's own answer.
      if (r.fromChoiceFlag) {
        const answer = c.feats.find((f) => db.feats[f.featId]?.choice?.flag === r.fromChoiceFlag)?.choice?.value;
        if (!answer || answer !== ctx.baseId) continue;
      }
      let flat = r.flat ?? 0;
      if (r.byStrikeProficiency) {
        // Keyed to the strike's proficiency — only expert+ qualifies; take the value at that rank.
        const key = ctx.rank as 'expert' | 'master' | 'legendary';
        flat = Math.max(flat, RANK_I.indexOf(ctx.rank) >= 2 ? r.byStrikeProficiency[key] ?? 0 : 0);
      }
      if (flat > 0) flatByType.set(r.type, Math.max(flatByType.get(r.type) ?? 0, flat));
      if (r.dice) {
        const kind = r.persistent ? 'persistent ' : '';
        const tail = r.splash ? ' splash' : '';
        diceTerms.push(`${r.dice.n}${r.dice.die} ${kind}${DAMAGE_ABBR[r.type] ?? r.type}${tail}`);
      }
    }
  }
  return [...[...flatByType].map(([type, n]) => `${n} ${DAMAGE_ABBR[type] ?? type}`), ...diceTerms];
}

/**
 * Traits a feat adds to a WIELDED weapon — "Melee weapons you wield gain the versatile B trait"
 * (Hilt Hammer), "an agile or finesse melee weapon that doesn't have the deadly trait gains deadly
 * d8" (Deadly Grace). The wielded sibling of applyUnarmedRiders; weapon traits came straight off the
 * item record, so none of these feats could touch them.
 */
/** A record may carry one rider or several; one printed effect often hits two attacks differently. */
const asRiders = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Does this trait list carry `name`, or any member of its family? `thrown` matches `thrown-20`. */
const hasTraitFamily = (traits: readonly string[], name: string) =>
  traits.some((t) => t === name || t.startsWith(`${name}-`));

/** Merge `add` into `traits`, letting a bigger deadly/versatile/fatal REPLACE a smaller one. */
function mergeTraits(traits: readonly string[], add: readonly string[]): string[] {
  const families = new Set(add.map(traitFamily));
  const kept = traits.filter((t) => !families.has(traitFamily(t)));
  const rivals = traits.filter((t) => families.has(traitFamily(t)));
  const dieRank = (s: string) => DIE_LADDER.indexOf((s.split('-')[1] ?? '') as (typeof DIE_LADDER)[number]);
  const out = [...kept];
  for (const t of add) {
    // Never DOWNGRADE: a deadly d12 already present beats an incoming d10.
    const rival = rivals.find((x) => traitFamily(x) === traitFamily(t));
    out.push(rival && dieRank(rival) > dieRank(t) ? rival : t);
  }
  return [...new Set(out)];
}

/** Apply `n` die steps, `n` being a count or a plain true for one. */
const stepsOf = (v: boolean | number | undefined) => (v === true ? 1 : typeof v === 'number' ? v : 0);

/**
 * Changes a feat or class feature makes to a WIELDED weapon — traits, the damage die, the range
 * increment. "Melee weapons you wield gain versatile B" (Hilt Hammer), "simple weapons you wield
 * have their damage die increased" (Humble Strikes).
 *
 * Returns a MODIFIED weapon rather than only its traits, because several of these change the die or
 * the range and everything downstream reads those off the item.
 *
 * Over-granting is the whole danger here: an unfiltered rider applies to EVERY weapon the character
 * wields. Die steps deliberately DO NOT COMPOUND — the best single step wins, or a champion with two
 * such feats turns a d6 into a d10.
 */
function applyWeaponRiders(c: Character, db: ContentDatabase, w: WeaponItem, inv?: InventoryItem): WeaponItem {
  const sources: (DefenseGrants | undefined)[] = [
    ...(c.feats ?? []).map((fc) => db.feats[fc.featId]),
    ...[...ownedFeatureIds(c, db)].map((id) => db.classFeatures[id]),
  ];
  const deityWeapons = deitySimpleFavoredWeaponIds(c, db);

  let traits = w.traits;
  let die: DieSize | undefined = w.damage?.die;
  let range = w.range;
  let bestStep = 0; // steps never compound; the largest single one wins
  let setDie: string | undefined;

  for (const src of sources) {
    for (const r of asRiders(src?.weaponTraits)) {
      const m = r.match ?? {};
      const isMelee = !w.range;
      if (m.melee !== undefined && m.melee !== isMelee) continue;
      if (m.groups?.length && !m.groups.includes(w.group ?? '')) continue;
      if (m.items?.length && !m.items.includes(w.id)) continue;
      if (m.categories?.length && !m.categories.includes(w.category)) continue;
      // '1+' counts as one-handed: that is how it is wielded when such a clause applies.
      if (m.hands != null && !String(w.hands ?? '').startsWith(String(m.hands))) continue;
      // Family-aware for the same reason as anyTrait: excluding "thrown" must exclude `thrown-20`.
      if (m.excludeTraits?.length && m.excludeTraits.some((t) => hasTraitFamily(traits, t))) continue;
      // Family-aware: a weapon carries `thrown-20`, not a bare `thrown`, so a filter naming "thrown"
      // must match the whole family or every thrown-weapon clause silently matches nothing at all.
      if (m.anyTrait?.length && !m.anyTrait.some((t) => hasTraitFamily(traits, t))) continue;
      if (m.deityFavored && !deityWeapons.has(w.id)) continue;
      // "Your innovation gains the tearing trait." Matches nothing when nothing is designated — a
      // "first weapon" fallback would hand a greatsword's modifications to a dagger.
      if (m.designated && !(inv?.designations ?? []).includes(m.designated)) continue;

      if (r.add?.length) {
        // "…that doesn't have the deadly trait": skip a weapon already carrying the family, or the
        // rider would replace a deadly d10 with a d8.
        const add = r.onlyIfMissing
          ? r.add.filter((t) => !traits.some((existing) => traitFamily(existing) === traitFamily(t)))
          : r.add;
        if (add.length) traits = mergeTraits(traits, add);
      }
      if (r.remove?.length) traits = traits.filter((t) => !r.remove!.includes(t));
      if (r.setDie) setDie = r.setDie;
      bestStep = Math.max(bestStep, stepsOf(r.stepDie));
      if (r.range?.set != null) range = r.range.set;
      if (r.range?.add != null) range = (range ?? 0) + r.range.add;
    }
  }

  // An absolute die states a result, so it wins over a step. Both are validated against the ladder,
  // so a typo in the data cannot put a nonsense die on a Strike.
  if (setDie && DIE_LADDER.includes(setDie as DieSize)) die = setDie as DieSize;
  else for (let i = 0; i < bestStep; i++) die = stepDie(die ?? '') as DieSize;

  if (traits === w.traits && die === w.damage?.die && range === w.range) return w;
  return { ...w, traits, range, ...(w.damage && die ? { damage: { ...w.damage, die } } : {}) };
}

export function deriveStrike(c: Character, db: ContentDatabase, inv: InventoryItem): Strike | null {
  const item = db.items[inv.itemId];
  if (!item || item.itemType !== 'weapon') return null;
  // A feat or class feature may change what you wield — traits, damage die, range increment.
  // Everything below reads those off `w`, so apply the riders here, once.
  const w = applyWeaponRiders(c, db, item, inv);
  // Material/precious-metal placeholder "weapons" (cold iron, adamantine ingots, silver, …) carry no
  // damage object; guard so a stray equip can't crash the entire Strikes computation + Main tab.
  if (!w.damage) return null;

  const strMod = abilityMod(c.abilities.str);
  const dexMod = abilityMod(c.abilities.dex);
  const finesse = w.traits.includes('finesse');
  // A PURE thrown weapon (bare `thrown` trait: javelin/dart/chakram/shuriken/bola) makes a RANGED attack,
  // so its attack roll uses Dexterity (like any ranged attack) while still adding Strength to DAMAGE. A
  // melee weapon that can also be thrown carries a `thrown-N` trait (dagger/light hammer/trident/spear);
  // the app models its single strike as the MELEE attack, so it keeps Str (or Dex if finesse & higher).
  const bareThrown = w.traits.includes('thrown');
  const thrown = bareThrown || w.traits.some((t) => t.startsWith('thrown-'));
  const propulsive = w.traits.includes('propulsive');
  const ranged = w.range != null;
  const projectile = ranged && !thrown;

  // Attack ability: projectiles AND pure thrown weapons use Dex; a melee (incl. thrown-N) weapon uses Str,
  // or Dex when it's finesse and Dex is higher. (Damage still adds Str for thrown — see usesStrDamage.)
  const usesDex = projectile || bareThrown || (finesse && dexMod > strMod);
  const atkAbility: AbilityId = usesDex ? 'dex' : 'str';
  const abMod = usesDex ? dexMod : strMod;

  // A Monster-Parts refined weapon ignores its runes entirely (either/or). Its refinement supplies the
  // attack item bonus + striking dice a potency/striking rune would (Table 4A), plus imbued riders.
  const mpMode = mpActive(c, inv);
  const mpRef = mpMode ? mpWeaponRefine(inv.monsterPart, c.level) : null;
  const runes = mpMode ? undefined : effectiveWeaponRunes(c, db, inv);
  // Best of: weapon-category rank, a per-weapon override (deity favored weapon), and a per-GROUP
  // proficiency (alchemist bombs, gunslinger firearms — these beat the bare category rank).
  const rank = betterRank(
    betterRank(
      betterRank(c.proficiencies.attacks[w.category], c.proficiencies.weaponOverrides?.[w.id]),
      w.group ? c.proficiencies.weaponGroups?.[w.group] : undefined,
    ),
    // Gunslinger "firearms & crossbows" proficiency — by category, only for a firearm/crossbow weapon.
    w.group === 'firearm' || w.group === 'crossbow' ? c.proficiencies.firearmProf?.[w.category] : undefined,
  );
  // ABP attack potency replaces the weapon's potency rune; a refined weapon supplies an item bonus of
  // the same class (take the higher — a refined weapon carries no runes, so this is refinement-vs-ABP).
  // Battleforger's temporary +1 potency: an item bonus of the same class, so it takes the highest
  // rather than adding — which matches the feat's "no effect if it already had a potency rune".
  const potencyBonus = Math.max(abpOn(c) ? abpAttack(c.level) : runes?.potency ?? 0, mpRef?.attack ?? 0, inv.battleforged ? 1 : 0);
  // Clumsy penalizes EVERY ranged attack roll, including thrown weapons that use Str to hit. Status
  // penalties don't stack and both calls carry the same Frightened/Prone, so taking the worst (min) of
  // the attack-ability and Dex penalties folds in Clumsy for a thrown strike without double-counting.
  // A ranged/thrown attack also suffers Clumsy (a Dex penalty); gathering both ability slots and pooling
  // takes the worst per type, folding Clumsy into a thrown-Str strike without double-counting Frightened.
  const condMods = ranged
    ? [...conditionTypedMods(c.conditions, atkAbility, 'attack'), ...conditionTypedMods(c.conditions, 'dex', 'attack')]
    : conditionTypedMods(c.conditions, atkAbility, 'attack');
  const base =
    abMod +
    profBonus(rank, c.level, pwl(c)) +
    // Weapon potency (item), condition penalties, and mode modifiers pool by type across sources.
    poolTypedMods([{ type: 'item', value: potencyBonus }, ...condMods, ...modeTypedMods(c.activeModes, { kind: 'attack' })]);

  const step = mapStepFor(c, db, w.traits);
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
  // Feat/feature/item strike-damage riders (Spirit Striking; Crimson Fulcrum Lens; Hyldarf's Fang +2d6
  // intrinsic to this weapon).
  const riderDmg = strikeDamageRiders(c, db, { rank, ranged, unarmed: false, name: w.name, baseId: w.id }, w.strikeDamage);
  const extraDmg = [...runeDmg, ...mpDmg, ...riderDmg];
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
  const conditionalDamage = strikePrecisionRiders(c, db, {
    traits: w.traits,
    ranged,
    category: w.category,
    dieFaces: Number(String(w.damage.die).replace('d', '')) || 0,
  });
  const rageRider = rageStrikeRider(c, { ranged, unarmed: false, weaponType: w.damage.type });
  if (rageRider) conditionalDamage.push(rageRider);

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
/**
 * Elemental Blast, per element.
 *
 * `types` is the list Elemental Blast prints — "choose one of your kinetic elements AND A DAMAGE TYPE
 * LISTED FOR THAT ELEMENT". Only the first of each was modelled, so half the printed choice was
 * missing: an earth kineticist could not throw a piercing blast, and Versatile Blasts (whose entire
 * content is adding to these lists) had nothing to add to.
 */
export const ELEMENT_BLAST: Record<string, { die: string; types: string[]; range: number }> = {
  air: { die: 'd6', types: ['electricity', 'slashing'], range: 60 },
  earth: { die: 'd8', types: ['bludgeoning', 'piercing'], range: 30 },
  fire: { die: 'd6', types: ['fire'], range: 60 },
  metal: { die: 'd8', types: ['piercing', 'slashing'], range: 30 },
  water: { die: 'd8', types: ['bludgeoning', 'cold'], range: 30 },
  wood: { die: 'd8', types: ['bludgeoning', 'vitality'], range: 30 },
};

/** The damage types this character may choose for a blast of `element`, including what their records
 *  add to the printed list. Deduped, printed order first. */
export function blastTypesFor(c: Character, db: ContentDatabase, element: string): string[] {
  const base = ELEMENT_BLAST[element]?.types ?? [];
  const extra: string[] = [];
  for (const f of c.feats ?? []) for (const t of db.feats[f.featId]?.blastTypeAdditions?.[element] ?? []) extra.push(t);
  for (const fid of ownedFeatureIds(c, db)) for (const t of db.classFeatures[fid]?.blastTypeAdditions?.[element] ?? []) extra.push(t);
  return [...new Set([...base, ...extra])];
}

/** A kineticist's Elemental Blast as a rollable strike per attuned element. Attack uses Con + the class
 *  proficiency (class DC track); damage scales +1 die at L5/9/13/17. Shown as a ranged strike with a
 *  note that melee adds Str and a 2-action blast adds Con to damage. */
export function deriveBlastStrikes(c: Character, db: ContentDatabase): Strike[] {
  const _db = db;
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
      // The player's chosen damage type for this element, defaulting to the first the element prints.
      // Elemental Blast says "choose … a damage type listed for that element", so a fixed type would
      // be showing one branch of a choice the rules give every kineticist every time they blast.
      const types = blastTypesFor(c, db, el);
      const picked = c.kineticist?.blastTypes?.[el];
      const type = picked && types.includes(picked) ? picked : types[0];
      const alt = types.filter((t) => t !== type);
      return {
        instanceId: `blast:${el}`,
        name: `Elemental Blast (${el.charAt(0).toUpperCase() + el.slice(1)})`,
        attack,
        damage:
          `${dice}${b.die}${flat ? formatMod(flat) : ''} ${DAMAGE_ABBR[type] ?? type}` +
          ` (2 actions; +Str instead in melee${alt.length ? `; or ${alt.map((t) => DAMAGE_ABBR[t] ?? t).join('/')}` : ''})`,
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
  /** The record that GRANTED this strike, so a rider can name it rather than guess from the name —
   *  "Claw" belongs to Draconic Aspect and to a nephilim's Bestial Manifestation alike. */
  source?: string;
  /** This one attack has its group's critical specialization, from an `unarmedTraits.critSpec` rider. */
  critSpec?: boolean;
  /** Range increment (ft) for a RANGED natural/unarmed attack (Spined Azarketi spine); undefined = melee. */
  range?: number;
  /** Extra damage dice this attack has from its own level scaling rather than from handwraps — a
   *  FLOOR, so better handwraps still win. */
  strikingFloor?: number;
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
  // A RANGED natural attack (spine) is a ranged attack → Dexterity to the attack roll and no ability to damage.
  const isRanged = p.range != null;
  const usesDex = isRanged || (p.traits.includes('finesse') && dexMod > strMod);
  const atkAbility: AbilityId = usesDex ? 'dex' : 'str';
  const abMod = usesDex ? dexMod : strMod;
  const rank = c.proficiencies.attacks.unarmed;
  // Monster-Parts refined handwraps buff unarmed attacks like the weapon table (attack + striking).
  const mpRef = mpHandwraps ? mpWeaponRefine(mpHandwraps, c.level) : null;
  const potencyBonus = Math.max(abpOn(c) ? abpAttack(c.level) : hwRunes?.potency ?? 0, mpRef?.attack ?? 0);
  const base =
    abMod +
    profBonus(rank, c.level, pwl(c)) +
    poolTypedMods([
      { type: 'item', value: potencyBonus },
      ...conditionTypedMods(c.conditions, atkAbility, 'attack'),
      ...modeTypedMods(c.activeModes, { kind: 'attack' }),
    ]);
  const step = mapStepFor(c, db, p.traits);
  const attack = [base, base - step, base - step * 2];
  const specDamage = weaponSpecDamage(rank, weaponSpecialization(c, db));
  // Thief racket also applies to a finesse UNARMED attack (thief.json selector melee-strike-damage) —
  // add Dex to damage instead of Str when it helps.
  const thiefDexDamage = !isRanged && c.subclassId === 'thief' && p.traits.includes('finesse') && dexMod > strMod;
  // Ranged natural attacks add no ability modifier to damage (like a projectile); melee add Str (or Dex via Thief).
  const dmgAbMod = isRanged ? 0 : thiefDexDamage ? dexMod : strMod;
  const dmgBonus =
    dmgAbMod +
    (isRanged ? 0 : conditionPenalty(c.conditions, thiefDexDamage ? 'dex' : 'str', 'damage')) +
    specDamage +
    modeNumberBonus(c.activeModes, { kind: 'damage' });
  // ABP devastating attacks OR a handwraps striking rune (or MP refinement) add dice to THIS attack's
  // own die.
  const strikingExtra = Math.max(
    abpOn(c) ? abpStrikingDice(c.level) : hwRunes?.striking ? STRIKING_DICE[hwRunes.striking] : 0,
    mpRef?.extraDice ?? 0,
    // A granted attack that scales on its own ("at 5th level it gains the benefits of a striking
    // rune"). A floor, not an override: a character with better handwraps keeps them.
    p.strikingFloor ?? 0,
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
  // Feat/feature strike-damage riders apply to unarmed Strikes too (Spirit Striking, an armor
  // innovation's Offensive Boost). `p.name === 'Fist'` and stance strikes are all unarmed here.
  const riderDmg = strikeDamageRiders(c, db, { rank, ranged: isRanged, unarmed: true, name: p.name });
  const extraDmg = [...runeDmg, ...mpDmg, ...riderDmg];
  const damage =
    `${dice}${die}${dmgBonus ? formatMod(dmgBonus) : ''} ${DAMAGE_ABBR[p.damageType] ?? p.damageType}` +
    (extraDmg.length ? ` plus ${extraDmg.join(' plus ')}` : '') +
    (nCritRiders.length ? ` (plus ${nCritRiders.join(', ')} on a crit)` : '') +
    (nFatal ? ` (fatal ${nFatal})` : '');
  const conditionalDamage = strikePrecisionRiders(c, db, { traits: p.traits, ranged: isRanged, unarmed: true });
  const rageRider = rageStrikeRider(c, { ranged: isRanged, unarmed: true, weaponType: p.damageType });
  if (rageRider) conditionalDamage.push(rageRider);
  return {
    instanceId: p.instanceId,
    name: p.name,
    attack,
    damage: damage + conditionalRiderText(conditionalDamage),
    traits: p.traits,
    // Carried through from the profile: a rider may give THIS one attack its crit specialization.
    ...(p.critSpec ? { critSpec: true } : {}),
    ranged: isRanged,
    range: p.range,
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

/** "deadly-d8" → "deadly", "versatile-s" → "versatile"; a plain trait is its own family. */
const traitFamily = (t: string) => (/^(deadly|fatal|versatile)-/.test(t) ? t.split('-')[0] : t);

/**
 * Apply every owned feat's `unarmedTraits` rider to an unarmed Strike profile.
 *
 * "Your unarmed attacks gain the reach trait" changes an attack the character ALREADY has, which
 * neither grantedStrikes (that creates one) nor any other field could express — so Effortless Reach,
 * Deadly Strikes, Diamond Fists and their kin printed traits nobody ever received.
 */
function applyUnarmedRiders(c: Character, db: ContentDatabase, p: UnarmedProfile): UnarmedProfile {
  let out = p;
  // Class features carry these too, now that both riders live on DefenseGrants — the monk's Powerful
  // Fist is a class feature, and so is every subclass that reshapes an attack.
  const sources: (DefenseGrants | undefined)[] = [
    ...(c.feats ?? []).map((fc) => db.feats[fc.featId]),
    ...[...ownedFeatureIds(c, db)].map((id) => db.classFeatures[id]),
  ];
  let bestStep = 0;
  let setDie: string | undefined;
  let gainsCritSpec = false;

  for (const src of sources) {
    for (const r of asRiders(src?.unarmedTraits)) {
      // A rider may name which attack it changes ("your beak", "your hair"); most name none = all.
      if (r.match?.length && !r.match.some((m) => out.name.toLowerCase().includes(m.toLowerCase()))) continue;
      // Or name the RECORD that granted the strike. "Claw" is Draconic Aspect's attack and also a
      // nephilim's Bestial Manifestation, so a name match hands the wrong character a deadly d8.
      // Fails closed: a strike with no recorded source matches no `fromRecord` rider.
      if (r.fromRecord && out.source !== r.fromRecord) continue;

      const add = r.add ?? [];
      // "any that already had one or both of these" — tested BEFORE the new traits are merged in.
      const had = add.some((t) => out.traits.some((existing) => traitFamily(existing) === traitFamily(t)));
      if (add.length) out = { ...out, traits: mergeTraits(out.traits, add) };
      // "Your fist attacks lose the nonlethal trait" — every field before this could only add.
      if (r.remove?.length) out = { ...out, traits: out.traits.filter((t) => !r.remove!.includes(t)) };

      if (r.setDie) setDie = r.setDie;
      bestStep = Math.max(bestStep, stepsOf(r.stepDie) || (r.stepDieIfHad && had ? 1 : 0));
      if (r.critSpec) gainsCritSpec = true;
    }
  }

  // An absolute die states a result, so it wins; steps never compound across riders.
  if (setDie) out = { ...out, die: setDie };
  else if (bestStep) {
    let die = out.die;
    for (let i = 0; i < bestStep; i++) die = stepDie(die);
    out = { ...out, die };
  }
  if (gainsCritSpec) out = { ...out, critSpec: true };
  return out;
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
      applyUnarmedRiders(c, db, {
        instanceId: `natural:${i}`,
        name: na.name,
        die: na.die,
        damageType: na.damageType,
        traits: na.traits?.length ? na.traits : ['unarmed'],
        group: na.group ?? 'brawling',
        range: na.range,
      }),
      hwRunes,
      false,
      mpHw,
    ),
  );
  // The Fist's damage die increases to 1d6 (and it loses the nonlethal trait) from Powerful Fist (level-1
  // monk class feature) OR the Warrior Automaton / Warrior Jotunborn heritages, which grant the same upgrade.
  const fistDieUpgraded =
    ownedFeatureIds(c, db).has('powerful-fist') || hasHeritage(c, 'warrior-automaton') || hasHeritage(c, 'warrior-jotunborn');
  const fistProfile: UnarmedProfile = fistDieUpgraded
    ? { ...FIST_PROFILE, die: 'd6', traits: FIST_PROFILE.traits.filter((t) => t !== 'nonlethal') }
    : FIST_PROFILE;
  // Deadly Simplicity: when the deity's favored weapon is an unarmed attack (Irori's fist), the Fist
  // Strike's die is raised to d6 (its d4 → d6). Applies only to the baseline Fist, not natural attacks.
  const dsFist = hasDeadlySimplicity(c) && deityFavorsUnarmed(c, db);
  // The active stance's granted unarmed attack(s) (Tiger claw, Falling Stone, …) — buffed by handwraps
  // like any unarmed Strike. Listed first so the in-stance attack is prominent.
  // An ACTIVE MODE may grant one too (Invoke Offense's spirit attack, which lasts as long as the
  // trance). Same treatment as a stance's: a granted attack should not scale differently because the
  // toggle that granted it is called something else.
  const granted: { s: StanceStrike; key: string }[] = [
    ...(activeStanceDef(c, db)?.strikes ?? []).map((s, i) => ({ s, key: `stance:${i}` })),
    ...(c.activeModes ?? []).flatMap((m) => (m.grantedStrikes ?? []).map((s, i) => ({ s, key: `mode:${m.id}:${i}` }))),
  ];
  const stanceStrikes = granted.map(({ s, key }) =>
    deriveUnarmedStrike(
      c,
      db,
      applyUnarmedRiders(c, db, {
        instanceId: key,
        name: s.name,
        die: s.die,
        damageType: s.damageType,
        traits: s.traits?.length ? [...new Set([...s.traits, 'unarmed'])] : ['unarmed'],
        group: s.group ?? 'brawling',
        strikingFloor: Math.max(
          0,
          ...(s.strikingByLevel ?? []).filter((t) => c.level >= t.level).map((t) => t.extraDice),
        ),
      }),
      hwRunes,
      false,
      mpHw,
    ),
  );
  // Always offer the baseline Fist (PF2e gives every character an unarmed Strike), listed after naturals.
  return [
    ...stanceStrikes,
    ...weapons,
    ...deriveBlastStrikes(c, db),
    ...naturals,
    deriveUnarmedStrike(c, db, applyUnarmedRiders(c, db, fistProfile), hwRunes, dsFist, mpHw),
  ];
}

export function deriveSpeeds(c: Character, db: ContentDatabase): Speeds {
  const ancestry = c.ancestryId ? db.ancestries[c.ancestryId] : undefined;
  const speeds: Speeds = { ...(ancestry?.speeds ?? {}) };

  // Non-land speeds granted (unconditionally) by the heritage, selected feats, or a worn/invested
  // item's passive effects (the generic magic-item lane).
  const grantSources: DefenseGrants[] = [];
  grantSources.push(...heritageRecords(c, db));
  for (const f of c.feats) {
    const feat = db.feats[f.featId];
    if (feat) grantSources.push(feat);
  }
  if (c.chosenEffects?.speeds) grantSources.push({ speeds: c.chosenEffects.speeds });
  // "While raging you gain a climb/swim Speed…" (Raging Athlete) — active only while the state is on.
  for (const wa of activeStateGrants(c, db)) if (wa.speeds) grantSources.push({ speeds: wa.speeds });
  // A state that COSTS Speed (Wooden Rage: −10 ft while raging), alongside the ones that grant it.
  let statePenalty = 0;
  for (const wa of activeStateGrants(c, db)) statePenalty += wa.speedPenalty ?? 0;
  // Flat additive land-Speed from feats/class features/heritage (Hyper Boosters: +10 ft). After the base.
  let featLandBonus = 0;
  for (const f of c.feats) featLandBonus += db.feats[f.featId]?.landSpeedBonus ?? 0;
  for (const fid of ownedFeatureIds(c, db)) featLandBonus += db.classFeatures[fid]?.landSpeedBonus ?? 0;
  for (const h of heritageRecords(c, db)) featLandBonus += h.landSpeedBonus ?? 0;
  let passiveSpeedPenalty = 0;
  let passiveLandBonus = 0;
  for (const inv of c.inventory) {
    if (!(inv.worn || inv.invested || inv.equipped)) continue;
    for (const pe of [db.items[inv.itemId]?.passiveEffects, c.resolvedItemPassives?.[inv.itemId]]) {
      if (!pe) continue;
      if (pe.speeds) grantSources.push({ speeds: pe.speeds });
      // A worn item's flat speed penalty (Monster Suit −10 ft) applies to every movement type.
      if (pe.speedPenalty) passiveSpeedPenalty += Math.abs(pe.speedPenalty);
      // A flat land-Speed bonus (boots-of-speed pattern) adds to land Speed.
      if (pe.speedBonus) passiveLandBonus += pe.speedBonus;
    }
  }
  // Land-Speed FLOORS ("your land Speed increases to 15 feet") raise the base before anything adds to
  // it, so a merfolk with Strong Tail and Fleet walks at 20 — floor 15, then +5 — rather than 5+15+5.
  let landFloor = 0;
  for (const f of c.feats) landFloor = Math.max(landFloor, db.feats[f.featId]?.landSpeedMin ?? 0);
  for (const fid of ownedFeatureIds(c, db)) landFloor = Math.max(landFloor, db.classFeatures[fid]?.landSpeedMin ?? 0);
  for (const h of heritageRecords(c, db)) landFloor = Math.max(landFloor, h.landSpeedMin ?? 0);
  if (landFloor) speeds.land = Math.max(speeds.land ?? 0, landFloor);
  if (passiveLandBonus || featLandBonus) speeds.land = (speeds.land ?? 0) + passiveLandBonus + featLandBonus;
  // A proficiency-gated speed (Quick Climb/Swim: climb/swim = land Speed only if legendary Athletics).
  // Fold each qualifying block's speeds in with the unconditional ones.
  const gatedSpeeds: SpeedGrants[] = [];
  for (const src of grantSources) {
    for (const g of src.speedsIf ?? []) {
      // Skill-proficiency gate (Quick Climb/Swim) — pass if no skill named.
      const skillOk = !g.skill || !g.rank || PROFICIENCY_RANKS.indexOf(c.proficiencies.skills[g.skill] ?? 'untrained') >= PROFICIENCY_RANKS.indexOf(g.rank);
      // Heritage gate (Swift Swimmer's wetlander lizardfolk) — pass if no heritage named.
      const heritageOk = !g.heritage || hasHeritage(c, g.heritage);
      if (skillOk && heritageOk) gatedSpeeds.push(g.speeds);
    }
  }
  for (const src of [...grantSources, ...gatedSpeeds.map((speeds) => ({ speeds }))]) {
    for (const [k, raw] of Object.entries(src.speeds ?? {})) {
      const key = k as keyof Speeds;
      if (raw == null) continue;
      // A granted Speed may be a FORMULA relative to the character's own Speeds ("a fly Speed equal to
      // your land Speed", "climb Speed equal to half your land Speed, minimum 5"). Resolved against the
      // speeds accumulated so far (ancestry + earlier grants), which is what those rules mean.
      const v = typeof raw === 'number' ? raw : resolveFormula(raw as unknown as string, { level: c.level, abilities: c.abilities, speeds });
      if (!v) continue;
      // A land-Speed grant (Fleet, Nimble Elf, …) INCREASES your existing land Speed (additive, untyped),
      // whereas fly/swim/climb/burrow grants confer a SET speed of that type (take the best).
      if (key === 'land') speeds.land = (speeds.land ?? 0) + v;
      else speeds[key] = Math.max(speeds[key] ?? 0, v);
    }
  }
  // Every record that does ARITHMETIC on a Speed rather than granting one. Collected before the
  // penalties are applied because one of them cancels a penalty and another reduces it, and both
  // need to be known while the penalties are still separable.
  const adjusts: NonNullable<DefenseGrants['speedAdjust']>[] = [];
  for (const src of grantSources) if (src.speedAdjust) adjusts.push(src.speedAdjust);
  for (const fid of ownedFeatureIds(c, db)) {
    const a = db.classFeatures[fid]?.speedAdjust;
    if (a) adjusts.push(a);
  }
  const ADJUST_KEYS: (keyof Speeds)[] = ['land', 'fly', 'swim', 'climb', 'burrow'];
  const adjustTargets = (key: NonNullable<DefenseGrants['speedAdjust']>['key']) =>
    key === 'all' ? ADJUST_KEYS : key === 'non-land' ? ADJUST_KEYS.filter((k) => k !== 'land') : [key as keyof Speeds];

  // The active stance / FORM may grant speeds (an ursine form's climb, a form's "fly = your land Speed").
  // Applied AFTER the base grants so a "@actor.speed.land" formula sees the finished land Speed.
  const stanceSpeeds = activeStanceDef(c, db)?.speeds;
  for (const [k, raw] of Object.entries(stanceSpeeds ?? {})) {
    const key = k as keyof Speeds;
    if (raw == null) continue;
    const v = typeof raw === 'number' ? raw : resolveFormula(raw as unknown as string, { level: c.level, abilities: c.abilities, speeds });
    if (!v) continue;
    if (key === 'land') speeds.land = (speeds.land ?? 0) + v;
    else speeds[key] = Math.max(speeds[key] ?? 0, v);
  }

  // An ACTIVE MODE's Speed — a potion granting "a fly Speed of 40 feet for 1 minute", a rune granting
  // "a fly Speed of 25 feet or your land Speed, whichever is slower". Placed HERE, beside the stance
  // block and after the base grants, for the same reason: these formulas reference "@actor.speed.land"
  // and would resolve to 0 if evaluated before the land Speed was known.
  // Without this lane a Speed toggle could only ever be prose — Triple Time still ships as
  // `modifiers: []` plus a note for exactly that reason.
  for (const m of c.activeModes ?? []) {
    for (const [k, raw] of Object.entries(m.speeds ?? {})) {
      const key = k as keyof Speeds;
      if (raw == null) continue;
      const v = typeof raw === 'number' ? raw : resolveFormula(raw as unknown as string, { level: c.level, abilities: c.abilities, speeds });
      if (!v) continue;
      if (key === 'land') speeds.land = (speeds.land ?? 0) + v;
      else speeds[key] = Math.max(speeds[key] ?? 0, v);
    }
  }

  // "+5 feet to any fly Speed you already have" — applied after every grant (base, stance, mode) and
  // before the penalties. A Speed of 0 or absent stays absent, which is exactly why this could not be
  // a `speeds` grant: those resolve as max(existing, granted) and would have swallowed the 5.
  for (const a of adjusts) {
    if (!a.add) continue;
    for (const k of adjustTargets(a.key)) {
      if ((speeds[k] ?? 0) > 0) speeds[k] = (speeds[k] as number) + a.add;
    }
  }

  // ---- penalties. Every one of these hits EVERY movement type, not just land.
  const ignoreArmor = adjusts.some((a) => a.ignoreArmorPenalty);
  const worn = findWornArmor(c, db);
  // Full penalty if you don't meet the armor's Strength threshold; meeting it reduces the penalty by
  // 5 feet (to a minimum of 0).
  let armorPenalty = worn?.armor.speedPenalty ? Math.abs(worn.armor.speedPenalty) : 0;
  if (armorPenalty && meetsArmorStrength(c, worn!.armor)) armorPenalty = Math.max(0, armorPenalty - 5);
  if (ignoreArmor) armorPenalty = 0; // Unburdened Iron: "Ignore the reduction to your Speed from any armor you wear."

  // The penalties that are NOT from armour, kept apart because the second Unburdened Iron clause
  // reduces exactly one of them: "If your Speed is taking multiple penalties, pick only one penalty
  // to reduce." Reducing the LARGEST is the reading that always delivers the full deduction.
  const others = [
    passiveSpeedPenalty, // a worn item's flat penalty (Monster Suit −10 ft)
    activeStanceDef(c, db)?.speedPenalty ?? 0, // Mountain Stance −5 ft
    statePenalty, // Wooden Rage −10 ft while raging
    c.conditions.some((x) => x.id === 'encumbered') ? 10 : 0,
  ].filter((n) => n > 0);
  const reduceBy = Math.max(0, ...adjusts.map((a) => a.reduceOtherPenalty ?? 0));
  if (reduceBy && others.length) {
    const biggest = others.indexOf(Math.max(...others));
    others[biggest] = Math.max(0, others[biggest] - reduceBy);
  }

  const total = armorPenalty + others.reduce((n, p) => n + p, 0);
  if (total > 0) {
    for (const k of Object.keys(speeds) as (keyof Speeds)[]) {
      if (speeds[k] != null) speeds[k] = Math.max(0, (speeds[k] as number) - total);
    }
  }
  // HINDERING armor: "You take a -5 penalty to all your Speeds (to a minimum of a 5-foot Speed).
  // This is separate from and in addition to the armor's Speed penalty, and affects you even if your
  // Strength or an ability lets you reduce or ignore the armor's Speed penalty."
  //
  // Which is why it is applied HERE and not folded into `armorPenalty`: it must survive both the
  // Strength reduction above and Unburdened Iron's `ignoreArmor`, and its floor is 5 feet, not 0.
  if ((worn?.armor.traits ?? []).includes('hindering')) {
    for (const k of Object.keys(speeds) as (keyof Speeds)[]) {
      const v = speeds[k];
      // A Speed already at or below the 5-foot floor is left alone — the floor is a floor, not a set.
      if (v != null && v > 5) speeds[k] = Math.max(5, v - 5);
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
    // Heavy Construction restats the innovation's Bulk (2 -> 3). Read the ridden item so the
    // encumbrance total agrees with the armour the rest of the sheet is showing.
    const eff = item.itemType === 'armor' && inv.designations?.length ? applyArmorRiders(c, db, inv, item).armor : item;
    const own = eff.bulk * inv.quantity;
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
  // "Increase your maximum and encumbered Bulk limits by 4" (Beast of Burden) and "treat heavy armor
  // as 1 Bulk lighter" (Armor Regiment Training). Both thresholds were computed from Strength alone,
  // so these feats moved no number on the sheet at all.
  let limitBonus = 0;
  const armorCuts: { by: number; categories?: ArmorCategory[] }[] = [];
  // `?? []` because deriveBulk is also called on hand-built partial characters (container-nesting tests).
  for (const fc of c.feats ?? []) {
    const f = db.feats[fc.featId];
    if (f?.bulkLimitBonus) limitBonus += f.bulkLimitBonus;
    if (f?.armorBulkReduction) armorCuts.push(f.armorBulkReduction);
  }
  // An armour PROPERTY RUNE can raise the thresholds too — Assisting sets them to 6 + Str and
  // 11 + Str. Only while the armour is actually worn and invested, since the rune's own text keys
  // off investing it. Highest wins rather than summing: two of the same rune is still one set of
  // supports, and these are the same untyped thresholds a single item bonus would move.
  let runeBonus = 0;
  for (const inv of c.inventory ?? []) {
    if (!inv.worn || !inv.invested) continue;
    for (const r of propertyRuneDefs(inv, db)) runeBonus = Math.max(runeBonus, r.passiveEffects?.bulkLimitBonus ?? 0);
  }
  limitBonus += runeBonus;
  /** How much Bulk this feat set forgives on a given worn item — armour only, and never below 0. */
  const armorRelief = (inv: InventoryItem): number => {
    if (!armorCuts.length || !inv.worn) return 0;
    const item = db.items[inv.itemId];
    if (!item || item.itemType !== 'armor') return 0;
    const cat = item.category as ArmorCategory | undefined;
    const by = armorCuts
      .filter((r) => !r.categories?.length || (cat && r.categories.includes(cat)))
      .reduce((s, r) => s + r.by, 0);
    return Math.min(by, item.bulk * inv.quantity);
  };
  const { effBulk, containerIds } = makeEffBulk(c, db);
  const topLevel = c.inventory.filter((i) => !(i.containerInstanceId && containerIds.has(i.containerInstanceId)));
  let total = topLevel.reduce((s, inv) => s + effBulk(inv, new Set()) - armorRelief(inv), 0);
  // 1,000 coins = 1 Bulk. NOTE: the app keeps Bulk as a precise fractional sum (informative, and the
  // container-nesting reduction relies on it) rather than RAW-flooring Light/coin remainders.
  const coins = (c.currency.pp ?? 0) + (c.currency.gp ?? 0) + (c.currency.sp ?? 0) + (c.currency.cp ?? 0);
  total += coins / 1000;
  total = Math.max(0, Math.round(total * 10) / 10);
  return { total, encTotal: Math.floor(total), encumberedAt: 5 + strMod + limitBonus, max: 10 + strMod + limitBonus };
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

/** A container an item may be stowed into, from the perspective of one inventory item. */
export interface ContainerOption {
  instanceId: string;
  name: string;
  capacity?: number;
  used: number;
  /** Free Bulk if the item were placed here (its own Bulk discounted if it's already inside). */
  remaining?: number;
  /** Whether the item's effective Bulk fits the remaining capacity. */
  fits: boolean;
  /** Whether the item is currently stowed in this container. */
  current: boolean;
}

/** The containers `instanceId` may be stowed into: every container in the inventory EXCEPT the item
 *  itself and any of its own descendants (which would form a cycle), each flagged with whether the
 *  item fits the remaining capacity. Mirrors InventoryTab's drag `canDrop`/`fitsIn` rules so a
 *  tap-to-stow control agrees with drag-and-drop. Takes the raw inventory so non-sheet callers (the
 *  item-detail popup) don't need a full Character — the derive helpers only read `.inventory`. */
export function containerOptionsFor(inventory: InventoryItem[], db: ContentDatabase, instanceId: string): ContainerOption[] {
  const c = { inventory } as Character;
  const inv = inventory.find((i) => i.instanceId === instanceId);
  if (!inv) return [];
  const { containerIds } = childrenByContainer(c, db);
  const loads = containerLoads(c, db);
  const effB = effectiveItemBulk(c, db, instanceId);
  const isInside = (childId: string, ancestorId: string): boolean => {
    let cur = inventory.find((i) => i.instanceId === childId);
    const seen = new Set<string>();
    while (cur?.containerInstanceId && !seen.has(cur.containerInstanceId)) {
      if (cur.containerInstanceId === ancestorId) return true;
      seen.add(cur.containerInstanceId);
      cur = inventory.find((i) => i.instanceId === cur!.containerInstanceId);
    }
    return false;
  };
  const opts: ContainerOption[] = [];
  for (const cont of inventory) {
    if (!containerIds.has(cont.instanceId)) continue; // only containers
    if (cont.instanceId === instanceId) continue; // not itself
    if (isInside(cont.instanceId, instanceId)) continue; // not into its own descendant (cycle)
    const load = loads[cont.instanceId] ?? { used: 0, capacity: undefined };
    const already = inv.containerInstanceId === cont.instanceId;
    const cap = load.capacity;
    const base = load.used - (already ? effB : 0); // load without this item
    opts.push({
      instanceId: cont.instanceId,
      name: db.items[cont.itemId]?.name ?? 'Container',
      capacity: cap,
      used: load.used,
      remaining: cap == null ? undefined : Math.round((cap - base) * 10) / 10,
      fits: cap == null ? true : base + effB <= cap + 1e-9,
      current: already,
    });
  }
  return opts;
}
