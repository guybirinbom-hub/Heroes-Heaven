/*
 * Limited-use tracking. An item can expose several trackable counters (a staff's charge pool,
 * "X per day" activations, multi-use stock). Each counter's max comes from the item definition
 * (`item.counters`, with `max:'level'` resolving to the item's level); the current value is
 * tracked per-instance on InventoryItem.counters (keyed by counter id). Counters with
 * resetsOnRest refill on daily preparations.
 *
 * Back-compat: items with only a legacy `frequency` (or a multi-use `consumable.uses`) and no
 * explicit `counters` synthesize a single counter, and a legacy `inv.charges.current` is read.
 */
import type { ConsumableItem, InventoryItem, Item, ItemCounter } from './types';

export interface CounterUse {
  id: string;
  label: string;
  current: number;
  max: number;
  /** Daily preparations refill it (day & sub-daily); false for week/month/finite stock. */
  resetsOnRest: boolean;
  /** day/hour/… for a recurring use; absent for a raw pool. */
  per?: string;
}

/** Static counter descriptors for an item (max resolved), incl. legacy frequency/uses synthesis. */
function counterDefs(item: Item | undefined): (ItemCounter & { max: number })[] {
  if (!item) return [];
  if (item.counters?.length) {
    return item.counters
      .map((c) => ({ ...c, max: c.max === 'level' ? Math.max(1, item.level) : c.max }))
      .filter((c) => c.max > 0);
  }
  if (item.frequency) {
    return [
      {
        id: 'freq',
        label: `per ${item.frequency.per}`,
        max: item.frequency.max,
        per: item.frequency.per,
        resetsOnRest: !['week', 'month'].includes(item.frequency.per),
      },
    ];
  }
  const uses = (item as ConsumableItem).uses;
  if (item.itemType === 'consumable' && uses && uses.max > 1) {
    return [{ id: 'uses', label: 'Uses', max: uses.max, resetsOnRest: false }];
  }
  return [];
}

/** Live counters for an inventory instance. Empty array = the item has no trackable uses. */
export function itemCounters(item: Item | undefined, inv: InventoryItem): CounterUse[] {
  return counterDefs(item).map((c) => {
    const live = inv.counters?.[c.id]?.current;
    // Legacy single-counter value lived on inv.charges (only meaningful for the synthesized counter).
    const legacy = c.id === 'freq' || c.id === 'uses' ? inv.charges?.current : undefined;
    const start = c.startsFull === false ? 0 : c.max;
    const current = live ?? legacy ?? start;
    return { id: c.id, label: c.label, current: Math.max(0, Math.min(c.max, current)), max: c.max, resetsOnRest: c.resetsOnRest, per: c.per };
  });
}

export interface UseInfo {
  current: number;
  max: number;
  resetsOnRest: boolean;
  per: string;
}

/** Back-compat single-counter accessor (the first counter), for callers not yet migrated. */
export function itemUses(item: Item | undefined, inv: InventoryItem): UseInfo | null {
  const first = itemCounters(item, inv)[0];
  return first ? { current: first.current, max: first.max, resetsOnRest: first.resetsOnRest, per: first.per ?? '' } : null;
}

/** The persisted value object for a counter when the player spends/restores a use (clamped). */
export function chargesFor(info: { max: number; resetsOnRest: boolean }, current: number): { current: number; max: number; resetsOnRest: boolean } {
  return { current: Math.max(0, Math.min(info.max, current)), max: info.max, resetsOnRest: info.resetsOnRest };
}

/* --- Spell-holding items (staff / wand / scroll): which counter a cast spends, and how much. --- */

/** The counter a spell-holding item spends to cast: a staff's shared 'pool' (charges = item level),
 *  a wand's 'freq' (1/day). null = a single-use item (scroll), consumed on cast instead of decremented. */
export function chargeCounterId(item: Item | undefined): string | null {
  if (item?.itemType === 'consumable' && item.consumableType === 'scroll') return null;
  const ids = (item?.counters ?? []).map((c) => c.id);
  if (ids.includes('pool')) return 'pool';
  if (ids.includes('freq')) return 'freq';
  return null;
}

/** Charges one cast of a rank-`rank` spell costs from `item`: a staff spends the spell's rank
 *  (cantrips are free/at-will); a wand spends its single daily use. */
export function chargeCostToCast(item: Item | undefined, rank: number): number {
  return chargeCounterId(item) === 'pool' ? Math.max(0, rank) : 1;
}

/** Whether `item` (held as `inv`) can currently cast a rank-`rank` spell — enough charges, or in stock. */
export function canCastFromItem(item: Item | undefined, inv: InventoryItem, rank: number): boolean {
  const cid = chargeCounterId(item);
  if (cid === null) return inv.quantity >= 1; // scroll: castable while you hold one
  const u = itemCounters(item, inv).find((c) => c.id === cid);
  if (!u) return true; // no tracker → at-will
  const cost = chargeCostToCast(item, rank);
  return cost <= 0 || u.current >= cost;
}
