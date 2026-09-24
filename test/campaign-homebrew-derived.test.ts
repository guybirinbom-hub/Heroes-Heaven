// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { rebuildRoster } from '../src/data/rebuild';
import { noteDerivedRefresh, noteRosterChange } from '../src/data/cloudSync';
import { loadCharUpdated, saveCharUpdated, type SavedChar } from '../src/data/storage';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';

/**
 * A DERIVED REFRESH MID-SESSION MUST NOT SWALLOW AN EDIT THAT HASN'T BEEN PERSISTED YET.
 *
 * Campaign homebrew (and synced homebrew, and the trust-gate switch) re-derive every character while
 * the player is playing. A character the player changed a moment ago still holds that change in React
 * state / the 400 ms persist debounce. If the refresh moved that character's edit-detection baseline to
 * the rebuilt copy, the persist that follows would see "nothing changed": no stamp, no push, and the
 * next merge hands the player an older copy — the 2026-09-13 roundtrip-window class. `prev` tells
 * noteDerivedRefresh which characters to leave alone.
 */
const build = (name: string): BuildState => ({
  ...emptyBuild(),
  name,
  level: 3,
  classId: 'cleric',
  subclassId: 'cloistered-cleric',
  ancestryId: 'halfling',
  heritageId: 'aiuvarin',
  backgroundId: 'acolyte',
  keyAbility: 'wis',
  deityId: 'sarenrae',
});

/** A snapshot from an older engine (one derived field missing), so a rebuild really changes the JSON. */
const stale = (id: string): SavedChar => {
  const b = build(`Char ${id}`);
  const c = buildCharacter(b, content());
  const character = { ...c, spellcasting: c.spellcasting.map((s) => ({ ...s, cantripCap: undefined })) };
  return { id, build: b, character, play: {} } as unknown as SavedChar;
};

describe('noteDerivedRefresh(roster, prev) — a refresh that lands mid-session', () => {
  beforeEach(() => {
    localStorage.clear();
    saveCharUpdated({ a: 1000, b: 1000 });
  });

  it('keeps the baseline of a character holding an unpersisted edit, so the next persist still stamps it', () => {
    const roster = [stale('a'), stale('b')];
    noteDerivedRefresh(roster); // what the last persist / pull left as the baseline
    // The player edits A. It is in React state only — not persisted, so noteRosterChange never saw it.
    // C is a character created a moment ago: no baseline at all yet.
    const prev = [{ ...roster[0], play: { xp: 50 } } as unknown as SavedChar, roster[1], stale('c')];
    const rebuilt = rebuildRoster(prev, content());
    expect(JSON.stringify(rebuilt[1]), 'fixture: the rebuild must change the stored JSON').not.toBe(JSON.stringify(roster[1]));
    noteDerivedRefresh(rebuilt, prev);
    noteRosterChange(rebuilt); // the persist that follows the refresh
    const ts = loadCharUpdated();
    expect(ts.a, 'the edit made before the refresh was swallowed — never stamped, never pushed').toBeGreaterThan(1000);
    expect(ts.c, 'a character with no baseline yet is unpersisted work too').toBeGreaterThan(1000);
    expect(ts.b, 'an untouched character was stamped by a derived refresh (the 2026-09-02 class)').toBe(1000);
  });

  it('without prev, behaves exactly as before: every baseline moves, nothing is stamped', () => {
    const roster = [stale('a'), stale('b')];
    noteDerivedRefresh(roster);
    const prev = [{ ...roster[0], play: { xp: 50 } } as unknown as SavedChar, roster[1]];
    const rebuilt = rebuildRoster(prev, content());
    noteDerivedRefresh(rebuilt);
    noteRosterChange(rebuilt);
    expect(loadCharUpdated()).toEqual({ a: 1000, b: 1000 });
  });
});
