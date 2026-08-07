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
  SpeedGrants,
  SpellcastingEntry,
  ArmorRunes,
} from './types';
import type { BuildState } from './build';
import { CLASS_ADVANCEMENT } from './advancement';
import { deriveInitiative } from './initiative';
import { conditionPenalty } from './conditions';
import { modeModifiersFor, hasConditionalMode, activeModesTouch, type ModeTarget } from './modes';
import { abpOn, abpSave, abpPerception, abpDefense, abpSkillBonus } from './abp';
import type { CharacterDefenses } from './derive';
import {
  wornArmorOf,
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
  ownedFeatureIds,
  passiveItemBonusDetail,
  dynamicItemSkillBonus,
  mpActive,
  shieldSwappedModes,
  skillSubstitutions,
} from './derive';
import { mpArmorRefine } from './monsterParts';
import { traitLabel } from './glossary';
import {
  featSituationalFor,
  hasFeatSituational,
  markersFor,
  poolSituationalLines,
  spellMarkersFor,
  supersededIds,
  type ExtraSituational,
  type SituationalBonus,
  type SituationalLine,
} from './situationalBonuses';

export type StatRef =
  | { kind: 'skill'; skill: ProficiencyKey }
  | { kind: 'save'; save: SaveId }
  | { kind: 'perception' }
  | { kind: 'ac' }
  | { kind: 'classDc' }
  | { kind: 'spell'; entryId: string; which: 'dc' | 'attack' }
  // Damage dealt by your spells. It has no computed total of its own — the number lives on each
  // spell — so this row exists purely to hold the conditional bonuses that modify it.
  | { kind: 'spellDamage'; entryId: string }
  | { kind: 'ability'; ability: AbilityId }
  // Initiative, which READS another statistic — Perception by default, or a skill when the character
  // rolls it with one. Its own kind so 'on initiative' bonuses have somewhere to live that is not
  // Perception, which is where all ~45 of them were filed for want of anywhere better.
  | { kind: 'initiative' }
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
  situational?: SituationalNote[];
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

/**
 * True if ANY active mode touches this stat, conditional or not.
 *
 * Only conditional modifiers used to mark anything: an unconditional one moved the total and left no
 * trace, so a player running Inspire Courage could see their attack was +1 higher but not what had
 * done it. This drives the highlight on every stat a live mode is responsible for.
 */
export function statHasActiveMode(c: Character, ref: StatRef): boolean {
  const t = refToModeTarget(ref);
  return t ? activeModesTouch(c.activeModes, t) : false;
}

/**
 * Every record id whose situational bonuses apply to this character right now.
 *
 * This used to be feats only, which is why the sheet so rarely marked anything: of the 2,355 records
 * that grant a conditional typed bonus, 1,550 are ITEMS and another 200-odd are heritages,
 * backgrounds and class features. None of them could ever raise a star, however good the data got.
 *
 * An ITEM only counts while it is actually in use — equipped, worn or invested. A +1 circumstance
 * bonus from a shield you left in your pack is not a bonus you have, and listing it would be worse
 * than showing nothing.
 *
 * Class features need the ContentDatabase to resolve (they hang off the class), so `db` is optional:
 * callers that have it get feature bonuses too, callers that don't still get everything else rather
 * than nothing.
 */
