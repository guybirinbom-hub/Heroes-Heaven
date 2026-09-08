/*
 * BATCH 031 — THE CLOSER'S TWO COMPARER SETTLES, AND THE ANTI-LAUNDERING CHECKS THEY OWE.
 *
 * The gate's KINDS check ended the batch with `basic-modification missing=[conditional,choice]` and
 * `monk-moves missing=[hp]`, both after the mechanic had already been settled elsewhere in this batch:
 * Basic Modification's pick is built into the app's existing tiered modification picker (no field on
 * the feat record for a field-reading comparer to credit), and Monk Moves' +3 HP is Monk Resiliency's
 * per-archetype-feat rule, which we carry once on that feat. Both are VERIFIED_EQUIVALENT settles.
 *
 * A settle is only legitimate while the comparer still reports the record with the settle bypassed;
 * otherwise it has stopped comparing and started asserting. wg-diff's own `--raw` is that hook
 * (RAW_SETTLES skips VERIFIED_EQUIVALENT), so each test runs the real comparer twice. Harness copied
 * from test/batch030-closer.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every case runs a comparer as a real node child — fine alone, several times slower under the full
 * suite, where the 5 s default turned it into a timeout. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const CLI_ROOT = join(__dirname, '..');

/** wg-diff's THEY-ONLY bucket, read from `--out`: the printed list is capped and would call a
 *  still-reported record "quiet". */
function theyOnly(extra: string[] = []): Map<string, string[]> {
  const rel = `work/.b031-closer-diff-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
  try {
    execFileSync(process.execPath, [join(CLI_ROOT, 'scripts/wg-diff.mjs'), '--out', rel, ...extra], {
      cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
    });
    const out = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    return new Map<string, string[]>(out.theyOnly.map((r: { id: string; missing: string[] }) => [r.id, r.missing]));
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

describe('batch 031 closer — the basic-modification kind settle', () => {
  // batch 031: basic-modification
  it('basic-modification is quiet with the settle and reports missing=[conditional,choice] again with settles bypassed', () => {
    /* AoN feat-3117: "You gain a basic modification of your choice for your innovation." WG asks it
     * with three INVENTOR_INNOVATION conditionals each wrapping a select; ours widened build.ts's own
     * inventor modification picker to the archetype (inventorViaDedication + validPick, with the same
     * gate on the control in shared.tsx), so no field on the feat record carries the pick.
     *
     * mutation-proof — stunts the settle key 'basic-modification' in wg-diff's VERIFIED_EQUIVALENT by
     * running the comparer under `--raw`, the registry's own bypass. With the settle gone the record
     * goes straight back to THEY-ONLY, so the settle is doing the silencing and is not merely
     * redundant beside a carrier the comparer can already read.
     */
    expect(theyOnly().has('basic-modification')).toBe(false);
    expect(theyOnly(['--raw']).get('basic-modification')).toEqual(['conditional', 'choice']);
  }, 240_000);
});

describe('batch 031 closer — the monk-moves hp settle', () => {
  // batch 031: monk-moves#hp
  it('monk-moves is quiet with the settle and reports missing=[hp] again with settles bypassed', () => {
    /* AoN feat-6214 mentions no Hit Points. Their +3 sits inside `conditional IF FEAT_NAMES INCLUDES
     * "monk resiliency"`; we carry that +3 once, on feats/monk-resiliency's maxHpBonus
     * {perArchetypeFeat: 3, archetype: 'monk'}, which already counts Monk Moves.
     *
     * mutation-proof — stunts the settle key 'monk-moves' in wg-diff's VERIFIED_EQUIVALENT via `--raw`.
     */
    expect(theyOnly().has('monk-moves')).toBe(false);
    expect(theyOnly(['--raw']).get('monk-moves')).toEqual(['hp']);
  }, 240_000);
});
