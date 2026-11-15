/*
 * STORED TWEAKS — reading the blocks a character carries inside `overrides`, and writing them back
 * without ever losing one.
 *
 * Two places hold tweaks (checker C3, docs/overrides-redesign.md "Building blocks"):
 *   - the 10 keys today's Overrides already writes (`proficiencies`, `addedFeats`, …). A kind that wraps
 *     one reads THAT key, and its reason / on-off / start level sit in `overrides.meta['<key>:<id>']`, so
 *     an older app still sees the change itself;
 *   - `overrides.blocks`, only for the new number kinds (+/-, set, at least N) and, from Tweaks phase 2, the
 *     seven choice kinds (work/tweaks-phase2-notes/plan.md section 4: each read by its own field list and
 *     closed sets, C3; an unknown closed-set value is 'newer-version', a wrong type 'unreadable').
 *
 * ⚠ Item 13: a phone on an older app opens a character with a block a newer app wrote. Whatever this
 * file cannot read — an unknown kind, a NEWER version, an element it cannot parse — is returned as
 * `foreign` and kept as the very same object, in its place, by `writeStoredBlocks`. Fields this version
 * does not know, on a block it does know, are kept too. Nothing here ever filters `overrides.blocks`.
 *
 * Reading is never an edit (checker C4): nothing here writes, and part A never writes `overrides.v`.
 */
import { loreKey } from '../loreKey';
import type { BuildOverrides, CharacterOptions, FeatCategory, TweakMeta } from '../types';
import { PROFICIENCY_RANKS } from '../types';
import {
  ANSWER_QUESTIONS,
  ANY_LIST_RULES,
  ANY_PICKERS,
  ADD_PLACES,
  ATTRIBUTE_IDS,
  BOOST_SETS,
  FEAT_PLACE_CATEGORIES,
  REMOVE_PLACES,
  REMOVE_SKILL_LANES,
  blockKind,
  type BlockInstance,
  type BlockKindDef,
} from './registry';
import { targetDefFor } from './targets';

/** One NUMBER element of `overrides.blocks` (number.add, number.set, number.atLeast, attribute.add), as this
 *  version writes it. */
export interface NumberStoredBlock {
  /** Unique within the character; the instance key is `blocks:<id>`. */
  id: string;
  /** A registry id (`number.add`). */
  kind: string;
  /** The kind's stored-shape version when written. */
  v: number;
  /** A target key (targets.ts). */
  target: string;
  value: number;
  bonusType?: 'status' | 'circumstance' | 'item';
  reason?: string;
  /** false = paused. Absent = on. */
  on?: boolean;
  from?: number;
  /** A set: the book number when it was made (decision 9). */
  baseline?: number;
}

/* ─────────────── Tweaks phase 2: the choice kinds' stored shapes (plan section 4, C1–C4) ─────────────── */

/** The fields every choice block shares. No field ever holds a slot key (C32): record ids are their own
 *  string fields, and a feat place's key is DERIVED from its level, category and `n` (C8). */
interface ChoiceCommon {
  id: string;
  v: number;
  reason?: string;
  /** false = paused. Absent = on. */
  on?: boolean;
}
/** "Take anyway" in another picker (feature 10, C19): per RECORD, every picker that offers it. WP13: a skill
 *  increase taken anyway (per place and per broken rule, WP12) comes after the record rebuild; this version
 *  stores no `picker: 'skillIncrease'` and reads one as made in a newer version. */
export interface AllowAnyPickerBlock extends ChoiceCommon {
  kind: 'choice.allowAnywayAnyPicker';
  picker: (typeof ANY_PICKERS)[number];
  /** The id the build stores; a sanctification: the asking record. */
  record: string;
  /** subclass: the class whose option it is. */
  classId?: string;
  /** sanctification: the refused answer (holy / unholy / none). */
  value?: string;
}
/** A feat allowed past one rule of a feat place's list (feature 11, C22). */
export interface AnyListBlock extends ChoiceCommon {
  kind: 'choice.anyList';
  record: string;
  rule: (typeof ANY_LIST_RULES)[number];
}
/** A feat taken `times` more times than it allows (feature 11, decision 17). */
export interface MoreTakesBlock extends ChoiceCommon {
  kind: 'choice.moreTakes';
  record: string;
  /** 1–9. */
  times: number;
}
/** An extra choice place (feature 12, C8 / C15 / C16). */
export type AddPlaceBlock = ChoiceCommon & { kind: 'choice.addPlace'; level: number } & (
    | { place: 'feat'; category: (typeof FEAT_PLACE_CATEGORIES)[number]; n: number }
    | { place: 'skillIncrease'; skill?: string }
    | { place: 'boost'; attribute?: (typeof ATTRIBUTE_IDS)[number] }
  );
/** A printed choice place removed (feature 13, C17 / C47). WP13: a class-choice, tactic or rune place (WP15-WP17)
 *  comes after the record rebuild; a stored one reads as made in a newer version. */
export type RemovePlaceBlock = ChoiceCommon & { kind: 'remove.choicePlace' } & (
    | { place: 'feat'; level: number; category: (typeof FEAT_PLACE_CATEGORIES)[number]; ordinal: number }
    | { place: 'skillIncrease'; level: number; lane: (typeof REMOVE_SKILL_LANES)[number] }
    | { place: 'boost'; set: (typeof BOOST_SETS)[number]; level?: number; index: number }
  );
