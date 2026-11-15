/*
 * THE ONE READER of every tweak a character carries (docs/overrides-redesign.md spec item 4: "every read of
 * tweaks goes through one accessor that applies on/off, the start level and the master switch"; plan B,
 * WP2). It serves:
 *   - the NUMBER blocks (`overrides.blocks`), for the term lists in derive.ts and the attribute seam in
 *     build.ts;
 *   - the RANK blocks (`overrides.proficiencies` entries whose meta says "at least" / "exactly"), for the
 *     rank seams in build.ts (Building blocks item 8), and the unsorted old entries the old `=` loop still
 *     applies (`liveLegacyRanks`);
 *   - every other old Overrides key, through one accessor each (`liveAttributeSets`, `liveRemovedFeatIds`,
 *     `isAllowedAnyway`, `liveGivenFeatures`, `liveGivenSpells`, `liveGivenLanguages`, `liveMaxHpSet`,
 *     `liveContentEdits`); the given feats through `activeGivenFeats` (stored.ts) and src/rules/heldFeats.ts;
 *     the old max-HP set as a 'set' term of the max-HP list (`activeNumberBlocks`, `maxHpTweakTerms` —
 *     plan B case C);
 *   - plan B, B3: the read-time sort of the old rank entries (`tweakRankSort` on the host, laid over the
 *     meta by blocks/migrate.ts `withRankSort`) for `rankTweaks` and `liveLegacyRanks`;
 *   - plan B, WP5: the rank tweaks of one track for the timelines (`tweakRankLines`), the "exactly" hold
 *     the derive-time caps read (`heldExactly`), and the 0-lines of the tweaks a number ignores right now
 *     (`ignoredTweakTerms`).
 *
 * TWO predicates decide it, one definition each (the pause table: work/tweaks-part-b-notes/plan.md section 2):
 *   - `entryOn(inst, switchOn)` (stored.ts, re-exported here): on, not broken, and the master switch on —
 *     or stamped by an import (spec 2: it ignores the master switch; its own on/off still counts);
 *   - `entryLive(inst, host)`: `entryOn` with the host's switch, AND its start level at or below the
 *     host's level (spec item 9). The start level is the meta / block `from`, for a given feat or class
 *     feature the larger of that and its stored level (D6). Three kinds have no start level in phase 1
 *     (B25: remove.feat, choice.allowAnyway, text.edit — their editors have no `level` part), so a stored
 *     `from` on them is never read.
 *
 * The master switch, "ON by read" (spec item 2): a character whose `overrides.v` is absent has never been
 * saved by a Tweaks-aware app, so its changes were always live — it reads as ON. From `overrides.v >= 2`
 * the stored `options.overridesEnabled` is obeyed. The switch itself is `tweaksSwitchOn` in stored.ts — one
 * copy, re-exported here.
 *
 * A block (number or rank) also needs its kind registered with `applies: 'blocks'` on an aspect, and a
 * target this phase builds (`blockLive`).
 *
 * Paused data stays stored untouched: nothing here writes. The guard `checkOverridesReaders`
 * (src/rules/blocks/check.ts, scripts/blocks-check.mjs in `npm run verify`) fails on a read of
 * `.overrides` anywhere but this file, the other home files and the places
 * src/rules/blocks/overrides-readers.json gives a reason for.
 *
 * Tweak terms are never Modes and never light the "a mode moved this number" highlight (decision 4): they
 * enter the term lists as layer 'tweak', and the highlight reads `activeModes` only.
 */
import { loreKey } from '../loreKey';
import type { AbilityId, BuildOverrides, CharacterOptions, ProficiencyRank, TweakRankSort } from '../types';
import { withRankSort } from './migrate';
import { BLOCK_KINDS, blockKind, isChoiceKind, type BlockInstance } from './registry';
import { entryOn, legacyStartLevel, overridesAsOf, parseStoredBlocks, readLegacyBlocks, tweaksSwitchOn, type LegacyList } from './stored';
import { targetBuilt } from './targets';
import type { Term } from './terms';

export { entryOn, tweaksSwitchOn };

/** What the switch-only accessors need from a Character or a BuildState (no start level is read). */
export interface SwitchHost {
  overrides?: BuildOverrides;
  options?: CharacterOptions;
}

/** What the reader needs from a Character (or a BuildState, at the build seam). */
export interface TweakHost extends SwitchHost {
  level: number;
  /** Plan B, B3: the read-time sort of the old rank entries — a Character's derived field, or the one
   *  `buildCharacter` hands its own rank seams (build.ts `legacyRankSort`). Laid over the stored meta by
   *  `rankTweaks` and `liveLegacyRanks` (blocks/migrate.ts `withRankSort`), never stored. */
  tweakRankSort?: TweakRankSort;
}

/** The host's overrides with its read-time rank sort laid over the meta (the stored object itself when
 *  there is no sort). The rank readers below read this, nothing else. */
function rankOverrides(h: TweakHost): BuildOverrides | undefined {
  return h.tweakRankSort ? withRankSort(h.overrides, h.tweakRankSort) : h.overrides;
}

/** B25: the kinds with no start level in phase 1 — their registry editor has no `level` part. */
const NO_START_LEVEL = new Set(BLOCK_KINDS.filter((k) => k.editor && !k.editor.parts.includes('level')).map((k) => k.id));

/** The level a tweak starts at (1 = from the start); 1 for a kind with no start level (B25). */
export function startLevelOf(inst: BlockInstance): number {
  return NO_START_LEVEL.has(inst.kind) ? 1 : legacyStartLevel(inst);
}

/** One tweak, live on this host: `entryOn` with the host's switch, at or past its start level. THE one
 *  definition — every accessor below and `blockLive` read it. */
export function entryLive(inst: BlockInstance, host: TweakHost): boolean {
  return entryOn(inst, tweaksSwitchOn(host)) && startLevelOf(inst) <= (host.level ?? 1);
}

/** Parsed once per stored list. Keyed by the `overrides.blocks` value itself (every edit writes a new
 *  list), so an edit can never be served a stale parse. */
