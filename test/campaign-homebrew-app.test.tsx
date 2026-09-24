// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import {
  ROSTER_KEY,
  loadCharUpdated,
  saveCampaignHbCache,
  saveCharUpdated,
  saveHomebrewEntry,
  saveHomebrewSource,
  saveSyncOwner,
  wipeSyncedLocalData,
  type CampaignHbCampaign,
  type SavedChar,
} from '../src/data/storage';
import { rebuildContent } from '../src/data';
import { rebuildRoster } from '../src/data/rebuild';
import type { ContentDatabase } from '../src/rules/types';
import { noteDerivedRefresh, noteRosterChange, startCloudSync } from '../src/data/cloudSync';
import { refreshCampaignHomebrew, startCampaignHomebrew } from '../src/data/campaignHomebrew';

/**
 * CAMPAIGN HOMEBREW, WIRED INTO THE REAL <App/>.
 *
 * The data layer (pull, cache, conversions) is data/campaignHomebrew.ts's business and is mocked here.
 * What is under test is App's side of it: the background refresh starts only after cloud sync has
 * pulled and stops with it; a change it reports reaches the content database and the characters
 * without a relaunch, as a DERIVED refresh; homebrew that arrives by sync does too — once, not on
 * every no-op sync; leaving a campaign asks for a pull, so its homebrew becomes the player's own; and
 * none of it ever rebuilds the database before core.json is in (a seed-only database). Then the doors
 * around it: a cloud adopt landing between a refresh and its render (8), another account signing in (9),
 * and this device's own homebrew edits never reading as "arrived by sync" on the echo that follows (10).
 */
const hb = vi.hoisted(() => ({
  /** Hold startCloudSync unresolved until release() — case (3). */
  holdSync: false,
  release: null as (() => void) | null,
  onChanged: null as (() => void) | null,
  order: [] as string[],
  /** The membership ids stored at the moment refreshCampaignHomebrew was called. */
  campaignsAtRefresh: null as string[] | null,
}));

vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'player@example.com' }),
  signOut: async () => undefined,
}));
vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  fetchGmEdits: async () => [],
  deleteGmEdit: async () => 1,
  currentUserId: async () => null, // no Realtime subscription in the test
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
}));
vi.mock('../src/data/cloudSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/cloudSync')>();
  return {
    ...actual,
    startCloudSync: vi.fn(
      () =>
        new Promise<() => void>((resolve) => {
          const done = () => {
            hb.order.push('cloud-sync-started');
            resolve(() => hb.order.push('cloud-sync-stopped'));
          };
          if (hb.holdSync) hb.release = done;
          else done();
        }),
    ),
    hasSyncedOnce: () => true,
    noteDerivedRefresh: vi.fn(actual.noteDerivedRefresh),
  };
});
vi.mock('../src/data/campaignHomebrew', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaignHomebrew')>()),
  startCampaignHomebrew: vi.fn((opts: { onChanged: () => void }) => {
    hb.order.push('campaign-hb-started');
    hb.onChanged = opts.onChanged;
    return () => hb.order.push('campaign-hb-stopped');
  }),
  refreshCampaignHomebrew: vi.fn(async () => {
    hb.campaignsAtRefresh = (JSON.parse(localStorage.getItem('pf2e-codex.campaigns') ?? '[]') as { id: string }[]).map((m) => m.id);
    return false;
  }),
}));
vi.mock('../src/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data')>();
  return { ...actual, rebuildContent: vi.fn(actual.rebuildContent) };
});
// The sheet itself is not under test — only what App hands it. This stand-in shows two feats' names
// from the content it was given and exposes App's leave-campaign, create-item and open-homebrew
// callbacks as buttons.
vi.mock('../src/sheet/CharacterSheet', async () => {
  const React = await import('react');
  return {
    CharacterSheet: (p: {
      content: { feats: Record<string, { name?: string } | undefined> };
      onLeaveCampaign?: (id: string) => void;
      onCreateItem: (item: never) => void;
      onOpenHomebrew: () => void;
    }) =>
      React.createElement(
        'div',
        { className: 'stub-sheet' },
        React.createElement('span', { className: 'stub-feat' }, `camp:${p.content.feats['camp-hb-feat']?.name ?? '-'}`),
        React.createElement('span', { className: 'stub-feat' }, `own:${p.content.feats['own-hb-feat']?.name ?? '-'}`),
        React.createElement('button', { className: 'stub-leave', onClick: () => p.onLeaveCampaign?.('camp-1') }, 'Leave'),
        React.createElement(
          'button',
          { className: 'stub-create-item', onClick: () => p.onCreateItem({ id: 'own-hb-item', name: 'Kitchen Knife', level: 0, traits: [] } as never) },
          'Create item',
        ),
        React.createElement('button', { className: 'stub-open-hb', onClick: () => p.onOpenHomebrew() }, 'Homebrew'),
      ),
  };
});
// The Homebrew manager persists its own edits, then tells App — that is all App sees of it.
vi.mock('../src/sheet/HomebrewPage', async () => {
  const React = await import('react');
  const { saveHomebrewEntry: save } = await import('../src/data/storage');
  return {
    HomebrewPage: (p: { onChanged: () => void }) =>
      React.createElement(
        'button',
        {
          className: 'stub-hb-save',
          onClick: () => {
            save('feats', { id: 'own-hb-feat', name: 'Kitchen Feat', level: 1, category: 'general', traits: [], rarity: 'common', description: '' } as never);
            p.onChanged();
          },
        },
        'Save',
      ),
  };
});

