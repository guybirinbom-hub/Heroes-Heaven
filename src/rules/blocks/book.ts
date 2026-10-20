/*
 * BOOK BLOCKS — the blocks a book RECORD already holds, read from the fields it has today.
 *
 * Design: docs/overrides-redesign.md, Building blocks item 10 (with items 2, 4 and 5): "Move the field
 * READERS, not single records, so no field has two code paths." The records keep their fields exactly
 * as `npm run data` writes them (no change to scripts/data/effect-backfill.json, no new field). What
 * changes is who reads them: these fields are read HERE and nowhere else in src/, and every number
 * that used them now reads the blocks this file makes — through the same term lists the breakdowns
 * read (derive.ts), so a number and its breakdown see one list. `scripts/blocks-check.mjs` fails on a
 * read of one of these fields anywhere else (check.ts `checkBookFieldReaders`, with a short allowlist
 * of editors and look-alike fields, each with its reason).
 *
 * The fields (registry.ts, the `bookFields` of `number.add` and `rank.atLeast`):
 *   saveBonuses[]                     → number.add on `save:<save>`, typed as printed
 *   landSpeedBonus + speedBonusType   → number.add on `speed:land` (a formula stays a formula);
 *     + speedBonusAllSpeeds              "your SpeedS" is the block's `params.allSpeeds`
 *   whileActive[].landSpeedBonus (…)  → the same, gated: `gate.whileState` = the clause's state,
 *                                       `gate.startLevel` = its minLevel, `params.clause` = its index
 *   maxHpBonus                        → number.add on `max-hp`; the value is the record's own
 *                                       { perLevel, flat, perArchetypeFeat, archetype } (growingValue)
 *   passiveEffects.skills             → number.add on `skill:<key>`, item bonus (a negative one is an
 *                                       item penalty)
 *   effectChoices[].options[].grant.passive.skills — the answered option, as the build resolved it
 *                                     into `Character.resolvedItemPassives` → itemChoiceBlocks
 *   trainedSkill / trainedLore        → rank.atLeast 'trained' on `skill:<skill>` / `skill:lore:<slug>`
 *
 * KEYS (item 2, checker C15): `<collection>/<record id>#<field>@<target>`, e.g.
 * `feats/peerless-form#saveBonuses@save:fortitude`; a repeat of one key on the same record gets `~2`,
 * `~3` in the record's own order. A key names what the block IS, so it stays the same after a data
 * update that leaves the record's clause alone.
 *
 * CACHE. Blocks are made lazily, once per record OBJECT (a WeakMap, never a map by id): the trust
 * gate's copies and the contentEdits copies are new objects, so each gets its own blocks, and a db COPY
 * with a field stripped (the parity snapshot's class-feature twins) is read as it is. A record patched
 * IN PLACE (a test does `db.feats.toughness.landSpeedBonus = 10`) is seen too: each entry remembers the
 * field values it was read from and is rebuilt when one is a different value. A nested in-place edit
 * (one `saveBonuses[0].value`) is not looked for — no writer in src/ does that; they replace the field.
 */
import { loreKey } from '../loreKey';
import type { ModifierType, ProficiencyKey, SaveId, SkillId } from '../types';
import type { BlockGate, BlockInstance, BlockSource, BlockValue } from './registry';

/** The record collections whose fields this file reads. `chosenEffects` is the character's merged bag
 *  of answered choices (a `whileActive` clause a pick granted); it has no id of its own. */
export type BookCollection = 'feats' | 'heritages' | 'classFeatures' | 'items' | 'runes' | 'backgrounds' | 'chosenEffects';

/** The moved fields, as this file reads them (the record types in types.ts declare them). */
interface BookFields {
  id?: string;
  name?: string;
  saveBonuses?: { save?: SaveId; value?: unknown; type?: ModifierType }[];
  landSpeedBonus?: number | string;
  speedBonusType?: 'status' | 'item' | 'circumstance';
  speedBonusAllSpeeds?: true;
  whileActive?: { state?: string; landSpeedBonus?: number | string; speedBonusType?: 'status' | 'item' | 'circumstance'; speedBonusAllSpeeds?: true; minLevel?: number; from?: string }[];
  maxHpBonus?: { perLevel?: number; flat?: number; perArchetypeFeat?: number; archetype?: string };
  passiveEffects?: { skills?: Partial<Record<string, number>> };
  trainedSkill?: SkillId;
  trainedLore?: string | string[];
}

