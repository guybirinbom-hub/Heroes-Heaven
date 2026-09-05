import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { characterSituationalIds, explainStat, recordMarkersFor } from '../src/rules/explain';
import { featSituationalFor, FEAT_SITUATIONAL, RECORD_MARKERS, type DegreeShift, type SituationalTarget } from '../src/rules/situationalBonuses';
import type { Character } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 29, the SIBLING sweep of the situational lane.
 *
 * Batch 29's situational finding deleted `disciplined-mind` — a registry line that restated the
 * record's own `degreeShifts` successToCrit and so drew a second, identically-sourced star on the
 * Will row — and added the Overdrive/Swim carriers. Its verifier found the same three shapes on
 * records outside the batch. The owner's rule is "turn every finding into a guard, not a report", so
 * the duplicate-star half here is a GENERIC WALK over every successToCrit record rather than four
 * more hand-written assertions: the four known offenders are only its regression seed.
 */
const db = content();

/** A character holding feats by id, the route `characterSituationalIds` reads first. */
const withFeats = (featIds: string[], classId = 'fighter', level = 7): Character => {
  const base = build(classId, level);
  return {
    ...base,
    feats: [...base.feats, ...featIds.map((featId, i) => ({ featId, level, slot: `b29s:${i}` }))],
  } as unknown as Character;
};

/** The `when :: bonus` strings one record puts on a stat row, as the sheet reads them. */
const stars = (c: Character, ref: { kind: string; skill?: string; save?: string }, sourceId: string) =>
  featSituationalFor(characterSituationalIds(c, db), ref)
    .filter((s) => s.id === sourceId)
    .map((s) => `${s.when} :: ${s.bonus}`);

