// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { computeSummary } from '../src/sheet/partySummary';
import { ROSTER_KEY, loadModes, loadRevived, loadRoster, loadTombstones, type SavedChar } from '../src/data/storage';
import { flushPersist } from '../src/data/persist';
import { setPref } from '../src/data/prefs';
import { modeUsage } from '../src/data/carried';
import { modeListedFor } from '../src/rules/modes';
import type { ModeDef } from '../src/rules/types';
import { createElement } from 'react';
import { renderDom } from './_render';
import { SettingsPage } from '../src/sheet/SettingsPage';
import { ModesPanel } from '../src/sheet/ModesPanel';
import { GmEditSheet } from '../src/sheet/GmEditSheet';
import { ModeUsageContext, ModesRemoveFromCharacterContext } from '../src/sheet/CopyOnWriteItems';

/**
 * Guy, 2026-10-21: "modes need to be per character so a mode i made on one shouldnt apear on another" — on the
 * real <App/> (the harness of test/carried-app.test.tsx, the party and cloud layers mocked): a mode made in one
 * character's Modes panel is that character's, an old mode with no owner shows where it is switched on (or
 * everywhere when nowhere) and becomes a character's own when that character switches it on, Delete takes a
 * mode another character has too off this character only, and opening the app writes nothing to the modes.
 * Round 2: a mode ANOTHER character owns, switched on here, is copied (never changed) when it is switched off or
 * edited here; Duplicate gives the copy its own modes; a pin shows only where the panel lists the mode anyway;
 * Settings never says "All characters"; the GM's edit sheet never deletes one of his own characters' modes.
 * The pure rules are test/modes-per-character.test.ts. Every character and mode here is synthetic.
 */
vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'player@example.com' }),
}));
vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  fetchGmEdits: async () => [],
  fetchPublishedSheet: async () => ({ sheet: null, updatedAt: undefined, ownerId: undefined }),
  publishCharacter: async () => 'ok',
  unpublishCharacter: async () => 'ok',
  deleteGmEdit: async () => 1,
  markGmEditRefused: async () => true,
  currentUserId: async () => null, // no Realtime subscription in the test
}));
vi.mock('../src/data/cloudSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloudSync')>()),
  startCloudSync: async () => () => undefined,
  pullForGmApply: () => null,
}));

// Production update priorities (see test/bug-gm-edit-race.test.tsx): `window.event` is jsdom's real one.
const jsdomWindow = (globalThis as unknown as { jsdom?: { window: { event?: Event } } }).jsdom?.window;
if (!jsdomWindow) throw new Error('fixture: the jsdom environment exposes no `jsdom` global');
Object.defineProperty(window, 'event', { configurable: true, get: () => jsdomWindow?.event, set: () => undefined });

const ACTIVE_KEY = 'wanderers-codex:active:v1';
const MODES_KEY = 'wanderers-codex:modes:v1';
const APP_TIMEOUT = 180_000;
const db = content();

const A = { id: 'pc-maren-a', name: 'Maren Holt' };
const B = { id: 'pc-tobin-b', name: 'Tobin Reyes' };
const OLD_ON_A: ModeDef = { id: 'mode-old-lantern-app', name: 'Old Lantern', modifiers: [{ value: 1, type: 'status', target: 'perception' }] };
const OLD_UNUSED: ModeDef = { id: 'mode-old-cairn-app', name: 'Old Cairn', modifiers: [{ value: 1, type: 'status', target: 'ac' }] };
const OLD_SHARED: ModeDef = { id: 'mode-old-hearth-app', name: 'Old Hearth', modifiers: [{ value: 1, type: 'status', target: 'save', detail: 'will' }] };

function saved(who: { id: string; name: string }, activeModes: string[] = []): SavedChar {
  const build = {
    ...emptyBuild(),
    name: who.name,
    level: 1,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    classId: 'fighter',
    keyAbility: 'str',
  } as BuildState;
  const character = buildCharacter(build, db);
  return { id: who.id, character, build, play: { ...initialPlay(character, db), activeModes } } as SavedChar;
}

let live: Root | null = null;
afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  localStorage.clear();
  setPref('pinnedModes', []);
  setPref('startupScreen', 'last');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const press = (el: Element | null | undefined) => act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
/** The mode editor's Delete asks first (bug 2026-10-23, ModesPanel.tsx `askDelete`): answer the app's own dialog,
 *  then let the answer's promise land. */
const answerDelete = async (label: 'Delete' | 'Remove') => {
  await wait(0);
  const btn = [...document.querySelectorAll('.confirm-modal button')].find((b) => (b.textContent ?? '').trim() === label);
  expect(btn, `the confirm offers "${label}"`).toBeTruthy();
  press(btn);
  await wait(0);
};
const setInput = (el: HTMLInputElement, value: string) => {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

function stubData() {
  const files: Record<string, string> = {
    'core.json': 'public/core.json',
    'core-descriptions.json': 'public/core-descriptions.json',
  };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = files[String(url).split('/').pop() ?? ''];
    if (!path) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf8')) as unknown };
  });
}

/** Seed the saved modes, then re-merge the cached database from storage — what a fresh launch reads. */
async function seedModes(modes: ModeDef[]) {
  stubData();
  const { loadContent } = await import('../src/data');
  await loadContent();
  localStorage.setItem(MODES_KEY, JSON.stringify(Object.fromEntries(modes.map((m) => [m.id, m]))));
}

/** Launch the app on `activeId` over `roster` (a relaunch: the database is re-merged from storage first).
 *  `ready`: what says the first screen is up — the sheet's Inventory tab unless a test opens elsewhere. */
async function openApp(roster: SavedChar[], activeId: string, ready?: (host: HTMLElement) => boolean) {
  if (live) act(() => live!.unmount());
  stubData();
  const { rebuildContent } = await import('../src/data');
  rebuildContent();
  localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  localStorage.setItem(ACTIVE_KEY, activeId);
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
    root.render(<App />);
  });
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
  const up = () => (ready ? ready(host) : !!button('Inventory'));
  for (let i = 0; i < 200 && !up(); i++) await wait(50);
  await wait(300);
  return host;
}

