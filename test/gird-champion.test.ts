import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { critSpecSources, deriveStrikes } from '../src/rules/derive';

/**
 * Gird Champion ships with `critSpecWeapons: { bases: ['{actor|flags.system.godlingWeapon}'] }` — an
 * UNSUBSTITUTED Foundry template that made the crit specialization impossible to match against any
 * weapon, and its "+1d6 spirit damage with Strikes made with your favored weapon" was not authored at
 * all. The placeholder names the choice flag, so the player's own answer is what belongs in it.
 */
const db = content();
const WEAPON = 'longsword';

const champion = (choice?: string) =>
  build('cleric', 16, {
    featPicks: { '16:class:0': 'gird-champion' },
    ...(choice ? { featChoices: { '16:class:0': choice } } : {}),
    inventory: [{ itemId: WEAPON, quantity: 1, equipped: true }],
  } as never);

describe('Gird Champion — a favored weapon the player names', () => {
  it('the record still carries the placeholder this resolves', () => {
    // If the source data is ever fixed upstream, this test should fail loudly rather than the
    // resolver silently doing nothing.
    expect(db.feats['gird-champion'].critSpecWeapons?.bases).toEqual(['{actor|flags.system.godlingWeapon}']);
    expect(db.feats['gird-champion'].choice?.flag).toBe('godlingWeapon');
  });

  it('unanswered, it narrows to nothing rather than to everything', () => {
    // The dangerous failure is the opposite one: an unresolved placeholder treated as "no restriction"
    // would hand the character crit specialization with EVERY weapon.
    const src = critSpecSources(champion(), db).find((s) => s.weapons?.bases);
    expect(src?.weapons?.bases).toEqual([]);
  });

  it('answered, it narrows to exactly that weapon', () => {
    const src = critSpecSources(champion(WEAPON), db).find((s) => s.weapons?.bases);
    expect(src?.weapons?.bases).toEqual([WEAPON]);
  });

  it('the 1d6 spirit damage rides on the chosen weapon only', () => {
    const strikes = deriveStrikes(champion(WEAPON), db);
    const sword = strikes.find((s) => /longsword/i.test(s.name));
    expect(sword, 'the test weapon is not on the sheet').toBeTruthy();
    expect(sword!.damage).toMatch(/1d6 spirit/i);
  });

  it('…and on nothing else', () => {
    const strikes = deriveStrikes(champion(WEAPON), db);
    for (const s of strikes) {
      if (/longsword/i.test(s.name)) continue;
      expect(s.damage, s.name).not.toMatch(/spirit/i);
    }
    // With no answer, no Strike gains it.
    for (const s of deriveStrikes(champion(), db)) expect(s.damage, s.name).not.toMatch(/1d6 spirit/i);
  });
});
