import { describe, it, expect } from 'vitest';
import { applyDamage, applyHeal, emptyPlay, type PlayState } from '../src/rules/play';

const dyingOf = (p: PlayState) => p.conditions.find((c) => c.id === 'dying')?.value;
const woundedOf = (p: PlayState) => p.conditions.find((c) => c.id === 'wounded')?.value;
const withConds = (conds: { id: string; value?: number }[]): PlayState => ({ ...emptyPlay(), conditions: conds });

// max HP 30 throughout.
describe('HP → Dying automation (applyDamage)', () => {
  it('dropping to 0 HP gains Dying 1', () => {
    expect(dyingOf(applyDamage(emptyPlay(), 50, 30))).toBe(1);
  });

  it('Wounded raises the Dying value gained (1 + wounded)', () => {
    expect(dyingOf(applyDamage(withConds([{ id: 'wounded', value: 1 }]), 50, 30))).toBe(2);
  });

  it('taking more damage while Dying increases it by 1', () => {
    const downed = applyDamage(emptyPlay(), 30, 30);
    expect(dyingOf(applyDamage(downed, 5, 30))).toBe(2);
  });

  it('a single blow ≥ 2× max HP is instant death (Dying = threshold)', () => {
    expect(dyingOf(applyDamage(emptyPlay(), 60, 30))).toBe(4);
  });

  it('Doomed lowers the death threshold', () => {
    expect(dyingOf(applyDamage(withConds([{ id: 'doomed', value: 1 }]), 60, 30))).toBe(3);
  });

  it('damage that does not reach 0 HP does not add Dying', () => {
    expect(dyingOf(applyDamage(emptyPlay(), 10, 30))).toBeUndefined();
  });

  it('temp HP that prevents reaching 0 does not add Dying', () => {
    const p = applyDamage({ ...emptyPlay(), tempHp: 100 }, 50, 30);
    expect(dyingOf(p)).toBeUndefined();
    expect(p.damage).toBe(0);
  });
});

describe('Recovery (applyHeal)', () => {
  it('healing to 1+ HP while Dying removes Dying and adds Wounded', () => {
    const downed = applyDamage(emptyPlay(), 30, 30); // Dying 1, 0 HP
    const healed = applyHeal(downed, 10, 30);
    expect(dyingOf(healed)).toBeUndefined();
    expect(woundedOf(healed)).toBe(1);
  });

  it('a second knockout + recovery raises Wounded to 2', () => {
    let p = applyDamage(emptyPlay(), 30, 30); // Dying 1
    p = applyHeal(p, 10, 30); // recover → Wounded 1
    p = applyDamage(p, 30, 30); // Dying 1 + Wounded 1 = 2
    expect(dyingOf(p)).toBe(2);
    p = applyHeal(p, 10, 30); // recover → Wounded 2
    expect(woundedOf(p)).toBe(2);
    expect(dyingOf(p)).toBeUndefined();
  });

  it('healing while not Dying just heals', () => {
    const p = applyHeal(applyDamage(emptyPlay(), 10, 30), 5, 30);
    expect(p.damage).toBe(5);
    expect(dyingOf(p)).toBeUndefined();
  });
});
