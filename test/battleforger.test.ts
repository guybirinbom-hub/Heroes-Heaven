import { describe, it, expect } from 'vitest';
import { deriveAc, deriveStrike, ownedFeatureIds } from '../src/rules/derive';
import { rest } from '../src/rules/play';
import type { Character, InventoryItem } from '../src/rules/types';
import { content, build } from './_content';

/**
 * Battleforger (ruling O): an hour's work grants a weapon or armour the effects of a +1 potency rune
 * UNTIL YOUR NEXT DAILY PREPARATIONS.
 *
 * Two things the feat says that are easy to get wrong, and both are tested here:
 *  - "This has no effect if the weapon or armor already had a potency rune" — it is an item bonus of
 *    the same class, so it must take the HIGHEST rather than add. A +2 weapon stays +2, not +3.
 *  - it expires. rest() has to clear it, or a temporary bonus quietly becomes a permanent rune the
 *    player never etched.
 */
const db = () => content();

const weapon = (extra: Partial<InventoryItem> = {}): InventoryItem => ({
  instanceId: 'w1',
  itemId: Object.keys(db().items).find((id) => db().items[id].itemType === 'weapon' && db().items[id].damage)!,
  quantity: 1,
  equipped: true,
  ...extra,
});

const charWith = (inv: InventoryItem[]): Character => ({ ...build('fighter', 5), inventory: inv });

describe('Battleforger — a temporary +1 potency', () => {
  it('adds +1 to a weapon attack while set', () => {
    const plain = deriveStrike(charWith([weapon()]), db(), weapon());
    const forged = deriveStrike(charWith([weapon({ battleforged: true })]), db(), weapon({ battleforged: true }));
    expect(forged!.attack[0] - plain!.attack[0]).toBe(1); // attack is the MAP array
  });

  it('does NOT stack with a real potency rune — the feat says it has no effect then', () => {
    const runed = weapon({ runes: { potency: 2 } });
    const both = weapon({ runes: { potency: 2 }, battleforged: true });
    const a = deriveStrike(charWith([runed]), db(), runed);
    const b = deriveStrike(charWith([both]), db(), both);
    expect(b!.attack).toEqual(a!.attack); // +2 stays +2, never +3
  });

  it('raises AC by 1 on worn armour', () => {
    const armorId = Object.keys(db().items).find((id) => db().items[id].itemType === 'armor' && db().items[id].acBonus)!;
    const plain: InventoryItem = { instanceId: 'a1', itemId: armorId, quantity: 1, worn: true };
    const forged: InventoryItem = { ...plain, battleforged: true };
    const before = deriveAc(charWith([plain]), db()).value;
    const after = deriveAc(charWith([forged]), db()).value;
    expect(after - before).toBe(1);
  });

  it('is cleared by daily preparations — this is what keeps it temporary', () => {
    const play = {
      damage: 0,
      tempHp: 0,
      focusUsed: 0,
      inventory: [weapon({ battleforged: true })],
    } as unknown as Parameters<typeof rest>[0];
    const after = rest(play, { level: 5, conMod: 2 });
    expect(after.inventory?.[0].battleforged).toBeUndefined();
  });

  it('a chosen inventor modification counts as an owned feature', () => {
    // The gap that made Segmented Frame's +2 Stealth unreachable: modifications live on c.inventor,
    // not classChoices, so nothing that reads owned features could see them.
    const c = { ...build('inventor', 5), inventor: { modifications: { initial: 'segmented-frame' } } } as unknown as Character;
    expect(ownedFeatureIds(c, db()).has('segmented-frame')).toBe(true);
  });
});