/** An answer outside a choice's list (feature 14, C24): V = a carrier, P = a permission. Registered, applied by
 *  nothing (`applies: 'not-yet'`): until WP10, after the record rebuild, a stored one reads as made in a newer
 *  version (readOne). */
export interface ChangeAnswerBlock extends ChoiceCommon {
  kind: 'choice.changeAnswer';
  question: (typeof ANSWER_QUESTIONS)[number];
  record: string;
  index?: number;
  choiceValue?: string;
  value: string;
}
/** A choice list edited (feature 15, C26): values added and removed. Like ChangeAnswerBlock, read as made in a
 *  newer version until WP9 steps 1-3, after the record rebuild. */
export interface EditOptionsBlock extends ChoiceCommon {
  kind: 'choice.editOptions';
  question: (typeof ANSWER_QUESTIONS)[number];
  record: string;
  index?: number;
  add?: string[];
  remove?: string[];
}
export type ChoiceStoredBlock = AllowAnyPickerBlock | AnyListBlock | MoreTakesBlock | AddPlaceBlock | RemovePlaceBlock | ChangeAnswerBlock | EditOptionsBlock;
/** One element of `overrides.blocks`, as this version writes it. */
export type StoredBlock = NumberStoredBlock | ChoiceStoredBlock;

/** The fields each choice kind stores beside `id`, `kind`, `v`, `reason`, `on` — in the order this version
 *  writes them (id, kind, v, these, reason, on), so an unedited block round-trips byte for byte. */
export const CHOICE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // WP13: a skill increase's `rule`, `level`, `lane`, `placeId` (WP12) and a class-choice place's `classId`, `group`
  // (WP16) come with their work packages, after the record rebuild: on a stored block they are a newer app's fields.
  'choice.allowAnywayAnyPicker': ['picker', 'record', 'classId', 'value'],
  'choice.anyList': ['record', 'rule'],
  'choice.moreTakes': ['record', 'times'],
  'choice.addPlace': ['place', 'level', 'category', 'n', 'skill', 'attribute'],
  'remove.choicePlace': ['place', 'set', 'level', 'category', 'lane', 'index', 'ordinal'],
  'choice.changeAnswer': ['question', 'record', 'index', 'choiceValue', 'value'],
  'choice.editOptions': ['question', 'record', 'index', 'add', 'remove'],
};
const COMMON_FIELDS = ['id', 'kind', 'v', 'reason', 'on'];

/** C27: a tweak's answer never holds a comma — multi-pick answers are joined with ',' and split again. */
export const COMMA_REFUSAL = 'A comma would split this answer in two.';
export const answerHasComma = (s: string): boolean => s.includes(',');

/** The fields of a NUMBER StoredBlock this version reads and writes. Any other field on a stored element
 *  was written by a newer app and is carried over untouched when the element is edited. */
const KNOWN_FIELDS = new Set(['id', 'kind', 'v', 'target', 'value', 'bonusType', 'reason', 'on', 'from', 'baseline']);
const CHOICE_KNOWN = new Map(Object.entries(CHOICE_FIELDS).map(([k, f]) => [k, new Set([...COMMON_FIELDS, ...f])]));
/** The fields this version reads and writes on a stored element of `kind` (C3: per kind). */
export function knownFieldsOf(kind: unknown): ReadonlySet<string> {
  return (typeof kind === 'string' && CHOICE_KNOWN.get(kind)) || KNOWN_FIELDS;
}

export type ForeignWhy = 'unknown-kind' | 'newer-version' | 'unreadable';

