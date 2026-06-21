import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import type { InventoryItem, WeaponRunes } from '../src/rules/types';

const db = content();
const hw = (runes: WeaponRunes, flags: Partial<InventoryItem> = { equipped: true }): InventoryItem =>
  ({ instanceId: 'hw1', itemId: 'handwraps-of-mighty-blows', quantity: 1, ...flags, runes }) as InventoryItem;
const fistOf = (ch: ReturnType<typeof build>) => deriveStrikes(ch, db).find((s) => s.instanceId === 'fist')!;
const baselineFist = () => fistOf(build('fighter', 5, { keyAbility: 'str' }));

describe('Handwraps of Mighty Blows', () => {
  it('never appears as its own strike; potency raises the Fist attack and striking adds Fist dice', () => {
    const ch = build('fighter', 5, { keyAbility: 'str', inventory: [hw({ potency: 2, striking: 'striking' })] });
    const strikes = deriveStrikes(ch, db);
    expect(strikes.some((s) => /handwraps/i.test(s.name))).toBe(false);
    const fist = strikes.find((s) => s.instanceId === 'fist')!;
    expect(fist.attack[0] - baselineFist().attack[0]).toBe(2); // +2 potency
    expect(fist.damage.startsWith('2d4')).toBe(true); // striking → two dice of the Fist's own d4 (not 2d6)
  });

  it('greater striking → 3d4', () => {
    const ch = build('fighter', 5, { keyAbility: 'str', inventory: [hw({ striking: 'greater' })] });
    expect(fistOf(ch).damage.startsWith('3d4')).toBe(true);
  });

  it('a flaming property rune adds 1d6 fire to the unarmed strike', () => {
    const ch = build('fighter', 5, { keyAbility: 'str', inventory: [hw({ potency: 1, property: ['flaming'] })] });
    expect(fistOf(ch).damage).toContain('plus 1d6 fire');
  });

  it('a greater elemental rune adds the persistent crit rider', () => {
    const ch = build('fighter', 5, { keyAbility: 'str', inventory: [hw({ potency: 1, property: ['flaming-greater'] })] });
    const dmg = fistOf(ch).damage;
    expect(dmg).toContain('plus 1d6 fire');
    expect(dmg).toMatch(/persistent fire on a crit/);
  });

  it('applies when the handwraps are only invested (not equipped/wielded)', () => {
    const ch = build('fighter', 5, { keyAbility: 'str', inventory: [hw({ potency: 1 }, { invested: true })] });
    expect(fistOf(ch).attack[0] - baselineFist().attack[0]).toBe(1);
  });

  it('NEGATIVE: simple-category worngloves (wheel-blades) stays a real strike and does NOT buff the Fist', () => {
    const ch = build('fighter', 5, {
      keyAbility: 'str',
      inventory: [{ instanceId: 'wb1', itemId: 'wheel-blades', quantity: 1, equipped: true } as InventoryItem],
    });
    const strikes = deriveStrikes(ch, db);
    expect(strikes.some((s) => /wheel/i.test(s.name))).toBe(true);
    expect(fistOf(ch).damage.startsWith('1d4')).toBe(true); // Fist unbuffed
  });

  it('no handwraps → Fist unchanged (regression)', () => {
    const f = baselineFist();
    expect(f.damage.startsWith('1d4')).toBe(true);
    expect(f.strikingDice).toBe(0);
    expect(f.potencyBonus).toBe(0);
  });
});
