import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { importCharacter } from '../src/data/transfer';
import { uniqueName, findByName, type SavedChar } from '../src/data/storage';

const db = content();

function wgWithUnknownItem() {
  return JSON.stringify({
    version: 4,
    character: {
      name: 'Item Tester',
      level: 5,
      details: { ancestry: { name: 'Human' }, class: { name: 'Fighter' } },
      inventory: {
        coins: {},
        items: [
          {
            item: {
              name: 'Glowing Doohickey of Whatsis',
              level: 5,
              bulk: 'L',
              price: { gp: 12 },
              rarity: 'uncommon',
              description: 'A weird gadget not in the app data.',
            },
            is_equipped: true,
            is_invested: false,
          },
        ],
      },
    },
    content: {
      attributes: {},
      proficiencies: {},
      feats_features: { classFeats: [], ancestryFeats: [], generalAndSkillFeats: [], otherFeats: [], heritages: [], classFeatures: [] },
      languages: [],
      spells: { cantrips: [], normal: [] },
    },
  });
}

describe('import: unrecognized inventory items become custom items', () => {
  const { saved, customItems } = importCharacter(wgWithUnknownItem(), db);

  it('synthesizes a custom item from the import info (name/level/bulk/price/rarity)', () => {
    expect(customItems).toHaveLength(1);
    const it = customItems[0];
    expect(it.name).toBe('Glowing Doohickey of Whatsis');
    expect(it.id.startsWith('custom-')).toBe(true);
    expect(it.itemType).toBe('equipment');
    expect(it.level).toBe(5);
    expect(it.bulk).toBe(0.1); // "L" → light
    expect(it.rarity).toBe('uncommon');
    expect(it.price?.gp).toBe(12);
  });

  it('the custom item lands in the character inventory (resolvable by id)', () => {
    expect(saved.character.inventory.some((i) => i.itemId === customItems[0].id)).toBe(true);
  });
});

describe('roster name-collision helpers', () => {
  const roster = (names: string[]): SavedChar[] => names.map((n, i) => ({ id: `c${i}`, character: { name: n } }) as SavedChar);

  it('uniqueName returns the base when the name is free', () => {
    expect(uniqueName('Kyra', roster(['Bob']))).toBe('Kyra');
  });
  it('uniqueName appends the next free number on collision (case-insensitive)', () => {
    expect(uniqueName('Kyra', roster(['kyra']))).toBe('Kyra 2');
    expect(uniqueName('Kyra', roster(['Kyra', 'Kyra 2']))).toBe('Kyra 3');
  });
  it('findByName matches case-insensitively + trimmed', () => {
    expect(findByName(roster(['Kyra']), '  kyra ')?.character.name).toBe('Kyra');
    expect(findByName(roster(['Kyra']), 'Bob')).toBeUndefined();
  });
});
