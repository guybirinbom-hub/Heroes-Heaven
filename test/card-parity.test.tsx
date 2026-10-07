// @vitest-environment jsdom
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { build, content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { FeatDetail, featStatRows, type FeatEntry } from '../src/sheet/FeatDetail';
import { ItemDetail, itemStatRows } from '../src/sheet/ItemDetail';
import { SpellDetail, spellStatRows } from '../src/sheet/SpellsTab';
import { MainTab, PinnedDescCard } from '../src/sheet/MainTab';
import { StatDetailModal } from '../src/sheet/StatDetailModal';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { RecordCard } from '../src/sheet/RecordCard';
import { ChoiceDetails, SearchSelect } from '../src/builder/shared';
import { featEntries } from '../src/sheet/FeatsTab';
import { parseBlocks, cleanRun } from '../src/sheet/RichText';
import { playerFacingContent } from '../src/rules/cursedItems';
import { ACTIVITIES } from '../src/rules/actions';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import { classFeatureDescription } from '../src/rules/featureText';
import { splitHeightening } from '../src/rules/heightening';
import { trustUnencoded } from '../src/data/trustGate';
import { foldsOf } from '../src/sheet/cardScope';
import { cardOn } from '../src/sheet/cardSurfaces';
import type { Character, ContentDatabase, InventoryItem, PinnedDesc } from '../src/rules/types';
import type { DescNode } from '../src/sheet/descref';
import { togglePinnedDesc, type PlayState } from '../src/rules/play';
import * as lib from '../scripts/lib/card-scope.mjs';

/**
 * Card step 4 (docs/card-design.md section 8 check 2, section 9 row 4; owner rulings section 13): the
 * guard's RENDERED half, built before any fix, in report mode.
 *
 * For a seeded sample — mulberry32(20261002), 60 records per surface — plus the named cases in
 * test/card-parity-known.json, it renders the REAL popup of every surface the card will replace and
 * the browse card (RecordCard mode 'browse') for the same {bucket, id}, and reads a verdict off the DOM:
 *
 *   FeatDetail      feats / class features / heritage rows, built by FeatsTab's own featEntries
 *   ItemDetail      every item with a page, and a hidden cursed item through playerFacingContent
 *   SpellDetail     the spell popup (stat rows from fields, body from the description string)
 *   ActionDetail    opened by clicking its chip on MainTab (curated activities + feat actions) — since
 *                   card step 9 the record's 'mine' RecordCard (CARD_ON.actionDetail), modelled by the
 *                   ledger with the same printed set (empty), the tree read by {bucket, id}
 *   StatDetail      "Full text" of a situational line — since card step 5 the 'mine' RecordCard
 *                   (CARD_ON.statDetail), modelled by the ledger with the same printed set (empty)
 *   browse          DescriptionModal (the search popup) for {bucket, id}
 *   ChoiceDetails   the builder's "Details" button for a granted class feature / background feat
 *   builderOrigin   the builder's Background picker (SearchSelect, its filled value opens the popup; since
 *                   card step 7b each option names its record, so the popup reads {backgrounds, id})
 *   pin             a PinStar pressed on FeatDetail / ItemDetail / SpellDetail, the STORED pin reopened by
 *                   MainTab's PinnedDescCard (card step 19: by its {key, slug}; 'mine' from the sheet)
 *
 * The verdict per printed label (OK / MISSING / DIFFERS / DUPLICATED / EXTRA), the IDENTITY flag, spell
 * PLACEMENT (bold preamble and scraped plain header), OURS-LEAK and the UNNAMED omissions read off the
 * DOM must equal the verdict scripts/lib/card-scope.mjs computes from the shipped trees — the same
 * module scripts/card-truth-check.mjs runs over the whole corpus — with ZERO disagreements. Every page
 * line a surface leaves out carries a section 2 rule 5 name (cardScope.ts OMISSION_RULES) or is a
 * counted defect (MISSING / UNNAMED); every line a tree surface draws is a line of the record's page (or
 * a stats row, or inside [data-ours]); the DOM reader reads every non-blank text node outside
 * [data-ours] (a bare <div> included); nothing in a mine popup body sits outside the read body, the stat
 * panel and the named regions; and the sample's ledger findings equal scripts/data/card-truth-baseline.json
 * for the same rows, both ways — which is what catches a change the DOM and the ledger share (a
 * predicate in astVisibility.ts).
 *
 * Not DOM-derived (ledger only, asserted on the named cases): S2 not-own (the census compares a tree
 * with OTHER records' trees and the record's own description), STUBS and CUT-IN-SENTENCE.
 *
 * Also always on, absorbed from step 3's refuter: Back at the first level (backToSource →
 * onBackToSource), the TrustMarker in the browse header, and headerActions in one position on every
 * branch of RecordCard.
 *
 * Every character here is synthesized through build() (name 't'); none is the owner's.
 *
 * SUITE TIME, measured 2026-10-02 under scripts/vt.mjs (three green runs after the round-1 fixes): the
 * 540 sampled popups (plus their browse cards) render and are judged in 49–51 s; the whole file runs in
 * 59–60 s (61–69 s wall clock with vitest start-up).
 *
 * MUTATION LINES (each measured red on 2026-10-02, then restored byte-exact from a scratch copy, sha1
 * checked):
 *  - astVisibility.ts META: `…|craft requirements)` → `…|craft requirements|special)` (a shared
 *    predicate hides every bold "Special" paragraph on the mine popups) → "the sample's findings equal
 *    the card-truth baseline" red (10 rows), and card-truth-check red (524 new S1-UNNAMED entries).
 *  - DescBody.tsx ast path: `<div className="sd-injected">At your level (7): 2d6 extra precision
 *    damage</div>` after the AstRenderer, outside [data-ours] → "every line a tree surface draws is the
 *    page's" (181 lines), the agreement test (181 disagreements) and the named cases red.
 *  - FeatDetail.tsx: the same <div> as a sibling AFTER DescBody (beside .sd-desc, where no line check
 *    reads) → "nothing in a mine popup body is drawn outside … the named regions" red (div.sd-injected).
 *  - AstRenderer.tsx column: `if (hideMeta && isMetaishBlock(n)) return null;` → `if (hideMeta) return
 *    null;` (the old whole-column drop) → the agreement test red (1 disagreement), the ledger unchanged.
 *  - (card step 5) RecordCard.tsx mine page lane: `card={{ printed: printedSet(printed) }}` → `hideMeta`
 *    (the legacy drop on the switched-on statDetail card) → the agreement test red (60 disagreements,
 *    every sampled statDetail row: the ledger models the card).
 *  - (card step 5) astVisibility.ts isCardFurnitureP: `if (t.length < 120) return true;` (a shared
 *    predicate leaving out every short paragraph) → card-truth-check red (S1-MISSING 10,464 → 16,099,
 *    S1-UNNAMED 20,884 → 25,998): the classifier names each line from its own words.
 *  - (card step 7a, fixer round 3, 2026-10-03) ItemDetail.tsx DescBody `astId={pageId}` → `astId={item.id}`
 *    → the hidden-Bag-of-Devouring case red (DOM vs ledger: identity, and "devour" on screen) and nothing
 *    else: the seeded sample draws no `~hidden` row, which is why that case is always rendered. Writing it
 *    found renderItem's `~hidden` rows rendered the RAW cursed item (no `hiddenCurse` on the instance).
 *  - (card step 7a, fixer round 3) FeatDetail.tsx featPinNode `title: entry.name` →
 *    `entry.name.split(" (")[0]` (the stored pin loses the pick) → the named-case test red on
 *    'pin|feats:caustic-nectar' (pick "Acid"): DOM identity false vs the ledger's true.
 *  - (card step 9, 2026-10-06) scripts/lib/card-scope.mjs `actCard` forced undefined (the ledger models
 *    the legacy action popup while the card is on) → the agreement test red (44 disagreements) and the
 *    baseline test red (48 sample rows differ).
 *  - (card step 16 fixer, 2026-10-07) spellCard.ts spellCardModel lane forced 'field' → the owner-case test
 *    red on the ledger ("ledger findings for spellDetail|spells:buzzing-servants": 2 entries) and the
 *    baseline test red (62 sample rows differ).
 *  - (card step 19 merge fixer, 2026-10-07) scripts/lib/card-scope.mjs pin rows `stored.mode === 'mine'` →
 *    `false && …` (the ledger models a pin made from the sheet as the browse card PinnedDescCard no longer
 *    draws) → the agreement test red (11 disagreements, first pin|items:warcallers-chime-of-refuge).
 * Measured in round 0 (that code is unchanged since):
 *  - RecordCard.tsx fallback: headerActions moved back after the title → the headerActions test red.
 *  - RecordCard.tsx page branch: the TrustMarker dropped from headerControls → the TrustMarker test red.
 *  - DescriptionModal.tsx: `onBackToSource={backToSource ? onClose : undefined}` → `undefined` → Back test red.
 */
const SEED = 20261002;
const PER_SURFACE = 60;
const db: ContentDatabase = content();
const noop = () => undefined;
type Rec = { name: string; description?: string; descRefs?: never; level?: number; category?: string; ancestryId?: string | null };
const recs = (b: string) => (db as unknown as Record<string, Record<string, Rec>>)[b] ?? {};
const known = JSON.parse(readFileSync('test/card-parity-known.json', 'utf8')) as {
  /** `pick` (pin rows of feats only): the row is pinned from FeatDetail with that effect pick, so its
   *  title carries the pick suffix ("Caustic Nectar (Acid)") — the ledger models it by reading the slug
   *  of that title, as the stored pin does until card step 19. */
  cases: { key: string; why: string; verdict: Verdict; pick?: string }[];
  /** Card step 11: cases right on a surface's card and wrong again with its switch turned back. */
  legacy?: Record<string, { key: string; why: string; verdict: Verdict; pick?: string }[]>;
};
/** The named cases expected under the switches as they are now: a landed surface whose switch is turned
 *  back is expected at its `legacy` cases too (the baseline's own rule, lib expectedEntries). */
const knownCases = [
  ...known.cases,
  ...Object.entries(known.legacy ?? {}).flatMap(([surface, cases]) => (cardOn(surface as Parameters<typeof cardOn>[0]) ? [] : cases)),
];

type Run = { t?: string; b?: string };
type Block = { runs: Run[]; text: string };
type Verdict = { labels?: Record<string, string>; identity?: boolean; placement?: string[]; oursLeak?: string[]; unnamed?: string[]; s2?: string };
type Row = ReturnType<typeof lib.surfaceRows>['rows'][number];

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function draw<T>(pool: T[], n: number, rng: () => number): T[] {
  const a = pool.slice();
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

/* ------------------------------------------------------------------------------ trees + fetch stub */
const trees: Record<string, Record<string, AstNode>> = {};
/** Every shipped bucket that also holds records — the buckets the ledger builds rows for (browse opens
 *  any of them), so the sample is drawn from the same rows scripts/card-truth-check.mjs judges. */
const BASE_BUCKETS = readdirSync('public/ast')
  .filter((f) => f.endsWith('.json.gz'))
  .map((f) => f.replace(/\.json\.gz$/, ''))
  .filter((b) => { const r = (db as unknown as Record<string, unknown>)[b]; return !!r && typeof r === 'object' && Object.keys(r).length > 0; })
  .sort();
const astIndex = JSON.parse(readFileSync('public/ast-index.json', 'utf8')) as Record<string, string>;
function treeOf(b: string): Record<string, AstNode> | undefined {
  if (trees[b]) return trees[b];
  const p = `public/ast/${b}.json.gz`;
  if (!existsSync(p)) return undefined;
  trees[b] = JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'));
  return trees[b];
}

/* ------------------------------------------------------------------------------ mounting */
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement, cdb: ContentDatabase = db, pin: PinDescApi | null = null): Promise<{ host: HTMLElement; stop: () => void }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ContentContext.Provider value={cdb}><PinContext.Provider value={pin}>{el}</PinContext.Provider></ContentContext.Provider>);
  });
  await settle();
  return { host, stop: () => { act(() => root.unmount()); host.remove(); } };
}
async function click(el: Element | null | undefined) {
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}

