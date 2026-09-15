import { describe, it, expect } from 'vitest';
import { deriveShield } from '../src/rules/derive';
import { planAttach } from '../src/rules/attachments';
import { content, build } from './_content';
import type { Character, ContentDatabase, InventoryItem, Item } from '../src/rules/types';

const db = content();

/*
 * THE PRINTED RULE — Reinforcing Rune, GM Core p. 232, fetched from the live Archives index
 * (equipment-2811), usage "etched onto a shield". Each tier ADDS, and the parenthesis is a CEILING on
 * the result, not the result:
 *
 *   Minor (item 4, 75 gp)      "The shield's Hardness increases by 3, it gains an additional 44 Hit
 *                               Points, and its BT increases by 22 (maximum 8 Hardness, 64 HP, and 32 BT)."
 *   Lesser (item 7, 300 gp)    +3 Hardness / +52 HP / +26 BT (maximum 10 Hardness, 80 HP, and 40 BT).
 *   Moderate (item 10, 900 gp) +3 / +64 / +32 (maximum 13 Hardness, 104 HP, and 52 BT).
 *   Greater (item 13, 2,500)   +5 / +80 / +40 (maximum 15 Hardness, 120 HP, and 60 BT).
 *   Major (item 16, 8,000 gp)  +5 / +84 / +42 (maximum 17 Hardness, 136 HP, and 68 BT).
 *   Supreme (item 19, 32,000)  +7 / +108 / +54 (maximum 20 Hardness, 160 HP, and 80 BT).
 */
const PRINTED: Record<number, { name: string; inc: [number, number, number]; max: [number, number, number] }> = {
  1: { name: 'minor', inc: [3, 44, 22], max: [8, 64, 32] },
  2: { name: 'lesser', inc: [3, 52, 26], max: [10, 80, 40] },
  3: { name: 'moderate', inc: [3, 64, 32], max: [13, 104, 52] },
  4: { name: 'greater', inc: [5, 80, 40], max: [15, 120, 60] },
  5: { name: 'major', inc: [5, 84, 42], max: [17, 136, 68] },
  6: { name: 'supreme', inc: [7, 108, 54], max: [20, 160, 80] },
};

type Stats = [hardness: number, hp: number, bt: number];

/** The rule stated independently of the implementation: add, clamp to the ceiling, never reduce. */
const byTheBook = (base: Stats, tier: number): Stats =>
  base.map((b, i) => Math.max(b, Math.min(b + PRINTED[tier].inc[i], PRINTED[tier].max[i]))) as Stats;

const fighter = build('fighter', 5);
const holding = (itemId: string, reinforcing?: number, c: Character = fighter): Character => ({
  ...c,
  inventory: [
    { instanceId: 's1', itemId, quantity: 1, equipped: true, ...(reinforcing ? { runes: { reinforcing } } : {}) } as InventoryItem,
  ],
});
const statsOf = (c: Character, content: ContentDatabase = db): Stats => {
  const s = deriveShield(c, content)!;
  return [s.hardness, s.hp, s.brokenThreshold];
};

/*
 * A stand-in for the owner's homebrew "Custom Spellguard Shield": a shield whose Hardness/HP/BT are
 * whatever the player typed, and deliberately odd so that no ceiling coincides with an increment.
 * The real record isn't in this repo, so its shape (a Spellguard Shield with a lesser reinforcing
 * rune etched) is reproduced here from an official base plus an off-table one.
 */
const HOMEBREW: Item = { id: 'test-homebrew-shield', name: 'Custom Spellguard Shield', level: 7, itemType: 'shield', acBonus: 2, hardness: 7, hp: 33, brokenThreshold: 17 } as Item;
const dbHomebrew: ContentDatabase = { ...db, items: { ...db.items, [HOMEBREW.id]: HOMEBREW } };

/** Base shields to run the whole tier table over, with their printed statistics. */
const BASES: { id: string; stats: Stats }[] = [
  { id: 'steel-shield', stats: [5, 20, 10] },
  { id: 'wooden-shield', stats: [3, 12, 6] },
  { id: 'tower-shield', stats: [5, 20, 10] },
  { id: 'buckler', stats: [3, 6, 3] },
  { id: 'sturdy-shield-minor', stats: [8, 64, 32] },
  { id: 'sturdy-shield-lesser', stats: [10, 80, 40] },
  { id: 'sturdy-shield-moderate', stats: [13, 104, 52] },
  { id: 'sturdy-shield-greater', stats: [15, 120, 60] },
  { id: 'sturdy-shield-major', stats: [17, 136, 68] },
  { id: 'sturdy-shield-supreme', stats: [20, 160, 80] },
];

