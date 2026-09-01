import { describe, it, expect } from 'vitest';
import { content } from './_content';

/*
 * RELIC GIFTS AND THEIR ASPECTS — the join key an import stage dropped.
 *
 * A relic grows by gaining GIFTS, and its ASPECTS (Air, Beast, Fire, Mind…) decide which gifts it may
 * ever take. All 219 relic pages in the AoN mirror carry an aspect; the export carried it on NONE, so
 * the 238 gift items shipped with no way to connect them to any relic.
 *
 * Exactly the shape of the bestiary `family` loss — one load-bearing join key missing from a single
 * stage leaves both sides of a real relationship stranded, and neither side looks broken on its own.
 */
const db = content();

const gifts = Object.entries(db.items).filter(([, r]) => (r as { relicAspects?: string[] }).relicAspects?.length);

describe('every relic gift knows its aspects', () => {
  it('all 238 gift items carry at least one', () => {
    expect(gifts.length).toBe(238);
    for (const [id, r] of gifts) {
      const asp = (r as { relicAspects: string[] }).relicAspects;
      expect(asp.length, `${id} has an empty aspect list`).toBeGreaterThan(0);
      for (const a of asp) expect(typeof a, `${id} aspect must be a string`).toBe('string');
    }
  });

  it('only relic gifts carry the field — it did not leak onto ordinary items', () => {
    for (const [id, r] of gifts) {
      expect(String((r as { aonId?: string }).aonId ?? ''), `${id} is not a relic page`).toMatch(/^relic-\d+$/);
    }
  });
});

describe('what the aspects are FOR', () => {
  it('the aspect vocabulary is a small closed set, as the printed rules define it', () => {
    /*
     * ⚠ AN ASPECT IS NOT A TRAIT. My first version of this test assumed a relic's aspects were its
     * traits and asserted the join that way; it passed for Adamantine Echo only because Earth happens
     * to be both. SIXTEEN of the 21 aspects — Mind, Celestial, Death, Luck, Time, Artistry — are not
     * traits on any relic item, and never will be: in the printed rules a relic's aspects are assigned
     * when the relic is CREATED, which is exactly why relic items carry none.
     *
     * So the aspects on a gift say which relics COULD take it; the relic's own aspect list is a choice
     * that belongs to the character sheet and does not exist yet. Restoring this key is what makes
     * that feature possible — it is the half that was missing from the data, not from the UI.
     */
    const all = new Set<string>();
    for (const [, g] of gifts) for (const a of (g as { relicAspects: string[] }).relicAspects) all.add(a);
    expect(all.size, 'a handful of named aspects, not free text').toBeLessThan(30);
    expect(all.has('Air')).toBe(true);
    expect(all.has('Mind')).toBe(true);
  });

  it('each aspect has enough gifts to be a real choice', () => {
    const byAspect: Record<string, number> = {};
    for (const [, g] of gifts) for (const a of (g as { relicAspects: string[] }).relicAspects) byAspect[a] = (byAspect[a] ?? 0) + 1;
    /* Every aspect the data names offers something; an aspect with one gift would suggest a partial
     * restore rather than a complete one. */
    for (const [a, n] of Object.entries(byAspect)) expect(n, `aspect ${a} has only ${n} gift(s)`).toBeGreaterThan(1);
  });
});
