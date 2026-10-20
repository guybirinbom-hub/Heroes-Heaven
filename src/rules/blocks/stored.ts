/*
 * STORED TWEAKS — reading the blocks a character carries inside `overrides`, and writing them back
 * without ever losing one.
 *
 * Two places hold tweaks (checker C3, docs/overrides-redesign.md "Building blocks"):
 *   - the 10 keys today's Overrides already writes (`proficiencies`, `addedFeats`, …). A kind that wraps
 *     one reads THAT key, and its reason / on-off / start level sit in `overrides.meta['<key>:<id>']`, so
 *     an older app still sees the change itself;
 *   - `overrides.blocks`, only for the new number kinds (+/-, set, at least N).
 *
 * ⚠ Item 13: a phone on an older app opens a character with a block a newer app wrote. Whatever this
 * file cannot read — an unknown kind, a NEWER version, an element it cannot parse — is returned as
 * `foreign` and kept as the very same object, in its place, by `writeStoredBlocks`. Fields this version
 * does not know, on a block it does know, are kept too. Nothing here ever filters `overrides.blocks`.
 *
 * Reading is never an edit (checker C4): nothing here writes, and part A never writes `overrides.v`.
 */
import type { BuildOverrides, TweakMeta } from '../types';
import { PROFICIENCY_RANKS } from '../types';
import { blockKind, type BlockInstance } from './registry';
import { targetDefFor } from './targets';

/** One element of `overrides.blocks`, as this version writes it. */
export interface StoredBlock {
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

/** The fields of a StoredBlock this version reads and writes. Any other field on a stored element was
 *  written by a newer app and is carried over untouched when the element is edited. */
const KNOWN_FIELDS = new Set(['id', 'kind', 'v', 'target', 'value', 'bonusType', 'reason', 'on', 'from', 'baseline']);

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

/** One stored element → an instance, or the reason it is kept as foreign. */
function readOne(raw: unknown): BlockInstance | ForeignBlock {
  if (!isObj(raw)) return { raw, why: 'unreadable' };
  const id = typeof raw.id === 'string' && raw.id ? raw.id : undefined;
  const def = typeof raw.kind === 'string' ? blockKind(raw.kind) : undefined;
  if (!def || def.storage.in !== 'blocks') return { raw, why: 'unknown-kind', id };
  const v = typeof raw.v === 'number' ? raw.v : NaN;
  if (v > def.version) return { raw, why: 'newer-version', id };
  // Version 1 is the first: an older version cannot exist yet. When a kind bumps its version, its
  // read-time migration goes HERE (spec item 3: migrate on read only, never write back on load).
  if (!(v === def.version) || !id) return { raw, why: 'unreadable', id };
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
    const kept = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k]) => !KNOWN_FIELDS.has(k)));
    list.push({ ...kept, ...upsert.get(id) });
  }
  for (const [id, b] of upsert) if (!done.has(id) && !refused.includes(id) && !before.some((raw) => isObj(raw) && raw.id === id)) list.push(b);
  return { list, refused };
}

/* ─────────────────────────────── today's Overrides keys, read as blocks ─────────────────────────────── */

const RANK_SET = new Set<string>(PROFICIENCY_RANKS);

/** A proficiencies key → the target key, the same split as build.ts's override loop: `perception` and
 *  `classDc` are their own stats, a save, weapon or armor track is that rank track, anything else is a
 *  skill or `lore:<slug>`. */
