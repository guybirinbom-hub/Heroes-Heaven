import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import type { InventoryItem } from '../src/rules/types';

/**
 * Explosive Savant: "you treat bombs and martial firearms as simple weapons, and advanced firearms as
 * martial weapons."
 *
 * Three clauses over two groups, which is why `weaponFamiliarity` takes an ARRAY now — and why they
 * resolve to `weaponGroupRanks` rather than to 292 per-weapon overrides.
 *
 * A WIZARD is the test class on purpose: trained in simple weapons and untrained in martial and
 * advanced, so each clause moves a number that would otherwise sit still — and the advanced clause
 * demonstrably grants nothing, which is the half a group-wide rule would get wrong.
 */
const inv = (itemId: string, i: number): InventoryItem => ({
  instanceId: `i${i}`,
  itemId,
  quantity: 1,
  equipped: true,
});

describe('Explosive Savant', () => {
  const c = content();
  const bomb = Object.values(c.items).find((it) => it.itemType === 'weapon' && it.group === 'bomb' && it.category === 'martial')!;
  const martialFirearm = Object.values(c.items).find((it) => it.itemType === 'weapon' && it.group === 'firearm' && it.category === 'martial')!;
  const advancedFirearm = Object.values(c.items).find((it) => it.itemType === 'weapon' && it.group === 'firearm' && it.category === 'advanced')!;
  const crossbow = Object.values(c.items).find((it) => it.itemType === 'weapon' && it.group === 'crossbow' && it.category === 'simple')!;

  it('has the three weapons the feat distinguishes', () => {
    expect([bomb, martialFirearm, advancedFirearm, crossbow].every(Boolean)).toBe(true);
  });

  const withFeat = (has: boolean) =>
    build('wizard', 11, {
      featPicks: has ? { '1:ancestry:0': 'explosive-savant' } : {},
      ancestryId: 'dwarf',
      inventory: [inv(bomb.id, 1), inv(martialFirearm.id, 2), inv(advancedFirearm.id, 3), inv(crossbow.id, 4)],
    });

  const rankOf = (name: string, has: boolean) => {
    const ch = withFeat(has);
    return deriveStrikes(ch, c).find((s) => s.name === name)?.rank;
  };

  it('is stored as group rules, not as one override per weapon', () => {
    const ch = withFeat(true);
    expect(ch.proficiencies.weaponGroupRanks).toEqual([
      { group: 'bomb', rank: 'trained' },
      { group: 'firearm', category: 'martial', rank: 'trained' },
    ]);
    // The 292 weapons it covers are NOT written out — that list would flood the Details tab with a
    // proficiency row each. (The wizard's own five named weapons stay where they were.)
    const overridden = Object.keys(ch.proficiencies.weaponOverrides ?? {});
    expect(overridden.filter((id) => ['bomb', 'firearm'].includes(c.items[id]?.group ?? ''))).toEqual([]);
  });

  it('raises bombs and martial firearms to the SIMPLE rank', () => {
    expect(rankOf(bomb.name, false)).toBe('untrained');
    expect(rankOf(bomb.name, true)).toBe('trained');
    expect(rankOf(martialFirearm.name, true)).toBe('trained');
  });

  it('raises advanced firearms only to the MARTIAL rank', () => {
    // The wizard is untrained in martial, so this clause grants nothing here — which is the point:
    // it does NOT hand advanced firearms the simple (trained) rank a group-wide rule would.
    expect(rankOf(advancedFirearm.name, true)).toBe('untrained');
  });

  it('leaves crossbows alone — the feat never mentions them', () => {
    expect(rankOf(crossbow.name, false)).toBe(rankOf(crossbow.name, true));
  });
});