describe('GUARD: no registry clause restates a record\'s own successToCrit degreeShift', () => {
  /*
   * The defect this walks for is invisible from either side alone: the registry line reads fine, and
   * the record's `degreeShifts` reads fine, but `entriesFor` returns shipped ⧺ authored and neither
   * text pools — so the player's save row carries the same sentence twice under the same source name.
   * Four records shipped it (chemical-hardiness, churning-mind, commanding-will, confident-evasion)
   * beside the three already deleted by hand. A per-id test would have caught the fifth never.
   */

  /** Every record in the database, flattened, so a FEAT_SITUATIONAL id can be found in any bucket. */
  const recordsById = new Map<string, { degreeShifts?: DegreeShift[] }>();
  for (const bucket of Object.values(db as unknown as Record<string, unknown>)) {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
    for (const [id, rec] of Object.entries(bucket as Record<string, unknown>)) {
      if (rec && typeof rec === 'object' && !recordsById.has(id)) recordsById.set(id, rec as { degreeShifts?: DegreeShift[] });
    }
  }

  /** Does a clause target land on a surface this shift already stars? */
  const overlaps = (shift: DegreeShift, t: SituationalTarget): boolean => {
    const listHas = (list: string[] | undefined, detail: string | undefined) =>
      !!list && (list.includes('all') || detail === 'all' || (!!detail && list.includes(detail)));
    if (t.kind === 'save') return listHas(shift.saves, t.detail) || !!shift.savesFromChoice;
    if (t.kind === 'skill') return listHas(shift.skills, t.detail);
    if (t.kind === 'perception') return !!shift.perception;
    return false;
  };

  // "a success … critical success", "the success upgrades to a critical success", "crit success".
  const RESTATES = /(succes\w*[^.]{0,40}crit\w*\s+succes)|(crit\w*\s+succes[^.]{0,40}succes)/i;

  it('is at zero — and names the precedent when it is not', () => {
    const offenders: string[] = [];
    let inspected = 0;
    for (const [id, clauses] of Object.entries(FEAT_SITUATIONAL)) {
      const shifts = (recordsById.get(id)?.degreeShifts ?? []).filter((d) => d.shift === 'successToCrit');
      if (!shifts.length) continue;
      inspected++;
      for (const clause of clauses) {
        const text = `${clause.when} ${clause.bonus}`;
        if (!RESTATES.test(text)) continue;
        if (!clause.targets.some((t) => shifts.some((s) => overlaps(s, t)))) continue;
        offenders.push(`${id}: "${clause.when} :: ${clause.bonus}"`);
      }
    }
    expect(
      offenders,
      `These FEAT_SITUATIONAL clauses restate their own record's degreeShifts successToCrit on the ` +
        `same row, so the sheet draws the star twice under one source name. Delete the clause (the ` +
        `record's own field is the carrier) and name the id in apply-situational-lane.mjs's ` +
        `handEdited set, as fluid-contortionist, combination-finisher and disciplined-mind were:\n` +
        offenders.join('\n'),
    ).toEqual([]);
    /* A walk that matches nothing passes forever. 81 registry ids sit on a successToCrit record
     * today; the floor only has to prove the join still joins — if an id scheme, a bucket name or
     * the degreeShifts field moves, this fails instead of going quietly green. */
    expect(inspected, 'the walk still finds the successToCrit records it is meant to police').toBeGreaterThan(60);
  });

  it('the two clauses the guard found beside the four keep their OWN printed bonus', () => {
    /* Neither of these was deletable: each prints a real bonus that has no other carrier, folded
     * into the same clause as the restatement. The guard's job is not "delete the row" — it is "the
     * upgrade is stated once", so both were TRIMMED to their own sentence (the lethoci edit). A
     * blanket deletion here would have silently dropped two printed +1s. */
    const emo = stars(withFeats(['emotionless']), { kind: 'save', save: 'will' }, 'emotionless');
    expect(emo).toEqual(['against emotion and fear effects :: +1 circumstance']);
    const deck = FEAT_SITUATIONAL['hardened-harrow-deck'];
    expect(deck).toHaveLength(1);
    expect(deck[0].bonus, "print's fallback, the one thing degreeShifts cannot say").toContain('+1 circumstance');
    expect(deck[0].when).toContain('already upgrades your fear saves');
  });

  it('the four deleted siblings still star their save exactly once, from the record', () => {
    // class-feature-832 / inventor 11th / class-feature-1103 / class-feature-1020, each printing
    // "When you roll a success on a <save> save, you get a critical success instead." once.
    const cases: [string, string, string, number][] = [
      ['chemical-hardiness', 'alchemist', 'fortitude', 11],
      ['churning-mind', 'inventor', 'will', 11],
      ['commanding-will', 'commander', 'will', 11],
      ['confident-evasion', 'swashbuckler', 'reflex', 7],
    ];
    for (const [id, classId, save, level] of cases) {
      expect(FEAT_SITUATIONAL[id], `${id}'s registry copy is deleted`).toBeUndefined();
      expect(db.classFeatures[id].degreeShifts?.[0].shift, `${id} keeps the real carrier`).toBe('successToCrit');
      const c = build(classId, level);
      expect(characterSituationalIds(c, db), `${classId} owns ${id} at ${level}`).toContain(id);
      const lines = (explainStat(c, db, { kind: 'save', save }).situational ?? []).filter((s) => s.sourceId === id);
      expect(lines.length, `one ${save} line for ${id}, not two`).toBe(1);
      expect(lines[0].text).toContain('a success is a critical success instead');
    }
  });

  it('the generated lane cannot resurrect any of the four', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('scripts/apply-situational-lane.mjs', 'utf8');
    const set = src.slice(src.indexOf('const handEdited'), src.indexOf(']);', src.indexOf('const handEdited')));
    for (const id of ['chemical-hardiness', 'churning-mind', 'commanding-will', 'confident-evasion']) {
      expect(set, `${id} in the exclusion list`).toContain(`'${id}'`);
    }
  });
});

