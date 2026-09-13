import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { rest } from '../src/rules/play';
import { deriveMaxHp } from '../src/rules/derive';
import { companionConMod } from '../src/rules/companions';
import type { ActiveCondition, CompanionConfig, InventoryItem, PlayState } from '../src/rules/types';

/**
 * The Daily Preparations button against the printed rules (Player Core), audited 2026-09-13.
 *
 * `rest()` treated a night as the day's big reset: Wounded and Dying simply deleted, Drained stepped
 * down while quietly handing back the Hit Points it had been withholding, companions fully healed,
 * armour ignored, yesterday's infused items still on hand, and a session resource refilled. Each leg
 * below is one of those clauses, and each fails on the code as it was.
 */
const db = content();

const play = (over: Partial<PlayState> = {}): PlayState =>
  ({ damage: 0, tempHp: 0, heroPoints: 0, xp: 0, focusUsed: 0, expendedSlots: {}, slotsUsed: {}, conditions: [], pinned: [], inventory: [], ...over }) as PlayState;

/** Level 5, Con +2 — a night heals 10 Hit Points. */
const OPTS = { level: 5, conMod: 2 };

const valOf = (list: ActiveCondition[] | undefined, id: string) => list?.find((c) => c.id === id)?.value;
const has = (list: ActiveCondition[] | undefined, id: string) => !!list?.some((c) => c.id === id);
const row = (itemId: string, worn: boolean): InventoryItem => ({ instanceId: `i-${itemId}`, itemId, quantity: 1, worn });
const cmp = (id: string, kind: CompanionConfig['kind'], typeId?: string): CompanionConfig => ({ id, kind, name: '', typeId });

describe('rest(): Wounded ends at full Hit Points, not at dawn (Player Core p. 447)', () => {
  it('keeps Wounded when the night did not reach full Hit Points', () => {
    // bug 2026-09-13: rest rules
    const after = rest(play({ damage: 100, conditions: [{ id: 'wounded', value: 2 }] }), OPTS);
    expect(after.damage).toBe(90);
    expect(valOf(after.conditions, 'wounded')).toBe(2);
  });

  it('clears Wounded when the night restores full Hit Points', () => {
    // bug 2026-09-13: rest rules
    const after = rest(play({ damage: 3, conditions: [{ id: 'wounded', value: 2 }] }), OPTS);
    expect(after.damage).toBe(0);
    expect(has(after.conditions, 'wounded')).toBe(false);
  });

  it("reads a companion's Wounded against ITS OWN post-rest Hit Points", () => {
    // bug 2026-09-13: rest rules
    const p = play({
      companions: [cmp('c1', 'animal'), cmp('c2', 'animal')],
      companionHp: { c1: { damage: 40, temp: 3 }, c2: { damage: 4, temp: 0 } },
      companionConditions: { c1: [{ id: 'wounded', value: 1 }], c2: [{ id: 'wounded', value: 1 }] },
    });
    const after = rest(p, { ...OPTS, companionHeal: { c1: 15, c2: 15 } });
    expect(after.companionHp!.c1.damage).toBe(25);
    expect(valOf(after.companionConditions!.c1, 'wounded')).toBe(1); // still hurt in the morning
    expect(has(after.companionConditions!.c2, 'wounded')).toBe(false); // woke at full
  });
});

