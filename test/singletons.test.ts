import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses } from '../src/rules/derive';

/**
 * Singletons — records whose entire content is one thing the app could not say.
 */
const db = content();

describe('"You can breathe underwater"', () => {
  const withItem = (itemId: string, invested = true) => {
    const c = build('fighter', 10, {});
    return { ...c, inventory: [{ instanceId: 'a', itemId, quantity: 1, worn: true, equipped: true, invested }] } as typeof c;
  };

  it('has no number, so it fitted no existing field — hence the new flag', () => {
    expect(db.items.gills.breathesWater).toBe(true);
  });

  it('an invested graft grants it; the same graft in your bag does not', () => {
    expect(deriveDefenses(withItem('gills'), db).breathesWater).toBe(true);
    expect(deriveDefenses(withItem('gills', false), db).breathesWater).toBe(false);
  });

  it('a character with nothing has it false, not undefined', () => {
    expect(deriveDefenses(build('fighter', 10, {}), db).breathesWater).toBe(false);
  });

  it('a heritage can grant it too', () => {
    expect(db.heritages['seaweed-leshy'].breathesWater).toBe(true);
  });

  it('an EXAMPLE is not a grant — the 18 wands of hybrid form are excluded', () => {
    // "For example, if one form can breathe air and the other can breathe underwater" is prose about
    // a spell. A first pass matched all 18 of them, which is why the filter demands a granting verb.
    const wands = Object.entries(db.items).filter(([id]) => /^wand-of-hybrid-form/.test(id));
    expect(wands.length).toBeGreaterThan(10);
    for (const [id, i] of wands) expect(i.breathesWater, id).toBeUndefined();
  });

  it('a CONDITIONAL one is excluded — it is not a permanent capability', () => {
    // Submersible Helm has an Activate + once-per-day frequency.
    expect(db.items['submersible-helm']?.breathesWater).toBeUndefined();
  });
});

describe('Enlarged Chassis', () => {
  const auto = (over: Record<string, unknown> = {}) => build('fighter', 13, { ancestryId: 'automaton', ...over });

  it('the record says it is permanent', () => {
    expect(db.feats['enlarged-chassis'].description).toMatch(/effects of enlarge constantly/i);
    expect(db.feats['enlarged-chassis'].sizeOverride).toBe('large');
  });

  it('the character becomes Large with 10-foot reach', () => {
    const c = auto({ featPicks: { '13:ancestry': 'enlarged-chassis' } });
    expect(c.size).toBe('large');
    expect(c.reach).toBe(10);
  });

  it('without it they are not', () => {
    expect(auto().size).not.toBe('large');
  });

  it('no clumsy is written — the feat removes it in its own Enhancement clause', () => {
    // Enlarge normally imposes clumsy 1; this feat says "You are no longer clumsy due to the effects
    // of enlarge", so writing it would be wrong for every character who has the feat.
    expect(db.feats['enlarged-chassis'].description).toMatch(/no longer clumsy/i);
    const c = auto({ featPicks: { '13:ancestry': 'enlarged-chassis' } });
    expect(c.conditions.some((x) => x.id === 'clumsy')).toBe(false);
  });
});
