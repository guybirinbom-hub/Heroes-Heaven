// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { ROSTER_KEY, type SavedChar } from '../src/data/storage';
import type { CampaignMembership } from '../src/data/campaigns';
import type { PublishResult } from '../src/data/party';
import { setPref } from '../src/data/prefs';

/**
 * A CAMPAIGN THAT IS GONE, in the real <App/> (2026-10-23; the harness of test/campaign-leave-app.test.tsx,
 * the party layer mocked). When a GM deleted a campaign, or removed a player from it, the player's app kept
 * sending the character there: each send failed, and online / focus / visible sent it again, forever.
 * Now a send the server PROVES can never land ('gone' / 'refused' — test/party-publish-gone.test.ts) stops
 * the sending for this session, and the campaign's card says why, with Leave as the way out. An unknown
 * failure retries exactly as before. The character keeps its campaign until the player leaves.
 *
 * And the builder (same harness): Cancel after a Leave on the Setup card asks nothing (the leave is already
 * saved); Cancel after a JOIN still asks (a join lives in the draft until Save).
 *
 * Synthetic characters only.
 */
const net = vi.hoisted(() => ({
  publishes: [] as { campaignId: string; charId: string }[],
  unpublishes: [] as { campaignId: string; charId: string }[],
  /** What each publish answers, in order; then 'ok'. */
  publishAnswers: [] as PublishResult[],
  /** Set: the next publish waits on the wire until the leg calls `release(answer)`. */
  holdNext: false,
  release: null as null | ((r: PublishResult) => void),
  /** The signed-in account (null: a session-less sign-in, as the other App tests run). */
  uid: null as string | null,
  authListeners: new Set<() => void>(),
  authSnap: null as unknown,
}));

vi.mock('../src/data/useAuth', async () => {
  const { useSyncExternalStore } = await import('react');
  const snap = () => {
    const s = net.authSnap as { uid: string | null } | null;
    if (!s || s.uid !== net.uid) {
      net.authSnap = {
        uid: net.uid,
        status: 'signed-in',
        session: net.uid ? { user: { id: net.uid, email: 'player@example.com' } } : null,
        email: 'player@example.com',
      };
    }
    return net.authSnap;
  };
  return {
    useAuth: () =>
      useSyncExternalStore(
        (l: () => void) => {
          net.authListeners.add(l);
          return () => net.authListeners.delete(l);
        },
        snap,
      ),
  };
});
/** Another account signs in (in this tab). */
function switchAccount(uid: string | null) {
  net.uid = uid;
  act(() => {
    for (const l of net.authListeners) l();
  });
}
vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  fetchGmEdits: async () => [],
  fetchPublishedSheet: async () => ({ sheet: null, updatedAt: undefined, ownerId: undefined }),
  publishCharacter: async (campaignId: string, charId: string) => {
    net.publishes.push({ campaignId, charId });
    if (net.holdNext) {
      net.holdNext = false;
      return new Promise<PublishResult>((done) => {
        net.release = done;
      });
    }
    return net.publishAnswers.shift() ?? 'ok';
  },
  unpublishCharacter: async (campaignId: string, charId: string) => {
    net.unpublishes.push({ campaignId, charId });
    return 'ok';
  },
  deleteGmEdit: async () => 1,
  markGmEditRefused: async () => true,
  currentUserId: async () => null, // no Realtime subscription in the test
}));
vi.mock('../src/data/cloudSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloudSync')>()),
  startCloudSync: async () => () => undefined,
  pullForGmApply: () => null,
  hasSyncedOnce: () => true,
}));
vi.mock('../src/data/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaigns')>()),
  fetchOwnedCampaignIds: async () => ({ ok: true, value: [] }),
  // The join leg joins a campaign the account is already in, which needs no server: a lookup that fails.
  fetchCampaignByCode: async () => ({ ok: false, error: 'TEST offline' }),
}));
vi.mock('../src/data/campaignHomebrew', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaignHomebrew')>()),
  startCampaignHomebrew: () => () => undefined,
  refreshCampaignHomebrew: async () => undefined,
}));
vi.mock('../src/sheet/PartyMembers', () => ({
  PartyMembers: () => null,
  useMemberViewer: () => ({ sheetEl: null, open: () => undefined }),
}));

