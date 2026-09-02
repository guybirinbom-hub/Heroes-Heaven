// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { rebuildRoster } from '../src/data/rebuild';
import { noteDerivedRefresh, noteRosterChange } from '../src/data/cloudSync';
import { loadCharUpdated, saveCharUpdated, type SavedChar } from '../src/data/storage';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';

/**
 * THE "MY EDITS VANISH A FEW SECONDS LATER" BUG (2026-09-02).
 *
 * v0.1.25 began re-deriving every character from its build once per launch. The stored JSON changed
 * (new engine, new fields), cloud sync's edit detector saw a changed fingerprint, stamped EVERY character
 * "updated now" and pushed. A device that had merely been opened became the newest copy of everything,
 * and in a two-device account it won every merge — the other device's real edits, made seconds earlier,
 * were overwritten by the stale copy when the Realtime pull arrived. The rebuild is a DERIVED refresh
 * and must never move a timestamp; that is what these pin.
 */
const build = (): BuildState => ({
  ...emptyBuild(),
  name: 'Sync Test',
  level: 3,
  classId: 'cleric',
  subclassId: 'cloistered-cleric',
  ancestryId: 'halfling',
  heritageId: 'aiuvarin',
  backgroundId: 'acolyte',
  keyAbility: 'wis',
  deityId: 'sarenrae',
});

const saved = (id: string, b: BuildState, stale: boolean): SavedChar => {
  const c = buildCharacter(b, content());
  // A snapshot from an older engine: one derived field missing, as the real one lacked `cantripCap`.
  const character = stale ? { ...c, spellcasting: c.spellcasting.map((s) => ({ ...s, cantripCap: undefined })) } : c;
  return { id, build: b, character, play: {} } as unknown as SavedChar;
};

describe('rebuildRoster', () => {
  it('re-derives from the build and carries the player-owned customization over', () => {
    const sc = saved('a', build(), true);
    (sc.character as { customization?: unknown }).customization = { zoom: 1.25 };
    const [out] = rebuildRoster([sc], content());
    expect(out.character.spellcasting[0]).toHaveProperty('cantripCap');
    expect((out.character as { customization?: { zoom?: number } }).customization?.zoom).toBe(1.25);
    expect(out.play).toBe(sc.play);
  });

  it('a character without a build is left exactly as stored', () => {
    const sc = { id: 'b', character: { name: 'legacy' }, play: {} } as unknown as SavedChar;
    expect(rebuildRoster([sc], content())[0]).toBe(sc);
  });
});

describe('a derived refresh never stamps a character as edited', () => {
  beforeEach(() => {
    localStorage.clear();
    saveCharUpdated({ a: 1000 });
  });

  it('rebuild registered as a derived refresh → the timestamp stays; a real edit afterwards still stamps', () => {
    const stale = saved('a', build(), true);
    // The device's baseline is the stale snapshot (what the last persist / pull left in storage).
    noteDerivedRefresh([stale]);
    const [rebuilt] = rebuildRoster([stale], content());
    expect(JSON.stringify(rebuilt)).not.toBe(JSON.stringify(stale));
    noteDerivedRefresh([rebuilt]);
    noteRosterChange([rebuilt]); // the persist that follows the rebuild
    expect(loadCharUpdated().a).toBe(1000);
    // Now the player actually changes something.
    const edited = { ...rebuilt, play: { xp: 50 } } as unknown as SavedChar;
    noteRosterChange([edited]);
    expect(loadCharUpdated().a).toBeGreaterThan(1000);
  });

  it('without the refresh registration the same rebuild WOULD have stamped (the bug)', () => {
    const stale = saved('a', build(), true);
    noteDerivedRefresh([stale]);
    const [rebuilt] = rebuildRoster([stale], content());
    noteRosterChange([rebuilt]);
    expect(loadCharUpdated().a).toBeGreaterThan(1000);
  });
});
