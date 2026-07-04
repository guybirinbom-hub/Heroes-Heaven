import { describe, it, expect } from 'vitest';
import { normalizeCharacter } from '../src/rules/normalize';
import { normalizePlay } from '../src/rules/normalize';
import { ITEM_ID_ALIASES, resolveItemAlias } from '../src/rules/itemAliases';
import { content } from './_content';

describe('removed-item id aliases', () => {
  it('migrates a character referencing a removed aon- id to the canonical id, which resolves to a real item', () => {
    const items = content().items;
    const c = normalizeCharacter({
      name: 'Legacy',
      inventory: [
        { instanceId: 'i1', itemId: 'aon-greater-energized-shield', quantity: 1, equipped: true },
        { instanceId: 'i2', itemId: 'aon-splinter-spear', quantity: 1 },
      ],
    });
    // The removed aon- ids are rewritten to their canonical Foundry twins...
    expect(c.inventory[0].itemId).toBe('energized-shield-greater');
    expect(c.inventory[1].itemId).toBe('splintering-spear');
    // ...and both canonical ids resolve to a real content item.
    expect(items['energized-shield-greater']).toBeTruthy();
    expect(items['splintering-spear']).toBeTruthy();
    // Non-referenced per-entry fields are preserved.
    expect(c.inventory[0].equipped).toBe(true);
  });

  it('leaves a non-aliased itemId untouched', () => {
    const c = normalizeCharacter({
      name: 'x',
      inventory: [{ instanceId: 'i1', itemId: 'longsword', quantity: 1 }],
    });
    expect(c.inventory[0].itemId).toBe('longsword');
  });

  it('migrates companion inventories and the in-play inventory override', () => {
    const c = normalizeCharacter({
      name: 'x',
      companions: [
        { id: 'c1', kind: 'animal', inventory: [{ instanceId: 'a1', itemId: 'aon-calvary-commander-s-lance', quantity: 1 }] },
      ],
    } as unknown);
    expect(c.companions?.[0].inventory?.[0].itemId).toBe('cavalry-commanders-lance');

    const p = normalizePlay({
      inventory: [{ instanceId: 'p1', itemId: 'aon-greater-hero-s-plate', quantity: 1 }],
    });
    expect(p.inventory?.[0].itemId).toBe('heros-plate-greater');
  });

  it('every alias target is a real content item and no aon- source id survives in content', () => {
    const items = content().items;
    for (const [aonId, canonicalId] of Object.entries(ITEM_ID_ALIASES)) {
      expect(canonicalId.startsWith('aon-')).toBe(false);
      expect(items[canonicalId], `alias target ${canonicalId} missing`).toBeTruthy();
      expect(items[aonId], `removed dup ${aonId} still present`).toBeFalsy();
    }
  });

  it('resolveItemAlias is identity for unknown ids', () => {
    expect(resolveItemAlias('nonexistent-item')).toBe('nonexistent-item');
  });

  it('the energized shields carry their reinforced Hardness/HP/BT (not bare steel 5/20)', () => {
    const items = content().items;
    // Lesser Energized Shield: minor reinforcing on a steel shield -> Hardness 8, HP 64, BT 32.
    const lesser = items['energized-shield-lesser'] as { hardness: number; hp: number; brokenThreshold: number };
    expect(lesser.hardness).toBe(8);
    expect(lesser.hp).toBe(64);
    expect(lesser.brokenThreshold).toBe(32);
    // Higher tiers scale up beyond bare steel (5/20/10).
    const greater = items['energized-shield-greater'] as { hardness: number; hp: number };
    expect(greater.hardness).toBeGreaterThan(5);
    expect(greater.hp).toBeGreaterThan(20);
  });
});
