// @vitest-environment jsdom
/*
 * The versatile vial's item popup names the CHARACTER'S vial.
 *
 * bug 2026-10-23 (sheet fixes): at 12th level an alchemist's Strike reads 3d6, but the inventory popup
 * still said "Damage 1d6 acid" — `typeStats` has no character, and it must not: its rows are the record's
 * printed statistics and the card guards read them as the printed set (cardScope.ts `itemStatRows`). So
 * the printed row stays, and one extra line below it names the character's own vial, from the same
 * `deriveStrike` sentence the Strike's damage breakdown prints.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { ItemDetail, itemStatRows } from '../src/sheet/ItemDetail';
import type { Character, InventoryItem } from '../src/rules/types';

const db = content();
const crafting = (level: number, at: number[]) => Object.fromEntries(at.filter((l) => l <= level).map((l) => [l, 'crafting']));
const vial: InventoryItem = { instanceId: 'v1', itemId: 'versatile-vial', quantity: 1 };
const popup = (character: Character | undefined) => {
  const ch = character ? { ...character, inventory: [vial] } : undefined;
  const r = renderDom(
    createElement(ItemDetail, { inv: vial, item: db.items['versatile-vial'], content: db, onClose: () => undefined, inventory: [vial], ...(ch ? { character: ch } : {}) }),
  );
  const own = r.host.querySelector('.sd-vial-own')?.textContent ?? null;
  const stats = r.host.querySelector('.sd-stats')?.textContent ?? '';
  r.stop();
  return { own, stats };
};

describe('versatile vial popup — the character\'s own vial', () => {
  it('a 12th-level alchemist with master Crafting sees the greater vial: 3d6, +2 item bonus, 3 splash', () => {
    const p = popup(build('alchemist', 12, { skillIncreases: crafting(12, [3, 7]) }));
    expect(p.own).toContain('greater versatile vial');
    expect(p.own).toContain('3d6 acid');
    expect(p.own).toContain('+2 item bonus');
    expect(p.own).toContain('3 acid splash');
    // The printed row stays the record's lesser vial.
    expect(p.stats).toContain('1d6 acid');
  });

  it('a Dual Class Rogue/Alchemist 12 sees it too (the second class makes vials)', () => {
    const c = build('rogue', 12, {
      variantRules: { dualClass: true },
      classId2: 'alchemist',
      subclassId2: (db.classes.alchemist.subclass?.options[0]?.id as string) ?? null,
      skillIncreases: crafting(12, [3, 7]),
    });
    expect(popup(c).own).toContain('3d6 acid');
  });

  it('controls: no line at 1st level (still the printed lesser vial), for a non-maker, or with no character', () => {
    expect(popup(build('alchemist', 1)).own).toBeNull();
    expect(popup(build('fighter', 12)).own).toBeNull();
    expect(popup(undefined).own).toBeNull();
  });

  it('the printed stat rows (the card guard\'s set) are unchanged — no character goes into them', () => {
    expect(itemStatRows(db.items['versatile-vial'], db).map((r) => r.k)).not.toContain('Your vial');
    expect(itemStatRows(db.items['versatile-vial'], db).find((r) => r.k === 'Damage')?.v).toBe('1d6 acid');
  });
});
