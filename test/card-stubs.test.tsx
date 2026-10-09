// @vitest-environment jsdom
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { build, content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { RecordCard } from '../src/sheet/RecordCard';
import { FeatsTab } from '../src/sheet/FeatsTab';
import {
  STUB_HOST_BUCKETS, STUB_NAMES, aonIndex, browseResolvesStubs, isArchetypePage, isListStubId, mineResolvesStubs, resolveStubs, stubIds, stubNameOf,
  type StubbedNode,
} from '../src/sheet/astStubs';
import { recordTree } from '../src/sheet/astVisibility';
import { LEVEL_FOLDS } from '../src/sheet/cardScope';
import { computeStubNames, stubNamesProblems, DEFAULT_MIRROR } from '../scripts/lib/stub-names.mjs';
import type { ContentDatabase } from '../src/rules/types';

/**
 * Card step 14b (docs/card-design.md section 2 rule 6, section 9 row 14b): EMBEDDED PAGE STUBS ON EVERY
 * OTHER BUCKET. Step 14 drew a page's stubs on item pages only (src/sheet/astStubs.ts STUB_HOST_BUCKETS =
 * {'items'}); this step widens that set to every bucket whose shipped pages carry a stub, on the browse
 * card AND the 'mine' popup cards (StatDetail's full text, FeatDetail, the action popup, the builder's
 * granted rows, a pinned card — mineResolvesStubs: every listed bucket but items, so the Strike card,
 * the one 'mine' popup of an item page, never draws a stub, and spells, whose stubs draw on browse only).
 *
 * What this file proves (fixtures are shipped records plus synthesized trees; nothing is the owner's):
 *  1. Every host bucket is behind its own case (STUB_BUCKET_CASES, equal to STUB_HOST_BUCKETS), and every
 *     shipped bucket with a resolvable stub is listed — a bucket widened without its test, or a new
 *     bucket's stubs, turn this red. Each case's page draws its first stub on the browse card, and (all
 *     but items and spells, MINE_NO_STUBS) on the 'mine' card; those two mine cards draw no stub.
 *  2. Rage's class feature shows the Rage action ONCE (the page's stub and nothing else) on the Feats-tab
 *     card and on browse, with the action's own trait chips drawn inside it.
 *  3. An archetype page lists its feat stubs as a COMPACT linked list: one list, a name link (opening the
 *     feat's card) and its badge per feat, no feat body. Counted over every shipped archetype page.
 *  4. A stub whose aon id names no record draws its page's name — a link when a record exists for it,
 *     plain text when none does (src/data/stub-names.json, two-way checked here; recomputed with the mirror).
 *  5. A self-embedding chain (A embeds B embeds A, A embeds A) does not loop: one level deep, a visited set;
 *     and on every shipped page no stub draws its own host or a second level.
 *  6. A 'mine' card's folds apply to the HOST page; an embedded page is drawn as it ships, never scoped.
 *  7. Nothing else moves: for a seeded sample of pages with stubs in every host bucket, the browse and the
 *     'mine' card with the step-14b stubs taken out are byte-equal to the same card with step 14b off; a
 *     spell page's mine card is byte-equal whole (its stubs draw on browse only).
 *  8. An embedded page is drawn AS PRINTED on a mine card (orchestrator ruling, round 3): its spoiler
 *     banner and its "click here" line stay, and its markup is the browse card's, byte for byte.
 *  9. The 5 shipped stubs that draw a page of the `reference` bucket (archive coverage; read by no picker)
 *     are the host pages' own embeds, and the beetle's Advanced Maneuver draws on both its cards.
 *
 * MUTATION LINES (each measured red on 2026-10-08, then restored byte-exact — sha1 checked):
 *  - astStubs.ts STUB_HOST_BUCKETS: 'trait' added (a bucket widened without its case) → block 1 red.
 *  - astStubs.ts resolveStubs: `if (visited.has(ref)) return n;` → `if (false) return n;` → block 5 red
 *    (the host draws itself inside itself).
 *  - astStubs.ts resolveStubs: `const list = listHost && isListStubId(id);` → `const list = false;` (the
 *    compact list drawn as full bodies) → block 3 red.
 *  - astStubs.ts useStubbedTree: the embedded page read through scopeTree(…, { level: 1 }) instead of as it
 *    ships (an embedded page scoped) → block 6 red (both cases: the synthesized cause pair and the real
 *    classFeatures:dragon-eidolon / actions:breath-weapon pair; re-measured on main 2026-10-08).
 *  - this file's level-folds.json mock: the synthesized host's own key renamed (the host page with no ledger
 *    entry of its own, as on main before this fix) → block 6's synthesized case red ("the host page folds:
 *    expected +0 to be 1"); the real-host case stays green.
 *  - scripts/lib/stub-names.mjs stubNamesProblems: the `_notes` comparison off → block 4's two-way test red.
 *  - scripts/data/card-truth-baseline.json STUBS back to the 272 page|stub entries (links listed as
 *    offenders) → block 4's census red (272 ≠ 74); scripts/lib/card-scope.mjs computeLedger with the
 *    linked-stub skip removed → card-truth-check red, 198 NEW offenders (every name link).
 *  - RecordCard.tsx: `const stubBase = mine ? mineTree : astNode;` → `const stubBase = mine ? undefined :
 *    astNode;` (the mine cards not widened) → blocks 1 (mine half) and 2 red.
 *  - AstRenderer.tsx renderBlock 'traits': always `null` (an embedded page's chips not drawn) → block 2 red.
 *  - astStubs.ts stubNameOf: `return named;` → `return undefined;` → block 4 red (no names drawn).
 *  - scripts/lib/stub-names.mjs stubRef: the same-name fallback put back (a record of the page's name in
 *    its bucket) → block 4's recomputation red; src/data/stub-names.json rules-2757 ref set to
 *    "rules:hit-points" → block 4's by-id test red.
 *  - scripts/lib/stub-names.mjs stubRef: tiers 2–3 dropped (`return null` after tier 1, the shipped side of
 *    the printing link ignored), the own-category filter removed, or the split-page choice flipped to the
 *    highest aon number → block 4's recomputation red (each alone).
 *  - astStubs.ts mineResolvesStubs: the `bucket !== 'spells'` exclusion removed → block 1's switch test, the
 *    spells case (mine half) and block 7 (the spell mine card unchanged; [222, 216]) red.
 *  - AstRenderer.tsx renderBlock 'document': `card` passed into the embedded page's Blocks → block 8 red
 *    (both cases: the spoiler banner and the "click here" line cut inside the stub).
 *  - src/data/stub-names.json: rules-330 ref null → the census, the either-side test and the recomputation
 *    red; rules-2389 ref "sidebar:affliction-example" (cross-category) → five block-4 tests red; rules-325
 *    ref "rules:spell-dc" → the either-side test and the recomputation red.
 *  - astStubs.ts aonIndex: the reference bucket skipped (measured 2026-10-09) → block 9 red (0 of 5 hits,
 *    the beetle's maneuver not drawn) and test/archive-coverage.test.tsx's resolver test red.
 */

/** Step 14b on / off, read through a mock so block 7 can draw the card as it was before this step. */
const sw = vi.hoisted(() => ({ pre14b: false }));
vi.mock('../src/sheet/astStubs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/sheet/astStubs')>();
  return {
    ...real,
    browseResolvesStubs: (b: string) => (sw.pre14b ? b === 'items' && real.browseResolvesStubs(b) : real.browseResolvesStubs(b)),
    mineResolvesStubs: (b: string) => (sw.pre14b ? false : real.mineResolvesStubs(b)),
  };
});

