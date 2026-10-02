// @vitest-environment jsdom
/*
 * Campaign homebrew on the Homebrew page (owner spec, 2026-09-22): homebrew "from campaigns" lives on
 * the GM's account, only the GM changes it, and a player can export it to a copy of their own.
 *
 * Renders the REAL page against real storage. The cache is seeded through saveCampaignHbCache under
 * the same uid as saveSyncOwner, exactly as a pull leaves it. Only sharedSourceCampaigns (a network
 * read of the GM's shares) is mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { HomebrewPage } from '../src/sheet/HomebrewPage';
import { ForceMobileContext } from '../src/sheet/useIsMobile';
import {
  saveHomebrewSource,
  saveHomebrewEntry,
  deleteHomebrewEntry,
  deleteHomebrewSource,
  loadHomebrewSources,
  loadHomebrewContent,
  loadRevived,
  loadTombstones,
  saveCampaignHbCache,
  saveCampaigns,
  saveSyncOwner,
  HOMEBREW_TYPES,
  CAMPAIGN_HB_CACHE_KEY,
  type CampaignHbCampaign,
} from '../src/data/storage';
import { createBackup } from '../src/data/backup';
import type { CampaignMembership } from '../src/data/campaigns';
import { renderDom } from './_render';
import type { ContentDatabase, Item } from '../src/rules/types';

const shared = vi.hoisted(() => ({ fn: vi.fn(async (): Promise<Record<string, string[]> | null> => null) }));
// The campaign-homebrew pull (the bounded one the app's focus/online triggers run). Unstarted it is a
// no-op that answers false, which is what this stand-in does unless a leg says otherwise.
const pull = vi.hoisted(() => ({ fn: vi.fn(async (): Promise<boolean> => false) }));
// Signed in, with this session's first cloud pull landed — what every leg runs as unless it says
// otherwise (settle round 4: the import waits for that pull while signed in). `account` stands in for
// campaignHomebrew.ts accountStateHere (pinned against the auth client in campaign-hb-account-state.test.ts).
const session = vi.hoisted(() => ({
  account: vi.fn(async (): Promise<'no-cloud' | 'signed-out' | 'signed-in'> => 'signed-in'),
  synced: true,
}));
vi.mock('../src/data/campaignHomebrew', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaignHomebrew')>()),
  sharedSourceCampaigns: shared.fn,
  refreshCampaignHomebrew: pull.fn,
  accountStateHere: session.account,
}));
vi.mock('../src/data/cloudSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloudSync')>()),
  hasSyncedOnce: () => session.synced,
}));

const UID = 'player-uid-1';
const EMPTY = {} as ContentDatabase;
const noop = () => undefined;

function seedCampaign() {
  saveSyncOwner(UID);
  const content = {
    items: { 'gm-crown': { id: 'gm-crown', name: 'Crown of Ash', homebrewSourceId: 'gm-src', source: { license: 'homebrew' } } },
    feats: { 'gm-decree': { id: 'gm-decree', name: 'Royal Decree', homebrewSourceId: 'gm-src' } },
  } as unknown as CampaignHbCampaign['content'];
  saveCampaignHbCache(UID, {
    'camp-1': {
      name: 'Stolen Lands',
      sources: { 'gm-src': { id: 'gm-src', name: 'Kingdom Gear' } },
      content,
      updatedAt: '2026-09-20T10:00:00.000Z',
    },
  });
}

const page = (content: ContentDatabase = EMPTY, onChanged: () => void = noop) => (
  <HomebrewPage content={content} onChanged={onChanged} onClose={noop} />
);
const phone = (el: ReactElement) =><ForceMobileContext.Provider value={true}>{el}</ForceMobileContext.Provider>;
const find = (root: ParentNode, sel: string, text: string) =>
  [...root.querySelectorAll(sel)].find((el) => (el.textContent ?? '').includes(text)) ?? null;
/** Let promises (and the dialog's deferred teardown) settle inside act. */
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const dialog = () => document.body.querySelector('.confirm-modal');
const buttonLabels = (root: ParentNode) => [...root.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
/** The open dialog's answer buttons (not its X). */
const actionLabels = () => buttonLabels(dialog()?.querySelector('.confirm-actions') ?? document.createElement('div'));

beforeEach(() => {
  document.body.innerHTML = ''; // a dialog a failed test left open must not answer for the next one
  localStorage.clear();
  shared.fn.mockReset();
  shared.fn.mockResolvedValue(null);
  pull.fn.mockReset();
  pull.fn.mockResolvedValue(false);
  session.account.mockReset();
  session.account.mockResolvedValue('signed-in');
  session.synced = true;
});

describe('campaign homebrew on the Homebrew page', () => {
  it('desktop: a GM-shared source lists under "From campaigns" and opens read-only', () => {
    saveHomebrewSource({ id: 'own-1', name: 'My Stuff' });
    // No campaign copy on this device → no group at all.
    let r = renderDom(page());
    expect(r.host.querySelector('.hb-group-head')).toBeNull();
    r.stop();

    seedCampaign();
    r = renderDom(page());
    const nav = r.host.querySelector('.settings-nav')!;
    const items = [...nav.children];
    const head = nav.querySelector('.hb-group-head')!;
    expect(head.textContent).toBe('From campaigns');
    const row = find(nav, '.settings-navitem', 'Kingdom Gear')!;
    expect(row.querySelector('.ti-lock')).not.toBeNull();
    expect(row.querySelector('.hb-row-sub')?.textContent).toBe('Stolen Lands');
    // After the own sources, before "New source".
    expect(items.indexOf(find(nav, '.settings-navitem', 'My Stuff')!)).toBeLessThan(items.indexOf(head));
    expect(items.indexOf(row)).toBeLessThan(items.indexOf(find(nav, '.settings-navitem', 'New source')!));

    r.click(row);
    const pane = r.host.querySelector('.settings-pane')!;
    expect(pane.querySelector('h3')?.textContent).toBe('Kingdom Gear');
    expect(pane.textContent).toContain(
      'Shared by your GM in “Stolen Lands”. It updates when your GM changes it, and only your GM can edit it.',
    );
    expect(pane.textContent).toMatch(/Updated \S/);
    expect(pane.textContent).toContain('Crown of Ash');
    expect(pane.textContent).toContain('Royal Decree');
    // Grouped by type, names only: no Add, no Delete, no rename box — the one button is the export.
    expect([...pane.querySelectorAll('.hb-type-head span')].map((s) => s.textContent?.trim())).toEqual(['Items', 'Feats']);
    expect(buttonLabels(pane)).toEqual(['Export to my homebrew']);
    expect(pane.querySelector('input')).toBeNull();
    r.stop();
  });

  it('phone: the same row is in the drill-in list and drills into the read-only pane', () => {
    saveHomebrewSource({ id: 'own-1', name: 'My Stuff' });
    seedCampaign();
    const r = renderDom(phone(page()));
    const list = r.host.querySelector('.hb-sources-m')!;
    const rows = [...list.children];
    const head = list.querySelector('.hb-group-head')!;
    const row = find(list, '.hb-source-row', 'Kingdom Gear')!;
    expect(row.textContent).toContain('Stolen Lands');
    expect(rows.indexOf(find(list, '.hb-source-row', 'My Stuff')!)).toBeLessThan(rows.indexOf(head));
    expect(rows.indexOf(head)).toBeLessThan(rows.indexOf(row));
    expect(rows.indexOf(row)).toBeLessThan(rows.indexOf(find(list, '.hb-source-row', 'New source')!));

    r.click(row);
    expect(r.host.querySelector('.hb-sources-m')).toBeNull();
    expect(r.host.querySelector('.chrome-brand')?.textContent).toContain('Kingdom Gear');
    expect(r.host.querySelector('.hb-back')).not.toBeNull();
    const pane = r.host.querySelector('.settings-pane')!;
    expect(pane.textContent).toContain('Crown of Ash');
    expect(pane.textContent).toContain('only your GM can edit it');
    expect(buttonLabels(pane)).toEqual(['Export to my homebrew']);
    expect(pane.querySelector('input')).toBeNull();
    r.stop();
  });

  it('"Export to my homebrew" makes one own copy with new ids, selects it, and says so in the app dialog', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    const nativeAlert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    seedCampaign();
    const onChanged = vi.fn();
    const r = renderDom(page(EMPTY, onChanged));
    r.click(find(r.host, '.settings-navitem', 'Kingdom Gear'));
    r.click(find(r.host, '.settings-pane button', 'Export to my homebrew'));
    await settle();

    expect(dialog()?.textContent).toContain('Copied to your homebrew');
    expect(dialog()?.textContent).toContain("your GM's changes won't reach it");
    // A notice, not a question — the copy has already happened. As a confirmDialog:
    //   AssertionError: expected [ 'Cancel', 'Done' ] to deeply equal [ 'Done' ]
    expect(actionLabels()).toEqual(['Done']);
    const sources = Object.values(loadHomebrewSources());
    expect(sources.map((s) => s.name)).toEqual(['Kingdom Gear (my copy)']);
    const copy = sources[0];
    expect(copy.kept).toBeUndefined();
    const hb = loadHomebrewContent();
    const copied = HOMEBREW_TYPES.flatMap((t) => Object.values(hb[t]) as { id: string; name: string; homebrewSourceId?: string }[]);
    expect(copied.every((e) => e.homebrewSourceId === copy.id)).toBe(true);
    expect(copied.map((e) => e.name).sort()).toEqual(['Crown of Ash', 'Royal Decree']);
    for (const e of copied) expect(['gm-crown', 'gm-decree']).not.toContain(e.id);
    expect(onChanged).toHaveBeenCalled();
    // The new own source is the one now open — editable.
    expect((r.host.querySelector('input.hb-source-name') as HTMLInputElement).value).toBe('Kingdom Gear (my copy)');
    expect(find(r.host, '.settings-pane .hb-entry-name', 'Crown of Ash')).not.toBeNull();

    r.click(find(dialog()!, 'button', 'Done'));
    await settle();
    expect(dialog()).toBeNull();
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(nativeAlert).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
    nativeAlert.mockRestore();
    r.stop();
  });

  it('"Couldn\'t copy" (the source left this device while its pane was open) is a one-button notice', async () => {
    seedCampaign();
    const r = renderDom(page());
    r.click(find(r.host, '.settings-navitem', 'Kingdom Gear'));
    saveCampaignHbCache(UID, {}); // a pull converted it away meanwhile
    r.click(find(r.host, '.settings-pane button', 'Export to my homebrew'));
    await settle();
    expect(dialog()?.textContent).toContain("Couldn't copy");
    // As a confirmDialog:  AssertionError: expected [ 'Cancel', 'OK' ] to deeply equal [ 'OK' ]
    expect(actionLabels()).toEqual(['OK']);
    expect(Object.keys(loadHomebrewSources())).toEqual([]);
    r.click(find(dialog()!, 'button', 'OK'));
    await settle();
    expect(dialog()).toBeNull();
    r.stop();
  });

  it('a kept source says where it came from and stays fully editable', () => {
    saveHomebrewEntry('items', { id: 'k-blade', name: 'Kept Blade', homebrewSourceId: 'hbsrc-kept-old' } as unknown as Item);
    saveHomebrewSource({ id: 'hbsrc-kept-old', name: 'Old Gear', kept: { from: 'Stolen Lands', ids: ['items:k-blade'] } });

    const m = renderDom(phone(page()));
    expect(find(m.host, '.hb-source-row', 'Old Gear')?.querySelector('.hb-row-sub')?.textContent).toBe('Kept from Stolen Lands');
    m.stop();

    const r = renderDom(page());
    const row = find(r.host, '.settings-navitem', 'Old Gear')!;
    expect(row.querySelector('.hb-row-sub')?.textContent).toBe('Kept from Stolen Lands');
    r.click(row);
    const pane = r.host.querySelector('.settings-pane')!;
    const name = pane.querySelector('input.hb-source-name') as HTMLInputElement;
    expect(name.value).toBe('Old Gear');
    expect(pane.textContent).toContain('Kept from Stolen Lands');
    expect(buttonLabels(pane)).toContain('Delete source');
    expect(buttonLabels(pane).filter((l) => l === 'Add').length).toBe(pane.querySelectorAll('.hb-type').length);
    expect(find(pane, 'button.hb-entry-name', 'Kept Blade')).not.toBeNull();

    // Rename goes through the ordinary writer and keeps the kept marker.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(name, 'Old Gear, mine');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(loadHomebrewSources()['hbsrc-kept-old']).toMatchObject({ name: 'Old Gear, mine', kept: { from: 'Stolen Lands' } });
    r.stop();
  });

  it('an untouched kept entry that the live campaign copy shadows still lists under its kept source', () => {
    seedCampaign();
    saveHomebrewEntry('items', { id: 'gm-crown', name: 'Crown of Ash', homebrewSourceId: 'hbsrc-kept-gm-src' } as unknown as Item);
    saveHomebrewSource({ id: 'hbsrc-kept-gm-src', name: 'Kingdom Gear', kept: { from: 'Stolen Lands', ids: ['items:gm-crown'] } });
    // What the content DB holds in that slot: the GM's live copy (merge layer 2 over layer 1).
    const content = {
      items: { 'gm-crown': { id: 'gm-crown', name: 'Crown of Ash', homebrewSourceId: 'gm-src' } },
    } as unknown as ContentDatabase;

    // Both rows are called "Kingdom Gear": the own (kept) one has the folder, the campaign one the lock.
    const navRow = (host: HTMLElement, icon: string) => host.querySelector(`.settings-navitem:has(.${icon})`);
    let r = renderDom(page(content));
    r.click(navRow(r.host, 'ti-folder'));
    expect(r.host.querySelector('input.hb-source-name')).toHaveProperty('value', 'Kingdom Gear');
    expect(find(r.host, '.settings-pane button.hb-entry-name', 'Crown of Ash')).not.toBeNull();
    // In the campaign pane the GM's copy is the one in use — no "your own version" note.
    r.click(navRow(r.host, 'ti-lock'));
    expect(r.host.querySelector('.settings-pane')?.textContent).toContain('only your GM can edit it');
    expect(r.host.querySelector('.settings-pane')?.textContent).not.toContain('your own version is used');
    r.stop();

    // Once the player edits it, it is theirs and wins over the GM's copy.
    saveHomebrewEntry('items', { id: 'gm-crown', name: 'Crown of Ash', homebrewSourceId: 'hbsrc-kept-gm-src', level: 3 } as unknown as Item);
    r = renderDom(page(content));
    r.click(navRow(r.host, 'ti-lock'));
    expect(find(r.host, '.settings-pane .hb-entry', 'Crown of Ash')?.textContent).toBe('Crown of Ash — your own version is used');
    expect(find(r.host, '.settings-pane .hb-entry', 'Royal Decree')?.textContent).toBe('Royal Decree');
    r.stop();
  });

  it('desktop: deleting a shared source warns that its players keep a copy; phones never ask the server', async () => {
    shared.fn.mockResolvedValue({ 'own-1': ['Stolen Lands', 'Gutter Kings'] });
    saveHomebrewSource({ id: 'own-1', name: 'My Stuff' });
    const r = renderDom(page());
    await settle();
    expect(shared.fn).toHaveBeenCalledTimes(1);
    const pane = r.host.querySelector('.settings-pane')!;
    expect(pane.textContent).toContain('Shared with Stolen Lands, Gutter Kings — your edits reach its players automatically.');
    r.click(find(pane, 'button', 'Delete source'));
    await settle();
    expect(dialog()?.textContent).toContain('Players in Stolen Lands, Gutter Kings keep a copy as their own homebrew.');
    r.click(find(dialog()!, 'button', 'Cancel'));
    await settle();
    expect(loadHomebrewSources()['own-1']).toBeTruthy();
    r.stop();

    shared.fn.mockClear();
    const m = renderDom(phone(page()));
    await settle();
    m.click(find(m.host, '.hb-source-row', 'My Stuff'));
    expect(m.host.querySelector('.settings-pane')?.textContent).not.toContain('Shared with');
    m.click(find(m.host, '.settings-pane button', 'Delete source'));
    await settle();
    expect(dialog()?.textContent).toContain("This can't be undone.");
    expect(dialog()?.textContent).not.toContain('keep a copy');
    m.click(find(dialog()!, 'button', 'Cancel'));
    await settle();
    expect(shared.fn).not.toHaveBeenCalled();
    m.stop();
  });

  it('deleting an entry asks first, named, and Cancel leaves it; Delete removes only that entry', async () => {
    saveHomebrewSource({ id: 'own-1', name: 'My Stuff' });
    saveHomebrewEntry('feats', { id: 'f-keep', name: 'Kept Feat', homebrewSourceId: 'own-1' } as never);
    saveHomebrewEntry('feats', { id: 'f-gone', name: 'Doomed Feat', homebrewSourceId: 'own-1' } as never);
    const onChanged = vi.fn();
    const r = renderDom(page(EMPTY, onChanged));
    r.click(find(r.host, '.settings-navitem', 'My Stuff'));
    const pane = r.host.querySelector('.settings-pane')!;

    // Cancel: the confirm names the entry and nothing is deleted.
    r.click(pane.querySelector('button[aria-label="Delete Doomed Feat"]'));
    await settle();
    expect(dialog()?.textContent).toContain('Delete Doomed Feat?');
    expect(dialog()?.textContent).toContain('your characters lose it');
    expect(actionLabels()).toEqual(['Cancel', 'Delete']);
    r.click(find(dialog()!, 'button', 'Cancel'));
    await settle();
    expect(dialog()).toBeNull();
    expect(loadHomebrewContent().feats['f-gone']).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
    expect(find(pane, '.hb-entry-name', 'Doomed Feat')).not.toBeNull();

    // Delete: removes only the targeted entry, not its sibling.
    r.click(pane.querySelector('button[aria-label="Delete Doomed Feat"]'));
    await settle();
    r.click(find(dialog()!, 'button', 'Delete'));
    await settle();
    expect(dialog()).toBeNull();
    const feats = loadHomebrewContent().feats;
    expect(feats['f-gone']).toBeUndefined();
    expect(feats['f-keep']).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
    expect(find(pane, '.hb-entry-name', 'Doomed Feat')).toBeNull();
    expect(find(pane, '.hb-entry-name', 'Kept Feat')).not.toBeNull();
    r.stop();
  });

  it('import still sanitizes: a <script> in an imported description never reaches storage', async () => {
    const r = renderDom(page());
    const input = r.host.querySelector('input[type=file]') as HTMLInputElement;
    const payload = {
      app: 'heroes-heaven',
      kind: 'homebrew',
      version: 1,
      sources: { 'imp-src': { id: 'imp-src', name: 'Imported' } },
      content: {
        feats: {
          'imp-feat': {
            id: 'imp-feat',
            name: 'Bad Feat',
            homebrewSourceId: 'imp-src',
            description: '<p>Fine text</p><script>window.__pwned = 1</script><b onclick="x()">bold</b>',
          },
        },
      },
    };
    Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(payload)], 'hb.json', { type: 'application/json' })] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(dialog()?.textContent).toContain('Homebrew imported');
    expect(dialog()?.textContent).toContain('Added 1 feat and 1 source.');
    // A notice, not a question — the import already happened.
    expect(actionLabels()).toEqual(['Done']);
    const desc = (loadHomebrewContent().feats['imp-feat'] as unknown as { description: string }).description;
    expect(desc).toContain('Fine text');
    expect(desc).toContain('bold');
    expect(desc).not.toMatch(/<script|onclick|__pwned/i);
    r.click(find(dialog()!, 'button', 'Done'));
    await settle();
    r.stop();
  });

  it('"Couldn\'t import" (not a homebrew file) is a one-button notice', async () => {
    const r = renderDom(page());
    const input = r.host.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['not json'], 'hb.json', { type: 'application/json' })] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(dialog()?.textContent).toContain("Couldn't import");
    expect(actionLabels()).toEqual(['OK']);
    r.click(find(dialog()!, 'button', 'OK'));
    await settle();
    expect(dialog()).toBeNull();
    r.stop();
  });
});

