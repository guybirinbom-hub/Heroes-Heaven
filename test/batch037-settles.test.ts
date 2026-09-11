/*
 * BATCH 037 — LANE S, THE THREE SETTLES the regate left red.
 *
 * Three records, four registry entries, one shape: the difference was read against the printed text,
 * the owner ruled it, and the app keeps its own encoding — so the comparer that reports it has to be
 * told once, per record, with the reading written beside the entry.
 *
 *   reverse-engineer#crafting-star      WG carries the PRE-remaster +2 Crafting (feat-8555); the
 *                                       record's own printing (feat-3053) has no number in it.
 *                                       SETTLED_VALUES (wg-values), key `skill|crafting`.
 *   time-mage-dedication#innate-tradition  WG offers a free 4-way tradition pick; print derives the
 *                                       tradition from the spells used to qualify. TWO comparers, two
 *                                       entries: VERIFIED_EQUIVALENT (wg-diff) for the `choice` KIND,
 *                                       SETTLED_IDENTITIES (wg-identity) for their four option titles.
 *   haunting-memories#skill-feat-pick    WG asks the one printed either/or in two steps; ours asks it
 *                                       in one. SETTLED_IDENTITIES (wg-identity), MEMBER scope.
 *
 * A settle is legitimate only while the comparer still reports the record with the registry bypassed.
 * That is the whole of what is checked here, per entry: the SETTLED run is quiet and the `--raw` run —
 * each comparer's own registry bypass, the stunt — puts the exact difference straight back. A settle
 * that answers nothing is the trap the registry headers warn about: it silences the NEXT difference of
 * that kind on that record, unread.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every case here runs a real node child — fine alone, several times slower under the full suite,
 * where the 5 s default turned it into a timeout. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

const values = (ids: string, extra: string[] = []) => runScript('wg-values.mjs', ['--ids', ids, ...extra]);
const identity = (ids: string, extra: string[] = []) => runScript('wg-identity.mjs', ['--ids', ids, ...extra]);

/** wg-diff has no `--ids`; `--out` is its only per-record view. id -> the THEY-ONLY row, if any. */
function theyOnly(id: string, extra: string[] = []): { missing: string[]; extra: string[] } | undefined {
  const rel = `work/.b037-settles-diff-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
  try {
    runScript('wg-diff.mjs', ['--out', rel, ...extra]);
    const out = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8')) as { theyOnly: { id: string; missing: string[]; extra: string[] }[] };
    return out.theyOnly.find((r) => r.id === id);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

describe('batch 037 lane S — reverse-engineer keeps the remastered entry, which has no +2', () => {
  // batch 037: reverse-engineer#crafting-star
  // mutation-proof
  it('reverse-engineer is quiet with the settle and reports theirs=2 again with the settles bypassed', () => {
    /*
     * AoN feat-3053 (Guns & Gears **Remastered** pg. 25), this record's own aonId, prints the whole
     * mechanic without a number: *"Furthermore, you can use Crafting instead of Thievery to Disable a
     * Device or Pick a Lock."* WG's +2 is AoN feat-8555, the superseded 2021 entry (*"You gain a +2
     * circumstance bonus to Crafting checks to reverse engineer a formula from an item."*), whose
     * prerequisite is expert in Crafting where the remaster asks trained. Owner ruled 2026-09-10
     * (desk #15, "drop the +2 Crafting star") under R12: the 2025 printing wins, and the star was
     * deleted from src/rules/situationalBonuses.ts:559 in this batch.
     *
     * mutation-proof — the settle key stunted is 'reverse-engineer' in wg-values' SETTLED_VALUES, via
     * `--raw`, the registry's own bypass. The row comes straight back, so the entry is what silences
     * it and is not redundant beside a carrier this comparer could already read. `ours(all): (none)`
     * on the raw run is the blast radius the entry claims: `skill|crafting` is the record's ENTIRE
     * numeric content, so there is nothing else on the row for it to hide.
     */
    expect(values('reverse-engineer')).toMatch(/compared 1 records with at least one comparable value; 1 agree on every one/);

    const raw = values('reverse-engineer', ['--raw', '--verbose']);
    expect(raw).toMatch(/--- reverse-engineer/);
    expect(raw).toMatch(/MISSING\s+skill\|crafting\s+theirs=2\s+ours=\(nothing\)/);
    expect(raw).toMatch(/ours\(all\): \(none\)/);
    /* …and ONLY that one row: the entry is the record's whole numeric content, not one of several. */
    expect((raw.match(/^\s+MISSING\s+/gm) ?? []).length).toBe(1);
  }, 240_000);
});

describe('batch 037 lane S — time-mage-dedication derives the tradition instead of asking for it', () => {
  // batch 037: time-mage-dedication#innate-tradition
  // mutation-proof
  it('time-mage-dedication leaves wg-diff THEY-ONLY on the shipped data and returns with `--raw`', () => {
    /*
     * AoN feat-8480 (Dark Archives (Remastered) pg. 184): *"This innate spell and your focus spells
     * from the time mage archetype are of the same tradition as the spells you used to meet the
     * archetype's prerequisites."* The prerequisite is a spellcasting class feature, so the tradition
     * is a fact about whoever qualified. Ours derives it — feats/time-mage-dedication `innateSpells
     * [{spellId:'time-sense', atWill:true, traditionFromCasting:true}]`, read at build.ts:8351.
     * Owner ruled 2026-09-10 (desk #57, R14): derive it, build no picker.
     *
     * mutation-proof — the settle key stunted is 'time-mage-dedication' in wg-diff's
     * VERIFIED_EQUIVALENT, via `--raw`. `missing=['choice']` comes straight back, so the entry is what
     * silences it. The `extra:['focus']` either side is the WE-ONLY half and no business of this
     * entry; `spell` and `spellcasting` are absent from `missing` in BOTH runs, which is the scope the
     * entry claims — a real grant this dedication ought to hand over would still report.
     */
    expect(theyOnly('time-mage-dedication')).toBeUndefined();

    const raw = theyOnly('time-mage-dedication', ['--raw']);
    expect(raw?.missing).toEqual(['choice']);
  }, 240_000);

  // batch 037: time-mage-dedication#innate-tradition
  // mutation-proof
  it('time-mage-dedication is quiet on wg-identity and its four tradition titles return with `--raw`', () => {
    /*
     * The membership half of the same finding, on the other comparer: their `select "Select a
     * Tradition"` offers Arcane / Divine / Occult / Primal, three of which are illegal for any given
     * character, and ours stores no answer at all because the tradition is computed.
     *
     * mutation-proof — the settle key stunted is 'time-mage-dedication' in wg-identity's
     * SETTLED_IDENTITIES, via `--raw`. All four titles come straight back. The entry names the four
     * MEMBERS rather than the `options` bucket, so a fifth option added to that select later still
     * reports; the `spells` bucket is named in neither run, which is the other half of the scope —
     * their two giveSpells already match ours and keep being compared.
     */
    expect(identity('time-mage-dedication')).toMatch(/checked 1 records that grant a NAMED thing; 1 match on every one/);

    const raw = identity('time-mage-dedication', ['--raw']);
    expect(raw).toMatch(/--- time-mage-dedication/);
    expect(raw).toMatch(/options\s+theirs-not-ours=\[arcane, divine, occult, primal\]/);
    /* The settle is scoped to `options`: no other bucket is reported even with the registry bypassed. */
    expect(raw).not.toMatch(/^\s+(grants|spells|items)\s+theirs-not-ours=/m);
  }, 240_000);
});

