import { describe, it, expect } from 'vitest';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild } from '../src/rules/build';
import { deriveStrikes } from '../src/rules/derive';
import { content } from './_content';
import type { BuildState } from '../src/rules/build';

/*
 * bug 2026-09-15: duplicate natural attack
 *
 * The owner's lizardfolk guardian showed TWO fangs — "Iruxi Fangs" and "Fangs", identical (d8 piercing,
 * brawling, the same crit line). His save carries `naturalAttacks: [{ name: 'Iruxi Fangs', … }]` from an
 * older version, while Iruxi Armaments now grants "Fangs" for the same `fangs` choice. The merge
 * deduplicated by NAME only, so both survived; the round-trip likewise subtracted granted attacks by
 * name and kept the stored one forever.
 *
 * Mutation proof (run once, restored): `sameNaturalAttack` reduced to the name comparison alone fails
 * "the stored copy yields to the grant" (expected [ 'Iruxi Fangs', 'Fangs' ] to deeply equal [ 'Fangs' ])
 * and "the round-trip lets the stored copy go" (expected [ { name: 'Iruxi Fangs', …(4) } ] to be
 * undefined); the other two legs stay green under the mutation, which is what they are there for.
 */

const db = content();

const lizardfolk = (): BuildState => ({
  ...emptyBuild(),
  name: 'Lizardfolk guardian fixture',
  level: 1,
  ancestryId: 'lizardfolk',
  heritageId: 'frilled-lizardfolk',
  classId: 'guardian',
  featPicks: { '1:ancestry:0': 'iruxi-armaments' },
  featChoices: { '1:ancestry:0': 'fangs' },
  naturalAttacks: [{ name: 'Iruxi Fangs', die: 'd8', damageType: 'piercing', traits: ['unarmed'], group: 'brawling' }],
});

const fangsOf = (b: BuildState) =>
  deriveStrikes(buildCharacter(b, db), db).filter((s) => /fangs/i.test(s.name)).map((s) => s.name);

describe('a stored natural attack and the grant that re-states it are one attack', () => {
  // bug 2026-09-15: duplicate natural attack
  it('the stored copy yields to the grant: one Fangs, not two', () => {
    expect(fangsOf(lizardfolk())).toEqual(['Fangs']);
  });

  // bug 2026-09-15: duplicate natural attack
  it('the round-trip lets the stored copy go, so it cannot come back', () => {
    const b = deriveBuildFromCharacter(buildCharacter(lizardfolk(), db), db);
    expect(b.naturalAttacks).toBeUndefined();
    expect(fangsOf(b)).toEqual(['Fangs']);
  });

  // bug 2026-09-15: duplicate natural attack
  it('a genuinely different stored attack is kept beside the grant', () => {
    const b: BuildState = {
      ...lizardfolk(),
      naturalAttacks: [{ name: 'Horn', die: 'd6', damageType: 'piercing', traits: ['unarmed'], group: 'brawling' }],
    };
    const names = deriveStrikes(buildCharacter(b, db), db).map((s) => s.name);
    expect(names).toContain('Fangs');
    expect(names).toContain('Horn');
    expect(deriveBuildFromCharacter(buildCharacter(b, db), db).naturalAttacks?.map((n) => n.name)).toEqual(['Horn']);
  });

  // bug 2026-09-15: duplicate natural attack
  it('without the feat, the stored attack is the only Fangs and is kept', () => {
    const b: BuildState = { ...lizardfolk(), featPicks: {}, featChoices: {} };
    expect(fangsOf(b)).toEqual(['Iruxi Fangs']);
    expect(deriveBuildFromCharacter(buildCharacter(b, db), db).naturalAttacks?.map((n) => n.name)).toEqual(['Iruxi Fangs']);
  });
});
