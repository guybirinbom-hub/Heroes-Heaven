import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { abilityMod, deriveClassDc, deriveSpecialStats, deriveSpellcasting } from '../src/rules/derive';
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
    /*
     * *"At 7th level you become a master in Crafting, and AT 15TH LEVEL, you become legendary in
     * Crafting and you become an expert in your inventor class DC."* The upgrade carried no
     * `classDcRank`, and Inventor Dedication carried no grant, so the pair moved nothing at all.
     *
     * `level: 15` is part of that clause, not decoration: without it the expert DC landed the moment
     * the feat was taken — which can be 7th level, eight levels early. Asserted so the gate cannot
     * quietly go missing again.
     */
    expect(db.feats['brilliant-crafter']?.classDcRank).toEqual({ classId: 'inventor', rank: 'expert', level: 15 });
  });
});

/**
 * A statistic defined as the HIGHER OF TWO existing ones.
 *
 * Two records print this shape and neither could join the lane while `basis` was `{ classDc }` alone:
 *
 *   • Chronoskimmer Dedication — *"The DC for these abilities is either your class DC or spell DC,
 *     whichever is higher, and is called your chronoskimmer DC."* Two more feats in the archetype roll
 *     against it by name (Guide the Timeline, Steal Time), and it is printed on no row: the sheet has
 *     a class DC and a spell DC, and the maximum of the two is a third number.
 *   • Every deviant classification — Dark Archive's *Deviation Saves and Attack Rolls*: *"The DC for
 *     any saving throw called for by a deviation is the higher of your class DC or spell DC. The
 *     attack modifier of a deviation is 10 lower than that DC."* Our own text names the statistic
 *     outright in the flicker classification's moderate backlash — *"You can attempt to Escape against
 *     your deviation DC"* — and four deviant feats say only "Make an attack roll" with no modifier
 *     anywhere for the player to read.
 *
 * ⚠ The value has to be chosen by COMPARING THE NUMBERS, not the ranks: "whichever is higher" is what
 * the rule says, and an expert spell DC on a +5 attribute beats a master class DC on a +3 one.
 */