/**
 * Block 6's synthesized host page is built the way a real host is: a real page that embeds another one
 * has its OWN ledger entries (scripts/level-folds.mjs reads every page under its own key, and
 * src/sheet/cardScope.ts ledgerKeyOf judges a record drawing its own tree on that key only, never on a
 * twin's — commit 2196d31). The synthesized page is cause:desecration's tree plus one stub after its title,
 * so its level sections hash exactly as cause:desecration's do; it gets those entries under its own key.
 * Measured before choosing this (2026-10-08): no REAL record lost a fold between dbd6f51 and 2196d31 —
 * 1,648 rows draw a tree holding a stub; 34,608 scopes (levels 0-20), fold counts 5,131 = 5,131, every
 * fold at the same tree index; 348 scopes only renamed a fold to the page the record draws.
 */
vi.mock('../scripts/data/level-folds.json', async (importOriginal) => {
  const real = ((await importOriginal()) as { default: { pages: Record<string, unknown> } }).default;
  return { default: { ...real, pages: { ...real.pages, 'classFeatures:zz-synth-stub-host': real.pages['cause:desecration'] } } };
});

const db: ContentDatabase = content();
const noop = () => undefined;
const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) as Record<string, AstNode>;
/** Every shipped tree, as it ships (the census reads these). */
const shipped: Record<string, Record<string, AstNode>> = {};
/** What the page loader serves: the shipped trees, plus block 6's synthesized host page. */
const served: Record<string, Record<string, AstNode>> = {};
const SYNTH = 'zz-synth-stub-host';

/**
 * One page per host bucket (the first sorted page with a record whose stub resolves) and the page its
 * first stub draws (measured 2026-10-08 on the lane's data). archetype draws a compact list entry.
 */
const STUB_BUCKET_CASES: Record<string, [slug: string, ref: string]> = {
  actions: ['research', 'rules:building-a-research-challenge'],
  ancestries: ['anadi', 'actions:change-shape'],
  animalCompanions: ['aon-air-elemental', 'actions:circling-flyby'],
  archetype: ['acrobat', 'feats:acrobat-dedication'],
  backgrounds: ['banished-celestial', 'actions:enlightenment-in-adversity'],
  cause: ['desecration', 'actions:selfish-shield'],
  classFeatures: ['alchemical-sciences-methodology', 'actions:quick-tincture'],
  classes: ['alchemist', 'classFeatures:quick-alchemy'],
  deviantAbilityClassification: ['blight-soul', 'feats:release-spores'],
  familiarAbilities: ['aeon-wyrd', 'familiarAbilities:aeon-stone-reservoir'],
  feats: ['additional-follower', 'actions:call-follower'],
  heritages: ['ancient-blooded-dwarf', 'actions:call-on-ancient-blood'],
  implement: ['amulet', 'classFeatures:amulets-abeyance'],
  innovation: ['light-mortar', 'items:innovation-light-mortar'],
  items: ['8-round-magazine', 'weaponGroup:firearm'],
  methodology: ['alchemical-sciences', 'actions:quick-tincture'],
  rules: ['1-set-objectives', 'rules:defend'],
  sidebar: ['beastmaster-animal-companions', 'actions:call-companion'],
  skill: ['acrobatics', 'actions:balance'],
  skillGeneralAction: ['abandon-hex', 'actions:abandon-hex'],
  spells: ['bone-flense', 'actions:erupting-spurs'],
  subconsciousMind: ['emotional-acceptance', 'classFeatures:restore-the-mind'],
  way: ['way-of-the-pistolero', 'actions:pistoleros-retort'],
};
/** The host buckets whose 'mine' card never draws a stub: items (the Strike card keeps its gate) and spells
 *  (docs/card-design.md section 9 row 14b names the mine cards StatDetail, FeatDetail and the action popup;
 *  a spell page's stubs draw on its browse card only). */
const MINE_NO_STUBS: ReadonlySet<string> = new Set(['items', 'spells']);

beforeAll(async () => {
  for (const f of readdirSync('public/ast').filter((x) => x.endsWith('.json.gz'))) shipped[f.replace(/\.json\.gz$/, '')] = readGz(`public/ast/${f}`);
  for (const [b, m] of Object.entries(shipped)) served[b] = m;
  served.classFeatures = { ...shipped.classFeatures, [SYNTH]: synthHost() };
  // The loader's raw-json fallback (the .gz fetch answers not-ok), as the other card tests do.
  vi.stubGlobal('fetch', async (url: string) => {
    const m = /ast\/(\w+)\.json$/.exec(String(url));
    return m && served[m[1]] ? { ok: true, json: async () => served[m[1]] } : { ok: false };
  });
  for (const b of Object.keys(served)) await loadBucketAst(b);
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}, 120_000);

const mounted: (() => void)[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!(); sw.pre14b = false; });
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement, cdb: ContentDatabase = db): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<ContentContext.Provider value={cdb}>{el}</ContentContext.Provider>); });
  await settle();
  mounted.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}
const browse = (bucket: string, id: string) => <RecordCard record={{ bucket, id }} mode="browse" chrome="popup" onExit={noop} />;
const mine = (bucket: string, id: string, level = 20) => <RecordCard record={{ bucket, id }} mode="mine" chrome="popup" scope={{ level }} printed={[]} onExit={noop} />;
const squash = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
/** The step-14b stub elements taken out: the compact lists, the names, and every embedded page that is not
 *  an item page's (step 14's). Markup through the DOM so both sides serialize alike. */
