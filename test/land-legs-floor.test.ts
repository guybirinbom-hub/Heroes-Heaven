import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { deriveSpeeds } from '../src/rules/derive';

/**
 * "YOU GAIN A LAND SPEED OF 20" IS A FLOOR, NOT A BONUS.
 *
 * Land Legs (AoN feat-5300) prints exactly the sentence its two sibling heritages print — Flying
 * Animal's "You have a land Speed of 20 feet", Running Animal's "a land Speed of 30 feet" — and both
 * of those are authored as `landSpeedMin`. Land Legs alone was authored as `landSpeedBonus: 15`, a
 * number that is only ever right because Awakened Animal's base Speed happens to be 5.
 *
 * deriveSpeeds applies the floor first and the bonus after, so the two composed: a flying animal who
 * took Land Legs walked at 35 feet and a running animal at 45. Nothing gates the pairing.
 */
const c = () => content();
const landSpeed = (heritageId: string, withLegs: boolean) =>
  deriveSpeeds(
    build('fighter', 5, {
      ancestryId: 'awakened-animal',
      heritageId,
      ...(withLegs ? { featPicks: { '1:ancestry:0': 'land-legs' } } : {}),
    }),
    c(),
  ).land;

describe('Land Legs', () => {
  it('raises a 5-foot base to its printed 20, and never past another heritage’s higher floor', () => {
    // the case it was authored for — unchanged
    expect(landSpeed('swimming-animal', false)).toBe(5);
    expect(landSpeed('swimming-animal', true)).toBe(20);
    // the two it was silently inflating
    expect(landSpeed('flying-animal', false)).toBe(20);
    expect(landSpeed('flying-animal', true)).toBe(20); // was 35
    expect(landSpeed('running-animal', false)).toBe(30);
    expect(landSpeed('running-animal', true)).toBe(30); // was 45
  });

  it('is authored as a floor, like the two heritages printing the same sentence', () => {
    const con = c();
    expect(con.feats['land-legs'].landSpeedMin).toBe(20);
    expect(con.feats['land-legs'].landSpeedBonus).toBeUndefined();
    expect(con.heritages['flying-animal'].landSpeedMin).toBe(20);
    expect(con.heritages['running-animal'].landSpeedMin).toBe(30);
  });
});

/**
 * A record's fields may not promise what its grant does not deliver, and a note may not state a rule
 * the book does not print.
 */
describe('Swimming Animal’s water-dwelling branch', () => {
  const branch = () => c().heritages['swimming-animal'].effectChoices![0].options.find((o) => o.value === 'water-dwelling')!;

  it('no longer advertises a land Speed its grant cannot set', () => {
    const o = branch();
    expect(o.label).not.toMatch(/land Speed/i);
    expect(o.grant?.speeds?.land).toBeUndefined();
    expect(o.grant?.speeds?.swim).toBe(20);
  });

  it('and its note states the printed clause instead of the app’s inference about the aquatic trait', () => {
    const o = branch();
    expect(o.note).not.toMatch(/you do NOT gain the aquatic trait/i);
    expect(o.note).toMatch(/hold your breath underwater for 10 minutes/i);
  });
});

/** A `duration` is "the printed duration". Fey Life prints none. */
describe('the Fey Life mode', () => {
  it('carries no duration the feat never states', () => {
    expect(c().modes!['fey-life-revived']?.duration).toBeUndefined();
    expect(c().modes!['fey-life-revived']?.creatureTraits).toEqual(['fey']);
  });
});
