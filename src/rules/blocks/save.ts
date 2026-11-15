/*
 * THE SAVE PATH — the Builder-open stamp, the Save stamp, and the casting-change check (plan B WP4;
 * work/tweaks-part-b-notes/plan.md section 1 "WP4", section 3.3, decisions B4, B11, B16, B26, B27).
 *
 * `openForTweaks(build, content)` runs ONCE, in the Builder's `useUndoableState` initializer (both hosts —
 * the player's App and the GM's edit sheet — open the Builder through it). It stamps the DRAFT, never
 * storage: the stamped build reaches storage only through the Builder's `submit` → `onCreate`, which runs
 * `stampTweaksSave` (the same steps; a no-op on a stamped build, so a second Save writes nothing more; it
 * catches an entry an un-routed writer added while the Builder was open). Cancel stores nothing and asks
 * nothing: the Builder's `useBuildChanged` takes the stamped draft as its start.
 *
 * The steps (section 3.3):
 *   1. nothing stored in `overrides` (no entry, no block, no key this version does not know — `v` and meta
 *      alone are no tweak, B15) → the build itself;
 *   2. `v: Math.max(2, stored v)` (B27: a newer app's `v: 3` stays 3) and, while the stored switch is not
 *      yet the authority (no `v ≥ 2`), `options.overridesEnabled = tweaksSwitchOn(build)` — an old
 *      character reads ON, so it is stamped true (today's switch only hid the card);
 *   3. every old entry (`legacyEntries`) WITHOUT matching meta: `meta[key] = { of, moved: true }`, plus
 *      `mode` for a rank (from `buildCharacter(build, content).tweakRankSort` — THE sort the sheet used,
 *      same function, same db) and `baseline` for a set (`attributes:<ab>`, `maxHp:max-hp`, from
 *      blocks/baseline.ts `baselineFor`, the function the TweakEditor calls too). A STALE meta (its `of`
 *      names another value) keeps ONLY its `reason`: its on / from / source / baseline / mode belonged to
 *      the old value and the reader ignores them today, so bringing any back would move a number at open.
 *      An old rank entry WITH matching meta but no `mode` (a reason written before Tweaks) is frozen too:
 *      `{ ...meta, mode, of, moved: true }`, exactly what the read-time sort lays over it in memory
 *      (blocks/migrate.ts `withRankSort`). A matching meta whose `mode` this version does not know (a newer
 *      app's) is never rewritten. A build with no class (a new character before its class is picked), or
 *      one that cannot be built, has no sheet to sort or measure against: its ranks and sets are left as
 *      stored, and the first Save of a real character stamps them whole. (A build-less character whose
 *      reverse build throws never reaches the Builder now: `editableBuildOf` refuses it, 2026-10-23);
 *   4. an import-stamped entry (`source: 'import'`) is never marked `moved`.
 * After the stamp the sort never runs again for those entries: a later level-up cannot flip "at least" to
 * "exactly" (B4). Nothing a reader turns into a number changes — `moved` and `baseline` are read by no
 * non-rank number, and a rank's stamped `{ mode, of, moved }` is what `withRankSort` already fed it.
 *
 * UNKNOWN ≠ EMPTY: every key of `overrides` is carried by spread, byte-equal (spec 1: older apps read the old
 * keys); a meta that is not a map (a newer app's) is kept as it is and nothing is stamped into it; a meta
 * value that is not an object is never rewritten.
 *
 * `castingEntryChanges(prev, next)` lists the casting entries a Save changes (B16) — the Builder's `submit`
 * asks first through builder/tweaks/castingConfirm.tsx.
 *
 * A home file of the overrides-readers guard (blocks/check.ts OVERRIDES_READERS_HOME_NAMES). build.ts never
 * imports this file.
 */
import { buildCharacter, type BuildState } from '../build';
import type { BuildOverrides, Character, ContentDatabase, SpellcastingEntry, SpellcastingType, TweakMeta } from '../types';
import { baselineFor } from './baseline';
import { unsortedRankKeys } from './migrate';
import { legacyEntries, tweaksSwitchOn, type LegacyEntry } from './stored';
import { overrideHasContent } from './write';

