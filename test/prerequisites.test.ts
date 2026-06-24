import { describe, it, expect } from 'vitest';
import { checkPrerequisites } from '../src/rules/build';
import { content, build } from './_content';

describe('checkPrerequisites', () => {
  it('never throws across every imported feat', () => {
    const ch = build('fighter', 20);
    let crashes = 0;
    for (const f of Object.values(content().feats)) {
      try {
        checkPrerequisites(f, ch, content());
      } catch {
        crashes++;
      }
    }
    expect(crashes).toBe(0);
  });

  it('enforces a skill-rank prerequisite (expert in Medicine)', () => {
    const feats = Object.values(content().feats);
    const medFeat = feats.find((f) => f.prerequisites?.some((p) => /expert in medicine/i.test(p)));
    expect(medFeat).toBeTruthy();
    if (!medFeat) return;
    // A level-1 cleric is at most trained in Medicine -> blocked.
    const trained = build('cleric', 1, { classSkills: ['medicine'] });
    expect(checkPrerequisites(medFeat, trained, content()).met).toBe(false);
  });

  it('does not block a feat with no prerequisites', () => {
    const ch = build('fighter', 5);
    const open = Object.values(content().feats).find((f) => !f.prerequisites?.length);
    expect(open).toBeTruthy();
    if (open) expect(checkPrerequisites(open, ch, content()).met).toBe(true);
  });

  it('multi-ability dedication prereqs are AND, except Fighter/Monk which are OR', () => {
    const base = build('fighter', 5);
    const feats = content().feats;
    // Only Strength meets +2; Dex/Con/Cha are +0.
    const strOnly = { ...base, abilities: { str: 18, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } };
    // Fighter/Monk Dedication = "Strength or Dexterity": Strength alone satisfies it.
    expect(checkPrerequisites(feats['fighter-dedication'], strOnly, content()).met).toBe(true);
    expect(checkPrerequisites(feats['monk-dedication'], strOnly, content()).met).toBe(true);
    // Barbarian (Str AND Con), Champion (Str AND Cha), Swashbuckler (Cha AND Dex): one stat isn't enough.
    expect(checkPrerequisites(feats['barbarian-dedication'], strOnly, content()).met).toBe(false);
    expect(checkPrerequisites(feats['champion-dedication'], strOnly, content()).met).toBe(false);
    expect(checkPrerequisites(feats['swashbuckler-dedication'], strOnly, content()).met).toBe(false);
    // Meeting BOTH halves of the AND satisfies it.
    const strCon = { ...base, abilities: { str: 18, dex: 10, con: 18, int: 10, wis: 10, cha: 10 } };
    expect(checkPrerequisites(feats['barbarian-dedication'], strCon, content()).met).toBe(true);
  });
});
