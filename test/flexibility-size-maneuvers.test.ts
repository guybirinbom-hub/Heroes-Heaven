import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { emptyBuild, levelGrants, type BuildState } from '../src/rules/build';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';
import { COMPANION_MODS } from '../src/rules/companionGrants';
import type { Character, Heritage } from '../src/rules/types';

const db = content();

describe('THE BUG: a fighter\'s flexibility slots could never be filled', () => {
  const b = (): BuildState =>
    ({ ...emptyBuild(), classId: 'fighter', level: 20, ancestryId: 'human', backgroundId: Object.keys(db.backgrounds)[0] }) as BuildState;
  const at = (lvl: number) => eligibleFeatsForSlot(b(), db, { level: lvl, category: 'bonus', idx: 0 });

  it('no fighter feat carries category "bonus" — which is what the slot demanded', () => {
    const fighterFeats = Object.values(db.feats).filter((f) => (f.traits ?? []).includes('fighter'));
    expect(fighterFeats.length).toBeGreaterThan(50);
    expect(fighterFeats.every((f) => f.category !== 'bonus'), 'they are all category "class"').toBe(true);
  });

  it('Combat Flexibility (L9) offers 8th-level-and-lower fighter feats', () => {
    const o = at(9);
    expect(o.length).toBeGreaterThan(20);
    expect(Math.max(...o.map((f) => f.level))).toBe(8);
    expect(o.every((f) => (f.traits ?? []).includes('fighter'))).toBe(true);
  });

  it('Improved Flexibility (L15) raises the ceiling to 14', () => {
    expect(Math.max(...at(15).map((f) => f.level))).toBe(14);
  });
});

describe('Ultimate Flexibility', () => {
  const slots = (taken: string[]) =>
    levelGrants(20, 'fighter', db, null, undefined, null, null, false, taken).featSlots.filter((s) => s === 'bonus').length;

  it('is a 20th-level fighter feat whose third pick caps at 18, not 19', () => {
    expect(db.feats['ultimate-flexibility'].level).toBe(20);
    expect(db.feats['ultimate-flexibility'].description).toMatch(/third feat can be up to 18th level/i);
    const o = eligibleFeatsForSlot(
      { ...emptyBuild(), classId: 'fighter', level: 20, ancestryId: 'human', backgroundId: Object.keys(db.backgrounds)[0] } as BuildState,
      db,
      { level: 20, category: 'bonus', idx: 0 },
    );
    expect(Math.max(...o.map((f) => f.level)), 'the level-1 formula would allow 19').toBe(18);
  });

  it('grants the third slot only to a fighter who took it', () => {
    expect(slots([])).toBe(0);
    expect(slots(['ultimate-flexibility'])).toBe(1);
  });

  it('the level 9 and 15 slots are unaffected', () => {
    expect(levelGrants(9, 'fighter', db, null, undefined, null, null, false, []).featSlots.filter((s) => s === 'bonus')).toHaveLength(1);
    expect(levelGrants(15, 'fighter', db, null, undefined, null, null, false, []).featSlots.filter((s) => s === 'bonus')).toHaveLength(1);
  });

  it('and no other class gets one', () => {
    expect(levelGrants(20, 'rogue', db, null, undefined, null, null, false, ['ultimate-flexibility']).featSlots.filter((s) => s === 'bonus')).toHaveLength(0);
  });
});

describe('a heritage that makes you SMALLER', () => {
  const sizeOf = (heritageId: string): string | undefined =>
    (build('fighter', 5, { ancestryId: 'jotunborn', heritageId } as Partial<BuildState>) as Character).size;

  it('the jotunborn ancestry is Large and the heritage says otherwise', () => {
    expect(db.ancestries['jotunborn'].size).toBe('large');
    expect(db.heritages['plane-hopper-jotunborn'].description).toMatch(/Instead of Large, your size is Medium/i);
    expect((db.heritages['plane-hopper-jotunborn'] as Heritage).sizeSet).toBe('medium');
  });

  it('a plane-hopper jotunborn is Medium', () => {
    // sizeOverride is strictly largest-wins, so nothing could ever shrink a character.
    expect(sizeOf('plane-hopper-jotunborn')).toBe('medium');
  });

  it('every other jotunborn heritage is still Large', () => {
    const other = Object.values(db.heritages).find((h) => h.ancestryId === 'jotunborn' && h.id !== 'plane-hopper-jotunborn');
    if (!other) return;
    expect(sizeOf(other.id)).toBe('large');
  });

  it('a medium ancestry with no size record emits nothing', () => {
    const c = build('fighter', 5) as Character;
    expect(c.size ?? 'medium').toBe('medium');
  });
});

describe('Primal Howl', () => {
  it("gives the companion a maneuver 'in addition to any it already knows'", () => {
    expect(db.feats['primal-howl'].description).toMatch(/in addition to any advanced maneuvers it already knows/i);
    const mod = COMPANION_MODS['primal-howl'];
    expect(mod?.kinds).toContain('animal');
    expect(mod?.maneuvers).toHaveLength(1);
  });

  it('every printed value survives — in the maneuver text AND in the shipped record', () => {
    /*
     * This used to pin the DEFECT: core.json's copy had lost its template substitutions ("All
     * creatures in a take damage for every 2 levels your companion has, with a save against your
     * spell DC"), the authored maneuver text carried the real values, and the test asserted the
     * shipped record was still truncated — with a note to revisit if it were ever repaired.
     *
     * It has been. `scripts/repair-dropped-inline.mjs` restored the area, the formula and the save
     * from the Archives across 581 records, and `dropped-inline-check.mjs` in `npm run verify` now
     * holds the whole class at zero. So the assertion flips: the two sources must AGREE, which is
     * what makes the hand-authored maneuver text safe to keep.
     */
    const m = COMPANION_MODS['primal-howl'].maneuvers![0];
    const shipped = String(db.actions['primal-howl']?.description ?? '');
    for (const printed of [/30-foot cone/, /1d6 sonic/, /basic Fortitude/]) {
      expect(m).toMatch(printed);
      expect(shipped, 'the shipped record lost a value the Archives print').toMatch(printed);
    }
  });
});
