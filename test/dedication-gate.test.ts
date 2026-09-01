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
    /* Enhanced Familiar is a CLASS feat for seven classes that the Familiar Master archetype also
     * lists, so the SLOT it was taken in decides whether it counts — see `countsForArchetype`. Spelled
     * out here because a bare id cannot say, and a bare id is what this used to pass. */
    const inArchetypeSlots = [
      { id: 'familiar-sage-dedication', category: 'archetype' },
      { id: 'enhanced-familiar', category: 'archetype' },
      { id: 'familiar-mascot', category: 'archetype' },
    ];
    expect(dedicationBlock(inArchetypeSlots, db.feats['fighter-dedication'], db)).toBeNull();
    /* …and the same two feats taken as ordinary CLASS feats do not open the gate: a witch who happens
     * to hold Enhanced Familiar has not taken a step into the Familiar Master archetype. */
    const inClassSlots = inArchetypeSlots.map((t) =>
      t.id === 'familiar-sage-dedication' ? t : { ...t, category: 'class' },
    );
    expect(dedicationBlock(inClassSlots, db.feats['fighter-dedication'], db)).not.toBeNull();
  });

  it('Familiar Sage exempts Familiar Master Dedication, which its SECOND sentence names', () => {
    // The clause runs to two sentences and the gate had been read from the last one only: "…AND YOU
    // CAN TAKE FAMILIAR MASTER DEDICATION even if you haven't yet gained three feats from the familiar
    // sage archetype. You can't select another dedication feat until you've gained two other feats
    // from the familiar master or familiar sage archetypes." Archetypes and count were right; the one
    // pick the clause explicitly allows was refused, `gate.except` being the only escape
    // `dedicationBlock` has.
    expect(block(['familiar-sage-dedication'], 'familiar-master-dedication')).toBeNull();
    expect(block(['familiar-sage-dedication'], 'fighter-dedication')).toMatch(/2 more feats/i);
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
    // 16 since Stone Brawler and Living Monolith were authored — both PRINT the Special clause
    // ("you cannot select another dedication feat until you have gained two other feats from the …
    // archetype") and carried no gate. 17 since Stonebound, whose own description had DROPPED that
    // Special sentence entirely — which is exactly why its missing gate went unnoticed. Pinned rather
    // than bounded, so a gate added to a record that does NOT print the clause still has to come past
    // this line.
    expect(gated.length).toBe(17);
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

  /*
   * THE SHAPE, checked over every gate rather than the three we know about.
   *
   * These clauses are transcribed by hand from a record's own prose, and the failure mode is reading
   * one sentence of a two-sentence clause: Familiar Sage's exception lived in the sentence BEFORE the
   * one the count came from, so the gate blocked the single pick its text names as allowed. A gate is
   * silently over-strict — nothing crashes, the picker simply hides a legal option — so only a check
   * that reads the printed text back finds it.
   *
   * Two printed shapes name a permitted dedication: "other than X Dedication" and "you can take X
   * Dedication even if…". A record naming ITSELF is not an exception to its own gate (Scion of Domora
   * waives Familiar Master's requirement, not its own), so self-references are skipped.
   */
  it('every gate excepts each dedication its own text names as still takeable', () => {
    const dedicationsByName = new Map<string, string[]>();
    for (const f of Object.values(db.feats)) {
      if (f.traits.includes('dedication')) dedicationsByName.set(f.name, [...(dedicationsByName.get(f.name) ?? []), f.id]);
    }
    let clausesFound = 0;
    for (const f of Object.values(db.feats)) {
      if (!f.dedicationGate) continue;
      const text = String(f.description ?? '').replace(/\s+/g, ' ').replace(/’/g, "'");
      const named = new Set<string>();
      for (const m of text.matchAll(/other than ([A-Z][\w'-]*(?: [A-Z][\w'-]*)*? Dedication)/g)) named.add(m[1]);
      for (const m of text.matchAll(/you can take ([A-Z][\w'-]*(?: [A-Z][\w'-]*)*? Dedication) even if/gi)) named.add(m[1]);
      for (const name of named) {
        if (name === f.name) continue;
        const ids = dedicationsByName.get(name);
        expect(ids, `${f.id} names "${name}", which is no dedication in the data`).toBeTruthy();
        clausesFound++;
        for (const id of ids!) {
          expect(f.dedicationGate.except ?? [], `${f.id}'s text permits ${id} and its gate does not`).toContain(id);
        }
      }
    }
    // The check is only worth its runtime if the corpus still contains such clauses at all.
    expect(clausesFound).toBe(3);
  });
});
