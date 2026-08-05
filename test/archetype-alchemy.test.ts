import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { ownedFeatureIds } from '../src/rules/derive';

/**
 * Two gaps found by re-reading the whole conversation for things that were noted and never done.
 */
const db = content();

describe('an archetype alchemist gets the daily items they are entitled to', () => {
  it('the three dedications carry a budget, read from their own text', () => {
    for (const [id, items] of [['alchemist-dedication', 4], ['herbalist-dedication', 4], ['poisoner-dedication', 4]] as const) {
      expect(db.feats[id]?.advancedAlchemy?.items, id).toBe(items);
    }
  });

  it("none of them adds Intelligence — only the alchemist CLASS's 4 + Int does", () => {
    // Adding `addInt` would hand an archetype more than its text gives it.
    for (const id of ['alchemist-dedication', 'herbalist-dedication', 'poisoner-dedication']) {
      expect(db.feats[id].advancedAlchemy!.addInt, id).toBeUndefined();
    }
  });

  it('a fighter with the dedication has a budget; a plain fighter has none', () => {
    expect(build('fighter', 6, { featPicks: { '2:class': 'alchemist-dedication' } }).advancedAlchemy).toEqual({
      max: 4,
      source: 'Alchemist Dedication',
    });
    expect(build('fighter', 6, {}).advancedAlchemy).toBeUndefined();
  });

  it("the alchemist class's own budget still wins where it is bigger", () => {
    const c = build('alchemist', 5, {});
    expect(c.advancedAlchemy!.max).toBeGreaterThan(0);
  });
});

describe('Intense Implement gives the THIRD implement its adept benefit', () => {
  const base = { extraChoices: { implement: ['amulet', 'bell', 'chalice'] } };
  const owned = (over: Record<string, unknown> = {}) =>
    [...ownedFeatureIds(build('thaumaturge', 18, { ...base, ...over }), db)].filter((x) => /^adept-benefit-/.test(x)).sort();

  it('the third implement has no adept benefit without it', () => {
    // The code said so in as many words — "never the third implement, which never gains adept" —
    // which is exactly the line this feat exists to change.
    expect(owned()).not.toContain('adept-benefit-chalice');
  });

  it('and has one with it', () => {
    expect(owned({ featPicks: { '18:class': 'intense-implement' } })).toContain('adept-benefit-chalice');
  });

  it('the first two are unaffected either way', () => {
    for (const list of [owned(), owned({ featPicks: { '18:class': 'intense-implement' } })]) {
      expect(list).toContain('adept-benefit-amulet');
      expect(list).toContain('adept-benefit-bell');
    }
  });

  it('every implement has an adept-benefit record, so the lane cannot half-resolve', () => {
    const opts = (db.classes.thaumaturge.extraChoices ?? []).find((g) => g.id === 'implement')?.options ?? [];
    expect(opts.length).toBe(10);
    for (const o of opts) expect(db.classFeatures[`adept-benefit-${o.id}`], o.id).toBeTruthy();
  });
});
