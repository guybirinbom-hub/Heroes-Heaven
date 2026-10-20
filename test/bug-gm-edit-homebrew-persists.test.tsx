// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { GmEditSheet } from '../src/sheet/GmEditSheet';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { CORE_BOOKS, storedSources } from '../src/rules/sources';
import { deleteMode, loadHomebrewItems, loadModes, saveHomebrewItem, saveMode, type SavedChar } from '../src/data/storage';
import type { ContentDatabase, InventoryItem, Item, ModeDef } from '../src/rules/types';

/**
 * U3 (2026-10-20): homebrew made or deleted in the GM's edit sheet lasted only for that session.
 *
 * GmEditSheet kept its own `content` copy, and its item / mode writers (addCustomItem, saveModeDef,
 * removeModeDef) only updated that copy. The GM's own sheet goes through App's writers, which ALSO
 * persist (saveHomebrewItem / saveMode / deleteMode: storage, cloud + campaign-homebrew sync dirty,
 * tombstones). So a "Delete" in the GM sheet's Add-items search came back on the next launch, and a
 * mode he deleted there was back too. The fix threads App's persisting writers down (App →
 * CampaignsPage → CampaignTracker / useMemberViewer → GmEditSheet); the sheet keeps its instant local
 * update AND calls them.
 *
 * The writers handed in here are App's, minus React: the record goes to storage exactly as App's do,
 * and the "next launch" is a remount whose content is rebuilt from storage.
 *
 * MUTATION-PROOF (run 2026-10-20): drop the `onCreateItem?.(item)` / `onDeleteMode?.(id)` calls from
 * GmEditSheet's addCustomItem / removeModeDef (the b8f8a6e shape) — both tests fail on the writer's
 * record: `expected [] to have a length of 1 but got +0` (item) and
 * `expected [] to deeply equal [ 'mode-tidewatch-test' ]` (mode).
 *
 * Every character and record here is synthetic.
 */

const ON = storedSources([...CORE_BOOKS, 'My Homebrew']);

/** An item the GM authored (`license: 'homebrew'` is the homebrew merge's stamp; `custom-…` the id
 *  the item editor mints) — the only kind of row the search offers to delete. */
const AUTHORED: Item = {
  id: 'custom-glass-lantern-q2x9',
  name: 'Glass Lantern of Tides',
  itemType: 'equipment',
  level: 2,
  bulk: 0.1,
  traits: ['magical'],
  rarity: 'common',
  price: { gp: 9 },
  description: 'A lantern whose light sways like water.',
  source: { license: 'homebrew', book: 'My Homebrew' },
} as Item;

/** A mode the GM saved for every character (no gate, no charId): "Your modes" in the panel. */
const MODE: ModeDef = { id: 'mode-tidewatch-test', name: 'Tidewatch Stance', modifiers: [{ value: 1, type: 'status', target: 'all-checks' }] } as ModeDef;

const base = content();

/** What App's content holds after a launch: the core database plus what storage has. */
function launchedContent(): ContentDatabase {
  return {
    ...base,
    items: { ...base.items, ...loadHomebrewItems() },
    modes: { ...base.modes, ...loadModes() },
  } as ContentDatabase;
}

/** A player's character, published, carrying one of the GM's authored items. */
function playerSheet(db: ContentDatabase): SavedChar {
  const build: BuildState = {
    ...emptyBuild(),
    name: 'Corwin Ashdale',
    level: 3,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    classId: 'fighter',
    keyAbility: 'str',
    enabledSources: ON,
  } as BuildState;
  const character = buildCharacter(build, db);
  const inv = { instanceId: 'gl-1', itemId: AUTHORED.id, quantity: 1 } as InventoryItem;
  return { id: 'pc-corwin', character, build, play: { ...initialPlay(character, db), inventory: [inv] } };
}

const gmSheet = (
  db: ContentDatabase,
  writers: { onCreateItem?: (i: Item) => void; onSaveMode?: (m: ModeDef) => void; onDeleteMode?: (id: string) => void },
) => {
  const sheet = playerSheet(db);
  return (
    <GmEditSheet
      initial={sheet}
      live={sheet}
      content={db}
      campaignId="camp-test"
      playerOwnerId="player-test"
      onCreateItem={writers.onCreateItem}
      onSaveMode={writers.onSaveMode}
      onDeleteMode={writers.onDeleteMode}
      onExit={() => undefined}
    />
  );
};

const buttonByText = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === text) as HTMLButtonElement | undefined;

/** Type into the picker's name search (a React-controlled input): the full catalog renders 150 rows
 *  at a time, so the row is found by searching for it, as a GM would. */
async function search(text: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('.fsel-results-search input');
  expect(input, 'fixture: the Add-items search box').not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  for (const n of [...document.body.children]) n.remove();
});

