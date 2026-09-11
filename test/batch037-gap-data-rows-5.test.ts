import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses, ownedFeatureIds } from '../src/rules/derive';
import { applyPlayState, emptyPlay } from '../src/rules/play';
import { emptyBuild, levelChoices } from '../src/rules/build';
import { FEAT_CANTRIP_GRANTS } from '../src/rules/featCantripGrants';
import type { Character, ContentDatabase, FeatChoiceDef } from '../src/rules/types';

/**
 * Batch 037, the GAP lane for data-rows-5: the seven CROSS-FILE fixes the data chunk could not make,
 * plus the two guardians-armor rows that only become live once one of them lands.
 *
 * Every readers-side fix here is CODE, so these assertions hold the moment the change lands — they do
 * not wait on the driver. Where a fix needs a row that has NOT been applied yet (the guardian's
 * automatic resistance, versatile-mutation's 8th-level gate), the test patches that one field into an
 * in-memory copy of the content and asserts that the READER honours it. That is deliberate: a
 * patched-vs-shipped delta would flip meaning the day the row is applied, whereas "the reader obeys
 * this field" stays true either way.
 */
const db = content();

/** A content copy with one feat's `choice` replaced. Never mutates the shared cache. */
const withChoice = (featId: string, choice: FeatChoiceDef): ContentDatabase =>
  ({ ...db, feats: { ...db.feats, [featId]: { ...db.feats[featId], choice } } }) as ContentDatabase;

/** A character who owns `featId`, whatever their class — these are ancestry feats and the engine
 *  reads `c.feats`, not the slot they were picked into. */
const owning = (featId: string, level: number): Character => {
  const c = build('fighter', level, {});
  return { ...c, feats: [...c.feats, { featId }] } as Character;
};

/** The innate entry applyPlayState leaves on the sheet. */
const innateOf = (c: Character, answers: Record<string, string>, content2: ContentDatabase) =>
  applyPlayState(c, { ...emptyPlay(), dailyChoices: answers }, content2).spellcasting.find((e) => e.id === 'innate-casting');

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * 1. src/rules/featCantripGrants.ts — the build-time duplicate of the five daily pickers.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

