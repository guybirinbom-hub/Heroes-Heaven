import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveSkill, ownedFeatureIds, skillSubstitutions } from '../src/rules/derive';
import { statHasSituational } from '../src/rules/explain';

/**
 * "You can use X instead of Y."
 *
 * A substitution swaps WHICH skill you roll, so it is not a bonus and could not be written as one —
 * 35 records carrying one did nothing, and Chirurgeon's record shipped a `dataWarning` saying so.
 *
 * The distinction that decides the whole design: an UNCONDITIONAL substitution is the number you
 * roll, so it belongs on the sheet. A CONDITIONAL one is not — Natural Medicine's own text says it
 * "doesn't replace Medicine for uses of the skill other than Treat Wounds or for feat prerequisites"
 * — so putting its number on Medicine would be a lie.
 */
const db = content();

const chirurgeon = (over: Record<string, unknown> = {}) =>
  build('alchemist', 5, { subclassId: 'chirurgeon', classSkills: ['crafting'], ...over });

describe('an unconditional substitution moves the number', () => {
  it('Chirurgeon is the one that reads that way', () => {
    const s = db.classFeatures.chirurgeon.skillSubstitutions;
    expect(s).toEqual([{ use: 'crafting', forSkill: 'medicine' }]);
    expect(s![0].when, 'no condition — "anything that requires a proficiency rank in Medicine"').toBeUndefined();
  });

  it('Medicine shows the Crafting number, and says where it came from', () => {
    const c = chirurgeon();
    const raw = deriveSkill(c, 'medicine', db, true);
    const shown = deriveSkill(c, 'medicine', db);
    expect(raw.rank).toBe('untrained');
    expect(shown.modifier).toBe(deriveSkill(c, 'crafting', db).modifier);
    expect(shown.substitutedFrom).toEqual({ skill: 'crafting', source: 'Chirurgeon' });
  });

  it('and only when it is HIGHER — a better Medicine keeps its own number', () => {
    const c = chirurgeon({ classSkills: ['medicine'], skillIncreases: { 3: 'medicine', 5: 'medicine' } });
    const med = deriveSkill(c, 'medicine', db);
    const cra = deriveSkill(c, 'crafting', db);
    if (med.modifier > cra.modifier) expect(med.substitutedFrom).toBeUndefined();
  });

  it('a different research field gets nothing', () => {
    const b = build('alchemist', 5, { subclassId: 'bomber', classSkills: ['crafting'] });
    expect(deriveSkill(b, 'medicine', db).substitutedFrom).toBeUndefined();
  });

  it('it does not leak into the skill it substitutes FROM', () => {
    expect(deriveSkill(chirurgeon(), 'crafting', db).substitutedFrom).toBeUndefined();
  });
});

