// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { contentGatedModes, modeAlsoElsewhere, modeListedFor, modeOwnedElsewhere, playerModeLibrary, type ModeUsage } from '../src/rules/modes';
import { collectCarried, duplicateWithOwnModes, foreignContent, modeUsage } from '../src/data/carried';
import { ROSTER_KEY, loadModes, loadRoster, type SavedChar } from '../src/data/storage';
import { computeSummary } from '../src/sheet/partySummary';
import type { ContentDatabase, ModeDef } from '../src/rules/types';

/**
 * Guy, 2026-10-21: "modes need to be per character so a mode i made on one shouldnt apear on another".
 *
 * A user mode's `charId` names the roster character it was made on. A mode saved before that has no owner:
 * it is listed on every character that has it switched on or carries it, and on every character when none
 * does — read off the roster each time (src/data/carried.ts `modeUsage`), never migrated on load
 * (src/rules/modes.ts `modeListedFor` / `modeAlsoElsewhere`). The App-level half (making, switching on and
 * deleting from a sheet) is test/modes-per-character-app.test.tsx. Every character and mode here is synthetic.
 */
const MADE_ON_A: ModeDef = { id: 'mode-tide-step-pc1', name: 'Tide Step', charId: 'pc-a', modifiers: [{ value: 1, type: 'status', target: 'ac' }] };
const OLD_ON_A: ModeDef = { id: 'mode-old-lantern-pc1', name: 'Old Lantern', modifiers: [{ value: 1, type: 'status', target: 'perception' }] };
const OLD_UNUSED: ModeDef = { id: 'mode-old-cairn-pc1', name: 'Old Cairn', modifiers: [] };

const ids = (list: ModeDef[]) => list.map((m) => m.id).sort();
const listedOn = (charKey: string, usage: ModeUsage, activeHere?: ReadonlySet<string>) =>
  ids([MADE_ON_A, OLD_ON_A, OLD_UNUSED].filter((m) => modeListedFor(m, charKey, usage, activeHere)));

/** A roster entry with these modes switched on (no build needed: only `id`, `play` and `carried` are read). */
const entry = (id: string, play: Partial<SavedChar['play']> = {}, carried?: unknown) => ({ id, play, carried }) as unknown as SavedChar;

const db = content();
/** A whole roster character — a 1st-level human fighter — with these modes switched on. */
function pc(id: string, name: string, activeModes: string[] = []): SavedChar {
  const build = {
    ...emptyBuild(),
    name,
    level: 1,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    classId: 'fighter',
    keyAbility: 'str',
  } as BuildState;
  const character = buildCharacter(build, db);
  return { id, character, build, play: { ...initialPlay(character, db), activeModes } } as SavedChar;
}

describe('a user mode is listed only on the character it belongs to', () => {
  it('a mode made on A is not listed on B; an old mode switched on by A shows on A only; an old unused one shows on both', () => {
    const usage = modeUsage([entry('pc-a', { activeModes: [OLD_ON_A.id] }), entry('pc-b')]);
    expect(listedOn('pc-a', usage)).toEqual(ids([MADE_ON_A, OLD_ON_A, OLD_UNUSED]));
    // mutation-proof: make modeListedFor return true for any unowned mode (drop `return !users?.size`) and
    // this goes red: the old mode A has switched on is listed on B too.
    expect(listedOn('pc-b', usage)).toEqual(ids([OLD_UNUSED]));
  });

  it('a mode is never hidden where it is switched on, whoever owns it (a copied character, the GM’s edit sheet)', () => {
    const usage = modeUsage([entry('pc-a'), entry('pc-b', { activeModes: [MADE_ON_A.id] })]);
    expect(listedOn('pc-b', usage), 'on through the roster').toContain(MADE_ON_A.id);
    // A sheet the roster does not hold (the GM's edit sheet): the panel's own switched-on ids count.
    expect(listedOn('pc-x', new Map(), new Set([MADE_ON_A.id, OLD_ON_A.id]))).toEqual(ids([MADE_ON_A, OLD_ON_A, OLD_UNUSED]));
    expect(listedOn('pc-x', new Map()), 'and not otherwise').toEqual(ids([OLD_ON_A, OLD_UNUSED]));
  });

  it('a companion’s switched-on mode and a carried mode count as used by their character', () => {
    const usage = modeUsage([
      entry('pc-a', { companionModes: { 'comp-1': [OLD_ON_A.id] } }),
      entry('pc-c', {}, { modes: { [OLD_UNUSED.id]: OLD_UNUSED } }),
      entry('pc-b'),
    ]);
    expect([...(usage.get(OLD_ON_A.id) ?? [])]).toEqual(['pc-a']);
    expect([...(usage.get(OLD_UNUSED.id) ?? [])]).toEqual(['pc-c']);
    expect(listedOn('pc-b', usage)).toEqual([]);
  });

  it('a malformed roster entry is skipped, never guessed at', () => {
    const usage = modeUsage([
      null,
      { id: 7 } as never,
      entry('pc-a', { activeModes: 'not-a-list' as never, companionModes: { k: null as never } }, { modes: [] }),
      entry('pc-b', { activeModes: [OLD_ON_A.id, 3 as never, ''] }),
    ]);
    expect([...usage.keys()]).toEqual([OLD_ON_A.id]);
    expect([...usage.get(OLD_ON_A.id)!]).toEqual(['pc-b']);
  });

  it('no roster known (no usage): the older answer — own modes and unowned ones, never another character’s', () => {
    expect(listedOn('pc-b', undefined as never)).toEqual(ids([OLD_ON_A, OLD_UNUSED]));
    expect(ids(playerModeLibrary([MADE_ON_A, OLD_ON_A, OLD_UNUSED], 'pc-b'))).toEqual(ids([OLD_ON_A, OLD_UNUSED]));
    expect(ids(playerModeLibrary([MADE_ON_A, OLD_ON_A, OLD_UNUSED])), 'no character: every user mode').toEqual(ids([MADE_ON_A, OLD_ON_A, OLD_UNUSED]));
  });
});

