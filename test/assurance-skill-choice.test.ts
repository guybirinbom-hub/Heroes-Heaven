import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { trainedSkillOptions } from '../src/rules/build';

const c = content();

/**
 * THE ORIGINAL BUG. Assurance says "Choose a skill you're trained in", but its record carried no
 * machine-readable choice, so the builder never prompted and the feat did nothing. The app is
 * data-field-driven: rules text alone has no effect.
 *
 * The fix could not be a fixed option list. Which skills qualify depends on the BUILD and grows with
 * it, so the options are resolved from the character — a new choice kind, 'skills'.
 */
describe('Assurance — choose a skill you are trained in', () => {
  it('the record now carries a skills choice', () => {
    const feat = c.feats['assurance'];
    expect(feat.choice).toEqual({ flag: 'assuredSkill', prompt: 'Skill', kind: 'skills' });
  });

  it('offers exactly the skills the character is trained in — no more, no less', () => {
    const ch = build('rogue', 5);
    const opts = trainedSkillOptions(ch, 'trained');
    const trained = Object.entries(ch.proficiencies.skills)
      .filter(([, r]) => r !== 'untrained')
      .map(([k]) => k);
    expect(opts.length).toBe(trained.length);
    expect(opts.map((o) => o.value).sort()).toEqual(trained.sort());
    // An untrained skill must never be offered — that is the feat's actual restriction.
    const untrained = Object.entries(ch.proficiencies.skills).filter(([, r]) => r === 'untrained').map(([k]) => k);
    for (const u of untrained) expect(opts.some((o) => o.value === u), `${u} is untrained`).toBe(false);
  });

  it('grows with the build rather than being fixed on the record', () => {
    // A rogue (many skills) must be offered more than a fighter of the same level.
    const rogue = trainedSkillOptions(build('rogue', 5), 'trained').length;
    const fighter = trainedSkillOptions(build('fighter', 5), 'trained').length;
    expect(rogue).toBeGreaterThan(fighter);
    // …and the same character at a higher level is offered at least as many.
    expect(trainedSkillOptions(build('rogue', 15), 'trained').length).toBeGreaterThanOrEqual(rogue);
  });

  it('Automatic Knowledge restricts to EXPERT, a stricter bar than Assurance', () => {
    const feat = c.feats['automatic-knowledge'];
    expect(feat.choice?.minRank).toBe('expert');
    const ch = build('rogue', 7);
    const expert = trainedSkillOptions(ch, 'expert');
    const trained = trainedSkillOptions(ch, 'trained');
    expect(expert.length).toBeLessThan(trained.length);
    for (const o of expert) expect(ch.proficiencies.skills[o.value]).not.toBe('trained');
  });

  it('labels are readable, and Lores keep their subject', () => {
    const opts = trainedSkillOptions(build('rogue', 5), 'trained');
    for (const o of opts) {
      expect(o.label, o.value).toMatch(/^[A-Z]/); // never a raw slug
      expect(o.label).toMatch(/\((U|T|E|M|L)\)$/); // rank is shown so the pick is informed
    }
    const lore = trainedSkillOptions(
      { proficiencies: { skills: { 'lore:sailing': 'trained' } } },
      'trained',
    );
    expect(lore[0].label).toBe('Sailing Lore (T)');
  });
});
