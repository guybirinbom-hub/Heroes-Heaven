import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { abilityMod, deriveClassDc, deriveSpecialStats } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import type { Character } from '../src/rules/types';

/**
 * The `specialStatistic` lane — a NAMED statistic the player rolls (or whose DC an opponent beats)
 * that no other row on the sheet is labelled for.
 *
 * The kineticist's impulse attack roll is the case that proves the lane is needed rather than a
 * rename: 18 impulse feats say "Make an impulse attack roll", the Impulses class feature prints the
 * whole formula, a *gate attenuator* raises it "(but not to your impulse DC)" — and nothing in the
 * app derived it, so the number existed nowhere.
 *
 * The archetype half is the reason `basis` names a CLASS DC instead of a rank: Kineticist Dedication
 * grants "kineticist class DC and impulse attack rolls" in one sentence, so both have to resolve from
 * the borrowed DC or they would disagree the moment a feat raised one of them.
 */
const db = content();

describe('special statistics', () => {
  it("a kineticist's impulse attack roll is class DC minus 10", () => {
    const ch = build('kineticist', 7, {});
    const stat = deriveSpecialStats(ch, db).find((s) => s.key === 'impulse-attack');
    expect(stat, 'no impulse attack roll on a 7th-level kineticist').toBeDefined();
    // "This means your impulse attack roll is typically 10 lower than your class DC."
    expect(stat!.value).toBe(deriveClassDc(ch).dc - 10);
    expect(stat!.kind).toBe('attack');
    expect(stat!.borrowed).toBe(false);
    expect(stat!.rank).toBe(ch.proficiencies.classDc);
    expect(stat!.ability).toBe('con');
  });

  it('a character with no kineticist class DC has no impulse attack roll at all', () => {
    // Not defensiveness: without the class DC the printed formula has no value, and inventing a rank
    // would be inventing the number.
    const ch = build('fighter', 7, {});
    expect(deriveSpecialStats(ch, db).some((s) => s.key === 'impulse-attack')).toBe(false);
  });

  it('an archetype kineticist gets the same statistic off the BORROWED class DC', () => {
    const ch = build('fighter', 6, { featPicks: { '2:class': 'kineticist-dedication' } });
    const sec = ch.secondaryClassDcs?.find((d) => d.classId === 'kineticist');
    expect(sec, 'Kineticist Dedication granted no borrowed class DC').toBeDefined();
    const stat = deriveSpecialStats(ch, db).find((s) => s.key === 'impulse-attack');
    expect(stat, 'the dedication grants impulse attack rolls in the same sentence').toBeDefined();
    expect(stat!.borrowed).toBe(true);
    expect(stat!.value).toBe(sec!.dc - 10);
  });

  it('Expert Kinetic Control raises it without carrying an entry of its own', () => {
    // "You become an expert in kineticist class DC and impulse attack rolls." The feat carries only
    // `classDcRank`; the impulse attack roll follows because it is defined against that DC. Two rank
    // tracks for one printed rule is exactly what this shape avoids.
    const plain = build('fighter', 12, { featPicks: { '2:class': 'kineticist-dedication' } });
    const better = build('fighter', 12, { featPicks: { '2:class': 'kineticist-dedication', '12:class': 'expert-kinetic-control' } });
    const a = deriveSpecialStats(plain, db).find((s) => s.key === 'impulse-attack')!;
    const b = deriveSpecialStats(better, db).find((s) => s.key === 'impulse-attack')!;
    expect(b.rank).toBe('expert');
    expect(b.value).toBe(a.value + 2); // expert is trained + 2
    expect(db.feats['expert-kinetic-control'].specialStatistic).toBeUndefined();
  });

  it('a gate attenuator raises the attack modifier and NOT the class DC', () => {
    const base = build('kineticist', 7, {});
    const worn: Character = { ...base, inventory: [...base.inventory, { itemId: 'gate-attenuator', qty: 1, invested: true }] };
    const before = deriveSpecialStats(base, db).find((s) => s.key === 'impulse-attack')!;
    const after = deriveSpecialStats(worn, db).find((s) => s.key === 'impulse-attack')!;
    expect(after.value).toBe(before.value + 1);
    expect(after.itemBonus).toBe(1);
    // "(but not to your impulse DC)" — the impulse DC is the kineticist class DC, which must not move.
    expect(deriveClassDc(worn).dc).toBe(deriveClassDc(base).dc);
  });

  it('the three attenuators carry the bonus their own text prints', () => {
    // Read from each record, not extrapolated: the major prints +2, the same as the greater.
    expect(db.items['gate-attenuator'].passiveEffects?.specialStatBonus).toEqual({ key: 'impulse-attack', value: 1 });
    expect(db.items['gate-attenuator-greater'].passiveEffects?.specialStatBonus).toEqual({ key: 'impulse-attack', value: 2 });
    expect(db.items['gate-attenuator-major'].passiveEffects?.specialStatBonus).toEqual({ key: 'impulse-attack', value: 2 });
  });

  it("Scroll Thaumaturgy names the scroll's DC, bound to the thaumaturge class DC", () => {
    const ch = build('thaumaturge', 5, { featPicks: { '1:class': 'scroll-thaumaturgy' } });
    const stat = deriveSpecialStats(ch, db).find((s) => s.key === 'scroll-dc');
    expect(stat, 'Scroll Thaumaturgy produced no row').toBeDefined();
    expect(stat!.kind).toBe('dc');
    expect(stat!.value).toBe(deriveClassDc(ch).dc);
  });

  it('one statistic granted by two records collapses to one row', () => {
    // A kineticist who also takes Kineticist Dedication is not a real build, but a future record
    // naming the same statistic must not print the same number twice.
    const ch = build('kineticist', 7, {});
    const stats = deriveSpecialStats(ch, db);
    expect(new Set(stats.map((s) => s.key)).size).toBe(stats.length);
  });

  it('the breakdown names the basis and the record it came from', () => {
    const ch = build('kineticist', 7, {});
    const b = explainStat(ch, db, { kind: 'specialStat', statKey: 'impulse-attack' });
    expect(b.title).toBe('Impulse attack roll');
    expect(b.subtitle).toContain('Kineticist class DC');
    expect(b.description).toContain('Impulses');
    // The row is rollable — it is an attack roll, not a passive number.
    expect(b.roll?.modifier).toBe(deriveSpecialStats(ch, db).find((s) => s.key === 'impulse-attack')!.value);
  });

  it('an unknown statistic key does not throw', () => {
    const ch = build('fighter', 3, {});
    expect(explainStat(ch, db, { kind: 'specialStat', statKey: 'no-such-stat' }).totalText).toBe('—');
  });
});

