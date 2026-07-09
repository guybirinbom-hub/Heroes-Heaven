import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { mythicCallings, generalMythicFeats, mythicDestinies } from '../src/sheet/MythicRules';

/*
 * The Mythic rules page renders entirely from content data, so these lock the derivations that
 * feed it: callings, the general (archetype-less) mythic feats, and the per-destiny grouping.
 * If the underlying core.json shape changes, these catch drift before the reference page misleads.
 */
const c = content();

describe('mythicCallings', () => {
  it('returns the calling-trait class features, alphabetical', () => {
    const callings = mythicCallings(c);
    expect(callings.length).toBeGreaterThanOrEqual(18);
    expect(callings.every((f) => f.traits.includes('calling'))).toBe(true);
    const names = callings.map((f) => f.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names); // already sorted
    expect(names).toContain("Acrobat's Calling");
  });
});

describe('generalMythicFeats', () => {
  const general = generalMythicFeats(c);

  it('are mythic-trait feats with no archetype (the even-level slot options)', () => {
    expect(general.length).toBeGreaterThan(40);
    expect(general.every((f) => f.traits.includes('mythic'))).toBe(true);
    expect(general.every((f) => !f.archetype)).toBe(true);
  });

  it('excludes destiny feats (which belong to an archetype)', () => {
    // Behold, a Pale Horse is an Apocalypse Rider destiny feat — must NOT appear among general feats.
    expect(general.find((f) => /Behold, a Pale Horse/i.test(f.name))).toBeUndefined();
  });

  it('spans the even levels a mythic hero actually gains slots at', () => {
    const levels = new Set(general.map((f) => f.level));
    for (const l of [2, 4, 6, 8, 10]) expect(levels.has(l)).toBe(true);
  });
});

describe('mythicDestinies', () => {
  const destinies = mythicDestinies(c);
  const by = (name: string) => destinies.find((d) => d.name === name);

  it('groups every mythic archetype under its L12 dedication', () => {
    // 13 destiny-trait dedications + Mortal Herald.
    expect(destinies.length).toBeGreaterThanOrEqual(14);
    for (const d of destinies) {
      expect(d.dedication).toBeDefined();
      expect(d.dedication!.level).toBe(12);
      expect(/dedication$/i.test(d.dedication!.name)).toBe(true);
    }
  });

  it('picks the DEDICATION (not a stray class-category feat) as each heading', () => {
    // Godling's dedication — not "Absolve Sins", a Godling feat that also carries category 'class'.
    const godling = by('Godling');
    expect(godling).toBeDefined();
    expect(godling!.dedication!.name).toBe('Godling Dedication');
    expect(godling!.feats.find((f) => f.name === 'Godling Dedication')).toBeUndefined(); // dedication not doubled into its own feat list
  });

  it("a destiny's feats all share its archetype slug, carry the mythic trait, and are level-sorted", () => {
    const apoc = by('Apocalypse Rider');
    expect(apoc).toBeDefined();
    expect(apoc!.feats.length).toBeGreaterThan(0);
    expect(apoc!.feats.every((f) => f.archetype === apoc!.slug)).toBe(true);
    expect(apoc!.feats.every((f) => f.traits.includes('mythic'))).toBe(true);
    const levels = apoc!.feats.map((f) => f.level);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
  });

  it('is alphabetical by destiny name', () => {
    const names = destinies.map((d) => d.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });
});
