import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

/*
 * A SPECIFIC MAGIC WEAPON CARRIES ITS OWN FUNDAMENTAL RUNES.
 *
 * *"This +1 striking longsword has a mirror-like blade…"* — the Cooperative Blade's potency and
 * striking are part of what it IS, not something a player etches, so nothing ever wrote them onto the
 * inventory row and `effectiveWeaponRunes` read that row alone.
 *
 * Measured before the fix: a Cooperative Blade rolled attack 14 for 1d8+2 — byte for byte what a PLAIN
 * longsword rolls — where the book says +1 and 2d8. 262 weapons were in that state.
 */
const db = content();

const strikeWith = (itemId: string, level = 10, runes?: Record<string, unknown>) => {
  const f = build('fighter', level);
  const ch: Character = {
    ...f,
    inventory: [...f.inventory, { instanceId: 'w', itemId, quantity: 1, equipped: true, ...(runes ? { runes } : {}) }],
  } as Character;
  return deriveStrikes(ch, db).find((s) => s.instanceId === 'w')!;
};

describe('specific magic weapons deliver the runes they print', () => {
  it('a +1 striking longsword beats a plain one on BOTH the attack and the dice', () => {
    const plain = strikeWith('longsword');
    const magic = strikeWith('cooperative-blade');
    /* The control matters: without it, a d8 everywhere would look like success. */
    expect(plain.damage).toMatch(/^1d8/);
    expect(magic.damage, 'striking is a second damage die').toMatch(/^2d8/);
    expect(magic.attack![0] - plain.attack![0], '+1 potency').toBe(1);
  });

  it('a +2 striking weapon carries the higher potency', () => {
    expect(strikeWith('dwarven-thrower').attack![0] - strikeWith('longsword').attack![0]).toBe(2);
  });

  it('the property rune between potency and striking does not hide the striking', () => {
    /*
     * Eclipse prints *"This +1 RETURNING striking cold iron starknife"*. Reading only the words
     * immediately after "+1" gave it potency and no striking — a WRONG rune rather than a missing one,
     * which is half its damage dice, silently.
     */
    expect(db.items['eclipse'].builtInRunes).toEqual({ potency: 1, striking: 'striking' });
    expect(strikeWith('eclipse').damage).toMatch(/^2d/);
  });

  it('an etched rune still wins when it is HIGHER — built-in is a floor, not a replacement', () => {
    const floor = strikeWith('cooperative-blade');
    const etched = strikeWith('cooperative-blade', 10, { potency: 3, striking: 'greater' });
    expect(etched.attack![0] - floor.attack![0], 'a +3 etched over a +1 built-in').toBe(2);
    expect(etched.damage, 'greater striking is three dice').toMatch(/^3d8/);
  });

  it('…and the built-in wins when the etched rune is lower or absent', () => {
    const bare = strikeWith('dwarven-thrower');
    const etchedLower = strikeWith('dwarven-thrower', 10, { potency: 1 });
    expect(etchedLower.attack![0], 'the weapon is +2 whatever the row says').toBe(bare.attack![0]);
  });
});