describe('a conditional substitution does NOT move the number', () => {
  const withFeat = (featId: string) => {
    const c = build('druid', 5, {});
    return { ...c, feats: [...c.feats, { featId, level: 1, slot: 'x' }] } as typeof c;
  };

  it('Natural Medicine is conditional, and says on what', () => {
    const s = db.feats['natural-medicine'].skillSubstitutions![0];
    expect(s.use).toBe('nature');
    expect(s.forSkill).toBe('medicine');
    expect(s.when).toMatch(/Treat Wounds/i);
  });

  it("Medicine keeps its own number — the feat's text forbids replacing it", () => {
    const c = withFeat('natural-medicine');
    expect(deriveSkill(c, 'medicine', db).substitutedFrom).toBeUndefined();
  });

  it('but the player is told it exists — the skill is flagged situational', () => {
    const plain = build('druid', 5, {});
    const c = withFeat('natural-medicine');
    expect(statHasSituational(plain, { kind: 'skill', skill: 'medicine' }, db)).toBe(false);
    expect(statHasSituational(c, { kind: 'skill', skill: 'medicine' }, db)).toBe(true);
  });

  it('every shipped substitution is either conditional or Chirurgeon', () => {
    // A substitution with no condition silently raises a skill everywhere, so the apply script
    // refuses to write one it could not read a condition for.
    const bad: string[] = [];
    for (const coll of ['feats', 'classFeatures', 'heritages'] as const) {
      for (const [id, r] of Object.entries(db[coll])) {
        for (const s of (r as { skillSubstitutions?: { when?: string }[] }).skillSubstitutions ?? []) {
          if (!s.when && id !== 'chirurgeon') bad.push(`${coll}/${id}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('none of them names the same skill twice', () => {
    for (const s of Object.values(db.feats).flatMap((f) => f.skillSubstitutions ?? [])) {
      expect(s.use, JSON.stringify(s)).not.toBe(s.forSkill);
    }
  });
});

describe('where a substitution can come from', () => {
  it('a worn item counts, an unworn one does not', () => {
    const item = Object.entries(db.items).find(([, i]) => i.passiveEffects?.skillSubstitutions?.length);
    if (!item) return;
    const [itemId] = item;
    const c = build('fighter', 5, {});
    const worn = { ...c, inventory: [{ instanceId: 'a', itemId, quantity: 1, worn: true, equipped: true, invested: true }] } as typeof c;
    const bagged = { ...c, inventory: [{ instanceId: 'a', itemId, quantity: 1, worn: false, equipped: false, invested: false }] } as typeof c;
    expect(skillSubstitutions(worn, db).length).toBeGreaterThan(0);
    expect(skillSubstitutions(bagged, db)).toEqual([]);
  });

  it('a character with none has none', () => {
    expect(skillSubstitutions(build('fighter', 5, {}), db)).toEqual([]);
  });
});

/**
 * "You gain the Sneak Attack class feature." A record handing over a CLASS FEATURE rather than a
 * feat. `grantsFeats` could not express it and nothing else wrote into ownedFeatureIds, so 14
 * records said this and delivered none of it.
 */
describe('a record can grant a class feature', () => {
  it('Investigator Dedication grants On the Case', () => {
    expect(ownedFeatureIds(build('fighter', 4, {}), db).has('on-the-case')).toBe(false);
    expect(ownedFeatureIds(build('fighter', 4, { featPicks: { '2:class': 'investigator-dedication' } }), db).has('on-the-case')).toBe(true);
  });

  it('Sneak Attacker grants Sneak Attack', () => {
    expect(ownedFeatureIds(build('fighter', 6, { featPicks: { '2:class': 'sneak-attacker' } }), db).has('sneak-attack')).toBe(true);
  });

  /*
   * ⚠ This used to assert that a 3rd-level WARPRIEST owns Divine Defense, and that was pinning a
   * defect. Divine Defense is a 13th-level cleric class feature the class table already grants every
   * cleric; the warpriest doctrine only riders on it — *"At 13th level, if you gain the Divine
   * Defense class feature, you also gain expert proficiency in light and medium armor."* Four cleric
   * records had read that sentence as a grant, so a 1st-level warpriest's sheet listed a 13th-level
   * feature. The grants are gone; the level gate is asserted in `answered-pickers.test.ts`.
   *
   * The lane itself is real and still covered — by a record that genuinely does hand one over.
   */
  it('a CLASS FEATURE can grant one too — the exemplar’s Divine Spark grants Shift Immanence', () => {
    expect(ownedFeatureIds(build('exemplar', 3, {}), db).has('divine-spark-and-ikons')).toBe(true);
    expect(ownedFeatureIds(build('exemplar', 3, {}), db).has('shift-immanence')).toBe(true);
    expect(ownedFeatureIds(build('fighter', 3, {}), db).has('shift-immanence')).toBe(false);
  });

  it('every id named is a real class feature', () => {
    const dead: string[] = [];
    for (const coll of ['feats', 'classFeatures', 'heritages'] as const) {
      for (const [id, r] of Object.entries(db[coll])) {
        for (const t of (r as { grantsClassFeatures?: string[] }).grantsClassFeatures ?? []) {
          if (!db.classFeatures[t]) dead.push(`${coll}/${id} -> ${t}`);
        }
      }
    }
    expect(dead).toEqual([]);
  });

  it('nothing grants itself', () => {
    for (const coll of ['feats', 'classFeatures', 'heritages'] as const) {
      for (const [id, r] of Object.entries(db[coll])) {
        expect((r as { grantsClassFeatures?: string[] }).grantsClassFeatures ?? [], id).not.toContain(id);
      }
    }
  });
});