describe('a printed mode is never one of "Your modes"', () => {
  it('a background-gated core mode goes to the gated section, where only that background sees it — not every character’s own list', () => {
    const all = Object.values(db.modes) as ModeDef[];
    const bg = all.filter((m) => !m.fromItemId && m.backgrounds?.length);
    expect(bg.map((m) => m.id), 'fixture: the background-gated core modes').toEqual(
      expect.arrayContaining(['awful-scab-sealed-outfit', 'harrow-chosen-partial-match', 'harrow-chosen-unmatched']),
    );
    // mutation-proof: drop `|| m.backgrounds?.length` from isGated (src/rules/modes.ts) and this goes red: the three
    // sit under "Your modes" on every character, with Edit and Delete.
    expect(playerModeLibrary(all).filter((m) => m.backgrounds?.length)).toEqual([]);
    expect(ids(contentGatedModes(all).filter((m) => m.backgrounds?.length))).toEqual(ids(bg));
  });
});

describe('Delete from a character removes a mode only where it belongs', () => {
  it('its own mode, or an unowned one nobody else uses, is deleted; another character’s, or a shared old one, is only taken off', () => {
    const usage = modeUsage([entry('pc-a', { activeModes: [OLD_ON_A.id] }), entry('pc-b', { activeModes: [OLD_ON_A.id] })]);
    expect(modeAlsoElsewhere(MADE_ON_A, 'pc-a', usage), 'A’s own, which no other character uses').toBe(false);
    // Review 2026-10-21: A's OWN mode that B has on (an old one A claimed by switching it off; a duplicate made
    // before copies got their own modes). mutation-proof: put back `|| m.charId === charKey` in the first return
    // of modeAlsoElsewhere (src/rules/modes.ts) and these go red: A's plain Delete took it from B too.
    const onB = modeUsage([entry('pc-a', { activeModes: [MADE_ON_A.id] }), entry('pc-b', { activeModes: [MADE_ON_A.id] })]);
    expect(modeAlsoElsewhere(MADE_ON_A, 'pc-a', onB), 'A’s own that B has on').toBe(true);
    const carriedByB = modeUsage([entry('pc-a'), entry('pc-b', {}, { modes: { [MADE_ON_A.id]: MADE_ON_A } })]);
    expect(modeAlsoElsewhere(MADE_ON_A, 'pc-a', carriedByB), 'A’s own that B carries').toBe(true);
    const onAOnly = modeUsage([entry('pc-a', { activeModes: [MADE_ON_A.id] }), entry('pc-b')]);
    expect(modeAlsoElsewhere(MADE_ON_A, 'pc-a', onAOnly), 'A’s own, on A only').toBe(false);
    expect(modeAlsoElsewhere(MADE_ON_A, undefined, onB), 'no character').toBe(false);
    expect(modeAlsoElsewhere(MADE_ON_A, 'pc-b', usage), 'A’s, seen from B').toBe(true);
    expect(modeAlsoElsewhere(OLD_ON_A, 'pc-a', usage), 'an old one B uses too').toBe(true);
    expect(modeAlsoElsewhere(OLD_ON_A, 'pc-a', modeUsage([entry('pc-a', { activeModes: [OLD_ON_A.id] })])), 'only A uses it').toBe(false);
    expect(modeAlsoElsewhere(OLD_UNUSED, 'pc-a', usage), 'nobody uses it').toBe(false);
  });
});

