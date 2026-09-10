/*
 * BATCH 036 — THE INSTRUMENT LANE (WG-COMPARISON family), AND ITS ANTI-LAUNDERING CHECKS.
 *
 * One finding, and it is "the instrument misread the record", not "we lack the mechanic":
 *
 *   armored-resistance#instrument  wg-diff's kinds reader flattens a conditional gated on ANOTHER
 *                                  FEAT into a bare `hp` on the record it sits on, so a feat whose
 *                                  printed text (AoN feat-7897) mentions no Hit Points at all read as
 *                                  `missing=[hp]`. The sentence is Guardian Resiliency's, and we hold
 *                                  it once, on the feat that prints it.
 *
 * This is monk-moves#hp (batch 031) one archetype over: WG has no "per feat of this archetype" verb,
 * so it stamps `+3 MAX_HEALTH_BONUS` onto every qualifying archetype feat behind `conditional IF
 * FEAT_NAMES INCLUDES "<archetype> resiliency"`. wg-values already drops that whole shape corpus-wide
 * (RESILIENCY_GATE); wg-diff needs the per-record settle, which is what this file guards.
 *
 * A settle is legitimate only while the comparer still reports the record with the settle bypassed,
 * AND only while the carrier it defers to really delivers. Both halves are checked below: `--raw`
 * (wg-diff's own registry bypass) for the first, a STUNTED content copy for the second.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every comparer case runs a real node child — fine alone, several times slower under the full suite,
 * where the 5 s default turned it into a timeout. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { content, firstSubclass } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { deriveMaxHp } from '../src/rules/derive';
import type { Character, ContentDatabase } from '../src/rules/types';

const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

/* Parsed once — public/core.json is 8 MB and the stunt would otherwise pay for it each time. */
const CORE = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8')) as Record<string, Record<string, any>>;

