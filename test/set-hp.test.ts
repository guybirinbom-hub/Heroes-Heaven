import { describe, it, expect } from 'vitest';
import { setHp, type PlayState } from '../src/rules/play';

const p = (damage: number): PlayState => ({ damage });

describe('setHp — set current HP directly (clicking the number)', () => {
  it('stores the value as damage from max (current = max − damage)', () => {
    expect(setHp(p(0), 10, 50).damage).toBe(40); // current 10 of 50
    expect(setHp(p(40), 50, 50).damage).toBe(0); // full
  });

  it('clamps above max and below 0', () => {
    expect(setHp(p(20), 999, 50).damage).toBe(0); // can't exceed max → current capped at 50
    expect(setHp(p(0), -5, 50).damage).toBe(50); // can't go below 0 → current 0
  });
});
