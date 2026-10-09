// @vitest-environment jsdom
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { build, content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi, type PinNode } from '../src/sheet/PinContext';
import { getCachedAst, loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { META, isNotOwnPage, pageSliceOf, recordTree, textOf } from '../src/sheet/astVisibility';
import { RecordCard } from '../src/sheet/RecordCard';
import { DetailsTab } from '../src/sheet/DetailsTab';
import { FeatsTab, featEntries, rowPagePending } from '../src/sheet/FeatsTab';
import { featPageOf } from '../src/sheet/FeatDetail';
import { cardPreview, cardPreviewLane, type CardScope } from '../src/sheet/cardModel';
import { LEVEL_FOLDS, scopeOfCharacter } from '../src/sheet/cardScope';
import { sharedFeatureFallback } from '../src/rules/featureText';
import { CharacterSheet } from '../src/sheet/CharacterSheet';
import { applyPlayState, initialPlay, type PlayState, type PlayUpdater } from '../src/rules/play';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Card step 20 (docs/card-design.md section 9 row 20; section 3 "Class card (Details tab)"; section 4
 * "Row previews"; section 13 owner rulings Q1 = A, no "Full page" button):
 *  (a) the Details tab's Class term opens the class record's 'mine' card by its id, scoped to the
 *      character — a fighter 3 has no level-19 feature open; the later-level features sit, in the DOM,
 *      under ONE closed "At higher levels (k)" line; the star pins {key: 'classes', slug, title, mode: 'mine'};
 *  (b) a row's preview is the first line of its popup (cardModel.ts cardPreview), measured over the whole
 *      corpus of feats, class features, items and spells against the REAL popup's markup, and on the
 *      Feats tab row by row;
 *  (c) InfoTerm takes a record id (descSlug) — the companion pickers' side; CompanionsTab's own wiring
 *      waits for the companions lane (another chat owns that file).
 *
 * Over the shipped page trees (public/ast/*.json.gz) through a fetch stub. Characters are synthesized
 * through build() (name 't'); none is the owner's.
 *
 * MUTATION LINES (step-20 lane, each measured red, then the file restored byte-exact from a scratch copy):
 *  - DetailsTab.tsx `mine: { scope: scopeOfCharacter(character) }` → `mine: { scope: undefined }` (fold disabled)
 *    → the fighter 3 and pinned-class cases red (the fighter 19 case stays green).
 *  - FeatsTab.tsx rowPreview reads `{ text: e.description }` instead of the card's lane (the old source)
 *    → the three Feats-tab row cases red.
 *  - cardModel.ts cardPreview's fragment reunion dropped (`frags.length` → `frags.length < 0`) → the corpus
 *    case red (2 records).
 *  - FeatsTab.tsx rowPreview's `if (rowPagePending(page.bucket, page.id, loaded)) return '';` removed (the row
 *    reads the old import while its page loads) → the "while the page loads" case red.
 *  - (wording round 2, 2026-10-08) cardModel.ts treeFirst stops reading glyph rows through the renderer's own
 *    glyphLineLeaves (`n.t === 'row' && false`) — the preview diverging from the popup's joined "Activate
 *    (manipulate)" line → the corpus case red (1,600 records), then restored byte-exact (sha1 checked).
 */
const db: ContentDatabase = content();
const noop = () => undefined;
const trees: Record<string, Record<string, AstNode>> = {};
const astIndex = JSON.parse(readFileSync('public/ast-index.json', 'utf8')) as Record<string, string>;
function treeOf(b: string): Record<string, AstNode> | undefined {
  if (trees[b]) return trees[b];
  const p = `public/ast/${b}.json.gz`;
  if (!existsSync(p)) return undefined;
  trees[b] = JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'));
  return trees[b];
}

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement): Promise<{ host: HTMLElement; stop: () => void }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ContentContext.Provider value={db}>{el}</ContentContext.Provider>);
  });
  await settle();
  return { host, stop: () => { act(() => root.unmount()); host.remove(); } };
}
async function click(el: Element | null | undefined) {
  // batch card: #card-NOT-VACUOUS — the control a case clicks exists
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const txt = (el: Element | null | undefined) => norm(el?.textContent);
/** An element's words without the glyph spans (an action glyph draws a digit). */
const wordsOf = (el: Element, glyph: string) => {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll(glyph).forEach((g) => g.remove());
  return norm(c.textContent);
};

/**
 * The FIRST LINE of a 'mine' popup's body, read off its markup — the independent half of the preview
 * check: the first plain prose paragraph the card draws. Not it: a classed paragraph (a use line, a dimmed
 * line, an applying impulse entry, ours), a sidebar, a list, a closed fold, a table, the ours box; on the
 * no-page lane a paragraph led by a bold use / Source label. null = the popup is still loading.
 */
function popupFirstLine(root: ParentNode): string | null {
  const page = root.querySelector('.ast-modal.card-mine .ast-body');
  if (page) {
    for (const p of page.querySelectorAll('p')) {
      if (p.getAttribute('class')) continue;
      if (p.closest('aside, li, details, table, [data-ours]')) continue;
      const t = wordsOf(p, '.ast-ag');
      if (t) return t;
    }
    return '';
  }
  const body = root.querySelector('.picker.info-modal.card-mine .info-body');
  if (!body) return null;
  const desc = body.querySelector('.sd-desc');
  if (!desc) return '';
  if (desc.classList.contains('rich-html')) {
    const p = desc.querySelector('p');
    return p ? norm(p.textContent) : norm((desc.innerHTML.split(/<br\s*\/?>/i)[0] ?? '').replace(/<[^>]+>/g, ''));
  }
  for (const p of desc.querySelectorAll('p.rt-p')) {
    if (p.closest('li, table')) continue;
    const first = [...p.childNodes].find((n) => !(n.nodeType === 3 && !norm(n.textContent)));
    if (first && first.nodeType === 1 && (first as Element).tagName === 'STRONG' && META.test(norm(first.textContent))) continue;
    const t = wordsOf(p, '.pf2-action');
    if (t) return t;
  }
  return '';
}

/** The sheet as App.tsx wires it (card-pins' harness). `seen.play` is the live ledger. */
function sheet(base: Character, start: PlayState, seen: { play: PlayState; writes: number }) {
  function Harness() {
    const [play, setPlay] = useState(start);
    seen.play = play;
    const onPlay: PlayUpdater = (fn) => { seen.writes += 1; setPlay((p) => fn(p)); };
    return <CharacterSheet character={applyPlayState(base, play, db)} content={db} charKey="t" onPlay={onPlay} />;
  }
  return <Harness />;
}
const tab = (host: HTMLElement, label: string) => [...host.querySelectorAll('nav.tabs button.tab')].find((b) => txt(b) === label);
/** The Details tab's Class term (desktop layout: matchMedia is stubbed to "not a phone"). */
const classTerm = (host: HTMLElement, name: string) => [...host.querySelectorAll('.oval.info-term')].find((e) => txt(e) === name);

/** The level-titled sections of a class page the ledger folds above `level` (the expected fold count). */
const laterSections = (classId: string, level: number) => (LEVEL_FOLDS.pages[`classes:${classId}`] ?? []).filter((s) => s.level > level);

/** What a class card shows OPEN: its body without the closed fold. */
const openText = (pop: Element) => {
  const body = pop.querySelector('.ast-body')!.cloneNode(true) as Element;
  body.querySelectorAll('details.card-fold').forEach((d) => d.remove());
  return body;
};
const headings = (el: Element) => [...el.querySelectorAll('.ast-h2 .ast-hname, .ast-h3 .ast-hname')].map(txt);

// The fighter page's own words for the level-19 feature (class-35, Versatile Legend).
const VERSATILE = 'You are nigh-unmatched with any weapon';
const BRAVERY = 'Having faced countless foes and the chaos of battle';

/** While set, every page-bucket fetch waits on it (the slow-network case); the index never waits. */
let astGate: Promise<void> | null = null;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (/ast-index\.json$/.test(u)) return { ok: true, json: async () => astIndex };
    if (astGate && /ast\//.test(u)) await astGate;
    const m = /ast\/(\w+)\.json$/.exec(u);
    const t = m ? treeOf(m[1]) : undefined;
    return t ? { ok: true, json: async () => t } : { ok: false };
  });
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = noop;
  await loadAstIndex();
  const buckets = ['classes', 'feats', 'classFeatures', 'heritages', 'items', 'spells', 'actions'];
  for (const b of buckets) await loadBucketAst(b);
  // A record printed inside a bigger page reads that page's bucket (astVisibility pageSliceOf).
  const sliced = new Set<string>();
  for (const b of buckets) for (const id of Object.keys((db as unknown as Record<string, Record<string, unknown>>)[b] ?? {})) {
    const s = pageSliceOf(b, id);
    if (s) sliced.add(s.bucket);
  }
  for (const b of sliced) await loadBucketAst(b);
}, 300_000);
afterAll(() => { vi.unstubAllGlobals(); });

