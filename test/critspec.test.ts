import { describe, it, expect } from 'vitest';
import { CRIT_SPEC, critSpec } from '../src/rules/critSpec';
import { deriveStrike } from '../src/rules/derive';
import { content, build } from './_content';
import type { WeaponItem } from '../src/rules/types';

const c = content();

describe('critical specialization table', () => {
  it('covers every weapon group present in the imported data', () => {
    const groups = new Set(
      Object.values(c.items)
        .filter((i): i is WeaponItem => i.itemType === 'weapon')
        .map((w) => w.group)
        .filter(Boolean),
    );
    expect(groups.size).toBeGreaterThanOrEqual(15);
    for (const g of groups) {
      expect(CRIT_SPEC[g], `missing critical specialization for weapon group "${g}"`).toBeTruthy();
    }
  });

  it('has the 17 standard weapon groups', () => {
    expect(Object.keys(CRIT_SPEC)).toHaveLength(17);
    expect(critSpec('sword')).toMatch(/off-guard/i);
    expect(critSpec('bomb')).toMatch(/splash/i);
    expect(critSpec(undefined)).toBeUndefined();
  });
});

describe('deriveStrike surfaces range / reload / group', () => {
  it('a ranged weapon (crossbow) carries range, reload and group', () => {
    const ch = build('fighter', 1, { keyAbility: 'str' });
    const withBow = {
      ...ch,
      inventory: [{ instanceId: 'w1', itemId: 'crossbow', quantity: 1, equipped: true }],
    };
    const s = deriveStrike(withBow, c, withBow.inventory[0]);
    expect(s?.ranged).toBe(true);
    expect(s?.range).toBe(120);
    expect(s?.reload).toBe(1);
    expect(s?.group).toBe('crossbow');
  });

  it('a melee weapon (longsword) has a group but no range/reload', () => {
    const ch = build('fighter', 1, { keyAbility: 'str' });
    const withSword = {
      ...ch,
      inventory: [{ instanceId: 'w1', itemId: 'longsword', quantity: 1, equipped: true }],
    };
    const s = deriveStrike(withSword, c, withSword.inventory[0]);
    expect(s?.group).toBe('sword');
    expect(s?.range == null).toBe(true);
  });
});
