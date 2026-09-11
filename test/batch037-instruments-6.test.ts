/*
 * BATCH 037 — INSTRUMENTS, CHUNK 6.
 *
 * Twelve findings, every one of them "nothing changes": the owner's 2026-09-10 desk pass ruled the
 * book the winner on all twelve, so no data row is owed and the only question is whether an INSTRUMENT
 * still reports the record. Nine of the twelve are quiet in every comparer already and are residual
 * reads. Three are not, and this file is the honesty check on what was done about them:
 *
 *   spirit-walk#playtest-row          wg-diff THEY-ONLY `missing=[sense]`, settled in
 *                                     VERIFIED_EQUIVALENT — their sense comes from a (playtest) row.
 *   dragon-eidolon#tradition          wg-identity `options theirs-not-ours=[divine, occult, primal]`,
 *                                     settled member-wise in SETTLED_IDENTITIES — print fixes Arcane.
 *   spellmaster-dedication#tradition  the EXPERIENCE harness's NO-SHEET-EFFECT (their
 *                                     `defineCastingSource CASTING_SOURCES`), parked in
 *                                     work/experience-instrument-limits.json.
 *
 * A settle is legitimate only while the comparer still reports the record with the settle bypassed,
 * and only while the carrier it defers to really delivers. Both halves are checked below: `--raw`
 * (each comparer's own registry bypass) for the first, a STUNTED content copy for the second. The
 * park gets the same treatment on a built character, because a park that moved with the carrier would
 * be hiding a gap rather than describing an instrument.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every comparer case runs a real node child — fine alone, several times slower under the full suite,
 * where the 5 s default turned it into a timeout. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { content } from './_content';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import { statHasSituational } from '../src/rules/explain';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import type { Character, ContentDatabase } from '../src/rules/types';

const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

/* Parsed once — public/core.json is 8 MB and each stunt would otherwise pay for it again. */
const CORE = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8')) as Record<string, any>;

