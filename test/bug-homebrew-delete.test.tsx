// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { AddItemsModal } from '../src/sheet/AddItemsModal';
import { InventoryTab } from '../src/sheet/InventoryTab';
import type { Character, Coins, ContentDatabase, InventoryItem, Item } from '../src/rules/types';

/**
 * bug 2026-09-12 #7: homebrew-delete. Owner: *"for items that a user created and appear in search
 * have a way to delete them in search, ask the user if they are sure; if they delete the item in
 * search but they still have it in the inventory then dont delete it from the inventory."*
 *
 * MEASURED CAUSE of the second half: an inventory row resolves its record with
 * `content.items[inv.itemId]` (InventoryTab's `resolve`), and a row whose record is gone renders as
 * `UnknownItemCard` — "Unknown item / missing data (<id>)". So erasing the record erases the item the
 * player is carrying, which is exactly what the owner ruled out. The delete therefore RETIRES the
 * record (`retired: true`, written through the same `onSaveItem` callback that registers a created
 * item): hidden from the browse list, still resolvable by id everywhere else, and still listed in the
 * Homebrew manager, whose own Delete is the permanent one.
 *
 * The last test is the one that makes the rest load-bearing: it renders the SAME inventory with the
 * record actually removed and shows the "Unknown item" card the retire exists to prevent.
 */
const c = () => content();
const noop = () => undefined;
const purse: Coins = { gp: 500 };

/** An item the player authored: `source.license === 'homebrew'` is the stamp the homebrew merge puts
 *  on every stored entry, and `custom-…` the id the item editor mints. */
function authored(): Item {
  return {
    id: 'custom-bottled-lightning-7f3a',
    name: 'Bottled Lightning',
    itemType: 'equipment',
    level: 3,
    bulk: 0.1,
    traits: ['magical'],
    rarity: 'common',
    price: { gp: 12 },
    description: 'A jar of captured storm.',
    source: { license: 'homebrew', book: 'My Homebrew' },
  } as Item;
}

/** A two-row catalog: one printed item, one authored. Keeps the rendered picker small and makes the
 *  "the row is gone" assertion impossible to pass by rendering an empty list. */
function catalog(extra: Item): ContentDatabase {
  const db = c();
  return { ...db, items: { longsword: db.items['longsword'], [extra.id]: extra }, services: {}, vehicles: {}, siegeWeapons: {} } as ContentDatabase;
}

/** The character carrying one, and the full database (plus the authored item) they resolve against. */
function carrier(extra?: Item): { character: Character; db: ContentDatabase } {
  const inv = { instanceId: 'bl-1', itemId: 'custom-bottled-lightning-7f3a', quantity: 1 } as InventoryItem;
  const db = c();
  return {
    character: { ...build('fighter', 3), inventory: [inv] } as Character,
    db: { ...db, items: extra ? { ...db.items, [extra.id]: extra } : db.items } as ContentDatabase,
  };
}

const confirmButton = (label: string) =>
  [...document.querySelectorAll('.confirm-modal button')].find((b) => (b.textContent ?? '').trim() === label) as
    | HTMLButtonElement
    | undefined;

afterEach(() => {
  for (const el of [...document.querySelectorAll('.confirm-overlay')]) el.parentElement?.remove();
});

describe('bug 2026-09-12 #7: homebrew-delete — deleting an authored item in the search keeps the one you carry', () => {
  // bug 2026-09-12 #7: homebrew-delete
  it('offers Delete on the row the player authored, and on no other row', () => {
    const hb = authored();
    const { host, stop } = renderDom(
      <AddItemsModal content={catalog(hb)} currency={purse} onBuy={noop} onGive={noop} onClose={noop} onSaveItem={noop} />,
    );
    const dels = [...host.querySelectorAll('.ai-buy button.del')];
    // Both rows render (so the single Delete is a CHOICE, not an empty catalog)…
    expect(host.textContent).toContain('Longsword');
    expect(host.textContent).toContain('Bottled Lightning');
    // …and exactly one of them, the authored one, carries the control.
    expect(dels).toHaveLength(1);
    expect(dels[0].getAttribute('aria-label')).toBe('Delete Bottled Lightning');
    stop();
  });

  // bug 2026-09-12 #7: homebrew-delete
  it('asks first — cancelling the confirm deletes nothing', async () => {
    const hb = authored();
    const saved: Item[] = [];
    const { host, click, stop } = renderDom(
      <AddItemsModal content={catalog(hb)} currency={purse} onBuy={noop} onGive={noop} onClose={noop} onSaveItem={(i) => saved.push(i)} />,
    );
    click(host.querySelector('.ai-buy button.del'));
    await act(async () => undefined);
    // The app's own dialog, never a native confirm() — and it names the item.
    expect(document.querySelector('.confirm-modal')?.textContent).toContain('Delete Bottled Lightning?');
    const cancel = confirmButton('Cancel');
    expect(cancel).toBeTruthy();
    await act(async () => {
      cancel!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(saved).toHaveLength(0);
    stop();
  });

  // bug 2026-09-12 #7: homebrew-delete
  it('confirming retires the record rather than erasing it, and the row leaves the search', async () => {
    const hb = authored();
    const saved: Item[] = [];
    const first = renderDom(
      <AddItemsModal content={catalog(hb)} currency={purse} onBuy={noop} onGive={noop} onClose={noop} onSaveItem={(i) => saved.push(i)} />,
    );
    first.click(first.host.querySelector('.ai-buy button.del'));
    await act(async () => undefined);
    const del = confirmButton('Delete');
    expect(del).toBeTruthy();
    await act(async () => {
      del!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    first.stop();

    // What was written: the SAME record, marked retired — not a removal.
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(hb.id);
    expect(saved[0].name).toBe(hb.name);
    expect(saved[0].retired).toBe(true);

    // Re-open the search with what was written: the row is gone, the printed one is not.
    const second = renderDom(
      <AddItemsModal content={catalog(saved[0])} currency={purse} onBuy={noop} onGive={noop} onClose={noop} onSaveItem={noop} />,
    );
    expect(second.host.textContent).toContain('Longsword');
    expect(second.host.textContent).not.toContain('Bottled Lightning');
    second.stop();
  });

  // bug 2026-09-12 #7: homebrew-delete
  it('…and the character still carrying one keeps it, named and intact', () => {
    const retired = { ...authored(), retired: true } as Item;
    const { character, db } = carrier(retired);
    const { host, stop } = renderDom(<InventoryTab character={character} content={db} />);
    const text = host.textContent ?? '';
    stop();
    expect(text).toContain('Bottled Lightning');
    expect(text).not.toContain('Unknown item');
  });

  // bug 2026-09-12 #7: homebrew-delete
  it('which is exactly what a real erasure would have cost — the same sheet, record removed', () => {
    // The control against which the test above means something: with no record to resolve, the item
    // the player bought is an "Unknown item / missing data" card. This is the outcome `retired` avoids.
    const { character, db } = carrier();
    const { host, stop } = renderDom(<InventoryTab character={character} content={db} />);
    const text = host.textContent ?? '';
    stop();
    expect(text).toContain('Unknown item');
    expect(text).not.toContain('Bottled Lightning');
  });
});
