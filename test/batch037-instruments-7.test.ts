/*
 * BATCH 037 — THE INSTRUMENT LANE (WG-COMPARISON family), CHUNK instruments-7.
 *
 * Seven findings, every one of them "nothing changes, and here is why the comparer says otherwise":
 *
 *   curse-of-turbulent-moments#conditional-penalty  WG flattens the cursebound ladder into sixteen
 *                                                   unconditional numbers; both printed halves are
 *                                                   gated on facts the sheet cannot see, so ours is
 *                                                   a star. SETTLED_VALUES (wg-values).
 *   echo-of-lost-moments#fifth-rung                 WG puts a RANK-1 spell on the 5th rung of a
 *                                                   ten-spell apparition ladder. SETTLED_IDENTITIES
 *                                                   (wg-identity), MEMBER scope, not the bucket.
 *   otherworldly-protection#computed-value          WG asks two questions print works out from the
 *                                                   character. experience-instrument-limits.json.
 *   acute-vision#while-raging                       WG grants permanent darkvision; print grants it
 *                                                   while raging. experience-instrument-limits.json.
 *   favored-terrain#conditional-speed               no instrument change — no comparer reports it.
 *   born-of-animal#speed-dash                       no instrument change — no comparer reports it.
 *   gleaming-blade#transcendence-name               no instrument change — no comparer reports it.
 *
 * A settle is legitimate only while the comparer still reports the record with the settle bypassed,
 * AND only while the carrier it defers to really delivers. Both halves are checked below: `--raw`
 * (each comparer's own registry bypass) for the first, a STUNTED copy for the second.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every comparer case runs a real node child — fine alone, several times slower under the full suite,
 * where the 5 s default turned it into a timeout. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, content } from './_content';
import { deriveDefenses, ownedFeatureIds } from '../src/rules/derive';
import { featSituationalFor } from '../src/rules/situationalBonuses';
import type { Character } from '../src/rules/types';

const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

/* Parsed once — public/core.json is 8 MB and each stunt would otherwise pay for it again. */
const CORE = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8')) as Record<string, any>;

