import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { ACTIVITIES } from '../src/rules/actions';

const c = content();

describe('skill-action coverage (Main-tab activities)', () => {
  it('covers every core skill, including the Thievery actions that were missing', () => {
    const skills = new Set(ACTIVITIES.filter((a) => a.skill).map((a) => a.skill));
    for (const s of ['Athletics', 'Acrobatics', 'Stealth', 'Deception', 'Diplomacy', 'Intimidation', 'Medicine', 'Thievery', 'Survival', 'Crafting', 'Performance'])
      expect(skills, `skill ${s}`).toContain(s);
  });

  it('includes the previously-missing Thievery + social skill actions', () => {
    const names = new Set(ACTIVITIES.map((a) => a.name));
    for (const n of ['Steal', 'Palm an Object', 'Disable a Device', 'Pick a Lock', 'Lie', 'Impersonate', 'Make an Impression', 'Gather Information', 'Coerce'])
      expect(names, n).toContain(n);
  });

  it('every skill action names a governing skill and (encounter ones) an action cost', () => {
    for (const a of ACTIVITIES.filter((x) => x.skill && x.mode === 'encounter')) {
      expect(a.skill, a.name).toBeTruthy();
      expect(a.cost, a.name).toBeTruthy();
    }
  });
});

describe('item activation costs (Item-actions list)', () => {
  it('the importer captures activation costs for activatable items', () => {
    const withAct = Object.values(c.items).filter((i) => (i as { activationCost?: unknown }).activationCost);
    expect(withAct.length).toBeGreaterThan(1000); // thousands of magic items have an Activate line
  });

  it('parses concrete action glyphs into ActionCost shapes (not all variable)', () => {
    const costs = Object.values(c.items)
      .map((i) => (i as { activationCost?: { type: string; value?: number } }).activationCost)
      .filter(Boolean) as { type: string; value?: number }[];
    expect(costs.some((x) => x.type === 'actions' && x.value === 1)).toBe(true);
    expect(costs.some((x) => x.type === 'reaction')).toBe(true);
    expect(costs.some((x) => x.type === 'free')).toBe(true);
  });
});
