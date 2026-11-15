/*
 * THE WRITE DOOR — every Tweaks write goes through here (plan B section 5, docs/overrides-redesign.md
 * "Building blocks" items 1, 2 and 13). Pure: a function of the stored overrides and the write asked for,
 * returning a NEW overrides object (or `undefined` when nothing is left). Callers apply the result with
 * `actions.patch({ overrides })` (and `options` for the switch).
 *
 * The rules it keeps (each one a test in test/tweaks-write.test.ts):
 *   - Old keys keep their value shapes (spec 1): a rank is a rank string in `proficiencies` (a new Lore
 *     under its canonical `loreKey` key), a set is a number in `attributes` / `maxHp`, a given feat is
 *     `{ featId, level, category }`. Reason / on-off / start level / mode / baseline go in
 *     `overrides.meta['<key>:<id>']`, and EVERY meta it writes carries `of` = the entry's identity exactly
 *     as `readLegacyBlocks` computes it.
 *   - META FOLLOWS THE ENTRY, NOT THE KEY: an edit computes `legacyEntries` before and after with an index
 *     map and moves each entry's meta to its new key (`addedFeats:fleet@3` → `@5`; a `~2` twin whose key
 *     shifts keeps ITS meta). Keys are never built by hand.
 *   - Remove deletes the entry AND its meta, so a stale `{ on: false }` never re-attaches when the same
 *     thing is added again; an add likewise clears whatever meta sat at the new entry's key. Remove asks
 *     nothing (decision 20).
 *   - The first `update` of an entry drops `moved` (B11) and folds an old `meta.from` of a given feat /
 *     class feature into its stored level (B10). `setOn` keeps `moved` (pausing is not re-authoring, B26).
 *   - Every entry an add, update, repoint or setOn writes keeps a meta, `{ of }` at the least (WP10): an
 *     entry with NO meta is an old un-stamped one, which the Save stamp marks "Moved from Overrides".
 *   - UNKNOWN ≠ EMPTY: `overrides.blocks` only through `writeStoredBlocks` (an edit aimed at a foreign
 *     block — unknown kind, newer version, unreadable — is refused and changes nothing); unknown top-level
 *     keys inside `overrides`, unknown meta keys and unknown fields of a stored element are kept by spread.
 *     An old key (or a contentEdits bucket) stored in a shape this version cannot read — a map where a list
 *     belongs, a string, … — is never replaced: a write that would touch it is refused (so is a meta that
 *     is not a map).
 *   - B25: a start level only on a kind whose editor has one (remove, "take anyway", text edit: refused).
 *   - An `update` that leaves a text edit holding no field at all (its name and description typed back to
 *     the book's, nothing else stored on it) removes the entry and its meta (WP7): no empty edit stays. An
 *     `update` of a text edit stored as something other than a map is refused (it would be replaced whole).
 *   - `v` (B27): only `setTweaksSwitch`, the open / save stamp (save.ts) and `writeTweak` write it, always as
 *     `Math.max(2, stored v)` — a newer app's `v: 3` is never lowered. `writeTweak` writes it only when the
 *     host's switch already reads from the option (stored `v ≥ 2`, or `options.overridesEnabled === true`),
 *     so no write but `setTweaksSwitch` changes what `tweaksSwitchOn` reads. `markImported`, `dropEntries`
 *     and `pruneOverrides` never add or change it: they run outside the Builder (the WG import, the reverse
 *     build, `removeChosenIds`), where a `v: 2` without `overridesEnabled: true` would pause every old entry.
 *   - An overrides object holding nothing but `v` (and empty meta) becomes `undefined` (B15).
 *   - Tweaks phase 2: a choice block (stored.ts CHOICE_FIELDS) is written only in a shape its own reader reads
 *     (`choiceProblem`), with no comma in an answer and a Lore keyed (C27), never with a start level (C31); a
 *     block id is `t<n>_<4 random>` (C4). `writeChoiceTweak` writes the tweak and the pick it allows as one
 *     build (one Ctrl+Z step); nothing here runs on load or on Builder open (C36).
 */
import { loreKey } from '../loreKey';
import { SLOT_PREFIX, keyHoldsSlot } from '../slotKey';
import type { BuildOverrides, CharacterOptions, FeatCategory, ProficiencyRank, TweakMeta } from '../types';
import { PROFICIENCY_RANKS } from '../types';
import { FEAT_PLACE_CATEGORIES, blockKind, type BlockInstance, type BlockKindDef } from './registry';
import {
  CHOICE_FIELDS,
  COMMA_REFUSAL,
  answerHasComma,
  legacyEntries,
  parseStoredBlocks,
  proficiencyTarget,
  readLegacyBlocks,
  writeStoredBlocks,
  type LegacyEntry,
  type LegacyList,
  type NumberStoredBlock,
  type StoredBlock,
} from './stored';
import { parseTargetRef, targetDefFor } from './targets';

/** What an editor hands the door: the fields a kind's parts produce. A field absent from an `update`
 *  draft is left as it is; present with `undefined` (or an empty reason / text) clears it. */
export interface TweakDraft {
  kind: string;
  /** A target key (targets.ts) — number, rank and score kinds. */
  target?: string;
  /** A record id, as the instance reads it: a bare feat / feature / spell / language id, or
   *  `feats/<id>` / `classFeatures/<id>` for a text edit. */
  record?: string;
  value?: number;
  rank?: ProficiencyRank;
  bonusType?: 'status' | 'circumstance' | 'item';
  /** grant.feat / grant.classFeature: the STORED level (B10 — the level part edits it; no `meta.from`). */
  level?: number;
  /** grant.feat: the record's category (the stored shape needs it; the editor reads it off the record). */
  category?: FeatCategory;
  /** grant.spell: the rank it is added at. */
  spellRank?: number;
  text?: { name?: string; description?: string };
  /** The start level, for kinds with no stored level of their own. */
  from?: number;
  reason?: string;
  on?: boolean;
  /** Tweaks phase 2: a choice kind's own stored fields (stored.ts CHOICE_FIELDS: `picker`, `place`, `level`,
   *  `category`, `rule`, `times`, `value` …); `record` may come here or as `record` above.
   *  In an update, a field given `undefined` is cleared. A choice place's level is its `level` FIELD here —
   *  the top-level `level` / `from` are start levels, which a choice kind has none of (C31). */
  fields?: Record<string, unknown>;
}

export type TweakWrite =
  /** `id`: the block id to store, for a retry of this very add on a newer build (TweaksPage; F5). Used only for
   *  a kind stored in `blocks`, only when it is a `t<n>_xxxx` id no stored element holds; otherwise one is minted. */
  | { op: 'add'; draft: TweakDraft; baseline?: number; id?: string }
  | { op: 'update'; key: string; draft: Partial<TweakDraft>; baseline?: number }
  | { op: 'setOn'; key: string; on: boolean }
  | { op: 'remove'; key: string }
  /** `category`: a given feat re-pointed at another feat needs that feat's category (refused without). */
  | { op: 'repoint'; key: string; record?: string; target?: string; category?: FeatCategory };

export interface TweakHost {
  overrides?: BuildOverrides;
  options?: CharacterOptions;
}

export interface TweakWriteResult {
  overrides: BuildOverrides | undefined;
  /** Set when nothing was written, with the reason; `overrides` is then the host's own object. */
  refused?: string;
  /** `writeTweak`: the block id an add stored in `blocks`. */
  id?: string;
  /** `writeTweaks`: per write, in order, the block id each add stored in `blocks` (undefined for every other
   *  write) — what a retry pins (`pinAddedIds`). Absent when no write stored a new block. */
  ids?: (string | undefined)[];
}

type Meta = Record<string, TweakMeta>;
type Raw = Record<string, unknown>;
const isObj = (x: unknown): x is Raw => !!x && typeof x === 'object' && !Array.isArray(x);
const RANKS = new Set<string>(PROFICIENCY_RANKS);
const BONUS_TYPES = ['status', 'circumstance', 'item'];
/** The list keys whose entries carry their own start level (B10). */
const LEVELLED: LegacyList[] = ['addedFeats', 'addedFeatures'];

/* ─────────────────────────────── `v`, the empty shell, pruning ─────────────────────────────── */

/** The `v` a write stamps: 2, or a newer app's larger number kept (B27). */
function stampedV(ov: BuildOverrides | undefined): number {
  const v: unknown = ov?.v;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(2, v) : 2;
}

/** Does the host's switch already read the stored option (so writing `v` changes nothing it reads)? */
function readsOption(h: TweakHost): boolean {
  const v: unknown = h.overrides?.v;
  return (typeof v === 'number' && v >= 2) || h.options?.overridesEnabled === true;
}

/** A meta map holding no entry with a field set. A meta that is not a map was written by something this
 *  app does not know: never empty. */