/** Run a comparer against a copy of the shipped core with ONE carrier mutated. Hook from batch 030/036. */
function stuntedCore<T>(mutate: (core: Record<string, any>) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b037-i6-stunt-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
  const patched = JSON.parse(JSON.stringify(CORE)) as Record<string, any>;
  mutate(patched);
  writeFileSync(join(CLI_ROOT, rel), JSON.stringify(patched));
  try {
    return run(['--core', rel]);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/** wg-diff's THEY-ONLY bucket read from `--out`: the printed list is capped and would call a
 *  still-reported record "quiet". */
function theyOnly(extra: string[] = []): Map<string, string[]> {
  const rel = `work/.b037-i6-diff-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
  try {
    runScript('wg-diff.mjs', ['--out', rel, ...extra]);
    const out = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    return new Map<string, string[]>(out.theyOnly.map((r: { id: string; missing: string[] }) => [r.id, r.missing]));
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

const identity = (ids: string, extra: string[] = []) => runScript('wg-identity.mjs', ['--ids', ids, ...extra]);

describe('batch 037 instruments-6 — spirit-walk settles the sense WG only has on a (playtest) row', () => {
  // batch 037: spirit-walk#playtest-row
  it('spirit-walk is quiet with the settle and reports missing=[sense] again with settles bypassed', () => {
    /*
     * AoN feat-7137 (Spirit Walk) prints a +2 status bonus to Recall Knowledge about spirits, haunts
     * and undead in a 30-foot emanation, the Searching/Detecting Magic extension of that bonus to AC
     * and saves, and resistance equal to half your level on your first turn. No sense clause, no
     * range, no acuity. WG holds two rows of the name: the released one encodes nothing at all, and
     * the War of Immortals PLAYTEST row — which "richest row wins" therefore pairs us against —
     * carries one op, the precise 30-foot sense. Owner ruled 2026-09-10 (desk #149).
     *
     * mutation-proof — stunts the settle key 'spirit-walk' in wg-diff's VERIFIED_EQUIVALENT via
     * `--raw`, the registry's own bypass. With the settle gone the record goes straight back to
     * THEY-ONLY, so the settle is what silences it and is not merely redundant beside a carrier the
     * comparer could already read.
     */
    expect(theyOnly().has('spirit-walk')).toBe(false);
    expect(theyOnly(['--raw']).get('spirit-walk')).toEqual(['sense']);
  });

  // batch 037: spirit-walk#playtest-row
  it('the settle is scoped to spirit-walk: five other records still report a missing sense', () => {
    /*
     * BLAST RADIUS, MEASURED. The tempting generalisation here is the standing rule itself — "a WG row
     * marked (playtest) is never evidence" — applied in wg-parse.mjs's richest-row tie-break. It was
     * measured before being rejected: 203 playtest rows currently win that tie-break, and for about
     * 120 of them the playtest row is WG's ONLY row, so a blanket rule would delete the comparison for
     * six whole classes. This entry is one record wide instead, and the proof is that every other
     * record whose WG row grants a sense we lack is still on the work list.
     */
    const missingSense = [...theyOnly()].filter(([, missing]) => missing.includes('sense')).map(([id]) => id);
    expect(missingSense).toEqual(
      expect.arrayContaining(['attunement-to-stone', 'hand-of-the-lich', 'bloodline-mutation', 'runesight', 'umbraex-eye']),
    );
    expect(missingSense).not.toContain('spirit-walk');
  });

  // batch 037: spirit-walk#playtest-row
  it('spirit-walk still carries the printed resistance the settle does not cover', () => {
    /*
     * The settle drops ONE kind. The record's printed block has to stay asserted somewhere or the
     * settle would be standing in for it: feats/spirit-walk.resistances is the half-level resistance
     * feat-7137 prints, verbatim in its `against` clause.
     */
    const rec = content().feats['spirit-walk'] as { resistances?: { type: string; value: string; against?: string }[] };
    expect(rec.resistances?.[0]?.value).toBe('floor(@actor.level/2)');
    expect(rec.resistances?.[0]?.against).toMatch(/haunts or spirits/);
    expect((rec as { senses?: unknown }).senses).toBeUndefined();
  });
});

describe('batch 037 instruments-6 — dragon-eidolon settles the three traditions print does not offer', () => {
  // batch 037: dragon-eidolon#tradition
  it('dragon-eidolon agrees with the settle and reports [divine, occult, primal] with settles bypassed', () => {
    /*
     * AoN eidolon-7 prints "**Tradition** Arcane" — one word, no list. WG asks it as a four-branch
     * "Select a Tradition", so three of their four labels have no counterpart on our side. Owner ruled
     * 2026-09-10 (desk #138) under R14: the book wins, arcane is fixed, no picker is built.
     *
     * mutation-proof — stunts the settle key 'dragon-eidolon' in wg-identity's SETTLED_IDENTITIES via
     * `--raw`, the registry's own bypass.
     */
    expect(identity('dragon-eidolon')).toMatch(/checked 1 records that grant a NAMED thing; 1 match on every one/);
    expect(identity('dragon-eidolon', ['--raw'])).toMatch(/options\s+theirs-not-ours=\[divine, occult, primal\]/);
  });

  // batch 037: dragon-eidolon#tradition
  it('with the summoner option tradition stripped, dragon-eidolon is STILL reported', () => {
    /*
     * The member scope is what makes the settle honest. WG's `options` bucket for this record holds
     * exactly the four tradition labels, so a bucket-wide settle would silence `arcane` as well — the
     * one label that agrees, and the only instrument left watching the carrier. Stunt the carrier and
     * the record must come back.
     *
     * mutation-proof — stunts the taught carrier
     * `classes.summoner.subclass.options[id='dragon-eidolon'].tradition`, which is the `o.tradition`
     * reader wg-identity credits for 'dragon-eidolon'.
     */
    const out = stuntedCore(
      (core) => { delete core.classes.summoner.subclass.options.find((o: { id: string }) => o.id === 'dragon-eidolon').tradition; },
      (coreArg) => identity('dragon-eidolon', coreArg),
    );
    expect(out).toMatch(/options\s+theirs-not-ours=\[arcane\]/);
  });

  // batch 037: dragon-eidolon#tradition
  it('the dragon-eidolon carrier really says arcane, and the breath pick print DOES ask is still there', () => {
    /*
     * What print fixes and what print asks, on the shipped data. The tradition is a field, not a
     * control; the Breath Weapon damage type and area are the controls this record really owes, and
     * the settle must not touch them.
     */
    const db = content();
    const option = (db.classes.summoner.subclass?.options ?? []).find((o) => o.id === 'dragon-eidolon') as { tradition?: string } | undefined;
    expect(option?.tradition).toBe('arcane');
    const rec = db.classFeatures['dragon-eidolon'] as {
      choice?: { flag?: string; options?: { value: string }[] };
      effectChoices?: { id: string; options: { value: string }[] }[];
    };
    expect(rec.choice?.flag).toBe('eidolonBreathDamage');
    expect(rec.choice?.options?.map((o) => o.value)).toEqual(['acid', 'cold', 'electricity', 'fire', 'void', 'piercing', 'poison']);
    expect(rec.effectChoices?.find((c) => c.id === 'eidolonBreathArea')?.options.map((o) => o.value)).toEqual(['line', 'cone']);
  });
});

describe('batch 037 instruments-6 — spellmaster-dedication prints a bonus, not a casting source', () => {
  const db = content() as ContentDatabase;
  /** A 6th-level character holding Spellmaster Dedication in its 6th-level class slot. */
  const withDedication = (on: ContentDatabase = db): Character =>
    buildCharacter(
      {
        ...emptyBuild(),
        name: 't',
        level: 6,
        classId: 'wizard',
        ancestryId: Object.keys(db.ancestries)[0],
        backgroundId: Object.keys(db.backgrounds)[0],
        keyAbility: 'int',
        subclassId: (db.classes.wizard.subclass?.options[0]?.id as string) ?? null,
        featPicks: { '6:class': 'spellmaster-dedication' },
      } as Parameters<typeof buildCharacter>[0],
      on,
    );

  // batch 037: spellmaster-dedication#tradition
  it('spellmaster-dedication delivers the printed +2 Identify Magic star, and no casting source', () => {
    /*
     * AoN feat-1134, in its entirety: *"you are adept at identifying magic. You gain a +2 circumstance
     * bonus when you Identify Magic with a skill in which you are trained or better."* No tradition,
     * no attribute, no spell. WG's one value-bearing op is `defineCastingSource CASTING_SOURCES`, an
     * Arcane/Intelligence focus source the feat never prints — which is the whole of the NO-SHEET-EFFECT
     * the experience harness raises, because a situational star moves no number on a built character.
     * Owner ruled 2026-09-10 (desk #110) under R14.
     */
    const star = FEAT_SITUATIONAL['spellmaster-dedication']?.[0];
    expect(star?.bonus).toBe('+2 circumstance');
    expect(star?.when).toMatch(/Identify Magic/);
    expect(star?.targets.map((t) => (t as { detail?: string }).detail)).toEqual(['arcana', 'nature', 'occultism', 'religion']);
    const rec = db.feats['spellmaster-dedication'] as { spellcastingGrant?: unknown; focusSpells?: unknown; focusPoolBonus?: unknown };
    expect(rec.spellcastingGrant).toBeUndefined();
    expect(rec.focusSpells).toBeUndefined();
    expect(rec.focusPoolBonus).toBeUndefined();
  });

  // batch 037: spellmaster-dedication#tradition
  it('a character holding spellmaster-dedication stars Arcana, and loses the star when it is stunted', () => {
    /*
     * The park in work/experience-instrument-limits.json claims the printed clause IS delivered, only
     * not as a value the differential harness can see. That claim is only worth what this pair proves.
     *
     * mutation-proof — stunts the taught carrier FEAT_SITUATIONAL['spellmaster-dedication'] in memory
     * (the module table is the carrier; there is no core.json field to strip). With the entry gone the
     * star goes with it, so the assertion above reads the carrier and not something else.
     */
    const ch = withDedication();
    expect(ch.feats.some((f) => f.featId === 'spellmaster-dedication')).toBe(true);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'arcana' }, db)).toBe(true);

    const shipped = FEAT_SITUATIONAL['spellmaster-dedication'];
    try {
      delete FEAT_SITUATIONAL['spellmaster-dedication'];
      expect(statHasSituational(withDedication(), { kind: 'skill', skill: 'arcana' }, db)).toBe(false);
    } finally {
      FEAT_SITUATIONAL['spellmaster-dedication'] = shipped;
    }
    expect(statHasSituational(withDedication(), { kind: 'skill', skill: 'arcana' }, db)).toBe(true);
  });

  // batch 037: spellmaster-dedication#tradition
  it('the two spellmaster focus spells hang off their own feats, on the character own focus pool', () => {
    /*
     * The other half of the ruling: WG hangs both spells on the dedication's invented Arcane source;
     * ours puts each on the feat that prints it (AoN feat-2241 Familiar Form: *"You gain the familiar
     * form focus spell. Increase the number of Focus Points in your focus pool by 1."*), as a plain
     * `focusSpells` array, which joins the character's existing focus pool with its own tradition and
     * attribute per rules-2231.
     */
    expect((db.feats['familiar-form'] as { focusSpells?: string[] }).focusSpells).toEqual(['familiar-form']);
    expect((db.feats['spellmasters-ward'] as { focusSpells?: string[] }).focusSpells).toEqual(['spellmasters-ward']);
    for (const id of ['familiar-form', 'spellmasters-ward']) {
      expect((db.feats[id] as { spellcastingGrant?: unknown }).spellcastingGrant, `${id} must not build a casting source`).toBeUndefined();
    }
  });
});
