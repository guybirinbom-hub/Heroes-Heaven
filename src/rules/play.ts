/*
 * Play state — the mutable, in-play runtime layer.
 *
 * buildCharacter() is pure: it turns build choices into a derived Character, and
 * it re-runs from scratch whenever the build is edited. So anything that changes
 * DURING PLAY (damage taken, hero points spent, XP gained) must live OUTSIDE the
 * built character, or an edit would wipe it. PlayState is that layer: stored
 * alongside the build, overlaid onto the snapshot at render time, and untouched
 * by a rebuild.
 *
 * HP lost is stored as `damage` (not a current value) so that if max HP later
 * changes — a Con boost, a level-up — the character stays as hurt as they were,
 * rather than the current value silently desyncing from the new max.
 */
import type { AbilityId, ActiveCondition, Character, CharacterDetails, Coins, CompanionConfig, ContentDatabase, InventoryItem, ItemImbuement, ItemMonsterPart, ModeDef, NotePage, PinnedDesc, PreparedSlot } from './types';
import { deriveMaxHp, deriveBulk } from './derive';
import { monsterPartApex } from './monsterParts';
import { dyingDeathThreshold } from './conditions';
import { coinsToCp, cpToCoins } from './wealth';

/** The maximum hero points a character can hold (the rail shows three pips). */
export const MAX_HERO_POINTS = 3;
export const MAX_MYTHIC_POINTS = 3;

export interface PlayState {
  /** HP lost from max; current = max - damage, clamped to [0, max]. */
  damage: number;
  /** Temporary HP (a separate pool that absorbs damage first). */
  tempHp: number;
  /** Damage dealt to the wielded shield's HP (Shield Block / repair); clamped to its max. */
  shieldDamage?: number;
  /** Temporary land-Speed override in feet; when set, the sheet shows + highlights this
   *  in place of the derived Speed until it's reset to the default. */
  tempSpeed?: number;
  /** In-play appearance overrides (portrait + accent color), merged over the build's. `portrait` is the
   *  compressed (synced) copy; `portraitRef` keys the on-device sharp copy (installed app; never synced). */
  appearance?: { portrait?: string; accentColor?: string; portraitRef?: string };
  /** Hero points currently held, 0..MAX_HERO_POINTS. */
  heroPoints: number;
  /** Mythic points currently held, 0..MAX_MYTHIC_POINTS (only meaningful when the character is mythic). */
  mythicPoints?: number;
  /** Total experience points toward the next level. */
  xp: number;
  /** Focus points spent; current = focus.max - focusUsed. */
  focusUsed: number;
  /** Prepared slots that have been cast, keyed `${entryId}:${rank}:${slotIndex}`. */
  expendedSlots: Record<string, boolean>;
  /** Spontaneous slot-pool usage (count per rank), keyed `${entryId}:${rank}`. */
  slotsUsed: Record<string, number>;
  /** Innate spells cast today (1/day each), keyed `${entryId}:${spellId}`; refilled on rest. */
  innateUsed?: Record<string, boolean>;
  /** Conditions currently affecting the character. */
  conditions: ActiveCondition[];
  /** In-play inventory; when set, it overrides the build's gear (so the sheet can add/drop/equip). */
  inventory?: InventoryItem[];
  /** In-play wallet; when set, it overrides the build's starting currency. */
  currency?: Coins;
  /** Pinned/favorited activity keys (Main-tab favorites). */
  pinned: string[];
  /** Favorited description popups (starred from any description page). */
  pinnedDescs?: PinnedDesc[];
  /** Class signature resource values by id (Rage 0/1, Infused Reagents count, …). */
  resources?: Record<string, number>;
  /** Notes pages; when set, overrides the build's notes (so the sheet can edit them). */
  notes?: NotePage[];
  /** Conditions on each companion, keyed by companion id. */
  companionConditions?: Record<string, ActiveCondition[]>;
  /** Tracked HP per companion: damage taken + temp HP (current = max − damage), by companion id. */
  companionHp?: Record<string, { damage: number; temp: number }>;
  /** Ids of active modes per companion, keyed by companion id (mirrors `activeModes` for the PC). */
  companionModes?: Record<string, string[]>;
  /** In-play companions; when set, overrides the build's (so the Companions tab can add/remove). */
  companions?: CompanionConfig[];
  /** In-play edits to bio fields (alignment, age, appearance, …), merged over the build's details. */
  details?: Partial<CharacterDetails>;
  /** Ids of active modes (toggleable modifier sets); resolved against content.modes. */
  activeModes?: string[];
  /** Slug of the single active stance (exclusive by construction); resolved against content.stances. */
  activeStance?: string;
  /** In-play preparation overrides for prepared casters, keyed `${entryId}:${rank}:${slotIndex}`.
   *  A spell id replaces the build's prepared spell; null = a deliberately emptied slot;
   *  an absent key keeps the build's preparation. */
  preparedSpells?: Record<string, string | null>;
  /** In-play repertoire override for spontaneous casters: entryId → rank → known spell ids. */
  repertoireSpells?: Record<string, Record<number, string[]>>;
  /** In-play signature-spell override for spontaneous casters: entryId → spell ids. */
  signatureSpells?: Record<string, string[]>;
  /** Commander tactics prepared today (subset of the folio, up to preparedMax); reset on rest. */
  preparedTactics?: string[];
}

/** A toggleable per-item carry state. */
export type ItemFlag = 'worn' | 'equipped' | 'invested';

/** The sheet's play-state mutation dispatcher. Every call is its own undo step UNLESS the caller
 *  passes a `coalesceTag`: rapid successive calls sharing the same tag (scrubbing a +/- stepper,
 *  typing into a per-keystroke field) merge into ONE step. Distinct actions must stay untagged so
 *  they never merge (equip + rest must be two Ctrl+Zs). */
export type PlayUpdater = (fn: (play: PlayState) => PlayState, coalesceTag?: string) => void;

/** Stable key for one prepared slot (entry + rank + slot index). */
export const preparedKey = (entryId: string, rank: number, slotIndex: number) => `${entryId}:${rank}:${slotIndex}`;
/** Stable key for a spontaneous rank's slot pool. */
export const poolKey = (entryId: string, rank: number) => `${entryId}:${rank}`;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** The value of a (valued) condition in a list, or 0 if absent. */
const condVal = (list: ActiveCondition[] | undefined, id: string): number => (list ?? []).find((c) => c.id === id)?.value ?? 0;

/** A fresh, undamaged play state (one hero point, as a new day begins). */
export function emptyPlay(): PlayState {
  return { damage: 0, tempHp: 0, heroPoints: 1, mythicPoints: MAX_MYTHIC_POINTS, xp: 0, focusUsed: 0, expendedSlots: {}, slotsUsed: {}, conditions: [], pinned: [] };
}

