import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveAc, deriveBulk } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * NATURAL ARMOUR — *"When you're unarmored, your scales give you a +1 item bonus to AC with a Dexterity
 * cap of +3. The item bonus increases to +2 at 5th level."*
 *
 * Four records print this and none had a field to hold it, so all four moved no AC — the sheet showed
 * the sentence beside an unchanged number. Found by the Wanderer's Guide parity pass on batch 4
 * (Scales of Steel), then measured: scales-of-steel, scaly-hide, scales-of-the-dragon, wormskin.
 */

const ac = (ch: ReturnType<typeof build>) => deriveAc(ch, db).value;
const withFeat = (id: string, level: number, over: Partial<BuildState> = {}) =>
  build('fighter', level, { featPicks: { '1:class': id } as BuildState['featPicks'], ...over });
const plain = (level: number) => build('fighter', level);

describe('natural armour', () => {
  it('all four records are authored', () => {
    for (const id of ['scales-of-steel', 'scaly-hide', 'scales-of-the-dragon', 'wormskin']) {
      const n = (db.feats[id] as { unarmoredAc?: { acBonus: number; dexCap?: number } }).unarmoredAc;
      expect(n, `${id} must carry unarmoredAc`).toBeTruthy();
      expect(n!.dexCap).toBe(3);
    }
  });

  it('raises AC while unarmored', () => {
    expect(ac(withFeat('scales-of-steel', 1))).toBe(ac(plain(1)) + 1);
    expect(ac(withFeat('scales-of-the-dragon', 1))).toBe(ac(plain(1)) + 2);
  });

  it('upgrades at 5th where the text says so, and not where it does not', () => {
    expect(ac(withFeat('scales-of-steel', 5))).toBe(ac(plain(5)) + 2);
    // Scales of the Dragon prints no upgrade clause — it stays +2.
    expect(ac(withFeat('scales-of-the-dragon', 5))).toBe(ac(plain(5)) + 2);
  });

  /* All three print the SAME exception — *"the item bonus to AC from these scales is cumulative with
   * armor potency runes on your explorer's clothing, mage armor, and bracers of armor"* — but only
   * scaly-hide carried the flag, so the other two competed with the rune and cost their wearer 1-2 AC
   * at every level. The flag is the whole mechanic, so assert it on the records, not only through one
   * built character. */
  it('every record printing the cumulative clause carries the flag', () => {
    for (const id of ['scaly-hide', 'scales-of-steel', 'scales-of-the-dragon']) {
      expect(db.feats[id]?.unarmoredAc?.cumulative, id).toBe(true);
    }
  });

  /* Two cumulative records are still two ITEM bonuses to AC, and those do not stack with EACH OTHER —
   * the printed exception is with potency RUNES. So the cumulative pool takes a max within itself; it
   * used to sum, which stayed invisible only while scaly-hide was the sole record carrying the flag. */
  it('does not stack with itself when two records grant it', () => {
    /* Level 2 — a 1st-level character has no `2:class` slot, so both feats have to be reachable for the
     * non-stacking claim to mean anything. At 2nd, Scales of Steel is still +1 and the Dragon's is +2,
     * so a stacking bug would read +3. */
    const both = build('fighter', 2, {
      featPicks: { '1:class': 'scales-of-steel', '2:class': 'scales-of-the-dragon' } as BuildState['featPicks'],
    });
    expect(both.feats.map((f) => f.featId)).toEqual(expect.arrayContaining(['scales-of-steel', 'scales-of-the-dragon']));
    expect(ac(both)).toBe(ac(plain(2)) + 2);
  });

  /* "When you're unarmored" — the whole clause is conditional, and explorer's clothing still counts as
   * unarmored, so the gate is the shared `isUnarmored` helper rather than "no armour equipped". */
  it('does nothing in real armour', () => {
    const armoured = { inventory: [{ itemId: 'breastplate', qty: 1, worn: true }] } as unknown as Partial<BuildState>;
    const withScales = withFeat('scales-of-steel', 1, armoured);
    const without = build('fighter', 1, armoured);
    expect(ac(withScales)).toBe(ac(without));
  });

  it('caps Dex to AC at +3', () => {
    const high = { abilityScores: { dex: 20 } } as unknown as Partial<BuildState>;
    const res = deriveAc(withFeat('scales-of-steel', 1, high), db);
    expect(res.dexCap).toBe(3);
  });
});

/**
 * Adrenaline Rush: *"While you are Raging, increase your encumbered and maximum Bulk limits by 2."*
 *
 * `bulkLimitBonus` on a record is unconditional, so this could only have been authored as an always-on
 * bonus — raising a barbarian's carrying capacity out of combat. Now a `whileActive` clause on the same
 * rage toggle the sheet already tracks.
 */
describe('Adrenaline Rush — Bulk only while Raging', () => {
  /* Rage is a live PLAY toggle — `Character.classResources.rage > 0`, read by `activeStateGrants` —
   * not a build input, so it is set on the built character rather than passed to build(). */
  const barb = (raging: boolean) => {
    const ch = build('barbarian', 1, { featPicks: { '1:class': 'adrenaline-rush' } as BuildState['featPicks'] });
    return { ...ch, classResources: { ...(ch.classResources ?? {}), rage: raging ? 1 : 0 } };
  };

  it('is authored behind the rage gate, not as a standing bonus', () => {
    const rec = db.feats['adrenaline-rush'] as { whileActive?: { state: string; bulkLimitBonus?: number }[]; bulkLimitBonus?: number };
    expect(rec.bulkLimitBonus, 'must NOT be unconditional').toBeUndefined();
    expect(rec.whileActive?.[0]).toMatchObject({ state: 'rage', bulkLimitBonus: 2 });
  });

  it('raises both Bulk limits by 2 while raging, and by nothing otherwise', () => {
    const off = deriveBulk(barb(false), db);
    const on = deriveBulk(barb(true), db);
    expect(on.encumberedAt).toBe(off.encumberedAt + 2);
    expect(on.max).toBe(off.max + 2);
  });
});
