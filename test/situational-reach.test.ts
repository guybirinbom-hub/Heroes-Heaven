import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { statHasSituational } from '../src/rules/explain';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import type { Character } from '../src/rules/types';

const c = content();

/**
 * THE REACH BUG. The user reported that Fort/Reflex/skills never mention situational bonuses. The
 * DISPLAY was fine — the lookup was not: it read FEATS ONLY (characterFeatIds), so of the 2,355
 * records that grant a conditional typed bonus, the 1,550 ITEMS, 77 heritages, 36 backgrounds and 90
 * class features could never raise a star no matter how complete the data became.
 *
 * The lookup now spans every source a bonus can come from. An ITEM counts only while it is actually
 * equipped/worn/invested — a bonus from a shield in your backpack is not a bonus you have.
 */
describe('situational bonuses reach beyond feats', () => {
  /** A registry id that targets `kind`, so the test keys off real shipped data, not a fixture.
   *  The registry shape is `targets: [{ kind, detail }]` — `detail` carries the skill/save name. */
  const idTargeting = (kind: string) =>
    Object.entries(FEAT_SITUATIONAL).find(([, list]) => list.some((b) => b.targets.some((t) => t.kind === kind)))?.[0];

  const withItem = (base: Character, itemId: string, inUse: boolean): Character => ({
    ...base,
    inventory: [{ instanceId: 'i1', itemId, quantity: 1, ...(inUse ? { invested: true } : {}) }],
  });

  it('an EQUIPPED item with a situational bonus marks the stat', () => {
    const id = idTargeting('perception');
    expect(id, 'registry should contain a perception bonus').toBeTruthy();
    const base = build('fighter', 5);
    // The registry is keyed by record id regardless of collection, so an item id resolves the same
    // way a feat id does — that is exactly what the reach fix enables.
    expect(statHasSituational(withItem(base, id!, true), { kind: 'perception' }, c)).toBe(true);
  });

  it('the SAME item carried but not in use does NOT mark it', () => {
    const id = idTargeting('perception');
    const base = build('fighter', 5);
    expect(statHasSituational(withItem(base, id!, false), { kind: 'perception' }, c)).toBe(false);
  });

  it('heritage and background ids are consulted, not just feats', () => {
    const id = idTargeting('save');
    expect(id).toBeTruthy();
    const base = build('fighter', 5);
    const target = FEAT_SITUATIONAL[id!].flatMap((b) => b.targets).find((t) => t.kind === 'save')!;
    // `detail` is the save name, or 'all' for any save.
    const ref = { kind: 'save', save: target.detail === 'all' ? 'fortitude' : target.detail } as const;
    expect(statHasSituational({ ...base, heritageId: id! }, ref, c)).toBe(true);
    expect(statHasSituational({ ...base, backgroundId: id! }, ref, c)).toBe(true);
  });

  it('a character with none of them is still unmarked (no false stars)', () => {
    const base = build('fighter', 5);
    const clean: Character = { ...base, feats: [], inventory: [], heritageId: null, backgroundId: null, ancestryId: null };
    // Every stat kind must stay quiet — a star that is always on is as useless as one that never is.
    expect(statHasSituational(clean, { kind: 'perception' }, c)).toBe(false);
    expect(statHasSituational(clean, { kind: 'ac' }, c)).toBe(false);
  });

  it('works without a content database (callers outside a ContentContext)', () => {
    const id = idTargeting('perception');
    const base = build('fighter', 5);
    // db is optional: everything except class features still resolves.
    expect(statHasSituational(withItem(base, id!, true), { kind: 'perception' })).toBe(true);
  });
});
