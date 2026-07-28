import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { explainStat, statHasSituational } from '../src/rules/explain';
import { featSituationalFor, hasFeatSituational, FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';

describe('feat situational bonuses', () => {
  const c = content();

  it('every registry key is a plain slug', () => {
    // A generated key once arrived as "items/kraken-figurehead", and another as a COMMA-SEPARATED
    // list of four ids in one key. The obvious dead-id scan uses /[a-z0-9-]+/, which does not flag
    // those — it skips them, so they shipped silently and the scan reported zero problems. Assert the
    // SHAPE of the key, not just that it resolves.
    const bad = Object.keys(FEAT_SITUATIONAL).filter((k) => !/^[a-z0-9-]+$/.test(k));
    expect(bad, `malformed registry keys: ${bad.join(' | ')}`).toHaveLength(0);
  });

  it('the registry is populated and well-formed', () => {
    const ids = Object.keys(FEAT_SITUATIONAL);
    expect(ids.length).toBeGreaterThan(200);
    // The table is named FEAT_SITUATIONAL for history, but a conditional bonus comes from an ITEM
    // (Coral Aspect), a heritage, a background or a class feature just as often as from a feat — and
    // since the reach fix all of those raise the star. So an id must resolve in SOME collection;
    // the old feats-only assertion would now reject correct data.
    // Companion buckets are included because records like `aon-vulture` (an animal companion) and
    // `steadfast-strider` (a companion specialization) legitimately carry conditional bonuses. Note
    // those bonuses apply to the COMPANION, not the PC, so they correctly do not raise a star on the
    // player's own rows — characterSituationalIds does not walk companions.
    const cols: (Record<string, unknown> | undefined)[] = [
      c.feats, c.items, c.heritages, c.backgrounds, c.classFeatures, c.ancestries,
      c.animalCompanions, c.companionSpecializations,
    ];
    const dead = ids.filter((id) => !cols.some((col) => col && col[id]));
    expect(dead, `registry ids matching no record: ${dead.slice(0, 8).join(', ')}`).toHaveLength(0);
    for (const id of ids) {
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
