import { describe, it, expect } from 'vitest';
import { chosenFromBooks, removeChosenIds, collectChosenIds, emptyBuild, type BuildState } from '../src/rules/build';
import { content } from './_content';

/**
 * Turning a source book OFF when the character has already taken things from it.
 *
 * Before this, a disabled book was simply hidden from the pickers and anything already chosen stayed
 * on the sheet — so the source list said one thing and the character said another. Now the player is
 * told exactly what would go and it is removed only if they agree.
 *
 * The dangerous half is the removal: dropping the WRONG pick silently destroys a player's choices.
 * removeChosenIds must clear exactly the listed ids and nothing else, and must be the true inverse of
 * collectChosenIds — anything that function can find must be removable, or a disabled book would
 * leave a dangling reference no picker can show.
 */
const db = () => content();

/** The book a given content id comes from. */
function bookOf(map: 'feats' | 'spells' | 'items', id: string): string | undefined {
  const rec = (db()[map] as Record<string, { source?: { book?: string } }>)[id];
  return rec?.source?.book?.trim();
}

/** A build carrying one feat, one spell and one item, with their books. */
function buildWithPicks() {
  const c = db();
  const featId = Object.keys(c.feats).find((id) => c.feats[id].source?.book)!;
  const spellId = Object.keys(c.spells).find((id) => c.spells[id].source?.book)!;
  const itemId = Object.keys(c.items).find((id) => c.items[id].source?.book)!;
  const b: BuildState = {
    ...emptyBuild(),
    name: 'Src',
    level: 5,
    featPicks: { '1:class:0': featId },
    cantrips: [spellId],
    inventory: [{ instanceId: 'i1', itemId, quantity: 1 }],
  };
  return { b, featId, spellId, itemId };
}

describe('removing a source that the character already used', () => {
  it('finds nothing when the character has taken nothing from the book', () => {
    const b = { ...emptyBuild(), name: 'Empty' };
    expect(chosenFromBooks(b, db(), new Set(['Player Core']))).toEqual([]);
  });

  it('names what would be lost, with the map it came from', () => {
    const { b, featId } = buildWithPicks();
    const book = bookOf('feats', featId)!;
    const losing = chosenFromBooks(b, db(), new Set([book]));
    const hit = losing.find((l) => l.id === featId);
    expect(hit, `expected ${featId} to be listed for ${book}`).toBeDefined();
    expect(hit!.kind).toBe('feats');
    expect(hit!.book).toBe(book);
  });

  it('lists nothing for a book the character never used', () => {
    const { b } = buildWithPicks();
    expect(chosenFromBooks(b, db(), new Set(['a book that does not exist']))).toEqual([]);
  });

  it('removes exactly the listed ids', () => {
    const { b, featId } = buildWithPicks();
    const after = removeChosenIds(b, new Set([featId]));
    expect(Object.values(after.featPicks)).not.toContain(featId);
  });

  it('leaves every OTHER pick untouched — the failure that would destroy a character', () => {
    const { b, featId, spellId, itemId } = buildWithPicks();
    const after = removeChosenIds(b, new Set([featId]));
    expect(after.cantrips).toContain(spellId);
    expect(after.inventory.map((i) => i.itemId)).toContain(itemId);
  });

  it('drops an item from the inventory when its book goes', () => {
    const { b, itemId } = buildWithPicks();
    const after = removeChosenIds(b, new Set([itemId]));
    expect(after.inventory.map((i) => i.itemId)).not.toContain(itemId);
  });

  it('clears an identity slot to null, the same value a new character starts with', () => {
    const c = db();
    const ancestryId = Object.keys(c.ancestries)[0];
    const b: BuildState = { ...emptyBuild(), name: 'A', ancestryId };
    const after = removeChosenIds(b, new Set([ancestryId]));
    expect(after.ancestryId).toBeNull();
    expect(emptyBuild().ancestryId).toBeNull(); // the state the builder already handles
  });

  it('is a true inverse of collectChosenIds — nothing it can find survives removal', () => {
    const { b } = buildWithPicks();
    const chosen = collectChosenIds(b, db());
    expect(chosen.size).toBeGreaterThan(0);
    const after = removeChosenIds(b, chosen);
    // Anything still referenced would be a dangling id no picker can show.
    expect([...collectChosenIds(after, db())]).toEqual([]);
  });

  it('changes nothing when the id set is empty', () => {
    const { b } = buildWithPicks();
    expect(removeChosenIds(b, new Set())).toBe(b);
  });
});
