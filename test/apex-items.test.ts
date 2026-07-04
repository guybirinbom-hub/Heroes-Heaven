import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { applyPlayState, initialPlay, itemApex } from '../src/rules/play';
import type { InventoryItem } from '../src/rules/types';

const db = content();

/** An inventory entry for an apex item (worn + invested unless overridden). */
const apexEntry = (itemId: string, over: Partial<InventoryItem> = {}): InventoryItem => ({
  instanceId: `inv-${itemId}`,
  itemId,
  quantity: 1,
  worn: true,
  invested: true,
  ...over,
});

describe('Regular apex items (importer)', () => {
  it('every apex-trait item carries which attribute it boosts', () => {
    const apexItems = Object.values(db.items).filter((i) => i.traits?.includes('apex'));
    expect(apexItems.length).toBeGreaterThan(30);
    expect(apexItems.filter((i) => !i.apexAttribute)).toEqual([]);
    expect(db.items['belt-of-giant-strength']?.apexAttribute).toBe('str');
  });
});

describe('Regular apex items (in play)', () => {
  const withItems = (ch: ReturnType<typeof build>, items: InventoryItem[]) => ({
    ...initialPlay(ch, db),
    inventory: [...ch.inventory, ...items],
  });

  it('an invested apex item raises a below-18 attribute to 18', () => {
    const ch = build('fighter', 17, { keyAbility: 'str' });
    expect(ch.abilities.wis).toBeLessThan(18);
    const live = applyPlayState(ch, withItems(ch, [apexEntry('amulet-of-the-third-eye')]), db);
    expect(live.abilities.wis).toBe(18);
  });

  it('an invested apex item adds +2 to an attribute already at 18+', () => {
    // The minimal test build assigns no level-up boosts, so pin the score at 18 explicitly.
    const base = build('fighter', 17, { keyAbility: 'str' });
    const ch = { ...base, abilities: { ...base.abilities, str: 18 } };
    const live = applyPlayState(ch, withItems(ch, [apexEntry('belt-of-giant-strength')]), db);
    expect(live.abilities.str).toBe(20);
  });

  it('a carried-but-uninvested apex item does nothing', () => {
    const ch = build('fighter', 17, { keyAbility: 'str' });
    const live = applyPlayState(ch, withItems(ch, [apexEntry('amulet-of-the-third-eye', { invested: false })]), db);
    expect(live.abilities.wis).toBe(ch.abilities.wis);
  });

  it('only the first invested apex item applies', () => {
    const ch = build('fighter', 17, { keyAbility: 'str' });
    const live = applyPlayState(ch, withItems(ch, [apexEntry('belt-of-giant-strength'), apexEntry('amulet-of-the-third-eye')]), db);
    expect(live.abilities.str).toBe(ch.abilities.str >= 18 ? ch.abilities.str + 2 : 18); // first wins
    expect(live.abilities.wis).toBe(ch.abilities.wis); // second is inert
  });

  it('itemApex reads only invested entries', () => {
    expect(itemApex([apexEntry('belt-of-giant-strength')], db)).toBe('str');
    expect(itemApex([apexEntry('belt-of-giant-strength', { invested: false })], db)).toBeNull();
    expect(itemApex([], db)).toBeNull();
    expect(itemApex(undefined, db)).toBeNull();
  });
});

describe('Apex items vs Automatic Bonus Progression (no double-boost)', () => {
  const withItems = (ch: ReturnType<typeof build>, items: InventoryItem[]) => ({
    ...initialPlay(ch, db),
    inventory: [...ch.inventory, ...items],
  });

  it('under ABP, an invested apex item grants NO attribute benefit (ABP already applied its apex)', () => {
    // ABP L17 bakes the attribute apex into the built character; the play overlay must not re-apply it.
    const ch = build('fighter', 17, { keyAbility: 'str', variantRules: { abp: true }, abpApex: 'str' });
    const before = ch.abilities.str;
    const live = applyPlayState(ch, withItems(ch, [apexEntry('belt-of-giant-strength')]), db);
    expect(live.abilities.str).toBe(before); // no second boost
    // A non-str apex item is likewise inert under ABP.
    const live2 = applyPlayState(ch, withItems(ch, [apexEntry('amulet-of-the-third-eye')]), db);
    expect(live2.abilities.wis).toBe(ch.abilities.wis);
  });

  it('without ABP, the same invested apex item still boosts', () => {
    const ch = build('fighter', 17, { keyAbility: 'str' });
    expect(ch.abilities.wis).toBeLessThan(18);
    const live = applyPlayState(ch, withItems(ch, [apexEntry('amulet-of-the-third-eye')]), db);
    expect(live.abilities.wis).toBe(18);
  });
});
