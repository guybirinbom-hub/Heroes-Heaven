import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { ownedFeatureIds, subclassFeatureIds } from '../src/rules/derive';

/**
 * A subclass that hands over LEVEL-GATED class features.
 *
 * `SubclassOption.featureIds` was built so an oracle mystery could hand over its curse, and it
 * applied with no level check — so it could only ever mean "from the level the subclass is taken".
 * Each gunslinger way hands over three deeds at 1st, 9th and 15th, so writing them with the bare
 * form would have given a 1st-level gunslinger their 15th-level Greater Deed.
 */
const db = content();
const WAYS = db.classes.gunslinger?.subclass?.options ?? [];

const owned = (way: string, level: number) => ownedFeatureIds(build('gunslinger', level, { subclassId: way }), db);

describe('the level gate', () => {
  it('a bare id still means "from when the subclass is taken"', () => {
    expect(subclassFeatureIds(['a', 'b'], 1)).toEqual(['a', 'b']);
  });

  it('a gated one waits for its level', () => {
    const ids = [{ id: 'initial', level: 1 }, { id: 'advanced', level: 9 }, { id: 'greater', level: 15 }];
    expect(subclassFeatureIds(ids, 1)).toEqual(['initial']);
    expect(subclassFeatureIds(ids, 9)).toEqual(['initial', 'advanced']);
    expect(subclassFeatureIds(ids, 15)).toEqual(['initial', 'advanced', 'greater']);
  });

  it('the two forms mix', () => {
    expect(subclassFeatureIds(['curse', { id: 'late', level: 9 }], 1)).toEqual(['curse']);
  });
});

describe('every way hands over its three deeds', () => {
  it('all six ways carry three, at 1st, 9th and 15th', () => {
    expect(WAYS.length).toBe(6);
    for (const w of WAYS) {
      const gated = (w.featureIds ?? []).filter((e): e is { id: string; level: number } => typeof e !== 'string');
      expect(gated.map((e) => e.level), w.id).toEqual([1, 9, 15]);
    }
  });

  it('every deed names a class feature that exists', () => {
    const dead: string[] = [];
    for (const w of WAYS) {
      for (const e of w.featureIds ?? []) {
        const id = typeof e === 'string' ? e : e.id;
        if (!db.classFeatures[id]) dead.push(`${w.id} → ${id}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('no two ways hand over the same deed', () => {
    const all = WAYS.flatMap((w) => (w.featureIds ?? []).map((e) => (typeof e === 'string' ? e : e.id)));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('what a gunslinger actually owns', () => {
  it('at 1st level, only the initial deed', () => {
    const ids = owned('way-of-the-drifter', 1);
    expect(ids.has('into-the-fray')).toBe(true);
    expect(ids.has('finish-the-job'), 'the 9th-level deed must not be owned at 1st').toBe(false);
    expect(ids.has('drifters-wake')).toBe(false);
  });

  it('at 9th, the advanced deed arrives', () => {
    const ids = owned('way-of-the-drifter', 9);
    expect(ids.has('finish-the-job')).toBe(true);
    expect(ids.has('drifters-wake')).toBe(false);
  });

  it('at 15th, all three', () => {
    const ids = owned('way-of-the-drifter', 15);
    for (const d of ['into-the-fray', 'finish-the-job', 'drifters-wake']) expect(ids.has(d), d).toBe(true);
  });

  it('a different way brings different deeds, and none of the first way’s', () => {
    const ids = owned('way-of-the-sniper', 15);
    for (const d of ['one-shot-one-kill', 'vital-shot', 'ghost-shot']) expect(ids.has(d), d).toBe(true);
    expect(ids.has('into-the-fray')).toBe(false);
  });

  it('every way delivers its initial deed at 1st', () => {
    for (const w of WAYS) {
      const first = (w.featureIds ?? []).find((e) => typeof e !== 'string' && e.level === 1) as { id: string };
      expect(owned(w.id, 1).has(first.id), `${w.id} → ${first.id}`).toBe(true);
    }
  });
});

describe("Way of the Spellshot's deeds, which shipped in the wrong collection", () => {
  it('they are class features now, not only actions', () => {
    for (const id of ['energy-shot', 'recall-ammunition', 'dispelling-bullet']) {
      expect(db.classFeatures[id], id).toBeTruthy();
      // Promoted from the shipped action record — same text, so the two must agree.
      expect(db.classFeatures[id].name).toBe(db.actions[id].name);
      expect(db.classFeatures[id].description).toBe(db.actions[id].description);
    }
  });

  it('and a spellshot owns them on the same schedule as every other way', () => {
    expect(owned('way-of-the-spellshot', 1).has('energy-shot')).toBe(true);
    expect(owned('way-of-the-spellshot', 1).has('recall-ammunition')).toBe(false);
    expect(owned('way-of-the-spellshot', 15).has('dispelling-bullet')).toBe(true);
  });
});
