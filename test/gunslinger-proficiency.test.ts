import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

/*
 * §6a gunslinger cluster: the gunslinger advances FIREARMS & CROSSBOWS by category (simple/martial f&c:
 * expert@1 → master@5 → legendary@13; advanced f&c: trained@1 → expert@5 → master@13), while GENERIC weapon
 * categories stay at their L1 ranks (simple/martial trained, advanced untrained, unarmed trained). A single
 * weapon-group rank couldn't express that, so it's modeled via proficiencies.firearmProf.
 */
const c = content();
const rankOf = (level: number, itemId: string): string | undefined => {
  const g = build('gunslinger', level);
  const ch: Character = { ...g, inventory: [...g.inventory, { instanceId: 'w', itemId, quantity: 1, equipped: true }] };
  return deriveStrikes(ch, c).find((s) => s.instanceId === 'w')?.rank;
};

describe('Gunslinger firearms & crossbows proficiency', () => {
  it('simple firearms: expert@1 → master@5 → legendary@13', () => {
    expect(rankOf(1, 'coat-pistol')).toBe('expert');
    expect(rankOf(5, 'coat-pistol')).toBe('master');
    expect(rankOf(13, 'coat-pistol')).toBe('legendary');
  });
  it('martial firearms: expert@1 → master@5 → legendary@13', () => {
    expect(rankOf(1, 'arquebus')).toBe('expert');
    expect(rankOf(13, 'arquebus')).toBe('legendary');
  });
  it('advanced firearms: trained@1 → expert@5 → master@13 (NOT expert@1)', () => {
    expect(rankOf(1, 'dwarven-scattergun')).toBe('trained'); // was wrongly 'expert' before the fix
    expect(rankOf(5, 'dwarven-scattergun')).toBe('expert');
    expect(rankOf(13, 'dwarven-scattergun')).toBe('master');
  });
  it('simple crossbows: expert@1 (was wrongly trained before — no crossbow group modeled)', () => {
    expect(rankOf(1, 'crossbow')).toBe('expert');
    expect(rankOf(5, 'crossbow')).toBe('master');
  });
  it('generic weapons never advance: a dagger stays trained; an advanced non-firearm stays untrained', () => {
    expect(rankOf(1, 'dagger')).toBe('trained');
    expect(rankOf(13, 'dagger')).toBe('trained'); // was wrongly 'legendary' before the fix
  });
});
