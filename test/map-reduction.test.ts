import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { mapStepFor, mapNotesFor, deriveStrikes } from '../src/rules/derive';
import { explainStat, statHasSituational } from '../src/rules/explain';
import type { Character } from '../src/rules/types';

/**
 * "Your multiple attack penalty with agile weapons becomes –3 and –6, rather than –4 and –8."
 *
 * Both strike builders computed the step as a literal `traits.includes('agile') ? 4 : 5`, so Agile
 * Grace and the ranger's Flurry printed a number the sheet never showed — and the sheet DOES show
 * MAP, so it was visibly wrong rather than merely missing.
 *
 * Flurry applies only against your hunted prey. Applying it unconditionally would be an over-grant
 * on every other target, so it is gated on the Hunt Prey toggle the sheet already tracks.
 */
const db = content();

describe('multiple attack penalty reductions', () => {
  it('the default is 5, or 4 with agile', () => {
    const ch = build('fighter', 5, {});
    expect(mapStepFor(ch, db, ['unarmed'])).toBe(5);
    expect(mapStepFor(ch, db, ['unarmed', 'agile'])).toBe(4);
  });

  it('Agile Grace lowers the agile step to 3 and leaves non-agile alone', () => {
    const ch = build('swashbuckler', 16, { featPicks: { '16:class': 'agile-grace' } });
    expect(mapStepFor(ch, db, ['agile'])).toBe(3);
    expect(mapStepFor(ch, db, [])).toBe(5);
  });

  it('it reaches the actual Strike line, not just the helper', () => {
    const ch = build('swashbuckler', 16, { featPicks: { '16:class': 'agile-grace' } });
    // The bare Fist is agile, so its second attack should sit 3 below the first.
    const fist = deriveStrikes(ch, db).find((s) => s.name === 'Fist')!;
    expect(fist.attack[0] - fist.attack[1]).toBe(3);
    expect(fist.attack[0] - fist.attack[2]).toBe(6);
    expect(fist.mapStep).toBe(3);
  });

  it("Flurry only applies while Hunt Prey is on", () => {
    const ranger = build('ranger', 5, { subclassId: 'flurry' });
    const hunting: Character = { ...ranger, classResources: { ...(ranger.classResources ?? {}), 'hunt-prey': 1 } };
    const idle: Character = { ...ranger, classResources: { ...(ranger.classResources ?? {}), 'hunt-prey': 0 } };

    // Only meaningful if this ranger actually owns Flurry; otherwise the premise is wrong.
    const owns = db.classFeatures['flurry']?.mapReduction != null;
    expect(owns).toBe(true);

    expect(mapStepFor(idle, db, [])).toBe(5);
    expect(mapStepFor(idle, db, ['agile'])).toBe(4);
    expect(mapStepFor(hunting, db, [])).toBe(3);
    expect(mapStepFor(hunting, db, ['agile'])).toBe(2);
  });

  it('a reduction never RAISES the penalty', () => {
    const ranger = build('ranger', 5, { subclassId: 'flurry' });
    const hunting: Character = { ...ranger, classResources: { 'hunt-prey': 1 } };
    // Whatever the data says, the result can only be at or below the baseline.
    expect(mapStepFor(hunting, db, [])).toBeLessThanOrEqual(5);
    expect(mapStepFor(hunting, db, ['agile'])).toBeLessThanOrEqual(4);
  });

  it('the data carries both, with Flurry gated', () => {
    expect(db.feats['agile-grace'].mapReduction).toMatchObject({ agileStep: 3 });
    expect(db.feats['agile-grace'].mapReduction?.step).toBeUndefined(); // agile only, as printed
    expect(db.classFeatures['flurry'].mapReduction).toMatchObject({ step: 3, agileStep: 2, whileState: 'hunt-prey' });
  });
});

/**
 * A reduction the app must NOT apply.
 *
 * "Your finishers' Strikes have a lower multiple attack penalty: −4 (or −3 with an agile weapon) …
 * instead of −5 and −10." Whether a Strike is part of a finisher is a fact about the ACTION, decided
 * at the table — no toggle on the sheet can answer it. `whileState: 'panache'` was the tempting shape
 * and is wrong: having panache is what lets you make a finisher, not proof this Strike is one, so it
 * would hand the player −4/−8 on every ordinary Strike while flush.
 */
describe('a MAP reduction the sheet cannot evaluate', () => {
  const swash = () => build('swashbuckler', 12, { featPicks: { '12:class': 'combination-finisher' } });

  it('Combination Finisher is authored as conditional, not as a number', () => {
    expect(db.feats['combination-finisher'].mapReduction).toMatchObject({ step: 4, agileStep: 3, appliesWhen: 'part of a finisher' });
  });

  it('it moves no strike number', () => {
    const ch = swash();
    expect(mapStepFor(ch, db, [])).toBe(5);
    expect(mapStepFor(ch, db, ['agile'])).toBe(4);
    const fist = deriveStrikes(ch, db).find((s) => s.name === 'Fist')!;
    expect(fist.attack[0] - fist.attack[1]).toBe(4); // the Fist is agile: the ordinary agile step
  });

  it('but it is not silent — it becomes a star with its condition printed', () => {
    const ch = swash();
    const fist = deriveStrikes(ch, db).find((s) => s.name === 'Fist')!;
    const note = fist.mapSources?.find((m) => m.sourceId === 'combination-finisher');
    expect(note, 'the reduction reached no surface at all').toBeDefined();
    expect(note!.applied).toBe(false);
    expect(note!.steps).toEqual([3, 6]); // the agile pair, for an agile Strike
    // The `*` and its note come from the mapReduction field itself, not from a hand-written copy in
    // situationalBonuses.ts — one rule, one registry.
    expect(statHasSituational(ch, { kind: 'strikeAttack', instanceId: fist.instanceId }, db)).toBe(true);
    const b = explainStat(ch, db, { kind: 'strikeAttack', instanceId: fist.instanceId });
    const line = b.situational?.find((s) => s.sourceId === 'combination-finisher');
    expect(line, 'no star line for the conditional reduction').toBeDefined();
    expect(line!.text).toContain('part of a finisher');
    expect(line!.text).toContain('-4/-8');
    expect(line!.text).toContain('-3/-6 with an agile weapon');
    // …and the description does NOT repeat it. Two surfaces saying the same numbers is how they drift.
    expect(b.description).not.toContain('Combination Finisher');
  });
});

