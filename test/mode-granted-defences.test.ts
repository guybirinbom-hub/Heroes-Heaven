import { describe, it, expect } from 'vitest';
import { deriveDefenses } from '../src/rules/derive';
import type { Character, ModeDef } from '../src/rules/types';
import { content, build } from './_content';

/**
 * A mode (a drunk potion, a switched-on ability) can grant DEFENCES, not just numeric check bonuses.
 *
 * Before this, `modifiers` could express "+2 Stealth" and nothing else, so 92 of the 108 toggles the
 * coverage sweep found — "tremorsense 30 feet for 1 minute", "resistance 5 to fire until the start of
 * your next turn" — had nowhere to live. These tests pin the new lane, including the two things that
 * are easy to get wrong: temporary resistances obey the SAME no-stacking rule as permanent ones, and
 * they must vanish completely when the mode is switched off.
 */
const mode = (over: Partial<ModeDef>): ModeDef => ({ id: 'test-mode', name: 'Test Mode', modifiers: [], ...over });

const withModes = (modes: ModeDef[]): Character => {
  const c = build('fighter', 5);
  return { ...c, activeModes: modes };
};

describe('a mode can grant defences', () => {
  const db = () => content();

  it('grants a resistance while active', () => {
    const d = deriveDefenses(withModes([mode({ name: 'Potion of Fire Resistance', resistances: [{ type: 'fire', value: 5 }] })]), db());
    expect(d.resistances.find((r) => r.type === 'fire')?.value).toBe(5);
  });

  it('grants a sense while active', () => {
    const d = deriveDefenses(withModes([mode({ name: 'Aged Arbor Wine', senses: [{ name: 'tremorsense', range: 30 }] })]), db());
    expect(d.senses.some((s) => s.name === 'tremorsense')).toBe(true);
  });

  it('grants an immunity while active', () => {
    const d = deriveDefenses(withModes([mode({ name: 'Antidote', immunities: ['poison'] })]), db());
    expect(d.immunities).toContain('poison');
  });

  it('grants nothing once the mode is switched off', () => {
    const d = deriveDefenses(withModes([]), db());
    expect(d.resistances.some((r) => r.type === 'fire')).toBe(false);
    expect(d.senses.some((s) => s.name === 'tremorsense')).toBe(false);
  });

  it('does NOT stack with another source of the same type — the highest applies', () => {
    const c = withModes([
      mode({ id: 'weak-potion', name: 'Lesser Potion', resistances: [{ type: 'fire', value: 2 }] }),
      mode({ id: 'strong-potion', name: 'Greater Potion', resistances: [{ type: 'fire', value: 8 }] }),
    ]);
    const d = deriveDefenses(c, db());
    expect(d.resistances.find((r) => r.type === 'fire')?.value).toBe(8); // NOT 10
  });

  it('names the mode in the breakdown and marks it as temporary', () => {
    const d = deriveDefenses(
      withModes([mode({ name: 'Potion of Fire Resistance', duration: '1 minute', resistances: [{ type: 'fire', value: 5 }] })]),
      db(),
    );
    const sources = d.sources?.['resistance:fire'] ?? [];
    expect(sources.map((s) => s.from)).toContain('Potion of Fire Resistance');
    // The condition is what tells the player this one goes away.
    expect(sources.find((s) => s.from === 'Potion of Fire Resistance')?.condition).toContain('1 minute');
  });

  it('the superseded source is kept and flagged, not dropped', () => {
    const d = deriveDefenses(
      withModes([
        mode({ id: 'a', name: 'Lesser Potion', resistances: [{ type: 'fire', value: 2 }] }),
        mode({ id: 'b', name: 'Greater Potion', resistances: [{ type: 'fire', value: 8 }] }),
      ]),
      db(),
    );
    const sources = d.sources?.['resistance:fire'] ?? [];
    expect(sources).toHaveLength(2);
    expect(sources.find((s) => s.from === 'Lesser Potion')?.applied).toBe(false);
    expect(sources.find((s) => s.from === 'Greater Potion')?.applied).toBe(true);
  });
});
