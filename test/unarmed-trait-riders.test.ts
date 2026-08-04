import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

/**
 * "Your unarmed attacks gain the reach trait."
 *
 * A family of capstone feats CHANGES an unarmed Strike the character already has. `grantedStrikes`
 * creates a new attack and nothing else could express a change to an existing one, so Effortless
 * Reach, Deadly Strikes, Diamond Fists and their kin printed traits nobody ever received.
 *
 * Not covered yet, on purpose: Deadly Aspect and Bestial Brutality say "the unarmed attack you gained
 * from <feat>", which needs a from-feat matcher rather than a name match.
 */
const fist = (ch: Character) => deriveStrikes(ch, content()).find((s) => s.name === 'Fist')!;
const withFeat = (id: string, over = {}) => build('monk', 20, { featPicks: { '20:class': id }, ...over });

describe('unarmed trait riders', () => {
  it('Effortless Reach really puts reach on the Fist', () => {
    expect(fist(withFeat('effortless-reach')).traits).toContain('reach');
    expect(fist(build('monk', 20, {})).traits).not.toContain('reach');
  });

  it('Deadly Strikes adds deadly d10', () => {
    expect(fist(withFeat('deadly-strikes')).traits).toContain('deadly-d10');
  });

  it('a bigger deadly REPLACES a smaller one instead of sitting beside it', () => {
    const db = content();
    const ch = withFeat('deadly-strikes');
    // A natural attack that already carries deadly d6 must come out with d10 only — never both.
    const withNatural: Character = { ...ch, naturalAttacks: [{ name: 'Claw', die: 'd6', damageType: 'slashing', traits: ['unarmed', 'agile', 'deadly-d6'], group: 'brawling' }] };
    const claw = deriveStrikes(withNatural, db).find((s) => s.name === 'Claw')!;
    expect(claw.traits).toContain('deadly-d10');
    expect(claw.traits).not.toContain('deadly-d6');
  });

  it('an already-BIGGER deadly is never downgraded', () => {
    const db = content();
    const ch = withFeat('deadly-strikes');
    const withNatural: Character = { ...ch, naturalAttacks: [{ name: 'Maw', die: 'd8', damageType: 'piercing', traits: ['unarmed', 'deadly-d12'], group: 'brawling' }] };
    const maw = deriveStrikes(withNatural, db).find((s) => s.name === 'Maw')!;
    expect(maw.traits).toContain('deadly-d12');
    expect(maw.traits).not.toContain('deadly-d10');
  });

  it('Diamond Fists steps the die only on an attack that already had one of its traits', () => {
    const db = content();
    const ch = withFeat('diamond-fists');
    const plain = { ...ch, naturalAttacks: [{ name: 'Tail', die: 'd6', damageType: 'bludgeoning', traits: ['unarmed'], group: 'brawling' }] } as Character;
    const already = { ...ch, naturalAttacks: [{ name: 'Tail', die: 'd6', damageType: 'bludgeoning', traits: ['unarmed', 'forceful'], group: 'brawling' }] } as Character;
    const tailOf = (x: Character) => deriveStrikes(x, db).find((s) => s.name === 'Tail')!;
    expect(tailOf(plain).damage).toContain('d6');
    expect(tailOf(already).damage).toContain('d8'); // stepped up because it had forceful
    expect(tailOf(plain).traits).toEqual(expect.arrayContaining(['forceful', 'deadly-d10']));
  });

  it('a NAMED rider only touches the attack it names', () => {
    const db = content();
    const ch = build('monk', 20, { featPicks: { '20:class': 'dogfang-bite' } });
    const withBoth: Character = {
      ...ch,
      naturalAttacks: [
        { name: 'Beak', die: 'd6', damageType: 'piercing', traits: ['unarmed'], group: 'brawling' },
        { name: 'Talon', die: 'd4', damageType: 'slashing', traits: ['unarmed', 'agile'], group: 'brawling' },
      ],
    };
    const strikes = deriveStrikes(withBoth, db);
    expect(strikes.find((s) => s.name === 'Beak')!.traits).toContain('versatile-s');
    expect(strikes.find((s) => s.name === 'Talon')!.traits).not.toContain('versatile-s');
    expect(strikes.find((s) => s.name === 'Fist')!.traits).not.toContain('versatile-s');
  });

  it('a character without any such feat gets a plain Fist', () => {
    const f = fist(build('fighter', 20, {}));
    expect(f.traits).not.toContain('reach');
    expect(f.traits.some((t) => t.startsWith('deadly-'))).toBe(false);
  });

  it('the data carries the riders the engine reads', () => {
    const db = content();
    expect(db.feats['effortless-reach'].unarmedTraits).toEqual({ add: ['reach'] });
    expect(db.feats['demons-hair'].unarmedTraits?.match).toEqual(['hair']);
    expect(db.feats['diamond-fists'].unarmedTraits?.stepDieIfHad).toBe(true);
  });
});
