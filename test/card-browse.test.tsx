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
import { RecordCard } from '../src/sheet/RecordCard';
import type { OursLine } from '../src/sheet/cardModel';
import { isNotOwnPage, pageSliceOf, recordTree, textOf, variantSection } from '../src/sheet/astVisibility';
import { aonIndex, stubIds, stubRefs } from '../src/sheet/astStubs';

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
 *     renders the markdown fallback; no "Full page" button anywhere (owner ruling, section 13). (Until
 *     card step 22 it also checked the per-surface switches; step 22 removed them.)
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
/** The sample records whose read step 12 changed, with why (on this file's loaded buckets). */
function step12Changed(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of sample) {
    if (e.kind === 'homebrew') continue;
    const [b, s] = e.key.split(':');
    const old = trees[b]?.[s] ? preStep12Cut(trees[b][s], s) : undefined;
    const now = recordTree(b, s, (x, y) => trees[x]?.[y]);
    if (JSON.stringify(old) === JSON.stringify(now)) continue;
    out[e.key] = pageSliceOf(b, s) ? 'F6b page slice' : isNotOwnPage(b, s) ? 'F6 not own page: own text' : 'F5 own section';
  }
  return out;
}
/** Measured 2026-10-06 in the step-12 lane on the shipped data (see the re-baseline block): 10 of the 300.
 *  The two implement benefits now show their own section of the implement page (F5 rule c); the two
 *  doctrines, the creed and the inventor modification show their bullet of the doctrine / creed /
 *  innovation page, the curse its section of the mystery page, the two actions their paragraph of the feat
 *  that prints them (F6b); the drake rifle shows the family page with only its own line of the variant list
 *  (F6b kind 'line', round 3: round 2 had it on old text although its page prints the "Cold …" line).
 *  Before step 12 each drew the whole family page, or (no page) the old text. */
const STEP12_CHANGED: Record<string, string> = {
  'actions:overawe-crowd': 'F6b page slice',
  'actions:stonestrike-stance': 'F6b page slice',
  'classFeatures:adept-benefit-regalia': 'F5 own section',
  'classFeatures:curse-of-turbulent-moments': 'F6b page slice',
  'classFeatures:initiate-benefit-amulet': 'F5 own section',
  'classFeatures:major-creed': 'F6b page slice',
  'classFeatures:second-doctrine-cloistered-cleric': 'F6b page slice',
  'classFeatures:tensile-absorption': 'F6b page slice',
  'classFeatures:third-doctrine-warpriest': 'F6b page slice',
  // batch card premise: equipment-1166 "Cold Frozen spittle clings to the target" — its own line.
  'items:drake-rifle-cold': 'F6b page slice',
};

/** Card step 14b (docs/card-design.md section 2 rule 6), measured 2026-10-08 in the lane against a
 *  snapshot written on 3c7cca0 before any step-14b edit: of the 320 renders, 2 first frames draw stubs
 *  their loaded buckets resolve — classFeatures:initiate-benefit-amulet (the name link "Amulet's Abeyance",
 *  aon:action-1229; already a STEP12_CHANGED record, so it differs from the pre-extraction frame anyway)
 *  and the one below. Every other render is byte-equal; with the stub elements taken out these are too. */
const STEP14B_CHANGED: Record<string, string> = {
  'classFeatures:swarm-eidolon': 'embeds 4 class-feature pages (Haunting Visage, Swarming Assault, Redistribute, Sickening Assault)',
};
/** Wording merge (docs/card-design.md section 13, "A glyph sits in the line the page prints it in",
 *  2026-10-08): a glyph the page prints inside a line now draws inside that line, so a frame whose glyph
 *  stood on a block of its own moves its <p>/<div> boundaries — accepted only when its inline content (every
 *  word, link and glyph span, in order) is the snapshot's. The browse card is the search popup: no use line
 *  is hidden there, so no frame may gain or lose a word. */
