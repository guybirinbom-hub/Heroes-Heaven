/*
 * CHARACTER.TWEAKKEPT — Tweaks phase 2, C46 (work/tweaks-phase2-notes/plan.md; WP7 step 6).
 *
 * An extra feat place (`choice.addPlace`, its pick under `<level>:extra<category>:<n>`) that is paused, or whose
 * character has Tweaks switched off, adds nothing (C5, C9): `buildCharacter` emits no Character.feats row for its
 * feat. A character reopened with NO stored build — the reverse build, `deriveBuildFromCharacter`, from the
 * published Character (an import, a GM-received copy, an `editableBuildOf` fallback) — rebuilt its picks from those
 * rows only, so a paused place came back empty and its feat and every answer made for it were gone, silently.
 *
 * A LIVE place loses its pick the same way when `buildCharacter` emits no row under its key (WP7 run 3a): the same
 * feat is also in a book slot or another place (the featPicks loop's take cap drops the place's row), the place's
 * level is above the character's, or the character is also granted that feat (a warpriest's Shield Block: only the
 * grant's row exists).
 *
 * So `buildCharacter` writes what such a place holds into `Character.tweakKept.featPlaces` (`tweakKeptOf`),
 * and the reverse build puts it back into the build's own stores (`readKeptFeatPlaces` + `restoreKeptFeatPlaces`),
 * never over an entry a store already holds: UNKNOWN ≠ EMPTY, and a player's answer is never overwritten.
 * Nothing else reads it. Absent when there is nothing to keep, so every character without such a place is
 * byte-for-byte what it was (and older apps ignore the optional field).
 *
 * An entry is one extra feat place that holds a pick (`featIdAtSlot`) and is either
 *   - HELD BACK now (`heldBackPlaceKeys`: its block readable, none of its blocks live), or
 *   - LIVE now (a readable `choice.addPlace` feat block that is live, `livePlaces`, any level) with NO
 *     Character.feats row under its own slot key. A live place WITH its row adds no entry: the row brings it back.
 * Held-back entries come first (in `heldBackPlaceKeys` order), then live ones (in stored block order), one per key.
 * A place whose block is gone, unreadable or newer is neither, so it adds no entry (it counts as today's "feat with
 * no slot", C9). Book slots are not covered (the same gap exists for them; not WP7).
 *
 * What an entry carries (rev 3 r9), by build map name:
 *   - every entry whose key holds the place's slot key, in the maps `swapSlotKeys` moves (SLOT_KEYED less the pick
 *     itself, and VARIANT_KEYED's `#<slot>` keys — slotKey.ts `keyHoldsSlot`);
 *   - every entry keyed by the place's feat id (`<id>`, `<id>:…`, `<id>#…`) in dedicationSkillFeats,
 *     pickFeatChoices, pickCantripChoices, featSkillChoices and featLoreChoices — only when that feat is held
 *     nowhere now (no Character.feats row: no live slot, live place, given feat or grant), and only on the first
 *     kept place holding it (held-back and live entries share that "first", in the order above).
 *
 * WP8 (fixes round 1): a BOOK slot's copy of a feat that the featPicks loop's take cap dropped while a readable
 * "Take a feat more times" (`choice.moreTakes`) for that feat is stored — paused, Tweaks off, or live with too few
 * times — is lost the same way (the reverse build has only the rows), so turning the tweak back on found the slot
 * empty. `keptFeatCopies` keeps each such copy in `Character.tweakKept.featCopies`: a book slot key (no extra place),
 * at or below the character's level, holding a pick, with no Character.feats row under its key while a row holds
 * the feat (the cap's own case: the slot's level and the place gate leave no other reason). It carries the
 * entries under its slot key in the same maps a kept place's do; no feat-id answers (a row holds the feat, so its
 * row brings them back). `readKeptFeatCopies` takes back only entries naming a book slot and a feat the reverse
 * build still stores a readable moreTakes block for. A character with no such block is byte-for-byte what it was.
 *
 * WP14 (C46, C47): a skill-increase or boost place a LIVE `remove.choicePlace` removes keeps its stored answer in
 * its own store (the removal never writes one), but the answer counts nowhere, so no Character field carries it and
 * a build-less reopen would lose it. `keptSkillIncreases` / `keptBoosts` keep each such answer; `readKept…` take
 * back only entries naming a place a live removal on the reopened build names (a paused removal, or Tweaks off,
 * makes the place count again, and then the reverse build's own solving fills it from the character's numbers);
 * `restoreKeptSkillIncreases` fills only an empty level of its lane's store. Kept boosts go back through the
 * reverse build's attribute solver (build.ts), which skips the removed indexes.
 *
 * Pure apart from `restoreKeptFeatPlaces` and `restoreKeptSkillIncreases`, which write into the reverse build's own
 * fresh BuildState. It imports types only from build.ts (build.ts imports this file).
 */
