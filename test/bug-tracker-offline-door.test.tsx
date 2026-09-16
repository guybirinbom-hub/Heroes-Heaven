// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { ROSTER_KEY, type SavedChar } from '../src/data/storage';
import type { CampaignMembership } from '../src/data/campaigns';
import { useCombatStore, flushPersist, scopeKey } from '../tracker/src/store/combatStore';
import { useSettingsStore } from '../tracker/src/store/settingsStore';
import { usePartyStore } from '../tracker/src/store/partyStore';
import { useLayoutStore } from '../tracker/src/store/layoutStore';
import { trackerUi, useTrackerUi } from '../src/integration/trackerUiStore';
import { getRememberedCampaign, rememberCampaign, setOnCampaignsPage } from '../src/integration/lastCampaignView';

/**
 * THE TRACKER WITHOUT AN ACCOUNT.
 *
 * "The initiative tracker needs to be accessible without an account. It will just not have any of the
 * online features and only work as an empty campaign, because it doesn't have influence on any
 * settings and such, but I still need to access the initiative tracker to use it."
 *
 * Before this, Campaigns was the only door to the tracker and App hid the menu item unless you were
 * signed in — so an installed copy with no cloud sync (auth `disabled`) had a whole initiative
 * tracker in the bundle and no way to reach it. The legs here are what "without an account" has to
 * mean end to end:
 *  (a) a signed-out DESKTOP user can open Campaigns, and gets the local table rather than a campaigns
 *      list they can't use;
 *  (b) a signed-out PHONE user still sees no Campaigns item — the phone has no GM side at all;
 *  (c) a signed-IN user's campaigns list is exactly what it was;
 *  (d) the local board persists under its own scope key and leaves the pre-scoping standalone save
 *      (the bare key) alone;
 *  (e) the local table makes NO server call — there is no account to make one with;
 *  (f) the other half of the same switch: a signed-in GM's campaign DOES start the GM-device mirror,
 *      under their own account and before the board is scoped, and the local table never does;
 *  (g) a PLAYER's membership never starts the mirror — a player has no GM board to mirror;
 *  (h) Escape inside the tracker belongs to the tracker, not to the page underneath it;
 *  (i) a signed-out web device makes no call for the campaign it was last in, and doesn't forget it.
 */

const srv = vi.hoisted(() => ({
  /** What useAuth answers. 'disabled' = an installed build with cloud sync unconfigured. */
  auth: 'disabled' as 'disabled' | 'loading' | 'signed-out' | 'signed-in',
  /** Everyone currently rendering off `auth`. The real hook re-renders them when the session answers,
   *  so the mock has to as well — a leg about what the app decides WHEN auth settles cannot be written
   *  against a value that is only ever read on a render something else caused. */
  authListeners: new Set<() => void>(),
  /** Every server call the seam made, in order. */
  calls: [] as string[],
  /** Hold the mocked mirror's opening pull, so leg (f) can look at the board BEFORE it lands. */
  holdReady: false,
  /** Releases every held pull (the page and the tracker each hold the mirror, so each has one).
   *  Null until a held `startTrackerSync` has been asked for. */
  releaseReady: null as null | (() => void),
  /** The resolvers of those held pulls. */
  pending: [] as (() => void)[],
  /** How many holders the mirror has, and whether its opening pull has settled — the two things the
   *  real `isTrackerSyncReady` answers from, and what tells the board it has nothing to wait for. */
  holders: 0,
  settled: false,
}));

// A RELEASE build: the dev flag that lets the campaigns page be reached without login is off, so the
// only thing opening this door is the door itself.
vi.mock('../src/integration/enabled', () => ({
  TRACKER_IN_CAMPAIGN: true,
  TEST_CAMPAIGNS_WITHOUT_LOGIN: false,
}));

// An external store, not a value sampled at render time: `answerAuth` below re-renders every
// subscriber, the way the live hook's own setState does when getSession finally answers.
vi.mock('../src/data/useAuth', async () => {
  const { useSyncExternalStore } = await import('react');
  const build = () => ({
    status: srv.auth,
    // The session carries the ONE thing the GM-device mirror keys on: this account's uid
    // (gm_tracker_state.owner_id). Only the three fields the seam reads are worth faking.
    session: srv.auth === 'signed-in' ? ({ user: { id: 'gm-1' } } as unknown as Session) : null,
    email: srv.auth === 'signed-in' ? 'gm@example.com' : null,
  });
  let snap = build();
  // The SAME object until the status really changes — a fresh one each read re-renders forever.
  const read = () => {
    if (snap.status !== srv.auth) snap = build();
    return snap;
  };
  const subscribe = (cb: () => void) => {
    srv.authListeners.add(cb);
    return () => {
      srv.authListeners.delete(cb);
    };
  };
  return {
    useAuth: () => useSyncExternalStore(subscribe, read, read),
    signOut: async () => undefined,
  };
});

/**
 * The GM-device mirror, recorded rather than run. The real one is covered end to end in
 * test/tracker-sync.test.ts; what the SEAM has to get right is whether it is started at all, with
 * whose uid, and whether the board waits for its opening pull before it scopes.
 */
vi.mock('../src/data/trackerSync', () => ({
  startTrackerSync: ({ uid }: { uid: string | null }) => {
    srv.calls.push(`startTrackerSync:${uid ?? 'null'}`);
    srv.holders += 1;
    let ready: Promise<void>;
    if (srv.holdReady) {
      ready = new Promise<void>((resolve) => {
        srv.pending.push(resolve);
      });
      srv.releaseReady = () => {
        srv.settled = true;
        for (const r of srv.pending.splice(0)) r();
      };
    } else {
      srv.settled = true;
      ready = Promise.resolve();
    }
    return {
      stop: () => {
        srv.calls.push('stopTrackerSync');
        srv.holders = Math.max(0, srv.holders - 1);
        // The real teardown clears `readySettled`: the next start is a new session with a new
        // opening pull, and a board that has to wait for it again.
        if (srv.holders === 0) srv.settled = false;
      },
      ready,
    };
  },
  isTrackerSyncReady: (uid: string | null) => srv.holders > 0 && srv.settled && uid === 'gm-1',
}));