/* ------------------------------------------------------------------------------ reading the DOM */
const BLOCK_SEL = 'p, li, td, th, h1, h2, h3, h4, h5, h6, .ast-meta, .ast-ds, .ast-h2, .ast-h3, .ast-actline, .rt-h, .rt-ds';
const OURS_SEL = '[data-ours], .sd-ours, .sd-choice-note';
/** Elements that hold blocks rather than inline text: their own loose text is read as a block of its own. */
const CONTAINERS = new Set(['DIV', 'UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'HR', 'ASIDE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'DETAILS', 'SUMMARY', 'FIGURE', 'BLOCKQUOTE', 'DL', 'DT', 'DD', 'FORM', 'FIELDSET', 'CENTER']);
/**
 * The blocks a popup body draws, in DOCUMENT ORDER: leaf block elements; the inline content left loose
 * inside any container (a <div> included — AstRenderer renders unknown AoN wrappers as fragments, and a
 * string injected in a bare <div> is exactly what must not be missed); and, as a net, every remaining
 * non-blank text node that neither pass reached. Nothing outside [data-ours] is ever unread.
 */
function domBlocks(root: Element | null | undefined): Block[] {
  if (!root) return [];
  const seen = new Set<Node>();
  const isOurs = (e: Element) => !!e.closest(OURS_SEL);
  const markSeen = (e: Element) => { const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); while (w.nextNode()) seen.add(w.currentNode); };
  const runsOf = (el: Node, out: Run[] = []): Run[] => {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) { out.push({ t: n.textContent ?? '' }); seen.add(n); }
      else if (n.nodeType === 1) {
        const e = n as Element;
        if (e.matches(OURS_SEL)) continue;
        if (e.tagName === 'STRONG') { out.push({ b: e.textContent ?? '' }); markSeen(e); }
        else runsOf(e, out);
      }
    }
    return out;
  };
  const found: { runs: Run[]; at: Node }[] = [];
  const all = [...root.querySelectorAll(BLOCK_SEL)].filter((e) => !isOurs(e));
  const leaves = all.filter((e) => !all.some((o) => o !== e && e.contains(o)));
  for (const e of leaves) found.push({ runs: runsOf(e), at: e });
  const leafSet = new Set<Element>(leaves);
  const inLeaf = (e: Element) => { for (let x: Element | null = e; x && x !== root; x = x.parentElement) if (leafSet.has(x)) return true; return false; };
  for (const c of [root, ...root.querySelectorAll('*')]) {
    if (isOurs(c) || inLeaf(c)) continue;
    if (c !== root && !CONTAINERS.has(c.tagName) && !c.matches(BLOCK_SEL)) continue;
    const runs: Run[] = [];
    let at: Node | null = null;
    for (const n of Array.from(c.childNodes)) {
      if (n.nodeType === 3) { runs.push({ t: n.textContent ?? '' }); seen.add(n); if ((n.textContent ?? '').trim()) at ??= n; }
      else if (n.nodeType === 1) {
        const e = n as Element;
        if (e.matches(BLOCK_SEL) || e.matches(OURS_SEL) || e.querySelector(BLOCK_SEL) || CONTAINERS.has(e.tagName)) continue;
        at ??= e;
        if (e.tagName === 'STRONG') { runs.push({ b: e.textContent ?? '' }); markSeen(e); }
        else runsOf(e, runs);
      }
    }
    if (at) found.push({ runs, at });
  }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode;
    if (seen.has(n) || !(n.textContent ?? '').trim() || (n.parentElement && isOurs(n.parentElement))) continue;
    seen.add(n);
    found.push({ runs: [n.parentElement?.closest('strong') ? { b: n.textContent ?? '' } : { t: n.textContent ?? '' }], at: n });
  }
  found.sort((a, b) => (a.at === b.at ? 0 : a.at.compareDocumentPosition(b.at) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return found.map((f) => ({ runs: f.runs, text: lib.runsText(f.runs) })).filter((b) => /[A-Za-z0-9]/.test(b.text));
}

/**
 * Regions of a 'mine' popup body that are neither a read body nor inside one: the stat panel, the trait
 * chips, the controls. Each is recorded by its signature (tag + first class) so a region that is not on
 * REGIONS (below) — a string drawn beside the description rather than in it — turns the test red.
 */
const regionSeen = new Map<string, Set<string>>();
function noteRegions(surface: string, container: Element | null, bodies: Element[]) {
  if (!container) return;
  const set = regionSeen.get(surface) ?? new Set<string>();
  regionSeen.set(surface, set);
  const walk = (el: Element) => {
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) { if ((n.textContent ?? '').trim()) set.add(`#text in ${sig(el)}`); continue; }
      if (n.nodeType !== 1) continue;
      const c = n as Element;
      if (bodies.includes(c)) continue;
      if (bodies.some((b) => c.contains(b))) { walk(c); continue; }
      if ((c.textContent ?? '').trim()) set.add(sig(c));
    }
  };
  walk(container);
}
const sig = (e: Element) => `${e.tagName.toLowerCase()}${e.classList.length ? '.' + e.classList[0] : ''}`;
const REGIONS_MEASURED: Record<string, string[]> = {
  // Card step 8: FeatDetail's ours box ([data-ours], after the body) and a homebrew record's use lines
  // ([data-ours], above it) — our words, read by the ours case below, never by the line checks.
  // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
  // Card step 11: the Feats-tab popup is the 'mine' card — its header (name, glyph, chips, Back / PinStar /
  // close) sits beside its body, as on the statDetail and action cards.
  // batch card premise: feat-4458 "Trigger You fail a skill check or saving throw"
  featDetail: cardOn('featDetail') ? ['div.ast-head', 'div.ast-traits', 'div.picker-head'] : ['div.sd-sub', 'div.sd-traits', 'div.sd-activate', 'div.sd-stats', 'div.card-ours', 'div.card-uselines'],
  itemDetail: ['div.sd-sub', 'div.sd-traits', 'div.sd-stats', 'div.sd-uses', 'div.sd-choice-note'],
  spellDetail: ['div.sd-sub', 'div.sd-traits', 'div.sd-stats', 'div.sd-heighten-h'],
  // Card step 9: the action popup is the 'mine' card — its header (name, glyph, chips, the skill label,
  // prepare toggle and action pin, Back / PinStar / close) sits beside its body, as on statDetail.
  // batch card premise: action-2292 "Trigger An ally is about to use an action that requires a skill check or attack roll"
  actionDetail: cardOn('actionDetail') ? ['div.ast-head', 'div.ast-traits', 'div.picker-head'] : ['div.action-detail-traits'],
  // Card step 5: the 'mine' card's own header (name, cost, chips, Back / PinStar / close) sits beside its
  // body, as on the browse card; the legacy popup read only its body.
  // batch card premise: feat-4458 "Trigger You fail a skill check or saving throw"
  statDetail: cardOn('statDetail') ? ['div.ast-head', 'div.ast-traits', 'div.picker-head'] : [],
};
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