/**
 * The DATA half of the secondary class DC — which is NOT a special statistic but the class DC of a
 * class you do not have, and has had a lane since `classDcGrant` shipped. Nine dedications printed
 * "You become trained in <class> class DC" and carried nothing, so the borrowed DC never appeared.
 */
describe('archetype class DCs the dedications print', () => {
  const EXPECTED: [string, string][] = [
    ['barbarian-dedication', 'barbarian'],
    ['champion-dedication', 'champion'],
    ['guardian-dedication', 'guardian'],
    ['inventor-dedication', 'inventor'],
    ['investigator-dedication', 'investigator'],
    ['kineticist-dedication', 'kineticist'],
    ['monk-dedication', 'monk'],
    ['swashbuckler-dedication', 'swashbuckler'],
    ['thaumaturge-dedication', 'thaumaturge'],
  ];

  it('every dedication whose text grants a class DC carries the field', () => {
    for (const [id, classId] of EXPECTED) {
      expect(db.feats[id]?.classDcGrant, id).toEqual({ classId });
      expect(db.classes[classId], `${id} names a class that does not exist`).toBeDefined();
    }
  });

  it('and the borrowed DC actually reaches the character', () => {
    const ch = build('fighter', 8, { featPicks: { '2:class': 'thaumaturge-dedication' } });
    const dc = ch.secondaryClassDcs?.find((d) => d.classId === 'thaumaturge');
    expect(dc).toBeDefined();
    expect(dc!.rank).toBe('trained');
    expect(dc!.dc).toBe(10 + 8 + 2 + abilityMod(ch.abilities[dc!.keyAbility]));
  });

  it('Brilliant Crafter can raise the inventor DC it names', () => {
    // "at 15th level … you become an expert in your inventor class DC" — the upgrade carried no
    // `classDcRank`, and Inventor Dedication carried no grant, so the pair moved nothing at all.
    expect(db.feats['brilliant-crafter']?.classDcRank).toEqual({ classId: 'inventor', rank: 'expert' });
  });
});
