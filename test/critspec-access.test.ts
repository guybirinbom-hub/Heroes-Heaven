import { describe, it, expect } from 'vitest';
import { critSpecSources, strikeShowsCritSpec, type Strike } from '../src/rules/derive';
import type { Character, ContentDatabase } from '../src/rules/types';

// Minimal stubs — these functions only read a few fields.
const CONTENT = {
  classes: {
    fighter: { features: [{ level: 5, featureId: 'fighter-weapon-mastery' }] },
    rogue: { features: [{ level: 5, featureId: 'weapon-tricks' }] },
    cleric: { features: [] },
  },
  classFeatures: {
    // Shaped like the shipped record (package M): the printed master gate is part of the grant.
    'fighter-weapon-mastery': { id: 'fighter-weapon-mastery', critSpec: true, level: 5, critSpecWeapons: { minRank: 'master' } },
    'weapon-tricks': { id: 'weapon-tricks', critSpec: true, level: 5, critSpecWeapons: { traits: ['agile', 'finesse'] } },
    ruffian: { id: 'ruffian', critSpec: true, level: 1 },
    'fourth-doctrine-cloistered-cleric': { id: 'fourth-doctrine-cloistered-cleric', critSpec: true, level: 11 },
  },
  feats: {
    'dwarven-weapon-familiarity': {
      critSpec: true,
      level: 1,
      critSpecLevel: 5,
      critSpecWeapons: { traits: ['dwarf'], bases: ['battle-axe', 'pick', 'warhammer'] },
    },
  },
} as unknown as ContentDatabase;

const char = (p: Partial<Character>): Character => ({ level: 1, feats: [], ...p } as Character);
const strike = (p: Partial<Strike>): Strike =>
  ({ instanceId: 'w', name: 'W', attack: [0], damage: '', traits: [], ranged: false, ...p } as Strike);
const anyAxe = strike({ group: 'axe', base: 'battle-axe', traits: ['dwarf'] });
const longbow = strike({ group: 'bow', base: 'longbow', traits: [], ranged: true });

describe('critical specialization access (predicate-aware)', () => {
  /*
   * package M premise: class-feature-699 "You gain access to the critical specialization effects of all
   * weapons and unarmed attacks for which you have master proficiency."
   *
   * This case used to assert the OPPOSITE — "applies from its level, to every weapon", longbow and axe
   * alike. That was the importer having dropped Foundry's rank gate, written down as the expected
   * behaviour: a 5th-level fighter showed the effect on weapons they are only expert with.
   */
  it('a class grant (Weapon Mastery) applies from its level, to the weapons the fighter is MASTER with', () => {
    const l4 = char({ classId: 'fighter', level: 4 });
    expect(critSpecSources(l4, CONTENT)).toHaveLength(0);
    const l5 = char({ classId: 'fighter', level: 5 });
    const src = critSpecSources(l5, CONTENT);
    expect(src).toHaveLength(1);
    expect(strikeShowsCritSpec({ ...longbow, rank: 'expert' }, src)).toBe(false); // expert: not covered
    expect(strikeShowsCritSpec({ ...anyAxe, rank: 'master' }, src)).toBe(true); // master: covered
    expect(strikeShowsCritSpec({ ...anyAxe, rank: 'legendary' }, src)).toBe(true); // "at least" — legendary too
  });

  it('a self:level-gated feat (Dwarven Weapon Familiarity) waits until level 5 and only its weapons', () => {
    const at1 = char({ feats: [{ featId: 'dwarven-weapon-familiarity', level: 1 } as Character['feats'][number]] });
    expect(critSpecSources(at1, CONTENT)).toHaveLength(0); // critSpecLevel 5 — not yet
    const at5 = char({ level: 5, feats: [{ featId: 'dwarven-weapon-familiarity', level: 1 } as Character['feats'][number]] });
    const src = critSpecSources(at5, CONTENT);
    expect(src).toHaveLength(1);
    expect(strikeShowsCritSpec(anyAxe, src)).toBe(true); // battle-axe base + dwarf trait
    expect(strikeShowsCritSpec(longbow, src)).toBe(false); // not a dwarf weapon
  });

  it("a subclass option's grant (rogue Ruffian) applies from level 1", () => {
    const ruffian = char({ classId: 'rogue', subclassId: 'ruffian', level: 1 });
    const src = critSpecSources(ruffian, CONTENT);
    expect(src.length).toBeGreaterThan(0);
    expect(strikeShowsCritSpec(longbow, src)).toBe(true);
  });

  it('a subclass-suffixed doctrine feature (Cloistered Cleric) is found and level-gated', () => {
    const l7 = char({ classId: 'cleric', subclassId: 'cloistered-cleric', level: 7 });
    expect(critSpecSources(l7, CONTENT)).toHaveLength(0); // doctrine crit-spec at 11
    const l11 = char({ classId: 'cleric', subclassId: 'cloistered-cleric', level: 11 });
    expect(critSpecSources(l11, CONTENT).length).toBeGreaterThan(0);
  });

  it('a melee-only grant never shows on a ranged strike', () => {
    const src: ReturnType<typeof critSpecSources> = [{ level: 1, weapons: { melee: true } }];
    expect(strikeShowsCritSpec(longbow, src)).toBe(false);
    expect(strikeShowsCritSpec(anyAxe, src)).toBe(true);
  });

  it('a caster with no grant shows nothing', () => {
    expect(critSpecSources(char({ classId: 'cleric', level: 5 }), CONTENT)).toHaveLength(0);
  });
});
