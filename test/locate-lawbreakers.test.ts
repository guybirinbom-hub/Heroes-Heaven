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
   * ⚠ NO HEIGHTENING IS ASSERTED, deliberately. Their encoding raises the rank to 5 at level 14 for
   * EVERY character; the printed text raises it only for a member of the Order of the Gate. Encoding
   * either one diverges from the other authority, so it is the owner's ruling and is recorded in
   * work/owner-questions.json. Asserting a rank here would quietly settle the question this test's
   * absence is holding open — so instead the open question itself is what gets asserted.
   */
  it('the heightening is still recorded as an open question rather than silently decided', () => {
    const doc = JSON.parse(readFileSync('work/owner-questions.json', 'utf8')) as { open: { id: string }[] };
    expect(doc.open.map((q) => q.id)).toContain('locate-lawbreakers');
  });

  it('the grant survives `npm run data` — it is in effect-backfill.json', () => {
    const rows = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as {
      category: string; id: string; field: string;
    }[];
    expect(rows.some((r) => r.category === 'feats' && r.id === 'locate-lawbreakers' && r.field === 'effectChoices')).toBe(true);
  });
});
