import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { rest } from '../src/rules/play';
import type { PlayState } from '../src/rules/types';

/**
 * "You regain twice as many Hit Points from resting."
 *
 * rest() computed `level × Con mod` and stepped Doomed/Drained down by exactly 1, both hardcoded, so
 * Fast Recovery and Bolstered Recovery changed nothing about a night's sleep.
 *
 * Bolstered Recovery doubles BOTH halves: "Double the number of Hit Points you regain and the amount
 * by which condition values are reduced from a full night's rest."
 */
const db = content();
const play = (over: Partial<PlayState> = {}): PlayState =>
  ({ damage: 0, tempHp: 0, heroPoints: 0, xp: 0, focusUsed: 0, expendedSlots: {}, slotsUsed: {}, conditions: [], pinned: [], inventory: [], ...over }) as PlayState;

const OPTS = { level: 10, conMod: 3 };

describe('rest recovery', () => {
  it('heals level x Con mod by default', () => {
    expect(rest(play({ damage: 100 }), OPTS).damage).toBe(100 - 30);
  });

  it('Fast Recovery doubles the Hit Points', () => {
    const after = rest(play({ damage: 100 }), { ...OPTS, restRecovery: { hpMultiplier: 2, conditionSteps: 1 } });
    expect(after.damage).toBe(100 - 60);
  });

  it('Doomed and Drained step down by 1 by default', () => {
    const after = rest(play({ conditions: [{ id: 'doomed', value: 3 }, { id: 'drained', value: 2 }] }), OPTS);
    expect(after.conditions.find((c) => c.id === 'doomed')?.value).toBe(2);
    expect(after.conditions.find((c) => c.id === 'drained')?.value).toBe(1);
  });

  it('Bolstered Recovery steps them down by 2', () => {
    const opts = { ...OPTS, restRecovery: { hpMultiplier: 2, conditionSteps: 2 } };
    const after = rest(play({ conditions: [{ id: 'doomed', value: 3 }, { id: 'drained', value: 2 }] }), opts);
    expect(after.conditions.find((c) => c.id === 'doomed')?.value).toBe(1);
    // Drained 2 stepped by 2 reaches 0 and is removed entirely.
    expect(after.conditions.find((c) => c.id === 'drained')).toBeUndefined();
  });

  it('a character carries the right multipliers, and two feats do not multiply together', () => {
    const fast = build('fighter', 10, { featPicks: { '7:general': 'fast-recovery' } });
    expect(fast.restRecovery).toEqual({ hpMultiplier: 2, conditionSteps: 1 });

    const both = build('fighter', 10, { featPicks: { '7:general': 'fast-recovery', '10:class': 'bolstered-recovery' } });
    // The better offer wins — 2, never 4.
    expect(both.restRecovery?.hpMultiplier).toBe(2);
  });

  it('a character with neither feat carries nothing', () => {
    expect(build('fighter', 10, {}).restRecovery).toBeUndefined();
  });

  it('the data matches what each feat prints', () => {
    expect(db.feats['fast-recovery'].restRecovery).toEqual({ hpMultiplier: 2 });
    // Bolstered Recovery is the only one that also doubles the condition steps.
    expect(db.feats['bolstered-recovery'].restRecovery).toEqual({ hpMultiplier: 2, conditionSteps: 2 });
  });
});
