import { describe, it, expect } from 'vitest';
import {
  addBankedPartEntry,
  updateBankedPartEntry,
  removeBankedPartEntry,
  spendBankedParts,
  returnBankedParts,
  bankedPartsTotal,
  setItemMonsterPart,
  type PlayState,
} from '../src/rules/play';
import type { InventoryItem, ItemMonsterPart } from '../src/rules/types';

function play(over: Partial<PlayState> = {}): PlayState {
  return {
    damage: 0,
    tempHp: 0,
    heroPoints: 0,
    mythicPoints: 0,
    xp: 0,
    shieldDamage: 0,
    ...over,
  } as PlayState;
}

describe('Monster Parts — banked-parts ledger mutations', () => {
  it('adds entries, totals them, and cleans blank fields', () => {
    let p = play();
    p = addBankedPartEntry(p, { gp: 250, source: '  magma scorpion ', tags: ['fire'], note: '' });
    p = addBankedPartEntry(p, { gp: 40, source: '', tags: [] });
    expect(bankedPartsTotal(p)).toBe(290);
    const [a, b] = p.bankedParts!.entries;
    expect(a.source).toBe('magma scorpion'); // trimmed
    expect(a.tags).toEqual(['fire']);
    expect(a.note).toBeUndefined(); // blank dropped
    expect(b.source).toBeUndefined(); // blank dropped
    expect(a.id).not.toBe(b.id); // unique ids
  });

  it('updates and removes entries', () => {
    let p = addBankedPartEntry(play(), { gp: 100, source: 'crab' });
    const id = p.bankedParts!.entries[0].id;
    p = updateBankedPartEntry(p, id, { gp: 175, tags: ['acid'] });
    expect(p.bankedParts!.entries[0].gp).toBe(175);
    expect(p.bankedParts!.entries[0].tags).toEqual(['acid']);
    p = removeBankedPartEntry(p, id);
    expect(p.bankedParts!.entries).toHaveLength(0);
  });

  it('spends parts oldest-first, keeping partial lots and dropping empties, never going negative', () => {
    let p = play();
    p = addBankedPartEntry(p, { gp: 100, source: 'a' });
    p = addBankedPartEntry(p, { gp: 200, source: 'b' });
    p = spendBankedParts(p, 150); // drains lot a fully, 50 from lot b
    expect(bankedPartsTotal(p)).toBe(150);
    expect(p.bankedParts!.entries).toHaveLength(1);
    expect(p.bankedParts!.entries[0].source).toBe('b');
    expect(p.bankedParts!.entries[0].gp).toBe(150);
    // Overspend clamps to empty.
    p = spendBankedParts(p, 9999);
    expect(bankedPartsTotal(p)).toBe(0);
  });

  it('returns parts as a labelled lot', () => {
    let p = returnBankedParts(play(), 125, 'Salvaged parts');
    expect(bankedPartsTotal(p)).toBe(125);
    expect(p.bankedParts!.entries[0].source).toBe('Salvaged parts');
    // Returning 0 is a no-op.
    p = returnBankedParts(p, 0);
    expect(p.bankedParts!.entries).toHaveLength(1);
  });
});

describe('Monster Parts — per-item mode toggle', () => {
  const weapon = (over: Partial<InventoryItem> = {}): InventoryItem => ({
    instanceId: 'w1',
    itemId: 'longsword',
    quantity: 1,
    equipped: true,
    ...over,
  });

  it('setting a blob clears runes (either/or)', () => {
    const p = play({ inventory: [weapon({ runes: { potency: 2, striking: 'greater' } })] });
    const mp: ItemMonsterPart = { kind: 'weapon', refineValue: 250, imbuements: [] };
    const next = setItemMonsterPart(p, 'w1', mp);
    const inv = next.inventory![0];
    expect(inv.monsterPart).toEqual(mp);
    expect(inv.runes).toBeUndefined();
  });

  it('clearing the blob drops the monsterPart field', () => {
    const p = play({ inventory: [weapon({ monsterPart: { kind: 'weapon', refineValue: 20, imbuements: [] } })] });
    const next = setItemMonsterPart(p, 'w1', undefined);
    expect(next.inventory![0].monsterPart).toBeUndefined();
  });
});