type Read = { lane: 'tree' | 'md'; kind?: 'page' | 'fallback' | 'loading'; body: Element | null; blocks: Block[]; printed: [string, string][]; leak: boolean; glyph?: boolean };
/** The stat panel a detail popup prints (FeatDetail's Activate line and every .sd-stat row). */
function readStats(pop: Element): [string, string][] {
  const out: [string, string][] = [];
  for (const a of pop.querySelectorAll('.sd-body > .sd-activate')) out.push([txt(a.querySelector('strong')), '']);
  for (const s of pop.querySelectorAll('.sd-body > .sd-stats .sd-stat')) out.push([txt(s.querySelector('.sd-stat-k')), txt(s.querySelector('.sd-stat-v'))]);
  return out;
}
const leakIn = (body: Element | null) =>
  !!body && [...body.querySelectorAll('strong')].some((s) => !s.closest(OURS_SEL) && /^(Note|Your choice):$/.test(txt(s)));
function readBody(bodies: Element[], printed: [string, string][]): Read {
  const tree = bodies.some((b) => b.querySelector('.ast-body'));
  return { lane: tree ? 'tree' : 'md', body: bodies[0] ?? null, blocks: bodies.flatMap((b) => domBlocks(b)), printed, leak: bodies.some(leakIn) };
}
/** A browse-mode popup (DescriptionModal / RecordCard): the page branch, the loading shell, or the fallback. */
function readPopup(host: Element): Read {
  const page = host.querySelector('.ast-modal .ast-pop');
  if (page) {
    const loading = page.querySelector('.ast-body.ast-loading');
    const body = page.querySelector(':scope > .ast-body');
    return { lane: 'tree', kind: loading ? 'loading' : 'page', body, blocks: loading ? [] : domBlocks(body), printed: [], leak: false, glyph: !!page.querySelector('.ast-head .ast-ag.head') };
  }
  const body = host.querySelector('.picker.info-modal .info-body');
  return { lane: 'md', kind: 'fallback', body, blocks: domBlocks(body), printed: [], leak: leakIn(body), glyph: false };
}

/* ------------------------------------------------------------------------------ the verdicts */
function norm(v: { labels: Record<string, string>; identity: boolean; placement: string[]; oursLeak: string[]; unnamed: string[] }) {
  return JSON.stringify({
    labels: Object.fromEntries(Object.entries(v.labels).sort(([a], [b]) => a.localeCompare(b))),
    identity: v.identity,
    placement: [...v.placement].sort(),
    oursLeak: [...v.oursLeak].sort(),
    unnamed: [...v.unnamed].sort(),
  });
}
type Omission = { text: string; legacy: string | null; rule: string; unnamed: string[] };
/**
 * The verdict read off the DOM: the surface's render against the browse card of the same record. The
 * omission log is the DOM's too — the browse card's lines the surface does not draw, classified from
 * their own words and the stat rows on screen; the ledger only lends which legacy path dropped a line
 * (`hidden`), which the DOM cannot see.
 */
function domJudge(row: Row, s: Read, ref: Read, hidden: { text: string; rule: string }[] = []) {
  const pageBlocks = ref.kind === 'page' ? ref.blocks : [];
  const page = lib.labelsOf(pageBlocks);
  const printed = lib.printedMap(s.printed);
  const body: Set<string> = lib.bodyLabels(s.blocks, row.surface);
  const ownSq = pageBlocks.map((b) => lib.squash(b.text)).join('|');
  let identity: boolean;
  if (row.mode === 'browse') identity = ref.kind === 'page' && (s.kind !== 'page' || lib.squash(s.blocks.map((b) => b.text).join(' ')) !== lib.squash(pageBlocks.map((b) => b.text).join(' ')));
  else if (s.lane === 'tree') identity = ref.kind === 'page' && s.blocks.some((b) => !ownSq.includes(lib.squash(b.text)));
  else identity = row.read !== null && ref.kind === 'page';
  // batch card premise: doctrine-4 "Second Doctrine (3rd)" — card step 12: a record whose page is not its
  // own (src/data/not-own-page.json) has no page on its browse card either, so, as in the ledger's
  // judgeRow, there is no page to judge its lines against and no label verdicts.
  const labels = (row.mode === 'browse' && identity) || ref.kind === 'fallback' ? {} : lib.labelVerdicts({ page, body, printed, glyph: !!ref.glyph, base: lib.refsBase(pageBlocks) });
  const omitted: Omission[] = row.mode === 'mine' && s.lane === 'tree' && !identity && ref.kind === 'page' ? lib.omissionLog(pageBlocks, s.blocks, hidden, printed) : [];
  const unnamed = [...new Set(omitted.flatMap((o) => o.unnamed))].sort();
  return { labels, identity, placement: row.surface === 'spellDetail' ? [...body].sort() : [], oursLeak: s.leak ? ['appended-ours-html'] : [], unnamed, omitted };
}
function ledgerFull(row: Row) {
  return lib.judgeRow(row, trees, { parseBlocks, cleanRun });
}
function ledgerJudge(row: Row) {
  const r = ledgerFull(row);
  return { ...r, oursLeak: r.oursLeak.filter((o: string) => o === 'appended-ours-html') };
}
const hiddenOf = (row: Row) => (ledgerFull(row).hidden ?? []) as { text: string; rule: string }[];

