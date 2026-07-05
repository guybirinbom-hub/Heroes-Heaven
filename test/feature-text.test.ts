import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { classFeatureDescription } from '../src/rules/featureText';

const c = content();

describe('classFeatureDescription — shared-feature contamination guard', () => {
  it('strips another class’s addendum (bard Reflex Expertise drops the Guardian note)', () => {
    const raw = c.classFeatures['reflex-expertise'].description;
    expect(raw).toContain('Guardian'); // the shared source DOES carry the Guardian addendum
    const bard = classFeatureDescription(raw, 'bard', c);
    expect(bard).not.toContain('Guardian'); // …but a bard must not see it
    expect(bard).toContain('dodging danger'); // the generic paragraph stays
  });

  it('keeps the owning class’s own addendum (guardian Reflex Expertise keeps the Guardian note)', () => {
    const guardian = classFeatureDescription(c.classFeatures['reflex-expertise'].description, 'guardian', c);
    expect(guardian).toContain('Guardian');
  });

  it('strips an addendum that has LEADING WHITESPACE before the bold class name', () => {
    // A paragraph led by " **Guardian**" (leading space) or "\n**Guardian**" must still be
    // recognized as the Guardian addendum: stripped for a bard, kept for a guardian.
    const desc = 'Base text.\n\n  **Guardian** Even in the heaviest of armors you keep your footing.';
    const bard = classFeatureDescription(desc, 'bard', c);
    expect(bard).not.toContain('Guardian'); // leading whitespace no longer hides the addendum
    expect(bard).toContain('Base text.'); // generic paragraph stays
    const guardian = classFeatureDescription(desc, 'guardian', c);
    expect(guardian).toContain('Guardian'); // the owning class keeps its own note
  });

  it('never strips a non-class bold lead (e.g. a degree-of-success row)', () => {
    const desc = 'Base text.\n\n**Critical Success** You do the thing.\n\n**Failure** You do not.';
    expect(classFeatureDescription(desc, 'bard', c)).toBe(desc);
  });

  // The systematic guard: for EVERY class, none of its displayed feature descriptions may contain a
  // DIFFERENT class's name as a bold-led addendum paragraph. This catches any future shared feature
  // that ships a class-specific note, the same way Reflex/Weapon Expertise etc. do today.
  it('no class sees another class’s bold-led addendum in any of its features', () => {
    const classNames = Object.values(c.classes).map((cl) => cl.name.toLowerCase());
    const offenders: string[] = [];
    for (const cls of Object.values(c.classes)) {
      const others = new Set(classNames.filter((n) => n !== cls.name.toLowerCase()));
      for (const f of cls.features) {
        const feat = c.classFeatures[f.featureId];
        if (!feat) continue;
        const shown = classFeatureDescription(feat.description, cls.id, c);
        for (const para of shown.split(/\n{2,}/)) {
          const lead = para.match(/^\*\*([^*]+)\*\*/);
          if (lead && others.has(lead[1].trim().toLowerCase())) offenders.push(`${cls.id}/${f.featureId} → ${lead[1].trim()}`);
        }
      }
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
  });
});
