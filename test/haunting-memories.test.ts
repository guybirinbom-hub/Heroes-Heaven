import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { dailyChoicesFor } from '../src/rules/dailyChoices';
import { deriveSkill } from '../src/rules/derive';

/**
 * Haunting Memories offers TWO alternative branches over every skill, re-chosen nightly: expert in
 * something you're untrained in, or master in something you're trained in.
 *
 * `conditionalSkills` carries one base→upgraded pair per skill and could not say this; a plain menu
 * of skills would let a player take an untrained skill straight to master. Each skill is therefore
 * offered exactly once, under whichever branch legally applies to it right now.
 */
const db = content();
const ghost = (dailyChoices?: Record<string, string>) => {
  const ch = build('rogue', 10, { featPicks: { '8:class:0': 'haunting-memories' } } as never);
  return dailyChoices ? { ...ch, dailyChoices } : ch;
};
const KEY = 'haunting-memories:hauntingMemory';

describe('Haunting Memories — a nightly skill, on whichever branch fits', () => {
  it('offers every skill exactly once, on the branch its current rank allows', () => {
    const ch = ghost();
    const choice = dailyChoicesFor(ch, db).find((c) => c.key === KEY);
    expect(choice, 'the choice never reached the Rest sheet').toBeTruthy();
    const perSkill = new Map<string, string[]>();
    for (const o of choice!.options) {
      const skill = o.value.replace(/^(expert|master)-/, '');
      perSkill.set(skill, [...(perSkill.get(skill) ?? []), o.value.split('-')[0]]);
    }
    expect(perSkill.size).toBeGreaterThan(10);
    for (const [skill, branches] of perSkill) expect(branches, skill).toHaveLength(1);
  });

  it('a trained skill is offered master, an untrained one expert — never the reverse', () => {
    const ch = ghost();
    const choice = dailyChoicesFor(ch, db).find((c) => c.key === KEY)!;
    const offered = new Set(choice.options.map((o) => o.value));
    // A rogue is trained in Stealth and untrained in Arcana — assert against the real build, not a
    // guess, so a class change cannot quietly make this test vacuous.
    expect(ch.proficiencies.skills.stealth, 'rogue Stealth').not.toBe('untrained');
    expect(ch.proficiencies.skills.arcana ?? 'untrained').toBe('untrained');
    expect(offered.has('master-stealth')).toBe(true);
    expect(offered.has('expert-stealth')).toBe(false);
    expect(offered.has('expert-arcana')).toBe(true);
    expect(offered.has('master-arcana')).toBe(false);
  });

  it('the answer actually moves the skill', () => {
    const before = deriveSkill(ghost(), 'arcana', db);
    const after = deriveSkill(ghost({ [KEY]: 'expert-arcana' }), 'arcana', db);
    expect(before.rank).toBe('untrained');
    expect(after.rank).toBe('expert');
    expect(after.modifier).toBeGreaterThan(before.modifier);
  });

  it('an answer whose gate no longer holds grants nothing', () => {
    // Picked "Arcana → expert" while untrained; a stored master-* answer for the same untrained skill
    // must not apply, or the morning's answer outlives the condition it was chosen under.
    const stale = deriveSkill(ghost({ [KEY]: 'master-arcana' }), 'arcana', db);
    expect(stale.rank).toBe('untrained');
  });

  /*
   * BATCH 037 MOVED THE SKILL-FEAT HALF TO ITS OWN QUESTION. Print gives two things each morning —
   * the rank and *"one skill feat with a minimum requirement of your new rank in the chosen skill"*
   * (feat-7701) — and one `choice` can only ask one of them, so the second is now the daily choice on
   * feats/haunting-memories-skill-feat. The half-your-level cap moved with it, onto the record that
   * actually filters the list; the skill record's note points at it. Both halves are asserted, so
   * neither can go missing.
   */
  // batch 037: haunting-memories#skill-feat-pick
  it('the bonus skill feat is its own daily question, capped at half your level', () => {
    expect(db.feats['haunting-memories'].choice?.note).toMatch(/its own question/i);
    expect(db.feats['haunting-memories'].dataWarning).toBeUndefined();
    const feat = db.feats['haunting-memories-skill-feat'];
    expect(feat, 'the skill-feat half needs a record to live on').toBeTruthy();
    expect(feat.choice?.daily).toBe(true);
    // batch 037: haunting-memories#skill-feat-pick
    expect(feat.choice?.note).toMatch(/half your level/i);
    // batch 037: haunting-memories#skill-feat-pick
    expect(feat.choice?.from?.featCategory).toBe('skill');
  });
});
