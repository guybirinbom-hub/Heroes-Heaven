/*
 * THE TWEAKS PAGE'S MODEL (plan B WP6; docs/overrides-redesign.md decisions 26-29; work/tweaks-part-b-notes/
 * plan.md section 4). Pure: the Builder's draft build, the character it builds (`featPrereqChar`) and the
 * Builder's FULL content view (`ovContent`: the host's db with the character's carried records — NEVER the
 * Sources-filtered one, or a record from a book switched off would read as broken) → the rows the page lists.
 *
 * This is the ONE place the page reads `overrides` (src/rules/blocks/overrides-readers.json `tweakRows`,
 * `tweaksTurnOffList`, `addedTweakKeys`; WP7 adds `storedTextEdit`, the text part's stored text): through the
 * one stored reader `readTweaks`, with the character's read-time rank sort
 * laid over it (`withRankSort`, so an entry an un-routed writer added since the open stamp reads as the sheet
 * applies it). Every list row is one stored tweak: live, paused, broken (an unreadable value, OR a record or
 * casting entry that is gone — `brokenWhy`, problem 8: such a tweak was invisible before), or kept unread
 * from a newer version. Nothing here writes; the page writes through blocks/write.ts.
 */
import { drawnSkillBoostPlaces, legacyArchetypeCantrips, SANCTIFICATION_FROM_DEITY, skillIncreaseCap, skillRanksAtLevel, type BuildState, type DrawnChoicePlace } from '../../rules/build';
import { LOCKED_SKILL_KEYS } from '../../rules/featGrants';
import { TWEAK_INCREASE_SOURCE } from '../../rules/ranks';
import { activeCasterArchetype, archetypeCantripAllowed } from '../../rules/casterArchetypes';
import type { StatRef } from '../../rules/explain';
import { featIdAtSlot, heldFeatSlots } from '../../rules/heldFeats';
import { heldClasses } from '../../rules/heldClasses';
import { numberTermsFor } from '../../rules/numberTerms';
import { boostPlaceId, entryLive, entryOn, featPlaceKey, liveChoiceBlocks, skillPlaceId, startLevelOf, storedChoiceBlocks } from '../../rules/blocks/active';
import { drawnSlotCategories, featCopiesHeld, printedFeatPlaces, printedSlotKey } from '../../rules/featSlots';
import { bonusSkillFeatCount, grantsFor, maxTakes, takesAllowed } from '../../rules/featGrants';
import { FEAT_CANTRIP_GRANTS } from '../../rules/featCantripGrants';
import { baselineFor } from '../../rules/blocks/baseline';
import { withRankSort } from '../../rules/blocks/migrate';
import { ABILITY_NAME, castingEntryName, recordName, targetName, type RecordBucket } from '../../rules/blocks/names';
import { BLOCK_KINDS, FEAT_PLACE_CATEGORIES, NEWER_TWEAKS_GROUP, TWEAK_GROUPS, blockKind, isChoiceKind, placeWords, ruleWords, type BlockInstance } from '../../rules/blocks/registry';
import { readTweaks, type ForeignBlock } from '../../rules/blocks/stored';
import { ARMOR_DETAILS, BUILT_SPEED_DETAILS, TARGETS, WEAPON_DETAILS, parseTargetRef, targetDefFor, type TargetAspect, type TargetKind } from '../../rules/blocks/targets';
import type { AbilityId, Character, ContentDatabase, ProficiencyKey, SaveId } from '../../rules/types';
import { ABILITIES, PROFICIENCY_RANKS, SAVES, SKILLS } from '../../rules/types';


/** `choicesLeft`: a given feat still owes an answer to its own question (the Tweaks page adds it, plan B WP8).
 *  Tweaks phase 2 (C29): `notReachedYet` (a place above the character's level), `notInUse` (its record is not
 *  the character's pick any more, its subclass's class changed), `notNeededNow` (the book no longer refuses the
 *  pick) — the last two are set by each kind's work package where its rule lives. */
export type TweakChipKind =
  | 'moved'
  | 'imported'
  | 'broken'
  | 'newer'
  | 'startsLater'
  | 'notAppliedNow'
  | 'bookChanged'
  | 'choicesLeft'
  | 'notReachedYet'
  | 'notInUse'
  | 'notNeededNow';
export interface TweakChip {
  kind: TweakChipKind;
  text: string;
}

/** A record bucket a choice tweak's "Show" opens beside the four record kinds' (`RecordBucket`). */
export type ShowBucket = RecordBucket | 'heritages' | 'backgrounds' | 'deities' | 'ancestries' | 'classes';
/** What "Show" opens: a statistic's breakdown, or a record's description. */
export type TweakShow = { stat: StatRef } | { record: { bucket: ShowBucket; id: string } };

/**
 * What "Point to another" can re-point a broken row at. Tweaks phase 2 (plan section 2b): a record of these
 * buckets (`only` narrows the list to those ids: the sanctification repoint), another drawn place of the same
 * kind, another question of a held record, or (a carrier whose value alone broke) another skill / value.
 */
export type TweakRepoint =
  | { records: RecordBucket[]; only?: readonly string[] }
  | { aspect: TargetAspect; kinds: TargetKind[] }
  | { places: string; options?: FeatPlaceOption[] }
  // WP13: a broken changed answer or edited list (WP9, WP10) re-points after the record rebuild; an extra skill
  // increase's broken skill is the one answer this version re-points.
  | { answer: 'skill' };

/** One printed place "Remove a place" can name (WP6 feat slots; WP14 skill increases and boosts): an id (a feat
 *  slot's key as drawn now; `skillIncrease:<lane>:<level>`; `boost:<set>:<level>:<index>`), its words, what it holds,
 *  and why it cannot be chosen (a removal already names it). `place`: the block's own place fields — a feat slot's
 *  (level, category, ordinal), the rest with their `place` too. */
export interface FeatPlaceOption {
  value: string;
  label: string;
  note: string;
  disabled?: string;
  place: Record<string, unknown>;
}
const PLACE_ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

/** The feat places that are always offered (C13), and the ones offered only to a character whose own book places
 *  draw that category at some level. */
const ALWAYS_PLACE_CATEGORIES = ['ancestry', 'class', 'general', 'skill', 'archetype'];
/**
 * The categories an extra FEAT place may have for this character (Tweaks phase 2 WP7, C13) — the ONE list the level
 * page's "Add a place" and the Tweaks page's place part both offer: ancestry, class, general, skill and archetype
 * always; impulse, mythic and bonus only when the character's own slot lists draw that category at some level
 * (a kineticist's impulse slots, mythic slots with Mythic on, a bonus slot Ultimate Flexibility or a variant adds).
 * `keep`: a stored place's own category, listed even when the character no longer draws it.
 */
export function featPlaceCategories(build: BuildState, content: ContentDatabase, keep?: string): string[] {
  const drawn = drawnSlotCategories(build, content);
  return FEAT_PLACE_CATEGORIES.filter((c) => ALWAYS_PLACE_CATEGORIES.includes(c) || drawn.has(c) || c === keep);
}
/** WP14 fix round 1: the stored removals other than `self` (the row being re-pointed), each by its place id — `live`
 *  (left out of the place list, as the card menu leaves it out) and `paused` (paused or broken: offered greyed, since
 *  switching it back on is its own row's switch). */
function removalsByPlace(build: BuildState, self: string | undefined, idOf: (p: Record<string, unknown>) => string | undefined) {
  const liveKeys = new Set(liveChoiceBlocks(build).map((b) => b.key));
  const live = new Set<string>();
  const paused = new Set<string>();
  for (const b of storedChoiceBlocks(build)) {
    if (b.kind !== 'remove.choicePlace' || b.key === self) continue;
    const id = idOf(b.params ?? {});
    if (id) (liveKeys.has(b.key) ? live : paused).add(id);
  }
  return { live, paused };
}
/** Every printed feat slot up to the character's level as a "Remove a place" option: "Level 4 · Class feat"
 *  ("(second)" when the level draws more than one of the kind), "holds Fleet" / "empty"; a slot a live removal
 *  already names is not offered, a paused one greyed — except `self`, the row being re-pointed. */
export function featPlaceOptions(build: BuildState, content: ContentDatabase, self?: string): FeatPlaceOption[] {
  const named = removalsByPlace(build, self, (p) => (p.place === 'feat' ? `${String(p.level)}:${String(p.category)}:${String(p.ordinal)}` : undefined));
  // Fix round 2: "(second)" is decided from every printed place, before the filter — a removed sibling still prints.
  const printed = printedFeatPlaces(build, content);
  const places = printed.filter((p) => !named.live.has(`${p.level}:${p.category}:${p.ordinal}`));
  return places.map((p) => {
    const many = printed.filter((q) => q.level === p.level && q.category === p.category).length > 1;
    const held = featIdAtSlot(build, p.key);
    return {
      value: p.key,
      label: `Level ${p.level} · ${capWord(p.category)} feat${many ? ` (${PLACE_ORDINAL[p.ordinal] ?? p.ordinal + 1})` : ''}`,
      note: held ? `holds ${recordName(content, 'feats', held)}` : 'empty',
      ...(named.paused.has(`${p.level}:${p.category}:${p.ordinal}`) ? { disabled: 'Already removed' } : {}),
      place: { level: p.level, category: p.category, ordinal: p.ordinal },
    };
  });
}
const BOOST_SET_LABEL: Record<string, string> = { ancestry: 'Ancestry boost', background: 'Background boost', free: 'Free boost' };
/** WP14: a drawn skill-increase or boost place as its option id (the Tweaks page's place part). */
const drawnPlaceId = (p: DrawnChoicePlace): string =>
  p.place === 'skillIncrease' ? `skillIncrease:${skillPlaceId(p.lane, p.level)}` : `boost:${boostPlaceId(p.set, p.level, p.index)}`;