function without14b(html: string, hostBucket: string): string {
  const d = document.createElement('div');
  d.innerHTML = html;
  d.querySelectorAll('[data-stub-list], [data-stub^="aon:"]').forEach((e) => e.remove());
  if (hostBucket !== 'items') d.querySelectorAll('[data-stub]').forEach((e) => e.remove());
  return d.innerHTML;
}
const viaDom = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d.innerHTML; };

/** cause:desecration's page (two level-titled sections the ledger folds below 9th and 11th level) with a
 *  stub to cause:grandeur's page (cause-9: two level-titled sections of its own) inserted after its title. */
function synthHost(): AstNode {
  const page = shipped.cause.desecration;
  const top = page.c ?? [];
  return { ...page, c: [top[0], { t: 'document', level: '2', id: 'cause-9' } as AstNode, ...top.slice(1)] };
}

describe('card step 14b: every host bucket, each behind its own case', () => {
  // batch card: #card-STUBS — an embedded page drawn once, one level deep
  it('STUB_HOST_BUCKETS is exactly the cased buckets, and holds every shipped bucket with a resolvable stub', () => {
    expect([...STUB_HOST_BUCKETS].sort(), 'a host bucket without its case (or a case without its bucket)').toEqual(Object.keys(STUB_BUCKET_CASES).sort());
    const idx = aonIndex(db);
    const withResolvable = Object.keys(shipped).filter((b) => Object.values(shipped[b]).some((t) => stubIds(t).some((id) => (idx.get(id) ?? []).some((c) => shipped[c.bucket]?.[c.slug]))));
    // Measured 2026-10-08: 23 buckets carry a stub that resolves; every one is listed.
    expect(withResolvable.sort()).toEqual([...STUB_HOST_BUCKETS].sort());
    // The switches: items' browse stubs stay behind CARD_ON.itemDetail; a mine POPUP never resolves an item
    // page (Strike) nor a spell page (row 14b: a spell's stubs draw on its browse card only).
    for (const b of STUB_HOST_BUCKETS) {
      // batch card: #card-STUBS — an embedded page drawn once, one level deep
      expect(browseResolvesStubs(b), b).toBe(true);
      expect(mineResolvesStubs(b), b).toBe(!MINE_NO_STUBS.has(b));
    }
    expect(browseResolvesStubs('trait')).toBe(false);
  });

  for (const [bucket, [slug, ref]] of Object.entries(STUB_BUCKET_CASES)) {
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    it(`${bucket}: ${slug} draws ${ref} on browse${MINE_NO_STUBS.has(bucket) ? ', never on its mine card' : ' and on its mine card'}`, async () => {
      // The first stub resolves to that page (its first candidate whose page ships).
      const idx = aonIndex(db);
      const tree = recordTree(bucket, slug, (b, s) => shipped[b]?.[s]);
      const first = stubIds(tree).map((id) => (idx.get(id) ?? []).find((c) => shipped[c.bucket]?.[c.slug])).find(Boolean);
      expect(first && `${first.bucket}:${first.slug}`, `${bucket}:${slug} first resolvable stub`).toBe(ref);
      const sel = `.ast-pop > .ast-body [data-stub="${ref}"]`;
      const b = await mount(browse(bucket, slug));
      // batch card: #card-STUBS — an embedded page drawn once, one level deep
      expect(b.querySelector(sel), `browse ${bucket}:${slug} draws ${ref}`).toBeTruthy();
      const m = await mount(mine(bucket, slug));
      expect(!!m.querySelector('.ast-modal.card-mine'), `${bucket}:${slug} mine card page lane`).toBe(true);
      expect(!!m.querySelector(sel), `mine ${bucket}:${slug} draws ${ref}`).toBe(!MINE_NO_STUBS.has(bucket));
      // spells (row 14b: the browse card only) and items (Strike): the mine card draws no stub at all.
      if (MINE_NO_STUBS.has(bucket)) expect(m.querySelector('[data-stub], [data-stub-list]'), `mine ${bucket}:${slug} draws no stub`).toBeNull();
    });
  }

  // batch card: #card-STUBS — an embedded page drawn once, one level deep
  it('the Strike card (the mine popup of an item page) never draws a stub, though the page embeds its group', async () => {
    // StrikeDetailModal hands the card { key: 'items', slug } (src/sheet/StrikeDetailModal.tsx strikeParts).
    const node = { title: 'Longsword', description: '', key: 'items', slug: 'longsword', mode: 'mine' as const };
    const host = await mount(<RecordCard node={node} mode="mine" chrome="popup" scope={{ level: 20 }} printed={[]} onExit={noop} />);
    expect(host.querySelector('.ast-modal.card-mine')).toBeTruthy();
    expect(host.querySelector('[data-stub]')).toBeNull();
    // The browse card of the same page draws it (step 14).
    // batch card premise: weapon-group-15 "becoming off-guard until the start of your next turn"
    const b = await mount(browse('items', 'longsword'));
    expect(squash(b.querySelector('[data-stub="weaponGroup:sword"]')?.textContent)).toContain('becoming off-guard until the start of your next turn');
  });
});

/*
 * The archive-coverage bucket `reference` (pages the GM's Search finds, read by no picker) is reached by a
 * stub only through an aon id the host page itself embeds (test/archive-coverage.test.tsx pins the source
 * half and the "only by an embedded id" half; decided 2026-10-09). This is the shipped census: each of these
 * draws the page its host prints inline, and a new one turns this red to be read before it ships.
 */
describe('card step 14b: the stubs that draw a reference page are the host pages\' own embeds', () => {
  // batch card: #card-STUBS — an embedded page drawn once, one level deep
  it('over every shipped tree: 5 stubs, each drawn on its browse card', async () => {
    const idx = aonIndex(db);
    const hits: string[] = [];
    for (const [b, ts] of Object.entries(shipped)) {
      for (const [s, t] of Object.entries(ts)) {
        for (const id of stubIds(t)) {
          const first = (idx.get(id) ?? []).find((c) => shipped[c.bucket]?.[c.slug]);
          if (first?.bucket === 'reference') hits.push(`${b}:${s} ${id} reference:${first.slug}`);
        }
      }
    }
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(hits.sort()).toEqual([
      'animalCompanions:beetle action-1040 reference:hustle',
      'feats:phalanx-formation creature-family-543 reference:military',
      'items:aon-guide creature-family-537 reference:explorer',
      'items:ladys-chalice action-1167 reference:strike',
      'items:magical-medal-wolf-pack creature-family-485 reference:wolf',
    ]);
    // The beetle's Advanced Maneuver is drawn under its name, on browse and on the companion's mine card.
    // batch card premise: action-1040 "moves at incredible speed"
    for (const card of [browse('animalCompanions', 'beetle'), mine('animalCompanions', 'beetle')]) {
      const host = await mount(card);
      expect(squash(host.querySelector('[data-stub="reference:hustle"]')?.textContent)).toContain('moves at incredible speed');
    }
  });
});

