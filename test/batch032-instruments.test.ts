/*
 * BATCH 032 — THE INSTRUMENT LANE (WG-COMPARISON family).
 *
 * Two batch-032 findings were "the instrument misread the record", not "we lack the mechanic":
 *
 *   magical-knowledge#instrument  wg-identity's lane-file option reader could not see a MACHINE-WRITTEN
 *                                 `"options": [...]`, and credited only the bare skill spelling where
 *                                 their ADJ_VALUE label keys as SKILL_ARCANA — so a record that offers
 *                                 all four skills in two live pickers read as offering none.
 *   show-off                      the packet's theirEncoding came from Wanderer's Guide's STARFINDER
 *                                 namesake; the row that matches our Firebrands feat encodes nothing.
 *
 * A teach is legitimate only while the comparer still reports a record whose carrier is GONE, so the
 * wg-identity cases run the real comparer against a STUNTED copy of the lane file and check the flag
 * comes straight back — once with the option list removed, once with the WRONG skills in it.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every case runs an instrument as a real node child — fine alone, several times slower under the
 * full suite, where the 5 s default turned it into a timeout. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCopyBlock, wgRowsByBucket } from '../scripts/lib/wg-parse.mjs';

const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

const identity = (ids: string, extra: string[] = []) => runScript('wg-identity.mjs', ['--ids', ids, '--raw', '--verbose', ...extra]);

const LANE = 'src/rules/featGrantsLane.ts';
const LANE_TEXT = readFileSync(join(CLI_ROOT, LANE), 'utf8');

/**
 * Run wg-identity against a copy of a lane file with ONE record's grant table rewritten. Same shape as
 * batch 031's `stunted`, one layer out: this carrier lives in a TypeScript grant table, not core.json.
 */