/*
 * The campaigns table. `useCampaignDefaults` runs for the local table too (hooks can't be
 * conditional), and its `fetchCampaignByCode` was kept off the wire only by LOCAL_TABLE's empty
 * `code` — a field nobody would read as load-bearing, and unrecorded here, so leg (e)'s
 * `expect(srv.calls).toEqual([])` could not see it come back. Now it is recorded like every other leg.
 */
vi.mock('../src/data/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaigns')>()),
  fetchCampaignByCode: async (code: string) => {
    srv.calls.push(`fetchCampaignByCode:${code}`);
    return { ok: false as const, error: 'No campaign with that code — double-check it with your GM.' };
  },
}));

// Every server leg of the seam, each one recording that it was reached.
vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  currentUserId: async () => 'gm-1',
  fetchParty: async () => {
    srv.calls.push('fetchParty');
    return [];
  },
  fetchMemberSheet: async () => {
    srv.calls.push('fetchMemberSheet');
    return null;
  },
  subscribeMemberSheet: () => {
    srv.calls.push('subscribeMemberSheet');
    return () => undefined;
  },
  subscribeParty: () => () => undefined,
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
  fetchGmEdits: async () => [],
  deleteGmEdit: async () => 1,
  subscribeGmEdits: () => () => undefined,
  pushGmEdit: async () => {
    srv.calls.push('pushGmEdit');
    return { ok: true, value: null };
  },
}));

/** Exactly what CampaignsPage synthesises when signed out — kept here so a rename shows up as a fail. */
const LOCAL_TABLE: CampaignMembership = {
  id: 'local',
  code: '',
  role: 'gm',
  name: 'Local table',
  description: '',
  local: true,
};

/** A real campaign, for the signed-in leg. */
const CAMPAIGN: CampaignMembership = { id: 'camp-1', code: 'TESTCODE', role: 'gm', name: 'The Salt Road' };

const COMBAT_BARE = 'pf2e-current-combat';
const COMBAT_LOCAL = 'pf2e-current-combat:local';

/**
 * A board the STANDALONE tracker saved before campaign scoping existed — the thing the bare key
 * actually holds on a real device, and the thing the local table must not touch.
 */
const STANDALONE_SAVE = JSON.stringify({
  combatants: [{ id: 'c1', name: "Last night's goblin", currentHP: 6, maxHP: 6, tempHP: 0, conditions: [] }],
  round: 3,
  activeIndex: 0,
  inCombat: true,
  selectedId: null,
});

const buildOf = (name: string, level: number): BuildState => ({
  ...emptyBuild(),
  name,
  level,
  ancestryId: 'human',
  heritageId: 'versatile-human',
  backgroundId: 'acolyte',
  classId: 'fighter',
  keyAbility: 'str',
});

function saved(id: string, name: string, level: number): SavedChar {
  const db = content();
  const build = buildOf(name, level);
  const character = buildCharacter(build, db);
  return { id, character, build, play: initialPlay(character, db) };
}

function stubMedia(phone: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches: phone && /max-width:\s*(720|768)px/.test(q),
    media: q,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function stubFetch(): void {
  const files: Record<string, string> = {
    'core.json': 'public/core.json',
    'core-descriptions.json': 'public/core-descriptions.json',
  };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = files[String(url).split('/').pop() ?? ''];
    if (!path) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf8')) as unknown, text: async () => '' };
  });
}

let live: Root | null = null;
let host: HTMLElement | null = null;

/** Let every pending fetch/subscribe settle and React commit what they produced. */
async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      // Under fake timers (the sync-cap leg below) a real setTimeout would never come back.
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1);
      else await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function render(el: React.ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() => live!.render(el));
  return host;
}

/** Every button on screen, by the label a user would read (icon-only buttons carry it in `title`). */
const findBtn = (label: string): HTMLElement | undefined =>
  [...(host?.querySelectorAll('button') ?? [])].find(
    (b) => (b.textContent ?? '').trim().includes(label) || b.title === label,
  );
const btn = (label: string): HTMLElement => {
  const el = findBtn(label);
  // Name what WAS on screen: a missing button usually means a different pane rendered.
  if (!el)
    throw new Error(
      `no button labelled "${label}" — found: ${[...(host?.querySelectorAll('button') ?? [])]
        .map((b) => JSON.stringify((b.textContent ?? '').trim() || b.title))
        .join(', ')}`,
    );
  return el;
};
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

/** The session answers, mid-run: every mounted `useAuth` re-renders, as it does on a real device. */
const answerAuth = (status: typeof srv.auth) =>
  act(() => {
    srv.auth = status;
    for (const cb of [...srv.authListeners]) cb();
  });

/**
 * Text the page DID put on screen and has since taken away again — the frames `textContent` can't
 * see.
 *
 * A placeholder that a mount's first effect replaces is gone before any assertion of ours runs: act()
 * flushes that effect before it hands control back, and even without act the two commits land in one
 * task. A removed node keeps the text it had, though, so the mutation records still hold what was
 * drawn. This is what makes an initial STATE (not just the effect that corrects it) load-bearing.
 */
