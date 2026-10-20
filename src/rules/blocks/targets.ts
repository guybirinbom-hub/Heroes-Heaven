/*
 * THE TARGET REGISTRY — every number or rank a building block can point at, in one list.
 *
 * Design: docs/overrides-redesign.md, "Building blocks" item 3. Today a new mode target means editing
 * three places (`ModeTargetKind` in types.ts, `modeMatches` and `MODE_TARGETS` / `modeTargetOptions` in
 * modes.ts). Blocks take their targets from here instead. Modes stay a separate system for the player
 * (decision 16); they may read this list later, but nothing in modes.ts changes for phase 1.
 *
 * A target is a statistic seen from one ASPECT:
 *   - 'number' — the modifier or value the sheet prints (Athletics +7, AC 21, Speed 25 ft). Number
 *     blocks (+/-, set, at least N) land in that number's term list (Building blocks item 5).
 *   - 'rank'   — the proficiency rank behind it (trained … legendary). Rank blocks apply inside
 *     `buildCharacter` (item 8).
 *   - 'score'  — an attribute SCORE. A +/- changes the score itself, never a mode-style modifier shift,
 *     so the ~11 readers that bypass `abilityModOf` stay right (spec item 8).
 *
 * A target has an OWNER (item 3): the character, one casting entry, one companion, one item. All four
 * are designed here; phase 1 builds the character and casting-entry owners (spec item 8: spell attack
 * and DC per casting entry). Rows for the later owners are written now with `built: false`, so the
 * shape is fixed before anything stores them.
 *
 * An instance stores its target as ONE string key: `kind[:detail][@owner:id]`, for example
 * `skill:athletics`, `skill:lore:sailing`, `save:fortitude`, `speed:land`, `score:str`,
 * `spell-dc@casting-entry:wizard`. Lore details are built by `loreKey` (src/rules/loreKey.ts; build.ts
 * re-exports it) and nothing else, so a
 * "Sailing Lore" tweak and a background's Sailing Lore are one row (spec item 11).
 */
import { ABILITIES, SAVES, SKILLS } from '../types';

export type TargetAspect = 'number' | 'rank' | 'score';
export type TargetOwnerKind = 'character' | 'casting-entry' | 'companion' | 'item';

/** The statistics. A new one is a new member here plus its row(s) in TARGETS — see the recipe in registry.ts. */
export type TargetKind =
  | 'score'
  | 'max-hp'
  | 'ac'
  | 'save'
  | 'perception'
  | 'skill'
  | 'class-dc'
  | 'initiative'
  | 'spell-attack'
  | 'spell-dc'
  | 'spell'
  | 'weapon'
  | 'armor'
  | 'speed'
  | 'attack'
  | 'damage';

/** What a target's detail may be. 'none' = the target takes no detail. */
export type TargetDetail = 'none' | 'ability' | 'save' | 'skill' | 'weapon' | 'armor' | 'speed';

export interface OwnerDef {
  kind: TargetOwnerKind;
  label: string;
  /** The Tweaks phase that builds blocks on this owner. */
  phase: number;
  built: boolean;
}

export const OWNERS: OwnerDef[] = [
  { kind: 'character', label: 'The character', phase: 1, built: true },
  { kind: 'casting-entry', label: 'One spellcasting entry', phase: 1, built: true },
  { kind: 'companion', label: 'One companion, familiar or eidolon', phase: 3, built: false },
  { kind: 'item', label: 'One item', phase: 3, built: false },
];

export interface TargetDef {
  kind: TargetKind;
  aspect: TargetAspect;
  owner: TargetOwnerKind;
  label: string;
  /** A coarse heading for the target picker. */
  group: string;
  detail: TargetDetail;
  /** Where its blocks apply: inside `buildCharacter`, or in the stat's term list at derive time. */
  seam: 'build' | 'derive';
  /** A d20 check (what an "all checks" bonus reaches). DCs, AC, HP and Speed are not checks. */
  isCheck: boolean;
  phase: number;
  built: boolean;
}