/** …and a stored removal's skill-increase or boost place, the same way (undefined for any other place). */
function storedPlaceId(p: Record<string, unknown>): string | undefined {
  if (p.place === 'skillIncrease' && typeof p.level === 'number' && typeof p.lane === 'string') return `skillIncrease:${skillPlaceId(p.lane, p.level)}`;
  if (p.place === 'boost' && typeof p.set === 'string' && typeof p.index === 'number') return `boost:${boostPlaceId(p.set, p.level as number | undefined, p.index)}`;
  return undefined;
}
/**
 * WP14: every printed place "Remove a place" may name — the feat slots (`featPlaceOptions`), then each level's skill
 * increases and attribute boosts, by level ("Level 5 · Skill increase", "Level 10 · Attribute boost (third)", "Level 1 ·
 * Free boost (first)"), each saying what it holds; a place a live removal already names is not offered (fix round 1:
 * as the card menu), a paused one greyed — except `self` (the row being re-pointed). `kind` narrows to one place kind (Point to another: the same kind).
 */
export function choicePlaceOptions(build: BuildState, content: ContentDatabase, self?: string, kind?: string): FeatPlaceOption[] {
  const feats = !kind || kind === 'feat' ? featPlaceOptions(build, content, self).map((o) => ({ ...o, at: o.place.level as number })) : [];
  const named = removalsByPlace(build, self, storedPlaceId);
  const others = drawnSkillBoostPlaces(build, content)
    .filter((p) => (!kind || p.place === kind) && !named.live.has(drawnPlaceId(p)))
    .map((p) => {
      const value = drawnPlaceId(p);
      const label =
        p.place === 'skillIncrease'
          ? `Level ${p.level} · Skill increase${p.lane === 'main' ? '' : ` (${p.lane})`}`
          : p.set === 'level'
            ? `Level ${p.level} · Attribute boost (${PLACE_ORDINAL[p.index] ?? p.index + 1})`
            : `Level 1 · ${BOOST_SET_LABEL[p.set]} (${PLACE_ORDINAL[p.index] ?? p.index + 1})`;
      const held = p.place === 'skillIncrease' ? (p.answer ? skillWord(p.answer) : undefined) : p.answer ? attributeWord(p.answer) : undefined;
      const place: Record<string, unknown> =
        p.place === 'skillIncrease' ? { place: 'skillIncrease', level: p.level, lane: p.lane } : { place: 'boost', set: p.set, ...(p.set === 'level' ? { level: p.level } : {}), index: p.index };
      return { value, label, note: held ? `holds ${held}` : 'empty', ...(named.paused.has(value) ? { disabled: 'Already removed' } : {}), place, at: p.place === 'boost' && p.set !== 'level' ? 1 : (p.level ?? 1) };
    });
  // By level (stable): a level's feat slots, then its increases, then its boosts.
  return [...feats, ...others]
    .map((o, i) => ({ o, i }))
    .sort((x, y) => x.o.at - y.o.at || x.i - y.i)
    .map(({ o: { at: _at, ...o } }) => o);
}

/** The feat a removed printed feat slot holds (its pick stays under its key), when that slot is still drawn. */
function heldInRemovedPlace(build: Partial<BuildState> | undefined, content: ContentDatabase, p: Record<string, unknown>): string | undefined {
  if (!build || p.place !== 'feat' || typeof p.level !== 'number' || typeof p.category !== 'string' || typeof p.ordinal !== 'number') return undefined;
  const key = printedSlotKey(build as BuildState, content, p.level, p.category, p.ordinal);
  return key ? featIdAtSlot(build as BuildState, key) : undefined;
}
/** A removed printed feat slot reached but no longer drawn (a toggle or class change took it): "Not in use" (C29). */
function removedPlaceGone(b: BlockInstance, build: Partial<BuildState>, content: ContentDatabase | undefined): boolean {
  const p = b.params ?? {};
  // WP14: a removed skill-increase or boost place the character no longer draws (a class change, a variant rule
  // switched off) — reached, and no drawn place of its kind has its id.
  const id = content && b.kind === 'remove.choicePlace' ? storedPlaceId(p) : undefined;
  if (id) {
    if ((typeof p.level === 'number' && p.level > (build.level ?? 1)) || !build.classId) return false;
    return !drawnSkillBoostPlaces(build as BuildState, content!).some((q) => drawnPlaceId(q) === id);
  }
  if (!content || b.kind !== 'remove.choicePlace' || p.place !== 'feat' || typeof p.level !== 'number' || typeof p.category !== 'string' || typeof p.ordinal !== 'number') return false;
  if (p.level > (build.level ?? 1) || !build.classId) return false;
  return printedSlotKey(build as BuildState, content, p.level, p.category, p.ordinal) === null;
}

/** Where "Go to" takes the player for a choice tweak (the level page or Setup), and the place it flashes
 *  (`data-place-key` on the card that draws it, once each picker WP wires one). */
export interface TweakGoTo {
  page: 'setup' | number;
  placeKey?: string;
}

