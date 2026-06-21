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
});
