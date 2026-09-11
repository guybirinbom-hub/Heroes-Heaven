/*
 * BATCH 037 — THE INSTRUMENT LANE (WG-COMPARISON family), CHUNK instruments-2.
 *
 * Twelve findings, every one of them CONFIRMED "nothing changes — the book wins and Wanderer's Guide
 * differs on purpose". They split three ways by what the instruments actually say:
 *
 *   spore-order#leaf-order-membership       wg-identity reports `grants theirs-not-ours=[leaforder]`
 *   cultivation-order#leaf-order-membership because print says the order COUNTS AS a leaf druid and
 *                                           WG has no "counts as" verb, so it hands over the whole
 *                                           Leaf Order feature. SETTLED_IDENTITIES, MEMBER scope.
 *   animist#slot-table                      wg-casting reports six slot rows at levels 13–18 because
 *   animist-apparition-spellcasting#…       WG's apparition ladder opens each rank one level late.
 *                                           SETTLED_CASTING, one key per ROW.
 *   the other eight                         no instrument change — no comparer reports them at all,
 *                                           with settles bypassed as well as with them live.
 *
 * A settle is legitimate only while the comparer still reports the record with the settle BYPASSED,
 * and only while the carrier it defers to really delivers. Both halves are checked below: `--raw`
 * (each comparer's own registry bypass) for the first, a really built character for the second.
 *
 * The eight residual reads get the opposite guard: nothing is settled for them, so what is pinned is
 * the MEASUREMENT the ruling rests on. The day one of them starts reporting, this file fails and the
 * difference gets read — which is what a pre-installed settle would have destroyed.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every comparer case runs a real node child — fine alone, several times slower under the full suite,
 * where the 5 s default turned it into a timeout. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build, content } from './_content';
import { checkPrerequisites } from '../src/rules/build';
import { apparitionSlots } from '../src/rules/spellcasting';

const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

const identity = (ids: string, extra: string[] = []) => runScript('wg-identity.mjs', ['--ids', ids, ...extra]);
const values = (ids: string, extra: string[] = []) => runScript('wg-values.mjs', ['--ids', ids, ...extra]);

/* wg-casting imports the TypeScript engine to build a real character at every level, so it runs
 * through jiti — the same route test/wg-experience-lanes.test.ts uses for it. */