const jsdomWindow = (globalThis as unknown as { jsdom?: { window: { event?: Event } } }).jsdom?.window;
if (!jsdomWindow) throw new Error('fixture: the jsdom environment exposes no `jsdom` global');
Object.defineProperty(window, 'event', { configurable: true, get: () => jsdomWindow?.event, set: () => undefined });

const ACTIVE_KEY = 'wanderers-codex:active:v1';
const CAMPAIGNS_KEY = 'pf2e-codex.campaigns';
const APP_TIMEOUT = 120_000;
const CAMP = 'camp-salt';
const OTHER = 'camp-other';
const db = content();
const MEMBERSHIPS: CampaignMembership[] = [
  { id: CAMP, code: 'SALT23', role: 'player', name: 'TEST The Salt Road' },
  { id: OTHER, code: 'OTHR23', role: 'player', name: 'TEST Elsewhere' },
];

function saved(id: string, name: string, campaignIds: string[]): SavedChar {
  const build = {
    ...emptyBuild(),
    name,
    level: 1,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    classId: 'fighter',
    keyAbility: 'str',
    campaignIds,
  } as BuildState;
  const character = buildCharacter(build, db);
  return { id, character, build, play: initialPlay(character, db) } as SavedChar;
}

let live: Root | null = null;
afterEach(async () => {
  if (live) act(() => live!.unmount());
  live = null;
  for (const n of [...document.body.children]) n.remove();
  localStorage.clear();
  net.publishes = [];
  net.unpublishes = [];
  net.publishAnswers = [];
  net.holdNext = false;
  net.release = null;
  net.uid = null;
  // The marks are this session's memory (one module for the whole file): each leg starts with none.
  (await import('../src/data/campaignGone')).clearAllCampaignGone();
  vi.unstubAllGlobals();
});

const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const click = (el: Element | null | undefined, what: string) => {
  if (!el) throw new Error(`fixture: nothing to click (${what}) — on screen: ${(document.body.textContent ?? '').slice(0, 300)}`);
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
async function until(cond: () => boolean, ms = 4000) {
  for (let t = 0; t < ms && !cond(); t += 50) await wait(50);
}
const storedRoster = () => JSON.parse(localStorage.getItem(ROSTER_KEY) ?? '[]') as SavedChar[];
const storedIds = (id: string) => {
  const sc = storedRoster().find((c) => c.id === id);
  return [sc?.character.campaignIds ?? [], sc?.build?.campaignIds ?? []];
};
const buttonNamed = (text: string) => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === text);
function typeInto(el: Element | null, value: string, what: string) {
  if (!(el instanceof HTMLInputElement)) throw new Error(`fixture: no input (${what})`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  act(() => void el.dispatchEvent(new Event('input', { bubbles: true })));
}
const focusWindow = () => act(() => void window.dispatchEvent(new Event('focus')));
const sentTo = (cid: string) => net.publishes.filter((p) => p.campaignId === cid).length;

async function openApp(roster: SavedChar[], answers: PublishResult[] = [], opts: { uid?: string; hold?: boolean } = {}) {
  net.publishAnswers = [...answers];
  net.uid = opts.uid ?? null;
  net.holdNext = !!opts.hold;
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).split('/').pop() ?? '';
    if (name !== 'core.json' && name !== 'core-descriptions.json') return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`public/${name}`, 'utf8')) as unknown };
  });
  localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  if (roster[0]) localStorage.setItem(ACTIVE_KEY, roster[0].id);
  setPref('startupScreen', 'last');
  localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(MEMBERSHIPS));
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
  for (let i = 0; i < 200 && !host.querySelector('.party-tab'); i++) await wait(50);
  await wait(800); // the launch publish (PUBLISH_DEBOUNCE_MS = 400) and its answer
  return host;
}

async function openParty(host: HTMLElement) {
  click(host.querySelector('.party-tab'), 'the Party tab');
  await wait(50);
}
async function openBuilderSetup(host: HTMLElement) {
  click(host.querySelector('button[aria-label="Edit character"]'), 'Edit character');
  await wait(300);
  click(buttonNamed('Setup'), 'the builder’s Setup tab');
  await wait(100);
}