/**
 * Seed a play state from a built character's starting values, so the first in-play
 * edit continues from where the build left off (full HP, the granted hero point,
 * an unspent focus pool, no slots cast).
 */
export function initialPlay(ch: Character, content: ContentDatabase): PlayState {
  const max = deriveMaxHp(ch, content);
  const expendedSlots: Record<string, boolean> = {};
  const slotsUsed: Record<string, number> = {};
  const innateUsed: Record<string, boolean> = {};
  for (const e of ch.spellcasting ?? []) {
    if (e.prepared)
      for (const [rankStr, slots] of Object.entries(e.prepared))
        slots.forEach((s, i) => {
          if (s.expended) expendedSlots[preparedKey(e.id, Number(rankStr), i)] = true;
        });
    if (e.slots)
      for (const [rankStr, pool] of Object.entries(e.slots))
        if (pool.used) slotsUsed[poolKey(e.id, Number(rankStr))] = pool.used;
    // Seed already-cast innate spells (e.g. from a Wanderer's Guide import) so the first play
    // mutation doesn't silently reset them — applyPlayState treats play.innateUsed as authoritative.
    for (const spellId of e.innateUsed ?? []) innateUsed[`${e.id}:${spellId}`] = true;
  }
  return {
    damage: clamp(max - ch.hitPoints.current, 0, max),
    tempHp: Math.max(0, ch.hitPoints.temp),
    heroPoints: clamp(ch.heroPoints, 0, MAX_HERO_POINTS),
    mythicPoints: clamp(ch.mythicPoints ?? MAX_MYTHIC_POINTS, 0, MAX_MYTHIC_POINTS),
    xp: Math.max(0, ch.xp),
    focusUsed: ch.focus ? clamp(ch.focus.max - ch.focus.current, 0, ch.focus.max) : 0,
    expendedSlots,
    slotsUsed,
    ...(Object.keys(innateUsed).length ? { innateUsed } : {}),
    conditions: (ch.conditions ?? []).map((c) => ({ ...c })),
    inventory: (ch.inventory ?? []).map((i) => ({ ...i })),
    currency: { ...ch.currency },
    pinned: ch.pinned ?? [],
    pinnedDescs: ch.pinnedDescs ? ch.pinnedDescs.map((d) => ({ ...d })) : [],
    resources: { ...(ch.classResources ?? {}) },
    notes: (ch.notes ?? []).map((p) => ({ ...p })),
    companions: (ch.companions ?? []).map((c) => ({ ...c })),
  };
}

/** The attribute raised by the first INVESTED regular apex item in the inventory (item.apexAttribute,
 *  from the Foundry apex data), or null. Investiture is the gate — a carried-but-uninvested apex item
 *  does nothing — and only the first qualifying item applies (one apex item at a time). */
export function itemApex(inventory: InventoryItem[] | undefined, content: ContentDatabase): AbilityId | null {
  for (const inv of inventory ?? []) {
    if (!inv.invested) continue;
    const apex = content.items[inv.itemId]?.apexAttribute;
    if (apex) return apex;
  }
  return null;
}

/** Overlay the in-play runtime values onto a freshly-built (snapshot) character. */
export function applyPlayState(ch: Character, play: PlayState | undefined, content: ContentDatabase): Character {
  if (!play) return ch;
  // A regular apex item (an invested item with an apexAttribute, e.g. Belt of Giant Strength) raises
  // one attribute (to 18, or +2 if already 18+). Bump it on the overlaid character so it ripples
  // through every derived stat (HP, saves, skills…). Only one apex item works at a time — the first
  // wins. Under Automatic Bonus Progression, apex items grant NO attribute benefit (build.ts already
  // applies the ABP attribute apex at level 17), so this overlay must do nothing — otherwise it
  // double-boosts.
  const abpOn = !!ch.variantRules?.abp;
  // Regular apex item OR a Monster-Parts apex-property item (Str/Dex/Con/Int/Wis/Cha at property level
  // 17+). Only one apex works at a time — the regular apex item wins if both are present. Under ABP,
  // apex items grant no attribute benefit (build.ts applied the ABP attribute apex), so skip both.
  const apexInv = play.inventory ?? ch.inventory;
  const apexAbility = abpOn
    ? null
    : itemApex(apexInv, content) ?? (ch.variantRules?.monsterParts ? monsterPartApex(apexInv, ch.level) : null);
  if (apexAbility) {
    const score = ch.abilities[apexAbility];
    ch = { ...ch, abilities: { ...ch.abilities, [apexAbility]: score >= 18 ? score + 2 : 18 } };
  }
  // Tolerate play states persisted before these fields existed (forward migration).
  const expended = play.expendedSlots ?? {};
  const used = play.slotsUsed ?? {};
  const focusUsed = play.focusUsed ?? 0;
  let conditions = play.conditions ?? ch.conditions;
  // Carrying more than your Bulk limit applies the Encumbered condition (clumsy 1, −10 ft Speed) —
  // unless the "Ignore Bulk Limit" option is on. Derived from the live inventory so it tracks gear.
  if (!ch.options?.ignoreBulk && !conditions.some((c) => c.id === 'encumbered')) {
    const bulk = deriveBulk({ ...ch, inventory: play.inventory ?? ch.inventory }, content);
    if (bulk.encTotal > bulk.encumberedAt) conditions = [...conditions, { id: 'encumbered' }];
  }
  // Max HP must reflect the overlaid conditions (Drained lowers it), so the
  // damage clamp below uses the same max the sheet will display.
  const max = deriveMaxHp({ ...ch, conditions }, content);
  const spellcasting = (ch.spellcasting ?? []).map((e) => {
    let out = e;
    if (e.prepared) {
      const prepared: Record<number, PreparedSlot[]> = {};
      for (const [rankStr, slots] of Object.entries(e.prepared)) {
        const rank = Number(rankStr);
        prepared[rank] = slots.map((s, i) => {
          const key = preparedKey(e.id, rank, i);
          const override = play.preparedSpells?.[key];
          return { ...s, spellId: override !== undefined ? override : s.spellId, expended: !!expended[key] };
        });
      }
      out = { ...out, prepared };
    }
    if (e.slots) {
      const slots: Record<number, { max: number; used: number }> = {};
      for (const [rankStr, pool] of Object.entries(e.slots)) {
        const rank = Number(rankStr);
        slots[rank] = { ...pool, used: clamp(used[poolKey(e.id, rank)] ?? 0, 0, pool.max) };
      }
      out = { ...out, slots };
    }
    if (e.repertoire) {
      const repOverride = play.repertoireSpells?.[e.id];
      let repertoire = e.repertoire;
      if (repOverride) {
        repertoire = {};
        for (const rankStr of Object.keys(e.repertoire)) {
          const rank = Number(rankStr);
          repertoire[rank] = repOverride[rank] ?? e.repertoire[rank];
        }
      }
      out = { ...out, repertoire, signature: play.signatureSpells?.[e.id] ?? e.signature };
    }
    if (e.font) {
      out = {
        ...out,
        font: { ...e.font, expended: Array.from({ length: e.font.slots }, (_, i) => !!expended[`${e.id}:font:${i}`]) },
      };
    }
    if (e.type === 'innate') {
      const used = play.innateUsed ?? {};
      out = { ...out, innateUsed: Object.keys(used).filter((k) => used[k] && k.startsWith(`${e.id}:`)).map((k) => k.slice(e.id.length + 1)) };
    }
    return out;
  });
  const focus = ch.focus ? { ...ch.focus, current: clamp(ch.focus.max - focusUsed, 0, ch.focus.max) } : ch.focus;
  return {
    ...ch,
    xp: Math.max(0, play.xp),
    heroPoints: clamp(play.heroPoints, 0, MAX_HERO_POINTS),
    mythicPoints: clamp(play.mythicPoints ?? MAX_MYTHIC_POINTS, 0, MAX_MYTHIC_POINTS),
    hitPoints: {
      ...ch.hitPoints,
      current: clamp(max - play.damage, 0, max),
      temp: Math.max(0, play.tempHp),
    },
    shieldDamage: Math.max(0, play.shieldDamage ?? 0),
    speedOverride: play.tempSpeed,
    conditions,
    inventory: play.inventory ?? ch.inventory,
    currency: play.currency ?? ch.currency,
    pinned: play.pinned ?? ch.pinned ?? [],
    pinnedDescs: play.pinnedDescs ?? ch.pinnedDescs ?? [],
    classResources: play.resources ?? ch.classResources ?? {},
    notes: play.notes ?? ch.notes,
    companionConditions: play.companionConditions ?? ch.companionConditions ?? {},
    companionHp: play.companionHp ?? ch.companionHp ?? {},
    companions: play.companions ?? ch.companions,
    details: play.details ? { ...ch.details, ...play.details } : ch.details,
    appearance: play.appearance ? { ...ch.appearance, ...play.appearance } : ch.appearance,
    activeModes: (play.activeModes ?? []).map((id) => content.modes[id]).filter(Boolean),
    activeStance: play.activeStance && content.stances?.[play.activeStance] ? play.activeStance : undefined,
    companionModes: Object.fromEntries(
      Object.entries(play.companionModes ?? {}).map(([cid, ids]) => [cid, ids.map((id) => content.modes[id]).filter(Boolean)]),
    ),
    focus,
    spellcasting,
    commanderTactics: ch.commanderTactics
      ? {
          ...ch.commanderTactics,
          prepared: (play.preparedTactics ?? [])
            .filter((id) => ch.commanderTactics!.folio.includes(id))
            .slice(0, ch.commanderTactics.preparedMax),
        }
      : ch.commanderTactics,
  };
}

