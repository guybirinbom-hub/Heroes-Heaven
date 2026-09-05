import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { additionalClassSkills, buildCharacter, innovationType, inventorModificationOptions, setupMissing, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveClassDc, profBonus, abilityModOf } from '../src/rules/derive';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { dailyChoiceKey, dailyChoicesFor } from '../src/rules/dailyChoices';

const db = content();

/**
 * Wanderer's-Guide parity batch 28 — the ORCHESTRATOR's pass: the cross-file gaps the four agents left
 * (each named in their DATA STILL NEEDED / CROSS-FILE GAPS lists). Every assertion is on a BUILT
 * character, against the SHIPPED rows.
 */
const stripOption = (classId: string, optionId: string, field: string) => {
  const cls = db.classes[classId];
  return {
    ...db,
    classes: {
      ...db.classes,
      [classId]: { ...cls, subclass: { ...cls.subclass!, options: cls.subclass!.options.map((o) => (o.id === optionId ? { ...o, [field]: undefined } : o)) } },
    },
  } as typeof db;
};

describe('batch 28 — a subclass option can take a class skill AWAY (ranger Vindicator)', () => {
  /* class-5 initial proficiencies: "Trained in Nature and Survival"; the Vindicator hunter's edge
   * (Player Core 2): "trained in Religion INSTEAD OF Nature". `grants.skills` added Religion beside
   * Nature until `grants.removesSkills` got a reader. */
  it('a vindicator is trained in Religion and not in Nature; a flurry ranger keeps Nature', () => {
    const vindicator = build('ranger', 1, { subclassId: 'vindicator' });
    expect(vindicator.proficiencies.skills.religion).toBe('trained');
    expect(vindicator.proficiencies.skills.nature ?? 'untrained').toBe('untrained');
    const flurry = build('ranger', 1, { subclassId: 'flurry' });
    expect(flurry.proficiencies.skills.nature).toBe('trained');
    // the negative control: with the field stripped the vindicator is back to both
    const stripped = stripOption('ranger', 'vindicator', 'grants');
    const both = buildCharacter(
      { ...emptyBuild(), name: 't', level: 1, classId: 'ranger', keyAbility: 'dex', ancestryId: 'human', backgroundId: 'acrobat', subclassId: 'vindicator' } as BuildState,
      stripped,
    );
    expect(both.proficiencies.skills.nature).toBe('trained');
  });
});

describe('batch 28 — Bloodrager (archetype-283): 2 + Int skills and the required dedication', () => {
  const bloodrager = (level: number, over: Partial<BuildState> = {}) =>
    ({ ...emptyBuild(), name: 't', level, classId: 'barbarian', keyAbility: 'str', ancestryId: 'human', backgroundId: 'acrobat', subclassId: 'bloodrager', ...over }) as BuildState;

  it('"a number of additional skills equal to 2 plus your Intelligence modifier, instead of your normal starting skill proficiencies"', () => {
    const fury = { ...bloodrager(1), subclassId: 'fury' } as BuildState;
    expect(additionalClassSkills(bloodrager(1), db)).toBe(additionalClassSkills(fury, db) - 1);
    expect(db.classes.barbarian.subclass!.options.find((o) => o.id === 'bloodrager')?.additionalSkills).toBe(2);
  });

  it('"You must select Bloodrager Dedication as your 2nd-level class feat" is outstanding setup from level 2 until it is taken', () => {
    expect(setupMissing(bloodrager(1), db).some((s) => s.includes('Bloodrager Dedication'))).toBe(false);
    expect(setupMissing(bloodrager(2), db).some((s) => s.includes('Bloodrager Dedication'))).toBe(true);
    expect(setupMissing(bloodrager(2, { featPicks: { '2:class': 'bloodrager-dedication' } }), db).some((s) => s.includes('Bloodrager Dedication'))).toBe(false);
  });
});

describe('batch 28 — Way of the Spellshot (archetype-122): Intelligence for the CLASS DC only', () => {
  it('the class DC uses Int while the key attribute stays the gunslinger\'s', () => {
    const c = build('gunslinger', 3, { subclassId: 'way-of-the-spellshot' });
    expect(c.classDcKeyAbility).toBe('int');
    expect(c.keyAbility).not.toBe('int');
    const dc = deriveClassDc(c);
    expect(dc.modifier).toBe(profBonus(c.proficiencies.classDc, c.level) + abilityModOf(c, 'int'));
    const drifter = build('gunslinger', 3, { subclassId: 'way-of-the-drifter' });
    expect(drifter.classDcKeyAbility).toBeUndefined();
  });
});

describe('batch 28 — the witch\'s patron teaches the familiar a spell (class-9, patron-N)', () => {
  const witchBook = (over: Partial<BuildState>) => {
    const c = build('witch', 1, { subclassId: 'baba-yaga', ...over });
    const entry = (c.spellcasting ?? []).find((e) => e.type === 'prepared' && e.spellbook);
    return entry?.spellbook?.[1] ?? [];
  };

  it('Baba Yaga\'s chilling spray is in the familiar\'s spellbook without the player learning it', () => {
    expect(witchBook({})).toContain('chilling-spray');
  });

  it('an "or" patron teaches the ONE spell the player chose (Ripple in the Deep: dizzying colors or grease)', () => {
    const grease = witchBook({ subclassId: 'ripple-in-the-deep', subclassSpellChoice: { 'ripple-in-the-deep': 'grease' } });
    expect(grease).toContain('grease');
    expect(grease).not.toContain('dizzying-colors');
    const none = witchBook({ subclassId: 'ripple-in-the-deep' });
    expect(none).not.toContain('grease');
    expect(none).not.toContain('dizzying-colors');
    // an answer that is not one of the option's own choices grants nothing
    const rogue = witchBook({ subclassId: 'ripple-in-the-deep', subclassSpellChoice: { 'ripple-in-the-deep': 'fireball' } });
    expect(rogue).not.toContain('fireball');
  });
});

