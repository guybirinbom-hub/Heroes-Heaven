// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LABELLED_BUCKETS, allowReason, allowRowHolds, buildIndex, classify, createBucket, createdRefs, creationPlan, linkContext, namesBook, parentPageOf,
  recordKey,
} from '../scripts/lib/archive-coverage.mjs';
import { hostSearchRecords } from '../src/integration/hostSearchRecords';
import { findDuplicateIds } from '../src/data';
import { CHOOSABLE_SOURCE_MAPS } from '../src/rules/sources';
import { HOMEBREW_TYPES } from '../src/data/storage';
import type { ContentDatabase } from '../src/rules/types';
import { aonIndex, resolveStubs, stubBuckets, stubNameOf, stubRefs, type StubbedNode } from '../src/sheet/astStubs';
import type { AstNode } from '../src/sheet/astStore';
import { ContentContext } from '../src/sheet/ContentContext';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { PinContext } from '../src/sheet/PinContext';
import { renderDom } from './_render';

/**
 * EVERY ARCHIVES PAGE IS A RECORD THE GM CAN FIND (owner, 2026-09-24: "every record of PF2e needs to be
 * accessible to the GM in the tracker's search"). The real-data half is scripts/archive-coverage-check.mjs
 * in `npm run verify` over the 19,285 non-player pages of the export; this pins its rule on synthetic
 * pages, then the three surfaces the new records reach: the GM Search index, the description popup, and
 * — the one they must never reach — a picker.
 */
const ROOT = join(__dirname, '..');

type Page = {
  id: string; category: string; name: string; book: string; books?: string[]; text: string; level?: number; url?: string;
  edition?: string; exclude_from_search?: boolean; superseded_by?: string; data?: { legacy_id?: string[]; remaster_id?: string[] };
};
const P = (id: string, category: string, name: string, book: string, text: string, extra: Partial<Page> = {}): Page =>
  ({ id, category, name, book, books: [book], text, data: {}, ...extra });

const BOG = 'A creeping rot takes the flesh of anyone who wades the fens; the skin blackens and the victim sickens by the day.';
const PAGES: Page[] = [
  // a legacy page and its reprint; the reprint is the record
  P('rules-1', 'rules', 'Hero Points', 'Core Rulebook', 'Hero points old text', { superseded_by: 'rules-3' }),
  P('rules-3', 'rules', 'Hero Points', 'Player Core', 'Hero points new text'),
  // three different "Example" pages of ONE book; the record is the first of them
  P('rules-5', 'rules', 'Example', 'Secrets of Magic', 'A wizard prepares fireball and her friend watches the scroll burn.'),
  P('rules-6', 'rules', 'Example', 'Secrets of Magic', 'The summoner and eidolon share one pool of hit points in this sample fight.'),
  // a reprint the Archives never linked: the same words, another book
  P('disease-1', 'disease', 'Bog Rot', 'Gamemastery Guide', BOG),
  P('disease-26', 'disease', 'Bog Rot', 'GM Core', BOG),
  // one bonus of an item page whose reprint ships as a grade
  P('equipment-9-bonus-1', 'item-bonus', 'Horn', 'Core Rulebook', 'horn', { superseded_by: 'equipment-10' }),
  // no bucket anywhere
  P('article-1', 'article', 'Breachhill', 'Pathfinder #145: Hellknight Hill', 'Learn about Breachill'),
  P('creature-family-2', 'creature-family', 'Aeon', 'Bestiary', 'old aeons', { superseded_by: 'creature-family-9' }),
  P('creature-family-9', 'creature-family', 'Aeon', 'Monster Core', 'new aeons'),
  // reprinted into ANOTHER category: a legacy sidebar whose newer printing is a class page (a record), and
  // one whose newer printing is a rules page no record answers for yet
  P('sidebar-1075', 'sidebar', 'Key Terms', 'Core Rulebook', 'rage, instinct', { superseded_by: 'class-57' }),
  P('sidebar-6', 'sidebar', 'Character Sheet', 'Core Rulebook', 'write down your concept', { data: { remaster_id: ['rules-2028'] } }),
  P('rules-2028', 'rules', 'Step 1: Create a Concept', 'Player Core', 'a concept'),
  // pages never created
  P('action-800', 'action', 'Cast a Spell', 'Secrets of Magic', 'sub-action', { exclude_from_search: true }),
  P('action-3841', 'action', '', 'Treasure Vault', 'a fragment', { url: '/Actions.aspx?ID=3841' }),
  P('creature-5', 'creature', 'Goblin Warrior', 'Monster Core', 'a goblin'),
];
const CORE = {
  rules: {
    'hero-points': { id: 'hero-points', name: 'Hero Points', aonId: 'rules-3' },
    example: { id: 'example', name: 'Example', aonId: 'rules-5' },
  },
  classes: { barbarian: { id: 'barbarian', name: 'Barbarian', aonId: 'class-57' } },
  disease: { 'bog-rot': { id: 'bog-rot', name: 'Bog Rot', aonId: 'disease-26' } },
  items: { 'horn-greater': { id: 'horn-greater', name: 'Horn (Greater)', aonId: 'equipment-10-11', source: { book: 'Pathfinder GM Core' } } },
  // the GM Search never reads these three buckets, so a record there answers for nothing
  runes: { breachhill: { id: 'breachhill', name: 'Breachhill', aonId: 'article-1' } },
};
const pages = new Map(PAGES.map((p) => [p.id, p]));
const ctxOf = (core: object) => ({ index: buildIndex(core, {}, (id: string) => pages.get(id)), ...linkContext(pages), pages });
const ctx = ctxOf(CORE);
const of = (id: string) => classify(pages.get(id), ctx);