const PARSED = new WeakMap<object, BlockInstance[]>();
function parsedBlocks(list: unknown): BlockInstance[] {
  if (!list || typeof list !== 'object') return parseStoredBlocks(list).known;
  let got = PARSED.get(list);
  if (!got) {
    got = parseStoredBlocks(list).known;
    PARSED.set(list, got);
  }
  return got;
}

/** One block: an applying kind on an aspect, live (`entryLive`), on a target this phase builds. The ONE
 *  copy of these rules — number and rank blocks both read it. */
function blockLive(b: BlockInstance, h: TweakHost): boolean {
  const def = blockKind(b.kind);
  if (!def || def.applies !== 'blocks' || !('aspect' in def.accepts)) return false;
  if (!b.target || !entryLive(b, h)) return false;
  return targetBuilt(b.target, def.accepts.aspect);
}

/** The old Overrides keys that hold a NUMBER-family kind (only `maxHp`: 'number.setMaxHp'), from the registry. */
const LEGACY_NUMBER_LISTS = [
  ...new Set(BLOCK_KINDS.flatMap((k) => (k.family === 'number' && k.storage.in === 'legacy' ? [k.storage.key as LegacyList] : []))),
];

/**
 * Every active number or score block the character carries (see the header for "active"): the live
 * number-family kinds of the old keys first (plan B, WP3 case C: `number.setMaxHp`, so a set max HP is a
 * 'set' term of the max-HP list and the modes and Drained apply on top), then `overrides.blocks`.
 */
export function activeNumberBlocks(h: TweakHost): BlockInstance[] {
  const ov = h.overrides;
  if (!ov) return [];
  const legacy: BlockInstance[] = [];
  for (const list of LEGACY_NUMBER_LISTS) {
    for (const b of legacyOf(h, list)) if (blockKind(b.kind)?.family === 'number' && typeof b.value === 'number' && blockLive(b, h)) legacy.push(b);
  }
  if (ov.blocks === undefined) return legacy;
  const blocks = parsedBlocks(ov.blocks).filter((b) => typeof b.value === 'number' && blockLive(b, h));
  return legacy.length ? [...legacy, ...blocks] : blocks;
}

/**
 * The rank tweaks of `overrides.proficiencies`, sorted by the stored reader (stored.ts
 * `readLegacyBlocks`: meta `mode` with a matching `of`) — with the host's read-time sort of the old
 * entries laid over the meta first (plan B, B3: `tweakRankSort`, blocks/migrate.ts).
 *   - `sorted`: the `overrides.proficiencies` KEYS that are 'rank.atLeast' or 'rank.exactly' — live or
 *     not. build.ts's old `=` loop never applies these; every other entry is 'rank.legacySet' (an entry the
 *     sort cannot take, B2) and keeps today's `=` (checker C2) through `liveLegacyRanks`.
 *   - `atLeast` / `exactly`: of those, the live ones (`blockLive`: on, not broken, at or past the start
 *     level, target built, master switch on), each with its `rank` and its target (`skill:<key>` with a
 *     Lore keyed by `loreKey`, `save:<save>`, `perception`, `class-dc`, `weapon:<category>`,
 *     `armor:<category>`). Each block carries `moved` (B11 / B26) when it was sorted on this read or
 *     stamped "moved from Overrides" and not edited since: build.ts keeps such a floor out of the `asOf`
 *     replay and writes such a hold at the old `=` slot too, and (WP5) it caps neither `firearmProf` nor
 *     `dailySkillRank`.
 */
export interface RankTweaks {
  sorted: ReadonlySet<string>;
  atLeast: BlockInstance[];
  exactly: BlockInstance[];
}
const NO_RANK_TWEAKS: RankTweaks = { sorted: new Set(), atLeast: [], exactly: [] };
const PROFICIENCIES_KEY = 'proficiencies:';

export function rankTweaks(h: TweakHost): RankTweaks {
  const ov = rankOverrides(h);
  // No meta, no mode: every entry is 'rank.legacySet' (an old character, today's `=`).
  if (!ov?.meta || !ov.proficiencies || typeof ov.proficiencies !== 'object') return NO_RANK_TWEAKS;
  const sorted = new Set<string>();
  const atLeast: BlockInstance[] = [];
  const exactly: BlockInstance[] = [];
  for (const b of readLegacyBlocks(ov)) {
    if ((b.kind !== 'rank.atLeast' && b.kind !== 'rank.exactly') || !b.key.startsWith(PROFICIENCIES_KEY)) continue;
    sorted.add(b.key.slice(PROFICIENCIES_KEY.length));
    if (!b.rank || !blockLive(b, h)) continue;
    (b.kind === 'rank.atLeast' ? atLeast : exactly).push(b);
  }
  return sorted.size ? { sorted, atLeast, exactly } : NO_RANK_TWEAKS;
}

/** One block as a term of its number's list (layer 'tweak', slot from the registry). */
export function blockTerm(b: BlockInstance): Term {
  const def = blockKind(b.kind)!;
  const slot = def.slot === 'set' ? 'set' : def.slot === 'atLeast' ? 'atLeast' : 'add';
  return {
    // A set or "at least" names a number, not a bonus: its type plays no part.
    type: slot === 'add' ? (b.bonusType ?? 'untyped') : 'untyped',
    value: b.value as number,
    label: def.line(b),
    layer: 'tweak',
    key: b.key,
    source: b.source,
    slot,
  };
}

/** The tweak terms aimed at one number target (a TargetRef key: `save:fortitude`, `skill:lore:sailing`,
 *  `spell-dc@casting-entry:<id>`, `speed:land`, …), in stored order. */
export function numberTweakTerms(h: TweakHost, target: string): Term[] {
  const out: Term[] = [];
  for (const b of activeNumberBlocks(h)) {
    if (b.target !== target || blockKind(b.kind)?.family !== 'number') continue;
    out.push(blockTerm(b));
  }
  return out;
}

