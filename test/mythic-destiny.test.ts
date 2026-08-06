import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { emptyBuild, type BuildState } from '../src/rules/build';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';
import { DESTINY_LEVEL, destinyDedications, destinySlugs, isDestinyDedication } from '../src/rules/mythic';
import { MAX_MYTHIC_POINTS } from '../src/rules/play';

/**
 * War of Immortals p.77: "At 12th level, they must use their extra feat to take the 12th-level
 * destiny feat for a mythic destiny, and from 14th level on, they can take feats from that mythic
 * destiny or take lower-level mythic feats they haven't already taken. Characters can have only one
 * mythic destiny."
 *
 * The slot filter was `f.traits.includes('mythic')`, which broke all three clauses at once.
 */
const db = content();

const mythicBuild = (level: number, destiny?: string | null): BuildState =>
  ({
    ...emptyBuild(),
    classId: 'fighter',
    level,
    ancestryId: 'human',
    backgroundId: Object.keys(db.backgrounds)[0],
    mythicEnabled: true,
    ...(destiny !== undefined ? { mythicDestiny: destiny } : {}),
  }) as BuildState;

const offered = (level: number, destiny?: string | null) =>
  eligibleFeatsForSlot(mythicBuild(level, destiny), db, { level, category: 'mythic', idx: 0 });

describe('the mythic point maximum', () => {
  it('is a fixed 3 and never scales', () => {
    // "Each mythic character starts the session with 3 Mythic Points and can have a maximum of 3
    // Mythic Points at any time." Checked because the roadmap asked whether it scales. It does not.
    expect(MAX_MYTHIC_POINTS).toBe(3);
  });
});

describe('destiny identification', () => {
  it('finds every destiny, including the one with no mythic trait', () => {
    const ded = destinyDedications(db);
    expect(ded.length).toBeGreaterThanOrEqual(14);
    for (const f of ded) expect(f.level, f.id).toBe(DESTINY_LEVEL);
    // Mortal Herald is a destiny by its own rules text and carries only archetype/dedication traits,
    // so a `mythic`-trait test made the 14th destiny unreachable.
    const mh = db.feats['mortal-herald-dedication'];
    expect(mh, 'mortal-herald-dedication is missing from the data').toBeTruthy();
    expect(mh.traits).not.toContain('mythic');
    expect(isDestinyDedication(mh, db), 'Mortal Herald is not recognised as a destiny').toBe(true);
    expect(ded.map((f) => f.id)).toContain('mortal-herald-dedication');
  });
});

describe('the 12th-level slot must buy a destiny', () => {
  it('offers destiny dedications and nothing else', () => {
    const at12 = offered(12);
    expect(at12.length).toBeGreaterThan(0);
    for (const f of at12) expect(isDestinyDedication(f, db), `${f.id} is not a destiny`).toBe(true);
    // Mortal Herald must be among them — it is the case the old filter dropped.
    expect(at12.map((f) => f.id)).toContain('mortal-herald-dedication');
  });

  it('a slot below 12 offers mythic feats but never a destiny', () => {
    const at10 = offered(10);
    expect(at10.length).toBeGreaterThan(0);
    for (const f of at10) expect(isDestinyDedication(f, db), `${f.id} at level 10`).toBe(false);
    for (const f of at10) expect(f.traits).toContain('mythic');
  });
});

describe('only one destiny, ever', () => {
  const slugs = [...destinySlugs(db)];
  const withFeats = slugs.find((s) => Object.values(db.feats).some((f) => f.archetype === s && (f.traits ?? []).includes('mythic') && (f.level ?? 0) <= 14));

  it('a slot above 12 offers this destiny’s feats and no other destiny’s', () => {
    expect(withFeats, 'no destiny with a low-level mythic feat to test with').toBeTruthy();
    const at14 = offered(14, withFeats);
    expect(at14.length).toBeGreaterThan(0);
    const others = at14.filter((f) => f.archetype && f.archetype !== withFeats && destinySlugs(db).has(f.archetype));
    expect(others.map((f) => f.id), 'feats from a SECOND destiny are on offer').toEqual([]);
    // …and its own destiny's feats really are there, so the filter is not just empty.
    expect(at14.some((f) => f.archetype === withFeats), 'none of the chosen destiny’s feats are offered').toBe(true);
  });

  it('with no destiny chosen, a slot above 12 offers only general mythic feats', () => {
    // Offering every destiny's feats is exactly the mistake; offering the archetype-less ones is safe.
    const at14 = offered(14, null);
    for (const f of at14) {
      if (f.archetype && destinySlugs(db).has(f.archetype)) throw new Error(`${f.id} belongs to a destiny not chosen`);
    }
  });

  it('a destiny is never offered twice', () => {
    for (const f of offered(14, withFeats)) expect(isDestinyDedication(f, db), f.id).toBe(false);
  });
});

describe('the chosen destiny reaches the character', () => {
  it('is carried through the build and round-trips', () => {
    const slug = destinyDedications(db)[0].archetype as string;
    const ch = build('fighter', 12, { mythicEnabled: true, mythicDestiny: slug } as never);
    expect(ch.mythicDestiny).toBe(slug);
  });

  it('is absent when mythic is off', () => {
    const slug = destinyDedications(db)[0].archetype as string;
    expect(build('fighter', 12, { mythicDestiny: slug } as never).mythicDestiny).toBeUndefined();
  });
});
