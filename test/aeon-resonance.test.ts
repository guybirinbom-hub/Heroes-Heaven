import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { Character } from '../src/rules/types';

/*
 * AEON STONE RESONANCE — *"their resonant power when slotted into a special magical item called a
 * wayfinder."*
 *
 * 53 aeon stones ship, 33 print a resonant power of their own, and NONE of it was modelled: a slotted
 * stone's extra spell did not exist, and nothing told the player what slotting bought them.
 *
 * It is gated on the `wayfinder-slotted` designation rather than starred, because whether a stone sits
 * in your wayfinder is a state the sheet can hold — unlike a terrain or an ongoing spell. Both halves
 * are asserted here: granted when slotted, absent when not.
 */
const db = content();

/*
 * ⚠ The inventory is passed to build(), NOT spread onto a built character. Innate spells are collected
 * during buildCharacter, so spreading a built character and attaching an inventory afterwards never
 * re-runs the collector: every assertion here read an empty list, which is a test that can pass or
 * fail for reasons unrelated to what it claims to check.
 */
const withStone = (itemId: string, slotted: boolean): Character =>
  build('fighter', 6, {
    inventory: [
      {
        instanceId: 's',
        itemId,
        quantity: 1,
        invested: true,
        worn: true,
        ...(slotted ? { designations: ['wayfinder-slotted' as const] } : {}),
      },
    ],
  } as never) as Character;

/*
 * ⚠ BOTH halves of a spellcasting entry. A rank-0 spell lands in `cantrips` and a ranked one in
 * `repertoire`; reading only the latter reported Detect Magic and Read Aura as ungranted when both
 * were sitting in `cantrips`, correctly sourced to the stone.
 */
const innateIds = (c: Character) =>
  (c.spellcasting ?? []).flatMap((e) => [
    ...((e as { cantrips?: string[] }).cantrips ?? []),
    ...Object.values((e as { repertoire?: Record<string, string[]> }).repertoire ?? {}).flat(),
  ]);

describe('a resonant power applies only while the stone is slotted', () => {
  it('Clear Quartz Octagon grants Mending when slotted, and nothing when not', () => {
    expect(innateIds(withStone('aeon-stone-clear-quartz-octagon', true)), 'slotted').toContain('mending');
    expect(innateIds(withStone('aeon-stone-clear-quartz-octagon', false)), 'not slotted').not.toContain('mending');
  });

  it('a two-spell clause grants both', () => {
    /* *"cast Detect Magic and Read Aura as arcane innate spells at will."* The only two-spell resonant
     * clause in the family, and the one my first parser silently dropped by demanding an article. */
    const got = innateIds(withStone('aeon-stone-lavender-and-green-ellipsoid', true));
    expect(got).toContain('detect-magic');
    expect(got).toContain('read-aura');
  });

  it("the stone's OWN power is unaffected by slotting", () => {
    /* Resonance is a SECOND effect on top of the stone's own — the base power must not depend on it. */
    const base = db.items['aeon-stone-agate-ellipsoid'] as { innateSpells?: { spellId: string }[] };
    const own = (base.innateSpells ?? []).map((g) => g.spellId);
    if (!own.length) return;
    for (const s of own) expect(innateIds(withStone('aeon-stone-agate-ellipsoid', false)), `${s} is the stone's own`).toContain(s);
  });
});

describe('the resonance data itself', () => {
  it('all 33 printed resonant powers are carried, each with its clause', () => {
    const withResonant = Object.entries(db.items).filter(([, r]) => (r as { resonant?: unknown }).resonant);
    expect(withResonant.length, 'the family header carries no power of its own').toBe(33);
    for (const [id, r] of withResonant) {
      const res = (r as { resonant: { note: string; innateSpells?: { spellId: string; tradition: string }[] } }).resonant;
      expect(res.note.length, `${id} must state its printed clause`).toBeGreaterThan(20);
      /* Nothing invented: every spell named must be one we actually ship. */
      for (const g of res.innateSpells ?? []) {
        expect(db.spells[g.spellId], `${id} names spell ${g.spellId}, which is not in core.spells`).toBeTruthy();
        /* The tradition is OPTIONAL, because two clauses genuinely state none — *"The resonant power
         * allows you to cast Sending once per day."* Wanderer's Guide omits it on those two as well.
         * Inventing one to satisfy a type would put a rule on the sheet the book does not print. */
        if (g.tradition !== undefined) expect(['arcane', 'divine', 'occult', 'primal']).toContain(g.tradition);
      }
    }
  });

  it('every clause that names an innate spell has one modelled', () => {
    /* The guard against a parser that quietly matches less than it should — which is exactly how the
     * two-spell clause was lost on the first pass. */
    const missed: string[] = [];
    for (const [id, r] of Object.entries(db.items)) {
      const res = (r as { resonant?: { note: string; innateSpells?: unknown[] } }).resonant;
      if (!res) continue;
      if (/innate (?:spell|cantrip)/i.test(res.note) && !res.innateSpells?.length) missed.push(id);
    }
    expect(missed).toEqual([]);
  });
});
