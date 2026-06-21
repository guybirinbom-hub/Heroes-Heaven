import { describe, it, expect } from 'vitest';
import { isAttachable, attachHostTypes, canAttachTo } from '../src/rules/attachments';
import { attachItem, detachItem, removeInventoryItem, type PlayState } from '../src/rules/play';
import type { Item } from '../src/rules/types';

const item = (o: Partial<Item>): Item => ({ id: 'x', name: 'X', level: 0, bulk: 0, traits: [], rarity: 'common', description: '', itemType: 'equipment', ...(o as object) } as Item);

describe('attachment classification', () => {
  it('talismans, spellhearts, and banners are attachable; plain gear is not', () => {
    expect(isAttachable(item({ itemType: 'consumable', consumableType: 'talisman', usage: 'affixed-to-a-weapon' }))).toBe(true);
    expect(isAttachable(item({ traits: ['spellheart'], usage: 'affixed-to-armor-or-a-weapon' }))).toBe(true);
    expect(isAttachable(item({ name: 'Banner of Common Cause', usage: 'affixed-or-held-in-one-hand' }))).toBe(true);
    expect(isAttachable(item({ itemType: 'weapon' }))).toBe(false);
    expect(isAttachable(item({ usage: 'affixed-to-a-creature' }))).toBe(false); // body, not gear
  });

  it('host types come from the usage string', () => {
    expect(attachHostTypes(item({ usage: 'affixed-to-armor' })).sort()).toEqual(['armor']);
    expect(attachHostTypes(item({ traits: ['spellheart'], usage: 'affixed-to-armor-or-a-weapon' })).sort()).toEqual(['armor', 'weapon']);
    expect(attachHostTypes(item({ name: 'Banner of X', usage: 'affixed-or-held-in-one-hand' })).sort()).toEqual(['shield', 'weapon']);
    // a talisman with no gear word in usage defaults to all three
    expect(attachHostTypes(item({ itemType: 'consumable', consumableType: 'talisman', usage: '' })).sort()).toEqual(['armor', 'shield', 'weapon']);
  });

  it('canAttachTo gates by host type', () => {
    const t = item({ itemType: 'consumable', consumableType: 'talisman', usage: 'affixed-to-a-weapon' });
    expect(canAttachTo(t, 'weapon')).toBe(true);
    expect(canAttachTo(t, 'armor')).toBe(false);
  });
});

describe('affix / peel play state', () => {
  const base = (): PlayState => ({
    inventory: [
      { instanceId: 'sword', itemId: 'longsword', quantity: 1, equipped: true },
      { instanceId: 'tal', itemId: 'talisman', quantity: 1, worn: true },
    ],
  });

  it('attachItem sets the host and clears the attachment\'s own carry flags', () => {
    const p = attachItem(base(), 'tal', 'sword');
    const tal = p.inventory!.find((i) => i.instanceId === 'tal')!;
    expect(tal.attachedTo).toBe('sword');
    expect(tal.worn).toBe(false);
  });

  it('detachItem peels it back off', () => {
    let p = attachItem(base(), 'tal', 'sword');
    p = detachItem(p, 'tal');
    expect(p.inventory!.find((i) => i.instanceId === 'tal')!.attachedTo).toBeNull();
  });

  it('removing the host frees its attachments instead of orphaning them', () => {
    let p = attachItem(base(), 'tal', 'sword');
    p = removeInventoryItem(p, 'sword');
    const tal = p.inventory!.find((i) => i.instanceId === 'tal')!;
    expect(p.inventory!.some((i) => i.instanceId === 'sword')).toBe(false);
    expect(tal.attachedTo).toBeNull();
  });
});
