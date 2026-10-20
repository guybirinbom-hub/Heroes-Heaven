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
 *     are the ACTIVE ones (on, not broken, the master switch on: `activeGivenFeats`), held at
 *     `level ?? build.level` (D5: a walker with no level rule of its own gates given feats at the
 *     character's level, as `buildCharacter` always has), one per feat id, none whose feat a slot at or
 *     below that level already holds (`buildCharacter`'s `takenFeats.has`), and none the player removed
 *     (`removedFeatIds`, D1 — the sheet drops it too). Start level = max(stored level, meta.from) (D6).
 *   - `via` defaults to slot + override. `pickFeat` and `dedicationSkill` are only for the two walkers that
 *     read those maps today (`buildUsesDeity`, buildCharacter's `heldFeatIdsEarly`): a walker that never
 *     saw a granted feat must not start seeing one here.
 *
 * Structural input on purpose: derive.ts (`splinterDomainsOf`), featSlots.ts and kineticElements.ts call
 * it, and build.ts imports derive.ts — so this module imports types and the stored reader only.
 */
import { activeGivenFeats } from './blocks/stored';
import type { BuildOverrides, CharacterOptions } from './types';

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
  /** slot: the key's category; override: the stored category; dedicationSkill: 'skill'. */
  category?: string;
  /** A given feat's Tweaks instance key (`addedFeats:<featId>@<level>`). */
  tweakKey?: string;
}

/** The slot key a given feat's answers are stored under (`featChoices`, `featSpellChoices`, `effectChoices`
 *  `override:<id>:<choice>`, `pickFeatChoices`) — spec item 1 keeps this stored name forever. */
export const OVERRIDE_SLOT = 'override:';
export const overrideSlotKey = (featId: string): string => `${OVERRIDE_SLOT}${featId}`;

const DEFAULT_VIA: readonly HeldVia[] = ['slot', 'override'];

/** Every feat the build holds, as one list of takings (see the header for the rules). */
export function heldFeatSlots(build: HeldInput, level?: number, opts?: { via?: readonly HeldVia[] }): HeldFeatSlot[] {
  const via = opts?.via ?? DEFAULT_VIA;
  const out: HeldFeatSlot[] = [];
  const picks = build.featPicks ?? {};
  if (via.includes('slot')) {
    for (const [slotKey, featId] of Object.entries(picks)) {
      if (!featId) continue;
      const [lvl, category] = slotKey.split(':');
      out.push({ featId, via: 'slot', slotKey, level: Number(lvl), ...(category ? { category } : {}) });
    }
  }
  if (via.includes('pickFeat')) {
    for (const [slotKey, featId] of Object.entries(build.pickFeatChoices ?? {})) if (featId) out.push({ featId, via: 'pickFeat', slotKey, level: NaN });
  }
  if (via.includes('dedicationSkill')) {
    for (const [slotKey, featId] of Object.entries(build.dedicationSkillFeats ?? {}))
      if (featId) out.push({ featId, via: 'dedicationSkill', slotKey, level: NaN, category: 'skill' });
  }
  if (via.includes('override')) {
    const given = activeGivenFeats(build.overrides, build.options);
    if (given.length) {
      const gate = level ?? build.level;
      const removedList = build.overrides?.removedFeatIds;
      const removed = new Set(Array.isArray(removedList) ? removedList : []);
      // A slot at or below the gate that holds the feat already takes it — buildCharacter's `takenFeats.has`.
      const slotted = (id: string) =>
        Object.entries(picks).some(([k, v]) => {
          if (v !== id) return false;
          const lv = Number(k.split(':')[0]);
          return Number.isFinite(lv) && (gate == null || lv <= gate);
        });
      const seen = new Set<string>();
      for (const g of given) {
        if (gate != null && g.level > gate) continue;
        if (seen.has(g.featId) || removed.has(g.featId) || slotted(g.featId)) continue;
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

/** The ids of `heldFeatSlots`, in its order (a feat in two slots is listed twice, as the slots list it). */
export const heldFeatIds = (build: HeldInput, level?: number, opts?: { via?: readonly HeldVia[] }): string[] =>
  heldFeatSlots(build, level, opts).map((e) => e.featId);

/** The feat a slot key holds: `featPicks[slotKey]`, or — for `override:<featId>` — that feat while it is an
 *  active given feat at the character's level. */
export function featIdAtSlot(build: HeldInput, slotKey: string): string | undefined {
  if (!slotKey.startsWith(OVERRIDE_SLOT)) return build.featPicks?.[slotKey] ?? undefined;
  const id = slotKey.slice(OVERRIDE_SLOT.length);
  return heldFeatSlots(build, undefined, { via: ['override'] }).some((e) => e.featId === id) ? id : build.featPicks?.[slotKey] || undefined;
}
