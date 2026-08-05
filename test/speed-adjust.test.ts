import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveSpeeds } from '../src/rules/derive';

/**
 * Arithmetic ON a Speed the character already has.
 *
 * Every non-land Speed source resolves as max(existing, granted) — deliberately, so two records
 * granting a fly Speed do not stack — which makes "+5 feet to any fly Speed you already have"
 * literally inexpressible as a grant: a `speeds: { fly: 5 }` is swallowed whole by a fly 25.
 */
const db = content();

/** A feat that simply grants a flat fly Speed — the "permanent wings" the dedication requires. */
const FLY_FEAT = 'heros-wings';

describe('Winged Warrior Dedication adds to a fly Speed you already have', () => {
  it('the record says so', () => {
    expect(db.feats['winged-warrior-dedication']?.speedAdjust).toEqual({ key: 'fly', add: 5 });
  });

  it('a character with no fly Speed gains nothing — no fly Speed appears', () => {
    const c = build('fighter', 4, { featPicks: { '2:class': 'winged-warrior-dedication' } });
    const s = deriveSpeeds(c, db);
    expect(s.fly ?? 0).toBe(0);
  });

  it('a character who has one flies 5 feet faster', () => {
    expect(db.feats[FLY_FEAT]?.speeds, `${FLY_FEAT} must grant a flat fly Speed for this test to mean anything`).toEqual({ fly: 25 });
    const plain = build('fighter', 4, {});
    const withFeat = (ids: string[]) =>
      deriveSpeeds(
        { ...plain, feats: [...plain.feats, ...ids.map((featId) => ({ featId, level: 1, slot: `x:${featId}` }))] } as typeof plain,
        db,
      );
    expect(withFeat([FLY_FEAT]).fly).toBe(25);
    expect(withFeat([FLY_FEAT, 'winged-warrior-dedication']).fly).toBe(30);
  });

  it('it does not touch any other Speed', () => {
    const plain = build('fighter', 4, {});
    const both = {
      ...plain,
      feats: [
        ...plain.feats,
        { featId: FLY_FEAT, level: 1, slot: 'x:1' },
        { featId: 'winged-warrior-dedication', level: 2, slot: 'x:2' },
      ],
    } as typeof plain;
    expect(deriveSpeeds(both, db).land).toBe(deriveSpeeds(plain, db).land);
  });
});

describe('Unburdened Iron', () => {
  it('the record carries both clauses', () => {
    expect(db.feats['unburdened-iron']?.speedAdjust).toEqual({
      key: 'all',
      ignoreArmorPenalty: true,
      reduceOtherPenalty: 5,
    });
  });

  /** Heavy armour with a −10 ft penalty and a Strength threshold this character will not meet. */
  const HEAVY = 'hellknight-plate';

  it('the armour Speed reduction stops applying', () => {
    const armor = db.items[HEAVY];
    expect(armor?.speedPenalty, `${HEAVY} must carry a Speed penalty for this test to mean anything`).toBe(-10);
    const plain = build('fighter', 4, {});
    const withArmor = {
      ...plain,
      inventory: [{ instanceId: 'a', itemId: HEAVY, qty: 1, worn: true, equipped: true, invested: false }],
    } as typeof plain;
    const bare = deriveSpeeds(plain, db).land ?? 0;
    expect(deriveSpeeds(withArmor, db).land, 'the armour must actually slow them down first').toBeLessThan(bare);
    const iron = {
      ...withArmor,
      feats: [...plain.feats, { featId: 'unburdened-iron', level: 1, slot: '1:ancestry' }],
    } as typeof plain;
    expect(deriveSpeeds(iron, db).land).toBe(bare);
  });

  it('encumbered costs 5 feet instead of 10', () => {
    const plain = build('fighter', 4, {});
    const enc = { ...plain, conditions: [{ id: 'encumbered', value: null }] } as typeof plain;
    const base = deriveSpeeds(plain, db).land ?? 0;
    expect(deriveSpeeds(enc, db).land).toBe(base - 10);
    const iron = {
      ...enc,
      feats: [...plain.feats, { featId: 'unburdened-iron', level: 1, slot: '1:ancestry' }],
    } as typeof plain;
    expect(deriveSpeeds(iron, db).land).toBe(base - 5);
  });

  it('only ONE penalty is reduced, not each of them', () => {
    // "If your Speed is taking multiple penalties, pick only one penalty to reduce." Encumbered (-10)
    // plus a stance penalty must not both shrink.
    const plain = build('fighter', 4, {});
    const base = deriveSpeeds(plain, db).land ?? 0;
    const iron = {
      ...plain,
      conditions: [{ id: 'encumbered', value: null }],
      feats: [...plain.feats, { featId: 'unburdened-iron', level: 1, slot: '1:ancestry' }],
    } as typeof plain;
    // One penalty present, one reduction: -10 becomes -5.
    expect(deriveSpeeds(iron, db).land).toBe(base - 5);
  });

  it('with no penalties at all it changes nothing', () => {
    const plain = build('fighter', 4, {});
    const iron = {
      ...plain,
      feats: [...plain.feats, { featId: 'unburdened-iron', level: 1, slot: '1:ancestry' }],
    } as typeof plain;
    expect(deriveSpeeds(iron, db)).toEqual(deriveSpeeds(plain, db));
  });
});