/** What each book block says about where it came from — for a reader that has to tell two fields of
 *  one record apart (a background's skill and its Lore) or find one `whileActive` clause's block. */
export interface BookParams {
  /** The field path, spelled as the registry's `bookFields` spell it. */
  field: string;
  /** `whileActive` blocks: the clause's index in the record's `whileActive` list. */
  clause?: number;
  /** A Speed bonus printed "to your Speeds" (`speedBonusAllSpeeds`): it reaches every movement type. */
  allSpeeds?: boolean;
  /** A `trainedLore` block: the subject as printed ("Scribing"). */
  subject?: string;
}
export const paramsOf = (b: BlockInstance): BookParams => (b.params ?? { field: '' }) as unknown as BookParams;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const BONUS_TYPES = new Set(['status', 'circumstance', 'item']);
const bonusTypeOf = (t: unknown): BlockInstance['bonusType'] => (typeof t === 'string' && BONUS_TYPES.has(t) ? (t as BlockInstance['bonusType']) : undefined);
/** A Speed value: a number, or a formula string resolved by the reader (it needs the Speeds in scope). */
const speedValue = (v: unknown): BlockValue | undefined => (typeof v === 'number' ? v : typeof v === 'string' ? { formula: v } : undefined);

function readBlocks(rec: BookFields, collection: BookCollection): BlockInstance[] {
  const out: BlockInstance[] = [];
  const recId = rec.id ? `${collection}/${rec.id}` : collection;
  const source = (name: string | undefined): BlockSource => ({ kind: 'book', id: recId, ...(typeof name === 'string' ? { name } : {}) });
  const used = new Map<string, number>();
  const keyOf = (field: string, target: string | undefined) => {
    const base = `${recId}#${field}@${target ?? 'none'}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  };
  const push = (kind: 'number.add' | 'rank.atLeast', params: BookParams, target: string | undefined, more: Partial<BlockInstance>, name = rec.name) =>
    out.push({ kind, version: 1, key: keyOf(params.field, target), source: source(name), ...(target ? { target } : {}), on: true, params: params as unknown as Record<string, unknown>, ...more });

  for (const sb of Array.isArray(rec.saveBonuses) ? rec.saveBonuses : []) {
    if (!isObj(sb) || typeof sb.save !== 'string') continue;
    const bonusType = bonusTypeOf(sb.type);
    push('number.add', { field: 'saveBonuses' }, `save:${sb.save}`, {
      ...(typeof sb.value === 'number' ? { value: sb.value } : { broken: `the bonus "${String(sb.value)}" is not a number` }),
      ...(bonusType ? { bonusType } : {}),
    });
  }
  const speed = (field: string, src: { landSpeedBonus?: unknown; speedBonusType?: unknown; speedBonusAllSpeeds?: unknown }, more: Partial<BlockInstance>, extra: Partial<BookParams>, name?: string) => {
    if (src.landSpeedBonus == null) return;
    const value = speedValue(src.landSpeedBonus);
    const bonusType = bonusTypeOf(src.speedBonusType);
    push(
      'number.add',
      { field, ...extra, ...(src.speedBonusAllSpeeds ? { allSpeeds: true } : {}) },
      'speed:land',
      { ...(value !== undefined ? { value } : { broken: `the Speed bonus "${String(src.landSpeedBonus)}" is not a number or a formula` }), ...(bonusType ? { bonusType } : {}), ...more },
      name,
    );
  };
  speed('landSpeedBonus', rec, {}, {});
  (Array.isArray(rec.whileActive) ? rec.whileActive : []).forEach((wa, clause) => {
    if (!isObj(wa) || typeof wa.state !== 'string') return;
    const gate: BlockGate = { whileState: wa.state, ...(typeof wa.minLevel === 'number' && wa.minLevel > 1 ? { startLevel: wa.minLevel } : {}) };
    // A clause a PICK granted carries the granting record's name (`from`); the bag itself has none.
    speed('whileActive.landSpeedBonus', wa, { gate }, { clause }, wa.from ?? rec.name);
  });
  // The record's own { perLevel, flat, perArchetypeFeat, archetype } IS the block's value (growingValue).
  if (isObj(rec.maxHpBonus)) push('number.add', { field: 'maxHpBonus' }, 'max-hp', { value: rec.maxHpBonus as BlockValue });
  const skills = isObj(rec.passiveEffects) && isObj(rec.passiveEffects.skills) ? rec.passiveEffects.skills : undefined;
  for (const [k, v] of Object.entries(skills ?? {})) {
    push('number.add', { field: 'passiveEffects.skills' }, `skill:${k}`, {
      bonusType: 'item',
      ...(typeof v === 'number' ? { value: v } : { broken: `the bonus "${String(v)}" is not a number` }),
    });
  }
  if (typeof rec.trainedSkill === 'string' && rec.trainedSkill) {
    push('rank.atLeast', { field: 'trainedSkill' }, `skill:${rec.trainedSkill}`, { rank: 'trained' });
  }
  for (const subject of [rec.trainedLore ?? []].flat()) {
    if (typeof subject !== 'string' || !subject) continue;
    const key = loreKey(subject);
    // A subject with nothing but the word "Lore" in it keys to nothing: listed (the Builder card prints
    // it), never applied — the build never trained one either.
    push('rank.atLeast', { field: 'trainedLore', subject }, key ? `skill:${key}` : undefined, { rank: 'trained', ...(key ? {} : { broken: `"${subject}" names no Lore subject` }) });
  }
  return out;
}

/* ─────────────────────────────── the cache ─────────────────────────────── */

interface Entry {
  sig: unknown[];
  blocks: BlockInstance[];
}
const CACHE = new WeakMap<object, Entry>();
const NONE: BlockInstance[] = [];
const sameSig = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/** The values an entry was read from: when any of them is a different value, the record was patched
 *  in place and its blocks are made again. */
function signature(r: BookFields, collection: BookCollection): unknown[] {
  const pe = isObj(r.passiveEffects) ? r.passiveEffects : undefined;
  return [collection, r.id, r.name, r.saveBonuses, r.landSpeedBonus, r.speedBonusType, r.speedBonusAllSpeeds, r.whileActive, r.maxHpBonus, pe, pe?.skills, r.trainedSkill, r.trainedLore];
}

/**
 * The book blocks of one record (a feat, heritage, class feature, item, rune or background — or the
 * character's `chosenEffects` bag), in the record's own order. An absent record has none.
 *
 * The collection names where the record lives, for its key; a record object lives in one collection.
 */
export function bookBlocksOf(record: object | null | undefined, collection: BookCollection): BlockInstance[] {
  if (!record || typeof record !== 'object') return NONE;
  const r = record as BookFields;
  const sig = signature(r, collection);
  const hit = CACHE.get(record);
  if (hit && sameSig(hit.sig, sig)) return hit.blocks;
  const made = readBlocks(r, collection);
  const blocks = made.length ? made : NONE;
  CACHE.set(record, { sig, blocks });
  return blocks;
}

/**
 * The skill blocks of an item's ANSWERED "choose one of N" (`effectChoices[].options[].grant.passive
 * .skills`), from the bag the build (and play, for gear bought on the sheet) resolved it into:
 * `Character.resolvedItemPassives[itemId]`. Keyed `items/<id>#effectChoices.grant.passive.skills@…`.
 *
 * Cached per bag object and re-read when its `skills` is a different object: both writers
 * (buildCharacter, play.ts resolvePlayItemPassives) REPLACE `skills` on every merge, and the play one
 * merges into the build's bag in place.
 */
export function itemChoiceBlocks(itemId: string, resolved: { skills?: Partial<Record<string, number>> } | null | undefined, name?: string): BlockInstance[] {
  if (!resolved || typeof resolved !== 'object') return NONE;
  const sig = ['itemChoice', itemId, name, resolved.skills];
  const hit = CACHE.get(resolved);
  if (hit && sameSig(hit.sig, sig)) return hit.blocks;
  const out: BlockInstance[] = [];
  const id = `items/${itemId}`;
  for (const [k, v] of Object.entries(isObj(resolved.skills) ? resolved.skills : {})) {
    out.push({
      kind: 'number.add',
      version: 1,
      key: `${id}#effectChoices.grant.passive.skills@skill:${k}`,
      source: { kind: 'book', id, ...(name ? { name } : {}) },
      target: `skill:${k}`,
      bonusType: 'item',
      ...(typeof v === 'number' ? { value: v } : { broken: `the bonus "${String(v)}" is not a number` }),
      on: true,
      params: { field: 'effectChoices.grant.passive.skills' },
    });
  }
  const blocks = out.length ? out : NONE;
  CACHE.set(resolved, { sig, blocks });
  return blocks;
}

/* ─────────────────────────────── reading them ─────────────────────────────── */

/** The standing (always-on) `number.add` blocks on one target: not state-gated, not broken. */
export function standingNumberBlocks(blocks: BlockInstance[], target: string): BlockInstance[] {
  return blocks.filter((b) => b.kind === 'number.add' && b.target === target && !b.gate?.whileState && !b.broken && b.value !== undefined);
}

/** The state-gated `number.add` blocks one `whileActive` clause holds (by its index on the record). */
export function clauseNumberBlocks(blocks: BlockInstance[], clause: number, target: string): BlockInstance[] {
  return blocks.filter((b) => b.kind === 'number.add' && b.target === target && !!b.gate?.whileState && paramsOf(b).clause === clause && !b.broken && b.value !== undefined);
}

/** A plain-number block's value for a pool (a growing or formula value is the reader's to resolve). */
export const blockNumber = (b: BlockInstance): number => (typeof b.value === 'number' ? b.value : 0);

/**
 * A value that grows: a number as it is; the max-HP shape `{ perLevel, flat, perArchetypeFeat,
 * archetype }` resolved at a level — `perArchetypeFeat` counts the character's feats of that archetype
 * (the dedication counts), which the caller supplies because the build and derive hold feats
 * differently. A formula is not this function's (a Speed formula needs the Speeds in scope): 0.
 */
export function growingValue(v: BlockValue | undefined, ctx: { level: number; archetypeFeats: (archetype: string) => number }): number {
  if (typeof v === 'number') return v;
  if (!v || 'formula' in v) return 0;
  let n = (v.perLevel ?? 0) * ctx.level + (v.flat ?? 0);
  if (v.perArchetypeFeat && v.archetype) n += v.perArchetypeFeat * ctx.archetypeFeats(v.archetype);
  return n;
}

/**
 * A background's own trainings, from its book blocks: the fixed skill (`trainedSkill`) and each printed
 * Lore (`trainedLore`, one subject or several) with its key (null for a subject that names no Lore).
 * The background's CHOICES (`trainedSkillChoice`, `trainedLoreOptions`, …) are not here — they are
 * answers, read by the build.
 */
export function backgroundTrainings(background: object | null | undefined): { skill?: SkillId; lores: { subject: string; key: ProficiencyKey | null }[] } {
  let skill: SkillId | undefined;
  const lores: { subject: string; key: ProficiencyKey | null }[] = [];
  for (const b of bookBlocksOf(background, 'backgrounds')) {
    if (b.kind !== 'rank.atLeast') continue;
    const p = paramsOf(b);
    if (p.field === 'trainedSkill' && b.target && !skill) skill = b.target.slice('skill:'.length) as SkillId;
    else if (p.field === 'trainedLore' && p.subject) lores.push({ subject: p.subject, key: b.target ? (b.target.slice('skill:'.length) as ProficiencyKey) : null });
  }
  return { skill, lores };
}

/** Does this background's own printed training (its fixed skill or one of its Lores) name `key`? */
export function backgroundTrains(background: object | null | undefined, key: ProficiencyKey): boolean {
  return bookBlocksOf(background, 'backgrounds').some((b) => b.kind === 'rank.atLeast' && b.target === `skill:${key}` && !b.broken);
}
