import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { runeRepertoireMax, runeEtchedMax, runesmithRuneOptions, type BuildState } from '../src/rules/build';
import { toggleEtchedRune, applyPlayState, emptyPlay } from '../src/rules/play';

const db = content();

/**
 * The runesmith's RUNIC REPERTOIRE — the one record in eight Wanderer's Guide parity batches that was
 * genuinely, wholly unbuilt. `classFeatures/runic-repertoire` prints:
 *
 *   *"The collection of runes that you know is called your runic repertoire. At 1st level, you learn
 *   four 1st-level runes of your choice. You choose these from the common runes on the rune list …
 *   You can add any rune to your repertoire as long as it is common (or you have access to it) and its
 *   level is equal to or less than your own."*
 *
 * There was no rune list. Zero records carried the `rune` trait, no collection existed, and no picker
 * existed — so a runesmith chose nothing and the class's defining feature did nothing at all.
 */
describe('the rune corpus', () => {
  const runes = Object.values(db.runesmithRune ?? {});

  it('ships all 44 runes, on the printed level ladder', () => {
    expect(runes).toHaveLength(44);
    const byLevel = runes.reduce<Record<number, number>>((m, r) => ((m[r.level] = (m[r.level] ?? 0) + 1), m), {});
    expect(byLevel).toEqual({ 1: 16, 5: 8, 9: 12, 13: 4, 17: 4 });
  });

  it('every rune carries the rune + runesmith traits and printed prose', () => {
    for (const r of runes) {
      expect(r.traits, r.id).toContain('rune');
      expect(r.traits, r.id).toContain('runesmith');
      expect(r.description?.length ?? 0, r.id).toBeGreaterThan(40);
      // The prose must not still be carrying AoN's structural separators.
      expect(r.description?.startsWith('---'), r.id).toBe(false);
    }
  });

  it('marks the twelve diacritics, and only those', () => {
    const dia = runes.filter((r) => r.diacritic);
    expect(dia).toHaveLength(12);
    /* *"A diacritic can never be applied by itself"* — its Usage is what says so, and it always names
     * a rune rather than a creature or object. Several narrow it further ("drawn on a rune that deals
     * damage"), so the prefix is the invariant, not the whole string. */
    for (const r of dia) expect(r.usage, r.id).toMatch(/^drawn on a rune\b/);
    for (const r of runes.filter((x) => !x.diacritic)) expect(r.usage, r.id).not.toMatch(/^drawn on a rune\b/);
    // No double spaces left behind by stripping AoN's inline links out of the Usage line.
    for (const r of runes) expect(r.usage, r.id).not.toMatch(/ {2}/);
  });
});

describe('the two printed tables', () => {
  // Runic Repertoire: 4 / 6 / 8 / 10 / 12. Max Etched Runes: 2 / 3 / 4 / 5 / 6.
  it.each([
    [1, 4, 2], [4, 4, 2],
    [5, 6, 3], [8, 6, 3],
    [9, 8, 4], [12, 8, 4],
    [13, 10, 5], [16, 10, 5],
    [17, 12, 6], [20, 12, 6],
  ])('at level %i: %i known, %i etched', (level, known, etched) => {
    expect(runeRepertoireMax(level as number, db)).toBe(known);
    expect(runeEtchedMax(level as number, db)).toBe(etched);
  });
});

describe('the picker', () => {
  // *"its level is equal to or less than your own"* — a plain level compare, because the rune tiers
  // and the repertoire steps are the same levels.
  it('offers only runes of your level or lower', () => {
    expect(runesmithRuneOptions(1, db)).toHaveLength(16);
    expect(runesmithRuneOptions(4, db)).toHaveLength(16);
    expect(runesmithRuneOptions(5, db)).toHaveLength(24);
    expect(runesmithRuneOptions(9, db)).toHaveLength(36);
    expect(runesmithRuneOptions(17, db)).toHaveLength(44);
  });
});

