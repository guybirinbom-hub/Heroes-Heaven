import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import { classFeatureIdsOwned, ownedFeatureIds } from '../src/rules/derive';

/**
 * A CLASS FEATURE can grant a proficiency, and the table that delivers them was feat-keyed.
 *
 * FEAT_GRANTS is iterated over the character's taken FEATS. 13 entries in featGrantsAuto.ts were
 * authored against class-feature ids and had therefore never once fired — Expert Overdrive
 * ("crafting: expert", an inventor feature at level 3) and Legendary Overdrive (level 15) are the
 * proof, because someone wrote them deliberately and no character ever received them.
 */
const db = content();

/** Registry ids that name a class feature rather than a feat. */
const classFeatureGrants = Object.keys(FEAT_GRANTS).filter((id) => !db.feats[id] && db.classFeatures[id]);

describe('class features deliver their proficiency grants', () => {
  it('the registry really does carry class-feature ids', () => {
    expect(classFeatureGrants.length).toBeGreaterThan(5); // 13 at the time of writing
    expect(classFeatureGrants).toContain('expert-overdrive');
  });

  it('an inventor reaches expert Crafting from Expert Overdrive', () => {
    const at3 = build('inventor', 3, {});
    expect(ownedFeatureIds(at3, db).has('expert-overdrive'), 'the feature is not owned at 3').toBe(true);
    expect(at3.proficiencies.skills.crafting).toBe('expert');
  });

  it('and legendary Crafting from Legendary Overdrive', () => {
    const at15 = build('inventor', 15, {});
    expect(at15.proficiencies.skills.crafting).toBe('legendary');
  });

  it('the grant does not arrive before its level', () => {
    const at1 = build('inventor', 1, {});
    expect(ownedFeatureIds(at1, db).has('expert-overdrive')).toBe(false);
    expect(at1.proficiencies.skills.crafting).not.toBe('expert');
  });

  it('a non-inventor gets nothing from it', () => {
    expect(ownedFeatureIds(build('fighter', 15, {}), db).has('expert-overdrive')).toBe(false);
  });

  it('classFeatureIdsOwned agrees with ownedFeatureIds on the class-feature portion', () => {
    // The two are separate functions because build needs the answer before a Character exists. If
    // they drift, a grant fires in one place and not the other — the bug this whole lane is about.
    for (const [classId, cls] of Object.entries(db.classes)) {
      const sub = cls.subclass?.options[0]?.id;
      const ch = build(classId, 10, sub ? { subclassId: sub } : {});
      const fromBuild = classFeatureIdsOwned({ classId, subclassId: sub, level: 10 }, db);
      const fromDerive = ownedFeatureIds(ch, db);
      const missing = [...fromBuild].filter((id) => !fromDerive.has(id));
      expect(missing, `${classId}: build sees features derive does not`).toEqual([]);
    }
  });
});