describe('card step 14b: Rage shows the Rage action once', () => {
  // batch card premise: action-2802 "You tap into your inner fury and begin raging"
  const PHRASE = 'You tap into your inner fury and begin raging';
  it('on the Feats-tab card of a barbarian 1 (FeatDetail, mine) and on browse: the page\'s stub and nothing else', async () => {
    const ch = build('barbarian', 1);
    const host = await mount(<FeatsTab character={ch} content={db} />);
    const row = [...host.querySelectorAll('.ff-row')].find((r) => squash(r.querySelector('.ff-name')?.textContent) === 'Rage');
    expect(row, 'a barbarian lists Rage').toBeTruthy();
    await act(async () => { (row as HTMLElement).click(); });
    await settle();
    const modal = host.querySelector('.ast-modal.card-mine')!;
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(modal, 'the row opens the class feature\'s mine card').toBeTruthy();
    expect(squash(modal.querySelector('.ast-head .ast-name')?.textContent)).toBe('Rage');
    const text = squash(modal.textContent);
    expect(count(text, PHRASE), 'the Rage action, once').toBe(1);
    const stub = modal.querySelector('.ast-pop > .ast-body [data-stub="actions:rage"]');
    expect(squash(stub?.textContent)).toContain(PHRASE);
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(modal.querySelectorAll('[data-stub]').length, 'the page embeds one page').toBe(1);
    // The embedded action's heading (its name, at the stub's level) and its OWN trait chips, inside it.
    const heading = stub!.querySelector('.ast-h2 .ast-hname')!;
    expect(squash(heading.querySelector('a, span.ast-lk-dead')?.textContent ?? heading.firstChild?.textContent)).toBe('Rage');
    expect(heading.querySelector('.ast-ag')?.getAttribute('title'), 'its action glyph').toBe('Single Action');
    expect([...stub!.querySelectorAll('.ast-stub-traits .ast-tr')].map((e) => squash(e.textContent))).toEqual(['Barbarian', 'Concentrate', 'Emotion', 'Mental']);
    // The host's own header chips are not the action's.
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(modal.querySelector('.ast-pop > .ast-traits .ast-tr') ? squash(modal.querySelector('.ast-pop > .ast-traits')!.textContent) : '').not.toContain('Concentrate');
    const b = await mount(browse('classFeatures', 'rage'));
    expect(count(squash(b.textContent), PHRASE)).toBe(1);
    expect(b.querySelectorAll('[data-stub="actions:rage"] .ast-stub-traits .ast-tr').length).toBe(4);
  });
});

describe('card step 14b: an archetype page lists its feats compactly', () => {
  // batch card: #card-STUBS — an embedded page drawn once, one level deep
  it('Knight Vigilant (archetype page and its dedication record): one list of name links with badges, no feat bodies', async () => {
    const idx = aonIndex(db);
    for (const [bucket, slug] of [['archetype', 'knight-vigilant'], ['feats', 'aon-knight-vigilant']] as const) {
      const tree = recordTree(bucket, slug, (b, s) => shipped[b]?.[s])!;
      expect(isArchetypePage(tree), `${bucket}:${slug} is an archetype page`).toBe(true);
      const featStubs = stubIds(tree).filter(isListStubId);
      const host = await mount(browse(bucket, slug));
      const lists = host.querySelectorAll('.ast-pop > .ast-body [data-stub-list]');
      // batch card: #card-STUBS — an embedded page drawn once, one level deep
      expect(lists.length, `${bucket}:${slug}: one compact list`).toBe(1);
      const items = [...lists[0].querySelectorAll(':scope > li.ast-stub-item')];
      const want = featStubs.filter((id, i) => featStubs.indexOf(id) === i);
      expect(items.length, `${bucket}:${slug}: one entry per feat stub`).toBe(want.length);
      // Measured 2026-10-08: the archetype page lists 24 feats.
      expect(items.length).toBe(24);
      items.forEach((li, i) => {
        const id = want[i];
        const t = (idx.get(id) ?? []).find((c) => shipped[c.bucket]?.[c.slug]);
        const ref = t ? `${t.bucket}:${t.slug}` : `aon:${id}`;
        // batch card: #card-STUBS — an embedded page drawn once, one level deep
        expect(li.getAttribute('data-stub'), `${bucket}:${slug} entry ${i}`).toBe(ref);
        expect(li.querySelector('a.ast-lk'), `${ref} is a link`).toBeTruthy();
        expect(li.querySelector('p, .ast-h2, .ast-h3, .ast-traits'), `${ref}: no body`).toBeNull();
        expect(li.querySelector('.ast-hbadge')?.textContent ?? '', `${ref} badge`).toMatch(/^Feat \d+\*?$/);
        if (!t) expect(STUB_NAMES[id], `${id} is named`).toBeTruthy();
      });
      // The first listed feat's body is not drawn; its name is.
      const firstRef = items[0].getAttribute('data-stub')!;
      const [fb, fs] = firstRef.split(':');
      const firstPage = shipped[fb][fs];
      const bodyP = (firstPage.c ?? []).find((n) => n.t === 'p' && squash(flat(n)).length > 60);
      // batch card: #card-STUBS — an embedded page drawn once, one level deep
      expect(bodyP, `${firstRef} has a body paragraph`).toBeTruthy();
      expect(squash(host.textContent)).not.toContain(squash(flat(bodyP!)).slice(0, 60));
      // A name opens the feat's own card (drill-in), Back returns.
      const name = squash(items[0].querySelector('a.ast-lk')!.textContent);
      await act(async () => { (items[0].querySelector('a.ast-lk') as HTMLElement).click(); });
      await settle();
      // batch card: #card-STUBS — an embedded page drawn once, one level deep
      expect(squash(host.querySelector('.ast-head .ast-name')?.textContent), `${firstRef} opens`).toBe(name);
      expect(host.querySelector('.info-back')).toBeTruthy();
    }
  });

  // batch card: #card-STUBS — an embedded page drawn once, one level deep
  it('over every shipped archetype page: every feat stub is a list entry (never a body), every other stub a page or a name', () => {
    const idx = aonIndex(db);
    let entries = 0, bodies = 0, other = 0, featStubs = 0;
    for (const [slug, tree] of Object.entries(shipped.archetype)) {
      const out = resolveStubs(tree, `archetype:${slug}`, (id) => idx.get(id), (b, s) => shipped[b]?.[s], { nameOf: (id) => stubNameOf(id, idx, db) });
      featStubs += stubIds(tree).filter(isListStubId).length;
      (function walk(n: AstNode) {
        const s = n as StubbedNode;
        if (s.stubKind === 'list') { entries++; if (s.c?.length) bodies++; }
        else if (s.stubOf || s.stubKind === 'name') { other++; if (isListStubId(s.id)) bodies++; }
        for (const c of n.c ?? []) walk(c);
      })(out);
    }
    // Measured 2026-10-08: 2,664 feat stubs on the archetype pages (docs/card-design.md section 2 rule 6),
    // every one a compact entry (a repeat on one page would draw nothing; there is none); the 7 other
    // stubs (actions, a siege weapon) draw their pages.
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(featStubs).toBe(2664);
    expect(entries).toBe(2664);
    expect(bodies).toBe(0);
    expect(other).toBe(7);
  });
});

