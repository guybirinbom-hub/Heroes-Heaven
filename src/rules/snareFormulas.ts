/*
 * Snare Crafting (Snarecrafter Dedication / Snare Crafting feat) formula book.
 *
 * The feat gives you the formulas for four common 1st-level snares, and three more snare formulas each
 * time your Crafting proficiency reaches expert, master, or legendary (the later ones may be any snare of
 * your level or lower). You can also prepare 4 of them for free each day (6 if master, 8 if legendary).
 *
 * The player's chosen formula item ids live in build.extraChoices['snare-formulas'] (a persisted list),
 * so they round-trip with the saved build. This module only computes the allowance + option pools; the
 * builder renders the pickers.
 */
import type { ContentDatabase, Item, ProficiencyRank } from './types';

export const SNARE_FORMULA_KEY = 'snare-formulas';

/** Feats that grant Snare Crafting (directly or as a bonus feat). */
const SNARE_CRAFTING_SOURCES = new Set(['snare-crafting', 'snarecrafter-dedication', 'snare-expert', 'snare-setter']);

export function hasSnareCrafting(featIds: string[]): boolean {
  return featIds.some((id) => SNARE_CRAFTING_SOURCES.has(id));
}

/** Formula-book size + free daily prep, keyed off the Crafting proficiency rank.
 *  4 formulas at trained, +3 at each of expert / master / legendary. */
export function snareAllowance(craftingRank: ProficiencyRank): { known: number; prepared: number } {
  const steps: Record<ProficiencyRank, number> = { untrained: 0, trained: 0, expert: 1, master: 2, legendary: 3 };
  const known = 4 + (steps[craftingRank] ?? 0) * 3;
  const prepared = craftingRank === 'legendary' ? 8 : craftingRank === 'master' ? 6 : 4;
  return { known, prepared };
}

/** Snare items offered for a formula slot. The base four slots are common 1st-level snares; slots gained
 *  from higher Crafting proficiency may be any snare of the character's level or lower. */
export function snareFormulaOptions(content: ContentDatabase, maxLevel: number, commonOnly: boolean): Item[] {
  return Object.values(content.items)
    .filter((it) => (it.traits ?? []).map((t) => String(t).toLowerCase()).includes('snare'))
    .filter((it) => (it.level ?? 0) <= maxLevel)
    .filter((it) => !commonOnly || (it.rarity ?? 'common').toLowerCase() === 'common')
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name));
}

/** True for the base grant's four slots (common, 1st-level only). */
export function isBaseSnareSlot(index: number): boolean {
  return index < 4;
}
