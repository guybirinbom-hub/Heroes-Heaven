import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { explainStat } from '../src/rules/explain';
import { deriveSpeeds } from '../src/rules/derive';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 031, GAP lane for the SITUATIONAL family.
 *
 * Two gap lines, both raised by the situational verifier while following monk-moves#speed-star's own
 * sibling logic, and both about the same thing: a Speed the sheet pays (or should pay) that nothing
 * on the character can account for.
 *
 *  · work/.b031-verify-situational.txt:121 — classFeatures/incredible-movement carried no speed
 *    carrier at all, and its `speedsIf` had no READER either: derive.ts built `grantSources` from
 *    heritages + feats + chosenEffects + active states, never from class features, so `speeds` and
 *    `speedsIf` on a class feature were dead fields. Row + reader.
 *  · work/.b031-verify-situational.txt:124 — explain.ts's speed block built its parts from
 *    `landSpeedBonus` / `landSpeedMin` / `speeds.land` only, so every gated grant paid a Speed the
 *    breakdown never named and the parts stopped summing to the total.
 *
 * The incredible-movement block asserts PATCHED against STRIPPED in-memory copies, never a
 * patched-vs-shipped delta: the row is the driver's to apply, so a shipped-side assertion would flip
 * the moment it lands.
 */
const db = content();

/** A character holding feats by id, the same shape the situational family's file uses. */
const withFeats = (featIds: string[], classId = 'fighter', level = 8): Character => {
  const base = build(classId, level);
  return {
    ...base,
    feats: [...base.feats, ...featIds.map((featId, i) => ({ featId, level, slot: `b31g:${i}` }))],
  } as unknown as Character;
};

const inPlate = (c: Character, d: ContentDatabase) =>
  deriveSpeeds({ ...c, inventory: [...c.inventory, { instanceId: 'hp', itemId: 'half-plate', quantity: 1, worn: true }] } as Character, d).land;

describe('incredible-movement pays a monk the Speed its printed clause grants', () => {
  /* AoN class-feature-934: "You move like the wind. You gain a +10-foot status bonus to your Speed
   * whenever you're not wearing armor. The bonus increases by 5 feet for every 4 levels you have
   * beyond 3rd." The record shipped with no speeds / speedsIf / landSpeedBonus of any kind, so the
   * whole clause lived in a star that moved nothing and a monk walked 10-25 feet short. */

  const patch = (rec: Record<string, unknown>): ContentDatabase =>
    ({ ...db, classFeatures: { ...db.classFeatures, 'incredible-movement': { ...db.classFeatures['incredible-movement'], ...rec } } }) as ContentDatabase;
  const ROW = [{ unarmored: true, speeds: { land: '10+5*floor((@actor.level-3)/4)' } }];
  const stripped = patch({ speedsIf: undefined });
  const patched = patch({ speedsIf: ROW });

  // batch 031 premise: class-feature-934 "The bonus increases by 5 feet for every 4 levels you have beyond 3rd."
  it('the formula steps 10 / 15 / 20 / 25 / 30 at 3rd, 7th, 11th, 15th and 19th', () => {
    // Both sides in memory: the row is authored in work/.b031-rows-gap-situational.json, not applied yet.
    for (const [level, feet] of [[3, 10], [6, 10], [7, 15], [11, 20], [15, 25], [19, 30]] as const) {
      const monk = build('monk', level);
      expect(
        deriveSpeeds(monk, patched).land - deriveSpeeds(monk, stripped).land,
        `a monk ${level} is +${feet} ft while unarmored`,
      ).toBe(feet);
    }
  });

  // batch 031 premise: class-feature-934 "You gain a +10-foot status bonus to your Speed whenever you"
  it('the bonus is withheld in armour, which is the whole reason it is a speedsIf and not a number', () => {
    const monk = build('monk', 5);
    expect(inPlate(monk, patched), 'half plate is armour; the clause says "whenever you\'re not wearing armor"').toBe(inPlate(monk, stripped));
  });

  /* THE READER, which is the other half of this gap: before this batch derive.ts never put class
   * features into `grantSources`, so the row above would have been inert data. The assertion is the
   * two its above — a patched classFeature that moves the number can only have been read — and this
   * one pins the edit's own risk: `speedAdjust` used to have its OWN classFeature loop beside the
   * grantSources one, and would now be applied twice if that loop had been left standing. No shipped
   * class feature carries speedAdjust (measured: 0), so it is patched in to be observable at all. */
  // batch 031 premise: class-feature-934 "You gain a +10-foot status bonus to your Speed whenever you"
  it('a class feature speedAdjust is applied exactly once, not once per loop', () => {
    const monk = build('monk', 5);
    const adjusted = patch({ speedsIf: undefined, speedAdjust: { key: 'land', add: 5 } });
    expect(deriveSpeeds(monk, adjusted).land).toBe(deriveSpeeds(monk, stripped).land + 5);
  });

  /* The star that used to be the record's ONLY carrier (situationalBonuses.ts:1471) is deleted, the
   * way feats/monk-moves — the archetype copy of this same clause — lost its own in this batch: with
   * the row applied it would promise a second copy of feet already in the Speed. Asserted on the
   * PATCHED copy, where the number is present, so it reads the same before and after the row lands. */
  // batch 031 premise: class-feature-934 "You gain a +10-foot status bonus to your Speed whenever you"
  it('the duplicate star is gone from the Speed popup, with the +10 in the number instead', () => {
    const monk = build('monk', 5);
    const e = explainStat(monk, patched, { kind: 'speed' });
    expect((e.situational ?? []).filter((s) => s.sourceId === 'incredible-movement')).toEqual([]);
    expect(deriveSpeeds(monk, patched).land, 'the feet are in the number, once').toBe(deriveSpeeds(monk, stripped).land + 10);
  });
});

describe('monk-moves puts its gated +10 in the Speed breakdown, not only in the total', () => {
  /* AoN feat-6214: "You gain a +10-foot status bonus to your Speed when you're not wearing armor."
   * The situational family correctly deleted the duplicate star, which left the +10 in the number and
   * NOWHERE in the popup: parts [Ancestry Speed 25] under a total of "35 ft". explain.ts's speed block
   * exists to keep the breakdown summing to the total, and a gated grant broke exactly that. */

  // batch 031: monk-moves#speed-star
  it('the parts sum to the total and the +10 is named after the feat that pays it', () => {
    const c = withFeats(['monk-moves'], 'fighter', 8);
    const e = explainStat(c, db, { kind: 'speed' });
    const sum = e.parts.reduce((n, p) => n + p.value, 0);
    expect(`${sum} ft`, 'ten feet used to be in the total and in no part').toBe(e.totalText);
    expect(e.parts.map((p) => p.note)).toContain(db.feats['monk-moves'].name);
  });

  // batch 031: monk-moves#speed-star
  it('a character without monk-moves gains no such part', () => {
    const e = explainStat(build('fighter', 8), db, { kind: 'speed' });
    expect(e.parts.map((p) => p.note)).not.toContain(db.feats['monk-moves'].name);
    expect(`${e.parts.reduce((n, p) => n + p.value, 0)} ft`).toBe(e.totalText);
  });
});