/** Main → conditions "Add" → the Modes tab; the names of the modes listed under "Your modes" and Pinned. */
async function openModes(host: HTMLElement): Promise<string[]> {
  const main = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Main');
  press(main);
  const add = [...host.querySelectorAll<HTMLButtonElement>('button.add-btn')].find((b) => (b.textContent ?? '').trim() === 'Add');
  expect(add, 'fixture: the conditions Add button').toBeTruthy();
  press(add);
  await wait(50);
  const modal = document.querySelector('.cond-modal');
  press([...(modal?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === 'Modes'));
  await wait(50);
  expect(document.querySelector('.modes-panel'), 'fixture: the Modes panel').not.toBeNull();
  return listedModes();
}
const listedModes = () =>
  [...document.querySelectorAll<HTMLElement>('.modes-panel .mode-row')]
    .filter((r) => r.querySelector('.mode-edit')) // a user mode: the only rows with an Edit button
    .map((r) => r.querySelector('.mode-name')?.firstChild?.textContent ?? '');
const rowOf = (name: string) => [...document.querySelectorAll<HTMLElement>('.modes-panel .mode-row')].find((r) => (r.textContent ?? '').includes(name));
const roster = () => {
  flushPersist();
  return loadRoster();
};

describe('a user mode belongs to the character it was made on', () => {
  it('a mode made in A’s panel is saved as A’s, listed on A, and not listed on B', async () => {
    await seedModes([OLD_UNUSED]);
    let host = await openApp([saved(A), saved(B)], A.id);
    await openModes(host);
    press([...document.querySelectorAll('.modes-panel button')].find((b) => (b.textContent ?? '').includes('New mode')));
    await wait(50);
    // The editor says whose it will be — no "All characters" choice in a character's own panel.
    expect(document.querySelector('.mode-editor .me-scope-fixed')?.textContent).toBe(`Only ${A.name}`);
    const options = [...document.querySelectorAll('.mode-editor option')].map((o) => o.textContent);
    expect(options, 'no "All characters" choice').not.toContain('All characters');
    setInput(document.querySelector<HTMLInputElement>('.mode-editor input[placeholder="e.g. Inspired"]')!, 'Tide Step');
    press(document.querySelector('.mode-editor .btn-primary'));
    await wait(50);

    const made = Object.values(loadModes()).find((m) => m.name === 'Tide Step');
    expect(made, 'fixture: the mode was saved').toBeTruthy();
    // mutation-proof (run 2026-10-21): drop BOTH owners a new mode gets in ModesPanel (src/sheet/ModesPanel.tsx) — the
    // "New mode" draft's `charId` and Save's `claims(editing)` stamp — and this goes red: saved with no owner.
    expect(made!.charId, 'A’s own').toBe(A.id);
    expect(listedModes(), 'listed on A').toContain('Tide Step');

    const after = roster();
    host = await openApp(after, B.id); // a relaunch on B
    const { rebuildContent } = await import('../src/data');
    expect(rebuildContent().modes[made!.id], 'fixture: the relaunched database holds the mode').toBeTruthy();
    const onB = await openModes(host);
    expect(onB, 'fixture (positive control): B’s panel lists user modes').toContain(OLD_UNUSED.name);
    // mutation-proof (run 2026-10-21): drop `modeListedFor(…)` from ModesPanel's library filter and this goes red.
    expect(onB, 'never on B').not.toContain('Tide Step');
  }, APP_TIMEOUT);

  it('an old mode A has on is listed on A only, an old unused one on both — and opening the app writes nothing to the modes', async () => {
    await seedModes([OLD_ON_A, OLD_UNUSED]);
    const seeded = localStorage.getItem(MODES_KEY);
    let host = await openApp([saved(A, [OLD_ON_A.id]), saved(B)], A.id);
    const onA = await openModes(host);
    expect(onA.sort()).toEqual([OLD_ON_A.name, OLD_UNUSED.name].sort());
    expect(rowOf(OLD_UNUSED.name)?.querySelector('.mode-scope-tag')?.textContent?.trim(), 'an old mode says it has no owner').toBe('not tied to a character');

    host = await openApp(roster(), B.id);
    const onB = await openModes(host);
    // mutation-proof: drop `modeListedFor(m, charKey, usage, active)` from ModesPanel's library filter
    // (src/sheet/ModesPanel.tsx) and this goes red: B lists the old mode A has switched on.
    expect(onB, 'only the old mode nobody uses').toEqual([OLD_UNUSED.name]);

    // Two launches and two panels later, not one byte of the saved modes moved, and nothing was tombstoned.
    expect(localStorage.getItem(MODES_KEY), 'loading writes nothing').toBe(seeded);
    expect(Object.keys(loadTombstones()).filter((k) => k.startsWith('mode:'))).toEqual([]);
    expect(Object.keys(loadRevived()).filter((k) => k.startsWith('mode:'))).toEqual([]);

    // Switching the unused old mode on from B makes it B's (a real player edit, so now it IS written).
    press(rowOf(OLD_UNUSED.name)!.querySelector('.mode-toggle'));
    await wait(50);
    // mutation-proof: drop the claim in ModesPanel's toggle (`if (editable && claims(mode)) onSave(…)`)
    // and this goes red: the mode stays unowned, so once B switches it off again it is back on A's list.
    expect(loadModes()[OLD_UNUSED.id].charId, 'B’s now').toBe(B.id);
    const now = roster();
    expect(now.find((c) => c.id === B.id)!.play?.activeModes, 'and on').toContain(OLD_UNUSED.id);
    const off = now.map((c) => (c.id === B.id ? { ...c, play: { ...c.play!, activeModes: [] } } : c));
    expect(modeListedFor(loadModes()[OLD_UNUSED.id], A.id, modeUsage(off)), 'switched off again, it stays off A').toBe(false);
  }, APP_TIMEOUT);

  it('Delete on A of an old mode B has on too takes it off A only: the mode and B keep it, and nothing is tombstoned', async () => {
    await seedModes([OLD_SHARED]);
    const host = await openApp([saved(A, [OLD_SHARED.id]), saved(B, [OLD_SHARED.id])], A.id);
    expect(await openModes(host), 'fixture: listed on A').toContain(OLD_SHARED.name);
    press(rowOf(OLD_SHARED.name)!.querySelector('.mode-edit'));
    await wait(50);
    const del = document.querySelector<HTMLButtonElement>('.mode-editor .me-delete');
    // mutation-proof: drop `elsewhere` from ModesPanel's `removeOnly` (src/sheet/ModesPanel.tsx) and this goes red:
    // the button says plain "Delete".
    expect(del?.textContent?.trim(), 'it says what it does').toBe('Remove from this character');
    press(del);
    await answerDelete('Remove');
    await wait(50);
    const after = roster();
    // mutation-proof: drop `|| elsewhere` from App's removeOwnModeDef (src/App.tsx) and this goes red: the mode is
    // deleted from the device (and tombstoned), so B loses it too.
    expect(loadModes()[OLD_SHARED.id], 'the mode is still saved').toBeTruthy();
    expect(Object.keys(loadTombstones()).filter((k) => k.includes(OLD_SHARED.id)), 'never tombstoned').toEqual([]);
    expect(after.find((c) => c.id === A.id)!.play?.activeModes ?? [], 'off A').not.toContain(OLD_SHARED.id);
    expect(after.find((c) => c.id === B.id)!.play?.activeModes, 'still on B').toContain(OLD_SHARED.id);
  }, APP_TIMEOUT);
});

describe('a mode A owns or shares that B also has on (review, 2026-10-21)', () => {
  /** A's own mode, switched on on A and B: an old one A claimed by switching it, or a duplicate made before copies
   *  got their own modes. */
  const RAGE_A: ModeDef = { id: 'mode-rage-a4', name: 'Rage', charId: A.id, modifiers: [{ value: 2, type: 'status', target: 'ac' }] };
  const RAGE_OLD: ModeDef = { id: 'mode-rage-old4', name: 'Rage', modifiers: [{ value: 2, type: 'status', target: 'ac' }] };
  /** B's AC as the sheet draws it, from the stored roster entry and the saved modes. */
  const acOfB = (r: SavedChar[]) => {
    const b = r.find((c) => c.id === B.id)!;
    const view = { ...db, modes: { ...db.modes, ...loadModes() } };
    return computeSummary(applyPlayState(b.character, b.play, view), view).ac;
  };

  it('A’s "Remove from this character" of its own mode leaves B’s intact: still saved, still on B, never deleted', async () => {
    await seedModes([RAGE_A]);
    const host = await openApp([saved(A, [RAGE_A.id]), saved(B, [RAGE_A.id])], A.id);
    expect(await openModes(host), 'fixture: listed on A').toEqual([RAGE_A.name]);
    press(rowOf(RAGE_A.name)!.querySelector('.mode-edit'));
    await wait(50);
    const del = document.querySelector<HTMLButtonElement>('.mode-editor .me-delete');
    // mutation-proof: put back `|| m.charId === charKey` in modeAlsoElsewhere's first return (src/rules/modes.ts) and
    // this goes red: plain "Delete", and pressing it deletes the mode, so B loses it.
    expect(del?.textContent?.trim(), 'it says what it does').toBe('Remove from this character');
    press(del);
    await answerDelete('Remove');
    await wait(50);
    const after = roster();
    const kept = loadModes()[RAGE_A.id];
    expect(kept, 'the mode is still saved').toBeTruthy();
    expect(kept.modifiers, 'B’s numbers unchanged').toEqual(RAGE_A.modifiers);
    expect(Object.keys(loadTombstones()).filter((k) => k.includes(RAGE_A.id)), 'never tombstoned').toEqual([]);
    expect(after.find((c) => c.id === B.id)!.play?.activeModes, 'still on B').toEqual([RAGE_A.id]);
    expect(after.find((c) => c.id === A.id)!.play?.activeModes ?? [], 'off A').toEqual([]);
    // A has left it, so it is no longer A's: B, its one other user, owns it now, and it is gone from A's list.
    // mutation-proof: drop the `releaseHere(modeId)` call from App's removeOwnModeDef (src/App.tsx) and this goes
    // red: it stays A's, so A still lists it, switched off — "Remove" removed nothing from A's list.
    // mutation-proof (round 4): make releaseHere always save it with no owner and this goes red: undefined.
    expect(kept.charId, 'B’s now, its only other user').toBe(B.id);
    expect(listedModes(), 'gone from A’s list').toEqual([]);
    expect(modeListedFor(kept, B.id, modeUsage(after)), 'still on B’s list').toBe(true);
    // B deleted from the roster later: the mode stays B's, so it never shows up on every character (checker,
    // round 4: left with no owner and no user it was listed everywhere, beside A's own and on C).
    const withoutB = after.filter((c) => c.id !== B.id);
    expect(modeListedFor(kept, A.id, modeUsage(withoutB)), 'not back on A').toBe(false);
    expect(modeListedFor(kept, 'pc-third-c', modeUsage(withoutB)), 'not on another character').toBe(false);
  }, APP_TIMEOUT);

  it('A leaving its own mode that TWO others have on saves it with no owner, listed on both and not on A', async () => {
    const C = { id: 'pc-wren-c4', name: 'Wren Ostrova' };
    await seedModes([RAGE_A]);
    const host = await openApp([saved(A, [RAGE_A.id]), saved(B, [RAGE_A.id]), saved(C, [RAGE_A.id])], A.id);
    expect(await openModes(host), 'fixture: listed on A').toEqual([RAGE_A.name]);
    press(rowOf(RAGE_A.name)!.querySelector('.mode-edit'));
    await wait(50);
    press(document.querySelector('.mode-editor .me-delete'));
    await answerDelete('Remove');
    await wait(50);
    const after = roster();
    const kept = loadModes()[RAGE_A.id];
    expect(kept?.modifiers, 'numbers untouched').toEqual(RAGE_A.modifiers);
    expect(kept.charId, 'no single owner to hand it to').toBeUndefined();
    const usage = modeUsage(after);
    expect([A.id, B.id, C.id].map((id) => modeListedFor(kept, id, usage)), 'on B and C, not A').toEqual([false, true, true]);
    expect([B.id, C.id].map((id) => after.find((c) => c.id === id)!.play?.activeModes), 'still on for both').toEqual([[RAGE_A.id], [RAGE_A.id]]);
  }, APP_TIMEOUT);

  for (const [what, mode] of [
    ['A’s own', RAGE_A],
    ['an old unowned one', RAGE_OLD],
  ] as const) {
    it(`an edit on A of ${what} that B also has on makes A its own copy; B’s record and numbers are untouched`, async () => {
      await seedModes([mode]);
      const start = [saved(A, [mode.id]), saved(B, [mode.id])];
      const acB = acOfB(start);
      const off = start.map((c) => (c.id === B.id ? { ...c, play: { ...c.play!, activeModes: [] } } : c));
      expect(acB, 'fixture: B’s AC counts the +2').toBe(acOfB(off) + 2);
      let host = await openApp(start, A.id);
      await openModes(host);
      press(rowOf(mode.name)!.querySelector('.mode-edit'));
      await wait(50);
      expect(document.querySelector('.mode-editor .me-scope-fixed')?.textContent, 'the edit is A’s').toBe(`Only ${A.name}`);
      setInput(document.querySelector<HTMLInputElement>('.mode-editor .me-val')!, '3');
      press(document.querySelector('.mode-editor .btn-primary'));
      await wait(50);
      const modes = loadModes();
      // mutation-proof: drop the `saveAsCopy` branch from ModesPanel's editor onSave (src/sheet/ModesPanel.tsx) and
      // this goes red: the record B uses is saved with +3, and B's AC changes with A's edit.
      expect(modes[mode.id].modifiers, 'the record B uses keeps +2').toEqual(mode.modifiers);
      expect(modes[mode.id].name).toBe(mode.name);
      // A has left it for its copy: A's own becomes B's (its one other user, round 4), an old unowned one stays
      // unowned; either way listed where it is used (B), not on A beside the copy.
      expect(modes[mode.id].charId, mode.charId ? 'B’s now' : 'still no one’s').toBe(mode.charId ? B.id : undefined);
      const copy = Object.values(modes).find((m) => m.id !== mode.id && m.name === mode.name);
      expect(copy && [copy.charId, copy.modifiers[0].value], 'A’s own copy, edited').toEqual([A.id, 3]);
      const after = roster();
      expect(after.find((c) => c.id === A.id)!.play?.activeModes, 'A points at its copy').toEqual([copy!.id]);
      expect(after.find((c) => c.id === B.id)!.play?.activeModes, 'B keeps the original').toEqual([mode.id]);
      expect(listedModes(), 'A lists one Rage, its copy').toEqual([mode.name]);
      expect(acOfB(after), 'B’s AC is what it was').toBe(acB);
      host = await openApp(after, B.id);
      expect(await openModes(host), 'B still lists the original').toEqual([mode.name]);
      expect(rowOf(mode.name)?.querySelector('.mode-mods')?.textContent, 'with its +2').toMatch(/\+2/);
    }, APP_TIMEOUT);
  }
});

describe('a mode another character owns, switched on here (round 2)', () => {
  /** A's own mode, switched on on B too — what a duplicate made before round 2 left behind. */
  const A_OWN: ModeDef = { id: 'mode-ember-ward-a2', name: 'Ember Ward', charId: A.id, modifiers: [{ value: 1, type: 'status', target: 'ac' }] };
  const onBoth = () => [saved(A, [A_OWN.id]), saved(B, [A_OWN.id])];

  it('B switching it off gives B its own copy: still listed on B, switched off — A’s record and A untouched', async () => {
    await seedModes([A_OWN]);
    const host = await openApp(onBoth(), B.id);
    expect(await openModes(host), 'fixture: listed on B while it is on there').toEqual([A_OWN.name]);
    press(rowOf(A_OWN.name)!.querySelector('.mode-toggle'));
    await wait(50);
    // mutation-proof: drop the `copiesOnSwitchOff` save from ModesPanel's toggle (src/sheet/ModesPanel.tsx), or
    // `|| ownedElsewhere` from App's saveOwnModeDef (src/App.tsx), and this goes red: B's list is empty.
    expect(listedModes(), 'still listed on B').toEqual([A_OWN.name]);
    expect(rowOf(A_OWN.name)?.querySelector('.mode-toggle.on'), 'switched off').toBeNull();
    const modes = loadModes();
    expect(modes[A_OWN.id], 'A’s record unchanged').toEqual(A_OWN);
    const copies = Object.values(modes).filter((m) => m.id !== A_OWN.id);
    expect(copies.map((m) => [m.name, m.charId, m.modifiers]), 'B’s own copy').toEqual([[A_OWN.name, B.id, A_OWN.modifiers]]);
    const after = roster();
    expect(after.find((c) => c.id === A.id)!.play?.activeModes, 'still on A').toEqual([A_OWN.id]);
    expect(after.find((c) => c.id === B.id)!.play?.activeModes ?? [], 'off B').toEqual([]);
    expect(Object.keys(loadTombstones()).filter((k) => k.startsWith('mode:')), 'nothing deleted').toEqual([]);
  }, APP_TIMEOUT);

  it('an edit on B makes B its own copy, which B points at; A’s record is never written', async () => {
    await seedModes([A_OWN]);
    const host = await openApp(onBoth(), B.id);
    await openModes(host);
    press(rowOf(A_OWN.name)!.querySelector('.mode-edit'));
    await wait(50);
    expect(document.querySelector('.mode-editor .me-scope-fixed')?.textContent, 'the editor says the edit is B’s').toBe(`Only ${B.name}`);
    expect(document.querySelector('.mode-editor .me-delete')?.textContent?.trim(), 'and Delete only takes it off B').toBe('Remove from this character');
    setInput(document.querySelector<HTMLInputElement>('.mode-editor .me-val')!, '3');
    press(document.querySelector('.mode-editor .btn-primary'));
    await wait(50);
    const modes = loadModes();
    // mutation-proof: drop `|| ownedElsewhere` from App's saveOwnModeDef (src/App.tsx) and this goes red: A's mode
    // itself is saved with +3, and A's AC changes with B's edit.
    expect(modes[A_OWN.id], 'A’s record unchanged').toEqual(A_OWN);
    const copy = Object.values(modes).find((m) => m.id !== A_OWN.id);
    expect(copy && [copy.name, copy.charId, copy.modifiers[0].value], 'B’s copy, edited').toEqual([A_OWN.name, B.id, 3]);
    const after = roster();
    expect(after.find((c) => c.id === B.id)!.play?.activeModes, 'B points at its copy').toEqual([copy!.id]);
    expect(after.find((c) => c.id === A.id)!.play?.activeModes, 'A keeps its own').toEqual([A_OWN.id]);
  }, APP_TIMEOUT);
});

describe('Duplicate gives the copy its own modes (round 2)', () => {
  it('the copy gets its own copies of the modes the original owns, switched on as they were; the original’s stay its own', async () => {
    const A_OWN: ModeDef = { id: 'mode-salt-guard-a3', name: 'Salt Guard', charId: A.id, modifiers: [{ value: 2, type: 'circumstance', target: 'ac' }] };
    await seedModes([A_OWN, OLD_UNUSED]);
    setPref('startupScreen', 'characters'); // land on the Characters list, where Duplicate is
    const host = await openApp([saved(A, [A_OWN.id])], A.id, (h) => !!h.querySelector('.rcard button[title="Duplicate"]'));
    const seeded = localStorage.getItem(MODES_KEY);
    const card = [...host.querySelectorAll('.rcard')].find((c) => (c.querySelector('.rcard-name')?.textContent ?? '').includes(A.name));
    expect(card, 'fixture: A’s card').toBeTruthy();
    expect(localStorage.getItem(MODES_KEY), 'fixture: opening the list wrote no mode').toBe(seeded);
    press(card!.querySelector('button[title="Duplicate"]'));
    await wait(50);

    const after = roster();
    expect(after, 'fixture: a copy was made').toHaveLength(2);
    const copy = after.find((c) => c.id !== A.id)!;
    const modes = loadModes();
    expect(modes[A_OWN.id], 'the original’s mode is untouched').toEqual(A_OWN);
    expect(modes[OLD_UNUSED.id], 'a mode it does not own is not copied').toEqual(OLD_UNUSED);
    const own = Object.values(modes).filter((m) => m.charId === copy.id);
    // mutation-proof: put `setRoster((r) => [...r, duplicateChar(c)])` back in App's onDuplicate (src/App.tsx) and
    // this goes red: the copy owns no mode, and A's is switched on on both.
    expect(own.map((m) => [m.name, m.modifiers]), 'the copy’s own copy').toEqual([[A_OWN.name, A_OWN.modifiers]]);
    expect(copy.play?.activeModes, 'switched on, pointed at its own').toEqual([own[0].id]);
    expect(after.find((c) => c.id === A.id)!.play?.activeModes, 'the original keeps its own').toEqual([A_OWN.id]);
    expect(modeListedFor(A_OWN, copy.id, modeUsage(after)), 'A’s mode is not on the copy’s list').toBe(false);
    expect(modeListedFor(own[0], A.id, modeUsage(after)), 'nor the copy’s on A’s').toBe(false);
  }, APP_TIMEOUT);
});

describe('Settings → Modes never promises a mode to "All characters"', () => {
  it('the owner choice for a mode with no owner says "Not tied to a character" and what that means', () => {
    // A mode with no owner becomes the first character's that switches it on or edits it, so "All characters"
    // would promise the very sharing Guy reported as the bug (checker, round 2).
    const { host, click, stop } = renderDom(
      createElement(SettingsPage, { onClose: () => undefined, modes: { [OLD_UNUSED.id]: OLD_UNUSED }, characters: [A, B] }),
    );
    try {
      const byText = (t: string) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === t) ?? null;
      click(byText('Modes'));
      // mutation-proof (round 2): put 'All characters' back as Settings' group title or description
      // (src/sheet/SettingsPage.tsx ModesSection) and this goes red.
      expect(host.textContent, 'the list never says "All characters"').not.toContain('All characters');
      click(byText('New mode'));
      const options = [...host.querySelectorAll<HTMLOptionElement>('.mode-editor select option')].map((o) => o.textContent?.trim());
      // mutation-proof: render `{s.name}` again in ModeEditor's owner <option> (src/sheet/ModesPanel.tsx) AND put
      // 'All characters' back as Settings' null scope name, and this goes red.
      expect(options, 'the owner choice').toContain('Not tied to a character');
      expect(options).not.toContain('All characters');
      expect(options, 'each character is still offered').toEqual(expect.arrayContaining([A.name, B.name]));
      // No character open: a new mode starts as the first character's, never "Not tied to a character".
      const select = host.querySelector<HTMLSelectElement>('.mode-editor select')!;
      expect(select.selectedOptions[0]?.textContent?.trim(), 'starts as the first character’s').toBe(A.name);
      expect(host.querySelector('.mode-editor .me-scope-hint'), 'no "not tied" hint for an owned mode').toBeNull();
      // "Not tied to a character" is still there to pick on purpose, and says what it means.
      const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      act(() => {
        setSelect.call(select, '');
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      // mutation-proof: drop the `me-scope-hint` span and this goes red.
      expect(host.querySelector('.mode-editor .me-scope-hint')?.textContent, 'it says what no owner means').toMatch(
        /until one of them switches it on or off, or edits it/,
      );
      expect(host.textContent, 'nor does the editor').not.toContain('All characters');
    } finally {
      stop();
    }
  });

  it('"New mode" starts as the open character’s, and Save keeps that owner (review, 2026-10-21)', () => {
    const saves: ModeDef[] = [];
    const { host, click, stop } = renderDom(
      createElement(SettingsPage, { onClose: () => undefined, modes: {}, characters: [A, B], activeCharId: B.id, onSaveMode: (m: ModeDef) => saves.push(m) }),
    );
    try {
      const byText = (t: string) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === t) ?? null;
      click(byText('Modes'));
      click(byText('New mode'));
      // mutation-proof: drop `...(newOwner ? { charId: newOwner } : {})` from Settings' "New mode" draft
      // (src/sheet/SettingsPage.tsx ModesSection) and this goes red: it starts "Not tied to a character", shown
      // on every character.
      expect(host.querySelector<HTMLSelectElement>('.mode-editor select')?.selectedOptions[0]?.textContent?.trim(), 'the open character').toBe(B.name);
      setInput(host.querySelector<HTMLInputElement>('.mode-editor input[placeholder="e.g. Inspired"]')!, 'Quiet Ward');
      click(host.querySelector('.mode-editor .btn-primary'));
      expect(saves.map((m) => [m.name, m.charId])).toEqual([['Quiet Ward', B.id]]);
    } finally {
      stop();
    }
  });

  it('a character not on this device as "open" falls back to the first, and no characters means no owner', () => {
    for (const [characters, want] of [
      [[A, B], A.name],
      [[], 'Not tied to a character'],
    ] as const) {
      const { host, click, stop } = renderDom(
        createElement(SettingsPage, { onClose: () => undefined, modes: {}, characters: [...characters], activeCharId: 'pc-gone' }),
      );
      try {
        const byText = (t: string) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === t) ?? null;
        click(byText('Modes'));
        click(byText('New mode'));
        // The "Available to" owner select (the editor's other select is the template list).
        const select = [...host.querySelectorAll<HTMLElement>('.mode-editor .me-field')]
          .find((f) => f.querySelector('.me-label')?.textContent === 'Available to')
          ?.querySelector<HTMLSelectElement>('select');
        // No characters: the owner list has the one "not tied" choice, so there is no select at all.
        expect(select ? select.selectedOptions[0]?.textContent?.trim() : 'Not tied to a character').toBe(want);
        expect(!!select, 'a select only when there are characters to choose').toBe(characters.length > 0);
      } finally {
        stop();
      }
    }
  });

  it('the list says each mode belongs to one character, and groups a mode whose character is elsewhere as such (round 2)', () => {
    const MINE: ModeDef = { id: 'mode-a-own-s1', name: 'Maren Ward', charId: A.id, modifiers: [] };
    const AWAY: ModeDef = { id: 'mode-away-s1', name: 'Far Ward', charId: 'pc-not-on-this-device', modifiers: [] };
    const { host, click, stop } = renderDom(
      createElement(SettingsPage, {
        onClose: () => undefined,
        modes: { [OLD_UNUSED.id]: OLD_UNUSED, [MINE.id]: MINE, [AWAY.id]: AWAY },
        characters: [A, B],
      }),
    );
    try {
      const byText = (t: string) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === t) ?? null;
      click(byText('Modes'));
      const titles = [...host.querySelectorAll('.set-modes-group-title')].map((t) => t.textContent?.trim());
      expect(titles).toEqual(['Not tied to a character', `Only ${A.name}`, 'Other characters (not on this device)']);
      expect([...host.querySelectorAll('.settings-desc')].map((d) => d.textContent ?? '').join(' ').replace(/\s+/g, ' ')).toContain(
        'Each mode belongs to one character, and only that character sees it. A mode not tied to a character shows on every character until one of them switches it on or off, or edits it; then it belongs to that character.',
      );
      expect(host.textContent).not.toContain('All characters');

      // Editing the mode whose character is not on this device: the owner choice names it, never another.
      const row = [...host.querySelectorAll('.set-mode-row')].find((r) => (r.textContent ?? '').includes(AWAY.name));
      click(row!.querySelector('.mode-edit'));
      const select = host.querySelector<HTMLSelectElement>('.mode-editor select');
      // mutation-proof: drop the extra owner option from ModeEditor (src/sheet/ModesPanel.tsx `ownerOptions`) and this
      // goes red: a <select> whose value matches no option shows its first, "Not tied to a character".
      expect(select?.selectedOptions[0]?.textContent?.trim(), 'the owner shown').toBe('Another character (not on this device)');
      expect(select?.value).toBe(AWAY.charId);
      // …and only for such a mode: one of this device's characters is shown by name, with no extra option.
      click(byText('Cancel'));
      click([...host.querySelectorAll('.set-mode-row')].find((r) => (r.textContent ?? '').includes(MINE.name))!.querySelector('.mode-edit'));
      const mine = host.querySelector<HTMLSelectElement>('.mode-editor select');
      expect(mine?.selectedOptions[0]?.textContent?.trim()).toBe(A.name);
      expect([...(mine?.options ?? [])].map((o) => o.textContent?.trim())).not.toContain('Another character (not on this device)');
    } finally {
      stop();
    }
  });
});

