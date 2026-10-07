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
import { cardOn } from '../src/sheet/cardSurfaces';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { isNotOwnPage, pageSliceOf, recordTree, withoutItemLists } from '../src/sheet/astVisibility';
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

/** Card step 12: the read every popup made BEFORE step 12 — variantSection as it stood at 9612a13 (the
 *  exact-slug key only; verbatim), no not-own-page list, no page slices. */
const flatRaw = (n: AstNode): string => (n.t === 'text' ? n.v ?? '' : (n.c ?? []).map(flatRaw).join(''));
const slugOf = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function preStep12Cut(node: AstNode, slug: string): AstNode {
  const isSection = (n: AstNode) => n.t === 'title' && Number(n.level ?? 1) === 2;
  const top = node.c ?? [];
  let sections = 0, first = -1, mine = -1;
  for (let i = 0; i < top.length; i++) {
    if (!isSection(top[i])) continue;
    sections++;
    if (first < 0) first = i;
    if (mine < 0 && slugOf(flatRaw(top[i])) === slug) mine = i;
  }
  if (mine < 0 || sections < 2) return node;
  let end = top.length;
  for (let i = mine + 1; i < top.length; i++) if (isSection(top[i])) { end = i; break; }
  const shared = top.slice(0, first).filter((n) => !(n.t === 'title' && Number(n.level ?? 1) <= 1));
  return { ...node, c: [{ ...top[mine], level: 1 }, ...shared, ...top.slice(mine + 1, end)] };
}
/** The "bucket:id" keys whose read step 12 changed, with why (on this file's loaded buckets). */
function step12Changed(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of new Set(keys)) {
    const [b, s] = k.split(':');
    const old = trees[b]?.[s] ? preStep12Cut(trees[b][s], s) : undefined;
    const now = recordTree(b, s, (x, y) => trees[x]?.[y]);
    if (JSON.stringify(old) === JSON.stringify(now)) continue;
    out[k] = pageSliceOf(b, s) ? 'F6b page slice' : isNotOwnPage(b, s) ? 'F6 not own page: own text' : 'F5 own section';
  }
  return out;
}
/** Measured 2026-10-06 in the step-12 lane on the shipped data (see the re-baseline block): 24 of the
 *  720 keys (25 until round 4 gave Oil (1 pint) its page back). Implement benefits and grade variants now show their own section of the family page (F5);
 *  doctrines, creeds, an alchemist research-field benefit and an inventor modification show their own
 *  bullet / section of the page they live in, and wand ranks their own section of the wand page (F6b);
 *  records whose family page holds no section of their own show their own text (F6). Before step 12 each
 *  drew the whole family page. */
const STEP12_CHANGED_NOOP: Record<string, string> = {
  'classFeatures:adept-benefit-bell': 'F5 own section',
  'classFeatures:adept-benefit-lantern': 'F5 own section',
  'classFeatures:adept-benefit-regalia': 'F5 own section',
  'classFeatures:adept-benefit-weapon': 'F5 own section',
  'classFeatures:advanced-vials-mutagenist': 'F6b page slice',
  'classFeatures:camouflage-pigmentation': 'F6b page slice',
  'classFeatures:first-doctrine-cloistered-cleric': 'F6b page slice',
  'classFeatures:first-doctrine-warpriest': 'F6b page slice',
  'classFeatures:fourth-doctrine-warpriest': 'F6b page slice',
  'classFeatures:initiate-benefit-shield': 'F5 own section',
  'classFeatures:initiate-benefit-wand': 'F5 own section',
  'classFeatures:initiate-benefit-weapon': 'F5 own section',
  'classFeatures:major-creed': 'F6b page slice',
  'classFeatures:paragon-benefit-chalice': 'F5 own section',
  'classFeatures:perpetual-perfection-mutagenist': 'F6 not own page: own text',
  'classFeatures:second-doctrine-warpriest': 'F6b page slice',
  'classFeatures:third-doctrine-warpriest': 'F6b page slice',
  'items:bloodstone-doll-moderate': 'F5 own section',
  // batch card premise: equipment-1166 "Fire A massive explosion knocks the target back" — round 3:
  // the drake rifle reads the family page with only its own line of the variant list (F6b kind 'line').
  'items:drake-rifle-fire': 'F6b page slice',
  'items:toothy-knife-greater': 'F5 own section',
  'items:transmuting-ingot-silver': 'F5 own section',
  // Round 2: a wand rank reads its own "(Nth-Rank Spell)" section of the wand page (F6b, route R0), not old text.
  'items:wand-of-dazzling-rays-3rd-rank': 'F6b page slice',
  'items:wand-of-mercy-8th-rank': 'F6b page slice',
  'items:wand-of-teeming-ghosts-5th-rank': 'F6b page slice',
};

/** The three tree renders for one record: what a held record's popup body shows (the real DescBody),
 *  the same body rendered straight from the cuts, and the search popup (the real DescriptionModal). */
