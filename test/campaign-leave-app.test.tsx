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
import { exportNative } from '../src/data/transfer';
import { setPref } from '../src/data/prefs';
import { setOnPersisted } from '../src/data/persist';
import { noteRosterChange } from '../src/data/cloudSync';

/**
 * ONE CHARACTER LEAVES A CAMPAIGN — against the real <App/>, the party layer mocked (the harness of
 * test/carried-app.test.tsx). Owner, 2026-10-21: campaigns are per character, and Leave "removes the
 * campign" from that character after a question (test/campaign-per-character.test.tsx pins the card).
 * What only the whole app can show (checker findings on the change, 2026-10-21):
 *  - the party row is deleted even when the first delete FAILS (offline, a server blip): the failed key
 *    stays known and the online / focus retry sends the delete again. It used to be forgotten, and the
 *    character that left stayed in the GM's party for good;
 *  - Ctrl+Z does not bring the campaign back (coming back is joining again with the code — an undo
 *    restored the link without the membership the leave may have dropped);
 *  - the membership goes with the last character only once this device has pulled the cloud: before
 *    that, a character on another device still in the campaign is unknown, not absent.
 *
 * Synthetic characters only.
 */
const net = vi.hoisted(() => ({
  synced: true,
  publishes: [] as { campaignId: string; charId: string }[],
  unpublishes: [] as { campaignId: string; charId: string }[],
  /** What each unpublish answers, in order; then 'ok'. */
  unpublishAnswers: [] as ('ok' | 'failed')[],
  /** What the server answers for "which campaigns does this account own". */
  owned: { ok: true, value: [] } as { ok: true; value: string[] } | { ok: false; error: string },
  homebrewRefreshes: 0,
  /** The props App gave the (stubbed) Campaigns page, once it is on screen. */
  campaignsPage: null as null | { onCampaignDeleted?: (id: string) => void },
}));

vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'player@example.com' }),
}));
vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  fetchGmEdits: async () => [],
  fetchPublishedSheet: async () => ({ sheet: null, updatedAt: undefined, ownerId: undefined }),
  publishCharacter: async (campaignId: string, charId: string) => {
    net.publishes.push({ campaignId, charId });
    return 'ok';
  },
  unpublishCharacter: async (campaignId: string, charId: string) => {
    net.unpublishes.push({ campaignId, charId });
    return net.unpublishAnswers.shift() ?? 'ok';
  },
  deleteGmEdit: async () => 1,
  markGmEditRefused: async () => true,
  currentUserId: async () => null, // no Realtime subscription in the test
}));
vi.mock('../src/data/cloudSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloudSync')>()),
  startCloudSync: async () => () => undefined,
  pullForGmApply: () => null,
  hasSyncedOnce: () => net.synced,
}));
vi.mock('../src/data/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaigns')>()),
  fetchOwnedCampaignIds: async () => net.owned,
}));
vi.mock('../src/data/campaignHomebrew', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaignHomebrew')>()),
  startCampaignHomebrew: () => () => undefined,
  refreshCampaignHomebrew: async () => {
    net.homebrewRefreshes++;
  },
}));
// Only what App does after a delete is used from the Campaigns page (test/campaigns-page-stored-list.test.tsx
// runs the page itself); the stub hands its props over.
vi.mock('../src/sheet/CampaignsPage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/sheet/CampaignsPage')>()),
  CampaignsPage: (props: { onCampaignDeleted?: (id: string) => void }) => {
    net.campaignsPage = props;
    return <div className="test-campaigns-page">TEST campaigns page</div>;
  },
}));
// The Party page's member list talks to the server; only its Leave row is used here.
vi.mock('../src/sheet/PartyMembers', () => ({
  PartyMembers: () => null,
  useMemberViewer: () => ({ sheetEl: null, open: () => undefined }),
}));

// Production update priorities (see test/bug-gm-edit-race.test.tsx): `window.event` is jsdom's real one.
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
afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  for (const n of [...document.body.children]) n.remove();
  localStorage.clear();
  net.synced = true;
  net.publishes = [];
  net.unpublishes = [];
  net.unpublishAnswers = [];
  net.owned = { ok: true, value: [] };
  net.homebrewRefreshes = 0;
  net.campaignsPage = null;
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
/** Wait until `cond` holds (the publish run is debounced, and other roster writes after a leave push it
 *  back), at most `ms`. The assertion that follows says what was expected. */