/* ------------------------------------------------------------------------------ the sample */
let rows: Row[] = [];
let classMismatch: string[] = [];
const featureHome = new Map<string, { classId: string; entry: FeatEntry }>();
let base: Character;
const sample: Record<string, Row[]> = {};
const sampled: { row: Row; key: string }[] = [];

const keyOf = (r: Row) => `${r.surface}|${r.bucket}:${r.id}`;
const actId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const b of BASE_BUCKETS) treeOf(b);
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (/ast-index\.json$/.test(u)) return { ok: true, json: async () => astIndex };
    const m = /ast\/(\w+)\.json$/.exec(u);
    const t = m ? treeOf(m[1]) : undefined;
    return t ? { ok: true, json: async () => t } : { ok: false };
  });
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = noop;
  await loadAstIndex();
  for (const b of BASE_BUCKETS) await loadBucketAst(b);

  const deps = {
    content: db, trees, astIndex,
    statRows: { featStatRows, itemStatRows, spellStatRows },
    activities: ACTIVITIES,
    situationalIds: Object.keys(FEAT_SITUATIONAL).filter((id) => !id.startsWith('trait:')),
    classFeatureDescription, splitHeightening, parseBlocks, cleanRun, foldsOf,
  };
  ({ rows, classMismatch } = lib.surfaceRows(deps));

  base = build('fighter', 20);
  // Which class shows each generic class feature (FeatsTab's own rows for a level-20 build of every class).
  for (const classId of Object.keys(db.classes).sort()) {
    let ch: Character;
    try { ch = build(classId, 20); } catch { continue; }
    for (const e of featEntries(ch, db)) if (e.featureId && !featureHome.has(e.featureId)) featureHome.set(e.featureId, { classId, entry: e });
  }

  const activityByBucketId = new Map<string, string>();
  for (const a of ACTIVITIES) {
    const full = db.actions[actId(a.name)];
    if (full) activityByBucketId.set(`actions:${full.id}`, a.name);
    else if (a.featId) activityByBucketId.set(`feats:${a.featId}`, a.name);
  }
  const renderable: Record<string, (r: Row) => boolean> = {
    featDetail: (r) => r.bucket !== 'classFeatures' || featureHome.has(r.id),
    itemDetail: () => true,
    spellDetail: () => true,
    actionDetail: (r) => (r as { activity?: string }).activity !== undefined || r.bucket === 'feats',
    statDetail: () => true,
    browse: () => true,
    choiceDetails: () => true,
    builderOrigin: () => true,
    pin: (r) => r.bucket !== 'classFeatures' || featureHome.has(r.id),
  };
  const rng = mulberry32(SEED);
  for (const s of lib.SURFACES) {
    const pool = rows.filter((r) => r.surface === s && renderable[s](r)).sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    sample[s] = draw(pool, PER_SURFACE, rng);
    for (const row of sample[s]) sampled.push({ row, key: keyOf(row) });
  }
  // Buckets a ChoiceDetails popup lands in through the name index.
  for (const r of sample.choiceDetails) if (r.read && treeOf(r.read.bucket)) await loadBucketAst(r.read.bucket);
}, 300_000);

afterAll(() => { vi.unstubAllGlobals(); });

/* ------------------------------------------------------------------------------ rendering each surface */
const browseRead = new Map<string, Read>();
async function refOf(bucket: string, id: string): Promise<Read> {
  const k = `${bucket}:${id}`;
  if (browseRead.has(k)) return browseRead.get(k)!;
  const m = await mount(<RecordCard record={{ bucket, id }} mode="browse" chrome="popup" onExit={noop} />);
  const r = readPopup(m.host);
  m.stop();
  browseRead.set(k, r);
  return r;
}

function featEntryFor(row: Row, extra?: Partial<Character>): FeatEntry | undefined {
  if (row.bucket === 'feats') {
    const rec = recs('feats')[row.id];
    const ch = { ...base, feats: [{ featId: row.id, level: rec.level ?? 1, category: (rec.category ?? 'general') as never }], ...extra } as Character;
    return featEntries(ch, db).find((e) => e.featId === row.id);
  }
  if (row.bucket === 'heritages') {
    const ch = { ...base, heritageId: row.id, secondHeritageId: undefined, ...extra } as Character;
    return featEntries(ch, db).find((e) => e.heritageId === row.id);
  }
  return featureHome.get(row.id)?.entry;
}

