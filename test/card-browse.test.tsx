// @vitest-environment jsdom
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { content } from './_content';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import type { DescNode } from '../src/sheet/descref';
import type { ContentDatabase, DescRef } from '../src/rules/types';
import { CARD_ON } from '../src/sheet/cardSurfaces';
import { RecordCard } from '../src/sheet/RecordCard';
import type { OursLine } from '../src/sheet/cardModel';
import { textOf, variantSection } from '../src/sheet/astVisibility';

/**
 * Card step 3 (docs/card-design.md section 9, row 3): the BROWSE card is extracted from
 * DescriptionModal into src/sheet/RecordCard.tsx with NO behaviour change. DescriptionModal now
 * renders through RecordCard (mode 'browse', chrome 'popup'), keeping its exact class names
 * (.ast-modal, .picker.info-modal …), so PopupSizeLock's SELF_SIZED list and sheet.css are untouched.
 *
 * What this file proves:
 *
 *  1. WITH A SNAPSHOT (env CARD_BROWSE_SNAPSHOT=<json path>): byte-equal markup against the same
 *     renders produced by the pre-extraction DescriptionModal, for a sample drawn by
 *     mulberry32(20261002): 275 records with a page over feats / classFeatures / items / actions /
 *     spells / trait (46 each, 45 traits), 20 records with NO page (rendered twice: the static first
 *     frame, which is the loading placeholder branch, and the mounted frame after the hook settles,
 *     which is the markdown fallback branch) and 5 synthesized homebrew-shaped {title, text} nodes
 *     (fallback branch). Every second render sits inside a PinContext (the star), every third opens
 *     with backToSource (Back at the first level). `CARD_BROWSE_WRITE=1` writes the snapshot instead
 *     (run that on the pre-extraction tree). The snapshot is scratch — it pins one tree's output on
 *     one data stamp — so it is never committed; without the variable this block skips and says so.
 *  2. ALWAYS: one drill-in through a page cross-link, then Back, returns to the first node; Escape
 *     closes the whole chain (useEscapeClose → onExit, never onClose); the PinStar sits in the header
 *     and pins the caller's own node object; the loading placeholder branch; a record with no page
 *     renders the markdown fallback; no "Full page" button anywhere (owner ruling, section 13); every
 *     CARD_ON surface switch is off except the ones whose step has landed (step 5: statDetail).
 *
 * Measured 2026-10-02: the snapshot was written on HEAD dc67738 before any edit (300 first frames +
 * 20 settled frames: 273 page popups with a name, 20 loading placeholders, 25 markdown fallbacks,
 * 150 with the star, 100 with Back, 5 with a RemasteredLine), then compared after the extraction:
 * 0 differences. card-noop's step-1 snapshot (600 more DescriptionModal renders) also stayed equal.
 *
 * MUTATION LINES (each measured red on 2026-10-02, then restored byte-exact):
 *  - RecordCard ast branch: an extra <span> inside .ast-modal → snapshot block + branch test red.
 *  - RecordCard back(): `s.slice(0, -1)` → `s.slice(0)` → drill-in/Back test red.
 *  - RecordCard: `useEscapeClose(exit)` → `useEscapeClose(undefined)` → Escape test red.
 *  - RecordCard ast star: `pin.toggle(cur)` → `pin.toggle({ ...cur })` → PinStar test red.
 *  - RecordCard: loading branch disabled → branch test + loading test red.
 *  - RecordCard fallback: the RichText body removed → no-page fallback test red.
 *  - DescriptionModal: `onExit={onExit ?? onClose}` → `onExit={onClose}` → Escape test red.
 *  - RecordCard: a "Full page" button in the controls → Full-page test red.
 *  - RecordCard: the ours box dropped from the body's tail → slots test red.
 *  - (card step 4, refuter nit: the drill-in clicks its COMPUTED target and checks it opened) RecordCard
 *    openRef opening the bucket's second record instead of the clicked one → drill-in test red
 *    ("expected ' Aberrant Form ' to be ' Locate '"); the old "any link, name changed" test passed it.
 */
const SEED = 20261002;
const BUCKETS = ['feats', 'classFeatures', 'items', 'actions', 'spells', 'trait'] as const;
const PAGE_COUNTS: Record<(typeof BUCKETS)[number], number> = { feats: 46, classFeatures: 46, items: 46, actions: 46, spells: 46, trait: 45 };
const NO_PAGE = 20;
const SNAP = process.env.CARD_BROWSE_SNAPSHOT;
const WRITE = process.env.CARD_BROWSE_WRITE === '1';

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

