import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { dyingDeathThreshold } from '../src/rules/conditions';
import { applyDamage } from '../src/rules/play';
import type { PlayState } from '../src/rules/types';

/**
 * "You die from the dying condition at dying 5, rather than dying 4."
 *
 * That is Diehard's entire content, and dyingDeathThreshold() took only the Doomed value — so a
 * character with Diehard still died at dying 4 and the feat did nothing at all. Soul Well prints
 * the same sentence and had the same problem.
 */
const play = (over: Partial<PlayState> = {}): PlayState =>
  ({ damage: 0, tempHp: 0, heroPoints: 0, xp: 0, focusUsed: 0, expendedSlots: {}, slotsUsed: {}, conditions: [], pinned: [], inventory: [], ...over }) as PlayState;

describe('Diehard moves the dying-death threshold', () => {
  it('the threshold function honours a raised base', () => {
    expect(dyingDeathThreshold(0)).toBe(4);
    expect(dyingDeathThreshold(0, 5)).toBe(5);
  });

  it('Doomed still steps it down from the raised base, and never below 1', () => {
    expect(dyingDeathThreshold(1, 5)).toBe(4);
    expect(dyingDeathThreshold(2, 5)).toBe(3);
    expect(dyingDeathThreshold(9, 5)).toBe(1);
    expect(dyingDeathThreshold(9, 4)).toBe(1);
  });

  it('a character with Diehard carries the raised threshold', () => {
    const withIt = build('fighter', 3, { featPicks: { '3:general': 'diehard' } });
    expect(withIt.dyingThreshold).toBe(5);
    const without = build('fighter', 3, {});
    expect(without.dyingThreshold).toBeUndefined();
  });

  it('a massive hit kills at 5 with Diehard instead of 4', () => {
    // A blow of 2x max HP is instant death: the dying value jumps straight to the threshold.
    const plain = applyDamage(play(), 100, 40);
    const tough = applyDamage(play(), 100, 40, 5);
    expect(plain.conditions.find((c) => c.id === 'dying')?.value).toBe(4);
    expect(tough.conditions.find((c) => c.id === 'dying')?.value).toBe(5);
  });

  it('dropping to 0 while already dying steps up but stops at the threshold', () => {
    // 40 damage against 40 max actually reaches 0 HP — the step-up only runs when it does.
    const at4 = play({ conditions: [{ id: 'dying', value: 4 }] });
    expect(applyDamage(at4, 40, 40).conditions.find((c) => c.id === 'dying')?.value).toBe(4);
    expect(applyDamage(at4, 40, 40, 5).conditions.find((c) => c.id === 'dying')?.value).toBe(5);
  });

  it('both records that print the sentence carry the field', () => {
    const db = content();
    expect(db.feats['diehard'].dyingThresholdBonus).toBe(1);
    expect(db.feats['soul-well'].dyingThresholdBonus).toBe(1);
  });
});