/**
 * The tweak terms of one target that the number IGNORES right now, as breakdown lines of 0 (plan B WP5;
 * spec item 8: a battle form's AC and Speeds, a DC its source prints). Each keeps its registry line
 * ("Tweak: +1 (reason)") and says why in its note; it is an untyped ADD of 0 — never a set or an
 * "at least" — so `resolveTerms` pools it as +0 with no branch of its own, and the parts still sum to
 * the number.
 */
export function ignoredTweakTerms(h: TweakHost, target: string, why: string): Term[] {
  return numberTweakTerms(h, target).map((t) => ({ ...t, type: 'untyped', value: 0, slot: 'add', note: why }));
}

/* ─────────────── the rank tweaks of one track, for the breakdowns and the derive-time caps (WP5) ─────────────── */

/** One rank tweak as a breakdown timeline reads it. */
export interface TweakRankLine {
  /** The level it counts from (1 = from the start). */
  level: number;
  rank: ProficiencyRank;
  /** The registry line ("Tweak: at least expert (reason)", "Tweak: exactly trained"). */
  line: string;
  reason?: string;
  /** An old entry moved from Overrides and not edited since (B26). */
  moved: boolean;
}
export interface TweakRankLines {
  /** The live "at least" floors, by start level (stored order within a level). */
  floors: TweakRankLine[];
  /** The live "exactly" hold, if any — the last one when two stored keys aim at one track (the clamp
   *  applies them in stored order, so the last one wins). */
  hold?: TweakRankLine;
}

/** A rank target as `rankTweaks` keys it: a Lore through `loreKey` (`skill:lore:Sailing Lore` →
 *  `skill:lore:sailing`); every other target as it is. */
function rankTargetOf(target: string): string {
  if (!target.startsWith('skill:lore:')) return target;
  const k = loreKey(target.slice('skill:'.length));
  return k ? `skill:${k}` : target;
}

/**
 * The live rank tweaks aimed at one track (`skill:<key>`, `save:<save>`, `perception`, `class-dc`,
 * `armor:<category>`, `weapon:<category>`), read through `rankTweaks` (the host's read-time sort
 * included) — for the skill and proficiency timelines (explain.ts), so they name the floor and the hold
 * the build applied.
 */
export function tweakRankLines(h: TweakHost, target: string): TweakRankLines {
  const want = rankTargetOf(target);
  const tw = rankTweaks(h);
  const toLine = (b: BlockInstance): TweakRankLine => ({
    level: Math.max(1, startLevelOf(b)),
    rank: b.rank!,
    line: blockKind(b.kind)!.line(b),
    ...(b.reason ? { reason: b.reason } : {}),
    moved: b.moved === true,
  });
  const floors = tw.atLeast.filter((b) => b.target === want && b.rank).map(toLine);
  floors.sort((a, b) => a.level - b.level);
  const holds = tw.exactly.filter((b) => b.target === want && b.rank);
  return holds.length ? { floors, hold: toLine(holds[holds.length - 1]) } : { floors };
}

/** The skill keys (`rankTweaks` targets without `skill:`) held "exactly": every live hold, and only the
 *  holds the player made (not moved, B26 c). */
interface HeldSkills {
  all: ReadonlySet<string>;
  forCap: ReadonlySet<string>;
}
const NO_HELD: HeldSkills = { all: new Set(), forCap: new Set() };
/** Cached per overrides object × read-time sort × (level, switch): `dailySkillRank` asks once per skill
 *  per render. The overrides object holds its meta (every edit writes a new object); the sort is a
 *  derived object of one build; the level and the switch are part of the key. */
const HELD = new WeakMap<object, WeakMap<object, Map<string, HeldSkills>>>();
const NO_SORT = {};

function heldSkills(h: TweakHost): HeldSkills {
  const ov = h.overrides;
  if (!ov || !ov.proficiencies) return NO_HELD;
  let bySort = HELD.get(ov);
  if (!bySort) HELD.set(ov, (bySort = new WeakMap()));
  const sortKey = h.tweakRankSort ?? NO_SORT;
  let byState = bySort.get(sortKey);
  if (!byState) bySort.set(sortKey, (byState = new Map()));
  const state = `${h.level ?? 1}|${tweaksSwitchOn(h) ? 1 : 0}`;
  let got = byState.get(state);
  if (!got) {
    const all = new Set<string>();
    const forCap = new Set<string>();
    for (const b of rankTweaks(h).exactly) {
      if (!b.target?.startsWith('skill:')) continue;
      const k = b.target.slice('skill:'.length);
      all.add(k);
      if (!b.moved) forCap.add(k);
    }
    got = all.size ? { all, forCap } : NO_HELD;
    byState.set(state, got);
  }
  return got;
}

/**
 * Is this skill or Lore held "exactly" by a live tweak? `key` as the sheet stores it (a Lore keyed
 * through `loreKey`). With `forCap` it answers only for a hold the PLAYER made (B6): derive.ts
 * `dailySkillRank` asks that way, because a MOVED old entry never capped the daily pick (B26 c). The
 * Builder's skill-increase picker asks without it: the final clamp wastes an increase on any hold.
 */
export function heldExactly(h: TweakHost, key: string, opts: { forCap?: boolean } = {}): boolean {
  const held = heldSkills(h);
  if (held === NO_HELD) return false;
  const k = key.startsWith('lore:') ? (loreKey(key) ?? key) : key;
  return (opts.forCap ? held.forCap : held.all).has(k);
}

/**
 * The skill and Lore ranks held "exactly" by a live tweak AT `level` (skill-order plan section 2, WP7): the holds
 * whose start level is at or below it, read through `rankTweaks` with the overrides as they stand at that level
 * (stored.ts `overridesAsOf`, which pauses what starts later). Keyed as the sheet keys them (`skill:` dropped; a
 * Lore through `loreKey`); the last stored hold on a key wins, as the clamp applies them. A Builder reader that
 * reads the per-level skill history lays these over it, so a held skill reads at a level as the sheet reads it
 * (the history is worked out before the final clamp, D8). Before WP7 the increase picker got the same answer by
 * building the whole character with `overridesAsOf` (Builder `baseSkills`).
 */
