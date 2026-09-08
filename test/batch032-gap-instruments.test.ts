/*
 * BATCH 032 — THE INSTRUMENTS FAMILY'S CROSS-FILE GAP: the PACKET BUILDER's own pairing.
 *
 * The show-off finding was confirmed as an instrument misread, and the report traced it past the four
 * comparers to scripts/wg-batch.mjs, which built `theirs` with a PRIVATE pairing: parseCopyBlock with
 * no content_source filter, "richest row wins", and every empty-operations row skipped before the name
 * key was claimed. So a Pathfinder record could be handed the STARFINDER namesake's encoding, which is
 * how work/wg-batch-032.json came to quote `addBonusToValue SKILL_PERFORMANCE` as show-off's
 * theirEncoding when our feat (feat-4144, Firebrands pg. 80) never mentions Performance.
 *
 * The fix points the builder at wgRowsByBucket — the pairing all four comparers already read. These
 * cases pin the three behaviours that changed, in ONE child run because the builder reads core.json,
 * the SQL dump and every src/rules registry from cold (~10 s).
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* The builder runs as a real node child — fine alone, several times slower under the full suite. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const CLI_ROOT = join(__dirname, '..');

/* One run, four ids, three assertions. `--ids` cuts packets for NAMED records and prints a ⚠ line for
 * every id that got none, so the same stdout answers "was a packet cut?" both ways. No --out: the
 * counts are the whole question here, and --out additionally shells out to the field catalogue. */
let cached: string | undefined;
const builderRun = () =>
  (cached ??= execFileSync(
    process.execPath,
    [join(CLI_ROOT, 'scripts/wg-batch.mjs'), '--ids', 'show-off,advanced-alchemy,aon-spore-shepherd-s-staff,spore-shepherds-staff', '--count', '999'],
    { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 },
  ));

describe('batch 032 gap — wg-batch paired show-off with Wanderer\'s Guide\'s Starfinder namesake', () => {
  // batch 032: show-off
  it('cuts no packet for show-off, because the only Pathfinder row matching feat-4144 encodes nothing', () => {
    /*
     * ability_block 24347 ("Firebrands (backport)", group lost-omens) is the row that matches us and
     * its operations are "{}"; 55639 is Show-Off from Galactic Ancestries, group 'starfinder-core'.
     * wgRowsByBucket drops the starfinder source and lets the empty row hold the name key, so the
     * record lands in the owner's leave-us-unchanged case instead of a packet quoting another game.
     */
    expect(builderRun()).toMatch(/⚠ no packet for \d+: [^\n]*\bshow-off\b/);
  });

  // batch 032: show-off
  it('still cuts the packets the shared pairing sees — a class feature they file as a feat row', () => {
    /*
     * The private pairing restricted classFeatures to their `class-feature` rows, but WG files most
     * class features as `feat` rows (Advanced Alchemy is ability_block 32027, type feat), which
     * WG_PAIRING.classFeatures has long accepted. 155 class features had no packet at all because of
     * it — the same wrong-counterpart defect as show-off, pointing the other way.
     */
    expect(builderRun()).toMatch(/classFeatures=1/);
  });

  // batch 032: show-off
  it('defers an aon- twin to its canonical, and cuts the canonical\'s packet', () => {
    /*
     * An `aon-` twin shadowed by a canonical of the same name carries nothing by design and every
     * comparer defers it (wgOwnsComparison), so a packet cut for one can only produce a false finding
     * — batch 12's `aon-spore-shepherd-s-staff missing=[skill]`, while `spore-shepherds-staff` ships
     * the bonus in full. The twin now gets no packet; the canonical still does.
     */
    const out = builderRun();
    expect(out).toMatch(/⚠ no packet for \d+: [^\n]*\baon-spore-shepherd-s-staff\b/);
    expect(out).toMatch(/items=1/);
  });
});
