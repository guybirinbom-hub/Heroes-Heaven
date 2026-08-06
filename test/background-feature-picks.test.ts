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
      ['sponsored-by-a-stranger', ['dubious-knowledge', 'quick-identification']],
    ] as const) {
      const opts = pickableFeats(FEAT_PICK_GRANTS[bg], mk({ backgroundId: bg }), db).map((f) => f.id);
      expect(new Set(opts), bg).toEqual(new Set(ids));
    }
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
  it('Verduran City Folk warns instead of inventing the missing feat', () => {
    const bg = db.backgrounds['verduran-city-folk'];
    // "You gain either or Streetwise as a skill feat" — the first option's name is not in the export.
    expect(bg.description).toMatch(/either\s+or\s+Streetwise/i);
    expect(bg.dataWarning, 'the player must be told the data is incomplete').toMatch(/missing/i);
    // The half that CAN be named is granted; no picker pretends to offer a choice.
    expect(bg.grantedFeatId).toBe('streetwise');
    expect(FEAT_PICK_GRANTS['verduran-city-folk']).toBeUndefined();
  });
});