type Meta = Record<string, TweakMeta>;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Step 1: does `overrides` store anything — an old-key entry, a block, a key this version does not know?
 *  `v` and `meta` alone are no tweak (B15: an empty shell is a character with none). */
function storesTweaks(ov: BuildOverrides): boolean {
  return Object.entries(ov as Record<string, unknown>).some(([k, x]) => k !== 'v' && k !== 'meta' && overrideHasContent(x, 1));
}

/** A matching rank meta the stamp may freeze: an object with NO `mode` at all (a reason written before
 *  Tweaks, an import mark). A mode this version does not know (a newer app's) is never rewritten (plan
 *  3.1 sorts only keys whose meta has no mode; UNKNOWN ≠ EMPTY). */
const freezable = (m: TweakMeta | undefined): boolean => isObj(m) && m.mode === undefined;

/** The meta step 3 writes, by key; `null` when every entry is stamped already. */
function metaStamps(build: BuildState, content: ContentDatabase, ov: BuildOverrides, meta: Meta): Meta | null {
  // The old rank entries still read as today's `=` that the read-time sort can answer (blocks/migrate.ts).
  const sortable = new Set(unsortedRankKeys(ov));
  const needs: { e: LegacyEntry; m: TweakMeta | undefined; matching: boolean }[] = [];
  for (const e of legacyEntries(ov)) {
    const m = meta[e.key];
    const matching = !!m && (m.of == null || m.of === e.of); // the reader's own test (stored.ts readLegacyBlocks)
    const rankToFreeze = e.list === 'proficiencies' && sortable.has(String(e.index));
    if (!matching) needs.push({ e, m, matching });
    else if (rankToFreeze && freezable(m)) needs.push({ e, m, matching });
  }
  if (!needs.length) return null;

  // The character this build makes with this db: its rank sort is THE sort the sheet used, and its numbers
  // the baselines. Built once, and only when an entry needs it. There is no such character when the build
  // has no class (a new character before its class is picked: its sort and its numbers belong to no sheet)
  // or cannot be built; the stamp itself must never stop the Builder.
  let built: Character | null | undefined;
  const character = (): Character | null => {
    if (built === undefined) {
      if (!build.classId) built = null;
      else {
        try {
          built = buildCharacter(build, content);
        } catch {
          built = null;
        }
      }
    }
    return built;
  };
  const modeOf = (e: LegacyEntry) => (sortable.has(String(e.index)) ? character()?.tweakRankSort?.[String(e.index)] : undefined);
  // An entry whose stamp is read off the character: a sortable rank (its mode) and a set (its baseline).
  const needsCharacter = (e: LegacyEntry) => (e.list === 'proficiencies' && sortable.has(String(e.index))) || e.list === 'attributes' || e.list === 'maxHp';

  const out: Meta = {};
  for (const { e, m, matching } of needs) {
    // No character to read the mode or baseline off: that entry is left exactly as stored (the read-time
    // sort keeps answering for a rank) and the first Save of a real character stamps it whole. Stamping
    // `{ of, moved }` now would make its meta "matching" for good, and a set's baseline would never come.
    if (needsCharacter(e) && !character()) continue;
    if (matching) {
      // Only an old rank entry with matching meta and no mode reaches here (`needs` above); a matching meta
      // is never rewritten otherwise. Freeze the sort into it, as `withRankSort` lays it.
      if (!freezable(m)) continue;
      const mode = modeOf(e);
      if (!mode) continue;
      out[e.key] = { ...m, mode, of: e.of, ...(m?.source === 'import' ? {} : { moved: true as const }) };
      continue;
    }
    // No meta, or a stale one: only its reason comes along (opening moves no number).
    const reason = isObj(m) && typeof m.reason === 'string' && m.reason ? m.reason : undefined;
    const next: TweakMeta = { ...(reason ? { reason } : {}), of: e.of, moved: true };
    if (e.list === 'proficiencies') {
      const mode = modeOf(e);
      if (mode) next.mode = mode;
    } else if (e.list === 'attributes' || e.list === 'maxHp') {
      const c = character();
      const b = c ? baselineFor(c, content, e.list === 'maxHp' ? 'max-hp' : `score:${String(e.index)}`, build) : undefined;
      if (b !== undefined) next.baseline = b;
    }
    out[e.key] = next;
  }
  return Object.keys(out).length ? out : null;
}

