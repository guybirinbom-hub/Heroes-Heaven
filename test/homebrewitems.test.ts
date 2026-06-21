import { describe, it, expect, beforeEach } from 'vitest';
import { loadHomebrewItems, saveHomebrewItem } from '../src/data/storage';
import type { Item } from '../src/rules/types';

// The suite runs in a node env (no localStorage) — provide a minimal Map-backed mock.
beforeEach(() => {
  const store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: () => null,
    length: 0,
  };
});

const sample: Item = {
  id: 'custom-test-abc',
  name: 'Test Blade',
  traits: ['magical'],
  rarity: 'common',
  description: 'A test blade.',
  level: 1,
  bulk: 1,
  itemType: 'weapon',
  category: 'martial',
  group: 'sword',
  damage: { dice: 1, die: 'd8', type: 'slashing' },
};

describe('homebrew item store', () => {
  it('returns {} when empty', () => {
    expect(loadHomebrewItems()).toEqual({});
  });

  it('round-trips a saved custom item', () => {
    saveHomebrewItem(sample);
    const w = loadHomebrewItems()['custom-test-abc'];
    expect(w?.name).toBe('Test Blade');
    expect(w.itemType).toBe('weapon');
    if (w.itemType === 'weapon') expect(w.damage.die).toBe('d8');
  });

  it('accumulates multiple items', () => {
    saveHomebrewItem(sample);
    saveHomebrewItem({ ...sample, id: 'custom-2', name: 'Second' });
    expect(Object.keys(loadHomebrewItems())).toHaveLength(2);
  });
});
