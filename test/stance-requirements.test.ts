import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { deriveAc, activeStanceDef, activeStanceEntry, stanceRequirementIssue, isUnarmored } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

const c = content();

/**
 * STANCE REQUIREMENTS.
 *
 * 47 of the 128 stances print a **Requirements** line and none were enforced, so a character in full
 * plate could toggle Rain of Embers Stance ("Requirements: You are unarmored") and keep its +1 status
 * bonus to AC. The gate lives in activeStanceDef — the one accessor every mechanical call site already
 * reads — so a stance you can't legally be in can't hand you anything.
 */
describe('stance requirements are enforced', () => {
  /** Wear a specific armor item, or nothing. */
  const wearing = (base: Character, itemId?: string): Character => ({
    ...base,
    inventory: itemId ? [{ instanceId: 'a1', itemId, quantity: 1, worn: true }] : [],
  });

  const monk = (stance: string, itemId?: string): Character =>
    wearing({ ...build('monk', 5), activeStance: stance }, itemId);

  it('the data carries the printed requirement', () => {
    expect(c.stances?.['rain-of-embers-stance']?.requires).toEqual({ unarmored: true, text: 'You are unarmored' });
  });

  it('unarmored: the stance applies', () => {
    const ch = monk('rain-of-embers-stance');
    expect(isUnarmored(ch, c)).toBe(true);
    expect(stanceRequirementIssue(ch, c)).toBeNull();
    expect(activeStanceDef(ch, c)?.acBonus?.value).toBe(1);
  });

  it('IN ARMOR: the stance is inert, and its AC bonus is NOT granted (the reported bug)', () => {
    const armored = monk('rain-of-embers-stance', 'full-plate');
    expect(isUnarmored(armored, c)).toBe(false);
    expect(stanceRequirementIssue(armored, c)).toBe('You are unarmored');
    expect(activeStanceDef(armored, c), 'an illegal stance must grant nothing').toBeUndefined();
    // The UI still needs to know which stance is selected, to say why it is doing nothing.
    expect(activeStanceEntry(armored, c)?.name).toBe('Rain of Embers Stance');
  });

  it("the AC total itself drops the stance's bonus when the requirement fails", () => {
    const bare = monk('rain-of-embers-stance');
    const armored = monk('rain-of-embers-stance', 'full-plate');
    const noStance = wearing({ ...build('monk', 5) }, 'full-plate');
    // Same armor, same character — the only difference is the illegal stance, which must add nothing.
    expect(deriveAc(armored, c).value).toBe(deriveAc(noStance, c).value);
    // …while the legal case really is +1 over the same character with no stance.
    expect(deriveAc(bare, c).value).toBe(deriveAc(wearing(build('monk', 5)), c).value + 1);
  });

  it("explorer's clothing still counts as unarmored (it is unarmored-CATEGORY armor)", () => {
    const ch = monk('rain-of-embers-stance', 'explorers-clothing');
    // A category check, not a "is anything worn" check — the naive version would break every monk.
    expect(isUnarmored(ch, c)).toBe(true);
    expect(activeStanceDef(ch, c)?.acBonus?.value).toBe(1);
  });

  it('Tenacious Stance requires the OPPOSITE — wearing armor', () => {
    expect(c.stances?.['tenacious-stance']?.requires).toEqual({ armored: true, text: 'You are wearing armor' });
    const base = build('fighter', 5);
    const unarmoredChar = wearing({ ...base, activeStance: 'tenacious-stance' });
    const armoredChar = wearing({ ...base, activeStance: 'tenacious-stance' }, 'full-plate');
    expect(stanceRequirementIssue(unarmoredChar, c)).toBe('You are wearing armor');
    expect(stanceRequirementIssue(armoredChar, c)).toBeNull();
  });

  it('Rain of Embers grants its fire resistance, scaled and floored at 1', () => {
    const res = c.stances?.['rain-of-embers-stance']?.resistances;
    expect(res).toEqual([{ type: 'fire', value: 'max(1, floor(@actor.level/2))' }]);
  });

  it('a stance with no requirement is unaffected', () => {
    const ch = { ...build('monk', 5), activeStance: 'crane-stance' } as Character;
    // Crane Stance IS an unarmored stance, so with no armor it stays legal.
    expect(stanceRequirementIssue(wearing(ch), c)).toBeNull();
  });
});
