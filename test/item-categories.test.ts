import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { ITEM_SPEC } from '../src/sheet/filterSpecs';
import { isInternalTrait } from '../src/sheet/FilterableSelect';
import type { Item } from '../src/rules/types';

const c = content();

/** The AoN "Category" chip on the Add-Items picker. */
const categoryField = ITEM_SPEC.fields.find((f) => f.id === 'category') as Extract<
  (typeof ITEM_SPEC.fields)[number],
  { kind: 'chips' }
>;

/** The 38 canonical AoN equipment categories the picker must OFFER (an empty one is fine). */
const CANONICAL_38 = [
  'Adjustments', 'Adventuring Gear', 'Alchemical Items', 'Animals and Gear', 'Apex Items',
  'Armor', 'Artifacts', 'Assistive Items', 'Banners', 'Blighted Boons', 'Censer', 'Consumables',
  'Contracts', 'Cursed Items', 'Customizations', 'Figurehead', 'Grafts', 'Grimoires', 'Held Items',
  'High-Tech', 'Intelligent Items', 'Materials', 'Other', 'Relics', 'Runes', 'Services', 'Shields',
  'Siege Weapons', 'Snares', 'Spellhearts', 'Staves', 'Structures', 'Tattoos', 'Trade Goods',
  'Vehicles', 'Wands', 'Weapons', 'Worn Items',
];

/** Count catalog items in each category by running the picker's own accessor. */
function categoryCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of Object.values(c.items) as Item[]) {
    for (const id of categoryField.accessor(item) as string[]) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

describe('Add-Items picker Category filter', () => {
  it('offers all 38 canonical AoN categories', () => {
    const labels = categoryField.options.map((o) => o.label);
    for (const cat of CANONICAL_38) expect(labels, cat).toContain(cat);
    // Exactly 38 — no extras, no omissions.
    expect(labels.slice().sort()).toEqual(CANONICAL_38.slice().sort());
  });

  it('routes items to the expected categories with sensible coverage', () => {
    const counts = categoryCounts();
    // Core buckets driven by itemType — must be well-populated.
    expect(counts.weapons).toBeGreaterThan(500);
    expect(counts.armor).toBeGreaterThan(100);
    expect(counts.shields).toBeGreaterThan(50);
    expect(counts.consumables).toBeGreaterThan(1000);
    // Trait-driven buckets that should have a clear, non-trivial set.
    expect(counts.alchemical).toBeGreaterThan(500);
    expect(counts.wands).toBeGreaterThan(100);
    expect(counts.staves).toBeGreaterThan(100);
    expect(counts.runes).toBeGreaterThan(50);
    expect(counts.snares).toBeGreaterThan(50);
    expect(counts.tattoos).toBeGreaterThan(50);
    expect(counts.spellhearts).toBeGreaterThan(50);
    expect(counts.apex).toBeGreaterThan(30);
    // Usage-driven buckets.
    expect(counts['worn-items']).toBeGreaterThan(300);
    expect(counts['held-items']).toBeGreaterThan(1000);
    // Adventuring Gear (mundane general equipment) exists as its own bucket.
    expect(counts['adventuring-gear']).toBeGreaterThan(500);
  });

  it('every catalog item lands in at least one category (nothing is unclassified)', () => {
    for (const item of Object.values(c.items) as Item[]) {
      expect((categoryField.accessor(item) as string[]).length, item.name).toBeGreaterThan(0);
    }
  });

  it('alchemical items all carry the alchemical trait (no false positives)', () => {
    for (const item of Object.values(c.items) as Item[]) {
      if ((categoryField.accessor(item) as string[]).includes('alchemical')) {
        expect(item.traits, item.name).toContain('alchemical');
      }
    }
  });

  // Regression: synthetic Add-Items rows (services / vehicles / siege weapons) used to be tagged by
  // PUSHING a fake '__service'/'__vehicle'/'__siege' string into the item's `traits`. Because traits
  // are rendered all over the app, that surfaced as a literal "__siege" pill in the Traits filter.
  // The marker now lives in the internal `catalogKind` field instead.
  describe('synthetic catalog rows are marked without polluting game data', () => {
    const mk = (catalogKind: Item['catalogKind'], traits: string[] = []): Item =>
      ({ id: 'x', name: 'X', level: 0, itemType: 'equipment', bulk: 0, rarity: 'common', traits, description: '', catalogKind }) as Item;

    it('routes by catalogKind, not by a fake trait', () => {
      expect(categoryField.accessor(mk('service')) as string[]).toContain('services');
      expect(categoryField.accessor(mk('vehicle')) as string[]).toContain('vehicles');
      expect(categoryField.accessor(mk('siege')) as string[]).toContain('siege-weapons');
      // A catalog row is NOT also swept into Adventuring Gear.
      expect(categoryField.accessor(mk('vehicle')) as string[]).not.toContain('adventuring-gear');
      // The old sentinel string no longer routes anything.
      expect(categoryField.accessor(mk(undefined, ['__siege'])) as string[]).not.toContain('siege-weapons');
    });

    it('no shipped item carries an internal "__" marker in its traits', () => {
      for (const item of Object.values(c.items) as Item[]) {
        const leaked = (item.traits ?? []).filter((t) => isInternalTrait(t));
        expect(leaked, item.name).toEqual([]);
      }
    });

    it('isInternalTrait recognises the sentinel convention', () => {
      expect(isInternalTrait('__siege')).toBe(true);
      expect(isInternalTrait('__vehicle')).toBe(true);
      expect(isInternalTrait('siege')).toBe(false);
      expect(isInternalTrait('magical')).toBe(false);
    });
  });
});