/** Run a comparer against a copy of the content with ONE carrier removed. Hook from batch 030/031. */
function stunted<T>(bucket: string, id: string, mutate: (rec: any) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b036-stunt-${bucket}-${id}.json`;
  const patched = { ...CORE, [bucket]: { ...CORE[bucket], [id]: structuredClone(CORE[bucket][id]) } };
  mutate(patched[bucket][id]);
  writeFileSync(join(CLI_ROOT, rel), JSON.stringify(patched));
  try {
    return run(['--core', rel]);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/** wg-diff's THEY-ONLY bucket, read from `--out`: the printed list is capped and would call a
 *  still-reported record "quiet". */
function theyOnly(extra: string[] = []): Map<string, string[]> {
  const rel = `work/.b036-diff-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
  try {
    runScript('wg-diff.mjs', ['--out', rel, ...extra]);
    const out = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    return new Map<string, string[]>(out.theyOnly.map((r: { id: string; missing: string[] }) => [r.id, r.missing]));
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

const values = (ids: string, extra: string[] = []) => runScript('wg-values.mjs', ['--ids', ids, '--raw', '--verbose', ...extra]);

describe('batch 036 instruments — armored-resistance settles the resiliency-parked `hp`', () => {
  // batch 036: armored-resistance#instrument
  it('armored-resistance is quiet with the settle and reports missing=[hp] again with settles bypassed', () => {
    /*
     * AoN feat-7897 (Armored Resistance) prints only *"While you are wearing medium or heavy armor,
     * you gain resistance to physical damage equal to half your character level when you use the
     * Intercept Attack reaction to take damage instead of your ally."* — no Hit Points. Their row is
     * `conditional IF MAX_HEALTH_CLASS_PER_LEVEL <= 10 AND FEAT_NAMES INCLUDES "guardian resiliency"
     * THEN adjValue MAX_HEALTH_BONUS = 3`, i.e. Guardian Resiliency's own per-guardian-archetype-feat
     * +3 replicated onto this row.
     *
     * mutation-proof — stunts the settle key 'armored-resistance' in wg-diff's VERIFIED_EQUIVALENT via
     * `--raw`, the registry's own bypass. With the settle gone the record goes straight back to
     * THEY-ONLY, so the settle is what silences it and is not merely redundant beside a carrier the
     * comparer could already read.
     */
    expect(theyOnly().has('armored-resistance')).toBe(false);
    expect(theyOnly(['--raw']).get('armored-resistance')).toEqual(['hp']);
  }, 240_000);

  // batch 036: armored-resistance#instrument
  it('guardian-resiliency still asserts the +3 the sentence really belongs to', () => {
    /*
     * The settle moves the assertion to the record that owns it; it must not make it disappear. No
     * resiliency-gated op in the dump sits on a Resiliency feat — each Resiliency row states its own
     * +3 UNGATED — so wg-values compares that one for real.
     *
     * mutation-proof — stunts the taught carrier `maxHpBonus` on feats/guardian-resiliency. Removing
     * the field reopens `MISSING hp|` there, which is where the gap would really be.
     */
    const shipped = values('armored-resistance,guardian-resiliency');
    /* armored-resistance keeps NO comparable value once the gate drops the parked +3 — it falls to
     * "prose-only bonus", which is the value-lane statement of the same fact the wg-diff settle makes. */
    expect(shipped).toMatch(/ok\s+guardian-resiliency/);
    expect(shipped).toMatch(/compared 1 records with at least one comparable value; 1 agree on every one/);
    expect(shipped).toMatch(/prose-only bonus \(no number asserted\)\s*\n\s*armored-resistance/);
    const out = stunted('feats', 'guardian-resiliency', (r) => { delete r.maxHpBonus; }, (core) => values('guardian-resiliency', core));
    expect(out).toMatch(/MISSING\s+hp\|\s+theirs=3\s+ours=\(nothing\)/);
  }, 240_000);

  // batch 036: armored-resistance#instrument
  it('a guardian-archetype fighter really gets +3 per guardian feat, armored-resistance included', () => {
    /*
     * The engine half of the same claim, on a BUILT character rather than on a comparer: AoN feat-7894
     * (Guardian Resiliency) prints *"You gain 3 additional Hit Points for each guardian archetype class
     * feat you have"*, and ours is feats/guardian-resiliency.maxHpBonus {perArchetypeFeat: 3,
     * archetype: 'guardian'}, multiplied by the count of taken feats with archetype === 'guardian' in
     * featHpBonus (src/rules/derive.ts:897-901). armored-resistance carries archetype: 'guardian', so
     * it is one of the four counted here — which is exactly why the +3 on their row is not a mechanic
     * missing from this record.
     *
     * mutation-proof — stunts the taught carrier `maxHpBonus` on feats/guardian-resiliency in an
     * in-memory content copy. Twelve Hit Points vanish, so the settle stands on a carrier that is live.
     */
    const db = content();
    const guardian = (over: ContentDatabase = db): Character =>
      buildCharacter(
        {
          ...emptyBuild(),
          name: 't', level: 20, classId: 'fighter', ancestryId: 'human',
          backgroundId: Object.keys(db.backgrounds)[0],
          keyAbility: 'str', subclassId: firstSubclass('fighter'),
          featPicks: {
            '2:class:0': 'guardian-dedication',
            '4:class:0': 'guardian-resiliency',
            '6:class:0': 'guardians-intercept',
            '8:class:0': 'armored-resistance',
          },
        } as never,
        over,
      );
    const taken = guardian();
    expect(taken.feats.map((f) => f.featId)).toEqual(
      expect.arrayContaining(['guardian-dedication', 'guardian-resiliency', 'guardians-intercept', 'armored-resistance']),
    );

    const stuntDb = { ...db, feats: { ...db.feats, 'guardian-resiliency': { ...db.feats['guardian-resiliency'] } } } as ContentDatabase;
    delete (stuntDb.feats['guardian-resiliency'] as { maxHpBonus?: unknown }).maxHpBonus;
    /* 4 guardian feats × 3. The absolute HP total is a chassis number that other batches move; the
     * DELTA is the printed sentence and nothing else. */
    expect(deriveMaxHp(taken, db) - deriveMaxHp(guardian(stuntDb), stuntDb)).toBe(12);
  });
});
