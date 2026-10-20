import { describe, expect, it } from 'vitest';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveSave, deriveSpeeds } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import { applyPlayState, initialPlay, type PlayState } from '../src/rules/play';
import { resolveTerms, type Term } from '../src/rules/blocks/terms';
import type { StoredBlock } from '../src/rules/blocks/stored';
import type { Character, CharacterOptions, ModeDef } from '../src/rules/types';
import { content } from './_content';

/**
 * THE ONE "SET AND POOLING" RULE (docs/overrides-redesign.md, Building blocks item 4 and its "As built"
 * lines; spec items 6 and 7), on the sheet's real path: a stored tweak block → blocks/active.ts →
 * derive.ts saveTerms → deriveSave AND explainStat. The rule itself is src/rules/blocks/terms.ts.
 *
 * The character: a level-14 monk with Peerless Form (a book +2 STATUS bonus to Fortitude) and a
 * Heroism mode (+1 STATUS to every check) switched on. Synthetic data only.
 */

const db = content();
const HEROISM: ModeDef = { id: 'test-heroism', name: 'Heroism', modifiers: [{ value: 1, type: 'status', target: 'all-checks' }] };
const FORT = { kind: 'save', save: 'fortitude' } as const;

let n = 0;
/** One stored block on Fortitude (StoredBlock shape, as `overrides.blocks` holds it). */
const blk = (kind: string, value: number, more: Partial<StoredBlock> = {}): StoredBlock => ({ id: `t${++n}`, kind, v: 1, target: 'save:fortitude', value, ...more });

function monk(blocks?: StoredBlock[], o: { level?: number; v?: number; options?: CharacterOptions; heroism?: boolean } = {}): Character {
  const overrides = blocks || o.v != null ? { ...(o.v != null ? { v: o.v } : {}), ...(blocks ? { blocks } : {}) } : undefined;
  const b = {
    ...emptyBuild(),
    name: 't',
    level: o.level ?? 14,
    classId: 'monk',
    keyAbility: 'str',
    ancestryId: 'human',
    backgroundId: 'acrobat',
    featPicks: { '14:class': 'peerless-form' },
    ...(overrides ? { overrides } : {}),
    ...(o.options ? { options: o.options } : {}),
  } as BuildState;
  const c = buildCharacter(b, db);
  return o.heroism === false ? c : { ...c, activeModes: [HEROISM] };
}
const fort = (c: Character) => deriveSave(c, 'fortitude', db).modifier;
const parts = (c: Character) => explainStat(c, db, FORT).parts;
const sum = (c: Character) => parts(c).reduce((s, p) => s + p.value, 0);
const line = (c: Character, label: string) => parts(c).find((p) => p.label === label);

/** The permanent part P: rank + Constitution + Peerless Form, no modes. */
const P = fort(monk(undefined, { heroism: false }));

describe('the fixture: Peerless Form +2 status is on Fortitude and Heroism +1 status is a mode', () => {
  it('Peerless Form adds 2 over the same monk without it', () => {
    expect(line(monk(), 'Peerless Form')).toMatchObject({ value: 2 });
    expect(line(monk(), 'Heroism')).toBeDefined();
  });
});

