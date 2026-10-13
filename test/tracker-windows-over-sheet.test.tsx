// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { computeSummary } from '../src/sheet/partySummary';
import type { SavedChar } from '../src/data/storage';
import type { CampaignMembership } from '../src/data/campaigns';
import type { PartyMember } from '../src/data/party';
import { useCombatStore } from '../tracker/src/store/combatStore';
import { usePartyStore } from '../tracker/src/store/partyStore';
import { useLayoutStore } from '../tracker/src/store/layoutStore';
import { useWindowStore, BASE_Z, RENORM_AT } from '../tracker/src/store/windowStore';
import { trackerUi } from '../src/integration/trackerUiStore';
import { rememberCampaign, setOnCampaignsPage } from '../src/integration/lastCampaignView';

/**
 * THE TRACKER'S WINDOWS OVER A PLAYER'S SHEET (item 7 of the owner's online list, 2026-10-01: Search
 * pages are tracker windows now — "the tracker's movable, windowed stat-block popup").
 *
 * A card opens the player's sheet as a layer over the whole tracker view (.ct-sheet-full, z 30). The
 * tracker's floating windows sit at 501 and up, so a window left open — a rules page, a creature — floats
 * over that sheet, and the GM can open more there (Ctrl+K). That is wanted: a rule beside the sheet being
 * edited. What was wrong (the item-7 refuter, 2026-10-11):
 *
 *  (a) ESCAPE IN THE ORDER ON SCREEN. The dismiss stack runs in push order: with a window open first, the
 *      sheet's handler went in above the windows' one, so Escape asked about the sheet (and could leave
 *      it) while a window still sat on top of it. The windows' handler is now a COVER and the sheet's is
 *      UNDER it (useEscapeClose DismissUnder): window, then sheet, then the campaign, whichever opened first.
 *  (b) THE SHEET'S CONFIRM ABOVE THE WINDOWS. GmEditSheet's "Update before leaving?" carries no style of
 *      the tracker's, so it drew at HH's own 80 — under the window. campaign-tracker.css lifts every such
 *      confirm while the campaign tracker is on screen above anything a window can reach.
 *  (c) WHAT THE SHEET OPENS UNDER A WINDOW. The GM keeps working in the sheet with a window open over it;
 *      a popup the sheet opens then (its Perception detail) is drawn inside the sheet's layer — under the
 *      window — but pushed after the windows' handler, so Escape closed that popup while the window sat on
 *      top of it (the item-7 refuter, round 2). Everything registered inside the sheet is under the
 *      windows now (the DismissUnder boundary round `.ct-sheet-full`): the window, then the popup, then
 *      the sheet.
 *
 * MUTATIONS (each applied, run, read off that run, then restored):
 *  - CampaignTracker: the sheet handler's `{ under: true }` dropped → (a) red at "the first Escape closed
 *    the window" (it closed the sheet).
 *  - useEscapeClose topHandler: `if (covered && stack[i].under) continue;` dropped → (a) and (c) red.
 *  - CampaignTracker: the `<DismissUnder.Provider value>` round GmEditSheet dropped → (c) red at "the
 *    first Escape closed the window on top" (the popup went).
 *  - useEscapeClose useEscapeClose: `under` dropped from its entry → (c) red, the same.
 *  - campaign-tracker.css: the `body:has(.campaign-tracker) .picker-overlay.confirm-overlay` rule dropped →
 *    (b) red (80, under the window at 501).
 *
 * Every character here is synthetic. Mounted the way the GM meets it: the campaigns page, a campaign
 * with one published player (the server mocked), the card that opens the sheet.
 */

const srv = vi.hoisted(() => ({
  party: [] as PartyMember[],
  sheets: new Map<string, unknown>(),
}));

vi.mock('../src/integration/enabled', () => ({
  TRACKER_IN_CAMPAIGN: true,
  TEST_CAMPAIGNS_WITHOUT_LOGIN: false,
}));
vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'gm@example.com' }),
  signOut: async () => undefined,
}));
vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  currentUserId: async () => 'gm-1',
  fetchParty: async () => srv.party,
  fetchMemberSheet: async (_campaignId: string, charId: string) => srv.sheets.get(charId) ?? null,
  fetchMemberRow: async (_campaignId: string, charId: string) => ({
    sheet: (srv.sheets.get(charId) as SavedChar | undefined) ?? null,
    summary: undefined,
    read: true,
  }),
  fetchPendingGmEdits: async () => [],
  subscribeMemberSheet: () => () => undefined,
  subscribeParty: () => () => undefined,
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
  fetchGmEdits: async () => [],
  deleteGmEdit: async () => 1,
  subscribeGmEdits: () => () => undefined,
  pushGmEdit: async () => ({ ok: true, value: null }),
}));
vi.mock('../src/data/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaigns')>()),
  fetchCampaignByCode: async () => ({
    ok: true,
    value: { id: 'camp-1', code: 'TESTCODE', ownerId: 'gm-1', name: 'The Salt Road', description: '', defaults: {} },
  }),
}));

