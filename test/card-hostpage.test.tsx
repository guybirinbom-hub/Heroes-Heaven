// @vitest-environment jsdom
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { RecordCard } from '../src/sheet/RecordCard';
import { AstRenderer } from '../src/sheet/AstRenderer';
import { DescBody } from '../src/sheet/DescBody';
import { RemasteredLine, remasteredAsOf } from '../src/sheet/RemasteredLine';
import { refLinkHtml } from '../src/sheet/RichEditor';
import { useAstNode } from '../src/sheet/useAst';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import type { ContentDatabase, DescRef } from '../src/rules/types';
import { judgeRow, surfaceRows } from '../scripts/lib/card-scope.mjs';
import LEDGER from '../src/data/trust-ledger.json';

/* CampaignTracker pulls in the whole tracker; mounted with no account, as test/gm-search-popup.test.tsx does. */
vi.mock('../src/integration/enabled', () => ({ TRACKER_IN_CAMPAIGN: true, TEST_CAMPAIGNS_WITHOUT_LOGIN: false }));
vi.mock('../src/data/useAuth', () => {
  const AUTH = { status: 'disabled', session: null, email: null };
  return { useAuth: () => AUTH, signOut: async () => undefined };
});
const { HostPage, openHostWindow } = await import('../src/integration/CampaignTracker');
const { useWindowStore, BASE_Z } = await import('../tracker/src/store/windowStore');

/**
 * The pre-card GM screen page — CampaignTracker.tsx's HostPageLegacy, verbatim, as it stood until card
 * step 22 removed it from src. Kept HERE, as the reference the card must equal byte for byte (the card's
 * gm/embed branch replaced it in step 6 "drawn byte for byte as before"); no surface renders it. Its body
 * is AstRenderer with no hideMeta (the GM page always kept its stat lines), so nothing it uses left src.
 */
function PreCardHostPage({ content, bucket, id, onOpen }: {
  content: ContentDatabase; bucket: string; id: string; onOpen: (bucket: string, id: string) => void;
}) {
  const rec = (content as unknown as Record<string, Record<string, { description?: string; descRefs?: DescRef[] }> | undefined>)[bucket]?.[id];
  const { node, loading } = useAstNode(bucket, id);
  // desk #158: a pinned old printing says what it was remastered as; the name opens the reprint in HH's popup.
  const ra = remasteredAsOf(content, { bucket, id });
  if (!rec) return <p className="sd-ours">This page is not in this version of Heroes Heaven.</p>;
  if (node) return <AstRenderer node={node} bodyOnly selfRef={`${bucket}:${id}`} onOpenRef={onOpen} footer={ra ? <RemasteredLine ra={ra} onOpen={onOpen} /> : null} />;
  if (loading) return <div className="ast-body ast-loading" aria-busy="true" />;
  return <DescBody description={rec.description} descRefs={rec.descRefs} remasteredAs={ra} />;
}

