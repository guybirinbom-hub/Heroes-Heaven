/*
 * Wizard Dedication's "Arcane school" question offers every school the wizard class does
 * (package I, item I3, finding i3-wizard-dedication-impossible-magic-schools, 2026-10-17).
 *
 * AoN feat-5106 (Wizard Dedication, Player Core pg. 223): "Select a school; you don't gain any abilities from your
 * choice of school, but qualify for feats as a member." No school is excluded. The overlay row behind the picker
 * (#3530) offered 14; the wizard's own Arcane School picker offered 18 — the four missing were the Impossible
 * Magic schools (arcane-school-31..34: Breathtaking Influence, Keen Inquiry, Nexian Spaces, Quantic Control).
 *
 * The three lists that must agree: the dedication's options, the wizard class's subclass options, and the
 * classFeatures records tagged `wizard-arcane-school`. Book filtering is not this file's business: applySources
 * narrows the dedication's list by each option's own book (test/sources-apply-to-everything.test.tsx).
 */
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import type { ClassDef } from '../src/rules/types';

const db = content();

const IM = 'Pathfinder Impossible Magic';
const IM_SCHOOLS = ['school-of-breathtaking-influence', 'school-of-keen-inquiry', 'school-of-nexian-spaces', 'school-of-quantic-control'];

/** What differs between the dedication's school list and the two lists it must equal, by id. */
function schoolGaps(dedication: string[], classPicker: string[], tagged: string[]) {
  const d = new Set(dedication);
  const diff = (want: string[]) => ({
    missing: want.filter((x) => !d.has(x)).sort(),
    extra: dedication.filter((x) => !want.includes(x)).sort(),
  });
  return { vsClassPicker: diff(classPicker), vsTagged: diff(tagged) };
}

const offered = () => (db.feats['wizard-dedication']?.choice?.options ?? []).map((o) => o.value);
const classPicker = () => ((db.classes['wizard'] as ClassDef).subclass?.options ?? []).map((o) => o.id);
const tagged = () =>
  Object.values(db.classFeatures)
    .filter((f) => ((f as { otherTags?: string[] }).otherTags ?? []).includes('wizard-arcane-school'))
    .map((f) => f.id);

describe('Wizard Dedication offers every arcane school the wizard class does', () => {
  it('the dedication, the wizard class picker and the wizard-arcane-school records are the same 18 schools', () => {
    expect(offered()).toHaveLength(18);
    expect(new Set(offered()).size).toBe(18);
    expect(classPicker()).toHaveLength(18);
    expect(tagged()).toHaveLength(18);
    expect(schoolGaps(offered(), classPicker(), tagged())).toEqual({
      vsClassPicker: { missing: [], extra: [] },
      vsTagged: { missing: [], extra: [] },
    });
  });

  it('the four Impossible Magic schools are on the list, each an Impossible Magic record the Sources filter can hide', () => {
    for (const id of IM_SCHOOLS) {
      expect(offered(), id).toContain(id);
      expect(db.classFeatures[id]?.source?.book, `classFeatures/${id} book`).toBe(IM);
    }
  });

  it('the 14 schools it already offered are all still offered', () => {
    const before = [
      'school-of-ars-grammatica', 'school-of-battle-magic', 'school-of-civic-wizardry', 'school-of-mentalism',
      'school-of-protean-form', 'school-of-the-boundary', 'school-of-unified-magical-theory', 'school-of-gates',
      'school-of-kalistrade', 'school-of-magical-technologies', 'school-of-rooted-wisdom', 'school-of-the-reclamation',
      'red-mantis-magic-school', 'runelord',
    ];
    for (const id of before) expect(offered(), id).toContain(id);
  });

  it('every option has a label that reads as the record it names', () => {
    for (const o of db.feats['wizard-dedication']!.choice!.options!) {
      expect(o.label, o.value).toBe(db.classFeatures[o.value]?.name);
    }
  });

  // mutation-proof: the comparer itself names a dropped school, an invented one, and a school the class gains later
  it('the comparer goes red on a planted bad list, naming the school', () => {
    const dropped = offered().filter((id) => id !== 'school-of-nexian-spaces');
    expect(schoolGaps(dropped, classPicker(), tagged()).vsClassPicker.missing).toEqual(['school-of-nexian-spaces']);
    expect(schoolGaps(dropped, classPicker(), tagged()).vsTagged.missing).toEqual(['school-of-nexian-spaces']);
    const old14 = offered().filter((id) => !IM_SCHOOLS.includes(id));
    expect(old14).toHaveLength(14);
    expect(schoolGaps(old14, classPicker(), tagged()).vsClassPicker.missing).toEqual([...IM_SCHOOLS].sort());
    const invented = [...offered(), 'school-of-zz-invented'];
    expect(schoolGaps(invented, classPicker(), tagged()).vsClassPicker.extra).toEqual(['school-of-zz-invented']);
    const classGains = [...classPicker(), 'school-of-zz-later'];
    expect(schoolGaps(offered(), classGains, tagged()).vsClassPicker.missing).toEqual(['school-of-zz-later']);
  });
});
