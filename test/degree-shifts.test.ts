import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { recordMarkersFor, statHasSituational, explainStat } from '../src/rules/explain';
import { FEAT_SITUATIONAL, RECORD_MARKERS, type DegreeShift } from '../src/rules/situationalBonuses';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * The `degreeShifts` lane, authored (scripts/apply-degree-shifts.mjs).
 *
 * The field and its fan-out shipped built and EMPTY — zero records — so every one of the ~176
 * degree-of-success records reported as broken and the lane looked pointless. These tests assert the
 * two things an authoring pass can get wrong: that the values are actually there, and that ruling Q2's
 * fan-out reaches BOTH surfaces from the one entry.
 */
const db = () => content();

/** Every record in the shipped content that carries the field, with its collection. */
function allShifts(con: ContentDatabase): { bucket: string; id: string; shifts: DegreeShift[] }[] {
  const out: { bucket: string; id: string; shifts: DegreeShift[] }[] = [];
  for (const bucket of ['feats', 'classFeatures', 'heritages', 'ancestries', 'backgrounds', 'items'] as const) {
    for (const [id, rec] of Object.entries((con as unknown as Record<string, Record<string, unknown>>)[bucket] ?? {})) {
      const shifts = (rec as { degreeShifts?: DegreeShift[] }).degreeShifts;
      if (shifts?.length) out.push({ bucket, id, shifts });
    }
  }
  return out;
}

const withFeat = (classId: string, level: number, featId: string): Character => {
  const base = build(classId, level);
  return { ...base, feats: [...base.feats, { featId, source: 'test', level: 1 }] } as Character;
};

