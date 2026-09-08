/*
 * BATCH 030 — THE CLOSER'S ONE COMPARER SETTLE, AND THE ANTI-LAUNDERING CHECK IT OWES.
 *
 * The gate's KINDS check reported `additional-ikon missing=[choice]` after the engine family had
 * already built the mechanic. Their side asks the fourth ikon as a `select`; ours raises the ikon
 * PICK CAP from a COUNTER_MODS row read by `extraPickCount` — two code paths, no field on the record —
 * so a kind comparison that reads record fields (and credits a registry FILE's kinds to every id in
 * it) structurally cannot see it. That is a VERIFIED_EQUIVALENT settle, not a gap.
 *
 * A settle is only legitimate while the comparer still reports the record with the settle bypassed;
 * otherwise it has stopped comparing and started asserting. wg-diff's own `--raw` is that hook
 * (RAW_SETTLES skips VERIFIED_EQUIVALENT), so the test below runs the real comparer twice.
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
  const rel = `work/.b030-closer-diff-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
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

describe('batch 030 closer — the additional-ikon kind settle', () => {
  // batch 030: additional-ikon
  it('additional-ikon is quiet with the settle and reports missing=[choice] again with settles bypassed', () => {
    /* AoN feat-7167: "You gain a fourth ikon, which can be of any type." WG spells it as
     * `select "Select an Ikon"` (kind `choice`); ours is counterMods.ts 'ikon-picks' +1 read by
     * build.ts extraPickCount, the single cap the builder picker and both resolvers clamp through.
     *
     * mutation-proof — stunts the settle key 'additional-ikon' in wg-diff's VERIFIED_EQUIVALENT by
     * running the comparer under `--raw`, which is the registry's own bypass. With the settle gone the
     * record goes straight back to THEY-ONLY missing=[choice], so the settle is doing the silencing
     * and is not merely redundant beside a carrier the comparer can already read.
     */
    expect(theyOnly().has('additional-ikon')).toBe(false);
    expect(theyOnly(['--raw']).get('additional-ikon')).toEqual(['choice']);
  }, 240_000);
});
