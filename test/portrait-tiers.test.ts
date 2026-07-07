import { describe, it, expect } from 'vitest';
import { setPortrait, type PlayState } from '../src/rules/play';
import { collectPortraitRefs } from '../src/data/portraitStore';

const basePlay = (): PlayState => ({ appearance: {} } as unknown as PlayState);

describe('setPortrait (two-tier portraits)', () => {
  it('stores the compressed portrait plus the sharp-copy ref', () => {
    const p = setPortrait(basePlay(), 'data:compressed', 'p_1');
    expect(p.appearance?.portrait).toBe('data:compressed');
    expect(p.appearance?.portraitRef).toBe('p_1');
  });

  it('omitting the ref clears any previous ref (compressed-only, e.g. the web)', () => {
    const p1 = setPortrait(basePlay(), 'a', 'p_old');
    const p2 = setPortrait(p1, 'b'); // new upload, no sharp copy → no ref
    expect(p2.appearance?.portrait).toBe('b');
    expect(p2.appearance?.portraitRef).toBeUndefined();
  });

  it('clearing (null) removes both the portrait and the ref', () => {
    const p1 = setPortrait(basePlay(), 'a', 'p_1');
    const p2 = setPortrait(p1, null);
    expect(p2.appearance?.portrait).toBeUndefined();
    expect(p2.appearance?.portraitRef).toBeUndefined();
  });
});

describe('collectPortraitRefs', () => {
  it('finds refs across build appearance, the play overlay, and companions', () => {
    const saved = {
      id: 'x',
      character: { appearance: { portrait: 'BIGBASE64', portraitRef: 'p_build' } },
      play: {
        appearance: { portraitRef: 'p_play' },
        companions: [{ id: 'c1', portrait: 'BASE64', portraitRef: 'p_comp1' }, { id: 'c2' }],
      },
    };
    expect(collectPortraitRefs(saved).sort()).toEqual(['p_build', 'p_comp1', 'p_play']);
  });

  it('returns [] with no refs and tolerates non-objects', () => {
    expect(collectPortraitRefs({ a: 1, b: 'str', c: null })).toEqual([]);
    expect(collectPortraitRefs(null)).toEqual([]);
    expect(collectPortraitRefs('str')).toEqual([]);
  });

  it('dedupes a ref that appears more than once', () => {
    expect(collectPortraitRefs({ a: { portraitRef: 'p' }, b: { nested: { portraitRef: 'p' } } })).toEqual(['p']);
  });
});