export interface ForeignBlock {
  /** The stored element itself — the same object, untouched. */
  raw: unknown;
  why: ForeignWhy;
  /** Its id, when it has a readable one (so a writer can refuse to replace it). */
  id?: string;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const BONUS_TYPES = ['status', 'circumstance', 'item'];

/* ─── the per-kind reader of the choice kinds (C3) ─── */

type FieldVerdict = 'ok' | 'newer-version' | 'unreadable';
/** A closed-set field: a string this version does not know is a NEWER app's value (kept, read-only); any
 *  other type is unreadable. */
const closedSet = (set: readonly string[]) => (x: unknown): FieldVerdict => (typeof x !== 'string' || !x ? 'unreadable' : set.includes(x) ? 'ok' : 'newer-version');
const okIf = (good: boolean): FieldVerdict => (good ? 'ok' : 'unreadable');
const isText = (x: unknown) => okIf(typeof x === 'string' && x.trim() !== '');
/** An answer value: text with no comma (C27). */
const isAnswer = (x: unknown) => okIf(typeof x === 'string' && x.trim() !== '' && !answerHasComma(x));
const isWhole = (min: number, max = Number.MAX_SAFE_INTEGER) => (x: unknown) => okIf(typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max);
const isLevel = isWhole(1, 20);
const isAnswers = (x: unknown) => okIf(Array.isArray(x) && x.every((s) => isAnswer(s) === 'ok'));
/** The six attributes are a FIXED set: an unknown one is a bad value, never a newer one (rev 3 s7). */
const isAttribute = (x: unknown) => okIf(typeof x === 'string' && (ATTRIBUTE_IDS as readonly string[]).includes(x));

type FieldCheck = (x: unknown) => FieldVerdict;
/** Per choice kind: each stored field's check (run when the field is present), and the fields its
 *  discriminator requires. */
const CHOICE_READERS: Record<string, { fields: Record<string, FieldCheck>; required: (f: Record<string, unknown>) => string[] }> = {
  'choice.allowAnywayAnyPicker': {
    fields: { picker: closedSet(ANY_PICKERS), record: isText, classId: isText, value: isAnswer },
    required: (f) => (f.picker === 'subclass' ? ['picker', 'record', 'classId'] : f.picker === 'sanctification' ? ['picker', 'record', 'value'] : ['picker', 'record']),
  },
  'choice.anyList': { fields: { record: isText, rule: closedSet(ANY_LIST_RULES) }, required: () => ['record', 'rule'] },
  'choice.moreTakes': { fields: { record: isText, times: isWhole(1, 9) }, required: () => ['record', 'times'] },
  'choice.addPlace': {
    fields: { place: closedSet(ADD_PLACES), level: isLevel, category: closedSet(FEAT_PLACE_CATEGORIES), n: isWhole(0), skill: isAnswer, attribute: isAttribute },
    required: (f) => (f.place === 'feat' ? ['place', 'level', 'category', 'n'] : ['place', 'level']),
  },
  'remove.choicePlace': {
    fields: {
      place: closedSet(REMOVE_PLACES),
      set: closedSet(BOOST_SETS),
      level: isLevel,
      category: closedSet(FEAT_PLACE_CATEGORIES),
      lane: closedSet(REMOVE_SKILL_LANES),
      index: isWhole(0),
      ordinal: isWhole(0),
    },
    required: (f) => {
      switch (f.place) {
        case 'feat':
          return ['place', 'level', 'category', 'ordinal'];
        case 'skillIncrease':
          return ['place', 'level', 'lane'];
        case 'boost':
          return f.set === 'level' ? ['place', 'set', 'level', 'index'] : ['place', 'set', 'index'];
        default:
          return ['place'];
      }
    },
  },
  'choice.changeAnswer': {
    fields: { question: closedSet(ANSWER_QUESTIONS), record: isText, index: isWhole(0), choiceValue: isText, value: isAnswer },
    required: () => ['question', 'record', 'value'],
  },
  'choice.editOptions': {
    fields: { question: closedSet(ANSWER_QUESTIONS), record: isText, index: isWhole(0), add: isAnswers, remove: isAnswers },
    required: () => ['question', 'record'],
  },
};

/** The verdict on a choice block's own fields: 'newer-version' when any closed-set field holds a value a
 *  newer app wrote (that wins: this version cannot know the shape that value brings), else 'unreadable' on a
 *  missing required field, a wrong type, an empty add + remove, a comma in an answer or a bad attribute. */
function choiceVerdict(kind: string, raw: Record<string, unknown>): FieldVerdict {
  const reader = CHOICE_READERS[kind];
  let verdict: FieldVerdict = 'ok';
  for (const [field, check] of Object.entries(reader.fields)) {
    if (raw[field] === undefined) continue;
    const v = check(raw[field]);
    if (v === 'newer-version') return v;
    if (v === 'unreadable') verdict = v;
  }
  if (verdict !== 'ok') return verdict;
  if (reader.required(raw).some((f) => raw[f] === undefined)) return 'unreadable';
  if (kind === 'choice.editOptions' && ((raw.add as unknown[] | undefined)?.length ?? 0) + ((raw.remove as unknown[] | undefined)?.length ?? 0) === 0) return 'unreadable';
  if (raw.reason !== undefined && typeof raw.reason !== 'string') return 'unreadable';
  if (raw.on !== undefined && typeof raw.on !== 'boolean') return 'unreadable';
  return 'ok';
}

/** A readable choice block → its instance: `record` as the block stores it, every stored field of the kind in
 *  `params` (the very values, in the kind's field order), on, reason. No start level (C31). */
function readChoice(raw: Record<string, unknown>, def: BlockKindDef, id: string, v: number): BlockInstance | ForeignBlock {
  const verdict = choiceVerdict(def.id, raw);
  if (verdict !== 'ok') return { raw, why: verdict, id };
  const params: Record<string, unknown> = {};
  for (const f of CHOICE_FIELDS[def.id]) if (raw[f] !== undefined) params[f] = raw[f];
  const inst: BlockInstance = { kind: def.id, version: v, key: `blocks:${id}`, source: { kind: 'tweak', id: `blocks:${id}` }, on: raw.on !== false, params };
  if (typeof raw.record === 'string') inst.record = raw.record;
  if (typeof raw.reason === 'string' && raw.reason) inst.reason = raw.reason;
  return inst;
}

/** One stored element → an instance, or the reason it is kept as foreign. */
function readOne(raw: unknown): BlockInstance | ForeignBlock {
  if (!isObj(raw)) return { raw, why: 'unreadable' };
  const id = typeof raw.id === 'string' && raw.id ? raw.id : undefined;
  const def = typeof raw.kind === 'string' ? blockKind(raw.kind) : undefined;
  if (!def || def.storage.in !== 'blocks') return { raw, why: 'unknown-kind', id };
  // WP13 (re-scoped 2026-10-25): a kind nothing applies yet ("Change an answer", "Edit a list": `applies: 'not-yet'`)
  // comes after the record rebuild. Only a newer app writes one, so it is a newer app's block: kept as it is, read
  // as nothing, never a working tweak (no switch, no editor, refused by the write door).
  if (def.applies === 'not-yet') return { raw, why: 'newer-version', id };
  const v = typeof raw.v === 'number' ? raw.v : NaN;
  if (v > def.version) return { raw, why: 'newer-version', id };
  // Version 1 is the first: an older version cannot exist yet. When a kind bumps its version, its
  // read-time migration goes HERE (spec item 3: migrate on read only, never write back on load).
  if (!(v === def.version) || !id) return { raw, why: 'unreadable', id };
  // Tweaks phase 2 (C3): a choice kind is read by its own field list, never the number branch below.
  if (CHOICE_FIELDS[def.id]) return readChoice(raw, def, id, v);
  if (typeof raw.target !== 'string' || typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return { raw, why: 'unreadable', id };
  if (!('aspect' in def.accepts)) return { raw, why: 'unreadable', id };
  const target = targetDefFor(raw.target, def.accepts.aspect);
  // A target this app does not know is not a reason to drop the block (decision 13: shown broken).
  if (target && !def.accepts.kinds.includes(target.kind)) return { raw, why: 'unreadable', id };
  if (raw.bonusType != null && !BONUS_TYPES.includes(raw.bonusType as string)) return { raw, why: 'unreadable', id };
  const inst: BlockInstance = {
    kind: def.id,
    version: v,
    key: `blocks:${id}`,
    source: { kind: 'tweak', id: `blocks:${id}` },
    target: raw.target,
    value: raw.value,
    on: raw.on !== false,
  };
  if (raw.bonusType) inst.bonusType = raw.bonusType as BlockInstance['bonusType'];
  if (typeof raw.reason === 'string' && raw.reason) inst.reason = raw.reason;
  if (typeof raw.from === 'number' && raw.from > 1) inst.gate = { startLevel: raw.from };
  if (typeof raw.baseline === 'number') inst.params = { baseline: raw.baseline };
  if (!target) inst.broken = `"${raw.target}" is not a statistic this app knows`;
  return inst;
}

const isInstance = (x: BlockInstance | ForeignBlock): x is BlockInstance => 'kind' in x;

/** `overrides.blocks` → the instances this app understands, and everything else, kept. */
export function parseStoredBlocks(list: unknown): { known: BlockInstance[]; foreign: ForeignBlock[] } {
  const known: BlockInstance[] = [];
  const foreign: ForeignBlock[] = [];
  if (list === undefined) return { known, foreign };
  // A value that is not a list was written by something this app does not know: kept whole.
  if (!Array.isArray(list)) return { known, foreign: [{ raw: list, why: 'unreadable' }] };
  const seen = new Set<string>();
  for (const raw of list) {
    const r = readOne(raw);
    // A second element with an id already read is kept, not merged: two elements, one key, is
    // something a merge produced, and only the player may decide which one goes.
    if (isInstance(r) && !seen.has(r.key)) {
      seen.add(r.key);
      known.push(r);
    } else foreign.push(isInstance(r) ? { raw, why: 'unreadable', id: r.key.slice('blocks:'.length) } : r);
  }
  return { known, foreign };
}

/**
 * Write edits back into `overrides.blocks`, splicing BY ID.
 *
 * Every element of `prev` stays, in its place, as the same object — unless it is a block this app
 * reads AND its id is in `upsert` (edited there) or `removeIds` (left out). An edited element keeps
 * every field this version does not know (a newer app's field survives an older app's edit); the
 * fields it knows come from the upsert, so a field left out of the upsert is cleared. A foreign element
 * is never replaced or removed; an edit aimed at one is returned in `refused`. New ids are appended.
 * A `prev` that is not a list (and not absent) is returned unchanged, with every edit refused.
 */
export function writeStoredBlocks(
  prev: unknown,
  changes: { upsert?: StoredBlock[]; removeIds?: string[] },
): { list: unknown; refused: string[] } {
  if (prev !== undefined && !Array.isArray(prev)) {
    return { list: prev, refused: [...new Set([...(changes.upsert ?? []).map((b) => b.id), ...(changes.removeIds ?? [])])] };
  }
  const before = prev ?? [];
  const upsert = new Map((changes.upsert ?? []).map((b) => [b.id, b]));
  const remove = new Set(changes.removeIds ?? []);
  const refused: string[] = [];
  const done = new Set<string>();
  const list: unknown[] = [];
  for (const raw of before) {
    const r = readOne(raw);
    const id = isInstance(r) ? r.key.slice('blocks:'.length) : r.id;
    if (!id || (!upsert.has(id) && !remove.has(id))) {
      list.push(raw);
      continue;
    }
    if (!isInstance(r) || done.has(id)) {
      // Foreign, or a duplicate id: kept as it is.
      if (!refused.includes(id)) refused.push(id);
      list.push(raw);
      continue;
    }
    done.add(id);
    if (remove.has(id)) continue;
    // Per kind (C3): the fields the stored kind and the edited kind know come from the upsert; every other
    // field (a newer app's) is carried over.
    const known = [knownFieldsOf((raw as Record<string, unknown>).kind), knownFieldsOf(upsert.get(id)!.kind)];
    const kept = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k]) => !known.some((s) => s.has(k))));
    list.push({ ...kept, ...upsert.get(id) });
  }
  for (const [id, b] of upsert) if (!done.has(id) && !refused.includes(id) && !before.some((raw) => isObj(raw) && raw.id === id)) list.push(b);
  return { list, refused };
}

