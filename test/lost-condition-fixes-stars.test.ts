import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { derivePerception, deriveSkill } from '../src/rules/derive';
import { statHasSituational } from '../src/rules/explain';
import { FEAT_SITUATIONAL, setSituationalTrustOff } from '../src/rules/situationalBonuses';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * LOST-CONDITION LANE (2026-10-17) — restricted item bonuses that sat as FLAT numbers (ruling B: *"Move
 * it to a star"* — the bonus leaves passiveEffects and becomes a situational entry with the printed
 * restriction in its `when`).
 *
 * Every record here is DARK under the trust gate (Wanderer's Guide carries no encoding for it), so a
 * player with the gate on sees no change. The fix is for the day the gate is switched off or the record
 * is approved: before it, Clarity Goggles (Lesser) added +1 to EVERY Perception check, the Violin of the
 * Waves +2 to every Performance check (singing, dancing), and so on. So these tests build with the gate
 * OFF — the switch the owner can flip — where the old rows would have reached the total.
 *
 *   item                               print                                                       stat
 *   cauthooj-bagpipes   (equipment-3221)       "+2 item bonus to Performance checks while playing music with them"   performance
 *   clarity-goggles-lesser (equipment-2314-2159) "+1 item bonus to visual Perception checks"                        perception
 *   clarity-goggles-moderate (…-2160)          "The goggles grant a +2 item bonus."                                 perception
 *   mirror-goggles-moderate (equipment-2315-2163) "+N item bonus to visual Perception checks …" (+2)               perception
 *   mirror-goggles-greater (…-2164)            (+3)                                                                 perception
 *   spectacles-of-piercing-sight (equipment-2317) "+3 item bonus to visual Perception checks"                      perception
 *   violin-of-the-waves (equipment-2199)       "When you make a Performance check using the violin … +2"            performance
 *   busine-of-divine-reinforcements (equipment-1566, its plural twin) "When played as an instrument … +2"         performance
 *
 * Each over-grant is mutation-proved in memory by planting the old passive back. Synthetic characters.
 */
const db = content();
type Stat = 'perception' | 'performance';
const CASES: { id: string; stat: Stat; old: number; words: RegExp }[] = [
  { id: 'cauthooj-bagpipes', stat: 'performance', old: 2, words: /playing music/ },
  { id: 'clarity-goggles-lesser', stat: 'perception', old: 1, words: /visual Perception/ },
  { id: 'clarity-goggles-moderate', stat: 'perception', old: 2, words: /visual Perception/ },
  { id: 'mirror-goggles-moderate', stat: 'perception', old: 2, words: /visual Perception/ },
  { id: 'mirror-goggles-greater', stat: 'perception', old: 3, words: /visual Perception/ },
  { id: 'spectacles-of-piercing-sight', stat: 'perception', old: 3, words: /visual Perception/ },
  { id: 'violin-of-the-waves', stat: 'performance', old: 2, words: /using the violin/ },
  { id: 'busine-of-divine-reinforcements', stat: 'performance', old: 2, words: /playing the busine/ },
];

// The trust gate's star set is module-level: make sure nothing gated this file's stars off.
beforeAll(() => setSituationalTrustOff([]));
afterAll(() => setSituationalTrustOff([]));

const base = (): Character =>
  buildCharacter(
    {
      ...emptyBuild(),
      name: 'TEST lost-condition stars',
      level: 12,
      classId: 'bard',
      keyAbility: 'cha',
      ancestryId: 'human',
      backgroundId: Object.keys(db.backgrounds)[0],
    } as BuildState,
    db,
  );
const using = (c: Character, itemId: string): Character => ({
  ...c,
  inventory: [...c.inventory, { instanceId: 'x', itemId, quantity: 1, equipped: true, worn: true, invested: true } as InventoryItem],
});
const total = (c: Character, d: ContentDatabase, stat: Stat) => (stat === 'perception' ? derivePerception(c, d).modifier : deriveSkill(c, 'performance', d).modifier);

/** The records whose restricted bonus still reaches the ordinary total. */
function flatOverGrants(d: ContentDatabase): string[] {
  const out: string[] = [];
  const c = base();
  for (const k of CASES) {
    const bump = total(using(c, k.id), d, k.stat) - total(c, d, k.stat);
    if (bump !== 0) out.push(`${k.id} moves every ${k.stat} check by ${bump}`);
  }
  return out;
}

describe('restricted item bonuses are stars, not numbers (gate OFF)', () => {
  it('the records exist and carry no flat number on the restricted stat', () => {
    for (const k of CASES) {
      const rec = db.items[k.id];
      expect(rec, k.id).toBeTruthy();
      const pe = rec?.passiveEffects;
      expect(pe?.perception, k.id).toBeUndefined();
      expect(pe?.skills?.performance, k.id).toBeUndefined();
    }
  });

  it('wearing or playing the item moves no ordinary total', () => {
    expect(flatOverGrants(db)).toEqual([]);
  });

  it('each carries a star on that stat that states the printed restriction', () => {
    const c = base();
    for (const k of CASES) {
      const rows = FEAT_SITUATIONAL[k.id] ?? [];
      const hit = rows.find((r) => r.targets.some((t) => (k.stat === 'perception' ? t.kind === 'perception' : t.kind === 'skill' && t.detail === 'performance')));
      expect(hit?.when, k.id).toMatch(k.words);
      expect(hit?.bonus, k.id).toMatch(new RegExp(`\\+${k.old} item`));
      expect(hit?.when, `${k.id} must not claim the bonus is in the total`).not.toMatch(/already in your total/);
      const ref = k.stat === 'perception' ? ({ kind: 'perception' } as const) : ({ kind: 'skill', skill: 'performance' } as const);
      expect(statHasSituational(using(c, k.id), ref, db), k.id).toBe(true);
    }
  });

  it('the violin keeps BOTH printed rungs: +2 using it, +3 aboard a ship or beside ocean water', () => {
    const bonuses = (FEAT_SITUATIONAL['violin-of-the-waves'] ?? []).map((r) => r.bonus);
    expect(bonuses).toEqual(['+2 item', '+3 item']);
  });

  it('mutation-proof: each old passive, planted back, is caught', () => {
    for (const k of CASES) {
      const saved = db.items[k.id];
      const old = k.stat === 'perception' ? { perception: k.old } : { skills: { performance: k.old } };
      (db.items as Record<string, unknown>)[k.id] = { ...saved, passiveEffects: old };
      try {
        expect(flatOverGrants(db), k.id).toContain(`${k.id} moves every ${k.stat} check by ${k.old}`);
      } finally {
        db.items[k.id] = saved;
      }
    }
    expect(flatOverGrants(db)).toEqual([]);
  });
});
