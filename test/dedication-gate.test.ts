import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { dedicationBlock } from '../src/rules/build';

/**
 * Ruling Q25 — the archetype dedication rule, per record.
 *
 * The rule is general (Player Core, *Archetypes*: *"once you select a dedication feat for an
 * archetype, you must satisfy its requirements before you can gain another dedication feat.
 * Typically, you satisfy an archetype dedication feat by gaining a certain number of feats from the
 * archetype's list."*) — but WHAT satisfies it is the dedication's own business, and 13 records still
 * print a clause that differs from the typical two-feats-from-your-own-archetype.
 *
 * Every one of those differences was a wrongly BLOCKED legal pick before this: Juggler asked for two
 * feats where it prints one, Halcyon Speaker and Beast Gunner were refused despite being named as
 * exceptions, and a sibling archetype's feats counted for nothing.
 */
const db = content();
const block = (taken: string[], candidate: string) => dedicationBlock(taken, db.feats[candidate], db);

describe('ONLY a dedication that prints the clause gates (owner ruling Q28)', () => {
  it('nothing started => any dedication is takeable', () => {
    expect(block([], 'fighter-dedication')).toBeNull();
  });

  // ⚠ This asserted the OPPOSITE until 2026-08-11. The app shipped a general two-feat gate, and Player
  // Core's Archetypes chapter does state the rule generally — which is why only 13 records still print
  // it, the Remaster having lifted the boilerplate out of the feats. The owner ruled that the printed
  // clause is the whole rule here: 'not every dedication keeps the general two-feat gate, only feats
  // that say it.' A test asserting the old default would now vouch for behaviour they rejected.
  it('a dedication with NO printed clause does not gate a second one', () => {
    expect(block(['fighter-dedication'], 'wizard-dedication')).toBeNull();
    expect(block(['fighter-dedication', 'wizard-dedication'], 'rogue-dedication')).toBeNull();
  });

  it('a dedication that DOES print the clause still gates', () => {
    expect(block(['juggler-dedication'], 'fighter-dedication')).toMatch(/more feat/i);
  });

  it('the reason NAMES the archetype rather than a generic phrase', () => {
    expect(block(['juggler-dedication'], 'fighter-dedication')).toMatch(/Juggler/i);
  });

  it('a non-dedication feat is never gated', () => {
    expect(block(['fighter-dedication'], 'basic-maneuver')).toBeNull();
  });
});

describe('a record whose clause differs from the default (Q25)', () => {
  it('Juggler asks for ONE other feat, as it prints', () => {
    expect(db.feats['juggler-dedication'].dedicationGate).toEqual({ archetypes: ['juggler'], count: 1 });
    expect(block(['juggler-dedication'], 'fighter-dedication')).toMatch(/1 more feat\b/i);
    expect(block(['juggler-dedication', 'focused-juggler'], 'fighter-dedication')).toBeNull();
  });

  it('Magaambyan Attendant exempts Halcyon Speaker Dedication by name', () => {
    // …and blocks everything else, so the exception is an exception and not an open door.
    expect(block(['magaambyan-attendant-dedication'], 'halcyon-speaker-dedication')).toBeNull();
    expect(block(['magaambyan-attendant-dedication'], 'fighter-dedication')).toMatch(/2 more feats/i);
  });

  it('…and counts halcyon speaker feats toward its own requirement', () => {
    const taken = ['magaambyan-attendant-dedication', 'halcyon-speaker-dedication', 'dualistic-synergy', 'persistent-creation'];
    expect(block(taken, 'fighter-dedication')).toBeNull();
  });

  it('Spellshot exempts Beast Gunner Dedication and counts beast gunner feats', () => {
    expect(block(['spellshot-dedication'], 'beast-gunner-dedication')).toBeNull();
    expect(block(['spellshot-dedication'], 'fighter-dedication')).toMatch(/2 more feats/i);
    expect(block(['spellshot-dedication', 'drain-vitality', 'controlled-bullet'], 'fighter-dedication')).toBeNull();
  });

  it('Familiar Sage counts familiar master feats — a sibling archetype, not its own', () => {
    expect(db.feats['familiar-sage-dedication'].dedicationGate!.archetypes).toContain('familiar-master');
    expect(block(['familiar-sage-dedication', 'enhanced-familiar', 'familiar-mascot'], 'fighter-dedication')).toBeNull();
  });

  it('the two legacy Knight Vigilant records gate at all', () => {
    // Neither carries an `archetype` field, so the default — which reads `archetype` to know what to
    // count — passed them straight through: a character holding one could take a second dedication
    // immediately, which is the opposite of what the record prints.
    expect(block(['knight-vigilant'], 'fighter-dedication')).toMatch(/Knight Vigilant/i);
    expect(block(['aon-knight-vigilant'], 'fighter-dedication')).toMatch(/Knight Vigilant/i);
  });
});

describe('the clause is NOT general — the other dedications keep the default', () => {
  it('only a small minority of dedications carry a gate of their own', () => {
    const deds = Object.values(db.feats).filter((f) => f.traits.includes('dedication'));
    const gated = deds.filter((f) => f.dedicationGate);
    expect(gated.length).toBe(14);
    // The ruling's whole point: authoring one archetype's exception onto all of them would hand out
    // dedications the rules withhold.
    expect(deds.length - gated.length).toBeGreaterThan(200);
  });

  it('no gate names an archetype whose requirement cannot be met', () => {
    for (const f of Object.values(db.feats)) {
      const gate = f.dedicationGate;
      if (!gate) continue;
      const available = Object.values(db.feats).filter(
        (x) => gate.archetypes.includes(x.archetype ?? '') && !x.traits.includes('dedication'),
      ).length;
      expect(available, `${f.id} would be a permanent lock`).toBeGreaterThanOrEqual(gate.count);
    }
  });
});
