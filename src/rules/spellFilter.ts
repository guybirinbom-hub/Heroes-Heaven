import type { ActionCost } from './types';

/**
 * Whether a spell's action cost satisfies a chosen action-cost filter chip.
 * The filter chips are single costs: 1/2/3 actions, free, or reaction.
 * A variable-cost spell (e.g. Heal, "1 to 3 actions") matches any single
 * action count that falls within its range, since it can be cast at that cost.
 * Duration/passive casts (e.g. "10 minutes") have no action count and match no chip.
 */
export function spellCostMatches(spell: ActionCost | undefined, filter: ActionCost): boolean {
  if (!spell) return false;
  if (filter.type === 'actions') {
    if (spell.type === 'actions') return spell.value === filter.value;
    if (spell.type === 'variable') return filter.value >= spell.min && filter.value <= spell.max;
    return false;
  }
  return spell.type === filter.type; // free / reaction
}