describe('batch 037 lane S — haunting-memories asks the one printed either/or once', () => {
  // batch 037: haunting-memories#skill-feat-pick
  // mutation-proof
  it('haunting-memories is quiet on wg-identity and their two step titles return with `--raw`', () => {
    /*
     * AoN feat-7701 (Shining Kingdoms pg. 122): *"When you make your daily preparations, you can
     * either gain the expert proficiency rank in one skill in which you're untrained or raise your
     * proficiency rank to master in one skill in which you're trained or better."* One either/or. WG
     * splits it into an outer CUSTOM select titled *"Untrained or Trained Skill?"* (branch titles
     * `Untrained` / `Trained`) wrapping an inner FILTERED "Select a Skill"; ours asks it once —
     * feats/haunting-memories `choice {flag:'hauntingMemory', daily:true}` with the same sixteen
     * skills under the same two rank gates, flattened so only the legal answers are shown. Owner
     * ruled 2026-09-10 (desk #128), and this batch built the second printed question beside it
     * (`grantsFeats ['haunting-memories-skill-feat']`).
     *
     * mutation-proof — the settle key stunted is 'haunting-memories' in wg-identity's
     * SETTLED_IDENTITIES, via `--raw`. Both step titles come straight back. The entry names the two
     * MEMBERS rather than the `options` bucket, so a third branch added to that select later still
     * reports, and the `grants` bucket stays under comparison for the skill-feat select they have not
     * named anything in yet.
     */
    expect(identity('haunting-memories')).toMatch(/checked 1 records that grant a NAMED thing; 1 match on every one/);

    const raw = identity('haunting-memories', ['--raw']);
    expect(raw).toMatch(/--- haunting-memories/);
    expect(raw).toMatch(/options\s+theirs-not-ours=\[untrained, trained\]/);
    expect(raw).not.toMatch(/^\s+(grants|spells|items)\s+theirs-not-ours=/m);
  }, 240_000);
});