describe('degreeShifts — the lane is authored, not just built', () => {
  it('the shipped content carries degree shifts (it shipped with zero)', () => {
    const all = allShifts(db());
    expect(all.length).toBeGreaterThan(250);
    // Spread across collections: a lane authored only onto feats would leave every save-line class
    // feature and every mutagen still silent.
    const buckets = new Set(all.map((a) => a.bucket));
    for (const b of ['feats', 'classFeatures', 'heritages', 'items']) expect(buckets).toContain(b);
  });

  it('every authored entry names at least one surface, or it reaches nothing', () => {
    // `authoredSituational` drops an entry with no skill/save/perception target, and
    // `degreeShiftMarkers` emits nothing without actions. An entry with neither is invisible data.
    for (const { bucket, id, shifts } of allShifts(db())) {
      for (const sh of shifts) {
        const surfaces = (sh.skills?.length ?? 0) + (sh.saves?.length ?? 0) + (sh.actions?.length ?? 0) + (sh.perception ? 1 : 0);
        expect(`${bucket}/${id}: ${surfaces}`).toBe(`${bucket}/${id}: ${surfaces > 0 ? surfaces : 'NO SURFACE'}`);
      }
    }
  });

  it('every authored shift uses a known shift value and states its trigger', () => {
    const known = new Set(['successToCrit', 'critFailToFail', 'oneBetter', 'failToSuccess']);
    for (const { bucket, id, shifts } of allShifts(db())) {
      for (const sh of shifts) {
        expect(`${bucket}/${id}: ${sh.shift}`).toBe(`${bucket}/${id}: ${known.has(sh.shift) ? sh.shift : 'UNKNOWN'}`);
        expect(sh.when.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('every action a shift names exists, or its marker lands on a row nobody renders', () => {
    const con = db();
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const known = new Set(Object.values(con.actions ?? {}).map((a) => slug((a as { name?: string }).name ?? '')));
    for (const { bucket, id, shifts } of allShifts(con)) {
      for (const sh of shifts) {
        for (const a of sh.actions ?? []) expect(`${bucket}/${id}: ${a}`).toBe(`${bucket}/${id}: ${known.has(a) ? a : 'NO SUCH ACTION'}`);
      }
    }
  });
});

describe('ruling Q2 — one entry, both surfaces', () => {
  it('a skill+action shift stars the skill AND marks the action', () => {
    const con = db();
    const c = withFeat('rogue', 5, 'steady-balance');
    expect(con.feats['steady-balance']?.degreeShifts?.length).toBeGreaterThan(0);
    // the SKILL half
    expect(statHasSituational(c, { kind: 'skill', skill: 'acrobatics' }, con)).toBe(true);
    // the ACTION half — same authored entry, different renderer
    const marks = recordMarkersFor(c, con, 'action', 'balance');
    expect(marks.some((m) => m.sourceId === 'steady-balance')).toBe(true);
    expect(marks.find((m) => m.sourceId === 'steady-balance')?.value).toBe('success → crit success');
  });

  it('the skill popup prints the shift in words, not a raw enum', () => {
    const con = db();
    const c = withFeat('rogue', 5, 'steady-balance');
    const b = explainStat(c, con, { kind: 'skill', skill: 'acrobatics' });
    expect(b.situational?.some((s) => s.text.startsWith('a success is a critical success instead'))).toBe(true);
  });

  it('a save-general shift stars all three saves', () => {
    const con = db();
    const c = withFeat('fighter', 5, 'goloma-courage');
    for (const save of ['fortitude', 'reflex', 'will'] as const) {
      expect(statHasSituational(c, { kind: 'save', save }, con)).toBe(true);
    }
  });

  it('a shift naming ONE save track leaves the other two alone', () => {
    const con = db();
    const c = withFeat('fighter', 5, 'adhyabhau'); // Will only
    expect(statHasSituational(c, { kind: 'save', save: 'will' }, con)).toBe(true);
    expect(statHasSituational(c, { kind: 'save', save: 'fortitude' }, con)).toBe(false);
  });

  it('a Perception shift reaches the Perception row', () => {
    const con = db();
    // Disillusionment is the reason DegreeShift.perception exists: its save half and its
    // "disbelieve an illusion" Perception half are one rule and had to stay one entry.
    const c = withFeat('fighter', 9, 'disillusionment');
    expect(statHasSituational(c, { kind: 'perception' }, con)).toBe(true);
    expect(statHasSituational(c, { kind: 'save', save: 'will' }, con)).toBe(true);
  });

  it('an item’s shift applies only while the item is in use', () => {
    const con = db();
    const base = build('fighter', 5);
    const packed: Character = { ...base, inventory: [{ itemId: 'juggernaut-mutagen', qty: 1 } as never] };
    const drunk: Character = { ...base, inventory: [{ itemId: 'juggernaut-mutagen', qty: 1, invested: true } as never] };
    expect(statHasSituational(packed, { kind: 'save', save: 'fortitude' }, con)).toBe(false);
    expect(statHasSituational(drunk, { kind: 'save', save: 'fortitude' }, con)).toBe(true);
  });
});

describe('the rule is stated ONCE', () => {
  // The conversion's whole point: ~110 of these lived as PROSE in situationalBonuses.ts, in a `bonus`
  // string or a RecordMarker value. Leaving both would put the same sentence on the sheet twice from
  // two sources that cannot be kept in step — exactly the drift the structured field was built to end.
  const DEGREE_PROSE = /(critical success instead|becomes a critical success|is a critical success|is a failure instead|becomes a failure instead|critical failure is a failure|is a success instead|one degree of success|one degree better|success → crit|success -> crit|crit fail → fail|crit fail -> fail)/i;

  it('no record carries a degree shift in BOTH the structured field and the situational registry', () => {
    const con = db();
    const structured = new Set(allShifts(con).map((a) => a.id));
    const offenders: string[] = [];
    for (const [id, list] of Object.entries(FEAT_SITUATIONAL)) {
      if (!structured.has(id)) continue;
      for (const b of list) if (DEGREE_PROSE.test(`${b.when} ${b.bonus}`)) offenders.push(`FEAT_SITUATIONAL/${id}: ${b.bonus}`);
    }
    for (const [id, list] of Object.entries(RECORD_MARKERS)) {
      if (!structured.has(id)) continue;
      for (const m of list) if (DEGREE_PROSE.test(`${m.value ?? ''} ${m.note ?? ''}`)) offenders.push(`RECORD_MARKERS/${id}: ${m.value}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the converted records did not lose their star on the way', () => {
    const con = db();
    // Sure Feet used to mark the Balance and Climb ACTIONS and leave Acrobatics bare; steadying-stone
    // starred Acrobatics and left Balance bare. One structured entry now has to do both, for both.
    const sureFeet = withFeat('ranger', 5, 'sure-feet');
    expect(statHasSituational(sureFeet, { kind: 'skill', skill: 'acrobatics' }, con)).toBe(true);
    expect(statHasSituational(sureFeet, { kind: 'skill', skill: 'athletics' }, con)).toBe(true);
    expect(recordMarkersFor(sureFeet, con, 'action', 'balance').some((m) => m.sourceId === 'sure-feet')).toBe(true);
    expect(recordMarkersFor(sureFeet, con, 'action', 'climb').some((m) => m.sourceId === 'sure-feet')).toBe(true);

    const stone = withFeat('ranger', 5, 'steadying-stone');
    expect(statHasSituational(stone, { kind: 'skill', skill: 'acrobatics' }, con)).toBe(true);
    expect(recordMarkersFor(stone, con, 'action', 'balance').some((m) => m.sourceId === 'steadying-stone')).toBe(true);
  });
});
