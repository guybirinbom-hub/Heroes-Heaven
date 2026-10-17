import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveSpeeds } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * DESK #153 — Timewracked Dedication: "+5 feet to EVERY Speed the character has" (package I, 2026-10-17).
 *
 * feat-8166 (Pathfinder #219 pg. 80) prints: "Your Speed increases by 5 feet for each mode of movement available to
 * you." Owner, 2026-10-15 (work/desk-answers-2026-10-15.json), his pick '+5 to every speed'.
 *
 * The record used to carry TWO carriers for one bonus: `landSpeedBonus` 5 and the imported per-mode formulas
 * `speeds.{fly,swim,climb,burrow}` = "min(@actor.speed.X,5)+@actor.speed.X". The formulas resolve in grantSources
 * order, so a Speed granted AFTER the feat (a feat answer, an item, a stance, a mode) got no +5 (measured: fly 20
 * stayed 20); beside the new flag an ancestry Speed would be paid twice (azarketi swim 30 -> 40). Two overlay rows:
 * `speedBonusAllSpeeds: true` (derive.ts applies it to every Speed the character already has, after every grant,
 * stance and mode) and `speeds` removed. `landSpeedBonus` 5 STAYS: the flag only extends that value.
 *
 * Read with the TRUST GATE ON, as every player sees the app. Synthetic characters only.
 */
const gated = content({ trustGate: true });
const FEAT = 'timewracked-dedication';

/** A level-12 fighter of `ancestryId`, optionally with the dedication and a Speed granted by a feat answer. */
const fighter = (ancestryId: string, opts: { feat?: boolean; chosen?: Record<string, number> } = {}): Character => {
  const base = build('fighter', 12, { ancestryId } as Partial<BuildState>);
  return {
    ...base,
    feats: opts.feat === false ? base.feats : [...base.feats, { featId: FEAT, level: 2, slot: 'desk153:0' }],
    chosenEffects: opts.chosen ? { ...(base.chosenEffects ?? {}), speeds: opts.chosen } : base.chosenEffects,
  } as unknown as Character;
};
const speeds = (c: Character, d: ContentDatabase = gated) => {
  const { land, ...rest } = deriveSpeeds(c, d) as unknown as { land: number } & Record<string, number>;
  return { land, ...rest };
};

/** The database with one field of the dedication planted differently — the bad case, in memory only. */
const withRecord = (patch: Record<string, unknown>): ContentDatabase => {
  const rec = { ...(gated.feats[FEAT] as unknown as Record<string, unknown>), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete rec[k];
  return { ...gated, feats: { ...gated.feats, [FEAT]: rec } } as unknown as ContentDatabase;
};
const OLD_FORMULAS = Object.fromEntries(['fly', 'swim', 'climb', 'burrow'].map((m) => [m, `min(@actor.speed.${m},5)+@actor.speed.${m}`]));

describe('desk 153 — Timewracked Dedication adds 5 feet to every Speed the character has', () => {
  it('the record carries the flag and the land value, and no per-mode formulas', () => {
    const rec = gated.feats[FEAT] as unknown as Record<string, unknown>;
    expect(rec.landSpeedBonus).toBe(5);
    expect(rec.speedBonusAllSpeeds).toBe(true);
    expect(rec.speeds ?? null).toBeNull();
  });

  it('a character with only a land Speed gets +5 there and no Speed it did not have', () => {
    expect(speeds(fighter('human', { feat: false }))).toEqual({ land: 25 });
    expect(speeds(fighter('human'))).toEqual({ land: 30 });
  });

  it('a Speed granted by a feat answer (after the dedication in grant order) is paid: fly 20 -> 25', () => {
    expect(speeds(fighter('human', { feat: false, chosen: { fly: 20 } }))).toEqual({ land: 25, fly: 20 });
    expect(speeds(fighter('human', { chosen: { fly: 20 } }))).toEqual({ land: 30, fly: 25 });
  });

  it('an ancestry Speed is paid exactly once: azarketi swim 30 -> 35, land 20 -> 25', () => {
    expect(speeds(fighter('azarketi', { feat: false }))).toEqual({ land: 20, swim: 30 });
    expect(speeds(fighter('azarketi'))).toEqual({ land: 25, swim: 35 });
  });

  it('every Speed together: an ancestry swim Speed and a granted fly Speed each get their own +5', () => {
    expect(speeds(fighter('azarketi', { chosen: { fly: 20 } }))).toEqual({ land: 25, swim: 35, fly: 25 });
  });

  // mutation-proof
  it('planted: the old per-mode formulas back beside the flag pay an ancestry Speed twice (swim 40)', () => {
    expect(speeds(fighter('azarketi'), withRecord({ speeds: OLD_FORMULAS }))).toEqual({ land: 25, swim: 40 });
  });

  // mutation-proof
  it('planted: without the flag a Speed granted after the feat is not paid (fly stays 20), as before the ruling', () => {
    expect(speeds(fighter('human', { chosen: { fly: 20 } }), withRecord({ speedBonusAllSpeeds: undefined }))).toEqual({ land: 30, fly: 20 });
  });
});

/**
 * GENERIC GUARD. The two carriers must never sit on one record again: a record that has `speedBonusAllSpeeds` AND a
 * non-land `speeds.X` formula that reads the character's own `@actor.speed.X` pays that Speed twice. Any depth, so a
 * `whileActive` entry or a choice grant is covered; every bucket.
 */
const selfReferential = (db: ContentDatabase): string[] => {
  const found: string[] = [];
  const walk = (node: unknown, path: string, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`, depth + 1)); return; }
    const o = node as Record<string, unknown>;
    const sp = o.speeds;
    if (o.speedBonusAllSpeeds && sp && typeof sp === 'object') {
      for (const [mode, formula] of Object.entries(sp as Record<string, unknown>)) {
        if (mode !== 'land' && typeof formula === 'string' && formula.includes(`@actor.speed.${mode}`)) found.push(`${path}.speeds.${mode}`);
      }
    }
    for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k, depth + 1);
  };
  for (const [bucket, records] of Object.entries(db as unknown as Record<string, unknown>)) {
    if (!records || typeof records !== 'object') continue;
    for (const [id, rec] of Object.entries(records as Record<string, unknown>)) walk(rec, `${bucket}/${id}`, 0);
  }
  return found;
};

describe('desk 153 — no record pays one Speed through two carriers', () => {
  it('no shipped record carries speedBonusAllSpeeds beside a self-referential non-land speeds formula', () => {
    expect(selfReferential(gated)).toEqual([]);
  });

  // mutation-proof
  it('planted: the old formulas beside the flag are caught, with the record and the mode named', () => {
    expect(selfReferential(withRecord({ speeds: OLD_FORMULAS })).sort()).toEqual([
      `feats/${FEAT}.speeds.burrow`,
      `feats/${FEAT}.speeds.climb`,
      `feats/${FEAT}.speeds.fly`,
      `feats/${FEAT}.speeds.swim`,
    ]);
  });

  // mutation-proof
  it('planted: the same formulas inside a whileActive entry beside the flag are caught at depth', () => {
    const planted = withRecord({ speeds: undefined, speedBonusAllSpeeds: undefined, whileActive: [{ speedBonusAllSpeeds: true, speeds: { fly: 'min(@actor.speed.fly,5)+@actor.speed.fly' } }] });
    expect(selfReferential(planted)).toEqual([`feats/${FEAT}.whileActive[0].speeds.fly`]);
  });
});
