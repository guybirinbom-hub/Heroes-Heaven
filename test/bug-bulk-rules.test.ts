// @vitest-environment jsdom
// bug 2026-09-13: bulk rules
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { deriveBulk, containerLoads } from '../src/rules/derive';
import { deriveAnimalCompanion } from '../src/rules/companions';
import { buyItem, packQuantity, type PlayState } from '../src/rules/play';
import { formatItemPrice, itemPriceCp } from '../src/rules/wealth';
import { normalizeCharacter } from '../src/rules/normalize';
import { InventoryTab } from '../src/sheet/InventoryTab';
import { ItemEditorModal } from '../src/sheet/ItemEditorModal';
import type { Character, Coins, ContentDatabase, InventoryItem, Item } from '../src/rules/types';

/**
 * Four Bulk rules the engine did not have, all re-read off the live Player Core pages on 2026-09-13,
 * plus the readout that made a correct answer look wrong ("5.1 out of 5 is not encumbered, only 6 is
 * — is that by the rules?" — owner). It is by the rules; the sheet was just printing the exact figure
 * where the counted one belongs.
 *
 * The records here are hand-built because `packOf` only reaches public/core.json when the data lane
 * regenerates it; the engine must be right before the data arrives, not after.
 */
const ITEMS: Record<string, Item> = {
  // 1 sp buys TEN bolts and they weigh L for the ten — the Archives print "1 sp (price for 10)".
  'tb-bullets': { id: 'tb-bullets', itemType: 'consumable', name: 'Test Bullets', level: 0, rarity: 'common', traits: [], price: { sp: 1 }, packOf: 10, bulk: 0.1, consumableType: 'ammunition' },
  'tb-rock': { id: 'tb-rock', itemType: 'equipment', name: 'Test Rock', level: 0, rarity: 'common', traits: [], price: { gp: 1 }, bulk: 1 },
  'tb-torch': { id: 'tb-torch', itemType: 'equipment', name: 'Test Torch', level: 0, rarity: 'common', traits: [], price: { cp: 1 }, bulk: 0.1 },
  'tb-plate': { id: 'tb-plate', itemType: 'armor', name: 'Test Plate', level: 0, rarity: 'common', traits: [], price: { gp: 30 }, bulk: 4, category: 'heavy', group: 'plate', acBonus: 6, dexCap: 0, checkPenalty: -3, speedPenalty: -10, strength: 4 },
  'tb-padded': { id: 'tb-padded', itemType: 'armor', name: 'Test Padded', level: 0, rarity: 'common', traits: [], price: { sp: 2 }, bulk: 0.1, category: 'light', group: 'cloth', acBonus: 1, dexCap: 3, checkPenalty: 0, speedPenalty: 0, strength: 0 },
  // Armor of exactly 1 Bulk: the boundary between the two halves of the p. 271 clause.
  'tb-hide': { id: 'tb-hide', itemType: 'armor', name: 'Test Hide', level: 0, rarity: 'common', traits: [], price: { gp: 2 }, bulk: 1, category: 'medium', group: 'leather', acBonus: 3, dexCap: 2, checkPenalty: -2, speedPenalty: -5, strength: 3 },
  'tb-shield': { id: 'tb-shield', itemType: 'shield', name: 'Test Shield', level: 0, rarity: 'common', traits: [], price: { gp: 2 }, bulk: 1, acBonus: 2, hardness: 5, hp: 20, brokenThreshold: 10 },
  // The printed Backpack: no Bulk worn, L in your hands or in another pack, first 2 Bulk forgiven.
  'tb-pack': { id: 'tb-pack', itemType: 'container', name: 'Test Backpack', level: 0, rarity: 'common', traits: [], price: { sp: 1 }, bulk: 0, usage: 'wornbackpack', ignoredBulk: 2, capacity: { bulk: 4 } },
  // A worn-backpack item that prints a REAL Bulk (the six magical packs do): nothing to invent.
  'tb-haversack': { id: 'tb-haversack', itemType: 'container', name: 'Test Haversack', level: 5, rarity: 'common', traits: [], price: { gp: 50 }, bulk: 1, usage: 'wornbackpack', ignoredBulk: 50, capacity: { bulk: 50 } },
  'tb-pouch': { id: 'tb-pouch', itemType: 'container', name: 'Test Pouch', level: 0, rarity: 'common', traits: [], price: { cp: 5 }, bulk: 0.1, capacity: { bulk: 4 } },
} as unknown as Record<string, Item>;