function characterSituationalIds(c: Character, db?: ContentDatabase): string[] {
  const ids: string[] = c.feats.map((f) => f.featId);
  if (c.ancestryId) ids.push(c.ancestryId);
  if (c.heritageId) ids.push(c.heritageId);
  if (c.backgroundId) ids.push(c.backgroundId);
  if (db) for (const id of ownedFeatureIds(c, db)) ids.push(id);
  // The property rune etched on the character's own body (Living Rune). It sits on no item, so the
  // inventory walk below cannot reach it and its situational bonuses would silently not apply.
  if (c.bodyRune) ids.push(c.bodyRune);
  for (const inv of c.inventory ?? []) {
    if (!(inv.equipped || inv.worn || inv.invested)) continue;
    ids.push(inv.itemId);
    // Etching CONSUMES the loose rune item and records its id here, so `inv.itemId` never names it.
    // Without this, a rune's conditional bonuses vanished at exactly the moment the rune started
    // working — listed while it sat unused in your pack, silent once it was on the weapon.
    for (const rune of inv.runes?.property ?? []) ids.push(rune);
    // ARMOR AND SHIELD TRAITS, under a `trait:` prefix so they can never collide with a record id.
    // Every armor trait in the game was inert — 35 items carry `bulwark` and nothing read it. The
    // worn armor is read THROUGH its riders, so a Heavy Construction innovation's added bulwark
    // counts as well as a printed one.
    const item = db?.items[inv.itemId];
    if (item?.itemType === 'armor' || item?.itemType === 'shield') {
      // Read through BOTH rider lanes: an Armored Skirt adds `noisy`, which is a real trait with real
      // consequences, and reading only the class-feature riders would drop it.
      const traits = item.itemType === 'armor' && db ? (wornArmorOf(c, db)?.armor.traits ?? item.traits) : item.traits;
      for (const t of traits ?? []) ids.push(`trait:${t}`);
    }
  }
  // Ruling G: a completed relic set's entry REPLACES the piece's, so the player reads one line rather
  // than two that look like they add up. Dropped only when the character has both.
  const gone = supersededIds(ids);
  return gone.size ? ids.filter((id) => !gone.has(id)) : ids;
}

/**
 * Conditional entries the player AUTHORED, keyed by the id that grants them — so they reach the
 * sheet by the same route as a shipped one, with no second display path to keep in sync.
 *
 * Only items carry these today (the item editor's Advanced section is what writes them), and only
 * while the item is actually in use, matching `characterSituationalIds` above.
 */
function authoredSituational(c: Character, db?: ContentDatabase): ExtraSituational | undefined {
  if (!db) return undefined;
  let out: Record<string, SituationalBonus[]> | undefined;
  for (const inv of c.inventory ?? []) {
    if (!(inv.equipped || inv.worn || inv.invested)) continue;
    const authored = db.items[inv.itemId]?.situational;
    if (!authored?.length) continue;
    (out ??= {})[inv.itemId] = authored;
  }
  // A CONDITIONAL skill substitution ("use Nature instead of Medicine to Treat Wounds") is exactly a
  // situational note: it does NOT move the skill's number — Natural Medicine's own text says it
  // "doesn't replace Medicine for uses of the skill other than Treat Wounds or for feat
  // prerequisites" — but the player must be told it exists and which record allows it. Only the
  // conditional ones come through here; an unconditional substitution moves the number (deriveSkill).
  for (const s of skillSubstitutions(c, db)) {
    if (!s.when) continue;
    // Keyed by the RECORD's id, because the situational map is only ever consulted for the ids the
    // character actually has — an entry filed under a synthetic key is never looked at.
    ((out ??= {})[s.sourceId] ??= []).push({
      targets: [{ kind: 'skill', detail: s.forSkill }],
      when: `${s.when} — roll ${s.use} instead`,
      bonus: `use ${s.use} (${s.source})`,
    });
  }
  return out;
}

/** True if something the character has grants a SITUATIONAL bonus to this stat, or an active
 *  conditional mode does — either way the sheet flags the stat with a `*` so the player checks its
 *  detail. Pass `db` to include class features. */
export function statHasSituational(c: Character, ref: StatRef, db?: ContentDatabase): boolean {
  if (statHasConditionalMode(c, ref)) return true;
  const ids = characterSituationalIds(c, db);
  const extra = authoredSituational(c, db);
  if (ref.kind !== 'save') return hasFeatSituational(ids, ref, extra);
  // A DC-only entry must NOT star the save's NAME: it gives your own save nothing, and a `*` there
  // would promise a bonus to a roll that never gets one. It stars the DC instead — see
  // `saveDcHasSituational` — and still shows up in the popup so it can be read.
  return featSituationalFor(ids, ref, extra).some((s) => !s.dcOnly);
}

/**
 * True if something raises the SAVE DC others roll against — the `*` that sits beside the DC when
 * "Show save DCs" is on (ruling D: "if they need a situational bonus to the dc have a * next to the
 * dc displayed").
 */