function animistMismatches(extra: string[] = []): string[] {
  const rel = `work/.b037-i2-casting-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
  try {
    try {
      execFileSync(
        process.execPath,
        [join(CLI_ROOT, 'node_modules/jiti/lib/jiti-cli.mjs'), join(CLI_ROOT, 'scripts/wg-casting.mjs'), '--class', 'animist', '--out', rel, ...extra],
        { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 },
      );
    } catch (e: unknown) {
      /* the comparer exits 1 on any mismatch and writes the file FIRST; the file is the evidence */
      if ((e as { stdout?: string }).stdout == null) throw e;
    }
    const out = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8')) as
      { classes: { classId: string; mismatches: { kind: string; level?: number; rank?: number }[] }[] };
    return (out.classes.find((c) => c.classId === 'animist')?.mismatches ?? [])
      .map((m) => `${m.kind}|${m.level ?? ''}|${m.rank ?? ''}`);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/* ------------------------------------------------------------------ the two leaf-order variants */

describe('batch 037 instruments-2 — spore-order and cultivation-order count as leaf druids without being handed the Leaf Order feature', () => {
  /*
   * Print, druidic-order-13 (spore) and druidic-order-12 (cultivation): *"…is a variant of the leaf
   * order. If you have the <x> order, you count as a member of the leaf order, and you qualify for leaf
   * order feats."* A membership, not a grant. WG has no "counts as" verb, so both rows carry
   * `giveAbilityBlock #34226 "Leaf Order"` — the whole feature, familiar and order spell included.
   * Owner ruled 2026-09-10 (desk #134/#139 and #144, answer B): the membership is already known, nothing
   * is blocked, and their copy of the feature must not be imported.
   */
  // batch 037: spore-order#leaf-order-membership
  // batch 037: cultivation-order#leaf-order-membership
  it('spore-order and cultivation-order are quiet on wg-identity, and report `leaforder` again with settles bypassed', () => {
    /*
     * mutation-proof — stunts the settle keys "spore-order" and "cultivation-order" in wg-identity's
     * SETTLED_IDENTITIES via `--raw`, the registry's own bypass. With the settles gone both records go
     * straight back to reporting `grants theirs-not-ours=[leaforder]`, so the settles are what silences
     * them and are not merely redundant beside something the comparer could already read.
     */
    expect(identity('spore-order,cultivation-order')).toMatch(/checked 2 records that grant a NAMED thing; 2 match on every one/);
    const raw = identity('spore-order,cultivation-order', ['--raw']);
    expect(raw).toMatch(/--- spore-order[\s\S]*?grants\s+theirs-not-ours=\[leaforder\]/);
    expect(raw).toMatch(/--- cultivation-order[\s\S]*?grants\s+theirs-not-ours=\[leaforder\]/);
    expect(raw).toMatch(/2 records where a named thing on their side has no counterpart on ours/);
  });

  // batch 037: spore-order#leaf-order-membership
  // batch 037: cultivation-order#leaf-order-membership
  it('spore-order and cultivation-order hold the leaf-order membership, and flame-order does not', () => {
    /*
     * The carrier the settle defers to: PARENT_ORDER in the prerequisite checker
     * (src/rules/build.ts:10111), which adds 'leaf-order' to a spore or cultivation druid's `has` set.
     * Ten records print prerequisite "leaf order" (leshy-familiar, forest-passage, leshy-familiar-secrets,
     * grown-of-oak, green-empathy, floral-restoration, garland-spell, verdant-metamorphosis,
     * impaling-briars, plus plant-shape's "leaf order or Untamed Form").
     *
     * On the SHIPPED data nobody is refused any of them, and that is the owner's answer B — know the
     * membership, block nothing — because the has-feat branch enforces only when the prerequisite
     * resolves to a real feat id (build.ts:10157) and there is no feats['leaf-order'] to resolve to.
     * So a test that only asserted "spore-order is not blocked" would pass against a DELETED
     * PARENT_ORDER and prove nothing. The membership is read on an in-memory content copy that DOES
     * carry a feat of that id, which turns the line on: the two variants pass it and flame-order is
     * refused, which is the difference PARENT_ORDER makes and nothing else could.
     */
    const db = content();
    const LEAF = ['leshy-familiar', 'forest-passage', 'leshy-familiar-secrets', 'grown-of-oak', 'green-empathy',
      'floral-restoration', 'garland-spell', 'verdant-metamorphosis', 'impaling-briars'];
    for (const order of ['spore-order', 'cultivation-order', 'flame-order']) {
      const druid = build('druid', 20, { subclassId: order });
      for (const id of LEAF) {
        expect(checkPrerequisites(db.feats[id]!, druid, db).unmet, `shipped ${order} → ${id}`).toEqual([]);
      }
    }
    /* The blocking case, built in memory: give the membership something to resolve against. */
    const armed = { ...db, feats: { ...db.feats, 'leaf-order': { ...db.feats['leshy-familiar']!, id: 'leaf-order', name: 'Leaf Order', prerequisites: [] } } };
    for (const order of ['spore-order', 'cultivation-order']) {
      const druid = build('druid', 20, { subclassId: order });
      expect(checkPrerequisites(armed.feats['leshy-familiar']!, druid, armed).unmet, `armed ${order}`).toEqual([]);
    }
    const flame = build('druid', 20, { subclassId: 'flame-order' });
    expect(checkPrerequisites(armed.feats['leshy-familiar']!, flame, armed).unmet).toEqual(['leaf order']);
  });

  // batch 037: spore-order#leaf-order-membership
  it('the spore-order settle names one token, so the record keeps every other grant under comparison', () => {
    /*
     * Scope, checked rather than asserted: the entry is `['leaforder']`, a MEMBER key, never the
     * `grants` bucket. wg-identity drops a whole bucket only when the entry names the bucket
     * (scripts/wg-identity.mjs, `settled.includes(bucket)`), so our own `leshyfamiliar` grant — the
     * record's second printed sentence, *"Your familiar must be a fungus leshy"* — is still read and
     * still compared, and so is every other named thing their row might grow.
     */
    const reg = readFileSync(join(CLI_ROOT, 'scripts/wg-identity.mjs'), 'utf8');
    expect(reg).toContain("'spore-order': ['leaforder'],");
    expect(reg).toContain("'cultivation-order': ['leaforder'],");
    expect(reg).not.toContain("'spore-order': ['grants']");
    expect(identity('spore-order', ['--verbose'])).toMatch(/ok\s+spore-order\s+\(\d+ identities agree\)/);
  });
});

/* ------------------------------------------------------------------------------ the animist table */

