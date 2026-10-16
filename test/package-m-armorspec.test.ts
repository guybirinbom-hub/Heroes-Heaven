import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { armorSpecAccess, armorSpecCovers, deriveDefenses } from '../src/rules/derive';
import type { ArmorItem, Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * PACKAGE M (8) — the inventor's armor innovation gets the armor specialization effect at 11th.
 *
 * class-feature-497, Medium Armor Expertise (Inventor): *"If you have a medium or heavy armor
 * innovation, you gain access to the critical specialization effect with your armor innovation."* For
 * armor that is the armor specialization effect. The record carried nothing, and `armorSpec` could only
 * unlock whole categories — which would have handed it to every inventor in any suit. So the access is
 * by DESIGNATION, the twin of `critSpecWeapons.designated`: the one suit the player marked as the
 * innovation (InventoryItem.designations), in medium or heavy.
 *
 * The power suit is medium COMPOSITE armour, whose effect is piercing resistance 1 + potency at medium
 * and 2 + potency at heavy (src/rules/armorSpec.ts).
 */
const db = content();
const SUIT = 'power-suit';

const suit = (designated: boolean, extra: Partial<InventoryItem> = {}): InventoryItem => ({
  instanceId: 'suit',
  itemId: SUIT,
  quantity: 1,
  worn: true,
  ...(designated ? { designations: ['innovation'] } : {}),
  ...extra,
});
const inventor = (level: number, inventory: InventoryItem[], over: Record<string, unknown> = {}): Character => ({
  ...build('inventor', level, { subclassId: 'armor-innovation', inventorModifications: { initial: 'phlogistonic-regulator' }, ...over }),
  inventory,
});
const piercing = (c: Character, d: ContentDatabase = db) => deriveDefenses(c, d).resistances.find((r) => r.type === 'piercing')?.value ?? 0;

describe('the shipped data', () => {
  it('the power suit is medium composite armour', () => {
    expect(db.items[SUIT]).toMatchObject({ itemType: 'armor', category: 'medium', group: 'composite' });
  });

  // batch package-m premise: class-feature-497 "If you have a medium or heavy armor innovation"
  it('the record carries the designated grant', () => {
    expect(db.classFeatures['medium-armor-expertise-inventor'].armorSpec).toEqual({
      designated: 'innovation',
      designatedCategories: ['medium', 'heavy'],
      innovationType: 'armor',
    });
    expect(db.classes.inventor.features).toContainEqual({ level: 11, featureId: 'medium-armor-expertise-inventor' });
  });
});

describe("an armor-innovation inventor's suit", () => {
  it('10th level: no armor specialization yet', () => {
    expect(piercing(inventor(10, [suit(true)]))).toBe(0);
  });

  it('11th level: the designated suit has it — piercing 1 + its potency', () => {
    expect(piercing(inventor(11, [suit(true)]))).toBe(1);
    expect(piercing(inventor(11, [suit(true, { runes: { potency: 2 } } as Partial<InventoryItem>)]))).toBe(3);
  });

  it('a suit that is NOT the designated innovation gets nothing', () => {
    expect(piercing(inventor(11, [suit(false)]))).toBe(0);
  });

  it('Heavy Construction makes the suit heavy, and the value follows (2 + potency)', () => {
    const c = inventor(11, [suit(true)], { inventorModifications: { initial: 'phlogistonic-regulator', breakthrough: 'heavy-construction' } });
    expect(piercing(c)).toBe(2);
  });

  it('a designated LIGHT suit is not "a medium or heavy armor innovation"', () => {
    const c = inventor(11, [{ instanceId: 'lt', itemId: 'leather-armor', quantity: 1, worn: true, designations: ['innovation'] }]);
    const access = armorSpecAccess(c, db);
    expect(access.designated.get('lt')).toEqual(['medium', 'heavy']);
    expect(armorSpecCovers(access, { inv: c.inventory[0], armor: db.items['leather-armor'] as ArmorItem })).toBe(false);
  });

  it('planted: a category grant instead of a designated one hands it to an undesignated suit', () => {
    const bad = {
      ...db,
      classFeatures: {
        ...db.classFeatures,
        'medium-armor-expertise-inventor': { ...db.classFeatures['medium-armor-expertise-inventor'], armorSpec: { categories: ['medium', 'heavy'] } },
      },
    } as ContentDatabase;
    expect(piercing(inventor(11, [suit(false)]), bad)).toBe(1);
  });

  it('planted: with the grant removed, the designated suit has nothing at 11', () => {
    const bad = {
      ...db,
      classFeatures: {
        ...db.classFeatures,
        'medium-armor-expertise-inventor': { ...db.classFeatures['medium-armor-expertise-inventor'], armorSpec: undefined },
      },
    } as ContentDatabase;
    expect(piercing(inventor(11, [suit(true)]), bad)).toBe(0);
  });
});

describe('other inventors', () => {
  it('a weapon-innovation inventor in the same suit gets nothing (their innovation is the weapon)', () => {
    const c: Character = {
      ...build('inventor', 11, { subclassId: 'weapon-innovation' }),
      inventory: [suit(false), { instanceId: 'w', itemId: 'longsword', quantity: 1, equipped: true, designations: ['innovation'] }],
    };
    expect(armorSpecAccess(c, db).designated.size).toBe(0);
    expect(piercing(c)).toBe(0);
  });

  // batch package-m premise: class-feature-497 "If you have a medium or heavy armor innovation"
  it('a weapon- or construct-innovation inventor who MARKS a medium suit as Innovation still gets nothing', () => {
    for (const subclassId of ['weapon-innovation', 'construct-innovation']) {
      const c: Character = { ...build('inventor', 11, { subclassId }), inventory: [suit(true)] };
      expect(c.inventor?.innovationType, subclassId).not.toBe('armor');
      expect(armorSpecAccess(c, db).designated.size, subclassId).toBe(0);
      expect(piercing(c), subclassId).toBe(0);
    }
    // The same marked suit on an armor-innovation inventor does count (the gate is the subclass, not the mark).
    expect(piercing(inventor(11, [suit(true)]))).toBe(1);
  });

  /* The gate lives on the RECORD (`armorSpec.innovationType`), not as a designation literal in derive.ts —
   * a literal there collides with the classFeatures record `innovation` and turns trust-lanes-check red.
   * This plant proves the record field is what carries it: without it the marked suit counts again. */
  it('planted: without innovationType on the record, a weapon-innovation inventor who marks a suit gets it', () => {
    const { innovationType: _drop, ...rest } = db.classFeatures['medium-armor-expertise-inventor'].armorSpec!;
    const bad = {
      ...db,
      classFeatures: { ...db.classFeatures, 'medium-armor-expertise-inventor': { ...db.classFeatures['medium-armor-expertise-inventor'], armorSpec: rest } },
    } as ContentDatabase;
    const c: Character = { ...build('inventor', 11, { subclassId: 'weapon-innovation' }), inventory: [suit(true)] };
    expect(piercing(c, bad)).toBe(1);
    expect(piercing(c)).toBe(0);
    expect(armorSpecAccess(c, db).from).toEqual([]);
  });
});

describe('with the trust gate on, as the app runs', () => {
  it('the grant survives the gate (a class-owned feature)', () => {
    const gated = content({ trustGate: true });
    expect(piercing(inventor(11, [suit(true)]), gated)).toBe(1);
  });
});