describe('card step 20 (a): the Details-tab class card is the class record\'s mine card', () => {
  // batch card: #card-Q1A — the later-level features fold under one closed line; what the character has stays open
  it('a fighter 3 has no level-19 feature open: Versatile Legend sits inside ONE closed "At higher levels" fold; Bravery is open', async () => {
    const ch = build('fighter', 3);
    const toggled: PinNode[] = [];
    const pin: PinDescApi = { has: () => false, toggle: (n) => { toggled.push(n); } };
    const m = await mount(<PinContext.Provider value={pin}><DetailsTab character={ch} content={db} /></PinContext.Provider>);
    try {
      await click(classTerm(m.host, 'Fighter'));
      const pop = m.host.querySelector('.ast-modal.card-mine');
      // batch card: #card-NOT-VACUOUS — the Class term opened the class's mine card; the ledger folds Versatile Legend at level 3
      expect(pop, 'the Class term opened the class record\'s mine card (its page lane)').toBeTruthy();
      const later = laterSections('fighter', 3);
      expect(later.map((s) => s.title)).toContain('Versatile Legend');
      // One fold line for the whole run of later-level features (owner ruling Q1 = A), closed.
      const folds = [...pop!.querySelectorAll('details.card-fold')];
      // batch card: #card-Q1A — one closed "At higher levels (k)" line for the whole run of later features
      expect(folds).toHaveLength(1);
      expect((folds[0] as HTMLDetailsElement).open, 'the fold starts closed').toBe(false);
      expect(txt(folds[0].querySelector('summary'))).toBe(`At higher levels (${later.length})`);
      // The level-19 feature is IN the DOM, inside the fold — never open, never deleted.
      // batch card premise: class-35 "You are nigh-unmatched with any weapon"
      expect(headings(folds[0])).toContain('Versatile Legend');
      expect(txt(folds[0])).toContain(VERSATILE);
      const open = openText(pop!);
      // batch card: #card-Q1A — no section above level 3 is open
      expect(headings(open)).not.toContain('Versatile Legend');
      expect(txt(open)).not.toContain(VERSATILE);
      for (const s of later) expect(headings(open), `${s.title} (level ${s.level}) is not open at level 3`).not.toContain(s.title);
      // What a fighter 3 has is open: the level-3 Bravery and the intro.
      // batch card premise: class-35 "Having faced countless foes and the chaos of battle"
      expect(headings(open)).toContain('Bravery');
      expect(txt(open)).toContain(BRAVERY);
      // No "Full page" button (section 13): with the fold nothing is unreachable.
      // batch card: #card-NO-FULL-PAGE — the card draws no Full page button
      expect(txt(pop)).not.toMatch(/Full page/i);
      expect([...pop!.querySelectorAll('button')].map(txt)).not.toContain('Full page');
      // The PinStar is built in and pins the class record by id, as the character's own card.
      await click(pop!.querySelector('.info-star'));
      // batch card: #card-PIN — the built-in star pins the class record by id, mode 'mine'
      expect(toggled).toHaveLength(1);
      expect({ key: toggled[0].key, slug: toggled[0].slug, title: toggled[0].title, mode: toggled[0].mode })
        .toEqual({ key: 'classes', slug: 'fighter', title: 'Fighter', mode: 'mine' });
    } finally {
      m.stop();
    }
  });

  // batch card: #card-Q1A — the fold follows the character's level
  it('a fighter 19 has Versatile Legend open — the fold follows the character\'s level, it is not a fixed cut', async () => {
    const ch = build('fighter', 19);
    const m = await mount(<DetailsTab character={ch} content={db} />);
    try {
      await click(classTerm(m.host, 'Fighter'));
      const pop = m.host.querySelector('.ast-modal.card-mine')!;
      // batch card: #card-Q1A — a fighter 19 has nothing left to fold
      expect(pop).toBeTruthy();
      expect(pop.querySelectorAll('details.card-fold')).toHaveLength(0);
      // batch card premise: class-35 "You are nigh-unmatched with any weapon"
      expect(headings(openText(pop))).toContain('Versatile Legend');
      expect(txt(openText(pop))).toContain(VERSATILE);
    } finally {
      m.stop();
    }
  });

  // batch card: #card-PIN — the class pin stores {classes, fighter, Fighter, mine} and reopens as the mine card with its fold
  it('pinned from the real sheet\'s Details tab, the class pin is {classes, fighter, Fighter, mine} and reopens as the mine card with the fold', async () => {
    const ch = build('fighter', 3);
    const seen = { play: initialPlay(ch, db), writes: 0 };
    const m = await mount(sheet(ch, seen.play, seen));
    try {
      await click(tab(m.host, 'Details'));
      await click(classTerm(m.host, 'Fighter'));
      const pop = m.host.querySelector('.ast-modal.card-mine');
      // batch card: #card-Q1A — the Details tab opens the mine card scoped to the fighter 3: one fold
      expect(pop, 'the Details tab Class term opened the mine card').toBeTruthy();
      expect(pop!.querySelectorAll('details.card-fold'), 'scoped to the fighter 3: one fold').toHaveLength(1);
      await click(pop!.querySelector('.info-star'));
      const stored = seen.play.pinnedDescs ?? [];
      // batch card: #card-PIN — the star stored {classes, fighter, Fighter, mine} and reads pinned
      expect(stored).toHaveLength(1);
      expect({ key: stored[0].key, slug: stored[0].slug, title: stored[0].title, mode: stored[0].mode })
        .toEqual({ key: 'classes', slug: 'fighter', title: 'Fighter', mode: 'mine' });
      expect(pop!.querySelector('.info-star')?.getAttribute('aria-pressed'), 'the star reads pinned').toBe('true');
      await click(pop!.querySelector('.picker-close'));
      await click(tab(m.host, 'Main'));
      const row = [...m.host.querySelectorAll('.pinned-desc')].find((r) => txt(r.querySelector('.pinned-desc-title')) === 'Fighter');
      // batch card: #card-NOT-VACUOUS — the Pinned list shows the class
      expect(row, 'the Pinned list shows the class').toBeTruthy();
      await click(row!.querySelector('.pinned-desc-open'));
      const again = m.host.querySelector('.ast-modal.card-mine');
      // batch card: #card-PIN — the reopened class pin is the mine card at the fighter 3's scope: one fold
      expect(again, 'the reopened class pin is the mine card').toBeTruthy();
      const folds = again!.querySelectorAll('details.card-fold');
      expect(folds).toHaveLength(1);
      // batch card premise: class-35 "You are nigh-unmatched with any weapon"
      expect(txt(folds[0])).toContain(VERSATILE);
      expect(txt(openText(again!))).not.toContain(VERSATILE);
    } finally {
      m.stop();
    }
  });
});

