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
  loadHomebrewSources,
  loadHomebrewContent,
  saveCampaignHbCache,
  saveSyncOwner,
  HOMEBREW_TYPES,
  type CampaignHbCampaign,
} from '../src/data/storage';
import { renderDom } from './_render';
import type { ContentDatabase, Item } from '../src/rules/types';

const shared = vi.hoisted(() => ({ fn: vi.fn(async (): Promise<Record<string, string[]> | null> => null) }));
vi.mock('../src/data/campaignHomebrew', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/campaignHomebrew')>()),
  sharedSourceCampaigns: shared.fn,
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