function proficiencyTarget(key: string): string {
  if (key === 'perception') return 'perception';
  if (key === 'classDc') return 'class-dc';
  if (['fortitude', 'reflex', 'will'].includes(key)) return `save:${key}`;
  if (['unarmed', 'simple', 'martial', 'advanced'].includes(key)) return `weapon:${key}`;
  if (['unarmored', 'light', 'medium', 'heavy'].includes(key)) return `armor:${key}`;
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

/** Today's 10 Overrides keys → block instances (kinds per the registry's `storage.key`). A stored entry
 *  this app cannot read is still listed, marked `broken`, never skipped (decision 13). */
export function readLegacyBlocks(ov: BuildOverrides | undefined): BlockInstance[] {
  if (!ov) return [];
  const out: BlockInstance[] = [];
  const meta = isObj(ov.meta) ? (ov.meta as Record<string, TweakMeta>) : {};
  const keyOf = keyer();
  /** `of` is what the entry is (its rank, value or id@level): meta written for something else is stale. */
  const push = (kind: string, base: string, of: string, more: Partial<BlockInstance>) => {
    const key = keyOf(base);
    const inst: BlockInstance = { kind, version: 1, key, source: { kind: 'tweak', id: key }, on: true, ...more };
    const m = meta[key];
    if (m && (m.of == null || m.of === of)) {
      if (m.on === false) inst.on = false;
      if (m.reason) inst.reason = m.reason;
      if (typeof m.from === 'number' && m.from > 1) inst.gate = { ...inst.gate, startLevel: m.from };
      if (typeof m.baseline === 'number') inst.params = { ...inst.params, baseline: m.baseline };
    }
    out.push(inst);
  };
  const list = <T,>(x: T[] | undefined): T[] => (Array.isArray(x) ? x : []);

  for (const [k, v] of Object.entries(isObj(ov.attributes) ? ov.attributes : {})) {
    const ok = typeof v === 'number' && Number.isFinite(v);
    push('attribute.set', `attributes:${k}`, String(v), { target: `score:${k}`, ...(ok ? { value: v } : { broken: `the score "${String(v)}" is not a number` }) });
  }
  for (const [k, r] of Object.entries(isObj(ov.proficiencies) ? ov.proficiencies : {})) {
    const m = meta[`proficiencies:${k}`];
    const mode = m && (m.of == null || m.of === r) ? m.mode : undefined;
    const kind = mode === 'atLeast' ? 'rank.atLeast' : mode === 'exactly' ? 'rank.exactly' : 'rank.legacySet';
    push(kind, `proficiencies:${k}`, String(r), { target: proficiencyTarget(k), ...(RANK_SET.has(r) ? { rank: r } : { broken: `the rank "${String(r)}" is not a proficiency rank` }) });
  }
  // build.ts reads `maxHp == null` as "no set", so a stored null is no tweak at all.
  if (ov.maxHp != null) {
    const ok = typeof ov.maxHp === 'number' && Number.isFinite(ov.maxHp);
    push('number.setMaxHp', 'maxHp:max-hp', String(ov.maxHp), { target: 'max-hp', ...(ok ? { value: ov.maxHp } : { broken: `"${String(ov.maxHp)}" is not a number` }) });
  }
  for (const f of list(ov.addedFeats)) {
    const id = `${f?.featId}@${f?.level}`;
    push('grant.feat', `addedFeats:${id}`, id, { record: f?.featId, params: { level: f?.level, category: f?.category }, ...(f?.featId ? {} : { broken: 'no feat named' }) });
  }
  for (const f of list(ov.addedFeatures)) {
    const id = `${f?.featureId}@${f?.level}`;
    push('grant.classFeature', `addedFeatures:${id}`, id, { record: f?.featureId, params: { level: f?.level }, ...(f?.featureId ? {} : { broken: 'no class feature named' }) });
  }
  for (const id of list(ov.addedLanguages)) push('grant.language', `addedLanguages:${id}`, String(id), { record: id });
  for (const s of list(ov.addedSpells)) {
    const id = `${s?.spellId}@${s?.rank}`;
    push('grant.spell', `addedSpells:${id}`, id, { record: s?.spellId, params: { rank: s?.rank }, ...(s?.spellId ? {} : { broken: 'no spell named' }) });
  }
  for (const id of list(ov.removedFeatIds)) push('remove.feat', `removedFeatIds:${id}`, String(id), { record: id });
  for (const id of list(ov.allowedFeats)) push('choice.allowAnyway', `allowedFeats:${id}`, String(id), { record: id });
  for (const id of Object.keys(ov.contentEdits?.feats ?? {})) push('text.edit', `contentEdits:feats/${id}`, `feats/${id}`, { record: `feats/${id}` });
  for (const id of Object.keys(ov.contentEdits?.classFeatures ?? {})) push('text.edit', `contentEdits:classFeatures/${id}`, `classFeatures/${id}`, { record: `classFeatures/${id}` });
  return out;
}

/** Every tweak a character carries: the old keys first, then `overrides.blocks`; plus what is kept unread. */
export function readTweaks(ov: BuildOverrides | undefined): { instances: BlockInstance[]; foreign: ForeignBlock[] } {
  const { known, foreign } = parseStoredBlocks(ov?.blocks);
  return { instances: [...readLegacyBlocks(ov), ...known], foreign };
}
