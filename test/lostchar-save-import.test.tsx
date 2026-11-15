// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { renderDom } from './_render';

/**
 * SAVE AND IMPORT CAN NEVER LOSE A CHARACTER (2026-10-23; Guy's goal: "pressing Save can never wipe a
 * character, and an imported character shows its right numbers at once").
 *
 * 1. A character with no stored build (an old Heroes Heaven file, a hand-made one) whose reverse build
 *    THROWS used to open in the Builder on a blank build that kept only `overrides` and `options`; Save
 *    then replaced the whole character, so its feats, items and spells were gone. Now neither host opens
 *    the Builder on it: the player's sheet (App `onEdit`) and the GM's edit sheet (`openBuilder`) show the
 *    app's own message box instead, and the stored character stays byte-equal (no write, no stamp).
 * 2. A Heroes Heaven file's `character` is the exporting app's derived cache. It was put in the roster as it
 *    was and re-derived only at the next app start, so a file with old Overrides showed its old numbers
 *    until then. The import now re-derives it (transfer.ts `rebuiltImport`, the launch rebuild's own
 *    function) — and is still an EDIT: stamped for upload, never registered as a derived refresh.
 *    "Keep both" renames the build too (the rebuild takes the name from it).
 *
 * The reverse build is made to throw by name (a pass-through mock): the hosts' behaviour is what is
 * measured; test/tweaks-edit-path.test.ts pins `editableBuildOf` on a character it really cannot read.
 * Synthetic characters only.
 */
const seen = vi.hoisted(() => ({
  unreadable: 'TEST Unreadable',
  /** A build of this name throws in buildCharacter. */
  unbuildable: 'TEST Unbuildable',
  /** Every id noteDerivedRefresh was handed, in order (a derived refresh is never stamped). */
  derivedIds: [] as string[],
  rebuildCalls: 0,
}));
vi.mock('../src/rules/build', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/rules/build')>();
  return {
    ...real,
    deriveBuildFromCharacter: (c: { name?: string }, db: unknown) => {
      if (c?.name === seen.unreadable) throw new Error('TEST: this character cannot be read back');
      return real.deriveBuildFromCharacter(c as never, db as never);
    },
    buildCharacter: (b: { name?: string }, db: unknown) => {
      if (b?.name === seen.unbuildable) throw new Error('TEST: this build cannot be built');
      return real.buildCharacter(b as never, db as never);
    },
  };
});
vi.mock('../src/data/cloudSync', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/data/cloudSync')>();
  return {
    ...real,
    noteDerivedRefresh: (roster: { id: string }[], prev?: { id: string }[]) => {
      seen.derivedIds.push(...roster.map((c) => c.id));
      real.noteDerivedRefresh(roster as never, prev as never);
    },
  };
});
vi.mock('../src/data/rebuild', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/data/rebuild')>();
  return {
    ...real,
    rebuildRoster: (...args: Parameters<typeof real.rebuildRoster>) => {
      seen.rebuildCalls++;
      return real.rebuildRoster(...args);
    },
  };
});

const { buildCharacter, emptyBuild } = await import('../src/rules/build');
const { initialPlay, emptyPlay, applyPlayState } = await import('../src/rules/play');
const { deriveMaxHp } = await import('../src/rules/derive');
const { exportNative, exportWg, importCharacter, rebuiltImport } = await import('../src/data/transfer');
const { editableBuildOf } = await import('../src/data/editBuild');
const { ROSTER_KEY } = await import('../src/data/storage');
const { setPref } = await import('../src/data/prefs');
const { setOnPersisted } = await import('../src/data/persist');
const { noteRosterChange } = await import('../src/data/cloudSync');
const { authoredKey } = await import('../src/data/authored');
const { rebuildRoster } = await import('../src/data/rebuild');
const { normalizeCharacter } = await import('../src/rules/normalize');
const { GmEditSheet } = await import('../src/sheet/GmEditSheet');
import type { BuildState } from '../src/rules/build';
import type { SavedChar } from '../src/data/storage';
import type { BuildOverrides, Character } from '../src/rules/types';

const db = content();
const ACTIVE_KEY = 'wanderers-codex:active:v1';
const TIMES_KEY = 'wanderers-codex:char-updated:v1';
const APP_TIMEOUT = 120_000;
const NOTICE = 'This character was saved in a way the builder can’t read back, so it can’t be edited here. Its sheet stays exactly as it is.';

