import { describe, it, expect } from 'vitest';
import { deriveSave, deriveStrike, deriveShield, resilientSaveBonus } from '../src/rules/derive';
import type { Character, InventoryItem } from '../src/rules/types';
import { content, build } from './_content';

const C = content();
const armorId = Object.values(C.items).find((i) => i.itemType === 'armor')!.id;
const weaponId = Object.values(C.items).find((i) => i.itemType === 'weapon' && i.damage?.die)!.id;
const shield = Object.values(C.items).find((i) => i.itemType === 'shield' && i.hardness < 8 && i.hp < 64)!;

const withInventory = (inv: InventoryItem[]): Character => ({ ...build('fighter', 5), inventory: inv });

describe('runes recompute stats', () => {
  it('a resilient rune adds an item bonus to saves (only when the content DB is supplied)', () => {
    const ch = withInventory([{ instanceId: 'a', itemId: armorId, quantity: 1, worn: true, runes: { potency: 1, resilient: 'greater' } }]);
    const noDb = deriveSave(ch, 'will').modifier; // no resilient without db
    const withDb = deriveSave(ch, 'will', C).modifier;
    expect(resilientSaveBonus(ch, C)).toBe(2); // greater = +2
    expect(withDb - noDb).toBe(2);
  });

  it('resilient only counts on WORN armor', () => {
    const ch = withInventory([{ instanceId: 'a', itemId: armorId, quantity: 1, worn: false, runes: { resilient: 'resilient' } }]);
    expect(resilientSaveBonus(ch, C)).toBe(0);
  });

  it('weapon potency raises the attack bonus; striking adds damage dice', () => {
    const plain = withInventory([{ instanceId: 'w', itemId: weaponId, quantity: 1, equipped: true }]);
    const runed = withInventory([{ instanceId: 'w', itemId: weaponId, quantity: 1, equipped: true, runes: { potency: 2, striking: 'striking' } }]);
    const a0 = deriveStrike(plain, C, plain.inventory[0])!;
    const a1 = deriveStrike(runed, C, runed.inventory[0])!;
    expect(a1.attack[0] - a0.attack[0]).toBe(2); // +2 potency
    // striking adds a damage die: base "1dX..." → "2dX..."
    const baseDice = Number(a0.damage.match(/^(\d+)d/)![1]);
    const runedDice = Number(a1.damage.match(/^(\d+)d/)![1]);
    expect(runedDice - baseDice).toBe(1);
  });

  it('an elemental property rune appends its damage to the Strike', () => {
    const ch = withInventory([
      { instanceId: 'w', itemId: weaponId, quantity: 1, equipped: true, runes: { potency: 1, property: ['flaming'] } },
    ]);
    const strike = deriveStrike(ch, C, ch.inventory[0])!;
    expect(strike.damage).toContain('plus 1d6 fire');
  });

  it('a reinforcing rune raises a shield to its tier Hardness/HP/BT', () => {
    const plain = withInventory([{ instanceId: 's', itemId: shield.id, quantity: 1, equipped: true }]);
    const minor = withInventory([{ instanceId: 's', itemId: shield.id, quantity: 1, equipped: true, runes: { reinforcing: 1 } }]);
    const p = deriveShield(plain, C)!;
    const m = deriveShield(minor, C)!;
    expect(p.hardness).toBe(shield.hardness); // unchanged
    expect(m.hardness).toBe(Math.max(shield.hardness, 8)); // minor → 8
    expect(m.hp).toBe(Math.max(shield.hp, 64));
    expect(m.brokenThreshold).toBe(Math.max(shield.brokenThreshold, 32));
  });
});