describe('archive coverage — when a non-player page counts as searchable', () => {
  it('by aonId, and by twin: a legacy page whose reprint is a record', () => {
    expect(of('rules-3')).toEqual({ status: 'aonId', via: 'rules/hero-points' });
    expect(of('rules-1')).toMatchObject({ status: 'twin', via: 'rules/hero-points (rules-3)' });
  });

  it('a record that is ANOTHER page of the same kind never answers by book — "Example" x3 in one book', () => {
    expect(of('rules-5').status).toBe('aonId');
    expect(of('rules-6').status).toBe('missing');
  });

  it('…but it does by text: a reprint the Archives never linked prints the same words', () => {
    expect(of('disease-1')).toMatchObject({ status: 'name', via: expect.stringMatching(/^disease\/bog-rot \(text/) });
  });

  it('an item-bonus page is its item: the reprint named by superseded_by, found through its grade', () => {
    expect(of('equipment-9-bonus-1')).toEqual({ status: 'item', via: 'items/horn-greater (a grade of equipment-10)' });
  });

  it('missing: a kind with no bucket, and a record in a bucket the Search skips', () => {
    expect(of('article-1').status).toBe('missing');
  });

  it('…and by its newer printing in ANOTHER category (the Archives link a "Key Terms" sidebar to its class)', () => {
    expect(of('sidebar-1075')).toEqual({ status: 'twin', via: 'classes/barbarian (class-57, its newer printing)' });
    expect(of('sidebar-6').status, 'a newer printing with no record answers for nothing').toBe('missing');
    // old -> new only: a record of the OLD printing never stands in for the reprint
    const oldOnly = { ...CORE, sidebar: { 'character-sheet': { id: 'character-sheet', name: 'Character Sheet', aonId: 'sidebar-6' } } };
    expect(classify(pages.get('rules-2028'), ctxOf(oldOnly)).status).toBe('missing');
  });

  it('remaster pairs are read per category: one category\'s reprint links vote nothing for another', () => {
    const many = new Map<string, Page>([
      ...['1', '2', '3'].flatMap((n): [string, Page][] => [
        [`creature-${n}`, P(`creature-${n}`, 'creature', `C${n}`, 'Core Rulebook', 'x', { superseded_by: `creature-${n}0` })],
        [`creature-${n}0`, P(`creature-${n}0`, 'creature', `C${n}`, 'Dark Archive', 'x')],
      ]),
    ]);
    const lc = linkContext(many);
    expect([...lc.pairsOf('creature')]).toContain('corerulebook>darkarchive');
    expect([...lc.pairsOf('sidebar')]).toEqual([]);
  });
});

describe('archive coverage — what the importer creates, and where', () => {
  const plan = creationPlan({ pages, core: CORE, allow: { 'rules-6': 'a deliberate gap for this test' } });
  const ids = plan.map((p: Page) => p.id);

  it('creates every missing page: newest printing only, never hidden, a stub, allow-listed or a bestiary kind', () => {
    // not sidebar-1075 (its class ships) and not sidebar-6 (its rules-page reprint is made instead)
    expect(ids).toEqual(['article-1', 'creature-family-9', 'rules-2028']);
  });

  it('the older printing of a created page is present afterwards, as its twin — in any category', () => {
    const after = {
      ...CORE,
      reference: { aeon: { id: 'aeon', name: 'Aeon', aonId: 'creature-family-9' } },
      rules: { ...CORE.rules, 'step-1-create-a-concept': { id: 'step-1-create-a-concept', name: 'Step 1: Create a Concept', aonId: 'rules-2028' } },
    };
    expect(classify(pages.get('creature-family-2'), ctxOf(after)).status).toBe('twin');
    expect(classify(pages.get('sidebar-6'), ctxOf(after))).toEqual({ status: 'twin', via: 'rules/step-1-create-a-concept (rules-2028, its newer printing)' });
  });

  it('a glossary kind keeps its bucket; a kind with none, or with a bucket a picker reads, goes to `reference`', () => {
    const core = { rules: {}, sidebar: {}, actions: {}, vehicles: {} };
    expect(createBucket('rules', core)).toBe('rules');
    expect(createBucket('sidebar', core)).toBe('sidebar');
    expect(createBucket('article', core)).toBe('reference');
    expect(createBucket('action', core)).toBe('reference');
    expect(createBucket('vehicle', core)).toBe('reference');
  });

  it('parentPage: the last breadcrumb, the class a sample is for, or the page a sidebar is printed on', () => {
    const nameAt = (url: string) => ({ '/Classes.aspx?ID=2': 'Barbarian', '/Articles.aspx?ID=1': 'Breachhill' } as Record<string, string>)[url] ?? '';
    const pg = (extra: object) => ({ name: 'Key Terms', url: '', crumb: '', sampleOf: '', ...extra });
    expect(parentPageOf(pg({ crumb: 'Crafting the Staff', url: '/Rules.aspx?ID=1505' }), nameAt)).toBe('Crafting the Staff');
    expect(parentPageOf(pg({ sampleOf: 'Fighter' }), nameAt)).toBe('Fighter');
    expect(parentPageOf(pg({ url: '/Classes.aspx?ID=2' }), nameAt)).toBe('Barbarian');
    // a page whose url is its own names only itself
    expect(parentPageOf(pg({ name: 'Breachhill', url: '/Articles.aspx?ID=1' }), nameAt)).toBeUndefined();
  });

  it('a row\'s book is the one its page names: spelt the app\'s way, never folded into another book or printing', () => {
    // the app's spelling of the same book and printing
    expect(namesBook('Pathfinder Player Core', 'Player Core')).toBe(true);
    expect(namesBook('Pathfinder Lost Omens Gods & Magic', 'Gods & Magic')).toBe(true);
    expect(namesBook('Pathfinder Dark Archive (Remastered)', 'Dark Archives (Remastered)')).toBe(true);
    expect(namesBook('Pathfinder #203: Shepherd of Decay', 'Pathfinder #203 Shepherd of Decay')).toBe(true);
    // scripts/data/book-names.json folds these into another book or printing (step 5 once shipped all four)
    expect(namesBook('Pathfinder Monster Core 2', 'Bestiary 3')).toBe(false);
    expect(namesBook('Pathfinder Treasure Vault (Remastered)', 'Treasure Vault')).toBe(false);
    expect(namesBook('Pathfinder Guns & Gears', 'Guns & Gears (Remastered)')).toBe(false);
    expect(namesBook('Pathfinder Adventure Path: Hellbreakers', 'Pathfinder #222: Hellbreakers')).toBe(false);
    // whole words: a later volume is another book
    expect(namesBook('Pathfinder Monster Core 2', 'Monster Core')).toBe(false);
    expect(namesBook('', 'Player Core')).toBe(false);
  });

  it('keys: the slug, then slug-book, then slug-doc id', () => {
    const page = P('sidebar-2145', 'sidebar', 'Key Terms', 'Player Core', '');
    expect(recordKey(page, () => false)).toBe('key-terms');
    expect(recordKey(page, (k: string) => k === 'key-terms')).toBe('key-terms-player-core');
    expect(recordKey(page, () => true)).toBe('key-terms-sidebar-2145');
  });

  it('an allow row that names a shape is held to it, word for word', () => {
    expect(allowRowHolds('hidden: AoN exclude_from_search — Cast a Spell', pages.get('action-800'))).toBe(true);
    expect(allowRowHolds('hidden: AoN exclude_from_search — x', pages.get('action-800'))).toBe(false);
    expect(allowRowHolds('hidden: AoN exclude_from_search — Breachhill', pages.get('article-1'))).toBe(false);
    expect(allowRowHolds('stub: an AoN page with no name — Treasure Vault, /Actions.aspx?ID=3841', pages.get('action-3841'))).toBe(true);
    // a hand-typed "where" the page does not bear out (sidebar-29 once named its REPRINT as its parent)
    expect(allowRowHolds('stub: an AoN page with no name — Treasure Vault, a fragment of another page', pages.get('action-3841'))).toBe(false);
    expect(allowRowHolds('stub: an AoN page with no name — Breachhill', pages.get('article-1'))).toBe(false);
    // a nameless hidden page names its book and address, never an empty "— "
    expect(allowReason({ ...pages.get('action-3841'), exclude_from_search: true }))
      .toBe('hidden: AoN exclude_from_search — no name, Treasure Vault, /Actions.aspx?ID=3841');
    expect(allowRowHolds('a deliberate gap, with its evidence', pages.get('article-1'))).toBe(true);
  });
});

/* The shipped artefact, as the GM's Search reads it (CampaignTracker -> hostSearchRecords), with the
 * duplicate scrapes hidden the way the loader hides them (src/data/index.ts). */
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8')) as ContentDatabase;
core.duplicateIds = findDuplicateIds(core);

describe('GM Search — the new records are found by name', () => {
  const rows = hostSearchRecords(core);
  const find = (name: string, bucket: string, book?: string) =>
    rows.filter((r) => r.name === name && r.bucket === bucket && (!book || (r.detail ?? '').includes(book)));

  it('a rules page another page of its name used to hide (Player Core "Attack" vs High Seas "Attack!")', () => {
    expect(find('Attack', 'rules', 'Player Core')).toHaveLength(1);
    expect(find('Hero Points', 'rules', 'GM Core')).toHaveLength(1);
  });

  it('an article, labelled as one', () => {
    const [row] = find('Breachhill, Outpost of Secrets', 'reference');
    expect(row?.detail).toBe('Article · Pathfinder #145: Hellknight Hill');
  });

  it('a sidebar — every class\'s "Key Terms", told apart by the class page it is printed on', () => {
    const pc = find('Key Terms', 'sidebar').map((r) => r.detail).filter((d) => d?.endsWith(' · Pathfinder Player Core'));
    expect(pc).toHaveLength(8);
    expect(new Set(pc).size, 'eight rows, eight different lines').toBe(8);
    expect(pc).toContain('Bard · Pathfinder Player Core');
  });

  it('…but not the Core Rulebook\'s: each was reprinted into its Player Core class page, which is the record', () => {
    expect(find('Key Terms', 'sidebar', 'Pathfinder Core Rulebook')).toEqual([]);
    expect(find('Barbarian', 'classes')).toHaveLength(1);
  });

  it('no two rows of the Search read the same — name, bucket and detail line', () => {
    const seen = new Map<string, string[]>();
    for (const r of rows) {
      const k = `${r.bucket} | ${r.name} | ${r.detail ?? ''}`;
      seen.set(k, [...(seen.get(k) ?? []), r.id]);
    }
    expect([...seen].filter(([, ids]) => ids.length > 1).map(([k, ids]) => `${k} x${ids.length}`)).toEqual([]);
  });

  it('…and none goes unlabelled beside a look-alike: its bucket holds the name twice, or a created record carries it', () => {
    const named = new Map<string, number>();
    for (const r of rows) named.set(`${r.bucket} | ${r.name.toLowerCase()}`, (named.get(`${r.bucket} | ${r.name.toLowerCase()}`) ?? 0) + 1);
    expect(rows.filter((r) => !r.detail && (named.get(`${r.bucket} | ${r.name.toLowerCase()}`) ?? 0) > 1).map((r) => `${r.bucket}/${r.id}`)).toEqual([]);
    const created = createdRefs(ROOT);
    const createdNames = new Set(rows.filter((r) => created.has(`${r.bucket}:${r.id}`)).map((r) => r.name.toLowerCase()));
    const buckets = new Set([...created].map((ref) => ref.split(':')[0]));
    expect(rows.filter((r) => !r.detail && buckets.has(r.bucket) && createdNames.has(r.name.toLowerCase())).map((r) => `${r.bucket}/${r.id}`)).toEqual([]);
    // "Hero Points" once led with a bare row (War of Immortals' alternate mythic rules) and ended with a bare sidebar
    const hero = rows.filter((r) => r.name === 'Hero Points');
    expect(hero.length).toBeGreaterThan(4);
    expect(hero.filter((r) => !r.detail).map((r) => `${r.bucket}/${r.id}`)).toEqual([]);
    expect(hero.find((r) => r.bucket === 'rules' && r.id === 'hero-points')?.detail).toBe('Mixed Play · Pathfinder War of Immortals Alternate Mythic Rules');
  });

  // owner ruling e (2026-09-25): every row of these buckets, not only a name another shares — "Scarlet
  // Fever · DISEASE" and "The First Rule · SIDEBAR" once named no book (2,519 bare rows)
  it('…and every row of reference, rules, sidebar, categoryPage and disease names its book', () => {
    const db = core as unknown as Record<string, Record<string, { source?: { book?: string } }>>;
    const labelled = rows.filter((r) => LABELLED_BUCKETS.has(r.bucket));
    expect(labelled.length).toBeGreaterThan(3700);
    expect(labelled.filter((r) => { const book = db[r.bucket][r.id]?.source?.book; return !book || !r.detail?.includes(book); })
      .map((r) => `${r.bucket}/${r.id}`)).toEqual([]);
    expect(find('Scarlet Fever', 'disease')[0]?.detail).toBe('Pathfinder GM Core');
    expect(find('The First Rule', 'sidebar')[0]?.detail).toBe('Chapter 1: Introduction · Pathfinder Player Core');
    expect(find('Remember the First Rule', 'sidebar')[0]?.detail).toBe('I’m Running a Published Adventure · Pathfinder GM Core');
    expect(find('Remember the First Rule', 'rules')[0]?.detail).toBe('Choosing Your Tools · Pathfinder Gamemastery Guide');
  });

  // scripts/data/book-names.json folds these into another book or printing; the rows name their page's own
  // (the whole list: scripts/archive-coverage-check.mjs BOOK findings, over the export)
  it('each names the book its page is printed in', () => {
    const detail = (bucket: string, id: string) => rows.find((r) => r.bucket === bucket && r.id === id)?.detail;
    expect(detail('reference', 'sphinx')).toBe('Creature family · Pathfinder Bestiary 3');
    expect(detail('rules', 'example')).toBe('Growing Items · Pathfinder Treasure Vault');
    expect(detail('rules', 'ability-modifiers')).toBe('Prototype Construct Companions · Pathfinder Guns & Gears (Remastered)');
    expect(detail('reference', 'armor-inventor-guns-gears-remastered')).toBe('Class sample · Inventor · Pathfinder Guns & Gears (Remastered)');
    expect(detail('reference', 'sarcovalt')).toBe('Creature family · Pathfinder #222: Hellbreakers');
  });

  it('what tells alike rows apart is added only where it does: printing, the traits not shared, the page', () => {
    const db = {
      reference: {
        a: { name: 'Armor Inventor', kind: 'class-sample', parentPage: 'Inventor', edition: 'legacy-era', source: { book: 'G&G' } },
        b: { name: 'Armor Inventor', kind: 'class-sample', parentPage: 'Inventor', edition: 'remaster-era', source: { book: 'G&G' } },
        c: { name: 'Lone', kind: 'article', edition: 'legacy', source: { book: 'G&G' } },
      },
      classFeatures: {
        m: { name: 'Weapon Expertise', level: 5, traits: ['magus'], edition: 'remaster', source: { book: 'IM' } },
        r: { name: 'Weapon Expertise', level: 5, traits: ['runesmith'], edition: 'remaster', source: { book: 'IM' } },
      },
      rules: {
        x: { name: 'Backgrounds', parentPage: 'Chapter 1', printedPage: 7, source: { book: 'APG' } },
        y: { name: 'Backgrounds', parentPage: 'Chapter 1', printedPage: 48, source: { book: 'APG' } },
      },
    } as unknown as ContentDatabase;
    const detail = Object.fromEntries(hostSearchRecords(db).map((r) => [r.id, r.detail]));
    expect(detail).toEqual({
      a: 'Class sample · Inventor · G&G · Legacy', b: 'Class sample · Inventor · G&G · Remastered', c: 'Article · G&G',
      m: 'Level 5 · IM · Magus', r: 'Level 5 · IM · Runesmith',
      x: 'Chapter 1 · APG · pg. 7', y: 'Chapter 1 · APG · pg. 48',
    });
  });
});

/*
 * A created page opens by key, never by title: public/ast-index.json (the title-only lookup) names none of
 * them. The first run had sent `ram` from the Battering Ram siege weapon, and four familiar abilities, to
 * creature-family pages, and given "Hyena" a creature-family page (scripts/archive-coverage-check.mjs
 * INDEX findings guard the whole list; these are the names that broke).
 */
describe('the title-only lookup never opens a created page', () => {
  const index = JSON.parse(readFileSync(join(ROOT, 'public/ast-index.json'), 'utf8')) as Record<string, string>;
  it('names no created record, and the words they took are back with their own records', () => {
    const created = createdRefs(ROOT);
    expect(Object.entries(index).filter(([s, b]) => created.has(`${b}:${s}`))).toEqual([]);
    expect(index.ram).toBe('siegeWeapons');
    for (const s of ['crawling-hand', 'elemental-scamp', 'elemental-wisp', 'spirit-guide']) expect(index[s], s).toBe('familiarAbilities');
    expect(index.hyena).toBeUndefined();
  });
});

// The popup on its own, under a stand-in pin target. The GM surface's OWN target (the GM screen) and the
// Archives link are exercised where the GM meets them: test/gm-search-popup.test.tsx.
describe('the description popup opens a reference record, star included', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders the page\'s own tree from public/ast/reference.json.gz and offers the favourite star', async () => {
    const tree = JSON.parse(gunzipSync(readFileSync(join(ROOT, 'public/ast/reference.json.gz'))).toString('utf8'));
    // The loader's raw-JSON fallback (astStore.ts) serves the same map the .gz holds.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/ast/reference.json')
      ? { ok: true, json: async () => tree }
      : { ok: false, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) })));
    const record = (core as unknown as Record<string, Record<string, { name: string }>>).reference['breachhill-outpost-of-secrets'];
    const toggle = vi.fn();
    const { host, click, stop } = renderDom(
      <ContentContext.Provider value={core}>
        <PinContext.Provider value={{ has: () => false, toggle }}>
          <DescriptionModal root={{ title: record.name, description: '', key: 'reference', slug: 'breachhill-outpost-of-secrets' }} onClose={() => undefined} />
        </PinContext.Provider>
      </ContentContext.Provider>,
    );
    try {
      for (let i = 0; i < 10 && !(host.textContent ?? '').includes('demographics'); i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      expect(host.querySelector('.ast-modal'), 'the design popup, not the plain-text fallback').toBeTruthy();
      expect(host.textContent).toContain('demographics of Breachill');
      const star = host.querySelector('.info-star');
      expect(star, 'every description popup keeps the favourite star').toBeTruthy();
      click(star);
      expect(toggle).toHaveBeenCalledWith(expect.objectContaining({ key: 'reference', slug: 'breachhill-outpost-of-secrets' }));
    } finally { stop(); }
  });
});