describe('a statistic defined as the higher of your class DC and your spell DC', () => {
  it('a Chronoskimmer with no spellcasting at all falls to the class DC', () => {
    const ch = build('fighter', 8, { featPicks: { '2:class': 'chronoskimmer-dedication' } });
    const stat = deriveSpecialStats(ch, db).find((s) => s.key === 'chronoskimmer-dc');
    expect(stat, 'Chronoskimmer Dedication produced no row').toBeDefined();
    expect(stat!.kind).toBe('dc');
    expect(stat!.value).toBe(deriveClassDc(ch).dc);
    expect(stat!.basisLabel).toContain('class DC');
  });

  it('a caster whose spell DC is higher gets the spell DC, and the row says so', () => {
    const ch = build('wizard', 8, { featPicks: { '2:class': 'chronoskimmer-dedication' } });
    const casting = ch.spellcasting.find((e) => e.type === 'prepared')!;
    const spellDc = deriveSpellcasting(ch, casting).dc;
    const classDc = deriveClassDc(ch).dc;
    // Premise: a wizard is expert in spellcasting at 8 and only trained in their class DC.
    expect(spellDc).toBeGreaterThan(classDc);
    const stat = deriveSpecialStats(ch, db).find((s) => s.key === 'chronoskimmer-dc')!;
    expect(stat.value).toBe(spellDc);
    expect(stat.basisLabel).toBe('Arcane spell DC');
    expect(stat.rank).toBe(casting.proficiency);
  });

  it('the breakdown prints the printed rule, not just the winning track', () => {
    const ch = build('wizard', 8, { featPicks: { '2:class': 'chronoskimmer-dedication' } });
    const b = explainStat(ch, db, { kind: 'specialStat', statKey: 'chronoskimmer-dc' });
    expect(b.title).toBe('Chronoskimmer DC');
    // Without this the number looks pinned to the spell DC, and the player would not know it moves to
    // the class DC the moment that one overtakes it.
    expect(b.description).toContain('whichever is higher');
    expect(b.description).toContain('Chronoskimmer Dedication');
  });

  it('a deviant feat gives the deviation DC and its attack modifier, 10 apart', () => {
    // Blasting Beams says only "Make an attack roll against a creature within 30 feet" — the modifier
    // is printed nowhere on this feat, on its classification, or on any row the sheet had.
    const ch = build('fighter', 8, { featPicks: { '2:class': 'blasting-beams' } });
    const stats = deriveSpecialStats(ch, db);
    const dc = stats.find((s) => s.key === 'deviation-dc');
    const atk = stats.find((s) => s.key === 'deviation-attack');
    expect(dc, 'the deviation DC produced no row').toBeDefined();
    expect(atk, 'the deviation attack modifier produced no row').toBeDefined();
    expect(dc!.value).toBe(deriveClassDc(ch).dc);
    expect(atk!.value).toBe(dc!.value - 10);
    expect(atk!.kind).toBe('attack');
  });

  it('every deviant classification carries it, and they collapse to one pair of rows', () => {
    const CLASSIFICATIONS = [
      'blight-soul-deviant-classification',
      'dragon-deviant-classification',
      'flicker-deviant-classification',
      'leech-deviant-classification',
      'troll-deviant-classification',
      'verdant-core-deviant-classification',
      'wraith-deviant-classification',
    ];
    for (const id of CLASSIFICATIONS) {
      const raw = db.classFeatures[id]?.specialStatistic;
      expect(Array.isArray(raw) ? raw.length : 0, `${id} carries no deviation statistic`).toBe(2);
    }
    // Two deviant feats from DIFFERENT classifications must not print the statistic twice.
    const ch = build('fighter', 8, { featPicks: { '2:class': 'blasting-beams', '4:class': 'sonic-dash' } });
    const stats = deriveSpecialStats(ch, db);
    expect(stats.filter((s) => s.key === 'deviation-dc').length).toBe(1);
    expect(new Set(stats.map((s) => s.key)).size).toBe(stats.length);
  });

  it('a character with no deviant ability has neither row', () => {
    const ch = build('fighter', 8, {});
    expect(deriveSpecialStats(ch, db).some((s) => s.key.startsWith('deviation-'))).toBe(false);
  });

  /*
   * THE SHAPE: an authored statistic on a record NOTHING CAN OWN is invisible, and reads as authored
   * on every field-checking measurement.
   *
   * Two of the seven classifications were exactly that for a day. `specialStatistic` was correct on
   * all seven; only 20 of the 30 deviant feats carried `grantsClassFeatures`, and the eight
   * Pathfinder #202 feats (Verdant Core, Blight Soul) carried none — so `ownedFeatureIds`, whose only
   * route to a classification is that field, could never reach them. A Verdant Core deviant holding
   * Vine Lash ("Make a melee attack roll against a creature within 30 feet") had no modifier printed
   * anywhere on the sheet.
   *
   * The test above did not catch it and could not: it asserts the FIELD is present, and builds its
   * runtime half from two Dark Archive feats that both happen to grant. The instrument has to be a
   * character built from a feat of EACH classification and the rows observed on it.
   */
  it('every classification is reachable — one of ITS OWN feats produces both rows', () => {
    const classifications = Object.keys(db.classFeatures).filter((id) => id.endsWith('-deviant-classification'));
    expect(classifications.length).toBe(7);
    for (const id of classifications) {
      // The lowest-level feat that grants this classification, taken from the data rather than named
      // here, so a renamed feat fails as "unreachable" instead of silently testing nothing.
      const granting = Object.values(db.feats)
        .filter((f) => (f.grantsClassFeatures ?? []).includes(id))
        .sort((a, b) => (a.level ?? 99) - (b.level ?? 99));
      expect(granting.length, `no feat grants ${id}; its statistics are authored and unreachable`).toBeGreaterThan(0);

      const ch = build('fighter', 12, { featPicks: { '2:class': granting[0].id } });
      const keys = deriveSpecialStats(ch, db).map((s) => s.key);
      expect(keys, `${id} via ${granting[0].id}`).toContain('deviation-dc');
      expect(keys, `${id} via ${granting[0].id}`).toContain('deviation-attack');
    }
  });

  it('the reachability is not an accident of one book — all 30 deviant feats are accounted for', () => {
    // 28 classification feats (4 each) grant; the two universal ones (Awakened Power, Greater
    // Awakened Power) legitimately grant none, because they modify a deviation you already have.
    const deviant = Object.values(db.feats).filter((f) => f.traits.includes('deviant'));
    expect(deviant.length).toBe(30);
    const ungranting = deviant.filter((f) => !(f.grantsClassFeatures ?? []).some((g) => g.endsWith('-deviant-classification')));
    expect(ungranting.map((f) => f.id).sort()).toEqual(['awakened-power', 'greater-awakened-power']);
  });
});