const db = { items: ITEMS } as unknown as ContentDatabase;

const char = (inventory: InventoryItem[], currency: Coins = {}): Character =>
  ({ abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, inventory, currency }) as unknown as Character;

const bulkOf = (inventory: InventoryItem[], currency: Coins = {}) => deriveBulk(char(inventory, currency), db);
const row = (itemId: string, quantity = 1, extra: Partial<InventoryItem> = {}): InventoryItem => ({ instanceId: itemId + '-i', itemId, quantity, ...extra });

// ─────────────────────────────────────────────────────────────────────────────
// 1. Pack items: the printed price and Bulk cover a whole pack, quantity counts pieces.
// ─────────────────────────────────────────────────────────────────────────────
describe('pack items (ammunition) weigh and cost by the pack', () => {
  // bug 2026-09-13: bulk rules
  it('ten bullets are L, not ten times L — the owner’s own sheet carries exactly this row', () => {
    expect(bulkOf([row('tb-bullets', 10)]).total).toBe(0.1);
    // …and the full pack is what a single purchase adds, so this is the everyday case, not a corner.
    expect(packQuantity(ITEMS['tb-bullets'])).toBe(10);
  });

  // bug 2026-09-13: bulk rules
  it('two and a half packs are 0.25, which the tenth-rounding shows as 0.3', () => {
    expect(bulkOf([row('tb-bullets', 25)]).total).toBe(0.3);
    // Below a whole Bulk it counts as nothing at all, which is the point of carrying arrows.
    expect(bulkOf([row('tb-bullets', 25)]).encTotal).toBe(0);
  });

  // bug 2026-09-13: bulk rules
  it('an item with no packOf is untouched — ten torches still weigh a whole Bulk', () => {
    expect(bulkOf([row('tb-torch', 10)]).total).toBe(1);
    expect(packQuantity(ITEMS['tb-torch'])).toBe(1);
  });

  // bug 2026-09-13: bulk rules
  it('itemPriceCp is the one place the pack division happens, and it prices PIECES', () => {
    expect(itemPriceCp(ITEMS['tb-bullets'])).toBe(1); // one bullet = 1 cp
    expect(itemPriceCp(ITEMS['tb-bullets'], 10)).toBe(10); // the printed 1 sp
    expect(itemPriceCp(ITEMS['tb-bullets'], 25)).toBe(25);
    expect(itemPriceCp(ITEMS['tb-rock'], 3)).toBe(300); // no packOf: a plain multiply
    expect(itemPriceCp(undefined, 4)).toBe(0);
  });

  // bug 2026-09-13: bulk rules
  it('the printed price line says what the pack holds instead of silently meaning ten', () => {
    expect(formatItemPrice(ITEMS['tb-bullets'])).toBe('1 sp per 10');
    expect(formatItemPrice(ITEMS['tb-rock'])).toBe('1 gp');
    expect(formatItemPrice(undefined)).toBe('—');
  });

  // bug 2026-09-13: bulk rules
  it('buying a pack item deducts the printed price ONCE and hands over the whole pack', () => {
    const before = { currency: { gp: 1 }, inventory: [] } as unknown as PlayState;
    const after = buyItem(before, 'tb-bullets', ITEMS['tb-bullets'].price, { quantity: packQuantity(ITEMS['tb-bullets']) });
    expect(after.inventory?.[0]).toMatchObject({ itemId: 'tb-bullets', quantity: 10 });
    expect(after.currency).toEqual({ sp: 9 }); // 1 gp − 1 sp, not 1 gp − 10 sp (which would be empty)
  });

  // bug 2026-09-13: bulk rules. Owner's call (2026-09-17): a new character starts at 0 gold, so
  // build.ts no longer runs a gear budget through itemPriceCp — picking gear costs nothing out of
  // a starting purse (there isn't one). packOf division still matters for BULK, which is what this
  // now checks; the (removed) currency-budget half of this test lived in wealth.test.ts.
  it('the builder still weighs a pack item by the whole pack, not by the piece (build.ts, through the same helper)', () => {
    const real = content();
    expect(real.items['crossbow-bolts'].packOf).toBe(10);
    const cp = (ch: Character) => (ch.currency.gp ?? 0) * 100 + (ch.currency.sp ?? 0) * 10 + (ch.currency.cp ?? 0);
    const bare = build('fighter', 1, { inventory: [] });
    const armed = build('fighter', 1, { inventory: [{ instanceId: 'b1', itemId: 'crossbow-bolts', quantity: 20 }] });
    expect(cp(bare)).toBe(0);
    expect(cp(armed)).toBe(0); // no starting purse to charge against any more
    // …the same twenty bolts still weigh two packs' worth of Bulk, not twenty pieces' worth.
    expect(deriveBulk(armed, real).total - deriveBulk(bare, real).total).toBeCloseTo(0.2, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Armor you carry instead of wear (Player Core p. 271).
// ─────────────────────────────────────────────────────────────────────────────
describe('armor carried rather than worn is 1 Bulk heavier', () => {
  // bug 2026-09-13: bulk rules
  it('4-Bulk plate is 4 on your body and 5 in your pack', () => {
    expect(bulkOf([row('tb-plate', 1, { worn: true })]).total).toBe(4);
    expect(bulkOf([row('tb-plate', 1)]).total).toBe(5);
  });

  // bug 2026-09-13: bulk rules
  it('armor of LIGHT Bulk is 1 Bulk total carried, not 1.1', () => {
    expect(bulkOf([row('tb-padded', 1, { worn: true })]).total).toBe(0.1);
    expect(bulkOf([row('tb-padded', 1)]).total).toBe(1);
  });

  // bug 2026-09-13: bulk rules
  it('a SHIELD is not armor here — its listed Bulk already is the carried figure', () => {
    expect(bulkOf([row('tb-shield', 1)]).total).toBe(1);
    expect(bulkOf([row('tb-shield', 1, { worn: true })]).total).toBe(1);
  });

  // bug 2026-09-13: bulk rules
  it('the surcharge is per suit, and it applies inside a container as well as loose', () => {
    expect(bulkOf([row('tb-plate', 2)]).total).toBe(10);
    // A suit stuffed in the pack: 5 for the carried plate, less the pack's forgiven 2.
    const stowed = bulkOf([row('tb-pack', 1, { worn: true }), { instanceId: 'p2', itemId: 'tb-plate', quantity: 1, containerInstanceId: 'tb-pack-i' }]);
    expect(stowed.total).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. A backpack off your back (Player Core p. 287).
// ─────────────────────────────────────────────────────────────────────────────
describe('a backpack weighs L unless it is on your back', () => {
  // bug 2026-09-13: bulk rules
  it('worn it is nothing; carried it is light', () => {
    expect(bulkOf([row('tb-pack', 1, { worn: true })]).total).toBe(0);
    expect(bulkOf([row('tb-pack', 1)]).total).toBe(0.1);
  });

  // bug 2026-09-13: bulk rules
  it('a backpack stowed inside another container is light even with its worn flag still set', () => {
    const inv = [
      row('tb-haversack', 1, { worn: true }),
      { instanceId: 'inner', itemId: 'tb-pack', quantity: 1, worn: true, containerInstanceId: 'tb-haversack-i' },
    ];
    // Haversack 1 + inner pack 0.1, and the haversack forgives 50 so nothing else survives.
    expect(bulkOf(inv).total).toBe(1);
    expect(containerLoads(char(inv), db)['tb-haversack-i'].used).toBe(0.1);
  });

  // bug 2026-09-13: bulk rules
  it('the 2-Bulk forgiveness is untouched, and a pack printing a real Bulk keeps it', () => {
    const loaded = [row('tb-pack', 1, { worn: true }), { instanceId: 'r2', itemId: 'tb-rock', quantity: 3, containerInstanceId: 'tb-pack-i' }];
    expect(bulkOf(loaded).total).toBe(1); // 0 own + max(0, 3 − 2)
    expect(bulkOf([row('tb-haversack', 1)]).total).toBe(1); // printed 1 Bulk, carried, unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Light items and coins round down SEPARATELY (Bulk Values / Bulk of Coins, p. 269).
// ─────────────────────────────────────────────────────────────────────────────
describe('the counted total floors gear and coins apart', () => {
  // bug 2026-09-13: bulk rules
  it('7 light items and 300 coins are 1.0 exact and ZERO counted', () => {
    const b = bulkOf([row('tb-torch', 7)], { gp: 300 });
    expect(b.total).toBe(1);
    expect(b.encTotal).toBe(0); // "100 coins don't count as a light item"
  });

  // bug 2026-09-13: bulk rules
  it('neither remainder is allowed to top up the other', () => {
    const b = bulkOf([row('tb-rock', 1), row('tb-torch', 7)], { sp: 300 });
    expect(b.total).toBe(2);
    expect(b.encTotal).toBe(1);
  });

  // bug 2026-09-13: bulk rules
  it('a whole Bulk of either side still counts (ten light items, a thousand coins)', () => {
    expect(bulkOf([row('tb-torch', 10)]).encTotal).toBe(1); // 0.1 × 10 sums to 0.999… in binary
    expect(bulkOf([], { gp: 1000 }).encTotal).toBe(1);
    expect(bulkOf([], { gp: 1999 }).encTotal).toBe(1);
  });

  // bug 2026-09-13: bulk rules
  it('an empty character is 0, not a negative or a NaN', () => {
    expect(bulkOf([]).encTotal).toBe(0);
    expect(bulkOf([]).total).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The readout: the COUNTED figure leads, the exact one follows.
// ─────────────────────────────────────────────────────────────────────────────
describe('the Inventory Bulk badge', () => {
  const real = content();
  const merged = { ...real, items: { ...real.items, ...ITEMS } } as unknown as ContentDatabase;
  // Str 10 → encumbered at 5, max 10. Five rocks and a torch: 5.1 exact, 5 counted — the owner's case.
  const sheet = (): Character =>
    normalizeCharacter({
      id: 'b',
      name: 'B',
      level: 1,
      classId: 'fighter',
      keyAbility: 'str',
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      feats: [],
      currency: {},
      inventory: [row('tb-rock', 5), row('tb-torch', 1)],
    } as unknown as Character);

  // bug 2026-09-13: bulk rules
  it('prints "5 / 5 · 5.1 exact · max 10" and does not flag encumbered', () => {
    const r = renderDom(createElement(InventoryTab, { character: sheet(), content: merged } as never));
    const badge = r.host.querySelector<HTMLElement>('.bulk-badge');
    const text = (badge?.textContent ?? '').replace(/\s+/g, ' ');
    const cls = badge?.className ?? '';
    const title = badge?.getAttribute('title') ?? '';
    r.stop();
    expect(text).toContain('5 / 5');
    expect(text).toContain('5.1 exact');
    expect(text).toContain('max 10');
    expect(text).not.toContain('5.1 / 5');
    expect(cls).not.toContain('encumbered');
    expect(cls).not.toContain('over');
    // The tooltip still explains the consequence, and now says why 5.1 counts as 5.
    expect(title).toContain('round down');
    expect(title).toContain('encumbered');
  });

  // bug 2026-09-13: bulk rules — the same badge on a COMPANION's bag reads that creature's limit.
  it('a companion scope still swaps both caps for the creature’s own', () => {
    const r = renderDom(createElement(InventoryTab, { character: sheet(), content: merged, scope: { ownerName: 'Fang', bulkMax: 3 } } as never));
    const text = (r.host.querySelector<HTMLElement>('.bulk-badge')?.textContent ?? '').replace(/\s+/g, ' ');
    const cls = r.host.querySelector<HTMLElement>('.bulk-badge')?.className ?? '';
    r.stop();
    expect(text).toContain('5 / 3');
    expect(text).toContain('max 3');
    expect(cls).toContain('over'); // 5 counted against a 3-Bulk creature limit
  });

  // bug 2026-09-13: bulk rules
  it('drops the "exact" clause when there is no fraction to explain', () => {
    const whole = normalizeCharacter({
      id: 'w', name: 'W', level: 1, classId: 'fighter', keyAbility: 'str',
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      feats: [], currency: {}, inventory: [row('tb-rock', 3)],
    } as unknown as Character);
    const r = renderDom(createElement(InventoryTab, { character: whole, content: merged } as never));
    const text = (r.host.querySelector<HTMLElement>('.bulk-badge')?.textContent ?? '').replace(/\s+/g, ' ');
    r.stop();
    expect(text).toContain('3 / 5');
    expect(text).not.toContain('exact');
  });

  // bug 2026-09-13: bulk rules — the other side of the owner's question: 6.0 IS encumbered.
  it('a whole Bulk over the limit is flagged encumbered', () => {
    const heavy = normalizeCharacter({
      id: 'h', name: 'H', level: 1, classId: 'fighter', keyAbility: 'str',
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      feats: [], currency: {}, inventory: [row('tb-rock', 6)],
    } as unknown as Character);
    const r = renderDom(createElement(InventoryTab, { character: heavy, content: merged } as never));
    const badge = r.host.querySelector<HTMLElement>('.bulk-badge');
    const text = (badge?.textContent ?? '').replace(/\s+/g, ' ');
    const cls = badge?.className ?? '';
    r.stop();
    expect(text).toContain('6 / 5');
    expect(text).not.toContain('exact');
    expect(cls).toContain('encumbered');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial pass, 2026-09-13: the printed rounding examples read back off the
// page one at a time, plus the sites where a pack count or a carried suit has to
// reach a SECOND reader (the companion block, the companion shop).
// ─────────────────────────────────────────────────────────────────────────────
const torches = (n: number): InventoryItem[] => Array.from({ length: n }, (_, i) => ({ instanceId: `t${i}`, itemId: 'tb-torch', quantity: 1 }));

describe('the printed rounding examples, one leg each', () => {
  // bug 2026-09-13: bulk rules
  it('"9 light items count as 0 Bulk, and 11 light items count as 1"', () => {
    expect(bulkOf(torches(9)).encTotal).toBe(0);
    expect(bulkOf(torches(11)).encTotal).toBe(1);
  });

  // bug 2026-09-13: bulk rules
  it('5 Bulk and 9 light items is 5 counted, and not encumbered at Str 10', () => {
    const b = bulkOf([row('tb-rock', 5), ...torches(9)]);
    expect(b.encTotal).toBe(5);
    expect(b.encumberedAt).toBe(5);
    expect(b.encTotal > b.encumberedAt).toBe(false);
  });

  // bug 2026-09-13: bulk rules
  it('…and the tenth light item is the one that tips it over', () => {
    const b = bulkOf([row('tb-rock', 5), ...torches(10)]);
    expect(b.encTotal).toBe(6);
    expect(b.encTotal > b.encumberedAt).toBe(true);
  });

  // bug 2026-09-13: bulk rules
  it('coins: 999 is nothing, 1,999 is one', () => {
    expect(bulkOf([], { gp: 999 }).encTotal).toBe(0);
    expect(bulkOf([], { gp: 1999 }).encTotal).toBe(1);
  });

  // bug 2026-09-13: bulk rules
  it('4 Bulk + 9 light + 999 coins is 4 — neither remainder tops up the other', () => {
    expect(bulkOf([row('tb-rock', 4), ...torches(9)], { sp: 999 }).encTotal).toBe(4);
  });

  // bug 2026-09-13: bulk rules
  it('a part-pack of ammunition is counted along with the rest of the light gear', () => {
    expect(bulkOf([row('tb-bullets', 25)]).encTotal).toBe(0);
    // 2.5 L of bullets plus 8 L of torches is 10.5 L — one whole Bulk, remainder dropped.
    expect(bulkOf([row('tb-bullets', 25), ...torches(8)]).encTotal).toBe(1);
  });

  // bug 2026-09-13: bulk rules
  it('a part-pack must never round UP across a whole Bulk', () => {
    // 5 Bulk + 96 bullets = 5.96: nine and a bit light items on top of five Bulk, so FIVE counted.
    // Rounding the gear side to a tenth first made it 6.0 and flagged a Str-10 character encumbered.
    const b = bulkOf([row('tb-rock', 5), row('tb-bullets', 96)]);
    expect(b.encTotal).toBe(5);
    expect(b.encTotal > b.encumberedAt).toBe(false);
  });

  // bug 2026-09-13: bulk rules
  it('the exact figure the readout prints is never below the counted one', () => {
    const cases: [InventoryItem[], Coins][] = [
      [torches(9), {}],
      [[row('tb-rock', 5), row('tb-bullets', 96)], {}],
      [[row('tb-rock', 4), ...torches(9)], { sp: 999 }],
      [[], { gp: 1999 }],
      [[row('tb-plate', 1)], { cp: 1 }],
    ];
    for (const [inv, cur] of cases) {
      const b = bulkOf(inv, cur);
      expect(b.total).toBeGreaterThanOrEqual(b.encTotal);
    }
  });
});

describe('more armor and backpack probes', () => {
  // bug 2026-09-13: bulk rules
  it('armor of exactly 1 Bulk is 2 carried — the boundary of the printed clause', () => {
    expect(bulkOf([row('tb-hide', 1, { worn: true })]).total).toBe(1);
    expect(bulkOf([row('tb-hide', 1)]).total).toBe(2);
  });

  // bug 2026-09-13: bulk rules
  it('a suit in a plain pouch is carried armor, and the pouch has no forgiveness to hide it', () => {
    const inv = [row('tb-pouch', 1, { worn: true }), { instanceId: 'a1', itemId: 'tb-padded', quantity: 1, containerInstanceId: 'tb-pouch-i' }];
    expect(bulkOf(inv).total).toBe(1.1); // pouch L + light armor carried at a whole Bulk
  });

  // bug 2026-09-13: bulk rules
  it('a shield is listed at its carried value whether held or slung', () => {
    expect(bulkOf([row('tb-shield', 1, { equipped: true })]).total).toBe(1);
    const stowed = [row('tb-pouch', 1, { worn: true }), { instanceId: 's1', itemId: 'tb-shield', quantity: 1, containerInstanceId: 'tb-pouch-i' }];
    expect(bulkOf(stowed).total).toBe(1.1);
  });

  // bug 2026-09-13: bulk rules
  it('a backpack inside a pouch is light, and the pouch carries that light Bulk', () => {
    const inv = [row('tb-pouch', 1, { worn: true }), { instanceId: 'bp', itemId: 'tb-pack', quantity: 1, containerInstanceId: 'tb-pouch-i' }];
    expect(bulkOf(inv).total).toBe(0.2);
    expect(containerLoads(char(inv), db)['tb-pouch-i'].used).toBe(0.1);
  });

  // bug 2026-09-13: bulk rules
  it('over-stuffing a backpack does not change what its capacity block reports', () => {
    const inv = [row('tb-pack', 1, { worn: true }), { instanceId: 'r9', itemId: 'tb-rock', quantity: 9, containerInstanceId: 'tb-pack-i' }];
    const load = containerLoads(char(inv), db)['tb-pack-i'];
    expect(load.capacity).toBe(4);
    expect(load.used).toBe(9);
  });

  // bug 2026-09-13: bulk rules
  it('the two SHIPPED worn-backpacks that print no Bulk both follow the p. 287 clause', () => {
    const real = content();
    for (const id of ['backpack', 'voyagers-pack']) {
      expect(real.items[id].bulk).toBe(0);
      expect(real.items[id].usage).toBe('wornbackpack');
      const ch = { abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, inventory: [row(id, 1)], currency: {} } as unknown as Character;
      expect(deriveBulk(ch, real).total).toBe(0.1);
    }
    // …and the ones that DO print a Bulk keep it, worn or not.
    expect(real.items['alchemists-haversack'].bulk).toBe(1);
    const worn = { abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, inventory: [row('alchemists-haversack', 1, { worn: true })], currency: {} } as unknown as Character;
    expect(deriveBulk(worn, real).total).toBe(1);
  });
});

describe('the second readers of a pack count', () => {
  // bug 2026-09-13: bulk rules
  it("the companion stat block's Bulk line divides by packOf, like the owner's sheet does", () => {
    const real = content();
    expect(real.items.arrows.packOf).toBe(10);
    const cfg = { id: 'c1', kind: 'animal', name: 'Fang', typeId: 'wolf', maturity: 'young', inventory: [{ instanceId: 'g0', itemId: 'arrows', quantity: 20 }] };
    const block = deriveAnimalCompanion(cfg as never, real.animalCompanions.wolf, 1, real);
    expect(block.bulk.carried).toBe(0.2);
  });

  // bug 2026-09-13: bulk rules
  it('…and a suit of barding the companion is NOT wearing costs it the carried Bulk too', () => {
    const real = content();
    expect(real.items['light-barding'].bulk).toBe(2);
    const carried = (worn: boolean) =>
      deriveAnimalCompanion(
        { id: 'c2', kind: 'animal', name: 'Fang', typeId: 'wolf', maturity: 'young', inventory: [{ instanceId: 'g0', itemId: 'light-barding', quantity: 1, worn }] } as never,
        real.animalCompanions.wolf,
        1,
        real,
      ).bulk.carried;
    expect(carried(true)).toBe(2);
    expect(carried(false)).toBe(3);
  });

  // bug 2026-09-13: bulk rules
  it('the item editor hands the pack count back — a renamed quiver is not ten times the price', () => {
    const real = content();
    let saved: Item | undefined;
    const r = renderDom(
      createElement(ItemEditorModal, { mode: 'edit', item: real.items.arrows, content: real, onSave: (it: Item) => { saved = it; }, onClose: () => {} } as never),
    );
    r.host.querySelector<HTMLButtonElement>('.ci-save')!.click();
    r.stop();
    expect(saved!.packOf).toBe(10);
    expect(itemPriceCp(saved, 10)).toBe(itemPriceCp(real.items.arrows, 10));
  });

  // bug 2026-09-13: bulk rules
  it('the row’s own Bulk column agrees with the total: carried plate reads 5, not its printed 4', () => {
    const real = content();
    const merged2 = { ...real, items: { ...real.items, ...ITEMS } } as unknown as ContentDatabase;
    const sheetOf = (inv: InventoryItem[]) =>
      normalizeCharacter({
        id: 'p', name: 'P', level: 1, classId: 'fighter', keyAbility: 'str',
        abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        feats: [], currency: {}, inventory: inv,
      } as unknown as Character);
    const readRow = (inv: InventoryItem[]) => {
      const r = renderDom(createElement(InventoryTab, { character: sheetOf(inv), content: merged2 } as never));
      const v = r.host.querySelector<HTMLElement>('.inv-bval')?.textContent ?? '';
      r.stop();
      return v;
    };
    expect(readRow([row('tb-plate', 1, { worn: true })])).toBe('4');
    expect(readRow([row('tb-plate', 1)])).toBe('5');
    expect(readRow([row('tb-pack', 1, { worn: true })])).toBe('—');
    expect(readRow([row('tb-pack', 1)])).toBe('L');
  });

  // bug 2026-09-13: bulk rules
  it('every UI add/buy call passes the pack quantity — the companion shop was buying one arrow', () => {
    const CALLS = /\b(addInventoryItem|buyItem|addCompanionItem|buyCompanionItem)\s*\(/;
    for (const f of ['src/sheet/InventoryTab.tsx', 'src/sheet/CompanionsTab.tsx']) {
      const src = readFileSync(f, 'utf8');
      for (const line of src.split(/\r?\n/)) {
        if (!CALLS.test(line) || /^\s*(import|\*|\/\/)/.test(line)) continue;
        expect(line.includes('packQuantity') || line.includes('init')).toBe(true);
      }
    }
  });
});