describe('rest(): Drained returns maximum Hit Points, not current ones (Player Core p. 443)', () => {
  it('steps Drained down without healing the Hit Points it was withholding', () => {
    // bug 2026-09-13: rest rules
    const ch = build('fighter', 5);
    const drained2 = { ...ch, conditions: [{ id: 'drained', value: 2 }] as ActiveCondition[] };
    const maxBefore = deriveMaxHp(drained2, db);
    // Drained 2 at level 5 is a 10-point cut, which is the exact amount the step-down gives back.
    expect(deriveMaxHp({ ...ch, conditions: [] }, db) - maxBefore).toBe(10);

    const p = play({ damage: maxBefore - 10, conditions: [{ id: 'drained', value: 2 }] }); // current 10
    const after = rest(p, OPTS);
    const maxAfter = deriveMaxHp({ ...ch, conditions: after.conditions }, db);
    expect(valOf(after.conditions, 'drained')).toBe(1);
    expect(maxAfter).toBe(maxBefore + 5);
    // Current Hit Points: 10 + the night's own level × Con heal = 20. NOT 25 — the 5 points of
    // maximum the step-down returned are not healing.
    expect(maxAfter - after.damage).toBe(20);
  });

  it('adds one level of damage when Drained 1 goes away', () => {
    // bug 2026-09-13: rest rules
    const after = rest(play({ damage: 0, conditions: [{ id: 'drained', value: 1 }] }), OPTS);
    expect(has(after.conditions, 'drained')).toBe(false);
    expect(after.damage).toBe(5); // maximum grew by level; current Hit Points stayed put
  });

  it('adds two levels when Bolstered Recovery steps Drained twice', () => {
    // bug 2026-09-13: rest rules
    const opts = { ...OPTS, restRecovery: { hpMultiplier: 2, conditionSteps: 2 } };
    const after = rest(play({ damage: 30, conditions: [{ id: 'drained', value: 2 }] }), opts);
    expect(has(after.conditions, 'drained')).toBe(false);
    expect(after.damage).toBe(30 - 20 + 10); // heals 2 × (5 × 2), then 2 steps × level 5 come back as damage
  });

  it('moves CURRENT Hit Points by exactly the night’s heal, across every shape of Drained', () => {
    // bug 2026-09-13: rest rules
    // The invariant the whole clause exists for, measured through the app's OWN max-HP derivation
    // rather than by hand: whatever Drained does to the maximum, current Hit Points rise by level ×
    // Con and by nothing else. MUTATION PROOF: drop the compensation and every row here over-heals;
    // double it and every row under-heals.
    const conMod = 2;
    for (const { level, drained, steps, reduce } of [
      { level: 5, drained: 2, steps: 1, reduce: 0 },
      { level: 5, drained: 1, steps: 1, reduce: 0 },
      { level: 5, drained: 3, steps: 2, reduce: 0 },
      { level: 5, drained: 3, steps: 2, reduce: 1 },
      { level: 5, drained: 1, steps: 1, reduce: 1 },
      { level: 12, drained: 4, steps: 1, reduce: 0 },
      { level: 1, drained: 3, steps: 1, reduce: 0 },
    ]) {
      const base = { ...build('fighter', level), drainedReduction: reduce || undefined };
      const before: ActiveCondition[] = [{ id: 'drained', value: drained }];
      const maxBefore = deriveMaxHp({ ...base, conditions: before }, db);
      // Start hurt enough that the heal never clamps at 0 damage.
      const p = play({ damage: maxBefore - 1, conditions: before });
      const after = rest(p, { level, conMod, drainedReduction: reduce || undefined, restRecovery: { hpMultiplier: 1, conditionSteps: steps } });
      const currentAfter = deriveMaxHp({ ...base, conditions: after.conditions ?? [] }, db) - after.damage;
      expect(
        currentAfter - (maxBefore - p.damage),
        `level ${level}, drained ${drained}, ${steps} step(s), reduction ${reduce}`,
      ).toBe(level * conMod);
    }
  });

  it('gives nothing back for a Drained value the character never suffered', () => {
    // bug 2026-09-13: rest rules
    // Svetocher counts Drained "as though the condition value were 1 lower", so drained 1 cost this
    // character no maximum Hit Points and the step-down must not cost them current ones.
    const after = rest(play({ damage: 0, conditions: [{ id: 'drained', value: 1 }] }), { ...OPTS, drainedReduction: 1 });
    expect(after.damage).toBe(0);
  });
});

describe('rest(): losing Dying leaves Wounded behind (Player Core p. 447)', () => {
  it('ends Dying and writes Wounded 1', () => {
    // bug 2026-09-13: rest rules
    const after = rest(play({ damage: 100, conditions: [{ id: 'dying', value: 2 }] }), OPTS);
    expect(has(after.conditions, 'dying')).toBe(false);
    expect(valOf(after.conditions, 'wounded')).toBe(1);
  });

  it('raises an existing Wounded value instead of replacing it', () => {
    // bug 2026-09-13: rest rules
    const p = play({ damage: 100, conditions: [{ id: 'wounded', value: 1 }, { id: 'dying', value: 1 }] });
    const after = rest(p, OPTS);
    expect(valOf(after.conditions, 'wounded')).toBe(2);
    expect(after.conditions.filter((c) => c.id === 'wounded')).toHaveLength(1);
  });

  it('loses that Wounded again when the character wakes at full Hit Points', () => {
    // bug 2026-09-13: rest rules
    const after = rest(play({ damage: 3, conditions: [{ id: 'dying', value: 1 }] }), OPTS);
    expect(after.damage).toBe(0);
    expect(has(after.conditions, 'dying')).toBe(false);
    expect(has(after.conditions, 'wounded')).toBe(false);
  });
});