function astRenders(bucket: string, slug: string) {
  const rec = recs(bucket)[slug];
  // batch card premise: doctrine-4 "Second Doctrine (3rd)" — card step 12: the read is recordTree (the
  // record's slice of a bigger page, none when its page is not its own, else variantSection), which
  // useAstNode makes; a record with no tree to read renders no body here (DescBody falls back).
  const tree = recordTree(bucket, slug, (b, s) => trees[b]?.[s]);
  const descBody = wrap(<DescBody description={rec.description ?? ''} descRefs={rec.descRefs as never} astKey={bucket} astId={slug} />);
  const body = tree
    ? wrap(<AstRenderer node={withoutItemLists(tree)} bodyOnly hideMeta selfRef={`${bucket}:${slug}`} onOpenRef={noop} />)
    : '';
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
      // batch card premise: doctrine-4 "Second Doctrine (3rd)" — a record with no tree to read
      // (not-own-page.json) draws its own text, never a page body.
      if (!body) expect(descBody.includes('ast-body'), `${bucket}:${slug} falls back to its own text`).toBe(false);
      else expect(descBody.startsWith(`<div class="sd-desc">${body}`), `${bucket}:${slug}`).toBe(true);
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
    // Card step 11 (docs/card-design.md section 9: a surface's legacy assertions run while its switch is
    // off): with CARD_ON.featDetail the row is the record's mine card, which prints NO stat rows over a page
    // (its printed set is empty, so the page's own use lines show) and, on the no-page lane, only the
    // Prerequisites row of the same function (the glyph sits in the header, the enhancement in the box).
    // The seeded sample need not hold a no-page row WITH prerequisites (on 2026-10-07 none of its rows
    // did); test/card-feat.test.tsx pins that lane on dedication-to-the-five ("Order of the Godclaw").
    // batch card premise: feat-928 "Prerequisites Charisma 14"
    featRows.forEach((r, i) => {
      const want = cardOn('featDetail')
        ? (recordTree(r.bucket, r.id, (b, s) => trees[b]?.[s]) ? [] : featRowsFn(r, i).filter(([k]) => k === 'Prerequisites'))
        : featRowsFn(r, i);
      // batch card premise: feat-928 "Prerequisites Charisma 14"
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
    // Card step 12 re-baseline: a record whose READ step 12 changed (its own section cut out of a family
    // page, its own text in place of a page that is not its own, its slice of a bigger page) draws a
    // different body by design. Those are pinned with their reason in STEP12_CHANGED_NOOP and must differ
    // (the DescBody and bare-body renders; the search popup too); every other render stays byte-equal.
    // batch card premise: doctrine-4 "Second Doctrine (3rd)" — the record's own bullet of the doctrine page is its page.
    const keys = [...sample.map(({ bucket, slug }) => `${bucket}:${slug}`), ...itemIds.map((id) => `items:${id}`), ...featRows.map((r) => `${r.bucket}:${r.id}`)];
    const changed = step12Changed(keys);
    expect(changed).toEqual(STEP12_CHANGED_NOOP);
    let diffs = 0;
    for (const k of Object.keys(now.ast)) {
      for (const f of ['descBody', 'body', 'modal'] as const) {
        if (now.ast[k][f] !== before.ast[k][f]) diffs++;
        if (k in changed) continue;
        expect(now.ast[k][f], `${k} ${f}`).toBe(before.ast[k][f]);
      }
      if (k in changed) expect(now.ast[k].descBody, `${k} (${changed[k]}) changed`).not.toBe(before.ast[k].descBody);
    }
    // Card step 11: with CARD_ON.featDetail the feat popups are the mine card by design (60 of 60 differ);
    // their byte-equality is the legacy assertion and runs while the switch is off. Items and spells stay.
    // batch card premise: feat-928 "Prerequisites Charisma 14"
    for (const surface of (cardOn('featDetail') ? ['items', 'spells'] : ['items', 'feats', 'spells']) as ('items' | 'feats' | 'spells')[]) {
      expect(Object.keys(now[surface])).toEqual(Object.keys(before[surface]));
      for (const k of Object.keys(now[surface])) {
        const key = surface === 'items' ? `items:${k}` : k;
        if (surface !== 'spells' && key in changed) {
          expect(now[surface][k].markup, `${surface} ${k} (${changed[key]}) changed`).not.toBe(before[surface][k].markup);
          expect(now[surface][k].rows, `${surface} ${k} rows`).toEqual(before[surface][k].rows);
          continue;
        }
        expect(now[surface][k].markup, `${surface} ${k} popup`).toBe(before[surface][k].markup);
        expect(now[surface][k].rows, `${surface} ${k} rows`).toEqual(before[surface][k].rows);
      }
    }
    expect(diffs).toBe(Object.keys(now.ast).filter((k) => k in changed).reduce((n, k) => n + ['descBody', 'body', 'modal'].filter((f) => now.ast[k][f as 'body'] !== before.ast[k][f as 'body']).length, 0));
    // The exported functions reproduce TODAY's rows — the rows the pre-move popups printed.
    for (const id of itemIds) expect(itemRowsFn(id), `item ${id} vs pre-move`).toEqual(before.items[id].rows);
    featRows.forEach((r, i) => expect(featRowsFn(r, i), `${r.bucket} ${r.id} vs pre-move`).toEqual(before.feats[`${r.bucket}:${r.id}`].rows));
    for (const id of spellIds) expect(spellRowsFn(id), `spell ${id} vs pre-move`).toEqual(blankCast(before.spells[id].rows));
  });
});
