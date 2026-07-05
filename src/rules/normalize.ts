/*
 * Defensive character normalization.
 *
 * A native export from an older build, a hand-edited .codex.json, or a lossy import can
 * arrive missing required fields. The derive/play pipeline dereferences these arrays and
 * objects unguarded (e.g. `ch.spellcasting.map`, `ch.details.deityId`), so a single missing
 * field would otherwise white-screen the whole app. normalizeCharacter() fills every required
 * field with a safe default so any structurally-incomplete character renders instead of crashing.
 *
 * This is also the migration seam: schemaVersion is read here, and per-version fix-ups can be
 * slotted in before the field-by-field backfill.
 */
import {
  ABILITIES,
  SAVES,
  CHARACTER_SCHEMA_VERSION,
  type AbilityScores,
  type Character,
  type Coins,
  type Proficiencies,
  type ProficiencyRank,
} from './types';
import type { PlayState } from './play';
import { resolveItemAlias } from './itemAliases';

const UNTRAINED: ProficiencyRank = 'untrained';

/**
 * Migrate away removed item ids. Some AoN-scraped duplicate item stubs (aon-*) were deleted after the
 * canonical Foundry twin was confirmed; a saved character may still reference the old id in its
 * inventory. Rewrite every inventory entry's `itemId` to the canonical id so it keeps resolving.
 * `attachedTo` / `containerInstanceId` reference per-entry instanceIds (not item-definition ids), so
 * they are intentionally left untouched.
 */
function migrateInventoryIds(inventory: unknown): unknown {
  if (!Array.isArray(inventory)) return inventory;
  return inventory.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const e = entry as { itemId?: unknown };
    if (typeof e.itemId !== 'string') return entry;
    const resolved = resolveItemAlias(e.itemId);
    return resolved === e.itemId ? entry : { ...entry, itemId: resolved };
  });
}

/** Apply migrateInventoryIds to each companion's inventory (companions carry their own gear). */
function migrateCompanionInventories<T>(companions: T[]): T[] {
  return companions.map((c) => {
    if (!c || typeof c !== 'object' || !Array.isArray((c as { inventory?: unknown }).inventory)) return c;
    return { ...c, inventory: migrateInventoryIds((c as unknown as { inventory: unknown }).inventory) };
  });
}

function normAbilities(a: unknown): AbilityScores {
  const src = a && typeof a === 'object' ? (a as Record<string, unknown>) : {};
  const out = {} as AbilityScores;
  for (const id of ABILITIES) {
    const v = src[id];
    out[id] = typeof v === 'number' && Number.isFinite(v) ? v : 10;
  }
  return out;
}