export interface TweakRowModel {
  /** The instance key (`proficiencies:stealth`, `blocks:t3` …), or `foreign:<n>` for a block kept unread. */
  key: string;
  /** The registry kind, or 'foreign'. */
  kind: string;
  /** The list heading (registry `group`, or "Made in a newer version"). */
  group: string;
  what: string;
  /** Where it applies, as the sheet names the place ("Skills", "Spellcasting (Cleric)", "Feats" …). */
  where: string;
  reason?: string;
  /** Its start level, when later than level 1. */
  fromLevel?: number;
  /** Its own on/off. */
  on: boolean;
  /** Counts right now (its own switch, the master switch or an import stamp, its start level, not broken). */
  live: boolean;
  chips: TweakChip[];
  /** Why it cannot be applied: an unreadable value, a record or casting entry that is gone. */
  broken?: string;
  /** Made by a newer version: no switch, no editor. The text says what this version does with it. */
  newer?: string;
  readOnly: boolean;
  show?: TweakShow;
  repoint?: TweakRepoint;
  /** Tweaks phase 2: where "Go to" leads (a choice tweak's level page or Setup). */
  goTo?: TweakGoTo;
  /** WP7 (C12): the Delete button's words when they say more than "Delete tweak" — a filled extra feat place keeps
   *  its feat ("Delete — Toughness stays as a feat with no slot"). */
  deleteLabel?: string;
  /** The stored instance (absent for a block kept unread). */
  inst?: BlockInstance;
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const RECORD_KIND_BUCKET: Record<string, RecordBucket> = {
  'grant.feat': 'feats',
  'grant.classFeature': 'classFeatures',
  'grant.language': 'languages',
  'grant.spell': 'spells',
  'remove.feat': 'feats',
  'choice.allowAnyway': 'feats',
  // Tweaks phase 2: the per-feat choice kinds (plan section 2b: "feat gone" is their Broken, `{records: ['feats']}`
  // their repoint).
  'choice.anyList': 'feats',
  'choice.moreTakes': 'feats',
};
const SET_KINDS = new Set(['number.set', 'number.setMaxHp', 'attribute.set']);

/** The record a record kind points at (`feats/<id>` of a text edit taken apart). */
export function recordOf(b: BlockInstance): { bucket: RecordBucket; id: string } | undefined {
  if (typeof b.record !== 'string' || !b.record) return undefined;
  if (b.kind === 'text.edit') {
    const m = /^(feats|classFeatures)\/(.+)$/.exec(b.record);
    return m ? { bucket: m[1] as RecordBucket, id: m[2] } : undefined;
  }
  const bucket = RECORD_KIND_BUCKET[b.kind];
  return bucket ? { bucket, id: b.record } : undefined;
}

const isRitual = (content: ContentDatabase, id: unknown): boolean =>
  typeof id === 'string' && !!(content.spells as Record<string, { ritual?: boolean }> | undefined)?.[id]?.ritual;

/** A rank entry's target; an entry whose key names no track (a bare `lore:Lore`) uses its stored key. */
const rankTargetOf = (b: BlockInstance) => b.target ?? `skill:${b.key.slice('proficiencies:'.length)}`;

/* ───────────────── Tweaks phase 2: the seven choice kinds' rows (plan sections 2, 2b, 3; C29, C33) ───────────────── */

/** The picker a "Take anyway" names, in words. */
const PICKER_WORD: Record<string, string> = {
  heritage: 'heritage',
  background: 'background',
  deity: 'deity',
  subclass: 'subclass',
  spell: 'spell',
  sanctification: 'sanctification',
};
/** The content buckets a picker's record lives in (a subclass option is a class-feature record). */
export const PICKER_BUCKETS: Record<string, ShowBucket[]> = {
  heritage: ['heritages'],
  background: ['backgrounds'],
  deity: ['deities'],
  subclass: ['classFeatures'],
  spell: ['spells'],
  sanctification: ['feats', 'classFeatures'],
};
// WP13 (re-scoped 2026-10-25): the question words, buckets and carried questions of "Change an answer" and "Edit a
// list" (WP9 steps 1-3, WP10) come back with those kinds, after the record rebuild; a stored one is a read-only row.
/** What a `choice.anyList` lets a feat do, by rule (section 2: "Fleet — allowed in any feat place (list)"). */
const ANY_LIST_WORD: Record<string, string> = {
  list: 'allowed in any feat place (list)',
  level: 'allowed above its level (level)',
  onlyAtLevel: 'allowed at any level (only at its level)',
};
/** A place with no level page of its own is chosen on Setup (a level-1 boost set). */
const SETUP_BOOST_SETS = new Set(['ancestry', 'background', 'free']);

const isSkillKey = (k: unknown): k is string => typeof k === 'string' && ((SKILLS as readonly string[]).includes(k) || /^lore:[a-z0-9]+(-[a-z0-9]+)*$/.test(k));
const capWord = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A skill key as words: "stealth" → "Stealth", "lore:sailing" → "Sailing Lore". */
function skillWord(key: unknown): string {
  if (typeof key !== 'string' || !key) return '?';
  return key.startsWith('lore:') ? `${key.slice(5).split('-').map(capWord).join(' ')} Lore` : capWord(key);
}
const attributeWord = (a: unknown) => (typeof a === 'string' ? (ABILITY_NAME[a] ?? a.toUpperCase()) : '?');

/** The first of `buckets` that holds `id`, with the record's name. */
function findRecord(content: ContentDatabase, buckets: readonly ShowBucket[], id: unknown): { bucket: ShowBucket; name: string } | undefined {
  if (typeof id !== 'string' || !id) return undefined;
  for (const bucket of buckets) {
    const rec = (content[bucket] as Record<string, { name?: string }> | undefined)?.[id];
    if (rec) return { bucket, name: rec.name || id };
  }
  return undefined;
}
const nameOr = (content: ContentDatabase, buckets: readonly ShowBucket[], id: unknown) =>
  findRecord(content, buckets, id)?.name ?? (typeof id === 'string' && id ? id : 'an unnamed record');

/** The record bucket(s) a choice tweak's record lives in. */
function choiceBuckets(b: BlockInstance): readonly ShowBucket[] {
  if (b.kind === 'choice.allowAnywayAnyPicker') return PICKER_BUCKETS[String(b.params?.picker)] ?? [];
  return [];
}
const isChoiceRow = (kind: string) => isChoiceKind(blockKind(kind));

/** The level of a choice place, when it has one. */
const placeLevel = (b: BlockInstance): number | undefined => (typeof b.params?.level === 'number' ? b.params.level : undefined);

/** A place an `addPlace` or `remove.choicePlace` names: its Setup / level page (none for an unreadable one). */
function placePage(p: Record<string, unknown>): 'setup' | number | undefined {
  if (p.place === 'boost' && typeof p.set === 'string' && SETUP_BOOST_SETS.has(p.set)) return 'setup';
  return typeof p.level === 'number' ? p.level : undefined;
}

/**
 * The answer a removed place keeps (plan section 2: "Removed: skill increase at level 5 — holds Stealth"), read
 * straight from its store. Only the places whose store is one entry per place are read here: a skill increase
 * (`skillIncreases` / `bonusSkillIncreases` / `backgroundSkillIncreases`, by level) and a boost (its set's list,
 * by index). A removed feat slot's pick needs the level's slot list (WP6 names it). A class-choice, tactic or rune
 * place (WP16, WP17) comes after the record rebuild.
 */
export function keptAnswerOf(build: Partial<BuildState> | undefined, p: Record<string, unknown>): string | undefined {
  if (!build) return undefined;
  if (p.place === 'skillIncrease' && typeof p.level === 'number') {
    const store = p.lane === 'bonus' ? build.bonusSkillIncreases : p.lane === 'background' ? build.backgroundSkillIncreases : p.lane === 'main' ? build.skillIncreases : undefined;
    const v = store?.[p.level];
    return v ? skillWord(v) : undefined;
  }
  if (p.place === 'boost' && typeof p.index === 'number') {
    const list = p.set === 'ancestry' ? build.ancestryBoosts : p.set === 'background' ? build.backgroundBoosts : p.set === 'free' ? build.levelBoosts : p.set === 'level' && typeof p.level === 'number' ? build.attributeBoosts?.[p.level] : undefined;
    const v = list?.[p.index];
    return v ? attributeWord(v) : undefined;
  }
  return undefined;
}

/** "Take a feat more times" (WP8): the copies of a feat the build holds against its cap (`featCopiesHeld`, the
 *  storage view: a paused extra place's copy counts), what the build allows now (`takesAllowed`) and the book's
 *  own cap. The row line, its chips and the count's floor read this one tally. */
export function moreTakesTally(build: Partial<BuildState>, content: ContentDatabase, featId: string): { held: number; allowed: number; book: number } {
  const b = build as BuildState;
  return { held: featCopiesHeld(b, content, featId), allowed: takesAllowed(featId, content, b), book: maxTakes(content.feats?.[featId]) };
}

/**
 * The questions a copy past the book SHARES with the first copy, in the words the row chip uses. A once-only feat
 * (the book's cap 1) keeps these answers under the feat id, never under the slot, so every copy reads the same one.
 * Measured with the real buildCharacter, a second copy held through a live block (wp8-report.md, fixes rounds 1 and 3):
 *   - "spell choice": `effectChoices['<feat>:<choice>']` with a `spellFilter` (Minor Deific Power: no second spell;
 *     the per-taking read in build.ts skips a book cap of 1);
 *   - "skill choice": `featSkillChoices['<feat>:<i>']` (Natural Skill: no new skill; Magical Knowledge's printed
 *     "expert, or master if already expert" raises the SAME skill again, still no answer of its own);
 *   - "cantrip choice": `pickCantripChoices['<feat>']` (Arcane Tattoos: no second cantrip);
 *   - "bonus skill feat": `dedicationSkillFeats[bonusSkillFeatKey('<feat>', i)]` (Magical Knowledge: no new feat;
 *     the engine skips a feat already taken);
 *   - "choice" / "other choice": a non-spell `effectChoices` question (Magical Resistance: one resistance; a
 *     slot-keyed answer is never read).
 * NOT shared, so never named: a slot-keyed answer — `featChoices` (Canny Acumen's save), `featLoreChoices` under
 * `<slot>:<i>` (what the Builder writes; Different Worlds' second Lore counts), `pickFeatChoices` under the slot
 * (Natural Ambition's second feat counts). A feat the book lets you take again reads none of this (its own lanes ask
 * per taking).
 */
export function secondCopySharedQuestions(featId: string, rec: { maxTakable?: number | null; effectChoices?: readonly { spellFilter?: unknown }[] } | undefined): string[] {
  if (!rec || maxTakes(rec) > 1) return [];
  const g = grantsFor(featId);
  const effects = rec.effectChoices ?? [];
  const spell = effects.some((c) => !!c.spellFilter);
  const other = effects.some((c) => !c.spellFilter);
  // A skill slot with one option asks nothing; 'any' or two or more do.
  const skill = (g?.skillChoices ?? []).some((s) => s.options === 'any' || (Array.isArray(s.options) && s.options.length > 1));
  return [
    spell && 'spell choice',
    skill && 'skill choice',
    !!FEAT_CANTRIP_GRANTS[featId] && 'cantrip choice',
    bonusSkillFeatCount(g) > 0 && 'bonus skill feat',
    other && (spell ? 'other choice' : 'choice'),
  ].filter((s): s is string => !!s);
}
/** The chip's words for `secondCopySharedQuestions` (one sentence for every store). */
export function sharedAnswerWords(questions: readonly string[]): string {
  const list = questions.length > 1 ? `${questions.slice(0, -1).join(', ')} and ${questions[questions.length - 1]}` : questions[0] ?? '';
  return `Not applied now: a second copy shares the first copy's ${list} — it adds no answer of its own`;
}

/** A choice tweak's row line (plan section 2's "Tweaks page row" column). `build` names what a place holds. */
function choiceRowText(b: BlockInstance, content: ContentDatabase, build?: Partial<BuildState>): string {
  const p = b.params ?? {};
  switch (b.kind) {
    case 'choice.allowAnywayAnyPicker': {
      const name = nameOr(content, choiceBuckets(b), b.record);
      if (p.picker === 'sanctification') return `${capWord(typeof p.value === 'string' ? p.value : '?')} for ${name} (sanctification) — allowed anyway`;
      return `${name} (${PICKER_WORD[String(p.picker)] ?? String(p.picker)}) — taken anyway`;
    }
    case 'choice.anyList':
      return `${recordName(content, 'feats', b.record)} — ${ANY_LIST_WORD[String(p.rule)] ?? `allowed past ${ruleWords(p.rule) ?? 'a rule'}`}`;
    case 'choice.moreTakes': {
      const n = typeof p.times === 'number' ? p.times : 0;
      // WP8: "(taken 2 of 2)" — the copies held (`featCopiesHeld`, the count's floor reads the same counter) of what
      // the build allows now (`takesAllowed`: the book's plus every LIVE block; paused or Tweaks off, the book's).
      const tally = build && typeof b.record === 'string' ? moreTakesTally(build, content, b.record) : undefined;
      return `${recordName(content, 'feats', b.record)} — may be taken ${n} more time${n === 1 ? '' : 's'}${tally && Number.isFinite(tally.allowed) ? ` (taken ${tally.held} of ${tally.allowed})` : ''}`;
    }
    case 'choice.addPlace': {
      const where = capWord(placeWords(p) ?? 'place');
      if (p.place === 'feat') {
        const held = heldInPlace(build, p);
        return `Extra ${where.charAt(0).toLowerCase() + where.slice(1)} — ${held ? `holds ${recordName(content, 'feats', held)}` : 'empty'}`;
      }
      const answer = p.place === 'skillIncrease' ? (typeof p.skill === 'string' ? skillWord(p.skill) : undefined) : typeof p.attribute === 'string' ? attributeWord(p.attribute) : undefined;
      return `Extra ${where.charAt(0).toLowerCase() + where.slice(1)} — ${answer ?? 'not chosen yet'}`;
    }
    case 'remove.choicePlace': {
      // A removed feat slot's pick stays under its key (WP6): read through the slot as drawn now.
      const featHeld = heldInRemovedPlace(build, content, p);
      const kept = keptAnswerOf(build, p) ?? (featHeld ? recordName(content, 'feats', featHeld) : undefined);
      return `Removed: ${placeWords(p) ?? 'a choice place'}${kept ? ` — holds ${kept}` : ''}`;
    }
    // WP13: "Change an answer" and "Edit a list" (WP10, WP9) read as a newer version's until the record rebuild, so
    // they never reach here as instances; their words come back with them.
    default:
      return blockKind(b.kind)?.title ?? b.kind;
  }
}

/** Where a choice tweak applies, as the page names it: Setup, a level, Spells or Feats. */
function choiceWhere(b: BlockInstance): string {
  const p = b.params ?? {};
  switch (b.kind) {
    case 'choice.allowAnywayAnyPicker':
      if (p.picker === 'spell') return 'Spells';
      return 'Setup';
    case 'choice.anyList':
    case 'choice.moreTakes':
      return 'Feats';
    case 'choice.addPlace':
    case 'remove.choicePlace': {
      const page = placePage(p);
      return page === undefined ? '—' : page === 'setup' ? 'Setup' : `Level ${page}`;
    }
    default:
      return '—';
  }
}

/**
 * WP11 (section 6, rev 3 finding 16): an extra skill increase whose `skill` names a Lore the character does not know at
 * its place — the engine dropped its step (build.ts, the tweak lane: a Lore nothing trains by then), and not because a
 * record locks that Lore (Bardic Lore: the level's own grey, not a broken target). Read off the character's own
 * history; with no character, or while the place does not count (paused, Tweaks off), it cannot say: not Broken.
 */
function carrierLoreGone(b: BlockInstance, p: Record<string, unknown>, character?: Partial<Pick<Character, 'skillHistory'>> | null): string | undefined {
  if (b.kind !== 'choice.addPlace' || p.place !== 'skillIncrease' || typeof p.skill !== 'string' || !p.skill.startsWith('lore:')) return undefined;
  const step = character?.skillHistory?.steps.find((s) => s.source === `${TWEAK_INCREASE_SOURCE}${b.key.slice('blocks:'.length)}`);
  if (step?.note !== 'drop' || LOCKED_SKILL_KEYS[step.key]) return undefined;
  return `${skillWord(p.skill)} is not a Lore you know at level ${String(p.level)}`;
}

/** The skills an extra skill increase at `level` may raise, as the place part offers them (WP11): the sixteen and
 *  every Lore the character knows by then (`afterBackground`, C15), each greyed by the level's own rules (legendary,
 *  the level's cap, a locked Lore). A stored answer outside the list is the caller's to show by name. */
export function carrierSkillOptions(character: Character | null | undefined, level: number | undefined): { value: string; label: string; disabled?: boolean; disabledReason?: string }[] {
  const at = typeof level === 'number' ? level : 1;
  const ranks = (character && (skillRanksAtLevel(character, at, 'afterBackground') ?? character.proficiencies.skills)) || {};
  const lores = Object.keys(ranks).filter((k) => k.startsWith('lore:') && ranks[k as ProficiencyKey] !== 'untrained');
  return [...SKILLS, ...lores].map((k) => {
    const cur = ranks[k as ProficiencyKey] ?? 'untrained';
    const i = PROFICIENCY_RANKS.indexOf(cur);
    const next = PROFICIENCY_RANKS[Math.min(i + 1, PROFICIENCY_RANKS.length - 1)];
    const why =
      next === cur
        ? 'Already legendary — nothing left to increase.'
        : PROFICIENCY_RANKS.indexOf(next) > PROFICIENCY_RANKS.indexOf(skillIncreaseCap(at))
          ? `This level's increases cap at ${skillIncreaseCap(at)}.`
          : LOCKED_SKILL_KEYS[k];
    return { value: k, label: skillWord(k), ...(why ? { disabled: true, disabledReason: why } : {}) };
  });
}

/** Why a choice tweak points at something that is gone (plan section 2b's `brokenWhy` column). */
function choiceBrokenWhy(b: BlockInstance, content: ContentDatabase, character?: Partial<Pick<Character, 'skillHistory'>> | null): string | undefined {
  const p = b.params ?? {};
  const loreGone = carrierLoreGone(b, p, character);
  if (loreGone) return loreGone;
  switch (b.kind) {
    case 'choice.allowAnywayAnyPicker': {
      if (p.picker === 'subclass') {
        const cls = typeof p.classId === 'string' ? content.classes?.[p.classId] : undefined;
        if (cls && !(cls.subclass?.options ?? []).some((o) => o.id === b.record)) return `"${String(b.record)}" is not a ${cls.subclass?.name ?? 'subclass'} of ${cls.name} any more`;
        if (!cls) return `the class "${String(p.classId ?? '?')}" is not in the rules data any more`;
        return undefined;
      }
      if (p.picker === 'sanctification') {
        if (typeof b.record !== 'string' || !SANCTIFICATION_FROM_DEITY.has(b.record) || !findRecord(content, ['feats', 'classFeatures'], b.record))
          return `"${String(b.record ?? '?')}" no longer asks a sanctification`;
        return undefined;
      }
      return findRecord(content, choiceBuckets(b), b.record) ? undefined : `"${String(b.record ?? '?')}" is not in the rules data any more`;
    }
    case 'choice.addPlace':
      return p.place === 'skillIncrease' && p.skill !== undefined && !isSkillKey(p.skill) ? `"${String(p.skill)}" is not a skill` : undefined;
    // remove.choicePlace: rev 3 s5's one way to break (a class-choice place whose group left its class) is WP16's,
    // after the record rebuild (WP13). A feat, skill-increase or boost place no longer drawn is "Not in use" instead.
    default:
      return undefined;
  }
}

/** The feat an extra feat place holds, through the one reader of held feats (heldFeats.ts `featIdAtSlot`). */
export function heldInPlace(build: Partial<BuildState> | undefined, p: Record<string, unknown>): string | undefined {
  return build && p.place === 'feat' ? featIdAtSlot(build as BuildState, featPlaceKey(p.level, p.category, p.n)) : undefined;
}

/** "Show" for a choice tweak (section 2b's `showOf`): the record it names; a filled feat place's feat. */
function choiceShowOf(b: BlockInstance, content: ContentDatabase, build?: Partial<BuildState>): TweakShow | undefined {
  const p = b.params ?? {};
  if (b.kind === 'choice.addPlace') {
    const held = p.place === 'feat' ? heldInPlace(build, p) : undefined;
    return held ? { record: { bucket: 'feats', id: held } } : undefined;
  }
  if (b.kind === 'remove.choicePlace') return undefined;
  const found = findRecord(content, choiceBuckets(b), b.record);
  return found && typeof b.record === 'string' ? { record: { bucket: found.bucket, id: b.record } } : undefined;
}

/** "Point to another" for a broken choice tweak (section 2b's `repointOf` column). */
function choiceRepointOf(b: BlockInstance, content?: ContentDatabase): TweakRepoint | undefined {
  const p = b.params ?? {};
  switch (b.kind) {
    case 'choice.allowAnywayAnyPicker':
      if (p.picker === 'sanctification') return { records: ['feats', 'classFeatures'], only: [...SANCTIFICATION_FROM_DEITY] };
      if (p.picker === 'spell') return { records: ['spells'] };
      // A heritage, background, deity or subclass is not one of the four record buckets "Point to another" lists;
      // the picker's own Take anyway (WP4) re-picks it. A subclass lists only its class's own options (WP4: the WP2
      // check finding — it listed every class feature); with no such class, nothing to point at.
      if (p.picker !== 'subclass') return undefined;
      {
        const only = typeof p.classId === 'string' ? (content?.classes?.[p.classId]?.subclass?.options ?? []).map((o) => o.id) : [];
        return only.length ? { records: ['classFeatures'], only } : undefined;
      }
    case 'choice.addPlace':
      // A feat place has no outside target; a Broken skill carrier gets another skill (rev 3 finding 16).
      return p.place === 'skillIncrease' ? { answer: 'skill' } : undefined;
    case 'remove.choicePlace':
      return typeof p.place === 'string' ? { places: p.place } : undefined;
    default:
      return undefined;
  }
}

/** The choice rows' own chips (C29): "Not reached yet" for a place above the character's level; "Not in use"
 *  for a pick the character no longer holds where the build says so (Setup records, a subclass's class). */
/** A place-bound choice tweak (an added or removed place) above the character's level: it counts for nothing today.
 *  One rule for the chip and the switch-off list (merge checker, 2026-10-24). */
export function placeNotReached(b: BlockInstance, build: Partial<BuildState>): boolean {
  const placed = b.kind === 'choice.addPlace' || b.kind === 'remove.choicePlace';
  const level = placeLevel(b);
  return placed && level !== undefined && level > (build.level ?? 1);
}

function choiceChips(b: BlockInstance, build: Partial<BuildState>, character: Character | null | undefined, content?: ContentDatabase): TweakChip[] {
  const p = b.params ?? {};
  const out: TweakChip[] = [];
  if (placeNotReached(b, build)) out.push({ kind: 'notReachedYet', text: `Not reached yet (level ${placeLevel(b)})` });
  if (removedPlaceGone(b, build, content)) out.push({ kind: 'notInUse', text: `Not in use: this place no longer exists${placeLevel(b) !== undefined ? ` at level ${placeLevel(b)}` : ''}` });
  if (b.kind === 'choice.allowAnywayAnyPicker' && typeof b.record === 'string') {
    const held =
      p.picker === 'heritage'
        ? build.heritageId === b.record
        : p.picker === 'background'
          ? build.backgroundId === b.record
          : p.picker === 'deity'
            ? build.deityId === b.record
            : p.picker === 'subclass'
              ? heldClasses(build).some((s) => s.classId === p.classId && s.subclassId === b.record)
              : undefined;
    // The second class only under Dual Class (`heldClasses`): a `classId2` left on the build with the rule off is no class.
    if (held === false) out.push({ kind: 'notInUse', text: p.picker === 'subclass' && !heldClasses(build).some((s) => s.classId === p.classId) ? 'Not in use: the class changed' : `Not in use: not your ${PICKER_WORD[String(p.picker)]}` });
  }
  const notHeld = (b.kind === 'choice.anyList' || b.kind === 'choice.moreTakes') && typeof b.record === 'string' && character && !(character.feats ?? []).some((f) => f.featId === b.record);
  if (notHeld) out.push({ kind: 'notInUse', text: 'Not in use: not on your character' });
  // WP8 (section 6): the book takes every copy held — "Not needed now", with what is allowed and used (the app never
  // lowers `times` by itself, C36: removing a copy leaves "1 more allowed, 0 used").
  if (b.kind === 'choice.moreTakes' && typeof b.record === 'string' && content && !notHeld) {
    const t = moreTakesTally(build, content, b.record);
    const n = typeof p.times === 'number' ? p.times : 0;
    if (!Number.isFinite(t.book)) out.push({ kind: 'notNeededNow', text: 'Not needed now: the feat may be taken any number of times' });
    else if (t.held <= t.book) out.push({ kind: 'notNeededNow', text: `Not needed now: ${n} more allowed, 0 used` });
    else {
      const shared = secondCopySharedQuestions(b.record, content.feats?.[b.record]);
      if (shared.length) out.push({ kind: 'notAppliedNow', text: sharedAnswerWords(shared) });
    }
  }
  return out;
}

/** Where "Go to" leads for a choice tweak. */
function choiceGoTo(b: BlockInstance): TweakGoTo | undefined {
  const p = b.params ?? {};
  switch (b.kind) {
    case 'choice.allowAnywayAnyPicker':
      return p.picker === 'spell' ? undefined : { page: 'setup' };
    case 'choice.addPlace':
    case 'remove.choicePlace': {
      const page = placePage(p);
      if (page === undefined) return undefined;
      return p.place === 'feat' && b.kind === 'choice.addPlace' ? { page, placeKey: featPlaceKey(p.level, p.category, p.n) } : { page };
    }
    default:
      return undefined;
  }
}

/**
 * What switching Tweaks off does to a tweak of the Choices group (C5, C33): what it ADDS stops counting
 * ('stops'), what it only ALLOWS stays picked and still counts ('stays'), what it REMOVES comes back and counts
 * again ('returns'). Phase 1's Take anyway is a pick taken anyway: it stays.
 */
export type ChoiceRole = 'stops' | 'stays' | 'returns';
export function choiceRole(b: BlockInstance, build: Partial<BuildState>, content?: ContentDatabase): ChoiceRole {
  const p = b.params ?? {};
  switch (b.kind) {
    case 'remove.choicePlace':
      return 'returns';
    case 'choice.addPlace':
    case 'choice.moreTakes':
      return 'stops';
    // WP13 (C33 shrunk to the built kinds): a changed answer (WP10) and an increase past its cap, lock or short list
    // (WP12) come after the record rebuild; a stored one reads as a newer version's and is never in this list.
    case 'choice.allowAnywayAnyPicker':
      // WP4 (C5, C33): a spell answering Adaptive Adept off its Adapted Cantrip's tradition is the one pick the
      // engine drops again. Also a cantrip a dedication that NAMES its cantrips (Oatia Skysage: `cantripOptions`) does not name — the
      // second gated seam (build.ts `archCantripOk`), dropped again when the tweak stops (merge check).
      return p.picker === 'spell' && typeof p.record === 'string' && content && (offTraditionAnswer(build, content, p.record) || offArchetypeCantrip(build, content, p.record)) ? 'stops' : 'stays';
    case 'choice.anyList':
      // A feat a pick-a-feat grant took from another list is dropped by that grant again; one in a slot stays.
      return typeof b.record === 'string' && Object.values(build.pickFeatChoices ?? {}).includes(b.record) ? 'stops' : 'stays';
    default:
      return 'stays';
  }
}

/** Is `spell` a held feat's answer to an open spell choice held to ANOTHER answer's tradition
 *  (`from.sameTraditionAsAnswerOf`: Adaptive Adept) and off that tradition — the one pick a `spell` "Take anyway"
 *  keeps in the engine (build.ts's open spell grant), so it stops counting when the tweak stops? */
function offTraditionAnswer(build: Partial<BuildState>, content: ContentDatabase, spell: string): boolean {
  // A slot above the character's level grants nothing today (the engine skips it), the same filter as below.
  const slots = heldFeatSlots(build as BuildState).filter((s) => !(s.level > (build.level ?? 1)));
  // A held feat's answer: its slot's, else a GRANTED feat's (`grantedFeatChoices`, keyed by the bare feat id or
  // `featId#variant`) — the engine's open spell grant reads both through the first seam (merge check).
  const granted = Object.entries(build.grantedFeatChoices ?? {}).map(([k, v]) => ({ featId: k.split('#')[0].split(':')[0], answer: v }));
  const answers = [...slots.map((s) => ({ featId: s.featId, answer: build.featChoices?.[s.slotKey] })), ...granted];
  const answerOf = (featId: string) => answers.find((x) => x.featId === featId && x.answer)?.answer;
  return answers.some(({ featId, answer }) => {
    const from = content.feats?.[featId]?.choice?.from;
    if (!from?.sameTraditionAsAnswerOf || answer !== spell) return false;
    const other = answerOf(from.sameTraditionAsAnswerOf);
    const trads = other ? content.spells?.[other]?.traditions : undefined;
    return !!trads?.length && !(content.spells?.[spell]?.traditions ?? []).some((t) => trads.includes(t));
  });
}

/** Is `spell` a cantrip in the active caster archetype's pool that the dedication does not name (`cantripOptions`:
 *  Oatia Skysage)? build.ts's `archCantripOk` keeps it only while a live `spell` allow names it — the pool is
 *  `archetypeSpells.cantrips` for two casters, else `build.cantrips`, else the dedication's retired answers. */
function offArchetypeCantrip(build: Partial<BuildState>, content: ContentDatabase, spell: string): boolean {
  const arch = activeCasterArchetype(heldFeatSlots(build as BuildState).filter((s) => !(s.level > (build.level ?? 1))).map((s) => s.featId));
  if (!arch?.config.cantripOptions || archetypeCantripAllowed(arch, spell)) return false;
  const twoCaster = !!(build.classId && content.classes?.[build.classId]?.spellcasting);
  // The engine's order (build.ts): `archetypeSpells.cantrips` for two casters, falling back to `build.cantrips`
  // when an older save has no `archetypeSpells`.
  const pooled = (twoCaster ? build.archetypeSpells?.cantrips : undefined) ?? build.cantrips ?? [];
  const pool = pooled.length ? pooled : legacyArchetypeCantrips(arch.dedicationId, build as BuildState, content);
  return pool.includes(spell);
}

/** One tweak as one short line (plan B section 4.4): "Athletics +1", "AC set to 20", "Stealth at least
 *  expert", "Fleet", "Ritual: Planar Binding" … A spell attack / DC target names its casting entry. */
export function rowText(b: BlockInstance, content: ContentDatabase, character?: Pick<Character, 'spellcasting'> | null, build?: Partial<BuildState>): string {
  // Tweaks phase 2: a choice tweak's line names its pick, place or answer (`build`: what a place holds).
  if (isChoiceRow(b.kind)) return choiceRowText(b, content, build);
  const entries = character?.spellcasting;
  const tn = (k: string | undefined) => targetName(k, entries, { page: true });
  const n = typeof b.value === 'number' ? String(b.value) : '?';
  const unit = b.target?.startsWith('speed:') ? ' ft' : '';
  const rec = recordOf(b);
  const name = rec ? recordName(content, rec.bucket, rec.id) : String(b.record ?? '?');
  switch (b.kind) {
    case 'number.add':
      return `${tn(b.target)} ${typeof b.value === 'number' ? signed(b.value) : '?'}${b.bonusType ? ` ${b.bonusType}` : ''}`;
    case 'attribute.add':
      return `${tn(b.target)} ${typeof b.value === 'number' ? signed(b.value) : '?'}`;
    case 'number.set':
      return `${tn(b.target)} set to ${n}${unit}`;
    case 'number.setMaxHp':
      return `Maximum HP set to ${n}`;
    case 'attribute.set': {
      const ab = parseTargetRef(b.target ?? '')?.detail ?? '';
      return `${ABILITY_NAME[ab] ?? tn(b.target)} set to ${n}`;
    }
    case 'number.atLeast':
      return `${tn(b.target)} at least ${n}${unit}`;
    case 'rank.atLeast':
      return `${tn(rankTargetOf(b))} at least ${b.rank ?? '?'}`;
    case 'rank.exactly':
      return `${tn(rankTargetOf(b))} exactly ${b.rank ?? '?'}`;
    case 'rank.legacySet':
      return `${tn(rankTargetOf(b))} ${b.rank ?? '?'} (old rank, kept as it was)`;
    case 'grant.feat':
    case 'grant.classFeature':
    case 'grant.language':
      return name;
    case 'grant.spell': {
      if (isRitual(content, b.record)) return `Ritual: ${name}`;
      const r = b.params?.rank;
      return typeof r === 'number' ? `${name} (${r === 0 ? 'cantrip' : `rank ${r}`})` : name;
    }
    case 'remove.feat':
      return `Removed: ${name}`;
    case 'choice.allowAnyway':
      return `Take anyway: ${name}`;
    case 'text.edit':
      return `Your text: ${name}`;
    default:
      return blockKind(b.kind)?.title ?? b.kind;
  }
}

/** Where a tweak applies, as the sheet names the place (plan B section 4.2) — the same place "Show" opens. */
export function whereOf(b: BlockInstance, content: ContentDatabase, character?: Pick<Character, 'spellcasting'> | null): string {
  if (isChoiceRow(b.kind)) return choiceWhere(b);
  const rec = recordOf(b);
  switch (b.kind) {
    case 'grant.feat':
    case 'remove.feat':
    case 'choice.allowAnyway':
      return 'Feats';
    case 'grant.classFeature':
      return 'Class features';
    case 'grant.language':
      return 'Languages';
    case 'grant.spell':
      return isRitual(content, b.record) ? 'Rituals' : 'Spells';
    case 'text.edit':
      return rec?.bucket === 'classFeatures' ? 'Class features' : 'Feats';
  }
  const def = blockKind(b.kind);
  const target = def?.family === 'rank' ? rankTargetOf(b) : b.target;
  const aspect = def && 'aspect' in def.accepts ? def.accepts.aspect : undefined;
  if (!target || !aspect) return '—';
  const ref = parseTargetRef(target);
  // An old raw Lore key (`skill:lore:Sailing Lore`) is no canonical target, but it is still a skill row.
  const t = targetDefFor(target, aspect) ?? (ref ? TARGETS.find((x) => x.kind === ref.kind && x.aspect === aspect && x.owner === ref.owner) : undefined);
  if (!t) return '—';
  if (t.owner === 'casting-entry') return `${t.group} (${castingEntryName(character?.spellcasting, ref?.ownerId)})`;
  return t.group;
}

/**
 * Why a tweak points at something that is gone (decision 13; plan B WP6): a record id missing from the rules
 * data (`content` = the Builder's FULL view), or a spell attack / DC target whose casting entry the character
 * no longer has. Undefined when it is fine. The engine already never applies these (the build skips an id it
 * does not hold; a term on a gone entry has no reader); the page is where the player can see and fix them.
 * A given LANGUAGE is the exception (WP6 fix round 1): the build lists any id it is given (build.ts
 * `liveGivenLanguages`, no content check), so a language missing from the rules data still counts on the
 * sheet, and the page must not grey it or leave it off the switch-off list.
 */
export function brokenWhy(b: BlockInstance, content: ContentDatabase, character?: (Pick<Character, 'spellcasting'> & Partial<Pick<Character, 'skillHistory'>>) | null): string | undefined {
  if (b.kind === 'grant.language') return undefined;
  if (isChoiceRow(b.kind) && !recordOf(b)) return choiceBrokenWhy(b, content, character);
  const rec = recordOf(b);
  if (rec) {
    const bucket = content[rec.bucket] as Record<string, unknown> | undefined;
    if (!bucket?.[rec.id]) return `"${rec.id}" is not in the rules data any more`;
    return undefined;
  }
  if (b.target) {
    const ref = parseTargetRef(b.target);
    if (ref?.owner === 'casting-entry' && !(character?.spellcasting ?? []).some((e) => e.id === ref.ownerId)) {
      return `the casting entry "${ref.ownerId}" is gone`;
    }
  }
  return undefined;
}

/** The breakdown or description "Show" opens for a tweak; undefined when there is none to open. */
export function showOf(b: BlockInstance, content?: ContentDatabase, build?: Partial<BuildState>): TweakShow | undefined {
  if (isChoiceRow(b.kind) && !recordOf(b)) return content ? choiceShowOf(b, content, build) : undefined;
  const rec = recordOf(b);
  if (rec) return { record: rec };
  const def = blockKind(b.kind);
  const target = def?.family === 'rank' ? rankTargetOf(b) : b.target;
  const ref = target ? parseTargetRef(target) : null;
  if (!ref) return undefined;
  const d = ref.detail;
  switch (ref.kind) {
    case 'score':
      return d && (ABILITIES as readonly string[]).includes(d) ? { stat: { kind: 'ability', ability: d as AbilityId } } : undefined;
    case 'max-hp':
      return { stat: { kind: 'hp' } };
    case 'ac':
      return { stat: { kind: 'ac' } };
    case 'save':
      return d && (SAVES as readonly string[]).includes(d) ? { stat: { kind: 'save', save: d as SaveId } } : undefined;
    case 'perception':
      return { stat: { kind: 'perception' } };
    case 'skill':
      return d ? { stat: { kind: 'skill', skill: d as ProficiencyKey } } : undefined;
    case 'class-dc':
      return { stat: { kind: 'classDc' } };
    case 'initiative':
      return { stat: { kind: 'initiative' } };
    case 'spell-attack':
    case 'spell-dc':
      return ref.ownerId ? { stat: { kind: 'spell', entryId: ref.ownerId, which: ref.kind === 'spell-dc' ? 'dc' : 'attack' } } : undefined;
    case 'speed':
      return d === 'land' ? { stat: { kind: 'speed' } } : undefined;
    default:
      // A weapon or armor category's rank has no breakdown of its own.
      return undefined;
  }
}

function repointOf(b: BlockInstance, content?: ContentDatabase): TweakRepoint | undefined {
  const def = blockKind(b.kind);
  if (!def || !def.editor) return undefined;
  if ('records' in def.accepts) return { records: [...def.accepts.records] };
  // Tweaks phase 2: a choice kind pointing at pickers, places or questions re-points per plan section 2b.
  if (!('aspect' in def.accepts)) return choiceRepointOf(b, content);
  return { aspect: def.accepts.aspect, kinds: [...def.accepts.kinds] };
}

/** A block kept unread (a newer version, a kind this version does not know, an element it cannot parse). */
function foreignRow(f: ForeignBlock, i: number, character?: Pick<Character, 'spellcasting'> | null): TweakRowModel {
  const raw = f.raw && typeof f.raw === 'object' ? (f.raw as Record<string, unknown>) : {};
  const title = typeof raw.kind === 'string' ? blockKind(raw.kind)?.title : undefined;
  const target = typeof raw.target === 'string' ? `: ${targetName(raw.target, character?.spellcasting, { page: true })}` : '';
  const newer = f.why === 'unreadable' ? "This version of the app can't read it." : 'Made in a newer version of Heroes Heaven.';
  return {
    key: `foreign:${i}`,
    kind: 'foreign',
    group: NEWER_TWEAKS_GROUP,
    what: `${title ?? 'A tweak'}${target}`,
    where: '—',
    on: true,
    live: false,
    chips: [{ kind: 'newer', text: f.why === 'unreadable' ? "Can't be read" : 'Made in a newer version' }],
    newer: `${newer} This version keeps it as it is and does not apply it.`,
    readOnly: true,
  };
}

const GROUP_ORDER = new Map<string, number>([...TWEAK_GROUPS.map((g, i) => [g, i] as [string, number]), [NEWER_TWEAKS_GROUP, TWEAK_GROUPS.length]]);

/** The draft's stored tweaks with the character's read-time rank sort laid over them (the sheet's view). */
function readDraft(build: Pick<BuildState, 'overrides'>, character?: Pick<Character, 'tweakRankSort'> | null) {
  return readTweaks(withRankSort(build.overrides, character?.tweakRankSort));
}

/**
 * Every stored tweak of the draft as one list row, grouped by the registry's group order (then stored order),
 * the blocks kept unread last. `character` is the character the draft builds (`featPrereqChar`); `content`
 * the Builder's full view (`ovContent`).
 */
export function tweakRows(build: BuildState, character: Character | null | undefined, content: ContentDatabase): TweakRowModel[] {
  const { instances, foreign } = readDraft(build, character);
  const termsBy = new Map<string, ReturnType<typeof numberTermsFor>>();
  const termsOf = (target: string) => {
    if (!character) return null;
    if (!termsBy.has(target)) termsBy.set(target, numberTermsFor(character, content, target));
    return termsBy.get(target) ?? null;
  };
  const rows: (TweakRowModel & { order: number })[] = instances.map((b, i) => {
    const def = blockKind(b.kind);
    const missing = b.broken ? undefined : brokenWhy(b, content, character);
    const broken = b.broken ?? missing;
    // A newer-mode rank still counts (applied as a plain rank, its note says so): `newer` makes it read-only,
    // not greyed (WP6 fix round 1).
    const live = !broken && entryLive(b, build);
    const chips: TweakChip[] = [];
    // tweaks-ok: decision 19 names the old card on purpose ("Moved from Overrides").
    if (b.moved) chips.push({ kind: 'moved', text: 'Moved from Overrides' });
    if (b.imported) chips.push({ kind: 'imported', text: 'Imported — stays on when Tweaks is off' });
    if (broken) chips.push({ kind: 'broken', text: `Broken: ${broken}` });
    if (b.newer) chips.push({ kind: 'newer', text: 'Made in a newer version' });
    const start = startLevelOf(b);
    if (start > build.level) chips.push({ kind: 'startsLater', text: `Starts at level ${start}` });
    if (live && def?.family === 'number' && b.target) {
      // The breakdown's own 0-line note for a tweak the number ignores right now (a battle form's AC …).
      const line = def.line(b);
      const t = termsOf(b.target)?.find((x) => x.layer === 'tweak' && x.value === 0 && !!x.note && (x.key === b.key || (x.key === undefined && x.label === line)));
      if (t?.note) chips.push({ kind: 'notAppliedNow', text: `Not applied now: ${t.note}` });
    }
    if (!broken && SET_KINDS.has(b.kind) && typeof b.params?.baseline === 'number' && b.target && character) {
      const now = baselineFor(character, content, b.target, build);
      if (now !== undefined && now !== b.params.baseline) chips.push({ kind: 'bookChanged', text: `Book number changed: was ${b.params.baseline}, now ${now}` });
    }
    const choice = isChoiceRow(b.kind);
    if (choice && !broken) chips.push(...choiceChips(b, build, character, content));
    // WP6 (C29): a removed feat slot no longer drawn offers "Point to another" (another drawn slot) beside Remove.
    const gonePlace = !broken && removedPlaceGone(b, build, content);
    const newer = b.newer ? `Made in a newer version of Heroes Heaven (${b.newer}). This version keeps it as it is and applies it as a plain rank, the way older versions did.` : undefined;
    const goTo = choice && !broken ? choiceGoTo(b) : undefined;
    // WP7 (C12): Delete takes the place only — its feat stays under its key, a feat with no slot that still counts.
    // A paused place's feat counts NOT now and counts again once the place is deleted (plan risk R1), so its label
    // says so (the final check, 2026-10-25).
    const placeHeld = b.kind === 'choice.addPlace' && !broken ? heldInPlace(build, b.params ?? {}) : undefined;
    const deleteLabel = placeHeld
      ? `Delete — ${recordName(content, 'feats', placeHeld)} stays as a feat with no slot${b.on === false ? ' and counts again' : ''}`
      : undefined;
    return {
      key: b.key,
      kind: b.kind,
      group: newer ? NEWER_TWEAKS_GROUP : (def?.group ?? NEWER_TWEAKS_GROUP),
      what: rowText(b, content, character, build),
      where: newer ? '—' : whereOf(b, content, character),
      ...(b.reason ? { reason: b.reason } : {}),
      ...(start > 1 ? { fromLevel: start } : {}),
      on: b.on,
      live,
      chips,
      ...(broken ? { broken } : {}),
      ...(newer ? { newer } : {}),
      readOnly: !!newer,
      ...(!broken && !newer ? { show: showOf(b, content, build) } : {}),
      ...(broken
        ? { repoint: repointOf(b, content) }
        : gonePlace
          ? { repoint: { places: String(b.params?.place), options: choicePlaceOptions(build, content, b.key, String(b.params?.place)) } }
          : {}),
      ...(goTo ? { goTo } : {}),
      ...(deleteLabel ? { deleteLabel } : {}),
      inst: b,
      order: i,
    };
  });
  const all = [...rows, ...foreign.map((f, i) => ({ ...foreignRow(f, i, character), order: instances.length + i }))];
  all.sort((a, b) => (GROUP_ORDER.get(a.group) ?? 99) - (GROUP_ORDER.get(b.group) ?? 99) || a.order - b.order);
  return all.map(({ order: _order, ...r }) => r);
}

/** The rows grouped under their headings, in the page's order (empty groups left out). */
export function groupRows(rows: TweakRowModel[]): { group: string; rows: TweakRowModel[] }[] {
  const out: { group: string; rows: TweakRowModel[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last?.group === r.group) last.rows.push(r);
    else out.push({ group: r.group, rows: [r] });
  }
  return out;
}

/** What the Tweaks button shows (B12): every listed row — live, paused, broken and newer-version — and the
 *  dot when a set's book number changed (WP8 adds a given feat's unanswered question). */
export function tweaksBadge(rows: TweakRowModel[]): { count: number; dot: boolean } {
  return { count: rows.length, dot: rows.some((r) => r.chips.some((c) => c.kind === 'bookChanged')) };
}

/* ─────────────────────────────── the Options switch-off list (plan B section 5.3) ─────────────────────────────── */

export interface TurnOffList {
  /** The live tweaks that stop counting, grouped by kind (row text). The Choices group is never here: it is
   *  `choices`, split by what switching off does to each (C33). */
  off: { group: string; lines: string[] }[];
  /** Tweaks phase 2 (C33): the live Choices tweaks by what switching off does — what a tweak ADDS stops counting,
   *  what it only ALLOWS stays picked and still counts, what it REMOVES comes back and counts again. */
  choices: Record<ChoiceRole, string[]>;
  /** The import-stamped ones: they stay on (spec 2). */
  stayOn: string[];
  /** Made in a newer version: these turn off too. */
  newer: string[];
}

/**
 * What switching Tweaks off would do (plan B section 5.3): every tweak that counts with the switch on and
 * stops with it off, grouped by kind — an old given feat or ritual with no import stamp says it "may have come
 * from an import" (spec 2: pre-phase-1 import leftovers cannot be told apart) — then the import-stamped ones
 * that stay on, then what a newer version made. Paused and broken tweaks are already off and are not listed;
 * nor is one that starts at a later level (it counts for nothing today: `entryLive` with the switch on, i.e.
 * `entryOn(b, true)` at or past its start level — WP6 fix round 1).
 */
/** WP14 (C33): a removed skill-increase or boost place in "Comes back and counts again" — the place and the answer it
 *  kept ("Skill increase at level 5: Stealth"). Undefined for any other tweak (its row text is its line). */
function returnsText(b: BlockInstance, build: Partial<BuildState>): string | undefined {
  const p = b.params ?? {};
  if (b.kind !== 'remove.choicePlace' || (p.place !== 'skillIncrease' && p.place !== 'boost')) return undefined;
  const kept = keptAnswerOf(build, p);
  return `${capWord(placeWords(p) ?? 'a choice place')}${kept ? `: ${kept}` : ''}`;
}

export function tweaksTurnOffList(build: Pick<BuildState, 'overrides' | 'options' | 'level'> & Partial<BuildState>, content: ContentDatabase, character?: Pick<Character, 'spellcasting' | 'tweakRankSort'> | null): TurnOffList {
  const { instances, foreign } = readDraft(build, character);
  const off = new Map<string, string[]>();
  const choices: Record<ChoiceRole, string[]> = { stops: [], stays: [], returns: [] };
  const stayOn: string[] = [];
  const newer: string[] = [];
  const sorted = instances
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (GROUP_ORDER.get(blockKind(x.b.kind)?.group ?? '') ?? 99) - (GROUP_ORDER.get(blockKind(y.b.kind)?.group ?? '') ?? 99) || x.i - y.i);
  for (const { b } of sorted) {
    if (!entryOn(b, true) || startLevelOf(b) > (build.level ?? 1) || brokenWhy(b, content, character)) continue;
    // A place above the character's level counts for nothing today either (C29 "Not reached yet").
    if (placeNotReached(b, build)) continue;
    const text = rowText(b, content, character, build);
    if (b.imported) {
      stayOn.push(text);
      continue;
    }
    if (b.newer) {
      newer.push(text);
      continue;
    }
    const group = blockKind(b.kind)?.group ?? NEWER_TWEAKS_GROUP;
    if (group === 'Choices') {
      choices[choiceRole(b, build, content)].push(returnsText(b, build) ?? text);
      continue;
    }
    const maybeImport = b.moved && (b.kind === 'grant.feat' || (b.kind === 'grant.spell' && isRitual(content, b.record)));
    off.set(group, [...(off.get(group) ?? []), maybeImport ? `${text} — may have come from an import` : text]);
  }
  for (const [i, f] of foreign.entries()) newer.push(foreignRow(f, i, character).what);
  return { off: [...off].map(([group, lines]) => ({ group, lines })), choices, stayOn, newer };
}

