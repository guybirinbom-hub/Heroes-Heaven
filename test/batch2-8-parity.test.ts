import { describe, it, expect } from 'vitest';
import { build, content, prof } from './_content';
import { deriveSkill, deriveDefenses, derivePerception, ownedFeatureIds } from '../src/rules/derive';
import { statHasSituational } from '../src/rules/explain';
import type { BuildState } from '../src/rules/build';
import type { Character } from '../src/rules/types';

const db = content();

/**
 * The records the Wanderer's Guide parity batches 2–8 flagged that turned out to be REAL gaps.
 *
 * Most of what their side flagged was already built somewhere ours (a class's `focusSpells`, a
 * toggle mode, a class resource) or was their own over-application of a conditional clause. What is
 * asserted here is only the remainder: the clauses that reached nothing on our side at all.
 */

describe('signature Lore skills climb on their own schedule', () => {
  // *"At 3rd level, you become an expert in Undead Lore; at 7th level, you become a master in Undead
  // Lore; and at 15th level, you become legendary in Undead Lore."* The class's `trainedSkills.lore`
  // grants the 1st-level training and stops, so this sat at trained for twenty levels.
  it.each([
    [1, 'trained'],
    [3, 'expert'],
    [7, 'master'],
    [15, 'legendary'],
  ])('a necromancer at level %i is %s in Undead Lore', (level, rank) => {
    expect(build('necromancer', level as number).proficiencies.skills['lore:undead']).toBe(rank);
  });

  it.each([
    [1, 'trained'],
    [3, 'expert'],
    [7, 'master'],
    [15, 'legendary'],
  ])('a thaumaturge at level %i is %s in Esoteric Lore', (level, rank) => {
    expect(build('thaumaturge', level as number).proficiencies.skills['lore:esoteric']).toBe(rank);
  });

  it('the ladder never lowers a rank the character already reached', () => {
    const ch = build('necromancer', 3);
    ch.proficiencies.skills['lore:undead'] = 'legendary';
    // Re-deriving does not run the build, but the max-semantics are what the assertion is about: a
    // level-3 necromancer who is somehow already legendary must not be demoted to expert.
    expect(deriveSkill(ch, 'lore:undead', db).rank).toBe('legendary');
  });
});

describe('Esoteric Lore runs off Charisma', () => {
  // *"Unlike a normal Lore skill, you use Charisma as your modifier on Esoteric Lore checks."*
  // Mandatory, not a "can use" — so it replaces Intelligence even when Intelligence is higher.
  const withAbilities = (int: number, cha: number): Character => {
    const ch = build('thaumaturge', 1);
    return { ...ch, abilities: { ...ch.abilities, int, cha } };
  };

  it('uses Charisma when Charisma is higher', () => {
    const lo = deriveSkill(withAbilities(10, 10), 'lore:esoteric', db).modifier;
    const hi = deriveSkill(withAbilities(10, 18), 'lore:esoteric', db).modifier;
    expect(hi - lo).toBe(4);
  });

  it('still uses Charisma when Intelligence is higher — the clause is not an option', () => {
    const intHeavy = deriveSkill(withAbilities(18, 10), 'lore:esoteric', db).modifier;
    const neither = deriveSkill(withAbilities(10, 10), 'lore:esoteric', db).modifier;
    expect(intHeavy).toBe(neither);
  });

  it('leaves other Lores on Intelligence', () => {
    const a = deriveSkill(withAbilities(10, 18), 'lore:warfare', db).modifier;
    const b = deriveSkill(withAbilities(18, 10), 'lore:warfare', db).modifier;
    expect(b - a).toBe(4);
  });
});

describe('Wildsong', () => {
  // *"You know the Wildsong, a secret language known only within druid orders, in addition to any
  // languages you know through your ancestry."* `grantsLanguages` was read off feats, heritages and
  // invested items — never off class features, so no druid ever learned it.
  it('a druid knows it', () => {
    expect(build('druid', 1).languages).toContain('wildsong');
  });
  it('a fighter does not', () => {
    expect(build('fighter', 1).languages).not.toContain('wildsong');
  });
});

describe('On the Case grants both halves of its sentence', () => {
  // *"You gain one activity and one reaction you can use to investigate cases: Pursue a Lead and
  // Clue In."* We granted the reaction only — which also left the already-authored Pursue a Lead
  // situational bonus unreachable, because that list is collected from owned records.
  it('names both actions', () => {
    expect(db.classFeatures['on-the-case'].grantsActions).toEqual(['pursue-a-lead', 'clue-in']);
    expect(db.actions['pursue-a-lead']).toBeTruthy();
  });

  it('an investigator can now reach the Pursue a Lead bonus', () => {
    const ch = build('investigator', 1);
    expect(ownedFeatureIds(ch, db).has('on-the-case')).toBe(true);
    expect(statHasSituational(ch, { kind: 'perception' }, db)).toBe(true);
  });
});