/**
 * The compounding question: agile already lowers the step to 4, and Flurry REPLACES the progression.
 * `mapStepFor` starts from the default and takes the LOWEST printed candidate for that agile-ness —
 * it never subtracts — so a record's own pair replaces the default rather than stacking on it.
 */
describe('reductions replace the progression, they never compound', () => {
  it('Flurry states its own agile pair rather than discounting the agile step again', () => {
    const ranger = build('ranger', 5, { subclassId: 'flurry' });
    const hunting: Character = { ...ranger, classResources: { ...(ranger.classResources ?? {}), 'hunt-prey': 1 } };
    // Printed: "–3 (–2 with an agile attack)". Not 4 − 1, and emphatically not 4 − 3.
    expect(mapStepFor(hunting, db, [])).toBe(3);
    expect(mapStepFor(hunting, db, ['agile'])).toBe(2);
  });

  it('two reductions at once take the better printed pair, not the sum', () => {
    const ranger = build('ranger', 17, { subclassId: 'flurry' });
    const hunting: Character = { ...ranger, classResources: { ...(ranger.classResources ?? {}), 'hunt-prey': 1 } };
    // A 17th-level Flurry ranger owns Flurry (3/2) AND Masterful Hunter (Flurry) (2/1). Summing the
    // two would give a nonsense 5/3 discount; the answer is simply the better pair.
    expect(mapStepFor(hunting, db, [])).toBe(2);
    expect(mapStepFor(hunting, db, ['agile'])).toBe(1);
  });

  it('a source that says nothing about THIS strike explains nothing about it', () => {
    // Agile Grace prints only an agile step. Listing it under a greatsword would claim a reduction
    // the feat never grants.
    const ch = build('swashbuckler', 16, { featPicks: { '16:class': 'agile-grace' } });
    expect(mapNotesFor(ch, db, ['agile']).some((m) => m.sourceId === 'agile-grace' && m.applied)).toBe(true);
    expect(mapNotesFor(ch, db, []).length).toBe(0);
  });

  it('the breakdown says where an APPLIED progression came from', () => {
    // The strike row shows three numbers derived from the step; without this the player saw -3/-6
    // with nothing anywhere naming what changed it.
    const ranger = build('ranger', 5, { subclassId: 'flurry' });
    const hunting: Character = { ...ranger, classResources: { ...(ranger.classResources ?? {}), 'hunt-prey': 1 } };
    const fist = deriveStrikes(hunting, db).find((s) => s.name === 'Fist')!;
    const b = explainStat(hunting, db, { kind: 'strikeAttack', instanceId: fist.instanceId });
    expect(b.description).toContain('-2 on a second attack'); // agile Fist under Flurry
    expect(b.description).toContain('comes from Flurry (hunted prey)');
  });

  it('an ordinary character gets no provenance line at all', () => {
    const ch = build('fighter', 5, {});
    expect(mapNotesFor(ch, db, [])).toEqual([]);
    const b = explainStat(ch, db, { kind: 'strikeAttack', instanceId: deriveStrikes(ch, db)[0].instanceId });
    expect(b.description).not.toContain('comes from');
  });
});

/**
 * The changed progression has to reach EVERY strike source, not just the weapon table. Two of the
 * four computed the step from a literal, so a battle-formed or blasting character silently reverted
 * to −5/−10 — the one case where the sheet showed a number the character does not have.
 */
describe('every strike source honours the progression', () => {
  it("a battle form keeps the character's own MAP", () => {
    const ranger = build('ranger', 5, { subclassId: 'flurry' });
    const hunting: Character = {
      ...ranger,
      classResources: { ...(ranger.classResources ?? {}), 'hunt-prey': 1 },
      activeModes: [
        {
          id: 'test-form',
          name: 'Test form',
          modifiers: [],
          battleForm: { strikes: [{ name: 'Jaws', damage: '2d8 piercing', traits: [] }], attackMod: 16 },
        },
      ],
    } as Character;
    const jaws = deriveStrikes(hunting, db).find((s) => s.name === 'Jaws');
    expect(jaws, 'the battle form produced no strike').toBeDefined();
    expect(jaws!.mapStep).toBe(3);
    expect(jaws!.attack).toEqual([16, 13, 10]);
  });

  it('an Elemental Blast is an attack roll like any other', () => {
    // The element is a class extraChoice, not a subclass — with none picked there is no blast at all.
    const kin = build('kineticist', 5, { extraChoices: { element: ['fire-gate'] } });
    const blasts = deriveStrikes(kin, db).filter((s) => s.instanceId.startsWith('blast:'));
    // Only meaningful if this build actually has a blast; otherwise the premise is wrong.
    expect(blasts.length).toBeGreaterThan(0);
    for (const b of blasts) {
      expect(b.mapStep).toBe(5);
      expect(b.attack[0] - b.attack[1]).toBe(5);
      expect(b.attack[0] - b.attack[2]).toBe(10);
    }
  });
});
