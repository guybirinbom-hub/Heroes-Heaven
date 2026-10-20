// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { exportNative } from '../src/data/transfer';
import { ROSTER_KEY, readCloudBundle, type SavedChar } from '../src/data/storage';

/**
 * ANOTHER ACCOUNT SIGNS IN IN *THIS* TAB (a checker's findings on the S3 fix, 2026-10-20). The real App
 * and the REAL cloud sync (src/data/cloudSync.ts startSync), against a fake supabase that is offline: the
 * new account's first pull fails. startSync wipes the old account's data and empties the roster.
 *
 *  (1) The switching tab must still save. S3 made a tab whose roster belonged to another account write
 *      nothing until the new account's roster arrived (rosterTabs.rosterOwnerSwitched, persist HOLD_WRITE).
 *      But the switching tab's own known roster still named the OLD owner, so with the pull failed every
 *      write of its own was dropped without a word — a character imported into the new account lived only
 *      on screen and was gone on reload.
 *  (2) No undo step of the old account survives the switch. startSync announced the emptied roster BEFORE
 *      it saved the new owner, so App's adopt read "same account" and kept the history: Ctrl+Z on the old
 *      account's delete brought that character back into the new account's roster (and so into its cloud).
 *
 *  (3) …and cleared ONCE: a later cloud adopt in the new account leaves its own steps alone.
 *
 * RED before the fix (run 2026-10-20 on the working tree before this round's change): the Ctrl+Z leg failed
 * with the old account's deleted character back on the roster; without the Ctrl+Z leg, on `on disk: the
 * imported character: expected null to deeply equal [ 'New Account Hero' ]`.
 * MUTATIONS (run 2026-10-20, each restored):
 *  - skip `noteRosterKnown(null, [], null, null)` in storage.wipeSyncedLocalData → fails on
 *    `on disk: the imported character: expected null …`;
 *  - skip `saveSyncOwner(uid)` before the wipe in cloudSync.startSync → fails on `Ctrl+Z put nothing of
 *    the old account back: expected [ 'Old Archived Heroarchived' ] to deeply equal []`;
 *  - clear the history at every adopt after the switch (drop `!historyCleared` in App) → fails on
 *    `Ctrl+Z takes back this account’s own import — and nothing the cloud brought`.
 *
 * Synthetic characters only.
 */
const net = vi.hoisted(() => ({
  /** Who `auth.getUser` says is signed in; it answers only once `releaseUser` is called. */
  uid: 'acct-new',
  releaseUser: null as null | (() => void),
  userGate: null as null | Promise<void>,
  /** Offline until set: then every query answers with `cloudRow` (the new account's cloud copy). */
  online: false,
  cloudRow: null as unknown,
}));

/** Offline: every query answers with an error (cloudSync's pull throws on it — "offline, retry later"). */
vi.mock('../src/data/supabase', () => {
  const offline = { data: null, error: { message: 'offline (test)' } };
  const chain = (): unknown =>
    new Proxy(
      {},
      {
        get: (_t, k) => {
          if (k === 'then')
            return (res: (v: unknown) => void) => res(net.online ? { data: net.cloudRow ? { data: net.cloudRow } : null, error: null } : offline);
          return () => chain();
        },
      },
    );
  const channel = { on: () => channel, subscribe: () => channel };
  const client = {
    auth: {
      getUser: async () => {
        if (net.userGate) await net.userGate;
        return { data: { user: { id: net.uid } }, error: null };
      },
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    from: () => chain(),
    channel: () => channel,
    removeChannel: async () => undefined,
  };
  return { supabase: client, isCloudConfigured: true, isCloudSyncEnabled: true };
});
vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'player@example.com' }),
  signOut: async () => undefined,
}));
vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  fetchGmEdits: async () => [],
  deleteGmEdit: async () => 1,
  currentUserId: async () => null,
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
}));
vi.mock('../src/data/campaignHomebrew', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaignHomebrew')>()),
  startCampaignHomebrew: () => () => undefined,
}));

const OWNER_KEY = 'pf2e-codex.syncOwner';
const TIMEOUT = 120_000;

