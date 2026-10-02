// @vitest-environment jsdom
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { content } from './_content';
import { AstRenderer } from '../src/sheet/AstRenderer';
import { DescBody } from '../src/sheet/DescBody';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { ItemDetail, itemStatRows } from '../src/sheet/ItemDetail';
import { FeatDetail, featStatRows, type FeatEntry } from '../src/sheet/FeatDetail';
import { SpellDetail, spellStatRows } from '../src/sheet/SpellsTab';
import { ActionGlyph } from '../src/sheet/widgets';
import { ContentContext } from '../src/sheet/ContentContext';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { variantSection, withoutItemLists } from '../src/sheet/astVisibility';
import type { ActionCost, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * Card step 1 (docs/card-design.md section 9, row 1, "G0"): a NO-BEHAVIOUR-CHANGE move.
 *
 * The tree-visibility predicates (META, isMetaP, isSourceP, STAT_LABELS, isMetaishBlock, from
 * AstRenderer.tsx) and the two tree cuts (variantSection, withoutItemLists, from useAst.ts) move into
 * src/sheet/astVisibility.ts — a plain .ts file, so the step-4 guard can import through jiti exactly
 * what the card renders with. The three surfaces' stat rows become exported pure functions
 * (itemStatRows, featStatRows, spellStatRows) that the popups themselves render from: ONE copy.
 *
 * What this file proves, on records drawn by mulberry32(20261002), 120 per bucket over feats,
 * classFeatures, items, actions and spells (600), plus 60 per stat-row surface:
 *
 *  1. ALWAYS: the sample is what it says it is, and the held-record path (DescBody) renders exactly
 *     AstRenderer(bodyOnly, hideMeta) over withoutItemLists(variantSection(tree)) — the cuts are wired.
 *  2. ALWAYS: each surface's stat rows on screen are the rows its exported function returns, so the
 *     component cannot grow a second copy.
 *  3. WITH A SNAPSHOT (env CARD_NOOP_SNAPSHOT=<json path>): byte-equal markup against the same renders
 *     produced by the pre-move code — the DescBody path, the bare body path and the full
 *     DescriptionModal path for all 600, the three popups for 60 each, and the stat rows the functions
 *     return equal today's rows. `CARD_NOOP_WRITE=1` writes the snapshot instead (run that on the
 *     pre-move tree). The snapshot is scratch: it pins one tree's output on one data stamp, so it is
 *     never committed; without the variable this block skips and says so.
 *
 * Every render is renderToStaticMarkup with the bucket caches warm, so useAstNode seeds synchronously
 * from getCachedAst (useAst.ts) and no effect or timer runs. Fixtures are the shipped records only.
 *
 * Measured 2026-10-02: snapshot written on HEAD a5b9d0b before any edit (600 × 3 tree renders, 180
 * popups, 465 stat rows), then compared after the move: 0 differences.
 *
 * MUTATION LINES (each measured red on 2026-10-02, then restored byte-exact):
 *  - astVisibility.ts META: `source` → `xsourcex` → block 3 red (feats:armor-regiment-training modal).
 *  - astVisibility.ts variantSection: always return the node → block 3 red (items:healing-potion-major).
 *  - ItemDetail.tsx: a second hard-coded Price <Stat> after the rows → block 2 red.
 *  - ItemDetail.tsx itemStatRows: drop the Bulk row → block 3 red (the popup follows the function).
 *  - FeatDetail.tsx: the Enhancement cell prints entry.enhancedBy instead of the row → block 2 red.
 *  - SpellsTab.tsx spellStatRows: drop the Duration row → block 3 red (spells gravity-weapon).
 */
