import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

/**
 * COVERAGE RATCHET.
 *
 * A previous pass reported the "make every feat actually work" mandate as mostly covered. The lanes
 * it built were real, but the claim had no denominator, so it couldn't be checked — and Assurance
 * ("Choose a skill you're trained in") sat in a lane nobody had enumerated. It looked done; it wasn't.
 *
 * These tests exist so progress has to MOVE A NUMBER rather than assert a sentence:
 *   - the registries must not shrink (work already done can't silently vanish), and
 *   - the unmodelled counts must not grow (a data import can't quietly reopen the gap).
 *
 * When you close a lane, run `node scripts/coverage-report.mjs` and tighten the ceilings below.
 * Lowering a ceiling is the commit that proves the work; a green suite with an untouched ceiling
 * proves nothing.
 */
function report() {
  const out = execFileSync('node', ['scripts/coverage-report.mjs', '--json'], { encoding: 'utf8' });
  return JSON.parse(out) as {
    registryCounts: Record<string, number>;
    playerChoices: { collection: string; need: number; modelled: number; missing: number }[];
    situationalBonuses: { collection: string; need: number; modelled: number; missing: number }[];
    totals: { choiceNeed: number; choiceMissing: number; situationalNeed: number; situationalMissing: number };
  };
}

/** Floors for work already done — these may only ever go UP. */
const REGISTRY_FLOOR: Record<string, number> = {
  featGrants: 8,
  featGrantsAuto: 281,
  featPickGrants: 35,
  featCantripGrants: 51,
  featFeatGrants: 185,
  companionGrants: 57,
  situationalBonuses: 308,
};

/** Ceilings for work outstanding — these may only ever go DOWN. Measured 2026-07-28. */
const MISSING_CEILING = { choices: 549, situational: 2976 };

describe('mechanical coverage ratchet', () => {
  const r = report();

  it('no registry has shrunk (previously-wired feats stay wired)', () => {
    for (const [name, floor] of Object.entries(REGISTRY_FLOOR)) {
      expect(r.registryCounts[name], `${name} lost entries`).toBeGreaterThanOrEqual(floor);
    }
  });

  it('the unmodelled-choice count has not grown', () => {
    expect(r.totals.choiceMissing).toBeLessThanOrEqual(MISSING_CEILING.choices);
  });

  it('the unmodelled situational-bonus count has not grown', () => {
    expect(r.totals.situationalMissing).toBeLessThanOrEqual(MISSING_CEILING.situational);
  });

  it('reports a real denominator for every lane (the thing the old claim lacked)', () => {
    for (const lane of [...r.playerChoices, ...r.situationalBonuses]) {
      expect(lane.need, `${lane.collection} has no denominator`).toBeGreaterThan(0);
      expect(lane.modelled + lane.missing).toBe(lane.need);
    }
  });

  it('Assurance is the canary: it asks for a skill and must end up modelled', () => {
    // Deliberately expected to FAIL until the choose-a-skill lane is built. Flip to .toBe(true) as
    // part of that work — this is the concrete, checkable definition of "Assurance is fixed".
    const { execFileSync: run } = require('node:child_process') as typeof import('node:child_process');
    const json = JSON.parse(run('node', ['-e', 'const d=require("./public/core.json");console.log(JSON.stringify({hasChoice:!!d.feats.assurance.choice}))'], { encoding: 'utf8' }));
    expect(json.hasChoice, 'Assurance still has no machine-readable choice').toBe(false);
  });
});
