import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses, deriveSpeeds, hasHeritage, heritageRecords } from '../src/rules/derive';
import { openChoiceOptions } from '../src/rules/openChoice';

/**
 * "You gain all the mechanical benefits of the <X> heritage you selected at 1st level."
 *
 * Both feats that say this REQUIRE a versatile heritage — which is exactly what the character's one
 * `heritageId` records. So the 1st-level ancestry heritage was never stored anywhere and there was
 * nothing to dereference: the feat could be taken and grant nothing, forever.
 */
const db = content();

const FEATS = { 'late-awakener': 'awakened-animal', 'awakened-yaoguai-heritage': 'yaoguai' } as const;

/** A character who took the feat in slot `1:ancestry` and answered `heritage`. */
const withSecond = (featId: string, heritage: string | null) =>
  build('fighter', 5, {
    featPicks: { '1:ancestry': featId },
    ...(heritage ? { featChoices: { '1:ancestry': heritage } } : {}),
  });

describe('the picker that records the first-level heritage', () => {
  it('both feats ask, and say which ancestry', () => {
    for (const [id, ancestry] of Object.entries(FEATS)) {
      const def = db.feats[id].choice!;
      expect(def.kind, id).toBe('open');
      expect(def.from?.type, id).toBe('heritage');
      expect(def.from?.ancestry, id).toBe(ancestry);
      expect(db.feats[id].secondHeritage, id).toBe(true);
    }
  });

  it('it offers that ancestry’s heritages and no others', () => {
    for (const [id, ancestry] of Object.entries(FEATS)) {
      const opts = openChoiceOptions(db.feats[id].choice!.from, db);
      expect(opts.length, id).toBeGreaterThan(2);
      for (const o of opts) expect(db.heritages[o.id].ancestryId, `${id} → ${o.id}`).toBe(ancestry);
    }
  });

  it('a VERSATILE heritage is never offered — it is what you took instead', () => {
    const opts = openChoiceOptions({ type: 'heritage' }, db);
    expect(opts.filter((o) => db.heritages[o.id].versatile)).toEqual([]);
  });
});

describe('what the answer grants', () => {
  it('the character has both heritages', () => {
    const c = withSecond('late-awakener', 'flying-animal');
    expect(c.secondHeritageId).toBe('flying-animal');
    expect(heritageRecords(c, db).map((h) => h.id)).toContain('flying-animal');
    expect(hasHeritage(c, 'flying-animal')).toBe(true);
  });

  it('with no answer, nothing is granted — no default heritage', () => {
    const c = withSecond('late-awakener', null);
    expect(c.secondHeritageId).toBeUndefined();
    expect(heritageRecords(c, db).some((h) => h.ancestryId === 'awakened-animal')).toBe(false);
  });

  it('an immunity the second heritage carries reaches the sheet', () => {
    // flying-animal carries `immunities`; without the feat the character has none of them.
    const want = db.heritages['flying-animal'].immunities ?? [];
    expect(want.length, 'the fixture heritage must carry immunities').toBeGreaterThan(0);
    const plain = deriveDefenses(build('fighter', 5, {}), db).immunities;
    const with2 = deriveDefenses(withSecond('late-awakener', 'flying-animal'), db).immunities;
    for (const i of want) {
      expect(plain).not.toContain(i);
      expect(with2, i).toContain(i);
    }
  });

  it('a Speed the second heritage grants reaches the sheet', () => {
    // climbing-animal carries `speeds`.
    const speeds = db.heritages['climbing-animal'].speeds ?? {};
    const key = Object.keys(speeds)[0] as 'climb';
    expect(key, 'the fixture heritage must grant a speed').toBeTruthy();
    const plain = deriveSpeeds(build('fighter', 5, {}), db);
    const with2 = deriveSpeeds(withSecond('late-awakener', 'climbing-animal'), db);
    expect(plain[key] ?? 0).toBe(0);
    expect(with2[key] ?? 0).toBeGreaterThan(0);
  });

  it('a land-Speed FLOOR the second heritage sets is honoured', () => {
    const floor = db.heritages['flying-animal'].landSpeedMin;
    expect(floor, 'the fixture heritage must set a floor').toBeTruthy();
    const c = withSecond('late-awakener', 'flying-animal');
    expect(deriveSpeeds(c, db).land ?? 0).toBeGreaterThanOrEqual(floor!);
  });

  it('picking a different heritage grants that one instead', () => {
    const flying = deriveDefenses(withSecond('late-awakener', 'flying-animal'), db).immunities;
    const climbing = deriveDefenses(withSecond('late-awakener', 'climbing-animal'), db).immunities;
    expect(climbing).not.toEqual(flying);
  });

  it('an answer naming the heritage you already have is ignored', () => {
    const c = build('fighter', 5, {
      heritageId: 'climbing-animal',
      featPicks: { '1:ancestry': 'late-awakener' },
      featChoices: { '1:ancestry': 'climbing-animal' },
    });
    expect(c.secondHeritageId, 'a heritage cannot count twice').toBeUndefined();
  });

  it('a character without the feat has exactly one heritage', () => {
    const c = build('fighter', 5, {});
    expect(c.secondHeritageId).toBeUndefined();
    expect(heritageRecords(c, db).length).toBeLessThanOrEqual(1);
  });
});
