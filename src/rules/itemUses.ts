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
import type { ConsumableItem, InventoryItem, Item, ItemCounter, PreparedSlot, SpellcastingEntry } from './types';

/* --- Staves (GM Core "Preparing a Staff") --- */

/** The `staff` TRAIT is what makes an item a staff — not its name (a Bo Staff is not one). */
export const isStaff = (item: Item | undefined): boolean => !!item?.traits?.includes('staff');

/** The slice of a character these staff rules read. */
type SlotOwner = { spellcasting?: SpellcastingEntry[] };

/**
 * The rank of the character's highest-rank spell slot; 0 when they have none.
 *
 * *"That staff gains a number of charges equal to the rank of your highest-rank spell slot… you
 * can't prepare a staff if you have no spell slots."* So a cantrip-only caster and a non-caster both
 * get 0 — which is why 0 is a real answer here and not an "unknown".
 *
 * Ordinary slots only. A focus pool is not a spell slot, and an innate/item entry has none.
 */
export function highestSlotRank(ch: SlotOwner | undefined): number {
  let top = 0;
  for (const e of ch?.spellcasting ?? []) {
    if (e.type !== 'prepared' && e.type !== 'spontaneous') continue;
    for (const [r, slots] of Object.entries(e.prepared ?? {}))
      if (Number(r) > 0 && slots.some((s) => !s.traded)) top = Math.max(top, Number(r));
    for (const [r, pool] of Object.entries(e.slots ?? {})) if (Number(r) > 0 && pool.max > 0) top = Math.max(top, Number(r));
  }
  return top;
}

/** The traditions the character casts SLOT spells in — "your spell list" in the staff rule.
 *  An innate or item entry is not a spell list you have: an amulet that casts one divine spell a day
 *  does not put that spell on your list, so those entries are excluded exactly as they are above. */
export function castingTraditions(ch: SlotOwner | undefined): Set<string> {
  const out = new Set<string>();
  for (const e of ch?.spellcasting ?? []) if (e.type === 'prepared' || e.type === 'spontaneous') out.add(e.tradition);
  return out;
}

/** Every spell a staff holds, all ranks (0 = cantrips). The INSTANCE's list wins where it has one —
 *  a Staff Nexus makeshift staff holds spells chosen from the wizard's own spellbook. */
export function staffSpellIds(item: Item | undefined, inv?: InventoryItem): string[] {
  return Object.values(inv?.heldSpellsOverride ?? item?.heldSpells ?? {}).flat();
}

/**
 * *"You can prepare a staff only if you have at least one of the staff's spells on your spell list."*
 *
 * Read through TRADITION: a spell is on your list when one of its traditions is one you cast slot
 * spells in, which is how the printed restriction bites (a divine cleric and an arcane/primal Staff
 * of Earth share nothing).
 *
 * `spells` is the spell database, narrowed to the one field this needs, so the rules layer keeps its
 * single `./types` import.
 */
export function canPrepareStaff(
  item: Item | undefined,
  inv: InventoryItem | undefined,
  ch: SlotOwner | undefined,
  spells: Record<string, { traditions?: string[] }>,
): boolean {
  // *"You can't prepare a staff if you have no spell slots."* Asked first, and asked about SLOTS: a
  // cantrip-only entry (an archetype dedication before its Basic Spellcasting feat) is a spell list
  // with nothing in it to spend, and it would otherwise sail through the tradition test below.
  if (!highestSlotRank(ch)) return false;
  const trads = castingTraditions(ch);
  let readable = 0;
  for (const id of staffSpellIds(item, inv)) {
    const sp = spells[id];
    if (!sp) continue;
    readable++;
    if ((sp.traditions ?? []).some((t) => trads.has(t))) return true;
  }
  // 31 shipped staves carry no spell list at all, and an id the database doesn't hold is silence
  // rather than a "no" — refusing on missing data would zero those staves for every caster. Only a
  // list we can actually read is allowed to say no.
  return readable === 0;
}

/** One rank the character can still expend an ordinary spell slot from. */
export interface OpenSlot {
  entryId: string;
  entryName: string;
  rank: number;
  /** Prepared caster: the first unexpended slot of that rank, and its index (the play-state key). */
  index?: number;
  slot?: PreparedSlot;
  /** Spontaneous caster: the rank's pool, for setSlotsUsed. */
  pool?: { used: number; max: number };
}

/**
 * Every rank the character could burn a slot of, lowest first — the *"you can expend one spell slot
 * to add a number of charges to the staff equal to that slot's rank"* half of preparing a staff.
 *
 * Ordinary slots only: a restricted slot or a divine font slot may hold only certain spells, so it
 * is not a free rank to spend. One option per entry+rank; the player picks the rank, not the slot.
 */