/**
 * Card step 6 (docs/card-design.md section 9 row 6; section 6 "gm: HostPage … The whole page with its stat
 * lines, embed chrome"): the page a GM pinned to the GM screen (CampaignTracker.tsx HostPage, the `host`
 * pane tab the tracker opens for a Heroes Heaven record from the GM Search or a pinned page) renders
 * through RecordCard with mode 'gm' and chrome 'embed'. NO behaviour change for the GM. (Card step 22
 * removed the switch and the legacy HostPage from src; the legacy page lives on above as this file's
 * reference render, PreCardHostPage.)
 *
 * What this file proves:
 *
 *  1. WITH A SNAPSHOT (env CARD_HOST_SNAPSHOT=<json path>): byte-equal markup against the same renders
 *     produced by the pre-step HostPage, for a sample drawn by mulberry32(20261002): 200 records with a
 *     page over spells 40 / feats 30 / items 30 / actions 20 / classFeatures 20 / reference 20 / trait 20 /
 *     conditions 10 / deities 10, 20 records with NO page (static first frame AND the mounted frame after
 *     the hook settles), up to 10 records carrying a "Remastered as" line (both frames) and 2 records not
 *     in this version (both frames). Every second render sits inside the app's ContentContext (the live
 *     app: CampaignsPage is under App's provider), the others outside it (test/gm-search-popup's mount).
 *     `CARD_HOST_WRITE=1` writes the snapshot instead (run that on the pre-step tree). The snapshot is
 *     scratch — it pins one tree's output on one data stamp — so it is never committed; without the
 *     variable this block skips and says so.
 *  2. ALWAYS: the card's embed branch (RecordCard mode 'gm', chrome 'embed') renders exactly what the
 *     legacy HostPage (PreCardHostPage) renders for every sampled record, both frames, in and out of the
 *     context; HostPage IS the card; the page keeps its stat
 *     lines (air-walk's Range and Duration); the embedded body is the browse popup's body (nothing
 *     dropped); a link and the "Remastered as" name open through the host's onOpen, as before; mounting
 *     the page pushes nothing on the dismiss stack (no phone Back-trap history entry), as before; and
 *     the guard's ledger models the GM page like browse (scripts/lib/card-scope.mjs surfaceRows 'gm').
 *
 * Measured 2026-10-02: the snapshot was written with the pre-step HostPage (HEAD 1ddc546, only `export`
 * added so this file can import it): 232 records, 210 page bodies (37 with a Range or Duration line), 20
 * loading placeholders that settle to the old text, 15 with a "Remastered as" line, 2 not in this version.
 * After the step: 0 differences.
 *
 * ITEM 7 (2026-10-11, the owner's online list: "Search everything results open in the tracker's movable,
 * windowed stat-block popup, not a static popup"). HostPage moved from chrome 'embed' to the new chrome
 * 'window' — the page inside a tracker window or GM-screen pane, with the page head under the window's
 * header (action glyph, level badge, Archives link, trait chips) over the SAME body. 'embed' itself is
 * unchanged, so every leg that pins the embed markup now renders the embed card directly (`cardEl`) where it
 * rendered HostPage (`hostEl`): the snapshot leg, the browse-body leg and the link leg. The "HostPage is
 * the card" leg names the window chrome, and the legs after the ledger pin the window chrome itself:
 * its body is the embed body byte for byte, its head is the popup's head without the name, a link hands
 * the host the point it was clicked at, and a record with no page opens its links through the host.
 *
 * MUTATION LINES (each measured red on 2026-10-02, then restored byte-exact from a scratch copy):
 *  - RecordCard EmbedRecordCard: `bodyOnly` dropped → snapshot, embed = legacy, air-walk and browse-body
 *    cases red.
 *  - EmbedRecordCard: the RemasteredLine footer → null → snapshot, embed = legacy, browse-body and
 *    link cases red.
 *  - EmbedRecordCard: `onOpenRef ?? noOpen` → `noOpen` → the link case red.
 *  - EmbedRecordCard: `useEscapeClose(undefined)` added → the dismiss-stack case red.
 *  - card-scope.mjs gm rows with `itemLists: false` → the ledger case red.
 *  - (card step 22) CampaignTracker HostPage: `mode="gm"` → `mode="browse"` → the "HostPage is the card"
 *    case red.
 *  (item 7, each applied, run and read off that run, then restored:)
 *  - CampaignTracker HostPage: `chrome="window"` → `chrome="embed"` → "HostPage is the card" red, and the
 *    window-head leg red (no `.ast-win`).
 *  - AstRenderer windowHead: the `ast-win-head` block dropped → the window-head leg red (no Archives link).
 *  - AstRenderer Inline link: `clickAt(e)` dropped from the call → the click-point leg red.
 *  - DescBody: `if (n && onOpenRecord) { … }` dropped → the no-page leg red (DescBody's own popup opens).
 *  - RemasteredLine clickPoint: the keyboard branch (`if (e.detail === 0 && …) { …box… }`) dropped → the
 *    no-page leg red at "a keyboard click hands over the link's box" and the Remastered leg red at
 *    "Enter on the name" (both {0, 0}: the screen's top-left corner).
 *  - (item 7, refuter round 2) RecordCard WindowRecordCard: `headerControls={marker}` dropped → the marker
 *    leg red ("the window head draws the same line": null).
 *  - (item 7, refuter round 3) DescBody's rich-HTML lane: `if (onOpenRecord) return onOpenRecord(key, id, at);`
 *    dropped → the homebrew leg red ("another window": none — DescBody's own popup opened inside the
 *    window instead). The markdown no-page leg above never reaches that lane.
 */
const SEED = 20261002;
const PAGE_COUNTS = { spells: 40, feats: 30, items: 30, actions: 20, classFeatures: 20, reference: 20, trait: 20, conditions: 10, deities: 10 } as const;
const BUCKETS = Object.keys(PAGE_COUNTS) as (keyof typeof PAGE_COUNTS)[];
const NO_PAGE = 20;
const REMASTERED = 10;
const SNAP = process.env.CARD_HOST_SNAPSHOT;
const WRITE = process.env.CARD_HOST_WRITE === '1';

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

type Rec = { name: string; description?: string; descRefs?: DescRef[]; remasteredAs?: unknown };
const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) as Record<string, AstNode>;
const noop = () => undefined;
const db: ContentDatabase = content();
const recs = (bucket: string) => (db as unknown as Record<string, Record<string, Rec>>)[bucket] ?? {};

type Kind = 'page' | 'nopage' | 'remastered' | 'missing';
type Entry = { kind: Kind; key: string; bucket: string; id: string };
const trees: Record<string, Record<string, AstNode>> = {};
let sample: Entry[] = [];

