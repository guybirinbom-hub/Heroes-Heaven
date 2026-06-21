import { describe, it, expect } from 'vitest';
import { build } from './_content';

// Regression for the audit finding: focus spells were gated behind `if (cls.spellcasting)`,
// so a non-slot-casting class whose subclass grants a focus spell (ranger Vindicator →
// vindicators-mark) got no focus pool and no focus entry on the sheet.
describe('focus spells for non-spellcasting classes', () => {
  it('ranger Vindicator gets a focus pool + its focus spell despite having no spell slots', () => {
    const ch = build('ranger', 5, { subclassId: 'vindicator' });
    // Ranger is not a slot caster.
    expect(ch.spellcasting.find((s) => s.type !== 'focus')).toBeUndefined();
    // …but it now has a focus entry carrying the granted focus spell, and a focus pool.
    const focus = ch.spellcasting.find((s) => s.type === 'focus');
    expect(focus).toBeTruthy();
    expect(Object.values(focus!.repertoire ?? {}).flat()).toContain('vindicators-mark');
    expect(ch.focus?.max ?? 0).toBeGreaterThanOrEqual(1);
  });
});