/* ─────────────────────────────── "Add a tweak" menus and target choices ─────────────────────────────── */

export interface TweakMenu {
  name: string;
  place: 'main' | 'advanced';
  /** The kinds the menu holds, in registry order. */
  kinds: string[];
}

/** The "Add a tweak" menus, read off the registry (decision 23: the screen reads the registry, never a hand
 *  list), in registry order; a menu's place is its first kind's. Only kinds whose editor is BUILT are offered
 *  (decision 24: one that is not is "not in Tweaks yet"; test/tweaks-screen-registry.test.tsx). */
export function tweakMenus(): TweakMenu[] {
  const out: TweakMenu[] = [];
  for (const k of BLOCK_KINDS) {
    if (!k.editor?.built) continue;
    for (const name of k.editor.menus) {
      const m = out.find((x) => x.name === name);
      if (m) m.kinds.push(k.id);
      else out.push({ name, place: k.editor.place, kinds: [k.id] });
    }
  }
  return out;
}

export interface TargetChoice {
  key: string;
  label: string;
  group: string;
}

/** Every built target of one aspect and these target kinds this character has (its casting entries, its
 *  Lores), as the target part and "Point to another" offer them. */
export function targetChoices(aspect: TargetAspect, kinds: readonly TargetKind[], character?: Pick<Character, 'spellcasting' | 'proficiencies'> | null): TargetChoice[] {
  const out: TargetChoice[] = [];
  const entries = character?.spellcasting ?? [];
  const lores = Object.keys(character?.proficiencies?.skills ?? {}).filter((k) => /^lore:[a-z0-9]+(-[a-z0-9]+)*$/.test(k));
  for (const t of TARGETS) {
    if (!t.built || t.aspect !== aspect || !kinds.includes(t.kind)) continue;
    const details: (string | undefined)[] =
      t.detail === 'none'
        ? [undefined]
        : t.detail === 'ability'
          ? [...ABILITIES]
          : t.detail === 'save'
            ? [...SAVES]
            : t.detail === 'skill'
              ? [...SKILLS, ...lores]
              : t.detail === 'weapon'
                ? WEAPON_DETAILS
                : t.detail === 'armor'
                  ? ARMOR_DETAILS
                  : BUILT_SPEED_DETAILS;
    const owners = t.owner === 'casting-entry' ? entries.map((e) => `@casting-entry:${e.id}`) : [''];
    for (const owner of owners) {
      for (const d of details) {
        const key = `${t.kind}${d != null ? `:${d}` : ''}${owner}`;
        const group = t.owner === 'casting-entry' ? `${t.group} (${castingEntryName(entries, owner.slice('@casting-entry:'.length))})` : t.group;
        out.push({ key, label: targetName(key, entries, { page: true }), group });
      }
    }
  }
  return out;
}