const flat = (n: AstNode): string => (n.t === 'text' ? String(n.v ?? '') : (n.c ?? []).map(flat).join(''));

describe('card step 14b: a stub no record\'s page answers draws its name', () => {
  // batch card: #card-STUBS — an embedded page drawn once, one level deep
  it('over every shipped tree: 273 occurrences, each a name link when a record exists, else a plain name', () => {
    const idx = aonIndex(db);
    let total = 0, link = 0, plain = 0;
    const plainIds = new Set<string>();
    for (const [b, ts] of Object.entries(shipped)) {
      for (const [slug, tree] of Object.entries(ts)) {
        const out = resolveStubs(tree, `${b}:${slug}`, (id) => idx.get(id), (x, s) => shipped[x]?.[s], { nameOf: (id) => stubNameOf(id, idx, db) });
        (function walk(n: AstNode) {
          const s = n as StubbedNode;
          if (s.stubKind && !s.stubOf) {
            total++;
            if (s.stubLink) {
              link++;
              const [lb, ls] = s.stubLink.split(':');
              // batch card: #card-STUBS — an embedded page drawn once, one level deep
              expect((db as unknown as Record<string, Record<string, unknown>>)[lb]?.[ls], `${s.id} → ${s.stubLink} is a record`).toBeTruthy();
            } else { plain++; plainIds.add(String(s.id)); }
          }
          for (const c of n.c ?? []) walk(c);
        })(out);
      }
    }
    // Measured 2026-10-08: the 273 unresolved occurrences (272 page|stub entries) — 199 draw a name link (a
    // record the mirror's printing link joins to the page by id, from either side, in the page's own
    // category: identity by id, section 2 rule 2, never by display name), 74 a plain name (73 ids: no record
    // is that page by id). Card truth's STUBS section lists only the plain ones (a link is no offender):
    // 74 page|stub entries, exactly these 73 ids (scripts/lib/card-scope.mjs computeLedger).
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(total).toBe(273);
    expect([link, plain]).toEqual([199, 74]);
    expect(plainIds.size).toBe(73);
    const ledgerStubs = (JSON.parse(readFileSync('scripts/data/card-truth-baseline.json', 'utf8')) as { STUBS: string[] }).STUBS;
    expect(ledgerStubs.length).toBe(74);
    expect([...new Set(ledgerStubs.map((e) => e.slice(e.indexOf('|') + 1)))].sort()).toEqual([...plainIds].sort());
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(plainIds.has('rules-2757')).toBe(true);
    expect(plainIds.has('rules-330')).toBe(false);
  });

  // batch card: #card-STUBS — an embedded page drawn once, one level deep
  it('a link is chosen by id, never by a record that only shares the page\'s name', async () => {
    // rules-2757 "Hit Points" (GM Core pg. 84, level 0 characters) is not rules:hit-points (rules-2891,
    // GM Core pg. 118, building creatures); rules-2187 "Attack Rolls" (Player Core pg. 275) is not
    // rules-2288 (Player Core pg. 402). No printing link joins either pair by id, so both stay plain.
    expect((db as unknown as Record<string, Record<string, { aonId?: string }>>).rules['hit-points']?.aonId).toBe('rules-2891');
    expect(STUB_NAMES['rules-2757']).toEqual({ name: 'Hit Points', ref: null, right: 'Rules' });
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(STUB_NAMES['rules-2187']).toEqual({ name: 'Attack Rolls', ref: null, right: 'Rules' });
    // Every ref of the file names a record the mirror's printing link joins to the stub's page by id — the
    // stub page's remaster_id / legacy_id names the record, or the record's page names the stub — in the
    // stub page's own category (mirror only).
    if (existsSync(DEFAULT_MIRROR)) {
      const aonOf = (ref: string) => { const [b, s] = ref.split(':'); return (db as unknown as Record<string, Record<string, { aonId?: string }>>)[b]?.[s]?.aonId; };
      const ids = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map(String);
      const page = (id: string) => JSON.parse(readFileSync(`${DEFAULT_MIRROR}/${id.replace(/-\d+$/, '')}/${id}.json`, 'utf8')) as { remaster_id?: unknown; legacy_id?: unknown };
      for (const [id, v] of Object.entries(STUB_NAMES)) {
        if (!v.ref) continue;
        const aon = String(aonOf(v.ref));
        const stub = page(id), rec = page(aon);
        const joined = [...ids(stub.remaster_id), ...ids(stub.legacy_id)].includes(aon) || [...ids(rec.legacy_id), ...ids(rec.remaster_id)].includes(id);
        // batch card: #card-STUBS — an embedded page drawn once, one level deep
        expect(joined, `${id} → ${v.ref} (${aon}) is a printing of it by id`).toBe(true);
        expect(aon.replace(/-\d+$/, ''), `${id} → ${aon} in the page's own category`).toBe(id.replace(/-\d+$/, ''));
      }
    }
    // On the card: rules:building-characters embeds rules-2757 — its name, plain, no link to the other page.
    const r = await mount(browse('rules', 'building-characters'));
    const hp = r.querySelector('.ast-pop > .ast-body [data-stub="aon:rules-2757"]');
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(squash(hp?.querySelector('.ast-hname')?.textContent)).toBe('Hit Points');
    expect(hp?.querySelector('a')).toBeNull();
  });

  // batch card: #card-STUBS — an embedded page drawn once, one level deep
  it('drawn on the card: a link that opens the record, and a plain name', async () => {
    // Initiate Benefit (amulet) embeds action-1229, the legacy Amulet's Abeyance; its record is the remaster's.
    const a = await mount(browse('classFeatures', 'initiate-benefit-amulet'));
    const named = a.querySelector('.ast-pop > .ast-body [data-stub="aon:action-1229"]');
    expect(named?.matches('.ast-stub-name'), 'drawn where the embedded page\'s heading would be').toBe(true);
    expect(squash(named?.querySelector('a.ast-lk')?.textContent)).toBe("Amulet's Abeyance");
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(STUB_NAMES['action-1229']).toEqual({ name: "Amulet's Abeyance", ref: 'actions:amulets-abeyance', right: 'Action' });
    expect(squash(named?.querySelector('.ast-hbadge')?.textContent)).toBe('Action');
    await act(async () => { (named!.querySelector('a.ast-lk') as HTMLElement).click(); });
    await settle();
    expect(squash(a.querySelector('.ast-head .ast-name')?.textContent)).toBe("Amulet's Abeyance");
    // rules:chapter-8-playing-the-game embeds rules-2389 "Afflictions", which no record is by id: its name,
    // plain (the one printing link to it starts on a sidebar page, another kind of page).
    const r = await mount(browse('rules', 'chapter-8-playing-the-game'));
    const plain = r.querySelector('.ast-pop > .ast-body [data-stub="aon:rules-2389"]');
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(squash(plain?.querySelector('.ast-hname')?.textContent)).toBe('Afflictions');
    expect(squash(plain?.querySelector('.ast-hbadge')?.textContent)).toBe('Rules');
    expect(plain?.querySelector('a')).toBeNull();
  });

  // batch card: #card-STUBS — an embedded page drawn once, one level deep
  it('a stub whose page a shipped record names by id links that record (the printing link read from either side)', async () => {
    // rules-2300 "Skill Checks" (Player Core) lists rules-330 "Skill Checks and Skill DCs" (Core Rulebook) as
    // its legacy_id; rules-330's own remaster_id names rules-2276 "Skills", which no record carries.
    // batch card premise: rules-330 "Skill Checks and Skill DCs"
    expect(STUB_NAMES['rules-330']).toEqual({ name: 'Skill Checks and Skill DCs', ref: 'rules:skill-checks', right: 'Rules' });
    // rules-325 "Spell Attack Rolls" is the legacy_id of rules-2292 "Spell Attack Rolls" AND rules-2293 "Spell
    // DC" (the page was split): the lowest aon number, rules-2292.
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(STUB_NAMES['rules-325']).toEqual({ name: 'Spell Attack Rolls', ref: 'rules:spell-attack-rolls', right: 'Rules' });
    expect((db as unknown as Record<string, Record<string, { aonId?: string }>>).rules['spell-dc']?.aonId).toBe('rules-2293');
    // feat-6209 "Master Spotter" (Player Core 2) names feat-1850 as its legacy_id, and feat-1850 names it as
    // its remaster_id: the older printing this app ships.
    // batch card premise: feat-1850 "Master Spotter"
    expect(STUB_NAMES['feat-6209']).toEqual({ name: 'Master Spotter', ref: 'feats:master-spotter-investigator', right: 'Feat 12' });
    // sidebar-47 "Affliction Example" names rules-2389 "Afflictions" as its remaster_id: a sidebar is not a
    // printing of a rules page, so no link (own category only).
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect((db as unknown as Record<string, Record<string, { aonId?: string }>>).sidebar['affliction-example']?.aonId).toBe('sidebar-47');
    expect(STUB_NAMES['rules-2389']).toEqual({ name: 'Afflictions', ref: null, right: 'Rules' });
    // On the card: rules:specific-checks draws both as links, and a link opens the record.
    const r = await mount(browse('rules', 'specific-checks'));
    const skill = r.querySelector('.ast-pop > .ast-body [data-stub="aon:rules-330"]');
    const spell = r.querySelector('.ast-pop > .ast-body [data-stub="aon:rules-325"]');
    // batch card premise: rules-330 "Skill Checks and Skill DCs"
    expect(squash(skill?.querySelector('a.ast-lk')?.textContent)).toBe('Skill Checks and Skill DCs');
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(squash(spell?.querySelector('a.ast-lk')?.textContent)).toBe('Spell Attack Rolls');
    await act(async () => { (spell!.querySelector('a.ast-lk') as HTMLElement).click(); });
    await settle();
    expect(squash(r.querySelector('.ast-head .ast-name')?.textContent)).toBe('Spell Attack Rolls');
  });

  // batch card: #card-STUBS — an embedded page drawn once, one level deep
  it('src/data/stub-names.json is the shipped data, two ways (and the mirror\'s recomputation where the mirror is present)', () => {
    const core = JSON.parse(readFileSync('public/core.json', 'utf8'));
    const file = JSON.parse(readFileSync('src/data/stub-names.json', 'utf8'));
    expect(stubNamesProblems(file, core, shipped), 'run npx jiti scripts/stub-names.mjs --write on the new data').toEqual([]);
    if (existsSync(DEFAULT_MIRROR)) expect(computeStubNames(core, shipped, DEFAULT_MIRROR).names).toEqual(file.names);
    // The `_notes` are the generator's, two ways: a note dropped, reworded or added is drift.
    const { _notes: notes, ...noNotes } = file;
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(Object.keys(notes)).toEqual(['action-902']);
    expect(stubNamesProblems(noNotes, core, shipped)).toEqual(['STUB-NAMES-NOTES|action-902']);
    expect(stubNamesProblems({ ...file, _notes: { 'action-902': 'reworded' } }, core, shipped)).toEqual(['STUB-NAMES-NOTES|action-902']);
    expect(stubNamesProblems({ ...file, _notes: { ...notes, 'feat-498': 'a note no generator wrote' } }, core, shipped)).toEqual(['STUB-NAMES-NOTES|feat-498']);
  });
});

