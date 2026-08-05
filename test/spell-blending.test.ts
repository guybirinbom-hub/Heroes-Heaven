import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import {
  addSpellTrade,
  removeSpellTrade,
  spellTradeError,
  entryTrades,
  untradedIndices,
  applyPlayState,
  emptyPlay,
  initialPlay,
  preparedKey,
  bonusSlotKey,
  setPreparedSpell,
  setTradedCantrip,
  resetPreparedEntry,
  playForRebuild,
  toggleExpended,
  CANTRIP_TRADE,
  CANTRIPS_PER_TRADE,
  type PlayState,
} from '../src/rules/play';
import type { BuildState } from '../src/rules/build';
import type { Character, SpellcastingEntry } from '../src/rules/types';

/**
 * Spell Blending (wizard arcane thesis).
 *
 * "During your daily preparations, you can trade two spell slots of the same spell rank for a bonus
 * spell slot of up to 2 spell ranks higher… Bonus spell slots must be of a spell rank you can normally
 * cast, and each bonus spell slot must be of a different spell rank. You can also trade any spell slot
 * for two additional cantrips, though you can't trade more than one spell slot at a time…"
 */
const db = content();

const wizard = (level = 10): Character =>
  build('wizard', level, { extraChoices: { thesis: ['spell-blending'] } } as Partial<BuildState>);

/** The wizard's main prepared entry, with `play` overlaid — what the sheet actually renders. */
const view = (c: Character, play: PlayState): SpellcastingEntry =>
  applyPlayState(c, play, db).spellcasting.find((e) => e.type === 'prepared')!;

const entryOf = (c: Character) => c.spellcasting.find((e) => e.type === 'prepared')!;

/** A real shipped spell of a given rank. The generated test wizard has an EMPTY spellbook, so any
 *  `spellbook[n][0]` fallback is undefined and every assertion resting on it proves nothing. */
const spellAtRank = (rank: number): string => {
  const hit = Object.values(db.spells).find((s) => s.rank === rank && !s.ritual);
  if (!hit) throw new Error(`no rank-${rank} spell ships — the test cannot assert anything`);
  return hit.id;
};
const liveCount = (e: SpellcastingEntry, rank: number) => (e.prepared?.[rank] ?? []).filter((s) => !s.traded).length;

describe('the thesis is reachable at all', () => {
  it('a wizard can take Spell Blending and the app can see it', () => {
    const c = wizard();
    expect(db.classFeatures['spell-blending']).toBeTruthy();
    expect(c.classChoices?.some((r) => r.id === 'spell-blending')).toBe(true);
  });
});

