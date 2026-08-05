import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { ownedFeatureIds } from '../src/rules/derive';

/**
 * The subclass you picked is a class feature you own.
 *
 * 159 of the 160 subclass options are also `classFeatures` records — Giant Instinct, Cloistered
 * Cleric, the Bones mystery — and ownedFeatureIds never held them. The `<featureId>-<subclassId>`
 * rule catches VARIANTS of a class feature, not the option itself. So a star, a marker, a resistance
 * or a whileActive authored on the subclass a player actually chose reached nothing at all.
 *
 * Everything downstream of ownedFeatureIds is max- or set-based, and no subclass record carries the
 * one additive field (landSpeedBonus), so owning them cannot double-count.
 */
const db = content();

/** Classes whose subclass options are also classFeatures records. */
const classesWithSubclass = Object.values(db.classes).filter((c) => (c.subclass?.options ?? []).some((o) => db.classFeatures[o.id]));

describe('a chosen subclass is owned', () => {
  it('the corpus really is shaped this way', () => {
    const both = Object.values(db.classes).flatMap((c) => (c.subclass?.options ?? []).filter((o) => db.classFeatures[o.id]));
    expect(both.length).toBeGreaterThan(100); // 159 at the time of writing
  });

  it('picking a subclass owns its record, for every class that has one', () => {
    const missing: string[] = [];
    for (const cls of classesWithSubclass) {
      const opt = cls.subclass!.options.find((o) => db.classFeatures[o.id])!;
      const ch = build(cls.id, 5, { subclassId: opt.id });
      if (!ownedFeatureIds(ch, db).has(opt.id)) missing.push(`${cls.id}/${opt.id}`);
    }
    expect(missing).toEqual([]);
  });

  it('it owns the one you chose and not its siblings', () => {
    const cls = classesWithSubclass.find((c) => c.subclass!.options.filter((o) => db.classFeatures[o.id]).length > 1)!;
    const [first, second] = cls.subclass!.options.filter((o) => db.classFeatures[o.id]);
    const owned = ownedFeatureIds(build(cls.id, 5, { subclassId: first.id }), db);
    expect(owned.has(first.id)).toBe(true);
    expect(owned.has(second.id)).toBe(false);
  });

  it('no subclass record carries the one ADDITIVE field, so owning them cannot double-count', () => {
    // landSpeedBonus is summed across owned features. If a subclass option ever gains one, this test
    // fails and whoever added it has to check the other delivery path first.
    const additive = Object.values(db.classes)
      .flatMap((c) => c.subclass?.options ?? [])
      .filter((o) => db.classFeatures[o.id]?.landSpeedBonus != null)
      .map((o) => o.id);
    expect(additive).toEqual([]);
  });

  it('a subclass that grants a Strike actually grants it', () => {
    const granting = Object.values(db.classes)
      .map((c) => ({ cls: c, opt: (c.subclass?.options ?? []).find((o) => db.classFeatures[o.id]?.grantedStrikes?.length) }))
      .find((x) => x.opt);
    if (!granting?.opt) return; // no subclass grants a Strike; nothing to prove
    const ch = build(granting.cls.id, 5, { subclassId: granting.opt.id });
    const want = db.classFeatures[granting.opt.id].grantedStrikes![0].name.toLowerCase();
    expect((ch.naturalAttacks ?? []).map((n) => n.name.toLowerCase())).toContain(want);
  });

  it('a granted Strike is not duplicated on a build round-trip', () => {
    const granting = Object.values(db.classes)
      .map((c) => ({ cls: c, opt: (c.subclass?.options ?? []).find((o) => db.classFeatures[o.id]?.grantedStrikes?.length) }))
      .find((x) => x.opt);
    if (!granting?.opt) return;
    const ch = build(granting.cls.id, 5, { subclassId: granting.opt.id });
    const want = db.classFeatures[granting.opt.id].grantedStrikes![0].name.toLowerCase();
    const times = (ch.naturalAttacks ?? []).filter((n) => n.name.toLowerCase() === want).length;
    expect(times).toBe(1);
  });
});