async function renderFeat(entry: FeatEntry): Promise<Read> {
  const m = await mount(<FeatDetail entry={entry} onClose={noop} />);
  if (cardOn('featDetail')) {
    // Card step 11: the popup is the row's 'mine' RecordCard (CARD_ON.featDetail), read as the statDetail
    // and action cards are — the page lane's body is the card's .ast-body (its ours box and our Source line
    // are [data-ours], outside the read); the no-page lane's is .info-body. No character is passed, so the
    // card is unscoped, as the ledger's row is (the scope grid is the ledger's own pass).
    // batch card premise: feat-4458 "Frequency once per day"
    const page = m.host.querySelector('.ast-modal.card-mine .ast-pop');
    const cpop = page ?? m.host.querySelector('.picker.info-modal.card-mine');
    const body = page ? page.querySelector(':scope > .ast-body') : cpop?.querySelector('.info-body') ?? null;
    noteRegions('featDetail', cpop, body ? [body] : []);
    const r: Read = { lane: page ? 'tree' : 'md', body, blocks: domBlocks(body), printed: [], leak: leakIn(body) };
    m.stop();
    return r;
  }
  const pop = m.host.querySelector('.picker.spell-detail')!;
  const bodies = [...pop.querySelectorAll(':scope .sd-body > .sd-desc')];
  noteRegions('featDetail', pop.querySelector('.sd-body'), bodies);
  const r = readBody(bodies, readStats(pop));
  m.stop();
  return r;
}
async function renderItem(row: Row): Promise<Read> {
  const hidden = row.id.endsWith('~hidden');
  const id = hidden ? row.id.slice(0, -'~hidden'.length) : row.id;
  // `hiddenCurse` is what makes playerFacingContent disguise it (cursedItems.ts hiddenCursedIds): without
  // it a `~hidden` row rendered the RAW cursed item (found by the hidden-bag case, card step 7a fixer).
  const inv: InventoryItem = { instanceId: 'i-card', itemId: id, quantity: 1, ...(hidden ? { hiddenCurse: true } : {}) } as InventoryItem;
  const cdb = hidden ? playerFacingContent(db, [inv]) : db;
  const m = await mount(<ItemDetail inv={inv} item={cdb.items[id]} content={cdb} onClose={noop} />, cdb);
  const pop = m.host.querySelector('.picker.spell-detail')!;
  const descs = [...pop.querySelectorAll(':scope .sd-body > .sd-desc')];
  noteRegions('itemDetail', pop.querySelector('.sd-body'), descs.slice(-1));
  const r = readBody(descs.slice(-1), readStats(pop));
  m.stop();
  return r;
}
async function renderSpell(row: Row): Promise<Read> {
  const m = await mount(<SpellDetail spell={db.spells[row.id]} onClose={noop} />);
  const pop = m.host.querySelector('.picker.spell-detail')!;
  const bodies = [...pop.querySelectorAll(':scope .sd-body > .sd-desc, :scope .sd-heighten > .sd-desc')];
  noteRegions('spellDetail', pop.querySelector('.sd-body'), bodies);
  const r = readBody(bodies, readStats(pop));
  m.stop();
  return r;
}
async function renderStat(row: Row): Promise<Read> {
  const breakdown = { title: 'Stat', totalText: '+0', parts: [], timeline: [], situational: [{ text: 'a situational line', sourceId: row.id, sourceCollection: row.bucket as never }] };
  const m = await mount(<StatDetailModal breakdown={breakdown} character={base} content={db} onClose={noop} />);
  await click(m.host.querySelector('.sd-sit-more'));
  if (cardOn('statDetail')) {
    // Card step 5: the full text is RecordCard mode 'mine' — the page lane's body is the card's .ast-body
    // (its footer's ours lines are [data-ours], outside the read); the no-page lane's is .info-body.
    const page = m.host.querySelector('.ast-modal.card-mine .ast-pop');
    const pop = page ?? m.host.querySelector('.picker.info-modal.card-mine');
    const body = page ? page.querySelector(':scope > .ast-body') : pop?.querySelector('.info-body') ?? null;
    noteRegions('statDetail', pop, body ? [body] : []);
    const r: Read = { lane: page ? 'tree' : 'md', body, blocks: domBlocks(body), printed: [], leak: leakIn(body) };
    m.stop();
    return r;
  }
  const bodies = [...m.host.querySelectorAll('.confirm-body > .sd-desc')];
  noteRegions('statDetail', m.host.querySelector('.confirm-body'), bodies);
  const r = readBody(bodies, []);
  m.stop();
  return r;
}
async function renderPopupOf(el: ReactElement, opener: string, cdb: ContentDatabase = db): Promise<Read> {
  const m = await mount(el, cdb);
  await click(m.host.querySelector(opener));
  const r = readPopup(m.host);
  m.stop();
  return r;
}
async function renderBrowse(row: Row): Promise<Read> {
  const rec = recs(row.bucket)[row.id];
  const node: DescNode = { title: rec.name, description: rec.description ?? '', descRefs: rec.descRefs, key: row.bucket, slug: row.id };
  const m = await mount(<DescriptionModal root={node} onClose={noop} />);
  const r = readPopup(m.host);
  m.stop();
  return r;
}
async function renderChoice(row: Row): Promise<Read> {
  const rec = recs(row.bucket)[row.id];
  return renderPopupOf(<ChoiceDetails name={rec.name} flavor={row.md} descRefs={rec.descRefs} bucket={row.bucket} id={row.id} />, '.cc-det');
}
async function renderOrigin(row: Row): Promise<Read> {
  const rec = recs(row.bucket)[row.id];
  return renderPopupOf(
    // The option as OriginPickers builds it (shared.tsx, the Background SetupCard): it names its record
    // (card step 7b). test/card-origin.test.tsx opens the same popup from the real OriginPickers.
    <SearchSelect bare label="Background" value={row.id} onChange={noop} options={[{ id: row.id, name: rec.name, description: rec.description, descRefs: rec.descRefs, record: { bucket: 'backgrounds', id: row.id } }]} />,
    '.ss-filled-body',
  );
}
async function renderPin(row: Row, extra?: Partial<Character>): Promise<Read> {
  let pinned: PinnedDesc | null = null;
  // The pin the player REOPENS is the one stored by togglePinnedDesc (MainTab PinnedDescRow opens the
  // stored pin), not the node the star hands over. Card step 19: storage (play.ts pinOf) keeps the node's
  // record id and mode, and MainTab's PinnedDescCard reopens it — the 'mine' card for a pin made from the
  // sheet, browse otherwise. No character here, so the card is unscoped, as the ledger's row is.
  const pin: PinDescApi = { has: () => false, toggle: (n) => { pinned = togglePinnedDesc({} as PlayState, n).pinnedDescs?.[0] ?? null; } };
  let el: ReactElement;
  if (row.bucket === 'items') el = <ItemDetail inv={{ instanceId: 'i-pin', itemId: row.id, quantity: 1 } as InventoryItem} item={db.items[row.id]} content={db} onClose={noop} />;
  else if (row.bucket === 'spells') el = <SpellDetail spell={db.spells[row.id]} onClose={noop} />;
  else el = <FeatDetail entry={featEntryFor(row, extra)!} onClose={noop} />;
  const m = await mount(el, db, pin);
  // Card step 11: FeatDetail is the 'mine' card — its star sits in the page header (.ast-head) or, on the
  // no-page lane, in .picker-head; it hands over the same node the legacy star did (FeatDetail featCardPin).
  await click(m.host.querySelector('.picker-head .info-star, .ast-head .info-star'));
  m.stop();
  expect(pinned, `${keyOf(row)}: the star pinned a node`).toBeTruthy();
  const p = await mount(<PinnedDescCard pin={pinned!} content={db} onClose={noop} />);
  const r = readPopup(p.host);
  p.stop();
  return r;
}

/** MainTab for a character holding the sampled feat actions; each popup opened from its chip. */
async function renderActions(list: Row[], extraFeats: string[] = []): Promise<Map<string, Read | null>> {
  const featIds = [...new Set([...list.filter((r) => r.bucket === 'feats').map((r) => r.id), ...ACTIVITIES.filter((a) => a.featId).map((a) => a.featId!), ...extraFeats])];
  const ch = { ...base, feats: featIds.map((id) => ({ featId: id, level: recs('feats')[id]?.level ?? 1, category: (recs('feats')[id]?.category ?? 'general') as never })) } as Character;
  const m = await mount(<MainTab character={ch} content={db} onPlay={noop} />);
  const out = new Map<string, Read | null>();
  const seg = (name: string) => [...m.host.querySelectorAll('.seg-btn')].find((b) => txt(b) === name);
  const stab = (name: string) => [...m.host.querySelectorAll('.stab')].find((b) => txt(b) === name);
  const chip = (name: string) => [...m.host.querySelectorAll('.action-chip')].find((c) => txt(c.querySelector('.action-chip-name')) === name);
  for (const row of list) {
    const name = (row as { activity?: string }).activity ?? recs(row.bucket)[row.id].name;
    let found: Element | undefined;
    for (const mode of ['Encounter', 'Exploration', 'Downtime']) {
      const b = seg(mode);
      if (b) await click(b);
      const subs = mode === 'Encounter' ? ['Actions', 'Skills', 'Items'] : [''];
      for (const s of subs) {
        if (s) { const t = stab(s); if (!t) continue; await click(t); }
        found = chip(name);
        if (found) break;
      }
      if (found) break;
    }
    if (!found) { out.set(keyOf(row), null); continue; }
    await click(found);
    if (cardOn('actionDetail')) {
      // Card step 9: the popup is the record's 'mine' RecordCard (CARD_ON.actionDetail), read as the
      // statDetail card is — the page lane's body is the card's .ast-body (its ours box and our Source line
      // are [data-ours], outside the read); the no-page lane's is .info-body.
      // batch card premise: action-2292 "Requirements The ally is willing to accept your aid"
      const page = m.host.querySelector('.ast-modal.card-mine .ast-pop');
      const cpop = page ?? m.host.querySelector('.picker.info-modal.card-mine');
      const body = page ? page.querySelector(':scope > .ast-body') : cpop?.querySelector('.info-body') ?? null;
      noteRegions('actionDetail', cpop, body ? [body] : []);
      out.set(keyOf(row), { lane: page ? 'tree' : 'md', body, blocks: domBlocks(body), printed: [], leak: leakIn(body) });
      await click(m.host.querySelector('.card-mine .picker-close'));
      continue;
    }
    const pop = m.host.querySelector('.picker.info-modal')!;
    const bodies = [...pop.querySelectorAll('.action-detail-desc')];
    noteRegions('actionDetail', pop.querySelector('.info-body'), bodies);
    out.set(keyOf(row), readBody(bodies, []));
    await click(pop.querySelector('.picker-close'));
  }
  m.stop();
  return out;
}

async function renderRow(row: Row, actionReads: Map<string, Read | null>): Promise<Read | null> {
  switch (row.surface) {
    case 'featDetail': { const e = featEntryFor(row); return e ? renderFeat(e) : null; }
    case 'itemDetail': return renderItem(row);
    case 'spellDetail': return renderSpell(row);
    case 'actionDetail': return actionReads.get(keyOf(row)) ?? null;
    case 'statDetail': return renderStat(row);
    case 'browse': return renderBrowse(row);
    case 'choiceDetails': return renderChoice(row);
    case 'builderOrigin': return renderOrigin(row);
    case 'pin': return renderPin(row);
  }
  return null;
}

/* ------------------------------------------------------------------------------ the tests */
const results = new Map<string, { row: Row; dom: ReturnType<typeof domJudge>; led: ReturnType<typeof ledgerJudge>; s: Read; ref: Read }>();
const timing: Record<string, number> = {};

