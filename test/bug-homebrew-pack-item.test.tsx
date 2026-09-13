// @vitest-environment jsdom
// bug 2026-09-13: homebrew pack item
import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { content } from './_content';
import { renderDom } from './_render';
import { deriveBulk } from '../src/rules/derive';
import { addInventoryItem, packQuantity, type PlayState } from '../src/rules/play';
import { formatItemPrice, itemPriceCp } from '../src/rules/wealth';
import { normalizeCharacter } from '../src/rules/normalize';
import { InventoryTab } from '../src/sheet/InventoryTab';
import { ItemEditorModal } from '../src/sheet/ItemEditorModal';
import type { Character, ContentDatabase, InventoryItem, Item } from '../src/rules/types';

/**
 * "i want to have a way to create a item that is a pack that lets the user track how many are left."
 *
 * The engine already knew what a pack was — `packOf` divides the printed Bulk and price, a purchase
 * adds a whole pack, and the inventory quantity counts PIECES, so tracking what is left is the
 * stepper that was already there. What was missing is the one control: the homebrew editor had no
 * box for the count, so a player-made quiver could never be a pack at all. These tests hold the
 * control and the chain behind it together.
 */

/** A custom quiver exactly as the editor would save it: 1 sp and L buy TEN bolts. */
const BOLTS: Item = {
  id: 'custom-test-bolts-aaa', itemType: 'consumable', name: 'Test Bolts', level: 0, rarity: 'common',
  traits: ['consumable'], price: { sp: 1 }, packOf: 10, bulk: 0.1, consumableType: 'ammunition',
  description: 'Ten bolts in a case.', source: { license: 'homebrew' },
} as unknown as Item;
/** The same item with the pack count dropped — the "before" this whole feature exists to avoid. */
const LOOSE: Item = { ...BOLTS, id: 'custom-test-loose-aaa', name: 'Test Loose Bolts', packOf: undefined } as Item;

const db = (): ContentDatabase => {
  const real = content();
  return { ...real, items: { ...real.items, [BOLTS.id]: BOLTS, [LOOSE.id]: LOOSE } } as ContentDatabase;
};

const sheet = (inventory: InventoryItem[]): Character =>
  normalizeCharacter({
    id: 'p', name: 'P', level: 1, classId: 'fighter', keyAbility: 'str',
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    feats: [], currency: {}, inventory,
  } as unknown as Character);

const row = (itemId: string, quantity: number): InventoryItem => ({ instanceId: 'i1', itemId, quantity });