describe('quick-climb: the Climb distance reaches the Climb row', () => {
  /* feat-5192: "When Climbing, you move 5 more feet on a success and 10 more feet on a critical
   * success, up to your Speed." The sibling of quick-swim (feat-5200), and modelled the same way —
   * only the legendary climb-Speed half had a carrier. */
  it('marks the Climb action with the distance, and only for a character who has it', () => {
    const marks = recordMarkersFor(withFeats(['quick-climb']), db, 'action', 'climb').filter((m) => m.sourceId === 'quick-climb');
    expect(marks.length).toBe(1);
    expect(marks[0].value).toContain('+5 feet');
    expect(marks[0].note).toContain('10 more feet on a critical success');
    expect(marks[0].note).toContain('up to your Speed');
    expect(recordMarkersFor(build('fighter', 7), db, 'action', 'climb').some((m) => m.sourceId === 'quick-climb')).toBe(false);
  });

  it("is keyed to the slugged action NAME, the key MainTab and StatDetailModal look marks up by", () => {
    const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    for (const m of RECORD_MARKERS['quick-climb']) {
      expect(m.on).toBe('action');
      const row = db.actions[m.id];
      expect(row, 'quick-climb marks a real action row').toBeTruthy();
      expect(slug(row.name)).toBe(m.id);
    }
  });
});

describe('the Overdrive damage ladder: one live rung at a time', () => {
  /* class-feature-484 (3rd): "on a successful use of Overdrive, you increase the additional damage
   * by 1." class-feature-493 (7th): "…by a total of 2, replacing the increase from expert
   * overdrive." class-feature-503 (15th): "…by a total of 3, replacing the increase from master
   * overdrive." Only the 7th-level rung had a carrier; the number reached the player nowhere else,
   * since the cat-overdrive mode ships `modifiers: []` with a numberless note. */
  /* An inventor KEEPS all three class features, so the rungs are separated only by
   * SITUATIONAL_SUPERSEDES — applied inside `characterSituationalIds`, which is why the count below
   * is taken through that reader rather than off FEAT_SITUATIONAL. (`explainStat`'s strikeDamage arm
   * wants a specific strike's instanceId; the situational list is the same one either way.) */
  const overdriveStars = (level: number) =>
    featSituationalFor(characterSituationalIds(build('inventor', level), db), { kind: 'strikeDamage' })
      .filter((s) => /overdrive/.test(s.id))
      .map((s) => `${s.id} :: ${s.when} :: ${s.bonus}`);

  for (const [level, bonus, id] of [
    [3, '+1', 'expert-overdrive'],
    [7, '+2', 'master-overdrive'],
    [15, '+3', 'legendary-overdrive'],
  ] as [number, string, string][]) {
    it(`an inventor at ${level} sees one Overdrive damage star, ${bonus}, from ${id}`, () => {
      const s = overdriveStars(level);
      expect(s.length, `exactly one live rung at ${level}:\n${s.join('\n')}`).toBe(1);
      expect(s[0]).toContain(id);
      expect(s[0]).toContain(bonus);
      expect(s[0]).toContain('successful Overdrive');
      // Print says "on a successful Overdrive" and no more — a critical Overdrive deals additional
      // damage too (actions/overdrive), so excluding it would be a ruling the printed text never makes.
      expect(s[0], 'no gate print does not state').not.toContain('not a critical success');
    });
  }

  it('the three rungs are the printed ladder, not three overlapping copies', () => {
    // Each rung's own text says it replaces the one below (print), which is what the `when` gates
    // encode: expert 3rd-6th, master 7th-14th, legendary 15th+.
    expect(stars(build('inventor', 3), { kind: 'strikeDamage' }, 'expert-overdrive')[0]).toContain('before 7th level');
    expect(stars(build('inventor', 7), { kind: 'strikeDamage' }, 'master-overdrive')[0]).toContain('before 15th level');
    expect(stars(build('inventor', 15), { kind: 'strikeDamage' }, 'legendary-overdrive')[0]).toContain("replacing Master Overdrive's +2");
  });
});
