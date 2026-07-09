/*
 * Stat "explainer" — turns any sheet number into a breakdown the detail panel shows:
 * the calculation (each addend + its source), a level-by-level timeline of what produced
 * it, and a short description. Pure; derived on demand from the Character (+ optional
 * BuildState for the attribute-boost history).
 */
import type {
  AbilityId,
  Character,
  ContentDatabase,
  ProficiencyKey,
  ProficiencyRank,
  SaveId,
  Speeds,
  SpellcastingEntry,
} from './types';
import type { BuildState } from './build';
import { CLASS_ADVANCEMENT } from './advancement';
import { conditionPenalty } from './conditions';
import { modeModifiersFor, hasConditionalMode, type ModeTarget } from './modes';
import { abpOn, abpSave, abpPerception, abpDefense, abpSkillBonus } from './abp';
import {
  RANK_VALUE,
  abilityMod,
  activeStanceDef,
  deriveAc,
  deriveArmorCheckPenalty,
  deriveClassDc,
  deriveMaxHp,
  derivePerception,
  deriveSave,
  resilientSaveBonus,
  deriveSkill,
  deriveSpeeds,
  deriveSpellcasting,
  deriveStrikes,
  formatMod,
  mpSenseSkillItemBonus,
  profBonus,
  pwl,
  shieldSwappedModes,
} from './derive';

export type StatRef =
  | { kind: 'skill'; skill: ProficiencyKey }
  | { kind: 'save'; save: SaveId }
  | { kind: 'perception' }
  | { kind: 'ac' }
  | { kind: 'classDc' }
  | { kind: 'spell'; entryId: string; which: 'dc' | 'attack' }
  | { kind: 'ability'; ability: AbilityId }
  | { kind: 'hp' }
  | { kind: 'speed' }
  | { kind: 'strikeAttack'; instanceId: string }
  | { kind: 'strikeDamage'; instanceId: string };

export interface CalcPart {
  label: string;
  note?: string;
  value: number;
}
export interface TimelineEntry {
  level: number;
  text: string;
  detail?: string;
  rank?: ProficiencyRank;
}
export interface StatBreakdown {
  title: string;
  subtitle?: string;
  totalText: string;
  rank?: ProficiencyRank;
  parts: CalcPart[];
  timeline: TimelineEntry[];
  description?: string;
  /** Present for d20 checks — drives the Roll button. */
  roll?: { label: string; modifier: number };
  /** Present for skills (incl. Perception) — drives the actions list. */
  skill?: string;
  /** Conditional mode modifiers ("+1 status from Inspire Courage — when …") not folded
   *  into the number; shown so the player can apply them situationally. */
  situational?: string[];
}