export function saveDcHasSituational(c: Character, save: SaveId, db?: ContentDatabase): boolean {
  return featSituationalFor(
    characterSituationalIds(c, db),
    { kind: 'save', save },
    authoredSituational(c, db),
  ).some((s) => s.dcOnly);
}

/**
 * Marks this character's records put on an ACTION row or a CONDITION — ruling D's answer to the
 * effects that change no stat: the mark goes on the thing it modifies, with the changed value shown
 * inline and a `*` back to the source.
 */
export function recordMarkersFor(
  c: Character,
  db: ContentDatabase,
  on: 'action' | 'condition',
  id: string,
): { sourceId: string; value?: string; note: string }[] {
  // `grantMarkers` is the GATED half — a mark that exists only because the character has the record
  // being modified (Draconic Paragon's rider on Kobold Breath, which a kobold without Kobold Breath
  // must never see). It arrives through the same `extra` channel the item editor uses, so there is
  // one display path rather than two.
  return markersFor(characterSituationalIds(c, db), on, id, c.grantMarkers);
}

/**
 * Conditional bonuses to show on a SPELL's row — ruling G: "Distant Grasp: on the spell, since that's
 * what you're looking at when you cast it." Only for a character who has the record granting it.
 */
export function spellSituationalFor(
  c: Character,
  db: ContentDatabase,
  spellId: string,
): { source: string; when: string; bonus: string }[] {
  return spellMarkersFor(spellId, characterSituationalIds(c, db)).map((m) => ({
    source: nameOfRecord(db, m.source),
    when: m.when,
    bonus: m.bonus,
  }));
}

/**
 * Marker classes for a stat: `has-mode` (dotted underline, pairs with the `*`) when something
 * situational applies, `mode-lit` (solid accent underline) when a live mode is moving the number
 * right now. They are separate on purpose — a `*` promises a note worth reading, which an
 * unconditional mode has none of, while an unconditional mode still has to be visibly attributable.
 */
export function statMarkClass(c: Character, ref: StatRef, db?: ContentDatabase): string {
  let out = '';
  if (statHasSituational(c, ref, db)) out += ' has-mode';
  if (statHasActiveMode(c, ref)) out += ' mode-lit';
  return out;
}

/** Situational lines for a stat from the registry. Names resolve across every collection a bonus can
 *  come from, so an item's bonus reads with the item's name. */
const SITUATIONAL_COLLECTIONS = ['feats', 'items', 'heritages', 'backgrounds', 'ancestries', 'classFeatures'] as const;

/** The display name of a record id, whichever collection it lives in. */
export function nameOfRecord(db: ContentDatabase, id: string): string {
  for (const k of SITUATIONAL_COLLECTIONS) {
    const name = (db[k] as Record<string, { name?: string } | undefined> | undefined)?.[id]?.name;
    if (name) return name;
  }
  return id;
}

/** Which collection holds this id, so a note can open the record it came from (ruling H). */
function sourceCollectionOf(db: ContentDatabase, id: string): SituationalLine['sourceCollection'] {
  for (const k of SITUATIONAL_COLLECTIONS) {
    if ((db[k] as Record<string, unknown> | undefined)?.[id]) return k;
  }
  return undefined;
}

/** Situational lines for a stat from the registry. Names resolve across every collection a bonus can
 *  come from, so an item's bonus reads with the item's name. */
function featSituationalLines(c: Character, db: ContentDatabase, ref: StatRef): SituationalLine[] {
  const nameOf = (id: string) =>
    // An armour/shield TRAIT is not a record, so it needs its own label — otherwise the popup reads
    // "+3 instead of your Dexterity modifier from trait:bulwark".
    id.startsWith('trait:')
      ? traitLabel(id.slice('trait:'.length))
      : db.feats[id]?.name ??
        db.items[id]?.name ??
        db.heritages[id]?.name ??
        db.backgrounds[id]?.name ??
        db.ancestries[id]?.name ??
        db.classFeatures[id]?.name ??
        id;
  return featSituationalFor(characterSituationalIds(c, db), ref, authoredSituational(c, db)).map((s) => ({
    source: nameOf(s.id),
    when: s.when,
    bonus: s.bonus,
    sourceId: s.id,
    sourceCollection: sourceCollectionOf(db, s.id),
    ...(s.dcOnly ? { dcOnly: true as const } : {}),
  }));
}