describe('the Modes panel on its own (checker, round 3)', () => {
  const G = { id: 'pc-gm-own-g', name: 'Ilse Varn' };
  const P = { id: 'pc-player-p', name: 'Dov Ashby' };
  const panel = (props: {
    library: ModeDef[];
    activeIds: string[];
    charKey: string;
    charName: string;
    ownSheet: boolean;
    usage: Map<string, Set<string>>;
    onSave?: (m: ModeDef) => void;
    onToggle?: (id: string) => void;
    onDelete?: (id: string) => void;
    predefined?: ModeDef[];
    classId?: string;
    featIds?: ReadonlySet<string>;
  }) =>
    createElement(
      ModesRemoveFromCharacterContext.Provider,
      { value: props.ownSheet },
      createElement(
        ModeUsageContext.Provider,
        { value: props.usage },
        createElement(ModesPanel, {
          library: props.library,
          predefined: props.predefined ?? [],
          catalog: [],
          classId: props.classId,
          featIds: props.featIds,
          activeIds: props.activeIds,
          charKey: props.charKey,
          charName: props.charName,
          onToggle: props.onToggle ?? (() => undefined),
          onSave: props.onSave ?? (() => undefined),
          onDelete: props.onDelete ?? (() => undefined),
        }),
      ),
    );

  it('switching OFF an old mode two characters had on makes it the switcher’s, so it never leaves that character', () => {
    const saves: ModeDef[] = [];
    const toggles: string[] = [];
    const { host, click, stop } = renderDom(
      panel({
        library: [OLD_SHARED],
        activeIds: [OLD_SHARED.id],
        charKey: B.id,
        charName: B.name,
        ownSheet: true,
        usage: new Map([[OLD_SHARED.id, new Set([A.id, B.id])]]),
        onSave: (m) => saves.push(m),
        onToggle: (id) => toggles.push(id),
      }),
    );
    try {
      const row = [...host.querySelectorAll('.mode-row')].find((r) => (r.textContent ?? '').includes(OLD_SHARED.name));
      expect(row?.querySelector('.mode-toggle.on'), 'fixture: switched on here').toBeTruthy();
      click(row!.querySelector('.mode-toggle'));
      expect(toggles, 'switched off').toEqual([OLD_SHARED.id]);
      // mutation-proof: put `!on &&` back on ModesPanel's toggle claim (src/sheet/ModesPanel.tsx) and this goes red:
      // nothing is saved, so once B has it off it is used only by A and leaves B's list for good.
      expect(saves.map((m) => m.charId), 'B’s now').toEqual([B.id]);
      const users = new Map([[OLD_SHARED.id, new Set([A.id])]]); // after: on for A only
      expect(modeListedFor(saves[0], B.id, users), 'still on B’s list, switched off').toBe(true);
      expect(modeListedFor(saves[0], A.id, users), 'and still on A’s while A has it on').toBe(true);
    } finally {
      stop();
    }
  });

  it('on the GM’s edit sheet his unowned mode that one of his characters uses offers "Remove from this character" (round 4)', () => {
    // Plain Delete there deleted it from his device, so his own character lost it (checker, round 4); the sheet's
    // removeModeDef now switches it off for this player only (test below, on the real GmEditSheet).
    const GM_UNOWNED: ModeDef = { id: 'mode-gm-lookout-p1', name: 'Gm Lookout', modifiers: [{ value: 1, type: 'status', target: 'perception' }] };
    const { host, click, stop } = renderDom(
      panel({
        library: [GM_UNOWNED],
        activeIds: [GM_UNOWNED.id],
        charKey: P.id,
        charName: P.name,
        ownSheet: false, // GmEditSheet sets ModesRemoveFromCharacterContext to false
        usage: new Map([[GM_UNOWNED.id, new Set([G.id])]]), // the viewer's (the GM's) roster
      }),
    );
    try {
      const row = [...host.querySelectorAll('.mode-row')].find((r) => (r.textContent ?? '').includes(GM_UNOWNED.name));
      click(row!.querySelector('.mode-edit'));
      // mutation-proof: put `removeFromCharacter &&` back on ModesPanel's `elsewhere` (src/sheet/ModesPanel.tsx) and
      // this goes red: plain "Delete", which deletes it from his own character too.
      expect(host.querySelector('.mode-editor .me-delete')?.textContent?.trim()).toBe('Remove from this character');
      expect(host.querySelector('.mode-editor .me-scope-fixed')?.textContent, 'an edit would be the player’s own copy').toBe(`Only ${P.name}`);
    } finally {
      stop();
    }
  });

  it('on the GM’s edit sheet his unowned mode that none of his characters uses keeps its plain Delete', () => {
    const GM_UNOWNED: ModeDef = { id: 'mode-gm-lookout-p2', name: 'Gm Lookout', modifiers: [{ value: 1, type: 'status', target: 'perception' }] };
    const { host, click, stop } = renderDom(
      panel({ library: [GM_UNOWNED], activeIds: [GM_UNOWNED.id], charKey: P.id, charName: P.name, ownSheet: false, usage: new Map() }),
    );
    try {
      const row = [...host.querySelectorAll('.mode-row')].find((r) => (r.textContent ?? '').includes(GM_UNOWNED.name));
      click(row!.querySelector('.mode-edit'));
      expect(host.querySelector('.mode-editor .me-delete')?.textContent?.trim(), 'plain Delete, as before').toBe('Delete');
    } finally {
      stop();
    }
  });

  it('on the GM’s edit sheet a mode one of his own characters OWNS offers "Remove from this character", never Delete (round 2)', async () => {
    // Delete there deleted it from his own character too: the sheet's removeModeDef now only switches it off for
    // this player (test below, on the real GmEditSheet).
    const GM_OWN: ModeDef = { id: 'mode-gm-bless-p1', name: 'Gm Bless', charId: G.id, modifiers: [{ value: 1, type: 'status', target: 'attack' }] };
    const removed: string[] = [];
    const saves: ModeDef[] = [];
    const toggles: string[] = [];
    const { host, click, stop } = renderDom(
      panel({
        library: [GM_OWN],
        activeIds: [GM_OWN.id],
        charKey: P.id,
        charName: P.name,
        ownSheet: false,
        usage: new Map([[GM_OWN.id, new Set([G.id])]]),
        onDelete: (id) => removed.push(id),
        onSave: (m) => saves.push(m),
        onToggle: (id) => toggles.push(id),
      }),
    );
    try {
      const row = () => [...host.querySelectorAll('.mode-row')].find((r) => (r.textContent ?? '').includes(GM_OWN.name));
      // Switching it off for this player is just that on the GM's sheet: no copy is made of his character's mode.
      click(row()!.querySelector('.mode-toggle'));
      expect(toggles).toEqual([GM_OWN.id]);
      expect(saves, 'no copy on the GM’s sheet').toEqual([]);
      click(row()!.querySelector('.mode-edit'));
      const del = host.querySelector<HTMLButtonElement>('.mode-editor .me-delete');
      // mutation-proof: drop `foreign` from ModesPanel's `removeOnly` (src/sheet/ModesPanel.tsx) and this goes red:
      // the button says plain "Delete".
      expect(del?.textContent?.trim()).toBe('Remove from this character');
      expect(del?.title).toContain('belongs to another character');
      expect(host.querySelector('.mode-editor .me-scope-fixed')?.textContent, 'an edit would be the player’s own copy').toBe(`Only ${P.name}`);
      click(del);
      expect(removed, 'nothing happens before the player answers the confirm').toEqual([]);
      await answerDelete('Remove');
      expect(removed, 'the sheet’s remover is told which').toEqual([GM_OWN.id]);
    } finally {
      stop();
    }
  });

  it('a gated mode pinned on one character shows in Pinned only where that character’s panel lists it (round 2)', () => {
    // Real content: the exemplar's ikon aura, gated on the Victor's Wreath feat.
    const wreath = db.modes['aura-victors-wreath'];
    expect(wreath?.feats, 'fixture: a feat-gated mode').toEqual(['victors-wreath']);
    setPref('pinnedModes', [wreath.id]); // pinned while viewing the exemplar — the pin list is device-wide
    const view = (featIds: string[], activeIds: string[] = []) =>
      renderDom(
        panel({
          library: [],
          predefined: [wreath],
          classId: 'wizard',
          featIds: new Set(featIds),
          activeIds,
          charKey: P.id,
          charName: P.name,
          ownSheet: true,
          usage: new Map(),
        }),
      );
    const sections = (host: HTMLElement) => [...host.querySelectorAll('.modes-section-title')].map((t) => t.textContent?.trim());
    const rows = (host: HTMLElement) => [...host.querySelectorAll('.mode-row')].map((r) => r.querySelector('.mode-name')?.textContent);

    // A wizard without the feat: not pinned at the top, not listed at all.
    let r = view([]);
    try {
      // mutation-proof: make ModesPanel's `pinnedHere` plain `pinned.has(m.id)` (src/sheet/ModesPanel.tsx) and this
      // goes red: the exemplar's aura sits under Pinned on the wizard.
      expect(sections(r.host), 'no Pinned group').not.toContain('Pinned');
      expect(rows(r.host)).not.toContain(wreath.name);
      // "Show all" still finds it, in its own category, its pin on — the pin is kept, never dropped.
      r.click(r.host.querySelector('.modes-showall input'));
      const row = [...r.host.querySelectorAll('.mode-row')].find((x) => x.querySelector('.mode-name')?.textContent === wreath.name);
      expect(row, 'listed under Show all').toBeTruthy();
      expect(row?.querySelector('.mode-pin.on'), 'still pinned').toBeTruthy();
      expect(sections(r.host)).not.toContain('Pinned');
    } finally {
      r.stop();
    }
    // Positive controls: the character it fits, and one that has it switched on.
    for (const [featIds, activeIds, why] of [
      [['victors-wreath'], [], 'has the feat'],
      [[], [wreath.id], 'switched on here'],
    ] as const) {
      r = view([...featIds], [...activeIds]);
      try {
        expect(sections(r.host), why).toContain('Pinned');
        expect(rows(r.host), why).toEqual([wreath.name]);
      } finally {
        r.stop();
      }
    }
  });
});