/* ---- Item 8 (2026-10-01): the page's own file Export / Import -------------------------------------
 * "it showed a bunch of weird characters instead of the homebrew name". From v0.1.9 the Export handed
 * downloadText (text, name) against a (name, text) helper: every file was NAMED after its JSON and HELD
 * only "heroes-heaven-homebrew.json". Fixing it made the Import reachable with real files for the first
 * time — and the Import REPLACED same-id homebrew and re-stamped it as re-created, which beats a
 * deletion on every synced device. These legs run the real page, real storage and the real
 * downloadText; only the browser's object URL and anchor click are caught. All names are synthetic. */

const HB_FILE = /^heroes-heaven-homebrew-\d{4}-\d{2}-\d{2}\.json$/;
const SYN_SRC = { id: 'hbsrc-syn-1', name: 'Synthetic Forge' };
const SYN_A = { id: 'syn-glass-anvil', name: 'Glass Anvil Stance', homebrewSourceId: SYN_SRC.id };
const SYN_B = { id: 'syn-ember-step', name: 'Ember Step', homebrewSourceId: SYN_SRC.id };
const CONTENT_KEY = 'wanderers-codex:homebrew-content:v1';
const SOURCES_KEY = 'wanderers-codex:homebrew-sources:v1';

function seedOwn(...feats: (typeof SYN_A)[]) {
  saveHomebrewSource(SYN_SRC);
  for (const f of feats) saveHomebrewEntry('feats', f as never);
}