describe('batch 037 instruments-2 — animist spell slots are the printed table, not WG one-level-late apparition ladder', () => {
  /*
   * Print, the Animist Spells per Day table (class-64, War of Immortals): its 7th-rank column reads
   * "1+1" at 13, "2+1" at 14–16 and "2+2" at 17–18, and the table's note explains the plus — *"The
   * number before a plus sign indicates your spell slots via animist spellcasting, and the number after
   * it indicates your spell slots from apparition spellcasting."* So thirteenth level is TWO 7th-rank
   * slots, not one. WG's ANIMIST_APPARITION source opens each new rank one level late, which costs them
   * exactly one slot at the top rank of 13 through 18 and nothing anywhere else.
   *
   * Owner ruled 2026-09-10 (desk #4 and #105): the book wins on both halves — the slot TABLE and the
   * LEVELS the 7th, 8th and 9th ranks arrive at.
   */
  const SETTLED = ['slots|13|7', 'slots|14|7', 'slots|15|8', 'slots|16|8', 'slots|17|9', 'slots|18|9'];

  // batch 037: animist#slot-table
  // batch 037: animist-apparition-spellcasting#slot-levels
  it('animist is clean on wg-casting, and all six rows come back with settles bypassed', () => {
    /*
     * mutation-proof — stunts the settle key "animist" in wg-casting's SETTLED_CASTING via `--raw`, the
     * bypass added beside the registry. With it the six rows return and nothing else does: the settle is
     * what silences them, it silences exactly them, and any seventh animist casting difference — another
     * level, another rank, a cantrip count, a tradition — would still report.
     */
    expect(animistMismatches()).toEqual([]);
    expect(animistMismatches(['--raw']).sort()).toEqual([...SETTLED].sort());
  });

  // batch 037: animist#slot-table
  it('a built animist gets the printed 7th/8th/9th-rank counts at levels 13 to 18', () => {
    /*
     * The engine half, on really built characters rather than on a comparer. The animist pool and the
     * apparition pool are separate entries, and the table's "X+Y" is their sum, so the assertion is on
     * the sum — which is the number WG is one short of.
     */
    /* The prepared entry counts its `prepared[rank]` openings; the spontaneous apparition pool counts
     * `slots[rank].max` — the same two readings wg-casting's ourSlotsByRank makes (scripts/wg-casting.mjs:184). */
    const total = (level: number, rank: number) => {
      const ch = build('animist', level);
      return ch.spellcasting.reduce((n, e) => {
        if (e.type === 'prepared') return n + (e.prepared?.[rank]?.length ?? 0);
        if (e.type === 'spontaneous') return n + (e.slots?.[rank]?.max ?? 0);
        return n;
      }, 0);
    };
    expect(total(13, 7)).toBe(2); // print "1+1"
    expect(total(14, 7)).toBe(3); // print "2+1"
    expect(total(15, 8)).toBe(2);
    expect(total(16, 8)).toBe(3);
    expect(total(17, 9)).toBe(2);
    expect(total(18, 9)).toBe(3);
  });

  // batch 037: animist-apparition-spellcasting#slot-levels
  it('the apparition ladder opens the 7th, 8th and 9th ranks at 13, 15 and 17 — the class table rows', () => {
    /*
     * The class table prints "7th-rank spells" at 13, "8th-rank spells" at 15 and "9th-rank spells" at
     * 17, and the apparition column opens with them. WG's opens at 14, 16 and 18. src/rules/spellcasting.ts
     * APPARITION_SLOTS is the carrier; reading it here is what makes the settle above scoped to a
     * DIFFERENCE OF OPINION about the table rather than to an unread lane.
     */
    expect(apparitionSlots(12)[7]).toBeUndefined();
    expect(apparitionSlots(13)[7]).toBe(1);
    expect(apparitionSlots(14)[8]).toBeUndefined();
    expect(apparitionSlots(15)[8]).toBe(1);
    expect(apparitionSlots(16)[9]).toBeUndefined();
    expect(apparitionSlots(17)[9]).toBe(1);
  });
});

/* ------------------------------------------------------------------------- the eight residual reads */

/*
 * Each is a CONFIRMED "nothing changes" finding whose record every instrument already reports clean.
 * No settle is authored for any of them, deliberately: a settle that answers nothing is a trap, because
 * it silences the NEXT difference on that record unread. What is pinned instead is the measurement.
 */
const RESIDUAL = ['total-power', 'necromantic-tenacity', 'sequestered-spell', 'divine-breadth',
  'primal-breadth', 'occult-breadth', 'sponsored-by-a-village', 'sponsored-by-teacher-ot'];

