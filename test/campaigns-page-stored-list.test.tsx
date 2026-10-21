// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import type { CampaignMembership } from '../src/data/campaigns';

/**
 * THE CAMPAIGNS PAGE CHANGES THE LIST AS STORED, never its own copy from when it opened (a checker's
 * finding, 2026-10-21, on removing player campaigns no character is in). The page read the membership list
 * once; a cloud pull or App's launch cleanup that changed it meanwhile was undone by the page's next save —
 * a membership that had arrived was dropped AND tombstoned on every device, and one removed came back.
 * Synthetic campaigns only.
 */

const srv = vi.hoisted(() => ({
  deleted: [] as string[],
  answer: { ok: true, value: null } as { ok: true; value: null } | { ok: false; error: string },
}));

// The original detail panel (not the tracker), which carries the GM's Delete.
vi.mock('../src/integration/enabled', () => ({
  TRACKER_IN_CAMPAIGN: false,
  TEST_CAMPAIGNS_WITHOUT_LOGIN: false,
}));
vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'gm@example.com' }),
  signOut: async () => undefined,
}));
vi.mock('../src/data/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaigns')>()),
  deleteCampaign: async (id: string) => {
    srv.deleted.push(id);
    return srv.answer;
  },
}));
vi.mock('../src/sheet/PartyMembers', () => ({
  PartyMembers: () => null,
  useMemberViewer: () => ({ sheetEl: null, open: () => undefined }),
}));

const CAMPAIGNS_KEY = 'pf2e-codex.campaigns';
/** The page's first render takes ~2 s; under a busy machine it passed the 5 s default once. */
const PAGE_TIMEOUT = 30_000;
const MINE: CampaignMembership = { id: 'camp-mine', code: 'MINE23', role: 'gm', name: 'TEST My Table' };
const KEEP: CampaignMembership = { id: 'camp-keep', code: 'KEEP23', role: 'gm', name: 'TEST Second Table' };
const ARRIVED: CampaignMembership = { id: 'camp-arrived', code: 'ARRV23', role: 'player', name: 'TEST Joined Elsewhere' };
const stored = () => (JSON.parse(localStorage.getItem(CAMPAIGNS_KEY) ?? '[]') as CampaignMembership[]).map((m) => m.id);
const tombstones = () => JSON.parse(localStorage.getItem('pf2e-codex.deleted') ?? '{}') as Record<string, number>;

let live: Root | null = null;
let host: HTMLElement | null = null;
const flush = async (times = 4) => {
  for (let i = 0; i < times; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
};
const click = (el: Element | null | undefined, what: string) => {
  if (!el) throw new Error(`fixture: nothing to click (${what}) — on screen: ${(document.body.textContent ?? '').slice(0, 300)}`);
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

/** Opens the page on [MINE, KEEP]; returns the ids App was told were deleted. */
const openPage = async () => {
  localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify([MINE, KEEP]));
  const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
  const told: string[] = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() =>
    live!.render(
      <CampaignsPage
        content={content()}
        onClose={() => undefined}
        onOpenRoster={() => undefined}
        onOpenHomebrew={() => undefined}
        characters={[]}
        modes={{}}
        onSaveMode={() => undefined}
        onDeleteMode={() => undefined}
        onCampaignDeleted={(id) => told.push(id)}
      />,
    ),
  );
  await flush();
  return told;
};
const deleteMine = async () => {
  click([...host!.querySelectorAll('.cmp-card-btn')].find((b) => (b.textContent ?? '').includes(MINE.name)), 'the campaign card');
  await flush();
  click([...host!.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Delete campaign')), 'Delete campaign');
  await flush();
  click(document.querySelector('.confirm-modal .btn-danger'), 'the dialog’s Delete');
  await flush(8);
};

beforeEach(() => {
  localStorage.clear();
  srv.deleted = [];
  srv.answer = { ok: true, value: null };
  window.matchMedia = ((q: string) => ({
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
});

describe('the Campaigns page saves the list as stored', () => {
  it('deleting a campaign keeps a membership that arrived while the page was open, and tombstones only the deleted one', async () => {
    // MUTATION: make persist() apply its change to the page's `memberships` state instead of loadCampaigns()
    // in src/sheet/CampaignsPage.tsx and this fails — ARRIVED is dropped and tombstoned everywhere.
    const told = await openPage();
    // A cloud pull lands while the page is open: a campaign joined on another device.
    localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify([MINE, KEEP, ARRIVED]));
    await deleteMine();
    expect(srv.deleted, 'fixture: the server delete ran').toEqual([MINE.id]);
    expect(stored(), 'only the deleted campaign left the list').toEqual([KEEP.id, ARRIVED.id]);
    // MUTATION: drop recordTombstoneKeys([`campdel:…`]) in deleteFrom and this fails — a 'player' copy of the
    // GM's own campaign that an older install stored, held by one of his characters, brought it back.
    expect(Object.keys(tombstones()).sort(), 'and only it was tombstoned — as a membership and as a deleted campaign').toEqual([
      `camp:${MINE.id}`,
      `campdel:${MINE.id}`,
    ]);
    // MUTATION: drop onCampaignDeleted?.(m.id) in deleteFrom and this fails — the GM's characters kept a
    // nameless "Campaign" for a campaign that no longer exists.
    expect(told, 'App is told, so it takes the campaign off his characters').toEqual([MINE.id]);
  }, PAGE_TIMEOUT);

  it('a delete the server refuses changes nothing here: no list change, no mark, App not told', async () => {
    srv.answer = { ok: false, error: 'You can only delete a campaign you run.' };
    const told = await openPage();
    await deleteMine();
    expect(srv.deleted, 'fixture: the server delete ran').toEqual([MINE.id]);
    expect(document.body.textContent, 'the refusal is shown').toContain('You can only delete a campaign you run.');
    expect(stored()).toEqual([MINE.id, KEEP.id]);
    expect(tombstones()).toEqual({});
    expect(told).toEqual([]);
  }, PAGE_TIMEOUT);
});
