import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { rest } from '../src/rules/play';
import type { PlayState } from '../src/rules/play';
import { resetEncounterUses, isSubDaily, featUse } from '../src/rules/featUses';
import type { Character, Feat } from '../src/rules/types';

const c = content();

/**
 * SUB-DAILY USES.
 *
 * rest() refills everything, which is right for a per-day power and WRONG for a per-round one: a
 * "once per round" feat that only came back at daily preparations would be usable once per DAY —
 * the tracker lying in the restrictive direction. The encounter reset refills exactly the sub-daily
 * periods and leaves per-day/week/month spends alone.
 */
describe('sub-daily feat uses', () => {
  it('classifies the periods', () => {
    for (const p of ['round', 'turn', 'minute', 'hour']) expect(isSubDaily(p), p).toBe(true);
    for (const p of ['day', 'week', 'month', undefined as unknown as string]) expect(isSubDaily(p), String(p)).toBe(false);
  });

  const feats = {
    perRound: { limitedUses: { per: 'round' } },
    perDay: { limitedUses: { per: 'day' } },
    noLimit: {},
  } as Record<string, { limitedUses?: { per: string } }>;

  it('the encounter reset refills sub-daily uses and KEEPS per-day spends', () => {
    const spent = { perRound: 1, perDay: 1, noLimit: 3 };
    const after = resetEncounterUses(spent, feats);
    expect(after.perRound, 'a per-round use must come back').toBeUndefined();
    expect(after.perDay, 'a daily power must NOT be refilled by an encounter reset').toBe(1);
  });

  it('an unknown feat keeps its spend rather than being silently refilled', () => {
    // A feat from a disabled source book, or retired content — refilling it would hand back a use
    // the player may not be entitled to.
    expect(resetEncounterUses({ mystery: 2 }, feats).mystery).toBe(2);
  });

  it('resting still refills EVERYTHING, sub-daily included', () => {
    const play = { damage: 0, featUses: { perRound: 1, perDay: 1 } } as unknown as PlayState;
    expect(rest(play, { level: 5, conMod: 2 }).featUses).toEqual({});
  });

  it('the shipped sub-daily records are real, and their counters render', () => {
    const subDaily = Object.entries(c.feats).filter(([, f]) => isSubDaily(f.limitedUses?.per));
    expect(subDaily.length).toBeGreaterThan(10);
    const [id, feat] = subDaily[0];
    const ch = { feats: [{ featId: id }], featUses: {} } as unknown as Character;
    const use = featUse(ch, feat as Feat);
    expect(use, `${id} should expose a use counter`).toBeTruthy();
    expect(use!.current).toBe(use!.max);
  });

  it('Peafowl Stance is once per round, not once per day', () => {
    expect(c.feats['peafowl-stance']?.limitedUses).toEqual({ max: 1, per: 'round' });
  });
});
