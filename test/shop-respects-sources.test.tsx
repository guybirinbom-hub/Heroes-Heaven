// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { shopItems } from '../src/data';
import { buildCharacter, chosenFromBooks, emptyBuild, type BuildState } from '../src/rules/build';
import { CORE_BOOKS, enabledBookSet, sourceCatalog, storedSources } from '../src/rules/sources';
import { AddItemsModal } from '../src/sheet/AddItemsModal';
import { InventoryTab } from '../src/sheet/InventoryTab';
import { CompanionsTab } from '../src/sheet/CompanionsTab';
import { SourcesCard, useBuilderActions } from '../src/builder/shared';
import type { Character, CompanionConfig, ContentDatabase, InventoryItem } from '../src/rules/types';

/*
 * desk shop-respects-sources — the owner, 2026-09-29: "i want the shop to respect sources".
 *
 * The Builder's pickers always offered only the character's enabled books (Builder.tsx: applySources over
 * CHOOSABLE_SOURCE_MAPS, items among them), and the Sources card says "Disabled books are hidden from every
 * picker". The sheet's Add items shop never did: AddItemsModal listed shopItems(content, hideLegacy) over
 * the sheet's unfiltered content, so a Core-only character was offered every item in every book.
 *
 * Now shopItems takes the enabledBookSet and filters with entrySourceOn in the same pass as the edition
 * filter, and both mount points (InventoryTab, CompanionsTab) pass the character's enabledSources.
 * Keep-what-you-hold: an item the character already carries from a book that is off stays on the sheet and
 * in the build; the Sources card no longer offers to delete it when its book is switched off.
 *
 * The item turned off below is Blade Launcher (AoN equipment-1096), printed only in Guns & Gears.
 */
const GG = 'Pathfinder Guns & Gears';
const SOM = 'Pathfinder Secrets of Magic';
const IM = 'Pathfinder Impossible Magic';
const BLADE = 'blade-launcher';
const noop = () => undefined;
const db = () => content();
const ids = (list: { id: string }[]) => new Set(list.map((x) => x.id));
const books = (...extra: string[]) => storedSources([...CORE_BOOKS, ...extra]);

/** A small catalog the rendered shop lists in full: Longsword (Player Core), Blade Launcher (Guns & Gears),
 *  the Secrets of Magic / Impossible Magic Greater Singing Shortbow pair, one service, one vehicle and one
 *  Guns & Gears siege weapon. Everything else (duplicate sets, twins) comes from the real database. */
function shopDb(): ContentDatabase {
  const c = db();
  return {
    ...c,
    items: {
      longsword: c.items['longsword'],
      [BLADE]: c.items[BLADE],
      'singing-shortbow-greater': c.items['singing-shortbow-greater'],
      'greater-singing-shortbow': c.items['greater-singing-shortbow'],
    },
    services: { 'unskilled-hireling': c.services!['unskilled-hireling'] },
    vehicles: { raft: c.vehicles!['raft'] },
    siegeWeapons: { ballista: c.siegeWeapons!['ballista'] },
  } as ContentDatabase;
}

/** The names of the rows the rendered shop offers. */
function shopRows(props: { enabledSources?: string[]; hideLegacy?: boolean; companions?: boolean }): string[] {
  const s = renderDom(
    <AddItemsModal
      content={shopDb()}
      currency={{ gp: 50000 }}
      enabledSources={props.enabledSources}
      hideLegacy={props.hideLegacy}
      onBuy={noop}
      onGive={noop}
      onClose={noop}
      {...(props.companions ? { onBuyCompanion: noop, onGiveCompanion: noop } : {})}
    />,
  );
  const names = [...s.host.querySelectorAll('.ai-row .ai-name')].map((e) => (e.textContent ?? '').trim()).sort();
  s.stop();
  return names;
}

afterEach(() => {
  for (const el of [...document.querySelectorAll('.confirm-overlay')]) el.parentElement?.remove();
});

/** The row names of the shop a sheet tab opens with its own "Add item" button (the real mount point). */
function openShopRows(host: HTMLElement, click: (el: Element | null) => void): string[] {
  const add = [...host.querySelectorAll('button')].find((e) => (e.textContent ?? '').trim() === 'Add item');
  click(add ?? null);
  return [...host.querySelectorAll('.ai-row .ai-name')].map((e) => (e.textContent ?? '').trim()).sort();
}