function metaEmpty(m: unknown): boolean {
  if (m === undefined) return true;
  if (!isObj(m)) return false;
  return Object.values(m).every((x) => isObj(x) && Object.values(x).every((y) => y === undefined));
}

/** B15: nothing but `v` (and empty meta) — a character with no tweak at all. */
function isEmptyShell(ov: object): boolean {
  return Object.entries(ov).every(([k, x]) => x === undefined || k === 'v' || (k === 'meta' && metaEmpty(x)));
}

/**
 * The overrides object the old Overrides card saved: `prev` with `next` laid over it, every EMPTY field
 * dropped (so an emptied override clears to absent), and `undefined` when nothing is left — nothing but
 * `v` and empty meta counts as nothing (B15). Never adds or changes `v` (B27).
 *
 * Generic over the keys on purpose. It used to rebuild the object one hand-written line per key, and
 * there was no `maxHp` line, so Overrides → Set maximum HP looked like it worked and saved nothing
 * (phone audit D5). A key added to BuildOverrides later is kept without anyone remembering to add it;
 * test/overrides-write.test.tsx holds a sample of EVERY BuildOverrides key, read off types.ts.
 * (Moved here from src/builder/shared.tsx, plan B WP1. The card retired in WP7, and no screen calls this
 * now: every Tweaks editor writes through `writeTweak`. Kept with its every-key test for the cleanup to decide.)
 */
export function pruneOverrides(prev: BuildOverrides, next: Partial<BuildOverrides>): BuildOverrides | undefined {
  const merged: Record<string, unknown> = { ...prev, ...next };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) if (overrideHasContent(v, 1)) out[k] = v;
  return Object.keys(out).length && !isEmptyShell(out) ? (out as BuildOverrides) : undefined;
}

/** Empty = absent, not a finite number, an empty list, or an object holding nothing. `depth` 1 looks one
 *  level into an object's values, which is the shape the old per-key checks had: contentEdits
 *  `{ feats: {} }` is empty, `{ feats: { x: {} } }` (an edit just started) is not; attributes `{}` is
 *  empty, `{ str: 10 }` is not. */
export function overrideHasContent(v: unknown, depth: number): boolean {
  if (v == null) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some((x) => x !== undefined && (depth > 0 ? overrideHasContent(x, depth - 1) : true));
  return true;
}

/* ─────────────────────────────── the master switch ─────────────────────────────── */

/**
 * Switch Tweaks on or off — the ONE place the switch is written. `v` and `overridesEnabled` land in the
 * SAME result (a `v: 2` alone would read OFF; the option alone is ignored while `v` is absent). With
 * overrides stored it always returns a NEW overrides object, so every memo keyed on `overrides` refreshes;
 * with none, only the option (a brand-new character may switch Tweaks on before its first tweak).
 */
export function setTweaksSwitch(host: TweakHost, on: boolean): { overrides?: BuildOverrides; options: CharacterOptions } {
  const options: CharacterOptions = { ...(host.options ?? {}), overridesEnabled: on };
  if (!host.overrides) return { options };
  return { overrides: { ...host.overrides, v: stampedV(host.overrides) }, options };
}

/* ─────────────────────────────── ids, meta, the generic list rewrite ─────────────────────────────── */

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A new block id (Tweaks phase 2, C4): `t<n>_<4 random base-36>`, with `n` above every `t<n>` and `t<n>_xxxx`
 * stored, foreign elements included. The random tail is what keeps two tabs apart: both minting `t5` were
 * fused by the roster merge (src/data/rosterMerge.ts merges arrays BY id) into one hybrid block. An older app
 * mints only a plain `t<n>`, which can never equal a `t<n>_xxxx`. `rand` is for tests.
 */
