// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { carryStoredOverrides, rebuildRoster } from '../src/data/rebuild';
import { authoredKey, CARRIED_CHARACTER_FIELDS } from '../src/data/authored';
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

  it('carries currency over too — refuter #1: a wallet not yet in play.currency is not reset to the build\'s 0 gold on relaunch', () => {
    const sc = saved('a', build(), false);
    (sc.character as { currency?: unknown }).currency = { gp: 500, sp: 3 };
    const [out] = rebuildRoster([sc], content());
    // buildCharacter's own fresh currency is always 0 now (lane "gold") — if rebuildRoster stopped
    // carrying it over, this would come back {} instead of the stored wallet.
    expect(out.character.currency).toEqual({ gp: 500, sp: 3 });
  });

  it('a character without a build is left exactly as stored', () => {
    const sc = { id: 'b', character: { name: 'legacy' }, play: {} } as unknown as SavedChar;
    expect(rebuildRoster([sc], content())[0]).toBe(sc);
  });

  it('F1 (2026-10-09): what the player AUTHORED is unchanged by a rebuild — the GM-edit verdict’s premise', () => {
    /*
     * A GM edit is applied only while this device's sheet and its published copy are the same by
     * `authoredKey`, and a launch rebuild (or a cloud adopt) re-derives `character` on every launch. If
     * a rebuild could move the authored key, every launch would make a pending GM edit WAIT and then
     * REFUSE it as "the player changed the character" — case 21 of the F1 design.
     * MUTATION (run 2026-10-09): stop carrying the player's fields over a rebuild — `character: fresh`
     * in rebuildRoster — and this fails (with the two carry legs above) —
     *   AssertionError: a rebuild moved what the player authored: expected '{"build":{"ancestryBoosts":[],"ancest…' to be '{"build":{"ancestryBoosts":[],"ancest…'
     */
    const stale = saved('a', build(), true);
    (stale.character as { currency?: unknown }).currency = { gp: 7 };
    (stale.character as { customization?: unknown }).customization = { zoom: 1.1 };
    const legacy = { id: 'b', character: { name: 'legacy' }, play: {} } as unknown as SavedChar;
    const fresh = saved('c', build(), false);
    const before = [stale, legacy, fresh];
    const after = rebuildRoster(before, content());
    expect(JSON.stringify(after[0].character), 'fixture: the derived cache really moved').not.toBe(JSON.stringify(stale.character));
    after.forEach((sc, i) => expect(authoredKey(sc), 'a rebuild moved what the player authored').toBe(authoredKey(before[i])));
  });

  it('F1 (2026-10-09): carryStoredOverrides carries exactly CARRIED_CHARACTER_FIELDS', () => {
    /*
     * The two lists are one list: what a rebuild keeps is what the GM-edit channel counts as the
     * player's own (`authoredKey`). A field carried here but not counted there would be lost silently
     * by an applied GM edit the verdict judged lossless.
     * MUTATION (run 2026-10-09): carry a third field in carryStoredOverrides without adding it to
     * CARRIED_CHARACTER_FIELDS (`for (const k of [...CARRIED_CHARACTER_FIELDS, 'zzz'])`) — and this
     * fails, alone in this file —
     *   AssertionError: expected [ 'currency', 'customization', 'zzz' ] to deeply equal [ 'currency', 'customization' ]
     */
    const fresh = buildCharacter(build(), content());
    const stored = { ...fresh, name: 'Old Name', customization: { zoom: 2 }, currency: { gp: 3 }, zzz: 1 } as unknown as typeof fresh;
    const out = carryStoredOverrides(fresh, stored) as unknown as Record<string, unknown>;
    const fromStored = Object.keys(out).filter((k) => out[k] !== (fresh as unknown as Record<string, unknown>)[k]).sort();
    expect(fromStored).toEqual([...CARRIED_CHARACTER_FIELDS].sort());
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