export function skillHoldsAt(h: TweakHost, level: number): ReadonlyMap<string, ProficiencyRank> {
  const out = new Map<string, ProficiencyRank>();
  if (!h.overrides) return out;
  for (const b of rankTweaks({ ...h, overrides: overridesAsOf(h.overrides, level) }).exactly) {
    if (!b.target?.startsWith('skill:') || !b.rank) continue;
    out.set(b.target.slice('skill:'.length), b.rank);
  }
  return out;
}

/** The active `attribute.add` blocks on one attribute score, in stored order. */
export function scoreAddBlocks(h: TweakHost, ability: AbilityId): BlockInstance[] {
  return activeNumberBlocks(h).filter((b) => b.kind === 'attribute.add' && b.target === `score:${ability}`);
}

/* ─────────────────────────────── the old Overrides keys, one accessor each ─────────────────────────────── */

/** One old key's entries as instances — the one stored reader (`readLegacyBlocks`), fed only that key and
 *  the meta (the keys it builds name the key, so they are the same as a full read's). */
function legacyOf(h: SwitchHost, list: LegacyList): BlockInstance[] {
  const ov = h.overrides;
  const value: unknown = ov ? (ov as Record<string, unknown>)[list] : undefined;
  if (!ov || value == null) return [];
  return readLegacyBlocks({ [list]: value, meta: ov.meta } as BuildOverrides);
}

/** The live attribute SETS (`attribute.set`, `overrides.attributes`), in stored order: the ability key as
 *  stored and its score. A paused, switched-off, not-yet-started or unreadable set is left out: the score
 *  is computed (and keeps its partial-boost flag), and the Builder shows no lock. */
export function liveAttributeSets(h: TweakHost): { ability: AbilityId; value: number }[] {
  const out: { ability: AbilityId; value: number }[] = [];
  for (const b of legacyOf(h, 'attributes')) {
    if (b.kind !== 'attribute.set' || typeof b.value !== 'number' || !b.target || !entryLive(b, h)) continue;
    out.push({ ability: b.target.slice('score:'.length) as AbilityId, value: b.value });
  }
  return out;
}

/** The feats the player took away (`remove.feat`) that are ON: a paused or switched-off removal gives the
 *  feat back. No start level (B25). */
export function liveRemovedFeatIds(h: SwitchHost): ReadonlySet<string> {
  const on = tweaksSwitchOn(h);
  const out = new Set<string>();
  for (const b of legacyOf(h, 'removedFeatIds')) if (entryOn(b, on)) out.add(b.record as string);
  return out;
}

/** The "Take anyway" feats (`choice.allowAnyway`) that are ON. A paused one keeps its pick (the build never
 *  checks legality); only its prerequisite warning returns. No start level (B25). */
export function liveAllowedFeats(h: SwitchHost): string[] {
  const on = tweaksSwitchOn(h);
  return legacyOf(h, 'allowedFeats')
    .filter((b) => entryOn(b, on))
    .map((b) => b.record as string);
}

/** Is `featId` taken anyway (a live `choice.allowAnyway`)? */
export function isAllowedAnyway(h: SwitchHost, featId: string): boolean {
  return liveAllowedFeats(h).includes(featId);
}

/** The live given class features (`grant.classFeature`), in stored order, each listed from
 *  max(stored level, start level) (D6) and only once the host reaches it. */
export function liveGivenFeatures(h: TweakHost): { featureId: string; level: number }[] {
  const out: { featureId: string; level: number }[] = [];
  for (const b of legacyOf(h, 'addedFeatures')) {
    if (b.kind !== 'grant.classFeature' || !entryLive(b, h)) continue;
    const stored = b.params?.level;
    // The stored level as it is unless a later start level raises it (an old entry shows what it showed).
    const level = typeof stored === 'number' && (b.gate?.startLevel ?? 1) <= stored ? stored : startLevelOf(b);
    out.push({ featureId: b.record as string, level });
  }
  return out;
}

/** The live given spells (`grant.spell`, `overrides.addedSpells`), rituals and non-rituals, in stored order;
 *  `rank` as stored (absent = the spell's own rank). The caller splits rituals from the rest. */
export function liveGivenSpells(h: TweakHost): { spellId: string; rank?: number }[] {
  const out: { spellId: string; rank?: number }[] = [];
  for (const b of legacyOf(h, 'addedSpells')) {
    if (b.kind !== 'grant.spell' || !entryLive(b, h)) continue;
    const rank = b.params?.rank;
    out.push({ spellId: b.record as string, ...(rank != null ? { rank: rank as number } : {}) });
  }
  return out;
}

/** The live given languages (`grant.language`), in stored order. */
export function liveGivenLanguages(h: TweakHost): string[] {
  return legacyOf(h, 'addedLanguages')
    .filter((b) => b.kind === 'grant.language' && entryLive(b, h))
    .map((b) => b.record as string);
}

/**
 * The UNSORTED old `overrides.proficiencies` entries ('rank.legacySet': no matching meta mode) that the old
 * `=` loop in `buildCharacter` still applies, in stored order: on, the master switch on (or import-stamped),
 * at or past a start level. An unreadable rank stays the old `=` as it is today (plan B, B2: an unsortable
 * entry keeps today's number) — its raw stored value is handed back. The sorted entries ('rank.atLeast' /
 * 'rank.exactly', the host's read-time sort included — plan B, B3) are never here: they are rank blocks
 * (`rankTweaks`).
 */
export function liveLegacyRanks(h: TweakHost): { key: string; rank: ProficiencyRank }[] {
  const ov = rankOverrides(h);
  const profs = ov?.proficiencies;
  if (!profs || typeof profs !== 'object') return [];
  const out: { key: string; rank: ProficiencyRank }[] = [];
  for (const b of legacyOf({ overrides: ov }, 'proficiencies')) {
    if (b.kind !== 'rank.legacySet') continue;
    // `entryLive`, with "broken" (an unreadable rank) NOT a reason to skip: B2 keeps today's `=` for it.
    if (!entryLive(b.broken ? { ...b, broken: undefined } : b, h)) continue;
    const key = b.key.slice(PROFICIENCIES_KEY.length);
    out.push({ key, rank: (profs as Record<string, ProficiencyRank>)[key] });
  }
  return out;
}

