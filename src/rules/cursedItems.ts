import type { ContentDatabase, InventoryItem, Item } from './types';

/**
 * Cursed items a GM planted on a character without telling them.
 *
 * A player who CHOOSES a cursed item gets it exactly as printed — curse included, plainly visible.
 * Nothing here touches that case.
 *
 * The other case is a GM handing over a cursed item disguised as an ordinary one. Gaffe Glasses look
 * like Glasses of Sociability and promise +1 Diplomacy; the rules say the GM secretly adjusts the roll.
 * So the app does the same thing the item does:
 *
 *   the PLAYER sees the uncursed twin in full — its name, its description, and its bonuses really
 *   applied to their sheet, so they cannot tell;
 *   the GM sees the character's TRUE numbers, because the fake bonus is not real in the game.
 *
 * That is why this is a CONTENT swap rather than a render-time label: every downstream consumer —
 * the item card, the inventory, passiveEffects, resistances, the stat breakdowns — reads the item
 * record, so swapping the record disguises all of them at once and none of them needs to know.
 *
 * Scope (the owner's ruling): only cursed items whose own text describes a disguise, i.e. those
 * carrying `disguisedAs`. A cursed item with no twin has nothing to pretend to be.
 */

/** Ids of items in this inventory that are planted-hidden AND have a twin to wear. */
export function hiddenCursedIds(inventory: readonly InventoryItem[] | undefined, db: ContentDatabase): Set<string> {
  const out = new Set<string>();
  for (const inv of inventory ?? []) {
    if (!inv.hiddenCurse) continue;
    const twin = db.items[inv.itemId]?.disguisedAs;
    if (twin && db.items[twin]) out.add(inv.itemId);
  }
  return out;
}

/**
 * A content database as the PLAYER should see it: every hidden-cursed item replaced by its uncursed
 * twin's record, under the cursed item's own id so the inventory instance still resolves.
 *
 * Returns the SAME object when nothing is disguised — the common case by far, and re-deriving a
 * whole sheet against a fresh database object on every render would be wasteful and would defeat
 * memoisation.
 */
export function playerFacingContent(db: ContentDatabase, inventory: readonly InventoryItem[] | undefined): ContentDatabase {
  const hidden = hiddenCursedIds(inventory, db);
  if (!hidden.size) return db;
  const items: Record<string, Item> = { ...db.items };
  for (const id of hidden) {
    const twin = db.items[db.items[id]!.disguisedAs!]!;
    // Keep the cursed id so inventory instances still resolve; take everything else from the twin,
    // including its name and description — the disguise has to survive being read, not just glanced at.
    const shown: Item = { ...twin, id };
    // …and stamp the id of the record it is WEARING, so the popup's page and its pin open the twin's
    // Archives page, not the cursed item's (card step 7a, docs/card-design.md section 2 rule 2c: a
    // hidden Bag of Devouring printed "devours the victim" under the name Spacious Pouch).
    SHOWN_ID.set(shown, twin.id);
    items[id] = shown;
  }
  return { ...db, items };
}

/*
 * The stamp is kept beside the record, not on it: the record must stay exactly `{ ...twin, id }` (every
 * reader treats it as the twin), and the disguised database is never stored or synced — it is rebuilt
 * from the raw one on every derive, so a stamp living only as long as the record object is the right
 * lifetime.
 */
const SHOWN_ID = new WeakMap<Item, string>();

/**
 * The id of the record an item SHOWS — the one whose Archives page, pin and title the player sees. For a
 * hidden cursed item in a player-facing database (playerFacingContent) that is its disguise twin's id;
 * for every other item it is its own. `content` lets a caller holding a copy of the record (a spread)
 * still find the stamp through the database's own record of the same id.
 */
export function shownItemId(item: Item, content?: ContentDatabase): string {
  return SHOWN_ID.get(item) ?? (content?.items[item.id] ? SHOWN_ID.get(content.items[item.id]!) : undefined) ?? item.id;
}

/**
 * Can the player remove this item themselves?
 *
 * A cursed item that sticks (`stuck`) cannot simply be dropped. The app does not enforce that — the
 * GM does — but the player should be told to ask rather than discovering later that the item came
 * back. The dialog still offers Remove: this is a table aid, not a lock.
 */
export function isStuckItem(inv: InventoryItem, db: ContentDatabase): boolean {
  return !!db.items[inv.itemId]?.stuck;
}