describe("'number.set' — a set replaces the permanent total; conditions and modes apply on top", () => {
  it("set Fortitude to +12 → 13: the book lines, then 'Tweak: set to 12' carrying the difference, then Heroism +1", () => {
    const c = monk([blk('number.set', 12)]);
    expect(fort(c)).toBe(13);
    expect(sum(c)).toBe(13);
    const p = parts(c);
    const iPeerless = p.findIndex((x) => x.label === 'Peerless Form');
    const iSet = p.findIndex((x) => x.label === 'Tweak: set to 12');
    const iHeroism = p.findIndex((x) => x.label === 'Heroism');
    expect(iPeerless).toBeGreaterThanOrEqual(0);
    expect(iSet).toBeGreaterThan(iPeerless);
    expect(iHeroism).toBeGreaterThan(iSet);
    // The book lines still show what P was; the set line carries 12 − P.
    expect(p[iPeerless].value).toBe(2);
    expect(p[iSet].value).toBe(12 - P);
    expect(p[iHeroism].value).toBe(1);
    expect(p.slice(0, iSet).reduce((s, x) => s + x.value, 0)).toBe(P);
  });

  it('with no set: the same +2 as today, and Heroism shows +0 "does not stack"', () => {
    const c = monk();
    expect(fort(c)).toBe(P);
    expect(sum(c)).toBe(P);
    expect(line(c, 'Peerless Form')!.value).toBe(2);
    expect(line(c, 'Heroism')).toMatchObject({ value: 0 });
    expect(line(c, 'Heroism')!.note).toContain('does not stack');
  });

  it('several sets: the last one counts, the earlier one shows +0 "replaced by a later set"', () => {
    const c = monk([blk('number.set', 12), blk('number.set', 15)]);
    expect(fort(c)).toBe(16);
    expect(sum(c)).toBe(16);
    expect(line(c, 'Tweak: set to 12')).toMatchObject({ value: 0, note: 'replaced by a later set' });
    expect(line(c, 'Tweak: set to 15')!.value).toBe(15 - P);
  });

  it('a set may give a negative number', () => {
    const c = monk([blk('number.set', -3)]);
    expect(fort(c)).toBe(-2);
    expect(sum(c)).toBe(-2);
  });

  it('a typed tweak add pools with the mode under a set: +2 status beats Heroism +1', () => {
    const c = monk([blk('number.set', 12), blk('number.add', 2, { bonusType: 'status' })]);
    expect(fort(c)).toBe(14);
    expect(sum(c)).toBe(14);
    expect(line(c, 'Tweak: +2 status')!.value).toBe(2);
    expect(line(c, 'Heroism')).toMatchObject({ value: 0 });
  });

  it('an untyped tweak add always adds, with or without a set', () => {
    const c1 = monk([blk('number.add', 1)]);
    expect(fort(c1)).toBe(P + 1);
    expect(sum(c1)).toBe(P + 1);
    const c2 = monk([blk('number.set', 12), blk('number.add', 1)]);
    expect(fort(c2)).toBe(14);
    expect(sum(c2)).toBe(14);
  });

  it('with no set, a typed tweak add pools with the book bonus of its type (+1 status loses to Peerless Form)', () => {
    const c = monk([blk('number.add', 1, { bonusType: 'status' })]);
    expect(fort(c)).toBe(P);
    expect(line(c, 'Tweak: +1 status')).toMatchObject({ value: 0 });
    expect(sum(c)).toBe(P);
  });
});

describe("'number.atLeast' — acts as a set only when it lifts the permanent total", () => {
  it('lifting: at least P+3 → P+3, then Heroism +1 on top', () => {
    const c = monk([blk('number.atLeast', P + 3)]);
    expect(fort(c)).toBe(P + 4);
    expect(sum(c)).toBe(P + 4);
    expect(line(c, `Tweak: at least ${P + 3}`)!.value).toBe(3);
    expect(line(c, 'Heroism')!.value).toBe(1);
  });

  it('not lifting: at least P−1 does nothing, shows +0 "already N or more", and everything stays one pool', () => {
    const c = monk([blk('number.atLeast', P - 1)]);
    expect(fort(c)).toBe(P);
    expect(sum(c)).toBe(P);
    expect(line(c, `Tweak: at least ${P - 1}`)).toMatchObject({ value: 0, note: `already ${P - 1} or more` });
    expect(line(c, 'Heroism')!.value).toBe(0);
  });

  it("a 'number.set' and a 'number.atLeast' together: the set first, then the at-least lifts", () => {
    const c = monk([blk('number.set', 12), blk('number.atLeast', 14)]);
    expect(fort(c)).toBe(15);
    expect(sum(c)).toBe(15);
    const c2 = monk([blk('number.set', 12), blk('number.atLeast', 10)]);
    expect(fort(c2)).toBe(13);
  });
});

describe("which 'number.set' blocks reach the number (blocks/active.ts)", () => {
  it('a start level above the character level is ignored; at or below it applies', () => {
    expect(fort(monk([blk('number.set', 12, { from: 15 })]))).toBe(P);
    expect(fort(monk([blk('number.set', 12, { from: 14 })]))).toBe(13);
  });
  it('a paused block is ignored', () => {
    expect(fort(monk([blk('number.set', 12, { on: false })]))).toBe(P);
  });
  it('a broken block (a target this app does not know) is ignored', () => {
    expect(fort(monk([blk('number.set', 12, { target: 'save:luck' })]))).toBe(P);
  });
  it('master switch: with overrides.v = 2 the stored switch is obeyed (off → ignored, on → applied)', () => {
    expect(fort(monk([blk('number.set', 12)], { v: 2 }))).toBe(P);
    expect(fort(monk([blk('number.set', 12)], { v: 2, options: { overridesEnabled: false } as CharacterOptions }))).toBe(P);
    expect(fort(monk([blk('number.set', 12)], { v: 2, options: { overridesEnabled: true } as CharacterOptions }))).toBe(13);
  });
  it('master switch: overrides.v absent reads as ON', () => {
    expect(fort(monk([blk('number.set', 12)]))).toBe(13);
  });
  it('a tweak never lights the mode highlight: it is not an active mode', () => {
    const c = monk([blk('number.set', 12)], { heroism: false });
    expect(c.activeModes ?? []).toEqual([]);
    expect(fort(c)).toBe(12);
  });
});

