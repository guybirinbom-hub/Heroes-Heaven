import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses } from '../src/rules/derive';
import type { BuildState, Character } from '../src/rules/types';

const db = content();

/**
 * Two lanes found by RE-CHECKING batches 2-7 after the instruments were repaired. Both records sat in a
 * batch that had been declared clean, hidden behind a single lumped label ("no VAR mapping") that made
 * "nobody has taught this yet" indistinguishable from "adjudicated as uncomparable".
 */

describe('the DC of recovery checks', () => {
  /*
   * A dying character rolls a flat check at the start of their turn against DC 10 + their dying value.
   * Nine records change that DC and none of them had a field, so a character with Toughness rolled the
   * base DC. Six state a flat reduction; the other three restate the DC in a shape this cannot hold and
   * carry a `dataWarning` rather than an approximation.
   */
  it('Toughness reduces it, and reaches the character', () => {
    expect(db.feats.toughness.recoveryDcReduction).toBe(1);
    const ch = build('fighter', 1, { featPicks: { '1:general': 'toughness' } as BuildState['featPicks'] });
    expect(ch.recoveryDcReduction).toBe(1);
  });

  it('and it is CUMULATIVE, because the data says so', () => {
    // Eternal Hero: "you reduce the DC of recovery checks by 1 (this is cumulative with the reduction
    // from the Heroic Scion Dedication feat)".
    for (const id of ['heroic-scion-dedication', 'eternal-hero', 'timelessness']) {
      expect(db.feats[id].recoveryDcReduction, id).toBe(1);
    }
    const ch = build('fighter', 20, {
      featPicks: { '1:general': 'toughness', '3:general': 'timelessness' } as BuildState['featPicks'],
    });
    expect(ch.recoveryDcReduction).toBe(2);
  });

  it('a worn item counts, and only while worn', () => {
    expect(db.items['locket-of-love-left-behind'].passiveEffects?.recoveryDcReduction).toBe(1);
    const withIt = (worn: boolean): Character => {
      const ch = build('fighter', 11) as Character;
      return { ...ch, inventory: [{ instanceId: 'l1', itemId: 'locket-of-love-left-behind', quantity: 1, worn, invested: worn }] } as Character;
    };
    // The build reads the BUILD's inventory, so assert through a built character carrying it.
    const on = build('fighter', 11, {
      inventory: [{ instanceId: 'l1', itemId: 'locket-of-love-left-behind', quantity: 1, worn: true, invested: true }],
    } as Partial<BuildState>);
    expect(on.recoveryDcReduction).toBe(1);
    const off = build('fighter', 11, {
      inventory: [{ instanceId: 'l1', itemId: 'locket-of-love-left-behind', quantity: 1, worn: false, invested: false }],
    } as Partial<BuildState>);
    expect(off.recoveryDcReduction).toBeUndefined();
    void withIt;
  });

  it('a character with none of them carries no reduction at all', () => {
    expect(build('fighter', 1).recoveryDcReduction).toBeUndefined();
  });

  it('Defy Death needs no mechanism of its own — summation already says it', () => {
    /*
     * *"The DC of your recovery checks is equal to 9 + your dying value, or 8 + your dying value if you
     * have the Toughness general feat."* A plain −1: alone it gives 9 + dying, and Toughness's own −1
     * stacks to 8 + dying. It was given an "apply by hand" warning on the first pass, which was a
     * mis-reading — the printed text is exactly what summing produces.
     */
    expect(db.feats['defy-death'].recoveryDcReduction).toBe(1);
    expect(db.feats['defy-death'].dataWarning).toBeUndefined();
    const alone = build('fighter', 5, { featPicks: { '1:ancestry': 'defy-death' } as BuildState['featPicks'] });
    expect(alone.recoveryDcReduction).toBe(1);
    const both = build('fighter', 5, {
      featPicks: { '1:ancestry': 'defy-death', '1:general': 'toughness' } as BuildState['featPicks'],
    });
    expect(both.recoveryDcReduction, '9 + dying alone, 8 + dying with Toughness').toBe(2);
  });

  it('Mountain\'s Stoutness reduces it ONLY at Dying 1', () => {
    // "When you have the Dying 1 condition, the DC of your recovery checks is equal to 9 + your dying
    // value" — a gated reduction, not an unconditional one.
    expect(db.feats['mountains-stoutness'].recoveryDcReduction).toBe(1);
    expect(db.feats['mountains-stoutness'].recoveryDcOnlyAtDying).toBe(1);
    expect(db.feats['mountains-stoutness'].dataWarning).toBeUndefined();
    const ch = build('fighter', 9, { featPicks: { '1:ancestry': 'mountains-stoutness' } as BuildState['featPicks'] });
    expect(ch.recoveryDcReduction).toBe(1);
    expect(ch.recoveryDcOnlyAtDying).toBe(1);
  });

  it('Nine Lives Catfolk drops the dying value from the DC', () => {
    // "You don't add your dying value to the DC" — a different formula, so a flag rather than a number.
    expect(db.heritages['nine-lives-catfolk'].recoveryDcIgnoresDyingValue).toBe(true);
    expect(db.heritages['nine-lives-catfolk'].dataWarning).toBeUndefined();
    const ch = build('fighter', 1, { heritageId: 'nine-lives-catfolk' } as Partial<BuildState>);
    expect(ch.recoveryDcIgnoresDyingValue).toBe(true);
  });

  it('the gate is only carried when EVERY reduction is gated', () => {
    /*
     * A dwarf can take both Mountain's Stoutness and Toughness. Toughness's −1 applies at any dying
     * value, so carrying the Dying-1 gate would understate the DC reduction at Dying 2+.
     */
    const ch = build('fighter', 9, {
      featPicks: { '1:ancestry': 'mountains-stoutness', '1:general': 'toughness' } as BuildState['featPicks'],
    });
    expect(ch.recoveryDcReduction).toBe(2);
    expect(ch.recoveryDcOnlyAtDying).toBeUndefined();
  });
});