/** One line of a stat's star list, ready to render. */
export interface SituationalNote {
  /** "+2 item from Gaze of the Mantis — on visual Perception checks". */
  text: string;
  /** The record behind it, so the note can be clicked open — ruling H's "a place to click to open
   *  the full". Absent for a mode, which is not a record. */
  sourceId?: string;
  sourceCollection?: SituationalLine['sourceCollection'];
  /** Moves the DC others roll against, not a check you roll. */
  dcOnly?: boolean;
}

/**
 * The star list for one stat: the active modes' conditional modifiers and the registry's entries,
 * pooled together and then worded.
 *
 * Pooled as ONE list on purpose. The two lanes are the same thing to a player — something that
 * applies sometimes — so a mode and an item that both grant "+1 status while frightened" have to
 * collapse to one line, which they could not while each lane formatted its own strings.
 */
function situationalList(modeLines: SituationalLine[], registryLines: SituationalLine[]): SituationalNote[] {
  return poolSituationalLines([...modeLines, ...registryLines]).map((l) => ({
    // A DC-only bonus is spelled out in the line itself. Without it the entry reads as a bonus to the
    // save you roll, which is the opposite of what it does.
    text:
      `${l.bonus} from ${l.source}${l.when ? ` — ${l.when}` : ''}` +
      (l.dcOnly ? ' (raises the DC others roll against, not your own save)' : ''),
    sourceId: l.sourceId,
    sourceCollection: l.sourceCollection,
    ...(l.dcOnly ? { dcOnly: true as const } : {}),
  }));
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
 *  the number) and return the CONDITIONAL ones for the star list. */