/*
 * THE BUCKET NO PICKER READS. Pickers read their buckets by NAME (content.feats, content.items, …) or
 * through a named list; a bucket nobody names is reached only by code that walks EVERY bucket. So the
 * guard is two facts about the source: nothing but the GM Search names `reference`, and every walk over
 * the whole database is one of the four listed below, none of which lists anything to a player.
 *
 * The fourth, src/sheet/astStubs.ts (card step 14b, aonIndex), was decided 2026-10-09 to be NOT a picker:
 * it never enumerates its index, it only answers the aon id an empty stub of the host page itself carries
 * (docs/card-design.md section 2 rule 6), so a reference page it draws is one the host page prints inline.
 * Measured on the shipped data: 5 of the 5,856 stubs reach a reference record, every one the host page's
 * own embed — the beetle companion's Advanced Maneuver "Hustle" (action-1040), Lady's Chalice's "Strike"
 * activation (action-1167), and three creature pages' creature-family stubs. Leaving the bucket out of the
 * stub walk would print the beetle's "Advanced Maneuver Hustle" with nothing under it (the GM's record of
 * that page is the only record of it). The second test below pins the "only by an embedded id" half; the
 * shipped census of those 5 lives in test/card-stubs.test.tsx.
 */
describe('no picker ever lists the reference bucket (source guard)', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
  const sources = [...files(join(ROOT, 'src')), ...files(join(ROOT, 'tracker/src'))];
  const rel = (p: string) => p.slice(ROOT.length + 1).replace(/\\/g, '/');

  it('only the GM Search names the bucket', () => {
    const naming = sources.filter((p) => /['"`]reference['"`]|\.reference\b/.test(readFileSync(p, 'utf8'))).map(rel);
    expect(naming).toEqual(['src/integration/hostSearchRecords.ts']);
  });

  it('every walk over the whole database is the Search, the edition filter, the loader or the stub resolver', () => {
    const WALK = /Object\.(?:keys|entries|values)\((?:content|db|core|cachedCore|coreRec)(?:\s+as\s+[^)]*)?\)|for \(const \w+ in (?:content|db|core|cachedCore|coreRec)\)/;
    const walking = sources.filter((p) => WALK.test(readFileSync(p, 'utf8'))).map(rel).sort();
    // src/sheet/astStubs.ts: aonIndex answers only the aon id a host page's own stub carries; it lists nothing.
    // batch card premise: action-1040 "moves at incredible speed"
    expect(walking).toEqual(['src/data/index.ts', 'src/integration/hostSearchRecords.ts', 'src/rules/build.ts', 'src/sheet/astStubs.ts']);
  });

  it('the stub resolver reaches a reference record only through an id the host page embeds, and draws that page', () => {
    // Synthesized: a reference record (the bucket no picker reads) and a player-bucket record, each with a page.
    const sdb = {
      reference: { 'zz-hustle': { id: 'zz-hustle', name: 'Zz Hustle', kind: 'action', aonId: 'action-990001' } },
      actions: { 'zz-stride': { id: 'zz-stride', name: 'Zz Stride', aonId: 'action-990002' } },
    };
    const T = (v: string): AstNode => ({ t: 'text', v });
    const pages: Record<string, AstNode> = {
      'reference:zz-hustle': { t: 'document', c: [{ t: 'title', level: 1, c: [T('Zz Hustle')] }, { t: 'p', c: [T('The zz beetle strides three times.')] }] },
      'actions:zz-stride': { t: 'document', c: [{ t: 'title', level: 1, c: [T('Zz Stride')] }, { t: 'p', c: [T('You move up to your Speed.')] }] },
    };
    const host = (ids: string[]): AstNode => ({
      t: 'document',
      c: [{ t: 'title', level: 1, c: [T('Zz Beetle')] }, { t: 'p', c: [T('Advanced Maneuver Zz Hustle')] }, ...ids.map((id) => ({ t: 'document', level: '2', id }) as AstNode)],
    });
    const index = aonIndex(sdb);
    const resolve = (tree: AstNode, treeOf: (b: string, s: string) => AstNode | undefined) =>
      resolveStubs(tree, 'animalCompanions:zz-beetle', (id) => index.get(id), treeOf, { nameOf: (id) => stubNameOf(id, index, sdb) });
    const kids = (t: AstNode) => (t.c ?? []) as StubbedNode[];
    const text = (n: AstNode): string => (n.t === 'text' ? String(n.v ?? '') : (n.c ?? []).map(text).join(' '));

    // Embedded: a stub whose only candidate is the reference record draws that record's page (the host prints it).
    const embedding = host(['action-990001']);
    expect(stubBuckets(embedding, index)).toEqual(['reference']);
    const drawn = kids(resolve(embedding, (b, s) => pages[`${b}:${s}`]))[2];
    expect(drawn.stubOf).toBe('reference:zz-hustle');
    expect(text(drawn)).toContain('The zz beetle strides three times.');
    // Its page not shipped: the record's name, linked (a reference record opens in the description popup).
    const named = kids(resolve(embedding, () => undefined))[2];
    expect([named.stubKind, named.stubName, named.stubLink]).toEqual(['name', 'Zz Hustle', 'reference:zz-hustle']);

    // Not embedded: a page whose stubs name other ids never reaches it through any output of the resolver.
    const other = host(['action-990002', 'zz-no-record-1']);
    expect(stubBuckets(other, index)).toEqual(['actions']);
    expect(stubRefs(other, index)).toEqual(['actions:zz-stride']);
    expect(JSON.stringify(resolve(other, (b, s) => pages[`${b}:${s}`]))).not.toContain('reference:');
    expect(stubNameOf('zz-no-record-1', index, sdb)).toBeUndefined();
  });

  it('the named bucket lists (sources card, homebrew) do not include it', () => {
    expect(CHOOSABLE_SOURCE_MAPS as readonly string[]).not.toContain('reference');
    expect(HOMEBREW_TYPES as string[]).not.toContain('reference');
  });
});
