import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveSpeeds } from '../src/rules/derive';
import { statHasSituational } from '../src/rules/explain';
import type { Character } from '../src/rules/types';

/*
 * A SPEED IS A NUMBER ONLY WHILE IT IS ALWAYS ON.
 *
 * Owner ruling 2026-08-22: *"we give an actual speed only when it's always; if it is dependent on
 * something it's in a *"*. Two lanes, and four records were in the wrong one — Monk Moves paid its
 * +10 in full plate. Where the sheet can SEE the condition (armour, a designated innovation) the
 * number is evaluated; where it cannot (a terrain, flying via magic) it is a star that never moves a
 * number. Each case below asserts BOTH halves: granted when it should be, absent when it should not.
 */
const db = content();

const equip = (c: Character, itemId: string, extra: Record<string, unknown> = {}): Character => ({
  ...c,
  inventory: [...c.inventory, { instanceId: `i-${itemId}`, itemId, quantity: 1, worn: true, ...extra }],
});

describe('conditional speeds are evaluated, not paid out permanently', () => {
  it('Monk Moves pays +10 unarmored and NOTHING in armour', () => {
    const monk = build('monk', 5, { featPicks: { '3:class': 'monk-moves' } });
    const base = deriveSpeeds(build('monk', 5), db).land;
    expect(deriveSpeeds(monk, db).land, 'unarmored: the status bonus applies').toBe(base + 10);

    const armoured = equip(monk, 'half-plate');
    expect(
      deriveSpeeds(armoured, db).land,
      'in half plate the feat gives nothing — its clause says "when you\'re not wearing armor"',
    ).toBeLessThan(base + 10);
  });

  it("explorer's clothing still counts as unarmored", () => {
    /* It is *unarmored*-category armour, so the question is the category, not whether a suit is worn. */
    const monk = build('monk', 5, { featPicks: { '3:class': 'monk-moves' } });
    const base = deriveSpeeds(build('monk', 5), db).land;
    expect(deriveSpeeds(equip(monk, 'explorers-clothing'), db).land).toBe(base + 10);
  });

  it('Soaring Armor grants a fly Speed only while the innovation is worn', () => {
    const inv = build('inventor', 13, { featPicks: { '13:class': 'soaring-armor' } });
    expect(deriveSpeeds(inv, db).fly ?? 0, 'no innovation worn, no fly Speed').toBe(0);

    const withSuit = equip(inv, 'half-plate', { designations: ['innovation'] });
    expect(deriveSpeeds(withSuit, db).fly, 'wearing the designated innovation').toBe(deriveSpeeds(withSuit, db).land);
  });

  it('a worn suit that is NOT the designated innovation grants nothing', () => {
    /* The designation is the gate, not merely wearing armour — otherwise any suit would fly. */
    const inv = equip(build('inventor', 13, { featPicks: { '13:class': 'soaring-armor' } }), 'half-plate');
    expect(deriveSpeeds(inv, db).fly ?? 0).toBe(0);
  });
});

describe('conditions the sheet cannot see stay stars and never move a number', () => {
  it('Favored Terrain grants no Speed at all, and stars the Speed row', () => {
    const ranger = build('ranger', 11, { featPicks: { '2:class': 'favored-terrain' }, featChoices: { '2:class': 'aquatic' } });
    const speeds = deriveSpeeds(ranger, db);
    expect(speeds.swim ?? 0, 'the swim Speed is conditional — it must not be a number').toBe(0);
    expect(speeds.fly ?? 0).toBe(0);
    expect(statHasSituational(ranger, { kind: 'speed' }, db), 'but the player must see the star').toBe(true);
  });

  it('all nine terrains are stated — Arctic and Desert were missing entirely', () => {
    const clauses = db.feats['favored-terrain'].situational ?? [];
    expect(clauses.length).toBe(7);
    const text = clauses.map((s) => s.when).join(' | ');
    for (const terrain of ['Aquatic', 'Arctic', 'Desert', 'Plains', 'Sky', 'Swamp', 'Forest']) {
      expect(text, `${terrain} must be stated somewhere`).toContain(terrain);
    }
  });

  it('Shory Aerialist stars its fly bonus rather than granting a fly Speed', () => {
    const ch = build('fighter', 5, { featPicks: { '4:class': 'shory-aerialist' } });
    expect(deriveSpeeds(ch, db).fly ?? 0, '"flying via magic" is not a state the sheet holds').toBe(0);
    expect(statHasSituational(ch, { kind: 'speed' }, db)).toBe(true);
  });
});