describe('a campaign the server proves gone: the app stops sending and says so', () => {
  it('GONE (the GM deleted it): no more sends on focus; the Party page and the Setup card say so; the character keeps the campaign', async () => {
    // OTHER fails once (unknown) at launch, so the focus retry below runs at all.
    const host = await openApp([saved('c1', 'TEST Hero', [CAMP, OTHER])], ['gone', 'failed']);
    expect(sentTo(CAMP), 'fixture: the launch sent the character to the campaign once').toBe(1);
    // MUTATION: drop `if (campaignGoneReason(cid)) continue;` from App's publish effect and the focus below
    // sends again (the old loop: the 'gone' answer was handled as a failure and retried on every focus).
    focusWindow();
    await wait(800);
    focusWindow();
    await wait(800);
    expect(sentTo(CAMP), 'never sent to the deleted campaign again').toBe(1);
    expect(sentTo(OTHER), 'fixture: the retry did run (the other campaign was sent again)').toBeGreaterThan(1);
    expect(storedIds('c1'), 'the character keeps both campaigns until the player leaves').toEqual([[CAMP, OTHER], [CAMP, OTHER]]);
    expect(net.unpublishes, 'and nothing is unpublished').toEqual([]);

    await openParty(host);
    const note = document.querySelector('.cmp-gone-note');
    expect(note?.textContent, 'the Party page says it plainly').toContain('Your GM deleted this campaign.');
    expect(buttonNamed('Leave campaign'), 'Leave stays the way out').toBeTruthy();
  }, APP_TIMEOUT);

  it('REMOVED (the GM removed this player): the same, with "You were removed"', async () => {
    const host = await openApp([saved('c1', 'TEST Hero', [CAMP])], ['refused']);
    focusWindow();
    await wait(800);
    expect(sentTo(CAMP), 'not sent again').toBe(1);
    await openBuilderSetup(host);
    const card = [...document.querySelectorAll('.cmp-in')].find((el) => el.textContent?.includes('TEST The Salt Road'));
    expect(card?.querySelector('.cmp-gone-note')?.textContent, 'the Setup card says it, beside Leave').toContain('You were removed from this campaign.');
    expect(card?.querySelector('.cmp-leave-btn'), 'Leave is still there').toBeTruthy();
  }, APP_TIMEOUT);

  it('UNKNOWN (any other failure): retried on focus exactly as before, and no note', async () => {
    const host = await openApp([saved('c1', 'TEST Hero', [CAMP])], ['failed']);
    focusWindow();
    await until(() => sentTo(CAMP) > 1);
    expect(sentTo(CAMP), 'sent again on focus').toBe(2);
    await openParty(host);
    expect(document.querySelector('.cmp-gone-note'), 'no label for a guess').toBeNull();
  }, APP_TIMEOUT);

  it('a send that LANDS clears the mark (a second character in the same campaign got through)', async () => {
    // MUTATION: drop `clearCampaignGone(cid);` from the 'ok' branch and the note stays.
    const host = await openApp([saved('c1', 'TEST Hero', [CAMP]), saved('c2', 'TEST Friend', [CAMP])], ['gone', 'ok']);
    await openParty(host);
    expect(document.querySelector('.cmp-gone-note'), 'the landed send proves the campaign is there').toBeNull();
    // MUTATION: drop `setPublishNonce(…)` beside it and c1, held back by the mark, is not sent again.
    await until(() => sentTo(CAMP) > 2);
    expect(net.publishes.filter((p) => p.campaignId === CAMP).map((p) => p.charId), 'and c1, held back by the mark, goes again').toEqual(['c1', 'c2', 'c1']);
  }, APP_TIMEOUT);

  it('another account signs in: every mark goes ("removed" is about one account)', async () => {
    await openApp([saved('c1', 'TEST Hero', [CAMP])], ['refused'], { uid: 'player-a' });
    const { campaignGoneReason } = await import('../src/data/campaignGone');
    expect(campaignGoneReason(CAMP), 'fixture: marked for account A').toBe('removed');
    // MUTATION: drop `useEffect(() => clearAllCampaignGone(), [publishUid]);` from App and the mark stays.
    switchAccount('player-b');
    await wait(50);
    expect(campaignGoneReason(CAMP), 'account B starts with none').toBeUndefined();
  }, APP_TIMEOUT);

  it('an answer that arrives after another account signed in marks nothing', async () => {
    await openApp([saved('c1', 'TEST Hero', [CAMP])], [], { uid: 'player-a', hold: true });
    expect(net.release, 'fixture: the launch send is on the wire').toBeTruthy();
    switchAccount('player-b');
    await wait(50);
    // MUTATION: drop `sentFor === publishUidRef.current &&` from App and B gets A's "removed".
    await act(async () => net.release!('refused'));
    await wait(50);
    const { campaignGoneReason } = await import('../src/data/campaignGone');
    expect(campaignGoneReason(CAMP), 'A’s answer is not B’s').toBeUndefined();
  }, APP_TIMEOUT);

  it('the mark goes with the LAST character in the campaign, so joining again later sends again', async () => {
    const host = await openApp([saved('c1', 'TEST Hero', [CAMP]), saved('c2', 'TEST Other', [OTHER])], ['gone']);
    const { campaignGoneReason } = await import('../src/data/campaignGone');
    expect(campaignGoneReason(CAMP), 'fixture: marked').toBe('gone');
    // MUTATION: drop the `keepCampaignGoneFor(…)` line from App's publish effect and the mark outlives the leave.
    await openParty(host);
    click(buttonNamed('Leave campaign'), 'Leave campaign');
    await wait(50);
    click(document.querySelector('.confirm-modal .btn-danger'), 'the question’s Leave campaign');
    await until(() => !campaignGoneReason(CAMP));
    expect(storedIds('c1'), 'fixture: c1 left').toEqual([[], []]);
    expect(campaignGoneReason(CAMP), 'no character is in it: the mark is gone').toBeUndefined();
  }, APP_TIMEOUT);

  it('a character still in the campaign keeps the mark when another one leaves', async () => {
    // c1 → CAMP gone, c2 → OTHER ok, c2 → CAMP gone.
    const host = await openApp([saved('c1', 'TEST Hero', [CAMP]), saved('c2', 'TEST Other', [OTHER, CAMP])], ['gone', 'ok', 'gone']);
    const { campaignGoneReason } = await import('../src/data/campaignGone');
    expect(campaignGoneReason(CAMP), 'fixture: marked').toBe('gone');
    await openParty(host);
    click(buttonNamed('Leave campaign'), 'Leave campaign');
    await wait(50);
    click(document.querySelector('.confirm-modal .btn-danger'), 'the question’s Leave campaign');
    await wait(1200);
    expect(storedIds('c1'), 'fixture: c1 left').toEqual([[], []]);
    expect(campaignGoneReason(CAMP), 'c2 is still in it: the mark stays').toBe('gone');
    expect(sentTo(CAMP), 'and nothing more is sent there').toBe(2);
  }, APP_TIMEOUT);
});