/** The real SourcesCard over a live useState build, with the setter exposed so a test can change the build
 *  while the card's confirm is open (a sync pull, a purchase), the way the app can. */
function mountCard(c: ContentDatabase, start: BuildState) {
  let latest = start;
  let setLive: ((fn: (b: BuildState) => BuildState) => void) | undefined;
  function Harness() {
    const [b, setB] = useState<BuildState>(start);
    const actions = useBuilderActions(setB, c);
    latest = b;
    setLive = (fn) => setB(fn);
    return <SourcesCard build={b} actions={actions} catalog={sourceCatalog(c)} content={c} />;
  }
  const s = renderDom(<Harness />);
  const rulebooks = [...s.host.querySelectorAll('.src-cat-name')].find((e) => (e.textContent ?? '').includes('Rulebooks'));
  s.click(rulebooks ?? null);
  return {
    stop: s.stop,
    latest: () => latest,
    change: (fn: (b: BuildState) => BuildState) => act(() => setLive!(fn)),
    /** Click the book's row (it must be on) and let the confirm open; returns the confirm's text. */
    async turnOff(label: string) {
      const row = [...s.host.querySelectorAll('.src-book')].find((e) => e.querySelector('.src-book-name')?.firstChild?.textContent === label);
      expect(row?.classList.contains('on'), `${label} is on before the click`).toBe(true);
      s.click(row!);
      await act(async () => undefined);
      return document.querySelector('.confirm-modal')?.textContent ?? '';
    },
    async confirm() {
      const ok = [...document.querySelectorAll('.confirm-modal button')].find((e) => (e.textContent ?? '').trim() === 'Remove and turn off');
      expect(ok, 'the confirm offers "Remove and turn off"').toBeTruthy();
      await act(async () => {
        ok!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    },
  };
}

describe('shop-respects-sources: the Add items shop offers only the character\'s enabled books', () => {
  it('the fixtures are what this file says they are', () => {
    const c = db();
    expect(c.items[BLADE]?.source?.book).toBe(GG);
    expect((c.items[BLADE] as { aonId?: string } | undefined)?.aonId).toBe('equipment-1096');
    expect(c.items['longsword']?.source?.book).toBe('Pathfinder Player Core');
    expect(c.items['singing-shortbow-greater']?.source?.book).toBe(SOM);
    expect((c.items['singing-shortbow-greater'] as { edition?: string }).edition).toBe('legacy');
    expect(c.items['greater-singing-shortbow']?.source?.book).toBe(IM);
    expect(c.hiddenTwins?.get('greater-singing-shortbow')).toEqual({ bucket: 'items', standIn: 'singing-shortbow-greater' });
    expect(c.siegeWeapons?.['ballista']?.source?.book).toBe(GG);
  });

  // (a) book off → absent, from the list and from the rendered rows
  it('(a) Guns & Gears off: Blade Launcher is not offered — not by shopItems, not as a row', () => {
    const c = db();
    const offered = ids(shopItems(c, false, enabledBookSet(books(SOM))));
    expect(offered.has(BLADE)).toBe(false);
    expect(offered.has('longsword')).toBe(true);
    const rows = shopRows({ enabledSources: books(SOM) });
    expect(rows).not.toContain('Blade Launcher');
    expect(rows).toContain('Longsword');
  });

  // (b) book on → present
  it('(b) Guns & Gears on: Blade Launcher is offered, in the list and as a row', () => {
    expect(ids(shopItems(db(), false, enabledBookSet(books(GG)))).has(BLADE)).toBe(true);
    expect(shopRows({ enabledSources: books(GG) })).toContain('Blade Launcher');
  });

  // (c) undefined enabledSources → Core only
  it('(c) no stored choice is Core only: every offered item is from a Core book or has none', () => {
    const c = db();
    const offered = shopItems(c, false, enabledBookSet(undefined));
    expect(offered.length).toBeGreaterThan(100);
    const core = new Set(CORE_BOOKS);
    expect(offered.filter((i) => i.source?.book?.trim() && !core.has(i.source.book.trim())).map((i) => i.id)).toEqual([]);
    expect(ids(offered).has('longsword')).toBe(true);
    expect(ids(offered).has(BLADE)).toBe(false);
    // …and the modal with no enabledSources is that list, not the whole catalog
    const rows = shopRows({});
    expect(rows).toContain('Longsword');
    expect(rows).not.toContain('Blade Launcher');
    expect(rows).not.toContain('Greater Singing Shortbow');
    expect(rows).not.toContain('Singing Shortbow (Greater)');
    // with no book filter at all (reprint-check CHECK 9's view) it is still offered
    expect(ids(shopItems(c, false)).has(BLADE)).toBe(true);
  });

  // (d) keep-what-you-hold
  it('(d) a Blade Launcher the character already holds stays in the build and resolves on the sheet', () => {
    const c = db();
    const holder: BuildState = { ...emptyBuild(), name: 'Holder', inventory: [{ itemId: BLADE, quantity: 1 }] };
    expect(enabledBookSet(holder.enabledSources).has(GG)).toBe(false);
    expect(buildCharacter(holder, c).inventory.map((i) => i.itemId)).toContain(BLADE);
    expect(c.items[BLADE]).toBeTruthy(); // the sheet's content is never source-filtered
    const character = { ...build('fighter', 3), inventory: [{ instanceId: 'bl-1', itemId: BLADE, quantity: 1 } as InventoryItem] } as Character;
    expect(character.enabledSources).toBeUndefined();
    const { host, stop } = renderDom(<InventoryTab character={character} content={c} />);
    const text = host.textContent ?? '';
    stop();
    expect(text).toContain('Blade Launcher');
    expect(text).not.toContain('Unknown item');
  });

  it('(d) the Sources card does not list a held item as something turning its book off would remove', () => {
    const c = db();
    const b: BuildState = { ...emptyBuild(), name: 'Holder', enabledSources: books(GG), inventory: [{ itemId: BLADE, quantity: 1 }] };
    expect(chosenFromBooks(b, c, new Set([GG]))).toEqual([]);
  });

  it('(d) switching Guns & Gears off on the Sources card keeps the held item, and removes a feat from it only after asking', async () => {
    const c = db();
    const feat = 'firework-technician-dedication';
    expect(c.feats[feat]?.source?.book).toBe(GG);
    const start: BuildState = {
      ...emptyBuild(),
      name: 'Holder',
      level: 2,
      enabledSources: books(GG),
      featPicks: { '2:class:0': feat },
      inventory: [{ itemId: BLADE, quantity: 1 }],
    };
    let latest = start;
    function Harness() {
      const [b, setB] = useState<BuildState>(start);
      const actions = useBuilderActions(setB, c);
      latest = b;
      return <SourcesCard build={b} actions={actions} catalog={sourceCatalog(c)} content={c} />;
    }
    const s = renderDom(<Harness />);
    const rulebooks = [...s.host.querySelectorAll('.src-cat-name')].find((e) => (e.textContent ?? '').includes('Rulebooks'));
    s.click(rulebooks!);
    const row = [...s.host.querySelectorAll('.src-book')].find((e) => e.querySelector('.src-book-name')?.firstChild?.textContent === 'Guns & Gears');
    expect(row?.classList.contains('on')).toBe(true);
    s.click(row!);
    await act(async () => undefined);
    const dialog = document.querySelector('.confirm-modal')?.textContent ?? '';
    expect(dialog).toContain('Firework Technician Dedication');
    expect(dialog).not.toContain('Blade Launcher');
    const ok = [...document.querySelectorAll('.confirm-modal button')].find((e) => (e.textContent ?? '').trim() === 'Remove and turn off');
    await act(async () => {
      ok!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    s.stop();
    expect(enabledBookSet(latest.enabledSources).has(GG)).toBe(false);
    expect(Object.values(latest.featPicks)).not.toContain(feat);
    expect(latest.inventory).toEqual(start.inventory);
  });

  // (e) a hidden reprint twin comes back when its legacy half's BOOK is off
  it('(e) Secrets of Magic off, Impossible Magic on: Greater Singing Shortbow is offered in its legacy half\'s place', () => {
    const c = db();
    const both = ids(shopItems(c, false, enabledBookSet(books(SOM, IM))));
    expect(both.has('singing-shortbow-greater')).toBe(true);
    expect(both.has('greater-singing-shortbow')).toBe(false); // hidden while its stand-in is offered
    const imOnly = ids(shopItems(c, false, enabledBookSet(books(IM))));
    expect(imOnly.has('singing-shortbow-greater')).toBe(false);
    expect(imOnly.has('greater-singing-shortbow')).toBe(true);
    expect(shopRows({ enabledSources: books(IM) })).toContain('Greater Singing Shortbow');
    expect(shopRows({ enabledSources: books(SOM, IM) })).not.toContain('Greater Singing Shortbow');
    // the twin's own book off too: neither half
    const somOnly = ids(shopItems(c, false, enabledBookSet(books(SOM))));
    expect(somOnly.has('greater-singing-shortbow')).toBe(false);
  });

  // (f) services, vehicles and siege weapons are not source-filtered
  it('(f) a service, a vehicle and a Guns & Gears siege weapon are offered whatever the books', () => {
    const rows = shopRows({ companions: true });
    expect(rows).toContain('Unskilled Hireling');
    expect(rows).toContain('Raft');
    expect(rows).toContain('Ballista'); // printed in Guns & Gears, which is off
    expect(rows).not.toContain('Blade Launcher');
  });

  // (g) hide-legacy still filters on top of the books
  it('(g) "Hide legacy data" still applies on top: Secrets of Magic on, the legacy half is hidden and the twin offered', () => {
    const c = db();
    const hidden = ids(shopItems(c, true, enabledBookSet(books(SOM, IM))));
    expect(hidden.has('singing-shortbow-greater')).toBe(false);
    expect(hidden.has('greater-singing-shortbow')).toBe(true);
    const rows = shopRows({ enabledSources: books(SOM, IM, GG), hideLegacy: true });
    expect(rows).toEqual(['Blade Launcher', 'Greater Singing Shortbow', 'Longsword', 'Unskilled Hireling']);
    // …and hide-legacy never brings back a book that is off
    expect(ids(shopItems(c, true, enabledBookSet(books(SOM)))).has('greater-singing-shortbow')).toBe(false);
  });
});

/*
 * The mount points. The modal with no enabledSources is Core only, so a sheet that forgets to pass the
 * character's books silently narrows a Guns & Gears character's shop to Core. These open the shop the way a
 * player does: the Inventory tab's own "Add item" button, and a companion's Inventory (CompanionInventory
 * renders the same InventoryTab over the character with the companion's gear, so it carries the character's
 * books through the same line).
 *
 * MUTATION LINES
 *   1. In InventoryTab.tsx delete `enabledSources={character.enabledSources}` on AddItemsModal: both tests
 *      below go red (Blade Launcher is not offered to a character with Guns & Gears on).
 *   2. The AddItemsModal mount in CompanionsTab.tsx (`invAddFor`) is unreachable: nothing has called
 *      setInvAddFor with an id since b76d2b3 moved companion gear onto CompanionInventory. It passes the
 *      books too, but no player path opens it, so no test here can.
 */
describe('shop-respects-sources: the sheet opens the shop with the character\'s own books', () => {
  const REX = { id: 'c1', kind: 'animal', name: 'Rex' } as CompanionConfig;

  it('the Inventory tab\'s Add item: Guns & Gears on offers Blade Launcher; no stored books (Core only) does not', () => {
    const on = { ...build('fighter', 3), enabledSources: books(GG) } as Character;
    const a = renderDom(<InventoryTab character={on} content={shopDb()} onPlay={noop} />);
    const rowsOn = openShopRows(a.host, a.click);
    a.stop();
    expect(rowsOn).toContain('Blade Launcher');
    expect(rowsOn).toContain('Longsword');

    const core = build('fighter', 3) as Character;
    expect(core.enabledSources).toBeUndefined();
    const b = renderDom(<InventoryTab character={core} content={shopDb()} onPlay={noop} />);
    const rowsCore = openShopRows(b.host, b.click);
    b.stop();
    expect(rowsCore).toContain('Longsword');
    expect(rowsCore).not.toContain('Blade Launcher');
  });

  it('a companion\'s Inventory, Add item: the shop follows the CHARACTER\'s books', () => {
    const open = (character: Character) => {
      const s = renderDom(<CompanionsTab character={character} content={shopDb()} onPlay={noop} charKey="t" />);
      s.click(s.host.querySelector('button[title="Inventory"]'));
      expect(s.host.querySelector('.comp-inv'), 'the companion\'s inventory is open').toBeTruthy();
      const rows = openShopRows(s.host, s.click);
      s.stop();
      return rows;
    };
    const on = open({ ...build('fighter', 3), companions: [REX], enabledSources: books(GG) } as Character);
    expect(on).toContain('Blade Launcher');
    const core = open({ ...build('fighter', 3), companions: [REX] } as Character);
    expect(core).toContain('Longsword');
    expect(core).not.toContain('Blade Launcher');
  });
});

/*
 * The Sources card's turn-off, beyond what chosenFromBooks lists.
 *
 * MUTATION LINES (src/builder/shared.tsx, SourcesCard setBooks, the patch after the confirm)
 *   1. Drop `, inventory: b.inventory`: "a spell stored in a held scroll" goes red — removeChosenIds clears
 *      the scroll's heldSpell when the repertoire spell goes.
 *   2. Write the snapshot instead of the live build (`actions.patch(removeChosenIds({ ...build, … }))`):
 *      "a change made while the confirm is open" goes red — the longsword bought meanwhile and Impossible
 *      Magic switched on meanwhile are both undone.
 */
describe('shop-respects-sources: the Sources card keeps what the character holds', () => {
  const SCROLL = 'scroll-of-1st-rank-spell';
  const DRAW_IRE = 'draw-ire';

  it('fixtures: Draw Ire is a Secrets of Magic spell; the scroll is a GM Core item', () => {
    const c = db();
    expect(c.spells[DRAW_IRE]?.source?.book).toBe(SOM);
    expect(c.items[SCROLL]?.source?.book).toBe('Pathfinder GM Core');
  });

  it('turning Secrets of Magic off removes Draw Ire from the spell list after asking, and keeps it in a held scroll', async () => {
    const c = db();
    const start: BuildState = {
      ...emptyBuild(),
      name: 'Holder',
      classId: 'wizard',
      enabledSources: books(SOM),
      spells: { '1': [DRAW_IRE] },
      inventory: [{ itemId: SCROLL, quantity: 1, heldSpell: DRAW_IRE }],
    };
    const card = mountCard(c, start);
    const dialog = await card.turnOff('Secrets of Magic');
    expect(dialog).toContain('Draw Ire');
    await card.confirm();
    card.stop();
    const after = card.latest();
    expect(enabledBookSet(after.enabledSources).has(SOM)).toBe(false);
    expect(Object.values(after.spells).flat()).not.toContain(DRAW_IRE);
    expect(after.inventory).toEqual(start.inventory);
  });

  it('a change made while the confirm is open survives the removal (the live build is written, not the snapshot)', async () => {
    const c = db();
    const feat = 'firework-technician-dedication';
    const start: BuildState = {
      ...emptyBuild(),
      name: 'Holder',
      level: 2,
      enabledSources: books(GG),
      featPicks: { '2:class:0': feat },
      inventory: [{ itemId: BLADE, quantity: 1 }],
    };
    const card = mountCard(c, start);
    const dialog = await card.turnOff('Guns & Gears');
    expect(dialog).toContain('Firework Technician Dedication');
    // Meanwhile (a sync pull, a purchase on another device): a longsword arrives and Impossible Magic goes on.
    card.change((b) => ({
      ...b,
      inventory: [...b.inventory, { itemId: 'longsword', quantity: 1 }],
      enabledSources: storedSources([...enabledBookSet(b.enabledSources), IM]),
    }));
    await card.confirm();
    card.stop();
    const after = card.latest();
    const on = enabledBookSet(after.enabledSources);
    expect(on.has(GG)).toBe(false);
    expect(on.has(IM)).toBe(true);
    expect(Object.values(after.featPicks)).not.toContain(feat);
    expect(after.inventory.map((i) => i.itemId)).toEqual([BLADE, 'longsword']);
  });
});
