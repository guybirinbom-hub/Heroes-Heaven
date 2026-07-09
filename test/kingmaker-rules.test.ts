import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { campingActivities, kingdomActivities, kingdomFeats } from '../src/sheet/KingmakerRules';

/*
 * The Kingmaker rules page renders from content data — these lock its three derivations so the
 * reference (and the Play-tab camping list, which shares campingActivities) can't silently drift.
 */
const c = content();

describe('campingActivities', () => {
  const camping = campingActivities(c);
  it('are the camping-trait actions, alphabetical', () => {
    expect(camping.length).toBeGreaterThanOrEqual(20);
    expect(camping.every((a) => a.traits.includes('camping'))).toBe(true);
    const names = camping.map((a) => a.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
    expect(names).toContain('Organize Watch');
  });
});

describe('kingdomActivities', () => {
  const acts = kingdomActivities(c);
  it('are Kingmaker downtime/leadership/region/civic actions, not camping, not army', () => {
    expect(acts.length).toBeGreaterThan(30);
    expect(acts.every((a) => /kingmaker/i.test(a.source?.book ?? ''))).toBe(true);
    expect(acts.every((a) => !a.traits.includes('camping'))).toBe(true);
    // never a warfare/army action
    const armyish = ['army', 'cavalry', 'infantry', 'skirmisher', 'siege', 'maneuver', 'morale'];
    expect(acts.some((a) => armyish.some((t) => a.traits.includes(t)))).toBe(false);
    expect(acts.map((a) => a.name)).toContain('Quell Unrest');
  });
});

describe('kingdomFeats', () => {
  const feats = kingdomFeats(c);
  it('are the kingdom-trait feats (kingdom-level feats, not a PC feat like "My Kingdom, My Blood")', () => {
    expect(feats.length).toBeGreaterThanOrEqual(15);
    expect(feats.every((f) => f.traits.includes('kingdom'))).toBe(true);
    const names = feats.map((f) => f.name);
    expect(names).toContain('Civil Service');
    expect(names).not.toContain('My Kingdom, My Blood'); // a mythic PC feat, not a kingdom feat
  });
});
