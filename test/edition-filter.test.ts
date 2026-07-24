import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { applyEditionFilter } from '../src/rules/build';

/** The per-character "Hide legacy data" toggle: drops legacy + legacy-era content, keeps remaster/neutral,
 *  never drops already-chosen ids, and is a no-op when off. */
describe('applyEditionFilter (Hide legacy data)', () => {
  const c = content();
  const empty = new Set<string>();
  const isLegacy = (e: { edition?: string }) => e.edition === 'legacy' || e.edition === 'legacy-era';

  it('records carry an edition facet with both legacy and remaster present', () => {
    const feats = Object.values(c.feats);
    expect(feats.some((f) => (f as { edition?: string }).edition === 'remaster')).toBe(true);
    expect(feats.some(isLegacy)).toBe(true);
  });

  it('off keeps legacy content but always hides superseded (renamed) records', () => {
    const off = applyEditionFilter(c, { hideLegacy: false }, empty);
    // a legacy record survives when the toggle is off
    const legacyFeat = Object.values(c.feats).find(isLegacy) as { id: string };
    expect(off.feats[legacyFeat.id]).toBeTruthy();
    // superseded records (e.g. ray-of-frost, replaced by frostbite) are hidden even with the toggle off
    const supersededSpell = Object.entries(c.spells).find(([, s]) => (s as { edition?: string }).edition === 'superseded');
    expect(supersededSpell, 'fixture should contain a superseded record').toBeTruthy();
    expect(off.spells[supersededSpell![0]]).toBeUndefined();
  });

  it('on = every legacy/legacy-era entry is hidden, remaster/neutral kept', () => {
    const filtered = applyEditionFilter(c, { hideLegacy: true }, empty);
    for (const bucket of ['feats', 'spells', 'items', 'actions'] as const) {
      const before = Object.values(c[bucket]).filter(isLegacy).length;
      const after = Object.values(filtered[bucket]).filter(isLegacy).length;
      expect(before, `${bucket} should have legacy content to hide`).toBeGreaterThan(0);
      expect(after, `${bucket} legacy after filter`).toBe(0);
      // remaster/neutral survive
      expect(Object.keys(filtered[bucket]).length).toBeLessThan(Object.keys(c[bucket]).length);
    }
  });

  it('never drops an already-chosen id (keepIds)', () => {
    const legacyFeat = Object.values(c.feats).find(isLegacy) as { id: string };
    expect(legacyFeat).toBeTruthy();
    const filtered = applyEditionFilter(c, { hideLegacy: true }, new Set([legacyFeat.id]));
    expect(filtered.feats[legacyFeat.id]).toBeTruthy();
  });
});
