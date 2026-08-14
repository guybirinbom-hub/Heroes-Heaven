import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { recordMarkersFor, statHasSituational, explainStat } from '../src/rules/explain';
import { FEAT_SITUATIONAL, RECORD_MARKERS, type DegreeShift } from '../src/rules/situationalBonuses';
import { ACTIVITIES } from '../src/rules/actions';
import { SKILL_ACTIONS } from '../src/rules/skillActions';
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
    //
    // `savesFromChoice` counts as a surface even though it names no track: it names the BUILD ANSWER
    // that holds the track (Path to Perfection's pick), which `resolveChoiceSaves` turns into a real
    // save row per character. Leaving it out of this count would report the one shape that had to
    // stop saying `['all']` as the shape that reaches nothing.
    for (const { bucket, id, shifts } of allShifts(db())) {
      for (const sh of shifts) {
        const surfaces =
          (sh.skills?.length ?? 0) +
          (sh.saves?.length ?? 0) +
          (sh.savesFromChoice ? 1 : 0) +
          (sh.actions?.length ?? 0) +
          (sh.perception ? 1 : 0);
        expect(`${bucket}/${id}: ${surfaces}`).toBe(`${bucket}/${id}: ${surfaces > 0 ? surfaces : 'NO SURFACE'}`);
      }
    }
  });

  it('a savesFromChoice entry names an answer something can resolve, and never also names saves', () => {
    // Two answers to one question: `authoredSituational` would star both sets, so the record would
    // be back to promising rows the pick never reached.
    for (const { bucket, id, shifts } of allShifts(db())) {
      for (const sh of shifts) {
        if (!sh.savesFromChoice) continue;
        expect(`${bucket}/${id}: ${sh.savesFromChoice} + saves ${sh.saves?.join(',') ?? 'none'}`).toBe(
          `${bucket}/${id}: ${sh.savesFromChoice} + saves none`,
        );
        // "<build field>:<index>" — the only shape resolveChoiceSaves parses.
        expect(`${bucket}/${id}: ${sh.savesFromChoice}`).toMatch(/^[\w/-]+: [a-zA-Z]+:\d+$/);
      }
    }
  });

  it('every authored shift uses a known shift value and states its trigger', () => {
    const known = new Set([
      'successToCrit', 'critFailToFail', 'oneBetter', 'failToSuccess',
      // The DOWNGRADES, added 2026-08-12. Every value here used to IMPROVE the result, so the nine
      // records whose text makes it worse could not be authored and sat in a list in the apply script.
      'critSuccessToSuccess', 'failToCritFail', 'oneWorse',
      // The TWO-RUNG upgrade, added 2026-08-13 — "a failure OR CRITICAL FAILURE … you get a success
      // instead", which no existing value could say without over- or under-stating it.
      'critFailToSuccess',
    ]);
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
    /*
     * The id space is whatever the two RENDERERS slugify, not `content.actions` alone — MainTab keys
     * its rows off `ACTIVITIES` and StatDetailModal off `SKILL_ACTIONS`, both by name. Checking only
     * the imported catalog under-approximates it: Battle Medicine is a curated row on both surfaces
     * and has no `content.actions` record, so a correct mark on it read as a mark on nothing.
     */
    const known = new Set([
      ...Object.values(con.actions ?? {}).map((a) => slug((a as { name?: string }).name ?? '')),
      ...ACTIVITIES.map((a) => slug(a.name)),
      ...Object.values(SKILL_ACTIONS).flat().map((a) => slug(a.name)),
    ]);
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
  /*
   * ⚠ THE ARTICLE IS OPTIONAL, and that is why this guard is wider than it looks.
   *
   * Breath Control's registry entry shipped green saying "(success becomes critical success)" beside
   * a structured `successToCrit` shift on the same record, because every alternative here demanded
   * "becomes A critical success". One missing word, and every save popup printed the upgrade TWICE
   * from two registries that can drift apart. The `(an? )?` forms close that hole; the pattern is
   * deliberately wider than the prose any current record uses.
   */
  const DEGREE_PROSE = /(critical success instead|becomes (an? )?critical success|is (an? )?critical success|is (an? )?failure instead|becomes (an? )?failure instead|critical failure is (an? )?failure|is (an? )?success instead|one degree of success|one degree better|one degree worse|success → crit|success -> crit|crit fail → fail|crit fail -> fail)/i;

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

/**
 * DOWNGRADES — a degree of success that gets WORSE.
 *
 * `DegreeShift.shift` had four values and all four improved the result, so nine live records whose
 * text says the opposite ("use the result one degree of success worse", "you get a critical failure
 * instead") could not be expressed at all. They were listed in `scripts/apply-degree-shifts.mjs` under
 * DOWNGRADES and left as prose, which is a lane that silently omits the worst news on the sheet.
 *
 * Two of them are records that ALREADY carried their upgrade half — Dragon's Presence and the
 * even-tempered tanuki each print both directions in one sentence — so the record was showing the good
 * half of its own rule and hiding the bad half. That is worse than showing neither.
 */
describe('degree shifts that make the result WORSE', () => {
  const DOWNGRADES: [string, string, string][] = [
    ['feats', 'bravos-determination', 'oneWorse'],
    ['feats', 'explosive-entry', 'critSuccessToSuccess'],
    ['feats', 'flash-your-badge', 'oneWorse'],
    ['feats', 'dragons-presence', 'failToCritFail'],
    ['heritages', 'even-tempered-tanuki', 'failToCritFail'],
    ['items', 'jax', 'oneWorse'],
    ['items', 'ladys-blessing-oil', 'failToCritFail'],
    ['items', 'devils-luck', 'failToCritFail'],
    ['items', 'cresset-of-grisly-interrogation', 'oneWorse'],
  ];

  it('all nine are authored, each with the direction its own text prints', () => {
    const con = db() as unknown as Record<string, Record<string, { degreeShifts?: DegreeShift[] }>>;
    for (const [bucket, id, shift] of DOWNGRADES) {
      const shifts = con[bucket]?.[id]?.degreeShifts ?? [];
      const found = shifts.some((s) => s.shift === shift);
      expect(`${bucket}/${id}: ${found ? shift : shifts.map((s) => s.shift).join('|') || 'NOTHING AUTHORED'}`).toBe(`${bucket}/${id}: ${shift}`);
    }
  });

  it('the two records that print BOTH directions carry both', () => {
    const con = db();
    for (const rec of [con.feats['dragons-presence'], con.heritages['even-tempered-tanuki']]) {
      const kinds = new Set((rec?.degreeShifts ?? []).map((s) => s.shift));
      expect(kinds.has('successToCrit')).toBe(true);
      expect(kinds.has('failToCritFail')).toBe(true);
    }
  });

  it('a downgrade reaches the same surfaces an upgrade does', () => {
    const con = db();
    // Dragon's Presence: "when you roll a failure against a fear effect, you get a critical failure
    // instead" — a general save clause, so ruling Q2 puts it on all three saves.
    const c = withFeat('fighter', 5, 'dragons-presence');
    const b = explainStat(c, con, { kind: 'save', save: 'will' });
    expect(b.situational?.some((s) => s.text.startsWith('a failure is a critical failure instead'))).toBe(true);
  });

  it('a downgrade on an action shows the worse result on the action row', () => {
    const con = db();
    // Flash Your Badge: "the result of your check against that creature is one degree of success
    // worse" — the Demoralize row is where the player reads it.
    const c = withFeat('fighter', 5, 'flash-your-badge');
    const marks = recordMarkersFor(c, con, 'action', 'demoralize');
    const mark = marks.find((m) => m.sourceId === 'flash-your-badge');
    expect(mark, 'no marker on Demoralize').toBeDefined();
    expect(mark!.value).toBe('one degree worse');
  });

  it('the downgrade wording is never the upgrade wording', () => {
    // A player reading "a success is a critical success instead" on a record that means the opposite
    // is worse off than one reading nothing, so the two vocabularies must not overlap.
    const con = db();
    const c = withFeat('fighter', 5, 'dragons-presence');
    const b = explainStat(c, con, { kind: 'save', save: 'reflex' });
    const lines = (b.situational ?? []).filter((s) => s.sourceId === 'dragons-presence').map((s) => s.text);
    expect(lines.length).toBe(2);
    expect(lines.some((t) => t.includes('critical failure instead'))).toBe(true);
    expect(lines.some((t) => t.includes('critical success instead'))).toBe(true);
  });

  it('a two-rung shift stars the skill AND marks the action it rides (Aeonbound)', () => {
    /*
     * "Once per day, when someone rolls a failure or a critical failure on a check to Treat YOUR
     * Wounds, you can … increase the degree of success by one step." (AoN feat-7195)
     *
     * The record carried NOTHING before this pass — neither surface. Ruling F does not withdraw the
     * star: F governs a bonus that lands on a TEAMMATE's statistic, and here the benefit lands on
     * you, while "someone" includes you because you may Treat your own Wounds. So both surfaces, out
     * of the one structured entry, with the `when` doing the self-limiting.
     */
    const con = db();
    const ch = withFeat('fighter', 3, 'aeonbound');
    expect(statHasSituational(ch, { kind: 'skill', skill: 'medicine' }, con)).toBe(true);
    const line = (explainStat(ch, con, { kind: 'skill', skill: 'medicine' }).situational ?? [])
      .find((s) => s.sourceId === 'aeonbound');
    expect(line, 'no Medicine line from Aeonbound').toBeDefined();
    expect(line!.text).toMatch(/one step better/);
    expect(line!.text).toMatch(/Treat your Wounds/);

    // …and the Treat Wounds row carries BOTH of the feat's clauses: the shift (via degreeShiftMarkers)
    // and the healer's-toolkit waiver (a RECORD_MARKERS row, which no structured field can say).
    const marks = recordMarkersFor(ch, con, 'action', 'treat-wounds').filter((m) => m.sourceId === 'aeonbound');
    expect(marks.length).toBe(2);
    expect(marks.some((m) => /one degree better/.test(m.value ?? ''))).toBe(true);
    expect(marks.some((m) => /without a healer's toolkit/.test(m.note))).toBe(true);
  });

  it('a shift naming its Lores stars only those, not every Lore (Ancestral Insight)', () => {
    /*
     * `targetMatches` reads a bare `lore` target as EVERY `lore:*` row the character owns, so
     * `skills: ['lore']` painted this critical-failure upgrade onto Warfare Lore, Sailing Lore and
     * anything else the player had typed — a rule that can never fire there. Two more records carried
     * the same shape; `npm run scan:lore-wildcard` holds the count at zero.
     */
    const con = db();
    const ch = withFeat('fighter', 3, 'ancestral-insight');
    expect(statHasSituational(ch, { kind: 'skill', skill: 'lore:Alghollthu' }, con)).toBe(true);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'lore:Azlanti' }, con)).toBe(true);
    // The bug: before the narrowing this was TRUE for every Lore the character owns.
    expect(statHasSituational(ch, { kind: 'skill', skill: 'lore:Warfare' }, con)).toBe(false);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'lore:Sailing' }, con)).toBe(false);
  });

  it('the other two wildcard Lores were narrowed as well', () => {
    // Found by the scan, not by the audit — neither record had ever been read.
    const con = db();
    const xun = withFeat('fighter', 9, 'golden-league-xun-dedication');
    expect(statHasSituational(xun, { kind: 'skill', skill: 'lore:Underworld' }, con)).toBe(true);
    expect(statHasSituational(xun, { kind: 'skill', skill: 'lore:Warfare' }, con)).toBe(false);

    const chef = withFeat('fighter', 3, 'wandering-chef-dedication');
    expect(statHasSituational(chef, { kind: 'skill', skill: 'lore:Cooking' }, con)).toBe(true);
    expect(statHasSituational(chef, { kind: 'skill', skill: 'crafting' }, con)).toBe(true);
    expect(statHasSituational(chef, { kind: 'skill', skill: 'lore:Warfare' }, con)).toBe(false);
  });

  it('Breath Control states the crit upgrade once, not twice', () => {
    // The registry `when` said "(success becomes critical success)" while the record's own
    // `degreeShifts` entry said the same thing, and explain.ts merges both into ONE star list.
    const con = db();
    const ch = withFeat('fighter', 3, 'breath-control');
    const lines = (explainStat(ch, con, { kind: 'save', save: 'will' }).situational ?? [])
      .filter((s) => s.sourceId === 'breath-control')
      .map((s) => s.text);
    expect(lines.filter((t) => /critical success/i.test(t)).length).toBe(1);
    // Both halves still reach the player: the +1 and the upgrade, one line each.
    expect(lines.some((t) => /^\+1 circumstance/.test(t))).toBe(true);
    expect(lines.length).toBe(2);
  });

  it('the apply script no longer lists any of them as unbuildable', () => {
    // The DOWNGRADES list in the script was the record of what the lane could not say. Leaving the
    // nine there while authoring them would be two answers to one question.
    const src = readFileSync('scripts/apply-degree-shifts.mjs', 'utf8');
    const block = src.slice(src.indexOf('const DOWNGRADES'), src.indexOf('const OTHERS_ROLL'));
    for (const [, id] of DOWNGRADES) expect(`${id}: ${block.includes(`/${id} —`) ? 'STILL LISTED' : 'ok'}`).toBe(`${id}: ok`);
  });
});