/** Apply N damage: temp HP soaks first, the remainder becomes real damage. */
export function applyDamage(play: PlayState, amount: number, max: number): PlayState {
  const n = Math.max(0, Math.round(amount));
  const soaked = Math.min(play.tempHp, n);
  const toHp = n - soaked;
  const damage = clamp(play.damage + toHp, 0, max);
  let next: PlayState = { ...play, tempHp: play.tempHp - soaked, damage, conditions: play.conditions ?? [] };
  // Reduced to 0 HP → knocked out and Dying (PF2e). The Dying value gained is
  // 1 + your Wounded value (or +1 if already Dying); a single blow ≥ 2× max HP is
  // instant death. The Dying tracker / Heal then drive recovery.
  if (n > 0 && max > 0 && max - damage <= 0) {
    const deathAt = dyingDeathThreshold(condVal(next.conditions, 'doomed'));
    const dying = condVal(next.conditions, 'dying');
    const value =
      n >= 2 * max ? deathAt : dying > 0 ? Math.min(deathAt, dying + 1) : Math.min(deathAt, 1 + condVal(next.conditions, 'wounded'));
    next = setCondition(next, 'dying', value);
  }
  return next;
}

/** Heal N HP (reduces damage; never refills temp HP — that's a separate grant). */
export function applyHeal(play: PlayState, amount: number, max: number): PlayState {
  const n = Math.max(0, Math.round(amount));
  const damage = clamp(play.damage - n, 0, max);
  let next: PlayState = { ...play, damage, conditions: play.conditions ?? [] };
  // Restored to 1+ HP while Dying → you lose Dying and become Wounded (recoverFromDying
  // applies the Dying→Wounded bump; manual clears do not).
  if (n > 0 && max - damage >= 1 && condVal(next.conditions, 'dying') > 0) {
    next = { ...next, conditions: recoverFromDying(next.conditions) };
  }
  return next;
}

/** Set current HP directly to a value (clicking the HP number to edit it), clamped to [0, max]. */
export function setHp(play: PlayState, value: number, max: number): PlayState {
  return { ...play, damage: clamp(max - Math.round(value), 0, max) };
}

/** Set hero points directly (clicking the pips), clamped to the legal range. */
export function setHeroPoints(play: PlayState, value: number): PlayState {
  return { ...play, heroPoints: clamp(value, 0, MAX_HERO_POINTS) };
}

export function setMythicPoints(play: PlayState, value: number): PlayState {
  return { ...play, mythicPoints: clamp(value, 0, MAX_MYTHIC_POINTS) };
}

/** Set the temporary-HP pool directly (never negative). */
export function setTempHp(play: PlayState, value: number): PlayState {
  return { ...play, tempHp: Math.max(0, Math.round(value)) };
}

/** Set damage dealt to the wielded shield, clamped to [0, maxHp]. Current shield HP =
 *  maxHp − shieldDamage. (A night's rest does NOT repair a shield — that needs Repair.) */
export function setShieldDamage(play: PlayState, value: number, maxHp: number): PlayState {
  return { ...play, shieldDamage: clamp(Math.round(value), 0, maxHp) };
}

/** Set a temporary land-Speed override in feet (Hasted, Slowed, difficult terrain, …).
 *  Pass undefined (or a negative) to clear it and return to the default Speed. */
export function setTempSpeed(play: PlayState, value: number | undefined): PlayState {
  if (value == null || value < 0) {
    const { tempSpeed: _drop, ...rest } = play;
    return rest;
  }
  return { ...play, tempSpeed: Math.round(value) };
}

/** Add XP (never negative). */
export function addXp(play: PlayState, amount: number): PlayState {
  return { ...play, xp: Math.max(0, play.xp + Math.round(amount)) };
}