/** Type into a controlled React input the way a keyboard does (the native setter, then `input`). */
function typeInto(el: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The editor's "Pack of" box. Throws rather than returning null: a missing control is the defect. */
function packInput(host: HTMLElement): HTMLInputElement {
  const field = [...host.querySelectorAll<HTMLElement>('label.ci-field')].find(
    (l) => (l.querySelector('span')?.textContent ?? '').trim() === 'Pack of',
  );
  if (!field) throw new Error('the item editor has no "Pack of" field');
  return field.querySelector('input')!;
}

/** Field lookup by its visible label, for the name box the Save button is gated on. */
function fieldInput(host: HTMLElement, labelText: string): HTMLInputElement {
  const field = [...host.querySelectorAll<HTMLElement>('label.ci-field')].find(
    (l) => (l.querySelector('span')?.textContent ?? '').trim().startsWith(labelText),
  );
  if (!field) throw new Error(`the item editor has no "${labelText}" field`);
  return field.querySelector('input')!;
}

/** Open the editor, let `drive` fill it in, press Save, and hand back what it built. */
function editorSave(props: Record<string, unknown>, drive: (host: HTMLElement) => void): Item | undefined {
  let saved: Item | undefined;
  const r = renderDom(
    createElement(ItemEditorModal, { content: db(), onSave: (it: Item) => { saved = it; }, onClose: () => {}, ...props } as never),
  );
  drive(r.host);
  r.host.querySelector<HTMLButtonElement>('.ci-save')!.click();
  r.stop();
  return saved;
}

/** What the "Pack of" box shows when the editor opens on `item`. */
function editorShows(item: Item | undefined): string {
  const r = renderDom(
    createElement(ItemEditorModal, { mode: item ? 'edit' : 'create', item, content: db(), onSave: () => {}, onClose: () => {} } as never),
  );
  const v = packInput(r.host).value;
  r.stop();
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The control, and the round trip through it.
// ─────────────────────────────────────────────────────────────────────────────
describe('the homebrew item editor can make an item a pack', () => {
  // bug 2026-09-13: homebrew pack item
  it('a new custom item typed with a pack of 10 saves as packOf 10 and reopens showing 10', () => {
    const saved = editorSave({ mode: 'create' }, (host) => {
      typeInto(fieldInput(host, 'Name'), 'Test Bolts');
      typeInto(fieldInput(host, 'Bulk'), '0.1');
      typeInto(packInput(host), '10');
    });
    expect(saved!.packOf).toBe(10);
    expect(saved!.bulk).toBe(0.1);
    // …and the round trip: reopening the saved record shows the same count, not a blank box.
    expect(editorShows(saved)).toBe('10');
  });

  // bug 2026-09-13: homebrew pack item
  it('editing an official pack item shows the printed count — sling bullets are 10 to the sp', () => {
    const bullets = content().items['sling-bullets'];
    expect(bullets.packOf).toBe(10);
    expect(editorShows(bullets)).toBe('10');
    // Saving it untouched must hand the count straight back, or a renamed quiver costs ten times over.
    const saved = editorSave({ mode: 'edit', item: bullets }, () => {});
    expect(saved!.packOf).toBe(10);
    expect(itemPriceCp(saved, 10)).toBe(itemPriceCp(bullets, 10));
  });

  // bug 2026-09-13: homebrew pack item
  it('a fresh item has an empty box, and a single item never ships a packOf', () => {
    expect(editorShows(undefined)).toBe('');
    const saved = editorSave({ mode: 'create' }, (host) => {
      typeInto(fieldInput(host, 'Name'), 'Test Rock');
    });
    expect(saved!.packOf).toBeUndefined();
    expect('packOf' in saved!).toBe(false);
  });

  // bug 2026-09-13: homebrew pack item
  it('0, 1 and a fraction are not packs — they are ignored rather than stored', () => {
    const withPack = (typed: string) =>
      editorSave({ mode: 'create' }, (host) => {
        typeInto(fieldInput(host, 'Name'), 'Test Thing');
        typeInto(packInput(host), typed);
      })!.packOf;
    for (const bad of ['0', '1', '2.5', '-4', '0.5', '']) expect(withPack(bad)).toBeUndefined();
    // The boundary in the other direction: two pieces IS a pack.
    expect(withPack('2')).toBe(2);
  });

  // bug 2026-09-13: homebrew pack item
  it('clearing the box on an official pack item really drops the pack', () => {
    const bullets = content().items['sling-bullets'];
    const saved = editorSave({ mode: 'edit', item: bullets }, (host) => typeInto(packInput(host), ''));
    expect(saved!.packOf).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tracking what is left: the inventory quantity, in pieces.
// ─────────────────────────────────────────────────────────────────────────────
describe('a custom pack item is stocked and counted down by the piece', () => {
  // bug 2026-09-13: homebrew pack item
  it('adding it stocks a FULL pack, not one loose bolt', () => {
    expect(packQuantity(BOLTS)).toBe(10);
    expect(packQuantity(LOOSE)).toBe(1);
    const after = addInventoryItem({ inventory: [] } as unknown as PlayState, BOLTS.id, { quantity: packQuantity(BOLTS) });
    expect(after.inventory?.[0]).toMatchObject({ itemId: BOLTS.id, quantity: 10 });
  });

  // bug 2026-09-13: homebrew pack item
  it('the row shows the pieces left and its − step spends exactly one', () => {
    let play = { inventory: [row(BOLTS.id, 7)] } as unknown as PlayState;
    const r = renderDom(
      createElement(InventoryTab, {
        character: sheet(play.inventory!), content: db(),
        onPlay: (fn: (p: PlayState) => PlayState) => { play = fn(play); },
      } as never),
    );
    const step = r.host.querySelector<HTMLElement>('.inv-qtystep');
    expect(step?.textContent).toContain('7'); // seven left reads as plain "7", no new widget
    // …and the printed price line still says what a pack holds, so "7" is unambiguous.
    expect(r.host.textContent).toContain('1 sp per 10');
    r.click(step!.querySelector('button[aria-label="Decrease quantity"]'));
    r.stop();
    expect(play.inventory?.[0].quantity).toBe(6);
  });

  // bug 2026-09-13: homebrew pack item
  it('its Bulk and price follow the PACK, not the piece', () => {
    const d = db();
    const bulk = (itemId: string, qty: number) => deriveBulk(sheet([row(itemId, qty)]), d).total;
    expect(bulk(BOLTS.id, 10)).toBe(0.1); // ten bolts are L for the ten
    expect(bulk(BOLTS.id, 5)).toBe(0.1); // half a pack is 0.05, which the sheet's tenth-rounding prints as L
    expect(bulk(LOOSE.id, 5)).toBe(0.5); // …and without the count those same five are half a Bulk
    expect(itemPriceCp(BOLTS, 10)).toBe(10); // the printed 1 sp
    expect(itemPriceCp(BOLTS, 5)).toBe(5); // five pieces, 5 cp
    expect(itemPriceCp(LOOSE, 5)).toBe(50);
    expect(formatItemPrice(BOLTS)).toBe('1 sp per 10');
  });
});