describe('"if you already have that sense, increase its range"', () => {
  /*
   * Both records shipped a FLAT sense, so the character the clause is written for — the one who already
   * has the sense — got nothing. `conditionalSenses` is the lane, already carrying the range-increase
   * form for You Don't Smell Right (scent 30 → 60).
   */
  it('Terra Dragonblood: tremorsense 30, +5 on whatever you already have', () => {
    expect(db.feats['terra-dragonblood'].senses).toBeUndefined();
    expect(db.feats['terra-dragonblood'].conditionalSenses).toEqual([{
      ifPresent: 'tremorsense',
      base: { name: 'tremorsense', range: 30, acuity: 'imprecise' },
      increaseRangeBy: 5,
    }]);
  });

  it('Vigilant Mask: precise scent 60, +60 on whatever you already have', () => {
    expect(db.feats['vigilant-mask'].conditionalSenses).toEqual([{
      ifPresent: 'scent',
      base: { name: 'scent', range: 60, acuity: 'precise' },
      increaseRangeBy: 60,
    }]);
  });

  it('the base reaches a character who does NOT already have it', () => {
    /* Senses are DERIVED, not a field on the built character — `deriveDefenses` is what reads
     * `conditionalSenses`. Asserting `Character.senses` reported nothing for the four records that
     * already used this lane too, which is how I know the assertion was wrong and not the data. */
    const ch = build('fighter', 1, { featPicks: { '1:ancestry': 'terra-dragonblood' } as BuildState['featPicks'] });
    const senses = deriveDefenses(ch, db).senses ?? [];
    expect(senses.map((s) => `${s.name}:${s.range ?? ''}`).join(' ')).toMatch(/tremorsense:30/);
  });

  it('…and the UPGRADE fires for a character who ALREADY has it', () => {
    /*
     * The whole point of the clause, so it needs a real second source rather than a range that could be
     * either: Tunneling Claws (Rock Rider archetype) grants tremorsense 60 outright. With it, Terra
     * Dragonblood must contribute the UPGRADED entry — the 35-foot one — not its 30-foot base.
     */
    expect(db.feats['tunneling-claws'].senses).toEqual([{ name: 'tremorsense', range: 60, acuity: 'imprecise' }]);
    const ch = build('fighter', 6, {
      featPicks: { '1:ancestry': 'terra-dragonblood', '2:class': 'tunneling-claws' } as BuildState['featPicks'],
    });
    const ranges = (deriveDefenses(ch, db).senses ?? []).filter((s) => s.name === 'tremorsense').map((s) => s.range);
    expect(ranges, 'tremorsense 60 from another source must become 65, not a fixed 35').toContain(65);
    expect(ranges).not.toContain(35);
  });
});
