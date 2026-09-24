// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedContent } from '../src/rules/seed';
import { applySources, emptyBuild, type BuildState } from '../src/rules/build';
import { enabledBookSet, sourceCatalog } from '../src/rules/sources';
import type { ContentDatabase } from '../src/rules/types';
import type { Campaign, CampaignMembership } from '../src/data/campaigns';
import { saveCampaignHbCache, saveHomebrewEntry, saveHomebrewSource, saveSyncOwner, type HomebrewSource } from '../src/data/storage';

/**
 * CAMPAIGN HOMEBREW — THE SOURCES CARD AND THE GM'S SHARE SWITCH.
 *
 * Owner, 2026-09-22: campaign homebrew lives on the GM's account; a player using the campaign's
 * defaults gets it in Sources, and it is usable on the player's OTHER characters. The GM shares a
 * source by ticking it in the campaign's Settings & defaults → Sources.
 *
 * What this pins:
 *  - the Sources card lists a GM's shared source (pulled to this device) by NAME with a
 *    'from <campaign>' hint, toggles it like any book, and folds a kept copy of the same name into
 *    the same row; the GM's defaults editor hides other campaigns' homebrew and says what ticking does;
 *  - the defaults editor ticks a shared source by its CURRENT name (a rename never unshares it), asks
 *    before sharing (players keep a shared source for good) and before unsharing, never unshares on
 *    an UNKNOWN shared list, and never unshares an id this device can't see;
 *  - both join doors pull the campaign's homebrew once.
 */

const srv = vi.hoisted(() => ({
  campaignSources: [] as { id: string; name: string; campaignId: string; campaignName: string; count: number }[],
  campaign: null as Campaign | null,
  shared: [] as string[] | null,
  shareResult: { ok: true, value: null } as { ok: true; value: null } | { ok: false; error: string },
  fetchSharedSourceIds: vi.fn(),
  shareSources: vi.fn(),
  unshareSources: vi.fn(),
  refreshCampaignHomebrew: vi.fn(),
  fetchCampaignByCode: vi.fn(),
  updateCampaign: vi.fn(),
  createCampaign: vi.fn(),
}));

vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'gm@example.com' }),
  signOut: async () => undefined,
}));

// The pulled campaign copy (lane A's device cache) — only its listing is read here.
vi.mock('../src/data/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/storage')>()),
  listCampaignHbSources: () => srv.campaignSources,
}));

vi.mock('../src/data/campaignHomebrew', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaignHomebrew')>()),
  fetchSharedSourceIds: srv.fetchSharedSourceIds,
  shareSources: srv.shareSources,
  unshareSources: srv.unshareSources,
  refreshCampaignHomebrew: srv.refreshCampaignHomebrew,
}));

vi.mock('../src/data/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaigns')>()),
  fetchCampaignByCode: srv.fetchCampaignByCode,
  updateCampaign: srv.updateCampaign,
  createCampaign: srv.createCampaign,
}));

const db = seedContent;
const HB_SOURCES_KEY = 'wanderers-codex:homebrew-sources:v1';
const CORE = ['Pathfinder Player Core'];

const EDITING: CampaignMembership = { id: 'camp-1', code: 'SALT23', role: 'gm', name: 'The Salt Road' };

function ownSources(...list: HomebrewSource[]): void {
  localStorage.setItem(HB_SOURCES_KEY, JSON.stringify(Object.fromEntries(list.map((s) => [s.id, s]))));
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

function render(el: React.ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  act(() => live!.render(el));
  return host;
}

const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  act(() => void el.dispatchEvent(new Event('input', { bubbles: true })));
}

const buttonNamed = (root: ParentNode, text: string): HTMLElement => {
  const b = [...root.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === text);
  if (!b) throw new Error(`no "${text}" button`);
  return b as HTMLElement;
};

/** Open the Sources card's Homebrew group (it starts collapsed). */
function openHomebrew(root: HTMLElement): void {
  const head = [...root.querySelectorAll('.src-cat-name')].find((b) => (b.textContent ?? '').includes('Homebrew'));
  if (!head) throw new Error('no Homebrew group in the Sources card');
  click(head);
}

/** The Homebrew rows whose name is exactly `name`. */
const rowsNamed = (root: HTMLElement, name: string) =>
  [...root.querySelectorAll('.src-book')].filter((b) => b.querySelector('.src-book-name')?.firstChild?.textContent === name);

