import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { ownedFeatureIds } from '../src/rules/derive';
import { subclassAnchorAt, subclassAnchorLevel } from '../src/rules/build';

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

  /*
   * ⚠ ONE grantedStrike, not "the first of several" — superseded in batch P02 by "every row granted",
   * see grantsEveryStrike below; the history is kept because the ordering trap it records still holds.
   *
   * Both cases below assert that grantedStrikes[0] is a Strike the character HAS, and that only holds
   * when the record grants exactly one. Two subclass options carry the field today:
   * magus/unfurling-brocade grants one (Qi-Infused Fabric) and barbarian/animal-instinct lists 32 —
   * Fist, Jaws, Claw, Horn … — which are ALTERNATIVES gated on which animal the player picks, so its
   * [0] is not "the Strike it grants" and a barbarian who has chosen no animal has none of them.
   *
   * This used to read `grantedStrikes?.length` and pick whichever class came FIRST in core.json's key
   * order. That worked only because magus happened to be key 0. It stopped on 2026-09-23, when the
   * Archives refresh gave the legacy magus and summoner class documents their superseded_by pointers
   * and the two classes moved to the end of the bucket — barbarian was then found first and the case
   * failed on Fist. The order was never the thing being tested; "grants exactly one" is.
   */
  /*
   * batch P02: unfurling-brocade#two-handed-die — "exactly one" stopped being the right predicate when
   * Unfurling Brocade came to grant TWO Strikes (the two-handed d6 grip and the one-handed d4 grip,
   * hybrid-study-8), both always granted. With no subclass left at length 1 both cases below reached
   * `return` and passed having checked nothing. The property is "every row is granted": a subclass
   * whose grantedStrikes carry no `choiceValue` (Animal Instinct's 32 are all gated on the animal), and
   * the cases now FAIL if no such subclass exists instead of returning.
   */
  const grantsEveryStrike = () => Object.values(db.classes)
    .map((c) => ({ cls: c, opt: (c.subclass?.options ?? []).find((o) => {
      const gs = db.classFeatures[o.id]?.grantedStrikes ?? [];
      return gs.length > 0 && gs.every((g) => !g.choiceValue);
    }) }))
    .find((x) => x.opt);

  // batch P02: unfurling-brocade#two-handed-die
  it('a subclass that grants its Strikes actually grants every one (unfurling-brocade today)', () => {
    const granting = grantsEveryStrike();
    // batch P02: unfurling-brocade#two-handed-die
    expect(granting?.opt?.id).toBeTruthy();
    const ch = build(granting!.cls.id, 5, { subclassId: granting!.opt!.id });
    const have = (ch.naturalAttacks ?? []).map((n) => n.name.toLowerCase());
    // batch P02: unfurling-brocade#two-handed-die
    for (const g of db.classFeatures[granting!.opt!.id].grantedStrikes!) expect(have).toContain(g.name.toLowerCase());
  });

  // batch P02: unfurling-brocade#two-handed-die
  it('a granted Strike is not duplicated on a build round-trip (unfurling-brocade today)', () => {
    const granting = grantsEveryStrike();
    // batch P02: unfurling-brocade#two-handed-die
    expect(granting?.opt?.id).toBeTruthy();
    const ch = build(granting!.cls.id, 5, { subclassId: granting!.opt!.id });
    for (const g of db.classFeatures[granting!.opt!.id].grantedStrikes!) {
      const times = (ch.naturalAttacks ?? []).filter((n) => n.name.toLowerCase() === g.name.toLowerCase()).length;
      // batch P02: unfurling-brocade#two-handed-die
      expect(times).toBe(1);
    }
  });
});

/**
 * A SUBCLASS IS CHOSEN ONCE — the picker must not come back at a later level.
 *
 * `subclassAnchorAt` decided which level renders the Doctrine / Bloodline / Innovation card by matching
 * the subclass NAME against each level's feature names, and its fallback branch accepted any feature
 * whose name merely CONTAINED it. PF2e names later features after the choice constantly, so a 3rd-level
 * cleric was shown the Doctrine card again — with a Replace button and its granted Domain Initiate
 * sub-choice — for a decision made at 1st.
 *
 * MEASURED when it was found: 21 spurious pickers across 5 classes. Cleric 6 levels (Second, Third,
 * Fourth, Fifth and Final Doctrine), summoner 8 (Eidolon Symbiosis, Greater Eidolon Specialization, …),
 * inventor 3 (Breakthrough Innovation), witch 2 (Patron's Gift), sorcerer 2 (Bloodline Paragon).
 *
 * The guard is the INVARIANT, not the five names: tightening the string match would have fixed the ones
 * we knew about and left the next one for a player to find. This sweeps every class and every level.
 */
describe('the subclass picker appears at exactly one level', () => {
  const con = content();
  const withSubclass = () => Object.entries(con.classes).filter(([, c]) => !!c?.subclass);

  it('never re-offers a choice the character already made', () => {
    const offenders: string[] = [];
    for (const [id] of withSubclass()) {
      const b = { classId: id, level: 20, featPicks: {} } as unknown as Parameters<typeof subclassAnchorAt>[0];
      const levels: string[] = [];
      for (let lvl = 1; lvl <= 20; lvl++) {
        const a = subclassAnchorAt(b, con, lvl);
        if (a) levels.push(`${lvl}:${a}`);
      }
      if (levels.length !== 1) offenders.push(`${id} offered at ${levels.length} levels — ${levels.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  /* The other half. A guard that only forbids duplicates is satisfied by returning null everywhere,
   * which would hide the picker entirely and leave the class unpickable. */
  it('and every class with a subclass still has one', () => {
    const lost: string[] = [];
    for (const [id] of withSubclass()) {
      const b = { classId: id, level: 20, featPicks: {} } as unknown as Parameters<typeof subclassAnchorAt>[0];
      const lvl = subclassAnchorLevel(b, con);
      if (lvl == null || !subclassAnchorAt(b, con, lvl)) lost.push(id);
    }
    expect(lost).toEqual([]);
    expect(withSubclass().length).toBeGreaterThanOrEqual(18);
  });

  it('and the cleric picks a Doctrine at 1st, not again at 3rd', () => {
    const b = { classId: 'cleric', level: 20, featPicks: {} } as unknown as Parameters<typeof subclassAnchorAt>[0];
    expect(subclassAnchorAt(b, con, 1)).toBe('doctrine');
    for (const lvl of [3, 7, 11, 15, 19]) expect(subclassAnchorAt(b, con, lvl)).toBeNull();
  });
});