function modeAdjust(c: Character, target: ModeTarget, parts: CalcPart[]): SituationalLine[] {
  const situational: SituationalLine[] = [];
  const uncond: { mode: string; type: string; value: number }[] = [];
  for (const { mode, mod } of modeModifiersFor(c.activeModes, target)) {
    const typed = mod.type === 'untyped' ? 'untyped' : mod.type;
    if (mod.appliesWhen) situational.push({ source: mode, when: mod.appliesWhen, bonus: `${formatMod(mod.value)} ${typed}` });
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
      // A worn/invested magic item's passive bonus competes for the same item slot. It was missing
      // here entirely, so a Ring of Sure Grip raised the total and the parts silently stopped adding up.
      const passive = passiveItemBonusDetail(c, db, 'skill', ref.skill);
      const dynamic = dynamicItemSkillBonus(c, db, ref.skill);
      const skillItem = Math.max(abpSp, mpSp, passive?.value ?? 0, dynamic);
      if (skillItem) {
        const label =
          passive && passive.value === skillItem ? passive.name
          : dynamic === skillItem ? 'Item bonus'
          : mpSp > abpSp ? 'Monster Parts (refined)'
          : 'ABP skill potency';
        parts.push({ label, note: 'item bonus', value: skillItem });
      }
      if (ability === 'str' || ability === 'dex') {
        const acp = deriveArmorCheckPenalty(c, db, ref.skill);
        if (acp.value) parts.push({ label: 'Armor check penalty', note: acp.source ?? undefined, value: acp.value });
      }
      const cond = conditionPart(c, ability, 'skill');
      if (cond) parts.push(cond);
      const situational = situationalList(modeAdjust(c, { kind: 'skill', detail: ref.skill }, parts), featSituationalLines(c, db, ref));
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
      // One item bonus to saves: the best of ABP / a resilient rune / a worn item's passive bonus.
      // deriveSave takes the max, so listing only the first two left the parts short of the total
      // whenever a passive item (a Cloak of Elvenkind) was the winner.
      const passiveSave = passiveItemBonusDetail(c, db, 'saves');
      const runeSave = abpOn(c) ? abpSave(lvl) : resilientSaveBonus(c, db);
      const saveItem = Math.max(runeSave, passiveSave?.value ?? 0);
      if (saveItem) {
        parts.push(
          passiveSave && passiveSave.value === saveItem
            ? { label: passiveSave.name, note: 'item bonus', value: saveItem }
            : abpOn(c)
              ? { label: 'ABP save potency', note: 'item bonus (replaces resilient)', value: saveItem }
              : { label: 'Resilient rune', note: 'item bonus', value: saveItem },
        );
      }
      const cond = conditionPart(c, ability, 'save');
      if (cond) parts.push(cond);
      const situational = situationalList(modeAdjust(c, { kind: 'save', detail: ref.save }, parts), featSituationalLines(c, db, ref));
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
    case 'initiative': {
      // Initiative READS another statistic, so its breakdown delegates to that one and relabels it.
      // Delegating rather than recomputing is what keeps the two from drifting: whatever the player
      // rolls initiative with, the parts they see are that statistic's own parts.
      const init = deriveInitiative(c, db);
      const inner = explainStat(c, db, init.stat === 'perception' ? { kind: 'perception' } : { kind: 'skill', skill: init.stat }, build);
      return {
        ...inner,
        title: 'Initiative',
        subtitle: `rolled with ${init.label}`,
        totalText: formatMod(init.modifier),
        // Its own situational lines PLUS the underlying stat's — an "on initiative" bonus is filed
        // against Perception (there was nowhere else), and must not vanish when it is shown here.
        situational: [...(inner.situational ?? []), ...situationalList([], featSituationalLines(c, db, ref))],
      };
    }
    case 'perception': {
      const d = derivePerception(c, db);
      const cls = c.classId ? db.classes[c.classId] : undefined;
      const parts: CalcPart[] = [profPart(d.rank, lvl, pwl(c)), abilityPart(c, 'wis')];
      // Perception item bonus — the higher of ABP Perception potency and a Monster-Parts refined-Perception
      // item (they don't stack; derivePerception takes the max). List whichever wins so the parts reconcile.
      const abpPerc = abpOn(c) ? abpPerception(lvl) : 0;
      const mpPerc = mpSenseSkillItemBonus(c, 'perception');
      // …and a worn item's passive Perception bonus, which competes for the same slot and was missing.
      const passivePerc = passiveItemBonusDetail(c, db, 'perception');
      const percItem = Math.max(abpPerc, mpPerc, passivePerc?.value ?? 0);
      if (percItem) {
        const label =
          passivePerc && passivePerc.value === percItem ? passivePerc.name
          : mpPerc > abpPerc ? 'Monster Parts (refined)'
          : 'ABP Perception potency';
        parts.push({ label, note: 'item bonus', value: percItem });
      }
      const cond = conditionPart(c, 'wis', 'perception');
      if (cond) parts.push(cond);
      const situational = situationalList(modeAdjust(c, { kind: 'perception' }, parts), featSituationalLines(c, db, ref));
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
      // Restatted the same way deriveAc sees it, or the breakdown contradicts the number it explains.
      // Heavy Construction makes the innovation heavy while its proficiency still reads the MEDIUM
      // track, so `category` (what the armor IS) and `profCategory` (where the rank comes from) differ
      // — and the timeline has to follow the rank, or it shows a track the class never advances.
      // wornArmorOf, not applyArmorRiders: an Armored Skirt or Plated Duster restates the suit too,
      // and reading only the class-feature riders here would explain a number deriveAc never produced.
      const ridden = wornArmorOf(c, db);
      const armor = ridden?.armor ?? null;
      const category = armor?.category ?? 'unarmored';
      const profCategory = ridden?.profCategory ?? 'unarmored';
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
      // deriveAc pools ONE item bonus to AC: the best of the armor's own (potency rune or a
      // Monster-Parts refine), ABP defense potency, and a worn item's passive AC bonus. Mirrored here
      // exactly — the passive lane had no row at all, so Bracers of Armor raised the number and the
      // listed parts came up short with nothing to blame it on.
      const passiveAc = passiveItemBonusDetail(c, db, 'ac');
      const refAc = worn && mpActive(c, worn.i) ? mpArmorRefine(worn.i.monsterPart, lvl).ac : 0;
      const armorItem = abpOn(c) ? 0 : Math.max((worn?.i.runes as ArmorRunes | undefined)?.potency ?? 0, refAc);
      const acItem = Math.max(armorItem, abpOn(c) ? abpDefense(lvl) : 0, passiveAc?.value ?? 0);
      if (armor) {
        // The armor's own AC is untyped and always applies; only its potency half competes for the slot.
        const potency = acItem === armorItem ? armorItem : 0;
        const note = potency ? (refAc === potency ? `+${armor.acBonus} armor + ${potency} refined` : `+${armor.acBonus} armor + ${potency} potency`) : 'armor item bonus';
        const adj = ridden?.adjustedBy?.[0];
        parts.push({ label: armor.name, note: adj ? `${note} · restated by ${adj.name}` : note, value: armor.acBonus + potency });
      }
      if (acItem && acItem !== armorItem) {
        parts.push(
          passiveAc && passiveAc.value === acItem
            ? { label: passiveAc.name, note: 'item bonus', value: acItem }
            : { label: 'ABP defense potency', note: 'item bonus', value: acItem },
        );
      }
      const cond = conditionPart(c, 'dex', 'ac');
      if (cond) parts.push(cond);
      // An AC-granting stance (Mountain +4, Crane +1, …) is folded into the AC total by deriveAc; list it so
      // the itemized parts reconcile with the total.
      const stanceAc = stance?.acBonus?.value ?? 0;
      if (stanceAc) parts.push({ label: stance!.name ?? 'Stance', note: `${stance!.acBonus!.type} bonus`, value: stanceAc });
      // Use the shield-swapped modes so the "Raise a Shield" line shows the real shield bonus (buckler
      // +1, fortress +3) and the parts reconcile with the AC total (which deriveAc computes the same way).
      const situational = situationalList(modeAdjust({ ...c, activeModes: shieldSwappedModes(c, db) }, { kind: 'ac' }, parts), featSituationalLines(c, db, ref));
      return {
        title: 'Armor class',
        subtitle: armor ? `${cap(category)} armor` : 'Unarmored',
        totalText: String(ac.value),
        rank: ac.rank,
        parts,
        timeline: profTimeline(c, db, profCategory, cls?.defenses[profCategory] ?? 'trained', `in ${profCategory === 'unarmored' ? 'unarmored defense' : `${profCategory} armor`}`),
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
      const situational = situationalList(modeAdjust(c, { kind: 'class-dc' }, parts), featSituationalLines(c, db, ref));
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
      const situational = situationalList(modeAdjust(c, { kind: isDc ? 'spell-dc' : 'spell-attack' }, parts), featSituationalLines(c, db, ref));
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
    case 'spellDamage': {
      const entry = c.spellcasting.find((e) => e.id === ref.entryId) as SpellcastingEntry | undefined;
      // No parts and no total: unlike every other stat, spell damage is not a single number — each
      // spell rolls its own. Everything worth showing is in `situational`, which is why the row is
      // only rendered when there is at least one.
      return {
        title: 'Spell damage',
        subtitle: entry ? `${cap(entry.tradition)} spells` : undefined,
        totalText: 'varies',
        parts: [],
        timeline: [],
        description:
          'Damage dealt by your spells is rolled per spell. These effects add to (or subtract from) that roll when their condition is met.',
        situational: situationalList([], featSituationalLines(c, db, ref)),
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
        situational: situationalList([], featSituationalLines(c, db, ref)),
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
          situational: situationalList([], featSituationalLines(c, db, ref)),
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
        situational: situationalList([], featSituationalLines(c, db, ref)),
      };
    }
    case 'speed': {
      const speeds = deriveSpeeds(c, db);
      const ancestry = c.ancestryId ? db.ancestries[c.ancestryId] : undefined;
      const ancestryLand = ancestry?.speeds?.land ?? 0;

      // Pre-armor land Speed: the ancestry base, raised to any FLOOR ("your land Speed increases to
      // 15 feet"), then increased by every additive source. This mirrors deriveSpeeds exactly —
      // it previously used raise-to semantics for `speeds.land` while deriveSpeeds added it, so a
      // +5 from Fleet was in the total but missing from the parts, and the breakdown didn't sum.
      const named: { name?: string; landSpeedBonus?: number; landSpeedMin?: number; speeds?: SpeedGrants }[] = [];
      if (c.heritageId && db.heritages[c.heritageId]) named.push(db.heritages[c.heritageId]);
      for (const f of c.feats) {
        const ft = db.feats[f.featId];
        if (ft) named.push(ft);
      }
      for (const fid of ownedFeatureIds(c, db)) {
        const cf = db.classFeatures[fid];
        if (cf) named.push(cf);
      }

      const parts: CalcPart[] = [];
      if (ancestryLand) parts.push({ label: 'Ancestry Speed', note: ancestry?.name, value: ancestryLand });
      const floor = Math.max(0, ...named.map((s) => s.landSpeedMin ?? 0));
      if (floor > ancestryLand) {
        const src = named.find((s) => (s.landSpeedMin ?? 0) === floor);
        parts.push({ label: 'Raised to', note: src?.name, value: floor - ancestryLand });
      }
      let preArmorLand = Math.max(ancestryLand, floor);
      for (const src of named) {
        const add = (src.landSpeedBonus ?? 0) + (typeof src.speeds?.land === 'number' ? src.speeds.land : 0);
        if (!add) continue;
        parts.push({ label: 'Speed increase', note: src.name, value: add });
        preArmorLand += add;
      }

      const naturalLand = speeds.land ?? 0;
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
        situational: situationalList([], featSituationalLines(c, db, ref)),
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
      const situational = situationalList(modeAdjust(c, { kind: 'attack' }, parts), featSituationalLines(c, db, ref));
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
      // Feat/item damage bonuses are listed for every Strike, exactly as `strikeAttack` lists attack
      // bonuses: a target carries no weapon narrowing, so the alternative is to show nothing at all.
      // The `when` clause on each line is what tells the player whether it applies to this weapon.
      const situational = situationalList(modeAdjust(c, { kind: 'damage' }, parts), featSituationalLines(c, db, ref));
      // Surface conditional precision/sneak riders (they aren't in the flat total) alongside the
      // situational mode notes so the breakdown matches the annotated strike row.
      for (const r of strike.conditionalDamage ?? []) situational.push({ text: `+${r.text} — ${r.note}` });
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

/**
 * A resistance / weakness / immunity, explained in the SAME shape as every other stat breakdown, so
 * it opens the app's normal StatDetailModal rather than a bespoke popup.
 *
 * The parts list is the whole point. "Fire 5" alone is not actionable — with several sources a player
 * cannot tell which one disappears if they unequip something. Sources that lost the no-stacking rule
 * are listed too, marked, because "my lesser item is contributing nothing right now" is exactly the
 * fact worth surfacing.
 */
export function explainDefense(
  defenses: CharacterDefenses,
  kind: 'resistance' | 'weakness' | 'immunity',
  type: string,
): StatBreakdown {
  const sources = defenses.sources?.[`${kind}:${type}`] ?? [];
  const label = type.replace(/-/g, ' ');
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const total =
    kind === 'immunity'
      ? 0
      : (kind === 'resistance' ? defenses.resistances : defenses.weaknesses).find((x) => x.type === type)?.value ?? 0;

  // Winners first, then superseded — reading order should match what actually applies.
  const ordered = [...sources].sort((a, b) => Number(b.applied) - Number(a.applied) || (b.value ?? 0) - (a.value ?? 0));
  const parts: CalcPart[] = ordered.map((s) => ({
    label: s.from,
    value: s.value ?? 0,
    note: [s.applied ? undefined : 'superseded — does not stack', s.condition].filter(Boolean).join(' · ') || undefined,
  }));

  return {
    title: `${cap(label)} ${kind}`,
    subtitle: kind === 'immunity' ? 'Immunity' : `${sources.length} source${sources.length === 1 ? '' : 's'}`,
    totalText: kind === 'immunity' ? 'Immune' : String(total),
    parts,
    timeline: [],
    description:
      kind === 'immunity'
        ? undefined
        : `Same-type ${kind}s do not stack — only the highest applies.`,
  };
}