describe('card step 14b: a self-embedding chain does not loop', () => {
  const page = (title: string, body: AstNode[]): AstNode => ({ t: 'doc', c: [{ t: 'title', level: '1', c: [{ t: 'p', c: [{ t: 'text', v: title }] }] }, ...body] });
  const stub = (id: string): AstNode => ({ t: 'document', level: '2', id } as AstNode);
  const para = (v: string): AstNode => ({ t: 'p', c: [{ t: 'text', v }] });
  const T: Record<string, AstNode> = {
    a: page('Alpha', [para('Words of Alpha.'), stub('x-b'), stub('x-a')]),
    b: page('Beta', [para('Words of Beta.'), stub('x-a')]),
  };
  const cands = (id: string) => ({ 'x-a': [{ bucket: 'x', slug: 'a' }], 'x-b': [{ bucket: 'x', slug: 'b' }] } as Record<string, { bucket: string; slug: string }[]>)[id];
  const read = (_b: string, s: string) => T[s];

  // batch card: #card-STUBS — an embedded page drawn once, one level deep
  it('A embeds B embeds A (and A embeds itself): B drawn once, A never inside A, nothing two levels deep', () => {
    const out = resolveStubs(T.a, 'x:a', cands, read);
    const drawn: string[] = [];
    (function walk(n: AstNode, depth: number) {
      const from = (n as StubbedNode).stubOf;
      if (from) { drawn.push(`${from}@${depth}`); depth++; }
      for (const c of n.c ?? []) walk(c, depth);
    })(out, 0);
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(drawn).toEqual(['x:b@0']);
    expect(flat(out)).toContain('Words of Beta.');
    expect(count(flat(out), 'Words of Alpha.')).toBe(1);
    // From B's side: A drawn, A's stubs (to B and to A) stay empty.
    const fromB = resolveStubs(T.b, 'x:b', cands, read);
    expect(count(flat(fromB), 'Words of Beta.')).toBe(1);
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(count(flat(fromB), 'Words of Alpha.')).toBe(1);
  });

  // batch card: #card-STUBS — an embedded page drawn once, one level deep
  it('on every shipped page with a stub: no page draws its own host, and no embedded page draws a page', () => {
    const idx = aonIndex(db);
    let pages = 0, embedded = 0;
    for (const [b, ts] of Object.entries(shipped)) {
      for (const [slug, tree] of Object.entries(ts)) {
        if (!stubIds(tree).length) continue;
        pages++;
        const host = `${b}:${slug}`;
        const out = resolveStubs(tree, host, (id) => idx.get(id), (x, s) => shipped[x]?.[s]);
        const seen = new Set<string>();
        (function walk(n: AstNode, inside: boolean) {
          const from = (n as StubbedNode).stubOf;
          if (from && (n.c?.length || (n as StubbedNode).stubKind)) {
            // batch card: #card-STUBS — an embedded page drawn once, one level deep
            expect(from, `${host} never embeds itself`).not.toBe(host);
            expect(inside, `${host}: ${from} is one level deep`).toBe(false);
            expect(seen.has(from), `${host} embeds ${from} once`).toBe(false);
            seen.add(from);
            embedded++;
            for (const c of n.c ?? []) walk(c, true);
            return;
          }
          for (const c of n.c ?? []) walk(c, inside);
        })(out, false);
      }
    }
    // Measured 2026-10-08: 1,657 pages carry a stub; 5,583 stubs draw a page or a compact entry.
    // batch card: #card-STUBS — an embedded page drawn once, one level deep
    expect(pages).toBe(1657);
    expect(embedded).toBe(5583);
  });
});

