import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * THE DROPPED-INLINE RATCHETS, PINNED AT THE MEASURED COUNTS (ratchet lane, 2026-09-29).
 *
 * scripts/dropped-inline-check.mjs (run by `npm run verify`) fails when a live count rises ABOVE its
 * ratchet constant. A ratchet only guards while it sits AT the measured count: left one or eleven above
 * it, the repaired holes can come back that many times and verify still passes, because every live
 * count is under the looser ceiling, so nothing else in the suite notices. These tests do.
 *
 * Measured on 2026-09-29 with `node scripts/dropped-inline-check.mjs`:
 *   FOOT_BASELINE         96 -> 95  (95 stripped-"<N>-foot" holes live)
 *   DAMAGE_TYPE_BASELINE  11 -> 0   (0 stripped-damage-type holes live; batch 033's repair rows landed)
 *
 * This is not a parity batch, so no `// batch NNN:` finding citation applies; each test cites the
 * ratchet lane and the command that measured its number instead. A later lane or batch that lowers
 * either ratchet again changes the pinned number here, citing its own measurement.
 *
 * WHY THE SOURCE IS PARSED, NOT IMPORTED (same as the last block of test/batchP02-repair.test.ts):
 * dropped-inline-check.mjs exports nothing and runs every check at top level (a failing one calls
 * process.exit(1)), so importing it would run the whole check inside the test process. The regex takes
 * each `const|let|var <NAME> = <integer>;` declaration that opens a line (leading whitespace allowed:
 * FOOT_BASELINE is declared inside a block) and the tests demand EXACTLY one, so a second declaration
 * further down cannot hide a reverted value.
 */
const DROPPED_INLINE = readFileSync('scripts/dropped-inline-check.mjs', 'utf8');
const ratchetDecls = (name: string): number[] =>
  [...DROPPED_INLINE.matchAll(new RegExp(`^[ \\t]*(?:const|let|var)[ \\t]+${name}[ \\t]*=[ \\t]*(-?\\d+)[ \\t]*;`, 'gm'))].map((m) => Number(m[1]));

describe('ratchet lane 2026-09-29: the dropped-inline ratchets sit at the counts measured on 2026-09-29', () => {
  // ratchet lane 2026-09-29: FOOT_BASELINE measured 95 (node scripts/dropped-inline-check.mjs)
  // mutation-proof: put FOOT_BASELINE back to 96 in scripts/dropped-inline-check.mjs and this must fail naming it.
  it('FOOT_BASELINE is 95, not the 96 it was before the measurement', () => {
    expect(ratchetDecls('FOOT_BASELINE'), 'FOOT_BASELINE in scripts/dropped-inline-check.mjs').toEqual([95]);
  });

  // ratchet lane 2026-09-29: DAMAGE_TYPE_BASELINE measured 0 (node scripts/dropped-inline-check.mjs)
  // mutation-proof: put DAMAGE_TYPE_BASELINE back to 11 in scripts/dropped-inline-check.mjs and this must fail naming it.
  it('DAMAGE_TYPE_BASELINE is 0, not the 11 it was before the measurement', () => {
    expect(ratchetDecls('DAMAGE_TYPE_BASELINE'), 'DAMAGE_TYPE_BASELINE in scripts/dropped-inline-check.mjs').toEqual([0]);
  });
});
