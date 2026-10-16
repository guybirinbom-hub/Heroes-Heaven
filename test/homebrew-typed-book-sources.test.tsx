// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { shopItems } from '../src/data';
import { emptyBuild, type BuildState } from '../src/rules/build';
import { enabledBookSet, sourceCatalog, sourceIdToken } from '../src/rules/sources';
import { saveHomebrewSource } from '../src/data/storage';
import { SourcesCard, useBuilderActions } from '../src/builder/shared';
import { ItemEditorModal } from '../src/sheet/ItemEditorModal';
import type { ContentDatabase, Item } from '../src/rules/types';

/*
 * Package G, item 3 (2026-10-16): "a homebrew item with a typed book name can't be switched on from the
 * Setup → Sources card" — re-checked, and REAL.
 *
 * The item editor (sheet "Create item", the Homebrew page) has a free "Source book" field. An item made with
 * one and no Homebrew-page Source carries `source: { book: <typed>, license: 'homebrew' }` and no
 * homebrewSourceId. entrySourceOn turns it on only by that name, and since desk #169 (2026-09-29) the shop
 * follows it — but the card's Homebrew section listed only Homebrew-page Sources and campaign sources, each
 * switched by its id token, so no row ever wrote the typed name. The item was hidden from the shop and the
 * Builder's pickers with no control that could bring it back. Run on the code before the fix, the row legs
 * below failed: there was no "My Table" row to click.
 *
 * Now every typed homebrew book name gets a row of its own in the Homebrew section, switched by NAME, and a
 * Source row whose name is also typed on a source-less item is switched by its name as well as its token,
 * so the row never reads "on" while its items stay hidden. A typed name that is a printed book's key
 * ("Pathfinder Player Core") follows that book's own row and gets none here.
 *
 * MUTATION LINES (src/builder/shared.tsx SourcesCard; proven on a scratch copy, 2026-10-16)
 *   1. Drop the name-only rows (the `catalog.homebrewByName` loop in hbList): the "My Table" legs go red.
 *   2. Write only tokens on switch-on (`setBooks(on ? [] : …)`, as before): "My Table" stays off — red.
 *   3. Drop `byName` on a Source row: the "Table Notes" typed item stays hidden while its row reads on — red.
 */
const TYPED = 'custom-moon-lantern';
const TYPED_IN_SOURCE_NAME = 'custom-notes-cloak';
const IN_SOURCE = 'hb-items-notes-ring';
const PRINTED_NAME = 'custom-core-badge';
const SRC_ID = 'hbsrc-test-notes';

function item(id: string, source: Item['source'], homebrewSourceId?: string): Item {
  return {
    id,
    name: id.replace(/^(custom|hb-items)-/, '').replace(/-/g, ' '),
    itemType: 'gear',
    traits: [],
    rarity: 'common',
    level: 0,
    description: '',
    price: { gp: 1 },
    source,
    ...(homebrewSourceId ? { homebrewSourceId } : {}),
  } as unknown as Item;
}

/** The real database plus four homebrew items: a typed book with no Source, a typed book that is ALSO a
 *  Source's name, an item inside that Source, and a typed name that is a printed book's key. */
function db(): ContentDatabase {
  const c = content();
  return {
    ...c,
    items: {
      ...c.items,
      [TYPED]: item(TYPED, { book: 'My Table', license: 'homebrew' }),
      [TYPED_IN_SOURCE_NAME]: item(TYPED_IN_SOURCE_NAME, { book: 'Table Notes', license: 'homebrew' }),
      [IN_SOURCE]: item(IN_SOURCE, { book: 'Table Notes', license: 'homebrew' }, SRC_ID),
      [PRINTED_NAME]: item(PRINTED_NAME, { book: 'Pathfinder Player Core', license: 'homebrew' }),
    },
  } as ContentDatabase;
}

function mountCard(c: ContentDatabase, start: BuildState) {
  let latest = start;
  function Harness() {
    const [b, setB] = useState<BuildState>(start);
    const actions = useBuilderActions(setB, c);
    latest = b;
    return <SourcesCard build={b} actions={actions} catalog={sourceCatalog(c)} content={c} />;
  }
  const s = renderDom(<Harness />);
  const head = [...s.host.querySelectorAll('.src-cat-name')].find((e) => (e.textContent ?? '').includes('Homebrew'));
  s.click(head ?? null);
  const row = (name: string) =>
    [...s.host.querySelectorAll('.src-book')].find((e) => e.querySelector('.src-book-name')?.firstChild?.textContent === name);
  return { s, latest: () => latest, row };
}

