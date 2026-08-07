import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { lookupRef } from '../src/sheet/descref';
import type { DescRef } from '../src/rules/types';

/**
 * Cross-reference resolution, measured against the REAL lookupRef rather than a re-implementation.
 *
 * 507 of 17,989 description refs (2.8%) failed to resolve, and 301 distinct labels were behind them.
 * They were dominated by inflection the slug rule could not reach: "Escaping" for the Escape action,
 * "Requests" for Request, "Concealment" for the concealed condition, "Greater Vitalizing" for the
 * rune whose id ends in the grade, "Cast the Spell" for Cast a Spell. Each renders as an underlined,
 * link-styled term that does nothing when tapped.
 */
describe('description cross-references', () => {
  const c = () => content();

  const measure = () => {
    let total = 0;
    let dead = 0;
    for (const recs of Object.values(c() as unknown as Record<string, Record<string, { descRefs?: DescRef[] }>>)) {
      if (!recs || typeof recs !== 'object') continue;
      for (const rec of Object.values(recs)) {
        for (const ref of rec?.descRefs ?? []) {
          total++;
          if (!lookupRef(c(), ref)) dead++;
        }
      }
    }
    return { total, dead };
  };

  it('resolves at least 98.5% of them', () => {
    const { total, dead } = measure();
    expect(total).toBeGreaterThan(17000);
    // Was 507 (2.82%). The remainder are legacy spell names the Remaster retired (Dimension Door,
    // Floating Disk) and a handful of item labels with no matching record — nothing an inflection
    // rule can reach, and they render inert rather than as dead links.
    expect(dead / total).toBeLessThan(0.015);
  });

  it('resolves the inflected forms that were the bulk of the misses', () => {
    const cases: [DescRef, string][] = [
      [{ key: 'actions', label: 'Escaping' }, 'Escape'],
      [{ key: 'actions', label: 'Requests' }, 'Request'],
      [{ key: 'actions', label: 'Avoiding Notice' }, 'Avoid Notice'],
      [{ key: 'actions', label: 'Cast the Spell' }, 'Cast a Spell'],
      [{ key: 'conditions', label: 'Concealment' }, 'Concealed'],
    ];
    for (const [ref, expected] of cases) {
      const node = lookupRef(c(), ref);
      expect(node, `${ref.key}|${ref.label}`).toBeTruthy();
      expect(node!.title.toLowerCase()).toBe(expected.toLowerCase());
    }
  });

  it('never resolves a label to the wrong record', () => {
    // The fallbacks are tried in order, so an exact name always wins over a de-inflected guess.
    expect(lookupRef(c(), { key: 'actions', label: 'Seek' })!.title).toBe('Seek');
    expect(lookupRef(c(), { key: 'conditions', label: 'Prone' })!.title).toBe('Prone');
  });
});
