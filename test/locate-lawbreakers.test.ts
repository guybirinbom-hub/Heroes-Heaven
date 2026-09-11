import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * LOCATE LAWBREAKERS MUST ACTUALLY GRANT LOCATE.
 *
 * *"You gain Locate as an innate spell of a tradition of your choice, which you can cast once per
 * day."*
 *
 * The record shipped `innateSpells: []`. An empty array is the worst shape a missing grant can take:
 * every predicate that asks "does this record grant innate spells?" answers yes, so the gap survived
 * the coverage sweeps that were built to find exactly this. The id appeared in FEAT_PICK_GRANTS only
 * as one of the fourteen options inside the `order-training` picker — never as a grant of its own.
 *
 * Their side encodes `select "Select a Tradition"` with four options, each a giveSpell INNATE of
 * Locate. Ours is now the same choice, and this asserts the spell arrives on a BUILT character rather
 * than that the data looks right.
 */
describe('Locate Lawbreakers grants Locate once per day', () => {
  const withTradition = (tradition: string) =>
    build('fighter', 14, {
      featPicks: { '1:class:0': 'locate-lawbreakers' },
      effectChoices: { 'locate-lawbreakers:locate-tradition': tradition },
    } as Partial<BuildState>);

  const innateOf = (c: ReturnType<typeof build>) => c.spellcasting.find((s) => s.type === 'innate');

  it('the spell it names exists', () => {
    expect(db.spells.locate, 'granting a spell that does not exist grants nothing').toBeDefined();
  });

  it('no longer ships an empty innateSpells array, which read as "grants something"', () => {
    const rec = (db.feats as Record<string, { innateSpells?: unknown[] }>)['locate-lawbreakers'];
    expect(rec.innateSpells ?? undefined).toBeUndefined();
  });

  it('offers all four traditions, as their encoding and "a tradition of your choice" both do', () => {
    const rec = (db.feats as Record<string, { effectChoices?: { options: { value: string }[] }[] }>)['locate-lawbreakers'];
    const values = (rec.effectChoices?.[0].options ?? []).map((o) => o.value);
    expect(values).toEqual(['arcane', 'divine', 'occult', 'primal']);
  });

  it('the picked tradition delivers Locate as an innate spell', () => {
    for (const tradition of ['arcane', 'divine', 'occult', 'primal']) {
      const innate = innateOf(withTradition(tradition));
      expect(innate, `${tradition}: no innate spellcasting entry appeared`).toBeDefined();
      const ranked = Object.values(innate!.repertoire ?? {}).flat() as string[];
      expect(ranked, `${tradition}: Locate did not reach the sheet`).toContain('locate');
    }
  });

  it('…and no pick means no spell — the control', () => {
    const none = build('fighter', 14, { featPicks: { '1:class:0': 'locate-lawbreakers' } });
    const ranked = Object.values(innateOf(none)?.repertoire ?? {}).flat() as string[];
    expect(ranked).not.toContain('locate');
  });

  /*
   * The owner RULED on 2026-09-10 (#7, "keep the printed scope"), so this no longer holds a question
   * open — it holds the ruling. *"If you're a member of the Order of the Gate, when you reach 14th
   * level, the spell is heightened to 5th rank."* (hellknight-order-9): the ladder belongs to ONE
   * order, and Wanderer's Guide hands it to every Hellknight at 14.
   *
   * Asserted as an implication rather than a fixed rank, so it is honest in both states: today the
   * record carries no ladder at all and the clause is vacuously true; once batch 037's row lands it
   * is the guard that the ladder never travels without its gate. The rank arithmetic itself is
   * pinned on built characters in test/batch037-gap-data-rows-2.test.ts.
   */
  // batch 037: locate-lawbreakers#order-of-the-gate
  it('never heightens for every Hellknight — a ladder here must carry the Order of the Gate gate', () => {
    const rec = (db.feats as Record<string, { effectChoices?: { options: { grant?: { innateSpells?: { heightenAt?: unknown; heightenWhenFlag?: { flag: string; value: string } }[] } }[] }[] }>)[
      'locate-lawbreakers'
    ];
    const grants = (rec.effectChoices?.[0].options ?? []).flatMap((o) => o.grant?.innateSpells ?? []);
    expect(grants.length, 'the four tradition options must each still grant Locate').toBe(4);
    for (const g of grants) {
      if (!g.heightenAt) continue;
      // batch 037: locate-lawbreakers#order-of-the-gate
      expect(g.heightenWhenFlag, 'an ungated ladder is their encoding, not print').toEqual({
        flag: 'hellknightOrder',
        value: 'order-of-the-gate',
      });
    }
  });

  it('the grant survives `npm run data` — it is in effect-backfill.json', () => {
    const rows = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as {
      category: string; id: string; field: string;
    }[];
    expect(rows.some((r) => r.category === 'feats' && r.id === 'locate-lawbreakers' && r.field === 'effectChoices')).toBe(true);
  });
});
