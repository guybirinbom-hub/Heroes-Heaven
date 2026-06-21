import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrike } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

// Regression for the audit finding: thrown weapons (javelin) were treated as projectiles —
// using Dex and adding no attribute to damage — and propulsive weapons (sling) added no Str.
const c = content();
function striker(str: number, dex: number): Character {
  const ch = build('fighter', 1);
  return { ...ch, abilities: { ...ch.abilities, str, dex } };
}
const strike = (itemId: string, ch: Character) =>
  deriveStrike(ch, c, { instanceId: 'x', itemId, quantity: 1, equipped: true });

const hiStr = striker(18, 10); // Str +4, Dex +0
const hiDex = striker(10, 18); // Str +0, Dex +4

describe('thrown / propulsive / projectile weapon math', () => {
  it('a thrown weapon (javelin) uses Strength for the attack roll', () => {
    expect(strike('javelin', hiStr)!.attack[0]).toBeGreaterThan(strike('javelin', hiDex)!.attack[0]);
  });
  it('a thrown weapon adds full Strength to damage', () => {
    expect(strike('javelin', hiStr)!.damage).toContain('+4');
  });
  it('a true projectile (shortbow) uses Dexterity and adds no attribute to damage', () => {
    expect(strike('shortbow', hiDex)!.attack[0]).toBeGreaterThan(strike('shortbow', hiStr)!.attack[0]);
    expect(strike('shortbow', hiStr)!.damage).not.toMatch(/[+-]\d/);
  });
  it('a propulsive weapon (sling) adds half Strength to damage', () => {
    expect(strike('sling', hiStr)!.damage).toContain('+2'); // floor(4 / 2)
  });
});