export function openSlots(ch: SlotOwner | undefined): OpenSlot[] {
  const out: OpenSlot[] = [];
  for (const e of ch?.spellcasting ?? []) {
    if (e.type !== 'prepared' && e.type !== 'spontaneous') continue;
    for (const [r, slots] of Object.entries(e.prepared ?? {})) {
      const rank = Number(r);
      if (rank <= 0) continue;
      const index = slots.findIndex((s) => !s.expended && !s.traded);
      if (index >= 0) out.push({ entryId: e.id, entryName: e.name, rank, index, slot: slots[index] });
    }
    for (const [r, pool] of Object.entries(e.slots ?? {})) {
      const rank = Number(r);
      if (rank > 0 && pool.used < pool.max) out.push({ entryId: e.id, entryName: e.name, rank, pool });
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

export interface CounterUse {
  id: string;
  label: string;
  current: number;
  max: number;
  /** Daily preparations refill it (day & sub-daily); false for week/month/finite stock. */
  resetsOnRest: boolean;
  /** day/hour/… for a recurring use; absent for a raw pool. */
  per?: string;
  /** Period multiplier ("once every 10 minutes" → per:'minute', every:10); absent means 1. */
  every?: number;
}

/** "10 minutes" for {per:'minute', every:10}; the bare period otherwise (mirrors featUses.ts). */
export const counterPeriod = (c: { per?: string; every?: number }) =>
  (c.every ?? 1) > 1 ? `${c.every} ${c.per}s` : c.per;

/** Static counter descriptors for an item (max resolved), incl. legacy frequency/uses synthesis. */
function counterDefs(item: Item | undefined, inv?: InventoryItem, staffCharges?: number): (ItemCounter & { max: number })[] {
  if (!item) return [];
  if (item.counters?.length) {
    // bug 2026-09-13: a staff's charges are its WIELDER's, never its own level. Shipping item.level
    // gave a 6th-level wizard's Ringmaster's Staff 6 charges instead of 3 and the Staff of the Magi
    // 20 instead of the caster's highest rank. `inv.staffCharges` is what daily preparations put in
    // it (base + any slot expended into it), `staffCharges` the live base for a caller holding the
    // character, and item.level the last resort for one that doesn't (a shop row, a companion pack).
    const staff = isStaff(item);
    return item.counters
      .map((c) => ({
        ...c,
        max:
          c.max !== 'level'
            ? c.max
            : staff
              ? (inv?.staffCharges ?? staffCharges ?? Math.max(1, item.level))
              : Math.max(1, item.level),
      }))
      // A 0-charge staff is still a staff: dropping its counter makes canCastFromItem read the item
      // as untracked/at-will, which would hand a cantrip-only caster free casts from it.
      .filter((c) => c.max > 0 || (staff && c.id === 'pool'));
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

/** Live counters for an inventory instance. Empty array = the item has no trackable uses.
 *  `staffCharges` — the owner's `highestSlotRank`, for the staff rule above; omit for a pack with
 *  no character in hand and a staff falls back to its own level, exactly as it always did. */
export function itemCounters(item: Item | undefined, inv: InventoryItem, staffCharges?: number): CounterUse[] {
  return counterDefs(item, inv, staffCharges).map((c) => {
    const live = inv.counters?.[c.id]?.current;
    // Legacy single-counter value lived on inv.charges (only meaningful for the synthesized counter).
    const legacy = c.id === 'freq' || c.id === 'uses' ? inv.charges?.current : undefined;
    const start = c.startsFull === false ? 0 : c.max;
    const current = live ?? legacy ?? start;
    return { id: c.id, label: c.label, current: Math.max(0, Math.min(c.max, current)), max: c.max, resetsOnRest: c.resetsOnRest, per: c.per, ...(c.every ? { every: c.every } : {}) };
  });
}

export interface UseInfo {
  current: number;
  max: number;
  resetsOnRest: boolean;
  per: string;
}

/** Back-compat single-counter accessor (the first counter), for callers not yet migrated. */
export function itemUses(item: Item | undefined, inv: InventoryItem, staffCharges?: number): UseInfo | null {
  const first = itemCounters(item, inv, staffCharges)[0];
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
export function canCastFromItem(item: Item | undefined, inv: InventoryItem, rank: number, staffCharges?: number): boolean {
  const cid = chargeCounterId(item);
  if (cid === null) return inv.quantity >= 1; // scroll: castable while you hold one
  const u = itemCounters(item, inv, staffCharges).find((c) => c.id === cid);
  if (!u) return true; // no tracker → at-will
  const cost = chargeCostToCast(item, rank);
  return cost <= 0 || u.current >= cost;
}
