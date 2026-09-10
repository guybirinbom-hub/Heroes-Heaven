// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { renderText } from './_render';
import { conditionalResistances, deriveDefenses } from '../src/rules/derive';
import { DefensesPills } from '../src/sheet/DefensesPills';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Batch 036, gap chunk data-rows-2 — the CROSS-FILE GAP raised beside the spirit-walk#resistance row:
 * an `against`-only IWR entry was stored, attributed and displayed NOWHERE. derive.ts skips `res.set`
 * for it by design, both IWR renderers iterate `resistances` alone, and the breakdown modal that holds
 * the clause is reachable only by clicking a pill that was never drawn.
 *
 * The row itself is applied by the driver, so the record is PATCHED IN MEMORY here: the patch writes
 * the same value the row does, which keeps every assertion true before and after the driver runs.
 */
const RESISTANCES = [
  {
    type: 'all',
    value: 'floor(@actor.level/2)',
    against: 'damage dealt by haunts or spirits, during your first turn in an encounter (you and allies in the 30-foot aura)',
  },
];

/** content() with feats/spirit-walk carrying the authored row — never the cached object itself. */
function patched(): ContentDatabase {
  const db = content();
  return {
    ...db,
    feats: { ...db.feats, 'spirit-walk': { ...db.feats['spirit-walk'], resistances: RESISTANCES } },
  } as ContentDatabase;
}

/** An animist who has taken the feat, at the level it is printed at. */
const walker = (level = 8): Character =>
  ({ ...build('animist', level), feats: [{ featId: 'spirit-walk', level: 8, category: 'class' as const }] }) as Character;

describe('batch 036 gap (chunk data-rows-2) — a conditional-only resistance reaches a surface', () => {
  // batch 036: spirit-walk#resistance
  // AoN feat-7137: "During your first turn in an encounter, you and allies in the aura have resistance
  // equal to half your level against damage dealt by haunts or spirits." `against` withholds the number
  // from the headline total on purpose — so the ONLY place it can be read is this derived list.
  it('feats/spirit-walk: conditionalResistances carries what the headline total withholds', () => {
    const def = deriveDefenses(walker(8), patched());
    // Still withheld from the counted list — that skip is what keeps the headline honest.
    expect(def.resistances.some((r) => r.type === 'all')).toBe(false);
    // …and attributed, with the printed trigger.
    const srcs = def.sources?.['resistance:all'] ?? [];
    expect(srcs.some((s) => /haunts or spirits/i.test(s.condition ?? ''))).toBe(true);
    // half your level, at level 8.
    expect(conditionalResistances(def)).toEqual([{ type: 'all', value: 4 }]);
  });

  // batch 036: spirit-walk#resistance
  // The same clause at a different level: "equal to half your level" is a ladder, not a constant, and a
  // list derived from the attribution map must resolve the formula the same way the counted one does.
  it('feats/spirit-walk: the situational value follows half the level', () => {
    expect(conditionalResistances(deriveDefenses(walker(20), patched()))).toEqual([{ type: 'all', value: 10 }]);
  });

  // batch 036: spirit-walk#resistance
  // The half this gap line is actually about: does the number reach a pixel. Before the fix
  // DefensesPills iterated `resistances` alone, so this character's only defence rendered nothing.
  it('feats/spirit-walk: DefensesPills prints the situational resistance', () => {
    const text = renderText(<DefensesPills character={walker(8)} content={patched()} />);
    expect(text).toContain('Situational resistances');
    expect(text).toContain('All 4');
  });

  // batch 036: spirit-walk#resistance
  // The guard on the other side of the same fix: a counted resistance must NOT be duplicated into the
  // situational row, or every ordinary resistance would print twice.
  it('feats/spirit-walk: a counted resistance never doubles into the situational list', () => {
    const db = patched();
    const both = {
      ...db,
      feats: {
        ...db.feats,
        'spirit-walk': { ...db.feats['spirit-walk'], resistances: [...RESISTANCES, { type: 'all', value: 2 }] },
      },
    } as ContentDatabase;
    const def = deriveDefenses(walker(8), both);
    expect(def.resistances).toContainEqual({ type: 'all', value: 2 });
    expect(conditionalResistances(def)).toEqual([]);
  });
});
