/*
 * THE FEATS A BUILD HOLDS, for every rule that reads the build rather than a built character — case D of
 * docs/overrides-redesign.md spec item 2 (Building blocks item 9): a feat given through Tweaks
 * (`overrides.addedFeats`) works exactly like the same feat picked in a slot.
 *
 * Before this, about forty readers walked `build.featPicks` alone, so a given feat reached
 * `buildCharacter`'s feat list and nothing else: Flexible Spellcaster Dedication given to a cleric left
 * the cleric preparing five cantrips from the whole list, a given Rogue Dedication never handed over its
 * skill feat, a given Adopted Ancestry opened no ancestry feats. Every such reader now asks here.
 *
 * Plan: work/tweaks-part-a-notes/tweaks-part-a-caseD-plan.md (decisions D1–D8 are binding). The rules:
 *   - ORDER: slot entries in `Object.entries(featPicks)` order, then pick-a-feat answers, then dedication
 *     bonus skill feats, then given feats in `addedFeats` order — so a walker that stops at its first
 *     match answers exactly as before for every character that holds no given feat.
 *   - SLOT ENTRIES are never level-filtered, deduped or dropped for removal here (checker C6): each walker
 *     keeps its own rule (`e.level` is the slot key's level, NaN kept, for the walkers that compare it).
 *     Only an empty pick is skipped.
 *   - GIVEN ENTRIES (`via: 'override'`, slot key `override:<featId>` — where the given feat's answers live)
 *     are the ACTIVE ones (on, not broken, the master switch on or import-stamped: `activeGivenFeats`),
 *     held at `level ?? build.level` (D5: a walker with no level rule of its own gates given feats at the
 *     character's level, as `buildCharacter` always has), one per feat id, none whose feat a slot at or
 *     below that level already holds (`buildCharacter`'s `takenFeats.has`), and none the player removed
 *     (a LIVE `removedFeatIds` entry, `liveRemovedFeatIds`, D1 — the sheet drops it too). Start level =
 *     max(stored level, meta.from) (D6).
 *   - `via` defaults to slot + override. `pickFeat` and `dedicationSkill` are only for the two walkers that
 *     read those maps today (`buildUsesDeity`, buildCharacter's `heldFeatIdsEarly`): a walker that never
 *     saw a granted feat must not start seeing one here.
 *
 * Structural input on purpose: derive.ts (`splinterDomainsOf`), featSlots.ts and kineticElements.ts call
 * it, and build.ts imports derive.ts — so this module imports types, the tweak readers (blocks/stored.ts,
 * blocks/active.ts) and featGrants.ts' `maxTakes` (a leaf: it imports no rules module that imports this) only.
 *
 * A GIVEN copy of a feat a slot already holds (WP8 round 4, F1) counts too while a LIVE "Take a feat more times"
 * for it leaves room (`givenCopyCounts`, blocks/active.ts — the same rule as buildCharacter's given-feat loop). With
 * no live block it is dropped, as it always was.
 *
 * TWO VIEWS (Tweaks phase 2, WP7, C9). An extra feat place (`choice.addPlace`, its pick under
 * `<level>:extra<category>:<n>`) whose block this app can read and that is not live — paused, or every tweak
 * switched off — ADDS nothing while so (C5): the place, its feat and everything that feat grants stop counting.
 *   - the LIVE view (the default) is what the character holds now: it skips such a key's slot entry, a pick-a-feat
 *     answer keyed under it, a dedication bonus skill feat whose dedication sits only in such places, and it does
 *     not count such a key as the slot that already holds a given feat (`slotted`), as `buildCharacter` does;
 *   - the STORAGE view (`includePaused: true`) is today's list, every stored pick: the rules that decide what may
 *     be PICKED or where slots are DRAWN read it, so a pause never frees a pick that resuming would break and never
 *     moves a slot (no rekey on pause, C11).
 * A place key with no block, or an unreadable or newer one, is held in both views (UNKNOWN ≠ EMPTY). With no
 * held-back place the two views are the same list.
 */
import { givenCopyCounts, heldBackPlaceKeys, liveRemovedFeatIds, placeLiveForKey } from './blocks/active';
import { activeGivenFeats } from './blocks/stored';
import { maxTakes } from './featGrants';
import type { BuildOverrides, CharacterOptions } from './types';

/** An extra feat place's key category is `extra<category>` (blocks/active.ts `featPlaceKey`, C8). */
const EXTRA = 'extra';