describe('card step 20 (b): a preview is the first line of its popup', () => {
  // batch card: #card-PREVIEW — every record's preview is the first line of its real mine popup
  it('for every feat, class feature, item and spell, cardPreview equals the first line of the record\'s real mine popup', async () => {
    const tpl = document.createElement('template');
    /* A record whose tree is cached renders its settled popup in one synchronous pass (useAstNode seeds from
       the cache), so its markup is taken with renderToStaticMarkup. A record with NO tree first renders the
       loading placeholder and settles on the no-page lane only after useAstNode's effect — so it is mounted
       for real and read once settled. */
    const firstOf = async (b: string, id: string, hasTree: boolean, scope?: CardScope) => {
      const card = <RecordCard record={{ bucket: b, id }} mode="mine" chrome="popup" scope={scope} printed={[]} onExit={noop} />;
      if (!hasTree) {
        const m = await mount(card);
        try { return popupFirstLine(m.host); } finally { m.stop(); }
      }
      tpl.innerHTML = renderToStaticMarkup(<ContentContext.Provider value={db}>{card}</ContentContext.Provider>);
      return popupFirstLine(tpl.content);
    };
    const bad: string[] = [];
    const counts: Record<string, { n: number; tree: number; text: number; nonEmpty: number; shared: number }> = {};
    for (const b of ['feats', 'classFeatures', 'items', 'spells']) {
      const c = (counts[b] = { n: 0, tree: 0, text: 0, nonEmpty: 0, shared: 0 });
      for (const [id, rec] of Object.entries((db as unknown as Record<string, Record<string, { description?: string }>>)[b])) {
        const tree = recordTree(b, id, getCachedAst);
        const lane = cardPreviewLane({ bucket: b, id, text: rec.description ?? '', tree, content: db });
        const want = cardPreview(lane);
        const got = await firstOf(b, id, !!tree);
        c.n++;
        if ('tree' in lane) c.tree++; else c.text++;
        if (want) c.nonEmpty++;
        if (got !== want) bad.push(`${b}:${id}\n  popup:   ${got}\n  preview: ${want}`);
        // A class feature the viewer's class shares (card step 12): the popup draws the viewer's class
        // paragraph of our older text — the preview must follow it (section 5 row "Row previews").
        if (b !== 'classFeatures') continue;
        for (const classId of Object.keys(db.classes)) {
          if (sharedFeatureFallback(id, classId, tree ? textOf(tree) : undefined, db) === null) continue;
          const scope: CardScope = { level: 20, classId };
          const sharedWant = cardPreview(cardPreviewLane({ bucket: b, id, text: rec.description ?? '', tree, scope, content: db }));
          const sharedGot = await firstOf(b, id, !!tree, scope);
          c.shared++;
          if (sharedGot !== sharedWant) bad.push(`${b}:${id} as ${classId}\n  popup:   ${sharedGot}\n  preview: ${sharedWant}`);
        }
      }
    }
    console.info('card step 20 preview corpus', JSON.stringify(counts));
    // batch card: #card-PREVIEW — no record's preview differs from its popup's first line
    expect(bad.slice(0, 15), `${bad.length} records whose preview is not their popup's first line`).toEqual([]);
    // The measure is not vacuous: every bucket compared, both lanes met, the shared features met.
    // batch card: #card-NOT-VACUOUS — every bucket compared at corpus size
    expect(counts.feats.n).toBeGreaterThan(6000);
    expect(counts.items.n).toBeGreaterThan(7000);
    expect(counts.spells.n).toBeGreaterThan(1900);
    expect(counts.classFeatures.n).toBeGreaterThan(1000);
    // batch card: #card-NOT-VACUOUS — the page lane met in every bucket; the no-page lane and the shared features met
    for (const b of Object.keys(counts)) expect(counts[b].tree, `${b}: page lane`).toBeGreaterThan(0);
    expect(counts.classFeatures.text + counts.items.text, 'no-page lane').toBeGreaterThan(0);
    expect(counts.classFeatures.shared, 'shared class features').toBeGreaterThan(0);
  }, 600_000);

  /** The first class (sorted) built at 20 that has a row matching `pick`, and that row's page. */
  function findRow(pick: (e: ReturnType<typeof featEntries>[number], ch: Character) => boolean): { ch: Character; name: string } {
    for (const classId of Object.keys(db.classes).sort()) {
      const ch = build(classId, 20);
      const e = featEntries(ch, db).find((x) => pick(x, ch));
      if (e) return { ch, name: e.name };
    }
    throw new Error('no class has such a row');
  }
  const sharedRow = (e: ReturnType<typeof featEntries>[number], ch: Character) => {
    const p = featPageOf(e);
    const tree = recordTree(p.bucket, p.id, getCachedAst);
    return e.isFeature && p.bucket === 'classFeatures' && sharedFeatureFallback(p.id, ch.classId, tree ? textOf(tree) : undefined, db) !== null;
  };
  const noPageRow = (e: ReturnType<typeof featEntries>[number], ch: Character) => {
    const p = featPageOf(e);
    return !recordTree(p.bucket, p.id, getCachedAst) && !sharedRow(e, ch) && !!cardPreview({ text: e.description });
  };

  /** Every row of the Feats tab: its preview, and the first line of the popup the row opens. */
  async function rowsAgainstPopups(ch: Character): Promise<{ name: string; preview: string; popup: string | null }[]> {
    const m = await mount(<FeatsTab character={ch} content={db} />);
    const out: { name: string; preview: string; popup: string | null }[] = [];
    try {
      const names = [...m.host.querySelectorAll('.ff-row .ff-name')].map(txt);
      for (const name of names) {
        const row = [...m.host.querySelectorAll('.ff-row')].find((r) => txt(r.querySelector('.ff-name')) === name)!;
        const preview = txt(row.querySelector('.ff-preview'));
        await click(row);
        out.push({ name, preview, popup: popupFirstLine(m.host) });
        await click(m.host.querySelector('.picker-overlay .picker-close'));
      }
    } finally {
      m.stop();
    }
    return out;
  }

  // batch card: #card-PREVIEW — every Feats-tab row's preview is the first line of the popup it opens
  it('on the Feats tab, every row\'s preview is the first line of the popup it opens — including a shared class feature', async () => {
    const { ch, name } = findRow(sharedRow);
    const rows = await rowsAgainstPopups(ch);
    // batch card: #card-NOT-VACUOUS — the tab lists more than 20 rows, the shared-feature row among them, with a preview
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.map((r) => r.name)).toContain(name);
    const shared = rows.find((r) => r.name === name)!;
    expect(shared.preview, `${name}: a shared feature row has a preview`).not.toBe('');
    // batch card: #card-PREVIEW — no row's preview differs from its popup's first line
    expect(rows.filter((r) => r.preview !== r.popup)).toEqual([]);
  }, 300_000);

  // batch card: #card-PREVIEW — a row with no page previews its text's first prose line, as its popup draws it
  it('a row with no page of its own previews its text\'s first prose line, as its popup draws it', async () => {
    const { ch, name } = findRow(noPageRow);
    const rows = await rowsAgainstPopups(ch);
    const row = rows.find((r) => r.name === name)!;
    // batch card: #card-PREVIEW — the no-page row has a preview, and every row's preview is its popup's first line
    expect(row.preview).not.toBe('');
    expect(rows.filter((r) => r.preview !== r.popup)).toEqual([]);
  }, 300_000);

  // batch card: #card-PREVIEW — a pick, a marker or a note is a tag beside the preview
  it('a pick, a marker or a note is a marked tag beside the preview, never inside the sentence', async () => {
    const base = build('fighter', 3);
    const ch = {
      ...base,
      feats: [...base.feats, { featId: 'caustic-nectar', level: db.feats['caustic-nectar']?.level ?? 1, category: (db.feats['caustic-nectar']?.category ?? 'general') as never }],
      effectPicks: [{ recordId: 'caustic-nectar', choiceId: 'synthesized', label: 'Acid', note: 'synthesized step-20 note' }],
    } as Character;
    const m = await mount(<FeatsTab character={ch} content={db} />);
    try {
      const row = [...m.host.querySelectorAll('.ff-row')].find((r) => /Caustic Nectar/.test(txt(r.querySelector('.ff-name'))))!;
      // batch card: #card-NOT-VACUOUS — the tab lists the Caustic Nectar row
      expect(row).toBeTruthy();
      const tag = row.querySelector('.ff-desc .ff-ours-tag[data-ours]');
      // batch card: #card-N2 — the pick and the note are a tag marked ours
      expect(txt(tag)).toContain('Your choice: Acid — synthesized step-20 note');
      expect(txt(tag)).toContain(`Note: ${db.feats['caustic-nectar'].note}`);
      const preview = txt(row.querySelector('.ff-preview'));
      // batch card: #card-PREVIEW — the preview carries none of the tag's words and is the popup's first line
      expect(preview).not.toContain('Your choice');
      expect(preview).not.toContain('synthesized step-20 note');
      await click(row);
      expect(popupFirstLine(m.host)).toBe(preview);
    } finally {
      m.stop();
    }
  });
});