describe('card step 4: the rendered parity check (report mode)', () => {
  it('draws 60 records per surface with mulberry32(20261002)', () => {
    for (const s of lib.SURFACES) expect(sample[s].length, s).toBe(PER_SURFACE);
    expect(new Set(sampled.map((s) => s.key)).size).toBe(sampled.length);
  });

  it('every sampled popup renders and its DOM verdict equals the ledger verdict — zero disagreements', async () => {
    const t0 = Date.now();
    const actionReads = await renderActions(sample.actionDetail);
    const disagreements: string[] = [];
    const unrendered: string[] = [];
    for (const { row, key } of sampled) {
      const s = await renderRow(row, actionReads);
      if (!s) { unrendered.push(key); continue; }
      const ref = await refOf(row.own.bucket, row.own.id);
      const dom = domJudge(row, s, ref, hiddenOf(row));
      const led = ledgerJudge(row);
      results.set(key, { row, dom, led, s, ref });
      if (norm(dom) !== norm(led)) disagreements.push(`${key}\n   dom    ${norm(dom)}\n   ledger ${norm(led)}`);
    }
    timing.render = Date.now() - t0;
    expect(unrendered, 'every sampled record reaches its real popup').toEqual([]);
    expect(disagreements.slice(0, 15).join('\n'), `${disagreements.length} disagreements`).toBe('');
  }, 600_000);

  /*
   * The DOM-equals-ledger test cannot see a change both halves share — a predicate in astVisibility.ts
   * that starts hiding "Special" paragraphs moves the DOM and the ledger together. This one can: the
   * sample's ledger findings must equal scripts/data/card-truth-baseline.json's entries for the same
   * rows, both ways — the full-corpus check's two-way rule, applied to the 540 rows rendered here.
   */
  it('the sample\'s findings equal the card-truth baseline\'s entries for the same rows, both ways', () => {
    // Card step 5: a landed surface whose switch is turned back is expected at the baseline's legacy
    // entries for it (lib expectedEntries), so the one-line switch keeps this test green both ways.
    // batch card premise: feat-4458 "Frequency once per day"
    const baseline = lib.expectedEntries(JSON.parse(readFileSync('scripts/data/card-truth-baseline.json', 'utf8'))) as Record<string, string[]>;
    const problems: string[] = [];
    for (const [key, { row }] of results) {
      const now = new Set(lib.rowEntries(row, ledgerFull(row), foldsOf).map(([s, e]: [string, string]) => `${s}\t${e}`));
      const listed = new Set<string>();
      for (const s of lib.ROW_SECTIONS) for (const e of baseline[s] ?? []) if (e === key || e.startsWith(`${key}|`)) listed.add(`${s}\t${e}`);
      for (const e of now) if (!listed.has(e)) problems.push(`NEW   ${e}`);
      for (const e of listed) if (!now.has(e)) problems.push(`GONE  ${e} (remove it from the baseline: the list only shrinks)`);
    }
    expect(problems.slice(0, 20), `${problems.length} sample rows differ from the baseline`).toEqual([]);
  });

  /*
   * Everything a 'mine' popup draws in its body sits in a read body (checked line by line above), in
   * the stat panel, or in one of these named regions — each a control or chip block section 2 rule 4.3
   * keeps where players have it today, or our sub-line. Measured on this sample 2026-10-02. A region
   * not on this list (a string drawn BESIDE the description, where no line check reads it) fails.
   */
  const REGIONS: Record<string, string[]> = REGIONS_MEASURED;
  it('nothing in a mine popup body is drawn outside the read body, the stat panel and the named regions', () => {
    const unlisted: string[] = [];
    for (const [surface, set] of regionSeen) for (const s of set) if (!(REGIONS[surface] ?? []).includes(s)) unlisted.push(`${surface}: ${s}`);
    console.log(`card-parity: regions seen ${JSON.stringify(Object.fromEntries([...regionSeen].map(([k, v]) => [k, [...v].sort()])))}`);
    expect(unlisted).toEqual([]);
  });

  it('every line a tree surface draws is a line of the record\'s page (or a stats row, or inside [data-ours])', () => {
    const strays: string[] = [];
    for (const [key, { row, s, ref, led }] of results) {
      if (row.mode !== 'mine' || s.lane !== 'tree' || led.identity || ref.kind !== 'page') continue;
      const page = ref.blocks.map((b) => lib.squash(b.text)).join('|');
      const stats = s.printed.map(([k, v]) => lib.squash(k + v)).join('|');
      for (const b of s.blocks) if (!page.includes(lib.squash(b.text)) && !stats.includes(lib.squash(b.text))) strays.push(`${key}: "${b.text.slice(0, 80)}"`);
    }
    expect(strays.slice(0, 10), `${strays.length} lines drawn outside the page and outside [data-ours]`).toEqual([]);
  });

  /*
   * Section 8: every page line a mine surface leaves out carries one of section 2 rule 5's names
   * (src/sheet/cardScope.ts OMISSION_RULES), or is a COUNTED defect — MISSING (a vocabulary label line,
   * in S1-MISSING) or UNNAMED (in S1-UNNAMED, the same list on the DOM and in the ledger, compared by
   * the agreement test). The legacy drop paths (meta-line, metaish-block, inline-row, spoiler) are never
   * a name: a line they drop is classified by its own words.
   */
  it('every page line a surface leaves out carries a section 2 rule 5 name or is a counted defect (logged by rule)', () => {
    const bad: string[] = [];
    const byRule: Record<string, number> = {};
    const byLegacy: Record<string, number> = {};
    const allowed = new Set([...lib.RULE_NAMES, ...lib.OMISSION_DEFECTS]);
    for (const [key, { dom }] of results) {
      for (const o of dom.omitted) {
        byRule[o.rule] = (byRule[o.rule] ?? 0) + 1;
        byLegacy[`${o.legacy ?? 'none'}→${o.rule}`] = (byLegacy[`${o.legacy ?? 'none'}→${o.rule}`] ?? 0) + 1;
        if (!allowed.has(o.rule)) bad.push(`${key}: "${o.text.slice(0, 60)}" → ${o.rule}`);
        if (o.rule === 'UNNAMED' && !o.unnamed.length && !(o as { cont?: boolean }).cont) bad.push(`${key}: "${o.text.slice(0, 60)}" is UNNAMED but counted nowhere`);
      }
    }
    expect(lib.RULE_NAMES, 'the names come from cardScope.ts').toEqual(['S-own', 'S-items', 'S-furniture', 'S-printed', 'S-future', 'S-pick']);
    console.log(`card-parity: page lines left out, by rule ${JSON.stringify(byRule)}; by drop path ${JSON.stringify(byLegacy)}`);
    expect(bad.slice(0, 10), `${bad.length} page lines left out with neither a name nor a count`).toEqual([]);
  });

  it('the named cases (test/card-parity-known.json) are flagged — shrink-only, checked both ways', async () => {
    const t0 = Date.now();
    const problems: string[] = [];
    const census = lib.sharedPageCensus(trees.classFeatures, recs('classFeatures') as never);
    for (const c of knownCases) {
      const [surface, rest] = c.key.split('|');
      const [bucket, idRaw] = rest.split(':');
      const want = JSON.stringify(canon(c.verdict));
      let got: Verdict = {};
      if (c.verdict.s2 !== undefined) {
        // S2 is the census (ledger only); the DOM evidence is the other record's words on screen.
        const [id, cls] = idRaw.split('@');
        const s2 = cls ? (classMismatch.includes(`classFeatures:${id}@${cls}`) ? 'CLASS_MISMATCH' : undefined) : census[id];
        got = s2 ? { s2 } : {};
        const entry = cls ? featEntries(build(cls, 20), db).find((e) => e.featureId === id) : featEntries(build('cleric', 20, { subclassId: 'cloistered-cleric' }), db).find((e) => e.featureId === id);
        expect(entry, `${c.key}: FeatsTab lists the row`).toBeTruthy();
        const s = await renderFeat(entry!);
        const words = s.blocks.map((b) => b.text).join(' ');
        if (cls) expect(words, `${c.key}: the page on screen is another class's`).toMatch(/psychic power/);
        else expect(words, `${c.key}: the page on screen carries other doctrines`).toMatch(/Third Doctrine/);
      } else {
        const ledgerRow = rows.find((r) => keyOf(r) === c.key);
        expect(ledgerRow, `${c.key} is a ledger row`).toBeTruthy();
        let row = ledgerRow;
        let s: Read | null;
        if (c.pick) {
          // A pin made on a row whose name carries a pick. Card step 19: the stored pin keeps the record id
          // the star's node names (play.ts pinOf), so it reads the record by {bucket, id} whatever its title
          // carries — the ledger's own row (card-scope.mjs pinReadOf). Before step 19 it read the slug of
          // the title (card step 7a refuter round 2, T4).
          expect(surface === 'pin' && ledgerRow!.bucket === 'feats', `${c.key}: a pick case is a feats pin row`).toBe(true);
          s = await renderPin(row!, { effectPicks: [{ recordId: ledgerRow!.id, choiceId: 'card-parity-pick', label: c.pick }] } as Partial<Character>);
        } else if (surface === 'actionDetail') s = (await renderActions([row!])).get(c.key) ?? null;
        else s = await renderRow(row!, new Map());
        expect(s, `${c.key} renders`).toBeTruthy();
        const ref = await refOf(row!.own.bucket, row!.own.id);
        const dom = domJudge(row!, s!, ref, hiddenOf(row!));
        const led = ledgerJudge(row!);
        expect(norm(dom), `${c.key}: DOM and ledger agree`).toBe(norm(led));
        got = pick(dom);
        void bucket;
      }
      if (!Object.keys(got).length) problems.push(`${c.key} is right now — remove it from test/card-parity-known.json (the list only shrinks)`);
      else if (JSON.stringify(canon(got)) !== want) problems.push(`${c.key}: verdict is ${JSON.stringify(got)}, the list says ${want} — update the entry only in the commit that changes that popup`);
    }
    timing.known = Date.now() - t0;
    expect(problems).toEqual([]);
  }, 300_000);

  /*
   * The design listed "air-gate with a pick" as a known failure (T3: the kineticist gates print raw
   * table markup and our "Your choice" line once a junction is picked). MEASURED here, it does not
   * reproduce on FeatDetail: a kineticist's gate reaches the Feats tab as a classChoices row
   * (FeatsTab.tsx featEntries, the "Subclass + extra-choice picks" loop), which withPicks never
   * touches, so the junction pick adds nothing to the row's text and its table renders as a table.
   * It is therefore NOT on the known list (a listed case that is right fails the list); this pins the
   * measured behaviour instead — DOM and ledger agree, and nothing of ours is in the body.
   */
  it('Air Gate with a junction picked (kineticist): DOM equals ledger, no ours text in the body, no raw table markup', async () => {
    const gate = db.classes.kineticist.extraChoices?.find((g) => g.options?.some((o) => o.id === 'air-gate'));
    const choice = (db.classFeatures['air-gate'] as { effectChoices?: { id: string; options: { label: string; note?: string }[] }[] }).effectChoices![0];
    const ch0 = build('kineticist', 5, { extraChoices: { [gate!.id]: ['air-gate'] } } as never);
    const ch = { ...ch0, effectPicks: [...(ch0.effectPicks ?? []), { recordId: 'air-gate', choiceId: choice.id, label: choice.options[0].label, note: choice.options[0].note }] } as Character;
    const entry = featEntries(ch, db).find((e) => e.trustFeatureId === 'air-gate' || e.featureId === 'air-gate');
    expect(entry, 'a kineticist with the Air gate lists an Air Gate row').toBeTruthy();
    // Card step 11: switched on, the row is the 'mine' card's (printed set empty, no hideMeta), as the ledger models it.
    const drawn = cardOn('featDetail') ? { hideMeta: false, card: { printed: [] } } : { hideMeta: true };
    const row = { surface: 'featDetail', bucket: 'classFeatures', id: 'air-gate', own: { bucket: 'classFeatures', id: 'air-gate' }, read: { bucket: 'classFeatures', slug: 'air-gate' }, ...drawn, itemLists: false, md: entry!.description, printed: [], mode: 'mine' } as unknown as Row;
    const s = await renderFeat(entry!);
    const dom = domJudge(row, s, await refOf('classFeatures', 'air-gate'), hiddenOf(row));
    expect(norm(dom)).toBe(norm(ledgerJudge(row)));
    // Its dropped Source line is counted in S1-UNNAMED like every other mine popup's; nothing else is off.
    const { unnamed: _counted, ...rest } = pick(dom);
    expect(rest).toEqual({});
    // Card step 11: the card's ours box sits inside its .ast-body (RecordCard's footer slot), [data-ours];
    // the page's own lines are the read blocks, which leave every [data-ours] node out.
    // batch card premise: element-1 "Before or after the other effects of the impulse, you can either Stride up to half your Speed or Step"
    expect(s.blocks.map((b) => b.text).join(' ')).not.toMatch(/Your choice|\| ?---/);
    if (cardOn('featDetail')) expect(txt(s.body?.querySelector('.card-ours[data-ours]'))).toMatch(/Your choice: Elemental Resistance/);
  });

  /*
   * Card step 8 (section 4): a record's own note is an ours line in FeatDetail's [data-ours] box after the
   * body — never appended to the description, where the page lane discarded it. DOM and ledger agree, the
   * body (the read lines) holds nothing of ours, and the box is a listed region.
   */
  // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
  it('card step 8: Caustic Nectar\'s note is drawn in [data-ours] — DOM equals ledger, nothing of ours in the body', async () => {
    const row = rows.find((r) => keyOf(r) === 'featDetail|feats:caustic-nectar');
    expect(row, 'the ledger has the row').toBeTruthy();
    const entry = featEntryFor(row!)!;
    const m = await mount(<FeatDetail entry={entry} onClose={noop} />);
    // Card step 11: on the 'mine' card the ours box follows the page body (RecordCard), still [data-ours].
    // batch card premise: feat-7612 "Your nectar doesn’t add critical specialization effects"
    const box = txt(m.host.querySelector(cardOn('featDetail') ? '.card-mine .card-ours[data-ours]' : '.picker.spell-detail .sd-body > .card-ours[data-ours]'));
    m.stop();
    // batch card premise: feat-7612 "On a critical hit, the target is additionally sickened 1"
    expect(box).toContain(`Note: ${db.feats['caustic-nectar'].note}`);
    const s = await renderFeat(entry);
    const dom = domJudge(row!, s, await refOf('feats', 'caustic-nectar'), hiddenOf(row!));
    // batch card premise: feat-7612 "Your nectar doesn’t add critical specialization effects"
    expect(norm(dom)).toBe(norm(ledgerJudge(row!)));
    // batch card premise: feat-7612 "Your nectar doesn’t add critical specialization effects"
    expect(dom.oursLeak).toEqual([]);
    // batch card premise: feat-7612 "You’re immune to your own nectar"
    expect(s.blocks.map((b) => b.text).join(' ')).not.toContain(db.feats['caustic-nectar'].note!.slice(0, 30));
  });

  /*
   * Card step 7a (section 2 rule 2c, T7): a hidden cursed item reads the page of the record it SHOWS.
   * The sample may not draw a `~hidden` row, so this case is always rendered: a hidden Bag of Devouring
   * (shown as Spacious Pouch) must read Spacious Pouch's page — DOM and ledger agree, no identity flag,
   * and the word "devour" is nowhere on screen. (It left test/card-parity-known.json when 7a fixed it.)
   */
  it('a hidden Bag of Devouring (itemDetail ~hidden) reads Spacious Pouch\'s page and never says "devour" (T7)', async () => {
    const row = rows.find((r) => keyOf(r) === 'itemDetail|items:bag-of-devouring~hidden');
    expect(row, 'the ledger has the hidden row').toBeTruthy();
    expect(row!.read).toEqual({ bucket: 'items', slug: 'spacious-pouch' });
    const s = await renderItem(row!);
    const dom = domJudge(row!, s, await refOf(row!.own.bucket, row!.own.id), hiddenOf(row!));
    expect(norm(dom)).toBe(norm(ledgerJudge(row!)));
    expect(dom.identity, 'the popup reads its own (shown) page').toBe(false);
    expect(s.lane).toBe('tree');
    const words = s.blocks.map((b) => b.text).join(' ');
    expect(words.length, 'the body draws the page').toBeGreaterThan(40);
    expect(words).not.toMatch(/devour/i);
  });

  /*
   * Card step 7b (section 2 rule 2b, T3): the builder's Background picker opens the background's own
   * page by {backgrounds, id}. builderOrigin|backgrounds:acolyte left test/card-parity-known.json when
   * 7b fixed it (S5-IDENTITY builderOrigin 523 → 0); the sample may not draw it, so it is always rendered.
   */
  it('the builder Background popup (Acolyte) reads its own page — DOM equals ledger, no identity flag (T3)', async () => {
    const row = rows.find((r) => keyOf(r) === 'builderOrigin|backgrounds:acolyte');
    expect(row, 'the ledger has the row').toBeTruthy();
    expect(row!.read).toEqual({ bucket: 'backgrounds', slug: 'acolyte' });
    const s = await renderOrigin(row!);
    const dom = domJudge(row!, s, await refOf('backgrounds', 'acolyte'), hiddenOf(row!));
    expect(norm(dom)).toBe(norm(ledgerJudge(row!)));
    expect(dom.identity, 'the popup reads its own page').toBe(false);
    expect(s.lane).toBe('tree');
  });

  it('a case missing from the sample and the list both counts: every owner case is flagged', () => {
    const keys = knownCases.map((c) => c.key);
    // Owner case 3 (featDetail|classFeatures:second-doctrine-cloistered-cleric) is right since card step 12:
    // the record reads its slice of the doctrine page, so it left the shrink-only list; test/card-sections
    // asserts it positively on the mine, browse and Feats-tab popups.
    // batch card premise: doctrine-4 "Second Doctrine (3rd)** Your proficiency rank for Fortitude saves increases to expert"
    // Owner case 1 (featDetail|feats:halfling-luck) is right since card step 11: the Feats-tab popup is the
    // 'mine' card and shows the page's Frequency and Trigger once each, so it left the shrink-only list;
    // test/card-feat.test.tsx asserts it positively through FeatsTab. Switched back, it is wrong again.
    // batch card premise: feat-4458 "Trigger You fail a skill check or saving throw"
    const owner = [...(cardOn('featDetail') ? [] : ['featDetail|feats:halfling-luck'])];
    for (const k of owner) expect(keys, `owner case ${k}`).toContain(k);
    if (cardOn('featDetail')) expect(keys, 'halfling-luck is right on the card').not.toContain('featDetail|feats:halfling-luck');
    // Owner cases 2 and 4 are right since card step 16 (spells phase A): SpellDetail prints the page's
    // own rows (spellCardModel) and takes the printed preamble off the prose, so both left the
    // shrink-only list and must stay off it; test/card-spell.test.tsx asserts them positively.
    // batch card premise: spell-2315 "Duration sustained up to 1 minute"
    // batch card premise: spell-2631 "Area 1 cubic foot"
    for (const k of ['spellDetail|spells:buzzing-servants', 'spellDetail|spells:approximate']) {
      expect(keys, `fixed owner case ${k}`).not.toContain(k);
      // And the ledger agrees: the row it builds for the case (the same spellCardModel the popup renders)
      // carries no finding at all, so forcing the field lane turns THIS test red, not only the list's.
      const row = rows.find((r) => keyOf(r) === k);
      expect(row, `the ledger builds a row for ${k}`).toBeTruthy();
      expect(lib.rowEntries(row!, ledgerFull(row!), foldsOf), `ledger findings for ${k}`).toEqual([]);
    }
  });
});