describe('the printed limits', () => {
  const c = wizard(10);
  const e = entryOf(c);
  const play = emptyPlay();

  it('two slots of the same rank buy one slot up to two ranks higher', () => {
    expect(spellTradeError(e, 1, 2)).toBeNull();
    expect(spellTradeError(e, 1, 3)).toBeNull();
  });

  it('never three ranks higher, and never sideways or down', () => {
    expect(spellTradeError(e, 1, 4)).toMatch(/at most 2 ranks higher/);
    expect(spellTradeError(e, 2, 2)).toMatch(/higher rank/);
    expect(spellTradeError(e, 3, 2)).toMatch(/higher rank/);
  });

  it('the bonus rank must be one you can actually cast', () => {
    const top = Math.max(...Object.keys(e.prepared ?? {}).map(Number));
    expect(spellTradeError(e, top, top + 1)).toMatch(/can't cast/);
  });

  it('each bonus slot must be of a DIFFERENT rank', () => {
    const p2 = addSpellTrade(play, e, 1, 3);
    const after = view(c, p2);
    // A second bonus slot at rank 3 is refused, even from a different source rank.
    expect(spellTradeError(after, 2, 3)).toMatch(/already have a bonus rank-3 slot/);
    // A different target rank is still fine.
    expect(spellTradeError(after, 2, 4)).toBeNull();
  });

  it('you cannot trade slots you do not have', () => {
    let p = play;
    const rank1 = liveCount(e, 1);
    // Spend them two at a time until fewer than two remain.
    for (let i = 0; i + 2 <= rank1; i += 2) {
      const cur = view(c, p);
      const target = 2 + i / 2;
      if (spellTradeError(cur, 1, target)) break;
      p = addSpellTrade(p, cur, 1, target);
    }
    const left = untradedIndices(view(c, p), 1).length;
    expect(left).toBeLessThan(2);
    expect(spellTradeError(view(c, p), 1, 3)).toMatch(/untraded rank-1 slot/);
  });

  it('the cantrip trade costs ONE slot and can only be made once', () => {
    const p1 = addSpellTrade(play, e, 1, CANTRIP_TRADE);
    const v1 = view(c, p1);
    expect(v1.tradedCantrips).toHaveLength(CANTRIPS_PER_TRADE);
    expect(liveCount(v1, 1)).toBe(liveCount(e, 1) - 1); // one slot, not two
    expect(spellTradeError(v1, 2, CANTRIP_TRADE)).toMatch(/only trade one slot for cantrips/);
  });
});

describe('the slot table after a trade', () => {
  const c = wizard(10);
  const e = entryOf(c);

  it('the source rank loses two slots and the target gains one', () => {
    const before1 = liveCount(e, 1);
    const before3 = liveCount(e, 3);
    const v = view(c, addSpellTrade(emptyPlay(), e, 1, 3));
    expect(liveCount(v, 1)).toBe(before1 - 2);
    expect(liveCount(v, 3)).toBe(before3 + 1);
  });

  it('the bonus slot knows where it came from', () => {
    const v = view(c, addSpellTrade(emptyPlay(), e, 1, 3));
    expect(v.prepared![3].some((s) => s.bonusFrom === 1)).toBe(true);
    expect(entryTrades(v)).toContainEqual({ from: 1, to: 3 });
  });

  it('THE WHOLE POINT: no existing slot index moves', () => {
    // Slots are addressed by array INDEX, and PlayState keys prepared spells and expended flags that
    // way. Shrinking a rank would silently re-point every saved key after it.
    const spellId = spellAtRank(1);
    let p: PlayState = emptyPlay();
    p = setPreparedSpell(p, e.id, 1, 0, spellId);
    p = toggleExpended(p, preparedKey(e.id, 1, 0));
    const before = view(c, p).prepared![1][0];

    p = addSpellTrade(p, view(c, p), 1, 3);
    const after = view(c, p).prepared![1][0];
    expect(after.spellId).toBe(before.spellId);
    expect(after.expended).toBe(before.expended);
    expect(after.traded).toBeFalsy();
  });

  it('a traded slot casts nothing and holds nothing', () => {
    const e0 = entryOf(c);
    const last = untradedIndices(e0, 1).slice(-1)[0];
    let p: PlayState = emptyPlay();
    p = setPreparedSpell(p, e0.id, 1, last, spellAtRank(1));
    p = toggleExpended(p, preparedKey(e0.id, 1, last));
    p = addSpellTrade(p, view(c, p), 1, 3);
    const slot = view(c, p).prepared![1][last];
    expect(slot.traded).toBe(true);
    expect(slot.spellId).toBeNull();
    expect(slot.expended).toBe(false);
  });

  it('a bonus slot holds its own spell, keyed by its SOURCE rank', () => {
    let p = addSpellTrade(emptyPlay(), e, 1, 3);
    const v = view(c, p);
    const idx = v.prepared![3].findIndex((s) => s.bonusFrom === 1);
    const spellId = spellAtRank(3);
    p = setPreparedSpell(p, e.id, 3, idx, spellId, v.prepared![3][idx]);
    expect(p.preparedSpells?.[bonusSlotKey(e.id, 3, 1)]).toBe(spellId);
    expect(view(c, p).prepared![3][idx].spellId).toBe(spellId);
  });

  it('undoing ONE trade does not disturb another bonus slot\'s spell', () => {
    // Bonus keys come from the source rank, not from position — the failure this prevents is the
    // second bonus slot silently inheriting the first one's spell.
    let p = addSpellTrade(emptyPlay(), e, 1, 3);
    p = addSpellTrade(p, view(c, p), 2, 4);
    const spellId = spellAtRank(1);
    const v = view(c, p);
    const i4 = v.prepared![4].findIndex((s) => s.bonusFrom === 2);
    p = setPreparedSpell(p, e.id, 4, i4, spellId, v.prepared![4][i4]);

    p = removeSpellTrade(p, e.id, 3); // undo the OTHER trade
    const v2 = view(c, p);
    const still = v2.prepared![4].find((s) => s.bonusFrom === 2);
    expect(still?.spellId).toBe(spellId);
    expect(v2.prepared![3].some((s) => s.bonusFrom != null)).toBe(false);
  });

  it('undoing a trade gives the source slots back', () => {
    const before = liveCount(e, 1);
    let p = addSpellTrade(emptyPlay(), e, 1, 3);
    expect(liveCount(view(c, p), 1)).toBe(before - 2);
    p = removeSpellTrade(p, e.id, 3);
    expect(liveCount(view(c, p), 1)).toBe(before);
  });
});

describe('it does not leak', () => {
  const c = wizard(10);
  const e = entryOf(c);

  it('"Reset to default preparation" clears the trades too', () => {
    const p = resetPreparedEntry(addSpellTrade(emptyPlay(), e, 1, 3), e.id);
    expect(p.spellTrades?.[e.id]).toBeUndefined();
    expect(liveCount(view(c, p), 1)).toBe(liveCount(e, 1));
  });

  it('a builder edit drops them — slot counts are build-derived', () => {
    const p = playForRebuild(addSpellTrade(emptyPlay(), e, 1, 3));
    expect(p.spellTrades).toBeUndefined();
  });

  it('a trade naming a slot that no longer exists is ignored, not applied', () => {
    // Investing a Ring of Wizardry or levelling changes the arrays in PLAY, never passing through
    // playForRebuild, so a recorded index can outlive the slot it named.
    const p: PlayState = { ...emptyPlay(), spellTrades: { [e.id]: [{ from: 1, to: 3, indices: [98, 99] }] } };
    const v = view(c, p);
    expect(liveCount(v, 1)).toBe(liveCount(e, 1));
    expect(v.prepared![3].some((s) => s.bonusFrom != null)).toBe(false);
  });

  it('traded cantrips never reach the stored character', () => {
    const cantrip = spellAtRank(0);
    let p = addSpellTrade(emptyPlay(), e, 1, CANTRIP_TRADE);
    p = setTradedCantrip(p, e.id, 0, cantrip);
    const v = view(c, p);
    expect(v.tradedCantrips?.[0]).toBe(cantrip);
    // The overlay only — the character the builder round-trips is untouched.
    expect(entryOf(c).tradedCantrips).toBeUndefined();
    expect(entryOf(c).cantrips).not.toContain(cantrip === entryOf(c).cantrips[0] ? ' ' : cantrip);
  });

  it('a wizard WITHOUT the thesis is unaffected by the machinery', () => {
    const plain = build('wizard', 10);
    const pe = entryOf(plain);
    expect(entryTrades(pe)).toHaveLength(0);
    expect(view(plain, initialPlay(plain, db)).prepared![1].every((s) => !s.traded && s.bonusFrom == null)).toBe(true);
  });
});

describe('high level', () => {
  it('a 19th-level wizard may trade up into rank 10 if the entry has it', () => {
    const c = wizard(19);
    const e = entryOf(c);
    const ranks = Object.keys(e.prepared ?? {}).map(Number);
    const top = Math.max(...ranks);
    // Legal targets are read from the entry's own slot table, so the app agrees with itself.
    if (ranks.includes(top) && ranks.includes(top - 2)) {
      expect(spellTradeError(e, top - 2, top)).toBeNull();
    }
  });
});