describe('rest(): sleeping in armour is poor rest (Player Core p. 439)', () => {
  const withItems = { ...OPTS, items: db.items };

  it('the data still says what the rule is read off', () => {
    // bug 2026-09-13: rest rules
    expect(db.items['hellknight-plate'].traits ?? []).not.toContain('comfort');
    expect(db.items['armored-coat'].traits ?? []).toContain('comfort');
    // Explorer's clothing is BOTH exceptions at once — clothes, and comfortable.
    const clothing = db.items['explorers-clothing'];
    expect(clothing.itemType === 'armor' && clothing.category).toBe('unarmored');
    expect(clothing.traits ?? []).toContain('comfort');
  });

  it('adds Fatigued when armour was worn overnight', () => {
    // bug 2026-09-13: rest rules
    const after = rest(play({ inventory: [row('hellknight-plate', true)] }), withItems);
    expect(has(after.conditions, 'fatigued')).toBe(true);
  });

  it('keeps a single Fatigued for a character who already had it', () => {
    // bug 2026-09-13: rest rules
    const p = play({ inventory: [row('hellknight-plate', true)], conditions: [{ id: 'fatigued' }] });
    expect(rest(p, withItems).conditions.filter((c) => c.id === 'fatigued')).toHaveLength(1);
  });

  it('does not fatigue for armour with the comfort trait', () => {
    // bug 2026-09-13: rest rules
    expect(has(rest(play({ inventory: [row('armored-coat', true)] }), withItems).conditions, 'fatigued')).toBe(false);
    expect(has(rest(play({ inventory: [row('explorers-clothing', true)] }), withItems).conditions, 'fatigued')).toBe(false);
  });

  it('does not fatigue for an Archives armour CATEGORY page — including the one called Unarmored', () => {
    // bug 2026-09-13: rest rules
    // 16 shipped armour records are category/material pages rather than suits — no category, no
    // price, no bulk, no AC bonus — and Add Items offers them like any other record (they are
    // neither retired nor superseded). MUTATION PROOF: test only `category !== 'unarmored'` and a
    // character wearing the thing literally named Unarmored wakes fatigued every morning.
    const bare = db.items['aon-unarmored'];
    expect(bare.itemType === 'armor' && bare.category).toBeUndefined();
    expect(has(rest(play({ inventory: [row('aon-unarmored', true)] }), withItems).conditions, 'fatigued')).toBe(false);
    expect(has(rest(play({ inventory: [row('aon-adamantine-armor', true)] }), withItems).conditions, 'fatigued')).toBe(false);
  });

  it('two suits worn leave ONE Fatigued, not two', () => {
    // bug 2026-09-13: rest rules
    const p = play({ inventory: [row('hellknight-plate', true), { ...row('half-plate', true), instanceId: 'i-2' }] });
    expect(rest(p, withItems).conditions.filter((c) => c.id === 'fatigued')).toHaveLength(1);
  });

  it('does not fatigue for armour that was carried rather than worn', () => {
    // bug 2026-09-13: rest rules
    expect(has(rest(play({ inventory: [row('hellknight-plate', false)] }), withItems).conditions, 'fatigued')).toBe(false);
  });

  it('still REMOVES Fatigued from a character who slept out of armour', () => {
    // bug 2026-09-13: rest rules
    const p = play({ inventory: [row('longsword', true)], conditions: [{ id: 'fatigued' }] });
    expect(has(rest(p, withItems).conditions, 'fatigued')).toBe(false);
  });
});

