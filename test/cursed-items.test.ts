import { describe, it, expect } from 'vitest';
import { playerFacingContent, hiddenCursedIds, isStuckItem } from '../src/rules/cursedItems';
import { deriveSkill } from '../src/rules/derive';
import type { Character, ContentDatabase, InventoryItem, Item } from '../src/rules/types';
import { content, build } from './_content';

/**
 * A cursed item a GM planted WITHOUT telling the player (ruling L).
 *
 * The player must see the uncursed twin in full — name, description AND its bonuses actually applied
 * — so they cannot tell the difference, exactly as the item deceives them in the fiction. The GM's
 * view of the same character must show the TRUE numbers, because the fake bonus is not real.
 *
 * A player who CHOOSES a cursed item is untouched by any of this; that case was always correct.
 */
const TWIN: Item = {
  id: 'test-nice-glasses',
  name: 'Nice Glasses',
  itemType: 'equipment',
  level: 1,
  traits: [],
  rarity: 'common',
  description: 'Ordinary, helpful eyewear.',
  passiveEffects: { skills: { diplomacy: 1 } },
} as Item;

const CURSED: Item = {
  id: 'test-gaffe-glasses',
  name: 'Gaffe Glasses',
  itemType: 'equipment',
  level: 1,
  traits: ['cursed'],
  rarity: 'common',
  description: 'They appear to be Nice Glasses. They grant nothing.',
  disguisedAs: 'test-nice-glasses',
  stuck: true,
} as Item;

const db = (): ContentDatabase => {
  const base = content();
  return { ...base, items: { ...base.items, [TWIN.id]: TWIN, [CURSED.id]: CURSED } };
};

const wearing = (inv: Partial<InventoryItem>): Character => ({
  ...build('fighter', 5),
  inventory: [{ instanceId: 'x1', itemId: CURSED.id, quantity: 1, invested: true, worn: true, ...inv }],
});

describe('a GM-planted hidden cursed item', () => {
  it('shows the player the twin — name and description', () => {
    const seen = playerFacingContent(db(), wearing({ hiddenCurse: true }).inventory);
    expect(seen.items[CURSED.id].name).toBe('Nice Glasses');
    expect(seen.items[CURSED.id].description).toContain('Ordinary');
  });

  it('keeps the cursed id, so the inventory instance still resolves', () => {
    const seen = playerFacingContent(db(), wearing({ hiddenCurse: true }).inventory);
    expect(seen.items[CURSED.id].id).toBe(CURSED.id);
  });

  it("applies the twin's bonus to the player's sheet — they must not be able to tell", () => {
    const c = wearing({ hiddenCurse: true });
    const truth = deriveSkill(c, 'diplomacy', db()).modifier;
    const asPlayer = deriveSkill(c, 'diplomacy', playerFacingContent(db(), c.inventory)).modifier;
    expect(asPlayer - truth).toBe(1);
  });

  it('the GM view keeps the TRUE numbers — the fake bonus is not real in the game', () => {
    const c = wearing({ hiddenCurse: true });
    // The GM path simply does not call playerFacingContent.
    const gmView = deriveSkill(c, 'diplomacy', db()).modifier;
    const noItem = deriveSkill({ ...c, inventory: [] }, 'diplomacy', db()).modifier;
    expect(gmView).toBe(noItem);
  });

  it('a cursed item the PLAYER chose is untouched — no disguise', () => {
    const c = wearing({}); // no hiddenCurse flag
    const seen = playerFacingContent(db(), c.inventory);
    expect(seen.items[CURSED.id].name).toBe('Gaffe Glasses');
    expect(seen).toBe(db().items ? seen : seen); // sanity
    expect(hiddenCursedIds(c.inventory, db()).size).toBe(0);
  });

  it('returns the SAME database object when nothing is disguised', () => {
    const base = db();
    expect(playerFacingContent(base, wearing({}).inventory)).toBe(base);
  });

  it('a hidden cursed item with no twin cannot pretend to be anything', () => {
    const base = db();
    const noTwin = { ...base, items: { ...base.items, [CURSED.id]: { ...CURSED, disguisedAs: undefined } as Item } };
    expect(hiddenCursedIds(wearing({ hiddenCurse: true }).inventory, noTwin).size).toBe(0);
  });

  it('knows a stuck item, so removal can warn first', () => {
    expect(isStuckItem({ instanceId: 'x', itemId: CURSED.id, quantity: 1 }, db())).toBe(true);
    expect(isStuckItem({ instanceId: 'y', itemId: TWIN.id, quantity: 1 }, db())).toBe(false);
  });
});