const SEED = 20261002;
const BUCKETS = ['feats', 'classFeatures', 'items', 'actions', 'spells'] as const;
const PER_BUCKET = 120;
const PER_SURFACE = 60;
const SNAP = process.env.CARD_NOOP_SNAPSHOT;
const WRITE = process.env.CARD_NOOP_WRITE === '1';

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** `n` distinct members of `pool` (already sorted), drawn by a partial Fisher–Yates on a copy. */
function draw<T>(pool: T[], n: number, rng: () => number): T[] {
  const a = pool.slice();
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) as Record<string, AstNode>;
const noop = () => undefined;
const db: ContentDatabase = content();
const recs = (bucket: string) => (db as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: unknown }>>)[bucket] ?? {};

const trees: Record<string, Record<string, AstNode>> = {};
let sample: { bucket: string; slug: string }[] = [];
let itemIds: string[] = [];
let featRows: { bucket: 'feats' | 'classFeatures'; id: string }[] = [];
let spellIds: string[] = [];

beforeAll(async () => {
  for (const b of BUCKETS) trees[b] = readGz(`public/ast/${b}.json.gz`);
  // Warm the module cache through the loader's own raw-json fallback (the .gz fetch answers not-ok).
  vi.stubGlobal('fetch', async (url: string) => {
    const m = /ast\/(\w+)\.json$/.exec(String(url));
    return m && trees[m[1]] ? { ok: true, json: async () => trees[m[1]] } : { ok: false };
  });
  for (const b of BUCKETS) await loadBucketAst(b);
  // jsdom has no matchMedia; useIsMobile reads it on first render (desktop-shaped, as test/_render does).
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;

  const rng = mulberry32(SEED);
  sample = BUCKETS.flatMap((b) => {
    const pool = Object.keys(trees[b]).filter((s) => recs(b)[s]).sort();
    return draw(pool, PER_BUCKET, rng).map((slug) => ({ bucket: b, slug }));
  });
  itemIds = draw(Object.keys(db.items).sort(), PER_SURFACE, rng);
  const featPool = [
    ...Object.keys(db.feats).sort().map((id) => ({ bucket: 'feats' as const, id })),
    ...Object.keys(db.classFeatures).sort().map((id) => ({ bucket: 'classFeatures' as const, id })),
  ];
  featRows = draw(featPool, PER_SURFACE, rng);
  spellIds = draw(Object.keys(db.spells).sort(), PER_SURFACE, rng);
});

const wrap = (el: ReactElement) => renderToStaticMarkup(<ContentContext.Provider value={db}>{el}</ContentContext.Provider>);

/** The three tree renders for one record: what a held record's popup body shows (the real DescBody),
 *  the same body rendered straight from the cuts, and the search popup (the real DescriptionModal). */
function astRenders(bucket: string, slug: string) {
  const rec = recs(bucket)[slug];
  const tree = trees[bucket][slug];
  const descBody = wrap(<DescBody description={rec.description ?? ''} descRefs={rec.descRefs as never} astKey={bucket} astId={slug} />);
  const body = wrap(
    <AstRenderer node={withoutItemLists(variantSection(tree, slug))} bodyOnly hideMeta selfRef={`${bucket}:${slug}`} onOpenRef={noop} />,
  );
  const modal = wrap(
    <DescriptionModal root={{ title: rec.name, description: rec.description ?? '', descRefs: rec.descRefs as never, key: bucket, slug }} onClose={noop} />,
  );
  return { descBody, body, modal };
}

function featEntry(r: { bucket: 'feats' | 'classFeatures'; id: string }, i: number): FeatEntry {
  const f = (db[r.bucket] as Record<string, Record<string, unknown>>)[r.id] as {
    name: string; level?: number; traits?: string[]; actionCost?: ActionCost; description?: string; descRefs?: never;
    rarity?: string; prerequisites?: string[]; category?: string;
  };
  const isFeature = r.bucket === 'classFeatures';
  return {
    key: `${r.bucket}:${r.id}`,
    name: f.name,
    level: f.level ?? 1,
    traits: f.traits ?? [],
    actionCost: f.actionCost,
    description: f.description ?? '',
    descRefs: f.descRefs,
    isFeature,
    bucket: isFeature ? 'class' : (f.category ?? 'general'),
    rarity: f.rarity,
    prerequisites: f.prerequisites,
    ...(isFeature ? { featureId: r.id } : { featId: r.id }),
    // Every fourth row runs an enhancement tier, so the Enhancement stat row is exercised too.
    ...(i % 4 === 0 ? { enhancedBy: 'Synthesized Enhancer' } : {}),
  };
}