type Rec = { name: string; description?: string; descRefs?: DescRef[] };
const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) as Record<string, AstNode>;
const noop = () => undefined;
const db: ContentDatabase = content();
const recs = (bucket: string) => (db as unknown as Record<string, Record<string, Rec>>)[bucket] ?? {};
const nodeOf = (bucket: string, slug: string): DescNode => {
  const r = recs(bucket)[slug];
  return { title: r.name, description: r.description ?? '', descRefs: r.descRefs, key: bucket, slug };
};

/** Five homebrew-shaped nodes: a title and the player's own text, no bucket, no id (synthesized). */
const HOMEBREW: DescNode[] = [
  { title: 'Glimmerwick Lantern', description: 'A brass lantern whose flame burns **blue** near hidden doors.\n\nWhile lit, you can Seek as a single action.', descRefs: [{ key: 'actions', label: 'Seek' }] },
  { title: 'Oath of the Quiet Tide', description: 'You swear never to strike first.\n\n- You gain a +1 status bonus to Diplomacy.\n- You become frightened 1 when you break the oath.', descRefs: [{ key: 'conditions', label: 'frightened 1' }] },
  { title: 'Marrowmoss Poultice', description: '**Usage** held in 1 hand; **Bulk** L\n\nApply it to a wound to stop persistent bleed damage.' },
  { title: 'Tunnelcat Companion', description: 'A small, curious feline that rides on your shoulder. It has no Strikes.' },
  { title: 'Stormglass Shard', description: '' },
];

const trees: Record<string, Record<string, AstNode>> = {};
type Entry = { kind: 'page' | 'nopage' | 'homebrew'; key: string; node: DescNode };
let sample: Entry[] = [];

beforeAll(async () => {
  for (const b of BUCKETS) trees[b] = readGz(`public/ast/${b}.json.gz`);
  // Warm the module cache through the loader's own raw-json fallback (the .gz fetch answers not-ok);
  // a bucket this file never loads (heritages) answers not-ok twice and caches as empty.
  vi.stubGlobal('fetch', async (url: string) => {
    const m = /ast\/(\w+)\.json$/.exec(String(url));
    return m && trees[m[1]] ? { ok: true, json: async () => trees[m[1]] } : { ok: false };
  });
  for (const b of BUCKETS) await loadBucketAst(b);
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;

  const rng = mulberry32(SEED);
  const pages: Entry[] = BUCKETS.flatMap((b) => {
    const pool = Object.keys(trees[b]).filter((s) => recs(b)[s]).sort();
    return draw(pool, PAGE_COUNTS[b], rng).map((slug) => ({ kind: 'page' as const, key: `${b}:${slug}`, node: nodeOf(b, slug) }));
  });
  const noPagePool = BUCKETS.flatMap((b) => Object.keys(recs(b)).filter((s) => !trees[b][s]).sort().map((s) => `${b}:${s}`));
  const noPage: Entry[] = draw(noPagePool, NO_PAGE, rng).map((k) => {
    const [b, s] = k.split(':');
    return { kind: 'nopage' as const, key: k, node: nodeOf(b, s) };
  });
  const homebrew: Entry[] = HOMEBREW.map((n, i) => ({ kind: 'homebrew' as const, key: `homebrew:${i}`, node: n }));
  sample = [...pages, ...noPage, ...homebrew];
});

const pinApi = (i: number): PinDescApi => ({ has: (n) => n.title.length % 2 === i % 2, toggle: noop, ...(i % 4 === 0 ? { where: 'Spellbook' } : {}) });
/** The popup as a caller opens it: every second one inside a PinContext, every third with backToSource. */
function modalEl(node: DescNode, i: number, extra?: { onClose?: () => void; onExit?: () => void; pin?: PinDescApi | null }): ReactElement {
  const pin = extra && 'pin' in extra ? extra.pin : i % 2 === 0 ? pinApi(i) : null;
  return (
    <ContentContext.Provider value={db}>
      <PinContext.Provider value={pin ?? null}>
        <DescriptionModal root={node} onClose={extra?.onClose ?? noop} onExit={extra?.onExit} backToSource={i % 3 === 0} />
      </PinContext.Provider>
    </ContentContext.Provider>
  );
}
const staticRender = (node: DescNode, i: number) => renderToStaticMarkup(modalEl(node, i));

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
  // The hook's effect awaits the (already cached) bucket: let its promise chain settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  mounted.push({ stop: () => { act(() => root.unmount()); host.remove(); } });
  return host;
}
async function mountedRender(node: DescNode, i: number): Promise<string> {
  const host = await mount(modalEl(node, i));
  const html = host.innerHTML;
  mounted.pop()!.stop();
  return html;
}