beforeAll(async () => {
  for (const b of BUCKETS) trees[b] = readGz(`public/ast/${b}.json.gz`);
  // The trees through the loader's raw-json fallback (the .gz fetch answers not-ok), as card-browse does.
  vi.stubGlobal('fetch', async (url: string) => {
    const m = /ast\/(\w+)\.json$/.exec(String(url));
    return m && trees[m[1]] ? { ok: true, json: async () => trees[m[1]] } : { ok: false };
  });
  for (const b of BUCKETS) await loadBucketAst(b);
  if (!window.matchMedia) window.matchMedia = mediaQuery(false);

  const rng = mulberry32(SEED);
  const pages: Entry[] = BUCKETS.flatMap((b) => {
    const pool = Object.keys(trees[b]).filter((s) => recs(b)[s]).sort();
    return draw(pool, PAGE_COUNTS[b], rng).map((id) => ({ kind: 'page' as const, key: `${b}:${id}`, bucket: b, id }));
  });
  const noPagePool = BUCKETS.flatMap((b) => Object.keys(recs(b)).filter((s) => !trees[b][s] && !recs(b)[s]?.remasteredAs).sort().map((s) => `${b}:${s}`));
  const drawn = new Set(pages.map((p) => p.key));
  const remPool = BUCKETS.flatMap((b) => Object.keys(recs(b)).filter((s) => recs(b)[s]?.remasteredAs && !drawn.has(`${b}:${s}`)).sort().map((s) => `${b}:${s}`));
  const split = (k: string, kind: Kind): Entry => { const [b, id] = k.split(':'); return { kind, key: k, bucket: b, id }; };
  const noPage = draw(noPagePool, NO_PAGE, rng).map((k) => split(k, 'nopage'));
  const rem = draw(remPool, REMASTERED, rng).map((k) => split(k, 'remastered'));
  const missing: Entry[] = [
    { kind: 'missing', key: 'feats:card-step6-no-such-feat', bucket: 'feats', id: 'card-step6-no-such-feat' },
    { kind: 'missing', key: 'card-step6-no-bucket:x', bucket: 'card-step6-no-bucket', id: 'x' },
  ];
  sample = [...pages, ...noPage, ...rem, ...missing];
}, 120_000);

afterAll(() => { vi.unstubAllGlobals(); });

