import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { abilityMod } from '../src/rules/derive';
import { CLASS_RESOURCES, resourceMaxFor } from '../src/rules/classResources';

/**
 * "Increase the number of items you can create each day with advanced alchemy to 6 + your Int."
 *
 * AlchemyPanel computed `const budget = 4 + intMod` and refused to prepare past it, so an alchemist
 * who took Efficient Alchemy was still capped at 4 + Int — the feat did nothing whatsoever. Advanced
 * Efficient Alchemy (8 + Int, 10 + Int from 16th) had the same problem.
 *
 * The feats are not additive: each one states a new total, so the best offer wins.
 */
describe('Advanced Alchemy daily item count', () => {
  const intOf = (ch: { abilities: { int: number } }) => abilityMod(ch.abilities.int);

  it('an alchemist with no such feat gets the printed 4 + Int', () => {
    const ch = build('alchemist', 4, {});
    expect(ch.advancedAlchemy?.max).toBe(4 + intOf(ch));
    expect(ch.advancedAlchemy?.source).toBeUndefined();
  });

  it('Efficient Alchemy raises it to 6 + Int and names itself', () => {
    const ch = build('alchemist', 4, { featPicks: { '4:class': 'efficient-alchemy' } });
    expect(ch.advancedAlchemy?.max).toBe(6 + intOf(ch));
    expect(ch.advancedAlchemy?.source).toBeTruthy();
  });

  it('Advanced Efficient Alchemy is 8 + Int, and 10 + Int only from 16th level', () => {
    const at10 = build('alchemist', 10, { featPicks: { '10:class': 'advanced-efficient-alchemy' } });
    expect(at10.advancedAlchemy?.max).toBe(8 + intOf(at10));

    const at16 = build('alchemist', 16, { featPicks: { '10:class': 'advanced-efficient-alchemy' } });
    expect(at16.advancedAlchemy?.max).toBe(10 + intOf(at16));
  });

  it('holding both Efficient feats is not additive — each states a new total', () => {
    const ch = build('alchemist', 10, {
      featPicks: { '4:class': 'efficient-alchemy', '10:class': 'advanced-efficient-alchemy' },
    });
    expect(ch.advancedAlchemy?.max).toBe(8 + intOf(ch)); // the better of 6+Int and 8+Int, not 14+Int
  });

  it('a non-alchemist without the dedication chain has no advanced alchemy at all', () => {
    const ch = build('fighter', 4, {});
    expect(ch.advancedAlchemy).toBeUndefined();
  });

  it('Additional Servings raises versatile vials to 5, 6 and 7 as it is retaken', () => {
    const db = content();
    const vial = CLASS_RESOURCES['alchemist'].find((r) => r.id === 'versatile-vials')!;
    const mods = (ch: { abilities: Record<string, number> }) =>
      Object.fromEntries(Object.entries(ch.abilities).map(([k, v]) => [k, abilityMod(v as number)])) as never;

    const plain = build('alchemist', 6, {});
    const base = resourceMaxFor(vial, plain, mods(plain));

    const once = build('alchemist', 6, { featPicks: { '6:class': 'additional-servings' } });
    expect(once.resourceFloors?.['versatile-vials']).toBe(5);
    expect(resourceMaxFor(vial, once, mods(once))).toBe(Math.max(base, 5));

    const thrice = build('alchemist', 18, {
      featPicks: { '6:class': 'additional-servings', '12:class': 'additional-servings', '18:class': 'additional-servings' },
    });
    expect(thrice.resourceFloors?.['versatile-vials']).toBe(7);

    // A FLOOR, never a cap: if the formula already gives more, the feat does not pull it down.
    const high = build('alchemist', 18, {});
    expect(resourceMaxFor(vial, thrice, mods(thrice))).toBeGreaterThanOrEqual(
      resourceMaxFor(vial, high, mods(high)),
    );
    expect(db.feats['additional-servings'].resourceMaxSet).toEqual({ resourceId: 'versatile-vials', values: [5, 6, 7] });
  });

  it('the data carries the field in the shape the engine reads', () => {
    const db = content();
    expect(db.feats['efficient-alchemy'].advancedAlchemy).toEqual({ items: 6, addInt: true });
    expect(db.feats['advanced-efficient-alchemy'].advancedAlchemy).toEqual({
      items: 8,
      addInt: true,
      atLevel: { level: 16, items: 10 },
    });
    // The archetype feat grants a FLAT 4 — it does not inherit the class's Int scaling.
    expect(db.feats['advanced-alchemy'].advancedAlchemy).toEqual({ items: 4 });
  });
});
