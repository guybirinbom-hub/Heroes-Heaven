// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { characterSituationalIds, explainStat } from '../src/rules/explain';
import { deriveStrikes } from '../src/rules/derive';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import type { Character } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 039, SITUATIONAL lane.
 *
 * Print (action-4261, Impossible Magic): Arcane Cascade's melee Strikes "deal 1 extra force damage",
 * rising to 2 with weapon specialization and 3 with greater weapon specialization. The star is keyed
 * by the ACTION, reached through classFeatures/arcane-cascade `grantsActions`, and read off the
 * derived sheet through `explainStat(...).situational` — the rows StatDetailModal lists.
 */
const db = content();

const cascadeRows = (c: Character) => {
  const strike = deriveStrikes(c, db)[0];
  expect(strike, 'a magus has at least one Strike to read').toBeTruthy();
  return (explainStat(c, db, { kind: 'strikeDamage', instanceId: strike.instanceId }).situational ?? []).filter(
    (n) => n.sourceId === 'arcane-cascade',
  );
};

describe('arcane-cascade: the stance damage star scales 1/2/3 with weapon specialization', () => {
  // batch 039: arcane-cascade#damage
  it('arcane-cascade: a built magus reads the printed 1/2/3 scaling on his Strike damage row', () => {
    const magus = build('magus', 1);
    expect(characterSituationalIds(magus, db)).toContain('arcane-cascade');
    const rows = cascadeRows(magus);
    expect(rows.length).toBe(1);
    expect(rows[0].text).toMatch(/melee Strikes/);
    expect(rows[0].text).toMatch(/weapon specialization/);
    expect(rows[0].text).toMatch(/3 with greater weapon specialization/);
    // The invented "expert in your tradition" rung is not what this star says.
    expect(rows[0].text).not.toMatch(/tradition/);
  });

  // batch 039: arcane-cascade#damage
  it('arcane-cascade: the star comes from the registry entry, not from somewhere else (stunted copy)', () => {
    // mutation-proof: stunt FEAT_SITUATIONAL['arcane-cascade'] and the row must vanish.
    const magus = build('magus', 1);
    const saved = FEAT_SITUATIONAL['arcane-cascade'];
    try {
      delete (FEAT_SITUATIONAL as Record<string, unknown>)['arcane-cascade'];
      expect(cascadeRows(magus)).toEqual([]);
    } finally {
      FEAT_SITUATIONAL['arcane-cascade'] = saved;
    }
    expect(cascadeRows(magus).length).toBe(1);
  });

  // batch 039: arcane-cascade#damage
  it('arcane-cascade: a fighter, who has no Arcane Cascade, reads no such star', () => {
    expect(cascadeRows(build('fighter', 1))).toEqual([]);
  });
});
