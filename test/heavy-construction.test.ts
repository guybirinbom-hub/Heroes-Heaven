import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveAc, deriveSpeeds, deriveArmorCheckPenalty, isUnarmored, effectiveItemBulk, applyArmorRiders } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import type { BuildState } from '../src/rules/build';
import type { ArmorItem, Character, InventoryItem } from '../src/rules/types';

/**
 * Heavy Construction — "Your innovation becomes heavy armor, and your proficiency in your innovation
 * armor (but no other heavy armor) advances to be equal to your proficiency in medium armor."
 *
 * The second clause is the load-bearing one. An inventor is untrained in heavy armor at EVERY level,
 * and untrained is a flat +0 — so flipping the category without remapping proficiency costs a
 * 10th-level inventor 12 AC.
 */
const db = content();
const SUIT = 'power-suit';

const inventor = (opts: { level?: number; str?: number; dex?: number; feat?: boolean; designate?: boolean; itemId?: string } = {}): Character => {
  const { level = 10, str = 16, dex = 12, feat = true, designate = true, itemId = SUIT } = opts;
  const c = build('inventor', level, {
    subclassId: 'armor-innovation',
    inventorArmorStats: 'power-suit',
    inventorModifications: feat ? { breakthrough: 'heavy-construction' } : { breakthrough: 'layered-mesh' },
  } as Partial<BuildState>);
  return {
    ...c,
    abilities: { ...c.abilities, str, dex },
    inventory: [
      {
        instanceId: 'arm1',
        itemId,
        quantity: 1,
        worn: true,
        ...(designate ? { designations: ['innovation'] } : {}),
      } as InventoryItem,
    ],
  };
};

const ridden = (c: Character) => applyArmorRiders(c, db, c.inventory[0], db.items[c.inventory[0].itemId] as ArmorItem);

describe('Heavy Construction', () => {
  it('an inventor is untrained in heavy armor at every level — that is the whole problem', () => {
    for (const lvl of [1, 10, 20]) {
      expect(build('inventor', lvl).proficiencies.defenses.heavy).toBe('untrained');
    }
  });

  it('the innovation becomes heavy armor', () => {
    expect(ridden(inventor()).armor.category).toBe('heavy');
    expect(isUnarmored(inventor(), db)).toBe(false);
  });

  it('but its proficiency still reads the MEDIUM track', () => {
    const c = inventor();
    expect(ridden(c).profCategory).toBe('medium');
    // The character remains untrained in heavy armor — "but no other heavy armor".
    expect(c.proficiencies.defenses.heavy).toBe('untrained');
    expect(deriveAc(c, db).rank).not.toBe('untrained');
  });

  it('AC does not collapse — the anti-regression for the naive fix', () => {
    const withFeat = deriveAc(inventor(), db).value;
    const without = deriveAc(inventor({ feat: false }), db).value;
    // Heavy Construction changes no AC number: the Power Suit already prints AC Bonus +5 and Dex Cap +1.
    expect(withFeat).toBe(without);
    // A category flip with no proficiency remap would have cost the whole proficiency bonus.
    expect(withFeat).toBeGreaterThan(20);
  });

  it('the AC breakdown agrees with the AC — parts sum to the total', () => {
    const c = inventor();
    const b = explainStat(c, db, { kind: 'ac' });
    expect(b.parts.reduce((s, p) => s + p.value, 0)).toBe(deriveAc(c, db).value);
    expect(b.subtitle).toBe('Heavy armor'); // what it IS
    expect(b.rank).toBe(deriveAc(c, db).rank); // what the rank came from
  });

  it('Speed: at Str +3 the penalty is removed ENTIRELY, not reduced to -5', () => {
    const base = deriveSpeeds(inventor({ feat: false, designate: false }), db).land;
    expect(deriveSpeeds(inventor({ str: 16 }), db).land).toBe(base);
  });

  it('Speed: below Str +3 the full restatted -10 stands', () => {
    const base = deriveSpeeds(inventor({ feat: false, designate: false, str: 14 }), db).land;
    // Undesignated the suit is -5 and Str +2 misses its threshold of 3, so the base is already -5.
    // Restatted it is -10, i.e. 5 feet slower than that.
    expect(deriveSpeeds(inventor({ str: 14 }), db).land).toBe(base - 5);
  });

  it('Bulk goes 2 -> 3', () => {
    expect(effectiveItemBulk(inventor(), db, 'arm1')).toBe(3);
    expect(effectiveItemBulk(inventor({ feat: false }), db, 'arm1')).toBe(2);
  });

  it('the check penalty is untouched by the restat', () => {
    // Str 14 (+2) misses the armor's Strength 3, so the -2 applies either way.
    expect(deriveArmorCheckPenalty(inventor({ str: 14 }), db).value).toBe(
      deriveArmorCheckPenalty(inventor({ str: 14, feat: false }), db).value,
    );
  });

  it('the Dex cap survives the restat', () => {
    expect(deriveAc(inventor({ dex: 18 }), db).dexCap).toBe(1);
    expect(deriveAc(inventor({ dex: 18 }), db).value).toBe(deriveAc(inventor({ dex: 12 }), db).value);
  });

  it('NOTHING happens without the designation', () => {
    const c = inventor({ designate: false });
    expect(ridden(c).armor.category).toBe('medium');
    expect(ridden(c).profCategory).toBe('medium');
    expect(effectiveItemBulk(c, db, 'arm1')).toBe(2);
  });

  it('NOTHING happens without the modification', () => {
    // Keyed to the owned feature, not to the designation alone.
    expect(ridden(inventor({ feat: false })).armor.category).toBe('medium');
  });

  it('THE EXPLOIT: designating full plate as the innovation must not hand it the medium track', () => {
    const plate = Object.entries(db.items).find(([, i]) => i.itemType === 'armor' && i.category === 'heavy' && i.id !== SUIT)?.[0];
    if (!plate) return;
    const c = inventor({ itemId: plate });
    const r = ridden(c);
    // "Power Suit only" — the record names its item, so nothing else is restatted.
    expect(r.profCategory).toBe('heavy');
    expect(deriveAc(c, db).rank).toBe('untrained');
  });

  it('the data survives a rebuild — the row is in effect-backfill.json', async () => {
    const backfill = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync('scripts/data/effect-backfill.json', 'utf8')));
    const rows = backfill.filter(
      (e: { category: string; id: string; field: string }) =>
        e.category === 'classFeatures' && e.id === 'heavy-construction' && e.field === 'armorRestat',
    );
    expect(rows).toHaveLength(1);
    // Whatever ships in core.json must be exactly what the rebuild would put back.
    expect(rows[0].value).toEqual(db.classFeatures['heavy-construction'].armorRestat);
  });
});