const ABIL_LABEL: Record<AbilityId, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};
export const RANK_LABEL: Record<ProficiencyRank, string> = {
  untrained: 'Untrained',
  trained: 'Trained',
  expert: 'Expert',
  master: 'Master',
  legendary: 'Legendary',
};
const SAVE_ABILITY: Record<SaveId, AbilityId> = { fortitude: 'con', reflex: 'dex', will: 'wis' };
const SKILL_ABILITY: Record<string, AbilityId> = {
  acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int', deception: 'cha', diplomacy: 'cha',
  intimidation: 'cha', medicine: 'wis', nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
  society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
};
function skillAbilityOf(key: ProficiencyKey): AbilityId {
  return key.startsWith('lore:') ? 'int' : SKILL_ABILITY[key] ?? 'int';
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** "second-doctrine (cloistered)" -> "Second doctrine (cloistered)". */
function humanize(slug?: string): string | undefined {
  if (!slug) return undefined;
  return cap(slug.replace(/[-_]/g, ' '));
}
export function skillLabel(key: ProficiencyKey): string {
  if (key.startsWith('lore:')) return cap(key.slice(5)) + ' Lore';
  return cap(key);
}

/** Map a clickable StatRef to a mode target (for the underline cue), or null if modes
 *  can't target it (HP / ability score). */
function refToModeTarget(ref: StatRef): ModeTarget | null {
  switch (ref.kind) {
    case 'save': return { kind: 'save', detail: ref.save };
    case 'skill': return { kind: 'skill', detail: ref.skill };
    case 'perception': return { kind: 'perception' };
    case 'ac': return { kind: 'ac' };
    case 'classDc': return { kind: 'class-dc' };
    case 'spell': return { kind: ref.which === 'dc' ? 'spell-dc' : 'spell-attack' };
    default: return null;
  }
}
/** True if an active CONDITIONAL mode targets this stat — the sheet underlines it. */
export function statHasConditionalMode(c: Character, ref: StatRef): boolean {
  const t = refToModeTarget(ref);
  return t ? hasConditionalMode(c.activeModes, t) : false;
}

const DESC: Record<string, string> = {
  acrobatics: 'Balance, tumble, and escape using agility and coordination.',
  arcana: 'Knowledge of arcane magic and theory, and creatures of arcane origin.',
  athletics: 'Climb, swim, jump, and overpower foes with raw physical prowess.',
  crafting: 'Build, repair, and identify items, and Earn Income through your trade.',
  deception: 'Lie, feint, and create diversions to mislead others.',
  diplomacy: 'Persuade, gather information, and improve attitudes through tact.',
  intimidation: 'Coerce and demoralize others through threats and force of personality.',
  medicine: 'Treat wounds, stabilize the dying, and counteract diseases and poisons.',
  nature: 'Knowledge of the natural world, animals, weather, and primal magic.',
  occultism: 'Knowledge of esoteric lore, spirits, and the occult tradition.',
  performance: 'Entertain and impress an audience, and Earn Income performing.',
  religion: 'Knowledge of the divine, religious traditions, and divine creatures.',
  society: 'Knowledge of civilization, customs, history, and languages.',
  stealth: 'Hide, Sneak, and conceal objects to avoid notice.',
  survival: 'Track, forage, navigate the wild, and endure harsh environments.',
  thievery: 'Pick locks, disable devices, palm objects, and pick pockets.',
  lore: 'Specialized knowledge of a narrow subject — Recall Knowledge and Earn Income.',
  fortitude: 'Resists poison, disease, and other assaults on your health (Constitution).',
  reflex: 'Avoids area effects, traps, and other dangers through agility (Dexterity).',
  will: 'Resists fear, mental effects, and assaults on your mind (Wisdom).',
  perception: 'How keenly you notice things — Seek, sense danger, and roll initiative (Wisdom).',
  ac: 'How hard you are to hit: 10 + Dexterity (capped by armor) + proficiency + your armor’s bonus.',
  classDc: 'The DC enemies roll against for your class’s special abilities.',
  hp: 'Your Hit Points: ancestry HP plus (class HP + Constitution modifier) for each level.',
};

function profPart(rank: ProficiencyRank, level: number, withoutLevel = false): CalcPart {
  if (rank === 'untrained')
    return withoutLevel
      ? { label: 'Untrained', note: 'rank penalty, level not added', value: -2 }
      : { label: 'Untrained', note: 'no proficiency (level not added)', value: 0 };
  return withoutLevel
    ? { label: `Proficiency — ${RANK_LABEL[rank]}`, note: `+${RANK_VALUE[rank]} (level not added)`, value: profBonus(rank, level, true) }
    : { label: `Proficiency — ${RANK_LABEL[rank]}`, note: `level ${level} + ${RANK_VALUE[rank]}`, value: profBonus(rank, level) };
}
function abilityPart(c: Character, ability: AbilityId): CalcPart {
  return { label: `${ABIL_LABEL[ability]} modifier`, note: `${ABIL_LABEL[ability]} ${c.abilities[ability]}`, value: abilityMod(c.abilities[ability]) };
}
function conditionPart(c: Character, ability: AbilityId, slot: Parameters<typeof conditionPenalty>[2]): CalcPart | null {
  const v = conditionPenalty(c.conditions, ability, slot);
  return v ? { label: 'Condition penalty', value: v } : null;
}
/** Push UNCONDITIONAL active-mode modifiers for a target into `parts` (they're folded into
 *  the number) and return the CONDITIONAL ones as "situational" note strings. */
function modeAdjust(c: Character, target: ModeTarget, parts: CalcPart[]): string[] {
  const situational: string[] = [];
  const uncond: { mode: string; type: string; value: number }[] = [];
  for (const { mode, mod } of modeModifiersFor(c.activeModes, target)) {
    const typed = mod.type === 'untyped' ? 'untyped' : mod.type;
    if (mod.appliesWhen) situational.push(`${formatMod(mod.value)} ${typed} from ${mode} — ${mod.appliesWhen}`);
    else uncond.push({ mode, type: typed, value: mod.value });
  }
  // Same-type bonuses/penalties don't stack — only the best bonus and worst penalty of each typed
  // category count (untyped all sum), exactly as modeNumberBonus folds them into the number. Show
  // superseded same-type modifiers at 0 with a "doesn't stack" note so the listed parts still sum to
  // the total.
  const winner = new Map<string, number>(); // `${type}|${sign}` -> best-magnitude value
  for (const u of uncond) {
    if (u.type === 'untyped') continue;
    const key = `${u.type}|${u.value >= 0 ? '+' : '-'}`;
    const cur = winner.get(key);
    if (cur === undefined || Math.abs(u.value) > Math.abs(cur)) winner.set(key, u.value);
  }
  const claimed = new Set<string>();
  for (const u of uncond) {
    const sign = u.value >= 0 ? 'bonus' : 'penalty';
    if (u.type === 'untyped') {
      parts.push({ label: u.mode, note: `untyped ${sign}`, value: u.value });
      continue;
    }
    const key = `${u.type}|${u.value >= 0 ? '+' : '-'}`;
    if (winner.get(key) === u.value && !claimed.has(key)) {
      claimed.add(key);
      parts.push({ label: u.mode, note: `${u.type} ${sign}`, value: u.value });
    } else {
      parts.push({ label: u.mode, note: `${u.type} ${sign} — doesn't stack`, value: 0 });
    }
  }
  return situational;
}

/** The class advancement entries (subclass override first) up to the character's level. */
function advancementFor(c: Character) {
  const list = (c.subclassId && CLASS_ADVANCEMENT[c.subclassId]) || (c.classId && CLASS_ADVANCEMENT[c.classId]) || [];
  return list.filter((e) => e.level <= c.level);
}

/** Timeline for a class-advancement track (saves / perception / classDc / spellcasting / armor),
 *  seeded with the class's level-1 base rank. */
function profTimeline(c: Character, db: ContentDatabase, track: string, baseRank: ProficiencyRank, label: string): TimelineEntry[] {
  const cls = c.classId ? db.classes[c.classId] : undefined;
  const out: TimelineEntry[] = [];
  if (baseRank !== 'untrained') {
    out.push({ level: 1, text: `${RANK_LABEL[baseRank]} ${label}`, detail: cls ? `from your ${cls.name}` : undefined, rank: baseRank });
  }
  for (const e of advancementFor(c).filter((e) => e.track === track).sort((a, b) => a.level - b.level)) {
    out.push({ level: e.level, text: `Raised to ${RANK_LABEL[e.rank]}`, detail: humanize(e.source), rank: e.rank });
  }
  return out;
}

const PROF_ORDER: ProficiencyRank[] = ['untrained', 'trained', 'expert', 'master', 'legendary'];

/** Build the full breakdown for any sheet stat. `build` (optional) enriches the
 *  attribute-boost history for ability scores. */
export function explainStat(c: Character, db: ContentDatabase, ref: StatRef, build?: BuildState): StatBreakdown {
  const lvl = c.level;
  switch (ref.kind) {
    case 'skill': {
      const d = deriveSkill(c, ref.skill, db);
      const ability = skillAbilityOf(ref.skill);
      const parts: CalcPart[] = [profPart(d.rank, lvl, pwl(c)), abilityPart(c, ability)];
      // Skill item bonus — the higher of ABP skill potency and a Monster-Parts refined skill item (they
      // don't stack; deriveSkill takes the max). List whichever wins so the parts reconcile with the total.
      const abpSp = abpOn(c) ? abpSkillBonus(c, ref.skill) : 0;
      const mpSp = mpSenseSkillItemBonus(c, 'skill', ref.skill);
      const skillItem = Math.max(abpSp, mpSp);
      if (skillItem) parts.push({ label: mpSp > abpSp ? 'Monster Parts (refined)' : 'ABP skill potency', note: 'item bonus', value: skillItem });
      if (ability === 'str' || ability === 'dex') {
        const acp = deriveArmorCheckPenalty(c, db);
        if (acp.value) parts.push({ label: 'Armor check penalty', note: acp.source ?? undefined, value: acp.value });
      }
      const cond = conditionPart(c, ability, 'skill');
      if (cond) parts.push(cond);
      const situational = modeAdjust(c, { kind: 'skill', detail: ref.skill }, parts);
      // timeline: trained at L1 + each skill increase for this skill
      const timeline: TimelineEntry[] = [];
      if (d.rank !== 'untrained') {
        const bg = c.backgroundId ? db.backgrounds[c.backgroundId] : undefined;
        const cls = c.classId ? db.classes[c.classId] : undefined;
        const fixed = (cls?.trainedSkills.fixed ?? []) as string[];
        const src =
          bg?.trainedSkill === ref.skill
            ? `from the ${bg.name} background`
            : fixed.includes(ref.skill)
              ? `from your ${cls!.name}`
              : 'a trained skill';
        timeline.push({ level: 1, text: 'Trained', detail: src, rank: 'trained' });
        let rank: ProficiencyRank = 'trained';
        for (const si of (c.skillIncreases ?? []).filter((s) => s.skill === ref.skill && s.level <= lvl).sort((a, b) => a.level - b.level)) {
          rank = PROF_ORDER[Math.min(PROF_ORDER.length - 1, PROF_ORDER.indexOf(rank) + 1)];
          timeline.push({ level: si.level, text: `Skill increase → ${RANK_LABEL[rank]}`, rank });
        }
      }
      return {
        title: skillLabel(ref.skill),
        subtitle: `${ABIL_LABEL[ability]} skill`,
        totalText: formatMod(d.modifier),
        rank: d.rank,
        parts,
        timeline,
        description: DESC[ref.skill.startsWith('lore:') ? 'lore' : ref.skill],
        roll: { label: skillLabel(ref.skill), modifier: d.modifier },
        skill: ref.skill.startsWith('lore:') ? 'lore' : ref.skill,
        situational,
      };
    }
    case 'save': {
      const d = deriveSave(c, ref.save, db);
      const ability = SAVE_ABILITY[ref.save];
      const cls = c.classId ? db.classes[c.classId] : undefined;
      const parts: CalcPart[] = [profPart(d.rank, lvl, pwl(c)), abilityPart(c, ability)];
      if (abpOn(c)) {
        const v = abpSave(lvl);
        if (v) parts.push({ label: 'ABP save potency', note: 'item bonus (replaces resilient)', value: v });
      } else {
        const resilient = resilientSaveBonus(c, db);
        if (resilient) parts.push({ label: 'Resilient rune', note: 'item bonus', value: resilient });
      }
      const cond = conditionPart(c, ability, 'save');
      if (cond) parts.push(cond);
      const situational = modeAdjust(c, { kind: 'save', detail: ref.save }, parts);
      return {
        title: cap(ref.save),
        subtitle: 'Saving throw',
        totalText: formatMod(d.modifier),
        rank: d.rank,
        parts,
        timeline: profTimeline(c, db, ref.save, cls?.saves[ref.save] ?? 'trained', `in ${cap(ref.save)}`),
        description: DESC[ref.save],
        roll: { label: cap(ref.save), modifier: d.modifier },
        situational,
      };
    }
    case 'perception': {
      const d = derivePerception(c);
      const cls = c.classId ? db.classes[c.classId] : undefined;
      const parts: CalcPart[] = [profPart(d.rank, lvl, pwl(c)), abilityPart(c, 'wis')];
      // Perception item bonus — the higher of ABP Perception potency and a Monster-Parts refined-Perception
      // item (they don't stack; derivePerception takes the max). List whichever wins so the parts reconcile.
      const abpPerc = abpOn(c) ? abpPerception(lvl) : 0;
      const mpPerc = mpSenseSkillItemBonus(c, 'perception');
      const percItem = Math.max(abpPerc, mpPerc);
      if (percItem) parts.push({ label: mpPerc > abpPerc ? 'Monster Parts (refined)' : 'ABP Perception potency', note: 'item bonus', value: percItem });
      const cond = conditionPart(c, 'wis', 'perception');
      if (cond) parts.push(cond);
      const situational = modeAdjust(c, { kind: 'perception' }, parts);
      return {
        title: 'Perception',
        subtitle: 'Wisdom',
        totalText: formatMod(d.modifier),
        rank: d.rank,
        parts,
        timeline: profTimeline(c, db, 'perception', cls?.perception ?? 'trained', 'in Perception'),
        description: DESC.perception,
        roll: { label: 'Perception', modifier: d.modifier },
        skill: 'perception',
        situational,
      };
    }
    case 'ac': {
      const ac = deriveAc(c, db);
      const dex = abilityMod(c.abilities.dex);
      const dexContribution = ac.dexCap != null ? Math.min(dex, ac.dexCap) : dex;
      const worn = c.inventory.map((i) => ({ i, it: db.items[i.itemId] })).find((x) => x.i.worn && x.it?.itemType === 'armor');
      const armor = worn && worn.it?.itemType === 'armor' ? worn.it : null;
      const category = armor?.category ?? 'unarmored';
      const cls = c.classId ? db.classes[c.classId] : undefined;
      const stance = activeStanceDef(c, db);
      // The Dex cap can come from worn armor OR the active stance (e.g. Mountain Stance +0). Attribute it
      // to whichever actually imposes it, and only say "by armor" when armor is worn and is the source.
      const stanceDexCap = stance?.dexCap;
      const capBy = ac.dexCap != null && dex > ac.dexCap ? (armor && (stanceDexCap == null || armor.dexCap === ac.dexCap) ? `by ${armor.name}` : stance ? `by ${stance.name ?? 'stance'}` : '') : '';
      const parts: CalcPart[] = [
        { label: 'Base', value: 10 },
        { label: 'Dexterity modifier', note: ac.dexCap != null && dex > ac.dexCap ? `capped at +${ac.dexCap}${capBy ? ' ' + capBy : ''}` : `Dexterity ${c.abilities.dex}`, value: dexContribution },
        profPart(ac.rank, lvl, pwl(c)),
      ];
      if (armor) {
        // ABP defense potency replaces the armor potency rune's numeric bonus (shown separately below).
        const runePotency = (worn!.i.runes as { potency?: number } | undefined)?.potency ?? 0;
        const potency = abpOn(c) ? 0 : runePotency;
        parts.push({ label: `${armor.name}`, note: potency ? `+${armor.acBonus} armor + ${potency} potency` : 'armor item bonus', value: armor.acBonus + potency });
      }
      if (abpOn(c)) {
        const v = abpDefense(lvl);
        if (v) parts.push({ label: 'ABP defense potency', note: 'item bonus', value: v });
      }
      const cond = conditionPart(c, 'dex', 'ac');
      if (cond) parts.push(cond);
      // An AC-granting stance (Mountain +4, Crane +1, …) is folded into the AC total by deriveAc; list it so
      // the itemized parts reconcile with the total.
      const stanceAc = stance?.acBonus?.value ?? 0;
      if (stanceAc) parts.push({ label: stance!.name ?? 'Stance', note: `${stance!.acBonus!.type} bonus`, value: stanceAc });
      // Use the shield-swapped modes so the "Raise a Shield" line shows the real shield bonus (buckler
      // +1, fortress +3) and the parts reconcile with the AC total (which deriveAc computes the same way).
      const situational = modeAdjust({ ...c, activeModes: shieldSwappedModes(c, db) }, { kind: 'ac' }, parts);
      return {
        title: 'Armor class',
        subtitle: armor ? `${cap(category)} armor` : 'Unarmored',
        totalText: String(ac.value),
        rank: ac.rank,
        parts,
        timeline: profTimeline(c, db, category, cls?.defenses[category] ?? 'trained', `in ${category === 'unarmored' ? 'unarmored defense' : `${category} armor`}`),
        description: DESC.ac,
        situational,
      };
    }
    case 'classDc': {
      const d = deriveClassDc(c);
      const key = c.keyAbility ?? 'str';
      const cls = c.classId ? db.classes[c.classId] : undefined;
      const parts: CalcPart[] = [
        { label: 'Base', value: 10 },
        profPart(d.rank, lvl, pwl(c)),
        abilityPart(c, key),
      ];
      const cond = conditionPart(c, key, 'class-dc');
      if (cond) parts.push(cond);
      const situational = modeAdjust(c, { kind: 'class-dc' }, parts);
      return {
        title: 'Class DC',
        subtitle: `${ABIL_LABEL[key]} key attribute`,
        totalText: String(d.dc),
        rank: d.rank,
        parts,
        timeline: profTimeline(c, db, 'classDc', cls?.classDc ?? 'trained', 'in your class DC'),
        description: DESC.classDc,
        situational,
      };
    }
    case 'spell': {
      const entry = c.spellcasting.find((e) => e.id === ref.entryId) as SpellcastingEntry | undefined;
      if (!entry) return { title: 'Spellcasting', totalText: '—', parts: [], timeline: [] };
      const sc = deriveSpellcasting(c, entry);
      const isDc = ref.which === 'dc';
      const parts: CalcPart[] = [];
      if (isDc) parts.push({ label: 'Base', value: 10 });
      parts.push(profPart(entry.proficiency, lvl, pwl(c)), abilityPart(c, entry.keyAbility));
      const cond = conditionPart(c, entry.keyAbility, isDc ? 'spell-dc' : 'spell-attack');
      if (cond) parts.push(cond);
      const situational = modeAdjust(c, { kind: isDc ? 'spell-dc' : 'spell-attack' }, parts);
      return {
        title: isDc ? 'Spell DC' : 'Spell attack',
        subtitle: `${cap(entry.tradition)} · ${ABIL_LABEL[entry.keyAbility]}`,
        totalText: isDc ? String(sc.dc) : formatMod(sc.attack),
        rank: entry.proficiency,
        parts,
        timeline: profTimeline(c, db, 'spellcasting', 'trained', 'in spellcasting'),
        description: 'Your spellcasting proficiency sets both your spell attack roll and the DC your targets save against.',
        roll: isDc ? undefined : { label: `${cap(entry.tradition)} spell attack`, modifier: sc.attack },
        situational,
      };
    }
    case 'ability': {
      const score = c.abilities[ref.ability];
      const mod = abilityMod(score);
      const parts: CalcPart[] = [
        { label: 'Base', value: 10 },
        { label: 'Boosts & flaws', note: `score ${score}`, value: score - 10 },
      ];
      const timeline: TimelineEntry[] = [];
      if (build) {
        const a = ref.ability;
        const anc = build.ancestryId ? db.ancestries[build.ancestryId] : undefined;
        if (anc?.abilityFlaws?.includes(a)) timeline.push({ level: 1, text: 'Ancestry flaw −2' });
        if (build.ancestryBoosts?.includes(a) || build.backgroundBoosts?.includes(a) || build.levelBoosts?.includes(a) || build.keyAbility === a)
          timeline.push({ level: 1, text: 'Boosted at level 1', detail: 'ancestry / background / class / free boosts' });
        for (const [lvlStr, picks] of Object.entries(build.attributeBoosts ?? {})) {
          if ((picks as (AbilityId | null)[]).includes(a) && Number(lvlStr) <= lvl) timeline.push({ level: Number(lvlStr), text: 'Attribute boost +2 (or +1 past 18)' });
        }
        timeline.sort((x, y) => x.level - y.level);
      }
      return {
        title: ABIL_LABEL[ref.ability],
        subtitle: `Modifier ${formatMod(mod)}`,
        totalText: String(score),
        parts,
        timeline,
        description: `Your ${ABIL_LABEL[ref.ability]} score is ${score}, giving a ${formatMod(mod)} modifier that feeds attacks, DCs, skills, and saves keyed to ${ABIL_LABEL[ref.ability]}.`,
      };
    }
    case 'hp': {
      const max = deriveMaxHp(c, db);
      const anc = c.ancestryId ? db.ancestries[c.ancestryId] : undefined;
      const cls = c.classId ? db.classes[c.classId] : undefined;
      // A manual max-HP override replaces the whole calculation — show it as a single part.
      if (c.hitPoints.maxOverride != null) {
        return {
          title: 'Hit points',
          subtitle: `Maximum ${max}`,
          totalText: String(max),
          parts: [{ label: 'Manual maximum (override)', value: max }],
          timeline: [],
          description: DESC.hp,
        };
      }
      const conMod = abilityMod(c.abilities.con);
      // Dual Class uses the HIGHER per-level HP of the two classes (matches deriveMaxHp).
      const cls2 = c.variantRules?.dualClass && c.classId2 ? db.classes[c.classId2] : undefined;
      const hpPer = Math.max(cls?.hpPerLevel ?? 0, cls2?.hpPerLevel ?? 0);
      const perLevel = hpPer + conMod;
      // Feats that raise/lower max HP (Toughness +level, Thick Hide Mask +20, …).
      const featParts = c.feats
        .map((f) => ({ feat: db.feats[f.featId], b: db.feats[f.featId]?.maxHpBonus }))
        .filter((x) => x.b)
        .map((x) => ({ label: x.feat?.name ?? 'Feat', value: (x.b!.perLevel ?? 0) * lvl + (x.b!.flat ?? 0) }));
      return {
        title: 'Hit points',
        subtitle: `Maximum ${max}`,
        totalText: String(max),
        parts: [
          { label: 'Ancestry HP', note: anc?.name, value: anc?.hp ?? 0 },
          { label: `(${hpPer} class + ${conMod} Con) × ${lvl} levels`, value: perLevel * lvl },
          ...featParts,
        ],
        timeline: [],
        description: DESC.hp,
      };
    }
    case 'speed': {
      const speeds = deriveSpeeds(c, db);
      const ancestry = c.ancestryId ? db.ancestries[c.ancestryId] : undefined;
      const ancestryLand = ancestry?.speeds?.land ?? 0;

      // Pre-armor land Speed: the ancestry base, raised by any unconditional land grant
      // (rare — most heritage/feat grants are non-land speeds).
      let preArmorLand = ancestryLand;
      let landGrantSource: string | undefined;
      const grantSources: { name?: string; speeds?: Partial<Speeds> }[] = [];
      if (c.heritageId && db.heritages[c.heritageId]) grantSources.push(db.heritages[c.heritageId]);
      for (const f of c.feats) {
        const ft = db.feats[f.featId];
        if (ft) grantSources.push(ft);
      }
      for (const src of grantSources) {
        const g = src.speeds?.land;
        if (typeof g === 'number' && g > preArmorLand) {
          preArmorLand = g;
          landGrantSource = src.name;
        }
      }

      const naturalLand = speeds.land ?? 0;
      const parts: CalcPart[] = [];
      if (ancestryLand) parts.push({ label: 'Ancestry Speed', note: ancestry?.name, value: ancestryLand });
      if (preArmorLand > ancestryLand) parts.push({ label: 'Speed increase', note: landGrantSource, value: preArmorLand - ancestryLand });
      const penalty = preArmorLand - naturalLand;
      if (penalty > 0) parts.push({ label: 'Armor Speed penalty', note: 'heavy armor or unmet Strength', value: -penalty });

      // Temporary in-play override (Hasted/Slowed/etc.) — folded into the total so the math reads cleanly.
      const override = c.speedOverride;
      const hasTemp = override != null && override !== naturalLand;
      if (hasTemp) parts.push({ label: 'Temporary Speed', note: 'in play — reset to return to default', value: override! - naturalLand });
      const effectiveLand = hasTemp ? override! : naturalLand;

      const others = (['fly', 'swim', 'climb', 'burrow'] as const)
        .filter((k) => speeds[k] != null)
        .map((k) => `${cap(k)} ${speeds[k]} ft`);

      return {
        title: 'Speed',
        subtitle: others.length ? others.join(' · ') : 'Land Speed',
        totalText: `${effectiveLand} ft`,
        parts,
        timeline: [],
        description: hasTemp
          ? `Your land Speed is temporarily set to ${effectiveLand} ft (normally ${naturalLand} ft). Reset it to return to your default Speed.`
          : 'Your Speed is how far you Stride, in feet. Land Speed comes from your ancestry and is reduced by heavy armor you lack the Strength for; other movement types come from your ancestry, heritage, or feats.',
      };
    }
    case 'strikeAttack': {
      const strike = deriveStrikes(c, db).find((s) => s.instanceId === ref.instanceId);
      if (!strike) return { title: 'Strike', totalText: '—', parts: [], timeline: [] };
      const parts: CalcPart[] = [profPart(strike.rank, lvl, pwl(c)), abilityPart(c, strike.atkAbility)];
      if (strike.potencyBonus)
        parts.push({
          label: strike.mpRefined ? 'Monster Parts refinement' : abpOn(c) ? 'ABP attack potency' : 'Weapon potency rune',
          note: 'item bonus',
          value: strike.potencyBonus,
        });
      const cond = conditionPart(c, strike.atkAbility, 'attack');
      if (cond) parts.push(cond);
      const situational = modeAdjust(c, { kind: 'attack' }, parts);
      return {
        title: strike.name,
        subtitle: 'Attack roll',
        totalText: formatMod(strike.attack[0]),
        rank: strike.rank,
        parts,
        timeline: [],
        description: `Your attack-roll modifier. Multiple attack penalty: ${formatMod(-strike.mapStep)} on a second attack this turn, ${formatMod(-strike.mapStep * 2)} on a third.`,
        roll: { label: `${strike.name} attack`, modifier: strike.attack[0] },
        situational,
      };
    }
    case 'strikeDamage': {
      const strike = deriveStrikes(c, db).find((s) => s.instanceId === ref.instanceId);
      if (!strike) return { title: 'Strike', totalText: '—', parts: [], timeline: [] };
      const parts: CalcPart[] = [];
      // Kineticist Elemental Blast: Con is a 2-action STATUS bonus, not a normal ability-to-damage.
      const isBlast = strike.instanceId.startsWith('blast:');
      if (strike.dmgAbility) {
        const full = abilityMod(c.abilities[strike.dmgAbility]);
        const note = isBlast
          ? '2-action status bonus'
          : strike.dmgAbMod !== full
            ? 'half (propulsive)'
            : `${ABIL_LABEL[strike.dmgAbility]} ${c.abilities[strike.dmgAbility]}`;
        parts.push({
          label: isBlast ? `${ABIL_LABEL[strike.dmgAbility]} (2 actions)` : `${ABIL_LABEL[strike.dmgAbility]} modifier`,
          note,
          value: strike.dmgAbMod,
        });
      }
      if (strike.specDamage) parts.push({ label: 'Weapon specialization', value: strike.specDamage });
      // Enfeebled/etc. hits the actual damage ability (Str, or Dex under the thief racket); blasts add none.
      if (strike.dmgAbility === 'str' || strike.dmgAbility === 'dex') {
        const cond = conditionPart(c, strike.dmgAbility, 'damage');
        if (cond) parts.push(cond);
      }
      const situational = modeAdjust(c, { kind: 'damage' }, parts);
      // Surface conditional precision/sneak riders (they aren't in the flat total) alongside the
      // situational mode notes so the breakdown matches the annotated strike row.
      for (const r of strike.conditionalDamage ?? []) situational.push(`+${r.text} — ${r.note}`);
      return {
        title: strike.name,
        subtitle: `Damage · ${strike.damage}`,
        totalText: formatMod(strike.dmgBonus),
        parts,
        timeline: [],
        description: `The flat damage bonus added to each hit. Your full damage roll is ${strike.damage} — the dice (and any rune riders) are rolled, then this bonus is added.`,
        situational,
      };
    }
  }
}