describe('a mode another character owns (round 2)', () => {
  it('is told apart from this character’s own, an unowned one, and a sheet with no character', () => {
    expect(modeOwnedElsewhere(MADE_ON_A, 'pc-b'), 'A’s, seen from B').toBe(true);
    expect(modeOwnedElsewhere(MADE_ON_A, 'pc-a'), 'A’s own').toBe(false);
    expect(modeOwnedElsewhere(OLD_ON_A, 'pc-b'), 'no owner').toBe(false);
    expect(modeOwnedElsewhere(MADE_ON_A, undefined), 'no character').toBe(false);
    expect(modeOwnedElsewhere(undefined, 'pc-b'), 'no record').toBe(false);
  });
});

describe('Duplicate gives the copy its own copies of the modes the original owns (round 2)', () => {
  const SECOND: ModeDef = { id: 'mode-quiet-step-pc1', name: 'Quiet Step', charId: 'pc-a', modifiers: [{ value: 1, type: 'circumstance', target: 'skill', detail: 'stealth' }] };
  const OTHERS: ModeDef = { id: 'mode-iron-oath-pc1', name: 'Iron Oath', charId: 'pc-b', modifiers: [] };

  it('fresh ids owned by the copy, its play pointed at them; the original, the modes and the others untouched', () => {
    const base = pc('pc-a', 'Corla Venn', [MADE_ON_A.id, OLD_ON_A.id, OTHERS.id]);
    const original = {
      ...base,
      play: { ...base.play!, companionModes: { 'cmp-1': [MADE_ON_A.id] }, tempHp: 5, tempHpFrom: MADE_ON_A.id },
      carried: { modes: { [MADE_ON_A.id]: MADE_ON_A, [OTHERS.id]: OTHERS } },
    } as SavedChar;
    const modes: Record<string, ModeDef> = {
      [MADE_ON_A.id]: MADE_ON_A,
      [SECOND.id]: SECOND,
      [OLD_ON_A.id]: OLD_ON_A,
      [OTHERS.id]: OTHERS,
      'aura-victors-wreath': db.modes['aura-victors-wreath'],
    };
    const frozen = JSON.stringify({ original, modes });

    const { copy, modes: made, ids } = duplicateWithOwnModes(original, modes);
    expect(copy.id, 'fixture: a new roster id').not.toBe(original.id);
    // Only the two A owns: never an unowned one, another character's, or a printed one.
    expect(made.map((m) => m.name).sort()).toEqual([SECOND.name, MADE_ON_A.name].sort());
    for (const m of made) {
      expect(m.charId, `${m.name}: the copy's own`).toBe(copy.id);
      expect(modes[m.id], `${m.name}: under a fresh id`).toBeUndefined();
    }
    expect(Object.keys(ids).sort(), 'ids: each original…').toEqual([MADE_ON_A.id, SECOND.id].sort());
    expect(Object.values(ids).sort(), '…to its copy').toEqual(made.map((m) => m.id).sort());
    const tide = ids[MADE_ON_A.id];
    expect(made.find((m) => m.id === tide)?.modifiers, 'the same mode').toEqual(MADE_ON_A.modifiers);
    // mutation-proof: drop the `repointMode` line from duplicateWithOwnModes (src/data/carried.ts) and this goes red:
    // the copy still has A's mode switched on.
    expect(copy.play?.activeModes, 'switched on as the original’s were, pointed at the copy’s own').toEqual([tide, OLD_ON_A.id, OTHERS.id]);
    expect(copy.play?.companionModes, 'a companion’s too').toEqual({ 'cmp-1': [tide] });
    expect(copy.play?.tempHpFrom, 'and the temporary Hit Points it granted').toBe(tide);
    expect(copy.carried?.modes, 'no longer carrying A’s, which it now has its own copy of').toEqual({ [OTHERS.id]: OTHERS });
    expect(JSON.stringify({ original, modes }), 'the original and the modes are never changed').toBe(frozen);

    // Listed: the copy's own on the copy, A's on A — never each other's.
    const usage = modeUsage([original, copy]);
    const all = playerModeLibrary([...Object.values(modes), ...made]);
    const names = (charKey: string) => all.filter((m) => modeListedFor(m, charKey, usage)).map((m) => `${m.name}:${m.charId === charKey ? 'own' : (m.charId ?? 'none')}`).sort();
    expect(names(copy.id)).toEqual([`${MADE_ON_A.name}:own`, `${SECOND.name}:own`, `${OLD_ON_A.name}:none`, `${OTHERS.name}:pc-b`].sort());
    expect(names('pc-a')).toEqual([`${MADE_ON_A.name}:own`, `${SECOND.name}:own`, `${OLD_ON_A.name}:none`, `${OTHERS.name}:pc-b`].sort());
    for (const m of made) expect(modeListedFor(m, 'pc-a', usage), `${m.name}'s copy is not on A`).toBe(false);
  });

  it('a character with no play state, or owning no mode, is duplicated as before', () => {
    const bare = { ...pc('pc-a', 'Corla Venn'), play: undefined } as SavedChar;
    const out = duplicateWithOwnModes(bare, { [MADE_ON_A.id]: MADE_ON_A });
    expect(out.copy.play).toBeUndefined();
    expect(out.modes.map((m) => m.charId)).toEqual([out.copy.id]);
    const none = duplicateWithOwnModes(pc('pc-c', 'Dov Asher', [OLD_ON_A.id]), { [MADE_ON_A.id]: MADE_ON_A, [OLD_ON_A.id]: OLD_ON_A });
    expect(none.modes).toEqual([]);
    expect(none.copy.play?.activeModes).toEqual([OLD_ON_A.id]);
  });
});