/** jsdom has no object URLs and saves nothing: catch the file downloadText hands the anchor. */
function captureDownloads() {
  const files: { name: string; blob: Blob }[] = [];
  let last: Blob | null = null;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  URL.createObjectURL = ((b: Blob) => {
    last = b;
    return 'blob:test';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = () => undefined;
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    files.push({ name: this.download, blob: last! });
  });
  return {
    files,
    restore() {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
      click.mockRestore();
    },
  };
}

/** Export through the desktop sidebar chip and hand back the saved file's text. */
async function exportedText(): Promise<string> {
  const dl = captureDownloads();
  try {
    const r = renderDom(page());
    r.click(find(r.host, '.settings-nav .hb-io-row button', 'Export'));
    r.stop();
    expect(dl.files).toHaveLength(1);
    return await dl.files[0].blob.text();
  } finally {
    dl.restore();
  }
}

/** Pick a file in the page's hidden Import input. */
async function importText(r: ReturnType<typeof renderDom>, text: string) {
  const input = r.host.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [new File([text], 'picked.json', { type: 'application/json' })], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

async function closeNotice(r: ReturnType<typeof renderDom>) {
  r.click(dialog()!.querySelector('.confirm-actions button'));
  await settle();
  expect(dialog()).toBeNull();
}

describe('Homebrew Export / Import files (item 8)', () => {
  it('both Export chips save heroes-heaven-homebrew-YYYY-MM-DD.json holding the homebrew', async () => {
    seedOwn(SYN_A);
    const dl = captureDownloads();
    try {
      const d = renderDom(page());
      d.click(find(d.host, '.settings-nav .hb-io-row button', 'Export'));
      d.stop();
      const m = renderDom(phone(page()));
      m.click(find(m.host, '.hb-sources-m .hb-io-row button', 'Export homebrew'));
      m.stop();
      await settle();
      // MUTATION PROOF (tried 2026-10-01): put back `downloadText(JSON.stringify(payload, null, 2),
      // 'heroes-heaven-homebrew.json')` and the guard throws — no file is saved and the notice opens:
      //   AssertionError: expected <div …(4)>…(3)</div> to be null   (aria-label="Export failed")
      expect(dialog()).toBeNull();
      expect(dl.files).toHaveLength(2);
      for (const f of dl.files) {
        expect(f.name).toMatch(HB_FILE);
        const json = JSON.parse(await f.blob.text());
        expect(json).toMatchObject({ app: 'heroes-heaven', kind: 'homebrew', version: 1 });
        expect(json.sources[SYN_SRC.id]).toMatchObject(SYN_SRC);
        expect(json.content.feats[SYN_A.id]).toMatchObject(SYN_A);
      }
    } finally {
      dl.restore();
    }
  });

  it('a failed export says so in the app dialog', async () => {
    // The export used to have no catch at all: a throw escaped the click handler and the player saw
    // nothing. The other three exports (backup, roster, GM sheet) always had one.
    seedOwn(SYN_A);
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = (() => {
      throw new Error('The device refused the file.');
    }) as typeof URL.createObjectURL;
    try {
      const r = renderDom(page());
      r.click(find(r.host, '.settings-nav .hb-io-row button', 'Export'));
      await settle();
      expect(dialog()?.textContent).toContain('Export failed');
      expect(dialog()?.textContent).toContain('The device refused the file.');
      expect(actionLabels()).toEqual(['OK']);
      await closeNotice(r);
      r.stop();
    } finally {
      URL.createObjectURL = realCreate;
    }
  });

  it('the exported file imports back: on this device nothing is re-written, on a fresh one it all lands', async () => {
    seedOwn(SYN_A, SYN_B);
    const text = await exportedText();

    const revived = loadRevived();
    const onChanged = vi.fn();
    const r = renderDom(page(EMPTY, onChanged));
    await importText(r, text);
    // Nothing was added, and the title says so — never "Homebrew imported" over an import that wrote nothing.
    expect(dialog()?.textContent).toContain('Nothing new to import');
    expect(dialog()?.textContent).not.toContain('Homebrew imported');
    expect(dialog()?.textContent).not.toContain('Added');
    // The source counts as skipped too, and every skip names what it skipped.
    expect(dialog()?.textContent).toContain('Skipped 2 feats and 1 source you already have — yours are unchanged.');
    expect(actionLabels()).toEqual(['Done']);
    expect(loadRevived()).toEqual(revived);
    expect(onChanged).not.toHaveBeenCalled();
    await closeNotice(r);
    r.stop();

    localStorage.clear(); // another device
    const fresh = renderDom(page(EMPTY, onChanged));
    await importText(fresh, text);
    expect(dialog()?.textContent).toContain('Homebrew imported');
    expect(dialog()?.textContent).toContain('Added 2 feats and 1 source.');
    expect(loadHomebrewSources()[SYN_SRC.id]).toMatchObject(SYN_SRC);
    expect(loadHomebrewContent().feats[SYN_A.id]).toMatchObject(SYN_A);
    expect(loadHomebrewContent().feats[SYN_B.id]).toMatchObject(SYN_B);
    expect(onChanged).toHaveBeenCalled();
    expect(find(fresh.host, '.settings-navitem', 'Synthetic Forge')).not.toBeNull();
    await closeNotice(fresh);
    fresh.stop();
  });

  it('importing an OLDER export never overwrites a later edit and never brings back a deletion', async () => {
    seedOwn(SYN_A, SYN_B);
    const old = await exportedText();
    // Since that export the player edited A, deleted B and renamed the source.
    saveHomebrewEntry('feats', { ...SYN_A, name: 'Glass Anvil Stance (revised)' } as never);
    deleteHomebrewEntry('feats', SYN_B.id);
    saveHomebrewSource({ ...SYN_SRC, name: 'Synthetic Forge, mine' });
    const content = localStorage.getItem(CONTENT_KEY);
    const sources = localStorage.getItem(SOURCES_KEY);
    const revived = loadRevived();
    const tombs = loadTombstones();

    const onChanged = vi.fn();
    const r = renderDom(page(EMPTY, onChanged));
    await importText(r, old);
    // MUTATION PROOF (both tried 2026-10-01): drop `if (haveContent[type][id]) { … continue; }` from
    // mergeHomebrewImport and the edit is replaced —
    //   AssertionError: expected 'Glass Anvil Stance' to be 'Glass Anvil Stance (revised)'
    // make `deletedHere` answer false and the deleted entry comes back —
    //   AssertionError: expected { id: 'syn-ember-step', …(2) } to be undefined
    expect((loadHomebrewContent().feats[SYN_A.id] as unknown as { name: string }).name).toBe('Glass Anvil Stance (revised)');
    expect(loadHomebrewContent().feats[SYN_B.id]).toBeUndefined();
    expect(loadHomebrewSources()[SYN_SRC.id].name).toBe('Synthetic Forge, mine');
    expect(localStorage.getItem(CONTENT_KEY)).toBe(content);
    expect(localStorage.getItem(SOURCES_KEY)).toBe(sources);
    expect(loadRevived()).toEqual(revived);
    expect(loadTombstones()).toEqual(tombs);
    expect(onChanged).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('Nothing new to import');
    expect(dialog()?.textContent).toContain('Skipped 1 feat and 1 source you already have — yours are unchanged.');
    expect(dialog()?.textContent).toContain('Left out 1 feat you deleted.');
    await closeNotice(r);
    r.stop();
  });

  it('a source the player deleted stays deleted, with every entry of it the file carries', async () => {
    seedOwn(SYN_A);
    const old = await exportedText();
    deleteHomebrewSource(SYN_SRC.id); // deletes A with it
    // The file also carries an entry of that source this device never held.
    const withNew = JSON.parse(old);
    withNew.content.feats[SYN_B.id] = SYN_B;
    const revived = loadRevived();

    const r = renderDom(page());
    await importText(r, JSON.stringify(withNew));
    // MUTATION PROOF (tried 2026-10-01): drop `deletedHere(`hbsrc:${sid}`)` from mergeHomebrewImport's
    // entry check and B lands, filed under a source that no longer exists —
    //   AssertionError: expected { id: 'syn-ember-step', …(2) } to be undefined
    expect(loadHomebrewSources()[SYN_SRC.id]).toBeUndefined();
    expect(loadHomebrewContent().feats[SYN_A.id]).toBeUndefined();
    expect(loadHomebrewContent().feats[SYN_B.id]).toBeUndefined();
    expect(loadRevived()).toEqual(revived);
    expect(dialog()?.textContent).toContain('Nothing new to import');
    expect(dialog()?.textContent).toContain('Left out 2 feats and 1 source you deleted.');
    await closeNotice(r);
    r.stop();
  });

  it('a full "Export everything" backup file imports ONLY its homebrew', async () => {
    seedOwn(SYN_A);
    localStorage.setItem('wanderers-codex:roster:v1', '[{"id":"c-syn-then","character":{"name":"Synthetic Then"}}]');
    localStorage.setItem('pf2e-codex.prefs', '{"compactActions":true}');
    const backup = createBackup();
    localStorage.clear(); // another device, with its own character
    const here = '[{"id":"c-syn-here","character":{"name":"Synthetic Here"}}]';
    localStorage.setItem('wanderers-codex:roster:v1', here);

    const r = renderDom(page());
    await importText(r, backup);
    // MUTATION PROOF (tried 2026-10-01): drop readHomebrewFile's full-backup branch and this file (no
    // top-level sources/content) is refused — expected 'Couldn't importThat file…' to contain 'Homebrew imported'.
    expect(dialog()?.textContent).toContain('Homebrew imported');
    expect(dialog()?.textContent).toContain('Added 1 feat and 1 source.');
    expect(dialog()?.textContent).toContain('Only the homebrew in this backup was read; nothing else on this device changed.');
    expect(loadHomebrewSources()[SYN_SRC.id]).toMatchObject(SYN_SRC);
    expect(loadHomebrewContent().feats[SYN_A.id]).toMatchObject(SYN_A);
    expect(localStorage.getItem('wanderers-codex:roster:v1')).toBe(here);
    expect(localStorage.getItem('pf2e-codex.prefs')).toBeNull();
    await closeNotice(r);
    r.stop();
  });

  it('the empty file every older export saved says so, and never sends the player to a Restore', async () => {
    seedOwn(SYN_A);
    const content = localStorage.getItem(CONTENT_KEY);
    const r = renderDom(page());
    await importText(r, 'heroes-heaven-homebrew.json');
    // MUTATION PROOF (tried 2026-10-01): drop the OLD_EMPTY_HOMEBREW_EXPORT check from readHomebrewFile
    // and this reads the generic notice — expected 'Couldn't importThat file…' to contain 'Nothing to import'.
    expect(dialog()?.textContent).toContain('Nothing to import');
    expect(dialog()?.textContent).toContain('older version of Heroes Heaven');
    expect(dialog()?.textContent).toContain('it holds no homebrew');
    expect(dialog()?.textContent).not.toMatch(/restore|settings/i);
    expect(actionLabels()).toEqual(['OK']);
    expect(localStorage.getItem(CONTENT_KEY)).toBe(content);
    await closeNotice(r);
    r.stop();
  });

  it('an entry filed under a source the player deleted stays out even when the file leaves that source out', async () => {
    saveHomebrewSource({ id: 'hbsrc-syn-del', name: 'Synthetic Gone' });
    deleteHomebrewSource('hbsrc-syn-del');
    const content = localStorage.getItem(CONTENT_KEY);
    const revived = loadRevived();
    const file = {
      app: 'heroes-heaven',
      kind: 'homebrew',
      version: 1,
      sources: {},
      content: { feats: { 'syn-orphan': { id: 'syn-orphan', name: 'Synthetic Orphan', homebrewSourceId: 'hbsrc-syn-del' } } },
    };
    const r = renderDom(page());
    await importText(r, JSON.stringify(file));
    // MUTATION PROOF (tried 2026-10-01): drop `deletedHere(`hbsrc:${sid}`)` from mergeHomebrewImport's
    // entry check and the orphan lands under the deleted source —
    //   AssertionError: expected { id: 'syn-orphan', …(2) } to be undefined
    expect(loadHomebrewContent().feats['syn-orphan']).toBeUndefined();
    expect(localStorage.getItem(CONTENT_KEY)).toBe(content);
    expect(loadRevived()).toEqual(revived);
    expect(dialog()?.textContent).toContain('Nothing new to import');
    expect(dialog()?.textContent).toContain('Left out 1 feat you deleted.');
    await closeNotice(r);
    r.stop();
  });

  it("a GM's file never lands over what a campaign already shares with this device", async () => {
    // A GM's own Homebrew export carries the very ids her campaign shares. An own copy under one of them
    // sits ON TOP of her live copy for good (data/index.ts mergeWithSeed, own = layer 3).
    seedCampaign(); // campaign source gm-src holding items.gm-crown and feats.gm-decree
    saveHomebrewSource(SYN_SRC);
    const content = localStorage.getItem(CONTENT_KEY);
    const sources = localStorage.getItem(SOURCES_KEY);
    const revived = loadRevived();
    const file = {
      app: 'heroes-heaven',
      kind: 'homebrew',
      version: 1,
      sources: { 'gm-src': { id: 'gm-src', name: 'Kingdom Gear (old file)' } },
      content: {
        // the same id and source as the campaign's copy
        feats: {
          'gm-decree': { id: 'gm-decree', name: 'Royal Decree (old file)', homebrewSourceId: 'gm-src' },
          // the GM added it after this device's last pull: its id is new here, its source is the campaign's
          'gm-new-edict': { id: 'gm-new-edict', name: 'New Edict', homebrewSourceId: 'gm-src' },
        },
        // a campaign's id, filed under one of the player's own sources
        items: { 'gm-crown': { id: 'gm-crown', name: 'Crown of Ash (old file)', homebrewSourceId: SYN_SRC.id } },
      },
    };
    const onChanged = vi.fn();
    const r = renderDom(page(EMPTY, onChanged));
    await importText(r, JSON.stringify(file));
    // MUTATION PROOF (each tried 2026-10-01) in mergeHomebrewImport —
    //   drop `campaignSources.has(src.id) ||` (sources loop): gm-src is written as the player's own —
    //     AssertionError: expected '{"hbsrc-syn-1":{"id":"hbsrc-syn-1","n…' to be '{"hbsrc-syn-1":{"id":"hbsrc-syn-1","n…'
    //   drop `campaignHolds(type, id) ||`: gm-crown is written —
    //     AssertionError: expected '{"items":{"gm-crown":{"id":"gm-crown"…' to be null
    //   drop the `campaignSources.has(sid) && !haveSources[sid]` clause: gm-new-edict is written —
    //     AssertionError: expected '{"items":{},"feats":{"gm-new-edict":{…' to be null
    expect(localStorage.getItem(SOURCES_KEY)).toBe(sources);
    expect(localStorage.getItem(CONTENT_KEY)).toBe(content);
    expect(loadRevived()).toEqual(revived);
    expect(onChanged).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('Nothing new to import');
    expect(dialog()?.textContent).toContain('Skipped 3 entries and 1 source a campaign already shares with you.');
    await closeNotice(r);
    r.stop();
  });

  describe('a full storage', () => {
    /** Make every write the predicate picks fail as a full device does; the rest still write. */
    function failWritesWhere(full: (key: string, value: string) => boolean) {
      const real = Storage.prototype.setItem;
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
        if (full(k, v)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return real.call(this, k, v);
      });
      return () => spy.mockRestore();
    }
    /** Make every write of these storage keys fail as a full device does; the rest still write. */
    const failWrites = (...keys: string[]) => failWritesWhere((k) => keys.includes(k));
    const fileOf = () =>
      JSON.stringify({ app: 'heroes-heaven', kind: 'homebrew', version: 1, sources: { [SYN_SRC.id]: SYN_SRC }, content: { feats: { [SYN_A.id]: SYN_A } } });

    it('a source that could not be saved is not counted, and its entries are not written', async () => {
      const onChanged = vi.fn();
      const r = renderDom(page(EMPTY, onChanged));
      const restore = failWrites(SOURCES_KEY);
      try {
        await importText(r, fileOf());
      } finally {
        restore();
      }
      // MUTATION PROOF (each tried 2026-10-01) in mergeHomebrewImport — count every written source as
      // added (no on-disk check), or drop `if (sid !== undefined && failedSources.has(sid)) { … }`: either
      // way the feat lands, filed under a source that is not there —
      //   AssertionError: expected { id: 'syn-glass-anvil', …(2) } to be undefined
      expect(loadHomebrewSources()[SYN_SRC.id]).toBeUndefined();
      expect(loadHomebrewContent().feats[SYN_A.id]).toBeUndefined();
      expect(dialog()?.textContent).toContain('Import incomplete');
      expect(dialog()?.textContent).not.toContain('Added');
      expect(dialog()?.textContent).toContain("2 couldn't be saved — this device's storage is full.");
      expect(dialog()?.textContent).not.toContain('Enable their source');
      expect(onChanged).not.toHaveBeenCalled();
      await closeNotice(r);
      r.stop();
    });

    it('an entry that could not be saved is not counted as added', async () => {
      const onChanged = vi.fn();
      const r = renderDom(page(EMPTY, onChanged));
      const restore = failWrites(CONTENT_KEY);
      try {
        await importText(r, fileOf());
      } finally {
        restore();
      }
      // MUTATION PROOF (tried 2026-10-01): count every written entry as added (no on-disk check) —
      //   AssertionError: expected 'Homebrew importedAdded 1 feat and 1 s…' to contain 'Import incomplete'
      expect(loadHomebrewSources()[SYN_SRC.id]).toMatchObject(SYN_SRC);
      expect(loadHomebrewContent().feats[SYN_A.id]).toBeUndefined();
      expect(dialog()?.textContent).toContain('Import incomplete');
      expect(dialog()?.textContent).toContain('Added 1 source.');
      expect(dialog()?.textContent).not.toMatch(/Added \d+ (feat|item|entr)/);
      expect(dialog()?.textContent).toContain("1 couldn't be saved — this device's storage is full.");
      expect(onChanged).toHaveBeenCalled(); // the source did land
      await closeNotice(r);
      r.stop();
    });

    it('a kept list that could not be saved on the LAST step is counted as not saved', async () => {
      // Settle round 2: the closing "kept lists LAST" write swallows a full storage like every writer.
      // The source and its entry land first; only the write that carries the kept list fails here (the
      // bigger write, the one a filling device refuses).
      const KEPT = { id: 'hbsrc-kept-syn-full', name: 'Synthetic Full Hoard', kept: { from: 'Synthetic Marches', ids: ['feats:syn-full-1'] } };
      const FEAT = { id: 'syn-full-1', name: 'Synthetic Full One', homebrewSourceId: KEPT.id };
      const file = JSON.stringify({ app: 'heroes-heaven', kind: 'homebrew', version: 1, sources: { [KEPT.id]: KEPT }, content: { feats: { [FEAT.id]: FEAT } } });
      const onChanged = vi.fn();
      const r = renderDom(page(EMPTY, onChanged));
      const restore = failWritesWhere((k, v) => k === SOURCES_KEY && v.includes('"kept"'));
      try {
        await importText(r, file);
      } finally {
        restore();
      }
      // MUTATION PROOF (tried 2026-10-01): replace the closing loop's
      // `if (JSON.stringify(loadHomebrewSources()[id]) !== JSON.stringify(want)) out.failed++;` with `void want;` —
      //   AssertionError: expected 'Homebrew importedAdded 1 feat and 1 s…' to contain 'Import incomplete'
      expect(loadHomebrewSources()[KEPT.id]).toEqual({ id: KEPT.id, name: KEPT.name }); // landed, without its list
      expect(loadHomebrewContent().feats[FEAT.id]).toMatchObject(FEAT);
      expect(dialog()?.textContent).toContain('Import incomplete');
      expect(dialog()?.textContent).toContain('Added 1 feat and 1 source.');
      expect(dialog()?.textContent).toContain("1 couldn't be saved — this device's storage is full.");
      expect(onChanged).toHaveBeenCalled();
      await closeNotice(r);
      r.stop();
    });
  });

  it("a backup from a newer version says to update the app, not that it isn't a backup", async () => {
    seedOwn(SYN_A);
    const env = JSON.parse(createBackup());
    env.formatVersion = 99;
    localStorage.clear();
    const r = renderDom(page());
    await importText(r, JSON.stringify(env));
    // MUTATION PROOF (tried 2026-10-01): show the generic text for every read error in onImportFile —
    //   AssertionError: expected 'Couldn't importThat file isn't a He…' to contain 'This backup uses format version 99'
    expect(dialog()?.textContent).toContain("Couldn't import");
    expect(dialog()?.textContent).toContain('This backup uses format version 99');
    expect(dialog()?.textContent).toContain('Update the app, then try again.');
    expect(dialog()?.textContent).not.toContain("isn't a Heroes Heaven homebrew export or backup");
    expect(actionLabels()).toEqual(['OK']);
    expect(loadHomebrewContent().feats[SYN_A.id]).toBeUndefined();
    await closeNotice(r);
    r.stop();
  });

  it('the Import picker still offers .json files, so the dated export is pickable', () => {
    const r = renderDom(page());
    const accept = (r.host.querySelector('input[type=file]') as HTMLInputElement).accept.split(',');
    expect(accept).toContain('.json');
    r.stop();
  });

  /* ---- Settle round (2026-10-01): refuter + browser findings on the import above ---------------- */

  const exportOf = (sources: Record<string, unknown>, content: Record<string, Record<string, unknown>>) =>
    JSON.stringify({ app: 'heroes-heaven', kind: 'homebrew', version: 1, sources, content });

  it('a file carrying a KEPT campaign source lands with its kept list whole, and a kept source here keeps its own', async () => {
    // Kept from a campaign: these entries sit UNDER the GM's live copy if he shares it again (data/index.ts
    // layer 1). saveHomebrewEntry reads a write into a kept source as the player editing that entry and
    // strips it off the list — so with the source written BEFORE its entries, the list ended empty.
    const KEPT = { id: 'hbsrc-kept-syn-gm', name: 'Synthetic Hoard', kept: { from: 'Synthetic Marches', ids: ['items:syn-k-ring', 'feats:syn-k-oath'] } };
    // This device's own kept source, whose list names an entry the device does not hold (and never deleted).
    const HERE = 'hbsrc-kept-syn-here';
    saveHomebrewEntry('feats', { id: 'syn-h-a', name: 'Here A', homebrewSourceId: HERE } as never);
    saveHomebrewSource({ id: HERE, name: 'Kept Here', kept: { from: 'Synthetic Marches', ids: ['feats:syn-h-a', 'feats:syn-h-b'] } });
    const hereBefore = loadHomebrewSources()[HERE];
    const file = exportOf(
      { [KEPT.id]: KEPT, [HERE]: { ...hereBefore, name: 'Kept Here (old file)' } },
      {
        items: { 'syn-k-ring': { id: 'syn-k-ring', name: 'Synthetic Ring', homebrewSourceId: KEPT.id } },
        feats: {
          'syn-k-oath': { id: 'syn-k-oath', name: 'Synthetic Oath', homebrewSourceId: KEPT.id },
          'syn-h-b': { id: 'syn-h-b', name: 'Here B', homebrewSourceId: HERE },
        },
      },
    );
    const r = renderDom(page());
    await importText(r, file);
    // MUTATION PROOF (both tried 2026-10-01) in mergeHomebrewImport —
    //   delete the closing "kept lists LAST" loop: the source lands with no kept list —
    //     AssertionError: expected { id: 'hbsrc-kept-syn-gm', …(1) } to deeply equal { id: 'hbsrc-kept-syn-gm', …(2) }
    //   the old order (the file's source written whole BEFORE its entries, that loop gone): the entry saves
    //   strip the list to [] —
    //     AssertionError: expected { id: 'hbsrc-kept-syn-gm', …(2) } to deeply equal { id: 'hbsrc-kept-syn-gm', …(2) }
    expect(loadHomebrewSources()[KEPT.id]).toEqual(KEPT);
    expect(loadHomebrewSources()[HERE]).toEqual(hereBefore);
    expect(loadHomebrewContent().items['syn-k-ring']).toMatchObject({ name: 'Synthetic Ring', homebrewSourceId: KEPT.id });
    expect(loadHomebrewContent().feats['syn-k-oath']).toMatchObject({ name: 'Synthetic Oath', homebrewSourceId: KEPT.id });
    expect(loadHomebrewContent().feats['syn-h-b']).toMatchObject({ name: 'Here B' });
    // Mixed types count as entries.
    expect(dialog()?.textContent).toContain('Homebrew imported');
    expect(dialog()?.textContent).toContain('Added 3 entries and 1 source.');
    await closeNotice(r);
    r.stop();
  });

  it("a file's kept list never names an entry the player already holds under that source; a malformed one is left off", async () => {
    // An entry filed under a source this device does not hold — a conversion that stopped before its
    // source line (data/campaignHomebrew.ts convertGone, a full storage). It is the player's: layer 3.
    const ORPH = 'hbsrc-kept-syn-o';
    saveHomebrewEntry('feats', { id: 'syn-o-mine', name: 'Mine, edited', homebrewSourceId: ORPH } as never);
    const mine = loadHomebrewContent().feats['syn-o-mine'];
    const file = exportOf(
      {
        [ORPH]: { id: ORPH, name: 'Synthetic Orphanage', kept: { from: 'Synthetic Marches', ids: ['feats:syn-o-mine', 'feats:syn-o-new'] } },
        // A hand-made file: `ids` is not a list. Written as is, the entry save below throws inside the import.
        'hbsrc-syn-bad': { id: 'hbsrc-syn-bad', name: 'Synthetic Bad', kept: { from: 'Synthetic Marches', ids: 'feats:syn-bad-1' } },
      },
      {
        feats: {
          'syn-o-mine': { id: 'syn-o-mine', name: 'Mine, as the file has it', homebrewSourceId: ORPH },
          'syn-o-new': { id: 'syn-o-new', name: 'Synthetic Newcomer', homebrewSourceId: ORPH },
          'syn-bad-1': { id: 'syn-bad-1', name: 'Synthetic Bad One', homebrewSourceId: 'hbsrc-syn-bad' },
        },
      },
    );
    const r = renderDom(page());
    await importText(r, file);
    // MUTATION PROOF (each tried 2026-10-01) in mergeHomebrewImport —
    //   keep every kept key (the `held?.homebrewSourceId !== src.id` filter always true): the player's own
    //   entry would sit under a GM's live copy (ids ['feats:syn-o-mine', 'feats:syn-o-new']) —
    //     AssertionError: expected { from: 'Synthetic Marches', …(1) } to deeply equal { from: 'Synthetic Marches', …(1) }
    //   write a malformed kept list as is (`else write = src`): the import throws part-way —
    //     TypeError: src.kept.ids.filter is not a function   (storage.ts saveHomebrewEntry, unhandled)
    //     AssertionError: expected undefined to deeply equal { from: 'Synthetic Marches', …(1) }
    expect(loadHomebrewSources()[ORPH].kept).toEqual({ from: 'Synthetic Marches', ids: ['feats:syn-o-new'] });
    expect(loadHomebrewContent().feats['syn-o-mine']).toEqual(mine);
    expect(loadHomebrewSources()['hbsrc-syn-bad']).toEqual({ id: 'hbsrc-syn-bad', name: 'Synthetic Bad' });
    expect(loadHomebrewContent().feats['syn-bad-1']).toMatchObject({ name: 'Synthetic Bad One' });
    expect(dialog()?.textContent).toContain('Added 2 feats and 2 sources.');
    await closeNotice(r);
    r.stop();
  });

  it('the notice counts what it added by its real noun', async () => {
    const SRC = { [SYN_SRC.id]: SYN_SRC };
    const entry = (id: string) => ({ id, name: `Synthetic ${id}`, homebrewSourceId: SYN_SRC.id });
    const cases: [Record<string, Record<string, unknown>>, string][] = [
      [{ feats: { 'syn-f1': entry('syn-f1') } }, 'Added 1 feat and 1 source.'],
      [{ spells: { 'syn-s1': entry('syn-s1'), 'syn-s2': entry('syn-s2') } }, 'Added 2 spells and 1 source.'],
      [{ ancestries: { 'syn-a1': entry('syn-a1') } }, 'Added 1 ancestry and 1 source.'],
      [{ deities: { 'syn-d1': entry('syn-d1'), 'syn-d2': entry('syn-d2') } }, 'Added 2 deities and 1 source.'],
      [{ feats: { 'syn-f1': entry('syn-f1') }, items: { 'syn-i1': entry('syn-i1') }, actions: { 'syn-x1': entry('syn-x1') } }, 'Added 3 entries and 1 source.'],
    ];
    for (const [content, says] of cases) {
      localStorage.clear();
      const r = renderDom(page());
      await importText(r, exportOf(SRC, content));
      // MUTATION PROOF (tried 2026-10-01): count every type as 'item' in `counted` (was addedEntries) —
      //   AssertionError: expected 'Homebrew importedAdded 1 item and 1 s…' to contain 'Added 1 feat and 1 source.'
      expect(dialog()?.textContent).toContain('Homebrew imported');
      expect(dialog()?.textContent).toContain(says);
      await closeNotice(r);
      r.stop();
    }
    // Only a source: no entry count at all.
    localStorage.clear();
    const r = renderDom(page());
    await importText(r, exportOf(SRC, {}));
    expect(dialog()?.textContent).toContain('Added 1 source.');
    await closeNotice(r);
    r.stop();
  });

  it('an import that adds nothing says so in its title', async () => {
    // An empty export, and one whose homebrew this device already holds.
    const r = renderDom(page());
    await importText(r, exportOf({}, {}));
    // MUTATION PROOF (tried 2026-10-01): title every failure-free import 'Homebrew imported' —
    //   AssertionError: expected 'Homebrew importedThat file holds no h…' to contain 'Nothing new to import'
    expect(dialog()?.textContent).toContain('Nothing new to import');
    expect(dialog()?.textContent).toContain('That file holds no homebrew.');
    expect(dialog()?.textContent).not.toContain('Homebrew imported');
    expect(actionLabels()).toEqual(['Done']);
    await closeNotice(r);
    r.stop();
  });

  /* ---- Settle round 2 (2026-10-01) ------------------------------------------------------------------ */

  it('a file whose only homebrew is a SOURCE skipped here says what it skipped, never "holds no homebrew"', async () => {
    // The refuter's probe: a source this device holds, deleted, or gets from a campaign was skipped
    // without a count, so the body fell back to "That file holds no homebrew." — false.
    const only = exportOf({ [SYN_SRC.id]: SYN_SRC }, {});
    const cases: [setup: () => void, says: string][] = [
      [() => saveHomebrewSource(SYN_SRC), 'Skipped 1 source you already have — yours are unchanged.'],
      [
        () => {
          saveHomebrewSource(SYN_SRC);
          deleteHomebrewSource(SYN_SRC.id);
        },
        'Left out 1 source you deleted.',
      ],
      [
        () => {
          saveSyncOwner(UID);
          saveCampaignHbCache(UID, { 'camp-syn': { name: 'Synthetic Marches', sources: { [SYN_SRC.id]: SYN_SRC }, content: {}, updatedAt: '' } });
        },
        'Skipped 1 source a campaign already shares with you.',
      ],
    ];
    for (const [setup, says] of cases) {
      localStorage.clear();
      setup();
      const sources = localStorage.getItem(SOURCES_KEY);
      const r = renderDom(page());
      await importText(r, only);
      // MUTATION PROOF (each tried 2026-10-01) in mergeHomebrewImport's sources loop, the count dropped
      // (a bare `continue`) —
      //   `out.have.sources++`:    AssertionError: expected 'Nothing new to importThat file holds …' to contain 'Skipped 1 source you already have — y…'
      //   `out.deleted.sources++`: AssertionError: expected 'Nothing new to importThat file holds …' to contain 'Left out 1 source you deleted.'
      //   `out.shared.sources++`:  AssertionError: expected 'Nothing new to importThat file holds …' to contain 'Skipped 1 source a campaign already s…'
      expect(dialog()?.textContent).toContain('Nothing new to import');
      expect(dialog()?.textContent).toContain(says);
      expect(dialog()?.textContent).not.toContain('holds no homebrew');
      expect(localStorage.getItem(SOURCES_KEY)).toBe(sources);
      await closeNotice(r);
      r.stop();
    }
  });

  it('records this version cannot read are counted as left out, never "holds no homebrew"', async () => {
    // A newer version's type, an entry with no id, a source with no id.
    const file = exportOf(
      { 'hbsrc-syn-noid': { name: 'Synthetic Nameless' } },
      { 'syn-future-type': { 'syn-f1': { id: 'syn-f1', name: 'Synthetic Future' } }, feats: { 'syn-noid': { name: 'Synthetic No Id' } } },
    );
    const r = renderDom(page());
    await importText(r, file);
    // MUTATION PROOF (each tried 2026-10-01) in mergeHomebrewImport: drop the unknown-type bucket count,
    // or the entry loop's `out.unread++` —
    //   AssertionError: expected 'Nothing new to importLeft out 2 that …' to contain 'Left out 3 that couldn\'t be read.'
    expect(dialog()?.textContent).toContain('Nothing new to import');
    expect(dialog()?.textContent).toContain("Left out 3 that couldn't be read.");
    expect(dialog()?.textContent).not.toContain('holds no homebrew');
    expect(loadHomebrewSources()).toEqual({});
    expect(HOMEBREW_TYPES.every((t) => Object.keys(loadHomebrewContent()[t]).length === 0)).toBe(true);
    await closeNotice(r);
    r.stop();
  });

  it("the sheet's own Wanderer's Guide character export is not a homebrew export: refused, nothing written", async () => {
    seedOwn(SYN_A);
    const content = localStorage.getItem(CONTENT_KEY);
    const sources = localStorage.getItem(SOURCES_KEY);
    // The shape src/data/transfer.ts exportWg writes — { version, character, content } — whose top-level
    // `content` object used to read as a homebrew export ("Homebrew imported — Added 0").
    const wg = {
      version: 4,
      character: { name: 'Synthetic Wanderer', level: 1, inventory: { coins: {}, items: [] } },
      content: { _README: 'Exported from Heroes Heaven.', ancestry: 'Human', level: 1, spells: ['Shield'], feats_features: [{ name: 'Toughness', level: 1 }] },
    };
    const onChanged = vi.fn();
    const r = renderDom(page(EMPTY, onChanged));
    await importText(r, JSON.stringify(wg, null, 2));
    // MUTATION PROOF (tried 2026-10-01; re-tried in settle round 2, which counts records it can't read) —
    // drop readHomebrewFile's `obj.kind !== HOMEBREW_EXPORT_KIND` check —
    //   AssertionError: expected 'Nothing new to importLeft out 2 that …' to contain 'Couldn\'t import'
    expect(dialog()?.textContent).toContain("Couldn't import");
    expect(dialog()?.textContent).toContain("That file isn't a Heroes Heaven homebrew export or backup.");
    expect(actionLabels()).toEqual(['OK']);
    expect(localStorage.getItem(CONTENT_KEY)).toBe(content);
    expect(localStorage.getItem(SOURCES_KEY)).toBe(sources);
    expect(onChanged).not.toHaveBeenCalled();
    await closeNotice(r);
    r.stop();
  });

  /* ---- Settle round 5 (2026-10-01) ------------------------------------------------------------------ */

  it('a hand-made file carrying one source id under two keys keeps the first copy and skips the second — never "storage is full"', async () => {
    // The refuter's probe P-B: the second copy was written over the first (the sources loop judged it
    // against what the device held BEFORE the import), and the on-disk check then counted the first as a
    // copy the storage refused — "Import incomplete … 1 couldn't be saved — this device's storage is full."
    // App-made exports key sources by id, so only a hand-edited file gets here.
    const DUP = 'hbsrc-syn-dup';
    const FEAT = { id: 'syn-dup-feat', name: 'Synthetic Twin Step', homebrewSourceId: DUP };
    const file = exportOf({ first: { id: DUP, name: 'Synthetic Twin A' }, second: { id: DUP, name: 'Synthetic Twin B' } }, { feats: { [FEAT.id]: FEAT } });
    const onChanged = vi.fn();
    const r = renderDom(page(EMPTY, onChanged));
    await importText(r, file);
    // MUTATION PROOF (tried 2026-10-01, round 5): drop `haveSources[src.id] = write;` from mergeHomebrewImport's
    // sources loop — the second copy lands over the first, and the feat is held back with it —
    //   AssertionError: expected 'Import incompleteAdded 1 source. 2 co…' to contain 'Homebrew imported'
    expect(dialog()?.textContent).toContain('Homebrew imported');
    expect(dialog()?.textContent).toContain('Added 1 feat and 1 source.');
    expect(dialog()?.textContent).toContain('Skipped 1 source you already have — yours are unchanged.');
    expect(dialog()?.textContent).not.toContain("couldn't be saved");
    expect(loadHomebrewSources()[DUP]).toEqual({ id: DUP, name: 'Synthetic Twin A' });
    expect(loadHomebrewContent().feats[FEAT.id]).toMatchObject(FEAT);
    expect(onChanged).toHaveBeenCalled();
    await closeNotice(r);
    r.stop();
  });

  describe('while this device does not know the campaign homebrew (owner ruling: UNKNOWN ≠ EMPTY)', () => {
    // loadCampaignHbCache reads {} for "never pulled here" exactly as for "pulled, nothing shared", and
    // the import's never-write-over-a-campaign check can only trust the second. Ruling update
    // (2026-10-01): while it is unknown the import TRIES A PULL NOW, and refuses only if it is still
    // unknown afterwards. It never imports while unknown.
    const PLAYER = { id: 'camp-syn-1', code: 'SYN234', role: 'player' as const, name: 'Synthetic Marches' };
    const fileOf = () => exportOf({ [SYN_SRC.id]: SYN_SRC }, { feats: { [SYN_A.id]: SYN_A } });
    const REFUSED =
      "Your campaign homebrew couldn't be read on this device yet. Try again when you're online. If it keeps failing, ask your GM to check the campaign setup.";

    /** Import fileOf(): refused with the one-button notice saying `says` (and never `never`), and nothing
     *  on disk changed. */
    async function expectRefused(why: string, says = REFUSED, never?: string) {
      const content = localStorage.getItem(CONTENT_KEY);
      const sources = localStorage.getItem(SOURCES_KEY);
      const revived = loadRevived();
      const onChanged = vi.fn();
      const r = renderDom(page(EMPTY, onChanged));
      await importText(r, fileOf());
      expect(dialog()?.textContent, why).toContain("Can't import yet");
      expect(dialog()?.textContent, why).toContain(says);
      if (never) expect(dialog()?.textContent, why).not.toContain(never);
      expect(actionLabels(), why).toEqual(['OK']);
      expect(localStorage.getItem(CONTENT_KEY), why).toBe(content);
      expect(localStorage.getItem(SOURCES_KEY), why).toBe(sources);
      expect(loadRevived(), why).toEqual(revived);
      expect(onChanged, why).not.toHaveBeenCalled();
      await closeNotice(r);
      r.stop();
    }
    /** Import fileOf(): it lands. */
    async function expectImported(why: string) {
      const r = renderDom(page());
      await importText(r, fileOf());
      expect(dialog()?.textContent, why).toContain('Homebrew imported');
      expect(dialog()?.textContent, why).toContain('Added 1 feat and 1 source.');
      expect(loadHomebrewContent().feats[SYN_A.id], why).toMatchObject(SYN_A);
      await closeNotice(r);
      r.stop();
    }

    it('never read here for this account: a pull is tried first, and while it does not land the import is refused and writes nothing', async () => {
      saveSyncOwner(UID);
      saveCampaigns([PLAYER]);
      // Unknown three ways: no copy at all, a copy pulled for ANOTHER account, a copy that cannot be read.
      for (const cache of [null, JSON.stringify({ uid: 'someone-else-uid', campaigns: {}, pulledFor: [PLAYER.id] }), '{not json']) {
        if (cache === null) localStorage.removeItem(CAMPAIGN_HB_CACHE_KEY);
        else localStorage.setItem(CAMPAIGN_HB_CACHE_KEY, cache);
        pull.fn.mockClear();
        // MUTATION PROOF (each tried 2026-10-01) —
        //   drop the refusal after the pull in onImportFile (`if (campaignHomebrewUnknown()) { … }` → never): imported —
        //     AssertionError: no copy: expected 'Homebrew importedAdded 1 feat and 1 s…' to contain 'Can\'t import yet'
        //   drop the stamp comparison from storage.ts campaignHbCacheKnown (`raw?.uid !== uid` → `!raw`): the
        //   other account's copy is trusted —
        //     AssertionError: another account's copy: expected 'Homebrew importedAdded 1 feat and 1 s…' to contain 'Can\'t import…'
        //   no pull at all (`await refreshCampaignHomebrew()` gone): AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
        await expectRefused(cache === null ? 'no copy' : cache.startsWith('{"') ? "another account's copy" : 'unreadable copy');
        expect(pull.fn).toHaveBeenCalledTimes(1);
      }
    });

    it('a pull that LANDS makes it known: the import goes through, judged against the copy just pulled', async () => {
      saveSyncOwner(UID);
      saveCampaigns([PLAYER]);
      // What the pull writes (data/campaignHomebrew.ts pullOnce → saveCampaignHbCache): this account's
      // copy, in which the campaign shares one of the file's feats.
      const GM_FEAT = { id: 'syn-gm-shared', name: 'Synthetic GM Feat', homebrewSourceId: 'hbsrc-syn-gm' };
      pull.fn.mockImplementationOnce(async () => {
        saveCampaignHbCache(
          UID,
          {
            [PLAYER.id]: {
              name: PLAYER.name,
              sources: { 'hbsrc-syn-gm': { id: 'hbsrc-syn-gm', name: 'Synthetic GM Book' } },
              content: { feats: { [GM_FEAT.id]: GM_FEAT } } as unknown as CampaignHbCampaign['content'],
              updatedAt: '2026-10-01T10:00:00.000Z',
            },
          },
          [PLAYER.id],
        );
        return true;
      });
      const r = renderDom(page());
      await importText(r, exportOf({ [SYN_SRC.id]: SYN_SRC }, { feats: { [SYN_A.id]: SYN_A, [GM_FEAT.id]: GM_FEAT } }));
      // MUTATION PROOF (tried 2026-10-01): drop `await refreshCampaignHomebrew();` from onImportFile —
      //   AssertionError: expected 'Can\'t import yetYour campaign homebr…' to contain 'Homebrew imported'
      expect(dialog()?.textContent).toContain('Homebrew imported');
      expect(dialog()?.textContent).toContain('Added 1 feat and 1 source.');
      expect(dialog()?.textContent).toContain('Skipped 1 feat a campaign already shares with you.');
      expect(loadHomebrewContent().feats[SYN_A.id]).toMatchObject(SYN_A);
      expect(loadHomebrewContent().feats[GM_FEAT.id]).toBeUndefined();
      expect(pull.fn).toHaveBeenCalledTimes(1);
      await closeNotice(r);
      r.stop();
    });

    it('a pull that fails, throws, or lands for another account leaves it unknown: refused, nothing written', async () => {
      saveSyncOwner(UID);
      saveCampaigns([PLAYER]);
      const passes: [why: string, arm: () => void][] = [
        ['the pull read nothing', () => pull.fn.mockResolvedValueOnce(false)],
        ['the pull threw', () => pull.fn.mockRejectedValueOnce(new Error('The server did not answer.'))],
        [
          'the pull wrote another account’s copy',
          () =>
            pull.fn.mockImplementationOnce(async () => {
              saveCampaignHbCache('someone-else-uid', {}, [PLAYER.id]);
              return true;
            }),
        ],
      ];
      for (const [why, arm] of passes) {
        localStorage.removeItem(CAMPAIGN_HB_CACHE_KEY);
        pull.fn.mockClear();
        arm();
        // MUTATION PROOF (each tried 2026-10-01) in onImportFile —
        //   trust the pull's answer instead of re-checking (`landed = await refreshCampaignHomebrew(); if (!landed) refuse`) —
        //     AssertionError: the pull wrote another account’s copy: expected 'Homebrew importedAdded 1 feat and 1 s…' to contain …
        //   drop the try/catch around the pull: the handler rejects, no notice opens (and Vitest reports an Unhandled Rejection) —
        //     AssertionError: the pull threw: the given combination of arguments (undefined and string) is invalid for this assertion
        //   no re-check at all (the refusal after the pull → never): AssertionError: the pull read nothing: expected 'Homebrew importedAdded 1 feat and 1 s…' to contain 'Can\'t import yet'
        await expectRefused(why);
        expect(pull.fn, why).toHaveBeenCalledTimes(1);
      }
    });

    it('a KNOWN copy for this account — even an empty one — lets the import through, with no pull to wait for', async () => {
      saveSyncOwner(UID);
      saveCampaigns([PLAYER]);
      saveCampaignHbCache(UID, {}, [PLAYER.id]); // pulled for this account: nothing shared
      // MUTATION PROOF (tried 2026-10-01): make campaignHomebrewUnknown answer `player` (no cache check) —
      //   AssertionError: known, empty: expected 'Can\'t import yetYour campaign homebr…' to contain 'Homebrew imported'
      await expectImported('known, empty');
      expect(pull.fn).not.toHaveBeenCalled();
    });

    it('with no player-role membership there is nothing to tell apart, so the import goes through', async () => {
      saveSyncOwner(UID);
      saveCampaigns([{ ...PLAYER, role: 'gm' }]); // the GM's own campaign: its homebrew is her own
      localStorage.removeItem(CAMPAIGN_HB_CACHE_KEY);
      // MUTATION PROOF (tried 2026-10-01): drop `player &&` from campaignHomebrewUnknown's answer —
      //   AssertionError: gm only: expected 'Can\'t import yetYour campaign homebr…' to contain 'Homebrew imported'
      await expectImported('gm only');
      expect(pull.fn).not.toHaveBeenCalled();
    });

    it('the signed-out Local table and a membership with no id are not campaigns a pull reads: the import goes through', async () => {
      // The ones storage.ts campaignMemberIds('player') — the ids a pull reads for — leaves out: `!m.local && !!m.id`.
      const passes: [string, CampaignMembership][] = [
        ['local table', { id: 'local', code: '', role: 'player', name: 'Local table', local: true }],
        ['no id', { ...PLAYER, id: '' }],
      ];
      for (const [why, membership] of passes) {
        localStorage.clear();
        saveSyncOwner(UID);
        saveCampaigns([membership]);
        // MUTATION PROOF (each tried 2026-10-01; re-tried in round 3, the filter now in storage.ts campaignMemberIds) —
        //   drop `!m.local &&`: AssertionError: local table: expected 'Can\'t import yetYour campaign homebr…' to contain 'Homebrew imported'
        //   drop `&& !!m.id`:   AssertionError: no id: expected 'Can\'t import yetYour campaign homebr…' to contain 'Homebrew imported'
        await expectImported(why);
        expect(pull.fn, why).not.toHaveBeenCalled();
      }
    });

    it('a copy stamped for this account but holding no campaigns object is UNKNOWN', async () => {
      saveSyncOwner(UID);
      saveCampaigns([PLAYER]);
      // Each copy vouches for PLAYER (pulledFor), so only its campaigns field can make it unknown.
      const passes: [string, string][] = [
        ['no campaigns', JSON.stringify({ uid: UID, pulledFor: [PLAYER.id] })],
        ['campaigns null', JSON.stringify({ uid: UID, campaigns: null, pulledFor: [PLAYER.id] })],
        ['campaigns not an object', JSON.stringify({ uid: UID, campaigns: 'synthetic', pulledFor: [PLAYER.id] })],
        ['campaigns an array', JSON.stringify({ uid: UID, campaigns: [], pulledFor: [PLAYER.id] })],
      ];
      for (const [why, cache] of passes) {
        localStorage.setItem(CAMPAIGN_HB_CACHE_KEY, cache);
        // MUTATION PROOF (each tried 2026-10-01, re-tried in round 3) in storage.ts campaignHbCacheKnown's campaigns check —
        //   drop the whole check:            AssertionError: no campaigns: expected 'Homebrew importedAdded 1 feat and 1 s…' to contain 'Can\'t import yet'
        //   drop `!c ||`:                    AssertionError: campaigns null: expected 'Homebrew importedAdded 1 feat and 1 s…' to contain 'Can\'t import yet'
        //   drop `typeof c !== 'object' ||`: AssertionError: campaigns not an object: expected 'Homebrew importedAdded 1 feat and 1 s…' to contain 'Can\'t import…'
        //   drop `|| Array.isArray(c)`:      AssertionError: campaigns an array: expected 'Homebrew importedAdded 1 feat and 1 s…' to contain 'Can\'t import…'
        await expectRefused(why);
      }
    });

    it('with no sync owner on this device it is UNKNOWN, even beside a copy stamped for no account', async () => {
      saveCampaigns([PLAYER]);
      for (const [why, cache] of [
        ['no copy', null],
        ['a copy stamped for no account', JSON.stringify({ uid: null, campaigns: {}, pulledFor: [PLAYER.id] })],
      ] as const) {
        if (cache === null) localStorage.removeItem(CAMPAIGN_HB_CACHE_KEY);
        else localStorage.setItem(CAMPAIGN_HB_CACHE_KEY, cache);
        // MUTATION PROOF (tried 2026-10-01): drop `uid === null ||` from storage.ts campaignHbCacheKnown —
        //   AssertionError: a copy stamped for no account: expected 'Homebrew importedAdded 1 feat and 1 s…' to contain 'Can\'t…'
        await expectRefused(why);
      }
    });

    /* ---- Settle round 3 (2026-10-01): a copy is known only for the campaigns it READ --------------- */

    const PLAYER2 = { id: 'camp-syn-2', code: 'SYN567', role: 'player' as const, name: 'Synthetic Hollows' };
    // What camp-syn-2's GM shares — and her own Homebrew export carries the very same ids.
    const GM2_SRC = { id: 'hbsrc-syn-gm2', name: 'Synthetic Hollows Book' };
    const GM2_FEAT = { id: 'syn-gm2-feat', name: 'Synthetic Hollow Step', homebrewSourceId: GM2_SRC.id };
    const gmFile = () => exportOf({ [SYN_SRC.id]: SYN_SRC, [GM2_SRC.id]: GM2_SRC }, { feats: { [SYN_A.id]: SYN_A, [GM2_FEAT.id]: GM2_FEAT } });

    it('a campaign joined after the last pull is UNKNOWN: a pull is tried, and the import goes only where it read the new campaign', async () => {
      // The refuter's case: the copy was pulled (and stamped) while the player was in camp-syn-1 only.
      saveSyncOwner(UID);
      saveCampaigns([PLAYER, PLAYER2]);
      // (a) the pull fails (offline): refused, nothing written — camp-syn-2's ids would have been written
      // as the player's own and sat on top of the GM's live copy for good.
      saveCampaignHbCache(UID, {}, [PLAYER.id]);
      // MUTATION PROOF (each tried 2026-10-01, round 3) —
      //   storage.ts campaignHbCacheKnown: `.every((id) => read.includes(id))` → `true` (the stamp alone):
      //     AssertionError: joined since, offline: expected 'Homebrew importedAdded 2 feats and 2 …' to contain 'Can\'t import yet'
      //   storage.ts campaignHbCacheKnown: drop `if (!Array.isArray(read)) return false;` — the next leg's older
      //   copy throws inside the check and no notice opens (a string list would read as covering):
      //     AssertionError: no read list (an older copy): the given combination of arguments (undefined and string) is invalid for this assertion
      const content = localStorage.getItem(CONTENT_KEY);
      const sources = localStorage.getItem(SOURCES_KEY);
      const r = renderDom(page());
      await importText(r, gmFile());
      expect(dialog()?.textContent, 'joined since, offline').toContain("Can't import yet");
      expect(pull.fn).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(CONTENT_KEY)).toBe(content);
      expect(localStorage.getItem(SOURCES_KEY)).toBe(sources);
      await closeNotice(r);

      // (b) the pull lands, reading BOTH campaigns: the new campaign's shared ids are skipped, the
      // player's own land.
      pull.fn.mockClear();
      pull.fn.mockImplementationOnce(async () => {
        saveCampaignHbCache(
          UID,
          {
            [PLAYER2.id]: {
              name: PLAYER2.name,
              sources: { [GM2_SRC.id]: GM2_SRC },
              content: { feats: { [GM2_FEAT.id]: GM2_FEAT } } as unknown as CampaignHbCampaign['content'],
              updatedAt: '2026-10-01T10:00:00.000Z',
            },
          },
          [PLAYER.id, PLAYER2.id],
        );
        return true;
      });
      await importText(r, gmFile());
      expect(pull.fn).toHaveBeenCalledTimes(1);
      expect(dialog()?.textContent).toContain('Homebrew imported');
      expect(dialog()?.textContent).toContain('Added 1 feat and 1 source.');
      expect(dialog()?.textContent).toContain('Skipped 1 feat and 1 source a campaign already shares with you.');
      expect(loadHomebrewContent().feats[SYN_A.id]).toMatchObject(SYN_A);
      expect(loadHomebrewContent().feats[GM2_FEAT.id]).toBeUndefined();
      expect(loadHomebrewSources()[GM2_SRC.id]).toBeUndefined();
      await closeNotice(r);
      r.stop();
    });

    it('a copy from before the read list, or with one that is not a list, vouches for no campaign', async () => {
      saveSyncOwner(UID);
      saveCampaigns([PLAYER]);
      for (const [why, cache] of [
        ['no read list (an older copy)', JSON.stringify({ uid: UID, campaigns: {} })],
        ['pulledFor a string', JSON.stringify({ uid: UID, campaigns: {}, pulledFor: PLAYER.id })],
      ] as const) {
        localStorage.setItem(CAMPAIGN_HB_CACHE_KEY, cache);
        pull.fn.mockClear();
        await expectRefused(why);
        expect(pull.fn, why).toHaveBeenCalledTimes(1);
      }
    });

    it('a campaign LEFT since the last pull still leaves the copy known: no pull to wait for', async () => {
      saveSyncOwner(UID);
      saveCampaigns([PLAYER]);
      saveCampaignHbCache(UID, {}, [PLAYER.id, 'camp-syn-left']);
      await expectImported('left one since');
      expect(pull.fn).not.toHaveBeenCalled();
    });

    it('while the import waits on the read the Import chip says so and takes no second file; it ends in ONE notice', async () => {
      saveSyncOwner(UID);
      saveCampaigns([PLAYER]);
      let land: () => void = () => undefined;
      pull.fn.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            land = () => {
              saveCampaignHbCache(UID, {}, [PLAYER.id]);
              resolve(true);
            };
          }),
      );
      const r = renderDom(page());
      await importText(r, fileOf());
      const chip = () => find(r.host, '.settings-nav .hb-io-row button', 'Import') as HTMLButtonElement;
      // MUTATION PROOF (each tried 2026-10-01, round 3) in HomebrewPage —
      //   never set `readingCampaigns` (drop `setReadingCampaigns(true);`): AssertionError: expected false to be true
      //   drop the second-pick guard (`|| importRun.current` in onImportFile): the second file starts its own
      //   import — AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times
      expect(dialog()).toBeNull();
      expect(chip().disabled).toBe(true);
      expect(chip().textContent).toContain('Importing…');
      expect(r.host.querySelector('[role=status]')?.textContent).toContain('Reading your campaign homebrew before importing…');
      await importText(r, fileOf()); // a second pick while it waits
      expect(pull.fn).toHaveBeenCalledTimes(1);
      expect(dialog()).toBeNull();
      await act(async () => land());
      await settle();
      expect(dialog()?.textContent).toContain('Homebrew imported');
      expect(dialog()?.textContent).toContain('Added 1 feat and 1 source.');
      await closeNotice(r); // and no second notice behind it
      expect(chip().disabled).toBe(false);
      expect(chip().textContent).not.toContain('Importing…');
      expect(r.host.querySelector('[role=status]')).toBeNull();
      r.stop();
    });

    it('closing the page while the import waits cancels it: nothing written, no notice over the next screen', async () => {
      saveSyncOwner(UID);
      saveCampaigns([PLAYER]);
      for (const [why, lands] of [
        ['the read lands after the close', true],
        ['the read fails after the close', false],
      ] as const) {
        localStorage.removeItem(CAMPAIGN_HB_CACHE_KEY);
        let finish: () => void = () => undefined;
        pull.fn.mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              finish = () => {
                if (lands) saveCampaignHbCache(UID, {}, [PLAYER.id]);
                resolve(lands);
              };
            }),
        );
        const content = localStorage.getItem(CONTENT_KEY);
        const sources = localStorage.getItem(SOURCES_KEY);
        const onChanged = vi.fn();
        const r = renderDom(page(EMPTY, onChanged));
        await importText(r, fileOf());
        r.stop(); // the player leaves the Homebrew page
        await act(async () => finish());
        await settle();
        // MUTATION PROOF (tried 2026-10-01, round 3): drop `if (!mounted.current) return;` after the pull —
        //   AssertionError: the read lands after the close: expected '{"items":{},"feats":{"syn-glass-anvil…' to be null
        //   (and the read that fails opens "Can't import yet" over the next screen: expected <div …> to be null)
        expect(localStorage.getItem(CONTENT_KEY), why).toBe(content);
        expect(localStorage.getItem(SOURCES_KEY), why).toBe(sources);
        expect(onChanged, why).not.toHaveBeenCalled();
        expect(dialog(), why).toBeNull();
      }
    });

    /* ---- Settle round 4 (2026-10-01): signed in, nothing is known before this session's first cloud pull */

    it('signed in before the first cloud pull lands: UNKNOWN even with no campaign on the list — refused, nothing written', async () => {
      // The refuter's probe P1: a fresh device (or a failed first pull — the server asleep) holds an
      // unsynced, EMPTY membership list, which read as "no campaigns" and let a GM's export land as the
      // player's own. P5: its own store misses every deletion made elsewhere, which the import re-stamped
      // as re-created NOW. Nothing pulled is trusted until that pull lands.
      session.synced = false;
      for (const [why, setup] of [
        ['a fresh device: no list, no copy', () => undefined],
        // A device that synced last SESSION: its list and its copy are last session's.
        ['last session’s list and copy', () => (saveCampaigns([PLAYER]), saveCampaignHbCache(UID, {}, [PLAYER.id]))],
      ] as const) {
        localStorage.clear();
        saveSyncOwner(UID); // startCloudSync saves it BEFORE its first pull
        setup();
        pull.fn.mockClear();
        // MUTATION PROOF (each tried 2026-10-01, round 4) in HomebrewPage campaignHomebrewUnknown — drop
        // `if (account === 'signed-in' && !hasSyncedOnce()) return true;` —
        //   AssertionError: a fresh device: no list, no copy: expected 'Homebrew importedAdded 1 feat and 1 s…' to contain 'Can\'t import yet'
        await expectRefused(why);
        expect(pull.fn, why).toHaveBeenCalledTimes(1); // tried: it answers false until that pull lands
      }

      // The first cloud pull lands (here: the list it brings holds no campaign): the import goes through.
      localStorage.clear();
      saveSyncOwner(UID);
      session.synced = true;
      await expectImported('synced');
    });

    it('signed out (the installed app used offline) or with no cloud at all: no first pull to wait for', async () => {
      // App's portrait clean-up draws the same line: signed out, this device's data is the whole truth.
      session.synced = false; // never, this session
      for (const account of ['signed-out', 'no-cloud'] as const) {
        localStorage.clear();
        saveSyncOwner(UID); // a sign-out keeps it
        session.account.mockResolvedValue(account);
        pull.fn.mockClear();
        // MUTATION PROOF (tried 2026-10-01, round 4) in campaignHomebrewUnknown — drop `account === 'signed-in' &&`
        // (every account waits for a cloud pull) —
        //   AssertionError: signed-out: expected 'Can\'t import yetYour campaign homebr…' to contain 'Homebrew imported'
        await expectImported(account);
        expect(pull.fn, account).not.toHaveBeenCalled();
      }
      // Signed out with a campaign this device KNOWS (read in full before the sign-out): goes through too.
      localStorage.clear();
      saveSyncOwner(UID);
      saveCampaigns([PLAYER]);
      saveCampaignHbCache(UID, {}, [PLAYER.id]);
      session.account.mockResolvedValue('signed-out');
      await expectImported('signed out, known');
    });

    it('signed out with a campaign this device does not know: refused, and told to sign in — not to go online', async () => {
      // The refuter's probe P2: signed out no pull can run (the campaign homebrew is stopped), so "Try
      // again when you're online" could never help an online player.
      saveSyncOwner(UID);
      saveCampaigns([PLAYER]);
      localStorage.setItem(CAMPAIGN_HB_CACHE_KEY, JSON.stringify({ uid: UID, campaigns: {} })); // an older build's copy
      session.synced = false;
      session.account.mockResolvedValue('signed-out');
      // MUTATION PROOF (tried 2026-10-01, round 4): drop the signed-out branch of cantImportYet —
      //   AssertionError: signed out: expected 'Can\'t import yetYour campaign homebr…' to contain 'Your campaign homebrew couldn\'t be r…'
      await expectRefused('signed out', "Your campaign homebrew couldn't be read on this device yet. Sign in, then try again.", 'online');
      // With no cloud at all there is no one to sign in as: the general answer.
      // MUTATION PROOF (tried 2026-10-01, round 4): `account === 'signed-out'` → `account !== 'signed-in'` in cantImportYet —
      //   AssertionError: no cloud: expected 'Can\'t import yetYour campaign homebr…' to contain 'Your campaign homebrew couldn\'t be r…'
      session.account.mockResolvedValue('no-cloud');
      await expectRefused('no cloud', REFUSED, 'Sign in');
    });

    it('closing the page while the session is read cancels the import too: nothing written, no notice', async () => {
      let answer: (a: 'signed-in') => void = () => undefined;
      session.account.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
      const onChanged = vi.fn();
      const r = renderDom(page(EMPTY, onChanged));
      await importText(r, fileOf());
      r.stop(); // the player leaves the Homebrew page
      await act(async () => answer('signed-in'));
      await settle();
      // MUTATION PROOF (tried 2026-10-01, round 4): drop the `if (!mounted.current) return;` after
      // accountStateHere in HomebrewPage —
      //   AssertionError: expected '{"items":{},"feats":{"syn-glass-anvil…' to be null
      expect(localStorage.getItem(CONTENT_KEY)).toBeNull();
      expect(localStorage.getItem(SOURCES_KEY)).toBeNull();
      expect(onChanged).not.toHaveBeenCalled();
      expect(dialog()).toBeNull();
    });
  });
});
