// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { renderDom } from './_render';
import { ItemDetail } from '../src/sheet/ItemDetail';
import { deriveShield } from '../src/rules/derive';
import { refinementCost } from '../src/rules/monsterParts';
import type { Character, InventoryItem, ItemMonsterPart } from '../src/rules/types';

/**
 * bug 2026-09-15: shield runes — the ITEM POPUP half.
 *
 * `deriveShield` was fixed to raise a shield's statistics additively-with-a-cap (GM Core p. 232), and
 * the Vitals rail prints the raised numbers. The popup did not: it printed the item RECORD's row —
 * "Hardness 5 · HP 20 (BT 10)" for a steel shield — with a lesser reinforcing rune listed two lines
 * above it, so the two surfaces disagreed and neither said which was true.
 *
 * The owner's ruling for the popup (given over Bulk) is that it shows the item's PRINTED statistics.
 * So the printed row stays exactly as it was and ONE line is added beneath it, and only when the
 * row's effective values actually differ. Its numbers come from `deriveShield` itself — the same
 * function the rail calls — so the popup cannot drift from the rail, and the tier table stays in the
 * one place that owns it.
 *
 * MUTATION PROOF — feed the added line the item record's own numbers (`item.hardness`, `item.hp`,
 * `item.brokenThreshold`) instead of deriveShield's, i.e. print the defect on a second line:
 *   AssertionError: expected 'With lesser reinforcing: Hardness 5 ·…' to be
 *     'With lesser reinforcing: Hardness 8 ·…'
 * (3 of the 4 legs below fail; the no-rune leg still passes, which is the point of keeping it.)
 */
const db = content();
const noop = () => undefined;

const row = (extra: Partial<InventoryItem> = {}, itemId = 'steel-shield'): InventoryItem =>
  ({ instanceId: 'sh1', itemId, quantity: 1, equipped: true, ...extra }) as InventoryItem;

/** The popup as the player sees it: the printed stat rows, and the effective line if there is one. */
function popup(inv: InventoryItem, character: Character) {
  const { host, stop } = renderDom(
    <ItemDetail
      inv={inv}
      item={db.items[inv.itemId]}
      content={db}
      onClose={noop}
      character={character}
      charLevel={character.level}
    />,
  );
  const printed = Object.fromEntries(
    [...host.querySelectorAll('.sd-stat')].map((el) => [
      el.querySelector('.sd-stat-k')?.textContent ?? '',
      el.querySelector('.sd-stat-v')?.textContent ?? '',
    ]),
  ) as Record<string, string>;
  const effective = host.querySelector('.sd-shield-eff')?.textContent ?? null;
  stop();
  return { printed, effective };
}

/** The rail's own number for a character holding exactly this row. */
const railStats = (inv: InventoryItem, character: Character) => {
  const s = deriveShield({ ...character, inventory: [inv] }, db)!;
  return [s.hardness, s.hp, s.brokenThreshold];
};

describe('a runed shield’s popup shows the printed stats AND what the rune makes them', () => {
  it('steel shield + lesser reinforcing: both lines, with the rail’s numbers on the second', () => {
    // bug 2026-09-15: shield runes
    const ch = build('fighter', 5);
    const inv = row({ runes: { reinforcing: 2 } as InventoryItem['runes'] });
    const { printed, effective } = popup(inv, ch);
    // The printed row is untouched — the owner's ruling.
    expect(printed.Hardness).toBe('5');
    expect(printed.HP).toBe('20 (BT 10)');
    // …and beneath it, the shield as it actually is: 5+3=8, 20+52=72, 10+26=36 (no ceiling binds).
    expect(effective).toBe('With lesser reinforcing: Hardness 8 · HP 72 (BT 36)');
    // The same numbers the rail prints, from the same function — they cannot drift apart.
    expect(railStats(inv, ch)).toEqual([8, 72, 36]);
  });

  it('no rune: the printed line only — nothing is added when nothing changed', () => {
    // bug 2026-09-15: shield runes
    const ch = build('fighter', 5);
    const { printed, effective } = popup(row(), ch);
    expect(printed.Hardness).toBe('5');
    expect(printed.HP).toBe('20 (BT 10)');
    expect(effective).toBeNull();
  });

  it('a Monster-Parts refined shield gets the same treatment (Table 4C floors)', () => {
    // bug 2026-09-15: shield runes
    const ch = build('fighter', 13, { variantRules: { monsterParts: true } });
    const mp: ItemMonsterPart = { kind: 'shield', refineValue: refinementCost(13, 'shield'), imbuements: [] };
    const inv = row({ monsterPart: mp });
    const { printed, effective } = popup(inv, ch);
    expect(printed.Hardness).toBe('5');
    // Table 4C at item level 13 is 12/72/36; no rune to name, so the line says how it is carried.
    expect(effective).toBe('As you carry it: Hardness 12 · HP 72 (BT 36)');
    expect(railStats(inv, ch)).toEqual([12, 72, 36]);
  });

  it('a wooden shield + minor reinforcing — the case a "set it to the ceiling" reading got wrong', () => {
    // bug 2026-09-15: shield runes
    // 3+3=6, 12+44=56, 6+22=28. The old rule set it to the ceiling (8/64/32), so this line is also
    // what proves the popup reads the fixed derive rather than a second copy of the table.
    const ch = build('fighter', 5);
    const inv = row({ runes: { reinforcing: 1 } as InventoryItem['runes'] }, 'wooden-shield');
    const { printed, effective } = popup(inv, ch);
    expect(printed.Hardness).toBe('3');
    expect(effective).toBe('With minor reinforcing: Hardness 6 · HP 56 (BT 28)');
  });
});