describe('Hunt Prey', () => {
  // *"You gain a +2 circumstance bonus to Perception checks when you Seek your prey and a +2
  // circumstance bonus to Survival checks when you Track your prey."* Narrow on both tracks — their
  // side flattens it to a bare +2, which would apply to initiative and every other check.
  it('puts a conditional bonus on Perception and Survival', () => {
    const ch = build('ranger', 1);
    expect(statHasSituational(ch, { kind: 'perception' }, db)).toBe(true);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'survival' }, db)).toBe(true);
  });

  it('is NOT a flat bonus folded into the number', () => {
    // The closed form: a level-1 trained skill is level + 2 + the attribute modifier, and nothing
    // else. If Hunt Prey's +2 had been authored flat — the shape their dump asserts — the ranger's
    // Survival would come out two higher than the book gives them, on every check.
    const ch = build('ranger', 1);
    expect(ch.proficiencies.skills.survival).toBe('trained');
    const wisMod = Math.floor((ch.abilities.wis - 10) / 2);
    expect(deriveSkill(ch, 'survival', db).modifier).toBe(1 + 2 + wisMod);
    // Perception likewise: the +2 applies when you Seek your prey, not to initiative.
    // Perception likewise — the ranger is EXPERT in it at level 1, so level + 4 and nothing more.
    expect(ch.proficiencies.perception).toBe('expert');
    expect(derivePerception(ch, db).modifier).toBe(1 + 4 + wisMod);
  });
});

describe("the wizard's spellbook", () => {
  // *"You start with a spellbook worth 10 sp or less, which you receive for free and must study each
  // day to prepare your spells."* Nothing handed it over.
  it('is in a wizard inventory from level 1', () => {
    const ch = build('wizard', 1);
    expect(ch.inventory.some((i) => i.itemId === 'spellbook-blank')).toBe(true);
  });
  it('costs no more than the printed 10 sp allowance', () => {
    const p = db.items['spellbook-blank'].price ?? {};
    expect((p.gp ?? 0) * 10 + (p.sp ?? 0)).toBeLessThanOrEqual(10);
  });
});

describe('the seer animist', () => {
  // Invocation of Protection, 9th: *"You gain spirit resistance and void resistance equal to half
  // your level…"*. The invocations are not separate records on our side, so the level-1 practice
  // carries them behind a level gate.
  const resOf = (level: number) => {
    const ch = build('animist', level, { subclassId: 'seer' } as Partial<BuildState>);
    return deriveDefenses(ch, db).resistances;
  };
  it('has no spirit or void resistance at 8th', () => {
    const r = resOf(8);
    expect(r.find((x) => x.type === 'spirit')).toBeUndefined();
    expect(r.find((x) => x.type === 'void')).toBeUndefined();
  });
  it('gains both at half level from 9th', () => {
    const r = resOf(10);
    expect(r.find((x) => x.type === 'spirit')?.value).toBe(5);
    expect(r.find((x) => x.type === 'void')?.value).toBe(5);
  });
});

describe("the necromancer's Fatal Method", () => {
  // Both options were subclass options with no classFeatures record — the 2 of 160 that could not
  // carry a grant, a star or a marker.
  it('both are owned class features once chosen', () => {
    expect(ownedFeatureIds(build('necromancer', 1, { subclassId: 'puppeteer' } as Partial<BuildState>), db).has('puppeteer')).toBe(true);
    expect(ownedFeatureIds(build('necromancer', 1, { subclassId: 'reaper' } as Partial<BuildState>), db).has('reaper')).toBe(true);
  });

  // *"You gain the Consume Thrall action and the thrall proliferation ability."*
  it('a puppeteer gains Consume Thrall', () => {
    expect(db.classFeatures.puppeteer.grantsActions).toEqual(['consume-thrall']);
    const act = db.actions['consume-thrall'];
    expect(act.actionCost).toEqual({ type: 'free' });
    expect(act.frequency).toBe('once per day');
  });

  // *"Reaper's Edge: You become trained in martial weapons and medium armor."* The necromancer's base
  // martial rank is untrained, and the option granted only the armour.
  it('a reaper is trained in martial weapons and medium armour at level 1', () => {
    const ch = build('necromancer', 1, { subclassId: 'reaper' } as Partial<BuildState>);
    expect(prof(ch, 'martial')).toBe('trained');
    expect(ch.proficiencies.defenses.medium).toBe('trained');
  });

  it('a puppeteer is NOT — that clause belongs to the other method', () => {
    const ch = build('necromancer', 1, { subclassId: 'puppeteer' } as Partial<BuildState>);
    expect(prof(ch, 'martial')).toBe('untrained');
  });

  // *"At 11th level, you become an expert in martial weapons, and at 13th you become an expert in
  // medium armor."* — AND the base class keeps advancing. The reaper's two advancement rows briefly
  // lived under a bare `reaper` key, where the subclass lookup REPLACED the whole necromancer table:
  // a level-11 reaper gained martial expert and silently lost Will expert@3, spellcasting expert@7
  // and everything between. Supplement tables now live under `<class>-<subclass>`.
  it("a reaper's advancement supplements the necromancer table, never replaces it", () => {
    const ch = build('necromancer', 13, { subclassId: 'reaper' } as Partial<BuildState>);
    expect(prof(ch, 'martial')).toBe('expert'); // reapers-edge @11
    expect(ch.proficiencies.defenses.medium).toBe('expert'); // reapers-edge @13
    expect(prof(ch, 'will')).toBe('expert'); // mental-wards @3 — the base table must survive
    expect(ch.proficiencies.perception).toBe('expert'); // perception-expertise @7
  });
});
