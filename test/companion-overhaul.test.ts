import { describe, it, expect } from 'vitest';
import { deriveAnimalCompanion } from '../src/rules/companions';
import { content } from './_content';
import type { CompanionConfig, ContentDatabase } from '../src/rules/types';

const c = content();

describe('companion content parity', () => {
  it('ships the full fork animal-companion roster + construct', () => {
    expect(Object.keys(c.animalCompanions).length).toBeGreaterThanOrEqual(20);
    for (const id of ['bat', 'scorpion', 'shark', 'dromaeosaur', 'draft-lizard', 'riding-drake', 'riding-dragonet', 'arboreal-sapling', 'sundaflora', 'construct-companion']) {
      expect(c.animalCompanions[id], id).toBeTruthy();
    }
    expect(c.animalCompanions['construct-companion'].category).toBe('construct');
  });
  it('ships specializations, followers, and pets', () => {
    expect(Object.keys(c.companionSpecializations ?? {})).toHaveLength(6);
    expect(Object.keys(c.followers ?? {})).toHaveLength(5);
    expect(Object.keys(c.pets ?? {})).toHaveLength(2);
  });
});

describe('specialization derivation', () => {
  it('Racer adds Constitution and a +10 ft Speed', () => {
    const wolf = c.animalCompanions.wolf;
    const b = deriveAnimalCompanion({ id: 'x', kind: 'animal', name: '', typeId: 'wolf', maturity: 'specialized', specialization: 'racer' }, wolf, 8, c);
    // specialized maturity boosts Con +2, Racer adds +1 on top of the young modifier.
    expect(b.abilities.con).toBe((wolf.abilities.con ?? 0) + 2 + 1);
    expect(b.speeds.land).toBe((wolf.speeds.land ?? 0) + 10);
    expect(b.specialization?.name).toBe('Racer');
  });
  it('Daredevil raises Acrobatics to master', () => {
    const b = deriveAnimalCompanion({ id: 'x', kind: 'animal', name: '', typeId: 'wolf', maturity: 'specialized', specialization: 'daredevil' }, c.animalCompanions.wolf, 8, c);
    expect(b.skills.find((s) => s.name === 'Acrobatics')?.rank).toBe('master');
  });
  it('a specialization does nothing until the companion is specialized', () => {
    const b = deriveAnimalCompanion({ id: 'x', kind: 'animal', name: '', typeId: 'wolf', maturity: 'mature', specialization: 'racer' }, c.animalCompanions.wolf, 8, c);
    expect(b.specialization).toBeUndefined();
    expect(b.speeds.land).toBe(c.animalCompanions.wolf.speeds.land);
  });
});

describe('companion equipment affects the stat block', () => {
  const barding = {
    // strength 8 is a modifier threshold the wolf can't meet, so the Speed/check penalties apply in
    // full (mirroring the character-side meetsArmorStrength: null strength would instead count as met).
    id: 'test-barding', itemType: 'armor', name: 'Test Barding', category: 'medium',
    acBonus: 3, dexCap: 2, checkPenalty: -2, speedPenalty: -5, strength: 8,
    level: 0, bulk: 1, traits: [], rarity: 'common', description: '',
  };
  const cc = { ...c, items: { ...c.items, 'test-barding': barding } } as unknown as ContentDatabase;
  const worn: CompanionConfig = { id: 'x', kind: 'animal', name: '', typeId: 'wolf', maturity: 'mature', inventory: [{ instanceId: 'i1', itemId: 'test-barding', quantity: 1, worn: true }] };

  it('worn barding raises AC (Dex-capped) and applies its Speed penalty', () => {
    const bare = deriveAnimalCompanion({ ...worn, inventory: [] }, c.animalCompanions.wolf, 4, c);
    const armored = deriveAnimalCompanion(worn, c.animalCompanions.wolf, 4, cc);
    expect(armored.ac).toBe(bare.ac - 2 + 3); // Dex 4 -> capped at 2 (−2), +3 item AC
    expect(armored.speeds.land).toBe((bare.speeds.land ?? 0) - 5);
    expect(armored.gearNote).toContain('Test Barding');
  });
  it('reports carried Bulk and a size-scaled capacity', () => {
    const armored = deriveAnimalCompanion(worn, c.animalCompanions.wolf, 4, cc);
    expect(armored.bulk.carried).toBe(1);
    expect(armored.bulk.max).toBeGreaterThan(armored.bulk.encumberedAt);
  });
});