describe('card step 14b: a mine card scopes the host page only; an embedded page is drawn as it ships', () => {
  // batch card: #card-NEVER-SCOPED — an embedded page is drawn as printed
  it('the host\'s level sections fold at 1st level; the embedded cause page shows its own whole', async () => {
    const dbx = { ...db, classFeatures: { ...db.classFeatures, [SYNTH]: { id: SYNTH, name: 'Synthesized Stub Host' } } } as unknown as ContentDatabase;
    // Both pages carry ledger sections (scripts/data/level-folds.json) that fold below their level.
    const own = LEVEL_FOLDS.pages['cause:desecration'];
    const emb = LEVEL_FOLDS.pages['cause:grandeur'];
    expect(own.map((s) => s.level)).toEqual([9, 11]);
    // batch card: #card-NEVER-SCOPED — an embedded page is drawn as printed
    expect(emb.map((s) => s.level)).toEqual([9, 11]);
    // The stub (cause-9) draws its first candidate whose page ships: the Grandeur page, by aon id.
    const t = (aonIndex(dbx).get('cause-9') ?? []).find((c) => shipped[c.bucket]?.[c.slug])!;
    const ref = `${t.bucket}:${t.slug}`;
    expect(t.slug).toBe('grandeur');
    // The embedded page alone, on its own mine card at 1st level, folds both sections: scoping WOULD fold it.
    const alone = await mount(mine(t.bucket, t.slug, 1), dbx);
    // batch card: #card-NEVER-SCOPED — an embedded page is drawn as printed
    expect(alone.querySelectorAll('details.card-fold').length).toBe(1);
    const host = await mount(mine('classFeatures', SYNTH, 1), dbx);
    const body = host.querySelector('.ast-modal.card-mine .ast-pop > .ast-body')!;
    const stub = body.querySelector(`[data-stub="${ref}"]`);
    expect(stub, 'the embedded cause page is drawn').toBeTruthy();
    // The host's two later sections fold (13a), outside the embedded page.
    const folds = [...body.querySelectorAll('details.card-fold')];
    // batch card: #card-NEVER-SCOPED — an embedded page is drawn as printed
    expect(folds.length, 'the host page folds').toBe(1);
    expect(folds.every((f) => !stub!.contains(f))).toBe(true);
    expect(squash(folds[0].querySelector('summary')?.textContent)).toBe('At higher levels (2)');
    // The embedded page: no fold, every section title of its own drawn, whole.
    expect(stub!.querySelector('.card-fold, [data-fold]'), 'the embedded page is never scoped').toBeNull();
    const embTitles = [...stub!.querySelectorAll('.ast-h2 .ast-hname, .ast-h3 .ast-hname')].map((e) => squash(e.textContent));
    // batch card: #card-NEVER-SCOPED — an embedded page is drawn as printed
    for (const s of emb) expect(embTitles, `Grandeur's "${s.title}" drawn`).toContain(squash(s.title));
    expect(squash(stub!.textContent)).toContain('Level 9');
  });
  // batch card: #card-NEVER-SCOPED — an embedded page is drawn as printed
  it('a real host: classFeatures:dragon-eidolon folds its own two later sections; the embedded Breath Weapon keeps its 3rd-level line', async () => {
    // Both pages are ledger pages of their own: the host's two level sections, and the action's prose gate.
    // batch card premise: eidolon-7 "Draconic Frenzy"
    expect(LEVEL_FOLDS.pages['classFeatures:dragon-eidolon'].map((s) => s.title)).toEqual(['Draconic Frenzy', "Wyrm's Breath"]);
    // batch card: #card-NEVER-SCOPED — an embedded page is drawn as printed
    expect(LEVEL_FOLDS.prose?.['actions:breath-weapon']?.map((g) => g.level)).toEqual([3]);
    const GATE = 'At 3rd level and every 2 levels thereafter, the damage increases by 1d6.';
    // The embedded page alone, on its own mine card at 1st level, folds its gate: scoping WOULD fold it.
    const alone = await mount(mine('actions', 'breath-weapon', 1));
    expect(alone.querySelectorAll('details.card-fold').length).toBe(1);
    const host = await mount(mine('classFeatures', 'dragon-eidolon', 1));
    const body = host.querySelector('.ast-modal.card-mine .ast-pop > .ast-body')!;
    const stub = body.querySelector('[data-stub="actions:breath-weapon"]');
    // batch card: #card-NEVER-SCOPED — an embedded page is drawn as printed
    expect(stub, 'the embedded Breath Weapon page is drawn').toBeTruthy();
    const folds = [...body.querySelectorAll('details.card-fold')];
    expect(folds.length, 'the host page folds').toBe(1);
    expect(squash(folds[0].querySelector('summary')?.textContent)).toBe('At higher levels (2)');
    expect(folds.every((f) => !stub!.contains(f))).toBe(true);
    expect(stub!.querySelector('.card-fold, [data-fold]'), 'the embedded page is never scoped').toBeNull();
    // batch card: #card-NEVER-SCOPED — an embedded page is drawn as printed
    expect(squash(stub!.textContent)).toContain(GATE);
  });
});

