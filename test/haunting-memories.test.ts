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

  it('the bonus skill feat is stated rather than granted as an unconstrained slot', () => {
    // Its prerequisite is checked against HALF your level and it must have a minimum requirement of
    // the new rank in that same skill — neither of which the slot filter can express.
    expect(db.feats['haunting-memories'].choice?.note).toMatch(/half your level/i);
    expect(db.feats['haunting-memories'].dataWarning).toBeUndefined();
  });
});