/** Set the XP total directly (never negative). */
export function setXp(play: PlayState, value: number): PlayState {
  return { ...play, xp: Math.max(0, Math.round(value)) };
}

/** Toggle a single prepared slot between cast (expended) and ready. */
export function toggleExpended(play: PlayState, key: string): PlayState {
  const expendedSlots = { ...play.expendedSlots };
  if (expendedSlots[key]) delete expendedSlots[key];
  else expendedSlots[key] = true;
  return { ...play, expendedSlots };
}

/** Set how many slots of a spontaneous rank pool are spent, clamped to [0, max]. */
export function setSlotsUsed(play: PlayState, key: string, used: number, max: number): PlayState {
  return { ...play, slotsUsed: { ...play.slotsUsed, [key]: clamp(used, 0, max) } };
}

/** Toggle whether a 1/day innate spell has been cast today (key `${entryId}:${spellId}`). */
export function toggleInnateCast(play: PlayState, entryId: string, spellId: string): PlayState {
  const key = `${entryId}:${spellId}`;
  const innateUsed = { ...(play.innateUsed ?? {}) };
  if (innateUsed[key]) delete innateUsed[key];
  else innateUsed[key] = true;
  return { ...play, innateUsed };
}

/** Prepare (or clear) the spell in a single prepared slot, in play. `null` empties the
 *  slot; the slot's expended flag is reset, since it's freshly prepared. */
export function setPreparedSpell(
  play: PlayState,
  entryId: string,
  rank: number,
  slotIndex: number,
  spellId: string | null,
): PlayState {
  const key = preparedKey(entryId, rank, slotIndex);
  const preparedSpells = { ...(play.preparedSpells ?? {}), [key]: spellId };
  const expendedSlots = { ...play.expendedSlots };
  delete expendedSlots[key];
  return { ...play, preparedSpells, expendedSlots };
}

/** Revert all in-play preparation changes for one entry back to the build's defaults. */
export function resetPreparedEntry(play: PlayState, entryId: string): PlayState {
  const prefix = `${entryId}:`;
  const preparedSpells = { ...(play.preparedSpells ?? {}) };
  const expendedSlots = { ...play.expendedSlots };
  for (const k of Object.keys(preparedSpells)) if (k.startsWith(prefix)) delete preparedSpells[k];
  for (const k of Object.keys(expendedSlots)) if (k.startsWith(prefix)) delete expendedSlots[k];
  return { ...play, preparedSpells, expendedSlots };
}

/** Set a spontaneous caster's known spells for one rank, in play. */
export function setRepertoireRank(play: PlayState, entryId: string, rank: number, ids: string[]): PlayState {
  const repertoireSpells = { ...(play.repertoireSpells ?? {}) };
  repertoireSpells[entryId] = { ...(repertoireSpells[entryId] ?? {}), [rank]: ids };
  return { ...play, repertoireSpells };
}

/** Set a spontaneous caster's signature spell ids, in play. */
export function setSignatureSpells(play: PlayState, entryId: string, ids: string[]): PlayState {
  return { ...play, signatureSpells: { ...(play.signatureSpells ?? {}), [entryId]: ids } };
}

/** Revert in-play repertoire + signature changes for one entry to the build's defaults. */
export function resetRepertoire(play: PlayState, entryId: string): PlayState {
  const repertoireSpells = { ...(play.repertoireSpells ?? {}) };
  const signatureSpells = { ...(play.signatureSpells ?? {}) };
  delete repertoireSpells[entryId];
  delete signatureSpells[entryId];
  return { ...play, repertoireSpells, signatureSpells };
}

/** Set focus points spent, clamped to [0, focus.max]. */
export function setFocusUsed(play: PlayState, used: number, max: number): PlayState {
  return { ...play, focusUsed: clamp(used, 0, max) };
}

// --- array-level condition logic (shared by the character + each companion) ---

function condAdd(list: ActiveCondition[], id: string, value?: number): ActiveCondition[] {
  if (list.some((c) => c.id === id)) return list;
  return [...list, value != null ? { id, value: Math.max(1, Math.round(value)) } : { id }];
}

/** Remove a condition from the list. This is a plain removal — it does NOT apply the
 *  Dying→Wounded bump, so that manually clearing a misapplied Dying (a misclick, or a
 *  GM removing it) doesn't wrongly add Wounded. The bump is reserved for genuine
 *  recovery (heal to 1+ HP), via recoverFromDying. */
function condRemove(list: ActiveCondition[], id: string): ActiveCondition[] {
  return list.filter((c) => c.id !== id);
}

/** Recover from Dying by being restored to 1+ HP: lose Dying and gain Wounded 1 (or
 *  +1 to an existing Wounded). Per PF2e, you become Wounded any time you lose Dying by
 *  recovering — distinct from a manual clear, which uses condRemove and does not bump. */
function recoverFromDying(list: ActiveCondition[]): ActiveCondition[] {
  let out = list.filter((c) => c.id !== 'dying');
  if (out.some((c) => c.id === 'wounded')) out = out.map((c) => (c.id === 'wounded' ? { ...c, value: (c.value ?? 1) + 1 } : c));
  else out = [...out, { id: 'wounded', value: 1 }];
  return out;
}

function condSet(list: ActiveCondition[], id: string, value: number): ActiveCondition[] {
  if (value <= 0) return condRemove(list, id);
  return list.map((c) => (c.id === id ? { ...c, value: Math.round(value) } : c));
}

/** Gain a condition (no-op if already present). `value` is 1+ for valued ones. */
export function addCondition(play: PlayState, id: string, value?: number): PlayState {
  return { ...play, conditions: condAdd(play.conditions, id, value) };
}

/** Remove a condition (Dying→Wounded handled). */
export function removeCondition(play: PlayState, id: string): PlayState {
  return { ...play, conditions: condRemove(play.conditions, id) };
}

/** Set a valued condition's value; a value of 0 or less removes it. */
export function setConditionValue(play: PlayState, id: string, value: number): PlayState {
  return { ...play, conditions: condSet(play.conditions, id, value) };
}

/** Set a valued condition to an exact value, ADDING it if absent (unlike
 *  setConditionValue, which only updates one already present). A value of 0 or
 *  less removes it (a plain removal — no Dying→Wounded bump; that's recovery-only). */
export function setCondition(play: PlayState, id: string, value: number): PlayState {
  if (value <= 0) return removeCondition(play, id);
  return play.conditions.some((c) => c.id === id)
    ? setConditionValue(play, id, value)
    : addCondition(play, id, value);
}

// --- companion conditions (tracked per companion id) ---

