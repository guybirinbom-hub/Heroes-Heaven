import { describe, it, expect } from 'vitest';
import { build } from './_content';

/**
 * ARMIGER'S PROTECTION (Hellfire Dispatches p.25) — the armour-by-NAME lane.
 *
 * "You become trained in light armor and Hellknight breastplate, A MEDIUM ARMOR. If you were already
 * trained in light armor and medium armor, you gain training in Hellknight half plate and Hellknight
 * plate. Whenever you gain a class feature that grants you expert or greater proficiency in any type
 * of armor (but not unarmored defense), you also gain that proficiency in the armor types granted to
 * you by this feat. If you have a class feature that grants you expert proficiency in unarmored
 * defense and you're 13th level or higher, you also become an expert in the armor types granted to
 * you by this feat."
 *
 * The old encoding was `armor.medium` — the whole CATEGORY for one named item — so a 13th-level
 * rogue read expert (4+13=17) in an ordinary Breastplate where print leaves them at untrained +0.
 */
const take = (cls: string, level: number) =>
  build(cls, level, { featPicks: { [`${level >= 4 ? 4 : 2}:class:0`]: 'armigers-protection' } });

describe("Armiger's Protection — named armours, not categories", () => {
  // ⚠ The fixture's rogue is a RUFFIAN (first subclass), which is medium-trained by print — so the
  // light-only cases below use the swashbuckler, whose chassis really is light-only.
  it('a light-only class gains the breastplate by NAME and no medium category', () => {
    const c = take('swashbuckler', 4);
    expect(c.proficiencies.armorOverrides?.['hellknight-breastplate']).toBe('trained');
    // The category over-grant is gone: an ordinary Breastplate stays untrained.
    expect(c.proficiencies.defenses.medium).toBe('untrained');
    // …and the conditional branch did not fire (a swashbuckler is not medium-trained coming in).
    expect(c.proficiencies.armorOverrides?.['hellknight-plate']).toBeUndefined();
  });

  it('an already light+medium-trained class gains the two named heavy suits — and only those', () => {
    const c = take('ranger', 4);
    expect(c.proficiencies.armorOverrides?.['hellknight-half-plate']).toBe('trained');
    expect(c.proficiencies.armorOverrides?.['hellknight-plate']).toBe('trained');
    // The heavy CATEGORY is untouched: no Full Plate for a ranger.
    expect(c.proficiencies.defenses.heavy).toBe('untrained');
  });

  it("the mirror rider tracks the class's best armour rank onto the named suits", () => {
    // Swashbuckler 13: light armour expertise has landed → the breastplate mirrors to expert
    // while the ordinary medium category stays untrained.
    const c = take('swashbuckler', 13);
    expect(c.proficiencies.defenses.light).toBe('expert');
    expect(c.proficiencies.armorOverrides?.['hellknight-breastplate']).toBe('expert');
    expect(c.proficiencies.defenses.medium).toBe('untrained');
  });

  it('the 13th-level unarmored rider raises the named suits for an unarmored-expert class', () => {
    // Monk: unarmored expert+ from its own chassis, light/medium/heavy untrained natively —
    // the armour MIRROR alone would leave the breastplate at trained; the unarmored rider is
    // what lifts it at 13th.
    const c = take('monk', 13);
    expect(['expert', 'master', 'legendary']).toContain(c.proficiencies.defenses.unarmored);
    expect(c.proficiencies.armorOverrides?.['hellknight-breastplate']).toBe('expert');
  });

  it('the free non-magical suit arrives in the inventory', () => {
    const c = take('swashbuckler', 4);
    expect(c.inventory.some((i) => i.itemId === 'hellknight-breastplate')).toBe(true);
  });
});