/**
 * THE book category of a slot key (C10): its second part, with an extra place's `extra` taken off
 * (`4:extraclass:483920` → 'class'); a book key's category unchanged (`4:class:0` → 'class'). Pure string, any key
 * (a malformed one keeps today's reading: what stands after the first ':'). Every reader asking "what kind of feat
 * place is this key" reads it here. Only the slot geometry (featSlots.ts `rekeyFeatSlots`, `picksLosingSlot`) and
 * the `buildCharacter` featPicks loop's `Character.feats` row keep the raw category, on purpose (C10, rev 3 s2) —
 * the slot-category ratchet (scripts/blocks-check.mjs) holds every other read to this helper.
 */
export function slotCategoryOf(key: string): string | undefined {
  const cat = key.split(':')[1];
  return cat !== undefined && cat.length > EXTRA.length && cat.startsWith(EXTRA) ? cat.slice(EXTRA.length) : cat;
}

/** Which takings to list, and which view (the header). */
export interface HeldOpts {
  via?: readonly HeldVia[];
  /** The storage view: held-back extra places' takings kept (C9). Default: the live view. */
  includePaused?: boolean;
  /** WP8 round 4 (F1): the feat records, for a given copy's BOOK take cap (`maxTakes`) when a live "Take a feat more
   *  times" lets it count beside slot copies of the same feat. Absent: a once-only feat's cap (1) — exact for every
   *  once-only feat; the take gates (buildCharacter, featSlots `takenElsewhere`, `heldPickGranters`) pass it. Never
   *  read while no live block exists. */
  feats?: Readonly<Record<string, { maxTakable?: number | null } | undefined>>;
}

const NONE: ReadonlySet<string> = new Set();

/** How a feat reached the build. `pickFeat` = a `pickFeatChoices` answer — named after its store, and never
 *  bare `pick`: that is also the pick weapon's record id, and scripts/trust-lanes-check.mjs reads
 *  `.includes('pick')` in src/rules as a hard-coded lane on that record (it went red on exactly this). */
export type HeldVia = 'slot' | 'pickFeat' | 'dedicationSkill' | 'override';

/** The parts of a BuildState this reads. */
export interface HeldInput {
  featPicks?: Record<string, string | null | undefined>;
  pickFeatChoices?: Record<string, string>;
  dedicationSkillFeats?: Record<string, string>;
  overrides?: BuildOverrides;
  options?: CharacterOptions;
  level?: number;
}

export interface HeldFeatSlot {
  featId: string;
  via: HeldVia;
  /** Where its answers are keyed: the `featPicks` slot key (`4:class:0`), the `pickFeatChoices` /
   *  `dedicationSkillFeats` key, or `override:<featId>` for a given feat. */
  slotKey: string;
  /** slot: `Number(slotKey.split(':')[0])` (NaN kept — each walker keeps its own reading of a malformed
   *  key); override: the given feat's start level; pickFeat / dedicationSkill: NaN (no level of their own). */
  level: number;
  /** slot: the key's book category (`slotCategoryOf`: an extra place's `extraclass` reads 'class'); override: the
   *  stored category; dedicationSkill: 'skill'. */
  category?: string;
  /** A given feat's Tweaks instance key (`addedFeats:<featId>@<level>`). */
  tweakKey?: string;
}

/** The slot key a given feat's answers are stored under (`featChoices`, `featSpellChoices`, `effectChoices`
 *  `override:<id>:<choice>`, `pickFeatChoices`) — spec item 1 keeps this stored name forever. */
export const OVERRIDE_SLOT = 'override:';
export const overrideSlotKey = (featId: string): string => `${OVERRIDE_SLOT}${featId}`;

const DEFAULT_VIA: readonly HeldVia[] = ['slot', 'override'];