describe('a built runesmith', () => {
  const someRunes = (n: number, level: number) => runesmithRuneOptions(level, db).slice(0, n).map((r) => r.id);

  it('keeps the runes it chose, and reports both capacities', () => {
    const picks = someRunes(4, 1);
    const ch = build('runesmith', 1, { runesmithRunes: picks } as Partial<BuildState>);
    expect(ch.runicRepertoire?.known).toEqual(picks);
    expect(ch.runicRepertoire?.repertoireMax).toBe(4);
    expect(ch.runicRepertoire?.etchedMax).toBe(2);
  });

  it('drops a rune above the character level rather than keeping it', () => {
    const highRune = Object.values(db.runesmithRune).find((r) => r.level === 9)!;
    const ch = build('runesmith', 1, { runesmithRunes: [highRune.id] } as Partial<BuildState>);
    expect(ch.runicRepertoire?.known).toEqual([]);
  });

  it('clamps to the repertoire capacity', () => {
    const ch = build('runesmith', 1, { runesmithRunes: someRunes(10, 1) } as Partial<BuildState>);
    expect(ch.runicRepertoire?.known).toHaveLength(4);
  });

  it('is a runesmith-only lane', () => {
    expect(build('fighter', 5).runicRepertoire).toBeUndefined();
  });
});

describe('etching', () => {
  const at = (level: number) => {
    const picks = runesmithRuneOptions(level, db).slice(0, runeRepertoireMax(level, db)).map((r) => r.id);
    return { ch: build('runesmith', level, { runesmithRunes: picks } as Partial<BuildState>), picks };
  };

  it('records the etched runes on the character', () => {
    const { ch, picks } = at(1);
    let play = emptyPlay();
    play = toggleEtchedRune(play, picks[0], 2);
    expect(applyPlayState(ch, play, db).runicRepertoire?.etched).toEqual([picks[0]]);
  });

  it('un-etches on a second toggle', () => {
    const { ch, picks } = at(1);
    let play = toggleEtchedRune(emptyPlay(), picks[0], 2);
    play = toggleEtchedRune(play, picks[0], 2);
    expect(applyPlayState(ch, play, db).runicRepertoire?.etched).toEqual([]);
  });

  it('fades the OLDEST rune past the maximum, rather than refusing the etch', () => {
    // *"until you etch more runes than your maximum, which causes your oldest rune to fade"* — this is
    // where a rune differs from a prepared tactic, whose over-cap toggle is a no-op.
    const { ch, picks } = at(1);
    let play = emptyPlay();
    for (const id of picks.slice(0, 3)) play = toggleEtchedRune(play, id, 2);
    expect(applyPlayState(ch, play, db).runicRepertoire?.etched).toEqual([picks[1], picks[2]]);
  });

  it('never shows a rune the character no longer knows', () => {
    const { picks } = at(5);
    const shrunk = build('runesmith', 5, { runesmithRunes: picks.slice(0, 2) } as Partial<BuildState>);
    const play = toggleEtchedRune(emptyPlay(), picks[5], 3);
    expect(applyPlayState(shrunk, play, db).runicRepertoire?.etched).toEqual([]);
  });
});

describe('the class feature records', () => {
  it('carry the printed tables rather than being empty stubs', () => {
    expect(db.classFeatures['runic-repertoire'].runesKnown).toEqual([
      { level: 1, count: 4 }, { level: 5, count: 6 }, { level: 9, count: 8 }, { level: 13, count: 10 }, { level: 17, count: 12 },
    ]);
    expect(db.classFeatures.runes.runesEtched).toEqual([
      { level: 1, count: 2 }, { level: 5, count: 3 }, { level: 9, count: 4 }, { level: 13, count: 5 }, { level: 17, count: 6 },
    ]);
  });

  it('and the two application actions are still granted', () => {
    // *"You can trace a rune with the Trace Rune action"* / *"you can pronounce the true name of a rune
    // you have applied"*. These already shipped; the runes they apply did not.
    expect(db.classFeatures.runes.grantsActions).toEqual(['trace-rune', 'invoke-rune']);
    expect(db.actions['trace-rune']).toBeTruthy();
    expect(db.actions['invoke-rune']).toBeTruthy();
  });
});
