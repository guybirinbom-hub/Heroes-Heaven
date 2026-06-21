import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes, formatMod } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import type { InventoryItem } from '../src/rules/types';

const db = content();
const sum = (parts: { value: number }[]) => parts.reduce((a, p) => a + p.value, 0);

describe('strike calculation breakdowns (explainStat)', () => {
  it('strikeAttack parts sum to the strike attack bonus, and drive a Roll', () => {
    const ch = build('fighter', 5, { keyAbility: 'str' });
    const fist = deriveStrikes(ch, db).find((s) => s.instanceId === 'fist')!;
    const b = explainStat(ch, db, { kind: 'strikeAttack', instanceId: 'fist' });
    expect(sum(b.parts)).toBe(fist.attack[0]);
    expect(b.totalText).toBe(formatMod(fist.attack[0]));
    expect(b.roll?.modifier).toBe(fist.attack[0]);
  });

  it('strikeDamage total equals the flat damage bonus (dice/runes shown as formula, not summed)', () => {
    const ch = build('fighter', 5, { keyAbility: 'str' });
    const fist = deriveStrikes(ch, db).find((s) => s.instanceId === 'fist')!;
    const b = explainStat(ch, db, { kind: 'strikeDamage', instanceId: 'fist' });
    expect(sum(b.parts)).toBe(fist.dmgBonus);
    expect(b.totalText).toBe(formatMod(fist.dmgBonus));
    expect(b.subtitle).toContain(fist.damage);
    expect(b.roll).toBeUndefined(); // damage isn't a flat d20 roll
  });

  it('a martial weapon strike breakdown sums correctly for attack and damage', () => {
    const ch = build('fighter', 5, {
      keyAbility: 'str',
      inventory: [{ instanceId: 'ls', itemId: 'longsword', quantity: 1, equipped: true } as InventoryItem],
    });
    const strike = deriveStrikes(ch, db).find((s) => s.base === 'longsword')!;
    expect(sum(explainStat(ch, db, { kind: 'strikeAttack', instanceId: strike.instanceId }).parts)).toBe(strike.attack[0]);
    expect(sum(explainStat(ch, db, { kind: 'strikeDamage', instanceId: strike.instanceId }).parts)).toBe(strike.dmgBonus);
  });

  it('elemental blast and an unknown id both return a breakdown without throwing', () => {
    const ch = build('fighter', 5, { keyAbility: 'str' });
    expect(() => explainStat(ch, db, { kind: 'strikeAttack', instanceId: 'nope' })).not.toThrow();
    expect(() => explainStat(ch, db, { kind: 'strikeDamage', instanceId: 'nope' })).not.toThrow();
  });
});
