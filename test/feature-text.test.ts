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

/**
 * Card step 12 (docs/card-design.md section 5, the classFeatureDescription row): a lead may name several
 * classes — "**Witch, Wizard**", "**Champion, Exemplar, Investigator, Magus**". The single-name rule kept
 * such a paragraph for EVERY class (a wizard 11 read the champion's "martial weapons"), and the guard above
 * compares whole leads, so it never saw one. Mutation (measured red 2026-10-06, restored byte-exact):
 * featureText.ts leadClasses back to one name per lead → every case below red but the cleric one.
 */
describe('classFeatureDescription — a lead that names several classes', () => {
  const we = c.classFeatures['weapon-expertise'].description;
  const pm = c.classFeatures['perception-mastery'].description;
  const rx = c.classFeatures['reflex-expertise'].description;
  const paragraphs = (s: string) => s.split(/\n{2,}/).map((p) => (p.match(/^\s*\*\*([^*]+)\*\*/) ?? [])[1] ?? '(generic)');

  // batch card: #card-OWN-SECTION — the record's own section, slice or class text
  it('Weapon Expertise: one paragraph per class, its own', () => {
    expect(we).toMatch(/\*\*Witch, Wizard\*\*/);
    const want: Record<string, string> = {
      wizard: 'Witch, Wizard', witch: 'Witch, Wizard', druid: 'Druid, Kineticist', kineticist: 'Druid, Kineticist',
      champion: 'Champion, Exemplar, Investigator, Magus', magus: 'Champion, Exemplar, Investigator, Magus',
      guardian: 'Guardian', oracle: 'Oracle', psychic: 'Psychic', sorcerer: 'Sorcerer', swashbuckler: 'Swashbuckler', thaumaturge: 'Thaumaturge',
    };
    // batch card: #card-OWN-SECTION — the record's own section, slice or class text
    for (const [cls, lead] of Object.entries(want)) expect(paragraphs(classFeatureDescription(we, cls, c)), cls).toEqual([lead]);
    expect(classFeatureDescription(we, 'wizard', c)).not.toMatch(/martial/);
    expect(classFeatureDescription(we, 'druid', c)).not.toMatch(/martial/);
    expect(classFeatureDescription(we, 'champion', c)).toMatch(/martial weapons/);
  });

  // batch card: #card-OWN-SECTION — the record's own section, slice or class text
  it('Perception Mastery: one paragraph per class, its own', () => {
    const want: Record<string, string> = {
      barbarian: 'Barbarian', bard: 'Bard, Gunslinger, Rogue', gunslinger: 'Bard, Gunslinger, Rogue', rogue: 'Bard, Gunslinger, Rogue',
      commander: 'Commander', exemplar: 'Exemplar', investigator: 'Investigator, Swashbuckler, Thaumaturge',
      swashbuckler: 'Investigator, Swashbuckler, Thaumaturge', thaumaturge: 'Investigator, Swashbuckler, Thaumaturge', ranger: 'Ranger',
    };
    // batch card: #card-OWN-SECTION — the record's own section, slice or class text
    for (const [cls, lead] of Object.entries(want)) expect(paragraphs(classFeatureDescription(pm, cls, c)), cls).toEqual([lead]);
  });

  // batch card: #card-OWN-SECTION — the record's own section, slice or class text
  it('Reflex Expertise: the generic paragraph for every class, the Guardian note for the guardian only', () => {
    for (const cls of ['bard', 'wizard', 'rogue', 'monk']) expect(paragraphs(classFeatureDescription(rx, cls, c)), cls).toEqual(['(generic)']);
    expect(paragraphs(classFeatureDescription(rx, 'guardian', c))).toEqual(['(generic)', 'Guardian']);
  });

  // batch card: #card-OWN-SECTION — the record's own section, slice or class text
  it('a cleric\'s Perception Expertise says expert (no class addenda: the text is whole)', () => {
    const pe = c.classFeatures['perception-expertise'].description;
    expect(classFeatureDescription(pe, 'cleric', c)).toBe(pe);
    // batch card premise: class-33 "Perception increases to expert"
    expect(pe).toMatch(/Perception increases to expert/);
  });

  // batch card: #card-OWN-SECTION — the record's own section, slice or class text
  it('no class sees a paragraph led by OTHER classes only, comma lists included', () => {
    const classNames = new Set(Object.values(c.classes).map((cl) => cl.name.toLowerCase()));
    const offenders: string[] = [];
    for (const cls of Object.values(c.classes)) {
      const me = cls.name.toLowerCase();
      for (const f of cls.features) {
        const feat = c.classFeatures[f.featureId];
        if (!feat) continue;
        for (const para of classFeatureDescription(feat.description, cls.id, c).split(/\n{2,}/)) {
          const lead = para.match(/^\s*\*\*([^*]+)\*\*/);
          const names = lead ? lead[1].split(/\s*,\s*|\s+and\s+/i).map((n) => n.trim().toLowerCase()) : [];
          if (names.length && names.every((n) => classNames.has(n)) && !names.includes(me)) offenders.push(`${cls.id}/${f.featureId} → ${lead![1].trim()}`);
        }
      }
    }
    // batch card: #card-OWN-SECTION — the record's own section, slice or class text
    expect(offenders, offenders.join('; ')).toEqual([]);
  });
});