/* ─────────────────────────────── today's Overrides keys, read as blocks ─────────────────────────────── */

const RANK_SET = new Set<string>(PROFICIENCY_RANKS);

/** A proficiencies key → the target key, the same split as build.ts's override loop: `perception` and
 *  `classDc` are their own stats, a save, weapon or armor track is that rank track, anything else is a
 *  skill or a Lore. A Lore keys through `loreKey` (spec item 11), so a stored `lore:Sailing Lore` is the
 *  target `skill:lore:sailing` — the same row as a background's Sailing Lore; null when the subject is
 *  nothing but the word "Lore".
 *  ONLY for a rank block ('rank.atLeast' / 'rank.exactly', `rankBlock`): an old 'rank.legacySet' entry is
 *  still written by build.ts's untouched `=` loop under its RAW key (`lore:Sailing Lore`, even `lore:Lore`),
 *  so its target stays the raw `skill:<key>` it really changes and it is never called broken for it. Part
 *  B's read-time migration (legacySet → atLeast / exactly) is what moves such a row onto the loreKey row.
 *  The write door compares rank tweaks by `proficiencyTarget(key, true)`: a raw `lore:Sailing Lore` and a
 *  canonical `lore:sailing` are the same row, so a second rank tweak on it is refused. */
export function proficiencyTarget(key: string, rankBlock: boolean): string | null {
  if (key === 'perception') return 'perception';
  if (key === 'classDc') return 'class-dc';
  if (['fortitude', 'reflex', 'will'].includes(key)) return `save:${key}`;
  if (['unarmed', 'simple', 'martial', 'advanced'].includes(key)) return `weapon:${key}`;
  if (['unarmored', 'light', 'medium', 'heavy'].includes(key)) return `armor:${key}`;
  if (rankBlock && key.startsWith('lore:')) {
    const lore = loreKey(key);
    return lore ? `skill:${lore}` : null;
  }
  return `skill:${key}`;
}

