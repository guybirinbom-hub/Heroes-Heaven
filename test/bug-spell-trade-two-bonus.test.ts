// Guy's bug, 2026-11-13 (found by the Spell Blending window design): an out-of-date stored trade let a second
// trade to the same bonus rank in, so once the old trade's slots came back (a Ring of Wizardry invested again,
// a level regained) the wizard had TWO bonus slots of one rank. Spell Blending: "each bonus spell slot must be
// of a different spell rank". addSpellTrade now replaces such a stored trade instead of keeping both.
// Made-up wizard only (test/_content's generated character).
import { describe, expect, it } from 'vitest';
import { build as buildClass, content as loadContent } from './_content';
import type { BuildState } from '../src/rules/build';
import {
  CANTRIP_TRADE, addSpellTrade, applyPlayState, bonusSlotKey, emptyPlay, entryTrades, removeSpellTrade, spellTradeError,
  untradedIndices, type PlayState,
} from '../src/rules/play';

const db = loadContent();
const wizard = buildClass('wizard', 10, { extraChoices: { thesis: ['spell-blending'] } } as Partial<BuildState>);
const view = (p: PlayState) => applyPlayState(wizard, p, db).spellcasting.find((x) => x.type === 'prepared')!;
const id = view(emptyPlay()).id;
const pairs = (p: PlayState) => (p.spellTrades?.[id] ?? []).map((t) => `${t.from}>${t.to}`).sort();

/** A rank 1 → 3 trade naming slots the wizard doesn't have today: stored, not in force, a spell in its bonus slot. */
const stale: PlayState = {
  ...emptyPlay(),
  spellTrades: { [id]: [{ from: 1, to: 3, indices: [40, 41] }] },
  preparedSpells: { [bonusSlotKey(id, 3, 1)]: 'fireball' },
};

describe('Spell Blending: an out-of-date trade never leads to two bonus slots of one rank', () => {
  it('the stale trade is not in force, so the rules allow a new rank 3 trade', () => {
    const e = view(stale);
    expect(entryTrades(e).some((t) => t.to === 3)).toBe(false);
    expect(spellTradeError(e, 2, 3)).toBeNull();
  });

  it('the new trade REPLACES the stale one: one rank 3 trade stored, and the old bonus slot\'s spell and spent pip go with it', () => {
    const spent: PlayState = { ...stale, expendedSlots: { ...stale.expendedSlots, [bonusSlotKey(id, 3, 1)]: true } };
    const next = addSpellTrade(spent, view(spent), 2, 3);
    expect(pairs(next)).toEqual(['2>3']);
    expect(next.preparedSpells?.[bonusSlotKey(id, 3, 1)]).toBeUndefined();
    expect(next.expendedSlots?.[bonusSlotKey(id, 3, 1)]).toBeUndefined();
    expect(entryTrades(view(next)).filter((t) => t.to === 3)).toHaveLength(1);
  });

  it('a trade in force, and the spell in its bonus slot, survive; only the out-of-date one goes', () => {
    const live = addSpellTrade(emptyPlay(), view(emptyPlay()), 1, 2);
    const p: PlayState = {
      ...live,
      spellTrades: { [id]: [...live.spellTrades![id], { from: 1, to: 3, indices: [40, 41] }] },
      preparedSpells: { ...live.preparedSpells, [bonusSlotKey(id, 2, 1)]: 'blur', [bonusSlotKey(id, 3, 1)]: 'fireball' },
    };
    const next = addSpellTrade(p, view(p), 2, 3);
    expect(pairs(next)).toEqual(['1>2', '2>3']);
    expect(next.preparedSpells![bonusSlotKey(id, 2, 1)]).toBe('blur');
    expect(next.preparedSpells![bonusSlotKey(id, 3, 1)]).toBeUndefined();
    expect(entryTrades(view(next)).map((t) => `${t.from}>${t.to}`).sort()).toEqual(['1>2', '2>3']);
  });

  it('an out-of-date trade to an unrelated rank, naming other slots, is kept untouched', () => {
    const p: PlayState = { ...emptyPlay(), spellTrades: { [id]: [{ from: 4, to: 6, indices: [40, 41] }] } };
    const next = addSpellTrade(p, view(p), 2, 3);
    expect(pairs(next)).toEqual(['2>3', '4>6']);
  });

  it('an out-of-date trade naming the same slots goes; so does an out-of-date cantrip trade', () => {
    const idx = untradedIndices(view(emptyPlay()), 2).slice(-2);
    const sameSlots: PlayState = { ...emptyPlay(), spellTrades: { [id]: [{ from: 2, to: 9, indices: idx }] } };
    expect(entryTrades(view(sameSlots))).toHaveLength(0); // rank 9: not in force at level 10
    expect(pairs(addSpellTrade(sameSlots, view(sameSlots), 2, 3))).toEqual(['2>3']);
    const cantrips: PlayState = { ...emptyPlay(), spellTrades: { [id]: [{ from: 1, to: CANTRIP_TRADE, indices: [40] }] } };
    expect(entryTrades(view(cantrips))).toHaveLength(0);
    const b = addSpellTrade(cantrips, view(cantrips), 2, CANTRIP_TRADE);
    expect(b.spellTrades![id].filter((t) => t.to === CANTRIP_TRADE)).toEqual([expect.objectContaining({ from: 2 })]);
  });

  it('the rules still refuse a second bonus slot of a rank in force, and Undo still removes a trade', () => {
    const p = addSpellTrade(emptyPlay(), view(emptyPlay()), 1, 3);
    expect(addSpellTrade(p, view(p), 2, 3)).toBe(p);
    expect(entryTrades(view(removeSpellTrade(p, id, 3)))).toHaveLength(0);
  });
});