describe('the note’s words', () => {
  it('a GM’s own deleted campaign says "This campaign was deleted", not "Your GM deleted…" (a checker’s finding)', async () => {
    const { CampaignGoneNote } = await import('../src/sheet/CampaignGoneNote');
    const { markCampaignGone } = await import('../src/data/campaignGone');
    markCampaignGone(CAMP, 'gone');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    live = root;
    act(() =>
      root.render(
        <>
          <div className="as-gm"><CampaignGoneNote campaignId={CAMP} gm /></div>
          <div className="as-player"><CampaignGoneNote campaignId={CAMP} /></div>
        </>,
      ),
    );
    expect(host.querySelector('.as-gm')?.textContent).toContain('This campaign was deleted.');
    expect(host.querySelector('.as-gm')?.textContent).not.toContain('Your GM');
    expect(host.querySelector('.as-player')?.textContent).toContain('Your GM deleted this campaign.');
  });
});

describe('the builder: Cancel after a campaign Leave or Join', () => {
  it('Leave on the Setup card, then Cancel: no "Discard changes?" (the leave is already saved)', async () => {
    const host = await openApp([saved('c1', 'TEST Leaver', [CAMP]), saved('c2', 'TEST Other', [OTHER])]);
    await openBuilderSetup(host);
    click(host.querySelector('button[aria-label="Leave “TEST The Salt Road”"]'), 'the card’s Leave');
    await wait(50);
    click(document.querySelector('.confirm-modal .btn-danger'), 'the question’s Leave campaign');
    await wait(800);
    expect(storedIds('c1'), 'fixture: App saved the leave').toEqual([[], []]);
    // MUTATION: drop `buildChanged.leftCampaign(cid);` from Builder.tsx and Cancel asks "Discard changes?".
    click(host.querySelector('button.b-cancel'), 'the builder’s Cancel');
    await wait(300);
    expect(document.querySelector('.confirm-modal'), 'Cancel asked nothing').toBeNull();
    expect(host.querySelector('button[aria-label="Edit character"]'), 'and the builder closed').toBeTruthy();
    expect(storedIds('c1'), 'the leave stays').toEqual([[], []]);
  }, APP_TIMEOUT);

  it('Join on the Setup card, then Cancel: still asks (a join is only in the draft until Save)', async () => {
    const host = await openApp([saved('c1', 'TEST Joiner', []), saved('c2', 'TEST Other', [OTHER, CAMP])]);
    await openBuilderSetup(host);
    typeInto(host.querySelector('input[aria-label="Campaign code"]'), 'SALT23', 'the campaign code');
    click(buttonNamed('Join'), 'Join');
    await until(() => !!host.querySelector('.cmp-in-name'));
    expect(host.querySelector('.cmp-in-name')?.textContent, 'fixture: joined in the draft').toBe('TEST The Salt Road');
    click(host.querySelector('button.b-cancel'), 'the builder’s Cancel');
    await wait(300);
    expect(document.querySelector('.confirm-modal')?.textContent, 'Cancel asks').toContain('Discard changes?');
  }, APP_TIMEOUT);

  it('Join then Leave of the same campaign in one visit, then Cancel: nothing changed, nothing asked', async () => {
    const host = await openApp([saved('c1', 'TEST Joiner', []), saved('c2', 'TEST Other', [OTHER, CAMP])]);
    await openBuilderSetup(host);
    typeInto(host.querySelector('input[aria-label="Campaign code"]'), 'SALT23', 'the campaign code');
    click(buttonNamed('Join'), 'Join');
    await until(() => !!host.querySelector('.cmp-in-name'));
    click(host.querySelector('button[aria-label="Leave “TEST The Salt Road”"]'), 'the card’s Leave');
    await wait(50);
    click(document.querySelector('.confirm-modal .btn-danger'), 'the question’s Leave campaign');
    await wait(800);
    click(host.querySelector('button.b-cancel'), 'the builder’s Cancel');
    await wait(300);
    expect(document.querySelector('.confirm-modal'), 'Cancel asked nothing').toBeNull();
  }, APP_TIMEOUT);

  /** Leave "TEST The Salt Road" on the Setup card, through its question. */
  async function leaveOnCard(host: HTMLElement) {
    click(host.querySelector('button[aria-label="Leave “TEST The Salt Road”"]'), 'the card’s Leave');
    await wait(50);
    click(document.querySelector('.confirm-modal .btn-danger'), 'the question’s Leave campaign');
    await wait(800);
  }
  const rename = async (host: HTMLElement) => {
    typeInto(host.querySelector('input[aria-label="Character name"]'), 'TEST Renamed', 'the name');
    await wait(400);
  };

  it('a rename, THEN a Leave, then Cancel: still asks — the leave moves only its own campaign, never the rename', async () => {
    // MUTATION (run 2026-10-23): build leftCampaign's new start from the whole DRAFT less the campaign
    // (`{ ...latestRef.current, campaignIds: …filter… }`) and Cancel asks nothing — the rename would be thrown
    // away without a word. (Plain `startRef.current = latestRef.current` asks too OFTEN instead: the draft
    // still holds the campaign at that moment, and the Leave / Join+Leave legs above fail on it.)
    const host = await openApp([saved('c1', 'TEST Leaver', [CAMP]), saved('c2', 'TEST Other', [OTHER])]);
    await openBuilderSetup(host);
    await rename(host);
    await leaveOnCard(host);
    expect(storedIds('c1'), 'fixture: App saved the leave').toEqual([[], []]);
    click(host.querySelector('button.b-cancel'), 'the builder’s Cancel');
    await wait(300);
    expect(document.querySelector('.confirm-modal')?.textContent, 'Cancel asks about the rename').toContain('Discard changes?');
  }, APP_TIMEOUT);

  it('a Leave, THEN a rename, then Cancel: still asks', async () => {
    const host = await openApp([saved('c1', 'TEST Leaver', [CAMP]), saved('c2', 'TEST Other', [OTHER])]);
    await openBuilderSetup(host);
    await leaveOnCard(host);
    await rename(host);
    click(host.querySelector('button.b-cancel'), 'the builder’s Cancel');
    await wait(300);
    expect(document.querySelector('.confirm-modal')?.textContent, 'Cancel asks about the rename').toContain('Discard changes?');
  }, APP_TIMEOUT);
});
