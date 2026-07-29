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
/** This shells out to a script that parses the whole 23 MB core.json, so it is by far the slowest
 *  thing in the suite. Under load it once blew vitest's default 5s timeout and reported a FAILING
 *  ratchet — the one result this file must never get wrong, since a false red here reads as "the
 *  coverage regressed". The generous timeout below (and maxBuffer) keeps the signal honest. */
const REPORT_TIMEOUT_MS = 120_000;

function report() {
  const out = execFileSync('node', ['scripts/coverage-report.mjs', '--json'], {
    encoding: 'utf8',
    timeout: REPORT_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
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
  featGrantsAuto: 311,
  featPickGrants: 38,
  featCantripGrants: 51,
  featFeatGrants: 254,
  companionGrants: 78,
  situationalBonuses: 2293,
};

/** Ceilings for work outstanding — these may only ever go DOWN.
 *  2026-07-28  choices 549 · situational 2976   (baseline)
 *  2026-07-28  choices 546                      (choose-a-skill batch 1: Assurance, Automatic
 *                                                Knowledge, Expert Longevity)
 *  2026-07-28  situational 1312                 (applied the adversarially verified lane: 1,758
 *                                                records / 2,620 bonuses. Also corrected the report
 *                                                itself, which scored items/classFeatures/heritages
 *                                                as 0% on a stale "registry is feats-only" comment.)
 *  2026-07-29  situational 1114                 (applied the 283 verifier-DISPUTED records after
 *                                                revising each against its own rules text: 218
 *                                                shipped, 57 dropped as not-situational or already
 *                                                modelled, 15 escalated to the owner.)
*  2026-07-29  choices 536 · situational 1018   (both instruments corrected: idsIn required a
 *                                                HYPHEN, so single-word registry keys like `pet`,
 *                                                `familiar` and 96 situational ids were invisible and
 *                                                counted as gaps. Now matched broadly and filtered to
 *                                                ids that resolve to a real record.)
 *  Lower these when work lands; never raise one to make a red build green. */
const MISSING_CEILING = { choices: 536, situational: 1018 };

describe('mechanical coverage ratchet', { timeout: REPORT_TIMEOUT_MS }, () => {
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

  it('Assurance is the canary: it asks for a skill and IS now modelled', () => {
    // This assertion used to be `.toBe(false)` — the honest record that the feat did nothing. It was
    // flipped when the choose-a-skill lane was built, which is what "Assurance is fixed" means in a
    // form you can check rather than take on trust.
    const { execFileSync: run } = require('node:child_process') as typeof import('node:child_process');
    const json = JSON.parse(
      run('node', ['-e', 'const d=require("./public/core.json");const c=d.feats.assurance.choice;console.log(JSON.stringify({kind:c&&c.kind,flag:c&&c.flag}))'], { encoding: 'utf8' }),
    );
    // kind 'skills' resolves against the CHARACTER (the skills they're trained in) — the eligible set
    // depends on the build, so it can never be enumerated on the record.
    expect(json.kind, 'Assurance must offer a skill choice').toBe('skills');
    expect(json.flag).toBe('assuredSkill');
  });
});