/** Rendered popups for the three stat-row surfaces. */
const itemPopup = (id: string) =>
  wrap(<ItemDetail inv={{ instanceId: `noop-${id}`, itemId: id, quantity: 1 } as InventoryItem} item={db.items[id]} content={db} onClose={noop} />);
const featPopup = (r: { bucket: 'feats' | 'classFeatures'; id: string }, i: number) => wrap(<FeatDetail entry={featEntry(r, i)} onClose={noop} />);
const spellPopup = (id: string) => wrap(<SpellDetail spell={db.spells[id]} onClose={noop} />);

/** The stat rows a popup's markup shows, read off the DOM: [label, value text]. The Activate line of
 *  a feat reads [Activate, its glyph markup]; a spell's heightened-area suffix is not part of the row. */
function shownRows(markup: string): [string, string][] {
  const host = document.createElement('div');
  host.innerHTML = markup;
  const out: [string, string][] = [];
  for (const el of host.querySelectorAll('.sd-activate, .sd-stats .sd-stat')) {
    if (el.matches('.sd-activate')) {
      out.push(['Activate', el.innerHTML]);
      continue;
    }
    const v = el.querySelector('.sd-stat-v')!.cloneNode(true) as HTMLElement;
    v.querySelectorAll('.up-heighten').forEach((s) => s.remove());
    out.push([el.querySelector('.sd-stat-k')!.textContent ?? '', v.textContent ?? '']);
  }
  return out;
}

/** Markup through the same DOM round trip shownRows reads with, so serializer details cannot differ. */
function viaDom(markup: string): string {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host.innerHTML;
}
/** What each exported stat-row function says the popup prints, in shownRows' shape. A spell's Cast row
 *  holds no value in the function (the popup draws the glyph), so its value is compared blank. */
const itemRowsFn = (id: string): [string, string][] => itemStatRows(db.items[id], db).map((r) => [r.k, String(r.v)]);
const featRowsFn = (r: { bucket: 'feats' | 'classFeatures'; id: string }, i: number): [string, string][] =>
  featStatRows(featEntry(r, i)).map((row) =>
    row.k === 'Activate'
      ? ['Activate', viaDom(renderToStaticMarkup(<><strong>Activate</strong> <ActionGlyph cost={row.cost} /></>))]
      : [row.k, row.v],
  );
const spellRowsFn = (id: string): [string, string][] =>
  spellStatRows(db.spells[id]).filter(([k, v]) => k === 'Cast' || v).map(([k, v]) => [k, k === 'Cast' ? '' : v!]);
const blankCast = (rows: [string, string][]): [string, string][] => rows.map(([k, v]) => [k, k === 'Cast' ? '' : v]);