const dialog = () => document.querySelector('.confirm-modal');
const dialogButton = (cls: string): HTMLElement => {
  const el = dialog()?.querySelector(cls);
  if (!el) throw new Error(`no ${cls} in the dialog — on screen: ${dialog()?.textContent ?? '(no dialog at all)'}`);
  return el as HTMLElement;
};

const ok = { ok: true as const, value: null };

beforeEach(() => {
  localStorage.clear();
  srv.campaignSources = [];
  srv.shared = [];
  srv.shareResult = ok;
  srv.campaign = {
    id: 'camp-1',
    code: 'SALT23',
    ownerId: 'gm-1',
    name: 'The Salt Road',
    description: '',
    defaults: { enabledSources: [...CORE, 'Old Name'] },
  };
  for (const f of [srv.fetchSharedSourceIds, srv.shareSources, srv.unshareSources, srv.refreshCampaignHomebrew, srv.fetchCampaignByCode, srv.updateCampaign, srv.createCampaign])
    f.mockReset();
  srv.fetchSharedSourceIds.mockImplementation(async () => srv.shared);
  srv.shareSources.mockImplementation(async () => srv.shareResult);
  srv.unshareSources.mockImplementation(async () => ok);
  srv.refreshCampaignHomebrew.mockImplementation(async () => true);
  srv.fetchCampaignByCode.mockImplementation(async () => ({ ok: true, value: srv.campaign }));
  srv.updateCampaign.mockImplementation(async (id: string, patch: { name?: string; description?: string; defaults?: Campaign['defaults'] }) => ({
    ok: true,
    value: { ...srv.campaign!, id, name: patch.name ?? '', defaults: patch.defaults ?? srv.campaign!.defaults },
  }));
  srv.createCampaign.mockImplementation(async (name: string, description: string, defaults: Campaign['defaults']) => ({
    ok: true,
    value: { id: 'new-1', code: 'NEW234', ownerId: 'gm-1', name, description, defaults },
  }));
  // Nothing here may reach for a native dialog.
  vi.spyOn(window, 'confirm').mockImplementation(() => true);
  vi.spyOn(window, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  expect(window.confirm).not.toHaveBeenCalled();
  expect(window.alert).not.toHaveBeenCalled();
  if (live) act(() => live!.unmount());
  live = null;
  host?.remove();
  host = null;
  document.querySelectorAll('.confirm-overlay').forEach((n) => n.remove());
  vi.restoreAllMocks();
});

describe('the Sources card lists campaign homebrew', () => {
  let latest: BuildState = emptyBuild();
  async function renderCard(campaignDefaults?: boolean): Promise<HTMLElement> {
    const { SourcesCard, useBuilderActions } = await import('../src/builder/shared');
    const base = sourceCatalog(db);
    // The pulled campaign entries are merged into content with the source name as their book.
    const catalog = { ...base, homebrew: [{ name: 'Salt Road Brews', count: 2 }] };
    function Harness() {
      const [build, setBuild] = useState<BuildState>(() => emptyBuild());
      const actions = useBuilderActions(setBuild, db);
      latest = build;
      return <SourcesCard build={build} actions={actions} catalog={catalog} content={db} campaignDefaults={campaignDefaults} />;
    }
    const el = render(<Harness />);
    await flush(1);
    return el;
  }

  it('shows a cached campaign source by name with its campaign, and toggling it turns that source on by id', async () => {
    // Without the campaign rows in hbList:  Error: no Homebrew group in the Sources card
    srv.campaignSources = [{ id: 'gm-src', name: 'Salt Road Brews', campaignId: 'camp-1', campaignName: 'The Salt Road', count: 2 }];
    const el = await renderCard();
    openHomebrew(el);
    const rows = rowsNamed(el, 'Salt Road Brews');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('.src-bundle-n')?.textContent).toContain('from The Salt Road');
    expect(rows[0].querySelector('.src-book-n')?.textContent).toBe('2');
    expect(rows[0].classList.contains('on')).toBe(false);

    click(rows[0]);
    await flush(1);
    expect(latest.enabledSources).toContain('hbsrc:gm-src');
    expect(latest.enabledSources).not.toContain('Salt Road Brews'); // a name would also catch a later source of that name
    expect(rowsNamed(el, 'Salt Road Brews')[0].classList.contains('on')).toBe(true);
  });

  it('hides campaign-only rows in the GM defaults editor and says ticking shares', async () => {
    // Without the campaignDefaults filter:  AssertionError: expected [ …(1) ] to have a length of +0 but got 1
    srv.campaignSources = [{ id: 'gm-src', name: 'Salt Road Brews', campaignId: 'camp-2', campaignName: 'Another Table', count: 2 }];
    ownSources({ id: 'src-mine', name: 'My Brew' });
    const el = await renderCard(true);
    openHomebrew(el);
    expect(rowsNamed(el, 'Salt Road Brews')).toHaveLength(0);
    expect(rowsNamed(el, 'My Brew')).toHaveLength(1);
    expect(el.textContent).toContain('shared with this campaign’s players, and your edits reach them automatically');
  });

  it('folds an own (kept) source and the campaign source of the same name into one row', async () => {
    // Without the de-duplication by name (the campaign row replacing the own one):
    //   AssertionError: expected <span class="src-bundle-n"></span> to be null
    srv.campaignSources = [{ id: 'gm-src', name: 'Salt Road Brews', campaignId: 'camp-1', campaignName: 'The Salt Road', count: 2 }];
    ownSources({ id: 'hbsrc-kept-gm-src', name: 'Salt Road Brews' });
    const el = await renderCard();
    openHomebrew(el);
    const rows = rowsNamed(el, 'Salt Road Brews');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('.src-bundle-n')).toBeNull(); // it is the player's own too — no campaign hint
  });
});

