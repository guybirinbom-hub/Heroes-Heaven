import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

/**
 * The three property runes the rune-damage work deliberately held back, because each needs a shape
 * `{dice, die, type}` could not express: damage that is PERSISTENT on an ordinary hit, and damage
 * that changes size against a particular kind of target.
 */
const db = content();

const armed = (rune: string): Character =>
  build('fighter', 10, {
    inventory: [{ itemId: 'longsword', quantity: 1, equipped: true, runes: { potency: 1, property: [rune] } }],
  } as never);

const swordDamage = (rune: string) => deriveStrikes(armed(rune), db).find((s) => /longsword/i.test(s.name))!.damage;

describe('wounding — persistent on every hit, not on a crit', () => {
  it('says persistent, so it cannot be read as ordinary damage', () => {
    // "When you hit a creature with a wounding weapon, you deal an extra 1d6 persistent bleed damage."
    const d = swordDamage('wounding');
    expect(d).toMatch(/1d6 persistent bleed/i);
  });

  it('and is NOT filed under the crit-only riders', () => {
    // flaming's 1d10 is critPersistent and belongs in the "(plus … on a crit)" tail; wounding's does
    // not, and putting it there would tell the player it only lands on a 20.
    expect(db.runes['wounding'].damage?.critPersistent).toBeUndefined();
    expect(db.runes['wounding'].damage?.persistent).toBe(true);
    expect(swordDamage('wounding')).not.toMatch(/on a crit/i);
  });
});

describe('holy and unholy — a bigger die pool against the opposed target', () => {
  it('shows the base and the conditional, because nothing here knows what is being hit', () => {
    // "…deal an extra 1d4 spirit damage, or an extra 2d4 against an unholy target."
    expect(swordDamage('holy')).toMatch(/1d4 spirit \(2d4 vs unholy\)/i);
    expect(swordDamage('unholy')).toMatch(/1d4 spirit \(2d4 vs holy\)/i);
  });

  it('the conditional is never silently folded into the base', () => {
    // Writing 2d4 as the base would over-report damage against every ordinary creature.
    for (const r of ['holy', 'unholy']) {
      expect(db.runes[r].damage?.dice).toBe(1);
      expect(db.runes[r].damage?.vs?.dice).toBe(2);
      expect(swordDamage(r)).not.toMatch(/^\D*2d4 spirit/);
    }
  });
});

describe('the runes that already worked still do', () => {
  it('flaming keeps its crit-only persistent tail', () => {
    const d = swordDamage('flaming');
    expect(d).toMatch(/1d6 fire/i);
    expect(d).toMatch(/on a crit/i);
    expect(d).not.toMatch(/persistent fire.*plus/i);
  });
});