function buildOf(name: string, more: Partial<BuildState> = {}): BuildState {
  return {
    ...emptyBuild(),
    name,
    level: 3,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    classId: 'fighter',
    keyAbility: 'str',
    levelBoosts: ['str', 'dex', 'con', 'wis'],
    inventory: [{ itemId: 'healing-potion-minor', quantity: 2 }],
    ...more,
  } as BuildState;
}
/** A built character stored WITHOUT its build (an old file, a hand-made one). */
function buildless(id: string, name: string): SavedChar {
  const character = buildCharacter(buildOf(name), db);
  return { id, character, play: initialPlay(character, db), archived: false } as SavedChar;
}

let live: Root | null = null;
const cleanups: (() => void)[] = [];
afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch {
      /* already unmounted */
    }
  }
  for (const n of [...document.body.children]) n.remove();
  localStorage.clear();
  setOnPersisted(() => undefined);
  seen.derivedIds = [];
  seen.rebuildCalls = 0;
  vi.unstubAllGlobals();
});

const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
async function until(cond: () => boolean, ms = 6000) {
  for (let t = 0; t < ms && !cond(); t += 50) await wait(50);
}
const click = (el: Element | null | undefined, what: string) => {
  if (!el) throw new Error(`fixture: nothing to click (${what}) — on screen: ${(document.body.textContent ?? '').slice(0, 300)}`);
  act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
const buttonNamed = (text: string) => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === text);
const storedRoster = () => JSON.parse(localStorage.getItem(ROSTER_KEY) ?? '[]') as SavedChar[];
const editButton = (host: HTMLElement) => host.querySelector('button[aria-label="Edit character"], button[aria-label="Edit in builder"]');
const builderOpen = () => !!document.querySelector('.builder-head');

/** Mount the real app on a seeded roster: on the first character's sheet, or on Characters. Every persist
 *  is stamped as cloud sync stamps it (noteRosterChange), so "stamped for upload" is observable. */
async function openApp(roster: SavedChar[], onRoster = false) {
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).split('/').pop() ?? '';
    if (name !== 'core.json' && name !== 'core-descriptions.json') return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`public/${name}`, 'utf8')) as unknown };
  });
  localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  if (roster[0]) localStorage.setItem(ACTIVE_KEY, roster[0].id);
  setPref('startupScreen', onRoster ? 'characters' : 'last');
  setOnPersisted(noteRosterChange);
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  const { default: App } = await import('../src/App');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  live = root;
  await act(async () => {
    root.render(createElement(App));
  });
  const ready = onRoster ? () => !!host.querySelector('.roster-hero-actions .add-item-btn.ghost:not([disabled])') : () => !!editButton(host);
  await until(ready, 10_000);
  await wait(900); // the launch rebuild and its persist
  return host;
}