const CAMPAIGN: CampaignMembership = { id: 'camp-1', code: 'TESTCODE', role: 'gm', name: 'The Salt Road' };

function saved(id: string, name: string, level: number): SavedChar {
  const db = content();
  const build: BuildState = {
    ...emptyBuild(),
    name,
    level,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    classId: 'fighter',
    keyAbility: 'str',
  };
  const character = buildCharacter(build, db);
  return { id, character, build, play: initialPlay(character, db) };
}
function publish(sc: SavedChar, ownerId: string): PartyMember {
  srv.sheets.set(sc.id, sc);
  return { ownerId, charId: sc.id, name: sc.character.name, summary: computeSummary(sc.character, content()) };
}

let live: Root | null = null;
let host: HTMLElement | null = null;

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
function render(el: ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() => live!.render(el));
  return host;
}
const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
async function escape(): Promise<void> {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  await flush(3);
}
const q = <T extends Element = HTMLElement>(sel: string) => host?.querySelector<T>(sel) ?? null;
const btn = (label: string): HTMLElement => {
  const all = [...(host?.querySelectorAll('button') ?? [])];
  const el = all.find((b) => (b.textContent ?? '').trim().includes(label) || b.title === label);
  if (!el) throw new Error(`no button labelled "${label}"`);
  return el;
};
const dialog = () => document.querySelector<HTMLElement>('.confirm-modal');

/** A rules window, opened the way a Search result or a link opens one. */
function openWindow(): void {
  act(() => useWindowStore.getState().open('condition', 'synthetic glare', 'Synthetic Glare'));
}
const windowsOpen = () => useWindowStore.getState().wins.length;

beforeEach(() => {
  localStorage.clear();
  srv.party = [];
  srv.sheets.clear();
  rememberCampaign(null);
  setOnCampaignsPage(false);
  trackerUi.reset();
  useCombatStore.setState({ combatants: [], round: 1, activeIndex: 0, selectedId: null, inCombat: false });
  usePartyStore.setState({ parties: [], activePartyId: null });
  useLayoutStore.setState({ root: null, hoveredCid: null });
  useWindowStore.setState({ wins: [], topZ: BASE_Z });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  window.matchMedia = ((qq: string) => ({
    matches: false, media: qq, onchange: null, addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  const files: Record<string, string> = {
    'core.json': 'public/core.json',
    'core-descriptions.json': 'public/core-descriptions.json',
  };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = files[String(url).split('/').pop() ?? ''];
    if (!path) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf8')) as unknown, text: async () => '' };
  });
});

afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
  for (const n of [...document.body.children]) n.remove();
  useWindowStore.setState({ wins: [], topZ: BASE_Z });
  vi.unstubAllGlobals();
});

/** The campaigns page with the campaign opened — the tracker in the body. */
async function openCampaign(): Promise<HTMLElement> {
  await import('../src/integration/CampaignTracker');
  await import('../src/integration/TrackerTools');
  const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
  localStorage.setItem('pf2e-codex.campaigns', JSON.stringify([CAMPAIGN]));
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
  click(el.querySelector('.cmp-card-btn')!);
  await flush(6);
  expect(el.querySelector('.campaign-tracker'), 'fixture: the campaign opened as the tracker').not.toBeNull();
  return el;
}
/** A dashboard card → the GM's sheet over the tracker. */
async function openSheet(): Promise<void> {
  click(q('.party-grid .party-card')!);
  await flush(4);
  expect(q('.ct-sheet-full .ws-app'), 'fixture: the card opened the GM sheet').not.toBeNull();
}

