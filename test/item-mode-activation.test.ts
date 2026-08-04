import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { toggleItemMode, useConsumable } from '../src/rules/play';
import type { PlayState } from '../src/rules/types';

/**
 * An item mode you cannot switch on is not modelled.
 *
 * Item modes are deliberately hidden from the Modes panel — they belong to their item, not to the
 * player's own list — and the ONLY way to start one was the consumable "Use one" button, which
 * renders for `itemType === 'consumable'` and nothing else. So every mode whose host is a badge, a
 * shield or a suit of armour had no route to the sheet at all: the effect was authored, the item was
 * in the inventory, and nothing could turn it on.
 */
const db = content();
const itemModes = () => Object.values(db.modes ?? {}).filter((m) => m.fromItemId);
const play = (over: Partial<PlayState> = {}): PlayState =>
  ({ damage: 0, tempHp: 0, heroPoints: 0, xp: 0, focusUsed: 0, expendedSlots: {}, slotsUsed: {}, conditions: [], pinned: [], inventory: [], activeModes: [], ...over }) as PlayState;

/** A mode whose host item is NOT a consumable — the ones that used to be unreachable. */
const nonConsumableMode = () => itemModes().find((m) => db.items[m.fromItemId!]?.itemType !== 'consumable')!;

describe('activating an item mode', () => {
  it('there really are modes hosted on non-consumables', () => {
    const stranded = itemModes().filter((m) => db.items[m.fromItemId!]?.itemType !== 'consumable');
    expect(stranded.length).toBeGreaterThan(50); // 72 at the time of writing
  });

  it('every item mode points at an item that exists', () => {
    const dead = itemModes().filter((m) => !db.items[m.fromItemId!]).map((m) => m.id);
    expect(dead).toEqual([]);
  });

  it('a non-consumable mode can be switched on and off without spending the item', () => {
    const mode = nonConsumableMode();
    const inv = [{ instanceId: 'x1', itemId: mode.fromItemId!, quantity: 1, worn: true }];
    const on = toggleItemMode(play({ inventory: inv }), 'x1', db.modes);
    expect(on.activeModes).toContain(mode.id);
    expect(on.inventory?.[0].quantity, 'activating must not consume the item').toBe(1);

    const off = toggleItemMode(on, 'x1', db.modes);
    expect(off.activeModes ?? []).not.toContain(mode.id);
    expect(off.inventory?.[0].quantity).toBe(1);
  });

  it('a consumable is still SPENT when used, unlike an activation', () => {
    const mode = itemModes().find((m) => db.items[m.fromItemId!]?.itemType === 'consumable')!;
    const inv = [{ instanceId: 'c1', itemId: mode.fromItemId!, quantity: 2 }];
    const after = useConsumable(play({ inventory: inv }), 'c1', db.modes);
    expect(after.activeModes).toContain(mode.id);
    expect(after.inventory?.[0].quantity).toBe(1);
  });

  it('an item with no mode is left alone', () => {
    const plain = Object.keys(db.items).find((id) => !itemModes().some((m) => m.fromItemId === id))!;
    const before = play({ inventory: [{ instanceId: 'p1', itemId: plain, quantity: 1 }] });
    expect(toggleItemMode(before, 'p1', db.modes)).toBe(before);
  });

  it('every item mode says how long it lasts, so the player knows when to switch it off', () => {
    const silent = itemModes().filter((m) => !String(m.duration ?? '').trim()).map((m) => m.id);
    expect(silent).toEqual([]);
  });
});