/** Section 3.3, steps 1-4. The build itself when nothing changes (so a second run writes nothing). */
function stamp(build: BuildState, content: ContentDatabase): BuildState {
  const ov = build.overrides;
  if (!ov || !isObj(ov) || !storesTweaks(ov)) return build;
  const vNow: unknown = ov.v;
  const readsOption = typeof vNow === 'number' && vNow >= 2; // tweaksSwitchOn's own test
  const vNext = typeof vNow === 'number' && Number.isFinite(vNow) ? Math.max(2, vNow) : 2; // B27
  const on = tweaksSwitchOn(build); // read BEFORE anything is written
  const metaIn: unknown = ov.meta;
  // A meta that is not a map was written by something this version does not know: kept, never stamped into.
  const meta: Meta | null = metaIn === undefined ? {} : isObj(metaIn) ? (metaIn as Meta) : null;
  const stamps = meta ? metaStamps(build, content, ov, meta) : null;
  const vChanged = vNow !== vNext;
  const optionChanged = !readsOption && build.options?.overridesEnabled !== on;
  if (!vChanged && !optionChanged && !stamps) return build;
  // `v` is readonly on the type (only this file, setTweaksSwitch and writeTweak write it).
  const overrides = { ...ov, ...(vChanged ? { v: vNext } : {}), ...(stamps ? { meta: { ...meta, ...stamps } } : {}) } as BuildOverrides;
  return {
    ...build,
    overrides,
    ...(optionChanged ? { options: { ...(build.options ?? {}), overridesEnabled: on } } : {}),
  };
}

/**
 * B4 — the Builder-open stamp: the draft the Builder edits, with `v`, the switch and every old entry's
 * `mode` / `of` / `moved` / `baseline` stamped (see the header). Returns `build` ITSELF when there is nothing
 * to stamp. Never stores: only Save does.
 */
export function openForTweaks(build: BuildState, content: ContentDatabase): BuildState {
  return stamp(build, content);
}

/**
 * The same stamp, run by the Builder's `submit` on the build it hands to `onCreate`. Idempotent: on a draft
 * `openForTweaks` stamped it returns the build itself; it stamps only an entry added without meta since.
 */
export function stampTweaksSave(build: BuildState, content: ContentDatabase): BuildState {
  return stamp(build, content);
}

/* ─────────────────────── skill order (plan work/skill-rank-level-by-level/plan.md D13, WP9) ─────────────────────── */

/** Has this build been opened by an app that works skill ranks out level by level (`BuildState.skillOrder`)? A
 *  newer app's higher number counts; anything else (absent, a string) does not — UNKNOWN ≠ EMPTY. */
export function skillOrderStamped(build: Pick<BuildState, 'skillOrder'>): boolean {
  const v: unknown = build.skillOrder;
  return typeof v === 'number' && v >= 2;
}

/** The stamp itself: the build ITSELF when already stamped (a second run writes nothing; a newer app's number is
 *  kept), else a copy with `skillOrder: 2`. Nothing else is touched — every stored answer, the orphaned
 *  replacement picks included (plan 3.2), rides along byte-equal. */
function stampSkillOrder(build: BuildState): BuildState {
  return skillOrderStamped(build) ? build : { ...build, skillOrder: 2 };
}

/**
 * D13 — the Builder-open stamp for the skill order, beside `openForTweaks` (the player's host only: the GM's edit
 * sheet passes `skillOrderNotice={false}` and the Builder never calls this there). It stamps the DRAFT, never
 * storage: the Builder computes its one-time notice from the unstamped `initial` first (skillOrderNotice.ts), and
 * `useBuildChanged` takes the stamped draft as its start, so Cancel asks nothing and stores nothing — the notice
 * shows again on the next open. `content` is unused (same shape as `openForTweaks`).
 */