function withCompanionConditions(play: PlayState, compId: string, fn: (list: ActiveCondition[]) => ActiveCondition[]): PlayState {
  const map = play.companionConditions ?? {};
  return { ...play, companionConditions: { ...map, [compId]: fn(map[compId] ?? []) } };
}

export function addCompanionCondition(play: PlayState, compId: string, id: string, value?: number): PlayState {
  return withCompanionConditions(play, compId, (l) => condAdd(l, id, value));
}

export function removeCompanionCondition(play: PlayState, compId: string, id: string): PlayState {
  return withCompanionConditions(play, compId, (l) => condRemove(l, id));
}

export function setCompanionConditionValue(play: PlayState, compId: string, id: string, value: number): PlayState {
  return withCompanionConditions(play, compId, (l) => condSet(l, id, value));
}

/** Toggle a mode active/inactive on a single companion (mirrors {@link toggleMode} for the PC, including
 *  exclusive-group handling). */
export function toggleCompanionMode(play: PlayState, compId: string, id: string, modeDefs?: Record<string, ModeDef>): PlayState {
  const map = play.companionModes ?? {};
  const active = map[compId] ?? [];
  if (active.includes(id)) return { ...play, companionModes: { ...map, [compId]: active.filter((m) => m !== id) } };
  let next = [...active, id];
  const group = modeDefs?.[id]?.exclusiveGroup;
  if (group) next = next.filter((mid) => mid === id || modeDefs?.[mid]?.exclusiveGroup !== group);
  return { ...play, companionModes: { ...map, [compId]: next } };
}

// --- in-play companion roster (add / remove / configure from the Companions tab) ---

/** A fresh companion id (cmp-N) that won't collide with existing ids. */
function nextCompanionId(list: CompanionConfig[]): string {
  const max = list.reduce((m, c) => Math.max(m, Number(/(\d+)$/.exec(c.id)?.[1] ?? -1)), -1);
  return `cmp-${max + 1}`;
}

/** Add a companion in play (id assigned). */
export function addPlayCompanion(play: PlayState, cfg: Omit<CompanionConfig, 'id'>): PlayState {
  const list = play.companions ?? [];
  return { ...play, companions: [...list, { ...cfg, id: nextCompanionId(list) }] };
}

/** Remove a companion (and any tracked conditions/HP on it) in play. */
export function removePlayCompanion(play: PlayState, id: string): PlayState {
  const companionConditions = { ...(play.companionConditions ?? {}) };
  delete companionConditions[id];
  const companionHp = { ...(play.companionHp ?? {}) };
  delete companionHp[id];
  const companionModes = { ...(play.companionModes ?? {}) };
  delete companionModes[id];
  return { ...play, companions: (play.companions ?? []).filter((c) => c.id !== id), companionConditions, companionHp, companionModes };
}

/* ---- per-companion HP (vehicles/siege weapons track damage; creatures show current/max too) ---- */

function patchCompanionHp(play: PlayState, id: string, patch: Partial<{ damage: number; temp: number }>): PlayState {
  const map = play.companionHp ?? {};
  const cur = map[id] ?? { damage: 0, temp: 0 };
  return { ...play, companionHp: { ...map, [id]: { ...cur, ...patch } } };
}
/** Deal `amount` damage to a companion (temp HP soaks first); current = max − damage. */
export function applyCompanionDamage(play: PlayState, id: string, amount: number, max: number): PlayState {
  const cur = play.companionHp?.[id] ?? { damage: 0, temp: 0 };
  const n = Math.max(0, Math.round(amount));
  const soaked = Math.min(cur.temp, n);
  return patchCompanionHp(play, id, { temp: cur.temp - soaked, damage: clamp(cur.damage + (n - soaked), 0, max) });
}
/** Heal a companion `amount` HP (reduces tracked damage). */
export function applyCompanionHeal(play: PlayState, id: string, amount: number, max: number): PlayState {
  const cur = play.companionHp?.[id] ?? { damage: 0, temp: 0 };
  return patchCompanionHp(play, id, { damage: clamp(cur.damage - Math.max(0, Math.round(amount)), 0, max) });
}
/** Set a companion's current HP directly (clicking the number), clamped to [0, max]. */
export function setCompanionHp(play: PlayState, id: string, value: number, max: number): PlayState {
  return patchCompanionHp(play, id, { damage: clamp(max - Math.round(value), 0, max) });
}
/** Set a companion's temp-HP pool (never negative). */
export function setCompanionTempHp(play: PlayState, id: string, value: number): PlayState {
  return patchCompanionHp(play, id, { temp: Math.max(0, Math.round(value)) });
}

/** Buy a vehicle / siege weapon (or any companion) — deduct the character's coins, then add it. */
export function buyCompanion(play: PlayState, cfg: Omit<CompanionConfig, 'id'>, price: Coins | undefined): PlayState {
  if (price && !canAfford(play.currency, price)) return play;
  const next = price ? { ...play, currency: cpToCoins(coinsToCp(play.currency) - coinsToCp(price)) } : play;
  return addPlayCompanion(next, cfg);
}

