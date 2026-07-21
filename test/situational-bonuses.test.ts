import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { explainStat, statHasSituational } from '../src/rules/explain';
import { featSituationalFor, hasFeatSituational, FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';

describe('feat situational bonuses', () => {
  const c = content();

  it('the registry is populated and well-formed', () => {
    const ids = Object.keys(FEAT_SITUATIONAL);
    expect(ids.length).toBeGreaterThan(200);
    // every entry names a real feat and has targets + text
    for (const id of ids) {
      expect(c.feats[id], id).toBeTruthy();
      for (const b of FEAT_SITUATIONAL[id]) {
        expect(b.targets.length, id).toBeGreaterThan(0);
        expect(b.when.length, id).toBeGreaterThan(0);
        expect(b.bonus.length, id).toBeGreaterThan(0);
      }
    }
  });

  it('Intimidating Prowess flags Intimidation and lists its condition', () => {
    expect(featSituationalFor(['intimidating-prowess'], { kind: 'skill', skill: 'intimidation' })).toHaveLength(1);
    // …but not other skills.
    expect(featSituationalFor(['intimidating-prowess'], { kind: 'skill', skill: 'stealth' })).toHaveLength(0);
    expect(hasFeatSituational(['intimidating-prowess'], { kind: 'skill', skill: 'intimidation' })).toBe(true);
  });

  it("a save 'all' entry matches every save; a specific one matches only itself", () => {
    // adhyabhau: Will only. affliction-resistance / bloodline-resistance: all saves.
    expect(hasFeatSituational(['adhyabhau'], { kind: 'save', save: 'will' })).toBe(true);
    expect(hasFeatSituational(['adhyabhau'], { kind: 'save', save: 'reflex' })).toBe(false);
    expect(hasFeatSituational(['bloodline-resistance'], { kind: 'save', save: 'reflex' })).toBe(true);
    expect(hasFeatSituational(['bloodline-resistance'], { kind: 'save', save: 'fortitude' })).toBe(true);
  });

  it('surfaces in the stat breakdown and drives the star', () => {
    // Give a rogue Intimidating Prowess (it's a skill feat).
    const ch = build('rogue', 4, { featPicks: { '2:skill:0': 'intimidating-prowess' } as never });
    expect(ch.feats.some((f) => f.featId === 'intimidating-prowess')).toBe(true);

    const b = explainStat(ch, c, { kind: 'skill', skill: 'intimidation' });
    expect(b.situational?.some((s) => /Intimidating Prowess/.test(s) && /Coerce or Demoralize/.test(s))).toBe(true);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'intimidation' })).toBe(true);
    // a skill the feat doesn't touch has no star
    expect(statHasSituational(ch, { kind: 'skill', skill: 'stealth' })).toBe(false);
  });

  it('a character without the feat gets no star and no note', () => {
    const ch = build('rogue', 4);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'intimidation' })).toBe(false);
    const b = explainStat(ch, c, { kind: 'skill', skill: 'intimidation' });
    expect(b.situational?.some((s) => /Intimidating Prowess/.test(s)) ?? false).toBe(false);
  });
});
