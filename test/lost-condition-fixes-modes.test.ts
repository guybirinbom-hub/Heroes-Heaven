import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveMaxHp, deriveSpeeds, deriveStrikes } from '../src/rules/derive';
import { recordMarkersFor } from '../src/rules/explain';
import { RECORD_MARKERS } from '../src/rules/situationalBonuses';
import type { Character, ContentDatabase, ModeDef } from '../src/rules/types';

/**
 * LOST-CONDITION LANE (2026-10-17) — three DARK records whose effect print gates behind a state or an
 * action, and which the data granted at all times. Dark under the trust gate (Wanderer's Guide encodes
 * nothing on them), so a player with the gate on sees no change; these tests build with the gate OFF,
 * where the old rows reached the sheet.
 *
 *   · Scalding Spit, AoN feat-1010: *"As long as you are taking persistent fire damage, you gain a boiling
 *     spit ranged unarmed attack with a range of 30 feet that deals 1d6 fire damage."* The sheet tracks
 *     persistent damage without its type, so the state is a toggle, modes/cat-scalding-spit.
 *   · Juvenile Flight, AoN feat-2653: *"The fly Speed you gain from Fledgling Flight increases to 25 feet."*
 *     — Fledgling Flight's fly Speed exists only "for this movement" (feat-2649), so a standing fly 25
 *     was a permanent fly Speed. Removed; the raise is a mark on Fledgling Flight.
 *   · Sanguine Tenacity, AoN feat-7762: drained affects you *"as if the condition values were 1 lower"* —
 *     a reduction of the condition, not +level Hit Points. The imported maxHpBonus is removed.
 *
 * Each over-grant is mutation-proved in memory by planting the old field back. Synthetic characters.
 */
const db = content();

const pc = (d: ContentDatabase, over: Partial<BuildState> = {}): Character =>
  buildCharacter(
    {
      ...emptyBuild(),
      name: 'TEST lost-condition modes',
      level: 12,
      classId: 'fighter',
      keyAbility: 'str',
      ancestryId: 'human',
      backgroundId: Object.keys(d.backgrounds)[0],
      ...over,
    } as BuildState,
    d,
  );
const added = (featId: string, level: number) => ({ overrides: { addedFeats: [{ featId, level, category: 'ancestry' as const }] } }) as Partial<BuildState>;
const inMode = (c: Character, d: ContentDatabase, id: string): Character => ({ ...c, activeModes: [...(c.activeModes ?? []), d.modes[id] as ModeDef] });

/** Everything these three records hand over without the state print requires. */
function overGrants(d: ContentDatabase): string[] {
  const out: string[] = [];
  if (deriveStrikes(pc(d, added('scalding-spit', 9)), d).some((s) => /boiling ?spit/i.test(s.name))) out.push('scalding spit without persistent fire damage');
  const strix = pc(d, { ancestryId: 'strix', overrides: { addedFeats: [{ featId: 'fledgling-flight', level: 1, category: 'ancestry' }, { featId: 'juvenile-flight', level: 5, category: 'ancestry' }] } } as Partial<BuildState>);
  if ((deriveSpeeds(strix, d).fly ?? 0) > 0) out.push('juvenile flight gives a standing fly Speed');
  if (deriveMaxHp(pc(d, added('sanguine-tenacity', 11)), d) !== deriveMaxHp(pc(d), d)) out.push('sanguine tenacity raises max HP undrained');
  return out;
}

/** Run `fn` with one record's field replaced, restoring the shipped record afterwards. */
function planted<T>(d: ContentDatabase, bucket: 'items' | 'feats', id: string, patch: Record<string, unknown>, fn: () => T): T {
  const saved = d[bucket][id];
  (d[bucket] as Record<string, unknown>)[id] = { ...saved, ...patch };
  try {
    return fn();
  } finally {
    (d[bucket] as Record<string, unknown>)[id] = saved;
  }
}

describe('state-gated effects are toggles or marks, not standing grants (gate OFF)', () => {
  it('nothing is handed over without the printed state', () => {
    expect(overGrants(db)).toEqual([]);
  });

  it('Scalding Spit: the boiling spit exists only while its toggle is on — range 30, 1d6 fire', () => {
    expect(db.feats['scalding-spit']?.grantedStrikes).toBeUndefined();
    const m = db.modes['cat-scalding-spit'];
    expect(m?.feats).toEqual(['scalding-spit']);
    const on = deriveStrikes(inMode(pc(db, added('scalding-spit', 9)), db, 'cat-scalding-spit'), db).find((s) => /boiling spit/i.test(s.name));
    expect(on?.damage).toMatch(/^1d6\b/);
    expect(on?.range).toBe(30);
    expect(deriveStrikes(pc(db, added('scalding-spit', 9)), db).some((s) => /boiling spit/i.test(s.name)), 'off without the toggle').toBe(false);
    expect(m?.grantedStrikes?.[0]).toMatchObject({ die: 'd6', damageType: 'fire', range: 30 });
  });

  it('Juvenile Flight: no standing fly Speed, and its raise is marked on Fledgling Flight', () => {
    expect(db.feats['juvenile-flight']?.speeds).toBeUndefined();
    const mark = (RECORD_MARKERS['juvenile-flight'] ?? [])[0];
    expect(mark).toMatchObject({ on: 'feature', id: 'fledgling-flight', value: 'fly 25 feet' });
    expect(db.feats['fledgling-flight'], 'the mark must name a real record').toBeTruthy();
    // …and it reaches the Fledgling Flight row of a character who holds Juvenile Flight, and no one else.
    const both = pc(db, { ancestryId: 'strix', overrides: { addedFeats: [{ featId: 'fledgling-flight', level: 1, category: 'ancestry' }, { featId: 'juvenile-flight', level: 5, category: 'ancestry' }] } } as Partial<BuildState>);
    const onlyFledgling = pc(db, { ancestryId: 'strix', overrides: { addedFeats: [{ featId: 'fledgling-flight', level: 1, category: 'ancestry' }] } } as Partial<BuildState>);
    expect(recordMarkersFor(both, db, 'feature', 'fledgling-flight').map((m) => m.value)).toContain('fly 25 feet');
    expect(recordMarkersFor(onlyFledgling, db, 'feature', 'fledgling-flight').map((m) => m.value)).not.toContain('fly 25 feet');
  });

  it('Sanguine Tenacity: no permanent Hit Points (its bleed resistance stays)', () => {
    expect(db.feats['sanguine-tenacity']?.maxHpBonus).toBeUndefined();
    expect(db.feats['sanguine-tenacity']?.resistances).toEqual([{ type: 'bleed', value: 5 }]);
  });

  it('mutation-proof: each old field, planted back, is caught', () => {
    expect(planted(db, 'feats', 'scalding-spit', { grantedStrikes: [{ name: 'BoilingSpit', die: 'd6', damageType: 'fire', traits: ['unarmed'], group: 'brawling', range: 30 }] }, () => overGrants(db)))
      .toContain('scalding spit without persistent fire damage');
    expect(planted(db, 'feats', 'juvenile-flight', { speeds: { fly: 25 } }, () => overGrants(db))).toContain('juvenile flight gives a standing fly Speed');
    expect(planted(db, 'feats', 'sanguine-tenacity', { maxHpBonus: { perLevel: 1 } }, () => overGrants(db))).toContain('sanguine tenacity raises max HP undrained');
    expect(overGrants(db)).toEqual([]);
  });
});