const inlineOf = (html: string) => html.replace(/<\/?(?:p|div)\b[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
/** The markup with every embedded stub element (page, compact list, name) taken out, through the DOM. */
function without14bStubs(html: string): string {
  const host = document.createElement('div');
  host.innerHTML = html;
  host.querySelectorAll('[data-stub-list], [data-stub]').forEach((e) => e.remove());
  return host.innerHTML;
}
function viaDomHtml(html: string): string {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.innerHTML;
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
  // batch card: #card-NOT-VACUOUS — the case measures something
  it('draws 275 page records, 20 without a page and 5 homebrew nodes', () => {
    expect(sample.length).toBe(300);
    expect(new Set(sample.map((s) => s.key)).size).toBe(300);
    for (const b of BUCKETS) expect(sample.filter((s) => s.kind === 'page' && s.key.startsWith(`${b}:`)).length, b).toBe(PAGE_COUNTS[b]);
    expect(sample.filter((s) => s.kind === 'nopage').length).toBe(NO_PAGE);
    expect(sample.filter((s) => s.kind === 'homebrew').length).toBe(5);
  });

  // batch card: #card-SNAPSHOT — a step changes only its own surface
  it.skipIf(!SNAP)('byte-equal to the pre-extraction DescriptionModal (CARD_BROWSE_SNAPSHOT)', async () => {
    const now = await allRenders();
    if (WRITE) {
      writeFileSync(SNAP!, JSON.stringify(now));
      return;
    }
    // batch card: #card-SNAPSHOT — a step changes only its own surface
    expect(existsSync(SNAP!), `snapshot ${SNAP} missing — write it on the pre-extraction tree with CARD_BROWSE_WRITE=1`).toBe(true);
    const before = JSON.parse(readFileSync(SNAP!, 'utf8')) as typeof now;
    expect(Object.keys(now)).toEqual(Object.keys(before));
    // Card step 12 re-baseline: the browse popup of a record whose READ step 12 changed is no longer the
    // pre-extraction popup, by design — its family page is cut to its own section (F5), its page that is
    // not its own gives way to its own text (F6, src/data/not-own-page.json) or to its paragraph of a
    // bigger page (F6b, src/data/page-slices.json). Those records are pinned with their reason in
    // STEP12_CHANGED and must differ; every other record stays byte-equal.
    // batch card: #card-SNAPSHOT — only the records step 12 re-read differ, each pinned with its reason
    const changed = step12Changed();
    expect(changed).toEqual(STEP12_CHANGED);
    let diffs = 0;
    // Card step 14b re-baseline: a non-item page whose stubs resolve from a loaded bucket draws them in its
    // first frame (the embedded page, a compact list, a name) — pinned in STEP14B_CHANGED; with those
    // elements taken out it is the pre-extraction frame, byte for byte.
    // batch card: #card-SNAPSHOT — only the step-14b stub records differ
    const drawsStubs = Object.keys(now).filter((k) => !k.startsWith('items:') && !(k in changed) && /data-stub/.test(now[k].first));
    expect(drawsStubs).toEqual(Object.keys(STEP14B_CHANGED));
    let moved = 0;
    for (const k of Object.keys(now)) {
      if (now[k].first !== before[k].first || now[k].settled !== before[k].settled) diffs++;
      if (k in changed) {
        // batch card: #card-SNAPSHOT — a step changes only its own surface
        expect(now[k].first === before[k].first && now[k].settled === before[k].settled, `${k} (${changed[k]}) changed`).toBe(false);
        continue;
      }
      if (k in STEP14B_CHANGED) {
        // batch card: #card-STUBS — a step-14b record draws its embedded pages
        expect(now[k].first, `${k} (${STEP14B_CHANGED[k]}) changed`).not.toBe(before[k].first);
        // Wording merge: with the stubs out, the pre-extraction frame — its block boundaries alone may move.
        // batch card: #card-SNAPSHOT — with the stubs out, the pre-extraction frame
        expect(inlineOf(without14bStubs(now[k].first)), `${k}: only the stubs changed`).toBe(inlineOf(viaDomHtml(before[k].first)));
        expect(now[k].settled, `${k} settled frame`).toBe(before[k].settled);
        continue;
      }
      if (now[k].first === before[k].first && now[k].settled === before[k].settled) continue;
      // batch card: #card-GLYPH — a glyph the page prints
      // in a line draws in it; the words, links and glyphs stay, in order.
      expect(inlineOf(now[k].first), `${k} first frame`).toBe(inlineOf(before[k].first));
      expect(inlineOf(now[k].settled ?? ''), `${k} settled frame`).toBe(inlineOf(before[k].settled ?? ''));
      moved++;
    }
    // Measured 2026-10-08 on main (2f6ee78 + the wording round) against card-step3-browse-snapshot.json.
    // batch card: #card-SNAPSHOT — the measured count of boundary moves
    expect(moved, 'records whose block boundaries moved').toBe(35);
    expect(diffs).toBe(Object.keys(STEP12_CHANGED).length + Object.keys(STEP14B_CHANGED).length + moved);
  });

  // batch card: #card-NOT-VACUOUS — the sample holds every branch
  it('every branch is in the sample: page, loading placeholder, markdown fallback', async () => {
    // batch card: #card-OWN-SECTION — a record whose read step 12 changed
    // (STEP12_CHANGED) is drawn by its new lane: its own section or slice is a page, its own text a fallback.
    const step12 = (e: Entry) => e.key in STEP12_CHANGED;
    for (const [i, e] of sample.filter(step12).entries()) {
      const html = staticRender(e.node, i);
      if (STEP12_CHANGED[e.key].startsWith('F6 ')) expect(html, e.key).toMatch(/^<div class="picker-overlay"><div class="picker info-modal">/);
      else expect(html.startsWith('<div class="picker-overlay"><div class="ast-modal"><div class="ast-pop">'), e.key).toBe(true);
    }
    const page = sample.filter((s) => s.kind === 'page' && !step12(s));
    // batch card: #card-NOT-VACUOUS — the case measures something
    for (const [i, e] of page.entries()) expect(staticRender(e.node, i).startsWith('<div class="picker-overlay"><div class="ast-modal"><div class="ast-pop">'), e.key).toBe(true);
    const np = sample.filter((s) => s.kind === 'nopage' && !step12(s));
    for (const [i, e] of np.entries()) {
      expect(staticRender(e.node, i), `${e.key} first frame`).toContain('<div class="ast-body ast-loading" aria-busy="true">');
      expect(await mountedRender(e.node, i), `${e.key} settled`).toMatch(/^<div class="picker-overlay"><div class="picker info-modal"><div class="picker-head">/);
    }
    for (const [i, e] of sample.filter((s) => s.kind === 'homebrew').entries())
      // batch card: #card-NOT-VACUOUS — the case measures something
      expect(staticRender(e.node, i), e.key).toMatch(/^<div class="picker-overlay"><div class="picker info-modal">/);
  });

  // batch card: #card-R1 — one card per record
  it('a cross-link drills in, and Back returns to the first node', async () => {
    const { slug, target } = linkedRecord();
    const host = await mount(modalEl(nodeOf('feats', slug), 1, { pin: null }));
    const name = () => host.querySelector('.ast-head .ast-name')?.textContent;
    const first = name();
    expect(first).toBeTruthy();
    // batch card: #card-R1 — one card per record
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
    // batch card: #card-NOT-VACUOUS — the link the case clicks exists
    expect(at, `${slug} carries a live link to ${target}`).toBeGreaterThanOrEqual(0);
    const anchors = [...host.querySelectorAll<HTMLElement>('.ast-body a.ast-lk')];
    expect(anchors.length, 'one anchor per live body link').toBe(liveRefs.length);
    const link = anchors[at];
    // batch card: #card-R1 — a link inside the card drills in on the same card
    expect(link.textContent, `${slug} → ${target}`).toBe(liveRefs[at].label);
    await act(async () => { link.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // batch card: #card-R1 — a link inside the card drills in; Back returns
    expect(name(), 'the drilled-in page is open').not.toBe(first);
    expect(name(), 'and it is the computed target').toBe(headName(variantSection(trees[tb][ts], ts)));
    const back = host.querySelector<HTMLElement>('.info-back');
    expect(back, 'Back shows once drilled in').toBeTruthy();
    await act(async () => { back!.click(); });
    expect(name()).toBe(first);
    // batch card: #card-R1 — one card per record
    expect(host.querySelector('.info-back')).toBeNull();
  });

  // batch card: #card-R1 — one card per record
  it('Escape closes the whole chain (onExit), never just one level (onClose)', async () => {
    const { slug } = linkedRecord();
    const onClose = vi.fn();
    const onExit = vi.fn();
    const host = await mount(modalEl(nodeOf('feats', slug), 1, { onClose, onExit, pin: null }));
    await act(async () => { host.querySelector<HTMLElement>('.ast-body a.ast-lk')!.click(); });
    // batch card: #card-R1 — one card per record
    expect(host.querySelector('.info-back')).toBeTruthy();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    // Without onExit, Escape falls back to onClose (exit = onExit ?? onClose).
    mounted.pop()!.stop();
    const onlyClose = vi.fn();
    await mount(modalEl(nodeOf('feats', slug), 1, { onClose: onlyClose, pin: null }));
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    // batch card: #card-R1 — one card per record
    expect(onlyClose).toHaveBeenCalledTimes(1);
  });

  // batch card: #card-ORDER — the mine card's order and controls
  it('the PinStar is in the header on the page and fallback branches, and pins the caller\'s own node', async () => {
    const toggle = vi.fn();
    const pin: PinDescApi = { has: () => false, toggle };
    const pageNode = sample.find((s) => s.kind === 'page' && s.key.startsWith('spells:'))!.node;
    const host = await mount(modalEl(pageNode, 1, { pin }));
    const star = host.querySelector<HTMLElement>('.ast-head .ast-controls button.info-star');
    // batch card: #card-ORDER — the mine card's order and controls
    expect(star, 'star in the page header').toBeTruthy();
    await act(async () => { star!.click(); });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toggle.mock.calls[0][0]).toBe(pageNode);
    const hb = HOMEBREW[0];
    const host2 = await mount(modalEl(hb, 1, { pin }));
    const star2 = host2.querySelector<HTMLElement>('.picker-head button.info-star');
    // batch card: #card-ORDER — the mine card's order and controls
    expect(star2, 'star in the fallback header').toBeTruthy();
    await act(async () => { star2!.click(); });
    expect(toggle.mock.calls[1][0]).toBe(hb);
  });

  // batch card: #card-LOADING — a placeholder while the page loads, never old text
  it('a record whose page is still loading shows the shell and a placeholder body, not the old text', () => {
    // heritages is never loaded in this file, so the hook seeds `loading` for any heritage id.
    const id = Object.keys(db.heritages).sort()[0];
    const html = staticRender(nodeOf('heritages', id), 1);
    expect(html).toMatch(/^<div class="picker-overlay"><div class="ast-modal"><div class="ast-pop"><div class="ast-bar"><\/div><div class="ast-head"><span class="ast-name">/);
    expect(html).toContain('<div class="ast-body ast-loading" aria-busy="true">');
    // batch card: #card-LOADING — a placeholder while the page loads, never old text
    expect(html).not.toContain('info-body');
  });

  // batch card: #card-S7 — no page: our text, marked
  it('a record with no page renders its markdown fallback', async () => {
    const e = sample.find((s) => s.kind === 'nopage' && s.node.description.trim().length > 40)!;
    const host = await mount(modalEl(e.node, 1, { pin: null }));
    expect(host.querySelector('.ast-modal')).toBeNull();
    expect(host.querySelector('.picker.info-modal .picker-head .info-title')?.textContent).toBe(e.node.title);
    const body = host.querySelector('.picker.info-modal .info-body');
    // batch card: #card-S7 — no page: our text, marked
    expect(body, e.key).toBeTruthy();
    const firstWords = e.node.description.replace(/[*_#>[\]|`-]/g, ' ').split(/\s+/).filter((w) => /^[A-Za-z]{4,}$/.test(w)).slice(0, 3);
    for (const w of firstWords) expect(body!.textContent, `${e.key} "${w}"`).toContain(w);
  });

  // batch card: #card-R1 — one card per record
  it('RecordCard by {bucket,id} or by {title,text} renders what DescriptionModal renders for the same node', () => {
    const wrapCard = (el: ReactElement) => renderToStaticMarkup(<ContentContext.Provider value={db}>{el}</ContentContext.Provider>);
    for (const e of sample.filter((s) => s.kind === 'page').slice(0, 40)) {
      const [bucket, id] = e.key.split(':');
      const card = wrapCard(<RecordCard record={{ bucket, id }} mode="browse" chrome="popup" onExit={noop} />);
      expect(card, e.key).toBe(renderToStaticMarkup(modalEl(e.node, 1, { pin: null })));
    }
    for (const n of HOMEBREW) {
      const card = wrapCard(<RecordCard record={{ title: n.title, text: n.description, refs: n.descRefs }} mode="browse" chrome="popup" onExit={noop} />);
      // batch card: #card-R1 — one card per record
      expect(card, n.title).toBe(renderToStaticMarkup(modalEl(n, 1, { pin: null })));
    }
  });

  // batch card: #card-ORDER — the mine card's order and controls
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
    // batch card: #card-ORDER — the mine card's order and controls
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
    // batch card: #card-ORDER — the mine card's order and controls
    expect(hb.querySelector('.picker-head .slot-act'), 'headerActions in the fallback header').toBeTruthy();
    const body = hb.querySelector('.info-body')!;
    expect(body.querySelector('[data-ours]')?.textContent).toBe('Synthetic Feat: A note of ours.');
    expect(body.lastElementChild!.matches('.slot-foot')).toBe(true);
  });

  // batch card: #card-NO-FULL-PAGE — no Full page button
  it('there is no "Full page" button (owner ruling 2026-10-02)', () => {
    for (const [i, e] of sample.slice(0, 60).entries()) expect(staticRender(e.node, i), e.key).not.toMatch(/Full page/i);
  });
});

/*
 * Card step 14 — THE BROWSE RE-BASELINE (docs/card-design.md section 2 rule 6: "This changes the approved
 * browse popup, so browse is re-baselined in the same commit"). An item page's browse card draws the pages
 * its stubs embed (src/sheet/astStubs.ts STUB_HOST_BUCKETS). Measured 2026-10-07: the snapshot block above
 * stays byte-equal on all 320 renders — its first frames are drawn before a stub's bucket (weaponGroup,
 * armorGroup …) has arrived, when the stubs still draw nothing — so the change is pinned here instead: for
 * every sampled item page that embeds a page, plus the longsword and full plate, the settled browse card
 * with every stub bucket loaded is the pre-step popup (the first frame, byte-equal to the pre-extraction
 * snapshot) with the embedded pages added at the stubs' places, and NOTHING ELSE changed. Every other
 * bucket's browse card drew its stubs as nothing until card step 14b, which turns them on (the last test
 * below; test/card-stubs.test.tsx).
 *
 * MUTATION LINE (measured red on 2026-10-07, restored byte-exact): RecordCard.tsx browse lane
 * `node={browseTree ?? astNode}` → `node={astNode}` → red (no page embedded).
 */
describe('card step 14: an item page\'s browse card adds its embedded pages and changes nothing else', () => {
  // batch card: #card-STUBS — an embedded page drawn once, one level deep
  it('the sampled item pages with stubs, the longsword and full plate', async () => {
    const idx = aonIndex(db);
    const withStubs = sample
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.kind === 'page' && e.key.startsWith('items:') && stubRefs(recordTree('items', e.key.slice(6), (b, s) => trees[b]?.[s]), idx).length > 0);
    const named = ['longsword', 'full-plate'].map((slug, k) => ({ e: { kind: 'page' as const, key: `items:${slug}`, node: nodeOf('items', slug) }, i: 1000 + k }));
    const cases = [...withStubs, ...named];
    // The pre-step popup: the first frame before any stub bucket has arrived (a stub already resolvable
    // from a loaded bucket is taken out below, on both sides).
    const strip = (html: string) => {
      const host = document.createElement('div');
      host.innerHTML = html;
      host.querySelectorAll('[data-stub]').forEach((s) => s.remove());
      return host.innerHTML;
    };
    const before = cases.map(({ e, i }) => strip(staticRender(e.node, i)));
    // Every bucket a stub on these pages may draw from, loaded through the same fetch stub.
    const need = new Set<string>();
    for (const { e } of cases) for (const id of stubIds(recordTree('items', e.key.slice(6), (b, s) => trees[b]?.[s]))) for (const t of idx.get(id) ?? []) need.add(t.bucket);
    for (const b of need) {
      if (!trees[b]) trees[b] = readGz(`public/ast/${b}.json.gz`);
      await loadBucketAst(b);
    }
    let embedded = 0;
    for (const [k, { e, i }] of cases.entries()) {
      const host = await mount(modalEl(e.node, i));
      const refs = stubRefs(recordTree('items', e.key.slice(6), (b, s) => trees[b]?.[s]), idx);
      // batch card: #card-STUBS — an embedded page drawn once, one level deep
      for (const ref of refs) expect(host.querySelector(`.ast-pop > .ast-body [data-stub="${ref}"]`), `${e.key} draws ${ref}`).toBeTruthy();
      embedded += host.querySelectorAll('[data-stub]').length;
      expect(strip(host.innerHTML), `${e.key}: only the embedded pages changed`).toBe(before[k]);
      mounted.pop()!.stop();
    }
    // Measured 2026-10-07: 2 of the 46 sampled item pages embed a page (their groups' pages), plus the two
    // named cases — 4 pages embedded, each on its own card, nothing else moved.
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(withStubs.map(({ e }) => e.key)).toEqual(['items:dwarven-waraxe', 'items:sling-bullets']);
    expect(embedded).toBe(4);
    // batch card premise: weapon-group-15 "becoming off-guard until the start of your next turn"
    const sword = await mount(modalEl(nodeOf('items', 'longsword'), 1));
    expect(sword.querySelector('[data-stub="weaponGroup:sword"]')?.textContent).toContain('becoming off-guard until the start of your next turn');
  });

  /*
   * The other half of the re-baseline (step 14's round-2 refute): only ITEM pages resolve their stubs.
   * The snapshot block above cannot see this (its first frames draw before any stub bucket arrives), so
   * here every bucket these stubs draw from (actions, feats) is already loaded and each page's stubs are
   * proven resolvable first — yet the browse card draws them as nothing, byte-equal to its first frame.
   * Pages (scratch scan of public/ast, 2026-10-07: 68 class-feature, 28 feat, 1 action and 1 spell page
   * carry a stub that resolves): Rage (embeds the Rage action), Arcane Safeguards (Resist Magic), the
   * Knight Vigilant archetype page (21 feat stubs — the compact list case), Bone Flense (Erupting Spurs).
   *
   * MUTATION LINE (measured red on 2026-10-07, restored byte-exact): RecordCard.tsx browse lane
   * `STUB_HOST_BUCKETS.has(stubHost)` → `(STUB_HOST_BUCKETS.has(stubHost) || true)` → red. Since the
   * step-14 fixer the browse lane asks astStubs.ts browseResolvesStubs (the bucket test); the same
   * mutation there, `STUB_HOST_BUCKETS.has(bucket)` →
   * `(STUB_HOST_BUCKETS.has(bucket) || true)`, measured red again.
   */
  /*
   * Card step 14b turns this test over (docs/card-design.md section 2 rule 6, section 9 row 14b): every
   * bucket now resolves its stubs (STUB_HOST_BUCKETS), so each of these pages DRAWS its first stub — Rage
   * the Rage action, Arcane Safeguards Resist Magic, Bone Flense Erupting Spurs as embedded pages, the
   * Knight Vigilant archetype page its feats as a compact linked list — and the settled card is its first
   * frame (the buckets are loaded, so nothing waits). Per-bucket cases, the compact list, the names and the
   * "only the stubs changed" comparison against the card with step 14b off are test/card-stubs.test.tsx.
   * MUTATION LINE (measured red on 2026-10-08, restored byte-exact): astStubs.ts STUB_HOST_BUCKETS back to
   * `new Set(['items'])` → red (Rage embeds nothing).
   */
  // batch card premise: class-feature-844 "You gain the Rage action, which lets you fly into a frenzy"
  it('a non-item page with resolvable stubs draws them on its browse card (step 14b)', async () => {
    const idx = aonIndex(db);
    const cases: [string, string, string][] = [
      ['classFeatures', 'rage', 'actions:rage'],
      ['feats', 'arcane-safeguards', 'actions:resist-magic'],
      ['feats', 'aon-knight-vigilant', 'feats:knight-vigilant'],
      ['spells', 'bone-flense', 'actions:erupting-spurs'],
    ];
    for (const [k, [bucket, slug, first]] of cases.entries()) {
      const tree = recordTree(bucket, slug, (b, s) => trees[b]?.[s]);
      const refs = stubRefs(tree, idx);
      // The stub resolves: its first candidate's page ships in a bucket this file has loaded.
      // batch card: #card-STUBS — an embedded page drawn once, one level deep
      expect(refs[0], `${bucket}:${slug} first stub`).toBe(first);
      const [tb, ts] = first.split(':');
      expect(trees[tb]?.[ts], `${first} ships`).toBeTruthy();
      // The first frame, re-serialized through the DOM so void tags print alike on both sides.
      const first0 = document.createElement('div');
      first0.innerHTML = staticRender(nodeOf(bucket, slug), 2000 + k);
      const before = first0.innerHTML;
      const host = await mount(modalEl(nodeOf(bucket, slug), 2000 + k));
      // batch card: #card-STUBS — an embedded page drawn once, one level deep
      expect(host.querySelector('.ast-pop > .ast-body'), `${bucket}:${slug} draws its page`).toBeTruthy();
      // batch card premise: feat-3096 "You gain the Resist Magic reaction"
      expect(host.querySelector(`.ast-pop > .ast-body [data-stub="${first}"]`), `${bucket}:${slug} draws ${first}`).toBeTruthy();
      // An archetype page's feats are a compact list entry (name link + badge), every other stub its page.
      // batch card premise: archetype-27 "This archetype has some feats at a level other than"
      expect(!!host.querySelector(`[data-stub-list] > li[data-stub="${first}"]`), `${bucket}:${slug} compact`).toBe(bucket === 'feats' && slug === 'aon-knight-vigilant');
      // batch card premise: spell-2123 "You can use the Erupting Spurs reaction"
      expect(host.innerHTML, `${bucket}:${slug} is its first frame`).toBe(before);
      mounted.pop()!.stop();
    }
    // batch card premise: action-2802 "You tap into your inner fury and begin raging"
    const rage = await mount(modalEl(nodeOf('classFeatures', 'rage'), 2010));
    expect(rage.querySelector('[data-stub="actions:rage"]')?.textContent).toContain('You tap into your inner fury and begin raging');
  });
});