describe('U3: what the GM deletes in his edit sheet stays deleted after the session', () => {
  it('a homebrew item retired from the Add-items search is saved retired — hidden from the search on the next launch, still carried', async () => {
    saveHomebrewItem(AUTHORED); // the GM authored it earlier, on his own sheet
    const written: Item[] = [];
    const onCreateItem = (it: Item) => {
      written.push(it);
      saveHomebrewItem(it); // App's addCustomItem, minus React
    };

    const first = renderDom(gmSheet(launchedContent(), { onCreateItem }));
    first.click(buttonByText(first.host, 'Inventory') ?? null);
    await tick();
    first.click(buttonByText(first.host, 'Add item') ?? null);
    await tick();
    await search('Glass Lantern');
    const del = first.host.querySelector<HTMLButtonElement>(`button.del[aria-label="Delete ${AUTHORED.name}"]`);
    expect(del, 'fixture: the search offers Delete on the GM’s own item').not.toBeNull();
    first.click(del);
    await tick();
    const ok = buttonByText(document, 'Delete');
    expect(ok, 'fixture: the app’s own confirm').toBeTruthy();
    await act(async () => {
      ok!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await tick();
    first.stop();

    // Written through the host's writer as a RETIRE: the same record, marked — never a removal.
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ id: AUTHORED.id, name: AUTHORED.name, retired: true });
    expect(loadHomebrewItems()[AUTHORED.id]?.retired, 'persisted, not kept for the session').toBe(true);

    // The next launch: content rebuilt from storage.
    const second = renderDom(gmSheet(launchedContent(), { onCreateItem }));
    second.click(buttonByText(second.host, 'Inventory') ?? null);
    await tick();
    const inventoryText = second.host.textContent ?? '';
    expect(inventoryText, 'the player still carries it, named').toContain(AUTHORED.name);
    expect(inventoryText).not.toContain('Unknown item');
    second.click(buttonByText(second.host, 'Add item') ?? null);
    await tick();
    await search('Glass Lantern');
    expect(second.host.querySelector('.fsel-results-search input'), 'fixture: the search is open').not.toBeNull();
    expect(second.host.querySelector(`button.del[aria-label="Delete ${AUTHORED.name}"]`), 'gone from the search').toBeNull();
    second.stop();
  }, 120_000);

  it('a mode deleted in the GM sheet is deleted from storage, and is not back on the next launch', async () => {
    saveMode(MODE);
    const deleted: string[] = [];
    const onDeleteMode = (id: string) => {
      deleted.push(id);
      deleteMode(id); // App's removeModeDef, minus React
    };
    const openModes = async (host: HTMLElement, click: (el: Element | null) => void) => {
      const add = host.querySelector<HTMLButtonElement>('.add-btn');
      expect(add, 'fixture: the rail’s Conditions “Add”').not.toBeNull();
      click(add);
      await tick();
      const tab = buttonByText(document, 'Modes');
      expect(tab, 'fixture: the Modes tab').toBeTruthy();
      click(tab!);
      await tick();
      expect(document.querySelector('button.mode-edit'), 'fixture: the Modes panel lists saved modes').not.toBeNull();
    };

    const first = renderDom(gmSheet(launchedContent(), { onDeleteMode }));
    await openModes(first.host, first.click);
    expect(document.body.textContent, 'fixture: the GM’s mode is listed').toContain(MODE.name);
    // The row's own Edit (the fixture database carries other saved modes too).
    const edit = [...document.querySelectorAll<HTMLButtonElement>('button.mode-edit[aria-label="Edit"]')].filter((b) =>
      (b.parentElement?.textContent ?? '').includes(MODE.name),
    );
    expect(edit, 'fixture: the GM’s mode is editable').toHaveLength(1);
    first.click(edit[0]);
    await tick();
    first.click(document.querySelector('button.me-delete'));
    await tick();
    first.stop();

    expect(deleted).toEqual([MODE.id]);
    expect(loadModes()[MODE.id], 'deleted from storage, not just from this session').toBeUndefined();

    const second = renderDom(gmSheet(launchedContent(), { onDeleteMode }));
    await openModes(second.host, second.click);
    expect(document.body.textContent).not.toContain(MODE.name);
    second.stop();
  }, 120_000);
});

describe('U3: what the GM makes in his edit sheet is kept after the session', () => {
  /*
   * Checker finding (2026-10-20): mode SAVE had no test. MUTATION (run 2026-10-20): drop
   * `onSaveMode?.(mode)` from GmEditSheet's saveModeDef — `expected [] to have a length of 1 but got +0`.
   */
  it('a new mode saved in the GM sheet is saved to storage, and is listed on the next launch', async () => {
    const NAME = 'Reefwalker Focus Test';
    const saved: ModeDef[] = [];
    const onSaveMode = (m: ModeDef) => {
      saved.push(m);
      saveMode(m); // App's saveModeDef, minus React
    };
    const openModes = async (click: (el: Element | null) => void) => {
      click(document.querySelector('.add-btn'));
      await tick();
      const tab = buttonByText(document, 'Modes');
      expect(tab, 'fixture: the Modes tab').toBeTruthy();
      click(tab!);
      await tick();
    };

    const first = renderDom(gmSheet(launchedContent(), { onSaveMode }));
    await openModes(first.click);
    const newBtn = buttonByText(document, 'New mode');
    expect(newBtn, 'fixture: the panel’s New mode').toBeTruthy();
    first.click(newBtn!);
    await tick();
    const name = document.querySelector<HTMLInputElement>('.mode-editor .me-field input');
    expect(name, 'fixture: the mode name box').not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, NAME);
      name!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = buttonByText(document, 'Save mode');
    expect(save?.disabled, 'fixture: a named mode can be saved').toBe(false);
    first.click(save!);
    await tick();
    first.stop();

    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe(NAME);
    expect(Object.values(loadModes()).some((m) => m.name === NAME), 'persisted, not kept for the session').toBe(true);

    const second = renderDom(gmSheet(launchedContent(), { onSaveMode }));
    await openModes(second.click);
    expect(document.body.textContent).toContain(NAME);
    second.stop();
  }, 120_000);
});