describe('the GM’s edit sheet and a mode one of his own characters owns or uses (rounds 2 and 4)', () => {
  const G = { id: 'pc-gm-own-g2', name: 'Ilse Varn' };
  const GM_OWN: ModeDef = { id: 'mode-gm-ward-g2', name: 'Harbor Ward', charId: G.id, modifiers: [{ value: 2, type: 'status', target: 'ac' }] };
  /** An old mode with no owner that he has switched on for his own character G AND for this player (round 4). */
  const GM_UNOWNED: ModeDef = { id: 'mode-gm-watch-g4', name: 'Night Watch', modifiers: [{ value: 2, type: 'status', target: 'ac' }] };
  const gmSheet = (
    mode: ModeDef,
    usage: Map<string, Set<string>>,
    writers: { onSaveMode?: (m: ModeDef) => void; onDeleteMode?: (id: string) => void },
  ) => {
    const sheet = saved({ id: 'pc-player-q2', name: 'Dov Ashby' }, [mode.id]);
    const gmDb = { ...db, modes: { ...db.modes, [mode.id]: mode } };
    // The app provides his roster's usage map around every screen (src/App.tsx ModeUsageContext).
    return createElement(
      ModeUsageContext.Provider,
      { value: usage },
      createElement(GmEditSheet, {
        initial: sheet,
        live: sheet,
        content: gmDb,
        campaignId: 'camp-q2',
        playerOwnerId: 'player-q2',
        onSaveMode: writers.onSaveMode,
        onDeleteMode: writers.onDeleteMode,
        onExit: () => undefined,
      }),
    );
  };
  const tick = () => wait(0);
  async function openGmModes(host: HTMLElement, click: (el: Element | null) => void) {
    click(host.querySelector('.add-btn'));
    await tick();
    click([...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Modes') ?? null);
    await tick();
    expect(document.querySelector('.modes-panel'), 'fixture: the Modes panel').not.toBeNull();
  }
  const gmRow = (name: string) => [...document.querySelectorAll<HTMLElement>('.modes-panel .mode-row')].find((r) => (r.textContent ?? '').includes(name));

  for (const [what, mode, usage, proof] of [
    ['one of his characters owns', GM_OWN, new Map<string, Set<string>>(), '`modeOwnedElsewhere`'],
    // mutation-proof (round 4): make GmEditSheet's `hisToo` only `modeOwnedElsewhere(…)` (src/sheet/GmEditSheet.tsx)
    // and the two tests below go red for this case: his writer deletes it, or saves it with +3.
    ['an old unowned one his character G also has on', GM_UNOWNED, new Map([[GM_UNOWNED.id, new Set([G.id])]]), '`modeAlsoElsewhere`'],
  ] as const) {
    it(`${what}: "Remove from this character" switches it off for the player and never deletes it from his character`, async () => {
      const deleted: string[] = [];
      const { host, click, stop } = renderDom(gmSheet(mode, usage, { onDeleteMode: (id) => deleted.push(id) }));
      try {
        await openGmModes(host, click);
        expect(gmRow(mode.name), 'fixture: listed, switched on for the player').toBeTruthy();
        click(gmRow(mode.name)!.querySelector('.mode-edit'));
        await tick();
        const del = document.querySelector('.mode-editor .me-delete');
        expect(del?.textContent?.trim()).toBe('Remove from this character');
        click(del);
        await answerDelete('Remove');
        await tick();
        // mutation-proof: drop the ${proof} half of GmEditSheet's removeModeDef check (src/sheet/GmEditSheet.tsx) and
        // this goes red: his writer is told to delete it from his saved modes.
        expect(deleted, 'never deleted from his modes').toEqual([]);
        expect(gmRow(mode.name), 'off this player, so no longer on their list').toBeUndefined();
      } finally {
        stop();
      }
    });

    it(`${what}: an edit there saves the player’s own copy; his character’s mode is never written`, async () => {
      const saves: ModeDef[] = [];
      const { host, click, stop } = renderDom(gmSheet(mode, usage, { onSaveMode: (m) => saves.push(m) }));
      try {
        await openGmModes(host, click);
        click(gmRow(mode.name)!.querySelector('.mode-edit'));
        await tick();
        setInput(document.querySelector<HTMLInputElement>('.mode-editor .me-val')!, '3');
        click(document.querySelector('.mode-editor .btn-primary'));
        await tick();
        // mutation-proof: drop the ${proof} half of GmEditSheet's saveModeDef check (src/sheet/GmEditSheet.tsx) and
        // this goes red: his own character's mode is saved with +3.
        expect(saves.map((m) => [m.id === mode.id ? 'his' : 'copy', m.charId, m.modifiers[0].value])).toEqual([['copy', 'pc-player-q2', 3]]);
        expect(gmRow(mode.name), 'the player’s copy is listed in its place').toBeTruthy();
      } finally {
        stop();
      }
    });
  }

  it('an old unowned mode none of his characters uses keeps its plain Delete, which deletes it as before', async () => {
    const deleted: string[] = [];
    const { host, click, stop } = renderDom(gmSheet(GM_UNOWNED, new Map(), { onDeleteMode: (id) => deleted.push(id) }));
    try {
      await openGmModes(host, click);
      click(gmRow(GM_UNOWNED.name)!.querySelector('.mode-edit'));
      await tick();
      const del = document.querySelector('.mode-editor .me-delete');
      expect(del?.textContent?.trim()).toBe('Delete');
      click(del);
      await tick();
      expect(deleted, 'nothing is deleted before the GM answers the confirm').toEqual([]);
      await answerDelete('Delete');
      expect(deleted).toEqual([GM_UNOWNED.id]);
    } finally {
      stop();
    }
  });
});