import { boostPlaceId, featPlaceKeyOf, heldBackPlaceKeys, livePlaces, removedBoostPlaces, removedPlaces, removedSkillIncreasePlaces, skillPlaceId, storedChoiceBlocks } from './blocks/active';
import { featIdAtSlot } from './heldFeats';
import { keyHoldsSlot, SLOT_ANSWER_MAPS, SLOT_PREFIX, VARIANT_KEYED } from './slotKey';
import type { BuildState } from './build';
import type { KeptBoost, KeptFeatPlace, KeptSkillIncrease, TweakKept } from './types';

/** The build maps keyed by a feat's OWN id that hold answers made for that feat (rev 3 r9). */
export const FEAT_ID_ANSWER_MAPS = ['dedicationSkillFeats', 'pickFeatChoices', 'pickCantripChoices', 'featSkillChoices', 'featLoreChoices'] as const;
/** The maps whose keys hold a slot key: `swapSlotKeys`' set (SLOT_KEYED + VARIANT_KEYED) less `featPicks`. */
const SLOT_HOLDING_MAPS: readonly string[] = [...new Set<string>([...SLOT_ANSWER_MAPS, ...VARIANT_KEYED])];
/** Every map a kept answer may go back into — the build's own answer stores, nothing else. */
const KEPT_ANSWER_MAPS: ReadonlySet<string> = new Set([...SLOT_HOLDING_MAPS, ...FEAT_ID_ANSWER_MAPS]);

type Stores = Record<string, Record<string, unknown> | undefined>;

/** Is `k` an entry keyed by the feat id itself: `<id>`, `<id>:<…>` or `<id>#<…>`? */
const keyedByFeat = (k: string, featId: string): boolean => k === featId || k.startsWith(`${featId}:`) || k.startsWith(`${featId}#`);

/**
 * The live extra feat places' slot keys (stored block order, one per key) that hold a pick but have no
 * Character.feats row under that key. `rowKeys`: the built character's row slot keys.
 */
function liveRowlessPlaceKeys(build: BuildState, rowKeys: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const p of livePlaces(build)) {
    const k = p.place === 'feat' ? p.slotKey : undefined;
    if (k && !rowKeys.has(k) && !out.includes(k) && featIdAtSlot(build, k)) out.push(k);
  }
  return out;
}

/**
 * The extra feat places to keep — every held-back one, and every live one with no row under its key, that holds a
 * pick — with every answer made for each (see the header). `heldNow`: the feats the built character holds (its
 * Character.feats ids); `rowKeys`: the slot keys of its Character.feats rows. Empty for a character with no
 * such place.
 */
export function keptFeatPlaces(build: BuildState, heldNow: ReadonlySet<string>, rowKeys: ReadonlySet<string>): KeptFeatPlace[] {
  const back = heldBackPlaceKeys(build);
  const keys = [...back, ...liveRowlessPlaceKeys(build, rowKeys).filter((k) => !back.has(k))];
  if (!keys.length) return [];
  const stores = build as unknown as Stores;
  const out: KeptFeatPlace[] = [];
  const claimed = new Set<string>();
  for (const slotKey of keys) {
    const featId = featIdAtSlot(build, slotKey);
    if (!featId) continue;
    const answers: Record<string, Record<string, string>> = {};
    const take = (map: string, holds: (k: string) => boolean) => {
      for (const [k, v] of Object.entries(stores[map] ?? {})) if (typeof v === 'string' && holds(k)) (answers[map] ??= {})[k] = v;
    };
    for (const map of SLOT_HOLDING_MAPS) take(map, (k) => keyHoldsSlot(k, slotKey));
    if (!heldNow.has(featId) && !claimed.has(featId)) {
      claimed.add(featId);
      for (const map of FEAT_ID_ANSWER_MAPS) take(map, (k) => keyedByFeat(k, featId));
    }
    out.push({ slotKey, featId, ...(Object.keys(answers).length ? { answers } : {}) });
  }
  return out;
}