/** Keys repeat only when one list holds the same entry twice (the same feat given twice at one level):
 *  `~2`, `~3`. Everything else keys by what the entry IS, not by its position, so deleting one entry
 *  never moves another entry's meta onto it (checker C15). */
function keyer() {
  const used = new Map<string, number>();
  return (base: string) => {
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  };
}

/** Today's 10 Overrides keys (the registry's `storage.key` values). */
export type LegacyList =
  | 'attributes'
  | 'proficiencies'
  | 'maxHp'
  | 'addedFeats'
  | 'addedFeatures'
  | 'addedLanguages'
  | 'addedSpells'
  | 'removedFeatIds'
  | 'allowedFeats'
  | 'contentEdits';

/**
 * WHERE one old-key entry is stored, and the two strings its meta hangs on — recorded by the same walk
 * that reads the entries (`readLegacyBlocks`), so a writer never builds a key by hand (plan B, 5.2).
 *   - `list`: the old key it lives in;
 *   - `index`: its place there — the array index for a list key (`addedFeats` …), the object key for
 *     `attributes` / `proficiencies` (the ability / the track, raw: `lore:Sailing Lore`), `<bucket>/<id>`
 *     for `contentEdits`, 0 for `maxHp`;
 *   - `key`: its instance key (`addedFeats:fleet@3`, `~2` for a true repeat) = its `overrides.meta` key;
 *   - `of`: what the entry IS (rank, value, `id@level` …) — a meta whose `of` differs is stale.
 */
export interface LegacyEntry {
  list: LegacyList;
  index: number | string;
  key: string;
  of: string;
  /** The registry kind it reads as (a rank entry's kind follows its meta `mode`). */
  kind: string;
}

/**
 * Today's 10 Overrides keys → block instances (kinds per the registry's `storage.key`). A stored entry
 * this app cannot read is still listed, marked `broken`, never skipped (decision 13).
 *
 * THE ONE WALK over those keys: `sink` (used by `legacyEntries` only) receives, in the same order, where
 * each entry is stored — so the instance keys and the writers' keys can never disagree.
 */
