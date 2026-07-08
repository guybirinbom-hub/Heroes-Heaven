import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveAc, deriveStrikes, deriveSpeeds } from '../src/rules/derive';

// The active-stance system: content.stances (extracted from each stance's text) + Character.activeStance
// drive an injected Strike + AC / Dex-cap / Speed changes in the derive layer.
describe('stances', () => {
  const c = content();

  it('extracted stance data is present in content', () => {
    expect(Object.keys(c.stances).length).toBeGreaterThan(80);
    expect(c.stances['mountain-stance']?.acBonus).toEqual({ value: 4, type: 'item' });
    expect(c.stances['mountain-stance']?.dexCap).toBe(0);
    expect(c.stances['mountain-stance']?.speedPenalty).toBe(5);
    expect(c.stances['tiger-stance']?.strikes?.[0]?.name).toBe('Tiger Claw');
    expect(c.stances['tiger-stance']?.strikes?.[0]?.die).toBe('d8');
    expect(c.stances['tiger-stance']?.strikes?.[0]?.traits).toContain('unarmed');
  });

  it('an active stance injects its granted Strike; none is present otherwise', () => {
    const monk = build('monk', 1);
    expect(deriveStrikes(monk, c).some((s) => s.name === 'Tiger Claw')).toBe(false);
    expect(deriveStrikes({ ...monk, activeStance: 'tiger-stance' }, c).some((s) => s.name === 'Tiger Claw')).toBe(true);
  });

  it('Crane Stance adds its +1 AC bonus (no Dex cap, so it is a clean +1)', () => {
    const monk = build('monk', 3);
    expect(deriveAc({ ...monk, activeStance: 'crane-stance' }, c).value).toBe(deriveAc(monk, c).value + 1);
  });

  it('Mountain Stance caps Dex-to-AC at +0 and reduces Speed by 5', () => {
    const monk = build('monk', 5);
    expect(deriveAc({ ...monk, activeStance: 'mountain-stance' }, c).dexCap).toBe(0);
    const baseLand = deriveSpeeds(monk, c).land ?? 0;
    expect(deriveSpeeds({ ...monk, activeStance: 'mountain-stance' }, c).land).toBe(Math.max(0, baseLand - 5));
  });

  it('no active stance leaves AC and strikes unchanged', () => {
    const monk = build('monk', 3);
    expect(deriveAc({ ...monk, activeStance: undefined }, c).value).toBe(deriveAc(monk, c).value);
  });
});
