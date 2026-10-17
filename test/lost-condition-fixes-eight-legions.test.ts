import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveStrikes } from '../src/rules/derive';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * LOST-CONDITION LANE (2026-10-17) — Strength of Eight Legions, AoN feat-6988.
 *
 * Print: *"You permanently gain the effects of enlarge, and your maximum Hit Points increase by your
 * level."* Enlarge (AoN spell-1514, Player Core): *"it gains a +2 status bonus to damage rolls on melee
 * Strikes."* The overlay row said `appliesTo: 'all'`, so with the trust gate ON a yaksha's longbow
 * gained the +2 too. Narrowed to `'melee'` (Wanderer's Guide encodes the same: MELEE_ATTACK_DAMAGE_BONUS).
 * Mutation-proved in memory by planting the old `'all'` back. Synthetic characters only.
 */
const gated = content({ trustGate: true });
const FEAT = 'strength-of-eight-legions';
const BOW: InventoryItem = { instanceId: 'bow', itemId: 'longbow', quantity: 1, equipped: true };
const SWORD: InventoryItem = { instanceId: 'sword', itemId: 'longsword', quantity: 1, equipped: true };

const pc = (d: ContentDatabase, withFeat: boolean): Character =>
  buildCharacter(
    {
      ...emptyBuild(),
      name: 'TEST lost-condition eight legions',
      level: 17,
      classId: 'fighter',
      keyAbility: 'str',
      ancestryId: 'human',
      backgroundId: Object.keys(d.backgrounds)[0],
      ...(withFeat ? { featPicks: { '17:ancestry:0': FEAT } } : {}),
      inventory: [BOW, SWORD],
    } as BuildState,
    d,
  );
const damage = (c: Character, d: ContentDatabase, name: string) => deriveStrikes(c, d).find((s) => s.name === name)?.damage ?? '';

/** The Strikes the +2 reaches that print keeps it off. */
function rangedOverGrant(d: ContentDatabase): string[] {
  return damage(pc(d, true), d, 'Longbow') !== damage(pc(d, false), d, 'Longbow') ? ['the longbow gains the +2'] : [];
}

describe('Strength of Eight Legions — the +2 is for melee Strikes (gate ON)', () => {
  it('the feat is really held (or the comparison below is vacuous)', () => {
    expect(pc(gated, true).feats.some((f) => f.featId === FEAT)).toBe(true);
  });

  it('a ranged Strike is unchanged by the feat', () => {
    expect(rangedOverGrant(gated)).toEqual([]);
  });

  it('a melee Strike still gains the +2', () => {
    expect(damage(pc(gated, true), gated, 'Longsword')).not.toBe(damage(pc(gated, false), gated, 'Longsword'));
    expect(damage(pc(gated, true), gated, 'Longsword')).toMatch(/plus 2\b/);
  });

  /*
   * lost-condition blocked lane (2026-10-17) premise: spell-1514 "it gains a +2 status bonus to damage
   * rolls on melee Strikes" — the +2 is a STATUS bonus, so it carries type 'status' (it was 'untyped', which
   * would also stack with a second status bonus to the same Strike; strikeDamageRiders keeps the highest of
   * one type).
   */
  it('the +2 is a status bonus (enlarge), shown as such, and a second status bonus does not stack with it', () => {
    expect(gated.feats[FEAT].strikeDamage).toEqual([{ type: 'status', flat: 2, appliesTo: 'melee' }]);
    expect(damage(pc(gated, true), gated, 'Longsword')).toMatch(/plus 2 status\b/);
    const sword = gated.items['longsword'];
    (gated.items as Record<string, unknown>)['longsword'] = { ...sword, strikeDamage: [{ type: 'status', flat: 1, appliesTo: 'melee' }] };
    try {
      const d = damage(pc(gated, true), gated, 'Longsword');
      expect(d).toMatch(/plus 2 status\b/);
      expect(d).not.toMatch(/\b1 status\b/);
    } finally {
      gated.items['longsword'] = sword;
    }
  });

  it("mutation-proof: the old 'untyped' type, planted back, stacks with a second status bonus", () => {
    const saved = gated.feats[FEAT];
    const sword = gated.items['longsword'];
    (gated.feats as Record<string, unknown>)[FEAT] = { ...saved, strikeDamage: [{ type: 'untyped', flat: 2, appliesTo: 'melee' }] };
    (gated.items as Record<string, unknown>)['longsword'] = { ...sword, strikeDamage: [{ type: 'status', flat: 1, appliesTo: 'melee' }] };
    try {
      expect(damage(pc(gated, true), gated, 'Longsword')).toMatch(/2 untyped.*1 status|1 status.*2 untyped/);
    } finally {
      gated.feats[FEAT] = saved;
      gated.items['longsword'] = sword;
    }
  });

  it("mutation-proof: the old appliesTo 'all', planted back on the gated record, is caught", () => {
    const saved = gated.feats[FEAT];
    (gated.feats as Record<string, unknown>)[FEAT] = { ...saved, strikeDamage: [{ type: 'untyped', flat: 2, appliesTo: 'all' }] };
    try {
      expect(rangedOverGrant(gated)).toEqual(['the longbow gains the +2']);
    } finally {
      gated.feats[FEAT] = saved;
    }
    expect(rangedOverGrant(gated)).toEqual([]);
  });
});
