// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { DEDUPE_MAPS, listValues, shopItems } from '../src/data';
import { trustPartly, trustUnencoded } from '../src/data/trustGate';
import { hostSearchRecords } from '../src/integration/hostSearchRecords';
import { CORE_BOOKS, storedSources } from '../src/rules/sources';
import { AddItemsModal } from '../src/sheet/AddItemsModal';
import { InventoryTab } from '../src/sheet/InventoryTab';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/*
 * desk #158 meets the duplicate rules (src/data/index.ts findHiddenTwins). The Impossible Magic grades the
 * duplicate rules hide behind their modelled Secrets of Magic half are exactly the reprints that half's
 * "Remastered as" names — so while the legacy half is offered the reprint stays hidden, and when "Hide
 * legacy data" (or its book) takes the legacy half away, the reprint is offered instead of nothing.
 */
describe('a hidden reprint twin stands in when its legacy record is filtered out', () => {
  const db = content();
  const ids = (list: { id: string }[]) => new Set(list.map((x) => x.id));

  it('every "Remastered as" that names a record the duplicate rules hide is a registered twin of that record', () => {
    const missing: string[] = [];
    const deduped = new Set<string>(DEDUPE_MAPS);
    for (const [bucket, recs] of Object.entries(db as unknown as Record<string, Record<string, { remasteredAs?: { bucket: string; id: string } }>>)) {
      if (!recs || typeof recs !== 'object' || recs instanceof Set || recs instanceof Map) continue;
      for (const [id, r] of Object.entries(recs)) {
        const ra = r?.remasteredAs;
        if (!ra || !deduped.has(ra.bucket) || !db.duplicateIds?.has(ra.id)) continue;
        const t = db.hiddenTwins?.get(ra.id);
        if (!t || t.bucket !== ra.bucket || t.standIn !== id) missing.push(`${bucket}/${id} -> ${ra.id}`);
      }
    }
    expect(missing).toEqual([]);
    expect(db.hiddenTwins?.size ?? 0).toBeGreaterThan(0);
  });

  it('Major Healer\'s Gel stays hidden while Healer\'s Gel (Greater) is offered, and is offered once it is not', () => {
    expect(db.items['healers-gel-greater']?.remasteredAs?.id).toBe('major-healers-gel');
    expect(ids(listValues(db, db.items)).has('major-healers-gel')).toBe(false);
    const { ['healers-gel-greater']: _gone, ...rest } = db.items;
    const view = { ...db, items: rest } as ContentDatabase;
    const shown = ids(listValues(view, view.items));
    expect(shown.has('major-healers-gel')).toBe(true);
    // a duplicate with no stand-in relation stays hidden whatever else is filtered
    const other = [...(db.duplicateIds ?? [])].find((id) => db.items[id] && !db.hiddenTwins?.has(id));
    if (other) expect(shown.has(other)).toBe(false);
  });

  /* Measured on the shop's own list. The view once lacked the umbrella and combination-form sets, so a
   * family summary nobody is offered (items/healers-gel) counted as buyable here. */
  it('under "Hide legacy data" every twin is offered, and a link the shop never offers is one the baseline lists', () => {
    expect(db.umbrellaIds?.size ?? 0).toBeGreaterThan(0);
    expect(db.combinationFormIds?.size ?? 0).toBeGreaterThan(0);
    const shown = ids(shopItems(db, true));
    expect([...(db.hiddenTwins?.keys() ?? [])].filter((id) => !shown.has(id))).toEqual([]);
    const never: string[] = [];
    for (const [id, it] of Object.entries(db.items)) {
      const ra = it.remasteredAs;
      const ed = (it as { edition?: string }).edition;
      if (ra?.bucket === 'items' && (ed === 'legacy' || ed === 'legacy-era') && !shown.has(ra.id)) never.push(`items/${id}`);
    }
    const baseline = JSON.parse(readFileSync('scripts/data/never-offered-links-baseline.json', 'utf8')) as Record<string, unknown>;
    expect(never.filter((k) => !(k in baseline))).toEqual([]);
  });

  it('the GM search lists the reprint the popup names — an item, and a bonus line sharing a hidden item\'s id', () => {
    const rows = hostSearchRecords(db);
    expect(rows.some((r) => r.bucket === 'items' && r.id === 'major-healers-gel')).toBe(true);
    // duplicateIds is a flat set of ITEM (etc.) ids; it must not drop the bonus line of the same id
    const lines = (db as unknown as Record<string, Record<string, { remasteredAs?: { id: string } }> | undefined>).itemBonus;
    expect(lines?.['endless-grimoire-greater']?.remasteredAs?.id).toBe('greater-endless-grimoire');
    expect(rows.some((r) => r.bucket === 'itemBonus' && r.id === 'greater-endless-grimoire')).toBe(true);
  });

  /*
   * 2026-09-25: the twins arrived as their page's text alone — Greater Singing Shortbow lands as an Equipment
   * card with no Strike — and none said so, beside Keep Pace's "Not yet verified". Until the Impossible Magic
   * mechanics batch encodes them, each carries the marker (scripts/trust-ledger.mjs, the reprint-twin rule):
   * on the shop row a hide-legacy player buys from, and on the card of the one they bought.
   */
  it('every twin says it is not applied yet: the shop row a hide-legacy player buys from, and the card after purchase', () => {
    const NOTE = 'Not yet verified — shown, not applied';
    const silent = [...(db.hiddenTwins?.keys() ?? [])].filter((id) => !trustUnencoded('items', id) && !trustPartly('items', id));
    expect(silent).toEqual([]);

    // The shop, "Hide legacy data" on: the legacy Greater Singing Shortbow is gone and its twin is offered.
    const shop = {
      ...db,
      items: { 'singing-shortbow-greater': db.items['singing-shortbow-greater'], 'greater-singing-shortbow': db.items['greater-singing-shortbow'], longsword: db.items['longsword'] },
      services: {}, vehicles: {}, siegeWeapons: {},
    } as ContentDatabase;
    const bought: string[] = [];
    // desk shop-respects-sources (2026-09-29): both halves' books on, so the legacy half is taken away by
    // "Hide legacy data" alone, as this test means (test/shop-respects-sources.test.tsx covers the book).
    const enabledSources = storedSources([...CORE_BOOKS, 'Pathfinder Secrets of Magic', 'Pathfinder Impossible Magic']);
    const s = renderDom(createElement(AddItemsModal, { content: shop, currency: { pp: 5000 }, hideLegacy: true, enabledSources, onBuy: (id: string) => bought.push(id), onGive: () => undefined, onClose: () => undefined }));
    const rows = [...s.host.querySelectorAll('.ai-row')];
    const row = (name: string) => rows.find((e) => e.querySelector('.ai-name')?.textContent === name);
    expect(rows.map((e) => e.querySelector('.ai-name')?.textContent).sort()).toEqual(['Greater Singing Shortbow', 'Longsword']);
    expect(row('Greater Singing Shortbow')?.textContent).toContain(NOTE);
    expect(row('Longsword')?.textContent).not.toContain('Not yet verified');
    s.click(row('Greater Singing Shortbow')!.querySelector('.ai-buy button'));
    s.stop();
    expect(bought).toEqual(['greater-singing-shortbow']);

    // …and the card of the one bought.
    const character = { ...build('fighter', 18), inventory: [{ instanceId: 'gss-1', itemId: bought[0], quantity: 1 } as InventoryItem] } as Character;
    const inv = renderDom(createElement(InventoryTab, { character, content: db }));
    const card = [...inv.host.querySelectorAll('.inv-card')].find((e) => (e.querySelector('.inv-name')?.textContent ?? '').includes('Greater Singing Shortbow'));
    expect(card).toBeTruthy();
    expect(document.body.textContent).not.toContain(NOTE);
    inv.click(card!);
    expect(document.body.textContent).toContain(NOTE);
    inv.stop();
  });
});