describe('the tracker\'s windows over a player\'s sheet', () => {
  it('(a) Escape peels a window over the sheet first, then the sheet, then the campaign', async () => {
    srv.party = [publish(saved('char-a', 'Ayla Brightwood', 5), 'owner-a')];
    await openCampaign();

    // A window open, THEN the sheet: the window floats over it.
    openWindow();
    await flush(1);
    await openSheet();
    expect(windowsOpen()).toBe(1);

    await escape();
    expect(windowsOpen(), 'the first Escape closed the window').toBe(0);
    expect(q('.ct-sheet-full .ws-app'), 'the sheet under it stayed').not.toBeNull();

    await escape();
    expect(q('.ct-sheet-full'), 'the second Escape closed the sheet').toBeNull();
    expect(q('.campaign-tracker'), '…and only the sheet').not.toBeNull();

    // The sheet first, THEN a window (Ctrl+K's Search over the sheet): the same order.
    await openSheet();
    openWindow();
    await flush(1);
    await escape();
    expect(windowsOpen(), 'the window opened over the sheet went first').toBe(0);
    expect(q('.ct-sheet-full .ws-app')).not.toBeNull();
    await escape();
    expect(q('.ct-sheet-full')).toBeNull();

    // Nothing left above the campaign: Escape leaves it, as always.
    await escape();
    expect(q('.campaign-tracker'), 'the last Escape left the campaign').toBeNull();
  }, 180_000);

  it('(c) a popup the sheet opens under a window: Escape takes the window, then the popup, then the sheet', async () => {
    srv.party = [publish(saved('char-a', 'Ayla Brightwood', 5), 'owner-a')];
    await openCampaign();
    openWindow();
    await flush(1);
    await openSheet();
    // The GM keeps working in the sheet: its Perception detail, opened AFTER the window, inside the sheet.
    click(q('.ct-sheet-full [title="Perception — how is this calculated?"]')!);
    await flush(2);
    const popup = () => q('.ct-sheet-full .stat-detail');
    expect(popup(), "fixture: the sheet's own popup").not.toBeNull();
    expect(windowsOpen(), 'fixture: the window still over the sheet').toBe(1);

    await escape();
    expect(windowsOpen(), 'the first Escape closed the window on top').toBe(0);
    expect(popup(), 'the popup under it stayed').not.toBeNull();
    await escape();
    expect(popup(), 'then the popup').toBeNull();
    expect(q('.ct-sheet-full .ws-app'), '…and only the popup').not.toBeNull();
    await escape();
    expect(q('.ct-sheet-full'), 'then the sheet').toBeNull();
    expect(q('.campaign-tracker'), 'and the campaign stays').not.toBeNull();
  }, 180_000);

  it("(b) the sheet's \"Update before leaving?\" draws above a window left open over it", async () => {
    // The two rules that decide it, as the app loads them (vitest applies no imported CSS).
    const sheetRule = /\.picker-overlay\.confirm-overlay\s*\{[^}]*\}/.exec(readFileSync('src/sheet.css', 'utf8'))?.[0];
    expect(sheetRule, "HH's own confirm rule").toMatch(/z-index:\s*80/);
    const lift = /body:has\(\.campaign-tracker\)[^{}]*\.confirm-overlay[^{}]*\{[^}]*\}/.exec(readFileSync('src/integration/campaign-tracker.css', 'utf8'))?.[0];
    expect(lift, "the seam's lift").toBeTruthy();
    const style = document.createElement('style');
    style.textContent = `${sheetRule}\n${lift}`;
    document.head.appendChild(style);
    try {
      srv.party = [publish(saved('char-a', 'Ayla Brightwood', 5), 'owner-a')];
      await openCampaign();
      openWindow();
      await flush(1);
      await openSheet();

      // An unsent edit, then the sheet's own way back: it asks.
      const pip = q<HTMLButtonElement>('.ct-sheet-full button[aria-label^="Set hero points to"]');
      expect(pip, 'fixture: the GM sheet can be edited').not.toBeNull();
      click(pip!);
      await flush(2);
      click(btn('Back to tracker'));
      await flush(2);
      expect(dialog()?.querySelector('.info-title')?.textContent).toBe('Update before leaving?');
      const overlay = dialog()!.closest<HTMLElement>('.confirm-overlay')!;
      expect(overlay.style.zIndex, 'raised without the tracker\'s dialogStyle').toBe('');
      const z = Number(getComputedStyle(overlay).zIndex);
      const win = useWindowStore.getState().wins[0];
      expect(z, 'above the window still open over the sheet').toBeGreaterThan(win.z);
      // …and above anything a window, or a confirm styled to ride over them, can ever reach.
      expect(z).toBeGreaterThan(RENORM_AT + 20);

      // Not vacuous: without the lift it is HH's own 80, under the window.
      style.textContent = sheetRule!;
      expect(Number(getComputedStyle(overlay).zIndex)).toBe(80);
      expect(80).toBeLessThan(win.z);

      const cancel = [...dialog()!.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Cancel')!;
      click(cancel);
      await flush(3);
      expect(q('.ct-sheet-full .ws-app'), 'Cancel kept the sheet').not.toBeNull();
      expect(windowsOpen(), 'and the window').toBe(1);
    } finally {
      style.remove();
    }
  }, 180_000);
});