describe('rest(): a companion recovers like a creature, not like a potion', () => {
  it('heals max(1, its Con) × level instead of everything', () => {
    // bug 2026-09-13: rest rules
    const p = play({ companions: [cmp('c1', 'animal', 'wolf')], companionHp: { c1: { damage: 40, temp: 5 } } });
    const after = rest(p, { ...OPTS, companionHeal: { c1: 15 } }); // Con +3 × level 5
    expect(after.companionHp!.c1).toEqual({ damage: 25, temp: 0 });
  });

  it('survives a stale companionHp row whose companion is gone', () => {
    // bug 2026-09-13: rest rules
    // Real saves carry these: a companion removed in the Builder leaves its HP and conditions behind.
    const p = play({ companions: [], companionHp: { ghost: { damage: 9, temp: 3 } }, companionConditions: { ghost: [{ id: 'wounded', value: 1 }] } });
    const after = rest(p, OPTS);
    expect(after.companionHp!.ghost).toEqual({ damage: 0, temp: 0 });
    expect(after.companionConditions!.ghost).toEqual([]);
  });

  it('leaves a companion that is already at full at full', () => {
    // bug 2026-09-13: rest rules
    const p = play({ companions: [cmp('c1', 'animal', 'wolf')], companionHp: { c1: { damage: 0, temp: 0 } } });
    expect(rest(p, { ...OPTS, companionHeal: { c1: 15 } }).companionHp!.c1.damage).toBe(0);
  });

  it('leaves vehicles and siege weapons alone — they are Repaired, not rested', () => {
    // bug 2026-09-13: rest rules
    const p = play({
      companions: [cmp('v1', 'vehicle', 'carriage'), cmp('s1', 'siege')],
      companionHp: { v1: { damage: 10, temp: 2 }, s1: { damage: 7, temp: 0 } },
    });
    const after = rest(p, { ...OPTS, companionHeal: { v1: 99, s1: 99 } });
    expect(after.companionHp!.v1).toEqual({ damage: 10, temp: 2 });
    expect(after.companionHp!.s1).toEqual({ damage: 7, temp: 0 });
  });

  it('companionConMod reads the stat block, and has nothing to say about a vehicle', () => {
    // bug 2026-09-13: rest rules
    const ch = build('fighter', 5);
    // A young wolf's own Constitution, straight off the type (young grants no ability boosts) — the
    // mature rung boosts it, which is why this reads the derived block rather than a fixed number.
    expect(companionConMod(cmp('c1', 'animal', 'wolf'), ch, db)).toBe(db.animalCompanions.wolf.abilities.con);
    expect(companionConMod({ ...cmp('c2', 'animal', 'wolf'), maturity: 'mature' }, ch, db)).toBe((db.animalCompanions.wolf.abilities.con ?? 0) + 1);
    expect(companionConMod(cmp('v1', 'vehicle', 'carriage'), ch, db)).toBeUndefined();
    expect(companionConMod(cmp('s1', 'siege'), ch, db)).toBeUndefined();
    // A familiar has no Constitution of its own (flat 5 Hit Points per level) — the minimum-1 applies.
    expect(companionConMod(cmp('f1', 'familiar'), ch, db)).toBe(0);
  });
});

describe("rest(): the day's other leftovers", () => {
  it("clears yesterday's Advanced Alchemy items", () => {
    // bug 2026-09-13: rest rules
    // "These items have the infused trait and remain potent for 24 hours or until your next daily
    // preparations, whichever comes first." — Advanced Alchemy
    expect(db.classFeatures['advanced-alchemy'].description).toContain('until your next daily preparations');
    expect(rest(play({ alchemyPrep: { 'elixir-of-life-minor': 2 } }), OPTS).alchemyPrep).toEqual({});
  });

  it('does NOT refill mythic points — they last a session, not a day', () => {
    // bug 2026-09-13: rest rules
    expect(rest(play({ mythicPoints: 1 }), OPTS).mythicPoints).toBe(1);
    expect(rest(play({ mythicPoints: 0 }), OPTS).mythicPoints).toBe(0);
  });

  it('clears tempSpeed and tempHpFrom with the temp Hit Points, and keeps the kept choices', () => {
    // bug 2026-09-13: rest rules
    const p = play({
      tempHp: 8,
      tempHpFrom: 'wild-shape',
      tempSpeed: 60,
      preparedTactics: ['t1'],
      dailyChoices: { 'x:flag': 'cold' },
      restrictedSlotRanks: { s1: 3 },
      spellTrades: { arcane: [] },
    });
    const after = rest(p, OPTS);
    expect(after.tempHp).toBe(0);
    expect(after.tempSpeed).toBeUndefined();
    expect(after.tempHpFrom).toBeUndefined();
    expect(after.preparedTactics).toEqual(['t1']);
    expect(after.dailyChoices).toEqual({ 'x:flag': 'cold' });
    expect(after.restrictedSlotRanks).toEqual({ s1: 3 });
    expect(after.spellTrades).toEqual({ arcane: [] });
  });
});