/* ─────────────────────────────── the editors' reading of the registry (plan B section 4.6) ─────────────────────────────── */

/** The menu that edits a kind's rows (its first menu). */
export function menuOfKind(kind: string): TweakMenu | undefined {
  const name = blockKind(kind)?.editor?.menus[0];
  return name ? tweakMenus().find((m) => m.name === name) : undefined;
}

/** Does this kind accept this target (its aspect, and one of its target kinds)? */
export function kindAccepts(kind: string, target: string): boolean {
  const def = blockKind(kind);
  if (!def || !('aspect' in def.accepts)) return false;
  const t = targetDefFor(target, def.accepts.aspect);
  return !!t && def.accepts.kinds.includes(t.kind);
}

/** Does the menu choose a target first (any of its kinds points at a statistic, not a record)? */
export function menuHasTarget(menu: TweakMenu): boolean {
  return menu.kinds.some((k) => {
    const def = blockKind(k);
    return !!def && 'aspect' in def.accepts;
  });
}

/** The targets a menu's target part offers: the union of what its kinds accept, in the order the kinds
 *  list them (the shared-menu rule). */
export function menuTargets(menu: TweakMenu, character?: Pick<Character, 'spellcasting' | 'proficiencies'> | null): TargetChoice[] {
  const seen = new Set<string>();
  const out: TargetChoice[] = [];
  for (const k of menu.kinds) {
    const def = blockKind(k);
    if (!def || !('aspect' in def.accepts)) continue;
    for (const t of targetChoices(def.accepts.aspect, def.accepts.kinds, character)) {
      if (seen.has(t.key)) continue;
      seen.add(t.key);
      out.push(t);
    }
  }
  return out;
}