/** A verdict with its keys and labels in one order, so two spellings of one verdict compare equal. */
function canon(v: Verdict): Verdict {
  const out: Verdict = {};
  for (const k of ['identity', 'labels', 'oursLeak', 'placement', 's2', 'unnamed'] as const) {
    if (v[k] === undefined) continue;
    if (k === 'labels') out.labels = Object.fromEntries(Object.entries(v.labels!).sort(([a], [b]) => a.localeCompare(b)));
    else if (k === 'placement' || k === 'oursLeak' || k === 'unnamed') out[k] = [...v[k]!].sort();
    else (out as Record<string, unknown>)[k] = v[k];
  }
  return out;
}

/** The non-OK parts of a verdict, in the list's shape. */
function pick(v: ReturnType<typeof domJudge>): Verdict {
  const out: Verdict = {};
  if (v.identity) out.identity = true;
  if (Object.keys(v.labels).length) out.labels = Object.fromEntries(Object.entries(v.labels).sort(([a], [b]) => a.localeCompare(b)));
  if (v.placement.length) out.placement = v.placement;
  if (v.oursLeak.length) out.oursLeak = v.oursLeak;
  if (v.unnamed.length) out.unnamed = v.unnamed;
  return out;
}

/* ------------------------------------------------------------------------------ step-3 nits, always on */
describe('card step 4: RecordCard chrome (absorbed from step 3\'s refuter)', () => {
  const pageId = () => Object.keys(trees.feats).filter((s) => recs('feats')[s]).sort()[0];
  const noPageId = () => Object.keys(recs('feats')).filter((s) => !trees.feats[s]).sort()[0];

  it('Back shows at the FIRST level with backToSource and returns through onClose (onBackToSource), on the page and fallback branches', async () => {
    for (const id of [pageId(), noPageId()]) {
      const rec = recs('feats')[id];
      const onClose = vi.fn();
      const node: DescNode = { title: rec.name, description: rec.description ?? '', key: 'feats', slug: id };
      const m = await mount(<DescriptionModal root={node} onClose={onClose} backToSource />);
      const back = m.host.querySelector('.info-back');
      expect(back, `${id}: Back at the first level`).toBeTruthy();
      await click(back);
      expect(onClose, `${id}: Back returns to the source popup`).toHaveBeenCalledTimes(1);
      m.stop();
      const plain = await mount(<DescriptionModal root={node} onClose={noop} />);
      expect(plain.host.querySelector('.info-back'), `${id}: no Back without backToSource`).toBeNull();
      plain.stop();
    }
  });

  it('the TrustMarker of a record with no rules encoded sits in the browse card\'s header, not its body', async () => {
    const id = Object.keys(trees.feats).filter((s) => recs('feats')[s] && trustUnencoded('feats', s)).sort()[0];
    expect(id, 'an unencoded feat with a page ships').toBeTruthy();
    const m = await mount(<RecordCard record={{ bucket: 'feats', id }} mode="browse" chrome="popup" onExit={noop} />);
    expect(m.host.querySelector('.ast-head .ast-controls .sd-choice-note'), 'marker in the header controls').toBeTruthy();
    expect(m.host.querySelector('.ast-body .sd-choice-note'), 'and not in the body').toBeNull();
    m.stop();
  });

  it('headerActions keep one position on every branch: actions, Back, star, close', async () => {
    const pin: PinDescApi = { has: () => false, toggle: noop };
    const slot = <button className="slot-act">act</button>;
    const order = (host: Element) => {
      const els = ['.slot-act', '.info-back', '.info-star', '.picker-close'].map((s) => host.querySelector(s));
      for (const e of els) expect(e).toBeTruthy();
      for (let i = 0; i + 1 < els.length; i++) expect(els[i]!.compareDocumentPosition(els[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING, `${i}`).toBeTruthy();
      expect(els[0]!.nextElementSibling, 'headerActions sit straight before Back').toBe(els[1]);
    };
    const page = await mount(<RecordCard record={{ bucket: 'feats', id: pageId() }} mode="browse" chrome="popup" onExit={noop} headerActions={slot} onBackToSource={noop} />, db, pin);
    expect(page.host.querySelector('.ast-modal')).toBeTruthy();
    order(page.host);
    page.stop();
    const fb = await mount(<RecordCard record={{ title: 'Synthetic Page', text: 'Body words.' }} mode="browse" chrome="popup" onExit={noop} headerActions={slot} onBackToSource={noop} />, db, pin);
    expect(fb.host.querySelector('.picker.info-modal')).toBeTruthy();
    order(fb.host);
    fb.stop();
  });
});

describe('card step 4: suite time', () => {
  it('reports how long the rendered sample took', () => {
    console.log(`card-parity: rendered ${results.size} sampled popups in ${timing.render} ms; named cases in ${timing.known} ms`);
    expect(results.size).toBeGreaterThan(0);
  });
});