export function openForSkillOrder(build: BuildState, _content: ContentDatabase): BuildState {
  return stampSkillOrder(build);
}

/** The same stamp, run by the Builder's `submit` on the build it hands to `onCreate`, so the notice never shows
 *  again after a Save. Idempotent. */
export function stampSkillOrderSave(build: BuildState, _content: ContentDatabase): BuildState {
  return stampSkillOrder(build);
}

/* ─────────────────────────────── B16: the casting entries a Save changes ─────────────────────────────── */

/** One casting entry a Save changes: its id and name (as the character before the Save shows it) and one
 *  short line per change ("prepared → spontaneous"). */
export interface CastingChange {
  id: string;
  name: string;
  what: string[];
}

/** The entry types that hold spells the player prepares or chooses (`play.preparedSpells`,
 *  `play.repertoireSpells`). Focus, innate, item and ritual entries are granted lists: a Save that changes
 *  them loses no choice of the player's, so they never ask. */
const CHOSEN: ReadonlySet<SpellcastingType> = new Set<SpellcastingType>(['prepared', 'spontaneous']);

const TYPE_WORD: Record<SpellcastingType, string> = {
  prepared: 'prepared',
  spontaneous: 'spontaneous',
  focus: 'focus',
  innate: 'innate',
  ritual: 'ritual',
  items: 'items',
};

/** Prepared slots, every rank. */
function preparedSlots(e: SpellcastingEntry): number {
  return Object.values(e.prepared ?? {}).reduce((n, s) => n + (Array.isArray(s) ? s.length : 0), 0);
}

/** How many spells of its own the entry may know: a Flexible Spellcaster collection's size, else per rank
 *  1+ the repertoire maximum where it differs from the slot count, else the slot count. */
function repertoirePlaces(e: SpellcastingEntry): number {
  if (typeof e.spellCollection === 'number') return e.spellCollection;
  const ranks = new Set([...Object.keys(e.repertoireMax ?? {}), ...Object.keys(e.slots ?? {})].map(Number));
  let n = 0;
  for (const r of ranks) if (r >= 1) n += e.repertoireMax?.[r] ?? e.slots?.[r]?.max ?? 0;
  return n;
}

/**
 * B16 — the casting entries a Save changes, matched by `SpellcastingEntry.id` (`prev` = the character as
 * stored, `next` = the character the Save makes): an entry gone; its type changed ("prepared →
 * spontaneous"); a prepared entry left with no prepared slots; a smaller repertoire (places to know spells,
 * never the picks: a spell the player removes in the Builder is their own change); a smaller cantrip
 * count. Only entries that hold the player's prepared or chosen spells (`CHOSEN`). In `prev`'s order;
 * empty when nothing changes.
 */
export function castingEntryChanges(prev: Character, next: Character): CastingChange[] {
  const out: CastingChange[] = [];
  const after = new Map((next.spellcasting ?? []).map((e) => [e.id, e] as const));
  for (const was of prev.spellcasting ?? []) {
    if (!CHOSEN.has(was.type)) continue;
    const now = after.get(was.id);
    const what: string[] = [];
    if (!now) what.push('removed');
    else {
      if (now.type !== was.type) what.push(`${TYPE_WORD[was.type] ?? was.type} → ${TYPE_WORD[now.type] ?? now.type}`);
      else if (was.type === 'prepared' && preparedSlots(was) > 0 && preparedSlots(now) === 0) what.push('no prepared spell slots left');
      if (was.type === 'spontaneous' && now.type === 'spontaneous') {
        const a = repertoirePlaces(was);
        const b = repertoirePlaces(now);
        if (b < a) what.push(`repertoire ${a} → ${b} spells`);
      }
      if (typeof was.cantripCap === 'number' && typeof now.cantripCap === 'number' && now.cantripCap < was.cantripCap)
        what.push(`cantrips ${was.cantripCap} → ${now.cantripCap}`);
    }
    if (what.length) out.push({ id: was.id, name: was.name, what });
  }
  return out;
}
