/*
 * BATCH 037 — THE INSTRUMENT LANE, CHUNK instruments-1 (WG-COMPARISON family).
 *
 * Twelve CONFIRMED findings, and every one of them says the same thing in a different voice: the
 * printed text and our carriers agree, and WG is encoding an OLDER printing. Owner ruling 2026-09-10
 * applied standing rule R12 — the newest printing in our mirror wins — to all twelve.
 *
 * Only ONE of the twelve is visible to an instrument. The other eleven were already quiet in wg-diff,
 * wg-values, wg-identity and the experience lane before this batch, so they get NO settle: a settle
 * that matches nothing is a trap (wg-diff.mjs:40-42), because it silences the NEXT difference of that
 * kind on that record, unread. They get the per-record guard below instead, which FAILS if any of them
 * ever starts reporting — which is the moment somebody should re-read the ruling, not the moment a
 * pre-installed settle should swallow it.
 *
 *   advanced-red-mantis-magic#legacy-slots   THEY-ONLY `missing=[spellSlot]`. Their single
 *                                            `giveSpellSlot` is the 2019 World Guide ladder for a
 *                                            Red Mantis assassin spellbook neither side still defines.
 *                                            Settled in wg-diff's VERIFIED_EQUIVALENT.
 *
 * A settle is legitimate only while the comparer still reports the record with the settle bypassed,
 * AND only while the carrier it defers to really delivers. Both halves are checked: `--raw` (wg-diff's
 * own registry bypass) for the first, a BUILT character for the second.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every comparer case runs a real node child — fine alone, several times slower under the full suite,
 * where the 5 s default turned it into a timeout. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { content } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import type { BuildState } from '../src/rules/build';
import type { ContentDatabase } from '../src/rules/types';

const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

/** wg-diff's THEY-ONLY bucket, read from `--out`: the printed list is capped and would call a
 *  still-reported record "quiet". Memoised per argument set — the walk is ~2 s and every case here
 *  asks the same two questions of it. */