describe('card step 14b: an embedded page is drawn as printed on a mine card', () => {
  /**
   * Orchestrator ruling (round 3, nit 2): the card walk never reaches inside a [data-stub] — no S-furniture
   * cut, no dim / use class, no printed-set drop. A spoiler banner and a "click here" line, both S-furniture
   * on the host's own page, stay inside an embedded page on a mine card, drawn exactly as the browse card
   * draws them.
   */
  const SPOILER = 'May contain spoilers from Gatewalkers';
  const CLICK = 'Click here for the Alchemical Bombs category page.';
  const cases = [
    // batch card premise: feat-8026 "May contain spoilers from Gatewalkers"
    ['deviantAbilityClassification', 'dragon', 'feats:blasting-beams', SPOILER],
    // batch card premise: rules-3181 "Click here for the Alchemical Bombs category page"
    ['rules', 'alchemy', 'rules:alchemical-bombs', CLICK],
  ] as const;
  for (const [bucket, slug, ref, words] of cases) {
    it(`${bucket}:${slug}'s mine card draws ${ref} whole, as browse does: "${words}"`, async () => {
      const sel = `.ast-pop > .ast-body [data-stub="${ref}"]`;
      const m = await mount(mine(bucket, slug));
      // batch card: #card-NEVER-SCOPED — an embedded page is drawn as printed
      expect(m.querySelector('.ast-modal.card-mine'), `${bucket}:${slug} mine card page lane`).toBeTruthy();
      const stub = m.querySelector(sel);
      expect(stub, `mine ${bucket}:${slug} embeds ${ref}`).toBeTruthy();
      expect(squash(stub!.textContent), `the embedded page keeps "${words}"`).toContain(words);
      expect(stub!.querySelector('.card-dim, .card-use, .card-applies, .card-fold, [data-fold], [data-ours]'), 'no card class inside the embedded page').toBeNull();
      const b = await mount(browse(bucket, slug));
      const bStub = b.querySelector(sel);
      // batch card: #card-NEVER-SCOPED — an embedded page is drawn as printed
      expect(squash(bStub?.textContent)).toContain(words);
      expect(stub!.innerHTML, `${ref}: the mine card's embedded page is the browse card's, byte for byte`).toBe(bStub!.innerHTML);
    });
  }
});

describe('card step 14b: nothing else moves', () => {
  /**
   * Up to 6 pages per host bucket (every one with a record whose stubs draw something, sorted, every
   * k-th): the browse card and the 'mine' card, each with step 14b OFF (the mock: items' browse stubs
   * only, no mine stubs) and ON. ON with the step-14b stub elements taken out must be byte-equal to OFF,
   * and ON must draw at least one of them.
   */
  // batch card: #card-SNAPSHOT — a step changes only its own surface
  it('browse and mine cards: only the stubs changed', async () => {
    const idx = aonIndex(db);
    const nameOf = (id: string) => stubNameOf(id, idx, db);
    let compared = 0, changed = 0;
    for (const bucket of [...STUB_HOST_BUCKETS].sort()) {
      const pool = Object.keys(shipped[bucket]).sort().filter((s) => {
        if (!(db as unknown as Record<string, Record<string, unknown>>)[bucket]?.[s]) return false;
        const tree = recordTree(bucket, s, (b, x) => shipped[b]?.[x]);
        if (!tree || !stubIds(tree).length) return false;
        return resolveStubs(tree, `${bucket}:${s}`, (id) => idx.get(id), (b, x) => shipped[b]?.[x], { nameOf }) !== tree;
      });
      const step = Math.max(1, Math.floor(pool.length / 6));
      const picks = pool.filter((_, i) => i % step === 0).slice(0, 6);
      for (const slug of picks) {
        for (const [lane, el] of [['browse', browse(bucket, slug)], ['mine', mine(bucket, slug)]] as const) {
          if (lane === 'mine' && bucket === 'items') continue;
          sw.pre14b = true;
          const off = await mount(el);
          const before = viaDom(off.innerHTML);
          sw.pre14b = false;
          const on = await mount(el);
          const after = on.innerHTML;
          compared++;
          if (viaDom(after) !== before) changed++;
          // batch card: #card-SNAPSHOT — a step changes only its own surface
          expect(without14b(after, bucket), `${lane} ${bucket}:${slug}: only the stubs changed`).toBe(without14b(before, bucket));
          // A spell page's mine card is compared too: with step 14b on it must be the card it was (no stub).
          const draws = lane === 'browse' ? bucket !== 'items' : !MINE_NO_STUBS.has(bucket);
          if (draws) expect(on.querySelector('[data-stub-list], [data-stub]'), `${lane} ${bucket}:${slug} draws a stub`).toBeTruthy();
          if (lane === 'mine' && !draws) expect(viaDom(after), `mine ${bucket}:${slug}: unchanged`).toBe(before);
          while (mounted.length) mounted.pop()!();
        }
      }
    }
    // Measured 2026-10-08: 222 cards compared (up to 6 pages of each of the 23 host buckets, browse and mine;
    // item pages on browse only); 215 changed — every non-item browse card and every mine card but
    // the spell page's, only where a stub now draws; the 6 item browse cards are step 14's and the one spell
    // mine card (spells:bone-flense, the only spell page whose stubs draw) draws no stub (row 14b: a spell's
    // stubs on its browse card only), unchanged.
    // batch card: #card-SNAPSHOT — a step changes only its own surface
    expect([compared, changed]).toEqual([222, 215]);
  }, 300_000);
});