export function readLegacyBlocks(ov: BuildOverrides | undefined, sink?: LegacyEntry[]): BlockInstance[] {
  const instances: BlockInstance[] = [];
  const entries: LegacyEntry[] = sink ?? [];
  if (!ov) return instances;
  const meta = isObj(ov.meta) ? (ov.meta as Record<string, TweakMeta>) : {};
  const keyOf = keyer();
  /** `of` is what the entry is (its rank, value or id@level): meta written for something else is stale. */
  const push = (at: { list: LegacyList; index: number | string }, kind: string, base: string, of: string, more: Partial<BlockInstance>) => {
    const key = keyOf(base);
    const inst: BlockInstance = { kind, version: 1, key, source: { kind: 'tweak', id: key }, on: true, ...more };
    const m = meta[key];
    if (m && (m.of == null || m.of === of)) {
      if (m.on === false) inst.on = false;
      if (m.reason) inst.reason = m.reason;
      if (typeof m.from === 'number' && m.from > 1) inst.gate = { ...inst.gate, startLevel: m.from };
      if (typeof m.baseline === 'number') inst.params = { ...inst.params, baseline: m.baseline };
      // Plan B, B11: stamped by an import (spec 2: ignores the master switch), or moved from the old
      // Overrides by the Builder-open stamp ("Moved from Overrides", decision 19; B26).
      if (m.source === 'import') inst.imported = true;
      if (m.moved === true) inst.moved = true;
    }
    instances.push(inst);
    entries.push({ list: at.list, index: at.index, key, of, kind });
  };
  const list = <T,>(x: T[] | undefined): T[] => (Array.isArray(x) ? x : []);

  for (const [k, v] of Object.entries(isObj(ov.attributes) ? ov.attributes : {})) {
    const ok = typeof v === 'number' && Number.isFinite(v);
    push({ list: 'attributes', index: k }, 'attribute.set', `attributes:${k}`, String(v), { target: `score:${k}`, ...(ok ? { value: v } : { broken: `the score "${String(v)}" is not a number` }) });
  }
  for (const [k, r] of Object.entries(isObj(ov.proficiencies) ? ov.proficiencies : {})) {
    const m = meta[`proficiencies:${k}`];
    const mode = m && (m.of == null || m.of === r) ? m.mode : undefined;
    const kind = mode === 'atLeast' ? 'rank.atLeast' : mode === 'exactly' ? 'rank.exactly' : 'rank.legacySet';
    const target = proficiencyTarget(k, kind !== 'rank.legacySet');
    const broken = !RANK_SET.has(r) ? `the rank "${String(r)}" is not a proficiency rank` : !target ? `"${k}" names no Lore subject` : undefined;
    // A mode a NEWER app wrote ("at most" …): kept as it is and read as an old entry (today's `=`), never
    // sorted or re-stamped, and listed read-only (registry `BlockInstance.newer`; plan B WP6).
    const newer = mode != null && kind === 'rank.legacySet' ? `a rank kind "${String(mode)}" this version does not know` : undefined;
    push({ list: 'proficiencies', index: k }, kind, `proficiencies:${k}`, String(r), { ...(target ? { target } : {}), ...(RANK_SET.has(r) ? { rank: r } : {}), ...(broken ? { broken } : {}), ...(newer ? { newer } : {}) });
  }
  // build.ts reads `maxHp == null` as "no set", so a stored null is no tweak at all.
  if (ov.maxHp != null) {
    const ok = typeof ov.maxHp === 'number' && Number.isFinite(ov.maxHp);
    push({ list: 'maxHp', index: 0 }, 'number.setMaxHp', 'maxHp:max-hp', String(ov.maxHp), { target: 'max-hp', ...(ok ? { value: ov.maxHp } : { broken: `"${String(ov.maxHp)}" is not a number` }) });
  }
  list(ov.addedFeats).forEach((f, i) => {
    const id = `${f?.featId}@${f?.level}`;
    push({ list: 'addedFeats', index: i }, 'grant.feat', `addedFeats:${id}`, id, { record: f?.featId, params: { level: f?.level, category: f?.category }, ...(f?.featId ? {} : { broken: 'no feat named' }) });
  });
  list(ov.addedFeatures).forEach((f, i) => {
    const id = `${f?.featureId}@${f?.level}`;
    push({ list: 'addedFeatures', index: i }, 'grant.classFeature', `addedFeatures:${id}`, id, { record: f?.featureId, params: { level: f?.level }, ...(f?.featureId ? {} : { broken: 'no class feature named' }) });
  });
  list(ov.addedLanguages).forEach((id, i) => push({ list: 'addedLanguages', index: i }, 'grant.language', `addedLanguages:${id}`, String(id), { record: id }));
  list(ov.addedSpells).forEach((s, i) => {
    const id = `${s?.spellId}@${s?.rank}`;
    push({ list: 'addedSpells', index: i }, 'grant.spell', `addedSpells:${id}`, id, { record: s?.spellId, params: { rank: s?.rank }, ...(s?.spellId ? {} : { broken: 'no spell named' }) });
  });
  list(ov.removedFeatIds).forEach((id, i) => push({ list: 'removedFeatIds', index: i }, 'remove.feat', `removedFeatIds:${id}`, String(id), { record: id }));
  list(ov.allowedFeats).forEach((id, i) => push({ list: 'allowedFeats', index: i }, 'choice.allowAnyway', `allowedFeats:${id}`, String(id), { record: id }));
  for (const id of Object.keys(ov.contentEdits?.feats ?? {})) push({ list: 'contentEdits', index: `feats/${id}` }, 'text.edit', `contentEdits:feats/${id}`, `feats/${id}`, { record: `feats/${id}` });
  for (const id of Object.keys(ov.contentEdits?.classFeatures ?? {})) push({ list: 'contentEdits', index: `classFeatures/${id}` }, 'text.edit', `contentEdits:classFeatures/${id}`, `classFeatures/${id}`, { record: `classFeatures/${id}` });
  return instances;
}

/** Where every old-key entry is stored, keyed EXACTLY as `readLegacyBlocks` keys it (the same walk), in
 *  the same order. The stamps, the import marks and the writer's meta moves use this — never a key built
 *  by hand (checker C15: keys name the entry, not its position). */