/** Merge a patch into a companion in play (name / type / maturity / abilities). */
export function updatePlayCompanion(play: PlayState, id: string, patch: Partial<CompanionConfig>): PlayState {
  return { ...play, companions: (play.companions ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** Patch the inventory array of one companion (helper for the companion-gear mutators below). */
function patchCompanionInventory(
  play: PlayState,
  compId: string,
  fn: (inv: InventoryItem[]) => InventoryItem[],
): PlayState {
  return {
    ...play,
    companions: (play.companions ?? []).map((c) => (c.id === compId ? { ...c, inventory: fn(c.inventory ?? []) } : c)),
  };
}

/** Add a (free) item to a companion's gear. */
export function addCompanionItem(play: PlayState, compId: string, itemId: string): PlayState {
  return patchCompanionInventory(play, compId, (inv) => [...inv, { instanceId: nextInstanceId(inv), itemId, quantity: 1 }]);
}

/** Buy an item for a companion — deduct the character's coins, then add it. */
export function buyCompanionItem(play: PlayState, compId: string, itemId: string, price: Coins | undefined): PlayState {
  if (!canAfford(play.currency, price)) return play;
  const remaining = cpToCoins(coinsToCp(play.currency) - coinsToCp(price));
  return addCompanionItem({ ...play, currency: remaining }, compId, itemId);
}

/** Remove one of a companion's items. */
export function removeCompanionItem(play: PlayState, compId: string, instanceId: string): PlayState {
  return patchCompanionInventory(play, compId, (inv) => inv.filter((i) => i.instanceId !== instanceId));
}

/** Set the quantity of a companion's item (min 1). */
export function setCompanionItemQty(play: PlayState, compId: string, instanceId: string, qty: number): PlayState {
  return patchCompanionInventory(play, compId, (inv) =>
    inv.map((i) => (i.instanceId === instanceId ? { ...i, quantity: Math.max(1, Math.round(qty)) } : i)),
  );
}

/** Toggle a worn/equipped/invested flag on a companion's item. */
export function toggleCompanionItemFlag(play: PlayState, compId: string, instanceId: string, flag: ItemFlag): PlayState {
  return patchCompanionInventory(play, compId, (inv) => inv.map((i) => (i.instanceId === instanceId ? { ...i, [flag]: !i[flag] } : i)));
}

/** Set one bio/details field in play (merged over the build's details by applyPlayState).
 *  An empty string clears the field. */
export function setDetail(play: PlayState, key: keyof CharacterDetails, value: string): PlayState {
  const details = { ...(play.details ?? {}) };
  if (value === '') delete details[key];
  else details[key] = value;
  return { ...play, details };
}

/** Set (or clear, with null) the character's portrait. `dataUrl` is the compressed (synced) copy; `ref`
 *  keys the matching on-device sharp copy (installed app) — pass it so display can find the sharp copy,
 *  or omit/undefined for the compressed-only case. Stored in the in-play appearance overlay. */
export function setPortrait(play: PlayState, dataUrl: string | null, ref?: string): PlayState {
  const appearance = { ...(play.appearance ?? {}) };
  if (dataUrl === null) {
    delete appearance.portrait;
    delete appearance.portraitRef;
  } else {
    appearance.portrait = dataUrl;
    if (ref) appearance.portraitRef = ref;
    else delete appearance.portraitRef;
  }
  return { ...play, appearance };
}

/** A fresh instanceId that won't collide with existing `inv-N` ids. */
function nextInstanceId(inv: InventoryItem[]): string {
  const max = inv.reduce((m, i) => Math.max(m, Number(/(\d+)$/.exec(i.instanceId)?.[1] ?? -1)), -1);
  return `inv-${max + 1}`;
}

/** Kits that, when acquired, expand into a container holding their contents instead of a single
 *  opaque item — e.g. Adventurer's Pack becomes a worn Backpack holding the bedroll, rope, rations,
 *  torches, etc. (RAW pack contents). Add new packs here; each `container` + `itemId` is a content slug. */
const KIT_CONTENTS: Record<string, { container: string; items: { itemId: string; quantity?: number }[] }> = {
  'adventurers-pack': {
    container: 'backpack',
    items: [
      { itemId: 'bedroll' },
      { itemId: 'chalk', quantity: 10 },
      { itemId: 'flint-and-steel' },
      { itemId: 'rope' },
      { itemId: 'rations', quantity: 2 },
      { itemId: 'soap' },
      { itemId: 'torch', quantity: 5 },
      { itemId: 'waterskin' },
    ],
  },
};

/** Add one of `itemId` to the inventory (worn/equipped state defaulted by the caller). A KIT item
 *  (Adventurer's Pack) instead adds its container + each content item nested inside it. */
export function addInventoryItem(play: PlayState, itemId: string, init?: Partial<InventoryItem>): PlayState {
  const kit = KIT_CONTENTS[itemId];
  if (kit) {
    let inv = play.inventory ?? [];
    const containerInstanceId = nextInstanceId(inv);
    inv = [...inv, { instanceId: containerInstanceId, itemId: kit.container, quantity: 1, worn: true }];
    for (const c of kit.items) {
      inv = [...inv, { instanceId: nextInstanceId(inv), itemId: c.itemId, quantity: c.quantity ?? 1, containerInstanceId }];
    }
    return { ...play, inventory: inv };
  }
  const inv = play.inventory ?? [];
  return {
    ...play,
    inventory: [...inv, { instanceId: nextInstanceId(inv), itemId, quantity: 1, ...init }],
  };
}

/** Remove an inventory item by instance. */
export function removeInventoryItem(play: PlayState, instanceId: string): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? [])
      .filter((i) => i.instanceId !== instanceId)
      // Anything affixed to the removed item comes loose rather than dangling.
      .map((i) => (i.attachedTo === instanceId ? { ...i, attachedTo: null } : i)),
  };
}

/** Affix an attachment (talisman/spellheart/banner) onto a host item; it stops being separately worn/carried. */
export function attachItem(play: PlayState, attachmentId: string, hostId: string): PlayState {
  const inv = play.inventory ?? [];
  const src = inv.find((i) => i.instanceId === attachmentId);
  const attached = { attachedTo: hostId, worn: false, equipped: false, invested: false, containerInstanceId: undefined };
  // A stack of consumable talismans (quantity > 1): peel ONE off and affix it, leaving the rest as a
  // loose stack — exactly like the rune-etch path. Affixing the whole instance would lock the other
  // N-1 units inside the affixed item, making them inaccessible.
  if (src && (src.quantity ?? 1) > 1) {
    return {
      ...play,
      inventory: [
        ...inv.map((i) => (i.instanceId === attachmentId ? { ...i, quantity: src.quantity - 1 } : i)),
        { ...src, instanceId: nextInstanceId(inv), quantity: 1, ...attached },
      ],
    };
  }
  return {
    ...play,
    inventory: inv.map((i) => (i.instanceId === attachmentId ? { ...i, ...attached } : i)),
  };
}

/** Peel an attachment off its host (it becomes a loose carried item again). */
export function detachItem(play: PlayState, attachmentId: string): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) => (i.instanceId === attachmentId ? { ...i, attachedTo: null } : i)),
  };
}

/** Set an item's quantity (minimum 1). */
export function setItemQuantity(play: PlayState, instanceId: string, qty: number): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) =>
      i.instanceId === instanceId ? { ...i, quantity: Math.max(1, Math.round(qty)) } : i,
    ),
  };
}

/** Toggle a per-item carry flag (worn / equipped / invested). */
export function toggleItemFlag(play: PlayState, instanceId: string, flag: ItemFlag): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) => {
      if (i.instanceId !== instanceId) return i;
      const on = !i[flag];
      // Wielding / wearing / investing an item pulls it OUT of any container into the Equipped section —
      // you can't hold or wear something stowed in a backpack. (Matches drag-to-Equipped, which clears
      // containerInstanceId too.) The Equipped section only lists "loose" items, so without this a
      // container item would stay hidden in its backpack even after you equipped it.
      return on ? { ...i, [flag]: true, containerInstanceId: undefined } : { ...i, [flag]: false };
    }),
  };
}

/** Merge a partial update into one inventory item (used by drag-and-drop to relocate an
 *  item between Equipped / Carried / a container — sets carry flags + containerInstanceId). */
export function updateInventoryItem(play: PlayState, instanceId: string, patch: Partial<InventoryItem>): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) => (i.instanceId === instanceId ? { ...i, ...patch } : i)),
  };
}

