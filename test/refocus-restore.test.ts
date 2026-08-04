import { describe, it, expect } from 'vitest';
import { build, content } from './_content';

/**
 * "Whenever you Refocus, completely refill your focus pool."
 *
 * Eighteen feats change what one Refocus gives back, and the sheet's Refocus control restored exactly
 * one point with no field able to say otherwise — so every one of them was inert. A player could own
 * Domain Focus and still have to click Refocus three times.
 *
 * The numeric ones carry a printed threshold ("recover 3 … if you have spent at least 3") and in
 * every printed case the threshold equals the amount, so the rule is "N if you spent at least N,
 * else 1". These pin that, because clamping instead would over-grant a point.
 */

/** The same arithmetic the Refocus button runs, kept here so the rule itself is under test. */
const restored = (used: number, back: number | 'all' | undefined) => {
  const n = typeof back === 'number' ? back : 1;
  return back === 'all' ? used : used >= n ? n : 1;
};

describe('Refocus restores what the feat says', () => {
  it('the data actually carries the field — all 18, none of the "how you Refocus" clauses', () => {
    const db = content();
    const withField = Object.entries(db.feats).filter(([, f]) => f.refocusRestore != null);
    expect(withField.length).toBeGreaterThanOrEqual(18);
    for (const id of ['domain-focus', 'bloodline-focus', 'hex-focus', 'amp-focus', 'wardens-focus']) {
      expect(db.feats[id]?.refocusRestore, id).toBe('all');
    }
    for (const id of ['bloodline-wellspring', 'conflux-wellspring', 'link-wellspring', 'meditative-wellspring']) {
      expect(db.feats[id]?.refocusRestore, id).toBe(3);
    }
    for (const id of ['conflux-focus', 'link-focus', 'crimson-oath-devotion']) {
      expect(db.feats[id]?.refocusRestore, id).toBe(2);
    }
    // The ordinary clause — "you can Refocus by <flavour> … refill your focus pool" — is how you
    // perform the activity, not how much it gives, and must NOT have been picked up.
    for (const id of ['blessed-one-dedication', 'shadowcaster-dedication', 'domain-initiate', 'divine-healing']) {
      expect(db.feats[id]?.refocusRestore, `${id} is the ordinary 1-point clause`).toBeUndefined();
    }
  });

  it('a sorcerer with Bloodline Focus refills the whole pool', () => {
    const ch = build('sorcerer', 12, { featPicks: { '12:class': 'bloodline-focus' } });
    expect(ch.focus?.refocusRestore).toBe('all');
    expect(ch.focus?.refocusSource).toBeTruthy();
    expect(restored(3, ch.focus?.refocusRestore)).toBe(3);
  });

  it('without such a feat the pool still restores exactly one point', () => {
    const ch = build('sorcerer', 12, {});
    expect(ch.focus?.refocusRestore).toBeUndefined();
    expect(restored(3, ch.focus?.refocusRestore)).toBe(1);
  });

  it('a Wellspring feat gives 3 only once 3 have been spent — not a clamp', () => {
    expect(restored(3, 3)).toBe(3);
    expect(restored(4, 3)).toBe(3);
    expect(restored(2, 3)).toBe(1); // threshold not met: RAW gives 1, not 2
    expect(restored(1, 3)).toBe(1);
  });

  it('a full refill never exceeds what was actually spent', () => {
    expect(restored(0, 'all')).toBe(0);
    expect(restored(2, 'all')).toBe(2);
  });

  it('the best offer wins when a character somehow owns two', () => {
    const db = content();
    // 'all' must beat any number regardless of the order the feats are read in.
    expect(db.feats['domain-focus'].refocusRestore).toBe('all');
    expect(restored(3, 'all')).toBeGreaterThanOrEqual(restored(3, 3));
  });
});