describe('kitsune-spell-familiarity and its siblings ask their question in one lane only', () => {
  /* feat-2619: "During your daily preparations, choose daze, forbidding ward, or ghost sound."
   * The record's own `choice` is the daily lane; FEAT_CANTRIP_GRANTS is the build-time one, and it
   * asked the same question again at character creation. */

  // batch 037: kitsune-spell-familiarity#daily-control
  it('kitsune-spell-familiarity, -mysteries and -expertise carry no build-time cantrip pick', () => {
    for (const id of ['kitsune-spell-familiarity', 'kitsune-spell-mysteries', 'kitsune-spell-expertise']) {
      expect(FEAT_CANTRIP_GRANTS[id], `${id} must ask only at daily preparations`).toBeUndefined();
      // …and the daily lane really is where the question lives now.
      expect(db.feats[id]!.choice?.daily, `${id} keeps its daily control`).toBe(true);
    }
  });

  // batch 037: nagaji-spell-mysteries#daily-control
  it('nagaji-spell-mysteries and nagaji-spell-expertise carry no build-time cantrip pick either', () => {
    for (const id of ['nagaji-spell-mysteries', 'nagaji-spell-expertise']) {
      expect(FEAT_CANTRIP_GRANTS[id], `${id} must ask only at daily preparations`).toBeUndefined();
      expect(db.feats[id]!.choice?.daily, `${id} keeps its daily control`).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * 2-4. src/rules/play.ts — the daily-grant merge threw away the grant's rank, its cantrips and its
 * tradition. Each test patches the grant onto a content copy, because the rows that carry it are the
 * data chunk's and have not been applied; what is being proven is that play.ts READS the field.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

describe('kitsune-spell-familiarity reaches the sheet as an at-will cantrip', () => {
  /* feat-2619: "…you can cast the chosen spell as a divine innate cantrip." A cantrip resolves to
   * rank 0, and the merge used to drop every rank-0 grant before it could be filed. */

  // batch 037: kitsune-spell-familiarity#daily-control
  it("kitsune-spell-familiarity's chosen cantrip is filed as a cantrip, not dropped", () => {
    const patched = withChoice('kitsune-spell-familiarity', {
      ...db.feats['kitsune-spell-familiarity']!.choice!,
      options: [{ value: 'daze', label: 'Daze', grant: { innateSpells: [{ spellId: 'daze', tradition: 'divine', atWill: true }] } }],
    } as FeatChoiceDef);
    const entry = innateOf(owning('kitsune-spell-familiarity', 5), { 'kitsune-spell-familiarity:kitsuneFamiliaritySpell': 'daze' }, patched);
    expect(db.spells['daze']!.rank ?? 0, 'Daze really is a cantrip').toBe(0);
    expect(entry?.cantrips).toContain('daze');
    // …and it is NOT filed as a ranked spell, which is the other way a cantrip can go wrong.
    expect(Object.values(entry?.repertoire ?? {}).flat()).not.toContain('daze');
  });
});

describe('kitsune-spell-expertise casts at the rank its own grant names', () => {
  /* feat-2629: "You can cast this as a 5TH-RANK divine innate spell once that day." Confusion's own
   * record is rank 4, so filing the spell at the SPELL's rank loses the whole clause. */

  // batch 037: kitsune-spell-expertise#daily-control
  it("kitsune-spell-expertise files Confusion at 5th rank, not Confusion's own 4th", () => {
    const patched = withChoice('kitsune-spell-expertise', {
      ...db.feats['kitsune-spell-expertise']!.choice!,
      options: [
        { value: 'confusion', label: 'Confusion', grant: { innateSpells: [{ spellId: 'confusion', tradition: 'divine', rank: 5, usesPerDay: 1 }] } },
      ],
    } as FeatChoiceDef);
    expect(db.spells['confusion']!.rank, "the fixture only means something while Confusion's base rank is 4").toBe(4);
    const entry = innateOf(owning('kitsune-spell-expertise', 13), { 'kitsune-spell-expertise:kitsuneExpertiseSpell': 'confusion' }, patched);
    expect(entry?.repertoire?.[5] ?? []).toContain('confusion');
    expect(entry?.repertoire?.[4] ?? []).not.toContain('confusion');
  });
});

describe('kitsune-spell-mysteries keeps its printed tradition and names its own source', () => {
  /* feat-2624: "You can cast this as a 1st-level DIVINE innate spell once that day." The entry's
   * header tradition is a vote of whatever caster the character already is — arcane for a fighter —
   * and every daily casting was labelled "Borrowed today", which is Loaner Spell's sentence. */

  // batch 037: kitsune-spell-mysteries#daily-control
  it("kitsune-spell-mysteries' Bane is divine, and credited to the feat rather than borrowed", () => {
    const patched = withChoice('kitsune-spell-mysteries', {
      ...db.feats['kitsune-spell-mysteries']!.choice!,
      options: [{ value: 'bane', label: 'Bane', grant: { innateSpells: [{ spellId: 'bane', tradition: 'divine', rank: 1, usesPerDay: 1 }] } }],
    } as FeatChoiceDef);
    const entry = innateOf(owning('kitsune-spell-mysteries', 5), { 'kitsune-spell-mysteries:kitsuneMysteriesSpell': 'bane' }, patched);
    expect(entry?.repertoire?.[1] ?? []).toContain('bane');
    expect(entry?.spellTraditions?.['bane']).toBe('divine');
    expect(entry?.spellSources?.['bane']).toBe(db.feats['kitsune-spell-mysteries']!.name);
    expect(entry?.spellSources?.['bane']).not.toBe('Borrowed today');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * 5. src/rules/types.ts + src/rules/derive.ts — the armour gate on an IWR entry.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

describe('guardians-armor resists physical damage only while the armour is on', () => {
  /* class-feature-1115: "While wearing medium or heavy armor, you gain resistance to physical damage
   * equal to 1 + half your level." The row that carries this is
   * work/.b037-rows-gap-data-rows-5.json; it is patched in here so the assertion is about the READER,
   * which is the half that did not exist. */
  const gated = (extra: Record<string, unknown>): ContentDatabase =>
    ({
      ...db,
      classFeatures: { ...db.classFeatures, 'guardians-armor': { ...db.classFeatures['guardians-armor'], ...extra } },
    }) as ContentDatabase;
  const RES = { resistances: [{ type: 'physical', value: '1+floor(@actor.level/2)', whenArmorCategory: ['medium', 'heavy'] }] };
  const guardian = (inventory: unknown[]) => build('guardian', 6, { inventory } as never);
  const amount = (rows: { type: string; value: number }[], type: string) => rows.find((r) => r.type === type)?.value;

  // batch 037: guardians-armor#automatic-resistance
  it('guardians-armor gives a guardian in a breastplate physical 4 at 6th level', () => {
    const c = guardian([{ itemId: 'breastplate', quantity: 1, worn: true }]);
    expect([...ownedFeatureIds(c, db)], 'the fixture must actually own the feature').toContain('guardians-armor');
    expect(amount(deriveDefenses(c, gated(RES)).resistances, 'physical')).toBe(4);
  });

  // batch 037: guardians-armor#automatic-resistance
  it('guardians-armor gives an unarmoured guardian nothing', () => {
    const c = guardian([]);
    expect(amount(deriveDefenses(c, gated(RES)).resistances, 'physical')).toBeUndefined();
  });

  // batch 037: guardians-armor#automatic-resistance
  it('the guardians-armor gate is honoured on weaknesses too, not only resistances', () => {
    // The weakness loop shares IwrEntry with the resistance loop. Honouring a gate on one of them is
    // how a field becomes silently write-only for the other half — the warning that loop already
    // carries about minLevel and whenCreatureTrait.
    const WEAK = { weaknesses: [{ type: 'fire', value: 5, whenArmorCategory: ['heavy'] }] };
    expect(amount(deriveDefenses(guardian([{ itemId: 'breastplate', quantity: 1, worn: true }]), gated(WEAK)).weaknesses, 'fire')).toBeUndefined();
    expect(amount(deriveDefenses(guardian([{ itemId: 'full-plate', quantity: 1, worn: true }]), gated(WEAK)).weaknesses, 'fire')).toBe(5);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * 6. src/rules/build.ts + src/builder/Builder.tsx — a build-time choice that starts at a level.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

describe('versatile-mutation is not an outstanding answer before 8th level', () => {
  /* feat-5454: "AT 8TH LEVEL, choose one of the following: acid, cold, electricity, fire, or sonic
   * damage." `FeatChoiceDef.minLevel` was read only on the daily path, so a 4th-level ostilli carried
   * a permanent "1 choice left" tag that no control on the page could clear. */
  const gatedContent = withChoice('versatile-mutation', { ...db.feats['versatile-mutation']!.choice!, minLevel: 8 } as FeatChoiceDef);
  /* The stunted copy. The row has landed, so the shipped record now carries `minLevel: 8` and `db`
   * is no longer the ungated half of the pair — it is built by deleting the field instead. */
  const ungatedContent = withChoice('versatile-mutation', (({ minLevel: _drop, ...rest }) => rest)(db.feats['versatile-mutation']!.choice! as FeatChoiceDef & { minLevel?: number }) as FeatChoiceDef);
  const at = (level: number) => ({ ...emptyBuild(), name: 't', level, classId: 'fighter', featPicks: { '4:class': 'versatile-mutation' } });
  const asked = (level: number, c: ContentDatabase) =>
    levelChoices(at(level) as never, c).some((m) => /versatile mutation/i.test(m.label));

  // batch 037: versatile-mutation#energy-level
  it('versatile-mutation is counted at 8th level and not at 4th', () => {
    expect(asked(4, gatedContent), 'a 4th-level ostilli is not asked yet').toBe(false);
    expect(asked(8, gatedContent), 'an 8th-level one is').toBe(true);
    // …and the gate is the FIELD, not the record: with no minLevel the question is counted at 4.
    expect(asked(4, ungatedContent), 'an ungated choice is still counted from the level it was taken').toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * 7. src/rules/featGrants.ts + src/rules/build.ts — the conditional expert step.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

describe('arcana-of-iron reaches expert only when the class grants weapon expertise', () => {
  /* feat-7980: "You become trained in advanced weapons. If you gain the weapon expertise class
   * feature, your proficiency in martial and advanced weapons increases to expert." The wizard's
   * weapon expertise is at 11th level; their side encodes a flat character level 13, which is right
   * for no class. */
  const wiz = (level: number) => build('wizard', level, { featPicks: { '6:class': 'arcana-of-iron' } });

  // batch 037: arcana-of-iron#weapon-proficiency
  it('arcana-of-iron trains a 6th-level wizard in advanced weapons and stops there', () => {
    const c = wiz(6);
    expect(c.proficiencies.attacks.advanced).toBe('trained');
    expect(c.proficiencies.attacks.martial).not.toBe('expert');
  });

  // batch 037: arcana-of-iron#weapon-proficiency
  it("arcana-of-iron raises martial and advanced to expert at the wizard's own weapon-expertise level", () => {
    const c = wiz(11);
    expect(c.proficiencies.attacks.advanced).toBe('expert');
    expect(c.proficiencies.attacks.martial).toBe('expert');
    // …and it is the FEAT doing it: a wizard without it stays where the class table left them.
    const without = build('wizard', 11, {});
    expect(without.proficiencies.attacks.advanced).toBe('untrained');
  });
});
