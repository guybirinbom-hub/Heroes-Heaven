import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { explainStat, statHasSituational } from '../src/rules/explain';
import { deriveSpeeds } from '../src/rules/derive';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 031, SITUATIONAL lane.
 *
 * Same discipline as batches 29 and 30: every assertion goes through the reader the SHEET uses —
 * `explainStat` (the stat detail popup), `statHasSituational` (the `*` cue on the row) or
 * `deriveSpeeds` (the number on the vitals rail). Asserting the registry literal would prove only
 * that a line was typed; an entry keyed to an id the character never contributes is invisible in
 * play, which is exactly the defect two of these four findings are.
 *
 * The swashbucklers-speed block asserts against PATCHED and STRIPPED in-memory copies of the record,
 * never a patched-vs-shipped delta: the data row is authored by the driver, so a shipped-side
 * assertion would flip the moment it lands.
 */
const db = content();

/** A character holding feats by id, the route `characterSituationalIds` reads first. */
const withFeats = (featIds: string[], classId = 'fighter', level = 8): Character => {
  const base = build(classId, level);
  return {
    ...base,
    feats: [...base.feats, ...featIds.map((featId, i) => ({ featId, level, slot: `b31:${i}` }))],
  } as unknown as Character;
};

/** The `when — bonus` lines one record puts on a stat row, as the popup renders them. */
const lines = (c: Character, ref: Parameters<typeof explainStat>[2], sourceId: string) =>
  (explainStat(c, db, ref).situational ?? []).filter((s) => s.sourceId === sourceId).map((s) => s.text);

describe('eerie-environs reaches the Intimidation row', () => {
  /* AoN feat-8419: "If you're hidden from a creature, you can attempt to Demoralize it without
   * losing your hidden condition… When you do so, you don't take a penalty to your check if the
   * target doesn't understand your language." Neither clause moves a number, so before this the
   * whole feat existed only as description text on the Feats tab. */

  // batch 031: eerie-environs
  it('a ranger holding eerie-environs gets both printed clauses on Intimidation', () => {
    const c = withFeats(['eerie-environs'], 'ranger', 8);
    const l = lines(c, { kind: 'skill', skill: 'intimidation' }, 'eerie-environs');
    expect(l.length, 'one line for the one Demoralize permission').toBe(1);
    expect(l[0]).toContain('Demoralize');
    expect(l[0]).toContain('hidden');
    expect(l[0]).toContain('language');
    // …and the row is starred, so the player is told to open the popup at all.
    expect(statHasSituational(c, { kind: 'skill', skill: 'intimidation' }, db)).toBe(true);
  });

  // batch 031: eerie-environs
  it('a ranger without eerie-environs gets nothing', () => {
    const plain = build('ranger', 8);
    expect(lines(plain, { kind: 'skill', skill: 'intimidation' }, 'eerie-environs')).toEqual([]);
  });
});

describe('murksight puts its precipitation clause on Perception', () => {
  /* AoN feat-5005: "You don't take circumstance penalties to ranged attacks or Perception checks
   * caused by non-magical precipitation…" Only the PERCEPTION half is authored — murksight#attack
   * was read and REFUTED, so the strike rows stay as they ship. */

  // batch 031: murksight#perception
  it('a witch holding murksight reads the clause in the Perception popup', () => {
    const c = withFeats(['murksight'], 'witch', 8);
    const l = lines(c, { kind: 'perception' }, 'murksight');
    expect(l.length, 'one line for the one Perception clause').toBe(1);
    expect(l[0]).toContain('fog');
    expect(l[0]).toContain('ignore the penalty');
    expect(statHasSituational(c, { kind: 'perception' }, db)).toBe(true);
    expect(lines(build('witch', 8), { kind: 'perception' }, 'murksight')).toEqual([]);
  });

  // batch 031: murksight#perception
  it('murksight does not claim the refuted attack half', () => {
    // The flat-check and ranged-attack sentences have no carrier on either side; promising them on a
    // strike row would ship more than the read found.
    const c = withFeats(['murksight'], 'witch', 8);
    expect(lines(c, { kind: 'strikeAttack' }, 'murksight')).toEqual([]);
  });
});

