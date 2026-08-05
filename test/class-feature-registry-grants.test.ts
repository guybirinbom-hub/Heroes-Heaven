import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { FEAT_FEAT_GRANTS } from '../src/rules/featFeatGrants';

/**
 * The hand-authored FEAT_FEAT_GRANTS registry, seeded from taken feats alone.
 *
 * Distinct from `classFeatures[id].grantsFeats` (the record field, covered by
 * class-feature-feat-grants.test.ts): this is the REGISTRY, and its closure queue only ever held
 * feats. 19 of its entries are keyed to class-feature ids — Alchemy grants Alchemical Crafting,
 * Esoteric Lore grants Dubious Knowledge, Battledancer grants Fascinating Performance — so not one of
 * them had ever fired, despite someone deliberately writing them.
 */
const db = content();
const classFeatureSources = Object.keys(FEAT_FEAT_GRANTS).filter((id) => !db.feats[id] && db.classFeatures[id]);

/** The class and level at which a class feature is granted automatically, if any. */
function grantedBy(featureId: string): { classId: string; level: number } | null {
  for (const [classId, cls] of Object.entries(db.classes)) {
    const f = (cls.features ?? []).find((x) => x.featureId === featureId);
    if (f) return { classId, level: f.level };
  }
  return null;
}

describe('the feat-grant REGISTRY reaches class features', () => {
  it('it really does carry class-feature ids', () => {
    expect(classFeatureSources.length).toBeGreaterThan(10); // 19 at the time of writing
  });

  it('an auto-granted feature hands over its feat', () => {
    const checked: string[] = [];
    for (const id of classFeatureSources) {
      const where = grantedBy(id);
      if (!where) continue; // a subclass option — the next test covers those
      const wanted = FEAT_FEAT_GRANTS[id].filter((f) => db.feats[f]);
      if (!wanted.length) continue;
      const ch = build(where.classId, Math.max(where.level, 1), {});
      const have = new Set(ch.feats.map((f) => f.featId));
      for (const w of wanted) expect(have.has(w), `${where.classId} ${id} did not grant ${w}`).toBe(true);
      checked.push(id);
    }
    expect(checked.length, 'no auto-granted feature was exercised').toBeGreaterThan(0);
  });

  it('a chosen SUBCLASS hands over its feat too', () => {
    const sub = classFeatureSources
      .map((id) => {
        for (const [classId, cls] of Object.entries(db.classes)) {
          if ((cls.subclass?.options ?? []).some((o) => o.id === id)) return { id, classId };
        }
        return null;
      })
      .find((x) => x && FEAT_FEAT_GRANTS[x.id].some((f) => db.feats[f]));
    expect(sub, 'no subclass option grants a feat through this registry').toBeTruthy();
    const ch = build(sub!.classId, 5, { subclassId: sub!.id });
    const have = new Set(ch.feats.map((f) => f.featId));
    for (const w of FEAT_FEAT_GRANTS[sub!.id].filter((f) => db.feats[f])) {
      expect(have.has(w), `${sub!.id} did not grant ${w}`).toBe(true);
    }
  });

  it('a character of another class receives none of it', () => {
    const have = new Set(build('fighter', 10, {}).feats.map((f) => f.featId));
    expect(have.has('alchemical-crafting'), 'a fighter got the alchemist Alchemy grant').toBe(false);
  });

  it('a granted feat is tagged with the feature that granted it', () => {
    const where = grantedBy('alchemy');
    if (!where) return;
    const ch = build(where.classId, 5, {});
    expect(ch.feats.find((f) => f.featId === 'alchemical-crafting')?.grantedBy).toBe('alchemy');
  });
});
