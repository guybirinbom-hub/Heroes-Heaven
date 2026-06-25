import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { deriveMaxHp } from '../src/rules/derive';
import {
  emptyPlay,
  initialPlay,
  applyPlayState,
  applyDamage,
  applyHeal,
  setHeroPoints,
  setTempHp,
  addXp,
  toggleExpended,
  toggleInnateCast,
  setSlotsUsed,
  setFocusUsed,
  addCondition,
  removeCondition,
  setConditionValue,
  addInventoryItem,
  removeInventoryItem,
  setItemQuantity,
  toggleItemFlag,
  setCurrency,
  canAfford,
  buyItem,
  togglePin,
  toggleTactic,
  addNotePage,
  removeNotePage,
  updateNotePage,
  addCompanionCondition,
  removeCompanionCondition,
  setCompanionConditionValue,
  preparedKey,
  poolKey,
  rest,
  MAX_HERO_POINTS,
  type PlayState,
} from '../src/rules/play';

const c = content();
const ch = build('fighter', 5); // a built, full-HP character
const max = deriveMaxHp(ch, c);

describe('emptyPlay / initialPlay', () => {
  it('emptyPlay is an undamaged day with one hero point and no spent resources', () => {
    expect(emptyPlay()).toEqual({
      damage: 0,
      tempHp: 0,
      heroPoints: 1,
      xp: 0,
      focusUsed: 0,
      expendedSlots: {},
      slotsUsed: {},
      conditions: [],
      pinned: [],
    });
  });
  it('initialPlay seeds from the built character (full HP → no damage, full focus)', () => {
    const p = initialPlay(ch, c);
    expect(p.damage).toBe(0);
    expect(p.heroPoints).toBe(ch.heroPoints);
    expect(p.xp).toBe(ch.xp);
    expect(p.focusUsed).toBe(0);
  });
});

describe('damage and healing', () => {
  it('temp HP soaks damage first, the rest becomes real damage', () => {
    const p: PlayState = { damage: 0, tempHp: 5, heroPoints: 1, xp: 0 };
    const after = applyDamage(p, 8, max);
    expect(after.tempHp).toBe(0);
    expect(after.damage).toBe(3);
  });
  it('partial damage only eats temp HP', () => {
    const after = applyDamage({ damage: 0, tempHp: 5, heroPoints: 1, xp: 0 }, 3, max);
    expect(after.tempHp).toBe(2);
    expect(after.damage).toBe(0);
  });
  it('damage never exceeds max HP', () => {
    const after = applyDamage({ damage: 0, tempHp: 0, heroPoints: 1, xp: 0 }, max + 999, max);
    expect(after.damage).toBe(max);
  });
  it('healing reduces damage and never goes below zero', () => {
    expect(applyHeal({ damage: 10, tempHp: 0, heroPoints: 1, xp: 0 }, 4, max).damage).toBe(6);
    expect(applyHeal({ damage: 10, tempHp: 0, heroPoints: 1, xp: 0 }, 50, max).damage).toBe(0);
  });
});

describe('hero points, temp, xp', () => {
  it('hero points clamp to [0, MAX]', () => {
    expect(setHeroPoints(emptyPlay(), 9).heroPoints).toBe(MAX_HERO_POINTS);
    expect(setHeroPoints(emptyPlay(), -2).heroPoints).toBe(0);
  });
  it('temp HP is never negative', () => {
    expect(setTempHp(emptyPlay(), -3).tempHp).toBe(0);
    expect(setTempHp(emptyPlay(), 7).tempHp).toBe(7);
  });
  it('XP adds and never goes negative', () => {
    expect(addXp({ ...emptyPlay(), xp: 100 }, 30).xp).toBe(130);
    expect(addXp({ ...emptyPlay(), xp: 10 }, -50).xp).toBe(0);
  });
});