const ACTIVE_KEY = 'wanderers-codex:active:v1';
const APP_TIMEOUT = 120_000;

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

function saved(id: string, name: string, extra: Partial<BuildState> = {}): SavedChar {
  const db = content();
  const build = { ...buildOf(name), ...extra };
  const character = buildCharacter(build, db);
  return { id, character, build, play: initialPlay(character, db) } as SavedChar;
}

const feat = (id: string, name: string, sourceId: string) =>
  ({ id, name, homebrewSourceId: sourceId, level: 1, category: 'general', traits: [], rarity: 'common', description: '' }) as never;

/** What a pull of the GM's campaign writes to the device cache. */
const saltRoad = (): Record<string, CampaignHbCampaign> => ({
  'camp-1': {
    name: 'The Salt Road',
    sources: { 'hbsrc-gm': { id: 'hbsrc-gm', name: 'Salt Road Brews' } },
    content: { feats: { 'camp-hb-feat': feat('camp-hb-feat', 'Brine Blessing', 'hbsrc-gm') } },
    updatedAt: '2026-09-24T10:00:00Z',
  },
});

const storedRoster = () => JSON.parse(localStorage.getItem(ROSTER_KEY) ?? '[]') as SavedChar[];

/** core.json waits on this while set — case (7). */
let coreGate: Promise<void> | null = null;
let live: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
  hb.holdSync = false;
  hb.release = null;
  hb.onChanged = null;
  hb.order = [];
  hb.campaignsAtRefresh = null;
  coreGate = null;
  vi.clearAllMocks();
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).split('/').pop() ?? '';
    if (name !== 'core.json' && name !== 'core-descriptions.json') return { ok: false, status: 404, json: async () => ({}) };
    if (name === 'core.json' && coreGate) await coreGate;
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`public/${name}`, 'utf8')) as unknown };
  });
  localStorage.setItem(ROSTER_KEY, JSON.stringify([saved('c1', 'Ayla')]));
  localStorage.setItem(ACTIVE_KEY, 'c1');
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
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
});

afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

const settle = async (ms = 50) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

async function render(): Promise<HTMLElement> {
  const { default: App } = await import('../src/App');
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  await act(async () => {
    live!.render(<App />);
  });
  return host;
}

/** core.json is parsed for real: wait for the sheet the boot restore opens. */
async function waitForSheet(el: HTMLElement): Promise<void> {
  for (let i = 0; i < 200 && !el.querySelector('.stub-sheet'); i++) await settle();
  expect(el.querySelector('.stub-sheet'), 'fixture: the app never reached the sheet').not.toBeNull();
}

async function mountApp(): Promise<HTMLElement> {
  const el = await render();
  await waitForSheet(el);
  return el;
}

const feats = (el: HTMLElement) => [...el.querySelectorAll('.stub-feat')].map((s) => s.textContent);