function mediaQuery(phone: boolean): typeof window.matchMedia {
  return ((q: string) => ({ matches: phone && q.includes('max-width'), media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}

/** The page as the GM screen mounts it: every second one under the app's ContentContext. */
const inCtx = (i: number, el: ReactElement): ReactElement => (i % 2 === 0 ? <ContentContext.Provider value={db}>{el}</ContentContext.Provider> : el);
const hostEl = (e: Entry, onOpen: (b: string, id: string) => void = noop) => <HostPage content={db} bucket={e.bucket} id={e.id} onOpen={onOpen} />;
const legacyEl = (e: Entry, onOpen: (b: string, id: string) => void = noop) => <PreCardHostPage content={db} bucket={e.bucket} id={e.id} onOpen={onOpen} />;
const cardEl = (e: Entry, onOpen: (b: string, id: string) => void = noop) => <RecordCard record={{ bucket: e.bucket, id: e.id }} mode="gm" chrome="embed" content={db} onOpenRef={onOpen} />;

const mounted: { stop: () => void }[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.stop();
});
/** Mount for real (effects run, the hook settles), returning the live host. */
async function mount(el: ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(el);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  mounted.push({ stop: () => { act(() => root.unmount()); host.remove(); } });
  return host;
}
async function settled(el: ReactElement): Promise<string> {
  const host = await mount(el);
  const html = host.innerHTML;
  mounted.pop()!.stop();
  return html;
}

type Frames = { first: string; settled?: string };
async function framesOf(make: (e: Entry) => ReactElement): Promise<Record<string, Frames>> {
  const out: Record<string, Frames> = {};
  for (let i = 0; i < sample.length; i++) {
    const e = sample[i];
    out[e.key] = { first: renderToStaticMarkup(inCtx(i, make(e))) };
    if (e.kind !== 'page') out[e.key].settled = await settled(inCtx(i, make(e)));
  }
  return out;
}

describe('card step 6: the GM screen page (HostPage) through RecordCard gm/embed', () => {
  // batch card: #card-NOT-VACUOUS — the sample holds every named case
  it('draws 200 page records, 20 without a page, the remastered ones and 2 not in this version', () => {
    expect(sample.filter((s) => s.kind === 'page').length).toBe(200);
    for (const b of BUCKETS) expect(sample.filter((s) => s.kind === 'page' && s.bucket === b).length, b).toBe(PAGE_COUNTS[b]);
    // batch card: #card-NOT-VACUOUS — no-page, remastered and not-in-this-version records are all sampled
    expect(sample.filter((s) => s.kind === 'nopage').length).toBe(NO_PAGE);
    expect(sample.filter((s) => s.kind === 'remastered').length).toBeGreaterThan(0);
    expect(sample.filter((s) => s.kind === 'missing').length).toBe(2);
    expect(new Set(sample.map((s) => s.key)).size).toBe(sample.length);
  });

  // batch card: #card-SNAPSHOT — the embed chrome stays byte-equal to the pre-step render
  // item 7: the embed card itself (cardEl), no longer HostPage, which draws the window chrome now.
  it.skipIf(!SNAP)('byte-equal to the pre-step HostPage (CARD_HOST_SNAPSHOT)', async () => {
    const now = await framesOf(cardEl);
    if (WRITE) {
      writeFileSync(SNAP!, JSON.stringify(now));
      return;
    }
    // batch card: #card-SNAPSHOT — the snapshot exists and covers the same records
    expect(existsSync(SNAP!), `snapshot ${SNAP} missing — write it on the pre-step tree with CARD_HOST_WRITE=1`).toBe(true);
    const before = JSON.parse(readFileSync(SNAP!, 'utf8')) as typeof now;
    expect(Object.keys(now)).toEqual(Object.keys(before));
    let diffs = 0;
    for (const k of Object.keys(now)) {
      if (now[k].first !== before[k].first || now[k].settled !== before[k].settled) diffs++;
      // batch card: #card-SNAPSHOT — both frames of every record are byte-equal
      expect(now[k].first, `${k} first frame`).toBe(before[k].first);
      expect(now[k].settled, `${k} settled frame`).toBe(before[k].settled);
    }
    expect(diffs).toBe(0);
  }, 120_000);

  // batch card: #card-SNAPSHOT — the embed branch renders exactly the legacy GM page
  it('the embed branch renders exactly the legacy HostPage, both frames, in and out of the app context', async () => {
    const card = await framesOf(cardEl);
    const legacy = await framesOf(legacyEl);
    for (const k of Object.keys(legacy)) {
      expect(card[k].first, `${k} first frame`).toBe(legacy[k].first);
      expect(card[k].settled, `${k} settled frame`).toBe(legacy[k].settled);
    }
    // Every branch of the legacy page is in the sample: the page, the loading placeholder, the old text,
    // the remastered line, the not-in-this-version line.
    const all = Object.values(legacy).flatMap((f) => [f.first, f.settled ?? '']);
    // batch card: #card-NOT-VACUOUS — every branch of the legacy page is in the sample
    expect(all.some((h) => h.startsWith('<div class="ast-body ast-embed">'))).toBe(true);
    expect(all.some((h) => h === '<div class="ast-body ast-loading" aria-busy="true"></div>')).toBe(true);
    expect(all.some((h) => h.includes('sd-remastered'))).toBe(true);
    expect(all.some((h) => h === '<p class="sd-ours">This page is not in this version of Heroes Heaven.</p>')).toBe(true);
    expect(Object.entries(legacy).some(([k, f]) => sample.find((s) => s.key === k)!.kind === 'nopage' && !!f.settled && !f.settled.includes('ast-'))).toBe(true);
  }, 120_000);

  // batch card: #card-R1 — the GM screen page is the record's card (mode gm; item 7: chrome window)
  it('HostPage is the card: RecordCard mode gm, chrome window', () => {
    const e = sample.find((s) => s.kind === 'page')!;
    const el = (HostPage as (p: Parameters<typeof HostPage>[0]) => ReactElement)({ content: db, bucket: e.bucket, id: e.id, onOpen: noop });
    expect(el.type).toBe(RecordCard);
    expect(el.props).toMatchObject({ record: { bucket: e.bucket, id: e.id }, mode: 'gm', chrome: 'window', content: db });
  });

  // batch card premise: spell-6 "Range touch"
  it("keeps the page's stat lines: air-walk shows its Range and Duration, as the GM reads them mid-fight", async () => {
    // batch card premise: spell-6 "Range touch"
    const e: Entry = { kind: 'page', key: 'spells:air-walk', bucket: 'spells', id: 'air-walk' };
    expect(trees.spells[e.id], 'air-walk has a page').toBeTruthy();
    // item 7: the embed card (cardEl) — HostPage's window chrome is pinned by the legs after the ledger.
    const host = await mount(cardEl(e));
    const body = host.querySelector('.ast-body.ast-embed');
    expect(body, 'the embedded page body').toBeTruthy();
    // AstRenderer draws a page's stat lines as `.ast-meta` rows led by a bold label.
    const labels = [...body!.querySelectorAll('.ast-meta > strong')].map((b) => (b.textContent ?? '').trim());
    // batch card premise: spell-6 "Range touch"
    expect(labels).toContain('Range');
    // batch card premise: spell-6 "Duration 5 minutes"
    expect(labels).toContain('Duration');
    const text = (body!.textContent ?? '').replace(/\s+/g, ' ');
    // batch card premise: spell-6 "Range touch"
    expect(text).toContain('Range touch');
    // batch card premise: spell-6 "Duration 5 minutes"
    expect(text).toContain('Duration 5 minutes');
    // Embed chrome: no popup overlay, no header of its own — the tracker window owns the frame.
    // batch card: #card-SNAPSHOT — the GM page draws as before: no popup frame of its own
    expect(host.querySelector('.picker-overlay, .ast-modal, .ast-head, .picker-close, .info-star')).toBeNull();
  });

  // batch card: #card-R1 — the GM page's body is the browse card's body
  it("the embedded body is the browse popup's body: nothing is dropped on the GM page", async () => {
    let compared = 0;
    for (const e of sample.filter((s) => s.kind === 'page').slice(0, 60)) {
      // item 7: the embed card (cardEl); the window chrome's body is pinned to this one further down.
      const gm = await mount(<ContentContext.Provider value={db}>{cardEl(e)}</ContentContext.Provider>);
      const r = recs(e.bucket)[e.id];
      const browse = await mount(
        <ContentContext.Provider value={db}>
          <DescriptionModal root={{ title: r.name, description: r.description ?? '', descRefs: r.descRefs, key: e.bucket, slug: e.id }} onClose={noop} />
        </ContentContext.Provider>,
      );
      const gmBody = gm.querySelector('.ast-body.ast-embed');
      const browseBody = browse.querySelector('.ast-modal .ast-pop > .ast-body');
      // batch card: #card-R1 — the GM body and the browse body are the same markup
      expect(gmBody, e.key).toBeTruthy();
      expect(browseBody, e.key).toBeTruthy();
      expect(gmBody!.innerHTML, e.key).toBe(browseBody!.innerHTML);
      compared++;
      while (mounted.length) mounted.pop()!.stop();
    }
    // batch card: #card-NOT-VACUOUS — the comparison ran on all 60 sampled pages
    expect(compared).toBe(60);
  }, 120_000);

  // batch card: #card-SNAPSHOT — links open through the host's onOpen, as before
  it('a link and the "Remastered as" name open through the host (the GM\'s own popup), as before', async () => {
    const withLink = sample.filter((s) => s.kind === 'page').find((s) => renderToStaticMarkup(legacyEl(s)).includes('ast-lk'))!;
    expect(withLink, 'a sampled page with a live link').toBeTruthy();
    const calls = async (el: (e: Entry, o: (b: string, id: string) => void) => ReactElement, e: Entry, sel: string) => {
      const onOpen = vi.fn();
      const host = await mount(<ContentContext.Provider value={db}>{el(e, onOpen)}</ContentContext.Provider>);
      const a = host.querySelector<HTMLElement>(sel);
      // batch card: #card-NOT-VACUOUS — the link the case clicks exists
      expect(a, `${e.key} ${sel}`).toBeTruthy();
      await act(async () => { a!.click(); });
      return onOpen.mock.calls;
    };
    const legacyLink = await calls(legacyEl, withLink, 'a.ast-lk');
    expect(legacyLink.length).toBe(1);
    // batch card: #card-SNAPSHOT — the card opens the same link and Remastered name the legacy page did
    // (item 7: the embed card, cardEl — both hand the host the same click point as a third argument now)
    expect(await calls(cardEl, withLink, 'a.ast-lk')).toEqual(legacyLink);
    const rem = sample.find((s) => s.kind === 'remastered')!;
    const legacyRem = await calls(legacyEl, rem, '.sd-remastered a');
    expect(legacyRem.length).toBe(1);
    expect(await calls(cardEl, rem, '.sd-remastered a')).toEqual(legacyRem);
  });

  // batch card: #card-SNAPSHOT — the GM page arms no phone Back trap, as before
  it('mounting the page pushes nothing on the dismiss stack — no phone Back-trap entry (the browse popup does)', async () => {
    const before = window.matchMedia;
    window.matchMedia = mediaQuery(true);
    const push = vi.spyOn(history, 'pushState');
    try {
      const e = sample.find((s) => s.kind === 'page')!;
      await mount(hostEl(e));
      // batch card: #card-SNAPSHOT — mounting the GM page pushes no history entry
      expect(push, 'the GM page armed the Back trap').not.toHaveBeenCalled();
      // The instrument works: a popup card on the same phone does arm it.
      await mount(<ContentContext.Provider value={db}><RecordCard record={{ bucket: e.bucket, id: e.id }} mode="browse" chrome="popup" onExit={noop} /></ContentContext.Provider>);
      // batch card: #card-NOT-VACUOUS — the instrument works: a popup card on the same phone arms it
      expect(push).toHaveBeenCalled();
    } finally {
      push.mockRestore();
      window.matchMedia = before;
    }
  });

  // batch card: #card-GUARD — the guard's ledger models the GM page with the rows browse renders
  it("the guard's ledger models the GM page like browse: the whole page, nothing dropped", () => {
    const e = sample.find((s) => s.kind === 'page' && s.bucket === 'spells')!;
    const rec = recs(e.bucket)[e.id];
    const deps = {
      content: { [e.bucket]: { [e.id]: rec } }, trees: { [e.bucket]: { [e.id]: trees[e.bucket][e.id] } }, astIndex: {},
      statRows: { itemStatRows: () => [], spellStatRows: () => [] }, activities: [], situationalIds: [],
      classFeatureDescription: (d: string) => d, splitHeightening: (d: string) => ({ base: d, heightening: [] }),
    };
    const { rows } = surfaceRows(deps as never) as { rows: { surface: string; bucket: string; id: string }[] };
    const gm = rows.filter((r) => r.surface === 'gm');
    const browse = rows.filter((r) => r.surface === 'browse');
    // batch card: #card-GUARD — one GM row per browse row, the same records
    expect(gm.length, 'one GM row per browse row').toBe(browse.length);
    expect(gm.length).toBeGreaterThan(0);
    expect(gm.map(({ surface: _s, ...r }) => r)).toEqual(browse.map(({ surface: _s, ...r }) => r));
    // batch card: #card-GUARD — the GM row is judged by the tree lane, every label OK
    const v = judgeRow(gm[0] as never, deps.trees, (() => []) as never) as { identity: boolean; labels: Record<string, string>; lane: string };
    expect(v.lane).toBe('tree');
    expect(v.identity).toBe(false);
    expect(v.labels, 'every page label judged OK (labelVerdicts returns only the others)').toEqual({});
  });
});

/*
 * Item 7 (2026-10-11): HostPage's chrome, 'window' — the page in a tracker window / GM-screen pane. The
 * window's header (the tracker's) holds the tab title and the star; the card draws the rest of the popup's
 * head under it — the trust marker included, in the head's controls where the popup draws it — and the
 * very body the embed chrome draws.
 */
/** A laid-out box for an element (jsdom lays nothing out: every box is 0, 0, 0, 0). */
const box = (x: number, y: number, width: number, height: number): DOMRect =>
  ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;

describe("item 7: the GM's page in a tracker window (RecordCard gm/window)", () => {
  // item 7: the window body is the embed body, byte for byte — nothing dropped, the stat lines kept
  it('draws the very body the embed chrome draws, under the popup head without its name', async () => {
    let compared = 0;
    let withAon = 0;
    let withTraits = 0;
    let withBadge = 0;
    for (const e of sample.filter((s) => s.kind === 'page').slice(0, 40)) {
      const win = await mount(<ContentContext.Provider value={db}>{hostEl(e)}</ContentContext.Provider>);
      const embed = await mount(<ContentContext.Provider value={db}>{cardEl(e)}</ContentContext.Provider>);
      const r = recs(e.bucket)[e.id];
      const browse = await mount(
        <ContentContext.Provider value={db}>
          <DescriptionModal root={{ title: r.name, description: r.description ?? '', descRefs: r.descRefs, key: e.bucket, slug: e.id }} onClose={noop} />
        </ContentContext.Provider>,
      );
      const root = win.firstElementChild as HTMLElement;
      expect(root.className, e.key).toBe('ast-win');
      // The body: the embed chrome's, byte for byte.
      expect(root.querySelector(':scope > .ast-body')!.innerHTML, e.key).toBe(embed.querySelector('.ast-body.ast-embed')!.innerHTML);
      // The window is the frame: no popup overlay, frame, bar, name, Back, star or close of its own.
      expect(win.querySelector('.picker-overlay, .ast-modal, .ast-pop, .ast-bar, .ast-name, .info-back, .info-star, .picker-close'), e.key).toBeNull();
      // The head is the popup's, without the name: glyph, level badge, Archives link, trait chips.
      const pop = browse.querySelector('.ast-modal .ast-pop')!;
      const same = (sel: string, popSel: string) => {
        const a = root.querySelector(sel);
        const b = pop.querySelector(popSel);
        expect(a?.outerHTML ?? null, `${e.key} ${sel}`).toBe(b?.outerHTML ?? null);
        return !!a;
      };
      if (same(':scope > .ast-win-head .ast-aon', ':scope > .ast-head .ast-aon')) withAon++;
      if (same(':scope > .ast-win-head .ast-badge', ':scope > .ast-head .ast-badge')) withBadge++;
      same(':scope > .ast-win-head > .ast-ag.head', ':scope > .ast-head > .ast-ag.head');
      if (same(':scope > .ast-traits', ':scope > .ast-traits')) withTraits++;
      compared++;
      while (mounted.length) mounted.pop()!.stop();
    }
    expect(compared).toBe(40);
    // Not vacuous: the sample holds pages with each part of the head.
    expect(withAon, 'pages with an Archives link').toBeGreaterThan(0);
    expect(withTraits, 'pages with trait chips').toBeGreaterThan(0);
    expect(withBadge, 'pages with a level badge').toBeGreaterThan(0);
  }, 120_000);

  // item 7 (refuter round 2): the trust marker is the page's — in the head's controls, where the popup puts it
  it('a marked record draws its trust marker in the window head: the very line the popup draws there', async () => {
    const ledger = LEDGER as { partly?: Record<string, string>; unencoded?: string[] };
    const marked = [...Object.keys(ledger.partly ?? {}), ...(ledger.unencoded ?? [])]
      .map((k) => k.split('/'))
      .filter(([b, id]) => trees[b]?.[id] && recs(b)[id]);
    expect(marked.length, 'marked records with a page (the shipped ledger)').toBeGreaterThan(0);
    const [bucket, id] = marked[0];
    const e: Entry = { kind: 'page', key: `${bucket}:${id}`, bucket, id };
    const r = recs(bucket)[id];
    const win = await mount(<ContentContext.Provider value={db}>{hostEl(e)}</ContentContext.Provider>);
    const browse = await mount(
      <ContentContext.Provider value={db}>
        <DescriptionModal root={{ title: r.name, description: r.description ?? '', descRefs: r.descRefs, key: bucket, slug: id }} onClose={noop} />
      </ContentContext.Provider>,
    );
    const popupNote = browse.querySelector('.ast-head .ast-controls .sd-choice-note');
    expect(popupNote?.textContent ?? '', `${e.key}: the popup draws the marker`).toMatch(/^Not yet verified/);
    const winNote = win.querySelector(':scope > .ast-win > .ast-win-head .ast-controls .sd-choice-note');
    expect(winNote?.outerHTML ?? null, `${e.key}: the window head draws the same line`).toBe(popupNote!.outerHTML);
    expect(win.querySelectorAll('.sd-choice-note'), 'once, and not in the body').toHaveLength(1);
  }, 120_000);

  // item 7: a link opens another window WHERE IT WAS CLICKED — the host is handed the point
  it('a linked word and a trait chip hand the host the point they were activated at', async () => {
    const withLink = sample.filter((s) => s.kind === 'page').find((s) => renderToStaticMarkup(<ContentContext.Provider value={db}>{cardEl(s)}</ContentContext.Provider>).includes('ast-lk'))!;
    expect(withLink, 'a sampled page with a live link').toBeTruthy();
    const onOpen = vi.fn();
    const host = await mount(<ContentContext.Provider value={db}>{hostEl(withLink, onOpen)}</ContentContext.Provider>);
    const a = host.querySelector<HTMLElement>('.ast-body a.ast-lk')!;
    await act(async () => { a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 321, clientY: 87 })); });
    expect(onOpen).toHaveBeenCalledTimes(1);
    const [bucket, slug, at] = onOpen.mock.calls[0];
    expect(typeof bucket === 'string' && typeof slug === 'string', 'bucket and slug').toBe(true);
    expect(at, 'the click point').toEqual({ x: 321, y: 87 });
    // A key press has no pointer: the link's own box (jsdom lays nothing out, so its corner is 0, 0).
    await act(async () => { a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(onOpen.mock.calls[1]).toEqual([bucket, slug, { x: 0, y: 0 }]);
    // A trait chip, the same way.
    const withChip = sample.filter((s) => s.kind === 'page').find((s) => renderToStaticMarkup(<ContentContext.Provider value={db}>{hostEl(s)}</ContentContext.Provider>).includes('ast-tr-link'));
    expect(withChip, 'a sampled page with a live trait chip').toBeTruthy();
    const onChip = vi.fn();
    const chipHost = await mount(<ContentContext.Provider value={db}>{hostEl(withChip!, onChip)}</ContentContext.Provider>);
    const chip = chipHost.querySelector<HTMLElement>('.ast-traits a.ast-tr-link')!;
    await act(async () => { chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 40, clientY: 12 })); });
    expect(onChip.mock.calls[0][0]).toBe('trait');
    expect(onChip.mock.calls[0][2]).toEqual({ x: 40, y: 12 });
  }, 120_000);

  // item 7: a record with no page opens its links through the host, never a popup inside the window
  it('a record with no page shows its text, and its links open through the host (another window), not a popup', async () => {
    // The first no-page record (deterministic order) whose old text the window draws with a live link.
    let found: { e: Entry; host: HTMLElement; onOpen: ReturnType<typeof vi.fn> } | null = null;
    outer: for (const b of BUCKETS) {
      for (const id of Object.keys(recs(b)).filter((s) => !trees[b][s] && (recs(b)[s]?.descRefs?.length ?? 0) > 0).sort().slice(0, 30)) {
        const e: Entry = { kind: 'nopage', key: `${b}:${id}`, bucket: b, id };
        const onOpen = vi.fn();
        const host = await mount(<ContentContext.Provider value={db}>{hostEl(e, onOpen)}</ContentContext.Provider>);
        if (host.querySelector('.ast-win-text button.desc-link')) { found = { e, host, onOpen }; break outer; }
        mounted.pop()!.stop();
      }
    }
    expect(found, 'a no-page record whose text carries a link').not.toBeNull();
    const { host, onOpen, e } = found!;
    expect(host.querySelector('.ast-win.ast-win-text .sd-desc'), `${e.key}: DescBody's text lane`).not.toBeNull();
    const link = host.querySelector<HTMLElement>('.ast-win-text button.desc-link')!;
    await act(async () => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 150, clientY: 210 })); });
    expect(onOpen, `${e.key}: the link opened through the host`).toHaveBeenCalledTimes(1);
    const [bucket, slug, at] = onOpen.mock.calls[0];
    expect(recs(bucket)[slug], 'it names a record that ships').toBeTruthy();
    expect(at).toEqual({ x: 150, y: 210 });
    // Enter on the focused link: the browser makes a click with no pointer (detail 0, client 0, 0). The
    // window opens at the link, not in the screen's top-left corner.
    link.getBoundingClientRect = () => box(70, 120, 90, 20);
    await act(async () => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); });
    expect(onOpen.mock.calls[1], `${e.key}: a keyboard click hands over the link's box`).toEqual([bucket, slug, { x: 70, y: 140 }]);
    // …and DescBody's own popup never opened inside the window.
    expect(document.querySelector('.picker-overlay')).toBeNull();
    // A record not in this version says so, at the body's insets.
    const missing = await mount(hostEl({ kind: 'missing', key: 'feats:card-step6-no-such-feat', bucket: 'feats', id: 'card-step6-no-such-feat' }));
    expect(missing.innerHTML).toBe('<div class="ast-win ast-win-text"><p class="sd-ours">This page is not in this version of Heroes Heaven.</p></div>');
  }, 120_000);

  // item 7 (refuter round 3): the no-page lane's OTHER branch — authored HTML, whose links are .ref-link anchors
  it('a homebrew record with no page: its authored .ref-link opens another window where it was clicked, never DescBody\'s own popup', async () => {
    const target = recs('conditions').frightened;
    expect(target, 'fixture: the linked record ships').toBeTruthy();
    const HB = 'synthetic-homebrew-glare';
    // What the homebrew editor writes (RichEditor refLinkHtml): rich HTML, a linked word as a .ref-link anchor.
    const html = `<p>On a hit the target becomes ${refLinkHtml({ key: 'conditions', id: 'frightened', name: target.name }, 'frightened 1')}.</p>`;
    const hb = { ...db, feats: { ...recs('feats'), [HB]: { name: 'Synthetic Homebrew Glare', description: html } } } as unknown as ContentDatabase;
    expect(trees.feats[HB], 'no page of its own: the no-page lane').toBeUndefined();
    useWindowStore.setState({ wins: [], topZ: BASE_Z });
    try {
      // Wired as CampaignTracker wires the page in a window: a link opens another window (openHostWindow).
      // Inside the app's ContentContext, as the live app is — where DescBody's own popup COULD open.
      const host = await mount(
        <ContentContext.Provider value={hb}>
          <HostPage content={hb} bucket="feats" id={HB} onOpen={(b, id, at) => openHostWindow(hb, b, id, at)} />
        </ContentContext.Provider>,
      );
      const a = host.querySelector<HTMLElement>('.ast-win.ast-win-text .rich-html a.ref-link');
      expect(a, 'the authored link, drawn by DescBody\'s rich-HTML lane').not.toBeNull();
      await act(async () => { a!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 240, clientY: 180 })); });
      const ws = useWindowStore.getState().wins;
      expect(ws.map((w) => w.tabs[0]), 'another window, holding the linked record').toEqual([{ type: 'host', ref: 'conditions:frightened', title: target.name, castRank: undefined }]);
      expect({ x: ws[0].x, y: ws[0].y }, 'where the link was clicked').toEqual({ x: 240, y: 180 });
      expect(document.querySelector('.picker-overlay, .ast-modal'), 'no popup of DescBody\'s own, inside the window').toBeNull();
    } finally {
      useWindowStore.setState({ wins: [], topZ: BASE_Z });
    }
  }, 120_000);

  // item 7: the "Remastered as" name opens the reprint where it was clicked — or at itself, from the keyboard
  it('the "Remastered as" name hands the host its click point, or its own box when the keyboard clicked it', async () => {
    const rem = sample.find((s) => s.kind === 'remastered')!;
    expect(rem, 'a sampled record with a "Remastered as" line').toBeTruthy();
    const onOpen = vi.fn();
    const host = await mount(<ContentContext.Provider value={db}>{hostEl(rem, onOpen)}</ContentContext.Provider>);
    const name = host.querySelector<HTMLElement>('.sd-remastered a')!;
    expect(name, `${rem.key}: the window draws the line`).toBeTruthy();
    const ra = recs(rem.bucket)[rem.id].remasteredAs as { bucket: string; id: string };
    await act(async () => { name.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 33, clientY: 44 })); });
    expect(onOpen.mock.calls[0]).toEqual([ra.bucket, ra.id, { x: 33, y: 44 }]);
    name.getBoundingClientRect = () => box(12, 300, 80, 18);
    await act(async () => { name.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); });
    expect(onOpen.mock.calls[1], 'Enter on the name: its own box, not the corner').toEqual([ra.bucket, ra.id, { x: 12, y: 318 }]);
  }, 120_000);
});