describe('spell slots and focus', () => {
  const fcaster = build('cleric', 5); // prepared divine caster with a focus pool
  const fmax = fcaster.focus?.max ?? 0;

  it('toggleExpended flips a prepared slot on and back off', () => {
    const key = preparedKey('divine', 1, 0);
    const once = toggleExpended(emptyPlay(), key);
    expect(once.expendedSlots[key]).toBe(true);
    expect(toggleExpended(once, key).expendedSlots[key]).toBeUndefined();
  });
  it('setSlotsUsed clamps a spontaneous pool to [0, max]', () => {
    const key = poolKey('arcane', 2);
    expect(setSlotsUsed(emptyPlay(), key, 9, 3).slotsUsed[key]).toBe(3);
    expect(setSlotsUsed(emptyPlay(), key, -1, 3).slotsUsed[key]).toBe(0);
  });
  it('setFocusUsed clamps to the focus pool and applyPlayState shows the spent points', () => {
    expect(setFocusUsed(emptyPlay(), 9, 1).focusUsed).toBe(1);
    if (fmax > 0) {
      const applied = applyPlayState(fcaster, { ...emptyPlay(), focusUsed: 1 }, c);
      expect(applied.focus?.current).toBe(fmax - 1);
    }
  });
  it('applyPlayState overlays an expended prepared slot onto the rendered entry', () => {
    const prep = fcaster.spellcasting.find((e) => e.prepared && Object.keys(e.prepared).length);
    if (prep) {
      const rank = Number(Object.keys(prep.prepared!)[0]);
      const key = preparedKey(prep.id, rank, 0);
      const applied = applyPlayState(fcaster, { ...emptyPlay(), expendedSlots: { [key]: true } }, c);
      const overlaid = applied.spellcasting.find((e) => e.id === prep.id);
      expect(overlaid?.prepared?.[rank][0].expended).toBe(true);
    }
  });
});

describe('conditions', () => {
  it('addCondition adds once; a second add is a no-op', () => {
    const once = addCondition(emptyPlay(), 'frightened', 1);
    expect(once.conditions).toEqual([{ id: 'frightened', value: 1 }]);
    expect(addCondition(once, 'frightened', 1).conditions).toHaveLength(1);
  });
  it('an unvalued condition has no value', () => {
    expect(addCondition(emptyPlay(), 'blinded').conditions).toEqual([{ id: 'blinded' }]);
  });
  it('setConditionValue changes the value; 0 removes it', () => {
    const p = addCondition(emptyPlay(), 'frightened', 2);
    expect(setConditionValue(p, 'frightened', 3).conditions[0].value).toBe(3);
    expect(setConditionValue(p, 'frightened', 0).conditions).toEqual([]);
  });
  it('removeCondition is a plain removal — no Dying→Wounded bump (recovery is applyHeal-only)', () => {
    // Manually removing Dying (modal X, pip to 0) must not add Wounded; only being healed
    // to 1+ HP counts as recovery — see dying-automation.test.ts.
    const dying = addCondition(emptyPlay(), 'dying', 1);
    expect(removeCondition(dying, 'dying').conditions).toEqual([]);
    const both = addCondition(addCondition(emptyPlay(), 'wounded', 1), 'dying', 1);
    expect(removeCondition(both, 'dying').conditions).toEqual([{ id: 'wounded', value: 1 }]);
  });
  it('applyPlayState overlays the play conditions onto the character', () => {
    const applied = applyPlayState(ch, { ...emptyPlay(), conditions: [{ id: 'frightened', value: 2 }] }, c);
    expect(applied.conditions).toEqual([{ id: 'frightened', value: 2 }]);
  });
});

