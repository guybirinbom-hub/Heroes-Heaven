import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { buildCharacter, deriveBuildFromCharacter } from '../src/rules/build';
import { deriveStrikes } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';

const db = content();

/** Build a level-5 fighter holding `featId` in an ancestry-feat slot, with an optional ChoiceSet pick. */
function withFeat(featId: string, choice?: string, over: Partial<BuildState> = {}) {
  return build('fighter', 5, {
    keyAbility: 'str',
    ancestryId: 'lizardfolk',
    featPicks: { '1:ancestry': featId },
    featChoices: choice ? { '1:ancestry': choice } : {},
    ...over,
  });
}

describe('feat/feature-granted strikes appear in Strikes (builder side)', () => {
  it('Iruxi Armaments (fangs) → a Fangs 1d8 P unarmed Strike', () => {
    const ch = withFeat('iruxi-armaments', 'fangs');
    expect(ch.naturalAttacks?.find((n) => n.name === 'Fangs')).toMatchObject({ die: 'd8', damageType: 'piercing' });
    expect(ch.naturalAttacks?.some((n) => n.name === 'Tail')).toBe(false); // the un-chosen option doesn't grant
    const strike = deriveStrikes(ch, db).find((s) => s.name === 'Fangs');
    expect(strike?.damage.startsWith('1d8')).toBe(true);
    expect(strike?.damage).toContain('P');
  });

  it('Iruxi Armaments (tail) → a Tail 1d6 B Strike, not Fangs', () => {
    const ch = withFeat('iruxi-armaments', 'tail');
    expect(ch.naturalAttacks?.some((n) => n.name === 'Tail' && n.die === 'd6' && n.damageType === 'bludgeoning')).toBe(true);
    expect(ch.naturalAttacks?.some((n) => n.name === 'Fangs')).toBe(false);
  });

  it('Iruxi Armaments (claw) → the curated Claw 1d6 S (an ItemAlteration choice, not a Strike rule)', () => {
    const ch = withFeat('iruxi-armaments', 'claw');
    const claw = ch.naturalAttacks?.find((n) => n.name === 'Claw');
    expect(claw).toMatchObject({ die: 'd6', damageType: 'slashing' });
    expect(claw?.traits).toContain('versatile-p');
  });

  it('unconditional heritage grant (Razortooth Goblin → Jaws) needs no choice', () => {
    const ch = build('fighter', 1, { keyAbility: 'str', ancestryId: 'goblin', heritageId: 'razortooth-goblin' });
    expect(ch.naturalAttacks?.some((n) => n.name === 'Jaws' && n.die === 'd6')).toBe(true);
    expect(deriveStrikes(ch, db).some((s) => s.name === 'Jaws')).toBe(true);
  });

  it('round-trips idempotently — the granted attack is re-derived, never double-counted', () => {
    const ch = withFeat('iruxi-armaments', 'fangs');
    const b = deriveBuildFromCharacter(ch, db);
    // a feat-granted attack is NOT persisted into build.naturalAttacks (it's re-derived on rebuild)
    expect(b.naturalAttacks?.some((n) => n.name === 'Fangs') ?? false).toBe(false);
    const ch2 = buildCharacter(b, db);
    expect(ch2.naturalAttacks?.filter((n) => n.name === 'Fangs').length).toBe(1);
  });

  it('a build with no granting feat/heritage has no granted naturals (clean baseline)', () => {
    const ch = build('fighter', 5, { keyAbility: 'str' });
    expect(ch.naturalAttacks ?? []).toEqual([]);
  });
});
