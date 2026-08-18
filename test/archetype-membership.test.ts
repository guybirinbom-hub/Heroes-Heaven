import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { dedicationBlock } from '../src/rules/build';
import { belongsToArchetype, archetypeFeatCounts } from '../src/rules/derive';

const c = content();

/**
 * "THE ARCHETYPE MAY SELECT IT" IS NOT "IT BELONGS TO THE ARCHETYPE".
 *
 * Archives of Nethys lists a class feat on an archetype's page when that archetype can select it, and
 * the importer read that listing as ownership. 420 feats came out carrying an `archetype` while their
 * traits name a class: Domain Initiate, Advanced Domain and Expanded Domain Initiate are all stamped
 * `soul-warden` and all three are cleric feats.
 *
 * It read as cosmetic and was not. `dedicationBlock` counted them, so a cleric who took Domain
 * Initiate and Advanced Domain — two feats a cleric takes anyway — satisfied *"take two more feats
 * from the Soul Warden archetype first"* and unlocked a second dedication they had not earned.
 *
 * Nothing in the suite noticed, because nothing had ever asked a question whose answer depended on
 * the difference. These tests ask it.
 */
describe('archetype membership vs selectability', () => {
  it('a class feat an archetype merely lists is not a member of it', () => {
    const di = c.feats['domain-initiate'];
    expect(di.archetype, 'the data still records that Soul Warden may select it').toBe('soul-warden');
    expect(di.traits).toContain('cleric');
    expect(di.traits).not.toContain('archetype');
    expect(belongsToArchetype(di), 'a cleric feat is not a Soul Warden feat').toBe(false);
  });

  it('a real archetype feat IS a member', () => {
    expect(belongsToArchetype(c.feats['cycle-spell'])).toBe(true);
    expect(belongsToArchetype(c.feats['soul-warden-dedication'])).toBe(true);
  });

  it('mythic destiny feats stay bound to their destiny', () => {
    /* The exception that makes this a predicate rather than an inline `traits.includes('archetype')`.
     * A destiny's feats carry `mythic` and never `archetype`; demanding the archetype trait would
     * unbind all 18 of Eternal Legend's feats, which mythic.ts groups on this same field. */
    const mythic = Object.values(c.feats).filter((f) => f.archetype === 'eternal-legend');
    expect(mythic.length).toBeGreaterThan(5);
    expect(mythic.every((f) => belongsToArchetype(f)), 'a destiny lost its feats').toBe(true);
  });

  it('cleric feats do not satisfy the Soul Warden gate', () => {
    const gate = c.feats['soul-warden-dedication']?.dedicationGate;
    expect(gate, 'Soul Warden no longer prints a gate — this test needs a new subject').toBeTruthy();
    const other = Object.values(c.feats).find(
      (f) => f.traits?.includes('dedication') && f.id !== 'soul-warden-dedication' && f.level <= 2,
    )!;
    const blocked = (taken: string[]) => dedicationBlock(taken, other, c) !== null;

    expect(blocked(['soul-warden-dedication']), 'the gate should hold with no archetype feats').toBe(true);
    // The regression: two CLERIC feats used to count as two Soul Warden feats and open the gate.
    expect(blocked(['soul-warden-dedication', 'domain-initiate', 'advanced-domain'])).toBe(true);
    // …while two genuine Soul Warden feats still do exactly what they should.
    expect(blocked(['soul-warden-dedication', 'cycle-spell', 'psychopomp-familiar'])).toBe(false);
  });

  it('archetypeFeatCounts counts members only', () => {
    /* Hellknight armour resistance scales on this number, and four of the sixteen feats stamped
     * `hellknight` are plain class feats. A wizard who happens to hold Steady Spellcasting must not
     * read as having a Hellknight archetype feat. */
    const ch = build('cleric', 6, {
      deityId: Object.keys(c.deities)[0],
      featPicks: { '1:class:0': 'domain-initiate' },
    });
    expect(archetypeFeatCounts(ch, c)['soul-warden'] ?? 0).toBe(0);
  });

  /**
   * THE RATCHET. The import can re-stamp this field at any regeneration, and the count above is the
   * only thing that would notice. It is pinned rather than asserted to be zero because 420 records is
   * a data problem to shrink deliberately, not something to fix by making the suite red on arrival.
   *
   * Moving this number DOWN is always fine. If a regeneration moves it UP, the import has started
   * mistaking a listing for ownership again somewhere new — find where before raising the ceiling.
   */
  it('the number of mis-stamped feats does not grow', () => {
    const misstamped = Object.values(c.feats).filter((f) => f.archetype && !belongsToArchetype(f));
    expect(misstamped.length).toBeLessThanOrEqual(420);
  });
});
