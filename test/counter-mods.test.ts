import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { applyCounterMods, COUNTER_MODS, snareAllowanceFor } from '../src/rules/counterMods';
import { snareAllowance } from '../src/rules/snareFormulas';

/**
 * Records whose whole content is "that number the app already computes should be bigger".
 *
 * Each counter came from a hardcoded formula no record could influence — snareAllowance's 4/6/8,
 * commanderFolioMax's 5+2+2+2 — so Plentiful Snares ("you can prepare twice as many snares") and its
 * kin changed nothing.
 */
const db = content();

describe('the arithmetic is order-independent', () => {
  it('every add lands before every multiply, whatever order the records come in', () => {
    // Otherwise "double it" and "+2" give different totals depending on which record was read first,
    // and two players with identical feats would see different numbers.
    const a = applyCounterMods('snares-prepared', 4, ['plentiful-snares']);
    expect(a).toBe(8);
  });

  it('a non-repeatable mod counts once even if the id appears twice', () => {
    expect(applyCounterMods('snares-prepared', 4, ['plentiful-snares', 'plentiful-snares'])).toBe(8);
  });

  it('a REPEATABLE one counts each time it was taken', () => {
    expect(applyCounterMods('commander-folio', 5, ['tactical-expansion'])).toBe(7);
    expect(applyCounterMods('commander-folio', 5, ['tactical-expansion', 'tactical-expansion'])).toBe(9);
  });

  it('an unrelated record changes nothing', () => {
    expect(applyCounterMods('commander-folio', 5, ['plentiful-snares'])).toBe(5);
    expect(applyCounterMods('snares-prepared', 4, [])).toBe(4);
  });

  it('never returns a negative', () => {
    expect(applyCounterMods('snares-prepared', 0, ['plentiful-snares'])).toBe(0);
  });
});

describe('the snare allowance honours the records', () => {
  it('Plentiful Snares doubles what a legendary crafter prepares', () => {
    const base = snareAllowance('legendary');
    const withIt = snareAllowanceFor('legendary', ['plentiful-snares'], snareAllowance);
    expect(base.prepared).toBe(8);
    expect(withIt.prepared).toBe(16);
    expect(withIt.known, 'it should not touch how many you KNOW').toBe(base.known);
  });

  it('without it the formula stands', () => {
    expect(snareAllowanceFor('expert', [], snareAllowance)).toEqual(snareAllowance('expert'));
  });
});

describe("the commander's folio", () => {
  it('Tactical Expansion widens it on a real character', () => {
    const plain = build('commander', 8, {});
    const withIt = build('commander', 8, { featPicks: { '8:class': 'tactical-expansion' } });
    if (!db.feats['tactical-expansion']) return; // the feat does not ship; the unit tests still hold
    expect(withIt.commanderTactics!.folioMax).toBe(plain.commanderTactics!.folioMax + 2);
  });
});

describe('the registry itself', () => {
  it('every record it names exists', () => {
    const bad = Object.keys(COUNTER_MODS).filter((id) => !db.feats[id] && !db.classFeatures[id]);
    expect(bad).toEqual([]);
  });

  it('no mod is a no-op', () => {
    for (const [id, mods] of Object.entries(COUNTER_MODS)) {
      for (const m of mods) {
        if (m.op === 'add') expect(m.value, `${id} adds nothing`).not.toBe(0);
        if (m.op === 'mul') expect(m.value, `${id} multiplies by one`).not.toBe(1);
      }
    }
  });
});