/** Run a comparer against a copy of the content with ONE carrier removed. Hook from batch 030/031/036. */
function withStuntedCore<T>(label: string, mutate: (core: Record<string, any>) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b037-i7-stunt-${label}.json`;
  const patched = structuredClone(CORE);
  mutate(patched);
  writeFileSync(join(CLI_ROOT, rel), JSON.stringify(patched));
  try {
    return run(['--core', rel]);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

const values = (ids: string, extra: string[] = []) => runScript('wg-values.mjs', ['--ids', ids, ...extra]);
const identity = (ids: string, extra: string[] = []) => runScript('wg-identity.mjs', ['--ids', ids, ...extra]);

describe('batch 037 instruments-7 — curse-of-turbulent-moments keeps the cursebound penalty as a star', () => {
  // batch 037: curse-of-turbulent-moments#conditional-penalty
  it('is quiet with the settle and reports all sixteen rows again with the settles bypassed', () => {
    /*
     * AoN mystery-23: *"You take a status penalty to your AC against attacks made against you from
     * reactions or free actions and a status penalty to saving throws against effects that would make
     * you fatigued or slowed equal to your cursebound value."* Both halves are conditional, so under
     * the owner's 2026-08-22 rule the value is a star, not a number — and WG's sixteen flat rows
     * (−1..−4 on AC and on all three saves) would penalise a cursebound Time oracle against everything.
     *
     * mutation-proof — stunts the settle key 'curse-of-turbulent-moments' in wg-values' SETTLED_VALUES
     * via `--raw`, the registry's own bypass. With the settle gone all sixteen rows come straight back,
     * so the settle is what silences them and is not redundant beside a carrier this comparer could
     * already read.
     */
    expect(values('curse-of-turbulent-moments')).toMatch(/compared 1 records with at least one comparable value; 1 agree on every one/);
    const raw = values('curse-of-turbulent-moments', ['--raw']);
    expect(raw).toMatch(/--- curse-of-turbulent-moments/);
    expect((raw.match(/^\s+MISSING\s+(ac\||save\|)/gm) ?? []).length).toBe(16);
    for (const key of ['ac\\|', 'save\\|fortitude', 'save\\|reflex', 'save\\|will']) {
      expect(raw).toMatch(new RegExp(`MISSING\\s+${key}\\s+theirs=4\\s+ours=\\(nothing\\)`));
    }
  }, 240_000);

  // batch 037: curse-of-turbulent-moments#conditional-penalty
  it('the printed sentence still reaches a built Time oracle as a star on AC and on all three saves', () => {
    /*
     * The carrier the settle defers to, on a really built character: situationalBonuses.ts:889
     * FEAT_SITUATIONAL['curse-of-turbulent-moments'] (authored in batch 034), read through
     * featSituationalFor over the feature ids the oracle actually owns. Both printed clauses, neither
     * of them a number.
     *
     * mutation-proof — the same read against an owned-id list with 'curse-of-turbulent-moments'
     * removed returns nothing on any of the four tracks, so these lines are coming from this record
     * and not from the mystery, the class or another owned feature.
     */
    const ch = build('oracle', 20, { subclassId: 'time' });
    const owned = [...ownedFeatureIds(ch, content())];
    expect(owned).toContain('curse-of-turbulent-moments');

    const ac = featSituationalFor(owned, { kind: 'ac' });
    expect(ac.map((l) => l.id)).toContain('curse-of-turbulent-moments');
    expect(ac.find((l) => l.id === 'curse-of-turbulent-moments')!.when).toMatch(/reactions or free actions/);
    expect(ac.find((l) => l.id === 'curse-of-turbulent-moments')!.bonus).toMatch(/cursebound value/);
    for (const save of ['fortitude', 'reflex', 'will']) {
      const lines = featSituationalFor(owned, { kind: 'save', save });
      expect(lines.map((l) => l.id)).toContain('curse-of-turbulent-moments');
      expect(lines.find((l) => l.id === 'curse-of-turbulent-moments')!.when).toMatch(/fatigued or slowed/);
    }

    const without = owned.filter((id) => id !== 'curse-of-turbulent-moments');
    expect(featSituationalFor(without, { kind: 'ac' }).map((l) => l.id)).not.toContain('curse-of-turbulent-moments');
    for (const save of ['fortitude', 'reflex', 'will']) {
      expect(featSituationalFor(without, { kind: 'save', save }).map((l) => l.id)).not.toContain('curse-of-turbulent-moments');
    }
  }, 240_000);
});

describe('batch 037 instruments-7 — echo-of-lost-moments keeps the printed 5th rung, Illusory Scene', () => {
  // batch 037: echo-of-lost-moments#fifth-rung
  it('the member settle drops only illusorydisguise, and a deleted illusory-scene is still reported', () => {
    /*
     * AoN apparition-5 prints the ladder *"… 4th Vision of Death - 5th Illusory Scene - 6th Phantasmal
     * Calamity …"*. WG's 5th rung is Illusory Disguise, a RANK-1 spell — their mistake, and the owner
     * ruled 2026-09-10 (desk #142) to keep the app.
     *
     * mutation-proof — 'echo-of-lost-moments' is stunted two ways. (1) `--raw` bypasses
     * SETTLED_IDENTITIES entirely and `illusorydisguise` comes straight back, so the settle is what
     * silences it. (2) A content copy with `dispel-magic` deleted from the apparition option's
     * grantedSpells is still reported WITH the settle in place — which is why the entry names the one
     * member instead of the `spells` bucket: a bucket-wide settle would have hidden that real gap.
     * (`dispel-magic` and not `illusory-scene`: the comparer only reports names THEIRS carries, and
     * the whole finding is that their 5th rung does not carry Illusory Scene.)
     */
    expect(identity('echo-of-lost-moments')).toMatch(/checked 1 records that grant a NAMED thing; 1 match on every one/);

    const raw = identity('echo-of-lost-moments', ['--raw']);
    expect(raw).toMatch(/--- echo-of-lost-moments/);
    expect(raw).toMatch(/spells\s+theirs-not-ours=\[illusorydisguise\]/);

    const stunted = withStuntedCore('echo-ladder', (core) => {
      for (const ec of core.classes.animist.extraChoices ?? []) {
        for (const o of ec.options ?? []) {
          if (o.id === 'echo-of-lost-moments') o.grantedSpells = (o.grantedSpells ?? []).filter((s: string) => s !== 'dispel-magic');
        }
      }
    }, (coreArg) => identity('echo-of-lost-moments', coreArg));
    expect(stunted).toMatch(/spells\s+theirs-not-ours=\[dispelmagic\]/);
    /* …and ONLY that one: the settled member stays settled while the real gap reports. */
    expect(stunted).not.toMatch(/illusorydisguise/);
  }, 240_000);
});

describe('batch 037 instruments-7 — otherworldly-protection works the resistance out, with no picker', () => {
  // batch 037: otherworldly-protection#computed-value
  it('a level-20 armor-innovation inventor gets 3 + half level with no question asked', () => {
    /*
     * AoN innovation-5, Otherworldly Protection: *"You gain resistance equal to 3 + half your level to
     * negative damage, or to positive damage if you have negative healing (such as if you're a
     * dhampir)."* Nothing there is a choice, which is standing rule R14 (owner, 2026-09-10, desk #147)
     * — so WG's "Select a Resistence" / "Select a Sanctification" pickers are a deliberate difference
     * and the harness's MISSING-CONTROL verdict is parked in work/experience-instrument-limits.json.
     *
     * mutation-proof — stunts the taught carrier `resistances` on classFeatures/otherworldly-protection
     * in an in-memory content copy; the same built inventor then shows none of these rows, so the park
     * defers to a carrier that is really delivering.
     */
    const db = content();
    const ch = build('inventor', 20, {
      subclassId: 'armor-innovation',
      inventorArmorStats: 'power-suit',
      inventorModifications: { initial: 'otherworldly-protection' },
    }) as Character;
    const rows = deriveDefenses(ch, db).resistances;
    const at = (type: string) => rows.find((r) => r.type === type);
    /* 3 + floor(20/2) = 13, worked out from the character rather than picked. */
    expect(at('spirit')?.value).toBe(13);
    expect(at('void')?.value).toBe(13);

    const stunted = { ...db, classFeatures: { ...db.classFeatures, 'otherworldly-protection': { ...db.classFeatures['otherworldly-protection'] } } };
    delete (stunted.classFeatures['otherworldly-protection'] as { resistances?: unknown }).resistances;
    const after = deriveDefenses(ch, stunted).resistances;
    expect(after.find((r) => r.type === 'spirit')).toBeUndefined();
    expect(after.find((r) => r.type === 'void')).toBeUndefined();
  }, 240_000);
});

describe('batch 037 instruments-7 — acute-vision grants darkvision only while raging', () => {
  // batch 037: acute-vision#while-raging
  it('a barbarian with Acute Vision has no darkvision at rest and gains it when Rage is on', () => {
    /*
     * AoN feat-5806: *"When you are raging, your visual senses improve, granting you darkvision."*
     * feats/acute-vision carries whileActive [{state:'rage', senses:[{name:'darkvision'}]}], which
     * derive.ts activeStateGrants gates on the live rage resource — so the harness, whose host never
     * rages, reads WG's `giveAbilityBlock "Darkvision"` as undelivered. Parked in
     * work/experience-instrument-limits.json; WG's permanent Darkvision is a deliberate difference.
     *
     * mutation-proof — stunts the taught carrier `whileActive` on feats/acute-vision in an in-memory
     * content copy: the raging barbarian then has no darkvision either, so the assertion is reading
     * this clause and not a sense the ancestry or another feat supplies.
     */
    const db = content();
    const base = { ...build('barbarian', 20), feats: [{ featId: 'acute-vision', level: 1, category: 'class' as const }] } as Character;
    const hasDarkvision = (c: Character, content_ = db) =>
      deriveDefenses(c, content_).senses.some((s) => /darkvision/i.test(s.name));

    expect(hasDarkvision({ ...base, classResources: { ...(base.classResources ?? {}), rage: 0 } })).toBe(false);
    const raging = { ...base, classResources: { ...(base.classResources ?? {}), rage: 1 } };
    expect(hasDarkvision(raging)).toBe(true);

    const stunted = { ...db, feats: { ...db.feats, 'acute-vision': { ...db.feats['acute-vision'] } } };
    delete (stunted.feats['acute-vision'] as { whileActive?: unknown }).whileActive;
    expect(hasDarkvision(raging, stunted)).toBe(false);
  }, 240_000);
});

describe('batch 037 instruments-7 — favored-terrain, born-of-animal and gleaming-blade need no instrument', () => {
  // batch 037: favored-terrain#conditional-speed
  it('favored-terrain, born-of-animal and gleaming-blade are already clean on every comparer', () => {
    /*
     * Three findings whose answer is "nothing changes" and whose comparers already agree — so no
     * settle was written for any of them. A settle nobody needs is the failure mode this registry's
     * own headers warn about, and this test is the guard that keeps the absence deliberate: if a
     * comparer starts reporting one of these, it is a REAL difference to read, not a settle to add.
     *
     *   favored-terrain    AoN feat-4866 gates the Plains +10-foot status bonus on the unimpeded
     *                      journey class feature AND on being in the terrain; ours is a star naming
     *                      both conditions (owner 2026-09-10, desk #24).
     *   born-of-animal     AoN heritage-412 *"If you have both hands free, you can increase your Speed
     *                      to 30 feet as you run on all fours"*; ours is a star, theirs a flat +5
     *                      (owner 2026-09-10, desk #116).
     *   gleaming-blade     AoN ikon-6 names the transcendence *Flowing Spirit Strike*; theirs says
     *                      Mirrored Spirit Strike, which appears nowhere in the archive (owner
     *                      2026-09-10, desk #135). classFeatures/gleaming-blade grants the printed
     *                      name through grantsClassFeatures ['flowing-spirit-strike'].
     */
    const ids = 'favored-terrain,born-of-animal,gleaming-blade';
    expect(values(ids)).toMatch(/0 records with at least one value to adjudicate/);
    expect(identity(ids)).toMatch(/0 records where a named thing on their side has no counterpart on ours/);
    expect(content().classFeatures['gleaming-blade'].grantsClassFeatures).toContain('flowing-spirit-strike');
    expect(featSituationalFor(['born-of-animal'], { kind: 'speed' })[0]?.bonus).toMatch(/30 feet/);
  }, 240_000);
});