/** Is `k` a whole book slot key, `<level>:<category>:<n>` (no suffix, no extra place)? */
const isBookSlot = (k: string): boolean => SLOT_PREFIX.exec(k)?.[0] === k && featPlaceKeyOf(k) === null;
/** The feats with a READABLE `choice.moreTakes` block stored, any state (paused, Tweaks off, live). */
const moreTakesRecords = (h: BuildState): ReadonlySet<string> =>
  new Set(storedChoiceBlocks(h).flatMap((b) => (b.kind === 'choice.moreTakes' && typeof b.record === 'string' ? [b.record] : [])));

/**
 * WP8 (fixes round 1): the book slots' copies the featPicks loop's take cap dropped while a readable moreTakes block
 * for the feat is stored (see the header), in featPicks order, each with the entries under its slot key. Empty for a
 * character with no moreTakes block (the common case: one cached read).
 */
export function keptFeatCopies(build: BuildState, heldNow: ReadonlySet<string>, rowKeys: ReadonlySet<string>): KeptFeatPlace[] {
  const records = moreTakesRecords(build);
  if (!records.size) return [];
  const stores = build as unknown as Stores;
  const out: KeptFeatPlace[] = [];
  for (const [slotKey, featId] of Object.entries(build.featPicks ?? {})) {
    if (!featId || !records.has(featId) || !heldNow.has(featId) || rowKeys.has(slotKey) || !isBookSlot(slotKey)) continue;
    if (Number(slotKey.split(':')[0]) > build.level) continue;
    const answers: Record<string, Record<string, string>> = {};
    for (const map of SLOT_HOLDING_MAPS) {
      for (const [k, v] of Object.entries(stores[map] ?? {})) if (typeof v === 'string' && keyHoldsSlot(k, slotKey)) (answers[map] ??= {})[k] = v;
    }
    out.push({ slotKey, featId, ...(Object.keys(answers).length ? { answers } : {}) });
  }
  return out;
}

/** WP14: each skill-increase lane's store, by the lane name a removal stores. */
const SKILL_LANE_STORE = { main: 'skillIncreases', bonus: 'bonusSkillIncreases', background: 'backgroundSkillIncreases' } as const;
type SkillLane = keyof typeof SKILL_LANE_STORE;
const isSkillLane = (l: unknown): l is SkillLane => typeof l === 'string' && Object.prototype.hasOwnProperty.call(SKILL_LANE_STORE, l);
const laneStore = (b: BuildState, lane: SkillLane): Record<number, string> | undefined =>
  (b as unknown as Record<string, Record<number, string> | undefined>)[SKILL_LANE_STORE[lane]];

/** WP14: one boost set's stored list, by the set name a removal stores. */
function boostList(b: BuildState, set: string, level?: number): readonly (string | null)[] | undefined {
  if (set === 'ancestry') return b.ancestryBoosts;
  if (set === 'background') return b.backgroundBoosts;
  if (set === 'free') return b.levelBoosts;
  if (set === 'level' && typeof level === 'number') return b.attributeBoosts?.[level];
  return undefined;
}

/**
 * WP14 (C46): the skill-increase places a LIVE removal names that hold an answer, at or below the character's level
 * (an answer above it counts nowhere with or without the removal), in stored block order, one per place. Empty for
 * a character with no such removal.
 */
