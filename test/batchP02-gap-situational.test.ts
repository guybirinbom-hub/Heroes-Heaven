// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { build, content } from './_content';
import { explainStat } from '../src/rules/explain';
import { deriveStrikes } from '../src/rules/derive';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import type { Character, ContentDatabase, SituationalBonus } from '../src/rules/types';

/**
 * Print batch P02, SITUATIONAL lane — the GAP lines (work/.bP02-gaps.json, family "situational").
 *
 * The situational builder put two stars in the code registry (FEAT_SITUATIONAL) on records that a
 * DATA family writes a record-level `situational` field on in the same batch: trusted-rival
 * (trusted-rival#daily-prep-skill beside trusted-rival#research-bonus) and resurgent-maelstrom
 * (resurgent-maelstrom#stance-versatile beside resurgent-maelstrom#trait-already-present).
 * explain.ts `entriesFor` CONCATENATES the table entry and the record field — unless the record sets
 * `situationalReplaces`, in which case the table entry is dropped whole. These tests pin that both
 * carriers reach the built sheet together, on a content copy with the data row PATCHED IN MEMORY (so
 * they hold before and after the driver applies the row), and that nothing ships the flag.
 *
 * The last describe pins the two regenerating scripts so a re-run cannot undo this batch's in-place
 * registry edits.
 */
const db = content();

/** The situational rows ONE source contributes to a stat, as StatDetailModal reads them. */
const rows = (c: Character, d: ContentDatabase, ref: { kind: 'skill'; skill: string } | { kind: 'strikeDamage' }, sourceId: string): string[] => {
  let full: Parameters<typeof explainStat>[2];
  if (ref.kind === 'strikeDamage') {
    const strike = deriveStrikes(c, d)[0];
    expect(strike, 'the character has at least one Strike to read').toBeTruthy();
    full = { kind: 'strikeDamage', instanceId: strike.instanceId };
  } else {
    full = ref;
  }
  return (explainStat(c, d, full).situational ?? []).filter((n) => n.sourceId === sourceId).map((n) => n.text);
};

/** A shallow content copy with one record's fields replaced — the shipped `db` is never touched. */
const patched = (bucket: 'backgrounds' | 'classFeatures', id: string, fields: Record<string, unknown>): ContentDatabase => {
  const b = db[bucket] as unknown as Record<string, Record<string, unknown>>;
  return { ...db, [bucket]: { ...b, [id]: { ...b[id], ...fields } } } as ContentDatabase;
};

/* The data-rows-1 values, verbatim from work/.bP02-rows-data-rows-1.json. */
const RESEARCH_ROW: SituationalBonus[] = [
  { targets: [{ kind: 'skill', detail: 'all' }], when: 'to Research a topic associated with Bastardhall (Research subsystem)', bonus: '+2 circumstance' },
];
const RIDER_ROW: SituationalBonus[] = [
  { targets: [{ kind: 'strikeDamage' }], when: 'with an improvised weapon that would already have backstabber (1H) or forceful (2H)', bonus: 'backstabber: double its precision damage; forceful: count one more weapon damage die' },
];

describe('trusted-rival: the Research data row sits BESIDE the daily-preparation registry star', () => {
  const rival = build('fighter', 7, { backgroundId: 'trusted-rival' });

  // batch P02: trusted-rival#research-bonus
  it('trusted-rival: with the data row in place, Society reads both the +2 Research star and the daily pick', () => {
    const d = patched('backgrounds', 'trusted-rival', { situational: RESEARCH_ROW });
    const r = rows(rival, d, { kind: 'skill', skill: 'society' }, 'trusted-rival');
    // batch P02: trusted-rival#research-bonus — AoN background-652 "you gain a +2 circumstance bonus on the check"
    expect(r.filter((t) => /Bastardhall/.test(t) && /\+2 circumstance/.test(t)), 'the data row').toHaveLength(1);
    // batch P02: trusted-rival#daily-prep-skill
    expect(r.filter((t) => /daily preparations/.test(t)), 'the registry star').toHaveLength(1);
  });

  // batch P02: trusted-rival#daily-prep-skill
  it('trusted-rival: a record that set situationalReplaces would drop the daily star, and the shipped record does not set it', () => {
    // The hazard is real: the flag swaps the table entry out for the record's own list.
    const d = patched('backgrounds', 'trusted-rival', { situational: RESEARCH_ROW, situationalReplaces: true });
    const r = rows(rival, d, { kind: 'skill', skill: 'society' }, 'trusted-rival');
    expect(r.filter((t) => /daily preparations/.test(t))).toEqual([]);
    // …so the shipped record must never carry it (no P02 row writes it; this fails if one ever does).
    // batch P02: trusted-rival#research-bonus
    expect((db.backgrounds['trusted-rival'] as { situationalReplaces?: boolean }).situationalReplaces).toBeFalsy();
  });

  // batch P02: trusted-rival#research-bonus
  it('trusted-rival: once the tracked ledger calls it fully applied, the record really carries the Research star', () => {
    /* scripts/trust-ledger.mjs clears ALL of a background's unapplied clauses once any registry entry
     * names it (onRegistry), so the re-stamped ledger calls trusted-rival fully applied on the strength
     * of the daily-prep star alone. That is only true if trusted-rival#research-bonus actually applied:
     * if the applier refused the row, the ledger over-reports. Before the close-stage re-stamp the
     * tracked ledger still lists the background as `partly` and this holds trivially. */
    const tracked = JSON.parse(readFileSync('src/data/trust-ledger.json', 'utf8')) as { partly: Record<string, string> };
    if (tracked.partly['backgrounds/trusted-rival']) return;
    const own = (db.backgrounds['trusted-rival'] as { situational?: SituationalBonus[] }).situational ?? [];
    // batch P02: trusted-rival#research-bonus
    expect(own.some((s) => /Bastardhall/.test(s.when) && /\+2 circumstance/.test(s.bonus)), 'the ledger says applied; the row must be there').toBe(true);
  });
});