/** The live max-HP set (`number.setMaxHp`, `overrides.maxHp`), or undefined. */
export function liveMaxHpSet(h: TweakHost): number | undefined {
  for (const b of legacyOf(h, 'maxHp')) if (b.kind === 'number.setMaxHp' && typeof b.value === 'number' && entryLive(b, h)) return b.value;
  return undefined;
}

/**
 * The tweak terms of maximum HP (plan B, WP3, spec 2 case C; plan section 3.5): the live `number.setMaxHp`
 * set — a 'set' term, so `resolveTerms` replaces the permanent pool (ancestry, class + Con × levels, the
 * records' HP bonuses) and keeps a max-HP mode, a Con mode and Drained on top — and every other max-HP
 * tweak block, through `numberTweakTerms`.
 * A Character that carries `hitPoints.maxOverride` but stores NO max-HP set in `overrides` (a hand-made
 * seed, a file from before Tweaks) gets the same set term from that field. Never both: once `overrides`
 * holds a max-HP set — live, paused or broken — the tweak reader alone decides, so a stale cache field can
 * never bring a paused set back.
 */
export function maxHpTweakTerms(c: TweakHost & { hitPoints?: { maxOverride?: number } }): Term[] {
  const terms = numberTweakTerms(c, 'max-hp');
  const manual = c.hitPoints?.maxOverride;
  if (typeof manual !== 'number' || !Number.isFinite(manual) || legacyOf(c, 'maxHp').length) return terms;
  const key = 'hitPoints:maxOverride';
  return [blockTerm({ kind: 'number.setMaxHp', version: 1, key, source: { kind: 'tweak', id: key }, target: 'max-hp', value: manual, on: true }), ...terms];
}

/* ─────────────────────────────── text edits (the one content path's input) ─────────────────────────────── */

type ContentEdits = NonNullable<BuildOverrides['contentEdits']>;
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
/** The two buckets a text edit patches (`readLegacyBlocks` keys them `contentEdits:<bucket>/<id>`). */
const EDIT_BUCKETS = ['feats', 'classFeatures'] as const;

interface LiveEdits {
  /** Every edit on (the switch on): the stored object itself when nothing is paused. */
  all: ContentEdits | null;
  /** The import-stamped ones alone (the switch off). */
  imported: ContentEdits | null;
}

/** `contentEdits` → its meta (an object, or NO_META) → both answers. Weak on both, so an edit (a new
 *  `contentEdits` or `meta` object) gets a new entry and the old one can go. */
const LIVE_EDITS = new WeakMap<object, WeakMap<object, LiveEdits>>();
const NO_META = {};

/** `edits` holding only the entries `keep` lets through: the very object when all of them are kept,
 *  null when none is; a bucket this version does not know is carried over as it is. */
function subsetOf(edits: ContentEdits, keep: ReadonlySet<string>, total: number): ContentEdits | null {
  if (keep.size === total) return edits;
  if (!keep.size) return null;
  const out: Rec = { ...edits };
  for (const bucket of EDIT_BUCKETS) {
    const patches = (edits as Rec)[bucket];
    if (!isRec(patches)) continue;
    out[bucket] = Object.fromEntries(Object.entries(patches).filter(([id]) => keep.has(`${bucket}/${id}`)));
  }
  return out as ContentEdits;
}

/**
 * The text edits (`text.edit`, `overrides.contentEdits`) that are ON for this host: the master switch on
 * (or import-stamped) and not paused. No start level (B25: one content database per character, not per
 * level). Memoised per `contentEdits` × `meta`, with the switch read after the lookup, so the same host
 * state gets the SAME object every time — `contentFor`'s identity cache (base db → edits → db) stays warm.
 * The stored `contentEdits` itself when every edit is on; null when none is.
 */
export function liveContentEdits(h: SwitchHost | null | undefined): ContentEdits | null {
  const ov = h?.overrides;
  const edits = ov?.contentEdits;
  if (!isRec(edits)) return null;
  let byMeta = LIVE_EDITS.get(edits);
  if (!byMeta) LIVE_EDITS.set(edits, (byMeta = new WeakMap()));
  const metaKey = isRec(ov!.meta) ? ov!.meta : NO_META;
  let hit = byMeta.get(metaKey);
  if (!hit) {
    const all = new Set<string>();
    const imported = new Set<string>();
    let total = 0;
    for (const b of readLegacyBlocks({ contentEdits: edits as ContentEdits, meta: ov!.meta })) {
      if (b.kind !== 'text.edit' || typeof b.record !== 'string') continue;
      total++;
      if (entryOn(b, true)) all.add(b.record);
      if (entryOn(b, false)) imported.add(b.record);
    }
    hit = { all: subsetOf(edits, all, total), imported: subsetOf(edits, imported, total) };
    byMeta.set(metaKey, hit);
  }
  return tweaksSwitchOn(h!) ? hit.all : hit.imported;
}

/* ─────────────── Tweaks phase 2: the choice tweaks (work/tweaks-phase2-notes/plan.md WP1; C6, C9) ───────────────
 *
 * Every engine seam and picker of phase 2 asks ONE accessor here (C6), so with no live choice tweak every
 * touched function returns what it returns today. Each accessor reads `liveChoiceBlocks`: on, not broken, and
 * the Tweaks switch on (`entryOn`; a choice kind has no start level, C31, and none is import-stamped). Nothing
 * here writes; nothing calls these yet in WP1 — each later work package wires its seam to one of them.
 */

/** What the choice accessors need from a build (or a Character): the stored overrides and the switch; the
 *  level for a place's "not reached yet". */
export interface ChoiceHost extends SwitchHost {
  level?: number;
}

/** The READABLE choice blocks of one stored list, every state, in stored order — parsed once per list
 *  (every edit writes a new list, so an edit is never served a stale read). */
const STORED_CHOICES = new WeakMap<object, BlockInstance[]>();
/** Exported for the Tweak mark (WP4): a paused allow still marks its pick ("Tweak paused"), so the mark lists every
 *  state; whether one counts is `entryOn` / `tweakMarkState`, never this list. */
