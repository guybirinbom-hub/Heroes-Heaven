/**
 * BATCH 032 — THE CLOSER'S TWO INSTRUMENT TEACHES, both on one record: feats/improved-elemental-blast.
 *
 * The engine family built the mechanic (Feat.blastDiceBonus + its reader in deriveBlastStrikes, plus
 * the archetype blast itself) and pinned it on a BUILT character in test/batch032-engine.test.ts. Both
 * failures the gate then reported are INSTRUMENT failures — the record is right and neither comparer
 * could see it:
 *
 *   KINDS       their `adjValue KINETICIST_BLAST_DICE = 1` maps to no kind at all (`unmapped`), so
 *               wg-diff reported `improved-elemental-blast missing=[unmapped]` however we model it.
 *   EXPERIENCE  the blast STRIKE exists only once the element pick is answered, and the harness builds
 *               every host with its controls empty (this record's host is a fighter holding Kineticist
 *               Dedication, `answered: []`), so the with/without differential moved nothing and no
 *               predicate could read a die count off the surface.
 *
 * A settle and a predicate are only legitimate while each still reports on a STUNTED copy — otherwise
 * they have stopped comparing and started asserting. Both cases below prove that: wg-diff's own `--raw`
 * bypass for the settle, and a surface with the carrier removed for the predicate.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* wg-diff is a real node child that reads the whole dump and all of core.json. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { effectDelivery, judgeDelivery } from '../scripts/lib/wg-experience-lanes.mjs';
import { build } from './_content';

const CLI_ROOT = join(__dirname, '..');

/** wg-diff's THEY-ONLY bucket, read from `--out`: the printed list is capped and would call a
 *  still-reported record "quiet". Harness copied from test/batch031-closer.test.ts. */