const row = (
  kind: TargetKind,
  aspect: TargetAspect,
  label: string,
  group: string,
  detail: TargetDetail,
  more: Partial<Pick<TargetDef, 'owner' | 'isCheck' | 'phase' | 'built'>> = {},
): TargetDef => ({
  kind,
  aspect,
  label,
  group,
  detail,
  owner: more.owner ?? 'character',
  // Ranks and attribute scores are fixed while the character is built; every number is derived.
  seam: aspect === 'number' ? 'derive' : 'build',
  isCheck: more.isCheck ?? false,
  phase: more.phase ?? 1,
  built: more.built ?? true,
});

/**
 * Every target. Phase 1 (`built: true`) is exactly spec item 8: attribute scores, max HP, AC, the 3
 * saves, Perception, every skill and Lore, class DC, Initiative, spell attack and spell DC per casting
 * entry, land Speed — plus the rank tracks today's Overrides already sets (skills, Lores, saves,
 * Perception, class DC, weapon and armor categories).
 */
export const TARGETS: TargetDef[] = [
  row('score', 'score', 'Attribute score', 'Attributes', 'ability'),
  row('max-hp', 'number', 'Maximum HP', 'Defence', 'none'),
  row('ac', 'number', 'Armor class', 'Defence', 'none'),
  row('save', 'number', 'Saving throw', 'Saves', 'save', { isCheck: true }),
  row('save', 'rank', 'Saving throw rank', 'Saves', 'save'),
  row('perception', 'number', 'Perception', 'Checks', 'none', { isCheck: true }),
  row('perception', 'rank', 'Perception rank', 'Checks', 'none'),
  row('skill', 'number', 'Skill or Lore', 'Skills', 'skill', { isCheck: true }),
  row('skill', 'rank', 'Skill or Lore rank', 'Skills', 'skill'),
  row('class-dc', 'number', 'Class DC', 'Offence', 'none'),
  row('class-dc', 'rank', 'Class DC rank', 'Offence', 'none'),
  row('initiative', 'number', 'Initiative', 'Checks', 'none', { isCheck: true }),
  row('spell-attack', 'number', 'Spell attack', 'Spellcasting', 'none', { owner: 'casting-entry', isCheck: true }),
  row('spell-dc', 'number', 'Spell DC', 'Spellcasting', 'none', { owner: 'casting-entry' }),
  // A casting entry's own rank: feature 49, phase 5. `overrides.proficiencies` cannot hold it (a key
  // there that is not a known track becomes a fake skill), so phase 1 does not build it.
  row('spell', 'rank', 'Spellcasting rank', 'Spellcasting', 'none', { owner: 'casting-entry', phase: 5, built: false }),
  row('weapon', 'rank', 'Weapon proficiency', 'Offence', 'weapon'),
  row('armor', 'rank', 'Armor proficiency', 'Defence', 'armor'),
  row('speed', 'number', 'Speed', 'Movement', 'speed'),
  // Phase 3: Strikes (spec item 8: "Strikes wait for phase 3"), and the companion and item owners.
  row('attack', 'number', 'Strike attack', 'Offence', 'none', { isCheck: true, phase: 3, built: false }),
  row('damage', 'number', 'Strike damage', 'Offence', 'none', { phase: 3, built: false }),
  row('ac', 'number', 'Companion AC', 'Companion', 'none', { owner: 'companion', phase: 3, built: false }),
  row('save', 'number', 'Companion save', 'Companion', 'save', { owner: 'companion', isCheck: true, phase: 3, built: false }),
  row('perception', 'number', 'Companion Perception', 'Companion', 'none', { owner: 'companion', isCheck: true, phase: 3, built: false }),
  row('skill', 'number', 'Companion skill', 'Companion', 'skill', { owner: 'companion', isCheck: true, phase: 3, built: false }),
  row('max-hp', 'number', 'Companion maximum HP', 'Companion', 'none', { owner: 'companion', phase: 3, built: false }),
  row('speed', 'number', 'Companion Speed', 'Companion', 'speed', { owner: 'companion', phase: 3, built: false }),
  row('attack', 'number', 'Companion attack', 'Companion', 'none', { owner: 'companion', isCheck: true, phase: 3, built: false }),
  row('attack', 'number', "This weapon's attack", 'Item', 'none', { owner: 'item', isCheck: true, phase: 3, built: false }),
  row('damage', 'number', "This weapon's damage", 'Item', 'none', { owner: 'item', phase: 3, built: false }),
];