// ───────────────────────── Monster Parts (variant rule) ─────────────────────────

/** Set (or clear, with undefined) an item's Monster-Parts blob (its refined/imbued gear state). An item
 *  uses EITHER monster parts OR runes/materials — never both — so switching to Monster-Parts mode clears
 *  its runes, and switching off drops the blob. Refine/imbue values are set FREELY (reference-only, no
 *  spending): the character's harvested monster-part inventory items are just an informational reference. */
export function setItemMonsterPart(
  play: PlayState,
  instanceId: string,
  monsterPart: InventoryItem['monsterPart'] | undefined,
): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) => {
      if (i.instanceId !== instanceId) return i;
      const next: InventoryItem = { ...i };
      if (monsterPart) {
        next.monsterPart = monsterPart;
        delete next.runes; // either/or: a Monster-Parts item ignores its runes/material.
      } else {
        delete next.monsterPart;
      }
      return next;
    }),
  };
}

/** Set an item's refine value FREELY (no deduction). Ensures a blob of the given `kind` exists (creating
 *  one for an auto-kind item that has none yet) and clears the item's runes (either/or). */
export function setItemRefineValue(
  play: PlayState,
  instanceId: string,
  kind: ItemMonsterPart['kind'],
  refineValue: number,
): PlayState {
  const inv = (play.inventory ?? []).find((i) => i.instanceId === instanceId);
  const blob: ItemMonsterPart = inv?.monsterPart ?? { kind, refineValue: 0, imbuements: [] };
  return setItemMonsterPart(play, instanceId, { ...blob, kind, refineValue: Math.max(0, Math.round(refineValue)) });
}

/** Replace an item's imbuement list FREELY (no deduction). A no-op if the item has no monster-part blob. */
export function setItemImbuements(play: PlayState, instanceId: string, imbuements: ItemImbuement[]): PlayState {
  const inv = (play.inventory ?? []).find((i) => i.instanceId === instanceId);
  if (!inv?.monsterPart) return play;
  return setItemMonsterPart(play, instanceId, { ...inv.monsterPart, imbuements });
}

/** Set (or clear, with undefined) an item's use-tracker — max uses + whether it refills on rest. */
export function setItemCharges(
  play: PlayState,
  instanceId: string,
  charges: { current: number; max: number; resetsOnRest?: boolean } | undefined,
): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) => {
      if (i.instanceId !== instanceId) return i;
      const next = { ...i };
      if (charges) next.charges = charges;
      else delete next.charges;
      return next;
    }),
  };
}

/** Spend (positive delta) or restore (negative) item uses, clamped to [0, max]. */
export function useItemCharge(play: PlayState, instanceId: string, delta = 1): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) =>
      i.instanceId === instanceId && i.charges
        ? { ...i, charges: { ...i.charges, current: clamp(i.charges.current - delta, 0, i.charges.max) } }
        : i,
    ),
  };
}

/** Set one of an item's counters (by id) — used by the per-counter +/- use trackers. */
export function setItemCounter(
  play: PlayState,
  instanceId: string,
  counterId: string,
  value: { current: number; max: number; resetsOnRest?: boolean },
): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) =>
      i.instanceId === instanceId ? { ...i, counters: { ...i.counters, [counterId]: value } } : i,
    ),
  };
}

/** Set the wallet directly (Manage Coins editor). */
export function setCurrency(play: PlayState, currency: Coins): PlayState {
  return { ...play, currency };
}

/** Prepare/unprepare a Commander tactic for the day (capped at preparedMax; over-cap toggles no-op). */
export function toggleTactic(play: PlayState, tacticId: string, preparedMax: number): PlayState {
  const cur = play.preparedTactics ?? [];
  if (cur.includes(tacticId)) return { ...play, preparedTactics: cur.filter((id) => id !== tacticId) };
  if (cur.length >= preparedMax) return play; // already at capacity — ignore
  return { ...play, preparedTactics: [...cur, tacticId] };
}

/** Pin/unpin an activity by its key (Main-tab favorites). */
export function togglePin(play: PlayState, key: string): PlayState {
  const pinned = play.pinned ?? [];
  return { ...play, pinned: pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key] };
}

/** Stable identity for a pinned description: its source-map name + lowercased title. The map name
 *  disambiguates cross-map name collisions (a feat + a same-named spell). Entries pinned before the
 *  `key` discriminator existed have no key and fall back to title-only matching. */
export function descId(n: { key?: string; title: string }): string {
  return `${n.key ?? ''}:${n.title.toLowerCase()}`;
}

/** Pin/unpin a description popup (starred from a description page), keyed by source-map + title. */
export function togglePinnedDesc(play: PlayState, node: PinnedDesc): PlayState {
  const list = play.pinnedDescs ?? [];
  const id = descId(node);
  const exists = list.some((d) => descId(d) === id);
  return {
    ...play,
    pinnedDescs: exists
      ? list.filter((d) => descId(d) !== id)
      : [...list, { title: node.title, description: node.description, descRefs: node.descRefs, key: node.key }],
  };
}

/**
 * Activate/deactivate a mode by id. When activating a mode that belongs to an exclusiveGroup,
 * any already-active mode in the same group is turned off first (e.g. only one bard composition
 * or rage state at a time). Pass `modeDefs` (content.modes) to enable the exclusivity check.
 */
export function toggleMode(play: PlayState, id: string, modeDefs?: Record<string, ModeDef>): PlayState {
  const active = play.activeModes ?? [];
  if (active.includes(id)) return { ...play, activeModes: active.filter((m) => m !== id) };
  let next = [...active, id];
  const group = modeDefs?.[id]?.exclusiveGroup;
  if (group) {
    next = next.filter((mid) => mid === id || modeDefs?.[mid]?.exclusiveGroup !== group);
  }
  return { ...play, activeModes: next };
}

/** Enter a stance by slug, or exit it (pass the same slug again, or null). Exclusive by construction —
 *  storing a single slug means entering one stance always replaces the previous. */
export function setActiveStance(play: PlayState, slug: string | null): PlayState {
  if (!slug || play.activeStance === slug) return { ...play, activeStance: undefined };
  return { ...play, activeStance: slug };
}

/** Set a class-resource counter to a value, clamped to [0, max]. */
export function setResource(play: PlayState, id: string, value: number, max: number): PlayState {
  return { ...play, resources: { ...(play.resources ?? {}), [id]: clamp(Math.round(value), 0, max) } };
}

/** Flip a class-resource toggle (0/1) on/off. */
export function toggleResource(play: PlayState, id: string): PlayState {
  const cur = (play.resources ?? {})[id] ?? 0;
  return { ...play, resources: { ...(play.resources ?? {}), [id]: cur ? 0 : 1 } };
}