describe('reinforcing runes are additive with a cap, per tier', () => {
  it('the base shields this table runs over still carry the statistics it assumes', () => {
    // bug 2026-09-15: shield runes
    for (const { id, stats } of BASES) {
      const s = db.items[id];
      expect(s, id).toBeTruthy();
      expect([s.hardness, s.hp, s.brokenThreshold], id).toEqual(stats);
    }
  });

  for (const { id, stats } of BASES) {
    for (const tier of [1, 2, 3, 4, 5, 6]) {
      it(`${id} + ${PRINTED[tier].name} = ${byTheBook(stats, tier).join('/')}`, () => {
        // bug 2026-09-15: shield runes
        expect(statsOf(holding(id, tier))).toEqual(byTheBook(stats, tier));
      });
    }
  }

  for (const tier of [1, 2, 3, 4, 5, 6]) {
    it(`a homebrew shield with odd base stats (7/33/17) + ${PRINTED[tier].name} follows the same math`, () => {
      // bug 2026-09-15: shield runes
      expect(statsOf(holding(HOMEBREW.id, tier), dbHomebrew)).toEqual(byTheBook([7, 33, 17], tier));
    });
  }

  it('three worked examples, written out — the numbers the owner can check against the book', () => {
    // bug 2026-09-15: shield runes
    // Steel shield 5/20/10 + minor: 5+3=8 ≤ 8, 20+44=64 ≤ 64, 10+22=32 ≤ 32 — every stat lands ON its
    // ceiling, which is exactly why "set it to the maximum" looked right.
    expect(statsOf(holding('steel-shield', 1))).toEqual([8, 64, 32]);
    // Sturdy Shield (Minor) 8/64/32 + lesser: min(8+3,10)=10, min(64+52,80)=80, min(32+26,40)=40 —
    // the ceilings bind, and the result is the next rung of the sturdy ladder.
    expect(statsOf(holding('sturdy-shield-minor', 2))).toEqual([10, 80, 40]);
    // Wooden shield 3/12/6 + minor: 3+3=6, 12+44=56, 6+22=28 — no ceiling binds, and the old code
    // handed this shield 8/64/32.
    expect(statsOf(holding('wooden-shield', 1))).toEqual([6, 56, 28]);
  });

  it('the owner’s shape: a Spellguard Shield (6/24/12) with a lesser rune is 9/76/38, not 10/80/40', () => {
    // bug 2026-09-15: shield runes
    expect([db.items['spellguard-shield'].hardness, db.items['spellguard-shield'].hp, db.items['spellguard-shield'].brokenThreshold]).toEqual([6, 24, 12]);
    expect(statsOf(holding('spellguard-shield', 2))).toEqual([9, 76, 38]);
  });

  it('a rune can never take a shield DOWN — a base already past the ceiling keeps its own stats', () => {
    // bug 2026-09-15: shield runes
    // Sturdy Shield (Supreme) is 20/160/80; a minor rune's ceilings (8/64/32) are far below it.
    expect(statsOf(holding('sturdy-shield-supreme', 1))).toEqual([20, 160, 80]);
  });

  it('no rune leaves the shield exactly as printed', () => {
    // bug 2026-09-15: shield runes
    expect(statsOf(holding('steel-shield'))).toEqual([5, 20, 10]);
    expect(statsOf(holding('wooden-shield'))).toEqual([3, 12, 6]);
  });
});

describe('a record that grants "the reinforcing rune of your level"', () => {
  const champ = (itemId: string, level: number, reinforcing?: number) => {
    const c = build('champion', level, { deityId: 'iomedae', extraChoices: { blessing: ['blessed-shield'] } });
    return holding(itemId, reinforcing, c);
  };

  it('the granted tier raises the shield by the same increments, not to the ceiling', () => {
    // bug 2026-09-15: shield runes
    // Blessed Shield at 7th is the LESSER rune: steel 5/20/10 → 8/72/36 (no ceiling binds).
    expect(statsOf(champ('steel-shield', 7))).toEqual([8, 72, 36]);
    // …at 19th, supreme: 5+7=12, 20+108=128, 10+54=64.
    expect(statsOf(champ('steel-shield', 19))).toEqual([12, 128, 64]);
  });

  it('an etched rune that is better than the level’s wins — and IS "the appropriate rune", so +1 Hardness', () => {
    // bug 2026-09-15: shield runes
    // Level 3 grants minor; an etched supreme applies instead (5+7=12) and, being at or above the
    // level's tier, triggers "the shield's Hardness instead increases by 1".
    expect(statsOf(champ('steel-shield', 3, 6))).toEqual([13, 128, 64]);
  });

  it('a shield already standing at the tier’s printed maxima gets the +1 and nothing else', () => {
    // bug 2026-09-15: shield runes
    // Sturdy Shield (Supreme) at 19th: the rune can add nothing, so Hardness 20 → 21.
    expect(statsOf(champ('sturdy-shield-supreme', 19))).toEqual([21, 160, 80]);
  });

  it('without the record a plain shield is untouched', () => {
    // bug 2026-09-15: shield runes
    const plain = { ...build('champion', 19, { deityId: 'iomedae' }), inventory: holding('steel-shield').inventory };
    expect(statsOf(plain)).toEqual([5, 20, 10]);
  });
});

