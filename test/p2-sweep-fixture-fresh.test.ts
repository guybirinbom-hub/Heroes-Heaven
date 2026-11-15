/*
 * The zero-marks sweep's fixture is not stale (Tweaks phase 2, WP4 finish C9). test/fixtures/p2-sweep-specs.json is
 * written by scripts/p2-sweep-fixture.mjs from the parity snapshot's specs (the jsdom sweep cannot load the parity
 * script). This node test runs the same picking (scripts/p2-sweep-fixture-lib.mjs) on the specs as they are NOW and
 * compares: a spec that changed — or a case added to the positive control — without the fixture being re-made fails
 * here, with the command to run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs script with no type declarations
import { isTwinId, loadEngine } from '../scripts/blocks-parity-snapshot.mjs';
// @ts-expect-error — a plain .mjs script with no type declarations
import { sweepFixtureOf } from '../scripts/p2-sweep-fixture-lib.mjs';

describe('the zero-marks sweep fixture matches the parity specs', () => {
  it('test/fixtures/p2-sweep-specs.json is what scripts/p2-sweep-fixture.mjs writes today (else: npx jiti scripts/p2-sweep-fixture.mjs)', async () => {
    const E = await loadEngine();
    const fresh = JSON.stringify(sweepFixtureOf(E, isTwinId));
    const stored = readFileSync(join(process.cwd(), 'test/fixtures/p2-sweep-specs.json'), 'utf8').trim();
    if (fresh !== stored) {
      const a = JSON.parse(fresh) as { zero: { id: string }[]; marked: { id: string }[] };
      const b = JSON.parse(stored) as { zero: { id: string }[]; marked: { id: string }[] };
      const ids = (x: typeof a) => [...x.zero.map((s) => `zero ${s.id}`), ...x.marked.map((s) => `marked ${s.id}`)];
      expect(ids(b), 'the fixture is stale — re-run: npx jiti scripts/p2-sweep-fixture.mjs').toEqual(ids(a));
    }
    expect(fresh === stored, 'the fixture is stale (a spec\'s build changed) — re-run: npx jiti scripts/p2-sweep-fixture.mjs').toBe(true);
  }, 120_000);
});
