import { describe, it, expect } from 'vitest';
import { emptyPlay, setCondition, rest, type PlayState } from '../src/rules/play';
import { dyingDeathThreshold } from '../src/rules/conditions';

const dyingOf = (p: PlayState) => p.conditions.find((c) => c.id === 'dying')?.value;
const woundedOf = (p: PlayState) => p.conditions.find((c) => c.id === 'wounded')?.value;
const valOf = (p: PlayState, id: string) => p.conditions.find((c) => c.id === id)?.value;

describe('dyingDeathThreshold', () => {
  it('is 4 normally and drops with Doomed (never below 1)', () => {
    expect(dyingDeathThreshold(0)).toBe(4);
    expect(dyingDeathThreshold(1)).toBe(3);
    expect(dyingDeathThreshold(2)).toBe(2);
    expect(dyingDeathThreshold(3)).toBe(1);
    expect(dyingDeathThreshold(4)).toBe(1);
  });
});

describe('setCondition (set-or-add a valued condition)', () => {
  it('adds the condition when absent', () => {
    expect(dyingOf(setCondition(emptyPlay(), 'dying', 2))).toBe(2);
  });

  it('updates a condition already present (no duplicates)', () => {
    let p = setCondition(emptyPlay(), 'dying', 1);
    p = setCondition(p, 'dying', 3);
    expect(dyingOf(p)).toBe(3);
    expect(p.conditions.filter((c) => c.id === 'dying')).toHaveLength(1);
  });

  it('manually setting Dying to 0 removes it WITHOUT bumping Wounded (not a recovery)', () => {
    // Manually clearing a Dying value (a misclick, or a GM removing it) must not add
    // Wounded — only being healed to 1+ HP (applyHeal) counts as recovery.
    let p = setCondition(emptyPlay(), 'dying', 1);
    p = setCondition(p, 'dying', 0);
    expect(dyingOf(p)).toBeUndefined();
    expect(woundedOf(p)).toBeUndefined();
  });

  it('manually stepping Dying down (including to 0) never bumps Wounded', () => {
    let p = setCondition(emptyPlay(), 'dying', 3);
    p = setCondition(p, 'dying', 2); // step down, still dying
    p = setCondition(p, 'dying', 1);
    p = setCondition(p, 'dying', 0); // manual clear
    expect(dyingOf(p)).toBeUndefined();
    expect(woundedOf(p)).toBeUndefined();
  });

  it('setting Wounded to 0 just removes it (no Dying side effects)', () => {
    let p = setCondition(emptyPlay(), 'wounded', 2);
    p = setCondition(p, 'wounded', 0);
    expect(woundedOf(p)).toBeUndefined();
    expect(dyingOf(p)).toBeUndefined();
  });
});

describe('rest() / daily preparations (PF2e)', () => {
  const opts = { level: 5, conMod: 2 }; // recover 10 HP

  it('recovers level × Con modifier HP, not a full heal', () => {
    const p = { ...emptyPlay(), damage: 30 };
    expect(rest(p, opts).damage).toBe(20); // 30 − (5 × 2)
  });

  it('Con modifier counts as at least 1 for recovery', () => {
    const p = { ...emptyPlay(), damage: 10 };
    expect(rest(p, { level: 4, conMod: -1 }).damage).toBe(6); // 10 − (4 × 1)
  });

  it('does NOT reset hero points (they are session-based)', () => {
    const p = { ...emptyPlay(), heroPoints: 0 };
    expect(rest(p, opts).heroPoints).toBe(0);
  });

  it('removes Fatigued and steps Doomed/Drained down by 1', () => {
    let p = setCondition(emptyPlay(), 'doomed', 2);
    p = setCondition(p, 'drained', 1);
    p = { ...p, conditions: [...p.conditions, { id: 'fatigued' }], damage: 30 };
    const r = rest(p, opts);
    expect(r.conditions.some((c) => c.id === 'fatigued')).toBe(false);
    expect(valOf(r, 'doomed')).toBe(1);
    expect(valOf(r, 'drained')).toBeUndefined();
  });

  it('Wounded clears only when the rest restores full HP', () => {
    // still damaged afterwards → Wounded persists
    const hurt = { ...setCondition(emptyPlay(), 'wounded', 1), damage: 30 };
    expect(valOf(rest(hurt, opts), 'wounded')).toBe(1);
    // recovers to full → Wounded clears
    const light = { ...setCondition(emptyPlay(), 'wounded', 1), damage: 5 };
    expect(valOf(rest(light, opts), 'wounded')).toBeUndefined();
  });

  it('does not touch Dying (you cannot rest while dying)', () => {
    const p = { ...setCondition(emptyPlay(), 'dying', 1), damage: 30 };
    expect(valOf(rest(p, opts), 'dying')).toBe(1);
  });

  it('refreshes focus and spell slots', () => {
    const p = { ...emptyPlay(), focusUsed: 2, expendedSlots: { 'a:1:0': true }, slotsUsed: { 'a:1': 3 } };
    const r = rest(p, opts);
    expect(r.focusUsed).toBe(0);
    expect(r.expendedSlots).toEqual({});
    expect(r.slotsUsed).toEqual({});
  });

  it('leaves other conditions (e.g. clumsy) untouched', () => {
    const p = setCondition(emptyPlay(), 'clumsy', 2);
    expect(valOf(rest(p, opts), 'clumsy')).toBe(2);
  });

  it('also recovers companion conditions', () => {
    const p = { ...emptyPlay(), companionConditions: { 'comp-1': [{ id: 'fatigued' }, { id: 'doomed', value: 1 }] } };
    const r = rest(p, opts);
    expect(r.companionConditions?.['comp-1']).toEqual([]);
  });
});