/**
 * The other half of the same rule: *"abilities that can be used only a certain number of times per
 * day, INCLUDING MAGIC ITEM USES, are reset"*. 146 item records printed a Frequency line and carried
 * no counter, so there was nothing for the morning to act on; the counter pass at the end of
 * scripts/import-core-v2.mjs writes one. This is the leg that proves the data change reaches a player.
 */
describe('rest(): the printed per-day item limits it now has something to refill', () => {
  /** Spend every counter the record defines, then sleep. */
  const refill = (itemId: string) => {
    const defs = (db.items[itemId] as { counters?: { id: string; max: number; per?: string; resetsOnRest?: boolean }[] }).counters ?? [];
    const spent = Object.fromEntries(defs.map((c) => [c.id, { current: 0, max: c.max, resetsOnRest: c.resetsOnRest }]));
    const p = play({ inventory: [{ instanceId: 'x', itemId, quantity: 1, counters: spent }] });
    return { defs, back: rest(p, OPTS).inventory![0].counters! };
  };

  it('five of the newly-countered items come back full', () => {
    // bug 2026-09-13: rest rules
    for (const id of ['wardrobe-stone', 'cube-of-nex', 'anylength-rope', 'crystal-ball', 'busine-of-divine-reinforcement']) {
      const { defs, back } = refill(id);
      expect(defs.length, `${id} carries no counter at all — nothing for a morning to refill`).toBeGreaterThan(0);
      for (const c of defs) {
        expect(back[c.id].current, `${id}/${c.id} did not come back`).toBe(c.max);
        expect(['day', 'hour', 'minute', 'round', 'turn']).toContain(c.per);
      }
    }
  });

  it('bravery-baldric keeps BOTH pools, and the night refills only the one that resets', () => {
    // bug 2026-09-13: rest rules
    // The curated 2-charge pool refills on investment, not on rest; the printed "once per hour" does.
    // MUTATION PROOF: let the backfill re-apply win (it replaces the array) and `charges` is the only
    // row left, so `back.freq` is undefined here.
    const { defs, back } = refill('bravery-baldric');
    expect(defs.map((c) => c.id).sort()).toEqual(['charges', 'freq']);
    expect(defs.find((c) => c.id === 'freq')).toMatchObject({ max: 1, per: 'hour', resetsOnRest: true });
    expect(back.freq.current).toBe(1);
    expect(back.charges.current).toBe(0);
  });

  it('a limit longer than a day is NOT refilled by a night', () => {
    // bug 2026-09-13: rest rules
    const weekly = play({ inventory: [{ instanceId: 'w', itemId: 'crystal-ball', quantity: 1, counters: { freq: { current: 0, max: 1, resetsOnRest: false } } }] });
    expect(rest(weekly, OPTS).inventory![0].counters!.freq.current).toBe(0);
    // …and no shipped item was handed a week/month counter claiming otherwise.
    const bad = Object.entries(db.items).filter(
      ([, r]) => ((r as { counters?: { per?: string; resetsOnRest?: boolean }[] }).counters ?? []).some((c) => (c.per === 'week' || c.per === 'month') && c.resetsOnRest),
    );
    expect(bad.map(([id]) => id)).toEqual([]);
  });

  it('the importer stamps resetsOnRest from the PERIOD, and adds nothing twice', async () => {
    // bug 2026-09-13: rest rules
    // The shipped data is the output of this function; a regression here only shows up at the next
    // `npm run data`, by which time the wrong flag is already in core.json. So the mapping is pinned
    // at the source. MUTATION PROOF: drop 'week' from the non-resetting list and the 2nd line fails.
    const { fillFrequencyCounters, frequencyResets } = await import('../scripts/lib/aon-facets.mjs');
    expect([frequencyResets('day'), frequencyResets('hour'), frequencyResets('round')]).toEqual([true, true, true]);
    expect([frequencyResets('week'), frequencyResets('month')]).toEqual([false, false]);
    const rec: { description: string; counters?: unknown[] } = { description: 'Activate Interact; **Frequency** once per week; **Effect** something.' };
    expect(fillFrequencyCounters({ w: rec })).toEqual({ filled: 1, gained: 1 });
    expect(rec.counters).toEqual([{ id: 'freq', label: 'per week', max: 1, per: 'week', resetsOnRest: false }]);
    // Add-only and idempotent — it is called twice in one `npm run data`.
    expect(fillFrequencyCounters({ w: rec })).toEqual({ filled: 0, gained: 0 });
    expect((rec.counters as unknown[]).length).toBe(1);
  });
});