/** Every feat the build holds, as one list of takings (see the header for the rules and the two views). */
export function heldFeatSlots(build: HeldInput, level?: number, opts?: HeldOpts): HeldFeatSlot[] {
  const via = opts?.via ?? DEFAULT_VIA;
  const out: HeldFeatSlot[] = [];
  const picks = build.featPicks ?? {};
  // C9: the extra places held back now (paused / Tweaks off). The live view skips their takings; the storage view
  // (and every character with none — the empty set, one cached lookup) lists exactly what is stored.
  const back = opts?.includePaused ? NONE : heldBackPlaceKeys(build);
  const live = (key: string) => !back.size || placeLiveForKey(build, key);
  if (via.includes('slot')) {
    for (const [slotKey, featId] of Object.entries(picks)) {
      if (!featId || !live(slotKey)) continue;
      const category = slotCategoryOf(slotKey);
      out.push({ featId, via: 'slot', slotKey, level: Number(slotKey.split(':')[0]), ...(category ? { category } : {}) });
    }
  }
  if (via.includes('pickFeat')) {
    for (const [slotKey, featId] of Object.entries(build.pickFeatChoices ?? {})) if (featId && live(slotKey)) out.push({ featId, via: 'pickFeat', slotKey, level: NaN });
  }
  if (via.includes('dedicationSkill')) {
    // A bonus skill feat whose dedication is held ONLY in held-back places stops with it (its key is the
    // dedication's id, `<id>` or `<id>:<n>`). A dedication held nowhere keeps today's reading (UNKNOWN ≠ EMPTY).
    const onlyHeldBack = back.size ? heldOnlyInHeldBack(build) : undefined;
    for (const [slotKey, featId] of Object.entries(build.dedicationSkillFeats ?? {}))
      if (featId && !onlyHeldBack?.(slotKey.split(':')[0])) out.push({ featId, via: 'dedicationSkill', slotKey, level: NaN, category: 'skill' });
  }
  if (via.includes('override')) {
    const given = activeGivenFeats(build.overrides, build.options);
    if (given.length) {
      const gate = level ?? build.level;
      // The LIVE removals only (blocks/active.ts, plan B WP2): a paused removal gives the feat back.
      const removed = liveRemovedFeatIds(build);
      // A slot at or below the gate that holds the feat already takes it — buildCharacter's `takenFeats.has`. In
      // the live view a held-back place takes nothing (buildCharacter skips it), so the given copy is held.
      const slottedAt = (k: string, v: string | null | undefined, id: string) => {
        if (v !== id || !live(k)) return false;
        const lv = Number(k.split(':')[0]);
        return Number.isFinite(lv) && (gate == null || lv <= gate);
      };
      const slotted = (id: string) => Object.entries(picks).some(([k, v]) => slottedAt(k, v, id));
      const slottedCount = (id: string) => Object.entries(picks).filter(([k, v]) => slottedAt(k, v, id)).length;
      const seen = new Set<string>();
      for (const g of given) {
        if (gate != null && g.level > gate) continue;
        // One given copy per feat id (they share the one answer key `override:<id>`).
        if (seen.has(g.featId) || removed.has(g.featId)) continue;
        // WP8 round 4 (F1): a slotted feat's given copy is dropped (today) unless a LIVE "Take a feat more times"
        // lets it count beside the slot copies (`givenCopyCounts`, the rule buildCharacter's given-feat loop reads).
        if (slotted(g.featId) && !givenCopyCounts(build, g.featId, () => slottedCount(g.featId), () => maxTakes(opts?.feats?.[g.featId]))) continue;
        seen.add(g.featId);
        out.push({
          featId: g.featId,
          via: 'override',
          slotKey: overrideSlotKey(g.featId),
          level: g.level,
          ...(g.category ? { category: g.category } : {}),
          tweakKey: g.key,
        });
      }
    }
  }
  return out;
}

/** In the live view: is `featId` held ONLY in held-back extra places — stored there, and in no live slot, live
 *  pick-a-feat answer or given feat? (A dedication's bonus skill feat stops with such a dedication.) */
function heldOnlyInHeldBack(build: HeldInput): (featId: string) => boolean {
  const backIds = new Set(Object.entries(build.featPicks ?? {}).flatMap(([k, v]) => (v && !placeLiveForKey(build, k) ? [v] : [])));
  if (!backIds.size) return () => false;
  const liveIds = new Set(heldFeatIds(build, undefined, { via: ['slot', 'pickFeat', 'override'] }));
  return (featId) => backIds.has(featId) && !liveIds.has(featId);
}

/** The ids of `heldFeatSlots`, in its order (a feat in two slots is listed twice, as the slots list it). */
export const heldFeatIds = (build: HeldInput, level?: number, opts?: HeldOpts): string[] =>
  heldFeatSlots(build, level, opts).map((e) => e.featId);

/** The feat a slot key holds: `featPicks[slotKey]`, or — for `override:<featId>` — that feat while it is an
 *  active given feat at the character's level. */
export function featIdAtSlot(build: HeldInput, slotKey: string): string | undefined {
  if (!slotKey.startsWith(OVERRIDE_SLOT)) return build.featPicks?.[slotKey] ?? undefined;
  const id = slotKey.slice(OVERRIDE_SLOT.length);
  return heldFeatSlots(build, undefined, { via: ['override'] }).some((e) => e.featId === id) ? id : build.featPicks?.[slotKey] || undefined;
}