/* ---------------------------------------------------------------------------------------------
 * Etching: what a shield may and may not take, and whether the refusal says why.
 * --------------------------------------------------------------------------------------------- */

const invOf = (itemId: string, extra: Partial<InventoryItem> = {}): InventoryItem =>
  ({ instanceId: 'inst-' + itemId, itemId, quantity: 1, ...extra }) as InventoryItem;
const plan = (runeId: string, hostId: string, hostRunes?: InventoryItem['runes']) =>
  planAttach(db.items[runeId], invOf(runeId), db.items[hostId], invOf(hostId, { runes: hostRunes }), [], db);

describe('a shield takes a reinforcing rune and nothing else', () => {
  it('armor potency on a shield is refused WITH the printed rule', () => {
    // bug 2026-09-15: shield runes
    const r = plan('armor-potency-1', 'steel-shield');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/only a reinforcing rune/i);
      expect(r.reason).toMatch(/GM Core p\. 224/);
      expect(r.reason).toContain('Steel Shield');
    }
  });

  it('resilient and property runes are refused by the same rule', () => {
    // bug 2026-09-15: shield runes
    for (const runeId of ['resilient', 'flaming']) {
      const r = plan(runeId, 'steel-shield');
      expect(r.ok, runeId).toBe(false);
      if (!r.ok) expect(r.reason, runeId).toMatch(/only a reinforcing rune \(GM Core p\. 224\)/i);
    }
  });

  it('a reinforcing rune IS accepted, and etching records the tier', () => {
    // bug 2026-09-15: shield runes
    const r = plan('reinforcing-rune-minor', 'steel-shield');
    expect(r.ok).toBe(true);
    if (r.ok && r.action === 'etch') {
      expect(r.runes.reinforcing).toBe(1);
      expect(r.consume).toBe(true);
    }
  });

  it('upgrading REPLACES the rune rather than stacking a second one', () => {
    // bug 2026-09-15: shield runes
    const r = plan('reinforcing-rune-lesser', 'steel-shield', { reinforcing: 1 } as InventoryItem['runes']);
    expect(r.ok).toBe(true);
    if (r.ok && r.action === 'etch') expect(r.runes.reinforcing).toBe(2);
  });

  it('the same tier twice is refused — one reinforcing rune only', () => {
    // bug 2026-09-15: shield runes
    const r = plan('reinforcing-rune-lesser', 'steel-shield', { reinforcing: 2 } as InventoryItem['runes']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already has that reinforcing rune/i);
  });

  it('a SPECIFIC shield can still gain its fundamental rune (GM Core p. 225)', () => {
    // bug 2026-09-15: shield runes
    // "Specific armor, weapons and shields can't gain property runes, but you can add or improve
    // their fundamental runes." A Spellguard Shield is a specific shield.
    expect(db.items['spellguard-shield'].itemType).toBe('shield');
    const ok = plan('reinforcing-rune-moderate', 'spellguard-shield');
    expect(ok.ok).toBe(true);
    const no = plan('flaming', 'spellguard-shield');
    expect(no.ok).toBe(false);
  });

  it('shield spikes and a shield boss are WEAPONS and take weapon runes', () => {
    // bug 2026-09-15: shield runes
    for (const hostId of ['shield-spikes', 'shield-boss']) {
      expect(db.items[hostId].itemType, hostId).toBe('weapon');
      const potency = plan('weapon-potency-1', hostId);
      expect(potency.ok, hostId).toBe(true);
      const striking = plan('striking', hostId);
      expect(striking.ok, hostId).toBe(true);
      // …and NOT a reinforcing rune: they are weapons, not the shield.
      expect(plan('reinforcing-rune-minor', hostId).ok, hostId).toBe(false);
    }
  });
});
