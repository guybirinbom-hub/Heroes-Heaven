// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { ItemDetail } from '../src/sheet/ItemDetail';
import type { InventoryItem } from '../src/rules/types';

/**
 * bug 2026-10-02: the item popup THREW for every weapon or armor record that carries no `category`.
 *
 * MEASURED CAUSE: `typeStats` (src/sheet/ItemDetail.tsx) built the Category row as `cap(item.category)`
 * in both the weapon and the armor branch, and `cap` reads `s.charAt(0)` — on `undefined` that is a
 * TypeError, so the whole popup unmounted instead of opening. Measured on 2026-10-02 against the shipped
 * data (public/core.json, merged with the seed by test/_content.ts): 34 such records, 18 weapons and
 * 16 armors — the precious-material and generic family entries, e.g. aon-abysium-weapon,
 * aon-adamantine-weapon, aon-cold-iron-weapon, aon-keep-stone-weapon, aon-sovereign-steel-weapon,
 * aon-windlass-bolas, aon-abysium-armor, aon-orichalcum-armor, aon-unarmored. (167 shields carry no
 * category either, but the shield branch never prints one, so they always opened.)
 *
 * FIX: the Category row is `item.category ? cap(item.category) : undefined`, so `Stat` drops the row.
 * No category is ever invented for these records: an absent category is UNKNOWN, not "none" — the
 * popup prints nothing rather than a guess.
 *
 * MUTATION PROOF: put `cap(item.category)` back in either branch (ItemDetail.tsx typeStats) and the
 * first test goes red — measured on 2026-10-02 with both guards removed: all 34 renders threw
 * "Cannot read properties of undefined (reading 'charAt')" while the control stayed green; the file
 * was then restored byte-exact.
 */
const c = content();
const noop = () => undefined;

/** Every weapon or armor record with no category, by record key, sorted so a failure names the same
 *  record first every run. */
const NO_CATEGORY = Object.entries(c.items)
  .filter(([, it]) => (it.itemType === 'weapon' || it.itemType === 'armor') && !(it as { category?: string }).category)
  .map(([id]) => id)
  .sort();

/** The popup a character who HOLDS the item opens, read back as text: the header name, the stat rows as
 *  [label, value] pairs, and everything the popup prints. `error` is whatever the render threw. */
function openPopup(id: string): { error: unknown; name: string; rows: [string, string][]; text: string } {
  const item = c.items[id];
  const inv = { instanceId: `nocat-${id}`, itemId: id, quantity: 1 } as InventoryItem;
  let r: ReturnType<typeof renderDom> | undefined;
  let error: unknown;
  try {
    r = renderDom(<ItemDetail inv={inv} item={item} content={c} onClose={noop} />);
  } catch (e) {
    error = e;
  }
  if (!r) return { error, name: '', rows: [], text: '' };
  const out = {
    error,
    name: r.host.querySelector('.sd-head-name')?.textContent ?? '',
    rows: [...r.host.querySelectorAll('.sd-stats .sd-stat')].map(
      (el) => [el.querySelector('.sd-stat-k')?.textContent ?? '', el.querySelector('.sd-stat-v')?.textContent ?? ''] as [string, string],
    ),
    text: r.host.textContent ?? '',
  };
  r.stop();
  return out;
}

describe('bug 2026-10-02: the item popup opens for a weapon or armor with no category', () => {
  it('every category-less weapon and armor opens, names itself, and prints no Category row', () => {
    // The measured population: if the data changes, this count is the line that says so.
    expect(NO_CATEGORY.length).toBe(34);
    expect(NO_CATEGORY.filter((id) => c.items[id].itemType === 'weapon').length, 'weapons').toBe(18);
    expect(NO_CATEGORY.filter((id) => c.items[id].itemType === 'armor').length, 'armors').toBe(16);

    const failures: string[] = [];
    for (const id of NO_CATEGORY) {
      const p = openPopup(id);
      if (p.error) {
        failures.push(`${id}: threw ${String((p.error as Error)?.message ?? p.error)}`);
        continue;
      }
      if (p.name !== c.items[id].name) failures.push(`${id}: header reads "${p.name}", not "${c.items[id].name}"`);
      if (p.rows.length === 0) failures.push(`${id}: no stat block rendered`);
      if (p.rows.some(([k]) => k === 'Category')) failures.push(`${id}: prints a Category row`);
      if (p.text.includes('undefined')) failures.push(`${id}: prints the word "undefined"`);
    }
    expect(failures).toEqual([]);
  });

  it('control: a weapon and an armor that DO carry a category still print it, capitalised', () => {
    const cases = [
      { id: 'longsword', category: 'martial', shown: 'Martial' },
      { id: 'chain-shirt', category: 'light', shown: 'Light' },
      { id: 'full-plate', category: 'heavy', shown: 'Heavy' },
    ];
    for (const { id, category, shown } of cases) {
      // The fixture is what it says it is, so the row below is the data's category and not a default.
      expect((c.items[id] as { category?: string }).category, id).toBe(category);
      const p = openPopup(id);
      expect(p.error, id).toBeUndefined();
      expect(p.name, id).toBe(c.items[id].name);
      expect(p.rows.find(([k]) => k === 'Category'), id).toEqual(['Category', shown]);
      expect(p.text, id).not.toContain('undefined');
    }
  });
});