export function storedChoiceBlocks(h: SwitchHost): BlockInstance[] {
  const list: unknown = h.overrides?.blocks;
  if (!list || typeof list !== 'object') return [];
  let got = STORED_CHOICES.get(list);
  if (!got) {
    got = parsedBlocks(list).filter((b) => isChoiceKind(blockKind(b.kind)));
    STORED_CHOICES.set(list, got);
  }
  return got;
}

/** The stored phase-1 "Take anyway" (`allowedFeats`) for `featId`, any state, or undefined — the feat slot's Tweak
 *  mark (WP4: "Tweak" live, "Tweak paused" paused). Whether it counts is `isAllowedAnyway`, never this. */
export function storedAllowAnyway(h: SwitchHost, featId: string): BlockInstance | undefined {
  return readLegacyBlocks(h.overrides).find((b) => b.kind === 'choice.allowAnyway' && b.record === featId && !b.broken);
}

/** The LIVE choice tweaks, in stored order: on, not broken, Tweaks switched on (the switch read on every
 *  call, after the cache). */
export function liveChoiceBlocks(h: SwitchHost): BlockInstance[] {
  const all = storedChoiceBlocks(h);
  if (!all.length) return all;
  const on = tweaksSwitchOn(h);
  return all.filter((b) => entryOn(b, on));
}

const paramsOf = (b: BlockInstance): Record<string, unknown> => b.params ?? {};
/** A skill key as a tweak stores it: a Lore through `loreKey` (C27). */
const skillKeyOf = (skill: string): string => (skill.startsWith('lore:') ? (loreKey(skill) ?? skill) : skill);

/**
 * Is `record` taken anyway in `picker` (a live `choice.allowAnywayAnyPicker`, C19: per record, every picker
 * that offers it)? A subclass allow names its class (`classId`); a sanctification allow its refused answer
 * (`value`, matched when asked). WP13: a skill increase taken anyway (per place and per rule, WP12) comes after
 * the record rebuild; ANY_PICKERS holds no such picker, so no live block names one.
 */
export function allowedInPicker(h: SwitchHost, picker: string, record: string, opts: { classId?: string; value?: string } = {}): boolean {
  return liveChoiceBlocks(h).some((b) => {
    if (b.kind !== 'choice.allowAnywayAnyPicker') return false;
    const p = paramsOf(b);
    if (p.picker !== picker || p.record !== record) return false;
    if (picker === 'subclass' && p.classId !== opts.classId) return false;
    if (picker === 'sanctification' && opts.value !== undefined && p.value !== opts.value) return false;
    return true;
  });
}


/** The rules a live `choice.anyList` lifts for `featId` (list / level / onlyAtLevel; one block per rule, C22). */
export function anyListRules(h: SwitchHost, featId: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const b of liveChoiceBlocks(h)) if (b.kind === 'choice.anyList' && b.record === featId && typeof b.params?.rule === 'string') out.add(b.params.rule);
  return out;
}

const NO_LIFTS: ReadonlyMap<string, ReadonlySet<string>> = new Map();
/** Every live `choice.anyList`, by feat: the rules it lifts (`anyListRules` for all feats at once — the slot and
 *  pick-a-feat tests read it once per list, not once per feat). Empty when there is none. */
export function anyListLifts(h: SwitchHost): ReadonlyMap<string, ReadonlySet<string>> {
  const live = liveChoiceBlocks(h);
  if (!live.length) return NO_LIFTS;
  const out = new Map<string, Set<string>>();
  for (const b of live) {
    if (b.kind !== 'choice.anyList' || typeof b.record !== 'string' || typeof b.params?.rule !== 'string') continue;
    let s = out.get(b.record);
    if (!s) out.set(b.record, (s = new Set()));
    s.add(b.params.rule);
  }
  return out;
}

/** How many more times `featId` may be taken (every live `choice.moreTakes` for it, summed; 0 = the book's cap). */
export function extraTakes(h: SwitchHost, featId: string): number {
  let n = 0;
  for (const b of liveChoiceBlocks(h)) if (b.kind === 'choice.moreTakes' && b.record === featId && typeof b.params?.times === 'number') n += b.params.times;
  return n;
}

/**
 * Does a GIVEN copy of `featId` (a Tweaks `addedFeats` feat) still count when the build already holds that feat (WP8
 * round 4, F1)? Today's dedupe drops it. A LIVE "Take a feat more times" for it lets it count while the copies held so
 * far (`held()`) stay below the raised cap (`bookCap()` + every live block's times, `extraTakes`). No live block:
 * false, which is today's dedupe exactly (`held` and `bookCap` are never called then). The ONE rule behind
 * `buildCharacter`'s given-feat loop and `heldFeatSlots`' given-feat dedupe (heldFeats.ts, C9), so the Builder and
 * the sheet agree. Callers ask only when the feat is already held.
 */
export function givenCopyCounts(h: SwitchHost, featId: string, held: () => number, bookCap: () => number): boolean {
  const extra = extraTakes(h, featId);
  return extra > 0 && held() < bookCap() + extra;
}

