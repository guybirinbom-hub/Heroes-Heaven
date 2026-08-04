import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses } from '../src/rules/derive';

/**
 * "You no longer gain silver weakness from Werecreature Dedication."
 *
 * Every defence field ADDS. Nothing could take a weakness away, so Beastkin Resilience — whose whole
 * point is undoing a drawback an earlier feat imposed — left the drawback on the sheet.
 *
 * Sealed Poppet and Insulated Poppet print the same kind of sentence but are NOT wired: the Poppet
 * fire weakness they remove is not in the data to begin with, and inventing a value to then delete
 * would be worse than the gap. That is a separate data gap, not this lane.
 */
const db = content();
const silverOf = (ch: Parameters<typeof deriveDefenses>[0]) =>
  deriveDefenses(ch, db).weaknesses.find((w) => w.type === 'silver');

describe('a feat can remove a weakness an earlier feat gave you', () => {
  it('Werecreature Dedication really imposes silver weakness', () => {
    const ch = build('fighter', 8, { featPicks: { '2:class': 'werecreature-dedication' } });
    expect(silverOf(ch)?.value).toBe(4); // floor(level / 2)
  });

  it('Beastkin Resilience takes it away', () => {
    const ch = build('fighter', 8, {
      featPicks: { '2:class': 'werecreature-dedication', '8:class': 'beastkin-resilience' },
    });
    expect(silverOf(ch)).toBeUndefined();
  });

  it('it removes only the type it names', () => {
    const ch = build('fighter', 8, {
      featPicks: { '2:class': 'werecreature-dedication', '8:class': 'beastkin-resilience' },
    });
    // Whatever else the build carries is untouched — the feat names silver and nothing else.
    const plain = build('fighter', 8, { featPicks: { '2:class': 'werecreature-dedication' } });
    const others = (x: typeof ch) => deriveDefenses(x, db).weaknesses.filter((w) => w.type !== 'silver');
    expect(others(ch)).toEqual(others(plain));
  });

  it('the feat alone removes nothing that was never there', () => {
    const ch = build('fighter', 8, { featPicks: { '8:class': 'beastkin-resilience' } });
    expect(silverOf(ch)).toBeUndefined();
    expect(() => deriveDefenses(ch, db)).not.toThrow();
  });

  it('the data carries the removal', () => {
    expect(db.feats['beastkin-resilience'].removesWeaknesses).toEqual(['silver']);
  });
});