describe('card step 1 (G0): the move changes no markup', () => {
  it('draws 600 records with a page, 120 per bucket, and 60 per stat-row surface', () => {
    expect(sample.length).toBe(BUCKETS.length * PER_BUCKET);
    expect(new Set(sample.map((s) => `${s.bucket}:${s.slug}`)).size).toBe(sample.length);
    for (const b of BUCKETS) expect(sample.filter((s) => s.bucket === b).length, b).toBe(PER_BUCKET);
    expect([itemIds.length, featRows.length, spellIds.length]).toEqual([PER_SURFACE, PER_SURFACE, PER_SURFACE]);
  });

  it('a held record renders its page through variantSection + withoutItemLists, body only, meta hidden', () => {
    let wired = 0;
    for (const { bucket, slug } of sample) {
      const { descBody, body } = astRenders(bucket, slug);
      // DescBody = <div class="sd-desc">{that body}{remastered line}</div>.
      expect(descBody.startsWith(`<div class="sd-desc">${body}`), `${bucket}:${slug}`).toBe(true);
      wired++;
    }
    expect(wired).toBe(sample.length);
  });

  it('each popup prints exactly the rows its exported stat-row function returns (one copy)', () => {
    let rows = 0;
    for (const id of itemIds) {
      const want = itemRowsFn(id);
      expect(shownRows(itemPopup(id)), `item ${id}`).toEqual(want);
      rows += want.length;
    }
    featRows.forEach((r, i) => {
      const want = featRowsFn(r, i);
      expect(shownRows(featPopup(r, i)), `${r.bucket} ${r.id}`).toEqual(want);
      rows += want.length;
    });
    for (const id of spellIds) {
      const want = spellRowsFn(id);
      expect(blankCast(shownRows(spellPopup(id))), `spell ${id}`).toEqual(want);
      rows += want.length;
    }
    // Not vacuous: every surface draws rows, and each feat row kind appears at least once.
    expect(rows).toBeGreaterThan(3 * PER_SURFACE);
    const featKinds = new Set(featRows.flatMap((r, i) => featStatRows(featEntry(r, i)).map((x) => x.k)));
    expect([...featKinds].sort()).toEqual(['Activate', 'Enhancement', 'Prerequisites']);
  });

  it.skipIf(!SNAP)('byte-equal to the pre-move render (CARD_NOOP_SNAPSHOT)', () => {
    const now = {
      ast: Object.fromEntries(sample.map(({ bucket, slug }) => [`${bucket}:${slug}`, astRenders(bucket, slug)])),
      items: Object.fromEntries(itemIds.map((id) => { const m = itemPopup(id); return [id, { markup: m, rows: shownRows(m) }]; })),
      feats: Object.fromEntries(featRows.map((r, i) => { const m = featPopup(r, i); return [`${r.bucket}:${r.id}`, { markup: m, rows: shownRows(m) }]; })),
      spells: Object.fromEntries(spellIds.map((id) => { const m = spellPopup(id); return [id, { markup: m, rows: shownRows(m) }]; })),
    };
    if (WRITE) {
      writeFileSync(SNAP!, JSON.stringify(now));
      return;
    }
    expect(existsSync(SNAP!), `snapshot ${SNAP} missing — write it on the pre-move tree with CARD_NOOP_WRITE=1`).toBe(true);
    const before = JSON.parse(readFileSync(SNAP!, 'utf8')) as typeof now;
    expect(Object.keys(now.ast)).toEqual(Object.keys(before.ast));
    let diffs = 0;
    for (const k of Object.keys(now.ast)) {
      for (const f of ['descBody', 'body', 'modal'] as const) {
        if (now.ast[k][f] !== before.ast[k][f]) diffs++;
        expect(now.ast[k][f], `${k} ${f}`).toBe(before.ast[k][f]);
      }
    }
    for (const surface of ['items', 'feats', 'spells'] as const) {
      expect(Object.keys(now[surface])).toEqual(Object.keys(before[surface]));
      for (const k of Object.keys(now[surface])) {
        expect(now[surface][k].markup, `${surface} ${k} popup`).toBe(before[surface][k].markup);
        expect(now[surface][k].rows, `${surface} ${k} rows`).toEqual(before[surface][k].rows);
      }
    }
    expect(diffs).toBe(0);
    // The exported functions reproduce TODAY's rows — the rows the pre-move popups printed.
    for (const id of itemIds) expect(itemRowsFn(id), `item ${id} vs pre-move`).toEqual(before.items[id].rows);
    featRows.forEach((r, i) => expect(featRowsFn(r, i), `${r.bucket} ${r.id} vs pre-move`).toEqual(before.feats[`${r.bucket}:${r.id}`].rows));
    for (const id of spellIds) expect(spellRowsFn(id), `spell ${id} vs pre-move`).toEqual(blankCast(before.spells[id].rows));
  });
});
