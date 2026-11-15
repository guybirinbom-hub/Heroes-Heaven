import { describe, expect, it } from 'vitest';
import { isTwinId, loadEngine, snapOne } from '../scripts/blocks-parity-snapshot.mjs';
import { openForTweaks } from '../src/rules/blocks/save';
import type { BuildState } from '../src/rules/build';
import type { ContentDatabase, TweakMeta } from '../src/rules/types';

/**
 * OPENING THE BUILDER MOVES NO NUMBER (Tweaks part B, WP4; decision B4; work/tweaks-part-b-notes/plan.md
 * section 1 "WP4" — the node-environment half of test/tweaks-save-stamp.test.tsx, because the parity
 * instrument refuses jsdom's URL).
 *
 * Every overrides character of scripts/blocks-parity-snapshot.mjs (the frozen old SAMPLE, the hidden card,
 * the given casting feats, the max-HP sets with and without a mode or Drained, the attribute sets, the Lore
 * keys, the at-slot blocker, the asOf / firearm / daily ranks, the old keys nobody re-reads, an import-stamped
 * feat, the new-shape SAMPLE) is built through the snapshot's own pipeline before and after
 * `openForTweaks`, under both trust gates: every sheet number and every breakdown equal. The stamp is taken
 * with the gate the build is measured under, and with the db the snapshot builds that character with.
 *
 * MUTATION PROOF (wp4-report.md; run 2026-10-21): a stamp that writes every rank as "at least" (instead of THE
 * sort the sheet used) turns this red on the characters whose old entry lowered a rank (first red:
 * overrides:daily:wizard-L8 [off], numbers). Run under vt.mjs (the heavy-job lock); never beside a snapshot.
 */

type Spec = { id: string; build: BuildState; dbPatch?: (d: ContentDatabase) => ContentDatabase };

describe('the Builder-open stamp moves no number (B4)', () => {
  it('opening the Builder moves no number: every overrides character of the snapshot builds the same before and after openForTweaks', async () => {
    const E = await loadEngine();
    const specs = (E.specs as Spec[]).filter((s) => /^overrides:/.test(s.id) && !isTwinId(s.id));
    expect(specs.length, "fixture: the snapshot's overrides characters").toBeGreaterThanOrEqual(20);
    let stamped = 0;
    let modes = 0;
    let baselines = 0;
    for (const gate of ['off', 'on'] as const) {
      for (const spec of specs) {
        const host = spec.dbPatch ? spec.dbPatch(E.DB[gate]) : E.DB[gate];
        E.setGate(gate);
        let draft: BuildState;
        try {
          draft = openForTweaks(spec.build, host);
        } finally {
          E.clearTrustGate();
        }
        // tweaks p2 WP0: the phase-2 parity characters (`overrides:p2-*`) are saved in the new shape already
        // (`v: 2`, `options.overridesEnabled`); opening the Builder must hand back the SAME build for them (plan
        // C36: loading is never an edit), so only the older characters count as stamped. The one exception is a p2
        // character that also holds an OLD-KEY entry (dedication-early's `allowedFeats` list): phase 1 stamps that
        // entry's meta on open (or not, once it is paused), exactly as for an older character; it is neither
        // asserted unchanged nor counted.
        const isP2 = /^overrides:p2-/.test(spec.id);
        const oldKey = !!(spec.build.overrides as { allowedFeats?: unknown } | undefined)?.allowedFeats;
        if (isP2 && !oldKey) expect(draft, `${spec.id} [${gate}] opening the Builder returns the same build`).toBe(spec.build);
        else if (!isP2 && draft !== spec.build) stamped++;
        const meta = Object.values((draft.overrides?.meta ?? {}) as Record<string, TweakMeta>);
        modes += meta.filter((m) => m.mode && m.moved).length;
        baselines += meta.filter((m) => typeof m.baseline === 'number').length;
        const was = await snapOne(spec, gate);
        const now = await snapOne({ ...spec, build: draft }, gate);
        expect(was.buildError, `${spec.id} [${gate}] builds`).toBeUndefined();
        expect(now.numbers, `${spec.id} [${gate}] numbers`).toEqual(was.numbers);
        expect(now.breakdowns, `${spec.id} [${gate}] breakdowns`).toEqual(was.breakdowns);
      }
    }
    // The instrument stamped something real: every character under both gates (each holds an old entry or a
    // `v` to stamp), rank modes and set baselines among them.
    // tweaks p2 WP0: the older characters only; the p2 ones are asserted unchanged in the loop.
    expect(stamped).toBe(specs.filter((s) => !/^overrides:p2-/.test(s.id)).length * 2);
    expect(modes).toBeGreaterThan(0);
    expect(baselines).toBeGreaterThan(0);
  }, 600_000);
});