async function until(cond: () => boolean, ms = 4000) {
  for (let t = 0; t < ms && !cond(); t += 50) await wait(50);
}
const storedRoster = () => JSON.parse(localStorage.getItem(ROSTER_KEY) ?? '[]') as SavedChar[];
const storedIds = (id: string) => {
  const sc = storedRoster().find((c) => c.id === id);
  return [sc?.character.campaignIds ?? [], sc?.build?.campaignIds ?? []];
};
const storedMemberships = () => (JSON.parse(localStorage.getItem(CAMPAIGNS_KEY) ?? '[]') as CampaignMembership[]).map((m) => m.id);

/** `onRoster`: the app opens on Characters (Settings → "Opens on"), where the Import button is;
 *  'campaigns': it reopens on the Campaigns page, as when it was closed there. */
async function openApp(roster: SavedChar[], memberships: CampaignMembership[] = MEMBERSHIPS, onRoster: boolean | 'campaigns' = false) {
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).split('/').pop() ?? '';
    if (name !== 'core.json' && name !== 'core-descriptions.json') return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`public/${name}`, 'utf8')) as unknown };
  });
  localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  if (roster[0]) localStorage.setItem(ACTIVE_KEY, roster[0].id);
  setPref('startupScreen', onRoster === true ? 'characters' : 'last');
  if (onRoster === 'campaigns') localStorage.setItem('pf2e-codex.on-campaigns-page', '1');
  localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(memberships));
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
  const ready =
    onRoster === 'campaigns'
      ? () => !!net.campaignsPage
      : onRoster
        ? () => !!host.querySelector('.roster-hero-actions .add-item-btn.ghost:not([disabled])')
        : () => !!host.querySelector('.party-tab');
  for (let i = 0; i < 200 && !ready(); i++) await wait(50);
  await wait(600); // the launch publish (PUBLISH_DEBOUNCE_MS = 400)
  return host;
}

/** From the sheet: Party → Leave campaign → the question's red button. */
async function leaveFromParty(host: HTMLElement, who = 'TEST Leaver') {
  click(host.querySelector('.party-tab'), 'the Party tab');
  await wait(50);
  click([...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Leave campaign')), 'Leave campaign');
  await wait(50);
  expect(document.querySelector('.confirm-modal')?.textContent, 'Leave asks first, naming the character').toContain(`${who} leaves this campaign`);
  click(document.querySelector('.confirm-modal .btn-danger'), 'the question’s Leave campaign');
  await wait(600); // the persist and the publish run
}

const buttonNamed = (text: string) => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === text);
/** Type into an input as React sees it. */
function typeInto(el: Element | null, value: string, what: string) {
  if (!(el instanceof HTMLInputElement)) throw new Error(`fixture: no input (${what})`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  act(() => void el.dispatchEvent(new Event('input', { bubbles: true })));
}
/** The sheet's Edit character → the builder's Setup page. */
async function openBuilderSetup(host: HTMLElement) {
  click(host.querySelector('button[aria-label="Edit character"]'), 'Edit character');
  await wait(300);
  click(buttonNamed('Setup'), 'the builder’s Setup tab');
  await wait(100);
}
/** The builder's Save changes — through "Save with choices left?" (these test characters are half-built) —
 *  and proof it saved: the builder closed. */
async function saveBuilder(host: HTMLElement) {
  click(buttonNamed('Save changes'), 'Save changes');
  await wait(100);
  if (document.querySelector('.confirm-modal')) click(buttonNamed('Save anyway'), 'the question’s Save anyway');
  await wait(800); // the persist
  expect(host.querySelector('input[aria-label="Character name"]'), 'fixture: Save closed the builder').toBeNull();
}
/** Ctrl+Z (or Ctrl+Shift+Z), then long enough for the 400 ms persist. */
const ctrlZ = (shift = false) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: shift, bubbles: true }));
    await new Promise((r) => setTimeout(r, 1500));
  });