function stuntedLane<T>(id: string, replacement: string, run: (laneArg: string[]) => T): T {
  const rel = `work/.b032-stunt-lane-${id}.ts`;
  const re = new RegExp(`^ {2}'${id}':.*$`, 'm');
  const patched = LANE_TEXT.replace(re, `  '${id}': ${replacement},`);
  if (patched === LANE_TEXT) throw new Error(`stunt anchor not found for ${id} in ${LANE}`);
  writeFileSync(join(CLI_ROOT, rel), patched);
  try {
    return run(['--lane-files', `src/rules/featGrantsAuto.ts,src/rules/featGrants.ts,${rel}`]);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/* The comparer prints one flag block per record; this is the one the finding reproduced. */
const NO_COUNTERPART = /options\s+theirs-not-ours=\[skillarcana, skillnature, skilloccultism, skillreligion\]/;

describe('batch 032 instruments — wg-identity cannot see magical-knowledge\'s skillChoices options', () => {
  // batch 032: magical-knowledge#instrument
  it('magical-knowledge matches once the reader accepts a quoted key and the SKILL_ prefix', () => {
    /*
     * AoN feat-8402 (Magical Knowledge — the record's own aonId; feat-4720, cited here at first, is
     * Anthropomorphic Shape): *"Increase your proficiency rank in one of Arcana, Nature,
     * Occultism, or Religion from expert to master and in another from trained to expert."*
     * featGrantsLane.ts:70 offers exactly those four in two `skillChoices` slots, rendered as two
     * PopupSelects (Builder.tsx:2189) and applied at build.ts:5706. The reader missed them twice over:
     * `/options\s*:\s*\[/` cannot match the machine-written `"options": [`, and their side labels an
     * untitled ADJ_VALUE option from `operation.data.variable`, so SKILL_ARCANA keys as 'skillarcana'
     * and could never meet a bare key('arcana').
     *
     * mutation-proof — stunts the taught carrier `skillChoices` on featGrantsLane.ts's
     * 'magical-knowledge' row. The teach reads a carrier that is really there; take it away and the
     * flag must come back, unchanged, on the record that would then really have no options.
     */
    expect(identity('magical-knowledge')).toMatch(/checked 1 records that grant a NAMED thing; 1 match on every one/);
    const out = stuntedLane('magical-knowledge', `{ "perception": "master" }`, (lane) => identity('magical-knowledge', lane));
    expect(out).toMatch(NO_COUNTERPART);
  }, 180_000);

  // batch 032: magical-knowledge#instrument
  it('the credit is per-option: magical-knowledge with the WRONG four skills is still reported', () => {
    /*
     * Adversarial half. `key('skill ' + option)` is added for every lane option, so the obvious failure
     * mode is a blanket that credits any skill list against any of their skill options. Rewrite the two
     * slots to Diplomacy/Society — skills the printed sentence never names — and the record must go
     * straight back to "theirs-not-ours=[skillarcana, skillnature, skilloccultism, skillreligion]".
     *
     * mutation-proof — stunts the taught carrier `skillChoices` by swapping its option list rather than
     * deleting it, which is the stunt a blanket teach would survive.
     */
    const swapped = `{ "skillChoices": [{ "options": ["diplomacy", "society"], "rank": "master" }, { "options": ["diplomacy", "society"], "rank": "expert" }] }`;
    const out = stuntedLane('magical-knowledge', swapped, (lane) => identity('magical-knowledge', lane));
    expect(out).toMatch(NO_COUNTERPART);
  }, 180_000);

  // batch 032: magical-knowledge#instrument
  it('gildedsoul and hold-mark, the other skillChoices records, still agree after the magical-knowledge teach', () => {
    /*
     * Blast radius, measured rather than asserted: over all 17,290 paired records the fix moved exactly
     * one — 190 records with an unmatched named thing became 189, and the record that left the list is
     * magical-knowledge. These two are the neighbours the finding named; they agreed before and must
     * still agree, on their own identities and not because a new key silenced them.
     */
    expect(identity('gildedsoul,hold-mark,dragonscaled-lore,nagaji-lore'))
      .toMatch(/checked 4 records that grant a NAMED thing; 4 match on every one/);
  }, 180_000);

  // batch 032: magical-knowledge#instrument
  it('the magical-knowledge teach left hold-mark\'s settle answering nothing, so it is gone', () => {
    /*
     * VERIFIER ADDITION. The teach moved TWO records off the --raw flag list, not one: hold-mark's own
     * `skillChoices` row (featGrantsLane.ts:58 — diplomacy/survival/religion/intimidation, exactly the
     * four their ADJ_VALUE options name) became readable at the same moment, and its batch-006 settle
     * `'hold-mark': ['options']` stopped answering anything. A settle that matches nothing silences the
     * NEXT options difference on that record, unread, so it was deleted rather than kept.
     *
     * Run WITHOUT `--raw`, i.e. with the settle registries live: hold-mark must match on the carrier
     * itself. If someone re-adds the settle this still passes — but if the teach regresses, this fails
     * where the --raw cases would have been silenced by the re-added entry.
     */
    const withSettles = runScript('wg-identity.mjs', ['--ids', 'hold-mark', '--verbose']);
    expect(withSettles).toMatch(/checked 1 records that grant a NAMED thing; 1 match on every one/);
    expect(readFileSync(join(CLI_ROOT, 'scripts/wg-identity.mjs'), 'utf8')).not.toMatch(/^\s*'hold-mark':\s*\[/m);
  }, 180_000);
});

describe('batch 032 instruments — show-off was paired with Wanderer\'s Guide\'s Starfinder namesake', () => {
  const sql = readFileSync(join(CLI_ROOT, 'work/wg/wg-data.sql'), 'utf8');

  // batch 032: show-off
  it('show-off pairs with the Firebrands feat, which encodes nothing at all', () => {
    /*
     * AoN feat-4144 (Firebrands pg. 80, Feat 8, archetype/flourish) is the only Show-Off in the whole
     * feat mirror and never mentions Performance: *"Attempt the triggering check again, using the
     * second result."* Their dump holds two rows of that name — 24347 (Firebrands backport, level 8,
     * NO operations) and 55639 (Galactic Ancestries, level 1, one `addBonusToValue SKILL_PERFORMANCE`).
     * wgRowsByBucket already drops the Starfinder one, so the four comparers pair the right row and the
     * WG lane for this record is genuinely empty — there is no Performance bonus to adopt.
     */
    const row = wgRowsByBucket(sql).feats.get('showoff') as { id: string; level: string; operations: string };
    expect(row.id).toBe('24347');
    expect(row.level).toBe('8');
    expect(String(row.operations)).toBe('{}');
  }, 180_000);

  // batch 032: show-off
  it('the Performance op the packet quoted for show-off belongs to a starfinder-core source', () => {
    /*
     * Names the defect precisely so a future packet build cannot re-adopt it by accident: the quoted
     * `addBonusToValue SKILL_PERFORMANCE` sits on ability_block 55639, whose content_source is 818 —
     * "Galactic Ancestries", group starfinder-core. Wanderer's Guide ships Starfinder 2e in the same
     * tables, and a name-only pairing that does not read `content_source.group` compares a Pathfinder
     * record against the OTHER GAME's namesake (the batch-23 Acolyte defect, one bucket over).
     */
    const blocks = parseCopyBlock(sql, 'ability_block').rows as Array<Record<string, string>>;
    const sf = blocks.find((r) => String(r.id) === '55639')!;
    expect(sf.name).toBe('Show-Off');
    expect(String(sf.operations)).toMatch(/SKILL_PERFORMANCE/);
    const src = (parseCopyBlock(sql, 'content_source').rows as Array<Record<string, string>>)
      .find((s) => String(s.id) === String(sf.content_source_id))!;
    expect(src.group).toBe('starfinder-core');
  }, 180_000);

  // batch 032: show-off
  it('show-off is silent in every comparer that reads a paired row', () => {
    /*
     * The consequence of pairing the right row: nothing to adjudicate anywhere. `--raw` bypasses the
     * settle registries so this cannot pass because something was quieted — no settle was authored for
     * this record, and none is wanted.
     */
    expect(runScript('wg-values.mjs', ['--ids', 'show-off', '--raw', '--verbose']))
      .toMatch(/compared 0 records with at least one comparable value/);
    expect(identity('show-off')).toMatch(/checked 0 records that grant a NAMED thing/);
  }, 180_000);
});