/**
 * The kinds of a menu that can hold this target, in registry order — THE SHARED-MENU RULE (plan B section
 * 4.6): two or more → the option chooser, the first one is its default. With no target chosen yet, every
 * kind of the menu when they all accept the very same targets (a rank menu: "At least" / "Exactly" before a
 * skill is chosen; a one-kind record menu), else none (choose the target first).
 */
export function menuKindsFor(menu: TweakMenu, target: string | undefined): string[] {
  if (target !== undefined) return menu.kinds.filter((k) => kindAccepts(k, target));
  const accepts = menu.kinds.map((k) => JSON.stringify(blockKind(k)?.accepts ?? null));
  return accepts.every((a) => a === accepts[0]) ? [...menu.kinds] : [];
}

/** The one kind a menu, a target and a chosen option resolve to (the chosen option when it can hold the
 *  target, else the default — the first kind that can); undefined until a target is chosen. */
export function resolveMenuKind(menu: TweakMenu, target: string | undefined, option?: string): string | undefined {
  const kinds = menuKindsFor(menu, target);
  return option && kinds.includes(option) ? option : kinds[0];
}

/** The parts an editor shows for one kind, in order: the kind's own `parts`, with the target part kept on
 *  top in a menu that chooses a target even when the kind's own parts have none (number.setMaxHp). */