/** The details a target kind accepts. `lore:<slug>` comes from `loreKey`; phase 1 Speed is land only. */
const WEAPON_DETAILS = ['unarmed', 'simple', 'martial', 'advanced'];
const ARMOR_DETAILS = ['unarmored', 'light', 'medium', 'heavy'];
const SPEED_DETAILS = ['land', 'fly', 'swim', 'climb', 'burrow'];
/** Phase 1 builds land Speed only (spec item 8); the other movement types come with phase 3's speeds. */
export const BUILT_SPEED_DETAILS = ['land'];

export function detailAllowed(detail: TargetDetail, value: string | undefined): boolean {
  if (detail === 'none') return value == null;
  if (value == null) return false;
  switch (detail) {
    case 'ability':
      return (ABILITIES as readonly string[]).includes(value);
    case 'save':
      return (SAVES as readonly string[]).includes(value);
    case 'skill':
      // A Lore key is `lore:` plus loreKey's slug: lower-case words joined by '-'.
      return (SKILLS as readonly string[]).includes(value) || /^lore:[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
    case 'weapon':
      return WEAPON_DETAILS.includes(value);
    case 'armor':
      return ARMOR_DETAILS.includes(value);
    case 'speed':
      return SPEED_DETAILS.includes(value);
  }
}

/** A target as an instance stores it, taken apart. */
export interface TargetRef {
  kind: TargetKind;
  detail?: string;
  owner: TargetOwnerKind;
  /** The casting entry, companion or inventory item id; absent for the character. */
  ownerId?: string;
}

const OWNER_KINDS = OWNERS.map((o) => o.kind) as string[];
const TARGET_KINDS = new Set(TARGETS.map((t) => t.kind) as string[]);

/** `kind[:detail][@owner:id]` → parts, or null when the key is not one this app knows. A Lore detail
 *  holds its own colon (`skill:lore:sailing`), so only the FIRST colon of the stat part separates. */
export function parseTargetRef(key: string): TargetRef | null {
  if (typeof key !== 'string' || !key) return null;
  const at = key.indexOf('@');
  const stat = at < 0 ? key : key.slice(0, at);
  const ownerPart = at < 0 ? '' : key.slice(at + 1);
  const i = stat.indexOf(':');
  const kind = i < 0 ? stat : stat.slice(0, i);
  const detail = i < 0 ? undefined : stat.slice(i + 1);
  if (!TARGET_KINDS.has(kind)) return null;
  if (!ownerPart) return { kind: kind as TargetKind, detail, owner: 'character' };
  const j = ownerPart.indexOf(':');
  const owner = j < 0 ? ownerPart : ownerPart.slice(0, j);
  const ownerId = j < 0 ? undefined : ownerPart.slice(j + 1);
  if (!OWNER_KINDS.includes(owner) || owner === 'character' || !ownerId) return null;
  return { kind: kind as TargetKind, detail, owner: owner as TargetOwnerKind, ownerId };
}

export function targetRefKey(ref: TargetRef): string {
  const stat = ref.detail != null ? `${ref.kind}:${ref.detail}` : ref.kind;
  return ref.owner === 'character' ? stat : `${stat}@${ref.owner}:${ref.ownerId}`;
}

/** The TARGETS row a stored key means for one aspect, or null when no such target exists. */
export function targetDefFor(key: string, aspect: TargetAspect): TargetDef | null {
  const ref = parseTargetRef(key);
  if (!ref) return null;
  const def = TARGETS.find((t) => t.kind === ref.kind && t.aspect === aspect && t.owner === ref.owner);
  if (!def || !detailAllowed(def.detail, ref.detail)) return null;
  return def;
}

/** Is this key a target phase 1 can apply? (A target of a later phase is kept, shown, and not applied.) */
export function targetBuilt(key: string, aspect: TargetAspect): boolean {
  const def = targetDefFor(key, aspect);
  if (!def?.built) return false;
  const ref = parseTargetRef(key)!;
  if (def.kind === 'speed') return BUILT_SPEED_DETAILS.includes(ref.detail ?? '');
  return true;
}
