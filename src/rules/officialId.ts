/*
 * The OFFICIAL record behind an inventory item.
 *
 * A homebrew copy made with the item editor's "Start from an existing item…" is saved under a fresh
 * `custom-…` id, and every hand-authored code table in the rules layer is keyed by the OFFICIAL id:
 * FEAT_SITUATIONAL, RECORD_MARKERS, SITUATIONAL_SUPERSEDES, the trust ledger, the steadying-hand
 * mark. So a copy of the Spellguard Shield carried none of its three save stars — the printed text
 * was on the player's record, the rules were filed under an id nobody on that character held. Owner,
 * 2026-09-15: *"spell guard shield adds a bonus to saving throws in certain circumstances and WG
 * shows that with a * — why don't we?"*
 *
 * Resolution order: the copy's own `basedOn` (what the editor writes from now on), then its NAME —
 * which is what rescues a copy saved BEFORE `basedOn` existed, his among them — then the id itself,
 * so an item the player actually invented resolves to nothing but itself.
 *
 * ⚠ This resolves an ID for a lookup. It does NOT hand the copy the base record's DATA fields: the
 * copy's own price, Bulk, description and authored effects stay the player's, which is the whole
 * point of copying an item and then editing it.
 */
import type { Item } from './types';

/** Official item name (lower-cased) → its record id. Built once per content database. */
const BY_NAME = new WeakMap<object, Map<string, string>>();

function officialByName(items: Record<string, Item>): Map<string, string> {
  const cached = BY_NAME.get(items);
  if (cached) return cached;
  const index = new Map<string, string>();
  for (const [id, it] of Object.entries(items)) {
    const name = it?.name?.trim().toLowerCase();
    // First one wins, and a homebrew record is never a base — otherwise one player's copy could
    // become the answer for the next one, and the official rules would stay out of reach.
    if (!name || id.startsWith('custom-') || index.has(name)) continue;
    index.set(name, id);
  }
  BY_NAME.set(items, index);
  return index;
}

/**
 * The id to ask a code table for, given the id an inventory row actually holds.
 *
 * ponytail: ONE hop, not a chain — a copy of a copy resolves to the copy and stops there. Loop over
 * `basedOn` if that is ever reported; nothing today makes a copy of a homebrew record.
 */
export function officialIdOf(itemId: string, items?: Record<string, Item>): string {
  const item = items?.[itemId];
  if (item?.basedOn) return item.basedOn;
  if (!item || !itemId.startsWith('custom-')) return itemId;
  return officialByName(items!).get(item.name.trim().toLowerCase()) ?? itemId;
}