const offered = (c: ContentDatabase, b: BuildState) => new Set(shopItems(c, false, enabledBookSet(b.enabledSources)).map((i) => i.id));

beforeEach(() => {
  localStorage.clear();
  saveHomebrewSource({ id: SRC_ID, name: 'Table Notes' });
});
afterEach(() => localStorage.clear());

describe('package G: a homebrew item with a typed book name can be switched on from the Sources card', () => {
  it('the catalog names the typed homebrew books that no Source carries, and only those', () => {
    const cat = sourceCatalog(db());
    expect(cat.homebrewByName).toContain('My Table');
    expect(cat.homebrewByName).toContain('Table Notes'); // the typed cloak, not the ring inside the Source
    expect(cat.homebrewByName).toContain('Pathfinder Player Core');
    expect(cat.allBooks).toContain('Pathfinder Player Core');
    expect(cat.allBooks).not.toContain('My Table');
  });

  it('Core only: none of the three typed items is offered', () => {
    const c = db();
    const ids = offered(c, emptyBuild());
    expect(ids.has(TYPED)).toBe(false);
    expect(ids.has(TYPED_IN_SOURCE_NAME)).toBe(false);
    expect(ids.has(IN_SOURCE)).toBe(false);
    expect(ids.has(PRINTED_NAME)).toBe(true); // it follows Player Core, which Core only has on
  });

  it('a typed book with no Source has its own Homebrew row; switching it on offers the item', async () => {
    const c = db();
    const m = mountCard(c, emptyBuild());
    const r = m.row('My Table');
    expect(r, 'the Homebrew section has a "My Table" row').toBeTruthy();
    expect(r!.classList.contains('on')).toBe(false);
    m.s.click(r!);
    await act(async () => undefined);
    expect(m.latest().enabledSources).toContain('My Table');
    expect(m.row('My Table')!.classList.contains('on')).toBe(true);
    expect(offered(c, m.latest()).has(TYPED)).toBe(true);
    // Switched off again, it is hidden again.
    m.s.click(m.row('My Table')!);
    await act(async () => undefined);
    expect(m.latest().enabledSources).not.toContain('My Table');
    expect(offered(c, m.latest()).has(TYPED)).toBe(false);
    m.s.stop();
  });

  it('a Source row whose name is also typed on a source-less item switches both on together', async () => {
    const c = db();
    const m = mountCard(c, emptyBuild());
    const rows = [...m.s.host.querySelectorAll('.src-book-name')].filter((e) => e.firstChild?.textContent === 'Table Notes');
    expect(rows, 'one "Table Notes" row, not two').toHaveLength(1);
    m.s.click(m.row('Table Notes')!);
    await act(async () => undefined);
    expect(m.latest().enabledSources).toContain(sourceIdToken(SRC_ID));
    const ids = offered(c, m.latest());
    expect(ids.has(IN_SOURCE)).toBe(true);
    expect(ids.has(TYPED_IN_SOURCE_NAME), 'the typed item follows the row it shows under').toBe(true);
    m.s.stop();
  });

  it('a typed name that is a printed book\'s key gets no Homebrew row of its own', () => {
    const m = mountCard(db(), emptyBuild());
    expect(m.row('Pathfinder Player Core')).toBeUndefined();
    m.s.stop();
  });

  it('a selection that holds only the Source\'s token reads the shared row OFF, and one click puts everything on', async () => {
    const c = db();
    const start = { ...emptyBuild(), enabledSources: [sourceIdToken(SRC_ID)] } as BuildState;
    expect(offered(c, start).has(IN_SOURCE)).toBe(true);
    expect(offered(c, start).has(TYPED_IN_SOURCE_NAME)).toBe(false);
    const m = mountCard(c, start);
    expect(m.row('Table Notes')!.classList.contains('on'), 'a row never reads on while an item behind it is hidden').toBe(false);
    // …and it says "partly on" rather than looking fully off, since the Source's own items do show.
    expect(m.row('Table Notes')!.classList.contains('partial')).toBe(true);
    expect(m.row('Table Notes')!.querySelector('.ti-square-minus')).toBeTruthy();
    expect(m.row('My Table')!.classList.contains('partial')).toBe(false);
    m.s.click(m.row('Table Notes')!);
    await act(async () => undefined);
    expect(offered(c, m.latest()).has(TYPED_IN_SOURCE_NAME)).toBe(true);
    expect(m.row('Table Notes')!.classList.contains('on')).toBe(true);
    m.s.stop();
  });

  it('"Enable everything" switches the typed books on too', async () => {
    const c = db();
    const m = mountCard(c, emptyBuild());
    const all = [...m.s.host.querySelectorAll('.src-act')].find((e) => (e.textContent ?? '').trim() === 'Enable everything');
    m.s.click(all ?? null);
    await act(async () => undefined);
    const ids = offered(c, m.latest());
    for (const id of [TYPED, TYPED_IN_SOURCE_NAME, IN_SOURCE, PRINTED_NAME]) expect(ids.has(id), id).toBe(true);
    m.s.stop();
  });

  /* Found by package G's checker (src/sheet/ItemEditorModal.tsx build()): editing a homebrew item that belongs to
   * a Homebrew-page Source kept its id but dropped `homebrewSourceId`, so one edit on the sheet cut it loose from
   * its Source — it left that Source on the Homebrew page, was no longer deleted with it, stopped reaching a
   * campaign through a GM's shared Source, and (by its pre-filled book name) turned into a typed-book item.
   * Run before the fix, this leg read `undefined`.
   * MUTATION LINE: drop the `homebrewSourceId` line from build()'s base — red. */
  it('editing a Source\'s homebrew item keeps it in its Source', () => {
    const c = db();
    let saved: Item | undefined;
    const r = renderDom(
      <ItemEditorModal mode="edit" item={c.items[IN_SOURCE]} content={c} onSave={(it: Item) => { saved = it; }} onClose={() => undefined} />,
    );
    r.host.querySelector<HTMLButtonElement>('.ci-save')!.click();
    r.stop();
    expect(saved?.id).toBe(IN_SOURCE);
    expect((saved as { homebrewSourceId?: string } | undefined)?.homebrewSourceId).toBe(SRC_ID);
    // A copy of a PRINTED item gets a new id and never borrows a Source, even one planted on the record.
    let fresh: Item | undefined;
    const planted = { ...c.items['longsword'], homebrewSourceId: SRC_ID } as Item;
    const r2 = renderDom(<ItemEditorModal mode="edit" item={planted} content={c} onSave={(it: Item) => { fresh = it; }} onClose={() => undefined} />);
    r2.host.querySelector<HTMLButtonElement>('.ci-save')!.click();
    r2.stop();
    expect(fresh?.id).not.toBe('longsword');
    expect((fresh as { homebrewSourceId?: string } | undefined)?.homebrewSourceId).toBeUndefined();
  });

  /* Found by the checker's second pass: an entry whose Homebrew-page Source no longer exists (a GM's shared Source
   * after the campaign is lost) keeps that Source's name as its book, and no row could write either its name or
   * its dead id token. It now gets a by-name row like a typed book.
   * MUTATION LINE: drop `...orphans` from the hbList loop — red. */
  it('an item whose Source is gone still gets a row and can be switched on', async () => {
    const c0 = db();
    const c = { ...c0, items: { ...c0.items, 'hb-items-lost-bell': item('hb-items-lost-bell', { book: 'Lost Notes', license: 'homebrew' }, 'hbsrc-gone') } } as ContentDatabase;
    expect(offered(c, emptyBuild()).has('hb-items-lost-bell')).toBe(false);
    const m = mountCard(c, emptyBuild());
    const r = m.row('Lost Notes');
    expect(r, 'a "Lost Notes" row').toBeTruthy();
    m.s.click(r!);
    await act(async () => undefined);
    expect(offered(c, m.latest()).has('hb-items-lost-bell')).toBe(true);
    m.s.stop();
  });

  it('"Turn all homebrew on" switches the typed books on too', async () => {
    const c = db();
    const m = mountCard(c, emptyBuild());
    const all = m.s.host.querySelector('[aria-label="Enable all homebrew"]');
    expect(all).toBeTruthy();
    m.s.click(all);
    await act(async () => undefined);
    const ids = offered(c, m.latest());
    for (const id of [TYPED, TYPED_IN_SOURCE_NAME, IN_SOURCE]) expect(ids.has(id), id).toBe(true);
    m.s.stop();
  });
});