describe('1 · a character the builder cannot read back is never opened in the Builder', () => {
  it('editableBuildOf: null for an unreadable build-less character; the reverse build when it works; the stored build first', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const bad = buildless('u1', seen.unreadable);
      const before = JSON.stringify(bad);
      expect(editableBuildOf(bad, db), 'nothing to open').toBeNull();
      expect(JSON.stringify(bad), 'and nothing written on the character').toBe(before);
    } finally {
      quiet.mockRestore();
    }
    const ok = editableBuildOf(buildless('r1', 'TEST Readable'), db);
    expect(ok?.derived).toBe(true);
    expect(ok?.build.classId).toBe('fighter');
  });

  it('the player’s sheet: Edit shows the message, the Builder stays closed, the stored character is byte-equal and not stamped', async () => {
    const host = await openApp([buildless('u1', seen.unreadable)]);
    const roster = localStorage.getItem(ROSTER_KEY);
    const times = localStorage.getItem(TIMES_KEY);
    expect(storedRoster()[0].character.feats.length, 'fixture: the character has feats to lose').toBeGreaterThan(0);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      click(editButton(host), 'Edit');
      await wait(100);
      expect(document.querySelector('.confirm-modal')?.textContent, 'the app’s own message box says why').toContain(NOTICE);
      expect(builderOpen(), 'the Builder did not open').toBe(false);
      click(buttonNamed('OK'), 'the message’s OK');
      await wait(900); // any persist would have landed
    } finally {
      quiet.mockRestore();
    }
    expect(document.querySelector('.confirm-modal'), 'OK closes it').toBeNull();
    expect(builderOpen()).toBe(false);
    expect(editButton(host), 'the sheet is still there').not.toBeNull();
    expect(localStorage.getItem(ROSTER_KEY), 'the stored character is byte-equal').toBe(roster);
    expect(localStorage.getItem(TIMES_KEY), 'and nothing was stamped for upload').toBe(times);
  }, APP_TIMEOUT);

  it('a build-less character whose reverse build WORKS still opens in the Builder, as before', async () => {
    const host = await openApp([buildless('r1', 'TEST Readable')]);
    click(editButton(host), 'Edit');
    await until(builderOpen);
    expect(document.querySelector('.confirm-modal'), 'no message').toBeNull();
    expect((document.querySelector('.builder-head input.name-input') as HTMLInputElement | null)?.value).toBe('TEST Readable');
  }, APP_TIMEOUT);

  it('the GM’s edit sheet: Edit in builder shows the message and opens nothing; the working copy is untouched', async () => {
    const sc = buildless('u1', seen.unreadable);
    const before = JSON.stringify(sc);
    const r = renderDom(createElement(GmEditSheet, { initial: sc, live: sc, content: db, campaignId: 'camp-test', playerOwnerId: 'player-test', onExit: () => undefined }));
    cleanups.push(r.stop);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      click(document.querySelector('button[aria-label="Edit in builder"]'), 'Edit in builder');
      await wait(100);
      expect(document.querySelector('.confirm-modal')?.textContent).toContain(NOTICE);
      expect(builderOpen(), 'the GM’s Builder did not open').toBe(false);
      click(buttonNamed('OK'), 'OK');
      await wait(50);
    } finally {
      quiet.mockRestore();
    }
    expect(document.querySelector('.confirm-modal')).toBeNull();
    expect(builderOpen()).toBe(false);
    expect(JSON.stringify(sc), 'the character handed in is byte-equal').toBe(before);
    expect(r.host.textContent, 'the sheet still shows it').toContain(seen.unreadable);
  }, APP_TIMEOUT);
});

/** A Heroes Heaven file exported by an older app: its build holds a max-HP tweak the stored `character`
 *  was never built with (the number the old app showed). */
function staleFile(name: string): { file: string; build: BuildState; stale: Character } {
  const build = buildOf(name, { overrides: { maxHp: 77, v: 2 } as BuildOverrides, options: { overridesEnabled: true } } as Partial<BuildState>);
  const stale = buildCharacter({ ...build, overrides: undefined, options: undefined } as BuildState, db);
  const entry = { id: 'file-1', character: stale, build, play: initialPlay(stale, db), archived: false } as SavedChar;
  return { file: exportNative(entry), build, stale };
}

