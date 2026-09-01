import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { FEAT_SITUATIONAL, featSituationalFor } from '../src/rules/situationalBonuses';
import { statHasSituational } from '../src/rules/explain';
import { deriveDefenses } from '../src/rules/derive';
import { findDuplicateIds, findUmbrellaIds } from '../src/data';

/**
 * The last two lanes the mechanics triage listed as unmodelled: 131 situational and 58 defence.
 *
 * The defence half turned out to be almost entirely already built — the triage matches records by
 * their TEXT and does not look at `passiveEffects`, so 57 of the 58 were flagged for a resistance
 * they already had. One was real.
 *
 * The situational half needed 84 new entries, and the failure mode worth a permanent guard is not a
 * wrong bonus: it is a CORRECT bonus filed on a record no character can own. An adversarial pass
 * refuted 24 entries and 20 of them were exactly that — an unpriced umbrella head, or an `aon-`
 * scrape colliding with a canonical twin. Both are hidden from every picker, so the star can never
 * appear and the entry looks done while doing nothing.
 */
const c = () => content();

describe('every situational entry names a record a character can actually own', () => {
  it('none is filed on an umbrella head or an aon- duplicate', () => {
    const db = c();
    const hidden = new Set([...findUmbrellaIds(db), ...findDuplicateIds(db)]);
    const offenders = Object.keys(FEAT_SITUATIONAL).filter((id) => hidden.has(id));
    // A star on a hidden record renders for nobody: the id never enters characterSituationalIds
    // because the item can never be in an inventory.
    expect(offenders).toEqual([]);
  });

  it('every key resolves to a real record, or is a trait:/junction: entry', () => {
    const db = c();
        // Every collection a situational key may name — companion records and specializations included,
    // because a companion's own bonuses are keyed the same way.
    const buckets = [db.feats, db.classFeatures, db.items, db.heritages, db.ancestries, db.backgrounds, db.deities, db.spells, db.actions, db.animalCompanions, db.companionSpecializations, db.specificFamiliars, db.stances, db.siegeWeapons];
    const unknown = Object.keys(FEAT_SITUATIONAL).filter(
      (id) => !id.startsWith('trait:')
        // A `junction:` key resolves through the GATE record it names. The kineticist impulse junction
        // belongs to an element gate but is granted only by a SINGLE gate, so keying it on the gate
        // record itself handed every dual-gate kineticist a bonus the printed text withholds.
        && !(id.startsWith('junction:') && buckets.some((b) => b?.[id.slice('junction:'.length)]))
        && !buckets.some((b) => b?.[id]),
    );
    expect(unknown).toEqual([]);
  });
});

describe('the entries authored for the triage lane reach a sheet', () => {
  it('an item entry stars the stat once the item is worn, and not before', () => {
    // Skeptic's Elixir (lesser) — "+1 item bonus to Perception … to notice falsehoods … and to Will
    // saves". Filed per grade, because the family head is unpriced and unownable.
    const id = 'skeptics-elixir-lesser';
    expect(c().items[id], id).toBeTruthy();
    const rows = FEAT_SITUATIONAL[id] ?? c().items[id].situational ?? [];
    expect(rows.length, 'an entry exists for the priced record').toBeGreaterThan(0);

    const without = build('fighter', 5, {});
    const withIt = build('fighter', 5, {
      inventory: [{ instanceId: 'e1', itemId: id, quantity: 1, invested: true, worn: true }],
    });
    expect(statHasSituational(without, { kind: 'perception' }, c())).toBe(false);
    expect(statHasSituational(withIt, { kind: 'perception' }, c())).toBe(true);
    const lines = featSituationalFor([id], { kind: 'perception' });
    expect(lines.some((l) => /falsehood/i.test(l.when))).toBe(true);
  });

  it('a feat entry stars the stat for a character who took the feat', () => {
    const id = 'battleforger';
    expect(FEAT_SITUATIONAL[id], id).toBeTruthy();
    const ch = build('fighter', 4, { featPicks: { '2:skill:0': id } });
    const took = ch.feats.some((f) => f.featId === id);
    expect(took, 'the feat is on the character').toBe(true);
    const target = FEAT_SITUATIONAL[id][0].targets[0];
    const ref = target.kind === 'skill' ? { kind: 'skill' as const, skill: target.detail! } : { kind: target.kind as 'ac' };
    expect(statHasSituational(ch, ref as never, c())).toBe(true);
  });
});

describe('Pickled Demon Tongue — the one defence the triage was right about', () => {
  // "Armor: You gain resistance 2 to acid AND attacks by demons." Only the acid half was modelled.
  it.each([
    ['pickled-demon-tongue', 2],
    ['greater-pickled-demon-tongue', 5],
    ['major-pickled-demon-tongue', 10],
  ])('%s carries both halves at %i', (id, value) => {
    const res = c().items[id as string].passiveEffects?.resistances ?? [];
    expect(res).toEqual([
      { type: 'acid', value },
      { type: 'attacks by demons', value },
    ]);
  });

  it('reaches the character’s resistances when the spellheart is worn', () => {
    const ch = build('fighter', 8, {
      inventory: [{ instanceId: 'p1', itemId: 'greater-pickled-demon-tongue', quantity: 1, invested: true, worn: true }],
    });
    const iwr = deriveDefenses(ch, c());
    expect(iwr.resistances.some((r) => r.type === 'acid' && r.value === 5)).toBe(true);
    expect(iwr.resistances.some((r) => r.type === 'attacks by demons' && r.value === 5)).toBe(true);
  });

  it('keeps the 2/5/10 ladder every other spellheart uses', () => {
    // AoN prints "resistance 2" on all three grades — an unsubstituted template, not the rule. The
    // whole spellheart family scales, so the app's ladder is the one to trust.
    const ladder = (base: string) =>
      // Both id orders exist in the data — `greater-pickled-demon-tongue` and `flaming-star-greater`.
      ['', 'greater-', 'major-'].map((p, i) => {
        const it = c().items[`${p}${base}`] ?? c().items[`${base}${['', '-greater', '-major'][i]}`];
        return it?.passiveEffects?.resistances?.[0]?.value;
      }).filter((v) => v != null);
    expect(ladder('flaming-star').slice(0, 2)).toEqual([2, 5]);
    expect(ladder('pickled-demon-tongue')).toEqual([2, 5, 10]);
  });
});