export function keptSkillIncreases(build: BuildState): KeptSkillIncrease[] {
  const out: KeptSkillIncrease[] = [];
  const seen = new Set<string>();
  for (const r of removedPlaces(build).skillIncrease) {
    if (typeof r.level !== 'number' || !isSkillLane(r.lane) || r.level > build.level) continue;
    const id = skillPlaceId(r.lane, r.level);
    const skill = laneStore(build, r.lane)?.[r.level];
    if (seen.has(id) || typeof skill !== 'string' || !skill) continue;
    seen.add(id);
    out.push({ level: r.level, lane: r.lane, skill });
  }
  return out;
}

/** WP14 (C46): …and the boost places a live removal names that hold a pick (a level set only up to the character's
 *  level), in stored block order, one per place. `level` only on a level set's entry. */
export function keptBoosts(build: BuildState): KeptBoost[] {
  const out: KeptBoost[] = [];
  const seen = new Set<string>();
  for (const r of removedPlaces(build).boost) {
    if (typeof r.set !== 'string' || typeof r.index !== 'number') continue;
    if (r.set === 'level' && (typeof r.level !== 'number' || r.level > build.level)) continue;
    const id = boostPlaceId(r.set, r.level, r.index);
    const attribute = boostList(build, r.set, r.level)?.[r.index];
    if (seen.has(id) || typeof attribute !== 'string' || !attribute) continue;
    seen.add(id);
    out.push({ set: r.set, ...(r.set === 'level' ? { level: r.level } : {}), index: r.index, attribute });
  }
  return out;
}

/** `Character.tweakKept` for a build (`buildCharacter`): undefined when there is nothing to keep. `heldNow` /
 *  `rowKeys`: the built Character.feats rows' feat ids and slot keys. Each list is present only when non-empty. */
export function tweakKeptOf(build: BuildState, heldNow: ReadonlySet<string>, rowKeys: ReadonlySet<string>): TweakKept | undefined {
  const featPlaces = keptFeatPlaces(build, heldNow, rowKeys);
  const featCopies = keptFeatCopies(build, heldNow, rowKeys);
  const skillIncreases = keptSkillIncreases(build);
  const boosts = keptBoosts(build);
  if (!featPlaces.length && !featCopies.length && !skillIncreases.length && !boosts.length) return undefined;
  return {
    ...(featPlaces.length ? { featPlaces } : {}),
    ...(featCopies.length ? { featCopies } : {}),
    ...(skillIncreases.length ? { skillIncreases } : {}),
    ...(boosts.length ? { boosts } : {}),
  };
}

/**
 * WP14: the kept skill increases a reverse build may put back, read defensively from a published Character (any
 * shape): each entry naming a place a LIVE removal on `b` (the reverse build, carrying the character's own
 * `overrides` and `options`) names, with a skill. A paused removal or Tweaks off names none: that place counts, so
 * its answer is a Character row and comes back the ordinary way.
 */
export function readKeptSkillIncreases(b: BuildState, kept: unknown): KeptSkillIncrease[] {
  const list = kept && typeof kept === 'object' ? (kept as { skillIncreases?: unknown }).skillIncreases : undefined;
  if (!Array.isArray(list) || !list.length) return [];
  const removed = removedSkillIncreasePlaces(b);
  if (!removed.size) return [];
  return list.filter((e): e is KeptSkillIncrease => {
    if (!e || typeof e !== 'object') return false;
    const { level, lane, skill } = e as Partial<KeptSkillIncrease>;
    return typeof level === 'number' && isSkillLane(lane) && typeof skill === 'string' && !!skill && removed.has(skillPlaceId(lane, level));
  });
}

/** WP14: …and the kept boosts, each naming a boost place a live removal on `b` names, with an attribute. The
 *  reverse build's attribute solver puts each back into its removed place only (build.ts). */
export function readKeptBoosts(b: BuildState, kept: unknown): KeptBoost[] {
  const list = kept && typeof kept === 'object' ? (kept as { boosts?: unknown }).boosts : undefined;
  if (!Array.isArray(list) || !list.length) return [];
  const removed = removedBoostPlaces(b);
  if (!removed.size) return [];
  return list.filter((e): e is KeptBoost => {
    if (!e || typeof e !== 'object') return false;
    const { set, level, index, attribute } = e as Partial<KeptBoost>;
    return typeof set === 'string' && typeof index === 'number' && typeof attribute === 'string' && !!attribute && removed.has(boostPlaceId(set, level, index));
  });
}