export function editorParts(kind: string, menu: TweakMenu | undefined): string[] {
  const parts = [...(blockKind(kind)?.editor?.parts ?? [])];
  return menu && menuHasTarget(menu) && !parts.includes('target') ? ['target', ...parts] : parts;
}

/** The row keys a write created (`after`'s instance keys `before` did not have), so the page's one open row
 *  can follow its tweak when an edit moves its key (a given feat's level, a rank's target) or adds it. */
export function addedTweakKeys(before: Pick<BuildState, 'overrides'>, after: Pick<BuildState, 'overrides'>): string[] {
  const had = new Set(readDraft(before).instances.map((b) => b.key));
  return readDraft(after).instances.map((b) => b.key).filter((k) => !had.has(k));
}

/**
 * The player's own stored text of one text edit (`feats/<id>` / `classFeatures/<id>`), paused or live — the
 * text part's value. `contentFor` lays an edit over the record only while it is live, so the stored text is
 * read here, as stored (a field that is not a string is no text).
 */
export function storedTextEdit(build: Pick<BuildState, 'overrides'>, record: string): { name?: string; description?: string } {
  const m = /^(feats|classFeatures)\/(.+)$/.exec(record);
  if (!m) return {};
  const edits = build.overrides?.contentEdits as Record<string, Record<string, { name?: unknown; description?: unknown } | undefined> | undefined> | undefined;
  const e = edits?.[m[1]]?.[m[2]];
  return {
    ...(typeof e?.name === 'string' ? { name: e.name } : {}),
    ...(typeof e?.description === 'string' ? { description: e.description } : {}),
  };
}