describe("'number.set' and typed 'number.add' on land Speed follow the same rule (swashbuckler L5, Vivacious Speed)", () => {
  // Human 25 ft; Vivacious Speed: a standing +5 status bonus, +10 status while you have panache, and
  // Stylish Combatant's +5 status with panache — one status bonus, the largest.
  const swash = (blocks?: StoredBlock[], panache = false) => {
    const cls = db.classes.swashbuckler;
    const b = {
      ...emptyBuild(),
      name: 't',
      level: 5,
      classId: 'swashbuckler',
      keyAbility: 'dex',
      ancestryId: 'human',
      backgroundId: 'acrobat',
      subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
      ...(blocks ? { overrides: { blocks } } : {}),
    } as BuildState;
    const built = buildCharacter(b, db);
    return panache ? applyPlayState(built, { ...initialPlay(built, db), resources: { panache: 1 } } as PlayState, db) : built;
  };
  const land = (c: Character) => deriveSpeeds(c, db).land ?? 0;
  const speedSum = (c: Character) => explainStat(c, db, { kind: 'speed' }).parts.reduce((s, p) => s + p.value, 0);
  const sp = (kind: string, value: number, more: Partial<StoredBlock> = {}): StoredBlock => ({ id: `s${++n}`, kind, v: 1, target: 'speed:land', value, ...more });

  it('the fixture: 30 ft, 35 ft with panache', () => {
    expect(land(swash())).toBe(30);
    expect(land(swash(undefined, true))).toBe(35);
  });
  it('a "+10 status" tweak pools with the status bonuses of the records: 35, and 35 with panache', () => {
    for (const panache of [false, true]) {
      const c = swash([sp('number.add', 10, { bonusType: 'status' })], panache);
      expect(land(c), `panache ${panache}`).toBe(35);
      expect(speedSum(c)).toBe(35);
    }
  });
  it('an untyped +5 tweak always adds: 35, and 40 with panache', () => {
    expect(land(swash([sp('number.add', 5)]))).toBe(35);
    expect(land(swash([sp('number.add', 5)], true))).toBe(40);
  });
  it("set to 30 replaces the lasting Speed; panache's +10 counts in full on top: 30, and 40 with panache", () => {
    const off = swash([sp('number.set', 30)]);
    const on = swash([sp('number.set', 30)], true);
    expect(land(off)).toBe(30);
    expect(land(on)).toBe(40);
    expect(speedSum(off)).toBe(30);
    expect(speedSum(on)).toBe(40);
  });
  it('set to 30 with a +10 status tweak: the tweak pools with the play bonuses on top — 40, and 40 with panache', () => {
    expect(land(swash([sp('number.set', 30), sp('number.add', 10, { bonusType: 'status' })]))).toBe(40);
    expect(land(swash([sp('number.set', 30), sp('number.add', 10, { bonusType: 'status' })], true))).toBe(40);
  });
  it('a lifting "at least 40" acts as the set: 40, and 50 with panache; a non-lifting "at least 20" does nothing', () => {
    expect(land(swash([sp('number.atLeast', 40)]))).toBe(40);
    expect(land(swash([sp('number.atLeast', 40)], true))).toBe(50);
    expect(land(swash([sp('number.atLeast', 20)], true))).toBe(35);
  });
});

describe("resolveTerms on a bare list ('number.set' / 'number.atLeast' order slots)", () => {
  const t = (value: number, more: Partial<Term> = {}): Term => ({ type: 'untyped', value, label: `x${value}`, layer: 'book', ...more });
  it('the parts always sum to the total', () => {
    const lists: Term[][] = [
      [t(5, { layer: 'base' }), t(2, { type: 'status' }), t(1, { type: 'status', layer: 'transient' })],
      [t(5, { layer: 'base' }), t(2, { type: 'status' }), t(20, { layer: 'tweak', slot: 'set' }), t(-2, { type: 'status', layer: 'transient' })],
      [t(5, { layer: 'base' }), t(9, { layer: 'tweak', slot: 'atLeast' }), t(30, { layer: 'tweak', slot: 'atLeast' }), t(1, { layer: 'tweak' })],
      [t(5, { layer: 'base' }), t(-1, { type: 'circumstance' }), t(-3, { type: 'circumstance', layer: 'transient' })],
    ];
    for (const list of lists) {
      const r = resolveTerms(list);
      expect(r.parts.reduce((s, p) => s + p.value, 0)).toBe(r.total);
    }
  });
});
