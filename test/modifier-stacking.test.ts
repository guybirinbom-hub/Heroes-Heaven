import { describe, it, expect } from 'vitest';
import { poolTypedMods } from '../src/rules/modes';

/*
 * Cross-source PF2e stacking: same-type bonuses/penalties from independent sources take best-bonus +
 * worst-penalty PER TYPE (not the sum); untyped sums. This is the pool every stat now runs through.
 */
describe('poolTypedMods — cross-source stacking', () => {
  it('two same-type BONUSES do not stack (highest wins)', () => {
    expect(poolTypedMods([{ type: 'item', value: 1 }, { type: 'item', value: 2 }])).toBe(2);
    expect(poolTypedMods([{ type: 'status', value: 1 }, { type: 'status', value: 1 }])).toBe(1);
  });
  it('two same-type PENALTIES do not stack (worst wins)', () => {
    expect(poolTypedMods([{ type: 'status', value: -2 }, { type: 'status', value: -1 }])).toBe(-2);
  });
  it('a same-type bonus AND penalty both apply', () => {
    expect(poolTypedMods([{ type: 'circumstance', value: 2 }, { type: 'circumstance', value: -2 }])).toBe(0);
  });
  it('different types add together', () => {
    expect(poolTypedMods([{ type: 'status', value: 1 }, { type: 'circumstance', value: 1 }, { type: 'item', value: 1 }])).toBe(3);
  });
  it('untyped modifiers stack (they always sum)', () => {
    expect(poolTypedMods([{ type: 'untyped', value: 1 }, { type: 'untyped', value: 2 }])).toBe(3);
  });
});

describe('stat-level: cross-source same-type does not double-count', () => {
  it('a mode item bonus does not stack with a gear item bonus on a skill', async () => {
    const { content, build } = await import('./_content');
    const { deriveSkill } = await import('../src/rules/derive');
    const db = content();
    // Cloak of Social Graces: +1 item to Diplomacy (a gear item bonus).
    const c = build('fighter', 5, {});
    c.inventory = [{ instanceId: 'cloak', itemId: 'cloak-of-social-graces', quantity: 1, worn: true, invested: true }] as never;
    const geared = deriveSkill(c, 'diplomacy', db).modifier;
    // Now add a MODE that also grants +1 ITEM to Diplomacy — must NOT raise the total (same type).
    c.activeModes = [{ id: 'm', name: 'Test', modifiers: [{ value: 1, type: 'item', target: 'skill', detail: 'diplomacy' }] }] as never;
    const withMode = deriveSkill(c, 'diplomacy', db).modifier;
    expect(withMode).toBe(geared); // +1 item + +1 item = +1 item, not +2
    // A STATUS mode bonus is a different type, so it DOES add.
    c.activeModes = [{ id: 'm2', name: 'Bless', modifiers: [{ value: 1, type: 'status', target: 'skill', detail: 'diplomacy' }] }] as never;
    expect(deriveSkill(c, 'diplomacy', db).modifier).toBe(geared + 1);
  });
});