describe('card step 20 (c): a term opens its record by id', () => {
  // batch card: #card-IDENTITY — a term opens its record by id, not by its display name
  it('InfoTerm with descSlug opens that record\'s page, not the page its display name slugs to', async () => {
    // Two class features share the name "Weapon Expertise"; the magus record has its own slice.
    const magus = 'weapon-expertise-magus';
    // batch card: #card-NOT-VACUOUS — the magus record carries the shared name
    expect(db.classFeatures[magus]?.name).toBe('Weapon Expertise');
    const { InfoTerm } = await import('../src/sheet/InfoTerm');
    const byId = await mount(<InfoTerm title="Weapon Expertise" description={db.classFeatures[magus].description} descKey="classFeatures" descSlug={magus}>term</InfoTerm>);
    const byName = await mount(<InfoTerm title="Weapon Expertise" description={db.classFeatures[magus].description} descKey="classFeatures">term</InfoTerm>);
    const truth = await mount(<RecordCard record={{ bucket: 'classFeatures', id: magus }} mode="browse" chrome="popup" onExit={noop} />);
    try {
      await click(byId.host.querySelector('.info-term'));
      await click(byName.host.querySelector('.info-term'));
      // batch card: #card-IDENTITY — by id the magus record's own page; by name another page
      expect(recordTree('classFeatures', magus, getCachedAst), 'the magus record has a tree').toBeTruthy();
      const own = txt(truth.host.querySelector('.ast-modal .ast-body'));
      expect(own).not.toBe('');
      expect(txt(byId.host.querySelector('.ast-modal .ast-body')), 'by id: the magus record\'s own page').toBe(own);
      expect(txt(byName.host.querySelector('.ast-modal .ast-body, .info-body')), 'by name: another page (the name lookup)').not.toBe(own);
    } finally {
      byId.stop();
      byName.stop();
      truth.stop();
    }
  });
});

