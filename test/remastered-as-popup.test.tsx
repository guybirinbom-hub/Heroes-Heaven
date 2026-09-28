// @vitest-environment jsdom
import { act } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { content } from './_content';
import { renderDom } from './_render';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import type { ContentDatabase } from '../src/rules/types';

/**
 * desk #158 — "Remastered as <name>" in the SEARCH / ref-link popup (reprint lane 2026-09-25).
 *
 * DescBody (the detail views) printed the line; DescriptionModal — every popup the Archives search, a
 * rules link or a trait chip opens — did not, so an old printing reached from anywhere but a held item
 * said nothing about its reprint, and an item-bonus line or a trait (which only ever open here) never
 * could. The real component, the real data for the item: items/backfire-mantle-greater is the Secrets
 * of Magic grade whose document names its reprint "Greater Backfire Mantle" (rule A in
 * scripts/lib/reprint.mjs), so its link now opens that exact grade rather than the base item.
 */
const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) as Record<string, AstNode>;
const OLD = 'backfire-mantle-greater';
const pin: PinDescApi = { has: () => false, toggle: () => undefined };
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeAll(async () => {
  const shipped = readGz('public/ast/items.json.gz');
  const items: Record<string, AstNode> = {};
  const twin = (content().items[OLD] as { remasteredAs?: { id: string } }).remasteredAs?.id;
  for (const slug of [OLD, twin ?? '']) if (shipped[slug]) items[slug] = shipped[slug];
  // Items are served through the loader's raw-json fallback so the cache is warm and the popup renders
  // its page synchronously, as the app does once the bucket has been fetched. Every other bucket 404s,
  // so a record there opens on the plain-text path.
  vi.stubGlobal('fetch', async (url: string) =>
    String(url).endsWith('ast/items.json') ? { ok: true, json: async () => items } : { ok: false });
  await loadBucketAst('items');
});

describe('desk #158: the description popup says what an old printing was remastered as', () => {
  it('an item twin shows the line on its page, keeps the star, and the name opens the exact grade', () => {
    const db = content();
    const rec = db.items[OLD] as { name: string; remasteredAs?: { bucket: string; id: string; name: string } };
    // the data half: the link names the GRADE, and the label is that record's own name
    expect(rec.remasteredAs).toEqual({ bucket: 'items', id: 'greater-backfire-mantle', name: db.items['greater-backfire-mantle']?.name });
    const { host, click, stop } = renderDom(
      <ContentContext.Provider value={db}>
        <PinContext.Provider value={pin}>
          <DescriptionModal root={{ title: rec.name, description: '', key: 'items', slug: OLD }} onClose={() => undefined} />
        </PinContext.Provider>
      </ContentContext.Provider>,
    );
    try {
      expect(host.querySelector('.ast-modal'), 'the popup renders the record\'s own page').toBeTruthy();
      const line = host.querySelector('.ast-body .sd-remastered');
      expect(line?.textContent).toBe(`Remastered as ${rec.remasteredAs!.name}`);
      expect(line!.classList.contains('sd-ours')).toBe(true);
      expect(host.querySelector('.info-star'), 'the favourite star stays on the popup').toBeTruthy();

      click(host.querySelector('.sd-remastered .ref-link'));
      expect(host.querySelector('.ast-name')?.textContent?.trim(), 'the popup now shows the reprint grade').toBe(rec.remasteredAs!.name);
      expect(host.querySelector('.info-back'), 'Back returns to the old printing').toBeTruthy();
      expect(host.querySelector('.sd-remastered'), 'the reprint itself carries no such line').toBeNull();
      expect(host.querySelector('.info-star')).toBeTruthy();
    } finally { stop(); }
  });

  it('the link opens a record of ANOTHER kind by its bucket — a sidebar whose link names a rules page', async () => {
    const db = {
      sidebar: { 'old-sidebar': { id: 'old-sidebar', name: 'Old Sidebar', description: 'The old printing.', remasteredAs: { bucket: 'rules', id: 'new-page', name: 'New Page' } } },
      rules: { 'new-page': { id: 'new-page', name: 'New Page', description: 'The reprint page.' } },
    } as unknown as ContentDatabase;
    const { host, click, stop } = renderDom(
      <ContentContext.Provider value={db}>
        <PinContext.Provider value={pin}>
          <DescriptionModal root={{ title: 'Old Sidebar', description: 'The old printing.', key: 'sidebar', slug: 'old-sidebar' }} onClose={() => undefined} />
        </PinContext.Provider>
      </ContentContext.Provider>,
    );
    try {
      await settle(); // no page tree for these: the popup settles on its plain-text path
      expect(host.textContent).toContain('The old printing.');
      expect(host.querySelector('.sd-remastered')?.textContent).toBe('Remastered as New Page');
      expect(host.querySelector('.info-star')).toBeTruthy();
      click(host.querySelector('.sd-remastered .ref-link'));
      await settle();
      expect(host.querySelector('.info-title')?.textContent).toBe('New Page');
      expect(host.textContent).toContain('The reprint page.');
    } finally { stop(); }
  });

  it('a record with no link shows no line', async () => {
    const db = { sidebar: { plain: { id: 'plain', name: 'Plain', description: 'Never reprinted.' } } } as unknown as ContentDatabase;
    const { host, stop } = renderDom(
      <ContentContext.Provider value={db}>
        <DescriptionModal root={{ title: 'Plain', description: 'Never reprinted.', key: 'sidebar', slug: 'plain' }} onClose={() => undefined} />
      </ContentContext.Provider>,
    );
    try {
      await settle();
      expect(host.textContent).toContain('Never reprinted.');
      expect(host.querySelector('.sd-remastered')).toBeNull();
    } finally { stop(); }
  });
});