async function allRenders(): Promise<Record<string, { first: string; settled?: string }>> {
  const out: Record<string, { first: string; settled?: string }> = {};
  for (let i = 0; i < sample.length; i++) {
    const e = sample[i];
    out[e.key] = { first: staticRender(e.node, i) };
    if (e.kind === 'nopage') out[e.key].settled = await mountedRender(e.node, i);
  }
  return out;
}

/** A node's text as AstRenderer prints it (astVisibility's textOf), and the header name it draws. */
const flat = (n: AstNode): string => textOf(n);
function headName(tree: AstNode): string {
  const top = tree.c ?? [];
  const title = top.find((n) => n.t === 'title' && Number(n.level || 1) <= 1) || top.find((n) => n.t === 'title');
  return title ? textOf(title.c?.find((x) => x.t === 'link' || x.t === 'text') || title) : '';
}

/** The first page record (sorted) carrying a live cross-link to another feats/actions/spells page. */
function linkedRecord(): { slug: string; target: string } {
  for (const slug of Object.keys(trees.feats).filter((s) => recs('feats')[s]).sort()) {
    let target = '';
    (function walk(n: AstNode) {
      if (target) return;
      if (n.t === 'link' && n.ref && n.ref !== `feats:${slug}`) {
        const [b, s] = n.ref.split(':');
        if ((b === 'actions' || b === 'spells' || b === 'feats') && trees[b]?.[s] && recs(b)[s]) target = n.ref;
      }
      (n.c ?? []).forEach(walk);
    })(trees.feats[slug]);
    if (target) return { slug, target };
  }
  throw new Error('no feat page with a live cross-link');
}