describe('batch 28 — the Light Mortar Innovation (archetype-329, Munitions Master)', () => {
  it('has its own three tiers of modifications', () => {
    expect(innovationType('light-mortar-innovation')).toBe('light-mortar');
    const initial = inventorModificationOptions(db, 'light-mortar', undefined, 1).map((f) => f.id);
    expect(initial.sort()).toEqual(['contained-shrapnel', 'enhanced-shrapnel', 'spring-loaded']);
    const breakthrough = inventorModificationOptions(db, 'light-mortar', undefined, 7).map((f) => f.id);
    expect(breakthrough).toContain('narrow-blast');
    expect(breakthrough).not.toContain('precise-blast');
    expect(inventorModificationOptions(db, 'light-mortar', undefined, 15).map((f) => f.id)).toContain('precise-blast');
    // the weapon innovation does not see them
    expect(inventorModificationOptions(db, 'weapon', undefined, 15).map((f) => f.id)).not.toContain('narrow-blast');
  });

  it('"Inventive Expertise (7th) … instead of 9th" and "Inventive Mastery (15th) … instead of 17th"', () => {
    expect(build('inventor', 7, { subclassId: 'light-mortar-innovation' }).proficiencies.classDc).toBe('expert');
    expect(build('inventor', 7, { subclassId: 'weapon-innovation' }).proficiencies.classDc).toBe('trained');
    expect(build('inventor', 15, { subclassId: 'light-mortar-innovation' }).proficiencies.classDc).toBe('master');
    expect(build('inventor', 15, { subclassId: 'weapon-innovation' }).proficiencies.classDc).toBe('expert');
  });

  it('"You must select Munitions Master Dedication as your 2nd-level class feat" is outstanding setup', () => {
    const b = { ...emptyBuild(), name: 't', level: 2, classId: 'inventor', keyAbility: 'int', ancestryId: 'human', backgroundId: 'acrobat', subclassId: 'light-mortar-innovation' } as BuildState;
    expect(setupMissing(b, db).some((s) => s.includes('Munitions Master Dedication'))).toBe(true);
  });
});

describe('batch 28 — Experimental Spellshaping\'s daily spellshape feat (class-39, from 4th level)', () => {
  const wizard = (level: number) => build('wizard', level, { extraChoices: { thesis: ['experimental-spellshaping'] }, pickFeatChoices: { 'experimental-spellshaping': 'widen-spell' } });
  const key = dailyChoiceKey('experimental-spellshaping', 'dailySpellshape');

  it('is asked at daily preparations from 4th level, capped at half your level', () => {
    const c4 = wizard(4);
    const choice = dailyChoicesFor(c4, db).find((d) => d.recordId === 'experimental-spellshaping');
    expect(choice).toBeTruthy();
    expect(choice!.options.some((o) => o.value === 'reach-spell')).toBe(true); // level 1
    expect(choice!.options.every((o) => (db.feats[o.value]?.level ?? 99) <= 2)).toBe(true);
    // "a spellshape wizard feat of your choice that you don't already have" — the thesis's own pick is not offered
    expect(choice!.options.some((o) => o.value === 'widen-spell')).toBe(false);
    expect(dailyChoicesFor(wizard(3), db).some((d) => d.recordId === 'experimental-spellshaping')).toBe(false);
  });

  it('the morning\'s answer is a real feat for the day, and a feat already owned is not doubled', () => {
    const c = wizard(4);
    expect(c.feats.some((f) => f.featId === 'reach-spell')).toBe(false);
    const play = { ...initialPlay(c, db), dailyChoices: { [key]: 'reach-spell' } };
    const day = applyPlayState(c, play, db);
    const daily = day.feats.filter((f) => f.featId === 'reach-spell');
    expect(daily).toHaveLength(1);
    expect(daily[0].grantedBy).toBe('daily-preparations');
    // widen-spell is the thesis's permanent pick: answering it again adds nothing
    const dup = applyPlayState(c, { ...initialPlay(c, db), dailyChoices: { [key]: 'widen-spell' } }, db);
    expect(dup.feats.filter((f) => f.featId === 'widen-spell')).toHaveLength(1);
  });
});

describe('batch 28 — the kineticist\'s wood skill junction pins Terrain Expertise to forest (class-63)', () => {
  it('the granted feat arrives with its terrain answered', () => {
    const lvl = db.classes.kineticist.features.find((f) => f.featureId === 'gates-threshold')?.level ?? 5;
    const c = build('kineticist', lvl, {
      extraChoices: { element: ['wood-gate'] },
      effectChoices: { 'gates-threshold:gate-junction': 'wood-skill-junction' },
    });
    const te = c.feats.find((f) => f.featId === 'terrain-expertise');
    expect(te, 'the junction grants Terrain Expertise').toBeTruthy();
    expect(te?.choice?.value).toBe('forest');
  });
});