describe('inventory', () => {
  it('addInventoryItem appends with quantity 1 and a fresh, non-colliding instanceId', () => {
    let p = addInventoryItem(emptyPlay(), 'longsword');
    p = addInventoryItem(p, 'dagger');
    expect(p.inventory).toHaveLength(2);
    expect(p.inventory![0]).toMatchObject({ itemId: 'longsword', quantity: 1 });
    expect(new Set(p.inventory!.map((i) => i.instanceId)).size).toBe(2);
  });
  it('setItemQuantity floors at 1; toggleItemFlag flips; removeInventoryItem drops', () => {
    let p = addInventoryItem(emptyPlay(), 'longsword');
    const id = p.inventory![0].instanceId;
    expect(setItemQuantity(p, id, 5).inventory![0].quantity).toBe(5);
    expect(setItemQuantity(p, id, 0).inventory![0].quantity).toBe(1);
    p = toggleItemFlag(p, id, 'equipped');
    expect(p.inventory![0].equipped).toBe(true);
    expect(toggleItemFlag(p, id, 'equipped').inventory![0].equipped).toBe(false);
    expect(removeInventoryItem(p, id).inventory).toEqual([]);
  });
  it('applyPlayState overlays the play inventory and wallet onto the character', () => {
    const play: PlayState = {
      ...emptyPlay(),
      inventory: [{ instanceId: 'x', itemId: 'longsword', quantity: 2, equipped: true }],
      currency: { gp: 7, sp: 5 },
    };
    const applied = applyPlayState(ch, play, c);
    expect(applied.inventory).toEqual(play.inventory);
    expect(applied.currency).toEqual({ gp: 7, sp: 5 });
  });
  it('setCurrency replaces the wallet', () => {
    expect(setCurrency(emptyPlay(), { pp: 1 }).currency).toEqual({ pp: 1 });
  });

  it('togglePin adds then removes an activity key', () => {
    const pinned = togglePin(emptyPlay(), 'strike:inv-0');
    expect(pinned.pinned).toEqual(['strike:inv-0']);
    expect(togglePin(pinned, 'strike:inv-0').pinned).toEqual([]);
  });

  it('companion conditions are tracked per companion id; manual removal is plain', () => {
    let p = addCompanionCondition(emptyPlay(), 'wolf-1', 'frightened', 2);
    expect(p.companionConditions!['wolf-1']).toEqual([{ id: 'frightened', value: 2 }]);
    p = addCompanionCondition(p, 'eidolon-1', 'dying', 1);
    // Manually removing Dying is a plain removal — no Wounded bump (recovery is heal-only).
    expect(removeCompanionCondition(p, 'eidolon-1', 'dying').companionConditions!['eidolon-1']).toEqual([]);
    expect(setCompanionConditionValue(p, 'wolf-1', 'frightened', 0).companionConditions!['wolf-1']).toEqual([]);
    // distinct companions don't bleed into each other
    expect(p.companionConditions!['wolf-1']).toEqual([{ id: 'frightened', value: 2 }]);
  });

  it('notes pages: add (fresh id), update (merge patch), remove', () => {
    let p = { ...emptyPlay(), notes: [] };
    p = addNotePage(p);
    p = addNotePage(p);
    expect(p.notes).toHaveLength(2);
    expect(new Set(p.notes!.map((n) => n.id)).size).toBe(2);
    const id = p.notes![0].id;
    p = updateNotePage(p, id, { title: 'Quests', content: '<p>hi</p>', private: true });
    expect(p.notes![0]).toMatchObject({ title: 'Quests', content: '<p>hi</p>', private: true });
    p = removeNotePage(p, id);
    expect(p.notes!.find((n) => n.id === id)).toBeUndefined();
    expect(p.notes).toHaveLength(1);
  });

  it('canAfford compares wallet to price (free is always affordable)', () => {
    expect(canAfford({ gp: 5 }, { gp: 3 })).toBe(true);
    expect(canAfford({ gp: 5 }, { gp: 6 })).toBe(false);
    expect(canAfford({ sp: 5 }, undefined)).toBe(true);
    expect(canAfford({ gp: 1 }, { sp: 5 })).toBe(true); // 100cp >= 50cp
  });

  it('buyItem deducts the price and adds the item; unaffordable is a no-op', () => {
    const start: PlayState = { ...emptyPlay(), currency: { gp: 10 }, inventory: [] };
    const bought = buyItem(start, 'longsword', { gp: 1 });
    expect(bought.inventory).toHaveLength(1);
    expect(bought.currency).toEqual({ gp: 9 });
    const broke = buyItem({ ...emptyPlay(), currency: { sp: 2 }, inventory: [] }, 'longsword', { gp: 1 });
    expect(broke.inventory).toEqual([]);
    expect(broke.currency).toEqual({ sp: 2 });
  });
});

describe('rest', () => {
  it('recovers Con×level HP (not full), refreshes focus/slots, keeps XP & hero points', () => {
    const p: PlayState = {
      damage: 12,
      tempHp: 4,
      heroPoints: 0,
      xp: 250,
      focusUsed: 2,
      expendedSlots: { 'divine:1:0': true },
      slotsUsed: { 'arcane:2': 3 },
      conditions: [{ id: 'doomed', value: 1 }],
      pinned: [],
    };
    expect(rest(p, { level: 5, conMod: 2 })).toEqual({
      damage: 2, // 12 − (5 × 2)
      tempHp: 0,
      heroPoints: 0, // session-based, untouched
      xp: 250,
      focusUsed: 0,
      expendedSlots: {},
      slotsUsed: {},
      innateUsed: {}, // 1/day innate spells refill on rest
      conditions: [], // doomed 1 → stepped down to 0 → cleared
      pinned: [],
    });
  });
});