function textEverShown(el: HTMLElement): { seen: () => string; stop: () => void } {
  let seen = '';
  // The observer's own callback drains the queue, so it has to be the same collector.
  const take = (recs: MutationRecord[]) => {
    for (const r of recs) {
      for (const n of r.removedNodes) seen += n.textContent ?? '';
      if (r.oldValue) seen += r.oldValue;
    }
  };
  const obs = new MutationObserver(take);
  obs.observe(el, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
  return {
    seen: () => {
      take(obs.takeRecords());
      return seen;
    },
    stop: () => obs.disconnect(),
  };
}

/** Which main view the tracker is on, read the way a component reads it — the store is module-global
 *  and deliberately has no imperative getter, so this mounts a throwaway probe. */
function mainViewNow(): string {
  const probeHost = document.createElement('div');
  document.body.appendChild(probeHost);
  const probeRoot = createRoot(probeHost);
  const Probe = () => {
    const ui = useTrackerUi();
    return <span data-main={ui.mainView} />;
  };
  act(() => probeRoot.render(<Probe />));
  const view = probeHost.querySelector('span')?.getAttribute('data-main') ?? '';
  act(() => probeRoot.unmount());
  probeHost.remove();
  return view;
}

beforeEach(() => {
  localStorage.clear();
  srv.auth = 'disabled';
  srv.calls.length = 0;
  srv.holdReady = false;
  srv.releaseReady = null;
  srv.pending.length = 0;
  srv.holders = 0;
  srv.settled = false;
  rememberCampaign(null);
  setOnCampaignsPage(false);
  trackerUi.reset();
  useCombatStore.setState({ combatants: [], round: 1, activeIndex: 0, selectedId: null, inCombat: false });
  // Module state, so it outlives localStorage.clear() — the turn-timer leg below turns it on.
  useSettingsStore.setState({ turnTimerEnabled: false });
  usePartyStore.setState({ parties: [], activePartyId: null });
  useLayoutStore.setState({ root: null, hoveredCid: null });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  // jsdom has no ResizeObserver, and several tracker panes observe themselves in an effect — without
  // it PartyView throws on mount and every assertion below reads as a door failure.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  stubMedia(false);
  stubFetch();
});

afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

/** Start the whole app on the roster, the way a user who just launched it arrives. */
async function openApp(): Promise<void> {
  localStorage.setItem(ROSTER_KEY, JSON.stringify([saved('char-a', 'Ayla Brightwood', 5)]));
  const { setPref } = await import('../src/data/prefs');
  setPref('startupScreen', 'characters');
  // Warm the lazy chunks so opening the page is a re-render, not a cold module transform.
  await import('../src/integration/CampaignTracker');
  await import('../src/integration/TrackerTools');
  const { default: App } = await import('../src/App');
  render(<App />);
  await flush(8);
}

/** Mount the tracker on one membership — a real campaign, or the synthetic local table. */
async function openTracker(m: CampaignMembership, onLeave: () => void = () => undefined): Promise<HTMLElement> {
  const { CampaignTracker } = await import('../src/integration/CampaignTracker');
  const el = render(
    <CampaignTracker
      m={m}
      content={content()}
      onOpenSettings={() => undefined}
      onLeave={onLeave}
      onViewMember={() => undefined}
    />,
  );
  await flush();
  return el;
}

/** The whole page, which is what puts the tracker's tools in Heroes Heaven's chrome. */
async function openPage(onClose: () => void = () => undefined): Promise<HTMLElement> {
  await import('../src/integration/CampaignTracker');
  await import('../src/integration/TrackerTools');
  const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
  const el = render(
    <CampaignsPage
      content={content()}
      onClose={onClose}
      onOpenRoster={() => undefined}
      onOpenHomebrew={() => undefined}
      characters={[]}
      modes={{}}
      onSaveMode={() => undefined}
      onDeleteMode={() => undefined}
    />,
  );
  await flush(6);
  return el;
}

/** The same membership CampaignsPage hands the tracker when nobody is signed in. */
const openLocalTable = () => openTracker(LOCAL_TABLE);

/** Take the mounted tree down mid-test, the way leaving the campaign does. */
function unmount(): void {
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
}

describe('the initiative tracker without an account', () => {
  it('gives a signed-out desktop user the local table through the Campaigns menu item', async () => {
    // tracker 2026-09-16: offline door
    // Without the App gate (restore `auth.status === 'signed-in' || devBypass ? … : undefined`
    // at src/App.tsx's onOpenCampaigns):
    //   Error: no button labelled "Campaigns" — found: …, "Menu", "Homebrew", "Settings", …
    // Without the page's own branch (drop `localTable ?` in CampaignsPage's body):
    //   AssertionError: expected null not to be null            ← no .campaign-tracker
    await openApp();

    click(btn('Menu'));
    await flush(1);
    click(btn('Campaigns'));
    await flush(6);

    // The page opened, and it IS the tracker — not a campaigns list.
    expect(document.querySelector('.cmp-page')).not.toBeNull();
    expect(document.querySelector('.campaign-tracker')).not.toBeNull();
    expect(host!.textContent).toContain('Initiative tracker');
    expect(host!.textContent).toContain('Sign in to run campaigns with players');

    // The table it opened on is the local one, empty and named.
    const party = usePartyStore.getState().parties.find((p) => p.campaignId === 'local');
    expect(party?.name).toBe('Local table');
    expect(party?.players).toEqual([]);

    // None of the online furniture: no party read to fail, nothing to create, nothing to join.
    expect(host!.textContent).not.toContain('Party not found.');
    expect(host!.textContent).not.toContain('Create a campaign');
    expect(host!.textContent).not.toContain('Join with a code');
    expect(host!.textContent).not.toContain("You don't run any campaigns yet");

    // …and the tracker's own way of filling the board is right there.
    expect(host!.textContent).toContain('Add combatants');
  }, 180_000);

  it('still shows no Campaigns item on a signed-out phone', async () => {
    // tracker 2026-09-16: offline door — "I don't want the GM side of campaign management and
    // initiative tracking in the phone version." Opening the door on desktop must not open it here.
    stubMedia(true);
    await openApp();

    click(btn('Menu'));
    await flush(1);
    expect(findBtn('Campaigns')).toBeUndefined();
    // The menu really is open and populated — otherwise the assertion above proves nothing.
    expect(findBtn('Homebrew')).toBeDefined();
  }, 180_000);

  it('leaves a signed-in GM’s campaigns list exactly as it was', async () => {
    // tracker 2026-09-16: offline door — the signed-in page must not notice any of this.
    srv.auth = 'signed-in';
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
    const el = render(
      <CampaignsPage
        content={content()}
        onClose={() => undefined}
        onOpenRoster={() => undefined}
        onOpenHomebrew={() => undefined}
        characters={[]}
        modes={{}}
        onSaveMode={() => undefined}
        onDeleteMode={() => undefined}
      />,
    );
    await flush();

    expect(el.textContent).toContain('Campaigns you');
    expect(el.textContent).toContain('The Salt Road');
    expect(el.textContent).toContain('Create a campaign');
    expect(el.querySelector('.cmp-card-btn')).not.toBeNull();
    expect(el.textContent).not.toContain('Initiative tracker');
    expect(el.textContent).not.toContain('Sign in to run campaigns with players');

    // Opening it is still the campaign's own tracker, under the campaign's own scope.
    click(el.querySelector('.cmp-card-btn')!);
    await flush(6);
    expect(el.querySelector('.campaign-tracker')).not.toBeNull();
    expect(usePartyStore.getState().parties.find((p) => p.campaignId === 'camp-1')).toBeDefined();
    expect(srv.calls).toContain('fetchParty');
  }, 180_000);

  it('persists the local board under its own scope and never touches the standalone save', async () => {
    // tracker 2026-09-16: offline door — the bare `pf2e-current-combat` key is what the STANDALONE
    // tracker saved before scoping existed, and what cloud sync deliberately excludes. Dropping the
    // local table onto it would hand a signed-out user someone's half-finished old fight and then
    // write over it.
    // Without the fix (`setScope(null)` — or no setScope effect at all — in CampaignTracker):
    //   AssertionError: expected null not to be null            ← nothing under pf2e-current-combat:local
    //   and the bare key no longer holds the standalone save.

    // Drain anything the store reset above queued (it is scoped to nothing yet), then put a real
    // pre-scoping save on the bare key.
    flushPersist();
    localStorage.setItem(COMBAT_BARE, STANDALONE_SAVE);

    await openLocalTable();
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Bandit lookout' }));
    await flush(1);
    act(() => flushPersist());

    const scoped = localStorage.getItem(COMBAT_LOCAL);
    expect(scoped).not.toBeNull();
    expect(JSON.parse(scoped!).combatants.map((c: { name: string }) => c.name)).toEqual(['Bandit lookout']);
    // Byte for byte: not re-saved, not merged, not emptied.
    expect(localStorage.getItem(COMBAT_BARE)).toBe(STANDALONE_SAVE);
    // …and the local table did not adopt it either.
    expect(useCombatStore.getState().combatants.map((c) => c.name)).toEqual(['Bandit lookout']);
  }, 120_000);

  it('makes no server call at all for the local table', async () => {
    // tracker 2026-09-16: offline door — there is no account, so every one of these would be a
    // guaranteed-failing round trip, and the party read failing is what puts "Couldn't load the
    // party" (or, before that, "Party not found.") in front of someone who has no party.
    // Without the fix (drop `if (offline) return;` from CampaignTracker's fetchParty effect):
    //   AssertionError: expected [ 'fetchParty' ] to deeply equal []
    // Without `if (m.local) return;` in useCampaignDefaults (give LOCAL_TABLE any non-empty code and
    // the old version was already on the wire, silently):
    //   AssertionError: expected [ 'fetchCampaignByCode:' ] to deeply equal []
    const el = await openLocalTable();

    // Work the board the way a GM would: add a creature, name-quick-add another, damage one.
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Ayla Brightwood', isPC: true, maxHP: 40 }));
    act(() => useCombatStore.getState().addCombatant(null, { name: 'Bandit lookout' }));
    await flush(2);
    const pc = useCombatStore.getState().combatants.find((c) => c.isPC)!;
    act(() => useCombatStore.getState().applyDamage(pc.id, 7));
    await flush(3);

    expect(srv.calls).toEqual([]);
    // The damage landed locally — the board works, it just works alone.
    expect(useCombatStore.getState().combatants.find((c) => c.isPC)?.currentHP).toBe(33);
    expect(el.textContent).not.toContain('Party not found.');
    expect(el.textContent).not.toContain("Couldn't load the party");
  }, 120_000);

  /*
   * THE OTHER DEVICE'S BOARD HAS TO ARRIVE BEFORE THIS ONE IS SCOPED.
   *
   * startTrackerSync's opening pull WRITES the newer board into localStorage; `setScope` READS
   * localStorage. Scope first and this device draws its own stale copy — and the moment the GM
   * touches it, that key is dirty, a dirty key beats the cloud, and the other device's newer board is
   * pushed over with this one's. So the order is the whole point, and it is what this leg holds.
   */
  it('starts the GM mirror under the GM’s own account and scopes the board only once its pull lands', async () => {
    // tracker 2026-09-16: GM-device sync
    // Without the gate (`setScope(m.id)` with no `if (!synced) return`):
    //   AssertionError: expected 'pf2e-current-combat:camp-1' to be 'pf2e-current-combat'
    // Without the start (the effect never reaching startTrackerSync):
    //   AssertionError: expected [ 'fetchParty', 'fetchParty' ] to include 'startTrackerSync:gm-1'
    // Without the `!offline` guard on the uid (the local half below):
    //   AssertionError: expected [ 'startTrackerSync:gm-1' ] to deeply equal []
    srv.auth = 'signed-in';
    srv.holdReady = true;
    // This leg reads the scope, so it must start from a known one — an earlier mount's campaign would
    // otherwise be the thing being asserted.
    act(() => useCombatStore.getState().setScope(null));

    await openTracker(CAMPAIGN);

    // Started, with the uid from the session and nothing else.
    expect(srv.calls).toContain('startTrackerSync:gm-1');
    // …and the board is still UNSCOPED: the pull hasn't landed, so localStorage may hold this
    // device's stale copy of camp-1 and nothing may be read out of it yet.
    expect(scopeKey(COMBAT_BARE)).toBe(COMBAT_BARE);
    // …so there is nothing to work on either. The rail used to draw the store's contents through this
    // whole window — with no scope set, that is the BARE key: the standalone board this view never
    // touches. Damage applied there went into it and then vanished when the scope swapped.
    // Without the `if (!synced)` early return in CampaignTracker:
    //   AssertionError: expected '…Add combatants…' not to contain 'Add combatants'
    expect(host!.textContent).not.toContain('Add combatants');
    expect(host!.querySelector('.ct-order')).toBeNull();

    act(() => srv.releaseReady!());
    await flush(2);
    expect(scopeKey(COMBAT_BARE)).toBe('pf2e-current-combat:camp-1');
    expect(host!.textContent).toContain('Add combatants'); // …and now the table is there

    // Leaving the campaign stops it — the mirror is per signed-in session, not a listener that outlives
    // the view (stop() also flushes whatever push was still pending).
    unmount();
    expect(srv.calls).toContain('stopTrackerSync');

    // THE LOCAL TABLE, with the very same account signed in: no mirror, ever. There is no campaign
    // behind it and `gm_tracker_state` is keyed by campaign-scoped board — mirroring `local` would put
    // a signed-out-by-design table onto every one of this GM's devices.
    srv.calls.length = 0;
    srv.holdReady = false;
    await openLocalTable();
    expect(srv.calls).toEqual([]);
    // Not mirrored, and not held up either: its own scope is live immediately.
    expect(scopeKey(COMBAT_BARE)).toBe(COMBAT_LOCAL);
  }, 180_000);

  /*
   * THE CAP IS A PROMISE, SO IT HAS TO BE PINNED. The GM plays off LOCAL data: a mirror whose opening
   * pull never answers — a dead socket, a Supabase outage, a project that was never set up — must not
   * leave the table behind "Opening the table…" for good. Nothing held the number, so
   * SYNC_READY_CAP_MS = 4_000_000 (an hour and a bit) left every other leg in this file green.
   * With that mutation:
   *   AssertionError: expected null not to be null            ← no .ct-order; the blackout never lifts
   */
  it('draws the board anyway when the mirror’s opening pull never answers', async () => {
    srv.auth = 'signed-in';
    srv.holdReady = true; // …and nothing ever calls releaseReady
    act(() => useCombatStore.getState().setScope(null));
    vi.useFakeTimers();
    try {
      await openTracker(CAMPAIGN);
      expect(host!.querySelector('.ct-order')).toBeNull(); // still waiting, as leg (f) holds

      // 4000 written out rather than imported from the seam: a leg that advances by the constant it is
      // pinning moves with it and pins nothing. Keep it equal to SYNC_READY_CAP_MS.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      await flush(2);

      expect(host!.querySelector('.ct-order')).not.toBeNull();
      // …and it is the CAMPAIGN's board it drew, not the standalone one it was never allowed to touch.
      expect(scopeKey(COMBAT_BARE)).toBe('pf2e-current-combat:camp-1');
    } finally {
      vi.useRealTimers();
    }
  }, 180_000);

  it('never starts the GM mirror for a player’s membership', async () => {
    // tracker 2026-09-16: GM-device sync. `gm_tracker_state` is the GM's own board, owner-keyed; a
    // player's device has none to mirror, and starting it there would upload that player's local
    // tracker under their account. Nothing held this half of `syncUid` before.
    // Without `m.role === 'gm'` in CampaignTracker's syncUid:
    //   AssertionError: expected [ 'startTrackerSync:gm-1' ] to deeply equal []
    srv.auth = 'signed-in';
    await openTracker({ id: 'camp-1', code: 'TESTCODE', role: 'player', name: 'The Salt Road' });

    expect(srv.calls.filter((c) => c.startsWith('startTrackerSync'))).toEqual([]);
    expect(srv.calls).toContain('fetchParty'); // it is still a real, online campaign — just not theirs to mirror
  }, 180_000);

  it('leaves Escape inside the tracker to the tracker, not to the page underneath', async () => {
    // tracker 2026-09-16: offline door. The dismiss stack is LIFO and a child's effect runs before
    // its parent's, so on any commit where the tracker mounts WITH the page — a warm lazy chunk, and
    // the local table always — the page's own `useEscapeClose(onClose)` sat ON TOP of the tracker's
    // base handler. One Escape out of an initiative row's right-click menu left the whole page:
    // no guardLeave (unpushed GM sheet edits discarded in silence), no trackerPopupOpen check.
    // Without the fix (`useEscapeClose(onClose)` unconditionally in CampaignsPage):
    //   AssertionError: expected 1 to be +0
    let closed = 0;
    await import('../src/integration/CampaignTracker');
    await import('../src/integration/TrackerTools');
    const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
    const el = render(
      <CampaignsPage
        content={content()}
        onClose={() => {
          closed += 1;
        }}
        onOpenRoster={() => undefined}
        onOpenHomebrew={() => undefined}
        characters={[]}
        modes={{}}
        onSaveMode={() => undefined}
        onDeleteMode={() => undefined}
      />,
    );
    await flush(6);
    expect(el.querySelector('.campaign-tracker')).not.toBeNull();

    // A tracker popup portalled to <body>, exactly as a row's context menu does it. The tracker's own
    // base handler stands down for it — and nothing of the page's may be above it.
    const popup = document.createElement('div');
    popup.className = 'tracker-root';
    document.body.appendChild(popup);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await flush(2);
    expect(closed).toBe(0);

    // …and with nothing open, the same press does leave — through the tracker's guarded exit.
    popup.remove();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await flush(2);
    expect(closed).toBe(1);
  }, 180_000);

  it('makes no call for the campaign a signed-out web device was last in, and still remembers it', async () => {
    // tracker 2026-09-16: offline door. `signOut()` clears neither the remembered campaign nor the
    // cached memberships, and the local table deliberately waits out `auth.status === 'loading'` — so
    // seeding the view from render opened a REAL campaign's tracker in that window: a party read and
    // the member-sheet subscriptions going out for a campaign this device has no session for. And the
    // "back to the list" bookkeeping then cleared the memory, so the next signed-in visit opened cold.
    // Without the fix (view seeded in useState + rememberCampaign(null) on the first run):
    //   AssertionError: expected [ 'fetchParty' ] to deeply equal []
    //   AssertionError: expected null to be 'camp-1'
    srv.auth = 'loading';
    rememberCampaign('camp-1');
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
    // A FRESH element each time: React bails out of a re-render handed the identical one, and the
    // whole point here is the second pass, once auth has answered.
    const page = () => (
      <CampaignsPage
        content={content()}
        onClose={() => undefined}
        onOpenRoster={() => undefined}
        onOpenHomebrew={() => undefined}
        characters={[]}
        modes={{}}
        onSaveMode={() => undefined}
        onDeleteMode={() => undefined}
      />
    );
    render(page());
    await flush(3);
    expect(srv.calls).toEqual([]);
    expect(document.querySelector('.campaign-tracker')).toBeNull();

    // The session comes back "no session". Now the local table is the page.
    srv.auth = 'disabled';
    act(() => live!.render(page()));
    await flush(6);
    expect(host!.textContent).toContain('Sign in to run campaigns with players');
    expect(srv.calls).toEqual([]);
    // …and the campaign this GM was running is still what their next signed-in visit opens on.
    expect(getRememberedCampaign()).toBe('camp-1');
  }, 180_000);

  it('keeps the tracker’s TOOLS out of the chrome until the board is the campaign’s own', async () => {
    // tracker 2026-09-16: GM-device sync. The `!synced` blackout stopped at the tracker BODY. The
    // tools row is rendered by CampaignsPage — in Heroes Heaven's chrome, outside CampaignTracker —
    // so it knew nothing about the wait, and its turn-timer chip calls pause / resume / discard /
    // removeTurn / saveTurnsToAverages straight on the combat store. With no scope set that store
    // persists to the BARE `pf2e-current-combat`: the standalone tracker's board, the one key this
    // view must never touch. "Save to Averages" writes pf2e-parties and pf2e-dm-turn-average on top,
    // both of which the GM mirror uploads — turn data harvested off someone else's board.
    // Without the fix (TrackerTools rendering regardless of boardReady):
    //   AssertionError: expected null not to be null            ← .tracker-tools, mid-blackout
    srv.auth = 'signed-in';
    srv.holdReady = true;
    useSettingsStore.setState({ turnTimerEnabled: true });
    localStorage.setItem(COMBAT_BARE, STANDALONE_SAVE);
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    act(() => useCombatStore.getState().setScope(null));

    const el = await openPage();
    click(el.querySelector('.cmp-card-btn')!);
    await flush(6);

    // The board is still opening…
    expect(el.textContent).toContain('Opening the table');
    expect(scopeKey(COMBAT_BARE)).toBe(COMBAT_BARE);
    // …so neither row offers anything that writes to the combat store.
    expect(el.querySelector('.tracker-tools')).toBeNull();
    expect(findBtn('Pause timer')).toBeUndefined();
    expect(findBtn('Saved encounters')).toBeUndefined();
    expect(localStorage.getItem(COMBAT_BARE)).toBe(STANDALONE_SAVE);

    act(() => srv.releaseReady!());
    await flush(4);
    expect(el.querySelector('.tracker-tools')).not.toBeNull();
    expect(findBtn('Pause timer')).toBeDefined();
    expect(scopeKey(COMBAT_BARE)).toBe('pf2e-current-combat:camp-1');
  }, 180_000);

  it('goes back behind the gate when the mirror restarts under a refreshed session', async () => {
    // tracker 2026-09-16: GM-device sync. `synced` only ever went true, so a session that LEFT and
    // re-entered 'signed-in' (a token refresh) tore the mirror down and started a new one — with a new
    // opening pull in flight — over a board that was already drawn and editable. A GM who touches the
    // board in that window marks its key dirty, and a dirty key beats the cloud: this device's copy
    // goes up over whatever the other device did while the mirror was down.
    // Without the fix (no `setSynced(false)` at the top of the sync effect):
    //   AssertionError: expected '…Add combatants…' not to contain 'Add combatants'
    srv.auth = 'signed-in';
    await openTracker(CAMPAIGN);
    expect(host!.textContent).toContain('Add combatants');

    // The session blinks. The next start's pull is held, so the window is visible.
    srv.holdReady = true;
    srv.auth = 'loading';
    const { CampaignTracker } = await import('../src/integration/CampaignTracker');
    act(() =>
      live!.render(
        <CampaignTracker
          m={CAMPAIGN}
          content={content()}
          onOpenSettings={() => undefined}
          onLeave={() => undefined}
          onViewMember={() => undefined}
        />,
      ),
    );
    await flush(2);
    expect(host!.textContent).not.toContain('Add combatants');
    expect(host!.textContent).toContain('Opening the table');
  }, 180_000);

  it('does not let a panel opened during the blackout swallow Escape', async () => {
    // tracker 2026-09-16: GM-device sync. The overlay dismiss handlers registered off trackerUi state
    // alone, but the overlays themselves render BELOW the "Opening the table…" early return. The
    // chrome's Customize button is rendered by CampaignsPage off `trackerView`, so it stays clickable
    // through the whole blackout: pressing it pushed a "close the appearance panel" handler onto the
    // dismiss stack with nothing on screen, and the next Escape closed that instead of leaving the
    // campaign. Same LIFO trap the round fixed one level up, in CampaignsPage.
    // Without the fix (`useBackHandler(appearanceOpen, …)` with no `synced &&`):
    //   AssertionError: expected <div class="campaign-tracker">…(1)</div> to be null
    srv.auth = 'signed-in';
    srv.holdReady = true;
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    const el = await openPage();
    click(el.querySelector('.cmp-card-btn')!);
    await flush(6);
    expect(el.textContent).toContain('Opening the table');

    click(btn('Customize tracker appearance'));
    await flush(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await flush(3);

    // One press, one thing: out of the campaign, through the tracker's own guarded exit.
    expect(el.querySelector('.campaign-tracker')).toBeNull();
    expect(el.textContent).toContain('Campaigns you');
  }, 180_000);

  it('re-enters the campaign instantly after a trip to its settings', async () => {
    // tracker 2026-09-16: GM-device sync. The mirror is refcounted and CampaignTracker was its only
    // holder, so campaign settings — which unmounts the tracker and mounts it again on the way back —
    // dropped the count to zero: teardown on the way out, a fresh opening pull on the way in, and the
    // whole "Opening the table…" blackout (up to four seconds) for a round trip that never left the
    // campaign. The page now holds the mirror for the visit, and a board whose mirror never went down
    // has nothing to wait for.
    // Without the fix (no mirror hold in CampaignsPage, or `useState(false)` for CampaignTracker's
    // `synced` again):
    //   AssertionError: expected null not to be null            ← no .ct-order, back on the blackout
    srv.auth = 'signed-in';
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    const el = await openPage();
    click(el.querySelector('.cmp-card-btn')!);
    await flush(6);
    expect(el.querySelector('.ct-order')).not.toBeNull();
    expect(srv.holders).toBe(2); // the tracker, and the page for as long as the GM is in the campaign

    // The tools ask for the campaign's settings page: the tracker unmounts, the page stays.
    act(() => trackerUi.requestCampaignSettings());
    await flush(4);
    expect(el.querySelector('.campaign-tracker')).toBeNull();
    expect(el.textContent).toContain('Share code');
    expect(srv.holders).toBe(1); // …and the mirror is still up

    // Back to the campaign. NO flush: the board has to be there in the very commit the click causes,
    // not a network round trip (or even a microtask) later.
    //
    // …and never drawn at all on the way there, which the mutation records are what can tell us. The
    // effect at CampaignTracker's :350 sets `synced` all over again, so on the DOM alone the initial
    // state at :343 could be `useState(false)` with this leg still green — while the GM watches the
    // blackout flash past on every trip to the campaign's settings and back. The frame the initial
    // state decides is the one a browser paints, so it is the one asserted.
    const frames = textEverShown(el);
    click(el.querySelector('.hb-back')!);
    expect(frames.seen()).not.toContain('Opening the table');
    frames.stop();
    expect(el.textContent).not.toContain('Opening the table');
    expect(el.querySelector('.ct-order')).not.toBeNull();
    await flush(2);
    expect(el.querySelector('.ct-order')).not.toBeNull();
  }, 180_000);

  it('brings the GM back to the view they left the campaign on', async () => {
    // tracker 2026-09-16: `view` moved from a lazy initial state to a flat { kind: 'list' } plus an
    // adopt effect, which made the reset below fire on EVERY mount of this page — `view.kind` IS
    // 'list' on the first commit, every time. A GM who left with the GM screen open came back to the
    // party view, and any open panel was closed with it.
    // Without the fix (`if (TRACKER_IN_CAMPAIGN && view.kind === 'list') trackerUi.reset()` with no
    // first-run ref):
    //   AssertionError: expected 'party' to be 'gm'
    srv.auth = 'signed-in';
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    const el = await openPage();
    click(el.querySelector('.cmp-card-btn')!);
    await flush(6);
    act(() => trackerUi.showMain('gm'));
    await flush(2);
    expect(mainViewNow()).toBe('gm');

    unmount(); // out of the page — the hamburger, Escape, the app closing on it
    const back = await openPage(); // …and back in, on the campaign it remembers
    await flush(4);
    expect(mainViewNow()).toBe('gm');

    // …and a REAL return to the list still clears it, which is the whole point of that effect.
    click(back.querySelector('.hb-back')!);
    await flush(4);
    expect(back.querySelector('.campaign-tracker')).toBeNull();
    expect(mainViewNow()).toBe('party');
  }, 180_000);

  it('never boots a signed-out phone onto the campaigns page', async () => {
    // tracker 2026-09-16: offline door. The menu item is hidden on a signed-out phone ("I don't want
    // the GM side of campaign management and initiative tracking in the phone version") — but the
    // BOOT path asked nothing at all, just "was the app closed there?", so the same phone launched
    // straight onto the page the gate exists to keep shut. One predicate now answers both.
    // Without the fix (`if (bootToCampaign)` with no campaignsReachable):
    //   AssertionError: expected <div class="hb-page cmp-page">…</div> to be null
    stubMedia(true);
    setOnCampaignsPage(true);
    localStorage.setItem(ROSTER_KEY, JSON.stringify([saved('char-a', 'Ayla Brightwood', 5)]));
    const { setPref } = await import('../src/data/prefs');
    setPref('startupScreen', 'last');
    const { default: App } = await import('../src/App');
    render(<App />);
    await flush(10);

    expect(document.querySelector('.cmp-page')).toBeNull();
    expect(document.querySelector('.campaign-tracker')).toBeNull();
    // It landed on the character it was last on instead — the phone's normal boot.
    expect(host!.textContent).toContain('Ayla Brightwood');
  }, 180_000);

  it('still reopens the campaign when the phone’s session answers after the content load', async () => {
    // tracker 2026-09-16: offline door. The phone gate is the right gate — and it was asked too early.
    // `campaignsReachable` is false while auth is 'loading' (no account YET is not "no account"), and
    // the boot restore read it ONCE, inside the content load. On a phone that order is the normal one:
    // core.json comes straight out of the service worker's cache while an expired token is still being
    // refreshed over the network. So a signed-IN GM's phone, closed on a campaign, reopened on a
    // character sheet — and nothing ever re-ran the decision. HEAD reopened the campaign here.
    // Without the fix (deciding inside the load, from `campaignsReachableRef.current`):
    //   AssertionError: expected null not to be null            ← no .cmp-page, then or ever
    srv.auth = 'loading';
    stubMedia(true);
    setOnCampaignsPage(true);
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    localStorage.setItem(ROSTER_KEY, JSON.stringify([saved('char-a', 'Ayla Brightwood', 5)]));
    const { setPref } = await import('../src/data/prefs');
    setPref('startupScreen', 'last');
    const { default: App } = await import('../src/App');
    render(<App />);
    await flush(10); // the content is in; the session still isn't

    expect(host!.textContent).toContain('Signing in');

    // …and now it is. The restore has waited for exactly this.
    // (The settled NO is the leg above: a phone whose session says "no account" boots to the sheet.)
    await answerAuth('signed-in');
    await flush(6);
    expect(document.querySelector('.cmp-page')).not.toBeNull();
  }, 180_000);

  /*
   * …AND NOT WHEN THE USER HAS ALREADY MOVED ON. The restore waits for the session (the leg above), and
   * the listeners that cancel it — "the user is using the app, leave them where they are" — came off
   * the moment loadContent() resolved, which is where the waiting STARTS. So the whole wait had nobody
   * listening: a GM who gave up on the spinner and started tapping the roster was still yanked onto the
   * campaigns page when the token finally came back. The listeners belong to the decision, not to the
   * load, so they come off in the effect that makes it.
   * With the two removeEventListener calls back inside loadContent().then():
   *   AssertionError: expected <div class="hb-page cmp-page">…</div> to be null
   */
  it('leaves the phone where the user put it when the session answers late', async () => {
    srv.auth = 'loading';
    stubMedia(true);
    setOnCampaignsPage(true);
    localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
    localStorage.setItem(ROSTER_KEY, JSON.stringify([saved('char-a', 'Ayla Brightwood', 5)]));
    const { setPref } = await import('../src/data/prefs');
    setPref('startupScreen', 'last');
    const { default: App } = await import('../src/App');
    render(<App />);
    await flush(10); // the content is in; the session still isn't

    // The GM stops waiting and starts using the app. jsdom has no PointerEvent — the type is what the
    // capture listener is registered for, and that is all it reads.
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });

    await answerAuth('signed-in');
    await flush(6);

    expect(document.querySelector('.cmp-page')).toBeNull();
    expect(host!.textContent).toContain('Ayla Brightwood'); // still on the roster they were using
  }, 180_000);

  it('reopens on the local table when the app was closed on it', async () => {
    // tracker 2026-09-16: offline door. The boot restore needed a REMEMBERED CAMPAIGN as well as the
    // "was on the campaigns page" marker — and signed out the page IS the tracker, with no campaign to
    // remember. So the one user this door was built for was dropped on the roster at every launch and
    // had to go back through the hamburger, while a signed-in GM always reopened in their campaign.
    // Without the fix (`wasOnCampaignsPage() && !!getRememberedCampaign()` in App's bootToCampaign):
    //   AssertionError: expected null not to be null            ← no .campaign-tracker
    setOnCampaignsPage(true); // closed there…
    rememberCampaign(null); // …with nothing to remember, because there is no campaign
    localStorage.setItem(ROSTER_KEY, JSON.stringify([saved('char-a', 'Ayla Brightwood', 5)]));
    const { setPref } = await import('../src/data/prefs');
    setPref('startupScreen', 'last');
    await import('../src/integration/CampaignTracker');
    await import('../src/integration/TrackerTools');
    const { default: App } = await import('../src/App');
    render(<App />);
    await flush(10);

    expect(document.querySelector('.campaign-tracker')).not.toBeNull();
    expect(host!.textContent).toContain('Sign in to run campaigns with players');
  }, 180_000);

  /*
   * LAST IN THIS FILE ON PURPOSE. It resets the module registry to get a COLD lazy chunk — the state
   * every other leg here reaches through this file's top-level store imports would be a different
   * copy afterwards, so nothing may follow it.
   */
  it('closes the page on Escape while the tracker chunk is still loading', async () => {
    // tracker 2026-09-16: offline door. `trackerView` is true from the first render — the local table
    // never leaves view.kind === 'list' — but <CampaignTracker> is LAZY, so on a cold chunk that
    // first commit contains no tracker. Handing Escape over on `trackerView` alone handed it to
    // NOBODY: useEscapeClose got `undefined`, useBackHandler's own condition was false (the local
    // table never leaves the list), and Escape — with Android-back, which is the same stack — did
    // nothing at all until the chunk landed. On a cold start that is the whole first visit.
    // Without the fix (`useEscapeClose(trackerView ? undefined : onClose)`):
    //   AssertionError: expected +0 to be 1
    vi.resetModules(); // cold again: the first render suspends, exactly as a real first visit does
    let closed = 0;
    const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
    const el = render(
      <CampaignsPage
        content={content()}
        onClose={() => {
          closed += 1;
        }}
        onOpenRoster={() => undefined}
        onOpenHomebrew={() => undefined}
        characters={[]}
        modes={{}}
        onSaveMode={() => undefined}
        onDeleteMode={() => undefined}
      />,
    );

    // The page is up; the tracker is still on its way.
    expect(el.querySelector('.cmp-page')).not.toBeNull();
    expect(el.querySelector('.campaign-tracker')).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(closed).toBe(1);

    // …and the moment it lands, Escape belongs to the tracker again (its own guarded exit).
    await import('../src/integration/CampaignTracker');
    await flush(6);
    expect(el.querySelector('.campaign-tracker')).not.toBeNull();
  }, 180_000);
});
