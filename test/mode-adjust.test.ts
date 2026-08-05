import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { adjustModes, durationMinutes } from '../src/rules/modes';

/**
 * Records that change an item MODE rather than the character.
 *
 * Mutagens and elixirs ship as item-driven modes: `duration` is a PRINTED string (the app has no
 * clock, so the player reads it and switches the mode off) and a mutagen's drawback is a genuine
 * negative modifier. Nothing could touch either, so Extend Elixir and Perfect Mutagen were inert.
 */
const db = content();
const feats = (...ids: string[]) => ids.map((featId) => ({ featId }));

const modeFor = (pred: (m: (typeof db.modes)[string]) => boolean) => Object.values(db.modes).find(pred)!;

describe('reading a printed duration', () => {
  it('understands the units it actually meets', () => {
    expect(durationMinutes('10 minutes')).toBe(10);
    expect(durationMinutes('1 hour')).toBe(60);
    expect(durationMinutes('1 day')).toBe(1440);
  });

  it('is 0 for a duration that names no time', () => {
    expect(durationMinutes('until your next daily preparations')).toBe(0);
    expect(durationMinutes(undefined)).toBe(0);
  });
});

describe('Extend Elixir doubles a duration', () => {
  const elixir = () =>
    modeFor((m) => !!m.fromItemId && (db.items[m.fromItemId!]?.traits ?? []).includes('elixir') && durationMinutes(m.duration) >= 1);

  it('the feat carries the adjustment', () => {
    const adj = db.feats['extend-elixir'].modeAdjust![0];
    expect(adj.doubleDuration).toBe(true);
    expect(adj.match.traits).toEqual(['elixir']);
    expect(adj.match.minDurationMinutes).toBe(1);
  });

  it('the printed string is doubled, keeping its units', () => {
    const m = elixir();
    expect(m, 'the fixture elixir must exist').toBeTruthy();
    const before = durationMinutes(m.duration);
    const [after] = adjustModes([m], feats('extend-elixir'), db);
    expect(durationMinutes(after.duration)).toBe(before * 2);
  });

  it('without the feat nothing changes', () => {
    const m = elixir();
    expect(adjustModes([m], [], db)[0].duration).toBe(m.duration);
  });

  it('the source mode object is not mutated — the catalog is shared', () => {
    const m = elixir();
    const original = m.duration;
    adjustModes([m], feats('extend-elixir'), db);
    expect(m.duration, 'mutating it would leak one character’s feats into every other character').toBe(original);
  });

  it('a mode with no timed duration is left alone', () => {
    const untimed: (typeof db.modes)[string] = { id: 'x', name: 'X', modifiers: [], duration: 'until your next daily preparations' };
    expect(adjustModes([untimed], feats('extend-elixir'), db)[0].duration).toBe(untimed.duration);
  });

  it('it says what it cannot check', () => {
    const m = elixir();
    expect(adjustModes([m], feats('extend-elixir'), db)[0].note).toMatch(/INFUSED|Quick Alchemy/);
  });
});

describe("Perfect Mutagen drops the drawback", () => {
  const mutagen = () =>
    modeFor((m) => !!m.fromItemId && (db.items[m.fromItemId!]?.traits ?? []).includes('mutagen') && m.modifiers.some((x) => x.value < 0));

  it('the feat carries the adjustment', () => {
    const adj = db.feats['perfect-mutagen'].modeAdjust![0];
    expect(adj.suppressNegativeModifiers).toBe(true);
    expect(adj.match.traits).toEqual(['mutagen']);
  });

  it('every negative modifier stops applying, and the benefits stay', () => {
    const m = mutagen();
    expect(m, 'the fixture mutagen must have a drawback').toBeTruthy();
    const before = m.modifiers;
    const [after] = adjustModes([m], feats('perfect-mutagen'), db);
    expect(after.modifiers.some((x) => x.value < 0)).toBe(false);
    expect(after.modifiers.length).toBe(before.filter((x) => x.value >= 0).length);
    expect(after.modifiers.length, 'the benefits must survive').toBeGreaterThan(0);
  });

  it('an elixir that is not a mutagen keeps its modifiers', () => {
    const plain = modeFor(
      (m) => !!m.fromItemId && (db.items[m.fromItemId!]?.traits ?? []).includes('elixir') && !(db.items[m.fromItemId!]?.traits ?? []).includes('mutagen') && m.modifiers.some((x) => x.value < 0),
    );
    if (!plain) return;
    expect(adjustModes([plain], feats('perfect-mutagen'), db)[0].modifiers).toEqual(plain.modifiers);
  });

  it('both feats can apply to the same mutagen', () => {
    const m = mutagen();
    const [after] = adjustModes([m], feats('extend-elixir', 'perfect-mutagen'), db);
    expect(after.modifiers.some((x) => x.value < 0)).toBe(false);
    if (durationMinutes(m.duration) >= 1) expect(durationMinutes(after.duration)).toBe(durationMinutes(m.duration) * 2);
  });
});