describe('one character leaves a campaign, in the real app', () => {
  it('takes out only that character; a failed party delete is sent again; Ctrl+Z does not bring it back', async () => {
    const host = await openApp([saved('c1', 'TEST Leaver', [CAMP]), saved('c2', 'TEST Other', [OTHER])]);
    expect(net.publishes, 'fixture: the launch published the character into its campaign').toContainEqual({ campaignId: CAMP, charId: 'c1' });

    net.unpublishAnswers = ['failed'];
    await leaveFromParty(host);
    expect(storedIds('c1'), 'the character is out of the campaign — character and build').toEqual([[], []]);
    expect(storedIds('c2'), 'another character is untouched').toEqual([[OTHER], [OTHER]]);
    expect(storedMemberships(), 'its last character left, this device has synced: the membership goes').toEqual([OTHER]);
    await until(() => net.unpublishes.length > 0);
    expect(net.unpublishes, 'the party row delete was sent (and failed)').toEqual([{ campaignId: CAMP, charId: 'c1' }]);
    await wait(100); // the failed answer is handled

    // MUTATION: drop `publishedRef.current.add(key); publishFailedRef.current = true;` from the unpublish
    // failure branch in App.tsx and this fails with one delete only — the character stays in the party.
    act(() => void window.dispatchEvent(new Event('focus')));
    await until(() => net.unpublishes.length > 1);
    expect(net.unpublishes, 'the retry sends the delete again').toEqual([
      { campaignId: CAMP, charId: 'c1' },
      { campaignId: CAMP, charId: 'c1' },
    ]);
    act(() => void window.dispatchEvent(new Event('focus')));
    await wait(1500);
    expect(net.unpublishes.length, 'once it landed, nothing more is sent').toBe(2);

    // MUTATION: drop `{ record: false }` from App.leaveCampaign's setRoster and this fails — the first undo
    // puts the campaign back on the character (run 2026-10-21). Ctrl+Z until nothing is left to undo, and
    // long enough after each for the 400 ms persist (600 ms once read a restored link as still gone).
    const undoLeft = () => !(host.querySelector('button[aria-label="Undo"]') as HTMLButtonElement | null)?.disabled;
    for (let i = 0; i === 0 || (i < 6 && undoLeft()); i++) {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
        await new Promise((r) => setTimeout(r, 1500));
      });
      expect(storedIds('c1'), `Ctrl+Z #${i + 1} does not bring the campaign back`).toEqual([[], []]);
      expect(host.querySelector('.party-tab'), 'and the sheet has no Party tab again').toBeNull();
    }
  }, APP_TIMEOUT);

  it('in the builder: Leave, then Ctrl+Z, then Save — the campaign does not come back', async () => {
    // The owner's "yes", 2026-10-21: the builder's undo restored a snapshot from before the leave, campaign
    // included, and Save put the character back — under "Campaign", its membership already gone.
    const host = await openApp([saved('c1', 'TEST Leaver', [CAMP]), saved('c2', 'TEST Other', [OTHER])]);
    await openBuilderSetup(host);
    typeInto(host.querySelector('input[aria-label="Character name"]'), 'TEST Renamed', 'the name'); // a step from before the leave
    await wait(400);
    click(host.querySelector('button[aria-label="Leave “TEST The Salt Road”"]'), 'the card’s Leave');
    await wait(50);
    click(document.querySelector('.confirm-modal .btn-danger'), 'the question’s Leave campaign');
    await wait(600);
    expect(storedIds('c1'), 'App applied the leave at once').toEqual([[], []]);
    expect(storedMemberships()).toEqual([OTHER]);

    // MUTATION: drop `keep: keepBuildCampaigns` in Builder.tsx and this fails — the undo of the rename
    // brings the campaign back to the card, and Save back to the character.
    await ctrlZ();
    expect((host.querySelector('input[aria-label="Character name"]') as HTMLInputElement).value, 'the undo undid the rename').toBe('TEST Leaver');
    expect(host.querySelector('.cmp-in-name'), 'and the campaign stays off the card').toBeNull();
    await saveBuilder(host);
    expect(storedIds('c1'), 'saved without the campaign').toEqual([[], []]);
    expect(storedRoster().find((c) => c.id === 'c1')?.character.name, 'fixture: the Save landed (the undone rename)').toBe('TEST Leaver');
  }, APP_TIMEOUT);

  it('on the sheet: Ctrl+Z of a Save that joined keeps the character in; after a leave, Ctrl+Z and Ctrl+Shift+Z keep it out', async () => {
    // c2 in both campaigns: the account stays in them through c1's leave, so c1's joins here need no server.
    const host = await openApp([saved('c1', 'TEST Joiner', []), saved('c2', 'TEST Other', [OTHER, CAMP])]);
    await openBuilderSetup(host);
    // The account is already in the campaign, so it joins without the server (the server is not reachable here).
    typeInto(host.querySelector('input[aria-label="Campaign code"]'), 'SALT23', 'the campaign code');
    click(buttonNamed('Join'), 'Join');
    await until(() => !!host.querySelector('.cmp-in-name'));
    expect(host.querySelector('.cmp-in-name')?.textContent).toBe('TEST The Salt Road');
    // A rename in the same Save, so the undo below provably reaches the Save (the name goes back).
    typeInto(host.querySelector('input[aria-label="Character name"]'), 'TEST Joiner Renamed', 'the name');
    await wait(400);
    await saveBuilder(host);
    expect(storedIds('c1'), 'fixture: the Save joined').toEqual([[CAMP], [CAMP]]);
    const storedName = () => storedRoster().find((c) => c.id === 'c1')?.character.name;
    expect(storedName(), 'fixture: and renamed').toBe('TEST Joiner Renamed');

    // MUTATION: drop the `keep:` line from App.tsx's roster useUndoableState and this fails — undoing the
    // Save that joined took the character out of the party without a word, and so did the redo after the
    // leave below. Ctrl+Z until the Save itself is undone (the app may have a step of its own after it),
    // checking the campaign at every press; then Ctrl+Shift+Z until it is back.
    for (let i = 0; i < 3 && storedName() !== 'TEST Joiner'; i++) {
      await ctrlZ();
      expect(storedIds('c1'), `Ctrl+Z #${i + 1}: still in`).toEqual([[CAMP], [CAMP]]);
    }
    expect(storedName(), 'fixture: the Save that joined was undone').toBe('TEST Joiner');
    for (let i = 0; i < 3 && storedName() !== 'TEST Joiner Renamed'; i++) {
      await ctrlZ(true);
      expect(storedIds('c1'), `Ctrl+Shift+Z #${i + 1}: still in`).toEqual([[CAMP], [CAMP]]);
    }
    expect(storedName(), 'fixture: and redone').toBe('TEST Joiner Renamed');

    await leaveFromParty(host, 'TEST Joiner Renamed');
    expect(storedIds('c1')).toEqual([[], []]);
    // The same walk after the leave: back past the Save that joined, then the redo of it.
    for (let i = 0; i < 3 && storedName() !== 'TEST Joiner'; i++) {
      await ctrlZ();
      expect(storedIds('c1'), `after the leave, Ctrl+Z #${i + 1}: still out`).toEqual([[], []]);
    }
    expect(storedName(), 'fixture: back past the Save that joined').toBe('TEST Joiner');
    for (let i = 0; i < 3 && storedName() !== 'TEST Joiner Renamed'; i++) {
      await ctrlZ(true);
      expect(storedIds('c1'), `after the leave, Ctrl+Shift+Z #${i + 1} (the redo of the Save that joined): still out`).toEqual([[], []]);
    }
    expect(storedName(), 'fixture: and the Save redone').toBe('TEST Joiner Renamed');
    expect(host.querySelector('.party-tab')).toBeNull();
  }, APP_TIMEOUT);

  const DAY = 24 * 60 * 60 * 1000;
  const UNHELD_KEY = 'pf2e-codex.unheldCampaigns';
  const storedUnheld = () => JSON.parse(localStorage.getItem(UNHELD_KEY) ?? '{}') as Record<string, number>;

  it('at launch, a player campaign none of the characters is in is removed a day after it was first seen — a GM one never', async () => {
    // Owner, 2026-10-21 ("yes, remove them"): the phone's old Join row joined the account with no character.
    // MUTATION: drop the cleanup effect's `saveCampaigns(r.memberships)` in App.tsx and this fails — the
    // hidden membership stays, with no Leave to reach it.
    const GM: CampaignMembership = { id: 'camp-mine', code: 'MINE23', role: 'gm', name: 'TEST My Table' };
    localStorage.setItem(UNHELD_KEY, JSON.stringify({ [OTHER]: Date.now() - DAY - 60_000 }));
    await openApp([saved('c1', 'TEST Keeper', [CAMP])], [...MEMBERSHIPS, GM]);
    await until(() => storedMemberships().length < 3);
    expect(storedMemberships(), 'OTHER had no character for a day; the GM campaign stays').toEqual([CAMP, 'camp-mine']);
    expect(storedUnheld(), 'nothing left waiting').toEqual({});
  }, APP_TIMEOUT);

  it('the first launch that sees one held by no character only notes the time (a join in the Builder is held only by its draft)', async () => {
    // A checker's finding, 2026-10-21: the Builder's join saves the membership at once but the character
    // only on Save, so another device launching meanwhile removed it — and the join with it, everywhere.
    // MUTATION: make UNHELD_GRACE_MS 0 in data/campaignLeave.ts and this fails.
    const before = Date.now();
    await openApp([saved('c1', 'TEST Keeper', [CAMP])]);
    await until(() => OTHER in storedUnheld());
    expect(storedMemberships()).toEqual([CAMP, OTHER]);
    expect(storedUnheld()[OTHER], 'stamped now').toBeGreaterThanOrEqual(before);
  }, APP_TIMEOUT);

  it('a join on any device in the last day keeps it, however old this device’s own note is', async () => {
    // A checker's finding, 2026-10-21: a rejoin by code of an old hidden campaign is held only by the
    // Builder's draft until Save, while this device noted it days before. MUTATION: pass `{}` for
    // loadRevived() in App.tsx's cleanup and this fails — the rejoin was removed on every device.
    const noted = Date.now() - 5 * DAY;
    const joined = Date.now() - 60_000;
    localStorage.setItem(UNHELD_KEY, JSON.stringify({ [OTHER]: noted }));
    localStorage.setItem('pf2e-codex.revived', JSON.stringify({ [`camp:${OTHER}`]: joined }));
    await openApp([saved('c1', 'TEST Keeper', [CAMP])]);
    await until(() => storedUnheld()[OTHER] !== noted);
    expect(storedMemberships()).toEqual([CAMP, OTHER]);
    expect(storedUnheld()[OTHER], 'it now waits a day from the join').toBe(joined);
  }, APP_TIMEOUT);

  it('an import with "Update existing" keeps the campaigns the character is in now', async () => {
    // Owner, 2026-10-21 ("Keep current campaigns"): the file never takes a character out of its party or
    // puts it in another. MUTATION: drop withCampaignsOf(...) around the Update entry in App.tsx and this
    // fails — the character's campaigns became the file's.
    const host = await openApp([saved('c1', 'TEST Importee', [CAMP])], MEMBERSHIPS, true);
    // The file's copy is a level higher (so the update is visible), in the other campaign, and in one this
    // account is not in at all.
    const FOREIGN = 'camp-foreign';
    const base = saved('file-1', 'TEST Importee', [OTHER, FOREIGN]);
    const build = { ...base.build!, level: 2 } as BuildState;
    const character = buildCharacter(build, db);
    const fromFile = { ...base, build, character, play: initialPlay(character, db) } as SavedChar;
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error(`fixture: no file input on Characters — on screen: ${(host.textContent ?? '').slice(0, 300)}`);
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([exportNative(fromFile)], 'importee.json', { type: 'application/json' })] });
    act(() => void input.dispatchEvent(new Event('change', { bubbles: true })));
    await until(() => !!buttonNamed('Update existing'));
    click(buttonNamed('Update existing'), 'the question’s Update existing');
    const levelOf = () => storedRoster().find((c) => c.id === 'c1')?.build?.level;
    await until(() => levelOf() === 2);
    await wait(800); // the persist
    expect(storedRoster().map((c) => c.id), 'fixture: updated in place, not added').toEqual(['c1']);
    expect(levelOf(), 'fixture: the file’s character replaced it').toBe(2);
    expect(storedIds('c1'), 'still in the campaign it was in — not in the file’s').toEqual([[CAMP], [CAMP]]);

    // The same file again with "Keep both": a NEW character keeps the file's campaigns, as a copy does (owner,
    // 2026-10-21: "NO" to copies and imports starting in no campaign). MUTATION: empty campaignIds on the
    // Keep both entry in App.tsx's import and this fails.
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([exportNative(fromFile)], 'importee.json', { type: 'application/json' })] });
    act(() => void input.dispatchEvent(new Event('change', { bubbles: true })));
    await until(() => !!buttonNamed('Keep both'));
    click(buttonNamed('Keep both'), 'the question’s Keep both');
    await until(() => storedRoster().length === 2);
    await wait(800); // the persist
    const copy = storedRoster().find((c) => c.id !== 'c1');
    expect([copy?.character.campaignIds, copy?.build?.campaignIds], 'the new character: the file’s campaigns').toEqual([
      [OTHER, FOREIGN],
      [OTHER, FOREIGN],
    ]);
    expect(storedIds('c1'), 'the first one untouched').toEqual([[CAMP], [CAMP]]);
  }, APP_TIMEOUT);

  it('a campaign the server says this account owns stays and is a GM’s again, though stored as a player’s', async () => {
    // A checker's finding, 2026-10-21: the old join stored a GM's own campaign as 'player' when he typed his
    // own code (most likely on the phone's old Join row) — the very rows this removes.
    // MUTATION: pass an empty set for `owned` in App.tsx's cleanup and this fails.
    net.owned = { ok: true, value: [OTHER] };
    localStorage.setItem(UNHELD_KEY, JSON.stringify({ [OTHER]: Date.now() - 2 * DAY }));
    await openApp([saved('c1', 'TEST Keeper', [CAMP])]);
    const roleOf = (id: string) => (JSON.parse(localStorage.getItem(CAMPAIGNS_KEY) ?? '[]') as CampaignMembership[]).find((m) => m.id === id)?.role;
    await until(() => roleOf(OTHER) !== 'player');
    expect(storedMemberships()).toEqual([CAMP, OTHER]);
    expect(roleOf(OTHER)).toBe('gm');
  }, APP_TIMEOUT);

  it('while the server can’t say which campaigns this account owns, nothing is removed', async () => {
    // MUTATION: drop `!owned.ok ||` in App.tsx's cleanup and this fails.
    net.owned = { ok: false, error: 'offline' };
    localStorage.setItem(UNHELD_KEY, JSON.stringify({ [OTHER]: Date.now() - 2 * DAY }));
    await openApp([saved('c1', 'TEST Keeper', [CAMP])]);
    await wait(2000);
    expect(storedMemberships()).toEqual([CAMP, OTHER]);
  }, APP_TIMEOUT);

  it('before the first cloud pull, nothing is removed at launch (a character elsewhere may be in it) — once it lands, it is', async () => {
    net.synced = false;
    localStorage.setItem(UNHELD_KEY, JSON.stringify({ [OTHER]: Date.now() - 2 * DAY }));
    await openApp([saved('c1', 'TEST Keeper', [CAMP])]);
    await wait(2000);
    expect(storedMemberships()).toEqual([CAMP, OTHER]);
    // On a real launch the first pull always lands after the app opened. MUTATION: give up at once instead
    // of trying again (`if (!ready()) return;` before the retry in App.tsx's cleanup) and this fails.
    const refreshes = net.homebrewRefreshes;
    net.synced = true;
    await until(() => !storedMemberships().includes(OTHER));
    expect(storedMemberships(), 'the pull landed: it goes').toEqual([CAMP]);
    expect(net.homebrewRefreshes, 'and its shared homebrew is settled at once (kept as the player’s own)').toBeGreaterThan(refreshes);
  }, APP_TIMEOUT);

  it('a character the cloud pull wrote to disk, not yet in the app’s memory, still holds its campaign', async () => {
    // The pull writes the merged roster to disk and only then says it has synced; React takes the new
    // roster a moment later. A checker's finding, 2026-10-21: no test told the two copies apart.
    // MUTATION: drop `loadRoster()` from the cleanup's rosters in App.tsx and this fails — OTHER is removed
    // under a character that had just arrived.
    net.synced = false;
    localStorage.setItem(UNHELD_KEY, JSON.stringify({ [OTHER]: Date.now() - 2 * DAY }));
    const keeper = saved('c1', 'TEST Keeper', [CAMP]);
    await openApp([keeper]);
    // Same tab: no storage event, so the app's memory keeps only TEST Keeper.
    localStorage.setItem(ROSTER_KEY, JSON.stringify([keeper, saved('c2', 'TEST Arrived', [OTHER])]));
    const refreshes = net.homebrewRefreshes;
    net.synced = true;
    await until(() => !(OTHER in storedUnheld()), 4000);
    expect(storedUnheld(), 'fixture: the cleanup ran, and found OTHER held').toEqual({});
    expect(storedMemberships()).toEqual([CAMP, OTHER]);
    expect(net.homebrewRefreshes, 'nothing removed, nothing to settle').toBe(refreshes);
  }, APP_TIMEOUT);

  it('with no character on this device at all, nothing is removed (an empty list is not "in nothing")', async () => {
    // rosterTabs: another tab's account switch or a crash recovery can empty the roster key for a moment.
    // MUTATION: drop `rosterRef.current.length > 0` from the cleanup's ready() in App.tsx and this fails.
    localStorage.setItem(UNHELD_KEY, JSON.stringify({ [CAMP]: Date.now() - 2 * DAY, [OTHER]: Date.now() - 2 * DAY }));
    await openApp([], MEMBERSHIPS, true); // an empty roster has no sheet to wait for
    await wait(2000);
    expect(storedMemberships()).toEqual([CAMP, OTHER]);
  }, APP_TIMEOUT);

  it('before this device has pulled the cloud, the membership stays (a character elsewhere may still be in it)', async () => {
    net.synced = false;
    const host = await openApp([saved('c1', 'TEST Leaver', [CAMP])]);
    await leaveFromParty(host);
    expect(storedIds('c1')).toEqual([[], []]);
    expect(storedMemberships()).toEqual([CAMP, OTHER]);
  }, APP_TIMEOUT);

  it('a campaign its GM deleted leaves every character in it — as no edit — and Ctrl+Z does not bring it back', async () => {
    // A checker's finding, 2026-10-21: his characters kept a nameless "Campaign" with a Leave button and
    // kept publishing to it. And a second one: stamped "updated now", the strip made this device's older
    // copy beat an edit his other device made offline. MUTATION: drop noteDerivedRefresh(next, r) from
    // App.tsx's campaignDeleted and the time check fails; drop the strip and the campaign check fails.
    const MINE: CampaignMembership = { id: 'camp-mine', code: 'MINE23', role: 'gm', name: 'TEST My Table' };
    await openApp([saved('c1', 'TEST Gm Char', [MINE.id, CAMP]), saved('c2', 'TEST Other', [CAMP])], [...MEMBERSHIPS, MINE], 'campaigns');
    if (!net.campaignsPage?.onCampaignDeleted) throw new Error('fixture: App gave the Campaigns page no onCampaignDeleted');
    await wait(1000); // the launch settles: rebuild, publish, cleanup
    // Cloud sync's edit stamper, as a signed-in session attaches it after its first pull (the sync itself is
    // stubbed here). Each persisted change it sees as an edit gets the time "now".
    const TIMES_KEY = 'wanderers-codex:char-updated:v1';
    const OLD = Date.now() - DAY;
    localStorage.setItem(TIMES_KEY, JSON.stringify({ c1: OLD, c2: OLD }));
    setOnPersisted(noteRosterChange);
    try {
      const deleted = net.campaignsPage.onCampaignDeleted;
      act(() => deleted(MINE.id));
      await until(() => !storedIds('c1')[0].includes(MINE.id));
      await wait(800); // the persist
      expect(storedIds('c1'), 'out of the deleted campaign, still in the other').toEqual([[CAMP], [CAMP]]);
      expect(storedIds('c2')).toEqual([[CAMP], [CAMP]]);
      const times = JSON.parse(localStorage.getItem(TIMES_KEY) ?? '{}') as Record<string, number>;
      expect(times.c1, 'no edit stamp: a newer edit on another device still wins').toBe(OLD);
      // What keeps it out is the undo's keepRosterCampaigns. The strip's `{ record: false }` (no undo step of
      // its own) is not observable here: without it one Ctrl+Z press would do nothing — no data at stake.
      await ctrlZ();
      expect(storedIds('c1'), 'Ctrl+Z does not bring it back (the undo keeps the campaigns of now)').toEqual([[CAMP], [CAMP]]);
    } finally {
      setOnPersisted(() => undefined);
    }
  }, APP_TIMEOUT);
});