export function newBlockId(ov: BuildOverrides | undefined, rand: () => number = Math.random): string {
  let max = 0;
  const list: unknown = ov?.blocks;
  if (Array.isArray(list)) {
    for (const raw of list) {
      const id = isObj(raw) ? raw.id : undefined;
      const m = typeof id === 'string' ? /^t(\d+)(?:_[a-z0-9]+)?$/.exec(id) : null;
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  let tail = '';
  for (let i = 0; i < 4; i++) tail += BASE36[Math.min(35, Math.floor(rand() * 36))];
  return `t${max + 1}_${tail}`;
}

const metaOf = (ov: BuildOverrides): Meta => (isObj(ov.meta) ? (ov.meta as Meta) : {});
const metaUnreadable = (ov: BuildOverrides): boolean => ov.meta !== undefined && !isObj(ov.meta);

/** A meta object without its undefined fields. A meta holding only `of` STAYS (WP10 fix round 1): it is what
 *  marks an entry the player made or edited here. An entry with no meta at all reads as an old Overrides
 *  entry never stamped, and the Save stamp (save.ts `stampTweaksSave`, plan 3.3 step 3) marks every such
 *  entry "Moved from Overrides" — a feat given on the Tweaks page a minute ago included (the browser test,
 *  step 9). Plan 5.2's "meta reduced to `{ of }` alone is dropped" cannot hold beside 3.3; `of` wins. */
function compactMeta(m: TweakMeta): TweakMeta | undefined {
  const out = Object.fromEntries(Object.entries(m).filter(([, x]) => x !== undefined)) as TweakMeta;
  return Object.keys(out).length ? out : undefined;
}

/** The meta an edit starts from: the entry's own (its `of` matches), else only a stale meta's reason
 *  (its other fields belonged to another value; section 3.3). */
function baseMeta(ov: BuildOverrides, e: LegacyEntry): TweakMeta {
  const raw: unknown = metaOf(ov)[e.key];
  if (!isObj(raw)) return {};
  const m = raw as TweakMeta;
  if (m.of == null || m.of === e.of) return { ...m };
  return m.reason ? { reason: m.reason } : {};
}

const emptyValue = (v: unknown): boolean => v === undefined || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);

/**
 * Write `value` as the new content of one old key and carry every entry's meta along: the meta of each
 * entry of that key that still exists (`mapIndex` old index → new index) moves to its new key with its
 * `of` refreshed (a stale meta stays stale); the meta of a removed entry goes. `edited` is the entry the
 * write itself changed or added: its meta is the one `edited.meta` returns (none clears its key, so an
 * old meta left at that key never attaches to it); every other entry ends with exactly the meta it had
 * (an orphan sitting at a key it shifts onto is cleared). Meta keys of entries that do not exist are kept.
 */
function rewriteList(
  prev: BuildOverrides,
  list: LegacyList,
  value: unknown,
  mapIndex: (i: number | string) => number | string | undefined,
  edited?: { oldKey?: string; newIndex: number | string; meta: (of: string) => TweakMeta | undefined },
): BuildOverrides {
  const next: Raw = { ...prev };
  if (emptyValue(value)) delete next[list];
  else next[list] = value;
  const before = legacyEntries(prev).filter((e) => e.list === list);
  const after = legacyEntries(next as BuildOverrides).filter((e) => e.list === list);
  const afterAt = new Map(after.map((e) => [e.index, e]));
  const prevMeta = metaOf(prev);
  const meta: Meta = { ...prevMeta };
  const moves: [string, TweakMeta][] = [];
  for (const b of before) {
    const m = prevMeta[b.key];
    if (m === undefined) continue;
    delete meta[b.key];
    if (edited?.oldKey === b.key) continue;
    const ni = mapIndex(b.index);
    const a = ni === undefined ? undefined : afterAt.get(ni);
    if (!a) continue;
    moves.push([a.key, isObj(m) && (m.of == null || m.of === b.of) ? { ...m, of: a.of } : m]);
  }
  for (const [k, m] of moves) meta[k] = m;
  // An entry whose key shifted onto a key no entry of it had before (a `~2` twin landing on `~2` after its
  // twin moved) must not pick up an orphan meta parked there by an older app: that would pause or re-word
  // a tweak this write never touched. Every after-entry that received no moved meta has none.
  const received = new Set(moves.map(([k]) => k));
  for (const a of after) if (!received.has(a.key) && a.index !== edited?.newIndex) delete meta[a.key];
  if (edited) {
    const a = afterAt.get(edited.newIndex);
    if (a) {
      const m = edited.meta(a.of);
      if (m) meta[a.key] = m;
      else delete meta[a.key];
    }
  }
  if (Object.keys(meta).length) next.meta = meta;
  else delete next.meta;
  return next as BuildOverrides;
}

/* ─────────────────────────────── targets → stored keys ─────────────────────────────── */

/** A rank target → its `overrides.proficiencies` key (build.ts's override loop, read backwards); a Lore
 *  keys by its canonical `loreKey` (targets.ts only accepts the canonical slug). null = not a track. */
function proficiencyKeyOf(target: string | undefined, def: BlockKindDef): string | null {
  if (!target) return null;
  const t = targetDefFor(target, 'rank');
  if (!t || t.owner !== 'character' || !('aspect' in def.accepts) || !def.accepts.kinds.includes(t.kind)) return null;
  const detail = parseTargetRef(target)?.detail;
  switch (t.kind) {
    case 'perception':
      return 'perception';
    case 'class-dc':
      return 'classDc';
    case 'save':
    case 'weapon':
    case 'armor':
    case 'skill':
      return detail ?? null;
    default:
      return null;
  }
}

/** Does another stored proficiencies key (not `except`) already hold a rank for the same row as `key`? By
 *  TARGET, not by raw key: an old `lore:Sailing Lore` and a new `lore:sailing` are one row (stored.ts). */
function trackTaken(obj: Raw, key: string, except?: string): boolean {
  const t = proficiencyTarget(key, true);
  return Object.keys(obj).some((k) => k !== except && obj[k] !== undefined && (k === key || (t !== null && proficiencyTarget(k, true) === t)));
}

/** A score target → its ability (`score:str` → `str`). */
function abilityOf(target: string | undefined): string | null {
  if (!target || !targetDefFor(target, 'score')) return null;
  return parseTargetRef(target)?.detail ?? null;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const modeOf = (kind: string): TweakMeta['mode'] => (kind === 'rank.atLeast' ? 'atLeast' : kind === 'rank.exactly' ? 'exactly' : undefined);
/** `feats/<id>` | `classFeatures/<id>` → its parts. */
function textRecord(record: string | undefined): { bucket: 'feats' | 'classFeatures'; id: string } | null {
  const m = record ? /^(feats|classFeatures)\/(.+)$/.exec(record) : null;
  return m ? { bucket: m[1] as 'feats' | 'classFeatures', id: m[2] } : null;
}
/** A text edit with `text` laid over it: a name / description given empty or undefined is cleared;
 *  every other field of the stored edit (traits …) is kept. */
function withText(edit: Raw, text: TweakDraft['text']): Raw {
  const out: Raw = { ...edit };
  for (const f of ['name', 'description'] as const) {
    if (!text || !(f in text)) continue;
    const v = text[f];
    if (v) out[f] = v;
    else delete out[f];
  }
  return out;
}
/** The old keys holding a map (the rest of the list keys hold a list; `maxHp` a number). */
const MAP_LISTS: LegacyList[] = ['attributes', 'proficiencies', 'contentEdits'];
/** UNKNOWN ≠ EMPTY: a stored old key in a shape this version cannot read (a list where a map belongs, a
 *  string where a list belongs …) — a write would replace it whole, so it is refused and the value kept. */
function listUnreadable(list: LegacyList, cur: unknown): boolean {
  if (cur == null) return false;
  if (list === 'maxHp') return !finite(cur);
  return MAP_LISTS.includes(list) ? !isObj(cur) : !Array.isArray(cur);
}
const unreadableList = (list: string): string => `the stored "${list}" was written by a newer version or cannot be read; it is kept as it is`;

/** contentEdits with one edit set (or removed), empty buckets dropped. `null` when a bucket it touches is
 *  stored in a shape this version cannot read (it would be replaced whole). */
function contentEditsWith(ce: unknown, bucket: string, id: string, edit: Raw | undefined, moveFrom?: { bucket: string; id: string }): Raw | null {
  const out: Raw = isObj(ce) ? { ...ce } : {};
  if ([bucket, moveFrom?.bucket].some((b) => b !== undefined && out[b] != null && !isObj(out[b]))) return null;
  if (moveFrom) {
    const b = isObj(out[moveFrom.bucket]) ? { ...(out[moveFrom.bucket] as Raw) } : {};
    delete b[moveFrom.id];
    if (Object.keys(b).length) out[moveFrom.bucket] = b;
    else delete out[moveFrom.bucket];
  }
  const b = isObj(out[bucket]) ? { ...(out[bucket] as Raw) } : {};
  if (edit) b[id] = edit;
  else delete b[id];
  if (Object.keys(b).length) out[bucket] = b;
  else delete out[bucket];
  return out;
}

/* ─────────────────────────────── number blocks (`overrides.blocks`) ─────────────────────────────── */

/** `id`: the block id an add stored in `blocks` (F5: a retry pins it). */
type Done = { ov: BuildOverrides; id?: string } | { refused: string };
const refuse = (refused: string): Done => ({ refused });

/** The parts of a kind's editor (main and advanced). */
const partsOf = (def: BlockKindDef): string[] => [...(def.editor?.parts ?? []), ...(def.editor?.advancedParts ?? [])];
/** Does the kind's editor have a start level? (B25: remove, "take anyway" and a text edit have none.) */
const hasLevel = (def: BlockKindDef): boolean => partsOf(def).includes('level');
/** A start level (or stored level) above 1 on a kind that has none (B25) — no screen could show or undo it. */
function levelProblem(def: BlockKindDef, d: Partial<TweakDraft>): string | undefined {
  if (hasLevel(def)) return undefined;
  if ((finite(d.from) && d.from > 1) || (finite(d.level) && d.level > 1)) return `${def.title} has no start level`;
  return undefined;
}

/** A block instance back to the fields this version stores. */
function storedOf(b: BlockInstance): NumberStoredBlock {
  const out: NumberStoredBlock = { id: b.key.slice('blocks:'.length), kind: b.kind, v: b.version, target: b.target ?? '', value: b.value as number };
  if (b.bonusType) out.bonusType = b.bonusType;
  if (b.reason) out.reason = b.reason;
  if (!b.on) out.on = false;
  if (b.gate?.startLevel != null && b.gate.startLevel > 1) out.from = b.gate.startLevel;
  if (finite(b.params?.baseline)) out.baseline = b.params.baseline;
  return out;
}

/** Check a stored block before it is written: a kind stored in `blocks`, a known target it accepts, a
 *  number, a bonus type only where its editor has that part. */
function blockProblem(b: NumberStoredBlock): string | undefined {
  const def = blockKind(b.kind);
  if (!def || def.storage.in !== 'blocks' || !('aspect' in def.accepts)) return `"${b.kind}" is not a number kind`;
  const t = targetDefFor(b.target, def.accepts.aspect);
  if (!t || !def.accepts.kinds.includes(t.kind)) return `${def.title} cannot point at "${b.target}"`;
  if (!finite(b.value)) return 'the value is not a number';
  if (b.bonusType != null && (!BONUS_TYPES.includes(b.bonusType) || !partsOf(def).includes('bonusType'))) return `${def.title} takes no bonus type "${b.bonusType}"`;
  if (b.from != null && !hasLevel(def)) return `${def.title} has no start level`;
  return undefined;
}

/** Splice one block in (or out) by id; a refusal from the splice refuses the whole write. */
function spliceBlocks(prev: BuildOverrides, changes: { upsert?: StoredBlock[]; removeIds?: string[] }): Done {
  const { list, refused } = writeStoredBlocks(prev.blocks, changes);
  if (refused.length) return refuse(`"${refused.join('", "')}" was written by a newer version or cannot be read; it is kept as it is`);
  const next: Raw = { ...prev };
  if (emptyValue(list)) delete next.blocks;
  else next.blocks = list;
  return { ov: next as BuildOverrides };
}

/** Apply a draft's fields to a stored block (a field absent from the draft stays). */
function blockWithDraft(s: NumberStoredBlock, d: Partial<TweakDraft>, baseline: number | undefined): NumberStoredBlock {
  const out: NumberStoredBlock = { ...s };
  if (d.kind !== undefined) out.kind = d.kind;
  if (d.target !== undefined) out.target = d.target;
  if ('value' in d) out.value = d.value as number;
  if ('bonusType' in d) {
    if (d.bonusType) out.bonusType = d.bonusType;
    else delete out.bonusType;
  }
  if ('reason' in d) {
    if (d.reason) out.reason = d.reason;
    else delete out.reason;
  }
  if ('from' in d) {
    if (finite(d.from) && d.from > 1) out.from = d.from;
    else delete out.from;
  }
  if ('on' in d) {
    if (d.on === false) out.on = false;
    else delete out.on;
  }
  if (baseline !== undefined) out.baseline = baseline;
  const def = blockKind(out.kind);
  if (def) out.v = def.version;
  return out;
}

function blockOp(prev: BuildOverrides, w: Exclude<TweakWrite, { op: 'add' }>): Done {
  const id = w.key.slice('blocks:'.length);
  const { known, foreign } = parseStoredBlocks(prev.blocks);
  const inst = known.find((b) => b.key === w.key);
  if (!inst) {
    if (foreign.some((f) => f.id === id)) return refuse(`"${w.key}" was written by a newer version or cannot be read; it is kept as it is`);
    return refuse(`no tweak "${w.key}"`);
  }
  if (w.op === 'remove') return spliceBlocks(prev, { removeIds: [id] });
  if (isChoiceKindId(inst.kind)) return choiceOp(prev, inst, w);
  const draft: Partial<TweakDraft> =
    w.op === 'setOn' ? { on: w.on } : w.op === 'repoint' ? (w.target !== undefined ? { target: w.target } : {}) : w.draft;
  const b = blockWithDraft(storedOf(inst), draft, w.op === 'update' ? w.baseline : undefined);
  const problem = blockProblem(b);
  if (problem) return refuse(problem);
  return spliceBlocks(prev, { upsert: [b] });
}

/** The id a new block gets: `pinned` (a retry of a write made against an older build keeps the id that write
 *  minted, so the row the page opened is the block stored; WP1 check, F5) when it has the C4 shape and no
 *  stored element, foreign ones included, holds it; otherwise a fresh `newBlockId`. */
function addedBlockId(prev: BuildOverrides, pinned: string | undefined): string {
  if (pinned && /^t\d+_[a-z0-9]{4}$/.test(pinned)) {
    const list: unknown = prev.blocks;
    const used = Array.isArray(list) && list.some((raw) => isObj(raw) && raw.id === pinned);
    if (!used) return pinned;
  }
  return newBlockId(prev);
}

function addBlock(prev: BuildOverrides, def: BlockKindDef, d: TweakDraft, baseline: number | undefined, pinned?: string): Done {
  if (isChoiceKindId(def.id)) return addChoice(prev, def, d, pinned);
  const b = blockWithDraft({ id: addedBlockId(prev, pinned), kind: def.id, v: def.version, target: d.target ?? '', value: d.value as number }, { ...d, kind: def.id }, baseline);
  const problem = blockProblem(b);
  if (problem) return refuse(problem);
  return withId(spliceBlocks(prev, { upsert: [b] }), b.id);
}

/** A block add's result, naming the id it stored. */
const withId = (done: Done, id: string): Done => ('refused' in done ? done : { ...done, id });

/* ─────────────── Tweaks phase 2: the choice blocks (plan section 4; C3, C4, C27, C32, C36) ─────────────── */

const isChoiceKindId = (kind: string): boolean => !!CHOICE_FIELDS[kind];

/** A choice instance back to its stored fields, in the kind's order (id, kind, v, its fields, reason, on). */
function choiceStoredOf(b: BlockInstance): Raw {
  const out: Raw = { id: b.key.slice('blocks:'.length), kind: b.kind, v: b.version };
  for (const f of CHOICE_FIELDS[b.kind]) if (b.params?.[f] !== undefined) out[f] = b.params[f];
  if (b.reason) out.reason = b.reason;
  if (!b.on) out.on = false;
  return out;
}

/** The fields of a choice block that hold an ANSWER (a skill, a Lore, a value): no comma, a Lore keyed (C27). */
function answerFields(s: Raw): string[] {
  switch (s.kind) {
    // WP13: a skill increase taken anyway (its `record` a skill, WP12), a changed answer (WP10) and an edited list
    // (WP9) come after the record rebuild; this door writes none of them.
    case 'choice.allowAnywayAnyPicker':
      return s.picker === 'sanctification' ? ['value'] : [];
    case 'choice.addPlace':
      return ['skill'];
    default:
      return [];
  }
}

/** C27: a Lore answer ("lore:sailing", "Lore: Sailing", "Sailing Lore") is stored as `loreKey` output
 *  (`lore:<slug>`); any other answer as given. */
function keyedAnswer(v: string): string | null {
  return /^lore\b|\blore$/i.test(v.trim()) ? loreKey(v) : v;
}

/** The fields a draft SETS (`record` and the keys of `fields`). Only these are keyed and checked (C27, C32):
 *  a pause or a resume sets none, so it writes nothing but `on` (C5) — re-keying an older stored answer
 *  ("lore:Sailing Lore" → "lore:sailing") on a pause was a write the player never made, and a stored answer
 *  the keyer refuses (a bare "lore") made the pause itself refused (WP1 check, F2). A new `picker` changes
 *  which fields hold an answer, so it counts as setting every field. */
function draftTouches(kind: string, d: Partial<TweakDraft>): Set<string> {
  const t = new Set<string>(Object.keys(d.fields ?? {}));
  if (d.record !== undefined) t.add('record');
  if (t.has('picker')) for (const f of CHOICE_FIELDS[kind] ?? []) t.add(f);
  return t;
}

/** A draft laid over a stored choice block: `record` and `fields` set (a field given `undefined` is cleared),
 *  reason and on as for a number block, written back in the kind's field order. A field the kind does not
 *  store is refused (never written silently into a block). */
function choiceWithDraft(s: Raw, d: Partial<TweakDraft>): Raw | { refused: string } {
  const kind = String(s.kind);
  const fields = CHOICE_FIELDS[kind];
  const title = blockKind(kind)?.title ?? kind;
  const next: Raw = { ...s };
  if (d.record !== undefined) {
    if (!fields.includes('record')) return { refused: `${title} points at no record` };
    next.record = d.record;
  }
  for (const [k, v] of Object.entries(d.fields ?? {})) {
    if (!fields.includes(k)) return { refused: `${title} has no "${k}"` };
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  if ('reason' in d) {
    if (d.reason) next.reason = d.reason;
    else delete next.reason;
  }
  if ('on' in d) {
    if (d.on === false) next.on = false;
    else delete next.on;
  }
  // C27: no comma in an answer; a Lore keyed through the one keyer — only in the answers this draft sets.
  const touched = draftTouches(kind, d);
  for (const f of answerFields(next).filter((x) => touched.has(x))) {
    const v = next[f];
    const one = (x: unknown): unknown => {
      if (typeof x !== 'string') return x;
      if (answerHasComma(x)) throw new Error(COMMA_REFUSAL);
      const k = keyedAnswer(x);
      if (k === null) throw new Error(`"${x}" names no Lore subject`);
      return k;
    };
    try {
      if (Array.isArray(v)) next[f] = v.map(one);
      else if (v !== undefined) next[f] = one(v);
    } catch (e) {
      return { refused: (e as Error).message };
    }
  }
  const def = blockKind(kind);
  const out: Raw = { id: next.id, kind, v: def ? def.version : next.v };
  for (const f of fields) if (next[f] !== undefined) out[f] = next[f];
  if (next.reason !== undefined) out.reason = next.reason;
  if (next.on !== undefined) out.on = next.on;
  return out;
}

/** What the stored reader would make of a choice block this write is about to store: the writer can never
 *  write a block its own reader keeps as foreign (one set of rules, C3). And C32, enforced here rather than
 *  only checked on fixtures (WP1 check, F3): no field the draft sets may hold a feat slot's key (a
 *  `SLOT_PREFIX` string, alone or in a list) — slot keys drift under a rekey, so a tweak names records, never
 *  slots. Only the fields set (`touched`), so a pause never refuses over what an older write stored (C5). */
function choiceProblem(s: Raw, touched: Set<string>): string | undefined {
  const title = blockKind(String(s.kind))?.title ?? String(s.kind);
  for (const f of touched) {
    const v = s[f];
    const slot = (Array.isArray(v) ? v : [v]).find((x): x is string => typeof x === 'string' && SLOT_PREFIX.test(x));
    if (slot !== undefined) return `${title}: "${slot}" is a feat slot, not a record; a tweak names the record itself`;
  }
  const { foreign } = parseStoredBlocks([s]);
  if (!foreign.length) return undefined;
  return foreign[0].why === 'newer-version' ? `${title}: a value this version does not know` : `${title}: a field is missing or holds the wrong kind of value`;
}

/** The fields that make two choice blocks the same tweak (everything but id, v, reason and on) — except where a
 *  field is an AMOUNT, not a name: "Take a feat more times" is ONE tweak per feat (WP8, orchestrator decision D1), its
 *  `times` raised or lowered on that one block, so a second add for the feat is a copy and an edit of `times` never
 *  makes one (two blocks of one feat from a two-tab merge keep saving; `extraTakes` sums them). */
const IDENTITY_FIELDS: Readonly<Record<string, readonly string[]>> = { 'choice.moreTakes': ['record'] };
/** The refusal of a second "Take a feat more times" for one feat (D1), in the Tweaks page's words. */
export const MORE_TAKES_COPY = 'This feat already has a "Take a feat more times" tweak: change its count on its row';
const choiceIdentity = (s: Raw): string => JSON.stringify((IDENTITY_FIELDS[String(s.kind)] ?? CHOICE_FIELDS[String(s.kind)]).map((f) => [f, s[f]]));

function addChoice(prev: BuildOverrides, def: BlockKindDef, d: TweakDraft, pinned?: string): Done {
  const lp = levelProblem(def, d);
  if (lp) return refuse(lp);
  let draft = d;
  // A feat place with no `n` yet: 6 random digits, re-drawn on a clash with a place already stored (C4).
  if (def.id === 'choice.addPlace' && d.fields?.place === 'feat' && d.fields.n === undefined) {
    draft = { ...d, fields: { ...d.fields, n: newPlaceN(prev, Number(d.fields.level)) } };
  }
  const s = choiceWithDraft({ id: addedBlockId(prev, pinned), kind: def.id, v: def.version }, draft);
  if ('refused' in s) return refuse(String(s.refused));
  const problem = choiceProblem(s, draftTouches(def.id, draft));
  if (problem) return refuse(problem);
  // A second copy of the same permission or removal IS a duplicate, so it is refused. An extra skill-increase or
  // boost PLACE never is (C14-C16, section 4 "skill absent = owed"): two extra skill increases at level 5, owed or
  // both on Stealth, or two extra boosts at one level are two places, each its own tweak (WP1 check, F1). A feat
  // place stays checked: its `n` names the slot, so a second one with the same n would be two tweaks on one slot.
  const extraPlace = def.id === 'choice.addPlace' && (s as { place?: unknown }).place !== 'feat';
  const same =
    !extraPlace && parseStoredBlocks(prev.blocks).known.some((b) => b.kind === def.id && choiceIdentity(choiceStoredOf(b)) === choiceIdentity(s));
  if (same) return refuse(def.id === 'choice.moreTakes' ? MORE_TAKES_COPY : `the same ${def.title.toLowerCase()} tweak is already listed`);
  return withId(spliceBlocks(prev, { upsert: [s as unknown as StoredBlock] }), String(s.id));
}

function choiceOp(prev: BuildOverrides, inst: BlockInstance, w: Exclude<TweakWrite, { op: 'add' | 'remove' }>): Done {
  const def = blockKind(inst.kind)!;
  if (w.op === 'repoint' && w.target !== undefined) return refuse(`${def.title} points at no statistic`);
  const draft: Partial<TweakDraft> = w.op === 'setOn' ? { on: w.on } : w.op === 'repoint' ? (w.record !== undefined ? { record: w.record } : {}) : w.draft;
  if (draft.kind !== undefined && draft.kind !== inst.kind) return refuse(`${def.title} cannot become another kind of tweak`);
  const lp = levelProblem(def, draft);
  if (lp) return refuse(lp);
  const s = choiceWithDraft(choiceStoredOf(inst), draft);
  if ('refused' in s) return refuse(String(s.refused));
  const problem = choiceProblem(s, draftTouches(inst.kind, draft));
  if (problem) return refuse(problem);
  // WP6 final check: an edit or a repoint that makes this tweak a copy of ANOTHER stored one is refused, as the add is
  // (two "list" lifts of one feat, two removals of one place). Only when the edit changes what it names, so a pause or
  // a reason on an old duplicate still saves; an extra skill-increase or boost place is never a copy (see the add).
  const id = choiceIdentity(s);
  const extraPlace = def.id === 'choice.addPlace' && (s as { place?: unknown }).place !== 'feat';
  if (!extraPlace && id !== choiceIdentity(choiceStoredOf(inst))) {
    const copy = parseStoredBlocks(prev.blocks).known.some((b) => b.key !== inst.key && b.kind === def.id && choiceIdentity(choiceStoredOf(b)) === id);
    if (copy) return refuse(def.id === 'choice.moreTakes' ? MORE_TAKES_COPY : `the same ${def.title.toLowerCase()} tweak is already listed`);
  }
  return spliceBlocks(prev, { upsert: [s as unknown as StoredBlock] });
}

/** A feat place's `n` (C4): 6 random digits, 100000–999999, re-drawn while any stored place at that level, or
 *  any key `taken` names, already uses it. After 200 unlucky draws, the first free number in order. */
export function newPlaceN(ov: BuildOverrides | undefined, level: number, taken: (n: number) => boolean = () => false, rand: () => number = Math.random): number {
  const used = new Set<number>();
  for (const b of parseStoredBlocks(ov?.blocks).known) {
    if (b.kind === 'choice.addPlace' && b.params?.place === 'feat' && b.params.level === level && typeof b.params.n === 'number') used.add(b.params.n);
  }
  const free = (n: number) => !used.has(n) && !taken(n);
  for (let i = 0; i < 200; i++) {
    const n = 100000 + Math.min(899999, Math.floor(rand() * 900000));
    if (free(n)) return n;
  }
  for (let n = 100000; n <= 999999; n++) if (free(n)) return n;
  throw new Error('no free feat place number at this level');
}

/* ─────────────────────────────── today's Overrides keys ─────────────────────────────── */

/** The fresh meta of an entry: the draft's reason / start level / pause, a rank's mode, a set's baseline.
 *  A start level is written only for a kind whose editor has one (B25; the callers refuse a level above 1
 *  on the others, and a cleared one is still cleared). */
function draftMeta(base: TweakMeta, def: BlockKindDef, list: LegacyList, d: Partial<TweakDraft>, mode: TweakMeta['mode'], baseline: number | undefined, of: string): TweakMeta | undefined {
  const m: TweakMeta = { ...base };
  delete m.moved; // B11: the first edit makes it the player's own
  if (LEVELLED.includes(list)) delete m.from; // B10: folded into the stored level
  else if ('from' in d) m.from = hasLevel(def) && finite(d.from) && d.from > 1 ? d.from : undefined;
  if ('reason' in d) m.reason = d.reason || undefined;
  if ('on' in d) m.on = d.on === false ? false : undefined;
  if (mode !== undefined) m.mode = mode;
  if (baseline !== undefined) m.baseline = baseline;
  m.of = of;
  return compactMeta(m);
}

/** The stored level of a given feat / class feature after an edit: the draft's level (or start level),
 *  else the old stored level with an old `meta.from` folded in (B10), else the raw value untouched. */
function levelAfterEdit(cur: unknown, base: TweakMeta, d: Partial<TweakDraft>): unknown {
  if (finite(d.level)) return d.level;
  if (finite(d.from)) return d.from;
  const from = finite(base.from) ? base.from : 1;
  if (from <= 1) return cur;
  const stored = Number(cur);
  return Math.max(Number.isFinite(stored) ? stored : 1, from);
}

function addLegacy(prev: BuildOverrides, def: BlockKindDef, list: LegacyList, d: TweakDraft, baseline: number | undefined): Done {
  const mode = modeOf(def.id);
  const meta = (of: string) => draftMeta({}, def, list, d, mode, baseline, of);
  const at = (value: unknown, newIndex: number | string) => ({ ov: rewriteList(prev, list, value, (i) => i, { newIndex, meta }) });
  const cur: unknown = (prev as Raw)[list];
  if (listUnreadable(list, cur)) return refuse(unreadableList(list));
  const lp = levelProblem(def, d);
  if (lp) return refuse(lp);
  const arr: unknown[] = Array.isArray(cur) ? cur : [];
  switch (list) {
    case 'attributes': {
      const ab = abilityOf(d.target);
      if (!ab) return refuse(`"${d.target}" is not an attribute score`);
      if (!finite(d.value)) return refuse('the score is not a number');
      const obj = isObj(cur) ? cur : {};
      if (obj[ab] !== undefined) return refuse(`${ab} is already set by a tweak`);
      return at({ ...obj, [ab]: d.value }, ab);
    }
    case 'proficiencies': {
      const k = proficiencyKeyOf(d.target, def);
      if (!k) return refuse(`${def.title} cannot point at "${d.target}"`);
      if (!d.rank || !RANKS.has(d.rank)) return refuse(`"${d.rank}" is not a proficiency rank`);
      const obj = isObj(cur) ? cur : {};
      if (trackTaken(obj, k)) return refuse(`"${d.target}" already has a rank tweak`);
      return at({ ...obj, [k]: d.rank }, k);
    }
    case 'maxHp':
      if (!finite(d.value)) return refuse('the maximum HP is not a number');
      if (prev.maxHp != null) return refuse('maximum HP is already set by a tweak');
      return at(d.value, 0);
    case 'addedFeats':
    case 'addedFeatures': {
      if (!d.record) return refuse('no record named');
      const level = finite(d.level) ? d.level : finite(d.from) ? d.from : 1;
      if (list === 'addedFeatures') return at([...arr, { featureId: d.record, level }], arr.length);
      if (!d.category) return refuse('a given feat needs its category');
      return at([...arr, { featId: d.record, level, category: d.category }], arr.length);
    }
    case 'addedSpells': {
      const rank = finite(d.spellRank) ? d.spellRank : d.value;
      if (!d.record) return refuse('no spell named');
      if (!finite(rank) || rank < 0 || rank > 10 || !Number.isInteger(rank)) return refuse('the spell rank is not a rank');
      return at([...arr, { spellId: d.record, rank }], arr.length);
    }
    case 'addedLanguages':
    case 'removedFeatIds':
    case 'allowedFeats':
      if (!d.record) return refuse('no record named');
      if (arr.includes(d.record)) return refuse(`"${d.record}" is already listed`);
      return at([...arr, d.record], arr.length);
    case 'contentEdits': {
      const r = textRecord(d.record);
      if (!r) return refuse(`"${d.record}" is not a feat or class feature`);
      const bucket = isObj(cur) ? cur[r.bucket] : undefined;
      if (isObj(bucket) && bucket[r.id] !== undefined) return refuse(`"${d.record}" already has a text edit`);
      const ce = contentEditsWith(cur, r.bucket, r.id, withText({}, d.text));
      if (!ce) return refuse(unreadableList(`contentEdits.${r.bucket}`));
      return at(ce, d.record!);
    }
  }
}

/** update / repoint of an old-key entry: the entry's new value, and its meta moved to its new key. */
function updateLegacy(prev: BuildOverrides, e: LegacyEntry, d: Partial<TweakDraft>, baseline: number | undefined): Done {
  const list = e.list;
  const base = baseMeta(prev, e);
  const kind = d.kind ?? e.kind;
  const def = blockKind(kind);
  if (!def || def.storage.in !== 'legacy' || def.storage.key !== list) return refuse(`"${e.key}" cannot become a ${d.kind}`);
  if (d.kind !== undefined && d.kind !== e.kind && !def.editor) return refuse(`no player writes ${def.title}`);
  const lp = levelProblem(def, d);
  if (lp) return refuse(lp);
  const mode = d.kind !== undefined ? modeOf(d.kind) : undefined;
  const meta = (of: string) => draftMeta(base, def, list, d, mode, baseline, of);
  const write = (value: unknown, newIndex: number | string, mapIndex: (i: number | string) => number | string | undefined = (i) => i) => ({
    ov: rewriteList(prev, list, value, mapIndex, { oldKey: e.key, newIndex, meta }),
  });
  const cur: unknown = (prev as Raw)[list];
  const moveKey = (obj: Raw, from: string, to: string, v: unknown): Raw => Object.fromEntries(Object.entries(obj).map(([k, x]) => (k === from ? [to, v] : [k, x])));
  switch (list) {
    case 'attributes': {
      const obj = isObj(cur) ? cur : {};
      const from = String(e.index);
      const ab = d.target !== undefined ? abilityOf(d.target) : from;
      if (!ab) return refuse(`"${d.target}" is not an attribute score`);
      if ('value' in d && !finite(d.value)) return refuse('the score is not a number');
      if (ab !== from && obj[ab] !== undefined) return refuse(`${ab} is already set by a tweak`);
      return write(moveKey(obj, from, ab, 'value' in d ? d.value : obj[from]), ab, (i) => (i === from ? ab : i));
    }
    case 'proficiencies': {
      const obj = isObj(cur) ? cur : {};
      const from = String(e.index);
      const k = d.target !== undefined ? proficiencyKeyOf(d.target, def) : from;
      if (!k) return refuse(`${def.title} cannot point at "${d.target}"`);
      if ('rank' in d && (!d.rank || !RANKS.has(d.rank))) return refuse(`"${d.rank}" is not a proficiency rank`);
      if (k !== from && trackTaken(obj, k, from)) return refuse(`"${d.target}" already has a rank tweak`);
      return write(moveKey(obj, from, k, 'rank' in d ? d.rank : obj[from]), k, (i) => (i === from ? k : i));
    }
    case 'maxHp':
      if ('value' in d && !finite(d.value)) return refuse('the maximum HP is not a number');
      return write('value' in d ? d.value : prev.maxHp, 0);
    case 'addedFeats':
    case 'addedFeatures':
    case 'addedSpells': {
      const arr = Array.isArray(cur) ? [...cur] : [];
      const i = Number(e.index);
      const old: Raw = isObj(arr[i]) ? (arr[i] as Raw) : {};
      if (list === 'addedSpells') {
        const rank = 'spellRank' in d ? d.spellRank : 'value' in d ? d.value : old.rank;
        if (('spellRank' in d || 'value' in d) && (!finite(rank) || rank < 0 || rank > 10 || !Number.isInteger(rank))) return refuse('the spell rank is not a rank');
        arr[i] = { ...old, spellId: d.record ?? old.spellId, rank };
      } else {
        const idField = list === 'addedFeats' ? 'featId' : 'featureId';
        // A given feat pointed at another record takes THAT record's category (plan 5.2; heldFeats hands the
        // stored category on): the old one would be wrong, so a record change without one is refused.
        if (idField === 'featId' && d.record !== undefined && d.record !== old.featId && !d.category) return refuse('a given feat needs its category');
        arr[i] = { ...old, [idField]: d.record ?? old[idField], level: levelAfterEdit(old.level, base, d), ...(list === 'addedFeats' && d.category ? { category: d.category } : {}) };
      }
      return write(arr, i);
    }
    case 'addedLanguages':
    case 'removedFeatIds':
    case 'allowedFeats': {
      const arr = Array.isArray(cur) ? [...cur] : [];
      const i = Number(e.index);
      const id = d.record ?? arr[i];
      if (arr.some((x, j) => j !== i && x === id)) return refuse(`"${String(id)}" is already listed`);
      arr[i] = id;
      return write(arr, i);
    }
    case 'contentEdits': {
      const from = textRecord(String(e.index))!;
      const to = d.record !== undefined ? textRecord(d.record) : from;
      if (!to) return refuse(`"${d.record}" is not a feat or class feature`);
      const toKey = `${to.bucket}/${to.id}`;
      const fromBucket = isObj(cur) ? cur[from.bucket] : undefined;
      const stored: unknown = isObj(fromBucket) ? fromBucket[from.id] : undefined;
      // UNKNOWN ≠ EMPTY: an edit stored in a shape this version cannot read (not a map) is never replaced
      // by one built from nothing; it is refused and kept (Remove still takes it away).
      if (stored != null && !isObj(stored)) return refuse(unreadableList(`contentEdits.${from.bucket}.${from.id}`));
      const old: Raw = isObj(stored) ? stored : {};
      const toBucket = isObj(cur) ? cur[to.bucket] : undefined;
      if (toKey !== e.index && isObj(toBucket) && toBucket[to.id] !== undefined) return refuse(`"${toKey}" already has a text edit`);
      const edit = 'text' in d ? withText(old, d.text) : old;
      // Every field typed back to the book's own text (and nothing else stored on the edit, traits …): the
      // edit changes nothing, so it goes, meta and all, as an emptied number does. Never an empty edit left
      // standing as a tweak that changes nothing.
      if ('text' in d && isObj(stored) && !Object.keys(edit).length) return removeLegacy(prev, e);
      const moved = toKey !== e.index ? from : undefined;
      const ce = contentEditsWith(cur, to.bucket, to.id, edit, moved);
      if (!ce) return refuse(unreadableList(`contentEdits.${to.bucket}`));
      return write(ce, toKey, (i) => (i === e.index ? toKey : i));
    }
  }
}

/** remove of an old-key entry: the entry and its meta go; every other entry keeps its own meta. */
function removeLegacy(prev: BuildOverrides, e: LegacyEntry): Done {
  const list = e.list;
  const cur: unknown = (prev as Raw)[list];
  switch (list) {
    case 'attributes':
    case 'proficiencies': {
      const obj: Raw = isObj(cur) ? { ...cur } : {};
      delete obj[String(e.index)];
      return { ov: rewriteList(prev, list, obj, (i) => (i === e.index ? undefined : i)) };
    }
    case 'maxHp':
      return { ov: rewriteList(prev, list, undefined, () => undefined) };
    case 'contentEdits': {
      const r = textRecord(String(e.index))!;
      const ce = contentEditsWith(cur, r.bucket, r.id, undefined);
      if (!ce) return refuse(unreadableList(`contentEdits.${r.bucket}`));
      return { ov: rewriteList(prev, list, ce, (i) => (i === e.index ? undefined : i)) };
    }
    default: {
      const arr = Array.isArray(cur) ? cur : [];
      const at = Number(e.index);
      return { ov: rewriteList(prev, list, arr.filter((_, j) => j !== at), (i) => (i === at ? undefined : Number(i) > at ? Number(i) - 1 : i)) };
    }
  }
}

/** setOn of an old-key entry: only its meta changes (`moved` kept, B26). */
function setOnLegacy(prev: BuildOverrides, e: LegacyEntry, on: boolean): Done {
  const m = compactMeta({ ...baseMeta(prev, e), on: on ? undefined : false, of: e.of });
  const meta: Meta = { ...metaOf(prev) };
  if (m) meta[e.key] = m;
  else delete meta[e.key];
  const next: Raw = { ...prev };
  if (Object.keys(meta).length) next.meta = meta;
  else delete next.meta;
  return { ov: next as BuildOverrides };
}

/* ─────────────────────────────── the door ─────────────────────────────── */

function apply(prev: BuildOverrides, w: TweakWrite): Done {
  if (w.op === 'add') {
    const def = blockKind(w.draft.kind);
    if (!def) return refuse(`"${w.draft.kind}" is not a kind this version knows`);
    if (!def.editor) return refuse(`no player writes ${def.title}`);
    // WP13: a kind nothing applies yet ("Change an answer", "Edit a list") comes after the record rebuild; its stored
    // blocks read as a newer app's (stored.ts), so this version never writes one.
    if (def.applies === 'not-yet') return refuse(`${def.title} is not in this version yet`);
    if (def.storage.in === 'blocks') return addBlock(prev, def, w.draft, w.baseline, w.id);
    if (metaUnreadable(prev)) return refuse('the tweak notes were written by a newer version; they are kept as they are');
    return addLegacy(prev, def, def.storage.key, w.draft, w.baseline);
  }
  if (w.key.startsWith('blocks:')) return blockOp(prev, w);
  const e = legacyEntries(prev).find((x) => x.key === w.key);
  if (!e) return refuse(`no tweak "${w.key}"`);
  if (metaUnreadable(prev)) return refuse('the tweak notes were written by a newer version; they are kept as they are');
  if (listUnreadable(e.list, (prev as Raw)[e.list])) return refuse(unreadableList(e.list));
  switch (w.op) {
    case 'remove':
      return removeLegacy(prev, e);
    case 'setOn':
      return setOnLegacy(prev, e, w.on);
    case 'repoint': {
      const d: Partial<TweakDraft> = {};
      if (w.record !== undefined) d.record = w.record;
      if (w.target !== undefined) d.target = w.target;
      if (w.category !== undefined) d.category = w.category;
      return updateLegacy(prev, e, d, undefined);
    }
    case 'update':
      return updateLegacy(prev, e, w.draft, w.baseline);
  }
}

/**
 * THE write: add, update, pause / resume, remove or re-point one tweak. Returns the new overrides object
 * (`undefined` when nothing is left, B15), or the host's own object with `refused` and the reason when the
 * write cannot be made (a foreign block, an unknown kind or key, a value the kind cannot hold).
 */
export function writeTweak(host: TweakHost, w: TweakWrite): TweakWriteResult {
  const prev = host.overrides;
  const placed = featPlaceWrite(host, w);
  if ('refused' in placed) return { overrides: prev, refused: placed.refused };
  const done = apply(prev ?? {}, placed.w);
  if ('refused' in done) return { overrides: prev, refused: done.refused };
  let next: BuildOverrides = done.ov;
  if (readsOption(host)) next = { ...next, v: stampedV(prev) };
  return { overrides: isEmptyShell(next) ? undefined : next, ...(done.id !== undefined ? { id: done.id } : {}) };
}

/**
 * Several writes as ONE (plan B WP7): each through `writeTweak`, the next one against the result of the one
 * before. The first refusal refuses them all and nothing is written (the host's own object comes back with
 * the reason). The Tweaks editors use it where one change of the player's is two writes: a tweak whose kind
 * changes to one stored under another key (a Maximum HP "Set to" made "At least": `maxHp` → a block) is
 * removed and added again with its reason, start level and on/off.
 */
export function writeTweaks(host: TweakHost, ws: readonly TweakWrite[]): TweakWriteResult {
  let cur: TweakHost = host;
  const ids: (string | undefined)[] = [];
  for (const w of ws) {
    const r = writeTweak(cur, w);
    if (r.refused) return { overrides: host.overrides, refused: r.refused };
    cur = { ...cur, overrides: r.overrides };
    ids.push(r.id);
  }
  return ids.some((x) => x !== undefined) ? { overrides: cur.overrides, ids } : { overrides: cur.overrides };
}

/**
 * `ws` again, each block add pinned to the id `done` (the result of `writeTweaks(…, ws)`) stored for it: the
 * same change retried on a newer build keeps its ids, so a row opened from the first try names the block that
 * is stored (TweaksPage; WP1 check, F5). A new block id carries a random tail (C4), so an unpinned retry mints
 * another one.
 */
export function pinAddedIds(ws: readonly TweakWrite[], done: TweakWriteResult): TweakWrite[] {
  return ws.map((w, i) => {
    const id = done.ids?.[i];
    return w.op === 'add' && id !== undefined ? { ...w, id } : w;
  });
}

/**
 * The Builder's "Take anyway" (plan B WP8): the one write that makes `featId` allowed anyway. A PAUSED entry
 * for the feat is switched back on, never listed a second time (the old writer appended the id again, so a
 * paused "Take anyway" became two entries); `null` when one is on already (nothing to write); otherwise a new
 * `choice.allowAnyway`. Read through `readLegacyBlocks` (where the kind is stored), so its keys are the stored ones.
 */
export function takeAnywayWrite(host: TweakHost, featId: string): TweakWrite | null {
  const mine = readLegacyBlocks(host.overrides).filter((b) => b.kind === 'choice.allowAnyway' && b.record === featId);
  if (mine.some((b) => b.on && !b.broken)) return null;
  const paused = mine.find((b) => !b.broken);
  return paused ? { op: 'setOn', key: paused.key, on: true } : { op: 'add', draft: { kind: 'choice.allowAnyway', record: featId } };
}

/* ─────────────── Tweaks phase 2: a choice tweak and the pick it allows, as ONE change ─────────────── */

/** A choice tweak for `writeChoiceTweak`: an add, or (with `key`, a stored `blocks:<id>`) an update. */
export interface ChoiceDraft extends TweakDraft {
  key?: string;
}

export interface ChoiceTweakResult<B> {
  /** The new build (the host's own object, untouched, when refused). */
  build: B;
  /** Set when nothing was written, with the reason. */
  refused?: string;
  /** The instance keys (`blocks:<id>`) the write added or updated, in draft order. */
  keys: string[];
}

/** Does any keyed map of the build hold a key at `slot` (the key itself, `<slot>#n` or `<slot>:…`, or a later
 *  taking's `…#<slot>` variant key — slotKey.ts `keyHoldsSlot`, the forms `swapSlotKeys` moves)? */
function slotKeyTaken(build: object, slot: string): boolean {
  for (const v of Object.values(build)) {
    if (!isObj(v)) continue;
    for (const k of Object.keys(v)) if (k === slot || k.startsWith(`${slot}#`) || k.startsWith(`${slot}:`) || keyHoldsSlot(k, slot)) return true;
  }
  return false;
}

/** An extra feat place's slot key, as blocks/active.ts `featPlaceKey` derives it (C8; not imported: active.ts reads
 *  this module's neighbours, and the key is one template). */
const placeSlotKey = (level: unknown, category: unknown, n: unknown): string => `${String(level)}:extra${String(category)}:${String(n)}`;

/**
 * What a build holds under an extra feat place's slot key (WP7, C12): 'feat' — a pick (`featPicks`); 'answers' — no
 * pick, but an answer an earlier feat left under it (`<slot>#n`, `<slot>:…`, a `…#<slot>` variant key, in any map);
 * null — nothing, so the place may move. A host with no build maps (the overrides alone) holds nothing.
 */
export function heldUnderPlace(build: object, slot: string): 'feat' | 'answers' | null {
  const picks = (build as { featPicks?: Record<string, unknown> }).featPicks;
  if (isObj(picks) && picks[slot]) return 'feat';
  return slotKeyTaken(build, slot) ? 'answers' : null;
}

/** The refusals of a feat place's move (C12), in the editor's words. */
export const PLACE_HOLDS_FEAT = 'Remove the feat first: a place that holds a feat keeps its level and kind';
export const PLACE_HOLDS_ANSWERS = 'This place still holds answers an earlier feat left in it, so it keeps its level and kind: delete it and add a new place instead';

/** A feat place's `n` no stored place and no key of `host` uses at `level` (C4): the add's and the move's one draw. */
function freePlaceN(host: TweakHost, level: number, minted: (n: number) => boolean = () => false): number {
  return newPlaceN(host.overrides, level, (x) => minted(x) || FEAT_PLACE_CATEGORIES.some((c) => slotKeyTaken(host, placeSlotKey(level, c, x))));
}

/**
 * WP7 (C4, C12): an extra FEAT place's slot key in a write that sees the build (the host is the build every caller
 * passes: the Builder's, the Tweaks page's). An add with no `n` draws one no stored place and no key of the build
 * uses at its level — a stranded "feat with no slot" under a key is never captured by a new place. An edit that MOVES
 * a place (its level, kind or n) is refused while anything is stored under its key: the pick ("Remove the feat
 * first"), or answers an earlier feat left there — so a filled place never moves and a move never leaves a pick or an
 * answer behind under the old key. A move onto a key the build or another place at that level already uses draws a
 * fresh `n`. Every other write passes through untouched.
 */
function featPlaceWrite(host: TweakHost, w: TweakWrite): { w: TweakWrite } | { refused: string } {
  if (w.op === 'add') {
    const f = w.draft.fields;
    if (w.draft.kind !== 'choice.addPlace' || f?.place !== 'feat' || f.n !== undefined) return { w };
    return { w: { ...w, draft: { ...w.draft, fields: { ...f, n: freePlaceN(host, Number(f.level)) } } } };
  }
  if (w.op !== 'update' || !w.key.startsWith('blocks:')) return { w };
  const f = w.draft.fields;
  if (!f || !('level' in f || 'category' in f || 'n' in f)) return { w };
  const known = parseStoredBlocks(host.overrides?.blocks).known;
  const inst = known.find((b) => b.key === w.key);
  const p = inst?.params;
  if (!inst || inst.kind !== 'choice.addPlace' || p?.place !== 'feat') return { w };
  const level = 'level' in f ? f.level : p.level;
  const category = 'category' in f ? f.category : p.category;
  const n = 'n' in f ? f.n : p.n;
  const from = placeSlotKey(p.level, p.category, p.n);
  if (placeSlotKey(level, category, n) === from) return { w };
  const held = heldUnderPlace(host, from);
  if (held) return { refused: held === 'feat' ? PLACE_HOLDS_FEAT : PLACE_HOLDS_ANSWERS };
  if (typeof level !== 'number') return { w }; // a level cleared or not a number: the door's own check refuses it
  const usedHere = (x: unknown) =>
    known.some((b) => b.key !== inst.key && b.kind === 'choice.addPlace' && b.params?.place === 'feat' && b.params.level === level && b.params.n === x) ||
    FEAT_PLACE_CATEGORIES.some((c) => slotKeyTaken(host, placeSlotKey(level, c, x)));
  if (!usedHere(n)) return { w };
  if ('n' in f) return { refused: `another place at level ${level} already uses the number ${String(n)}` };
  return { w: { ...w, draft: { ...w.draft, fields: { ...f, n: freePlaceN(host, level) } } } };
}

/**
 * THE phase-2 write (plan WP1; C21, C44): one or more choice tweaks upserted through the write door AND the
 * build patch they go with (the pick a "Take anyway", "Allow here", "Take again" or a place makes), in ONE
 * returned build — so the caller makes one `setBuild`, one persist and one Ctrl+Z step. `patch` is laid over
 * the build after the tweaks (a function gets that build; a feat placed in a slot goes through
 * featSlots.ts `withFeat`, which clears the old feat's answers). A feat place drafted without `n` gets one
 * that no stored place and no key of this build uses at its level (C4). The first refusal refuses everything:
 * the host's own build comes back with the reason.
 */
export function writeChoiceTweak<B extends TweakHost>(build: B, drafts: readonly ChoiceDraft[], patch?: Partial<B> | ((b: B) => B)): ChoiceTweakResult<B> {
  const ws: TweakWrite[] = [];
  const minted = new Set<string>();
  for (const d of drafts) {
    if (!isChoiceKindId(d.kind)) return { build, refused: `"${d.kind}" is not a choice tweak`, keys: [] };
    const { key, ...draft } = d;
    if (key) {
      ws.push({ op: 'update', key, draft });
      continue;
    }
    let add: TweakDraft = draft;
    if (d.kind === 'choice.addPlace' && d.fields?.place === 'feat' && d.fields.n === undefined) {
      const level = Number(d.fields.level);
      const n = freePlaceN(build, level, (x) => minted.has(`${level}:${x}`));
      minted.add(`${level}:${n}`);
      add = { ...draft, fields: { ...d.fields, n } };
    }
    ws.push({ op: 'add', draft: add });
  }
  const r = writeTweaks(build, ws);
  if (r.refused) return { build, refused: r.refused, keys: [] };
  const before = new Set(parseStoredBlocks(build.overrides?.blocks).known.map((b) => b.key));
  const after = parseStoredBlocks(r.overrides?.blocks).known.map((b) => b.key);
  const keys = [...drafts.flatMap((d) => (d.key ? [d.key] : [])), ...after.filter((k) => !before.has(k))];
  let next = { ...build, overrides: r.overrides } as B;
  if (patch) next = typeof patch === 'function' ? patch(next) : { ...next, ...patch };
  return { build: next, keys };
}

/**
 * Delete one choice tweak (C12): the BLOCK only — a place's pick and its answers stay under their key (a
 * "feat with no slot" that still counts), nothing else moves. Asks nothing; Ctrl+Z brings it back.
 */
export function dropChoiceTweak<B extends TweakHost>(build: B, key: string): ChoiceTweakResult<B> {
  const inst = parseStoredBlocks(build.overrides?.blocks).known.find((b) => b.key === key);
  if (!inst || !isChoiceKindId(inst.kind)) return { build, refused: `no choice tweak "${key}"`, keys: [] };
  const r = writeTweak(build, { op: 'remove', key });
  if (r.refused) return { build, refused: r.refused, keys: [] };
  return { build: { ...build, overrides: r.overrides }, keys: [key] };
}

/**
 * The stored choice blocks whose record (or class) `gone` names, left out — `removeChosenIds` (content that is
 * gone, inside the Sources-off confirm; C32). Read through the stored reader: a block this version cannot read
 * is never looked into or dropped. Never adds or changes `v`; `undefined` when nothing is left (B15); `ov`
 * itself when nothing is dropped.
 */
export function dropChoiceBlocks(ov: BuildOverrides | undefined, gone: (id: string) => boolean): BuildOverrides | undefined {
  if (!ov || !Array.isArray(ov.blocks)) return ov;
  const ids: string[] = [];
  for (const b of parseStoredBlocks(ov.blocks).known) {
    if (!isChoiceKindId(b.kind)) continue;
    const p = b.params ?? {};
    // WP13: no readable block holds a skill key as its record (a skill increase taken anyway reads as newer, WP12).
    const record = typeof p.record === 'string' ? p.record : undefined;
    if ((record && gone(record)) || (typeof p.classId === 'string' && gone(p.classId))) ids.push(b.key.slice('blocks:'.length));
  }
  if (!ids.length) return ov;
  const { list, refused } = writeStoredBlocks(ov.blocks, { removeIds: ids });
  if (refused.length) return ov;
  const next: Raw = { ...ov };
  if (emptyValue(list)) delete next.blocks;
  else next.blocks = list;
  return isEmptyShell(next) ? undefined : (next as BuildOverrides);
}

/* ─────────────────────────────── writers outside the Builder ─────────────────────────────── */

/**
 * Stamp `{ source: 'import', of }` on the entries of `list` from `fromIndex` on (the ones an import just
 * appended: a Wanderer's Guide ritual, a reverse build's overflow feat). Touches nothing else — no `v`
 * (B27), no other entry. A stale meta at such a key is replaced (it was for something else).
 */
export function markImported(ov: BuildOverrides, list: 'addedFeats' | 'addedSpells', fromIndex: number): BuildOverrides {
  const stamp = legacyEntries(ov).filter((e) => e.list === list && typeof e.index === 'number' && e.index >= fromIndex);
  if (!stamp.length || metaUnreadable(ov)) return ov;
  const meta: Meta = { ...metaOf(ov) };
  for (const e of stamp) meta[e.key] = { source: 'import', of: e.of };
  return { ...ov, meta };
}

/** The list keys `dropEntries` filters. */
export type EntryList = 'addedFeats' | 'addedFeatures' | 'addedLanguages' | 'addedSpells' | 'removedFeatIds' | 'allowedFeats';

/**
 * `list` without the entries `keep` refuses (`removeChosenIds`: content that is gone). The meta of a dropped
 * entry goes; every kept entry keeps its own meta under its (possibly shifted) key. Never adds or changes
 * `v`; `undefined` when nothing is left (B15); `ov` itself when nothing is dropped.
 */
export function dropEntries(ov: BuildOverrides | undefined, list: EntryList, keep: (entry: unknown) => boolean): BuildOverrides | undefined {
  if (!ov) return ov;
  const arr: unknown = (ov as Raw)[list];
  if (!Array.isArray(arr)) return ov;
  const map = new Map<number, number>();
  const kept: unknown[] = [];
  arr.forEach((x, i) => {
    if (!keep(x)) return;
    map.set(i, kept.length);
    kept.push(x);
  });
  if (kept.length === arr.length) return ov;
  // A meta this app cannot read is kept whole; only the list is filtered.
  const next: BuildOverrides = metaUnreadable(ov)
    ? ({ ...ov, [list]: kept } as BuildOverrides)
    : rewriteList(ov, list, kept, (i) => map.get(Number(i)));
  return isEmptyShell(next) ? undefined : next;
}
