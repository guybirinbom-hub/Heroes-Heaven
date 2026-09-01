import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { FEAT_PICK_GRANTS, pickableFeats } from '../src/rules/featPickGrants';

/**
 * Pick-a-feat grants carried by a BACKGROUND or a CLASS FEATURE.
 *
 * This lane was consulted for taken feat ids and `build.heritageId` only, so "one Athletics skill
 * feat of your choice" (Kaiju Stalker) and "a bonus 1st-level barbarian feat" (Fury instinct) were
 * questions nothing read — and, before the picker, questions nothing asked either.
 */
const db = content();

const mk = (over: Partial<BuildState>): BuildState => {
  const b = emptyBuild();
  return {
    ...b,
    name: 'Pick',
    classId: 'fighter',
    level: 5,
    ancestryId: 'human',
    backgroundId: Object.keys(db.backgrounds)[0],
    subclassId: db.classes.fighter.subclass?.options?.[0]?.id ?? null,
    ...over,
  } as BuildState;
};

describe('backgrounds', () => {
  it('Kaiju Stalker offers exactly the Athletics skill feats', () => {
    const spec = FEAT_PICK_GRANTS['kaiju-stalker'];
    expect(spec).toBeTruthy();
    const opts = pickableFeats(spec, mk({ backgroundId: 'kaiju-stalker' }), db).map((f) => f.id);
    expect(opts.length).toBeGreaterThan(3);
    expect(opts).toContain('titan-wrestler');
    // Every offered id must be a real feat — an option that opens nothing is worse than none.
    for (const id of opts) expect(db.feats[id], id).toBeTruthy();
  });

  it('the pick is granted, with the background named as its source', () => {
    const c = buildCharacter(mk({ backgroundId: 'kaiju-stalker', pickFeatChoices: { 'kaiju-stalker': 'titan-wrestler' } }), db);
    const got = c.feats.find((f) => f.featId === 'titan-wrestler');
    expect(got, 'the background pick should be granted').toBeTruthy();
    expect(got!.grantedBy).toBe('kaiju-stalker');
  });

  it('nothing is granted when no answer was given', () => {
    const c = buildCharacter(mk({ backgroundId: 'kaiju-stalker' }), db);
    expect(c.feats.some((f) => f.grantedBy === 'kaiju-stalker')).toBe(false);
  });

  it('an off-list pick is refused', () => {
    const c = buildCharacter(mk({ backgroundId: 'kaiju-stalker', pickFeatChoices: { 'kaiju-stalker': 'power-attack' } }), db);
    expect(c.feats.some((f) => f.featId === 'power-attack')).toBe(false);
  });

  it('the two-option backgrounds offer exactly their two printed feats', () => {
    for (const [bg, ids] of [
      ['professional-letter-writer', ['specialty-crafting', 'multilingual']],
    ] as const) {
      const opts = pickableFeats(FEAT_PICK_GRANTS[bg], mk({ backgroundId: bg }), db).map((f) => f.id);
      expect(new Set(opts), bg).toEqual(new Set(ids));
    }
    // sponsored-by-a-stranger moved OFF this lane in batch 23: its record's own `choice` (flag
    // bgFeat) is the single carrier, like hermean-heritor — a FEAT_PICK_GRANTS row here mounted a
    // SECOND picker for the same feat. The either/or itself is guarded in batch23-parity.test.ts.
    expect(FEAT_PICK_GRANTS['sponsored-by-a-stranger']).toBeUndefined();
    expect(db.backgrounds['sponsored-by-a-stranger'].choice?.options?.map((o) => o.value)).toEqual(['dubious-knowledge', 'quick-identification']);
  });
});

describe('class features', () => {
  it("Fury instinct's bonus feat is a 1st-level barbarian feat", () => {
    const barb = mk({ classId: 'barbarian', level: 5, subclassId: 'fury-instinct' });
    const spec = FEAT_PICK_GRANTS['fury-instinct'];
    expect(spec).toBeTruthy();
    const opts = pickableFeats(spec, barb, db).map((f) => f.id);
    expect(opts.length).toBeGreaterThan(0);
    for (const id of opts) {
      expect(db.feats[id].level, id).toBeLessThanOrEqual(1);
      expect(db.feats[id].traits, id).toContain('barbarian');
    }
  });

  it('a barbarian with Fury instinct actually receives the picked feat', () => {
    const barb = mk({ classId: 'barbarian', level: 5, subclassId: 'fury-instinct' });
    const opts = pickableFeats(FEAT_PICK_GRANTS['fury-instinct'], barb, db).map((f) => f.id);
    const c = buildCharacter({ ...barb, pickFeatChoices: { 'fury-instinct': opts[0] } }, db);
    const got = c.feats.find((f) => f.featId === opts[0]);
    expect(got, 'the instinct pick should be granted').toBeTruthy();
    expect(got!.grantedBy).toBe('fury-instinct');
  });

  it('a barbarian on a DIFFERENT instinct gets nothing from it', () => {
    const other = db.classes.barbarian.subclass?.options?.find((o) => o.id !== 'fury-instinct')?.id;
    if (!other) return;
    const barb = mk({ classId: 'barbarian', level: 5, subclassId: other });
    const c = buildCharacter({ ...barb, pickFeatChoices: { 'fury-instinct': 'sudden-charge' } }, db);
    expect(c.feats.some((f) => f.grantedBy === 'fury-instinct')).toBe(false);
  });
});

describe('the option that the data lost', () => {
  it('Verduran City Folk offers the recovered pick — the warning era is over', () => {
    // The missing name was "Multilingual", eaten by the importer's 12-15-char ID heuristic and
    // restored from the mirror in the residue pass. With both names known, the record graduated
    // from warn-and-grant-the-nameable-half to the hermean-heritor shape: a real sub-choice.
    const bg = db.backgrounds['verduran-city-folk'];
    expect(bg.description).toMatch(/either\s+Multilingual\s+or\s+Streetwise/i);
    expect(bg.dataWarning).toBeUndefined();
    expect(bg.choice?.options?.map((o: { value: string }) => o.value)).toEqual(['streetwise', 'multilingual']);
    /* The batch-19 read caught the pair double-granting: `grantedFeatId: 'streetwise'` fired
     * unconditionally BESIDE the choice, so answering Multilingual granted both feats. The choice is
     * now the single carrier — and the warning-era promise is kept by the choice's own defaulting
     * (Streetwise stays FIRST), asserted here on BUILT characters rather than on the field. */
    expect(bg.grantedFeatId).toBeUndefined();
    expect(FEAT_PICK_GRANTS['verduran-city-folk']).toBeUndefined();
    const names = (b: BuildState) => buildCharacter(b, db).feats.filter((f) => ['streetwise', 'multilingual'].includes(f.featId)).map((f) => f.featId);
    expect(names(mk({ backgroundId: 'verduran-city-folk' })), 'unanswered keeps the warning-era Streetwise').toEqual(['streetwise']);
    expect(
      names(mk({ backgroundId: 'verduran-city-folk', featChoices: { 'background:verduran-city-folk': 'multilingual' } } as Partial<BuildState>)),
      'an answered pick grants ONLY the pick',
    ).toEqual(['multilingual']);
  });
});