/** WP14: put kept skill increases back into the reverse build `b`'s lane stores — never over a level a store
 *  already holds (a Character row routed there wins). */
export function restoreKeptSkillIncreases(b: BuildState, list: readonly KeptSkillIncrease[]): void {
  const stores = b as unknown as Record<string, Record<number, string> | undefined>;
  for (const k of list) {
    if (!isSkillLane(k.lane)) continue;
    const store = (stores[SKILL_LANE_STORE[k.lane]] ??= {});
    if (store[k.level] == null) store[k.level] = k.skill;
  }
}

/**
 * The kept book-slot copies a reverse build may put back (WP8, fixes round 1), read defensively from a published
 * Character (any shape): each entry naming a whole book slot key and a feat the reverse build `b` (carrying the
 * character's own `overrides`) still stores a readable `choice.moreTakes` block for, any state. A copy whose block is
 * gone, unreadable or newer is never filled from here. `restoreKeptFeatPlaces` fills only an empty key.
 */
export function readKeptFeatCopies(b: BuildState, kept: unknown): KeptFeatPlace[] {
  const list = kept && typeof kept === 'object' ? (kept as { featCopies?: unknown }).featCopies : undefined;
  if (!Array.isArray(list) || !list.length) return [];
  const records = moreTakesRecords(b);
  if (!records.size) return [];
  return list.filter((e): e is KeptFeatPlace => {
    if (!e || typeof e !== 'object') return false;
    const { slotKey, featId } = e as Partial<KeptFeatPlace>;
    return typeof slotKey === 'string' && isBookSlot(slotKey) && typeof featId === 'string' && !!featId && records.has(featId);
  });
}

/**
 * The kept places a reverse build may put back, read defensively from a published Character (any shape): each
 * entry naming an extra feat place key that `b` — the reverse build, carrying the character's own `overrides` and
 * `options` — holds back now too, or reads as live now (a readable live `choice.addPlace` feat block, any level),
 * and a feat id. A place whose block is gone, unreadable or newer is never filled from here (it is neither).
 * `restoreKeptFeatPlaces` fills only an empty key, so a live place whose own row came back keeps that row's feat
 * and answers.
 */
export function readKeptFeatPlaces(b: BuildState, kept: unknown): KeptFeatPlace[] {
  const list = kept && typeof kept === 'object' ? (kept as { featPlaces?: unknown }).featPlaces : undefined;
  if (!Array.isArray(list) || !list.length) return [];
  const usable = new Set<string>(heldBackPlaceKeys(b));
  for (const p of livePlaces(b)) if (p.place === 'feat' && p.slotKey) usable.add(p.slotKey);
  if (!usable.size) return [];
  return list.filter((e): e is KeptFeatPlace => {
    if (!e || typeof e !== 'object') return false;
    const { slotKey, featId } = e as Partial<KeptFeatPlace>;
    return typeof slotKey === 'string' && featPlaceKeyOf(slotKey) === slotKey && usable.has(slotKey) && typeof featId === 'string' && !!featId;
  });
}

/**
 * Put kept places back into the reverse build `b` (its own fresh stores): the pick under its key, and each kept
 * answer into its map — never over an entry the store already holds. A key some other feat already holds keeps
 * that feat, and the kept answers (made for another feat) stay out. Only the build's answer maps are written.
 */
export function restoreKeptFeatPlaces(b: BuildState, places: readonly KeptFeatPlace[]): void {
  const stores = b as unknown as Stores;
  for (const p of places) {
    const at = featIdAtSlot(b, p.slotKey);
    if (at && at !== p.featId) continue;
    if (!at) b.featPicks[p.slotKey] = p.featId;
    const answers = p.answers && typeof p.answers === 'object' ? p.answers : {};
    for (const [map, entries] of Object.entries(answers)) {
      if (!KEPT_ANSWER_MAPS.has(map) || !entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
      for (const [k, v] of Object.entries(entries)) {
        if (typeof v !== 'string' || stores[map]?.[k] !== undefined) continue;
        (stores[map] ??= {})[k] = v;
      }
    }
  }
}
