import { describe, it, expect } from 'vitest';
import { roll, rollCheck, rollDie, formatFormula } from '../src/rules/dice';

describe('dice', () => {
  it('rollDie stays within 1..sides', () => {
    for (let i = 0; i < 300; i++) {
      const v = rollDie(6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('formatFormula renders the modifier sign', () => {
    expect(formatFormula(1, 20, 7)).toBe('1d20+7');
    expect(formatFormula(2, 6, 0)).toBe('2d6');
    expect(formatFormula(1, 20, -1)).toBe('1d20-1');
  });

  it('roll returns the right dice count, in range, with a correct total and formula', () => {
    const r = roll('X', 3, 8, 2);
    expect(r.dice).toHaveLength(3);
    r.dice.forEach((d) => {
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(8);
    });
    expect(r.total).toBe(r.dice.reduce((a, b) => a + b, 0) + 2);
    expect(r.formula).toBe('3d8+2');
    expect(r.d20).toBeUndefined(); // only single d20 checks carry a d20 flag
  });

  it('rollCheck flags crit on a natural 20 and fumble on a natural 1, consistently', () => {
    for (let i = 0; i < 400; i++) {
      const r = rollCheck('Reflex', 5);
      expect(r.d20).toBeDefined();
      const nat = r.d20!.natural;
      expect(nat).toBeGreaterThanOrEqual(1);
      expect(nat).toBeLessThanOrEqual(20);
      if (nat === 20) expect(r.d20!.outcome).toBe('crit');
      else if (nat === 1) expect(r.d20!.outcome).toBe('fumble');
      else expect(r.d20!.outcome).toBeUndefined();
      expect(r.total).toBe(nat + 5);
    }
  });
});