describe('batch 037 instruments-2 — total-power, necromantic-tenacity, sequestered-spell, the three Breadth feats and the two sponsored backgrounds: no settle authored', () => {
  // batch 037: total-power#classification-choice
  // batch 037: sponsored-by-a-village#rarity
  // batch 037: sponsored-by-teacher-ot#rarity
  it('the value lane agrees with every number on total-power, sponsored-by-a-village and sponsored-by-teacher-ot, settles bypassed', () => {
    /*
     * total-power: background-578 prints *"If you choose dragon, you gain the Blasting Beams deviant
     * feat with the electricity type. If you choose troll, you gain the Bone Spikes deviant feat."* —
     * two branches; WG's row is troll-only. The ATTRIBUTE numbers both sides do state agree, which is
     * why nothing to settle: the branch is a choice lane, not a value.
     *
     * The two backgrounds print no rarity trait at all and are common by the general rule, while WG
     * rates all five backgrounds of that free adventure guide uncommon. Rarity is compared by NO
     * instrument, so there is nothing to settle there either — the reading is the whole answer.
     *
     * `--raw` on purpose: with the registries bypassed, "0 records with at least one value to
     * adjudicate" is a statement about the DATA and not about a settle someone installed earlier.
     */
    const out = values('total-power,sponsored-by-a-village,sponsored-by-teacher-ot', ['--raw', '--verbose']);
    expect(out).toMatch(/compared 3 records with at least one comparable value; 3 agree on every one/);
    expect(out).toMatch(/0 records with at least one value to adjudicate/);
    const db = content();
    expect(db.backgrounds['sponsored-by-a-village']!.rarity ?? 'common').toBe('common');
    expect(db.backgrounds['sponsored-by-teacher-ot']!.rarity ?? 'common').toBe('common');
  });

  // batch 037: necromantic-tenacity#trigger
  // batch 037: divine-breadth#no-cantrip
  // batch 037: primal-breadth#no-cantrip
  // batch 037: occult-breadth#no-cantrip
  it('necromantic-tenacity and the three Breadth feats assert no number WG can disagree with, and grant no named thing we lack', () => {
    /*
     * necromantic-tenacity (feat-886) prints *"If you roll a success on a saving throw against a
     * necromancy effect, you get a critical success instead; if you roll a critical failure on such a
     * save, you get a failure instead."* Ours is that wording as degreeShifts; WG triggers on the death
     * or void traits instead. Their three `addBonusToValue SAVE_*` carry no value, so the lane reads
     * them as prose — nothing to adjudicate, and the trigger word is not a number.
     *
     * Divine / Primal / Occult Breadth (feat-5070, feat-5078 and its occult twin) print only *"Increase
     * the spell slots you gain from <class> archetype feats by 1 for each spell rank other than your two
     * highest <class> spell slots."* No cantrip. WG's three rows share one copied extra-cantrip entry.
     * Ours carries spellSlotBonus and no cantrip, and the kind lane already AGREES on all three — the
     * cantrip is theirs alone, which is a divergence to record, not a gap to settle.
     */
    const out = values(RESIDUAL.join(','), ['--raw', '--verbose']);
    expect(out).toMatch(/0 records with at least one value to adjudicate/);
    expect(out).toMatch(/prose-only bonus \(no number asserted\)/);
    expect(identity(RESIDUAL.join(','), ['--raw'])).toMatch(/0 records where a named thing on their side has no counterpart on ours/);
    const db = content();
    for (const id of ['divine-breadth', 'primal-breadth', 'occult-breadth']) {
      expect(db.feats[id]!.spellSlotBonus, id).toBeTruthy();
      expect(JSON.stringify(db.feats[id]), id).not.toMatch(/cantrip/i);
    }
  });

  // batch 037: sequestered-spell#innate-proficiency
  it('sequestered-spell keeps the one tradition-narrowed picker and the general innate-spell proficiency', () => {
    /*
     * rules-2232 (Player Core p. 298, Innate Spells): *"When you gain an innate spell, you become
     * trained in the spell attack modifier and spell DC statistics. At 12th level, these proficiencies
     * increase to expert."* WG splits the one cantrip into four tradition-gated pickers and steps the
     * proficiency on a level-4 condition instead. Ours asks once, narrowed to the surki's recorded
     * tradition, and takes the proficiency from the general rule — which is why their two ops are
     * SPELL_ATTACK / SPELL_DC, already recorded in wg-values' NOT_A_SCALAR as a rank our side derives
     * from the granted entry rather than a per-record number. No settle: nothing reports.
     */
    const db = content();
    const rec = db.feats['sequestered-spell']!;
    expect((rec.effectChoices ?? []).length).toBe(1);
    expect(values('sequestered-spell', ['--raw', '--verbose'])).toMatch(/not a scalar we hold: SPELL_ATTACK/);
  });
});