describe('loading writes nothing', () => {
  afterEach(() => localStorage.clear());
  /** Every key and value in storage. */
  const snapshot = () => {
    const out: Record<string, string | null> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      out[k] = localStorage.getItem(k);
    }
    return out;
  };

  it('reading the modes and the roster and working out where each mode shows leaves storage exactly as it was', () => {
    localStorage.setItem('wanderers-codex:modes:v1', JSON.stringify({ [MADE_ON_A.id]: MADE_ON_A, [OLD_ON_A.id]: OLD_ON_A, [OLD_UNUSED.id]: OLD_UNUSED }));
    localStorage.setItem(ROSTER_KEY, JSON.stringify([pc('pc-a', 'Corla Venn', [OLD_ON_A.id]), pc('pc-b', 'Dov Asher')]));
    const before = snapshot();
    const usage = modeUsage(loadRoster());
    expect([...(usage.get(OLD_ON_A.id) ?? [])], 'fixture: the stored roster was read').toEqual(['pc-a']);
    const lib = playerModeLibrary(Object.values(loadModes()));
    expect(ids(lib.filter((m) => modeListedFor(m, 'pc-b', usage))), 'fixture: B is told apart').toEqual(ids([OLD_UNUSED]));
    expect(snapshot(), 'no claim, stamp or tombstone on load').toEqual(before);
    expect(loadModes()[OLD_ON_A.id].charId, 'an old mode stays unowned until a sheet edits it or switches it on').toBeUndefined();
  });
});

describe("the carried view still carries A's mode to the GM and the teammates", () => {
  const MODE: ModeDef = { id: 'mode-harbor-brace-pc1', name: 'Harbor Brace', charId: 'pc-a', modifiers: [{ value: 2, type: 'status', target: 'ac' }] };
  const ownDb = { ...db, modes: { ...db.modes, [MODE.id]: MODE } } as ContentDatabase;
  function sheetA(): SavedChar {
    const sc = pc('pc-a', 'Corla Venn', [MODE.id]);
    return { ...sc, carried: collectCarried(sc, ownDb) } as SavedChar;
  }
  const acIn = (sc: SavedChar, view: ContentDatabase) => computeSummary(applyPlayState(sc.character, sc.play, view), view).ac;

  it('the publish carries the mode with its owner, a viewer without it draws it, and the GM’s panel for A lists it', () => {
    const sc = sheetA();
    expect(sc.carried?.modes?.[MODE.id], 'carried, with its owner').toEqual(MODE);
    const off = { ...sc, play: { ...sc.play!, activeModes: [] } } as SavedChar;
    const teammate = foreignContent(db, sc); // a device that never had the mode
    expect(acIn(sc, teammate), 'the teammate draws the +2').toBe(acIn(off, db) + 2);
    expect(acIn(sc, teammate), 'the same AC as the player').toBe(acIn(sc, ownDb));
    // The GM's edit sheet for A (charKey = A's id), on a device whose own roster never held A.
    const gmUsage = modeUsage([entry('gm-own-pc')]);
    expect(modeListedFor(teammate.modes[MODE.id], 'pc-a', gmUsage, new Set(sc.play!.activeModes)), 'listed on A’s sheet').toBe(true);
    expect(modeListedFor(teammate.modes[MODE.id], 'gm-own-pc', gmUsage), 'never on the GM’s own character').toBe(false);
  });
});