function normProficiencies(p: unknown): Proficiencies {
  const src = p && typeof p === 'object' ? (p as Partial<Proficiencies>) : {};
  const saves = (src.saves && typeof src.saves === 'object' ? src.saves : {}) as Proficiencies['saves'];
  for (const s of SAVES) if (!saves[s]) saves[s] = UNTRAINED;
  const attacks = (src.attacks && typeof src.attacks === 'object' ? src.attacks : {}) as Proficiencies['attacks'];
  for (const a of ['unarmed', 'simple', 'martial', 'advanced'] as const) if (!attacks[a]) attacks[a] = UNTRAINED;
  const defenses = (src.defenses && typeof src.defenses === 'object' ? src.defenses : {}) as Proficiencies['defenses'];
  for (const d of ['unarmored', 'light', 'medium', 'heavy'] as const) if (!defenses[d]) defenses[d] = UNTRAINED;
  return {
    perception: src.perception ?? UNTRAINED,
    saves,
    skills: (src.skills && typeof src.skills === 'object' ? src.skills : {}) as Proficiencies['skills'],
    attacks,
    defenses,
    classDc: src.classDc ?? UNTRAINED,
    weaponOverrides: src.weaponOverrides,
    weaponGroups: src.weaponGroups,
  };
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function obj<T>(v: unknown, fallback: T): T {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Backfill every required field of a (possibly malformed/legacy) character with a safe default.
 * Returns a new object; the input is never mutated. Optional fields are passed through as-is.
 */
export function normalizeCharacter(input: unknown): Character {
  const c = (input && typeof input === 'object' ? input : {}) as Partial<Character>;
  const hp = obj<Partial<Character['hitPoints']>>(c.hitPoints, {});
  // NOTE: the Monster Parts subsystem is REBUILT (variant rule). Its state now lives in
  // `variantRules.monsterParts`/`monsterPartsMode` and per-item `inventory[].monsterPart` (both carried
  // through unchanged below), plus PlayState.bankedParts. Do NOT strip those — they must persist.
  return {
    ...(c as Character),
    schemaVersion: typeof c.schemaVersion === 'number' ? c.schemaVersion : CHARACTER_SCHEMA_VERSION,
    id: typeof c.id === 'string' && c.id ? c.id : `char-${(c.name ?? 'unnamed').toString().toLowerCase().replace(/\s+/g, '-')}`,
    name: typeof c.name === 'string' ? c.name : 'Unnamed',
    // Clamp level to the legal [1,20] range: a bad native .codex import or legacy roster entry with
    // level 0 / negative / 21+ otherwise derives broken HP and proficiency. (Mirrors clampLevel in
    // transfer.ts, which guards the WG import path.)
    level: typeof c.level === 'number' && Number.isFinite(c.level) ? Math.min(20, Math.max(1, Math.floor(c.level))) : 1,
    xp: typeof c.xp === 'number' ? c.xp : 0,
    ancestryId: c.ancestryId ?? null,
    heritageId: c.heritageId ?? null,
    backgroundId: c.backgroundId ?? null,
    classId: c.classId ?? null,
    keyAbility: c.keyAbility ?? null,
    abilities: normAbilities(c.abilities),
    proficiencies: normProficiencies(c.proficiencies),
    hitPoints: { current: typeof hp.current === 'number' ? hp.current : 0, temp: typeof hp.temp === 'number' ? hp.temp : 0, maxOverride: hp.maxOverride },
    heroPoints: typeof c.heroPoints === 'number' ? c.heroPoints : 0,
    conditions: arr(c.conditions),
    languages: arr(c.languages),
    feats: arr(c.feats),
    inventory: migrateInventoryIds(arr(c.inventory)) as Character['inventory'],
    currency: obj<Coins>(c.currency, {}),
    spellcasting: arr(c.spellcasting),
    details: obj<Character['details']>(c.details, {}),
    notes: arr(c.notes),
    // Optional structural fields the sheet/play pipeline maps/spreads — coerce a malformed value
    // (e.g. a non-array companions/skillIncreases) but leave a genuinely-absent field absent.
    ...(c.classChoices !== undefined ? { classChoices: arr(c.classChoices) } : {}),
    ...(c.partialBoosts !== undefined ? { partialBoosts: arr(c.partialBoosts) } : {}),
    ...(c.skillIncreases !== undefined ? { skillIncreases: arr(c.skillIncreases) } : {}),
    ...(c.companions !== undefined ? { companions: migrateCompanionInventories(arr(c.companions)) } : {}),
    ...(c.activeModes !== undefined ? { activeModes: arr(c.activeModes) } : {}),
    ...(c.pinned !== undefined ? { pinned: arr(c.pinned) } : {}),
    ...(c.pinnedDescs !== undefined ? { pinnedDescs: arr(c.pinnedDescs) } : {}),
    ...(c.classResources !== undefined ? { classResources: obj(c.classResources, {}) } : {}),
    ...(c.companionConditions !== undefined ? { companionConditions: obj(c.companionConditions, {}) } : {}),
  };
}

/**
 * Backfill a (possibly malformed/legacy/hand-edited) PlayState. applyPlayState makes hard array/object
 * assumptions on these fields (`.map`, `.filter`, `.find`, spreads); a single non-array/non-object value
 * would otherwise throw in App's pre-boundary useMemo and white-screen the app unrecoverably. Coercing
 * the structural fields here keeps the overlay safe. Optional scalars are passed through as-is.
 */
export function normalizePlay(input: unknown): PlayState {
  const p = (input && typeof input === 'object' ? input : {}) as Partial<PlayState>;
  // Monster Parts banked parts live in the structured `bankedParts` object (carried through unchanged
  // below via the spread) — the rebuilt subsystem persists it; nothing is stripped here.
  return {
    ...(p as PlayState),
    damage: num(p.damage, 0),
    tempHp: num(p.tempHp, 0),
    heroPoints: num(p.heroPoints, 0),
    xp: num(p.xp, 0),
    focusUsed: num(p.focusUsed, 0),
    // Arrays the overlay maps/filters/spreads.
    conditions: arr(p.conditions),
    pinned: arr(p.pinned),
    ...(p.pinnedDescs !== undefined ? { pinnedDescs: arr(p.pinnedDescs) } : {}),
    ...(p.notes !== undefined ? { notes: arr(p.notes) } : {}),
    ...(p.companions !== undefined ? { companions: migrateCompanionInventories(arr(p.companions)) } : {}),
    ...(p.inventory !== undefined ? { inventory: migrateInventoryIds(arr(p.inventory)) as PlayState['inventory'] } : {}),
    ...(p.activeModes !== undefined ? { activeModes: arr(p.activeModes) } : {}),
    ...(p.preparedTactics !== undefined ? { preparedTactics: arr(p.preparedTactics) } : {}),
    // Objects the overlay reads by key / spreads.
    expendedSlots: obj(p.expendedSlots, {}),
    slotsUsed: obj(p.slotsUsed, {}),
    ...(p.resources !== undefined ? { resources: obj(p.resources, {}) } : {}),
    ...(p.companionConditions !== undefined ? { companionConditions: obj(p.companionConditions, {}) } : {}),
    ...(p.details !== undefined ? { details: obj(p.details, {}) } : {}),
    ...(p.appearance !== undefined ? { appearance: obj(p.appearance, {}) } : {}),
    ...(p.preparedSpells !== undefined ? { preparedSpells: obj(p.preparedSpells, {}) } : {}),
    ...(p.repertoireSpells !== undefined ? { repertoireSpells: obj(p.repertoireSpells, {}) } : {}),
    ...(p.signatureSpells !== undefined ? { signatureSpells: obj(p.signatureSpells, {}) } : {}),
  };
}