const buildOf = (name: string): BuildState => ({
  ...emptyBuild(),
  name,
  level: 1,
  ancestryId: 'human',
  heritageId: 'versatile-human',
  backgroundId: 'acolyte',
  classId: 'fighter',
  keyAbility: 'str',
});
function saved(id: string, name: string, extra: Partial<SavedChar> = {}): SavedChar {
  const db = content();
  const build = buildOf(name);
  const character = buildCharacter(build, db);
  return { id, character, build, play: initialPlay(character, db), ...extra } as SavedChar;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  for (const n of [...document.body.children]) n.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const click = (el: Element | null | undefined, what: string) => {
  if (!el) throw new Error(`fixture: nothing to click (${what})`);
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
const storedNames = () => (JSON.parse(localStorage.getItem(ROSTER_KEY) ?? 'null') as SavedChar[] | null)?.map((c) => c.character.name) ?? null;

describe('another account signs in in this tab while the network is down', () => {
  it('the switching tab saves what the player makes in the new account, and no undo step of the old account survives', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', async (url: string) => {
      const name = String(url).split('/').pop() ?? '';
      if (name !== 'core.json' && name !== 'core-descriptions.json') return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`public/${name}`, 'utf8')) as unknown };
    });
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
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

    // This browser's data belongs to the old account: one character in play, one archived.
    localStorage.setItem(OWNER_KEY, 'acct-old');
    localStorage.setItem('pf2e-codex.prefs', JSON.stringify({ startupScreen: 'characters' })); // open on the roster
    localStorage.setItem(ROSTER_KEY, JSON.stringify([saved('o1', 'Old Account Hero'), saved('oz', 'Old Archived Hero', { archived: true })]));
    net.uid = 'acct-new';
    net.userGate = new Promise<void>((r) => {
      net.releaseUser = r;
    });

    (await import('../src/data/prefs')).initPrefs(); // what main.tsx does before the first paint
    const { default: App } = await import('../src/App');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App />);
    });
    const button = (label: string) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
    /** The names on the roster's cards (the All tab is open). */
    const cards = () => [...host!.querySelectorAll('.rcard .rcard-name')].map((e) => (e.textContent ?? '').trim());
    const ctrlZ = () =>
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      });
    for (let i = 0; i < 300 && button('Import')?.disabled !== false; i++) await wait(50);
    expect(button('Import')?.disabled, `fixture: game data loaded, the roster is on screen (shows: ${(host.textContent ?? '').slice(0, 300)})`).toBe(false);

    // The old account's last action: the archived character is deleted (an undo step).
    click([...host.querySelectorAll('.rtab')].find((b) => (b.textContent ?? '').startsWith('All')), 'the All tab');
    const card = [...host.querySelectorAll('.rcard')].find((c) => (c.textContent ?? '').includes('Old Archived Hero'));
    click(card?.querySelector('button[title="Delete"]'), 'delete');
    await wait(50);
    click(document.querySelector('.confirm-modal .btn-danger'), 'confirm delete');
    await wait(600);
    expect(storedNames(), 'fixture: the delete was saved').toEqual(['Old Account Hero']);

    // Another account signs in in this tab: startSync wipes the old account's data; its pull fails.
    net.releaseUser!();
    for (let i = 0; i < 15; i++) await wait(100); // rendering as it goes, as a browser does
    expect(localStorage.getItem(OWNER_KEY), 'fixture: the new account owns this browser’s data').toBe('acct-new');
    expect(cards(), 'fixture: the old account’s characters left the screen').toEqual([]);
    expect(storedNames(), 'on disk: the emptied roster is this tab’s to write — written, so other tabs stop holding').toEqual([]);

    // (2) Ctrl+Z now must not undo anything of the old account into the new one — however often it is
    // pressed (the first press can meet the re-derive that follows the switch, itself still a step).
    for (let i = 0; i < 4; i++) {
      ctrlZ();
      await wait(100);
    }
    await wait(700);
    expect(cards(), 'Ctrl+Z put nothing of the old account back').toEqual([]);
    expect(JSON.stringify(storedNames()), 'on disk: nothing of the old account').not.toContain('Old');

    // (1) The player imports a character into the new account — it is saved at once.
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([exportNative(saved('n1', 'New Account Hero'))], 'hero.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    for (let i = 0; i < 100 && !cards().includes('New Account Hero'); i++) await wait(50);
    expect(cards(), 'fixture: the import reached the screen').toEqual(['New Account Hero']);
    await wait(800);
    expect(storedNames(), 'on disk: the imported character').toEqual(['New Account Hero']);
    expect(host.querySelector('.save-warning:not(.storage-warning)'), 'no “can’t save” banner').toBeNull();

    // Back online: the new account's cloud copy (a character from its other device) is adopted — and the
    // history is NOT cleared again: the import is this account's own step, and Ctrl+Z still takes it back.
    net.cloudRow = { ...readCloudBundle(), roster: [saved('n2', 'Other Device Hero')], charUpdated: { n2: Date.now() } };
    net.online = true;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    for (let i = 0; i < 100 && !cards().includes('Other Device Hero'); i++) await wait(50);
    expect([...cards()].sort(), 'fixture: the cloud copy was adopted beside the import').toEqual(['New Account Hero', 'Other Device Hero']);
    ctrlZ();
    await wait(800);
    expect(cards(), 'Ctrl+Z takes back this account’s own import — and nothing the cloud brought').toEqual(['Other Device Hero']);
  }, TIMEOUT);
});
