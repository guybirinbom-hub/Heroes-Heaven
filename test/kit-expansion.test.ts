import { describe, it, expect } from 'vitest';
import { addInventoryItem } from '../src/rules/play';
import type { PlayState } from '../src/rules/play';

const emptyPlay = () => ({ inventory: [] }) as unknown as PlayState;

describe("kit expansion (Adventurer's Pack)", () => {
  it('adds a worn Backpack container holding the pack contents, not one opaque item', () => {
    const inv = addInventoryItem(emptyPlay(), 'adventurers-pack').inventory!;
    expect(inv.some((i) => i.itemId === 'adventurers-pack')).toBe(false);
    const backpack = inv.find((i) => i.itemId === 'backpack');
    expect(backpack).toBeTruthy();
    expect(backpack!.worn).toBe(true);
    const contents = inv.filter((i) => i.containerInstanceId === backpack!.instanceId);
    expect(contents.length).toBe(8);
    expect(contents.find((i) => i.itemId === 'torch')?.quantity).toBe(5);
    expect(contents.find((i) => i.itemId === 'chalk')?.quantity).toBe(10);
    expect(contents.find((i) => i.itemId === 'rations')?.quantity).toBe(2);
    expect(contents.some((i) => i.itemId === 'bedroll')).toBe(true);
  });

  it('every content instanceId is unique', () => {
    const inv = addInventoryItem(emptyPlay(), 'adventurers-pack').inventory!;
    expect(new Set(inv.map((i) => i.instanceId)).size).toBe(inv.length);
  });

  it('a normal item still adds as a single entry', () => {
    const inv = addInventoryItem(emptyPlay(), 'longsword').inventory!;
    expect(inv.length).toBe(1);
    expect(inv[0].itemId).toBe('longsword');
  });
});