/** A feat place's slot key (C8): `<level>:extra<category>:<n>` — derived, never stored. */
export const featPlaceKey = (level: unknown, category: unknown, n: unknown): string => `${String(level)}:extra${String(category)}:${String(n)}`;
const PLACE_KEY = /^(\d+):extra([a-z]+):(\d+)(?=$|[#:])/;
/** The extra feat place key (`<level>:extra<category>:<n>`, C8) a key starts with, or null: a book slot key, an
 *  `override:` key, anything else. Whether a block for it exists or is live is not asked here. */
export const featPlaceKeyOf = (key: string): string | null => PLACE_KEY.exec(key)?.[0] ?? null;

/** One extra place a live `choice.addPlace` adds. */
export interface LivePlace {
  /** The block's instance key (`blocks:<id>`). */
  key: string;
  place: string;
  level: number;
  /** A feat place: its category, `n` and the slot key its pick and answers live under (C8). */
  category?: string;
  n?: number;
  slotKey?: string;
  /** A skill-increase carrier's skill (absent = owed, C15). */
  skill?: string;
  /** A boost carrier's attribute (absent = owed, C16). */
  attribute?: string;
}

/** Every live extra place, in stored order (any level: a caller gates by its own level). */
export function livePlaces(h: SwitchHost): LivePlace[] {
  const out: LivePlace[] = [];
  for (const b of liveChoiceBlocks(h)) {
    if (b.kind !== 'choice.addPlace') continue;
    const p = paramsOf(b);
    const place: LivePlace = { key: b.key, place: String(p.place), level: p.level as number };
    if (p.place === 'feat') Object.assign(place, { category: p.category, n: p.n, slotKey: featPlaceKey(p.level, p.category, p.n) });
    if (typeof p.skill === 'string') place.skill = p.skill;
    if (typeof p.attribute === 'string') place.attribute = p.attribute;
    out.push(place);
  }
  return out;
}

/** One live extra skill-increase or boost place (a CARRIER, C15 / C16) with its answer: the block's own id (the
 *  history's `tweakIncrease:<id>`, the boost step's `id`), its level, and the skill or attribute it holds. */
export interface LiveCarrier {
  id: string;
  key: string;
  level: number;
  /** The skill key (`skill`) or the attribute (`boost`). */
  answer: string;
  reason?: string;
}

/**
 * Tweaks phase 2 WP11 (C15 / C16): every LIVE extra skill-increase place (`place: 'skillIncrease'`) or boost place
 * (`'boost'`) that holds its answer, in stored order — the ONE reader the engine's two seams (the skill increase
 * loop, `collectBoosts`) and the breakdown use. Read through `liveChoiceBlocks`: an unreadable block (an attribute
 * outside the six, C3) or a newer one is never here, nor a paused one, nor any while Tweaks are off. An empty place
 * (no answer) is owed (`levelChoices`), never applied.
 */
export function liveCarriers(h: SwitchHost, place: 'skillIncrease' | 'boost'): LiveCarrier[] {
  const field = place === 'skillIncrease' ? 'skill' : 'attribute';
  const out: LiveCarrier[] = [];
  for (const b of liveChoiceBlocks(h)) {
    if (b.kind !== 'choice.addPlace') continue;
    const p = paramsOf(b);
    const answer = p[field];
    if (p.place !== place || typeof p.level !== 'number' || typeof answer !== 'string') continue;
    out.push({ id: b.key.slice('blocks:'.length), key: b.key, level: p.level, answer: place === 'skillIncrease' ? skillKeyOf(answer) : answer, ...(b.reason ? { reason: b.reason } : {}) });
  }
  return out;
}

/**
 * C9, the feat-place live gate: false ONLY for a key under an extra feat place whose block is READABLE and not
 * live (paused, or Tweaks off). Every other key is true — a book slot's key, and a place key whose block is
 * missing, unreadable or newer (it counts as today's "feat with no slot"; UNKNOWN ≠ EMPTY: only a tweak this
 * app can read may stop a pick). `key` may carry a suffix (`#0`, `:granted-spell`).
 */
export function placeLiveForKey(h: SwitchHost, key: string): boolean {
  const m = PLACE_KEY.exec(key);
  return !m || !heldBackPlaceKeys(h).has(m[0]);
}

/** Per stored list: the readable extra feat places' slot keys, and the ones with at least one block on (its own
 *  on/off; the switch is read on every call). */
const FEAT_PLACE_KEYS = new WeakMap<object, { all: Set<string>; on: Set<string> }>();
const NO_KEYS: ReadonlySet<string> = new Set();
/**
 * WP7 (C9): the slot keys `placeLiveForKey` says false for — every extra feat place whose block is READABLE and
 * none of whose blocks is live (paused, or Tweaks off). Empty for a character with no such place (the common
 * case: one cached lookup). The keys are the bare `<level>:extra<category>:<n>`; a caller with a suffixed key asks
 * `placeLiveForKey`.
 */
export function heldBackPlaceKeys(h: SwitchHost): ReadonlySet<string> {
  const got = featPlaceKeySets(h);
  if (!got?.all.size) return NO_KEYS;
  const on = tweaksSwitchOn(h);
  const out = new Set<string>();
  for (const k of got.all) if (!on || !got.on.has(k)) out.add(k);
  return out;
}

/** The cached per-list sets behind `heldBackPlaceKeys` (undefined: no stored list). */
function featPlaceKeySets(h: SwitchHost): { all: Set<string>; on: Set<string> } | undefined {
  const list: unknown = h.overrides?.blocks;
  if (!list || typeof list !== 'object') return undefined;
  let got = FEAT_PLACE_KEYS.get(list);
  if (!got) {
    got = { all: new Set(), on: new Set() };
    for (const b of storedChoiceBlocks(h)) {
      if (b.kind !== 'choice.addPlace' || b.params?.place !== 'feat') continue;
      const k = featPlaceKey(b.params.level, b.params.category, b.params.n);
      got.all.add(k);
      if (entryOn(b, true)) got.on.add(k);
    }
    FEAT_PLACE_KEYS.set(list, got);
  }
  return got;
}

/**
 * The words a held-back copy of a feat puts on "Already taken" (WP7 step 6b, finding 18): the copy that makes the
 * cap sits in the extra place `slotKey` (a held-back key; a suffix is fine), which does not count now. The words
 * follow the place's OWN block: paused (no block of it on) says "paused" whether Tweaks are on or off — turning
 * Tweaks on alone would not bring that copy back; on, with every tweak off, says it counts only while Tweaks are on.
 */
export function heldBackPlaceWords(h: SwitchHost, slotKey: string): string {
  const m = PLACE_KEY.exec(slotKey);
  const level = m ? Number(m[1]) : Number.parseInt(slotKey, 10);
  const ownOn = !!m && !!featPlaceKeySets(h)?.on.has(m[0]);
  return tweaksSwitchOn(h) || !ownOn
    ? `Taken in a paused extra place (level ${level}) — turn it on or remove it`
    : `Taken in an extra place (level ${level}) that counts only while Tweaks are on`;
}

/** One printed place a live `remove.choicePlace` removes: its block key and stored fields. */
export interface RemovedPlace {
  key: string;
  place: string;
  level?: number;
  category?: string;
  ordinal?: number;
  lane?: string;
  set?: string;
  index?: number;
}

/** Every live removal, by place kind (feat, skillIncrease, boost; WP13: the class-choice, tactic and rune places of
 *  rev 3 come after the record rebuild, WP15-WP17), stored order. */
export function removedPlaces(h: SwitchHost): Record<string, RemovedPlace[]> {
  const out: Record<string, RemovedPlace[]> = { feat: [], skillIncrease: [], boost: [] };
  for (const b of liveChoiceBlocks(h)) {
    if (b.kind !== 'remove.choicePlace') continue;
    const p = paramsOf(b);
    const place = String(p.place);
    (out[place] ??= []).push({ ...(p as Omit<RemovedPlace, 'key'>), key: b.key, place });
  }
  return out;
}

/** WP14: a skill-increase place as the removal seams key it — `<lane>:<level>` (lane main, bonus or background). */
export const skillPlaceId = (lane: string, level: number): string => `${lane}:${level}`;
/** WP14: a boost place as the removal seams key it — `<set>:<level, 0 outside the level sets>:<index>`. The index is
 *  the STORED position in its set's list (`ancestryBoosts`, `backgroundBoosts`, `levelBoosts`, `attributeBoosts[lvl]`). */
export const boostPlaceId = (set: string, level: number | undefined, index: number): string => `${set}:${set === 'level' ? (level ?? 0) : 0}:${index}`;

/**
 * Tweaks phase 2 WP14 (C47): the skill-increase places a live removal names, `skillPlaceId` → the removal's block
 * key (the first one stored wins). A paused removal, Tweaks off or an unreadable block names none: the place counts.
 */
export function removedSkillIncreasePlaces(h: SwitchHost): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const r of removedPlaces(h).skillIncrease) {
    if (typeof r.level !== 'number' || typeof r.lane !== 'string') continue;
    const id = skillPlaceId(r.lane, r.level);
    if (!out.has(id)) out.set(id, r.key);
  }
  return out;
}