describe('monk-moves delivers its +10 exactly once', () => {
  /* AoN feat-6214: "You gain a +10-foot status bonus to your Speed when you're not wearing armor."
   * ONE bonus. The record's speedsIf already evaluates it from the character's own armour, so the
   * registry star advertised the same +10 a second time, as though it were still to be applied. */

  // batch 031: monk-moves#speed-star
  it('the number is still paid while unarmored, and withheld in armour', () => {
    const monk = build('monk', 5, { featPicks: { '3:class': 'monk-moves' } });
    const base = deriveSpeeds(build('monk', 5), db).land;
    expect(deriveSpeeds(monk, db).land, 'the evaluated speedsIf is the carrier').toBe(base + 10);
    const inPlate = (c: Character) =>
      deriveSpeeds({ ...c, inventory: [...c.inventory, { instanceId: 'hp', itemId: 'half-plate', quantity: 1, worn: true }] } as Character, db).land;
    // Half plate carries its own -10 speed penalty, so the test is that the FEAT adds nothing on top.
    expect(inPlate(monk), 'the clause says "when you\'re not wearing armor"').toBe(inPlate(build('monk', 5)));
  });

  // batch 031: monk-moves#speed-star
  it('the duplicate star is gone from the Speed popup', () => {
    const monk = build('monk', 5, { featPicks: { '3:class': 'monk-moves' } });
    expect(
      lines(monk, { kind: 'speed' }, 'monk-moves'),
      'the +10 is in the number; a star would promise it twice',
    ).toEqual([]);
  });
});

describe("swashbucklers-speed splits its floor from its panache remainder", () => {
  /* AoN feat-6238: "You gain a +5-foot status bonus to your Speeds; this increases to a +10-foot
   * status bonus while you have panache." The +5 is ALWAYS ON — a number, per the owner's speed
   * ruling — and only the panache step is conditional. Our record carried neither: the whole
   * mechanic was a star that moved nothing. */

  const patch = (rec: Record<string, unknown>): ContentDatabase =>
    ({ ...db, feats: { ...db.feats, 'swashbucklers-speed': { ...db.feats['swashbucklers-speed'], ...rec } } }) as ContentDatabase;

  // batch 031: swashbucklers-speed
  it('landSpeedBonus 5 on the record moves the Speed number, and its absence moves nothing', () => {
    /*
     * The data row is the driver's to author, so BOTH sides here are in-memory: a copy with the field
     * PATCHED IN and a copy with it STRIPPED. A shipped-side assertion would flip when the row lands.
     */
    const c = withFeats(['swashbucklers-speed'], 'fighter', 8);
    const stripped = patch({ landSpeedBonus: undefined });
    const patched = patch({ landSpeedBonus: 5 });
    expect(deriveSpeeds(c, patched).land, 'the always-on +5 is in the Speed').toBe(deriveSpeeds(c, stripped).land + 5);
    // …and it is the FEAT that pays it: a character without the feat is unaffected by the field.
    const none = build('fighter', 8);
    expect(deriveSpeeds(none, patched).land).toBe(deriveSpeeds(none, stripped).land);
  });

  /* VERIFIER ADDITION. The number moving is only half the reach: explain.ts's speed block exists to
   * keep the breakdown SUMMING to the total ("so the breakdown still SUMS to the total — the property
   * this block exists to preserve"), and a landSpeedBonus that moved the total without an itemised
   * line would break exactly that. Asserted on the same PATCHED copy, so it holds before and after
   * the driver applies the row. */
  // batch 031: swashbucklers-speed
  it('the +5 is itemised in the Speed breakdown, not just folded into the total', () => {
    const c = withFeats(['swashbucklers-speed'], 'fighter', 8);
    const e = explainStat(c, patch({ landSpeedBonus: 5 }), { kind: 'speed' });
    const mine = e.parts.filter((p) => p.note === db.feats['swashbucklers-speed'].name);
    expect(mine.map((p) => p.value), "the feat pays +5 under its own name").toEqual([5]);
    const sum = e.parts.reduce((n, p) => n + p.value, 0);
    expect(`${sum} ft`, 'the parts still add up to the total').toBe(e.totalText);
  });

  // batch 031: swashbucklers-speed
  it('the star is trimmed to the panache remainder and says the floor is already paid', () => {
    const c = withFeats(['swashbucklers-speed'], 'fighter', 8);
    const l = lines(c, { kind: 'speed' }, 'swashbucklers-speed');
    expect(l.length).toBe(1);
    expect(l[0]).toContain('panache');
    expect(l[0]).toContain('+10-foot status');
    expect(l[0]).toContain('already in your Speed');
    // The old wording promised the +5 as something still to be applied; that is now the number.
    expect(l[0]).not.toContain('without panache you still get');
  });
});
