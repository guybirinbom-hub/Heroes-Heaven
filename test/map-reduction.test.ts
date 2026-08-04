import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { mapStepFor, deriveStrikes } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

/**
 * "Your multiple attack penalty with agile weapons becomes –3 and –6, rather than –4 and –8."
 *
 * Both strike builders computed the step as a literal `traits.includes('agile') ? 4 : 5`, so Agile
 * Grace and the ranger's Flurry printed a number the sheet never showed — and the sheet DOES show
 * MAP, so it was visibly wrong rather than merely missing.
 *
 * Flurry applies only against your hunted prey. Applying it unconditionally would be an over-grant
 * on every other target, so it is gated on the Hunt Prey toggle the sheet already tracks.
 */
const db = content();

describe('multiple attack penalty reductions', () => {
  it('the default is 5, or 4 with agile', () => {
    const ch = build('fighter', 5, {});
    expect(mapStepFor(ch, db, ['unarmed'])).toBe(5);
    expect(mapStepFor(ch, db, ['unarmed', 'agile'])).toBe(4);
  });

  it('Agile Grace lowers the agile step to 3 and leaves non-agile alone', () => {
    const ch = build('swashbuckler', 16, { featPicks: { '16:class': 'agile-grace' } });
    expect(mapStepFor(ch, db, ['agile'])).toBe(3);
    expect(mapStepFor(ch, db, [])).toBe(5);
  });

  it('it reaches the actual Strike line, not just the helper', () => {
    const ch = build('swashbuckler', 16, { featPicks: { '16:class': 'agile-grace' } });
    // The bare Fist is agile, so its second attack should sit 3 below the first.
    const fist = deriveStrikes(ch, db).find((s) => s.name === 'Fist')!;
    expect(fist.attack[0] - fist.attack[1]).toBe(3);
    expect(fist.attack[0] - fist.attack[2]).toBe(6);
    expect(fist.mapStep).toBe(3);
  });

  it("Flurry only applies while Hunt Prey is on", () => {
    const ranger = build('ranger', 5, { subclassId: 'flurry' });
    const hunting: Character = { ...ranger, classResources: { ...(ranger.classResources ?? {}), 'hunt-prey': 1 } };
    const idle: Character = { ...ranger, classResources: { ...(ranger.classResources ?? {}), 'hunt-prey': 0 } };

    // Only meaningful if this ranger actually owns Flurry; otherwise the premise is wrong.
    const owns = db.classFeatures['flurry']?.mapReduction != null;
    expect(owns).toBe(true);

    expect(mapStepFor(idle, db, [])).toBe(5);
    expect(mapStepFor(idle, db, ['agile'])).toBe(4);
    expect(mapStepFor(hunting, db, [])).toBe(3);
    expect(mapStepFor(hunting, db, ['agile'])).toBe(2);
  });

  it('a reduction never RAISES the penalty', () => {
    const ranger = build('ranger', 5, { subclassId: 'flurry' });
    const hunting: Character = { ...ranger, classResources: { 'hunt-prey': 1 } };
    // Whatever the data says, the result can only be at or below the baseline.
    expect(mapStepFor(hunting, db, [])).toBeLessThanOrEqual(5);
    expect(mapStepFor(hunting, db, ['agile'])).toBeLessThanOrEqual(4);
  });

  it('the data carries both, with Flurry gated', () => {
    expect(db.feats['agile-grace'].mapReduction).toMatchObject({ agileStep: 3 });
    expect(db.feats['agile-grace'].mapReduction?.step).toBeUndefined(); // agile only, as printed
    expect(db.classFeatures['flurry'].mapReduction).toMatchObject({ step: 3, agileStep: 2, whileState: 'hunt-prey' });
  });
});