describe('applyPlayState overlay', () => {
  it('overlays current HP (= max − damage), temp, hero points, and XP onto the snapshot', () => {
    const applied = applyPlayState(ch, { damage: 10, tempHp: 4, heroPoints: 2, xp: 120 }, c);
    expect(applied.hitPoints.current).toBe(max - 10);
    expect(applied.hitPoints.temp).toBe(4);
    expect(applied.heroPoints).toBe(2);
    expect(applied.xp).toBe(120);
  });
  it('clamps an over-large damage to 0 current and over-large hero points to MAX', () => {
    const applied = applyPlayState(ch, { damage: max + 50, tempHp: 0, heroPoints: 99, xp: 0 }, c);
    expect(applied.hitPoints.current).toBe(0);
    expect(applied.heroPoints).toBe(MAX_HERO_POINTS);
  });
  it('returns the character unchanged when there is no play state', () => {
    expect(applyPlayState(ch, undefined, c)).toBe(ch);
  });
});

describe('commander prepared tactics (play-mode)', () => {
  const cmdr = build('commander', 7, { commanderTactics: ['pincer-attack', 'reload', 'strike-hard', 'double-team'] });

  it('toggleTactic prepares/unprepares, capped at preparedMax', () => {
    let p: PlayState = emptyPlay();
    p = toggleTactic(p, 'pincer-attack', 3);
    p = toggleTactic(p, 'reload', 3);
    p = toggleTactic(p, 'strike-hard', 3);
    expect(p.preparedTactics).toEqual(['pincer-attack', 'reload', 'strike-hard']);
    // A 4th prepare is ignored (at capacity)…
    p = toggleTactic(p, 'double-team', 3);
    expect(p.preparedTactics).toEqual(['pincer-attack', 'reload', 'strike-hard']);
    // …until one is unprepared, freeing a slot.
    p = toggleTactic(p, 'reload', 3);
    expect(p.preparedTactics).toEqual(['pincer-attack', 'strike-hard']);
    p = toggleTactic(p, 'double-team', 3);
    expect(p.preparedTactics).toContain('double-team');
  });

  it('applyPlayState overlays prepared tactics (only folio members, clamped)', () => {
    const p: PlayState = {
      ...emptyPlay(),
      preparedTactics: ['pincer-attack', 'reload', 'not-in-folio', 'strike-hard', 'double-team'],
    };
    const applied = applyPlayState(cmdr, p, c);
    const prepared = applied.commanderTactics?.prepared ?? [];
    expect(prepared).not.toContain('not-in-folio'); // non-folio ids dropped
    expect(prepared.length).toBe(3); // clamped to preparedMax
    expect(prepared).toEqual(['pincer-attack', 'reload', 'strike-hard']);
  });
});

describe('innate-spell per-day use tracking (3b)', () => {
  const db = content();

  it('toggleInnateCast flips a 1/day innate spell used/available', () => {
    const p = emptyPlay();
    const cast = toggleInnateCast(p, 'inn', 's1');
    expect(cast.innateUsed?.['inn:s1']).toBe(true);
    expect(toggleInnateCast(cast, 'inn', 's1').innateUsed?.['inn:s1']).toBeUndefined();
  });

  it('applyPlayState overlays used spell ids onto the innate entry; rest refills', () => {
    const base = build('fighter', 5, { keyAbility: 'str' });
    const ch = {
      ...base,
      spellcasting: [
        { id: 'inn', name: 'Innate', type: 'innate' as const, tradition: 'arcane' as const, keyAbility: 'cha' as const, proficiency: 'trained' as const, cantrips: [], repertoire: { 1: ['s1', 's2'] } },
      ],
    };
    const play = { ...initialPlay(ch, db), innateUsed: { 'inn:s1': true } };
    const live = applyPlayState(ch, play, db);
    expect(live.spellcasting[0].innateUsed).toEqual(['s1']); // s1 cast, s2 still available
    expect(rest(play, { level: 5, conMod: 2 }).innateUsed).toEqual({}); // daily prep refills
  });
});