describe('resurgent-maelstrom: the trait-already-present data row sits BESIDE the three-clause registry entry', () => {
  const maelstrom = build('magus', 7, { subclassId: 'resurgent-maelstrom' });

  // batch P02: resurgent-maelstrom#stance-versatile
  it('resurgent-maelstrom: the registry entry keeps its three clauses, the versatile one among them', () => {
    const table = FEAT_SITUATIONAL['resurgent-maelstrom'];
    expect(table.length).toBeGreaterThanOrEqual(3);
    // batch P02: resurgent-maelstrom#stance-versatile
    expect(table.some((s) => /versatile/.test(s.bonus) && /Arcane Cascade stance/.test(s.when))).toBe(true);
  });

  // batch P02: resurgent-maelstrom#trait-already-present
  it('resurgent-maelstrom: with the rider row in place, the Strike damage rows read the rider AND every table clause', () => {
    const d = patched('classFeatures', 'resurgent-maelstrom', { situational: RIDER_ROW });
    const r = rows(maelstrom, d, { kind: 'strikeDamage' }, 'resurgent-maelstrom');
    // batch P02: resurgent-maelstrom#trait-already-present — AoN hybrid-study-9 "double the amount of additional precision damage"
    expect(r.filter((t) => /double its precision damage/.test(t))).toHaveLength(1);
    // batch P02: resurgent-maelstrom#stance-versatile
    expect(r.filter((t) => /versatile P and versatile S/.test(t))).toHaveLength(1);
    expect(r.some((t) => /minimum damage die 1d6/.test(t))).toBe(true);
    // batch P02: resurgent-maelstrom#trait-already-present
    expect((db.classFeatures['resurgent-maelstrom'] as { situationalReplaces?: boolean }).situationalReplaces).toBeFalsy();
  });
});

describe('the regenerating scripts cannot undo the batch P02 in-place edits (spirit-sheath, emergency-targe, resurgent-maelstrom)', () => {
  // batch P02: spirit-sheath#situational
  it('spirit-sheath and emergency-targe: apply-situational-lane.mjs names both in its handEdited exclusion', () => {
    const src = readFileSync('scripts/apply-situational-lane.mjs', 'utf8');
    const set = src.slice(src.indexOf('const handEdited'), src.indexOf(']);', src.indexOf('const handEdited')));
    // batch P02: spirit-sheath#situational
    expect(set).toContain("'spirit-sheath'");
    // batch P02: emergency-targe#situational
    expect(set).toContain("'emergency-targe'");
  });

  // batch P02: resurgent-maelstrom#stance-versatile
  it('resurgent-maelstrom: apply-sweep-b2.mjs refuses before its splice, and a re-run WOULD hit the refusal on this entry', () => {
    const src = readFileSync('scripts/apply-sweep-b2.mjs', 'utf8');
    const refuse = src.indexOf('REFUSED:');
    const splice = src.indexOf("regSrc = regSrc.slice(0, regSrc.lastIndexOf('\\n\\n', at))");
    const write = src.indexOf('writeFileSync(REGISTRY');
    expect(refuse, 'the refusal exists').toBeGreaterThan(-1);
    expect(splice, 'the splice is still where the refusal expects it').toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(splice);
    expect(refuse).toBeLessThan(write);
    // The entry sits in the sweep's block, and the sweep's own result would write it back WITHOUT the
    // versatile clause — so the shipped line is not one the sweep regenerates, which is the refusal case.
    const reg = readFileSync('src/rules/situationalBonuses.ts', 'utf8');
    const marker = reg.indexOf('// ---- coverage sweep batch 2 (scripts/apply-sweep-b2.mjs)');
    expect(reg.indexOf('"resurgent-maelstrom": [')).toBeGreaterThan(marker);
    const result = JSON.parse(readFileSync('work/sweep/b2/result.json', 'utf8')) as unknown;
    const rec = JSON.stringify(result).match(/\{"id":"resurgent-maelstrom"[^]*?"fix":(\{"situational":\[[^]*?\]\})/);
    expect(rec, 'the sweep result still carries its resurgent-maelstrom row').toBeTruthy();
    // batch P02: resurgent-maelstrom#stance-versatile
    expect(rec![1]).not.toMatch(/versatile P/);
  });
});