/*
 * LAST in the file on purpose: it resets the module registry to get an astStore with NO bucket cached (the
 * cache is module state, and beforeAll filled it), so any later dynamic import would get fresh modules.
 */
describe('card step 20 (b): a preview while the page loads', () => {
  // batch card: #card-LOADING — a row previews nothing while its page loads, never the old imported text
  it('a row whose record has a page previews NOTHING until its bucket arrives — never the old imported text — then its popup\'s first line', async () => {
    let open!: () => void;
    astGate = new Promise<void>((r) => { open = r; });
    vi.resetModules();
    const React = await import('react');
    const { createRoot: freshRoot } = await import('react-dom/client');
    const { ContentContext: Ctx } = await import('../src/sheet/ContentContext');
    const fresh = await import('../src/sheet/FeatsTab');
    const store = await import('../src/sheet/astStore');
    const detail = await import('../src/sheet/FeatDetail');
    const vis = await import('../src/sheet/astVisibility');
    const freshSettle = async () => {
      for (let i = 0; i < 4; i++) await React.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    };
    const ch = build('fighter', 3);
    const entries = fresh.featEntries(ch, db);
    const hasPage = (e: (typeof entries)[number]) => {
      const p = detail.featPageOf(e);
      return !!vis.pageSliceOf(p.bucket, p.id) || (!vis.isNotOwnPage(p.bucket, p.id) && !!treeOf(p.bucket)?.[p.id]);
    };
    // batch card: #card-NOT-VACUOUS — a fresh store: no page bucket is cached, so the loading state is reached
    expect(['feats', 'classFeatures', 'heritages'].filter((b) => store.isBucketLoaded(b)), 'a fresh store: no page bucket cached').toEqual([]);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = freshRoot(host);
    const rowsNow = () => [...host.querySelectorAll('.ff-row')].map((r) => ({ name: txt(r.querySelector('.ff-name')), preview: txt(r.querySelector('.ff-preview')) }));
    try {
      await React.act(async () => { root.render(<Ctx.Provider value={db}><fresh.FeatsTab character={ch} content={db} /></Ctx.Provider>); });
      await freshSettle();
      // Gate shut: the page buckets are on their way.
      const paged = entries.filter(hasPage);
      // batch card: #card-NOT-VACUOUS — the fighter 3 has rows with a page, and every row is drawn
      expect(paged.length, 'fighter 3 rows whose record has a page').toBeGreaterThanOrEqual(4);
      const before = rowsNow();
      expect(before.length).toBe(entries.length);
      for (const e of paged) {
        const row = before.find((r) => r.name === norm(e.name));
        // batch card: #card-LOADING — a row whose page is on its way previews no words
        expect(row, `${e.name}: a row`).toBeTruthy();
        expect(row!.preview, `${e.name}: no words before its page arrives`).toBe('');
      }
      // The popup opened now is the loading placeholder: it has no first line either.
      const first = [...host.querySelectorAll('.ff-row')].find((r) => txt(r.querySelector('.ff-name')) === norm(paged[0].name));
      await React.act(async () => { (first as HTMLElement).click(); });
      // batch card: #card-LOADING — the popup opened now is the loading placeholder, with no first line
      expect(host.querySelector('.ast-modal.card-mine .ast-body.ast-loading'), 'the popup is still loading').toBeTruthy();
      expect(popupFirstLine(host)).toBe('');
      await React.act(async () => { (host.querySelector('.picker-overlay') as HTMLElement).click(); });
      // Gate open: the buckets land, each row reads its page.
      open();
      await freshSettle();
      // batch card: #card-NOT-VACUOUS — the row buckets arrived
      expect(['feats', 'classFeatures'].every((b) => store.isBucketLoaded(b)), 'the row buckets arrived').toBe(true);
      const after = rowsNow();
      const scope = scopeOfCharacter(ch);
      // Rows can share a name (Shield Block the feat and the class feature): compare per name, as sets.
      for (const name of new Set(paged.map((e) => norm(e.name)))) {
        const shown = after.filter((r) => r.name === name).map((r) => r.preview).sort();
        const want = entries.filter((e) => norm(e.name) === name).map((e) => norm(fresh.rowPreview(e, scope, db))).sort();
        // batch card: #card-PREVIEW — once its page is in, each row reads its page's first line
        expect(shown, `${name}: its page's first line`).toEqual(want);
        const pagedPreviews = paged.filter((e) => norm(e.name) === name).map((e) => fresh.rowPreview(e, scope, db));
        expect(pagedPreviews.every(Boolean), `${name}: words once its page is in`).toBe(true);
      }
    } finally {
      astGate = null;
      open();
      await React.act(async () => { root.unmount(); });
      host.remove();
    }
  }, 300_000);

  // batch card: #card-LOADING — rowPagePending waits exactly where the card shows its loading placeholder
  it('rowPagePending mirrors useAstNode\'s seed: a slice waits for its page\'s bucket, a not-own-page record never waits', () => {
    const none = () => false;
    const all = () => true;
    let slices = 0;
    let notOwn = 0;
    for (const e of featEntries(build('fighter', 3), db)) {
      const p = featPageOf(e);
      // batch card: #card-LOADING — nothing waits once every bucket is in; with none in, a page record waits
      expect(rowPagePending(p.bucket, p.id, all), `${e.name}: nothing pending once every bucket is in`).toBe(false);
      const s = pageSliceOf(p.bucket, p.id);
      expect(rowPagePending(p.bucket, p.id, none)).toBe(!!s || !isNotOwnPage(p.bucket, p.id));
    }
    // Over the whole feats + class-features corpus: the slice and not-own-page arms are both reached.
    for (const b of ['feats', 'classFeatures', 'heritages'] as const) for (const id of Object.keys((db as unknown as Record<string, Record<string, unknown>>)[b] ?? {})) {
      const s = pageSliceOf(b, id);
      if (s) {
        slices++;
        // batch card: #card-LOADING — a slice waits for its page's bucket only; a not-own-page record never waits
        expect(rowPagePending(b, id, (x) => x !== s.bucket), `${b}:${id} waits for its page's bucket ${s.bucket}`).toBe(true);
        expect(rowPagePending(b, id, (x) => x === s.bucket)).toBe(false);
      } else if (isNotOwnPage(b, id)) {
        notOwn++;
        expect(rowPagePending(b, id, none), `${b}:${id} reads its own text at once`).toBe(false);
      }
    }
    // batch card: #card-NOT-VACUOUS — both arms are reached over the corpus
    expect(slices).toBeGreaterThan(0);
    expect(notOwn).toBeGreaterThan(0);
  });
});