function theyOnly(extra: string[] = []): Map<string, string[]> {
  const rel = `work/.b032-closer-diff-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
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

describe('batch 032 closer — the improved-elemental-blast kind settle', () => {
  // batch 032: improved-elemental-blast
  it('improved-elemental-blast is quiet with the settle and reports missing=[unmapped] again with settles bypassed', () => {
    /* AoN feat-4337: "The damage of your elemental blast increases by one die." We now carry that as
     * feats/improved-elemental-blast.blastDiceBonus = 1, summed over c.feats by deriveBlastStrikes so
     * the Special (a second taking at 14th, a third at 18th) needs no further data. Their variable
     * KINETICIST_BLAST_DICE has no kind on this comparer, exactly like MARTIAL_EXPERIENCE, so the
     * carrier can never answer it and the settle is the only honest way to close the record.
     *
     * mutation-proof — stunts the settle key 'improved-elemental-blast' in wg-diff's
     * VERIFIED_EQUIVALENT by running the comparer under `--raw`, the registry's own bypass. With the
     * settle gone the record goes straight back to THEY-ONLY with the same missing kind, so the settle
     * is doing the silencing and is not redundant beside a field the comparer can already read.
     */
    expect(theyOnly().has('improved-elemental-blast')).toBe(false);
    expect(theyOnly(['--raw']).get('improved-elemental-blast')).toEqual(['unmapped']);
  }, 240_000);
});

describe('batch 032 closer — the improved-elemental-blast blast-dice surface predicate', () => {
  const eff = (variable: string, value: unknown = 1) =>
    ({ type: 'adjValue', variable, valueBearing: true, gate: 'open', inOption: false, data: { variable, value } });
  /* What the harness writes for this record's host: a fighter holding Kineticist Dedication with the
   * element pick UNANSWERED, so there is no blast strike anywhere on the sheet to measure. */
  const bare = { stars: {}, proficiencies: {}, spellcasting: [] as { proficiency: string }[], featNames: [], featureNames: [], spellNames: [], languages: [], traits: [] };

  // batch 032: improved-elemental-blast
  it('improved-elemental-blast: KINETICIST_BLAST_DICE is delivered by the record carrying blastDiceBonus, and undelivered without it', () => {
    /* mutation-proof — the stunted copy is the surface with the record's own carrier removed
     * (blastDiceBonus 0, which is what every record that is NOT improved-elemental-blast produces).
     * The predicate then reports `undelivered`, so it is reading the carrier rather than asserting
     * that anyone writing this variable is fine. `unchecked` is kept for an artefact written before the
     * field existed — an absence of measurement, never a pass.
     */
    expect(effectDelivery(eff('KINETICIST_BLAST_DICE'), { ...bare, blastDiceBonus: 1 }, {})).toBe('delivered');
    expect(effectDelivery(eff('KINETICIST_BLAST_DICE'), { ...bare, blastDiceBonus: 0 }, {})).toBe('undelivered');
    expect(effectDelivery(eff('KINETICIST_BLAST_DICE'), bare, {})).toBe('unchecked');
    // …and the same through judgeDelivery, which is what scripts/wg-experience.mjs actually calls.
    expect(judgeDelivery([eff('KINETICIST_BLAST_DICE')], { ...bare, blastDiceBonus: 1 }, {}).delivered).toHaveLength(1);
    expect(judgeDelivery([eff('KINETICIST_BLAST_DICE')], { ...bare, blastDiceBonus: 0 }, {}).undelivered).toHaveLength(1);
  });

  // batch 032: improved-elemental-blast
  it('improved-elemental-blast: the carrier the predicate reads is the one core.json ships', () => {
    /* The predicate is only honest while `blastDiceBonus` is the field the record really carries —
     * scripts/wg-experience.mjs reads it straight off core.json. If a regeneration ever drops the
     * overlay row, this fails here rather than turning the gate silently green. */
    const core = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8')) as Record<string, Record<string, { blastDiceBonus?: number }>>;
    expect(core.feats['improved-elemental-blast'].blastDiceBonus).toBe(1);
  }, 60_000);
});

/*
 * THE ONE FINDING THAT FELL BETWEEN TWO FAMILIES.
 *
 * magical-knowledge#master-precondition was declared a CROSS-FILE GAP by the engine family (the file is
 * src/rules/featGrantsLane.ts, not theirs) and left alone by gap-engine, whose open lines did not name
 * it — so the record derived FIXED off its two built siblings while a printed clause shipped unbuilt.
 * Both readers were verified to exist by the engine builder AND its adversarial verifier
 * (src/rules/build.ts:5813 and src/builder/Builder.tsx:171 both compute
 * `maxRank(current, base) === current ? upgraded : base`), so this is the one-line data edit they
 * described and nothing more.
 */
describe('batch 032 closer — magical-knowledge raises the master slot only from expert', () => {
  /** A level-8 fighter trained in Arcana and Nature, holding the feat with both slots answered. */
  const mk = (over: Record<string, unknown> = {}) =>
    build('fighter', 8, {
      keyAbility: 'str',
      classSkills: ['arcana', 'nature'],
      featPicks: { '8:class:0': 'magical-knowledge' },
      featSkillChoices: { 'magical-knowledge:0': 'arcana', 'magical-knowledge:1': 'nature' },
      ...over,
    } as never);

  // batch 032: magical-knowledge#master-precondition
  it('magical-knowledge: a character only TRAINED in the picked skill reaches expert, not master', () => {
    /* AoN feat-8402 (the record's own aonId; feat-4720, cited here at first, is Anthropomorphic Shape):
     * "Increase your proficiency rank in one of Arcana, Nature, Occultism, or Religion
     * FROM EXPERT TO MASTER and in another from trained to expert." A flat `rank: 'master'` on slot 0
     * ignored the precondition and handed master to a merely trained character. */
    expect(mk().proficiencies.skills.arcana).toBe('expert');
  });

  // batch 032: magical-knowledge#master-precondition
  it('magical-knowledge: a character already EXPERT in the picked skill reaches master', () => {
    // Two of the fighter's skill increases spent on Arcana would overshoot; ONE (level 3) makes it expert.
    expect(mk({ skillIncreases: { 3: 'arcana' } }).proficiencies.skills.arcana).toBe('master');
  });
});