describe('campaign homebrew in the app', () => {
  // FIRST in the file on purpose: the content database is module state, and only the first mount of
  // the file finds it still loading.
  it('(7) a refresh that lands before core.json is in never builds a seed-only database', async () => {
    let openCore = () => undefined as void;
    coreGate = new Promise<void>((resolve) => {
      openCore = () => resolve();
    });
    const el = await render();
    await settle();
    expect(hb.onChanged, 'fixture: cloud sync resolved, so the refresh must be running').not.toBeNull();
    expect(el.querySelector('.stub-sheet'), 'fixture: core.json must still be held (is this still the first test?)').toBeNull();
    await act(async () => {
      hb.onChanged!();
      window.dispatchEvent(new Event('hh-synced'));
    });
    expect(vi.mocked(rebuildContent), 'rebuilt before core.json arrived: every screen and the launch rebuild get the seed alone').not.toHaveBeenCalled();
    openCore();
    await waitForSheet(el);
  }, APP_TIMEOUT);

  it('(3) starts the background refresh only after cloud sync has pulled, and stops it first', async () => {
    hb.holdSync = true;
    await mountApp();
    expect(startCloudSync).toHaveBeenCalledTimes(1);
    expect(startCampaignHomebrew, 'started before cloud sync pulled — a fresh device’s memberships are still empty').not.toHaveBeenCalled();
    await act(async () => {
      hb.release!();
    });
    await settle();
    expect(startCampaignHomebrew).toHaveBeenCalledTimes(1);
    // Same account as the launch (no sync owner changed), so nothing to re-merge — see (9) for the other.
    expect(vi.mocked(rebuildContent), 'a launch by the same account re-merged the whole database for nothing').not.toHaveBeenCalled();
    act(() => live!.unmount());
    live = null;
    expect(hb.order).toEqual(['cloud-sync-started', 'campaign-hb-started', 'campaign-hb-stopped', 'cloud-sync-stopped']);
  }, APP_TIMEOUT);

  it('(4) a change it reports reaches the content the sheet is given, as a derived refresh', async () => {
    const el = await mountApp();
    await settle();
    expect(hb.onChanged, 'fixture: onChanged was never handed over').not.toBeNull();
    expect(feats(el)).toContain('camp:-');
    // The pull wrote this campaign's homebrew to the device cache, then reported the change.
    saveSyncOwner('player-1');
    saveCampaignHbCache('player-1', saltRoad());
    const derivedBefore = vi.mocked(noteDerivedRefresh).mock.calls.length;
    await act(async () => {
      hb.onChanged!();
    });
    await settle();
    expect(feats(el), 'the GM’s feat never reached the content database without a relaunch').toContain('camp:Brine Blessing');
    const calls = vi.mocked(noteDerivedRefresh).mock.calls.slice(derivedBefore);
    expect(calls.length, 'the characters were not re-derived').toBeGreaterThan(0);
    expect(calls.every((c) => Array.isArray(c[1])), 'a mid-session refresh must pass the roster it was derived from').toBe(true);
  }, APP_TIMEOUT);

  it('(5) homebrew that arrives by sync re-merges once; a no-op sync rebuilds nothing', async () => {
    const el = await mountApp();
    await settle();
    // Another device's homebrew landed in storage (writeCloudBundle), then cloud sync announced it.
    saveHomebrewSource({ id: 'hbsrc-other-device', name: 'Laptop Brews' });
    saveHomebrewEntry('feats', feat('own-hb-feat', 'Laptop Feat', 'hbsrc-other-device'));
    expect(feats(el), 'fixture: nothing may have re-merged before the sync event').toContain('own:-');
    const before = vi.mocked(rebuildContent).mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('hh-synced'));
    });
    await settle();
    expect(feats(el), 'synced homebrew stayed invisible until a relaunch').toContain('own:Laptop Feat');
    expect(vi.mocked(rebuildContent).mock.calls.length).toBe(before + 1);
    await act(async () => {
      window.dispatchEvent(new Event('hh-synced'));
    });
    await settle();
    expect(vi.mocked(rebuildContent).mock.calls.length, 'a sync that changed no homebrew rebuilt everything').toBe(before + 1);
  }, APP_TIMEOUT);

  it('(6) leaving a campaign asks for a pull, after the membership is gone', async () => {
    localStorage.setItem(
      'pf2e-codex.campaigns',
      JSON.stringify([{ id: 'camp-1', code: 'SALT01', role: 'player', name: 'The Salt Road', useDefaults: true }]),
    );
    const el = await mountApp();
    await act(async () => {
      el.querySelector('.stub-leave')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
    expect(refreshCampaignHomebrew).toHaveBeenCalledTimes(1);
    expect(hb.campaignsAtRefresh, 'the pull ran while the membership was still stored — nothing would convert').toEqual([]);
  }, APP_TIMEOUT);

  it('(8) a cloud adopt landing before a refresh has rendered derives against the NEW database — nothing stamped', async () => {
    // Ayla took the GM's feat before this device had a copy: the database this launch merged lacks it.
    const oldDb = rebuildContent();
    localStorage.setItem(ROSTER_KEY, JSON.stringify([saved('c1', 'Ayla', { heritageFeatId: 'camp-hb-feat' })]));
    await mountApp();
    await settle(600); // the launch rebuild has been persisted
    expect(hb.onChanged, 'fixture: onChanged was never handed over').not.toBeNull();
    const adoptRoster = vi.mocked(startCloudSync).mock.calls[0][0];
    saveSyncOwner('player-1');
    saveCampaignHbCache('player-1', saltRoad());
    saveCharUpdated({ c1: 1000 });
    // The adopt carries a character another device made; Ayla is untouched by it.
    const incoming = [...storedRoster(), saved('c2', 'Bren')];
    await act(async () => {
      hb.onChanged!(); // the pull brought the GM's feat…
      adoptRoster(incoming); // …and a cloud adopt landed before React rendered the refresh
    });
    await settle(600); // the persist that follows
    const newDb = vi.mocked(rebuildContent).mock.results.at(-1)!.value as ContentDatabase;
    const ayla = storedRoster().find((c) => c.id === 'c1')!;
    const derivedFrom = (db: ContentDatabase) => JSON.stringify(rebuildRoster([ayla], db)[0].character);
    expect(derivedFrom(newDb), 'fixture: the GM’s feat must change how Ayla derives').not.toBe(derivedFrom(oldDb));
    expect(JSON.stringify(ayla.character), 'Ayla was left derived against the database the refresh replaced').toBe(derivedFrom(newDb));
    noteRosterChange(storedRoster()); // what the persist reports to cloud sync
    expect(loadCharUpdated().c1, 'an untouched character was stamped "updated now" and pushed — the 2026-09-02 class').toBe(1000);
  }, APP_TIMEOUT);

  it('(9) another account signing in takes the previous account’s campaign homebrew out of the database', async () => {
    // Account A's launch: its GM's feat is in the device cache, so it is in the database merged from it.
    saveSyncOwner('player-a');
    saveCampaignHbCache('player-a', saltRoad());
    rebuildContent();
    hb.holdSync = true;
    const el = await mountApp();
    expect(feats(el), 'fixture: account A’s campaign homebrew must be in the launch database').toContain('camp:Brine Blessing');
    // Account B signs in: startCloudSync wipes A's account-scoped data and pulls B's. B has no homebrew of
    // either kind, so the fingerprint check finds nothing and no campaign pull reports a change.
    await act(async () => {
      wipeSyncedLocalData();
      saveSyncOwner('player-b');
      window.dispatchEvent(new Event('hh-synced'));
      hb.release!();
    });
    await settle();
    expect(feats(el), 'B’s sheets still resolve A’s GM’s records until a relaunch').toContain('camp:-');
  }, APP_TIMEOUT);

  it('(10) homebrew edited on this device is already merged — the echo of its push rebuilds nothing', async () => {
    const el = await mountApp();
    await settle();
    const click = (sel: string) => act(async () => void el.querySelector(sel)!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const echo = async () => {
      await act(async () => void window.dispatchEvent(new Event('hh-synced'))); // Realtime, ~3 s after our own push
      await settle();
    };
    const rebuilds = () => vi.mocked(rebuildContent).mock.calls.length;
    const before = rebuilds();
    const derived = vi.mocked(noteDerivedRefresh).mock.calls.length;
    await click('.stub-create-item');
    await echo();
    expect(rebuilds(), 'a custom item made here re-merged everything on the echo').toBe(before);
    await click('.stub-open-hb');
    await click('.stub-hb-save');
    expect(rebuilds(), 'fixture: the Homebrew manager’s save re-merges once').toBe(before + 1);
    await echo();
    expect(rebuilds(), 'a Homebrew-manager edit was re-merged again on the echo').toBe(before + 1);
    expect(vi.mocked(noteDerivedRefresh).mock.calls.length, '…and every character re-derived for nothing').toBe(derived);
  }, APP_TIMEOUT);
});