/** A fresh notes-page id that won't collide with existing `note-N` ids. */
export function nextNoteId(notes: NotePage[]): string {
  const max = notes.reduce((m, p) => Math.max(m, Number(/(\d+)$/.exec(p.id)?.[1] ?? -1)), -1);
  return `note-${max + 1}`;
}

/** Add a blank notes page. */
export function addNotePage(play: PlayState, icon = 'ti-note'): PlayState {
  const notes = play.notes ?? [];
  return { ...play, notes: [...notes, { id: nextNoteId(notes), title: 'New page', content: '', icon }] };
}

/** Remove a notes page by id. */
export function removeNotePage(play: PlayState, id: string): PlayState {
  return { ...play, notes: (play.notes ?? []).filter((p) => p.id !== id) };
}

/** Merge a partial update into a notes page (title, content, icon, color, private). */
export function updateNotePage(play: PlayState, id: string, patch: Partial<NotePage>): PlayState {
  return { ...play, notes: (play.notes ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

/** Whether the wallet covers a price (free/undefined prices are always affordable). */
export function canAfford(currency: Coins | undefined, price: Coins | undefined): boolean {
  return coinsToCp(price) <= coinsToCp(currency);
}

/** Buy an item: deduct its price from the wallet and add it. No-op if unaffordable. */
export function buyItem(play: PlayState, itemId: string, price: Coins | undefined): PlayState {
  if (!canAfford(play.currency, price)) return play;
  const remaining = cpToCoins(coinsToCp(play.currency) - coinsToCp(price));
  return addInventoryItem({ ...play, currency: remaining }, itemId);
}

/**
 * Reconcile a play state after the build is edited/rebuilt. The rebuild re-derives spell preparation
 * and class resources from the new choices, so we drop those (re-seeded from the new character) and
 * refill usage counters (slots/focus). Genuine in-play progress is KEPT: damage, temp HP, hero points,
 * XP, conditions, pins, notes, companion state — AND the player's actual inventory + currency (real
 * progress, not build-derived; left undefined for a character that never touched inventory in play so
 * the rebuilt build gear still seeds correctly).
 */
export function playForRebuild(play: PlayState): PlayState {
  return {
    damage: play.damage,
    tempHp: play.tempHp,
    shieldDamage: play.shieldDamage,
    tempSpeed: play.tempSpeed,
    heroPoints: play.heroPoints,
    mythicPoints: play.mythicPoints,
    xp: play.xp,
    conditions: play.conditions ?? [],
    pinned: play.pinned ?? [],
    pinnedDescs: play.pinnedDescs,
    companionConditions: play.companionConditions,
    companionHp: play.companionHp,
    companionModes: play.companionModes,
    companions: play.companions,
    details: play.details,
    appearance: play.appearance,
    activeModes: play.activeModes,
    notes: play.notes,
    // Keep the player's real gear + wallet across the edit: items bought/looted and gold spent are
    // genuine progress, not build-derived. (Undefined falls back to the rebuilt build gear for a
    // character that never managed inventory in play, so fresh builds still seed correctly.) Spell
    // prep / repertoire / signature and class resources ARE re-derived from the new build, so omitted.
    inventory: play.inventory,
    currency: play.currency,
    expendedSlots: {},
    slotsUsed: {},
    focusUsed: 0,
  };
}

/** Apply a full night's rest to a condition list. A night's rest is the day's big recovery, so it
 *  removes Fatigued, Wounded, AND Dying (you survive/recover overnight — without this, Dying and
 *  Wounded picked up from dropping to 0 HP would linger forever, since a night's HP recovery often
 *  won't reach full). Doomed and Drained step down by 1 (removed at 0). Other conditions persist
 *  (their durations aren't tracked, so the player clears those manually). */
function restConditions(list: ActiveCondition[]): ActiveCondition[] {
  const out: ActiveCondition[] = [];
  for (const c of list) {
    if (c.id === 'fatigued' || c.id === 'wounded' || c.id === 'dying') continue;
    if (c.id === 'doomed' || c.id === 'drained') {
      const v = (c.value ?? 1) - 1;
      if (v > 0) out.push({ ...c, value: v });
      continue;
    }
    out.push(c);
  }
  return out;
}

/**
 * A full night's rest + daily preparations, per PF2e — NOT a full heal. You regain Hit
 * Points equal to your level × your Constitution modifier (minimum 1); temp HP clears;
 * spell slots, the focus pool, and daily-use class resources refresh; Fatigued, Wounded, and
 * Dying are removed, and Doomed and Drained step down by 1. Hero points are session-based and
 * untouched. XP carries over.
 */
export function rest(
  play: PlayState,
  opts: { level: number; conMod: number; initialResources?: Record<string, number> },
): PlayState {
  const recovered = Math.max(0, opts.level) * Math.max(1, opts.conMod);
  const damage = Math.max(0, play.damage - recovered);
  const companionConditions = play.companionConditions
    ? Object.fromEntries(Object.entries(play.companionConditions).map(([k, v]) => [k, restConditions(v)]))
    : play.companionConditions;
  // Creature companions fully recover overnight; vehicles & siege weapons need Repair, not rest.
  const companionHp = play.companionHp
    ? Object.fromEntries(
        Object.entries(play.companionHp).map(([id, hp]) => {
          const kind = (play.companions ?? []).find((c) => c.id === id)?.kind;
          return [id, kind === 'vehicle' || kind === 'siege' ? hp : { damage: 0, temp: 0 }];
        }),
      )
    : play.companionHp;
  // Refill tracked item uses that reset on daily preparations (wands, staves, per-day items) —
  // both the legacy single `charges` and each `counters` entry flagged resetsOnRest.
  const inventory = play.inventory
    ? play.inventory.map((i) => {
        let next = i;
        if (i.charges?.resetsOnRest) next = { ...next, charges: { ...i.charges, current: i.charges.max } };
        if (i.counters && Object.values(i.counters).some((c) => c.resetsOnRest)) {
          next = {
            ...next,
            counters: Object.fromEntries(
              Object.entries(i.counters).map(([id, c]) => [id, c.resetsOnRest ? { ...c, current: c.max } : c]),
            ),
          };
        }
        return next;
      })
    : play.inventory;
  return {
    ...play,
    damage,
    tempHp: 0,
    focusUsed: 0,
    // Mythic points are a daily resource (unlike session-based hero points) — refill on rest.
    mythicPoints: MAX_MYTHIC_POINTS,
    expendedSlots: {},
    slotsUsed: {},
    innateUsed: {},
    conditions: restConditions(play.conditions ?? []),
    companionConditions,
    companionHp,
    resources: opts.initialResources ?? play.resources,
    inventory,
  };
}
