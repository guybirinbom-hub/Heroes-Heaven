import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { FEAT_FEAT_GRANTS } from '../src/rules/featFeatGrants';
import type { ContentDatabase } from '../src/rules/types';

/**
 * Print batch P02, gap lane for data-rows-1: Aloof Firmament's Cat Fall had TWO carriers.
 *
 * AoN hybrid-study-7 prints "You gain the Cat Fall general feat". The magus subclass option carries
 * it as `grantedFeats: ['cat-fall']`, and src/rules/featFeatGrants.ts also listed
 * `'aloof-firmament': ['cat-fall']` in the auto FEAT_FEAT_GRANTS table - a row no reader acted on,
 * because the option grant loop in build.ts runs first and puts Cat Fall into takenFeats. The row is
 * gone; the option is the one carrier. These tests pin both halves: the registry holds no such key,
 * and a magus still gets Cat Fall exactly once, from the option and from nothing else.
 */
const db = content();

type Option = { id: string; grantedFeats?: string[] };
/** `db` with the Aloof Firmament option's grantedFeats stripped, in memory only. */
const withoutOptionGrant = (): ContentDatabase => {
  const magus = db.classes['magus']!;
  const options = (magus.subclass!.options as unknown as Option[]).map((o) => {
    if (o.id !== 'aloof-firmament') return o;
    const copy = { ...o };
    delete copy.grantedFeats;
    return copy;
  });
  return {
    ...db,
    classes: { ...db.classes, magus: { ...magus, subclass: { ...magus.subclass!, options } } },
  } as unknown as ContentDatabase;
};
const catFalls = (feats: { featId: string }[]) => feats.filter((f) => f.featId === 'cat-fall').length;

describe('aloof-firmament: Cat Fall rides one carrier, the subclass option', () => {
  // batch P02: aloof-firmament#cat-fall-duplicate
  it('aloof-firmament: FEAT_FEAT_GRANTS no longer carries the duplicate row', () => {
    // batch P02: aloof-firmament#cat-fall-duplicate
    expect(Object.prototype.hasOwnProperty.call(FEAT_FEAT_GRANTS, 'aloof-firmament')).toBe(false);
  });

  // batch P02: aloof-firmament#cat-fall-duplicate
  it('aloof-firmament: a built magus still owns Cat Fall exactly once', () => {
    const ch = build('magus', 1, { subclassId: 'aloof-firmament' });
    // batch P02: aloof-firmament#cat-fall-duplicate
    expect(catFalls(ch.feats)).toBe(1);
  });

  // batch P02: aloof-firmament#cat-fall-duplicate
  it('aloof-firmament: with the option grant stripped, nothing else hands over Cat Fall', () => {
    const con = withoutOptionGrant();
    const ch = buildCharacter(
      {
        ...emptyBuild(),
        name: 't',
        level: 1,
        classId: 'magus',
        ancestryId: Object.keys(db.ancestries)[0],
        backgroundId: Object.keys(db.backgrounds)[0],
        keyAbility: null,
        subclassId: 'aloof-firmament',
      },
      con,
    );
    // batch P02: aloof-firmament#cat-fall-duplicate
    expect(catFalls(ch.feats)).toBe(0);
  });
});