describe('card step 3: the browse card extracted from DescriptionModal', () => {
  it('draws 275 page records, 20 without a page and 5 homebrew nodes', () => {
    expect(sample.length).toBe(300);
    expect(new Set(sample.map((s) => s.key)).size).toBe(300);
    for (const b of BUCKETS) expect(sample.filter((s) => s.kind === 'page' && s.key.startsWith(`${b}:`)).length, b).toBe(PAGE_COUNTS[b]);
    expect(sample.filter((s) => s.kind === 'nopage').length).toBe(NO_PAGE);
    expect(sample.filter((s) => s.kind === 'homebrew').length).toBe(5);
  });

  it.skipIf(!SNAP)('byte-equal to the pre-extraction DescriptionModal (CARD_BROWSE_SNAPSHOT)', async () => {
    const now = await allRenders();
    if (WRITE) {
      writeFileSync(SNAP!, JSON.stringify(now));
      return;
    }
    expect(existsSync(SNAP!), `snapshot ${SNAP} missing — write it on the pre-extraction tree with CARD_BROWSE_WRITE=1`).toBe(true);
    const before = JSON.parse(readFileSync(SNAP!, 'utf8')) as typeof now;
    expect(Object.keys(now)).toEqual(Object.keys(before));
    let diffs = 0;
    for (const k of Object.keys(now)) {
      if (now[k].first !== before[k].first || now[k].settled !== before[k].settled) diffs++;
      expect(now[k].first, `${k} first frame`).toBe(before[k].first);
      expect(now[k].settled, `${k} settled frame`).toBe(before[k].settled);
    }
    expect(diffs).toBe(0);
  });

  it('every branch is in the sample: page, loading placeholder, markdown fallback', async () => {
    const page = sample.filter((s) => s.kind === 'page');
    for (const [i, e] of page.entries()) expect(staticRender(e.node, i).startsWith('<div class="picker-overlay"><div class="ast-modal"><div class="ast-pop">'), e.key).toBe(true);
    const np = sample.filter((s) => s.kind === 'nopage');
    for (const [i, e] of np.entries()) {
      expect(staticRender(e.node, i), `${e.key} first frame`).toContain('<div class="ast-body ast-loading" aria-busy="true">');
      expect(await mountedRender(e.node, i), `${e.key} settled`).toMatch(/^<div class="picker-overlay"><div class="picker info-modal"><div class="picker-head">/);
    }
    for (const [i, e] of sample.filter((s) => s.kind === 'homebrew').entries())
      expect(staticRender(e.node, i), e.key).toMatch(/^<div class="picker-overlay"><div class="picker info-modal">/);
  });

  it('a cross-link drills in, and Back returns to the first node', async () => {
    const { slug, target } = linkedRecord();
    const host = await mount(modalEl(nodeOf('feats', slug), 1, { pin: null }));
    const name = () => host.querySelector('.ast-head .ast-name')?.textContent;
    const first = name();
    expect(first).toBeTruthy();
    expect(host.querySelector('.info-back'), 'no Back at the first level').toBeNull();
    const [tb, ts] = target.split(':');
    // card step 4 (refuter nit): click the COMPUTED target, not any live link. The body's live links in
    // render order are the tree's body links (title and trait chips excluded) whose ref is not the page
    // itself and names a shipped record — the anchors AstRenderer draws, in the same order.
    const liveRefs: { ref: string; label: string }[] = [];
    (function walk(n: AstNode, inTitle: boolean) {
      if (n.t === 'traits') return;
      const title = inTitle || (n.t === 'title' && Number(n.level ?? 1) <= 1);
      if (!title && n.t === 'link' && n.ref && n.ref !== `feats:${slug}`) {
        const [b, s] = n.ref.split(':');
        if (recs(b)[s]) liveRefs.push({ ref: n.ref, label: flat(n) });
      }
      (n.c ?? []).forEach((c) => walk(c, title));
    })(trees.feats[slug], false);
    const at = liveRefs.findIndex((l) => l.ref === target);
    // batch card premise: feat-6457 "you can spend 8 hours to locate a resident"
    expect(at, `${slug} carries a live link to ${target}`).toBeGreaterThanOrEqual(0);
    const anchors = [...host.querySelectorAll<HTMLElement>('.ast-body a.ast-lk')];
    expect(anchors.length, 'one anchor per live body link').toBe(liveRefs.length);
    const link = anchors[at];
    // batch card premise: feat-6457 "you can spend 8 hours to locate a resident"
    expect(link.textContent, `${slug} → ${target}`).toBe(liveRefs[at].label);
    await act(async () => { link.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // batch card premise: feat-6457 "you can spend 8 hours to locate a resident"
    expect(name(), 'the drilled-in page is open').not.toBe(first);
    expect(name(), 'and it is the computed target').toBe(headName(variantSection(trees[tb][ts], ts)));
    const back = host.querySelector<HTMLElement>('.info-back');
    expect(back, 'Back shows once drilled in').toBeTruthy();
    await act(async () => { back!.click(); });
    expect(name()).toBe(first);
    expect(host.querySelector('.info-back')).toBeNull();
  });

  it('Escape closes the whole chain (onExit), never just one level (onClose)', async () => {
    const { slug } = linkedRecord();
    const onClose = vi.fn();
    const onExit = vi.fn();
    const host = await mount(modalEl(nodeOf('feats', slug), 1, { onClose, onExit, pin: null }));
    await act(async () => { host.querySelector<HTMLElement>('.ast-body a.ast-lk')!.click(); });
    expect(host.querySelector('.info-back')).toBeTruthy();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    // Without onExit, Escape falls back to onClose (exit = onExit ?? onClose).
    mounted.pop()!.stop();
    const onlyClose = vi.fn();
    await mount(modalEl(nodeOf('feats', slug), 1, { onClose: onlyClose, pin: null }));
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onlyClose).toHaveBeenCalledTimes(1);
  });

  it('the PinStar is in the header on the page and fallback branches, and pins the caller\'s own node', async () => {
    const toggle = vi.fn();
    const pin: PinDescApi = { has: () => false, toggle };
    const pageNode = sample.find((s) => s.kind === 'page' && s.key.startsWith('spells:'))!.node;
    const host = await mount(modalEl(pageNode, 1, { pin }));
    const star = host.querySelector<HTMLElement>('.ast-head .ast-controls button.info-star');
    expect(star, 'star in the page header').toBeTruthy();
    await act(async () => { star!.click(); });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toggle.mock.calls[0][0]).toBe(pageNode);
    const hb = HOMEBREW[0];
    const host2 = await mount(modalEl(hb, 1, { pin }));
    const star2 = host2.querySelector<HTMLElement>('.picker-head button.info-star');
    expect(star2, 'star in the fallback header').toBeTruthy();
    await act(async () => { star2!.click(); });
    expect(toggle.mock.calls[1][0]).toBe(hb);
  });

  it('a record whose page is still loading shows the shell and a placeholder body, not the old text', () => {
    // heritages is never loaded in this file, so the hook seeds `loading` for any heritage id.
    const id = Object.keys(db.heritages).sort()[0];
    const html = staticRender(nodeOf('heritages', id), 1);
    expect(html).toMatch(/^<div class="picker-overlay"><div class="ast-modal"><div class="ast-pop"><div class="ast-bar"><\/div><div class="ast-head"><span class="ast-name">/);
    expect(html).toContain('<div class="ast-body ast-loading" aria-busy="true">');
    expect(html).not.toContain('info-body');
  });

  it('a record with no page renders its markdown fallback', async () => {
    const e = sample.find((s) => s.kind === 'nopage' && s.node.description.trim().length > 40)!;
    const host = await mount(modalEl(e.node, 1, { pin: null }));
    expect(host.querySelector('.ast-modal')).toBeNull();
    expect(host.querySelector('.picker.info-modal .picker-head .info-title')?.textContent).toBe(e.node.title);
    const body = host.querySelector('.picker.info-modal .info-body');
    expect(body, e.key).toBeTruthy();
    const firstWords = e.node.description.replace(/[*_#>[\]|`-]/g, ' ').split(/\s+/).filter((w) => /^[A-Za-z]{4,}$/.test(w)).slice(0, 3);
    for (const w of firstWords) expect(body!.textContent, `${e.key} "${w}"`).toContain(w);
  });

  it('RecordCard by {bucket,id} or by {title,text} renders what DescriptionModal renders for the same node', () => {
    const wrapCard = (el: ReactElement) => renderToStaticMarkup(<ContentContext.Provider value={db}>{el}</ContentContext.Provider>);
    for (const e of sample.filter((s) => s.kind === 'page').slice(0, 40)) {
      const [bucket, id] = e.key.split(':');
      const card = wrapCard(<RecordCard record={{ bucket, id }} mode="browse" chrome="popup" onExit={noop} />);
      expect(card, e.key).toBe(renderToStaticMarkup(modalEl(e.node, 1, { pin: null })));
    }
    for (const n of HOMEBREW) {
      const card = wrapCard(<RecordCard record={{ title: n.title, text: n.description, refs: n.descRefs }} mode="browse" chrome="popup" onExit={noop} />);
      expect(card, n.title).toBe(renderToStaticMarkup(modalEl(n, 1, { pin: null })));
    }
  });

  it('the slots: headerActions in the header, the ours box after the body, the footer after it', () => {
    const ours: OursLine[] = [{ kind: 'note', from: { bucket: 'feats', id: 'synthetic', name: 'Synthetic Feat' }, text: 'A note of ours.' }];
    const slots = { headerActions: <button className="slot-act">act</button>, ours, footer: <p className="slot-foot">foot</p> };
    const page = sample.find((s) => s.kind === 'page')!;
    const [bucket, id] = page.key.split(':');
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <ContentContext.Provider value={db}><RecordCard record={{ bucket, id }} mode="browse" chrome="popup" onExit={noop} {...slots} /></ContentContext.Provider>,
    );
    const controls = host.querySelector('.ast-head .ast-controls')!;
    expect(controls.querySelector('.slot-act'), 'headerActions in the page header').toBeTruthy();
    expect(controls.lastElementChild!.matches('.picker-close')).toBe(true);
    const box = host.querySelector('.ast-pop [data-ours]');
    expect(box?.textContent).toBe('Synthetic Feat: A note of ours.');
    expect(box!.querySelector('[data-ours-kind="note"]')).toBeTruthy();
    expect(box!.compareDocumentPosition(host.querySelector('.slot-foot')!) & Node.DOCUMENT_POSITION_FOLLOWING, 'footer after the ours box').toBeTruthy();
    const hb = document.createElement('div');
    hb.innerHTML = renderToStaticMarkup(
      <ContentContext.Provider value={db}><RecordCard record={{ title: 'Synthetic Page', text: 'Body words here.' }} mode="browse" chrome="popup" onExit={noop} {...slots} /></ContentContext.Provider>,
    );
    expect(hb.querySelector('.picker-head .slot-act'), 'headerActions in the fallback header').toBeTruthy();
    const body = hb.querySelector('.info-body')!;
    expect(body.querySelector('[data-ours]')?.textContent).toBe('Synthetic Feat: A note of ours.');
    expect(body.lastElementChild!.matches('.slot-foot')).toBe(true);
  });

  it('there is no "Full page" button (owner ruling 2026-10-02) and every per-surface switch is off but the ones whose step landed', () => {
    for (const [i, e] of sample.slice(0, 60).entries()) expect(staticRender(e.node, i), e.key).not.toMatch(/Full page/i);
    expect(Object.keys(CARD_ON).length).toBeGreaterThan(0);
    // Card step 5 turns StatDetailModal's full text into the 'mine' card (test/card-statdetail.test.tsx),
    // so the page's own use lines reach that popup; a landed switch may stand either way (section 9:
    // turning it back is one line and the tests still hold), every surface not yet landed is off.
    // batch card premise: feat-4458 "Frequency once per day"
    const landed = new Set(['statDetail']);
    for (const [surface, on] of Object.entries(CARD_ON)) if (!landed.has(surface)) expect(on, surface).toBe(false);
  });
});