describe('2 · an import shows its right numbers at once, and is still an edit', () => {
  it('rebuiltImport: only `character` moves; what the player authored is the file’s; a build-less file is left as it is', () => {
    const { file, build, stale } = staleFile('TEST Stale');
    const fromFile = { id: 'x', character: normalizeCharacter(stale), build, play: initialPlay(stale, db), archived: false } as SavedChar;
    const out = rebuiltImport(fromFile, db);
    expect(deriveMaxHp(out.character, db), 'today’s number').toBe(deriveMaxHp(buildCharacter(build, db), db));
    expect(deriveMaxHp(stale, db), 'fixture: the file’s number differs').not.toBe(deriveMaxHp(out.character, db));
    expect(out.build).toBe(fromFile.build);
    expect(out.play).toBe(fromFile.play);
    expect(authoredKey(out), 'what the player authored is unchanged').toBe(authoredKey(fromFile));
    expect(importCharacter(file, db).saved.character.hitPoints, 'importCharacter goes through it').toEqual(out.character.hitPoints);
    const none = buildless('b', 'TEST No Build');
    expect(rebuiltImport(none, db), 'no build: nothing to re-derive from').toBe(none);
  });

  it('notes written on the character itself (an old file) survive the re-derive and every later one', () => {
    const { build, stale } = staleFile('TEST Notes');
    const notes = [{ id: 'n1', title: 'Lore', content: '<p>A storied past.</p>' }];
    const fromFile = { id: 'x', character: { ...stale, notes }, build, play: emptyPlay(), archived: false } as SavedChar;
    const out = rebuiltImport(fromFile, db);
    expect(out.play?.notes, 'moved into play, which the sheet reads first').toEqual(notes);
    expect(rebuildRoster([out], db)[0].play?.notes, 'so the next launch keeps them').toEqual(notes);
    // Play holds its own notes (even none): those are what the sheet shows; nothing is moved.
    const inPlay = { ...fromFile, play: { ...emptyPlay(), notes: [] } } as SavedChar;
    expect(rebuiltImport(inPlay, db).play?.notes).toEqual([]);
  });

  it('a file with NO play state keeps its XP, damage, hero points, notes, bio and portrait (a checker’s finding)', () => {
    // A Wanderer's Guide import keeps all of these on the character with no play state, until its first play
    // edit. Exported to a Heroes Heaven file like that, a bare rebuild showed 0 XP, full HP and no portrait.
    const { build, stale } = staleFile('TEST No Play');
    const notes = [{ id: 'n1', title: 'Lore', content: '<p>A storied past.</p>' }];
    const character = {
      ...stale,
      xp: 250,
      heroPoints: 3,
      hitPoints: { ...stale.hitPoints, current: stale.hitPoints.current - 9 },
      notes,
      details: { ...stale.details, age: '31', birthplace: 'TEST Town' },
      appearance: { portrait: 'data:image/png;base64,AAAA' },
    } as Character;
    const fromFile = { id: 'x', character, build, archived: false } as SavedChar;
    const out = rebuiltImport(fromFile, db);
    const later = rebuildRoster([out], db)[0]; // the next app start
    for (const [when, sc] of [['at import', out], ['after the next launch', later]] as const) {
      const sheet = applyPlayState(sc.character, sc.play, db);
      expect(sheet.xp, `${when}: XP`).toBe(250);
      expect(sheet.heroPoints, `${when}: hero points`).toBe(3);
      expect(sc.play?.damage, `${when}: damage`).toBe(9);
      expect(sheet.notes, `${when}: notes`).toEqual(notes);
      expect(sheet.details?.birthplace, `${when}: bio`).toBe('TEST Town');
      expect(sheet.appearance?.portrait, `${when}: portrait`).toBe('data:image/png;base64,AAAA');
    }
    expect(out.play?.details && 'deityId' in out.play.details, 'the deity stays the build’s').toBe(false);
  });

  it('bio and portrait merge under play’s own fields: a play state holding only an accent colour or an age still keeps them', () => {
    const { build, stale } = staleFile('TEST Merge');
    const character = { ...stale, details: { birthplace: 'TEST Town' }, appearance: { portrait: 'https://example.com/TEST.png' } } as Character;
    const play = { ...initialPlay(stale, db), details: { age: '31' }, appearance: { accentColor: '#123456' } };
    const out = rebuiltImport({ id: 'x', character, build, play, archived: false } as SavedChar, db);
    const sheet = applyPlayState(rebuildRoster([out], db)[0].character, out.play, db);
    expect([sheet.details?.birthplace, sheet.details?.age]).toEqual(['TEST Town', '31']);
    expect(sheet.appearance?.portrait).toBe('https://example.com/TEST.png');
    expect((sheet.appearance as { accentColor?: string } | undefined)?.accentColor, 'play’s own field wins').toBe('#123456');
  });

  it('a play-less file seeds only player state: gear, companions and class resources come from the CURRENT character, never the file’s', () => {
    const { build, stale } = staleFile('TEST Seed');
    const out = rebuiltImport({ id: 'x', character: { ...stale, xp: 40 }, build, archived: false } as SavedChar, db);
    expect(out.play?.xp, 'player state is seeded').toBe(40);
    for (const k of ['inventory', 'companions', 'resources', 'pinnedDescs', 'formulaPicks'] as const) expect(out.play && k in out.play, `${k} is not frozen from the file`).toBe(false);
    // App's lazy seed (its updatePlay) then fills them from the rebuilt character.
    expect(applyPlayState(out.character, out.play, db).inventory.map((i) => i.itemId)).toContain('healing-potion-minor');
  });

  it('a Wanderer’s Guide import keeps its XP, HP, hero points, notes and portrait through the next launch (a checker’s finding)', () => {
    const build = buildOf('TEST From WG');
    const character = buildCharacter(build, db);
    const notes = [{ id: 'n1', title: 'Lore', content: '<p>A storied past.</p>' }];
    const play = { ...initialPlay(character, db), xp: 250, damage: 9, heroPoints: 3, notes, appearance: { portrait: 'https://example.com/TEST.png' } };
    const wg = exportWg({ id: 'w', character, build, play, archived: false } as SavedChar, db);
    const { saved: imp } = importCharacter(wg, db);
    const before = applyPlayState(imp.character, imp.play, db);
    expect([before.xp, before.heroPoints], 'fixture: the WG file brought them').toEqual([250, 3]);
    const [later] = rebuildRoster([imp], db); // the next app start
    const after = applyPlayState(later.character, later.play, db);
    expect(after.xp, 'XP').toBe(250);
    expect(after.heroPoints, 'hero points').toBe(3);
    expect(after.hitPoints.current, 'HP').toBe(before.hitPoints.current);
    expect(after.notes, 'notes').toEqual(before.notes);
    expect(after.appearance?.portrait, 'portrait').toBe(before.appearance?.portrait);
  });

  it('a file whose rebuild throws keeps its character, with the player state it held moved into play', () => {
    const { build, stale } = staleFile('TEST Throws');
    const fromFile = { id: 'x', character: { ...stale, xp: 40 }, build: { ...build, name: seen.unbuildable }, archived: false } as SavedChar;
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const out = rebuiltImport(fromFile, db);
      expect(quiet, 'fixture: the rebuild threw').toHaveBeenCalled();
      expect(out.character).toBe(fromFile.character);
      expect(out.play?.xp, 'a later launch that can build it keeps the XP').toBe(40);
    } finally {
      quiet.mockRestore();
    }
  });

  it('a normal import is unchanged: a current file comes back as it was, and a Wanderer’s Guide import is never re-derived', () => {
    const build = buildOf('TEST Current');
    const character = buildCharacter(build, db);
    const entry = { id: 'cur', character, build, play: initialPlay(character, db), archived: false } as SavedChar;
    expect(importCharacter(exportNative(entry), db).saved.character, 'a current file: the same character').toEqual(normalizeCharacter(character));
    const wg = exportWg(entry, db);
    seen.rebuildCalls = 0;
    importCharacter(wg, db);
    expect(seen.rebuildCalls, 'the WG import is already freshly built (and patched after); it is never re-derived').toBe(0);
  });

  it('in the app: the roster card shows the rebuilt max HP at once; the import is stamped for upload, never a derived refresh; Keep both renames the build too', async () => {
    const { file, build, stale } = staleFile('TEST Stale');
    const fresh = deriveMaxHp(buildCharacter(build, db), db);
    expect(deriveMaxHp(stale, db), 'fixture: the file shows another max HP').not.toBe(fresh);
    const host = await openApp([], true);
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error(`fixture: no file input on Characters — on screen: ${(host.textContent ?? '').slice(0, 300)}`);
    const t0 = Date.now();
    const pick = () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [new File([file], 'stale.json', { type: 'application/json' })] });
      act(() => void input.dispatchEvent(new Event('change', { bubbles: true })));
    };
    pick();
    await until(() => storedRoster().length === 1);
    await wait(900); // the persist
    const [got] = storedRoster();
    expect(host.querySelector('.rcard-hp')?.textContent?.trim(), 'the card shows the rebuilt max HP').toMatch(new RegExp(`/ ${fresh}$`));
    expect(deriveMaxHp(got.character, db), 'and so does the stored character').toBe(fresh);
    const times = JSON.parse(localStorage.getItem(TIMES_KEY) ?? '{}') as Record<string, number>;
    expect(times[got.id], 'stamped for upload, as an import always was').toBeGreaterThanOrEqual(t0);
    expect(seen.derivedIds, 'never registered as a derived refresh').not.toContain(got.id);

    // The same file again, "Keep both": the copy's build carries its new name, so the next launch's rebuild
    // (which takes the name from the build) keeps it.
    pick();
    await until(() => !!buttonNamed('Keep both'));
    click(buttonNamed('Keep both'), 'Keep both');
    await until(() => storedRoster().length === 2);
    await wait(900);
    const copy = storedRoster().find((c) => c.id !== got.id)!;
    expect(copy.character.name, 'fixture: renamed').not.toBe('TEST Stale');
    expect(copy.build?.name, 'the build has the same new name').toBe(copy.character.name);
    expect(buildCharacter(copy.build!, db).name, 'so a rebuild keeps it').toBe(copy.character.name);
  }, APP_TIMEOUT);
});
