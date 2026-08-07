import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { deriveStrikes } from '../src/rules/derive';

/**
 * Weapon damage TYPE, on the weapons the app splits in two.
 *
 * A combination weapon is one item with a melee line and a ranged line, and the app stores each half
 * as its own record. Every one of those halves carried `type: "bludgeoning"` — the importer's
 * default, not anything the books print. A Dagger Pistol is piercing in both modes; a Gun Sword is
 * slashing in melee and piercing at range. Dwarven Waraxe, a Player Core martial weapon, was
 * bludgeoning too.
 *
 * Nothing crashed and no test failed: the sheet computed a confident 1d8 bludgeoning for a battleaxe
 * shaped like an axe, which is exactly why this needed a mirror comparison to find.
 */
const c = () => content();

describe('weapon damage types', () => {
  it.each([
    ['dwarven-waraxe', 'd8', 'slashing'],
    ['gun-sword-melee', 'd8', 'slashing'],
    ['gun-sword-ranged', 'd10', 'piercing'],
    ['dagger-pistol-melee', 'd4', 'piercing'],
    ['dagger-pistol-ranged', 'd4', 'piercing'],
    ['crescent-cross-melee', 'd4', 'slashing'],
    ['hammer-gun-melee', 'd10', 'bludgeoning'],
    ['hammer-gun-ranged', 'd6', 'piercing'],
    ['donchak', 'd8', 'slashing'],
  ])('%s deals %s %s', (id, die, type) => {
    const w = c().items[id as string];
    expect(w, id as string).toBeTruthy();
    expect(w.damage?.die).toBe(die);
    expect(w.damage?.type).toBe(type);
  });

  it('no combination-weapon half is left on the importer default', () => {
    // Every `-melee` / `-ranged` pair, checked as a set: if a whole family were still bludgeoning it
    // would look plausible one record at a time.
    const halves = Object.entries(c().items).filter(
      ([id, r]) => r?.itemType === 'weapon' && /-(melee|ranged)$/.test(id),
    );
    expect(halves.length).toBeGreaterThan(30);
    const bludgeoning = halves.filter(([, r]) => r.damage?.type === 'bludgeoning').map(([id]) => id);
    // A few genuinely ARE bludgeoning — a hammer gun's melee end is a hammer.
    expect(bludgeoning.length).toBeLessThan(halves.length / 3);
    expect(bludgeoning).toContain('hammer-gun-melee');
  });

  it('reaches the Strikes the sheet rolls', () => {
    const ch = build('fighter', 5, {
      inventory: [{ instanceId: 'w1', itemId: 'dwarven-waraxe', quantity: 1, equipped: true }],
    });
    const strike = deriveStrikes(ch, c()).find((s) => s.name === 'Dwarven Waraxe');
    expect(strike, 'the waraxe is a strike').toBeTruthy();
    expect(strike!.damage).toMatch(/S\b/);
    expect(strike!.damage).not.toMatch(/\bB\b/);
  });
});
