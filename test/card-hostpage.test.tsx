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
import { useAstNode } from '../src/sheet/useAst';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import type { ContentDatabase, DescRef } from '../src/rules/types';
import { judgeRow, surfaceRows } from '../scripts/lib/card-scope.mjs';

/* CampaignTracker pulls in the whole tracker; mounted with no account, as test/gm-search-popup.test.tsx does. */
vi.mock('../src/integration/enabled', () => ({ TRACKER_IN_CAMPAIGN: true, TEST_CAMPAIGNS_WITHOUT_LOGIN: false }));
vi.mock('../src/data/useAuth', () => {
  const AUTH = { status: 'disabled', session: null, email: null };
  return { useAuth: () => AUTH, signOut: async () => undefined };
});
const { HostPage } = await import('../src/integration/CampaignTracker');

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

  // batch card: #card-SNAPSHOT — the GM page stays byte-equal to the pre-step render
  it.skipIf(!SNAP)('byte-equal to the pre-step HostPage (CARD_HOST_SNAPSHOT)', async () => {
    const now = await framesOf(hostEl);
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

  // batch card: #card-R1 — the GM screen page is the record's card (mode gm, chrome embed)
  it('HostPage is the card: RecordCard mode gm, chrome embed', () => {
    const e = sample.find((s) => s.kind === 'page')!;
    const el = (HostPage as (p: Parameters<typeof HostPage>[0]) => ReactElement)({ content: db, bucket: e.bucket, id: e.id, onOpen: noop });
    expect(el.type).toBe(RecordCard);
    expect(el.props).toMatchObject({ record: { bucket: e.bucket, id: e.id }, mode: 'gm', chrome: 'embed', content: db });
  });

  // batch card premise: spell-6 "Range touch"
  it("keeps the page's stat lines: air-walk shows its Range and Duration, as the GM reads them mid-fight", async () => {
    // batch card premise: spell-6 "Range touch"
    const e: Entry = { kind: 'page', key: 'spells:air-walk', bucket: 'spells', id: 'air-walk' };
    expect(trees.spells[e.id], 'air-walk has a page').toBeTruthy();
    const host = await mount(hostEl(e));
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
      const gm = await mount(<ContentContext.Provider value={db}>{hostEl(e)}</ContentContext.Provider>);
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
    expect(await calls(hostEl, withLink, 'a.ast-lk')).toEqual(legacyLink);
    const rem = sample.find((s) => s.kind === 'remastered')!;
    const legacyRem = await calls(legacyEl, rem, '.sd-remastered a');
    expect(legacyRem.length).toBe(1);
    expect(await calls(hostEl, rem, '.sd-remastered a')).toEqual(legacyRem);
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