const diffCache = new Map<string, Map<string, string[]>>();
function theyOnly(extra: string[] = []): Map<string, string[]> {
  const key = extra.join(' ');
  const hit = diffCache.get(key);
  if (hit) return hit;
  const rel = `work/.b037-i1-diff-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
  try {
    runScript('wg-diff.mjs', ['--out', rel, ...extra]);
    const out = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    const map = new Map<string, string[]>(out.theyOnly.map((r: { id: string; missing: string[] }) => [r.id, r.missing]));
    diffCache.set(key, map);
    return map;
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

describe('batch 037 instruments-1 — advanced-red-mantis-magic settles the legacy World Guide slot ladder', () => {
  // batch 037: advanced-red-mantis-magic#legacy-slots
  it('advanced-red-mantis-magic is quiet with the settle and reports missing=[spellSlot] again with settles bypassed', () => {
    /*
     * AoN feat-897 (Advanced Red Mantis Magic, Lost Omens World Guide 2019) prints *"Add two 2nd-level
     * spells to your Red Mantis assassin spellbook. You gain a 2nd-level spell slot … At 8th level … a
     * 3rd-level spell slot. At 10th level … a 4th-level spell slot."* Every noun in it belongs to a
     * Red Mantis Assassin archetype that Prey for Death (ORC) reprinted whole; our record is the
     * legacy stub (`edition: 'legacy'`) and grants nothing on the live archetype. Their row is the one
     * op `giveSpellSlot`, hung on a spellcasting source their own data never defines either.
     * Owner-ruled 2026-09-10, desk #46, under R12.
     *
     * mutation-proof — stunts the settle key 'advanced-red-mantis-magic' in wg-diff's
     * VERIFIED_EQUIVALENT via `--raw`, the registry's own bypass. With the settle gone the record goes
     * straight back to THEY-ONLY, so the settle is what silences it and is not merely redundant beside
     * a carrier the comparer could already read.
     */
    expect(theyOnly().has('advanced-red-mantis-magic')).toBe(false);
    expect(theyOnly(['--raw']).get('advanced-red-mantis-magic')).toEqual(['spellSlot']);
  });

  // batch 037: advanced-red-mantis-magic#legacy-slots
  it('blast radius is one row: the other two spellSlot gaps still report beside advanced-red-mantis-magic', () => {
    /*
     * VERIFIED_EQUIVALENT is keyed by RECORD id, so the measured blast radius is the set of records
     * that stopped reporting `spellSlot` — and it is exactly one. The two whose carrier really does not
     * reach the printed slots are named here so that settling this one cannot be mistaken for settling
     * the kind: if either ever goes quiet without its own citation, this fails.
     */
    const missing = theyOnly();
    expect(missing.get('unholy-resurrection')).toContain('spellSlot');
    expect(missing.get('mortem-ultimatum')).toContain('spellSlot');
    expect([...missing].filter(([, ks]) => ks.includes('spellSlot')).map(([id]) => id).sort())
      .toEqual(['mortem-ultimatum', 'unholy-resurrection']);
  });

  // batch 037: advanced-red-mantis-magic#legacy-slots
  it('the archetype ladder advanced-red-mantis-magic defers to really arrives, and the feat adds nothing to it', () => {
    /*
     * The engine half of the same claim, on a BUILT character rather than on a comparer. The carrier is
     * src/rules/casterArchetypes.ts['red-mantis-assassin-dedication'] (divine / Charisma / 2 cantrips,
     * basicId `basic-red-mantis-magic`), which build.ts runs the ordinary archetype slot progression
     * off — a level-10 Red Mantis holding Basic Red Mantis Magic prepares ranks 1, 2 and 3. Taking the
     * legacy feat on top of that moves NOTHING, which is the whole content of the settle: the slots WG
     * hangs on this record are not a mechanic we are missing, they are a superseded ladder.
     *
     * ⚠ NOT `spellcastingGrant`. The tier feats carry one and stripping it changes neither this build
     * nor the comparer row — measured, not assumed; the profile comes from the casterArchetypes entry.
     */
    const db = content();
    const at10 = (picks: Record<string, string>) => buildCharacter({
      ...emptyBuild(),
      name: 't',
      level: 10,
      classId: 'fighter',
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      keyAbility: 'str',
      subclassId: null,
      featPicks: picks,
    } as BuildState, db as ContentDatabase);

    const basic = { '2:class:0': 'red-mantis-assassin-dedication', '4:class:0': 'basic-red-mantis-magic' };
    const withLegacy = { ...basic, '6:class:0': 'advanced-red-mantis-magic' };

    const ladder = at10(basic).spellcasting.find((s) => s.id === 'red-mantis-assassin-dedication-casting');
    expect(ladder?.type).toBe('prepared');
    expect(ladder?.tradition).toBe('divine');
    expect(Object.keys(ladder?.prepared ?? {}).sort()).toEqual(['1', '2', '3']);

    expect(at10(withLegacy).spellcasting).toEqual(at10(basic).spellcasting);
  });
});

/*
 * THE ELEVEN RESIDUAL READS.
 *
 * Each one is a CONFIRMED "nothing changes" finding whose record every instrument already reports
 * clean. No settle is authored for any of them (see the header), so what is pinned here is the
 * MEASUREMENT the ruling rests on: the record is not in wg-diff's work list, wg-values finds no value
 * to adjudicate on it, and wg-identity finds no named thing of theirs without a counterpart of ours.
 * The day one of them starts reporting, this file fails and the difference gets read — which is the
 * behaviour a pre-installed settle would have destroyed.
 */
const RESIDUAL = [
  'devil-allies', 'fear-no-law-fear-no-one', 'steady-balance', 'hellknight-dedication', 'ardent-armiger',
  'android', 'aon-wishes-for-riches', 'sense-of-belonging', 'lost-loved-one', 'wanderlust', 'beast-blessed',
];
/* Both comparers take `--ids`, so the eleven cost one child process each for the whole group. */
let valuesOut: string | null = null;
let identityOut: string | null = null;
const values = () => (valuesOut ??= runScript('wg-values.mjs', ['--ids', RESIDUAL.join(',')]));
const identity = () => (identityOut ??= runScript('wg-identity.mjs', ['--ids', RESIDUAL.join(',')]));

/** The three comparer questions, asked about one record. */
function quiet(id: string) {
  return {
    inDiffWorkList: theyOnly().has(id),
    valuesToAdjudicate: /(\d+) records with at least one value to adjudicate/.exec(values())?.[1],
    identityWithoutCounterpart: /(\d+) records where a named thing on their side has no counterpart/.exec(identity())?.[1],
  };
}
const CLEAN = { inDiffWorkList: false, valuesToAdjudicate: '0', identityWithoutCounterpart: '0' };

describe('batch 037 instruments-1 — residual reads, no settle authored', () => {
  /*
   * THE ZEROES BELOW ARE ONLY EVIDENCE IF THE COMPARERS ACTUALLY LOOKED.
   *
   * `0 records with at least one value to adjudicate` is what BOTH comparers print when they compared
   * seven records and agreed on every one, and equally what they print when `--ids` matched nothing —
   * a renamed or retired record would turn all ten guards below into vacuous passes, silently. So the
   * denominators are pinned too: seven of the eleven carry a comparable value and a named grant
   * (android is `noMatch` — WG has no ancestry row of that name — and three are prose-only bonuses
   * with no number asserted, which wg-values reports separately as NOT value-checked).
   */
  // batch 037: devil-allies#printing
  it('devil-allies and its nine residual siblings were really compared, not skipped by --ids', () => {
    expect(/compared (\d+) records with at least one comparable value; \1 agree/.exec(values())?.[1]).toBe('7');
    expect(/checked (\d+) records that grant a NAMED thing; \1 match/.exec(identity())?.[1]).toBe('7');
  });

  // batch 037: devil-allies#printing
  it('devil-allies — rank 6 heightening to 10th, not their Character Guide rank-5 ladder', () => {
    /* Ours: innateSpells summon-fiend rank 6 + heightenAt 14/16/18/20. Theirs: rank 5 until 16. */
    expect(quiet('devil-allies')).toEqual(CLEAN);
  });

  // batch 037: fear-no-law-fear-no-one#printing
  it('fear-no-law-fear-no-one — the one-action Strike, not their superseded fear-save upgrade', () => {
    /* Their three `addBonusToValue SAVE_*` carry no number, so the value lane reads them as prose. */
    expect(quiet('fear-no-law-fear-no-one')).toEqual(CLEAN);
  });

  // batch 037: fear-no-law-fear-no-one#printing
  it('fear-no-law-fear-no-one — the emanation the printing gives the Strike is in our text, not deleted', () => {
    /*
     * THE HALF OF THIS FINDING THAT WAS NOT TRUE. The read says "ours already carries the current
     * printing", and mechanically it does — but the shipped PROSE read *"each ally within a around
     * you"*: the distance had been deleted by the inline-value cleaner (project_hh_dropped_inline_-
     * values). AoN hellknight-order-14 prints *"each ally within a 20-foot emanation around you who
     * can see you reduces the value of their frightened condition by 1"*, so one description row in
     * work/.b037-rows-instruments-1.json restores exactly the two missing tokens.
     *
     * Written to hold BEFORE and AFTER the driver applies that row, so nothing here flips: the row's
     * value is asserted to be our own sentence with the tokens restored (stripping them again gives
     * back whatever ships, which is the "restores exactly the missing tokens, changes nothing else"
     * property a repair must have), and the printed clause is asserted on a content copy PATCHED in
     * memory with it.
     */
    const row = (JSON.parse(readFileSync(join(CLI_ROOT, 'work/.b037-rows-instruments-1.json'), 'utf8')) as {
      findings: { id: string; backfillRows: { category: string; id: string; field: string; value: string }[] }[];
    }).findings.find((f) => f.id === 'fear-no-law-fear-no-one#printing')?.backfillRows[0];
    expect(row).toMatchObject({ category: 'feats', id: 'fear-no-law-fear-no-one', field: 'description' });

    const strip = (s: string) => s.replace('20-foot emanation ', '');
    const shipped = (content().feats['fear-no-law-fear-no-one'] as { description?: string }).description ?? '';
    expect(strip(row!.value)).toBe(strip(shipped));

    const patched = { ...content().feats['fear-no-law-fear-no-one'], description: row!.value } as { description: string };
    expect(patched.description).toContain(
      'each ally within a 20-foot emanation around you who can see you reduces the value of their frightened condition by 1',
    );
  });

  // batch 037: steady-balance#grab-an-edge
  it('steady-balance — the Player Core text only, without the dropped Grab an Edge substitution', () => {
    /* Ours: degreeShifts successToCrit on Balance. Their second injectText is the Core Rulebook
     * Acrobatics-for-Reflex sentence Player Core deliberately dropped; it must not be added. */
    expect(quiet('steady-balance')).toEqual(CLEAN);
  });

  // batch 037: hellknight-dedication#armor-training
  it('hellknight-dedication — mental resistance and the Intimidation step, armour training is Armigers Protection', () => {
    /* feat-8812 prints no armour training; feat-8814 (Armiger's Protection) does, and we build it. */
    expect(quiet('hellknight-dedication')).toEqual(CLEAN);
  });

  // batch 037: ardent-armiger#printing
  it('ardent-armiger — +1 against controlled or frightened, not their attitude-effect wording', () => {
    /* Ours is a FEAT_SITUATIONAL star in src/rules/situationalBonuses.ts, which is why the value lane
     * already agrees with their flat +1 on all three saves. */
    expect(quiet('ardent-armiger')).toEqual(CLEAN);
  });

  // batch 037: android#printing
  it('android — the Ancestry Guide printing (Rare, Androffan + Common), not Starfinder Player Core', () => {
    /* ⚠ android is the one record here NO comparer can see: WG's dump has no ancestry row of that
     * name, so wg-diff files it under `noMatch` rather than comparing it. The finding came from a
     * reader, and nothing in the instruments can hold it — which is exactly why it is reported as a
     * gap rather than settled. Pinned here as the ancestry-side half of the ruling instead. */
    const android = content().ancestries['android'] as { rarity?: string; source?: { book?: string } };
    expect(android.rarity).toBe('rare');
    expect(android.source?.book).toMatch(/Ancestry Guide/);
    expect(theyOnly().has('android')).toBe(false);
  });

  // batch 037: aon-wishes-for-riches#classification-choice
  it('aon-wishes-for-riches — dragon or leech is asked, not their flat Consume Energy grant', () => {
    /* background-580 prints the branch; ours carries it as `choice.deviantClassification` plus the
     * choiceOptionLimits row pinning the dragon branch to cold. */
    expect(quiet('aon-wishes-for-riches')).toEqual(CLEAN);
  });

  // batch 037: sense-of-belonging#classification-choice
  it('sense-of-belonging — flicker or wraith is asked, not their flat Eerie Flicker grant', () => {
    expect(quiet('sense-of-belonging')).toEqual(CLEAN);
  });

  // batch 037: lost-loved-one#classification-choice
  it('lost-loved-one — leech or wraith is asked, and the wraith option points at the DEVIANT Ghostly Grasp', () => {
    expect(quiet('lost-loved-one')).toEqual(CLEAN);
  });

  // batch 037: wanderlust#classification-choice
  it('wanderlust — flicker or troll is asked, not their older troll-only Titan Swing text', () => {
    expect(quiet('wanderlust')).toEqual(CLEAN);
  });

  // batch 037: beast-blessed#trigger
  it('beast-blessed — Bestial Clarity triggers on an enchantment effect, not their wider mental effect', () => {
    /* background-362 prints *"Trigger You fail a saving throw against an enchantment effect"*. Their
     * trigger reads "a mental effect", which fires more often; the wider text must not be copied. */
    expect(quiet('beast-blessed')).toEqual(CLEAN);
    const clarity = content().actions['bestial-clarity'] as { description?: string };
    expect(clarity.description).toMatch(/\*\*Trigger\*\* You fail a saving throw against an enchantment effect/);
    expect(clarity.description).not.toMatch(/against a mental effect/i);
  });
});
