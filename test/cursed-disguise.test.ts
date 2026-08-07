import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { hiddenCursedIds, playerFacingContent } from '../src/rules/cursedItems';
import type { InventoryItem } from '../src/rules/types';

/**
 * The hidden-cursed-item subsystem was fully wired in the rules layer and could never fire: NO item
 * carried `disguisedAs` and nothing anywhere set `hiddenCurse`. A documented GM feature with no data
 * and no control.
 */
describe('disguised cursed items', () => {
  const c = () => content();

  it('each names a twin that ships', () => {
    const disguised = Object.values(c().items).filter((i) => i.disguisedAs);
    expect(disguised.length).toBeGreaterThanOrEqual(9);
    for (const it of disguised) {
      expect(c().items[it.disguisedAs!], `${it.id} -> ${it.disguisedAs}`).toBeTruthy();
      // A disguise only makes sense on a cursed item.
      expect(it.traits, it.id).toContain('cursed');
    }
  });

  it('shows the player the twin and the GM the truth', () => {
    const inv: InventoryItem[] = [{ instanceId: 'g', itemId: 'gaffe-glasses', quantity: 1, worn: true, hiddenCurse: true }];
    expect([...hiddenCursedIds(inv, c())]).toEqual(['gaffe-glasses']);
    const playerView = playerFacingContent(c(), inv);
    // The player's copy of the record IS the twin — name, description and bonuses.
    expect(playerView.items['gaffe-glasses'].name).toBe(c().items['glasses-of-sociability'].name);
    // …and the GM's database is untouched.
    expect(c().items['gaffe-glasses'].name).not.toBe(c().items['glasses-of-sociability'].name);
  });

  it('leaves an ordinary cursed item alone until the GM plants it', () => {
    const inv: InventoryItem[] = [{ instanceId: 'g', itemId: 'gaffe-glasses', quantity: 1, worn: true }];
    expect([...hiddenCursedIds(inv, c())]).toEqual([]);
    expect(playerFacingContent(c(), inv).items['gaffe-glasses'].name).toBe(c().items['gaffe-glasses'].name);
  });
});
