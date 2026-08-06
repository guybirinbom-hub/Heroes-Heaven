import { describe, expect, it } from 'vitest';
import { content, build, mainCasting } from './_content';
import { containerLoads, deriveStrikes } from '../src/rules/derive';
import type { InventoryItem } from '../src/rules/types';

/**
 * Feats whose entire printed content was a sentence nothing in the engine could read. Each one here
 * previously resolved to nothing at all — no number moved, no list changed.
 */
const c = () => content();

describe('Pack Rat', () => {
  const carry = (itemId: string, i: number): InventoryItem => ({ instanceId: `c${i}`, itemId, quantity: 1 });

  const capacities = (has: boolean) => {
    const ch = build('fighter', 3, {
      ancestryId: 'ratfolk',
      featPicks: has ? { '1:ancestry:0': 'pack-rat' } : {},
      inventory: [carry('backpack', 1), carry('chest', 2), carry('spacious-pouch', 3)],
    });
    const loads = containerLoads(ch, c());
    const byItem: Record<string, number | undefined> = {};
    for (const inv of ch.inventory) byItem[inv.itemId] = loads[inv.instanceId]?.capacity;
    return byItem;
  };

  it('adds 50% to mundane containers — the printed examples exactly', () => {
    expect(capacities(false).backpack).toBe(4);
    expect(capacities(false).chest).toBe(8);
    // "you can fit 6 Bulk in a backpack, or 12 Bulk in a chest"
    expect(capacities(true).backpack).toBe(6);
    expect(capacities(true).chest).toBe(12);
  });

  it('leaves magical and extradimensional storage alone', () => {
    // "nor does it change how much you can store in a magical or extradimensional storage space,
    // such as a spacious pouch."
    expect(capacities(true)['spacious-pouch']).toBe(capacities(false)['spacious-pouch']);
  });
});

describe('Raging Thrower', () => {
  const javelin: InventoryItem = { instanceId: 'j', itemId: 'javelin', quantity: 1, equipped: true };
  const raging = (has: boolean) => {
    const ch = build('barbarian', 5, {
      subclassId: 'fury-instinct',
      keyAbility: 'str',
      featPicks: has ? { '1:class:0': 'raging-thrower' } : {},
      inventory: [javelin],
    });
    // Rage is a toggle the sheet flips during play; the rider only exists while it is on.
    ch.classResources = { ...(ch.classResources ?? {}), rage: 1 };
    const strike = deriveStrikes(ch, c()).find((s) => s.name === c().items.javelin.name);
    return (strike?.conditionalDamage ?? []).map((d) => `${d.text} ${d.note}`).join(' | ');
  };

  it('applies Rage damage to a thrown weapon, and only with the feat', () => {
    expect(raging(false)).not.toMatch(/raging/);
    // Fury Instinct at level 5 is +3, and the note says which condition it is under.
    expect(raging(true)).toMatch(/^3 \S+ \* while raging \(thrown\)/);
  });
});

describe('Ultimate Polymath', () => {
  const bard = (has: boolean) =>
    build('bard', 20, {
      subclassId: 'enigma',
      spells: { 1: ['fear', 'soothe'], 2: ['blur'] },
      featPicks: has ? { '20:class:0': 'ultimate-polymath' } : {},
    });

  it('makes every repertoire spell a signature spell', () => {
    const without = mainCasting(bard(false));
    const withIt = mainCasting(bard(true));
    const repertoire = [...new Set(Object.values(withIt?.repertoire ?? {}).flat())];
    expect(repertoire.length).toBeGreaterThan(1);
    expect(new Set(withIt?.signature ?? [])).toEqual(new Set(repertoire));
    // Without it a 20th-level bard is still capped at the one signature per rank the base feature
    // grants — and picks none at all when the player has chosen none.
    expect((without?.signature ?? []).length).toBeLessThan(repertoire.length);
  });
});

describe('Flexible Spellcaster Dedication', () => {
  const wizard = (level: number, has: boolean) =>
    build('wizard', level, {
      subclassId: 'school-of-battle-magic',
      cantrips: ['detect-magic', 'light', 'shield', 'daze', 'electric-arc', 'prestidigitation', 'telekinetic-projectile'],
      featPicks: has ? { '2:class:0': 'flexible-spellcaster-dedication' } : {},
    });

  it('caps class spell slots at 2 per rank', () => {
    // A 6th-level wizard's table is 3/3/2 — the archetype trades the third slot for flexibility.
    const plain = mainCasting(wizard(6, false));
    const flex = mainCasting(wizard(6, true));
    const perRank = (e: ReturnType<typeof mainCasting>) => Object.values(e?.prepared ?? {}).map((a) => a.length);
    expect(perRank(plain)).toContain(3);
    expect(perRank(flex).filter((n) => n > 2)).toEqual([]);
  });

  it('nets one cantrip DOWN at 2nd and level again at 4th', () => {
    // Class grants 6 (wizard), archetype takes 2, the dedication gives back 1 — then 2 from 4th.
    const base = mainCasting(wizard(2, false))?.cantrips.length ?? 0;
    expect(mainCasting(wizard(2, true))?.cantrips.length).toBe(base - 1);
    expect(mainCasting(wizard(4, true))?.cantrips.length).toBe(base);
  });

  it('leaves the wizard curriculum slot alone', () => {
    // "Extra spell slots you gain that have additional restrictions, like the wizard's specialist
    // school spells … don't change due to this archetype."
    const flex = mainCasting(wizard(6, true));
    expect((flex?.restrictedSlots ?? []).length).toBeGreaterThan(0);
  });
});
