import { describe, it, expect } from 'vitest';
import { build, content } from './_content';

/*
 * The builder's "Second class spells" card (Dual Class) writes the 2nd caster's picks to
 * BuildState.{cantrips2, spells2, signatures2}. These tests lock the round-trip: those fields must
 * land in the `${cls2}-casting` spellcasting entry (spellbook for a wizard, repertoire+signature for
 * a spontaneous caster). If they don't, the picker would silently do nothing.
 */
const c = content();
const arcane = (rank: number) => Object.values(c.spells).find((s) => s.rank === rank && s.traditions.includes('arcane'))!.id;
const occult = (rank: number) => Object.values(c.spells).filter((s) => s.rank === rank && s.traditions.includes('occult')).map((s) => s.id);

describe('Dual Class — Wizard second caster (spellbook)', () => {
  const cantrip = arcane(0);
  const s1 = arcane(1);
  const s2 = arcane(2);
  const ch = build('monk', 5, {
    variantRules: { dualClass: true },
    classId2: 'wizard',
    cantrips2: [cantrip],
    spells2: { 1: [s1], 2: [s2] },
  });
  const wiz = ch.spellcasting.find((e) => e.id === 'wizard-casting');

  it('builds a wizard-casting entry from the second-class picks', () => {
    expect(wiz).toBeDefined();
    expect(wiz!.tradition).toBe('arcane');
    expect(wiz!.type).toBe('prepared');
  });
  it('the chosen cantrip and spellbook spells appear in the entry', () => {
    expect(wiz!.cantrips).toContain(cantrip);
    expect(wiz!.spellbook?.[1]).toContain(s1);
    expect(wiz!.spellbook?.[2]).toContain(s2);
  });
  it('the primary Monk stays a non-caster (no stray primary entry)', () => {
    expect(ch.spellcasting.filter((e) => e.type !== 'focus').length).toBe(1); // only the wizard entry
  });
});

describe('Dual Class — Bard second caster (spontaneous repertoire + signature)', () => {
  const [oc] = occult(0);
  const rank1 = occult(1);
  const known = rank1[0];
  const ch = build('monk', 5, {
    variantRules: { dualClass: true },
    classId2: 'bard',
    cantrips2: [oc],
    spells2: { 1: [known] },
    signatures2: { 1: known },
  });
  const bard = ch.spellcasting.find((e) => e.id === 'bard-casting');

  it('builds a bard-casting entry with the picked cantrip and repertoire spell', () => {
    expect(bard).toBeDefined();
    expect(bard!.type).toBe('spontaneous');
    expect(bard!.tradition).toBe('occult');
    expect(bard!.cantrips).toContain(oc);
    expect(bard!.repertoire?.[1]).toContain(known);
  });
  it('a chosen signature spell (Bard has signature-spells by L3) is recorded', () => {
    expect(bard!.signature).toContain(known);
  });
});