export function legacyEntries(ov: BuildOverrides | undefined): LegacyEntry[] {
  const entries: LegacyEntry[] = [];
  readLegacyBlocks(ov, entries);
  return entries;
}

/**
 * The content record ids the stored choice blocks name (Tweaks phase 2, C32) — paused ones and Tweaks switched
 * off included, as for the old keys (storage, not a liveness question): turning a book off must never drop a
 * record a tweak points at without saying so. A block's `record` (a heritage, background, deity, subclass
 * option, spell or feat) and a subclass's `classId`; never an answer value. Blocks this version cannot read
 * (WP13: a skill increase taken anyway, a removed class-choice place, a changed answer or an edited list among
 * them) are not looked into (their fields mean what a newer app says). `kind` and `id` say which block names
 * each. Takes the build (or character) itself, so a caller outside the Tweaks home files reads no `overrides`
 * of its own.
 */
export function choiceBlockRecordIds(host: { overrides?: BuildOverrides } | undefined): { id: string; blockId: string; kind: string }[] {
  const out: { id: string; blockId: string; kind: string }[] = [];
  for (const b of parseStoredBlocks(host?.overrides?.blocks).known) {
    if (!CHOICE_FIELDS[b.kind]) continue;
    const blockId = b.key.slice('blocks:'.length);
    const p = b.params ?? {};
    if (typeof p.record === 'string') out.push({ id: p.record, blockId, kind: b.kind });
    if (typeof p.classId === 'string') out.push({ id: p.classId, blockId, kind: b.kind });
  }
  return out;
}

/** Every tweak a character carries: the old keys first, then `overrides.blocks`; plus what is kept unread. */
export function readTweaks(ov: BuildOverrides | undefined): { instances: BlockInstance[]; foreign: ForeignBlock[] } {
  const { known, foreign } = parseStoredBlocks(ov?.blocks);
  return { instances: [...readLegacyBlocks(ov), ...known], foreign };
}

/* ─────────────────────────────── the master switch, and the feats given ─────────────────────────────── */

/**
 * The Tweaks master switch, as spec item 2 reads it — the ONE copy (decision D7): the number and rank
 * blocks (active.ts) and the given feats (`activeGivenFeats`) all ask here.
 *
 * "ON by read": a character whose `overrides.v` is absent (or not a number ≥ 2) has never been saved by a
 * Tweaks-aware app, so its changes were always live — it reads as ON. From `overrides.v >= 2` (written by
 * part B's first real Builder save, together with the switch) the stored `options.overridesEnabled` is
 * obeyed. No overrides at all: nothing to switch on.
 */
export function tweaksSwitchOn(h: { overrides?: BuildOverrides; options?: CharacterOptions }): boolean {
  const ov = h.overrides;
  if (!ov) return false;
  const v: unknown = ov.v;
  if (typeof v === 'number' && v >= 2) return h.options?.overridesEnabled === true;
  return true;
}

/**
 * Does the Builder show Tweaks (the page, its button, "Take anyway")? — the ONE UI reader (plan B, B14).
 * With overrides stored it is the master switch itself (`tweaksSwitchOn`: an old character reads ON); with
 * none, the Options toggle alone, so a brand-new character can switch Tweaks on before it has a tweak.
 * The engine never asks this: with no overrides there is nothing to apply.
 */
export function tweaksPageOn(build: { overrides?: BuildOverrides; options?: CharacterOptions }): boolean {
  return build.overrides ? tweaksSwitchOn(build) : build.options?.overridesEnabled === true;
}

/**
 * Is one stored tweak ON — the ONE definition (plan B, WP2; spec items 2 and 4): it is not paused (`on`),
 * not broken (decision 13: listed, never applied), and the master switch is on — unless an import stamped
 * it (`meta.source: 'import'`, spec 2: an import leftover was the character's own content before Tweaks
 * existed, so it ignores the master switch; its own on/off still counts). The start level is the other
 * half of "live" (`entryLive`, blocks/active.ts). Lives here beside the switch so the given feats
 * (`activeGivenFeats`) read the same rule; active.ts re-exports it.
 */
export function entryOn(inst: BlockInstance, switchOn: boolean): boolean {
  return inst.on && !inst.broken && (switchOn || inst.imported === true);
}

/** The level an old-key entry (or a stored number block) starts at: its meta `from` / block `from`; for a
 *  given feat or class feature the larger of that and its stored level (decision D6). 1 = from the start. */
export function legacyStartLevel(b: BlockInstance): number {
  const from = b.gate?.startLevel ?? 1;
  if (b.kind !== 'grant.feat' && b.kind !== 'grant.classFeature') return from;
  const stored = Number(b.params?.level);
  return Math.max(Number.isFinite(stored) ? stored : 1, from);
}

/**
 * The overrides AS OF a level (spec 9, plan B open point 5): a pure COPY in which every entry or block
 * that starts above `level` is paused (`on: false`, with its `of` for an old-key entry), given feats and
 * class features held only from a later level included. Foreign blocks (unknown kind, newer version,
 * unreadable, a repeated id) are never touched. `ov` itself is returned when nothing starts later, so a
 * memo keyed on it stays warm. Never mutates `ov`; never touches `v`. For Builder previews only (the
 * viewed level) — never stored.
 */