/*
 * Polish round (docs/card-design.md:97 "advancement table whole, current row highlighted"; :121 highlights
 * "never change a word": "the class table's current row"): on the Details-tab class card (mine), the class
 * advancement table's row for the character's level carries the `card-row-current` class — a class on the
 * page's own row (cardScope.ts withLevelRow → AstRenderer TableEl), every cell, colspan and rowspan as
 * printed. A browse card highlights nothing.
 *
 * MUTATION LINES (polish lane, each measured red, then the file restored byte-exact from a scratch copy,
 * sha1 checked):
 *  - cardScope.ts withLevelRow `String(scope.level)` → `String(scope.level + 1)` → the fighter 3 and wizard 5
 *    cases red (the level-4 / level-6 row is marked instead).
 *  - RecordCard.tsx's browse page branch draws `withLevelRow(browseTree ?? astNode, {level: 3, classId:
 *    'fighter'}, 'classes:fighter')` (the highlight on browse) → the browse case red.
 */
describe('polish round: the class card marks the character\'s level in the advancement table', () => {
  /** Each table the popup draws: its rows as [the first cell's words, highlighted?, cell count, spans]. */
  const tablesOf = (pop: Element) => [...pop.querySelectorAll('table.ast-table')].map((t) => [...t.querySelectorAll('tr')].map((tr) => ({
    first: txt(tr.querySelector('td, th')),
    current: tr.classList.contains('card-row-current'),
    cells: tr.querySelectorAll('td, th').length,
    spans: [...tr.querySelectorAll('td, th')].map((c) => `${(c as HTMLTableCellElement).colSpan}x${(c as HTMLTableCellElement).rowSpan}`).join(','),
    words: [...tr.querySelectorAll('td, th')].map(txt).join(' | '),
  })));
  /** The browse card's tables for a class page: the printed page's rows, the words a mine card must keep. */
  async function browseTables(classId: string) {
    const m = await mount(<RecordCard record={{ bucket: 'classes', id: classId }} mode="browse" chrome="popup" onExit={noop} />);
    try {
      const pop = m.host.querySelector('.ast-modal');
      // batch card: #card-NOT-VACUOUS — the browse card drew the page the tables are read from
      expect(pop, `${classId}: the browse card drew the page`).toBeTruthy();
      return tablesOf(pop!);
    } finally { m.stop(); }
  }
  async function detailsCard(classId: string, level: number, name: string) {
    const m = await mount(<DetailsTab character={build(classId, level)} content={db} />);
    await click(classTerm(m.host, name));
    const pop = m.host.querySelector('.ast-modal.card-mine');
    // batch card: #card-NOT-VACUOUS — the Class term opened the class record's mine card
    expect(pop, `${name} ${level}: the Class term opened the class record's mine card`).toBeTruthy();
    return { m, tables: tablesOf(pop!) };
  }
  const strip = (t: ReturnType<typeof tablesOf>) => t.map((rows) => rows.map(({ current: _c, ...r }) => r));

  // batch card: #card-LEVEL-ROW — the fighter 3's level-3 row is marked, every word and span as printed
  it('a fighter 3: the advancement table\'s level-3 row is highlighted, no other row; every word and span is the printed table\'s', async () => {
    const { m, tables } = await detailsCard('fighter', 3, 'Fighter');
    try {
      // batch card: #card-NOT-VACUOUS — the fighter page's one table is the table the case reads
      expect(tables, 'the fighter page prints one table').toHaveLength(1);
      // batch card premise: class-35 "Your Level"
      expect(tables[0][0].first).toBe('Your Level');
      expect(tables[0][0].words).toBe('Your Level | Class Features');
      const marked = tables.flat().filter((r) => r.current);
      // batch card: #card-LEVEL-ROW — exactly the level-3 row is marked; the table is the browse card's, row for row
      expect(marked.map((r) => r.first), 'exactly the level-3 row').toEqual(['3']);
      expect(marked[0].words).toMatch(/^3 \| Bravery/);
      // Not a word, a cell or a span changed: the table is the browse card's, row for row.
      expect(strip(tables)).toEqual(strip(await browseTables('fighter')));
    } finally { m.stop(); }
  });

  // batch card: #card-LEVEL-ROW — only the advancement table marks the wizard's level row
  it('a wizard 5: only the advancement table marks the level-5 row; the spells-per-day table keeps its footnote colspan and marks nothing', async () => {
    const { m, tables } = await detailsCard('wizard', 5, 'Wizard');
    try {
      // batch card: #card-NOT-VACUOUS — the wizard page draws both its tables
      expect(tables, 'the wizard page prints the advancement and the spells-per-day tables').toHaveLength(2);
      // batch card: #card-LEVEL-ROW — the level-5 row is marked; the spells-per-day table marks none and keeps its span
      expect(tables[0].filter((r) => r.current).map((r) => r.first)).toEqual(['5']);
      expect(tables[1][0].first).toBe('Your Level');
      expect(tables[1].filter((r) => r.current), 'the spells-per-day table is not the class advancement table').toEqual([]);
      const foot = tables[1][tables[1].length - 1];
      expect(foot.spans, 'the footnote row still spans the whole table').toBe('12x1');
      expect(strip(tables)).toEqual(strip(await browseTables('wizard')));
    } finally { m.stop(); }
  });

  // batch card: #card-LEVEL-ROW — a browse card, an unscoped card and another class's scope mark no row
  it('a browse card highlights nothing; nor does a mine card with no scope, or one scoped to another class', async () => {
    for (const classId of ['fighter', 'wizard']) {
      const browse = await browseTables(classId);
      // batch card: #card-LEVEL-ROW — the browse card marks no row
      expect(browse.flat().filter((r) => r.current), `${classId}: the browse card marks no row`).toEqual([]);
    }
    const draw = async (classId: string, scope?: CardScope) => {
      const m = await mount(<RecordCard record={{ bucket: 'classes', id: classId }} mode="mine" chrome="popup" scope={scope} printed={[]} onExit={noop} />);
      try { return tablesOf(m.host.querySelector('.ast-modal.card-mine')!).flat().filter((r) => r.current).map((r) => r.first); } finally { m.stop(); }
    };
    // batch card: #card-LEVEL-ROW — no scope or another class's scope: no row; the fighter's own scope: the level-3 row
    expect(await draw('fighter'), 'no scope: no row').toEqual([]);
    expect(await draw('wizard', scopeOfCharacter(build('fighter', 3))), 'a fighter\'s scope on the wizard page: no row').toEqual([]);
    expect(await draw('fighter', scopeOfCharacter(build('fighter', 3))), 'the same card at the fighter\'s scope: the level-3 row').toEqual(['3']);
  });
});