describe('the GM shares homebrew from the campaign defaults editor', () => {
  const saved = vi.fn();
  const created = vi.fn();
  async function renderForm(editing?: CampaignMembership): Promise<HTMLElement> {
    saved.mockReset();
    created.mockReset();
    const { CampaignForm } = await import('../src/sheet/CampaignsPage');
    const el = render(<CampaignForm content={db} editing={editing} onCancel={() => undefined} onCreated={created} onSaved={saved} />);
    await flush();
    openHomebrew(el);
    return el;
  }

  it('ticks a shared source by its id whatever it is called now, and an unchanged save neither unshares nor asks', async () => {
    // Without re-ticking by id:  AssertionError: expected false to be true // Object.is equality
    //   (the renamed row showed off — and saving would have asked to unshare it)
    srv.shared = ['src-a'];
    ownSources({ id: 'src-a', name: 'Renamed' });
    const el = await renderForm(EDITING);
    expect(rowsNamed(el, 'Renamed')[0].classList.contains('on')).toBe(true);

    click(buttonNamed(el, 'Save changes'));
    await flush();
    expect(dialog()).toBeNull();
    expect(srv.unshareSources).not.toHaveBeenCalled();
    expect(srv.shareSources).not.toHaveBeenCalled();
    expect(srv.updateCampaign).toHaveBeenCalledTimes(1);
    // The defaults players copy carry the id, so a later rename never switches it off on their characters.
    expect(srv.updateCampaign.mock.calls[0][1].defaults.enabledSources).toContain('hbsrc:src-a');
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('asks before unsharing; Cancel saves nothing, Stop sharing unshares exactly that source', async () => {
    // Without the confirm:  AssertionError: expected '(no dialog at all)' to contain 'Stop sharing Renamed with …'
    srv.shared = ['src-a'];
    ownSources({ id: 'src-a', name: 'Renamed' });
    const el = await renderForm(EDITING);
    click(rowsNamed(el, 'Renamed')[0]);
    await flush(1);

    click(buttonNamed(el, 'Save changes'));
    await flush();
    expect(dialog()?.textContent ?? '(no dialog at all)').toContain('Stop sharing Renamed with “The Salt Road”?');
    click(dialogButton('.btn-ghost')); // Cancel
    await flush();
    expect(srv.updateCampaign).not.toHaveBeenCalled();
    expect(srv.shareSources).not.toHaveBeenCalled();
    expect(srv.unshareSources).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();

    click(buttonNamed(el, 'Save changes')); // busy was released: the button works again
    await flush();
    click(dialogButton('.btn-danger')); // Stop sharing
    await flush();
    expect(srv.updateCampaign).toHaveBeenCalledTimes(1);
    expect(srv.unshareSources).toHaveBeenCalledWith('camp-1', ['src-a']);
    expect(srv.shareSources).not.toHaveBeenCalled();
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('changes no sharing when the shared list could not be read, but still saves name and defaults', async () => {
    // Without the null gate (the unread list taken for []):
    //   AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
    //   1st vi.fn() call: [ "camp-1", [ "src-b" ] ]
    srv.shared = null;
    ownSources({ id: 'src-a', name: 'Renamed' }, { id: 'src-b', name: 'Fresh' });
    const el = await renderForm(EDITING);
    click(rowsNamed(el, 'Fresh')[0]);
    await flush(1);

    click(buttonNamed(el, 'Save changes'));
    await flush();
    expect(dialog()).toBeNull();
    expect(srv.shareSources).not.toHaveBeenCalled();
    expect(srv.unshareSources).not.toHaveBeenCalled();
    expect(srv.updateCampaign).toHaveBeenCalledTimes(1);
    const patch = srv.updateCampaign.mock.calls[0][1];
    expect(patch.name).toBe('The Salt Road');
    expect(patch.defaults.enabledSources).toContain('hbsrc:src-b');
    expect(saved).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('Couldn’t check which homebrew is shared — sharing won’t change when you save.');
  });

  it('never unshares a shared id this device has no source for', async () => {
    // Without the "exists locally" check:  TypeError: Cannot read properties of undefined (reading 'name')
    //   (the ghost id reached the unshare list, and the save died naming it)
    srv.shared = ['src-a', 'src-ghost'];
    ownSources({ id: 'src-a', name: 'Renamed' });
    const el = await renderForm(EDITING);

    click(buttonNamed(el, 'Save changes')); // nothing unticked: the ghost alone never asks
    await flush();
    expect(dialog()).toBeNull();
    expect(srv.unshareSources).not.toHaveBeenCalled();

    click(rowsNamed(el, 'Renamed')[0]);
    await flush(1);
    click(buttonNamed(el, 'Save changes'));
    await flush();
    expect(dialog()?.textContent ?? '(no dialog at all)').toContain('Stop sharing Renamed with');
    click(dialogButton('.btn-danger'));
    await flush();
    expect(srv.unshareSources).toHaveBeenCalledTimes(1);
    expect(srv.unshareSources).toHaveBeenCalledWith('camp-1', ['src-a']);
  });

  it('shares a ticked own source with a campaign it just created', async () => {
    // Without the share step after create:  AssertionError: expected "vi.fn()" to be called with arguments: [ 'new-1', [ 'src-b' ] ]
    ownSources({ id: 'src-b', name: 'Fresh' }, { id: 'src-c', name: 'Not This One' });
    const el = await renderForm();
    type(el.querySelector('input[placeholder="e.g. Fall of Plaguestone"]') as HTMLInputElement, 'New Table');
    click(rowsNamed(el, 'Fresh')[0]);
    await flush(1);

    click(buttonNamed(el, 'Create campaign'));
    await flush();
    expect(dialog()?.textContent ?? '(no dialog at all)').toContain('Share Fresh with “New Table”?');
    expect(srv.createCampaign).not.toHaveBeenCalled(); // nothing exists until the GM says yes
    click(dialogButton('.btn-danger')); // Share
    await flush();
    expect(srv.createCampaign).toHaveBeenCalledTimes(1);
    expect(srv.shareSources).toHaveBeenCalledWith('new-1', ['src-b']);
    expect(srv.unshareSources).not.toHaveBeenCalled();
    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0][1]).toBeUndefined();
  });

  it('asks before sharing what Enable everything ticked; Cancel saves and shares nothing', async () => {
    // Without the share confirm:  AssertionError: expected '(no dialog at all)' to contain 'Share Fresh, Other Work with …'
    //   (Save quietly shared every one of the GM's sources)
    srv.shared = [];
    ownSources({ id: 'src-b', name: 'Fresh' }, { id: 'src-c', name: 'Other Work' });
    const el = await renderForm(EDITING);
    click(buttonNamed(el, 'Enable everything'));
    await flush(1);

    click(buttonNamed(el, 'Save changes'));
    await flush();
    expect(dialog()?.textContent ?? '(no dialog at all)').toContain('Share Fresh, Other Work with “The Salt Road”?');
    expect(dialog()?.textContent).toContain('keep as their own homebrew, even if you stop sharing later');
    click(dialogButton('.btn-ghost')); // Cancel
    await flush();
    expect(srv.updateCampaign).not.toHaveBeenCalled();
    expect(srv.shareSources).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();

    click(buttonNamed(el, 'Save changes'));
    await flush();
    click(dialogButton('.btn-danger')); // Share
    await flush();
    expect(srv.shareSources).toHaveBeenCalledWith('camp-1', ['src-b', 'src-c']);
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('asks before an unchanged save shares a source whose name the stored defaults already held', async () => {
    // The fixture's defaults hold 'Old Name' — a renamed source's old name, or a GM's homebrew ticked
    // before ticking meant sharing. A new source with that name shows ticked; saving must not share it
    // quietly. Without the share confirm:  AssertionError: expected '(no dialog at all)' to contain 'Share Old Name with …'
    srv.shared = [];
    ownSources({ id: 'src-new', name: 'Old Name' });
    const el = await renderForm(EDITING);
    expect(rowsNamed(el, 'Old Name')[0].classList.contains('on')).toBe(true);

    click(buttonNamed(el, 'Save changes'));
    await flush();
    expect(dialog()?.textContent ?? '(no dialog at all)').toContain('Share Old Name with “The Salt Road”?');
    click(dialogButton('.btn-ghost')); // Cancel
    await flush();
    expect(srv.updateCampaign).not.toHaveBeenCalled();
    expect(srv.shareSources).not.toHaveBeenCalled();
  });

  it('after a create whose sharing failed, says where the retry is', async () => {
    // With the edit form's wording:  AssertionError: expected 'Saved, but sharing failed: … Save again to retry.'
    //   to contain 'Manage campaign → Settings & defaults' (the created screen has no Save button)
    srv.shareResult = { ok: false, error: 'Still syncing — save again in a moment.' };
    ownSources({ id: 'src-b', name: 'Fresh' });
    const el = await renderForm();
    type(el.querySelector('input[placeholder="e.g. Fall of Plaguestone"]') as HTMLInputElement, 'New Table');
    click(rowsNamed(el, 'Fresh')[0]);
    await flush(1);

    click(buttonNamed(el, 'Create campaign'));
    await flush();
    click(dialogButton('.btn-danger')); // Share
    await flush();
    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0][1]).toContain('Manage campaign → Settings & defaults');
  });

  it('stays on the form with the error when sharing fails after an edit is saved', async () => {
    // Without the share-error branch:  AssertionError: expected "vi.fn()" to not be called at all, but actually
    //   been called 1 times (onSaved left the form)
    srv.shared = [];
    srv.shareResult = { ok: false, error: 'Still syncing — save again in a moment.' };
    ownSources({ id: 'src-b', name: 'Fresh' });
    const el = await renderForm(EDITING);
    click(rowsNamed(el, 'Fresh')[0]);
    await flush(1);

    click(buttonNamed(el, 'Save changes'));
    await flush();
    click(dialogButton('.btn-danger')); // Share
    await flush();
    expect(srv.updateCampaign).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
    expect(el.querySelector('.login-error')?.textContent).toBe(
      'Saved, but sharing failed: Still syncing — save again in a moment. Save again to retry.',
    );
  });
});

describe('a GM renaming a shared source', () => {
  it('leaves it switched on for the player — by id — with its entries still in the pickers, kept copy included', async () => {
    const { SourcesCard, useBuilderActions } = await import('../src/builder/shared');
    const { rebuildContent } = await import('../src/data');
    const UID = 'player-1';
    saveSyncOwner(UID);
    const pulled = (name: string) => {
      saveCampaignHbCache(UID, {
        'camp-1': {
          name: 'The Salt Road',
          sources: { 'gm-src': { id: 'gm-src', name } },
          content: { feats: { 'gm-feat': { id: 'gm-feat', name: 'Salt Step', homebrewSourceId: 'gm-src' } } } as never,
          updatedAt: '2026-09-20T10:00:00.000Z',
        },
      });
      srv.campaignSources = [{ id: 'gm-src', name, campaignId: 'camp-1', campaignName: 'The Salt Road', count: 1 }];
    };
    let latest: BuildState = emptyBuild();
    function Harness({ start, content }: { start: BuildState; content: ContentDatabase }) {
      const [build, setBuild] = useState<BuildState>(start);
      const actions = useBuilderActions(setBuild, content);
      latest = build;
      return <SourcesCard build={build} actions={actions} catalog={sourceCatalog(content)} content={content} />;
    }
    /** What the builder's pickers get for this character (Builder.tsx: applySources over the full db). */
    const pickable = (content: ContentDatabase) => applySources(content, enabledBookSet(latest.enabledSources), new Set()).feats['gm-feat'];

    // The player turns the GM's "Salt Road Brews" on.
    pulled('Salt Road Brews');
    let db = rebuildContent();
    let el = render(<Harness start={latest} content={db} />);
    openHomebrew(el);
    click(rowsNamed(el, 'Salt Road Brews')[0]);
    await flush(1);
    expect(pickable(db)).toBeDefined();
    act(() => live!.unmount());
    host!.remove();

    // The GM renames it; the next pull brings the new name.
    pulled('Salt Road Brews II');
    db = rebuildContent();
    expect(db.feats['gm-feat'].source?.book).toBe('Salt Road Brews II');
    el = render(<Harness start={latest} content={db} />);
    openHomebrew(el);
    // Matched by name only (the toggle before this fix):
    //   AssertionError: expected false to be true // Object.is equality
    expect(rowsNamed(el, 'Salt Road Brews II')[0].classList.contains('on')).toBe(true);
    //   AssertionError: expected undefined to be defined
    expect(pickable(db)).toBeDefined();

    // The GM stops sharing it: the player's kept copy (hbsrc-kept-gm-src) is the same switch.
    saveCampaignHbCache(UID, {});
    saveHomebrewEntry('feats', { id: 'gm-feat', name: 'Salt Step', homebrewSourceId: 'hbsrc-kept-gm-src' } as never);
    saveHomebrewSource({ id: 'hbsrc-kept-gm-src', name: 'Salt Road Brews II', kept: { from: 'The Salt Road', ids: ['feats:gm-feat'] } });
    db = rebuildContent();
    expect(pickable(db)).toBeDefined();
  });
});

describe('who can read shared homebrew — the campaign-system convention', () => {
  it('is documented as the convention in the SQL and the data layer, with server-side membership a separate task', () => {
    // chb_member_read lets any signed-in account the GM hasn't kicked read, like every campaign table:
    // membership lives in each player's synced data, not on the server. That is a stated convention,
    // not a defect of this feature — this pins that it stays stated where the policy and its reader live.
    const root = resolve(__dirname, '..');
    const sql = readFileSync(resolve(root, 'supabase-campaign-homebrew.sql'), 'utf8');
    const ts = readFileSync(resolve(root, 'src/data/campaignHomebrew.ts'), 'utf8');
    expect(sql).toMatch(/create policy chb_member_read[\s\S]*not \(auth\.uid\(\) = any/);
    for (const text of [sql, ts]) {
      expect(text).toContain('campaign-system convention');
      expect(text).toContain('server-side membership is a separate task');
    }
  });
});

describe('joining a campaign pulls its homebrew', () => {
  it('CampaignAttachCard.join refreshes once after a successful join', async () => {
    // Without the call in join:  AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
    const { CampaignAttachCard, useBuilderActions } = await import('../src/builder/shared');
    srv.campaign = { ...srv.campaign!, defaults: {} };
    function Harness() {
      const [build, setBuild] = useState<BuildState>(() => emptyBuild());
      const actions = useBuilderActions(setBuild, db);
      return <CampaignAttachCard build={build} actions={actions} content={db} />;
    }
    const el = render(<Harness />);
    await flush(1);
    type(el.querySelector('input[aria-label="Campaign code"]') as HTMLInputElement, 'SALT23');
    click(buttonNamed(el, 'Join'));
    await flush();
    expect(srv.refreshCampaignHomebrew).toHaveBeenCalledTimes(1);
  });

  it('the phone JoinRow refreshes once after a successful join', async () => {
    // Without the call in JoinRow:  AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
    window.matchMedia = ((q: string) => ({
      matches: /max-width:\s*(720|768)px/.test(q),
      media: q,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    const { CampaignsPage } = await import('../src/sheet/CampaignsPage');
    const el = render(
      <CampaignsPage
        content={db}
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
    type(el.querySelector('input[aria-label="Campaign share code"]') as HTMLInputElement, 'SALT23');
    click(buttonNamed(el, 'Join'));
    await flush();
    expect(el.textContent).toContain('Joined “The Salt Road”');
    expect(srv.refreshCampaignHomebrew).toHaveBeenCalledTimes(1);
  }, 120_000);
});