export function overridesAsOf(ov: BuildOverrides | undefined, level: number): BuildOverrides | undefined {
  if (!ov) return ov;
  const meta = isObj(ov.meta) ? (ov.meta as Record<string, TweakMeta>) : {};
  let nextMeta: Record<string, TweakMeta> | undefined;
  const entries: LegacyEntry[] = [];
  const legacy = readLegacyBlocks(ov, entries);
  for (let i = 0; i < legacy.length; i++) {
    const b = legacy[i];
    if (!b.on || b.broken || legacyStartLevel(b) <= level) continue;
    const e = entries[i];
    const m = meta[e.key];
    nextMeta ??= { ...meta };
    nextMeta[e.key] = { ...(m && (m.of == null || m.of === e.of) ? m : {}), of: e.of, on: false };
  }
  let nextBlocks: unknown[] | undefined;
  if (Array.isArray(ov.blocks)) {
    const seen = new Set<string>();
    for (let i = 0; i < ov.blocks.length; i++) {
      const raw = ov.blocks[i];
      const r = readOne(raw);
      if (!isInstance(r) || seen.has(r.key)) continue;
      seen.add(r.key);
      if (!r.on || r.broken || (r.gate?.startLevel ?? 1) <= level) continue;
      nextBlocks ??= [...ov.blocks];
      nextBlocks[i] = { ...(raw as Record<string, unknown>), on: false };
    }
  }
  if (!nextMeta && !nextBlocks) return ov;
  return { ...ov, ...(nextMeta ? { meta: nextMeta } : {}), ...(nextBlocks ? { blocks: nextBlocks } : {}) };
}

/** One feat a character is GIVEN through Tweaks (`overrides.addedFeats`), as the build reads it. */
export interface GivenFeat {
  featId: string;
  /** The level it is held from: the stored level (1 when it is not a number), raised to its start level
   *  (`meta.from`) when that is later — decision D6. */
  level: number;
  category?: FeatCategory;
  /** Its instance key, `addedFeats:<featId>@<level>[~n]` — where its reason / on-off / start level live. */
  key: string;
  /** Stamped by an import (`meta.source: 'import'`): held while the master switch is off (spec 2). */
  imported?: true;
}

/** Read once per `overrides` object, and again only when its `addedFeats` or `meta` is a new value (every
 *  edit writes a new list / map), so the walkers that ask per feat slot never pay for a re-read. Holds
 *  BOTH answers of the switch — every entry on (`list`) and the import-stamped ones alone (`importedOnly`) —
 *  never a switch-dependent one: `activeGivenFeats` reads the switch after the lookup, on every call. */
const GIVEN = new WeakMap<object, { addedFeats: unknown; meta: unknown; list: readonly GivenFeat[]; importedOnly: readonly GivenFeat[] }>();

function readGivenFeats(ov: BuildOverrides): { list: GivenFeat[]; importedOnly: GivenFeat[] } {
  const list: GivenFeat[] = [];
  const importedOnly: GivenFeat[] = [];
  // The one reader of the stored key (`readLegacyBlocks`), fed only the two fields a given feat reads.
  for (const b of readLegacyBlocks({ addedFeats: ov.addedFeats, meta: ov.meta })) {
    // `entryOn(b, true)`: on and not broken (the switch is applied by the caller, after the cache).
    if (b.kind !== 'grant.feat' || !entryOn(b, true) || typeof b.record !== 'string' || !b.record) continue;
    const category = b.params?.category as FeatCategory | undefined;
    const g: GivenFeat = { featId: b.record, level: legacyStartLevel(b), ...(category ? { category } : {}), key: b.key, ...(b.imported ? { imported: true as const } : {}) };
    list.push(g);
    if (entryOn(b, false)) importedOnly.push(g);
  }
  return { list, importedOnly };
}

/**
 * The feats given through Tweaks that are ACTIVE: `entryOn` — on (not paused), not broken (a feat named),
 * and the master switch on, or stamped by an import (spec 2: an import leftover stays held while Tweaks is
 * off) — in `addedFeats` order. NO level here, on purpose (plan B, WP2): the start level is already folded
 * into `GivenFeat.level` (max(stored level, meta.from), D6) and every caller gates by level
 * (src/rules/heldFeats.ts `heldFeatSlots` asks level, content and removal for every walker). Read-only:
 * never edit the list returned, it is shared.
 */
export function activeGivenFeats(ov: BuildOverrides | undefined, options?: CharacterOptions): readonly GivenFeat[] {
  if (!ov || !Array.isArray(ov.addedFeats) || !ov.addedFeats.length) return [];
  let hit = GIVEN.get(ov);
  if (!hit || hit.addedFeats !== ov.addedFeats || hit.meta !== ov.meta) {
    hit = { addedFeats: ov.addedFeats, meta: ov.meta, ...readGivenFeats(ov) };
    GIVEN.set(ov, hit);
  }
  // The switch is read AFTER the cache, on every call: flipping `overridesEnabled` with the SAME overrides
  // object must change the answer (a cache holding the switch's answer would serve the old one).
  return tweaksSwitchOn({ overrides: ov, options }) ? hit.list : hit.importedOnly;
}