/** …and the boost places a live removal names, `boostPlaceId` → the removal's block key. */
export function removedBoostPlaces(h: SwitchHost): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const r of removedPlaces(h).boost) {
    if (typeof r.set !== 'string' || typeof r.index !== 'number' || (r.set === 'level' && typeof r.level !== 'number')) continue;
    const id = boostPlaceId(r.set, r.level, r.index);
    if (!out.has(id)) out.set(id, r.key);
  }
  return out;
}

/** The removed places of ONE boost set (index → the removal's block key). Empty when none. */
export function removedBoostIndexes(h: SwitchHost, set: string, level?: number): ReadonlyMap<number, string> {
  const out = new Map<number, string>();
  const prefix = boostPlaceId(set, level, 0).slice(0, -1);
  for (const [id, key] of removedBoostPlaces(h)) if (id.startsWith(prefix)) out.set(Number(id.slice(prefix.length)), key);
  return out;
}

/**
 * The picks of one boost set that COUNT (the build-time seam, C47): the stored list with each removed place's pick
 * taken out (null in its place, so later positions keep theirs), read by stored position before any filter. The same
 * list when nothing in the set is removed, so a character without such a removal is untouched (C6).
 */
export function countingBoostPicks<T>(h: SwitchHost, set: string, list: readonly (T | null)[], level?: number): readonly (T | null)[] {
  const removed = removedBoostIndexes(h, set, level);
  if (!removed.size) return list;
  return list.map((v, i) => (removed.has(i) ? null : v));
}

/**
 * The slot keys of the printed feat slots a live `remove.choicePlace` removes (C17). A removal names its slot as
 * `rekeyFeatSlots` does — (level, category, ordinal), the nth slot of that category at that level — so it
 * follows its slot across toggles. `slotsAt(level)` is that level's slot list as the Builder draws it (featSlots.ts
 * `slotListAt`; passed in, because featSlots.ts imports the build and this file is imported by it). A removal
 * whose slot is not drawn names no key.
 */
export function removedPlaceKeys(h: SwitchHost, slotsAt: (level: number) => readonly string[]): ReadonlySet<string> {
  return new Set(removedPlaceBlocks(h, slotsAt).keys());
}

/** …the same, each slot key with the block key of the removal that removes it (the level page's Restore, WP6). */
export function removedPlaceBlocks(h: SwitchHost, slotsAt: (level: number) => readonly string[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const r of removedPlaces(h).feat) {
    if (typeof r.level !== 'number' || typeof r.ordinal !== 'number') continue;
    const list = slotsAt(r.level);
    const at = list.flatMap((c, i) => (c === r.category ? [i] : []))[r.ordinal];
    if (at !== undefined && !out.has(`${r.level}:${r.category}:${at}`)) out.set(`${r.level}:${r.category}:${at}`, r.key);
  }
  return out;
}

// WP13 (re-scoped 2026-10-25): "Change an answer" (WP10) and "Edit a list" (WP9 steps 1-3) come after the record
// rebuild, with their accessors; a stored block of either reads as made in a newer version (stored.ts), so none
// is ever live here.

/** A choice tweak's state as its Tweaks row reads it (C29). WP1 knows the states the stored data decides;
 *  the content-dependent ones (Not in use, Not needed now, Not applied now) come with each kind's WP. */
export type ChoiceStatus = 'live' | 'paused' | 'off' | 'notReachedYet' | 'broken';
export function placeStatus(h: ChoiceHost, inst: BlockInstance): ChoiceStatus {
  if (inst.broken) return 'broken';
  if (!inst.on) return 'paused';
  if (!tweaksSwitchOn(h)) return 'off';
  const level = inst.params?.level;
  if (inst.kind === 'choice.addPlace' && typeof level === 'number' && level > (h.level ?? 1)) return 'notReachedYet';
  return 'live';
}
