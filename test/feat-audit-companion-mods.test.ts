import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { deriveAnimalCompanion } from '../src/rules/companions';
import { COMPANION_MODS } from '../src/rules/companionGrants';
import type { CompanionConfig } from '../src/rules/types';

/**
 * "Your construct companion becomes an advanced construct companion."
 *
 * Six feats from the full feat audit say exactly that and were judged "needs engine work" — the lane
 * had existed all along as COMPANION_MODS.maturityFloor, which is how Advanced Reanimated Companion
 * and Paragon Companion already work. These pin that the entries reach a real companion block, so
 * they cannot become decorative notes.
 */
const NEW_MODS = [
  'a-miracle-of-science',
  'advanced-construct-companion',
  'battle-hardened-companion',
  'battle-tested-companion',
  'behold-a-pale-horse',
  'behold-my-creation',
] as const;

const cfg = (maturity = 'young'): CompanionConfig =>
  ({ id: 'x', kind: 'animal', name: '', typeId: 'wolf', maturity }) as CompanionConfig;

const derive = (owner: string[], maturity = 'young') => {
  const c = content();
  return deriveAnimalCompanion(cfg(maturity), c.animalCompanions.wolf, 8, c, [], false, [], new Set(owner));
};

describe('feat audit: companion-upgrade feats reach the companion block', () => {
  it('each one is registered with a maturity floor and a note', () => {
    for (const id of NEW_MODS) {
      const mod = COMPANION_MODS[id];
      expect(mod, `${id} is not in COMPANION_MODS`).toBeDefined();
      expect(mod.maturityFloor, `${id} has no maturityFloor`).toBeTruthy();
      expect(mod.note, `${id} carries no note for the card`).toBeTruthy();
      expect(mod.kinds.length).toBeGreaterThan(0);
    }
  });

  it('the floor actually raises a young companion', () => {
    const plain = derive([]);
    for (const id of NEW_MODS) {
      const upgraded = derive([id]);
      // A stat block that changed proves the mod was consumed, not merely stored.
      expect(upgraded.maturity, `${id} left the companion young`).not.toBe(plain.maturity);
      expect(upgraded.hp, id).toBeGreaterThan(plain.hp);
    }
  });

  it('it is a FLOOR — a companion already past it is never pulled back down', () => {
    // Battle-Tested Companion sets 'mature'; a specialized companion must stay specialized.
    const already = derive(['battle-tested-companion'], 'specialized');
    const untouched = derive([], 'specialized');
    expect(already.maturity).toBe(untouched.maturity);
    expect(already.hp).toBe(untouched.hp);
  });

  it('an owner without the feat gets nothing', () => {
    expect(derive([]).maturity).toBe('young');
  });
});
