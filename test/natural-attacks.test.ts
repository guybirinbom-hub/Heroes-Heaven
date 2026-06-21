import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import { buildCharacter, deriveBuildFromCharacter } from '../src/rules/build';
import type { InventoryItem, NaturalAttack } from '../src/rules/types';

const db = content();
const fangs: NaturalAttack = { name: 'Iruxi Fangs', die: 'd8', damageType: 'piercing', traits: ['unarmed'], group: 'brawling' };
const withFangs = (overrides = {}) => ({ ...build('fighter', 5, { keyAbility: 'str', ...overrides }), naturalAttacks: [fangs] });

describe('natural attacks (Iruxi Fangs, claws, …)', () => {
  it('renders as its own unarmed Strike (1d8 P) alongside the Fist', () => {
    const strikes = deriveStrikes(withFangs(), db);
    const fang = strikes.find((s) => /Iruxi Fangs/.test(s.name));
    expect(fang).toBeTruthy();
    expect(fang!.damage.startsWith('1d8')).toBe(true);
    expect(fang!.damage).toContain('P');
    expect(strikes.some((s) => s.instanceId === 'fist')).toBe(true);
  });

  it('handwraps striking scales the natural attack to TWO of ITS OWN die (2d8, not 2d4)', () => {
    const hw = [{ instanceId: 'hw', itemId: 'handwraps-of-mighty-blows', quantity: 1, invested: true, equipped: true, runes: { potency: 1, striking: 'striking' } } as InventoryItem];
    const fang = deriveStrikes(withFangs({ inventory: hw }), db).find((s) => /Iruxi Fangs/.test(s.name))!;
    expect(fang.damage.startsWith('2d8')).toBe(true); // die-size rule, scaled to the d8 fangs
    const baseline = deriveStrikes(withFangs(), db).find((s) => /Iruxi Fangs/.test(s.name))!;
    expect(fang.attack[0] - baseline.attack[0]).toBe(1); // +1 potency from the handwraps
  });

  it('round-trips through the build (survives reopen-for-editing)', () => {
    const b0 = { ...deriveBuildFromCharacter(build('fighter', 5, { keyAbility: 'str' }), db), naturalAttacks: [fangs] };
    const ch = buildCharacter(b0, db);
    expect(ch.naturalAttacks?.[0]?.name).toBe('Iruxi Fangs');
    const rt = deriveBuildFromCharacter(ch, db);
    expect(rt.naturalAttacks?.[0]?.die).toBe('d8');
    expect(buildCharacter(rt, db).naturalAttacks?.[0]?.name).toBe('Iruxi Fangs');
  });
});
